// 追加品目だけの簡易テスト（v0.20。オーナー 2026-10-20「追加品目用の簡易テストを考えておかないとだね」）
// 武器・パーツが多くなり、全武器・全組み合わせの試験は時間がかかりすぎるので、比べる版から増えた・変わった物だけを試す。
// 使い方: node tools/test/quick_check.js [比べる版=origin/main] [Bot戦の秒=60]
//   1. 比べる版と今の prototype/index.html・maps.js から、武器（WEAPONS）・機体パーツ（PARTS）・マップの増減と変更を挙げる
//   2. 増えた・変わった武器だけ weapons_check.js で撃つ（ONLY=）
//   3. 増えた・変わったパーツは1つずつ、ほかの部位は初期のまま付けて、4部位のメッシュ・頭の高さ・重さと装甲・部位ごとの被弾、
//      立ち・歩き・屈みの姿勢（頂点が有限、脚が地面に埋まらない）を確かめる
//   4. Bot戦を短く回す（city と、増えた・変わったマップ。マップの変更が無ければ city と dock）
// 作業フォルダは dbg/quick-new と dbg/quick-base。Playwright と Chromium が要る。
const path = require('path'), fs = require('fs'), vm = require('vm'), { spawnSync, execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const ROOT = path.resolve(__dirname, '../..'), ref = process.argv[2] || 'origin/main', secs = +(process.argv[3] || 60);
const NEW = path.join(ROOT, 'dbg/quick-new'), BASE = path.join(ROOT, 'dbg/quick-base');
const env = { ...process.env, NODE_PATH: process.env.NODE_PATH || '/opt/node22/lib/node_modules' };
const run = (cmd, args, extra = {}) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...env, ...extra } }).status;
// 比べる版は git から読むので、リポジトリの中で動かす（共有フォルダでは動かない）
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const failures = [];

function mapData(text) { const ctx = { window: {} }; vm.runInNewContext(text, ctx); return ctx.window.MAP_DATA || {}; }
function diff(base, now) {
  const added = Object.keys(now).filter(k => !(k in base));
  const changed = Object.keys(now).filter(k => k in base && JSON.stringify(now[k]) !== JSON.stringify(base[k]));
  const removed = Object.keys(base).filter(k => !(k in now));
  return { added, changed, removed };
}
async function catalog(browser, dir) {
  const p = await browser.newPage();
  await p.route('**fonts.g*/**', r => r.abort());
  await p.goto('file://' + path.join(dir, 'dbg.html'));
  const c = await p.evaluate(() => ({ weapons: JSON.parse(JSON.stringify(__g.WEAPONS)), parts: JSON.parse(JSON.stringify(__g.PARTS)) }));
  await p.close();
  return c;
}

