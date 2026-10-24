// 確認済み地形を本体の機体・移動・カメラで試走する。通常のmaps.jsや施設配置は変更しない。
const fs=require('node:fs'),path=require('node:path');
const {decodeCityVolumes}=require('./city_volume_codec.js');
const ROOT=path.resolve(__dirname,'..'),ID='hoshimichi-west-walk';
function buildDefinition(){
  const city=JSON.parse(fs.readFileSync(path.join(ROOT,'mapdesign/hoshimichi_west/layout.json'),'utf8'));
  const points=encoded=>{const a=Buffer.from(encoded,'base64'),out=[];for(let i=0;i<a.length;i+=4)out.push([a.readInt16LE(i)*city.ringCoordinateStep,a.readInt16LE(i+2)*city.ringCoordinateStep]);return out;};
  const volumes=decodeCityVolumes(city).map(([,bottom,top,rings])=>{
    const poly=rings.map(points),p=poly.flat();return {bottom,top,poly,minX:Math.min(...p.map(p=>p[0])),maxX:Math.max(...p.map(p=>p[0])),minZ:Math.min(...p.map(p=>p[1])),maxZ:Math.max(...p.map(p=>p[1]))};
  });
  function inRing(r,x,z){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>z)!==(r[j][1]>z)&&x<(r[j][0]-r[i][0])*(z-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;}
  function distance(r,x,z){let d=Infinity;for(let i=0;i<r.length;i++){const [a,b]=r[i],[c,e]=r[(i+1)%r.length],dx=c-a,dz=e-b,t=Math.max(0,Math.min(1,((x-a)*dx+(z-b)*dz)/(dx*dx+dz*dz||1)));d=Math.min(d,Math.hypot(x-a-t*dx,z-b-t*dz));}return d;}
  const m=city.surfaces.dem,a=Buffer.from(m.points,'base64'),ids=Buffer.from(m.indices,'base64'),ground=[];
  for(let i=0;i<ids.length;i+=6){const ring=[];for(let j=0;j<6;j+=2){const p=ids.readUInt16LE(i+j)*6;ring.push([a.readInt16LE(p)*m.step,a.readInt16LE(p+4)*m.step]);}ground.push(ring);}
  function free(x,z){
    if(!ground.some(r=>inRing(r,x,z)))return false;
    return !volumes.some(v=>v.bottom<4.2&&v.top>.05&&x>=v.minX-1.8&&x<=v.maxX+1.8&&z>=v.minZ-1.8&&z<=v.maxZ+1.8&&
      ((inRing(v.poly[0],x,z)&&!v.poly.slice(1).some(r=>inRing(r,x,z)))||v.poly.some(r=>distance(r,x,z)<1.8)));
  }
  const starts=city.preview.labels.slice(0,3).map(({text,at})=>{
    const candidates=[];for(let dx=-80;dx<=80;dx+=2)for(let dz=-80;dz<=80;dz+=2)candidates.push([at[0]+dx,at[1]+dz,dx*dx+dz*dz]);
    candidates.sort((a,b)=>a[2]-b[2]);const q=candidates.find(([x,z])=>Math.abs(x)<340&&Math.abs(z)<165&&free(x,z));
    if(!q)throw Error(text+' 周辺に安全な開始地点がありません');return {label:text,at:[Math.round(q[0]*100)/100,0,Math.round(q[1]*100)/100]};
  });
  city.playBounds=[-350,350,-175,175];
  city.district.unifiedGround={color:'#8a8d85'};city.district.facadeScale=.5;
  city.spawns=[starts[1].at,starts[0].at,starts[2].at];
  return {name:'星路西街区 〜地形試走〜',size:[450,450],team:2,time:300,baseZ:400,baseLine:380,
    desc:'地形と進入範囲の確認用。基地・プラント・BOTなし。WASD移動、Shiftブースト、Spaceジャンプ、M全体マップ。黄色い枠が進入限界。',
    terrain:[],layout:[],plants:[],turrets:[],radar:[],catapults:[],basePods:[],plantPods:[],barricades:[],nav:[],
    walkOnly:true,asym:true,cityTerrain:city,walkStarts:starts,
    attribution:'国土交通省 Project PLATEAU・国土地理院の公開データを加工。提供者の皆様に感謝します。出典詳細は下の「素材の出典」'};
}
function build(output,source=path.join(ROOT,'prototype/index.html')){
  return inlineGame(output,source,buildDefinition(),ID);
}
function inlineGame(output,source,definition,id){
  let html=fs.readFileSync(source,'utf8');
  for(const [tag,file] of [['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js','vendor/three-r128/three.min.js'],['three.min.js','vendor/three-r128/three.min.js'],['sounds.js','prototype/sounds.js'],['music.js','prototype/music.js']]){
    html=html.replace(`<script src="${tag}"></script>`,()=>'<script>\n'+fs.readFileSync(path.join(ROOT,file),'utf8').replace(/<\/script/gi,'<\\/script')+'\n</script>');
  }
  const tag='<script src="maps.js"></script>';if(!html.includes(tag))throw Error('本体のマップ読込タグが見つかりません');
  html=html.replace(tag,()=>'<script>window.MAP_DATA='+JSON.stringify({[id]:definition})+';</script>');
  const credits=['mapdesign/hoshimichi_west/CREDITS.md','sounds/CREDITS.md','prototype/avatars/CREDITS.md'].map(file=>fs.readFileSync(path.join(ROOT,file),'utf8')).join('\n\n');
  const escape=text=>text.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const creditHtml=escape(credits).replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html=html.replace('<p class="note" id="mapAttribution"></p>',()=>'<p class="note" id="mapAttribution"></p><details class="note"><summary>素材の出典</summary><pre style="white-space:pre-wrap">'+creditHtml+'</pre></details>');
  // オフライン確認を可能にする。ゲームの描画・移動・入力処理は本体をそのまま使う。
  html=html.replace(/<link[^>]+href="https:\/\/fonts[^>]+>/g,'');
  html=html.replace('<title>','<!-- Three.js r128 MIT: '+fs.readFileSync(path.join(ROOT,'vendor/three-r128/LICENSE'),'utf8')+' -->\n<title>');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
  return {output,bytes:Buffer.byteLength(html),terrainBytes:id===ID?fs.statSync(path.join(ROOT,'mapdesign/hoshimichi_west/layout.json')).size:Buffer.byteLength(JSON.stringify(definition.cityTerrain)),playBounds:definition.cityTerrain.playBounds,starts:definition.walkStarts};
}
if(require.main===module){const output=path.resolve(process.argv[2]||'/tmp/hoshimichi-west-walk.html');console.log(JSON.stringify(build(output,process.argv[3]&&path.resolve(process.argv[3]))));}
module.exports={build,buildDefinition,inlineGame,ID};
