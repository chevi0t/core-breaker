'use strict';
// Actual peer filtering, encoding, transport send/flush/reassembly and guest
// snapshot handlers. World visibility and rendering are deterministic fixtures.
// This does not claim browser, WebRTC, signaling, or real-network coverage.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const source=path.resolve(process.env.CB_VISIBILITY_SOURCE||path.join(__dirname,'../../prototype'));
const game=fs.readFileSync(path.join(source,'online/game.js'),'utf8');
const Codec=require(path.join(source,'online/codec.js'));
const Transport=require(path.join(source,'online/transport.js'));
const copy=x=>JSON.parse(JSON.stringify(x));
function extract(name){
  const start=game.indexOf('  function '+name+'(');
  assert(start>=0,name+' exists');
  const end=game.indexOf('\n  function ',start+1);
  return game.slice(start,end<0?game.length:end);
}
function context(values,names){
  const c=vm.createContext(values);
  for(const name of names)vm.runInContext(extract(name),c,{filename:'online/game.js:'+name});
  return c;
}
function connection(peer){
  const c=new EventEmitter();
  Object.assign(c,{peer,open:true,bufferSize:0,dataChannel:{bufferedAmount:0},send(){},close(){}});
  return c;
}
function harness(t){
  const hostPackets=[],guestPackets=[],applied=[];
  const host=new Transport({appVersion:'visibility-regression',onSnapshotSent:(id,payload)=>hc.rememberPeerSnapshot(id,payload)});
  const guest=new Transport({appVersion:'visibility-regression',onMessage:(type,data)=>{
    if(type==='snapshot')gc.receiveSnapshot(data);else gc.handleSnapshotControl(type,data,'host');
  }});
  for(const tr of [host,guest]){clearInterval(tr._tickTimer);t.after(()=>clearInterval(tr._tickTimer));tr.started=true;tr.matchId='match';tr.roomId='host';}
  Object.assign(host,{role:'host',peer:{id:'host'}});
  Object.assign(guest,{role:'guest',peer:{id:'guest'}});
  const hl=host._attach(connection('guest')),gl=guest._attach(connection('host'));
  for(const link of [hl,gl])Object.assign(link,{ready:true,approved:true,snapshotConn:connection(link.conn.peer)});
  hl.snapshotConn.send=text=>hostPackets.push(JSON.parse(Transport.wireText(text))); // 写真の差分はバイナリ（通信規格 v10）
  gl.conn.send=text=>guestPackets.push(JSON.parse(text));
  const peer={id:'guest',unitId:'B:0'},world=[{entityId:'B:0',team:'B'},{entityId:'R:0',team:'R'}];
  let full,clock=1000,visible=new Set(world.map(u=>u.entityId)),cadence=1,gadgetVisible=false,objectVisible=false;
  const view=()=>({viewer:world[0],visible,cadence:new Map(world.map(u=>[u.entityId,cadence])),sourceVisible:()=>true,pointVisible:()=>true,gadgetVisible:()=>gadgetVisible});
  const hc=context({CBOnlineCodec:Codec,Map,Set,state:{role:'host',phase:'playing',matchId:'match',peers:new Map([['guest',peer]]),transport:host},
    SLOTS:['main','sub','aux','sp'],requireVisibilitySupport(){},visibilitySupport:{},unit:id=>world.find(u=>u.entityId===id),createPeerView:view,
    gadgetSlotsForPeer:()=>gadgetVisible?[[0,73,'mine','R','secret-mine',[8731,54,8732]]]:[[1]],
    equipmentObjectsForPeer:()=>objectVisible?[{id:92,kind:'secret-object',pos:[9831,64,9832]}]:[],equipmentUnitForPeer:v=>v.equipment,
    radars:[],shells:[],snapshot:()=>copy(full),now:()=>clock},
    ['replicationFor','fixedUnitForPeer','snapshotForPeer','encodePeerSnapshot','rememberPeerSnapshot','handleSnapshotControl']);
  for(const name of ['equipmentScalars','scalarKeys','slotKeys','remoteSlotKeys']){
    const match=game.match(new RegExp('^  const '+name+' ?=.*$','m'));assert(match,name);vm.runInContext(match[0],hc);
  }
  const gc=context({Map,Set,state:{role:'guest',phase:'playing',localUnitId:'B:0',matchId:'match',transport:guest,history:[],pendingInputs:new Map()},
    finalFrame:null,prepared:true,pendingPrepare:null,lastSnapshotBaseId:0,snapshotDecoder:new Codec.Decoder(),pendingSnapshotWires:new Map(),pendingSnapshotBases:new Map(),lastResync:-Infinity,resyncBackoff:250,
    now:()=>clock,diagnosticArrival(){},capturePredictionView(){return null;},reconcilePrediction(){},applySnapshot:s=>applied.push(copy(s)),
    interpolation:{staleSnapshots:0,missingBaselines:0,resyncRequests:0,lastArrival:null,acceptedSnapshots:0,localOffset:null,intervalMs:50,jitterMs:0,targetDelayMs:60,renderTime:null},
    clamp:(v,a,b)=>Math.min(b,Math.max(a,v))},
    ['validPeerSnapshot','requestSnapshotResync','seedSnapshotBase','retryPendingSnapshots','handleSnapshotControl','receiveSnapshot']);
  function snapshot(frame,time=frame*50,hidden=false,opts={}){
    visible=new Set(hidden?['B:0']:['B:0','R:0']);gadgetVisible=!!opts.gadget;objectVisible=!!opts.object;cadence=opts.cadence||1;
    const unit=(id,team,pos)=>({id,team,idx:0,name:team+' pilot',sc:{kills:0},cls:'assault',controller:'remoteHuman',lifeId:1,alive:true,hp:100,
      pos,vel:[1,0,2],mech:{head:'secret-head'},equipment:{target:'secret-target'},motionVectors:{dashDir:[1,2,3]},
      slots:Object.fromEntries(['main','sub','aux','sp'].map(k=>[k,{key:'secret-weapon',ammo:30,scanRadius:80}]))});
    full={...(opts.padding?{publicPadding:'p'.repeat(opts.padding)}:{}),frame,time,units:[unit('B:0','B',[10,0,10]),unit('R:0','R',opts.enemyPos||[7654,23,7655])],radars:[],shells:[],spotted:{B:[],R:[]},spotSrc:{B:[],R:[]},acks:{'B:0':0}};
    return copy(full);
  }
  function encode(frame,time,hidden,opts={}){const s=snapshot(frame,time,hidden,opts);return hc.encodePeerSnapshot(peer,s,!!opts.forceAll,!!opts.forceBaseline);}
  function enqueue(result){if(result.baseline)assert(host.send('snapshotBase',result.baseline,'guest'));assert(host.send('snapshot',result.wire,'guest'));return result;}
  function flush(){const due=Math.max(0,...hl.snapshots.map(p=>p.due));host._flushSnapshots(hl,due);return hostPackets.splice(0);}
  function deliver(packets){for(const p of packets){if(p.type==='snapshotChunk')guest._receiveChunk(gl,p);else guest._deliverSnapshot(gl,p);}}
  function send(frame,time,hidden,opts){const result=enqueue(encode(frame,time,hidden,opts));deliver(flush());return result;}
  function serviceResync(){
    while(gl.queue.length)guest._write(gl,gl.queue.shift(),gl.conn);
    for(const p of guestPackets.splice(0))hc.handleSnapshotControl(p.type,p.payload,'guest');
  }
  function hidden(){
    const s=gc.state.lastSnapshot,u=s.units.find(u=>u.id==='R:0');assert(u.hidden);assert.deepEqual(copy(u.pos),[0,0,0]);assert.deepEqual(copy(u.vel),[0,0,0]);
    assert.equal(u.mech,null);assert.equal(u.equipment,null);assert.equal(u.slots.main.key,'');assert.equal(u.hp,null);
  }
  function standalone(result){assert(result.baseline,'transition produces a replacement baseline');assert.equal(result.baseline.parent,undefined,'no dropped parent dependency');const d=new Codec.Decoder();assert(d.seed(result.baseline));return d.decode(result.wire.delta);}
  function assertSafe(result){const s=standalone(result),u=s.units.find(u=>u.id==='R:0');assert(u.hidden);assert.deepEqual(copy(u.pos),[0,0,0]);assert.equal(u.mech,null);assert.equal(u.equipment,null);assert.equal(u.slots.main.key,'');
    const baseline=JSON.stringify(result.baseline);for(const secret of ['7654','7655','8731','9831'])assert(!baseline.includes(secret),'baseline excludes private '+secret);
    assert.deepEqual(copy(s.gadgets),[[1]]);assert.deepEqual(copy(s.equipmentObjects),[]);
  }
  return {host,guest,hl,gl,hc,gc,peer,hostPackets,applied,encode,enqueue,flush,deliver,send,serviceResync,hidden,standalone,assertSafe,setClock:v=>clock=v};
}

