// この街区の地形と本体の対戦施設を接続する。機体の移動・射撃・索敵規則は本体を使う。
function createCityBattle(T,city,definition) {
  const radius=1.3,height=4,cache=new Map();
  function free(x,z,y,obstacles,r=radius) {
    if(Math.max(Math.abs(x),Math.abs(z))>city.half-r)return false;
    if(city.ceilingAt(x,z,y)<y+height-.05)return false;
    for(const v of city.nearby(x,z,r)){
      if(y>=v.top-.25 || y+height<=v.bottom+.001)continue;
      const c=city.contact(v,x,z);
      if(c.inside || c.distance2<r*r-.0001)return false;
    }
    for(const o of obstacles){
      if(y>=o.top-.25 || y+height<=(o.bottom??-Infinity)+.001)continue;
      const dx=x-Math.max(o.minX,Math.min(x,o.maxX)),dz=z-Math.max(o.minZ,Math.min(z,o.maxZ));
      if(dx*dx+dz*dz<r*r-.0001)return false;
    }
    return true;
  }
  function clearPath(ax,az,bx,bz,ay,obstacles,groundAt){
    const distance=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.ceil(distance/.5)),step=distance/n;
    let y=ay??city.terrainH(ax,az);
    for(let i=0;i<=n;i++){
      const x=ax+(bx-ax)*i/n,z=az+(bz-az)*i/n;
      const h=groundAt(x,z,y);
      // 落下だけで通れる岸壁を「帰って来られる経路」に数えない。
      if(Math.abs(h-y)>.45+step*1.1 || !free(x,z,h,obstacles))return {ok:false,y};
      y=h;
    }
    return {ok:true,y};
  }
  function pickSpawn(team,at,plants){
    const plant=plants.find(p=>p.id===at && p.owner===team);
    const slots=plant?definition.cityBattle.respawns[team][plant.id]:definition.cityBattle.baseSpawns[team];
    const p=slots[Math.floor(Math.random()*slots.length)];
    return [p[0],city.terrainH(...p),p[1]];
  }
  function safeGoal(u,goal,obstacles,nav){
    const y=goal.y===0?city.terrainH(goal.x,goal.z):goal.y;
    if(free(goal.x,goal.z,y,obstacles))return goal;
    // 本体の「基地から60m前」の待機点が街の建物に入る場合だけ近い街路へ移す。
    const key=[Math.round(goal.x),Math.round(goal.z),Math.round(y)].join(',');
    if(cache.has(key))return cache.get(key);
    let best=null,distance=Infinity;
    for(const p of nav.pts){
      const d=Math.hypot(p.x-goal.x,p.z-goal.z)+Math.abs(p.y-y)*3;
      if(d<distance && free(p.x,p.z,p.y,obstacles)){best=p;distance=d;}
    }
    const result=best?new T.Vector3(best.x,best.y,best.z):goal;
    cache.set(key,result);return result;
  }
  let navigationReport=null;
  function finishNav(nav,walkable){
    // 本体の施設・橋下面まで組み上げた後、往復可能な辺だけを採用する。
    const links=nav.links.filter(e=>{
      const a=nav.pts[e.a],b=nav.pts[e.b];
      return walkable(a.x,a.z,b.x,b.z,a.y)&&walkable(b.x,b.z,a.x,a.z,b.y);
    });
    const adj=nav.pts.map(()=>[]);
    links.forEach(e=>{adj[e.a].push(e.b);adj[e.b].push(e.a);});
    const seen=new Set(),groups=[];
    for(let i=0;i<adj.length;i++){
      if(seen.has(i))continue;
      const group=[],todo=[i];seen.add(i);
      while(todo.length){const a=todo.pop();group.push(a);for(const b of adj[a])if(!seen.has(b)){seen.add(b);todo.push(b);}}
      groups.push(group);
    }
    groups.sort((a,b)=>b.length-a.length);
    const keep=groups[0].sort((a,b)=>a-b),ids=new Map(keep.map((v,i)=>[v,i]));
    navigationReport={inputNodes:nav.pts.length,inputLinks:nav.links.length,rejectedLinks:nav.links.length-links.length,
      removedNodes:nav.pts.length-keep.length};
    nav.pts=keep.map(i=>nav.pts[i]);nav.n=keep.length;nav.flip=keep.map((_,i)=>i);
    nav.links=links.filter(e=>ids.has(e.a)&&ids.has(e.b)).map(e=>({...e,a:ids.get(e.a),b:ids.get(e.b)}));
    nav.adj=nav.pts.map(()=>[]);nav.links.forEach((e,i)=>{nav.adj[e.a].push([e.b,i]);nav.adj[e.b].push([e.a,i]);});
    cache.clear();
  }
  return {free,clearPath,pickSpawn,safeGoal,finishNav,get navigationReport(){return navigationReport;}};
}
