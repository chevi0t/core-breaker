// 通信境界の決定的な試験。実 WebRTC/ブラウザ試験とは別に、偽の Peer で検査する。
const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const Transport = require('../../prototype/online/transport.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async predicate => { const end=Date.now()+2000; while(!predicate()&&Date.now()<end) await wait(20); assert(predicate()); };
let serial = 0;
const peers = new Map();
class FakeConnection extends EventEmitter {
  constructor(peer) { super(); this.peer = peer; this.open = false; this.dataChannel = { bufferedAmount: 0 }; this.bufferSize = 0; }
  send(data) { if (!this.open) throw new Error('closed'); queueMicrotask(() => this.other?.emit('data', data)); }
  close() { if (!this.open) return; this.open = false; this.emit('close'); if (this.other?.open) { this.other.open = false; this.other.emit('close'); } }
}
class FakePeer extends EventEmitter {
  constructor(_, options) { super(); this.id = 'peer-' + ++serial; this.options = options; peers.set(this.id, this); queueMicrotask(() => this.emit('open', this.id)); }
  connect(id, options) { assert.equal(options.reliable, true); assert.equal(options.serialization, 'raw'); assert.equal(options.label, 'core-breaker-online-v4'); const a = new FakeConnection(id), b = new FakeConnection(this.id); a.other=b; b.other=a; queueMicrotask(() => { const target = peers.get(id); if (!target) return; target.emit('connection', b); a.open=b.open=true; b.emit('open'); a.emit('open'); }); return a; }
  destroy() { peers.delete(this.id); this.emit('close'); }
}
(async () => {
  const all = [], messages = [], leaves = [], status = [], requests = [];
  const make = o => { const t = new Transport({ appVersion:'Ver179', Peer:FakePeer, ...o }); all.push(t); return t; };
  try {
    const host = make({onPeerRequest:(id,name)=>requests.push({id,name}),onMessage:(...a)=>messages.push(a), onPeerLeave:(...a)=>leaves.push(a)});
    const room = await host.createRoom();
    assert.equal(host.peer.options.config.iceServers.length, 1);
    assert.match(host.peer.options.config.iceServers[0].urls, /^stun:/);
    const received = [];
    const guest = make({displayName:'  ゲスト\u0000\u202e名'+'長'.repeat(40),onMessage:(...a)=>received.push(a)});
    let joined=false;const joining=guest.connect(room).then(v=>{joined=true;return v;});
    await until(()=>requests.length===1);
    assert.equal(host.links.get(guest.peer.id).ready,false);assert.equal(host.links.get(guest.peer.id).approved,false);
    assert([...requests[0].name].length<=24);assert(!/[\u0000\u202e]/.test(requests[0].name));
    for(const type of ['prepare','snapshotBase','snapshot','events','begin','match'])assert.equal(host.send(type,{secret:true},guest.peer.id),false);
    assert.equal(host.broadcast('snapshot',{secret:true}),0);
    assert.equal(guest.send('input',{seq:0}),false);
    await wait(80);assert.equal(joined,false);assert.equal(received.length,0);
    assert.equal(host.approvePeer(guest.peer.id),true);assert.equal(host.approvePeer(guest.peer.id),false);
    await joining;
    const sync=await guest.waitForClock();assert(sync.samples>=3);assert(Math.abs(sync.offsetMs)<50);
    // ホストの単調時計の原点が100秒ずれていても、四時刻から差を推定する。
    const hostLink=host.links.get(guest.peer.id), originalSend=hostLink.conn.send.bind(hostLink.conn);
    hostLink.conn.send=text=>{const m=JSON.parse(text);if(m.type==='pong'){m.payload.receivedAt+=100000;m.payload.sentAt+=100000;}originalSend(JSON.stringify(m));};
    const guestLink=guest.links.get(room);guestLink.clockSamples=[];guestLink.clockOffsetMs=null;
    const shifted=await guest.waitForClock();assert(Math.abs(shifted.offsetMs-100000)<50);
    hostLink.conn.send=originalSend;
    assert.equal(host.metrics().connectedPeers, 1);
    guest.send('input', {seq:1}); await wait(60);
    assert.equal(messages[0][0], 'input'); assert.equal(messages[0][2], guest.peer.id);
    const wrong = make({appVersion:'Ver178',onStatus:s=>status.push(s)});
    await assert.rejects(wrong.connect(room), /版が違います/);
    assert(status.some(s=>s.includes('Ver178')));
    const oldProtocol=make();const envelope=oldProtocol._envelope.bind(oldProtocol);
    oldProtocol._envelope=(...a)=>({...envelope(...a),protocolVersion:3});
    await assert.rejects(oldProtocol.connect(room), /通信規格が違います（自分: 4 \/ 相手: 3）/);
    const denied=make();const deniedResult=denied.connect(room).then(()=>null,e=>e);
    await until(()=>host.links.get(denied.peer?.id)?.pending);assert(host.rejectPeer(denied.peer.id));assert(!host.approvePeer(denied.peer.id));
    assert.match((await deniedResult).message,/入室を拒否/);
    const kicked=make();const kickJoining=kicked.connect(room);
    await until(()=>host.links.get(kicked.peer?.id)?.pending);assert(host.approvePeer(kicked.peer.id));await kickJoining;
    assert(host.kickPeer(kicked.peer.id));assert(!host.kickPeer(kicked.peer.id));
    assert.equal(host.send('snapshot',{secret:true},kicked.peer.id),false);await until(()=>!host.links.has(kicked.peer.id));
    const waiting=make();const waitingResult=waiting.connect(room).then(()=>null,e=>e);
    await until(()=>host.links.get(waiting.peer?.id)?.pending);
    const match = host.startMatch('test-match');
    assert.match((await waitingResult).message,/承認待ち/);assert(!host.kickPeer(guest.peer.id)); await wait(60);
    assert.equal(match, guest.matchId);
    const late = make(); await assert.rejects(late.connect(room), /途中参加/);
    host.peer.emit('disconnected');
    host.broadcast('event',{id:2}); await wait(60);
    assert(received.some(m=>m[0]==='event'));
    // 片道100msでも20Hzの状態が永久待ちにならない。
    host.latencyMs=100;
    for(let i=0;i<8;i++){host.broadcast('snapshot',{seq:i});await wait(50);}
    await wait(140);
    const snaps=received.filter(m=>m[0]==='snapshot');
    assert(snaps.length>=4); assert.equal(snaps.at(-1)[1].seq,7);
    const before=received.length; host.links.get(guest.peer.id).conn.dataChannel.bufferedAmount=300000;
    host.broadcast('snapshot',{seq:8}); await wait(140); assert.equal(received.length,before);
    host.links.get(guest.peer.id).conn.dataChannel.bufferedAmount=0;
    await until(()=>received.some(m=>m[0]==='snapshot'&&m[1].seq===8));
    const stats=host.metrics(); assert(stats.sentBytes>0); assert(stats.maxBufferedBytes>=300000);
    assert(stats.messageSizes.snapshot.count>=4);
    assert(stats.messageSizes.pending.count>0);
    for(const [type,size] of Object.entries(stats.messageSizes)) {
      assert.equal(size.totalBytes,stats.byType[type]);
      assert(size.minBytes>0 && size.maxBytes>=size.minBytes);
      assert(size.totalBytes>=size.count*size.minBytes && size.totalBytes<=size.count*size.maxBytes);
    }
    assert.equal(Object.values(stats.messageSizes).reduce((sum,s)=>sum+s.count,0),stats.sentMessages);
    assert.equal(Object.values(stats.messageSizes).reduce((sum,s)=>sum+s.totalBytes,0),stats.sentBytes);
    stats.messageSizes.snapshot.count=-1;
    assert(host.metrics().messageSizes.snapshot.count>0);
    guest.close(); await wait(30); assert.equal(leaves.length,2); assert.equal(host.metrics().connectedPeers,0);
    // 人間の承認操作を待つ枠と、承認済みの3人枠を別々に制限する。
    const limited=make();const limitedRoom=await limited.createRoom();const waitingGuests=[];
    for(let i=0;i<8;i++) {const g=make();const result=g.connect(limitedRoom).then(()=>({ok:true}),error=>({error}));waitingGuests.push({g,result});await until(()=>limited.links.get(g.peer?.id)?.pending);}
    const overflow=make();await assert.rejects(overflow.connect(limitedRoom),/承認待ちが上限/);
    for(let i=0;i<3;i++){assert(limited.approvePeer(waitingGuests[i].g.peer.id));assert((await waitingGuests[i].result).ok);}
    assert.equal(limited.approvePeer(waitingGuests[3].g.peer.id),false);assert.match((await waitingGuests[3].result).error.message,/満員/);
    const timed=waitingGuests[4];limited.links.get(timed.g.peer.id).opened=performance.now()-180001;limited._tick();assert.match((await timed.result).error.message,/3分/);
    const cancelled=waitingGuests[5];cancelled.g.close();assert((await cancelled.result).error);await until(()=>!limited.links.has(cancelled.g.peer.id));assert.equal(limited.approvePeer(cancelled.g.peer.id),false);
    // 人間定員はホスト込み。入室受付と承認の両方で適用する。
    const small=make({capacity:2}), smallRoom=await small.createRoom();
    const smallGuests=[];
    for(let i=0;i<3;i++) {const g=make();const result=g.connect(smallRoom).then(()=>({ok:true}),error=>({error}));smallGuests.push({g,result});await until(()=>small.links.get(g.peer?.id)?.pending);}
    assert(small.approvePeer(smallGuests[0].g.peer.id));await smallGuests[0].result;
    assert.equal(small.approvePeer(smallGuests[1].g.peer.id),false);assert.match((await smallGuests[1].result).error.message,/2人まで/);
    await assert.rejects(make().connect(smallRoom),/2人まで/);
    assert(small.setCapacity(3));assert(small.approvePeer(smallGuests[2].g.peer.id));await smallGuests[2].result;
    assert.equal(small.setCapacity(2),false);assert.equal(small.capacity,3);
    for(const invalid of [1,5,2.5,'3',null])assert.equal(small.setCapacity(invalid),false);
    assert.equal(smallGuests[0].g.setCapacity(4),false);
    small.startMatch();assert.equal(small.setCapacity(4),false);
    const bad = make({peerOptions:{config:{iceServers:[{urls:'turn:bad.invalid'}]}}});
    await assert.rejects(bad.createRoom(),/STUN/);
    console.log('オンライン通信：承認前の状態秘匿・許可・拒否・ロビー追放・待機者の開始拒否・表示名制限・版拒否・開始後参加拒否・入力・信号切断継続・100ms遅延・送信詰まり・切断・TURN拒否 成功');
  } finally { for(const t of all)t.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
