// 工業港の生成テーマ。地形と配置の乱数を分離し、既存本体の施設・物理を使う。
const {random,selectDiverse}=require('./mapgen');

function geometry(seed){
  const rng=random(seed),deck=12+Math.floor(rng()*2),west=-38,lookout=72;
  const terrain=[],layout=[],bridges=[];
  for(const sign of [1,-1]){
    // 自陣前のポッド。ベース側の入口だけを残し、三方を土手で遮る。
    terrain.push({type:'block',x:0,z:sign*231,hx:18,hz:3,h:5,slope:2.5});
    for(const x of [-21,21])terrain.push({type:'block',x,z:sign*241,hx:3,hz:10,h:5,slope:2.5});
    terrain.push({type:'trench',x:0,z0:sign*237,z1:sign*248,w:12,slope:3,h:-2});
    // 高架の両端。中間は橋の板なので地上を横断できる。
    terrain.push({type:'block',x:west,z:sign*145,hx:10,hz:10,h:deck,slope:2.5});
    terrain.push({type:'ramp',x0:west-9,x1:west+9,z0:sign*155,z1:sign*202,h:deck});
    // 展望台には時間のかかる徒歩の代替も残す。
    terrain.push({type:'ramp',x0:lookout-24,x1:lookout+24,z0:sign*18,z1:sign*65,h:22});
  }
  bridges.push([west,0,20,270,deck,1.5]);
  terrain.push({type:'block',x:lookout,z:0,hx:16,hz:18,h:22,slope:2.5});
  // 陸側の高い境界と海側の護岸。装飾水面に落水ダメージは想定しない。
  terrain.push({type:'block',x:-166,z:0,hx:18,hz:200,h:12,slope:5});
  terrain.push({type:'trench',x:164,z0:-195,z1:180,w:18,slope:8,h:-6});
  layout.push([138,-8,4,390,5]);
  // 大きな倉庫が地上の直線視界を切り、両端の接続で進路を曲げる。
  layout.push([-109,65,24,64,14],[-110,-95,28,70,11],[-94,165,34,40,12]);
  layout.push([34,164,22,28,11],[34,-164,22,28,12],[-8,6,26,42,13]);
  // 開口のある荷扱い倉庫：側壁＋通れる屋内＋上に乗れる屋根。
  for(const [x,z] of [[52,95],[52,-95]]){
    bridges.push([x,z,34,48,10,1]);
    for(const side of [-1,1])for(const end of [-1,1])layout.push([x+side*17,z+end*18,2,12,9]);
    const sign=Math.sign(z);
    terrain.push({type:'ramp',x0:x-8,x1:x+8,z0:sign*119,z1:sign*170,h:10});
  }
  // 高架の橋脚。上下それぞれの通行幅を残す。
  for(const z of [-105,-30,45,115])for(const x of [west-8,west+8])layout.push([x,z,2,3,deck-1.5]);
  // 補給中の機体へ中央から直線射撃が通らないようにする。乗降口と両端の迂回を空ける。
  layout.push([-70,28,18,4,5],[-31,-38,18,4,5]);
  // 小さな資材は円・乗降口・再出撃帯を避ける。海側は断続的な遮蔽。
  for(const [x,z,w,d,h] of [[104,148,15,18,5],[110,35,12,18,6],[112,-35,12,18,6],
    [104,-148,15,18,5],[-115,-8,14,20,5],[-105,116,16,12,5],[10,65,10,10,5],[-4,-62,10,10,5]])layout.push([x,z,w,d,h]);
  const sites=[
    {key:0,x:-72,z:85,role:'south'},{key:1,x:-74,z:105,role:'south'},
    {key:2,x:8,z:-85,role:'north'},{key:3,x:-72,z:-85,role:'north'},
    {key:4,x:-72,z:0,role:'middle'},{key:5,x:30,z:0,role:'middle'},
    {key:6,x:lookout,z:0,role:'middle'},
  ];
  const navPoints=[];
  for(const x of [-130,-110,-82,-65,-38,-15,8,30,52,72,100,122])
    for(const z of [-300,-267,-235,-210,-185,-155,-125,-95,-65,-35,0,35,65,95,125,155,185,210,235,267,300])navPoints.push([x,z]);
  for(const z of [-145,-120,-90,-60,-15,15,60,90,120,145])navPoints.push([west,z,deck]);
  for(const z of [-100,-60,-18,0,18,60,100])navPoints.push([lookout,z]);
  for(const z of [-110,-80,80,110])navPoints.push([52,z,10]);
  return {
    order:7,name:'潮路搬送区',subtitle:'生成中',asym:true,size:[185,355],team:10,time:600,baseZ:320,baseLine:275,
    desc:'屈曲する工業港。中央の争奪と後方補給を支え、高架上下・倉庫・沿岸を切り替えて進む。展望台はリフト、倉庫屋根はジャンプパッドで利用できる。',
    terrain,layout,bridges,plants:[['A',0,210,'B'],['Z',0,-210,'R']],
    turrets:[[-46,282],[-22,282],[22,282],[46,282]],radar:[-55,335],
    catapults:[[-85,302,-95,212],[-57,295,-70,205],[57,295,70,205],[85,302,110,212]],
    basePods:[[-22,310],[22,310]],plantPods:[['A',0,243],['Z',0,-243]],barricades:[],
    water:[[164,-8,19,195,-5.5]],
    jumpPads:[{at:[24,95,0],exit:[43,95,10],rise:30},{at:[24,-95,0],exit:[43,-95,10],rise:30}],
    lifts:[{from:[104,0,0],to:[92,0,22],size:[8,8],speed:4,wait:2},
      {from:[-69,45,0],to:[-52,45,deck],size:[8,8],speed:5,wait:2},
      {from:[-7,-45,0],to:[-24,-45,deck],size:[8,8],speed:5,wait:2}],
    paved:[[-145,145,-267,267]],
    generation:{version:1,theme:'tidal',seed,west,east:lookout,deck,pad:145,sites,navPoints,
      routeProbes:[['青から橙ベース',[8,267,0],[8,-267,0]],['橙から青ベース',[8,-267,0],[8,267,0]],
        ['青から高架',[8,267,0],[west,15,deck]],['橙から高架',[8,-267,0],[west,-15,deck]],
        ['高架の縦断',[west,120,deck],[west,-120,deck]],['高架下の横断',[-65,0,0],[30,0,0]],
        ['青から沿岸',[8,267,0],[122,0,0]],['沿岸から橙',[122,0,0],[8,-267,0]],
        ['倉庫内部の通過',[30,95,0],[52,95,0]],['倉庫屋根の通過',[52,110,10],[52,80,10]],
        ['青から展望台',[8,267,0],[lookout,0,22]],['橙から展望台',[8,-267,0],[lookout,0,22]]],
      balance:'勝率未確定'},
  };
}

