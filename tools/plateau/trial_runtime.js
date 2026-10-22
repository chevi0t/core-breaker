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
  const ground = index(triangles(['dem', 'tran', 'fill']));
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
  let mapCanvas;
  function drawMap(g,W,H,u) {
    if (!mapCanvas) {
      mapCanvas = document.createElement('canvas'); mapCanvas.width = mapCanvas.height = 600;
      const c = mapCanvas.getContext('2d'); c.fillStyle = '#324743'; c.fillRect(0,0,600,600);
      function path(rings) { c.beginPath(); for (const ring of rings) { ring.forEach(([x,z],i) => i ? c.lineTo(x+half,z+half) : c.moveTo(x+half,z+half)); c.closePath(); } }
      for (const rings of data.river.rings) { path(rings); c.fillStyle = '#34789a'; c.fill('evenodd'); }
      for (const v of volumes) { path(v.rings); c.fillStyle = v.kind === 'rail-deck' ? '#a0c8d3' : '#7c8c92'; c.fill('evenodd'); }
      c.strokeStyle = '#92dbe4'; c.strokeRect(1,1,598,598);
    }
    g.clearRect(0,0,W,H); g.drawImage(mapCanvas,0,0,W,H);
    if (u) {
      const x=(u.pos.x+half)/(half*2)*W,z=(u.pos.z+half)/(half*2)*H;
      g.save(); g.translate(x,z); g.rotate(-u.yaw); g.fillStyle='#fff';
      g.beginPath(); g.moveTo(0,-5); g.lineTo(3,4); g.lineTo(-3,4); g.fill(); g.restore();
    }
  }
  function mount(root,hittables) {
    const colors={bldg:0xc6cace,tran:0x7494a8,brid:0xd8ad71,dem:0x728b6b,fill:0x728b6b,rail:0xffffff,station:0xffffff,shops:0xffffff,bank:0x667477,bed:0x6c7167,water:0x3987aa};
    for (const [k,a] of Object.entries(arrays)) {
      const geo=new T.BufferGeometry(); geo.setAttribute('position',new T.BufferAttribute(a,3)); geo.computeVertexNormals(); geo.computeBoundingSphere();
      if (data.colors[k]) {
        const c=new Float32Array(a.length);
        for (const range of data.colors[k]) { const col=new T.Color(range.color); for(let i=range.start;i<range.start+range.count;i++) col.toArray(c,i*3); }
        geo.setAttribute('color',new T.BufferAttribute(c,3));
      }
      const mesh=new T.Mesh(geo,new T.MeshLambertMaterial({color:colors[k],vertexColors:!!data.colors[k],side:T.DoubleSide,
        transparent:k==='water',opacity:k==='water'?.68:1,depthWrite:k!=='water',polygonOffset:k==='tran',polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
      mesh.name='city-'+k; mesh.receiveShadow=true; mesh.castShadow=['bldg','rail','station','shops'].includes(k); root.add(mesh);
      if(k!=='water') {
        // 描画は層ごとにまとめたまま、レイ判定だけを32m街区へ分けて近傍に絞る。
        const chunks=new Map();
        for(let i=0;i<a.length;i+=9){
          const x=(a[i]+a[i+3]+a[i+6])/3,z=(a[i+2]+a[i+5]+a[i+8])/3,key=Math.floor(x/32)+','+Math.floor(z/32);
          if(!chunks.has(key))chunks.set(key,[]);
          const chunk=chunks.get(key);for(let j=0;j<9;j++)chunk.push(a[i+j]);
        }
        for(const values of chunks.values()){
          const collider=new T.BufferGeometry();collider.setAttribute('position',new T.Float32BufferAttribute(values,3));collider.computeBoundingSphere();
          const m=new T.Mesh(collider,mesh.material);m.name='city-collision-'+k;m.updateMatrixWorld(true);hittables.push(m);
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
    groundMaximum:data.groundMaximum,contact,nearby};
}
