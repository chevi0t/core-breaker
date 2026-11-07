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
  connect(id, options) { assert.equal(options.reliable, true); assert.equal(options.serialization, 'raw'); const a = new FakeConnection(id), b = new FakeConnection(this.id); a.other=b; b.other=a; queueMicrotask(() => { const target = peers.get(id); if (!target) return; target.emit('connection', b); a.open=b.open=true; b.emit('open'); a.emit('open'); }); return a; }
  destroy() { peers.delete(this.id); this.emit('close'); }
}
(async () => {
  const all = [], messages = [], leaves = [], status = [];
  const make = o => { const t = new Transport({ appVersion:'Ver179', Peer:FakePeer, ...o }); all.push(t); return t; };
  try {
    const host = make({onMessage:(...a)=>messages.push(a), onPeerLeave:(...a)=>leaves.push(a)});
    const room = await host.createRoom();
    assert.equal(host.peer.options.config.iceServers.length, 1);
    assert.match(host.peer.options.config.iceServers[0].urls, /^stun:/);
    const received = [];
    const guest = make({onMessage:(...a)=>received.push(a)});
    await guest.connect(room);
    assert.equal(host.metrics().connectedPeers, 1);
    guest.send('input', {seq:1}); await wait(60);
    assert.equal(messages[0][0], 'input'); assert.equal(messages[0][2], guest.peer.id);
    const wrong = make({appVersion:'Ver178',onStatus:s=>status.push(s)});
    await assert.rejects(wrong.connect(room), /版が違います/);
    assert(status.some(s=>s.includes('Ver178')));
    const match = host.startMatch('test-match'); await wait(60);
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
    guest.close(); await wait(30); assert.equal(leaves.length,1); assert.equal(host.metrics().connectedPeers,0);
    const bad = make({peerOptions:{config:{iceServers:[{urls:'turn:bad.invalid'}]}}});
    await assert.rejects(bad.createRoom(),/STUN/);
    console.log('オンライン通信：版拒否・開始後参加拒否・入力・信号切断継続・100ms遅延・送信詰まり・切断・TURN拒否 成功');
  } finally { for(const t of all)t.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
