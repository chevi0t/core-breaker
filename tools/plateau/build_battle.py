#!/usr/bin/env python3
"""承認済み都市から、施設とBotを備えたオフライン対戦版を別ファイルへ作る。"""
import argparse
import contextlib
import gzip
import hashlib
import io
import json
import pathlib
import re

from battle_plan import plan
from build_trial import ROOT, build, inline_js, replace
from rebuild_trial import compact


def combat_html(s,definition):
    original=(ROOT/'prototype/index.html').read_text()
    start=s.index('<script>window.MAP_DATA=');end=s.index('</script>',start)+len('</script>')
    s=s[:start]+'<script>window.MAP_DATA={city_trial:'+compact(definition).decode()+'};</script>'+s[end:]
    s=replace(s,'function resolve(u) {\n  return CITY.resolve(u);','function resolve(u) {\n  CITY.resolve(u);')
    s=replace(s,'function groundAt(x, z, y) {\n  return CITY.groundAt(x,z,y);\n  let h = terrainH(x, z);',
              'function groundAt(x, z, y) {\n  let h = CITY.groundAt(x,z,y);')
    s=replace(s,'function ceilingAt(x, z, y) {\n  return CITY.ceilingAt(x,z,y);\n  let c = Infinity;',
              'function ceilingAt(x, z, y) {\n  let c = CITY.ceilingAt(x,z,y);')
    s=replace(s,'  CITY.mount(mapRoot,hittables);','  CITY.mount(mapRoot,hittables);\n  buildBoxes(def.layout);')
    outer="""  addBox(0, MAP_Z + 2, MAP_X * 2 + 8, 4, 10, wallMat);
  addBox(0, -MAP_Z - 2, MAP_X * 2 + 8, 4, 10, wallMat);
  addBox(MAP_X + 2, 0, 4, MAP_Z * 2, 10, wallMat);
  addBox(-MAP_X - 2, 0, 4, MAP_Z * 2, 10, wallMat);"""
    s=replace(s,outer,'  // 都市版の外周はCITYの機体カプセル制限で保護する。')
    s=replace(s,'line.position.set(zone?zone.at[0]:0, .08, zone?zone.at[1]:BASE_LINE*s);',
              'line.position.set(zone?zone.at[0]:0, CITY.base(k).height+.08, zone?zone.at[1]:BASE_LINE*s);')
    old="""  const point=CITY.spawns[Number(document.getElementById('trialSpawn').value)||0];
  u.pos.fromArray(point.at);
  if(point.surface==='ground')u.pos.y=terrainH(u.pos.x,u.pos.z);
  resolve(u);
  return;"""
    s=replace(s,old,"  u.pos.fromArray(BATTLE.pickSpawn(u.team,at,plants));\n  resolve(u);\n  return;")
    s=replace(s,'  // 地形確認が終わるまではプレイヤー1機だけ。',"  for (let i = 1; i < count; i++) makeUnit(chosenTeam, false, i);\n  for (let i = 0; i < count; i++) makeUnit(chosenTeam === 'B' ? 'R' : 'B', false, i);")
    s=replace(s,'    // 試走では制限時間を進めない。','    timeLeft -= dt;')
    s=replace(s,'  // 基地の位置確認段階。防衛・補給施設は配置確定後に置く。','  if (!VS) { buildTurrets(def.turrets); buildRadars(def.radar); }')
    s=replace(s,'  buildBarricades(def.barricades);','  buildBarricades(def.barricades);\n  BATTLE.finishNav(NAV,clearPath);')
    s=replace(s,'const NAV_REACH = 5,','const NAV_REACH = 1.5,')
    a=s.index('function clearPath(ax, az, bx, bz, ay) {');b=s.index('// 近い節点のうち',a)
    s=s[:a]+"""function clearPath(ax, az, bx, bz, ay) {
  const result=BATTLE.clearPath(ax,az,bx,bz,ay,obstacles,groundAt);
  pathEndH=result.y;return result.ok;
}
"""+s[b:]
    s=replace(s,'  if (jumpPads.length || lifts.length || ziplines.length) {\n    goal = botMobilityGoal(u, goal);',
              '  goal=BATTLE.safeGoal(u,goal,obstacles,NAV);\n  if (jumpPads.length || lifts.length || ziplines.length) {\n    goal = botMobilityGoal(u, goal);')
    # 静的な都市の地図に、本体と同じ占拠・索敵・施設の表示を重ねる。
    static_bases="""      for(const b of data.district.bases){
        c.beginPath();c.arc(b.at[0]+half,b.at[1]+half,b.radius,0,Math.PI*2);
        c.fillStyle=b.team==='B'?'#389bee66':'#fa8b3b66';c.fill();c.strokeStyle=b.team==='B'?'#64c9ff':'#ffaf68';c.lineWidth=2;c.stroke();
        c.fillStyle='#fff';c.font='bold 12px system-ui';c.textAlign='center';c.fillText(b.team==='B'?'青基地':'橙基地',b.at[0]+half,b.at[1]+half+4);
      }
"""
    s=replace(s,static_bases,'')
    s=replace(s,'  return CITY.drawMap(mini,W,H,player);\n  mini.clearRect(0, 0, W, H);\n  mini.drawImage(bg, 0, 0, W, H);',
              '''  CITY.drawMap(mini,W,H,null);
  for(const team of ['B','R']){
    const b=curMap.bases[team],x=(b.at[0]+300)/600*W,z=(b.at[1]+300)/600*H;
    mini.fillStyle=TEAM[team].css+'55';mini.strokeStyle=TEAM[team].css;mini.lineWidth=1.5;
    mini.beginPath();mini.arc(x,z,b.radius/600*W,0,Math.PI*2);mini.fill();mini.stroke();
  }''')
    s=replace(s,"  CITY.drawMap(cv.getContext('2d'),cv.width,cv.height,null); return;",
              "  drawMapOn(cv.getContext('2d'),cv.width,cv.height,null,1,true); return;")
    match=re.search(r'^const mapInfo = .*?;$',original,re.M)
    s=re.sub(r'^const mapInfo = .*?;$',lambda _:match[0],s,flags=re.M)
    runtime=(ROOT/'tools/plateau/city_battle_runtime.js').read_text()
    s=replace(s,'const CITY = await createCityTrial(T,',inline_js(runtime)+'\nconst CITY = await createCityTrial(T,')
    s=re.sub(r'(const CITY = await createCityTrial\(T,"[^"]+"\);)',r'\1\nconst BATTLE=createCityBattle(T,CITY,window.MAP_DATA.city_trial);',s,count=1)
    s=replace(s,'#top,#teamChoice{display:none!important}','#top{display:none!important}')
    s=replace(s,'<title>地形試走 — ','<title>市街地対戦 — ')
    a=s.index('<div id="trialPanel">');b=s.index('</div>',a)+6
    credits=s[s.index('<details>',a):s.index('</details>',a)+10]
    panel='<div id="trialPanel">星路駅前・四街区争奪戦<small>10対10・10分。指定の4地点はA〜Dの中立プラント。<br>基地にカタパルト4基・防衛砲台4基・レーダー・補給ポッド。<br>WASD 移動／Shift ブースト／Space ジャンプ／M 地図／Esc メニュー</small>'+credits+'</div>'
    s=s[:a]+panel+s[b:]
    a=s.index("document.getElementById('trialReset').onclick");b=s.index('\nrequestAnimationFrame(loop);',a)
    expose="""
function pauseCityBattle(){
 if(!running)return;
 running=false;mouseDown=rightDown=false;mapOpen=false;stopMovementSounds();
 for(const k in keys)delete keys[k];for(const k in pressed)delete pressed[k];
 document.getElementById('overlay').hidden=false;showPage('pgMenu');
 document.getElementById('start').textContent='対戦を再開する';document.exitPointerLock?.();
}
document.addEventListener('pointerlockchange',()=>{document.body.classList.toggle('trialRunning',!!document.pointerLockElement);if(!document.pointerLockElement)pauseCityBattle();});
addEventListener('keydown',e=>{if(e.code==='Escape')pauseCityBattle();});
window.__cityBattle={city:CITY,battle:BATTLE,T,physics,resolve,groundAt,ceilingAt,terrainH,castFrom,spawn,shortDash,keys,pressed,units,scene,camera,renderer,setup,
 get player(){return player;},get running(){return running;},set running(v){running=v;},get mapRoot(){return mapRoot;},get hittables(){return hittables;},
 plants,turrets,radars,pods,catapults,get NAV(){return NAV;},clearPath,navSteer,navPath,get curMap(){return curMap;},cores,TEAM,
 updateCamera,renderView,playerUpdate,botUpdate,selectWeapon,shoot,mechStats,equip,viewAim,jumpPadUpdate,jumpPads,
 launch,catapultUpdate,podUpdate,plantUpdate,obstacles,finish,frame:loop,drawMapOn,
 turretUpdate,radarUpdate,
 get timeLeft(){return timeLeft;},get ended(){return ended;},set chosenTeam(v){chosenTeam=v;},
 set mouseDown(v){mouseDown=v;},
 get mechCfg(){return mechCfg;},get shells(){return shells;}};
document.getElementById('ovText').textContent='4つの中立プラントを占拠し、敵コアを攻撃してください。自軍プラントから再出撃できます。両基地に同数のカタパルト。川からはスロープで復帰。';
document.getElementById('start').textContent='対戦を始める';
"""
    return s[:a]+expose+s[b:]


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('reference',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path)
    ap.add_argument('--cached-plan',type=pathlib.Path,help='配置調整時の中間データ。通常の再生成では指定しない')
    ap.add_argument('--maximum-map-bytes',type=int,default=100_000,help='街形状と対戦配置・経路を合わせた非圧縮JSONの上限')
    args=ap.parse_args();source=args.reference/'layout.json'
    if args.cached_plan:
        data,definition,stats=[json.loads((args.cached_plan/(k+'.json')).read_text()) for k in ['layout','definition','stats']]
    else:data,definition,stats=plan(json.loads(source.read_text()),json.loads((ROOT/'research/maps/akihabara-battle.json').read_text()))
    map_bytes=len(compact(data))+len(compact(definition))
    if map_bytes>args.maximum_map_bytes:raise ValueError(f'マップ容量が上限超過: {map_bytes} > {args.maximum_map_bytes}')
    args.output.mkdir(parents=True,exist_ok=True)
    # 共通の試走ビルダーはそのまま利用し、今回だけ対戦部分を有効に戻す。
    with contextlib.redirect_stdout(io.StringIO()):
        build(ROOT/'mapdesign/akihabara_city/rail',args.output,data=data,
              layout_runtime=(ROOT/'tools/plateau/rebuild_runtime.js').read_text(),variant='・対戦')
    html=combat_html((args.output/'index.html').read_text(),definition)
    (args.output/'index.html').write_text(html)
    for name,value in [('layout',data),('definition',definition)]:
        (args.output/(name+'.json')).write_bytes(compact(value))
    stats.update(sourceLayoutSHA256=hashlib.sha256(source.read_bytes()).hexdigest(),
                 geometryBytes=len(compact(data)),battleDefinitionBytes=len(compact(definition)),
                 totalMapBytes=map_bytes,maximumMapBytes=args.maximum_map_bytes,
                 compressedMapBytes=len(gzip.compress(compact([data,definition]),mtime=0)),
                 htmlBytes=len(html.encode()),htmlSHA256=hashlib.sha256(html.encode()).hexdigest(),
                 plants=4,bots=19,team=10,time=600,
                 sourceHashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in
                  [ROOT/p for p in ['prototype/index.html','tools/plateau/build_battle.py','tools/plateau/battle_plan.py',
                   'tools/plateau/city_battle_runtime.js','research/maps/akihabara-battle.json',
                   'tools/plateau/build_trial.py','tools/plateau/rebuild_trial.py','tools/plateau/rebuild_runtime.js',
                   'tools/plateau/trial_runtime.js','tools/plateau/trial_camera.js']]} )
    (args.output/'generation.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in stats.items() if k not in ['navigation','sourceHashes']},ensure_ascii=False))


if __name__=='__main__':main()
