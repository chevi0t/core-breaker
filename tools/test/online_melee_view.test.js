const assert=require('node:assert/strict');
const {createMeleeSuite}=require('./online_melee_view_fixture');
const suite=createMeleeSuite(),copy=x=>JSON.parse(JSON.stringify(x));let count=0;
const check=(name,fn)=>{fn();count++;console.log('近接表示VM: '+name);};
for(const hz of [60,144])for(const speed of [10,26])for(const jitter of [false,true])check(`${hz}Hz/${speed}m/s/到着揺れ${jitter}の写真間の振り・踏み込み・視点`,()=>{
  const r=suite.run({hz,speed,jitter,turn:true});
  assert(r.frames>100&&r.snapshots>50);assert.equal(r.phase.stalled,0);assert.equal(r.phase.reverse,0);
  assert(r.phase.maxStep<=1/hz+.002);assert.equal(r.motion.reverse,0);assert(r.motion.cv<.02);
  assert.equal(r.maxYawJump,0);assert.equal(r.maxStackedOffset,0);
});
const a={time:1,windup:.1,sweep:.7,from:0,to:720,spin:true};
const swing=t=>({a,t,yaw0:.3,phi:.4,aimed:true,hit:[],stopped:false});
const melee=(t=.2)=>({pos:[0,0,0],vel:[10,0,0],predictionBlocked:'melee',swing:swing(t),lungeT:.5});
function active(){const f=suite.create();f.h.at(100);f.deliver(100,{predictionBlocked:'',pos:[0,0,0],vel:[0,0,0]});f.h.at(200);f.deliver(200,melee());f.h.game.beforeFrame(1/60,200);return f;}
check('長い写真欠落は振りと移動を最新写真+100msで止める',()=>{
  const {h,u}=active();let final;
  for(let t=210;t<=900;t+=10){h.at(t);h.game.beforeFrame(.01,t);h.c.weaponLook(u,.01);
    const p=u.pos.clone(),o=h.test.viewOffsetOf(u);if(o)p.add(o);
    assert(p.x<=1.001,'100ms外挿の1mより先へ進まない');assert(h.c.shownSwing.t<=.300001);if(t===900)final=p.x;
  }
  assert(Math.abs(final-1)<.001);assert(Math.abs(h.c.shownSwing.t-.3)<1e-6);
});
check('欠落・復旧で同じ振りを巻き戻さず最新写真の姿勢へ追従',()=>{
  const r=suite.run({hz:144,speed:10,jitter:true,gap:[400,650]});
  const phases=r.rows.filter(x=>x.t!==null);for(let i=1;i<phases.length;i++)assert(phases[i].t>=phases[i-1].t-1e-9);
  assert(phases.at(-1).t>phases[0].t);assert(phases.some((x,i)=>i&&x.t===phases[i-1].t),'欠落上限中は実際に止まる');
});
check('近接入りは直前の全描画offsetを継ぎ、補正を二重加算しない',()=>{
  const {h,u,deliver}=suite.create();h.at(100);deliver(100,{predictionBlocked:'',pos:[0,0,0]});
  u.onlineVisualOffset=u.pos.clone().fromArray([.1,0,0]);u.onlineRenderOffset=u.pos.clone().fromArray([-.2,0,0]);
  u.yaw=1.2;u.pitch=.3;h.at(150);deliver(150,melee(.1));
  const state=h.test.viewState();assert(Math.abs(state.blockedView.pos.x+.1)<1e-9);assert.equal(u.onlineVisualOffset,undefined);
  assert.equal(u.yaw,1.2);assert.equal(u.pitch,.3);assert.equal(h.game.metrics().prediction.pendingInputs,0);
});
check('近接終了は最後の表示位置から戻し、通常移動へ有限時間で戻る',()=>{
  const {h,u,deliver}=active();h.at(240);h.game.beforeFrame(.04,240);const before=u.pos.clone().add(h.test.viewOffsetOf(u));
  h.at(245);deliver(245,{pos:[.3,0,0],vel:[0,0,0],predictionBlocked:'',swing:null,lungeT:0});
  const release=h.test.viewState().meleeRelease;assert(release);assert(Math.abs(release.pos.x-before.x)<1e-9);
  for(let t=250;t<1500;t+=10){h.at(t);h.game.beforeFrame(.01,t);}
  assert.equal(h.test.viewState().meleeRelease,null);assert(Math.abs(u.pos.x-.3)<1e-9);
});
check('歩行と小さい写真補正が続いても近接終了の引継ぎは250msで解除',()=>{
  const {h,u,deliver}=active();h.at(240);h.game.beforeFrame(.04,240);
  h.at(245);deliver(245,{pos:[.3,0,0],vel:[10,0,0],predictionBlocked:'',swing:null,lungeT:0});
  h.c.collectLocalInput=u=>({keys:{KeyW:true},pressed:{},yaw:u.yaw,pitch:u.pitch,aimPoint:[0,0,-100]});
  let photo=245;
  for(let i=1;i<150;i++){
    const t=245+i*1000/144;h.at(t);
    if(t-photo>=1000/30){deliver(t,{pos:[u.pos.x+.01,0,0],vel:[10,0,0],predictionBlocked:'',swing:null,lungeT:0});photo=t;}
    h.game.beforeFrame(1/144,t);if(t>=500)assert.equal(h.test.viewState().meleeRelease,null);
  }
  assert(u.pos.x>1);assert(h.game.metrics().prediction.correctionCount>10);
});
for(const [name,patch]of [
  ['死亡',{alive:false,downT:3}],['再出撃',{lifeId:2}],['転送',{motionEpoch:1}],['装備',{cls:'heavy'}],
  ['被弾',{stun:'stagger',stunT:.4}],['電撃',{electricT:1}],['大差',{pos:[20,0,0]}],
])check(name+'では旧近接表示を持ち越さない',()=>{
  const {h,u,deliver}=active();h.at(240);h.game.beforeFrame(.04,240);h.c.weaponLook(u,.04);
  assert(h.test.viewState().localMeleeSwing);h.at(250);deliver(250,{...melee(.25),...patch});
  const state=h.test.viewState();assert.equal(state.blockedView,null);assert.equal(state.meleeRelease,null);assert.equal(state.localMeleeSwing,null);
  assert.equal(u.onlineRenderOffset,undefined);assert.equal(u.onlineVisualOffset,undefined);
});
check('低FPSホストの写真100ms/攻撃50ms進行でも同じ振りを巻き戻さない',()=>{
  const {h,u,deliver}=active();h.at(299);h.c.weaponLook(u,.05);const before=h.c.shownSwing.t;
  h.at(300);deliver(300,melee(.25));h.c.weaponLook(u,.05);assert(h.c.shownSwing.t>=before);assert(h.c.shownSwing.t<=u.swing.t+.1);
});
for(const physical of [{},{homing:true},{dash:true},{dash:true,homing:true},{dash:true,wall:true}])for(const hz of [60,144])check('実swordTick/physics/誘導の写真 '+JSON.stringify(physical)+' '+hz+'Hz',()=>{
  const r=suite.run({hz,physical,jitter:true}),phases=r.rows.filter(x=>x.t!==null);
  assert(phases.length>20);for(let i=1;i<phases.length;i++)assert(phases[i].t>=phases[i-1].t,'同じ攻撃の表示時計');
  assert(phases.some((x,i)=>i&&x.t>phases[i-1].t));
  if(physical.homing||physical.dash)assert(Math.hypot(...r.rows.at(-1).rawPosition)>1,'実踏み込み');
  if(physical.wall){assert(r.rows.every(x=>x.rawPosition[2]>=-7.50001),'物理は壁を通らない');assert(r.rows.at(-1).position[2]>=-7.51,'停止写真へ戻る');}
});
check('同型の新しい振り・連撃段は前の描画時刻を継がない',()=>{
  const {h,u,deliver}=active();h.at(290);h.c.weaponLook(u,.09);assert(h.c.shownSwing.t>.28);
  h.at(400);deliver(400,{...melee(.01)});h.c.weaponLook(u,1/60);assert(h.c.shownSwing.t<.02);
  h.at(420);deliver(420,{...melee(.03),swing:{...swing(.03),a:{...a,from:40}}});h.c.weaponLook(u,1/60);assert(h.c.shownSwing.t<.04);
});
check('描画が例外でもswing参照・t・hit集合・cannon時計を復元',()=>{
  const {h,u}=active(),ref=u.swing;ref.hit.add('test');const before=copy({...u.swing,hit:[...ref.hit]});u.cannonDeploy=.3;
  h.at(250);h.c.throwLook=true;assert.throws(()=>h.c.weaponLook(u,.05),/描画試験例外/);
  assert.equal(u.swing,ref);assert.deepEqual(copy({...u.swing,hit:[...ref.hit]}),before);assert.equal(u.cannonDeploy,.3);
});
check('ホスト・オフライン・相手機へ自機の描画先読みを混ぜない',()=>{
  for(const role of ['host','offline']){const {h,u}=active();h.game.state.role=role;h.at(250);h.c.weaponLook(u,.05);assert.equal(h.c.shownSwing.t,u.swing.t);}
  const {h,u}=active();h.at(250);const remote={...u,swing:{...u.swing,t:.15}};h.c.weaponLook(remote,.05);assert.equal(h.c.shownSwing.t,.15);
});
check('リセット・退出で旧試合の表示時刻と位置を消す',()=>{
  for(const reset of ['resetPrediction','clearPrediction']){const {h,u}=active();h.at(250);h.c.weaponLook(u,.05);h.test[reset]();const s=h.test.viewState();assert.equal(s.blockedView,null);assert.equal(s.meleeRelease,null);assert.equal(s.localMeleeSwing,null);}
});
console.log(`近接表示VM: ${count}条件 成功（WebGL/RTC未検証）`);
