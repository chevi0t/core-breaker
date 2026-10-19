const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {geometry, placements, selectDiverse, serialize, facilitiesPass} = require('../mapgen');
const {options} = require('../generate_map');
const decode = text => {const c={window:{}};vm.runInNewContext(text,c);return JSON.parse(JSON.stringify(c.window.MAP_DATA.fixture));};
const sites = data => [[0,0],[0,60],[0,-60],[data.generation.east,0],[data.generation.east,60],[data.generation.east,-60],[data.generation.west,data.generation.pad],[data.generation.west,-data.generation.pad]].map(([x,z],key)=>({key,x,z,y:x===data.generation.west?data.generation.deck:0}));

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
});
