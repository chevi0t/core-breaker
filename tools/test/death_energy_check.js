// node tools/test/death_energy_check.js dbg result.json
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined});await p.goto('file://'+path.resolve(process.argv[2],'dbg.html'));
 const checks=await p.evaluate(()=>{const g=__g;g.selectMap('dock');g.setup();g.running=false;const u=g.units.find(x=>!x.isPlayer),checks=[],ok=(name,value)=>checks.push({name,pass:!!value}),energy=()=>g.fx.filter(f=>f.energyOwner),reset=()=>{g.clearDeathEnergy();g.spawn(u);g.camera.position.copy(u.pos).add(new g.T.Vector3(10,8,10));};
 reset();const hp=u.hp,vel=u.vel.clone(),random=Math.random;let calls=0;Math.random=()=>{calls++;return .5};g.deathEnergyBurst(u);Math.random=random;
 ok('戦闘乱数を消費しない',calls===0);ok('HPと速度を変えない',u.hp===hp&&u.vel.equals(vel));ok('近距離最大3描画物',energy().length===3);ok('光帯216三角形',energy()[0].obj.geometry.attributes.position.count/3===216);g.deathEnergyBurst(u);ok('同一出撃の二重生成なし',energy().length===3);
 reset();g.kill(u,g.player,false,100);ok('行動不能でも発生',u.downT>0&&energy().length===3);g.fxUpdate(.1);ok('実シーンへ追加・有限値',energy().every(f=>f.obj.parent===g.scene&&Number.isFinite(f.obj.scale.x)));u.pos.add(new g.T.Vector3(4,2,-3));u.group.position.copy(u.pos);u.group.rotation.set(.9,1.1,0);g.mechPose(u,.1);g.fxUpdate(.02);
 const chest=u.rig.bones.chest.node;chest.updateWorldMatrix(true,false);const center=new g.T.Vector3(0,.6,0).applyMatrix4(chest.matrixWorld).applyMatrix4(u.group.matrixWorld);
 ok('移動・転倒した胴体内部に全発光源が追従',center.distanceTo(new g.T.Vector3(0,2.75,0))>2&&energy().every(f=>f.obj.position.distanceTo(center)<1e-6));
 const beam=energy().find(f=>f.kind==='deathEnergy'),q=u.group.getWorldQuaternion(new g.T.Quaternion()).multiply(chest.getWorldQuaternion(new g.T.Quaternion())).multiply(new g.T.Quaternion().setFromAxisAngle(new g.T.Vector3(0,1,0),beam.energyTwist));
 ok('光帯の姿勢も胴体に追従',1-Math.abs(q.dot(beam.obj.quaternion))<1e-6);
 const last=beam.obj.position.clone();g.wreck(u);u.group.position.x+=20;g.fxUpdate(.02);ok('消滅後は最後の放出位置に残光',beam.obj.position.distanceTo(last)<1e-6);
 ok('大破移行で再発生しない',energy().length===3);g.fxUpdate(1);ok('寿命終了で解放',energy().length===0);
 reset();g.kill(u,g.player,false,Infinity);ok('即大破でも一度発生',!u.alive&&u.downT===0&&energy().length===3);g.spawn(u);g.fxUpdate(.01);ok('再出撃で残光解除',energy().length===0);
 reset();g.kill(u,g.player,false,100);g.revive(u,g.player);g.fxUpdate(.01);ok('蘇生時は残光解除',energy().length===0);
 reset();g.camera.position.copy(u.pos).add(new g.T.Vector3(150,0,0));g.deathEnergyBurst(u);ok('遠距離96三角形',energy()[0].obj.geometry.attributes.position.count/3===96);
 reset();g.camera.position.copy(u.pos).add(new g.T.Vector3(301,0,0));g.deathEnergyBurst(u);ok('300mより遠くは生成しない',energy().length===0);
 reset();g.camera.position.set(0,10,0);for(let i=0;i<12;i++)g.deathEnergyBurst({pos:new g.T.Vector3(i,0,0),lifeId:1,idx:i,alive:false});ok('同時8機24描画物上限',energy().length===24);g.fxUpdate(1);ok('同時発生後に全解放',energy().length===0);
 reset();g.kill(u,g.player,false,100);g.setup();ok('試合切替で解除',energy().length===0);return checks;});
 fs.writeFileSync(process.argv[3],JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,failed:checks.filter(x=>!x.pass),errors}));assert(checks.every(x=>x.pass)&&!errors.length);
 }finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
