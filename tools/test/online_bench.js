// node tools/test/online_bench.js [dbg] [出力先] [--seconds=300] [--warmup=30]
// 実 RAF・可変 dt・描画あり。同じPCの複数ページなので、実ユーザーPC/別回線の測定とは別。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const crypto=require('node:crypto');
const {check}=require('./lib');
const {MOCK_TRANSPORT,TRANSPORT_MODE,harness,room,input,neutral,sleep,stats}=require('./online_test_helpers');
const arg=(key,d)=>{const v=process.argv.find(x=>x.startsWith('--'+key+'='));return v?Number(v.split('=')[1]):d;};
const duration=arg('seconds',300),warmup=arg('warmup',30);
check('オンラインの描画付き計測',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir,{realTime:true});let active;
  const report={mode:TRANSPORT_MODE,usesRealWebRTC:!MOCK_TRANSPORT,productionNetworkPerformanceVerified:false,createdAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTreeModified:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(['prototype/index.html','prototype/online/game.js','prototype/online/transport.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),environment:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),os:`${os.platform()} ${os.release()} ${os.arch()}`,browser:browser.version(),sameComputer:true,viewport:[960,540]},method:{scope:MOCK_TRANSPORT?'通信機能・遅延注入の代替試験のみ。負荷・帯域はWebRTC本番通信の性能値ではない':'実WebRTCのローカル計測。別回線・実ユーザーPCの性能ではない',durationSeconds:duration,warmupSeconds:warmup,rendering:true,variableDt:true,softwareGpuPossible:true,byteUnit:'KB = 1000 bytes。JSON UTF-8量。WebRTC再送・ヘッダーを含まない',latency:'同一ゲスト時計で入力投入からRAF上の状態変化まで。ディスプレイ発光時刻ではない',subjective:'人間による操作感の試遊は未実施。測定値からの推定を人間の所感と混同しない',externalNetwork:'別PC・別回線・NAT接続失敗例は未実施'},load:[],latency:[]};
  try{
    for(const teamSize of [5,10])for(const guests of [1,3]){
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
      const end=await host.evaluate(()=>({at:performance.now(),metrics:CBOnlineGame.metrics(),frames:__frameMeasure,time:__g.timeLeft,phase:CBOnlineGame.state.phase}));
      const seconds=(end.at-start.at)/1000;
      const bytes=end.metrics.transport.sentBytes-start.metrics.transport.sentBytes;
      const record={mode:TRANSPORT_MODE,networkPerformanceOnlyForSelectedTransport:true,sentBytes:bytes,sentKBps:bytes/seconds/1000,estimated20HumanKBps:teamSize===10?bytes/seconds/1000/guests*19:null,units:teamSize*2,humans:guests+1,guests,wallSeconds:seconds,gameSeconds:start.time-end.time,frameCpuMs:stats(end.frames.cpu),frameIntervalMs:stats(end.frames.interval),startMetrics:start.metrics,endMetrics:end.metrics,phase:end.phase};
      report.load.push(record);ok(record.frameCpuMs.count>0,`${teamSize*2}機/${guests}ゲストの描画ありフレームを記録`);
      console.log(JSON.stringify(record));
      await active.close();active=null;
    }
    // 遅延は送信側で各々注入。50ms設定はホスト→ゲストもゲスト→ホストも片道50ms。
    for(const latencyMs of [0,50,100]){
      active=await room(browser,h,errors,{guests:1,latencyMs,frozen:false,render:true});
      const {host,guests:[guest]}=active;
      await host.evaluate(()=>{for(const u of __g.units)if(u.controller==='bot')u.frozen=true;});
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
      const entry={mode:TRANSPORT_MODE,oneWayInjectedMs:latencyMs,movementMs:stats(move),shotToTargetDamageDisplayMs:stats(hit),movementTimeouts:move.filter(x=>x==null).length,hitTimeouts:hit.filter(x=>x==null).length,moduleMetrics:await guest.evaluate(()=>CBOnlineGame.metrics()),fixture:'Botを止め、20m前方の静止標的へ主武器。自然対戦の命中率の測定ではない'};
      report.latency.push(entry);console.log(JSON.stringify(entry));
      ok(entry.movementMs.count===5&&entry.shotToTargetDamageDisplayMs.count===5,`片道${latencyMs}msの移動・命中表示を各5回計測`);
      await active.close();active=null;
    }
  }finally{
    if(active)await active.close();await h.close();
    report.bandwidthProjection={formula:'20人: 19 × (20機状態の毎秒量 + 1接続あたりイベント/管理の毎秒量)。ホスト側が19接続を維持できる保証ではない',measured20UnitCases:report.load.filter(x=>x.units===20).map(x=>({guests:x.guests,seconds:x.wallSeconds,start:x.startMetrics,end:x.endMetrics}))};
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-bench.json'),JSON.stringify(report,null,2));
    console.log('計測ファイル: '+path.join(out,'online-bench.json'));
  }
},{page:false});
