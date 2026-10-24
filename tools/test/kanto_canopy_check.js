// 白い大屋根が見た目と同じ傾斜で弾・機体を受け、下面も通り抜けないことを確かめる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),folder=path.resolve(process.argv[2]||'dbg');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});try{
 const page=await browser.newPage({offline:true}),errors=[];page.on('pageerror',e=>errors.push(e.stack));
 await page.route(/^https:\/\/fonts\./,r=>r.fulfill({contentType:'text/css',body:''}));
 await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
 await page.goto(pathToFileURL(path.join(folder,'dbg.html')).href);await page.waitForFunction(()=>window.__g);
 const samples=await page.evaluate(()=>{
  const g=__g;g.selectMap('kanto');g.setup();g.running=false;g.scene.updateMatrixWorld(true);
  const roof=g.scene.getObjectByName('city-brid');if(roof.material.color.getHex()!==0xf0f2ee)throw Error('大屋根が白くない');
  const ray=new g.T.Raycaster(),u=g.player,rows=[];
  const canopy=g.cityMap.district.stationCanopy;
  if(!canopy||canopy.ring.length!==4||!(canopy.top>canopy.low)||!(canopy.thickness>0))throw Error('傾斜大屋根の寸法が不正');
  // 高い辺と低い辺の中点を結ぶ線を3等間隔で調べる。縮尺後も板の傾き・厚さを検証する。
  const high=canopy.ring[0].map((v,i)=>(v+canopy.ring[1][i])/2);
  const low=canopy.ring[2].map((v,i)=>(v+canopy.ring[3][i])/2);
  for(const t of [.25,.5,.75]){
   const x=high[0]+(low[0]-high[0])*t,z=high[1]+(low[1]-high[1])*t;
   const expected=canopy.top+(canopy.low-canopy.top)*t;
   ray.set(new g.T.Vector3(x,expected+5,z),new g.T.Vector3(0,-1,0));ray.far=10;
   const upper=ray.intersectObjects(g.hittables,false)[0];
   ray.set(new g.T.Vector3(x,expected-2,z),new g.T.Vector3(0,1,0));
   const lower=ray.intersectObjects(g.hittables,false)[0];
   if(!upper||!lower||Math.abs(upper.point.y-expected)>.025||Math.abs(lower.point.y-(expected-canopy.thickness))>.025)throw Error('屋根の上下の弾判定がずれている '+JSON.stringify({x,z,upper:upper?.point.y,lower:lower?.point.y,expected,thickness:canopy.thickness}));
   g.spawn(u);u.pos.set(x,expected+6,z);u.vel.set(0,0,0);u.onGround=false;
   for(let i=0;i<180&&!u.onGround;i++)g.physics(u,new g.T.Vector3(),false,false,1/60);
   if(!u.onGround||Math.abs(u.pos.y-expected)>.025)throw Error('機体が大屋根をすり抜ける '+u.pos.toArray());
   rows.push({x,z,expected,shotTop:upper.point.y,shotBottom:lower.point.y,landing:u.pos.toArray()});
  }
  return rows;
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(ROOT,'mapdesign/kanto/canopy-check.json'),JSON.stringify({samples,errors},null,2)+'\n');
 console.log('大屋根3地点の上下の弾判定・実機体の着地を確認。ブラウザエラー0。');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
