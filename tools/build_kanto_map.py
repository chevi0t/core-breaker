#!/usr/bin/env python3
"""承認済みの梅田地形とユーザー図の2基地・5地点を、通常の対戦マップへ接続する。"""
import array
import base64
import copy
import hashlib
import json
import math
import pathlib
import subprocess

import mapbox_earcut
import numpy as np
import shapely
from scipy.ndimage import label
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'mapdesign/kanto'
STEP=.02
PLANTS=[['A',-205,165,None],['B',-444,-255,None],['C',15,30,None],['D',375,260,None],['E',171,-205,None]]
BASES={'B':{'at':[-310,430],'radius':28,'height':0},'R':{'at':[350,-450],'radius':28,'height':0}}
CLEARINGS=[Polygon([(-405,490),(-400,405),(-380,380),(-200,333),(-200,490)]),
           Polygon([(265,-500),(460,-500),(350,-370)])]


def compact(d):return json.dumps(d,ensure_ascii=False,separators=(',',':')).encode()
def parts(g):
    if isinstance(g,Polygon):return [g]
    return [p for v in getattr(g,'geoms',[]) for p in parts(v)]
def decode_ring(s):return np.frombuffer(base64.b64decode(s),dtype='<i2').reshape(-1,2)*STEP
def encode_ring(r):return base64.b64encode(np.rint(np.asarray(r)/STEP).astype('<i2').tobytes()).decode()
def polygon(v):return Polygon(decode_ring(v[3][0]),[decode_ring(r) for r in v[3][1:]])
def pack_polygon(p):return [encode_ring(np.asarray(r.coords[:-1])) for r in [p.exterior,*p.interiors]]
def floor(p,y):
    out=[]
    for q in parts(p):
        rr=[np.asarray(r.coords[:-1]) for r in [q.exterior,*q.interiors]]
        xy=np.concatenate(rr);ids=mapbox_earcut.triangulate_float64(xy,np.cumsum([len(r) for r in rr],dtype=np.uint32)).reshape(-1,3)
        a=np.column_stack([xy[:,0],np.full(len(xy),y),xy[:,1]])[ids]
        wrong=np.cross(a[:,1]-a[:,0],a[:,2]-a[:,0])[:,1]<0;a[wrong]=a[wrong][:,[0,2,1]];out.append(a.reshape(-1,3))
    return np.concatenate(out) if out else np.empty((0,3))
def pack_surface(a):
    pts,ids=np.unique(np.rint(a/STEP).astype('<i2'),axis=0,return_inverse=True)
    assert len(pts)<65536
    return {'points':base64.b64encode(pts.tobytes()).decode(),'indices':base64.b64encode(ids.astype('<u2').tobytes()).decode(),'step':STEP}
def unpack_surface(s):
    p=np.frombuffer(base64.b64decode(s['points']),dtype='<i2').reshape(-1,3)*s['step']
    return p[np.frombuffer(base64.b64decode(s['indices']),dtype='<u2')]


