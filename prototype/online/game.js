/* #212 ブラウザホスト試作。通信以外のゲーム規則は既存本体を使う。 */
(() => {
  'use strict';
  const now = () => performance.now();
  const vector = a => new T.Vector3().fromArray(a);
  // 初期装備の通常コア戦だけ。試験場・コスト戦・近接限定の規則は混ぜない。
  const roomMaps = Object.entries(MAPS).filter(([,d]) => !d.testOnly && !d.vs && !d.meleeOnly && d.team >= 2 && d.time > 0).map(([id,d]) => ({id,name:d.name}));
  const roomTeamSizes = Array.from({length:9},(_,i)=>i+2); // 本体2〜50のうち、通信試作は合計20機まで。
  const defaultSettings = {capacity:4,teamSize:5,mapId:'mesa',teamMode:'random'};
  const state = { role: 'offline', phase: 'idle', transport: null, peers: new Map(), requests: new Map(), localUnitId: null,
    settings:null, roster:[], hostTeam:'B', resolvedMapId:null, roomId:null,
    matchId: null, frame: 0, seq: 0, lastSnapshot: null, events: [], history: [], receivedEvents: new Set(),
    inputLatency: [], hitLatency: [], pendingInputs: new Map(), frameMs: [], sendMs: [],
    shots: [], disconnected: [], lastHost: 0, lastSent: 0, lastInput: 0, onStatus: null,
    startAtHost: null, startAtLocal: null, countdownNumber: null, actualStartAt: null };
  let saved = null, overrideInput = null, playingEffects = false, eventId = 0, projectileId = 0, frameStart = 0, previousMove = false, previousTrigger = false;
  let callbacks = {}, damageInputSeq = null, blastDepth = 0, requestedWeapon = null, preferenceResolve = null, preferenceReject = null, preferenceTimer = null;
  let snapshotEncoder = new CBOnlineCodec.Encoder(), snapshotDecoder = new CBOnlineCodec.Decoder(), lastResync = -Infinity, resyncBackoff = 250;
  let pendingPrepare = null, prepared = false, latestSnapshotWire = null, finalFrame = null, lastSnapshotBaseId = 0;
  const pendingSnapshotWires = new Map(), pendingSnapshotBases = new Map();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function interpolationState() {
    return {delayMs:100,targetDelayMs:100,intervalMs:50,jitterMs:0,lastArrival:null,lastRender:null,renderTime:null,localOffset:null,
      acceptedSnapshots:0,staleSnapshots:0,missingBaselines:0,resyncRequests:0,frames:0,interpolatedFrames:0,extrapolatedFrames:0,clampedFrames:0,
      extrapolationMs:0,maxExtrapolationMs:0,gapMs:0,maxGapMs:0,totalDelayMs:0,
      recoveryLagMs:0,maxRecoveryLagMs:0,effectiveDelayMs:100,maxEffectiveDelayMs:100,totalEffectiveDelayMs:0,catchupFrames:0};
  }
  let interpolation = interpolationState();
  const lagSupport=typeof CBOnlineLagComp!=='undefined'?CBOnlineLagComp:null;
  const lagHistory=lagSupport?new lagSupport.ColliderHistory(T,{skinHit:typeof skinMechHit==='function'?skinMechHit:null,refOf:typeof refOf==='function'?refOf:null}):null;
  const lagSnapshots=new Map();
  let lagEnabled=true,lastRenderedView=null,hitscanContext=null;
  const lagMetrics={shots:0,rewinds:0,clamped:0,rejected:0,reasons:{},maxRewindMs:0};
  function resetLagCompensation(){lagHistory?.clear();lagSnapshots.clear();lastRenderedView=null;hitscanContext=null;Object.assign(lagMetrics,{shots:0,rewinds:0,clamped:0,rejected:0,reasons:{},maxRewindMs:0});}
  function captureLagHistory(time=now()){if(state.role==='host'&&state.phase==='playing'&&lagEnabled&&lagHistory)lagHistory.capture(time,units,hittables);}
  function rememberLagSnapshot(s){lagSnapshots.set(s.frame,s.time);for(const [frame,time]of lagSnapshots)if(time<s.time-2000)lagSnapshots.delete(frame);while(lagSnapshots.size>128)lagSnapshots.delete(lagSnapshots.keys().next().value);}
  function castGuestHitscan(u,from,dir,w){
    const cast=()=>castFrom(from,dir,u,w.range||400);
    if(!lagEnabled||!lagHistory||state.role!=='host'||state.phase!=='playing'||u.controller!=='remoteHuman'||!u.alive)return cast();
    lagMetrics.shots++;
    const p=state.peers.get(u.ownerPeerId),input=hitscanContext?.input||u.controlInput;
    const verified=p&&p.inputLifeId===u.lifeId&&input?.lifeId===u.lifeId&&Number.isSafeInteger(input.seq)&&input.seq<=p.receivedSeq
      ?lagSupport.validateViewTime(input.view,{now:now(),sentAt:input.sentAt,receivedAt:input.receivedAt,rttMs:state.transport?.clock?.(p.id)?.rttMs,snapshots:lagSnapshots})
      :{ok:false,reason:'input'};
    if(!verified.ok){lagMetrics.rejected++;lagMetrics.reasons[verified.reason]=(lagMetrics.reasons[verified.reason]||0)+1;return cast();}
    if(verified.clamped)lagMetrics.clamped++;
    const result=lagHistory.withRewind(verified.time,units,u,cast);
    if(lagHistory.lastRewound){lagMetrics.rewinds++;lagMetrics.maxRewindMs=Math.max(lagMetrics.maxRewindMs,verified.ageMs);}
    return result;
  }
  function castHitscan(u,from,dir,w){
    return hitscanContext?.unit===u&&hitscanContext.weapon===w?castGuestHitscan(u,from,dir,w):castFrom(from,dir,u,w.range||400);
  }
  // 確定dtはhostの実行記録だけ。未実行のhost dtは未知なので、送信時の可変dtは仮値として別に保持する。
  const predictionLimits={inputs:240,seconds:1,hostSteps:120,wireSteps:8,visualFrames:6};
  const inputLimits={batch:5,sendMs:1000/60,maxAgeMs:500,futureMs:250,actions:64};
  const movementKeys=['KeyW','KeyS','KeyA','KeyD','KeyC','ShiftLeft','ShiftRight','Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
  const movementEdges=['ShiftLeft','ShiftRight','Space'];
  let inputSending={history:[],lastBatch:-Infinity,actionSeq:0,lastActionAt:-Infinity,signature:null,lifeId:null};
  function predictionState(enabled=true) {
    return {enabled,pending:[],actionEdges:[],authoritative:null,reconciliations:0,correctionCount:0,correctionTotal:0,correctionMax:0,corrections:[],
      predictedSteps:0,predictedSeconds:0,replayedSteps:0,replayedSeconds:0,hardSnaps:0,hardSnapReasons:{},partialAcks:0,droppedInputs:0,droppedThroughSeq:0,droppedThroughDt:0,droppedActionSeq:0,
      lastAckSeq:0,lastAckStep:0,lastAckActionSeq:0,confirmedHostSeconds:0,hostStepSamples:0,hostSteps:[],visualFrames:0,blockedFrames:0};
  }
  let prediction=predictionState();
  function resetPrediction(enabled=prediction.enabled) {
    prediction=predictionState(enabled);inputSending={history:[],lastBatch:-Infinity,actionSeq:0,lastActionAt:-Infinity,signature:null,lifeId:null};for(const u of units)delete u.onlineVisualOffset;
  }
  function clearPrediction() {
    prediction.pending=[];prediction.actionEdges=[];inputSending.history=[];inputSending.signature=null;prediction.authoritative=null;prediction.visualFrames=0;prediction.hostSteps=[];
    state.pendingInputs.clear();displayedLatencies.length=0;
    for(const u of units)delete u.onlineVisualOffset;
  }
  function predictionMetrics() {
    return {...safe(prediction,['enabled','reconciliations','correctionCount','correctionTotal','correctionMax','predictedSteps','predictedSeconds','replayedSteps','replayedSeconds','hardSnaps','partialAcks','droppedInputs','lastAckSeq','lastAckStep','lastAckActionSeq','confirmedHostSeconds','hostStepSamples','blockedFrames']),
      correctionMean:prediction.correctionCount?prediction.correctionTotal/prediction.correctionCount:0,
      pendingInputs:prediction.pending.length,pendingActions:prediction.actionEdges.length,pendingSeconds:prediction.pending.reduce((n,p)=>n+p.provisionalDt,0),
      hardSnapReasons:{...prediction.hardSnapReasons},corrections:prediction.corrections.map(c=>({...c})),
      visualOffset:player?.onlineVisualOffset?.toArray()||[0,0,0]};
  }
  function capturePredictionView() {
    if(!player)return null;
    const pos=player.pos.clone(),visualPos=pos.clone();if(player.onlineVisualOffset)visualPos.addScaledVector(player.onlineVisualOffset,1);
    return {pos,visualPos,yaw:player.yaw,pitch:player.pitch};
  }
  function predictLocalInput(input,dt) {
    if(!prediction.enabled||!player||!Number.isSafeInteger(input?.seq)||input.seq<1||!Number.isFinite(dt)||dt<=0||dt>.05||typeof predictHumanMovement!=='function')return false;
    prediction.actionEdges=prediction.actionEdges.filter(e=>now()-e.time<=inputLimits.maxAgeMs);
    const copy={...input,keys:{...input.keys},pressed:{...input.pressed}};
    const pressedMove=Object.fromEntries(movementEdges.filter(k=>input.pressed?.[k]).map(k=>[k,true]));
    if(Number.isSafeInteger(input.actionSeq)&&Object.keys(pressedMove).length&&!prediction.actionEdges.some(e=>e.actionSeq===input.actionSeq)){
      prediction.actionEdges.push({actionSeq:input.actionSeq,seq:input.seq,lifeId:player.lifeId,time:now(),pressed:pressedMove,needsReplay:false});
      if(prediction.actionEdges.length>inputLimits.actions){prediction.droppedActionSeq=prediction.actionEdges.shift().actionSeq;prediction.droppedInputs++;}
    }
    // movementのackがcontrolの到着より先なら、消化していない押下を次の実在する仮dtへ一度だけ乗せる。
    for(const edge of prediction.actionEdges)if(edge.needsReplay&&edge.lifeId===player.lifeId&&edge.seq<=input.seq){Object.assign(copy.pressed,edge.pressed);edge.needsReplay=false;}
    // 送信情報にdtを含めない。履歴が上限に達したら古い仮stepを捨て、次の確定写真で合わせる。
    prediction.pending.push({input:copy,provisionalDt:dt,lifeId:player.lifeId,time:now()});
    let seconds=prediction.pending.reduce((n,p)=>n+p.provisionalDt,0);
    while(prediction.pending.length>predictionLimits.inputs||seconds>predictionLimits.seconds){const dropped=prediction.pending.shift();seconds-=dropped.provisionalDt;if(dropped.input.seq>=prediction.droppedThroughSeq){prediction.droppedThroughSeq=dropped.input.seq;prediction.droppedThroughDt=dropped.provisionalDt;}prediction.droppedInputs++;}
    const moved=predictHumanMovement(player,copy,dt);
    if(moved){prediction.predictedSteps++;prediction.predictedSeconds+=dt;}else prediction.blockedFrames++;
    return moved;
  }
  function discontinuityReason(previous,v) {
    if(!previous)return '';
    if(previous.lifeId!==v.lifeId)return 'respawn';
    if(previous.cls!==v.cls||JSON.stringify(previous.mech)!==JSON.stringify(v.mech)||SLOTS.some(k=>previous.slots?.[k]?.key!==v.slots?.[k]?.key))return 'equipment';
    if(previous.alive!==v.alive||!v.alive||v.downT>0)return 'down';
    if((previous.motionEpoch||0)!==(v.motionEpoch||0)||v.transfer)return 'transfer';
    if(v.jumpPadIndex>=0||v.predictionBlocked==='jumpPad')return 'jumpPad';
    if(v.flying||v.catLaunch||v.predictionBlocked==='launch')return 'catapult';
    if(v.stun&&v.stun!=='land'&&(v.stun!==previous.stun||v.stunT>previous.stunT+.001))return v.stun==='down'?'down':'stun';
    if((v.electricT||0)>(previous.electricT||0)+.001)return 'electric';
    if((v.shockT||0)>(previous.shockT||0)+.001)return 'shock';
    if(v.predictionBlocked&&v.predictionBlocked!==previous.predictionBlocked)return v.predictionBlocked;
    return '';
  }
  function reconcilePrediction(s,previousView) {
    const v=s.units.find(u=>u.id===state.localUnitId);if(!v||!player)return;
    const m=prediction,ack=s.inputAcks?.[state.localUnitId],legacyAck=s.acks?.[state.localUnitId]||0;
    // seqDtは同じ入力をhostが複数コマ使った累積。seq番号だけでは部分適用を判定できない。
    const seq=Number.isSafeInteger(ack?.seq)?ack.seq:legacyAck,seqDt=Number.isFinite(ack?.seqDt)?Math.max(0,ack.seqDt):Infinity;
    if(ack&&Number.isSafeInteger(ack.step)&&ack.step>=m.lastAckStep){
      for(const step of ack.steps||[])if(Number.isSafeInteger(step.step)&&step.step>m.lastAckStep&&Number.isFinite(step.dt)&&step.dt>0&&step.dt<=.05){m.hostSteps.push({...step});m.hostStepSamples++;}
      while(m.hostSteps.length>predictionLimits.hostSteps)m.hostSteps.shift();
      m.lastAckStep=ack.step;m.confirmedHostSeconds=Number.isFinite(ack.totalDt)?ack.totalDt:m.confirmedHostSeconds;
    }
    m.lastAckSeq=Math.max(m.lastAckSeq,seq);
    const actionSeq=Number.isSafeInteger(ack?.actionSeq)?ack.actionSeq:0;m.lastAckActionSeq=Math.max(m.lastAckActionSeq,actionSeq);
    m.actionEdges=m.actionEdges.filter(e=>e.actionSeq>actionSeq&&e.lifeId===v.lifeId&&now()-e.time<=inputLimits.maxAgeMs);for(const e of m.actionEdges)e.needsReplay=true;
    let reason=discontinuityReason(m.authoritative,v);
    if(!reason&&(seq<m.droppedThroughSeq||seq===m.droppedThroughSeq&&seqDt+1e-9<m.droppedThroughDt||actionSeq<m.droppedActionSeq))reason='history';
    m.authoritative=v;
    if(!m.enabled||state.phase!=='playing'||!previousView)return;
    m.reconciliations++;
    m.pending=m.pending.filter(p=>p.input.seq>=seq&&p.lifeId===v.lifeId);
    if(reason){m.pending=[];m.actionEdges=[];inputSending.history=[];}
    else for(const p of m.pending){
      const confirmed=p.input.seq===seq,dt=confirmed?Math.max(0,p.provisionalDt-seqDt):p.provisionalDt;
      if(dt<=1e-9)continue;
      if(confirmed)m.partialAcks++;
      // 部分適用の残りdtを作り、押下の消化は下の独立action ackで判断する。
      const input={...p.input,pressed:confirmed?{}:{...p.input.pressed}};
      // controlへ載せた押下はmovement seqでは消化を決めない。独立action ack後だけ捨てる。
      if(Number.isSafeInteger(p.input.actionSeq))for(const k of movementEdges)delete input.pressed[k];
      for(const edge of m.actionEdges)if(edge.needsReplay&&edge.seq<=p.input.seq){Object.assign(input.pressed,edge.pressed);edge.needsReplay=false;}
      if(typeof predictHumanMovement==='function'&&predictHumanMovement(player,input,dt)){m.replayedSteps++;m.replayedSeconds+=dt;}
    }
    m.pending=m.pending.filter(p=>p.input.seq>seq||p.provisionalDt>seqDt+1e-9);
    // 写真が来るまでに増えたマウス/右スティックの向きは見た目だけの遅延を付けない。
    if(!reason){player.yaw=previousView.yaw;player.pitch=previousView.pitch;}
    const distance=Math.sqrt(previousView.pos.distanceToSquared(player.pos));
    m.correctionCount++;m.correctionTotal+=distance;m.correctionMax=Math.max(m.correctionMax,distance);
    if(!reason&&distance>=.5)reason='distance';
    if(reason){
      delete player.onlineVisualOffset;m.visualFrames=0;m.hardSnaps++;m.hardSnapReasons[reason]=(m.hardSnapReasons[reason]||0)+1;
    }else{
      const offset=previousView.visualPos.clone().addScaledVector(player.pos,-1);
      // 小補正が重なっても0.5m以上を見た目の遅れとして蓄積しない。
      if(offset.distanceToSquared(vector([0,0,0]))<.25){player.onlineVisualOffset=offset;m.visualFrames=predictionLimits.visualFrames;}
      else {delete player.onlineVisualOffset;m.visualFrames=0;m.hardSnaps++;m.hardSnapReasons.accumulated=(m.hardSnapReasons.accumulated||0)+1;reason='accumulated';}
    }
    m.corrections.push({at:now(),distance,reason:reason||'smooth',seq,step:m.lastAckStep});if(m.corrections.length>1000)m.corrections.shift();
  }
  function decayPredictionVisual() {
    if(!player?.onlineVisualOffset)return;
    if(prediction.visualFrames<=1){delete player.onlineVisualOffset;prediction.visualFrames=0;return;}
    const frames=prediction.visualFrames--;player.onlineVisualOffset.multiplyScalar((frames-1)/frames);
  }
  function recordHostInputStep(u,input,dt) {
    if(state.role!=='host'||state.phase!=='playing'||u.controller!=='remoteHuman'||!Number.isSafeInteger(input?.seq)||!Number.isFinite(dt)||dt<=0||dt>.05)return;
    const p=state.peers.get(u.ownerPeerId);if(!p)return;
    p.pendingEdges={};
    if(p.activeAction){p.appliedActionSeq=p.activeAction.actionSeq;p.actionState=p.activeAction;p.actions=p.actions.filter(a=>a.actionSeq>p.appliedActionSeq);p.activeAction=null;}
    // 押下を適用したstepに発射しなかった場合、spin/装填待ち後に古い照準を復活させない。
    p.pendingShot=null;
    if(p.appliedSeq!==input.seq)p.appliedSeqDt=0;
    p.appliedSeq=input.seq;p.appliedSeqDt=(p.appliedSeqDt||0)+dt;p.appliedTotalDt=(p.appliedTotalDt||0)+dt;p.appliedStep=(p.appliedStep||0)+1;
    (p.appliedSteps||=[]).push({step:p.appliedStep,seq:input.seq,dt,seqDt:p.appliedSeqDt,actionSeq:p.appliedActionSeq||0,pressed:Object.keys(input.pressed||{}).filter(k=>input.pressed[k])});
    if(p.appliedSteps.length>predictionLimits.hostSteps)p.appliedSteps.shift();
  }

  const displayedLatencies = [];
  const remoteShells = new Map();
  const scalarKeys = ('lifeId hp maxHp alive respawnT downT downYaw reviveAcc yaw pitch boost maxBoost overheat boostIdle onGround dashT longDash dashState dodgeT flying ctrlLockT catCd weapon prevWeapon switchT moveInput scoped scopeStep planted charging chargerOn stun stunT tilt invulT invulCancelOnAttack recoil recoilYaw recoilWait recoilRecovery cameraRecoil cameraRecoilYaw weakT weakMult crouching actionHeld kneeSlideT lungeT lungeT0 lungeSpeed slideT recoverT electricT shockT jamT cannonDeploy repairing podT podN cloak vis shimmer cloakT actCd jumpBuf actionBlockBoost shockSlow zipCd flightSpeed').split(' ');
  const slotKeys = ('ammo reserve resMax reloadT cd spin temp ohT conv heat overheat bn held chargeT holdT cap supply').split(' ');
  const safe = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined && (typeof o[k] !== 'number' || Number.isFinite(o[k]))).map(k => [k,o[k]]));
  const unit = id => units.find(u => u.entityId === id);
  const lockId = e => e?.entityId || (e?.kind==='turret' ? 'turret:'+turrets.indexOf(e) : null);
  const lockEntity = id => typeof id==='string'&&id.startsWith('turret:') ? turrets[Number(id.slice(7))] : unit(id);
  function status(text) { state.status = text; state.onStatus?.(text, state); }
  function hostRoster() {
    return [{id:state.transport?.peer?.id||'host',name:state.transport?.displayName||'ホスト',cls:callbacks.cls==='heavy'?'heavy':'assault',team:state.hostTeam,host:true,ready:true},
      ...[...state.peers.values()].map(p=>({id:p.id,name:p.name||'ゲスト',cls:p.cls||'assault',team:p.team,host:false,ready:!!p.preferred}))];
  }
  function rosterChanged() {
    if(state.role==='host')state.roster=hostRoster();
    callbacks.onRoster?.(state.roster.map(p=>({...p})));
  }
  function lobbyChanged() {
    rosterChanged();callbacks.onSettings?.(state.settings?{...state.settings}:null,state.resolvedMapId);
    if(state.role==='host'&&state.phase==='lobby')state.transport?.broadcast('lobby',{settings:state.settings,resolvedMapId:state.resolvedMapId,roster:state.roster});
  }
  function checkedSettings(input) {
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('部屋の設定が正しくありません');
    const s={capacity:input.capacity,teamSize:input.teamSize,mapId:input.mapId,teamMode:input.teamMode};
    if(![2,3,4].includes(s.capacity))throw Error('人間の定員はホストを含め2〜4人です');
    if(!roomTeamSizes.includes(s.teamSize))throw Error('片軍の人数は人間とBotを合わせて2〜10機です');
    if(s.mapId!=='random'&&!roomMaps.some(m=>m.id===s.mapId))throw Error('通常コア戦のマップを選んでください');
    if(!['random','choice'].includes(s.teamMode))throw Error('チームはランダムか希望選択を選んでください');
    return s;
  }
  const resolveMap = id => id==='random'?roomMaps[Math.floor(Math.random()*roomMaps.length)].id:id;
  function requireHostLobby() { if(state.role!=='host'||state.phase!=='lobby')throw Error('待機中のホストだけが部屋を変更できます'); }
  function updateSettings(patch) {
    requireHostLobby();
    const next=checkedSettings({...state.settings,...patch}),roster=hostRoster();
    if(next.capacity<roster.length)throw Error('参加済みの人数より定員を小さくできません。先に退出してもらってください');
    if(['B','R'].some(t=>roster.filter(p=>p.team===t).length>next.teamSize))throw Error('現在のチーム人数が上限を超えます。先にチームを移動・シャッフルしてください');
    if(!state.transport.setCapacity(next.capacity))throw Error('通信側の定員を変更できませんでした');
    if(next.mapId!==state.settings.mapId)state.resolvedMapId=resolveMap(next.mapId);
    state.settings=next;lobbyChanged();status('部屋の設定を更新しました');return {...next};
  }
  function assignTeam(id,team) { if(id===state.transport.peer.id)state.hostTeam=team;else state.peers.get(id).team=team; }
  function setPlayerTeam(id,team) {
    requireHostLobby();
    if(state.settings.teamMode!=='choice')throw Error('ランダム設定ではチームを選べません');
    if(!['B','R'].includes(team))throw Error('チームを選んでください');
    const roster=hostRoster(),current=roster.find(p=>p.id===id);
    if(!current)throw Error('参加者が見つかりません');
    if(current.team===team)return true;
    if(roster.filter(p=>p.team===team).length>=state.settings.teamSize)throw Error('希望するチームは満員です');
    assignTeam(id,team);lobbyChanged();return true;
  }
  function chooseTeam(team) {
    if(state.phase!=='lobby'||state.settings?.teamMode!=='choice')throw Error('待機中の希望選択モードだけでチームを選べます');
    if(!['B','R'].includes(team))throw Error('チームを選んでください');
    if(state.role==='host')return setPlayerTeam(state.transport.peer.id,team);
    if(state.role==='guest')return state.transport.send('teamChoice',{team});
    return false;
  }
  function shuffleTeams() {
    requireHostLobby();
    const roster=hostRoster(),shuffled=roster.slice(),first=Math.random()<.5?'B':'R';
    for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    const next=shuffled.map((p,i)=>({id:p.id,team:i%2?(first==='B'?'R':'B'):first}));
    // 同じ並びを偶然引いた場合も、ボタンを押した結果が必ず変わる。
    if(next.every(p=>roster.find(r=>r.id===p.id).team===p.team))for(const p of next)p.team=p.team==='B'?'R':'B';
    for(const p of next)assignTeam(p.id,p.team);
    lobbyChanged();status('チームをシャッフルしました');return state.roster.map(p=>({...p}));
  }
  function requestsChanged() { callbacks.onRequests?.([...state.requests.values()].map(p=>({...p}))); }
  function approveGuest(id) {
    if(state.role!=='host'||state.phase!=='lobby')return false;
    return !!state.transport?.approvePeer(id);
  }
  function rejectGuest(id) {
    if(state.role!=='host'||state.phase!=='lobby')return false;
    const rejected=!!state.transport?.rejectPeer(id);
    if(rejected){state.requests.delete(id);requestsChanged();}return rejected;
  }
  function kickGuest(id) {
    if(state.role!=='host'||state.phase!=='lobby')return false;
    const reason='ホストがロビーから退出させました';
    const kicked=!!state.transport?.kickPeer(id,reason);
    if(kicked)peerLeft(id,reason);return kicked;
  }
  function localVersion() { return $('appVersion')?.textContent?.trim() || ''; }
  function preset(cls) { return Object.fromEntries(SLOTS.map(k => [k, CLASSES[cls][k]])); }
  function resetMeasurements() {
    snapshotEncoder=new CBOnlineCodec.Encoder();snapshotDecoder=new CBOnlineCodec.Decoder();lastResync=-Infinity;resyncBackoff=250;
    pendingPrepare=null;prepared=false;latestSnapshotWire=null;finalFrame=null;lastSnapshotBaseId=0;pendingSnapshotWires.clear();pendingSnapshotBases.clear();interpolation=interpolationState();
    resetPrediction();resetLagCompensation();
    state.frame = state.seq = 0; state.inputLatency = []; state.hitLatency = []; state.frameMs = []; state.sendMs = [];
    state.shots = []; state.pendingInputs.clear(); state.history = []; state.receivedEvents.clear(); state.events = [];
    state.lastSnapshot = null; state.lastSent = state.lastInput = 0; eventId = projectileId = 0; previousMove=previousTrigger=false; displayedLatencies.length=0;
  }
  function stopSessionAudio() { stopLoopingGameSounds(); bgmTick(); }
  function clearStartReservation() {
    state.startAtHost=state.startAtLocal=state.countdownNumber=null;
    $('announce').querySelector('[data-online-countdown]')?.remove();
  }
  function countdown(startAtHost) {
    const clock=state.role==='guest'?state.transport.clock():{offsetMs:0};
    if(!clock||!Number.isFinite(startAtHost)) { endGuest('開始時刻を確認できませんでした'); return; }
    clearTimeout(state.prepareTimer);state.prepareTimer=null;
    state.startAtHost=startAtHost;state.startAtLocal=startAtHost-clock.offsetMs;
    state.countdownNumber=null;state.actualStartAt=null;state.phase='countdown';running=false;ended=false;
    tutorialClearInput();stopSessionAudio();annReset();$('overlay').hidden=true;
    status('全員の準備が完了しました。開始を待っています');callbacks.onCountdown?.();
    countdownTick();
  }
  function countdownTick() {
    if(state.phase!=='countdown')return;
    const left=state.startAtLocal-now();
    if(left<=0){begin();return;}
    const number=Math.ceil(left/1000);
    if(number>3||number===state.countdownNumber)return;
    state.countdownNumber=number;
    // 通常出撃の「作戦開始」と同じアナウンス欄・infoの見た目。試合を進めず数字だけを置く。
    const box=$('announce');box.querySelector('[data-online-countdown]')?.remove();
    const d=document.createElement('div');d.className='info';d.dataset.onlineCountdown='';d.textContent=String(number);box.prepend(d);
    sfx('annInfo');
  }
  function reserveStart() {
    // 3秒の表示に加え1秒の配信猶予。ゲストはNTP式の時刻差で自分の時計へ変換する。
    const startAtHost=now()+4000;
    state.transport.broadcast('begin',{matchId:state.matchId,startAtHost});
    countdown(startAtHost);
  }
  function saveSettings() { if (!saved) saved = { mapId, chosenCls, chosenTeam, selectedTeamSize }; }
  // 初期装備・同じパーツを全機へ。保存用の構成には書き戻さない。
  function setupWorld(teamSize, localId, battleMapId, roster = null) {
    saveSettings(); running = false; tutorialClearInput(); stopSessionAudio();
    // 実際のB/R所属は保存したまま、生成前に自軍の色を選ぶ。施設だけでなく機体も自軍青になる。
    chosenTeam = localId.split(':')[0]; chosenCls = 'assault'; selectedTeamSize = teamSize;
    selectMap(battleMapId, false);
    const oldMech = { ...mechCfg }, oldBotMech = botMech;
    try { Object.assign(mechCfg, MECH_DEFAULT); botMech = () => ({...MECH_DEFAULT}); setup(); }
    finally { Object.assign(mechCfg, oldMech); botMech = oldBotMech; }
    for (const u of units) {
      u.entityId = u.team + ':' + u.idx;
      const r = roster?.find(x => x.id === u.entityId);
      const cls = r?.cls || (u.idx % 2 ? 'heavy' : 'assault');
      u.controller = 'bot'; u.localView = u.entityId === localId;
      u.isPlayer = u.localView; // 旧い外部試験から読む互換用。動作判定は3関数を使う。
      u.controlLoadout = preset(cls); u.cls = cls; u.nextCls = null;
      equip(u, cls); u.name = r?.name || `Bot ${u.team === 'B' ? 'A' : 'B'}${u.idx + 1}`;
      u.group.visible = true;
    }
    player = unit(localId); state.localUnitId = localId;
    if (!player) throw Error('自機の割り当てがありません');
    player.localView = true; player.isPlayer = true;
    chosenTeam = player.team; chosenCls = player.cls; renderTeamView();
    ended = false; running = false; releaseLock(); resetCombatFeedback();
    $('overlay').hidden = true;
  }
  function transportOptions(opts) {
    state.onStatus = opts.onStatus || null; callbacks = opts;prediction.enabled=opts.predictionEnabled!==false;
    return { appVersion: opts.appVersion || localVersion(), peerOptions: opts.peerOptions, latencyMs: opts.latencyMs || 0, snapshotDropRate:opts.snapshotDropRate || 0, inputDropRate:opts.inputDropRate||0,inputRandom:opts.inputRandom,displayName: opts.displayName, capacity:state.settings?.capacity||4,
      onStatus: msg => status(typeof msg === 'string' ? msg : JSON.stringify(msg)),
      onPeerRequest: (id,name) => {
        if(state.role!=='host'||state.phase!=='lobby'){state.transport?.rejectPeer(id,'ロビー以外では入室できません');return;}
        // オーナーの指定 2026-11-08：入室承認は省く。申請が来たら自動で許可する（満員などは approvePeer が断る）。追い出しはキックで。
        if(approveGuest(id))status('「'+(name||'ゲスト')+'」が入室しました');
      },
      onRequestClosed: id => {state.requests.delete(id);requestsChanged();},
      onPeerJoin: (id,name) => {
        if (state.role !== 'host') return;
        if (state.phase !== 'lobby') { state.transport.disconnectPeer(id,'試合中は参加できません'); return; }
        state.requests.delete(id);requestsChanged();
        const roster=hostRoster(),team=roster.filter(p=>p.team==='B').length<=roster.filter(p=>p.team==='R').length?'B':'R';
        state.peers.set(id, { id, name:name||'ゲスト', team, ready:false, input:null, receivedSeq:0, appliedSeq:0, last:now(), pendingEdges:{}, unitId:null });
        status(`参加者 ${state.peers.size + 1} 人`); lobbyChanged();
      },
      onPeerLeave: (id, reason) => peerLeft(id, reason), onMessage: onMessage };
  }
  async function create(opts = {}) {
    const settings=checkedSettings({...defaultSettings,...opts.settings});
    leave('部屋を作り直す'); saveSettings(); resetMeasurements(); state.role = 'host'; state.phase = 'lobby'; running=false; stopSessionAudio();
    lagEnabled=opts.lagCompensationEnabled!==false;
    state.settings=settings;state.resolvedMapId=resolveMap(settings.mapId);state.hostTeam='B';
    setSimulationRole('host'); state.transport = new CBOnlineTransport(transportOptions(opts));
    const transport=state.transport,id=await transport.createRoom();
    if(state.transport!==transport||state.phase!=='lobby')throw Error('部屋の作成を取り消しました');
    state.roomId = id; lobbyChanged();status('部屋を作成しました：' + id); return id;
  }
  async function join(roomId, opts = {}) {
    leave('接続を作り直す'); saveSettings(); resetMeasurements(); state.role = 'guest'; state.phase = 'lobby'; running=false; stopSessionAudio();
    setSimulationRole('guest'); state.transport = new CBOnlineTransport(transportOptions(opts));
    const transport=state.transport;
    await transport.connect(roomId);
    if(state.transport!==transport||state.phase!=='lobby')throw Error('入室を取り消しました');
    state.roomId = roomId;
    await transport.waitForClock();
    if(state.transport!==transport||state.phase!=='lobby')throw Error('入室を取り消しました');
    await new Promise((resolve,reject)=>{
      preferenceResolve=resolve;preferenceReject=reject;preferenceTimer=setTimeout(()=>{preferenceResolve=preferenceReject=null;preferenceTimer=null;reject(Error('兵装の確認が時間切れになりました'));},10000);
      transport.send('preference', {cls:opts.cls === 'heavy' ? 'heavy' : 'assault'});
    });
    if(state.transport!==transport||['ended','leaving','idle'].includes(state.phase))throw Error('入室を取り消しました');
    if(state.phase==='lobby')status('ホストの開始を待っています');
  }
  function start(options = {}) {
    if (state.role !== 'host' || state.phase !== 'lobby') throw Error('待機中のホストだけが開始できます');
    if (state.peers.size < 1 || state.peers.size + 1 > state.settings.capacity) throw Error('定員内の人間2〜4人で開始してください');
    if(![...state.peers.values()].every(p=>p.preferred))throw Error('ゲストの兵装確認を待ってください');
    if(state.transport.canStartMatch&&!state.transport.canStartMatch())throw Error('写真用の通信経路の準備を待ってください');
    if(options.teamSize!==undefined&&options.teamSize!==state.settings.teamSize)updateSettings({teamSize:options.teamSize});
    checkedSettings(state.settings);
    if(state.settings.teamMode==='random')shuffleTeams();
    const teamSize=state.settings.teamSize,roster=hostRoster(),counts={B:0,R:0};
    if(['B','R'].some(t=>roster.filter(p=>p.team===t).length>teamSize))throw Error('チームの人間数が片軍の人数を超えています');
    const assignments=roster.map(p=>({...p,unitId:p.team+':'+counts[p.team]++}));
    const host=assignments.find(p=>p.host);
    clearStartReservation();state.actualStartAt=null;running=false;stopSessionAudio();
    state.phase = 'preparing';
    clearTimeout(state.prepareTimer);state.prepareTimer=setTimeout(()=>{if(state.role==='host'&&state.phase==='preparing')abortPreparation('ゲストの読み込みが15秒以内に完了しなかったため、開始を中止しました');},15000);
    state.matchId = 'match-' + Date.now().toString(36); state.teamSize = teamSize;resetLagCompensation();
    state.transport.startMatch(state.matchId); setupWorld(teamSize,host.unitId,state.resolvedMapId); player.controller = 'localHuman'; player.name = host.name; player.controlLoadout=preset(host.cls); equip(player,host.cls);
    for (const p of state.peers.values()) {
      p.unitId = assignments.find(r=>r.id===p.id).unitId; p.ready = false; p.last = now(); p.joinedAt = now();
      const u = unit(p.unitId); u.controller = 'remoteHuman'; u.ownerPeerId = p.id;
      u.name = p.name; u.controlLoadout = preset(p.cls || 'assault'); equip(u,p.cls || 'assault');
    }
    const initial=snapshotEncoder.encode(snapshot());latestSnapshotWire={frame:state.frame,delta:initial.delta};
    for (const p of state.peers.values()) {
      p.lastResync=-Infinity;
      // 開始条件だけを制御線へ。大きな初期基準も写真専用線に載せ、復元できてからreadyにする。
      if(!state.transport.send('prepare', {matchId:state.matchId, teamSize, mapId:state.resolvedMapId, localId:p.unitId},p.id)||
         !state.transport.send('snapshotBase',initial.baseline,p.id)||!state.transport.send('snapshot',latestSnapshotWire,p.id)){
        abortPreparation('初期状態が送信上限を超えたため開始できません');return;
      }
    }
    status('ゲストの読み込みを待っています');
  }
  function begin() {
    if(state.phase!=='countdown')return;
    state.actualStartAt=now();state.countdownNumber=0;$('announce').querySelector('[data-online-countdown]')?.remove();tutorialClearInput();
    clearTimeout(state.prepareTimer);state.prepareTimer=null;
    state.phase = 'playing'; running = true; ended = false; state.lastHost = now();
    // 読み込み＋4秒の開始待ちを回線jitterに数えない。初期状態は残し、対戦中の写真で描画時計を始める。
    if(state.role==='guest'){
      lastRenderedView=null;
      state.history=[];Object.assign(interpolation,{delayMs:100,targetDelayMs:100,intervalMs:50,jitterMs:0,lastArrival:null,lastRender:null,renderTime:null,localOffset:null});
    }
    // 早く準備できたゲストも、全員の開始時点から入力待機の猶予を持つ。
    if (state.role === 'host') for (const p of state.peers.values()) p.last = state.lastHost;
    $('overlay').hidden = true; annReset(); announce('作戦開始', 'info'); callbacks.onStarted?.();
  }
  function onMessage(type, data, peerId) {
    if(handleSnapshotControl(type,data,peerId))return;
    if (state.role === 'host') {
      const p = state.peers.get(peerId); if (!p) return;
      if (type === 'preference' && state.phase === 'lobby') {p.cls = data?.cls === 'heavy' ? 'heavy' : 'assault';p.preferred=true;state.transport.send('preferenceAck',{cls:p.cls},peerId);lobbyChanged();}
      if(type==='teamChoice'){
        try{setPlayerTeam(peerId,data?.team);state.transport.send('teamChoiceResult',{ok:true},peerId);}
        catch(e){state.transport.send('teamChoiceResult',{ok:false,reason:e.message},peerId);}
      }
      if (type === 'ready' && state.phase === 'preparing' && data?.matchId === state.matchId) {
        p.ready = true; p.last = now();
        if ([...state.peers.values()].every(x => x.ready)) reserveStart();
      }
      if(type==='inputBatch'&&state.phase==='playing')acceptInputBatch(p,data);
      if(type==='inputActions'&&state.phase==='playing')acceptInputActions(p,data);
      if (type === 'leave') peerLeft(peerId, data?.reason || '退出');
      return;
    }
    if (state.role !== 'guest') return;
    if(type==='lobby'&&state.phase==='lobby'){
      try{
        const settings=checkedSettings(data?.settings);
        if(!roomMaps.some(m=>m.id===data.resolvedMapId)||!Array.isArray(data.roster)||data.roster.length>settings.capacity||data.roster.some(p=>typeof p.id!=='string'||typeof p.name!=='string'||!['B','R'].includes(p.team)))throw Error('部屋の参加者情報が正しくありません');
        state.settings=settings;state.resolvedMapId=data.resolvedMapId;state.roster=data.roster.map(p=>({...p}));lobbyChanged();
      }catch(e){endGuest(e.message);}return;
    }
    if(type==='teamChoiceResult'){status(data?.ok?'希望するチームへ移動しました':data?.reason||'チームを変更できませんでした');return;}
    if(type==='preferenceAck'){clearTimeout(preferenceTimer);preferenceTimer=null;preferenceResolve?.();preferenceResolve=preferenceReject=null;return;}
    if (type === 'reject' || type === 'endHost') { endGuest(data?.reason || 'ホストが退出しました'); return; }
    if (type === 'prepare' && state.phase === 'lobby') {
      if(!data||typeof data!=='object'||Array.isArray(data)||!state.settings||typeof data.matchId!=='string'||!data.matchId||data.matchId.length>128||data.teamSize!==state.settings.teamSize||data.mapId!==state.resolvedMapId||!roomMaps.some(m=>m.id===data.mapId)||typeof data.localId!=='string'||!/^[BR]:(0|[1-9][0-9]*)$/.test(data.localId)||Number(data.localId.slice(2))>=data.teamSize){endGuest('開始するマップ・人数が部屋の設定と一致しません');return;}
      state.matchId = data.matchId; state.teamSize = data.teamSize;pendingPrepare=data;state.phase='preparing';
      // 制御線だけ先着しても正常な初回写真を重複要求しない。最初の250msは待つ。
      lastResync=now();resyncBackoff=250;retryPendingSnapshots();
    } else if (type === 'begin' && state.phase==='preparing' && prepared && data?.matchId === state.matchId) { countdown(data.startAtHost); }
    else if (type === 'snapshot' && ['lobby','preparing','countdown','playing'].includes(state.phase)) receiveSnapshot(data);
    else if (type === 'matchEnded') receiveMatchEnded(data);
    else if (type === 'events' && state.phase === 'playing') playEvents(data);
  }
  function validInput(v) {
    if (!v || !Number.isSafeInteger(v.seq) || v.seq < 1 || !Number.isFinite(v.yaw) || !Number.isFinite(v.pitch)) return false;
    if (!Array.isArray(v.aimPoint) || v.aimPoint.length !== 3 || !v.aimPoint.every(n => Number.isFinite(n) && Math.abs(n)<1e6)) return false;
    return ['fwd','side','cameraRecoil','cameraRecoilYaw'].every(k => v[k] == null || Number.isFinite(v[k]));
  }
  const inputKeys = ['KeyW','KeyS','KeyA','KeyD','KeyR','KeyC','KeyF','KeyH','KeyE','ShiftLeft','ShiftRight','Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Digit1','Digit2','Digit3','Digit4'];
  const pickedKeys=(o,allowed=inputKeys)=>Object.fromEntries(allowed.filter(k=>o?.[k]).map(k=>[k,true]));
  function currentInputLife(p,v) {
    const u=unit(p.unitId),age=now()-v?.sentAt;
    if(!u||v.lifeId!==u.lifeId||!Number.isFinite(v.sentAt)||age>inputLimits.maxAgeMs||age< -inputLimits.futureMs)return null;
    if(p.inputLifeId!==u.lifeId){
      p.inputLifeId=u.lifeId;p.input=null;p.inputTimes=[];p.inputHistoryTruncated=false;p.firstInputAt=null;p.pendingEdges={};p.actions=[];p.actionState=null;p.activeAction=null;p.pendingShot=null;p.shotActionSeq=0;
    }
    return u;
  }
  function acceptInput(p,v) {
    if(!validInput(v)||v.seq<=p.receivedSeq||!currentInputLife(p,v))return;
    p.receivedSeq=v.seq;p.last=now();
    p.firstInputAt??=now();(p.inputTimes||=[]).push({seq:v.seq,at:now()});while(p.inputTimes.length>120){p.inputTimes.shift();p.inputHistoryTruncated=true;}
    // dt/射撃/武器/押下はこの線から受け付けない。入力番号を増やしてもhostのframe dtは増えない。
    p.input={...safe(v,['seq','lifeId','sentAt','actionSeq','yaw','pitch','cameraRecoil','cameraRecoilYaw']),keys:pickedKeys(v.keys,movementKeys),pressed:{},
      fwd:clamp(v.fwd||0,-1,1),side:clamp(v.side||0,-1,1),aimPoint:v.aimPoint,lockTarget:typeof v.lockTarget==='string'?v.lockTarget:null,
      receivedAt:now(),view:v.view?safe(v.view,['time','frame','delayMs']):null};
  }
  function acceptInputBatch(p,data) {
    if(!Array.isArray(data?.inputs)||!data.inputs.length||data.inputs.length>inputLimits.batch)return;
    // 逆順batchでも各入力番号で判断。過去batchが最新入力を巻き戻すことはない。
    for(const input of data.inputs.slice().sort((a,b)=>(a?.seq||0)-(b?.seq||0)))acceptInput(p,input);
  }
  function actionIsRecent(p,action) {
    if(now()-action.sentAt>inputLimits.maxAgeMs||now()-(action.receivedAt??now())>inputLimits.maxAgeMs)return false;
    if(action.seq>p.receivedSeq)return true;
    const times=p.inputTimes||[];
    // clientの時計だけを信用しない。hostが見た同番号/直後の入力が古いか、履歴より前なら失効。
    if(!times.length)return false;
    if(action.seq<times[0].seq)return !p.inputHistoryTruncated&&now()-(action.receivedAt??p.firstInputAt)<=inputLimits.maxAgeMs;
    const observed=times.find(t=>t.seq>=action.seq);return !!observed&&now()-observed.at<=inputLimits.maxAgeMs;
  }
  function acceptInputActions(p,v) {
    if(!v||!Number.isSafeInteger(v.actionSeq)||v.actionSeq<1||v.actionSeq<=(p.receivedActionSeq||0)||!Number.isSafeInteger(v.seq)||v.seq<1)return;
    const u=currentInputLife(p,v);if(!u||!actionIsRecent(p,v))return;
    p.receivedActionSeq=v.actionSeq;p.last=now();
    const action={...safe(v,['actionSeq','seq','lifeId','sentAt']),receivedAt:now(),trigger:!!v.trigger,alt:!!v.alt,keys:pickedKeys(v.keys,inputKeys.filter(k=>!movementKeys.includes(k))),
      pressed:pickedKeys(v.pressed),wheel:Math.sign(v.wheel||0),weapon:SLOTS.includes(v.weapon)?v.weapon:undefined};
    if(validInput(v))Object.assign(action,safe(v,['yaw','pitch','cameraRecoil','cameraRecoilYaw']),{aimPoint:v.aimPoint.slice(),view:v.view?safe(v.view,['time','frame','delayMs']):null});
    (p.actions||=[]).push(action);while(p.actions.length>inputLimits.actions)p.actions.shift();
    // 再出撃先の選択は移動の実行を待たず受理する。古い命の選択はcurrentInputLifeが落とす。
    if(!u.alive||u.transfer){
      if(spawnPoints(u.team).some(x=>x.id===v.spawnChoice))u.spawnChoice=v.spawnChoice;
      if(['assault','heavy'].includes(v.nextCls)){u.nextCls=v.nextCls;u.controlLoadout=preset(v.nextCls);}
    }
  }
  function sendLocalInput(input) {
    const clock=state.transport.clock?.(),sentAt=now()+(Number.isFinite(clock?.offsetMs)?clock.offsetMs:0);
    input.lifeId=player.lifeId;input.sentAt=sentAt;
    // 入力を取った時点で既に描き終わっている写真。今frameの未描画renderTimeとは区別する。
    input.view=lastRenderedView?{...lastRenderedView}:null;
    if(inputSending.lifeId!==input.lifeId){inputSending.history=[];inputSending.signature=null;inputSending.lifeId=input.lifeId;}
    const actionKeys=pickedKeys(input.keys,inputKeys.filter(k=>!movementKeys.includes(k))),edges=pickedKeys(input.pressed);
    const signature=JSON.stringify([input.lifeId,!!input.trigger,!!input.alt,actionKeys,input.spawnChoice,input.nextCls]);
    // 古いcontrolが期限切れなら、現在のheld状態だけを新番号で再送する。失効した押下は複製しない。
    const refresh=inputSending.actionSeq>prediction.lastAckActionSeq&&now()-inputSending.lastActionAt>=inputLimits.maxAgeMs;
    if(signature!==inputSending.signature||Object.keys(edges).length||input.wheel||input.weapon||refresh){
      const action={seq:input.seq,lifeId:input.lifeId,sentAt,actionSeq:++inputSending.actionSeq,trigger:!!input.trigger,alt:!!input.alt,keys:actionKeys,pressed:edges,
        wheel:Math.sign(input.wheel||0),weapon:input.weapon,spawnChoice:input.spawnChoice,nextCls:input.nextCls,
        ...safe(input,['yaw','pitch','cameraRecoil','cameraRecoilYaw']),aimPoint:input.aimPoint.slice(),view:input.view};
      input.actionSeq=action.actionSeq;
      if(!state.transport.send('inputActions',action)){endGuest('操作の送信ができないため対戦を中断しました');return false;}
      inputSending.signature=signature;inputSending.lastActionAt=now();
    }
    input.actionSeq=inputSending.actionSeq;
    const movement={...safe(input,['seq','lifeId','sentAt','actionSeq','yaw','pitch','cameraRecoil','cameraRecoilYaw','fwd','side']),keys:pickedKeys(input.keys,movementKeys),
      aimPoint:input.aimPoint,lockTarget:input.lockTarget,view:input.view};
    inputSending.history.push(movement);while(inputSending.history.length>inputLimits.batch)inputSending.history.shift();
    // 144/240Hzの描画でも予測dtは変えず、送信だけ最大60Hz。one-shotは別control線で保持する。
    if(now()-inputSending.lastBatch>=inputLimits.sendMs-.001){
      state.transport.send('inputBatch',{inputs:inputSending.history.map(v=>({...v,keys:{...v.keys},aimPoint:v.aimPoint.slice()}))});inputSending.lastBatch=now();
    }
    return true;
  }
  function remoteInput(u) {
    const p=state.peers.get(u.ownerPeerId);
    if(p&&p.inputLifeId!==u.lifeId){p.input=null;p.pendingEdges={};p.actions=[];p.activeAction=null;p.actionState=null;p.pendingShot=null;p.shotActionSeq=0;}
    if(!p||!p.input||now()-p.input.sentAt>250||now()-p.last>250){
      if(p){p.pendingEdges={};p.activeAction=null;p.actions=(p.actions||[]).filter(a=>actionIsRecent(p,a));}
      u.controlTarget=null;return {keys:{},pressed:{},trigger:false,alt:false,yaw:u.yaw,pitch:u.pitch,aimPoint:u.aimPos?.toArray()||u.pos.clone().addScaledVector(fwdOf(u),100).toArray()};
    }
    const target=lockEntity(p.input.lockTarget);
    u.controlTarget=target&&target.alive&&!target.downT&&target.team!==u.team&&!target.cloak&&lockAllowed(u)&&target.pos.distanceTo(u.pos)<=u.lockRange*1.15*spotMul(u.team,target)&&canSee(u,target,targetPoint(target))?target:null;
    p.actions=(p.actions||[]).filter(a=>a.lifeId===u.lifeId&&actionIsRecent(p,a));
    // action先着は対応する移動番号まで待つ。後着も一度だけ実updateへ。dead中はqueueを消化しない。
    p.activeAction=p.actions.find(a=>a.seq<=p.input.seq)||null;
    // reliableの射撃端だけは、その時に見た照準と写真を対で保持する。移動/yawは最新入力のまま。
    // releaseで発射する充填銃にも同じ規則。実shotが無ければこのstepのack時に捨てる。
    if(p.pendingShot&&(p.pendingShot.lifeId!==u.lifeId||!actionIsRecent(p,p.pendingShot)))p.pendingShot=null;
    if(p.activeAction&&p.activeAction.actionSeq>(p.shotActionSeq||0)&&p.activeAction.trigger!==!!p.actionState?.trigger){
      p.shotActionSeq=p.activeAction.actionSeq;p.pendingShot=p.activeAction.aimPoint?p.activeAction:null;
    }
    // movementで新しいactionの存在が判ったら、遅いcontrolを待つ間は古いtriggerを保持しない。
    const action=p.activeAction||(p.input.actionSeq<=(p.actionState?.actionSeq||0)?p.actionState:null);
    const result={...p.input,keys:{...p.input.keys,...action?.keys},trigger:!!action?.trigger,alt:!!action?.alt,
      pressed:{...p.pendingEdges,...(p.activeAction?.pressed||{})},wheel:p.activeAction?.wheel||0,weapon:p.activeAction?.weapon||undefined};
    u.onlineInputSeq=p.receivedSeq;return result;
  }
  function abortPreparation(reason) {
    clearStartReservation();
    clearTimeout(state.prepareTimer);state.prepareTimer=null;
    state.transport?.broadcast('endHost',{reason});
    clearPrediction();state.phase='ended';running=false;ended=true;tutorialClearInput();stopSessionAudio();
    $('ovTitle').textContent='オンライン対戦を中断';$('ovText').textContent=reason;showPage('pgMenu');$('overlay').hidden=false;document.exitPointerLock?.();
    status(reason);callbacks.onEnded?.(reason);
  }
  function peerLeft(id, reason) {
    if (state.role === 'guest') { if (!['ended','leaving'].includes(state.phase)) endGuest(reason || 'ホストとの通信が切れました'); return; }
    const p = state.peers.get(id); if (!p) return;
    const preparing=['preparing','countdown'].includes(state.phase);
    if(preparing)abortPreparation('準備中にゲストが退出したため、開始を中止しました');
    const u = unit(p.unitId);
    if (u) { u.controller = 'bot'; u.ownerPeerId = null; u.controlInput = {}; u.controlTarget = null; u.actionHeld = false; u.actionBlockBoost = false; u.onlineInputSeq = 0; }
    state.peers.delete(id); lobbyChanged(); state.disconnected.push({peer:id,reason,time:now()}); if(!preparing)status(state.phase==='lobby'?'参加者がロビーから退出しました':'ゲストが退出しました。Botが引き継ぎます');
  }
  function endGuest(reason) {
    clearStartReservation();
    clearPrediction();state.phase = 'ended'; running = false; ended = true; tutorialClearInput();stopSessionAudio();
    status(reason); callbacks.onEnded?.(reason); $('ovTitle').textContent = 'オンライン対戦を中断'; $('ovText').textContent = reason;
    showPage('pgMenu'); $('overlay').hidden = false; document.exitPointerLock?.();
  }
  function leave(reason = '退出') {
    clearStartReservation();clearPrediction();resetLagCompensation();running=false;stopSessionAudio();
    clearTimeout(state.prepareTimer);state.prepareTimer=null;
    clearTimeout(preferenceTimer);preferenceTimer=null;preferenceReject?.(Error(reason));preferenceResolve=preferenceReject=null;
    const t = state.transport;
    state.phase = 'leaving';
    if (t) { if (state.role === 'host') t.broadcast('endHost',{reason}); else t.send('leave',{reason}); t.close(reason); }
    state.transport = null; state.role = 'offline'; state.phase = 'idle'; state.peers.clear();state.requests.clear();state.settings=null;state.roster=[];state.resolvedMapId=null;state.roomId=null;requestsChanged();lobbyChanged(); state.events=[]; state.history=[];
    for (const mesh of remoteShells.values()) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); } remoteShells.clear();
    setSimulationRole('offline');
    if (saved) {
      running = false; ended = true; tutorialClearInput(); chosenCls = saved.chosenCls; chosenTeam = saved.chosenTeam; selectedTeamSize = saved.selectedTeamSize;
      selectMap(saved.mapId,false); saved = null; $('overlay').hidden = false;
    }
  }
  function packUnit(u) {
    return {id:u.entityId,team:u.team,idx:u.idx,cls:u.cls,name:u.name,controller:u.controller,mech:u.mech,motionEpoch:u.onlineMotionEpoch||0,lagEpoch:u.onlineLagEpoch||0,renderCrouch:u.rig?.crouch||0,
      ...safe(u,scalarKeys),pos:u.pos.toArray(),vel:u.vel.toArray(),predictionBlocked:typeof movementPredictionBlockReason==='function'?movementPredictionBlockReason(u):'',
      motionVectors:Object.fromEntries(['dashDir','boostVisualDir','catMomentum','lungeDir'].map(k=>[k,u[k]?.toArray()||null])),
      catLaunch:u.catLaunch?{...u.catLaunch}:null,jumpPadIndex:u.jumpPad?jumpPads.indexOf(u.jumpPad):-1,sc:{...u.sc},zipLine:u.zip?ziplines.indexOf(u.zip.line):-1,
      swing:u.swing ? {a:u.swing.a,...safe(u.swing,['t','phi','yaw0','aimed','tilt','slope','pike','chargeStage','chargeRatio','dashAttack','stopped','queued'])} : null,
      transfer:u.transfer ? safe(u.transfer,['t','base','at']) : null,
      slots:Object.fromEntries(SLOTS.map(k=>[k,{key:u.slots[k].w.key,...safe(u.slots[k],slotKeys)}]))};
  }
  function snapshot(stateTime=now()) {
    const s={frame:state.frame,time:stateTime,timeLeft,running,ended,teamSize:state.teamSize,units:units.map(packUnit),
      cores:{B:cores.B.hp,R:cores.R.hp},
      spotted:Object.fromEntries(['B','R'].map(k=>[k,[...spotted[k]].filter(([u])=>u.entityId).map(([u,left])=>[u.entityId,left])])),
      spotSrc:Object.fromEntries(['B','R'].map(k=>[k,[...spotSrc[k]].filter(([u])=>u.entityId).map(([u,m])=>[u.entityId,[...m]])])),
      plants:plants.map(p=>safe(p,['id','owner','gauge','capturing','contested'])),
      turrets:turrets.map(p=>safe(p,['hp','alive','yaw','revive','team'])),radars:radars.map(p=>({...safe(p,['hp','alive','revive']),headYaw:p.head.rotation.y,intruders:p.intruders.map(u=>u.entityId)})),
      barricades:barricades.map(p=>safe(p,['hp','alive'])),
      mobility:{lifts:lifts.map(l=>({pos:l.pos.toArray(),direction:l.direction,waitT:l.waitT,blocked:l.blocked})),
        jumpPads:jumpPads.map(p=>p.flash),catapults:catapults.map(p=>({flash:p.flash,opacity:p.film.material.opacity}))},
      shells:shells.map(s=>({id:s.onlineId||(s.onlineId=++projectileId),pos:s.pos.toArray(),vel:s.vel.toArray(),rocket:!!s.spec.rocket,weak:!!s.spec.weak,team:s.team})),
      acks:Object.fromEntries([...state.peers.values()].map(p=>[p.unitId,p.appliedSeq])),
      inputAcks:Object.fromEntries([...state.peers.values()].map(p=>[p.unitId,{seq:p.appliedSeq||0,step:p.appliedStep||0,seqDt:p.appliedSeqDt||0,actionSeq:p.appliedActionSeq||0,totalDt:p.appliedTotalDt||0,
        // 写真以前のdtをもう一度適用しない。写真欠落後も累積境界だけで復元でき、最近8stepは検証用に残す。
        steps:(p.appliedSteps||[]).slice(-predictionLimits.wireSteps)}]))};
    if(state.role==='host')rememberLagSnapshot(s);return s;
  }
  function applyUnit(u,s) {
    const mechChanged=!!s.mech&&Object.keys(s.mech).some(k=>s.mech[k]!==u.mech?.[k]);
    if(mechChanged)u.mech={...s.mech};
    if (mechChanged || u.cls !== s.cls || SLOTS.some(k=>s.slots[k]?.key!==u.slots[k]?.w.key)) {
      u.controlLoadout=Object.fromEntries(SLOTS.map(k=>[k,WEAPONS[s.slots[k]?.key]?s.slots[k].key:CLASSES[s.cls][k]]));equip(u,s.cls);
    }
    const localYaw = u.yaw, localPitch = u.pitch;
    u.onlineMotionEpoch=s.motionEpoch||0;u.onlineLagEpoch=s.lagEpoch||0;u.onlinePredictionBlocked=s.predictionBlocked||'';
    u.onlineRenderCrouch=Number.isFinite(s.renderCrouch)?s.renderCrouch:null;
    for(const k of ['dashDir','boostVisualDir','catMomentum','lungeDir'])u[k]=s.motionVectors?.[k]?vector(s.motionVectors[k]):null;
    u.catLaunch=s.catLaunch?{...s.catLaunch}:null;u.jumpPad=s.jumpPadIndex>=0?jumpPads[s.jumpPadIndex]||null:null;
    u.localView=u===player;u.controller=u.localView?'localHuman':s.controller==='bot'?'bot':'remoteHuman';
    for(const k of scalarKeys)if(!Object.hasOwn(s,k))delete u[k];
    Object.assign(u,safe(s,scalarKeys)); u.pos.fromArray(s.pos); u.vel.fromArray(s.vel); Object.assign(u.sc,s.sc);
    if (u === player && !prediction.enabled) {u.yaw=localYaw; u.pitch=localPitch;} // 比較試験で予測を切った場合も視点は即時。
    u.swing=s.swing?{...s.swing,hit:new Set()}:null;
    u.zip=Number.isInteger(s.zipLine)&&s.zipLine>=0&&ziplines[s.zipLine]?{line:ziplines[s.zipLine]}:null;
    u.name=s.name; u.group.visible=u.alive || u.downT>0; u.transfer=s.transfer?{...s.transfer}:null;
    for (const k of SLOTS) if (s.slots[k]) {for(const field of slotKeys)if(!Object.hasOwn(s.slots[k],field))delete u.slots[k][field];Object.assign(u.slots[k],safe(s.slots[k],slotKeys));}
  }
  function member(list,item,on) { const i=list.indexOf(item);if(on&&i<0)list.push(item);else if(!on&&i>=0)list.splice(i,1); }
  // 壊れた施設は元の destroy 関数と同じ見た目・照準判定にする。得点やダメージは再実行しない。
  function applyFacilities(s) {
    s.turrets.forEach((v,i)=>{const p=turrets[i];if(!p)return;Object.assign(p,v);p.head.visible=v.alive;p.head.rotation.y=v.yaw;
      p.baseMat.color.setHex(v.alive?TURRET_BASE:0x26282b);p.base.userData.ref=v.alive?p:null;
      for(const m of p.parts)member(hittables,m,v.alive);
    });
    s.radars.forEach((v,i)=>{const p=radars[i];if(!p)return;Object.assign(p,safe(v,['hp','alive','revive']));p.head.visible=v.alive;p.head.rotation.y=v.headYaw||0;
      p.baseMat.color.setHex(v.alive?RADAR_BODY:0x26282b);for(const m of p.body)m.userData.ref=v.alive?p:null;member(hittables,p.dish,v.alive);
      p.intruders=(v.intruders||[]).map(unit).filter(Boolean);
    });
    s.barricades.forEach((v,i)=>{const p=barricades[i];if(!p)return;Object.assign(p,v);p.mesh.visible=v.alive;
      const k=Math.max(0,p.hp/p.maxHp);p.mat.color.setRGB(.45+.55*k,.4+.6*k,.38+.62*k);
      member(hittables,p.mesh,v.alive);member(obstacles,p.ob,v.alive);
      if(v.alive&&!p.mesh.parent)mapRoot.add(p.mesh);else if(!v.alive&&p.mesh.parent)mapRoot.remove(p.mesh);
    });
  }
  function applySnapshot(s) {
    for (const v of s.units) {const u=unit(v.id); if(u)applyUnit(u,v);}
    cores.B.hp=s.cores.B; cores.R.hp=s.cores.R; timeLeft=s.timeLeft;
    for(const k of ['B','R']){
      spotted[k].clear();spotSrc[k].clear();
      for(const [id,left] of s.spotted?.[k]||[]){const u=unit(id);if(u)spotted[k].set(u,left);}
      for(const [id,list] of s.spotSrc?.[k]||[]){const u=unit(id);if(u)spotSrc[k].set(u,new Map(list));}
    }
    for(const v of s.plants){const p=plants.find(p=>p.id===v.id);if(p){Object.assign(p,v);paintPlant(p);}}
    applyFacilities(s);
    // ホスト確定の施設位置・発光のみ反映。乗客移動/接触/射出の物理はゲストで行わない。
    for(const [i,v] of (s.mobility?.lifts||[]).entries()){const l=lifts[i];if(l){setLiftPosition(l,vector(v.pos));l.direction=v.direction;l.waitT=v.waitT;l.blocked=v.blocked;}}
    for(const [i,flash] of (s.mobility?.jumpPads||[]).entries()){const p=jumpPads[i];if(p){p.flash=flash;p.ring.scale.setScalar(1+flash*.12);}}
    for(const [i,v] of (s.mobility?.catapults||[]).entries()){const p=catapults[i];if(p){p.flash=v.flash;p.film.material.opacity=v.opacity;}}
    const alive=new Set(s.shells.map(x=>x.id));
    for(const [id,m] of remoteShells)if(!alive.has(id)){scene.remove(m);m.geometry.dispose();m.material.dispose();remoteShells.delete(id);}
    for(const sh of s.shells){let m=remoteShells.get(sh.id);if(!m){m=new T.Mesh(sh.rocket?new T.CylinderGeometry(.2,.2,1.4,8):new T.SphereGeometry(.4,8,6),new T.MeshBasicMaterial({color:sh.weak?0xa070ff:BALLISTIC_COLOR}));remoteShells.set(sh.id,m);scene.add(m);}m.position.fromArray(sh.pos);if(sh.rocket&&sh.vel.some(n=>n))m.quaternion.setFromUnitVectors(UP,vector(sh.vel).normalize());}
  }
  function requestSnapshotResync() {
    if(state.role!=='guest'||finalFrame!==null||!['preparing','countdown','playing'].includes(state.phase))return;
    if(prepared&&!pendingSnapshotWires.size&&!pendingSnapshotBases.size)return;
    const t=now();if(t-lastResync<resyncBackoff)return;
    if(state.transport.send('snapshotResync',{})){lastResync=t;resyncBackoff=Math.min(2000,resyncBackoff*2);interpolation.resyncRequests++;}
  }
  function seedSnapshotBase(base) {
    if(!Number.isSafeInteger(base?.id)||base.id<1)return false;
    // 古い基準の後着で新しい3基準を追い出さない。現在の基準は再送を受けても作り直さない。
    if(base.id<lastSnapshotBaseId||snapshotDecoder.bases.has(base.id))return true;
    if(!snapshotDecoder.seed(base))return false;
    snapshotDecoder.bases=new Map([...snapshotDecoder.bases].sort((a,b)=>a[0]-b[0]));return true;
  }
  function retryPendingSnapshots() {
    // 順序が逆転した親子基準も、親が届いた時に復元。過去の写真は状態へ戻さない。
    for(let pass=0;pass<4;pass++){
      let changed=false;
      for(const [id,base] of pendingSnapshotBases)if(seedSnapshotBase(base)){pendingSnapshotBases.delete(id);changed=true;}
      if(!changed)break;
    }
    for(const wire of [...pendingSnapshotWires.values()].sort((a,b)=>a.frame-b.frame))receiveSnapshot(wire);
  }
  function handleSnapshotControl(type,data,peerId) {
    if(type==='snapshotResync'&&state.role==='host'){
      const p=state.peers.get(peerId),t=now();
      if(p&&t-(p.lastResync??-Infinity)>=250&&latestSnapshotWire){
        p.lastResync=t;const base=snapshotEncoder.currentBase();
        if(base){state.transport.send('snapshotBase',base,peerId);state.transport.send('snapshot',latestSnapshotWire,peerId);}
      }return true;
    }
    if(type==='snapshotBase'&&state.role==='guest'){
      if(finalFrame!==null||!['lobby','preparing','countdown','playing'].includes(state.phase))return true;
      if(seedSnapshotBase(data)){pendingSnapshotBases.delete(data.id);retryPendingSnapshots();}
      else if(Number.isSafeInteger(data?.id)&&data.id>0){
        pendingSnapshotBases.set(data.id,data);while(pendingSnapshotBases.size>4)pendingSnapshotBases.delete(Math.min(...pendingSnapshotBases.keys()));
        requestSnapshotResync();
      }return true;
    }
    return false;
  }
  function receiveSnapshot(wire) {
    if(finalFrame!==null||!wire||!Number.isSafeInteger(wire.frame)||wire.frame<0||!Array.isArray(wire.delta))return;
    if(wire.frame<=(state.lastSnapshot?.frame??-1)){interpolation.staleSnapshots++;const pending=pendingSnapshotWires.get(wire.delta[1]);if(pending?.frame<=wire.frame)pendingSnapshotWires.delete(wire.delta[1]);return;}
    const s=snapshotDecoder.decode(wire.delta),baseId=wire.delta[1];
    if(!s||(!prepared&&!pendingPrepare)){
      const pending=pendingSnapshotWires.get(baseId);
      if(!pending||wire.frame>pending.frame)pendingSnapshotWires.set(baseId,wire);
      while(pendingSnapshotWires.size>4)pendingSnapshotWires.delete(pendingSnapshotWires.keys().next().value);
      if(!s)interpolation.missingBaselines++;requestSnapshotResync();return;
    }
    if(s.frame!==wire.frame||!Number.isFinite(s.time)||!Array.isArray(s.units))return;
    pendingSnapshotWires.delete(baseId);
    for(const [id,pending] of pendingSnapshotWires)if(pending.frame<=s.frame)pendingSnapshotWires.delete(id);
    // この写真の基準があれば過去に欠けた別基準はもう要らない。
    for(const id of pendingSnapshotBases.keys())if(id<=baseId)pendingSnapshotBases.delete(id);
    if(!pendingSnapshotWires.size&&!pendingSnapshotBases.size){lastResync=-Infinity;resyncBackoff=250;}
    const t=now(),m=interpolation;
    if(!prepared){
      const d=pendingPrepare;setupWorld(d.teamSize,d.localId,d.mapId,s.units);player.controller='localHuman';
      prepared=true;pendingPrepare=null;
    }
    if(m.lastArrival!==null){
      const interval=Math.max(0,t-m.lastArrival),difference=Math.abs(interval-m.intervalMs);
      m.jitterMs+=.125*(Math.min(1000,difference)-m.jitterMs);m.intervalMs+=.125*(Math.min(1000,interval)-m.intervalMs);
      m.targetDelayMs=clamp(m.intervalMs+2*m.jitterMs+10,60,200);
    }
    m.lastArrival=t;m.acceptedSnapshots++;
    // ホストの可変dt時刻を使う。最小の到着時刻差を原点にし、回線の一時的な遅延を機体の時間軸へ混ぜない。
    m.localOffset=m.localOffset===null?t-s.time:Math.min(m.localOffset,t-s.time);
    lastSnapshotBaseId=baseId;state.lastHost=t;state.lastSnapshot=s;state.history.push({received:t,snapshot:s});
    while(state.history.length>32){
      // 復旧中の描画時刻を挟む2枚は残す。追いつく前に古いアンカーを消すと再び位置が飛ぶ。
      if(interpolation.renderTime===null||state.history[1].snapshot.time<=interpolation.renderTime)state.history.shift();
      else state.history.splice(2,1);
    }
    const previousView=capturePredictionView();
    applySnapshot(s);reconcilePrediction(s,previousView);
    const ack=s.acks?.[state.localUnitId]||0;
    for(const [seq,p]of state.pendingInputs){if(seq<=ack){if(p.move&&player.pos.distanceToSquared(vector(p.pos))>0.0001)displayedLatencies.push({kind:'input',time:p.time});state.pendingInputs.delete(seq);}}
    if(state.phase==='preparing')state.transport.send('ready',{matchId:state.matchId});
    // 終了写真は落ち得る。終了・最終コア・表彰は必ず制御線のmatchEndedで確定する。
  }
  function matchResult() {
    return {matchId:state.matchId,frame:state.frame,timeLeft,cores:{B:cores.B.hp,R:cores.R.hp},
      units:units.map(u=>({id:u.entityId,name:u.name,cls:u.cls,sc:{...u.sc}}))};
  }
  function receiveMatchEnded(result) {
    if(!prepared||finalFrame!==null||!['playing','countdown'].includes(state.phase)||!result||typeof result!=='object'||Array.isArray(result)||result.matchId!==state.matchId||
      !Number.isSafeInteger(result.frame)||result.frame<(state.lastSnapshot?.frame??0)||!Number.isFinite(result.timeLeft)||
      !['B','R'].every(k=>Number.isFinite(result.cores?.[k]))||!Array.isArray(result.units)||result.units.length!==units.length)return;
    const ids=new Set();
    for(const v of result.units){
      if(!v||typeof v!=='object'||Array.isArray(v)||!unit(v.id)||ids.has(v.id)||typeof v.name!=='string'||!['assault','heavy'].includes(v.cls)||!v.sc||typeof v.sc!=='object'||Array.isArray(v.sc)||
         Object.keys(unit(v.id).sc).some(k=>typeof v.sc[k]!==typeof unit(v.id).sc[k])||
         Object.entries(v.sc).some(([k,n])=>!Object.hasOwn(unit(v.id).sc,k)||!Number.isFinite(n)))return;
      ids.add(v.id);
    }
    clearPrediction();finalFrame=result.frame;pendingSnapshotWires.clear();pendingSnapshotBases.clear();state.history=[];
    cores.B.hp=result.cores.B;cores.R.hp=result.cores.R;timeLeft=result.timeLeft;
    for(const v of result.units){const u=unit(v.id);u.name=v.name;u.cls=v.cls;Object.assign(u.sc,v.sc);}
    state.phase='ended';finish();status('試合終了');callbacks.onEnded?.('試合終了');
  }
  function interpolate(t) {
    const h=state.history,m=interpolation;if(!h.length)return;
    const elapsed=m.lastRender===null?0:Math.max(0,t-m.lastRender);m.lastRender=t;
    // 増加120ms/秒、減少12ms/秒。写真の間隔が変わってもバッファを一度に飛ばさない。
    const change=m.targetDelayMs-m.delayMs;m.delayMs=clamp(m.delayMs+clamp(change,-elapsed*.012,elapsed*.12),60,200);
    const latest=h[h.length-1].snapshot,desired=t-m.localOffset-m.delayMs;
    // 写真が途絶えたら描いた時刻自体を100ms外挿で止める。復旧後は最大1.2倍速で追いつき、時計だけ先行させない。
    let target=Math.min(desired,latest.time+100);
    if(m.renderTime!==null){
      target=Math.max(m.renderTime,Math.min(target,m.renderTime+elapsed*1.2));
      if(target-m.renderTime>elapsed*1.001)m.catchupFrames++;
    }
    m.renderTime=target;m.recoveryLagMs=Math.max(0,desired-target);m.maxRecoveryLagMs=Math.max(m.maxRecoveryLagMs,m.recoveryLagMs);
    // 60〜200msは目標バッファ。欠落停止・復旧追従による実際の追加遅れは別値として隠さず測る。
    m.effectiveDelayMs=Math.max(0,t-m.localOffset-target);m.maxEffectiveDelayMs=Math.max(m.maxEffectiveDelayMs,m.effectiveDelayMs);m.totalEffectiveDelayMs+=m.effectiveDelayMs;
    let a=h[0].snapshot,b=a;
    for(let i=1;i<h.length;i++){a=h[i-1].snapshot;b=h[i].snapshot;if(b.time>=target)break;}
    const gap=Math.max(0,desired-latest.time),extrapolation=clamp(target-latest.time,0,100);
    m.frames++;m.totalDelayMs+=m.delayMs;m.gapMs=gap;m.maxGapMs=Math.max(m.maxGapMs,gap);m.extrapolationMs=extrapolation;m.maxExtrapolationMs=Math.max(m.maxExtrapolationMs,extrapolation);
    if(extrapolation>0)m.extrapolatedFrames++;else m.interpolatedFrames++;
    if(gap>100)m.clampedFrames++;
    if(extrapolation>0){
      for(const v of latest.units){const u=unit(v.id);if(!u||u===player||u.lifeId!==v.lifeId||u.onlineMotionEpoch!==(v.motionEpoch||0)||(u.onlineLagEpoch||0)!==(v.lagEpoch||0)||!v.alive||v.downT>0||v.transfer)continue;
        u.pos.copy(vector(v.pos)).addScaledVector(vector(v.vel),extrapolation/1000);u.yaw=v.yaw;
        interpolateRemotePose(u,v,v,0);
      }return;
    }
    const f=clamp((target-a.time)/Math.max(1,b.time-a.time),0,1);
    for(const v of b.units){const u=unit(v.id),old=a.units.find(x=>x.id===v.id);
      if(!u||u===player||!old||u.lifeId!==v.lifeId||u.alive!==v.alive||v.lifeId!==old.lifeId||v.alive!==old.alive||u.onlineMotionEpoch!==(v.motionEpoch||0)||(v.motionEpoch||0)!==(old.motionEpoch||0)||(u.onlineLagEpoch||0)!==(v.lagEpoch||0)||(v.lagEpoch||0)!==(old.lagEpoch||0)||v.transfer||old.transfer)continue;
      u.pos.copy(vector(old.pos)).lerp(vector(v.pos),f);u.yaw=old.yaw+wrapAngle(v.yaw-old.yaw)*f;
      interpolateRemotePose(u,old,v,f);
    }
  }
  // 遠隔機の姿勢も位置と同じ写真区間を使う。骨アニメーションの位相までhostと同期するものではない。
  function interpolateRemotePose(u,a,b,f){
    const discrete=f<1?a:b;
    for(const k of ['crouching','onGround','dashState','lungeT','kneeSlideT','planted','repairing','recoverT','stun','stunT','weapon','pitch','tilt'])if(Object.hasOwn(discrete,k))u[k]=discrete[k];
    for(const k of ['pitch','tilt'])if(Number.isFinite(a[k])&&Number.isFinite(b[k]))u[k]=a[k]+(b[k]-a[k])*f;
    if(Number.isFinite(a.renderCrouch)&&Number.isFinite(b.renderCrouch))u.onlineRenderCrouch=a.renderCrouch+(b.renderCrouch-a.renderCrouch)*f;
    if(a.vel&&b.vel)u.vel.copy(vector(a.vel.map((v,i)=>v+(b.vel[i]-v)*f)));
  }
  function beforeFrame(dt,t) {
    frameStart=now();
    if(state.role!=='offline'&&state.phase!=='playing'){running=false;stopSessionAudio();}
    countdownTick();requestSnapshotResync();
    if(state.role==='host'&&state.phase==='playing'){
      for(const p of [...state.peers.values()]){if(now()-p.last>3000){const reason='入力が3秒途絶えたため、対戦から退出しました。機体はBotが引き継ぎます';peerLeft(p.id,reason);state.transport.disconnectPeer(p.id,reason);continue;}const u=unit(p.unitId);if(u)u.controlInput=remoteInput(u);}
    }
    if(state.role!=='guest'||state.phase!=='playing')return;
    if(now()-state.lastHost>5000){endGuest('ホストから5秒間応答がありません');return;}
    if(now()-state.lastHost>500)status('通信遅延：ホストの状態を待っています');
    interpolate(now());decayPredictionVisual();
    if(!player)return;
    if(!overrideInput){
      const turn=2.2*dt;
      if(keys.ArrowLeft)player.yaw+=turn;if(keys.ArrowRight)player.yaw-=turn;
      if(keys.ArrowUp)player.pitch=Math.min(.7,player.pitch+1.5*dt);if(keys.ArrowDown)player.pitch=Math.max(-.9,player.pitch-1.5*dt);
    }
    const aimed=updateLocalHumanAim(player,dt,false);
    const input=overrideInput?{...overrideInput}:collectLocalInput(player);
    if(!overrideInput)for(const k of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'])delete input.keys[k];
    input.aimPoint=input.aimPoint||aimed.aim.toArray();input.lockTarget=overrideInput?.lockTarget??(lock.visible?lockId(lock.target):null);input.yaw=input.yaw??player.yaw;input.pitch=input.pitch??player.pitch;
    if(requestedWeapon){input.weapon=requestedWeapon;requestedWeapon=null;}
    input.seq=++state.seq;input.spawnChoice=player.spawnChoice;input.nextCls=player.nextCls;
    if(state.pendingInputs.size>600)state.pendingInputs.delete(state.pendingInputs.keys().next().value);
    const moving=!!(input.keys?.KeyW||input.keys?.KeyS||input.keys?.KeyA||input.keys?.KeyD||input.fwd||input.side);
    if(moving&&!previousMove)state.pendingInputs.set(input.seq,{time:now(),pos:player.pos.toArray(),move:true});
    if(input.trigger&&!previousTrigger){state.shots.push({seq:input.seq,time:now(),until:Infinity,done:false});if(state.shots.length>1000)state.shots.shift();}
    if(!input.trigger&&previousTrigger&&state.shots.length)state.shots[state.shots.length-1].until=input.seq;
    previousMove=moving;previousTrigger=!!input.trigger;
    if(!sendLocalInput(input))return;
    predictLocalInput(input,dt);
    if(prediction.enabled)for(const [seq,p]of state.pendingInputs)if(p.move&&player.pos.distanceToSquared(vector(p.pos))>1e-10){displayedLatencies.push({kind:'input',time:p.time});state.pendingInputs.delete(seq);}
    wheelDir=0;state.lastInput=now();
  }
  function afterFrame(dt,t) {
    if(state.role==='guest'){
      if(state.phase==='playing'&&Number.isFinite(interpolation.renderTime)&&state.lastSnapshot)lastRenderedView={time:interpolation.renderTime,frame:state.lastSnapshot.frame,delayMs:interpolation.delayMs};
      for(const p of displayedLatencies.splice(0))state[p.kind==='input'?'inputLatency':'hitLatency'].push(now()-p.time);return;
    }
    if(state.role!=='host'||state.phase!=='playing')return;
    const stateTime=now();captureLagHistory(stateTime);
    state.frameMs.push(now()-frameStart);if(state.frameMs.length>60000)state.frameMs.shift();
    state.frame++;
    const begin=now();
    if(state.events.length){state.transport.broadcast('events',state.events.splice(0));}
    if(now()-state.lastSent>=50 || ended){const wire=snapshotEncoder.encode(snapshot(stateTime));latestSnapshotWire={frame:state.frame,delta:wire.delta};if(wire.baseline)state.transport.broadcast('snapshotBase',wire.baseline);state.transport.broadcast('snapshot',latestSnapshotWire);state.lastSent=now();}
    state.sendMs.push(now()-begin);if(state.sendMs.length>60000)state.sendMs.shift();
    if(ended&&state.phase==='playing'){state.transport.broadcast('matchEnded',matchResult());clearPrediction();lagHistory?.clear();state.phase='ended';window.CBOnlineGame.stopSessionAudio?.();status('試合終了');callbacks.onEnded?.('試合終了');}
  }
  function emit(type,data) {if(state.role==='host'&&state.phase==='playing'&&!playingEffects&&state.events.length<1024)state.events.push({id:++eventId,type,data});}
  function playEvents(events) {
    if(!Array.isArray(events))return;playingEffects=true;
    try{for(const e of events){if(state.receivedEvents.has(e.id))continue;state.receivedEvents.add(e.id);if(state.receivedEvents.size>4096)state.receivedEvents.delete(state.receivedEvents.values().next().value);const d=e.data;
      if(e.type==='tracer')tracer(vector(d.from),vector(d.end),d.team,d.energy,WEAPONS[d.weapon]||null,d.enlarged);
      if(e.type==='boom')boom(vector(d.at),d.k,d.radius,d.energy);
      if(e.type==='impact')impact(vector(d.at),d.kind,d.delay);
      if(e.type==='sfx')sfx(d.name,d.at?vector(d.at):null,d.unit?unit(d.unit):null,d.rate,d.level);
      if(e.type==='shot'){const u=unit(d.unit);if(u)mainMuzzleFlash(u,false,u.slots[u.weapon].w);}
      if(e.type==='hit'&&d.unit===state.localUnitId){hitMark(d.head);const q=state.shots.find(x=>!x.done&&d.seq>=x.seq&&d.seq<x.until);if(q){q.done=true;displayedLatencies.push({kind:'hit',time:q.time});}}
    }}finally{playingEffects=false;}
  }
  // エリア移動は同じlifeIdのまま瞬間移動する。待機中の写真が全欠落しても境界を補間しない印だけを加える。
  if(typeof doTransfer==='function'){
    const oldDoTransfer=doTransfer;doTransfer=function(u){const result=oldDoTransfer(...arguments);if(state.role==='host')u.onlineMotionEpoch=(u.onlineMotionEpoch||0)+1;return result;};
  }
  // 蘇生は同じlifeId。死亡→蘇生の間が写真欠落しても、以前の生存姿勢を再利用しない。
  if(typeof kill==='function'){
    const oldKill=kill;kill=function(u){const alive=u.alive;try{return oldKill(...arguments);}finally{if(state.role==='host'&&alive&&!u.alive)u.onlineLagEpoch=(u.onlineLagEpoch||0)+1;}};
  }
  if(typeof revive==='function'){
    const oldRevive=revive;revive=function(u){const alive=u.alive;try{return oldRevive(...arguments);}finally{if(state.role==='host'&&!alive&&u.alive)u.onlineLagEpoch=(u.onlineLagEpoch||0)+1;}};
  }
  // 取得した入力ではなく、実際にphysicsを通った入力だけを確定する（行動不能中は進めない）。
  if(typeof updateHumanUnit==='function'){
    const oldUpdateHumanUnit=updateHumanUnit;updateHumanUnit=function(u,input,dt){const applied=state.role==='host'&&state.phase==='playing'&&u.alive&&u.controller==='remoteHuman';const result=oldUpdateHumanUnit(...arguments);if(applied)recordHostInputStep(u,input,dt);return result;};
  }
  // 描画中だけカメラをずらし、次frameの照準/送信aimPointにはoffsetを混ぜない。
  if(typeof renderView==='function'){
    const oldRenderView=renderView;renderView=function(){
      const offset=state.role==='guest'?player?.onlineVisualOffset:null;if(!offset)return oldRenderView(...arguments);
      const position=camera.position.clone();camera.position.add(offset);camera.updateMatrixWorld();
      try{return oldRenderView(...arguments);}finally{camera.position.copy(position);camera.updateMatrixWorld();}
    };
  }
  // 表示関数だけを包む。ゲスト側で発射/ダメージ関数を呼び出さない。
  const oldWeaponLook=weaponLook;weaponLook=function(u,dt){const d=u.cannonDeploy;try{return oldWeaponLook(u,dt);}finally{if(state.role==='guest')u.cannonDeploy=d;}};
  const oldTracer=tracer;tracer=function(from,end,team,energy,w,enlarged=true){emit('tracer',{from:from.toArray(),end:end.toArray(),team,energy,weapon:w?.key,enlarged});return oldTracer(...arguments);};
  const oldBoom=boom;boom=function(at,k=1,radius=0,energy=false){emit('boom',{at:at.toArray(),k,radius,energy});return oldBoom(...arguments);};
  const oldImpact=impact;impact=function(at,kind,delay){emit('impact',{at:at.toArray(),kind,delay});return oldImpact(...arguments);};
  const oldSfx=sfx;sfx=function(name,at,src,rate=1,level=1){
    if(state.role!=='offline'&&state.phase!=='playing'&&(SFX[name]?.motion||SFX[name]?.loop))return;
    // 足音と持続ブーストは双方の描画から鳴る。通信で複製すると未管理のloop音が残る。
    if(name!=='boostLoop'&&name!=='step')emit('sfx',{name,at:at?.toArray(),unit:src?.entityId,rate,level});
    if(playingEffects&&(name==='boostLoop'||name==='step'))return;
    return oldSfx(...arguments);
  };
  const oldFinish=finish;finish=function(){try{return oldFinish(...arguments);}finally{if(state.role!=='offline'){clearStartReservation();stopSessionAudio();}}};
  const oldShot=shot;shot=function(u,sl,aim,spread,missileTarget){
    const previous=hitscanContext,previousDamageSeq=damageInputSeq,p=state.role==='host'?state.peers.get(u.ownerPeerId):null,eligible=u.controller==='remoteHuman'&&sl?.w&&!sl.w.proj&&sl.w.type==='gun';
    // release照準は充填銃だけ。解除後に残る通常burst弾は最新movementの照準を使う。
    const pending=p?.pendingShot&&actionIsRecent(p,p.pendingShot)&&(p.pendingShot.trigger||sl?.w.chargeTime)?p.pendingShot:null;
    if(p)p.pendingShot=null;
    const input=eligible&&pending?pending:u.controlInput,cameraRecoil=u.cameraRecoil,cameraRecoilYaw=u.cameraRecoilYaw;
    emit('shot',{unit:u.entityId,seq:eligible&&input?.seq||u.onlineInputSeq||0});
    hitscanContext=eligible?{unit:u,weapon:sl.w,input}:null;
    if(eligible)damageInputSeq=input?.seq??null;
    if(eligible&&pending){aim=vector(pending.aimPoint);u.cameraRecoil=pending.cameraRecoil||0;u.cameraRecoilYaw=pending.cameraRecoilYaw||0;}
    try{return oldShot(u,sl,aim,spread,missileTarget);}finally{hitscanContext=previous;damageInputSeq=previousDamageSeq;if(eligible&&pending){u.cameraRecoil=cameraRecoil;u.cameraRecoilYaw=cameraRecoilYaw;}}
  };
  const oldShoot=shoot;shoot=function(owner){const sh=oldShoot(...arguments);if(sh)sh.onlineInputSeq=owner?.onlineInputSeq||0;return sh;};
  const oldBlast=blast;blast=function(sh){
    const prev=damageInputSeq;damageInputSeq=sh.onlineInputSeq??null;blastDepth++;
    // 爆風は damage() を通らず耐久・弱化を直接変える。爆風1回につき通知も1回にする。
    const watching=state.role==='host'&&state.phase==='playing'&&sh.owner?.controller==='remoteHuman';
    const targets=watching?[...units,...turrets,...radars,...gadgets,...barricades,cores.B,cores.R]
      .filter(e=>e!==sh.owner&&e.team!==sh.team)
      .map(e=>({e,hp:e.hp,weakT:e.weakT||0,stunT:e.stunT||0,jamT:e.jamT||0,electricT:e.electricT||0})):[];
    try {
      const result=oldBlast(...arguments);
      if(targets.some(p=>p.e.hp<p.hp||(p.e.weakT||0)>p.weakT||(p.e.stunT||0)>p.stunT||(p.e.jamT||0)>p.jamT||(p.e.electricT||0)>p.electricT))
        emit('hit',{unit:sh.owner.entityId,seq:sh.onlineInputSeq??(sh.owner.onlineInputSeq||0),head:false});
      return result;
    } finally {blastDepth--;damageInputSeq=prev;}
  };
  const oldDamage=damage;damage=function(r,by,dmg,head){const result=oldDamage(...arguments);if(result&&!blastDepth&&by?.controller==='remoteHuman')emit('hit',{unit:by.entityId,seq:damageInputSeq??(by.onlineInputSeq||0),head:!!head});return result;};
  addEventListener('beforeunload',()=>{if(state.role==='host')state.transport?.broadcast('endHost',{reason:'ホストが退出しました'});});
  window.CBOnlineGame={create,join,start,leave,approveGuest,rejectGuest,kickGuest,updateSettings,chooseTeam,shuffleTeams,state,stopSessionAudio,beforeFrame,afterFrame,remoteInput,emit,snapshot,castHitscan,
    roomOptions:{maps:roomMaps.map(m=>({...m})),teamSizes:roomTeamSizes.slice(),capacities:[2,3,4]},
    active:()=>state.role!=='offline',requestWeapon:slot=>{if(SLOTS.includes(slot))requestedWeapon=slot;},testInput:v=>{overrideInput=v;},metrics:()=>({role:state.role,phase:state.phase,localEntityId:state.localUnitId,peers:state.peers.size,frame:state.frame,
      inputLatency:state.inputLatency.slice(),hitLatency:state.hitLatency.slice(),frameMs:state.frameMs.slice(),sendMs:state.sendMs.slice(),transport:state.transport?.metrics(),prediction:predictionMetrics(),lagCompensation:{enabled:lagEnabled,...lagMetrics,reasons:{...lagMetrics.reasons},historyFrames:lagHistory?.frames.length||0},interpolation:{...interpolation,meanDelayMs:interpolation.frames?interpolation.totalDelayMs/interpolation.frames:100,meanEffectiveDelayMs:interpolation.frames?interpolation.totalEffectiveDelayMs/interpolation.frames:100},disconnected:state.disconnected.slice()})};
})();
