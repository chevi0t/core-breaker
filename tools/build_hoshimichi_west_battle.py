"""承認済み配置案を街区へ接続する。局所整地・道路橋・基地・プラント・安全な経路を生成する。"""
import base64
import hashlib
import json
import math
from pathlib import Path
import subprocess

import numpy as np
import shapely
from shapely.geometry import Point, Polygon, LineString, box
from scipy.ndimage import label
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from build_hoshimichi_west import pack_volumes, pack_rings, pack_surface, floor_mesh
from plateau_city_geometry import parts, rings, extrusion

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'mapdesign/hoshimichi_west/battle'
ID='hoshimichi_west'

def compact(d):return json.dumps(d,ensure_ascii=False,separators=(',',':')).encode()
def qpoint(p):return [round(float(v),2) for v in p]
def decode(data):
    js="const fs=require('fs'),{decodeCityVolumes}=require(process.argv[1]);process.stdout.write(JSON.stringify(decodeCityVolumes(JSON.parse(fs.readFileSync(0,'utf8')))));"
    return json.loads(subprocess.check_output(['node','-e',js,str(ROOT/'tools/city_volume_codec.js')],input=compact(data)))
def polygon(v):
    rr=[np.frombuffer(base64.b64decode(r),dtype='<i2').reshape(-1,2)*.02 for r in v[3]]
    return Polygon(rr[0],rr[1:])
def surface(data,name):
    m=data['surfaces'][name];p=np.frombuffer(base64.b64decode(m['points']),dtype='<i2').reshape(-1,3)*m['step']
    ids=np.frombuffer(base64.b64decode(m['indices']),dtype='<u2').reshape(-1,3)
    return shapely.union_all([Polygon(t) for t in p[ids][:,:,[0,2]]])
def local_poly(center,front,coords):
    f=np.asarray(front);side=np.array([-f[1],f[0]])
    return Polygon([np.asarray(center)+f*u+side*v for u,v in coords])
def rectangle(center,front,u0,v0,u1,v1):return local_poly(center,front,[(u0,v0),(u1,v0),(u1,v1),(u0,v1)])

class Streets:
    def __init__(self,walk,solids):
        self.walk=walk;self.solids=solids
        self.low=shapely.union_all([p for p,lo,hi in solids if lo<4.2 and hi>.3])
        self.blocked=self.low.buffer(1.6,quad_segs=4)
        self.free_shape=walk.buffer(-1.6,quad_segs=4).difference(self.blocked).intersection(box(-348,-173,348,173))
        self.tree=shapely.STRtree([p for p,lo,hi in solids]);self.air=[(p,lo,hi) for p,lo,hi in solids]
        X,Z=np.meshgrid(np.arange(-348,349,2),np.arange(-173,174,2));mask=shapely.contains_xy(self.free_shape,X,Z)
        labs,_=label(mask,np.array([[0,1,0],[1,1,1],[0,1,0]]));sizes=np.bincount(labs.ravel());sizes[0]=0;mask&=labs==sizes.argmax()
        self.connected=np.column_stack([X[mask],Z[mask]]);self.connected_tree=cKDTree(self.connected)
    def free(self,p,r=1.8):
        point=Point(p)
        if not box(-350+r,-175+r,350-r,175-r).covers(point) or not self.walk.covers(point.buffer(r,quad_segs=6)):return False
        if self.low.intersects(point.buffer(r,quad_segs=6)):return False
        ds,ii=self.connected_tree.query(p,k=8)
        return any(d<6 and self.clear(p,self.connected[i]) for d,i in zip(ds,ii))
    def clear(self,a,b):return self.free_shape.covers(LineString([a,b]))
    def near(self,wanted,r=3,span=20,occupied=(),accept=lambda p:True):
        candidates=[]
        for x in np.arange(wanted[0]-span,wanted[0]+span+.1,2):
            for z in np.arange(wanted[1]-span,wanted[1]+span+.1,2):
                p=qpoint([x,z])
                if self.free(p,r) and all(math.dist(p,q)>r+3 for q in occupied):candidates.append((math.dist(p,wanted),p))
        assert candidates,('安全な候補なし',wanted,r)
        for _,p in sorted(candidates):
            if accept(p):return p
        raise ValueError(('条件を満たす候補なし',wanted))
    def flight_clear(self,start,end,seconds):
        line=LineString([start,end]);distance=line.length
        for i in self.tree.query(line.buffer(1.35),predicate='intersects'):
            shape,lo,hi=self.air[i]
            overlap=line.intersection(shape.buffer(1.35,quad_segs=6))
            todo=[overlap]
            while todo:
                g=todo.pop()
                if g.is_empty:continue
                if g.geom_type in ['LineString','Point']:
                    values=[line.project(Point(q))/distance for q in g.coords]
                    a,b=min(values),max(values)
                    ys=[.5*34*seconds*seconds*t*(1-t) for t in [a,b]]
                    low=min(ys);high=.5*34*seconds*seconds*.25 if a<=.5<=b else max(ys)
                    if not (low>hi+.15 or high+4<lo-.15):return False
                else:todo.extend(g.geoms)
        return True


