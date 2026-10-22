#!/usr/bin/env python3
"""OSM XML から平坦な市街地の開発用マップを作る。標高・屋内・地下は対象外。"""
import argparse
import hashlib
import json
import math
import pathlib
import re
import xml.etree.ElementTree as ET
from collections import defaultdict


def tags(element):
    return {t.get('k'): t.get('v') for t in element.findall('tag')}


def number(value, fallback=0):
    try:
        text = str(value).strip()
        match = re.fullmatch(r'(-?[0-9]+(?:\.[0-9]+)?)\s*(m|ft)?', text)
        return float(match[1]) * (.3048 if match[2] == 'ft' else 1) if match else fallback
    except (ValueError, TypeError):
        return fallback


def inside(x, z, polygon):
    result = False
    for (ax, az), (bx, bz) in zip(polygon, polygon[1:] + polygon[:1]):
        if (az > z) != (bz > z) and x < ax + (bx-ax)*(z-az)/(bz-az):
            result = not result
    return result


def rings(chains):
    """分割された multipolygon の辺を接続する。未閉鎖の輪郭は推測しない。"""
    pending = [list(c) for c in chains if len(c) >= 2]
    result = []
    while pending:
        current = pending.pop()
        while current[0] != current[-1]:
            for i, other in enumerate(pending):
                if current[-1] == other[0]:
                    current.extend(other[1:])
                elif current[-1] == other[-1]:
                    current.extend(other[-2::-1])
                elif current[0] == other[-1]:
                    current = other[:-1] + current
                elif current[0] == other[0]:
                    current = other[:0:-1] + current
                else:
                    continue
                pending.pop(i)
                break
            else:
                break
        if len(current) >= 4 and current[0] == current[-1]:
            result.append(current)
    return result


def rectangles(cells, cell):
    """同じ高さの連続セルを長方形へまとめる。表示と当たり判定は同じ箱。"""
    rows = defaultdict(dict)
    for (i, j), h in cells.items():
        rows[j][i] = h
    active, result = {}, []
    for j in range(min(rows, default=0), max(rows, default=-1)+2):
        row, runs, ordered = rows.get(j, {}), {}, sorted(rows.get(j, {}))
        k = 0
        while k < len(ordered):
            start = end = ordered[k]
            h = row[start]
            k += 1
            while k < len(ordered) and ordered[k] == end+1 and row[ordered[k]] == h:
                end = ordered[k]
                k += 1
            key = (start, end, h)
            runs[key] = active.pop(key, j)
        for (a, b, h), first in active.items():
            result.append([(a+b+1)*cell/2, (first+j)*cell/2,
                           (b-a+1)*cell, (j-first)*cell, h])
        active = runs
    return result


class Collision:
    def __init__(self, boxes):
        self.bins = defaultdict(list)
        for x, z, w, d, *_ in boxes:
            box = (x-w/2-2, x+w/2+2, z-d/2-2, z+d/2+2)
            for i in range(math.floor(box[0]/32), math.floor(box[1]/32)+1):
                for j in range(math.floor(box[2]/32), math.floor(box[3]/32)+1):
                    self.bins[i, j].append(box)

    def free(self, x, z):
        return not any(a <= x <= b and c <= z <= d for a,b,c,d in self.bins[math.floor(x/32), math.floor(z/32)])

    def walk(self, a, b):
        n = max(1, math.ceil(math.dist(a[:2], b[:2])/1.5))
        return all(self.free(a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n) for i in range(n+1))


