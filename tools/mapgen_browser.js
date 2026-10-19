// 検査にはゲーム本体の地形・当たり判定・移動を使う。別の移動モデルは作らない。
const path = require('node:path');
const {serialize} = require('./mapgen');
const ROOT = path.resolve(__dirname, '..');

async function openMap(browser, id, data, seed = 1, {silent=false} = {}) {
  const page = await browser.newPage({viewport:{width:800, height:500}});
  const errors = [];
  try {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error' && !/ERR_FAILED/.test(message.text())) errors.push(message.text());});
  await page.addInitScript(({seed,silent}) => {
    let state = seed >>> 0, now = 0;
    Math.random = () => {state = Math.imul(1664525, state) + 1013904223 >>> 0; return state / 4294967296;};
    performance.now = () => now;
    window.__advanceClock = () => now += 50;
    // 検査は明示的に1ステップずつ進める。物理と勝敗の処理は元の loop を使う。
    window.requestAnimationFrame = () => 0;
    // 音のピッチの乱数が実時間の再生制限・デコード待ちに左右されるため、対戦検証は無音。
    if(silent){window.AudioContext=undefined;window.webkitAudioContext=undefined;}
    window.__battleSilent=silent;
  }, {seed,silent});
  if (data) await page.route('**/maps.js', route => route.fulfill({contentType:'application/javascript; charset=utf-8', body:serialize(id, data)}));
  await page.route('**fonts.g*/**', route => route.fulfill({contentType:'text/css', body:''}));
  await page.goto('file://' + path.join(ROOT, 'dbg/dbg.html'));
  await page.waitForFunction(() => !!window.__g);
  if (!await page.evaluate(id => Object.hasOwn(__g.MAPS,id),id)) throw new Error(`マップ ${id} は存在しません`);
  if (!data) await page.evaluate(id => __g.selectMap(id), id);
  return {page, errors};
  } catch (error) {await page.close(); throw error;}
}

function candidateSites() {
  const g = __g, d = g.curMap, {west, east, pad} = d.generation;
  const points = [[0, 0], [0, 60], [0, -60], [east, 0], [east, 60], [east, -60], [west, pad], [west, -pad]];
  return points.flatMap(([x, z], key) => {
    const y = g.terrainH(x, z);
    const level = Array.from({length:16}, (_, i) => g.terrainH(x + 15 * Math.cos(i * Math.PI / 8), z + 15 * Math.sin(i * Math.PI / 8)));
    if (level.some(h => Math.abs(h - y) > 0.3)) return [];
    if (g.obstacles.some(o => o.bottom === undefined && x > o.minX - 17 && x < o.maxX + 17 && z > o.minZ - 17 && z < o.maxZ + 17 && o.top > y + 0.6)) return [];
    return [{key, x, z, y}];
  });
}

