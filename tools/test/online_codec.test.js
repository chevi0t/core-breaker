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

// 確定host dtは一般状態の1ms丸めと分離して保持する。
{
 const C=require('../../prototype/online/codec.js'),e=new C.Encoder(),d=new C.Decoder();
 const value={time:0,frame:1,inputAcks:{'B:0':{seq:3,step:9,seqDt:1/60,totalDt:7/60,steps:[{step:9,seq:3,dt:1/60,seqDt:1/60,pressed:true}]}}};
 const first=e.encode(value);if(!d.seed(first.baseline))throw Error('ack baseline seed failed');
 require('node:assert/strict').deepEqual(d.decode(first.delta).inputAcks,value.inputAcks);
 value.time=10;value.frame++;value.inputAcks['B:0'].steps[0].dt=1/144;value.inputAcks['B:0'].seqDt+=1/144;
 const next=e.encode(value);if(next.baseline)d.seed(next.baseline);
 require('node:assert/strict').deepEqual(d.decode(next.delta).inputAcks,value.inputAcks);
 console.log('状態写真codec：実host可変dtは丸めず保持 成功');
}

// 受信者別の基準と更新mask。間引いた機体を毎回同じ基準差分として送らない。
{
 const e=new Encoder(),d=new Decoder(),s=copy(initial);
 s.units=s.units.slice(0,3);s.unitUpdates=7;s.visibilityEpoch=1;
 s.inputAcks={U0:{seq:1,seqDt:1/144,totalDt:7/144}};
 const encode=(value,options={})=>{
   const rebased=e.willRebase(value,options);
   if(rebased)value.unitUpdates=2**value.units.length-1;
   const mask=value.unitUpdates;
   const wire=e.encode(value,{...options,includePath:path=>path[0]!=='units'||typeof path[1]!=='number'||!!(mask&(1<<path[1]))});
   assert.equal(!!wire.baseline,rebased);
   if(wire.baseline)assert(d.seed(wire.baseline));
   return wire;
 };
 let w=encode(s),r=d.decode(w.delta);assert.equal(r.unitUpdates,7);
 s.frame++;s.time+=50;s.units[1].pos=[123.45,56.78,90.12];s.units[1].hp=8000;
 w=encode(s);assert.equal(w.baseline,null);assert.equal(d.decode(w.delta).units[1].hp,8000);
 s.frame++;s.time+=50;s.unitUpdates=1;s.units[0].pos=[10,20,30];
 const sparse=encode(s);r=d.decode(sparse.delta);
 assert.equal(r.unitUpdates,1);assert.equal(r.units[1].hp,initial.units[1].hp);
 // omitしたunitの復元値は意図的に古い基準のまま。gameはunitUpdates=falseを適用しない。
 const omitted=copy(s);omitted.units[1].pos=[678.9,123.4,567.8];omitted.units[1].hp=1;
 assert.deepEqual(encode(omitted).delta,sparse.delta);
 // 直前の更新写真を欠損しても、次の更新は共通基準だけで最新へ復元できる。
 s.frame++;s.time+=50;s.unitUpdates=3;s.units[1].hp=7000;
 encode(s);s.frame++;s.time+=50;s.units[1].hp=6000;
 w=encode(s);r=d.decode(w.delta);assert.equal(r.units[1].hp,6000);assert.deepEqual(r.units[1].pos,[123.45,56.78,90.12]);
 assert.deepEqual(r.inputAcks,s.inputAcks);
 // maskの数値だけが変わってもschemaは安定。新フィールド/削除/装備/再出撃は全可視更新。
 s.unitUpdates=1;assert.equal(e.willRebase(s),false);
 s.units[1].slots.main.extra={phase:1};s.units[1].lifeId=2;s.units[1].slots.main.key='new-rifle';
 assert.equal(e.willRebase(s),true);w=encode(s);assert.equal(s.unitUpdates,7);
 r=d.decode(w.delta);assert.equal(r.units[1].lifeId,2);assert.equal(r.units[1].slots.main.key,'new-rifle');assert.equal(r.units[1].slots.main.extra.phase,1);
 delete s.units[1].slots.main.extra;s.unitUpdates=1;w=encode(s);assert(w.baseline.s);assert.equal(d.decode(w.delta).units[1].slots.main.extra,undefined);
 s.time+=10000;s.frame++;s.unitUpdates=1;assert(e.willRebase(s));w=encode(s);assert.equal(s.unitUpdates,7);
 assert(w.baseline.parent);assert.deepEqual(d.decode(w.delta).inputAcks,s.inputAcks);
 // 同数の可視入替もforceで独立した完全基準へ。旧機体の位置/内部状態は再同期しない。
 s.units[1].pos=[9876.54,8765.43,7654.32];s.units[1].transfer={privateMarker:'hidden-transfer'};
 w=encode(s,{forceBaseline:true});const secretBase=e.currentBase();assert(JSON.stringify(secretBase).includes('hidden-transfer'));
 s.units[1]=copy(initial.units[4]);s.visibilityEpoch++;s.unitUpdates=1;
 assert(e.willRebase(s,{forceBaseline:true}));w=encode(s,{forceBaseline:true});
 assert.equal(w.baseline.parent,undefined);assert(w.baseline.s&&w.baseline.d);assert.equal(s.unitUpdates,7);
 const clean=JSON.stringify(w);assert(!clean.includes('hidden-transfer'));assert(!clean.includes('987654'));
 const fresh=new Decoder();assert(fresh.seed(e.currentBase()));r=fresh.decode(w.delta);
 assert.deepEqual(r.units.map(u=>u.id),['U0','U4','U2']);assert.equal(r.units[1].transfer,null);
 // 不可視化で配列を詰め、全消去した空配列も過去の位置なしに単独復元する。
 s.units=s.units.filter(u=>u.id!=='U4');s.visibilityEpoch++;w=encode(s,{forceBaseline:true});
 assert.equal(w.baseline.parent,undefined);assert(!JSON.stringify(e.currentBase()).includes('hidden-transfer'));
 s.units=[];s.visibilityEpoch++;w=encode(s,{forceBaseline:true});assert.equal(s.unitUpdates,0);assert.deepEqual(d.decode(w.delta).units,[]);
 // 20機の最上位bitまで数値として正確に戻り、更新集合で基準を作り直さない。
 const many=new Encoder(),manyDecoder=new Decoder(),twenty={time:0,units:Array.from({length:20},(_,i)=>({id:'T'+i,pos:[i,0,0]})),unitUpdates:2**20-1};
 const first=many.encode(twenty);assert(manyDecoder.seed(first.baseline));assert.equal(manyDecoder.decode(first.delta).unitUpdates,2**20-1);
 twenty.time=50;twenty.unitUpdates=1<<19;assert.equal(many.willRebase(twenty),false);
 const next=many.encode(twenty);assert.equal(next.baseline,null);assert.equal(manyDecoder.decode(next.delta).unitUpdates,1<<19);
 console.log('状態写真codec：機体別差分省略・独立復元・20bit更新mask・全可視基準更新・不可視化再同期 成功');
}

