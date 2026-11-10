// node tools/test/online_local_fire.test.js
// 製品game.jsの先出し/イベント受信/終了処理と本体gunTickをVMで実行する。
// 炎・音・射撃の末端は計数する代役。WebGL描画、聴感、RTCの操作感は検査しない。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),file=path.join(__dirname,'online_prediction.test.js');
const gamePath=path.join(root,'prototype/online/game.js'),rawGame=fs.readFileSync(gamePath,'utf8'),html=fs.readFileSync(path.join(root,'prototype/index.html'),'utf8');
const end='\n{\n  const h=harness();reconcile';
let fixture=fs.readFileSync(file,'utf8');assert(fixture.indexOf(end)>0);fixture=fixture.slice(0,fixture.indexOf(end));
fixture=fixture.replace('vm.createContext(c);',`c.__fx={flash:[],sound:[]};
  c.mainMuzzleFlash=(u,left,w)=>c.__fx.flash.push({unit:u.entityId,left,key:w.key});
  c.sfx=(name,at,u)=>c.__fx.sound.push({name,unit:u?.entityId});
  vm.createContext(c);`);
fixture=fixture.replace('getPrediction:()=>prediction,','predictLocalFire,localFireWeapon,localFireCovers,playEvents,getLocalFire:()=>localFire,getPrediction:()=>prediction,');
const context={require:createRequire(file),console,setTimeout,clearTimeout};vm.createContext(context);
vm.runInContext(fixture+'\nthis.api={harness};',context,{filename:file});
let eventId=0,checks=0;const details={};
function check(name,fn){fn();checks++;console.log('発砲先出しVM: '+name);}
function harness(w={},slot={}){
  const h=context.api.harness(),u=h.units[0];
  u.weapon='main';u.switchT=0;u.reloadMul=1;u.slots.main={w:{key:'testgun',type:'gun',sfx:'testshot',rpm:600,mag:30,reload:2,...w},ammo:30,reserve:60,reloadT:0,cd:0,held:false,...slot};
  h.c.WEAPONS[u.slots.main.w.key]=u.slots.main.w;
  h.fx=h.c.__fx;h.fire=(trigger=true,dt=.016,input={})=>h.test.predictLocalFire({trigger,keys:{},pressed:{},...input},dt);
  h.events=(n=1,patch={})=>{const d={unit:u.entityId,name:u.slots[u.weapon].w.sfx,at:[0,0,0],lifeId:u.lifeId,weapon:u.slots[u.weapon].w.key,...patch};
    const events=[];for(let i=0;i<n;i++)events.push({id:++eventId,type:'shot',data:{seq:i+1,...d}},{id:++eventId,type:'sfx',data:{...d}});h.test.playEvents(events);return events;};
  h.count=()=>({flash:h.fx.flash.length,sound:h.fx.sound.length});return h;
}
check('引き金のコマに炎と音だけ出し、弾数・HP・位置・得点・発射/命中処理を変えない',()=>{
  const h=harness(),before=JSON.stringify(h.units);let forbidden=0;
  for(const name of ['shot','fire','damage','shoot','hitMark'])h.c[name]=()=>forbidden++;
  h.fire();assert.deepEqual(h.count(),{flash:1,sound:1});assert.equal(JSON.stringify(h.units),before);assert.equal(forbidden,0);
});
check('初期の確定CD中は先出しせず、CD終了後に出す',()=>{
  const h=harness({}, {cd:.12});h.fire(true,.05);h.fire(true,.05);assert.equal(h.fx.sound.length,0);h.fire(true,.021);assert.equal(h.fx.sound.length,1);
});
check('セミはCD中の押下を消費せず、成功時だけheldを立てて押し直しを待つ',()=>{
  const h=harness({semi:true},{cd:.08});h.fire(true,.04);assert.equal(h.fx.sound.length,0);h.fire(true,.041);assert.equal(h.fx.sound.length,1);
  for(let i=0;i<20;i++)h.fire(true,.05);assert.equal(h.fx.sound.length,1);h.fire(false);h.fire(true);assert.equal(h.fx.sound.length,2);
});
check('セミはリロード中の最初の押下を消費しない',()=>{
  const h=harness({semi:true},{reloadT:.5});h.fire();assert.equal(h.fx.sound.length,0);h.units[0].slots.main.reloadT=0;h.fire();assert.equal(h.fx.sound.length,1);
});
check('本体gunTickと先出しのsemi/CD/autoの回数が同じ可変dtで一致',()=>{
  const source=html.slice(html.indexOf('function gunTick('),html.indexOf('function shot('));assert(source.includes('sl.held = true'));
  for(const semi of [false,true]){
    const h=harness({semi},{cd:.08}),u=h.units[0],sl=JSON.parse(JSON.stringify(u.slots.main));let host=0;
    Object.assign(h.c,{isHumanControlled:()=>true,reveal:()=>{},shot:()=>{host++;return false;}});vm.runInContext(source,h.c);
    const intervals=[.011,.029,.007,.023],rows=[];
    for(let i=0;i<120;i++){const dt=intervals[i%4],trigger=i%30<25;h.c.gunTick(u,sl,dt,trigger,null,0);h.fire(trigger,dt);rows.push([host,h.fx.sound.length]);}
    assert(rows.every(([a,b])=>a===b));details[semi?'semiParity':'autoParity']={shots:host,frames:rows.length};
  }
});
for(const [name,patch]of [['死亡',{alive:false}],['行動不能',{downT:1}],['よろけ',{stun:'stagger'}],['ダウン',{stun:'down'}],['感電',{electricT:1}],['修理ポッド',{repairing:true}],['エリア移動',{transfer:{t:1}}],['持替え待ち',{switchT:1}]])check(name+'では先出ししない',()=>{
  const h=harness();Object.assign(h.units[0],patch);h.fire();assert.deepEqual(h.count(),{flash:0,sound:0});
});
for(const [name,slot]of [['リロード',{reloadT:1}],['弾切れ',{ammo:0}],['過熱',{overheat:true}]])check(name+'では先出ししない',()=>{
  const h=harness({},slot);h.fire();assert.deepEqual(h.count(),{flash:0,sound:0});
});
for(const [name,patch]of [['着地',{stun:'land'}],['妨害shock',{shockT:1}],['ジップライン',{zip:{}}]])check(name+'は本体の銃と同様に射撃可能',()=>{
  const h=harness();Object.assign(h.units[0],patch);h.fire();assert.deepEqual(h.count(),{flash:1,sound:1});
});
for(const [name,input]of [['リロード入力',{keys:{KeyR:true}}],['数字キー',{pressed:{Digit2:true}}],['ホイール',{wheel:1}],['武器選択',{weapon:'sub'}],['エリア移動入力',{pressed:{KeyH:true}}]])check(name+'と同じコマに古い銃を先出ししない',()=>{
  const h=harness();h.fire(true,.016,input);assert.deepEqual(h.count(),{flash:0,sound:0});
});
for(const [name,w]of [['飛翔弾',{proj:{}}],['チャージ',{chargeTime:1}],['回転銃',{spin:1}],['ミサイル',{missile:{}}],['三点射',{burst:3}],['偵察機',{drone:'test'}],['スタン範囲',{stunField:{}}],['銃以外',{type:'sword'}]])check(name+'は先出しせずhost演出を通す',()=>{
  const h=harness(w);h.fire();assert.deepEqual(h.count(),{flash:0,sound:0});h.events();assert.deepEqual(h.count(),{flash:1,sound:1});
});
check('二丁銃は左右の炎と1回の音を先出しする',()=>{
  const h=harness({dual:true});h.fire();assert.deepEqual(Array.from(h.fx.flash,x=>x.left),[false,true]);assert.equal(h.fx.sound.length,1);h.events();assert.equal(h.fx.sound.length,1);assert.equal(h.fx.flash.length,2);
});
check('低FPSの複数発も各1回出し、semiは1回に制限する',()=>{
  const h=harness({rpm:3000});h.fire(true,.05);assert.deepEqual(h.count(),{flash:3,sound:3});assert.equal(h.test.getLocalFire().shots,3);
  const semi=harness({rpm:3000,semi:true});semi.fire(true,.05);assert.deepEqual(semi.count(),{flash:1,sound:1});
});
check('先出し1回は炎/音を各1回だけ消費し、host側だけの後続4回を消さない',()=>{
  const h=harness();h.fire();h.at(100);h.events(5);assert.deepEqual(h.count(),{flash:5,sound:5});
});
check('先出し済みイベントの再配信は既存event IDで重複除外する',()=>{
  const h=harness();h.fire();const events=h.events();h.test.playEvents(events);assert.deepEqual(h.count(),{flash:1,sound:1});
});
check('他機・別名の音・metadataの無い旧イベントを抑止しない',()=>{
  const h=harness();h.fire();h.units[1].weapon='main';h.units[1].slots.main=h.units[0].slots.main;
  h.events(1,{unit:'R:0'});h.events(1,{weapon:'another'});h.events(1,{lifeId:999});h.events(1,{lifeId:undefined,weapon:undefined});
  assert.deepEqual(h.count(),{flash:5,sound:5});
  h.test.playEvents([{id:++eventId,type:'sfx',data:{unit:'B:0',name:'reload',lifeId:1,weapon:'testgun'}}]);assert.equal(h.fx.sound.length,6);
});
for(const [name,change]of [['命',h=>h.units[0].lifeId++],['同slotの武器',h=>h.units[0].slots.main.w={...h.units[0].slots.main.w,key:'replacement'}],['slot',h=>{h.units[0].slots.sub={...h.units[0].slots.main};h.units[0].weapon='sub';}],['再試合',h=>h.game.state.matchId='next'],['死亡',h=>h.units[0].alive=false],['機体',h=>h.c.player={...h.units[0]}]])check(name+'の変更直後、次frame前の確定演出を旧履歴で抑えない',()=>{
  const h=harness();h.fire();change(h);h.events();assert.deepEqual(h.count(),{flash:2,sound:2});
});
check('終了/退出/再試合で同life/slotの古い先出しを捨てる',()=>{
  for(const reset of [h=>h.test.clearPrediction(),h=>h.game.leave(),h=>h.test.reset()]){
    const h=harness();h.fire();reset(h);h.game.state.role='guest';h.game.state.phase='playing';h.game.state.localUnitId='B:0';h.events();assert.deepEqual(h.count(),{flash:2,sound:2});
  }
});
check('host/offline/開始前/終了後はローカル先出ししない',()=>{
  for(const [role,phase]of [['host','playing'],['offline','idle'],['guest','countdown'],['guest','ended']]){const h=harness();h.game.state.role=role;h.game.state.phase=phase;h.fire();assert.equal(h.fx.sound.length,0);}
});
check('hostのshot/sfxがlifeIdと実武器keyを付ける（加算フィールド、射撃IDではない）',()=>{
  const h=harness(),u=h.units[0];h.game.state.role='host';h.c.shot(u,u.slots.main,null,0);h.c.sfx('testshot',u.pos,u);
  for(const type of ['shot','sfx']){const e=h.game.state.events.find(e=>e.type===type);assert(e);assert.equal(e.data.lifeId,u.lifeId);assert.equal(e.data.weapon,'testgun');}
});
check('未消費キューは64件以下、古い効果は破棄する',()=>{
  const h=harness({rpm:60000});for(let i=0;i<100;i++)h.fire(true,.05);assert(h.test.getLocalFire().pending.length<=64);h.at(501);h.events();assert.equal(h.fx.sound.length,401);
});
check('限界: 500ms超は同じ発砲でも重なる（厳密IDなし）',()=>{
  const h=harness();h.fire();h.at(501);h.events();assert.deepEqual(h.count(),{flash:2,sound:2});details.lateAuthoritative={afterMs:501,effects:h.count()};
});
check('限界: 窓内の別発砲は同一life/武器なら1回分を誤照合し得る',()=>{
  const h=harness();h.fire();h.at(100);h.events(1,{seq:999});assert.deepEqual(h.count(),{flash:1,sound:1});details.timeWindowIsNotShotIdentity=true;
});
check('限界: 写真未更新の残弾1でも見た目だけ続く。実弾数は変えない',()=>{
  const h=harness({}, {ammo:1});for(let i=0;i<20;i++){h.at(i*50);h.fire(true,.05);}assert(h.fx.sound.length>1);assert.equal(h.units[0].slots.main.ammo,1);details.unconfirmedAmmo={authoritativeAmmo:1,cosmeticShots:h.fx.sound.length};
});
const sources=['prototype/online/game.js','prototype/index.html','tools/test/online_prediction.test.js','tools/test/online_local_fire.test.js'];
console.log(JSON.stringify({scope:'実関数VM・炎/音末端は代役・実browser/RTC/聴感は未実行',checks,details,sourceHashes:Object.fromEntries(sources.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]))}));