function navigation() {
  const g = __g, d = g.curMap, {west, east, deck} = d.generation;
  const nodes = [], seen = new Set();
  const add = (x, z, y = g.terrainH(x, z)) => {
    if (Math.abs(x) > d.size[0] - 4 || Math.abs(z) > d.size[1] - 4) return;
    const key = [x, z, y].map(n => n.toFixed(2)).join(',');
    if (seen.has(key)) return;
    if (g.obstacles.some(o => x > o.minX - 1.8 && x < o.maxX + 1.8 && z > o.minZ - 1.8 && z < o.maxZ + 1.8 && o.top > y + 0.6 && (o.bottom === undefined || o.bottom < y + 4.1))) return;
    seen.add(key); nodes.push([x, z, y]);
  };
  for (const x of [-125, west - 25, west, west + 25, -35, -8, 8, 35, east, 112]) {
    for (const z of [-190, -165, -125, -105, -80, -60, -35, 0, 35, 60, 80, 105, 125, 165, 190]) add(x, z);
  }
  for (const z of [-35, 0, 35]) add(west, z, deck);
  for (const p of g.jumpPads) {add(p.pos.x,p.pos.z,p.pos.y);add(p.exit.x,p.exit.z,p.exit.y);}
  for (const l of g.lifts) {add(l.from.x,l.from.z,l.from.y);add(l.to.x,l.to.z,l.to.y);}
  for (const pl of g.plants) for (const dx of [-6, 6]) add(pl.pos.x + dx, pl.pos.z + 3);
  for (const c of g.catapults) {add(c.land.x, c.land.z); add(c.pos.x + 6, c.pos.z);}
  const walk = (a, b) => {
    if(!g.clearPath(a[0],a[1],b[0],b[1],a[2]) || Math.abs(g.pathEndH-b[2])>=.8)return false;
    // physics は X/Z を別々に解く。斜め方向だけ緩い崖の側面を接続しない。
    const n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1]));
    for(let i=0;i<=n;i++){
      const x=a[0]+(b[0]-a[0])*i/Math.max(1,n),z=a[1]+(b[1]-a[1])*i/Math.max(1,n);
      if(Math.abs(g.terrainH(x+.5,z)-g.terrainH(x-.5,z))>.9 || Math.abs(g.terrainH(x,z+.5)-g.terrainH(x,z-.5))>.9)return false;
    }
    return true;
  };
  const links = [], adjacent = nodes.map(() => []);
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    const p = nodes[a], q = nodes[b], distance = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (distance < 2 || distance > 67 || !walk(p, q) || !walk(q, p)) continue;
    links.push([a, b]); adjacent[a].push(b); adjacent[b].push(a);
  }
  const near = ([x, z]) => nodes.reduce((best, p, i) => Math.hypot(p[0] - x, p[1] - z) < Math.hypot(nodes[best][0] - x, nodes[best][1] - z) ? i : best, 0);
  if (!nodes.length) throw new Error('通り道の候補がありません');
  const reached = new Set([near([8, d.baseZ - 20])]), queue = [...reached];
  while (queue.length) for (const b of adjacent[queue.pop()]) if (!reached.has(b)) {reached.add(b); queue.push(b);}
  const targets = [...g.plants.map(p => [p.pos.x + 4, p.pos.z + 3]), [8, -d.baseZ + 20], [west, 0]];
  for (const [x, z] of targets) {
    const y = g.terrainH(x, z);
    if (![...reached].some(i => walk(nodes[i], [x, z, y]) && walk([x, z, y], nodes[i]))) throw new Error(`目標 (${x},${z}) が通り道から孤立しています`);
  }
  const remap = new Map([...reached].sort((a, b) => a - b).map((i, k) => [i, k]));
  const nav = {nodes:[...remap.keys()].map(i => nodes[i]), links:links.filter(([a,b]) => reached.has(a) && reached.has(b)).map(([a,b]) => [remap.get(a),remap.get(b)])};
  g.curMap.nav = nav; g.buildNav(nav);
  return {nav, candidates:nodes.length, retained:nav.nodes.length, links:nav.links.length};
}

// 上段と下段を別々に通り、両ベース間・各プラントへの接続を実際の physics で確かめる。
function driveRoutes() {
  const g = __g, d = g.curMap, N = g.NAV;
  const near = (x, z, y) => N.pts.reduce((best, p, i) => Math.hypot(p.x-x,p.z-z)+Math.abs(p.y-y)*4 < Math.hypot(N.pts[best].x-x,N.pts[best].z-z)+Math.abs(N.pts[best].y-y)*4 ? i : best, 0);
  const baseB = near(8,190,0), baseR = near(8,-190,0), upper = near(d.generation.west,0,d.generation.deck), lower = near(d.generation.west,0,0);
  const routes = [['青から橙ベース',baseB,baseR], ['橙から青ベース',baseR,baseB],
    ['青から高架',baseB,upper], ['高架から青',upper,baseB], ['橙から高架',baseR,upper], ['高架から橙',upper,baseR],
    ['青から高架下',baseB,lower], ['高架下から橙',lower,baseR]];
  for (const p of g.plants) {
    const node=near(p.pos.x+6,p.pos.z+3,p.pos.y);
    routes.push(['青からプラント'+p.id,baseB,node],['橙からプラント'+p.id,baseR,node]);
  }
  const results = [];
  for (const [cls,chassis] of [['assault','light'],['heavy','heavy']]) {
    const u = g.player;
    u.mech = {head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};
    g.equip(u,cls);
    u.navW = N.links.map(() => 1);
    for (const [name,start,end] of routes) {
      const route = g.navPath(u,start,end);
      if (!route) throw new Error(`${name}: 経路がありません`);
      const first = N.pts[start];
      u.pos.set(first.x,first.y,first.z); u.vel.set(0,0,0);
      Object.assign(u,{alive:true,onGround:true,flying:false,repairing:false,planted:false,stun:'',dashT:0,longDash:false,charging:false,overheat:false,ctrlLockT:0,boost:u.maxBoost});
      let ticks = 0;
      for (const i of route.slice(1)) {
        const target = N.pts[i];
        let reached = false;
        const limit = Math.ceil(2 * Math.hypot(target.x-u.pos.x,target.z-u.pos.z) / Math.max(1,u.walkV) / 0.05) + 100;
        for (let n = 0; n < limit; n++) {
          const delta = new g.T.Vector3(target.x-u.pos.x,0,target.z-u.pos.z);
          if (delta.length() < 1.4 && Math.abs(u.pos.y-target.y)<1.2) {reached=true; break;}
          g.physics(u,delta.normalize(),false,false,0.05); ticks++;
        }
        if (!reached) throw new Error(`${cls}/${name}: (${target.x},${target.z},${target.y}) に到達できません。現在 (${u.pos.x.toFixed(1)},${u.pos.z.toFixed(1)},${u.pos.y.toFixed(1)})`);
      }
      results.push({class:cls,chassis,walkSpeed:u.walkV,route:name,waypoints:route.length,seconds:Math.round(ticks*5)/100,arrived:true});
    }
  }
  return results;
}

