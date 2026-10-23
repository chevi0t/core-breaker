#!/usr/bin/env python3
"""確認済み都市メッシュを、本体の機体で歩けるオフライン試走HTMLに接続する。

公開ゲームや maps.js は変更しない。置換箇所が変わった本体では停止して再確認を促す。
"""
import argparse
import base64
import gzip
import hashlib
from html import escape
import json
import pathlib
import re

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box

from simplify import clip_footprint, extrusion, parts, projection, rings
from trial_river import add_exits
from trial_district import refine, building_colors, access_routes, mark_landmarks
from trial_streets import repair, smooth_heritage
from trial_simplify import flatten_ground, floor_mesh, join_railways, unify_ground
from trial_blocks import reshape
from trial_pack import pack_meshes

ROOT = pathlib.Path(__file__).resolve().parents[2]


def replace(s, old, new):
    if s.count(old) != 1:
        raise ValueError(f'本体の形が変わっています。試走接続を再確認してください: {old[:90]}')
    return s.replace(old, new)


def inline_js(text):
    return text.replace('</script', '<\\/script')


def make_payload(source):
    html = (source / 'preview.html').read_text()
    packed = json.loads(re.search(r'let payload=(.*);\nif\(typeof payload', html)[1])
    payload = json.loads(gzip.decompress(base64.b64decode(packed))) if isinstance(packed, str) else packed
    meta = payload['meta']
    meshes = {k: np.frombuffer(base64.b64decode(v), dtype='<f4').reshape(-1, 3).copy() for k, v in payload['data'].items()}
    half = meta['extentMeters'] / 2
    profile = json.loads((ROOT/'research/maps/akihabara-trial.json').read_text())
    land = projection(meshes['dem'], precision=.001)
    shore_cut=Polygon(profile['heritage']['shoreCut'])
    trimmed_area=land.intersection(shore_cut).area
    land=land.difference(shore_cut)
    # 河道を埋めず、旧駅側の岸を少し切り下げて格子状の輪郭を直線へそろえる。
    for k in ['dem','tran']:meshes[k]=clip_footprint(meshes[k],box(-half,-half,half,half).difference(shore_cut))
    gaps = sorted(parts(box(-half,-half,half,half).difference(land)),key=lambda p:-p.area)
    river, edge_gaps = gaps[0], gaps[1:]
    river_parts = [river]
    assert 20000 < river.area < 30000 and sum(p.area for p in edge_gaps)<250, '川以外の欠測が増えていないか確認'
    # 面削減で四隅にできた小欠けは地面で閉じる。川の水面には含めない。
    fill=[]
    for p in edge_gaps:
        at=np.array(p.representative_point().coords[0]);d2=np.sum((meshes['dem'][:,[0,2]]-at)**2,axis=1)
        y=float(meshes['dem'][np.argmin(d2),1]);fill.append(extrusion(p,y-.5,y,floor=False))
    meshes['fill']=np.concatenate(fill)
    bed, water = -9.0, -5.5  # 試走用の仮の高さ。水は既存マップと同じ見た目だけ。
    meshes['bed'] = np.concatenate([extrusion(p, bed-.5, bed) for p in river_parts])
    water_mesh = np.concatenate([extrusion(p, water-.01, water, floor=False) for p in river_parts]).reshape(-1,3,3)
    meshes['water'] = water_mesh[np.all(np.abs(water_mesh[:,:,1]-water)<.0001,axis=1)].reshape(-1,3)
    simplification=flatten_ground(meshes,land,profile['groundSimplification'])
    # 坂の端の高さ参照だけは矩形平面を使う。描画・衝突の地面は陸地内に限る。
    original_ground=floor_mesh(box(-half,-half,half,half),profile['groundSimplification']['height'])
    meshes['fill']=floor_mesh(shapely.union_all(edge_gaps),profile['groundSimplification']['height'])
    # DEMの境界辺をそのまま下へ延ばし、川岸の隙間を閉じる（外周の切断辺は除く）。
    volumes = json.loads((source/'collision-volumes.json').read_text())['volumes']
    landmark_specs=json.loads((ROOT/'research/maps/akihabara-landmarks.json').read_text())['landmarks']
    landmarks=mark_landmarks(volumes,landmark_specs)
    street_repairs=repair(meshes,volumes,land,profile)
    heritage=smooth_heritage(meshes,volumes,land,profile['heritage'],original_ground)
    heritage['trimmedShoreArea']=round(trimmed_area,2)
    rail_gap, link_colors=join_railways(meshes,volumes,land,profile)
    block_edits=reshape(meshes,volumes,land,profile)
    district, cross_colors = refine(meshes, volumes, land, profile, rail_gap)
    district['blockEdits']=block_edits
    district['groundSimplification']=simplification
    district['railGap']=rail_gap
    dem = np.round(np.concatenate([meshes['dem'],meshes['historicGround'],meshes['plazas']]).reshape(-1,3,3),3)
    exits,ramp_cut=add_exits(meshes,volumes,land,river,bed)
    district['unifiedGround']=unify_ground(meshes,river,profile['groundSimplification'])
    edges = {}
    for tri in dem:
        for a, b in zip(tri, np.roll(tri, -1, axis=0)):
            key = tuple(sorted((tuple(a[[0,2]]), tuple(b[[0,2]]))))
            edges.setdefault(key, []).append((a,b))
    bank = []
    for copies in edges.values():
        if len(copies) != 1:
            continue
        a,b = copies[0]
        if any(abs(a[axis]-sign*half)<.002 and abs(b[axis]-sign*half)<.002 for axis in [0,2] for sign in [-1,1]):
            continue
        if river.boundary.distance(Point(*((a[[0,2]]+b[[0,2]])/2)))>.003:
            continue
        segments=LineString([a[[0,2]],b[[0,2]]]).difference(ramp_cut)
        if segments.is_empty:continue
        for segment in getattr(segments,'geoms',[segments]):
            if segment.geom_type!='LineString':continue
            endpoints=[]
            for x,z in [segment.coords[0],segment.coords[-1]]:
                t=np.linalg.norm(np.array([x,z])-a[[0,2]])/np.linalg.norm(b[[0,2]]-a[[0,2]])
                endpoints.append(np.array([x,a[1]+t*(b[1]-a[1]),z]))
            aa,bb=endpoints;c,d=aa.copy(),bb.copy();c[1]=d[1]=bed
            bank.extend([aa,bb,c,bb,d,c])
    bank=np.array(bank,dtype='<f4').reshape(-1,3,3)
    historic=shapely.union_all([Polygon(r[0],r[1:]) for r in heritage['rings']])
    brick=shapely.distance(historic,shapely.points(bank.mean(axis=1)[:,[0,2]]))<12
    meshes['bank']=bank[~brick].reshape(-1,3)
    meshes['historicWall']=bank[brick].reshape(-1,3)
    # 地形確認の開始地点を維持し、今回指定された両基地と登り口を追加する。
    spawns = [
        {'name':'大通り', 'at':[-185,0,-50], 'surface':'ground'},
        {'name':'駅の屋根', 'at':[-25,25.5,40], 'surface':'roof'},
        {'name':'南北の高架', 'at':[-47,8,165], 'surface':'rail'},
        {'name':'東西の高架', 'at':[-160,18,12], 'surface':'rail'},
        {'name':'川底', 'at':[-150,bed,176], 'surface':'river'},
    ]
    spawns += [{'name': b['name'], 'at': b['spawn'], 'surface': 'ground'} for b in district['bases']]
    spawns += [{'name': p['name']+'・乗り場', 'at': [p['at'][0]+5,p['at'][2],p['at'][1]], 'surface': 'ground'} for p in district['roofPads']]
    spawns += [{'name':'川沿いの高架店舗','at':[-248,0,198],'surface':'ground'}]
    colors = {k:meta[k+'ColorRanges'] for k in ['rail','station','shops']}
    colors.update(crossShops=cross_colors, railLinkShops=link_colors, bldg=building_colors(meshes,volumes))
    present={v.get('landmark') for v in volumes}
    district['clearing']['removedLandmarks']=[v['id'] for v in landmarks if v['id'] not in present]
    landmarks=[v for v in landmarks if v['id'] in present]
    # コアの台座・支柱は本体のモデルを描き、都市の接触判定にも同じ位置を登録する。
    for b in district['bases']:
        x,z=b['at'];y=b['height']
        for footprint, top in [(Point(x,z).buffer(10,quad_segs=6),2),(box(x-6,z-6,x+6,z+6),16)]:
            volumes.append({'kind':'base-core','team':b['team'],'bottom':y,'top':y+top,'rings':rings(footprint)})
    district['accessRoutes']=access_routes(meshes,volumes,land,district)
    packed_meshes, packing=pack_meshes(meshes,volumes)
    result = {'half':half,'meshes':packed_meshes,'geometryEncoding':packing['encoding'],'packing':packing,
        'colors':colors,'volumes':volumes,'spawns':spawns,'district':district,'landmarks':landmarks,'streetRepairs':street_repairs,'heritage':heritage,
        'river':{'bed':bed,'water':water,'rings':[rings(p) for p in river_parts],'area':round(river.area,2),'exits':exits},
        'groundMaximum':max(float(meshes[k][:,1].max()) for k in
            ['dem','tran','fill','plazas','ramps','aprons','streets','historicGround'] if len(meshes[k]))+.5}
    return result


