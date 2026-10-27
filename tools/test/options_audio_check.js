// オプションの保存・戦闘再開・画角と、大人数時の実音声ミックスを確認する。
// node tools/test/options_audio_check.js dbg [結果・画像の出力先]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg'), out = path.resolve(process.argv[3] || 'dbg/options-audio');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const checks = [], errors = [], yes = (ok, msg) => { assert.ok(ok, msg); checks.push(msg); };
  fs.mkdirSync(out, { recursive: true });
  async function page(offline = false, blocked = false) {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(({ offline, blocked }) => {
      requestAnimationFrame = () => 0;
      if (offline) window.AudioContext = class extends OfflineAudioContext { constructor() { super(2, 48000, 48000); } };
      if (blocked) { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw Error('保存不可'); }; }
    }, { offline, blocked });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    return p;
  }
  try {
    const p = await page();
    await p.locator('[data-page="pgOptions"]').click();
    yes(await p.locator('#pgOptions').isVisible(), 'メニューからオプションへ移動できる');
    async function slider(id, value) {
      await p.locator('#' + id).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    }
    await slider('optMaster', 45); await slider('optSfx', 65); await slider('optMusic', 25); await slider('optFov', 90);
    yes(await p.evaluate(() => document.getElementById('optMasterValue').textContent === '45%' && document.getElementById('optFovValue').textContent === '90°'), 'スライダーの数値を即時表示');
    await p.waitForTimeout(220);
    yes(await p.evaluate(() => Math.abs(__g.audio.out.gain.value - .36) < .001 && Math.abs(__g.audio.effects.gain.value - .65) < .001 && Math.abs(__g.audio.music.gain.value - .25) < .001), '再生中にも全体・効果音・BGMの別々のゲインへ反映');
    await p.screenshot({ path: path.join(out, 'options.png') });
    await p.reload();
    yes(await p.evaluate(() => JSON.stringify(__g.gameOptions) === JSON.stringify({ master: 45, sfx: 65, music: 25, fov: 90, padLook: 50, padInvert: 0, padRumble: 1, touchLook: 50, touchSize: 50 })), '再読み込み後にも音量と視野角を復元');
    await p.evaluate(() => { localStorage.setItem('coreBreakerBgm', 'off'); localStorage.setItem('coreBreakerVoice', 'off'); document.getElementById('start').click(); for (const u of __g.units) u.frozen = true; });
    const fov = await p.evaluate(() => {
      const g = __g, u = g.player; u.dashState = ''; u.scoped = false; g.lock.target = null; g.updateCamera(u, 1); const idle = g.camera.fov;
      u.dashState = 'short'; g.updateCamera(u, 1); const dash = g.camera.fov;
      u.dashState = 'long'; g.updateCamera(u, 1); const long = g.camera.fov;
      u.dashState = ''; g.lock.target = g.units.find(e => e.team !== u.team); g.lock.visible = true; g.updateCamera(u, 1); const lock = g.camera.fov;
      g.lock.target = null; g.equip(u, 'raid'); g.selectWeapon(u, 'sub'); u.scoped = true; g.updateCamera(u, 1);
      const scope = g.camera.fov, power = g.scopePower(u); u.scoped = false;
      return { idle, dash, long, lock, scope, power };
    });
    yes(fov.idle === 90 && fov.dash === 102 && fov.long === 97, '設定した縦FOVを基準にダッシュの画角を加算');
    yes(fov.lock < 90 && Math.abs(fov.scope - 90 / fov.power) < 1e-6, 'ロックとスコープの倍率も設定FOVを基準に維持');
    const time = await p.evaluate(() => __g.timeLeft);
    await p.keyboard.press('F3');
    yes(await p.evaluate(() => !__g.running && !document.getElementById('optionsResume').hidden && !document.getElementById('pgOptions').hidden), 'F3で戦闘を一時停止して開く');
    await p.evaluate(() => { for (let i = 0; i < 5; i++) __g.loop(performance.now()); });
    yes(await p.evaluate(t => __g.timeLeft === t, time), 'オプション中は試合時間を進めない');
    await slider('optFov', 100); await p.keyboard.press('KeyW'); await p.locator('#optionsResume').click();
    yes(await p.evaluate(t => __g.running && document.getElementById('overlay').hidden && __g.timeLeft === t && !__g.keys.KeyW, time), '時間・試合を維持して再開し、操作の押しっぱなしを残さない');
    await p.keyboard.press('F3'); await p.keyboard.press('Escape');
    yes(await p.evaluate(() => __g.running && document.getElementById('overlay').hidden), 'Escでもオプションから戦闘に戻れる');
    await p.keyboard.press('F3'); await p.locator('#optionsReset').click();
    yes(await p.evaluate(() => __g.gameOptions.fov === 70 && __g.gameOptions.master === 100 && localStorage.getItem('coreBreakerBgm') === 'off' && localStorage.getItem('coreBreakerVoice') === 'off'), '標準に戻しても既存のBGM・音声スイッチの保存を上書きしない');
    await p.evaluate(() => localStorage.setItem('coreBreakerOptions', '{"master":-1,"sfx":999,"music":"大","fov":999}'));
    await p.reload();
    yes(await p.evaluate(() => __g.gameOptions.master === 0 && __g.gameOptions.sfx === 100 && __g.gameOptions.music === 100 && __g.gameOptions.fov === 100), '保存値の範囲外・文字列を安全に処理');
    await p.evaluate(() => localStorage.setItem('coreBreakerOptions', '壊れたJSON')); await p.reload();
    yes(await p.evaluate(() => __g.gameOptions.fov === 70), '壊れた保存値は標準設定に戻す');
    await p.close();
    const blocked = await page(false, true);
    await blocked.locator('[data-page="pgOptions"]').click();
    await blocked.locator('#optFov').evaluate(el => { el.value = 82; el.dispatchEvent(new Event('input')); });
    yes(await blocked.evaluate(() => __g.gameOptions.fov === 82), '保存できない環境でもその場で設定を変えられる'); await blocked.close();

    // 実際の効果音バッファと本体のsfxをOfflineAudioContextで合成し、音圧を比較する。
    async function mix(large, master = 100, withPriority = false) {
      const q = await page(true);
      await q.evaluate(({ large, master }) => {
        const g = __g; g.selectMap('tidal');
        for(const id of ['teamSize']){const el=document.getElementById(id);el.value=large?50:10;el.dispatchEvent(new Event('change'));}
        document.getElementById('start').click();
        document.getElementById('optMaster').value = master; document.getElementById('optMaster').dispatchEvent(new Event('input'));
        g.initAudio();
      }, { large, master });
      await q.waitForFunction(() => __g.sfxBuf.ar && __g.sfxBuf.beep);
      const result = await q.evaluate(async ({ large, withPriority }) => {
        const g = __g; Math.random = () => .5;
        for (let i = 0; i < (large ? 100 : 20); i++) g.sfx('ar', g.player.pos.clone().add(new g.T.Vector3(20 + i % 5, 0, 0)), {});
        if (withPriority) { g.sfx('ar', g.player.pos, g.player); g.sfx('lockWarn'); }
        const sizes = Object.fromEntries(Object.entries(g.soundVoices).map(([k, v]) => [k, v.size]));
        const before = [...g.soundVoices.world]; const close = {};
        if (withPriority) g.sfx('ar', g.player.pos.clone().add(new g.T.Vector3(1, 0, 0)), close);
        const promoted = !withPriority || before.some(v => !g.soundVoices.world.has(v));
        const buffer = await g.audio.startRendering();
        let sum = 0, peak = 0;
        for (let c = 0; c < buffer.numberOfChannels; c++) for (const x of buffer.getChannelData(c)) { sum += x * x; peak = Math.max(peak, Math.abs(x)); }
        return { sizes, rms: Math.sqrt(sum / buffer.length / buffer.numberOfChannels), peak, promoted, compressors: [g.audio.crowd.ratio.value, g.audio.limiter.ratio.value] };
      }, { large, withPriority });
      await q.close(); return result;
    }
    const normal = await mix(false), large = await mix(true), half = await mix(false, 50), mute = await mix(true, 0), priority = await mix(true, 100, true);
    yes(normal.rms > 0 && large.rms > 0, '実際の銃声音声を両人数モードで合成できる');
    yes(large.rms < normal.rms && large.peak <= normal.peak, '100発同時の大人数ミックスを20発同時以下の音圧・ピークに抑える');
    yes(half.rms < normal.rms && mute.peak === 0, '全体音量を半分・ゼロにすると実音声にも反映');
    yes(priority.sizes.world <= 16 && priority.sizes.local === 1 && priority.sizes.ui === 1, '混戦でも自機の発砲とロック警告を別枠で再生');
    yes(priority.promoted, '音枠が埋まっていても近くの音が遠くの音より優先される');
    yes(normal.sizes.world <= 24 && large.sizes.world <= 16 && large.compressors.every(x => x > 1), '通常・大人数それぞれの音数制限と圧縮を使用');
    yes(errors.length === 0, 'ブラウザエラーなし');
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ passed: checks.length, checks, normal, large, half, mute, priority, errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, normalRms: normal.rms, largeRms: large.rms, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
