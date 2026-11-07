// node tools/test/online_bench.js [dbg] [出力先] [--seconds=300] [--warmup=30]
// [--load-only | --latency-only] [--team-size=5|10] [--guests=1|3] [--latency-ms=0|50|100] [--mock-transport]
// 実 RAF・可変 dt・描画あり。同じPCの複数ページなので、実ユーザーPC/別回線の測定とは別。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const crypto=require('node:crypto');
const {check}=require('./lib');
const {MOCK_TRANSPORT,TRANSPORT_MODE,harness,room,input,neutral,sleep,stats}=require('./online_test_helpers');
const arg=(key,d)=>{const v=process.argv.find(x=>x.startsWith('--'+key+'='));return v?Number(v.split('=')[1]):d;};
const duration=arg('seconds',300),warmup=arg('warmup',30);
if(!(duration>0)||!(warmup>=0))throw Error('seconds は正数、warmup は0以上で指定してください');
const loadOnly=process.argv.includes('--load-only'),latencyOnly=process.argv.includes('--latency-only');
if(loadOnly&&latencyOnly)throw Error('--load-only と --latency-only は同時に指定できません');
const choices=(key,allowed)=>{const v=arg(key,null);if(v==null)return allowed;if(!allowed.includes(v))throw Error('--'+key+' は '+allowed.join('/')+' のどれかです');return [v];};
const teamSizes=choices('team-size',[5,10]),guestCounts=choices('guests',[1,3]),latencies=choices('latency-ms',[0,50,100]);
check('オンラインの描画付き計測',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir,{realTime:true});let active;
  const report={mode:TRANSPORT_MODE,usesRealWebRTC:!MOCK_TRANSPORT,productionNetworkPerformanceVerified:false,createdAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTreeModified:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(['prototype/index.html','prototype/online/game.js','prototype/online/transport.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),environment:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),os:`${os.platform()} ${os.release()} ${os.arch()}`,browser:browser.version(),sameComputer:true,viewport:[960,540]},method:{selectedCases:{load:!latencyOnly,latency:!loadOnly,teamSizes,guestCounts,latencies},scope:MOCK_TRANSPORT?'通信機能・遅延注入の代替試験のみ。負荷・帯域はWebRTC本番通信の性能値ではない':'実WebRTCのローカル計測。別回線・実ユーザーPCの性能ではない',durationSeconds:duration,warmupSeconds:warmup,rendering:true,variableDt:true,softwareGpuPossible:true,byteUnit:'KB = 1000 bytes。JSON UTF-8量。WebRTC再送・ヘッダーを含まない',latency:'同一ゲスト時計で入力投入からRAF上の状態変化まで。ディスプレイ発光時刻ではない',subjective:'人間による操作感の試遊は未実施。測定値からの推定を人間の所感と混同しない',externalNetwork:'別PC・別回線・NAT接続失敗例は未実施'},load:[],latency:[]};
  try{
    if(!latencyOnly)for(const teamSize of teamSizes)for(const guests of guestCounts){
      active=await room(browser,h,errors,{guests,teamSize,frozen:false,render:true});
      const host=active.host;
      report.environment.webgl=await host.evaluate(()=>{const gl=__g.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:e?gl.getParameter(e.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),pixelRatio:__g.renderer.getPixelRatio()};});
      await host.evaluate(()=>{
        window.__frameMeasure={cpu:[],interval:[],last:null};
        const f=window.gameFrame;
        window.gameFrame=function(now){const s=performance.now();try{return f(now);}finally{const m=window.__frameMeasure;m.cpu.push(performance.now()-s);if(m.last!=null)m.interval.push(now-m.last);m.last=now;}};
      });
      await sleep(warmup*1000);
      const start=await host.evaluate(()=>{__frameMeasure.cpu=[];__frameMeasure.interval=[];return {at:performance.now(),metrics:CBOnlineGame.metrics(),time:__g.timeLeft};});
      await sleep(duration*1000);
      const end=await host.evaluate(()=>{
        const game=CBOnlineGame,t=game.state.transport,snapshot=game.snapshot(),encode=v=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
        const envelope=payload=>({protocolVersion:CBOnlineTransport.PROTOCOL,appVersion:t.appVersion,roomId:t.roomId,matchId:t.matchId,sender:t.peer.id,type:'snapshot',payload});
        const sample={payloadBytes:encode(snapshot),messageBytes:encode(envelope(snapshot)),unitCount:snapshot.units.length,projectileCount:snapshot.shells.length,sampleFrame:snapshot.frame};
        // 同じ20機の1枚を土台に、人間19ゲスト分の操作権と入力確認だけ補う。
        // 弾数・イベント頻度を20人対戦で実測したことにはならない。
        if(snapshot.units.length===20){
          const projected=JSON.parse(JSON.stringify(snapshot));
          projected.units.forEach(u=>{u.controller=u.id===game.state.localUnitId?'localHuman':'remoteHuman';});
          projected.acks=Object.fromEntries(projected.units.filter(u=>u.id!==game.state.localUnitId).map(u=>[u.id,snapshot.frame]));
          sample.projected20HumanPayloadBytes=encode(projected);
          sample.projected20HumanMessageBytes=encode(envelope(projected));
        }
        return {at:performance.now(),metrics:game.metrics(),frames:__frameMeasure,time:__g.timeLeft,phase:game.state.phase,snapshotSize:sample};
      });
      const seconds=(end.at-start.at)/1000;
      const bytes=end.metrics.transport.sentBytes-start.metrics.transport.sentBytes;
      const sentByType=Object.fromEntries(Object.keys(end.metrics.transport.byType).map(type=>[type,(end.metrics.transport.byType[type]||0)-(start.metrics.transport.byType[type]||0)]));
      const eventBytes=sentByType.events||0,otherBytes=bytes-(sentByType.snapshot||0)-eventBytes;
      const record={mode:TRANSPORT_MODE,networkPerformanceOnlyForSelectedTransport:true,sentBytes:bytes,sentKBps:bytes/seconds/1000,sentBytesByType:sentByType,
        snapshotSize:end.snapshotSize,
        projected20HumanObservedRateKBps:teamSize===10?bytes/seconds/1000/guests*19:null,
        projected20HumanSnapshotOnly20HzKBps:teamSize===10?end.snapshotSize.projected20HumanMessageBytes*20*19/1000:null,
        projected20HumanEventsObservedRateKBps:teamSize===10?eventBytes/seconds/1000/guests*19:null,
        projected20HumanOtherObservedRateKBps:teamSize===10?otherBytes/seconds/1000/guests*19:null,
        bandwidthCaveat:'観測量の19人換算は低FPS時の送信頻度低下を含む。20Hz設計値とは別。snapshot-onlyは終了時の1枚からの見積りで、イベント・再送・通信ヘッダーを含まない。イベントの実頻度は未推定。',
        units:teamSize*2,humans:guests+1,guests,wallSeconds:seconds,gameSeconds:start.time-end.time,frameCpuMs:stats(end.frames.cpu),frameIntervalMs:stats(end.frames.interval),startMetrics:start.metrics,endMetrics:end.metrics,phase:end.phase};
      report.load.push(record);ok(record.frameCpuMs.count>0,`${teamSize*2}機/${guests}ゲストの描画ありフレームを記録`);
      console.log(JSON.stringify(record));
      await active.close();active=null;
    }
    // 遅延は送信側で各々注入。50ms設定はホスト→ゲストもゲスト→ホストも片道50ms。
    if(!loadOnly)for(const latencyMs of latencies){
      active=await room(browser,h,errors,{guests:1,latencyMs,frozen:false,render:true});
      const {host,guests:[guest]}=active;
      // 遅延fixtureだけAIを明示停止。負荷測定の部屋は既に閉じ、別ページなので影響しない。
      await host.evaluate(()=>{window.botUpdate=()=>{};for(const u of __g.units)if(u.controller==='bot')u.vel.set(0,0,0);});
      const move=[],hit=[];
      for(let i=0;i<5;i++){
        const fixture=await host.evaluate(()=>{
          const g=__g,u=g.units.find(u=>u.controller==='remoteHuman'),target=g.units.find(v=>v.team!==u.team);
          u.pos.set(0,g.terrainH(0,170),170);u.vel.set(0,0,0);u.hp=u.maxHp;u.invulT=0;u.repairing=false;u.switchT=0;u.stun=null;
          target.pos.set(0,g.terrainH(0,185),185);target.vel.set(0,0,0);target.hp=target.maxHp;target.invulT=0;target.repairing=false;target.stun=null;
          for(const x of [u,target]){x.group.position.copy(x.pos);g.weaponLook(x,0);}g.scene.updateMatrixWorld(true);
          return {targetId:target.entityId||target.netId,aim:g.targetPoint(target).toArray()};
        });
        await input(guest,neutral);await sleep(400+latencyMs*2);
        const movement=await guest.evaluate(async base=>{
          const p=__g.player.pos.clone(),at=performance.now();CBOnlineGame.testInput({...base,keys:{KeyW:true},yaw:0,pitch:0});
          return await new Promise(resolve=>{const f=()=>{if(__g.player.pos.distanceTo(p)>.02){CBOnlineGame.testInput(base);resolve(performance.now()-at);}else if(performance.now()-at>4000){CBOnlineGame.testInput(base);resolve(null);}else requestAnimationFrame(f);};requestAnimationFrame(f);});
        },neutral);
        move.push(movement);await sleep(400+latencyMs*2);
        const shot=await guest.evaluate(async({base,fixture})=>{
          const find=()=>__g.units.find(u=>(u.entityId||u.netId)===fixture.targetId);const target=find();if(!target)return null;
          const hp=target.hp,at=performance.now();CBOnlineGame.testInput({...base,weapon:'main',trigger:true,yaw:Math.PI,pitch:0,aimPoint:fixture.aim});
          return await new Promise(resolve=>{const f=()=>{if(find().hp<hp){CBOnlineGame.testInput(base);resolve(performance.now()-at);}else if(performance.now()-at>4000){CBOnlineGame.testInput(base);resolve(null);}else requestAnimationFrame(f);};requestAnimationFrame(f);});
        },{base:neutral,fixture});
        hit.push(shot);await sleep(400+latencyMs*2);
      }
      const entry={mode:TRANSPORT_MODE,oneWayInjectedMs:latencyMs,movementMs:stats(move),shotToTargetDamageDisplayMs:stats(hit),movementTimeouts:move.filter(x=>x==null).length,hitTimeouts:hit.filter(x=>x==null).length,moduleMetrics:await guest.evaluate(()=>CBOnlineGame.metrics()),fixture:'Botを止め、約15m前方の静止標的へ主武器。自然対戦の命中率の測定ではない'};
      report.latency.push(entry);console.log(JSON.stringify(entry));
      ok(entry.movementMs.count===5&&entry.shotToTargetDamageDisplayMs.count===5,`片道${latencyMs}msの移動・命中表示を各5回計測`);
      await active.close();active=null;
    }
  }finally{
    if(active)await active.close();await h.close();
    report.bandwidthProjection={
      snapshotOnlyFormula:'20人: 20人用に操作権・入力確認を補った20機snapshotメッセージのUTF-8バイト数 × 20Hz × 19接続 / 1000 KB/秒',
      observedRateFormula:'測定中の全送信バイト数 / 測定秒数 / 実ゲスト数 × 19 / 1000 KB/秒。低FPSによる送信頻度低下も含むため20Hz予算には使わない',
      exclusions:'snapshot-onlyにはイベント・その他通信・WebRTC/SCTP/DTLS/UDP/IPのヘッダー・再送を含まない。20人時の弾数とイベント頻度、19接続のCPU負荷・成立は未検証。末尾の1枚のサイズは平均/最大値ではない。',
      measured20UnitCases:report.load.filter(x=>x.units===20).map(x=>({guests:x.guests,seconds:x.wallSeconds,snapshotSize:x.snapshotSize,
        observedRateKBps:x.projected20HumanObservedRateKBps,snapshotOnly20HzKBps:x.projected20HumanSnapshotOnly20HzKBps,
        eventsObservedRateKBps:x.projected20HumanEventsObservedRateKBps,otherObservedRateKBps:x.projected20HumanOtherObservedRateKBps,start:x.startMetrics,end:x.endMetrics}))};
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-bench.json'),JSON.stringify(report,null,2));
    console.log('計測ファイル: '+path.join(out,'online-bench.json'));
  }
},{page:false});
