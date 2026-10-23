"""確認済み街路を変えず、対戦施設・安全な再出撃点・地上経路を生成する。"""
import base64
import copy
import json
import math
import subprocess
from collections import deque

import numpy as np
import shapely
from scipy.ndimage import label
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon, box

from build_trial import ROOT
from rebuild_trial import compact, make_layout
from simplify import clip_footprint
from trial_simplify import floor_mesh
from trial_streets import Surface


def decode_layout(data):
    script = """
const fs=require('fs'),T=require(process.argv[1]);
const expand=new Function(fs.readFileSync(process.argv[2],'utf8')+';return expandCityLayout;')();
const d=JSON.parse(fs.readFileSync(0,'utf8'));expand(T,d);console.log(JSON.stringify(d));
"""
    result = subprocess.run(['node','-e',script,str(ROOT/'vendor/three-r128/three.min.js'),
                             str(ROOT/'tools/plateau/rebuild_runtime.js')],input=compact(data),capture_output=True,check=True)
    reference = json.loads(result.stdout)
    arrays = {k:np.frombuffer(base64.b64decode(v),dtype='<f4').reshape(-1,3).copy() for k,v in reference['meshes'].items()}
    return reference, arrays


def polygon(v): return Polygon(v['rings'][0],v['rings'][1:])


def shelters(reference, arrays, specs):
    walls, pods = [], []
    for spec in specs:
        x,z=spec['at']; sign=1 if spec['entrance']=='south' else -1
        pit=box(x-5,z-5,x+5,z+5)
        ramp=box(x-4,min(z+sign*5,z+sign*17),x+4,max(z+sign*5,z+sign*17))
        cut=pit.union(ramp)
        allowed=box(-300,-300,300,300).difference(cut)
        for k in ['dem','tran','fill','ramps','aprons','plazas','streets','historicGround']:
            arrays[k]=clip_footprint(arrays[k],allowed)
        a=floor_mesh(ramp,0)
        a[:,1]=-4+np.clip((a[:,2]-z)*sign-5,0,12)/6
        arrays['dem']=np.concatenate([arrays['dem'],floor_mesh(pit,-4),a])
        # 窪地の側面を閉じる。入口は幅8mの坂で接続し、ジャンプを要求しない。
        faces=[]
        for aa,bb in [((x-5,z-5),(x-5,z+5)),((x+5,z-5),(x+5,z+5)),
                      ((x-5,z-sign*5),(x+5,z-sign*5))]:
            p=np.array([aa[0],-4,aa[1]]);q=np.array([bb[0],-4,bb[1]])
            r=p.copy();s=q.copy();r[1]=s[1]=-2
            faces.extend([p,q,r,q,s,r])
        arrays['bank']=np.concatenate([arrays['bank'],np.asarray(faces)])
        walls += [[x,z-sign*7,16,2,5,'wall'],[x-7,z,2,12,5,'wall'],[x+7,z,2,12,5,'wall']]
        pods.append([spec['plant'],x,z])
    return walls,pods


class Streets:
    def __init__(self,reference,arrays,extra):
        self.reference=reference
        ground=np.concatenate([arrays[k] for k in ['dem','tran','fill','ramps','aprons','plazas','streets','historicGround']])
        self.terrain_surface=Surface(ground)
        t=arrays['brid'].reshape(-1,3,3)
        normals=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0])
        # 地上の橋も歩行面に含める。高い歩道橋はこの地上経路とは別の足場。
        bridges=t[(normals[:,1]>.65*np.linalg.norm(normals,axis=1)) & (t[:,:,1].max(axis=1)<3)]
        self.surface=Surface(np.concatenate([ground,bridges.reshape(-1,3)]))
        self.volumes=[(polygon(v),v['bottom'],v['top']) for v in reference['volumes']]
        self.volumes += extra
        self.tree=shapely.STRtree([p for p,_,_ in self.volumes])

    def heights(self,points):
        return np.maximum(-9,self.surface.heights(np.asarray(points)))

    def free(self,points,r=1.65,dry=False):
        points=np.asarray(points); ps=shapely.points(points);hs=self.heights(points)
        okay=(np.abs(points).max(axis=1)<298-r)
        if dry:okay &= abs(self.terrain_surface.heights(points)+2)<.05
        pi,vi=self.tree.query(shapely.buffer(ps,r,quad_segs=2),predicate='intersects')
        for i,j in zip(pi,vi):
            _,lo,hi=self.volumes[j]
            if lo<hs[i]+4 and hi>hs[i]+.3:okay[i]=False
        return okay

    def clear(self,a,b,r=1.65):
        n=max(2,math.ceil(np.linalg.norm(np.array(b)-a)/.6))
        p=np.linspace(a,b,n);h=self.heights(p)
        return bool(self.free(p,r).all() and (np.abs(np.diff(h))<.45+1.1*np.linalg.norm(p[1]-p[0])).all())


