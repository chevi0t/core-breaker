#!/usr/bin/env python3
"""確認済みPLATEAU都市を配置資料に、街区単位のゲーム用形状を別案として作る。"""
import argparse
import base64
import copy
import gzip
import hashlib
import json
import pathlib
import re
import subprocess

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon, box

from build_trial import ROOT, build
from simplify import parts, rings
from trial_district import BUILDINGS, shape


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def read_reference(folder):
    html = (folder/'index.html').read_text()
    match = re.search(r'const CITY = await createCityTrial\(T,"([^"]+)"\)', html)
    data = json.loads(gzip.decompress(base64.b64decode(match[1])))
    assert data['geometryEncoding'] == 'volume-pool-v1', '参照版の符号化を確認する'
    pool, known = [], set()
    for v in data['volumes']:
        for ring in v['rings']:
            for x, z in ring:
                for y in [v['bottom'], v['top']]:
                    row = np.array([x, y, z], dtype='<f4')
                    if row.tobytes() not in known:
                        known.add(row.tobytes()); pool.append(row)
    pool = np.array(pool, dtype='<f4')
    arrays = {}
    for k, v in data['meshes'].items():
        extra = np.frombuffer(base64.b64decode(v['extra']), dtype='<f4').reshape(-1, 3)
        ids = np.frombuffer(base64.b64decode(v['indices']), dtype='<u2' if v['indexBytes'] == 2 else '<u4')
        arrays[k] = np.concatenate([pool, extra])[ids]
    return data, arrays


def outline(p, tolerance):
    """細い凹凸と閉じた中庭を省き、道路側への張り出しを抑えて10cm格子へそろえる。"""
    p = Polygon(p.exterior)
    q = p.simplify(tolerance, preserve_topology=True)
    q = q.intersection(p.buffer(.2, join_style='mitre')).simplify(.04, preserve_topology=True)
    snapped = shapely.set_precision(shapely.make_valid(q), .1)
    return shapely.union_all([Polygon(piece.exterior) for piece in parts(snapped)])


def volume(p, bottom, top, kind, **meta):
    return dict(kind=kind, bottom=bottom, top=top, rings=rings(p), **meta)


def reconstruct_buildings(reference):
    source = reference['volumes']; result = []; ordinary = []
    landmarks = {v['id']: v for v in reference['landmarks']}
    # 目印の棟は色・配置・主要高さを優先し、屋上の細かい階段状の段をひとつにする。
    for key in landmarks:
        group = [v for v in source if v.get('landmark') == key]
        grounded = [shape(v) for v in group if v['kind'] == 'grounded']
        assert grounded, f'目印の基部: {key}'
        top = max(v['top'] for v in group)
        # パッドの着地点は維持し、そこより高い小さな屋上突起は省略する。
        for pad in reference['district']['roofPads']:
            if shapely.union_all(grounded).covers(shapely.Point(*pad['exit'][:2])):
                top = pad['exit'][2]
        for p in parts(shapely.union_all(grounded)):
            for q in parts(outline(p, 1.2)):
                result.append(volume(q, -2.5, top, 'grounded',
                    landmark=key, landmarkColor=landmarks[key]['color'], facade=landmarks[key]['style']))
    for v in source:
        if v.get('landmark'): continue
        if v['kind'] not in BUILDINGS:
            # 駅の屋根・支柱・高架・店舗は上下関係を維持する。
            q = shape(v).simplify(.12, preserve_topology=True)
            for p in parts(q):
                kept = {k: val for k, val in v.items() if k not in ['rings', 'area']}
                result.append({**kept, 'rings': rings(p)})
        elif v.get('blockId') or v.get('repairId'):
            result.append(copy.deepcopy(v))
        elif v['kind'] in {'grounded', 'infill'}:
            ordinary.append(v)
        # 普通の棟の屋上小物・薄い張り出しは作り直さず省略する。
    polys = [shape(v) for v in ordinary]
    tree = shapely.STRtree(polys)
    merged = sorted(parts(shapely.union_all(polys)), key=lambda p: (p.centroid.x, p.centroid.y))
    for i, p in enumerate(merged):
        if p.area < 35: continue
        matches = tree.query(p, predicate='intersects')
        weights = [(ordinary[j]['top'], p.intersection(polys[j]).area) for j in matches]
        # 面積のある高さを使う。小屋根一枚を街区全体の高さへ拡大しない。
        weights.sort(); total = sum(w for _, w in weights); cumulative = 0
        for top, weight in weights:
            cumulative += weight
            if cumulative >= total*.65: break
        top = max(10, round(top/3)*3)
        for q in parts(outline(p, 2.0)):
            if q.area >= 20:
                result.append(volume(q, -2.5, top, 'grounded', rebuildId=i+1))
    return result, {'ordinarySourceVolumes':len(ordinary), 'sourceComponents':len(merged),
                    'ordinaryRebuiltVolumes':sum('rebuildId' in v for v in result)}


