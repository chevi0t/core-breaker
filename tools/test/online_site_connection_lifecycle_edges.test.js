'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const source=require('node:path').resolve(process.env.CB_SOURCE || require('node:path').join(__dirname,'../../prototype'));
const unavailable='部屋が見つかりません。部屋IDとホストが待機中か確認してください';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function rig(){
 let time=0,id=0;const timers=new Map(),statuses=[],diagnostics=[],connections=[];
 function later(fn,ms,interval=0){const k=++id;timers.set(k,{fn,when:time+ms,interval});return k;}
 class Conn extends EventEmitter{
  constructor(peer,opts={}){super();Object.assign(this,{peer,open:false,closed:false,connectionId:'c'+ ++id,label:opts.label,metadata:opts.metadata,sent:[],dataChannel:{ordered:opts.reliable!==false,maxRetransmits:opts.reliable===false?0:null,maxPacketLifeTime:null,bufferedAmount:0}});connections.push(this);}
  send(raw){assert(this.open);this.sent.push(JSON.parse(raw));}
  close(){if(this.closed)return;this.closed=true;this.open=false;this.emit('close');}
  openNow(){this.open=true;this.emit('open');}
 }
 class Peer extends EventEmitter{
  constructor(){super();Object.assign(this,{id:'guest',destroyed:false,disconnected:false});queueMicrotask(()=>this.emit('open',this.id));}
  connect(room,opts){return new Conn(room,opts);}
  reconnect(){this.disconnected=false;this.emit('open',this.id);}
  // PeerJS 1.5.5 destroy() calls disconnect() before cleanup/destroyed/close.
  destroy(){if(this.destroyed)return;if(!this.disconnected){this.disconnected=true;this.emit('disconnected',this.id);}this.destroyed=true;this.emit('close');}
 }
 const c={module:{exports:{}},console,performance:{now:()=>time},TextEncoder,TextDecoder,Uint8Array,Math,Date,Map,Set,JSON,setTimeout:(f,m)=>later(f,m),clearTimeout:i=>timers.delete(i),setInterval:(f,m)=>later(f,m,m),clearInterval:i=>timers.delete(i)};
 vm.createContext(c);vm.runInContext(fs.readFileSync(source+'/online/transport.js','utf8'),c);const Transport=c.module.exports;
 const make=opts=>new Transport({appVersion:'review',Peer,reconnect:true,onStatus:(text,detail)=>statuses.push({text,detail}),onDiagnostic:(...v)=>diagnostics.push(v),...opts});
 const advance=async target=>{await flush();for(;;){const a=[...timers].filter(([,v])=>v.when<=target).sort((a,b)=>a[1].when-b[1].when)[0];if(!a)break;const [i,t]=a;time=t.when;timers.delete(i);if(t.interval)timers.set(i,{...t,when:time+t.interval});t.fn();await flush();}time=target;await flush();};
 const deliver=(t,link,type,payload={},extra={})=>link.conn.emit('data',JSON.stringify({protocolVersion:Transport.PROTOCOL,appVersion:t.appVersion,roomId:t.roomId,sender:link.conn.peer,matchId:t.matchId,type,payload,...extra}));
 return {make,advance,deliver,Transport,Conn,timers,statuses,diagnostics,connections};
}
async function connecting(r){const t=r.make();let result;const p=t.connect('host').then(value=>result={ok:true,value},e=>result={ok:false,reason:e.message});await flush();return {t,p,get result(){return result;},link:t.links.get('host')};}
async function ready(r){const x=await connecting(r),{t,link}=x;link.conn.openNow();r.deliver(t,link,'welcome',{snapshotToken:'a'.repeat(48),resumeToken:'b'.repeat(48)});link.snapshotConn.openNow();r.deliver(t,link,'channelsReady',{token:link.snapshotToken});await flush();assert(x.result.ok);return x;}

test('post-open unavailable rejection settles once, clears timers, ignores late connection/error events',async()=>{
 const r=rig(),x=await connecting(r),{t,link}=x;let settlements=0;x.p.then(()=>settlements++);
 t.peer.emit('error',{type:'peer-unavailable',message:'Could not connect to peer host'});await flush();assert.equal(x.result.reason,unavailable);assert(t.closed);assert.equal(r.timers.size,0);assert.equal(settlements,1);
 const n=r.statuses.length;t.peer.emit('open','guest');t.peer.emit('error',{type:'peer-unavailable',message:'late'});link.conn.openNow();r.deliver(t,link,'welcome',{snapshotToken:'a'.repeat(48)});link.conn.emit('error',{message:'late channel'});await r.advance(100000);assert.equal(r.statuses.length,n);assert.equal(settlements,1);assert.equal(r.timers.size,0);
});

