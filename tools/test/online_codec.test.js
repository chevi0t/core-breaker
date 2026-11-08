// 写真の間引き・基準更新・再同期を、実ネットワークと分けて決定的に検証する。
const assert=require('node:assert/strict');
const {Encoder,Decoder}=require('../../prototype/online/codec');
const copy=x=>JSON.parse(JSON.stringify(x));
const initial={frame:1,time:100,timeLeft:300,running:true,ended:false,teamSize:5,cores:{B:10000,R:10000},plants:[{id:'A',owner:null,gauge:0}],turrets:[],radars:[],barricades:[],shells:[],spotted:{B:[],R:[]},spotSrc:{B:[],R:[]},acks:{'R:0':0},units:Array.from({length:10},(_,i)=>({id:'U'+i,name:'機体'+i,team:i<5?'B':'R',cls:'assault',controller:'bot',pos:[i*10,0,-i*10],vel:[0,0,0],yaw:0,pitch:0,hp:10000,alive:true,lifeId:1,respawnT:0,boost:100,sc:{kills:0},swing:null,transfer:null,slots:{main:{key:'rifle',ammo:30,reloadT:0}}}))};
const encoder=new Encoder(),decoder=new Decoder();
let wire=encoder.encode(initial);assert(wire.baseline);assert(decoder.seed(wire.baseline));assert.deepEqual(decoder.decode(wire.delta),copy(initial));
// 直前のdeltaを破棄しても次の写真単独で基準から復元。
let changed=copy(initial);changed.frame=2;changed.time+=50;changed.units[0].pos=[12.345,-1.234,0.006];changed.units[0].yaw=1.23456;encoder.encode(changed);
changed.frame=3;changed.time+=50;changed.units[0].hp=8700;changed.units[0].slots.main.ammo=29;
wire=encoder.encode(changed);assert.equal(wire.baseline,null);let restored=decoder.decode(wire.delta);
assert.deepEqual(restored.units[0].pos,[12.35,-1.23,.01]);assert.equal(restored.units[0].yaw,1.235);assert.equal(restored.units[0].hp,8700);assert.equal(restored.units[0].slots.main.ammo,29);
// 不変の名前・装備は定期基準にも再収録しない。施設・再出撃・装備変更は失わない。
changed.time+=10000;changed.frame++;changed.units[0].lifeId++;changed.units[0].name='変更後';changed.units[0].slots.main.key='rifle2';changed.plants[0].owner='R';
wire=encoder.encode(changed);assert(wire.baseline.parent);assert(!wire.baseline.s);assert(!JSON.stringify(wire.baseline).includes('機体1'));assert(decoder.seed(wire.baseline));restored=decoder.decode(wire.delta);assert.equal(restored.units[0].lifeId,2);assert.equal(restored.units[0].slots.main.key,'rifle2');assert.equal(restored.plants[0].owner,'R');
// 基準を受け損ねた場合は適用せず、完全基準の要求で回復。
const empty=new Decoder();assert.equal(empty.decode(wire.delta),null);assert.equal(empty.seed(wire.baseline),false);assert(empty.seed(encoder.currentBase()));assert.deepEqual(empty.decode(wire.delta),restored);
changed.units[0].slots.main.newField=4;wire=encoder.encode(changed);assert(wire.baseline.s);assert(decoder.seed(wire.baseline));assert.equal(decoder.decode(wire.delta).units[0].slots.main.newField,4);
assert.equal(decoder.decode([1,wire.delta[1],'////']),null);
changed.units[0].yaw=40*Math.PI+.5;changed.units[0].pos=[999.999,-600.123,500.009];delete changed.units[0].slots.main.newField;
wire=encoder.encode(changed);if(wire.baseline)assert(decoder.seed(wire.baseline));restored=decoder.decode(wire.delta);
assert.equal(restored.units[0].yaw,.5);assert.deepEqual(restored.units[0].pos,[1000,-600.12,500.01]);assert.equal(restored.units[0].slots.main.newField,undefined);
console.log('状態写真codec：cm丸め・角度丸め・間引き・差分基準・装備/施設/再出撃・再同期 成功');
// 危険なpath/入れ子値は適用せず、Object.prototypeへ触れない。
for(const key of ['__proto__','prototype','constructor']){
  assert.equal(new Decoder().seed({v:1,id:1,s:[[[key,'polluted'],'j']],d:[true]}),false);
  const value=JSON.parse('{"'+key+'":{"polluted":true}}');
  assert.equal(new Decoder().seed({v:1,id:1,s:[[['shells'],'j']],d:[value]}),false);
}
assert.equal({}.polluted,undefined);
assert.equal(new Decoder().seed({v:1,id:1,s:[[['x'],'j'],[['x'],'j']],d:[1,2]}),false);
const undefEncoder=new Encoder(),undefDecoder=new Decoder();
let undef=undefEncoder.encode({frame:1,time:0,optional:2,units:[{temp:undefined}],shells:[undefined]});
assert(undefDecoder.seed(undef.baseline));assert.deepEqual(undefDecoder.decode(undef.delta),{frame:1,time:0,optional:2,units:[{}],shells:[null]});
undef=undefEncoder.encode({frame:2,time:50,optional:undefined,units:[{temp:undefined}],shells:[]});
assert(undefDecoder.seed(undef.baseline));assert.equal(Object.hasOwn(undefDecoder.decode(undef.delta),'optional'),false);
console.log('状態写真codec：危険キー拒否・undefined省略/配列null化 成功');
for(const [type,value] of [[100,'abc'],[100,Infinity],['b',3],['b',true],['s',3]])assert.equal(new Decoder().seed({v:1,id:1,s:[[['x'],type]],d:[value]}),false);
const inherited=new Decoder();assert(inherited.seed({v:1,id:1,s:[[['toString','safe'],'j']],d:[true]}));assert.deepEqual(inherited.decode([1,1,'']),{toString:{safe:true}});assert.equal(Object.prototype.toString.safe,undefined);
console.log('状態写真codec：schema値型整合・継承property非参照 成功');
// マップ昇降施設も位置はcm・動作状態は基準差分から独立復元。
const mobilityEncoder=new Encoder(),mobilityDecoder=new Decoder();
let mobility={time:0,frame:0,mobility:{lifts:[{pos:[0,1,2],direction:1,waitT:2,blocked:false}],jumpPads:[0],catapults:[{flash:0,opacity:.16}]}};
let mw=mobilityEncoder.encode(mobility);assert(mobilityDecoder.seed(mw.baseline));
mobility=copy(mobility);mobility.time=50;mobility.frame=1;mobility.mobility.lifts[0]={pos:[0,3.456,2],direction:-1,waitT:0,blocked:true};mobility.mobility.jumpPads[0]=.9;mobility.mobility.catapults[0]={flash:1,opacity:.82};
mw=mobilityEncoder.encode(mobility);const mr=mobilityDecoder.decode(mw.delta);assert.equal(mr.mobility.lifts[0].pos[1],3.46);assert.equal(mr.mobility.lifts[0].blocked,true);assert.equal(mr.mobility.jumpPads[0],.9);assert.equal(mr.mobility.catapults[0].opacity,.82);
console.log('状態写真codec：リフト・射出施設の表示状態 成功');
