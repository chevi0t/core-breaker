"""配置案の2m地上格子による経路長を再計算する。実機体やBOTの実走とは区別する。"""
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
import subprocess
import numpy as np
import shapely
from shapely.geometry import Point, Polygon, LineString, box
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

ROOT = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('output', type=Path, help='検査記録のJSON出力先')
ap.add_argument('--write-estimates', action='store_true', help='座標を固定して概算距離と図面用経路を更新する')
args = ap.parse_args()
proposal = json.loads((ROOT/'mapdesign/hoshimichi_west/layout-proposal.json').read_text())
file = ROOT/'mapdesign/hoshimichi_west/layout.json'
assert hashlib.sha256(file.read_bytes()).hexdigest() == proposal['terrainSHA256']
js = "const fs=require('fs'),{decodeCityVolumes}=require(process.argv[1]);const d=JSON.parse(fs.readFileSync(process.argv[2]));d.volumes=decodeCityVolumes(d);process.stdout.write(JSON.stringify(d));"
data = json.loads(subprocess.check_output(['node', '-e', js, str(ROOT/'tools/city_volume_codec.js'), str(file)]))
volumes = []
for kind, bottom, top, encoded, meta in data['volumes']:
    rings = [np.frombuffer(base64.b64decode(r), dtype='<i2').reshape(-1, 2)*data['ringCoordinateStep'] for r in encoded]
    volumes.append((bottom, top, Polygon(rings[0], rings[1:]), meta))

def surface(name):
    s = data['surfaces'][name]
    p = np.frombuffer(base64.b64decode(s['points']), dtype='<i2').reshape(-1, 3)*s['step']
    ids = np.frombuffer(base64.b64decode(s['indices']), dtype='<u2').reshape(-1, 3)
    return shapely.union_all([Polygon(r) for r in p[ids][:, :, [0, 2]]])

land = surface('dem')
obstacles = shapely.union_all([p for b, t, p, meta in volumes if b < 4.2 and t > .1])
landmarks = shapely.union_all([p for b, t, p, meta in volumes if b < 4.2 and meta.get('landmarkColor') in data['volumeColors'][1:7]])
upper = shapely.union_all([p for b, t, p, meta in volumes if 4.2 <= b < 9.4 and t > 0])
bridge = shapely.union_all([Polygon(b['ring']) for b in proposal['bridgeRepairs']])
clears = [box(*b['clear']) for b in proposal['bases']]
clears += [Point(p['at']).buffer(p['clearRadius']) for p in proposal['plants']]
inside = box(-348.7, -173.7, 348.7, 173.7)
for p in clears:
    assert inside.covers(p) and land.covers(p)
    assert landmarks.intersection(p).area < 1, 'ランドマークを削らない'
for i, p in enumerate(proposal['plants']):
    assert not upper.intersects(Point(p['at']).buffer(1.8)), '占拠柱周囲の天井'
    for q in proposal['plants'][i+1:]:
        assert Point(p['at']).distance(Point(q['at'])) >= 100
for b, p in [(proposal['bases'][0], proposal['plants'][0]), (proposal['bases'][1], proposal['plants'][-1])]:
    assert Point(b['at']).distance(Point(p['at'])) >= 95
# 基地とプラント周辺だけを整地した場合を仮定する。周囲の建物はそのまま残す。
free = land.union(bridge).difference(obstacles.difference(shapely.union_all(clears)).buffer(1.4))
free = free.intersection(box(-348, -173, 348, 173))
X, Z = np.meshgrid(np.arange(-348, 349, 2), np.arange(-173, 174, 2))
mask = shapely.contains_xy(free, X, Z)
ids = np.arange(X.size).reshape(X.shape)
rows, cols, costs = [], [], []
for dx, dz in [(1, 0), (0, 1), (1, 1), (-1, 1)]:
    src = (slice(0, mask.shape[0]-dz), slice(max(0, -dx), mask.shape[1]-max(0, dx)))
    dst = (slice(dz, mask.shape[0]), slice(max(0, dx), mask.shape[1]+min(0, dx)))
    yes = mask[src] & mask[dst]
    if dx and dz:
        yes &= mask[(src[0], dst[1])] & mask[(dst[0], src[1])]
    a, b = ids[src][yes], ids[dst][yes]
    rows.extend([a, b]); cols.extend([b, a]); costs.extend([np.full(len(a), 2*math.hypot(dx, dz))]*2)
graph = csr_matrix((np.concatenate(costs), (np.concatenate(rows), np.concatenate(cols))), shape=(X.size, X.size))
points = proposal['bases'] + proposal['plants']
nodes = []
for p in points:
    r = ((X-p['at'][0])**2+(Z-p['at'][1])**2).astype(float)
    r[~mask] = np.inf
    assert r.min() <= 4
    nodes.append(int(r.argmin()))
distances, pred = dijkstra(graph, indices=nodes, return_predecessors=True)
d = distances[:, nodes]
assert np.isfinite(d).all(), '全基地・全プラントの地上接続'
if args.write_estimates:
    proposal['routeEstimate']['distanceMatrixMeters'] = np.round(d, 1).tolist()
    proposal['routeEstimate']['centralBaseRouteMeters'] = {'B': round(d[0,4],1), 'R': round(d[1,4],1)}
    ids = proposal['routeEstimate']['nodeOrder']
    for route in proposal['routes']:
        first, last = ids.index(route['from']), ids.index(route['to'])
        j, coords = nodes[last], []
        while j >= 0:
            coords.append([float(X.ravel()[j]), float(Z.ravel()[j])])
            if j == nodes[first]: break
            j = int(pred[first,j])
        assert j == nodes[first]
        route['lengthMeters'] = round(d[first,last], 1)
        route['points'] = [list(p) for p in LineString(coords[::-1]).simplify(1).coords]
    (ROOT/'mapdesign/hoshimichi_west/layout-proposal.json').write_text(json.dumps(proposal,ensure_ascii=False,indent=2)+'\n')
expected = np.array(proposal['routeEstimate']['distanceMatrixMeters'])
assert np.max(abs(d-expected)) < .051, '保存した概算値を再現'
result = {'status': '配置案の概算検査成功・実走前', 'terrainUnchanged': True,
          'bases': 2, 'plants': 5, 'plantSpacingMinimumMeters': round(min(Point(p['at']).distance(Point(q['at'])) for i,p in enumerate(proposal['plants']) for q in proposal['plants'][i+1:]), 1),
          'centralBaseRouteMeters': {'B': round(d[0, 4], 1), 'R': round(d[1, 4], 1)},
          'firstPlantRouteMeters': {'B': round(d[0, 2], 1), 'R': round(d[1, 6], 1)},
          'bridgeRepairsAssumed': 2, 'landmarkRemoval': False,
          'allPointsConnectedInPlannedGroundGrid': True, 'recordedDistancesReproduced': True,
          'actualMovementTested': False, 'botBattleTested': False}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(result, ensure_ascii=False))