def paint_landmarks(data):
    # 位置と外観写真を確認した記録から着色する。形状と高さは承認済みの入力を保つ。
    profile=json.loads((ROOT/'research/maps/umeda-landmarks.json').read_text())
    assert hashlib.sha256((OUT/'source/layout.json').read_bytes()).hexdigest()==profile['sourceSHA256']
    volumes=data['volumes'];shapes=[polygon(v) for v in volumes]
    roots=[i for i,v in enumerate(volumes) if v[1]<0];tree=shapely.STRtree([shapes[i] for i in roots])
    for v,p in zip(volumes,shapes):
        # 同じ建物の屋上・上層も低層部とそろえ、積層ごとのまだら模様を避ける。
        candidates=[roots[j] for j in tree.query(p) if p.intersection(shapes[roots[j]]).area>=p.area*.8]
        base=shapes[min(candidates,key=lambda j:shapes[j].area)] if candidates else p
        x,z=base.centroid.coords[0];v[4]=dict(v[4],paint=abs(round(x*7)+round(z*13))%len(profile['ordinaryPalette']))
    stats=[]
    for row in profile['landmarks']:
        footprint=shapely.union_all([shapes[i] for i in row['sourceFootprints']]);members=[]
        for i,(v,p) in enumerate(zip(volumes,shapes)):
            if p.intersection(footprint).area<p.area*.8:continue
            color=row['upperColor'] if v[2]>=row['upperThreshold'] else row['lowColor']
            # 中央駅の北棟と南棟は、実物の砂色・白灰色に分ける。
            if row['id']=='central-station':color='#c4b18f' if v[2]>40 and p.centroid.y<20 else '#d6d9d1' if v[2]>40 else '#c6cdd0'
            v[4]={'landmark':row['id'],'landmarkColor':color}
            if row['upperFacade']=='glass' and v[2]>=row['upperThreshold']:v[4]['facade']='glass'
            members.append(i)
        assert members,('目印の建物が見つからない',row['id'])
        stats.append({'id':row['id'],'sourceVolumes':members,'colors':sorted({volumes[i][4]['landmarkColor'] for i in members})})
    return profile['ordinaryPalette'],stats


def station_canopy():
    # 中央駅の線路方向に合わせた白い大屋根。北側から南側へ26m下がる板1枚。
    ring=[[-280,5],[-110,-100],[-62,-22],[-232,83]];p=Polygon(ring)
    slope=np.linalg.solve(np.array([[170,-105],[48,78]]),np.array([0,-26]))
    top=floor(p,0).reshape(-1,3,3)
    top[:,:,1]=76+(top[:,:,0]+280)*slope[0]+(top[:,:,2]-5)*slope[1]
    bottom=top[:,[0,2,1]].copy();bottom[:,:,1]-=.8
    faces=[*top,*bottom]
    corners=np.array([[x,76+(x+280)*slope[0]+(z-5)*slope[1],z] for x,z in ring])
    for a,b in zip(corners,np.roll(corners,-1,axis=0)):
        c=a-[0,.8,0];d=b-[0,.8,0];faces.extend([[a,b,c],[b,d,c]])
    return pack_surface(np.array(faces).reshape(-1,3)),{'ring':ring,'top':76,'low':50,'thickness':.8,'color':'#f0f2ee'}


class Streets:
    def __init__(self,volumes,extra=()):
        self.volumes=[(polygon(v),v[1],v[2]) for v in volumes]+list(extra)
        self.tree=shapely.STRtree([p for p,_,_ in self.volumes])
        self.blocked=shapely.union_all([p for p,lo,hi in self.volumes if lo<4.1 and hi>.3]).buffer(1.65,quad_segs=2)
        self.air=shapely.union_all([p for p,_,_ in self.volumes]).buffer(1.7,quad_segs=2)
    def free(self,p,r=1.65):
        q=Point(*p)
        return abs(p[0])<498-r and abs(p[1])<498-r and not any(lo<4.1 and hi>.3 and shape.distance(q)<r for shape,lo,hi in (self.volumes[i] for i in self.tree.query(q.buffer(r))))
    def clear(self,a,b):return not self.blocked.intersects(LineString([a,b]))
    def heights(self,p):return np.zeros(len(p))


