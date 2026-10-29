// JSONレシピを既存city-layout-v1へコンパイル。任意JS/頂点をレシピに許可しない。
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),mix=(a,b,t)=>a+(b-a)*t;
function inside(poly,x,z){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[j],b=poly[i];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function nearSegment(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1);return {d:Math.hypot(x-mix(a[0],b[0],t),z-mix(a[1],b[1],t)),y:mix(a[2],b[2],t)};}
function boundaryDistance(poly,x,z){return Math.min(...poly.map((a,i)=>nearSegment(x,z,[...a,0],[...poly[(i+1)%poly.length],0]).d));}
function validate(r){
 const num=n=>typeof n==='number'&&Number.isFinite(n),point=(p,n)=>Array.isArray(p)&&p.length===n&&p.every(num);
 assert(Object.keys(r).every(k=>['version','id','name','half','grid','navStep','seed','boundary','color','baseHeight','hills','bases','routes','tunnels','plants','blocks','rolling','blockKind','turretSites','lengthScale','catapultTargets','props','team','order','heightZones','water','description','respawnMode','walls','smoothTerrain'].includes(k)),'unknown recipe field');assert(r.lengthScale===undefined||[1,1.5,2].includes(r.lengthScale),'lengthScale 1/1.5/2');assert(r.version===1,'version must be 1');assert(/^[a-z][a-z0-9_]*$/.test(r.id),'id');assert(typeof r.name==='string'&&r.name.length<80,'name');
 assert([4,5,10].includes(r.grid)&&num(r.half)&&r.half>=120&&r.half<=900&&r.half%r.grid===0&&2*r.half/r.grid<=180,'grid/half budget');assert(r.navStep===r.grid*2,'navStep must be twice grid');assert(Number.isInteger(r.seed),'seed');assert(/^#[0-9a-f]{6}$/i.test(r.color),'color');assert(num(r.baseHeight),'baseHeight');
 assert(Array.isArray(r.boundary)&&r.boundary.length>=4&&r.boundary.length<=40,'boundary');
 for(const [i,a] of r.boundary.entries()){const b=r.boundary[(i+1)%r.boundary.length];assert(point(a,2)&&a.every(v=>Math.abs(v)<r.half&&v%r.grid===0),'grid-aligned boundary');assert(a[0]!==b[0]||a[1]!==b[1],'nonzero boundary edge');
  for(let j=i+2;j<r.boundary.length;j++){if(i===0&&j===r.boundary.length-1)continue;const c=r.boundary[j],d=r.boundary[(j+1)%r.boundary.length];const cross=(p,q,t)=>(q[0]-p[0])*(t[1]-p[1])-(q[1]-p[1])*(t[0]-p[0]);assert(!(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))),'self-intersecting boundary');}
 }
 const polygon=p=>Array.isArray(p)&&p.length>=3&&p.length<=60&&p.every(q=>point(q,2)&&q.every(v=>Math.abs(v)<r.half));
 assert(r.heightZones===undefined||(Array.isArray(r.heightZones)&&r.heightZones.length<=20),'heightZones budget');for(const q of r.heightZones||[])assert(polygon(q.ring)&&num(q.height)&&q.height>=-20&&q.height<=100&&num(q.feather)&&q.feather>=2&&q.feather<=100,'height zone polygon/height/feather');
 if(r.water)assert(polygon(r.water.ring)&&num(r.water.bed)&&num(r.water.level)&&r.water.bed<r.water.level&&r.water.bank>=2&&r.water.bank<=30,'water ring/bed/level/bank');
 assert(r.walls===undefined||(Array.isArray(r.walls)&&r.walls.length<=24),'walls budget');for(const w of r.walls||[])assert(point(w.a,2)&&point(w.b,2)&&Math.hypot(w.a[0]-w.b[0],w.a[1]-w.b[1])>=2&&num(w.bottom)&&num(w.top)&&w.top>w.bottom&&w.top<=100&&w.width>=1&&w.width<=6,'wall a/b/bottom/top/width');if(r.water?.color)assert(/^#[0-9a-f]{6}$/i.test(r.water.color),'water color');
 assert(r.smoothTerrain===undefined||typeof r.smoothTerrain==='boolean','smoothTerrain');assert(r.respawnMode===undefined||r.respawnMode==='towardBase','respawnMode');assert(r.description===undefined||typeof r.description==='string','description');
 for(const w of r.rolling||[])assert(point(w,4)&&Math.abs(w[0])<=8&&w[1]>=60&&w[1]<=400,'rolling [amplitude,wavelength,angleRadians,phaseRadians]');assert((r.rolling||[]).length<=4,'rolling budget');
 assert(Array.isArray(r.hills)&&r.hills.length<=40,'hills budget');for(const h of r.hills)assert(point(h,4)&&h[2]>=0&&h[2]<=100&&h[3]>=15,'hill [x,z,height,radius]');
 for(const b of Object.values(r.bases)){assert(point(b,3)&&inside(r.boundary,...b)&&boundaryDistance(r.boundary,...b)>35,'base clearance');}
 if(r.catapultTargets!==undefined){assert(Object.keys(r.catapultTargets).length===2,'catapultTargets B/R');for(const team of ['B','R']){const targets=r.catapultTargets[team];assert(Array.isArray(targets)&&targets.length===2&&targets.every(p=>point(p,2)&&inside(r.boundary,...p)),'catapultTargets: two interior XZ targets per base');}}
 assert(r.order===undefined||(Number.isInteger(r.order)&&r.order>=0&&r.order<=999),'order 0..999');
 assert(r.team===undefined||[5,8,10].includes(r.team),'team 5/8/10');
 assert(r.props===undefined||(Array.isArray(r.props)&&r.props.length<=96),'props budget');for(const p of r.props||[]){assert(['factory','house','rock'].includes(p.kind)&&point(p.at,2)&&point(p.size,3)&&p.size.every(v=>v>=3&&v<=40)&&inside(r.boundary,...p.at),'props {kind,at,size}');assert(p.yaw===undefined||(p.kind==='house'&&num(p.yaw)&&Math.abs(p.yaw)<=Math.PI),'prop yaw');assert(p.roof===undefined||(p.kind==='house'&&['flat','gable'].includes(p.roof)),'prop roof');assert(p.roofTop===undefined||(p.kind==='house'&&p.roof==='flat'&&num(p.roofTop)&&p.roofTop>=3&&p.roofTop<=120),'flat roofTop');}
 assert(r.bases.B&&r.bases.R,'two bases');assert(r.routes.length>=2&&r.routes.length<=32,'routes budget');const ids=new Set();
 for(const q of r.routes){if(q.arch)assert(q.kind==='deck'&&Number.isInteger(q.arch.spans)&&q.arch.spans>=1&&q.arch.spans<=8&&num(q.arch.bottom)&&q.arch.pier>=2&&q.arch.pier<=6,'arch spans/bottom/pier');assert(!ids.has(q.id),'unique route');ids.add(q.id);assert(['ground','deck'].includes(q.kind)&&q.width>=8&&q.width<=40,'route kind/width');assert(q.kind==='deck'?q.thickness>=1&&q.thickness<=6:q.blend>=5&&q.blend<=40,'route dimensions');assert(q.conform===undefined||(num(q.conform)&&q.conform>=0&&q.conform<=1),'route conform 0..1');assert(q.points.length>=2&&q.points.length<=30,'route points');for(const p of q.points)assert(point(p,3)&&inside(r.boundary,...p)&&boundaryDistance(r.boundary,...p)>q.width/2+2,'route inside boundary');for(let i=1;i<q.points.length;i++){const a=q.points[i-1],b=q.points[i],len=Math.hypot(a[0]-b[0],a[1]-b[1]);assert(len>=5&&Math.abs(a[2]-b[2])/len<=.65,'route slope');}}
 assert(r.tunnels.length<=8,'tunnel budget');for(const t of r.tunnels){assert(t.rim===undefined||(num(t.rim)&&t.rim>=0&&t.rim<=10),'tunnel rim 0..10');assert(['x','z'].includes(t.axis)&&point(t.rect,4)&&t.rect.every(v=>v%r.grid===0),'tunnel grid rectangle');assert(t.rect[1]-t.rect[0]>=10&&t.rect[3]-t.rect[2]>=10&&num(t.floor)&&num(t.ceiling)&&t.ceiling-t.floor>=8,'tunnel clearance');}
 assert(r.blockKind===undefined||['building','wall'].includes(r.blockKind),'blockKind');for(const b of r.blocks||[])assert(point(b,6)&&b[2]>=4&&b[3]>=4&&b[5]>b[4]&&b[5]<=100&&inside(r.boundary,b[0],b[1]),'block [x,z,width,depth,bottom,top]');
 for(const t of r.turretSites||[])assert(['B','R'].includes(t.team)&&point(t.at,3)&&inside(r.boundary,t.at[0],t.at[1])&&r.plants.some(p=>p[0]===t.plant)&&(t.yaw===undefined||num(t.yaw)),'turretSites {team,at:[x,z,y],plant,yaw}');assert((r.turretSites||[]).length<=8,'turret budget');
 assert(r.plants.length>=3&&r.plants.length<=6,'plant count');for(const [id,x,z,owner] of r.plants)assert(typeof id==='string'&&num(x)&&num(z)&&inside(r.boundary,x,z)&&['B','R',null].includes(owner),'plant');return r;
}
function compile(input,seed=input.seed){
 const r=validate(JSON.parse(JSON.stringify({...input,seed})));let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const hills=r.hills.map(h=>[h[0],h[1],h[2]*(.95+random()*.1),h[3]]),inTunnel=(x,z)=>r.tunnels.find(t=>x>t.rect[0]-1e-7&&x<t.rect[1]+1e-7&&z>t.rect[2]-1e-7&&z<t.rect[3]+1e-7);
 function top(x,z){
  // 岩盤の横縁に小さな接続帯を作り、斜面から屋根へ上がる際のカプセル引っ掛かりを防ぐ。
  for(const t of r.tunnels){const rim=t.rim||0;if(!rim)continue;const axial=t.axis==='x'?x:z,lo=t.axis==='x'?t.rect[0]:t.rect[2],hi=t.axis==='x'?t.rect[1]:t.rect[3];if(axial<lo||axial>hi)continue;let v=t.axis==='x'?z:x;const sides=t.axis==='x'?[t.rect[2],t.rect[3]]:[t.rect[0],t.rect[1]];for(const [side,sign] of [[sides[0],-1],[sides[1],1]]){const d=(v-side)*sign;if(d>0&&d<rim*2)v=side+sign*Math.max(0,(d-rim)*2);}if(t.axis==='x')z=v;else x=v;}
  let y=r.baseHeight;for(const [hx,hz,h,rad] of hills){const d=Math.hypot(x-hx,z-hz)/rad;if(d<1)y=Math.max(y,r.baseHeight+h*(1+Math.cos(Math.PI*d))/2);}
  for(const q of r.heightZones||[]){const distance=boundaryDistance(q.ring,x,z),a=inside(q.ring,x,z)?1:clamp(1-distance/q.feather,0,1);y=mix(y,q.height,a*a*(3-2*a));}
  for(const [amplitude,wavelength,angle,phase] of r.rolling||[])y+=amplitude*Math.sin((x*Math.cos(angle)+z*Math.sin(angle))*Math.PI*2/wavelength+phase);
  let road=null;
  for(const q of r.routes.filter(q=>q.kind==='ground')){let best={d:Infinity};for(let i=1;i<q.points.length;i++){const n=nearSegment(x,z,q.points[i-1],q.points[i]);if(n.d<best.d)best=n;}
   const t=r.tunnels.find(t=>t.axis==='x'?x>=t.rect[0]&&x<=t.rect[1]:z>=t.rect[2]&&z<=t.rect[3]);
   if(t&&Math.abs(best.y-t.floor)<1&&best.d<q.width/2+q.blend)continue;
   const a=clamp((best.d-q.width/2)/q.blend,0,1),strength=1-a*a*(3-2*a);
   if(!road||strength>road.strength)road={strength,y:mix(best.y,y,q.conform||0)};
  }
  if(road)y=mix(y,road.y,road.strength);
  for(const b of Object.values(r.bases)){const t=clamp((Math.hypot(x-b[0],z-b[1])-38)/18,0,1);y=mix(b[2],y,t*t*(3-2*t));}
  // 橋の端だけ狭い接続面を作る。周囲全体を平坦な段丘にはしない。
  if(r.rolling)for(const q of r.routes.filter(q=>q.kind==='deck'))for(const p of [q.points[0],q.points[q.points.length-1]]){const a=clamp((Math.hypot(x-p[0],z-p[1])-q.width*.5-3)/18,0,1);y=mix(p[2],y,a*a*(3-2*a));}
  if(r.water){const d=boundaryDistance(r.water.ring,x,z),a=inside(r.water.ring,x,z)?1:clamp(1-d/r.water.bank,0,1);y=mix(y,r.water.bed,a*a*(3-2*a));}
  const t=inTunnel(x,z);if(t)y=Math.max(y,t.ceiling+5);return Math.round(y*50)/50;
 }
 const meshes=Object.fromEntries(['dem','tran','fill','ramps','aprons','plazas','streets','historicGround','brid','historicWall'].map(k=>[k,[]]));
 const tri=(k,a,b,c)=>meshes[k].push(...a,...b,...c);const quad=(k,a,b,c,d)=>{tri(k,a,b,c);tri(k,a,c,d);};

 const roadPolys=[];
 const addRoadPoly=poly=>roadPolys.push({poly,minX:Math.min(...poly.map(p=>p[0])),maxX:Math.max(...poly.map(p=>p[0])),minZ:Math.min(...poly.map(p=>p[1])),maxZ:Math.max(...poly.map(p=>p[1]))});
 if(r.smoothTerrain)for(const q of r.routes.filter(q=>q.kind==='ground')){for(let i=1;i<q.points.length;i++){const a=q.points[i-1],b=q.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),nx=-dz/len*q.width/2,nz=dx/len*q.width/2;addRoadPoly([[a[0]+nx,a[1]+nz],[a[0]-nx,a[1]-nz],[b[0]-nx,b[1]-nz],[b[0]+nx,b[1]+nz]]);}for(const p of q.points)addRoadPoly(Array.from({length:12},(_,i)=>[p[0]+Math.cos(i*Math.PI/6)*q.width/2,p[1]+Math.sin(i*Math.PI/6)*q.width/2]));}
 function clip(poly,ring){let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}const sign=area>=0?1:-1;for(let i=0;i<ring.length&&poly.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dist=p=>sign*((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0])),out=[];for(let j=0;j<poly.length;j++){const p=poly[j],q=poly[(j+1)%poly.length],dp=dist(p),dq=dist(q);if(dp>=-1e-7)out.push(p);if((dp<0)!==(dq<0)){const t=dp/(dp-dq);out.push(p.map((v,k)=>mix(v,q[k],t)));}}poly=out;}return poly;}

 function polygonTriangles(ring){const points=ring.slice(),out=[],cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a[0]*b[1]-b[0]*a[1];}const sign=area>=0?1:-1;while(points.length>3){let found=false;for(let i=0;i<points.length;i++){const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];if(Math.abs(cross(a,b,c))<1e-8){points.splice(i,1);found=true;break;}if(cross(a,b,c)*sign<=0)continue;if(points.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)*sign>=-1e-8&&cross(b,c,p)*sign>=-1e-8&&cross(c,a,p)*sign>=-1e-8))continue;out.push([a,b,c]);points.splice(i,1);found=true;break;}assert(found,'boundary triangulation');}out.push(points);return out;}
 const boundaryTriangles=r.smoothTerrain?polygonTriangles(r.boundary):[];

 function splitConvex(poly,ring){let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}const sign=area>=0?1:-1,out=[];let inner=poly;for(let i=0;i<ring.length&&inner.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dist=p=>sign*((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0])),yes=[],no=[];for(let j=0;j<inner.length;j++){const p=inner[j],q=inner[(j+1)%inner.length],dp=dist(p),dq=dist(q);(dp>=0?yes:no).push(p);if((dp<0)!==(dq<0)){const t=dp/(dp-dq),v=p.map((n,k)=>mix(n,q[k],t));yes.push(v);no.push(v);}}if(no.length>=3)out.push(no);inner=yes;}return {inside:inner,outside:out};}
 function paintedGround(floor,x,z,step){let pieces=[];for(const t of [[floor[0],floor[1],floor[2]],[floor[0],floor[2],floor[3]]]){if(t.every(p=>inside(r.boundary,p[0],p[2])))pieces.push({p:t,street:false});else for(const b of boundaryTriangles){const p=clip(t,b);if(p.length>=3)pieces.push({p,street:false});}}
 // 支持面は連続した元の三角形を保つ。道路の量子化境界を足場判定の継ぎ目にしない。
 for(const q of pieces)for(let i=1;i+1<q.p.length;i++)tri('dem',q.p[0],q.p[i],q.p[i+1]);
 for(const road of roadPolys){if(road.maxX<x||road.minX>x+step||road.maxZ<z||road.minZ>z+step)continue;const next=[];for(const q of pieces){if(q.street){next.push(q);continue;}const cut=splitConvex(q.p,road.poly);for(const p of cut.outside)next.push({p,street:false});if(cut.inside.length>=3)next.push({p:cut.inside,street:true});}pieces=next;}
 for(const q of pieces){if(!q.street)continue;const p=q.p;for(let i=1;i+1<p.length;i++){const a=p[0],b=p[i],c=p[i+1];if(Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))>1e-7)tri(q.street?'streets':'dem',a,b,c);}}}

 const step=r.grid,grid=new Map();const key=(x,z)=>x+','+z;
 for(let z=-r.half;z<r.half;z+=step)for(let x=-r.half;x<r.half;x+=step){if(!inside(r.boundary,x+step/2,z+step/2)&&!(r.boundary.some((p,i)=>p[0]!==r.boundary[(i+1)%r.boundary.length][0]&&p[1]!==r.boundary[(i+1)%r.boundary.length][1])&&boundaryDistance(r.boundary,x+step/2,z+step/2)<step))continue;
  const t=inTunnel(x+step/2,z+step/2),coords=[[x,z],[x,z+step],[x+step,z+step],[x+step,z]],upper=coords.map(([x,z])=>[x,top(x,z),z]);
  const floor=upper.map(p=>{const portal=r.tunnels.find(q=>q.axis==='x'?([q.rect[0],q.rect[1]].includes(p[0])&&p[2]>=q.rect[2]&&p[2]<=q.rect[3]):([q.rect[2],q.rect[3]].includes(p[2])&&p[0]>=q.rect[0]&&p[0]<=q.rect[1]));return [p[0],t?t.floor:portal?portal.floor:p[1],p[2]];});const street=r.heightZones&&r.routes.some(q=>q.kind==='ground'&&q.points.slice(1).some((b,i)=>nearSegment(x+step/2,z+step/2,q.points[i],b).d<q.width/2));if(r.smoothTerrain)paintedGround(floor,x,z,step);else quad(street?'streets':'dem',...floor);grid.set(key(x,z),{floor:floor.map(p=>p[1]),top:t?upper.map(p=>p[1]):null});
  if(t){quad('brid',...upper);quad('brid',...coords.map(([x,z])=>[x,t.ceiling,z]).reverse());}
 }
 // 切り抜いた地形の側壁。入口の面は天井から上だけ塞ぐ。
 for(const t of r.tunnels){const [x0,x1,z0,z1]=t.rect;for(const [a,b,portal] of [[[x0,z0],[x1,z0],t.axis==='z'],[[x1,z0],[x1,z1],t.axis==='x'],[[x1,z1],[x0,z1],t.axis==='z'],[[x0,z1],[x0,z0],t.axis==='x']]){const n=Math.round(Math.hypot(b[0]-a[0],b[1]-a[1])/step);for(let i=0;i<n;i++){const p=[mix(a[0],b[0],i/n),mix(a[1],b[1],i/n)],q=[mix(a[0],b[0],(i+1)/n),mix(a[1],b[1],(i+1)/n)],lo=portal?t.ceiling:t.floor;quad('brid',[p[0],lo,p[1]],[q[0],lo,q[1]],[q[0],top(...q),q[1]],[p[0],top(...p),p[1]]);}}}
 const decks=[];
 for(const q of r.routes.filter(q=>q.kind==='deck'))for(let i=1;i<q.points.length;i++){const a=q.points[i-1],b=q.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),nx=-dz/len*q.width/2,nz=dx/len*q.width/2;const p=[[a[0]+nx,a[2],a[1]+nz],[b[0]+nx,b[2],b[1]+nz],[b[0]-nx,b[2],b[1]-nz],[a[0]-nx,a[2],a[1]-nz]];quad('brid',...p);quad('brid',...p.map(v=>[v[0],v[1]-q.thickness,v[2]]).reverse());for(let j=0;j<4;j++){const v=p[j],w=p[(j+1)%4];quad('brid',v,[v[0],v[1]-q.thickness,v[2]],[w[0],w[1]-q.thickness,w[2]],w);}const deck={a,b,width:q.width,thickness:q.thickness,arch:q.arch};decks.push(deck);
 if(q.arch){const count=q.arch.spans*12;for(let j=0;j<count;j++){const t0=j/count,t1=(j+1)/count,X=t=>mix(a[0],b[0],t),Z=t=>mix(a[1],b[1],t),Y=t=>mix(a[2],b[2],t)-q.thickness,lo=t=>archHeight(deck,t);for(const sign of [-1,1])quad('brid',[X(t0)+nx*sign,lo(t0),Z(t0)+nz*sign],[X(t1)+nx*sign,lo(t1),Z(t1)+nz*sign],[X(t1)+nx*sign,Y(t1),Z(t1)+nz*sign],[X(t0)+nx*sign,Y(t0),Z(t0)+nz*sign]);quad('brid',[X(t0)+nx,lo(t0),Z(t0)+nz],[X(t1)+nx,lo(t1),Z(t1)+nz],[X(t1)-nx,lo(t1),Z(t1)-nz],[X(t0)-nx,lo(t0),Z(t0)-nz]);}}}
 function archHeight(d,t){if(!d.arch)return mix(d.a[2],d.b[2],t)-d.thickness;const span=Math.hypot(d.b[0]-d.a[0],d.b[1]-d.a[1])/d.arch.spans,phase=(t*d.arch.spans)%1,edge=d.arch.pier/(2*span),v=clamp((phase-edge)/(1-2*edge),0,1);return d.arch.bottom+(mix(d.a[2],d.b[2],t)-d.thickness-d.arch.bottom-1)*Math.sqrt(Math.max(0,1-(2*v-1)**2));}
 function underDeck(d,x,z){const dx=d.b[0]-d.a[0],dz=d.b[1]-d.a[1],t=clamp(((x-d.a[0])*dx+(z-d.a[1])*dz)/(dx*dx+dz*dz),0,1);return archHeight(d,t);}
 function sample(x,z){const gx=Math.floor(x/step)*step,gz=Math.floor(z/step)*step,c=grid.get(key(gx,gz));if(!c)return null;const u=(x-gx)/step,v=(z-gz)/step;const interp=a=>v>=u?a[0]*(1-v)+a[1]*(v-u)+a[2]*u:a[0]*(1-u)+a[2]*v+a[3]*(u-v);return {floor:interp(c.floor),roof:c.top?interp(c.top):null};}
 // 小規模な建物・岩。既存の体積と三角形層へまとめ、同じ面を衝突にも使う。
 const props=[],propVolumes=[];
 const rect=(x,z,w,d)=>[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]];
 const volume=(kind,bottom,top,ring,meta={})=>propVolumes.push({kind,bottom,top,ring,meta});
 for(const p of r.props||[]){
  const [x,z]=p.at,[w,d,h]=p.size,yaw=p.yaw||0,turn=q=>[x+(q[0]-x)*Math.cos(yaw)-(q[1]-z)*Math.sin(yaw),z+(q[0]-x)*Math.sin(yaw)+(q[1]-z)*Math.cos(yaw)],ring=rect(x,z,w,d).map(turn),ys=ring.map(q=>{const s=sample(...q);assert(s,'prop footprint outside terrain');return s.roof??s.floor;}),lo=Math.min(...ys,p.roofTop===undefined?Infinity:p.roofTop-h)-.3,base=p.roofTop!==undefined?p.roofTop-h:p.kind==='rock'?(sample(x,z).roof??sample(x,z).floor):Math.max(...ys);
  props.push({kind:p.kind,at:[x,z],size:p.size,yaw,roof:p.roof||'gable',bottom:lo,top:base+h+(p.kind==='rock'||p.roof==='flat'?0:3)});
  if(p.kind==='rock'){
   const lower=[],upper=[];for(let i=0;i<7;i++){const a=i*Math.PI*2/7;lower.push([x+Math.cos(a)*w*.5,lo,z+Math.sin(a)*d*.5]);upper.push([x+Math.cos(a+.15)*w*.32,base+h*(.64+(i%3)*.12),z+Math.sin(a+.15)*d*.32]);}
   for(let i=0;i<7;i++){const j=(i+1)%7;quad('fill',lower[i],upper[i],upper[j],lower[j]);tri('fill',upper[j],upper[i],[x-.3,base+h,z+.1]);}continue;
  }
  volume(p.kind==='house'?'grounded':'rail-shop',lo,base+h,ring,p.kind==='house'?{landmarkColor:'#c4b99d'}:{});
  if(p.kind==='house'){
   if(p.roof==='flat')continue;
   const a=[x-w/2,base+h,z-d/2],b=[x+w/2,base+h,z-d/2],c=[x+w/2,base+h,z+d/2],e=[x-w/2,base+h,z+d/2],u=[x,base+h+3,z-d/2],v=[x,base+h+3,z+d/2];
   const rot=q=>{const xz=turn([q[0],q[2]]);return [xz[0],q[1],xz[1]];};quad('historicWall',...[a,e,v,u].map(rot));quad('historicWall',...[u,v,c,b].map(rot));tri('historicWall',...[a,u,b].map(rot));tri('historicWall',...[e,c,v].map(rot));
  }else{
   volume('station-roof',base+h,base+h+.7,rect(x,z,w+1,d+1));
   for(const off of [-d*.28,0,d*.28])volume('rail-shop',base+h+.7,base+h+3,rect(x,z+off,w*.72,2.2));
   const chimney=Array.from({length:10},(_,i)=>[x+w*.34+Math.cos(i*Math.PI/5)*2,z+d*.28+Math.sin(i*Math.PI/5)*1.4]);volume('station-support',base+h,base+h+13,chimney);
   volume('station-roof',base+h+12.5,base+h+13.3,chimney.map(q=>[x+w*.34+(q[0]-x-w*.34)*1.25,z+d*.28+(q[1]-z-d*.28)*1.25]));
  }
 }
 for(const w of r.walls||[]){const dx=w.b[0]-w.a[0],dz=w.b[1]-w.a[1],len=Math.hypot(dx,dz),nx=-dz/len*w.width/2,nz=dx/len*w.width/2;volume('barrier',w.bottom,w.top,[[w.a[0]+nx,w.a[1]+nz],[w.b[0]+nx,w.b[1]+nz],[w.b[0]-nx,w.b[1]-nz],[w.a[0]-nx,w.a[1]-nz]]);}
 function levels(x,z){const s=sample(x,z);if(!s)return [];const ys=[s.floor];if(s.roof!==null)ys.push(s.roof);for(const d of decks){const n=nearSegment(x,z,d.a,d.b);if(n.d<d.width/2-.1)ys.push(n.y);}return [...new Set(ys.map(y=>Math.round(y*50)/50))].sort((a,b)=>a-b);}
 function ground(x,z,y){const ys=levels(x,z);return ys.filter(h=>h<=y+.6).pop()??ys[0]??-1000;}
 function ceiling(x,z,y){let c=Infinity,t=inTunnel(x,z);if(t&&t.ceiling>=y+3.95)c=t.ceiling;for(const d of decks){const n=nearSegment(x,z,d.a,d.b),h=underDeck(d,x,z);if(n.d<d.width/2&&h>=y+3.95)c=Math.min(c,h);}return c;}
 function free(x,z,y){
  for(const w of r.walls||[])if(y<w.top-.25&&y+4>w.bottom&&nearSegment(x,z,[...w.a,0],[...w.b,0]).d<w.width/2+1.4)return false;
  // 上層の坑口縁は点なら通れても機体半径で角に触れるため、BOT経路を内側へ寄せる。下層の通り抜けは維持。
  for(const t of r.tunnels){const a=t.axis==='x'?x:z,b=t.axis==='x'?z:x,lo=t.axis==='x'?t.rect[0]:t.rect[2],hi=t.axis==='x'?t.rect[1]:t.rect[3],side0=t.axis==='x'?t.rect[2]:t.rect[0],side1=t.axis==='x'?t.rect[3]:t.rect[1];if(y>t.ceiling&&a>=lo&&a<=hi&&b>=side0-(t.rim||0)*2&&b<=side1+(t.rim||0)*2&&Math.min(a-lo,hi-a)<r.grid+1.4)return false;}
  for(const d of decks){const n=nearSegment(x,z,d.a,d.b);if(n.d<d.width/2+1.4&&y<n.y-.25&&y+4>underDeck(d,x,z))return false;}
  if(props.some(p=>{const dx=x-p.at[0],dz=z-p.at[1],c=Math.cos(p.yaw),s=Math.sin(p.yaw);return Math.abs(dx*c+dz*s)<p.size[0]/2+1.4&&Math.abs(-dx*s+dz*c)<p.size[1]/2+1.4&&y<p.top&&y+4>p.bottom;}))return false;if((r.blocks||[]).some(b=>Math.abs(x-b[0])<b[2]/2+1.4&&Math.abs(z-b[1])<b[3]/2+1.4&&y<b[5]-.25&&y+4>b[4]))return false;return inside(r.boundary,x,z)&&boundaryDistance(r.boundary,x,z)>1.4&&ceiling(x,z,y)>=y+4.1;}
 function walk(a,b){let y=a[2],n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1]));for(let i=1;i<=n;i++){const x=mix(a[0],b[0],i/n),z=mix(a[1],b[1],i/n),h=ground(x,z,y);if(Math.abs(h-y)>1.1+.05||!free(x,z,h))return false;y=h;}return Math.abs(y-b[2])<.65;}
 const nodes=[],byXZ=new Map(),links=[];
 for(let z=-r.half+5;z<r.half;z+=r.navStep)for(let x=-r.half+5;x<r.half;x+=r.navStep){const ids=[];for(const y of levels(x,z)){if(!free(x,z,y))continue;ids.push(nodes.length);nodes.push([x,z,y]);}if(ids.length)byXZ.set(key(x,z),ids);}
 for(const [k,ids] of byXZ){const [x,z]=k.split(',').map(Number);for(const [dx,dz] of [[r.navStep,0],[0,r.navStep],[r.navStep,r.navStep],[-r.navStep,r.navStep]])for(const a of ids)for(const b of byXZ.get(key(x+dx,z+dz))||[])if(walk(nodes[a],nodes[b])&&walk(nodes[b],nodes[a]))links.push([a,b]);}
 const used=new Set(links.flat()),remap=new Map(),kept=nodes.filter((n,i)=>{if(!used.has(i))return false;remap.set(i,remap.size);return true;});const keptLinks=links.map(([a,b])=>[remap.get(a),remap.get(b)]);nodes.splice(0,nodes.length,...kept);links.splice(0,links.length,...keptLinks);
 const coordinateStep=r.half>650?.04:.02;const pack=arr=>Buffer.from(new Int16Array(arr.map(v=>Math.round(v/coordinateStep))).buffer).toString('base64');
 const surfaces={};for(const [k,a] of Object.entries(meshes)){const points=[],ids=[],seen=new Map();for(let i=0;i<a.length;i+=3){const p=a.slice(i,i+3).map(v=>Math.round(v*50)/50),key=p.join(',');let id=seen.get(key);if(id===undefined){id=points.length/3;points.push(...p);seen.set(key,id);}ids.push(id);}assert(points.length/3<65536,'mesh vertex budget');surfaces[k]={step:coordinateStep,points:pack(points),indices:Buffer.from(new Uint16Array(ids).buffer).toString('base64')};}
 const plants=r.plants,baseSpawns={},respawns={},bases={},districtBases=[];
 for(const team of ['B','R']){const s=team==='B'?1:-1,b=r.bases[team];bases[team]={at:b.slice(0,2),radius:42,catapults:[[-22+b[0],b[1]-12*s,-35,b[1]-55*s],[22+b[0],b[1]-12*s,35,b[1]-55*s]]};if(r.catapultTargets)bases[team].catapults.forEach((p,i)=>{p[2]=r.catapultTargets[team][i][0];p[3]=r.catapultTargets[team][i][1];});districtBases.push({team,at:b.slice(0,2),height:b[2]});baseSpawns[team]=[-12,0,12].map(x=>[b[0]+x,b[1]-16*s]);respawns[team]={};for(const [id,x,z] of plants)respawns[team][id]=[-8,0,8].map(dx=>[x+dx,z+48*s]);}
 if(r.respawnMode==='towardBase')for(const team of ['B','R'])for(const [id,x,z] of plants){const b=r.bases[team],angle=Math.atan2(b[1]-z,b[0]-x),out=[];for(const off of [0,.16,-.16,.32,-.32,.5,-.5,.7,-.7,1,-1,1.3,-1.3]){const a=angle+off,p=[x+48*Math.cos(a),z+48*Math.sin(a)],y=ground(...p,100);if(free(...p,y)&&y>(r.water?.level??-1000)&&nodes.some(n=>Math.hypot(p[0]-n[0],p[1]-n[1])<20&&Math.abs(y-n[2])<4))out.push(p);if(out.length===3)break;}assert(out.length===3,'safe respawns '+team+id);respawns[team][id]=out;}
 // 元の地形を変えずに、施設候補を検査する。失敗を黙って承認しない。
 for(const p of Object.values(baseSpawns).flat())assert(free(...p,ground(...p,100)),'base spawn outside/clearance');
 // 再出撃の48mは拡張後にも固定。実際に出力する位置を元の地形座標へ戻して検査。
 for(const team of Object.values(respawns))for(const [id,points] of Object.entries(team)){const z=plants.find(p=>p[0]===id)[2];for(const p of points){const q=[p[0],z+(p[1]-z)/(r.lengthScale||1)];assert(free(...q,ground(...q,100)),'plant spawn outside/clearance '+id+' '+q);}}
 const plantPods=[],shelters=[];
 for(const [i,p] of [plants[0],plants[plants.length-1]].entries()){
  const sign=i===0?1:-1,x=p[1]+36,z=p[2]+28*sign;plantPods.push([p[0],x,z]);
  shelters.push([x,z-sign*8,22,2,14,'hesco'],[x-10,z,2,18,14,'hesco'],[x+10,z,2,18,14,'hesco']);
 }
 const def={order:r.order??90,name:r.name,size:[r.half,r.half],team:r.team||5,time:300,baseZ:r.bases.B[1],baseLine:r.bases.B[1]-42,desc:r.description||'谷底から山腹、尾根へ。岩盤の通り抜けと横断橋の上下を使い分ける。',asym:true,terrain:[],layout:shelters,plants,turrets:r.turretSites?[]:[[-25,r.bases.B[1]-30],[25,r.bases.B[1]-30]],...(r.turretSites?{rooftopTurrets:r.turretSites}:{}),radar:[-26,r.bases.B[1]+15],catapults:[],basePods:[[-18,r.bases.B[1]-16]],plantPods,barricades:[],bases,nav:{nodes,links,heightAware:true},attribution:r.heightZones?'参照配置をレシピ化した自作形状。外部画像・モデルの使用なし。':'手続き生成のオリジナル形状。外部画像・モデルの使用なし。',cityBattle:{nodeReach:3,baseSpawns,respawns},cityTerrain:{geometryEncoding:'city-layout-v1',smoothTerrain:!!r.smoothTerrain,half:r.half,boundary:r.boundary,groundMaximum:Math.max(r.baseHeight,...(r.heightZones||[]).map(q=>q.height),...hills.map(h=>h[2]+r.baseHeight),...r.routes.flatMap(q=>q.points.map(p=>p[2])),...r.tunnels.map(t=>t.ceiling))+10+(r.rolling||[]).reduce((n,w)=>n+Math.abs(w[0]),0),river:r.water?{bed:r.water.bed,water:r.water.level,color:r.water.color,rings:[[r.water.ring]]}:{bed:-30,water:-29,rings:[]},ringCoordinateStep:coordinateStep,volumeKinds:[r.blockKind==='wall'?'barrier':'grounded','grounded','rail-shop','station-roof','station-support','barrier'],volumes:(r.blocks||[]).map(([x,z,w,d,bottom,top])=>[0,bottom,top,[pack([x-w/2,z-d/2,x+w/2,z-d/2,x+w/2,z+d/2,x-w/2,z+d/2])],{}]).concat(propVolumes.map(v=>[['grounded','rail-shop','station-roof','station-support','barrier'].indexOf(v.kind)+1,v.bottom,v.top,[pack(v.ring.flat())],v.meta])),decorations:[],packing:{layers:Object.fromEntries(Object.keys(meshes).map(k=>[k,true]))},surfaces,district:{unifiedGround:{color:r.color},roofPads:[],bases:districtBases}},recipeMeta:{version:1,seed,grid:r.grid,routes:r.routes,tunnels:r.tunnels,props}};
 const connectivity=validateConnectivity(r,def,sample);
 // 空のvolumesも正当な地形（施設は本体が追加する）。
 const lengthScale=r.lengthScale||1,output=lengthScale===1?def:JSON.parse(JSON.stringify(def));if(lengthScale!==1)stretchDefinition(output,lengthScale);
 return {definition:output,stats:{triangles:Object.values(meshes).reduce((n,a)=>n+a.length/9,0),nodes:nodes.length,links:links.length,seed,connectivity,lengthScale},sample:(x,z)=>sample(x,z/lengthScale),levels:(x,z)=>levels(x,z/lengthScale),walk:(a,b)=>walk([a[0],a[1]/lengthScale,a[2]],[b[0],b[1]/lengthScale,b[2]])};
}
// 完成した支持面・衝突・navを一緒に伸ばす。頂点を増やさず、地形の上下関係を保つ。
function stretchDefinition(d,f){
 const xz=p=>{p[1]*=f;};
 const c=d.cityTerrain;
 for(const s of Object.values(c.surfaces)){const bytes=Buffer.from(s.points,'base64'),a=new Int16Array(bytes.buffer,bytes.byteOffset,bytes.length/2);for(let i=2;i<a.length;i+=3){const v=Math.round(a[i]*f);assert(Math.abs(v)<=32767,'scaled vertex coordinate budget');a[i]=v;}s.points=Buffer.from(a.buffer,a.byteOffset,a.byteLength).toString('base64');}
 for(const v of c.volumes)for(let i=0;i<v[3].length;i++){const bytes=Buffer.from(v[3][i],'base64'),a=new Int16Array(bytes.buffer,bytes.byteOffset,bytes.length/2);for(let j=1;j<a.length;j+=2){const n=Math.round(a[j]*f);assert(Math.abs(n)<=32767,'scaled volume coordinate budget');a[j]=n;}v[3][i]=Buffer.from(a.buffer,a.byteOffset,a.byteLength).toString('base64');}
 c.boundary.forEach(xz);c.half*=f;d.size=[c.half,c.half];d.baseZ*=f;d.baseLine*=f;
 for(const p of d.layout){xz(p);p[3]*=f;}
 d.turrets.forEach(xz);xz(d.radar);d.basePods.forEach(xz);for(const p of d.plantPods)p[2]*=f;
 for(const p of d.plants)p[2]*=f;
 for(const b of Object.values(d.bases)){xz(b.at);for(const p of b.catapults){p[1]*=f;p[3]*=f;}}
 c.district.bases.forEach(b=>xz(b.at));d.nav.nodes.forEach(xz);
 for(const a of Object.values(d.cityBattle.baseSpawns))a.forEach(xz);
 // 再出撃のプラントから48mという既存ルールは、ステージ寸法と分離する。
 for(const team of Object.values(d.cityBattle.respawns))for(const [id,points] of Object.entries(team)){const z=d.plants.find(p=>p[0]===id)[2];for(const p of points)p[1]=z+(p[1]-z/f);}
 for(const t of d.rooftopTurrets||[])xz(t.at);
 for(const q of d.recipeMeta.routes)q.points.forEach(xz);
 for(const t of d.recipeMeta.tunnels){t.rect[2]*=f;t.rect[3]*=f;}
 for(const p of d.recipeMeta.props||[]){xz(p.at);p.size[1]*=f;}
 d.recipeMeta.lengthScale=f;d.recipeMeta.gridXZ=[d.recipeMeta.grid,d.recipeMeta.grid*f];
}
function validateConnectivity(r,d,sample){
 const adj=d.nav.nodes.map(()=>[]);for(const [u,v] of d.nav.links){adj[u].push(v);adj[v].push(u);}
 const component=Array(adj.length).fill(-1),sizes=[];
 for(let i=0;i<adj.length;i++)if(component[i]<0){const id=sizes.length,todo=[i];component[i]=id;let n=0;while(todo.length){const u=todo.pop();n++;for(const v of adj[u])if(component[v]<0){component[v]=id;todo.push(v);}}sizes.push(n);}
 const near=p=>d.nav.nodes.reduce((best,n,i)=>{const distance=Math.hypot(p[0]-n[0],p[1]-n[1])+Math.abs(p[2]-n[2])*4;return distance<best.d?{i,d:distance}:best;},{i:-1,d:Infinity});
 const root=component[near(r.bases.B).i],anchors=[...Object.values(r.bases),...r.routes.flatMap(q=>q.points.map(p=>q.conform?[p[0],p[1],sample(p[0],p[1]).roof??sample(p[0],p[1]).floor]:p)),...r.plants.map(p=>[p[1],p[2],sample(p[1],p[2]).floor])];
 for(const p of anchors){const n=near(p);assert(n.d<35&&component[n.i]===root,'disconnected route/facility anchor '+p);}
 return {components:sizes,anchors:anchors.length};
}
if(require.main===module){const args=process.argv.slice(2),r=JSON.parse(fs.readFileSync(args[0])),out=args[1],seed=args[2]===undefined?r.seed:Number(args[2]),v=compile(r,seed);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,`// tools/terrain_recipe.js による生成物。レシピを編集して再生成。\n(window.MAP_DATA=window.MAP_DATA||{}).${r.id}=${JSON.stringify(v.definition)};\n`);console.log(JSON.stringify(v.stats));}
module.exports={validate,compile,validateConnectivity,inside,boundaryDistance};
