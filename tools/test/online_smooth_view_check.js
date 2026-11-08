// ゲストの自機の表示が、60Hzより速い画面（ここでは144Hz相当の7msコマ）でも毎コマなめらかに進むこと（2026-11-08 オーナー報告：
// ゲストのロックオン後の挙動がカクカク）。自機は1/60秒の固定命令で進むので、補間が無いと0歩のコマと1歩のコマが混ざり、
// カメラとロック追従の向きが段になる。ロックの枠も描画と同じずらしたカメラで投影する（オーナー「ロックオンカーソルが微振動」）。node tools/test/online_smooth_view_check.js dbg <出力先> --mock-transport
const {check}=require('./lib');
const {harness,room,frames,input,neutral}=require('./online_test_helpers');
check('オンラインのゲスト自機の表示のなめらかさ',async({browser,dir,ok,errors})=>{
  const h=await harness(dir,{realTime:true});let r;
  try{
    r=await room(browser,h,errors,{guests:1,teamSize:2});
    const g=r.guests[0];
    await frames(r.pages,30,16.7);
    // ホストで敵1機をゲストの40m前に止めておく（写真を作る直前に毎コマ戻す）。
    const enemy=await r.host.evaluate(()=>{
      const id=CBOnlineGame.state.peers.values().next().value.unitId,me=__g.units.find(u=>u.entityId===id);
      const en=__g.units.find(u=>u.team!==me.team&&u.alive);let at=null;
      // 遮る物の無い向きを探す（ロックが見えなくて外れないように）。
      for(let i=0;i<32&&!at;i++)for(const dist of [25,20,35]){const yaw=me.yaw+i*Math.PI/16,p=me.pos.clone().add(new __g.T.Vector3(-Math.sin(yaw)*dist,0,-Math.cos(yaw)*dist));
        p.y=__g.terrainH(p.x,p.z);en.pos.copy(p);en.group.position.copy(p);en.group.updateMatrixWorld(true);if(__g.canSee(me,en,__g.targetPoint(en))){at=p;break;}}
      if(!at)return null;
      const after=CBOnlineGame.afterFrame;CBOnlineGame.afterFrame=(dt,t)=>{en.pos.copy(at);en.vel.set(0,0,0);en.hp=en.maxHp;return after(dt,t);};
      return en.entityId;
    });
    ok(!!enemy,'ホストで、見通せる所に敵を置けた');
    await frames(r.pages,20,16.7);
    // 前進と横移動を押したまま、7msコマで回す。各コマの終わりに表示位置（確定位置＋ずらし）と向きを記録する。
    const record=async(lock)=>{
      await g.evaluate(({enemy,lock})=>{
        const P=__g.player,t=__g.units.find(u=>u.entityId===enemy);
        if(lock){const a=__g.anglesTo(P,__g.targetPoint(t));P.yaw=a.yaw;P.pitch=a.pitch;__g.setLock(P,t);}else __g.releaseLock();
        window.__view=[];const after=CBOnlineGame.__afterOrig||(CBOnlineGame.__afterOrig=CBOnlineGame.afterFrame);
        CBOnlineGame.afterFrame=(dt,tm)=>{after(dt,tm);const o=__g.onlineViewOffset(P),p=P.pos.clone();const v=o?p.clone().add(o):p;
          // ロックの枠の画面位置と、描画と同じずらしたカメラで投影した敵の位置の差（px）
          let err=null;const mk=document.getElementById('lockMark'),m=/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(mk.style.transform||'');
          if(lock&&m&&!mk.hidden){const cam=__g.camera,saved=cam.position.clone();if(o)cam.position.add(o);cam.updateMatrixWorld();
            const s=__g.targetPoint(t).project(cam);cam.position.copy(saved);cam.updateMatrixWorld();
            err=Math.hypot((s.x+1)/2*innerWidth-+m[1],(1-s.y)/2*innerHeight-+m[2]);}
          __view.push([v.x,v.z,p.x,p.z,P.yaw,!!(__g.lock.target&&__g.lock.visible),err]);};
      },{enemy,lock});
      await input(g,{...neutral,keys:lock?{KeyD:true}:{KeyW:true},side:lock?1:0,fwd:lock?0:1});
      await frames(r.pages,120,7);
      await input(g,{...neutral});
      return g.evaluate(()=>window.__view);
    };
    const stats=(v,from)=>{
      const d=[],raw=[];for(let i=from;i<v.length;i++){d.push(Math.hypot(v[i][0]-v[i-1][0],v[i][1]-v[i-1][1]));raw.push(Math.hypot(v[i][2]-v[i-1][2],v[i][3]-v[i-1][3]));}
      const mean=a=>a.reduce((x,y)=>x+y,0)/a.length,cv=a=>{const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)))/m;};
      return {frames:d.length,meanStep:mean(d),cv:cv(d),rawCv:cv(raw),rawStill:raw.filter(x=>x<1e-6).length,still:d.filter(x=>x<1e-6).length};
    };
    const walk=stats(await record(false),40);
    console.log('前進',JSON.stringify(walk));
    ok(walk.meanStep>0.02,'7msコマで前進している');
    ok(walk.rawStill>walk.frames*.15,'確定位置は固定命令の刻みで、動かないコマが混ざる（補間が要る条件の確認）');
    ok(walk.still===0&&walk.cv<.2,'表示位置は全てのコマで進み、1コマの移動量のばらつき（変動係数）が0.2未満');
    const view=await record(true);const locked=stats(view,40);
    const yaw=[];for(let i=41;i<view.length;i++)yaw.push(Math.abs(view[i][4]-view[i-1][4]));
    const lockedFrames=view.slice(40).filter(v=>v[5]).length;
    const still=yaw.filter(x=>x<1e-7).length,mean=yaw.reduce((a,b)=>a+b,0)/yaw.length,cv=Math.sqrt(yaw.reduce((a,b)=>a+(b-mean)**2,0)/yaw.length)/mean;
    console.log('ロック中の横移動',JSON.stringify(locked),'向きの変化',JSON.stringify({frames:yaw.length,still,mean,cv,lockedFrames}));
    ok(lockedFrames===view.length-40,'記録中ずっとロックが続く');
    ok(locked.still===0&&locked.cv<.2,'ロック中に横へ動いても、表示位置は毎コマなめらかに進む');
    ok(still===0&&cv<.35,'ロック追従の向きも毎コマ回り、止まるコマが無い');
    const errs=view.slice(40).map(v=>v[6]).filter(v=>v!==null),maxErr=Math.max(...errs);
    console.log('ロックの枠と描画上の敵の差 px',JSON.stringify({frames:errs.length,max:maxErr}));
    ok(errs.length>=60&&maxErr<.5,'ロックの枠は描画と同じカメラで投影され、敵からずれて揺れない（差0.5px未満）');
    // カタパルトの飛翔中は先読みできず、自機は写真（30Hz）の位置に置かれる。描画は写真の速度で今まで進める。
    await r.host.evaluate(()=>{__g.releaseLock?.();const id=CBOnlineGame.state.peers.values().next().value.unitId,me=__g.units.find(u=>u.entityId===id);
      const cp=__g.catapults[0];if(cp)__g.launch(me,cp);window.__launched=!!cp;});
    if(await r.host.evaluate(()=>window.__launched)){
      // 実際の遊びでは描画の時計と通信の時計は同じ。試験のコマ送り（7ms）と実時間がずれないよう、ここから両方のページの
      // performance.now もコマ送りの時計で進める（途中で戻らないよう、今の差を足して続ける）。
      for(const p of r.pages)await p.evaluate(()=>{const real=performance.now.bind(performance),d=real()-window.__onlineT;performance.now=()=>window.__onlineT+d;});
      await frames(r.pages,4,7);
      await g.evaluate(()=>{__g.releaseLock();window.__view=[];const P=__g.player;
        CBOnlineGame.afterFrame=(dt,tm)=>{CBOnlineGame.__afterOrig(dt,tm);const o=__g.onlineViewOffset(P),p=P.pos.clone(),v=o?p.clone().add(o):p;
          __view.push([v.x,v.z,p.x,p.z,P.yaw,!!P.flying]);};});
      await frames(r.pages,100,7);
      const fly=(await g.evaluate(()=>window.__view)).filter(v=>v[5]);const f=stats(fly,1);
      console.log('カタパルト飛翔',JSON.stringify(f));if(process.env.DUMP)console.log(fly.slice(1).map((v,i)=>Math.hypot(v[0]-fly[i][0],v[1]-fly[i][1]).toFixed(2)+'/'+Math.hypot(v[2]-fly[i][2],v[3]-fly[i][3]).toFixed(2)).join(' '));
      ok(fly.length>=60,'ゲストでもカタパルトで飛んでいる');
      ok(f.rawStill>f.frames*.3,'確定位置は写真ごとにしか動かない（補う条件の確認）');
      ok(f.still===0&&f.cv<.35,'飛翔中も表示位置は毎コマ進み、ばらつきが小さい');
    } else console.log('このマップにカタパルトが無いので飛翔の確認は省略');
  }finally{await r?.close().catch(()=>{});await h.close();}
},{page:false});