test('queued periodic baseline is replaced by an independent privacy-safe hide baseline',t=>{
  const h=harness(t);h.send(1,0,false,{gadget:true,object:true});
  const pending=h.enqueue(h.encode(3,10001,false,{gadget:true,object:true}));
  assert(pending.baseline);assert.deepEqual(h.hl.snapshots.map(p=>p.type),['snapshotBase','snapshot']);
  const changed=h.enqueue(h.encode(4,10002,true));h.assertSafe(changed);
  assert.notEqual(changed.wire.delta[1],pending.wire.delta[1]);assert.deepEqual(h.hl.snapshots.map(p=>p.type),['snapshotBase','snapshot']);
  h.deliver(h.flush());h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,4);assert.equal(h.gc.interpolation.missingBaselines,0);assert.equal(h.gc.interpolation.resyncRequests,0);
  assert.equal(h.peer.replication.queued.size,0);assert(!h.peer.replication.sent.has(3));assert(h.peer.replication.sent.has(4));
});

test('show replaces an unsent hide baseline and updates every unit',t=>{
  const h=harness(t);h.send(1,0,false);h.enqueue(h.encode(2,10001,true));
  const shown=h.enqueue(h.encode(3,10002,false,{cadence:100,enemyPos:[777,12,888]}));
  const s=h.standalone(shown);assert.equal(s.unitUpdates,3);assert.deepEqual(copy(s.units[1].pos),[777,12,888]);
  h.deliver(h.flush());assert.equal(h.gc.state.lastSnapshot.frame,3);assert.equal(h.gc.state.lastSnapshot.units[1].hidden,false);assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('stable visibility retains delta encoding and sparse cadence',t=>{
  const h=harness(t),initial=h.send(1,0,false),next=h.encode(2,50,false,{cadence:100});
  assert.equal(next.baseline,null);assert.equal(next.wire.delta[1],initial.wire.delta[1]);assert.equal(next.snapshot.unitUpdates,0);
  const explicit=h.encode(3,100,false,{cadence:100,forceBaseline:true});assert.equal(explicit.snapshot.unitUpdates,3);h.standalone(explicit);
});

test('rapid hide/show/hide purges all obsolete pairs without leaking prior state',t=>{
  const h=harness(t);h.send(1,0,false,{gadget:true,object:true});
  h.enqueue(h.encode(2,10001,false,{gadget:true,object:true}));
  for(let frame=3;frame<=13;frame++)h.enqueue(h.encode(frame,10001+frame*50,frame%2!==0,{gadget:frame%2===0,object:frame%2===0}));
  assert.deepEqual(h.hl.snapshots.map(p=>p.type),['snapshotBase','snapshot']);assert.equal(h.peer.replication.queued.size,1);
  const base=JSON.parse(h.hl.snapshots[0].text).payload,wire=JSON.parse(h.hl.snapshots[1].text).payload;h.assertSafe({baseline:base,wire});
  h.deliver(h.flush());h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,13);assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('a fully sent but lost baseline is not mistaken for a delivered baseline',t=>{
  const h=harness(t);h.send(1,0,false);h.enqueue(h.encode(2,10001,false));
  const lost=h.flush();assert(lost.some(p=>p.type==='snapshotBase'));
  // Sending is not acknowledgement: no local pending base remains, and the
  // ordinary resync path must still repair loss of either message on the wire.
  const hidden=h.send(3,10002,true);assert.equal(hidden.baseline,null);assert.equal(h.gc.interpolation.resyncRequests,1);
  h.serviceResync();const packets=h.flush();h.assertSafe({baseline:packets.find(p=>p.type==='snapshotBase').payload,wire:packets.find(p=>p.type==='snapshot').payload});
  h.deliver(packets);h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,3);assert.equal(h.gc.pendingSnapshotWires.size,0);
});

test('transition delta arriving before its baseline is retried when that baseline arrives',t=>{
  const h=harness(t);h.send(1,0,false);h.enqueue(h.encode(2,10001,false));h.enqueue(h.encode(3,10002,true));const packets=h.flush();
  h.deliver(packets.filter(p=>p.type==='snapshot'));assert.equal(h.gc.pendingSnapshotWires.size,1);assert.equal(h.gc.interpolation.resyncRequests,1);
  h.deliver(packets.filter(p=>p.type==='snapshotBase'));h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,3);assert.equal(h.gc.pendingSnapshotWires.size,0);
});

test('late visible baseline and duplicate/reordered snapshots cannot resurrect a hidden unit',t=>{
  const h=harness(t);h.send(1,0,false);h.enqueue(h.encode(2,10001,false));const old=h.flush();
  h.enqueue(h.encode(3,20002,false));h.send(4,20003,true);const accepted=h.gc.interpolation.acceptedSnapshots;
  h.deliver([...old,...old]);h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,4);assert.equal(h.gc.interpolation.acceptedSnapshots,accepted);
  assert(h.guest.snapshotDrops.stale>0);
});

