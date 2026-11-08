// #214 次段階③。node tools/test/online_lag_check.js dbg /tmp/online-lag [--mock-transport]
// [--functional-only | --wire-only | --rate-only] [--latency-ms=50|100]
// 実機体の射線fixtureと送信wireを別々に検査する。人工配置/固定時計は実回線の命中率測定ではない。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {check}=require('./lib');
const {ROOT,MOCK_TRANSPORT,TRANSPORT_MODE,harness,room,frames,neutral,sleep,installWireObserver}=require('./online_test_helpers');
const TEST_SOURCE_HASH=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
// 失敗時の診断が循環参照で元のassertを上書きしない。共有参照は省かず、祖先への循環だけを明示する。
function diagnosticJson(value,space){
  const ancestors=[];
  return JSON.stringify(value,function(key,item){
    if(!item||typeof item!=='object')return item;
    while(ancestors.length&&ancestors.at(-1)!==this)ancestors.pop();
    if(ancestors.includes(item))return '[循環参照]';
    ancestors.push(item);return item;
  },space);
}
const functionalOnly=process.argv.includes('--functional-only'),wireOnly=process.argv.includes('--wire-only'),rateOnly=process.argv.includes('--rate-only');
if([functionalOnly,wireOnly,rateOnly].filter(Boolean).length>1)throw Error('*-only は同時指定できません');
const latencyArg=process.argv.find(x=>x.startsWith('--latency-ms='));
const latencies=latencyArg?[Number(latencyArg.split('=')[1])]:[50,100];
if(latencies.some(x=>![50,100].includes(x)))throw Error('--latency-ms は50または100');

function instrument(dir){
  const file=path.join(dir,'online/game.js'),source=fs.readFileSync(file,'utf8'),marker='  window.CBOnlineGame=';
  if(!source.includes(marker))throw Error('巻き戻しfixtureの挿入位置がありません');
  const hook=`  window.__lagTest={captureLagHistory,encodePeerSnapshot,rememberPeerSnapshot,replicationFor,castGuestHitscan,sendLocalInput,acceptInput,acceptInputBatch,acceptInputActions,interpolate,recordHostInputStep,advanceRemoteCommands,acknowledgeInputAction,
    enable:value=>{lagEnabled=!!value;},context:()=>hitscanContext,history:()=>lagHistory,view:()=>lastRenderedView,peer:id=>state.peers.get(id)};\n`;
  fs.writeFileSync(file,source.replace(marker,hook+marker));
}

