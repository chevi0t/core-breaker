'use strict';
// Actual distributed game lifecycle functions + transport, two-sided VM state.
// FakePeer replaces WebRTC; world/rendering/snapshot decoding are fixtures.
// CB_SOURCE=/path/to/dist also runs these checks against an unchanged baseline.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),test=require('node:test');
const {EventEmitter}=require('node:events');
const source=path.resolve(process.env.CB_SOURCE||path.join(__dirname,'../../prototype'));
const code=fs.readFileSync(path.join(source,'online/game.js'),'utf8');
const Transport=require(path.join(source,'online/transport.js'));
function extract(name){
  const m=new RegExp('^  (?:async )?function '+name+'\\(', 'm').exec(code);
  assert(m,'function '+name+' exists');
  const firstEnd=code.indexOf('\n',m.index);
  if(code.slice(m.index,firstEnd).trimEnd().endsWith('}'))return code.slice(m.index,firstEnd);
  const end=code.indexOf('\n  }',m.index);
  assert(end>=0,'function '+name+' has its closing line');
  return code.slice(m.index,end+4);
}
let serial=0;const peers=new Map();
class FakeConnection extends EventEmitter {
  constructor(peer,options,id='connection-'+ ++serial){
    super();Object.assign(this,{peer,open:false,closed:false,connectionId:id,label:options.label,metadata:options.metadata,reliable:options.reliable,bufferSize:0});
    this.dataChannel={bufferedAmount:0,ordered:!!options.reliable,maxRetransmits:options.reliable?null:0,maxPacketLifeTime:null,readyState:'connecting'};
  }
  send(raw){if(!this.open)throw Error('closed');queueMicrotask(()=>{if(this.other?.open)this.other.emit('data',raw);});}
  close(){if(this.closed)return;this.closed=true;this.open=false;this.dataChannel.readyState='closed';this.emit('close');this.other?.close();}
}
class FakePeer extends EventEmitter {
  constructor(){super();this.id='peer-'+ ++serial;peers.set(this.id,this);queueMicrotask(()=>this.emit('open',this.id));}
  connect(id,options){
    const a=new FakeConnection(id,options),b=new FakeConnection(this.id,options,a.connectionId);a.other=b;b.other=a;
    queueMicrotask(()=>{const target=peers.get(id);if(!target)return;target.emit('connection',b);if(a.closed||b.closed)return;
      a.open=b.open=true;a.dataChannel.readyState=b.dataChannel.readyState='open';b.emit('open');a.emit('open');});return a;
  }
  destroy(){this.destroyed=true;peers.delete(this.id);this.emit('close');}
}
const noop=()=>{};
function fixture(role){
  const timers=new Map(),nodes=new Map(),messages=[],statuses=[],events=[];
  const c=vm.createContext({console,structuredClone,performance,Date:class extends Date{static now(){return 1000000+ ++serial;}},Map,Set,
    setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  c.state={role,phase:'lobby',peers:new Map(),requests:new Map(),resumePeers:new Map(),roster:[],roomId:null,matchId:null,
    settings:{capacity:4,teamSize:2,mapId:'city',teamMode:'choice'},resolvedMapId:'city',hostTeam:'B',equipment:{cls:'assault',loadouts:{assault:{main:'test'}}},
    equipmentVersion:0,lobbyRevision:0,lobbyReady:false,editing:false,equipmentPending:false,frame:0,disconnected:[],reconnecting:false};
  Object.assign(c,{$:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,querySelector:()=>null});return nodes.get(id);},
    document:{exitPointerLock:noop},callbacks:{},prediction:{},running:false,ended:false,units:[],player:null,
    prepared:false,pendingPrepare:null,interpolation:{},SNAPSHOT_INTERVAL_MS:50,visibilitySupport:true,roomMaps:[{id:'city'}],roomTeamSizes:[2],quickChatBudgets:new Map(),
    preferenceTimer:null,preferenceResolve:null,preferenceReject:null,lastResync:0,resyncBackoff:250,
    now:()=>performance.now(),localVersion:()=> 'preparation-lifecycle',pilotNameForOnline:()=>role,
    logCheckpoint:(...x)=>events.push(x),resetLagCompensation:noop,clearPrediction:noop,tutorialClearInput:noop,stopSessionAudio:noop,
    showPage:noop,annReset:noop,announce:noop,requireVisibilitySupport:noop,applyEquipment:noop,
    checkedEquipment:equipment=>structuredClone(equipment),handleSnapshotControl:type=>type==='snapshotBase',retryPendingSnapshots:noop,
    receiveSnapshot:noop,rememberPeerSnapshot:noop,filterQueuedEvents:(_,payload)=>payload,
    setupWorld:(size,localId)=>{c.units=['B','R'].flatMap(team=>Array.from({length:size},(_,i)=>({entityId:team+':'+i})));c.player=c.units.find(u=>u.entityId===localId);},
    unit:id=>c.units.find(u=>u.entityId===id),snapshot:()=>({frame:++c.state.frame}),
    encodePeerSnapshot:(_,snapshot)=>({baseline:{frame:snapshot.frame},wire:{frame:snapshot.frame}}),
    resetMeasurements:()=>{c.pendingPrepare=null;c.prepared=false;c.state.frame=0;c.state.lastSnapshot=null;for(const p of c.state.peers.values())delete p.replication;},
    countdownTick:noop});
  for(const name of ['status','hostRoster','localMember','canStart','resetLobbyReady','rosterChanged','lobbyChanged','checkedSettings','setReady','requestsChanged','approveGuest',
    'transportOptions','clearStartReservation','resetPeerCommands','start','begin','countdown','reserveStart','onMessage','abortPreparation','peerLeft','backToLobby','endGuest'])
    vm.runInContext(extract(name),c,{filename:'game.js:'+name});
  const options=c.transportOptions({onStatus:message=>statuses.push(message),onEnded:reason=>events.push(['ended',reason]),onLobbyReturn:()=>events.push(['lobbyReturn'])});
  const receive=options.onMessage;
  const transport=new Transport({...options,Peer:FakePeer,onMessage:(...args)=>{messages.push(args);receive(...args);}});
  // Lifecycle checks do not model NTP convergence or clock skew.
  transport.clock=()=>({offsetMs:0});
  clearInterval(transport._tickTimer);c.state.transport=transport;
  return {c,transport,timers,nodes,messages,statuses,events};
}
async function room(t,count=1){
  const all=[],host=fixture('host');all.push(host);
  t.after(()=>{for(const f of all){f.c.state.phase='leaving';f.transport.close('test cleanup');}});
  const roomId=await host.transport.createRoom();host.c.state.roomId=roomId;
  async function pump(){for(const f of all)f.transport._tick();await Promise.resolve();}
  async function until(fn,label){for(let n=0;n<150&&!fn();n++)await pump();assert(fn(),label);}
  async function addGuest(){
    const g=fixture('guest');all.push(g);g.c.state.roomId=roomId;
    let connected=false,error;g.transport.connect(roomId).then(()=>connected=true,e=>error=e);
    await until(()=>connected||error,'guest handshake settles');if(error)throw error;
    g.transport.send('preference',g.c.state.equipment);
    await until(()=>host.c.state.peers.get(g.transport.peer.id)?.preferred&&g.messages.some(m=>m[0]==='preferenceAck'),'equipment confirmed');
    return g;
  }
  const guests=[];for(let i=0;i<count;i++)guests.push(await addGuest());
  async function ready(){
    for(let i=0;i<5;i++)await pump();
    host.c.setReady(true);
    for(const g of all.filter(f=>f!==host&&!f.transport.closed&&host.c.state.peers.has(f.transport.peer.id)))g.c.setReady(true);
    await until(()=>host.c.canStart(),'all lobby Ready flags accepted');
  }
  async function start(){await ready();host.c.start();await until(()=>guests.filter(g=>!g.transport.closed).every(g=>g.c.state.phase==='preparing'),'guests receive prepare');}
  async function canceled(){await until(()=>all.filter(f=>!f.transport.closed).every(f=>f.c.state.phase==='lobby'&&!f.transport.started&&f.events.some(e=>e[0]==='lobbyReturn')),'all live participants return to lobby');}
  return {all,host,guests,roomId,pump,until,addGuest,ready,start,canceled};
}
function assertLobby(f,roomId){
  assert.equal(f.c.state.phase,'lobby');assert.equal(f.transport.started,false);assert.equal(f.transport.matchId,'');assert.equal(f.c.state.matchId,null);
  assert.equal(f.c.state.roomId,roomId);assert.equal(f.transport.roomId,roomId);assert.equal(f.transport.closed,false);
  assert.equal(f.c.state.lobbyReady,false);assert.equal(f.c.state.prepareTimer,null);assert.equal(f.c.state.startAtLocal,null);
  assert.equal(f.c.pendingPrepare,null);assert.equal(f.c.prepared,false);assert.equal(f.timers.size,0);assert.equal(f.c.running,false);
  assert.equal(f.transport.resumeSessions.size,0);assert.equal(f.transport.reconnectUntil,0);
  for(const p of f.c.state.peers.values()){assert.equal(p.ready,false);assert.equal(p.lobbyReady,false);assert.equal(p.unitId,null);}
}
async function retryAndPlay(r){
  const participants=()=>r.all.filter(f=>f===r.host||!f.transport.closed&&r.host.c.state.peers.has(f.transport.peer.id));
  await r.ready();r.host.c.start();const matchId=r.host.c.state.matchId;
  await r.until(()=>participants().filter(f=>f!==r.host).every(f=>f.c.state.phase==='preparing'),'retry prepare reaches connected guests');
  for(const g of participants().filter(f=>f!==r.host)){g.c.prepared=true;g.transport.send('ready',{matchId});}
  await r.until(()=>participants().every(f=>f.c.state.phase==='countdown'),'retry reaches countdown');
  for(const f of participants())f.c.begin();
  for(const f of participants()){assert.equal(f.c.state.phase,'playing');assert.equal(f.c.running,true);assert.equal(f.transport.matchId,matchId);}
}
test('15-second loading timeout rolls both game and transport back, then same room starts again',async t=>{
  const r=await room(t);await r.start();const oldMatch=r.host.c.state.matchId;
  const timer=r.host.timers.get(r.host.c.state.prepareTimer);assert.equal(timer.ms,15000);timer.fn();await r.canceled();
  for(const f of r.all){assertLobby(f,r.roomId);assert.match(f.c.state.status,/15秒/);assert.equal(f.nodes.get('ovText').textContent,f.c.state.status);}
  assert.equal(r.host.transport.canStartMatch(),true);assert.equal(r.host.c.canStart(),false,'fresh Ready is required');
  assert.equal(r.guests[0].transport.links.size,1,'the original guest connection survives');
  await retryAndPlay(r);assert.notEqual(r.host.c.state.matchId,oldMatch);
});
for(const phase of ['preparing','countdown'])test('guest exits during '+phase+': remaining guests survive and a replacement can join',async t=>{
  const r=await room(t,2);await r.start();
  if(phase==='countdown'){
    for(const g of r.guests){g.c.prepared=true;g.transport.send('ready',{matchId:r.host.c.state.matchId});}
    await r.until(()=>r.all.every(f=>f.c.state.phase==='countdown'),'all clients enter countdown');
  }
  const departing=r.guests[0],survivor=r.guests[1],leavingId=departing.transport.peer.id;
  departing.c.state.phase='leaving';departing.transport.close('退出');await r.canceled();
  assert.equal(r.host.c.state.peers.has(leavingId),false);assert.equal(r.host.transport.links.has(leavingId),false);
  for(const f of [r.host,survivor]){assertLobby(f,r.roomId);assert.match(f.c.state.status,/ゲストが退出/);assert.equal(f.c.state.roster.some(p=>p.id===leavingId),false);}
  const replacement=await r.addGuest();assert.equal(replacement.c.state.roomId,r.roomId);assert.equal(r.host.c.state.peers.size,2);
  await retryAndPlay(r);
});
test('initial prepare send failure before any guest loads still releases the transport match',async t=>{
  const r=await room(t);await r.ready();
  const send=r.host.transport.send.bind(r.host.transport);r.host.transport.send=(type,...args)=>type==='prepare'?false:send(type,...args);
  r.host.c.start();await r.canceled();
  for(const f of r.all){assertLobby(f,r.roomId);assert.match(f.c.state.status,/送信上限/);}
  assert.equal(r.guests[0].messages.some(m=>m[0]==='prepare'),false);
  r.host.transport.send=send;await retryAndPlay(r);
});
test('delayed cancellation and late old-match traffic cannot restart or poison the retry',async t=>{
  const r=await room(t);await r.start();const h=r.host,g=r.guests[0],oldMatch=h.c.state.matchId;
  const latePrepare=JSON.stringify(h.transport._envelope('prepare',{matchId:oldMatch,teamSize:2,mapId:'city',localId:'R:0'}));
  const lateSnapshot=JSON.stringify({...h.transport._envelope('snapshot',{frame:999}),snapshotSequence:999});
  const lateReady=JSON.stringify(g.transport._envelope('ready',{matchId:oldMatch}));
  // Queue a ready before the host rolls back; its old envelope must be ignored.
  g.transport.send('ready',{matchId:oldMatch});
  h.transport.latencyMs=100;h.c.abortPreparation('delayed cancellation');
  assertLobby(h,r.roomId);assert.equal(g.c.state.phase,'preparing');
  const hlink=h.transport.links.get(g.transport.peer.id);
  const cancellation=hlink.queue.find(item=>item.type==='lobbyReturn').text;
  // Release the reliable queue after checking the host reset happened first.
  for(const item of hlink.queue)item.due=0;h.transport.latencyMs=0;await r.canceled();
  assertLobby(g,r.roomId);await retryAndPlay(r);const current=h.c.state.matchId;
  // Already-sent old cancellation is stale, even after a new match has begun.
  const received=g.messages.length,hostReceived=h.messages.length;
  g.transport._receive(g.transport.links.get(r.roomId),cancellation);
  g.transport._receive(g.transport.links.get(r.roomId),latePrepare);
  g.transport._receive(g.transport.links.get(r.roomId),lateSnapshot,'snapshot');
  h.transport._receive(h.transport.links.get(g.transport.peer.id),lateReady);
  assert.equal(g.messages.length,received);assert.equal(h.messages.length,hostReceived);
  assert.equal(g.c.state.phase,'playing');assert.equal(g.c.state.matchId,current);assert.equal(h.c.state.phase,'playing');
});
test('cancellation is idempotent and a new arrival after timeout does not require room recreation',async t=>{
  const r=await room(t);await r.start();r.host.c.abortPreparation('first');await r.canceled();
  const before=r.host.events.filter(e=>e[0]==='lobbyReturn').length;
  r.host.c.abortPreparation('duplicate');assert.equal(r.host.events.filter(e=>e[0]==='lobbyReturn').length,before);
  const newcomer=await r.addGuest();assert.equal(newcomer.c.state.phase,'lobby');assert.equal(r.host.c.state.peers.size,2);
  await retryAndPlay(r);
});
test('three canceled starts reuse the same peer connections without accumulating preparation timers',async t=>{
  const r=await room(t),hostLink=r.host.transport.links.get(r.guests[0].transport.peer.id),guestLink=r.guests[0].transport.links.get(r.roomId);
  for(let i=0;i<3;i++){
    await r.start();const oldTimer=r.host.timers.get(r.host.c.state.prepareTimer);
    oldTimer.fn();await r.canceled();
    for(const f of r.all)assertLobby(f,r.roomId);
    oldTimer.fn();assert.equal(r.host.c.state.phase,'lobby','the old timeout callback is inert after rollback');
    assert.equal(r.host.transport.links.get(r.guests[0].transport.peer.id),hostLink);
    assert.equal(r.guests[0].transport.links.get(r.roomId),guestLink);
  }
  await retryAndPlay(r);
});
test('ordinary match lobby return and actual host exit keep their existing meanings',async t=>{
  const r=await room(t);await retryAndPlay(r);
  const matchId=r.host.c.state.matchId;
  // The ordinary completion path has already displayed the result on each side.
  for(const f of r.all)f.c.state.phase='ended';
  r.host.transport.broadcast('lobbyReturn',{matchId});r.host.c.backToLobby();await r.canceled();
  for(const f of r.all){assertLobby(f,r.roomId);assert.equal(f.events.some(e=>e[0]==='ended'),false);}
  r.host.transport.broadcast('endHost',{reason:'actual host exit'});
  await r.until(()=>r.guests[0].c.state.phase==='ended','host exit still ends the guest session');
  assert.equal(r.guests[0].c.state.status,'actual host exit');
});

