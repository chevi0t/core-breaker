// Recorder実装に通す決定的な比較例。実回線の計測値ではない。
const {Recorder}=require('./online_diagnostic_fixture');
function setup(role='guest'){
 let at=0;const start=Date.parse('2026-11-09T12:00:00Z');
 const r=new Recorder({now:()=>start+at,monotonic:()=>at,maps:['mesa']});
 return {r,tick:n=>{at+=n;},begin:data=>r.begin({role,version:'Ver179',protocol:9},data)};
}
const timing=(mean=16.7,p95=18,max=21)=>({count:120,meanMs:mean,p95Ms:p95,maxMs:max});
function lobby(){return {role:'host',phase:'lobby',humans:1,capacity:4,teamSize:5,map:'mesa',diagnostic:{visibility:'visible',fps:null,frame:{count:0,meanMs:0,p95Ms:0,maxMs:0},corrections:{count:0,samples:0,meanM:0,maxM:0,hardSnaps:0},predictionBlocked:'inactive'},transport:{sentBytes:0,receivedBytes:0,connectedPeers:0,pendingPeers:0,rtt:{count:0,meanMs:0,maxMs:0},latencyMs:0,maxQueue:0,maxBufferedBytes:0},interpolation:{acceptedSnapshots:0,delayMs:100,effectiveDelayMs:100},lagCompensation:{shots:0,rewinds:0}};}
function playing(){return {role:'guest',phase:'playing',humans:2,capacity:4,teamSize:5,map:'mesa',diagnostic:{visibility:'visible',fps:59.9,frame:timing(),host:{frame:timing(17,20,25),cpu:timing(2,3,4)},arrivals:timing(34,40,60),snapshotAgeMs:25,rttMs:40,corrections:{count:3,samples:60,meanM:.05,maxM:.15,hardSnaps:0},predictionBlocked:'none',pendingInputs:3},cpu:timing(2,3,4),transport:{sentBytes:12000,receivedBytes:120000,connectedPeers:1,pendingPeers:0,rtt:{count:1,meanMs:40,maxMs:40},maxBufferedBytes:0,maxQueue:0},interpolation:{acceptedSnapshots:300,missingBaselines:0,resyncRequests:0,extrapolatedFrames:0,clampedFrames:0}};}
function fixtures(){
 const cases={};
 {const h=setup('host');h.begin(lobby());h.r.event('connection_ready','none',lobby());for(let i=0;i<10;i++){h.tick(2000);h.r.sample(lobby());}cases.lobby=h.r;}
 {const h=setup();h.begin(playing());h.r.event('match_started','none',playing());for(let i=0;i<5;i++){h.tick(2000);h.r.sample(playing());}cases.playing=h.r;}
 {const h=setup();h.begin(playing());h.tick(5000);h.r.checkpoint('peer_disconnected','host_timeout',playing());h.r.end('host_timeout',playing());cases.disconnect=h.r;}
 {const h=setup();h.begin(playing());h.tick(2000);const d=playing();d.diagnostic.fps=12.5;d.diagnostic.frame=timing(80,120,200);d.diagnostic.snapshotAgeMs=700;d.diagnostic.corrections={count:10,samples:60,meanM:1,maxM:4,hardSnaps:2,reasons:{distance:1,history:1}};d.diagnostic.blockedCorrections=2;d.diagnostic.predictionBlocked='history';d.transport.rtt={count:1,meanMs:300,maxMs:600};d.transport.snapshotDrops={congestion:8,artificial:2};d.transport.latencyMs=50;d.transport.snapshotDropRate=.1;d.interpolation={acceptedSnapshots:350,missingBaselines:2,resyncRequests:1,extrapolatedFrames:40,clampedFrames:5};h.r.sample(d);h.r.event('transport_error','send_failed',d);h.tick(2000);h.r.sample(playing());cases.abnormal=h.r;}
 return cases;
}
module.exports={setup,lobby,playing,fixtures};
if(require.main===module){for(const [name,r]of Object.entries(fixtures()))console.log(JSON.stringify({name,detailCharacters:[...r.preview()].length,summaryCharacters:[...r.summary()].length,summary:r.summary()}));}