def load_osm(source, center, rotation, half, cell):
    raw = pathlib.Path(source).read_bytes()
    if len(raw) > 32*1024*1024 or b'<!DOCTYPE' in raw or b'<!ENTITY' in raw:
        raise ValueError('OSM は32MB以下の通常の XML にしてください')
    root = ET.fromstring(raw)
    if root.tag != 'osm':
        raise ValueError('OSM XML が必要です（PBFや地図画像には未対応）')
    lon, lat = center
    c, s = math.cos(math.radians(rotation)), math.sin(math.radians(rotation))
    def project(node):
        x = math.radians(float(node.get('lon'))-lon)*6371008.8*math.cos(math.radians(lat))
        z = -math.radians(float(node.get('lat'))-lat)*6371008.8
        return (x*c-z*s, x*s+z*c)
    nodes = {e.get('id'): project(e) for e in root.findall('node')}
    ways = {e.get('id'): ([n.get('ref') for n in e.findall('nd')], tags(e)) for e in root.findall('way')}
    features, consumed, warnings = [], set(), []
    for relation in root.findall('relation'):
        t = tags(relation)
        if t.get('type') != 'multipolygon' or t.get('building', 'no') == 'no':
            continue
        chains = defaultdict(list)
        for m in relation.findall('member'):
            if m.get('type') == 'way' and m.get('ref') in ways:
                ref = m.get('ref')
                chains[m.get('role', 'outer') or 'outer'].append(ways[ref][0])
                consumed.add(ref)
        outer, inner = rings(chains['outer']), rings(chains['inner'])
        if not outer:
            warnings.append('未閉鎖の建物 relation/'+relation.get('id'))
        features.append(('relation/'+relation.get('id'), t, outer, inner))
    roads = []
    for ref, (nd, t) in ways.items():
        if t.get('highway') in {'primary','secondary','tertiary','residential','unclassified','service','pedestrian','living_street'}:
            if t.get('tunnel') not in {'yes','building_passage'} and number(t.get('layer'), 0) == 0 and t.get('bridge') != 'yes':
                points = [nodes[n] for n in nd if n in nodes]
                if len(points) == len(nd):
                    roads.append({'id':ref, 'points':points, 'kind':t['highway']})
        if ref not in consumed and (t.get('building','no') != 'no' or t.get('building:part','no') != 'no'):
            if len(nd) >= 4 and nd[0] == nd[-1]:
                features.append(('way/'+ref, t, [nd], []))
            else:
                warnings.append('未閉鎖の建物 way/'+ref)
    cells, buildings = {}, []
    for ref, t, outer, inner in features:
        if t.get('location') == 'underground' or t.get('building') == 'roof':
            continue
        if any(n not in nodes for r in outer+inner for n in r):
            warnings.append('節点不足の建物 '+ref)
            continue
        outer, inner = [[nodes[n] for n in r] for r in outer], [[nodes[n] for n in r] for r in inner]
        points = [p for r in outer for p in r]
        if not points:
            continue
        height = number(t.get('height'), number(t.get('building:levels'), 3)*3.5)
        if height <= 0 or height > 400:
            warnings.append('高さ範囲外の建物 '+ref)
            continue
        height = round(height, 1)
        x0, x1 = max(-half[0], min(p[0] for p in points)), min(half[0], max(p[0] for p in points))
        z0, z1 = max(-half[1], min(p[1] for p in points)), min(half[1], max(p[1] for p in points))
        count = 0
        for i in range(math.floor(x0/cell), math.ceil(x1/cell)):
            for j in range(math.floor(z0/cell), math.ceil(z1/cell)):
                x, z = (i+.5)*cell, (j+.5)*cell
                # 中庭と建物外の道を箱で埋めないよう、四隅と中心が内側のセルだけ使う。
                probes = [(x,z)]+[(x+dx*cell*.49,z+dz*cell*.49) for dx in [-1,1] for dz in [-1,1]]
                if all(any(inside(px,pz,r) for r in outer) and not any(inside(px,pz,r) for r in inner) for px,pz in probes):
                    cells[i,j] = max(cells.get((i,j),0), height)
                    count += 1
        if count:
            buildings.append({'id':ref,'height':height,'heightSource':'height' if 'height' in t else 'levels' if 'building:levels' in t else 'fallback', 'cells':count})
    return cells, roads, {'sourceHash':hashlib.sha256(raw).hexdigest(),'buildings':buildings,'warnings':warnings,
                          'center':center,'rotation':rotation,'cropHalf':half,'cell':cell}


