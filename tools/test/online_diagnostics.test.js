// 直近2秒の診断。実フレーム間隔とCPU時間・受信間隔を混同しない。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const codec=require('../../prototype/online/codec');
const source=fs.readFileSync(require.resolve('../../prototype/online/game.js'),'utf8');
const from=source.indexOf('  const diagnosticWindowMs='),to=source.indexOf('\n  window.CBOnlineGame=',from);
assert(from>=0&&to>from);
let time=0;
const c={now:()=>time,frameStart:0,state:{role:'guest',phase:'playing',lastSnapshot:null,transport:{clock:()=>({rttMs:8})}},
  prediction:{corrections:[],preventedLook:[],pending:Array(4)},player:{onlinePredictionBlocked:'special'},inputSending:{history:[]},document:{visibilityState:'visible'}};
for(const key of ['frameMs','sendMs','history'])Object.defineProperty(c.state,key,{get(){throw Error('不要な履歴参照');}});
vm.createContext(c);vm.runInContext(source.slice(from,to),c);
for(let i=0;i<21;i++){time=i*100;c.frameStart=time;c.diagnosticFrameStart(time);time+=5;c.diagnosticFrameEnd();}
let d=c.diagnostics();assert.equal(d.fps,10);assert.equal(d.frame.meanMs,100);
c.state.role='host';d=c.diagnostics();assert.equal(d.host.frame.meanMs,100);assert.equal(d.host.cpu.meanMs,5);
// ホストの2秒測定をcodecで送っても、guestの表示値は実測100msのまま。
const encoder=new codec.Encoder(),decoder=new codec.Decoder(),encoded=encoder.encode({frame:1,time:time,hostTiming:d.host,units:[]});
decoder.seed(encoded.baseline);const packet=decoder.decode(encoded.delta);
assert.equal(packet.hostTiming.frame.meanMs,100);assert.equal(packet.hostTiming.cpu.meanMs,5);
c.state.role='guest';c.state.lastSnapshot=packet;
for(const [at,frame] of [[1900,1],[1950,2],[1975,2],[2000,3]]){time=at;c.diagnosticArrival(frame);}
time=2050;d=c.diagnostics();assert.equal(d.arrivals.count,2);assert.equal(d.arrivals.meanMs,50);assert.equal(d.snapshotAgeMs,50);assert.equal(d.host.frame.meanMs,100);
c.prediction.corrections=[{at:49,distance:10,reason:'distance'},{at:50,distance:.5,reason:'distance',predictionBlocked:'special'},{at:1000,distance:.1,reason:'smooth'},{at:2000,distance:0,reason:'respawn'},{at:2001,distance:.0001,reason:'smooth'}];
d=c.diagnostics();assert.equal(d.corrections.count,2);assert.equal(d.corrections.samples,4);assert.equal(d.corrections.meanM,.3);assert.equal(d.corrections.maxM,.5);assert.equal(d.corrections.hardSnaps,2);assert.equal(d.corrections.reasons.respawn,1);
assert.equal(d.predictionBlocked,'special');assert.equal(d.blockedCorrections,1);assert.equal(d.rttMs,8);assert.equal(d.pendingInputs,4);
c.prediction.repeatDebt=3;c.prediction.preventedLook=[{at:49,value:90},{at:50,value:2},{at:2000,value:4}];
d=c.diagnostics();assert.equal(d.repeatDebt,3);assert.equal(d.preventedLook.count,2);assert.equal(d.preventedLook.maxDeg,4);
time=5001;d=c.diagnostics();assert.equal(d.fps,null);assert.equal(d.corrections.count,0);assert.equal(d.arrivals.count,0);
assert.equal(d.preventedLook.count,0);assert.equal(d.preventedLook.maxDeg,0);assert.equal(d.repeatDebt,3,'反復控除は2秒窓ではなく現在値');
vm.runInContext('diagnosticTiming=diagnosticState()',c);
for(let i=0;i<1400;i++)c.diagnosticSample(vm.runInContext('diagnosticTiming.frames',c),1,5001);
assert.equal(vm.runInContext('diagnosticTiming.frames.length',c),1200);
for(let i=0;i<1400;i++)c.diagnosticSample(c.prediction.preventedLook,1,5001);
assert.equal(c.prediction.preventedLook.length,1200,'視点防止量も有界');
c.state.phase='idle';c.diagnosticFrameStart(5001);assert.equal(vm.runInContext('diagnosticTiming.lastFrame',c),null);
c.state.role='offline';c.state.lastSnapshot=null;assert.equal(c.diagnostics().host,null);

