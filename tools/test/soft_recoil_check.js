// 連射中の反動が釣り合うこと、実射数・入力・時間刻み・単発銃の互換性をブラウザで確認する。
// node tools/test/soft_recoil_check.js dbg/soft-recoil dbg/soft-recoil-before [結果フォルダ]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const out = path.resolve(process.argv[4] || 'dbg/soft-recoil/results'), errors = [], checks = [];
const yes = (ok, label) => { assert.ok(ok, label); checks.push(label); };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    async function sample(dir) {
      const p = await browser.newPage();
      p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
      await p.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
      await p.goto('file://' + path.resolve(dir, 'dbg.html'));
      const data = await p.evaluate(() => {
        const g = __g;
        g.selectMap('dock'); document.getElementById('start').click(); g.running = false;
        g.renderer.render = () => g.scene.updateMatrixWorld(true);
        for (const v of g.units) { v.frozen = true; v.alive = false; v.group.visible = false; }
        const player = g.player, aim = new g.T.Vector3(0, 202.6, -100), rows = [];
        function reset(key) {
          const cls = Object.keys(g.ARMORY).find(c => g.ARMORY[c].main.includes(key));
          player.isPlayer = true; Object.assign(player.mech, g.MECH_DEFAULT); g.equip(player, cls);
          player.slots.main = g.slotOf(key); player.slots.main.w = { ...player.slots.main.w, spread: 0 };
          Object.assign(player, { isPlayer: false, alive: true, weapon: 'main', switchT: 0, stun: '', repairing: false, transfer: null, onGround: true, yaw: 0, pitch: 0 });
          player.pos.set(0, 200, 0); player.vel.set(0, 0, 0); player.group.position.copy(player.pos); player.group.visible = true;
          g.weaponLook(player, 0); g.scene.updateMatrixWorld(true); player.slots.main.spin = 1;
        }
        const random = Math.random;
        for (const key of ['gatling', 'ar', 'haggard']) for (const fps of [30, 60, 144]) {
          reset(key); let seed = 7169, shots = 0;
          Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
          const timeline = [];
          for (let n = 0; n < fps * 4.5; n++) {
            g.weaponLook(player, 1 / fps); g.scene.updateMatrixWorld(true);
            const begin = g.fx.length;
            g.weaponsTick(player, 1 / fps, true, aim, 0);
            shots += g.fx.slice(begin).filter(f => f.kind === 'tracer').length;
            timeline.push({ t: (n + 1) / fps, v: player.recoil, h: player.recoilYaw || 0 });
            g.fxUpdate(1 / fps);
          }
          rows.push({ key, fps, shots, peak: Math.max(...timeline.map(v => v.v)), timeline });
        }
        Math.random = random;
        const recovery = [];
        for (const fps of [30, 60, 144]) {
          reset('gatling'); g.recoilKick(player, g.WEAPONS.gatling);
          player.recoil = .1; player.recoilYaw = -.08; player.pitch = -.2; player.yaw = .3;
          for (let n = 0; n < fps / 2; n++) g.recoilRecover(player, 1 / fps);
          const state = { fps, v: player.recoil, h: player.recoilYaw, pitch: player.pitch, yaw: player.yaw };
          g.updateCamera(player, 1);
          const d = g.camera.getWorldDirection(new g.T.Vector3());
          state.cameraPitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); state.cameraYaw = Math.atan2(-d.x, -d.z);
          g.recoilRecover(player, 2);
          state.rest = [player.recoil, player.recoilYaw]; recovery.push(state);
        }
        reset('gatling'); g.recoilKick(player, g.WEAPONS.gatling);
        player.recoil = .1; player.recoilYaw = -.08;
        g.recoilRecover(player, .05);
        const duringWait = { v: player.recoil, h: player.recoilYaw, wait: player.recoilWait };
        const damping = player.recoilDamping;
        const botDamping = damping; reset('gatling'); player.isPlayer = true; g.recoilKick(player, g.WEAPONS.gatling);
        const playerDamping = player.recoilDamping;
        g.recoilKick(player, g.WEAPONS.haggard); const semiDamping = player.recoilDamping;
        g.recoilKick(player, g.WEAPONS.gatling); g.recoilKick(player, g.WEAPONS.rocket); const subDamping = player.recoilDamping;
        const exceptions = [{ rpm: 600 }, { semi: true }, { chargeTime: 1 }, { recoilH: undefined }].map(variant => {
          g.recoilKick(player, { ...g.WEAPONS.gatling, ...variant }); return player.recoilDamping;
        });
        g.recoilKick(player, g.WEAPONS.gatling); g.spawn(player);
        return { rows, recovery, duringWait, damping, botDamping, playerDamping, semiDamping, subDamping, exceptions, spawn: [player.recoil, player.recoilYaw, player.recoilDamping] };
      });
      await p.close(); return data;
    }
    const before = await sample(process.argv[3] || 'dbg/soft-recoil-before'), after = await sample(process.argv[2] || 'dbg/soft-recoil');
    for (const now of after.rows) {
      const prior = before.rows.find(v => v.key === now.key && v.fps === now.fps);
      yes(now.shots === prior.shots, `${now.key}/${now.fps}fps：4.5秒の実射数を維持（${now.shots}発）`);
      if (now.key === 'haggard') { assert.deepEqual(now.timeline, prior.timeline); checks.push(`マグナム/${now.fps}fps：連射と回復を完全に維持`); continue; }
      yes(now.peak < prior.peak * .3, `${now.key}/${now.fps}fps：長い連射の押し上げが従来の30%未満`);
      const mean = (start, end) => { const a = now.timeline.filter(v => v.t > start && v.t <= end); return a.reduce((s, v) => s + v.v, 0) / a.length; };
      const early = mean(3, 3.5), late = mean(4, 4.5);
      yes(Math.abs(late - early) < early * .05, `${now.key}/${now.fps}fps：3秒後から4.5秒後まで蓄積量がほぼ一定`);
      yes(now.timeline.every(v => Number.isFinite(v.v) && Number.isFinite(v.h) && v.v >= 0), '連射中の縦横反動が有効');
    }
    for (const key of ['gatling', 'ar']) {
      const peaks = after.rows.filter(v => v.key === key).map(v => v.peak);
      yes(Math.max(...peaks) < Math.min(...peaks) * 1.15, key + '：30/60/144fpsの蓄積ピークの差が15%以内');
    }
    const close = (a, b) => Math.abs(a - b) < 1e-8;
    yes(after.duringWait.v < .1 && after.duringWait.h > -.08 && after.duringWait.wait > 0, '定速回復の待機中も縦横の比例回復が動く');
    for (const state of after.recovery) {
      yes(close(state.v, after.recovery[0].v) && close(state.h, after.recovery[0].h), state.fps + 'fps：0.5秒の回復量が一致');
      yes(state.pitch === -.2 && state.yaw === .3 && close(state.cameraPitch, state.pitch + state.v) && close(state.cameraYaw, state.yaw + state.h), '回復中も手動の縦横入力を保ち、視点は共通の反動角を反映');
      yes(state.rest.every(v => v === 0), '縦横とも0を越えずに回復を終える');
    }
    yes(after.botDamping > 0 && after.botDamping === after.playerDamping, 'プレイヤーとBotで同じ比例回復');
    yes(after.semiDamping === 0 && after.subDamping === 0, '単発・副武器の発射後は従来の定速回復');
    yes(after.exceptions.every(v => v === 0), '600発/分以下・単発・充填・主武器反動の未設定は比例回復を適用しない');
    assert.deepEqual(after.spawn, [0, 0, 0]); checks.push('再出撃で蓄積量と比例回復を初期化');
    assert.deepEqual(errors, []); checks.push('ブラウザエラー0');
    fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ passed: checks.length, checks, before, after, errors }, null, 2) + '\n');
    console.log(`蓄積量に応じた反動回復：${checks.length}項目、実射18ケース、成功。ブラウザエラー0`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
