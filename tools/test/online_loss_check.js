// node tools/test/online_loss_check.js dbg /tmp/online-loss [--mock-transport]
// [--recovery-only | --trajectory-only | --soak-only] [--loss=5|20]
// 人工欠落は受信済みの論理snapshot単位。IP/SCTPのpacket loss・実回線性能ではない。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {check}=require('./lib');
const {ROOT,MOCK_TRANSPORT,TRANSPORT_MODE,harness,pageFor,room,frames,summary,sleep,stats}=require('./online_test_helpers');
const selected=process.argv.find(a=>a.startsWith('--loss='));
const losses=selected?[Number(selected.split('=')[1])/100]:[.05,.2];
if(losses.some(x=>![.05,.2].includes(x)))throw Error('--loss は 5 または 20');
const only=['recovery','trajectory','soak'].filter(x=>process.argv.includes('--'+x+'-only'));
if(only.length>1)throw Error('*-only は1つだけ指定してください');
const enabled=name=>!only.length||only[0]===name;

async function installLoss(guest,rate=0,seed=214){await guest.evaluate(({rate,seed})=>{
  const t=CBOnlineGame.state.transport,receive=t.options.onMessage,send=t.send.bind(t);
  const p=window.__loss={rate,seed,received:{},dropped:{},dropSnapshots:0,dropBases:0,holdNext:false,held:null,resync:0,controls:[],accepted:[],gapMs:[],startupGapIntervals:[],gapScope:'連続してplaying中に採用したsnapshot間。初期/countdown→playingの境界は除外。',collectorVersion:2,lastAcceptedAt:null,lastAcceptedPhase:null,lastAcceptedFrame:null};
  const random=()=>{p.seed=(Math.imul(p.seed,1664525)+1013904223)>>>0;return p.seed/4294967296;};
  const deliver=t._deliverSnapshot.bind(t);
  window.__deliverWithoutLoss=(peerId,envelope)=>deliver(t.links.get(peerId),envelope);
  // 再組立後、transportの重複排除より前で落とす。同じ基準の再送を受理済みにしない。
  t._deliverSnapshot=(link,envelope)=>{
    const type=envelope.type;p.received[type]=(p.received[type]||0)+1;
    const key=type==='snapshot'?'dropSnapshots':'dropBases';
    if(p[key]>0||random()<p.rate){if(p[key]>0)p[key]--;p.dropped[type]=(p.dropped[type]||0)+1;return;}
    if(type==='snapshot'&&p.holdNext){p.holdNext=false;p.held={envelope:structuredClone(envelope),peerId:link.conn.peer};return;}
    return deliver(link,envelope);
  };
  t.options.onMessage=(type,data,id)=>{
    if(type!=='snapshot'&&type!=='snapshotBase'){p.received[type]=(p.received[type]||0)+1;p.controls.push({type,at:performance.now()});}
    const previous=CBOnlineGame.state.lastSnapshot?.frame,result=receive(type,data,id),current=CBOnlineGame.state.lastSnapshot?.frame;
    if(current!=null&&current!==previous){
      const at=performance.now(),phase=CBOnlineGame.state.phase;
      if(p.lastAcceptedAt!=null){const interval={ms:at-p.lastAcceptedAt,fromPhase:p.lastAcceptedPhase,toPhase:phase,fromFrame:p.lastAcceptedFrame,toFrame:current};if(phase==='playing'&&p.lastAcceptedPhase==='playing')p.gapMs.push(interval.ms);else p.startupGapIntervals.push(interval);}
      p.lastAcceptedAt=at;p.lastAcceptedPhase=phase;p.lastAcceptedFrame=current;p.accepted.push({at,frame:current,phase});
    }
    return result;
  };
  t.send=(type,...args)=>{if(type==='snapshotResync')p.resync++;return send(type,...args);};
},{rate,seed});}
async function pump(host,guests,n=1){
  for(let i=0;i<n;i++){
    await frames(guests,1);
    await host.evaluate(()=>{CBOnlineGame.beforeFrame(0,performance.now());CBOnlineGame.afterFrame(0,performance.now());});
    await sleep(60);
  }
}
async function probe(guest){return guest.evaluate(()=>({loss:__loss,metrics:CBOnlineGame.metrics(),frame:CBOnlineGame.state.lastSnapshot?.frame,phase:CBOnlineGame.state.phase}));}
async function forceBaseline(host){await host.evaluate(()=>{
  const proto=CBOnlineCodec.Encoder.prototype,original=proto.encode;
  proto.encode=function(s){proto.encode=original;this.created=-Infinity;return original.call(this,s);};
});}

