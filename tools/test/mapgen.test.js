const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {geometry, placements, selectDiverse, routeCover, serialize, facilitiesPass} = require('../mapgen');
const {options,reportDirectory} = require('../generate_map');
const tidal=require('../tidal_mapgen');
const decode = text => {const c={window:{}};vm.runInNewContext(text,c);return JSON.parse(JSON.stringify(c.window.MAP_DATA.fixture));};
const sites = data => [[0,0],[0,60],[0,-60],[data.generation.east,0],[data.generation.east,60],[data.generation.east,-60],[data.generation.west,data.generation.pad],[data.generation.west,-data.generation.pad]].map(([x,z],key)=>({key,x,z,y:x===data.generation.west||x===data.generation.east&&z===0?data.generation.deck:0}));

test('段階1：同じシードで地形を再現し、保存・再読み込みできる',()=>{
  const a=geometry(20261019);
  assert.deepEqual(a,geometry(20261019));
  assert.notDeepEqual(a.terrain,geometry(20261020).terrain);
  assert.deepEqual(decode(serialize('fixture',a)),a);
  assert.ok(a.bridges[0][4]-a.bridges[0][5]>=5);
});
test('段階2：配置シードを変えても共通地形は変わらず、3種類を選べる',()=>{
  const d=geometry(20261019),before=JSON.stringify(d);
  const a=placements(sites(d),20280950,64),b=placements(sites(d),20280951,64);
  assert.notDeepEqual(a,b);
  const selected=selectDiverse(a,3);
  assert.equal(selected.length,3);
  assert.equal(new Set(selected.map(p=>JSON.stringify(p.metrics))).size,3);
  assert.equal(JSON.stringify(d),before);
  for(const p of a) {
    assert.ok(p.metrics.elevated>=1,'すべての戦場に昇降先の高所目標を含める');
    assert.ok(p.plants.length>=3 && p.plants.length<=6);
    assert.equal(p.plants[0][3],'B');assert.equal(p.plants.at(-1)[3],'R');
    const inner=p.plants.slice(1,-1);
    const distances=[210,-210].map(base=>Math.min(...inner.map(q=>Math.hypot(q[1],base-q[2]))));
    assert.ok(Math.max(...distances)/Math.min(...distances)<=1.35);
  }
});
test('予算が足りない場合に3戦場あると偽らない',()=>{
  assert.ok(selectDiverse(placements(sites(geometry(1)),1,1),3).length<3);
  assert.throws(()=>options(['--terrain-attempts','0']));
  assert.throws(()=>options(['--placement-attempts','NaN']));
  assert.throws(()=>options(['--variants','2']));
  assert.throws(()=>options(['--id','../mesa']));
  assert.ok(options(['--seed','4294967295']).placementSeed>=0);
});
test('同条件の再実行でも過去の検証記録を上書きしない',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'core-map-history-'));
  try{
    const first=reportDirectory(root,'fixture','reviewed250');
    fs.writeFileSync(path.join(first,'generation.json'),'最初の失敗');
    const second=reportDirectory(root,'fixture','reviewed250');
    assert.notEqual(first,second);
    assert.equal(fs.readFileSync(path.join(first,'generation.json'),'utf8'),'最初の失敗');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('遮蔽修正でプラントと共通地形を動かさず、比較基準の高架縦断を変えない',()=>{
  const d=geometry(20261019),choices=selectDiverse(placements(sites(d),20280950,64),3),before=JSON.stringify({d,choices});
  for(const choice of choices){
    assert.deepEqual(routeCover(choice),{barricades:[]},'最終版は棄却した追加配置を戻す');
    assert.deepEqual(routeCover(choice,'baseline'),{barricades:[]});
    for(const revision of ['cover1','cover2','repair3']){
    const cover=routeCover(choice,revision);
    if(choice.name==='高架縦断')assert.deepEqual(cover,{barricades:[]});
    for(const [x,z,w,h] of cover.barricades)for(const [,px,pz] of choice.plants){
      assert.ok(Math.hypot(Math.max(0,Math.abs(x-px)-w/2),Math.max(0,Math.abs(z-pz)-h/2))>16,'占拠円は空ける');
    }
    }
  }
  const relay=routeCover({plants:[['A',0,120,'B'],['B',-81,65,null],['C',0,60,null],['D',-81,-65,null],['E',0,-120,'R']],plantPods:[['A',0,153],['E',0,-153]],metrics:{plants:5,offCenter:2,elevated:2,spread:81}},'repair3').plantPods.at(-1);
  for(const [x,z] of [[-4,-45],[16,-89]])assert.ok(Math.hypot(x-relay[1],z-relay[2])<90,'観測した中央地点からBotが選べる補給圏に置く');
  assert.equal(JSON.stringify({d,choices}),before);
});
test('起伏生成は両半面を使い、同じシードで再実行しても地形が増殖しない',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-mapgen-'));
  try {
    const source=path.join(dir,'fixture.js'),d=geometry(20261019);
    fs.writeFileSync(source,serialize('fixture',d));
    const run=()=>execFileSync('python3',['tools/gen_rough.py','fixture','--seed','20261019','--src',source],{cwd:path.resolve(__dirname,'../..')});
    run();const first=fs.readFileSync(source,'utf8');run();assert.equal(fs.readFileSync(source,'utf8'),first);
    const result=decode(first),extra=result.terrain.slice(0,result.terrain.length-d.terrain.length);
    assert.deepEqual(result.terrain.slice(extra.length),d.terrain);
    assert.ok(extra.some(f=>f.z>0) && extra.some(f=>f.z<0));
    for(const f of extra) for(const [x0,x1,z0,z1] of d.paved) assert.ok(Math.hypot(Math.max(0,x0-f.x,f.x-x1),Math.max(0,z0-f.z,f.z-z1))>=f.r-0.1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('★が無くてもポッドが見える・片側未検査・ページエラーなら合格にしない',()=>{
  const good='ポッドA：173か所中 0か所から見える\nポッドF：173か所中 0か所から見える\nページのエラー 0';
  assert.equal(facilitiesPass(good),true);
  assert.equal(facilitiesPass(good.replace('中 0','中 1')),false);
  assert.equal(facilitiesPass(good.split('\n').slice(1).join('\n')),false);
  assert.equal(facilitiesPass(good.replace('ページのエラー 0','ページのエラー 1')),false);
  assert.equal(facilitiesPass(good+'\n★リンクを歩けない'),false);
  assert.equal(facilitiesPass(good+'\nポッド プラントC (38, -27)：300か所中 80か所から見える',['A','F']),true,'中央ポッドの視認は報告するが、完全遮蔽の要件は両端');
  assert.equal(facilitiesPass(good.replace('ポッドA','ポッドQ'),['A','F']),false,'必要な端ポッドの計測漏れは不合格');
  assert.equal(facilitiesPass(good.replace('中 0','中 1'),['A','F']),false,'端ポッドは見えると不合格');
});

test('港湾テーマ：地形を固定して地上争奪・高所干渉・分散の3配置を生成する',()=>{
  const d=tidal.geometry(20261020),before=JSON.stringify(d);
  assert.deepEqual(d,tidal.geometry(20261020));
  assert.equal(d.team,10);assert.equal(d.time,600);
  const sites=d.generation.sites.map(p=>({...p,y:p.x===72?22:0}));
  const proposals=tidal.placements(sites,20261020,192),choices=tidal.select(proposals,3);
  assert.equal(choices.length,3);
  assert.deepEqual(choices.map(p=>p.name),['屈折前線','上層干渉','複路争奪']);
  assert.equal(choices[0].metrics.elevated,0,'主配置の中央は地上');
  assert.ok(choices[1].metrics.elevated>0);
  assert.ok(choices[2].plants.length>choices[0].plants.length);
  for(const choice of choices){
    assert.equal(choice.plants[0][3],'B');assert.equal(choice.plants.at(-1)[3],'R');
    const ids=new Set(choice.plants.map(p=>p[0]));
    assert.ok(choice.plantPods.every(p=>ids.has(p[0])));
    assert.equal(choice.plantPods.length,4,'両端と前線支点を補給点とし、中央争奪点へ足さない');
    for(let i=0;i<choice.plants.length;i++)for(const q of choice.plants.slice(i+1))assert.ok(Math.hypot(choice.plants[i][1]-q[1],choice.plants[i][2]-q[2])>32);
  }
  assert.equal(JSON.stringify(d),before,'配置生成は共通地形を変更しない');
  assert.deepEqual(tidal.select(tidal.placements(sites,20261020,192),3),choices);
  assert.ok(tidal.select(tidal.placements(sites,20261020,1),3).length<3,'予算不足を成功扱いしない');
  const config=options(['--theme','tidal']);assert.equal(config.id,'tidal');assert.equal(config.revision,'tidal7');
  const fort=tidal.geometry(20261020,{revision:'tidal2'});
  assert.deepEqual(fort.plants,d.plants);assert.deepEqual(fort.terrain.slice(0,d.terrain.length),d.terrain);
  assert.deepEqual(fort.jumpPads.slice(0,d.jumpPads.length),d.jumpPads);assert.deepEqual(fort.lifts,d.lifts);
  assert.deepEqual(fort.layout.slice(0,d.layout.length),d.layout);
  assert.deepEqual(fort.bridges.slice(0,d.bridges.length),d.bridges);
  assert.equal(fort.baseDefense.posts.length,2);assert.equal(fort.baseDefense.reinforcements,2);
  assert.equal(options(['--theme','tidal','--revision','tidal1']).revision,'tidal1');
  assert.throws(()=>options(['--theme','tidal','--revision','cover1']));
  assert.throws(()=>options(['--theme','unknown']));
});

test('縦延長：隠した補給点の実寸・ジャンプ高を保ち、両軍の基地と侵入路を作り分ける',()=>{
  const d=tidal.geometry(20261020,{revision:'tidal3'}),old=tidal.geometry(20261020);
  assert.deepEqual(d.size,[185,568]);assert.equal(d.baseZ,512);assert.equal(d.baseLine,440);
  assert.deepEqual(d.jumpPads.slice(0,2).map(p=>p.rise),old.jumpPads.map(p=>p.rise));
  for(const sign of [1,-1]){
    const bank=d.terrain.find(f=>f.x===0&&f.z===357*sign);
    assert.equal(bank.h,5);assert.equal(bank.hz,3);
    assert.ok(d.layout.some(b=>b[1]*sign>440&&b[5]===(sign>0?'office':'prefab')));
    assert.ok(d.layout.some(b=>b[1]*sign>440&&b[5]===(sign>0?'baseWall':'hesco')));
  }
  const choices=tidal.select(tidal.placements(d.generation.sites.map(p=>({...p,y:p.x===72?22:0})),20261020,192),3);
  for(const c of choices){assert.equal(c.plants[0][2],336);assert.equal(c.plantPods[0][2],369);}
  assert.deepEqual(d.raidRoutes.map(r=>r.kind),['rush','covert','radar','sprint']);
  assert.ok(d.raidRoutes[3].points.some(p=>p[2]===10));
});

test('街区追加：基地施設・配置候補を固定し、旧版の再生成と保存先を保つ',()=>{
  const before=tidal.geometry(20261020,{revision:'tidal3'}),after=tidal.geometry(20261020,{revision:'tidal4'});
  for(const key of ['size','baseZ','baseLine','team','time','plants','plantPods','basePods','radar','catapults','turrets'])assert.deepEqual(after[key],before[key],key);
  assert.deepEqual(after.generation.sites,before.generation.sites);
  const baseline={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../mapdesign/tidal/v4/baseline-generator.js'),'utf8'),
    {module:baseline,require:require('node:module').createRequire(path.resolve(__dirname,'../tidal_mapgen.js'))});
  assert.equal(JSON.stringify(baseline.exports.geometry(20261020,{revision:'tidal3'})),JSON.stringify(before),'旧版の保存データを変えない');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'core-district-history-'));
  try{assert.equal(path.dirname(reportDirectory(root,'tidal','tidal4')),path.join(root,'mapdesign/tidal/v4/runs'));}
  finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('橙基地の山：旧街区・青基地・施設を保ち、徒歩の侵入候補を足す',()=>{
  const before=tidal.geometry(20261020,{revision:'tidal4'}),after=tidal.geometry(20261020,{revision:'tidal5'});
  const baseline={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../mapdesign/tidal/v5/baseline-generator.js'),'utf8'),
    {module:baseline,require:require('node:module').createRequire(path.resolve(__dirname,'../tidal_mapgen.js'))});
  assert.equal(JSON.stringify(baseline.exports.geometry(20261020,{revision:'tidal4'})),JSON.stringify(before));
  for(const key of ['size','baseZ','baseLine','team','time','layout','plants','plantPods','basePods','radar','catapults','turrets','jumpPads','lifts','baseDefense'])assert.deepEqual(after[key],before[key],key);
  assert.deepEqual(after.terrain.slice(0,before.terrain.length),before.terrain);
  assert.ok(after.terrain.slice(before.terrain.length).every(f=>(f.z??Math.max(f.z0,f.z1))<0&&f.keepBaseHeight));
  assert.ok(after.generation.mountain.summit>after.generation.mountain.wall);
  assert.deepEqual(after.raidRoutes.map(r=>r.pointsR),before.raidRoutes.map(r=>r.pointsR),'橙の攻撃経由点は維持');
});
