// WebGL/ネットワークなし。製品game.jsを最小worldへ読み、回帰した公開境界を決定的に検査。
const fs=require('node:fs'),vm=require('node:vm');
const T=require('../../vendor/three-r128/three.min.js');
function makeHarness({withoutVisibility=false}={}){
  let time=1000;const noop=()=>{},make=(id,team,x,z=0)=>({entityId:id,kind:'unit',team,alive:true,lifeId:1,onlineMotionEpoch:0,onlineLagEpoch:0,
    pos:new T.Vector3(x,200,z),vel:new T.Vector3(),yaw:0,pitch:0,weapon:'main',slots:{main:{w:{key:'rifle',type:'gun'}}},sc:{kills:0}});
  const viewer=make('B:0','B',0),owner=make('R:0','R',50),c={T,CBOnlineCodec:require('../../prototype/online/codec'),
    MAPS:{mesa:{name:'台地',team:5,time:300}},Map,Set,Date,Math,Number,console,setTimeout,clearTimeout,performance:{now:()=>time},window:{},
    SLOTS:['main'],WEAPONS:{},CLASSES:{assault:{main:'rifle'},heavy:{main:'rifle'}},units:[viewer,owner],player:viewer,hittables:[],gadgets:[],shells:[],radars:[],mirages:[],drones:[],barrages:[],heatFields:[],stunFields:[],
    spotted:{B:new Map(),R:new Map()},noticed:(e,d)=>!e.cloak||d<8+e.vis*e.vis*80,canSee:()=>true,targetPoint:u=>u.pos.clone().add(new T.Vector3(0,2.4,0)),
    addEventListener:noop,weaponLook:noop,tracer:noop,boom:noop,impact:noop,sfx:noop,finish:noop,shoot:noop,blast:noop,damage:noop,shot:noop,castFrom:()=>null,
    RAID_SENTRY_SCALE:3.96,SENTRY_SCALE:3.96,SENTRY_TIP:new T.Vector3(0,1,0),UP:new T.Vector3(0,1,0),heldMirage:()=>null};
  if(!withoutVisibility)c.CBOnlineVisibility=require('../../prototype/online/visibility');
  c.fire=(u,aim,spread,w,from)=>c.tracer(from,aim,u.team,false,w);
  const index=fs.readFileSync(require.resolve('../../prototype/index.html'),'utf8'),start=index.indexOf('function sentryTick(g, dt) {'),end=index.indexOf('\nfunction launchDrone',start);
  vm.createContext(c);vm.runInContext(index.slice(start,end),c);
  let source=fs.readFileSync(require.resolve('../../prototype/online/game'),'utf8');
  source=source.replace('  window.CBOnlineGame=',`  window.__boundary={fixedUnitForPeer,gadgetPolicyForLoadouts,gadgetCapacityForLoadouts,gadgetSlotsForPeer,createPeerView,snapshotForPeer,encodePeerSnapshot,replicationFor,rememberPeerSnapshot,verifiedPeerUnitTimes,eventsForPeer};\n  window.CBOnlineGame=`);
  vm.runInContext(source,c);
  const game=c.window.CBOnlineGame,h=c.window.__boundary,peer={id:'guest',unitId:viewer.entityId};viewer.ownerPeerId=peer.id;viewer.controller='remoteHuman';
  const sent=[];Object.assign(game.state,{role:'host',phase:'playing',matchId:'fixture-match',transport:{clock:()=>({rttMs:50,offsetMs:0}),dropPendingSnapshots:(id,{details=false}={})=>details?{count:0,baselines:0}:0/* 本物のtransportと同じ形。未送信の写真は無い（詳細を返さないと本体は安全側で毎回完全基準にする） */,send:(type,payload,id)=>{sent.push({type,payload,id});return true;},links:new Map([[peer.id,{approved:true,ready:true}]])}});game.state.peers.set(peer.id,peer);
  const full=()=>({frame:1,time:900,timeLeft:300,cores:{B:100,R:100},plants:[],radars:[],shells:[],spotted:{B:[],R:[]},spotSrc:{B:[],R:[]},acks:{'B:0':1},inputAcks:{'B:0':{seq:1}},
    units:c.units.map((u,i)=>({id:u.entityId,team:u.team,name:'機体'+i,idx:0,cls:'assault',controller:i?'bot':'remoteHuman',pos:u.pos.toArray(),vel:u.vel.toArray(),yaw:0,pitch:0,hp:100,alive:true,lifeId:1,sc:{kills:0},slots:{main:{key:'rifle',ammo:30}}}))});
  return {c,game,h,peer,viewer,owner,full,sent,at:t=>time=t};
}
function productionBoundaryChecks(){
  const checks=[],observations=[],raw=[];
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
  const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const test=(v,name,data)=>{checks.push({value:!!v,name});if(!v)observations.push({name,data});};
  const run=(name,fn)=>{try{fn();}catch(e){test(false,name,{error:e.stack||e.message});}};
  run('固定unitのnested中立化と通常差分',()=>{
    const x=makeHarness(),d=new x.c.CBOnlineCodec.Decoder(),id=x.owner.entityId;
    x.owner.pos.set(555,200,0);x.owner.cloak=true;x.owner.vis=.01;x.c.spotted.B.set(x.owner,5);
    const first=x.h.encodePeerSnapshot(x.peer,x.full(),true);test(d.seed(first.baseline),'固定unitの初期基準を復元');
    const hidden=first.snapshot.units.find(u=>u.id===id),neutral=v=>v===null||v===0||v===''||Array.isArray(v)&&v.every(neutral)||v&&typeof v==='object'&&Object.values(v).every(neutral);
    test(hidden.fixedUnit&&hidden.hidden&&Object.entries(hidden).every(([k,v])=>['id','fixedUnit','hidden','visibilityEpoch'].includes(k)||(['jumpPadIndex','zipLine'].includes(k)?v===-1:neutral(v))),'hidden unitの全nested状態を独立の中立値条件で検査');
    const changed=x.full(),v=changed.units.find(u=>u.id===id);Object.assign(v,{pos:[73137,31991,82719],vel:[77,88,99],yaw:2.4,pitch:.6,hp:1,alive:false,lifeId:91,boost:17,cloak:false,vis:1,
      motionEpoch:9,lagEpoch:7,renderCrouch:.93,cls:'heavy',mech:{head:'秘密機体',body:'秘密胴'},predictionBlocked:'launch',
      motionVectors:{dashDir:[1,2,3],boostVisualDir:[4,5,6],catMomentum:[7,8,9],lungeDir:[10,11,12]},catLaunch:{t:3,from:[123,456,789]},
      swing:{t:3,phi:2,tilt:.2,dashAttack:true},transfer:{t:4,base:'R',at:[111,222,333]},jumpPadIndex:8,zipLine:9});
    Object.assign(v.slots.main,{key:'秘密武器',ammo:7,reserve:999,heat:.93,reloadT:2,bn:3,held:true});changed.frame=2;changed.time=950;
    const altered=x.h.encodePeerSnapshot(x.peer,changed),scrub=altered.snapshot.units.find(u=>u.id===id);
    test(JSON.stringify(hidden)===JSON.stringify(scrub),'秘匿位置/姿勢/速度/行動/装備を変えてもhidden slot全文が同一');test(!altered.baseline,'秘匿中の全nested状態変更で基準を増やさない');
    const restored=d.decode(altered.wire.delta).units.find(u=>u.id===id);test(equal(restored,scrub),'hidden中立値をbase差分の復号後も維持');
    let baselines=0,epoch=hidden.visibilityEpoch;
    for(let n=0;n<25;n++){x.owner.cloak=n%2===0?false:true;const full=x.full();full.frame=3+n;full.time=1000+n*50;const e=x.h.encodePeerSnapshot(x.peer,full);baselines+=!!e.baseline;
      if(e.baseline)d.seed(e.baseline);const decoded=d.decode(e.wire.delta),u=decoded.units.find(u=>u.id===id);
      test(decoded.units.length===2&&decoded.units.map(u=>u.id).join(',')===first.snapshot.units.map(u=>u.id).join(','),'見え隠れ中も全unit枠の長さ・順番を維持');
      if(u.hidden)test(u.pos.every(n=>n===0)&&u.vel.every(n=>n===0),'旧基準に可視位置があってもhidden差分で位置速度を0へ');
      else {test(u.visibilityEpoch>epoch,'revealごとにepoch更新');epoch=u.visibilityEpoch;}
    }
    test(baselines===0,'25回のvisibility変更を追加基準0回で復元');raw.push({case:'fixed-unit',hidden,scrub,alteredWire:altered.wire,churnBaselines:baselines});
  });
  run('初回hidden基準からreveal後の遠方省略',()=>{
    const x=makeHarness(),id=x.owner.entityId,packets=[];x.owner.pos.set(250,200,0);x.owner.cloak=true;x.owner.vis=.01;x.c.spotted.B.set(x.owner,5);
    const first=x.h.encodePeerSnapshot(x.peer,x.full(),true),index=first.snapshot.units.findIndex(u=>u.id===id),base=first.baseline;
    test(first.snapshot.units[index].hidden&&!!base,'遠方省略回帰の初回基準にhidden=trueを収録');
    x.owner.cloak=false;const reveal=x.h.encodePeerSnapshot(x.peer,{...x.full(),frame:2,time:950}),epoch=reveal.snapshot.units[index].visibilityEpoch;
    const decode=e=>{const d=new x.c.CBOnlineCodec.Decoder();if(!d.seed(base))throw Error('初回hidden基準のseed失敗');return d.decode(e.wire.delta);};
    const visible=decode(reveal);test(!reveal.baseline&&!visible.units[index].hidden&&epoch>first.snapshot.units[index].visibilityEpoch,'reveal差分を初回hidden基準だけから独立復号');
    let held=0;
    for(let n=0;n<6;n++){
      x.owner.pos.x+=1;const e=x.h.encodePeerSnapshot(x.peer,{...x.full(),frame:3+n,time:1000+n*50}),decoded=decode(e),v=decoded.units[index];
      if(!(decoded.unitUpdates&(1<<index))){held++;test(!v.hidden&&v.fixedUnit&&v.id===id&&v.visibilityEpoch===epoch,'遠方の更新bit0でもhidden/epochを初回基準の値へ戻さない');}
      test(!e.baseline&&e.wire.delta[1]===reveal.wire.delta[1],'reveal後の保持frameも共通初回基準の独立差分');packets.push({wire:e.wire,decoded});
    }
    test(held>=3,'更新bit0の遠方保持frameを実際に3回以上通す');raw.push({case:'hidden-base-reveal-hold',baseline:base,initial:first.wire,reveal:reveal.wire,packets,held});
  });
  run('設置物の固定枠・hidden/empty同値・overflow',()=>{
    const x=makeHarness(),h=x.h,r=h.replicationFor(x.peer);
    test(h.gadgetCapacityForLoadouts([{main:'rifle'},{main:'gatling'}])===0&&h.gadgetSlotsForPeer(x.peer).length===0,'設置装備を含まない正式範囲は0枠');
    const spec={kind:'mine',max:2,model:'fixture-mine'},loadouts=[{sub:'fixtureMine'}];x.c.WEAPONS.fixtureMine={proj:spec};r.gadgetPolicy=h.gadgetPolicyForLoadouts(loadouts);
    const capacity=h.gadgetCapacityForLoadouts(loadouts),empty=h.gadgetSlotsForPeer(x.peer),d=new x.c.CBOnlineCodec.Decoder();
    test(capacity===4&&empty.length===4&&empty.every(s=>JSON.stringify(s)==='[1]'),'有限許可loadoutの最大数×機数だけ固定枠を確保');
    const make=(team,position,source=spec)=>({gadget:true,kind:'mine',team,owner:x.owner,pos:new T.Vector3(...position),mesh:new T.Object3D(),alive:true,hp:100,maxHp:200,spec:source});
    const secret=make('R',[777,200,0]);x.c.gadgets.push(secret);
    test(JSON.stringify(h.gadgetSlotsForPeer(x.peer))===JSON.stringify(empty),'未発見設置物の存在をemptyと区別できない');
    const first=h.encodePeerSnapshot(x.peer,x.full(),true);d.seed(first.baseline);const schema=JSON.stringify(r.encoder.currentBase().s);
    secret.pos.set(20,200,0);const visible=h.encodePeerSnapshot(x.peer,{...x.full(),frame:2,time:950}),v=visible.snapshot.gadgets.find(s=>s[0]===0);
    test(!visible.baseline&&v?.[2]==='mine'&&v[5][0]===20,'gadget公開は同じschemaの通常差分');
    secret.pos.set(777,200,0);secret.hp=1;secret.mesh.rotation.y=2;const hidden=h.encodePeerSnapshot(x.peer,{...x.full(),frame:3,time:1000});
    test(!hidden.baseline&&JSON.stringify(d.decode(hidden.wire.delta).gadgets)===JSON.stringify(empty),'可視gadgetの旧値をhidden差分で[1]へ置換');
    secret.pos.set(20,200,0);const reveal=h.encodePeerSnapshot(x.peer,{...x.full(),frame:4,time:1050}),newId=reveal.snapshot.gadgets.find(s=>s[0]===0)?.[1];
    test(!reveal.baseline&&newId>v[1],'gadget再可視化は新revealIDだけで基準不要');
    const foreign=make('B',[10,200,0],{kind:'mine',max:99});x.c.gadgets.push(foreign);
    for(let n=0;n<capacity+1;n++)x.c.gadgets.push(make('B',[n,200,0]));
    const overflow=h.encodePeerSnapshot(x.peer,{...x.full(),frame:5,time:1100});
    test(overflow.snapshot.gadgets.length===capacity&&overflow.snapshot.gadgets.every(s=>s[0]===0),'上限超過でも固定枠数を増やさない');
    test(r.gadgetOmitted===3&&!Object.hasOwn(overflow.snapshot,'gadgetOmitted'),'許可外1＋容量超過2はローカル診断だけに残す');
    test(!overflow.baseline&&JSON.stringify(r.encoder.currentBase().s)===schema,'gadgetの空/秘匿/公開/overflowでschemaを維持');
    raw.push({case:'fixed-gadgets',capacity,empty,visible:visible.snapshot.gadgets,hidden:hidden.snapshot.gadgets,reveal:reveal.snapshot.gadgets,overflow:overflow.snapshot.gadgets,omitted:r.gadgetOmitted});
  });
  run('同frame・同base異delta callback',()=>{
    const x=makeHarness(),r=x.h.replicationFor(x.peer),a=x.h.encodePeerSnapshot(x.peer,x.full(),true),full=x.full();full.units[0].hp=99;const b=x.h.encodePeerSnapshot(x.peer,full,true);
    test(a.wire.frame===b.wire.frame&&a.wire.delta[1]===b.wire.delta[1]&&JSON.stringify(a.wire.delta)!==JSON.stringify(b.wire.delta),'同frame/同baseで内容だけ異なる写真を実codecで作成');
    x.h.rememberPeerSnapshot(x.peer.id,a.wire);test(r.sent.size===0&&r.queued.has(b.wire.frame),'古い異delta完了callbackで未送信recordをsentへ昇格しない');
    x.h.rememberPeerSnapshot(x.peer.id,b.wire);test(r.sent.size===1&&!r.queued.has(b.wire.frame),'一致したdelta完了callbackだけsentへ昇格');raw.push({case:'same-frame',a:a.wire,b:b.wire,sent:[...r.sent.keys()]});
  });
  run('tuple省略の外挿上限',()=>{
    const x=makeHarness(),r=x.h.replicationFor(x.peer),id=x.owner.entityId,epoch=1;
    r.epochs.set(id,epoch);r.sent.set(1,{time:650,visible:new Map([[id,epoch]]),updates:new Map([[id,{time:650,epoch,lifeId:1,motionEpoch:0,lagEpoch:0}]])});
    r.sent.set(2,{time:950,visible:new Map([[id,epoch]]),updates:new Map()});
    const input={sentAt:975,receivedAt:1000,view:{frame:2,time:900,delayMs:100}};
    const result=x.h.verifiedPeerUnitTimes(x.peer,input,{time:900});test(result===null||!result.has(id),'sample650/anchor950/view900のtuple省略でsample+100超を拒否');
    const legal=x.h.verifiedPeerUnitTimes(x.peer,{...input,view:{...input.view,time:740}},{time:740});test(legal?.get(id)===740,'tuple省略でもsample+100以内の裏付け時刻は保持');raw.push({case:'omitted-tuple',input,result:result?[...result]:null,legal:legal?[...legal]:null});
  });
  run('viewer/module欠落をfail-closed',()=>{
    for(const mode of ['missing-viewer','missing-module']){
      const x=makeHarness({withoutVisibility:mode==='missing-module'}),p=mode==='missing-viewer'?{...x.peer,unitId:null}:x.peer,v=x.h.createPeerView(p);
      test(v.visible.size===0&&!v.sourceVisible(x.owner)&&!v.pointVisible(x.owner.pos)&&!v.gadgetVisible({team:'R',gadget:true,kind:'sentry',pos:x.owner.pos}),mode+'で許可集合/位置/sourceを空にする');
      const rejected={};for(const key of ['snapshotForPeer','encodePeerSnapshot']){try{rejected[key]={value:x.h[key](p,x.full(),true)};}catch(e){rejected[key]={name:e.name,message:e.message};}}
      test(Object.values(rejected).every(e=>e.name==='Error'&&typeof e.message==='string'&&!/is not defined|undefined|null/.test(e.message)),mode+'では理由付きでsnapshot/baseの生成自体を拒否');raw.push({case:mode,viewSize:v.visible.size,rejected});
    }
  });
  run('未発見sentryの銃口event',()=>{
    const x=makeHarness(),g={kind:'sentry',gadget:true,team:'R',owner:x.owner,pos:new T.Vector3(0,200,-65),mesh:new T.Object3D(),
      cd:0,reloadT:0,scanT:1,ammo:1,target:x.viewer,spec:{tip:[0,1,0],gun:{range:70,rpm:600,mag:10,reload:1,spread:0,sfx:'rifle'}},weaponName:'fixture-sentry'};
    g.mesh.position.copy(g.pos);x.c.gadgets.push(g);const view=x.h.createPeerView(x.peer);x.c.sentryTick(g,.01);
    const events=x.game.state.events,tracer=events.find(e=>e.type==='tracer');
    test(view.visible.has(x.owner.entityId)&&!view.gadgetVisible(g),'owner50mは可視でもsentry65mは未発見');
    test(!!tracer&&Math.abs(tracer.data.from[1]-g.pos.y-3.96)<1e-8,'本体sentryTickが基部より3.96m離れた銃口tracerを発生');
    test(tracer?.source===g,'sentryTick→fire→tracerで設置銃sourceをownerへ上書きしない');
    const filtered=x.h.eventsForPeer(x.peer,events);test(!filtered.some(e=>e.type==='tracer'),'未発見65m sentryの3m近傍外銃口tracerを送信しない');
    raw.push({case:'sentry',owner:x.owner.pos.toArray(),gadget:g.pos.toArray(),events:events.map(e=>({id:e.id,type:e.type,data:e.data,source:e.source===g?'gadget':e.source===x.owner?'owner':null})),filtered});
  });
  return {checks,observations,raw,failure:checks.some(c=>!c.value)};
}
module.exports={productionBoundaryChecks};
