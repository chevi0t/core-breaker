const assert=require('assert/strict'),fs=require('fs'),{compile}=require('../terrain_recipe');
const r=JSON.parse(fs.readFileSync('tools/terrain_recipes/river_castle.json')),d=compile(r).definition,c=d.cityTerrain;
assert.equal(c.ringCoordinateStep,.04);assert(r.half>655);
const unpack=s=>{const b=Buffer.from(s,'base64');return Array.from(new Int16Array(b.buffer,b.byteOffset,b.length/2));};
const pts=unpack(c.surfaces.dem.points).map(v=>v*.04),zs=pts.filter((_,i)=>i%3===2);assert(Math.min(...zs)<-700&&Math.max(...zs)>700,'16bit coordinates must not wrap past 655m');
for(const [name,s] of Object.entries(c.surfaces)){const n=unpack(s.points).length/3;assert(unpack(s.indices).every(i=>(i&65535)<n),name+' indices');}
for(const name of ['mountain','quarry','urban']){const x=compile(JSON.parse(fs.readFileSync('tools/terrain_recipes/'+name+'.json'))).definition.cityTerrain;assert.equal(x.ringCoordinateStep,.02);assert(Object.values(x.surfaces).every(s=>s.step===.02));}
console.log('PASS large-map coordinates beyond ±700m, indices, existing recipe precision');