// 固定スロットは秘匿のたびに構造・基準を変えず、nullable項目だけ独立差分にする。
{
 const makeVisible=(i=0)=>({fixedUnit:true,id:'R:'+i,hidden:false,visibilityEpoch:1,team:'R',idx:i,cls:'assault',controller:'bot',
   motionEpoch:1,lagEpoch:1,renderCrouch:0,predictionBlocked:'',jumpPadIndex:-1,zipLine:-1,
   pos:[9876.54,8765.43,7654.32],vel:[3,4,5],hp:10000,alive:true,yaw:.5,pitch:0,downYaw:null,weapon:'main',onGround:true,
   mech:{head:'private-head',parts:{body:'private-body'}},catLaunch:{origin:[11,12,13],time:3},
   motionVectors:{dashDir:[1,0,0],boostVisualDir:null,catMomentum:[2,3,4],lungeDir:null},
   swing:{a:'private-swing',t:.25},transfer:{base:'private-transfer',at:[21,22,23]},
   slots:Object.fromEntries(['main','sub','aux','special'].map(k=>[k,{key:'private-'+k,ammo:30,reloadT:null,held:false,chargeT:0}]))});
 // 実機の値から埋めない専用中立テンプレート。id/epoch以外は常に同一。
 const makeHidden=(i,epoch)=>({fixedUnit:true,id:'R:'+i,hidden:true,visibilityEpoch:epoch,team:'',idx:0,cls:'',controller:'',
   motionEpoch:0,lagEpoch:0,renderCrouch:0,predictionBlocked:'',jumpPadIndex:-1,zipLine:-1,
   pos:[0,0,0],vel:[0,0,0],hp:null,alive:null,yaw:null,pitch:null,downYaw:null,weapon:null,onGround:null,
   mech:null,catLaunch:null,motionVectors:{dashDir:null,boostVisualDir:null,catMomentum:null,lungeDir:null},swing:null,transfer:null,
   slots:Object.fromEntries(['main','sub','aux','special'].map(k=>[k,{key:'',ammo:null,reloadT:null,held:null,chargeT:null}]))});
 const e=new Encoder(),d=new Decoder(),s={time:0,frame:0,unitUpdates:2**20-1,units:Array.from({length:20},(_,i)=>makeVisible(i)),
   gadgets:[[1],[1]],inputAcks:{'B:0':{seq:1,seqDt:1/144,totalDt:7/144,steps:[{dt:1/144}]}}};
 let w=e.encode(s);assert(d.seed(w.baseline));const retainedVisibleBase=e.currentBase();
 assert(JSON.stringify(retainedVisibleBase).includes('private-transfer'));
 const schema=JSON.stringify(retainedVisibleBase.s);
 assert.equal(retainedVisibleBase.s.find(([p])=>JSON.stringify(p)==='["units",0,"pos",0]')[1],100);
 assert.equal(retainedVisibleBase.s.find(([p])=>JSON.stringify(p)==='["units",0,"slots","main","reloadT"]')[1],'j');
 assert(!retainedVisibleBase.s.some(([p])=>p[0]==='units'&&(p.length===2||p[2]==='slots'&&p.length<5)));
 let baselineCount=1;
 for(let n=1;n<=120;n++){
   s.time=n*50;s.frame=n;s.unitUpdates=0;
   const hidden=n%3!==0;
   s.units=s.units.map((_,i)=>hidden?makeHidden(i,n):makeVisible(i));
   if(!hidden){
     for(const u of s.units){
       u.visibilityEpoch=n;u.hp=10000-n;u.downYaw=.75;
       u.mech=n%2?null:{head:'changed',extra:[1,2,3]};u.catLaunch=null;u.swing=null;u.transfer=null;
       u.motionVectors={dashDir:null,boostVisualDir:[0,1,0],catMomentum:null,lungeDir:[1,0,0]};
       u.slots.main.reloadT=1.25;u.slots.sub.held=true;u.slots.special.chargeT=null;
     }
   }
   s.gadgets=n%2?[[1],[2,0,14,15,16,'visible']]:[[2,1,17,18,19],[1]];
   assert.equal(e.willRebase(s),false);
   // 不可視機体はmaskで全て落とそうとしても中立差分を繰り返し送る。
   w=e.encode(s,{includePath:p=>p[0]!=='units'||!hidden});
   if(w.baseline){baselineCount++;assert(d.seed(w.baseline));}
   assert.equal(JSON.stringify(e.currentBase().s),schema);
   const r=d.decode(w.delta);
   assert.deepEqual(r.units,s.units);assert.deepEqual(r.gadgets,s.gadgets);assert.deepEqual(r.inputAcks,s.inputAcks);
 }
 assert.equal(baselineCount,1);
 // 可視の低頻度スロットは従来どおり省略し、maskで適用を止める。
 s.time+=50;s.units[0].hp=1;s.units[0].pos=[1,2,3];
 w=e.encode(s,{includePath:p=>p[0]!=='units'});
 assert.equal(w.baseline,null);assert.deepEqual(d.decode(w.delta).units[0],{...makeVisible(0),visibilityEpoch:s.units[0].visibilityEpoch});
 // 実際に可視だった古い基準を保持し、最初のhideを欠損しても次のhideだけで中立へ。
 s.units=s.units.map((_,i)=>makeHidden(i,121));s.time+=50;e.encode(s,{includePath:()=>false});
 s.time+=50;w=e.encode(s,{includePath:p=>p[0]!=='units'});
 const oldReceiver=new Decoder();assert(oldReceiver.seed(retainedVisibleBase));
 assert.deepEqual(oldReceiver.decode(w.delta).units,s.units);
 assert(!JSON.stringify(oldReceiver.decode(w.delta)).includes('private-'));
 // resyncは現在の中立値を完全基準化し、旧秘密値を新規受信者へ再送しない。
 w=e.encode(s,{forceBaseline:true,includePath:()=>false});assert.equal(w.baseline.parent,undefined);
 assert(!JSON.stringify(w.baseline).includes('private-'));assert(!JSON.stringify(e.currentBase()).includes('987654'));
 const fresh=new Decoder();assert(fresh.seed(e.currentBase()));assert.deepEqual(fresh.decode(w.delta).units,s.units);
 // hidden基準からのreveal後、空間更新のない写真でも可視フラグ/epochは毎回独立復元。
 const hiddenBase=e.currentBase(),hiddenReceiver=new Decoder();assert(hiddenReceiver.seed(hiddenBase));
 s.time+=50;s.unitUpdates=2**20-1;s.units=s.units.map((_,i)=>({...makeVisible(i),visibilityEpoch:122}));
 const reveal=e.encode(s);assert.equal(reveal.baseline,null);
 const revealState=hiddenReceiver.decode(reveal.delta);assert.deepEqual(revealState.units,s.units);
 for(let n=0;n<3;n++){
   s.time+=50;s.unitUpdates=0;s.units[0].pos=[100+n,200,300];s.units[0].hp=10+n;
   const held=e.encode(s,{includePath:p=>p[0]!=='units'});assert.equal(held.baseline,null);
   // reveal写真を受け取った履歴に依存せず、同じhidden基準だけで検証する。
   const independent=new Decoder();assert(independent.seed(hiddenBase));
   const heldState=independent.decode(held.delta);assert.equal(heldState.unitUpdates,0);
   for(let i=0;i<s.units.length;i++){
     assert.equal(heldState.units[i].id,s.units[i].id);assert.equal(heldState.units[i].fixedUnit,true);
     assert.equal(heldState.units[i].hidden,false);assert.equal(heldState.units[i].visibilityEpoch,122);
     assert.deepEqual(heldState.units[i].pos,[0,0,0]);assert.equal(heldState.units[i].hp,null);
   }
   // 空間値はmask=0で適用しない。直前のreveal位置を表示側に保持する契約。
   const rendered=copy(revealState.units);
   heldState.units.forEach((u,i)=>{if(heldState.unitUpdates&(1<<i))rendered[i]=u;});
   assert.deepEqual(rendered,revealState.units);
 }
 // 定期更新だけは従来の10秒周期。可視化の型変化では新schemaを付けない。
 s.time+=10000;s.units=s.units.map((_,i)=>makeVisible(i));assert(e.willRebase(s));
 w=e.encode(s);assert(w.baseline.parent);assert.equal(w.baseline.s,undefined);
 assert(fresh.seed(w.baseline));assert.deepEqual(fresh.decode(w.delta).units,s.units);
 console.log('状態写真codec：固定20スロット120回切替・nullable項目・基準数一定・旧基準hide欠損・秘匿mask・再同期 成功');
}
