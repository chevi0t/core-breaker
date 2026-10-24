"""街区再構築案へ承認済みの基地・プラントと段階的な移動施設を接続する。"""
import base64,hashlib,json,math
from pathlib import Path
import numpy as np
import shapely
from shapely.geometry import Point,Polygon,LineString,box
from shapely.ops import nearest_points
from scipy.ndimage import label
from scipy.spatial import cKDTree
from build_hoshimichi_west import pack_rings,pack_surface,floor_mesh
from plateau_city_geometry import parts,rings
from build_hoshimichi_west_battle import compact,qpoint,decode,polygon,surface,rectangle,Streets,build_navigation
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'mapdesign/hoshimichi_west/rebuild/battle'
ID='hoshimichi_west'
LANDMARK_COLORS={m['color'] for m in json.loads((ROOT/'research/maps/hoshimichi-west-landmarks.json').read_text())['landmarks']}

def unpack_surface(m):
 p=np.frombuffer(base64.b64decode(m['points']),dtype='<i2').reshape(-1,3)*m['step']
 ids=np.frombuffer(base64.b64decode(m['indices']),dtype='<u2')
 return p[ids]

def catapults(streets,bases,proposal):
 """第一プラントまでの基地4台と、第一→第二の共有台を選ぶ。"""
 plants={p['id']:np.array(p['at'],dtype=float) for p in proposal['plants']}
 occupied=[];routes=[]
 sky=shapely.union_all([p for p,lo,hi in streets.air])
 def candidates(center,low,high):
  distances=np.linalg.norm(streets.connected-center,axis=1)
  points=streets.connected[(distances>=low)&(distances<=high)][::2]
  good=shapely.distance(sky,shapely.points(points))>3.4
  return [qpoint(p) for p,keep in zip(points,good) if keep and streets.free(p,3.4)]
 def safe(a,b,t):
  # 立ち位置が少しずれた場合も同じ着地点へ飛ぶ本体の射出式で検査する。
  return all(streets.flight_clear(np.array(a)+offset,b,t) for offset in [[0,0],[-1.5,0],[1.5,0],[0,-1.5],[0,1.5]])
 for team,first in [('B','A'),('R','E')]:
  base=bases[team];sign=1 if team=='B' else -1
  starts=[qpoint(np.array(base['at'])+np.array(offset)*sign) for offset in [[-8,-27],[12,-27],[-8,27],[12,27]]]
  for p in starts:assert streets.free(p,3.2),('基地台の空間',team,p)
  goals=candidates(plants[first],19,48)
  selected=None
  for flight in [4.6,5.0,5.4,5.8,6.2]:
   choices=[]
   for index,start in enumerate(starts):
    side=np.array([0,1 if index<2 else -1])
    wanted=plants[first]+side*27
    options=sorted(goals,key=lambda p:math.dist(p,wanted)+math.dist(start,p)*.12)
    choices.append([p for p in options if safe(start,p,flight)][:24])
   def choose(i,picked):
    if i==4:return picked
    for p in choices[i]:
     if any(math.dist(p,q)<7 for q in picked):continue
     result=choose(i+1,picked+[p])
     if result:return result
   selected=choose(0,[])
   if selected:break
  assert selected,('第一プラントへ届く基地4台の経路がない',team)
  base['catapultFlight']=flight;base['catapults']=[[*a,*b] for a,b in zip(starts,selected)]
  occupied.extend(starts+selected)
 for first,second in [('A','B'),('E','D')]:
  source,target=plants[first],plants[second];direction=(target-source)/np.linalg.norm(target-source)
  starts=sorted(candidates(source,23,44),key=lambda p:math.dist(p,source+direction*29))[:40]
  goals=sorted(candidates(target,19,42),key=lambda p:math.dist(p,target-direction*27))[:40]
  selected=None
  for flight in [4.6,5.0,5.4,5.8,6.2]:
   for a in starts:
    if any(math.dist(a,p)<9 for p in occupied):continue
    for b in goals:
     if any(math.dist(b,p)<8 for p in occupied) or math.dist(a,b)<55:continue
     if safe(a,b,flight):selected=(a,b,flight);break
    if selected:break
   if selected:break
  assert selected,('第一→第二プラントの経路がない',first,second)
  a,b,flight=selected;routes.append({'at':a,'exit':b,'plant':first,'targetPlant':second,'flight':flight});occupied.extend([a,b])
 return routes,occupied

