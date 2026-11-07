// ブラウザ版の数値を読み取り、明示的な操作でGodot版のスナップショットを作る。
// 本体・maps.js・音源は書き換えない。ブラウザ版とGodot版の開発は独立して続ける。
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),out=path.join(ROOT,'godot/data');
const source=fs.readFileSync(path.join(ROOT,'prototype/index.html'),'utf8');
const context=vm.createContext({window:{},localStorage:{getItem:()=>null},console,structuredClone});
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);if(start<0||end<0)throw new Error('本体の見出しが変わった: '+a);return source.slice(start,end);};
const declaration=name=>{const start=source.indexOf('const '+name+' ='),end=source.indexOf('\n};',start);if(start<0||end<0)throw new Error(name);return source.slice(start,end+3);};
const functionSource=name=>{const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}\n',start);if(start<0||end<0)throw new Error('関数: '+name);return source.slice(start,end+3);};
const lineSource=prefix=>{const line=source.split('\n').find(line=>line.startsWith(prefix));if(!line)throw new Error('定義: '+prefix);return line;};
vm.runInContext('const WALK=13,BURST=46,DASH=30;'+section('// ---- メーカー（','// ---- 機体 ----')+declaration('MODEL_OF')+'\n'+
 lineSource('function baseKick(')+'\n'+
 section('// ---- 兵装と武器 ----','const LOADOUT_KEY')+declaration('SFX'),context);
vm.runInContext(fs.readFileSync(path.join(ROOT,'prototype/maps.js'),'utf8'),context);
vm.runInContext(section('const MAP_KEYS =','const FIRST_MAP'),context);
const data=JSON.parse(vm.runInContext('JSON.stringify({weapons:WEAPONS,parts:PARTS,partSeries:PART_SERIES,classes:CLASSES,armory:ARMORY,weights:WEAPON_KG,makers:MAKERS,mechDefault:MECH_DEFAULT,paints:PAINTS,models:MODEL_OF,maps:MAPS,sfx:SFX})',context));
data.fixtures={mech:[],terrain:{}};
for(const definition of Object.values(data.partSeries))for(const cls of Object.keys(data.classes)){
 const t=definition.types[0],cfg={head:t,body:t,arms:t,legs:t,color:'team'};
 const keys=Object.fromEntries(['main','sub','aux','sp'].map(slot=>[slot,data.armory[cls][slot][0]]));
 context.fixtureMech=cfg;context.fixtureKeys=keys;
 const stat=JSON.parse(vm.runInContext('JSON.stringify(mechStats(fixtureMech,fixtureKeys))',context));
 data.fixtures.mech.push({config:cfg,loadout:keys,weight:stat.weight,walk:stat.walk,dash:stat.dash,cruise:stat.cruise,parts:stat.P});
}
// 地形は元のbakeTerrain/terrainHそのものを評価し、別の地形モデルを作らない。
vm.runInContext('let curMap,MAP_X,MAP_Z,BASE_LINE,features,TX0,TZ0,TW,TD,heights,TERRAIN_MAX;'+
 lineSource('const smooth =')+functionSource('mirrored')+lineSource('const featuresOf =')+
 ['featureH','terrainShape','bakeTerrain','terrainH'].map(functionSource).join('\n'),context);
