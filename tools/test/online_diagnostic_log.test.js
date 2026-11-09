// 診断ログの許可リスト・保持上限。通信やブラウザを使わない。
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Recorder,KEY,LIMITS,reasonCode,safeSample}=require('./online_diagnostic_fixture');
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
const secret='PRIVATE_IP_192.0.2.1_NAME_CHAT_SDP_PEER_ROOM_ERROR';
const sample=()=>({role:'host',phase:'playing',humans:3,capacity:4,teamSize:5,map:'mesa',diagnostic:{fps:60,frame:{count:120,meanMs:16.667,p95Ms:20,maxMs:30},visibility:'visible',corrections:{count:3,reasons:{distance:1,[secret]:5}}},transport:{sentBytes:12345,receivedBytes:900,peers:[{id:secret}],closedPeers:[{reason:secret}],rtt:{count:2,minMs:20,meanMs:30,maxMs:40}},peerId:secret,chat:secret,sdp:secret,error:secret});
function setup(store=storage()){let mono=0,wall=1800000000000;const r=new Recorder({storage:store,now:()=>wall,monotonic:()=>mono,maps:['mesa']});return {r,store,tick:n=>{mono+=n;wall+=n;},begin:()=>r.begin({role:'host',version:'Ver179',protocol:9},sample())};}
test('記録・再読込とも許可項目だけ、未知文字列・非有限値・IDを捨てる',()=>{
 const {r,store,begin}=setup();begin();r.event(secret,secret,{phase:secret,humans:secret});r.sample({...sample(),map:secret,transport:{sentBytes:Infinity}},true);r.flush();
 assert(!r.preview().includes(secret));assert(!store.getItem(KEY).includes(secret));
 const restored=new Recorder({storage:store,now:()=>1800000000000,maps:['mesa']});assert.equal(restored.sessions[0].samples[0].data.fps,60);assert.equal(restored.sessions[0].samples[0].data.transport.sentBytes,12345);assert.equal(restored.sessions[0].samples[0].data.transport.rtt.meanMs,30);
 const raw=JSON.parse(store.getItem(KEY));raw.sessions[0].peerId=secret;raw.sessions[0].version=secret;raw.sessions[0].samples[0].data.diagnostic={fps:secret};raw.sessions[0].events[0].reason=secret;store.setItem(KEY,JSON.stringify(raw));
 assert(!new Recorder({storage:store,now:()=>1800000000000,maps:['mesa']}).preview().includes(secret));
 assert.equal(safeSample({diagnostic:{fps:NaN,visibility:secret},transport:{sentBytes:-1}}).transport.sentBytes,null);
});
test('標本頻度・件数・イベント数・総バイト数・3接続を制限',()=>{
 const {r,tick,begin,store}=setup();begin();const first=r.active.samples.length;r.sample(sample());assert.equal(r.active.samples.length,first);
 for(let i=0;i<400;i++){tick(2000);r.sample(sample());r.event('transport_error',secret,sample());}
 assert(r.active.samples.length<=LIMITS.samples);assert(r.active.events.length<=LIMITS.events);assert(r.active.droppedSamples>0);assert(r.active.droppedEvents>0);
 for(let i=0;i<5;i++){r.end('local_leave',sample());tick(1);begin();}r.flush();assert.equal(r.sessions.length,3);assert(Buffer.byteLength(store.getItem(KEY))<=LIMITS.bytes);
});
test('7日を過ぎた記録、壊れた保存、保存不可でも安全',()=>{
 const {r,tick,begin,store}=setup();begin();r.end('local_leave',sample());tick(8*86400000);assert(!r.preview().includes('Ver179'));
 store.setItem(KEY,'{bad');assert.doesNotThrow(()=>setup(store));
 const bad={getItem(){throw Error(secret);},setItem(){throw Error(secret);},removeItem(){throw Error(secret);}};const x=setup(bad);x.begin();assert(!x.r.storageAvailable);assert(!x.r.preview().includes(secret));x.r.clear();assert.equal(x.r.sessions.length,0);
});
test('切断前の最終値を保ち、プレビューは外部参照で書き換わらない',()=>{
 const {r,begin,tick}=setup();begin();tick(123);const s=sample();r.end('対戦接続エラー: '+secret,s);s.transport.sentBytes=0;s.diagnostic.frame.meanMs=0;
 assert.equal(r.sessions[0].samples.at(-1).data.transport.sentBytes,12345);assert.equal(r.sessions[0].samples.at(-1).data.frame.meanMs,16.667);assert.equal(r.sessions[0].events.at(-1).reason,'connection_error');assert.equal(r.sessions[0].ended,true);assert.equal(r.active,null);
});
test('固定理由コードだけ、版不一致やタイムアウトを区別',()=>{
 assert.equal(reasonCode('ゲームの版が違います（自分: Ver179 / 相手: '+secret+'）'),'version_mismatch');assert.equal(reasonCode(secret),'other');assert.equal(reasonCode('ホストから5秒間応答がありません'),'host_timeout');
});
test('別タブの接続が増えても現在の記録を上限内で保持',()=>{
 const {r,store,begin}=setup();begin();const active=r.active;for(let i=1;i<5;i++){const other=new Recorder({storage:store,now:()=>1800000000000+i,maps:['mesa']});other.begin({role:'guest',version:'Ver179',protocol:9},sample());}r.flush();assert.equal(r.sessions.length,3);assert(r.sessions.includes(active));assert(!r.preview().includes(secret));
});

test('ロビー待機で通常標本が一周しても終了直前の要約を保つ',()=>{
 const {r,begin,tick,store}=setup();begin();r.checkpoint('match_finished','none',sample());
 for(let i=0;i<350;i++){tick(2000);r.sample({...sample(),phase:'lobby',transport:{sentBytes:0}});}r.flush();
 assert.equal(r.active.lastMatch.data.transport.sentBytes,12345);assert.equal(r.active.lastMatch.data.phase,'playing');
 const next=new Recorder({storage:store,now:()=>1800000000000+700000,maps:['mesa']});assert.equal(next.sessions[0].lastMatch.data.transport.sentBytes,12345);
});
