// ブラウザと同じ判定を実game/codecの写真へ適用。描画・実WebRTCはこの試験の対象外。
const assert=require('node:assert/strict'),test=require('node:test'),vm=require('node:vm');
const fixture=require('./online_equipment_fixture');
const {publicStateChecks}=require('./online_visibility_assertions');
const browserChecks=vm.runInNewContext('('+publicStateChecks.toString()+')');
const copy=x=>JSON.parse(JSON.stringify(x));
function preserved(actual,expected,label){
  for(const check of browserChecks(actual,expected))assert(check.value,label+' '+check.name+' '+JSON.stringify(check.data));
  // 比較器自身だけで成功を決めず、Nodeの独立した構造比較でも値の保存を確かめる。
  for(const key of ['cores','plants','timeLeft'])assert.deepEqual(copy(actual[key]),copy(expected[key]),label+' '+key);
}
for(const team of ['B','R'])test(team+'向けの初期/差分/定期基準/再同期は公開状態の値を保存',()=>{
  const f=fixture(process.env.CB_VISIBILITY_ROOT),{c,game,codec,peer}=f;
  peer.unitId=team+':0';
  c.plants.push({id:'A',owner:null,gauge:0,capturing:null,contested:false},
    {id:'B',owner:'R',gauge:.375,capturing:'B',contested:true});
  const guest=fixture(process.env.CB_VISIBILITY_ROOT);guest.c.paintPlant=()=>{};
  guest.c.plants.push(...copy(c.plants));guest.game.state.role='guest';
  const d=new codec.Decoder();let last;
  const verify=(wire,expected,label)=>{
    if(wire.baseline){assert(d.seed(wire.baseline));preserved(d.decode([wire.baseline.v,wire.baseline.id,'']),expected,label+'/base');}
    const decoded=d.decode(wire.wire.delta);preserved(decoded,expected,label+'/delta');
    guest.test.applySnapshot(decoded);preserved(guest.game.snapshot(),expected,label+'/guest');
    last=wire;return decoded;
  };
  let full=game.snapshot(),wire=f.test.encodePeerSnapshot(peer,full,true),initial=verify(wire,full,'initial');
  assert.notEqual(JSON.stringify(initial.plants),JSON.stringify(full.plants),'旧比較ではキー順だけで落ちる');
  assert.equal(JSON.stringify(initial.cores),JSON.stringify(full.cores));assert.equal(initial.timeLeft,full.timeLeft);
  c.cores.B.hp=8123;c.cores.R.hp=7654;c.timeLeft=287.125;
  Object.assign(c.plants[0],{owner:'B',gauge:.625,capturing:'R',contested:true});
  Object.assign(c.plants[1],{owner:null,gauge:0,capturing:null,contested:false});
  game.state.frame++;f.setTime(1050);f.test.encodePeerSnapshot(peer,game.snapshot()); // この差分は落とす。
  c.plants[0].gauge=.875;game.state.frame++;f.setTime(1100);full=game.snapshot();
  wire=f.test.encodePeerSnapshot(peer,full);assert.equal(wire.baseline,null);verify(wire,full,'dropped-delta');
  game.state.frame++;f.setTime(12000);full=game.snapshot();wire=f.test.encodePeerSnapshot(peer,full);
  assert(wire.baseline.parent);verify(wire,full,'periodic-base');
  game.state.frame++;f.setTime(12050);full=game.snapshot();full.visibilityFixture={version:1};
  wire=f.test.encodePeerSnapshot(peer,full);assert(wire.baseline.s);verify(wire,full,'schema-base');
  const fresh=new codec.Decoder();assert.equal(fresh.decode(last.wire.delta),null);
  assert(fresh.seed(peer.replication.encoder.currentBase()));preserved(fresh.decode(last.wire.delta),full,'full-resync');
});
test('キー順以外の破損とプラント配列の並べ替えを見逃さない',()=>{
  const expected={cores:{B:9000,R:8000},plants:[{id:'A',owner:null,gauge:0,capturing:null,contested:false},
    {id:'B',owner:'R',gauge:.25,capturing:'B',contested:true}],timeLeft:300};
  const reordered={cores:{R:8000,B:9000},plants:expected.plants.map(p=>Object.fromEntries(Object.entries(p).reverse())),timeLeft:300};
  assert(browserChecks(reordered,expected).every(c=>c.value));
  const mutations=[['cores',s=>s.cores.B--],['cores',s=>delete s.cores.R],['timeLeft',s=>s.timeLeft--],
    ['timeLeft',s=>s.timeLeft='300'],['plants',s=>s.plants.reverse()],['plants',s=>s.plants.pop()],
    ...['id','owner','gauge','capturing','contested'].flatMap(k=>[
      ['plants',s=>{s.plants[0][k]=({id:'X',owner:'B',gauge:.001,capturing:'R',contested:true})[k];}],
      ['plants',s=>{delete s.plants[0][k];}]]),['plants',s=>s.plants[0].extra=1]];
  for(const [field,mutate]of mutations){const actual=copy(expected);mutate(actual);
    assert.equal(browserChecks(actual,expected).find(c=>c.data.field===field).value,false,field+'の破損を検出');}
});
