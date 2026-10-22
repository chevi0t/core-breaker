// OSM の地形候補を、本体の通行判定で検査してから保存する。
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
const {openMap}=require('./mapgen_browser');
const args=process.argv.slice(2),source=args[0],out=args[1];
if(!out)throw new Error('使い方: node tools/generate_osm_city.js source.osm 出力先/osm_city.js');
const root=path.resolve(__dirname,'..'),debug=process.env.OSM_DEBUG_DIR||'dbg/osm-city-v2';
function run(cmd,args){if(spawnSync(cmd,args,{cwd:root,stdio:'inherit'}).status)throw new Error(cmd+' に失敗しました');}
(async()=>{
 run('python3',['tools/mapgen_osm.py',source,'--output',out,'--id','osm_city']);
 run('python3',['tools/test/make_dbg.py',debug]);
 const json=out.replace(/\.js$/,'.json'),bundle=JSON.parse(fs.readFileSync(json)),d=bundle.map;
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const {page,errors}=await openMap(browser,'osm_city',d,20261022,{silent:true,debugDir:debug});
  d.nav=await page.evaluate(()=>{
   const g=__g,d=g.curMap,nodes=[],seen=new Set();
   const add=(x,z,y)=>{
    const key=[x,z,y].map(v=>v.toFixed(2)).join(',');
    if(seen.has(key)||Math.abs(x)>d.size[0]-4||Math.abs(z)>d.size[1]-4)return;
    if(Math.abs(g.groundAt(x,z,y)-y)>.4)return;
    if(g.obstacles.some(o=>x>o.minX-1.8&&x<o.maxX+1.8&&z>o.minZ-1.8&&z<o.maxZ+1.8&&o.top>y+.6&&(o.bottom===undefined||o.bottom<y+4.1)))return;
    seen.add(key);nodes.push([x,z,y]);
   };
   for(const [x,z,y]of d.generation.navPoints)add(x,z,Math.abs(y-g.terrainH(x,z))<.4?g.terrainH(x,z):y);
   for(const p of g.plants)for(const dx of [-6,6])add(p.pos.x+dx,p.pos.z+3,g.terrainH(p.pos.x+dx,p.pos.z+3));
   for(const pod of g.pods)add(pod.pos.x,pod.pos.z,pod.pos.y);
   for(const c of g.catapults){add(c.pos.x+5,c.pos.z,c.pos.y);add(c.land.x,c.land.z,c.land.y);}
   for(const z of g.ziplines)add(z.bottom.x,z.bottom.z,z.bottom.y);
   const walk=(a,b)=>{
    if(!g.clearPath(a[0],a[1],b[0],b[1],a[2])||Math.abs(g.pathEndH-b[2])>.3)return false;
    // X/Z を別々に動かす本体に合わせ、橋の縁と急な斜面を除外する。
    const n=Math.max(1,Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])));let y=a[2];
    for(let i=0;i<=n;i++){
     const x=a[0]+(b[0]-a[0])*i/n,z=a[1]+(b[1]-a[1])*i/n;
     y=g.groundAt(x,z,y);
     if(g.bridges.some(o=>x>o.minX-1.8&&x<o.maxX+1.8&&z>o.minZ-1.8&&z<o.maxZ+1.8&&y<o.top-.25&&y+4.1>o.bottom))return false;
     if(Math.abs(g.groundAt(x+.5,z,y)-g.groundAt(x-.5,z,y))>.9||Math.abs(g.groundAt(x,z+.5,y)-g.groundAt(x,z-.5,y))>.9)return false;
    }
    return true;
   };
   const links=[],adj=nodes.map(()=>[]);
   for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    if(Math.hypot(nodes[i][0]-nodes[j][0],nodes[i][1]-nodes[j][1])>67||!walk(nodes[i],nodes[j])||!walk(nodes[j],nodes[i]))continue;
    links.push([i,j]);adj[i].push(j);adj[j].push(i);
   }
   const nearest=(p)=>nodes.reduce((a,q,i)=>Math.hypot(q[0]-p[0],q[1]-p[1])+Math.abs(q[2]-p[2])*3<Math.hypot(nodes[a][0]-p[0],nodes[a][1]-p[1])+Math.abs(nodes[a][2]-p[2])*3?i:a,0);
   const targets=[...Object.entries(d.bases).map(([team,b])=>[b.at[0]+8,b.at[1]+(team==='B'?-20:20),0]),...g.plants.map(p=>[p.pos.x+6,p.pos.z+3,g.terrainH(p.pos.x+6,p.pos.z+3)])];
   const seed=nearest(targets[0]),reached=new Set([seed]),stack=[seed];
   while(stack.length)for(const j of adj[stack.pop()])if(!reached.has(j)){reached.add(j);stack.push(j);}
   for(const p of targets)if(![...reached].some(i=>Math.hypot(nodes[i][0]-p[0],nodes[i][1]-p[1])<67&&walk(nodes[i],p)&&walk(p,nodes[i])))throw new Error('街区の施設が孤立しています '+JSON.stringify(p));
   const order=[...reached].sort((a,b)=>a-b),remap=new Map(order.map((old,i)=>[old,i]));
   return{nodes:order.map(i=>nodes[i]),links:links.filter(([a,b])=>reached.has(a)&&reached.has(b)).map(([a,b])=>[remap.get(a),remap.get(b)])};
  });
  if(errors.length)throw new Error(errors.join('\n'));
  delete d.generation.navPoints;
  fs.writeFileSync(out,'// OSM由来の地理データは ODbL-1.0。本体で通行検査済み。\n(window.MAP_DATA=window.MAP_DATA||{}).osm_city='+JSON.stringify(d)+';\n');
  fs.writeFileSync(json,JSON.stringify(bundle));
  console.log('本体の通行検査：節点',d.nav.nodes.length,'リンク',d.nav.links.length);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
