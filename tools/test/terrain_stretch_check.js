// 長手方向だけを伸ばし、共有レシピや高さ・横幅・三角形数を変えない。
const assert=require('assert/strict'),fs=require('fs'),{compile}=require('../terrain_recipe');
const r=JSON.parse(fs.readFileSync('tools/terrain_recipes/mountain.json')),snapshot=JSON.stringify(r),a=compile({...r,lengthScale:1}),b=compile(r),d=b.definition;
assert.equal(JSON.stringify(r),snapshot,'入力レシピを変更しない');assert.equal(a.stats.triangles,b.stats.triangles);assert.equal(d.bases.B.at[1]-d.bases.R.at[1],555);
for(const [k,s] of Object.entries(a.definition.cityTerrain.surfaces)){const decode=s=>{const x=Buffer.from(s.points,'base64');return new Int16Array(x.buffer,x.byteOffset,x.length/2);};const x=decode(s),y=decode(d.cityTerrain.surfaces[k]);assert.equal(x.length,y.length);assert.equal(s.indices,d.cityTerrain.surfaces[k].indices);for(let i=0;i<x.length;i++)assert.equal(y[i],i%3===2?Math.round(x[i]*1.5):x[i]);}
for(let i=0;i<d.plants.length;i++){assert.equal(d.plants[i][1],a.definition.plants[i][1]);assert.equal(d.plants[i][2],a.definition.plants[i][2]*1.5);}
for(const team of Object.values(d.cityBattle.respawns))for(const [id,points] of Object.entries(team))for(const p of points)assert.equal(Math.abs(p[1]-d.plants.find(x=>x[0]===id)[2]),48);
for(const p of d.recipeMeta.routes.flatMap(r=>r.points)){const sample=b.sample(p[0],p[1]);assert(sample);assert.deepEqual(sample,a.sample(p[0],p[1]/1.5));}
console.log('PASS: コア間555m、全支持面のZのみ1.5倍、横幅/高さ/三角形数/再出撃距離維持、レシピ非破壊');
