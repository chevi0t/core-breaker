// オンライン試験専用。既存 lib.js は変えず、HTTP とローカル PeerServer を用意する。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const MOCK_TRANSPORT=process.argv.includes('--mock-transport');
const TRANSPORT_MODE=MOCK_TRANSPORT?'WebRTC未検証・通信代替による機能試験（BroadcastChannel）':'実WebRTC・ローカルPeerServer';
// 明示フラグ専用の代替。製品コード・PeerJS本体は変更せず、試験ページにだけ注入する。
const MOCK_PEER_SOURCE=`(() => {
  class Emitter {
    constructor(){this.handlers=new Map();}
    on(n,f){const a=this.handlers.get(n)||[];a.push(f);this.handlers.set(n,a);return this;}
    once(n,f){const one=(...a)=>{this.off(n,one);f(...a);};return this.on(n,one);}
    off(n,f){this.handlers.set(n,(this.handlers.get(n)||[]).filter(x=>x!==f));return this;}
    emit(n,...a){for(const f of [...(this.handlers.get(n)||[])])f(...a);}
  }
  class MockConnection extends Emitter {
    constructor(owner,remote,id,options={}){super();this.owner=owner;this.peer=remote;this.connectionId=id;this.options=options;this.label=options.label||id;this.metadata=options.metadata;this.serialization=options.serialization||'raw';this.reliable=!!options.reliable;this.open=false;this.bufferSize=0;
      // 代替試験で契約を模倣するだけ。実RTCの生成オプション検証はonline_loss_checkで別に行う。
      const snapshot=this.label==='core-breaker-snapshot-v7';this.dataChannel={bufferedAmount:0,ordered:this.reliable,maxRetransmits:snapshot?0:null,maxPacketLifeTime:null,readyState:'connecting'};}
    send(data){if(!this.open)throw Error('代替接続が開いていません');this.owner.post({type:'data',to:this.peer,id:this.connectionId,data});}
    close(remote=false){if(this.closed)return;this.closed=true;this.open=false;this.dataChannel.readyState='closed';if(!remote)this.owner.post({type:'close',to:this.peer,id:this.connectionId});this.owner.connections.delete(this.connectionId);this.emit('close');}
    ready(){if(this.closed||this.open)return;this.open=true;this.dataChannel.readyState='open';this.emit('open');}
  }
  class MockPeer extends Emitter {
    constructor(id,options={}){super();this.options=options;this.id=id||crypto.randomUUID();this.connections=new Map();this.bus=new BroadcastChannel('cb-online-test-peer');this.bus.onmessage=e=>this.receive(e.data);queueMicrotask(()=>this.emit('open',this.id));}
    post(m){this.bus.postMessage({...m,from:this.id});}
    connect(to,options={}){const c=new MockConnection(this,to,crypto.randomUUID(),options);this.connections.set(c.connectionId,c);queueMicrotask(()=>this.post({type:'offer',to,id:c.connectionId,options}));return c;}
    receive(m){if(m.to!==this.id)return;let c=this.connections.get(m.id);
      if(m.type==='offer'){c=new MockConnection(this,m.from,m.id,m.options);this.connections.set(m.id,c);this.emit('connection',c);this.post({type:'accept',to:m.from,id:m.id});c.ready();}
      else if(m.type==='accept')c?.ready();
      else if(m.type==='data'&&c?.open)c.emit('data',m.data);
      else if(m.type==='close')c?.close(true);
    }
    disconnect(){this.emit('disconnected');}
    reconnect(){queueMicrotask(()=>this.emit('open',this.id));}
    destroy(){if(this.destroyed)return;this.destroyed=true;for(const c of [...this.connections.values()])c.close();this.bus.close();this.emit('close');}
  }
  window.Peer=MockPeer;window.__mockTransport=true;
})();`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = a => {
  const s = a.filter(Number.isFinite).sort((a,b) => a-b);
  return { count:s.length, mean:s.length?s.reduce((a,b)=>a+b,0)/s.length:null, p50:s.length?s[Math.floor((s.length-1)*.5)]:null, p95:s.length?s[Math.floor((s.length-1)*.95)]:null, max:s.length?s[s.length-1]:null };
};
async function harness(dir, { realTime = false } = {}) {
  console.log('通信モード: '+TRANSPORT_MODE);
  dir = path.resolve(dir);
  execFileSync('python3', ['tools/test/make_dbg.py', dir], {cwd:ROOT,stdio:'inherit'});
  fs.cpSync(path.join(ROOT,'prototype/online'),path.join(dir,'online'),{recursive:true});
  // 負荷測定では make_dbg の固定 dt だけを戻す。テスト公開 getter は保持する。
  let html = fs.readFileSync(path.join(dir,'dbg.html'),'utf8');
  if (realTime) html = html.replace('const dt = window.__dt || 0.05; last = now;', 'const dt = Math.min(0.05, (now - last) / 1000); last = now;');
  // 通信代替ソースは製品のSRIとは一致しない。明示mock時の生成HTMLだけ除外する。
  if(MOCK_TRANSPORT)html=html.replace(/<script\b[^>]*>/gi,tag=>/peerjs(?:\.min)?\.js/.test(tag)?tag.replace(/\s+integrity=(?:"[^"]*"|'[^']*')/gi,''):tag);
  fs.writeFileSync(path.join(dir,'online-test.html'),html);
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
  const web=http.createServer((req,res)=>{
    let p;
    try { p=decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch {res.writeHead(400).end();return;}
    if(p==='/favicon.ico'){res.writeHead(204).end();return;}
    const f=path.resolve(dir,'.'+(p==='/'?'/online-test.html':p));
    if(!f.startsWith(dir+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(f,(e,b)=>{if(e){res.writeHead(404).end('not found');return;}res.setHeader('Content-Type',(mime[path.extname(f)]||'application/octet-stream')+'; charset=utf-8');res.end(b);});
  });
  const sockets=new Set(), pages=new Set();
  web.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise(r=>web.listen(0,'127.0.0.1',r));
  // peer 1.0.2 は公開APIで内部の掃除タイマーを停止できないため別プロセスへ隔離する。
  // テスト終了時はこの子だけを停止し、失敗時も WebSocket 待ちで永久停止しない。
  const peer=spawn(process.execPath,['-e',`require('peer').PeerServer({port:0,host:'127.0.0.1',path:'/peerjs',allow_discovery:false},s=>process.send({port:s.address().port}));`],{cwd:ROOT,stdio:['ignore','pipe','pipe','ipc']});
  let peerErrors='';peer.stderr.on('data',b=>{peerErrors+=b.toString();});
  const close=async()=>{
    for(const p of pages)if(!p.isClosed())await Promise.race([p.close().catch(()=>{}),sleep(1500)]);
    await new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);resolve();};
      const timer=setTimeout(()=>{for(const socket of sockets)socket.destroy();resolve();},1500);
      web.close(done);web.closeIdleConnections?.();for(const socket of sockets)socket.destroy();
    });
    if(peer.exitCode==null&&peer.signalCode==null)await new Promise(resolve=>{
      const timer=setTimeout(()=>{peer.kill('SIGKILL');resolve();},1500);
      peer.once('exit',()=>{clearTimeout(timer);resolve();});peer.kill('SIGTERM');
    });
  };
  let peerPort;
  try{peerPort=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('ローカル PeerServer 起動時間切れ: '+peerErrors)),5000);
    peer.once('message',m=>{clearTimeout(timer);resolve(m.port);});
    peer.once('error',e=>{clearTimeout(timer);reject(e);});
    peer.once('exit',code=>{clearTimeout(timer);reject(new Error('ローカル PeerServer 終了 '+code+': '+peerErrors));});
  });}catch(e){await close();throw e;}
  console.log(`試験サーバー準備: HTTP ${web.address().port} / PeerServer ${peerPort}`);
  return {
    url:`http://127.0.0.1:${web.address().port}/online-test.html`,
    peerOptions:{host:'127.0.0.1',port:peerPort,path:'/peerjs',secure:false},
    pages,close,peer,
  };
}
async function pageFor(browser,h,errors,{frozen=true,render=false,version,autoApprove=true}={}){
  console.log('試験ページを準備'+(version?'（版不一致）':''));
  if(!h.context)h.context=await browser.newContext({viewport:{width:960,height:540}});
  const p=await h.context.newPage();h.pages.add(p);p.once('close',()=>h.pages.delete(p));
  p.on('pageerror',e=>errors.push(e.stack||e.message));
  p.on('console',m=>{if(m.type()==='error'&&!/fonts|ERR_FAILED|ERR_FILE_NOT_FOUND/.test(m.text()))errors.push(m.text());});
  await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  // 実験中にCDNの応答で成否が変わらないよう、版固定の npm ファイルを返す。
  await p.route(/\/peerjs(?:\.min)?\.js(?:\?.*)?$/,r=>r.fulfill(MOCK_TRANSPORT?{body:MOCK_PEER_SOURCE,contentType:'text/javascript'}:{path:path.join(ROOT,'node_modules/peerjs/dist/peerjs.min.js'),contentType:'text/javascript'}));
  await p.addInitScript(({frozen})=>{if(frozen)window.requestAnimationFrame=()=>0;window.AudioContext=window.webkitAudioContext=undefined;}, {frozen});
  await p.goto(h.url);
  await p.waitForFunction(()=>window.__g&&window.CBOnlineGame&&window.CBOnlineTransport,{},{timeout:20000}).catch(e=>{throw new Error(e.message+'\nページ初期化エラー: '+errors.join('\n'));});
  // 旧機能試験では明示的なホスト操作を試験コードが代行。製品には自動承認を追加しない。
  if(autoApprove)await p.evaluate(()=>{
    const create=CBOnlineGame.create;CBOnlineGame.create=(opts={})=>create({...opts,onRequests:requests=>{
      opts.onRequests?.(requests);for(const r of requests)CBOnlineGame.approveGuest(r.id);
    }});
  });
  console.log('試験ページ準備完了');
  if(version)await p.evaluate(v=>document.getElementById('appVersion').textContent=v,version);
  if(!render)await p.evaluate(()=>{__g.renderer.render=()=>__g.scene.updateMatrixWorld(true);});
  return p;
}
async function frames(pages,n=1,ms=50){
  // 1回の評価で大量コマを回さない。通信イベントと送信タイマーへ毎回制御を返す。
  for(let i=0;i<n;i++){
    for(const p of pages)if(!p.isClosed())await p.evaluate(ms=>__g.loop(window.__onlineT=(window.__onlineT||performance.now())+ms),ms);
    if(i%5===0)await sleep(5);
  }
}
async function room(browser,h,errors,{guests=1,teamSize=5,latencyMs=0,frozen=true,render=false,guestClasses=[],beforeStart,predictionEnabled=true}={}){
  const pages=[];
  const host=await pageFor(browser,h,errors,{frozen,render});pages.push(host);
  console.log('部屋作成開始');
  const roomId=await host.evaluate(o=>CBOnlineGame.create(o),{peerOptions:h.peerOptions,latencyMs,predictionEnabled,settings:{teamMode:'choice'}});
  for(let i=0;i<guests;i++){
    const guest=await pageFor(browser,h,errors,{frozen,render});pages.push(guest);
    console.log(`ゲスト ${i+1} 接続開始`);
    await guest.evaluate(([id,o])=>CBOnlineGame.join(id,o),[roomId,{peerOptions:h.peerOptions,latencyMs,predictionEnabled,cls:guestClasses[i]||'assault'}]);
  }
  console.log('全ゲスト接続完了・試合開始');
  await sleep(100+latencyMs*2); // 装備希望もホストへ届いてから開始する。
  if(beforeStart)await beforeStart(host,pages.slice(1));
  // startはreadyを待つ可能性があるので、固定コマ試験でもイベントループを塞がない。
  await host.evaluate(n=>{window.__startPromise=CBOnlineGame.start({teamSize:n});},teamSize);
  const startDeadline=Date.now()+20000;
  while(Date.now()<startDeadline){
    if(frozen)await frames(pages,1);else await sleep(25);
    if(await host.evaluate(()=>CBOnlineGame.state.phase==='playing'))break;
  }
  for(const p of pages)try{await p.waitForFunction(()=>CBOnlineGame.state.phase==='playing',{},{timeout:15000,polling:50});}catch(e){console.error('接続後エラー',errors);for(const x of pages)console.error(await x.evaluate(()=>({phase:CBOnlineGame.state.phase,status:CBOnlineGame.state.status,role:CBOnlineGame.state.role})));throw e;}
  console.log('全員の試合開始を確認');
  return {host,guests:pages.slice(1),pages,roomId,close:async()=>{for(const p of pages){if(!p.isClosed()){await p.evaluate(()=>CBOnlineGame.leave('試験終了')).catch(()=>{});await p.close();}}}};
}
async function identity(p){return p.evaluate(()=>({id:CBOnlineGame.state.localUnitId,pos:__g.player.pos.toArray(),life:__g.player.lifeId,hp:__g.player.hp,team:__g.player.team}));}
async function input(p,v){await p.evaluate(v=>CBOnlineGame.testInput(v),v);}
const neutral={keys:{},pressed:{},fwd:0,side:0,trigger:false,alt:false,wheel:0};
async function summary(p){return p.evaluate(()=>({phase:CBOnlineGame.state.phase,running:__g.running,time:__g.timeLeft,cores:[__g.cores.B.hp,__g.cores.R.hp],units:__g.units.map(u=>({id:u.entityId||u.netId||`${u.team}:${u.idx}`,team:u.team,controller:u.controller,hp:u.hp,lifeId:u.lifeId,sc:u.sc,weapon:u.weapon})),metrics:CBOnlineGame.metrics()}));}
// 成功したwire送信を観測する。製品のsend/codecを変更せず、分割を独立に組み立てる。
// 呼出側はawait installWireObserver(page)後、page内で__observeOnlineWire(onDatagram,onMessage)。
// datagram: {envelope,channel,messageBytes,peerId,at,type}。
// message: 上記＋logicalMessageBytes,fragmentCount,maxDatagramBytes,
// chunkBase64ExpansionBytes,chunkEnvelopeBytes。messageBytesは断片JSONの総和。
async function installWireObserver(page){await page.evaluate(()=>{
  const t=CBOnlineGame.state.transport;if(!t)throw Error('wire観測前に部屋を作成してください');
  if(t.__wireObserverInstalled)return;t.__wireObserverInstalled=true;
  const listeners=[],parts=new Map(),utf8=new TextEncoder(),write=t._write.bind(t);
  window.__wireObserverErrors=[];
  window.__observeOnlineWire=(onDatagram,onMessage)=>{const entry={onDatagram,onMessage};listeners.push(entry);return ()=>{const i=listeners.indexOf(entry);if(i>=0)listeners.splice(i,1);};};
  const emit=(key,value)=>{for(const l of listeners)try{l[key]?.(value);}catch(error){__wireObserverErrors.push(error.stack||error.message);}};
  t._write=(link,item,...args)=>{
    const sent=write(link,item,...args);if(!sent)return sent;
    try{
      const envelope=JSON.parse(item.text),channel=item.channel||(['snapshot','snapshotBase'].includes(item.type)?'snapshot':'control'),at=performance.now();
      const sample={envelope,channel,messageBytes:item.bytes,peerId:link.conn.peer,at,type:item.type};emit('onDatagram',sample);
      if(envelope.type!=='snapshotChunk'){
        emit('onMessage',{...sample,logicalMessageBytes:utf8.encode(item.text).length,fragmentCount:1,maxDatagramBytes:item.bytes,chunkBase64ExpansionBytes:0,chunkEnvelopeBytes:0});return sent;
      }
      for(const [key,value]of parts)if(at-value.at>3000)parts.delete(key);
      const p=envelope.payload,key=[link.conn.peer,envelope.matchId,p.type,p.sequence].join(':');
      let assembly=parts.get(key);if(!assembly){if(parts.size>=64)parts.delete(parts.keys().next().value);assembly={count:p.count,parts:new Map(),at};parts.set(key,assembly);}
      if(assembly.count!==p.count)throw Error('wire観測で分割数が不一致');
      if(assembly.parts.has(p.index))return sent;
      const raw=Uint8Array.from(atob(p.data),c=>c.charCodeAt(0));assembly.parts.set(p.index,{raw,bytes:item.bytes,base64Bytes:p.data.length});
      if(assembly.parts.size!==assembly.count)return sent;
      parts.delete(key);const ordered=Array.from({length:assembly.count},(_,i)=>assembly.parts.get(i));
      const length=ordered.reduce((n,p)=>n+p.raw.length,0),rawMessage=new Uint8Array(length);let offset=0;
      for(const p of ordered){rawMessage.set(p.raw,offset);offset+=p.raw.length;}
      const full=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rawMessage));
      const messageBytes=ordered.reduce((n,p)=>n+p.bytes,0),base64Bytes=ordered.reduce((n,p)=>n+p.base64Bytes,0);
      emit('onMessage',{...sample,envelope:full,type:full.type,messageBytes,logicalMessageBytes:length,fragmentCount:assembly.count,maxDatagramBytes:Math.max(...ordered.map(p=>p.bytes)),chunkBase64ExpansionBytes:base64Bytes-length,chunkEnvelopeBytes:messageBytes-base64Bytes});
    }catch(error){__wireObserverErrors.push(error.stack||error.message);}
    return sent;
  };
});}
module.exports={installWireObserver,MOCK_TRANSPORT,TRANSPORT_MODE,ROOT,sleep,stats,harness,pageFor,frames,room,identity,input,neutral,summary};
