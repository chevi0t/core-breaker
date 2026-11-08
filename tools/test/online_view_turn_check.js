// ゲストがマウスで視点を回すと、毎コマ回ること（2026-11-08 オーナー報告：マウスで回すとカクつく）。
// 実時間の rAF で動かす（描画は省略）。node tools/test/online_view_turn_check.js dbg --mock-transport
const {check}=require('./lib');
const {harness,room,sleep}=require('./online_test_helpers');
check('オンラインのゲスト視点の旋回',async({browser,dir,ok,errors})=>{
  const h=await harness(dir);let r;
  try{
    r=await room(browser,h,errors,{guests:1,teamSize:2,frozen:false});
    const g=r.guests[0];
    await sleep(1500);
    // 毎コマ、マウスを横へ4px動かし、前進を押し続ける。コマの終わりに自機の向きと位置を記録する。
    await g.evaluate(()=>{
      window.__turnLog=[];
      const rec=()=>{if(__g.player){__turnLog.push([__g.player.yaw,__g.player.pos.x,__g.player.pos.z]);__g.lookMove(4,0,0.0025);__g.keys.KeyW=true;}requestAnimationFrame(rec);};
      requestAnimationFrame(rec);
    });
    await sleep(4000);
    const {log,m}=await g.evaluate(()=>({log:__turnLog,m:CBOnlineGame.metrics().prediction}));
    const steps=[];for(let i=31;i<log.length;i++)steps.push(log[i][0]-log[i-1][0]);
    const still=steps.filter(d=>Math.abs(d)<1e-6).length;
    console.log('記録コマ',steps.length,'向きが変わらなかったコマ',still,'補正',m.correctionCount,'平均',m.correctionMean.toFixed(4),'最大',m.correctionMax.toFixed(4),'瞬間合わせ',m.hardSnaps);
    ok(steps.length>=120,'実時間で120コマ以上動く');
    ok(still===0,'マウスを動かした全てのコマで視点が回る（写真の間に古い向きへ戻らない）');
    ok(m.correctionMean<.05&&m.hardSnaps===0,'旋回しながら前進しても自機の補正は平均0.05m未満で瞬間合わせなし');
  }finally{await r?.close().catch(()=>{});await h.close();}
});
