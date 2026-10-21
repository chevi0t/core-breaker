// 足の接地、継続噴射、着地、音量・後片付けを実Web Audioで確認する。
// node tools/test/movement_audio_check.js dbg/movement-audio-sync [出力先] [変更前dbg]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg/movement-audio-sync');
const out = path.resolve(process.argv[3] || path.join(dir, 'results'));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] }), errors = [];
  async function page(folder = dir, offline = true) {
    const p = await browser.newPage();
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(offline => {
      requestAnimationFrame = () => 0;
      if (offline) window.AudioContext = class extends OfflineAudioContext { constructor() { super(2, 24000 * 8, 24000); } };
      else window.AudioContext = window.webkitAudioContext = undefined;
      localStorage.setItem('coreBreakerBgm', 'off'); localStorage.setItem('coreBreakerVoice', 'off');
    }, offline);
    await p.goto('file://' + path.join(folder, 'dbg.html'));
    await p.evaluate(() => { const g = __g; g.selectMap('dock'); document.getElementById('start').click(); g.renderer.render = () => g.scene.updateMatrixWorld(true); });
    return p;
  }
  try {
    const p = await page(); await p.evaluate(() => __g.initAudio());
    await p.waitForFunction(() => __g.sfxBuf.boostStart && __g.sfxBuf.boostLoop && __g.sfxBuf.hit && __g.sfxBuf.dash && __g.sfxBuf.ar && __g.sfxBuf.beep);
    const result = await p.evaluate(() => {
      const g = __g, T = g.T, u = g.player, checks = [], starts = [];
      const yes = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
      const create = g.audio.createBufferSource.bind(g.audio);
      g.audio.createBufferSource = () => {
        const node = create(), start = node.start.bind(node);
        node.start = (...args) => {
          const v = Object.values(g.soundVoices).flatMap(s => [...s]).find(v => v.node === node);
          starts.push({ name: v?.name, phase: u.rig.phase, rate: node.playbackRate.value, gain: v?.priority, pan: v?.pn?.pan.value, node }); start(...args);
        };
        return node;
      };
      function clear() { g.stopMovementSounds(); for (const pool of Object.values(g.soundVoices)) for (const v of [...pool]) { v.end(); v.node.stop(); } }
      function reset() {
        clear(); g.spawn(u); g.equip(u, 'assault'); g.running = true;
        for (const v of g.units) { v.frozen = true; v.cloakShown = false; }
        Object.assign(u, { alive: true, downT: 0, stun: '', dashState: '', dashT: 0, longDash: false, onGround: true, overheat: false, boost: 100, charging: false, chargerOn: false, repairing: false, planted: false, transfer: null, zip: null, recoverT: 0, yaw: 0, pitch: 0, stepQuiet: 0, sfxT: {} });
        u.pos.set(0, 200, 0); u.vel.set(0, 0, -6); g.resetMechPose(u); g.weaponLook(u, 0); starts.length = 0;
      }
      reset();
      const loop = g.sfxBuf.boostLoop, samples = loop.getChannelData(0), burst = g.sfxBuf.boostStart, attack = burst.getChannelData(0);
      for (const [label, buf] of [['短い噴射', burst], ['巡航', loop]]) {
        const data = buf.getChannelData(0), mean = data.reduce((s, v) => s + v, 0) / data.length;
        yes(data.every(Number.isFinite) && data.some(x => Math.abs(x) > .1) && data.every(x => Math.abs(x) <= .9) && Math.abs(mean) < 1e-5, label + 'の合成音に非数・無音・クリップ・直流成分がない');
        let low = 0, body = 0, full = 0; const k = 1 - Math.exp(-2 * Math.PI * 200 / buf.sampleRate);
        for (const v of data) { low += k * (v - low); body += low * low; full += v * v; }
        yes(body / full > .05 && body / full < .75, label + 'に低域の空気圧と広い帯域の噴流がある');
        const periodicity = [50, 60, 80, 100, 120].map(hz => {
          const lag = Math.round(buf.sampleRate / hz); let dot = 0, a = 0, b = 0;
          for (let i = lag; i < data.length; i++) { dot += data[i] * data[i - lag]; a += data[i] ** 2; b += data[i - lag] ** 2; }
          return Math.abs(dot / Math.sqrt(a * b));
        });
        yes(Math.max(...periodicity) < .25, label + 'に音程のある低音や倍音の強い周期振動が残らない');
      }
      const rms = (data, a, b) => Math.sqrt(data.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
      yes(rms(attack, .01 * burst.sampleRate, .06 * burst.sampleRate) > 2 * rms(attack, .18 * burst.sampleRate, .23 * burst.sampleRate), '短い噴射は開始直後に強い山があり、後半へ減衰する');
      let delta = 0; for (let i = 1; i < samples.length; i++) delta += (samples[i] - samples[i - 1]) ** 2;
      yes(loop.duration >= 1 && Math.abs(samples[0] - samples.at(-1)) < 4 * Math.sqrt(delta / (samples.length - 1)), '巡航は長い共有ループを使い、継ぎ目の跳びをノイズの通常変動内に収める');
      for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
        reset();
        for (let i = 0; i < Math.round(1.25 / dt); i++) { u.pos.z -= 6 * dt; u.sfxT.step = -1e9; g.weaponLook(u, dt); }
        const steps = starts.filter(v => v.name === 'step');
        yes(steps.length === Math.floor(u.rig.phase / Math.PI), dt + '秒刻み：足の接地回数と足音の回数が一致');
        yes(steps.every(v => v.phase >= Math.PI && Math.sin(v.phase % Math.PI) < .36), dt + '秒刻み：足が下りて接地する半周期に発音');
        yes(steps.length >= 4 && steps[0].rate !== steps[1].rate && steps[0].pan !== steps[1].pan, dt + '秒刻み：左右交互の足音');
      }
      for (const [label, set, move] of [
        ['壁で進めない', () => {}, false], ['停止中', () => u.vel.set(0, 0, 0), false],
        ['空中', () => { u.onGround = false; }, true], ['ダッシュ中', () => { u.dashState = 'short'; }, true],
        ['硬直中', () => { u.stun = 'stagger'; }, true], ['ポッド使用中', () => { u.repairing = true; }, true],
        ['死亡中', () => { u.alive = false; }, true], ['プレビュー', () => { u.kind = undefined; }, true]
      ]) {
        reset(); set(); for (let i = 0; i < 50; i++) { if (move) u.pos.z -= .12; u.sfxT.step = -1e9; g.weaponLook(u, .02); }
        yes(!starts.some(v => v.name === 'step'), label + 'は足音を鳴らさない'); u.kind = 'unit';
      }
      reset(); g.land(u, 1); yes(!starts.length, '小さな地形の段差では着地音を連打しない');
      g.land(u, 12); const soft = starts.find(v => v.name === 'land');
      yes(soft && !u.stun && u.rig.landT > 0, '硬直しない着地でも腰の沈み込みと一緒に発音');
      g.movementStep(u, -1); yes(starts.length === 1, '着地直後の足音を抑え、二重に鳴らさない');
      u.sfxT.land = -1e9; g.land(u, 36); const heavy = starts.at(-1);
      yes(heavy.gain > soft.gain && heavy.rate < soft.rate && u.stun === 'land', '強い落下は大きく低く鳴り、既存の硬直も維持');
      reset(); u.jumpBuf = .2; g.land(u, 36); yes(starts.length === 1 && !u.stun, '着地硬直を消す入力でも接地音は鳴る');
      reset(); const ok = g.shortDash(u, new T.Vector3(0, 0, -1));
      yes(ok && starts.length === 1 && starts[0].name === 'dash', '受理されたショートダッシュの踏み込みで発音');
      yes(starts[0].node.buffer === burst, 'クイックブーストは専用の低音付き噴射バッファを使う');
      g.shortDash(u, new T.Vector3(0, 0, -1)); yes(starts.length === 1, '失敗した連続ダッシュでは発音しない');
      reset(); u.dashState = 'long'; u.longDash = true; g.movementAudioTick(u, .02);
      const first = u.boostVoice;
      yes(first?.node.loop && g.soundVoices.local.has(first), '巡航は既存の自機音枠で継続噴射する');
      for (let i = 0; i < 100; i++) g.movementAudioTick(u, .02);
      yes(u.boostVoice === first && starts.filter(v => v.name === 'boostLoop').length === 1, '継続中は同じ音源を保ち、毎フレーム鳴らし直さない');
      u.dashState = 'hover'; u.onGround = false; g.movementAudioTick(u, .02); yes(u.boostVoice === first, '巡航から滞空へ滑らかに切り替える');
      u.onGround = true; g.movementAudioTick(u, .02); yes(!u.boostVoice && first.stopping, '滞空から着地した瞬間に噴射音をフェードで止める');
      reset(); g.equip(u, 'assault'); u.dashState = 'charge'; u.charging = u.chargerOn = true; u.overheat = true;
      g.movementAudioTick(u, .02); yes(u.boostVoice?.node.loop, '加速装置は通常ブーストが過熱してもSPで動く間は鳴る');
      u.slots.sp.overheat = true; g.movementAudioTick(u, .02); yes(!u.boostVoice, '加速装置のSP切れで音も止まる');
      for (const [label, stop] of [
        ['燃料切れ', () => { u.boost = 0; }], ['過熱', () => { u.overheat = true; }],
        ['撃破', () => { u.alive = false; }], ['ポッド', () => { u.repairing = true; }],
        ['近接硬直', () => { u.stun = 'down'; }], ['エリア移動', () => { u.transfer = {}; }],
        ['ジップライン', () => { u.zip = {}; }], ['一時停止', () => { g.running = false; }],
        ['画面非表示', () => Object.defineProperty(document, 'hidden', { configurable: true, value: true })]
      ]) {
        reset(); u.dashState = 'long'; u.longDash = true; g.movementAudioTick(u, .02); const v = u.boostVoice;
        stop(); g.movementAudioTick(u, .02); yes(!u.boostVoice && v.stopping, label + 'で継続音を止める'); delete document.hidden;
      }
      reset(); u.dashState = 'long'; u.longDash = true; g.movementAudioTick(u, .02); g.openOptions();
      yes(!u.boostVoice && !g.running, 'F3のオプションを開く処理で直ちに噴射音を止める');
      reset(); u.dashState = 'long'; u.longDash = true; g.movementAudioTick(u, .02); g.gameOptions.sfx = 0; g.applyAudioSettings();
      yes(!u.boostVoice, '効果音の音量0で継続音を止める'); g.gameOptions.sfx = 100; g.applyAudioSettings();
      reset(); u.dashState = 'long'; u.longDash = true; g.movementAudioTick(u, .02); g.gameOptions.master = 0; g.applyAudioSettings();
      yes(!u.boostVoice, '全体音量0でも継続音を止める'); g.gameOptions.master = 100; g.applyAudioSettings();
      reset(); u.dashState = 'long'; u.longDash = true; g.movementAudioTick(u, .02); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN' }));
      yes(!u.boostVoice, 'Nキーで消音した瞬間に継続音を止める'); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN' }));
      reset(); u.dashState = 'long'; u.longDash = true; g.movementAudioTick(u, .02);
      Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
      yes(!u.boostVoice, 'タブが隠れたら次の描画を待たずに継続音を止める'); delete document.hidden;
      reset(); u.dashState = 'long'; u.longDash = true; g.movementAudioTick(u, .02); g.spawn(u); yes(!u.boostVoice, '再出撃で古い噴射音を止める');
      for (const [label, other] of [['味方', g.units.find(v => v !== u && v.team === u.team)], ['敵', g.units.find(v => v.team !== u.team)]]) {
        reset();
        other.sfxT = {}; Object.assign(other, { alive: true, longDash: true, boost: 100, overheat: false, stun: '', downT: 0, repairing: false, transfer: null, planted: false, zip: null, stepQuiet: 0, chargerOn: true, charging: true });
        other.pos.copy(u.pos); other.slots.sp.overheat = false;
        g.movementStep(other, -1);
        for (const name of ['step', 'dash', 'jump', 'boostLoop', 'charge', 'land']) g.sfx(name, other.pos, other);
        for (const mode of ['long', 'hover', 'charge']) { other.dashState = mode; other.onGround = mode !== 'hover'; g.movementAudioTick(other, .02); }
        yes(!starts.length && !other.boostVoice && !g.soundVoices.world.size, label + 'が至近距離でも足音・噴射・ジャンプ・着地音を鳴らさない');
        g.sfx('ar', other.pos, other);
        yes(starts.length === 1 && starts[0].name === 'ar' && g.soundVoices.world.size === 1, label + 'の射撃音は距離減衰付きで残す');
      }
      reset(); u.dashState = 'long'; u.longDash = true; g.movementAudioTick(u, .02); const localBoost = u.boostVoice;
      for (let i = 0; i < 24; i++) g.sfx('ar', u.pos, {}, 1, .1);
      const quiet = [...g.soundVoices.world]; g.sfx('ar', u.pos, {}); g.sfx('ar', u.pos, u); g.sfx('lockWarn');
      yes(g.soundVoices.world.size <= 24 && quiet.some(v => v.ended) && g.soundVoices.local.has(localBoost) && [...g.soundVoices.local].some(v => v.name === 'ar') && [...g.soundVoices.ui].some(v => v.name === 'lockWarn'), '周囲の音数が上限でも自機の継続噴射・銃声・警告を保つ');
      reset(); const random = Math.random; let calls = 0;
      try { Math.random = () => { calls++; return .5; }; g.movementStep(u, -1); g.land(u, 12); u.dashState = 'long'; u.longDash = true; g.movementAudioTick(u, .02); } finally { Math.random = random; }
      yes(calls === 0, '追加した移動音はゲーム用乱数を消費しない');
      g.selectMap('city'); yes(!u.boostVoice, 'マップ変更で継続音を止める');
      g.setup(); const fresh = g.player; fresh.dashState = 'long'; fresh.longDash = true; fresh.boost = 100; g.movementAudioTick(fresh, .02);
      const active = fresh.boostVoice; g.setup(); yes(!fresh.boostVoice && active.stopping, '試合を作り直すと古い機体の継続音を止める');
      clear(); return { passed: checks.length, checks };
    });
    await p.close();

    // 実際のオーディオ時計を進めて、接地・噴射・通常ジャンプの着地を8秒の音声に記録する。
    const demo = await page(); await demo.evaluate(() => __g.initAudio());
    await demo.waitForFunction(() => __g.sfxBuf.boostStart && __g.sfxBuf.boostLoop && __g.sfxBuf.hit && __g.sfxBuf.dash);
    const clip = await demo.evaluate(async () => {
      const g = __g, u = g.player, T = g.T, ctx = g.audio, events = [], create = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const node = create(), start = node.start.bind(node), stop = node.stop.bind(node);
        node.start = (...a) => { const v = Object.values(g.soundVoices).flatMap(s => [...s]).find(v => v.node === node); events.push({ event: 'start', name: v?.name, time: ctx.currentTime, phase: u.rig.phase }); start(...a); };
        node.stop = (...a) => { const v = Object.values(g.soundVoices).flatMap(s => [...s]).find(v => v.node === node); events.push({ event: 'stop', name: v?.name, time: a[0] ?? ctx.currentTime }); stop(...a); };
        return node;
      };
      for (const v of g.units) { v.frozen = true; v.group.visible = false; }
      g.equip(u, 'assault'); Object.assign(u, { onGround: true, alive: true, stun: '', yaw: 0, pitch: 0, invulT: 0, dashState: '', longDash: false });
      u.pos.set(-50, g.terrainH(-50, -48), -48); u.vel.set(0, 0, -6); g.resetMechPose(u); g.weaponLook(u, 0);
      const pauses = Array.from({ length: 349 }, (_, i) => ctx.suspend((i + 1) * .02)), rendering = ctx.startRendering();
      for (let i = 0; i < pauses.length; i++) {
        await pauses[i]; const t = (i + 1) * .02;
        if (t >= .3 && t < 1.5) { u.pos.z -= .12; g.weaponLook(u, .02); }
        if (i === 74) { g.shortDash(u, new T.Vector3(0, 0, -1)); }
        if (i === 87) { u.dashState = 'long'; u.longDash = true; }
        if (i === 139) { u.dashState = ''; u.longDash = false; u.vel.set(0, 0, 0); }
        if (i === 154) { u.pos.y = g.terrainH(u.pos.x, u.pos.z); u.onGround = true; u.dashT = 0; g.physics(u, new T.Vector3(), false, true, .02); }
        else if (t > 3.1 && t < 4.6) g.physics(u, new T.Vector3(), false, false, .02);
        if (i === 234) { u.stun = ''; u.sfxT.land = -1e9; g.land(u, 36); }
        if (i === 254) { u.stun = ''; u.dashState = 'hover'; u.boost = 80; u.onGround = false; }
        if (i === 279) u.dashState = '';
        if (i === 299) { u.dashState = 'charge'; u.charging = u.chargerOn = true; u.slots.sp.heat = 100; u.slots.sp.overheat = false; }
        if (i === 324) { u.charging = u.chargerOn = false; u.dashState = ''; }
        g.movementAudioTick(u, .02); await ctx.resume();
      }
      const buffer = await rendering, pcm = [...buffer.getChannelData(0)], rms = (a, b) => Math.sqrt(pcm.slice(a * 24000, b * 24000).reduce((s, x) => s + x * x, 0) / ((b - a) * 24000));
      const wav = new ArrayBuffer(44 + buffer.length * 4), view = new DataView(wav);
      const str = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
      str(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); str(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 24000, true); view.setUint32(28, 96000, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, buffer.length * 4, true);
      for (let i = 0; i < buffer.length; i++) for (let c = 0; c < 2; c++) view.setInt16(44 + (i * 2 + c) * 2, Math.max(-1, Math.min(1, buffer.getChannelData(c)[i])) * 32767, true);
      let binary = ''; for (const byte of new Uint8Array(wav)) binary += String.fromCharCode(byte);
      return { wav: btoa(binary), events, rms: { sustained: rms(2, 2.7), stopped: rms(2.9, 3.05), hover: rms(5.2, 5.5), charge: rms(6.1, 6.4) }, voicesAfter: Object.values(g.soundVoices).reduce((n, s) => n + s.size, 0) };
    });
    assert.ok(clip.events.filter(e => e.event === 'start' && e.name === 'step').length >= 3, '実時間で足音を複数回発音');
    assert.ok(clip.events.some(e => e.event === 'start' && e.name === 'jump') && clip.events.some(e => e.event === 'start' && e.name === 'land' && e.time > 3.2 && e.time < 4.6), '通常ジャンプの跳躍と着地に同期');
    assert.ok(clip.rms.sustained > .001 && clip.rms.hover > .001 && clip.rms.charge > .001 && clip.rms.stopped < 1e-6, '継続噴射中だけ実音声が出る');
    assert.equal(clip.voicesAfter, 0, '停止後に音源の枠を解放');
    fs.writeFileSync(path.join(out, 'movement-demo.wav'), Buffer.from(clip.wav, 'base64')); delete clip.wav; await demo.close();

    // 移動音が無くても動き、従来版と同じ入力で位置・速度・消費・硬直が変わらないことを確認する。
    async function physicsTrace(folder) {
      const q = await page(folder, false); const trace = await q.evaluate(hasMotion => {
        const g = __g, T = g.T, u = g.player, trace = []; g.equip(u, 'assault');
        Object.assign(u, { yaw: 0, pitch: 0, onGround: true, stun: '', invulT: 0, dashT: 0, longDash: false, boost: 100, overheat: false });
        u.pos.set(-50, g.terrainH(-50, -48), -48); u.vel.set(0, 0, 0);
        for (let i = 0; i < 600; i++) {
          const dir = new T.Vector3(i < 200 ? 0 : 1, 0, i < 200 ? -1 : 0);
          if (i === 80 || i === 240) g.shortDash(u, dir);
          if (i === 400) { u.chargerOn = true; u.slots.sp.heat = 100; }
          if (i === 450) u.chargerOn = false;
          g.physics(u, dir, (i >= 80 && i < 150) || (i >= 240 && i < 300) || (i >= 400 && i < 450), i === 40 || i === 190, 1 / 60, i >= 70 && i < 79);
          g.weaponLook(u, 1 / 60); if (hasMotion) g.movementAudioTick(u, 1 / 60);
          trace.push([...u.pos.toArray(), ...u.vel.toArray(), u.boost, u.slots.sp.heat, u.onGround, u.stun, u.stunT, u.dashState]);
        }
        return trace;
      }, folder === dir); await q.close(); return trace;
    }
    const current = await physicsTrace(dir); let physicsMatches = null;
    if (process.argv[4]) { assert.deepEqual(current, await physicsTrace(path.resolve(process.argv[4]))); physicsMatches = true; }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ ...result, clip, physicsFrames: current.length, physicsMatches, errors }, null, 2) + '\n');
    console.log(`移動音：${result.passed}項目、実音声4項目、移動${current.length}フレーム${physicsMatches ? 'の従来版との一致' : ''}、ブラウザエラー0`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
