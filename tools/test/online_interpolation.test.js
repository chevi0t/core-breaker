// 通信・WebGLを使わず製品game.jsを実行。試験用参照はVMのソースへだけ追加し、製品APIへ出さない。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const codec=require('../../prototype/online/codec'),visibility=require('../../prototype/online/visibility');
const copy=x=>JSON.parse(JSON.stringify(x)),empty=()=>{};
class V3 {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  fromArray(a){[this.x,this.y,this.z]=a;return this;}
  toArray(){return [this.x,this.y,this.z];}
  copy(v){return this.fromArray(v.toArray());}
  clone(){return new V3().copy(this);}
  lerp(v,f){this.x+=(v.x-this.x)*f;this.y+=(v.y-this.y)*f;this.z+=(v.z-this.z)*f;return this;}
  addScaledVector(v,n){this.x+=v.x*n;this.y+=v.y*n;this.z+=v.z*n;return this;}
  distanceToSquared(v){return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2;}
}
function harness(){
  let time=0,finishes=0;const sent=[],elements=new Map();
  const makeUnit=id=>({entityId:id,team:id[0],idx:Number(id.slice(2)),cls:'assault',name:id,lifeId:1,alive:true,hp:100,downT:0,pos:new V3(),vel:new V3(10),yaw:0,pitch:0,slots:{},sc:{total:0,kills:0,coreDmg:0},group:{visible:true}});
  const units=[makeUnit('B:0'),makeUnit('R:0')];
  const c={MAPS:{mesa:{name:'台地',team:5,time:300}},T:{Vector3:V3},performance:{now:()=>time},Map,Set,Date,Math,console,setTimeout,clearTimeout,CBOnlineCodec:codec,CBOnlineVisibility:visibility,
    // 近距離2機・壁なし。可視性判定自体は製品moduleを通す。
    canSee:()=>true,noticed:()=>false,targetPoint:u=>u.pos.clone(),
    window:{},SLOTS:[],WEAPONS:{},CLASSES:{assault:{},heavy:{}},units,player:units[0],running:true,ended:false,timeLeft:300,cores:{B:{hp:1000},R:{hp:1000}},spotted:{B:new Map(),R:new Map()},spotSrc:{B:new Map(),R:new Map()},plants:[],turrets:[],radars:[],barricades:[],lifts:[],jumpPads:[],catapults:[],ziplines:[],shells:[],
    document:{exitPointerLock:empty},$:id=>{if(!elements.has(id))elements.set(id,{querySelector:()=>null});return elements.get(id);},wrapAngle:x=>Math.atan2(Math.sin(x),Math.cos(x)),
    showPage:empty,stopLoopingGameSounds:empty,bgmTick:empty,tutorialClearInput:empty,setSimulationRole:empty,addEventListener:empty,weaponLook:empty,tracer:empty,boom:empty,impact:empty,sfx:empty,shot:empty,shoot:empty,blast:empty,damage:empty,
    doTransfer:u=>{u.pos.fromArray([900,0,0]);u.transfer=null;return 42;},
    finish:()=>{finishes++;c.ended=true;c.running=false;},SFX:{},scene:{remove:empty}};
  vm.createContext(c);
  let source=fs.readFileSync(require.resolve('../../prototype/online/game'),'utf8');
  source=source.replace('  window.CBOnlineGame={create',`  window.__onlineTest={resetMeasurements,receiveSnapshot,handleSnapshotControl,requestSnapshotResync,interpolate,onMessage,
    reset:()=>{resetMeasurements();prepared=true;state.role='guest';state.phase='playing';state.matchId='test';state.localUnitId='B:0';},
    pending:()=>[...pendingSnapshotWires.values()],decoder:()=>snapshotDecoder,
    unprepare:()=>{prepared=false;pendingPrepare=null;state.phase='lobby';setupWorld=()=>{state.localUnitId='B:0';};}};
  window.CBOnlineGame={create`);
  vm.runInContext(source,c);const game=c.window.CBOnlineGame,test=c.window.__onlineTest;
  test.reset();game.state.transport={send:(type,data,id)=>{sent.push({type,data:copy(data),id,time});return true;},broadcast(type,data){return this.send(type,data);},metrics:()=>({})};
  return {game,test,c,sent,units,at:t=>time=t,finishCount:()=>finishes};
}
function snapshot(frame,time,{x=time/100,life=1,alive=true,epoch=0,core=1000,score=frame,extra=false}={}){
  return {frame,time,timeLeft:300-time/1000,running:true,ended:false,cores:{B:1000,R:core},spotted:{B:[],R:[]},spotSrc:{B:[],R:[]},plants:[],turrets:[],radars:[],barricades:[],shells:[],acks:{},
    units:['B:0','R:0'].map((id,i)=>({id,name:id,cls:'assault',controller:i?'bot':'localHuman',lifeId:life,motionEpoch:epoch,alive,hp:100,downT:0,pos:[x,0,0],vel:[10,0,0],yaw:0,pitch:0,slots:{},sc:{total:score,kills:0,coreDmg:0},transfer:null,swing:null,...(extra?{optional:1}:{})}))};
}
function encode(e,s){const w=e.encode(s);return {base:w.baseline,wire:{frame:s.frame,delta:w.delta}};}
function deliver(h,e,s,t=s.time){h.at(t);const w=encode(e,s);if(w.base)h.test.handleSnapshotControl('snapshotBase',w.base);h.test.receiveSnapshot(w.wire);return w;}
{
  const h=harness(),e=new codec.Encoder();
  const first=deliver(h,e,snapshot(1,0)),old=encode(e,snapshot(2,50));
  deliver(h,e,snapshot(3,100));h.test.receiveSnapshot(old.wire);h.test.receiveSnapshot(first.wire);
  assert.equal(h.game.state.lastSnapshot.frame,3);assert.equal(h.units[1].pos.x,1);assert.equal(h.game.metrics().interpolation.staleSnapshots,2);
  // 基準が欠けた複数写真・子基準先着・古いdeltaの後着でも、最新番号だけ復元する。
  const newer=encode(e,snapshot(4,10100)),child=encode(e,snapshot(5,20100));
  h.at(20100);h.test.receiveSnapshot(child.wire);h.test.receiveSnapshot(newer.wire);h.test.handleSnapshotControl('snapshotBase',child.base);
  assert.equal(h.game.state.lastSnapshot.frame,3);
  h.test.handleSnapshotControl('snapshotBase',newer.base);
  assert.equal(h.game.state.lastSnapshot.frame,5);assert.equal(h.units[1].pos.x,201);assert.equal(h.test.pending().length,0);
}
{
  const h=harness(),e=new codec.Encoder(),first=encode(e,snapshot(1,0));h.at(0);h.test.receiveSnapshot(first.wire);
  assert.equal(h.sent.length,1);
  for(let t=1;t<4000;t++){h.at(t);h.test.requestSnapshotResync();}
  assert.deepEqual(h.sent.map(x=>x.time),[0,500,1500,3500]);
  h.test.handleSnapshotControl('snapshotBase',first.base);assert.equal(h.game.state.lastSnapshot.frame,1);
  const count=h.sent.length;h.at(5000);h.test.requestSnapshotResync();assert.equal(h.sent.length,count);
  // ホスト側も250ms未満の要求を反復しても巨大基準を重ねない。
  h.game.state.role='host';h.game.state.peers.set('g',{id:'g',unitId:'R:0',appliedSeq:0});
  // 実製品afterFrameが作るlatestSnapshotWireとencoderを用意する。
  h.c.ended=false;h.at(6000);h.game.afterFrame(.017,6000);h.sent.length=0;
  for(let t=6000;t<6500;t++){h.at(t);h.test.handleSnapshotControl('snapshotResync',{},'g');}
  assert.equal(h.sent.filter(x=>x.type==='snapshotBase').length,2);
}
{
  const h=harness(),e=new codec.Encoder();h.test.unprepare();
  h.game.state.settings={capacity:2,teamSize:2,mapId:'mesa',teamMode:'choice'};h.game.state.resolvedMapId='mesa';
  const first=encode(e,snapshot(0,0));h.test.receiveSnapshot(first.wire);h.test.handleSnapshotControl('snapshotBase',first.base);
  assert.equal(h.sent.filter(x=>x.type==='ready').length,0);
  h.test.onMessage('prepare',{matchId:'test',teamSize:2,mapId:'mesa',localId:'B:0'});
  assert.equal(h.sent.filter(x=>x.type==='ready').length,1);assert.equal(h.game.state.phase,'preparing');assert.equal(h.game.state.lastSnapshot.frame,0);
}
{
  const h=harness(),e=new codec.Encoder();let previous=100;
  for(let n=0;n<=200;n++){
    const t=n*50;deliver(h,e,snapshot(n,t));h.test.interpolate(t);
    const m=h.game.metrics().interpolation;
    assert(m.delayMs>=60&&m.delayMs<=200);assert(Math.abs(m.delayMs-previous)<=6.0001);previous=m.delayMs;
  }
  // 初期の写真間隔が1000/30msの端数になったので、下限60msへの収束は誤差込みで見る。
  assert(Math.abs(h.game.metrics().interpolation.delayMs-60)<1e-6);
  // 到着間隔が揺れる場合は徐々に増え、バッファ増加で描画時刻を巻き戻さない。
  let t=10000,render=h.game.metrics().interpolation.renderTime;
  for(let n=201;n<=260;n++){
    t+=n%2?140:10;deliver(h,e,snapshot(n,n*50),t);h.test.interpolate(t);
    const m=h.game.metrics().interpolation;assert(m.renderTime>=render);render=m.renderTime;assert(m.delayMs<=200);
  }
  assert(h.game.metrics().interpolation.delayMs>100);
  // 外挿は相手機だけ。自機は最新確定位置のまま、100msで停止。
  const remote=h.game.state.lastSnapshot.units[1],local=h.units[0].pos.x;
  h.at(t+1000);h.test.interpolate(t+1000);assert.equal(h.units[1].pos.x,remote.pos[0]+1);assert.equal(h.units[0].pos.x,local);
  h.at(t+2000);h.test.interpolate(t+2000);assert.equal(h.units[1].pos.x,remote.pos[0]+1);assert.equal(h.game.metrics().interpolation.maxExtrapolationMs,100);assert(h.game.metrics().interpolation.clampedFrames>0);
  // 再出撃・大破を補間で旧生存状態へ巻き戻さない。
  deliver(h,e,snapshot(261,13100,{x:900,life:2}),t+2050);h.test.interpolate(t+2050);assert(h.units[1].pos.x>=900&&h.units[1].pos.x<=901);
  deliver(h,e,snapshot(262,13150,{x:800,life:2,alive:false}),t+2100);h.test.interpolate(t+2100);assert.equal(h.units[1].pos.x,800);
}
{
  const h=harness(),e=new codec.Encoder();
  h.game.state.role='host';assert.equal(h.c.doTransfer(h.units[1]),42);assert.equal(h.units[1].onlineMotionEpoch,1);h.game.state.role='guest';
  deliver(h,e,snapshot(1,0,{x:0}));deliver(h,e,snapshot(2,50,{x:.5}));
  // transfer開始/待機の写真を全て落としても、同じlifeの移動完了を過去位置へlerpしない。
  deliver(h,e,snapshot(3,100,{x:900,epoch:1}));h.test.interpolate(100);assert.equal(h.units[1].pos.x,900);
  deliver(h,e,snapshot(4,150,{x:900.5,epoch:1}));h.test.interpolate(150);assert.equal(h.units[1].pos.x,900.5);
  h.test.interpolate(250);assert(h.units[1].pos.x>=900.5);
}
{
  const h=harness(),e=new codec.Encoder();deliver(h,e,snapshot(1,50));
  const result={matchId:'test',frame:99,timeLeft:0,cores:{B:1000,R:0},units:h.units.map(u=>({id:u.entityId,name:u.name,cls:u.cls,sc:{total:u===h.units[1]?999:25,kills:5,coreDmg:1000}}))};
  // 不正な終了通知は例外・部分適用を起こさず、後続の正しい終了結果を受け取れる。
  for(const invalid of [null,undefined,[],{}, {...result,units:null}, {...result,units:[null,result.units[1]]},
    {...result,units:[[],result.units[1]]}, {...result,units:[3,result.units[1]]}, {...result,units:[{...result.units[0],sc:null},result.units[1]]},
    {...result,units:[{...result.units[0],sc:[]},result.units[1]]}, {...result,units:[result.units[0],result.units[0]]},
    {...result,units:[result.units[0],{...result.units[1],sc:{...result.units[1].sc,total:Infinity}}]}]){
    assert.doesNotThrow(()=>h.test.onMessage('matchEnded',invalid));assert.equal(h.game.state.phase,'playing');assert.equal(h.c.cores.R.hp,1000);assert.equal(h.finishCount(),0);
  }
  h.test.onMessage('matchEnded',result);
  assert.equal(h.game.state.phase,'ended');assert.equal(h.c.cores.R.hp,0);assert.equal(h.units[1].sc.total,999);assert.equal(h.finishCount(),1);
  h.test.onMessage('matchEnded',result);h.test.receiveSnapshot(encode(e,snapshot(2,100)).wire);
  assert.equal(h.finishCount(),1);assert.equal(h.c.cores.R.hp,0);assert.equal(h.units[1].sc.total,999);
}
{
  const valid={matchId:'test',teamSize:2,mapId:'mesa',localId:'B:0'};
  for(const invalid of [null,undefined,[],{}, {...valid,matchId:null}, {...valid,localId:'B:2'}, {...valid,localId:'B:00'}]){
    const h=harness();h.test.unprepare();h.game.state.settings={capacity:2,teamSize:2,mapId:'mesa',teamMode:'choice'};h.game.state.resolvedMapId='mesa';
    assert.doesNotThrow(()=>h.test.onMessage('prepare',invalid));assert.equal(h.game.state.phase,'ended');assert.equal(h.sent.filter(x=>x.type==='ready').length,0);
  }
}
// 300ms/3900msの停止後も時計を瞬間移動させない。目標バッファと実遅延を分けて検証。
for(const outage of [300,3900]){
  const h=harness(),e=new codec.Encoder();let previous=null,frame=0,maxStep=0,sawExtraDelay=false;
  for(let time=0;time<=30000;time+=50){
    h.at(time);
    if(time<4000||time>=4000+outage)deliver(h,e,snapshot(++frame,time));
    h.test.interpolate(time);
    const m=h.game.metrics().interpolation;
    assert(m.renderTime<=h.game.state.lastSnapshot.time+100+.0001);assert(m.delayMs>=60&&m.delayMs<=200);
    assert(m.extrapolationMs<=100);if(m.effectiveDelayMs>=200)sawExtraDelay=true;
    if(previous!==null){const step=h.units[1].pos.x-previous;assert(step>=-.0001);maxStep=Math.max(maxStep,step);assert(step<=.60001);}
    previous=h.units[1].pos.x;
    assert(h.game.state.history.length<=32);
  }
  assert(sawExtraDelay);assert(h.game.metrics().interpolation.maxRecoveryLagMs>0);assert(h.game.metrics().interpolation.catchupFrames>0);
  assert(h.game.metrics().interpolation.recoveryLagMs<.001);
  console.log('連続欠落復旧',outage+'ms',JSON.stringify({maxStep,maxEffectiveDelayMs:h.game.metrics().interpolation.maxEffectiveDelayMs}));
}
// 決定的な5/20%の論理写真損失と順序逆転。300秒間、可変dtのホスト時刻をそのまま使用。
for(const loss of [.05,.2]){
  const h=harness(),e=new codec.Encoder();let seed=111,hostTime=0,frame=0,queue=[],lastBase=null,responses=0;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let t=0;t<=300000;t+=10){
    h.at(t);
    if(t>=hostTime){
      const w=encode(e,snapshot(++frame,hostTime));hostTime+=30+random()*40;
      if(w.base){lastBase=e.currentBase();if(random()>=loss)queue.push({at:t+random()*60,type:'snapshotBase',data:w.base});}
      if(random()>=loss)queue.push({at:t+random()*100,type:'snapshot',data:w.wire});
    }
    queue.sort((a,b)=>a.at-b.at);
    while(queue[0]?.at<=t){const m=queue.shift();if(m.type==='snapshot')h.test.receiveSnapshot(m.data);else h.test.handleSnapshotControl(m.type,m.data);}
    h.test.requestSnapshotResync();
    for(const request of h.sent.splice(0))if(request.type==='snapshotResync'&&lastBase&&random()>=loss){queue.push({at:t+50,type:'snapshotBase',data:copy(lastBase)});responses++;}
    h.test.interpolate(t);
  }
  const latest=encode(e,snapshot(++frame,300050));h.at(300100);h.test.handleSnapshotControl('snapshotBase',e.currentBase());h.test.receiveSnapshot(latest.wire);
  assert.equal(h.game.state.lastSnapshot.frame,frame);assert.equal(h.units[0].pos.x,3000.5);assert(h.game.metrics().interpolation.staleSnapshots>0);assert(h.game.metrics().interpolation.maxExtrapolationMs<=100);
  console.log('写真損失',loss*100+'%',JSON.stringify({frame,accepted:h.game.metrics().interpolation.acceptedSnapshots,responses,delayMs:h.game.metrics().interpolation.delayMs,jitterMs:h.game.metrics().interpolation.jitterMs}));
}
console.log('オンライン補間：番号・欠落基準・初期線分離・同life転送・再同期backoff・60〜200ms補間・100ms外挿・自機非予測・終了結果保全 成功');
