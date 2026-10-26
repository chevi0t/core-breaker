// 武器の実blastから描画へ渡る半径と、既存の大小・寿命・粒数の独立性を確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const p=await browser.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await p.goto('file://'+path.resolve(process.argv[2]||'dbg/radius','dbg.html'));
  const result=await p.evaluate(()=>{
   const g=__g,T=g.T,checks=[],samples=[],yes=(v,s)=>{if(!v)throw Error(s);checks.push(s);};
   g.selectMap('dock');document.getElementById('start').click();g.running=false;
   for(const u of g.units){u.alive=false;u.frozen=true;}
   const at=new T.Vector3(0,200,0);g.camera.position.set(0,205,60);
   const spawn=(radius,small=false)=>{
    g.clearBooms();g.blast({owner:g.player,team:g.player.team,spec:{dmg:1,blast:radius,small}},at);
    yes(g.booms.length===1,'半径'+radius+'mの武器が爆発演出を発生'+(small?'（小区分）':''));
    g.booms[0].seed=12345;return g.booms[0];
   };
   const maxSize=b=>Math.max(...b.attributes.size.array.slice(0,b.count));
   function ringRadius(){const a=g.boomVisuals.rings.attributes.position.array;let max=0;for(let i=0;i<g.boomVisuals.rings.count*3;i+=3)max=Math.max(max,Math.hypot(a[i]-at.x,a[i+2]-at.z));return max;}
   for(const radius of [2.5,8,16,32,40]){
    spawn(radius);g.boomUpdate(.08);const fire=maxSize(g.boomVisuals.fire),spark=g.boomVisuals.sparks.count;
    g.boomUpdate(.419-.08);const ring=ringRadius();
    yes(Math.abs(ring-radius)<.001,'半径'+radius+'m：衝撃波の最大径を実際の爆風へ合わせる');
    g.boomUpdate(.6-.419);const smoke=maxSize(g.boomVisuals.smoke);
    samples.push({radius,fire,smoke,ring,spark});
   }
   for(const s of samples){
    yes(Math.abs(s.fire/samples[0].fire-s.radius/samples[0].radius)<1e-5,s.radius+'m：火球は爆風半径に比例');
    yes(Math.abs(s.smoke/samples[0].smoke-s.radius/samples[0].radius)<1e-5,s.radius+'m：煙は爆風半径に比例');
    yes(s.spark===20,s.radius+'m：サイズで火花の粒数を増やさない');
   }
   spawn(16,true);g.boomUpdate(.08);
   yes(Math.abs(maxSize(g.boomVisuals.fire)-samples[2].fire)<1e-5,'小区分でも同じ半径なら火球は同じ大きさ');
   yes(g.boomVisuals.sparks.count===12&&g.booms[0].life===1.05,'小区分の12粒・寿命1.05秒は維持');
   g.clearBooms();g.boom(at);g.boomUpdate(.08);const normal=maxSize(g.boomVisuals.fire);
   yes(g.booms[0].at.y===202&&g.booms[0].life===1.3,'機体撃破の中心高度・寿命を維持');
   g.clearBooms();g.boom(at,.5);g.booms[0].seed=12345;g.boomUpdate(.08);const legacySmall=maxSize(g.boomVisuals.fire);
   g.clearBooms();g.boom(at);g.booms[0].seed=12345;g.boomUpdate(.08);
   yes(Math.abs(maxSize(g.boomVisuals.fire)/legacySmall-2)<1e-5&&normal>0,'武器半径なしの大小は従来の倍率を維持');
   // 選択可能な全ての損傷型爆発が2段階へ丸められずに届くことを確認する。
   let weapons=0;
   for(const [key,w]of Object.entries(g.WEAPONS)){
    const spec=w.proj;if(!spec?.blast||spec.weak||spec.scan)continue;
    spawn(spec.blast,!!spec.small);g.boomUpdate(.419);
    yes(Math.abs(ringRadius()-spec.blast)<.001,key+'の実爆風半径を描画へ渡す');weapons++;
   }
   g.clearBooms();return {checks,samples,weapons};
  });
  assert.deepEqual(errors,[]);const out=path.resolve(process.argv[3]||'/tmp/explosion-radius-results');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({...result,errors},null,2)+'\n');console.log(JSON.stringify({checks:result.checks.length,weapons:result.weapons,samples:result.samples,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
