// ゲストの画面の「震え」と「コマ送り」を数で見つける（2026-11-08 オーナー「画面震えとか敵の震えとか、コマ送り的な表示に
// なるとことか、AIのテストプレイで検知出来ないんかな」→「作ってください」）。
//
// ほかのオンライン試験は描画を止めて決まった刻みでコマ送りするので、画面の速さの違い・通信の揺らぎ・途中のガタつきが出ない。
// ここでは実時間で、ホストは60Hz、ゲストは144Hz相当（7ms前後でばらつく）のコマで回し、通信には揺らぐ遅れ（片道25〜60ms、
// 順序は保つ）を入れる。ゲストが「歩きながらマウスで旋回」「左右へ動く敵をロックして左右に横移動」「カタパルトで飛びながら
// 見回す」をする間、描画のたびにカメラ（向き・位置）、自機・敵・味方の画面上の位置、ロックの枠の位置を記録し、1080p の画面に
// 直して、1コマだけ外れた動き（下の analyze）を数える。どの物も、見て分かる大きさ（1.5px以上）のものが1場面で2回までなら合格。
//   - 跳ね・止まり（コマ送り）：そのコマだけ一気に進む／進まない
//   - 震え　　　　　　　　　　：そのコマだけ横や逆へずれて、次のコマで戻る
// 被弾の揺れ（blastShake）・よろけ・ダウンのコマ、場面の始めの10コマ、試験の機械の引っかかりのコマは数えない。
// 確かめたこと（2026-11-08）：#217 の前（1905251）と、この試験で見つけて直す前（ab43ed8）では大きく不合格になる。
//
// node tools/test/online_jitter_check.js dbg <出力先> --mock-transport   （JITTER_DUMP=1 で記録をJSONに書き出す）
// 結果の表は <出力先>/online-jitter.json。
const fs=require('node:fs'),path=require('node:path');
const {check}=require('./lib');
const {harness,room,frames,sleep}=require('./online_test_helpers');

// 通信の揺らぎ。代替通信（BroadcastChannel）の受信を、接続ごとに順序を保ったまま遅らせる。どのページにも入る。
const NET_JITTER=`(()=>{
  const BC=window.BroadcastChannel;if(!BC)return;
  let seed=(214+Math.floor(Math.random()*1e6))>>>0;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const cfg=window.__netJitter={enabled:false,base:25,spread:35,delivered:0},last=new Map();
  window.BroadcastChannel=class extends BC{
    set onmessage(f){super.onmessage=e=>{
      const m=e.data;if(!cfg.enabled||m?.type!=='data'){f(e);return;}
      const now=performance.now(),at=Math.max(last.get(m.id)||0,now+cfg.base+rnd()*cfg.spread);last.set(m.id,at);
      setTimeout(()=>{cfg.delivered++;f(e);},at-now);
    };}
    get onmessage(){return super.onmessage;}
  };
})();`;

