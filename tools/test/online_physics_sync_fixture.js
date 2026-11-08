// node tools/test/online_physics_sync_fixture.js --revision=1838915
// node tools/test/online_physics_sync_fixture.js --revision=working
// 製品physics・初期装備・送信/ACK/照合を接続。平地VMであり実ブラウザ/RTC測定ではない。
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
function createPhysicsSuite(revision='working'){
  assert(revision==='working'||/^[a-f0-9]{7,40}$/.test(revision),'revisionはworkingかcommit ID');
  const read=p=>{
    if(revision==='working')return fs.readFileSync(path.join(root,p),'utf8');
    try{return execFileSync('git',['show',revision+':'+p],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
    catch(error){throw new Error(`比較元 ${revision}:${p} がローカルgitにありません。shallow cloneでは比較元commitを含む履歴を取得してから再実行してください。fixtureは自動fetchしません。`,{cause:error});}
  };
  const game=read('prototype/online/game.js'),html=read('prototype/index.html');
  const sourceFiles={'prototype/online/game.js':game,'prototype/index.html':html,
    'prototype/parts.js':read('prototype/parts.js'),'prototype/weapons.js':read('prototype/weapons.js'),
    'prototype/online/codec.js':read('prototype/online/codec.js')};
  const T=require('../../vendor/three-r128/three.min.js');
  // 武器モデル関数は色表の初期化だけ。WebGL生成・描画はしない。
  const tables={T,structuredClone,SFX:{},TEAM:{B:{color:0x00ff00},R:{color:0xff0000}}};
  vm.createContext(tables);
  vm.runInContext(html.match(/const WALK = [^\n]+/)[0]+'\n'+html.match(/function baseKick\(w\) \{[^\n]+/)[0]+
    '\n'+sourceFiles['prototype/parts.js']+'\nObject.assign(globalThis,partTables());\n'+sourceFiles['prototype/weapons.js']+
    '\nObject.assign(globalThis,weaponModels());Object.assign(globalThis,weaponTables());\n'+
    html.slice(html.indexOf('function setBonus('),html.indexOf('// Botの機体：')),tables);
  vm.runInContext(`this.defaults={};for(const cls of ['assault','heavy']){
    const mech=${html.match(/MECH_DEFAULT = (\{[^;]+\})/)[1]},keys=Object.fromEntries(SLOTS.map(k=>[k,CLASSES[cls][k]]));
    this.defaults[cls]={mech,keys,stats:mechStats(mech,keys),weapons:Object.fromEntries(SLOTS.map(k=>[k,WEAPONS[keys[k]]]))};
  }`,tables);
  const codecContext={module:{exports:{}},TextEncoder,TextDecoder,Buffer};vm.createContext(codecContext);
  vm.runInContext(sourceFiles['prototype/online/codec.js'],codecContext);
  const codec=codecContext.module.exports;
  function sourceRequire(filename){
    const original=createRequire(filename);
    const custom=name=>name==='node:fs'||name==='fs'?{...fs,readFileSync:(p,...args)=>
      String(p)===path.join(root,'prototype/index.html')?html:
      String(p)===path.join(root,'prototype/online/game.js')?game:fs.readFileSync(p,...args)}:original(name);
    custom.resolve=original.resolve;return custom;
  }
  const movementFile=path.join(__dirname,'online_movement.test.js'),movementTest=fs.readFileSync(movementFile,'utf8');
  const mc={require:sourceRequire(movementFile),console};vm.createContext(mc);
  vm.runInContext(movementTest.slice(0,movementTest.indexOf('let count=0;'))+'\nthis.api={harness,makeUnit,T};',mc);
  function load(unitClass){
    const filename=path.join(__dirname,'online_prediction.test.js'),original=fs.readFileSync(filename,'utf8');
    const end=original.indexOf('\n{\n  const h=harness();reconcile');assert(end>0);
    let source=original.slice(0,end);
    source=source.replace('vm.createContext(c);',`const physical=globalThis.physical.harness();
      physical.c.movementSpread=()=>0;physical.c.isLocalView=()=>false;physical.c.R=1.3;physical.c.UNIT_H=4;
      vm.runInContext(globalThis.spUseSource,physical.c);
      const cfg=globalThis.defaults[globalThis.unitClass];
      for(let i=0;i<units.length;i++){
        const {slots,...old}=units[i];
        const u=units[i]=globalThis.physical.makeUnit({...old,pos:new globalThis.physical.T.Vector3(),vel:new globalThis.physical.T.Vector3()});
        Object.assign(u,{cls:globalThis.unitClass,mech:{...cfg.mech},stats:cfg.stats,walkV:cfg.stats.walk,dashV:cfg.stats.dash,cruiseV:cfg.stats.cruise,maxBoost:cfg.stats.P.body.boost,boost:cfg.stats.P.body.boost});
        for(const k of ['main','sub','aux','sp'])u.slots[k]={...u.slots[k],w:cfg.weapons[k],heat:100,overheat:false};
      }
      c.CBOnlineVisibility=require('../../prototype/online/visibility');
      c.SLOTS=['main','sub','aux','sp'];c.WEAPONS=Object.fromEntries(Object.values(cfg.weapons).map(w=>[w.key,w]));
      c.T=globalThis.physical.T;c.player=units[0];physical.c.units=units;
      c.predictHumanMovement=(...args)=>physical.c.predictHumanMovement(...args);
      c.movementPressLog=[];c.updateHumanMovement=(...args)=>{if(Object.keys(args[1].pressed||{}).length)c.movementPressLog.push({seq:args[1].seq,pressed:{...args[1].pressed}});return physical.c.updateHumanMovement(...args);};
      c.movementStatusTick=(...args)=>physical.c.movementStatusTick(...args);
      c.humanUtilityInput=(...args)=>physical.c.humanUtilityInput?.(...args);
      c.movementPredictionBlockReason=(...args)=>physical.c.movementPredictionBlockReason(...args);
      c.updateHumanUnit=(u,input,dt,opts)=>{if(!u.onlineFixedMovement)physical.c.auxiliaryStatusTick(u,dt);return physical.c.updateHumanUnit(u,input,dt,opts);};
      vm.createContext(c);`);
    source=source.replace('getPrediction:()=>prediction,',(game.includes('function stepLocalCommands(')?'stepLocalCommands,':'')+'fixedUnitForPeer,getPrediction:()=>prediction,');
    const context={require:sourceRequire(filename),console,setTimeout,clearTimeout,physical:mc.api,defaults:tables.defaults,unitClass,
      spUseSource:html.slice(html.indexOf('function spUse('),html.indexOf('// ---- 双肩照射砲'))};
    vm.createContext(context);vm.runInContext(source+'\nthis.api={harness,input,snapshot,reconcile};',context);
    return context.api;
  }
  function run({mode='walk',unitClass='assault',durationMs=2200,hostHz=60,guestHz=60,
    hostPattern=null,guestPattern=[1000/60+.1,1000/60-.1],hostPhaseMs=1,guestPhaseMs=0,
    snapshotGap=null,guestPause=null,transportPumpMs=0,inputGap=null,inputEveryFrames=1,oneWayMs=12,snapshotMs=50,useCodec=true,fixedUnits=true,fixed=game.includes('function stepLocalCommands(')}={}){
    assert(unitClass!=='heavy'||mode!=='charger','charger対照は初期強襲だけ');
    const {harness,input,snapshot,reconcile}=load(unitClass),host=harness(),guest=harness();
    host.game.state.role='host';
    const peer={id:'g',unitId:'B:0',receivedSeq:0,appliedSeq:0,last:0,pendingEdges:{}};
    host.game.state.peers.set('g',peer);
    Object.assign(host.units[0],{controller:'remoteHuman',ownerPeerId:'g'});
    if(fixed){peer.fixedCommands=true;host.units[0].onlineFixedMovement=true;}
    if(mode==='charger'){host.units[0].chargerOn=true;guest.units[0].chargerOn=true;}
    reconcile(guest,snapshot(guest));
    const encoder=new codec.Encoder(),decoder=new codec.Decoder(),queue=[],rows=[];
    let order=0,sent=0,lastSnapshot=-Infinity,frame=0,previousKeys={},pendingBatch=null,deliveredBatches=0;
    const enqueue=(time,kind,data)=>queue.push({time,kind,data,order:order++});
    // transportの20ms送信pumpの時刻代役。RTC/fragment/帯域bucket自体の試験ではない。
    const send=(time,kind,data)=>{
      const arrival=(transportPumpMs?Math.ceil((time-1e-9)/transportPumpMs)*transportPumpMs:time)+oneWayMs;
      if(transportPumpMs&&(kind==='inputBatch'||kind==='snapshot'))for(let i=queue.length-1;i>=0;i--)if(queue[i].kind===kind&&Math.abs(queue[i].time-arrival)<1e-7)queue.splice(i,1);
      enqueue(arrival,kind,data);
    };
    for(const [kind,hz,pattern,phase]of [['guest',guestHz,guestPattern,guestPhaseMs],['host',hostHz,hostPattern,hostPhaseMs]]){
      for(let i=1,time=phase,lastEmitted=phase;time<durationMs;i++){
        const ms=pattern?pattern[(i-1)%pattern.length]:1000/hz;time+=ms;
        if(kind==='guest'&&guestPause&&time>=guestPause[0]&&time<guestPause[1])continue;
        enqueue(time,kind,{index:i,dt:Math.min(.05,(time-lastEmitted)/1000)});lastEmitted=time;
      }
    }
    while(queue.length){
      queue.sort((a,b)=>a.time-b.time||a.order-b.order);
      const event=queue.shift(),time=event.time;if(time>durationMs)break;
      host.at(time);guest.at(time);
      if(event.kind==='guest'){
        guest.test.decayPredictionVisual();
        const command=input(event.data.index);command.trigger=false;command.keys=mode==='stop'?{}:{KeyW:true};command.pressed={};
        if(mode==='longDash'||mode==='charger')command.keys.ShiftLeft=true;
        if(mode==='reverse'&&time%1200>=600)command.keys={KeyS:true};
        if(mode==='shortDash')command.keys.ShiftLeft=time%600<100;
        if(mode==='jump')command.keys.Space=time%2000<500;
        for(const key of ['ShiftLeft','Space'])if(command.keys[key]&&!previousKeys[key])command.pressed[key]=true;
        previousKeys={...command.keys};
        if(fixed)guest.test.stepLocalCommands(command,event.data.dt);
        else{guest.test.sendLocalInput(command);guest.test.predictLocalInput(command,event.data.dt);}
        while(sent<guest.sent.length){const message=guest.sent[sent++];if(message.type==='inputBatch')pendingBatch=message;else send(time,message.type,message.data);}
        if(pendingBatch&&event.data.index%inputEveryFrames===0&&!(inputGap&&time>=inputGap[0]&&time<inputGap[1])){send(time,pendingBatch.type,pendingBatch.data);pendingBatch=null;deliveredBatches++;}
      }else if(event.kind==='inputBatch')host.test.acceptInputBatch(peer,event.data);
      else if(event.kind==='inputActions')host.test.acceptInputActions(peer,event.data);
      else if(event.kind==='host'){
        const command=host.game.remoteInput(host.units[0]);host.c.updateHumanUnit(host.units[0],command,event.data.dt);frame++;
        if(time-lastSnapshot>=snapshotMs){
          const state=JSON.parse(JSON.stringify(host.game.snapshot()));state.frame=frame;state.time=time;
          if(fixedUnits){state.roster=state.units.map(u=>({id:u.id,name:u.name,cls:u.cls,sc:u.sc}));state.units=state.units.map(u=>host.test.fixedUnitForPeer(u,false,1));state.unitUpdates=(1<<state.units.length)-1;state.gadgets=[];}
          send(time,'snapshot',{state,wire:useCodec?encoder.encode(state):null});lastSnapshot=time;
        }
      }else{
        if(snapshotGap&&time>=snapshotGap[0]&&time<snapshotGap[1])continue;
        const {state,wire}=event.data;if(wire?.baseline)assert(decoder.seed(wire.baseline));
        const photo=wire?decoder.decode(wire.delta):state;assert(photo);
        const previous=guest.units[0].pos.toArray();reconcile(guest,photo);
        const metric=guest.game.metrics().prediction;
        rows.push({time,hostTime:photo.time,...metric.corrections.at(-1),photoBlocked:photo.units[0].predictionBlocked,
          guestBlocked:guest.units[0].onlinePredictionBlocked,blockedFrames:metric.blockedFrames,
          hostPos:photo.units[0].pos,guestBefore:previous,guestAfter:guest.units[0].pos.toArray(),
          repeatedCommands:peer.repeatedCommands||0,queueLength:peer.commandQueue?.length||0,repeatDebt:guest.test.getPrediction().repeatDebt||0,pendingCount:guest.test.getPrediction().pending.length,pendingSeconds:guest.test.getPrediction().pending.reduce((n,p)=>n+p.provisionalDt,0),
          hostVel:photo.units[0].vel,guestVel:guest.units[0].vel.toArray(),ack:photo.inputAcks['B:0']});
      }
    }
    const recent=rows.filter(row=>row.time>=durationMs-2000),changed=recent.filter(row=>row.distance>.001),hard=recent.filter(row=>row.reason!=='smooth');
    const intervals=recent.slice(1).map((row,i)=>row.time-recent[i].time),cfg=tables.defaults[unitClass];
    return {revision,mode,unitClass,fixed,hostHz,guestHz,hostPattern,guestPattern,hostPhaseMs,guestPhaseMs,durationMs,oneWayMs,snapshotMs,useCodec,fixedUnits,snapshotGap,guestPause,transportPumpMs,inputGap,inputEveryFrames,deliveredBatches,repeatedCommands:peer.repeatedCommands||0,
      equipment:{mech:cfg.mech,keys:cfg.keys,weight:cfg.stats.weight,cap:cfg.stats.cap,walk:cfg.stats.walk,dash:cfg.stats.dash,cruise:cfg.stats.cruise,
        spType:cfg.weapons.sp.type,spSpeed:cfg.weapons.sp.speed,spUse:cfg.weapons.sp.use},
      hostMovementPresses:host.c.movementPressLog||[],
      inputBatches:guest.sent.filter(message=>message.type==='inputBatch').length,
      last2seconds:{snapshots:recent.length,arrivalMean:intervals.reduce((n,x)=>n+x,0)/Math.max(1,intervals.length),corrections:changed.length,
        mean:changed.reduce((n,row)=>n+row.distance,0)/Math.max(1,changed.length),max:Math.max(0,...recent.map(row=>row.distance)),
        hardSnaps:hard.length,reasons:hard.reduce((result,row)=>(result[row.reason]=(result[row.reason]||0)+1,result),{}),
        blockedPhotoCorrections:changed.filter(row=>row.photoBlocked).length},rows};
  }
  return {run,load,sourceHashes:Object.fromEntries(Object.entries(sourceFiles).map(([p,s])=>[p,crypto.createHash('sha256').update(s).digest('hex')]))};
}
if(require.main===module){
  const revision=process.argv.find(arg=>arg.startsWith('--revision='))?.slice(11)||'working',suite=createPhysicsSuite(revision),reports=[];
  for(const unitClass of ['assault','heavy'])for(const mode of ['stop','walk','shortDash','longDash','jump',...(unitClass==='assault'?['charger']:[])]){
    const result=suite.run({mode,unitClass});const {rows,...summary}=result;
    reports.push({...summary,sampleCorrections:rows.filter(row=>row.distance>.001).slice(0,3)});
  }
  console.log(JSON.stringify({notice:'平地VM・実physics/default装備/codec/ACK。実RTC/描画/全マップ/被弾や施設外力の測定ではない。',sourceHashes:suite.sourceHashes,reports},null,2));
}
module.exports={createPhysicsSuite};
