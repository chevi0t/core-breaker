// UI配線のVM試験。実ブラウザの配置・ダウンロード可否を保証するものではない。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const uiSource=fs.readFileSync(require.resolve('../../prototype/online/ui.js'),'utf8');
const source=uiSource.slice(uiSource.indexOf('// 共有は手動だけ。'));
function setup(logs){
 const elements=new Map(),timers=[],timeouts=[],events=new Map(),calls={copies:[],downloads:[],urls:[],revoke:[],clears:0};let text='preview-A',available=true;
 class Element{
  constructor(tag){this.tag=tag;this.hidden=false;this.listeners={};this.parentElement=this;}
  set id(id){this._id=id;elements.set(id,this);}get id(){return this._id;}
  set innerHTML(s){for(const [,id]of s.matchAll(/id="([^"]+)"/g)){const e=new Element('mock');e.id=id;}}
  setAttribute(){}append(e){e.parentElement=this;}insertAdjacentElement(_where,e){e.parentElement=this.parentElement;}remove(){}
  addEventListener(name,cb){this.listeners[name]=cb;}focus(){document.activeElement=this;}select(){this.selected=true;}closest(){return this.editable?this:null;}
  showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}click(){if(this.download)calls.downloads.push(this.download);this.onclick?.();}
 }
 const document={head:new Element('head'),body:new Element('body'),currentScript:{src:'https://example.invalid/online/ui.js'},createElement:t=>new Element(t),getElementById:id=>elements.get(id),querySelector:()=>elements.get('measure'),addEventListener:(name,cb)=>events.set(name,cb)};
 for(const id of ['menuOnline','onlineReturn','measure']){const e=new Element('existing');e.id=id;}
 document.activeElement=elements.get('menuOnline');elements.get('onlineReturn').hidden=false;
 class Url extends URL{}Url.createObjectURL=blob=>{calls.urls.push(blob);return 'blob:local';};Url.revokeObjectURL=u=>calls.revoke.push(u);
 const c={window:{CBOnlineGame:{logs:logs||{preview:()=>text+'-detail',summary:()=>text,capture:()=>({summary:text,detail:text+'-detail'}),status:()=>({available,storageAvailable:true}),clear:()=>{calls.clears++;available=false;text='empty';}}}},document,URL:Url,Blob,navigator:{clipboard:{writeText:async s=>calls.copies.push(s)}},setInterval:f=>timers.push(f),setTimeout:(f,ms)=>timeouts.push({f,ms}),addEventListener:(name,cb)=>events.set(name,cb)};
 vm.createContext(c);vm.runInContext(source,c);return {c,e:id=>elements.get(id),calls,timers,timeouts,events,change:t=>{text=t;},available:v=>{available=v;},key:(type='keydown',props={})=>{const e={code:'F8',target:document.body,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...props};events.get(type)?.(e);return e;}};
}
test('プレビュー前はコピー/保存なし。開いた時点の固定内容だけ明示操作で渡す',async()=>{
 const h=setup();assert.equal(h.calls.copies.length,0);assert.equal(h.calls.downloads.length,0);h.e('menuOnlineLog').click();assert(h.e('onlineLogDialog').open);assert.equal(h.e('onlineLogText').value,'preview-A');h.change('preview-B');await h.e('onlineLogCopy').onclick();assert.deepEqual(h.calls.copies,['preview-A']);h.e('onlineLogSave').click();assert.equal(await h.calls.urls[0].text(),'preview-A-detail');assert.deepEqual(h.calls.downloads,['core-breaker-diagnostic.txt']);h.timeouts.find(x=>x.ms===1000).f();assert.deepEqual(h.calls.revoke,['blob:local']);
 h.e('onlineLogClose').click();assert.equal(h.c.document.activeElement.id,'menuOnline');h.e('menuOnlineLog').click();assert.equal(h.e('onlineLogText').value,'preview-B');
});
test('clipboard失敗は本文選択、閉じる/再表示/消去を反復できる',async()=>{
 const h=setup();h.e('menuOnlineLog').click();h.c.navigator.clipboard.writeText=async()=>{throw Error('denied');};await h.e('onlineLogCopy').onclick();assert(h.e('onlineLogText').selected);assert.match(h.e('onlineLogStatus').textContent,/コピーできません/);
 h.e('onlineLogClear').click();assert.equal(h.calls.clears,1);assert.equal(h.e('onlineLogText').value,'empty');assert(h.e('onlineLogCopy').disabled);assert(h.e('menuOnlineLog').hidden);h.e('onlineLogClose').click();assert(!h.e('onlineLogDialog').open);
});
test('結果ボタンとEscapeは既存オンラインの捕捉から除く',()=>{
 const ui=fs.readFileSync(require.resolve('../../prototype/online/ui.js'),'utf8');assert(ui.includes("#onlineReturn,#onlineLogResult,#menuOnlineLog"));assert(ui.includes("if(document.getElementById('onlineLogDialog')?.open)return;"));
 assert(!/\b(fetch|sendBeacon|WebSocket|XMLHttpRequest)\s*\(/.test(source));
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('F8は押した時点の最新ログをコピーし、試合・pointer lock・フォーカスを変えない',async()=>{
 const h=setup();h.c.document.pointerLockElement={id:'canvas'};const focus=h.c.document.activeElement,locked=h.c.document.pointerLockElement;
 h.change('latest-host');const down=h.key();assert(down.prevented&&down.stopped);assert.deepEqual(h.calls.copies,['latest-host']);await settle();
 assert(!h.e('onlineLogDialog').open);assert.equal(h.c.document.pointerLockElement,locked);assert.equal(h.c.document.activeElement,focus);
 assert.match(h.e('onlineLogNotice').textContent,/診断ログ（要約）をコピーしました/);assert(!h.e('onlineLogNotice').hidden);
 const up=h.key('keyup');assert(up.prevented&&up.stopped);h.change('latest-guest');h.key();await settle();assert.deepEqual(h.calls.copies,['latest-host','latest-guest']);
 h.timeouts[0].f();assert(!h.e('onlineLogNotice').hidden,'古い通知タイマーは新しい通知を消さない');h.timeouts[1].f();assert(h.e('onlineLogNotice').hidden);
});
test('F8長押し・連打・clipboard処理中は書込みを重ねない',async()=>{
 const h=setup();let resolve;h.c.navigator.clipboard.writeText=text=>{h.calls.copies.push(text);return new Promise(r=>{resolve=r;});};
 h.key();h.key('keydown',{repeat:true});h.key();h.key('keyup');h.key();assert.equal(h.calls.copies.length,1);
 resolve();await settle();h.key('keyup');h.key();assert.equal(h.calls.copies.length,2);resolve();await settle();
});
test('入力欄・編集可能な親・IME・修飾キーではF8を消費せず、戦闘と定型通信のキーも通す',()=>{
 const h=setup();const target={closest:()=>({})};
 for(const props of [{target},{isComposing:true},{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},...['F2','F3','KeyW','KeyC','KeyV','Digit1','Escape'].map(code=>({code}))]){
  const e=h.key('keydown',props);assert(!e.prevented&&!e.stopped,JSON.stringify(props));
 }
 assert.equal(h.calls.copies.length,0);
});
test('フォーカス喪失・非表示を挟んでもF8を再び押せる',async()=>{
 const h=setup();h.key();await settle();h.events.get('blur')();h.key();await settle();
 h.c.document.hidden=true;h.events.get('visibilitychange')();h.c.document.hidden=false;h.key();await settle();assert.equal(h.calls.copies.length,3);
});
test('プレビュー中のF8は表示時点だけをコピーし、DOM編集や最新ログを混ぜない',async()=>{
 const h=setup();h.e('menuOnlineLog').click();h.change('new-private');h.e('onlineLogText').value='DOM_PRIVATE_ROOM_ID';h.key();await settle();
 assert.deepEqual(h.calls.copies,['preview-A']);assert.match(h.e('onlineLogStatus').textContent,/コピーしました/);assert(h.e('onlineLogNotice').hidden);
});
test('clipboard拒否・APIなし・HTTP/file制約の時は成功を出さず、安全な案内を残す',async()=>{
 for(const mode of ['denied','absent','http','file']){
  const h=setup();h.c.location={protocol:mode==='file'?'file:':'http:'};
  if(mode==='absent')h.c.navigator.clipboard=undefined;else h.c.navigator.clipboard.writeText=async()=>{throw Error('PRIVATE_ROOM_IP_SDP');};
  h.key();await settle();const t=h.e('onlineLogNotice').textContent;assert.match(t,/コピーできません/);assert.match(t,/HTTPS/);assert.match(t,/手動コピー・保存/);assert.match(t,/以前のクリップボード内容を貼り付けない/);assert(!t.includes('PRIVATE'));assert(!h.e('onlineLogNotice').hidden);assert.equal(h.timeouts.length,0);
  assert(!h.e('onlineLogDialog').open);h.e('menuOnlineLog').click();assert(h.e('onlineLogNotice').hidden);await h.e('onlineLogCopy').onclick();assert(h.e('onlineLogText').selected);assert.match(h.e('onlineLogStatus').textContent,/テキスト保存/);
 }
});
test('ログなし・期限切れは既存clipboardを上書きせず、消去で空になった後もコピーしない',async()=>{
 const h=setup();h.available(false);h.key();await settle();assert.equal(h.calls.copies.length,0);assert.match(h.e('onlineLogNotice').textContent,/ログがありません/);
 h.key('keyup');h.available(true);h.e('menuOnlineLog').click();h.e('onlineLogClear').click();h.key();await settle();assert.equal(h.calls.copies.length,0);
});
test('遅い成功/失敗は閉じる・再表示・消去後の新しい状態へ通知しない',async()=>{
 for(const fail of [false,true])for(const transition of ['open','reopen','clear']){
  const h=setup();let resolve,reject;h.c.navigator.clipboard.writeText=()=>new Promise((a,b)=>{resolve=a;reject=b;});
  if(transition!=='open')h.e('menuOnlineLog').click();h.key();
  if(transition==='open')h.e('menuOnlineLog').click();else if(transition==='reopen'){h.e('onlineLogClose').click();h.e('menuOnlineLog').click();}else h.e('onlineLogClear').click();
  const before=h.e('onlineLogStatus').textContent;fail?reject(Error('private')):resolve();await settle();assert.equal(h.e('onlineLogStatus').textContent,before);assert(h.e('onlineLogNotice').hidden);
 }
});
test('ホスト/ゲストの実Recorder許可リストを通した本文だけをF8でコピーする',async()=>{
 const {Recorder}=require('./online_diagnostic_fixture');const secret='PRIVATE_ROOM_PEER_192.0.2.5_CHAT_SDP_NAME';
 for(const role of ['host','guest']){
  const r=new Recorder({storage:null,now:()=>1800000000000,monotonic:()=>100,maps:['mesa']});
  r.begin({role,version:'Ver179',protocol:9,roomId:secret},{role,phase:'playing',map:'mesa',roomId:secret,peerId:secret,name:secret,chat:secret,sdp:secret,error:secret,diagnostic:{fps:60},transport:{sentBytes:123,peers:[{id:secret}]}});
  const h=setup({summary:()=>r.summary(),capture:()=>({summary:r.summary(),detail:r.preview()}),status:()=>({available:true,storageAvailable:false})});h.key();await settle();
  const text=h.calls.copies[0];assert(!text.includes(secret));assert(text.includes(role.toUpperCase()));assert(text.includes('送信 123B'));assert(!text.includes('null'));h.e('menuOnlineLog').click();h.e('onlineLogToggle').click();await h.e('onlineLogCopy').onclick();const data=JSON.parse(h.calls.copies.at(-1).slice(h.calls.copies.at(-1).indexOf('{')));assert.equal(data.sessions[0].role,role);assert.equal(data.sessions[0].samples[0].data.transport.sentBytes,123);
 }
});

test('要約と詳細の切替は同じ固定記録。詳細表示中のF8と保存も保つ',async()=>{
 const h=setup();h.e('menuOnlineLog').click();h.change('new-latest');h.e('onlineLogToggle').click();assert.equal(h.e('onlineLogText').value,'preview-A-detail');assert.match(h.e('onlineLogLabel').textContent,/詳細/);h.key();await settle();assert.deepEqual(h.calls.copies,['preview-A-detail']);h.e('onlineLogToggle').click();assert.equal(h.e('onlineLogText').value,'preview-A');h.e('onlineLogSave').click();assert.equal(await h.calls.urls[0].text(),'preview-A-detail');h.e('onlineLogClose').click();h.e('menuOnlineLog').click();assert.equal(h.e('onlineLogText').value,'new-latest');assert.match(h.e('onlineLogLabel').textContent,/要約/);
});
test('コピー中に要約/詳細を切り替えても古い完了通知・失敗選択を出さない',async()=>{
 for(const fail of [false,true]){const h=setup();let resolve,reject;h.e('menuOnlineLog').click();h.c.navigator.clipboard.writeText=()=>new Promise((a,b)=>{resolve=a;reject=b;});h.key();h.e('onlineLogToggle').click();const before=h.e('onlineLogStatus').textContent;fail?reject(Error('private')):resolve();await settle();assert.equal(h.e('onlineLogStatus').textContent,before);assert(!h.e('onlineLogText').selected);assert.equal(h.e('onlineLogText').value,'preview-A-detail');}
});
