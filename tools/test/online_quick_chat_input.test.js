// 製品ui.jsの定型通信部分をDOM代役へ読み込み、キーのcapture/bubble境界を検査する。
// 配置・描画・WebRTCは別のonline_quick_chat_check.jsで検査する。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../prototype/online/ui.js'),'utf8');
const snippet=source.slice(source.indexOf('  // V → 数字'),source.indexOf("  el('onlineDiagnostics').addEventListener"));
let at=0,refresh,subscriber;const elements=new Map(),listeners=new Map(),sent=[];
class Element{
  constructor(){this.hidden=false;this.children=[];this.handlers={};}
  set id(id){this._id=id;elements.set(id,this);}get id(){return this._id;}
  set innerHTML(text){for(const [,id]of text.matchAll(/id="([^"]+)"/g)){const e=new Element();e.id=id;}}
  querySelector(){return el('online-main');}
  setAttribute(){}append(...nodes){for(const node of nodes)node.parentNode=this;this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
  insertAdjacentElement(){}addEventListener(type,fn){this.handlers[type]=fn;}
}
const el=id=>{if(!elements.has(id)){const e=new Element();e.id=id;}return elements.get(id);};
const panel=el('onlinePanel');panel.hidden=false;
const player={lifeId:1,alive:true,hp:100,downT:0};
const state={role:'host',phase:'lobby',roomId:'room',matchId:null};
const game={state,active:()=>state.role!=='offline',quickChat:{allowed:()=>state.role!=='offline'&&(state.phase==='lobby'||state.phase==='playing'&&player.alive&&player.hp>0&&!player.downT),
  categories:Array.from({length:4},(_,i)=>({label:'カテゴリ'+i,items:Array.from({length:4},(_,j)=>({id:i+'-'+j,text:'文'+j}))})),
  send:id=>{sent.push(id);},lines:()=>[],subscribe:fn=>subscriber=fn}};
const keys={},pressed={},c={CBOnlineGame:game,player,keys,pressed,wsel:{open:true},qc:{open:true},el,panel,performance:{now:()=>at},
  document:{createElement:()=>new Element(),body:new Element(),addEventListener:(type,fn)=>listeners.set('doc:'+type,fn)},
  setInterval:fn=>refresh=fn,addEventListener:(type,fn)=>listeners.set(type,fn)};
vm.createContext(c);vm.runInContext(snippet,c);
const box=el('onlineQuickChat');
function event(code,type='keydown',extra={}){
  const e={code,repeat:false,key:code,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
  listeners.get(type)?.(e);
  if(!e.stopped){if(type==='keydown'){keys[code]=true;if(!e.repeat)pressed[code]=true;}else if(type==='keyup')keys[code]=false;}
  return e;
}
function press(code,extra={}){const e=event(code,'keydown',extra);event(code,'keyup');return e;}
assert(!press('KeyV',{target:{closest:()=>({})}}).stopped);assert(box.hidden,'入力欄では開かない');delete pressed.KeyV;
assert(!press('KeyV',{ctrlKey:true}).stopped);assert(box.hidden,'修飾キーを横取りしない');delete pressed.KeyV;
press('KeyV');assert(!box.hidden);assert(!c.qc.open&&!c.wsel.open);assert(!pressed.KeyV);
press('Digit2');event('Digit4');assert.deepEqual(sent,['1-3']);assert(box.hidden);assert(!pressed.Digit2&&!pressed.Digit4);
assert(event('Digit4','keydown',{repeat:true}).stopped,'閉じた直後のrepeatも遮断');assert(!pressed.Digit4);
event('Digit4','keyup');press('Digit4');assert(pressed.Digit4,'keyup後は通常操作');delete pressed.Digit4;
press('KeyV');press('Digit9');assert(!box.hidden);assert(!pressed.Digit9);press('Digit1');press('Digit0');assert.match(el('onlineQuickChatTitle').textContent,/定型通信/);
press('Escape');assert(box.hidden);assert(!pressed.Escape,'Escapeをロビーハンドラへ流さない');
press('KeyV');press('Numpad3');press('Numpad2');assert.deepEqual(sent,['1-3','2-1']);assert(!pressed.Numpad3&&!pressed.Numpad2);
state.phase='playing';state.matchId='match';panel.hidden=true;press('KeyV');assert(!box.hidden);
player.alive=false;player.downT=5;press('KeyV');assert(box.hidden);assert(pressed.KeyV,'死亡時はVを元の兵装選択へ返す');delete pressed.KeyV;
player.alive=true;player.downT=0;press('KeyV');player.lifeId++;refresh();assert(box.hidden,'life変更で閉じる');
press('KeyV');listeners.get('blur')();assert(box.hidden,'blurで閉じる');
press('KeyV');at=10001;refresh();assert(box.hidden,'10秒で閉じる');
press('KeyV');state.phase='countdown';refresh();assert(box.hidden,'開始待ちへ移ると閉じる');
state.phase='playing';press('KeyV');subscriber('reset');assert(box.hidden);assert.equal(el('onlineQuickChatLog').children.length,0);
state.phase='lobby';panel.hidden=false;press('KeyV');assert(!box.hidden);
el('onlineLogDialog').open=true;refresh();assert(box.hidden,'診断ログを開くと定型通信を閉じる');
const beforeLog=sent.length;assert(!press('KeyV').stopped);assert(box.hidden,'ログ閲覧中のVを横取りしない');
press('Digit1');assert.equal(sent.length,beforeLog,'ログ閲覧中の数字は通信を送らない');
el('onlineLogDialog').open=false;press('KeyV');assert(!box.hidden,'ログを閉じた後は定型通信を再開');press('Escape');
state.role='offline';refresh();assert(el('onlineQuickChatOpen').hidden);assert(!press('KeyV').stopped,'オフライン操作を変えない');
console.log('定型通信キー境界：V/数字・テンキー・repeat/keyup・入力欄/修飾キー・Esc/0・死亡の兵装選択・life/phase/blur/timeout/退出 成功');