// Real _enqueue() queue overflow calls onPeerLeave synchronously, inside startMatch/send.
// Check both a survivor that has not received a match announcement and one that has.
for(const [stage,departingIndex,queueLength] of [['match-first',0,256],['match-last',1,256],['prepare',0,255]])
  test('synchronous control failure at '+stage+' cancels setup and preserves the surviving room',async t=>{
    const r=await room(t,2);await r.ready();
    const departing=r.guests[departingIndex],survivor=r.guests[1-departingIndex],departingId=departing.transport.peer.id;
    const blocked=r.host.transport.links.get(departingId);
    while(blocked.queue.length<queueLength)assert.equal(r.host.transport.send('lobbyNotice',{reason:'queued control'},departingId),true);
    let setups=0;const setup=r.host.c.setupWorld;r.host.c.setupWorld=(...args)=>{setups++;setup(...args);};
    r.host.c.start();
    assert.equal(setups,stage==='prepare'?1:0,'canceled startMatch must not create the game world');
    for(let i=0;i<20;i++)await r.pump();
    assertLobby(r.host,r.roomId);
    assert.equal(r.host.c.state.peers.has(departingId),false);assert.equal(r.host.transport.links.has(departingId),false);
    assert.equal(survivor.c.state.phase,'lobby');assert.equal(survivor.c.state.matchId,null);assert.equal(survivor.transport.matchId,'');
    assert.equal(survivor.transport.started,false);assert.equal(survivor.transport.closed,false);assert.equal(survivor.c.state.lobbyReady,false);
    assert.equal(survivor.c.state.roomId,r.roomId);assert.equal(survivor.transport.roomId,r.roomId);assert.equal(survivor.timers.size,0);
    assert.equal(survivor.c.pendingPrepare,null);assert.equal(survivor.c.prepared,false);assert.equal(survivor.transport.resumeSessions.size,0);
    assert.equal(survivor.c.state.roster.some(p=>p.id===departingId),false);
    assert.equal(survivor.messages.some(m=>m[0]==='prepare'),false,'no prepare is sent after rollback');
    // The dropped transport is no longer a room participant; release its test fixture.
    departing.c.state.phase='leaving';departing.transport.close('departed fixture');
    await retryAndPlay(r);
  });

