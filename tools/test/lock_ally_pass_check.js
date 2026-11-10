// 味方の機体が自分と敵の間を横切っても、ロックが切れないこと（2026-11-10 オーナー「味方が敵との間をすれ違うとロック切れるんはゲーム的にちがう」）。
// 敵の機体が間に入ったときは今までどおり切れ、新しく捕捉するときの見通しも今までどおり（味方の陰の敵は捕捉できない）。
// python3 tools/test/make_dbg.py dbg && node tools/test/lock_ally_pass_check.js dbg
const {check}=require('./lib');
check('味方が横切ってもロックは切れない',async({ev,ok})=>{
  const r=await ev(()=>{
    const g=__g,dt=1/60;g.selectMap('dock');g.setup();g.running=true;document.getElementById('overlay').hidden=true;
    const u=g.player,foes=g.units.filter(q=>q.team!==u.team),e=foes[0],e2=foes[1],ally=g.units.find(q=>q.team===u.team&&q!==u);
    for(const q of g.units){q.alive=q===u;q.frozen=true;}
    for(const q of g.turrets)q.alive=false;
    g.equip(u,'assault');Object.assign(u,{alive:true,weapon:'main',switchT:0,repairing:false,transfer:null,stun:'',yaw:0,pitch:0});
    const FAR=[500,300,500];
    // 高い所に並べる（地形や建物が間に入らないように）。自機 → 30m先に敵。間に入れる機体は15m先。
    const place=(mid)=>{u.pos.set(0,300,0);u.vel.set(0,0,0);u.onGround=false;
      Object.assign(e,{alive:true,cloak:false,downT:0});e.pos.set(0,300,-30);
      for(const q of [ally,e2]){q.alive=q===mid;q.cloak=false;q.downT=0;if(q===mid)q.pos.set(0,300,-15);else q.pos.set(...FAR);}
      for(const q of g.units){q.group.position.copy(q.pos);q.group.visible=q.alive;}
      g.scene.updateMatrixWorld(true);g.updateCamera(u,0);g.camera.updateMatrixWorld(true);};
    const run=sec=>{for(let t=0;t<sec;t+=dt){u.pos.set(0,300,0);u.vel.set(0,0,0);g.lockUpdate(u,dt);}};
    const out={};
    place(null);out.plainSee=g.canSee(u,e,g.targetPoint(e));
    place(ally);out.allyBlocksSight=!g.canSee(u,e,g.targetPoint(e));out.allyPassSight=g.canSee(u,e,g.targetPoint(e),true);
    place(e2);out.foeBlocksEvenPass=!g.canSee(u,e,g.targetPoint(e),true);
    // ロック中に味方が間へ入る
    place(null);g.releaseLock();g.setLock(u,e);run(.3);out.lockedFirst=g.lock.target===e&&g.lock.visible;
    place(ally);run(1.5);out.keptBehindAlly=g.lock.target===e&&g.lock.visible;
    // ロック中に敵の機体が間へ入る（今までどおり、見えなくなって0.6秒で外れる）
    place(null);g.releaseLock();g.setLock(u,e);run(.3);
    place(e2);run(1.5);out.lostBehindFoe=g.lock.target!==e;
    // 新しく捕捉するときは今までどおり（味方の陰の敵は捕捉できない）
    place(ally);g.releaseLock();const c=g.lockCandidates(u).find(c=>c.e===e);out.acquireBlocked=!!c&&!g.lockAcquirable(u,c);
    place(null);const c2=g.lockCandidates(u).find(c=>c.e===e);out.acquireOpen=!!c2&&g.lockAcquirable(u,c2);
    return out;
  });
  console.log(JSON.stringify(r));
  ok(r.plainSee,'何も無ければ敵が見える');
  ok(r.allyBlocksSight&&r.allyPassSight,'ふつうの見通しは味方の機体で遮られ、ロックの見通しは遮られない');
  ok(r.foeBlocksEvenPass,'敵の機体は、ロックの見通しでも遮る');
  ok(r.lockedFirst&&r.keptBehindAlly,'ロック中に味方が間へ入っても、1.5秒たってもロックが続く');
  ok(r.lostBehindFoe,'ロック中に別の敵が間へ入ると、今までどおりロックが外れる');
  ok(r.acquireBlocked&&r.acquireOpen,'新しく捕捉するときは今までどおり（味方の陰の敵は捕捉できない）');
});
