// 仕上げた四脚・逆脚の形（leg_shapes.js）を、今の機体の上半身に付けて描く。作り方は patch_index.py の頭。
// node media/legs-proto/cap2.js [dbgのフォルダ]   → dozer-bodies.png・dozer-poses.png・hopper-bodies.png・hopper-poses.png と shapes.json
const fs=require('node:fs'),path=require('node:path');const {chromium}=require('playwright');
const S=__dirname,dbg=path.resolve(process.argv[2]||path.join(S,'dbg')),W=1600,H=1200;
(async()=>{
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
 await page.route('**cdn.jsdelivr.net/**',r=>r.fulfill({body:'',contentType:'text/javascript'}));
 await page.goto('file://'+path.join(dbg,'dbg.html'));await page.addScriptTag({path:path.join(S,'leg_shapes.js')});await page.addScriptTag({path:path.join(S,'body_shapes.js')});
 await page.evaluate(({W,H})=>{
  const g=__g,T=g.T;g.running=false;g.renderer.render=()=>{};
  const sc=new T.Scene();sc.background=new T.Color(0x1b2c3a);sc.add(new T.HemisphereLight(0xf0f8ff,0x394455,1.15));
  const light=new T.DirectionalLight(0xffffff,1.1);light.position.set(-5,9,-7);sc.add(light);sc.add(new T.GridHelper(60,60,0x7f93a0,0x33495a));
  document.body.insertAdjacentHTML('beforeend','<canvas id="review" style="position:fixed;inset:0;z-index:10000"></canvas><div id="labels" style="position:fixed;inset:0;z-index:10001;color:white;font:18px sans-serif;text-shadow:0 0 6px #000,0 0 3px #000"></div>');
  const ren=new T.WebGLRenderer({canvas:document.getElementById('review'),antialias:true,preserveDrawingBuffer:true});ren.setSize(W,H);ren.setScissorTest(true);
  window.__review={sc,ren,us:[]};
  // 準備中のシリーズを、この絵のページの中でだけ表に足す（ゲーム本体の表は変えない）
  const wip=partTables();
  for(const [id,ps] of Object.entries(wip.WIP_SERIES)){g.PART_SERIES[id]={name:ps.name,maker:ps.maker,desc:ps.desc,types:ps.types,set:ps.set};g.MECH_SILHOUETTES[id]=BODY_SHAPES[id].silhouette;for(const slot of g.PART_SLOTS)for(const k of ps.types)g.PARTS[slot][k]=wip.WIP_PARTS[slot][k];}
  const O=g.MECH_OUTLINES,h0=window.seriesHead,c0=window.seriesChest,s0=window.seriesShoulder;
  window.seriesHead=(a,id,p)=>BODY_SHAPES[id]?BODY_SHAPES[id].head(a,p,O):h0(a,id,p);
  window.seriesChest=(a,id,p)=>BODY_SHAPES[id]?BODY_SHAPES[id].chest(a,p,O):c0(a,id,p);
  window.seriesShoulder=(a,id,p,sd)=>BODY_SHAPES[id]?BODY_SHAPES[id].shoulder(a,p,sd,O):s0(a,id,p,sd);
 },{W,H});
 const shots=[['dozer','quad','ドーザー（重量級の四脚）','踏ん張り'],['hopper','reverse','ホッパー（軽量級の逆脚）','溜め']],info={};
 for(const [id,kind,title,crouchName] of shots)for(const mode of['bodies','poses']){
  await page.evaluate(id=>{window.__sid=id;},id);
  const r=await page.evaluate(({kind,title,crouchName,mode,W,H})=>{
   const g=__g,T=g.T,r=__review;for(const u of r.us){r.sc.remove(u.group);g.disposeMech(u.group);}r.us=[];
   const mk=(up,color,team,x,pose)=>{
    window.__legProto=(add)=>LEG_SHAPES[kind](add,T,pose);
    const cfg={head:up,body:up,arms:up,legs:g.PARTS.legs[up].wip?up:'standard',color};
    const m=g.buildMech(g.TEAM[team].color,cfg),u={...m,group:m.g,pos:new T.Vector3(x,0,0),vel:new T.Vector3(),alive:true,onGround:pose.name!=='jump',yaw:0,pitch:0,isPlayer:true,recoil:0,cannonDeploy:0,slots:Object.fromEntries(g.SLOTS.map(s=>[s,g.slotOf(g.loadout.assault[s])])),weapon:'main',swing:null,planted:false,crouching:pose.name==='crouch'};
    r.sc.add(u.group);g.weaponLook(u,0);for(let f=0;f<30;f++)g.weaponLook(u,.05);
    u.baseY=pose.name==='jump'?1.4:0;u.group.position.set(x,u.baseY,0);r.us.push(u);
    const mesh=u.rig.meshes.find(q=>q.mesh.userData.armorSlot==='legs').mesh;u.group.updateMatrixWorld(true);
    const p=mesh.geometry.attributes.position,v=new T.Vector3();let minY=1e9,maxX=0,maxZ=0;
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);minY=Math.min(minY,v.y);maxX=Math.max(maxX,Math.abs(v.x-x));maxZ=Math.max(maxZ,Math.abs(v.z));}
    return {tris:p.count/3,minY:+(minY-u.baseY).toFixed(3),halfWidth:+maxX.toFixed(2),halfDepth:+maxZ.toFixed(2),hipDrop:+(1.85-u.rig.bones.hip.node.position.y).toFixed(3)};
   };
   const sid=window.__sid,cols=mode==='bodies'?[[sid,'team','R',{name:'stand'},'全身（敵軍の色）'],[sid,'team','B',{name:'stand'},'全身（自軍の色）'],[sid,'ash','B',{name:'stand'},'全身（アッシュ塗装）'],['standard','team','R',{name:'stand'},'脚だけ（標準の上半身）']]
    :[[sid,'team','R',{name:'stand'},'立ち'],[sid,'team','R',{name:'walk'},'歩き'],[sid,'team','R',{name:'crouch',drop:.6},'しゃがみ（'+crouchName+'）'],[sid,'team','R',{name:'jump'},'ジャンプ']];
   const gap=mode==='bodies'?5.0:4.8,n=cols.length,stats=cols.map(([up,color,team,pose,label],i)=>({label,...mk(up,color,team,((n-1)/2-i)*gap,pose)}));
   const rows=[['斜め前から',[0,.3,-1],-.5],['真横から（左が前）',[0,.06,-1],-Math.PI/2],['斜め後ろから',[0,.3,-1],Math.PI-.5]],rh=H/3,dist=mode==='bodies'?15.5:18.5,cy=mode==='bodies'?2.0:2.8;
   let html='<div style="position:absolute;left:22px;top:12px;font:bold 26px sans-serif">'+title+'　'+(mode==='bodies'?'全身':'姿勢')+'</div>';
   rows.forEach(([name,dir,yaw],ri)=>{
    for(const u of r.us){u.group.rotation.y=yaw;u.group.updateMatrixWorld(true);}
    const vh=mode==='bodies'?6.6:7.0,vw=vh*W/rh,cam=new T.OrthographicCamera(-vw/2,vw/2,vh/2,-vh/2,.1,200),d=new T.Vector3(...dir).normalize();cam.position.copy(d.multiplyScalar(60)).add(new T.Vector3(0,cy,0));cam.lookAt(0,cy,0);
    r.ren.setViewport(0,H-rh*(ri+1),W,rh);r.ren.setScissor(0,H-rh*(ri+1),W,rh);r.ren.render(r.sc,cam);
    html+='<div style="position:absolute;left:22px;top:'+(rh*ri+(ri?10:50))+'px;color:#cfe">'+name+'</div>';
    if(ri===0)r.us.forEach((u,i)=>{const v=new T.Vector3(u.pos.x,-.5,0).project(cam);html+='<div style="position:absolute;left:'+((v.x+1)/2*W-130)+'px;width:260px;text-align:center;top:'+(rh-34)+'px">'+cols[i][4]+'</div>';});
   });
   document.getElementById('labels').innerHTML=html;return stats;
  },{kind,title,crouchName,mode,W,H});
  info[id+'-'+mode]=r;await page.screenshot({path:path.join(S,id+'-'+mode+'.png'),timeout:60000});console.log(id,mode);
 }
 // 比べる相手：今のホバー脚（スキマー）と標準二脚の脚の三角形の数
 info.compare=await page.evaluate(()=>{const g=__g;window.__legProto=null;const tri=legs=>{const m=g.buildMech(g.TEAM.B.color,{head:'standard',body:'standard',arms:'standard',legs,color:'team'});const n=m.rig.meshes.find(q=>q.mesh.userData.armorSlot==='legs').mesh.geometry.attributes.position.count/3;g.disposeMech(m.g);return n;};return {standard:tri('standard'),heavy:tri('heavy'),skimmer:tri('skimmer'),anchor:tri('anchor')};});
 fs.writeFileSync(path.join(S,'shapes.json'),JSON.stringify({errors,...info},null,2)+'\n');console.log(JSON.stringify(info.compare),'errors',errors);
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
