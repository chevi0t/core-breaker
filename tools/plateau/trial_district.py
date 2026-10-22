"""試走で指摘された路地・東西店舗・基地広場・高層棟への登り口を加工する。"""
import math
import heapq
import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points

from simplify import clip_footprint, extrusion, parts, projection, rings, vertical_height
import rail_shops
from trial_simplify import clear_bases

BUILDINGS = {'grounded', 'infill', 'upper', 'elevated'}


def shape(v):
    return shapely.make_valid(Polygon(v['rings'][0], v['rings'][1:]))


def refine(meshes, volumes, land, profile, rail_gap):
    roads = projection(np.concatenate([meshes['tran'],meshes['streets']]), precision=.001)
    occupied = shapely.union_all([shape(v) for v in volumes
        if v['kind'] != 'infill' and v['bottom'] < 3 and v['top'] > 3])
    radius = profile['minimumPassageWidth'] / 2
    # 建物そのものは広げ直さず、元の空地で幅5mを確保でき、道路につながる充填だけを除く。
    core = land.difference(occupied).buffer(-radius, quad_segs=2, join_style='mitre')
    road_core = roads.buffer(-radius, quad_segs=2)
    connected = [p for p in parts(core) if p.intersection(road_core).area > 10]
    corridor_core = shapely.union_all(connected)
    reopen = corridor_core.buffer(radius, quad_segs=2, join_style='mitre')
    old_infill = shapely.union_all([shape(v) for v in volumes if v['kind'] == 'infill'])
    restored = old_infill.intersection(reopen)
    updated = []
    for v in volumes:
        if v['kind'] != 'infill':
            updated.append(v)
            continue
        remaining = shapely.set_precision(shape(v).difference(reopen).simplify(.08, preserve_topology=True), .001)
        for p in parts(remaining):
            if p.area >= .05:
                updated.append({**v, 'rings': rings(p)})
    volumes[:] = updated

    # 東西線の下も店舗にする。地上道路・川と、下を横切る南北線の走行空間は残す。
    decks = {v['line']: shape(v) for v in volumes if v['kind'] == 'rail-deck'}
    # 南北店舗の張り出し1mと接続し、交差部に機体が入れない細溝を作らない。
    protected = shapely.union_all([p.buffer(1,join_style='mitre') for p in
        [*[p for k,p in decks.items() if k != 'cross'],Polygon(rail_gap['rings'][0])]])
    raw = decks['cross'].intersection(land).difference(roads.buffer(profile['shopRoadClearance'])).difference(protected)
    footprints = {'cross': [piece for p in parts(raw) for piece in parts(p.simplify(.1, preserve_topology=True).intersection(raw)) if piece.area >= 30]}
    shop_solid = shapely.union_all(footprints['cross'])
    assert shop_solid.intersection(roads.buffer(profile['shopRoadClearance'])).area < 1, '店舗で道路を塞がない'
    assert shop_solid.intersection(protected).area < 1 and shop_solid.difference(land).area < 1, '店舗で南北線と川を塞がない'
    shops, colors, shop_volumes, shop_stats = rail_shops.build(footprints,
        {'cross': {'top': 18, 'thickness': 1.5}}, meshes['dem'], {'frontage': 10}, 300)
    meshes['crossShops'] = shops
    volumes.extend(shop_volumes)

    def ground(x, z):
        return max(h for k in ['dem', 'tran', 'plazas','streets','historicGround'] if k in meshes and (h := vertical_height(meshes[k], x, z)) is not None)

    bases = []
    for spec in profile['bases']:
        x, z = spec['at']; r = spec['radius']; y = ground(x, z)
        plaza = Point(x, z).buffer(r + 2, quad_segs=8)
        assert land.covers(plaza), '基地を川やステージ外へ置かない'
        bases.append({**spec, 'height': y, 'spawn': [x, y, z + (18 if spec['team'] == 'B' else -18)]})
    clearing = clear_bases(meshes, volumes, land, profile, bases, BUILDINGS)

    pads = []
    for spec in profile['roofPads']:
        x, z = spec['at']; ex, ez = spec['exit']
        roof = max(v['top'] for v in volumes if v['kind'] in BUILDINGS and shape(v).covers(Point(ex, ez)))
        y = ground(x, z)
        blocking=[(v['kind'], shape(v).bounds) for v in volumes if v['bottom'] < y+4 and v['top'] > y+.3 and Point(x,z).buffer(3.5).intersects(shape(v))]
        assert not blocking, f'ジャンプパッドに機体が立てること: {spec}, {blocking}'
        pads.append({**spec, 'at': [x, z, y], 'exit': [ex, ez, roof], 'radius': 3, 'rise': roof-y+spec['riseAboveRoof']})

    # 実走検査用に、元は充填に埋まっていた区間を通る代表経路を採る。
    passages = []
    final_solid = shapely.union_all([shape(v) for v in volumes if v['bottom'] < 3 and v['top'] > 3])
    safe = land.difference(final_solid).buffer(-1.5, quad_segs=2)
    for p in sorted(parts(restored), key=lambda p: -p.area):
        if p.area < 4: continue
        point = nearest_points(p.representative_point(), corridor_core)[1]
        if any(point.distance(Point(v['center'])) < 35 for v in passages): continue
        choices = []
        for angle in np.arange(0, math.pi, math.pi/8):
            dx, dz = math.cos(angle)*12, math.sin(angle)*12
            line = LineString([(point.x-dx, point.y-dz), (point.x+dx, point.y+dz)])
            for segment in getattr(line.intersection(safe), 'geoms', [line.intersection(safe)]):
                if segment.geom_type != 'LineString' or segment.length < 10: continue
                middle = segment.interpolate(.5, normalized=True)
                if not old_infill.intersects(middle.buffer(1.3)): continue
                a, b = [segment.interpolate(f, normalized=True) for f in [.1, .9]]
                if not land.covers(segment) or any(Point(v['at']).distance(segment) < v['radius']+3 for v in bases): continue
                ay, by = ground(a.x, a.y), ground(b.x, b.y)
                if abs(ay-by) > .5: continue
                choices.append((segment.length, [a.x, ay, a.y], [b.x, by, b.y], [middle.x, middle.y]))
        if choices:
            _, a, b, center = max(choices)
            passages.append({'start': a, 'end': b, 'center': center})
        if len(passages) >= 12: break
    assert len(passages) >= 8, '路地の実走確認地点が不足'
    return {'minimumPassageWidth': radius*2, 'reopenedArea': round(restored.area, 2),
        'remainingInfillAreaBeforeBaseClearing': round(old_infill.difference(reopen).area, 2),
        'passages': passages, 'shops': shop_stats, 'bases': bases, 'roofPads': pads, 'clearing': clearing}, colors


