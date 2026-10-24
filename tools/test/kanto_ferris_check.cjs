// 屋上の赤箱を置き換えた観覧車の描画・射線・歩行・再組立てを確かめる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const folder=path.resolve(process.argv[2]||'mapdesign/kanto_half');

(async()=>{
  const html=fs.readFileSync(path.join(folder,'play.html'),'utf8');let scripts=0;
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
    new vm.Script(match[1],{filename:'inline-'+(++scripts)+'.js'});
  }
  assert(scripts>0,'検査するスクリプトがある');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const page=await browser.newPage({offline:true,viewport:{width:1600,height:1000}});
    const errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
    await page.goto(pathToFileURL(path.join(folder,'play.html')).href);
    await page.waitForFunction(()=>window.__cityBattle,null,{polling:100,timeout:60000});
    const report=await page.evaluate(()=>{
      const g=__cityBattle,T=g.T,ok=(v,m,d)=>{if(!v)throw Error(m+' '+JSON.stringify(d));};
      g.setup();g.running=false;g.scene.updateMatrixWorld(true);
      const wheel=g.city.district.ferrisWheel,C=new T.Vector3(...wheel.center);
      const H=new T.Vector3(Math.cos(wheel.yaw),0,Math.sin(wheel.yaw));
      const N=new T.Vector3(-Math.sin(wheel.yaw),0,Math.cos(wheel.yaw));
      const triangles=g.city.arrays.ferris.length/9;
      ok(triangles>0&&triangles<=1500,'観覧車は1500三角形以内',triangles);
      ok(!g.city.volumes.some(v=>v.landmarkColor==='#bf3548'&&v.top>wheel.roofY&&g.city.contact(v,C.x,C.z).inside),
        '旧赤箱の衝突体積を除去');
      ok(g.city.volumes.some(v=>v.top===27&&g.city.contact(v,C.x,C.z).inside),'観覧車の下の高さ27mの屋根を保持');
      const models=g.mapRoot.children.filter(m=>m.name==='city-ferris');
      ok(models.length===1,'描画は1メッシュ',models.length);
      const colliders=g.hittables.filter(m=>m.name==='city-collision-ferris');
      ok(colliders.length>0,'描画面に対応する射線判定がある');
      const ray=new T.Raycaster(),rays=[];
      const hole=C.clone().addScaledVector(H,7*Math.cos(Math.PI/8));hole.y+=7*Math.sin(Math.PI/8);
      const rim=C.clone().addScaledVector(H,wheel.radius);
      for(const sign of [-1,1])for(const [name,point,expected]of [['スポーク間の空洞',hole,false],['赤い外輪',rim,true]]){
        const from=point.clone().addScaledVector(N,10*sign);
        ray.set(from,N.clone().multiplyScalar(-sign));ray.near=0;ray.far=20;
        const drawn=ray.intersectObject(models[0],false),collision=ray.intersectObjects(colliders,false);
        const all=ray.intersectObjects(g.hittables,false);
        ok(Boolean(drawn.length)===expected&&Boolean(collision.length)===expected,
          '輪の見た目と射線が一致',{name,sign,drawn:drawn.length,collision:collision.length});
        if(!expected)ok(!all.length,'輪の穴に旧箱などの不可視壁がない',all.map(h=>h.object.name));
        rays.push({name,sign,at:point.toArray(),drawnHits:drawn.length,collisionHits:collision.length,allHits:all.length});
      }
      const walks=[];
      // 低いゴンドラ・脚は実物に沿って当たる。屋根の脇から旧箱の左右の壁を横切る。
      for(const sign of [-1,1]){
        const u=g.player;u.mech={head:'heavy',body:'heavy',arms:'heavy',legs:'heavy',color:'team'};
        g.equip(u,'assault');g.spawn(u,'base');
        const start=C.clone().addScaledVector(H,sign*9).addScaledVector(N,2.1).setY(27);
        u.pos.copy(start);u.vel.set(0,0,0);
        Object.assign(u,{onGround:true,flying:false,repairing:false,stun:'',stunT:0,ctrlLockT:0,
          dashT:0,lungeT:0,recoverT:0,charging:false,jumpPad:null,transfer:null});
        const wish=H.clone().multiplyScalar(-sign);let reached=false,elapsed=0;
        for(;elapsed<3;elapsed+=1/120){
          g.physics(u,wish,false,false,1/120);
          const p=u.pos.clone().sub(C),along=p.dot(H)*sign,side=p.dot(N);
          ok(Math.abs(u.pos.y-27)<.15,'屋根から落ちずに歩く',u.pos.toArray());
          if(along<=6.5){reached=true;break;}
          ok(Math.abs(side-2.1)<.3,'旧箱付近で不可視壁に押し戻されない',{along,side});
        }
        ok(reached,'可視の脚・ゴンドラの脇で旧箱の範囲へ歩ける',{sign,at:u.pos.toArray()});
        walks.push({sign,from:start.toArray(),to:u.pos.toArray(),seconds:elapsed});
      }
      const count=()=>{
        const geometries=new Set();g.mapRoot.traverse(m=>{if(m.geometry)geometries.add(m.geometry);});
        return {mapGeometries:geometries.size,renderMeshes:g.mapRoot.children.filter(m=>m.name==='city-ferris').length,
          collisionMeshes:g.hittables.filter(m=>m.name==='city-collision-ferris').length,
          cameraGeometry:g.city.cameraGeometryCount,triangles:g.city.arrays.ferris.length/9};
      };
      const rebuilds=[count()];for(let i=0;i<2;i++){g.setup();g.running=false;g.scene.updateMatrixWorld(true);rebuilds.push(count());}
      ok(rebuilds.every(s=>JSON.stringify(s)===JSON.stringify(rebuilds[0])),'再試合でマップ形状・観覧車を増殖しない',rebuilds);

      // 部品を置き換えず、本体の描画を正面斜め上から撮る。
      for(const u of g.units)u.group.visible=false;g.scene.fog=null;
      for(const el of document.querySelectorAll('body *'))if(el!==g.renderer.domElement&&!el.contains(g.renderer.domElement))el.style.visibility='hidden';
      g.renderer.setPixelRatio(1);g.renderer.setSize(1600,1000,false);
      const camera=new T.PerspectiveCamera(48,1.6,.1,1000);
      camera.position.copy(C).addScaledVector(N,38).addScaledVector(H,12).add(new T.Vector3(0,18,0));
      camera.lookAt(C.clone().add(new T.Vector3(0,-3,0)));camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
      g.scene.updateMatrixWorld(true);g.renderer.render(g.scene,camera);
      const caption=document.createElement('div');
      caption.style.cssText='position:fixed;left:22px;bottom:20px;color:#f3f6f8;background:#102027df;border:1px solid #b8c6cc;border-radius:5px;padding:9px 14px;font:22px system-ui,sans-serif';
      caption.textContent='屋上の赤い観覧車 · 輪／スポーク／ゴンドラ';document.body.append(caption);
      return {wheel,triangles,renderMeshes:models.length,collisionMeshes:colliders.length,rays,walks,rebuilds,
        capture:{position:camera.position.toArray(),target:C.clone().add(new T.Vector3(0,-3,0)).toArray(),captureOnlyChanges:['霧・HUD・機体を非表示']}};
    });
    await page.screenshot({path:path.join(folder,'ferris.png')});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const htmlSHA256=createHash('sha256').update(html).digest('hex');
    fs.writeFileSync(path.join(folder,'ferris-check.json'),JSON.stringify({...report,inlineScriptsParsed:scripts,htmlSHA256,offline:true,errors,externalRequests:external},null,2)+'\n');
    console.log('観覧車の形状・射線・屋根上の歩行・再試合を確認: '+report.triangles+'三角形');
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