async function approval(browser,h,errors,ok){
  const host=await pageFor(browser,h,errors,{autoApprove:false}),guest=await pageFor(browser,h,errors,{autoApprove:false});
  const diagnostic=async stage=>{for(const [who,page]of [['host',host],['guest',guest]])console.error('承認試験診断',stage,who,await page.evaluate(()=>({phase:CBOnlineGame.state.phase,status:CBOnlineGame.state.status,requests:[...CBOnlineGame.state.requests.values()],joinError:window.__joinError,mock:window.__mockTransport,metrics:CBOnlineGame.state.transport?.metrics(),links:[...CBOnlineGame.state.transport?.links.values()||[]].map(l=>({ready:l.ready,approved:l.approved,pending:l.pending,control:{open:l.conn.open,label:l.conn.label,options:l.conn.options,dc:l.conn.dataChannel},snapshot:l.snapshotConn?{open:l.snapshotConn.open,label:l.snapshotConn.label,options:l.snapshotConn.options,dc:l.snapshotConn.dataChannel}:null}))})));};
  try{
    const id=await host.evaluate(peerOptions=>CBOnlineGame.create({peerOptions}),h.peerOptions);
    await guest.evaluate(({id,peerOptions})=>{window.__joining=CBOnlineGame.join(id,{peerOptions}).catch(e=>{window.__joinError=e.message;});},{id,peerOptions:h.peerOptions});
    await host.waitForFunction(()=>CBOnlineGame.state.requests.size===1,{},{timeout:15000,polling:20}).catch(async error=>{await diagnostic('request');throw error;});
    const pending=await host.evaluate(()=>{
      const t=CBOnlineGame.state.transport,link=[...t.links.values()][0],sent=[];
      window.__beforeApproval=[];const write=t._write.bind(t);t._write=(l,item,...rest)=>{const result=write(l,item,...rest);if(result)__beforeApproval.push({type:item.type,channel:item.type==='snapshot'||item.type==='snapshotBase'?'snapshot':'control'});return result;};
      for(const type of ['prepare','snapshotBase','snapshot','events','begin','matchEnded'])sent.push(t.send(type,{secret:true},link.conn.peer));
      return {sent,ready:link.ready,approved:link.approved,snapshotOpen:!!link.snapshotConn?.open};
    });
    await sleep(150);
    const beforeWire=await host.evaluate(()=>__beforeApproval.filter(x=>['prepare','snapshotBase','snapshot','events','begin','matchEnded'].includes(x.type)));
    ok(pending.sent.every(x=>!x)&&!pending.ready&&!pending.approved&&!pending.snapshotOpen&&beforeWire.length===0,'承認前はcontrol/snapshot両経路の状態を秘匿し、第2接続も開かない');
    await host.evaluate(()=>CBOnlineGame.approveGuest([...CBOnlineGame.state.requests.keys()][0]));
    await guest.evaluate(()=>__joining);
    await host.waitForFunction(()=>[...CBOnlineGame.state.transport.links.values()][0]?.snapshotConn?.open,{},{timeout:15000,polling:20}).catch(async error=>{await diagnostic('snapshotOpen');throw error;});
    const channels=await host.evaluate(()=>{const l=[...CBOnlineGame.state.transport.links.values()][0];return {control:{id:l.conn.connectionId,label:l.conn.label,ordered:l.conn.dataChannel.ordered,maxRetransmits:l.conn.dataChannel.maxRetransmits},snapshot:{id:l.snapshotConn.connectionId,label:l.snapshotConn.label,ordered:l.snapshotConn.dataChannel.ordered,maxRetransmits:l.snapshotConn.dataChannel.maxRetransmits}};});
    ok(channels.control.id!==channels.snapshot.id&&channels.control.ordered===true&&channels.control.maxRetransmits===null&&channels.snapshot.ordered===false&&channels.snapshot.maxRetransmits===0,'承認後に別IDのreliable controlとunreliable snapshot接続が揃う');
    return {pending,channels,actualRTCSettingsVerifiedHere:!MOCK_TRANSPORT};
  }finally{for(const p of [host,guest])if(!p.isClosed()){await p.evaluate(()=>CBOnlineGame.leave('承認試験終了')).catch(()=>{});await p.close();}}
}

