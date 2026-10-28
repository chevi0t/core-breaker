// node tools/test/boost_ignition_check.js before after output
// 実際のphysicsによる装置ON×ブースト、旧巡航uniform、点火寿命と描画を検証。
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const [before,after,out]=process.argv.slice(2).map(p=>path.resolve(p));fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const snapshots=[];let page;
  for(const dir of [before,after]){
   page=await browser.newPage({viewport:{width:1800,height:1080}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
   await page.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=undefined});
   await page.route('https://**/*',r=>r.fulfill({body:'',contentType:'text/css'}));
   await page.goto('file://'+path.join(dir,'dbg.html'));
   snapshots.push(await page.evaluate(()=>{
    const g=__g,T=g.T;window.testErrors=[];
    window.unit=(key='standard')=>{const cfg=Object.fromEntries(['head','body','arms','legs'].map(s=>[s,key])),m=g.buildMech(g.TEAM.B.color,{...cfg,color:'ash'});return {...m,group:m.g,pos:new T.Vector3(),vel:new T.Vector3(0,0,-8),alive:true,onGround:true,yaw:0,pitch:0,isPlayer:true,recoil:0,cannonDeploy:0,slots:Object.fromEntries(g.SLOTS.map(s=>[s,g.slotOf(g.loadout.assault[s])])),weapon:'main',mech:cfg,boost:100,maxBoost:100,boostVisualDir:new T.Vector3(0,0,-1)};};
    const rows=[];
    for(const key of ['standard','skimmer','wisp','anchor'])for(const far of [0,200,400]){
     const u=unit(key);u.isPlayer=false;g.camera.position.set(far,0,0);
     u.dashState='long';u.longDash=true;u.dashT=0;
     for(let i=0;i<60;i++){
      g.weaponLook(u,1/60);g.boosterFlameUpdate(u,1/60);const U=u.flame.material.uniforms;
      rows.push({key,far,i,length:U.length.value,power:U.power.value,pulse:U.pulse.value,weights:U.weights.value.toArray(),axes:U.axes.value.map(a=>a.toArray()),origins:U.origins.value.map(a=>a.toArray()),visible:u.flame.visible,rear:u.hoverJet?.userData.rearPower.value||0});
      if(U.ignitionScale){const scale=U.ignitionScale.value;if(i===0&&(scale.x>=1||scale.y<=1))throw Error('点火拡大なし');if(i>=14&&(scale.x!==1||scale.y!==1))throw Error('巡航へ戻らない');}
     }
     g.disposeMech(u.group);
    }return rows;
   }));
   if(dir===before){assert.deepEqual(errors,[]);await page.close();continue;}
   assert.deepEqual(snapshots[1],snapshots[0],'旧巡航寸法・通常方向・ホバー後方連動を保持');
   const result=await page.evaluate(()=>{
    const g=__g,T=g.T;let checks=0;const ok=(v,msg)=>{if(!v)throw Error(msg);checks++};
    const u=unit();u.dashState='short';u.dashT=.2;g.resetBoosterFlame(u);g.boosterFlameUpdate(u,1/60);
    ok(u.flame.material.uniforms.ignitionScale.value.x===.44999999999999996&&u.flame.material.uniforms.ignitionScale.value.y===2.2,'最初は短く太い');
    for(let i=0;i<20;i++){u.dashT-=1/60;g.boosterFlameUpdate(u,1/60);}
    u.dashState='long';g.boosterFlameUpdate(u,1/60);ok(u.flame.material.uniforms.ignitionScale.value.x===1,'保持巡航で再点火なし');
    u.dashState='';g.boosterFlameUpdate(u,1/60);u.dashState='short';u.dashT=.2;g.boosterFlameUpdate(u,1/60);ok(u.flame.material.uniforms.ignitionScale.value.x<1,'再始動で点火');
    u.dashT=.05;g.boosterFlameUpdate(u,.02);u.dashT=.2;g.boosterFlameUpdate(u,.02);ok(u.flame.userData.boostFx.burst===.22,'連続短ダッシュの新始動');
    const triangles=u.flame.geometry.attributes.position.count/3;ok(triangles===992,'1メッシュ992三角形');g.disposeMech(u.group);
    g.selectMap('dock');document.getElementById('start').click();g.running=false;
    const p=g.player,types=Object.keys(g.WEAPONS).filter(k=>g.WEAPONS[k].type==='charger');
    function setup(key,device,kind){Object.assign(g.mechCfg,Object.fromEntries(['head','body','arms','legs'].map(s=>[s,kind])));g.spawn(p);p.slots.sp=g.slotOf(key);Object.assign(p,{chargerOn:device,charging:false,alive:true,onGround:true,stun:'',downT:0,boost:100,overheat:false,zip:null,transfer:null,repairing:false,recoverT:0,ctrlLockT:0,yaw:0,pitch:0,dashT:0,longDash:false,lungeT:0,planted:false});p.pos.set(0,200,0);p.vel.set(0,0,0);}
    function step(wish,held){g.physics(p,wish,held,false,1/60);g.weaponLook(p,1/60);g.boosterFlameUpdate(p,1/60);return p.flame.material.uniforms.devicePower.value;}
    const states=[];
    for(const key of types)for(const kind of ['standard','wisp','anchor'])for(const device of [false,true])for(const use of [false,true])for(const walking of [false,true]){
     setup(key,device,kind);const dir=new T.Vector3(walking?1:0,0,-1).normalize();
     if(use)g.shortDash(p,dir);const power=step(walking||use?dir:new T.Vector3(),use);
     ok(power===(device&&use?1:0),key+'/'+kind+'/matrix/'+device+'/'+use+'/'+walking);
     states.push({key,kind,device,use,walking,power,mode:p.dashState});
     if(device&&use){
      p.dashT=0;ok(step(dir,true)===1&&p.dashState==='charge','実加速');
      ok(step(dir,false)===0,'ブースト終了で装置ONでも即停止');
      ok(p.chargerOn,'装置はONを保持');
      step(dir,true);p.chargerOn=false;ok(step(dir,true)===0,'装置OFF');
      p.chargerOn=true;p.slots.sp.heat=.001;step(dir,true);ok(p.flame.material.uniforms.devicePower.value===0,'SP枯渇');
     }
    }
    setup(types[0],true,'skimmer');p.onGround=false;p.dashState='hover';p.charging=false;g.boosterFlameUpdate(p,.016);ok(p.flame.material.uniforms.devicePower.value===1,'装置ONの滞空ブースト');
    p.boost=0;g.boosterFlameUpdate(p,.016);ok(p.flame.material.uniforms.devicePower.value===0,'滞空燃料切れ');
    for(const field of ['downT','repairing','transfer','planted']){setup(types[0],true,'standard');step(new T.Vector3(0,0,-1),true);p[field]=true;g.boosterFlameUpdate(p,.016);ok(p.flame.material.uniforms.devicePower.value===0,'無効化 '+field);}
    setup(types[0],true,'standard');step(new T.Vector3(0,0,-1),true);p.alive=false;g.boosterFlameUpdate(p,.016);ok(!p.flame.visible&&p.flame.material.uniforms.devicePower.value===0,'死亡');
    g.spawn(p);ok(p.flame.material.uniforms.devicePower.value===0,'再出撃');
    setup(types[0],true,'standard');p.vel.set(0,0,-100);p.dashState='';g.boosterFlameUpdate(p,.016);ok(p.flame.material.uniforms.devicePower.value===0,'速度だけでは点火しない');
    p.dashState='lunge';g.boosterFlameUpdate(p,.016);ok(p.flame.material.uniforms.devicePower.value===0,'格闘踏み込みはブースト扱いしない');
    const render=new T.WebGLRenderer({antialias:false});render.setSize(320,240);
    const scene=new T.Scene(),cam=new T.PerspectiveCamera(50,4/3,.1,1000);cam.position.set(12,6,12);cam.lookAt(0,2,2);
    const v=unit();scene.add(v.flame);v.dashState='short';v.dashT=.2;v.chargerOn=true;v.isPlayer=false;
    const distanceChecks=[];
    for(const distance of [10,200,400]){g.camera.position.set(distance,0,0);g.boosterFlameUpdate(v,1/60);render.render(scene,cam);const calls=render.info.render.calls;ok(calls===(distance<350?1:0),'距離の描画呼出 '+distance);ok(v.flame.material.uniforms.devicePower.value===1,'距離で状態を取り違えない');distanceChecks.push({distance,calls});}
    render.dispose();g.disposeMech(v.group);
    return {checks,states,types,triangles,cruiseFrames:720,distanceChecks};
   });
   await page.evaluate(()=>{
    const g=__g,T=g.T;document.body.insertAdjacentHTML('beforeend','<canvas id="fxReview" style="position:fixed;inset:0;z-index:10000"></canvas>');
    const ren=new T.WebGLRenderer({canvas:document.getElementById('fxReview'),antialias:true,preserveDrawingBuffer:true});ren.setSize(1800,1080);ren.setScissorTest(true);
    const labels=['通常点火 / 0.03秒','通常巡航 / 0.60秒','装置ON＋ブースト / 0.60秒'];
    for(let i=0;i<6;i++){
     const c=i%3,u=unit(i<3?'standard':'skimmer');u.dashState=c===2?'charge':'long';u.longDash=true;u.dashT=0;u.chargerOn=u.charging=c===2;g.camera.position.set(10,5,10);
     for(let f=0;f<(c===0?3:37);f++){g.weaponLook(u,1/60);g.boosterFlameUpdate(u,1/60);}
     const sc=new T.Scene();sc.background=new T.Color(0x12202e);sc.add(u.group,new T.HemisphereLight(0xe1f3ff,0x344657,1.2));const l=new T.DirectionalLight(0xffffff,.9);l.position.set(-3,7,5);sc.add(l,new T.GridHelper(24,24,0x506777,0x263d4b));
     const camera=new T.PerspectiveCamera(43,600/540,.1,100);camera.position.set(13,6,11);camera.lookAt(0,2,2.4);
     const x=c*600,y=i<3?540:0;ren.setViewport(x,y,600,540);ren.setScissor(x,y,600,540);ren.render(sc,camera);
     const label=document.createElement('div');label.textContent=(i<3?'二脚：':'ホバー：')+labels[c];label.style=`position:fixed;z-index:10001;left:${x+15}px;top:${i<3?16:556}px;color:white;font:22px sans-serif`;document.body.appendChild(label);g.disposeMech(u.group);
    }
   });
   await page.screenshot({path:path.join(out,'start-cruise-device.png')});
   await page.evaluate(()=>{
    const g=__g,T=g.T;document.querySelectorAll('body > div').forEach(e=>{if(e.style.zIndex==='10001')e.remove()});
    const canvas=document.createElement('canvas');canvas.style='position:fixed;inset:0;z-index:10002';document.body.appendChild(canvas);
    const r=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});r.setSize(1800,1080);r.setScissorTest(true);
    for(let i=0;i<3;i++){
     const u=unit();u.dashState='long';u.dashT=0;
     for(let f=0;f<([3,8,37][i]);f++){g.weaponLook(u,1/60);g.boosterFlameUpdate(u,1/60);}
     const sc=new T.Scene();sc.background=new T.Color(0x12202e);sc.add(u.group,new T.HemisphereLight(0xe1f3ff,0x344657,1.2));
     const l=new T.DirectionalLight(0xffffff,.9);l.position.set(-3,7,5);sc.add(l,new T.GridHelper(20,20,0x506777,0x263d4b));
     const cam=new T.PerspectiveCamera(43,600/1080,.1,100);cam.position.set(9,4.5,9);cam.lookAt(0,2,1);r.setViewport(i*600,0,600,1080);r.setScissor(i*600,0,600,1080);r.render(sc,cam);
     const label=document.createElement('div');label.textContent=['点火 0.03秒：太く短い','移行 0.12秒','巡航 0.60秒：従来のまま'][i];label.style=`position:fixed;z-index:10003;left:${i*600+18}px;top:25px;color:white;font:23px sans-serif`;document.body.appendChild(label);g.disposeMech(u.group);
    }
   });
   await page.screenshot({path:path.join(out,'normal-start-cruise-close.png')});
   await page.evaluate(()=>{
    const g=__g,T=g.T;document.querySelectorAll('body > div').forEach(e=>{if(e.style.zIndex==='10003')e.remove()});
    const canvas=document.createElement('canvas');canvas.style='position:fixed;inset:0;z-index:10004';document.body.appendChild(canvas);
    const r=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});r.setSize(1800,1080);r.setScissorTest(true);
    for(let i=0;i<2;i++){
     const u=unit();u.dashState='short';u.dashT=.3;
     for(let f=0;f<6;f++){u.dashT-=1/60;g.weaponLook(u,1/60);g.boosterFlameUpdate(u,1/60);}
     // リングの半径式だけを旧値へ戻して同じ時刻・炎・カメラで比較する。
     if(!i)u.flame.material.vertexShader=u.flame.material.vertexShader.replace('1.3 * (.14 + pulse * 1.5)','(.14 + pulse * 1.5)');
     const sc=new T.Scene();sc.background=new T.Color(0x12202e);sc.add(u.group,new T.HemisphereLight(0xe1f3ff,0x344657,1.2));const l=new T.DirectionalLight(0xffffff,.9);l.position.set(-3,7,5);sc.add(l);
     const cam=new T.PerspectiveCamera(38,900/1080,.1,100);cam.position.set(6,3.5,6);cam.lookAt(.5,2,1);r.setViewport(i*900,0,900,1080);r.setScissor(i*900,0,900,1080);r.render(sc,cam);
     const label=document.createElement('div');label.textContent=i?'点火リング：半径1.30倍':'点火リング：従来の半径';label.style=`position:fixed;z-index:10005;left:${i*900+25}px;top:25px;color:white;font:28px sans-serif`;document.body.appendChild(label);g.disposeMech(u.group);
    }
   });
   await page.screenshot({path:path.join(out,'ring-before-after.png')});assert.deepEqual(errors,[]);
   fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,errors},null,2));console.log(JSON.stringify({checks:result.checks,deviceTypes:result.types,triangles:result.triangles,cruiseFrames:result.cruiseFrames,errors}));
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