async function functional(host,oneWayMs){
  return host.evaluate(oneWayMs=>{
    const g=__g,T=g.T,game=CBOnlineGame,t=__lagTest,checks=[],details={oneWayModelMs:oneWayMs};
    const test=(value,name,data)=>{
      checks.push({value:!!value,name});if(value)return;
      const seen=new WeakSet(),detail=JSON.stringify(data,(key,item)=>{if(item&&typeof item==='object'){if(seen.has(item))return '[循環参照]';seen.add(item);}return item;});
      throw Error(name+'\n'+detail);
    };
    // host内部のsource/targetは描画ツリーを持つ。イベント検査に必要な公開dataと参照IDだけを記録する。
    const eventData=({id,type,data,source,target})=>({id,type,data:structuredClone(data),sourceId:source?.entityId||source?.kind||null,targetId:target?.entityId||target?.kind||null});
    const near=(a,b,e=1e-6)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<=e);
    const shooter=g.units.find(u=>u.controller==='remoteHuman'),target=g.units.find(u=>u.controller==='bot'&&u.team!==shooter.team);
    if(!shooter||!target)throw Error('遠隔人間と敵Botのfixtureがありません');
    const peer=game.state.peers.get(shooter.ownerPeerId),originalNow=Object.getOwnPropertyDescriptor(performance,'now'),clockFn=game.state.transport.clock;
    const originalDamage=window.damage,originalKill=window.kill,damageCalls=[],killCalls=[];
    let clock=100000,frame=5000;
    const baseWeapon=shooter.slots.main.w,weapon={...baseWeapon,dmg:100,spread:0,recoil:0,recoilH:0,pellets:1};
    delete weapon.proj;delete weapon.blast;delete weapon.directBlast;
    shooter.slots.main.w=weapon;shooter.weapon='main';
    Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
    game.state.transport.clock=()=>({rttMs:oneWayMs*2,offsetMs:0,samples:10});
    window.damage=function(r,by,...args){if(r===target)damageCalls.push({pos:r.pos.toArray(),hp:r.hp,dmg:args[0],head:!!args[1],slot:args[3]});return originalDamage(r,by,...args);};
    window.kill=function(v,...args){if(v===target)killCalls.push({pos:v.pos.toArray(),hp:v.hp,life:v.lifeId});return originalKill(v,...args);};
    const setPose=(u,x,crouch=false)=>{
      Object.assign(u,{alive:true,downT:0,invulT:0,repairing:false,transfer:null,stun:'',stunT:0,electricT:0,shockT:0,weakT:0,
        crouching:crouch,planted:false,recoverT:0,dashT:0,lungeT:0,swing:null,recoil:0,recoilYaw:0,cameraRecoil:0,cameraRecoilYaw:0,onGround:true,yaw:0,pitch:0});
      u.hp=u.maxHp;u.pos.set(x,200,u===shooter?30:0);u.vel.set(0,0,0);u.group.position.copy(u.pos);u.group.rotation.set(0,0,0);
      for(let n=0;n<20;n++)g.weaponLook(u,.025);u.group.updateMatrixWorld(true);
    };
    // 比較するのは生の現在状態。巻戻し成功数を根拠に復元成功とは判定しない。
    const fingerprint=u=>{
      const values=[...u.pos.toArray(),...u.vel.toArray(),u.yaw,u.pitch,u.crouching,u.lifeId,u.onlineMotionEpoch||0];
      u.group.traverse(o=>{values.push(o.uuid,o.visible,o.matrixAutoUpdate,...o.matrix.elements,...o.matrixWorld.elements);});
      for(const entry of u.rig?.hitMeshes||[]){values.push(...entry.mesh.geometry.attributes.position.array);for(const range of entry.ranges||[])if(range.hitPrevious)values.push(...range.hitPrevious);}
      return JSON.stringify(values);
    };
    const cast=(aim,from=g.muzzle(shooter))=>g.castFrom(from,aim.clone().sub(from).normalize(),shooter,150);
    const findAim=slot=>{
      const from=g.muzzle(shooter);
      for(let y=4.4;y>=.4;y-=.08)for(let x=-.7;x<=.7;x+=.14){
        const aim=new T.Vector3(target.pos.x+x,target.pos.y+y,target.pos.z),h=cast(aim,from);
        if(h?.ref===target&&h.slot===slot&&!h.wm)return {aim,from,point:h.point.clone(),slot:h.slot,dist:h.dist};
      }
      throw Error('独立した現在raycastで標的の'+slot+'を発見できません');
    };
    const sentView=(viewTime,snapshotTime=viewTime)=>{
      const view={time:viewTime,frame:++frame,delayMs:60};
      // 機能fixtureだけ成功送信完了を模擬する。生成しただけの全体写真や他peerの台帳を使わない。
      const full=game.snapshot(snapshotTime);full.frame=frame;
      const encoded=t.encodePeerSnapshot(peer,full,true);t.rememberPeerSnapshot(peer.id,encoded.wire);
      const sent=t.replicationFor(peer).sent.get(frame);
      if(!sent?.updates.has(target.entityId)||!sent.visible.has(shooter.entityId))throw Error('射手peerの公開・実送信台帳がありません');
      return view;
    };
    const stamp=(viewTime,snapshotTime=viewTime)=>{
      const view=sentView(viewTime,snapshotTime);
      peer.input={seq:frame,lifeId:shooter.lifeId,actionSeq:frame,sentAt:clock-oneWayMs,receivedAt:clock,view,keys:{},pressed:{},aimPoint:[0,202,0],yaw:0,pitch:0};
      peer.inputLifeId=shooter.lifeId;peer.receivedSeq=frame;peer.last=clock;
      shooter.controlInput=peer.input;
      return view;
    };
    const reset=(slot='body',crouch=false)=>{
      clock+=1000;t.history().clear();delete peer.replication;damageCalls.length=killCalls.length=0;
      shooter.controller='remoteHuman';target.controller='bot';target.lifeId++;target.onlineMotionEpoch=(target.onlineMotionEpoch||0)+1;
      for(const u of g.units)if(u!==shooter&&u!==target){u.pos.set(1000,200,1000);u.group.position.copy(u.pos);u.group.updateMatrixWorld(true);}
      setPose(shooter,0);setPose(target,0,crouch);g.scene.updateMatrixWorld(true);
      const expected=findAim(slot),viewTime=clock-(oneWayMs+60);
      // 送信写真は旧位置にいる時点で作る。現在位置を過去時刻の写真と偽って台帳へ入れない。
      t.captureLagHistory(viewTime);const view=stamp(viewTime);
      setPose(target,12,false);g.scene.updateMatrixWorld(true);t.captureLagHistory(clock);
      const before=fingerprint(target),hp=target.hp;
      return {...expected,viewTime,view,before,hp,current:target.pos.toArray()};
    };
    const actualHit=f=>t.castGuestHitscan(shooter,f.from,f.aim.clone().sub(f.from).normalize(),weapon);
    const shot=f=>{shooter.recoil=shooter.recoilYaw=0;return g.shot(shooter,shooter.slots.main,f.aim,0);};
    try{
      const poses=[];
      for(const [slot,crouch] of [['head',false],['body',false],['head',true],['body',true]]){
        const f=reset(slot,crouch),shooterBefore=fingerprint(shooter),current=cast(f.aim),hit=actualHit(f);
        test(current?.ref!==target,'現在の横切り後の標的には旧照準が当たらない',current?.slot);
        test(hit?.ref===target&&hit.slot===f.slot&&near(hit.point.toArray(),f.point.toArray(),.003),'過去'+(crouch?'しゃがみ':'直立')+slot+'を同じ射線・部位で捕捉',{expected:f.point.toArray(),actual:hit?.point.toArray(),slot:hit?.slot});
        test(fingerprint(target)===f.before,'巻戻しraycast後に現在の骨・被弾面・姿勢を復元');
        test(fingerprint(shooter)===shooterBefore,'射手自身の現在colliderを巻き戻さない');
        test(target.hp===f.hp&&damageCalls.length===0,'照会だけではHPもdamage回数も進めない');
        shot(f);
        const expectedDamage=weapon.dmg*(slot==='head'?(weapon.head||g.HEADSHOT_MULT):1)*g.armorMult(target,slot);
        test(damageCalls.length===1&&Math.abs(f.hp-target.hp-expectedDamage)<1e-5,'手持ちshotから部位倍率込みdamageを現在へ一度だけ適用',damageCalls);
        test(near(damageCalls[0].pos,f.current),'damageは過去位置ではなく現在位置で実行');
        poses.push({slot,crouch,currentMiss:true,hitPoint:hit.point.toArray(),hpLost:f.hp-target.hp,damageCalls:damageCalls.length});
      }
      details.poses=poses;

      // 現在の障害物を履歴作成後に追加する。過去の機体だけが巻戻し対象。
      {
        const f=reset(),wall=new T.Mesh(new T.BoxGeometry(6,8,1),new T.MeshBasicMaterial());wall.position.set(0,202,15);g.scene.add(wall);wall.updateMatrixWorld(true);g.hittables.push(wall);
        try{const before=target.hp,h=actualHit(f);shot(f);test(h?.ref!==target&&target.hp===before&&damageCalls.length===0,'現在追加した壁を過去機体の手前で保持');}
        finally{g.hittables.splice(g.hittables.indexOf(wall),1);g.scene.remove(wall);wall.geometry.dispose();wall.material.dispose();}
      }
      {
        const f=reset(),miss=f.aim.clone().add(new T.Vector3(15,0,0));shooter.controlTarget=target;shooter.controlInput.lockTarget=target.entityId;
        const hit=t.castGuestHitscan(shooter,f.from,miss.sub(f.from).normalize(),weapon);
        test(hit?.ref!==target,'ロック対象があっても照準外の射線を中心へ補正しない');shooter.controlTarget=null;
      }
      // 過去に生存していても、現在の状態/命/移動/機体境界を越えない。
      const boundaries=[];
      for(const boundary of ['dead','life','motion','mech','revive']){
        const f=reset();
        if(boundary==='dead'){target.alive=false;target.hp=0;}
        if(boundary==='life')target.lifeId++;
        if(boundary==='motion')target.onlineMotionEpoch++;
        let oldMech;if(boundary==='mech'){oldMech=target.mech;target.mech={...target.mech,head:target.mech.head==='standard'?'light':'standard'};}
        if(boundary==='revive'){target.alive=false;target.hp=0;target.downT=1;target.downYaw=target.yaw;g.revive(target,g.units.find(u=>u.team===target.team&&u!==target)||target);target.invulT=0;t.captureLagHistory(clock);}
        const hp=target.hp,h=actualHit(f);shot(f);
        test(h?.ref!==target&&target.hp===hp&&damageCalls.length===0,boundary+'境界の前の標的を命中扱いにしない');
        if(oldMech)target.mech=oldMech;boundaries.push(boundary);
      }
      details.boundaries=boundaries;

      {
        const f=reset(),old=target.rig.meshes[0].mesh.raycast,mesh=target.rig.meshes[0].mesh;let threw=false;
        mesh.raycast=()=>{throw Error('試験用raycast例外');};
        try{actualHit(f);}catch(e){threw=/試験用raycast例外/.test(e.message);}finally{mesh.raycast=old;}
        test(threw&&fingerprint(target)===f.before,'raycast例外でもfinallyで現在の全被弾状態を復元');
        test(cast(f.aim)?.ref!==target&&target.hp===f.hp,'例外後の通常raycastとHPは現在のまま');
      }
      {
        const f=reset();for(const entry of target.rig.hitMeshes){delete entry.boundGroups;delete entry.hitBounds;}
        const hit=actualHit(f),currentAim=f.aim.clone().add(new T.Vector3(12,0,0)),current=cast(currentAim);
        test(hit?.ref===target&&current?.ref===target,'初回lazy境界の巻戻し後も現在raycastを例外なく実行');
      }
      {
        const f=reset(),history=t.history(),old=history.skinHit,before=g.units.map(fingerprint);let calls=0,threw=false;
        history.skinHit=entry=>{if(++calls===4)throw Error('試験用準備途中例外');return old(entry);};
        try{actualHit(f);}catch(e){threw=/試験用準備途中例外/.test(e.message);}finally{history.skinHit=old;}
        test(threw&&g.units.every((u,i)=>fingerprint(u)===before[i]),'二機目の巻戻し準備途中の例外でも既変更全機を復元');
      }
      {
        const f=reset(),health=f.hp;weapon.pellets=5;shot(f);
        const expected=weapon.dmg*g.armorMult(target,'body')*5;
        test(damageCalls.length===5&&Math.abs(health-target.hp-expected)<1e-5,'散弾5発の各pelletを一度だけ現在HPへ適用',{damageCalls,health,hp:target.hp});
        test(damageCalls.every(x=>near(x.pos,f.current)),'散弾の全damageは復元後の現在位置');weapon.pellets=1;
      }
      {
        const f=reset(),kills=shooter.sc.kills;target.hp=50;weapon.pellets=5;shot(f);
        test(killCalls.length===1&&damageCalls.length===1&&shooter.sc.kills===kills+1&&!target.alive,'最初の致死pellet後は残りの過去像を撃たず撃破/score一回',{killCalls,damageCalls,kills,after:shooter.sc.kills});
        test(near(killCalls[0].pos,f.current)&&near([target.pos.x,target.pos.z],[f.current[0],f.current[2]])&&Math.abs(target.pos.y-g.groundAt(f.current[0],f.current[2],f.current[1]+.5))<1e-6,'撃破は現在位置、空中の死体は現在XZの真下へ落下',{killCalls,current:f.current,corpse:target.pos.toArray()});weapon.pellets=1;
      }
      {
        const f=reset(),count=game.metrics().lagCompensation.rewinds;
        shooter.controller='bot';shot(f);shooter.controller='remoteHuman';
        test(target.hp===f.hp&&game.metrics().lagCompensation.rewinds===count,'Bot射手の手持ち銃を巻き戻さない');
        g.fire(shooter,f.aim,0,weapon,f.from);
        test(target.hp===f.hp&&game.metrics().lagCompensation.rewinds===count,'設置銃/背部自動砲と同じshot外fire経路を巻き戻さない');
      }
      {
        const f=reset(),saved=shooter.slots.main.w,projectile=Object.values(g.WEAPONS).find(w=>w.proj&&!w.drone&&!w.stunField),count=game.metrics().lagCompensation.rewinds;
        if(!projectile)throw Error('飛翔弾武器のfixtureがありません');
        shooter.slots.main.w=projectile;g.shot(shooter,shooter.slots.main,f.aim,0);shooter.slots.main.w=saved;
        test(game.metrics().lagCompensation.rewinds===count&&target.hp===f.hp,'飛翔弾の発射でhitscan巻戻しを使わない');
      }
      {
        const f=reset(),count=game.metrics().lagCompensation.rewinds,sl=shooter.slots.aux;
        if(sl.w.type!=='sword')throw Error('近接武器fixtureがありません');
        shooter.weapon='aux';sl.cd=0;g.swordTick(shooter,sl,.016,true,f.aim);const started=!!shooter.swing;
        for(let i=0;i<60;i++)g.swordTick(shooter,sl,.02,false,f.aim);
        test(started&&game.metrics().lagCompensation.rewinds===count&&target.hp===f.hp,'実近接の振りと判定はhitscan巻戻しを使わない');
        shooter.weapon='main';shooter.swing=null;
      }
      {
        const rows=[];
        for(const [name,value]of [['future',clock+1000],['NaN',NaN],['old',clock-1000]]){
          const f=reset();peer.input.view.time=name==='future'?clock+1000:name==='old'?clock-1000:value;
          const hp=target.hp,h=actualHit(f);shot(f);test(h?.ref!==target&&target.hp===hp,'申告時刻'+name+'を過去命中へ使わない');rows.push({name,rejected:true});
        }
        details.invalidTimes=rows;
      }
      {
        const outcomes=[];
        for(const order of ['control-first','movement-first','reverse-batch','lost-first-movement']){
          const f=reset();
          // 固定命令（参加時から fixedCommands）では移動はhostの固定stepで p.input に入る。ここは action と movement の
          // 到着順の規則（remoteInput の合成）だけを見るので、旧来の「受けたら即 p.input」経路で並べる。
          Object.assign(peer,{fixedCommands:false,commandQueue:[],input:null,inputLifeId:shooter.lifeId,inputTimes:[],inputHistoryTruncated:false,firstInputAt:null,
            receivedSeq:0,receivedActionSeq:0,appliedSeq:0,appliedStep:0,appliedSeqDt:0,appliedTotalDt:0,appliedSteps:[],appliedActionSeq:0,
            pendingEdges:{},actions:[],actionState:null,activeAction:null,pendingShot:null,shotActionSeq:0,last:clock});
          const latestView=sentView(clock-oneWayMs-30);
          const changedAim=f.aim.clone().add(new T.Vector3(30,0,0)).toArray();
          const move=seq=>({seq,lifeId:shooter.lifeId,actionSeq:1,sentAt:clock-oneWayMs,view:latestView,aimPoint:changedAim,yaw:.7,pitch:.1,keys:{},pressed:{}});
          const action={seq:10,actionSeq:1,lifeId:shooter.lifeId,sentAt:clock-oneWayMs,view:f.view,aimPoint:f.aim.toArray(),yaw:0,pitch:0,cameraRecoil:0,cameraRecoilYaw:0,trigger:true,alt:false,keys:{},pressed:{}};
          const ingest=()=>t.acceptInputBatch(peer,{inputs:order==='reverse-batch'?[move(11),move(9),move(10)]:order==='movement-first'?[move(10),move(11)]:[move(11)]});
          if(order==='control-first'){
            t.acceptInputActions(peer,action);test(!game.remoteInput(shooter).trigger,'control先着だけで対応movement前に射撃しない');ingest();
          }else{ingest();t.acceptInputActions(peer,action);}
          shooter.controlInput=game.remoteInput(shooter);
          test(shooter.controlInput.yaw===.7&&shooter.controlInput.pitch===.1&&near(shooter.controlInput.aimPoint,changedAim),order+'でも移動yaw/pitch/照準入力は最新movementのまま');
          const observed=[],oldCast=game.castHitscan,eventStart=game.state.events.length;
          game.castHitscan=function(u,from,dir,w){observed.push({view:structuredClone(t.context()?.input?.view),aim:structuredClone(t.context()?.input?.aimPoint),from:from.toArray(),dir:dir.toArray()});return oldCast(...arguments);};
          try{
            shooter.recoil=shooter.recoilYaw=0;g.shot(shooter,shooter.slots.main,new T.Vector3().fromArray(changedAim),0);
            const firstDamage=damageCalls.length,firstEvents=game.state.events.slice(eventStart).filter(e=>['shot','hit'].includes(e.type)).map(eventData);
            t.recordHostInputStep(shooter,shooter.controlInput,.016);
            test(observed.length===1&&JSON.stringify(observed[0].view)===JSON.stringify(f.view)&&near(observed[0].aim,f.aim.toArray())&&firstDamage===1,order+'の初発はaction時刻と照準の対で現在標的へ一度damage',{observed,damageCalls});
            test(firstEvents.some(e=>e.type==='shot')&&firstEvents.some(e=>e.type==='hit')&&firstEvents.every(e=>e.data.seq===action.seq),order+'初発のshot/hit通知もaction.seqへ関連付ける',firstEvents);
            t.acceptInputActions(peer,action);shooter.controlInput=game.remoteInput(shooter);
            test(peer.receivedActionSeq===1&&!peer.pendingShot,order+'の同actionSeq再到着は初発を再注入しない');
            const continuedEventStart=game.state.events.length;shooter.recoil=shooter.recoilYaw=0;g.shot(shooter,shooter.slots.main,new T.Vector3().fromArray(changedAim),0);
            const continuedEvents=game.state.events.slice(continuedEventStart).filter(e=>['shot','hit'].includes(e.type)).map(eventData);
            test(continuedEvents.some(e=>e.type==='shot')&&continuedEvents.every(e=>e.data.seq===11),order+'継続射撃の通知は最新movement.seqへ進む',continuedEvents);
            test(observed.length===2&&JSON.stringify(observed[1].view)===JSON.stringify(latestView)&&near(observed[1].aim,changedAim)&&damageCalls.length===firstDamage,order+'の継続射撃は最新movementの時刻と照準へ進む',{observed,damageCalls});
            outcomes.push({order,casts:observed,damageCalls:firstDamage,firstEvents,continuedEvents});
          }finally{game.castHitscan=oldCast;}
        }
        details.actionOrder=outcomes;peer.fixedCommands=true;
      }
      {
        const f=reset(),history=t.history(),original=history.withRewind;let chosenTime=null;
        peer.input.view.time=clock-400;
        history.withRewind=function(time,...args){chosenTime=time;return original.call(this,time,...args);};
        try{actualHit(f);}finally{history.withRewind=original;}
        test(Number.isFinite(chosenTime)&&clock-chosenTime<=200&&chosenTime<=clock,'古い表示申告でも実際の巻戻し呼出しを過去200ms以内へ制限',{chosenTime,clock});
      }
      // 履歴上限は状態を多数捕獲して実際の配列から測る。
      t.history().clear();for(let i=0;i<=100;i++)t.captureLagHistory(clock+i*5);
      const times=t.history().frames.map(f=>f.time);test(times.length>1&&Math.max(...times)-Math.min(...times)<=255&&times.length<=128,'250ms履歴を無制限に蓄積しない',{frames:times.length,oldest:Math.min(...times),latest:Math.max(...times)});
      details.history={frames:times.length,spanMs:Math.max(...times)-Math.min(...times)};details.metrics=game.metrics().lagCompensation;
      return {checks,details};
    }catch(error){return {checks,details,failure:error.stack||error.message};}finally{
      window.damage=originalDamage;window.kill=originalKill;game.state.transport.clock=clockFn;shooter.slots.main.w=baseWeapon;
      if(originalNow)Object.defineProperty(performance,'now',originalNow);else delete performance.now;
    }
  },oneWayMs);
}