test('dropped first hide delta is repaired by the next hidden delta',t=>{
  const h=harness(t);h.send(1,0,false);const hide=h.enqueue(h.encode(2,50,true));h.deliver(h.flush().filter(p=>p.type==='snapshotBase'));
  const next=h.send(3,100,true);assert.equal(next.baseline,null);assert.equal(next.wire.delta[1],hide.wire.delta[1]);h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,3);assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('artificial loss of the hide baseline recovers through the actual safe resync handler',t=>{
  const h=harness(t);h.send(1,0,false,{gadget:true,object:true});h.enqueue(h.encode(2,10001,false,{gadget:true,object:true}));h.host.snapshotDropRate=.2;
  const random=[0,1];h.host.options.random=()=>random.shift()??1;
  h.enqueue(h.encode(3,10002,true));h.deliver(h.flush());assert.equal(h.host.snapshotDrops.artificial,1);assert.equal(h.gc.interpolation.resyncRequests,1);
  h.serviceResync();const packets=h.flush(),base=packets.find(p=>p.type==='snapshotBase').payload,wire=packets.find(p=>p.type==='snapshot').payload;
  h.assertSafe({baseline:base,wire});h.deliver(packets);h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,3);assert.equal(h.gc.pendingSnapshotWires.size,0);
});

