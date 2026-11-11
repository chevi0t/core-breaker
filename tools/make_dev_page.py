#!/usr/bin/env python3
"""マップ作りの開発者用ページ（調査モード）を作る。建物を指して「実物はこう」を伝えるための物。

  python3 tools/test/make_dbg.py dbg
  python3 tools/make_dev_page.py dbg          # dbg/dev.html を書く（dbg.html と同じフォルダに置いて開く）

dev.html はゲームそのもの（dbg.html）に調査の部品を足した物。出撃すると、敵も味方もいない散策になる。
  - 敵味方の機体と砲台の攻撃は無く、試合の時間も減らない。機体は撃破されにくい（耐久を戻し続ける）。
  - T：飛行の入り切り。飛行中は W A S D で見ている向きへ進み、Space で上、C で下、Shift で速く（壁は通り抜ける）。
    視点は真上・真下近くまで向く。もう一度 T で、その場から機体に戻って歩ける。
  - 照準を建物に合わせると、左上に建物の番号・高さ・大きさ・今の外壁が出る（都市マップ）。
  - B：その建物を記録する。場所（ゲームの座標、実際の緯度経度）と、見ていた位置から建物を向いた
    ストリートビューのリンクが、メモ帳に足される。メモ帳にそのまま「実物はこう」を書ける。
  - L：メモ帳を開く。「コピー」で全部をコピーして、マップ製作のスレッドに貼る。記録はブラウザに残る（localStorage の cbSurvey）。
  - 時間は実際の速さで進む（dbg.html は試験のために1コマ0.05秒で固定だが、dev.html は画面の速さに合わせる）。

緯度経度は、点群から作ったマップ（下の GEO にあるマップ）だけ出る。ゲームの座標 → 平面直角座標（EPSG:6677、
第IX系）→ 緯度経度。ストリートビューは利用者が自分のブラウザで見るための物で、このページは画像を取得しない。
Google マップ・ストリートビューの画像は、リポジトリや共有フォルダに保存せず、なぞって形や色を取る材料にもしない
（mapdesign/sowan/README.md）。形と色は、点群・PLATEAU などの CC BY の資料、オーナーが撮った写真、言葉から作る。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))


def geo():
    """マップごとの、ゲームの座標と実際の位置の対応。"""
    import sowan_photo as sp  # 双湾展示区：1/3、40.7度回転（式は sowan_photo.py の game_to_real）

    return {"sowan": {"ox": sp.OX, "oz": sp.OZ, "dz": float(sp.DZ), "ca": sp.CA, "sa": sp.SA, "scale": sp.SCALE,
                      "lat0": 36.0, "lon0": 139 + 50 / 60, "k0": 0.9999}}  # 平面直角座標 第IX系の原点


DRIVER = r"""<script>
(()=>{
  const GEO=__GEO__,g=window.__g,KEY='cbSurvey',T=window.THREE;
  // 平面直角座標（東 x・北 y、m）→ 緯度経度（度）。GRS80、クリューゲルの級数。
  function planeToLatLon(x,y,o){
    const a=6378137,f=1/298.257222101,n=f/(2-f),A=a/(1+n)*(1+n*n/4+n**4/64),rad=Math.PI/180;
    const al=[n/2-2*n*n/3+5*n**3/16,13*n*n/48-3*n**3/5,61*n**3/240],be=[n/2-2*n*n/3+37*n**3/96,n*n/48+n**3/15,17*n**3/480],de=[2*n-2*n*n/3-2*n**3,7*n*n/3-8*n**3/5,56*n**3/15];
    const e=2*Math.sqrt(n)/(1+n),s0=Math.sin(o.lat0*rad),xi0p=Math.atan(Math.sinh(Math.atanh(s0)-e*Math.atanh(e*s0)));
    let xi0=xi0p;al.forEach((v,j)=>{xi0+=v*Math.sin(2*(j+1)*xi0p);});
    const xi=y/(o.k0*A)+xi0,eta=x/(o.k0*A);let xip=xi,etap=eta;
    be.forEach((v,j)=>{xip-=v*Math.sin(2*(j+1)*xi)*Math.cosh(2*(j+1)*eta);etap-=v*Math.cos(2*(j+1)*xi)*Math.sinh(2*(j+1)*eta);});
    const chi=Math.asin(Math.sin(xip)/Math.cosh(etap));let lat=chi;de.forEach((v,j)=>{lat+=v*Math.sin(2*(j+1)*chi);});
    return [lat/rad,o.lon0+Math.atan2(Math.sinh(etap),Math.cos(xip))/rad];
  }
  const toPlane=(o,gx,gz)=>{const u=gx*o.scale+o.ox,v=(gz-o.dz)*o.scale+o.oz;return [o.ca*u+o.sa*v,o.sa*u-o.ca*v];};
  window.__survey={planeToLatLon,toPlane,GEO};
  const css='position:fixed;z-index:99990;font:14px/1.5 sans-serif;color:#fff;background:rgba(10,18,28,.82);border-radius:6px;padding:6px 12px';
  const strip=document.createElement('div');strip.style.cssText=css+';left:10px;top:86px;max-width:46vw;pointer-events:none';
  const pad=document.createElement('div');pad.style.cssText=css+';left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,90vw);display:none;padding:14px 16px';
  pad.innerHTML='<div style="font-size:16px;margin-bottom:6px">調査のメモ帳（「メモ：」の後に、実物はこう、と書けます。写真はスレッドに一緒に貼ってください）</div>'
    +'<textarea id="surveyText" spellcheck="false" style="display:block;width:100%;height:46vh;box-sizing:border-box;font:13px/1.5 monospace;background:#0b141e;color:#dfe9f2;border:1px solid #456;padding:8px"></textarea>'
    +'<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button id="surveyView">ストリートビューを開く</button><button id="surveyMap">地図を開く</button><button id="surveyCopy">全部コピー</button><button id="surveyClear">全部消す</button><button id="surveyClose" style="margin-left:auto">閉じる（Esc）</button></div>';
  document.body.append(strip,pad);
  const text=pad.querySelector('#surveyText');for(const b of pad.querySelectorAll('button'))b.style.cssText+=';font:14px sans-serif;padding:5px 12px';
  try{text.value=localStorage.getItem(KEY)||'';}catch(_){}
  const save=()=>{try{localStorage.setItem(KEY,text.value);}catch(_){}};text.addEventListener('input',save);
  let last=null,target=null;const ray=new T.Raycaster(),centre=new T.Vector2(0,0);ray.far=900;
  const inRing=(ring,x,z)=>{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
  // 照準（画面の中央）の先にある物を調べる
  function look(){
    const map=g.cityMap;if(!map||!g.curMap)return null;
    ray.setFromCamera(centre,g.camera);
    const hit=ray.intersectObjects(g.hittables.filter(m=>m.name.startsWith('city-collision-')),false)[0];if(!hit)return null;
    const p=hit.point.clone().addScaledVector(ray.ray.direction,.08);let best=null,index=-1;
    map.volumes.forEach((v,i)=>{
      if(p.x<v.minX||p.x>v.maxX||p.z<v.minZ||p.z>v.maxZ||p.y<v.bottom-.3||p.y>v.top+.3||!inRing(v.rings[0],p.x,p.z))return;
      const area=(v.maxX-v.minX)*(v.maxZ-v.minZ);if(!best||area<best.area){best={...v,area};index=i;}
    });
    return {point:hit.point.clone(),layer:hit.object.name.replace('city-collision-',''),volume:best,index,eye:g.camera.position.clone()};
  }
  const round=(v,d=1)=>Number(v).toFixed(d);
  function describe(t){
    if(!t)return '照準の先に何もありません';
    if(!t.volume)return `地面・橋など（${t.layer}）　x ${round(t.point.x)}, z ${round(t.point.z)}, 高さ ${round(t.point.y)}m`;
    const v=t.volume;return `建物 #${t.index}　高さ ${round(v.bottom)}〜${round(v.top)}m　約 ${round(v.maxX-v.minX,0)}×${round(v.maxZ-v.minZ,0)}m　外壁 ${v.facade||'格子の窓'}${v.kind?'　種類 '+v.kind:''}`;
  }
  function links(t){
    const o=GEO[g.mapId];if(!o)return null;
    const here=toPlane(o,t.eye.x,t.eye.z),there=toPlane(o,t.point.x,t.point.z),at=planeToLatLon(here[0],here[1],o),to=planeToLatLon(there[0],there[1],o);
    const heading=(Math.atan2(there[0]-here[0],there[1]-here[1])*180/Math.PI+360)%360;
    return {at,to,heading,view:`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at[0].toFixed(6)},${at[1].toFixed(6)}&heading=${heading.toFixed(0)}`,
      map:`https://www.google.com/maps/search/?api=1&query=${to[0].toFixed(6)},${to[1].toFixed(6)}`};
  }
  function record(){
    const t=look();if(!t)return;const l=links(t),name=g.curMap.name||g.mapId;last=l;
    const lines=[`【調査】${name}（${g.mapId}）　${t.volume?'建物 #'+t.index:'地面・橋など（'+t.layer+'）'}`,
      `指した所：x ${round(t.point.x)}, z ${round(t.point.z)}, 高さ ${round(t.point.y)}m${l?`（緯度 ${l.to[0].toFixed(6)}, 経度 ${l.to[1].toFixed(6)}）`:''}`];
    if(t.volume)lines.push(`今の形：${describe(t).replace(/^建物 #\d+　/,'')}`);
    lines.push(`見た位置：x ${round(t.eye.x)}, z ${round(t.eye.z)}, 高さ ${round(t.eye.y)}m${l?`（方位 ${l.heading.toFixed(0)}度へ向いて）`:''}`);
    if(l)lines.push(`ストリートビュー：${l.view}`,`地図：${l.map}`);
    lines.push('メモ：','');
    text.value=(text.value.trim()?text.value.replace(/\s+$/,'')+'\n\n':'')+lines.join('\n');save();open();
  }
  const isOpen=()=>pad.style.display!=='none';
  function open(){pad.style.display='block';document.exitPointerLock?.();text.focus();text.setSelectionRange(text.value.length,text.value.length);text.scrollTop=text.scrollHeight;}
  function close(){pad.style.display='none';text.blur();}
  // メモ帳の最後の記録にあるリンクを開く（記録した直後でなくても使えるように、文字から拾う）
  const lastLink=label=>{const m=[...text.value.matchAll(new RegExp(label+'：(https://www\\.google\\.com/maps/\\S+)','g'))].pop();return m&&m[1];};
  pad.querySelector('#surveyView').onclick=()=>{const u=lastLink('ストリートビュー');if(u)window.open(u,'_blank','noopener');};
  pad.querySelector('#surveyMap').onclick=()=>{const u=lastLink('地図');if(u)window.open(u,'_blank','noopener');};
  pad.querySelector('#surveyCopy').onclick=e=>{text.select();let ok=false;try{ok=document.execCommand('copy');}catch(_){}
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text.value).catch(()=>{});e.target.textContent=ok?'コピーしました':'全部コピー';setTimeout(()=>{e.target.textContent='全部コピー';},1500);};
  pad.querySelector('#surveyClear').onclick=()=>{if(text.value&&pad.dataset.sure!=='1'){pad.dataset.sure='1';pad.querySelector('#surveyClear').textContent='もう一度押すと消えます';return;}
    text.value='';save();pad.dataset.sure='';pad.querySelector('#surveyClear').textContent='全部消す';};
  pad.querySelector('#surveyClose').onclick=close;
  // メモ帳を開いている間は、キーをゲームへ渡さない（文字を打つと機体が動いてしまうため）
  for(const type of ['keydown','keyup','keypress'])window.addEventListener(type,e=>{
    if(isOpen()){if(type==='keydown'&&e.code==='Escape'){close();e.preventDefault();}e.stopPropagation();return;}
    if(type!=='keydown'||e.repeat||e.ctrlKey||e.metaKey||e.altKey||!g.cityMap||/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||''))return;
    if(e.code==='KeyB'){record();e.preventDefault();e.stopPropagation();}
    if(e.code==='KeyL'){open();e.preventDefault();e.stopPropagation();}
  },true);
  // ---- 散策：敵味方なし・実際の速さ・飛行（本体の関数を包む。本体は書き換えない）----
  // 本体の行頭の function は window の物なので、包んだ物に差し替えられる。let・const は名前でそのまま読める
  const fly={on:false,pitch:0,speed:30,fast:4,eye:3},clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const solo=()=>!tutorial&&!range;
  let prevNow=0;const frame0=window.gameFrame;
  window.gameFrame=function(now){window.__dt=clamp((now-prevNow)/1000,.001,.05);prevNow=now;return frame0(now);}; // dbg.html の固定の刻みを、実際の時間に戻す
  const setup0=window.setup;
  window.setup=function(){
    const r=setup0.apply(this,arguments);fly.on=false;if(!solo())return r;
    for(const u of units){if(u===player)continue;if(u.postFlight)scene.remove(u.postFlight.mesh);scene.remove(u.group,u.beam,u.fieldMesh,u.barrierMesh);disposeMech(u.group);u.beam.material.dispose();if(u.tagEl)u.tagEl.remove();}
    units.length=0;units.push(player);
    for(let i=hittables.length-1;i>=0;i--){const ref=refOf(hittables[i]);if(ref&&ref.kind==='unit'&&ref!==player)hittables.splice(i,1);}
    return r;
  };
  const turret0=window.turretUpdate;window.turretUpdate=function(tu,dt){if(!solo())return turret0(tu,dt);}; // 砲台は撃たない
  const flyDir=u=>{const c=Math.cos(fly.pitch);return new T.Vector3(-Math.sin(u.yaw)*c,Math.sin(fly.pitch),-Math.cos(u.yaw)*c);};
  const player0=window.playerUpdate;
  window.playerUpdate=function(u,dt){
    if(!fly.on)return player0(u,dt);
    const f=(keys.KeyW?1:0)-(keys.KeyS?1:0),s=(keys.KeyD?1:0)-(keys.KeyA?1:0),v=(keys.Space?1:0)-(keys.KeyC?1:0);
    const move=flyDir(u).multiplyScalar(f).addScaledVector(new T.Vector3(Math.cos(u.yaw),0,-Math.sin(u.yaw)),s);move.y+=v;if(move.lengthSq()>1)move.normalize();
    u.pos.addScaledVector(move,fly.speed*(keys.ShiftLeft||keys.ShiftRight?fly.fast:1)*dt);
    u.pos.x=clamp(u.pos.x,-MAP_X-200,MAP_X+200);u.pos.z=clamp(u.pos.z,-MAP_Z-200,MAP_Z+200);u.pos.y=clamp(u.pos.y,terrainH(u.pos.x,u.pos.z),600);
    u.vel.set(0,0,0);u.onGround=false;u.moveInput=false;u.dashState='';u.scoped=false;
  };
  const camera0=window.updateCamera;
  window.updateCamera=function(u,dt){
    if(!fly.on||u!==player)return camera0(u,dt);
    camera.fov+=(gameOptions.fov-camera.fov)*Math.min(1,dt*10);camera.updateProjectionMatrix();
    camera.position.copy(u.pos);camera.position.y+=fly.eye;camera.lookAt(camera.position.clone().addScaledVector(flyDir(u),50));camera.updateMatrixWorld();
    u.group.visible=false; // 飛行中は自分の機体を描かない（目の位置から見る）
  };
  function setFly(on){
    if(!player||!player.alive||on===fly.on)return;
    if(on){fly.pitch=player.pitch;player.vel.set(0,0,0);releaseLock();}else player.pitch=clamp(fly.pitch,-.9,.7);
    fly.on=on;
  }
  addEventListener('mousemove',e=>{ // 飛行中は真上・真下近くまで向ける（左右は本体が回す）
    if(!fly.on||!running||!player||mapOpen||document.pointerLockElement!==canvas||Math.abs(e.movementX)>250||Math.abs(e.movementY)>250)return;
    fly.pitch=clamp(fly.pitch-e.movementY*.0025*camera.fov/70,-1.5,1.5);
  });
  addEventListener('keydown',e=>{
    if(e.code!=='KeyT'||e.repeat||e.ctrlKey||e.metaKey||e.altKey||isOpen()||!running||/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||''))return;
    setFly(!fly.on);e.preventDefault();
  });
  setInterval(()=>{
    const playing=!!(g.curMap&&g.player&&g.player.alive&&running);
    strip.style.display=playing&&!isOpen()?'block':'none';if(!playing)return;
    if(g.player.maxHp)g.player.hp=g.player.maxHp; // 調査中に撃破されにくくする
    if(solo())timeLeft=MATCH; // 散策は時間で終わらない
    target=look();strip.style.whiteSpace='pre-line';
    strip.textContent='調査モード（敵味方なし）　T：'+(fly.on?'歩く':'飛ぶ')+'　B：照準の建物を記録　L：メモ帳\n'
      +(fly.on?'飛行中　W A S D：見ている向きへ　Space：上　C：下　Shift：速く\n':'')+(g.cityMap?describe(target):'');
  },200);
  Object.assign(window.__survey,{look,describe,record,fly,setFly});
})();
</script>"""


def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "dbg")
    html = (folder / "dbg.html").read_text(encoding="utf-8")
    if 'src="maps.js"' not in html or "window.__g" not in html:
        sys.exit("dbg.html の形が変わっていて dev.html を作れません")
    html = html.rstrip("\n") + "\n" + DRIVER.replace("__GEO__", json.dumps(geo())) + "\n"  # 本体の後（__g ができた後）に足す
    (folder / "dev.html").write_text(html, encoding="utf-8")
    print("書き出し:", folder / "dev.html")


if __name__ == "__main__":
    main()
