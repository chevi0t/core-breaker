// WebGLなしで本体の移動関数そのものを読む。固定tickや移動式の試験用コピーは使わない。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const T = require('../../vendor/three-r128/three.min.js');
const source = fs.readFileSync(require.resolve('../../prototype/index.html'), 'utf8');
const section = (from, to) => {
  const a=source.indexOf(from),b=source.indexOf(to,a);
  assert(a>=0&&b>a, `本体の試験範囲が見つからない: ${from}`);
  return source.slice(a,b);
};
const movementSource = section('\nfunction resolve(u) {', '// よろけ・ダウン：1回の攻撃');
const inputSource = section('function movementPredictionBlockReason(', 'function playerUpdate(');
const statusSource = section('function movementStatusTick(', 'function radarToolTick(');
const clone = value => JSON.parse(JSON.stringify(value));
const movementKeys = ('yaw pitch boost maxBoost overheat boostIdle onGround dashT longDash dashState moveInput jumpBuf catCd zipCd ctrlLockT stun stunT electricT shockT shockSlow crouching actionHeld actionBlockBoost kneeSlideT flying charging chargerOn slideT lungeT recoverT').split(' ');
function movement(u) {
  return { ...Object.fromEntries(movementKeys.filter(k=>u[k]!==undefined).map(k=>[k,u[k]])),
    pos:u.pos.toArray(),vel:u.vel.toArray(),dashDir:u.dashDir.toArray(),boostVisualDir:u.boostVisualDir?.toArray() };
}
function makeUnit(extra={}) {
  return { alive:true,localView:false,team:'B',downT:0,hp:5000,maxHp:10000,sc:{total:4},
    pos:new T.Vector3(),vel:new T.Vector3(),dashDir:new T.Vector3(),lungeDir:new T.Vector3(),
    yaw:0,pitch:0,boost:100,maxBoost:100,overheat:false,boostIdle:0,onGround:true,walkV:13,dashV:46,cruiseV:30,
    dashT:0,longDash:false,dashState:'',moveInput:false,jumpBuf:0,catCd:0,zipCd:0,ctrlLockT:0,
    stun:'',stunT:0,electricT:0,shockT:0,jamT:0,crouching:false,actionHeld:false,actionBlockBoost:false,kneeSlideT:0,
    flying:false,charging:false,chargerOn:false,slideT:0,lungeT:0,recoverT:0,
    swing:null,meleeRecovery:null,planted:false,repairing:false,transfer:null,zip:null,catLaunch:null,catMomentum:null,jumpPad:null,lift:null,
    weapon:'main',prevWeapon:'main',switchT:0,rig:{legKind:'biped'},stats:{P:{legs:{kind:'biped',accelTime:1}}},
    slots:{main:{w:{type:'gun'},ammo:30,reserve:60,reloadT:0},sub:{w:{type:'gun'},ammo:3},aux:{w:{type:'sword'}},sp:{w:{type:'charger',use:4,speed:60},heat:100,overheat:false}},
    ...extra };
}
function harness() {
  const calls={sound:0,mirage:0,weapon:0,damage:0,facility:0,select:0,sp:0,reload:0};
  const c={T,Math,Number,console,cityMap:null,obstacles:[],waters:[],lifts:[],units:[],
    R:1.5,UNIT_H:4.5,MAP_X:500,MAP_Z:500,WALK_SLOPE_MAX:Math.tan(52*Math.PI/180),
    UP:new T.Vector3(0,1,0),terrainH:()=>0,SLOTS:['main','sub','aux','sp'],TOGGLE_SP:[],CAM:{up:4},VS:false,
    isSimulationAuthority:()=>true,isLocalView:u=>u.localView,
    isArtilleryMode:u=>u.weapon==='sp'&&['artillery','reflector'].includes(u.slots.sp.w.type),
    beamCannonMode:u=>u.weapon==='sp'&&u.slots.sp.w.type==='beamCannon',beamCannonTurn:()=>{},
    liftContains:(l,u)=>Math.abs(u.pos.x-l.pos.x)<l.w/2&&Math.abs(u.pos.z-l.pos.z)<l.depth/2,
    sfx:()=>calls.sound++,deployMirage:()=>calls.mirage++,spUse:()=>calls.sp++,
    cancelTransfer:u=>{calls.facility++;u.transfer=null;},startTransfer:u=>{calls.facility++;u.transfer={t:3};return true;},
    zipGrab:()=>calls.facility++,zipDrop:()=>calls.facility++,zipRide:()=>{calls.facility++;return true;},catapultControl:()=>calls.facility++,
    weaponsTick:()=>{calls.weapon++;return false;},selectWeapon:()=>calls.select++,reload:()=>calls.reload++,
    damage:()=>calls.damage++,noteDmg:()=>calls.damage++,kill:()=>calls.damage++,feed:()=>{},
    touchAutoTrigger:()=>false,hitMark:()=>{},TOUCH_INPUT:false,touch:{menu:false},rightDown:false};
  vm.createContext(c);
  vm.runInContext(movementSource+'\n'+statusSource+'\n'+inputSource,c);
  return {c,calls};
}
let count=0;
function check(name,fn) { fn();count++;console.log('移動先読み: '+name); }
check('可変dt・歩き・短/長boost・jump・向きが権威側と一致',()=>{
  const h=harness(),host=makeUnit(),guest=makeUnit();
  let jumps=0;
  for(let i=0;i<360;i++) {
    const dt=[.008,.017,.029,.011,.033][i%5],keys={};
    if(i<65||i>=90&&i<250)keys.KeyW=true;
    if(i>=25&&i<110)keys.ShiftLeft=true;
    if(i>=120&&i<170)keys.Space=true;
    if(i>=180&&i<200)keys.ArrowLeft=true;
    if(i>=200&&i<210)keys.ArrowUp=true;
    const input={keys,pressed:{...(i===25?{ShiftLeft:true}:{}),...(i===120?{Space:true}: {})},yaw:Math.sin(i/35)*.4,pitch:.1,fwd:i%11===0?.3:0,side:i>=260?.5:0};
    h.c.auxiliaryStatusTick(host,dt);h.c.updateHumanMovement(host,input,dt);
    assert.equal(h.c.predictHumanMovement(guest,input,dt),true);
    assert.deepEqual(movement(guest),movement(host),'入力 '+i);
    if(!guest.onGround)jumps++;
  }
  assert(jumps>10);assert(host.pos.distanceTo(new T.Vector3())>1);
  assert(h.calls.sound>0);assert.equal(h.calls.mirage,1);
});
check('しゃがみ・膝滑り・解除boost/jumpは同じ局所移動状態だけを再現',()=>{
  const h=harness(),host=makeUnit(),guest=makeUnit();
  for(let i=0;i<140;i++) {
    const keys={KeyW:true,...(i<30?{ShiftLeft:true}:{}),...(i>=10&&i<70?{KeyC:true}:{}),...(i===80?{Space:true}:{})};
    const input={keys,pressed:{...(i===0?{ShiftLeft:true}:{}),...(i===80?{Space:true}:{})},yaw:.7,pitch:0};
    const dt=[.01,.02,.033][i%3];
    h.c.auxiliaryStatusTick(host,dt);h.c.updateHumanMovement(host,input,dt);
    assert(h.c.predictHumanMovement(guest,input,dt));assert.deepEqual(movement(guest),movement(host));
    if(i===12)assert(guest.crouching&&guest.kneeSlideT>0);
    if(i===65)assert(guest.crouching&&!guest.kneeSlideT);
    if(i===80)assert(!guest.crouching&&!guest.onGround);
  }
});
check('壁・段差・水上ホバーも共通の当たり判定を使う',()=>{
  for(const hover of [false,true]) {
    const h=harness();h.c.obstacles.push({minX:-15,maxX:15,minZ:-12,maxZ:-10,bottom:0,top:10});
    if(hover)h.c.waters.push([-100,-100,100,100,2]);
    const options={pos:new T.Vector3(0,hover?2:0,0),stats:{P:{legs:{kind:hover?'hover':'biped',accelTime:.8}}}};
    const host=makeUnit({...options,pos:options.pos.clone()}),guest=makeUnit({...options,pos:options.pos.clone()});
    for(let i=0;i<180;i++) {
      const dt=[.007,.016,.027][i%3],input={keys:{KeyW:true},pressed:{}};
      h.c.auxiliaryStatusTick(host,dt);h.c.updateHumanMovement(host,input,dt);assert(h.c.predictHumanMovement(guest,input,dt));
      assert.deepEqual(movement(guest),movement(host));
    }
    assert(guest.pos.z>=-10+h.c.R-1e-6);assert.equal(guest.pos.y,hover?2:0);assert.equal(guest.hp,5000);
  }
});
check('確定済み感電/妨害タイマー・landing/受け身を可変dtで一致させる',()=>{
  for(const initial of [{electricT:.15},{shockT:.3,shockSlow:.2},{pos:new T.Vector3(0,30,0),vel:new T.Vector3(1,-35,0),onGround:false},{pos:new T.Vector3(0,4,0),vel:new T.Vector3(4,5,0),onGround:false,stun:'down',stunT:1.2}]) {
    const h=harness(),create=()=>makeUnit({...initial,pos:initial.pos?.clone()||new T.Vector3(),vel:initial.vel?.clone()||new T.Vector3()}),host=create(),guest=create();
    for(let i=0;i<130;i++) {
      const dt=[.009,.018,.032][i%3],input={keys:{KeyW:true,...(i<5?{ShiftLeft:true,Space:true}:{})},pressed:i===0?{ShiftLeft:true,Space:true}:{}};
      h.c.auxiliaryStatusTick(host,dt);h.c.updateHumanMovement(host,input,dt);assert(h.c.predictHumanMovement(guest,input,dt));
      assert.deepEqual(movement(guest),movement(host));
    }
    assert.equal(guest.hp,5000);assert.equal(guest.rig.landT,undefined);
  }
});
check('予測/巻き直しでは武器・ダメージ・SP・施設・音・ミラージを実行しない',()=>{
  const h=harness(),guest=makeUnit(),saved={slots:clone(guest.slots),score:clone(guest.sc)};
  for(let i=0;i<120;i++) {
    const input={keys:{KeyW:true,KeyR:true,...(i<20?{ShiftLeft:true}:{}),...(i>=30&&i<55?{Space:true}:{})},pressed:i===0?{ShiftLeft:true,Digit2:true}:i===30?{Space:true}:{},trigger:true,alt:true,wheel:1,weapon:'sub'};
    assert(h.c.predictHumanMovement(guest,input,[.013,.022][i%2]));
  }
  assert.deepEqual(h.calls,{sound:0,mirage:0,weapon:0,damage:0,facility:0,select:0,sp:0,reload:0});
  assert.deepEqual(guest.slots,saved.slots);assert.deepEqual(guest.sc,saved.score);assert.equal(guest.weapon,'main');assert.equal(guest.hp,5000);
  // 通常の人間更新は武器処理を引き続き一度だけ呼ぶ。
  const host=makeUnit();h.c.updateHumanUnit(host,{keys:{KeyR:true},trigger:true},.02);assert.equal(h.calls.weapon,1);assert.equal(h.calls.reload,1);
});
check('転送・施設・近接・SP加速の権威待ちではunit全体を変えない',()=>{
  const h=harness();
  for(const extra of [{alive:false},{downT:1},{transfer:{t:2}},{zip:{line:{}}},{repairing:true},{flying:true},{catMomentum:new T.Vector3(0,0,1)},
    {jumpPad:{}},{catLaunch:{}},{lift:{}},{swing:{}},{meleeRecovery:{}},{lungeT:.1},{recoverT:.2},{slideT:.3},{planted:true},{charging:true},{onlinePredictionBlocked:'lift'},
    {weapon:'sp',slots:{sp:{w:{type:'beamCannon'}}}},{weapon:'sp',slots:{sp:{w:{type:'artillery'}}}}]) {
    const u=makeUnit(extra),before=JSON.stringify(u);
    assert.equal(h.c.predictHumanMovement(u,{keys:{KeyW:true},pressed:{}},.02),false);assert.equal(JSON.stringify(u),before);
  }
  for(const input of [{keys:{KeyW:true},pressed:{KeyH:true}},{keys:{KeyW:true},pressed:{KeyE:true}}]) {
    const u=makeUnit(),before=JSON.stringify(u);assert.equal(h.c.predictHumanMovement(u,input,.02),false);assert.equal(JSON.stringify(u),before);
  }
  const lift={pos:new T.Vector3(),w:10,depth:10};h.c.lifts.push(lift);
  const u=makeUnit();assert.equal(h.c.movementPredictionBlockReason(u),'lift');h.c.lifts.length=0;
  assert.deepEqual(h.calls,{sound:0,mirage:0,weapon:0,damage:0,facility:0,select:0,sp:0,reload:0});
});
check('加速装置ONだけでは通常WASD/jumpを止めず、SP消費のboostだけ待つ',()=>{
  const h=harness(),host=makeUnit({chargerOn:true}),guest=makeUnit({chargerOn:true});
  for(let i=0;i<30;i++) {
    const input={keys:{KeyW:true,Space:i===0},pressed:i===0?{Space:true}:{}};
    h.c.auxiliaryStatusTick(host,.02);h.c.updateHumanMovement(host,input,.02);assert(h.c.predictHumanMovement(guest,input,.02));assert.deepEqual(movement(guest),movement(host));
  }
  const before=JSON.stringify(guest);assert.equal(h.c.predictHumanMovement(guest,{keys:{ShiftLeft:true},pressed:{ShiftLeft:true}},.02),false);
  assert.equal(JSON.stringify(guest),before);assert.equal(h.calls.sp,0);
});
check('予測入力でglobal player/keysや不正dtを変えない',()=>{
  const h=harness(),u=makeUnit(),player={pos:new T.Vector3(8,9,10)},keys={KeyS:true};h.c.player=player;h.c.keys=keys;
  const before=JSON.stringify(u);
  for(const dt of [0,-1,NaN,Infinity])assert.equal(h.c.predictHumanMovement(u,{keys:{KeyW:true}},dt),false);
  assert.equal(JSON.stringify(u),before);assert(h.c.predictHumanMovement(u,{keys:{KeyW:true}},.02));
  assert.equal(h.c.player,player);assert.equal(h.c.keys,keys);assert.deepEqual(player.pos.toArray(),[8,9,10]);assert.deepEqual(keys,{KeyS:true});
});
console.log(`移動先読み: ${count}項目 成功`);
