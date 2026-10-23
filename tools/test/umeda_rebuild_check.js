// 1km範囲・100KB制限・量子化後の道と駅横断通路を、共通の都市判定で確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),folder=path.resolve(process.argv[2]||'mapdesign/umeda_rebuilt');
const T=require(path.join(ROOT,'vendor/three-r128/three.min.js'));
(async()=>{
 const buffer=fs.readFileSync(path.join(folder,'layout.json')),data=JSON.parse(buffer);
 const record=JSON.parse(fs.readFileSync(path.join(folder,'generation.json')));
 assert(buffer.length<=100000);assert.equal(data.half,500);assert.equal(record.extentMeters,1000);
 assert.equal(data.ringCoordinateStep,.02);assert.equal(buffer.length,record.layoutBytes);
 assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'),record.layoutSHA256);
 assert.equal(data.district.bases.length,0);assert.equal(record.plants,0);
 let runtime=fs.readFileSync(path.join(ROOT,'tools/plateau/trial_runtime.js'),'utf8');
 runtime=runtime.replace(/  const bytes = .*\n  const data = .*\n/,'  const data=JSON.parse(packed);expandCityLayout(T,data);\n');
 const source=['trial_camera.js','rebuild_runtime.js'].map(n=>fs.readFileSync(path.join(ROOT,'tools/plateau',n),'utf8')).join('\n');
 const create=new Function(source+'\n'+runtime+';return createCityTrial;')(),city=await create(T,buffer.toString());
 const free=(x,z)=>{
  const y=city.terrainH(x,z);
  if(city.ceilingAt(x,z,y)<y+4.05)return false;
  return ![...city.nearby(x,z,1.3)].some(v=>v.bottom<y+3.95&&v.top>y+.3&&(city.contact(v,x,z).inside||city.contact(v,x,z).distance2<1.3**2));
 };
 let triangles=0;
 for(const [kind,a] of Object.entries(city.arrays)){
  assert.equal(a.length%9,0,kind+' の面');triangles+=a.length/9;
  assert.equal(a.length/9,data.packing.layers[kind].triangles,kind+' の面数');
  for(let i=0;i<a.length;i++)assert(Number.isFinite(a[i])&&(i%3===1||Math.abs(a[i])<=500.01),kind+' の座標');
 }
 assert.equal(triangles,record.triangles);
 for(const x of [-495,-400,0,400,495])for(const z of [-495,-400,0,400,495])
  assert(Math.abs(city.terrainH(x,z))<.06,'地面は全域を覆う');
 const roadSamples=[];
 for(const [x,z] of record.roadSamples){
  assert(free(x,z),'道路中心線に機体が収まる '+JSON.stringify({x,z}));roadSamples.push([x,z]);
 }
 const concourse=[];
 for(let z=-145;z<=150;z+=2){
  assert(free(-200,z),'駅の横断通路の頭上・幅 '+z);
  const u={pos:new T.Vector3(-200,city.terrainH(-200,z),z),vel:new T.Vector3()};city.resolve(u);
  assert(Math.hypot(u.pos.x+200,u.pos.z-z)<.05,'駅の横断通路の接触 '+z);
  concourse.push(z);
 }
 // 10m格子を床と体積で検査し、途中も2.5m刻みで確かめて壁を飛び越さない。
 const start=[-200,170],queue=[start],seen=new Set([start.join(',')]),quarters=new Set();
 for(let i=0;i<queue.length;i++){
  const [x,z]=queue[i];quarters.add((x>=0?'E':'W')+(z>=0?'S':'N'));
  for(const [dx,dz] of [[10,0],[-10,0],[0,10],[0,-10]]){
   const xx=x+dx,zz=z+dz,key=xx+','+zz;
   if(Math.abs(xx)>490||Math.abs(zz)>490||seen.has(key))continue;
   if(![.25,.5,.75,1].every(f=>free(x+dx*f,z+dz*f)))continue;
   seen.add(key);queue.push([xx,zz]);
  }
 }
 assert.equal(quarters.size,4,'地上で四方の街区へ接続');assert(queue.length>2000,'広域の通行空間');
 const result={extentMeters:1000,layoutBytes:buffer.length,triangles,volumes:city.volumes.length,
  roadSamples:roadSamples.length,concourseSamples:concourse.length,connectedGroundGridPoints:queue.length,
  connectedQuadrants:[...quarters].sort(),coordinateStep:.02,bases:0,plants:0,
  scope:'量子化後の共通ランタイムの床・頭上・体積検査。実機体の走行・Bot対戦・勝率は未検証。'};
 fs.writeFileSync(path.join(folder,'geometry-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exit(1);});
