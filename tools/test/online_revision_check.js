// #214 追加回帰。node tools/test/online_revision_check.js dbg /tmp/online-revision [--mock-transport]
// 通信代替は明示フラグ時だけ。人工状態変更は同期境界の試験であり自然対戦ではない。
const fs=require('node:fs'),path=require('node:path');
const {check}=require('./lib');
const {TRANSPORT_MODE,harness,pageFor,frames,room,sleep,stats}=require('./online_test_helpers');
async function pumpNetwork(host,guests,n=1){for(let i=0;i<n;i++){await frames(guests,1);await host.evaluate(()=>{CBOnlineGame.beforeFrame(0,performance.now());CBOnlineGame.afterFrame(0,performance.now());});await sleep(60);}}
async function captureWire(page){await page.evaluate(()=>{
  const t=CBOnlineGame.state.transport;window.__wire=[];if(t.__wireCaptureInstalled)return;t.__wireCaptureInstalled=true;const write=t._write.bind(t);
  t._write=(link,item)=>{const sent=write(link,item);if(sent)__wire.push({type:item.type,bytes:item.bytes,at:performance.now()});return sent;};
});}
async function fakeLoops(page){return page.evaluate(()=>{
  // 実際の音声を鳴らさず、停止API呼出しと音プールの後始末だけを検証する。
  window.__loopProbe={stopped:[],ended:[]};
  const gain={value:.3,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){},setTargetAtTime(){}};
  audio={currentTime:0,out:{gain},effects:{gain},music:{gain},world:{gain}};
  const add=(name,bucket)=>{
    const pool=soundVoices[bucket],node={loop:true,stop(){__loopProbe.stopped.push(name);this.onended?.();},disconnect(){}};
    const v={name,node,g:{gain,disconnect(){}},ended:false,stopping:false,priority:1};
    v.end=()=>{v.ended=true;pool.delete(v);__loopProbe.ended.push(name);};node.onended=v.end;pool.add(v);return v;
  };
  const moving=add('boostLoop','local');__g.player.boostVoice=moving;
  add('boostLoop','world');
  bgmNode={node:{loop:true,stop(){__loopProbe.stopped.push('BGM');},disconnect(){}},g:{gain,disconnect(){}}};
  return {expected:3};
});}
async function audioResult(page){return page.evaluate(()=>({stopped:window.__loopProbe?.stopped||[],active:[...soundVoices.local,...soundVoices.world,...soundVoices.ui].filter(v=>v.node.loop&&!v.ended&&!v.stopping).length,bgm:!!bgmNode,boost:!!__g.player?.boostVoice}));}
async function uiRoom(browser,h,errors,ok){
  const host=await pageFor(browser,h,errors,{autoApprove:false}),guest=await pageFor(browser,h,errors,{autoApprove:false}),pages=[host,guest];
  for(const p of pages)await p.evaluate(peerOptions=>{
    const create=CBOnlineGame.create,join=CBOnlineGame.join;
    CBOnlineGame.create=o=>create({...o,peerOptions});CBOnlineGame.join=(id,o)=>join(id,{...o,peerOptions});
  },h.peerOptions);
  await host.locator('#menuOnline').click();await host.locator('#onlineCreate').click();
  await host.waitForFunction(()=>CBOnlineGame.state.roomId&&CBOnlineGame.state.phase==='lobby',{},{polling:20});
  const id=await host.evaluate(()=>CBOnlineGame.state.roomId);
  await captureWire(host);
  await guest.locator('#menuOnline').click();await guest.locator('#onlineName').fill('<b>参加申請</b>');
  const request=async()=>{
    await guest.locator('#onlineRoom').fill(id);await guest.locator('#onlineJoin').click();
    await host.waitForFunction(()=>CBOnlineGame.state.requests.size===1,{},{polling:20});
    return host.evaluate(()=>[...CBOnlineGame.state.requests.keys()][0]);
  };
  let peerId=await request();
  ok((await host.locator('#onlineRequests').textContent()).includes('<b>参加申請</b>')&&await host.locator('#onlineRequests b').count()===0,'申告名をHTMLではなく未認証のテキストとして表示');
  const blocked=await host.evaluate(id=>{
    const t=CBOnlineGame.state.transport,link=t.links.get(id),types=['snapshot','snapshotBase','prepare','match','events'];
    window.__wire=[];const sent=types.map(type=>t.send(type,{test:true},id));types.forEach(type=>t.broadcast(type,{test:true}));
    return {sent,ready:link.ready,approved:link.approved,peers:CBOnlineGame.state.peers.size};
  },peerId);
  await sleep(180);
  const leaked=await host.evaluate(()=>__wire.filter(x=>['snapshot','snapshotBase','prepare','match','events'].includes(x.type)));
  ok(blocked.sent.every(v=>!v)&&!blocked.ready&&!blocked.approved&&blocked.peers===0&&leaked.length===0,'未承認者にはsnapshot・基準・準備・開始・eventを送らない');
  await host.locator('[data-action="rejectGuest"]').click();
  await host.waitForFunction(()=>CBOnlineGame.state.requests.size===0,{},{polling:20});
  await guest.waitForFunction(()=>!document.getElementById('onlineJoin').disabled,{},{polling:20});
  ok((await guest.locator('#onlineStatus').textContent()).includes('拒否'),'拒否理由を申請者へ表示');
  peerId=await request();await host.locator('[data-action="approveGuest"]').click();
  await host.waitForFunction(()=>[...CBOnlineGame.state.peers.values()].some(p=>p.preferred),{},{polling:20});
  ok(await host.locator('[data-action="kickGuest"]').count()===1,'許可後は参加者とロビー退出ボタンを表示');
  await host.locator('[data-action="kickGuest"]').click();
  await host.waitForFunction(()=>CBOnlineGame.state.peers.size===0,{},{polling:20});
  await guest.locator('#onlineReturn').waitFor({state:'visible'});
  ok(await guest.locator('#onlinePanel').evaluate(e=>e.hidden),'ロビー退出で中断理由をオンラインパネルに隠さない');
  await guest.locator('#onlineReturn').click();
  ok(!await guest.locator('#onlinePanel').evaluate(e=>e.hidden)&&await guest.locator('#onlineJoin').isEnabled(),'ロビー退出後の戻るボタンから再申請できる');
  await request();await host.locator('[data-action="approveGuest"]').click();
  await host.waitForFunction(()=>[...CBOnlineGame.state.peers.values()].length===1&&[...CBOnlineGame.state.peers.values()].every(p=>p.preferred),{},{polling:20});
  return {host,guest,pages,close:async()=>{for(const p of pages)if(!p.isClosed()){await p.evaluate(()=>CBOnlineGame.leave('試験終了')).catch(()=>{});await p.close();}}};
}
check('オンライン開始・終了・圧縮同期',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir);let active;
  const report={mode:TRANSPORT_MODE,method:'固定コマ送り/描画省略の機能回帰。wireBytesはアプリから送ったJSONのUTF8量で、回線ヘッダー・再送を含まない。実音・人間の操作感は未確認。',sizes:[],bootstrap:[]};
  try{
    console.log('追加回帰: UI操作から予約カウントダウン');
    active=await uiRoom(browser,h,errors,ok);
    const {host,guest,pages}=active;
    await host.locator('#onlineStart').click();
    const seen=[new Set(),new Set()],first=new Map();let started=false;
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){
      await frames(pages,1);
      const sample=await Promise.all(pages.map(p=>p.evaluate(()=>({phase:CBOnlineGame.state.phase,n:CBOnlineGame.state.countdownNumber,running:__g.running,time:__g.timeLeft,pos:__g.player?.pos.toArray(),panel:document.getElementById('onlinePanel').hidden}))));
      for(let i=0;i<sample.length;i++){
        const s=sample[i];if(s.phase==='countdown'){
          if([1,2,3].includes(s.n))seen[i].add(s.n);
          if(!first.has(i))first.set(i,s);
          if(s.running||s.time!==first.get(i).time||JSON.stringify(s.pos)!==JSON.stringify(first.get(i).pos))throw Error('カウントダウン中に試合を進めました');
          if(!s.panel)throw Error('カウントダウン中もオンラインパネルが画面を覆っています');
        }
      }
      if(sample.every(s=>s.phase==='playing')){started=true;break;}
      await sleep(20);
    }
    ok(started,'ホストとゲストが予約カウントダウン後にplayingへ進む');
    ok(seen.every(s=>[3,2,1].every(n=>s.has(n))),'両画面で3・2・1を表示');
    ok(first.size===2,'カウントダウン中は機体・試合時計を進めずパネルも閉じる');
    const timing=await Promise.all(pages.map(p=>p.evaluate(()=>({startAtHost:CBOnlineGame.state.startAtHost,startAtLocal:CBOnlineGame.state.startAtLocal,actualStartAt:CBOnlineGame.state.actualStartAt,clock:CBOnlineGame.state.transport.clock?.()}))));
    report.countdown={seen:seen.map(s=>[...s]),timing,hostEquivalentStartDifferenceMs:timing[1].actualStartAt+(timing[1].clock?.offsetMs||0)-timing[0].actualStartAt};
    ok(timing.every(t=>t.actualStartAt>=t.startAtLocal),'予約時刻以前には開始しない');
    report.bootstrap.push(await host.evaluate(()=>({units:__g.units.length,prepare:__wire.filter(x=>x.type==='prepare'),bases:__wire.filter(x=>x.type==='snapshotBase')})));
    await captureWire(host);
    await frames(pages,100);await sleep(100);
    report.sizes.push(await host.evaluate(()=>({units:__g.units.length,fullSnapshotBytes:new TextEncoder().encode(JSON.stringify(CBOnlineGame.snapshot())).length,wire:__wire,transport:CBOnlineGame.state.transport.metrics()})));

    console.log('追加回帰: snapshot間引きと装備・再出撃・施設');
    await guest.evaluate(()=>{
      const t=CBOnlineGame.state.transport,receive=t.options.onMessage;
      window.__drop={snapshots:0,dropped:0,stale:null};
      t.options.onMessage=(type,data,id)=>{if(type==='snapshot'){if(!__drop.stale)__drop.stale={type,data:JSON.parse(JSON.stringify(data)),id};if(__drop.snapshots-->0){__drop.dropped++;return;}}return receive(type,data,id);};
      window.__originalReceive=receive;
    });
    await pumpNetwork(host,[guest],3);
    await guest.evaluate(()=>{__drop.snapshots=4;});
    const expected=await host.evaluate(()=>{
      const u=__g.units.find(u=>u.controller==='remoteHuman');
      u.controlLoadout=Object.fromEntries(__g.SLOTS.map(k=>[k,__g.CLASSES.heavy[k]]));u.nextCls='heavy';__g.spawn(u);u.hp=4567;u.slots.sub.ammo=1;
      __g.cores.B.hp=7777;const pl=__g.plants[0];pl.owner='R';pl.gauge=.5;
      if(__g.turrets[0])__g.turrets[0].hp=123;
      return {id:u.entityId,cls:u.cls,lifeId:u.lifeId,hp:u.hp,ammo:u.slots.sub.ammo,core:7777,plant:pl.id,gauge:pl.gauge};
    });
    await pumpNetwork(host,[guest],18);
    const recovered=await guest.evaluate(id=>{const u=__g.units.find(u=>u.entityId===id);return {cls:u.cls,lifeId:u.lifeId,hp:u.hp,ammo:u.slots.sub.ammo,core:__g.cores.B.hp,plant:__g.plants[0].owner,gauge:__g.plants[0].gauge,turret:__g.turrets[0]?.hp,dropped:__drop.dropped};},expected.id);
    ok(recovered.dropped===4,'受信snapshotを4枚意図的に間引く');
    ok(recovered.cls===expected.cls&&recovered.lifeId===expected.lifeId&&recovered.hp===expected.hp&&recovered.ammo===expected.ammo,'間引き後に装備・再出撃・耐久・残弾が復旧');
    ok(recovered.core===7777&&recovered.plant==='R'&&recovered.gauge===expected.gauge&&recovered.turret===123,'間引き後にコア・プラント・施設の状態が復旧');
    await guest.evaluate(()=>{const s=__drop.stale;__originalReceive(s.type,s.data,s.id);});
    const staleHp=await guest.evaluate(id=>__g.units.find(u=>u.entityId===id).hp,expected.id);
    ok(staleHp===expected.hp,'古いsnapshot再投入で耐久を巻き戻さない');
    report.recovery={expected,recovered};
    console.log('追加回帰: 基準欠落からの復旧');
    await guest.evaluate(()=>{
      const t=CBOnlineGame.state.transport,receive=t.options.onMessage,send=t.send.bind(t);
      window.__baseDrop={dropped:0,resync:0};
      t.options.onMessage=(type,data,id)=>{if(type==='snapshotBase'&&!__baseDrop.dropped){__baseDrop.dropped++;return;}return receive(type,data,id);};
      t.send=(type,...a)=>{if(type==='snapshotResync')__baseDrop.resync++;return send(type,...a);};
    });
    // 基準は実時間10秒ごと。物理を止めたまま実送信を進め、基準1通を受信側で落とす。
    const recoveryDeadline=Date.now()+14000;
    while(Date.now()<recoveryDeadline){await pumpNetwork(host,[guest],1);if(await guest.evaluate(()=>__baseDrop.dropped&&__baseDrop.resync))break;}
    await pumpNetwork(host,[guest],8);
    const baselineRecovery=await guest.evaluate(id=>({probe:__baseDrop,frame:CBOnlineGame.state.lastSnapshot?.frame,hp:__g.units.find(u=>u.entityId===id).hp}),expected.id);
    ok(baselineRecovery.probe.dropped===1&&baselineRecovery.probe.resync>=1,'基準メッセージ欠落時は再送を要求');
    const hostFrame=await host.evaluate(()=>CBOnlineGame.state.frame);
    ok(baselineRecovery.hp===expected.hp&&hostFrame-baselineRecovery.frame<5,'基準再送後に最新snapshotへ復旧');
    report.baselineRecovery=baselineRecovery;

    console.log('追加回帰: 結果画面とループ音停止');
    // 通常復旧の要求制限時間を過ぎてから、最後のdeltaの直前に全基準を失わせる。
    await sleep(1100);
    await guest.evaluate(()=>{
      const proto=CBOnlineCodec.Decoder.prototype,decode=proto.decode;
      window.__finalRecovery={cleared:false,snapshots:0,bases:0,resync:0};
      proto.decode=function(delta){proto.decode=decode;this.bases.clear();__finalRecovery.cleared=true;return decode.call(this,delta);};
      const t=CBOnlineGame.state.transport,receive=t.options.onMessage,send=t.send.bind(t);
      t.options.onMessage=(type,data,id)=>{if(type==='snapshot')__finalRecovery.snapshots++;if(type==='snapshotBase')__finalRecovery.bases++;return receive(type,data,id);};
      t.send=(type,...args)=>{if(type==='snapshotResync')__finalRecovery.resync++;return send(type,...args);};
    });
    for(const p of pages)await fakeLoops(p);
    // finish後は追加snapshotもhost loopも送らない。基準再送だけで保留した最後のdeltaを復旧する。
    await host.evaluate(()=>{__g.timeLeft=0;__g.finish();CBOnlineGame.afterFrame(0,performance.now());});
    await guest.waitForFunction(()=>CBOnlineGame.state.phase==='ended',{},{timeout:6000,polling:20});
    const finalRecovery=await guest.evaluate(()=>__finalRecovery);report.finalRecovery=finalRecovery;
    ok(finalRecovery.cleared&&finalRecovery.snapshots===1&&finalRecovery.resync>=1&&finalRecovery.bases>=1,'最終snapshotの基準欠落も、追加snapshotなしの基準再送だけで試合結果へ復旧');
    await guest.evaluate(()=>{const s=__drop.stale;__originalReceive(s.type,s.data,s.id);});
    ok(await guest.evaluate(()=>CBOnlineGame.state.phase==='ended'&&!__g.running),'結果復旧後の古いsnapshotで試合を再開しない');
    for(const p of pages){
      ok(await p.evaluate(()=>CBOnlineGame.state.phase==='ended'&&!document.getElementById('overlay').hidden&&!!document.getElementById('ovTitle').textContent),'試合終了の結果画面が見える');
      ok(await p.evaluate(()=>document.getElementById('onlinePanel').hidden&&!document.getElementById('onlineReturn').hidden),'戻るボタンを押すまではオンラインパネルを閉じる');
      const a=await audioResult(p);ok(a.active===0&&!a.bgm&&!a.boost&&a.stopped.length>=3,'試合終了で移動音・周囲ループ音・BGMを停止');
      await p.locator('#ovTitle').click();ok(await p.locator('#onlinePanel').evaluate(e=>e.hidden),'結果内のクリックではパネルを開かない');
      await p.keyboard.press('Escape');ok(await p.locator('#onlinePanel').evaluate(e=>e.hidden),'結果中のEscapeではパネルを開かない');
    }
    await host.locator('#onlineReturn').click();
    ok(await host.evaluate(()=>!document.getElementById('onlinePanel').hidden&&CBOnlineGame.state.role==='offline'),'戻るボタンで旧部屋を退出してオンラインメニューへ戻る');
    await active.close();active=null;

    console.log('追加回帰: 20機のsnapshotサイズ');
    active=await room(browser,h,errors,{guests:1,teamSize:10,beforeStart:captureWire});
    report.bootstrap.push(await active.host.evaluate(()=>({units:__g.units.length,prepare:__wire.filter(x=>x.type==='prepare'),bases:__wire.filter(x=>x.type==='snapshotBase')})));
    for(const b of report.bootstrap)ok(b.prepare.length===1&&b.prepare[0].bytes<262144&&b.bases.length===0,'初期prepareは1通・上限内で静的基準を二重送信しない（'+b.units+'機）');
    await captureWire(active.host);await frames(active.pages,100);await sleep(100);
    report.sizes.push(await active.host.evaluate(()=>({units:__g.units.length,fullSnapshotBytes:new TextEncoder().encode(JSON.stringify(CBOnlineGame.snapshot())).length,wire:__wire,transport:CBOnlineGame.state.transport.metrics()})));
    for(const p of active.pages)await fakeLoops(p);
    await active.host.evaluate(()=>CBOnlineGame.leave('音停止付き退出試験'));await sleep(150);
    for(const p of active.pages){const a=await audioResult(p);ok(a.active===0&&!a.bgm&&a.stopped.length>=3,'ホスト退出時も両画面のループ音・BGMを停止');}
    for(const s of report.sizes){s.snapshotWireBytes=stats(s.wire.filter(x=>x.type==='snapshot').map(x=>x.bytes));s.totalWireBytes=s.wire.reduce((a,x)=>a+x.bytes,0);s.wireBytesByType=s.wire.reduce((o,x)=>(o[x.type]=(o[x.type]||0)+x.bytes,o),{});console.log('snapshotサイズ',JSON.stringify({units:s.units,full:s.fullSnapshotBytes,compact:s.snapshotWireBytes,wireBytesByType:s.wireBytesByType}));ok(s.snapshotWireBytes.count>0&&s.snapshotWireBytes.mean<s.fullSnapshotBytes,'compact snapshotが従来の完全状態より小さい（'+s.units+'機）');}
  }finally{if(active)await active.close();await h.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-revision.json'),JSON.stringify(report,null,2));}
},{page:false});
