'use strict';
// 配信ソースそのものをFakePeerと仮想時計で検査。実WebRTC・描画・実回線は別途確認する。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const root=path.resolve(process.env.CB_SOURCE||path.join(__dirname,'../../prototype'));
const transportSource=fs.readFileSync(root+'/online/transport.js','utf8'),gameSource=fs.readFileSync(root+'/online/game.js','utf8'),defaultGameSource=gameSource;
// 診断ログ（Recorder）は 2026-11-10 に game.js の冒頭から diagnostics.js へ分けた。分ける前の版（CB_SOURCE）では game.js を読む。
const diagnosticsSource=fs.existsSync(root+'/online/diagnostics.js')?fs.readFileSync(root+'/online/diagnostics.js','utf8'):gameSource;
const unavailable='部屋が見つかりません。部屋IDとホストが待機中か確認してください';
const flush=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
function runtime(){
 let clock=0,serial=0;const timers=new Map();
 const later=(fn,ms,interval=0)=>{const id=++serial;timers.set(id,{fn,at:clock+ms,interval});return id;};
 class Connection extends EventEmitter{
  constructor(peer){super();this.peer=peer;this.open=false;this.sent=[];this.dataChannel={ordered:true,maxRetransmits:null,maxPacketLifeTime:null,bufferedAmount:0};}
  send(data){assert(this.open,'未open接続へ送らない');this.sent.push(JSON.parse(data));}
  close(){if(this.closed)return;this.closed=true;this.open=false;this.emit('close');}
 }
 class Peer extends EventEmitter{
  constructor(){super();this.id='peer-'+ ++serial;this.destroyed=false;this.disconnected=false;queueMicrotask(()=>this.emit('open',this.id));}
  connect(room){return new Connection(room);}
  destroy(){this.destroyed=true;this.emit('close');}
 }
 const c={module:{exports:{}},performance:{now:()=>clock},TextEncoder,TextDecoder,Uint8Array,Map,Set,Date,Math,JSON,console,queueMicrotask,
  setTimeout:(f,m)=>later(f,m),clearTimeout:id=>timers.delete(id),setInterval:(f,m)=>later(f,m,m),clearInterval:id=>timers.delete(id)};
 vm.createContext(c);vm.runInContext(transportSource,c);const Transport=c.module.exports;
 const advance=async target=>{
  await flush();
  for(;;){let next;for(const item of timers)if(item[1].at<=target&&(!next||item[1].at<next[1].at))next=item;if(!next)break;
   const [id,timer]=next;clock=timer.at;timers.delete(id);if(timer.interval)timers.set(id,{...timer,at:clock+timer.interval});timer.fn();await flush();
  }
  clock=target;await flush();
 };
 const statuses=[],diagnostics=[];
 const make=options=>new Transport({appVersion:'connection-reasons',Peer,onStatus:(text,detail)=>statuses.push({at:clock,text,detail}),onDiagnostic:(...event)=>diagnostics.push(event),...options});
 return {Transport,Peer,Connection,make,advance,timers,statuses,diagnostics};
}
function extract(name,gameSource=defaultGameSource){
 const start=gameSource.indexOf('  function '+name+'(');assert(start>=0,name);
 const body=gameSource.indexOf('{',start+gameSource.slice(start).search(/\)\s*\{/));
 let depth=0,quote=null,comment=null,escaped=false;
 for(let i=body;i<gameSource.length;i++){
  const ch=gameSource[i],next=gameSource[i+1];
  if(comment==='line'){if(ch==='\n')comment=null;continue;}if(comment==='block'){if(ch==='*'&&next==='/'){comment=null;i++;}continue;}
  if(quote){if(escaped){escaped=false;continue;}if(ch==='\\'){escaped=true;continue;}if(ch===quote)quote=null;continue;}
  if(ch==='/'&&next==='/'){comment='line';i++;continue;}if(ch==='/'&&next==='*'){comment='block';i++;continue;}
  if(['"',"'",'`'].includes(ch)){quote=ch;continue;}if(ch==='{')depth++;if(ch==='}'&&--depth===0)return gameSource.slice(start,i+1);
 }
 throw Error('関数終端が見つからない: '+name);
}
function gameFixture(role,transport){
 const elements=new Map(),logs=[],statuses=[],noop=()=>{};
 const c={state:{role,phase:'playing',transport,peers:new Map(),resumePeers:new Map(),requests:new Map()},running:true,ended:false,
  diagnosticLog:{end:(reason)=>logs.push(['session_ended',reason])},logSample:()=>({}),logCheckpoint:(...args)=>logs.push(args),
  equipmentActions:[],remoteUnitHistory:new Map(),preferenceTimer:null,preferenceReject:null,preferenceResolve:null,saved:null,
  clearTimeout:noop,callbacks:{},status:text=>statuses.push(text),document:{exitPointerLock:noop},$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},
  handleSnapshotControl:()=>false,resetQuickChat:noop,clearRemoteEquipment:noop,clearStartReservation:noop,clearPrediction:noop,resetLagCompensation:noop,stopSessionAudio:noop,
  requestsChanged:noop,lobbyChanged:noop,clearRemoteShells:noop,setSimulationRole:noop,tutorialClearInput:noop,showPage:noop};
 vm.createContext(c);for(const name of ['leave','endGuest','peerLeft','onMessage'])vm.runInContext(extract(name),c);
 return {c,elements,logs,statuses};
}

