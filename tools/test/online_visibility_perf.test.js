// node tools/test/online_visibility_perf.test.js
// 壁時計や実機FPSでなく、旧実装との公開範囲一致と射線判定回数を検査する。
const assert=require('node:assert/strict');
const {createView}=require('../../prototype/online/visibility');

// e14f7e3の最適化前実装を固定。製品コードから動的生成せず、比較元の変更を検知する。
const previousLimits=Object.freeze({near:80,far:160,unitCount:20,extrapolationMs:100});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  function facing(observer,at){
    const dx=at.x-observer.pos.x,dy=at.y-observer.pos.y-3,dz=at.z-observer.pos.z,n=Math.hypot(dx,dy,dz);
    if(n<.001)return 1;
    const pitch=observer.pitch||0,cp=Math.cos(pitch),yaw=observer.yaw||0;
    return (-Math.sin(yaw)*cp*dx+Math.sin(pitch)*dy-Math.cos(yaw)*cp*dz)/n;
  }
  function previousCreateView({viewer,units,spotted,noticed,canSee,targetPoint,lineOfSight,locksPlayer}={}){
    const visible=new Set(),cadence=new Map(),allies=units.filter(u=>u.alive&&u.team===viewer.team);
    const seen=spotted?.[viewer.team]||new Map(),near=previousLimits.near;
    const scope=viewer.scoped?Math.max(1,viewer.slots?.[viewer.weapon]?.w?.scopeHigh&&viewer.scopeStep===2?viewer.slots[viewer.weapon].w.scopeHigh:viewer.slots?.[viewer.weapon]?.w?.scope||1):1;
    // 設定上限の縦100度・32:9画面の外接円をhost固定上限とする。clientの画角申告は信用しない。
    const directCos=Math.cos(Math.atan(Math.tan(50/scope*Math.PI/180)*Math.hypot(32/9,1))),aimCos=Math.cos(12*Math.PI/180);
    const direct=e=>facing(viewer,targetPoint(e))>=directCos&&!!canSee(viewer,e,targetPoint(e));
    for(const e of units){
      const d=distance(viewer.pos,e.pos),friend=e.team===viewer.team;
      const cloakKnown=!e.cloak||allies.some(a=>noticed(e,distance(a.pos,e.pos)));
      const allowed=friend||cloakKnown&&(e.cloak||d<=near||seen.has(e)||direct(e));
      if(!allowed)continue;
      visible.add(e.entityId);
      const aimed=facing(viewer,targetPoint(e))>=aimCos&&canSee(viewer,e,targetPoint(e));
      const threat=e.target===viewer||e.controlTarget===viewer||locksPlayer?.(e,viewer);
      const locked=viewer.controlTarget===e;
      cadence.set(e.entityId,e===viewer||d<=near||aimed||threat||locked||viewer.scoped&&direct(e)?1:d<=previousLimits.far?2:4);
    }
    const pointVisible=at=>!!at&&(distance(viewer.pos,at)<=near||facing(viewer,at)>=directCos)&&!!lineOfSight(viewer,at);
    const gadgetVisible=g=>g.team===viewer.team||allies.some(a=>distance(a.pos,g.pos)<=(g.onCore?60:({mine:30,remote:30,sensor:50,sentry:60}[g.kind]||0))&&lineOfSight(a,g.mesh?targetPoint(g):g.pos,g));
    const sourceVisible=e=>!e||e.entityId?(!e||visible.has(e.entityId)):e.gadget?gadgetVisible(e):e.kind==='turret'||e.kind==='radar'||e.kind==='core'||e.kind==='barricade'?true:pointVisible(e.pos);
    return {viewer,visible,cadence,pointVisible,gadgetVisible,sourceVisible};
  }

function unit(id,team,x=0,z=0){
  return {entityId:id,team,alive:true,pos:{x,y:0,z},yaw:0,pitch:0,
    weapon:'main',slots:{main:{w:{scope:4,scopeHigh:8}}}};
}
const noticed=(e,d)=>!e.cloak||d<8+e.vis*e.vis*80;
function evaluate(fn,options){
  const calls={sight:0,points:0,perUnit:new Map()};
  const view=fn({...options,
    canSee:(observer,e,at)=>{
      calls.sight++;calls.perUnit.set(e,(calls.perUnit.get(e)||0)+1);
      return options.canSee(observer,e,at);
    },
    targetPoint:e=>{calls.points++;return {...e.pos,y:e.pos.y+2.4};}
  });
  return {view,calls};
}
function compare(options){
  const old=evaluate(previousCreateView,options),current=evaluate(createView,options);
  assert.deepEqual([...current.view.visible],[...old.view.visible]);
  assert.deepEqual([...current.view.cadence],[...old.view.cadence]);
  for(const count of current.calls.perUnit.values())assert.equal(count,1,'同じViewの機体射線は1回まで');
  assert(current.calls.sight<=old.calls.sight,'最適化で射線判定を増やさない');
  return {old,current};
}

