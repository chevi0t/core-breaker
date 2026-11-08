// node tools/test/online_snapshot_cadence.test.js [--before=/path/to/game.js]
// 実afterFrameの予定時刻を検査。可視性/codec/payloadと20ms送信pumpは代役で、実RTC/帯域は対象外。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const filename=path.resolve(__dirname,'../../prototype/online/game.js'),source=fs.readFileSync(filename,'utf8');
const slice=s=>s.slice(s.indexOf('  function afterFrame('),s.indexOf('  function emit(',s.indexOf('  function afterFrame(')));
let checks=0;const ok=(v,msg)=>{assert.ok(v,msg);checks++;};
function harness(code=source){
  let clock=0,privacy=false,pending=null;
  const generated=[],wire=[],c={state:{role:'host',phase:'playing',frame:0,frameMs:[],sendMs:[],lastSent:0,nextSnapshotAt:0,events:[],peers:new Map([['g',{id:'g'}]])},
    frameStart:0,ended:false,now:()=>clock,captureLagHistory:()=>{},
    replicationFor:()=>({visible:new Set(),gadgetPublic:new Set(),gadgetCapacity:0}),
    createPeerView:()=>({visible:new Set(privacy?['visible']:[])}),permittedGadgets:()=>[],
    snapshot:()=>({time:clock}),encodePeerSnapshot:(_p,s)=>({wire:s}),diagnosticFrameEnd:()=>{},
    matchResult:()=>({}),clearPrediction:()=>{},lagHistory:null,window:{CBOnlineGame:{}},status:()=>{},callbacks:{}};
  c.state.transport={send(type,data){if(type==='snapshot'){generated.push(clock);pending=data;}},broadcast:()=>{}};
  vm.createContext(c);vm.runInContext(code.match(/const SNAPSHOT_INTERVAL_MS=[^;]+;/)[0]+'\n'+slice(code),c);
  return {c,generated,wire,frame(time,privateChange=false){clock=time;privacy=privateChange;c.afterFrame(1/60,clock);},pump(time){clock=time;if(pending){wire.push(clock);pending=null;}}};
}
function rates(hz,code=source){
  const h=harness(code),events=[];
  for(let i=1;i<=hz*30;i++)events.push([i*1000/hz,0]);
  for(let i=1;i<=1500;i++)events.push([i*20,1]);
  events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  for(const [time,kind]of events)kind?h.pump(time):h.frame(time);
  return {hz,generatedHz:h.generated.length/30,pumpHz:h.wire.length/30,wireGaps:[...new Set(h.wire.slice(1).map((v,i)=>+(v-h.wire[i]).toFixed(3)))].sort((a,b)=>a-b)};
}
const results=[30,60,61,62,63,75,90,120,144,240].map(hz=>rates(hz));
for(const r of results){ok(r.generatedHz===30,`${r.hz}fpsでも定期生成30Hz`);ok(r.pumpHz===30,`${r.hz}fps・20ms最新優先pump代役でも30Hz`);}
const h=harness();h.frame(10);h.frame(20,true);h.frame(30);h.frame(44);
ok(JSON.stringify(h.generated)==='[10,20,44]','秘匿変更は即送信し定期予定を延期しない');
h.frame(1000);ok(h.generated.length===4,'長いhost停止から復帰しても1frame1枚');
h.frame(1000);ok(h.generated.length===4,'同時刻に連続呼出して追いつきburstを出さない');
h.frame(1010);ok(h.generated.length===5,'停止後も元の位相を保ち次の予定で送る');
h.c.ended=true;h.frame(1011);ok(h.generated.length===6&&h.c.state.phase==='ended','終了写真は予定を待たず送る');
h.c.state.phase='playing';h.c.ended=false;h.c.state.nextSnapshotAt=0;h.frame(1012);ok(h.generated.length===7,'次試合の時計reset後は直ちに写真を生成');
ok(/state\.lastSent = state\.nextSnapshotAt = state\.lastInput = 0/.test(source),'measurement resetは写真予定も消す');
ok(/state\.lastHost = now\(\);state\.nextSnapshotAt=0/.test(source),'開始ごとに写真予定を初期化');
const low=rates(20);ok(low.generatedHz===20,'30fps未満ではhost1frame1枚を上限にする');
const before=process.argv.find(s=>s.startsWith('--before='));
const report={scope:'実afterFrame、可視性/codec/20ms pumpは代役。実RTC/帯域は未計測',gameHash:crypto.createHash('sha256').update(source).digest('hex'),checks,after:results,lowFps:low};
if(before)report.before=[30,60,61,62,63,75,90,120,144,240].map(hz=>rates(hz,fs.readFileSync(before.slice(9),'utf8')));
console.log(JSON.stringify(report));
