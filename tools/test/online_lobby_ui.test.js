// ui.js全体を実game.jsとDOM代役へ読み込み、機能間の初期化と操作の共存を確認する。
// 実ブラウザのHTML解釈・レイアウト・WebGL・WebRTCの成功を意味しない。
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{createRequire}=require('module'),path=require('path');
const root=path.resolve(__dirname,'../..');
// ゲーム側の代役は部屋状態試験と共用し、UIは部分snippetにせず全体を読む。
const fixture=fs.readFileSync(root+'/tools/test/online_rooms.test.js','utf8'),fixtureEnd=fixture.indexOf('\n(async()=>');
assert(fixtureEnd>0,'部屋試験の初期化境界');const suite=fixture.slice(0,fixtureEnd);
const seed={require:createRequire(root+'/tools/test/online_rooms.test.js'),console,setTimeout,clearTimeout};vm.createContext(seed);vm.runInContext(suite+'\nthis.review={c,game,join};',seed);
const {c,game,join}=seed.review,els=new Map(),events=new Map(),intervals=[];
class E{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.hidden=false;this.value='';this.textContent='';this.handlers={};this.className='';this.disabled=false;this.style={};}
 set id(v){this._id=v;els.set(v,this);}get id(){return this._id;}
 setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=v;}
 getAttribute(k){return this.attrs[k]??null;}
 get parentElement(){return this.parentNode||null;}
 showModal(){this.open=true;}
 close(){this.open=false;for(const f of this.handlers.close||[])f();}
 select(){this.selected=true;}
 append(...ns){for(const n of ns){if(n.parentNode){n.parentNode.children=n.parentNode.children.filter(x=>x!==n);}this.children.push(n);n.parentNode=this;if(this.tagName==='SELECT'&&!this.value)this.value=n.value;}}
 appendChild(n){this.append(n);return n;}
 replaceChildren(...ns){this.children=[];this.append(...ns);}
 set innerHTML(html){this.children=[];const stack=[this];for(const m of html.matchAll(/<\/?[a-zA-Z][^>]*>/g)){const text=m[0],close=text.startsWith('</'),tag=text.match(/<\/?([\w-]+)/)[1];if(close){if(stack.length>1)stack.pop();continue;}const e=new E(tag);for(const a of text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)){if(a[1]===tag)continue;const k=a[1],v=a[2]??'';e.setAttribute(k,v);if(k==='class')e.className=v;if(k==='hidden')e.hidden=true;if(k==='value')e.value=v;}stack.at(-1).append(e);if(!['input','br','link','img','hr'].includes(tag)&&!text.endsWith('/>'))stack.push(e);}}
 walk(){return this.children.flatMap(n=>[n,...n.walk()]);}
 matches(sel){if(sel.startsWith('#'))return this.id===sel.slice(1);if(sel.startsWith('.'))return this.className.split(' ').includes(sel.slice(1));if(sel==='[data-action]')return !!this.dataset.action;if(sel==='[data-team]')return !!this.dataset.team;return this.tagName===sel.toUpperCase();}
 querySelectorAll(sel){const ss=sel.split(',');return this.walk().filter(e=>ss.some(s=>{const parts=s.trim().split(' ');return e.matches(parts.at(-1))&&(parts.length===1||!!e.closest(parts[0]));}));}
 querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
 closest(sel){for(let n=this;n;n=n.parentNode)if(sel.split(',').some(s=>n.matches(s)))return n;return null;}
 insertAdjacentElement(_pos,e){this.parentNode?.append(e);}
 addEventListener(t,f){(this.handlers[t]??=[]).push(f);}
 focus(){doc.activeElement=this;}
 blur(){doc.activeElement=null;}
 click(){this.onclick?.({target:this,stopPropagation(){}});}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);}
}
const body=new E('body'),head=new E('head'),doc={body,head,currentScript:{src:'https://test.invalid/online/ui.js'},activeElement:null,createElement:tag=>new E(tag),getElementById:id=>els.get(id)||null,addEventListener:(t,f)=>(events.get('doc:'+t)||events.set('doc:'+t,[]).get('doc:'+t)).push(f),exitPointerLock(){}};
doc.querySelector=selector=>body.querySelector(selector);
for(const id of ['menuRange','ovBoard','start']){const e=new E('button');e.id=id;body.append(e);}
Object.assign(c,{document:doc,URL,setInterval:f=>intervals.push(f),addEventListener:(t,f)=>(events.get(t)||events.set(t,[]).get(t)).push(f),CBOnlineGame:game,PART_NAMES:{head:'頭',body:'胴',arms:'腕',legs:'脚'},mechStats:()=>({weight:100,cap:200,excess:0,slow:0}),player:null,keys:{},pressed:{},wsel:{open:false},qc:{open:false},navigator:{}});
vm.runInContext(fs.readFileSync(root+'/prototype/online/ui.js','utf8'),c);
function press(code,target){const e={code,target,repeat:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const f of events.get('keydown')||[]){f(e);if(e.stopped)break;}for(const f of events.get('keyup')||[])f(e);return e;}
async function run(){
 els.get('menuOnline').click();assert.equal(els.get('onlinePanel').hidden,false);
 els.get('onlineCreate').click();await new Promise(r=>setTimeout(r,0));assert.equal(game.state.role,'host');join('guest');
 // 同じ確定設定の通知ではホストの未適用値を保持する。
 const t=game.state.transport;
 els.get('onlineMap').value='city';els.get('onlineCapacity').value='3';els.get('onlineTeamSize').value='6';els.get('onlineTeamMode').value='choice';
 game.setReady(true);
 assert.equal(els.get('onlineMap').value,'city');assert.equal(els.get('onlineCapacity').value,'3');assert.equal(els.get('onlineTeamSize').value,'6');assert.equal(els.get('onlineTeamMode').value,'choice');
 t.options.onMessage('lobbyEditing',{editing:true},'guest');assert.equal(els.get('onlineMap').value,'city');t.options.onMessage('lobbyEditing',{editing:false},'guest');
 // 新しい確定設定はフォームへ反映する。Readyは既存仕様どおり解除。
 game.updateSettings({mapId:'city',teamSize:4});assert.equal(els.get('onlineMap').value,'city');assert.equal(els.get('onlineTeamSize').value,'4');assert.equal(els.get('onlineCapacity').value,'4');assert.equal(els.get('onlineTeamMode').value,'random');assert(!game.state.lobbyReady);
 // 拒否された変更は同一signatureでも確定値へ戻してエラーを表示する。
 els.get('onlineCapacity').value='1';els.get('onlineApplySettings').click();assert.equal(els.get('onlineCapacity').value,'4');assert.match(els.get('onlineStatus').textContent,/定員/);
 // nullでsignatureをクリアし、同じ部屋設定を受けても再適用できる。
 els.get('onlineMap').value='mesa';
 els.get('onlineClose').click();assert.equal(game.state.role,'offline');
 els.get('menuOnline').click();els.get('onlineMap').value='city';els.get('onlineTeamSize').value='4';
 els.get('onlineCreate').click();els.get('onlineMap').value='mesa';await new Promise(r=>setTimeout(r,0));assert.equal(game.state.settings.mapId,'city');
 assert.equal(els.get('onlineMap').value,'city');join('guest');game.setReady(false);
 const tNext=game.state.transport;tNext.options.onMessage('lobbyReady',{ready:true,revision:game.state.lobbyRevision,equipmentVersion:game.state.peers.get('guest').equipmentVersion},'guest');
 els.get('onlineReady').click();assert(game.canStart());
 els.get('onlineEquipment').click();assert.equal(game.state.lobbyReady,false);assert.equal(game.state.editing,true);assert.equal(els.get('onlineEquipmentEditor').hidden,false);
 assert(!press('KeyV',els.get('onlineEquipmentClass')).stopped);assert(els.get('onlineQuickChat').hidden);
 press('KeyV');assert(!els.get('onlineQuickChat').hidden);press('Escape');assert(els.get('onlineQuickChat').hidden);assert(!els.get('onlinePanel').hidden);assert(game.state.editing);
 // 診断UIも同じui.js内。modal背後で定型通信を操作しない。
 press('KeyV');assert(!els.get('onlineQuickChat').hidden);els.get('onlineLogOpen').click();assert(els.get('onlineLogDialog').open);
 for(const fn of intervals)fn();assert(els.get('onlineQuickChat').hidden);
 assert(!press('KeyV',els.get('onlineLogClose')).stopped);assert(els.get('onlineQuickChat').hidden);
 assert(!press('Escape',els.get('onlineLogClose')).stopped,'診断dialogの標準Escapeを妨げない');
 els.get('onlineLogClose').click();assert(!els.get('onlineLogDialog').open);
 press('KeyV');assert(!els.get('onlineQuickChat').hidden);press('Escape');assert(els.get('onlineQuickChat').hidden);
 els.get('onlineEquipmentCancel').click();assert(!game.state.editing);assert(!game.state.lobbyReady);els.get('onlineReady').click();assert(game.canStart());
 game.state.phase='ended';c.window.__lobbyTest.backToLobby();assert(game.state.roster.every(p=>!p.ready));assert(els.get('onlinePanel').hidden);els.get('onlineReturn').click();assert(!els.get('onlinePanel').hidden);
 for(const fn of intervals)fn();
 els.get('onlineClose').click();assert.equal(game.state.role,'offline');for(const fn of intervals)fn();assert(els.get('onlineQuickChatLog').hidden);
 console.log('ロビーUI全体：初期化・未適用設定保持/確定変更/拒否復元/退出リセット・Ready・装備編集・入力欄V・Esc/取消・結果復帰 成功（DOM/通信/描画は代役）');
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
