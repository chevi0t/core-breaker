// 削りより崩し：低ダメージでも操作・射撃を止め、復帰して追撃する時間を作る。
const {check}=require('./lib');
check('Cアクションのよろけ',async({ev,ok,sortie})=>{
 await sortie('dock');
 const result=await ev(()=>{
  const g=__g,T=g.T,p=g.player,bot=g.units.find(u=>u.team!==p.team),stop=new T.Vector3(),checks=[],timings=[];
  const floor={minX:-150,maxX:150,minZ:-150,maxZ:150,top:200};g.obstacles.length=0;g.obstacles.push(floor);g.waters.length=0;
  const yes=(v,s)=>{if(!v)throw Error(s);checks.push(s);};
  function setup(id,actor=p){
   const victim=actor===p?bot:p;
   for(const u of g.units){u.alive=false;u.respawnT=1e9;u.pos.set(10000,0,10000);}
   for(const u of [actor,victim]){
    u.mech={...g.MECH_DEFAULT};g.equip(u,'assault');g.resetLifeState(u);
    Object.assign(u,{alive:true,hp:10000,maxHp:10000,onGround:true,invulT:0,yaw:0,pitch:0,boost:u.maxBoost,overheat:false,switchT:0,actionId:id});
    u.stats={...u.stats,weight:5000};u.armorAvg=1;u.vel.set(0,0,0);
   }
   actor.pos.set(0,200,20);victim.pos.set(0,200,18);return victim;
  }
  function tick(u,t,wish=stop){for(let x=0;x<t-1e-9;){const dt=Math.min(1/120,t-x);g.physics(u,wish,false,false,dt);x+=dt;}}
  function hit(actor,victim){const hp=victim.hp;yes(g.actionMoveStart(actor),'発動可能');for(let i=0;i<120&&victim.hp===hp;i++)tick(actor,1/120);return hp-victim.hp;}
  for(const actor of [p,bot])for(const id of ['tackle','kick']){
   const v=setup(id,actor),a=g.ACTIONS[id],damage=hit(actor,v),name=(actor===p?'プレイヤー':'Bot')+'の'+id;
   yes(Math.abs(damage-a.damage)<.01&&damage<=800,name+'は低ダメージ');
   yes(v.stun==='stagger'&&Math.abs(v.stunT-a.staggerTime)<.001,name+'はダメージ閾値と独立した所定のよろけ');
   const remaining=(id==='tackle'?a.time:a.time)-actor.actionMove.elapsed+(id==='tackle'?a.hitRecovery:a.recovery);
   yes(v.stunT>remaining+.1,name+'は当てた側が動作から復帰して追撃できる');
   timings.push({name,damage,stagger:v.stunT,attackerRemaining:remaining});
   v.actionPush=null;v.vel.set(0,0,0);const at=v.pos.clone(),ammo=v.slots.main.ammo;
   for(let i=0;i<24;i++){g.physics(v,new T.Vector3(1,0,0),true,true,1/120,true);g.weaponsTick(v,1/120,true,actor.pos.clone(),0);}
   yes(v.pos.distanceTo(at)<.001&&v.slots.main.ammo===ammo&&!g.shortDash(v,new T.Vector3(1,0,0)),name+'の被弾中は移動・射撃・ダッシュ・ジャンプ不可');
   tick(v,a.staggerTime-.25);yes(v.stun==='stagger',name+'は終了直前までよろけを維持');
   tick(v,.06,new T.Vector3(1,0,0));yes(!v.stun&&v.pos.x>at.x,name+'の時間満了後は操作へ戻る');
  }
  for(const id of ['tackle','kick']){
   let v=setup(id);v.armorAvg=.3;hit(p,v);yes(v.hp>9700&&v.stun==='stagger',id+'は重装甲で被害が小さくてもよろける');
   for(const [label,state,expectDamage] of [['無敵',{invulT:2},false],['ポッド',{repairing:true},true],['射出保護',{catLaunch:{staggerT:1}},true]]){
    v=setup(id);Object.assign(v,state);const hp=v.hp;g.actionMoveStart(p);tick(p,1);
    yes((expectDamage?v.hp<hp:v.hp===hp)&&!v.stun,id+'は'+label+'のよろけ無効を維持');
   }
   v=setup(id);Object.assign(v,{repairing:true,stun:'stagger',stunT:.2});g.actionMoveStart(p);tick(p,1);
   yes(v.stunT===.2,id+'は保護中の既存よろけまで延長しない');
   v=setup(id);v.stun='down';v.stunT=.8;hit(p,v);yes(v.stun==='down'&&v.stunT===.8,id+'は既存ダウンを短いよろけへ上書きしない');
   v=setup(id);v.stun='stagger';v.stunT=.1;hit(p,v);yes(v.stunT>=g.ACTIONS[id].staggerTime,id+'は別の命中からの連続よろけを禁止しない');
   // 壁際で押し出し先が無い場合も、同じ技の最速再使用だけで拘束が続きっぱなしにならない。
   v=setup(id);g.obstacles.push({minX:-10,maxX:10,minZ:16.4,maxZ:16.5,top:220});
   let hits=0,was=false,freeWindows=0,run=0,maxRun=0;
   for(let i=0;i<120*8;i++){
    if(!p.actionMove&&p.actionRecoverT<=0&&p.actionCd<=1e-6)g.actionMoveStart(p);
    const hp=v.hp;tick(p,1/120);tick(v,1/120);if(v.hp<hp)hits++;
    const stunned=!!v.stun;if(was&&!stunned)freeWindows++;run=stunned?run+1/120:0;maxRun=Math.max(maxRun,run);was=stunned;
   }
   yes(hits>=3&&freeWindows>=3&&maxRun<1.6,id+'の壁際連打にも操作が戻る間がある');
   g.obstacles.pop();timings.push({name:id+'連打',hits,freeWindows,maxContinuousStagger:maxRun});
  }
  let v=setup('tackle');g.jolt(v,p.pos,g.STAGGER_MELEE,true);yes(v.stunT===g.STAGGER_TIME,'通常武器のよろけ時間0.65秒は変更しない');
  v=setup('tackle');p.stats.weight=6250;hit(p,v);yes(v.stun==='down','重量比1.25以上のタックルは従来どおりダウン');
  v=setup('tackle');hit(p,v);window.__actionStaggerVictim=v;
  v.controller='remoteHuman';v.controlInput={keys:{},pressed:{},yaw:0,pitch:0};g.timeLeft=10000;
  for(let i=0;i<5;i++)g.loop(window.__t=(window.__t||0)+50);
  yes(v.stun==='stagger'&&v.tilt>.3,'実ゲームの更新でもよろけ中ののけぞりが見える');
  return {checks,timings};
 });
 console.log(JSON.stringify(result.timings));for(const name of result.checks)ok(true,name);
});
