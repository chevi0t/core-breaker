// 都市地形の試走用。機体・入力・ブースト・重力は本体を使い、地形との接触だけを差し替える。
async function createCityTrial(T, packed) {
  const bytes = Uint8Array.from(atob(packed), c => c.charCodeAt(0));
  const data = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  const arrays = Object.fromEntries(Object.entries(data.meshes).map(([k, b]) => {
    const u = Uint8Array.from(atob(b), c => c.charCodeAt(0));
    return [k, new Float32Array(u.buffer)];
  }));
  const radius = 1.3, height = 4, half = data.half, cell = 16;
  const key = (x, z) => Math.floor(x / cell) + ',' + Math.floor(z / cell);
  function index(items) {
    const grid = new Map();
    for (const item of items) for (let x = Math.floor(item.minX / cell); x <= Math.floor(item.maxX / cell); x++)
      for (let z = Math.floor(item.minZ / cell); z <= Math.floor(item.maxZ / cell); z++) {
        const k = x + ',' + z;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(item);
      }
    return (x, z, r = 0) => {
      if (!r) return grid.get(key(x, z)) || [];
      const found = new Set();
      for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++)
        for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++)
          for (const item of grid.get(i + ',' + j) || []) found.add(item);
      return found;
    };
  }
  const volumes = data.volumes.map(v => {
    const points = v.rings.flat();
    return {...v, minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
      minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1]))};
  });
  const nearby = index(volumes);
  function triangles(keys) {
    const result = [];
    for (const k of keys) {
      const a = arrays[k];
      for (let i = 0; i < a.length; i += 9) {
        const p = [0, 3, 6].map(j => new T.Vector3(a[i+j], a[i+j+1], a[i+j+2]));
        const tri = new T.Triangle(...p), normal = tri.getNormal(new T.Vector3());
        const den = (p[1].z-p[2].z)*(p[0].x-p[2].x)+(p[2].x-p[1].x)*(p[0].z-p[2].z);
        result.push({tri, normal, den, minX: Math.min(...p.map(v => v.x)), maxX: Math.max(...p.map(v => v.x)),
          minZ: Math.min(...p.map(v => v.z)), maxZ: Math.max(...p.map(v => v.z)),
          minY: Math.min(...p.map(v => v.y)), maxY: Math.max(...p.map(v => v.y))});
      }
    }
    return result;
  }
  const ground = index(triangles(['dem', 'tran', 'fill', 'ramps', 'aprons', 'plazas','streets','historicGround']));
  const bridgeTriangles = triangles(['brid']);
  const bridge = index(bridgeTriangles);
  const walls = index(bridgeTriangles.filter(t => Math.abs(t.normal.y) < .65));
  function surface(t, x, z) {
    if (Math.abs(t.den) < 1e-8) return null;
    const {a, b, c} = t.tri;
    const u = ((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/t.den;
    const v = ((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/t.den;
    return u >= -1e-6 && v >= -1e-6 && u+v <= 1.000001 ? u*a.y+v*b.y+(1-u-v)*c.y : null;
  }
  function terrainH(x, z) {
    let y = data.river.bed;
    for (const t of ground(x, z)) {
      const h = surface(t, x, z);
      if (h !== null) y = Math.max(y, h);
    }
    return y;
  }
  // 穴のある多角形にも対応。内外判定と最寄りの辺を共通に使い、屋根と壁の形を合わせる。
  function contact(v, x, z) {
    let inside = false, distance2 = Infinity, px = 0, pz = 0, nx=0, nz=0;
    for (const ring of v.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, az] = ring[j], [bx, bz] = ring[i];
      if ((az > z) !== (bz > z) && x < (bx-ax)*(z-az)/(bz-az)+ax) inside = !inside;
      const dx = bx-ax, dz = bz-az, l2 = dx*dx+dz*dz;
      const t = l2 ? Math.max(0, Math.min(1, ((x-ax)*dx+(z-az)*dz)/l2)) : 0;
      const qx = ax+t*dx, qz = az+t*dz, d2 = (x-qx)**2+(z-qz)**2;
      if (d2 < distance2) { distance2 = d2; px = qx; pz = qz; nx=dz; nz=-dx; }
    }
    return {inside, distance2, px, pz, nx, nz};
  }
  function overlaps(v, x, z, r) {
    const c = contact(v, x, z);
    return c.inside || c.distance2 <= r*r;
  }
  // 線分同士の最短点。橋の壁は元メッシュと機体の縦カプセルの最短距離で判定する。
  function segments(a, b, c, d) {
    const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
    const A = u.dot(u), B = u.dot(v), C = v.dot(v), D = u.dot(w), E = v.dot(w), den = A*C-B*B;
    let s = den > 1e-9 ? Math.max(0, Math.min(1, (B*E-C*D)/den)) : 0;
    let t = C > 1e-9 ? (B*s+E)/C : 0;
    if (t < 0) { t = 0; s = A ? Math.max(0, Math.min(1, -D/A)) : 0; }
    else if (t > 1) { t = 1; s = A ? Math.max(0, Math.min(1, (B-D)/A)) : 0; }
    return [a.clone().addScaledVector(u, s), c.clone().addScaledVector(v, t)];
  }
  function capsuleTriangle(t, p) {
    const a = p.clone().add(new T.Vector3(0, radius, 0)), b = p.clone().add(new T.Vector3(0, height-radius, 0));
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(t.normal, t.tri.a);
    const hit = plane.intersectLine(new T.Line3(a, b), new T.Vector3());
    if (hit && t.tri.containsPoint(hit)) return [hit.clone(), hit];
    let best = [a, t.tri.closestPointToPoint(a, new T.Vector3())];
    const candidates = [[b, t.tri.closestPointToPoint(b, new T.Vector3())],
      ...[[t.tri.a,t.tri.b],[t.tri.b,t.tri.c],[t.tri.c,t.tri.a]].map(([c,d]) => segments(a,b,c,d))];
    for (const pair of candidates) if (pair[0].distanceToSquared(pair[1]) < best[0].distanceToSquared(best[1])) best = pair;
    return best;
  }
  function clamp(u) {
    for (const axis of ['x', 'z']) {
      const p = Math.max(-half+radius, Math.min(half-radius, u.pos[axis]));
      if (p !== u.pos[axis]) { u.pos[axis] = p; u.vel[axis] = 0; }
    }
  }
  function resolve(u) {
    clamp(u);
    for (let pass = 0; pass < 4; pass++) {
      let pushed = false;
      for (const v of nearby(u.pos.x, u.pos.z, radius)) {
        if (u.pos.y >= v.top-.25 || u.pos.y+height <= v.bottom+.001) continue;
        const c = contact(v, u.pos.x, u.pos.z), d = Math.sqrt(c.distance2);
        if (!c.inside && d >= radius) continue;
        let dx = c.inside ? c.px-u.pos.x : u.pos.x-c.px;
        let dz = c.inside ? c.pz-u.pos.z : u.pos.z-c.pz;
        if (d < 1e-8) {
          // 辺の真上では、微小な試点で外向きを決める。
          dx = c.nx; dz = c.nz;
          const l = Math.hypot(dx,dz) || 1; dx /= l; dz /= l;
          if (contact(v,u.pos.x+dx*.001,u.pos.z+dz*.001).inside) { dx = -dx; dz = -dz; }
        } else { dx /= d; dz /= d; }
        const push = c.inside ? d+radius+.001 : radius-d+.001;
        u.pos.x += dx*push; u.pos.z += dz*push; pushed = true;
      }
      for (const t of walls(u.pos.x, u.pos.z, radius)) {
        if (u.pos.y >= t.maxY-.05 || u.pos.y+height <= t.minY+.05) continue;
        const [a,b] = capsuleTriangle(t, u.pos), delta = a.sub(b), distance = delta.length();
        if (distance >= radius) continue;
        delta.y = 0;
        if (delta.lengthSq() < 1e-9) delta.copy(t.normal).setY(0);
        if (delta.lengthSq() < 1e-9) continue;
        delta.normalize().multiplyScalar(radius-distance+.001);
        u.pos.add(delta); pushed = true;
      }
      clamp(u);
      if (!pushed) break;
    }
  }
  function groundAt(x, z, y) {
    let h = terrainH(x, z);
    for (const v of nearby(x,z,radius*.6)) if (v.top <= y+.6 && overlaps(v,x,z,radius*.6)) h = Math.max(h,v.top);
    for (const t of bridge(x,z)) if (t.normal.y > .65) {
      const q = surface(t,x,z);
      if (q !== null && q <= y+.6) h = Math.max(h,q);
    }
    return h;
  }
  function ceilingAt(x, z, y) {
    let h = Infinity;
    for (const v of nearby(x,z,radius*.6)) if (v.bottom >= y+height-.05 && overlaps(v,x,z,radius*.6)) h = Math.min(h,v.bottom);
    for (const t of bridge(x,z)) if (t.normal.y < -.65) {
      const q = surface(t,x,z);
      if (q !== null && q >= y+height-.05) h = Math.min(h,q);
    }
    return h;
  }
  function cameraFree(p,r){
    if(p.y-r<terrainH(p.x,p.z))return false;
    for(const v of nearby(p.x,p.z,r))if(p.y+r>v.bottom&&p.y-r<v.top&&overlaps(v,p.x,p.z,r))return false;
    for(const t of bridge(p.x,p.z,r))if(t.tri.closestPointToPoint(p,new T.Vector3()).distanceToSquared(p)<r*r)return false;
    return true;
  }
  const cameraSolids=[],cameraController=createCityCamera(T,cameraSolids,terrainH,ceilingAt,cameraFree);
  let mapCanvas;
  function drawMap(g,W,H,u) {
    if (!mapCanvas) {
      mapCanvas = document.createElement('canvas'); mapCanvas.width = mapCanvas.height = 600;
      const c = mapCanvas.getContext('2d'); c.fillStyle = '#858b85'; c.fillRect(0,0,600,600);
      function path(rings) { c.beginPath(); for (const ring of rings) { ring.forEach(([x,z],i) => i ? c.lineTo(x+half,z+half) : c.moveTo(x+half,z+half)); c.closePath(); } }
      c.fillStyle='#3e4b54';
      const road=new Float32Array([...arrays.tran,...arrays.streets]);
      c.beginPath();for(let i=0;i<road.length;i+=9){for(let j=0;j<9;j+=3)j?c.lineTo(road[i+j]+half,road[i+j+2]+half):c.moveTo(road[i]+half,road[i+2]+half);c.closePath();}c.fill();
      for (const rings of data.river.rings) { path(rings); c.fillStyle = '#34789a'; c.fill('evenodd'); }
      for(const rings of data.heritage.rings){path(rings);c.fillStyle=data.heritage.surfaceColor;c.fill('evenodd');}
      path([data.district.railGap.rings[0]]);c.fillStyle='#9eafb2';c.fill();
      for (const v of [...volumes].sort((a,b)=>a.top-b.top)) { path(v.rings); c.fillStyle = v.landmarkColor || (v.kind === 'rail-deck' ? '#a0c8d3' : v.kind==='rail-shop'?'#b09d81':v.top>50?'#6c8b9c':'#bbc0ba'); c.fill('evenodd');c.strokeStyle='#7a8584';c.lineWidth=.35;c.stroke(); }
      for(const exit of data.river.exits){
        c.strokeStyle='#b8eb8c';c.lineWidth=exit.width;
        c.beginPath();c.moveTo(exit.start[0]+half,exit.start[2]+half);c.lineTo(exit.end[0]+half,exit.end[2]+half);c.lineTo(exit.street[0]+half,exit.street[2]+half);c.stroke();
      }
      c.strokeStyle = '#92dbe4'; c.strokeRect(1,1,598,598);
      for(const b of data.district.bases){
        c.beginPath();c.arc(b.at[0]+half,b.at[1]+half,b.radius,0,Math.PI*2);
        c.fillStyle=b.team==='B'?'#389bee66':'#fa8b3b66';c.fill();c.strokeStyle=b.team==='B'?'#64c9ff':'#ffaf68';c.lineWidth=2;c.stroke();
        c.fillStyle='#fff';c.font='bold 12px system-ui';c.textAlign='center';c.fillText(b.team==='B'?'青基地':'橙基地',b.at[0]+half,b.at[1]+half+4);
      }
      for(const p of data.district.roofPads){
        c.fillStyle='#97ffd3';c.beginPath();c.arc(p.at[0]+half,p.at[1]+half,5,0,Math.PI*2);c.fill();
        c.strokeStyle='#71f5bd';c.lineWidth=2;c.beginPath();c.moveTo(p.at[0]+half,p.at[1]+half);c.lineTo(p.exit[0]+half,p.exit[1]+half);c.stroke();
      }
    }
    g.clearRect(0,0,W,H); g.drawImage(mapCanvas,0,0,W,H);
    if (u) {
      const x=(u.pos.x+half)/(half*2)*W,z=(u.pos.z+half)/(half*2)*H;
      g.save(); g.translate(x,z); g.rotate(-u.yaw); g.fillStyle='#fff';
      g.beginPath(); g.moveTo(0,-5); g.lineTo(3,4); g.lineTo(-3,4); g.fill(); g.restore();
    }
  }
  function mount(root,hittables) {
    const colors={bldg:0xffffff,tran:0x424d58,streets:0x424d58,historicGround:0x858178,historicWall:0x945b43,brid:0x8d8b7e,dem:0x8a8d85,fill:0x8a8d85,plazas:0x68727b,ramps:0x79936b,aprons:0x79936b,exitMarks:0xd5f093,rail:0xffffff,station:0xffffff,shops:0xffffff,crossShops:0xffffff,railLinkShops:0xffffff,bank:0x667477,bed:0x6c7167,water:0x3987aa};
    for (const [k,a] of Object.entries(arrays)) {
      const geo=new T.BufferGeometry(); geo.setAttribute('position',new T.BufferAttribute(a,3)); geo.computeVertexNormals(); geo.computeBoundingSphere();
      if(k==='historicGround'){
        // 上面と斜面の陰影もつなぎ、格子ごとの三角形が斑点に見えないようにする。
        const normals=geo.attributes.normal.array,sums=new Map(),ids=[];
        for(let i=0;i<a.length;i+=3){const id=[a[i],a[i+1],a[i+2]].map(v=>Math.round(v*1000)).join(',');ids.push(id);if(!sums.has(id))sums.set(id,new T.Vector3());sums.get(id).add(new T.Vector3(normals[i],normals[i+1],normals[i+2]));}
        for(const n of sums.values())n.normalize();for(let i=0;i<ids.length;i++)sums.get(ids[i]).toArray(normals,i*3);
      }
      if (data.colors[k]) {
        const c=new Float32Array(a.length);
        for (const range of data.colors[k]) { const col=new T.Color(range.color); for(let i=range.start;i<range.start+range.count;i++) col.toArray(c,i*3); }
        geo.setAttribute('color',new T.BufferAttribute(c,3));
        if(k==='bldg'){
          const glass=new Float32Array(a.length/3);
          for(const range of data.colors[k])if(range.glass)glass.fill(1,range.start,range.start+range.count);
          geo.setAttribute('cityGlass',new T.BufferAttribute(glass,1));
        }
      }
      const mesh=new T.Mesh(geo,new T.MeshLambertMaterial({color:colors[k],vertexColors:!!data.colors[k],side:T.DoubleSide,
        transparent:k==='water',opacity:k==='water'?.68:1,depthWrite:k!=='water',polygonOffset:k==='tran',polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
      if(k==='bldg'){
        // 窓と屋根は同じ描画で着色し、窓ごとの箱・テクスチャ通信を増やさない。
        mesh.material.onBeforeCompile=shader=>{
          const declarations='varying vec3 cityPoint; varying vec3 cityNormal; varying float glassFacade;\n';
          shader.vertexShader='attribute float cityGlass;\n'+declarations+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ncityPoint=(modelMatrix*vec4(transformed,1.0)).xyz;cityNormal=normalize(mat3(modelMatrix)*normal);glassFacade=cityGlass;');
          shader.fragmentShader=declarations+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            float side=1.0-step(0.45,abs(cityNormal.y));
            float horizontal=abs(cityNormal.x)>abs(cityNormal.z)?cityPoint.z:cityPoint.x;
            vec2 pane=fract(vec2(horizontal/2.8,cityPoint.y/3.5));
            float window=side*step(0.18,pane.x)*(1.0-step(0.82,pane.x))*step(0.24,pane.y)*(1.0-step(0.82,pane.y))*step(2.0,cityPoint.y);
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.22,0.34,0.40),window*0.68);
            diffuseColor.rgb*=mix(0.70,1.0,side);
            float fresnel=pow(1.0-abs(dot(normalize(cityNormal),normalize(cameraPosition-cityPoint))),3.0);
            float reflection=0.5+0.5*sin(cityPoint.y*0.11+horizontal*0.012);
            vec3 glassColor=mix(vec3(0.22,0.40,0.49),vec3(0.72,0.88,0.93),fresnel*0.55+reflection*0.24);
            float frame=max(1.0-step(0.045,pane.x),1.0-step(0.045,pane.y));
            diffuseColor.rgb=mix(diffuseColor.rgb,glassColor*mix(1.0,0.47,frame),glassFacade*side);
          `);
        };
        mesh.material.customProgramCacheKey=()=> 'city-facade-v2';
      }
      if(k==='historicWall'){
        mesh.material.onBeforeCompile=shader=>{
          const d='varying vec3 brickPoint;\n';
          shader.vertexShader=d+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nbrickPoint=(modelMatrix*vec4(transformed,1.0)).xyz;');
          shader.fragmentShader=d+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            float along=dot(brickPoint.xz,vec2(0.814,0.581));float row=floor(brickPoint.y/0.34);
            vec2 tile=fract(vec2(along/0.9+row*0.5,brickPoint.y/0.34));
            float joint=max(1.0-step(0.07,tile.x),1.0-step(0.09,tile.y));
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.40,0.34,0.29),joint*0.65);
            float x=abs(fract(along/6.4)-0.5)*6.4,y=brickPoint.y+1.3;
            float arch=(1.0-step(2.1,x))*step(0.0,y)*(1.0-step(2.2+sqrt(max(0.0,4.41-x*x)),y));
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.12,0.18,0.20),arch*0.85);
          `);
        };
        mesh.material.customProgramCacheKey=()=> 'city-historic-wall-v1';
      }
      mesh.name='city-'+k; mesh.receiveShadow=true; mesh.castShadow=['bldg','rail','station','shops'].includes(k); root.add(mesh);
      if(k!=='water'&&k!=='exitMarks') {
        // 描画は層ごとにまとめたまま、レイ判定だけを32m街区へ分けて近傍に絞る。
        const chunks=new Map();
        for(let i=0;i<a.length;i+=9){
          const x=(a[i]+a[i+3]+a[i+6])/3,z=(a[i+2]+a[i+5]+a[i+8])/3,key=Math.floor(x/32)+','+Math.floor(z/32);
          if(!chunks.has(key))chunks.set(key,[]);
          const chunk=chunks.get(key);for(let j=0;j<9;j++)chunk.push(a[i+j]);
        }
        for(const values of chunks.values()){
          const collider=new T.BufferGeometry();collider.setAttribute('position',new T.Float32BufferAttribute(values,3));collider.computeBoundingSphere();collider.computeBoundingBox();
          const m=new T.Mesh(collider,mesh.material);m.name='city-collision-'+k;m.updateMatrixWorld(true);hittables.push(m);cameraSolids.push(m);
        }
      }
    }
    // 当たり判定は無限の高さで四辺を制限し、見た目にも範囲を示す。
    const barrier=new T.MeshBasicMaterial({color:0x7bd8e8,transparent:true,opacity:.055,side:T.DoubleSide,depthWrite:false});
    for(const axis of ['x','z']) for(const sign of [-1,1]) {
      const geo=new T.PlaneGeometry(half*2,220),m=new T.Mesh(geo,barrier);
      m.position.set(0,100,0); m.position[axis]=sign*half; if(axis==='x')m.rotation.y=Math.PI/2; root.add(m);
      const line=new T.LineSegments(new T.EdgesGeometry(geo),new T.LineBasicMaterial({color:0x7bd8e8,transparent:true,opacity:.6}));
      line.position.copy(m.position);line.rotation.copy(m.rotation);root.add(line);
    }
    root.updateMatrixWorld(true);
  }
  return {mount,terrainH,groundAt,ceilingAt,resolve,drawMap,volumes,arrays,spawns:data.spawns,river:data.river,half,
    district:data.district,landmarks:data.landmarks,streetRepairs:data.streetRepairs,heritage:data.heritage,base:team=>data.district.bases.find(b=>b.team===team),
    addCameraGeometry:meshes=>{for(const m of meshes){
      m.updateWorldMatrix(true,false);
      const geometry=m.geometry.clone().applyMatrix4(m.matrixWorld);geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const proxy=new T.Mesh(geometry,m.material);proxy.updateMatrixWorld(true);cameraSolids.push(proxy);
    }},
    groundMaximum:data.groundMaximum,contact,nearby,cameraPose:cameraController.solve,cameraTooClose:cameraController.tooClose,
    get cameraState(){return cameraController.state;},cameraFree};
}