test('congestion-dropped periodic baseline remains safely resync-recoverable',t=>{
  const h=harness(t);h.send(1,0,false);h.enqueue(h.encode(2,10001,false));h.hl.snapshotConn.dataChannel.bufferedAmount=262145;
  assert.equal(h.flush().length,0);assert.equal(h.hl.snapshots.length,0);assert.equal(h.host.snapshotDrops.congestion,2);
  h.hl.snapshotConn.dataChannel.bufferedAmount=0;const hidden=h.send(3,10002,true);assert.equal(hidden.baseline,null);assert.equal(h.gc.interpolation.resyncRequests,1);
  h.serviceResync();h.deliver(h.flush());h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,3);
});

test('congestion-dropped transition pair recovers safely without replaying private data',t=>{
  const h=harness(t);h.send(1,0,false);h.enqueue(h.encode(2,10001,false));h.enqueue(h.encode(3,10002,true));h.hl.snapshotConn.bufferSize=1;h.flush();
  h.hl.snapshotConn.bufferSize=0;h.send(4,10003,true);assert.equal(h.gc.interpolation.resyncRequests,1);
  h.serviceResync();h.deliver(h.flush());h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,4);assert.equal(h.gc.pendingSnapshotWires.size,0);
});

test('gadget and equipment-object visibility changes also replace dropped baselines',t=>{
  for(const kind of ['gadget','object']){
    const h=harness(t);h.send(1,0,false,{[kind]:true});h.enqueue(h.encode(2,10001,false,{[kind]:true}));
    const removed=h.enqueue(h.encode(3,10002,false));const s=h.standalone(removed);
    assert.deepEqual(copy(s.gadgets),[[1]]);assert.deepEqual(copy(s.equipmentObjects),[]);
    assert(!JSON.stringify(removed.baseline).includes(kind==='gadget'?'8731':'9831'));
    h.deliver(h.flush());assert.equal(h.gc.state.lastSnapshot.frame,3);assert.equal(h.gc.interpolation.resyncRequests,0);
  }
});

