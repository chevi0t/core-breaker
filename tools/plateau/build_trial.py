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
from shapely.geometry import Point, box

from simplify import extrusion, parts, projection, rings

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
    land = projection(meshes['dem'], precision=.001)
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
    # DEMの境界辺をそのまま下へ延ばし、川岸の隙間を閉じる（外周の切断辺は除く）。
    dem = np.round(meshes['dem'].reshape(-1, 3, 3), 3)
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
        c,d = a.copy(),b.copy();c[1]=d[1]=bed
        bank.extend([a,b,c,b,d,c])
    meshes['bank'] = np.array(bank, dtype='<f4')
    volumes = json.loads((source/'collision-volumes.json').read_text())['volumes']
    # 再生地点は地形確認用。基地・プラント・経路を仮配置しない。
    spawns = [
        {'name':'大通り', 'at':[-185,0,-50], 'surface':'ground'},
        {'name':'駅の屋根', 'at':[-25,25.5,40], 'surface':'roof'},
        {'name':'南北の高架', 'at':[-47,8,165], 'surface':'rail'},
        {'name':'東西の高架', 'at':[-160,18,12], 'surface':'rail'},
        {'name':'川底', 'at':[-150,bed,176], 'surface':'river'},
    ]
    result = {'half':half,'meshes':{k:base64.b64encode(a.astype('<f4').tobytes()).decode() for k,a in meshes.items()},
        'colors':{k:meta[k+'ColorRanges'] for k in ['rail','station','shops']},'volumes':volumes,'spawns':spawns,
        'river':{'bed':bed,'water':water,'rings':[rings(p) for p in river_parts],'area':round(river.area,2)},
        'groundMaximum':max(float(meshes[k][:,1].max()) for k in ['dem','tran'])+.5}
    return result


def build(source, out):
    data = make_payload(source)
    packed = base64.b64encode(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=9,mtime=0)).decode()
    s = (ROOT/'prototype/index.html').read_text()
    s = re.sub(r'<link[^>]+href="https://fonts\.googleapis\.com[^>]+>\n','',s)
    s = '<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'+s
    for url,path in [('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js','vendor/three-r128/three.min.js'),
                     ('sounds.js','prototype/sounds.js'),('music.js','prototype/music.js')]:
        s = replace(s,f'<script src="{url}"></script>','<script>'+inline_js((ROOT/path).read_text())+'</script>')
    definition = dict(name='星路駅前試験区',size=[300,300],team=1,time=86400,baseZ=280,baseLine=300,
        desc='地形の試走。基地・プラント・敵機なし。道路・屋根・高架・川底の移動を確認できます。',
        terrain=[],layout=[],plants=[],turrets=[],radar=[],catapults=[],basePods=[],plantPods=[],barricades=[],
        asym=True,vs={'cost':20000,'death':2000})
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
    s=replace(s,'function drawMapOn(mini, W, H, bg, k, big = false) {','function drawMapOn(mini, W, H, bg, k, big = false) {\n  return CITY.drawMap(mini,W,H,player);')
    s=re.sub(r'^const mapInfo = d => .*?;$',"const mapInfo = d => '地形試走・敵機なし・時間制限なし・600×600m';",s,flags=re.M)
    s=replace(s,'function drawMapPreview(cv, d) {',"function drawMapPreview(cv, d) {\n  CITY.drawMap(cv.getContext('2d'),cv.width,cv.height,null); return;")
    s=replace(s,"  const g = c.getContext('2d'), img = g.createImageData(W, H);", "  CITY.drawMap(c.getContext('2d'),W,H,null); return c;\n  const g = c.getContext('2d'), img = g.createImageData(W, H);")
    # 地形の対比を保ち、遠くの高層棟も試走中に確認できるようにする。
    s=replace(s,'scene.fog = new T.Fog(0x9fb4c4, 110, 420);','scene.fog = new T.Fog(0x9fb4c4, 220, 850);')
    s=replace(s,'  camera.lookAt(pivot.clone().addScaledVector(dir, 50));',
        '  const back=camera.position.clone().sub(pivot),distance=back.length();\n  if(distance>.01){const wall=castFrom(pivot,back.normalize(),u,distance);if(wall)camera.position.copy(pivot).addScaledVector(back,Math.max(.3,wall.dist-.25));}\n  camera.lookAt(pivot.clone().addScaledVector(dir, 50));')
    s=replace(s,'<title>','<title>地形試走 — ')
    s=replace(s,'<script>\n(() => {\nconst T = THREE;','<script>\n(async () => {\nconst T = THREE;\n'+(ROOT/'tools/plateau/trial_runtime.js').read_text()+'\nconst CITY = await createCityTrial(T,"'+packed+'");')
    options=''.join(f'<option value="{i}">{p["name"]}</option>' for i,p in enumerate(data['spawns']))
    credits=(source/'CREDITS.md').read_text()+'\n\n試走版の川底・護岸・水面は制作側の仮設形状です。現実の水位・水深を示しません。地理データの加工部分はCC BY 4.0。\n\n'+(ROOT/'sounds/CREDITS.md').read_text()+'\n\n'+(ROOT/'vendor/three-r128/LICENSE').read_text()
    panel='<div id="trialPanel">地形試走 · 敵機なし <label>開始地点 <select id="trialSpawn">'+options+'</select></label><button id="trialReset" type="button">選択地点へ戻る</button><small>WASD 移動／Shift ブースト／Space ジャンプ／M 地図／Esc メニュー<br>川の水面は仮表示。川底を歩けます。四辺に落下防止境界あり。</small><details><summary>出典・ライセンス</summary><pre>'+escape(credits)+'</pre></details></div>'
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
 get mechCfg(){return mechCfg;},mechStats,equip};
document.getElementById('ovText').textContent='道路・屋根・高架・川底を、いつもの機体で試走できます。開始地点を選び、出撃してください。';
document.getElementById('start').textContent='試走を始める';
"""
    s=replace(s,'\nrequestAnimationFrame(loop);\n','\n'+expose+'\nrequestAnimationFrame(loop);\n')
    out.mkdir(parents=True,exist_ok=True)
    (out/'index.html').write_text(s)
    record={'sourcePreviewSHA256':hashlib.sha256((source/'preview.html').read_bytes()).hexdigest(),
        'engineSHA256':hashlib.sha256((ROOT/'prototype/index.html').read_bytes()).hexdigest(),
        'runtimeSHA256':hashlib.sha256((ROOT/'tools/plateau/trial_runtime.js').read_bytes()).hexdigest(),
        'htmlBytes':len(s.encode()),'htmlSHA256':hashlib.sha256(s.encode()).hexdigest(),
        'triangles':{k:len(base64.b64decode(v))//36 for k,v in data['meshes'].items()},
        'collisionVolumes':len(data['volumes']),'river':{k:v for k,v in data['river'].items() if k!='rings'},
        'spawns':data['spawns'],'bases':0,'plants':0,'bots':0,'nativeMovement':True,'edgeClamp':298.7}
    (out/'generation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(record,ensure_ascii=False,indent=2))


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('source',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path)
    args=ap.parse_args();build(args.source,args.output)
