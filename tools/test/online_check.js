// node tools/test/online_check.js [dbg] [出力先]
// ローカル PeerServer + 実 WebRTC。機能試験はコマ送りであり性能値には使わない。
const fs=require('node:fs'),path=require('node:path');
const connectionsOnly=process.argv.includes('--connections-only');
const {check}=require('./lib');
const {readyAll,TRANSPORT_MODE,harness,pageFor,frames,room,identity,input,neutral,summary,sleep}=require('./online_test_helpers');
check('ブラウザホスト対戦',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir);let active;
  const results={mode:TRANSPORT_MODE+'・固定コマ送り・描画省略。性能測定ではない',matches:[]};
  try{
    console.log('段階: 版不一致拒否');
    // 実際の版表示を変えた別ブラウザをつなぎ、ハンドシェイクで拒否されること。
    { const host=await pageFor(browser,h,errors),bad=await pageFor(browser,h,errors,{version:'Ver不一致試験'});
    const rid=await host.evaluate(o=>CBOnlineGame.create(o),{peerOptions:h.peerOptions});
    const reject=await bad.evaluate(async([id,o])=>{try{await CBOnlineGame.join(id,o);return {accepted:true};}catch(e){return {accepted:false,reason:e.message};}},[rid,{peerOptions:h.peerOptions}]);
    console.log('版不一致接続結果',JSON.stringify(reject));
    ok(!reject.accepted&&/版が違います/.test(reject.reason),'版違いを理由付きで拒否');
    await bad.close();await host.evaluate(()=>CBOnlineGame.leave());await host.close(); }
    console.log('段階: 準備完了が3.5秒ずれたゲストの開始');
    {
      const host=await pageFor(browser,h,errors),early=await pageFor(browser,h,errors),slow=await pageFor(browser,h,errors),pages=[host,early,slow];
      active={pages,close:async()=>{for(const p of pages)if(!p.isClosed()){await p.evaluate(()=>CBOnlineGame.leave('準備差の試験終了')).catch(()=>{});await p.close();}}};
      const roomId=await host.evaluate(o=>CBOnlineGame.create(o),{peerOptions:h.peerOptions});
      for(const g of [early,slow])await g.evaluate(([id,o])=>CBOnlineGame.join(id,o),[roomId,{peerOptions:h.peerOptions}]);
      const earlyPeer=await early.evaluate(()=>CBOnlineGame.state.transport.peer.id);
      await slow.evaluate(()=>{
        const t=CBOnlineGame.state.transport,send=t.send.bind(t);
        window.__readyGate={pending:null,sentAt:null};
        t.send=(type,payload,peerId)=>{
          if(type==='ready'){__readyGate.pending=()=>{__readyGate.sentAt=performance.now();return send(type,payload,peerId);};return true;}
          return send(type,payload,peerId);
        };
      });
      await readyAll(pages,host);
      await host.evaluate(()=>CBOnlineGame.start({teamSize:5}));
      const waitingAt=Date.now();let earlyReady=false,slowWaiting=false;
      while(Date.now()-waitingAt<10000){
        await frames(pages,1);
        earlyReady=await host.evaluate(id=>!!CBOnlineGame.state.peers.get(id)?.ready,earlyPeer);
        slowWaiting=await slow.evaluate(()=>!!window.__readyGate?.pending);
        if(earlyReady&&slowWaiting)break;
        await sleep(20);
      }
      ok(earlyReady&&slowWaiting,'先行ゲストのready受信と後続ゲストの準備完了を確認');
      ok(await host.evaluate(()=>CBOnlineGame.state.phase==='preparing'&&!__g.running),'全員のreadyまではホストが試合を進めない');
      // 先行ゲストのreadyを確認した後に3.5秒待つため、元の3秒入力期限を確実に超える。
      const delayedAt=Date.now();
      await slow.evaluate(()=>{setTimeout(()=>__readyGate.pending(),3500);});
      while(Date.now()-delayedAt<15000){
        await frames(pages,1);await sleep(20);
        if(await host.evaluate(()=>CBOnlineGame.state.phase==='playing'))break;
      }
      const waitedMs=Date.now()-delayedAt;
      ok(waitedMs>=3500,'後続ゲストのready送信を3.5秒遅延');
      await input(early,{...neutral,keys:{KeyW:true},yaw:0,pitch:0});
      await input(slow,{...neutral,keys:{KeyW:true},yaw:0,pitch:0});
      await frames(pages,20);
      const first=await host.evaluate(()=>[...CBOnlineGame.state.peers.values()].map(p=>({id:p.id,receivedSeq:p.receivedSeq,appliedSeq:p.appliedSeq})));
      await frames(pages,40);
      const after=await host.evaluate(()=>({phase:CBOnlineGame.state.phase,connected:CBOnlineGame.state.transport.metrics().connectedPeers,
        peers:[...CBOnlineGame.state.peers.values()].map(p=>({id:p.id,receivedSeq:p.receivedSeq,appliedSeq:p.appliedSeq,controller:__g.units.find(u=>u.entityId===p.unitId)?.controller})),disconnected:CBOnlineGame.metrics().disconnected}));
      ok(after.phase==='playing'&&after.connected===2&&after.peers.length===2&&after.peers.every(p=>p.controller==='remoteHuman'),'準備が遅れても開始直後に先行ゲストをBotへ替えず両接続を維持');
      for(const g of [early,slow])ok(await g.evaluate(()=>CBOnlineGame.state.phase==='playing'&&__g.running),'準備差のあるゲストもplayingに到達');
      ok(after.peers.every(p=>{const old=first.find(x=>x.id===p.id);return old&&p.receivedSeq>old.receivedSeq&&p.appliedSeq>old.appliedSeq;}),'開始後に両ゲストの入力受信番号・適用番号が進む');
      results.preparationSkew={readyDelayMs:3500,observedWaitMs:waitedMs,before:first,after};
      await active.close();active=null;
    }
    if(!connectionsOnly){
    for(const guests of [1,3]){
      console.log(`段階: ${guests+1}人の試合`);
      active=await room(browser,h,errors,{guests});const {host,guests:gs,pages}=active;
      await frames(pages,5);
      const init=await summary(host);
      ok(init.units.length===10&&init.units.filter(u=>u.team==='B').length===5,'人間'+(guests+1)+'人でも10機・5対5');
      ok(init.units.filter(u=>u.controller==='remoteHuman').length===guests,'遠隔人間の操作権を割り当て');
      for(const g of gs)ok(await g.evaluate(()=>!__g.isSimulationAuthority()),'ゲストに試合計算の権威がない');
      console.log('段階: 遠隔移動');
      const g=gs[0],before=await identity(g);
      await input(g,{...neutral,keys:{KeyW:true},yaw:0,pitch:0});
      await frames(pages,60);await input(g,neutral);await frames(pages,5);
      const after=await identity(g);
      ok(Math.hypot(after.pos[0]-before.pos[0],after.pos[2]-before.pos[2])>.1,'ゲスト入力でホスト確定の自機が移動');
      console.log('段階: 遠隔主武器');
      // 次の射撃確認は標的配置を試験用に変更する。性能・自然対戦の評価には混ぜない。
      const fixture=await host.evaluate(id=>{
        const g=__g,u=g.units.find(u=>(u.entityId||u.netId)===id)||g.units.find(u=>u.controller==='remoteHuman');
        window.__testBotUpdate=window.botUpdate;window.botUpdate=()=>{};
        const target=g.units.find(x=>x.team!==u.team);u.pos.set(0,g.terrainH(0,170),170);target.pos.set(0,g.terrainH(0,185),185);
        u.vel.set(0,0,0);target.vel.set(0,0,0);u.invulT=target.invulT=0;u.repairing=target.repairing=false;u.yaw=Math.PI;u.pitch=0;u.switchT=0;
        for(const x of [u,target]){x.group.position.copy(x.pos);x.group.rotation.y=x.yaw;g.weaponLook(x,0);}
        g.scene.updateMatrixWorld(true);
        return {aim:g.targetPoint(target).toArray(),hp:target.hp,targetId:target.entityId||target.netId,weapon:u.slots.main.w.key};
      },before.id);
      await frames(pages,5);
      const ammo0=await g.evaluate(()=>__g.player.slots.main.ammo);
      await g.evaluate(()=>CBOnlineGame.requestWeapon('main'));
      await input(g,{...neutral,yaw:Math.PI,pitch:0,aimPoint:fixture.aim,trigger:true});
      await frames(pages,40);await input(g,neutral);await frames(pages,5);
      const ammo1=await g.evaluate(()=>__g.player.slots.main.ammo);
      ok(ammo1<ammo0,'遠隔射撃の残弾をホストで消費し表示');
      const hp=await host.evaluate(id=>(__g.units.find(u=>(u.entityId||u.netId)===id)||__g.units.find(u=>u.team!==__g.units.find(x=>x.controller==='remoteHuman').team)).hp,fixture.targetId);
      if(!(hp<fixture.hp))console.log('射線診断',await host.evaluate(id=>{const g=__g,u=g.units.find(u=>u.controller==='remoteHuman'),t=g.units.find(u=>u.entityId===id),from=g.muzzle(u),aim=g.targetPoint(t),hit=g.castFrom(from,aim.clone().sub(from).normalize(),u,100);return {pos:u.pos.toArray(),target:t.pos.toArray(),from:from.toArray(),aim:aim.toArray(),hit:hit&&{kind:hit.ref?.kind,team:hit.ref?.team,dist:hit.dist},hp:t.hp,alive:t.alive,weapon:u.weapon,aimPos:u.aimPos?.toArray(),input:u.controlInput};},fixture.targetId));
      ok(hp<fixture.hp,'遠隔主武器がホストの標的に命中');
      // 施設状態はゲストが独自に進めない。ホストを止めてゲストだけコマ送り。
      await sleep(150);await frames([g],2);const frozen=await summary(g);await frames([g],40);const still=await summary(g);
      ok(still.time===frozen.time&&JSON.stringify(still.cores)===JSON.stringify(frozen.cores),'ホスト更新なしでゲストの時間・コアを進めない');
      await host.evaluate(()=>{window.botUpdate=window.__testBotUpdate;delete window.__testBotUpdate;});
      console.log('段階: 300秒完走');
      // 人間の入力は中立のまま、Bot が対戦。試合時間そのものは短縮しない。
      for(let n=0;n<6400;n+=10){await frames(pages,10);if(n%400===0)console.log(`${guests+1}人: ${Math.round(300-(await summary(host)).time)}秒`);if((await summary(host)).finished>0)break;}
      await frames(pages,8);
      const end=await summary(host);ok(end.phase==='lobby'&&end.finished>0,'人間'+(guests+1)+'人の試合が勝敗まで完走');
      for(const guest of gs){const e=await summary(guest);ok(e.phase==='lobby'&&e.finished>0&&JSON.stringify(e.cores)===JSON.stringify(end.cores),'ゲストの最終コア・終了状態が一致');}
      results.matches.push({humans:guests+1,host:end,guests:await Promise.all(gs.map(summary))});
      await active.close();active=null;
    }
    console.log('段階: 遠隔ロケット');
    // ロケットは重火力の正規の副武器として接続し直して確認。
    active=await room(browser,h,errors,{guests:1,guestClasses:['heavy']});
    {
      const {host,guests:[guest],pages}=active;
      const target=await host.evaluate(()=>{
        const g=__g,u=g.units.find(u=>u.controller==='remoteHuman');
        window.__testBotUpdate=window.botUpdate;window.botUpdate=()=>{};
        u.pos.set(0,g.terrainH(0,170),170);u.vel.set(0,0,0);u.invulT=0;u.repairing=false;u.switchT=0;u.yaw=0;
        g.selectWeapon(u,'sub');u.switchT=0;g.weaponLook(u,0);g.scene.updateMatrixWorld(true);
        return {key:u.slots.sub.w.key,ammo:u.slots.sub.ammo,aim:[0,g.terrainH(0,130)+1,130]};
      });
      ok(target.key==='rocket','重火力の初期ロケットを装備');
      await guest.evaluate(()=>CBOnlineGame.requestWeapon('sub'));
      await input(guest,{...neutral,yaw:0,pitch:0,aimPoint:target.aim,trigger:true});
      let seen=false;
      for(let n=0;n<70;n++){await frames(pages,1);if(await host.evaluate(()=>__g.shells.length>0))seen=true;}
      await input(guest,neutral);await frames(pages,5);
      ok(seen,'ゲストのロケット入力でホストに飛翔弾を生成');
      ok(await guest.evaluate(a=>__g.player.slots.sub.ammo<a,target.ammo),'ロケットの残弾をゲストへ同期');
      await host.evaluate(()=>{window.botUpdate=window.__testBotUpdate;delete window.__testBotUpdate;});
    }
    await active.close();active=null;
    }
    active=await room(browser,h,errors,{guests:1});
    console.log('段階: 途中参加・切断');
    const {host,guests:[guest],pages,roomId}=active;
    const late=await pageFor(browser,h,errors);
    const lateResult=await late.evaluate(async([id,o])=>{try{await CBOnlineGame.join(id,o);return '';}catch(e){return e.message;}},[roomId,{peerOptions:h.peerOptions}]);
    ok(/試合開始後の途中参加/.test(lateResult),'試合開始後の新規参加を理由付きで拒否');await late.close();
    const before=await host.evaluate(()=>{const u=__g.units.find(u=>u.controller==='remoteHuman');u.hp=4321;u.actionHeld=true;u.actionBlockBoost=true;u.controlTarget=__g.units.find(x=>x.team!==u.team);return {id:u.entityId||u.netId,hp:u.hp,lifeId:u.lifeId};});
    await guest.evaluate(()=>CBOnlineGame.leave('切断試験'));await sleep(100);
    await host.evaluate(()=>{CBOnlineGame.beforeFrame(0,performance.now());CBOnlineGame.afterFrame(0,performance.now());});
    const takeover=await host.evaluate(id=>{const u=__g.units.find(u=>(u.entityId||u.netId)===id);return {controller:u.controller,hp:u.hp,lifeId:u.lifeId,count:__g.units.length,actionHeld:u.actionHeld,actionBlockBoost:u.actionBlockBoost,target:!!u.controlTarget};},before.id);
    ok(takeover.controller==='bot'&&takeover.hp===4321&&takeover.lifeId===before.lifeId&&takeover.count===10&&!takeover.actionHeld&&!takeover.actionBlockBoost&&!takeover.target,'切断機を回復・再出撃させずBotへ引継ぎ');
    await active.close();active=null;
    console.log('段階: 通信を保ったまま入力だけ途絶');
    active=await room(browser,h,errors,{guests:2});
    {
      const {host,guests:[silent,other],pages}=active;
      await frames(pages,5);await sleep(100);
      const id=(await identity(silent)).id;
      const before=await host.evaluate(id=>{
        const u=__g.units.find(x=>x.entityId===id);u.hp=4321;u.actionHeld=true;u.actionBlockBoost=true;u.controlTarget=__g.units.find(x=>x.team!==u.team);
        return {hp:u.hp,lifeId:u.lifeId,pos:u.pos.toArray()};
      },id);
      // DataConnection・ping・snapshot は維持し、非再送の移動とcontrolの一度きり操作を両方止める。
      await silent.evaluate(base=>{
        const t=CBOnlineGame.state.transport,send=t.send.bind(t);window.__silencedInputs={inputBatch:0,inputActions:0};
        t.send=(type,...args)=>{if(Object.hasOwn(__silencedInputs,type)){__silencedInputs[type]++;return true;}return send(type,...args);};
        // ack済みの中立状態はcontrolを再送しない。遮断後に射撃開始を明示し、両線の遮断を実証する。
        // この操作は上のwrapperが捨てるため、hostのHP/物理状態は変わらない。
        CBOnlineGame.testInput({...base,trigger:true});
      },neutral);
      const until=Date.now()+3800;
      // ホストの物理・Bot思考は進めず、通信の前後処理だけ回す。
      // u.frozen は本体に存在しないため、位置保持をそのフラグに頼らない。
      while(Date.now()<until){
        await frames([silent,other],1);
        await host.evaluate(()=>{CBOnlineGame.beforeFrame(0,performance.now());CBOnlineGame.afterFrame(0,performance.now());});
        await sleep(40);
      }
      await host.waitForFunction(()=>CBOnlineGame.state.transport.metrics().connectedPeers===1,{}, {polling:50,timeout:2000});
      const lost=await silent.evaluate(()=>({phase:CBOnlineGame.state.phase,running:__g.running,reason:document.getElementById('ovText').textContent,peers:CBOnlineGame.state.transport.metrics().connectedPeers}));
      ok(lost.phase==='ended'&&!lost.running&&/入力が3秒途絶え/.test(lost.reason)&&lost.peers===0,'通信が生きた入力途絶でも理由付き終了し接続を閉じる');
      const after=await host.evaluate(id=>{const u=__g.units.find(x=>x.entityId===id);return {controller:u.controller,hp:u.hp,lifeId:u.lifeId,pos:u.pos.toArray(),count:__g.units.length,actionHeld:u.actionHeld,actionBlockBoost:u.actionBlockBoost,target:!!u.controlTarget};},id);
      ok(after.controller==='bot'&&after.hp===before.hp&&after.lifeId===before.lifeId&&JSON.stringify(after.pos)===JSON.stringify(before.pos)&&after.count===10&&!after.actionHeld&&!after.actionBlockBoost&&!after.target,'入力途絶機も状態を保ってBotへ引継ぐ');
      ok(await other.evaluate(()=>CBOnlineGame.state.phase==='playing'&&CBOnlineGame.state.transport.metrics().connectedPeers===1),'入力途絶したゲスト以外の対戦接続は継続');
      const blockedInputs=await silent.evaluate(()=>__silencedInputs);
      ok(blockedInputs.inputBatch>0&&blockedInputs.inputActions>0,'入力途絶fixtureが最新5コマbatchとcontrol操作の両方を実際に止めた: '+JSON.stringify(blockedInputs));
      results.inputTimeout={guest:lost,before,after,blockedInputs};
    }
    await active.close();active=null;
    active=await room(browser,h,errors,{guests:1});
    await active.host.evaluate(()=>CBOnlineGame.leave('ホスト終了試験'));await sleep(150);await frames(active.guests,5);
    ok(await active.guests[0].evaluate(()=>CBOnlineGame.state.phase==='ended'&&!__g.running),'ホスト切断でゲストも中断');
    fs.writeFileSync(path.join(out,'online-check.json'),JSON.stringify(results,null,2));
  }finally{if(active)await active.close();await h.close();}
},{page:false});
