// 通常HTMLのメニューだけで500m版を選び、都市切替・実描画・入力を検査する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),output=path.join(ROOT,'mapdesign/kanto_half');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async()=>{
  const source=fs.readFileSync(path.join(ROOT,'prototype/index.html'),'utf8');
  assert(/const R\s*=\s*1\.3,\s*UNIT_H\s*=\s*4\s*;/.test(source),'通常本体の機体は高さ4m・半径1.3m');
  const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'prototype/maps.js'),'utf8'),context);
  const maps=JSON.parse(JSON.stringify(context.window.MAP_DATA));
  assert.deepEqual(maps.kanto.size,[250,250]);assert.equal(maps.kanto.cityTerrain.district.facadeScale,.5);
  assert.equal(maps.hoshimichi.cityTerrain.district.facadeScale??1,1);
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const page=await browser.newPage({offline:true,viewport:{width:1440,height:1000}}),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(/^https?:/.test(r.url())&&!/fonts\.|cdnjs\.cloudflare\.com/.test(r.url()))external.push(r.url());});
    await page.route(/^https:\/\/fonts\./,r=>r.fulfill({contentType:'text/css',body:''}));
    const three=fs.readFileSync(path.join(ROOT,'vendor/three-r128/three.min.js'),'utf8');
    // WebGLRendererの引数と既存のuserDataだけ観測する。本体関数・debug getterは呼ばない。
    const observe=`\n(()=>{
      const Original=THREE.WebGLRenderer;
      THREE.WebGLRenderer=function(...args){
        const r=new Original(...args);if(r.domElement.id!=='view')return r;
        const render=r.render.bind(r);window.registrationView={renderer:r,compiled:new Map(),disposed:0};
        window.registrationView.draw=()=>render(registrationView.scene,registrationView.camera);
        r.render=(scene,camera)=>{
          const v=window.registrationView;v.scene=scene;v.camera=camera;
          scene.traverse(m=>{if(m.name==='city-bldg'&&!m.userData.registrationObserved){
            m.userData.registrationObserved=true;const compile=m.material.onBeforeCompile;
            m.material.onBeforeCompile=(shader,renderer)=>{compile.call(m.material,shader,renderer);v.compiled.set(m.material.id,shader.uniforms.cityFacadeScale?.value);};
          }});
          scene.updateMatrixWorld(true);
        };
        return r;
      };
      THREE.WebGLRenderer.prototype=Original.prototype;
    })();`;
    await page.route('**/three.min.js',r=>r.fulfill({contentType:'application/javascript',body:three+observe}));
    await page.addInitScript(()=>{AudioContext=undefined;localStorage.removeItem('coreBreakerMap');});
    await page.goto(pathToFileURL(path.join(ROOT,'prototype/index.html')).href);
    await page.waitForFunction(()=>window.registrationView?.scene,null,{timeout:60000});
    const switches=[];
    for(const id of ['city','kanto','hoshimichi','kanto','city','kanto']){
      await page.locator('button[data-page="pgMap"]').click();
      await page.locator(`#mapList button[data-map="${id}"]`).click();
      await page.waitForFunction(id=>localStorage.getItem('coreBreakerMap')===id,id);
      await page.evaluate(()=>registrationView.draw());
      if(id!=='city')await page.waitForFunction(id=>{const v=registrationView,m=v.scene.getObjectByName('city-bldg');return m&&v.compiled.get(m.material.id)===(MAP_DATA[id].cityTerrain.district.facadeScale??1);},id,{timeout:60000});
      const row=await page.evaluate(id=>{
        const v=registrationView,scene=v.scene,refs=new Set(),city=[],ferris=[];
        scene.updateMatrixWorld(true);
        scene.traverse(m=>{if(m.userData.ref?.kind==='turret')refs.add(m.userData.ref);if(m.name.startsWith('city-'))city.push(m);if(m.name==='city-ferris')ferris.push(m);});
        const prior=v.previousCity||[];if(prior.some(m=>m.parent))throw Error('前マップの描画形状が残る');
        for(const m of city)m.geometry.addEventListener('dispose',()=>{v.disposed++;});v.previousCity=city;
        const turrets=[...refs],rooftop=turrets.filter(t=>t.rooftop),building=city.find(m=>m.name==='city-bldg');
        const meshBounds={};for(const m of city.filter(m=>['city-dem','city-ferris'].includes(m.name))){m.geometry.computeBoundingBox();meshBounds[m.name]=[m.geometry.boundingBox.min.toArray(),m.geometry.boundingBox.max.toArray()];}
        const d=window.MAP_DATA[id];
        return {id,size:d.size,terrainHalf:d.cityTerrain?.half??null,cityMeshes:city.length,
          turrets:turrets.length,rooftop:rooftop.map(t=>({team:t.team,plant:t.rooftopPlant,at:t.pos.toArray()})),
          ferrisMeshes:ferris.length,ferrisTriangles:ferris[0]?(ferris[0].geometry.index?.count??ferris[0].geometry.attributes.position.count)/3:0,
          facadeScale:d.cityTerrain?.district.facadeScale??(d.cityTerrain?1:null),
          compiledFacadeScale:building?v.compiled.get(building.material.id):null,
          materialKey:building?.material.customProgramCacheKey()||null,disposed:v.disposed,meshBounds,
          debugHooks:window.__g!==undefined||window.__cityBattle!==undefined};
      },id);
      assert.equal(row.debugHooks,false);
      if(id==='kanto'){
        assert.deepEqual(row.size,[250,250]);assert.equal(row.terrainHalf,250);
        assert.equal(row.turrets,12);assert.equal(row.rooftop.length,4);assert.equal(row.ferrisMeshes,1);assert.equal(row.ferrisTriangles,1400);
        assert.equal(row.facadeScale,.5);assert.equal(row.compiledFacadeScale,.5);
        for(const [plant,team]of [['A','B'],['E','R']])assert.equal(row.rooftop.filter(t=>t.plant===plant&&t.team===team).length,2);
      }else{
        assert.equal(row.rooftop.length,0);assert.equal(row.ferrisMeshes,0);
        if(id==='hoshimichi'){assert.equal(row.facadeScale,1);assert.equal(row.compiledFacadeScale,1);}
        else assert.equal(row.cityMeshes,0);
      }
      switches.push(row);console.log('メニュー切替 '+id+'：砲台'+row.turrets+'・観覧車'+row.ferrisMeshes+'・窓縮尺'+row.compiledFacadeScale);
    }
    const visits=switches.filter(v=>v.id==='kanto');
    assert(visits.every(v=>v.cityMeshes===visits[0].cityMeshes&&v.turrets===12&&v.ferrisMeshes===1));
    assert(switches.at(-1).disposed>0,'切替時に都市の描画形状を破棄');
    const inputs=[];
    for(const team of ['B','R']){
      if(team==='R'){
        await page.reload();
        await page.locator('button[data-page="pgMap"]').click();
        await page.locator('#mapList button[data-map="kanto"]').click();
      }
      await page.locator(`input[name="team"][value="${team}"]`).check();
      await page.locator('#start').click();
      await page.waitForFunction(()=>{
        let u=null;registrationView.scene.traverse(m=>{if(m.userData.ref?.kind==='unit'&&m.userData.ref.isPlayer)u=m.userData.ref;});
        registrationView.player=u;return !!u;
      },null,{timeout:60000});
      const start=await page.evaluate(()=>registrationView.player.pos.toArray());
      await page.keyboard.down('KeyW');
      await page.waitForFunction(([x,,z])=>Math.hypot(registrationView.player.pos.x-x,registrationView.player.pos.z-z)>2,start,{timeout:30000});
      await page.keyboard.up('KeyW');
      const end=await page.evaluate(()=>registrationView.player.pos.toArray());
      await page.keyboard.press('KeyM');await page.waitForFunction(()=>!document.getElementById('bigMap').hidden,null,{timeout:30000});
      await page.keyboard.press('KeyM');
      await page.keyboard.press('F3');await page.waitForFunction(()=>!document.getElementById('pgOptions').hidden);
      await page.locator('#optionsResume').click();
      assert(await page.evaluate(()=>window.__g===undefined&&window.__cityBattle===undefined));
      inputs.push({team,start,end,walkedMeters:Math.hypot(end[0]-start[0],end[2]-start[2]),map:true,optionsResume:true,debugHooks:false});
    }
    await page.evaluate(()=>registrationView.draw());
    await page.screenshot({path:path.join(output,'registration-battle.png')});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    fs.writeFileSync(path.join(output,'registration-check.json'),JSON.stringify({
      source:'通常prototype/index.htmlを実メニューで選択。RendererとuserDataのみ観測',mechHeightMeters:4,
      switches,inputs,errors,externalGeographyRequests:external,
      offline:true,renderSchedule:'SwiftShaderの負荷を避け毎フレーム描画を抑止。マップ切替ごと・最終撮影時は通常Rendererで実描画。物理と入力は通常更新。',dependencyIntercepts:['既存Three.js CDNをローカル同版で応答','Google Fontsを空CSSで応答'],
      sourceHashes:Object.fromEntries(['prototype/index.html','prototype/maps/kanto.js','prototype/maps.js'].map(f=>[f,digest(path.join(ROOT,f))]))
    },null,2)+'\n');
    console.log('通常メニューの500m版選択・都市切替・観覧車/屋上砲台の破棄・窓縮尺・両軍実入力を確認');
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
