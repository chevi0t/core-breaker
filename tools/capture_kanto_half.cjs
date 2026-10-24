// 半縮尺の街と対戦施設を、ゲーム本体の実描画から俯瞰画像として保存する。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url'), {chromium} = require('playwright');
const folder = path.resolve(process.argv[2] || 'mapdesign/kanto_half');

(async () => {
  const browser = await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try {
    const page = await browser.newPage({offline:true,viewport:{width:1600,height:1600}});
    const errors = [], external = [];
    page.on('pageerror',e => { errors.push(e.stack || String(e)); console.error(e.stack); });
    page.on('console',m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request',r => { if (/^https?:/.test(r.url())) external.push(r.url()); });
    await page.addInitScript(() => { requestAnimationFrame = () => 0; AudioContext = undefined; });
    await page.goto(pathToFileURL(path.join(folder,'play.html')).href);
    await page.waitForFunction(() => window.__cityBattle,null,{timeout:60000,polling:100});
    const report = await page.evaluate(() => {
      const g = __cityBattle, T = g.T;
      g.setup(); g.running = false;
      for (const u of g.units) { u.invulT = 0; u.group.visible = true; }
      g.loop(performance.now()+16);
      // 高空からでも実際の配色を読めるよう、撮影ページ内だけ遠景の霧を外す。
      g.scene.fog = null;
      for (const child of document.body.children) {
        if (!child.contains(g.renderer.domElement)) child.style.visibility = 'hidden';
      }
      const half = g.curMap.size[0], framing = half+20;
      g.renderer.setPixelRatio(1); g.renderer.setSize(1600,1600,false);
      const camera = new T.OrthographicCamera(-framing,framing,framing,-framing,.1,1600);
      camera.position.set(0,800,0); camera.up.set(0,0,-1); camera.lookAt(0,0,0);
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      g.scene.updateMatrixWorld(true); g.renderer.render(g.scene,camera);
      if (getComputedStyle(g.renderer.domElement).visibility !== 'visible' || !g.renderer.info.render.triangles) {
        throw Error('俯瞰のゲーム描画が表示されていません');
      }
      const labels = document.createElement('div'); labels.id = 'kantoCaptureLabels';
      labels.style.cssText = 'position:fixed;inset:0;pointer-events:none;color:white;font-family:system-ui,sans-serif';
      const title = document.createElement('div');
      title.style.cssText = 'position:absolute;left:22px;top:18px;background:#102027ed;padding:12px 18px;border:1px solid #b7d5de;border-radius:6px;font-size:25px;line-height:1.5';
      title.textContent = '環都駅前 · 縮尺1/2　500m × 500m'; labels.append(title);
      const markers = [
        ...['B','R'].map(team => ({label:team==='B'?'青基地':'橙基地',at:g.city.base(team).at,color:team==='B'?'#40b4ff':'#ffa048',base:true})),
        ...g.plants.map(p => ({label:p.id,at:[p.pos.x,p.pos.z],color:'#f3f6f8',base:false}))
      ];
      for (const marker of markers) {
        const projected = new T.Vector3(marker.at[0],0,marker.at[1]).project(camera);
        const label = document.createElement('span'); label.textContent = marker.label;
        label.style.cssText = `position:absolute;left:${(projected.x+1)*800}px;top:${(1-projected.y)*800}px;transform:translate(-50%,-50%);font-size:${marker.base?25:31}px;font-weight:750;background:#102027e8;color:${marker.color};border:2px solid ${marker.color};border-radius:${marker.base?'7px':'50%'};padding:${marker.base?'6px 10px':'2px 12px'};line-height:1.35;text-shadow:0 1px 3px black`;
        labels.append(label);
      }
      const caption = document.createElement('div');
      caption.style.cssText = 'position:absolute;right:22px;bottom:18px;background:#102027ed;padding:9px 14px;border-radius:5px;font-size:19px';
      caption.textContent = '機体は4mのまま · 実寸の街に対して8m級相当'; labels.append(caption);
      document.body.append(labels);
      return {map:g.curMap.name,extentMeters:g.mapBounds.map(v=>v*2),mechHeightMeters:g.UNIT_H,
        plants:g.plants.map(p=>[p.id,p.pos.x,p.pos.z]),bases:['B','R'].map(team=>[team,...g.city.base(team).at]),
        lawnCount:g.city.district.lawns?.length||0,stationCanopy:!!g.city.district.stationCanopy,
        renderedTriangles:g.renderer.info.render.triangles,
        sceneSource:'本体のsceneを上空の正投影カメラで描画',captureOnlyChanges:['霧を非表示','HUDを施設ラベルに置換'],
        geometryOrPhysicsChanges:false};
    });
    assert.deepEqual(report.extentMeters,[500,500]);
    assert.equal(report.mechHeightMeters,4); assert.equal(report.plants.length,5);
    assert.equal(report.bases.length,2); assert(report.lawnCount>0); assert(report.stationCanopy);
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    await page.screenshot({path:path.join(folder,'overview.png')});
    // 実機の大きさを比べるため、駅前の通常TPS視点も同じHTMLから撮影する。
    await page.setViewportSize({width:1600,height:900});
    await page.reload();
    await page.waitForFunction(() => window.__cityBattle,null,{timeout:60000,polling:100});
    report.tps = await page.evaluate(() => {
      const g = __cityBattle, T = g.T; g.setup(); g.running = false;
      document.getElementById('overlay').hidden = true;
      const u = g.player, plant = g.plants.find(p => p.id === 'C');
      const at = plant.pos.clone().add(new T.Vector3(3,0,7));
      if (!g.battle.free(at.x,at.z,at.y,g.obstacles)) throw Error('TPS撮影位置が通行不能です');
      u.pos.copy(at); u.vel.set(0,0,0); u.invulT = 0;
      const roof = g.city.district.stationCanopy;
      const center = roof.ring.reduce((a,p) => [a[0]+p[0]/roof.ring.length,a[1]+p[1]/roof.ring.length],[0,0]);
      const dx = center[0]-at.x, dz = center[1]-at.z;
      u.yaw = Math.atan2(-dx,-dz); u.pitch = .16;
      g.updateCamera(u,1); g.loop(performance.now()+16);
      g.scene.updateMatrixWorld(true); g.renderView();
      return {at:u.pos.toArray(),camera:g.camera.position.toArray(),yaw:u.yaw,pitch:u.pitch,
        mechHeightMeters:g.UNIT_H,standardCamera:true,botsPaused:true};
    });
    await page.screenshot({path:path.join(folder,'tps.png')});
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    const htmlSHA256 = createHash('sha256').update(fs.readFileSync(path.join(folder,'play.html'))).digest('hex');
    fs.writeFileSync(path.join(folder,'capture-check.json'),JSON.stringify({...report,htmlSHA256,errors,externalRequests:external},null,2)+'\n');
    console.log('本体の俯瞰描画を保存: '+path.join(folder,'overview.png'));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack); process.exit(1); });
