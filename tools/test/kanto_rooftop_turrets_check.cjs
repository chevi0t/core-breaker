// 屋上の陣営固定砲台が、別角度から地上へ射撃し、通常の施設として壊れ・直ることを確かめる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const folder=path.resolve(process.argv[2]||'mapdesign/kanto_half');

(async()=>{
  const html=fs.readFileSync(path.join(folder,'play.html'),'utf8');let scripts=0;
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(match[1],{filename:'inline-'+(++scripts)+'.js'});
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const page=await browser.newPage({offline:true,viewport:{width:1600,height:1000}}),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
    await page.goto(pathToFileURL(path.join(folder,'play.html')).href);
    await page.waitForFunction(()=>window.__cityBattle,null,{polling:100,timeout:60000});
    const report=await page.evaluate(()=>{
      const g=__cityBattle,T=g.T,ok=(v,m,d)=>{if(!v)throw Error(m+' '+JSON.stringify(d));};
      g.setup();g.running=false;g.scene.updateMatrixWorld(true);
      const defs=g.curMap.rooftopTurrets,roofs=g.turrets.filter(t=>t.rooftop),u=g.player;
      ok(defs.length===4&&roofs.length===4&&g.turrets.length===12,'基地8基と屋上4基',g.turrets.length);
      for(const [plant,team]of [['A','B'],['E','R']]){
        ok(roofs.filter(t=>t.rooftopPlant===plant&&t.team===team).length===2,'A青軍・E橙軍に2基ずつ',plant);
        ok(g.turrets.filter(t=>t.team===team).length===6,'各軍は6基',team);
      }
      const clearShells=()=>{for(const s of g.shells)g.scene.remove(s.mesh);g.shells.length=0;};
      const place=(at,team,role='assault')=>{
        u.team=team;g.equip(u,role);g.spawn(u,'base');u.pos.fromArray(at);u.vel.set(0,0,0);
        Object.assign(u,{invulT:0,cloak:false,vis:1,alive:true,onGround:true,downT:0,stun:'',stunT:0,jamT:0});
        u.hp=u.maxHp;u.group.position.copy(u.pos);u.group.visible=true;
        for(const other of g.units)if(other!==u){other.alive=false;other.group.visible=false;}
        g.scene.updateMatrixWorld(true);
      };
      const ready=tu=>{clearShells();Object.assign(tu,{think:0,fireCd:0,target:null,locked:false,shots:3});};
      const tests=[];
      for(let index=0;index<roofs.length;index++){
        const tu=roofs[index],def=defs.find(d=>d.team===tu.team&&Math.hypot(d.at[0]-tu.pos.x,d.at[1]-tu.pos.z)<.01);
        ok(def&&Math.abs(tu.pos.y-def.at[2])<.001,'指定高さの屋上へ設置',tu.pos.toArray());
        ok(tu.pos.y>=7,'地上より高い建物の上',tu.pos.toArray());
        for(const dx of [-1.5,0,1.5])for(const dz of [-1.5,0,1.5]){
          const surfaces=g.city.volumes.filter(v=>g.city.contact(v,tu.pos.x+dx,tu.pos.z+dz).inside);
          ok(surfaces.some(v=>Math.abs(v.top-tu.pos.y)<.01),'3m四方の台座が屋根に収まる',{index,dx,dz});
          ok(!surfaces.some(v=>v.bottom<tu.pos.y+3.7&&v.top>tu.pos.y+.01),'台座・砲塔が別の建物に埋まらない',{index,dx,dz});
        }
        const obstacle=g.obstacles.find(o=>Math.abs((o.minX+o.maxX)/2-tu.pos.x)<.01&&Math.abs((o.minZ+o.maxZ)/2-tu.pos.z)<.01&&Math.abs(o.top-tu.pos.y-2.4)<.01);
        ok(obstacle&&Math.abs(obstacle.bottom-tu.pos.y)<.01,'屋上台座の底面を明示し地上に不可視柱を作らない',obstacle);
        const plant=g.plants.find(p=>p.id===tu.rooftopPlant),enemy=tu.team==='B'?'R':'B',candidates=[];
        // 占拠円と近接する進入路から、実際に立てる地点を拾う。
        for(let radius=6;radius<=32;radius+=4)for(let angle=0;angle<Math.PI*2;angle+=Math.PI/12){
          const x=plant.pos.x+Math.cos(angle)*radius,z=plant.pos.z+Math.sin(angle)*radius,y=g.terrainH(x,z);
          if(g.battle.free(x,z,y,g.obstacles)&&tu.pos.distanceTo(new T.Vector3(x,y,z))<69)candidates.push([x,y,z]);
        }
        let success=null,blocked=null;
        for(const at of candidates){
          place(at,enemy);ready(tu);
          if(!g.canSee(tu,u,g.targetPoint(u))){blocked||=at;continue;}
          const startHP=u.hp,velocities=[];let first=null;
          for(let t=0;t<4;t+=1/120){
            g.turretUpdate(tu,1/120);
            for(const s of g.shells)if(s.owner===tu&&!velocities.includes(s)){
              velocities.push(s);first||={from:s.pos.toArray(),velocity:s.vel.toArray(),spec:{dmg:s.spec.dmg,blast:s.spec.blast},speed:s.vel.length()};
            }
            g.shellUpdate(1/120);g.scene.updateMatrixWorld(true);
            if(u.hp<startHP)break;
          }
          if(u.hp<startHP){success={at,damage:startHP-u.hp,shot:first,shots:velocities.length};break;}
        }
        ok(success,'占拠円・進入路の敵へ実弾で損傷を与える',{index,at:tu.pos.toArray(),candidates:candidates.length});
        ok(success.shot.velocity[1]<0&&success.shot.from[1]>success.at[1]+3,'屋上から下向きに射撃',success);
        ok(success.shot.spec.dmg===1800&&success.shot.spec.blast===5&&Math.abs(success.shot.speed-70)<.001,
          '既存砲台の威力・爆風・弾速を維持',success.shot);
        // 同じ場所の味方は撃たず、プラントを奪われても所属は固定。
        place(success.at,tu.team);ready(tu);const ownHP=u.hp;
        for(let i=0;i<80;i++)g.turretUpdate(tu,.05);
        ok(!g.shells.length&&u.hp===ownHP&&!tu.target,'味方に射撃しない',index);
        const owner=plant.owner;plant.owner=enemy;
        place(success.at,enemy);ready(tu);
        for(let i=0;i<80;i++)g.turretUpdate(tu,.05);
        ok(tu.team===def.team&&g.shells.some(s=>s.owner===tu),'プラント奪取後も陣営固定',index);plant.owner=owner;
        if(!blocked)for(const at of candidates){place(at,enemy);if(!g.canSee(tu,u,g.targetPoint(u))){blocked=at;break;}}
        ok(blocked,'付近に射線を切れる地形がある',index);
        place(blocked,enemy);ready(tu);const blockedHP=u.hp;
        for(let i=0;i<80;i++){g.turretUpdate(tu,.05);g.shellUpdate(.05);}
        ok(!tu.target&&!g.shells.length&&u.hp===blockedHP,'建物の陰の敵を射撃しない',{index,blocked});
        // 通常の破壊と支援装備による再始動を確認する。
        ready(tu);g.destroyTurret(tu,u);
        ok(!tu.alive&&!tu.head.visible&&tu.parts.every(m=>!g.hittables.includes(m)),'破壊で砲塔を停止',index);
        let repaired=false,repairAt=null;
        for(let angle=0;angle<Math.PI*2&&!repaired;angle+=Math.PI/4){
          const at=[tu.pos.x+Math.cos(angle)*5,tu.pos.y,tu.pos.z+Math.sin(angle)*5];
          if(!g.city.volumes.some(v=>Math.abs(v.top-tu.pos.y)<.01&&g.city.contact(v,at[0],at[2]).inside))continue;
          place(at,tu.team,'support');u.weapon='sp';
          const sl=u.slots.sp;ok(sl.w.heal>0,'支援のリペアユニットを使う',sl.w);
          for(let i=0;i<400&&!tu.alive;i++)g.repairTick(u,sl,.05,true,g.targetPoint(tu),false);
          if(tu.alive){repaired=true;repairAt=at;}
        }
        ok(repaired&&tu.head.visible&&tu.parts.every(m=>g.hittables.includes(m)),'通常の支援リペアで再始動',index);
        tests.push({plant:tu.rooftopPlant,team:tu.team,at:tu.pos.toArray(),target:success,blocked,repairAt});
      }
      const angles=[];
      for(const id of ['A','E']){
        const plant=g.plants.find(p=>p.id===id),pair=roofs.filter(t=>t.rooftopPlant===id);
        const a=pair[0].pos.clone().sub(plant.pos).setY(0),b=pair[1].pos.clone().sub(plant.pos).setY(0);
        const degrees=a.angleTo(b)*180/Math.PI;ok(degrees>=35,'異なる屋上方向からプラントを守る',{id,degrees});angles.push({plant:id,degrees});
      }
      const count=()=>({turrets:g.turrets.length,rooftop:g.turrets.filter(t=>t.rooftop).length,turretHittables:g.hittables.filter(m=>m.userData.ref?.kind==='turret').length,obstacles:g.obstacles.length,mapChildren:g.mapRoot.children.length});
      g.setup();g.running=false;const rebuilds=[count()];
      for(let i=0;i<2;i++){g.setup();g.running=false;rebuilds.push(count());}
      ok(rebuilds.every(r=>JSON.stringify(r)===JSON.stringify(rebuilds[0])),'再試合で砲台・衝突判定が増殖しない',rebuilds);
      return {tests,angles,rebuilds};
    });
    for(const id of ['A','E']){
      const capture=await page.evaluate(id=>{
        const g=__cityBattle,T=g.T,plant=g.plants.find(p=>p.id===id),pair=g.turrets.filter(t=>t.rooftopPlant===id);
        for(const u of g.units)u.group.visible=false;g.scene.fog=null;
        for(const el of document.querySelectorAll('body *'))if(el!==g.renderer.domElement&&!el.contains(g.renderer.domElement))el.style.visibility='hidden';
        g.renderer.setPixelRatio(1);g.renderer.setSize(1600,1000,false);
        const target=plant.pos.clone();target.y=pair.reduce((a,t)=>a+t.pos.y,0)/4;
        const camera=new T.PerspectiveCamera(48,1.6,.1,1500);
        camera.position.copy(target).add(id==='A'?new T.Vector3(0,180,0):new T.Vector3(-65,110,-95));
        if(id==='A')camera.up.set(0,0,-1);
        camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
        g.scene.updateMatrixWorld(true);g.renderer.render(g.scene,camera);
        const labels=document.createElement('div');labels.style.cssText='position:fixed;inset:0;pointer-events:none';
        const mark=(at,text,color)=>{const p=at.clone().project(camera),el=document.createElement('div');el.style.cssText=`position:absolute;left:${(p.x+1)*800}px;top:${(1-p.y)*500}px;transform:translate(-50%,-100%);margin-top:-16px;font:700 23px system-ui;color:${color};background:#102027ed;border:2px solid ${color};padding:5px 10px;border-radius:5px`;el.textContent=text;labels.append(el);};
        mark(plant.pos.clone().add(new T.Vector3(0,5,0)),'プラント '+id,'#ffffff');
        pair.forEach((t,i)=>mark(t.pos.clone().add(new T.Vector3(0,5,0)),`${t.team==='B'?'青軍':'橙軍'} 砲台${i+1} · 屋上${t.pos.y}m`,t.team==='B'?'#63bdff':'#ffa34f'));
        document.body.append(labels);return {plant:id,camera:camera.position.toArray(),target:target.toArray(),captureOnlyChanges:['霧・HUD・機体を非表示','施設位置ラベルを重畳']};
      },id);
      await page.screenshot({path:path.join(folder,`rooftop-turrets-${id}.png`)});
      (report.captures||=[]).push(capture);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    fs.writeFileSync(path.join(folder,'rooftop-turrets-check.json'),JSON.stringify({...report,inlineScriptsParsed:scripts,htmlSHA256:createHash('sha256').update(html).digest('hex'),offline:true,errors,externalRequests:external},null,2)+'\n');
    console.log('屋上砲台4基の地上射撃・遮蔽・固定所属・破壊修理・再試合を確認');
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