fs.mkdirSync(out,{recursive:true});
const baked=new Map();
for(const [id,map]of Object.entries(data.maps)){
 const key=map.group||id;
 if(!baked.has(key)){
  context.exportMap=map;
  const bakedTerrain=vm.runInContext('curMap=exportMap;MAP_X=curMap.size[0];MAP_Z=curMap.size[1];BASE_LINE=curMap.baseLine;bakeTerrain(curMap.terrain);({x0:TX0,z0:TZ0,width:TW,depth:TD,heights})',context);
  const {x0,z0,width,depth}=bakedTerrain;
  const buffer=Buffer.alloc(width*depth*4);
  for(let i=0;i<bakedTerrain.heights.length;i++)buffer.writeFloatLE(bakedTerrain.heights[i],i*4);
  fs.writeFileSync(path.join(out,key+'.height'),buffer);
  baked.set(key,{file:key+'.height',x0,z0,width,depth});
  context.terrainProbes=[[0,0],[-144,10],[24.25,63.75],[-60,-35],[map.size[0]-.3,map.size[1]-.6],[-map.size[0]+.7,-map.size[1]+.2],[78,270],[-134,-434]];
  data.fixtures.terrain[key]=JSON.parse(vm.runInContext('JSON.stringify(terrainProbes.map(([x,z])=>({x,z,y:terrainH(x,z)})))',context));
 }
 map.heightmap=baked.get(key);
 delete map.variants;
}
// 既存のオリジナル形状をそのままGodotの頂点配列へ取り込む。外部のモデルは使わない。
context.T=require(path.join(ROOT,'vendor/three-r128/three.min.js'));
vm.runInContext('const palette=[0x5bc9ee,0xf3bf60,0xf28479];const weaponGeoBank=new Map();'+['buildWeaponGeo','weaponGeo','makeMechRig','buildMech'].map(functionSource).join('\n'),context);
const geoOut=path.join(ROOT,'godot/assets/geometry');fs.mkdirSync(geoOut,{recursive:true});
const pilotAtlas=source.match(/background-image: url\("data:image\/png;base64,([A-Za-z0-9+/=]+)"\)/);
if(pilotAtlas)fs.writeFileSync(path.join(ROOT,'godot/assets/pilots.png'),Buffer.from(pilotAtlas[1],'base64'));
function writeGeometry(filename,geometry,ranges=[],boneIndices=new Map()){
 const geo=geometry.index?geometry.toNonIndexed():geometry;
 const count=geo.attributes.position.count,buffer=Buffer.alloc(count*40);let rangeIndex=0;
 for(let i=0;i<count;i++){
  // Three.jsとGodotで表面の頂点順が逆。
  const v=i%3===1?i+1:i%3===2?i-1:i;
  while(rangeIndex<ranges.length-1 && v*3>=ranges[rangeIndex].end)rangeIndex++;
  let bone=0;
  if(ranges.length){const r=ranges.find(r=>v*3>=r.start&&v*3<r.end);bone=boneIndices.get(r.bone)||0;}
  const values=['position','normal','color'].flatMap(key=>{const a=geo.attributes[key];return a?[a.getX(v),a.getY(v),a.getZ(v)]:key==='color'?[1,1,1]:[0,1,0];});
  values.push(bone);values.forEach((x,k)=>buffer.writeFloatLE(x,(i*10+k)*4));
 }
 fs.writeFileSync(path.join(geoOut,filename),buffer);
 if(geo!==geometry)geo.dispose();
 return filename;
}
data.geometry={parts:{},weapons:{},bones:[]};
for(const [series,definition]of Object.entries(data.partSeries)){
 const type=definition.types[0],cfg={head:type,body:type,arms:type,legs:type,color:'team'};
 context.exportMechConfig=cfg;
 const built=vm.runInContext('buildMech(0x3ea6ff,exportMechConfig)',context);
 const boneEntries=Object.entries(built.rig.bones),boneIndices=new Map(boneEntries.map(([,b],i)=>[b,i]));
 if(!data.geometry.bones.length)data.geometry.bones=boneEntries.map(([name,b])=>({name,parent:boneEntries.findIndex(([,q])=>q.node===b.node.parent),rest:b.node.position.toArray(),global:b.rest.toArray()}));
 data.geometry.parts[series]={};
 for(const {mesh,ranges}of built.rig.meshes){const slot=mesh.userData.armorSlot;data.geometry.parts[series][slot]=writeGeometry(`part-${series}-${slot}.meshdata`,mesh.geometry,ranges,boneIndices);}
}
const weaponModels=new Map();
for(const key of Object.keys(data.weapons)){
 const signature=JSON.stringify(data.models[key]||['ar',0]);
 if(!weaponModels.has(signature)){context.exportWeaponKey=key;const geo=vm.runInContext('weaponGeo(exportWeaponKey)',context);weaponModels.set(signature,writeGeometry('weapon-'+key+'.meshdata',geo));}
 data.geometry.weapons[key]=weaponModels.get(signature);
}
data.provenance={format:1,source:'ブラウザ版からの明示的な取り込み',sha256:Object.fromEntries(['prototype/index.html','prototype/maps.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')]))};
const encoded=JSON.stringify(data);
fs.writeFileSync(path.join(out,'catalog.json'),encoded+'\n');
const audioOut=path.join(ROOT,'godot/assets/audio');fs.mkdirSync(audioOut,{recursive:true});
for(const file of fs.readdirSync(path.join(ROOT,'sounds/src')))if(file.endsWith('.mp3'))fs.copyFileSync(path.join(ROOT,'sounds/src',file),path.join(audioOut,file));
fs.copyFileSync(path.join(ROOT,'sounds/music/bgm.ogg'),path.join(audioOut,'bgm.ogg'));
fs.copyFileSync(path.join(ROOT,'sounds/CREDITS.md'),path.join(audioOut,'CREDITS.md'));
console.log(`Godot版の取込: 武器${Object.keys(data.weapons).length}、パーツ${Object.values(data.parts).reduce((n,p)=>n+Object.keys(p).length,0)}、マップ${Object.keys(data.maps).length}、地形${baked.size}、武器形状${weaponModels.size}。ブラウザ版の変更なし。`);
