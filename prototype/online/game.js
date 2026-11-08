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
  let snapshotEncoder = new CBOnlineCodec.Encoder(), snapshotDecoder = new CBOnlineCodec.Decoder(), lastResync = -Infinity, pendingSnapshotWire = null;
  const displayedLatencies = [];
  const remoteShells = new Map();
  const scalarKeys = ('lifeId hp maxHp alive respawnT downT downYaw reviveAcc yaw pitch boost maxBoost overheat boostIdle onGround dashT longDash dashState dodgeT flying ctrlLockT catCd weapon prevWeapon switchT moveInput scoped scopeStep planted charging chargerOn stun stunT tilt invulT invulCancelOnAttack recoil recoilYaw recoilWait recoilRecovery cameraRecoil cameraRecoilYaw weakT weakMult crouching actionHeld kneeSlideT lungeT lungeT0 lungeSpeed slideT recoverT electricT shockT jamT cannonDeploy repairing podT podN cloak vis shimmer cloakT actCd').split(' ');
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
    snapshotEncoder=new CBOnlineCodec.Encoder();snapshotDecoder=new CBOnlineCodec.Decoder();lastResync=-Infinity;pendingSnapshotWire=null;
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
    state.onStatus = opts.onStatus || null; callbacks = opts;
    return { appVersion: opts.appVersion || localVersion(), peerOptions: opts.peerOptions, latencyMs: opts.latencyMs || 0, displayName: opts.displayName, capacity:state.settings?.capacity||4,
      onStatus: msg => status(typeof msg === 'string' ? msg : JSON.stringify(msg)),
      onPeerRequest: (id,name) => {
        if(state.role!=='host'||state.phase!=='lobby'){state.transport?.rejectPeer(id,'ロビー以外では入室できません');return;}
        state.requests.set(id,{id,name,requestedAt:now()});requestsChanged();status('入室の申請があります。名前を確認して許可・拒否してください');
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
    state.matchId = 'match-' + Date.now().toString(36); state.teamSize = teamSize;
    state.transport.startMatch(state.matchId); setupWorld(teamSize,host.unitId,state.resolvedMapId); player.controller = 'localHuman'; player.name = host.name; player.controlLoadout=preset(host.cls); equip(player,host.cls);
    for (const p of state.peers.values()) {
      p.unitId = assignments.find(r=>r.id===p.id).unitId; p.ready = false; p.last = now(); p.joinedAt = now();
      const u = unit(p.unitId); u.controller = 'remoteHuman'; u.ownerPeerId = p.id;
      u.name = p.name; u.controlLoadout = preset(p.cls || 'assault'); equip(u,p.cls || 'assault');
    }
    const initial=snapshotEncoder.encode(snapshot());
    for (const p of state.peers.values()) if(!state.transport.send('prepare', {matchId:state.matchId, teamSize, mapId:state.resolvedMapId, localId:p.unitId, baseline:initial.baseline, delta:initial.delta},p.id)){abortPreparation('初期状態が送信上限を超えたため開始できません');return;}
    status('ゲストの読み込みを待っています');
  }
  function begin() {
    if(state.phase!=='countdown')return;
    state.actualStartAt=now();state.countdownNumber=0;$('announce').querySelector('[data-online-countdown]')?.remove();tutorialClearInput();
    clearTimeout(state.prepareTimer);state.prepareTimer=null;
    state.phase = 'playing'; running = true; ended = false; state.lastHost = now();
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
      if (type === 'input' && state.phase === 'playing') acceptInput(p,data);
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
      if(!state.settings||data.teamSize!==state.settings.teamSize||data.mapId!==state.resolvedMapId||!roomMaps.some(m=>m.id===data.mapId)||!new RegExp('^[BR]:[0-9]+$').test(data.localId)){endGuest('開始するマップ・人数が部屋の設定と一致しません');return;}
      if(!snapshotDecoder.seed(data.baseline)){endGuest('初期状態の基準を読み込めませんでした');return;}
      const initial=snapshotDecoder.decode(data.delta);
      if(!initial){endGuest('初期状態を復元できませんでした');return;}
      state.matchId = data.matchId; state.teamSize = data.teamSize;
      setupWorld(data.teamSize,data.localId,data.mapId,initial.units); player.controller = 'localHuman';
      applySnapshot(initial); state.phase = 'preparing'; state.transport.send('ready',{matchId:state.matchId});
    } else if (type === 'begin' && state.phase==='preparing' && data?.matchId === state.matchId) { countdown(data.startAtHost); }
    else if (type === 'snapshot' && ['playing','ended'].includes(state.phase)) receiveSnapshot(data);
    else if (type === 'events' && state.phase === 'playing') playEvents(data);
  }
  function validInput(v) {
    if (!v || !Number.isSafeInteger(v.seq) || v.seq < 1 || !Number.isFinite(v.yaw) || !Number.isFinite(v.pitch)) return false;
    if (!Array.isArray(v.aimPoint) || v.aimPoint.length !== 3 || !v.aimPoint.every(n => Number.isFinite(n) && Math.abs(n)<1e6)) return false;
    return ['fwd','side','cameraRecoil','cameraRecoilYaw'].every(k => v[k] == null || Number.isFinite(v[k]));
  }
  const inputKeys = ['KeyW','KeyS','KeyA','KeyD','KeyR','KeyC','KeyF','KeyH','KeyE','ShiftLeft','ShiftRight','Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Digit1','Digit2','Digit3','Digit4'];
  function acceptInput(p,v) {
    if (!validInput(v) || v.seq <= p.receivedSeq) return;
    const k = o => Object.fromEntries(inputKeys.filter(key => o?.[key]).map(key=>[key,true]));
    p.receivedSeq = v.seq; p.last = now();
    p.input = { ...safe(v,['seq','yaw','pitch','cameraRecoil','cameraRecoilYaw']), keys:k(v.keys), pressed:k(v.pressed),
      fwd:Math.max(-1,Math.min(1,v.fwd||0)), side:Math.max(-1,Math.min(1,v.side||0)), trigger:!!v.trigger, alt:!!v.alt,
      wheel:Math.sign(v.wheel||0), weapon:SLOTS.includes(v.weapon)?v.weapon:undefined, aimPoint:v.aimPoint, lockTarget:typeof v.lockTarget==='string'?v.lockTarget:null };
    Object.assign(p.pendingEdges, p.input.pressed);
    p.pendingWheel = p.input.wheel || p.pendingWheel || 0;
    if(p.input.weapon)p.pendingWeapon=p.input.weapon;
    const u = unit(p.unitId);
    if (u && (!u.alive || u.transfer)) {
      if (spawnPoints(u.team).some(x=>x.id === v.spawnChoice)) u.spawnChoice = v.spawnChoice;
      if (['assault','heavy'].includes(v.nextCls)) {u.nextCls = v.nextCls; u.controlLoadout = preset(v.nextCls);}
    }
  }
  function remoteInput(u) {
    const p = state.peers.get(u.ownerPeerId);
    if (!p || !p.input || now()-p.last > 250) {u.controlTarget=null;return {keys:{},pressed:{},trigger:false,alt:false,yaw:u.yaw,pitch:u.pitch,aimPoint:u.aimPos?.toArray() || u.pos.clone().addScaledVector(fwdOf(u),100).toArray()};}
    const target=lockEntity(p.input.lockTarget);
    u.controlTarget=target&&target.alive&&!target.downT&&target.team!==u.team&&!target.cloak&&lockAllowed(u)&&target.pos.distanceTo(u.pos)<=u.lockRange*1.15*spotMul(u.team,target)&&canSee(u,target,targetPoint(target)) ? target : null;
    const result = {...p.input,pressed:{...p.pendingEdges},wheel:p.pendingWheel||0,weapon:p.pendingWeapon||undefined};
    p.pendingEdges = {}; p.pendingWheel = 0; p.pendingWeapon = null; p.appliedSeq = p.receivedSeq; u.onlineInputSeq = p.appliedSeq;
    return result;
  }
  function abortPreparation(reason) {
    clearStartReservation();
    clearTimeout(state.prepareTimer);state.prepareTimer=null;
    state.transport?.broadcast('endHost',{reason});
    state.phase='ended';running=false;ended=true;tutorialClearInput();stopSessionAudio();
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
    state.phase = 'ended'; running = false; ended = true; tutorialClearInput();stopSessionAudio();
    status(reason); callbacks.onEnded?.(reason); $('ovTitle').textContent = 'オンライン対戦を中断'; $('ovText').textContent = reason;
    showPage('pgMenu'); $('overlay').hidden = false; document.exitPointerLock?.();
  }
  function leave(reason = '退出') {
    clearStartReservation();running=false;stopSessionAudio();
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
    return {id:u.entityId,team:u.team,idx:u.idx,cls:u.cls,name:u.name,controller:u.controller,mech:u.mech,
      ...safe(u,scalarKeys),pos:u.pos.toArray(),vel:u.vel.toArray(),sc:{...u.sc},zipLine:u.zip?ziplines.indexOf(u.zip.line):-1,
      swing:u.swing ? {a:u.swing.a,...safe(u.swing,['t','phi','yaw0','aimed','tilt','slope','pike','chargeStage','chargeRatio','dashAttack','stopped','queued'])} : null,
      transfer:u.transfer ? safe(u.transfer,['t','base','at']) : null,
      slots:Object.fromEntries(SLOTS.map(k=>[k,{key:u.slots[k].w.key,...safe(u.slots[k],slotKeys)}]))};
  }
  function snapshot() {
    return {frame:state.frame,time:now(),timeLeft,running,ended,teamSize:state.teamSize,units:units.map(packUnit),
      cores:{B:cores.B.hp,R:cores.R.hp},
      spotted:Object.fromEntries(['B','R'].map(k=>[k,[...spotted[k]].filter(([u])=>u.entityId).map(([u,left])=>[u.entityId,left])])),
      spotSrc:Object.fromEntries(['B','R'].map(k=>[k,[...spotSrc[k]].filter(([u])=>u.entityId).map(([u,m])=>[u.entityId,[...m]])])),
      plants:plants.map(p=>safe(p,['id','owner','gauge','capturing','contested'])),
      turrets:turrets.map(p=>safe(p,['hp','alive','yaw','revive','team'])),radars:radars.map(p=>({...safe(p,['hp','alive','revive']),headYaw:p.head.rotation.y,intruders:p.intruders.map(u=>u.entityId)})),
      barricades:barricades.map(p=>safe(p,['hp','alive'])),
      mobility:{lifts:lifts.map(l=>({pos:l.pos.toArray(),direction:l.direction,waitT:l.waitT,blocked:l.blocked})),
        jumpPads:jumpPads.map(p=>p.flash),catapults:catapults.map(p=>({flash:p.flash,opacity:p.film.material.opacity}))},
      shells:shells.map(s=>({id:s.onlineId||(s.onlineId=++projectileId),pos:s.pos.toArray(),vel:s.vel.toArray(),rocket:!!s.spec.rocket,weak:!!s.spec.weak,team:s.team})),
      acks:Object.fromEntries([...state.peers.values()].map(p=>[p.unitId,p.appliedSeq]))};
  }
  function applyUnit(u,s) {
    if (u.cls !== s.cls || SLOTS.some(k=>s.slots[k]?.key!==u.slots[k]?.w.key)) {
      u.controlLoadout=Object.fromEntries(SLOTS.map(k=>[k,WEAPONS[s.slots[k]?.key]?s.slots[k].key:CLASSES[s.cls][k]]));equip(u,s.cls);
    }
    const localYaw = u.yaw, localPitch = u.pitch;
    u.localView=u===player;u.controller=u.localView?'localHuman':s.controller==='bot'?'bot':'remoteHuman';
    for(const k of scalarKeys)if(!Object.hasOwn(s,k))delete u[k];
    Object.assign(u,safe(s,scalarKeys)); u.pos.fromArray(s.pos); u.vel.fromArray(s.vel); Object.assign(u.sc,s.sc);
    if (u === player) {u.yaw=localYaw; u.pitch=localPitch;} // 視点操作のみ即時。移動は確定位置。
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
  function handleSnapshotControl(type,data,peerId) {
    if(type==='snapshotResync'&&state.role==='host'){
      if(state.peers.has(peerId)){const base=snapshotEncoder.currentBase();if(base)state.transport.send('snapshotBase',base,peerId);}return true;
    }
    if(type==='snapshotBase'&&state.role==='guest'){
      if(snapshotDecoder.seed(data)){if(pendingSnapshotWire)receiveSnapshot(pendingSnapshotWire);}
      else if(now()-lastResync>1000){lastResync=now();state.transport.send('snapshotResync',{});}return true;
    }
    return false;
  }
  function receiveSnapshot(s) {
    if(Array.isArray(s)){
      const wire=s;s=snapshotDecoder.decode(wire);
      if(!s){pendingSnapshotWire=wire;if(now()-lastResync>1000){lastResync=now();state.transport.send('snapshotResync',{});}return;}
      pendingSnapshotWire=null;
    }
    if (!s || s.frame <= (state.lastSnapshot?.frame ?? -1)) return;
    const t=now(); state.lastHost=t; state.lastSnapshot=s; state.history.push({received:t,snapshot:s});
    if(state.history.length>8)state.history.shift();
    applySnapshot(s);
    const ack=s.acks?.[state.localUnitId]||0;
    for(const [seq,p]of state.pendingInputs){if(seq<=ack){if(p.move && player.pos.distanceToSquared(vector(p.pos))>0.0001)displayedLatencies.push({kind:'input',time:p.time});state.pendingInputs.delete(seq);}}
    if(s.ended && state.phase!=='ended'){state.phase='ended';window.CBOnlineGame.stopSessionAudio?.();finish();status('試合終了');callbacks.onEnded?.('試合終了');}
  }
  function interpolate(t) {
    const h=state.history;if(h.length<2)return;const target=t-100;
    let a=h[0],b=h[h.length-1];for(let i=1;i<h.length;i++)if(h[i].received>=target){a=h[i-1];b=h[i];break;}
    const f=Math.max(0,Math.min(1,(target-a.received)/Math.max(1,b.received-a.received)));
    for(const v of b.snapshot.units){const u=unit(v.id),old=a.snapshot.units.find(x=>x.id===v.id);if(!u||u===player||!old||v.lifeId!==old.lifeId||v.alive!==old.alive)continue;u.pos.copy(vector(old.pos)).lerp(vector(v.pos),f);u.yaw=old.yaw+wrapAngle(v.yaw-old.yaw)*f;}
  }
  function beforeFrame(dt,t) {
    frameStart=now();
    if(state.role!=='offline'&&state.phase!=='playing'){running=false;stopSessionAudio();}
    countdownTick();
    if(state.role==='host'&&state.phase==='playing'){
      for(const p of [...state.peers.values()]){if(now()-p.last>3000){const reason='入力が3秒途絶えたため、対戦から退出しました。機体はBotが引き継ぎます';peerLeft(p.id,reason);state.transport.disconnectPeer(p.id,reason);continue;}const u=unit(p.unitId);if(u)u.controlInput=remoteInput(u);}
    }
    if(state.role!=='guest'||state.phase!=='playing')return;
    if(now()-state.lastHost>5000){endGuest('ホストから5秒間応答がありません');return;}
    if(now()-state.lastHost>500)status('通信遅延：ホストの状態を待っています');
    interpolate(now());
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
    state.transport.send('input',input);wheelDir=0;state.lastInput=now();
  }
  function afterFrame(dt,t) {
    if(state.role==='guest'){for(const p of displayedLatencies.splice(0))state[p.kind==='input'?'inputLatency':'hitLatency'].push(now()-p.time);return;}
    if(state.role!=='host'||state.phase!=='playing')return;
    state.frameMs.push(now()-frameStart);if(state.frameMs.length>60000)state.frameMs.shift();
    state.frame++;
    const begin=now();
    if(state.events.length){state.transport.broadcast('events',state.events.splice(0));}
    if(now()-state.lastSent>=50 || ended){const wire=snapshotEncoder.encode(snapshot());if(wire.baseline)state.transport.broadcast('snapshotBase',wire.baseline);state.transport.broadcast('snapshot',wire.delta);state.lastSent=now();}
    state.sendMs.push(now()-begin);if(state.sendMs.length>60000)state.sendMs.shift();
    if(ended&&state.phase==='playing'){state.phase='ended';window.CBOnlineGame.stopSessionAudio?.();status('試合終了');callbacks.onEnded?.('試合終了');}
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
  const oldShot=shot;shot=function(u){emit('shot',{unit:u.entityId,seq:u.onlineInputSeq||0});return oldShot(...arguments);};
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
  window.CBOnlineGame={create,join,start,leave,approveGuest,rejectGuest,kickGuest,updateSettings,chooseTeam,shuffleTeams,state,stopSessionAudio,beforeFrame,afterFrame,remoteInput,emit,snapshot,
    roomOptions:{maps:roomMaps.map(m=>({...m})),teamSizes:roomTeamSizes.slice(),capacities:[2,3,4]},
    active:()=>state.role!=='offline',requestWeapon:slot=>{if(SLOTS.includes(slot))requestedWeapon=slot;},testInput:v=>{overrideInput=v;},metrics:()=>({role:state.role,phase:state.phase,localEntityId:state.localUnitId,peers:state.peers.size,frame:state.frame,
      inputLatency:state.inputLatency.slice(),hitLatency:state.hitLatency.slice(),frameMs:state.frameMs.slice(),sendMs:state.sendMs.slice(),transport:state.transport?.metrics(),disconnected:state.disconnected.slice()})};
})();
