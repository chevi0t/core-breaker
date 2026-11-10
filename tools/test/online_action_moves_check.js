// #226：実ブラウザ2台・既存オンライン入力経路。固定コマ送りで性能試験ではない。
// node tools/test/online_action_moves_check.js dbg [出力先] [--mock-transport]
const {check}=require('./lib');
const {harness,room,frames,input,neutral,sleep,TRANSPORT_MODE}=require('./online_test_helpers');
check('オンラインCアクション',async({browser,dir,ok,errors})=>{
 const h=await harness(dir);let r;
 try{
  for(const actionId of ['tackle','kick']){
   r=await room(browser,h,errors,{guests:1,teamSize:2,beforeStart:async(host,[guest])=>{
    await guest.evaluate(id=>CBOnlineGame.setEquipment({...CBOnlineGame.state.equipment,actionId:id}),actionId);
    await sleep(100);
   }});
   const guest=r.guests[0];await input(guest,neutral);await input(r.host,neutral);
   await frames(r.pages,5);
   const fixture=await r.host.evaluate(()=>{
    const g=__g,u=g.units.find(u=>u.controller==='remoteHuman'),target=g.player;
    g.obstacles.length=0;g.obstacles.push({minX:-150,maxX:150,minZ:-150,maxZ:150,top:200});g.waters.length=0;
    for(const other of g.units)if(other!==u&&other!==target){other.controller='remoteHuman';other.controlInput={keys:{},pressed:{}};other.pos.set(120,200,120);}
    for(const v of [u,target]){
     g.resetLifeState(v);Object.assign(v,{alive:true,hp:v.maxHp,invulT:0,boost:v.maxBoost,overheat:false,onGround:true,yaw:0,pitch:0,switchT:0,weapon:'main'});
     v.vel.set(0,0,0);
    }
    u.pos.set(0,200,20);target.pos.set(0,200,u.actionId==='tackle'?16:18);
    for(const v of [u,target]){v.group.position.copy(v.pos);g.weaponLook(v,0);}g.scene.updateMatrixWorld(true);
    window.__actionActor=u;window.__actionTarget=target;
    return {id:u.entityId,actionId:u.actionId,targetId:target.entityId,hp:target.hp};
   });
   ok(fixture.actionId===actionId,actionId+'：選択装備がゲストからホストへ届く');
   await frames(r.pages,5);await sleep(60);await frames([guest],2);
   ok(await guest.evaluate(id=>__g.player.actionId===id,actionId),actionId+'：自機の選択を写真にも保持');
   ok(await guest.evaluate(()=>{
    const p=__g.player,hp=__g.units.map(u=>u.hp),boost=p.boost;
    return !__g.actionMoveStart(p)&&!p.actionMove&&p.boost===boost&&__g.units.every((u,i)=>u.hp===hp[i]);
   }),actionId+'：ゲストが直接呼んでも発動・消費・ダメージを確定しない');
   // ホストを止めたままC押下を送る。ゲスト側に確定結果は生まれない。
   await input(guest,{...neutral,keys:{KeyC:true},pressed:{KeyC:true},yaw:0,pitch:0});await frames([guest],1,1000/60);
   await input(guest,{...neutral,keys:{KeyC:true},yaw:0,pitch:0});
   ok(await guest.evaluate(()=>!__g.player.actionMove&&__g.player.actionCd===0),actionId+'：C入力の先読みでは技を開始しない');
   await sleep(50);
   let started=false;
   for(let i=0;i<20;i++){
    await frames(r.pages,1,1000/60);await sleep(15);
    started=await r.host.evaluate(()=>!!__actionActor.actionMove);
    if(started)break;
   }
   ok(started,actionId+'：C入力をホストの固定stepで発動');
   ok(await r.host.evaluate(()=>{
    const g=__g,u=__actionActor,sl=u.slots.main,ammo=sl.ammo;
    g.weaponsTick(u,.02,true,g.targetPoint(__actionTarget),0,false);
    return sl.ammo===ammo&&u.actionCd>0;
   }),actionId+'：動作中はホストが射撃を抑止');
   await sleep(80);await frames([guest],3,1000/60);
   let shown=await guest.evaluate(id=>__g.player.actionMove?.id===id&&__g.player.actionCd>0,actionId);
   // 30Hz写真の境界を一度だけ進め、技が短くても姿勢写真を得る。
   if(!shown){await frames(r.pages,1,1000/60);await sleep(80);await frames([guest],2,1000/60);shown=await guest.evaluate(id=>__g.player.actionMove?.id===id&&__g.player.actionCd>0,actionId);}
   ok(shown,actionId+'：ゲストへ動作姿勢と再使用時間を同期');
   await input(guest,neutral);
   await frames(r.pages,35,1000/60);await sleep(80);await frames([guest],3,1000/60);
   const result=await r.host.evaluate(()=>({hp:__actionTarget.hp,cd:__actionActor.actionCd,move:__actionActor.actionMove,recover:__actionActor.actionRecoverT,pos:__actionActor.pos.toArray(),target:__actionTarget.pos.toArray(),stun:__actionTarget.stun,yaw:__actionActor.yaw}));
   console.log(actionId+' 結果',JSON.stringify(result));
   ok(result.hp<fixture.hp&&!result.move,actionId+'：ホストだけが命中を判定して動作終了');
   ok(await guest.evaluate(([id,hp])=>__g.units.find(u=>u.entityId===id)?.hp===hp,[fixture.targetId,result.hp]),actionId+'：ホストのダメージ結果をゲストへ同期');
   await r.close();r=null;
  }
  console.log('通信方式：'+TRANSPORT_MODE);
 }finally{await r?.close().catch(()=>{});await h.close();}
},{page:false});
