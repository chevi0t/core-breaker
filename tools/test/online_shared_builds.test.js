// 実game.jsの共通構成API。保存媒体・描画・通信は代役で、実ブラウザ永続化は未検証。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
function setup(){
 const file=require.resolve('./online_rooms.test.js'),text=fs.readFileSync(file,'utf8'),end=text.indexOf('\n(async()=>');assert(end>0);
 const s={require:createRequire(file),console,setTimeout,clearTimeout};vm.createContext(s);vm.runInContext(text.slice(0,end)+'\nthis.h={c,game,savedBuildFixture};',s);return s.h;
}
const copy=x=>JSON.parse(JSON.stringify(x));
test('共通3構成は独立コピーで入室時に全兵装と保存名を使う',async()=>{
 const {c,game,savedBuildFixture:f}=setup();c.playerName='保存名';const r=f.read();r.list[1].loadout.heavy.main='alternate';c.applyBuildRecord(r);
 game.chooseSavedBuild(1);const exported=game.savedBuilds();exported.list[1].loadout.heavy.main='main';assert.equal(f.read().list[1].loadout.heavy.main,'alternate');
 await game.create({cls:'heavy'});assert.equal(game.state.equipment.loadout.main,'alternate');assert.equal(game.state.equipment.loadouts.assault.main,'main');assert.equal(game.state.transport.options.displayName,'保存名');assert.throws(()=>game.chooseSavedBuild(0),/入室後/);game.leave();
});
test('編集差分だけを共通3構成へ保存し、別変更と他兵装を保持',async()=>{
 const {c,game,savedBuildFixture:f}=setup();await game.create();const baseline=game.savedBuilds(),draft=copy(baseline),newer=f.read();
 draft.cur=2;draft.list[2].loadout.heavy.main='alternate';newer.list[0].mech.head='light';c.applyBuildRecord(newer);
 const result=game.saveEquipmentBuilds(draft,baseline,'heavy');assert(result.saved);assert.equal(f.writes(),1);assert.equal(f.read().list[0].mech.head,'light');assert.equal(f.read().list[2].loadout.heavy.main,'alternate');assert.equal(game.state.equipment.loadout.main,'alternate');assert.equal(game.state.equipment.loadouts.assault.main,'main');
 game.setEquipment({cls:'assault',loadout:{...c.CLASSES.assault,main:'alternate'}});assert.equal(game.state.equipment.loadouts.heavy.main,'alternate');game.leave();assert.equal(f.read().cur,2);
});
test('不正構成・確認待ちは保存しない。保存禁止時は画面内の構成を維持',async()=>{
 const {c,game,savedBuildFixture:f}=setup();await game.create();const baseline=game.savedBuilds(),bad=copy(baseline);bad.list[1].loadout.heavy.main='invalid';assert.throws(()=>game.saveEquipmentBuilds(bad,baseline,'assault'));assert.equal(f.writes(),0);assert.deepEqual(f.read().list,baseline.list);
 game.state.equipmentPending=true;assert.throws(()=>game.saveEquipmentBuilds(baseline,baseline,'assault'),/確定/);assert.equal(f.writes(),0);game.state.equipmentPending=false;
 c.buildSaveState.failed=true;const draft=copy(baseline);draft.list[0].loadout.assault.main='alternate';assert.equal(game.saveEquipmentBuilds(draft,baseline,'assault').saved,false);assert.equal(game.state.equipment.loadout.main,'alternate');game.leave();
});
test('アクションは構成ごとに保存し、兵装切替・別タブの変更でも保持',async()=>{
 const {c,game,savedBuildFixture:f}=setup();await game.create();assert.equal(game.state.equipment.actionId,'crouch');
 const baseline=game.savedBuilds(),draft=copy(baseline),newer=f.read();
 draft.cur=1;draft.list[1].actionId='kick';newer.list[2].actionId='tackle';c.applyBuildRecord(newer);
 game.saveEquipmentBuilds(draft,baseline,'heavy');assert.equal(f.read().list[1].actionId,'kick');assert.equal(f.read().list[2].actionId,'tackle');assert.equal(game.state.equipment.actionId,'kick');
 game.setEquipment({cls:'support'});assert.equal(game.state.equipment.actionId,'kick');game.leave();game.chooseSavedBuild(2);await game.create();assert.equal(game.state.equipment.actionId,'tackle');game.leave();
});
