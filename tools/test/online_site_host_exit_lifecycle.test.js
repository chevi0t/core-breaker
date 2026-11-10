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
    'transportOptions','clearStartReservation','resetPeerCommands','start','begin','countdown','reserveStart','onMessage','abortPreparation','peerLeft','backToLobby','endGuest','reconnectGuest'])
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
  await r.ready();r.host.c.start();const matchId=r.host.c.state.matchId;
  await r.until(()=>r.all.filter(f=>f!==r.host&&!f.transport.closed).every(f=>f.c.state.phase==='preparing'),'retry prepare reaches connected guests');
  for(const g of r.all.filter(f=>f!==r.host&&!f.transport.closed)){g.c.prepared=true;g.transport.send('ready',{matchId});}
  await r.until(()=>r.all.filter(f=>!f.transport.closed).every(f=>f.c.state.phase==='countdown'),'retry reaches countdown');
  for(const f of r.all.filter(f=>!f.transport.closed))f.c.begin();
  for(const f of r.all.filter(f=>!f.transport.closed)){assert.equal(f.c.state.phase,'playing');assert.equal(f.c.running,true);assert.equal(f.transport.matchId,matchId);}
}

function supportLeave(f){
 Object.assign(f.c,{diagnosticLog:null,logSample:noop,resetQuickChat:noop,clearRemoteEquipment:noop,equipmentActions:[],remoteUnitHistory:new Map(),saved:null,clearRemoteShells:noop,setSimulationRole:noop});
 vm.runInContext(extract('leave'),f.c);
}
for(const mode of ['plain-exit','abort-then-exit','ordinary-return-then-exit'])test(mode+' should preserve actual host exit reason before queued messages drain',async t=>{
 const r=await room(t),h=r.host,g=r.guests[0];await r.start();supportLeave(h);
 const oldMatch=g.transport.matchId;
 if(mode==='abort-then-exit')h.c.abortPreparation('start failed');
 if(mode==='ordinary-return-then-exit'){
  h.c.state.phase='ended';g.c.state.phase='ended';h.transport.broadcast('lobbyReturn',{matchId:h.c.state.matchId});h.c.backToLobby();
 }
 // Snapshot/control queued events stay pending. Only the immediate close() bye is delivered,
 // synchronously before closing channels, to isolate match-ID rejection from best-effort send loss.
 const hl=h.transport.links.get(g.transport.peer.id),gl=g.transport.links.get(r.roomId),received=[];
 hl.conn.send=raw=>{received.push(JSON.parse(raw));gl.conn.emit('data',raw);};
 const hostMatch=h.transport.matchId;
 h.c.leave('ホストが退出しました');
 console.log(JSON.stringify({source,mode,hostMatch,guestMatch:oldMatch,sent:received.map(m=>({type:m.type,matchId:m.matchId,reason:m.payload?.reason})),guestPhase:g.c.state.phase,guestReason:g.c.state.status}));
 assert.equal(g.c.state.phase,'ended');assert.equal(g.c.state.status,'ホストが退出しました');
});
