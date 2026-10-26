// 熱球の共有描画・占拠表示・コアの射線/塔・Mとサイズ選択の実入力を確かめる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 const out=path.resolve(process.argv[3]||'/tmp/battlefield-results');fs.mkdirSync(out,{recursive:true});
 try{
  const p=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await p.goto('file://'+path.resolve(process.argv[2]||'dbg/battlefield','dbg.html'));
  const checks=await p.evaluate(()=>{
   const g=__g,T=g.T,checks=[],yes=(v,s)=>{if(!v)throw Error(s);checks.push(s);};
   g.selectMap('city');document.getElementById('start').click();g.running=true;
   for(const u of g.units){u.alive=false;u.group.visible=false;u.frozen=true;}
   const u=g.player,e=g.units.find(v=>v.team!==u.team),spec=g.WEAPONS.flare.proj,at=new T.Vector3(0,200,0);
   let consumed=0;const random=Math.random;Math.random=()=>{consumed++;return random();};
   try{g.secondaryBurst({owner:u,team:u.team,spec},at);g.secondaryUpdate(.1);}finally{Math.random=random;}
   yes(consumed===0,'熱球の生成・更新で戦闘用乱数を消費しない');
   const h=g.heatFields[0];yes(h.mesh.material.isShaderMaterial&&h.mesh.children.length===2,'炎の球面・流れる環・火の粉の3描画を持つ');
   yes(h.mesh.scale.x===spec.blast&&h.pos.equals(at),'熱球の描画半径と爆心は武器値に一致');
   yes(Math.abs(h.life-(spec.heatDur-.1))<1e-6&&h.mesh.material.uniforms.time.value===.1,'持続時間を保って描画だけ更新');
   const ids=[];h.mesh.traverse(m=>{if(m.geometry)ids.push(m.geometry.uuid);});
   let disposed=0;h.mesh.traverse(m=>m.material?.addEventListener('dispose',()=>disposed++));
   g.secondaryUpdate(spec.heatDur);yes(g.heatFields.length===0&&disposed===3&&!h.mesh.parent,'寿命で3マテリアルを解放し場面から除去');
   g.secondaryBurst({owner:u,team:u.team,spec},at);const n=g.heatFields[0],next=[];n.mesh.traverse(m=>{if(m.geometry)next.push(m.geometry.uuid);});
   yes(JSON.stringify(ids)===JSON.stringify(next),'繰り返し発生時に形状3個を共有');g.clearSecondaryEffects();
   const pl=g.plants[0],y=pl.pos.y;
   yes(pl.group.children.length===3&&pl.beacon.geometry.attributes.position.count>300,'プラントは統合構造・発光装飾・ゲージで描画');
   const pole=g.hittables.find(m=>m.geometry.type==='CylinderGeometry'&&m.position.distanceTo(pl.pos.clone().add(new T.Vector3(0,3.5,0)))<.01);
   yes(!!pole&&pole.geometry.parameters.radiusBottom===.7,'プラント中央の既存衝突を維持');
   g.scene.updateMatrixWorld(true);
   const poleHit=g.castFrom(pl.pos.clone().add(new T.Vector3(5,3.5,0)),new T.Vector3(-1,0,0),u,10);yes(poleHit&&poleHit.dist>4.2&&poleHit.dist<4.6,'新外観でも従来の中央支柱が弾を止める');
   yes(!g.hittables.includes(pl.beacon)&&!g.hittables.includes(pl.group.children[0]),'追加したプラント装飾は射線を塞がない');
   pl.owner=null;pl.gauge=0;g.paintPlant(pl);
   u.alive=true;u.pos.copy(pl.pos);g.plantUpdate(pl,5);g.plantVisualTick(pl,1);
   yes(pl.gauge===50&&!pl.owner&&pl.progress.geometry.drawRange.count===192,'1機5秒で50%・進行に合わせた発光ゲージ');
   g.plantUpdate(pl,5);yes(pl.owner===u.team&&pl.gauge===100,'従来どおり1機10秒で制圧');
   yes(pl.beacon.material.color.getHex()===g.TEAM[u.team].color,'プラントの所有色を装飾全体へ反映');
   const before=pl.beacon.material.opacity;pl.capturing=false;pl.contested=true;g.plantVisualTick(pl,.1);
   yes(pl.beacon.material.opacity!==before,'争奪時に発光を変える');
   u.pos.copy(pl.pos).add(new T.Vector3(g.PLANT_R+.1,0,0));g.plantUpdate(pl,5);yes(pl.gauge===100,'範囲16mを広げない');u.alive=false;
   const core=g.cores.R,floor=core.pos.y-19;
   yes(core.tower&&g.cores.B.tower,'両軍のコアに同じ目印塔を作る');
   const bounds=new T.Box3().setFromObject(core.tower);yes(Math.abs(bounds.max.y-floor-84)<.01,'塔の頂上は基地床から84m');
   g.scene.updateMatrixWorld(true);
   const from=new T.Vector3(core.pos.x+35,floor+3,core.pos.z),aim=core.pos.clone(),dir=aim.clone().sub(from);
   const hit=g.castFrom(from,dir.clone().normalize(),u,dir.length()+10);
   yes(hit?.ref===core,'屋根下から結晶へ届く既存の射線を維持');
   const hp=core.hp;g.fire(u,aim,0,{...g.WEAPONS.ar,dmg:100},from);yes(core.hp<hp,'屋根下から結晶への実弾はコアを損傷');
   const high=new T.Vector3(core.pos.x+20,floor+50,core.pos.z),top=new T.Vector3(core.pos.x,floor+50,core.pos.z);
   const beforeHp=core.hp;g.fire(u,top,0,g.WEAPONS.ar,high);yes(core.hp===beforeHp,'塔への射撃はコアHPを減らさない');
   const towerHit=g.castFrom(high,new T.Vector3(-1,0,0),u,30);yes(towerHit?.ref?.kind==='umbrella','塔は屋根と同じ射線障害物');
   u.pos.set(core.pos.x+3.5,floor+45,core.pos.z);g.resolve(u);yes(u.pos.x>core.pos.x+3.6,'塔の側面で機体がすり抜けない');
   u.pos.set(core.pos.x+3.5,floor+17,core.pos.z);g.resolve(u);yes(Math.abs(u.pos.x-core.pos.x-3.5)<1e-6,'塔の衝突を屋根下へ伸ばさない');
   let cleanup=0;pl.beacon.material.addEventListener('dispose',()=>cleanup++);core.tower.children[0].material.addEventListener('dispose',()=>cleanup++);
   g.buildMap('dock');yes(cleanup===2,'マップ変更で施設の専用マテリアルを解放');
   yes(!g.cores.B.tower&&!g.cores.R.tower,'コアのないアリーナには塔を置かない');
   for(const [id,map]of Object.entries(g.MAPS)){
    g.buildMap(id);g.scene.updateMatrixWorld(true);
    if(map.vs)yes(!g.cores.B.tower&&!g.cores.R.tower,id+'：コアなしのルールで塔を出さない');
    else yes(['B','R'].every(t=>Math.abs(new T.Box3().setFromObject(g.cores[t].tower).max.y-(g.cores[t].pos.y-19)-84)<.01),id+'：両軍の基地高さへ塔を追従');
   }
   g.buildMap('dock');return checks;
  });
  // Mで開き、実際のサイズボタンをクリック。選択は開閉後も維持する。
  await p.evaluate(()=>{__g.setup();__g.running=true;document.getElementById('overlay').hidden=true;});
  await p.keyboard.press('KeyM');assert(await p.locator('#bigMap').isVisible());checks.push('Mで全体マップを開く');
  let previous=0;
  for(const size of ['medium','large','maximum']){
   await p.locator('[data-map-size="'+size+'"]').click();
   const r=await p.locator('#bigMapC').boundingBox();assert(r.width*r.height>previous);previous=r.width*r.height;
   assert.equal(await p.locator('[data-map-size="'+size+'"]').getAttribute('aria-pressed'),'true');checks.push(size+'を実クリックで選択して拡大');
  }
  await p.keyboard.press('KeyM');assert(await p.locator('#bigMap').isHidden());await p.keyboard.press('KeyM');assert.equal(await p.evaluate(()=>__g.bigMapSize),'maximum');checks.push('Mで閉じて開いても選択を維持');
  for(const viewport of [{width:800,height:600},{width:360,height:640},{width:1280,height:800}]){
   await p.setViewportSize(viewport);await p.evaluate(()=>__g.drawBigMap());const r=await p.locator('#bigMap').boundingBox();
   assert(r.x>=-1&&r.y>=-1&&r.x+r.width<=viewport.width+1&&r.y+r.height<=viewport.height+1);checks.push(viewport.width+'×'+viewport.height+'で全体マップが画面内に収まる');
  }
  const canvas=await p.locator('#bigMapC').boundingBox();await p.locator('#bigMapC').click({position:{x:canvas.width*.7,y:canvas.height*.4}});
  const pos=await p.evaluate(()=>({...__g.mapCur,size:__g.curMap.size}));assert(Math.abs(pos.x-pos.size[0]*.4)<1&&Math.abs(pos.z+pos.size[1]*.2)<1);checks.push('拡大後も全体マップを実クリックし、正しい地図座標を指す');
  await p.evaluate(()=>document.getElementById('announce').replaceChildren());
  await p.screenshot({path:path.join(out,'map-maximum.png')});
  await p.keyboard.press('KeyM');await p.evaluate(()=>{
   const g=__g,T=g.T;g.selectMap('city');g.setup();g.running=false;
   for(const u of g.units){u.alive=false;u.group.visible=false;}
   document.getElementById('overlay').hidden=true;
   const pl=g.plants[0];pl.owner='B';pl.gauge=75;g.paintPlant(pl);g.plantVisualTick(pl,1);
   g.camera.position.copy(pl.pos).add(new T.Vector3(23,16,28));g.camera.lookAt(pl.pos.clone().add(new T.Vector3(0,4,0)));g.renderer.render(g.scene,g.camera);
  });
  const view=await p.evaluateHandle(()=>__g.renderer.domElement);await p.evaluate(()=>__g.renderer.domElement.id='visualFixture');await p.addStyleTag({content:'body *{visibility:hidden!important}#visualFixture{visibility:visible!important}'});
  await view.asElement().screenshot({path:path.join(out,'plant.png')});
  await p.evaluate(()=>{const g=__g,T=g.T,c=g.cores.R;g.camera.position.copy(c.pos).add(new T.Vector3(65,30,85));g.camera.lookAt(c.pos.clone().add(new T.Vector3(0,27,0)));g.renderer.render(g.scene,g.camera);});
  await view.asElement().screenshot({path:path.join(out,'core-tower.png')});
  await p.evaluate(()=>{const g=__g,T=g.T,at=new T.Vector3(0,200,0);g.secondaryBurst({owner:g.player,team:g.player.team,spec:g.WEAPONS.flare.proj},at);g.secondaryUpdate(.3);g.camera.position.set(0,207,32);g.camera.lookAt(at);g.renderer.render(g.scene,g.camera);});
  await view.asElement().screenshot({path:path.join(out,'thermal.png')});
  await p.reload();await p.locator('#start').click();
  await p.waitForFunction(()=>document.pointerLockElement?.id==='view');
  await p.keyboard.press('KeyM');await p.waitForFunction(()=>!document.pointerLockElement);
  assert(await p.locator('#bigMap').isVisible());await p.locator('[data-map-size="large"]').click();
  await p.keyboard.press('KeyM');await p.waitForFunction(()=>document.pointerLockElement?.id==='view');
  assert(await p.locator('#bigMap').isHidden());checks.push('Mでマウスを解放してサイズを選び、Mで元のポインタロックへ復帰');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
