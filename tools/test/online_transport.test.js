// 通信境界の決定的な試験。実 WebRTC/ブラウザ試験とは別に、偽の Peer で検査する。
const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const Transport = require('../../prototype/online/transport.js');
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
  constructor(_, options) { super(); this.id = 'peer-' + ++serial; this.options = options; peers.set(this.id, this); queueMicrotask(() => this.emit('open', this.id)); }
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
    assert.equal(guest.send('inputBatch',{inputs:[{seq:1}]}),false);
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
    assert.equal(guest.send('input', {seq:1}),false);
    guest.send('inputActions', {seq:1}); await wait(60);
    assert.equal(messages[0][0], 'inputActions'); assert.equal(messages[0][2], guest.peer.id);
    const wrong = make({appVersion:'Ver178',onStatus:s=>status.push(s)});
    await assert.rejects(wrong.connect(room), /版が違います/);
    assert(status.some(s=>s.includes('Ver178')));
    const oldProtocol=make();const envelope=oldProtocol._envelope.bind(oldProtocol);
    oldProtocol._envelope=(...a)=>({...envelope(...a),protocolVersion:3});
    await assert.rejects(oldProtocol.connect(room), /通信規格が違います（自分: 6 \/ 相手: 3）/);
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
    const before=received.length; host.links.get(guest.peer.id).snapshotConn.dataChannel.bufferedAmount=300000;
    host.broadcast('snapshot',{seq:8}); await wait(140); assert.equal(received.length,before);
    host.links.get(guest.peer.id).snapshotConn.dataChannel.bufferedAmount=0;
    host.broadcast('snapshot',{seq:8});
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
    await until(()=>small.canStartMatch());small.startMatch();assert.equal(small.setCapacity(4),false);
    // 第2接続は承認後だけ作り、両openと制御線のready確認前にはロビー参加にしない。
    const pair=async (options,guestOptions)=>{
      const seen=[],h=make(options),g=make({onMessage:(...m)=>seen.push(m),...guestOptions}),room=await h.createRoom();
      const promise=g.connect(room);await until(()=>h.links.get(g.peer?.id)?.pending);
      h.approvePeer(g.peer.id);await promise;await until(()=>h.links.get(g.peer.id)?.ready);
      return {h,g,room,seen,hl:h.links.get(g.peer.id),gl:g.links.get(room)};
    };
    const inputPair=async (options,guestOptions)=>{
      const p=await pair(options,guestOptions);p.h.startMatch('input-match');await until(()=>p.g.started);return p;
    };
    const batch=seq=>({inputs:Array.from({length:Math.min(5,seq)},(_,i)=>({seq:Math.max(1,seq-4)+i,lifeId:1,keys:{KeyW:true},pressed:[]}))});
    const waitingHost=make(),waitingRoom=await waitingHost.createRoom(),waitingGuest=make();
    let pairJoined=false;const pairPromise=waitingGuest.connect(waitingRoom).then(()=>{pairJoined=true;});
    await until(()=>waitingHost.links.get(waitingGuest.peer?.id)?.pending);
    const unapprovedLink=waitingHost.links.get(waitingGuest.peer.id);
    assert.equal(unapprovedLink.snapshotConn,null);
    const orphan=waitingGuest.peer.connect(waitingRoom,{label:Transport.SNAPSHOT_LABEL,reliable:false,serialization:'raw',metadata:{protocolVersion:6,roomId:waitingRoom,controlId:unapprovedLink.conn.connectionId,token:'fake-token-before-approval'}});
    await wait(30);assert(orphan.closed);assert(waitingHost.links.has(waitingGuest.peer.id));assert(!unapprovedLink.approved);
    waitingHost._receive(unapprovedLink,JSON.stringify(waitingGuest._envelope('snapshot',{secret:true})),'snapshot');
    waitingHost._receive(unapprovedLink,JSON.stringify({...waitingGuest._envelope('inputBatch',batch(1)),inputSequence:1}),'snapshot');
    assert.equal(unapprovedLink.assemblies.size,0);assert(!unapprovedLink.approved);
    waitingGuest.peer.pauseSnapshotOpen=true;
    assert(waitingHost.approvePeer(waitingGuest.peer.id));
    await until(()=>waitingGuest.peer.releaseSnapshot);
    assert.equal(waitingHost.canStartMatch(),false);assert.throws(()=>waitingHost.startMatch('not-yet'),/両方/);
    assert.equal(waitingHost.started,false);assert.equal(pairJoined,false);
    assert.equal(waitingHost.metrics().connectedPeers,0);assert.equal(waitingHost.setCapacity(2),true);
    waitingGuest.peer.releaseSnapshot();await pairPromise;await until(()=>waitingHost.canStartMatch());
    const live=waitingHost.links.get(waitingGuest.peer.id),actual=waitingHost.metrics().peers[0].channels;
    assert.equal(actual.control.ordered,true);assert.equal(actual.control.maxRetransmits,null);
    assert.equal(actual.snapshot.ordered,false);assert.equal(actual.snapshot.maxRetransmits,0);
    assert.equal(actual.snapshot.maxPacketLifeTime,null);
    const duplicate=waitingGuest.peer.connect(waitingRoom,{label:Transport.SNAPSHOT_LABEL,reliable:false,serialization:'raw',metadata:{protocolVersion:6,roomId:waitingRoom,controlId:live.conn.connectionId,token:live.snapshotToken}});
    await wait(30);assert(duplicate.closed);assert.equal(live.snapshotConn.closed,false);
    live.snapshotConn.close();await until(()=>!waitingHost.links.size&&!waitingGuest.links.size);
    // 接続tokenが異なる相手の第2線はcontrolと結び付けない。
    const badHost=make(),badRoom=await badHost.createRoom(),badGuest=make();
    const badJoin=badGuest.connect(badRoom).then(()=>null,e=>e);
    await until(()=>badHost.links.get(badGuest.peer?.id)?.pending);
    const badConnect=badGuest.peer.connect.bind(badGuest.peer);
    badGuest.peer.connect=(id,o)=>badConnect(id,{...o,metadata:o.metadata?{...o.metadata,token:'wrong-token-xxxxxxxx'}:o.metadata});
    badHost.approvePeer(badGuest.peer.id);assert.match((await badJoin).message,/状態用チャネル/);
    await until(()=>!badHost.links.size);
    // 逆順の状態は最新だけ適用。基準は写真と別系列で、遅れた親も受け取る。
    const order=await pair(),packets=[],write=order.hl.snapshotConn.send.bind(order.hl.snapshotConn);
    order.hl.snapshotConn.send=text=>packets.push(text);
    for(let seq=1;seq<=3;seq++){assert(order.h.send('snapshot',{seq},order.g.peer.id));order.h._tick();}
    assert.equal(packets.length,3);
    for(const raw of packets.reverse())order.gl.snapshotConn.emit('data',raw);
    assert.deepEqual(order.seen.filter(m=>m[0]==='snapshot').map(m=>m[1].seq),[3]);
    packets.length=0;
    for(let id=1;id<=2;id++){order.h.send('snapshotBase',{id},order.g.peer.id);order.h._tick();}
    for(const raw of packets.reverse())order.gl.snapshotConn.emit('data',raw);
    order.gl.snapshotConn.emit('data',packets[0]);
    assert.deepEqual(order.seen.filter(m=>m[0]==='snapshotBase').map(m=>m[1].id),[2,1]);
    assert(order.g.metrics().snapshotDrops.stale>=3);
    order.hl.snapshotConn.send=write;
    // 片方の送信詰まりは他方を待たせない。結果は写真のdrop対象外。
    order.hl.snapshotConn.dataChannel.bufferedAmount=300000;
    order.h.send('snapshot',{seq:4},order.g.peer.id);order.h.send('matchEnded',{winner:'B'},order.g.peer.id);order.h._tick();
    await until(()=>order.seen.some(m=>m[0]==='matchEnded'));assert(order.h.metrics().snapshotDrops.congestion>0);
    order.hl.snapshotConn.dataChannel.bufferedAmount=0;order.hl.conn.dataChannel.bufferedAmount=300000;
    order.h.send('snapshot',{seq:5},order.g.peer.id);order.h._tick();
    await until(()=>order.seen.some(m=>m[0]==='snapshot'&&m[1].seq===5));order.hl.conn.dataChannel.bufferedAmount=0;
    assert.equal(order.g.send('snapshot',{seq:7}),false);assert.equal(order.g.send('snapshotBase',{id:7}),false);
    // 基準130KB超を実送信サイズ16KiB以下へ分割。毎回別の20%断片を欠損しても同じ基準の再同期で穴を埋める。
    const fragmented=await pair(),base={id:1,contents:'基準'.repeat(24000)},rawPackets=[];
    let round=0;
    const fragmentSend=fragmented.hl.snapshotConn.send.bind(fragmented.hl.snapshotConn);
    fragmented.hl.snapshotConn.send=text=>{
      const p=JSON.parse(text);rawPackets.push(p);
      assert(Buffer.byteLength(text)<=16384);
      if(p.type==='snapshotChunk'&&p.payload.index%5===round)return;
      fragmentSend(text);
    };
    fragmented.h.send('snapshotBase',base,fragmented.g.peer.id);fragmented.h._tick();await wait(30);
    assert.equal(fragmented.seen.filter(m=>m[0]==='snapshotBase').length,0);
    assert.equal(fragmented.gl.assemblies.size,1);assert(rawPackets.length>=15);
    const firstSequence=rawPackets[0].payload.sequence;round=1;
    fragmented.h.send('snapshotBase',base,fragmented.g.peer.id);fragmented.h._tick();
    await until(()=>fragmented.seen.some(m=>m[0]==='snapshotBase'));
    assert.deepEqual(fragmented.seen.find(m=>m[0]==='snapshotBase')[1],base);
    assert(rawPackets.every(p=>p.payload.sequence===firstSequence));assert.equal(fragmented.gl.assemblies.size,0);
    fragmented.h.send('snapshotBase',base,fragmented.g.peer.id);fragmented.h._tick();await wait(30);
    assert.equal(fragmented.seen.filter(m=>m[0]==='snapshotBase').length,1);
    assert.equal(fragmented.h.send('snapshotBase',{contents:'x'.repeat(262144)},fragmented.g.peer.id),false);
    // 別内容の基準/別matchを混ぜない。未完了組は4個まで、基準は10秒で破棄。
    fragmented.hl.snapshotConn.send=text=>{
      const p=JSON.parse(text);if(p.type==='snapshotChunk'&&p.payload.index===0)fragmentSend(text);
    };
    for(let id=2;id<=6;id++){fragmented.h.send('snapshotBase',{...base,id},fragmented.g.peer.id);fragmented.h._tick();await wait(5);}
    assert.equal(fragmented.gl.assemblies.size,4);
    const oldRoom={...rawPackets[0],matchId:'another-match'};
    fragmented.gl.snapshotConn.emit('data',JSON.stringify(oldRoom));assert.equal(fragmented.gl.assemblies.size,4);
    for(const a of fragmented.gl.assemblies.values())a.at=performance.now()-10001;
    fragmented.g._tick();assert.equal(fragmented.gl.assemblies.size,0);assert(fragmented.g.metrics().snapshotDrops.incomplete>=5);
    fragmented.hl.snapshotConn.send=fragmentSend;
    // 5%/20%は決定的な乱数列で論理写真100件中5/20件だけ欠損。制御100件は欠けない。
    for(const rate of [.05,.2]) {
      let n=0;const loss=await pair({snapshotDropRate:rate,random:()=>n++/100});
      for(let i=0;i<100;i++){loss.h.send('snapshot',{i},loss.g.peer.id);loss.h.send('events',{i},loss.g.peer.id);loss.h._tick();}
      await until(()=>loss.seen.filter(m=>m[0]==='events').length===100);
      assert.equal(loss.seen.filter(m=>m[0]==='snapshot').length,100-rate*100);
      const m=loss.h.metrics();assert.equal(m.snapshotDropRate,rate);assert.equal(m.snapshotDrops.artificial,rate*100);
      assert.equal(m.snapshotDropUnit,'logical-message');assert(m.byChannel.control.sentBytes>0&&m.byChannel.snapshot.sentBytes>0);
      assert.equal(m.byChannel.control.sentBytes+m.byChannel.snapshot.sentBytes,m.sentBytes);
      assert.equal(m.byChannel.control.receivedBytes+m.byChannel.snapshot.receivedBytes,m.receivedBytes);
      m.snapshotDrops.artificial=-1;assert(loss.h.metrics().snapshotDrops.artificial>0);
    }
    // 最新5コマを1batchで非再送線へ。4連続欠損・逆転・重複でもcontrolを待たず届く。
    const inputMessages=[],inputWire=await inputPair({onMessage:(...m)=>inputMessages.push(m)}),inputPackets=[],controlTypes=[];
    const inputWrite=inputWire.gl.snapshotConn.send.bind(inputWire.gl.snapshotConn),controlWrite=inputWire.gl.conn.send.bind(inputWire.gl.conn);
    inputWire.gl.snapshotConn.send=text=>inputPackets.push(text);
    inputWire.gl.conn.send=text=>{controlTypes.push(JSON.parse(text).type);controlWrite(text);};
    assert.equal(inputWire.h.send('inputBatch',batch(1),inputWire.g.peer.id),false);
    assert.equal(inputWire.h.send('inputActions',{seq:1},inputWire.g.peer.id),false);
    for(let seq=1;seq<=8;seq++){assert(inputWire.g.send('inputBatch',batch(seq)));inputWire.g._tick();}
    assert.equal(inputPackets.length,8);assert(inputPackets.every(raw=>Buffer.byteLength(raw)<=8192));
    assert.equal(inputWire.gl.queue.filter(m=>m.type==='inputBatch').length,0);
    assert.deepEqual(JSON.parse(inputPackets.at(-1)).payload.inputs.map(x=>x.seq),[4,5,6,7,8]);
    inputWire.hl.snapshotConn.emit('data',inputPackets[4]); // 最初の4batchは欠け、5個目で1〜5を補う。
    for(const raw of inputPackets.slice(5).reverse())inputWire.hl.snapshotConn.emit('data',raw);
    inputWire.hl.snapshotConn.emit('data',inputPackets[7]);
    assert.deepEqual(inputMessages.filter(m=>m[0]==='inputBatch').map(m=>m[1].inputs.at(-1).seq),[5,8,7,6]);
    assert.deepEqual([...new Set(inputMessages.flatMap(m=>m[1].inputs.map(x=>x.seq)))].sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
    assert.equal(inputWire.h.metrics().inputDrops.duplicate,1);
    assert.equal(inputWire.hl.receivedSequence.snapshot,0);assert.equal(inputWire.hl.receivedSequence.snapshotBase,0);
    assert.equal(inputWire.hl.assemblies.size,0);
    inputWire.g.send('inputActions',{seq:1,lifeId:1,trigger:true});inputWire.g._tick();
    await until(()=>inputMessages.some(m=>m[0]==='inputActions'));
    assert(controlTypes.includes('inputActions'));assert(!controlTypes.includes('inputBatch'));assert(!controlTypes.includes('input'));
    inputWire.gl.snapshotConn.send=inputWrite;
    // 古い試合/承認token/接続のbatchは現在の対戦へ適用しない。正しい接続は残す。
    const oldCount=inputMessages.length,valid={...JSON.parse(inputPackets[7]),inputSequence:9,payload:batch(9)};
    inputWire.hl.snapshotConn.emit('data',JSON.stringify({...valid,matchId:'previous-match'}));
    inputWire.hl.snapshotConn.emit('data',JSON.stringify({...valid,connectionToken:'previous-control-token'}));
    inputWire.h._receive({...inputWire.hl},JSON.stringify(valid),'snapshot');
    assert.equal(inputMessages.length,oldCount);assert.equal(inputWire.h.metrics().connectedPeers,1);
    inputWire.hl.snapshotConn.emit('data',JSON.stringify(valid));assert.equal(inputMessages.length,oldCount+1);
    // 60/240Hz相当の採取で50/100msの最低遅延を全実送信batchについて検査する。
    // dueだけを見ず、最新コマの生成時刻→snapshotConn.send時刻を測る。futureの早送りを許さない。
    for(const latencyMs of [50,100])for(const [hz,interval,count] of [[60,17,72],[240,4,300]]) {
      const generated=new Map(),sent=[],arrived=[];
      const delayed=await inputPair({onMessage:(type,payload)=>{if(type==='inputBatch')arrived.push(payload.inputs.at(-1).seq);}},{latencyMs});
      const write=delayed.gl.snapshotConn.send.bind(delayed.gl.snapshotConn);
      delayed.gl.snapshotConn.send=raw=>{
        const message=JSON.parse(raw),seq=message.payload.inputs.at(-1).seq,t=performance.now();
        sent.push({seq,at:t,ageMs:t-generated.get(seq)});write(raw);
      };
      for(let seq=1;seq<=count;seq++) {
        const payload=batch(seq);generated.set(seq,performance.now());
        assert(delayed.g.send('inputBatch',payload));await wait(interval);
      }
      await until(()=>arrived.includes(count));
      assert(sent.length>=20);assert.equal(delayed.h.metrics().connectedPeers,1);
      assert.equal(delayed.g.metrics().inputDrops.rateLimited,0);
      assert(sent.every(item=>Number.isFinite(item.ageMs)&&item.ageMs>=latencyMs),`${hz}Hz/${latencyMs}msで未来のbatchを早送りした`);
      assert(Math.max(...sent.slice(1).map((item,i)=>item.at-sent[i].at))<250);
      console.log(`入力人工遅延 ${hz}Hz/${latencyMs}ms: ${sent.length}batch、生成→実送信 最小${Math.min(...sent.map(item=>item.ageMs)).toFixed(3)}ms、最大${Math.max(...sent.map(item=>item.ageMs)).toFixed(3)}ms`);
    }
    // 入力線の詰まりは最新batchへ集約し、controlの一度きり操作は通す。反対向きの写真も独立。
    const congestedInputs=[],congested=await inputPair({onMessage:(...m)=>congestedInputs.push(m)});
    congested.gl.snapshotConn.dataChannel.bufferedAmount=300000;
    for(let seq=1;seq<=10;seq++){congested.g.send('inputBatch',batch(seq));congested.g._tick();}
    assert.equal(congested.gl.inputs.length,1);assert.equal(JSON.parse(congested.gl.inputs[0].text).payload.inputs.at(-1).seq,10);
    congested.g.send('inputActions',{seq:1,lifeId:1,trigger:true});congested.g._tick();
    congested.h.send('snapshot',{seq:1},congested.g.peer.id);congested.h._tick();
    await until(()=>congestedInputs.some(m=>m[0]==='inputActions')&&congested.seen.some(m=>m[0]==='snapshot'));
    assert.equal(congestedInputs.filter(m=>m[0]==='inputBatch').length,0);assert(congested.g.metrics().inputDrops.congestion>=9);
    congested.gl.snapshotConn.dataChannel.bufferedAmount=0;congested.g._tick();
    await until(()=>congestedInputs.some(m=>m[0]==='inputBatch'));
    assert.deepEqual(congestedInputs.filter(m=>m[0]==='inputBatch').map(m=>m[1].inputs.at(-1).seq),[10]);
    congested.gl.conn.dataChannel.bufferedAmount=300000;
    congested.g.send('inputBatch',batch(11));congested.g._tick();
    await until(()=>congestedInputs.some(m=>m[0]==='inputBatch'&&m[1].inputs.at(-1).seq===11));
    congested.gl.conn.dataChannel.bufferedAmount=0;
    congested.g.send('inputBatch',batch(12));congested.gl.inputs[0].due=performance.now()-251;congested.g._tick();
    await wait(25);assert(!congestedInputs.some(m=>m[0]==='inputBatch'&&m[1].inputs.at(-1).seq===12));
    assert.equal(congested.g.metrics().inputDrops.stale,1);
    // 写真と入力の欠損設定/乱数/集計は独立。入力を5/20%落としてもcontrol操作は100件届く。
    for(const rate of [.05,.2]) {
      let n=0;const seen=[],loss=await inputPair({onMessage:(...m)=>seen.push(m)},{inputDropRate:rate,inputRandom:()=>n++/100,snapshotDropRate:.2,random:()=>0});
      for(let seq=1;seq<=100;seq++){assert(loss.g.send('inputBatch',batch(seq)));loss.g.send('inputActions',{seq});loss.g._tick();}
      await until(()=>seen.filter(m=>m[0]==='inputActions').length===100);
      assert.equal(seen.filter(m=>m[0]==='inputBatch').length,100-rate*100);
      const m=loss.g.metrics();assert.equal(m.inputDropRate,rate);assert.equal(m.inputDropUnit,'logical-batch');assert.equal(m.inputDrops.artificial,rate*100);
      assert.equal(m.snapshotDrops.artificial,0);assert.equal(loss.h.metrics().snapshotDrops.artificial,0);
      assert(m.byChannel.snapshot.sentBytes>0);assert.equal(m.byChannel.snapshot.sentBytes,m.byType.inputBatch);
      m.inputDrops.artificial=-1;assert(loss.g.metrics().inputDrops.artificial>0);
    }
    // batch数/コマ数/サイズに上限。過剰な採取は集約、送信はtokenで制限し受信側の暴走はその接続だけ切る。
    const bounded=await inputPair();
    for(const payload of [{inputs:[]},{inputs:Array.from({length:6},(_,i)=>({seq:i+1}))},{inputs:[null]},{inputs:[{seq:0}]},{inputs:[{seq:1,extra:'x'.repeat(8192)}]}])assert.equal(bounded.g.send('inputBatch',payload),false);
    clearInterval(bounded.g._tickTimer);
    for(let seq=1;seq<=120;seq++)assert(bounded.g.send('inputBatch',batch(seq)));
    assert.equal(bounded.g.metrics().connectedPeers,1);assert.equal(bounded.gl.inputs.length,16);
    bounded.gl.inputSendWindow={at:performance.now(),tokens:0};bounded.g._tick();
    assert.equal(bounded.gl.inputs.length,16);assert.equal(bounded.g.metrics().inputDrops.rateLimited,1);
    bounded.gl.inputSendWindow.tokens=120;bounded.g._tick();assert.equal(bounded.gl.inputs.length,0);
    const peerInputs=[],otherMessages=[],flood=await pair({onMessage:(...m)=>peerInputs.push(m)}),other=make({onMessage:(...m)=>otherMessages.push(m)}),otherJoin=other.connect(flood.room);
    await until(()=>flood.h.links.get(other.peer?.id)?.pending);flood.h.approvePeer(other.peer.id);await otherJoin;await until(()=>flood.h.canStartMatch());
    flood.h.startMatch('input-flood');await until(()=>flood.g.started&&other.started);
    flood.hl.snapshotConn.dataChannel.bufferedAmount=300000;
    flood.h.send('snapshot',{seq:1},flood.g.peer.id);flood.h.send('events',{seq:1},flood.g.peer.id);
    flood.h.send('snapshot',{seq:1},other.peer.id);flood.h._tick();
    assert(other.send('inputBatch',batch(1)));other._tick();
    await until(()=>otherMessages.some(m=>m[0]==='snapshot')&&flood.seen.some(m=>m[0]==='events')&&peerInputs.some(m=>m[0]==='inputBatch'&&m[2]===other.peer.id));
    assert(!flood.seen.some(m=>m[0]==='snapshot'));flood.hl.snapshotConn.dataChannel.bufferedAmount=0;
    flood.hl.inputReceiveWindow={at:performance.now(),tokens:240};
    const floodPacket=flood.g._envelope('inputBatch',batch(1));floodPacket.connectionToken=flood.gl.snapshotToken;
    for(let seq=1;seq<=250;seq++)flood.hl.snapshotConn.emit('data',JSON.stringify({...floodPacket,inputSequence:seq}));
    assert.equal(flood.h.links.has(flood.g.peer.id),false);assert.equal(flood.h.links.has(other.peer.id),true);assert.equal(flood.h.metrics().inputDrops.rateLimited,1);
    assert(other.send('inputBatch',batch(2)));other._tick();await wait(25);assert.equal(flood.h.metrics().connectedPeers,1);
    // 256番号以内ならbatch逆転を通し、受信履歴は上限付き。古すぎる番号は捨てる。
    const replayMessages=[],replay=await inputPair({onMessage:(...m)=>replayMessages.push(m)});
    const replayPacket={...replay.g._envelope('inputBatch',batch(1)),connectionToken:replay.gl.snapshotToken};
    for(let seq=1;seq<=300;seq++){replay.hl.inputReceiveWindow.tokens=240;replay.hl.snapshotConn.emit('data',JSON.stringify({...replayPacket,inputSequence:seq}));}
    assert.equal(replay.hl.receivedInputBatches.size,256);
    replay.hl.snapshotConn.emit('data',JSON.stringify({...replayPacket,inputSequence:1}));
    assert.equal(replayMessages.length,300);assert.equal(replay.h.metrics().inputDrops.stale,1);
    // 制御/非再送線の型と方向を厳密に分ける。ゲストの写真断片は組み立てない。
    for(const attack of ['control-snapshot','snapshot-control','guest-snapshot','control-input','control-inputBatch','host-inputBatch','oversize-input','malformed-input']) {
      const isolated=await pair();
      if(attack==='control-snapshot')isolated.hl.conn.send(JSON.stringify({...isolated.h._envelope('snapshot',{}),snapshotSequence:1}));
      else if(attack==='snapshot-control')isolated.hl.snapshotConn.send(JSON.stringify(isolated.h._envelope('input',{})));
      else if(attack==='control-input'||attack==='control-inputBatch')isolated.gl.conn.send(JSON.stringify(isolated.g._envelope(attack==='control-input'?'input':'inputBatch',batch(1))));
      else if(attack==='host-inputBatch')isolated.hl.snapshotConn.send(JSON.stringify(isolated.h._envelope('inputBatch',batch(1))));
      else if(attack==='oversize-input')isolated.gl.snapshotConn.send(JSON.stringify(isolated.g._envelope('inputBatch',{inputs:[{seq:1,extra:'x'.repeat(8192)}]})));
      else if(attack==='malformed-input') {
        isolated.h.startMatch('malformed');await until(()=>isolated.g.started);
        isolated.gl.snapshotConn.send(JSON.stringify({...isolated.g._envelope('inputBatch',{inputs:Array.from({length:6},(_,i)=>({seq:i+1}))}),inputSequence:1,connectionToken:isolated.gl.snapshotToken}));
      }
      else isolated.gl.snapshotConn.send(JSON.stringify(isolated.g._envelope('snapshotChunk',{type:'snapshotBase',sequence:1,count:20,index:0,data:'eA=='})));
      await until(()=>!isolated.h.links.size&&!isolated.g.links.size);
      assert.equal(isolated.seen.length,0);assert.equal(isolated.hl.assemblies.size,0);
    }
    // JSONとして有効なnullを分割しても、復元先の型を検証して例外を漏らさない。
    const nullChunks=await pair();
    for(const [index,data] of ['nu','ll'].entries()) {
      assert.doesNotThrow(()=>nullChunks.gl.snapshotConn.emit('data',JSON.stringify(nullChunks.h._envelope('snapshotChunk',
        {type:'snapshotBase',sequence:1,count:2,index,data:Buffer.from(data).toString('base64')}))));
    }
    assert.equal(nullChunks.g.links.size,0);
    // 片線しか開かない接続も期限内に拒否。誤ったRTC設定でreadyにはしない。
    const timeoutHost=make(),timeoutRoom=await timeoutHost.createRoom(),timeoutGuest=make();
    const timeoutJoin=timeoutGuest.connect(timeoutRoom).then(()=>null,e=>e);
    await until(()=>timeoutHost.links.get(timeoutGuest.peer?.id)?.pending);
    timeoutGuest.peer.pauseSnapshotOpen=true;timeoutHost.approvePeer(timeoutGuest.peer.id);
    await until(()=>timeoutGuest.peer.releaseSnapshot);
    timeoutHost.links.get(timeoutGuest.peer.id).opened=performance.now()-15001;timeoutHost._tick();
    assert.match((await timeoutJoin).message,/時間切れ/);
    const settingHost=make(),settingRoom=await settingHost.createRoom(),settingGuest=make();
    const settingJoin=settingGuest.connect(settingRoom).then(()=>null,e=>e);
    await until(()=>settingHost.links.get(settingGuest.peer?.id)?.pending);
    settingGuest.peer.pauseSnapshotOpen=true;settingHost.approvePeer(settingGuest.peer.id);
    await until(()=>settingGuest.peer.releaseSnapshot);
    const wrongChannel=settingHost.links.get(settingGuest.peer.id).snapshotConn;
    wrongChannel.dataChannel.maxRetransmits=null;settingGuest.peer.releaseSnapshot();
    assert.match((await settingJoin).message,/状態用チャネル/);assert.equal(settingHost.metrics().connectedPeers,0);
    const bad = make({peerOptions:{config:{iceServers:[{urls:'turn:bad.invalid'}]}}});
    await assert.rejects(bad.createRoom(),/STUN/);
    console.log('オンライン通信：二経路・双方向の型制限・連続入力5コマ冗長・欠損/逆転/重複・独立input/snapshot番号と5/20%論理欠損・入力サイズ/頻度/期限上限・詰まり最新集約・他peer独立・旧試合/接続拒否・一度きり操作control・両ready・実設定検査（fake）・巨大基準の断片欠損復旧・承認/拒否・版拒否・100ms遅延・切断・TURN拒否 成功');
  } finally { for(const t of all)t.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
