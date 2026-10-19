// 関節、足裏、近接の各段、部位への実射、全武器の銃口、プレビューと後片付けを確認。
// node tools/test/mech_animation_check.js dbg/mech-animation [画像出力先] [変更前stats.json]
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const dir = path.resolve(process.argv[2] || 'dbg/mech-animation'), out = path.resolve(process.argv[3] || path.join(dir, 'animation'));
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    await page.evaluate(() => { __g.running = false; __g.renderer.render = () => { const u = __g.units[0]; if (u) u.group.parent.updateMatrixWorld(); }; document.getElementById('start').click(); __g.running = false; for (const u of __g.units) { u.frozen = true; u.alive = false; u.downT = 0; } });
    const stats = await page.evaluate(() => ({ weapons: __g.WEAPONS, parts: __g.PARTS, armory: __g.ARMORY }));
    if (process.argv[4]) { const before = JSON.parse(fs.readFileSync(process.argv[4])); assert.deepEqual(stats, before.stats || before, '武器・パーツ・選択肢の性能とキーを維持'); }
    const result = await page.evaluate(() => {
      const g = __g, T = g.T, log = [], yes = (v, text) => { if (!v) throw new Error(text); }, vector = a => new T.Vector3(...a);
      const configs = ['light', 'standard', 'heavy', 'harrier', 'prism', 'bastion'].map(k => Object.fromEntries(['head', 'body', 'arms', 'legs'].map(s => [s, k])));
      configs.push({ head: 'prism3', body: 'bastion2', arms: 'harrier3', legs: 'light2' });
      const fixture = cfg => { const m = g.buildMech(g.TEAM.B.color, { ...cfg, color: 'ash' }); return { ...m, group: m.g, pos: vector([0, 20, 0]), vel: vector([0, 0, 0]), alive: true, onGround: true, yaw: .6, pitch: .2, isPlayer: true, recoil: 0, cannonDeploy: 0, slots: null, weapon: 'main', swing: null }; };
      const equip = (u, cls = 'assault', slot = 'main', key = 'ar') => { u.slots = Object.fromEntries(g.SLOTS.map(k => [k, g.slotOf(k === slot ? key : g.loadout[cls][k])])); u.weapon = slot; u.swing = null; u.cannonDeploy = 1; u.planted = false; u.stun = ''; u.vel.set(0, 0, 0); g.resetMechPose(u); };
      const pose = (u, dt = 1/60) => { u.group.position.copy(u.pos); u.group.rotation.set(0, u.yaw, 0); g.weaponLook(u, dt); u.group.updateMatrixWorld(true); };
      const handError = (u, s, target) => u.rig.bones['hand' + s].node.getWorldPosition(new T.Vector3()).distanceTo(target);
      const finite = u => u.rig.meshes.every(({ mesh }) => mesh.geometry.attributes.position.array.every(Number.isFinite) && mesh.geometry.attributes.normal.array.every(Number.isFinite));
      let weaponPoses = 0, meleeFrames = 0, rayHits = 0, maxVertices = 0, maxGripError = 0;
      const originalHits = g.hittables.slice();
      for (const cfg of configs) {
        const u = fixture(cfg), label = JSON.stringify(cfg);
        try {
          yes(u.rig.meshes.length === 4, label + ' 装甲の描画は4メッシュ');
          maxVertices = Math.max(maxVertices, u.rig.meshes.reduce((n, p) => n + p.pos.length/3, 0));
          for (const [cls, slots] of Object.entries(g.ARMORY)) for (const [slot, keys] of Object.entries(slots)) for (const key of keys) {
            equip(u, cls, slot, key); pose(u);
            yes(finite(u), label + '/' + key + ' 頂点・法線が有限');
            const w = u.slots[slot].w;
            if (w.type !== 'sword') {
              for (const [s, mesh, local] of [['R', u.gun, u.gun.userData.rightGrip], ['L', u.gun2.visible ? u.gun2 : u.gun, u.gun2.visible ? u.gun.userData.rightGrip : u.gun.userData.leftGrip]]) {
                const expected = vector(local).applyEuler(mesh.rotation).add(mesh.position), error = handError(u, s, expected);
                yes(error < .025, key + ' 銃の握りと手が離れた ' + s + ': ' + error);
              }
              const mesh = w.type === 'cannon' || w.type === 'artillery' ? u.pack : u.gun;
              const local = w.type === 'artillery' ? [0, 1.08, 0] : w.type === 'cannon' ? ({ cannon: [-.325, .18, -1.7], cannonH: [-.31, 0, -1.7], cannonM: [0, .18, -1.7] }[key] || [-.325, .18, -1.7]) : [0, 0, mesh.geometry.boundingBox.min.z];
              yes(mesh.localToWorld(vector(local)).distanceTo(g.muzzle(u)) < 1e-5, key + ' 描画上の銃口から発射');
              if (w.dual) yes(u.gun2.localToWorld(vector([0, 0, u.gun2.geometry.boundingBox.min.z])).distanceTo(g.muzzle(u, true)) < 1e-5, key + ' 左の銃口');
            } else {
              yes(!u.gun.visible && !u.gun2.visible, key + ' 近接中は銃を格納');
              for (const strong of [false, true]) {
                const a = strong ? w.strong : w.normal;
                const times = new Set([0, a.windup*.5, a.windup, a.windup+a.sweep*.5, a.windup+a.sweep, a.time*.99]);
                for (const s of a.strikes || []) for (const f of [0, .5, 1]) times.add(a.windup+s.at+s.sweep*f);
                for (const t of times) {
                  u.swing = { a, t, yaw0: u.yaw, aimed: false, hit: new Set(), stopped: false };
                  pose(u); yes(finite(u), key + ' 攻撃中の頂点');
                  for (const [s, b] of [['R', u.blade], ['L', u.blade2]]) if (b?.visible) {
                    const error = handError(u, s, b.userData.grip); maxGripError = Math.max(maxGripError, error);
                    yes(error < .025, key + '/' + strong + '/' + t.toFixed(3) + ' 手と柄が離れた: ' + error);
                  }
                  meleeFrames++;
                }
              }
            }
            weaponPoses++;
          }
          // 足裏を地面に残したまま腰・膝を曲げる。旧版のroot全体を下げる方法では満たせない。
          equip(u); pose(u);
          const feet = ['L','R'].map(s => u.rig.bones['foot'+s].node.getWorldPosition(new T.Vector3()).y);
          const hip = u.rig.bones.hip.node.getWorldPosition(new T.Vector3()).y;
          g.land(u, 36); for (let i=0;i<6;i++) pose(u,.025);
          yes(u.rig.bones.hip.node.getWorldPosition(new T.Vector3()).y < hip-.35, label + ' 着地で腰を沈める');
          for (const [i,s] of ['L','R'].entries()) yes(Math.abs(u.rig.bones['foot'+s].node.getWorldPosition(new T.Vector3()).y-feet[i]) < .002, label + ' 着地で足裏が埋まらない');
          yes(u.stun === 'land' && u.stunT >= .5, '既存の着地硬直を維持');
          equip(u); pose(u); u.vel.set(0,0,-13);
          for (let i=0;i<12;i++) { u.pos.z-=.08; pose(u,1/60); }
          const phase = u.rig.phase;
          yes(phase > 0 && u.rig.bones.footL.node.getWorldPosition(new T.Vector3()).distanceTo(u.rig.bones.footR.node.getWorldPosition(new T.Vector3())) > 1.2, '歩行の左右差');
          for (let i=0;i<10;i++) pose(u,1/60);
          yes(u.rig.phase === phase, '進めない壁際で歩行周期を進めない');
          u.dashState='short'; u.pos.z-=.2; pose(u); yes(u.rig.phase === phase, 'ダッシュ中は走り足を回さない');
          u.dashState='';u.onGround=false;u.pos.z-=.2;pose(u);yes(u.rig.phase === phase, '空中で足踏みしない');
          u.onGround=true;u.alive=false;u.pos.z-=.2;pose(u);yes(u.rig.phase === phase, '撃破後は歩かない');
          g.resetMechPose(u);yes(u.rig.phase===0&&!u.rig.landT&&!u.rig.last,'再出撃で状態を初期化');u.alive=true;
          equip(u);pose(u);u.vel.set(6,0,-6);for(let i=0;i<8;i++){u.pos.x+=.06;u.pos.z-=.06;pose(u);}
          // 動いた各部位の表面へ実際にレイを飛ばす。旧位置を使う代理の判定を置かない。
          const target = g.units.find(q=>q.team==='R'), backup={alive:target.alive,hp:target.hp,maxHp:target.maxHp,invulT:target.invulT,partArmor:target.partArmor,weakT:target.weakT};
          Object.assign(target,{alive:true,hp:1e6,maxHp:1e6,invulT:0,partArmor:{head:1,body:1,arms:1,legs:1},weakT:0});
          const shooter=g.player;shooter.pos.copy(u.pos).add(vector([0,0,-10]));
          g.hittables.length=0;
          for(const {mesh}of u.rig.meshes){mesh.userData.ref=target;g.hittables.push(mesh);}
          for(const {mesh}of u.rig.meshes){
            const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
            let found=false;
            for(let i=0;i<p.count && !found;i+=3){
              const mid=new T.Vector3().fromBufferAttribute(p,i).add(new T.Vector3().fromBufferAttribute(p,i+1)).add(new T.Vector3().fromBufferAttribute(p,i+2)).multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld);
              const normal=new T.Vector3().fromBufferAttribute(n,i).transformDirection(mesh.matrixWorld),from=mid.clone().addScaledVector(normal,.03);
              const hit=g.castFrom(from,normal.clone().negate(),shooter,.06);
              if(!hit || hit.slot!==mesh.userData.armorSlot)continue;
              const before=target.hp;g.fire(shooter,mid,0,{dmg:10,range:.06,head:1.3},from);
              yes(Math.abs(before-target.hp-(hit.slot==='head'?13:10))<1e-5,'動いた部位の装甲と頭部倍率 '+hit.slot);found=true;rayHits++;
            }
            yes(found,label+' 動いた部位へ実射 '+mesh.userData.armorSlot);
          }
          Object.assign(target,backup);g.hittables.splice(0,g.hittables.length,...originalHits);
          log.push(label+' 全武器・着地・移動・被弾');
        } finally { g.disposeMech(u.group); }
      }
      // 20機の関節処理だけを測る。GPUの速度と混ぜずに記録する。
      const crowd=Array.from({length:20},(_,i)=>{const u=fixture(configs[i%configs.length]);equip(u);return u;});
      const start=performance.now();for(let f=0;f<30;f++)for(const u of crowd){u.vel.set(0,0,-13);u.pos.z-=.08;pose(u);}const ms=(performance.now()-start)/30;
      for(const u of crowd)g.disposeMech(u.group);
      return {weaponPoses,meleeFrames,rayHits,maxVertices,maxGripError,cpuMsFor20:ms,checks:log};
    });
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.weaponPoses, 7*285); assert.equal(result.rayHits, 7*4);
    await page.evaluate(async () => { await document.exitPointerLock?.(); __g.renderCustom(); __g.showPage('pgCustom'); document.getElementById('overlay').hidden=false; });
    for (const [cls,key] of [['assault','sword'],['assault','blade'],['assault','spear'],['assault','sabre'],['assault','rod'],['assault','clawB'],['heavy','pikeM']]) {
      await page.evaluate(([cls,key])=>{__g.loadout[cls].aux=key;document.querySelector(`#pgCustom [data-cu="${cls}"]`).click();document.querySelector('[data-cslot="aux"]').click();},[cls,key]);
      await page.waitForFunction(key=>__g.mechRig?.m?.blade.userData.weaponId===key,key);
      assert.ok(await page.evaluate(()=>{const r=__g.mechRig;if(r.m.g.parent!==r.sc)return false;let inside=true;r.m.g.traverse(m=>{if(!m.isMesh||!m.visible)return;const a=m.geometry.attributes.position;for(let i=0;i<a.count;i++){const p=new __g.T.Vector3().fromBufferAttribute(a,i).applyMatrix4(m.matrixWorld).project(r.cam);if(Math.abs(p.x)>1||Math.abs(p.y)>1)inside=false;}});return inside;}),key+' プレビューを枠内へ収める');
      await page.screenshot({path:path.join(out,'preview-'+key+'.png')});
    }
    result.previews=7;
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify(result, null, 2)+'\n');
    assert.deepEqual(errors, []); console.log('全武器の姿勢・近接の各段・足裏・被弾・銃口：成功。ブラウザエラーなし');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