def build_navigation(streets,anchors,main_pairs):
    xs=np.arange(-348,349,2);zs=np.arange(-173,174,2);X,Z=np.meshgrid(xs,zs)
    mask=shapely.contains_xy(streets.free_shape,X,Z);labels,_=label(mask,np.array([[0,1,0],[1,1,1],[0,1,0]]));sizes=np.bincount(labels.ravel());sizes[0]=0;mask&=labels==sizes.argmax()
    cells=np.argwhere(mask);xy=np.column_stack([X[mask],Z[mask]]);tree=cKDTree(xy)
    ids=np.arange(X.size).reshape(X.shape);aa=[];bb=[];vv=[]
    for dx,dz in [(1,0),(0,1),(1,1),(-1,1)]:
        src=(slice(0,mask.shape[0]-dz),slice(max(0,-dx),mask.shape[1]-max(0,dx)));dst=(slice(dz,mask.shape[0]),slice(max(0,dx),mask.shape[1]+min(0,dx)))
        ok=mask[src]&mask[dst]
        if dx and dz:ok&=mask[(src[0],dst[1])]&mask[(dst[0],src[1])]
        a,b=ids[src][ok],ids[dst][ok];aa.extend([a,b]);bb.extend([b,a]);vv.extend([np.full(len(a),2*math.hypot(dx,dz))]*2)
    graph=csr_matrix((np.concatenate(vv),(np.concatenate(aa),np.concatenate(bb))),shape=(X.size,X.size))
    def grid_node(p):
        distances,near=tree.query(p,k=24)
        for distance,i in zip(distances,near):
            q=xy[i]
            if distance<8 and streets.clear(p,q):return int(ids[tuple(cells[i])])
        raise ValueError(('経路へ接続できない',p))
    nodes=[grid_node(p) for name,p in anchors];dist,pred=dijkstra(graph,indices=nodes,return_predecessors=True)
    assert np.isfinite(dist[:,nodes]).all(),'施設・再出撃点の地上接続が分断'
    # 全点対最短路の木を重ね、街路網を容量内にまとめる。主要地点同士の別経路も保つ。
    edges=set();points=[];lookup={}
    def node(p):
        p=tuple(qpoint(p))
        if p not in lookup:lookup[p]=len(points);points.append(list(p))
        return lookup[p]
    def add_path(i,j):
        current=nodes[j];path=[anchors[j][1],[float(X.ravel()[current]),float(Z.ravel()[current])]]
        while current!=nodes[i]:
            current=int(pred[i,current]);assert current>=0
            path.append([float(X.ravel()[current]),float(Z.ravel()[current])])
        path.append(anchors[i][1]);path=path[::-1]
        a=0
        while a<len(path)-1:
            if math.dist(path[a],path[a+1])<.01:a+=1;continue
            b=a+1
            while b+1<len(path) and math.dist(path[a],path[b+1])<=45 and streets.clear(path[a],path[b+1]):b+=1
            edges.add(tuple(sorted([node(path[a]),node(path[b])])));a=b
    # 近いアンカー同士を結ぶ木と、コア・プラント間の戦術的な接続を採用する。
    reached={0}
    while len(reached)<len(anchors):
        _,i,j=min((dist[i,nodes[j]],i,j) for i in reached for j in range(len(anchors)) if j not in reached)
        add_path(i,j);reached.add(j)
    names={name:i for i,(name,p) in enumerate(anchors)}
    for a,b in main_pairs:add_path(names[a],names[b])
    # 交差する経路の近い節点をつなぎ、Botが分岐・合流できるようにする。
    for i,p in enumerate(points):
        hits=0
        for j in sorted(range(len(points)),key=lambda j:math.dist(p,points[j])):
            if j==i:continue
            if math.dist(p,points[j])>30:break
            if streets.clear(p,points[j]):edges.add(tuple(sorted([i,j])));hits+=1
            if hits>=4:break
    edges=sorted(e for e in edges if e[0]!=e[1])
    packed={'encoding':'xz-i16-links-u16','step':.02,
            'nodes':base64.b64encode(np.rint(np.array(points)/.02).astype('<i2').tobytes()).decode(),
            'links':base64.b64encode(np.array(edges,dtype='<u2').tobytes()).decode()}
    return packed,{'nodes':len(points),'links':len(edges),'anchors':len(anchors)},dict(zip([name for name,p in anchors],nodes))


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    proposal=json.loads((ROOT/'mapdesign/hoshimichi_west/layout-proposal.json').read_text())
    source=ROOT/'mapdesign/hoshimichi_west/layout.json'
    assert hashlib.sha256(source.read_bytes()).hexdigest()==proposal['terrainSHA256']
    data=json.loads(source.read_text());original=decode(data);land=surface(data,'dem');water=surface(data,'water')
    protected=shapely.union_all([polygon(v) for v in original if v[1]<4.2 and v[4].get('landmarkColor') in data['volumeColors'][1:7]])
    clearings=[box(*b['clear']) for b in proposal['bases']]+[Point(p['at']).buffer(17.4,quad_segs=8) for p in proposal['plants']]
    bases={b['team']:{'at':b['at'],'radius':31,'catapults':[],'catapultFlight':5.2} for b in proposal['bases']}
    shelters=[];extra=[];ramp_mesh=[];pit_mesh=[]
    for ident,team in [('A','B'),('E','R')]:
        plant=next(p for p in proposal['plants'] if p['id']==ident);at=np.array(plant['at']);back=np.array(bases[team]['at'],dtype=float)-at;back/=np.linalg.norm(back)
        for angle in [0,.2,-.2,.4,-.4]:
            direction=np.array([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]])@back
            center=at+direction*30;front=-direction
            reserve=rectangle(center,front,-25,-9,8,9)
            if land.covers(reserve) and protected.intersection(reserve).area<.1:break
        else:raise ValueError(('補給用の局所空間なし',ident))
        pit=rectangle(center,front,-6,-5,5,5);ramp=rectangle(center,front,-16,-3,-6,3)
        clearings.append(reserve)
        wall_specs=[(4,-8,8,8),(-7,-8,5,-5),(-7,5,5,8)]
        for spec in wall_specs:extra.append([0,-2,5,pack_rings(rings(rectangle(center,front,*spec))),{'landmarkColor':'#6e7375'}])
        ramp_points=[]
        for u,v,y in [(-16,-3,0),(-16,3,0),(-6,3,-2),(-6,-3,-2)]:
            p=np.array(center)+front*u+np.array([-front[1],front[0]])*v;ramp_points.append([p[0],y,p[1]])
        ramp_mesh.extend(np.array(ramp_points)[[0,1,2,0,2,3]].tolist())
        pit_mesh.extend(floor_mesh(pit,-2).tolist())
        entry=center-front*18
        shelters.append({'plant':ident,'at':qpoint(center),'entry':qpoint(entry),'pit':pit,'ramp':ramp})
    clear=shapely.union_all(clearings);sky_clear=shapely.union_all([box(*b['clear']) for b in proposal['bases']]);volumes=[];removed=[];protected_kept=[]
    for i,v in enumerate(original):
        p=polygon(v)
        cut=clear if v[0] in [0,1] or v[1]<4.2 else sky_clear
        if not p.intersects(cut):volumes.append(v);continue
        removed_area=p.intersection(cut).area
        if removed_area<.005:volumes.append(v);continue
        if v[4].get('landmarkColor') in data['volumeColors'][1:7]:
            assert all(p.intersection(Point(q['at']).buffer(16)).area<.01 for q in proposal['plants']),('ランドマークが占拠円内',i)
            protected_kept.append({'index':i,'outsideCaptureCircleArea':round(removed_area,3)});volumes.append(v);continue
        removed.append({'index':i,'area':round(removed_area,2)})
        for part in parts(shapely.set_precision(p.difference(cut),.02)):
            if part.area>.1:volumes.append([*v[:3],pack_rings(rings(part)),v[4]])
    volumes+=extra
    # 橋は細い輪郭をそのまま持ち込まず、同じ道路に沿う薄い板へ近似する。
    bridge_shapes=[Polygon(b['ring']).minimum_rotated_rectangle for b in proposal['bridgeRepairs']]
    bridges=shapely.union_all(bridge_shapes)
    data['surfaces']['streets']=pack_surface(floor_mesh(bridges,0))
    underside=[]
    for p in bridge_shapes:
        a=extrusion(p,-.5,0,True).reshape(-1,3,3)
        underside.extend(a[~np.all(np.isclose(a[:,:,1],0),axis=1)].reshape(-1,3).tolist())
    data['surfaces']['brid']=pack_surface(np.array(underside))
    pits=shapely.union_all([s['pit'].union(s['ramp']) for s in shelters])
    data['surfaces']['dem']=pack_surface(floor_mesh(land.difference(pits),0))
    data['surfaces']['ramps']=pack_surface(np.array(ramp_mesh+pit_mesh))
    data['district'].update(unifiedGround={'color':'#8a8d85'},facadeScale=.5,
       bases=[{'team':t,'at':b['at'],'radius':31,'height':0} for t,b in bases.items()],
       repairShelters=[{k:v for k,v in s.items() if k not in ['pit','ramp']} for s in shelters])
    data['playBounds']=[-350,350,-175,175]
    data.pop('preview',None)
    data['volumeCount']=len(volumes);data['volumes'],data['volumeColors']=pack_volumes(volumes)
    # 本体と同じ場所へ置いた施設を、経路候補の障害物へ反映する。
    solids=[(polygon(v),v[1],v[2]) for v in volumes]
    base_z=400
    turrets=[[26,base_z-15],[26,base_z+15],[10,base_z-15],[10,base_z+15]]
    base_pods=[[-20,base_z-14],[-20,base_z+14]];radar=[-23,base_z-23]
    def local(t,p):
        s=1 if t=='B' else -1;return qpoint(np.array(bases[t]['at'])+np.array([p[0],p[1]-base_z])*s)
    for t,b in bases.items():
        solids.append((Point(b['at']).buffer(10.4,quad_segs=12),0,16))
        for p in turrets+[radar]:
            x,z=local(t,p);solids.append((box(x-1.65,z-1.65,x+1.65,z+1.65),0,10))
    for p in proposal['plants']:
        x,z=p['at'];solids.append((box(x-.7,z-.7,x+.7,z+.7),0,7))
    # 補給室の奥は高さを持つ専用経路にし、地上経路は入口へつなぐ。
    walk=land.union(bridges).difference(pits)
    streets=Streets(walk,solids)
    cat_targets={'B':[[-125,-25],[-120,10],[-95,75],[-80,100]],'R':[[125,-80],[140,-45],[165,10],[185,40]]}
    occupied=[]
    for t,b in bases.items():
        for offset,wanted in zip([[-8,-27],[12,-27],[-8,27],[12,27]],cat_targets[t]):
            sign=1 if t=='B' else -1;start=qpoint(np.array(b['at'])+np.array(offset)*sign)
            assert streets.free(start,3),('射出台',t,start)
            target=streets.near(wanted,3,36,accept=lambda p:math.dist(start,p)>180 and math.dist(p,next(q['at'] for q in proposal['plants'] if q['id']=='C'))>55 and streets.flight_clear(start,p,b['catapultFlight']))
            assert math.dist(start,target)>170 and math.dist(target,next(p['at'] for p in proposal['plants'] if p['id']=='C'))>55
            b['catapults'].append([*start,*target]);occupied.append(start)
    # 最大地上成分への接続を持つ再出撃帯だけを採用する。
    xx,zz=np.meshgrid(np.arange(-348,349,2),np.arange(-173,174,2));mask=shapely.contains_xy(streets.free_shape,xx,zz)
    labs,_=label(mask,np.array([[0,1,0],[1,1,1],[0,1,0]]));sizes=np.bincount(labs.ravel());sizes[0]=0;mask&=labs==sizes.argmax()
    connected=np.column_stack([xx[mask],zz[mask]]);tree=cKDTree(connected)
    def connection(p):
        ds,ii=tree.query(p,k=12)
        return any(d<6 and streets.clear(p,connected[i]) for d,i in zip(ds,ii))
    anchors=[];respawns={};base_spawns={}
    for t,b in bases.items():
        respawns[t]={}
        for p in proposal['plants']:
            x,z=p['at'];angle=math.atan2(b['at'][1]-z,b['at'][0]-x);slots=[]
            for da in np.linspace(-1.4,1.4,101):
                for r in [46.1,49,51.9]:
                    q=qpoint([x+math.cos(angle+da)*r,z+math.sin(angle+da)*r])
                    if streets.free(q,1.8) and connection(q) and all(math.dist(q,v)>7 for v in slots):slots.append(q)
            assert len(slots)>=3,('安全な再出撃帯なし',t,p['id'])
            chosen=slots[::max(1,math.ceil(len(slots)/4))][:4];respawns[t][p['id']]=chosen
            anchors.extend((f'spawn-{t}-{p["id"]}-{i}',q) for i,q in enumerate(chosen))
        slots=[]
        for angle in np.linspace(0,2*math.pi,72,endpoint=False):
            q=qpoint(np.array(b['at'])+np.array([math.cos(angle),math.sin(angle)])*18)
            if streets.free(q,2) and connection(q) and all(math.dist(q,c)>6 for c in occupied) and all(math.dist(q,local(t,p))>4 for p in base_pods) and all(math.dist(q,v)>5 for v in slots):slots.append(q)
        assert len(slots)>=4,('安全な基地出撃点なし',t)
        base_spawns[t]=slots[:8];anchors.extend((f'base-{t}-{i}',q) for i,q in enumerate(base_spawns[t]))
        for i,row in enumerate(b['catapults']):anchors.extend([(f'cat-{t}-{i}',row[:2]),(f'land-{t}-{i}',row[2:])])
        for i,p in enumerate(base_pods):anchors.append((f'basepod-{t}-{i}',local(t,p)))
        # コアの足元は柱に入らず、外周から攻撃できる節点を置く。
        for side in [-1,1]:anchors.append((f'core-{t}-{side}',streets.near(np.array(b['at'])+np.array([14*side,0]),1.8,8)))
    for p in proposal['plants']:
        x,z=p['at'];anchors.append((p['id'],streets.near([x+4,z+3],1.8,8)))
    anchors.extend((f'pod-{s["plant"]}',streets.near(s['entry'],1.8,8)) for s in shelters)
    pairs=[('A','B'),('B','C'),('C','D'),('D','E'),('A','C'),('B','D'),('C','E'),('core-B-1','A'),('core-R-1','E')]
    nav,navstats,_=build_navigation(streets,anchors,pairs)
    definition={'name':'星路西街区','order':7,'size':[450,450],'team':10,'time':600,'baseZ':base_z,'baseLine':380,
       'desc':'斜めに切り出した700×350mの街区。川を渡る2つの橋と高架を挟み、A/Eの前衛・B/Dの中継・Cの争奪を使い分ける。',
       'terrain':[],'layout':[],'plants':[[p['id'],*p['at'],p['initialOwner']] for p in proposal['plants']],
       'turrets':turrets,'radar':radar,'catapults':[],'basePods':base_pods,'plantPods':[[s['plant'],*s['at']] for s in shelters],
       'barricades':[],'asym':True,'nav':nav,'bases':bases,'cityTerrain':data,
       'cityBattle':{'nodeReach':1.5,'respawns':respawns,'baseSpawns':base_spawns},
       'attribution':'国土交通省Project PLATEAU（東京都・千代田区・台東区・文京区）と国土地理院の公開データを加工。縮尺1/2、局所整地・鉄道の延長・道路橋の復元。出典と謝辞：https://github.com/chevi0t/core-breaker/blob/main/mapdesign/hoshimichi_west/CREDITS.md'}
    # 地上経路は補給室の入口へつなぎ、斜面・窪地の接地は本体で解く。
    (OUT/'map.json').write_bytes(compact(definition)+b'\n')
    (OUT/'layout.json').write_bytes(compact(data)+b'\n')
    header='// 承認済み星路西街区。出典・加工はmapdesign/hoshimichi_west/CREDITS.md。\n// tools/build_hoshimichi_west_battle.pyで生成。\n'
    js=header+f'(window.MAP_DATA = window.MAP_DATA || {{}}).{ID} = '+compact(definition).decode()+';\n'
    assert len(js.encode())<=100000,('施設・経路込みで100KBを超過',len(js.encode()))
    (ROOT/f'prototype/maps/{ID}.js').write_text(js)
    report={'approvedCoordinatesKept':True,'removedVolumes':len(removed),'removedBuildingArea':round(sum(r['area'] for r in removed),1),
            'protectedRetained':protected_kept,'volumeCount':len(volumes),'geometryBytes':len(compact(data)),'mapDataBytes':len(compact(definition)),'mapFileBytes':len(js.encode()),
            'navigation':navstats,'bridgeDecks':[{'ring':[qpoint(q) for q in p.exterior.coords[:-1]],'height':0} for p in bridge_shapes],
            'shelters':data['district']['repairShelters'],'baseSpawns':{t:len(v) for t,v in base_spawns.items()},
            'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest()}
    (OUT/'generation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['geometryBytes','mapDataBytes','mapFileBytes','navigation','volumeCount']},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