def mark_landmarks(volumes, specs):
    """研究用の施設点をPLATEAUの棟に照合。実名・出典は表示データへ持ち込まない。"""
    grounded=[v for v in volumes if v['kind']=='grounded']
    result=[]
    for spec in specs:
        point=Point(*spec['at'])
        seed=min(grounded,key=lambda v:(shape(v).distance(point),-shape(v).area))
        footprint=shape(seed)
        assert footprint.distance(point)<3, f'ランドマークを別の棟へ割り当てない: {spec["id"]}'
        count=0
        for v in volumes:
            if v['kind'] not in BUILDINGS or v['kind']=='infill':continue
            p=shape(v)
            if p.intersection(footprint).area/p.area<.65:continue
            v.update(landmark=spec['id'],landmarkColor=spec['color'],facade=spec.get('style','solid'))
            count+=1
        result.append({'id':spec['id'],'at':spec['at'],'color':spec['color'],'style':spec.get('style','solid'),
            'bounds':list(footprint.bounds),'volumes':count})
    return result


def building_colors(meshes, volumes):
    """棟ごとの落ち着いた配色。屋根と窓の帯は描画側で同じ材質のまま付ける。"""
    palette = ['#889da8', '#a69f90', '#aab0ae', '#7f929a', '#9d9181', '#8b8785', '#8c9da0', '#a6a39b']
    meshes_out, ranges, cursor = [], [], 0
    for v in volumes:
        if v['kind'] not in BUILDINGS: continue
        p = shape(v); a = extrusion(p, v['bottom'], v['top'], v['kind'] not in {'grounded', 'infill'})
        center = p.centroid
        seed = abs(round(center.x*7) + round(center.y*13))
        color = '#7b94a0' if v['top'] > 50 else palette[seed % len(palette)]
        color = v.get('landmarkColor',color)
        meshes_out.append(a); ranges.append({'start': cursor, 'count': len(a), 'color': color,'glass':v.get('facade')=='glass'}); cursor += len(a)
    meshes['bldg'] = np.concatenate(meshes_out)
    return ranges


def access_routes(meshes, volumes, land, district):
    """基地から乗り場へ、機体の幅を残した地上経路を探す。Bot経路の確定ではない。"""
    solid = shapely.union_all([shape(v) for v in volumes if v['bottom'] < 3 and v['top'] > -1])
    free = land.difference(solid).buffer(-1.6, quad_segs=2)
    shapely.prepare(free)
    result=[]
    for base in district['bases']:
        pad=next((p for p in district['roofPads'] if p['team']==base['team']), None)
        if pad is None: continue  # 更地になった屋上へ向かうパッドは置かない。
        a=(base['spawn'][0],base['spawn'][2]); b=(pad['at'][0],pad['at'][1])
        start=tuple(round(c/2) for c in a); target=tuple(round(c/2) for c in b)
        queue=[(0,0,start)];cost={start:0};previous={};found=False
        while queue:
            _,g,node=heapq.heappop(queue)
            if node==target:found=True;break
            if g>cost[node]+1e-6:continue
            for dx,dz in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
                other=(node[0]+dx,node[1]+dz)
                if not free.covers(LineString([(node[0]*2,node[1]*2),(other[0]*2,other[1]*2)])):continue
                ng=g+math.hypot(dx,dz)
                if ng>=cost.get(other,float('inf')):continue
                cost[other]=ng;previous[other]=node
                heapq.heappush(queue,(ng+math.hypot(other[0]-target[0],other[1]-target[1]),ng,other))
        assert found, f'基地からジャンプパッドへ地上でたどり着けない: {base["team"]}'
        nodes=[target]
        while nodes[-1]!=start:nodes.append(previous[nodes[-1]])
        path=[a,*[(x*2,z*2) for x,z in reversed(nodes)],b];simple=[path[0]];cursor=0
        while cursor<len(path)-1:
            nxt=next(i for i in range(len(path)-1,cursor,-1) if free.covers(LineString([path[cursor],path[i]])))
            simple.append(path[nxt]);cursor=nxt
        at=[]
        for x,z in simple:
            y=max(h for k in ['dem','tran','plazas','ramps','aprons','streets','historicGround'] if (h:=vertical_height(meshes[k],x,z)) is not None)
            at.append([x,y,z])
        result.append({'team':base['team'],'points':at,'length':round(LineString(simple).length,2)})
    return result
