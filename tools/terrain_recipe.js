// JSONレシピを既存city-layout-v1へコンパイル。任意JS/頂点をレシピに許可しない。
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),mix=(a,b,t)=>a+(b-a)*t;
function inside(poly,x,z){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[j],b=poly[i];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function nearSegment(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1);return {d:Math.hypot(x-mix(a[0],b[0],t),z-mix(a[1],b[1],t)),y:mix(a[2],b[2],t)};}
function boundaryDistance(poly,x,z){return Math.min(...poly.map((a,i)=>nearSegment(x,z,[...a,0],[...poly[(i+1)%poly.length],0]).d));}
function validate(r){
 const num=n=>typeof n==='number'&&Number.isFinite(n),point=(p,n)=>Array.isArray(p)&&p.length===n&&p.every(num);
 assert(Object.keys(r).every(k=>['version','id','name','half','grid','navStep','seed','boundary','color','baseHeight','hills','bases','routes','tunnels','plants','blocks'].includes(k)),'unknown recipe field');assert(r.version===1,'version must be 1');assert(/^[a-z][a-z0-9_]*$/.test(r.id),'id');assert(typeof r.name==='string'&&r.name.length<80,'name');
 assert([4,5,10].includes(r.grid)&&num(r.half)&&r.half>=120&&r.half<=300&&r.half%r.grid===0,'grid/half budget');assert(r.navStep===r.grid*2,'navStep must be twice grid');assert(Number.isInteger(r.seed),'seed');assert(/^#[0-9a-f]{6}$/i.test(r.color),'color');assert(num(r.baseHeight),'baseHeight');
 assert(Array.isArray(r.boundary)&&r.boundary.length>=4&&r.boundary.length<=40,'boundary');
 for(const [i,a] of r.boundary.entries()){const b=r.boundary[(i+1)%r.boundary.length];assert(point(a,2)&&a.every(v=>Math.abs(v)<r.half&&v%r.grid===0),'grid-aligned boundary');assert((a[0]===b[0])!==(a[1]===b[1]),'orthogonal nonzero boundary edge');
  for(let j=i+2;j<r.boundary.length;j++){if(i===0&&j===r.boundary.length-1)continue;const c=r.boundary[j],d=r.boundary[(j+1)%r.boundary.length];const cross=(p,q,t)=>(q[0]-p[0])*(t[1]-p[1])-(q[1]-p[1])*(t[0]-p[0]);assert(!(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))),'self-intersecting boundary');}
 }
 assert(Array.isArray(r.hills)&&r.hills.length<=40,'hills budget');for(const h of r.hills)assert(point(h,4)&&h[2]>=0&&h[2]<=100&&h[3]>=15,'hill [x,z,height,radius]');
 for(const b of Object.values(r.bases)){assert(point(b,3)&&inside(r.boundary,...b)&&boundaryDistance(r.boundary,...b)>35,'base clearance');}
 assert(r.bases.B&&r.bases.R,'two bases');assert(r.routes.length>=2&&r.routes.length<=20,'routes budget');const ids=new Set();
 for(const q of r.routes){assert(!ids.has(q.id),'unique route');ids.add(q.id);assert(['ground','deck'].includes(q.kind)&&q.width>=8&&q.width<=40,'route kind/width');assert(q.kind==='deck'?q.thickness>=1&&q.thickness<=6:q.blend>=5&&q.blend<=40,'route dimensions');assert(q.points.length>=2&&q.points.length<=30,'route points');for(const p of q.points)assert(point(p,3)&&inside(r.boundary,...p)&&boundaryDistance(r.boundary,...p)>q.width/2+2,'route inside boundary');for(let i=1;i<q.points.length;i++){const a=q.points[i-1],b=q.points[i],len=Math.hypot(a[0]-b[0],a[1]-b[1]);assert(len>=5&&Math.abs(a[2]-b[2])/len<=.65,'route slope');}}
 assert(r.tunnels.length<=8,'tunnel budget');for(const t of r.tunnels){assert(['x','z'].includes(t.axis)&&point(t.rect,4)&&t.rect.every(v=>v%r.grid===0),'tunnel grid rectangle');assert(t.rect[1]-t.rect[0]>=10&&t.rect[3]-t.rect[2]>=10&&num(t.floor)&&num(t.ceiling)&&t.ceiling-t.floor>=8,'tunnel clearance');}
 for(const b of r.blocks||[])assert(point(b,6)&&b[2]>=4&&b[3]>=4&&b[5]>b[4]&&b[5]<=100&&inside(r.boundary,b[0],b[1]),'block [x,z,width,depth,bottom,top]');
 assert(r.plants.length>=3&&r.plants.length<=6,'plant count');for(const [id,x,z,owner] of r.plants)assert(typeof id==='string'&&num(x)&&num(z)&&inside(r.boundary,x,z)&&['B','R',null].includes(owner),'plant');return r;
}
function compile(input,seed=input.seed){
 const r=validate(JSON.parse(JSON.stringify({...input,seed})));let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const hills=r.hills.map(h=>[h[0],h[1],h[2]*(.95+random()*.1),h[3]]),inTunnel=(x,z)=>r.tunnels.find(t=>x>t.rect[0]-1e-7&&x<t.rect[1]+1e-7&&z>t.rect[2]-1e-7&&z<t.rect[3]+1e-7);
 function top(x,z){let y=r.baseHeight;for(const [hx,hz,h,rad] of hills){const d=Math.hypot(x-hx,z-hz)/rad;if(d<1)y=Math.max(y,r.baseHeight+h*(1+Math.cos(Math.PI*d))/2);}
  let road=null;
  for(const q of r.routes.filter(q=>q.kind==='ground')){let best={d:Infinity};for(let i=1;i<q.points.length;i++){const n=nearSegment(x,z,q.points[i-1],q.points[i]);if(n.d<best.d)best=n;}
   const t=r.tunnels.find(t=>t.axis==='x'?x>=t.rect[0]&&x<=t.rect[1]:z>=t.rect[2]&&z<=t.rect[3]);
   if(t&&Math.abs(best.y-t.floor)<1&&best.d<q.width/2+q.blend)continue;
   const a=clamp((best.d-q.width/2)/q.blend,0,1),strength=1-a*a*(3-2*a);
   if(!road||strength>road.strength)road={strength,y:best.y};
  }
  if(road)y=mix(y,road.y,road.strength);
  for(const b of Object.values(r.bases)){const t=clamp((Math.hypot(x-b[0],z-b[1])-38)/18,0,1);y=mix(b[2],y,t*t*(3-2*t));}
  const t=inTunnel(x,z);if(t)y=Math.max(y,t.ceiling+5);return Math.round(y*50)/50;
 }
 const meshes=Object.fromEntries(['dem','tran','fill','ramps','aprons','plazas','streets','historicGround','brid'].map(k=>[k,[]]));
 const tri=(k,a,b,c)=>meshes[k].push(...a,...b,...c);const quad=(k,a,b,c,d)=>{tri(k,a,b,c);tri(k,a,c,d);};
 const step=r.grid,grid=new Map();const key=(x,z)=>x+','+z;
 for(let z=-r.half;z<r.half;z+=step)for(let x=-r.half;x<r.half;x+=step){if(!inside(r.boundary,x+step/2,z+step/2))continue;
  const t=inTunnel(x+step/2,z+step/2),coords=[[x,z],[x,z+step],[x+step,z+step],[x+step,z]],upper=coords.map(([x,z])=>[x,top(x,z),z]);
  const floor=upper.map(p=>{const portal=r.tunnels.find(q=>q.axis==='x'?([q.rect[0],q.rect[1]].includes(p[0])&&p[2]>=q.rect[2]&&p[2]<=q.rect[3]):([q.rect[2],q.rect[3]].includes(p[2])&&p[0]>=q.rect[0]&&p[0]<=q.rect[1]));return [p[0],t?t.floor:portal?portal.floor:p[1],p[2]];});quad('dem',...floor);grid.set(key(x,z),{floor:floor.map(p=>p[1]),top:t?upper.map(p=>p[1]):null});
  if(t){quad('brid',...upper);quad('brid',...coords.map(([x,z])=>[x,t.ceiling,z]).reverse());}
 }
 // 切り抜いた地形の側壁。入口の面は天井から上だけ塞ぐ。
 for(const t of r.tunnels){const [x0,x1,z0,z1]=t.rect;for(const [a,b,portal] of [[[x0,z0],[x1,z0],t.axis==='z'],[[x1,z0],[x1,z1],t.axis==='x'],[[x1,z1],[x0,z1],t.axis==='z'],[[x0,z1],[x0,z0],t.axis==='x']]){const n=Math.round(Math.hypot(b[0]-a[0],b[1]-a[1])/step);for(let i=0;i<n;i++){const p=[mix(a[0],b[0],i/n),mix(a[1],b[1],i/n)],q=[mix(a[0],b[0],(i+1)/n),mix(a[1],b[1],(i+1)/n)],lo=portal?t.ceiling:t.floor;quad('brid',[p[0],lo,p[1]],[q[0],lo,q[1]],[q[0],top(...q),q[1]],[p[0],top(...p),p[1]]);}}}
 const decks=[];
 for(const q of r.routes.filter(q=>q.kind==='deck'))for(let i=1;i<q.points.length;i++){const a=q.points[i-1],b=q.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),nx=-dz/len*q.width/2,nz=dx/len*q.width/2;const p=[[a[0]+nx,a[2],a[1]+nz],[b[0]+nx,b[2],b[1]+nz],[b[0]-nx,b[2],b[1]-nz],[a[0]-nx,a[2],a[1]-nz]];quad('brid',...p);quad('brid',...p.map(v=>[v[0],v[1]-q.thickness,v[2]]).reverse());for(let j=0;j<4;j++){const v=p[j],w=p[(j+1)%4];quad('brid',v,[v[0],v[1]-q.thickness,v[2]],[w[0],w[1]-q.thickness,w[2]],w);}decks.push({a,b,width:q.width,thickness:q.thickness});}
 function sample(x,z){const gx=Math.floor(x/step)*step,gz=Math.floor(z/step)*step,c=grid.get(key(gx,gz));if(!c)return null;const u=(x-gx)/step,v=(z-gz)/step;const interp=a=>v>=u?a[0]*(1-v)+a[1]*(v-u)+a[2]*u:a[0]*(1-u)+a[2]*v+a[3]*(u-v);return {floor:interp(c.floor),roof:c.top?interp(c.top):null};}
 function levels(x,z){const s=sample(x,z);if(!s)return [];const ys=[s.floor];if(s.roof!==null)ys.push(s.roof);for(const d of decks){const n=nearSegment(x,z,d.a,d.b);if(n.d<d.width/2-.1)ys.push(n.y);}return [...new Set(ys.map(y=>Math.round(y*50)/50))].sort((a,b)=>a-b);}
 function ground(x,z,y){const ys=levels(x,z);return ys.filter(h=>h<=y+.6).pop()??ys[0]??-1000;}
 function ceiling(x,z,y){let c=Infinity,t=inTunnel(x,z);if(t&&t.ceiling>=y+3.95)c=t.ceiling;for(const d of decks){const n=nearSegment(x,z,d.a,d.b),h=n.y-d.thickness;if(n.d<d.width/2&&h>=y+3.95)c=Math.min(c,h);}return c;}
 function free(x,z,y){if((r.blocks||[]).some(b=>Math.abs(x-b[0])<b[2]/2+1.4&&Math.abs(z-b[1])<b[3]/2+1.4&&y<b[5]-.25&&y+4>b[4]))return false;return inside(r.boundary,x,z)&&boundaryDistance(r.boundary,x,z)>1.4&&ceiling(x,z,y)>=y+4.1;}
 function walk(a,b){let y=a[2],n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1]));for(let i=1;i<=n;i++){const x=mix(a[0],b[0],i/n),z=mix(a[1],b[1],i/n),h=ground(x,z,y);if(Math.abs(h-y)>1.1+.05||!free(x,z,h))return false;y=h;}return Math.abs(y-b[2])<.65;}
 const nodes=[],byXZ=new Map(),links=[];
 for(let z=-r.half+5;z<r.half;z+=r.navStep)for(let x=-r.half+5;x<r.half;x+=r.navStep){const ids=[];for(const y of levels(x,z)){if(!free(x,z,y))continue;ids.push(nodes.length);nodes.push([x,z,y]);}if(ids.length)byXZ.set(key(x,z),ids);}
 for(const [k,ids] of byXZ){const [x,z]=k.split(',').map(Number);for(const [dx,dz] of [[r.navStep,0],[0,r.navStep],[r.navStep,r.navStep],[-r.navStep,r.navStep]])for(const a of ids)for(const b of byXZ.get(key(x+dx,z+dz))||[])if(walk(nodes[a],nodes[b])&&walk(nodes[b],nodes[a]))links.push([a,b]);}
 const pack=arr=>Buffer.from(new Int16Array(arr.map(v=>Math.round(v/.02))).buffer).toString('base64');
 const surfaces={};for(const [k,a] of Object.entries(meshes)){const points=[],ids=[],seen=new Map();for(let i=0;i<a.length;i+=3){const p=a.slice(i,i+3).map(v=>Math.round(v*50)/50),key=p.join(',');let id=seen.get(key);if(id===undefined){id=points.length/3;points.push(...p);seen.set(key,id);}ids.push(id);}assert(points.length/3<65536,'mesh vertex budget');surfaces[k]={step:.02,points:pack(points),indices:Buffer.from(new Uint16Array(ids).buffer).toString('base64')};}
 const plants=r.plants,baseSpawns={},respawns={},bases={},districtBases=[];
 for(const team of ['B','R']){const s=team==='B'?1:-1,b=r.bases[team];bases[team]={at:b.slice(0,2),radius:42,catapults:[[-22+b[0],b[1]-12*s,-35,b[1]-55*s],[22+b[0],b[1]-12*s,35,b[1]-55*s]]};districtBases.push({team,at:b.slice(0,2),height:b[2]});baseSpawns[team]=[-12,0,12].map(x=>[b[0]+x,b[1]-16*s]);respawns[team]={};for(const [id,x,z] of plants)respawns[team][id]=[-8,0,8].map(dx=>[x+dx,z+48*s]);}
 // 元の地形を変えずに、施設候補を検査する。失敗を黙って承認しない。
 for(const p of [...Object.values(baseSpawns).flat(),...Object.values(respawns).flatMap(o=>Object.values(o).flat())])assert(free(...p,ground(...p,100)),'spawn outside/clearance');
 const def={order:90,name:r.name,size:[r.half,r.half],team:5,time:300,baseZ:r.bases.B[1],baseLine:r.bases.B[1]-42,desc:'谷底から山腹、尾根へ。岩盤の通り抜けと横断橋の上下を使い分ける。',asym:true,terrain:[],layout:[],plants,turrets:[[-25,r.bases.B[1]-30],[25,r.bases.B[1]-30]],radar:[-26,r.bases.B[1]+15],catapults:[],basePods:[[-18,r.bases.B[1]-16]],plantPods:[],barricades:[],bases,nav:{nodes,links,heightAware:true},attribution:'手続き生成のオリジナル形状。外部画像・モデルの使用なし。',cityBattle:{nodeReach:3,baseSpawns,respawns},cityTerrain:{geometryEncoding:'city-layout-v1',half:r.half,boundary:r.boundary,groundMaximum:Math.max(...hills.map(h=>h[2]))+r.baseHeight+10,river:{bed:-30,water:-29,rings:[]},ringCoordinateStep:.02,volumeKinds:['grounded'],volumes:(r.blocks||[]).map(([x,z,w,d,bottom,top])=>[0,bottom,top,[pack([x-w/2,z-d/2,x+w/2,z-d/2,x+w/2,z+d/2,x-w/2,z+d/2])],{}]),decorations:[],packing:{layers:Object.fromEntries(Object.keys(meshes).map(k=>[k,true]))},surfaces,district:{unifiedGround:{color:r.color},roofPads:[],bases:districtBases}},recipeMeta:{version:1,seed,grid:r.grid,routes:r.routes,tunnels:r.tunnels}};
 // 空のvolumesも正当な地形（施設は本体が追加する）。
 return {definition:def,stats:{triangles:Object.values(meshes).reduce((n,a)=>n+a.length/9,0),nodes:nodes.length,links:links.length,seed},sample,levels,walk};
}
if(require.main===module){const args=process.argv.slice(2),r=JSON.parse(fs.readFileSync(args[0])),out=args[1],seed=args[2]===undefined?r.seed:Number(args[2]),v=compile(r,seed);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,`// tools/terrain_recipe.js による生成物。レシピを編集して再生成。\n(window.MAP_DATA=window.MAP_DATA||{}).${r.id}=${JSON.stringify(v.definition)};\n`);console.log(JSON.stringify(v.stats));}
module.exports={validate,compile,inside,boundaryDistance};
