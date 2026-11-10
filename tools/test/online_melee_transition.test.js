const assert=require('node:assert/strict');
const {releaseWalk,lockedLunge,createLockHarness}=require('./online_melee_transition_fixture');
const revision=process.argv.find(a=>a.startsWith('--revision='))?.split('=')[1]||'working';
let count=0;
const check=(name,fn)=>{fn();count++;console.log('近接境界VM: '+name);};
for(const hz of [60,120,144,240])check(`${hz}Hzで硬直明けにWを保持しても固定60Hzの段へ戻らない`,()=>{
  const r=releaseWalk(revision,hz);
  assert(r.movement.cv<.06,JSON.stringify(r.movement));assert.equal(r.movement.reverse,0);
  assert(r.movement.min>10/hz*.95);assert(r.movement.max<10/hz*1.2);assert.equal(r.releaseAt500,false);
});
for(const hz of [60,120,144,240])for(const on of [false,true])check(`${hz}Hz/ロック${on}: 写真受理から次の照準計算まで位置の基準を飛ばさない`,()=>{
  const r=lockedLunge(revision,hz,on);
  assert(r.maxPhotoViewShift<1e-9,`写真直後のずれ ${r.maxPhotoViewShift}`);
  assert.equal(r.yaw.reverse,0,'直線踏み込み中にロック追従が逆向きへ戻らない');
  assert(r.maxYawStep<.05/hz,'描画Hzに応じて角度が進む');
  if(!on)assert.equal(r.maxYawStep,0,'ロックなしの入力角を変えない');
});
check('描画offsetはロックの原点だけへ足し、物理位置とoffsetを変えない',()=>{
  const {c,u,enemy}=createLockHarness(revision);
  u.pos.set(2,1,-6);u.yaw=.1;u.pitch=-.2;u.recoil=.03;u.recoilYaw=-.02;
  u.onlineVisualOffset=u.pos.clone().set(.1,.2,.3);u.onlineRenderOffset=u.pos.clone().set(-.3,.1,-.8);
  const raw=u.pos.toArray(),visual=u.onlineVisualOffset.toArray(),render=u.onlineRenderOffset.toArray();
  const translated={...u,pos:u.pos.clone().add(u.onlineVisualOffset).add(u.onlineRenderOffset),onlineVisualOffset:null,onlineRenderOffset:null};
  c.lock.down=false;const actual=c.lockStick(u,enemy,.05),down=c.lock.down;
  c.lock.down=false;const expected=c.lockStick(translated,enemy,.05);
  assert(Math.abs(actual.yaw-expected.yaw)<1e-12);assert(Math.abs(actual.pitch-expected.pitch)<1e-12);assert.equal(c.lock.down,down);
  assert.deepEqual(u.pos.toArray(),raw);assert.deepEqual(u.onlineVisualOffset.toArray(),visual);assert.deepEqual(u.onlineRenderOffset.toArray(),render);
});
check('offsetなしは既存の端への補正を維持し、機体内の照準を中心へ寄せない',()=>{
  const {c,u,enemy}=createLockHarness(revision);c.CAM.side=0;enemy.pos.set(0,0,-26);u.yaw=.01;u.pitch=-.1;
  const inside=c.lockStick(u,enemy,.01);assert(Math.abs(inside.yaw)<1e-12);assert.equal(inside.pitch,0);
  u.yaw=.2;const outside=c.lockStick(u,enemy,.01);assert(Math.abs(outside.yaw+.01)<1e-12);assert.equal(outside.pitch,0);
});
console.log(`近接境界VM: ${count}条件 成功（人工写真・WebGL/RTC未検証）`);
