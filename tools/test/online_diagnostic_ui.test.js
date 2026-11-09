// UI配線のVM試験。実ブラウザの配置・ダウンロード可否を保証するものではない。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const uiSource=fs.readFileSync(require.resolve('../../prototype/online/ui.js'),'utf8');
const source=uiSource.slice(uiSource.indexOf('// 共有は手動だけ。'));
function setup(){
 const elements=new Map(),timers=[],calls={copies:[],downloads:[],urls:[],revoke:[],clears:0};let text='preview-A',available=true;
 class Element{
  constructor(tag){this.tag=tag;this.hidden=false;this.listeners={};this.parentElement=this;}
  set id(id){this._id=id;elements.set(id,this);}get id(){return this._id;}
  set innerHTML(s){for(const [,id]of s.matchAll(/id="([^"]+)"/g)){const e=new Element('mock');e.id=id;}}
  setAttribute(){}append(e){e.parentElement=this;}insertAdjacentElement(_where,e){e.parentElement=this.parentElement;}remove(){}
  addEventListener(name,cb){this.listeners[name]=cb;}focus(){document.activeElement=this;}select(){this.selected=true;}
  showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}click(){if(this.download)calls.downloads.push(this.download);this.onclick?.();}
 }
 const document={head:new Element('head'),body:new Element('body'),currentScript:{src:'https://example.invalid/online/ui.js'},createElement:t=>new Element(t),getElementById:id=>elements.get(id),querySelector:()=>elements.get('measure')};
 for(const id of ['menuOnline','onlineReturn','measure']){const e=new Element('existing');e.id=id;}
 document.activeElement=elements.get('menuOnline');elements.get('onlineReturn').hidden=false;
 class Url extends URL{}Url.createObjectURL=blob=>{calls.urls.push(blob);return 'blob:local';};Url.revokeObjectURL=u=>calls.revoke.push(u);
 const c={window:{CBOnlineGame:{logs:{preview:()=>text,status:()=>({available,storageAvailable:true}),clear:()=>{calls.clears++;available=false;text='empty';}}}},document,URL:Url,Blob,navigator:{clipboard:{writeText:async s=>calls.copies.push(s)}},setInterval:f=>timers.push(f),setTimeout:f=>f()};
 vm.createContext(c);vm.runInContext(source,c);return {c,e:id=>elements.get(id),calls,timers,change:t=>{text=t;}};
}
test('プレビュー前はコピー/保存なし。開いた時点の固定内容だけ明示操作で渡す',async()=>{
 const h=setup();assert.equal(h.calls.copies.length,0);assert.equal(h.calls.downloads.length,0);h.e('menuOnlineLog').click();assert(h.e('onlineLogDialog').open);assert.equal(h.e('onlineLogText').value,'preview-A');h.change('preview-B');await h.e('onlineLogCopy').onclick();assert.deepEqual(h.calls.copies,['preview-A']);h.e('onlineLogSave').click();assert.equal(await h.calls.urls[0].text(),'preview-A');assert.deepEqual(h.calls.downloads,['core-breaker-diagnostic.txt']);assert.deepEqual(h.calls.revoke,['blob:local']);
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