async function dynamicCrouch(active,oneWayMs,ok,output){
  const {host,guests:[guest],pages}=active;
  const setup=await host.evaluate(()=>{
    const g=__g,viewer=g.units.find(u=>u.controller==='remoteHuman'),u=g.units.find(u=>u.controller==='bot'&&u.team===viewer.team);
    Object.assign(u,{frozen:true,crouching:false,planted:false,repairing:false,transfer:null,stun:'',stunT:0,tilt:0,pitch:0,onGround:true,dashState:'',lungeT:0,recoverT:0,invulT:0});
    u.pos.copy(viewer.pos).add(new g.T.Vector3(0,0,-20));u.pos.y=200;viewer.pos.y=200;u.group.position.copy(u.pos);u.group.visible=true;u.vel.set(0,0,0);Object.assign(u.rig,{crouch:0,move:0,phase:0,landT:0});g.weaponLook(u,0);
    return {id:u.entityId,lower:g.ACTIONS.crouch.lower};
  });
  for(let i=0;i<15;i++){await frames(pages,1);await sleep(30);}
  const rows=[];output.crouch={target:setup.id,rows};
  for(const crouching of [true,false]){
    await host.evaluate(({id,crouching})=>{__g.units.find(u=>u.entityId===id).crouching=crouching;},{id:setup.id,crouching});
    for(let i=0;i<14;i++){
      await frames([host],1);
      const row=await guest.evaluate(id=>{
        __g.loop(window.__onlineT=(window.__onlineT||performance.now())+50);
        const g=__g,game=CBOnlineGame,h=game.state.history,time=game.metrics().interpolation.renderTime,latest=game.state.lastSnapshot;
        if(!h.length||!latest)return null;
        let a=h[0].snapshot,b=a;for(let n=1;n<h.length;n++){a=h[n-1].snapshot;b=h[n].snapshot;if(b.time>=time)break;}
        const get=s=>s.units.find(u=>!u.hidden&&u.id===id),v=get(b),old=get(a),last=get(latest),u=g.units.find(u=>u.entityId===id);
        if(!u||![v?.renderCrouch,old?.renderCrouch,last?.renderCrouch].every(Number.isFinite))return null;
        const f=Math.max(0,Math.min(1,(time-a.time)/Math.max(1,b.time-a.time))),expected=time>latest.time?last.renderCrouch:old.renderCrouch+(v.renderCrouch-old.renderCrouch)*f;
        const head=u.rig.meshes.find(m=>m.mesh.userData.armorSlot==='head').mesh;
        return {time,frame:latest.frame,expected,rendered:u.rig.crouch,onlineRenderCrouch:u.onlineRenderCrouch,visible:u.group.visible,headHeight:head.matrixWorld.elements[13]-u.pos.y};
      },setup.id);
      if(row)rows.push(row);await sleep(30);
    }
  }
  console.log('動的しゃがみ観測',JSON.stringify(output.crouch));
  ok(rows.length>=20&&rows.some(r=>r.expected>.005&&r.expected<setup.lower-.005),`片道${oneWayMs}msで動的しゃがみの写真間の途中姿勢を観測`);
  ok(rows.every(r=>r.visible&&Math.abs(r.expected-r.rendered)<1e-6),`片道${oneWayMs}msのguest描画しゃがみを表示時刻の写真補間値へ一致`);
  const heights=rows.map(r=>r.headHeight+Math.min(.64,r.expected));
  ok(Math.max(...heights)-Math.min(...heights)<.025,`片道${oneWayMs}msの実頭部collider高さにしゃがみの二重平滑化なし`);
  output.crouch.headHeightResidualMetres=Math.max(...heights)-Math.min(...heights);return output.crouch;
}