// 1つの系列（[時刻ms, x, y]、1080p の画面に直した px）を調べる。コマごとの速さ v を出し、隣のコマとの速さの変化を
// 1コマの移動に直した量 a（px）を見る。速さが一度だけ変わる（加速・切り返し）のは自然な動きなので数えない。
// a が見て分かる大きさ（VISIBLE_PX）以上で、次のコマで逆向きに戻る、つまり1コマだけ外れたコマを数える。
//   跳ね：そのコマだけ大きく進む　止まり：そのコマだけ進まない（遅れる）　震え：そのコマだけ横や逆へずれる
const VISIBLE_PX=1.5,ALLOWED=2;
function analyze(rows){
  const v=[],dt=[];
  for(let i=1;i<rows.length;i++){const d=Math.max(1e-4,(rows[i][0]-rows[i-1][0])/1000);dt.push(d);v.push([(rows[i][1]-rows[i-1][1])/d,(rows[i][2]-rows[i-1][2])/d]);}
  const len=x=>Math.hypot(x[0],x[1]);
  const a=v.map((x,i)=>i?[(x[0]-v[i-1][0])*dt[i],(x[1]-v[i-1][1])*dt[i]]:[0,0]);
  // 試験の機械が詰まってコマの間隔が外れたコマ（引っかかり。ねらいの7msが10ms以上になるなど）は数えず、数だけ出す。
  // 実際の画面は垂直同期で間隔がほぼ揃う。ロック追従は、間隔が不揃いなコマで1〜2px乱れることがある（通信と関係なく起きる）。
  const md=[...dt].sort((x,y)=>x-y)[dt.length>>1],odd=i=>dt[i]<md*.75||dt[i]>md*1.3;
  const marks=[];let stall=0,jump=0,zig=0,maxA=0,hitches=0;
  for(let i=1;i+1<v.length;i++){
    if(odd(i-1)||odd(i)||odd(i+1)){if(odd(i))hitches++;continue;}
    const m1=len(a[i]),m2=len(a[i+1]);maxA=Math.max(maxA,Math.min(m1,m2));
    if(m1<VISIBLE_PX||m2<VISIBLE_PX||a[i][0]*a[i+1][0]+a[i][1]*a[i+1][1]>-.5*m1*m2)continue;
    // 前後のコマの速さを結んだ線に対して、このコマがどうずれたか
    const base=[(v[i-1][0]+v[i+1][0])/2,(v[i-1][1]+v[i+1][1])/2],bl=len(base),cur=v[i];
    const along=bl>1e-6?(cur[0]*base[0]+cur[1]*base[1])/bl:0,dev=Math.min(m1,m2);
    if(bl>1e-6&&along>bl*1.3){jump++;marks.push(['跳ね',i,+dev.toFixed(1)]);}
    else if(bl>1e-6&&along<bl*.7&&along>-bl*.3){stall++;marks.push(['止まり',i,+dev.toFixed(1)]);}
    else{zig++;marks.push(['震え',i,+dev.toFixed(1)]);}
    i++;
  }
  return {frames:v.length,stall,jump,zig,hitches,maxDevPx:+maxA.toFixed(2),marks:marks.slice(0,12)};
}
const judge=r=>r.stall+r.jump+r.zig<=ALLOWED;
const fmt=r=>`止まり${r.stall} 跳ね${r.jump} 震え${r.zig}（${r.frames}コマ、1コマだけのずれの最大 ${r.maxDevPx}px、除いた引っかかり${r.hitches}コマ）`;