def thin(mask):
    """Zhang–Suenの細線化。路地の中心線だけを残し、重い格子をゲームへ渡さない。"""
    a=np.pad(mask,1).astype(np.uint8)
    while True:
        changed=0
        for phase in [0,1]:
            p=[a[:-2,1:-1],a[:-2,2:],a[1:-1,2:],a[2:,2:],a[2:,1:-1],a[2:,:-2],a[1:-1,:-2],a[:-2,:-2]]
            neighbors=sum(p); transitions=sum((p[i]==0)&(p[(i+1)%8]==1) for i in range(8))
            erase=(a[1:-1,1:-1]>0)&(neighbors>=2)&(neighbors<=6)&(transitions==1)
            if phase==0:erase &= (p[0]*p[2]*p[4]==0)&(p[2]*p[4]*p[6]==0)
            else:erase &= (p[0]*p[2]*p[6]==0)&(p[0]*p[4]*p[6]==0)
            changed+=int(erase.sum());a[1:-1,1:-1][erase]=0
        if not changed:break
    return a[1:-1,1:-1].astype(bool)


def ground_grid(streets,step):
    values=np.arange(-296,297,step)
    xx,zz=np.meshgrid(values,values);xy=np.column_stack([xx.ravel(),zz.ravel()])
    mask=streets.free(xy).reshape(xx.shape)
    h=streets.heights(xy).reshape(xx.shape)
    # 崖の両側を細線化で連結しない。坂は2mの刻みで歩ける勾配だけ残す。
    for axis in [0,1]:
        delta=np.abs(np.diff(h,axis=axis))>step*1.1+.45
        if axis==0:mask[:-1] &= ~delta;mask[1:] &= ~delta
        else:mask[:,:-1] &= ~delta;mask[:,1:] &= ~delta
    labels,n=label(mask,np.ones((3,3)))
    sizes=np.bincount(labels.ravel());sizes[0]=0
    main=int(sizes.argmax());mask &= labels==main
    return values,mask,h


