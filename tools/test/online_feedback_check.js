// ゲストにも、自分が起こした撃破・破壊・蘇生の札、得点、被弾の方向、リペアユニットの光線が出ること
// （2026-11-08 オーナー「撃破のシンボルとか出なかったり、repairのエフェクトが出なかったりする」）。
// node tools/test/online_feedback_check.js dbg <出力先> --mock-transport
const {check}=require('./lib');
const {harness,room,frames}=require('./online_test_helpers');
check('オンラインのゲストへの手応え',async({browser,dir,ok,errors})=>{
  const h=await harness(dir,{realTime:true});let r;
  try{
    r=await room(browser,h,errors,{guests:1,teamSize:3});
    const g=r.guests[0];
    await frames(r.pages,20,16.7);
    await g.evaluate(()=>{document.getElementById('popups').innerHTML='';document.getElementById('scorePop').innerHTML='';
      window.__hurt=0;const f=window.flashDamage;window.flashDamage=function(...a){__hurt++;return f.apply(this,a);};});
    const names=await r.host.evaluate(()=>{
      const id=CBOnlineGame.state.peers.values().next().value.unitId,me=__g.units.find(u=>u.entityId===id);
      const enemy=__g.units.find(u=>u.team!==me.team&&u.alive),ally=__g.units.find(u=>u.team===me.team&&u!==me&&u.controller==='bot');
      window.__ally=ally.entityId;
      // 写真を作る直前に、味方Botのリペアユニットの相手をゲストにする（本体のリペア処理と同じ値）。
      const after=CBOnlineGame.afterFrame;CBOnlineGame.afterFrame=(dt,t)=>{ally.healTarget=me;return after(dt,t);};
      __g.kill(enemy,me,true,1000,null);
      const shooter=__g.units.find(u=>u.team!==me.team&&u.alive&&u!==enemy)||enemy;me.invulT=0;
      window.__hurtResult=__g.damage(me,shooter,10,false);
      // ホスト自身の札は出さない（遠隔の人間の物）
      return {enemy:enemy.name,hostPops:document.getElementById('popups').children.length};
    });
    await frames(r.pages,20,16.7);
    const got=await g.evaluate(ally=>({pops:[...document.getElementById('popups').children].map(e=>e.textContent),
      scores:[...document.getElementById('scorePop').children].map(e=>e.textContent),hurt:window.__hurt,
      heal:(()=>{const u=__g.units.find(u=>u.entityId===ally);return {target:u.healTarget?.entityId||null,beam:!!u.beam.visible,me:__g.player.entityId};})()}),await r.host.evaluate(()=>window.__ally));
    console.log('ゲスト',JSON.stringify(got),'ホストの札',names.hostPops);
    ok(got.pops.some(t=>t.includes('撃破')&&t.includes('HEADSHOT')&&t.includes(names.enemy)),'ゲストに自分の撃破の札（ヘッドショットと相手の名前）が出る');
    ok(names.hostPops===0,'ホストの画面にはゲストの撃破の札を出さない');
    ok(got.scores.length>0,'ゲストに自分の得点が出る');
    ok(got.hurt>0,'ゲストが撃たれると被弾の方向が出る');
    ok(got.heal.target===got.heal.me&&got.heal.beam,'味方のリペアユニットの光線がゲストでも見える');
  }finally{await r?.close().catch(()=>{});await h.close();}
},{page:false});
