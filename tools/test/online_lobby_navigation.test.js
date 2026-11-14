// 実ui.js・game.jsを通す遷移回帰。DOM・保存媒体・通信は代役で、実ブラウザの表示を保証しない。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const file=require.resolve('./online_lobby_ui.test.js'),source=fs.readFileSync(file,'utf8');
function setup(){
  const end=source.indexOf('\nasync function run(){');assert(end>0);
  const sandbox={require:createRequire(file),__dirname:path.dirname(file),URL,console,setTimeout,clearTimeout};vm.createContext(sandbox);
  vm.runInContext(source.slice(0,end)+'\nthis.h={c,game,els,doc,events,intervals,press,join};',sandbox);
  const h=sandbox.h;h.e=id=>h.els.get(id);h.click=id=>h.e(id).click();
  const create=h.game.create;h.game.create=opts=>{h.options=opts;return create(opts);};
  h.change=(id,value)=>{h.e(id).value=value;h.e(id).onchange();};
  h.weapon=value=>{const select=h.e('onlineEquipmentFields').querySelectorAll('select').find(e=>e.dataset.equipment==='main');select.value=value;select.onchange();};
  h.open=async()=>{h.click('menuOnline');h.click('onlineCreate');await new Promise(r=>setImmediate(r));h.join('guest');};
  return h;
}
const record=h=>JSON.stringify(h.game.savedBuilds());
test('部屋へ戻る保存/破棄は固定欄にあり、最初メニューへの退出とラベル・領域を分ける',async()=>{
  const h=setup();await h.open();h.click('onlineEquipment');
  for(const id of ['onlineEquipmentSave','onlineEquipmentCancel'])assert(h.e(id).closest('.online-footer'));
  assert(!h.e('onlineEquipmentActions').hidden);assert(h.e('onlineRoomActions').hidden);
  assert.match(h.e('onlineLocation').textContent,/部屋に参加中.*装備を変更中/);
  assert.equal(h.e('onlineClose').textContent,'部屋を退出して最初のメニューへ');
  const ui=fs.readFileSync(require.resolve('../../prototype/online/ui.js'),'utf8');
  assert.match(ui,/id="onlineEquipmentSave"[^>]*>保存して部屋に戻る</);assert.match(ui,/id="onlineEquipmentCancel"[^>]*>下書きを破棄して部屋に戻る</);assert(!ui.includes('戻る／退出'));
  h.game.leave();
});
test('ロビー/装備編集中のEscapeと長押しで初期メニューへ出ず、下書きを保存できる',async()=>{
  const h=setup();await h.open();const id=h.game.state.roomId,peers=h.game.state.peers;
  h.press('Escape');assert(!h.e('onlinePanel').hidden);assert.equal(h.game.state.roomId,id);
  h.click('onlineEquipment');h.weapon('alternate');const before=record(h);
  for(let i=0;i<3;i++)h.press('Escape');const repeat={code:'Escape',repeat:true,preventDefault(){},stopImmediatePropagation(){this.stopped=true;}};for(const f of h.events.get('keydown')){f(repeat);if(repeat.stopped)break;}assert(!h.e('onlineEquipmentEditor').hidden);assert(!h.e('onlinePanel').hidden);assert.equal(record(h),before);
  h.click('onlineEquipmentSave');assert(h.e('onlineEquipmentEditor').hidden);assert(!h.e('onlinePanel').hidden);assert(h.e('onlineEquipmentActions').hidden);assert(!h.e('onlineRoomActions').hidden);
  assert.equal(h.game.state.roomId,id);assert.equal(h.game.state.peers,peers);assert.equal(h.game.state.equipment.loadout.main,'alternate');assert.equal(h.game.savedBuilds().list[0].loadout.assault.main,'alternate');assert.equal(h.game.state.lobbyReady,false);assert.equal(h.doc.activeElement.id,'onlineReady');
  // 隠れた保存ボタンへの遅い二重イベントは再保存しない。
  const saved=record(h),status=h.e('onlineStatus').textContent;h.click('onlineEquipmentSave');assert.equal(record(h),saved);assert.equal(h.e('onlineStatus').textContent,status);h.game.leave();
});
test('構成切替の下書きは退出確認の取消で残り、明示破棄だけが保存せず同じ部屋へ戻す',async()=>{
  const h=setup();await h.open();const before=record(h),id=h.game.state.roomId;
  h.click('onlineEquipment');h.weapon('alternate');h.change('onlineEquipmentBuild','2');h.weapon('alternate');h.change('onlineEquipmentBuild','0');
  for(let i=0;i<2;i++){
    h.click('onlineClose');assert(h.e('onlineLeaveDialog').open);assert.equal(h.doc.activeElement.id,'onlineLeaveCancel');assert.match(h.e('onlineLeaveDescription').textContent,/ホスト.*全員.*未保存.*破棄/);assert.equal(h.game.state.roomId,id);
    h.click('onlineLeaveCancel');assert(!h.e('onlineLeaveDialog').open);assert(!h.e('onlineEquipmentEditor').hidden);assert.equal(h.game.state.roomId,id);assert.equal(record(h),before);
  }
  h.click('onlineEquipmentSave');assert.equal(h.game.savedBuilds().list[0].loadout.assault.main,'alternate');assert.equal(h.game.savedBuilds().list[2].loadout.assault.main,'alternate');
  const saved=record(h);h.click('onlineEquipment');h.weapon('main');h.click('onlineEquipmentCancel');assert.equal(record(h),saved);assert.equal(h.game.state.roomId,id);assert(!h.e('onlinePanel').hidden);assert(!h.game.state.editing);assert.equal(h.game.state.lobbyReady,false);assert.match(h.e('onlineStatus').textContent,/下書きを破棄して部屋に戻りました/);h.game.leave();
});
test('装備の保存/終了通知が失敗しても編集を閉じず、下書きと接続を保持して再操作できる',async()=>{
  const h=setup();await h.open();const id=h.game.state.roomId;h.click('onlineEquipment');h.weapon('alternate');
  const save=h.game.saveEquipmentBuilds;h.game.saveEquipmentBuilds=()=>{throw Error('保存試験の失敗');};h.click('onlineEquipmentSave');assert(!h.e('onlineEquipmentEditor').hidden);assert.equal(h.game.state.roomId,id);assert.match(h.e('onlineStatus').textContent,/保存試験の失敗/);
  h.game.saveEquipmentBuilds=save;const edit=h.game.setEditing;h.game.setEditing=()=>{throw Error('終了送信試験の失敗');};h.click('onlineEquipmentCancel');assert(!h.e('onlineEquipmentEditor').hidden);assert.equal(h.game.state.roomId,id);
  h.game.setEditing=edit;h.click('onlineEquipmentSave');assert(h.e('onlineEquipmentEditor').hidden);assert.equal(h.game.state.equipment.loadout.main,'alternate');h.game.leave();
});
test('ホスト/ゲストの退出は確認まで接続を保ち、確認後だけ一度退出して保存構成を残す',async()=>{
  for(const role of ['host','guest']){
    const h=setup();await h.open();h.game.state.role=role;const before=record(h),leave=h.game.leave;let calls=0;h.game.leave=(...args)=>{calls++;leave(...args);};
    h.click('onlineClose');assert.equal(calls,0);assert.equal(h.game.state.role,role);const text=h.e('onlineLeaveDescription').textContent;
    assert(role==='host'?text.includes('全員'):text.includes('この部屋との接続'));assert.equal(h.e('onlineLeaveDialog').getAttribute('aria-describedby'),'onlineLeaveDescription');
    h.click('onlineLeaveConfirm');assert.equal(calls,1);assert.equal(h.game.state.role,'offline');assert(h.e('onlinePanel').hidden);assert.equal(record(h),before);assert.equal(h.doc.activeElement.id,'menuOnline');h.click('onlineLeaveConfirm');assert.equal(calls,1);
  }
});
test('退出確認中は定型通信/ロビーEscapeが競合せず、試合開始時に古い確認を閉じる',async()=>{
  const h=setup();await h.open();h.click('onlineClose');assert(h.e('onlineLeaveDialog').open);
  h.press('KeyV',h.e('onlineLeaveCancel'));assert(h.e('onlineQuickChat').hidden);
  const e=h.press('Escape',h.e('onlineLeaveCancel'));assert(!e.prevented&&!e.stopped,'native dialogのcancelを妨げない');
  // DOM代役ではブラウザ既定のcancel→closeだけを模倣する。
  h.e('onlineLeaveDialog').close();assert(!h.e('onlinePanel').hidden);assert.equal(h.game.state.phase,'lobby');
  h.click('onlineClose');h.game.state.phase='countdown';h.options.onCountdown();assert(!h.e('onlineLeaveDialog').open);assert(h.e('onlinePanel').hidden);h.game.leave();
});
test('未入室では直接メニューに戻り、接続待ちの取消は確認と世代検査で遅着を無視する',async()=>{
  const h=setup();h.click('menuOnline');h.click('onlineClose');assert(h.e('onlinePanel').hidden);assert(!h.e('onlineLeaveDialog').open);
  h.click('menuOnline');let complete;h.game.create=()=>new Promise(r=>{complete=r;});h.click('onlineCreate');h.click('onlineClose');assert(h.e('onlineLeaveDialog').open);assert.match(h.e('onlineLeaveTitle').textContent,/接続を取り消して/);
  h.click('onlineLeaveConfirm');assert(h.e('onlinePanel').hidden);complete('stale-room');await new Promise(r=>setImmediate(r));assert.equal(h.e('onlineRoom').value,'');assert(h.e('onlinePanel').hidden);assert.equal(h.game.state.role,'offline');
});
test('ゲストの装備確認待ちは固定保存/破棄を無効化し、保存後のフォーカスを見える状態欄へ移す',async()=>{
  const h=setup();await h.open();h.game.state.role='guest';h.click('onlineEquipment');h.weapon('alternate');h.click('onlineEquipmentSave');
  assert(h.game.state.equipmentPending);assert(h.e('onlineEquipmentEditor').hidden);assert(h.e('onlineReady').disabled);assert.equal(h.doc.activeElement.id,'onlineStatus');assert(!h.e('onlinePanel').hidden);h.game.leave();
});
// 実capture listenerと本体のスクロールhandlerを、DOM代役のcapture→target順で通す。
for(const role of ['host','guest'])test(role+'：結果のメニューへは部屋を維持するスクロールだけ',async()=>{
  const h=setup();await h.open();h.game.state.role=role;h.options.onLobbyReturn();
  const overlay=h.doc.createElement('div');overlay.id='overlay';h.doc.body.append(overlay);
  const button=h.doc.createElement('button');button.id='mxResNext';overlay.append(button);
  const label=h.doc.createElement('b');button.append(label);
  const menu=h.doc.createElement('div');menu.className='mx';overlay.append(menu);
  const oldQuery=h.doc.querySelector;h.doc.querySelector=s=>s==='#pgMenu .mx'?menu:oldQuery(s);
  let scrolls=0;menu.scrollIntoView=o=>{assert.equal(o.behavior,'smooth');scrolls++;};
  const html=fs.readFileSync(require.resolve('../../prototype/index.html'),'utf8');
  const handler=html.split('\n').find(s=>s.startsWith("$('mxResNext').addEventListener('click'"));assert(handler);
  const oldDollar=h.c.$;h.c.$=id=>h.e(id);vm.runInContext(handler,h.c);h.c.$=oldDollar;
  const before=JSON.stringify({room:h.game.state.roomId,roster:h.game.state.roster});
  const status=h.e('onlineStatus').textContent;
  for(const target of [button,label]){
    const e={target,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
    for(const f of h.events.get('doc:click')||[]){f(e);if(e.stopped)break;}
    if(!e.stopped)for(const f of button.handlers.click||[])f(e);
    assert(!e.stopped&&!e.prevented,'スクロール用クリックを遮断しない');
    assert(h.e('onlinePanel').hidden);assert.equal(h.e('onlineStatus').textContent,status);
    assert.equal(h.game.state.phase,'lobby');assert.equal(JSON.stringify({room:h.game.state.roomId,roster:h.game.state.roster}),before);
  }
  assert.equal(scrolls,2);h.game.leave();
});