async function recovery(active,ok){
  const {host,guests}=active,guest=guests[0],other=guests[1];
  await installLoss(guest);
  await pump(host,guests,3);
  // 第2接続だけを詰まらせる。controlのキューや第2ゲストには変更を加えない。
  const blocked=await host.evaluate(()=>{
    const t=CBOnlineGame.state.transport,link=[...t.links.values()][0],conn=link.snapshotConn;
    if(!conn)throw Error('snapshot接続なし');
    window.__blockedSnapshot={conn,descriptor:Object.getOwnPropertyDescriptor(conn,'bufferSize')};
    Object.defineProperty(conn,'bufferSize',{configurable:true,value:100});
    const eventId=900000001;t.send('events',[{id:eventId,type:'sfx',data:{name:'annInfo'}}],link.conn.peer);
    return {peerId:link.conn.peer,eventId};
  });
  const otherBefore=await other.evaluate(()=>CBOnlineGame.state.lastSnapshot?.frame||0);
  await pump(host,guests,8);
  const isolated=await guest.evaluate(id=>({event:CBOnlineGame.state.receivedEvents.has(id),phase:CBOnlineGame.state.phase}),blocked.eventId);
  const otherAfter=await other.evaluate(()=>CBOnlineGame.state.lastSnapshot?.frame||0);
  const queued=await host.evaluate(()=>{const t=CBOnlineGame.state.transport,l=t.links.get(__blockedSnapshot.conn.peer);return {metrics:t.metrics(),controlQueue:l?.queue?.length,snapshotQueue:l?.snapshots?.length};});
  ok(isolated.event&&isolated.phase==='playing'&&otherAfter>otherBefore,'片側snapshot送信詰まり中も同じ相手のcontrol eventと他ゲストのsnapshotが届く');
  await host.evaluate(()=>{const p=__blockedSnapshot;if(p.descriptor)Object.defineProperty(p.conn,'bufferSize',p.descriptor);else delete p.conn.bufferSize;});
  await pump(host,guests,4);

  // 最初の新基準を1枚落とし、それに依存したdeltaの再同期を観測する。
  const before=await probe(guest);
  await guest.evaluate(()=>{__loss.dropBases=1;});await forceBaseline(host);
  await pump(host,guests,28);
  const after=await probe(guest),hostFrame=await host.evaluate(()=>CBOnlineGame.state.frame);
  ok((after.loss.dropped.snapshotBase||0)-(before.loss.dropped.snapshotBase||0)===1&&after.loss.resync>before.loss.resync,'基準欠落を検知しcontrolで再同期を要求');
  ok(after.frame>=hostFrame-4,'欠落基準の再取得後に最新状態へ復旧');
  ok(after.metrics.interpolation?.missingBaselines>0,'一時的な不明基準の発生を専用カウンタに記録');

  // 古いdeltaを保持し、新しいdeltaの適用後に流す。フレームと耐久は巻き戻らない。
  await guest.evaluate(()=>{__loss.holdNext=true;});await pump(host,guests,6);
  const reorder=await guest.evaluate(()=>{
    const old=__loss.held;if(!old)throw Error('順序逆転用snapshotを採取できませんでした');
    const before={frame:CBOnlineGame.state.lastSnapshot?.frame,cores:[__g.cores.B.hp,__g.cores.R.hp],metrics:CBOnlineGame.metrics().interpolation};
    __deliverWithoutLoss(old.peerId,old.envelope);
    return {before,after:{frame:CBOnlineGame.state.lastSnapshot?.frame,cores:[__g.cores.B.hp,__g.cores.R.hp],metrics:CBOnlineGame.metrics().interpolation}};
  });
  ok(reorder.after.frame===reorder.before.frame&&JSON.stringify(reorder.after.cores)===JSON.stringify(reorder.before.cores),'順序が逆転した古いsnapshotを適用せず確定状態を巻き戻さない');

  // 最後のsnapshotと新しい基準を1回ずつ失う。controlだけで結果を確定する。
  await sleep(1100);
  const finalBefore=await probe(guest);
  await guest.evaluate(()=>{__loss.dropSnapshots=1;__loss.dropBases=1;});await forceBaseline(host);
  await host.evaluate(()=>{__g.timeLeft=0;__g.finish();CBOnlineGame.afterFrame(0,performance.now());});
  const finishAt=Date.now(),deadline=finishAt+9000;
  while(Date.now()<deadline){await frames(guests,1);await sleep(40);if(await guest.evaluate(()=>CBOnlineGame.state.phase==='ended'))break;}
  await sleep(180);
  const final=await probe(guest),hostEnd=await summary(host),guestEnd=await summary(guest);
  ok(final.phase==='ended'&&guestEnd.time===hostEnd.time&&JSON.stringify(guestEnd.cores)===JSON.stringify(hostEnd.cores),'最終snapshotと基準が欠落してもホストframe追加なしでcontrolの結果へ到達');
  ok((final.loss.dropped.snapshot||0)>(finalBefore.loss.dropped.snapshot||0)&&(final.loss.dropped.snapshotBase||0)>(finalBefore.loss.dropped.snapshotBase||0),'最終snapshotと最終基準を実際に各1通以上落とした');
  return {channelIsolation:{blocked,isolated,otherBefore,otherAfter,queued},missingBaseline:{before,after,hostFrame},reorder,final:{before:finalBefore,after:final,host:hostEnd,guest:guestEnd,recoveryWallMs:Date.now()-finishAt}};
}