// 毎回更新が確定する機体では、公開済みならcadence用の射線を計算しない。
for(const priority of ['self','near','target','controlTarget','locksPlayer','locked']){
  const viewer=unit('B:0','B'),target=priority==='self'?viewer:unit('R:0','R',0,priority==='near'?-40:-120);
  if(priority==='self')viewer.pitch=-Math.PI/2; // 自機の足元も旧実装ではaim判定に入る。
  if(priority==='target')target.target=viewer;
  if(priority==='controlTarget')target.controlTarget=viewer;
  if(priority==='locked')viewer.controlTarget=target;
  const units=target===viewer?[viewer]:[viewer,target];
  const result=compare({viewer,units,spotted:{B:new Map([[target,1]])},noticed,
    canSee:()=>true,lineOfSight:()=>true,locksPlayer:e=>priority==='locksPlayer'&&e===target});
  assert.equal(result.current.view.cadence.get(target.entityId),1);
  assert.equal(result.current.calls.sight,0,priority+'はcadence用射線不要');
  assert(result.old.calls.sight>0,priority+'の削減を検査');
}
// 未発見の敵はthreat/lockedであっても公開判定の射線を省略しない。
{
  const viewer=unit('B:0','B'),target=unit('R:0','R',0,-120);target.target=viewer;viewer.controlTarget=target;
  const options={viewer,units:[viewer,target],noticed,canSee:()=>false,lineOfSight:()=>false};
  const result=compare(options);
  assert(!result.current.view.visible.has(target.entityId));
  assert.equal(result.current.calls.sight,1);
}
// 同じView内のdirectとaimは射線を共有し、次のViewでは遮蔽・位置・索敵を再評価。
{
  const viewer=unit('B:0','B'),target=unit('R:0','R',0,-120),spotted={B:new Map()};let clear=true;
  const options={viewer,units:[viewer,target],spotted,noticed,canSee:()=>clear,lineOfSight:()=>clear};
  let result=compare(options);
  assert.equal(result.old.calls.sight,2);assert.equal(result.current.calls.sight,1);
  assert(result.current.view.visible.has(target.entityId));
  clear=false;result=compare(options);assert(!result.current.view.visible.has(target.entityId));
  clear=true;target.pos.z=120;result=compare(options);assert(!result.current.view.visible.has(target.entityId));
  spotted.B.set(target,1);result=compare(options);assert(result.current.view.visible.has(target.entityId));
  spotted.B.clear();result=compare(options);assert(!result.current.view.visible.has(target.entityId));
  target.pos.z=-40;result=compare(options);assert(result.current.view.visible.has(target.entityId));
}

let seed=214;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
let previousSight=0,currentSight=0,previousPoints=0,currentPoints=0;
for(let trial=0;trial<10000;trial++){
  const count=trial%2?20:10;
  const units=Array.from({length:count},(_,i)=>{
    const u=unit('u'+i,i<count/2?'B':'R',random()*400-200,random()*400-200);
    Object.assign(u,{alive:random()>.1,yaw:random()*Math.PI*2,pitch:random()*1.6-.9,
      cloak:random()<.2,vis:random(),scoped:random()<.3,scopeStep:random()<.5?1:2});
    u.pos.y=random()*20;return u;
  });
  const viewer=units[trial%count],spotted={B:new Map(),R:new Map()};
  for(const u of units){
    u.target=random()<.2?viewer:null;u.controlTarget=random()<.1?viewer:null;
    if(random()<.3)spotted[viewer.team].set(u,1);
  }
  viewer.controlTarget=units[(trial+1)%count];
  const sight=new Map(units.map(u=>[u,random()<.6]));
  const options={viewer,units,spotted,noticed,canSee:(_observer,e)=>sight.get(e),
    lineOfSight:(_observer,at)=>at.x>=0,locksPlayer:(e,v)=>e.target===v};
  const {old,current}=compare(options);
  previousSight+=old.calls.sight;currentSight+=current.calls.sight;
  previousPoints+=old.calls.points;currentPoints+=current.calls.points;
  // 製品が返す遅延評価の公開関数も同じ結果を保つ。
  for(const at of [null,{x:0,y:0,z:0},{x:100,y:3,z:-120}])
    assert.equal(current.view.pointVisible(at),old.view.pointVisible(at));
  const gadget={gadget:true,kind:trial%2?'mine':'sentry',team:trial%3?'B':'R',pos:{x:10,y:0,z:-10},mesh:{},onCore:trial%5===0};
  assert.equal(current.view.gadgetVisible(gadget),old.view.gadgetVisible(gadget));
  for(const source of [null,...units,gadget,{kind:'core',pos:viewer.pos},{pos:{x:-50,y:0,z:-100}}])
    assert.equal(current.view.sourceVisible(source),old.view.sourceVisible(source));
}
assert(currentSight<previousSight,'固定seed全体で射線回数を削減');
assert(currentPoints<previousPoints,'固定seed全体で照準点の生成回数を削減');
console.log(`公開判定最適化：10,000例の公開範囲・更新頻度一致、優先機体・次回再評価 成功。射線 ${previousSight}→${currentSight}、照準点 ${previousPoints}→${currentPoints}`);
