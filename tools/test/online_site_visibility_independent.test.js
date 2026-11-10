'use strict';
// Independent reviewer harness. Actual game filtering/codec, transport ingress,
// fragmentation, cancellation, and resync are exercised. World sight and render
// application are fixtures, and no real PeerJS/WebRTC connection is established.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const root=path.resolve(process.env.CB_REVIEW_SOURCE||path.join(__dirname,'../../prototype'));
const source=fs.readFileSync(path.join(root,'online/game.js'),'utf8');
const Codec=require(path.join(root,'online/codec.js')),Transport=require(path.join(root,'online/transport.js'));
const clone=v=>JSON.parse(JSON.stringify(v));
function load(c,names){
  vm.createContext(c);
  for(const name of names){
    const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  function ',start+1);
    assert(start>=0,name);vm.runInContext(source.slice(start,end<0?source.length:end),c,{filename:name});
  }
  return c;
}
function conn(id){return Object.assign(new EventEmitter(),{peer:id,label:'core-breaker-control-v9',open:true,bufferSize:0,dataChannel:{bufferedAmount:0},send(){},close(){}});}
function fixture(t,count=4){
  let stateSnapshot,clock=5000,shown=new Set(),cadence=1;
  const hosts=[],guests=[],applied=[];
  const world=Array.from({length:count},(_,i)=>({entityId:(i%2?'R:':'B:')+Math.floor(i/2),team:i%2?'R':'B'}));
  const peer={id:'guest',unitId:'B:0'};
  let hc,gc;
  const host=new Transport({appVersion:'review-v23',onSnapshotSent:(id,p)=>hc.rememberPeerSnapshot(id,p),onMessage:(type,p,id)=>hc.handleSnapshotControl(type,p,id)});
  const guest=new Transport({appVersion:'review-v23',onMessage:(type,p)=>type==='snapshot'?gc.receiveSnapshot(p):gc.handleSnapshotControl(type,p,'host')});
  for(const [tr,role]of [[host,'host'],[guest,'guest']]){
    clearInterval(tr._tickTimer);t.after(()=>clearInterval(tr._tickTimer));
    Object.assign(tr,{role,peer:{id:role},roomId:'host',matchId:'match-1',started:true});
  }
  const hl=host._attach(conn('guest')),gl=guest._attach(conn('host'));
  for(const l of [hl,gl])Object.assign(l,{ready:true,approved:true,snapshotConn:conn(l.conn.peer)});
  hl.snapshotConn.send=s=>hosts.push(JSON.parse(s));gl.conn.send=s=>guests.push(JSON.parse(s));
  hc=load({Map,Set,CBOnlineCodec:Codec,SLOTS:['main','sub','aux','sp'],visibilitySupport:{},requireVisibilitySupport(){},unit:id=>world.find(u=>u.entityId===id),
    createPeerView:()=>({viewer:world[0],visible:shown,cadence:new Map(world.map(u=>[u.entityId,cadence])),gadgetVisible:()=>false,sourceVisible:()=>false,pointVisible:()=>false}),
    gadgetSlotsForPeer:()=>[[1]],equipmentObjectsForPeer:()=>[],equipmentUnitForPeer:v=>v.equipment,radars:[],shells:[],now:()=>clock,snapshot:()=>clone(stateSnapshot),
    state:{role:'host',phase:'playing',matchId:'match-1',peers:new Map([['guest',peer]]),transport:host}},
    ['replicationFor','fixedUnitForPeer','snapshotForPeer','encodePeerSnapshot','rememberPeerSnapshot','handleSnapshotControl']);
  for(const name of ['equipmentScalars','scalarKeys','slotKeys','remoteSlotKeys'])vm.runInContext(source.match(new RegExp('^  const '+name+' ?=.*$','m'))[0],hc);
  gc=load({Map,Set,CLASSES:{assault:{},heavy:{},raid:{},support:{}},state:{role:'guest',phase:'playing',matchId:'match-1',localUnitId:'B:0',transport:guest,history:[],pendingInputs:new Map()},
    finalFrame:null,prepared:true,pendingPrepare:null,lastSnapshotBaseId:0,snapshotDecoder:new Codec.Decoder(),pendingSnapshotWires:new Map(),pendingSnapshotBases:new Map(),lastResync:-Infinity,resyncBackoff:250,
    now:()=>clock,diagnosticArrival(){},capturePredictionView(){},reconcilePrediction(){},applySnapshot:s=>applied.push(clone(s)),clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),
    interpolation:{staleSnapshots:0,missingBaselines:0,resyncRequests:0,lastArrival:null,acceptedSnapshots:0,localOffset:null,intervalMs:50,jitterMs:0,targetDelayMs:60,renderTime:null}},
    ['validPeerSnapshot','requestSnapshotResync','seedSnapshotBase','retryPendingSnapshots','handleSnapshotControl','receiveSnapshot']);
  function encode(frame,{time=frame*50,hidden=[],secret=1,padding=0,force=false,period=1}={}){
    shown=new Set(world.map(u=>u.entityId).filter(id=>!hidden.includes(id)));cadence=period;
    stateSnapshot={frame,time,publicPadding:'x'.repeat(padding),units:world.map((u,i)=>({id:u.entityId,team:u.team,idx:i,name:'Public pilot '+i,cls:'assault',sc:{kills:0},
      controller:'remoteHuman',lifeId:1,alive:true,hp:100+i,pos:[100*i+secret,secret*2,secret*3],vel:[secret,0,secret],mech:{head:'private-'+secret},equipment:{target:'private-'+secret},
      swing:{secret},transfer:{base:secret},healTarget:'private-'+secret,catLaunch:{secret},motionVectors:{dashDir:[secret,0,0]},
      slots:Object.fromEntries(['main','sub','aux','sp'].map(k=>[k,{key:'private-weapon-'+secret,ammo:secret,scanRadius:secret}]))})),
      radars:[],shells:[],spotted:{B:[],R:[]},spotSrc:{B:[],R:[]},acks:{'B:0':0}};
    // Keep all visible facts identical when testing noninterference.
    for(const u of stateSnapshot.units)if(!hidden.includes(u.id))Object.assign(u,{pos:[1,2,3],vel:[0,0,0],mech:{head:'public'},equipment:null,swing:null,transfer:null,healTarget:null,catLaunch:null,motionVectors:{},slots:{}});
    return hc.encodePeerSnapshot(peer,clone(stateSnapshot),false,force);
  }
  function queue(result){if(result.baseline)assert(host.send('snapshotBase',result.baseline,'guest'));assert(host.send('snapshot',result.wire,'guest'));return result;}
  function flush(){host._flushSnapshots(hl,Math.max(0,...hl.snapshots.map(i=>i.due)));return hosts.splice(0);}
  function deliver(packets){for(const packet of packets)guest._receive(gl,JSON.stringify(packet),'snapshot');assert(!gl.closing&&guest.links.get('host')===gl,'valid wire should not close connection');}
  function send(frame,opts){const result=queue(encode(frame,opts));deliver(flush());return result;}
  function repair(){
    while(gl.queue.length)guest._write(gl,gl.queue.shift(),gl.conn);
    for(const packet of guests.splice(0))host._receive(hl,JSON.stringify(packet),'control');
    return flush();
  }
  function hiddenState(frame,hidden=['R:0']){
    assert.equal(gc.state.lastSnapshot.frame,frame);
    for(const id of hidden){const u=gc.state.lastSnapshot.units.find(u=>u.id===id);assert(u.hidden);assert.deepEqual(clone(u.pos),[0,0,0]);assert.deepEqual(clone(u.vel),[0,0,0]);
      for(const k of ['mech','equipment','swing','transfer','hp','lifeId'])assert.equal(u[k],null,k);assert.equal(u.slots.main.key,'');}
  }
  function decode(result){const decoder=new Codec.Decoder();assert(result.baseline);assert(!result.baseline.parent);assert(decoder.seed(result.baseline));return decoder.decode(result.wire.delta);}
  return {host,guest,hl,gl,hc,gc,peer,world,encode,queue,flush,deliver,send,repair,hiddenState,decode,applied,setClock:v=>clock=v};
}

