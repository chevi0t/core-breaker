// ネット/旧commitを必要としない小さい回帰。詳細な旧版比較は*_fixture.jsで別実行。
const assert=require('node:assert/strict');
const {createPhysicsSuite}=require('./online_physics_sync_fixture');
const suite=createPhysicsSuite();let count=0;
for(const unitClass of ['assault','heavy'])for(const mode of ['stop','walk','shortDash','longDash','jump']){
  const result=suite.run({mode,unitClass});
  assert.equal(result.last2seconds.hardSnaps,0,`${unitClass}/${mode}`);
  assert(result.last2seconds.max<.02,`${unitClass}/${mode}: cm量子化を超える周期補正`);
  assert.equal(result.equipment.spType,unitClass==='assault'?'charger':'cannon');
  assert.equal(result.equipment.dash,unitClass==='assault'?46:38.755);count++;
}
const direct=suite.run({mode:'walk',useCodec:false});
assert(direct.last2seconds.max<1e-8,'通信丸めなしの直進は一致');
console.log(`実移動の同期：初期強襲/重火力の平地5動作 ${count}組、実fixed schema/codec/微小frame揺れで最大2cm未満・hardSnap0、丸めなし直進一致 成功`);
// 直近batchを2/3描画ごとに送り、20ms transport pumpの量子化も重ねる。
for(const [hostHz,guestHz] of [[60,60],[60,144],[144,60]])for(const inputEveryFrames of [1,2,3])for(const mode of ['shortDash','longDash']){
  const result=suite.run({hostHz,guestHz,guestPattern:null,inputEveryFrames,mode,durationMs:4200,transportPumpMs:20});
  assert(result.last2seconds.max<.05,`${hostHz}/${guestHz}/${inputEveryFrames}/${mode}`);
  assert.equal(result.last2seconds.hardSnaps,0);
}
const repeated=suite.run({mode:'longDash',durationMs:4200,guestPattern:null,inputGap:[2300,2450]});
assert(repeated.repeatedCommands>0,'held補完のある対照');
assert(repeated.last2seconds.max<.05,'反復時間を後続命令へ重ねない');
for(const guestHz of [144,240]){
  const result=suite.run({mode:'longDash',guestHz,guestPattern:null,durationMs:12000,transportPumpMs:20});
  assert(result.inputBatches<=720,'高Hz描画でも新命令のないframeはenqueueしない');
}
console.log('18組の2/3frame間引き＋20ms pump、反復時間控除、高Hz12秒のenqueue上限 成功');
for(const mode of ['shortDash','longDash','reverse']){
  const result=suite.run({mode,durationMs:6500,guestPattern:null,guestPause:[2300,2800]});
  assert.equal(result.rows.at(-1).repeatDebt,0,'中立化後の復帰で永久の予測負債を残さない');
  assert(result.last2seconds.max<.05);assert.equal(result.last2seconds.hardSnaps,0);
}
console.log('500ms guest描画停止からの予測時計復帰・短/長dash/反転 成功');
const recoveredJump=suite.run({mode:'jump',durationMs:6500,guestPattern:null,guestPause:[1950,2450],snapshotGap:[2430,3000]});
assert(recoveredJump.last2seconds.max<.05);assert.equal(recoveredJump.last2seconds.hardSnaps,0);
assert.equal(recoveredJump.rows.at(-1).repeatDebt,0,'復帰最初のACK写真が欠けても累積境界で戻る');
assert.equal(recoveredJump.hostMovementPresses.filter(row=>row.pressed.Space).length,4,'復帰中を含む4回のジャンプ押下を一度ずつ適用');