def plant_routes(streets,canopy,occupied):
    """2つの前線から中央へ。線分だけでなく機体の太さを含む放物線を検査する。"""
    routes=[];solids=[*streets.volumes,(Polygon(canopy['ring']),49.2,76)]
    for ident in ['B','D']:
        source=np.array(next(p[1:3] for p in PLANTS if p[0]==ident));target=np.array([15,30])
        angle=math.atan2(*(target-source)[::-1]);starts=[];ends=[]
        for radius in [27,32,38]:
            for delta in np.linspace(-1.2,1.2,49):
                for center,heading,choices in [(source,angle,starts),(target,angle+math.pi,ends)]:
                    p=np.round(center+[math.cos(heading+delta)*radius,math.sin(heading+delta)*radius],1).tolist()
                    if streets.free(p,5) and not streets.air.intersects(Point(p).buffer(3)) and all(math.dist(p,q)>10 for q in occupied):choices.append(p)
        starts=sorted(starts,key=lambda p:math.dist(p,source+(target-source)/np.linalg.norm(target-source)*30))[:12]
        ends=sorted(ends,key=lambda p:math.dist(p,target+(source-target)/np.linalg.norm(source-target)*30))[:12]
        assert starts and ends,('プラント間の射出・着地空間なし',ident)
        best=None
        for a in starts:
            for b in ends:
                f=np.linspace(0,1,241);xz=np.array(a)[None,:]+(np.array(b)-a)[None,:]*f[:,None]
                points=shapely.points(xz);corridor=LineString([a,b]).buffer(2)
                crossings=[(shapely.intersects(poly.buffer(2),points),lo,hi) for poly,lo,hi in solids if poly.intersects(corridor)]
                for flight in np.arange(2.8,8.01,.2):
                    y=.5*34*flight**2*f*(1-f)
                    if any(np.any(mask&(y<hi+3)&(y+4>lo)) for mask,lo,hi in crossings):continue
                    cost=flight*100+math.dist(a,source)*.1+math.dist(b,target)*.1
                    if best is None or cost<best[0]:best=(cost,a,b,round(float(flight),1))
                    break
        assert best,('高層棟を越える射出軌道なし',ident)
        _,a,b,flight=best;routes.append(dict(at=a,exit=b,plant=ident,targetPlant='C',flight=flight))
        occupied.extend([a,b])
    return routes


def roof_pads(streets,canopy,occupied):
    """垂直射出は本体のまま。遅い機体でも届く、縁から余裕のある屋根を選ぶ。"""
    heights=sorted({hi for _,_,hi in streets.volumes},reverse=True);covered=Polygon(canopy['ring']);roofs=[]
    for h in heights:
        at_height=shapely.union_all([p for p,_,hi in streets.volumes if hi==h])
        if 12<=h<=72:
            for p in parts(at_height.difference(covered).buffer(-5)):
                if p.area>80:roofs.append((p,h))
        covered=covered.union(at_height)
    pads=[]
    for seed in [(-422,-70),(-240,-134),(-210,120),(160,-125),(50,245),(320,30)]:
        choices=[]
        for dx in range(-66,67,6):
            for dz in range(-66,67,6):
                p=[seed[0]+dx,seed[1]+dz];point=Point(p)
                if not streets.free(p,4.3) or streets.air.intersects(point.buffer(2.6)):continue
                if any(math.dist(p,b['at'])<120 for b in BASES.values()):continue
                if any(math.dist(p,pl[1:3])<23 for pl in PLANTS):continue
                if any(math.dist(p,q)<11 for q in occupied) or any(math.dist(p,j['at'][:2])<75 for j in pads):continue
                for roof,h in roofs:
                    if roof.distance(point)>15 or roof.distance(point)<9:continue
                    q=nearest_points(point,roof)[1];end=np.round(q.coords[0],2).tolist()
                    cost=math.dist(p,seed)+abs(math.dist(p,end)-12)*2
                    choices.append((cost,p,end,h))
        assert choices,('安全な屋上ジャンプパッドなし',seed)
        _,p,q,h=min(choices,key=lambda v:v[0]);rise=min(100,int(math.ceil((h+32)/4)*4))
        pads.append(dict(at=[*p,0],exit=[*q,h],rise=rise,radius=3))
    return pads


def thin(mask):
    a=np.pad(mask,1).astype(np.uint8)
    while True:
        changed=0
        for phase in [0,1]:
            p=[a[:-2,1:-1],a[:-2,2:],a[1:-1,2:],a[2:,2:],a[2:,1:-1],a[2:,:-2],a[1:-1,:-2],a[:-2,:-2]]
            neighbors=sum(p);transitions=sum((p[i]==0)&(p[(i+1)%8]==1) for i in range(8))
            erase=(a[1:-1,1:-1]>0)&(neighbors>=2)&(neighbors<=6)&(transitions==1)
            erase&=(p[0]*p[2]*p[4]==0)&(p[2]*p[4]*p[6]==0) if phase==0 else (p[0]*p[2]*p[6]==0)&(p[0]*p[4]*p[6]==0)
            changed+=int(erase.sum());a[1:-1,1:-1][erase]=0
        if not changed:break
    return a[1:-1,1:-1].astype(bool)


