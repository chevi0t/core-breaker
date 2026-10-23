// 配置前の軽い形状検査。量子化後の実データを共有ランタイムで展開して調べる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),folder=path.resolve(process.argv[2]||'mapdesign/shinjuku_rebuilt');
const T=require(path.join(ROOT,'vendor/three-r128/three.min.js'));
(async()=>{
 const buffer=fs.readFileSync(path.join(folder,'layout.json')),data=JSON.parse(buffer);
 const record=JSON.parse(fs.readFileSync(path.join(folder,'generation.json')));
 assert(buffer.length<=100000,'非圧縮JSON全体が100KB以下');
 assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'),record.layoutSHA256);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'mapdesign/plateau_city/preview.html'))).digest('hex'),record.sourceHTMLSHA256);
 assert.equal(data.district.bases.length,0);assert.equal(record.plants,0);
 let runtime=fs.readFileSync(path.join(ROOT,'tools/plateau/trial_runtime.js'),'utf8');
 runtime=runtime.replace(/  const bytes = .*\n  const data = .*\n/,'  const data=JSON.parse(packed);expandCityLayout(T,data);\n');
 const source=['trial_camera.js','rebuild_runtime.js'].map(n=>fs.readFileSync(path.join(ROOT,'tools/plateau',n),'utf8')).join('\n');
 const create=new Function(source+'\n'+runtime+';return createCityTrial;')();
 const city=await create(T,buffer.toString()),ramps=[],roads=[];
 const free=(x,z,y)=>{
  if(city.ceilingAt(x,z,y)<y+4.05)return false;
  return ![...city.nearby(x,z,1.3)].some(v=>v.bottom<y+4-.05&&v.top>y+.3&&(city.contact(v,x,z).inside||city.contact(v,x,z).distance2<1.3**2));
 };
 for(const c of record.crossings){
  for(let x=c.x0+3;x<297;x+=2){
   const y=city.groundAt(x,c.z,-8);assert(Math.abs(y+8)<.02,'下道が連続 '+JSON.stringify({x,z:c.z,y}));
   assert(free(x,c.z,y),'下道に4m機体の空間 '+JSON.stringify({x,z:c.z,y}));
  }
  for(const x of [-91,45,167]){
   assert(Math.abs(city.groundAt(x,c.z,0))<.05,'上の道路の床');
   assert(Math.abs(city.ceilingAt(x,c.z,-8)+1.5)<.02,'下道から見た橋の下面');
   roads.push({x,z:c.z,lower:-8,upper:city.groundAt(x,c.z,0),clearance:6.5});
  }
 }
 for(const r of record.ramps){
  let maximumError=0;
  for(let i=0;i<=66;i++){
   const f=i/66,z=r.z0+(r.z1-r.z0)*f,expected=-8*f,y=city.groundAt(r.x,z,expected+.05);
   maximumError=Math.max(maximumError,Math.abs(y-expected));
   assert(Math.abs(y-expected)<.06,'復帰坂の連続性 '+JSON.stringify({r,z,y,expected}));
   assert(free(r.x,z,y),'復帰坂の機体幅・頭上 '+JSON.stringify({r,z,y}));
  }
  ramps.push({...r,maximumError});
 }
 for(const z of [-30,80]){
  // x45の車線には復帰坂があるため、同じ道路の平らな側を確認する。
  assert(Math.abs(city.groundAt(35,z,0))<.05,'デッキ下の南北道路');
  assert.equal(city.groundAt(35,z,8),8,'歩行デッキ');assert.equal(city.ceilingAt(35,z,0),6.5);
 }
 assert(Math.abs(city.terrainH(-210,-85)-18)<.02,'公園の頂部');
 assert(city.terrainH(-210,-78)>10,'中央の下道を公園へ延ばして切断しない');
 let triangles=0;
 for(const [kind,a] of Object.entries(city.arrays)){
  assert(a.length%9===0,kind+' の面');triangles+=a.length/9;
  for(let i=0;i<a.length;i++)assert(Number.isFinite(a[i])&&(i%3===1||Math.abs(a[i])<=300.01),kind+' の座標');
 }
 assert.equal(triangles,record.triangles);
 const result={layoutBytes:buffer.length,triangles,volumes:city.volumes.length,roads,ramps,parkHeight:18,bases:0,plants:0,
  scope:'共有ランタイムの床・頭上・体積検査。機体の実走・Bot・基地配置は未実施。'};
 fs.writeFileSync(path.join(folder,'geometry-check.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exit(1);});