def road_paint(roads, half, cell):
    cells={}
    widths={'primary':26,'secondary':20,'tertiary':16,'residential':12,'unclassified':12,
            'service':8,'pedestrian':10,'living_street':10}
    for road in roads:
        radius=widths[road['kind']]/2
        for (ax,az),(bx,bz) in zip(road['points'],road['points'][1:]):
            dx,dz=bx-ax,bz-az
            norm=dx*dx+dz*dz
            if norm<.01:continue
            x0,x1=max(-half[0],min(ax,bx)-radius),min(half[0],max(ax,bx)+radius)
            z0,z1=max(-half[1],min(az,bz)-radius),min(half[1],max(az,bz)+radius)
            for i in range(math.floor(x0/cell),math.ceil(x1/cell)):
                for j in range(math.floor(z0/cell),math.ceil(z1/cell)):
                    x,z=(i+.5)*cell,(j+.5)*cell
                    t=max(0,min(1,((x-ax)*dx+(z-az)*dz)/norm))
                    if math.hypot(x-ax-t*dx,z-az-t*dz)<=radius:
                        cells[i,j]=.025
    return [b+[.025] for b in rectangles(cells,cell)]


def navigation(boxes, half, extras):
    collision = Collision(boxes)
    nodes = [[x,z] for x in range(-int(half[0])+16,int(half[0]),32)
             for z in range(-int(half[1])+16,int(half[1]),32) if collision.free(x,z)]
    for x,z in extras:
        if collision.free(x,z) and all(math.dist([x,z],p)>2 for p in nodes):
            nodes.append([x,z])
    buckets = defaultdict(list)
    for i,p in enumerate(nodes):
        buckets[math.floor(p[0]/64),math.floor(p[1]/64)].append(i)
    links, adj = [], [[] for _ in nodes]
    for i,p in enumerate(nodes):
        for dx in [-1,0,1]:
            for dz in [-1,0,1]:
                for j in buckets[math.floor(p[0]/64)+dx,math.floor(p[1]/64)+dz]:
                    if j <= i or math.dist(p,nodes[j])>67 or not collision.walk(p,nodes[j]):
                        continue
                    links.append([i,j]); adj[i].append(j); adj[j].append(i)
    start = min(range(len(nodes)),key=lambda i:math.dist(nodes[i],extras[0]))
    seen, stack = {start}, [start]
    while stack:
        for j in adj[stack.pop()]:
            if j not in seen:
                seen.add(j);stack.append(j)
    for p in extras:
        if not any(math.dist(p,nodes[i])<67 and collision.walk(p,nodes[i]) for i in seen):
            raise ValueError(f'施設 {p} が通行経路から孤立しています')
    ordered = sorted(seen)
    remap = {old:new for new,old in enumerate(ordered)}
    return {'nodes':[nodes[i] for i in ordered], 'links':[[remap[a],remap[b]] for a,b in links if a in seen and b in seen]}