async function wire(active,oneWayMs,ok,report){
  const output={oneWayInjectedMs:oneWayMs,completed:false};report.wire.push(output);
  const {host,guests:[guest],pages}=active;
  await installWireObserver(guest);
  await guest.evaluate(()=>{window.__lagWire=[];__observeOnlineWire(null,m=>{if(['inputBatch','inputActions'].includes(m.type))__lagWire.push({type:m.type,channel:m.channel,payload:structuredClone(m.envelope.payload)});});});
  // 実際のsnapshot受信→guest描画終了のstampを得るまで各ページのイベントループを進める。
  for(let i=0;i<25;i++){await frames(pages,1);await sleep(20);}
  const crouch=await dynamicCrouch(active,oneWayMs,ok,output);
  const sent=await guest.evaluate(base=>{
    const view=structuredClone(__lagTest.view());if(!view||!Number.isFinite(view.time))throw Error('描画済みsnapshotのstampがありません');
    const inputs=[];
    for(let n=0;n<6;n++){
      const input={...base,command:true,seq:++CBOnlineGame.state.seq,keys:{},pressed:{},yaw:__g.player.yaw,pitch:__g.player.pitch,aimPoint:[0,202,0],trigger:n===5};
      __lagTest.sendLocalInput(input);inputs.push({seq:input.seq,actionSeq:input.actionSeq});
    }
    return {view,inputs,seq:inputs.at(-1).seq};
  },neutral);
  // 最後のmovementは送信制限を越えてからflushする。snapshot/control実線は製品transportに委ねる。
  await sleep(25);
  await guest.evaluate(base=>__lagTest.sendLocalInput({...base,command:true,seq:++CBOnlineGame.state.seq,keys:{},pressed:{},yaw:__g.player.yaw,pitch:__g.player.pitch,aimPoint:[0,202,0],trigger:true}),neutral);
  await sleep(100+oneWayMs*3);
  // 参加時から固定命令。受けた移動はhostの固定stepまで commandQueue に並ぶので、その最後（無ければ適用済みの p.input）を見る。
  const result=await host.evaluate(()=>{const p=[...CBOnlineGame.state.peers.values()][0];return {input:structuredClone(p.commandQueue?.at(-1)||p.input),actionSeq:p.receivedActionSeq,clock:CBOnlineGame.state.transport.clock(p.id)};});
  const observed=await guest.evaluate(()=>({wire:__lagWire,errors:__wireObserverErrors,metrics:CBOnlineGame.metrics().prediction}));
  Object.assign(output,{sent,received:result,wire:observed.wire,crouch});
  const batches=observed.wire.filter(x=>x.type==='inputBatch'),actions=observed.wire.filter(x=>x.type==='inputActions');
  const candidate=batches.flatMap(x=>x.payload.inputs).filter(x=>x.seq>=sent.inputs[0].seq);
  ok(candidate.length>0&&candidate.every(v=>JSON.stringify(v.view)===JSON.stringify(sent.view)),`片道${oneWayMs}msで実描画stampを後続movementへそのまま載せる`);
  ok(batches.some(x=>x.payload.inputs.length===5)&&batches.every(x=>x.channel==='snapshot'&&x.payload.inputs.length<=5),`片道${oneWayMs}msでも最新5movementの非再送線を維持`);
  const shotActions=actions.filter(x=>x.payload.seq>=sent.inputs[0].seq&&x.payload.trigger);
  ok(shotActions.length>0&&shotActions.every(x=>JSON.stringify(x.payload.view)===JSON.stringify(sent.view)&&JSON.stringify(x.payload.aimPoint)==='[0,202,0]'),`片道${oneWayMs}msのreliable射撃開始に同じ表示時刻と照準の対を保持`);
  ok(actions.length>0&&actions.every(x=>x.channel==='control')&&result.actionSeq>=sent.inputs.at(-1).actionSeq,`片道${oneWayMs}msでも独立actionSeqをcontrolで受信`);
  ok(result.input.seq>=sent.seq&&JSON.stringify(result.input.view)===JSON.stringify(sent.view),`片道${oneWayMs}msのhostが描画stamp付き入力を受信`);
  ok(observed.metrics.enabled&&observed.metrics.predictedSteps>0,`片道${oneWayMs}msで自機予測を維持`);
  ok(!observed.errors.length,`片道${oneWayMs}msの独立wire観測にエラーなし`);
  output.completed=true;return output;
}


