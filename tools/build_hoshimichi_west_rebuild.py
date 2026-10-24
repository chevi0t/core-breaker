"""PLATEAU元資料から街区単位の地形を再構築する。施設は配置せず、旧試遊版も書き換えない。"""
import argparse,base64,gzip,hashlib,json,math,pathlib
import numpy as np
import shapely
from shapely.geometry import Polygon,Point,LineString,box,shape
from shapely.affinity import rotate,translate,scale as resize
from shapely.ops import nearest_points
from PIL import Image
from plateau_city_geometry import building_masses,projection,parts,rings,extrusion
from build_hoshimichi_west import compact,pack_rings,pack_surface,floor_mesh,local_geo

ROOT=pathlib.Path(__file__).resolve().parents[1]

def exterior(p):return Polygon(p.exterior)
def weighted(values,weights,q=.5):
 order=np.argsort(values);v=np.asarray(values)[order];w=np.asarray(weights)[order];return float(v[min(len(v)-1,np.searchsorted(np.cumsum(w),w.sum()*q))])
def chaikin(p,times=1):
 a=np.asarray(p.exterior.coords[:-1]);
 for _ in range(times):
  b=np.roll(a,-1,axis=0);a=np.stack([.75*a+.25*b,.25*a+.75*b],axis=1).reshape(-1,2)
 return Polygon(a)