check('オンラインのゲスト画面の震えとコマ送り',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir,{realTime:true});let r;
  h.context=await browser.newContext({viewport:{width:960,height:540}});
  await h.context.addInitScript(NET_JITTER);
  const report={method:'実時間。ホスト60Hz・ゲスト約144Hz（6〜8ms）のコマ、代替通信に片道25〜60msの揺らぐ遅れ（順序は保つ）。描画は省略し、描画の呼び出しの時点のカメラと位置を記録。実WebRTC・実GPUではない。',visiblePx:VISIBLE_PX,allowedPerSeries:ALLOWED,scenes:{}};
  try{
    r=await room(browser,h,errors,{guests:1,teamSize:2});
    const g=r.guests[0],host=r.host;
    await frames(r.pages,20,16.7);
    // ホスト：ゲストの機体は倒れないように。敵1機をゲストの前に置き、左右へゆっくり往復させる（ロックの的）。
    const enemy=await host.evaluate(()=>{
      const id=CBOnlineGame.state.peers.values().next().value.unitId,me=__g.units.find(u=>u.entityId===id),T=__g.T;
      const en=__g.units.find(u=>u.team!==me.team&&u.alive);let at=null,yaw=0,right=new T.Vector3(1,0,0);
      // 置き直せるように関数にする。歩き旋回の場面でゲストが動いた後、ロックの場面の直前にもう一度、その時の位置から探す
      // （始めの位置でだけ確かめていたので、歩いた先で防衛砲台が間に入り、ロックが切れて時々落ちた。2026-11-10）。
      window.__placeEnemy=()=>{at=null;
      // 確かめる前に、ほかの機体を退かす（始めの1回は、まだ近くにいる味方や敵の Bot が見通しを遮り、まれに置き場所が見つからなかった）。
      for(const u of __g.units)if(u!==me&&u!==en){u.pos.set(u.team===me.team?-4000:4000,0,4000);u.vel.set(0,0,0);u.group.position.copy(u.pos);u.group.updateMatrixWorld(true);}
      // ゲストが横へ動き、敵が±6m往復しても、ずっと見通せる向きと距離を探す（遮られるとロックが外れ、試験の外の動きになる）。
      // 横移動は右へ0.75秒（約9m）進んで戻る。前は±4mしか確かめておらず、その先に物がある場所ではロックが切れて時々落ちた（2026-11-10）。
      const home=me.pos.clone(),clear=(p,r)=>{for(let a=-3;a<=12;a++)for(let b=-6;b<=6;b+=1.5){ // 細い物も拾えるよう1m刻み（3m刻みでは間の柱を見落とした）
       
        me.pos.copy(home).addScaledVector(r,a);me.group.position.copy(me.pos);me.group.updateMatrixWorld(true);
        en.pos.copy(p).addScaledVector(r,b);en.pos.y=__g.terrainH(en.pos.x,en.pos.z);en.group.position.copy(en.pos);en.group.updateMatrixWorld(true);
        if(!__g.canSee(me,en,__g.targetPoint(en)))return false;}return true;};
      for(let i=0;i<32&&!at;i++)for(const dist of [30,25,40]){yaw=me.yaw+i*Math.PI/16;const p=home.clone().add(new T.Vector3(-Math.sin(yaw)*dist,0,-Math.cos(yaw)*dist));
        p.y=__g.terrainH(p.x,p.z);if(clear(p,new T.Vector3(Math.cos(yaw),0,-Math.sin(yaw)))){at=p;break;}}
      me.pos.copy(home);me.group.position.copy(home);me.group.updateMatrixWorld(true);
      if(!at)return false;
      right.set(Math.cos(yaw),0,-Math.sin(yaw));en.pos.copy(at);return true;};
      if(!__placeEnemy())return null;
      me.yaw=yaw;
      const t0=performance.now();
      const after=CBOnlineGame.afterFrame;CBOnlineGame.afterFrame=(dt,t)=>{
        const s=(performance.now()-t0)/1000,k=Math.sin(s*.9)*6;
        if(window.__pinEnemy!==false){en.pos.copy(at).addScaledVector(right,k);en.pos.y=__g.terrainH(en.pos.x,en.pos.z);en.vel.copy(right).multiplyScalar(Math.cos(s*.9)*6*.9);en.hp=en.maxHp;}
        // 遠ざけたBotが置いた妨害（ジャマー）などでロックが外れないよう、ゲスト機の状態異常も毎コマ消す。
        me.hp=me.maxHp;me.jamT=0;for(const u of __g.units)if(u.team!==me.team&&u!==en){u.pos.set(4000,0,4000);u.vel.set(0,0,0);}
        // 味方のBotも遠ざける。ゲストのすぐ前（敵との見通しの線上）に立たれると、横移動のたびに敵が味方の陰に入ってロックが切れ、
        // ロック追従の向きが止まる・動き出すのを「跳ね・止まり」と数えていた（2026-11-10：統合の前後どちらでも3〜4回に1回落ちた原因）。
        for(const u of __g.units)if(u.team===me.team&&u!==me){u.pos.set(-4000,0,4000);u.vel.set(0,0,0);}
        return after(dt,t);};
      return {id:en.entityId,yaw};
    });
    ok(!!enemy,'ホストで、見通せる所に動く敵を置けた');
    // ここから実時間：ゲストとホストが自分のタイマーでコマを回す。通信の揺らぎも入れる。
    for(const [p,ms,spread]of [[host,16.7,0],[g,7,1]])await p.evaluate(([ms,spread])=>{
      window.__netJitter.enabled=true;window.__frameTimes=[];
      const tick=()=>{if(window.__stopLoop)return;const t=performance.now();window.__frameT=t;window.__frameTimes.push(t);try{window.__drive?.();__g.loop(t);}catch(e){console.error(e.stack||e.message);}
        setTimeout(tick,Math.max(0,ms+(Math.random()*2-1)*spread-(performance.now()-t)));};
      setTimeout(tick,ms);
    },[ms,spread]);
    // ゲスト：描画の呼び出しの時点（ずらしたカメラ込み）で記録する。時刻は、そのコマの動きの計算に使った時刻（実際の画面の rAF の時刻に当たる）。
    await g.evaluate(enemyId=>{
      const T=__g.T,cam=__g.camera,P=__g.player,dir=new T.Vector3(),v=new T.Vector3();
      const screen=p=>{v.copy(p).project(cam);return v.z>1||Math.abs(v.x)>1.2||Math.abs(v.y)>1.2?null:[(v.x+1)/2*innerWidth,(1-v.y)/2*innerHeight];};
      window.__rec=[];window.__scene='';
      __g.renderer.render=(scene,camera)=>{
        scene.updateMatrixWorld(true);if(!window.__scene)return;
        cam.getWorldDirection(dir);
        const mk=document.getElementById('lockMark'),m=/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(mk?.style.transform||'');
        const others=__g.units.filter(u=>u!==P&&u.alive&&!u.onlineHidden&&u.pos.distanceTo(P.pos)<200).map(u=>[u.entityId,...u.group.position.toArray(),screen(u.group.position.clone().setY(u.group.position.y+1.5))]);
        const disturbed=__g.blastShake.power>0||P.downT>0||P.staggerT>0||!!P.stun;
        const yaw=Math.atan2(-dir.x,-dir.z),prev=__rec.at(-1);const yawU=prev?prev.yawU+((yaw-prev.yaw+3*Math.PI)%(2*Math.PI)-Math.PI):yaw;
        __rec.push({t:window.__frameT,scene:window.__scene,cam:cam.position.toArray(),fov:cam.fov,yaw,yawU,pitch:Math.asin(Math.max(-1,Math.min(1,dir.y))),
          own:P.group.position.toArray(),ownScreen:screen(P.group.position.clone().setY(P.group.position.y+1.5)),
          lock:m&&!mk.hidden?[+m[1],+m[2]]:null,locked:!!(__g.lock.target&&__g.lock.visible),flying:!!P.flying,disturbed,others});
      };
    },enemy.id);
    await sleep(1200);
    const scene=async(name,setup,ms)=>{
      await g.evaluate(([name,setup])=>{window.__scene=name;(new Function(setup))();},[name,setup]);
      await sleep(ms);
      await g.evaluate(()=>{window.__scene='';window.__drive=null;for(const k of Object.keys(__g.keys))__g.keys[k]=false;});
      await sleep(300);
    };
    // 1. 歩きながらマウスで旋回（毎コマ、経過時間に比例した量だけ横へ回す）
    await scene('歩き旋回',`let last=performance.now();__g.releaseLock();window.__drive=()=>{const t=performance.now(),d=(t-last)/1000;last=t;__g.keys.KeyW=true;__g.lookMove(300*d,0,.0025);};`,3000);
    // 2. 動く敵をロックして横移動（歩いた先の位置から、見通せる所へ敵を置き直す）
    ok(await host.evaluate(()=>__placeEnemy()),'歩いた後の位置からも、見通せる所に敵を置けた');
    await sleep(600);
    await g.evaluate(id=>{const P=__g.player,t=__g.units.find(u=>u.entityId===id);const a=__g.anglesTo(P,__g.targetPoint(t));P.yaw=a.yaw;P.pitch=a.pitch;__g.setLock(P,t);},enemy.id);
    // 左右へ0.75秒ずつ切り返しながら横移動する（遠くへ行って見通しが変わらないように）
    await scene('ロック横移動',`const t0=performance.now();window.__drive=()=>{const r=Math.floor((performance.now()-t0)/750)%2===0;__g.keys.KeyD=r;__g.keys.KeyA=!r;};`,3000);
    // 3. カタパルトで飛ぶ（ホストが発射させる）
    const hasCat=await host.evaluate(()=>{window.__pinEnemy=false;const id=CBOnlineGame.state.peers.values().next().value.unitId,me=__g.units.find(u=>u.entityId===id);const cp=__g.catapults?.[0];if(cp)__g.launch(me,cp);return !!cp;});
    // 飛んでいる間も、マウスでゆっくり見回す（遊ぶ人はよくする。向きを写真で戻すと、ここで画面が引き戻される）。
    if(hasCat)await scene('カタパルト',`__g.releaseLock();let last=performance.now();window.__drive=()=>{const t=performance.now(),d=(t-last)/1000;last=t;__g.lookMove(150*d,0,.0025);};`,2500);
    for(const p of r.pages)await p.evaluate(()=>{window.__stopLoop=true;});
    const rec=await g.evaluate(()=>window.__rec);
    const ft={};for(const [name,p]of [['ホスト',host],['ゲスト',g]]){const t=await p.evaluate(()=>window.__frameTimes);const d=t.slice(1).map((x,i)=>x-t[i]).sort((a,b)=>a-b);ft[name]={frames:t.length,median:d[d.length>>1],p95:d[Math.floor(d.length*.95)],max:d[d.length-1]};}
    report.frameTimes=ft;report.netDelivered=await g.evaluate(()=>window.__netJitter.delivered);
    console.log('コマの間隔 ms',JSON.stringify(ft),'揺らぎを入れて届けた通信',report.netDelivered);
    ok(ft['ゲスト'].median<10&&ft['ホスト'].median>14,'ゲストは60Hzより速く、ホストは60Hz前後で回った');
    ok(report.netDelivered>100,'通信に揺らぐ遅れを入れて届けた');
    if(process.env.JITTER_DUMP)fs.writeFileSync(path.join(out,'online-jitter-record.json'),JSON.stringify(rec));
    const failed=[];
    for(const name of ['歩き旋回','ロック横移動',...(hasCat?['カタパルト']:[])]){
      // 場面の始めの10コマは、前の場面からの切り替え（ロックした瞬間の向き合わせ、射出の瞬間）なので数えない。
      const rows=rec.filter(x=>x.scene===name&&!x.disturbed&&(name!=='カタパルト'||x.flying)).slice(10);
      // 1080p の画面に直す（試験の画面は 960x540）。カメラの向きは焦点距離で、位置は10m先の物の動きで px にする。
      // カメラの位置は、毎コマの移動をそのコマのカメラの右・上の向きへ分けて足していく（前後の動きは画面の揺れに出にくいので除く）。
      const camShift=rows=>{let x=0,y=0;return rows.map((r,i)=>{if(i){const p=rows[i-1].cam,dx=r.cam[0]-p[0],dz=r.cam[2]-p[2];x+=dx*Math.cos(r.yaw)-dz*Math.sin(r.yaw);y+=r.cam[1]-p[1];}return [x,y];});};
      const K=1080/540,focal=x=>540/Math.tan(x.fov*Math.PI/360);
      const series={
        'カメラの向き':rows.map(x=>[x.t,x.yawU*focal(x),x.pitch*focal(x)]),
        'カメラの位置（10m先の見え方）':camShift(rows).map((v,i)=>[rows[i].t,v[0]*focal(rows[i])/10,v[1]*focal(rows[i])/10]),
        '自機（画面上）':rows.filter(x=>x.ownScreen).map(x=>[x.t,x.ownScreen[0]*K,x.ownScreen[1]*K]),
      };
      if(name==='ロック横移動')series['ロックの枠（画面上）']=rows.filter(x=>x.lock).map(x=>[x.t,x.lock[0]*K,x.lock[1]*K]);
      const ids=[...new Set(rows.flatMap(x=>x.others.map(o=>o[0])))];
      for(const id of ids){
        // 画面に続けて映っている間だけ（出入りの境目はつながない）
        let run=[];const flush=()=>{if(run.length>=60)series[`${id===enemy.id?'敵':'味方'} ${id}（画面上${Object.keys(series).filter(k=>k.startsWith((id===enemy.id?'敵':'味方')+' '+id)).length?'・続き':''}）`]=run;run=[];};
        for(const x of rows){const o=x.others.find(o=>o[0]===id);if(o?.[4])run.push([x.t,o[4][0]*K,o[4][1]*K]);else flush();}
        flush();
      }
      report.scenes[name]={frames:rows.length,series:{}};
      console.log(`■ ${name}（${rows.length}コマ）`);
      ok(rows.length>=(name==='カタパルト'?100:250),`${name}：記録できた（${rows.length}コマ）`);
      if(name==='ロック横移動'){const n=rows.filter(x=>x.locked).length;console.log(`  ロックが続いたコマ ${n}/${rows.length}`);if(n<rows.length*.9)failed.push(`ロック横移動：ロックが途中で外れた（${n}/${rows.length}コマ）`);}
      for(const [label,data]of Object.entries(series)){
        if(data.length<30)continue;
        const res=analyze(data),pass=judge(res);report.scenes[name].series[label]={...res,pass};
        console.log(`  ${pass?'○':'×'} ${label}：${fmt(res)}`);
        if(!pass)failed.push(`${name} ${label}：${fmt(res)}`);
      }
    }
    fs.writeFileSync(path.join(out,'online-jitter.json'),JSON.stringify(report,null,1));
    ok(failed.length===0,`どの場面・どの物も、見て分かる（1080pで${VISIBLE_PX}px以上の）止まり・跳ね・震えが${ALLOWED}回以下`+(failed.length?'\n    '+failed.join('\n    '):''));
  }finally{for(const p of r?.pages||[])await p.evaluate(()=>{window.__stopLoop=true;}).catch(()=>{});await r?.close().catch(()=>{});await h.close();}
},{page:false});