test('independent: replacing a pending base neutralizes changing hidden coordinates, loadout and actions',t=>{
  const outputs=[];
  for(const secret of [7,712345,9283746]){
    const h=fixture(t);h.send(1);h.queue(h.encode(2,{time:10051}));
    const r=h.queue(h.encode(3,{time:10052,hidden:['R:0','R:1'],secret}));
    const s=h.decode(r);assert.equal(s.unitUpdates,15);assert.equal(s.units.find(u=>u.id==='R:1').equipment,null);
    outputs.push(JSON.stringify(r));h.deliver(h.flush());h.hiddenState(3,['R:0','R:1']);assert.equal(h.gc.interpolation.resyncRequests,0);
  }
  assert.equal(outputs[0],outputs[1]);assert.equal(outputs[1],outputs[2]);
});

test('independent: full 20-unit hide baseline has every update bit and neutral secret slots',t=>{
  const h=fixture(t,20),hidden=h.world.filter(u=>u.team==='R').map(u=>u.entityId);
  h.send(1);h.queue(h.encode(2,{time:10051}));const r=h.queue(h.encode(3,{time:10052,hidden,period:10000}));
  assert.equal(h.decode(r).unitUpdates,2**20-1);const p=h.flush();assert(p.some(p=>p.type==='snapshotChunk'));h.deliver(p);h.hiddenState(3,hidden);assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('independent: each missing replacement-baseline chunk recovers through actual ingress and resync',t=>{
  const probe=fixture(t);probe.send(1);probe.queue(probe.encode(2,{time:10051,padding:34000}));probe.queue(probe.encode(3,{time:10052,padding:34000,hidden:['R:0']}));
  const count=probe.flush().filter(p=>p.type==='snapshotChunk'&&p.payload.type==='snapshotBase').length;assert(count>=5);t.diagnostic(`Exercised loss of each of ${count} baseline chunks separately`);
  for(let lost=0;lost<count;lost++){
    const h=fixture(t);h.send(1);h.queue(h.encode(2,{time:10051,padding:34000}));h.queue(h.encode(3,{time:10052,padding:34000,hidden:['R:0']}));
    h.deliver(h.flush().filter(p=>!(p.type==='snapshotChunk'&&p.payload.type==='snapshotBase'&&p.payload.index===lost)));
    assert.equal(h.gc.state.lastSnapshot.frame,1);assert.equal(h.gc.interpolation.resyncRequests,1);
    h.deliver(h.repair().reverse());h.hiddenState(3);assert.equal(h.gc.pendingSnapshotWires.size,0);assert.equal(h.gc.pendingSnapshotBases.size,0);
  }
});

test('independent: reverse and duplicate all replacement fragments, with delta first',t=>{
  const h=fixture(t);h.send(1);h.queue(h.encode(2,{time:10051,padding:45000}));h.queue(h.encode(3,{time:10052,padding:45000,hidden:['R:0']}));
  const packets=h.flush().reverse();h.deliver(packets.flatMap(p=>[p,p]));h.hiddenState(3);assert.equal(h.gc.interpolation.acceptedSnapshots,2);assert.equal(h.gc.pendingSnapshotWires.size,0);
});

test('independent: partial private baseline cannot complete from locally retained fragments after hide',t=>{
  const h=fixture(t);h.send(1);h.queue(h.encode(2,{time:10051,padding:45000,force:true}));
  const base=h.hl.snapshots.find(p=>p.type==='snapshotBase'),oldPackets=base.packets.map(p=>JSON.parse(p.text));
  h.hl.snapshotConn.dataChannel.bufferedAmount=262144-base.packets[0].bytes;
  const sent=h.flush();assert.equal(sent.filter(p=>p.type==='snapshotChunk').length,1);h.deliver(sent);
  h.queue(h.encode(3,{time:10052,padding:45000,hidden:['R:0']}));h.hl.snapshotConn.dataChannel.bufferedAmount=0;
  const current=h.flush();assert(!current.some(p=>p.type==='snapshotChunk'&&p.payload.type==='snapshotBase'&&p.payload.sequence===oldPackets[0].payload.sequence));
  h.deliver(current.reverse());h.hiddenState(3);
  // Even hypothetical late completion of all already-captured old chunks cannot restore its state.
  h.deliver(oldPackets.reverse());h.hiddenState(3);assert.equal(h.gc.pendingSnapshotBases.size,0);
});

test('independent: received replacement survives many stale old bases and snapshots',t=>{
  const h=fixture(t),old=[];h.send(1);
  for(let i=2;i<=8;i++){h.queue(h.encode(i,{time:10050*i,force:true}));old.push(...h.flush());}
  h.queue(h.encode(9,{time:100500,force:true}));h.queue(h.encode(10,{time:100501,hidden:['R:0']}));h.deliver(h.flush());h.hiddenState(10);
  h.deliver(old.reverse());h.hiddenState(10);assert(h.gc.snapshotDecoder.bases.has(h.gc.lastSnapshotBaseId));
  h.send(11,{time:100502,hidden:['R:0']});h.hiddenState(11);assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('independent: schema-driven pending base cancellation creates no parent chain',t=>{
  const h=fixture(t);h.send(1);const pending=h.queue(h.encode(2,{time:100,padding:3000}));
  // Change a public field type in the fixture to force a schema replacement before hide.
  const raw=h.hc.snapshot();raw.publicPadding={newShape:'public'};const shape=h.queue(h.hc.encodePeerSnapshot(h.peer,raw));assert(shape.baseline);assert(shape.baseline.parent);
  const hidden=h.queue(h.encode(3,{time:150,hidden:['R:0']}));h.decode(hidden);assert.notEqual(hidden.wire.delta[1],pending.wire.delta[1]);h.deliver(h.flush());h.hiddenState(3);
});

test('independent: unsent initial visible baseline is replaced before any guest decode',t=>{
  const h=fixture(t);h.queue(h.encode(1));const r=h.queue(h.encode(2,{hidden:['R:0']}));h.decode(r);h.deliver(h.flush());h.hiddenState(2);assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('independent: sent replacement base plus lost delta converges on next hidden delta',t=>{
  const h=fixture(t);h.send(1);h.queue(h.encode(2,{time:10051}));h.queue(h.encode(3,{time:10052,hidden:['R:0']}));
  h.deliver(h.flush().filter(p=>p.type==='snapshotBase'||p.type==='snapshotChunk'&&p.payload.type==='snapshotBase'));
  const next=h.send(4,{time:10053,hidden:['R:0']});assert.equal(next.baseline,null);h.hiddenState(4);assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('independent: ordinary transitions preserve one base across 120 frames and sparse cadence',t=>{
  const h=fixture(t),first=h.send(1);
  for(let i=2;i<=120;i++){const hidden=i%2?[]:['R:0'],r=h.send(i,{hidden,period:13});assert.equal(r.baseline,null);assert.equal(r.wire.delta[1],first.wire.delta[1]);if(hidden.length)h.hiddenState(i);}
  assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('independent: v23 lobby/start transition rejects previous-match replacement fragments',t=>{
  const h=fixture(t);h.send(1);h.queue(h.encode(2,{time:10051,padding:34000}));h.queue(h.encode(3,{time:10052,padding:34000,hidden:['R:0']}));const old=h.flush();
  assert(h.host.returnToLobby());assert(h.guest.returnToLobby());assert.equal(h.host.startMatch('match-2'),'match-2');
  const match=h.hl.queue.find(p=>p.type==='match');assert(match);h.guest._receive(h.gl,match.text,'control');assert.equal(h.guest.matchId,'match-2');
  const accepted=h.gc.interpolation.acceptedSnapshots;h.deliver(old);assert.equal(h.gc.interpolation.acceptedSnapshots,accepted);assert.equal(h.gl.assemblies.size,0);assert(!h.gl.closing);
});

test('independent: v23 terminal exit stays terminal with replacement baseline queued',t=>{
  const h=fixture(t);h.send(1);h.queue(h.encode(2,{time:10051}));h.queue(h.encode(3,{time:10052,hidden:['R:0']}));const old=h.flush();h.host.returnToLobby();
  const bye=h.host._envelope('bye',{reason:'ホストが退出しました',reconnect:false});h.guest._receive(h.gl,JSON.stringify(bye),'control');
  assert(h.gl.terminal);assert(!h.guest.links.has('host'));const before=h.gc.interpolation.acceptedSnapshots;
  for(const p of old)h.guest._receive(h.gl,JSON.stringify(p),'snapshot');assert.equal(h.gc.interpolation.acceptedSnapshots,before);
});
