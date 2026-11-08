// node tools/test/online_downed_input_check.js dbg <出力先> [--mock-transport]
// 実キー入力からホストの既存downTick、大破写真、再出撃まで。
const {check}=require('./lib');
const {harness,room,frames,sleep}=require('./online_test_helpers');
check('行動不能のゲストF',async({browser,dir,ok,errors})=>{
  const h=await harness(dir);let r;
  try{
    r=await room(browser,h,errors,{guests:1,teamSize:2});const g=r.guests[0];
    await frames(r.pages,10);
    await r.host.evaluate(()=>{
      for(const u of __g.units)if(u.controller==='bot'){u.controller='remoteHuman';u.controlInput={keys:{},pressed:{}};}
      const peer=CBOnlineGame.state.peers.values().next().value;
      const u=__g.units.find(u=>u.entityId===peer.unitId),enemy=__g.units.find(e=>e.team!==u.team);
      window.__downLife=u.lifeId;window.__downTeam=u.team;window.__downCore=__g.cores[u.team].hp;
      __g.kill(u,enemy,false,100,'試験');
      window.__downDeaths=u.sc.deaths;
      window.__wreckCalls=0;const old=window.wreck;window.wreck=function(v){if(v===u)__wreckCalls++;return old(...arguments);};
    });
    await frames(r.pages,12);await sleep(40);await frames([g],2);
    ok(await g.evaluate(()=>!__g.player.alive&&__g.player.downT>0),'ゲストにも行動不能を表示');
    await g.keyboard.down('f');await frames([g],1);await g.keyboard.up('f');
    ok(await g.evaluate(()=>__g.player.downT>0),'F押下だけでゲスト側は大破を確定しない');
    await sleep(40);await frames(r.pages,8);
    const state=await r.host.evaluate(()=>{
      const p=CBOnlineGame.state.peers.values().next().value,u=__g.units.find(u=>u.entityId===p.unitId);
      return {down:u.downT,respawn:u.respawnT,wrecks:__wreckCalls,loss:__downCore-__g.cores[__downTeam].hp,deaths:u.sc.deaths,oldDeaths:__downDeaths,ack:p.appliedActionSeq};
    });
    ok(state.down===0&&state.respawn>0&&state.wrecks===1,'Fでホストが1回だけ大破し、再出撃待ちへ進む');
    ok(state.loss>0&&state.deaths===state.oldDeaths&&state.ack>0,'既存の大破コア消費・撃破数維持・操作ACK');
    await sleep(40);await frames([g],3);
    ok(await g.evaluate(()=>__g.player.downT===0&&!__g.player.alive&&__g.player.respawnT>0),'ゲストへ大破と再出撃待ちを同期');
    await frames(r.pages,110);
    ok(await r.host.evaluate(()=>{const p=CBOnlineGame.state.peers.values().next().value,u=__g.units.find(u=>u.entityId===p.unitId);return u.alive&&u.lifeId>__downLife&&__wreckCalls===1;}),'既存の待ち時間後に再出撃し、Fを再実行しない');
  }finally{await r?.close().catch(()=>{});await h.close();}
},{page:false});