// 実送信遅延ありの命中率fixture。位置/発射間隔は同条件、照準はそのguestが最後に表示した標的位置。
// 描画を省いた人工配置なので人の腕前・画面発光・実回線の性能を表すものではない。
async function hitRate(active,oneWayMs,enabled,ok,report){
  const output={oneWayInjectedMs:oneWayMs,enabled,completed:false};report.hitRate.push(output);
  const {host,guests:[guest]}=active,count=12,intervalMs=300,warmupMs=1800,speed=12;
  const setup=await host.evaluate(({enabled,speed})=>{
    const g=__g,game=CBOnlineGame,shooter=g.units.find(u=>u.controller==='remoteHuman'),target=g.units.find(u=>u.controller==='bot'&&u.team!==shooter.team);
    if(!target)throw Error('横移動標的がありません');
    __lagTest.enable(enabled);__lagTest.history().clear();
    const place=(u,x,z)=>{
      Object.assign(u,{alive:true,downT:0,invulT:0,crouching:false,planted:false,repairing:false,transfer:null,stun:'',stunT:0,electricT:0,shockT:0,
        onGround:true,recoil:0,recoilYaw:0,cameraRecoil:0,cameraRecoilYaw:0,yaw:0,pitch:0});
      u.pos.set(x,200,z);u.vel.set(0,0,0);u.group.position.copy(u.pos);u.group.rotation.set(0,0,0);g.weaponLook(u,0);u.group.updateMatrixWorld(true);
    };
    for(const u of g.units)place(u,u===shooter?0:u===target?-30:1000,u===shooter?60:u===target?0:1000);
    const originalWeapon=shooter.slots.main.w,weapon={...originalWeapon,dmg:100,spread:0,recoil:0,recoilH:0,pellets:1};delete weapon.proj;delete weapon.blast;delete weapon.directBlast;
    shooter.weapon='main';shooter.slots.main.w=weapon;shooter.hp=shooter.maxHp;target.hp=target.maxHp;
    shooter.onlineMotionEpoch=(shooter.onlineMotionEpoch||0)+1;target.onlineMotionEpoch=(target.onlineMotionEpoch||0)+1;
    const q=window.__lagRateHost={startAt:performance.now(),lastAt:performance.now(),samples:[],errors:[],lastAction:0,ticks:0,damageCalls:0,originalWeapon};
    const damage=window.damage;window.damage=function(r,...args){if(r===target)q.damageCalls++;return damage(r,...args);};const history=__lagTest.history(),rewind=history.withRewind;history.withRewind=function(time,...args){q.lastRewindTime=time;return rewind.call(this,time,...args);};q.restore=()=>{window.damage=damage;shooter.slots.main.w=originalWeapon;history.withRewind=rewind;};
    q.timer=setInterval(()=>{
      try{
        const now=performance.now(),dt=Math.min(.05,Math.max(.001,(now-q.lastAt)/1000));q.lastAt=now;q.ticks++;
        place(shooter,0,60);place(target,-30+speed*(now-q.startAt)/1000,0);target.vel.x=speed;g.scene.updateMatrixWorld(true);
        game.beforeFrame(dt,now);
        // 参加時から固定命令。移動・照準は本体の updateHumanUnit と同じく固定stepで消化し、その入力で撃つ。
        const peer=game.state.peers.get(shooter.ownerPeerId);
        if(peer?.fixedCommands){peer.frameAction=null;__lagTest.advanceRemoteCommands(shooter,peer,dt);shooter.controlInput=peer.frameAction||game.remoteInput(shooter);place(shooter,0,60);g.scene.updateMatrixWorld(true);}
        const input=shooter.controlInput,appliedAction=peer.activeAction||peer.actionState;
        if(input?.trigger&&appliedAction?.actionSeq>q.lastAction){
          q.lastAction=appliedAction.actionSeq;const shotInput=peer.pendingShot||input,before=target.hp,calls=q.damageCalls,rewinds=game.metrics().lagCompensation.rewinds;
          const aim=new g.T.Vector3().fromArray(input.aimPoint),shotAim=new g.T.Vector3().fromArray(shotInput.aimPoint),from=g.muzzle(shooter),currentHit=g.castFrom(from,shotAim.clone().sub(from).normalize(),shooter,400);
          q.lastRewindTime=null;shooter.recoil=shooter.recoilYaw=0;g.shot(shooter,shooter.slots.main,aim,0);
          const after=game.metrics().lagCompensation;
          q.samples.push({seq:input.seq,actionSeq:appliedAction.actionSeq,at:now-q.startAt,acceptedTransitMs:shotInput.receivedAt-shotInput.sentAt,view:shotInput.view,viewAgeMs:shotInput.view?now-shotInput.view.time:null,
            actualRewindAgeMs:q.lastRewindTime===null?null:now-q.lastRewindTime,residualViewMs:q.lastRewindTime===null?null:q.lastRewindTime-shotInput.view.time,
            targetPosition:target.pos.toArray(),aim:shotInput.aimPoint,movementAim:input.aimPoint,currentRayWouldHit:currentHit?.ref===target,damageCalls:q.damageCalls-calls,hpBefore:before,hpAfter:target.hp,
            hit:target.hp<before,rewindDelta:after.rewinds-rewinds,clampedTotal:after.clamped,maxRewindMs:after.maxRewindMs,clock:game.state.transport.clock(shooter.ownerPeerId)});
        }
        if(peer?.fixedCommands)__lagTest.acknowledgeInputAction(peer);else if(input?.seq)__lagTest.recordHostInputStep(shooter,input,dt);
        game.afterFrame(dt,now);
      }catch(e){q.errors.push(e.stack||e.message);clearInterval(q.timer);}
    },16);
    return {targetId:target.entityId,startAt:q.startAt,lifeId:target.lifeId};
  },{enabled,speed});
  try{
    await guest.evaluate(({setup,count,intervalMs,warmupMs})=>{
      const g=__g,game=CBOnlineGame,q=window.__lagRateGuest={sent:[],errors:[],ticks:0,lastAt:performance.now(),next:0,releaseAt:0,done:false};
      q.timer=setInterval(()=>{
        try{
          const now=performance.now(),hostTime=now+(game.state.transport.clock()?.offsetMs||0),dt=Math.min(.05,Math.max(.001,(now-q.lastAt)/1000));q.lastAt=now;q.ticks++;
          const target=g.units.find(u=>u.entityId===setup.targetId);if(!target||target.onlineHidden)return;
          let trigger=q.releaseAt>hostTime;
          const due=setup.startAt+warmupMs+q.next*intervalMs;
          if(q.next<count&&hostTime>=due){
            if(!__lagTest.view())return;
            trigger=true;q.releaseAt=hostTime+60;q.sent.push({index:q.next,plannedAt:warmupMs+q.next*intervalMs,at:hostTime-setup.startAt,
              displayedTarget:target.pos.toArray(),view:structuredClone(__lagTest.view())});q.next++;
          }
          const aim=g.targetPoint(target).toArray();
          // 入力作成時に見えていた座標を固定し、hostの現在位置を照準へ取り込まない。
          game.testInput({keys:{},pressed:{},fwd:0,side:0,trigger,alt:false,wheel:0,yaw:0,pitch:0,aimPoint:aim});
          game.beforeFrame(dt,now);
          for(const u of g.units){u.group.position.copy(u.pos);u.group.rotation.y=u.yaw;g.weaponLook(u,dt);}g.renderer.render(g.scene,g.camera);
          game.afterFrame(dt,now);
          if(q.next===count&&hostTime>q.releaseAt+700){q.done=true;clearInterval(q.timer);}
        }catch(e){q.errors.push(e.stack||e.message);q.done=true;clearInterval(q.timer);}
      },16);
    },{setup,count,intervalMs,warmupMs});
    await guest.waitForFunction(()=>__lagRateGuest.done,{},{timeout:20000,polling:50});await sleep(500+oneWayMs*2);
    const h=await host.evaluate(()=>({samples:__lagRateHost.samples,errors:__lagRateHost.errors,ticks:__lagRateHost.ticks,delayMs:CBOnlineGame.state.transport.latencyMs,metrics:CBOnlineGame.metrics().lagCompensation}));
    const g=await guest.evaluate(()=>({sent:__lagRateGuest.sent,errors:__lagRateGuest.errors,ticks:__lagRateGuest.ticks,delayMs:CBOnlineGame.state.transport.latencyMs}));
    Object.assign(output,{guest:g,host:h});console.log('横移動shot観測',diagnosticJson(output));
    ok(h.delayMs===oneWayMs&&g.delayMs===oneWayMs,`片道${oneWayMs}msの人工遅延をhost/guest両製品transportへ設定`);
    ok(!h.errors.length&&!g.errors.length,`片道${oneWayMs}ms補償${enabled?'ON':'OFF'}の横移動命中率fixtureに例外なし`);
    ok(g.sent.length===count&&h.samples.length===count,`片道${oneWayMs}ms補償${enabled?'ON':'OFF'}でguest ${count}入力とhost ${count}実shotを独立確認`);
    ok(h.samples.every(s=>s.damageCalls===(s.hit?1:0)&&s.hpAfter<=s.hpBefore),`片道${oneWayMs}ms補償${enabled?'ON':'OFF'}は実HP減少とdamage回数だけで命中を数える`);
    if(enabled)ok(h.metrics.maxRewindMs<=200&&h.samples.every(s=>s.actualRewindAgeMs!==null&&s.actualRewindAgeMs<=202&&s.residualViewMs>=-.001),`片道${oneWayMs}msの実巻戻しは200ms上限と計測時差内、表示との差は残差として記録`);
    const hits=h.samples.filter(s=>s.hit).length,result={oneWayInjectedMs:oneWayMs,enabled,requestedShots:count,shots:h.samples.length,hits,hitRate:h.samples.length?hits/h.samples.length:null,
      trajectory:{metresPerSecond:speed,startX:-30,height:200,targetZ:0,shooter:[0,200,60],shotIntervalMs:intervalMs,warmupMs},
      guest:g,host:h,clamped:h.metrics.clamped,maxRewindMs:h.metrics.maxRewindMs};
    Object.assign(output,result,{completed:true});console.log('横移動命中率',JSON.stringify(result));return output;
  }finally{
    await guest.evaluate(()=>{if(window.__lagRateGuest)clearInterval(__lagRateGuest.timer);}).catch(()=>{});
    await host.evaluate(()=>{if(window.__lagRateHost){clearInterval(__lagRateHost.timer);__lagRateHost.restore();}}).catch(()=>{});
  }
}

