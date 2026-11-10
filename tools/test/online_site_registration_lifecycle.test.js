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


const test=require('node:test');
const settlement=p=>Promise.race([p.then(value=>({ok:true,value}),error=>({ok:false,error:error.message})),wait(100).then(()=>({timeout:true}))]);
for(const method of ['createRoom','connect'])test('登録中の取消で '+method+' は拒否として完了する',async()=>{
 const t=new Transport({appVersion:'lifecycle-regression',Peer:FakePeer,peerOptions:{pauseOpen:true}});
 const p=method==='createRoom'?t.createRoom():t.connect('some-room');await wait(1);t.close('取消');
 assert.deepEqual(await settlement(p),{ok:false,error:'取消'});
});
test('登録前のPeer closeでも作成の待ちを終了する',async()=>{
 const t=new Transport({appVersion:'lifecycle-regression',Peer:FakePeer,peerOptions:{pauseOpen:true}});const p=t.createRoom();await wait(1);t.peer.emit('close');
 assert.deepEqual(await settlement(p),{ok:false,error:'接続サービスが終了しました'});
});
test('取消後の遅延openは成功を返さない',async()=>{
 const t=new Transport({appVersion:'lifecycle-regression',Peer:FakePeer,peerOptions:{pauseOpen:true}});const p=t.createRoom();await wait(1);t.close('取消');t.peer.emit('open',t.peer.id);
 assert.deepEqual(await settlement(p),{ok:false,error:'取消'});assert.equal(t.roomId,'');
});

for(const method of ['createRoom','connect'])test('open直後の同じmicrotaskでcloseしても '+method+' を継続しない',async()=>{
 const t=new Transport({appVersion:'lifecycle-regression',Peer:FakePeer,peerOptions:{pauseOpen:true}});
 const p=method==='createRoom'?t.createRoom():t.connect('some-room');let called=false;
 t.peer.connect=()=>{called=true;throw Error('取り消した接続を開始した');};
 t.peer.emit('open',t.peer.id);t.close('取消');const result=await settlement(p);
 assert.equal(result.ok,false);assert.match(result.error,/取り消しました/);assert(!called);
 if(method==='createRoom')assert.equal(t.roomId,'');
 assert.equal(t._cancelOpen,null);assert.equal(t._timers.size,0);assert(t.closed);
});
for(const method of ['createRoom','connect'])for(const failure of ['error','timeout'])test(failure+'後の遅延open/closeで '+method+' の結果を変えず後片付けする',async()=>{
 const t=new Transport({appVersion:'lifecycle-regression',Peer:FakePeer,peerOptions:{pauseOpen:true}});
 const later=t._later.bind(t);t._later=(fn,ms)=>later(fn,ms===15000?5:ms);
 const p=method==='createRoom'?t.createRoom():t.connect('some-room');
 if(failure==='error')t.peer.emit('error',new Error('登録失敗'));
 const result=await settlement(p);assert.equal(result.ok,false);
 assert.match(result.error,failure==='error'?/登録失敗/:/時間切れ/);
 t.peer.emit('open',t.peer.id);t.peer.emit('close');t.close('二度目');
 if(method==='createRoom')assert.equal(t.roomId,'');
 assert.equal(t._cancelOpen,null);assert.equal(t._timers.size,0);assert(t.closed);
});
