// 全gun型の弾数・装填・連射・充填時計を実関数で検査する。
// shot/sfx/reveal/selectWeaponの末端と描画用材質は代役。命中・描画・通信を検証したことにはしない。
// node tools/test/gun_cycle_vm.test.js
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'prototype/index.html'),'utf8');
const source=fs.readFileSync(path.join(root,'prototype/weapons.js'),'utf8');
const section=(from,to)=>{const start=html.indexOf(from),end=html.indexOf(to,start+from.length);assert(start>=0&&end>start,from);return html.slice(start,end);};
class Color{lerp(){return this;}}
class Material{}
let shots=[],switches=[];
const c={console,structuredClone,SFX:{},T:{Color,MeshLambertMaterial:Material},TEAM:{B:{color:1},R:{color:2}},
  isHumanControlled:u=>u.human,sfx(){},reveal(){},shot:(u,sl,aim,spread,target)=>{shots.push({key:sl.w.key,charge:sl.w.q,target:target?.target?.id||null});return false;},selectWeapon:(u,key)=>switches.push(key)};
vm.createContext(c);
vm.runInContext(html.match(/^function baseKick.*$/m)[0]+'\n'+source+'\nObject.assign(this,weaponModels());Object.assign(this,weaponTables());',c);
vm.runInContext(section('function slotOf(', '\nfunction equip(')+'\n'+section('function missileTargetValid(', '\nfunction missileLockTick(')+'\n'+section('function missileGunTick(', '// 発射後は機体')+'\n'+section('function gunTick(', '\nfunction shot('),c);
const table=c.WEAPONS,gunKeys=Object.keys(table).filter(key=>table[key].type==='gun'),allKeys=new Set();
for(const [cls,slots]of Object.entries(c.ARMORY))for(const [slot,keys]of Object.entries(slots))for(const key of keys){
  assert(table[key],`${cls}/${slot}/${key} の武器が存在する`);assert.equal(table[key].key,key);assert(c.MODEL_OF[key],`${key} のモデル定義`);assert(Number.isFinite(c.WEAPON_KG[key]),`${key} の重量`);allKeys.add(key);
}
assert.equal(allKeys.size,Object.keys(table).length,'全武器が兵装のいずれかの枠に属する');
let checks=0;const results=[];
for(const human of [true,false])for(const cadence of [[.05],[1/144,.011,.029,1/60]])for(const key of gunKeys){
  const w=table[key],sl=c.slotOf(key),u={human,scoped:!!w.scope,vel:{x:0,y:0,z:0},pos:{x:0,y:0,z:0},reloadMul:1,prevWeapon:'main',team:'B'};
  const total=sl.ammo+sl.reserve,initialAmmo=sl.ammo;shots=[];switches=[];
  const period=w.chargeTime?w.chargeTime+.4:Math.max(2,(w.spin||0)+1),duration=Math.max(12,period*3);let elapsed=0,frame=0,reloads=0;
  while(elapsed<duration){
    const dt=cadence[frame++%cadence.length],phase=elapsed%period;
    const trigger=w.chargeTime?phase<w.chargeTime+.05:phase<period-.15;
    const priorReload=sl.reloadT;c.gunTick(u,sl,dt,trigger,null,0);if(priorReload<=0&&sl.reloadT>0)reloads++;
    for(const field of ['ammo','reserve','cd','reloadT','spin','temp','ohT','conv','heat','chargeT','holdT'])assert(Number.isFinite(sl[field]),`${key}: ${field} は有限値`);
    assert(sl.ammo>=0&&sl.ammo<=w.mag,`${key}: 弾倉は範囲内`);assert(sl.reserve>=0&&sl.reserve<=sl.resMax,`${key}: 予備弾は範囲内`);
    assert.equal(total-sl.ammo-sl.reserve,w.infinite?0:shots.length,`${key}: 発射数と全弾数の減少が一致`);
    elapsed+=dt;
  }
  assert(shots.length>0,`${key}: ${human?'人間':'Bot'}が発射できる`);
  if(w.infinite)assert.equal(sl.ammo,initialAmmo,`${key}: 無限武器の弾数は減らない`);
  if(w.chargeTime)assert(shots.every(s=>s.charge>0),`${key}: 充填分だけ発射する`);
  if(w.back)assert(switches.length>0,`${key}: 発射後に元の枠へ戻す指示が出る`);
  results.push({key,human,cadence:cadence.length===1?'50ms':'mixed',shots:shots.length,reloads});checks++;
}
// ミサイルは同一lifeのロックだけを消費し、古いlifeの目標を発射先へ渡さない。
for(const key of gunKeys.filter(key=>table[key].missile)){
  const w=table[key],sl=c.slotOf(key),good={id:'good',kind:'unit',team:'R',alive:true,lifeId:2},old={id:'old',kind:'unit',team:'R',alive:true,lifeId:3};
  const u={human:true,scoped:false,vel:{x:0,z:0},team:'B',reloadMul:1};shots=[];
  sl.missileLocks=[{target:good,life:2},{target:old,life:2}];
  for(let i=0;i<300;i++)c.gunTick(u,sl,.05,true,null,0);
  assert(shots.length>0&&shots.every(s=>s.target==='good'),`${key}: 有効lifeの目標だけ発射キューへ渡す`);checks++;
}
const counts={};for(const w of Object.values(table))counts[w.type]=(counts[w.type]||0)+1;
console.log(JSON.stringify({scope:'実テーブル/実gunTick/実missileGunTick、shot末端は計数のみ。WebGL/RTC/命中/全SPの動作は未検証',weapons:Object.keys(table).length,gunWeapons:gunKeys.length,checks,types:counts}));