(async () => {
  // 1. 比べる
  fs.mkdirSync(BASE, { recursive: true });
  const baseHtml = path.join(BASE, 'index.src.html');
  fs.writeFileSync(baseHtml, git(['show', ref + ':prototype/index.html']));
  if (run('python3', ['tools/test/make_dbg.py', NEW]) || run('python3', ['tools/test/make_dbg.py', BASE, '--src', baseHtml])) throw new Error('dbg.html を作れない');
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  let weapons, parts, maps;
  try {
    const [b, n] = [await catalog(browser, BASE), await catalog(browser, NEW)];
    weapons = diff(b.weapons, n.weapons);
    parts = {};
    for (const slot of Object.keys(n.parts)) parts[slot] = diff(b.parts[slot] || {}, n.parts[slot]);
    maps = diff(mapData(git(['show', ref + ':prototype/maps.js'])), mapData(fs.readFileSync(path.join(ROOT, 'prototype/maps.js'), 'utf8')));
    console.log(`比べる版 ${ref}`);
    console.log(`武器 ${Object.keys(n.weapons).length}種：増えた${weapons.added.length}・変わった${weapons.changed.length}・消えた${weapons.removed.length}`);
    for (const [slot, d] of Object.entries(parts)) console.log(`パーツ ${slot}：増えた${d.added.length}・変わった${d.changed.length}・消えた${d.removed.length}`);
    console.log(`マップ：増えた ${maps.added.join(',') || 'なし'}・変わった ${maps.changed.join(',') || 'なし'}・消えた ${maps.removed.join(',') || 'なし'}`);
    if (weapons.removed.length) failures.push('消えた武器（保存した構成が読めなくなる）: ' + weapons.removed.join(','));
    for (const [slot, d] of Object.entries(parts)) if (d.removed.length) failures.push(`消えたパーツ ${slot}: ` + d.removed.join(','));

    // 3. パーツ（先にやる。ブラウザを開いたままで済む）
    const list = Object.entries(parts).flatMap(([slot, d]) => [...d.added, ...d.changed].map(key => [slot, key]));
    if (list.length) {
      const p = await browser.newPage(), errors = [];
      p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
      await p.route('**fonts.g*/**', r => r.abort());
      await p.goto('file://' + path.join(NEW, 'dbg.html'));
      await p.evaluate(() => { __g.renderer.render = () => {}; __g.selectMap('dock'); document.getElementById('start').click(); __g.running = false; });
      const r = await p.evaluate(list => {
        const g = __g, T = g.T, out = [], bad = [], v = a => new T.Vector3(...a);
        for (const q of g.units) { q.frozen = true; q.isPlayer = false; }
        const shooter = g.units.find(q => q.team === 'B'), target = g.units.find(q => q.team === 'R'), hits = g.hittables.slice();
        const keep = { hp: target.hp, maxHp: target.maxHp, invulT: target.invulT, partArmor: target.partArmor, armorAvg: target.armorAvg };
        const legFloor = (u, mesh) => { const pa = mesh.geometry.attributes.position, w = new T.Vector3(); let min = Infinity; for (let i = 0; i < pa.count; i++) min = Math.min(min, w.fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld).y - u.pos.y); return min; };
        for (const [slot, key] of list) {
          const cfg = { ...g.MECH_DEFAULT, [slot]: key, color: 'ash' }, label = slot + '/' + key, m = g.buildMech(g.TEAM.R.color, cfg);
          const u = { ...m, group: m.g, pos: v([0, 20, 0]), vel: v([0, 0, 0]), alive: true, onGround: true, yaw: 0, pitch: 0, isPlayer: true, recoil: 0, cannonDeploy: 0, weapon: 'main', swing: null };
          u.slots = Object.fromEntries(g.SLOTS.map(k => [k, g.slotOf(g.loadout.assault[k])]));
          try {
            const check = (ok, text) => { if (!ok) throw new Error(label + ': ' + text); };
            const armor = m.g.children.filter(o => o.userData.own && o.userData.armorSlot);
            check(armor.length === 4, '装甲は4部位のメッシュ');
            const helmet = armor.find(o => o.userData.armorSlot === 'head'); helmet.geometry.computeBoundingBox();
            check(helmet.geometry.boundingBox.min.y >= 3.2 - 1e-6 && helmet.geometry.boundingBox.max.y <= 3.95 + 1e-6, '頭部の高さ（3.2〜3.95m）');
            const st = g.mechStats(cfg, g.loadout.assault);
            check([st.weight, st.cap, st.walk, st.dash, st.cruise, st.avg].every(Number.isFinite) && st.weight > 0, '重さ・速さ・装甲が数になっていない');
            // 姿勢：立ち・歩き・屈み（重砲などの構え）・ポッド
            for (const [name, set] of [['立ち', () => {}], ['歩き', () => u.vel.set(0, 0, -6)], ['屈み', () => { u.planted = true; }], ['ポッド', () => { u.planted = false; u.repairing = true; }]]) {
              set(); g.resetMechPose(u);
              for (let i = 0; i < 30; i++) { u.pos.z += u.vel.z / 60; u.group.position.copy(u.pos); u.group.rotation.set(0, u.yaw, 0); g.weaponLook(u, 1 / 60); u.group.updateMatrixWorld(true); }
              check(u.rig.meshes.every(({ mesh }) => mesh.geometry.attributes.position.array.every(Number.isFinite)), name + 'で頂点が有限でない');
              const low = legFloor(u, armor.find(o => o.userData.armorSlot === 'legs'));
              check(low >= -0.05, name + 'で脚が地面に埋まる ' + low.toFixed(3));
            }
            u.repairing = false; u.vel.set(0, 0, 0); g.resetMechPose(u);
            u.pos.set(0, 20, 0); u.group.position.copy(u.pos); u.group.rotation.set(0, 0, 0); g.weaponLook(u, 0); u.group.updateMatrixWorld(true);
            // 被弾：前から各部位を撃ち、その部位の装甲でダメージが変わる
            g.hittables.length = 0; for (const o of armor) { o.userData.ref = target; g.hittables.push(o); }
            Object.assign(target, { hp: 1e6, maxHp: 1e6, invulT: 0, weakT: 0, partArmor: st.armor, armorAvg: st.avg }); target.pos.set(0, 20, 0);
            for (const [part, x, y] of [['head', 0, 3.7], ['body', 0, 2.65], ['arms', 1.48, 2.24], ['legs', 0.62, 0.67]]) {
              const from = v([x, 20 + y, -10]), aim = v([x, 20 + y, 0]), hit = g.castFrom(from, aim.clone().sub(from).normalize(), shooter, 20);
              check(hit && hit.ref === target && hit.slot === part, '前から撃って ' + part + ' に当たらない（' + (hit && hit.slot) + '）');
              const before = target.hp; g.fire(shooter, aim, 0, { dmg: 100, range: 20, head: 1.3 }, from);
              check(Math.abs(before - target.hp - 100 * st.armor[part] * (part === 'head' ? 1.3 : 1)) < 1e-5, part + ' の装甲・頭部倍率');
            }
            out.push(`${label} 重さ${Math.round(st.frame)}kg 装甲${st.avg.toFixed(2)}：形・姿勢・被弾 成功`);
          } catch (e) { bad.push(e.message); }
          finally { g.hittables.splice(0, g.hittables.length, ...hits); g.disposeMech(m.g); for (const f of g.fx) f.obj.parent && f.obj.parent.remove(f.obj); g.fx.length = 0; }
        }
        Object.assign(target, keep);
        return { out, bad };
      }, list);
      r.out.forEach(l => console.log('  ' + l));
      failures.push(...r.bad, ...errors.map(e => 'ブラウザ: ' + e));
      await p.close();
    } else console.log('パーツ：試す物なし');
  } finally { await browser.close(); }

  // 2. 武器
  const wl = [...weapons.added, ...weapons.changed];
  if (wl.length) {
    console.log(`武器 ${wl.length}種を撃つ: ${wl.join(',')}`);
    if (run('node', ['tools/test/weapons_check.js', NEW], { ONLY: wl.join(',') })) failures.push('weapons_check が失敗');
  } else console.log('武器：試す物なし');

  // 4. Bot戦
  const fresh = [...maps.added, ...maps.changed].filter(id => !mapData(fs.readFileSync(path.join(ROOT, 'prototype/maps.js'), 'utf8'))[id].testOnly);
  const battle = ['city', ...fresh.filter(id => id !== 'city')];
  if (battle.length < 2) battle.push('dock');
  console.log(`Bot戦 ${battle.join(',')} 各${secs}秒`);
  if (run('node', ['tools/test/bot_battle.js', NEW, battle.join(','), String(secs)])) failures.push('bot_battle が失敗');

  console.log(failures.length ? '簡易テスト：失敗\n' + failures.map(f => '  ' + f).join('\n') : '簡易テスト：成功');
  process.exitCode = failures.length ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