def pack_surface(a):
    # 斜面・橋・護岸だけは独立した面として残す。1cm格子の座標と参照番号を保存する。
    quantized = np.rint(a/.01).astype(np.int64)
    assert abs(quantized).max(initial=0) < 32768
    points, ids = np.unique(quantized, axis=0, return_inverse=True)
    assert len(points) < 65536
    return {'points':base64.b64encode(points.astype('<i2').tobytes()).decode(),
            'indices':base64.b64encode(ids.astype('<u2').tobytes()).decode(), 'step':.01}


def pack_rings(value):
    result = []
    for ring in value:
        coordinates = np.rint(np.array(ring)*100).astype(np.int64)
        assert abs(coordinates).max() < 32768
        result.append(base64.b64encode(coordinates.astype('<i2').tobytes()).decode())
    return result


def make_layout(reference, arrays, *, reconstructed=None):
    data = {k:copy.deepcopy(reference[k]) for k in ['half', 'spawns', 'district', 'landmarks',
                                                  'streetRepairs', 'heritage', 'river', 'groundMaximum']}
    volumes, stats = reconstruct_buildings(reference) if reconstructed is None else reconstructed
    data.update(geometryEncoding='city-layout-v1', volumes=volumes, surfaces={}, decorations=[])
    # 街路と川を保つ面は、確認済みの形からコピーする。細部の屋根や店舗パネルはコピーしない。
    excluded = {'bldg', 'rail', 'station', 'shops', 'crossShops', 'railLinkShops'}
    for k, a in arrays.items():
        if k not in excluded | {'bed', 'water'}:
            data['surfaces'][k] = pack_surface(a)
    rail_profile = json.loads((ROOT/'research/maps/akihabara-rail.json').read_text())
    bounds = box(-300, -300, 300, 300)
    for spec in rail_profile['lines']:
        line = LineString(spec['points'])
        # 線路は薄い面の色帯。細い壁や枕木を接触形状へ増やさない。
        for track in spec['tracks']:
            path = line.offset_curve(track)
            for offset, width, y, color in [(0, 2.1, .03, '#59636b'),
                                           (-.65, .12, .05, '#d2d7da'), (.65, .12, .05, '#d2d7da')]:
                p = path.offset_curve(offset).buffer(width, cap_style='flat', join_style='mitre').intersection(bounds)
                for q in parts(p):
                    data['decorations'].append({'rings':rings(q), 'height':spec['top']+y, 'color':color})
    for landmark in data['landmarks']:
        landmark['volumes'] = sum(v.get('landmark') == landmark['id'] for v in volumes)
    data['packing'] = {'encoding':'city-layout-v1', 'layers':{k:{'triangles':0} for k in arrays},
                       'surfaceCoordinateStep':.01, 'buildingCoordinateStep':.1}
    stats.update(sourceVolumes=len(reference['volumes']), rebuiltVolumes=len(volumes),
                 sourceBuildingVolumes=sum(v['kind'] in BUILDINGS for v in reference['volumes']),
                 rebuiltBuildingVolumes=sum(v['kind'] in BUILDINGS for v in volumes),
                 sourceTriangles=sum(v['triangles'] for v in reference['packing']['layers'].values()))
    # 大きな更地化前の輪郭など、生成経過の診断値は参照版のgeneration.jsonへ残す。
    # このJSONはゲームで必要な配置と、実走用の代表経路だけを持つ。
    data['district'].pop('clearing', None)
    data['streetRepairs'] = []
    kinds = sorted({v['kind'] for v in volumes})
    data['volumeKinds'] = kinds
    data['volumes'] = [[kinds.index(v['kind']), v['bottom'], v['top'], pack_rings(v['rings']),
                        {k:val for k,val in v.items() if k not in ['kind','bottom','top','rings']}]
                       for v in volumes]
    for decoration in data['decorations']:
        decoration['rings'] = pack_rings(decoration['rings'])
    # 配置を展開する実際のThree.jsで面数を測る。量子化後の共線点の扱いを
    # Python版Earcutの予測値と混ぜない。描画器やGPUは立ち上げない。
    measure = """
const fs=require('node:fs'),T=require(process.argv[1]);
const expand=new Function(fs.readFileSync(process.argv[2],'utf8')+';return expandCityLayout;')();
const d=JSON.parse(fs.readFileSync(0,'utf8'));expand(T,d);
console.log(JSON.stringify(Object.fromEntries(Object.entries(d.meshes).map(([k,v])=>[k,{triangles:Buffer.from(v,'base64').length/36}]))));
"""
    measured = subprocess.run(['node','-e',measure,str(ROOT/'vendor/three-r128/three.min.js'),
                              str(ROOT/'tools/plateau/rebuild_runtime.js')],input=compact(data),
                              capture_output=True,check=True)
    data['packing']['layers'] = json.loads(measured.stdout)
    stats['rebuiltTriangles'] = sum(v['triangles'] for v in data['packing']['layers'].values())
    return data, stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference',type=pathlib.Path)
    parser.add_argument('output',type=pathlib.Path)
    parser.add_argument('--maximum-bytes',type=int,default=100_000,help='gzip前の街データJSONの上限')
    args = parser.parse_args()
    reference, arrays = read_reference(args.reference)
    data, stats = make_layout(reference, arrays)
    raw = compact(data); packed = gzip.compress(raw, compresslevel=9, mtime=0)
    # 容量超過時は黙ってgzipの容量へ目標を読み替えない。
    if len(raw) > args.maximum_bytes:
        raise ValueError(f'街データが目標を超過: {len(raw)} > {args.maximum_bytes} bytes')
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'layout.json').write_bytes(raw)
    (args.output/'layout.json.gz').write_bytes(packed)
    build(ROOT/'mapdesign/akihabara_city/rail', args.output, data=data,
          layout_runtime=(ROOT/'tools/plateau/rebuild_runtime.js').read_text(), variant=True)
    stats.update(layoutBytes=len(raw),gzipBytes=len(packed),base64Bytes=len(base64.b64encode(packed)),
                 maximumBytes=args.maximum_bytes,
                 referenceHTMLSHA256=hashlib.sha256((args.reference/'index.html').read_bytes()).hexdigest(),
                 layoutSHA256=hashlib.sha256(raw).hexdigest(),
                 builderSHA256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
                 layoutRuntimeSHA256=hashlib.sha256((ROOT/'tools/plateau/rebuild_runtime.js').read_bytes()).hexdigest(),
                 railProfileSHA256=hashlib.sha256((ROOT/'research/maps/akihabara-rail.json').read_bytes()).hexdigest(),
                 threeSHA256=hashlib.sha256((ROOT/'vendor/three-r128/three.min.js').read_bytes()).hexdigest(),
                 htmlBytes=(args.output/'index.html').stat().st_size)
    (args.output/'reconstruction.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(stats,ensure_ascii=False,indent=2))


if __name__ == '__main__': main()
