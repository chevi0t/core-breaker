// 使い方: python3 tools/test/make_dbg.py dbg && node tools/test/mech_shapes_check.js dbg [画像の出力先]
// 各シリーズの基本型で全混成機（6系統なら1296通り）を作り、部位別の実射ダメージ、頭の高さ、描画予算、武器の取付位置を確認する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const dir = path.resolve(process.argv[2] || 'dbg');
const output = path.resolve(process.argv[3] || path.join(dir, 'mech-shapes'));

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    await page.evaluate(() => {__g.renderer.render=()=>{const u=__g.units[0];if(u)u.group.parent.updateMatrixWorld();};__g.selectMap('dock');document.getElementById('start').click();__g.running=false;});

    const result = await page.evaluate(() => {
      const g = __g, T = g.T, slots = ['head', 'body', 'arms', 'legs'];
      const keys=Object.keys(g.PARTS.head), types=keys.filter((k,i)=>keys.findIndex(x=>g.PARTS.head[x].series===g.PARTS.head[k].series)===i);
      const legacyTypes=['light','standard','heavy'];
      // 旧3系統は従来の1.5倍制限を保つ。追加系統を含む混成機は60箱以内。
      const original = { head: [5, 4, 6], body: [7, 7, 10], arms: [6, 6, 8], legs: [12, 10, 12] };
      const anchors = { gun: [1.55, 2.5, -0.7], gun2: [-1.6, 2.6, -0.7], blade: [-1.6, 2.6, -1.6], pack: [0, 2.7, 1.45], mount: [0, 2.75, 1.25] };
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      for (const u of g.units) { u.frozen = true; u.isPlayer = false; }
      const scene = g.player.group.parent;
      g.renderer.render = () => scene.updateMatrixWorld();
      g.timeLeft = 1e5;
      const shooter = g.units.find(u => u.team === 'B'), target = g.units.find(u => u.team === 'R');
      const previous = { hp: target.hp, maxHp: target.maxHp, invulT: target.invulT, weakT: target.weakT, partArmor: target.partArmor, armorAvg: target.armorAvg, pos: target.pos.clone() };
      const hits = g.hittables.slice(), counts = {};
      let combinations = 0, shots = 0, maxBoxes = 0;
      try {
        for (const head of types) for (const body of types) for (const arms of types) for (const legs of types) {
          const cfg = { head, body, arms, legs, color: 'ash' }, label = [head, body, arms, legs].join('/');
          const model = g.buildMech(g.TEAM.R.color, cfg);
          try {
            const armor = model.g.children.filter(m => m.userData.own && m.userData.armorSlot);
            check(armor.length === 4, label + ': 装甲は4部位のメッシュ');
            const boxes = armor.reduce((sum, m) => sum + m.geometry.attributes.position.count / 36, 0);
            const legacy=slots.every(slot=>legacyTypes.includes(cfg[slot]));
            const budget = legacy ? slots.reduce((sum, slot) => sum + original[slot][legacyTypes.indexOf(cfg[slot])], 0) * 1.5 : 60;
            check(boxes <= budget, label + ': 箱数が描画予算を超えた');
            maxBoxes = Math.max(maxBoxes, boxes);
            if (slots.every(slot => cfg[slot] === head)) counts[head] = boxes;
            for (const [key, position] of Object.entries(anchors)) check(model[key].position.toArray().every((v, i) => v === position[i]), label + ': 武器の取付位置 ' + key);
            const helmet = armor.find(m => m.userData.armorSlot === 'head');
            helmet.geometry.computeBoundingBox();
            check(helmet.geometry.boundingBox.min.y >= 3.2 - 1e-6 && helmet.geometry.boundingBox.max.y <= 3.95 + 1e-6, label + ': 頭部の高さ');
            const trim = new T.Color(g.TEAM.R.color), paint = new T.Color(0xaebcc8);
            for (const mesh of armor) {
              const colors = mesh.geometry.attributes.color;
              const includes = c => {
                for (let i = 0; i < colors.count; i++) if (Math.abs(colors.getX(i) - c.r) < 1e-6 && Math.abs(colors.getY(i) - c.g) < 1e-6 && Math.abs(colors.getZ(i) - c.b) < 1e-6) return true;
                return false;
              };
              check(includes(trim) && includes(paint), label + ': 塗装とチーム帯 ' + mesh.userData.armorSlot);
            }
            model.g.position.set(0, 20, 0);
            model.g.updateMatrixWorld(true);
            g.hittables.length = 0;
            for (const mesh of armor) { mesh.userData.ref = target; g.hittables.push(mesh); }
            const stats = g.mechStats(cfg, g.loadout.assault);
            Object.assign(target, { hp: 1e6, maxHp: 1e6, invulT: 0, weakT: 0, partArmor: stats.armor, armorAvg: stats.avg });
            target.pos.set(0, 20, 0);
            for (const [slot, x, y] of [['head', 0, 3.7], ['body', 0, 2.65], ['arms', 1.48, 2.24], ['legs', 0.62, 0.67], ['arms', 1.35, 3.1]]) {
              const from = new T.Vector3(x, 20 + y, -10), aim = new T.Vector3(x, 20 + y, 0);
              const hit = g.castFrom(from, aim.clone().sub(from).normalize(), shooter, 20);
              check(hit && hit.ref === target && hit.slot === slot, label + ': 命中部位 ' + slot + '/' + y);
              const before = target.hp;
              g.fire(shooter, aim, 0, { dmg: 100, range: 20, head: 1.3 }, from);
              const expected = 100 * stats.armor[slot] * (slot === 'head' ? 1.3 : 1);
              check(Math.abs(before - target.hp - expected) < 1e-5, label + ': 部位の装甲・頭部倍率 ' + slot + '/' + y);
              shots++;
            }
            // 実射の光・弾道はこの同期検証中に時刻が進まないため、溜めずに片付ける。
            for(const f of g.fx){scene.remove(f.obj);if(f.kind==='sparks'||f.ownGeo)f.obj.geometry.dispose();if(f.obj.material&&!Array.isArray(f.obj.material))f.obj.material.dispose();}g.fx.length=0;
            combinations++;
          } finally { g.disposeMech(model.g); }
        }
        // 今後追加される型も、キー名でなくseriesから同じ形を選べること。
        const cfg = { ...g.MECH_DEFAULT, color: 'ash' }, future = { ...cfg };
        for (const slot of slots) { g.PARTS[slot].shapeTest = { ...g.PARTS[slot].light }; cfg[slot] = 'light'; future[slot] = 'shapeTest'; }
        const base = g.buildMech(g.TEAM.B.color, cfg), next = g.buildMech(g.TEAM.B.color, future);
        try {
          for (let i = 0; i < 4; i++) {
            const a = base.g.children[i].geometry.attributes.position.array, b = next.g.children[i].geometry.attributes.position.array;
            check(a.length === b.length && a.every((v, j) => v === b[j]), '同じシリーズの別の型で形が変わった');
          }
        } finally {
          g.disposeMech(base.g); g.disposeMech(next.g);
          for (const slot of slots) delete g.PARTS[slot].shapeTest;
        }
      } finally {
        g.hittables.splice(0, g.hittables.length, ...hits);
        Object.assign(target, previous); target.pos = previous.pos;
      }
      return { combinations, shots, boxes: counts, maxBoxes, futureType: true, seriesCount:types.length };
    });
    assert.equal(result.combinations, result.seriesCount**4);
    assert.equal(result.shots, result.combinations*5);
    console.log('機体形状:', JSON.stringify(result));

    const configurations = {
      swift: { head: 'light', body: 'light', arms: 'light', legs: 'light' },
      hound: { head: 'standard', body: 'standard', arms: 'standard', legs: 'standard' },
      bulwark: { head: 'heavy', body: 'heavy', arms: 'heavy', legs: 'heavy' },
      ...(await page.evaluate(()=>Object.fromEntries(['harrier','prism','bastion'].filter(k=>__g.PARTS.head[k]).map(k=>[k,{head:k,body:k,arms:k,legs:k}])))),
      mixed: { head: 'light', body: 'standard', arms: 'heavy', legs: 'light' }
    };
    await page.evaluate(async () => { await document.exitPointerLock?.(); });
    await page.setViewportSize({ width: 1360, height: 900 });
    for (const [name, cfg] of Object.entries(configurations)) {
      await page.evaluate(cfg => {
        Object.assign(__g.mechCfg, cfg, { color: 'ash' });
        __g.renderCustom(); __g.showPage('pgCustom');
        document.getElementById('overlay').hidden = false;
      }, cfg);
      await page.click('[data-cslot="head"]');
      await page.waitForFunction(() => !!__g.mechRig?.m);
      // 同じ角度で比較する。通常のプレビューは回転を続ける。
      await page.evaluate(() => { __g.mechRig.drag = 0; __g.mechRig.yaw = -0.45; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(output, name + '.png') });
      await page.locator('#cuPreview').screenshot({ path: path.join(output, name + '-preview.png') });
    }
    assert.deepEqual(errors, []);
    console.log('ブラウザエラー: なし。機体カスタマイズ画像:', output);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