def jump_pads(streets,bases,proposal,occupied,shelters):
 """両側4基ずつ。既存屋根を越え、歩いて別の街路へ抜ける候補を選ぶ。"""
 solids=streets.air;sky=shapely.union_all([p for p,lo,hi in solids]);roof_regions=[];covered=Polygon()
 for height in sorted({hi for p,lo,hi in solids},reverse=True):
  shapes=shapely.union_all([p for p,lo,hi in solids if hi==height])
  if 7<=height<=65:
   for p in parts(shapes.difference(covered).buffer(-4.5,quad_segs=3)):
    if p.area>24:roof_regions.append((p,height))
  covered=covered.union(shapes)
 roof_tree=shapely.STRtree([p for p,h in roof_regions])
 pads=[];routes=[]
 def escape(a,b,height):
  line=LineString([a,b]);distance=line.length
  xz=np.array(a)+(np.array(b)-a)*np.linspace(0,1,math.ceil(distance/.6)+1)[:,None]
  points=shapely.points(xz);columns=[]
  for i in streets.tree.query(line.buffer(1.45),predicate='intersects'):
   p,lo,hi=solids[i];columns.append((shapely.intersects(p.buffer(1.35,quad_segs=3),points),lo,hi))
  level=height
  for i in range(len(points)):
   here=[(lo,hi) for mask,lo,hi in columns if mask[i]]
   if any(hi>level+.25 and lo<level+4.1 for lo,hi in here):return False
   level=max([0,*[hi for lo,hi in here if hi<=level+.25]])
  return level<.1
 seeds=[[-250,30],[-180,45],[-120,-55],[-95,95],[10,-40],[75,100],[175,-15],[245,30]]
 plant_points=[p['at'] for p in proposal['plants']];pod_points=[s['at'] for s in shelters]
 for seed in seeds:
  ds=np.linalg.norm(streets.connected-seed,axis=1);near=streets.connected[np.argsort(ds)[:2000]][::3];choices=[]
  good=shapely.distance(sky,shapely.points(near))>3.8
  for start,keep in zip(near,good):
   if not keep or math.dist(start,seed)>58 or not streets.free(start,3.5):continue
   if any(math.dist(start,b['at'])<60 for b in bases.values()):continue
   if any(math.dist(start,p)<23 for p in plant_points) or any(math.dist(start,p)<10 for p in occupied+pod_points):continue
   if any(math.dist(start,p['at'][:2])<48 for p in pads):continue
   point=Point(start)
   for index in roof_tree.query(point.buffer(16),predicate='intersects'):
    roof,height=roof_regions[index];distance=roof.distance(point)
    if not 8<=distance<=14:continue
    q=np.array(nearest_points(point,roof)[1].coords[0]);direction=(q-start)/distance
    for length in range(32,105,4):
     end=start+direction*length
     if not streets.free(end,2.3) or any(math.dist(end,b['at'])<48 for b in bases.values()):continue
     if any(math.dist(end,p)<4 for p in plant_points) or any(math.dist(end,p)<7 for p in occupied+pod_points):continue
     # 川底や低い屋根を経由して、再び壁へ突き当たる候補は採用しない。
     if not streets.walk.covers(LineString([start,end])) or not escape(q,end,height):continue
     choices.append((math.dist(start,seed)+abs(distance-11)*2+length*.08,qpoint(start),qpoint(q),height,qpoint(end)));break
  assert choices,('隣の街路へ退出できるパッド候補がない',seed)
  _,start,roof,height,end=min(choices,key=lambda q:q[0])
  rise=min(100,math.ceil((height+30)/4)*4)
  pad={'at':[*start,0],'exit':[*roof,height],'rise':rise,'radius':3}
  pads.append(pad);routes.append({'at':pad['at'],'roof':pad['exit'],'street':[*end,0]})
  print(json.dumps({'pad':len(pads),'start':start,'roofHeight':height,'street':end}),flush=True)
 return pads,routes

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    policy=json.loads((ROOT/'research/maps/hoshimichi-west-rebuild-policy.json').read_text())
    maximum_map_bytes=policy['maximumMapFileBytes']
    proposal=json.loads((ROOT/'mapdesign/hoshimichi_west/layout-proposal.json').read_text())
    source=ROOT/'mapdesign/hoshimichi_west/rebuild/layout.json'
    data=json.loads(source.read_text());original=decode(data);land=surface(data,'dem');water=surface(data,'water')
    protected=shapely.union_all([polygon(v) for v in original if v[1]<4.2 and v[4].get('landmarkColor') in LANDMARK_COLORS])
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
        cut=clear if v[0] in [0,1,2] or v[1]<4.2 else sky_clear
        if not p.intersects(cut):volumes.append(v);continue
        removed_area=p.intersection(cut).area
        if removed_area<.005:volumes.append(v);continue
        if v[4].get('landmarkColor') in LANDMARK_COLORS:
            assert all(p.intersection(Point(q['at']).buffer(16)).area<.01 for q in proposal['plants']),('ランドマークが占拠円内',i)
            protected_kept.append({'index':i,'outsideCaptureCircleArea':round(removed_area,3)});volumes.append(v);continue
        removed.append({'index':i,'area':round(removed_area,2)})
        for part in parts(shapely.set_precision(p.difference(cut),.02)):
            if part.area>.1:volumes.append([*v[:3],pack_rings(rings(part)),v[4]])
    volumes+=extra
    # 地形確認済みの河川・道路橋・復帰斜面を保持する。
    bridges=surface(data,'streets');bridge_shapes=parts(bridges)
    pits=shapely.union_all([s['pit'].union(s['ramp']) for s in shelters])
    data['surfaces']['dem']=pack_surface(floor_mesh(land.difference(pits),0))
    data['surfaces']['ramps']=pack_surface(np.concatenate([unpack_surface(data['surfaces']['ramps']),np.array(ramp_mesh+pit_mesh)]))
    data['district'].update(
       bases=[{'team':t,'at':b['at'],'radius':31,'height':0} for t,b in bases.items()],
       repairShelters=[{k:v for k,v in s.items() if k not in ['pit','ramp']} for s in shelters])
    data['playBounds']=[-350,350,-175,175]
    data.pop('preview',None)
    data['volumeCount']=len(volumes);data['volumes']=volumes
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
    mobility,occupied=catapults(streets,bases,proposal)
    pads,pad_routes=jump_pads(streets,bases,proposal,occupied,shelters)
    occupied.extend(p['at'][:2] for p in pads)
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
                    if streets.free(q,1.8) and connection(q) and all(math.dist(q,v)>7 for v in slots+occupied):slots.append(q)
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
    for i,route in enumerate(mobility):anchors.extend([(f'plantcat-{i}',route['at']),(f'plantland-{i}',route['exit'])])
    for i,pad in enumerate(pads):anchors.append((f'pad-{i}',pad['at'][:2]))
    for i,route in enumerate(pad_routes):anchors.append((f'padstreet-{i}',route['street'][:2]))
    nav,navstats,_=build_navigation(streets,anchors,pairs)
    definition={'name':'星路西街区','order':7,'size':[450,450],'team':10,'time':600,'baseZ':base_z,'baseLine':380,
       'desc':'斜めに切り出した700×350mの街区。川と高架を挟み、A/Eの前衛・B/Dの中継・Cを争う。基地→第一→第二プラントの高角台と屋上へ上がる共有パッドを配置。',
       'terrain':[],'layout':[],'plants':[[p['id'],*p['at'],p['initialOwner']] for p in proposal['plants']],
       'turrets':turrets,'radar':radar,'catapults':[],'basePods':base_pods,'plantPods':[[s['plant'],*s['at']] for s in shelters],
       'barricades':[],'plantCatapults':mobility,'jumpPads':pads,'asym':True,'nav':nav,'bases':bases,'cityTerrain':data,
       'cityBattle':{'nodeReach':1.5,'respawns':respawns,'baseSpawns':base_spawns},
       'attribution':'国土交通省Project PLATEAU（東京都・千代田区・台東区・文京区）と国土地理院の公開データを加工。縮尺1/2、局所整地・鉄道の延長・道路橋の復元。出典と謝辞：https://github.com/chevi0t/core-breaker/blob/main/mapdesign/hoshimichi_west/CREDITS.md'}
    # 地上経路は補給室の入口へつなぎ、斜面・窪地の接地は本体で解く。
    (OUT/'map.json').write_bytes(compact(definition)+b'\n')
    (OUT/'layout.json').write_bytes(compact(data)+b'\n')
    header='// 承認済み星路西街区。出典・加工はmapdesign/hoshimichi_west/CREDITS.md。\n// tools/build_hoshimichi_west_rebuild_battle.pyで生成。\n'
    js=header+f'(window.MAP_DATA = window.MAP_DATA || {{}}).{ID} = '+compact(definition).decode()+';\n'
    assert len(js.encode())<=maximum_map_bytes,('施設・経路込みの容量上限を超過',len(js.encode()),maximum_map_bytes)
    (ROOT/f'prototype/maps/{ID}.js').write_text(js)
    report={'approvedCoordinatesKept':True,'removedVolumes':len(removed),'removedBuildingArea':round(sum(r['area'] for r in removed),1),
            'protectedRetained':protected_kept,'volumeCount':len(volumes),'geometryBytes':len(compact(data)),'mapDataBytes':len(compact(definition)),'mapFileBytes':len(js.encode()),
            'navigation':navstats,'jumpRoutes':pad_routes,'plantCatapults':mobility,'baseCatapults':bases,'bridgeDecks':[{'ring':[qpoint(q) for q in p.exterior.coords[:-1]],'height':0} for p in bridge_shapes],
            'shelters':data['district']['repairShelters'],'baseSpawns':{t:len(v) for t,v in base_spawns.items()},
            'maximumMapFileBytes':maximum_map_bytes,'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest()}
    (OUT/'generation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['geometryBytes','mapDataBytes','mapFileBytes','navigation','volumeCount']},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
