// 工業港の生成テーマ。地形と配置の乱数を分離し、既存本体の施設・物理を使う。
const {random,selectDiverse}=require('./mapgen');

function geometry(seed,config={}){
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
  const data={
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
  if(['tidal2','tidal3','tidal4','tidal5','tidal6'].includes(config.revision)){
    for(const sign of [1,-1]){
      for(const [x,z,w,d,h] of [[0,278,48,6,10],[-82,278,68,6,10],[82,278,68,6,10],
        [-115,290.5,6,31,10],[-115,337.5,6,27,10],[115,290.5,6,31,10],[115,337.5,6,27,10],[0,350,236,6,10],
        [-114,278,10,12,14],[114,278,10,12,14],[0,278,30,10,13],
        [-82,332,24,26,12],[82,332,24,26,12],[-55,306,24,7,5],[55,306,24,7,5],[0,301,52,5,5]]){
        const building=Math.abs(x)===82&&z===332;
        const skin=sign>0?(building?(x<0?'office':'barracks'):'baseWall'):(building?'prefab':'hesco');
        const center=x===0&&z===301;
        if(sign<0&&building){
          // 野戦側は大きな常設棟を写さず、小さな仮設棟を分散する。
          data.layout.push([-x,-(x<0?327:330),22,16,8,'prefab'],[-x,-344,18,8,5,x<0?'prefab':'trailer']);
          continue;
        }
        const stagger=sign<0&&z===306?(x<0?310:307):z;
        data.layout.push([x*sign,(sign<0&&center?299:stagger)*sign,sign<0&&center?44:w,sign<0&&!building?(center?6:Math.max(d,8)):d,sign<0?(building?8:center?6:Math.min(h,8)):h,skin]);
      }
      if(sign>0)data.layout.push([-48,342,14,8,6,'container'],[46,337,12,10,5,'trailer']);
      else data.layout.push([48,-342,14,8,6,'container'],[-46,-337,14,10,5,'prefab']);
      for(const x of [-36,36])data.bridges.push([x*sign,278*sign,24,8,16.5,3]);
      for(const x of [-115,115])data.bridges.push([x*sign,315*sign,8,18,16.5,3]);
      // 右側の荷役屋根へは遠い坂とパッド。側門の地上通路とは高さを分ける。
      data.terrain.push({type:'ramp',x0:120*sign,x1:132*sign,z0:269*sign,z1:225*sign,h:10});
      if(sign<0){const f=data.terrain.at(-1);[f.x0,f.x1]=[f.x1,f.x0];}
      data.terrain.push({type:'block',x:126*sign,z:269*sign,hx:6,hz:4,h:10,slope:2.5});
      data.bridges.push([126*sign,301*sign,14,66,10,1.5],[107*sign,332*sign,40,12,10,1.5]);
      data.jumpPads.push({at:[148*sign,332*sign,0],exit:[128*sign,332*sign,10],rise:34});
      // 門の外側・内側から内部通路までを別々に接続する。
      for(const x of [-90,-60,-42,-36,-30,-12,12,30,36,42,60,90])for(const z of [267,286,300,316,338])data.generation.navPoints.push([x*sign,z*sign]);
      for(const [x,z] of [[12,308],[-36,292],[36,318]])data.generation.navPoints.push([x*sign,z*sign]);
      for(const x of [-36,36]){
        data.generation.routeProbes.push([`${sign>0?'青':'橙'}の${x<0?'左':'右'}門からコア前`,[x*sign,267*sign,0],[12*sign,308*sign,0]],
          [`${sign>0?'青':'橙'}コア前から${x<0?'左':'右'}門`,[12*sign,308*sign,0],[x*sign,267*sign,0]]);
      }
      for(const x of [-136,-96,96,136])data.generation.navPoints.push([x*sign,315*sign]);
      for(const z of [225,245,268])data.generation.navPoints.push([126*sign,z*sign]);
      for(const z of [280,305,326])data.generation.navPoints.push([126*sign,z*sign,10]);
      for(const x of [108,126])data.generation.navPoints.push([x*sign,332*sign,10]);
      for(const x of [-1,1])data.generation.routeProbes.push([`${sign>0?'青':'橙'}基地の${x<0?'左':'右'}搬入口`,[136*x*sign,315*sign,0],[96*x*sign,315*sign,0]]);
      data.generation.routeProbes.push([`${sign>0?'青':'橙'}基地の荷役屋根`,[126*sign,225*sign,0],[108*sign,332*sign,10]]);
    }
    data.turrets=[[-36,267],[36,267],[-54,299],[54,299]];
    data.baseDefense={posts:[[-36,292],[36,318]],gates:[[-36,278],[36,278]],yard:[0,312,224,72],gateDepth:8,leash:100,responseRadius:360,reinforcements:2};
    data.generation.version=2;
    data.desc+=' ベースは防壁と左右の門で囲み、門内の守備隊が侵入へ対応する。';
  }
  if(['tidal3','tidal4','tidal5','tidal6'].includes(config.revision))extend(data,1.6);
  if(['tidal4','tidal5','tidal6'].includes(config.revision))districts(data);
  if(['tidal5','tidal6'].includes(config.revision))mountain(data);
  if(config.revision==='tidal6')diagonalFrontline(data);
  return data;
}

// ステージを縦に拡張する。機体・ジャンプ高・再出撃距離は実寸のまま。
function extend(d,scale){
  d.size[1]*=scale;d.baseZ*=scale;d.baseLine*=scale;
  const offset=210*(scale-1),point=p=>[p[0],p[1]*scale,...p.slice(2)];
  for(const f of d.terrain){
    const pocket=f.type==='block'&&((f.x===0&&Math.abs(f.z)===231)||(Math.abs(f.x)===21&&Math.abs(f.z)===241))||f.type==='trench'&&f.x===0&&Math.abs(f.z0)===237;
    if(pocket){if(f.z!==undefined)f.z+=Math.sign(f.z)*offset;else{f.z0+=Math.sign(f.z0)*offset;f.z1+=Math.sign(f.z1)*offset;}continue;}
    if(f.z!==undefined)f.z*=scale;if(f.z0!==undefined){f.z0*=scale;f.z1*=scale;}if(f.hz!==undefined)f.hz*=scale;
  }
  d.layout=d.layout.map(b=>(b[0]===-70&&b[1]===28||b[0]===-31&&b[1]===-38)?b:[b[0],b[1]*scale,b[2],b[3]*scale,...b.slice(4)]);
  d.bridges=d.bridges.map(b=>[b[0],b[1]*scale,b[2],b[3]*scale,...b.slice(4)]);
  // 1m格子へ焼く坂の端と、橋の板を重ねる。小数座標の隙間を残さない。
  for(const b of d.bridges)if(b[0]===52&&b[4]===10)b[3]+=4;
  for(const sign of [1,-1])d.generation.navPoints.push([52,sign*121,10]);
  for(const key of ['turrets','basePods'])d[key]=d[key].map(point);
  d.radar=point(d.radar);d.plants=d.plants.map(p=>[p[0],p[1],p[2]*scale,p[3]]);
  d.plantPods=d.plantPods.map(p=>[p[0],p[1],Math.abs(p[2])===243?p[2]+Math.sign(p[2])*offset:p[2]*scale]);
  d.catapults=d.catapults.map(c=>[c[0],c[1]*scale,c[2],c[3]*scale,...c.slice(4)]);
  d.water=d.water.map(w=>[w[0],w[1]*scale,w[2],w[3]*scale,w[4]]);
  for(const p of d.jumpPads){p.at=point(p.at);p.exit=point(p.exit);}
  for(const l of d.lifts){l.from=point(l.from);l.to=point(l.to);}
  d.paved=d.paved.map(p=>[p[0],p[1],p[2]*scale,p[3]*scale]);
  const g=d.generation;g.sites=g.sites.map(p=>({...p,z:p.z*scale,lengthScale:scale}));g.navPoints=g.navPoints.map(point);
  g.routeProbes=g.routeProbes.map(([name,from,to])=>[name,point(from),point(to)]);g.pad*=scale;g.version=3;g.lengthScale=scale;
  for(const s of [1,-1])for(const z of [369,380,390])g.navPoints.push([0,z*s]);
  const cfg=d.baseDefense;cfg.posts=cfg.posts.map(point);cfg.gates=cfg.gates.map(point);cfg.yard=[0,cfg.yard[1]*scale,cfg.yard[2],cfg.yard[3]*scale];cfg.gateDepth*=scale;
  Object.assign(cfg,{leash:150,alertRadius:340,responseRadius:600});
  d.botRepairRange=160;
  const flank=[[122,190,0],[122,70,0],[122,-70,0],[122,-210,0],[36,-258,0],[36,-288,0]].map(point);
  const direct=[[-65,190,0],[-65,70,0],[-65,-70,0],[-65,-185,0],[-36,-288,0]].map(point);
  const covert=[...flank.slice(0,3),[132,-315*scale,0],[96,-315*scale,0],[52,-315*scale,0]];
  const roof=[[-134,190,0],[-134,70,0],[-134,-70,0],[-148,-332,0],[-108,-332,10],[-106,-306,0]].map(point);
  for(const z of [-304,-112,112,304])g.navPoints.push([-134,z]);
  d.raidRoutes=['rush','covert','radar','sprint'].map(kind=>{
    const points=kind==='rush'?direct:kind==='radar'?flank.slice(0,-1):kind==='sprint'?roof:covert;
    return {kind,points,pointsR:points.map(p=>[kind==='rush'?p[0]:p[0]===122?-134:-p[0],-p[1],p[2]]),objective:kind==='radar'?'radar':'core'};
  });
  d.desc='縦に伸びる工業港。正面突破と沿岸潜行を使い分け、索敵・帰還迎撃・レーダー破壊の機会を争う。基地は防壁と左右の門で守る。';
}

// 街区の実寸は拡大後に配置する。中央の出撃帯・補給点と台の着地は空ける。
function districts(d){
  const g=d.generation;
  const roof=(x,z,w,depth,h,skin)=>{
    d.layout.push([x,z,w,depth,h-.2,skin]);
    d.bridges.push([x,z,w,depth,h,.2]);
  };
  // 青：3棟の工場を東側の屋根でつなぎ、西側にも作業棟と橋下の路地を作る。
  for(const b of [[82,294,52,36,10],[88,374,44,32,10],[88,417,44,28,10],[-95,383,48,32,12],[-91,425,42,20,12]])roof(...b,'container');
  d.layout.push([99,299,4,4,18,'baseWall'],[-82,383,4,4,20,'baseWall'],
    [100,294,8,6,13,'baseWall'],[78,377,10,6,13,'baseWall'],[100,417,8,6,13,'baseWall'],
    [-125,313,12,16,5,'container'],[121,307,12,20,5,'container'],
    [0,310,28,10,6,'office'],[0,411,28,14,6,'office']);
  d.bridges.push([88,335,12,54,10,1.5],[88,397,12,22,10,1.5],[118,434,30,16,10,1.5],
    [-94,407,12,26,12,1.5],[-123,380,28,6,12,1.5],[78,281,12,18,10,1.5]);
  d.terrain.push({type:'ramp',x0:72,x1:84,z0:270,z1:244,h:10},
    {type:'block',x:78,z:273,hx:6,hz:3,h:10,slope:2.5},
    {type:'ramp',x0:-140,x1:-128,z0:375,z1:344,h:12},
    {type:'block',x:-134,z:378,hx:6,hz:3,h:12,slope:2.5});
  d.jumpPads.push({at:[51,294,0],exit:[59,294,10],rise:26},
    {at:[-124,390,0],exit:[-116,390,12],rise:32});
  // 橙：低層住宅の路地と庭壁。2棟の共同住宅には物理的に歩ける陸屋根。
  for(const [x,z,w,depth,h] of [[82,296,30,24,6],[118,300,22,24,5],
    [107,371,18,24,5],[109,420,18,22,5],
    [-82,302,28,26,6],[-121,300,22,24,5],[-80,371,30,26,6],
    [-121,384,22,24,5],[-78,421,30,22,6],[-122,420,22,18,5]])d.layout.push([-x,-z,w,depth,h,'house']);
  for(const [x,z,w,depth] of [[78,371,28,24],[76,420,30,22]])roof(-x,-z,w,depth,10,'office');
  for(const [x,z,w,depth] of [[-107,348,18,3],[95,340,16,3],[-52,391,3,20],[50,410,3,20]])d.layout.push([-x,-z,w,depth,2.8,'wall']);
  d.layout.push([0,-310,26,10,4.8,'house'],[0,-411,24,14,4.8,'house']);
  d.bridges.push([-78,-396,10,34,10,1.5],[-108,-434,48,16,10,1.5],[-78,-364,12,18,10,1.5]);
  d.terrain.push({type:'ramp',x0:-84,x1:-72,z0:-353,z1:-320,h:10},
    {type:'block',x:-78,z:-356,hx:6,hz:3,h:10,slope:2.5});
  d.jumpPads.push({at:[-59,-370,0],exit:[-67,-370,10],rise:26});
  d.paved.push([-151,145,244,438],[-145,145,-438,-275]);

  for(const sign of [1,-1])for(const x of [-140,-134,-127,-103,-95,-63,-42,30,42,51,62,88,95,108,126,136])
    for(const z of [260,280,294,312,326,340,350,374,397,407,420,432])g.navPoints.push([x*sign,z*sign]);
  for(const p of [[78,244],[78,260],[78,270,10],[78,281,10],[62,294,10],[88,294,10],[88,335,10],[88,374,10],[88,397,10],[88,417,10],[100,428,10],[118,434,10],
    [-134,344],[-134,360],[-134,375,12],[-123,380,12],[-95,383,12],[-94,407,12],[-91,425,12],
    [-78,-320],[-78,-340],[-78,-353,10],[-78,-364,10],[-78,-371,10],[-78,-396,10],[-76,-420,10],[-90,-428,10],[-108,-434,10],
    [-42,400],[-42,460],[42,-400],[42,-460],[-63,350],[-63,407],[-127,407],
    [103,-326],[121,-350],[103,-402],[103,-432],[136,-432]])g.navPoints.push(p);
  g.routeProbes.push(
    ['工場街：正面から青ゲート',[-42,400,0],[-42,460,0]],
    ['住宅地：正面から橙ゲート',[42,-400,0],[42,-460,0]],
    ['工場街：内側の地上路',[-63,350,0],[-63,407,0]],
    ['工場街：連絡橋下の横路',[-63,407,0],[-127,407,0]],
    ['住宅地：庭壁の迂回',[103,-326,0],[121,-350,0]],
    ['住宅地：住宅間の路地',[121,-350,0],[103,-402,0]],
    ['住宅地：路地から基地前',[103,-402,0],[103,-432,0]],
    ['工場街：東の坂から屋根',[78,244,0],[62,294,10]],
    ['工場街：屋根の連絡橋',[62,294,10],[88,374,10]],
    ['工場街：屋根から荷役通路',[88,374,10],[108,531.2,10]],
    ['工場街：西の坂と作業棟',[-134,344,0],[-95,383,12]],
    ['工場街：西の屋根の縦断',[-95,383,12],[-91,425,12]],
    ['住宅地：坂から共同住宅',[-78,-320,0],[-78,-371,10]],
    ['住宅地：共同住宅から荷役通路',[-78,-371,10],[-108,-531.2,10]]);
  // 潜行は街区の隙間、屋根役は新しい高所から既存の基地内通路へつなぐ。
  for(const route of d.raidRoutes)for(const p of route.points)if(p[0]===122&&p[1]===304)p[1]=336;
  const covert=d.raidRoutes[1],sprint=d.raidRoutes[3];
  covert.points=[...covert.points.slice(0,3),[103,-326,0],[121,-350,0],[103,-402,0],[103,-432,0],[136,-432,0],[136,-504,0],[96,-504,0],[52,-504,0]];
  covert.pointsR=[...covert.pointsR.slice(0,3),[-63,350,0],[-63,407,0],[-127,407,0],[-136,432,0],[-136,504,0],[-96,504,0],[-52,504,0]];
  sprint.points=[[-134,304,0],[-134,112,0],[-134,-112,0],[-42,-330,0],[-78,-371,10],[-76,-420,10],[-90,-428,10],[-126,-434,10],[-126,-480,10],[-126,-515,10],[-108,-531.2,10],[-106,-489.6,0]];
  sprint.pointsR=[[-134,-326,0],[122,-112,0],[122,112,0],[42,290,0],[62,294,10],[88,335,10],[88,374,10],[88,417,10],[100,428,10],[126,434,10],[126,480,10],[126,515,10],[108,531.2,10],[106,489.6,0]];
  g.version=4;
  g.districts=[{name:'工場街',team:'B',bounds:[-151,145,244,438],roofHeights:[10,12]},
    {name:'住宅地',team:'R',bounds:[-145,145,-438,-275],roofHeights:[10]}];
  d.desc='青基地前は工場街、橙拠点前は住宅地。工場の隙間・連絡橋下・住宅の路地・屋根を使って接近し、正面ゲートの強行突破や側面侵入を選ぶ。';
}

// 橙基地の陸側だけに尾根を置き、側壁を越えて内側の斜面へつなぐ。
function mountain(d){
  const g=d.generation;
  for(const z of [-410,-434,-458,-480])d.terrain.push({type:'mesa',x:-164,z,r:10,slope:25,h:14,keepBaseHeight:true});
  // 射出台・プレハブの基礎を持ち上げないよう、内側は壁沿いの細い下り坂にする。
  d.terrain.push({type:'block',x:-100,z:-480,hx:4,hz:6,h:10,slope:2.5,keepBaseHeight:true},
    {type:'ramp',x0:-104,x1:-96,z0:-486,z1:-518,h:10,keepBaseHeight:true});
  // 山腹から側壁の上を通る短い足場。下のHESCO・既存の荷役屋根は保持する。
  d.bridges.push([-124.5,-480,49,8,10,1.5]);
  d.paved.push([-185,-128,-520,-370],[-108,-94,-522,-471]);
  for(const z of [-350,-370,-382,-394,-400,-410,-422,-434,-446,-458,-470,-480])g.navPoints.push([-164,z]);
  for(const p of [[-148,-480],[-140,-480,10],[-126,-480,10],[-110,-480,10],[-100,-480,10],[-100,-486,10],[-100,-496],[-100,-506],[-100,-518],[-108,-518],[-108,-506],[-70,-506]])g.navPoints.push(p);
  g.routeProbes.push(
    ['橙側の山：徒歩で尾根へ',[-164,-350,0],[-164,-410,14]],
    ['橙側の山：基地横の尾根',[-164,-410,14],[-164,-480,14]],
    ['橙側の山：防壁越え',[-164,-480,14],[-100,-480,10]],
    ['橙側の山：内側の下り',[-100,-480,10],[-100,-518,0]],
    ['橙側の山：コア脇まで',[-100,-518,0],[-12,-492.8,0]]);
  d.raidRoutes[1].points=[[-134,304,0],[-134,112,0],[-134,-112,0],[-164,-350,0],
    [-164,-400,14],[-164,-434,14],[-164,-458,14],[-164,-480,14],[-140,-480,10],[-110,-480,10],[-100,-480,10],[-100,-518,0],[-108,-518,0],[-108,-506,0],[-70,-506,0],[-52,-504,0]];
  d.raidRoutes[1].pointRadius={B:4}; // 狭い横断の手前で角を省略せず、山と足場を実際に通る。
  g.version=5;g.mountain={team:'R',side:'陸側',summit:14,wall:8,crossing:[-115,-480,10],landing:[-100,-480,10]};
  d.desc+=' 橙基地の陸側には14mの尾根。山腹から側壁を越え、基地内の斜面へ下る侵入路がある。';
}

// 中央高架を斜め1本にし、B–C間の地上・橋上・展望台の射線を分ける。
function diagonalFrontline(d){
  const g=d.generation,oldWest=g.west,oldDeck=g.deck,deck=22,slope=-228/384;
  const bridgeX=z=>-18+slope*z;
  d.bridges=d.bridges.filter(b=>!(b[0]===oldWest&&b[1]===0&&b[3]===432));
  d.terrain=d.terrain.filter(f=>!(f.type==='block'&&f.x===oldWest&&Math.abs(f.z)===232)
    &&!(f.type==='ramp'&&f.x0===oldWest-9&&Math.abs(f.z0)===248));
  d.layout=d.layout.filter(b=>!(b[2]===2&&b[4]===oldDeck-1.5&&[oldWest-8,oldWest+8].includes(b[0])));
  g.navPoints=g.navPoints.filter(p=>!(p[0]===oldWest&&p[2]===oldDeck));
  // 同じ絶対高さの床を2mごとに重ねる。見た目と当たり判定を同じ矩形群にする。
  // 倉庫14mの上にも、厚さ1.5m＋機体4mを差し引いて6.5mを確保する。
  const width=20*Math.hypot(1,slope)+Math.abs(slope)*2;
  for(let z=-191;z<192;z+=2)d.bridges.push([bridgeX(z),z,width,2.0002,deck,1.5]);
  for(const sign of [1,-1]){
    const x=bridgeX(sign*192);
    d.terrain.push({type:'block',x,z:sign*200,hx:width/2,hz:10,h:deck,slope:2.5},
      {type:'ramp',x0:x-10,x1:x+10,z0:sign*210,z1:sign*280,h:deck});
    d.bridges.push([x,sign*194,width,4.0002,deck,1.5]);
    for(const z of [192,205,215,235,255,275,285])g.navPoints.push([x,sign*z]);
  }
  // 旧海側の資材は新しい橙側スロープから中央側へ移す。
  const cargo=d.layout.find(b=>b[0]===104&&Math.abs(b[1]+236.8)<.01);cargo[0]=-5;
  // 橋の中央直下にも地上の横断を残し、中央倉庫を橙側へずらす。
  d.layout.find(b=>b[0]===-8&&b[4]===13)[1]=-50;
  for(const [x,z] of [[-121,160],[-105,160],[85,-160],[12,-64],[28,-64]])d.layout.push([x,z,2,4,deck-1.5,'baseWall']);
  for(const z of [-192,-168,-144,-120,-96,-72,-48,-24,0,24,48,60,70,96,108,120,132,156,168,180,192])g.navPoints.push([bridgeX(z),z,deck]);
  for(const offset of [-8,8])for(const z of [70,76,90,96])g.navPoints.push([bridgeX(z)+offset,z,deck]);
  // 上端は橋の脇で止める。下から床板へ頭をぶつけず、上がってから横へ降りる。
  const landing=width/2+4;
  d.lifts[1]={from:[-102,48,0],to:[bridgeX(48)-landing,48,deck],size:[8,8],speed:5,wait:2};
  d.lifts[2]={from:[40,-48,0],to:[bridgeX(-48)+landing,-48,deck],size:[8,8],speed:5,wait:2};
  d.layout.push([-68,107,24,4,16,'baseWall'],[bridgeX(73),73,6,8,30,'baseWall'],[5,81,20,12,16,'container']);
  g.routeProbes=g.routeProbes.filter(([name])=>!['青から高架','橙から高架','高架の縦断'].includes(name));
  g.routeProbes.push(['青から斜め高架',[8,427.2,0],[bridgeX(120),120,deck]],
    ['橙から斜め高架',[8,-427.2,0],[bridgeX(-120),-120,deck]],
    ['斜め高架の縦断',[bridgeX(168),168,deck],[bridgeX(-168),-168,deck]]);
  g.west=bridgeX(0);g.deck=deck;g.version=6;
  g.diagonalBridge={from:[-132,192,deck],to:[96,-192,deck],width:20,segment:2,thickness:1.5};
  g.frontlineCover={ground:[-68,107,24,4,16],upper:[bridgeX(73),73,6,8,30],cargo:[5,81,20,12,16]};
  d.desc+=' 中央は左手前から右奥へ斜めに渡る22m高架。B–C間は地上防壁・橋上塔・積み荷で射線を折り、両脇を通れる。';
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
    const scale=groups.south[0].lengthScale||1;
    const plants=[[0,210*scale,'B'],...selected.map(p=>[p.x,p.z,null]),[0,-210*scale,'R']].map(([x,z,owner],i)=>[String.fromCharCode(65+i),x,z,owner]);
    const elevated=middle.filter(p=>p.y>5).length,spread=Math.max(...middle.map(p=>p.x))-Math.min(...middle.map(p=>p.x));
    const name=middle.length>1?'複路争奪':elevated?'上層干渉':'屈折前線';
    choices.push({name,plants,plantPods:[['A',0,210*scale+33],['B',-70,62*scale],[plants.at(-2)[0],-31,-58*scale],[plants.at(-1)[0],0,-210*scale-33]],signature,
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
// 局所修正で全域の起伏抽選が変わらないよう、山の追加前の条件から同じ起伏を作る。
function roughGeometry(seed,config){return ['tidal5','tidal6'].includes(config.revision)?geometry(seed,{...config,revision:'tidal4'}):null;}
module.exports={geometry,placements,select,roughGeometry};
