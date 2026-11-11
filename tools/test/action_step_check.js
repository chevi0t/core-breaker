// 最新指定：タックルは公開版の8m、蹴りは通常ダッシュの半分。
const { check } = require('./lib');
check('Cアクションの踏み込み', async ({ ev, ok, sortie }) => {
  await sortie('dock');
  const result = await ev(() => {
    const g=__g, T=g.T, p=g.player, stop=new T.Vector3(), checks=[], distances={};
    const enemies=g.units.filter(u=>u.team!==p.team), ally=g.units.find(u=>u!==p&&u.team===p.team);
    g.obstacles.length=0; g.waters.length=0;
    const floor={minX:-150,maxX:150,minZ:-150,maxZ:150,top:200}; g.obstacles.push(floor);
    const near=(a,b,eps=.025)=>Math.abs(a-b)<eps;
    const yes=(v,s)=>{if(!v)throw Error(s+': '+JSON.stringify({pos:p.pos.toArray(),move:p.actionMove}));checks.push(s);};
    function reset(id='tackle',legs='standard',yaw=0){
      for(const u of g.units){u.alive=false;u.pos.set(10000,0,10000);}
      p.mech={...g.MECH_DEFAULT,legs};g.equip(p,'assault');g.spawn(p);g.resetLifeState(p);
      Object.assign(p,{alive:true,actionId:id,onGround:true,yaw,pitch:0,invulT:0,boost:p.maxBoost,overheat:false});
      p.pos.set(0,200,20);p.vel.set(0,0,0);
    }
    function target(u,x,z){g.resetLifeState(u);Object.assign(u,{alive:true,hp:u.maxHp,invulT:0,onGround:true});u.pos.set(x,200,z);u.vel.set(0,0,0);return u;}
    function tick(t,hz=120){for(let elapsed=0;elapsed<t-1e-9;){const dt=Math.min(1/hz,t-elapsed);g.physics(p,stop,false,false,dt);elapsed+=dt;}}
    for(const hz of [30,60,120])for(const id of ['tackle','kick']){
      reset(id);g.actionMoveStart(p);tick(.9,hz);
      distances[id]=20-p.pos.z;
      yes(near(distances[id],id==='tackle'?8:p.dashV*g.SHORT_TIME*.5),hz+'Hz：'+id+'の空振りでも所定の距離へ踏み込む');
      yes(!p.actionMove&&p.actionRecoverT>0,id+'は踏み込み後に硬直する');
    }
    yes(near(distances.tackle,8)&&near(distances.kick,p.dashV*g.SHORT_TIME*.5),'タックルは公開版8mを維持し、蹴りはダッシュの半分');
    reset();const close=target(enemies[0],0,18),hp=close.hp;g.actionMoveStart(p);tick(.02);
    yes(p.pos.z<20&&p.actionMove,'至近距離のタックルは命中だけで即座に動作を消さない');
    tick(.15);yes(close.hp===hp,'タックルは肩を出す前の0.17秒では当てない');
    tick(.02);yes(close.hp<hp,'0.18秒で肩を出してからタックルが当たる');
    tick(.9);yes(close.hp<hp&&20-p.pos.z>.5&&p.pos.z>=close.pos.z+g.R-.025,'至近命中も前進し、相手の中心を通り抜けない');
    reset();target(enemies[0],0,19);g.actionMoveStart(p);tick(.9);
    yes(p.pos.z>=19,'既に密着した敵を追い越さない');
    for(const id of ['tackle','kick']){
      reset(id);target(ally,0,18.5);const aHp=ally.hp;
      const first=target(enemies[0],0,17.8),second=target(enemies[1],0,16.2),hps=[first.hp,second.hp];
      g.actionMoveStart(p);tick(.9);
      yes(first.hp<hps[0]&&ally.hp===aHp,id+'は進行中の敵に当たり、味方には当たらない');
      yes(id==='tackle'?second.hp===hps[1]:second.hp<hps[1],id+'の対象数（タックル1機・蹴り複数）を維持');
      const dealt=hps[0]-first.hp;tick(.3);yes(near(hps[0]-first.hp,dealt),id+'は同じ相手に重複加算しない');
      reset(id);const wall={minX:-5,maxX:5,minZ:17.9,maxZ:18,top:220};g.obstacles.push(wall);
      const behind=target(enemies[0],0,16.5),before=behind.hp;g.actionMoveStart(p);tick(.9);
      yes(p.pos.z>=18+g.R-.025&&behind.hp===before,id+'は薄い壁で止まり、壁越しに当てない');g.obstacles.pop();
      reset(id,'standard',Math.PI/2);g.actionMoveStart(p);tick(.9);
      yes(near(p.pos.x,-(id==='tackle'?8:p.dashV*g.SHORT_TIME*.5))&&near(p.pos.z,20),id+'は発動時の向きへ進む');
      reset(id);floor.minZ=20.4;g.actionMoveStart(p);tick(.9);
      yes(!p.actionMove&&p.pos.y<200,id+'は崖を歩いて浮かずに動作を終えて落ちる');floor.minZ=-150;
    }
    reset('kick');const swept=target(enemies[0],0,14.3),before=swept.hp;g.actionMoveStart(p);tick(.2);
    yes(swept.hp===before&&near(p.pos.z,20)&&p.actionMove?.phase==='move','蹴りは0.2秒の予備動作後に踏み込みを開始');
    tick(.05);yes(swept.hp===before&&p.pos.z<20,'蹴りの判定は開始地点から遠い敵へ先に飛ばない');
    tick(.31);yes(swept.hp<before&&near(20-p.pos.z,p.dashV*g.SHORT_TIME*.5),'蹴りは前進して射程に入った敵に当たる');
    reset('tackle','skimmer');g.actionMoveStart(p);tick(.9);yes(near(20-p.pos.z,10.4),'ホバーのタックル距離1.3倍を維持');
    for(const hz of [30,60,120]) {
      reset();target(enemies[0],0,18);g.actionMoveStart(p);tick(.79,hz);
      yes(!!p.actionMove&&p.actionMove.phase==='hold',hz+'Hz：至近命中で位置が止まっても突撃0.8秒を省略しない');
      tick(.01,hz);yes(!p.actionMove&&near(p.actionRecoverT,.3,.001),hz+'Hz：至近命中後も硬直0.3秒');
    }
    for(const id of ['tackle','kick']) {
      reset(id);floor.minZ=-g.MAP_Z;p.pos.z=-g.MAP_Z+g.R+.4;g.actionMoveStart(p);tick(.9);
      yes(p.pos.z>=-g.MAP_Z+g.R-.001,id+'は外周の内側で止まる');floor.minZ=-150;
    }
    yes(g.ACTIONS.kick.staggerTime>g.ACTIONS.tackle.staggerTime&&
      g.ACTIONS.kick.boost===15&&g.ACTIONS.kick.recovery>g.ACTIONS.tackle.hitRecovery&&
      g.ACTIONS.kick.cooldown>g.ACTIONS.tackle.cooldown,'蹴りは少量の追加ブースト消費と長いよろけ・硬直・再使用で調整');

    const dashMeasurements=[];
    for(const legs of ['standard','heavy','skimmer','light']) {
      reset('crouch',legs);const dashV=p.dashV;g.shortDash(p,new T.Vector3(0,0,-1));tick(g.SHORT_TIME);const dash=20-p.pos.z;
      reset('kick',legs);g.actionMoveStart(p);tick(.9);const kick=20-p.pos.z;
      yes(near(kick,dash*.5,.025),legs+'：実測した通常ダッシュ1回の半分を蹴りで進む');dashMeasurements.push({legs,dashV,dash,kick});
    }
    reset();const overlapping=target(enemies[0],0,19.9),hpNear=overlapping.hp;g.actionMoveStart(p);tick(.9);
    yes(overlapping.hp<hpNear&&p.pos.z>=overlapping.pos.z,'極端な密着でも肩当て前に敵を追い越さず命中する');
    yes(g.ACTIONS.tackle.cooldown===1.5&&g.ACTIONS.kick.cooldown===1.8,'再使用はタックル1.5秒、蹴り1.8秒');
    return {checks,distances,dashMeasurements};
  });
  console.log('移動距離',JSON.stringify(result.distances));console.log('ダッシュ実測',JSON.stringify(result.dashMeasurements));
  for(const name of result.checks)ok(true,name);
});
