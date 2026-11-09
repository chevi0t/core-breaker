// リセット前の確保と集計の境界を製品関数で検査。WebGL/RTCは使わない。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../prototype/online/game.js'),'utf8'),Transport=require('../../prototype/online/transport');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function setup(){
 const events=[],stats={corrections:7},state={role:'host',phase:'playing',peers:new Map([['private-id',{}]]),requests:new Map(),roster:[],prepareTimer:null};
 const element={querySelector:()=>null};const c={state,events,stats,diagnosticLog:{end:(reason,data)=>events.push({code:'end',reason,...data})},logSample:()=>({corrections:stats.corrections,phase:state.phase,humans:state.peers.size+1}),logCheckpoint:code=>events.push({code,corrections:stats.corrections,phase:state.phase,humans:state.peers.size+1}),
 resetQuickChat(){},resetLobbyReady(){},clearStartReservation(){},clearPrediction(){stats.corrections=0;},resetLagCompensation(){},stopSessionAudio(){},clearTimeout(){},preferenceTimer:null,preferenceReject:null,preferenceResolve:null,
 requestsChanged(){},lobbyChanged(){},remoteUnitHistory:new Map(),remoteShells:new Map(),setSimulationRole(){},saved:null,running:true,ended:false,tutorialClearInput(){},status(){},callbacks:{},$:()=>element,showPage(){},document:{exitPointerLock(){}},resetMeasurements(){stats.corrections=0;},unit:()=>null,now:()=>0};
 state.transport={broadcast(){},send(){},close(){},returnToLobby(){}};vm.createContext(c);return {c,events,state,stats};
}
test('退出/ホスト切断/ロビー復帰は予測や通信状態を消す前に確保',()=>{
 for(const name of ['leave','endGuest','backToLobby']){const h=setup();const boundaries={leave:['  function leave(', '  function packUnit('],endGuest:['  function endGuest(', '  function leave('],backToLobby:['  function backToLobby(', '  function endGuest(']};vm.runInContext(part(...boundaries[name]),h.c);h.c[name]('private-error');assert.equal(h.events[0].corrections,7);assert.equal(h.events[0].phase,'playing');assert.equal(h.events[0].humans,2);}
});
test('transport診断はID・名前・接続情報・生エラーを返さず数値を集計',()=>{
 const t=Object.create(Transport.prototype),secret='private-peer-ip-sdp-error';Object.assign(t,{totals:{sentBytes:1000,receivedBytes:500,sentMessages:3,receivedMessages:2,maxBufferedBytes:10,maxQueue:1,byType:{[secret]:3}},links:new Map([[secret,{ready:true,approved:true,rttMs:24,conn:{dataChannel:{bufferedAmount:6}},queue:[1],snapshots:[],inputs:[]}]]),byChannel:{control:{sentBytes:1},snapshot:{sentBytes:999}},latencyMs:50,snapshotDropRate:.05,inputDropRate:0,snapshotDrops:{artificial:1},inputDrops:{artificial:0},history:new Map([[secret,{reason:secret}]])});
 const d=t.diagnostics();assert.equal(d.rtt.meanMs,24);assert.equal(d.connectedPeers,1);assert.equal(d.sentBytes,1000);assert(!JSON.stringify(d).includes(secret));
});
test('試合終了の記録は両側ともリセットより前',()=>{
 const at=source.indexOf('  function receiveMatchEnded('),end=source.indexOf('\n  function ',at+1),g=source.slice(at,end);
 assert(g.indexOf("logCheckpoint('match_finished')")<g.indexOf('clearPrediction()'));
 const h=part('  function afterFrame(', '  function emit(');assert(h.indexOf("logCheckpoint('match_finished')")<h.indexOf("broadcast('matchEnded'"));
});