// 旧v4のinterpolate(t)をそのまま数式化した比較器。受信時刻、履歴8枚、固定100ms、外挿なし。
// actual側は製品beforeFrameを通す。仮想時計中の20Hz状態は同じ到着列から両方へ渡す。
async function trajectory(guest,rate){return guest.evaluate(rate=>{
  const game=CBOnlineGame,state=game.state,t=state.transport,receive=t.options.onMessage;
  const target=__g.units.find(u=>u!==__g.player),template=structuredClone(game.snapshot());
  const originalNow=Object.getOwnPropertyDescriptor(performance,'now'),send=t.send;
  const origin=performance.now()+2000,offset=t.clock()?.offsetMs||0;
  let clock=origin,seed=214;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const packets=[],encoder=new CBOnlineCodec.Encoder(),totalMs=20000,frameMs=1000/60,oldHistory=[];
  let dropped=0,delivered=0,stale=0,latest=-1,fixedPos=null,packetIndex=0,sourceChecks=0;
  const originalId=target.lifeId,rows=[],acceptedGaps=[],acceptedAt=[];
  for(let at=0;at<=totalMs;at+=50){
    const s=structuredClone(template),v=s.units.find(u=>u.id===target.entityId),teleported=at>=10000;
    s.frame=1000000+at/50;s.time=origin+offset+at;s.running=true;s.ended=false;s.timeLeft=300-at/1000;
    v.pos=[at*.01+(teleported?60:0),5,20];v.vel=[10,0,0];v.yaw=0;v.alive=true;v.lifeId=originalId+(teleported?1:0);v.transfer=null;
    const wire=encoder.encode(s),delay=25+random()*30+(at%750===0?120:0);
    // 一定速で300msの連続欠落も作り、100ms外挿上限を通過させる。
    if(random()<rate||(at>=6000&&at<6300)){dropped++;continue;}
    packets.push({at:origin+at+delay,s,wire:{frame:s.frame,delta:wire.delta},base:encoder.currentBase()});
  }
  packets.sort((a,b)=>a.at-b.at);
  if(!window.__resetInterpolationForTest)throw Error('補間fixtureの初期化フックなし');
  __resetInterpolationForTest();state.phase='playing';state.lastHost=origin;
  t.send=()=>true;game.testInput({keys:{},pressed:{},fwd:0,side:0,trigger:false,alt:false,wheel:0});
  Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
  try{
    for(let at=0;at<=totalMs;at+=frameMs){
      clock=origin+at;
      while(packetIndex<packets.length&&packets[packetIndex].at<=clock){
        const p=packets[packetIndex++];clock=p.at;delivered++;
        receive('snapshotBase',p.base,t.roomId);receive('snapshot',p.wire,t.roomId);
        if(p.s.frame>latest){
          const decoded=state.lastSnapshot?.units.find(u=>u.id===target.entityId),source=p.s.units.find(u=>u.id===target.entityId);
          if(state.lastSnapshot?.frame!==p.s.frame||!decoded||decoded.lifeId!==source.lifeId||(decoded.motionEpoch||0)!==(source.motionEpoch||0)||Math.hypot(...decoded.pos.map((n,i)=>n-source.pos[i]))>.011)throw Error('補間fixtureの復号状態が生成源と不一致: '+JSON.stringify({frame:p.s.frame,decodedFrame:state.lastSnapshot?.frame,decoded,source}));
          sourceChecks++;latest=p.s.frame;fixedPos=source.pos.slice();
          oldHistory.push({received:p.at,snapshot:p.s});if(oldHistory.length>8)oldHistory.shift();
          if(acceptedAt.length)acceptedGaps.push(p.at-acceptedAt[acceptedAt.length-1]);acceptedAt.push(p.at);
        }else stale++;
      }
      clock=origin+at;state.lastHost=clock;game.beforeFrame(0,clock);
      if(oldHistory.length>=2){
        const h=oldHistory,draw=clock-100;let a=h[0],b=h[h.length-1];for(let i=1;i<h.length;i++)if(h[i].received>=draw){a=h[i-1];b=h[i];break;}
        const f=Math.max(0,Math.min(1,(draw-a.received)/Math.max(1,b.received-a.received)));
        const v=b.snapshot.units.find(u=>u.id===target.entityId),old=a.snapshot.units.find(u=>u.id===target.entityId);
        if(v&&old&&v.lifeId===old.lifeId&&v.alive===old.alive)fixedPos=old.pos.map((n,i)=>n+(v.pos[i]-n)*f);
      }
      const metrics=game.metrics().interpolation;
      rows.push({at,adaptive:target.pos.toArray(),fixed100ms:fixedPos?.slice()||null,lifeId:target.lifeId,metrics:{delayMs:metrics?.delayMs,renderTime:metrics?.renderTime,maxExtrapolationMs:metrics?.maxExtrapolationMs,recoveryLagMs:metrics?.recoveryLagMs,effectiveDelayMs:metrics?.effectiveDelayMs},excluded:at<2000?'warmup':Math.abs(at-10000)<=600?'respawn/teleport':null});
    }
    return {rate,seed:214,totalMs,frameMs,generated:totalMs/50+1,dropped,delivered,stale,acceptedGaps,rows,fixture:{decoderReset:true,sourceChecks},metrics:game.metrics().interpolation};
  }finally{t.send=send;if(originalNow)Object.defineProperty(performance,'now',originalNow);else delete performance.now;}
},rate);}
function trajectorySummary(trace,key){
  let samples=0,stalledMs=0,stallCount=0,longestStallMs=0,currentStallMs=0,backwardSteps=0,excludedFrames=0;
  const steps=[],speed=[];
  for(let i=1;i<trace.rows.length;i++){
    const a=trace.rows[i-1],b=trace.rows[i];
    if(a.excluded||b.excluded||!a[key]||!b[key]){excludedFrames++;currentStallMs=0;continue;}
    const dt=b.at-a.at,d=Math.hypot(...b[key].map((n,j)=>n-a[key][j]));samples++;steps.push(d);speed.push(d/dt*1000);
    if(b[key][0]<a[key][0]-.001)backwardSteps++;
    if(d<.001){if(!currentStallMs)stallCount++;currentStallMs+=dt;stalledMs+=dt;longestStallMs=Math.max(longestStallMs,currentStallMs);}else currentStallMs=0;
  }
  return {samples,excludedFrames,stalledMs,stallCount,longestStallMs,backwardSteps,stepMetres:stats(steps),speedMetresPerSecond:stats(speed)};
}

