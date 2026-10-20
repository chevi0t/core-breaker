// 既存地形の値を旧本体と照合し、基地脇の山だけ平坦化を外せることを調べる。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../..');
function shape(file){
  const source=fs.readFileSync(path.join(ROOT,file),'utf8'),start=source.indexOf('function featureH('),end=source.indexOf('// 高さは1m間隔',start);
  const smooth=source.match(/^const smooth = .*$/m)[0];
  return vm.runInNewContext(smooth+'\n'+source.slice(start,end)+'\nterrainShape;');
}
const old=shape('mapdesign/tidal/v5/baseline-engine.html'),current=shape('prototype/index.html');
test('旧街区の全域2m格子で、平坦化項目なしの地面高さを旧本体と一致させる',()=>{
  const c={window:{}};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'mapdesign/tidal/v5/baseline-map.js'),'utf8'),c);
  const d=c.window.MAP_DATA.tidal;
  for(let z=-d.size[1];z<=d.size[1];z+=2)for(let x=-d.size[0];x<=d.size[0];x+=2)assert.equal(current(x,z,d.terrain,d.baseLine),old(x,z,d.terrain,d.baseLine));
});
test('指定した山を基地脇にも残し、山の外の平坦面・窪地は変えない',()=>{
  const hill={type:'mesa',x:-164,z:-480,r:10,slope:25,h:14};
  assert.equal(current(-164,-480,[hill],440),0);
  hill.keepBaseHeight=true;
  assert.equal(current(-164,-480,[hill],440),14);
  assert.equal(current(0,-512,[hill],440),0);
  const trench={type:'trench',x:0,z0:-370,z1:-360,w:12,slope:3,h:-2};
  assert.equal(current(0,-365,[hill,trench],440),-2);
});
