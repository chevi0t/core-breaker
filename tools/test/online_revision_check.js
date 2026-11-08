// #214 追加回帰。node tools/test/online_revision_check.js dbg /tmp/online-revision [--mock-transport]
// [--bootstrap-only] [--team-size=5|10]：初期同期だけ。初期1回assertを維持し、playingのschema追補は別集計。
// 通信代替は明示フラグ時だけ。人工状態変更は同期境界の試験であり自然対戦ではない。
const fs=require('node:fs'),path=require('node:path');
const {check}=require('./lib');
const {isDeepStrictEqual}=require('node:util');
const {TRANSPORT_MODE,harness,pageFor,frames,room,sleep,stats,installWireObserver}=require('./online_test_helpers');
async function pumpNetwork(host,guests,n=1){for(let i=0;i<n;i++){await frames(guests,1);await host.evaluate(()=>{CBOnlineGame.beforeFrame(0,performance.now());CBOnlineGame.afterFrame(0,performance.now());});await sleep(60);}}
const bootstrapOnly=process.argv.includes('--bootstrap-only');
const teamSizeArg=process.argv.find(x=>x.startsWith('--team-size='));
const bootstrapTeamSizes=teamSizeArg?[Number(teamSizeArg.split('=')[1])]:[5,10];
if(bootstrapTeamSizes.some(x=>![5,10].includes(x)))throw Error('--team-size は5または10');
if(teamSizeArg&&!bootstrapOnly)throw Error('--team-size は --bootstrap-only と合わせて指定してください');
async function captureWire(page){await installWireObserver(page);await page.evaluate(()=>{
  const t=CBOnlineGame.state.transport;window.__wire=[];window.__wireMessages=[];window.__wireControlEvents=[];window.__wireCaptureStartedAt=performance.now();
  if(t.__wireCaptureInstalled)return;t.__wireCaptureInstalled=true;
  const bytes=x=>new TextEncoder().encode(JSON.stringify(x)).length,schemas=new Map(),seenBases=new Set();
  const receive=t.options.onMessage;
  t.options.onMessage=(type,data,id)=>{
    if(['ready','snapshotResync','preference'].includes(type))__wireControlEvents.push({type,at:performance.now(),phase:CBOnlineGame.state.phase,hostFrame:CBOnlineGame.state.frame,peerId:id});
    return receive(type,data,id);
  };
  window.__observeOnlineWire(w=>__wire.push({type:w.type,bytes:w.messageBytes,channel:w.channel,at:w.at,phase:CBOnlineGame.state.phase,hostFrame:CBOnlineGame.state.frame,peerId:w.peerId}),w=>{
    const {payload:data,type}=w.envelope;
    const m={type,channel:w.channel,bytes:w.messageBytes,logicalBytes:w.logicalMessageBytes,fragmentCount:w.fragmentCount,maxDatagramBytes:w.maxDatagramBytes,
      at:w.at,phase:CBOnlineGame.state.phase,hostFrame:CBOnlineGame.state.frame,peerId:w.peerId};
    if(type==='prepare')Object.assign(m,{hasSnapshotState:['baseline','delta','units'].some(k=>Object.hasOwn(data,k)),metadataKeys:Object.keys(data).sort()});
    if(type==='snapshotBase'){
      const parentSchema=schemas.get(data.parent),schema=data.s||parentSchema,seen=seenBases.has(data.id);
      const before=new Map((parentSchema||[]).map(([p,type])=>[JSON.stringify(p),type])),after=new Map((schema||[]).map(([p,type])=>[JSON.stringify(p),type]));
      const added=[...after].filter(([p])=>!before.has(p)),removed=[...before].filter(([p])=>!after.has(p));
      const changed=[...after].filter(([p,type])=>before.has(p)&&before.get(p)!==type).map(([p,type])=>({path:JSON.parse(p),before:before.get(p),after:type}));
      Object.assign(m,{baseId:data.id,parent:data.parent||null,schemaBytes:data.s?bytes(data.s):0,valuesBytes:data.d?bytes(data.d):0,patchBytes:data.p?bytes(data.p):0,
        schemaFields:schema?.length||0,baselineValueCount:data.d?.length||0,patchChangedFields:(data.p?.length||0)/2,
        observedReason:seen?'same-id-resend':data.parent?(data.s?'schema-change':'same-schema-refresh'):'initial-full',
        schemaChange:data.parent?{parentKnown:!!parentSchema,addedCount:added.length,removedCount:removed.length,typeChangedCount:changed.length,
          added:added.slice(0,250).map(([p,type])=>({path:JSON.parse(p),type})),removed:removed.slice(0,250).map(([p,type])=>({path:JSON.parse(p),type})),typeChanged:changed.slice(0,250),pathLimit:250}:null});
      if(schema)schemas.set(data.id,schema);seenBases.add(data.id);
    }
    if(type==='snapshot'){m.frame=data.frame;m.baseId=data.delta?.[1];}
    __wireMessages.push(m);
  });
});}
async function bootstrap(page,guests=[]){
  const result=await page.evaluate(()=>{
    const prepare=__wireMessages.filter(x=>x.type==='prepare'),bases=__wireMessages.filter(x=>x.type==='snapshotBase'),snapshots=__wireMessages.filter(x=>x.type==='snapshot');
    return {units:__g.units.length,captureStartedAt:__wireCaptureStartedAt,capturedAt:performance.now(),phase:CBOnlineGame.state.phase,hostFrame:CBOnlineGame.state.frame,
      prepare,bases,initialSnapshots:snapshots.filter(x=>x.frame===0),snapshots,controlEvents:__wireControlEvents,
      observerErrors:__wireObserverErrors,transport:CBOnlineGame.state.transport.metrics(),
      summary:{prepareCount:prepare.length,baseCount:bases.length,initialSnapshotCount:snapshots.filter(x=>x.frame===0).length,
        baseReasons:bases.map(b=>({id:b.baseId,parent:b.parent,phase:b.phase,hostFrame:b.hostFrame,reason:b.observedReason,logicalBytes:b.logicalBytes,wireBytes:b.bytes,
          schemaFields:b.schemaFields,schemaBytes:b.schemaBytes,patchBytes:b.patchBytes,added:b.schemaChange?.addedCount||0,removed:b.schemaChange?.removedCount||0,typeChanged:b.schemaChange?.typeChangedCount||0})),
        snapshotFrames:snapshots.map(x=>x.frame),resyncRequests:__wireControlEvents.filter(x=>x.type==='snapshotResync').length,
        baseWireBytes:bases.reduce((n,p)=>n+p.bytes,0),baseLogicalBytes:bases.reduce((n,p)=>n+p.logicalBytes,0)}};
  });
  result.guests=await Promise.all(guests.map(p=>p.evaluate(()=>({phase:CBOnlineGame.state.phase,lastFrame:CBOnlineGame.state.lastSnapshot?.frame,
    localUnitId:CBOnlineGame.state.localUnitId,units:__g.units.length,interpolation:CBOnlineGame.metrics().interpolation}))));
  return partitionBootstrap(result);
}
function partitionBootstrap(b){
  // helperはplayingに入った最初のhost frameまで回す。開始後のschema更新を初期送信と混ぜない。
  // phaseだけでなくhostFrameも照合し、分類不能な再送を黙って除外しない。
  const initial=m=>['preparing','countdown'].includes(m.phase)&&m.hostFrame===0;
  const playing=m=>m.phase==='playing'&&m.hostFrame>0;
  const allBases=b.bases,allSnapshots=b.snapshots;
  b.bootstrapScope='host phase preparing/countdown・hostFrame 0。playing/frame 1以後の基準と差分はplayingSupplementへ別集計。';
  b.allBases=allBases;b.bases=allBases.filter(initial);
  b.initialSnapshots=allSnapshots.filter(m=>initial(m)&&m.frame===0);
  b.unclassifiedBases=allBases.filter(m=>!initial(m)&&!playing(m));
  b.unclassifiedSnapshots=allSnapshots.filter(m=>!(initial(m)&&m.frame===0)&&!(playing(m)&&m.frame>0));
  const bases=allBases.filter(playing),snapshots=allSnapshots.filter(m=>playing(m)&&m.frame>0);
  b.playingSupplement={bases,snapshots,baseCount:bases.length,snapshotCount:snapshots.length,
    baseWireBytes:bases.reduce((n,m)=>n+m.bytes,0),baseLogicalBytes:bases.reduce((n,m)=>n+m.logicalBytes,0),
    schemaBytes:bases.reduce((n,m)=>n+m.schemaBytes,0),patchBytes:bases.reduce((n,m)=>n+m.patchBytes,0),
    snapshotWireBytes:snapshots.reduce((n,m)=>n+m.bytes,0)};
  b.controlMetadataBytes=b.prepare.reduce((n,m)=>n+m.bytes,0);
  b.lossyBootstrapBytes=[...b.bases,...b.initialSnapshots].reduce((n,m)=>n+m.bytes,0);
  b.playingSupplementWireBytes=b.playingSupplement.baseWireBytes+b.playingSupplement.snapshotWireBytes;
  b.capturedSnapshotWireBytes=[...allBases,...allSnapshots].reduce((n,m)=>n+m.bytes,0);
  Object.assign(b.summary,{baseCount:allBases.length,initialBaseCount:b.bases.length,playingBaseCount:bases.length,initialSnapshotCount:b.initialSnapshots.length,
    initialBaseWireBytes:b.bases.reduce((n,m)=>n+m.bytes,0),playingBaseWireBytes:b.playingSupplement.baseWireBytes,
    unclassifiedBaseCount:b.unclassifiedBases.length,unclassifiedSnapshotCount:b.unclassifiedSnapshots.length});
  return b;
}
function assertBootstrap(b,ok){
  // 成功・失敗を問わず、最初のassertより前に個数/サイズ/原因候補を標準出力へ残す。
  // 完全な追加pathはfinallyのonline-revision.jsonにも保存される。
  console.log('初期同期診断',JSON.stringify({units:b.units,...b.summary,schemaChanges:b.allBases.filter(x=>x.schemaChange).map(x=>({baseId:x.baseId,...x.schemaChange}))}));
  ok(b.observerErrors.length===0,'初期wireの断片を独立観測器で復元できる（'+b.units+'機）');
  ok(b.prepare.length===1&&b.prepare[0].bytes<262144&&b.prepare[0].channel==='control'&&!b.prepare[0].hasSnapshotState&&JSON.stringify(b.prepare[0].metadataKeys)===JSON.stringify(['localId','mapId','matchId','teamSize']),'初期prepareはcontrol metadata1通だけで静的状態を重複収録しない（'+b.units+'機）');
  ok(b.bases.length===1&&b.bases[0].channel==='snapshot'&&b.bases[0].schemaBytes>0&&b.bases[0].valuesBytes>0&&b.bases[0].logicalBytes<=262144&&b.initialSnapshots.length===1,'初期基準と差分を写真専用線で各1通送り、静的基準を二重送信しない（'+b.units+'機）');
  ok(b.unclassifiedBases.length===0&&b.unclassifiedSnapshots.length===0,'初期/playing以外の基準・差分を集計から除外して隠さない（'+b.units+'機）');
  ok(b.playingSupplement.bases.every(m=>m.channel==='snapshot'&&m.parent>0&&m.valuesBytes===0&&m.logicalBytes<=262144&&['schema-change','same-schema-refresh'].includes(m.observedReason)),'playingで追加した基準は初期全状態の重複でなく親付き追補として記録（'+b.units+'機）');
  ok(b.lossyBootstrapBytes+b.playingSupplementWireBytes===b.capturedSnapshotWireBytes,'初期送信とplaying追補を分けても写真線の実送信byte合計を維持（'+b.units+'機）');
}
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
    const t=CBOnlineGame.state.transport,link=t.links.get(id),types=['snapshot','snapshotBase','prepare','match','events','matchEnded'];
    window.__wire=[];const sent=types.map(type=>t.send(type,{test:true},id));types.forEach(type=>t.broadcast(type,{test:true}));
    return {sent,ready:link.ready,approved:link.approved,peers:CBOnlineGame.state.peers.size};
  },peerId);
  await sleep(180);
  const leaked=await host.evaluate(()=>__wire.filter(x=>['snapshot','snapshotBase','prepare','match','events','matchEnded'].includes(x.type)));
  ok(blocked.sent.every(v=>!v)&&!blocked.ready&&!blocked.approved&&blocked.peers===0&&leaked.length===0,'未承認者にはsnapshot・基準・準備・開始・終了・eventを送らない');
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
  const report={mode:TRANSPORT_MODE,selectedCases:{bootstrapOnly,bootstrapTeamSizes},method:'固定コマ送り/描画省略の機能回帰。wireBytesはアプリから送ったJSONのUTF8量で、回線ヘッダー・再送を含まない。実音・人間の操作感は未確認。',sizes:[],bootstrap:[]};
  try{
    if(bootstrapOnly){
      for(const teamSize of bootstrapTeamSizes){
        console.log('初期同期だけを検査: '+teamSize*2+'機');
        active=await room(browser,h,errors,{guests:1,teamSize,beforeStart:captureWire});
        const sample=await bootstrap(active.host,active.guests);report.bootstrap.push(sample);
        await active.close();active=null;
      }
      for(const sample of report.bootstrap)assertBootstrap(sample,ok);
      return;
    }
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
    report.bootstrap.push(await bootstrap(host,[guest]));
    await captureWire(host);
    await frames(pages,100);await sleep(100);
    report.sizes.push(await host.evaluate(()=>({units:__g.units.length,fullSnapshotBytes:new TextEncoder().encode(JSON.stringify(CBOnlineGame.snapshot())).length,wire:__wire,messages:__wireMessages,observerErrors:__wireObserverErrors,transport:CBOnlineGame.state.transport.metrics()})));

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
    // 基準を失った受信機で復旧要求を出し、再送基準・以後の全差分を落とす。
    // 最終写真だけでなく、その基準も使えない条件でcontrolの結果確定を検証する。
    await sleep(1100);
    await guest.evaluate(()=>{
      const proto=CBOnlineCodec.Decoder.prototype,decode=proto.decode;
      window.__finalRecovery={cleared:false,snapshots:0,droppedFrames:[],bases:0,baseIds:[],resync:0,results:0};
      proto.decode=function(delta){proto.decode=decode;this.bases.clear();__finalRecovery.cleared=true;return decode.call(this,delta);};
      const t=CBOnlineGame.state.transport,receive=t.options.onMessage,send=t.send.bind(t);
      t.options.onMessage=(type,data,id)=>{
        if(type==='snapshotBase'){__finalRecovery.bases++;__finalRecovery.baseIds.push(data.id);return;}
        if(type==='snapshot'){
          __finalRecovery.snapshots++;
          if(__finalRecovery.cleared){__finalRecovery.droppedFrames.push(data.frame);return;}
        }
        if(type==='matchEnded')__finalRecovery.results++;
        return receive(type,data,id);
      };
      t.send=(type,...args)=>{if(type==='snapshotResync')__finalRecovery.resync++;return send(type,...args);};
    });
    // 同じ基準の再送はtransportで重複除去される。既存Encoderの番号を保ち、
    // 次の基準更新を発生させて、その新基準と再送を受信側で失わせる。
    await host.evaluate(()=>{
      const proto=CBOnlineCodec.Encoder.prototype,encode=proto.encode;
      proto.encode=function(s){proto.encode=encode;this.created=-Infinity;return encode.call(this,s);};
    });
    const finalDiagnostic=async stage=>{
      const guestState=await guest.evaluate(()=>({probe:__finalRecovery,phase:CBOnlineGame.state.phase,frame:CBOnlineGame.state.lastSnapshot?.frame,metrics:CBOnlineGame.metrics()}));
      const hostState=await host.evaluate(()=>({phase:CBOnlineGame.state.phase,frame:CBOnlineGame.state.frame,messages:__wireMessages.slice(-10),metrics:CBOnlineGame.metrics()}));
      report.finalRecoveryFailure={stage,guest:guestState,host:hostState};console.error('最終結果回帰の診断',JSON.stringify(report.finalRecoveryFailure));
    };
    await pumpNetwork(host,[guest],1);
    await guest.waitForFunction(()=>__finalRecovery.cleared&&__finalRecovery.resync>=1&&__finalRecovery.bases>=1,{},{timeout:6000,polling:20}).catch(async error=>{await finalDiagnostic('基準欠落fixtureの成立');throw error;});
    for(const p of pages)await fakeLoops(p);
    // finish後は追加host loopを送らない。最後の写真を落とす前提でコアと得点を新しい値へ変える。
    const finalExpected=await host.evaluate(()=>{
      __g.timeLeft=0;__g.cores.B.hp=4321;__g.cores.R.hp=7654;
      const u=__g.units.find(u=>u.controller==='remoteHuman');u.sc.kills+=7;
      __g.finish();CBOnlineGame.afterFrame(0,performance.now());
      return {frame:CBOnlineGame.state.frame,cores:[__g.cores.B.hp,__g.cores.R.hp],units:__g.units.map(u=>({id:u.entityId,name:u.name,cls:u.cls,sc:{...u.sc}}))};
    });
    await guest.waitForFunction(()=>CBOnlineGame.state.phase==='ended',{},{timeout:6000,polling:20}).catch(async error=>{await finalDiagnostic('control結果の到着');throw error;});
    await sleep(180); // controlが先着しても、落とした最後の写真を観測してから集計する。
    const finalRecovery=await guest.evaluate(()=>({...__finalRecovery,cores:[__g.cores.B.hp,__g.cores.R.hp],units:__g.units.map(u=>({id:u.entityId,name:u.name,cls:u.cls,sc:{...u.sc}}))}));
    report.finalRecovery={expected:finalExpected,observed:finalRecovery};
    ok(finalRecovery.cleared&&finalRecovery.resync>=1&&finalRecovery.bases>=1&&finalRecovery.droppedFrames.includes(finalExpected.frame)&&finalRecovery.results===1,'最終差分・全再送基準が欠落してもcontrol結果1通で終了へ復旧');
    ok(await host.evaluate(()=>__wireMessages.filter(m=>m.type==='matchEnded').every(m=>m.channel==='control')&&__wireMessages.filter(m=>m.type==='matchEnded').length===1),'最終結果は写真専用線でなくcontrolで1通送信');
    // 各画面のunitsは自軍先になる。entityIdで揃え、scのキー挿入順に依存せず値を比較。
    const byId=units=>units.slice().sort((a,b)=>a.id.localeCompare(b.id));
    const finalMatches=isDeepStrictEqual(finalRecovery.cores,finalExpected.cores)&&isDeepStrictEqual(byId(finalRecovery.units),byId(finalExpected.units));
    if(!finalMatches){
      const expectedById=new Map(finalExpected.units.map(u=>[u.id,u])),observedById=new Map(finalRecovery.units.map(u=>[u.id,u]));
      report.finalRecovery.differences={cores:{expected:finalExpected.cores,observed:finalRecovery.cores},unitCounts:[finalExpected.units.length,finalRecovery.units.length],
        unitIds:{expected:finalExpected.units.map(u=>u.id),observed:finalRecovery.units.map(u=>u.id)},
        fields:[...new Set([...expectedById.keys(),...observedById.keys()])].flatMap(id=>{
          const a=expectedById.get(id),b=observedById.get(id);
          return ['id','name','cls','sc'].filter(k=>!isDeepStrictEqual(a?.[k],b?.[k])).map(field=>({id,field,expected:a?.[field],observed:b?.[field]}));
        })};
      console.error('最終結果の値差分',JSON.stringify(report.finalRecovery.differences));
    }
    ok(finalMatches,'写真欠落中の最終コア・全機体の表彰得点もcontrolで一致');
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
    report.bootstrap.push(await bootstrap(active.host,active.guests));
    for(const b of report.bootstrap)assertBootstrap(b,ok);
    await captureWire(active.host);await frames(active.pages,100);await sleep(100);
    report.sizes.push(await active.host.evaluate(()=>({units:__g.units.length,fullSnapshotBytes:new TextEncoder().encode(JSON.stringify(CBOnlineGame.snapshot())).length,wire:__wire,messages:__wireMessages,observerErrors:__wireObserverErrors,transport:CBOnlineGame.state.transport.metrics()})));
    for(const p of active.pages)await fakeLoops(p);
    await active.host.evaluate(()=>CBOnlineGame.leave('音停止付き退出試験'));await sleep(150);
    for(const p of active.pages){const a=await audioResult(p);ok(a.active===0&&!a.bgm&&a.stopped.length>=3,'ホスト退出時も両画面のループ音・BGMを停止');}
    for(const s of report.sizes){
      s.snapshotWireBytes=stats(s.messages.filter(x=>x.type==='snapshot').map(x=>x.bytes));
      s.snapshotLogicalBytes=stats(s.messages.filter(x=>x.type==='snapshot').map(x=>x.logicalBytes));
      s.snapshotDatagramBytes=stats(s.wire.filter(x=>x.type==='snapshot').map(x=>x.bytes));
      s.totalWireBytes=s.wire.reduce((a,x)=>a+x.bytes,0);
      s.wireBytesByType=s.wire.reduce((o,x)=>(o[x.type]=(o[x.type]||0)+x.bytes,o),{});
      s.wireBytesByChannel=s.wire.reduce((o,x)=>(o[x.channel]+=x.bytes,o),{control:0,snapshot:0});
      console.log('snapshotサイズ',JSON.stringify({units:s.units,full:s.fullSnapshotBytes,compact:s.snapshotWireBytes,wireBytesByType:s.wireBytesByType,wireBytesByChannel:s.wireBytesByChannel}));
      ok(s.observerErrors.length===0,'計測wireの全断片を独立観測器で解析できる（'+s.units+'機）');
      ok(s.snapshotWireBytes.count>0&&s.snapshotWireBytes.mean<s.fullSnapshotBytes,'compact snapshotの全fragment合計が従来の完全状態より小さい（'+s.units+'機）');
      ok(s.totalWireBytes===s.wireBytesByChannel.control+s.wireBytesByChannel.snapshot&&s.wireBytesByChannel.snapshot===(s.wireBytesByType.snapshot||0)+(s.wireBytesByType.snapshotBase||0),'写真専用線とcontrolの実送信量を分離して合計が一致（'+s.units+'機）');
    }
  }finally{if(active)await active.close();await h.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-revision.json'),JSON.stringify(report,null,2));}
},{page:false});