test('partly sent old baseline fragments are canceled and fresh fragmented baseline decodes',t=>{
  const h=harness(t);h.send(1,0,false);
  // Force a multi-packet public baseline through actual chunking/reassembly.
  h.enqueue(h.encode(2,10001,false,{padding:32000,forceBaseline:true}));
  assert(h.hl.snapshots[0].packets.length>1);const oldSequence=JSON.parse(h.hl.snapshots[0].text).snapshotSequence;
  const firstBytes=h.hl.snapshots[0].packets[0].bytes;h.hl.snapshotConn.dataChannel.bufferedAmount=262144-firstBytes;
  const partial=h.flush();assert(partial.some(p=>p.type==='snapshotChunk'));assert(h.hl.snapshots[0].packetIndex>0);h.deliver(partial);
  h.enqueue(h.encode(3,10002,true,{padding:32000}));h.hl.snapshotConn.dataChannel.bufferedAmount=0;
  const replacement=h.flush();assert(replacement.every(p=>p.type!=='snapshotChunk'||p.payload.sequence!==oldSequence||p.payload.type!=='snapshotBase'));
  h.deliver(replacement);h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,3);
});

test('visibility purge is per-peer and does not clear control or input queues',t=>{
  const h=harness(t);h.send(1,0,false);const other={snapshots:[{type:'snapshotBase'}],queue:[{type:'events'}],inputs:[{type:'inputBatch'}]};h.host.links.set('other',other);
  h.hl.queue.push({type:'events'});h.hl.inputs.push({type:'inputBatch'});h.enqueue(h.encode(2,10001,false));h.enqueue(h.encode(3,10002,true));
  assert.equal(other.snapshots.length,1);assert.equal(other.queue.length,1);assert.equal(other.inputs.length,1);assert.equal(h.hl.queue.length,1);assert.equal(h.hl.inputs.length,1);
});