function placements(sites,seed,count=64){
  const rng=random(seed),groups=Object.fromEntries(['south','north','middle'].map(role=>[role,sites.filter(p=>p.role===role)]));
  if(Object.values(groups).some(g=>!g.length))return [];
  const choices=[],seen=new Set(),pick=xs=>xs[Math.floor(rng()*xs.length)];
  for(let attempt=0;attempt<count;attempt++){
    const south=pick(groups.south),north=pick(groups.north),middle=[pick(groups.middle)];
    if(rng()>.5){const second=pick(groups.middle);if(Math.hypot(second.x-middle[0].x,second.z-middle[0].z)>45)middle.push(second);}
    const selected=[south,...middle.sort((a,b)=>a.x-b.x),north],signature=selected.map(p=>p.key).join(',');
    if(seen.has(signature))continue;
    seen.add(signature);
    const plants=[[0,210,'B'],...selected.map(p=>[p.x,p.z,null]),[0,-210,'R']].map(([x,z,owner],i)=>[String.fromCharCode(65+i),x,z,owner]);
    const elevated=middle.filter(p=>p.y>5).length,spread=Math.max(...middle.map(p=>p.x))-Math.min(...middle.map(p=>p.x));
    const name=middle.length>1?'複路争奪':elevated?'上層干渉':'屈折前線';
    choices.push({name,plants,plantPods:[['A',0,243],['B',-70,62],[plants.at(-2)[0],-31,-58],[plants.at(-1)[0],0,-243]],signature,
      metrics:{plants:plants.length,elevated,spread,offCenter:selected.filter(p=>Math.abs(p.x)>40).length}});
  }
  return choices;
}

// 主配置は地上中央＋東西で異なる前線支点。残りは戦い方の差で選ぶ。
function select(proposals,count){
  const first=proposals.find(p=>p.plants.length===5&&p.plants[2][1]===-72&&p.plants.at(-2)[1]===8);
  if(!first)return [];
  const high=proposals.filter(p=>p.name==='上層干渉'),multiple=proposals.filter(p=>p.name==='複路争奪');
  const chosen=[first,...selectDiverse(high,1),...selectDiverse(multiple,1)];
  if(count>3)chosen.push(...selectDiverse(proposals.filter(p=>!chosen.includes(p)),count-3));
  return chosen.slice(0,count);
}
module.exports={geometry,placements,select};
