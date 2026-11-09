// online_snapshot_check --fixtures 用。製品のsnapshot/codecを固定入力で前後比較する。
// Bot・描画・transportを実行しないため、自然戦/WebRTC/FPS/操作感の測定ではない。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const fixture=require('./online_equipment_fixture');
const stats=a=>{const s=a.slice().sort((a,b)=>a-b);return {count:s.length,mean:s.reduce((a,b)=>a+b,0)/s.length,p50:s[Math.floor((s.length-1)*.5)],p95:s[Math.floor((s.length-1)*.95)],max:s.at(-1)};};
const bytes=v=>Buffer.byteLength(JSON.stringify(v));
function inspect(delta,schema){
  const raw=Buffer.from(delta[2],'base64'),categories={};let at=0,index=-1,fields=0;
  const get=()=>{let n=0,mul=1;while(true){const b=raw[at++];n+=(b&127)*mul;if(b<128)return n;mul*=128;}};
  while(at<raw.length){const start=at;index+=get()+1;const [p,type]=schema[index];if(typeof type==='number'||type==='b')get();else{const n=get();at+=n;}
    categories[p[0]]=(categories[p[0]]||0)+at-start;fields++;}
  assert.equal(at,raw.length);assert.equal(Object.values(categories).reduce((a,b)=>a+b,0),raw.length);
  return {binaryBytes:raw.length,categories,changedFields:fields};
}
function setup(root){
  const f=fixture(root),{c,T,makeUnit,game,own,peer}=f;
  const classes=Object.keys(c.CLASSES);for(let i=1;i<5;i++){makeUnit('B:'+i,classes[i%4]);makeUnit('R:'+i,classes[(i+1)%4]);}
  c.units.sort((a,b)=>a.entityId.localeCompare(b.entityId));
  c.units.forEach((u,i)=>{u.pos.set((i%5)*3,0,u.team==='B'?10:-100);u.controller=u===own?'remoteHuman':'bot';u.boost=100;u.onGround=true;});
  c.canSee=(_viewer,e)=>!e.testHidden;
  c.plants.push(...Array.from({length:5},(_,i)=>({id:String.fromCharCode(65+i),owner:null,gauge:0,capturing:null,contested:false})));
  c.turrets.push(...Array.from({length:4},(_,i)=>({hp:10000,alive:true,yaw:0,revive:0,team:i<2?'B':'R'})));
  c.radars.push(...['B','R'].map(team=>({hp:10000,alive:true,revive:0,team,head:new T.Group(),intruders:[]})));
  c.barricades.push(...Array.from({length:8},()=>({hp:10000,alive:true})));
  game.state.teamSize=5;peer.appliedSteps=[];
  return f;
}
const scenes={
  hidden(f,n){for(const u of f.c.units.filter(u=>u.team==='R')){u.testHidden=true;u.pos.set(300+n,0,300);u.hp=9999-n;u.slots.main.ammo=n%30;}},
  remote_fire(f,n){for(const u of f.c.units.filter(u=>u!==f.own)){Object.assign(u.slots.main,{ammo:30-n%30,reloadT:n%20/20,cd:n%7/60,spin:n%10/10});}},
  facilities(f,n){const {c}=f;c.plants[2].capturing='B';c.plants[2].gauge=n%100/100;c.turrets[1].yaw=n*.013;c.radars[0].head.rotation.y=n*.021;c.barricades[3].hp=10000-n;},
  mixed(f,n){scenes.remote_fire(f,n);scenes.facilities(f,n);for(const [i,u]of f.c.units.entries()){u.pos.x+=.05*(i+1);u.yaw=n*.007;u.slots.aux.chargeT=n%30/30;u.slots.sp.heat=n%100;}for(const u of f.c.units.filter(u=>u.team==='R'&&u.idx>2)){u.testHidden=n%60<30;u.pos.set(300,0,300);}},
};
function run(root,scene){
  const f=setup(root),{test,peer,game,codec}=f,d=new codec.Decoder(),rows=[];
  let initial=test.encodePeerSnapshot(peer,null,true);assert(d.seed(initial.baseline));assert(d.decode(initial.wire.delta));
  const initialStats={bytes:bytes(initial.baseline),fields:initial.baseline.s.length};
  for(let n=1;n<=270;n++){
    scenes[scene](f,n);f.setTime(1000+n*30);game.state.frame=n;
    // 共通費用のACKも両版とも8stepで毎回更新する。Claude側のACK削減は比較へ混ぜない。
    Object.assign(peer,{fixedCommands:true,fixedReplaySeq:n*2,appliedSeq:n*2,appliedStep:n*2,appliedSeqDt:1/60,appliedTotalDt:n/30,
      appliedSteps:Array.from({length:8},(_,i)=>({step:Math.max(1,n*2-7+i),seq:Math.max(1,n*2-7+i),dt:1/60,seqDt:1/60,actionSeq:0,pressed:[]}))});
    const start=performance.now(),w=test.encodePeerSnapshot(peer,null,true),encoded=performance.now();
    if(w.baseline)assert(d.seed(w.baseline));const decoded=d.decode(w.wire.delta),finished=performance.now();assert(decoded);
    assert.equal(decoded.units.length,10);assert.equal(decoded.roster.length,10);
    for(const u of decoded.units.filter(u=>u.hidden)){assert(u.pos.every(v=>v===0));assert.equal(u.equipment,null);}
    if(n<=30)continue;
    const detail=inspect(w.wire.delta,d.bases.get(w.wire.delta[1]).s);
    rows.push({...detail,payloadBytes:bytes(w.wire),encodeMs:encoded-start,decodeMs:finished-encoded,visibleEnemies:decoded.units.filter(u=>!u.hidden&&u.team==='R').length});
  }
  return {initial:initialStats,rows};
}
module.exports=function runComparison({baselineRoot,output}){
  const root=path.resolve(__dirname,'../..');baselineRoot=path.resolve(baselineRoot);
  const revision=r=>execFileSync('git',['rev-parse','HEAD'],{cwd:r,encoding:'utf8'}).trim();
  const report={mode:'Node固定fixture・ブラウザ/WebRTC未測定',baseline:revision(baselineRoot),current:revision(root),workingTree:execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,codeHashes:Object.fromEntries(['prototype/online/game.js','prototype/online/codec.js'].map(p=>[p,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')])),
    method:'実game.snapshot/個別公開判定/codec、10機・4兵装・5プラント/4砲台/2レーダー/8バリケード。全機更新を強制し、30コマwarmup後240コマを2回。2回目は前後を逆順で計測。時間は30ms刻み、ACKは両版同条件で毎回8step更新。fixtureの末端模型は代役、Bot/描画/transportは実行しない。',
    accounting:'payloadBytesは{frame,delta}のJSON UTF8量。binaryBytesはbase64前の差分長。baseline bytesは初期schema+値のJSON量。CPUはNodeの実snapshot構築/公開判定/encode、およびdecodeのみ。通信envelope、fragment、回線帯域、描画FPSは含まない。',scenes:{}};
  for(const scene of Object.keys(scenes)){
    const runs={before:[],after:[]};
    for(let repeat=0;repeat<2;repeat++)for(const label of repeat?['after','before']:['before','after'])runs[label].push(run(label==='before'?baselineRoot:root,scene));
    const summarize=r=>{const rows=r.flatMap(v=>v.rows),cat={};for(const row of rows)for(const [key,n]of Object.entries(row.categories))cat[key]=(cat[key]||0)+n;
      return {initialBaseline:r[0].initial,...Object.fromEntries(['payloadBytes','binaryBytes','changedFields','encodeMs','decodeMs'].map(k=>[k,stats(rows.map(r=>r[k]))])),categoryMeanBytes:Object.fromEntries(Object.entries(cat).map(([k,n])=>[k,n/rows.length])),visibleEnemies:[...new Set(rows.map(r=>r.visibleEnemies))].sort()};};
    report.scenes[scene]={before:summarize(runs.before),after:summarize(runs.after)};
    console.log(scene,JSON.stringify(report.scenes[scene]));
  }
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'online-snapshot-fixtures.json'),JSON.stringify(report,null,2));return report;
};
