// 行動不能中・大破後の見回し。位置補正と視点の更新を分けて検査する。
const assert=require('node:assert/strict');
const {createDownedSuite}=require('./online_downed_view_fixture');
const revision=process.argv.find(a=>a.startsWith('--revision='))?.slice(11)||'working';
const suite=createDownedSuite(revision);
let count=0;
for(const hz of [60,144])for(const mode of ['downed','wrecked','f_transition']){
  const r=suite.run(hz,mode);
  assert.equal(r.reverseFrames,0,`${mode}/${hz}Hz: 写真到着でカメラを逆向きへ戻さない`);
  assert(r.maxSnapshotYawDeg<1e-8&&r.maxSnapshotPitchDeg<1e-8,`${mode}/${hz}Hz: 写真が見回しの角度を上書きしない`);
  assert(r.maxExpectedErrorDeg<1e-8&&r.maxExpectedPitchErrorDeg<1e-8,`${mode}/${hz}Hz: 相対マウス入力を累積する`);
  assert(r.maxCameraYawStepDeg<=120/hz+1e-8,`${mode}/${hz}Hz: 1描画コマの角度`);
  count++;
}
const boundaries=suite.boundaries(),offline=suite.offline();
assert.equal(offline.fWreckPreservesLook,'pass');
console.log(`行動不能のゲスト視点：${count}描画条件・${boundaries.length}境界 成功。実downTick/wreckとの意図一致、F送信、位置hard-snapを保持。実WebGL/RTC/人の操作感は未検証。`);
