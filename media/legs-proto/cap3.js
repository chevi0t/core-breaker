// ゲームに入れた四脚・逆脚（#228）を、本体の buildMech と mechPose でそのまま描く（下描きの cap2.js と違い、差し込みの仕掛けは要らない）。
// python3 tools/test/make_dbg.py dbg && node media/legs-proto/cap3.js [dbgのフォルダ] [出力フォルダ]
//   → ingame-dozer-poses.png・ingame-dozer-mix.png・ingame-hopper-poses.png・ingame-hopper-mix.png
const path=require('node:path');let chromium;try{({chromium}=require('playwright'));}catch(_){({chromium}=require('/opt/node22/lib/node_modules/playwright'));}
const S=__dirname,dbg=path.resolve(process.argv[2]||'dbg'),out=path.resolve(process.argv[3]||S),W=1600,H=1200;
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
 await page.route('**cdn.jsdelivr.net/**',r=>r.fulfill({body:'',contentType:'text/javascript'}));
 await page.goto('file://'+path.join(dbg,'dbg.html'));
 await page.evaluate(({W,H})=>{
  const g=__g,T=g.T;g.running=false;g.renderer.render=()=>{};
  const sc=new T.Scene();sc.background=new T.Color(0x1b2c3a);sc.add(new T.HemisphereLight(0xf0f8ff,0x394455,1.15));
  const light=new T.DirectionalLight(0xffffff,1.1);light.position.set(-5,9,-7);sc.add(light);sc.add(new T.GridHelper(60,60,0x7f93a0,0x33495a));
  document.body.insertAdjacentHTML('beforeend','<canvas id="review" style="position:fixed;inset:0;z-index:10000"></canvas><div id="labels" style="position:fixed;inset:0;z-index:10001;color:white;font:18px sans-serif;text-shadow:0 0 6px #000,0 0 3px #000"></div>');
  const ren=new T.WebGLRenderer({canvas:document.getElementById('review'),antialias:true,preserveDrawingBuffer:true});ren.setSize(W,H);ren.setScissorTest(true);
  window.__review={sc,ren,us:[]};
 },{W,H});
 for(const [id,title,crouchName] of [['dozer','ドーザー（重量級の四脚）','踏ん張り'],['hopper','ホッパー（軽量級の逆脚）','溜め']])for(const mode of['poses','mix']){
  await page.evaluate(({id,title,crouchName,mode,W,H})=>{
   const g=__g,T=g.T,r=__review;for(const u of r.us){r.sc.remove(u.group);g.disposeMech(u.group);}r.us=[];
   const mk=(up,team,x,pose)=>{
    const cfg={head:up,body:up,arms:up,legs:id,color:'team'},m=g.buildMech(g.TEAM[team].color,cfg);
    const u={...m,group:m.g,mech:cfg,pos:new T.Vector3(x,0,0),vel:new T.Vector3(0,0,pose==='walk'?-6:0),alive:true,onGround:pose!=='air',yaw:0,pitch:0,isPlayer:true,recoil:0,cannonDeploy:0,slots:Object.fromEntries(g.SLOTS.map(s=>[s,g.slotOf(g.loadout.assault[s])])),weapon:'main',swing:null,planted:false,crouching:pose==='crouch',meleePose:{sink:0,lean:0,twist:0,stance:0}};
    r.sc.add(u.group);g.weaponLook(u,0);for(let f=0;f<30;f++)g.weaponLook(u,.05);
    Object.assign(u.rig,{move:pose==='walk'?1:0,phase:pose==='walk'?.9:0,crouch:pose==='crouch'?.6:0});g.mechPose(u,0);
    u.group.position.set(x,pose==='air'?1.4:0,0);r.us.push(u);
   };
   const cols=mode==='poses'?[[id,'R','stand','立ち'],[id,'R','walk','歩き'],[id,'R','crouch','しゃがみ（'+crouchName+'）'],[id,'R','air','空中']]
    :[[id,'B','stand','同じシリーズの上半身'],['light','B','stand','軽量（スウィフト）の上半身'],['standard','B','stand','標準（ハウンド）の上半身'],['heavy','B','stand','重装（ブルワーク）の上半身']];
   const gap=4.9,n=cols.length;cols.forEach(([up,team,pose],i)=>mk(up,team,((n-1)/2-i)*gap,pose));
   const rows=[['斜め前から',[0,.3,-1],-.5],['真横から（左が前）',[0,.06,-1],-Math.PI/2],['斜め後ろから',[0,.3,-1],Math.PI-.5]],rh=H/3,cy=2.6;
   let html='<div style="position:absolute;left:22px;top:12px;font:bold 26px sans-serif">'+title+'　ゲームの中の形（'+(mode==='poses'?'姿勢':'上半身の組み合わせ')+'）</div>';
   rows.forEach(([name,dir,yaw],ri)=>{
    for(const u of r.us){u.group.rotation.y=yaw;u.group.updateMatrixWorld(true);}
    const vh=7.0,vw=vh*W/rh,cam=new T.OrthographicCamera(-vw/2,vw/2,vh/2,-vh/2,.1,200),d=new T.Vector3(...dir).normalize();cam.position.copy(d.multiplyScalar(60)).add(new T.Vector3(0,cy,0));cam.lookAt(0,cy,0);
    r.ren.setViewport(0,H-rh*(ri+1),W,rh);r.ren.setScissor(0,H-rh*(ri+1),W,rh);r.ren.render(r.sc,cam);
    html+='<div style="position:absolute;left:22px;top:'+(rh*ri+(ri?10:50))+'px;color:#cfe">'+name+'</div>';
    if(ri===0)r.us.forEach((u,i)=>{const v=new T.Vector3(u.pos.x,-.5,0).project(cam);html+='<div style="position:absolute;left:'+((v.x+1)/2*W-150)+'px;width:300px;text-align:center;top:'+(rh-34)+'px">'+cols[i][3]+'</div>';});
   });
   document.getElementById('labels').innerHTML=html;
  },{id,title,crouchName,mode,W,H});
  await page.screenshot({path:path.join(out,'ingame-'+id+'-'+mode+'.png'),timeout:60000});console.log(id,mode);
 }
 console.log('errors',errors);await browser.close();process.exit(errors.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