def navigation(streets,anchors,*,half=500,grid_step=4,span=100):
    values=np.arange(-half+4,half-3,grid_step);xx,zz=np.meshgrid(values,values)
    points=np.column_stack([xx.ravel(),zz.ravel()]);mask=~shapely.intersects(streets.blocked,shapely.points(points)).reshape(xx.shape)
    labels,_=label(mask,np.ones((3,3)));sizes=np.bincount(labels.ravel());sizes[0]=0;mask&=labels==sizes.argmax()
    skel=thin(mask);cells=set(map(tuple,np.argwhere(skel)));adj={p:set() for p in cells}
    def at(p):return [int(values[p[1]]),int(values[p[0]])]
    for z,x in cells:
        for dz,dx in [(0,1),(1,0),(1,1),(1,-1)]:
            q=(z+dz,x+dx)
            if q not in cells or (dz and dx and ((z+dz,x) in cells or (z,x+dx) in cells)):continue
            if not streets.clear(at((z,x)),at(q)):continue
            adj[z,x].add(q);adj[q].add((z,x))
    keys={p for p,a in adj.items() if len(a)!=2};nodes=[];edges=set();lookup={};seen=set()
    def node(p):
        p=tuple(round(float(v),2) for v in p)
        if p not in lookup:lookup[p]=len(nodes);nodes.append(list(p))
        return lookup[p]
    for start in sorted(keys):
        for nxt in sorted(adj[start]):
            edge=tuple(sorted([start,nxt]))
            if edge in seen:continue
            chain=[start,nxt];seen.add(edge)
            while chain[-1] not in keys:
                q=next(p for p in adj[chain[-1]] if p!=chain[-2]);seen.add(tuple(sorted([chain[-1],q])));chain.append(q)
            i=0
            while i<len(chain)-1:
                j=i+1
                while j+1<len(chain) and math.dist(at(chain[i]),at(chain[j+1]))<=span and streets.clear(at(chain[i]),at(chain[j+1])):j+=1
                a,b=node(at(chain[i])),node(at(chain[j]));edges.add(tuple(sorted([a,b])));i=j
    anchor_ids=[]
    for name,p in anchors:
        a=node(p);hits=[]
        for b in sorted(range(len(nodes)),key=lambda i:math.dist(nodes[i],p)):
            if b==a:continue
            if math.dist(nodes[b],p)>150:break
            if streets.clear(p,nodes[b]):edges.add(tuple(sorted([a,b])));hits.append(b)
            if len(hits)>=3:break
        assert hits,(name,p,'経路へ接続できない');anchor_ids.append(a)
    adjacency=[[] for _ in nodes]
    for a,b in edges:adjacency[a].append(b);adjacency[b].append(a)
    reached={anchor_ids[0]};todo=list(reached)
    while todo:
        for b in adjacency[todo.pop()]:
            if b not in reached:reached.add(b);todo.append(b)
    assert all(a in reached for a in anchor_ids),'施設が別々の経路に分断'
    keep=sorted(reached);ids={a:i for i,a in enumerate(keep)}
    nodes=[nodes[i] for i in keep];edges=sorted((ids[a],ids[b]) for a,b in edges if a in reached and b in reached)
    packed={'encoding':'xz-i16-links-u16','step':STEP,'nodes':base64.b64encode(np.rint(np.array(nodes)/STEP).astype('<i2').tobytes()).decode(),
            'links':base64.b64encode(np.array(edges,dtype='<u2').tobytes()).decode()}
    return packed,{'nodes':len(nodes),'links':len(edges),'gridStep':grid_step,'freeCells':int(mask.sum())}


