"""遊びに寄与しない地面の凹凸と線路間の細溝を、試走版で省く。"""
import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box

from simplify import clip_footprint, extrusion, parts, projection, rings
import rail_shops


def floor_mesh(footprint, height):
    meshes = []
    for p in parts(footprint):
        a = extrusion(p, height-.2, height, False).reshape(-1, 3, 3)
        meshes.append(a[np.all(np.isclose(a[:, :, 1], height), axis=1)].reshape(-1, 3))
    return np.concatenate(meshes) if meshes else np.empty((0, 3), dtype='<f4')


def flatten_ground(meshes, land, spec):
    """街区の床を一平面にする。道路の輪郭と川の欠測境界は別々に保持する。"""
    before = {k: len(meshes[k])//3 for k in ['dem', 'tran']}
    roads = projection(meshes['tran'], precision=.001)
    # 40cm以下の舗装輪郭も丸める。河岸・外周は元の陸地で再度切る。
    roads = roads.simplify(spec['roadOutlineTolerance'], preserve_topology=True).intersection(land)
    meshes['dem'] = floor_mesh(land, spec['height'])
    meshes['tran'] = floor_mesh(roads, spec['height'])
    return {**spec, 'beforeTriangles': before,
            'afterTriangles': {k: len(meshes[k])//3 for k in before}}


def unify_ground(meshes, river, spec):
    """生成に使った舗装・空地の区分を捨て、試走へ渡す平らな床を一面にまとめる。"""
    keys = ['dem','tran','streets','plazas','fill']
    before = sum(len(meshes[k])//3 for k in keys)
    old = projection(np.concatenate([meshes[k] for k in keys]),precision=.001)
    # 意味のある高低差・復帰斜面は別の面として残し、平面を重ねない。
    graded = projection(np.concatenate([meshes[k] for k in ['historicGround','ramps','aprons']]),precision=.001)
    dry = box(-300,-300,300,300).difference(river)
    flat = dry.difference(graded)
    assert flat.symmetric_difference(old).area<1, '床の統合で通行域を変えない'
    assert flat.intersection(river).area<.01 and flat.intersection(graded).area<.01, '川や斜面へ平面を重ねない'
    meshes['dem'] = floor_mesh(flat,spec['height'])
    for k in keys[1:]: meshes[k] = np.empty((0,3),dtype='<f4')
    return {'height':spec['height'],'color':spec['color'],'beforeTriangles':before,
            'afterTriangles':len(meshes['dem'])//3,'flatArea':round(flat.area,2),'layersBefore':len(keys),'layersAfter':1}


def clear_bases(meshes, volumes, land, profile, bases, building_kinds):
    """赤枠の陸地だけを更地にする。川へ張り出す枠も水域を増築しない。"""
    areas = []; outlines = []; floors = []
    # 既に地面で閉じてある外周の小欠けにも、建物の薄い端片を残さない。
    dry_land = land.union(projection(meshes['fill'], precision=.001))
    for spec in profile['baseClearings']:
        outline = Polygon(spec['outline']); p = outline.intersection(dry_land)
        base = next(b for b in bases if b['team'] == spec['team'])
        assert p.covers(Point(*base['at']).buffer(base['radius']+2)), '基地の円形床を整地の中へ収める'
        outlines.append(outline); floors.append(floor_mesh(p, base['height']))
        areas.append({'team': spec['team'], 'height': base['height'], 'area': round(p.area, 2),
                      'rings': [rings(piece) for piece in parts(p)]})
    clear = shapely.union_all(outlines)
    updated = []; removed = []
    for v in volumes:
        if v['kind'] not in building_kinds:
            updated.append(v); continue
        p = shapely.make_valid(Polygon(v['rings'][0], v['rings'][1:]))
        if p.intersection(clear).area > .01:
            removed.append({'kind': v['kind'], 'area': round(p.intersection(clear).area, 2),
                            'top': v['top'], 'landmark': v.get('landmark')})
        for piece in parts(shapely.set_precision(p.difference(clear), .001)):
            if piece.area > .05: updated.append({**v, 'rings': rings(piece)})
    volumes[:] = updated
    allowed = box(-300, -300, 300, 300).difference(clear)
    for k in ['dem', 'tran', 'streets', 'fill']: meshes[k] = clip_footprint(meshes[k], allowed)
    meshes['plazas'] = np.concatenate(floors)
    return {'areas': areas, 'removedBuildings': removed}


def join_railways(meshes, volumes, land, profile):
    """線路間は上を緩い接続床、下を店舗帯にする。道路横断と川底は塞がない。"""
    decks = {v['line']: Polygon(v['rings'][0], v['rings'][1:])
             for v in volumes if v['kind'] == 'rail-deck'}
    local, express = decks['local'], decks['highspeed']
    levels = {v['line']: v['top'] for v in volumes if v['kind'] == 'rail-deck'}
    steps = sorted({-300., 300., *[max(-300., min(300., z)) for p in [local, express]
                                  for _, z in p.exterior.coords]})
    edges = []
    for z in steps:
        line = LineString([(-300, z), (300, z)])
        left, right = local.intersection(line), express.intersection(line)
        assert not left.is_empty and not right.is_empty, '線路が両端まで続く'
        edges.append((left.bounds[2], right.bounds[0], z))
    footprint = Polygon([(a, z) for a, b, z in edges]+[(b, z) for a, b, z in reversed(edges)])
    thickness = profile['railGap']['thickness']
    triangles = []
    for n, ((a, b, z), (c, d, zz)) in enumerate(zip(edges, edges[1:])):
        if zz-z < .001: continue
        top = np.array([[a, levels['local'], z], [b, levels['highspeed'], z],
                        [c, levels['local'], zz], [d, levels['highspeed'], zz]])
        # 上面は上向き。下面・四周も描画と接触判定で同じ厚さにする。
        triangles.extend(top[[0, 2, 1, 1, 2, 3]])
        bottom = top.copy(); bottom[:, 1] -= thickness
        triangles.extend(bottom[[0, 1, 2, 1, 3, 2]])
        sides = [(1, 3), (2, 0)]
        if n == 0: sides.append((0, 1))
        if n == len(edges)-2: sides.append((3, 2))
        for i, j in sides:
            triangles.extend([top[i], top[j], bottom[i], top[j], bottom[j], bottom[i]])
    meshes['brid'] = np.concatenate([meshes['brid'], np.array(triangles, dtype='<f4')])
    # 元の細い棟片を新しい床や店舗の内部へ残さない。
    kept = []; removed = 0
    for v in volumes:
        if v['kind'] not in {'grounded', 'infill', 'upper', 'elevated'}:
            kept.append(v); continue
        p = Polygon(v['rings'][0], v['rings'][1:])
        if p.intersection(footprint).area > .01: removed += 1
        for piece in parts(p.difference(footprint)):
            if piece.area > .05: kept.append({**v, 'rings': rings(piece)})
    volumes[:] = kept
    roads = projection(np.concatenate([meshes['tran'], meshes['streets']]), precision=.001)
    raw = footprint.buffer(1, join_style='mitre').intersection(land).difference(roads.buffer(profile['shopRoadClearance']))
    blocks = [p for p in parts(raw) if p.area >= 1]
    shops, colors, extra, stats = rail_shops.build({'link': blocks},
        {'link': {'top': levels['local'], 'thickness': thickness}}, meshes['dem'], {'frontage': 10}, 300)
    meshes['railLinkShops'] = shops; volumes.extend(extra)
    return {'rings': rings(footprint), 'area': round(footprint.area, 2), 'shops': stats,
            'levels': [levels['local'], levels['highspeed']], 'thickness': thickness,
            'removedBuildingPieces': removed}, colors
