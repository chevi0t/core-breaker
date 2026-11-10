'use strict';
// #220 と #214 の統合回帰。実transportへ偽fetchを渡す。実ブラウザ・TURN回線の試験ではない。
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const Transport=require('../../prototype/online/transport');
const ICE={iceServers:[{urls:'turn:relay.example:3478',username:'temporary',credential:'fixture'}]};
const tick=()=>new Promise(r=>setImmediate(r));
async function settled(p){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('取消後も待機中')),100);})]);}finally{clearTimeout(timer);}}
for(const method of ['createRoom','connect'])for(const phase of ['fetch','json','ignores-abort'])test(method+'：中継情報の'+phase+'待機中も取消を完了し遅着で再開しない',async()=>{
  let signal,release,created=0;const statuses=[];
  class Peer extends EventEmitter{constructor(){super();created++;this.id='fixture';queueMicrotask(()=>this.emit('open',this.id));}destroy(){}}
  const fetch=async(url,opts)=>{signal=opts.signal;
    if(phase==='json')return {ok:true,json:()=>new Promise(r=>{release=()=>r(ICE);})};
    return new Promise((resolve,reject)=>{release=()=>resolve({ok:true,json:async()=>ICE});if(phase==='fetch')signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});
  };
  const transport=new Transport({appVersion:'integration',Peer,iceServersUrl:'https://fixture.example/ice',fetch,onStatus:m=>statuses.push(m)});
  try{
    const attempt=transport[method]('room-fixture').then(()=>({ok:true}),error=>({error}));await tick();
    transport.close('中継準備を取消');const outcome=await settled(attempt);
    assert.equal(outcome.ok,undefined);assert.match(outcome.error.message,/中継準備を取消/);assert(signal.aborted);
    assert.equal(created,0);assert.equal(transport.peer,null);assert.equal(transport._timers.size,0);assert.equal(transport._cancelIce,null);
    release();await tick();assert.equal(created,0);assert.equal(transport.peer,null);assert.notEqual(transport.relayStatus,'ready');assert.equal(statuses.length,0);
  }finally{transport.close();release?.();}
});
test('中継取得の時間切れはabortを無視するfetchでもSTUNへ戻れる',async()=>{
  let signal,release;class Peer extends EventEmitter{constructor(_,opts){super();this.id='fallback';this.options=opts;queueMicrotask(()=>this.emit('open',this.id));}destroy(){}}
  const transport=new Transport({appVersion:'integration',Peer,iceServersUrl:'https://fixture.example/ice',fetch:(_,{signal:s})=>{signal=s;return new Promise(r=>{release=()=>r({ok:true,json:async()=>ICE});});}});
  const later=transport._later.bind(transport);transport._later=(fn,ms)=>later(fn,ms===5000?5:ms);
  try{assert.equal(await settled(transport.createRoom()),'fallback');assert(signal.aborted);assert.equal(transport.relayStatus,'unavailable');assert.equal(transport.relayAvailable,false);assert.equal(transport._cancelIce,null);
    release();await tick();assert.equal(transport.relayStatus,'unavailable');assert.equal(transport.relayAvailable,false);
  }finally{transport.close();release?.();}
});
