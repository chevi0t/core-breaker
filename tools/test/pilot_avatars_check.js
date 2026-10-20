// 猫8匹の画像、選択・保存、兵装/再出撃後の維持、Bot・スコア・撃破相手を確認する。
// node tools/test/pilot_avatars_check.js dbg/cat-pilots [結果JSON]
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const dir = path.resolve(process.argv[2] || 'dbg/cat-pilots');
(async () => {
  const html = fs.readFileSync(path.join(dir, 'dbg.html'), 'utf8');
  const embedded = html.match(/background-image: url\("data:image\/png;base64,([^"]+)"\)/);
  if (!embedded || !Buffer.from(embedded[1], 'base64').equals(fs.readFileSync(path.resolve(__dirname, '../../prototype/avatars/cats.png')))) throw Error('埋め込んだ猫の画像が元のPNGと異なる');
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 } }), errors = [], checks = [], layouts = [];
    const yes = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    await p.locator('[data-page="pgPilot"]').click();
    yes(await p.locator('[data-pilot-choice]').count() === 8, '8匹を選べる');
    yes(await p.locator('[data-pilot-choice="tabby"]').getAttribute('aria-pressed') === 'true', '未保存はキジトラ');
    const images = await p.evaluate(async () => {
      const els = [...document.querySelectorAll('#pilotList .catFace')];
      const src = getComputedStyle(els[0]).backgroundImage.slice(5, -2), img = new Image(); img.src = src; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48; const ctx = canvas.getContext('2d'), hashes = [];
      for (let i = 0; i < 8; i++) {
        ctx.clearRect(0, 0, 48, 48); ctx.drawImage(img, i % 4 * img.width / 4, Math.floor(i / 4) * img.height / 2, img.width / 4, img.height / 2, 0, 0, 48, 48);
        const pixels = ctx.getImageData(0, 0, 48, 48).data; let hash = 2166136261, opaque = 0, clear = 0;
        for (let j = 0; j < pixels.length; j++) hash = Math.imul(hash ^ pixels[j], 16777619);
        for (let j = 3; j < pixels.length; j += 4) { if (pixels[j] > 250) opaque++; if (pixels[j] === 0) clear++; }
        if (opaque < 700 || clear < 150) throw Error('猫の顔や透過の余白が足りない：' + i);
        hashes.push(hash);
      }
      return { width: img.width, height: img.height, faces: new Set(hashes).size, positions: new Set(els.map(e => getComputedStyle(e).backgroundPosition)).size };
    });
    yes(images.width === images.height * 2 && images.faces === 8 && images.positions === 8, '透過PNGを読み込み、8つの異なる顔を表示');
    await p.locator('[data-pilot-choice="white"]').focus(); await p.keyboard.press('Enter');
    yes(await p.evaluate(() => localStorage.getItem('coreBreakerPilot') === 'white' && document.querySelectorAll('#pilotList [aria-pressed="true"]').length === 1 && document.getElementById('pilotSelection').textContent.includes('桜耳')), 'キーボードで桜耳の白猫を選択・保存');
    await p.reload();
    yes(await p.locator('[data-pilot-choice="white"]').getAttribute('aria-pressed') === 'true', '再読み込み後も白猫');
    await p.evaluate(() => {
      const g = __g; g.renderer.render = () => {}; g.selectMap('wide'); document.getElementById('start').click(); g.running = false; for (const u of g.units) u.frozen = true;
      window.pilotSnapshot = () => JSON.stringify({ cfg: g.mechCfg, loadout: g.loadout, hp: g.player.hp, boost: g.player.boost, sp: g.player.slots.sp.heat, weapon: g.player.weapon, cores: Object.values(g.cores).map(c => c.hp), count: g.units.length });
      window.pilotBefore = pilotSnapshot(); window.pilotSaved = Object.fromEntries(Object.entries(localStorage).filter(([k]) => k !== 'coreBreakerPilot'));
    });
    for (const id of ['silver', 'black', 'ginger', 'calico', 'tuxedo', 'siamese', 'tabby', 'white']) {
      await p.evaluate(id => document.querySelector(`[data-pilot-choice="${id}"]`).click(), id);
      yes(await p.evaluate(id => document.getElementById('pilotMark').dataset.pilot === id && pilotSnapshot() === pilotBefore && Object.entries(pilotSaved).every(([k, v]) => localStorage.getItem(k) === v), id), id + 'の選択で顔だけが変わる');
    }
    const classes = await p.evaluate(() => {
      const g = __g, u = g.player; return ['assault', 'heavy', 'raid', 'support'].every(cls => { g.equip(u, cls); g.hud(240, .016); return document.getElementById('pilotMark').dataset.pilot === 'white' && document.getElementById('pilotCls').textContent === g.CLASSES[cls].name; });
    });
    yes(classes, '4兵装で顔は維持し、兵装表示は切り替わる');
    await p.waitForTimeout(250);
    const board = await p.evaluate(() => {
      const g = __g; g.keys.Tab = true; g.running = true; g.hud(240, .016); g.running = false; g.keys.Tab = false;
      const faces = [...document.querySelectorAll('#boardBody tbody .catFace')]; window.botPilotIds = faces.map(e => e.dataset.pilot);
      return faces.length === g.units.length && new Set(faces.map(e => e.dataset.pilot)).size === 8 && document.querySelector('#boardBody .me .catFace').dataset.pilot === 'white';
    });
    yes(board, '10対10のスコア表に全員の顔が付き、Botに8匹を割り当てる');
    const killcam = await p.evaluate(() => {
      const g = __g, u = g.player, e = g.units.find(q => q.team !== u.team); g.running = true; g.kill(u, e, false); g.hud(240, .016);
      const result = !document.getElementById('respawn').hidden && !document.getElementById('killcam').hidden && document.getElementById('killerFace').firstChild.dataset.pilot === ['tabby', 'silver', 'black', 'white', 'ginger', 'calico', 'tuxedo', 'siamese'][(e.idx + 4) % 8];
      g.spawn(u); g.hud(240, .016); g.running = false; return result && document.getElementById('pilotMark').dataset.pilot === 'white';
    });
    yes(killcam, '撃破相手の顔が出て、再出撃後も自分は白猫');
    await p.evaluate(() => { const g = __g, u = g.player, t = g.turrets.find(t => t.team !== u.team); g.running = true; g.kill(u, t, false); g.hud(240, .016); g.running = false; });
    yes(await p.evaluate(() => !document.getElementById('killcam').hidden && getComputedStyle(document.getElementById('killerFace')).display === 'none'), '砲台に撃破された場合は猫の顔を付けない');
    await p.evaluate(() => { __g.spawn(__g.player); });
    for (const [width, height] of [[640, 480], [800, 600], [1280, 720], [1920, 1080]]) {
      await p.setViewportSize({ width, height });
      for (const mode of ['standard', 'arcade', 'flight', 'mechanical']) {
        await p.evaluate(mode => { document.querySelector(`[data-console-choice="${mode}"]`).click(); __g.hud(240, .016); }, mode);
        const boxes = await p.evaluate(() => Object.fromEntries(['pilot', 'pilotMark', 'aimSp', 'ammoBox', 'mini'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [id, { x: r.x, y: r.y, w: r.width, h: r.height }]; })));
        const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
        for (const id of ['pilot', 'pilotMark']) { const r = boxes[id]; yes(r.w >= 28 && r.h >= 28 && r.x >= 0 && r.y >= 0 && r.x + r.w <= width + 1 && r.y + r.h <= height + 1, `${width}x${height}/${mode}/${id}が画面内`); }
        yes(!overlap(boxes.pilot, boxes.aimSp) && !overlap(boxes.pilot, boxes.ammoBox) && !overlap(boxes.pilot, boxes.mini), `${width}x${height}/${mode}/顔とSP・装備・地図が重ならない`);
        layouts.push({ width, height, mode, boxes });
      }
    }
    await p.evaluate(() => localStorage.setItem('coreBreakerPilot', 'invalid')); await p.reload();
    yes(await p.locator('[data-pilot-choice="tabby"]').getAttribute('aria-pressed') === 'true', '不正な保存値はキジトラ');
    await p.addInitScript(() => { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw Error('storage denied'); }; }); await p.reload();
    await p.locator('[data-page="pgPilot"]').click(); await p.locator('[data-pilot-choice="black"]').click();
    yes(await p.locator('[data-pilot-choice="black"]').getAttribute('aria-pressed') === 'true', '保存APIが使えなくても猫を選べる');
    yes(!errors.length, 'ブラウザのエラーなし：' + errors.join('\n'));
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify({ passed: checks.length, checks, images, layouts, errors }, null, 2) + '\n');
    console.log(`猫パイロット：${checks.length}項目・${layouts.length}通りの配置、成功。ブラウザのエラーなし`);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