def build():
    data=json.loads((OUT/'source/layout.json').read_text());data=copy.deepcopy(data)
    palette,landmark_stats=paint_landmarks(data)
    clear=shapely.union_all([*CLEARINGS,*[Point(x,z).buffer(18,quad_segs=3) for _,x,z,_ in PLANTS]])
    volumes=[]
    for v in data['volumes']:
        for p in parts(polygon(v).difference(clear)):
            if p.area>2:volumes.append([*v[:3],pack_polygon(p),v[4]])
    data['volumes']=volumes
    streets=Streets(volumes)
    # 最近接の2プラントだけ補給所を土手と窪地へ隠す。入口は自軍基地側。
    shelters=[];walls=[];plant_pods=[];holes=[];pit_mesh=[];bank=[]
    for ident,team,sign in [('A','B',1),('E','R',-1)]:
        pl=next(p for p in PLANTS if p[0]==ident);x,z=pl[1:3]
        direction=np.array(BASES[team]['at'])-[x,z];angle=math.atan2(direction[1],direction[0]);chosen=None
        for radius in [28,32,36,40]:
            for offset in np.linspace(-.6,.6,25):
                px,pz=[round(v,1) for v in [x+math.cos(angle+offset)*radius,z+math.sin(angle+offset)*radius]]
                pit=box(px-5,pz-5,px+5,pz+5);ramp=box(px-4,min(pz+sign*5,pz+sign*17),px+4,max(pz+sign*5,pz+sign*17))
                area=pit.union(ramp).buffer(3)
                if not streets.blocked.intersects(area) and Point(x,z).distance(area)>16:chosen=(px,pz,pit,ramp);break
            if chosen:break
        assert chosen,('隠す補給所の空間なし',ident)
        px,pz,pit,ramp=chosen;holes.extend([pit,ramp]);plant_pods.append([ident,px,pz])
        pit_mesh.append(floor(pit,-2));a=floor(ramp,0);a[:,1]=-2+np.clip((a[:,2]-pz)*sign-5,0,12)/6;pit_mesh.append(a)
        walls.extend([[px,pz-sign*7,16,2,5,'wall'],[px-7,pz,2,12,5,'wall'],[px+7,pz,2,12,5,'wall']])
        for aa,bb in [((px-5,pz-5),(px-5,pz+5)),((px+5,pz-5),(px+5,pz+5)),((px-5,pz-sign*5),(px+5,pz-sign*5))]:
            p=np.array([aa[0],-2,aa[1]]);q=np.array([bb[0],-2,bb[1]]);r=p.copy();s=q.copy();r[1]=s[1]=0;bank.extend([p,q,r,q,s,r])
        shelters.append({'plant':ident,'at':[px,pz],'sign':sign})
    cut=shapely.union_all(holes)
    road=unpack_surface(data['surfaces']['tran']).reshape(-1,3,3)
    road_shape=shapely.union_all(shapely.polygons(road[:,:,[0,2]])).difference(cut)
    data['surfaces']['tran']=pack_surface(floor(road_shape,.04))
    data['surfaces']['dem']=pack_surface(np.concatenate([floor(box(-500,-500,500,500).difference(cut),0),*pit_mesh]))
    data['surfaces']['bank']=pack_surface(np.array(bank));data['packing']['layers']['bank']={'triangles':0}
    data['surfaces']['brid'],canopy=station_canopy()
    data['district']={'bases':[dict(team=team,**b) for team,b in BASES.items()],'roofPads':[],
                      'unifiedGround':{'color':'#92978b'},'roadColor':'#56656b','buildingPalette':palette,'glassTint':True,'stationCanopy':canopy}
    # うめきた公園に相当するB周辺。舗装された道と建物の輪郭は残す。
    park=box(-498,-410,-360,-135).difference(road_shape)
    data['district']['lawns']=[{'rings':pack_polygon(p),'color':'#789c57'} for p in parts(park) if p.area>10]
    extra=[(box(x-w/2,z-d/2,x+w/2,z+d/2),0,5) for x,z,w,d,_,_ in walls]
    def local(team,p):
        s=1 if team=='B' else -1;b=BASES[team]['at'];return [b[0]+p[0]*s,b[1]+(p[1]-480)*s]
    turrets=[[-24,456],[24,456],[-32,478],[32,478]];basepods=[[-18,498],[18,498]];radar=[-23,500]
    for team in BASES:
        for p in turrets:
            x,z=local(team,p);extra.append((box(x-1.8,z-1.8,x+1.8,z+1.8),0,4.4))
        x,z=local(team,radar);extra.append((box(x-1,z-1,x+1,z+1),0,11))
    for _,x,z,_ in PLANTS:extra.append((box(x-.4,z-.4,x+.4,z+.4),0,5))
    streets=Streets(volumes,extra)
    for ident,x,z,_ in PLANTS:
        if ident in ['A','E']:continue
        team=min(BASES,key=lambda k:math.dist(BASES[k]['at'],[x,z]));angle=math.atan2(BASES[team]['at'][1]-z,BASES[team]['at'][0]-x)
        candidates=[[round(x+math.cos(angle+a)*r,1),round(z+math.sin(angle+a)*r,1)] for r in [24,28,32] for a in np.linspace(-math.pi,math.pi,100)]
        p=next(p for p in candidates if streets.free(p,4) and streets.clear([x+4,z+3],p));plant_pods.append([ident,*p])
    respawns={};base_spawns={};anchors=[]
    for team in BASES:
        respawns[team]={}
        for ident,x,z,_ in PLANTS:
            angle=math.atan2(BASES[team]['at'][1]-z,BASES[team]['at'][0]-x);slots=[]
            for delta in np.linspace(-math.pi*.48,math.pi*.48,100):
                for r in [46.1,49,51.9]:
                    p=[round(x+math.cos(angle+delta)*r,2),round(z+math.sin(angle+delta)*r,2)]
                    if streets.free(p,2) and all(math.dist(p,q)>5 for q in slots):slots.append(p)
            assert len(slots)>=4,('再出撃点なし',team,ident)
            respawns[team][ident]=slots[::max(1,math.ceil(len(slots)/6))]
            anchors.extend((f'spawn-{team}-{ident}-{i}',p) for i,p in enumerate(respawns[team][ident]))
        base_spawns[team]=[local(team,[x,z]) for x in [-18,-6,6,18] for z in [494,504] if streets.free(local(team,[x,z]),2)]
        anchors.extend((f'base-{team}-{i}',p) for i,p in enumerate(base_spawns[team]))
    anchors.extend((f'plant-{ident}-{s}',[x+s*4,z+3]) for ident,x,z,_ in PLANTS for s in [-1,1])
    anchors.extend((f'pod-{pid}',[x,z+next((s['sign']*18 for s in shelters if s['plant']==pid),0)]) for pid,x,z in plant_pods)
    for team in BASES:anchors.extend((f'basepod-{team}-{i}',local(team,p)) for i,p in enumerate(basepods))
    cats={};targets={'B':[[-410,310],[-240,280],[-150,335],[-80,455]],'R':[[440,-300],[275,-300],[140,-340],[250,-480]]}
    for team in BASES:
        rows=[]
        for i,rx in enumerate([-28,-13,13,28]):
            p=local(team,[rx,456 if i in [0,3] else 448]);desired=targets[team][i];choices=[]
            for r in range(75,186,10):
                for angle in np.linspace(0,2*math.pi,144,endpoint=False):
                    q=[round(p[0]+math.cos(angle)*r,1),round(p[1]+math.sin(angle)*r,1)]
                    if streets.free(q,5) and not streets.air.intersects(LineString([p,q])):choices.append(q)
            assert choices,('射出方向なし',team,i,p)
            q=min(choices,key=lambda q:math.dist(q,desired));rows.append([*p,*q]);anchors.extend([(f'cat-{team}-{i}',p),(f'land-{team}-{i}',q)])
        cats[team]=rows
    # 供給所の窪地は地上の経路へ入口だけ接続し、最後の進入は通常の目標追従に任せる。
    for s in shelters:
        x,z=s['at'];extra.append((box(x-5,z-5,x+5,z+5),-2,1))
    streets=Streets(volumes,extra)
    occupied=[p[1:3] for p in plant_pods]+[row[:2] for rows in cats.values() for row in rows]
    occupied.extend(p for slots in respawns.values() for points in slots.values() for p in points)
    routes=plant_routes(streets,canopy,occupied)
    pads=roof_pads(streets,canopy,occupied)
    for route in routes:anchors.extend([(f"cat-{route['plant']}-C",route['at']),(f"land-{route['plant']}-C",route['exit'])])
    for i,pad in enumerate(pads):anchors.append((f'roof-pad-{i}',pad['at'][:2]))
    nav,navstats=navigation(streets,anchors)
    definition=dict(name='環都駅前・五街区争奪戦',order=81,size=[500,500],team=10,time=600,baseZ=480,baseLine=400,
        desc='中央駅と百貨店周辺の1km四方で5プラントを争う。両基地のカタパルトから街路へ展開。',
        terrain=[],layout=walls,plants=PLANTS,turrets=turrets,radar=radar,catapults=[],basePods=basepods,plantPods=plant_pods,
        barricades=[],asym=True,nav=nav,bases={team:{'at':b['at'],'radius':28,'catapults':cats[team]} for team,b in BASES.items()},
        jumpPads=pads,plantCatapults=routes,cityTerrain=data,cityBattle={'nodeReach':1.5,'respawns':respawns,'baseSpawns':base_spawns},
        attribution='大阪市・国土交通省 Project PLATEAU（北区2025年度）、国土地理院の道路中心線・標高。CC BY 4.0。街区・地面・対戦施設を加工。出典：https://github.com/chevi0t/core-breaker/blob/main/mapdesign/kanto/CREDITS.md')
    data.pop('attribution',None)
    measure="""
const fs=require('node:fs'),T=require(process.argv[1]),s=fs.readFileSync(process.argv[2],'utf8');
const f=new Function(s.slice(s.indexOf('function expandCityLayout('),s.indexOf('// 肩越し視点'))+';return expandCityLayout;')();
const d=JSON.parse(fs.readFileSync(0,'utf8'));f(T,d);
console.log(JSON.stringify(Object.fromEntries(Object.entries(d.meshes).map(([k,v])=>[k,Buffer.from(v,'base64').length/36]))));
"""
    counts=json.loads(subprocess.check_output(['node','-e',measure,str(ROOT/'vendor/three-r128/three.min.js'),str(ROOT/'prototype/index.html')],input=compact(data)))
    for name,count in counts.items():data['packing']['layers'][name]={'triangles':count}
    raw=compact(definition);header='// 梅田由来の承認済み地形を対戦用に加工。出典・謝辞はmapdesign/kanto/CREDITS.md。\n// tools/build_kanto_map.pyが生成。\n'
    js=header+'(window.MAP_DATA = window.MAP_DATA || {}).kanto = '+raw.decode()+';\n'
    stats={'sourceCommit':'901911e','sourceSHA256':hashlib.sha256((OUT/'source/layout.json').read_bytes()).hexdigest(),
        'mapDataBytes':len(raw),'mapFileBytes':len(js.encode()),'geometryBytes':len(compact(data)),'navigation':navstats,
        'triangles':sum(counts.values()),
        'landmarks':landmark_stats,
        'stationCanopy':canopy,
        'plants':PLANTS,'bases':BASES,'baseClearings':[list(p.exterior.coords) for p in CLEARINGS],'shelters':shelters,
        'catapults':cats,'plantCatapults':routes,'jumpPads':pads,'parkArea':round(park.area,1),
        'respawnSlots':{t:{k:len(v) for k,v in d.items()} for t,d in respawns.items()}}
    (ROOT/'prototype/maps/kanto.js').write_text(js);(OUT/'generation.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(stats,ensure_ascii=False),flush=True)
    assert len(js.encode())<=100000,('マップ全体が100KBを超過',len(js.encode()))


if __name__=='__main__':build()
