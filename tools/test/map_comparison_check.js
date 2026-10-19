// 編成入替4戦ずつの比較。対照戦場が変化した比較は採否へ使わない。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const [beforeFile,afterFile,output='dbg/map-comparison.json']=process.argv.slice(2);
const before=JSON.parse(fs.readFileSync(beforeFile)),after=JSON.parse(fs.readFileSync(afterFile));
assert.equal(before.length,12);assert.equal(after.length,12);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const group=data=>Object.groupBy(data,m=>m.map);
const aggregate=matches=>{
 const wins={B:0,R:0,draw:0},losses={B:{direct:0,wreck:0},R:{direct:0,wreck:0}};
 for(const m of matches){
  wins[m.winner]++;
  for(const t of ['B','R'])for(const k of ['direct','wreck'])losses[t][k]+=m.losses[t][k];
 }
 const n=matches.length,p=wins.B/n,z=1.96,c=(p+z*z/(2*n))/(1+z*z/n),h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n);
 return {games:n,wins,blueWinRate:p,blueWinWilson95:[c-h,c+h],losses,
  meanBlueCoreMargin:matches.reduce((n,m)=>n+m.coreExact[0]-m.coreExact[1],0)/n};
};
for(let i=0;i<before.length;i++){
 const a=before[i],b=after[i];assert.equal(a.map,b.map);assert.equal(a.seed,b.seed);
 assert.equal(a.initialization.version,'paired-rosters-v2');assert.deepEqual(a.initialization,b.initialization,'変更前後の全10機の初期状態');
 for(const m of [a,b]){
  assert.ok(m.ended);assert.deepEqual(m.errors,[]);
  for(const [j,t] of ['B','R'].entries())assert.ok(Math.abs(m.initialCore[j]-m.coreExact[j]-m.losses[t].direct-m.losses[t].wreck)<1e-6);
 }
 if(a.map==='circulation-v2')assert.deepEqual(a,b,'高架縦断は全対戦記録が一致しなければ比較不成立');
}
const a=group(before),b=group(after),maps={};
for(const id of Object.keys(a)){
 assert.equal(a[id].length,4);assert.equal(new Set(a[id].map(m=>m.seed)).size,2);
 for(let i=0;i<4;i+=2){
  assert.equal(a[id][i].initialization.fixture.swapped,false);assert.equal(a[id][i+1].initialization.fixture.swapped,true);
  const gear=u=>[u.cls,u.role,u.mech,u.weapons,u.walk,u.cruise,u.weight];
  for(let j=0;j<10;j++)assert.deepEqual(gear(a[id][i].initialization.units[j]),gear(a[id][i+1].initialization.units[(j+5)%10]));
 }
 maps[id]={before:aggregate(a[id]),after:aggregate(b[id]),trials:a[id].map((m,i)=>({seed:m.seed,swapped:m.initialization.fixture.swapped,before:{winner:m.winner,core:m.coreExact,losses:m.losses},after:{winner:b[id][i].winner,core:b[id][i].coreExact,losses:b[id][i].losses}}))};
}
const result={note:'各戦場2構成×青橙入替=4戦。変更前後の初期状態一致・対照戦場の全対戦記録一致を確認。戦闘中は経路や乱数消費が分岐する。勝率の統計的合格を意味しない。',
 inputs:{before:{file:beforeFile,sha256:hash(beforeFile)},after:{file:afterFile,sha256:hash(afterFile)}},initialStatesIdentical:true,rostersSwapped:true,controlMatchesIdentical:4,allCoreLossLedgersCorrect:true,maps};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(maps).map(([id,m])=>[id,{before:m.before,after:m.after}])) ,null,2));