test('ordinary hide/show keeps using a delivered baseline without baseline churn',t=>{
  const h=harness(t),initial=h.send(1,0,false);
  for(let frame=2;frame<=101;frame++){
    const hidden=frame%2===0,next=h.send(frame,frame*50,hidden);
    assert.equal(next.baseline,null);assert.equal(next.wire.delta[1],initial.wire.delta[1]);
    if(hidden)h.hidden();else assert.equal(h.gc.state.lastSnapshot.units[1].hidden,false);
  }
  assert.equal(h.gc.state.lastSnapshot.frame,101);assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('purging queued deltas alone does not force an unnecessary baseline',t=>{
  const h=harness(t),initial=h.send(1,0,false);h.enqueue(h.encode(2,50,false));
  assert.deepEqual(h.hl.snapshots.map(p=>p.type),['snapshot']);const hide=h.send(3,100,true);
  assert.equal(hide.baseline,null);assert.equal(hide.wire.delta[1],initial.wire.delta[1]);h.hidden();assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('an old numeric-only transport falls back to the conservative safe baseline',t=>{
  const h=harness(t);h.send(1,0,false);h.enqueue(h.encode(2,10001,false));
  const drop=h.host.dropPendingSnapshots.bind(h.host);h.host.dropPendingSnapshots=id=>drop(id);
  const hide=h.send(3,10002,true);h.assertSafe(hide);h.hidden();assert.equal(h.gc.interpolation.resyncRequests,0);
});

test('drop details report canceled pending bases while preserving the numeric API',t=>{
  const h=harness(t);h.send(1,0,false);h.enqueue(h.encode(2,10001,false));
  assert.deepEqual(h.host.dropPendingSnapshots('guest',{details:true}),{count:2,baselines:1});
  h.enqueue(h.encode(3,10002,false));assert.deepEqual(h.host.dropPendingSnapshots('guest',{details:true}),{count:1,baselines:0});
  assert.deepEqual(h.host.dropPendingSnapshots('missing',{details:true}),{count:0,baselines:0});
  assert.deepEqual(h.guest.dropPendingSnapshots('host',{details:true}),{count:0,baselines:0});
  assert.equal(h.host.dropPendingSnapshots('missing'),0);assert.equal(h.guest.dropPendingSnapshots('host'),0);
});

test('a fully sent baseline is retained even when its queued delta is canceled',t=>{
  const h=harness(t);h.send(1,0,false);const periodic=h.enqueue(h.encode(2,10001,false));
  const baseBytes=h.hl.snapshots[0].packets.reduce((n,p)=>n+p.bytes,0);h.hl.snapshotConn.dataChannel.bufferedAmount=262144-baseBytes;
  const basePackets=h.flush();assert(basePackets.length);assert.deepEqual(h.hl.snapshots.map(p=>p.type),['snapshot']);
  // No delivery acknowledgement is invented. Delay the already-sent baseline
  // until after the new hide delta, then let actual pending-wire retry decode it.
  h.hl.snapshotConn.dataChannel.bufferedAmount=0;const hide=h.send(3,10002,true);
  assert.equal(hide.baseline,null);assert.equal(hide.wire.delta[1],periodic.wire.delta[1]);assert.equal(h.gc.pendingSnapshotWires.size,1);
  h.deliver(basePackets);h.hidden();assert.equal(h.gc.state.lastSnapshot.frame,3);assert.equal(h.gc.pendingSnapshotWires.size,0);
});

test('a sent delta never substitutes for proof that its queued baseline was sent',t=>{
  const h=harness(t);h.send(1,0,false);h.enqueue(h.encode(2,50,false,{forceBaseline:true}));
  // The small delta fits while the first baseline packet does not. This creates
  // a sent-snapshot record even though the baseline still needs transmission.
  h.hl.snapshotConn.dataChannel.bufferedAmount=262144-512;const partial=h.flush();
  assert.deepEqual(partial.map(p=>p.type),['snapshot']);assert(h.peer.replication.sent.has(2));
  assert.deepEqual(h.hl.snapshots.map(p=>p.type),['snapshotBase']);assert.equal(h.hl.snapshots[0].packetIndex,0);h.deliver(partial);
  h.hl.snapshotConn.dataChannel.bufferedAmount=0;const hide=h.send(3,100,true);h.assertSafe(hide);h.hidden();
  assert.equal(h.gc.state.lastSnapshot.frame,3);assert.equal(h.gc.pendingSnapshotWires.size,0);
});