test('registration-time network error rejects original cause rather than inventing missing room',async()=>{
 const r=rig(),t=r.make();const p=t.connect('host').catch(e=>e.message);t.peer.emit('error',{type:'network',message:'registration lost'});assert.equal(await p,'registration lost');assert(t.closed);assert.equal(r.timers.size,0);
});

test('generic network error can be followed by successful channel handshake',async()=>{
 const r=rig(),x=await connecting(r),{t,link}=x;t.peer.emit('error',{type:'network',message:'temporary signaling failure'});await flush();assert.equal(x.result,undefined);assert(!t.closed);
 link.conn.openNow();r.deliver(t,link,'welcome',{snapshotToken:'a'.repeat(48)});link.snapshotConn.openNow();r.deliver(t,link,'channelsReady',{token:link.snapshotToken});await x.p;assert(x.result.ok);t.close();assert.equal(r.timers.size,0);
});

for(const reason of ['ホストが入室を拒否しました','部屋は満員です（ホストを含め4人まで）','試合開始後の途中参加はできません'])test('host rejection preserves reason: '+reason,async()=>{
 const r=rig(),x=await connecting(r);x.link.conn.openNow();x.link.conn.emit('data',JSON.stringify({type:'reject',reason}));x.t.peer.emit('error',{type:'peer-unavailable',message:'late unavailable'});await x.p;assert.deepEqual(x.result,{ok:false,reason});assert(x.t.closed);assert.equal(r.timers.size,0);assert(!r.statuses.some(s=>s.text===unavailable));
});

test('reconnect peer-unavailable preserves original 30-second deadline and eventually fails once',async()=>{
 const r=rig(),x=await ready(r),{t,link}=x;const failures=[],departures=[];t.options.onReconnectFailed=v=>failures.push(v);t.options.onPeerLeave=(...v)=>departures.push(v);r.deliver(t,link,'match',{matchId:'m'},{matchId:'m'});link.conn.close();assert(departures[0][2].reconnecting);const deadline=t.reconnectUntil;
 await r.advance(1100);assert(t.links.get('host').resuming);t.peer.emit('error',{type:'peer-unavailable',message:'Could not connect to peer host'});await flush();assert.equal(t.reconnectUntil,deadline);assert(!t.closed);assert(t.links.has('host'));await r.advance(30100);assert.equal(failures.length,1);assert.match(failures[0],/30秒/);assert.equal(t.reconnectUntil,0);assert.equal(t.links.size,0);t.close();assert.equal(r.timers.size,0);
});

test('explicit host bye stays terminal and never schedules reconnect',async()=>{
 const r=rig(),x=await ready(r),{t,link}=x;const departures=[];t.options.onPeerLeave=(...v)=>departures.push(v);r.deliver(t,link,'match',{matchId:'m'},{matchId:'m'});r.deliver(t,link,'bye',{reason:'ホストが退出しました'});assert.equal(departures[0][1],'ホストが退出しました');assert.equal(departures[0][2].reconnecting,false);assert.equal(t.reconnectUntil,0);await r.advance(31000);assert.equal(t.links.size,0);assert.equal(departures.length,1);t.close();assert.equal(r.timers.size,0);
});

for(const stage of ['control-open','approval-pending','approved-snapshot'])test(stage+' peer-unavailable is not a missing room and handshake can finish',async()=>{
 const r=rig(),x=await connecting(r),{t,link}=x;try{
  link.conn.openNow();
  if(stage==='approval-pending')r.deliver(t,link,'pending',{timeoutSeconds:180});
  if(stage==='approved-snapshot')r.deliver(t,link,'welcome',{snapshotToken:'a'.repeat(48),resumeToken:'b'.repeat(48)});
  assert(!link.ready);assert(link.conn.open);
  // PeerJS EXPIRE emits a peer-level error without the affected connection ID.
  // Established control must not be killed by an error during snapshot negotiation.
  t.peer.emit('error',{type:'peer-unavailable',message:'Could not connect to peer host'});await flush();
  assert.equal(x.result,undefined);assert(!t.closed);assert.equal(t.links.get('host'),link);
  assert.equal(r.statuses.at(-1).detail.type,'peer-unavailable');
  if(!link.approved)r.deliver(t,link,'welcome',{snapshotToken:'a'.repeat(48),resumeToken:'b'.repeat(48)});
  link.snapshotConn.openNow();r.deliver(t,link,'channelsReady',{token:link.snapshotToken});await flush();assert(x.result?.ok);
 }finally{t.close();await x.p;assert.equal(r.timers.size,0);}
});

