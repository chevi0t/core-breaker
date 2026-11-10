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

function heavy(){
 const fs=require('node:fs'),{Recorder,safeSample,Pack}=require('./online_diagnostic_fixture');
 const source=fs.readFileSync(require.resolve('../../prototype/online/diagnostics.js'),'utf8');
 const schema=JSON.parse(source.match(/const SCHEMA=(.*);/)[1]);const field=(d,k)=>d[1].find(f=>f[0]===k)[1];const session=field(schema,'sessions')[1],sample=field(field(session,'samples')[1],'data');
 let seed=99,clock=Date.parse('2026-11-09T12:00:00Z'),mono=0;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 function make(d){switch(d[0]){case 'object':return Object.fromEntries(d[1].map(([k,s])=>[k,make(s)]));case 'number':return d[2]&&rnd()<.2?null:[0,Math.round(rnd()*d[1]*1000)/1000,d[1]][Math.floor(rnd()*3)];case 'counter':return Object.fromEntries(d[1].filter(()=>rnd()<.4).map(k=>[k,rnd()<.3?0:Math.round(rnd()*1000000)/1000]));case 'enum':return d[1][Math.floor(rnd()*d[1].length)];case 'map':return Pack.DEFAULT_MAPS[Math.floor(rnd()*Pack.DEFAULT_MAPS.length)];default:throw Error(d[0]);}}
 const r=new Recorder({now:()=>clock,monotonic:()=>mono,maps:Pack.DEFAULT_MAPS});
 for(let n=0;n<3;n++){r.begin({role:n%2?'guest':'host',version:'Ver179',protocol:9},{});for(let i=0;i<40;i++){mono+=2000;clock+=2000;const data=safeSample(make(sample),Pack.DEFAULT_MAPS);r.sample(data,true);r.checkpoint(i%2?'match_finished':'peer_disconnected',field(field(session,'events')[1],'reason')[1][i%28],data);}r.end('local_leave',safeSample(make(sample),Pack.DEFAULT_MAPS));clock++;mono++;}
 return r;
}
module.exports={setup,lobby,playing,fixtures,heavy};
if(require.main===module){
 const z=require('node:zlib'),{performance}=require('node:perf_hooks');
 for(const [name,r]of Object.entries({...fixtures(),heavy:heavy()})){
  const detail=r.preview(),raw=r.json(),t=performance.now(),compressed=r.compressed(),ms=performance.now()-t,packed=z.inflateRawSync(Buffer.from(compressed.split('.').at(-1),'base64url'));
  console.log(JSON.stringify({name,detailCharacters:[...detail].length,rawBytes:Buffer.byteLength(raw),packedBytes:packed.length,compressedCharacters:compressed.length,compressMs:+ms.toFixed(2),rawJsonDeflate9:z.deflateRawSync(raw,{level:9}).length,packedDeflate9:z.deflateRawSync(packed,{level:9}).length,packedGzip9:z.gzipSync(packed,{level:9}).length,packedZlib9:z.deflateSync(packed,{level:9}).length,shippedDeflateBytes:Buffer.from(compressed.split('.').at(-1),'base64url').length,sessions:r.sessions.length,samples:r.sessions.map(s=>s.samples.length),dropped:r.sessions.map(s=>s.droppedSamples)}));
 }
}
