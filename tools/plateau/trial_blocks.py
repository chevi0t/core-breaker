"""ユーザー指定の路地拡幅・北東街区の集約・高架脇の落とし穴を加工する。"""
import numpy as np
import shapely
from shapely.geometry import LineString, Polygon, box

from simplify import clip_footprint, parts, projection, rings
from trial_simplify import floor_mesh

BUILDINGS = {'grounded', 'infill', 'upper', 'elevated'}


def shape(v):
    return shapely.make_valid(Polygon(v['rings'][0], v['rings'][1:]))


def cut_buildings(volumes, mask, minimum_width=0):
    kept = []; removed = 0
    for v in volumes:
        if v['kind'] not in BUILDINGS:
            kept.append(v); continue
        p = shape(v)
        if p.intersection(mask).area > .01: removed += 1
        for piece in parts(p.difference(mask)):
            if minimum_width and p.intersects(mask) and piece.buffer(-minimum_width/2).is_empty: continue
            if piece.area > .05: kept.append({**v, 'rings': rings(piece)})
    volumes[:] = kept
    return removed


def reshape(meshes, volumes, land, profile):
    """高架の両脇は建物側を削り、指定した街区だけを10棟へまとめる。"""
    spec = profile['sideAlleys']; height = profile['groundSimplification']['height']
    deck = shapely.union_all([shape(v) for v in volumes if v['kind']=='rail-deck' and v['line']=='cross'])
    bounds = box(spec['x'][0], -60, spec['x'][1], 60)
    alley = deck.buffer(spec['width'], join_style='mitre').difference(deck).intersection(bounds).intersection(land)
    removed = cut_buildings(volumes, alley)
    # 追加の歩行帯は車道と同じ舗装色にし、地面を重ねず一枚の床にする。
    old_streets = clip_footprint(meshes['streets'], box(-300,-300,300,300).difference(alley))
    for k in ['dem','tran']: meshes[k] = clip_footprint(meshes[k], box(-300,-300,300,300).difference(alley))
    meshes['streets'] = np.concatenate([old_streets, floor_mesh(alley, height)])
    spine = LineString(profile['sideAlleys']['centerline'])
    routes = []
    for side in [-1,1]:
        line = spine.offset_curve(side*(9+spec['width']/2), join_style='mitre')
        routes.append({'side':side, 'points':list(map(list,line.coords))})

    spec = profile['mergedBlock']; zone = Polygon(spec['outline'])
    old_count = cut_buildings(volumes, zone, minimum_width=5)
    blocks = []
    for row, (z0,z1) in enumerate(spec['rows']):
        for col, (x0,x1) in enumerate(spec['columns']):
            p = zone.buffer(-spec['setback'],join_style='mitre').intersection(box(x0,z0,x1,z1))
            assert p.geom_type=='Polygon' and p.area>100 and not p.interiors, '集約棟に細片や中庭穴を作らない'
            name = f'ne-{row+1}-{col+1}'; top = spec['heights'][row*2+col]
            v = {'kind':'grounded','blockId':name,'bottom':height-.5,'top':top,'rings':rings(p)}
            volumes.append(v); blocks.append({'id':name,'height':top,'rings':rings(p)})
    assert len(blocks)==10, '指定した北東街区を10棟にする'
    paved = zone.difference(shapely.union_all([Polygon(v['rings'][0]) for v in blocks]))
    allowed = box(-300,-300,300,300).difference(paved)
    for k in ['dem','tran']: meshes[k] = clip_footprint(meshes[k],allowed)
    meshes['streets'] = np.concatenate([clip_footprint(meshes['streets'],allowed),floor_mesh(paved,height)])
    return {'alleys':{'width':profile['sideAlleys']['width'],'rings':[rings(p) for p in parts(alley)],
                      'routes':routes,'cutBuildingPieces':removed},
            'mergedBlock':{'rings':rings(zone),'beforePieces':old_count,'buildings':blocks}}


def close_pockets(volumes, land, profile):
    """機体幅を考慮して地上の孤立空間を探し、指定範囲だけ高架の床まで埋める。"""
    spec = profile['pocketRepair']; radius = 1.35
    solid = shapely.union_all([shape(v) for v in volumes if v['bottom']<2 and v['top']>-.3])
    free = land.difference(solid).buffer(-radius)
    target = box(*spec['bounds']); fixes = []
    for p in parts(free):
        if p.area>spec['maximumArea'] or p.intersection(target).area<5: continue
        # 隣の壁へ少し重ね、機体が落ちる縁の細溝を残さない。
        footprint = p.buffer(radius+.2,join_style='mitre').intersection(land)
        center = p.representative_point()
        volumes.append({'kind':'grounded','repairId':'rail-pocket','bottom':profile['groundSimplification']['height']-.5,
                        'top':spec['height'],'rings':rings(footprint)})
        fixes.append({'rings':rings(footprint),'height':spec['height'],'previousSafeArea':round(p.area,2),
                      'sample':[center.x,center.y]})
    assert fixes, '指摘された孤立空間を検出してから埋める'
    return fixes
