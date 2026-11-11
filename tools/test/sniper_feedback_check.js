// スコープ復旧後の実DOM・表示・描画の回帰試験。算術の網羅試験は sniper_feedback_math.test.js。
const { check } = require('./lib');
const path = require('node:path');
check('狙撃スコープ表示', async ({ page, ev, step, sortie, ok, out }) => {
  await sortie('wide', { render: true });
  await ev(() => { const g=__g; window.scopeRender=g.renderer.render.bind(g.renderer); g.renderer.render=()=>g.scene.updateMatrixWorld(); for(const u of g.units) if(u!==g.player){u.alive=false;u.pos.set(9999,0,9999);} });
  const put = async key => { await ev(key=>{const g=__g,p=g.player;p.slots.sub=g.slotOf(key);g.selectWeapon(p,'sub');p.switchT=0;p.scoped=true;p.scopeStep=1;p.onGround=true;p.vel.set(0,0,0);p.dashState=null;p.downT=0;p.invulT=0;p.alive=true;g.releaseLock();},key); };
  const snapshot = conv => ev(conv=>{const g=__g,p=g.player;p.slots.sub.conv=conv;g.hud(100,0);const s=document.getElementById('scope');return {optic:s.dataset.optic,path:document.getElementById('scopeSpread').getAttribute('d'),percent:document.getElementById('scopePercent').textContent,hidden:s.hidden,settled:s.dataset.settled,ammo:document.getElementById('scopeAmmo').textContent};},conv);
  const keys=await ev(()=>Object.entries(__g.WEAPONS).filter(([,w])=>w.scope).map(([key,w])=>({key,laser:w.laserFade>0})));
  for(const {key,laser} of keys){await put(key);let last=Infinity;for(const conv of [0,.25,.5,.75,1]){const s=await snapshot(conv);ok(!s.hidden&&s.optic===(laser?'laser':'ballistic')&&s.percent===`${conv*100}%`,`${key} 収束${conv*100}%と種別`);const r=Math.abs(Number(s.path.match(/^M[\d.]+ (-?[\d.]+)/)[1]));ok(r<=last+.001,`${key} 菱形が縮む`);last=r;}}
  await put('sniper');await snapshot(1);
  ok(await ev(()=>{const p=__g.player;p.onGround=false;__g.scopeHud(p);return document.getElementById('scope').dataset.settled==='false'&&document.getElementById('scopeState').textContent==='空中で拡散';}),'空中の散りを完了扱いしない');
  ok(await ev(()=>{const g=__g,p=g.player;p.onGround=true;p.slots.sub.conv=1;g.shot(p,p.slots.sub,g.aimPoint(p),g.movementSpread(p));g.scopeHud(p);return p.slots.sub.conv<=.15;}),'実射後に収束が低下');
  for(const state of ['dead','down','off'])ok(await ev(state=>{const g=__g,p=g.player;p.alive=state!=='dead';p.downT=state==='down'?1:0;p.scoped=state!=='off';g.scopeHud(p);return document.getElementById('scope').hidden;},state),`${state}で非表示`);
  for(const [width,height] of [[1280,720],[844,390],[1920,1080],[390,844]]){
    await page.setViewportSize({width,height});
    for(const key of ['sniper','optSniper']){await put(key);await ev(()=>{const g=__g;g.camera.fov=70/g.scopePower(g.player);g.camera.updateProjectionMatrix();g.camera.updateMatrixWorld(true);});await snapshot(.2);
      ok(await ev(()=>{const s=document.getElementById('scope'),r=s.getBoundingClientRect(),b=getComputedStyle(document.getElementById('game'),'::after');return r.width===innerWidth&&r.height===innerHeight&&b.display==='block'&&b.backdropFilter==='blur(8px)'&&getComputedStyle(s).backgroundColor==='rgba(0, 0, 0, 0)';}),`${key} ${width}×${height} 全画面・透明外周・ぼかし`);
      if(width===1280||width===844){await ev(()=>scopeRender(__g.scene,__g.camera));await page.screenshot({path:path.join(out,`${key}-${width}-unsettled.png`)});await snapshot(1);await page.screenshot({path:path.join(out,`${key}-${width}-settled.png`)});}
    }
  }
  await page.setViewportSize({width:1280,height:720});await put('sniper');await snapshot(1);
  await ev(()=>{document.getElementById('scope').style.visibility='hidden';const game=document.getElementById('game');game.querySelector('canvas').style.visibility='hidden';game.style.background='repeating-linear-gradient(90deg, #fff 0 4px, #444 4px 8px)';document.querySelectorAll('.hud').forEach(e=>e.style.visibility='hidden');});
  await page.screenshot({path:path.join(out,'blur-on.png')});
  await ev(()=>document.getElementById('scope').hidden=true);await page.screenshot({path:path.join(out,'blur-off.png')});
  ok(await ev(()=>getComputedStyle(document.getElementById('game'),'::after').display==='none'),'解除するとぼかし解除');
  await ev(()=>{document.getElementById('scope').hidden=false;document.getElementById('overlay').hidden=false;});
  ok(await ev(()=>getComputedStyle(document.getElementById('game'),'::after').display==='none'),'メニュー表示でぼかし解除');
});
