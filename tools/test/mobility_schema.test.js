'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..'),ctx={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(ROOT,'prototype/maps/mobility.js'),'utf8'),ctx);
const base=JSON.parse(JSON.stringify(ctx.window.MAP_DATA.mobility));
function validate(change){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-mobility-schema-'));
  try{
    const d=structuredClone(base);change(d);
    const file=path.join(dir,'fixture.js');fs.writeFileSync(file,'window.MAP_DATA={fixture:'+JSON.stringify(d)+'};');
    return spawnSync('python3',['tools/build_maps.py','--check',file],{cwd:ROOT,encoding:'utf8'});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('昇降設備を保存・検査し、省略した従来マップも受け付ける',()=>{
  assert.equal(validate(()=>{}).status,0);
  assert.equal(validate(d=>{delete d.jumpPads;delete d.lifts}).status,0);
});
test('危険な寸法・速度・高さと壊れた座標を登録しない',()=>{
  const cases=[
    d=>d.jumpPads=null,d=>d.jumpPads[0].at=[0,0],d=>d.jumpPads[0].at[0]=1000,
    d=>d.jumpPads[0].rise=-1,d=>d.jumpPads[0].rise=101,d=>d.jumpPads[0].exit[2]=30,d=>d.jumpPads[0].radius=0,
    d=>d.lifts={},d=>d.lifts[0].from=[0,0,'x'],d=>d.lifts[0].to=d.lifts[0].from,
    d=>d.lifts[0].size=[0,5],d=>d.lifts[0].speed=0,d=>d.lifts[0].speed=31,d=>d.lifts[0].wait=-1,
  ];
  for(const change of cases){const r=validate(change);assert.notEqual(r.status,0,r.stdout+r.stderr);assert.match(r.stdout+r.stderr,/ジャンプパッド|リフト|jumpPads|lifts/);}
});
test('基地平坦化の例外は真偽値と正の高さを要求する',()=>{
  const add=(d,h,keepBaseHeight)=>d.terrain.push({type:'mesa',x:100,z:180,r:5,slope:15,h,keepBaseHeight});
  assert.equal(validate(d=>add(d,14,true)).status,0);
  for(const [h,flag] of [[14,'true'],[-2,true],[0,true]]){
    const r=validate(d=>add(d,h,flag));assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/keepBaseHeight/);
  }
});
test('侵入路の到達半径は陣営ごとに正の14m以下を要求する',()=>{
  const add=(d,pointRadius)=>d.raidRoutes=[{kind:'covert',objective:'core',points:[[0,0,0]],pointRadius}];
  assert.equal(validate(d=>add(d,{B:4})).status,0);
  for(const v of [null,[],{B:0},{R:15},{B:'4'},{X:4}]){
    const r=validate(d=>add(d,v));assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/pointRadius/);
  }
});
