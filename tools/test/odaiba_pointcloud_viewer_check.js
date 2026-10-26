/* オフライン表示、生成材質の再現性、保存後の描画形状を検査する。 */
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const out = process.env.ODAIBA_POINTCLOUD_OUTPUT || path.resolve(__dirname, '../../mapdesign/sowan/pointcloud-third');
async function main() {
  const browser = await chromium.launch({args: ['--no-sandbox', '--use-gl=swiftshader']});
  try {
    const page = await browser.newPage({offline: true, viewport: {width: 1800, height: 1000}});
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (/^https?:/.test(r.url())) external.push(r.url()); });
    await page.goto('file://' + path.join(out, 'preview.html'));
    await page.waitForFunction(() => window.reviewReady, {timeout: 45000});
    const measure = () => page.evaluate(() => {
      const textures = {};
      for (const key of ['asphalt', 'paving', 'grass']) {
        const c = review.detail.materials[key].map.image;
        const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let hash = 2166136261, min = 255, max = 0;
        for (let i = 0; i < a.length; i += 4) {
          hash = Math.imul(hash ^ a[i], 16777619); min = Math.min(min, a[i]); max = Math.max(max, a[i]);
        }
        textures[key] = {width: c.width, height: c.height, hash: hash >>> 0, variation: max - min};
      }
      let finite = true, triangles = 0;
      review.scene.traverse(o => {
        if (o.isMesh && o.geometry.attributes.position) {
          const p = o.geometry.attributes.position.array;
          if (!p.every(Number.isFinite)) finite = false;
          triangles += (o.geometry.index?.count || p.length / 3) / 3;
        }
      });
      return {textures, finite, triangles, scale: review.data.scale, sourceFiles: review.data.sourceFiles,
        northExtension: review.data.northExtensionGameMeters, actualBoundsExtension: review.data.northExtensionCoveredBoundsGameMeters, stats: review.detail.stats,
        drawCalls: review.renderer.info.render.calls, glError: review.renderer.getContext().getError()};
    });
    const first = await measure();
    assert(first.finite); assert.equal(first.glError, 0); assert.equal(first.scale, 1/3);
    assert.equal(first.northExtension, 100); assert(first.triangles < 500000); assert(first.drawCalls < 110);
    for (const t of Object.values(first.textures)) assert(t.variation > 10 && t.width >= 256);
    for (const name of ['all', 'top', 'north', 'promenade', 'expressway', 'guideway', 'gate']) {
      await page.evaluate(name => review.view(name), name);
      await page.screenshot({path: path.join(out, name + '.png')});
    }
    // 保存した実地表を識別色で描き、遠景・斜視でも正しい路面が見えることを確かめる。
    const samples = JSON.parse(fs.readFileSync(path.join(out, 'terrain-check.json'))).groundSurfaceSamples;
    const groundCheck = await page.evaluate(samples => {
      const scene = new THREE.Scene(), colors = {pavement: 0x0000ff, roads: 0xff0000, grass: 0x00ff00};
      const materials = [], levels = [];
      for (const [kind, color] of Object.entries(colors)) {
        const original = review.scene.getObjectByName('ground-' + kind);
        const pos = original.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) levels.push(pos.getY(i));
        const mat = new THREE.MeshBasicMaterial({color, side: THREE.DoubleSide, toneMapped: false});
        materials.push(mat); scene.add(new THREE.Mesh(original.geometry, mat));
      }
      const rt = new THREE.WebGLRenderTarget(1025, 1025), pixel = new Uint8Array(4), camera = review.camera.clone();
      camera.aspect = 1; let checks = 0; const failures = [];
      for (const sample of samples) for (const range of [400, 1450, 2200]) for (const polar of [.35, 1.05, 1.4]) {
        const [x, z] = sample.at;
        camera.position.set(x + range * Math.sin(polar) * .6, range * Math.cos(polar), z + range * Math.sin(polar) * .8);
        camera.lookAt(x, 0, z); camera.near = range / 100; camera.far = range + 2500; camera.updateProjectionMatrix();
        review.renderer.setRenderTarget(rt); review.renderer.render(scene, camera);
        review.renderer.readRenderTargetPixels(rt, 512, 512, 1, 1, pixel);
        const channel = {pavement: 2, roads: 0, grass: 1}[sample.kind];
        if (pixel[channel] < 250 || pixel[(channel + 1) % 3] > 5 || pixel[(channel + 2) % 3] > 5) failures.push({sample, range, polar, pixel: [...pixel]});
        checks++;
      }
      review.renderer.setRenderTarget(null); rt.dispose(); materials.forEach(m => m.dispose());
      review.renderer.render(review.scene, review.camera);
      return {checks, failures, minHeight: levels.reduce((a, v) => Math.min(a, v), Infinity), maxHeight: levels.reduce((a, v) => Math.max(a, v), -Infinity)};
    }, samples);
    assert.deepEqual(groundCheck.failures, []);
    assert.equal(groundCheck.minHeight, 0); assert.equal(groundCheck.maxHeight, 0);
    await page.reload(); await page.waitForFunction(() => window.reviewReady, {timeout: 45000});
    const second = await measure();
    assert.deepEqual(first.textures, second.textures);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    const report = {...first, groundCheck, errors, external, offline: true, deterministicTextures: true, gameplayValidated: false};
    fs.writeFileSync(path.join(out, 'viewer-check.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
