// 共通プラント光柱の所有色・描画専用・再生成を確認。
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{const b=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});try{
const p=await b.newPage({viewport:{width:1280,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED/.test(m.text()))errors.push(m.text());});
await p.route('https://**/*',r=>r.fulfill({body:''}));await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined});
await p.goto('file://'+path.resolve(process.argv[2]||'dbg')+'/dbg.html');
const report=await p.evaluate(()=>{const g=__g,out=[];g.selectMap('city');document.querySelector('#start').click();g.running=false;
for(const map of ['city','river_castle','dock']){g.selectMap(map);for(const pl of g.plants){
 for(const owner of [null,'B','R',null]){pl.owner=owner;g.paintPlant(pl);pl.contested=true;g.plantVisualTick(pl,1);
 const expected=owner?g.TEAM[owner].color:0xaaaaaa;
 if(pl.column.children.some(r=>r.material.color.getHex()!==expected||!r.material.depthTest||r.material.depthWrite||g.hittables.includes(r)))throw Error('色/判定 '+map+pl.id);
 }
 if(pl.column.children.some(r=>r.frustumCulled||!r.material.vertexShader.includes('vec4(0.,1.,0.,0.)')))throw Error('infinite projection');
 out.push({map,id:pl.id});
}}
return out;});assert(report.length>0);assert.equal(errors.length,0);console.log(JSON.stringify({plants:report.length,ownershipStates:report.length*4,errors}));
if(process.argv[3]){await p.evaluate(()=>{const g=__g;g.selectMap('city');g.scene.updateMatrixWorld(true);g.camera.position.set(185,65,210);g.camera.lookAt(0,60,0);g.camera.updateMatrixWorld();document.querySelectorAll('body > :not(#game):not(script):not(style)').forEach(e=>e.style.display='none');});for(const [name,owner] of [['neutral',null],['blue','B'],['orange','R']]){await p.evaluate(owner=>{const g=__g;for(const pl of g.plants){pl.owner=owner;g.paintPlant(pl);}g.renderer.render(g.scene,g.camera);},owner);await p.screenshot({path:path.join(process.argv[3],'plant-'+name+'.png')});}}
// 上向き・水平・俯瞰・柱の近傍を移動してもシェーダーエラーを出さない。
for(const [i,pose] of [[60,18,80,0,150,0],[0,18,80,0,18,0],[-60,18,80,0,150,0],[0,220,0,0,0,0]].entries()){
 await p.evaluate(pose=>{const g=__g;g.camera.position.set(...pose.slice(0,3));g.camera.lookAt(...pose.slice(3));g.camera.updateMatrixWorld();g.renderer.render(g.scene,g.camera);},pose);
 if(process.argv[3]&&i===0)await p.screenshot({path:path.join(process.argv[3],'plant-upward.png')});
}
assert.equal(errors.length,0);console.log('4 camera poses passed');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