// 配置した全設備を、両軍・軽量機/重量機で実際に乗り降りする。
// 目標の切替は本体の Bot と同じ関数、移動は同じ physics。座標の瞬間移動で合格させない。
function driveMobility() {
  const g=__g,T=g.T,dt=.05,results=[];
  for(const v of g.units){v.frozen=true;v.pos.set(140,0,220-v.idx*8);}
  const facilities=[...g.jumpPads.map((f,i)=>({kind:'pad',index:i,f,from:f.pos,to:f.exit})),
    ...g.lifts.map((f,i)=>({kind:'lift',index:i,f,from:f.from,to:f.to}))];
  for(const [cls,chassis] of [['assault','light'],['heavy','heavy']]) for(const team of ['B','R']) for(const item of facilities){
    g.resetMobility();
    const u=g.units.find(v=>v.team===team),{from,to,kind,f,index}=item;
    u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};g.equip(u,cls);
    const away=from.clone().sub(to).setY(0).normalize();
    const start=from.clone().addScaledVector(away,8);
    const goal=kind==='pad'?to.clone():to.clone().addScaledVector(away,-8);
    u.pos.copy(start);u.vel.set(0,0,0);
    Object.assign(u,{alive:true,onGround:true,flying:false,repairing:false,healing:false,transfer:null,planted:false,stun:'',catCd:0,jumpPad:null,lift:null,mobilityRoute:null,dashT:0,longDash:false,charging:false,overheat:false,ctrlLockT:0,boost:u.maxBoost});
    let used=false,arrived=false,peak=0,ticks=0;
    for(;ticks<1000;ticks++){
      g.liftUpdate(dt);g.jumpPadUpdate(dt);
      const target=g.botMobilityGoal(u,goal),wish=new T.Vector3(target.x-u.pos.x,0,target.z-u.pos.z);
      if(wish.length()>.5)wish.normalize();else wish.set(0,0,0);
      used ||= kind==='pad'?u.jumpPad===f:u.lift===f;
      g.physics(u,wish,false,false,dt);peak=Math.max(peak,u.pos.y);
      if(used && u.onGround && Math.abs(u.pos.y-goal.y)<.3 && Math.hypot(u.pos.x-goal.x,u.pos.z-goal.z)<1.5 && !u.lift){arrived=true;break;}
    }
    if(!arrived)throw new Error(`${team}/${cls}/${kind}${index}: 昇降経路を走破できません (${u.pos.toArray()}) used=${used}`);
    results.push({team,class:cls,chassis,kind,index,used,arrived,seconds:Number((ticks*dt).toFixed(2)),peak,landing:u.pos.toArray()});
    u.pos.set(140,0,220-u.idx*8);
  }
  g.resetMobility();
  return results;
}

module.exports = {openMap, candidateSites, navigation, driveRoutes, driveMobility};
