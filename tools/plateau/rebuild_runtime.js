// 再構築案だけに組み込む。建物の輪郭・高さを、描画と接触判定で共用する。
function expandCityLayout(T,data){
  if(data.geometryEncoding!=='city-layout-v1')throw Error('未対応の街区データ');
  const unpackRings=rings=>rings.map(r=>{
    const a=new Int16Array(Uint8Array.from(atob(r),c=>c.charCodeAt(0)).buffer),points=[];
    for(let i=0;i<a.length;i+=2)points.push([a[i]/100,a[i+1]/100]);return points;
  });
  data.volumes=data.volumes.map(([kind,bottom,top,rings,meta])=>({kind:data.volumeKinds[kind],bottom,top,rings:unpackRings(rings),...meta}));
  for(const d of data.decorations)d.rings=unpackRings(d.rings);
  delete data.volumeKinds;
  const layers={},colors={};
  const add=(name,points,color,glass=false)=>{
    const a=layers[name]||(layers[name]=[]),start=a.length/3;a.push(...points);
    if(color)(colors[name]||(colors[name]=[])).push({start,count:points.length/3,color,glass});
  };
  function faces(rings,y){
    const contour=rings[0].map(p=>new T.Vector2(...p)),holes=rings.slice(1).map(r=>r.map(p=>new T.Vector2(...p)));
    const points=[contour,...holes].flat(),a=[];
    for(const ids of T.ShapeUtils.triangulateShape(contour,holes)){
      let [p,q,r]=ids.map(i=>points[i]);
      if((q.y-p.y)*(r.x-p.x)-(q.x-p.x)*(r.y-p.y)<0)[q,r]=[r,q];
      a.push(p.x,y,p.y,q.x,y,q.y,r.x,y,r.y);
    }
    return a;
  }
  function extrude(v,floor){
    // 入れ子の穴は使わず、外周と穴それぞれの壁を明示する。屋根の三角化はThree.js同梱のEarcut。
    const a=faces(v.rings,v.top);
    if(floor){const base=faces(v.rings,v.bottom);for(let i=0;i<base.length;i+=9)a.push(...base.slice(i,i+3),...base.slice(i+6,i+9),...base.slice(i+3,i+6));}
    for(const ring of v.rings)for(let i=0;i<ring.length;i++){
      const [x,z]=ring[i],[xx,zz]=ring[(i+1)%ring.length],lo=v.bottom,hi=v.top;
      a.push(x,lo,z,xx,lo,zz,x,hi,z,xx,lo,zz,xx,hi,zz,x,hi,z);
    }
    return a;
  }
  const palette=['#889da8','#a69f90','#aab0ae','#7f929a','#9d9181','#8b8785','#8c9da0','#a6a39b'];
  const layerFor={'rail-deck':'rail','rail-pier':'rail','rail-shop':'shops','station-roof':'station','station-support':'station'};
  const buildings=new Set(['grounded','infill','upper','elevated']);
  for(const v of data.volumes){
    const building=buildings.has(v.kind),layer=building?'bldg':layerFor[v.kind];if(!layer)continue;
    const center=v.rings[0].reduce((a,p)=>[a[0]+p[0]/v.rings[0].length,a[1]+p[1]/v.rings[0].length],[0,0]);
    const color=building?(v.landmarkColor||(v.top>50?'#7b94a0':palette[Math.abs(Math.round(center[0]*7)+Math.round(center[1]*13))%palette.length])):
      v.kind==='rail-shop'?'#89918e':v.kind==='station-roof'?'#c2cbd0':v.kind==='station-support'?'#74858e':'#b4bbc2';
    add(layer,extrude(v,!['grounded','infill'].includes(v.kind)),color,v.facade==='glass');
  }
  for(const d of data.decorations)add('rail',faces(d.rings,d.height),d.color);
  for(const rings of data.river.rings){
    add('bed',extrude({rings,bottom:data.river.bed-.5,top:data.river.bed},true));
    add('water',faces(rings,data.river.water));
  }
  const encode=a=>{const bytes=new Uint8Array(new Float32Array(a).buffer);let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
  data.meshes=Object.fromEntries(Object.entries(layers).map(([k,a])=>[k,encode(a)]));
  for(const [name,m] of Object.entries(data.surfaces)){
    const decode=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));
    const p=new Int16Array(decode(m.points).buffer),ids=new Uint16Array(decode(m.indices).buffer),a=new Float32Array(ids.length*3);
    for(let i=0;i<ids.length;i++)for(let j=0;j<3;j++)a[i*3+j]=p[ids[i]*3+j]*m.step;
    data.meshes[name]=encode(a);
  }
  for(const k of Object.keys(data.packing.layers))data.meshes[k]??='';
  data.colors=colors;delete data.surfaces;delete data.decorations;
}
