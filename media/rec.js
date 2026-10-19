const { chromium } = require('/opt/node-tools/node_modules/playwright');
const S = process.argv[2], FPS = 24, SECS = +process.argv[3] || 30;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + S + '/game/rec/index.html');
  await p.waitForTimeout(1500);
  await p.click('#start');
  await p.evaluate(() => { window.__auto = true; window.__t = 0; });
  for (let f = 0; f < FPS * SECS; f++) {
    const info = await p.evaluate(fps => {
      window.__t += 1000 / fps; window.__loop(window.__t);
      const pl = __dbg.player; if (pl.alive && pl.hp < 3600) pl.hp = 3600;
      return pl.weapon + ' ' + (pl.target ? pl.target.name : '-');
    }, FPS);
    await p.screenshot({ path: `${S}/frames/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
    if (f % FPS === 0) console.log(f / FPS, info, new Date().toISOString());
  }
  await b.close();
})();
