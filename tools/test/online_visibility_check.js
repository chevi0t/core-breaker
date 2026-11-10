// node tools/test/online_visibility_check.js dbg /tmp/online-visibility [--mock-transport]
// [--functional-only | --size-only | --node-only] [--team-size=5|10] [--before=前版online-visibility.json]
// raw wireと独立復号を保存。size fixtureと実WebRTC/実時間throughputを混同しない。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {visibilitySizeFixture}=require('./online_visibility_fixture');
const {productionBoundaryChecks}=require('./online_visibility_boundary_fixture');
const {publicStateChecks}=require('./online_visibility_assertions');
const flags=['functional-only','size-only','node-only'].filter(x=>process.argv.includes('--'+x));
if(flags.length>1)throw Error('*-only は同時指定できません');
const beforeArg=process.argv.find(a=>a.startsWith('--before='));
const beforeFile=beforeArg?path.resolve(beforeArg.slice('--before='.length)):null;
const beforeReport=beforeFile?JSON.parse(fs.readFileSync(beforeFile,'utf8')):null;
const teamArg=process.argv.find(a=>a.startsWith('--team-size='));
const teamSizes=teamArg?[Number(teamArg.split('=')[1])]:[5,10];
if(teamSizes.some(n=>![5,10].includes(n)))throw Error('--team-size は5か10');
function pureChecks(){
  const V=require('../../prototype/online/visibility'),checks=[],observations=[];
  const test=(v,name,data)=>{checks.push({name,value:!!v});if(!v)observations.push({name,data});};
  const unit=(id,team,x,z=0)=>({entityId:id,team,alive:true,pos:{x,y:0,z},yaw:0,pitch:0,weapon:'main',slots:{main:{w:{scope:4}}}});
  const noticed=(e,d)=>!e.cloak||d<8+e.vis*e.vis*80;
  for(const team of ['B','R']){
    const enemy=team==='B'?'R':'B',viewer=unit(team+':0',team,0),ally=unit(team+':1',team,500),target=unit(enemy+':0',enemy,180),units=[viewer,ally,target];
    const spotted={B:new Map(),R:new Map()};let los=true;
    const view=()=>V.createView({viewer,units,spotted,noticed,canSee:()=>los,targetPoint:e=>({...e.pos,y:e.pos.y+3}),lineOfSight:()=>los,locksPlayer:()=>false});
    test(view().visible.has(ally.entityId),team+'の遠方味方を常に許可');
    test(!view().visible.has(target.entityId),team+'の通常遠距離・視野外敵を秘匿');
    spotted[team].set(target,5);test(view().visible.has(target.entityId),team+'の索敵済み通常敵を許可');
    target.cloak=true;target.vis=.1;test(!view().visible.has(target.entityId),team+'の遠方迷彩は索敵済みでも秘匿');
    ally.pos.x=target.pos.x+8.79;test(view().visible.has(target.entityId),team+'の生存味方noticed範囲で迷彩を共有');
    ally.alive=false;test(!view().visible.has(target.entityId),team+'の死亡味方から迷彩を共有しない');
    ally.alive=true;ally.pos.x=target.pos.x+8.81;test(!view().visible.has(target.entityId),team+'のnoticed境界外を秘匿');
    ally.pos.x=500;target.cloak=false;spotted[team].clear();target.pos.x=80;test(view().visible.has(target.entityId),team+'の通常敵80m境界を許可');
    target.pos.x=80.01;test(!view().visible.has(target.entityId),team+'の視野外80m超を秘匿');
    target.pos.x=0;target.pos.z=-200;test(view().visible.has(target.entityId),team+'の照準近傍・LOS遠距離敵を許可');
    los=false;test(!view().visible.has(target.entityId),team+'の壁裏遠距離敵を秘匿');los=true;
    viewer.scoped=true;target.pos.x=300;test(!view().visible.has(target.entityId),team+'の4倍scope画角外を秘匿');
    target.pos.x=10;test(view().visible.has(target.entityId)&&view().cadence.get(target.entityId)===1,team+'のscope内・LOS敵を毎回更新');
    viewer.scoped=false;target.pos.x=110;target.pos.z=0;spotted[team].set(target,5);
    test(view().cadence.get(target.entityId)===2,team+'の遠方120mを2回間引き');target.pos.x=250;
    test(view().cadence.get(target.entityId)===4,team+'の遠方250mを4回間引き');
    target.controlTarget=viewer;test(view().cadence.get(target.entityId)===1,team+'を狙う敵は毎回更新');target.controlTarget=null;
    for(const [kind,range]of [['mine',30],['remote',30],['sensor',50],['sentry',60]]){
      const gadget={kind,gadget:true,team:enemy,pos:{x:range,y:0,z:0}};
      test(view().gadgetVisible(gadget),team+'/'+kind+'の既存探索距離内を許可');gadget.pos.x=range+.01;
      test(!view().gadgetVisible(gadget),team+'/'+kind+'の未発見距離外を秘匿');gadget.pos.x=range-1;los=false;
      test(!view().gadgetVisible(gadget),team+'/'+kind+'の壁裏を秘匿');los=true;
    }
  }
  const rows=Array.from({length:20},(_,i)=>[i,1900000,1900004,123456789.123,19]);
  const view={time:123456789.123,frame:1900004,delayMs:200,units:rows};
  test(V.copyView(view)?.units.length===20,'20機の個別表示stampを保持');
  for(const [name,value]of [['重複',{...view,units:[rows[0],rows[0]]}],['21機',{...view,units:[...rows,[20,1,1,1,1]]}],['不正epoch',{...view,units:[[0,1,2,1,0]]}],['逆順sample',{...view,units:[[0,2,1,1,1]]}],['非有限時刻',{...view,time:NaN}]])test(V.copyView(value)===null,name+'を入力stampから拒否');
  const input={seq:9999999,lifeId:100,actionSeq:999999,sentAt:123456789.123,view,keys:{KeyW:true,ShiftLeft:true},pressed:{},yaw:3.141592653589793,pitch:1.23456789,aimPoint:[100.123456789,200.123456789,300.123456789],cameraRecoil:1.23456789,cameraRecoilYaw:1.23456789,trigger:true,alt:false};
  const envelope={protocolVersion:9,appVersion:'Ver180',roomId:'fixture-room-'+ 'x'.repeat(36),matchId:'fixture-match-'+ 'y'.repeat(36),sender:'fixture-peer-'+ 'z'.repeat(36),type:'inputBatch',inputSequence:999999,connectionToken:'t'.repeat(48),payload:{inputs:Array.from({length:5},(_,i)=>({...input,seq:input.seq+i}))}};
  const size=Buffer.byteLength(JSON.stringify(envelope));test(size<=8192,'20機stamp×最新5入力が8KiB以内',{bytes:size});
  const boundaries=productionBoundaryChecks();checks.push(...boundaries.checks);observations.push(...boundaries.observations);
  return {checks,observations,boundaries,inputBatch:{bytes:size,limit:8192,raw:envelope},failure:checks.some(x=>!x.value)};
}
function instrument(dir){
  const p=path.join(dir,'online/game.js'),s=fs.readFileSync(p,'utf8'),marker='  window.CBOnlineGame=';
  if(!s.includes(marker))throw Error('visibility fixture hook位置がありません');
  const hook='  const __visibilityRawSnapshot=snapshot;snapshot=function(...args){window.__visibilityFixture?.();return __visibilityRawSnapshot(...args);};\n  window.__visibilityTest={setupWorld,preset,fixedUnitForPeer,gadgetPolicyForLoadouts,gadgetCapacityForLoadouts,gadgetSlotsForPeer,snapshotForPeer,encodePeerSnapshot,eventsForPeer,createPeerView,replicationFor,rememberPeerSnapshot,applySnapshot,interpolate,receiveSnapshot,handleSnapshotControl,matchResult,receiveMatchEnded,playEvents,verifiedPeerUnitTimes,interpolatePeerUnits,remoteHistory:()=>remoteUnitHistory,view:()=>lastRenderedView};\n';
  fs.writeFileSync(p,s.replace(marker,hook+'  window.__visibilityTest.publicStateChecks='+publicStateChecks.toString()+';\n'+marker));
}
async function installProbe(host,guests){
  const {installWireObserver}=require('./online_test_helpers');
  await installWireObserver(host);
  await host.evaluate(()=>{
    const probe=window.__visibilityProbe={phase:'initial',wire:[],decoded:[],errors:[]},decoders=new Map();
    window.__visibilityFixture=()=>{
      const g=__g;for(const k of ['B','R']){g.spotted[k].clear();g.spotSrc[k].clear();}
      for(const [i,u]of g.units.entries()){
        u.pos.set((u.team==='B'?-1:1)*(731.37+i*17),200,319.91+i*13);u.vel.set(0,0,0);u.cloak=true;u.vis=.01;u.alive=true;
        u.group.position.copy(u.pos);u.group.updateMatrixWorld(true);const other=u.team==='B'?'R':'B';g.spotted[other].set(u,30);g.spotSrc[other].set(u,new Map([['レーダー',30]]));
      }
      for(const r of g.radars)r.intruders=g.units.filter(u=>u.team!==r.team);
    };
    window.__observeOnlineWire(w=>probe.wire.push({phase:probe.phase,peerId:w.peerId,channel:w.channel,bytes:w.messageBytes,envelope:w.envelope}),w=>{
      try{
        let d=decoders.get(w.peerId);if(!d){d=new CBOnlineCodec.Decoder();decoders.set(w.peerId,d);}
        const p=w.envelope.payload,type=w.envelope.type;let state=null;
        if(type==='snapshotBase'){if(!d.seed(p))throw Error('probe baseline seed失敗');state=d.decode([p.v,p.id,'']);}
        if(type==='snapshot'){state=d.decode(p.delta);if(!state)throw Error('probe delta decode失敗');}
        if(state)probe.decoded.push({phase:probe.phase,peerId:w.peerId,type,raw:p,state});
      }catch(e){probe.errors.push(e.stack||e.message);}
    });
  });
  for(const guest of guests)await installWireObserver(guest);
}
async function lobbyRegression(host,guests){
  const {installWireObserver,sleep}=require('./online_test_helpers');
  await installWireObserver(host);
  const setup=await host.evaluate(()=>{
    const game=CBOnlineGame,h=__visibilityTest,g=__g;
    // 実ロビーの接続は開始しない。前試合/ローカル戦のworldだけを残して攻撃する。
    h.setupWorld(5,'B:0','mesa');game.state.teamSize=5;
    for(const [i,u]of g.units.entries())u.pos.set(9001.25+i*13,220,9101.75+i*17);
    window.__lobbyPrivacy={wire:[],requests:[],before:{phase:game.state.phase,matchId:game.state.matchId,transportMatchId:game.state.transport.matchId,
      peers:[...game.state.peers.values()].map(p=>({id:p.id,unitId:p.unitId})),units:g.units.map(u=>({id:u.entityId,pos:u.pos.toArray()}))}};
    const receive=game.state.transport.options.onMessage;
    game.state.transport.options.onMessage=(type,payload,peer,...args)=>{if(type==='snapshotResync')__lobbyPrivacy.requests.push({type,payload,peer});return receive(type,payload,peer,...args);};
    window.__observeOnlineWire(w=>__lobbyPrivacy.wire.push({type:w.type,peerId:w.peerId,bytes:w.messageBytes,envelope:w.envelope}));
    return __lobbyPrivacy.before;
  });
  const attempted=[];for(const guest of guests)attempted.push(await guest.evaluate(()=>CBOnlineGame.state.transport.send('snapshotResync',{})));
  await sleep(160);
  const result=await host.evaluate(()=>({...__lobbyPrivacy,after:{phase:CBOnlineGame.state.phase,peers:[...CBOnlineGame.state.peers.values()].map(p=>({id:p.id,unitId:p.unitId,hasReplication:!!p.replication}))}}));
  const checks=[
    {name:'承認済み未開始の実ロビーに前worldのsentinel位置を残す',value:setup.phase==='lobby'&&setup.units.length===10&&setup.peers.every(p=>p.unitId==null)},
    {name:'全guestのsnapshotResyncが実transportでhostへ届く',value:attempted.every(Boolean)&&new Set(result.requests.map(r=>r.peer)).size===guests.length},
    {name:'未開始ロビーのresyncへbase/snapshot/fragmentを返さない',value:result.wire.every(w=>!['snapshot','snapshotBase','snapshotChunk'].includes(w.type)&&!['snapshot','snapshotBase','snapshotChunk'].includes(w.envelope.type))},
    {name:'ロビーresyncで前worldの秘密位置をraw通信へ載せない',value:result.wire.every(w=>!JSON.stringify(w.envelope).includes('9001.25')&&!JSON.stringify(w.envelope).includes('9101.75'))},
    {name:'拒否したロビーresyncでpeer基準を生成しない',value:result.after.phase==='lobby'&&result.after.peers.every(p=>!p.hasReplication&&p.unitId==null)}];
  return {checks,attempted,...result};
}
async function privacyFunctional(host){
  return host.evaluate(()=>{
    const g=__g,game=CBOnlineGame,h=__visibilityTest,C=CBOnlineCodec,checks=[],raw=[],details={},peers=[...game.state.peers.values()];
    const test=(v,name,data)=>{checks.push({value:!!v,name});if(!v)throw Error(name+'\n'+JSON.stringify(data));};
    const clone=x=>JSON.parse(JSON.stringify(x)),id=u=>u.entityId||u.netId,savedFrame=game.state.frame,savedReplication=peers.map(p=>[p,p.replication]);
    for(const p of peers)p.replication=null;
    const expected=p=>g.units.filter(u=>u.team===g.units.find(u=>id(u)===p.unitId).team).map(id).sort();
    const neutral=v=>v===null||v===0||v===''||Array.isArray(v)&&v.every(neutral)||v&&typeof v==='object'&&Object.values(v).every(neutral);
    const scrubbed=u=>u.hidden&&Object.entries(u).every(([k,v])=>['id','fixedUnit','hidden','visibilityEpoch'].includes(k)||(['jumpPadIndex','zipLine'].includes(k)?v===-1:neutral(v)));
    const checkState=(s,p,label)=>{
      const own=g.units.find(u=>id(u)===p.unitId),allowed=expected(p),hidden=g.units.filter(u=>u.team!==own.team),ids=s.units.filter(u=>!u.hidden).map(u=>u.id).sort();
      test(JSON.stringify(ids)===JSON.stringify(allowed),label+' 可視stateに同陣営だけ存在',{ids,allowed});
      test(s.units.length===g.units.length&&new Set(s.units.map(u=>u.id)).size===g.units.length&&s.units.every(u=>u.fixedUnit===true),label+' 秘匿機も固定unit枠を保持');
      test(s.units.filter(u=>u.hidden).every(scrubbed),label+' 秘匿枠はnested行動/装備を含め中立値だけ');
      test(Array.isArray(s.gadgets)&&s.gadgets.length===h.gadgetCapacityForLoadouts([...Object.keys(g.CLASSES).map(h.preset),...g.units.map(u=>Object.fromEntries(g.SLOTS.map(k=>[k,u.slots[k].w.key])))])&&s.gadgets.every(row=>row[0]===1),label+' 開始時装備の固定gadget枠は空と秘匿で同じ印');
      test(s.roster.length===g.units.length&&s.roster.every(u=>!['pos','vel','yaw','pitch','slots','cloak','vis','hp'].some(k=>Object.hasOwn(u,k))),label+' rosterは全機の公開属性だけ');
      test(Object.keys(s.inputAcks||{}).every(x=>x===own.entityId)&&Object.keys(s.acks||{}).every(x=>x===own.entityId),label+' 入力ackは自機だけ');
      test(Object.values(s.spotted||{}).flat().every(([x])=>allowed.includes(x)),label+' spottedから秘匿IDを除外');
      test(Object.values(s.spotSrc||{}).flat().every(([x])=>x===own.entityId),label+' spotSrcは自機警告だけ');
      test(s.radars.every(r=>(r.intruders||[]).every(x=>allowed.includes(x))),label+' radarに秘匿敵IDを残さない');
      const numbers=[];const walk=x=>{if(typeof x==='number')numbers.push(x);else if(x&&typeof x==='object')Object.values(x).forEach(walk);};walk(s);
      test(hidden.every(u=>!numbers.includes(u.pos.x)&&!numbers.includes(u.pos.z)),label+' 秘匿位置のsentinelが復号全体にない');
      for(const c of h.publicStateChecks(s,game.snapshot()))test(c.value,label+' '+c.name,c.data);
    };
    try{
      test(new Set(peers.map(p=>g.units.find(u=>id(u)===p.unitId).team)).size===2,'実ゲストにB/R両陣営がある');
      for(const p of peers){
        const d=new C.Decoder(),full=game.snapshot();let beforeId;
        for(const stage of ['initial','delta','rebase','schema','resync']){
          if(stage==='delta'){game.state.frame++;full.frame=game.state.frame;full.time+=50;full.units.forEach(u=>u.hp-=1);}
          if(stage==='rebase'){game.state.frame++;full.frame=game.state.frame;full.time+=10001;}
          if(stage==='schema'){game.state.frame++;full.frame=game.state.frame;full.time+=50;full.codecFixture={version:17};}
          let encoded;
          if(stage==='resync'){
            encoded={baseline:h.replicationFor(p).encoder.currentBase(),wire:h.replicationFor(p).latestWire};
          }else encoded=h.encodePeerSnapshot(p,full,stage==='initial');
          const {baseline,wire}=encoded;
          if(baseline){test(d.seed(baseline),stage+' 基準を独立復号');const base=d.decode([baseline.v,baseline.id,'']);raw.push({peer:p.id,stage,type:'snapshotBase',payload:baseline,decoded:base});checkState(base,p,p.id+'/'+stage+'/base');}
          const s=d.decode(wire.delta);raw.push({peer:p.id,stage,type:'snapshot',payload:wire,decoded:s});test(!!s,stage+' 差分を独立復号');checkState(s,p,p.id+'/'+stage+'/delta');
          if(stage==='schema')test(!!baseline,'安全なglobal schema追補を基準へ反映');
          if(stage==='rebase')test(wire.delta[1]!==beforeId,'10秒経過でpeer基準更新');beforeId=wire.delta[1];
        }
        // 旧delta欠落後も次の独立差分を復元し、基準再同期を別のDecoderで確認。
        full.frame++;full.time+=50;h.encodePeerSnapshot(p,full);
        full.frame++;full.time+=50;full.units.find(u=>u.id===p.unitId).pos[0]+=3;
        const next=h.encodePeerSnapshot(p,full);if(next.baseline)test(d.seed(next.baseline),'欠落後baseをseed');const decoded=d.decode(next.wire.delta);
        test(decoded.units.find(u=>u.id===p.unitId).pos[0]===Math.round(full.units.find(u=>u.id===p.unitId).pos[0]*100)/100,'途中delta欠落で位置を失わない');
        const empty=new C.Decoder();test(empty.decode(next.wire.delta)===null,'基準欠落のdeltaを適用しない');test(empty.seed(h.replicationFor(p).encoder.currentBase())&&!!empty.decode(next.wire.delta),'完全基準再同期から復元');
        const own=g.units.find(u=>id(u)===p.unitId),enemy=g.units.find(u=>u.team!==own.team),events=[
          {id:91001,type:'shot',data:{unit:id(enemy),seq:1}},{id:91002,type:'sfx',data:{unit:id(enemy),at:enemy.pos.toArray(),name:'rifle'}},
          {id:91003,type:'tracer',data:{unit:id(enemy),from:enemy.pos.toArray(),end:own.pos.toArray(),team:enemy.team}},
          {id:91004,type:'shot',data:{unit:id(own),seq:1}},{id:91005,type:'hit',data:{unit:id(own),seq:1,head:false}}];
        const filtered=h.eventsForPeer(p,events);raw.push({peer:p.id,stage:'events',events,filtered});
        test(filtered.every(e=>e.id>=91004),'迷彩敵のshot/sfx/tracerをeventから遮断');test(filtered.some(e=>e.id===91004)&&filtered.some(e=>e.id===91005),'自機shot/hitの通知を維持');
        const synthetic=clone(full);synthetic.shells=[{id:88001,pos:enemy.pos.toArray(),vel:[1,0,0],team:enemy.team},{id:88002,pos:own.pos.toArray(),vel:[1,0,0],team:own.team}];
        const temp=synthetic.shells.map(sh=>({...sh,onlineId:sh.id,pos:new g.T.Vector3().fromArray(sh.pos),owner:sh.team===own.team?own:enemy,spec:{}}));g.shells.push(...temp);
        try{const shellState=h.snapshotForPeer(p,synthetic,true);raw.push({peer:p.id,stage:'shells',state:shellState});
          test(!shellState.shells.some(s=>s.id===88001)&&shellState.shells.some(s=>s.id===88002),'不可視敵shell位置を遮断し味方shellを維持');
        }finally{for(const sh of temp)g.shells.splice(g.shells.indexOf(sh),1);}
        for(const [kind,range]of [['mine',30],['remote',30],['sensor',50],['sentry',60]]){
          const side=own.team==='B'?-1:1,edge=side*Math.max(...g.units.filter(u=>u.team===own.team).map(u=>side*u.pos.x));
          const source={gadget:true,kind,team:enemy.team,pos:new g.T.Vector3(edge+side*(range+6),own.pos.y,own.pos.z)};
          const e={id:92000+range,type:'sfx',source,data:{at:source.pos.toArray(),name:'rifle'}};
          test(h.eventsForPeer(p,[e]).length===0,'未発見'+kind+'の音源位置をeventから遮断');
        }
      }
      const result=h.matchResult();raw.push({stage:'final',result});
      test(result.units.length===g.units.length&&result.units.every(u=>!['pos','vel','yaw','slots','cloak','vis','hp'].some(k=>Object.hasOwn(u,k))),'終了結果は全機scoresだけで空間情報を含まない');
      test(JSON.stringify(result.cores)===JSON.stringify(game.snapshot().cores)&&result.timeLeft===g.timeLeft,'終了結果でCORE/timeを維持');
      const t=game.state.transport,p=peers[0],link=t.links.get(p.id),approval=link.approved;
      test(['snapshot','snapshotBase','events','matchEnded'].every(type=>t.send(type,{secret:true},'nonexistent-peer')===false),'不正peer宛に秘密情報を送信しない');
      try{link.approved=false;test(['snapshot','snapshotBase','events','matchEnded'].every(type=>t.send(type,{secret:true},p.id)===false),'未承認peer宛に秘密情報を送信しない');}finally{link.approved=approval;}
      details.publicScores=result.units;details.initialWire=window.__visibilityProbe;
      return {checks,raw,details};
    }catch(e){return {checks,raw,details,failure:e.stack||e.message};}finally{game.state.frame=savedFrame;for(const [p,r]of savedReplication)p.replication=r;}
  });
}
async function priorityFunctional(host){
  return host.evaluate(()=>{
    const h=__visibilityTest,g=__g,game=CBOnlineGame,checks=[],raw=[],hiddenBaselineHold=[],fixture=window.__visibilityFixture,peers=[...game.state.peers.values()],saved=peers.map(p=>[p,p.replication]),frame=game.state.frame;
    const test=(v,name,data)=>{checks.push({value:!!v,name});if(!v)throw Error(name+'\n'+JSON.stringify(data));};
    try{
      window.__visibilityFixture=null;
      for(const p of peers){
        fixture();p.replication=null;
        const own=g.units.find(u=>u.entityId===p.unitId),ally=g.units.find(u=>u!==own&&u.team===own.team),enemy=g.units.find(u=>u.team!==own.team);
        const restore={ownYaw:own.yaw,allyPos:ally.pos.toArray(),enemyPos:enemy.pos.toArray(),target:enemy.target,controlTarget:enemy.controlTarget};
        own.yaw=0;own.scoped=false;ally.pos.copy(own.pos).add(new g.T.Vector3(120,0,0));enemy.pos.copy(own.pos).add(new g.T.Vector3(400,0,0));enemy.cloak=false;enemy.target=enemy.controlTarget=null;
        { // 初回hidden基準からのrevealと、その後の間引き差分を実guestのapplyへも渡す。
        enemy.cloak=true;enemy.vis=.01;enemy.vel.set(0,0,0);game.state.frame=frame+60;
        const first=h.encodePeerSnapshot(p,game.snapshot(100000)),index=first.snapshot.units.findIndex(v=>v.id===enemy.entityId),packets=[];
        test(first.snapshot.units[index].hidden&&!!first.baseline,'初回hidden基準で遠方保持回帰を開始');
        enemy.cloak=false;game.state.frame++;const exposed=h.encodePeerSnapshot(p,game.snapshot(100050)),epoch=exposed.snapshot.units[index].visibilityEpoch;
        test(!exposed.baseline&&!!(exposed.snapshot.unitUpdates&(1<<index)),'初回hiddenからrevealは通常差分の強制更新');
        let held=0;
        for(let n=0;n<6;n++){
          enemy.pos.x+=1;game.state.frame++;const e=h.encodePeerSnapshot(p,game.snapshot(100100+n*50)),independent=new CBOnlineCodec.Decoder();independent.seed(first.baseline);const decoded=independent.decode(e.wire.delta),v=decoded.units[index];
          if(!(decoded.unitUpdates&(1<<index))){held++;test(!v.hidden&&v.visibilityEpoch===epoch,'初回hidden基準でも遠方省略frameの公開印/epochを保持');}
          test(!e.baseline,'reveal後の遠方保持で基準を増やさない');packets.push({wire:e.wire,decoded});
        }
        test(held>=3,'初回hiddenからreveal後の遠方省略を3回以上採取');
        hiddenBaselineHold.push({unitId:p.unitId,target:enemy.entityId,baseline:first.baseline,initial:first.wire,reveal:exposed.wire,packets});p.replication=null;
        }
        const d=new CBOnlineCodec.Decoder(),rows=[];let initialEpoch,skippedShot=false,lastUpdate,omittedUpdate=false;
        for(let n=0;n<9;n++){
          game.state.frame=frame+100+n;enemy.pos.x+=.25;const full=game.snapshot(100000+n*50),e=h.encodePeerSnapshot(p,full),i=e.snapshot.units.findIndex(v=>v.id===enemy.entityId),j=e.snapshot.units.findIndex(v=>v.id===ally.entityId),update=!!(e.snapshot.unitUpdates&(1<<i));
          test(i>=0&&j>=0,'低頻度対象も可視集合から消さない');
          if(e.baseline)test(d.seed(e.baseline),'低頻度codecの基準を復元');
          // n=4相当の途中更新を受けなかった場合も、次の更新は単独差分で読める。
          const decoded=update&&n>0&&!omittedUpdate?(omittedUpdate=true,null):d.decode(e.wire.delta);if(update&&decoded){lastUpdate=decoded.units.find(u=>u.id===enemy.entityId);test(Math.abs(lastUpdate.pos[0]-enemy.pos.x)<.011,'途中更新欠落に依存せず基準から位置復元');}
          if(n===0)initialEpoch=e.snapshot.units[i].visibilityEpoch;
          if(!update&&!skippedShot){const shot={id:100000+n,type:'shot',data:{unit:enemy.entityId,seq:n}};test(h.eventsForPeer(p,[shot]).length===1,'4回間引き中の初射撃通知を落とさない');skippedShot=true;}
          rows.push({frame:full.frame,allyUpdate:!!(e.snapshot.unitUpdates&(1<<j)),enemyUpdate:update,mask:e.snapshot.unitUpdates});raw.push({peer:p.id,stage:'cadence',baseline:e.baseline,wire:e.wire,decoded});
        }
        const steady=rows.slice(1);test(steady.filter(r=>r.allyUpdate).length===4,'120m味方を8写真中4回更新');test(steady.filter(r=>r.enemyUpdate).length===2,'400m敵を8写真中2回更新');test(skippedShot,'間引き中の初射撃caseを実際に通過');test(omittedUpdate&&!!lastUpdate,'途中の更新写真を実際に捨てて次更新を復元');
        enemy.cloak=true;enemy.vis=.01;game.state.frame++;const hidden=h.encodePeerSnapshot(p,game.snapshot(100500));test(hidden.snapshot.units.find(u=>u.id===enemy.entityId)?.hidden,'hidden判定は4回の送信順を待たない');
        test(!hidden.baseline,'hideは新基準を発行せず通常delta');
        const hiddenDecoded=d.decode(hidden.wire.delta),scrub=hiddenDecoded.units.find(u=>u.id===enemy.entityId);
        test(scrub.hidden&&scrub.pos.every(n=>n===0)&&scrub.vel.every(n=>n===0),'可視値を含む旧基準からもhiddenの0位置を独立復元');
        // hide差分を受信しなかった場合も、revealは同じ基準から新epochへ進む。
        enemy.cloak=false;enemy.pos.x+=80;game.state.frame++;const reveal=h.encodePeerSnapshot(p,game.snapshot(100550));
        test(!reveal.baseline&&reveal.wire.delta[1]===hidden.wire.delta[1],'hide写真欠落後のrevealも同一基準の通常deltaで復元');
        const restored=d.decode(reveal.wire.delta),v=restored.units.find(u=>u.id===enemy.entityId),index=restored.units.indexOf(v);
        test(v.visibilityEpoch>initialEpoch&&!!(restored.unitUpdates&(1<<index))&&Math.abs(v.pos[0]-enemy.pos.x)<.011,'revealのepoch/位置を強制更新');
        raw.push({peer:p.id,stage:'hidden-dropped',baseline:hidden.baseline,wire:hidden.wire},{peer:p.id,stage:'reveal',baseline:reveal.baseline,wire:reveal.wire,decoded:restored,rows});
        own.yaw=restore.ownYaw;ally.pos.fromArray(restore.allyPos);enemy.pos.fromArray(restore.enemyPos);enemy.target=restore.target;enemy.controlTarget=restore.controlTarget;
      }
      return {checks,raw,hiddenBaselineHold};
    }catch(e){return {checks,raw,hiddenBaselineHold,failure:e.stack||e.message};}finally{window.__visibilityFixture=fixture;fixture();game.state.frame=frame;for(const [p,r]of saved)p.replication=r;}
  });
}
async function ledgerFunctional(host){
  return host.evaluate(()=>{
    const h=__visibilityTest,game=CBOnlineGame,checks=[],raw=[],originalNow=Object.getOwnPropertyDescriptor(performance,'now');
    const test=(v,name,data)=>{checks.push({value:!!v,name});if(!v)throw Error(name+'\n'+JSON.stringify(data));};
    try{
      for(const p of game.state.peers.values()){
        const r=h.replicationFor(p),entry=[...r.sent].at(-1);test(!!entry,'成功送信peerに個別sample台帳がある');
        const [frame,anchor]=entry,id=[...anchor.updates.keys()].find(id=>id!==p.unitId)||p.unitId,stamp=anchor.updates.get(id),time=anchor.time+80;
        Object.defineProperty(performance,'now',{configurable:true,value:()=>time});
        const row=[CBOnlineVisibility.unitNumber(id),frame,frame,anchor.time,stamp.epoch],input={sentAt:time,receivedAt:time,view:{frame,time:anchor.time,delayMs:100,units:[row]}};
        const valid=h.verifiedPeerUnitTimes(p,input,{time:time-100});raw.push({peer:p.id,frame,id,stamp,anchorTime:anchor.time,accepted:valid?[...valid]:null});
        test(valid?.has(id),'実送信sampleとepochで個別機体時刻を受理');
        test([...valid.values()].every(t=>time-t<=200.1),'個別の低頻度表示時刻も200ms上限内');
        for(const [name,tuple]of [['未送信sample',[row[0],frame+999,frame+999,row[3],row[4]]],['旧epoch',[row[0],frame,frame,row[3],row[4]+1]],['未来表示',[row[0],frame,frame,time+1000,row[4]]]]){
          const bad={...input,view:{...input.view,units:[tuple]}};test(h.verifiedPeerUnitTimes(p,bad,{time:time-100})===null,name+'を個別巻戻しに使わない');
        }
        const opponent=[...game.state.peers.values()].find(q=>q.unitId[0]!==p.unitId[0]);
        if(opponent)test(h.verifiedPeerUnitTimes(opponent,input,{time:time-100})===null,'別peerだけへ見せた機体stampを拒否');
        test(h.verifiedPeerUnitTimes(p,{...input,view:{...input.view,frame:frame+999}},{time:time-100})===null,'未送信anchorを拒否');
        const count=r.sent.size;h.rememberPeerSnapshot('invalid-peer',{frame,delta:[1,anchor.baseId,'']});test(r.sent.size===count,'不正peerの送信完了を他peer台帳へ混ぜない');
        // snapshot()を採るだけでは「送信済み」を作らない。
        const before=[...r.sent.keys()];game.snapshot();test(JSON.stringify(before)===JSON.stringify([...r.sent.keys()]),'全体snapshot観測だけでは送信済みsampleを追加しない');
      }
      return {checks,raw};
    }catch(e){return {checks,raw,failure:e.stack||e.message};}finally{if(originalNow)Object.defineProperty(performance,'now',originalNow);else delete performance.now;}
  });
}
async function applyFunctional(guest,full,hiddenBaselineHold){
  return guest.evaluate(({full,hiddenBaselineHold})=>{
    const g=__g,h=__visibilityTest,game=CBOnlineGame,checks=[],raw=[];
    const test=(v,name,data)=>{checks.push({value:!!v,name});if(!v)throw Error(name+'\n'+JSON.stringify(data));};
    const clone=x=>JSON.parse(JSON.stringify(x)),same=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<.001);
    try{
      const sequence=hiddenBaselineHold.find(row=>row.unitId===game.state.localUnitId),remote=g.units.find(u=>u.entityId===sequence?.target);
      test(!!sequence&&!!remote,'実hostが作った自peer用hidden基準→reveal→保持を使用');
      const decode=wire=>{const d=new CBOnlineCodec.Decoder();if(!d.seed(sequence.baseline))throw Error('初回hidden基準のseed失敗');return d.decode(wire.delta);};
      const initial=decode(sequence.initial);h.applySnapshot(initial);test(remote.onlineHidden&&!h.remoteHistory().has(remote.entityId),'初回hidden基準を実guestへ適用して履歴なし');
      const reveal=decode(sequence.reveal);h.applySnapshot(reveal);h.interpolatePeerUnits(reveal.time);
      test(!remote.onlineHidden&&remote.group.visible,'初回hiddenからreveal差分で実guestが出現');
      let held=0;
      for(const packet of sequence.packets){
        const next=decode(packet.wire),index=next.units.findIndex(u=>u.id===remote.entityId),value=next.units[index],before=h.remoteHistory().get(remote.entityId),position=remote.pos.toArray(),stamp=before.stamp.slice(),samples=before.samples.map(s=>s.frame);
        h.applySnapshot(next);h.interpolatePeerUnits(next.time);
        if(!(next.unitUpdates&(1<<index))){held++;
          test(!value.hidden&&value.visibilityEpoch===remote.onlineVisibilityEpoch&&!remote.onlineHidden&&remote.group.visible,'初回hidden基準の保持差分で実guestを誤hideしない');
          const after=h.remoteHistory().get(remote.entityId);test(same(remote.pos.toArray(),position)&&JSON.stringify(after.samples.map(s=>s.frame))===JSON.stringify(samples),'保持差分で出現済み位置/補間履歴を維持');
          test(after.stamp[1]===stamp[1]&&after.stamp[2]===stamp[2],'保持差分を新しい機体sampleへ昇格しない');
        }
        raw.push({stage:'hidden-base-reveal-hold',wire:packet.wire,decoded:next});
      }
      test(held>=3,'実guestで初回hidden基準からの遠方保持を3回以上適用');
      let s=clone(game.state.lastSnapshot),target=g.units.find(u=>u.team!==g.player.team),value=clone(full.units.find(u=>u.id===target.entityId));
      value=h.fixedUnitForPeer(value,false,10);Object.assign(value,{cloak:false,vis:1,visibilityEpoch:10,pos:[g.player.pos.x,g.player.pos.y,g.player.pos.z-20],vel:[0,0,0]});
      s.units[s.units.findIndex(u=>u.id===value.id)]=value;s.unitUpdates=(1<<s.units.length)-1;s.frame+=10;s.time+=500;h.applySnapshot(s);
      test(!target.onlineHidden&&target.group.visible&&same(target.pos.toArray(),value.pos),'再可視化を即時適用');
      const old=target.pos.toArray(),index=s.units.findIndex(u=>u.id===target.entityId),lastStamp=h.remoteHistory().get(target.entityId).stamp.slice();
      s=clone(s);s.frame++;s.time+=50;s.units[index].pos[0]+=40;s.unitUpdates&=~(1<<index);h.applySnapshot(s);h.interpolatePeerUnits(s.time);
      test(!target.onlineHidden&&same(target.pos.toArray(),old),'遠方省略bitをhiddenと扱わず最新受信位置を保持');
      test(h.remoteHistory().get(target.entityId).stamp[1]===lastStamp[1]&&h.remoteHistory().get(target.entityId).stamp[2]===lastStamp[2],'省略frameを架空の機体sample番号へ昇格しない');
      // hide写真自体を落としても新epochを受ければ、旧位置との補間を行わない。
      s=clone(s);s.frame++;s.time+=50;s.unitUpdates|=1<<index;s.units[index].visibilityEpoch++;h.applySnapshot(s);h.interpolatePeerUnits(s.time-90);
      test(target.onlineVisibilityEpoch===11&&same(target.pos.toArray(),s.units[index].pos),'hide欠落後も新visibilityEpochで即snap');
      test(h.remoteHistory().get(target.entityId).samples.length===1,'reveal前の補間履歴を残さない');
      const visiblePos=target.pos.toArray();target.boostVoice={ended:true};target.boostAudioRetry=1;g.lock.target=target;g.spotted[g.player.team].set(target,10);
      s=clone(s);s.frame++;s.time+=50;s.units[index]={...s.units[index],hidden:true,pos:[98765,87654,76543],vel:[456,567,678]};s.unitUpdates&=~(1<<index);s.spotted={B:[],R:[]};h.applySnapshot(s);raw.push({stage:'hidden',state:s});
      test(target.onlineHidden&&!target.group.visible&&!h.remoteHistory().has(target.entityId),'不可視化で描画と機体履歴を即破棄');
      test(same(target.pos.toArray(),visiblePos),'hidden印が立てば更新bit0・旧基準の位置があっても空間値を適用しない');
      test(g.lock.target!==target,'不可視化でlockを解除');
      test(target.boostVoice===null&&target.boostAudioRetry===0,'不可視化で移動音源参照と再試行待ちを消去');
      test(!g.spotted[g.player.team].has(target),'不可視化で索敵マーカー源を除去');
      g.tagsHud(g.player,.05);g.spottedHud(g.player);g.weaponLook(target,.05);
      test(!target.group.visible&&target.tagEl?.style.display==='none','描画更新・頭上タグでhidden機体を復活させない');
      const from=new g.T.Vector3(visiblePos[0],visiblePos[1]+2,visiblePos[2]+20),to=new g.T.Vector3(0,0,-1);
      const hit=g.castFrom(from,to,g.player,25);test(hit?.ref!==target,'hidden機体を現在raycastから除外');
      const marks=[],ctx=new Proxy({measureText:()=>({width:1})},{get:(o,k)=>k in o?o[k]:(...args)=>{if(['arc','moveTo','lineTo'].includes(k))marks.push({kind:k,args});},set:(o,k,v)=>(o[k]=v,true)});
      g.drawMapOn(ctx,400,400,document.createElement('canvas'),1,false);
      const xy=[(visiblePos[0]+g.MAP_X)/(g.MAP_X*2)*400,(visiblePos[2]+g.MAP_Z)/(g.MAP_Z*2)*400];
      test(!marks.some(m=>m.kind==='arc'&&Math.abs(m.args[0]-xy[0])<.01&&Math.abs(m.args[1]-xy[1])<.01),'hidden機体を地図の位置マーカーから除外');
      test(JSON.stringify([g.cores.B.hp,g.cores.R.hp])===JSON.stringify([s.cores.B,s.cores.R])&&g.timeLeft===s.timeLeft,'hide処理でCORE/timeを改変しない');
      return {checks,raw,stamp:lastStamp,mapMarks:marks};
    }catch(e){return {checks,raw,failure:e.stack||e.message};}
  },{full,hiddenBaselineHold});
}
async function actualWirePhases(active,report){
  const {sleep}=require('./online_test_helpers');
  const {host,guests}=active;
  for(const phase of ['normal','periodic-base','schema','resync','events','final']){
    await host.evaluate(phase=>{
      const game=CBOnlineGame,h=__visibilityTest;__visibilityProbe.phase=phase;game.state.frame++;
      const full=game.snapshot();full.time+=phase==='periodic-base'?10001:phase==='schema'?10051:0;
      for(const p of game.state.peers.values()){
        if(phase==='resync'){p.lastResync=-Infinity;h.handleSnapshotControl('snapshotResync',{},p.id);continue;}
        if(phase==='final'){game.state.transport.send('matchEnded',h.matchResult(),p.id);continue;}
        if(phase==='events'){
          const own=__g.units.find(u=>u.entityId===p.unitId),enemy=__g.units.find(u=>u.team!==own.team),r=h.replicationFor(p);
          const ev=[{id:98000+own.idx,type:'shot',data:{unit:own.entityId,seq:1}},{id:99000+own.idx,type:'sfx',data:{unit:enemy.entityId,at:enemy.pos.toArray(),name:'rifle'}}];
          for(const e of ev)r.eventCache.set(e.id,e);const filtered=h.eventsForPeer(p,ev);if(filtered.length)game.state.transport.send('events',filtered,p.id);continue;
        }
        if(phase==='schema')full.codecFixture={version:17};
        const e=h.encodePeerSnapshot(p,full);if(e.baseline)game.state.transport.send('snapshotBase',e.baseline,p.id);game.state.transport.send('snapshot',e.wire,p.id);
      }
    },phase);
    await sleep(120);
  }
  report.wire=await host.evaluate(()=>__visibilityProbe);
  report.guestFinal=await Promise.all(guests.map(p=>p.evaluate(()=>({peerId:CBOnlineGame.state.transport.peer.id,unitId:CBOnlineGame.state.localUnitId,finished:CBOnlineGame.state.matchesFinished||0,phase:CBOnlineGame.state.phase,
    hidden:__g.units.filter(u=>u.onlineHidden).map(u=>u.entityId),units:__g.units.map(u=>({id:u.entityId,team:u.team,hidden:!!u.onlineHidden,pos:u.pos.toArray(),sc:u.sc})),lastSnapshot:CBOnlineGame.state.lastSnapshot}))));
}
function verifyWire(report,ok){
  const records=report.wire.decoded,final=report.guestFinal;
  ok(report.wire.errors.length===0,'実送信wireをpeer別に独立復号');
  for(const guest of final){
    const team=guest.units.find(u=>u.id===guest.unitId).team,allowed=guest.units.filter(u=>u.team===team).map(u=>u.id),rows=records.filter(r=>r.peerId===guest.peerId);
    for(const phase of ['initial','normal','periodic-base','schema','resync'])ok(rows.some(r=>r.phase===phase),'実wireに'+phase+'を観測');
    ok(rows.every(r=>r.state.units.length===guest.units.length&&r.state.units.every(u=>allowed.includes(u.id)?!u.hidden:u.hidden&&u.pos.every(n=>n===0)&&u.vel.every(n=>n===0))),'全初期/基準/差分/再同期wireで固定秘匿枠を中立化');
    ok(rows.every(r=>Object.keys(r.state.inputAcks||{}).every(id=>id===guest.unitId)),'全実wireのinputAckを自機へ制限');
    const sent=report.wire.wire.filter(r=>r.peerId===guest.peerId);
    ok(sent.some(r=>r.envelope.type==='events')&&sent.filter(r=>r.envelope.type==='events').every(r=>r.envelope.payload.every(e=>!e.data.unit||allowed.includes(e.data.unit))),'実events線で秘匿敵sourceを遮断');
    const result=sent.find(r=>r.envelope.type==='matchEnded')?.envelope.payload;
    ok(result&&result.units.length===guest.units.length&&result.units.every(u=>!Object.hasOwn(u,'pos')),'実終了結果は公開scoreだけ');
    ok((guest.phase==='ended'||guest.phase==='lobby'&&guest.finished>0)&&guest.units.every(u=>u.team===team||u.hidden),'終了受信後も秘匿敵を復元しない');
  }
}
const pure=pureChecks();
if(process.argv.includes('--node-only')){
  const out=path.resolve(process.argv[3]||'/tmp/online-visibility');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-visibility-node.json'),JSON.stringify(pure,null,2));
  for(const c of pure.checks)console.log((c.value?'成功: ':'失敗: ')+c.name);
  if(pure.failure){console.error(JSON.stringify(pure.observations));process.exitCode=1;}else console.log('visibility Node: '+pure.checks.length+'項目成功、latest5入力 '+pure.inputBatch.bytes+' bytes');
}else{
  const {check}=require('./lib');
  const {harness,room,MOCK_TRANSPORT,TRANSPORT_MODE}=require('./online_test_helpers');
  check('ゲスト別秘匿と送信優先度',async({browser,dir,out,ok,errors})=>{
    const report={createdAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode:TRANSPORT_MODE,usesRealWebRTC:!MOCK_TRANSPORT,productionNetworkPerformanceVerified:false,
      beforeFile,method:'機能試験は成功sendのraw wireを独立復号。サイズは同一決定fixtureを旧全体snapshot/OFFと本体privacy+priority/ONへ通した見積り。実時間throughputではない。',
      directViewLimit:'通常敵の直接視認例外はhost固定の縦100度・32:9外接円をscope倍率で縮小しLOSを必須にする。実client画面より広い領域を許す保守的範囲で、最小実画角と同一ではない。clientの画角申告は使わず、迷彩noticed hard gateは迂回しない。',pure,functional:null,application:[],size:[],errors};
    let active,h;
    const save=()=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-visibility.json'),JSON.stringify(report,null,2));};
    try{
      for(const c of pure.checks)ok(c.value,c.name);
      h=await harness(dir);instrument(dir);
      if(!process.argv.includes('--size-only')){
        active=await room(browser,h,errors,{guests:3,teamSize:5,beforeStart:async(host,guests)=>{
          report.lobby=await lobbyRegression(host,guests);save();for(const c of report.lobby.checks)ok(c.value,c.name);await installProbe(host,guests);
        }});
        report.ledger=await ledgerFunctional(active.host);save();for(const c of report.ledger.checks)ok(c.value,c.name);ok(!report.ledger.failure,report.ledger.failure||'実送信台帳の境界を検証');
        report.functional=await privacyFunctional(active.host);save();
        for(const c of report.functional.checks)ok(c.value,c.name);ok(!report.functional.failure,report.functional.failure||'機能境界を検証');
        report.priority=await priorityFunctional(active.host);save();for(const c of report.priority.checks)ok(c.value,c.name);ok(!report.priority.failure,report.priority.failure||'2/4回間引きを検証');
        const full=await active.host.evaluate(()=>CBOnlineGame.snapshot());
        for(const guest of active.guests){const result=await applyFunctional(guest,full,report.priority.hiddenBaselineHold);report.application.push(result);save();for(const c of result.checks)ok(c.value,c.name);ok(!result.failure,result.failure||'guest表示を検証');}
        await actualWirePhases(active,report);save();verifyWire(report,ok);await active.close();active=null;
      }
      if(!process.argv.includes('--functional-only'))for(const teamSize of teamSizes){
        active=await room(browser,h,errors,{guests:1,teamSize,beforeStart:async(host,guests)=>{await guests[0].evaluate(()=>CBOnlineGame.chooseTeam('R'));}});
        const result=await active.host.evaluate(visibilitySizeFixture);report.size.push(result);save();ok(!result.failure,result.failure||'サイズfixtureを最後まで採取');
        ok(result.units===teamSize*2&&result.peers.length===1,'同じ'+result.units+'機を両codecへ通したguest一人分を記録');
        for(const p of result.peers){
          ok(p.unitId==='R:0','前版比較と同じR:0のguestを測定');
          ok(p.rows.every(row=>row.messages.every(m=>m.logicalBytes<=262144&&m.maximumDatagramBytes<=16384)),'全fixture写真が論理256KiB/fragment16KiB上限内');
          for(const s of p.phases)ok(s.totalBytes===s.snapshotBytes+s.baselineBytes+s.eventBytes,'type別送信量合計を検算: '+result.units+'機/'+s.phase+'/'+s.mode);
          ok(p.phases.find(s=>s.mode==='on'&&s.phase==='visibility-change').baselineSizes.count===0,'25枚の見え隠れは基準0回で通常差分だけを送信');
        }
        if(beforeReport){const previous=beforeReport.size.find(s=>s.units===result.units);ok(!!previous,'同機数の前版サイズ結果がある');ok(JSON.stringify(previous.trace)===JSON.stringify(result.trace),'前後の245枚の位置/迷彩/イベント軌跡が完全一致');
          const comparisons=result.peers.flatMap(p=>{const before=previous.peers.find(v=>v.unitId===p.unitId);ok(!!before,'前後でguestの陣営とunitIdが一致');return p.phases.filter(s=>s.mode==='on').map(after=>{const earlier=before.phases.find(s=>s.mode==='on'&&s.phase===after.phase);return {units:result.units,unitId:p.unitId,phase:after.phase,frames:after.frames,fixtureSeconds:after.fixtureSeconds,
            before:{baselineCount:earlier.baselineSizes.count,snapshotBytes:earlier.snapshotBytes,baselineBytes:earlier.baselineBytes,eventBytes:earlier.eventBytes,fragmentBase64ExpansionBytes:earlier.fragmentBase64ExpansionBytes,fragmentEnvelopeBytes:earlier.fragmentEnvelopeBytes,totalBytes:earlier.totalBytes,estimatedKBpsAt20Hz:earlier.estimatedKBpsAt20Hz},
            after:{baselineCount:after.baselineSizes.count,snapshotBytes:after.snapshotBytes,baselineBytes:after.baselineBytes,eventBytes:after.eventBytes,fragmentBase64ExpansionBytes:after.fragmentBase64ExpansionBytes,fragmentEnvelopeBytes:after.fragmentEnvelopeBytes,totalBytes:after.totalBytes,estimatedKBpsAt20Hz:after.estimatedKBpsAt20Hz},
            totalChangeBytes:after.totalBytes-earlier.totalBytes,totalChangePercent:100*(after.totalBytes/earlier.totalBytes-1)};});});
          (report.fixedSlotComparison||=[]).push(...comparisons);save();
        }
        console.log('帯域fixture '+JSON.stringify(result.peers.map(p=>({units:result.units,peer:p.unitId,changes:p.changes,phases:p.phases}))));
        await active.close();active=null;
      }
    }catch(e){report.failure=e.stack||e.message;throw e;}finally{
      if(active){try{if(!report.wire)report.wire=await active.host.evaluate(()=>window.__visibilityProbe||null);}catch(_){}await active.close();}
      if(h)await h.close();save();console.log('観測ファイル: '+path.join(out,'online-visibility.json'));
    }
  },{page:false});
}