def build(source, out, *, data=None, layout_runtime='', variant=False):
    data = make_payload(source) if data is None else data
    packed = base64.b64encode(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=9,mtime=0)).decode()
    s = (ROOT/'prototype/index.html').read_text()
    s = re.sub(r'<link[^>]+href="https://fonts\.googleapis\.com[^>]+>\n','',s)
    s = '<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'+s
    for url,path in [('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js','vendor/three-r128/three.min.js'),
                     ('sounds.js','prototype/sounds.js'),('music.js','prototype/music.js')]:
        s = replace(s,f'<script src="{url}"></script>','<script>'+inline_js((ROOT/path).read_text())+'</script>')
    definition = dict(name='星路駅前試験区'+('・再構築案' if variant else ''),size=[300,300],team=1,time=86400,baseZ=280,baseLine=300,
        desc='地形と両基地の位置確認。高層棟へは緑のジャンプパッドから。',
        terrain=[],layout=[],plants=[],turrets=[],radar=[],catapults=[],basePods=[],plantPods=[],barricades=[],
        asym=True,bases={b['team']:{'at':b['at'],'radius':b['radius']} for b in data['district']['bases']},jumpPads=data['district']['roofPads'])
    s=replace(s,'<script src="maps.js"></script>','<script>window.MAP_DATA={city_trial:'+json.dumps(definition,ensure_ascii=False)+'};</script>')
    s=replace(s,'function terrainH(x, z) {','function terrainH(x, z) {\n  return CITY.terrainH(x,z);')
    s=replace(s,'function resolve(u) {','function resolve(u) {\n  return CITY.resolve(u);')
    s=replace(s,'function groundAt(x, z, y) {','function groundAt(x, z, y) {\n  return CITY.groundAt(x,z,y);')
    s=replace(s,'function ceilingAt(x, z, y) {','function ceilingAt(x, z, y) {\n  return CITY.ceilingAt(x,z,y);')
    s=replace(s,'if (th - py > 0.05 + len * 1.1) return false;','if (th - py > 0.45 + len * 1.1) return false; // 都市モデルの道路縁の段差を越える')
    s=replace(s,'  buildGround();\n  buildRoads(def.roads);\n  buildBoxes(def.layout);\n  buildWater(def.water);\n  buildBridges(def.bridges);',
        '  TERRAIN_MAX = CITY.groundMaximum;\n  CITY.mount(mapRoot,hittables);')
    s=replace(s,"function spawnPos(u, at) {", "function spawnPos(u, at) {\n  const point=CITY.spawns[Number(document.getElementById('trialSpawn').value)||0];\n  u.pos.fromArray(point.at);\n  if(point.surface==='ground')u.pos.y=terrainH(u.pos.x,u.pos.z);\n  resolve(u);\n  return;")
    s=replace(s,'  for (let i = 1; i < count; i++) makeUnit(chosenTeam, false, i);\n  for (let i = 0; i < count; i++) makeUnit(chosenTeam === \'B\' ? \'R\' : \'B\', false, i);','  // 地形確認が終わるまではプレイヤー1機だけ。')
    s=replace(s,'    timeLeft -= dt;','    // 試走では制限時間を進めない。')
    s=replace(s,'  if (!VS) { buildTurrets(def.turrets); buildRadars(def.radar); }','  // 基地の位置確認段階。防衛・補給施設は配置確定後に置く。')
    s=replace(s,'  if (!VS) buildUmbrellas();','  if (!VS) buildUmbrellas();\n  CITY.addCameraGeometry(hittables.filter(m=>!m.name.startsWith("city-collision-")));')
    s=replace(s,'  g.position.set(t.baseX, 0, t.baseZ);','  g.position.set(t.baseX, CITY.base(k).height, t.baseZ);')
    s=replace(s,'pos: new T.Vector3(t.baseX, 19, t.baseZ)','pos: new T.Vector3(t.baseX, CITY.base(k).height+19, t.baseZ)')
    s=replace(s,'  pad.position.set(t.baseX, 0.04, t.baseZ);','  pad.position.set(t.baseX, CITY.base(k).height+0.04, t.baseZ);')
    s=replace(s,'roof.position.set(TEAM[k].baseX, (UMBRELLA_TOP + UMBRELLA_EDGE) / 2, TEAM[k].baseZ);','roof.position.set(TEAM[k].baseX, CITY.base(k).height+(UMBRELLA_TOP + UMBRELLA_EDGE) / 2, TEAM[k].baseZ);')
    s=replace(s,'rim.position.set(TEAM[k].baseX, UMBRELLA_EDGE, TEAM[k].baseZ);','rim.position.set(TEAM[k].baseX, CITY.base(k).height+UMBRELLA_EDGE, TEAM[k].baseZ);')
    s=replace(s,'function drawMapOn(mini, W, H, bg, k, big = false) {','function drawMapOn(mini, W, H, bg, k, big = false) {\n  return CITY.drawMap(mini,W,H,player);')
    s=re.sub(r'^const mapInfo = d => .*?;$',"const mapInfo = d => '地形・基地試走・敵機なし・時間制限なし・600×600m';",s,flags=re.M)
    s=replace(s,'function drawMapPreview(cv, d) {',"function drawMapPreview(cv, d) {\n  CITY.drawMap(cv.getContext('2d'),cv.width,cv.height,null); return;")
    s=replace(s,"  const g = c.getContext('2d'), img = g.createImageData(W, H);", "  CITY.drawMap(c.getContext('2d'),W,H,null); return c;\n  const g = c.getContext('2d'), img = g.createImageData(W, H);")
    # 地形の対比を保ち、遠くの高層棟も試走中に確認できるようにする。
    s=replace(s,'scene.fog = new T.Fog(0x9fb4c4, 110, 420);','scene.fog = new T.Fog(0x9fb4c4, 220, 850);')
    s=replace(s,'  camera.position.copy(pivot).addScaledVector(dir, -CAM.back);\n  camera.position.y = Math.max(terrainH(camera.position.x, camera.position.z) + 0.8, camera.position.y);\n  camera.position.y = Math.min(camera.position.y, ceilingAt(camera.position.x, camera.position.z, u.pos.y) - 0.3); // 橋の下では床の下から見る\n  camera.lookAt(pivot.clone().addScaledVector(dir, 50));',
        '  const pose=CITY.cameraPose(u,camera,dir,dt);\n  camera.position.copy(pose.position);\n  camera.lookAt(pose.target);')
    s=replace(s,'function renderView() {','function renderView() {\n  const hideOwn=CITY.cameraTooClose(player,camera),ownVisible=player?.group.visible;\n  if(hideOwn)player.group.visible=false;')
    s=replace(s,'  finally { if (shaken) { camera.quaternion.copy(blastViewBase); camera.updateMatrixWorld(); } }',
        '  finally { if(hideOwn)player.group.visible=ownVisible; if (shaken) { camera.quaternion.copy(blastViewBase); camera.updateMatrixWorld(); } }')
    s=replace(s,'function viewAim(u) {\n  const dir = camera.getWorldDirection(new T.Vector3());\n  const from = camera.position.clone().addScaledVector(dir, CAM.back - 1);',
        'function viewAim(u) {\n  const dir = camera.getWorldDirection(new T.Vector3());\n  const from = camera.position.clone().addScaledVector(dir,camera.near); // 視点が寄っても目の前の壁を照準から飛ばさない')
    s=replace(s,'<title>','<title>地形試走 — ')
    runtime=(ROOT/'tools/plateau/trial_runtime.js').read_text()
    if layout_runtime:
        runtime=replace(runtime,'  const decode=b=>', '  expandCityLayout(T,data);\n  const decode=b=>')
        runtime=layout_runtime+'\n'+runtime
    s=replace(s,'<script>\n(() => {\nconst T = THREE;','<script>\n(async () => {\nconst T = THREE;\n'+(ROOT/'tools/plateau/trial_camera.js').read_text()+'\n'+runtime+'\nconst CITY = await createCityTrial(T,"'+packed+'");')
    options=''.join(f'<option value="{i}">{p["name"]}</option>' for i,p in enumerate(data['spawns']))
    credits=(source/'CREDITS.md').read_text()+'\n\n試走版の川底・護岸・水面は制作側の仮設形状です。現実の水位・水深を示しません。川岸へ戻るスロープと通路を作成し、接続部の地面と低層棟を局所的に加工しています。路地の充填を一部除去し、東西高架下の店舗と両基地の広場を追加しています。建物の色・窓・ガラス面・レンガ壁は制作側の模式表現です。道路の継ぎ目・歩道橋の下面・旧駅付近の地面を整形しています。位置照合ではOpenStreetMap contributorsの施設点と国土地理院の住所検索を参照しました。参照点の記録はresearch/maps/akihabara-landmarks.json。地理データの加工部分はCC BY 4.0。\n\n'+(ROOT/'sounds/CREDITS.md').read_text()+'\n\n'+(ROOT/'vendor/three-r128/LICENSE').read_text()
    if variant:
        credits+='\n\nこの再構築案は、PLATEAU由来の配置を参照して街区を統合し、屋上の段差と小さな凹凸を省略したゲーム用の模式形状です。建物と高架・店舗を輪郭と高さから組み立てます。現実の建築形状・店舗構成を正確に再現したものではありません。'
    panel='<div id="trialPanel">'+('街区を再構築した案 · ' if variant else '')+'地形・基地位置の試走 · 敵機なし <label>開始地点 <select id="trialSpawn">'+options+'</select></label><button id="trialReset" type="button">選択地点へ戻る</button><small>WASD 移動／Shift ブースト／Space ジャンプ／M 地図／Esc メニュー<br>南東に青基地、北西に橙基地。緑のジャンプパッドで上昇後、空中操作で高層棟の屋上へ。川からは緑のスロープで復帰。</small><details><summary>出典・ライセンス</summary><pre>'+escape(credits)+'</pre></details></div>'
    s=replace(s,'</body>',panel+'</body>') if '</body>' in s else s # 本体はbody閉じタグを省略している版もある。
    if 'id="trialSpawn"' not in s:s=replace(s,'<script>\n(async () => {',panel+'<script>\n(async () => {')
    css='<style>#trialPanel{position:fixed;left:14px;top:14px;z-index:300;background:#142330ed;border:1px solid #80b7ca;padding:12px;border-radius:7px;color:#dceef4;font:13px system-ui;max-width:390px}#trialPanel label{margin-left:8px}#trialPanel small{display:block;margin:7px 0;line-height:1.6}#trialPanel a{color:#b6d8e5}#trialPanel select,#trialPanel button{padding:5px;margin:3px;background:#294458;color:white;border:1px solid #719db0}body.trialRunning #trialPanel{opacity:.28;pointer-events:none}body.trialRunning #trialPanel small,body.trialRunning #trialPanel a,body.trialRunning #trialPanel button,body.trialRunning #trialPanel label{display:none}</style>'
    css=css.replace('<style>','<style>#top,#teamChoice{display:none!important}')
    css=css.replace('</style>','#trialPanel pre{white-space:pre-wrap;max-height:40vh;overflow:auto;font:11px/1.6 system-ui}body.trialRunning #trialPanel details{display:none}</style>')
    s=replace(s,'</style>','</style>'+css)
    expose="""
document.getElementById('trialReset').onclick=()=>{if(player){spawn(player);updateCamera(player,.05);}};
document.getElementById('trialSpawn').onchange=()=>{if(player){spawn(player);updateCamera(player,.05);}};
function pauseTrial(){
 if(!running)return;
 running=false;mouseDown=rightDown=false;mapOpen=false;stopMovementSounds();
 for(const k in keys)delete keys[k];for(const k in pressed)delete pressed[k];
 document.getElementById('overlay').hidden=false;showPage('pgMenu');
 document.getElementById('start').textContent='試走を再開する';
 document.exitPointerLock?.();
}
document.addEventListener('pointerlockchange',()=>{document.body.classList.toggle('trialRunning',!!document.pointerLockElement);if(!document.pointerLockElement)pauseTrial();});
addEventListener('keydown',e=>{if(e.code==='Escape')pauseTrial();});
window.__cityTrial={city:CITY,T,physics,resolve,groundAt,ceilingAt,terrainH,castFrom,spawn,shortDash,keys,units,scene,camera,renderer,setup,
 get player(){return player;},get running(){return running;},set running(v){running=v;},get mapRoot(){return mapRoot;},get hittables(){return hittables;},
 get plants(){return plants;},get curMap(){return curMap;},get cores(){return cores;},updateCamera,renderView,playerUpdate,selectWeapon,shoot,
 get mechCfg(){return mechCfg;},mechStats,equip,viewAim,jumpPadUpdate,get jumpPads(){return jumpPads;}};
document.getElementById('ovText').textContent='道路・路地・両基地を試走できます。緑のジャンプパッドで上昇後、空中操作で高層棟の屋上へ。開始地点を選んで出撃してください。';
document.getElementById('start').textContent='試走を始める';
"""
    s=replace(s,'\nrequestAnimationFrame(loop);\n','\n'+expose+'\nrequestAnimationFrame(loop);\n')
    out.mkdir(parents=True,exist_ok=True)
    (out/'index.html').write_text(s)
    record={'sourcePreviewSHA256':hashlib.sha256((source/'preview.html').read_bytes()).hexdigest(),
        'engineSHA256':hashlib.sha256((ROOT/'prototype/index.html').read_bytes()).hexdigest(),
        'runtimeSHA256':hashlib.sha256((ROOT/'tools/plateau/trial_runtime.js').read_bytes()).hexdigest(),
        'cameraSHA256':hashlib.sha256((ROOT/'tools/plateau/trial_camera.js').read_bytes()).hexdigest(),
        'riverSHA256':hashlib.sha256((ROOT/'tools/plateau/trial_river.py').read_bytes()).hexdigest(),
        'districtSHA256':hashlib.sha256((ROOT/'tools/plateau/trial_district.py').read_bytes()).hexdigest(),
        'blocksSHA256':hashlib.sha256((ROOT/'tools/plateau/trial_blocks.py').read_bytes()).hexdigest(),
        'packSHA256':hashlib.sha256((ROOT/'tools/plateau/trial_pack.py').read_bytes()).hexdigest(),
        'simplifySHA256':hashlib.sha256((ROOT/'tools/plateau/trial_simplify.py').read_bytes()).hexdigest(),
        'streetsSHA256':hashlib.sha256((ROOT/'tools/plateau/trial_streets.py').read_bytes()).hexdigest(),
        'landmarksSHA256':hashlib.sha256((ROOT/'research/maps/akihabara-landmarks.json').read_bytes()).hexdigest(),
        'profileSHA256':hashlib.sha256((ROOT/'research/maps/akihabara-trial.json').read_bytes()).hexdigest(),
        'builderSHA256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
        'htmlBytes':len(s.encode()),'htmlSHA256':hashlib.sha256(s.encode()).hexdigest(),
        'triangles':{k:v['triangles'] for k,v in data['packing']['layers'].items()},'packing':data['packing'],
        'collisionVolumes':len(data['volumes']),'river':{k:v for k,v in data['river'].items() if k!='rings'},
        'spawns':data['spawns'],'district':data['district'],'landmarks':data['landmarks'],'streetRepairs':data['streetRepairs'],'heritage':data['heritage'],
        'bases':2,'plants':0,'bots':0,'nativeMovement':True,'edgeClamp':298.7}
    (out/'generation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(record,ensure_ascii=False,indent=2))


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('source',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path)
    args=ap.parse_args();build(args.source,args.output)
