// node tools/test/online_bench.js [dbg] [出力先] [--seconds=300] [--warmup=30]
// [--load-only | --latency-only] [--team-size=5|10] [--guests=1|3] [--latency-ms=0|50|100] [--prediction=on|off] [--mock-transport]
// 実 RAF・可変 dt・描画あり。同じPCの複数ページなので、実ユーザーPC/別回線の測定とは別。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const crypto=require('node:crypto');
const {check}=require('./lib');
const {MOCK_TRANSPORT,TRANSPORT_MODE,harness,room,input,neutral,sleep,stats,installWireObserver}=require('./online_test_helpers');
async function installWireMeasure(host){await installWireObserver(host);await host.evaluate(()=>{
  window.__newWireMeasure=()=>({snapshots:[],snapshotLogicalBytes:[],snapshotDatagrams:[],baselines:[],prepare:[],byChannel:{control:0,snapshot:0},totalBytes:0,snapshotFragmentOverheadBytes:0,peerSnapshots:{}});
  window.__wireMeasure=__newWireMeasure();
  const decoders=new Map(),locals=new Map();
  const hiddenNeutral=u=>Object.entries(u).every(([key,value])=>{
    if(['id','fixedUnit','hidden','visibilityEpoch'].includes(key))return true;
    if(['team','cls','controller','predictionBlocked'].includes(key))return value==='';
    if(['idx','motionEpoch','lagEpoch','renderCrouch'].includes(key))return value===0;
    if(['jumpPadIndex','zipLine'].includes(key))return value===-1;
    if(['pos','vel'].includes(key))return Array.isArray(value)&&value.length===3&&value.every(x=>x===0);
    if(key==='motionVectors')return Object.values(value).every(x=>x===null);
    if(key==='slots')return Object.values(value).every(slot=>Object.entries(slot).every(([field,x])=>field==='key'?x==='':x===null));
    return value===null;
  });
  window.__observeOnlineWire(w=>{
    const m=__wireMeasure;m.totalBytes+=w.messageBytes;m.byChannel[w.channel]+=w.messageBytes;
    if(w.type==='snapshot')m.snapshotDatagrams.push(w.messageBytes);
  },w=>{
    const m=__wireMeasure,{type,payload:data}=w.envelope;
    let decoder=decoders.get(w.peerId);if(!decoder){decoder=new CBOnlineCodec.Decoder();decoders.set(w.peerId,decoder);}
    if(type==='prepare')locals.set(w.peerId,data.localId);
    if(type==='snapshotBase'&&!decoder.seed(data))throw Error('負荷計測のpeer別基準を復号できません');
    if(type==='snapshot'){
      const s=decoder.decode(data.delta),localId=locals.get(w.peerId);
      if(!s||s.frame!==data.frame||!s.roster?.length||!s.units.some(u=>!u.hidden&&u.id===localId)||Object.keys(s.inputAcks||{}).some(id=>id!==localId)||Object.keys(s.acks||{}).some(id=>id!==localId))throw Error('負荷計測のpeer公開状態/自機ackが不正');
      const expected=__g.units.map(u=>u.entityId).sort(),allies=__g.units.filter(u=>u.team===localId[0]).map(u=>u.entityId);
      if(s.units.length!==expected.length||s.units.some((u,i)=>u.id!==expected[i]||u.fixedUnit!==true||typeof u.hidden!=='boolean'||u.hidden&&(!hiddenNeutral(u)||!(s.unitUpdates&(1<<i))))||allies.some(id=>!s.units.some(u=>!u.hidden&&u.id===id))||!Object.hasOwn(s.acks,localId)||!Object.hasOwn(s.inputAcks,localId))throw Error('負荷計測の固定slot・秘匿中立値・味方集合が不正');
      const envelope={...w.envelope,payload:s},bytes=v=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
      m.peerSnapshots[w.peerId]={localId,rosterCount:s.roster.length,fixedUnits:s.units.length,visibleUnits:s.units.filter(u=>!u.hidden).length,alliedUnits:s.units.filter(u=>!u.hidden&&u.team===localId[0]).length,hiddenUnits:s.units.filter(u=>u.hidden).length,projectiles:s.shells.length,ackCount:Object.keys(s.inputAcks).length,frame:s.frame,payloadBytes:bytes(s),messageBytes:bytes(envelope)};
      m.snapshots.push(w.messageBytes);m.snapshotLogicalBytes.push(w.logicalMessageBytes);
      m.snapshotFragmentOverheadBytes+=w.chunkBase64ExpansionBytes+w.chunkEnvelopeBytes;
    }
    if(type==='snapshotBase')m.baselines.push(w.messageBytes);
    if(type==='prepare')m.prepare.push({channel:w.channel,messageBytes:w.messageBytes,hasSnapshotState:['baseline','delta','units'].some(k=>Object.hasOwn(data,k))});
  });
});}
const arg=(key,d)=>{const v=process.argv.find(x=>x.startsWith('--'+key+'='));return v?Number(v.split('=')[1]):d;};
const duration=arg('seconds',300),warmup=arg('warmup',30);
const predictionArg=process.argv.find(x=>x.startsWith('--prediction='))?.split('=')[1]||'on';
if(!['on','off'].includes(predictionArg))throw Error('--prediction は on または off');
const predictionEnabled=predictionArg==='on';
if(!(duration>0)||!(warmup>=0))throw Error('seconds は正数、warmup は0以上で指定してください');
const loadOnly=process.argv.includes('--load-only'),latencyOnly=process.argv.includes('--latency-only');
if(loadOnly&&latencyOnly)throw Error('--load-only と --latency-only は同時に指定できません');
const choices=(key,allowed)=>{const v=arg(key,null);if(v==null)return allowed;if(!allowed.includes(v))throw Error('--'+key+' は '+allowed.join('/')+' のどれかです');return [v];};
const teamSizes=choices('team-size',[5,10]),guestCounts=choices('guests',[1,3]),latencies=choices('latency-ms',[0,50,100]);
check('オンラインの描画付き計測',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir,{realTime:true});let active;
  const report={mode:TRANSPORT_MODE,usesRealWebRTC:!MOCK_TRANSPORT,productionNetworkPerformanceVerified:false,createdAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTreeModified:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(['prototype/index.html','prototype/online/game.js','prototype/online/transport.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),environment:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),os:`${os.platform()} ${os.release()} ${os.arch()}`,browser:browser.version(),sameComputer:true,viewport:[960,540]},method:{selectedCases:{load:!latencyOnly,latency:!loadOnly,teamSizes,guestCounts,latencies,predictionEnabled},inputTransport:'移動は最新5コマを非再送線へ最大60Hz、射撃開始/解除・武器変更・押下はcontrol線。予測ON/OFFを明示して旧測定と混同しない。',scope:MOCK_TRANSPORT?'通信機能・遅延注入の代替試験のみ。負荷・帯域はWebRTC本番通信の性能値ではない':'実WebRTCのローカル計測。別回線・実ユーザーPCの性能ではない',durationSeconds:duration,warmupSeconds:warmup,rendering:true,variableDt:true,softwareGpuPossible:true,byteUnit:'KB = 1000 bytes。実送信fragmentのJSON UTF-8合計。logicalBytesは分割前、datagramBytesはsend1回分。WebRTC再送・ヘッダーを含まない',latency:'同一ゲスト時計で入力投入からRAF上の状態変化まで。ディスプレイ発光時刻ではない',subjective:'人間による操作感の試遊は未実施。測定値からの推定を人間の所感と混同しない',externalNetwork:'別PC・別回線・NAT接続失敗例は未実施'},load:[],latency:[]};
  try{
    if(!latencyOnly)for(const teamSize of teamSizes)for(const guests of guestCounts){
      active=await room(browser,h,errors,{guests,teamSize,predictionEnabled,frozen:false,render:true,beforeStart:installWireMeasure});
      const host=active.host;
      report.environment.webgl=await host.evaluate(()=>{const gl=__g.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:e?gl.getParameter(e.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),pixelRatio:__g.renderer.getPixelRatio()};});
      await host.evaluate(()=>{
        window.__frameMeasure={cpu:[],interval:[],last:null};
        window.__startupWireMeasure=__wireMeasure;window.__wireMeasure=__newWireMeasure();
        const f=window.gameFrame;
        window.gameFrame=function(now){const s=performance.now();try{return f(now);}finally{const m=window.__frameMeasure;m.cpu.push(performance.now()-s);if(m.last!=null)m.interval.push(now-m.last);m.last=now;}};
      });
      await sleep(warmup*1000);
      const start=await host.evaluate(()=>{__frameMeasure.cpu=[];__frameMeasure.interval=[];__wireMeasure=__newWireMeasure();return {at:performance.now(),metrics:CBOnlineGame.metrics(),time:__g.timeLeft};});
      await sleep(duration*1000);
      const end=await host.evaluate(()=>{
        const game=CBOnlineGame,t=game.state.transport,snapshot=game.snapshot(),encode=v=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
        const envelope=payload=>({protocolVersion:CBOnlineTransport.PROTOCOL,appVersion:t.appVersion,roomId:t.roomId,matchId:t.matchId,sender:t.peer.id,type:'snapshot',payload});
        const sample={payloadBytes:encode(snapshot),messageBytes:encode(envelope(snapshot)),unitCount:snapshot.units.length,projectileCount:snapshot.shells.length,sampleFrame:snapshot.frame};
        // 全量snapshotは旧方式との比較だけ。現行方式は成功送信から独立復号したpeer別公開状態で測る。
        sample.fullStateReferenceOnly=true;sample.peerSnapshots=Object.values(__wireMeasure.peerSnapshots);
        sample.observedPeerPayloadBytes=sample.peerSnapshots.map(p=>p.payloadBytes);
        sample.observedPeerMessageBytes=sample.peerSnapshots.map(p=>p.messageBytes);
        return {at:performance.now(),metrics:game.metrics(),frames:__frameMeasure,time:__g.timeLeft,phase:game.state.phase,snapshotSize:sample,wireSizes:__wireMeasure,startupWireSizes:__startupWireMeasure,observerErrors:__wireObserverErrors};
      });
      const seconds=(end.at-start.at)/1000;
      const bytes=end.metrics.transport.sentBytes-start.metrics.transport.sentBytes;
      const sentByType=Object.fromEntries(Object.keys(end.metrics.transport.byType).map(type=>[type,(end.metrics.transport.byType[type]||0)-(start.metrics.transport.byType[type]||0)]));
      const sentByChannel=Object.fromEntries(['control','snapshot'].map(channel=>[channel,end.metrics.transport.byChannel[channel].sentBytes-start.metrics.transport.byChannel[channel].sentBytes]));
      const eventBytes=sentByType.events||0,baselineBytes=sentByType.snapshotBase||0,otherBytes=bytes-(sentByType.snapshot||0)-baselineBytes-eventBytes;
      const startup=end.startupWireSizes;
      ok(end.observerErrors.length===0,'計測wireの断片を独立観測器で解析できる');
      ok(bytes===Object.values(sentByType).reduce((a,n)=>a+n,0)&&bytes===sentByChannel.control+sentByChannel.snapshot,'計測区間のtype別・channel別送信量が総量と一致');
      ok(sentByChannel.snapshot===(sentByType.snapshot||0)+baselineBytes,'ホスト送信の非再送線はsnapshotと基準だけを送信');
      ok(bytes===end.wireSizes.totalBytes&&['control','snapshot'].every(c=>sentByChannel[c]===end.wireSizes.byChannel[c]),'独立した実送信観測とtransport計量が一致');
      ok(end.snapshotSize.peerSnapshots.length===guests&&end.snapshotSize.peerSnapshots.every(p=>p.rosterCount===teamSize*2&&p.fixedUnits===teamSize*2&&p.alliedUnits===teamSize&&p.ackCount===1&&p.visibleUnits+p.hiddenUnits===teamSize*2),'各peerの公開名簿・自機/味方・自己ack1件を独立復号して計測');
      ok(startup.prepare.length===guests&&startup.prepare.every(p=>p.channel==='control'&&!p.hasSnapshotState),'初期prepareはゲストごとにcontrol metadataを1通だけ送信');
      const record={mode:TRANSPORT_MODE,predictionEnabled,networkPerformanceOnlyForSelectedTransport:true,sentBytes:bytes,sentKBps:bytes/seconds/1000,sentBytesByType:sentByType,sentBytesByChannel:sentByChannel,startup:{controlMetadataBytes:startup.prepare.reduce((n,p)=>n+p.messageBytes,0),lossySnapshotBytes:startup.byChannel.snapshot,prepare:startup.prepare,baselineWireBytes:stats(startup.baselines)},
        snapshotSize:end.snapshotSize,compactSnapshotWireBytes:stats(end.wireSizes.snapshots),compactSnapshotLogicalBytes:stats(end.wireSizes.snapshotLogicalBytes),snapshotDatagramBytes:stats(end.wireSizes.snapshotDatagrams),baselineWireBytes:stats(end.wireSizes.baselines),snapshotFragmentOverheadBytes:end.wireSizes.snapshotFragmentOverheadBytes,
        projected20HumanCompactSnapshotOnly20HzKBps:teamSize===10&&end.wireSizes.snapshots.length?stats(end.wireSizes.snapshots).mean*20*19/1000:null,
        compactProjectionCaveat:'compactは各宛先の公開機体と自己ackだけを含む実送信1論理写真の全fragment合計平均からの概算。19宛先ごとの視点・優先度・ack履歴の分布は未測定。イベント・基準更新・再送・ヘッダーは別。',
        projected20HumanObservedRateKBps:teamSize===10?bytes/seconds/1000/guests*19:null,
        projected20HumanPeerStateOnly20HzKBps:teamSize===10&&end.snapshotSize.peerSnapshots.length?stats(end.snapshotSize.observedPeerMessageBytes).mean*20*19/1000:null,
        projected20HumanBaselineObservedRateKBps:teamSize===10?baselineBytes/seconds/1000/guests*19:null,
        projected20HumanControlObservedRateKBps:teamSize===10?sentByChannel.control/seconds/1000/guests*19:null,
        projected20HumanSnapshotChannelObservedRateKBps:teamSize===10?sentByChannel.snapshot/seconds/1000/guests*19:null,
        projected20HumanEventsObservedRateKBps:teamSize===10?eventBytes/seconds/1000/guests*19:null,
        projected20HumanOtherObservedRateKBps:teamSize===10?otherBytes/seconds/1000/guests*19:null,
        bandwidthCaveat:'snapshotSizeのpayloadBytes/messageBytesは旧全量方式の比較用で現行送信値ではない。peerSnapshotsは各宛先の最後の成功送信を独立復号した公開状態。peerStateOnlyはその圧縮前平均、compactは実差分の平均を用いる別の概算。19人換算は視点分布も20人接続も実測しておらず、低FPSの観測頻度と20Hz設計を混同しない。イベント・再送・ヘッダーを含まない。',
        units:teamSize*2,humans:guests+1,guests,wallSeconds:seconds,gameSeconds:start.time-end.time,frameCpuMs:stats(end.frames.cpu),frameIntervalMs:stats(end.frames.interval),startMetrics:start.metrics,endMetrics:end.metrics,phase:end.phase};
      report.load.push(record);ok(record.frameCpuMs.count>0,`${teamSize*2}機/${guests}ゲストの描画ありフレームを記録`);
      console.log(JSON.stringify(record));
      await active.close();active=null;
    }
    // 遅延は送信側で各々注入。50ms設定はホスト→ゲストもゲスト→ホストも片道50ms。
    if(!loadOnly)for(const latencyMs of latencies){
      active=await room(browser,h,errors,{guests:1,latencyMs,predictionEnabled,frozen:false,render:true});
      const {host,guests:[guest]}=active;
      // 遅延fixtureだけAIを明示停止。負荷測定の部屋は既に閉じ、別ページなので影響しない。
      await host.evaluate(()=>{window.botUpdate=()=>{};for(const u of __g.units)if(u.controller==='bot')u.vel.set(0,0,0);});
      const move=[],hit=[];
      for(let i=0;i<5;i++){
        const fixture=await host.evaluate(()=>{
          const g=__g,u=g.units.find(u=>u.controller==='remoteHuman'),target=g.units.find(v=>v.team!==u.team);
          u.pos.set(0,g.terrainH(0,170),170);u.vel.set(0,0,0);u.hp=u.maxHp;u.invulT=0;u.repairing=false;u.switchT=0;u.stun=null;
          u.onlineMotionEpoch=(u.onlineMotionEpoch||0)+1; // fixtureの位置resetを通常の小補正と混ぜない。
          target.pos.set(0,g.terrainH(0,185),185);target.vel.set(0,0,0);target.hp=target.maxHp;target.invulT=0;target.repairing=false;target.stun=null;
          for(const x of [u,target]){x.group.position.copy(x.pos);g.weaponLook(x,0);}g.scene.updateMatrixWorld(true);
          return {targetId:target.entityId||target.netId,aim:g.targetPoint(target).toArray()};
        });
        await input(guest,neutral);await sleep(2000+latencyMs*2);
        const movement=await guest.evaluate(async base=>{
          const p=__g.player.pos.clone(),at=performance.now();CBOnlineGame.testInput({...base,keys:{KeyW:true},yaw:0,pitch:0});
          return await new Promise(resolve=>{const f=()=>{if(p.z-__g.player.pos.z>.02){CBOnlineGame.testInput(base);resolve(performance.now()-at);}else if(performance.now()-at>4000){CBOnlineGame.testInput(base);resolve(null);}else requestAnimationFrame(f);};requestAnimationFrame(f);});
        },neutral);
        move.push(movement);await sleep(400+latencyMs*2);
        const shot=await guest.evaluate(async({base,fixture})=>{
          const find=()=>__g.units.find(u=>(u.entityId||u.netId)===fixture.targetId);const target=find();if(!target)return null;
          const hp=target.hp,at=performance.now();CBOnlineGame.requestWeapon('main');CBOnlineGame.testInput({...base,trigger:true,yaw:Math.PI,pitch:0,aimPoint:fixture.aim});
          return await new Promise(resolve=>{const f=()=>{if(find().hp<hp){CBOnlineGame.testInput(base);resolve(performance.now()-at);}else if(performance.now()-at>4000){CBOnlineGame.testInput(base);resolve(null);}else requestAnimationFrame(f);};requestAnimationFrame(f);});
        },{base:neutral,fixture});
        hit.push(shot);await sleep(400+latencyMs*2);
      }
      const entry={mode:TRANSPORT_MODE,predictionEnabled,samples:{movementMs:move,shotToTargetDamageDisplayMs:hit},oneWayInjectedMs:latencyMs,movementMs:stats(move),shotToTargetDamageDisplayMs:stats(hit),movementTimeouts:move.filter(x=>x==null).length,hitTimeouts:hit.filter(x=>x==null).length,moduleMetrics:await guest.evaluate(()=>CBOnlineGame.metrics()),fixture:'Botを止め、約15m前方の静止標的へ主武器。自然対戦の命中率の測定ではない'};
      report.latency.push(entry);console.log(JSON.stringify(entry));
      ok(entry.movementMs.count===5&&entry.shotToTargetDamageDisplayMs.count===5,`片道${latencyMs}msの移動・命中表示を各5回計測`);
      await active.close();active=null;
    }
  }finally{
    if(active)await active.close();await h.close();
    report.bandwidthProjection={
      compactSnapshotOnlyFormula:'実送信compact snapshotの1論理写真の全fragment合計平均サイズ × 20Hz × 19接続 / 1000 KB/秒（イベント・基準更新・19ゲスト分ack差は別）',
      peerStateOnlyFormula:'成功送信を独立復号した各peerの最後の公開状態（固定slotと自己ack）の圧縮前平均UTF-8バイト数 × 20Hz × 19接続 / 1000 KB/秒',
      observedRateFormula:'測定中の全送信バイト数 / 測定秒数 / 実ゲスト数 × 19 / 1000 KB/秒。低FPSによる送信頻度低下も含むため20Hz予算には使わない',
      exclusions:'19人換算は測定時のpeer別公開状態平均を使う概算で、19視点の公開集合・独立入力・優先度分布を実測した値ではない。peer-state-onlyにはイベント・基準・その他control通信・WebRTC/SCTP/DTLS/UDP/IPのヘッダー・再送を含まない。snapshot fragmentのbase64化とJSON外枠は実送信量に含む。20人時の弾数とイベント頻度、19接続のCPU負荷・成立は未検証。末尾の1枚のサイズは平均/最大値ではない。',
      measured20UnitCases:report.load.filter(x=>x.units===20).map(x=>({guests:x.guests,seconds:x.wallSeconds,snapshotSize:x.snapshotSize,
        observedRateKBps:x.projected20HumanObservedRateKBps,peerStateOnly20HzKBps:x.projected20HumanPeerStateOnly20HzKBps,compactSnapshotOnly20HzKBps:x.projected20HumanCompactSnapshotOnly20HzKBps,compactSnapshotWireBytes:x.compactSnapshotWireBytes,baselineWireBytes:x.baselineWireBytes,
        baselineObservedRateKBps:x.projected20HumanBaselineObservedRateKBps,controlObservedRateKBps:x.projected20HumanControlObservedRateKBps,snapshotChannelObservedRateKBps:x.projected20HumanSnapshotChannelObservedRateKBps,eventsObservedRateKBps:x.projected20HumanEventsObservedRateKBps,otherObservedRateKBps:x.projected20HumanOtherObservedRateKBps,start:x.startMetrics,end:x.endMetrics}))};
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-bench.json'),JSON.stringify(report,null,2));
    console.log('計測ファイル: '+path.join(out,'online-bench.json'));
  }
},{page:false});
