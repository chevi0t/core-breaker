#!/usr/bin/env node
'use strict';
// 実時間の60Hz測定。--fastは検証用で、持続CPUの判断には使わない。
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const path = require('node:path');
const { performance, monitorEventLoopDelay, PerformanceObserver } = require('node:perf_hooks');
const { createSimulation } = require('./headless');
const { execFileSync } = require('node:child_process');
const readOptional = p => { try { return fs.readFileSync(p,'utf8').trim(); } catch { return null; } };
const quantile = (a, q) => a.length ? [...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*q)-1)] : 0;
function summary(a) { return { n:a.length, meanMs:a.reduce((s,x)=>s+x,0)/a.length, p95Ms:quantile(a,.95), p99Ms:quantile(a,.99), maxMs:a.reduce((m,x)=>Math.max(m,x),0) }; }
function args(argv) {
  const opts={ map:'mesa', units:10, seconds:660, fast:false, out:null };
  for(let i=0;i<argv.length;i++) {
    const k=argv[i]; if(k==='--fast')opts.fast=true;
    else if(['--map','--units','--seconds','--out'].includes(k)) { if(!argv[i+1])throw Error('値が必要: '+k); opts[k.slice(2)]=argv[++i]; }
    else throw Error('不明な引数: '+k);
  }
  opts.units=Number(opts.units);opts.seconds=Number(opts.seconds);
  if(!Number.isFinite(opts.seconds)||opts.seconds<=0||opts.seconds>86400)throw Error('secondsは0より大きく86400以下');
  return opts;
}
async function run(opts) {
  const sim=createSimulation(opts), steps=[], windows=[], matches=[];
  const delay=monitorEventLoopDelay({resolution:10});delay.enable();
  let gcCount=0,gcMs=0;
  const observer=new PerformanceObserver(list=>{for(const e of list.getEntries()){gcCount++;gcMs+=e.duration;}});
  observer.observe({entryTypes:['gc']});
  const start=performance.now(), cpu=process.cpuUsage(); let lastCpu=cpu,lastWall=start,windowStart=0,nextReport=60, ticks=0, maxRss=process.memoryUsage().rss;
  const cpuOneCore = (a,b,ms)=>(a.user-b.user+a.system-b.system)/1000/ms*100;
  const target=Math.ceil(opts.seconds*60), interval=1000/60;
  while(ticks<target) {
    const due=start+ticks*interval;
    if(!opts.fast && due>performance.now())await new Promise(r=>setTimeout(r,Math.max(1,due-performance.now())));
    const t=performance.now();sim.step(t);steps.push(performance.now()-t);ticks++;
    if(ticks%60===0) {
      const state=sim.state();if(!state.finite||state.units!==opts.units)throw Error('状態不変条件に違反');
      maxRss=Math.max(maxRss,process.memoryUsage().rss);
    }
    if(sim.isEnded()) { matches.push(sim.state()); sim.start(); }
    if(ticks/60>=nextReport || ticks===target) {
      const now=performance.now(), c=process.cpuUsage(), state=sim.state();
      const row={simSeconds:ticks/60,wallSeconds:(now-start)/1000,...summary(steps.slice(windowStart)),
        cpuOneCorePercent:cpuOneCore(c,lastCpu,now-lastWall),rssMB:process.memoryUsage().rss/2**20,
        gcCount,gcMs,eventLoopP99Ms:delay.percentile(99)/1e6,eventLoopMaxMs:delay.max/1e6,
        matches:matches.length,state};
      windows.push(row);process.stderr.write(JSON.stringify(row)+'\n');
      windowStart=steps.length;nextReport+=60;lastCpu=c;lastWall=now;delay.reset();
    }
    // 高速試験・過負荷時にもGC観測/イベントループへ制御を返す。時間を捨てない。
    if(ticks%30===0)await new Promise(r=>setImmediate(r));
  }
  await new Promise(r=>setTimeout(r,20));
  const wall=performance.now()-start,c=process.cpuUsage();delay.disable();observer.disconnect();
  const root=path.resolve(__dirname,'..'), files=['prototype/index.html','prototype/maps.js','prototype/weapons.js','prototype/parts.js','vendor/three-r128/three.min.js'];
  const result={schema:1,mode:opts.fast?'fast-not-capacity':'realtime',options:opts,
    machine:{cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,availableParallelism:os.availableParallelism(),platform:process.platform,node:process.version},
    measuredAt:new Date().toISOString(),
    cgroup:{cpuMax:readOptional('/sys/fs/cgroup/cpu.max'),memoryMax:readOptional('/sys/fs/cgroup/memory.max')},
    commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    sourceHashes:Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),
    tick:summary(steps),wallSeconds:wall/1000,simSeconds:ticks/60,cpuOneCorePercent:cpuOneCore(c,cpu,wall),maxRssMB:maxRss/2**20,gcCount,gcMs,
    completedMatches:matches,partialMatch:sim.state(),windows,muted:sim.muted};
  if(opts.out)fs.writeFileSync(opts.out,JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(require.main===module)run(args(process.argv.slice(2))).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={args,run,summary};
