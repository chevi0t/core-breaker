// 都市マップの写真の地面・木・空・海・外壁の種類（docs/DESIGN.md「都市マップの写真の地面・木・空・海」）。
//   node tools/test/city_photo_check.js [dbg のフォルダ=dbg]
// 星路駅前（hoshimichi）のデータへ、読み込み時に試験用の指定（1色の写真、木3本、空、海、外壁の種類）を足して確かめる。
// マップのファイルは書き換えない。指定の無いマップ（何も足さない星路駅前）で、木や空が出ないことも見る。
const fs = require('node:fs'), path = require('node:path');
const { check, helpers } = require('./lib');

// 2×2 のマゼンタ（255,0,255）の PNG。写真が貼られた面は、光が当たると赤と青だけが明るくなる。
const MAGENTA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z/CfgYGBiYGBgYGBAQAYEgICJxOGOQAAAABJRU5ErkJggg==';
const PATCH = `
;(()=>{const c=window.MAP_DATA.hoshimichi.cityTerrain,h=c.half;
  c.district.photo={image:'${MAGENTA}',bounds:[-h,-h,h,h],gain:1};
  const rows=new Uint8Array(27),v=new DataView(rows.buffer);
  [[0,0],[40,40],[-200,120]].forEach(([x,z],i)=>{v.setInt16(i*9,Math.round(x/.04),true);v.setInt16(i*9+2,Math.round(z/.04),true);rows.set([60,40,60,90,50],i*9+4);});
  c.district.trees={step:.04,count:3,data:btoa(String.fromCharCode(...rows))};
  c.district.sky={zenith:'#4d82c4',clouds:.5};
  c.district.bridgeColor='#8f9290';
  c.river.sea={sky:'#9fb4c4'};
  c.volumes.forEach((r,i)=>{r[4]={...r[4],facade:['glass','bands','plain'][i%3]};});
})();`;

async function open(browser, dir, errors, patched) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const keep = t => !/ERR_FAILED|ERR_FILE_NOT_FOUND|fonts|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(t);
  page.on('pageerror', e => { if (keep(e.stack || e.message)) errors.push(e.stack || e.message); });
  page.on('console', m => { if (m.type() === 'error' && keep(m.text())) errors.push(m.text()); });
  await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  if (patched) await page.route('**/maps.js', r => r.fulfill({ body: fs.readFileSync(path.join(dir, 'maps.js'), 'utf8') + PATCH, contentType: 'text/javascript' }));
  await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
  await page.goto('file://' + path.join(dir, 'dbg.html'));
  return page;
}

// 真上から地面を見て描き、画面の中央の色を読む
const lookDown = () => {
  const g = __g, gl = g.renderer.getContext(), cam = g.camera, keep = [cam.position.clone(), cam.quaternion.clone()];
  const spot = g.cityMap.district.bases[0].at; // 基地の中心（建物の無い地面）
  cam.position.set(spot[0] + 9, 30, spot[1] + 9); cam.lookAt(spot[0] + 9, 0, spot[1] + 9); cam.updateMatrixWorld(true);
  g.renderer.render(g.scene, cam);
  const px = new Uint8Array(4); gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  cam.position.copy(keep[0]); cam.quaternion.copy(keep[1]);
  return [...px];
};
const census = () => {
  const out = { trees: 0, crowns: 0, sky: 0, seaOpaque: null, photo: !!__g.cityMap.district.photo };
  __g.scene.traverse(m => {
    if (m.name === 'city-trees') { out.trees++; if (m.geometry.type === 'IcosahedronGeometry') out.crowns += m.count; }
    if (m.name === 'city-sky') out.sky++;
    if (m.name === 'city-water') out.seaOpaque = !m.material.transparent;
  });
  return out;
};

// 基地の地面には陣営の色の輪や半球が薄く重なるので、緑が赤・青よりはっきり低ければ写真の色とする
const magenta = px => px[0] > 150 && px[2] > 150 && px[1] < Math.min(px[0], px[2]) - 60;

check('都市の写真の地面・木・空・海', async ({ browser, dir, ok, errors }) => {
  for (const patched of [true, false]) {
    const page = await open(browser, dir, errors, patched), { ev, step } = helpers(page);
    await step(2);
    await ev(() => { __g.selectMap('hoshimichi'); document.getElementById('start').click(); });
    await step(3);
    await page.waitForTimeout(300); // 写真（data URI）の読み込み
    await step(2);
    const c = await ev(census), px = await ev(lookDown);
    if (patched) {
      ok(c.photo && magenta(px), `写真を貼った地面が写真の色で描かれる（中央の色 ${px.slice(0, 3)}）`);
      ok(c.crowns === 3 && c.trees >= 2, `木が3本、枝と幹の組で描かれる（${c.crowns}本、${c.trees}組）`);
      ok(c.sky === 1, '空の半球が1つある');
      ok(c.seaOpaque === true, '海は不透明で描かれる');
      const hits = await ev(() => __g.hittables.filter(m => /city-trees|city-sky/.test(m.name)).length);
      ok(hits === 0, '木と空は当たり判定に入らない');
      const before = await ev(() => document.getElementById('mini').toDataURL().length);
      ok(before > 1000, 'ミニマップが描ける');
      await ev(() => { __g.endMatch?.(); });
    } else {
      ok(!c.photo && !magenta(px), `指定の無いマップの地面は今までの色（中央の色 ${px.slice(0, 3)}）`);
      ok(c.trees === 0 && c.sky === 0 && c.seaOpaque === false, '指定の無いマップには木も空も無く、水面は半透明のまま');
    }
    await page.close();
  }
}, { page: false });