const ui=fs.readFileSync(require.resolve('../../prototype/online/ui.js'),'utf8');
const start=ui.indexOf('  const diagnostic=document.createElement('),end=ui.indexOf('  const el = id =>',start);assert(start>=0&&end>start);
const element={setAttribute(){}},checkbox={checked:true};let tick,next={role:'guest',phase:'playing',predictionBlocked:'special',blockedCorrections:4,fps:144,frame:{count:20,meanMs:1000/144,p95Ms:7,maxMs:8},arrivals:{count:20,meanMs:50,p95Ms:55,maxMs:70},host:packet.hostTiming,snapshotAgeMs:10,rttMs:8,corrections:{count:4,samples:40,meanM:.123,maxM:.375,hardSnaps:2,reasons:{distance:1,accumulated:1}},visibility:'visible'};
const u={document:{createElement:()=>element,body:{append(){}},getElementById:()=>checkbox,exitPointerLock:()=>{u.exits++;}},setInterval:f=>{tick=f;},CBOnlineGame:{diagnostics:()=>next,active:()=>true,state:{phase:'playing'}},el:()=>checkbox,panel:{hidden:true},exits:0};
vm.createContext(u);vm.runInContext(ui.slice(start,end),u);tick();assert.equal(element.hidden,false);
assert.match(element.textContent,/予測の反復控除（現在） 0コマ.*防いだ視点上書き 0回.*0.000°/);
next={...next,repeatDebt:3,preventedLook:{count:12,maxDeg:4.5678}};tick();
assert.match(element.textContent,/予測の反復控除（現在） 3コマ.*防いだ視点上書き 12回.*4.568°（横・縦の大きい方）/);
assert.match(element.textContent,/先読み停止: 加速・特殊動作.*4回/);assert.match(element.textContent,/画面更新 144fps/);assert.match(element.textContent,/ホスト実測コマ間隔.*100.0 \/ 100.0 \/ 100.0ms/);assert.match(element.textContent,/ホストJS処理.*5.0 \/ 5.0 \/ 5.0ms/);
assert.match(element.textContent,/自機補正.*4回.*0.123m.*0.375m/);assert.match(element.textContent,/hardSnap.*2回.*距離:1、見た目の蓄積:1/);
checkbox.checked=false;tick();assert.equal(element.hidden,true);checkbox.checked=true;next={...next,phase:'idle'};tick();assert.equal(element.hidden,true);
next={...next,phase:'playing',host:null};tick();assert.match(element.textContent,/ホスト実測コマ間隔.*標本待ち/);
let key;u.addEventListener=(type,fn)=>{key=fn;};
const keyStart=ui.indexOf("  addEventListener('keydown', e => {\n    if(!CBOnlineGame.active()"),keyEnd=ui.indexOf('\n  // 試作中',keyStart);assert(keyStart>0&&keyEnd>keyStart);
vm.runInContext(ui.slice(keyStart,keyEnd),u);
let stopped=0,prevented=0;const event=(code,repeat=false)=>({code,repeat,stopImmediatePropagation(){stopped++;},preventDefault(){prevented++;}});
key(event('F3'));assert.equal(checkbox.checked,false);assert.equal(u.exits,0);assert.equal(u.panel.hidden,true);assert.equal(stopped,1);assert.equal(prevented,1);
key(event('F3',true));assert.equal(checkbox.checked,false);
key(event('F3'));assert.equal(checkbox.checked,true);key(event('Escape'));assert.equal(u.panel.hidden,false);assert.equal(u.exits,1);
u.CBOnlineGame.active=()=>false;key(event('F3'));assert.equal(checkbox.checked,true);
console.log('オンライン診断：2秒窓・平均/p95/最大・補正/hardSnap理由・実ホスト100ms/CPU5ms区別・codec・144fps・F3/Escape 成功');