def make_map(source, center=(139.6918,35.68975), rotation=12, half=(300,350), cell=4):
    cells, roads, info = load_osm(source,center,rotation,half,cell)
    layout = [box+['office'] for box in rectangles(cells,cell)]
    if not layout:
        raise ValueError('指定した範囲に変換可能な建物がありません')
    # 地理情報を残し、両端の基地は街区外の専用敷地へ置く。
    base_z = math.ceil((half[1]+140)/10)*10
    arena = [half[0]+24, base_z+60]
    collision = Collision(layout)
    plants = [['A',0,half[1]+64,'B']]
    for label, tx, tz in [('B',-half[0]*.3,half[1]*.5),('C',half[0]*.267,0),('D',half[0]*.3,-half[1]*.5)]:
        candidates = []
        for x in range(-int(half[0])+24,int(half[0])-24,4):
            for z in range(int(tz)-90,int(tz)+91,4):
                if abs(z)>half[1]-55:
                    continue
                # 占拠円と両陣営の再出撃帯を先に確保する。
                if not all(collision.free(x+dx,z+dz) for dx,dz in [(0,0),(-17,0),(17,0),(0,-17),(0,17)]+[(dx,dz) for dx in [-10,0,10] for dz in [-54,-48,-42,42,48,54]]):
                    continue
                candidates.append((math.hypot(x-tx,z-tz),x,z))
        if not candidates:
            raise ValueError(f'プラント{label}の設置・再出撃を確保できません')
        _,x,z = min(candidates)
        plants.append([label,x,z,None])
    plants.append(['E',0,-half[1]-64,'R'])
    paint=road_paint(roads,half,cell)
    # 街区の外に設けた基地へ続く舗装路。地理データの道路とは区別する。
    approaches=[[x,s*(half[1]+base_z)/2,26,base_z-half[1],.025,.025] for x in [-65,65] for s in [-1,1]]
    paint.extend(approaches)
    on_road=lambda x,z:any(abs(x-rx)<=rw/2 and abs(z-rz)<=rd/2 for rx,rz,rw,rd,*_ in paint)
    # 大通りに置く車両・資材。全幅を塞がず、既存建物と出撃帯を避ける。
    covers=[]
    for tx,tz in [(-110,95),(110,-95),(-85,-75),(85,75),(-80,half[1]+5),(80,-half[1]-5)]:
        candidates=[]
        for dx in range(-64,65,4):
            for dz in range(-64,65,4):
                x,z=tx+dx,tz+dz
                if any(abs(x-px)<27 and (abs(z-pz)<27 or 38<abs(z-pz)<65) for _,px,pz,_ in plants):
                    continue
                if any(math.hypot(x-cx,z-cz)<40 for cx,cz,*_ in covers):continue
                if all(on_road(x+a,z+b) for a in [-5,0,5] for b in [-2,0,2]) and all(collision.free(x+a,z+b) for a in [-12,0,12] for b in [-12,0,12]):
                    candidates.append((math.hypot(dx,dz),x,z))
        if candidates:
            _,x,z=min(candidates);covers.append([x,z,12,5,4.5,'container'])
    layout.extend(covers)
    # 屋根の機器とジップラインは既存の橋床・昇降機構で作る。
    bridges,zips,roofs=[],[],[]
    collision=Collision(layout)
    for x,z,w,d,h,*_ in sorted(layout,key=lambda b:b[2]*b[3],reverse=True):
        if len(roofs)>=4:break
        if w<20 or d<20 or not 10<=h<=160 or abs(z)>half[1]-20:continue
        if any(math.hypot(x-r['center'][0],z-r['center'][1])<90 for r in roofs):continue
        choices=[]
        reach=max(12,h*.16)
        for sx,sz,ex,ez in [(x-w/2-reach,z,x-w/2-1,z),(x+w/2+reach,z,x+w/2+1,z),(x,z-d/2-reach,x,z-d/2-1),(x,z+d/2+reach,x,z+d/2+1)]:
            if abs(sx)>half[0]-10 or abs(sz)>half[1]-10 or not collision.free(sx,sz):continue
            if any(any(bx-bw/2-1<sx+(ex-sx)*t<bx+bw/2+1 and bz-bd/2-1<sz+(ez-sz)*t<bz+bd/2+1 and bh>h*t+.3
                       for bx,bz,bw,bd,bh,*_ in layout) for t in [i/40 for i in range(1,40)]):continue
            choices.append((sx,sz,ex,ez))
        if not choices:continue
        sx,sz,ex,ez=choices[0]
        bridges.append([x+4,z+4,7,5,h+3,3])
        zips.append({'from':[round(sx,2),round(sz,2),0],'to':[round(ex,2),round(ez,2),h]})
        roofs.append({'center':[x,z,h],'cover':[x+4,z+4,h+3]})
    # 両端の補給点は街の外の防壁内へ。地面全体は平坦に保つ。
    pods=[]
    for p in [plants[0],plants[-1]]:
        sign=1 if p[2]>0 else -1
        z=p[2]+32*sign
        pods.append([p[0],0,z])
        layout.extend([[0,z-9*sign,24,3,8,'baseWall'],[-13,z,3,20,8,'baseWall'],[13,z,3,20,8,'baseWall']])
        bridges.append([0,z,28,22,8,1])
    cats=[[-65,base_z-25,-90,half[1]+12],[65,base_z-25,90,half[1]+12]]
    extras=[[8,base_z-20],[8,-base_z+20]]
    extras += [[x+6,z+3] for _,x,z,_ in plants]
    extras += [[sx,sz] for sx,sz,_ in [d['from'] for d in zips]]
    extras += [[x*s,z*s] for x,z,_,_ in cats for s in [-1,1]]
    facilities = [[x,z,1.4,1.4,7] for _,x,z,_ in plants]
    facilities += [[0,s*base_z,12,12,16] for s in [-1,1]]
    facilities += [[x*s,z*s,3,3,3] for x,z in [[-36,base_z-38],[36,base_z-38],[-55,base_z+10]] for s in [-1,1]]
    nav=navigation(layout+facilities,arena,extras)
    info.update({'version':1,'theme':'osm','balance':'勝率未確定','buildingsCount':len(info['buildings']),
                 'buildingBoxes':len(layout)-len(covers)-6,'roadCover':covers,'roofs':roofs,
                 'roadWays':len(roads),'roadPaintBoxes':len(paint),'baseApproaches':[b[:4] for b in approaches], 'terrainMode':'flat'})
    data={'order':20,'name':'摩天街区','subtitle':'大通り争奪','asym':True,'batchBuildings':True,
          'size':arena,'team':10,'time':600,'baseZ':base_z,'baseLine':half[1]+8,
          'desc':'大通りと高層ビルが交差する市街地。道路の資材を遮蔽に使い、ジップラインから屋上へ進出する。地理データ © OpenStreetMap contributors / ODbL。',
          'terrain':[],'layout':layout,'plants':plants,'turrets':[[-36,base_z-38],[36,base_z-38]],
          'radar':[-55,base_z+10],'catapults':cats,'basePods':[[-21,base_z-20],[21,base_z-20]],
          'plantPods':pods,'barricades':[],'bridges':bridges,'roads':[b[:4] for b in paint], 'water':[],'ziplines':zips,'nav':nav,
          'attribution':{'text':'© OpenStreetMap contributors','url':'https://www.openstreetmap.org/copyright',
                         'license':'ODbL-1.0','sourceHash':info['sourceHash']},'generation':info}
    return data,roads


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=pathlib.Path)
    p.add_argument('--output',required=True,type=pathlib.Path)
    p.add_argument('--id',default='osm_city')
    p.add_argument('--center',nargs=2,type=float,default=[139.6918,35.68975],metavar=('LON','LAT'))
    p.add_argument('--rotation',type=float,default=12)
    p.add_argument('--half',nargs=2,type=float,default=[300,350])
    p.add_argument('--cell',type=int,default=4)
    args=p.parse_args()
    if not re.fullmatch('[a-z][a-z0-9_]*',args.id):p.error('マップIDは英小文字・数字・_にしてください')
    if not all(math.isfinite(v) for v in [*args.center,*args.half,args.rotation]) or not (-180<=args.center[0]<=180 and -85<=args.center[1]<=85):p.error('中心・回転・範囲は有限の数、緯度は±85度以内にしてください')
    if args.cell<2 or args.cell>8 or any(h<100 or h>600 for h in args.half):p.error('セルは2〜8m、範囲は各辺200〜1200mにしてください')
    try:
        data,roads=make_map(args.source,tuple(args.center),args.rotation,tuple(args.half),args.cell)
    except (ValueError,ET.ParseError,OSError) as error:
        p.error(str(error))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text('// OSM由来の地理データは ODbL-1.0。出典と元データのハッシュは attribution を参照。\n'+
                           f'(window.MAP_DATA = window.MAP_DATA || {{}}).{args.id} = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    args.output.with_suffix('.json').write_text(json.dumps({'map':data,'roads':roads},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(args.output),'buildings':data['generation']['buildingsCount'],'boxes':len(data['layout']),
                      'nav':len(data['nav']['nodes']),'roofs':len(data['ziplines']),'plants':data['plants']},ensure_ascii=False))


if __name__=='__main__':
    main()