check('snapshot損失・基準復旧・適応補間',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir);let active;
  // 生成した試験用コピーだけに初期化を追加。本番公開APIと製品ファイルは変えない。
  const gamePath=path.join(path.resolve(dir),'online/game.js'),source=fs.readFileSync(gamePath,'utf8'),marker='  window.CBOnlineGame=';
  if(!source.includes(marker)){await h.close();throw Error('補間fixtureの挿入位置が見つかりません');}
  fs.writeFileSync(gamePath,source.replace(marker,'  window.__resetInterpolationForTest=()=>{interpolation=interpolationState();snapshotDecoder=new CBOnlineCodec.Decoder();lastSnapshotBaseId=0;pendingSnapshotWires.clear();pendingSnapshotBases.clear();lastResync=-Infinity;resyncBackoff=250;finalFrame=null;state.history=[];state.lastSnapshot=null;};\n'+marker));
  const report={mode:TRANSPORT_MODE,usesRealWebRTC:!MOCK_TRANSPORT,productionNetworkPerformanceVerified:false,createdAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(['prototype/online/game.js','prototype/online/transport.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')])),
    method:{loss:'再組立済みlogical snapshot/snapshotBaseを、transport重複排除前にseed固定LCGで捨てる。SCTP fragment/UDP/IPの損失、再送、別回線、NAT成功は測らない。',soak:'mesa・10機・人間2人中立・Bot通常。300秒設定の試合を固定50ms高速コマ送り、描画省略。実時間300秒/20Hz/フレーム性能ではない。',trajectory:'製品beforeFrameを仮想時計60Hzで呼ぶ。一定10m/sの同じ20Hz到着traceで旧v4固定100ms・履歴8枚・外挿なしを再計算。WebGL描画/GPU/実時間性能ではない。25〜55ms遅延、750msごと追加120ms遅延、6秒時点300ms連続欠落。',metrics:'step=隣接表示位置の距離m、stall=動くfixtureでstep<0.001mの連続区間、gap=playing中に連続して適用したsnapshot受信時刻間隔。初期基準から4秒countdownを跨ぐ間隔はstartupSnapshotGapMsへ分離。先頭2秒と10秒時点のrespawn/60m teleport±600msは別集計で除外。missingBaselinesは不明基準deltaを受けた回数で、未復旧基準の個数ではない。',fixed100msReference:'c74e55b:prototype/online/game.js の interpolate(t)、位置だけを同じ式で再計算。',comparison:'到着順と損失seedは固定。固定100msとの比較は補間だけの比較で、旧v4全体のnetwork benchmarkではない。'},soak:[],trajectory:[]};
  try{
    if(enabled('recovery')){
      report.approval=await approval(browser,h,errors,ok);
      active=await room(browser,h,errors,{guests:2,teamSize:5});report.recovery=await recovery(active,ok);await active.close();active=null;
    }
    if(enabled('soak'))for(const rate of losses){
      console.log('人工snapshot損失 '+rate*100+'%・300秒設定');
      active=await room(browser,h,errors,{guests:1,teamSize:5,beforeStart:async(host,guests)=>installLoss(guests[0],rate,214)});
      const started=Date.now();let advanced=0;
      for(;advanced<6400;advanced+=10){await frames(active.pages,10);if(advanced%600===0)console.log('損失試合',rate,Math.round(300-(await summary(active.host)).time));if((await summary(active.host)).phase==='ended')break;}
      const deadline=Date.now()+10000;
      while(Date.now()<deadline){if((await summary(active.guests[0])).phase==='ended')break;await frames(active.guests,1);await sleep(40);}
      const host=await summary(active.host),guest=await summary(active.guests[0]),p=await probe(active.guests[0]);
      const row={rate,wallSeconds:(Date.now()-started)/1000,simulationFrames:advanced+10,host,guest,loss:p.loss,interpolation:p.metrics.interpolation,acceptedSnapshotGapMs:stats(p.loss.gapMs),acceptedSnapshotGapScope:p.loss.gapScope,startupSnapshotGapMs:stats(p.loss.startupGapIntervals.map(x=>x.ms))};report.soak.push(row);
      ok(host.phase==='ended'&&guest.phase==='ended'&&JSON.stringify(host.cores)===JSON.stringify(guest.cores),`${rate*100}%人工損失で300秒設定の自然Bot試合が同じ結果へ到達`);
      ok((p.loss.dropped.snapshot||0)>0&&p.loss.accepted.length>10,`${rate*100}%条件で実際にsnapshot欠落と復旧後の継続適用を観測`);
      console.log('損失結果',JSON.stringify({rate,wallSeconds:row.wallSeconds,received:p.loss.received,dropped:p.loss.dropped,gap:row.acceptedSnapshotGapMs,interpolation:row.interpolation}));
      await active.close();active=null;
    }
    if(enabled('trajectory'))for(const rate of losses){
      active=await room(browser,h,errors,{guests:1,teamSize:2});
      const trace=await trajectory(active.guests[0],rate),adaptive=trajectorySummary(trace,'adaptive'),fixed100ms=trajectorySummary(trace,'fixed100ms');
      const recoveryTrace={...trace,rows:trace.rows.filter(r=>r.at>=6300&&r.at<=7800)},burstRecovery={windowMs:[6300,7800],adaptive:trajectorySummary(recoveryTrace,'adaptive'),fixed100ms:trajectorySummary(recoveryTrace,'fixed100ms'),stepLimitMetres:10*trace.frameMs/1000*1.2+.011};
      const result={...trace,summary:{adaptive,fixed100ms,burstRecovery,stallDifferenceMs:adaptive.stalledMs-fixed100ms.stalledMs,worstStepDifferenceMetres:adaptive.stepMetres.max-fixed100ms.stepMetres.max,acceptedSnapshotGapMs:stats(trace.acceptedGaps),effectiveDelayMs:stats(trace.rows.filter(r=>!r.excluded).map(r=>r.metrics.effectiveDelayMs)),recoveryLagMs:stats(trace.rows.filter(r=>!r.excluded).map(r=>r.metrics.recoveryLagMs))}};
      report.trajectory.push(result);
      ok(trace.fixture.sourceChecks===trace.metrics.acceptedSnapshots&&trace.fixture.sourceChecks>200,`${rate*100}%条件の復号位置・lifeId・移動epochが全適用packetでfixture生成源と一致`);
      ok(adaptive.samples>500&&fixed100ms.samples===adaptive.samples,`${rate*100}%の同一受信列で固定100msと製品補間の表示軌跡を比較`);
      ok(trace.rows.every(r=>r.adaptive.every(Number.isFinite))&&trace.rows.filter(r=>!r.excluded).every(r=>r.metrics.delayMs>=60&&r.metrics.delayMs<=200),`${rate*100}%条件の位置が有限で適応遅延は60〜200ms以内`);
      ok(burstRecovery.adaptive.stepMetres.count>50&&burstRecovery.adaptive.stepMetres.max<=burstRecovery.stepLimitMetres,`${rate*100}%の連続欠落復旧で表示stepは通常速度1.2倍＋量子化許容以内`);
      ok(trace.metrics.maxExtrapolationMs>0&&trace.metrics.maxExtrapolationMs<=100.001,`${rate*100}%条件で外挿が動作し100ms以内で止まる`);
      ok(trace.stale>0&&trace.rows.some(r=>r.excluded==='respawn/teleport'),`${rate*100}%条件で順序逆転を含め、自然な再出撃相当の位置飛びは別扱い`);
      console.log('補間比較',JSON.stringify({rate,...result.summary,metrics:trace.metrics}));
      await active.close();active=null;
    }
  }finally{if(active)await active.close();await h.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-loss.json'),JSON.stringify(report,null,2));}
},{page:false});