test('初回入室の相手不在は5.5秒の通知直後に終了し、STUNの時間切れへ変わらない',async()=>{
 const r=runtime(),t=r.make();let result;const joined=t.connect('missing-room').then(()=>result={ok:true},e=>result={ok:false,message:e.message});
 await r.advance(5500);const conn=t.links.get('missing-room').conn;t.peer.emit('error',{type:'peer-unavailable',message:'Could not connect to peer missing-room'});await flush();
 assert.deepEqual(result,{ok:false,message:unavailable});assert(t.closed);assert.equal(t.links.size,0);assert.equal(r.timers.size,0);assert.equal(conn.sent.length,0);
 const statuses=r.statuses.length;t.peer.emit('error',{type:'peer-unavailable',message:'late'});t.peer.emit('open',t.peer.id);await r.advance(16000);await joined;
 assert.equal(r.statuses.length,statuses);assert.equal(r.statuses.at(-1).text,unavailable);assert(!r.statuses.some(s=>s.text.includes('STUN')));
});
test('相手不在の専用理由は既存のpeer_unavailable診断コードへ保存する',()=>{
 const c={};vm.createContext(c);
 vm.runInContext(diagnosticsSource.slice(diagnosticsSource.indexOf('  const reasons='),diagnosticsSource.indexOf('  const value='))+extract('reasonCode',diagnosticsSource),c);
 assert.equal(c.reasonCode(unavailable),'peer_unavailable');assert.equal(c.reasonCode('ホストが退出しました'),'host_left');
});
test('networkエラーだけでは部屋不在と決めつけず、取消で待ちを終了する',async()=>{
 const r=runtime(),t=r.make();let done=false;const joined=t.connect('room').catch(e=>{done=true;return e.message;});await r.advance(5500);
 t.peer.emit('error',{type:'network',message:'network unavailable'});await flush();assert(!done);assert.equal(t.links.size,1);assert(!t.closed);
 t.close('取消');assert.equal(await joined,'取消');assert.equal(r.timers.size,0);
});
test('相手不在通知のない初回入室は従来の15秒期限で終了する',async()=>{
 const r=runtime(),t=r.make();let result;const joined=t.connect('room').catch(e=>result=e.message);await r.advance(14999);assert.equal(result,undefined);
 await r.advance(15150);await joined;assert.match(result,/STUN/);assert(t.closed);assert.equal(r.timers.size,0);
});
for(const mode of ['host','joined-guest','resuming-guest'])test(mode+'のPeer errorは初回入室の拒否に取り違えない',async()=>{
 const r=runtime(),t=r.make();await t.createRoom();
 if(mode!=='host'){
  t.role='guest';t.roomId='room';const link=t._attach(new r.Connection('room'));
  if(mode==='joined-guest')link.ready=link.approved=true;
  else {t.started=true;link.resuming=true;t.resumeToken='a'.repeat(48);}
 }
 const links=t.links.size;t.peer.emit('error',{type:'peer-unavailable',message:'peer unavailable'});await flush();
 assert.equal(t.links.size,links);assert(!t.closed);assert.equal(r.statuses.at(-1).detail.type,'peer-unavailable');t.close('試験終了');
});
for(const reason of [undefined,'試合結果から退出','部屋を作り直す'])test('ホストの'+(reason||'通常退出')+'はendHost/bye双方でホスト退出を示す',async()=>{
 const r=runtime(),host=r.make(),guest=r.make();await host.createRoom();await guest.createRoom();
 host.roomId=host.peer.id;guest.role='guest';guest.roomId=host.roomId;
 const outgoing=new r.Connection(guest.peer.id),incoming=new r.Connection(host.peer.id);
 for(const [t,conn] of [[host,outgoing],[guest,incoming]]){conn.open=true;conn.label=r.Transport.CONTROL_LABEL;const link=t._attach(conn);link.ready=link.approved=true;}
 const h=gameFixture('host',host),g=gameFixture('guest',guest);
 guest.options.onPeerLeave=(...args)=>g.c.peerLeft(...args);
 let endHost;const broadcast=host.broadcast.bind(host);host.broadcast=(type,data)=>{if(type==='endHost')endHost=data;return broadcast(type,data);};
 h.c.leave(reason);assert.equal(endHost.reason,'ホストが退出しました');assert.equal(h.logs[0][1],reason||'退出');
 const bye=outgoing.sent.find(m=>m.type==='bye');assert(bye);assert.equal(bye.payload.reason,'ホストが退出しました');incoming.emit('data',JSON.stringify(bye));
 assert.equal(g.elements.get('ovTitle').textContent,'オンライン対戦を中断');assert.equal(g.elements.get('ovText').textContent,'ホストが退出しました');assert.equal(g.c.state.phase,'ended');
 // 即時byeではなくendHost通知が先に届く経路も同じ表示。
 const direct=gameFixture('guest',null);direct.c.onMessage('endHost',endHost,host.peer.id);assert.equal(direct.elements.get('ovText').textContent,'ホストが退出しました');
 guest.close('試験終了');assert.equal(r.timers.size,0);
});
test('ゲスト自身の退出理由はホスト退出へ変更しない',()=>{
 const sent=[],t={send:(...x)=>sent.push(x),close:reason=>sent.push(['close',reason])},g=gameFixture('guest',t);g.c.leave('退出');
 assert.equal(sent[0][0],'leave');assert.equal(sent[0][1].reason,'退出');assert.deepEqual(sent[1],['close','退出']);
});
test('意図しない対戦線の切断はホスト退出と断定せず、復帰を保つ',async()=>{
 const r=runtime(),t=r.make(),left=[];await t.createRoom();t.role='guest';t.roomId='host';t.started=true;t.options.reconnect=true;t.resumeToken='a'.repeat(48);t.options.onPeerLeave=(...args)=>left.push(args);
 const conn=new r.Connection('host'),link=t._attach(conn);link.ready=link.approved=true;conn.close();
 assert.equal(left[0][1],'対戦接続が切れました');assert.equal(left[0][2].reconnecting,true);assert(t.reconnectUntil>0);t.close('試験終了');
});
