// 使い方: node tools/test/part_variants_check.js dbg [画像の出力先] [変更前の数値JSON]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg');
const output = path.resolve(process.argv[3] || path.join(dir, 'part-variants'));
const slots = ['head','body','arms','legs'];
const research = Object.fromEntries(slots.map(k => [k, require('../../research/parts/types/' + k + '.json')]));
const legacy = { head: 'light', body: 'standard', arms: 'heavy', legs: 'heavy', color: 'ash' };
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.addInitScript(cfg => {
      if (localStorage.getItem('partVariantsFixture')) return;
      localStorage.setItem('partVariantsFixture', '1');
      localStorage.setItem('coreBreakerMap', 'dock');
      localStorage.setItem('coreBreakerMech', JSON.stringify(cfg));
      const mech2 = { head: 'heavy', body: 'heavy', arms: 'heavy', legs: 'heavy', color: 'sand' };
      localStorage.setItem('coreBreakerBuilds', JSON.stringify({ cur: 0, list: [{ mech: cfg }, { mech: mech2 }, { mech: cfg }] }));
    }, legacy);
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    const result = await page.evaluate(() => {
      const g = __g, check = (ok, msg) => { if (!ok) throw new Error(msg); };
      g.renderer.render = () => {};
      const slots = ['head','body','arms','legs'], keys = Object.keys(g.PARTS.head);
      const bases = ['light','standard','heavy'];
      let combinations = 0, sets = 0, shapes = 0;
      for (const head of keys) for (const body of keys) for (const arms of keys) for (const legs of keys) {
        const cfg = { head, body, arms, legs, color: 'team' }, st = g.mechStats(cfg, g.loadout.assault);
        check([st.weight,st.cap,st.walk,st.dash,st.cruise,st.avg].every(Number.isFinite), '混成機の数値が有限');
        const same = slots.every(k => g.PARTS[k][cfg[k]].series === g.PARTS.head[head].series);
        check(!!st.set === same, 'セットは型でなくシリーズで決まる');
        if (same) {
          sets++;
          const series = g.PARTS.head[head].series;
          if (series === 'swift') check(st.P.body.boost === g.PARTS.body[body].boost + 5 && st.P.legs.walk === g.PARTS.legs[legs].walk + 0.45, '軽量セット');
          if (series === 'hound') check(st.P.head.aim === g.PARTS.head[head].aim * 1.05 && st.cap === g.PARTS.legs[legs].cap + 150, '標準セット');
          if (series === 'bulwark') check(slots.every(k => st.armor[k] === g.PARTS[k][cfg[k]].armor - 0.03), '重装セット');
        }
        combinations++;
      }
      for (const base of bases) {
        const cfg = Object.fromEntries(slots.map(k => [k,base])); cfg.color = 'ash';
        const model = g.buildMech(g.TEAM.B.color, cfg);
        try {
          for (const suffix of ['2','3']) for (const slot of slots) {
            const variant = g.buildMech(g.TEAM.B.color, { ...cfg, [slot]: base + suffix });
            try {
              for (let i=0;i<4;i++) {
                const a = model.g.children[i].geometry.attributes.position.array, b = variant.g.children[i].geometry.attributes.position.array;
                check(a.length === b.length && a.every((v,j) => v === b[j]), '同シリーズの型の形');
              }
              shapes++;
            } finally { g.disposeMech(variant.g); }
          }
        } finally { g.disposeMech(model.g); }
      }
      const seen = Object.fromEntries(slots.map(k => [k,new Set()]));
      const random = Math.random;
      let seed = 123456;
      Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2**32);
      try {
        for (const cls of ['assault','heavy','raid','support']) for (let i=0;i<1000;i++) {
          const cfg = g.botMech(cls), load = Object.fromEntries(g.SLOTS.map(k => [k,g.ARMORY[cls][k][0]]));
          const eligible = keys.filter(legs => g.mechStats({ ...cfg,legs },load).excess <= 300);
          check(!eligible.length || eligible.includes(cfg.legs), 'Botの脚の重量条件');
          if (!eligible.length) check(g.PARTS.legs[cfg.legs].cap === Math.max(...keys.map(k => g.PARTS.legs[k].cap)), 'Botの重量耐性の最大値');
          for (const k of slots) { check(!!g.PARTS[k][cfg[k]], 'Botの型'); seen[k].add(cfg[k]); }
        }
      } finally { Math.random = random; }
      for (const slot of slots) check(seen[slot].size === 9, 'Botが全9型を使う: ' + slot);
      return { parts: g.PARTS, mech: g.mechCfg, combinations, sets, shapes, botTypes: Object.fromEntries(slots.map(k => [k,[...seen[k]]])) };
    });
    assert.deepEqual(result.mech, legacy, '古い機体の保存');
    assert.equal(result.combinations, 6561); assert.equal(result.sets, 243); assert.equal(result.shapes, 24);
    let added = 0;
    for (const slot of slots) for (const family of research[slot]) {
      const original = result.parts[slot][family.base];
      for (const row of family.types) {
        const actual = result.parts[slot][row.key];
        for (const [field, value] of Object.entries(row)) if (typeof value === 'number') {
          const digits = ['weight','cap'].includes(field) ? 0 : ['lock','boost'].includes(field) ? 1 : ['walk','dash'].includes(field) ? 2 : 4;
          const expected = +(original[field] * (value / family.baseRow[field])).toFixed(digits);
          assert.equal(actual[field], expected, slot + '/' + row.key + '/' + field);
        }
        if (slot === 'body') assert.equal(actual.sp, original.sp, 'SP容量を継承');
        if (slot === 'legs') assert.equal(actual.cruise, original.cruise, '巡航を継承');
        assert.equal(actual.series, original.series); assert.equal(actual.label, row.label);
        added++;
      }
    }
    assert.equal(added,24);
    if (process.argv[4]) {
      const old = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
      for (const slot of slots) for (const [key,p] of Object.entries(old.parts[slot])) assert.deepEqual(result.parts[slot][key], p, 'Ⅰ型を保持');
    }
    await page.setViewportSize({ width: 1360,height: 900 });
    await page.evaluate(() => { __g.renderCustom(); __g.showPage('pgCustom'); });
    await page.click('#cuBuilds [data-build="1"]');
    assert.deepEqual(await page.evaluate(() => __g.mechCfg), { head:'heavy',body:'heavy',arms:'heavy',legs:'heavy',color:'sand' }, '古い構成2を読む');
    await page.click('#cuBuilds [data-build="0"]');
    assert.deepEqual(await page.evaluate(() => __g.mechCfg),legacy,'古い構成1へ戻る');
    for (const [series,key] of [['swift','light3'],['hound','standard3'],['bulwark','heavy3']]) {
      await page.click('[data-cslot="head"]');
      const heading = page.locator(`[data-series="${series}"]`);
      if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
      await page.locator(`[data-pick="${key}"]`).hover();
      assert.match(await page.locator('#cuDiff').innerText(),/[▲▼]/);
      await page.waitForFunction(() => !!__g.mechRig?.m);
      await page.evaluate(() => { __g.mechRig.drag=0; __g.mechRig.yaw=-0.45; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(output,series+'.png') });
    }
    const selected = { head:'light2',body:'standard3',arms:'heavy2',legs:'heavy3',color:'ash' };
    for (const slot of slots) {
      await page.click(`[data-cslot="${slot}"]`);
      const series = result.parts[slot][selected[slot]].series, heading = page.locator(`[data-series="${series}"]`);
      if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
      await page.click(`[data-pick="${selected[slot]}"]`);
    }
    assert.deepEqual(await page.evaluate(() => __g.mechCfg), selected, '新しい型をUIで装備');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('coreBreakerMech'))), selected, '新しい型を保存');
    await page.locator('#cuWBar').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output,'weight.png') });
    await page.waitForTimeout(500); // localStorage への書き込みが残るのを待ってから読み直す（重いページだと、すぐ読み直すと書く前の値に戻ることがある）
    await page.reload();
    assert.deepEqual(await page.evaluate(() => __g.mechCfg), selected, '新しい型を保存して再読込');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'stats.json'),JSON.stringify(result.parts,null,2));
    console.log('パーツ24追加・全36: AC比率一致、Ⅰ型保持。全6561構成・セット243・同じ形24・Bot全9型・旧保存/構成切替・新保存の再読込: 成功。エラーなし');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