def navigation(streets,step,span,anchors):
    values,mask,h=ground_grid(streets,step)
    skel=thin(mask);cells=set(map(tuple,np.argwhere(skel)))
    adjacency={p:set() for p in cells}
    for z,x in cells:
        for dz,dx in [(0,1),(1,0),(1,1),(1,-1)]:
            q=(z+dz,x+dx)
            if q not in cells:continue
            if dz and dx and ((z+dz,x) in cells or (z,x+dx) in cells):continue
            if abs(h[z,x]-h[q])>.45+step*math.hypot(dx,dz)*1.1:continue
            adjacency[z,x].add(q);adjacency[q].add((z,x))
    keys={p for p,a in adjacency.items() if len(a)!=2}
    if not keys:keys={next(iter(cells))}
    nodes=[];links=set();lookup={}
    def point(p):return [float(values[p[1]]),float(values[p[0]])]
    def node(p):
        key=tuple(round(float(v),2) for v in p)
        if key not in lookup:
            lookup[key]=len(nodes);nodes.append([*key,round(float(streets.heights([key])[0]),2)])
        return lookup[key]
    seen=set()
    for start in sorted(keys):
        for neighbor in sorted(adjacency[start]):
            edge=tuple(sorted([start,neighbor]))
            if edge in seen:continue
            chain=[start,neighbor];seen.add(edge)
            while chain[-1] not in keys:
                nxt=next(q for q in adjacency[chain[-1]] if q!=chain[-2])
                seen.add(tuple(sorted([chain[-1],nxt])));chain.append(nxt)
            i=0
            while i<len(chain)-1:
                j=i+1
                while j+1<len(chain) and np.linalg.norm(np.array(point(chain[j+1]))-point(chain[i]))<=span and streets.clear(point(chain[i]),point(chain[j+1])):j+=1
                a,b=node(point(chain[i])),node(point(chain[j]));links.add(tuple(sorted([a,b])));i=j
    # 施設の中心へ到達できる接続を追加する。既存の中心線から道路を横断する辺も実体幅で調べる。
    anchor_nodes=[]
    for name,p in anchors:
        a=node(p);candidates=sorted((i for i in range(len(nodes)) if i!=a),key=lambda i:math.dist(nodes[i][:2],p))
        attached=[]
        for b in candidates:
            if math.dist(nodes[b][:2],p)>65:break
            if streets.clear(p,nodes[b][:2]):
                links.add(tuple(sorted([a,b])));attached.append(b)
                if len(attached)==3:break
        if not attached:raise ValueError(f'施設への歩行経路なし: {name} {p}')
        anchor_nodes.append([name,a])
    # 施設に到達しない孤立した短い枝を捨てる。全施設は同じ連結成分に必要。
    adj=[[] for _ in nodes]
    for a,b in links:adj[a].append(b);adj[b].append(a)
    reached={anchor_nodes[0][1]};todo=list(reached)
    while todo:
        for b in adj[todo.pop()]:
            if b not in reached:reached.add(b);todo.append(b)
    absent=[name for name,i in anchor_nodes if i not in reached]
    if absent:raise ValueError(f'施設の経路が分断: {absent}')
    keep=sorted(reached);remap={v:i for i,v in enumerate(keep)}
    return {'nodes':[nodes[i] for i in keep],'links':[list(sorted([remap[a],remap[b]])) for a,b in sorted(links) if a in reached and b in reached]}, {'gridStep':step,'freeCells':int(mask.sum()),'skeletonCells':len(cells),'nodes':len(keep),'links':sum(a in reached and b in reached for a,b in links),'anchors':anchor_nodes}