for(const reconnect of [undefined,false,true])test('different-match bye obeys connection-vs-reconnect boundary: '+String(reconnect),async()=>{
 const r=rig(),x=await ready(r),{t,link}=x;const departures=[];t.options.onPeerLeave=(...v)=>departures.push(v);r.deliver(t,link,'match',{matchId:'current'},{matchId:'current'});
 r.deliver(t,link,'bye',{reason:'explicit exit',...(reconnect===undefined?{}:{reconnect})},{matchId:''});
 if(reconnect===true){assert.equal(t.links.get('host'),link);assert.equal(departures.length,0);assert.equal(t.reconnectUntil,0);}
 else {assert.equal(t.links.size,0);assert.equal(departures[0][1],'explicit exit');assert.equal(departures[0][2].reconnecting,false);assert.equal(t.reconnectUntil,0);}
 t.close();assert.equal(r.timers.size,0);
});

test('same-match recoverable bye retains reconnect scheduling',async()=>{
 const r=rig(),x=await ready(r),{t,link}=x;const departures=[];t.options.onPeerLeave=(...v)=>departures.push(v);r.deliver(t,link,'match',{matchId:'current'},{matchId:'current'});
 r.deliver(t,link,'bye',{reason:'temporary interruption',reconnect:true});
 assert.equal(departures[0][2].reconnecting,true);assert(t.reconnectUntil>0);t.close();assert.equal(r.timers.size,0);
});

for(const corrupt of ['roomId','sender','appVersion','protocolVersion'])test('terminal bye does not bypass '+corrupt+' validation',async()=>{
 const r=rig(),x=await ready(r),{t,link}=x;const departures=[];t.options.onPeerLeave=(...v)=>departures.push(v);r.deliver(t,link,'match',{matchId:'current'},{matchId:'current'});
 r.deliver(t,link,'bye',{reason:'UNTRUSTED EXIT'},{matchId:'',[corrupt]:corrupt==='protocolVersion'?-1:'wrong'});await r.advance(200);
 assert.equal(departures.length,1);assert.notEqual(departures[0][1],'UNTRUSTED EXIT');assert.equal(departures[0][2].reconnecting,false);t.close();assert.equal(r.timers.size,0);
});

test('old connection terminal bye cannot close its replacement',async()=>{
 const r=rig(),x=await ready(r),{t,link:old}=x;const departures=[];t.options.onPeerLeave=(...v)=>departures.push(v);
 const replacement=t._attach(new r.Conn('host',{label:r.Transport.CONTROL_LABEL,reliable:true}));replacement.ready=replacement.approved=true;replacement.conn.open=true;
 r.deliver(t,old,'bye',{reason:'OLD LINK EXIT'},{matchId:'old-match'});assert.equal(t.links.get('host'),replacement);assert.equal(departures.length,0);t.close();old.conn.close();old.snapshotConn.close();assert.equal(r.timers.size,0);
});

test('different-match gameplay and endHost remain filtered',async()=>{
 const r=rig(),x=await ready(r),{t,link}=x;const messages=[];t.options.onMessage=(...v)=>messages.push(v);r.deliver(t,link,'match',{matchId:'current'},{matchId:'current'});
 for(const type of ['begin','prepare','endHost','lobbyReturn','events'])r.deliver(t,link,type,{reason:'old traffic'},{matchId:'old'});
 assert.equal(messages.length,0);assert.equal(t.links.get('host'),link);t.close();assert.equal(r.timers.size,0);
});


test('live signaling disconnect reconnects, but destroy/late disconnect after close stays silent',async()=>{
 const r=rig(),t=r.make();await t.createRoom();t.peer.disconnected=true;t.peer.emit('disconnected',t.peer.id);
 assert.equal(r.statuses.at(-1).detail.signaling,false);assert.equal(t._timers.size,1);
 await r.advance(500);assert.equal(t.peer.disconnected,false,'live reconnect still runs');
 const before=r.statuses.length;t.close('intentional local exit');
 assert(t.closed);assert(t.peer.destroyed);assert.equal(r.statuses.length,before);assert.equal(r.timers.size,0);assert.equal(t._timers.size,0);
 t.peer.emit('disconnected',t.peer.id);t.peer.emit('error',{type:'network',message:'late'});t.peer.emit('close');await r.advance(31000);
 assert.equal(r.statuses.length,before);assert.equal(r.timers.size,0);assert.equal(t._timers.size,0);
});
