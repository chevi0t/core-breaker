/* 地面の生成テクスチャと交通構造の描画。外部画像・通信は使用しない。 */
window.OdaibaDetail = (() => {
  const T = THREE;
  const linear = c => new T.Color(c).convertSRGBToLinear();
  function random(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function texture(kind, seed, bump = false) {
    const n = kind === 'grass' ? 256 : 512, canvas = document.createElement('canvas'); canvas.width = canvas.height = n;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(n, n), rand = random(seed);
    const base = { asphalt:[67,73,74], concrete:[146,151,143], paving:[164,150,129], grass:[84,112,68] }[kind];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const noise = (rand()-.5)*(kind==='asphalt'?17:kind==='grass'?27:10);
      const mottled = Math.sin(x*.075)*Math.sin(y*.055)*2.8, at=(y*n+x)*4;
      for (let c=0;c<3;c++) image.data[at+c]=bump?128+noise*2:base[c]+noise+mottled;
      image.data[at+3]=255;
    }
    ctx.putImageData(image,0,0);
    if (kind==='concrete' || kind==='paving') {
      const cell=kind==='paving'?64:170;ctx.strokeStyle=bump?'#666':'rgba(35,43,42,.18)';ctx.lineWidth=kind==='paving'?2:1.5;
      for(let y=0;y<n;y+=cell){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(n,y);ctx.stroke();const offset=kind==='paving'&&(Math.floor(y/cell)%2)?cell/2:0;for(let x=-cell+offset;x<n;x+=cell){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,Math.min(n,y+cell));ctx.stroke();}}
    }
    if(kind==='grass') { ctx.strokeStyle=bump?'#aaa':'rgba(162,177,105,.18)';ctx.lineWidth=.7;for(let i=0;i<1900;i++){const x=rand()*n,y=rand()*n;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(rand()-.5)*3,y-2-rand()*5);ctx.stroke();} }
    const map=new T.CanvasTexture(canvas);map.wrapS=map.wrapT=T.RepeatWrapping;map.encoding=bump?T.LinearEncoding:T.sRGBEncoding;map.anisotropy=8;return map;
  }
  function materials(recipe) {
    const result={},seed=recipe?.seed||39126;
    for(const [i,kind]of ['asphalt','concrete','paving','grass'].entries()) result[kind]=new T.MeshPhongMaterial({color:0xffffff,map:texture(kind,seed+i*971),bumpMap:texture(kind,seed+i*971,true),bumpScale:kind==='grass'?.025:.018,shininess:kind==='asphalt'?5:9,specular:linear('#162125'),side:T.DoubleSide});
    return result;
  }
  function uv(geometry, tile) { const p=geometry.attributes.position,a=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){a[i*2]=p.getX(i)/tile;a[i*2+1]=p.getZ(i)/tile;}geometry.setAttribute('uv',new T.BufferAttribute(a,2));return geometry; }
  function build(scene,data,mats) {
    const bins=new Map(),stats={routes:0,piers:0,lamps:0,underground:0},step=data.coordinateStep;
    function add(key,values){let a=bins.get(key);if(!a){a=[];bins.set(key,a);}for(const x of values)a.push(x);}
    function tri(key,a,b,c){add(key,[...a,...b,...c]);}
    function quad(key,a,b,c,d){tri(key,a,b,c);tri(key,a,c,d);}
    function box(key,center,size,angle=0) {const c=Math.cos(angle),s=Math.sin(angle),p=[];for(const yy of [-1,1])for(const zz of [-1,1])for(const xx of [-1,1]){const x=xx*size[0]/2,z=zz*size[2]/2;p.push([center[0]+x*c-z*s,center[1]+yy*size[1]/2,center[2]+x*s+z*c]);}for(const f of [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]])quad(key,...f.map(i=>p[i]));}
    function beam(key,a,b,width,depth=width) {const d=new T.Vector3(...b).sub(new T.Vector3(...a)),q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize()),g=new T.BoxGeometry(width,d.length(),depth),p=g.attributes.position,ids=g.index;const mid=new T.Vector3(...a).add(new T.Vector3(...b)).multiplyScalar(.5),out=[];for(let i=0;i<ids.count;i++){const v=new T.Vector3().fromBufferAttribute(p,ids.getX(i)).applyQuaternion(q).add(mid);out.push(v.x,v.y,v.z);}add(key,out);g.dispose();}
    function cylinder(key,center,radius,height,sides=8) {for(let i=0;i<sides;i++){const a=i/sides*Math.PI*2,b=(i+1)/sides*Math.PI*2,p=[center[0]+Math.cos(a)*radius,center[1]-height/2,center[2]+Math.sin(a)*radius],q=[center[0]+Math.cos(b)*radius,center[1]-height/2,center[2]+Math.sin(b)*radius],r=[q[0],center[1]+height/2,q[2]],s=[p[0],center[1]+height/2,p[2]];quad(key,p,q,r,s);tri(key,[center[0],center[1]+height/2,center[2]],s,r);}}
    function decode(s){const raw=atob(s),b=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);const a=new Int16Array(b.buffer),p=[];for(let i=0;i<a.length;i+=3)p.push([a[i]*step,a[i+1]*step,a[i+2]*step]);return p;}
    function pathInfo(points){const d=[0];for(let i=1;i<points.length;i++)d.push(d[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][2]-points[i-1][2]));return d;}
    function at(points,dist,s){let i=1;while(i<dist.length-1&&dist[i]<s)i++;const f=Math.max(0,Math.min(1,(s-dist[i-1])/Math.max(.0001,dist[i]-dist[i-1]))),a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[2]-a[2],n=Math.hypot(dx,dz)||1;return {p:a.map((v,k)=>v+(b[k]-v)*f),normal:[-dz/n,0,dx/n],angle:Math.atan2(dz,dx),i};}
    function offset(p,n,x,y=0){return[p[0]+n[0]*x,p[1]+y,p[2]+n[2]*x];}
    function strip(key,a,b,na,nb,leftA,rightA,leftB,rightB,dy=0){quad(key,offset(a,na,leftA,dy),offset(b,nb,leftB,dy),offset(b,nb,rightB,dy),offset(a,na,rightA,dy));}
    function lamp(p,n,side,ringLamp=false){const x=offset(p,n,side),h=ringLamp?3.8:2.7;cylinder('metal',[x[0],x[1]+h/2,x[2]],.055,h);if(ringLamp){for(let j=0;j<5;j++){const y=x[1]+h-.3-j*.36;cylinder('metal',[x[0],y,x[2]],.29-j*.018,.045,10);cylinder('lamp',[x[0],y+.025,x[2]],.16,.035,8);}}else{for(const sign of [-1,1])beam('metal',[x[0],x[1]+h-.55,x[2]],[x[0]+n[0]*sign*.23,x[1]+h+.12,x[2]+n[2]*sign*.23],.045);cylinder('lamp',[x[0],x[1]+h-.05,x[2]],.13,.27,8);}stats.lamps++;}
    function pier(p,n,width,kind){if(p[1]<1.8)return;const floor=kind==='promenade'?-3:0,top=p[1]-(kind==='promenade'?.85:.5),h=top-floor;if(h<=.3)return;const angle=Math.atan2(n[2],n[0]);if(kind==='promenade'){box('concrete',[p[0],floor+h/2,p[2]],[width*.84,h,1.6],angle);box('stone',[p[0],floor+.15,p[2]],[width*.91,.45,2.3],angle);}else{cylinder('concrete',[p[0],floor+h/2,p[2]],kind==='guideway'?.38:.48,h,8);box('concrete',[p[0],top-.2,p[2]],[Math.max(1.8,width*.86),.55,.65],angle);}stats.piers++;}
    const routes=data.transport?.routes||[];
    for(const route of routes){const points=decode(route.path);if(points.length<2)continue;stats.routes++;const dist=pathInfo(points),length=dist.at(-1),kind=route.kind,prom=kind==='promenade',guide=kind==='guideway',road=kind==='expressway'||kind==='expresswayGround'||kind==='roadbridge',ground=kind==='expresswayGround',deck=road?'asphalt':'paving',sample=[];
      for(let s=0;s<length;s+=prom?1.6:3)sample.push(at(points,dist,s));sample.push(at(points,dist,length));
      function width(s){if(!prom)return route.width;const t=s/length;return route.width+6.65*Math.sin(Math.PI*3*t)**2;}
      for(let i=1;i<sample.length;i++){const a=sample[i-1],b=sample[i],s0=Math.min(length,(i-1)*(prom?1.6:3)),s1=Math.min(length,i*(prom?1.6:3)),wa=width(s0),wb=width(s1),thick=guide?.5:prom?.62:.55;
        strip(guide?'concrete':deck,a.p,b.p,a.normal,b.normal,-wa/2,wa/2,-wb/2,wb/2);
        for(const side of [-1,1]){const aa=offset(a.p,a.normal,side*wa/2),bb=offset(b.p,b.normal,side*wb/2),bottomA=ground?[aa[0],0,aa[2]]:[aa[0],aa[1]-thick,aa[2]],bottomB=ground?[bb[0],0,bb[2]]:[bb[0],bb[1]-thick,bb[2]];quad(prom?'stone':'concrete',aa,bb,bottomB,bottomA);}
        strip('concrete',a.p,b.p,a.normal,b.normal,-wa/2,wa/2,-wb/2,wb/2,-thick);
        if(prom){for(const side of [-1,1]){strip('stone',a.p,b.p,a.normal,b.normal,side*(wa/2-.8),side*(wa/2-.35),side*(wb/2-.8),side*(wb/2-.35),.03);beam('bronze',offset(a.p,a.normal,side*(wa/2-.22),.9),offset(b.p,b.normal,side*(wb/2-.22),.9),.07);}}
        else if(guide){for(const f of [-.45,-.06,.06,.45]){beam('concrete',offset(a.p,a.normal,wa*f,.22),offset(b.p,b.normal,wb*f,.22),.18,.24);beam('guide',offset(a.p,a.normal,wa*f,.4),offset(b.p,b.normal,wb*f,.4),.04);}
          for(const f of [-.25,.25])for(const track of [-1,1])strip('rubber',a.p,b.p,a.normal,b.normal,wa*f+track*.24-.09,wa*f+track*.24+.09,wb*f+track*.24-.09,wb*f+track*.24+.09,.012);
        }else{for(const side of [-1,1]){beam('concrete',offset(a.p,a.normal,side*(wa/2-.12),.32),offset(b.p,b.normal,side*(wb/2-.12),.32),.22,.34);if(road)strip('paint',a.p,b.p,a.normal,b.normal,side*(wa/2-.38)-.035,side*(wa/2-.38)+.035,side*(wb/2-.38)-.035,side*(wb/2-.38)+.035,.025);}if(road&&route.width>6.5)beam('concrete',offset(a.p,a.normal,0,.3),offset(b.p,b.normal,0,.3),.25,.35);}
      }
      if(prom){for(let s=2;s<length-2;s+=1.2){const q=at(points,dist,s),w=width(s);for(const side of [-1,1]){beam('bronze',offset(q.p,q.normal,side*(w/2-.22),.1),offset(q.p,q.normal,side*(w/2-.22),.88),.055);}}
        for(let s=7;s<length-5;s+=13){const q=at(points,dist,s),w=width(s);for(const side of [-1,1])lamp(q.p,q.normal,side*(w/2-1.2),Math.round(s/13)%3===0);}
        for(const fraction of [.05,.35,.65,.95]){const q=at(points,dist,length*fraction);pier(q.p,q.normal,width(length*fraction),kind);}
        // 三径間の下側の曲線桁。張り出す高欄や橋脚と合わせて歩道橋らしい輪郭にする。
        for(let s=length*.05;s<length*.95;s+=2){const q=at(points,dist,s),r=at(points,dist,Math.min(length*.95,s+2)),phase=((s/length-.05)/.3)%1,phaseB=(((s+2)/length-.05)/.3)%1,depth=.5+1.15*(2*phase-1)**2,depthB=.5+1.15*(2*phaseB-1)**2;for(const f of [-.34,0,.34]){const aa=offset(q.p,q.normal,width(s)*f,-.5),bb=offset(r.p,r.normal,width(s+2)*f,-.5),cc=[bb[0],bb[1]-depthB,bb[2]],dd=[aa[0],aa[1]-depth,aa[2]];quad('girder',aa,bb,cc,dd);}}
      }else if(!ground){for(let s=5;s<length-3;s+=guide?9:12){const q=at(points,dist,s),i=Math.min(route.piers.length-1,q.i);if(route.piers[i])pier(q.p,q.normal,route.width,kind);}}
      if(road){const lanes=route.width>6.5?4:2;for(let s=0;s<length-1.4;s+=3.5){const a=at(points,dist,s),b=at(points,dist,Math.min(length,s+1.6));for(let j=1;j<lanes;j++){if(lanes===4&&j===2)continue;const x=-route.width/2+route.width*j/lanes;strip('paint',a.p,b.p,a.normal,b.normal,x-.035,x+.035,x-.035,x+.035,.025);}}}
    }
    for(const path of data.transport?.markings||[]){const points=decode(path),dist=pathInfo(points),length=dist.at(-1);for(let s=1;s<length-1;s+=4){const a=at(points,dist,s),b=at(points,dist,Math.min(length,s+1.7));strip('paint',a.p,b.p,a.normal,b.normal,-.045,.045,-.045,.045,.025);}}
    // 本当の水際だけに岸壁を付け、取得範囲の切れ目を新しい岸壁にはしない。
    function ring2(s){const raw=atob(s),b=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);const a=new Int16Array(b.buffer),p=[];for(let i=0;i<a.length;i+=2)p.push([a[i]*step,a[i+1]*step]);return p;}
    const waters=data.water.map(rs=>rs.map(ring2));
    function inside(p,r){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
    function isWater(x,z){return waters.some(rs=>inside([x,z],rs[0])&&!rs.slice(1).some(r=>inside([x,z],r)));}
    for(const rs of data.land)for(const ring of rs){const r=ring2(ring);for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length],dx=b[0]-a[0],dz=b[1]-a[1],n=Math.hypot(dx,dz)||1,mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;if(!isWater(mx-dz/n*.22,mz+dx/n*.22)&&!isWater(mx+dz/n*.22,mz-dx/n*.22))continue;const p=[a[0],0,a[1]],q=[b[0],0,b[1]];quad('quay',p,q,[q[0],-3,q[2]],[p[0],-3,p[2]]);beam('stone',[p[0],.07,p[2]],[q[0],.07,q[2]],.18,.25);}}
    const solid={concrete:'#a4aaa5',stone:'#b7b6a5',metal:'#616b6c',bronze:'#727267',guide:'#849395',rubber:'#626c68',girder:'#647473',paint:'#d8d7c7',quay:'#6a7f7b'};
    const mat={...mats};for(const [k,c]of Object.entries(solid))mat[k]=new T.MeshLambertMaterial({color:linear(c),side:T.DoubleSide});mat.lamp=new T.MeshBasicMaterial({color:linear('#f3ddad')});
    // 路面に添える白線と走行帯だけ深度をずらし、遠景のちらつきを避ける。
    for(const key of ['paint','rubber']){mat[key].polygonOffset=true;mat[key].polygonOffsetFactor=-2;mat[key].polygonOffsetUnits=-2;}
    for(const [key,arr]of bins){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(arr,3));g.computeVertexNormals();if(['asphalt','concrete','paving','grass'].includes(key))uv(g,key==='asphalt'?4:3);const m=new T.Mesh(g,mat[key]||mat.concrete);m.name='transport-'+key;scene.add(m);}
    return {stats,materials:mat};
  }
  return {materials,uv,build};
})();