class GroundHeight:
 def __init__(self,source,center,angle):
  self.source=source;self.center=center;self.angle=math.radians(angle);self.tiles={}
  self.base=json.loads((source/'summary.json').read_text())['referenceElevation']
 def __call__(self,p):
  x,z=np.array(p)*2;e=x*math.cos(self.angle)+z*math.sin(self.angle);s=-x*math.sin(self.angle)+z*math.cos(self.angle)
  lon=self.center[0]+e/(111319.49*math.cos(math.radians(self.center[1])));lat=self.center[1]-s/110940
  px=(lon+180)/360*32768*256;py=(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*32768*256
  key=(int(px)//256,int(py)//256)
  if key not in self.tiles:
   path=self.source/'dem-cache'/f'{key[0]}-{key[1]}.png'
   if not path.exists():return 0
   rgb=np.array(Image.open(path).convert('RGB'),dtype=np.int64);raw=rgb[:,:,0]*65536+rgb[:,:,1]*256+rgb[:,:,2]
   v=np.where(raw>=2**23,raw-2**24,raw).astype(float)/100;v[raw==2**23]=np.nan;self.tiles[key]=v
  h=self.tiles[key][int(py)%256,int(px)%256]
  return float((h-self.base)*.5) if np.isfinite(h) else 0

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('source',type=pathlib.Path);ap.add_argument('--output',type=pathlib.Path,default=ROOT/'mapdesign/hoshimichi_west/rebuild');args=ap.parse_args();args.output.mkdir(parents=True,exist_ok=True)
 config=json.loads((ROOT/'research/maps/hoshimichi-west-sources.json').read_text());policy=json.loads((ROOT/'research/maps/hoshimichi-west-rebuild-policy.json').read_text());ref=json.loads((ROOT/'research/maps/hoshimichi-west-rebuild-reference.json').read_text());proposal=json.loads((ROOT/'mapdesign/hoshimichi_west/layout-proposal.json').read_text())
 D=box(-450,-275,450,275);P=box(-350,-175,350,175);rawfile=args.source/'geometry.npz';source_hash=hashlib.sha256(rawfile.read_bytes()).hexdigest();raw=np.load(rawfile)
 source_summary=json.loads((args.source/'summary.json').read_text())
 assert config['rotationDegrees']==30 and config['scale']==.5 and source_summary['rotationDegrees']==30
 assert source_summary['center']==config['referenceCenter'] and source_summary['halfExtents']==[900,550] and source_summary['geometrySHA256']==source_hash
 assert ref['center']==config['referenceCenter'] and ref['rotationDegrees']==30 and ref['scale']==.5
 # 同じ元資料と抽出プロファイルだけをキャッシュする。加工済み試遊版の形状は入力にしない。
 profile=dict(footprintPrecision=.08,minimumBuildingArea=4,minimumRoofArea=5,roofHeightStep=1,outlineTolerance=.3,tieredBuildingArea=1e12)
 cache=args.source/'rebuild-building-cache.json'
 cached=json.loads(cache.read_text()) if cache.exists() else {}
 if cached.get('sourceSHA256')!=source_hash or cached.get('profile')!=profile:
  _,volumes,_,_=building_masses(raw['bldg']*.5,D,Polygon(),profile,-.25,4.2)
  cached={'sourceSHA256':source_hash,'profile':profile,'volumes':volumes};cache.write_text(json.dumps(cached,separators=(',',':')))
 ground=GroundHeight(args.source,config['referenceCenter'],config['rotationDegrees']);buildings=[];heights=[]
 for v in cached['volumes']:
  p=exterior(Polygon(v['rings'][0]));h=max(4,round((v['top']-ground(p.representative_point().coords[0]))/2)*2)
  buildings.append(p);heights.append(h)
 tree=shapely.STRtree(buildings)
 print(json.dumps({'rawBuildings':len(buildings)}),flush=True)
 # 河川は格子標高の推定輪郭から、地理院のベクトル水面へ切り替える。
 water=shapely.union_all([chaikin(exterior(p).simplify(.5),1) for p in parts(shape(ref['water'])) if p.area>20]).intersection(D)
 # 地上鉄道の実際の線形を使い、東西線と南北線の高さを分ける。
 tracks={'eastWest':[],'northSouth':[]}
 theta=math.radians(config['rotationDegrees'])
 for row in ref['rails']:
  line=LineString(row['points']);a,b=np.array(line.coords[0]),np.array(line.coords[-1]);delta=b-a
  east=delta[0]*math.cos(theta)+delta[1]*math.sin(theta);south=-delta[0]*math.sin(theta)+delta[1]*math.cos(theta)
  kind='eastWest' if abs(east)>abs(south)*1.05 else 'northSouth'
  tracks[kind].append(line.buffer(2.4,cap_style=2,join_style=2))
 rail={k:shapely.union_all(v).buffer(.8,quad_segs=4).buffer(-.8,quad_segs=4).simplify(.35).intersection(D) for k,v in tracks.items()}
 rail_all=shapely.union_all(list(rail.values()))
 # 屋根の張り出しも建物の統合より先に予約する。線路だけを避けると庇がビルへ刺さる。
 station=np.array(local_geo(config['referenceCenter'],139.773124,35.698353,30))*.5
 ns_roof=rail['northSouth'].intersection(Point(station).buffer(68)).buffer(6,cap_style=2,join_style=2).difference(rail['eastWest'].buffer(.4)).intersection(D)
 ew_roof=rail['eastWest'].intersection(Point(station).buffer(57)).buffer(5,cap_style=2,join_style=2).intersection(D)
 railway_clearance=rail_all.buffer(1).union(ns_roof.buffer(.6)).union(ew_roof.buffer(.6))
 # 地理院道路で自治体ごとの欠測を補い、PLATEAUの広い道路も残す。
 roads=shapely.union_all([LineString(r['points']).buffer(r['width']/2,cap_style=2,join_style=2) for r in ref['roads']])
 q=raw['tran'].reshape(-1,3,3)*.5;n=np.cross(q[:,1]-q[:,0],q[:,2]-q[:,0]);horizontal=abs(n[:,1])/(np.linalg.norm(n,axis=1)+1e-12)>.65
 plateau_roads=projection(q[horizontal].reshape(-1,3),.08).buffer(-1.9,quad_segs=4).buffer(1.9,quad_segs=4)
 roads=roads.union(plateau_roads).buffer(.35,quad_segs=4).buffer(-.35,quad_segs=4).simplify(.4).intersection(D)
 # 過去に指定された駅周辺4本の通り抜けを、同じ地理位置で確保する。
 old_center=local_geo(config['referenceCenter'],139.7734,35.6986)
 legacy=[([-32,-232],[65,-232]),([-82,27],[33,37]),([-82,-14],[-82,66]),([33,-4],[33,116])]
 for a,b in legacy:
  line=LineString([np.array(a)+old_center,np.array(b)+old_center]);line=resize(rotate(line,30,origin=(0,0)),.5,.5,origin=(0,0));roads=roads.union(line.buffer(3,cap_style=2))
 # 街区に先に通路を作り、施設の候補地が閉じた中庭にならないようにする。
 sites=[box(*b['clear']) for b in proposal['bases']]+[Point(p['at']).buffer(17.4,quad_segs=8) for p in proposal['plants']]
 for site in sites:
  center=site.representative_point();near=nearest_points(center,roads)[1]
  roads=roads.union(LineString([center,near]).buffer(4,cap_style=2))
 reserved_sites=shapely.union_all(sites)
 # 道路橋を先に確定し、川の復帰斜面は橋桁の真下を避ける。
 q=raw['brid'].reshape(-1,3,3)*.5;n=np.cross(q[:,1]-q[:,0],q[:,2]-q[:,0]);horizontal=abs(n[:,1])/(np.linalg.norm(n,axis=1)+1e-12)>.65
 source_bridge=projection(q[horizontal].reshape(-1,3),.1)
 bridge=source_bridge.intersection(water.buffer(3)).difference(rail_all.buffer(.8)).intersection(roads.buffer(6)).buffer(.4,quad_segs=2).buffer(-.4,quad_segs=2)
 bridge=shapely.union_all([p.minimum_rotated_rectangle for p in parts(bridge) if p.area>15]).intersection(water.buffer(5)).intersection(D)
 # 川へ落ちたときは、ブーストがなくても歩いて戻れる斜面を両岸へ設ける。
 ramp_shapes=[];ramp_faces=[];ramp_records=[];recovery_links=[]
 for base_z in range(-135,136,65):
  for sign in [-1,1]:
   for offset in [0,8,-8,16,-16,24,-24]:
    z=base_z+offset;cut=water.intersection(LineString([(-450,z),(450,z)]))
    if cut.is_empty:continue
    lo,_,hi,_=cut.bounds;x=lo if sign<0 else hi
    edge=nearest_points(Point(x,z),water.boundary)[1];e=np.array(edge.coords[0]);inside=e-np.array([sign*3.5,0]);outside=e+np.array([sign*7,0])
    corridor=LineString([inside,outside]).buffer(3.5,cap_style=2)
    if corridor.intersection(bridge.buffer(2)).area<.1:break
   else:raise ValueError(('橋を避けた復帰斜面の場所がない',base_z,sign))
   ramp_shapes.append(corridor)
   pts=np.array([[inside[0],-5,inside[1]-3.5],[inside[0],-5,inside[1]+3.5],[outside[0],0,outside[1]+3.5],[outside[0],0,outside[1]-3.5]])
   bank_side=box(-450,-275,e[0]-1,275) if sign<0 else box(e[0]+1,-275,450,275)
   bank_roads=roads.difference(water.buffer(2)).intersection(bank_side)
   street=np.array(nearest_points(Point(outside+np.array([sign*5,0])),bank_roads)[1].coords[0])
   recovery_links.append(LineString([outside,street]).buffer(4,quad_segs=4))
   ramp_faces.extend(pts[[0,1,2,0,2,3]].tolist());ramp_records.append({'start':[round(inside[0],2),-5,round(inside[1],2)],'end':[round(outside[0],2),0,round(outside[1],2)],'street':[round(street[0],2),0,round(street[1],2)],'width':7})
 ramps=shapely.union_all(ramp_shapes)
 roads=roads.union(ramps.buffer(1)).union(shapely.union_all(recovery_links))
 # 目印は元の建物との交差で取り出す。元の細かい街区を複製しない。
 marks=json.loads((ROOT/'research/maps/hoshimichi-west-landmarks.json').read_text());dx,dz=local_geo(config['referenceCenter'],*marks['referenceCenter']);landmarks=[]
 for m in marks['landmarks']:
  footprint=resize(rotate(translate(Polygon(m['rings'][0],m['rings'][1:]),dx,dz),30,origin=(0,0)),.5,.5,origin=(0,0))
  matches=[(buildings[i].intersection(footprint.buffer(.3)),heights[i]) for i in tree.query(footprint,predicate='intersects')]
  selected=[(p,h) for p,h in matches if p.area>2]
  if not selected:continue
  merged=shapely.union_all([p for p,h in selected]);height=weighted([h for p,h in selected],[p.area for p,h in selected],.7)
  for p in parts(merged):
   p=exterior(p).simplify(.45).intersection(D).difference(water).difference(railway_clearance).difference(shapely.union_all(recovery_links).buffer(.2))
   for part in parts(p):
    if part.area>3:landmarks.append({'shape':part,'top':height,'color':m['color'],'name':m['name']})
 landmark_union=shapely.union_all([m['shape'] for m in landmarks])
 # 高架と建物は同じ水平マスクで分離し、全高にわたりめり込みを除く。
 road_mask=roads.union(water).union(railway_clearance).intersection(D)
 parcels=[p for p in parts(D.difference(road_mask)) if p.area>45]
 volumes=[];solid_shapes=[];blocks=[];palette=['#9baeb4','#b4aea1','#aab4b0','#879da6','#b4a48e','#999c9b']
 def emit(p,lo,hi,kind=0,meta=None):
  for piece in parts(shapely.set_precision(p,.02)):
   if piece.area>2 and hi>lo:
    volumes.append([kind,round(lo,2),round(hi,2),pack_rings(rings(piece)),meta or {}])
    if kind!=3:solid_shapes.append((piece,round(hi,2),meta or {}))
 for index,parcel in enumerate(parcels):
  source_ids=list(tree.query(parcel,predicate='intersects'))
  source_shapes=[buildings[i].intersection(parcel) for i in source_ids];pairs=[(p,heights[i]) for p,i in zip(source_shapes,source_ids) if p.area>2]
  if not pairs:continue
  footprint=shapely.union_all([p for p,h in pairs]);coverage=footprint.area/parcel.area
  if coverage<.08:continue
  body=footprint.convex_hull.intersection(parcel).buffer(-.6,quad_segs=2).simplify(.55).intersection(parcel)
  if body.is_empty:continue
  # 独立した空地を丸ごと抱き込む低密度区画は、元の建物群に近い範囲へ絞る。
  if body.area>footprint.area*2.5:body=footprint.buffer(2,quad_segs=2).buffer(-2,quad_segs=2).simplify(.6).intersection(parcel)
  split=[]
  for active,zone in [(True,P),(False,D.difference(P))]:
   for piece in parts(body.intersection(zone)):
    if piece.area>8:split.append((active,piece))
  for active,piece in split:
   if piece.area<8:continue
   values=[h for p,h in pairs];weights=[p.area for p,h in pairs];base=weighted(values,weights,.5)
   height=max(5,round(base/2)*2) if active else min(16,max(5,round(base*.55/2)*2))
   build_shape=piece.difference(reserved_sites).difference(landmark_union)
   pieces=parts(build_shape);count=0
   for b in pieces:
    if b.area<8:continue
    if not active and b.area>2800:
     # 大きい背景街区を最高高さの箱へ潰さず、低い2つの街並みに分ける。
     x0,z0,x1,z1=b.bounds
     cuts=[box(x0-1,z0-1,(x0+x1)/2-1.5,z1+1),box((x0+x1)/2+1.5,z0-1,x1+1,z1+1)] if x1-x0>z1-z0 else [box(x0-1,z0-1,x1+1,(z0+z1)/2-1.5),box(x0-1,(z0+z1)/2+1.5,x1+1,z1+1)]
     for c in cuts:emit(b.intersection(c).simplify(1.5),-.25,height,0,{'landmarkColor':'#8b9796'});count+=1
    else:emit(b,-.25,height,0,{'paint':index%len(palette)} if active else {'landmarkColor':'#8b9796'});count+=1
   upper=[]
   if active and piece.area>900:
    candidates=sorted([(h,p) for p,h in pairs if h>height+8 and p.area>60],key=lambda q:q[0],reverse=True)
    for h,p in candidates:
     tower=p.minimum_rotated_rectangle.intersection(piece).difference(reserved_sites).difference(landmark_union)
     if tower.is_empty or tower.area<30 or any(tower.intersection(q).area>tower.area*.1 for q in upper):continue
     emit(tower,height,h,1,{'paint':index%len(palette)});upper.append(tower);count+=1
     if len(upper)>=2:break
   blocks.append({'id':index,'active':active,'sourceBuildings':len(pairs),'objects':count,'baseHeight':height,'area':round(piece.area,1),'ring':np.round(np.array(piece.exterior.coords),2).tolist()})
 for m in landmarks:
  footprint=m['shape'].difference(reserved_sites)
  for p in parts(footprint):emit(p,-.25,m['top'],0,{'landmarkColor':m['color'],**({'facade':'glass'} if m['name']=='glass_tower' else {})})
 # 高架下の店舗は地上の道路・川・復帰斜面を空け、交差部も通せるようにする。
 for kind,top,color in [('northSouth',6.5,'#9db3b8'),('eastWest',13,'#b7aa8f')]:
  emit(rail[kind],top-1,top,3,{'landmarkColor':color})
  shop=rail[kind].difference(roads.buffer(.6)).difference(water).difference(reserved_sites)
  if kind=='eastWest':shop=shop.difference(rail['northSouth'].buffer(1))
  emit(shop,-.25,top-1,0,{'landmarkColor':'#737e81'})
 # 駅屋根も実線路に沿わせる。重なる上下階の間には機体が通れる余裕を取る。
 emit(ns_roof,12.2,12.5,3,{'landmarkColor':'#dce1df'});emit(ew_roof,18.7,19.2,3,{'landmarkColor':'#dce1df'})
 # 各高さの壁を機体半径1.3mで膨張し、街路へ歩いて下れない閉じた低所を塞ぐ。
 # 空中着地だけで入れる中庭・低い屋根も対象にする。道路・河川・施設候補地は埋めない。
 caps=[]
 for height in sorted({h for p,h,m in solid_shapes},reverse=True):
  tall=shapely.union_all([p for p,h,m in solid_shapes if h>=height])
  for radius in [0,1.3]:
   for cluster in parts(tall.buffer(radius,quad_segs=3)):
    for ring in cluster.interiors:
     pocket=Polygon(ring).intersection(P)
     if pocket.area<3:continue
     cap=pocket.buffer(radius+.1,quad_segs=3).difference(tall.buffer(-.02))
     protected=roads.union(water).union(reserved_sites)
     assert pocket.intersection(protected).area<.5,('閉所を通路の拡幅で解消する必要がある',height,list(pocket.bounds))
     cap=cap.difference(protected)
     if cap.area<2:continue
     color=max(solid_shapes,key=lambda q:q[0].intersection(cap.buffer(.5)).area)[2]
     emit(cap,-.25,height,2,color)
     caps.append({'height':height,'area':round(cap.area,2),'at':np.round(pocket.representative_point().coords[0],2).tolist()})
 land=D.difference(water);floor=land.difference(ramps)
 surfaces={'dem':pack_surface(floor_mesh(floor,0)),'water':pack_surface(floor_mesh(water,-3)),'bed':pack_surface(floor_mesh(water,-5)),'ramps':pack_surface(np.array(ramp_faces)),'streets':pack_surface(floor_mesh(bridge,0))}
 # 川岸の壁も同じ水面輪郭から作り、復帰斜面の開口を空ける。
 banks=[]
 for p in parts(water):
  ring=np.asarray(p.exterior.coords)
  for a,b in zip(ring,ring[1:]):
   edge=LineString([a,b]).difference(ramps.buffer(.05))
   for segment in shapely.get_parts(edge):
    if segment.geom_type!='LineString' or segment.length<.05:continue
    x,z=segment.coords[0];xx,zz=segment.coords[-1];banks.extend([[x,-5,z],[xx,-5,zz],[x,0,z],[xx,-5,zz],[xx,0,zz],[x,0,z]])
 surfaces['bank']=pack_surface(np.array(banks))
 data={'geometryEncoding':'city-layout-v1','half':450,'halfExtents':[450,275],'playBounds':[-350,350,-175,175],
  'ringCoordinateStep':.02,'groundMaximum':.1,'spawns':[],'district':{'bases':[],'roofPads':[],'unifiedGround':{'color':'#68777a'},'facadeScale':.5,'buildingPalette':palette},
  'landmarks':[],'streetRepairs':[],'heritage':{},'river':{'bed':-5,'water':-3,'rings':[],'exits':ramp_records},
  'volumeKinds':['grounded','upper','infill','elevated'],'volumes':volumes,'volumeCount':len(volumes),'surfaces':surfaces,'decorations':[],'packing':{'encoding':'city-layout-v1','layers':{}},
  'preview':{'playable':[[-350,-175],[350,-175],[350,175],[-350,175]],'previous':[],'labels':[{'text':q['text'],'at':(np.array(local_geo(config['referenceCenter'],*q['geo'],30))*.5).tolist()} for q in config['display']['labels']],
   'rotationDegrees':30,'terrainDeformed':False,'drawingExtent':[900,550],'playableExtent':[700,350]}}
 data_bytes=compact(data);assert len(data_bytes)<policy['maximumMapFileBytes']-20000,('施設・経路用の予算を残す',len(data_bytes))
 (args.output/'layout.json').write_bytes(data_bytes+b'\n')
 (args.output/'blocks.json').write_text(json.dumps(blocks,ensure_ascii=False,separators=(',',':'))+'\n')
 report={'sourceGeometrySHA256':source_hash,'sourceBuildings':len(buildings),'parcels':len(parcels),'blocks':len(blocks),'activeBlocks':sum(b['active'] for b in blocks),'backgroundBlocks':sum(not b['active'] for b in blocks),
  'volumes':len(volumes),'landmarkParts':len(landmarks),'riverVertices':sum(len(p.exterior.coords)-1 for p in parts(water)),'riverArea':round(water.area,1),'railSourceSegments':len(ref['rails']),
  'terrainBytes':len(data_bytes)+1,'maximumMapFileBytes':policy['maximumMapFileBytes'],'reservedForFacilitiesBytes':policy['maximumMapFileBytes']-len(data_bytes)-1,'riverExits':len(ramp_records),'landingPocketCaps':caps,
  'stage':'地形の再構築。基地・プラントは候補地の空きだけ保持し、設備は未設置。','sourceLayers':['PLATEAU建物','PLATEAU道路','PLATEAU橋梁','国土地理院RdCL','国土地理院RailTrCL','国土地理院WA']}
 (args.output/'generation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False),flush=True)
 # 既存の描画復元器と、単独で開ける地形確認画面を使う。
 source=(ROOT/'prototype/index.html').read_text();expand=source[source.index('function expandCityLayout('):source.index('// 肩越し視点')]
 html=(ROOT/'tools/hoshimichi_west_rebuild_viewer.html').read_text().replace('/*__THREE__*/',(ROOT/'vendor/three-r128/three.min.js').read_text()).replace('/*__VOLUME_CODEC__*/',(ROOT/'tools/city_volume_codec.js').read_text()).replace('/*__EXPAND__*/',expand)
 html=html.replace('/*__PAYLOAD__*/',json.dumps(base64.b64encode(gzip.compress(data_bytes,mtime=0)).decode())).replace('__LICENSE__',(ROOT/'vendor/three-r128/LICENSE').read_text())
 (args.output/'preview.html').write_text(html)

if __name__=='__main__':main()