def plan(data,profile):
    ref,arrays=decode_layout(data)
    walls,plant_pods=shelters(ref,arrays,profile['shelters'])
    bases={b['team']:b for b in ref['district']['bases']}
    def local(team,p):
        s=1 if team=='B' else -1;b=bases[team]['at']
        return [b[0]+p[0]*s,b[1]+(p[1]-280)*s]
    extra=[(box(x-w/2,z-d/2,x+w/2,z+d/2),-2,3) for x,z,w,d,_,_ in walls]
    for team in bases:
        for p in profile['baseTurrets']:
            x,z=local(team,p);extra.append((box(x-1.8,z-1.8,x+1.8,z+1.8),-2,2.4))
        x,z=local(team,profile['baseRadar']);extra.append((box(x-1,z-1,x+1,z+1),-2,9))
    for _,x,z,_ in profile['plants']:extra.append((box(x-.4,z-.4,x+.4,z+.4),-2,5))
    streets=Streets(ref,arrays,extra)
    values,mask,_=ground_grid(streets,profile['gridStep'])
    cells=np.argwhere(mask);connected_points=np.column_stack([values[cells[:,1]],values[cells[:,0]]])
    connected_tree=cKDTree(connected_points)
    def connected(p):
        distances,ids=connected_tree.query(p,k=8)
        return any(d<6 and streets.clear(p,connected_points[i]) for d,i in zip(distances,ids))
    for ident,x,z,_ in profile['plants']:
        if not streets.free([[x+4,z+3]],1.3,dry=True)[0]:raise ValueError(f'プラント進入不可: {ident}')
        if ident not in [p[0] for p in plant_pods]:
            direction=np.array(bases['B' if ident=='D' else 'R']['at'])-[x,z];direction=direction/np.linalg.norm(direction)
            candidates=[[x+math.cos(a)*24,z+math.sin(a)*24] for a in np.linspace(0,2*math.pi,120,endpoint=False)]
            candidates.sort(key=lambda p:-np.dot(np.array(p)-[x,z],direction))
            p=next(p for p in candidates if streets.free([p],4,dry=True)[0] and streets.clear([x+4,z+3],p))
            plant_pods.append([ident,*[round(float(v),1) for v in p]])
    respawns={};base_spawns={};anchors=[]
    for team,b in bases.items():
        respawns[team]={}
        for ident,x,z,_ in profile['plants']:
            direction=np.array(b['at'])-[x,z];angle=math.atan2(direction[1],direction[0])
            candidates=[]
            for delta in np.linspace(-math.pi*.49,math.pi*.49,90):
                for r in [46,49,52]:candidates.append([x+math.cos(angle+delta)*r,z+math.sin(angle+delta)*r])
            valid=[p for p,ok in zip(candidates,streets.free(candidates,2,dry=True)) if ok and connected(p)]
            slots=[]
            for p in valid:
                if all(math.dist(p,q)>4 for q in slots):slots.append([round(v,2) for v in p])
            if len(slots)<3:raise ValueError(f'再出撃先が少ない: {team} {ident}: {slots}')
            respawns[team][ident]=slots[::max(1,math.ceil(len(slots)/10))]
            anchors += [(f'spawn-{team}-{ident}-{i}',p) for i,p in enumerate(respawns[team][ident])]
        slots=[local(team,[x,z]) for x in [-18,-12,-6,0,6,12,18] for z in [294,300,304]]
        base_spawns[team]=[p for p,ok in zip(slots,streets.free(slots,2,dry=True)) if ok]
        assert len(base_spawns[team])>=6
        anchors += [(f'base-{team}-{i}',p) for i,p in enumerate(base_spawns[team])]
    anchors += [(f'plant-{p[0]}',[p[1]+s*4,p[2]+3]) for p in profile['plants'] for s in [-1,1]]
    anchors += [(f'pod-{p[0]}',p[1:]) for p in plant_pods]
    for team in bases:
        anchors += [(f'base-pod-{team}-{i}',local(team,p)) for i,p in enumerate(profile['basePods'])]
    # 本体の飛行で着地を確かめた、左右の街路への展開先。
    catapults=copy.deepcopy(profile['baseCatapults'])
    for team,rows in catapults.items():
        for i,row in enumerate(rows):
            order=np.argsort(np.linalg.norm(connected_points-np.array(row[2:]),axis=1))[:200]
            landing=next(p for p in connected_points[order] if streets.free([p],4,dry=True)[0])
            row[2:]=landing.tolist()
            anchors += [(f'cat-{team}-{i}',row[:2]),(f'land-{team}-{i}',row[2:])]
    nav,nav_stats=navigation(streets,profile['gridStep'],profile['navigationSpan'],anchors)
    layout,stats=make_layout(ref,arrays,reconstructed=(ref['volumes'],{}))
    # 2026-10-23 オーナー指定。橙側だけにあった高層棟用パッドは対戦版では撤去する。
    layout['district']['roofPads']=[]
    # 診断の元資料は承認済み版に残す。実行時に要らない路地輪郭を二重に持たない。
    for k in ['passages','accessRoutes','blockEdits','sourcePassages']:layout['district'].pop(k,None)
    definition=dict(name=profile['name'],size=[300,300],team=profile['team'],time=profile['time'],baseZ=280,baseLine=300,
        desc='4プラントを争う10対10の市街戦。両基地のカタパルトから街路へ展開する。',
        terrain=[],layout=walls,plants=profile['plants'],turrets=profile['baseTurrets'],radar=profile['baseRadar'],
        catapults=[],basePods=profile['basePods'],plantPods=plant_pods,barricades=[],asym=True,nav=nav,
        bases={team:{'at':b['at'],'radius':b['radius'],'catapults':catapults[team]} for team,b in bases.items()},
        jumpPads=layout['district']['roofPads'],cityBattle={'respawns':respawns,'baseSpawns':base_spawns})
    return layout,definition,{'navigation':nav_stats,'geometry':stats,'respawnSlots':{team:{p:len(v) for p,v in ps.items()} for team,ps in respawns.items()}}