check('ゲストhitscan巻戻し・現在復元・表示時刻',async({browser,dir,out,ok,errors})=>{
  const report={createdAt:new Date().toISOString(),testSourceHash:TEST_SOURCE_HASH,mode:TRANSPORT_MODE,usesRealWebRTC:!MOCK_TRANSPORT,validationCompleted:false,
    commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
    sourceHashes:Object.fromEntries(['prototype/index.html','prototype/online/game.js','prototype/online/lag-compensation.js'].filter(p=>fs.existsSync(path.join(ROOT,p))).map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')])),
    method:{functional:'実機体/被弾面/製品shot・damage、人工配置・時計・RTT条件。current raycast/HP/damage呼出回数/行列を独立観測。50/100msは決定的な条件であって回線実測ではない。',
      wire:'製品snapshotをguestが描画した後の時刻stampと、各方向50/100ms遅延の製品transport送信・受信を観測。固定コマ送り・描画省略。',
      hitRate:'実時間timer・両方向の製品transport遅延。横12m/s・60m奥行、同一12発の時刻表。guestの前回表示位置を照準として送信。hostの受理control actionごとに製品shotを1回呼びHPとdamage回数を照合する人工射撃fixture。通常gunTickの発射周期/人の照準操作を測る試験ではない。200ms上限後の表示時刻残差も保存。',
      scope:MOCK_TRANSPORT?'BroadcastChannel代替。実WebRTC/別回線/NAT/操作感は未検証。':'実WebRTCとローカルPeerServer。同一PC。別回線/NAT/実PCの操作感は未検証。'},functional:[],wire:[],hitRate:[]};
  const h=await harness(dir);let active;
  try{
    instrument(path.resolve(dir));
    for(const latencyMs of latencies){
      if(!rateOnly&&!wireOnly)active=await room(browser,h,errors,{guests:1,teamSize:2,latencyMs});
      if(!wireOnly&&!rateOnly){console.log('段階: 巻戻しfixture '+latencyMs+'ms');const r=await functional(active.host,latencyMs);report.functional.push(r);if(r.failure)console.error(r.failure);for(const c of r.checks)ok(c.value,latencyMs+'ms '+c.name);ok(!r.failure,latencyMs+'ms 機能fixtureを最後まで実行');}
      // fixtureで変更した世界と固定時計をwire試験へ持ち越さない。
      if(active)await active.close();active=null;
      if(!functionalOnly&&!rateOnly){active=await room(browser,h,errors,{guests:1,teamSize:2,latencyMs});console.log('段階: 表示時刻wire '+latencyMs+'ms');await wire(active,latencyMs,ok,report);await active.close();active=null;}
      if(!functionalOnly&&!wireOnly){
        for(const enabled of [false,true]){active=await room(browser,h,errors,{guests:1,teamSize:2,latencyMs});console.log('段階: 横移動命中率 '+latencyMs+'ms '+(enabled?'ON':'OFF'));await hitRate(active,latencyMs,enabled,ok,report);await active.close();active=null;}
        const off=report.hitRate.find(r=>r.oneWayInjectedMs===latencyMs&&!r.enabled),on=report.hitRate.find(r=>r.oneWayInjectedMs===latencyMs&&r.enabled);
        ok(off.shots===on.shots&&JSON.stringify(off.trajectory)===JSON.stringify(on.trajectory),`片道${latencyMs}msの補償前後で同じ軌跡・照準方法・発射分母を使用`);
        const comparison={oneWayInjectedMs:latencyMs,off:{hits:off.hits,shots:off.shots,hitRate:off.hitRate},on:{hits:on.hits,shots:on.shots,hitRate:on.hitRate},
          hitRateChange:on.hitRate-off.hitRate,percentagePointChange:(on.hitRate-off.hitRate)*100,clamped:on.clamped,maxRewindMs:on.maxRewindMs};
        (report.comparisons||=[]).push(comparison);console.log('補償前後の命中率差',JSON.stringify(comparison));
        ok(Number.isFinite(comparison.hitRateChange),`片道${latencyMs}msの補償前後の命中率差を記録（改善は保証条件にしない）`);
      }
    }
    ok(!errors.length,'巻戻し試験のブラウザエラーなし');report.validationCompleted=true;
  }catch(error){report.failure=error.stack||error.message;console.error('巻戻し試験の元エラー',report.failure);throw error;}finally{
    if(active)await active.close();await h.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-lag.json'),diagnosticJson(report,2));
  }
},{page:false});
