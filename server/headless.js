'use strict';
// #212限定の読取adapter。製品用サーバーではない。戦闘コードは本体から読み、複製しない。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '..');

// 初期化時のUI参照だけを受ける。DOMツリー・Canvas描画・WebGLは作らない。
function element() {
  const e = { style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    value: '', textContent: '', innerHTML: '', hidden: true, checked: false, width: 640, height: 400, children: [],
    addEventListener() {}, removeEventListener() {}, appendChild() {}, append() {}, remove() {}, setAttribute() {},
    getAttribute() { return ''; }, querySelectorAll() { return []; }, querySelector() { return element(); },
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 640, height: 400 }; },
    focus() {}, blur() {}, contains() { return false; }, closest() { return null; },
    getContext(type) { if (type !== '2d') throw Error('WebGLは禁止'); return canvasContext; } };
  return e;
}
const canvasContext = { measureText: s => ({ width: String(s).length * 8 }),
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) };
for (const key of ['clearRect','fillRect','strokeRect','beginPath','closePath','moveTo','lineTo','arc','ellipse','fill','stroke','save','restore','translate','rotate','scale','setTransform','drawImage','putImageData','fillText','strokeText','rect','clip','quadraticCurveTo','bezierCurveTo','setLineDash','roundRect']) canvasContext[key] = () => {};

// 見た目だけの入り口。weaponLook/mechPoseは銃口と当たり形状に効くので残す。
const NOOPS = ['sfx','initAudio','bgmTick','stopMovementSounds','movementAudioTick',
  'flash','impact','smokeTrail','sparkBurst','puff','popup','feed','announce','annTick','annPlant','annCore',
  'damageLook','cloakLook','shockLook','mainMuzzleUpdate','boosterFlameUpdate','combatFeedbackUpdate',
  'updateBlastShake','kickBlastShake','flashDamage','fxUpdate','puffUpdate','boomUpdate','deathEnergyBurst','boom','downBurst','addFx',
  'padTick','touchTick','hud','popUpdate','updateCamera','mechPreview','renderView',
  'renderOptions','applyHudScale','renderPlantBar','renderClsButtons','renderBuildTabs','renderTeamView',
  'renderPilotNow','renderCustom','renderMapList','renderBuildSaveStatus','resize'];

function replaceOnce(code, before, after) {
  if (code.split(before).length !== 2) throw Error('本体の形が変化: ' + before.slice(0, 90));
  return code.replace(before, after);
}

function createSimulation({ map = 'mesa', units = 10 } = {}) {
  if (map !== 'mesa') throw Error('この試作で検証するマップはmesaのみ');
  if (![10,20].includes(units)) throw Error('unitsは10か20');
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element, createElementNS: element, querySelectorAll: () => [], querySelector: () => element(),
    body: element(), documentElement: element(), addEventListener() {}, exitPointerLock() {} };
  const three = require('../vendor/three-r128/three.min.js');
  class NullRenderer { constructor() { this.shadowMap = {}; this.capabilities = { getMaxAnisotropy: () => 1 }; this.domElement = element(); } setPixelRatio() {} setSize() {} render() {} getPixelRatio() { return 1; } }
  const sandbox = { structuredClone, console, THREE: { ...three, WebGLRenderer: NullRenderer }, document, performance,
    navigator: { maxTouchPoints: 0, getGamepads: () => [] }, innerWidth: 640, innerHeight: 400, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, requestAnimationFrame() {}, cancelAnimationFrame() {},
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    ResizeObserver: class { observe() {} }, Image: class { addEventListener() {} },
    location: { search: '', hash: '', protocol: 'file:' }, URLSearchParams, URL, Blob,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  for (const name of ['maps.js','weapons.js','parts.js','pilots.js']) vm.runInContext(fs.readFileSync(path.join(ROOT,'prototype',name),'utf8'), context, { filename: name });
  const html = fs.readFileSync(path.join(ROOT,'prototype/index.html'),'utf8');
  let code = html.slice(html.indexOf('<script>\n') + '<script>\n'.length, html.lastIndexOf('</script>'));
  const muted = NOOPS.filter(n => new RegExp('function '+n+'\\(').test(code));
  code = muted.map(n => `${n} = function() {};`).join('\n') + '\n' + code;
  code = replaceOnce(code, 'const dt = Math.min(0.05, (now - last) / 1000); last = now;', 'const dt = 1 / 60; last = now;');
  // 全員BOT。各兵装の初期装備を固定（数値・表は変更しない）。再出撃も同じ装備。
  code = replaceOnce(code, 'player = makeUnit(chosenTeam, true, 0);', 'player = makeUnit(chosenTeam, false, 0);');
  code = replaceOnce(code, 'const pick = k => u.isPlayer ? (tutorial ? c[k] : loadout[cls][k]) : A[k][Math.floor(Math.random() * A[k].length)];', 'const pick = k => c[k];');
  code += `\ntracer = laserTrail = () => 0;
    const benchCounts = { fire: 0, ar: 0, rocket: 0, blast: 0, spawns: 0 };
    const originalFire = fire, originalShoot = shoot, originalBlast = blast, originalSpawn = spawn;
    let mapBuilt = false;
    fire = function(...a) { benchCounts.fire++; if(a[3].key==='ar')benchCounts.ar++; return originalFire(...a); };
    shoot = function(...a) { if(a[3]===WEAPONS.rocket.proj)benchCounts.rocket++; return originalShoot(...a); };
    blast = function(...a) { benchCounts.blast++; return originalBlast(...a); };
    spawn = function(...a) { benchCounts.spawns++; return originalSpawn(...a); };
    globalThis.bench = {
      start() { for(const k of Object.keys(benchCounts))benchCounts[k]=0; selectedTeamSize = ${units/2}; if(!mapBuilt) { buildMap('${map}'); mapBuilt=true; } setup(); running = true; scene.updateMatrixWorld(true); },
      step(now) { gameFrame(now); scene.updateMatrixWorld(true); },
      isEnded() { return ended; },
      state() { return { time: MATCH-timeLeft, duration: MATCH, ended, core: [cores.B.hp,cores.R.hp],
        kills: units.reduce((s,u)=>s+u.sc.kills,0), deaths: units.reduce((s,u)=>s+u.sc.deaths,0),
        counts: { ...benchCounts }, units: units.length, shells: shells.length, gadgets: gadgets.length, meshes: hittables.length, effects: fx.length,
        weapons: [...new Set(units.flatMap(u=>SLOTS.map(k=>u.slots[k].w.key)))],
        finite: units.every(u=>[u.hp,u.pos.x,u.pos.y,u.pos.z].every(Number.isFinite)) }; },
      muted: ${JSON.stringify(muted)}
    };`;
  vm.runInContext(code, context, { filename: 'prototype/index.html (headless)', timeout: 30000 });
  context.bench.start();
  return context.bench;
}
module.exports = { createSimulation };
