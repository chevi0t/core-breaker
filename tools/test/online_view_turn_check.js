// ゲストがマウスで視点を回すと、毎コマ回ること（2026-11-08 オーナー報告：マウスで回すとカクつく）。
// 実時間の rAF と可変dtで動かす（描画は省略）。node tools/test/online_view_turn_check.js dbg /tmp/online-view-turn --mock-transport
// 通常通信のsmoke。反復控除を強制した旧不具合の回帰はonline_camera.test.jsが担当する。
const {check}=require('./lib');
const {harness,room,sleep}=require('./online_test_helpers');
check('オンラインのゲスト視点の旋回',async({browser,dir,ok,errors})=>{
  const h=await harness(dir,{realTime:true});let r;
  try{
    r=await room(browser,h,errors,{guests:1,teamSize:2,frozen:false});
    const g=r.guests[0];
    await sleep(1500);
    // 毎コマ、マウスを横へ4px動かし、前進を押し続ける。コマの終わりに自機の向きと位置を記録する。
    await g.evaluate(()=>{
      window.__turnLog=[];window.__turnDt=[];
      const after=CBOnlineGame.afterFrame;CBOnlineGame.afterFrame=(dt,t)=>{after(dt,t);__turnDt.push(dt);};
      const rec=()=>{if(__g.player){__turnLog.push([__g.player.yaw,__g.player.pos.x,__g.player.pos.z]);__g.lookMove(4,0,0.0025);__g.keys.KeyW=true;}requestAnimationFrame(rec);};
      requestAnimationFrame(rec);
    });
    await sleep(4000);
    const {log,m,dts}=await g.evaluate(()=>({log:__turnLog,m:CBOnlineGame.metrics().prediction,dts:__turnDt}));
    const steps=[];for(let i=31;i<log.length;i++)steps.push(log[i][0]-log[i-1][0]);
    const still=steps.filter(d=>Math.abs(d)<1e-6).length,reversed=steps.filter(d=>d>1e-6).length;
    console.log('記録コマ',steps.length,'向きが変わらなかったコマ',still,'逆回転コマ',reversed,'補正',m.correctionCount,'平均',m.correctionMean.toFixed(4),'最大',m.correctionMax.toFixed(4),'瞬間合わせ',m.hardSnaps);
    console.log('ゲームdt秒',JSON.stringify({count:dts.length,mean:dts.reduce((a,b)=>a+b,0)/Math.max(1,dts.length),max:Math.max(0,...dts),distinct:new Set(dts.map(v=>v.toFixed(5))).size}));
    ok(steps.length>=120,'実時間で120コマ以上動く');
    ok(still===0&&reversed===0,'マウスを動かした全てのコマで入力方向へ視点が回り、停止も逆回転もない');
    ok(m.correctionMean<.05&&m.hardSnaps===0,'旋回しながら前進しても自機の補正は平均0.05m未満で瞬間合わせなし');
  }finally{await r?.close().catch(()=>{});await h.close();}
},{page:false});