test('real oversized initial snapshot cancels guests before and after prepare on the same room',async t=>{
  const r=await room(t,2);await r.ready();const encode=r.host.c.encodePeerSnapshot;
  r.host.c.encodePeerSnapshot=()=>({baseline:{oversized:'x'.repeat(262144)},wire:{frame:1}});
  r.host.c.start();await r.canceled();
  for(const f of r.all)assertLobby(f,r.roomId);
  assert.equal(r.guests[0].messages.some(m=>m[0]==='prepare'),true);
  assert.equal(r.guests[1].messages.some(m=>m[0]==='prepare'),false);
  r.host.c.encodePeerSnapshot=encode;await retryAndPlay(r);
});

for(const departingIndex of [0,1])test('synchronous begin delivery failure at guest '+departingIndex+' cannot resurrect countdown',async t=>{
  const r=await room(t,2);await r.start();const matchId=r.host.c.state.matchId;
  const departing=r.guests[departingIndex],survivor=r.guests[1-departingIndex],id=departing.transport.peer.id;
  const blocked=r.host.transport.links.get(id);
  while(blocked.queue.length<256)assert.equal(r.host.transport.send('lobbyNotice',{reason:'queued control'},id),true);
  // Deliver ready through each actual guest transport without draining the blocked host queue.
  for(const g of r.guests){g.c.prepared=true;g.transport.send('ready',{matchId});g.transport._tick();}
  await Promise.resolve();
  assertLobby(r.host,r.roomId);
  departing.c.state.phase='leaving';departing.transport.close('departed fixture');
  await r.until(()=>survivor.c.state.phase==='lobby','survivor receives the cancellation');
  assertLobby(survivor,r.roomId);
  await retryAndPlay(r);
});
