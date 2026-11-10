// 通信境界の決定的な試験。実 WebRTC/ブラウザ試験とは別に、偽の Peer で検査する。
const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const Transport = require(process.env.TRANSPORT_FILE||require('node:path').join(__dirname,'../../prototype/online/transport.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async predicate => { const end=Date.now()+2000; while(!predicate()&&Date.now()<end) await wait(20); assert(predicate()); };
let serial = 0;
const peers = new Map();
class FakeConnection extends EventEmitter {
  constructor(peer,options={},id='connection-'+ ++serial) {
    super();this.peer=peer;this.open=false;this.closed=false;this.connectionId=id;
    this.label=options.label;this.metadata=options.metadata;this.reliable=options.reliable;
    this.dataChannel={bufferedAmount:0,ordered:!!options.reliable,maxRetransmits:options.reliable?null:0,maxPacketLifeTime:null,readyState:'connecting'};this.bufferSize=0;
  }
  send(data) { if (!this.open) throw new Error('closed'); queueMicrotask(() => {if(this.other?.open)this.other.emit('data', data);}); }
  close() { if(this.closed)return;this.closed=true;this.open=false;this.dataChannel.readyState='closed';this.emit('close');if(this.other&&!this.other.closed)this.other.close(); }
}
class FakePeer extends EventEmitter {
  constructor(_, options) { super(); this.id = 'peer-' + ++serial; this.options = options; peers.set(this.id, this); this.disconnected=false; this.destroyed=false; queueMicrotask(() => {if(!options.pauseOpen)this.emit('open', this.id);}); }
  connect(id, options) {
    assert.equal(options.serialization,'raw');
    assert.equal(options.label,options.reliable?Transport.CONTROL_LABEL:Transport.SNAPSHOT_LABEL);
    const a=new FakeConnection(id,options),b=new FakeConnection(this.id,options,a.connectionId);a.other=b;b.other=a;
    queueMicrotask(()=>{const target=peers.get(id);if(!target)return;target.emit('connection',b);
      if(a.closed||b.closed)return;
      const open=()=>{if(a.closed||b.closed)return;a.open=b.open=true;a.dataChannel.readyState=b.dataChannel.readyState='open';b.emit('open');a.emit('open');};
      if(!options.reliable&&this.pauseSnapshotOpen)this.releaseSnapshot=open;else open();
    });return a;
  }
  reconnect(){this.disconnected=false;queueMicrotask(()=>this.emit('open',this.id));}
  destroy() { this.destroyed=true;peers.delete(this.id); this.emit('close'); }
}

const report={label:'current-test-site',method:'Actual deployed transport.js with deterministic FakePeer channels and faults. No browser/WebRTC/network claims.',cases:[]};
const all=[];
const make=o=>{const t=new Transport({appVersion:'targeted-regression',Peer:FakePeer,reconnect:true,...o});all.push(t);return t;};
async function settle(p,ms=80){return Promise.race([p.then(v=>({settled:true,ok:true,value:v}),e=>({settled:true,ok:false,error:e.message})),wait(ms).then(()=>({settled:false}))]);}
async function pair(){
  const joins=[],leaves=[],messages=[],host=make({onPeerJoin:(...x)=>joins.push(x),onPeerLeave:(...x)=>leaves.push(x)}),room=await host.createRoom();
  const guest=make({onMessage:(...x)=>messages.push(x)}),joined=guest.connect(room);await until(()=>host.links.get(guest.peer.id)?.pending);host.approvePeer(guest.peer.id);await joined;await until(()=>host.canStartMatch());
  host.startMatch('match-'+ ++serial);await until(()=>guest.started);return{host,guest,room,joins,leaves,messages};
}
(async()=>{try{
  for(const method of ['createRoom','connect']){
    const t=make({peerOptions:{pauseOpen:true}}),p=method==='createRoom'?t.createRoom():t.connect('not-yet-open');await wait(5);t.close('user cancelled');
    const outcome=await settle(p);report.cases.push({case:'cancel-during-peer-registration-'+method,expected:'promise rejects promptly when cancelled',outcome,closed:t.closed,timers:t._timers.size});
  }
  {
    const t=make({peerOptions:{pauseOpen:true}}),p=t.createRoom();await wait(5);t.peer.emit('close');report.cases.push({case:'signalling-close-before-registration-completes',expected:'create promise rejects',outcome:await settle(p),closed:t.closed,timers:t._timers.size});
  }
  {
    const t=make({peerOptions:{pauseOpen:true}}),p=t.createRoom();await wait(5);t.close('user cancelled');t.peer.emit('open',t.peer.id);
    report.cases.push({case:'late-peer-open-after-close',expected:'cancelled create does not report success',outcome:await settle(p),closed:t.closed,roomId:t.roomId});
  }
  {
    const p=await pair();const initialToken=p.guest.resumeToken;
    for(let n=0;n<3;n++){
      const before=p.joins.length;p.host.links.get(p.guest.peer.id).snapshotConn.close();await until(()=>p.joins.length>before&&p.guest.links.get(p.room)?.ready);assert(p.guest.started);assert.equal(p.guest.resumeToken,initialToken);
      p.host.send('snapshot',{frame:n+1},p.guest.peer.id);await until(()=>p.messages.some(x=>x[0]==='snapshot'&&x[1].frame===n+1));
    }
    report.cases.push({case:'three-repeated-snapshot-channel-disconnects',passed:true,joins:p.joins.length,leaves:p.leaves.length});
  }
  {
    const p=await pair();const h=p.host,g=p.guest,room=p.room;clearInterval(h._tickTimer);
    const old=h.links.get(g.peer.id);h.latencyMs=100;h.send('snapshot',{frame:987,old:true},g.peer.id);
    old.snapshotConn.close();h._tickTimer=setInterval(()=>h._tick(),20);await until(()=>h.links.get(g.peer.id)?.ready&&h.links.get(g.peer.id)!==old&&g.links.get(room)?.ready);h.latencyMs=0;h.send('snapshot',{frame:1,fresh:true},g.peer.id);h._tick();await until(()=>p.messages.some(x=>x[1].fresh));
    report.cases.push({case:'reconnect-with-queued-old-snapshot',passed:!p.messages.some(x=>x[1].old),oldQueueLength:old.snapshots.length,received:p.messages.filter(x=>x[0]==='snapshot').map(x=>x[1])});
  }
  {
    const p=await pair();p.host.returnToLobby();p.guest.returnToLobby();p.host.startMatch('second-match');await until(()=>p.guest.matchId==='second-match');p.guest.links.get(p.room).conn.close();await until(()=>p.host.links.get(p.guest.peer.id)?.ready&&p.guest.links.get(p.room)?.ready);
    report.cases.push({case:'reconnect-after-second-match-on-same-room',passed:p.host.matchId===p.guest.matchId,match:p.guest.matchId});
  }
  {
    const joins=[],host=make({onPeerJoin:(...a)=>joins.push(a)}),room=await host.createRoom(),guests=[];
    for(let i=0;i<3;i++){const seen=[],g=make({onMessage:(...m)=>seen.push(m)}),p=g.connect(room);await until(()=>host.links.get(g.peer.id)?.pending);host.approvePeer(g.peer.id);await p;guests.push({g,seen});}
    host.startMatch('multi-match');await until(()=>guests.every(x=>x.g.started));
    host.links.get(guests[0].g.peer.id).snapshotConn.close();
    for(let n=0;n<8;n++){host.broadcast('snapshot',{frame:n});await wait(25);}
    await until(()=>host.links.get(guests[0].g.peer.id)?.ready);host.broadcast('snapshot',{frame:99});await until(()=>guests.every(x=>x.seen.some(m=>m[0]==='snapshot'&&m[1].frame===99)));
    report.cases.push({case:'one-of-three-guests-reconnects-others-continue',passed:true,receivedCounts:guests.map(x=>x.seen.filter(m=>m[0]==='snapshot').length),connected:host.metrics().connectedPeers});
  }
  assert.equal(report.cases.length,8);
  for(const c of report.cases){
    if(c.outcome){assert.equal(c.outcome.settled,true,c.case);assert.equal(c.outcome.ok,false,c.case);assert.equal(c.closed,true,c.case);if('timers' in c)assert.equal(c.timers,0,c.case);if('roomId' in c)assert.equal(c.roomId,'',c.case);}
    else assert.equal(c.passed,true,c.case);
  }
} catch(e){report.error=e.stack;process.exitCode=1;}finally{for(const t of all)t.close('test cleanup');require('node:fs').writeFileSync(process.env.TRANSPORT_OUTPUT||require('node:path').join(require('node:os').tmpdir(),'core-breaker-targeted-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}})();
