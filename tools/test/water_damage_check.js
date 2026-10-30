// node tools/test/water_damage_check.js <dbg directory> <result.json>
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.fulfill({body:''}));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await page.goto('file://'+path.resolve(process.argv[2],'dbg.html'));
  const result=await page.evaluate(()=>{
   const g=__g;g.selectMap('dock');g.setup();g.running=false;
   const checks=[],u=g.player,bot=g.units.find(v=>!v.isPlayer),ok=(name,pass)=>checks.push({name,pass:!!pass});
   const oldWater=g.waters.slice(),oldObs=g.obstacles.slice();g.waters.splice(0,g.waters.length,[-100,-100,100,100,30]);g.obstacles.length=0;
   function reset(v=u){Object.assign(v,{alive:true,hp:v.maxHp,invulT:0,downT:0,stun:'',stunT:0,repairing:false,transfer:null,planted:false,flying:false,catMomentum:null,catLaunch:null,ctrlLockT:0,lungeT:0,dashT:0,longDash:false,swing:null,zip:null,electricT:0,jumpBuf:0,onGround:false});v.pos.set(0,29,0);v.vel.set(0,0,0);return v;}
   function tick(v,seconds,hz){for(let i=0;i<seconds*hz;i++)g.waterDamageTick(v,1/hz);}
   for(const hz of [30,60,120])for(const v of [u,bot]){
    reset(v);tick(v,1,hz);ok('1秒で最大HP10% '+hz+'/'+v.isPlayer,Math.abs(v.hp/v.maxHp-.9)<1e-8);
    v.hp=v.maxHp*.5;tick(v,1,hz);ok('残HPではなく最大HP基準 '+hz+'/'+v.isPlayer,Math.abs(v.hp/v.maxHp-.4)<1e-8);
   }
   reset();u.armorAvg=.1;u.barrierOn=true;tick(u,1,60);ok('装甲/バリアで軽減しない',Math.abs(u.hp/u.maxHp-.9)<1e-8);u.barrierOn=false;
   reset();u.invulT=2;tick(u,1,60);ok('既存無敵は維持',u.hp===u.maxHp);
   reset();tick(u,.5,60);const hp=u.hp;u.pos.x=150;tick(u,1,60);ok('退水で停止',u.hp===hp);u.pos.x=0;tick(u,.5,60);ok('再入水で再開',Math.abs(u.hp/u.maxHp-.9)<1e-8);
   for(const y of [30,35,60]){reset();u.pos.y=y;tick(u,1,60);ok('水面/橋上/空中 '+y,u.hp===u.maxHp);}
   reset();u.mech={...g.MECH_DEFAULT,legs:'anchor'};g.equip(u,'heavy');u.hp=u.maxHp;u.pos.set(0,31,0);u.invulT=0;
   for(let i=0;i<180;i++){g.physics(u,new g.T.Vector3(1,0,0),false,false,1/60);g.waterDamageTick(u,1/60);}
   ok('ホバーは水面に浮き移動できる',Math.abs(u.pos.y-30)<.01&&u.pos.x>1&&g.hoverOnWater(u));ok('ホバー水上で無傷',u.hp===u.maxHp);
   reset();tick(u,10,60);ok('10秒で大破・再出撃待機',!u.alive&&u.hp===0&&u.downT===0&&u.respawnT===5&&u.deathWeapon==='浸水');const deaths=u.sc.deaths;tick(u,1,60);ok('大破を重複処理しない',u.sc.deaths===deaths);
   g.waters.splice(0,g.waters.length,...oldWater);g.obstacles.splice(0,g.obstacles.length,...oldObs);
   g.selectMap('river_castle');g.setup();g.running=false;const v=g.player,river=g.cityMap.river;
   let pt=null;for(const poly of river.rings){const ring=poly[0];for(let i=1;i<ring.length;i++){const x=(ring[i-1][0]+ring[i][0])/2,z=(ring[i-1][1]+ring[i][1])/2;for(const dx of [-1,1])if(Number.isFinite(g.waterHeightAt(x+dx,z))){pt=[x+dx,z];break;}if(pt)break;}if(pt)break;}
   ok('実河川ポリゴンの水面を取得',pt!==null);
   if(pt){v.invulT=0;v.pos.set(pt[0],river.water-1,pt[1]);const hp=v.hp;g.waterDamageTick(v,1);ok('実河川でも10%ダメージ',Math.abs(hp-v.hp-v.maxHp*.1)<1e-7);}
   return checks;
  });
  fs.writeFileSync(process.argv[3],JSON.stringify({checks:result,errors},null,2));console.log(JSON.stringify({checks:result.length,failed:result.filter(x=>!x.pass),errors}));assert(!errors.length&&result.every(x=>x.pass));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
