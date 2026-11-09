/* 試験ログは明示した数値と固定コードだけ。通信ペイロード・metrics() は渡さない。 */
(function(root){
  'use strict';
  const LIMITS={sessions:3,samples:300,events:128,bytes:512*1024,days:7,sampleMs:2000,saveMs:15000};
  const KEY='coreBreakerOnlineDiagnosticsV1';
  const roles=['host','guest'],phases=['idle','lobby','preparing','countdown','playing','ended','leaving'];
  const events=['session_started','sample','peer_joined','peer_disconnected','peer_departed','match_interrupted','transport_error','signaling_lost','connection_ready','match_started','match_finished','lobby_returned','preparation_aborted','session_ended','page_hidden','page_visible','page_closed'];
  const reasons=['none','other','local_leave','reconnect','host_left','kicked','rejected','full','version_mismatch','protocol_mismatch','connection_error','snapshot_channel_error','channel_closed','signaling_closed','signaling_error','peer_unavailable','network_error','browser_unsupported','connection_timeout','approval_timeout','response_timeout','input_timeout','host_timeout','prepare_timeout','prepare_peer_left','invalid_data','send_failed'];
  const correctionReasons=['distance','accumulated','respawn','equipment','down','transfer','jumpPad','catapult','stun','electric','shock','history','disabled','melee','special','zip','repair','launch','lift','planted','inactive','smooth','other'];
  const reasonMessages={
    '退出':'local_leave','試合結果から退出':'local_leave','部屋を閉じました':'local_leave','部屋を作り直す':'reconnect','接続を作り直す':'reconnect',
    'ホストが退出しました':'host_left','相手が退出しました':'local_leave','対戦接続が切れました':'channel_closed','状態用チャネルが切れました':'channel_closed','ホストがロビーから退出させました':'kicked','ホストが入室を拒否しました':'rejected',
    'ゲームの版が一致しません':'version_mismatch','通信の版が一致しません':'protocol_mismatch',
    '接続サービスが終了しました':'signaling_closed','対戦通信の応答がありません':'response_timeout','ホストから5秒間応答がありません':'host_timeout',
    '入力が3秒途絶えたため、対戦から退出しました。機体はBotが引き継ぎます':'input_timeout',
    '準備中にゲストが退出したため、開始を中止しました':'prepare_peer_left',
    '直接接続が時間切れです。STUN のみでは接続できない回線があります':'connection_timeout','接続サービスへの登録が時間切れになりました':'connection_timeout',
    '入室許可の待ち時間が3分を超えました':'approval_timeout','操作の送信ができないため対戦を中断しました':'send_failed'
  };
  const value=(v,max=1e12)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?Math.round(v*1000)/1000:null;
  const pick=(v,allowed,fallback='other')=>allowed.includes(v)?v:fallback;
  function reasonCode(message){
    if(typeof message!=='string')return 'other';
    if(reasons.includes(message))return message;
    if(Object.hasOwn(reasonMessages,message))return reasonMessages[message];
    if(message.startsWith('対戦接続エラー: '))return 'connection_error';
    if(message.startsWith('状態用チャネルの接続エラー: '))return 'snapshot_channel_error';
    if(message.startsWith('部屋は満員です（'))return 'full';
    if(message.startsWith('オンライン通信規格が違います'))return 'protocol_mismatch';
    if(message.includes('版が')||message.includes('バージョン'))return 'version_mismatch';
    if(message.includes('時間切れ')||message.includes('準備が'))return 'prepare_timeout';
    if(message.includes('チャネル')&&message.includes('閉'))return 'channel_closed';
    return 'other';
  }
  function nums(o,keys){return Object.fromEntries(keys.map(k=>[k,value(o?.[k])]));}
  const timing=o=>nums(o,['count','meanMs','p95Ms','maxMs']);
  function counters(o,keys){return Object.fromEntries(keys.filter(k=>value(o?.[k])!==null).map(k=>[k,value(o[k])]));}
  function safeSample(s={},maps=[]){
    if(!s||typeof s!=='object'||Array.isArray(s))s={};
    const d=s.diagnostic||s,t=s.transport||{},c=d.corrections||{};
    return {role:pick(s.role,roles,'guest'),phase:pick(s.phase,phases,'idle'),humans:value(s.humans,100),capacity:value(s.capacity,100),teamSize:value(s.teamSize,100),map:pick(s.map,maps,'unknown'),
      visibility:pick(d.visibility,['visible','hidden'],'unknown'),fps:value(d.fps,10000),frame:timing(d.frame),cpu:timing(s.cpu),
      hostFrame:timing(d.host?.frame||s.hostFrame),hostCpu:timing(d.host?.cpu||s.hostCpu),arrivals:timing(d.arrivals),snapshotAgeMs:value(d.snapshotAgeMs),rttMs:value(d.rttMs),
      corrections:{...nums(c,['count','samples','meanM','maxM','hardSnaps']),reasons:counters(c.reasons,correctionReasons)},
      predictionBlocked:pick(d.predictionBlocked,correctionReasons,'none'),...nums(d,['blockedCorrections','repeatDebt','pendingInputs']),
      preventedLook:nums(d.preventedLook,['count','maxDeg']),
      transport:{...nums(t,['sentBytes','receivedBytes','sentMessages','receivedMessages','connectedPeers','pendingPeers','maxBufferedBytes','maxQueue','bufferedBytes','queue','latencyMs','snapshotDropRate','inputDropRate']),rtt:nums(t.rtt,['count','minMs','meanMs','maxMs']),
        control:nums(t.control,['sentBytes','receivedBytes','sentMessages','receivedMessages']),snapshot:nums(t.snapshot,['sentBytes','receivedBytes','sentMessages','receivedMessages']),
        snapshotDrops:counters(t.snapshotDrops,['artificial','stale','congestion','superseded','incomplete']),inputDrops:counters(t.inputDrops,['artificial','stale','duplicate','congestion','superseded','rateLimited'])},
      interpolation:nums(s.interpolation,['acceptedSnapshots','staleSnapshots','missingBaselines','resyncRequests','interpolatedFrames','extrapolatedFrames','clampedFrames','delayMs','effectiveDelayMs','maxGapMs']),
      lagCompensation:nums(s.lagCompensation,['shots','rewinds','clamped','rejected','maxRewindMs'])};
  }
  function safeBoundary(b,maps){return b&&value(b.elapsedMs)!==null?{elapsedMs:value(b.elapsedMs),code:pick(b.code,events,'transport_error'),reason:pick(b.reason,reasons),data:safeSample(b.data,maps)}:null;}
  class Recorder {
    constructor({storage,now=()=>Date.now(),monotonic=()=>performance.now(),maps=[]}={}){
      this.storage=storage;this.now=now;this.monotonic=monotonic;this.maps=maps;this.sessions=[];this.active=null;this.storageAvailable=!!storage;this.lastSave=-Infinity;
      try{
        const raw=storage?.getItem(KEY);if(raw&&raw.length<=LIMITS.bytes){const data=JSON.parse(raw);if(data?.schema===1&&Array.isArray(data.sessions))this.sessions=data.sessions.slice(-LIMITS.sessions).map(s=>this.restore(s)).filter(Boolean);}
      }catch(_){this.storageAvailable=false;}
      this.bound();this.flush();
    }
    restore(s){
      if(!s||value(s.startedAt,1e15)===null||s.startedAt<this.now()-LIMITS.days*86400000||s.startedAt>this.now()+60000)return null;
      const version=typeof s.version==='string'&&/^Ver\d{1,6}$/.test(s.version)?s.version:'unknown';
      return {startedAt:s.startedAt,version,protocol:value(s.protocol,1000),role:pick(s.role,roles,'guest'),ended:s.ended===true,
        droppedSamples:value(s.droppedSamples)||0,droppedEvents:value(s.droppedEvents)||0,lastMatch:safeBoundary(s.lastMatch,this.maps),lastConnection:safeBoundary(s.lastConnection,this.maps),
        samples:(Array.isArray(s.samples)?s.samples:[]).slice(-LIMITS.samples).filter(x=>value(x?.elapsedMs)!==null).map(x=>({elapsedMs:value(x.elapsedMs),data:safeSample(x.data,this.maps)})),
        events:(Array.isArray(s.events)?s.events:[]).slice(-LIMITS.events).filter(x=>value(x?.elapsedMs)!==null).map(x=>({elapsedMs:value(x.elapsedMs),code:pick(x.code,events,'transport_error'),reason:pick(x.reason,reasons),phase:pick(x.phase,phases,'idle'),humans:value(x.humans,100)}))};
    }
    begin({role,version,protocol},sample){
      if(this.active)this.end('reconnect',sample);
      this.active=this.restore({startedAt:this.now(),role,version,protocol});this.sessions.push(this.active);this.started=this.monotonic();this.lastSample=-Infinity;
      this.event('session_started','none',sample);this.sample(sample,true);this.flush();
    }
    elapsed(){return Math.max(0,Math.round(this.monotonic()-this.started));}
    sample(data,force=false){
      if(!this.active)return;const at=this.elapsed();if(!force&&at-this.lastSample<LIMITS.sampleMs)return;
      this.lastSample=at;this.active.samples.push({elapsedMs:at,data:safeSample(data,this.maps)});this.bound();
      if(this.monotonic()-this.lastSave>=LIMITS.saveMs)this.flush();
    }
    event(code,reason,data={}){
      if(!this.active)return;this.active.events.push({elapsedMs:this.elapsed(),code:pick(code,events,'transport_error'),reason:reasonCode(reason),phase:pick(data.phase,phases,'idle'),humans:value(data.humans,100)});this.bound();
    }
    checkpoint(code,reason,data){
      if(!this.active)return;
      // 終了後にロビーで長く待っても、最後の試合/切断直前の値は通常標本と別に残す。
      const boundary={elapsedMs:this.elapsed(),code,reason:reasonCode(reason),data:safeSample(data,this.maps)};
      if(['match_finished','match_interrupted','preparation_aborted'].includes(code))this.active.lastMatch=boundary;
      if(['peer_disconnected','peer_departed','session_ended'].includes(code))this.active.lastConnection=boundary;
      this.event(code,reason,data);this.sample(data,true);this.flush();
    }
    end(reason,data){if(!this.active)return;this.checkpoint('session_ended',reason,data);this.active.ended=true;this.active=null;this.flush();}
    bound(){
      this.sessions=this.sessions.filter(s=>s===this.active||s.startedAt>=this.now()-LIMITS.days*86400000);
      if(this.sessions.length>LIMITS.sessions){const recent=this.sessions.filter(s=>s!==this.active).slice(-(LIMITS.sessions-(this.active?1:0)));this.sessions=this.active?[...recent,this.active]:recent;}
      for(const s of this.sessions){while(s.samples.length>LIMITS.samples){s.samples.shift();s.droppedSamples++;}while(s.events.length>LIMITS.events){s.events.shift();s.droppedEvents++;}}
      // JSONは固定ASCIIキー/コードのみ。UTF-8の実バイトを上限にして、古い標本から捨てる。
      while(new TextEncoder().encode(this.json()).length>LIMITS.bytes){
        const s=this.sessions.find(s=>s.samples.length);if(s){s.samples.shift();s.droppedSamples++;continue;}
        if(this.sessions.length>1){this.sessions.shift();continue;}break;
      }
    }
    json(){return JSON.stringify({schema:1,sessions:this.sessions});}
    flush(){
      this.lastSave=this.monotonic();
      try{
        // 別タブが書いた直近接続も残す。識別子は作らず開始時刻/役割の記録を照合する。
        const raw=this.storage?.getItem(KEY);let saved;try{if(raw&&raw.length<=LIMITS.bytes)saved=JSON.parse(raw);}catch(_){}
        if(saved?.schema===1&&Array.isArray(saved.sessions))for(const entry of saved.sessions.slice(-LIMITS.sessions)){
          const s=this.restore(entry);if(!s)continue;const i=this.sessions.findIndex(x=>x.startedAt===s.startedAt&&x.role===s.role),old=this.sessions[i];
          if(i<0)this.sessions.push(s);
          else if(old!==this.active&&((s.samples.at(-1)?.elapsedMs||0)>(old.samples.at(-1)?.elapsedMs||0)||s.ended&&!old.ended))this.sessions[i]=s;
        }
        this.sessions.sort((a,b)=>a.startedAt-b.startedAt);this.bound();this.storage?.setItem(KEY,this.json());this.storageAvailable=!!this.storage;
      }catch(_){this.bound();this.storageAvailable=false;}
    }
    preview(){this.bound();return 'コアブレイカー オンライン試験ログ v1\n端末内の記録。自動送信なし。コピー・保存した内容の共有は任意です。\n時刻は端末時計（UTC開始時刻＋elapsedMs）。本人確認や原因の断定には使えません。\n数値は観測値。FPSはフレーム間隔から算出。frame/cpu/arrivals/補正は直近2秒、bytes/欠落は接続中の累計、interpolation/lagCompensationは試合ごと。未取得はnull（count=0は標本なし）。\nbytesはアプリが数えたJSONのUTF-8量。WebRTC/IPヘッダー・再送・回線全体の通信量は含みません。RTTはアプリping、CPUはJSのみ。ホスト値は最後に受信した申告値。\n欠落数はアプリ内の破棄・人工欠損で、回線パケット損失率ではありません。推測した回線原因/IP/ID/名前/チャット/SDP/生エラーは含みません。\n最新3接続・各300標本/128イベント・合計512KiB・再表示時に7日超を除去。droppedは上限で省いた件数。急なクラッシュでは最後の15秒を失う場合があります。\n\n'+JSON.stringify({schema:1,sessions:this.sessions.map(s=>({...s,startedUtc:new Date(s.startedAt).toISOString()}))},null,2);}
    clear(){this.sessions=[];this.active=null;try{this.storage?.removeItem(KEY);return true;}catch(_){this.storageAvailable=false;return false;}}
  }
  const api={Recorder,LIMITS,KEY,reasonCode,safeSample};root.CBOnlineDiagnosticLog=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

/* #212 ブラウザホスト試作。通信以外のゲーム規則は既存本体を使う。 */
(() => {
  'use strict';
  const now = () => performance.now();
  const vector = a => new T.Vector3().fromArray(a);
  // 通常コア戦だけ。試験場・コスト戦・近接限定の規則は混ぜない。
  const roomMaps = Object.entries(MAPS).filter(([,d]) => !d.testOnly && !d.vs && !d.meleeOnly && d.team >= 2 && d.time > 0).map(([id,d]) => ({id,name:d.name}));
  const roomTeamSizes = Array.from({length:9},(_,i)=>i+2); // 本体2〜50のうち、通信試作は合計20機まで。
  const roomClasses=Object.keys(CLASSES);
  const defaultSettings = {capacity:4,teamSize:5,mapId:'mesa',teamMode:'random'};
  const state = { role: 'offline', phase: 'idle', transport: null, peers: new Map(), requests: new Map(), localUnitId: null,
    settings:null, roster:[], hostTeam:'B', resolvedMapId:null, roomId:null,
    lobbyRevision:0, lobbyReady:false, editing:false, equipment:null, equipmentVersion:0, equipmentPending:false,
    matchId: null, frame: 0, seq: 0, lastSnapshot: null, events: [], history: [], receivedEvents: new Set(),
    inputLatency: [], hitLatency: [], pendingInputs: new Map(), frameMs: [], sendMs: [],
    shots: [], disconnected: [], lastHost: 0, lastSent: 0, nextSnapshotAt: 0, lastInput: 0, onStatus: null,
    startAtHost: null, startAtLocal: null, countdownNumber: null, actualStartAt: null };
  let saved = null, overrideInput = null, playingEffects = false, eventId = 0, projectileId = 0, frameStart = 0, previousMove = false, previousTrigger = false;
  let callbacks = {}, damageInputSeq = null, blastDepth = 0, requestedWeapon = null, preferenceResolve = null, preferenceReject = null, preferenceTimer = null;
  let snapshotDecoder = new CBOnlineCodec.Decoder(), lastResync = -Infinity, resyncBackoff = 250;
  let pendingPrepare = null, prepared = false, finalFrame = null, lastSnapshotBaseId = 0;
  const pendingSnapshotWires = new Map(), pendingSnapshotBases = new Map();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // 写真の生成目標は30Hz。同じ大きさなら20Hz時の約1.5倍で、実回線の帯域は別計測。
  const SNAPSHOT_INTERVAL_MS=1000/30;
  function interpolationState() {
    return {delayMs:100,targetDelayMs:100,intervalMs:SNAPSHOT_INTERVAL_MS,jitterMs:0,lastArrival:null,lastRender:null,renderTime:null,localOffset:null,
      acceptedSnapshots:0,staleSnapshots:0,missingBaselines:0,resyncRequests:0,frames:0,interpolatedFrames:0,extrapolatedFrames:0,clampedFrames:0,
      extrapolationMs:0,maxExtrapolationMs:0,gapMs:0,maxGapMs:0,totalDelayMs:0,
      recoveryLagMs:0,maxRecoveryLagMs:0,effectiveDelayMs:100,maxEffectiveDelayMs:100,totalEffectiveDelayMs:0,catchupFrames:0};
  }
  let interpolation = interpolationState();
  const lagSupport=typeof CBOnlineLagComp!=='undefined'?CBOnlineLagComp:null;
  const lagHistory=lagSupport?new lagSupport.ColliderHistory(T,{skinHit:typeof skinMechHit==='function'?skinMechHit:null,refOf:typeof refOf==='function'?refOf:null}):null;
  const lagSnapshots=new Map();
  let lagEnabled=true,lastRenderedView=null,hitscanContext=null;
  const visibilitySupport=typeof CBOnlineVisibility!=='undefined'?CBOnlineVisibility:null;
  const remoteUnitHistory=new Map();
  let effectSource=null,effectTarget=null;
  const copyView=v=>visibilitySupport?visibilitySupport.copyView(v):null;
  function requireVisibilitySupport(){if(!visibilitySupport)throw Error('公開範囲を保護する機能を読み込めないため、ネット対戦を開始できません。ページを再読み込みしてください');}
  const lagMetrics={shots:0,rewinds:0,clamped:0,rejected:0,reasons:{},maxRewindMs:0};
  function resetLagCompensation(){lagHistory?.clear();lagSnapshots.clear();lastRenderedView=null;hitscanContext=null;Object.assign(lagMetrics,{shots:0,rewinds:0,clamped:0,rejected:0,reasons:{},maxRewindMs:0});}
  function captureLagHistory(time=now()){if(state.role==='host'&&state.phase==='playing'&&lagEnabled&&lagHistory)lagHistory.capture(time,units,hittables);}
  function rememberLagSnapshot(s){lagSnapshots.set(s.frame,s.time);for(const [frame,time]of lagSnapshots)if(time<s.time-2000)lagSnapshots.delete(frame);while(lagSnapshots.size>128)lagSnapshots.delete(lagSnapshots.keys().next().value);}
  function verifiedPeerUnitTimes(p,input,verified,acceptedAt=now()){
    const r=p.replication,view=copyView(input.view),anchor=r.sent.get(view?.frame);if(!view||!anchor)return null;
    const result=new Map(),permitted=new Set(),time=acceptedAt,latest=createPeerView(p);
    for(const [id,epoch]of anchor.visible){
      const u=unit(id);if(!u||!latest.visible.has(id)||r.epochs.get(id)!==epoch)continue;
      const evidence=[...r.sent].filter(([frame,v])=>frame<=view.frame&&v.updates.get(id)?.epoch===epoch).map(([,v])=>v.updates.get(id))
        .filter(v=>v.lifeId===u.lifeId&&v.motionEpoch===(u.onlineMotionEpoch||0)&&v.lagEpoch===(u.onlineLagEpoch||0));
      if(!evidence.length)continue;permitted.add(id);
      const first=Math.min(...evidence.map(v=>v.time)),last=Math.max(...evidence.map(v=>v.time));
      // tuple省略でも未送信の姿勢や100msを超えた外挿時刻を選べない。
      if(view.time>=first-.01&&view.time<=last+100+.01&&verified.time<=last+100+.01)result.set(id,Math.min(time,Math.max(verified.time,first)));
    }
    for(const row of view.units||[]){
      const [number,fa,fb,shown,epoch]=row,id=visibilitySupport.unitId(number),a=r.sent.get(fa),b=r.sent.get(fb),ua=a?.updates.get(id),ub=b?.updates.get(id),u=unit(id);
      if(!permitted.has(id)||fa>view.frame||fb>view.frame||!ua||!ub||ua.epoch!==epoch||ub.epoch!==epoch||anchor.visible.get(id)!==epoch||
        ua.lifeId!==u.lifeId||ub.lifeId!==u.lifeId||ua.motionEpoch!==(u.onlineMotionEpoch||0)||ub.motionEpoch!==(u.onlineMotionEpoch||0)||ua.lagEpoch!==(u.onlineLagEpoch||0)||ub.lagEpoch!==(u.onlineLagEpoch||0)||
        shown<a.time-.01||shown>b.time+(fa===fb?100:0)+.01||shown>input.receivedAt||shown>input.sentAt+25||shown>time)return null;
      // 低頻度写真の保持分は実送信sampleで裏付ける。元のRTT上限に加えても絶対200msまで。
      const rtt=state.transport.clock(p.id)?.rttMs;if(!Number.isFinite(rtt))return null;
      const extra=Math.max(0,view.time-shown),budget=Math.min(200,rtt+view.delayMs+50+(time-input.receivedAt)+extra);
      const selected=Math.max(shown,time-budget);if(selected!==shown)lagMetrics.clamped++;
      if(selected>b.time+100+.01)result.delete(id);else result.set(id,selected);
    }
    return result;
  }
  function castGuestHitscan(u,from,dir,w){
    const cast=()=>castFrom(from,dir,u,w.range||400);
    if(!lagEnabled||!lagHistory||state.role!=='host'||state.phase!=='playing'||u.controller!=='remoteHuman'||!u.alive)return cast();
    lagMetrics.shots++;
    const acceptedAt=now();
    const p=state.peers.get(u.ownerPeerId),input=hitscanContext?.input||u.controlInput;
    const verified=p&&p.inputLifeId===u.lifeId&&input?.lifeId===u.lifeId&&Number.isSafeInteger(input.seq)&&input.seq<=p.receivedSeq
      ?lagSupport.validateViewTime(input.view,{now:acceptedAt,sentAt:input.sentAt,receivedAt:input.receivedAt,rttMs:state.transport?.clock?.(p.id)?.rttMs,snapshots:p.replication?new Map([...p.replication.sent].map(([frame,v])=>[frame,v.time])):lagSnapshots})
      :{ok:false,reason:'input'};
    if(!verified.ok){lagMetrics.rejected++;lagMetrics.reasons[verified.reason]=(lagMetrics.reasons[verified.reason]||0)+1;return cast();}
    if(verified.clamped)lagMetrics.clamped++;
    const times=p.replication?verifiedPeerUnitTimes(p,input,verified,acceptedAt):null;
    if(p.replication&&!times){lagMetrics.rejected++;lagMetrics.reasons.visibility=(lagMetrics.reasons.visibility||0)+1;return cast();}
    const result=lagHistory.withRewind(verified.time,units,u,cast,times);
    if(lagHistory.lastRewound){lagMetrics.rewinds++;lagMetrics.maxRewindMs=Math.max(lagMetrics.maxRewindMs,verified.ageMs,...(times?[...times.values()].map(t=>acceptedAt-t):[]));}
    return result;
  }
  function castHitscan(u,from,dir,w){
    const hit=hitscanContext?.unit===u&&hitscanContext.weapon===w?castGuestHitscan(u,from,dir,w):castFrom(from,dir,u,w.range||400);effectTarget=hit?.ref||null;return hit;
  }
  // 移動命令の刻みはhost定義。client申告のdtや描画Hzで機体速度を変えない。
  const commandLimits={dt:1/60,queue:30,sequenceJump:120,catchupSeconds:.1,catchupBacklog:6,maxFrameSteps:4,maxAheadSteps:2};
  let localCommands={accumulator:0,pressed:{},wheel:0,weapon:null,movementActionSeq:0,moveActions:[],lifeId:null};
  const predictionLimits={inputs:240,seconds:1,hostSteps:120,wireSteps:8,visualFrames:6};
  const inputLimits={batch:5,sendMs:1000/60,maxAgeMs:500,futureMs:250,actions:64};
  const movementKeys=['KeyW','KeyS','KeyA','KeyD','KeyC','ShiftLeft','ShiftRight','Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
  const movementEdges=['ShiftLeft','ShiftRight','Space'];
  const movementMask=pressed=>movementEdges.reduce((mask,key,i)=>mask|(pressed?.[key]?1<<i:0),0);
  const movementPressed=mask=>Object.fromEntries(movementEdges.filter((_,i)=>mask&(1<<i)).map(key=>[key,true]));
  let inputSending={history:[],lastBatch:-Infinity,actionSeq:0,lastActionAt:-Infinity,signature:null,lifeId:null};
  function predictionState(enabled=true) {
    return {enabled,pending:[],actionEdges:[],authoritative:null,reconciliations:0,correctionCount:0,correctionTotal:0,correctionMax:0,corrections:[],preventedLook:[],
      predictedSteps:0,predictedSeconds:0,replayedSteps:0,replayedSeconds:0,hardSnaps:0,hardSnapReasons:{},partialAcks:0,droppedInputs:0,droppedThroughSeq:0,droppedThroughDt:0,droppedActionSeq:0,
      lastAckSeq:0,lastAckStep:0,lastAckActionSeq:0,confirmedHostSeconds:0,hostStepSamples:0,hostSteps:[],visualFrames:0,blockedFrames:0};
  }
  let prediction=predictionState();
  function resetPrediction(enabled=prediction.enabled) {
    localCommands={accumulator:0,pressed:{},wheel:0,weapon:null,movementActionSeq:0,moveActions:[],lifeId:null};
    prediction=predictionState(enabled);inputSending={history:[],lastBatch:-Infinity,actionSeq:0,lastActionAt:-Infinity,signature:null,lifeId:null};for(const u of units){delete u.onlineVisualOffset;delete u.onlineRenderOffset;}localStepDelta=null;ownSnapshotTime=null;blockedView=null;meleeRelease=null;localMeleeSwing=null;
  }
  function clearPrediction() {
    resetLocalFire();
    localCommands={accumulator:0,pressed:{},wheel:0,weapon:null,movementActionSeq:0,moveActions:[],lifeId:null};
    prediction.pending=[];prediction.actionEdges=[];inputSending.history=[];inputSending.signature=null;prediction.authoritative=null;prediction.visualFrames=0;prediction.hostSteps=[];
    state.pendingInputs.clear();displayedLatencies.length=0;
    for(const u of units){delete u.onlineVisualOffset;delete u.onlineRenderOffset;}localStepDelta=null;ownSnapshotTime=null;blockedView=null;meleeRelease=null;localMeleeSwing=null;
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
    const renderPos=visualPos.clone();if(player.onlineRenderOffset)renderPos.add(player.onlineRenderOffset);
    return {pos,visualPos,renderPos,yaw:player.yaw,pitch:player.pitch};
  }
  function predictLocalInput(input,dt) {
    if(!prediction.enabled||!player||!Number.isSafeInteger(input?.seq)||input.seq<1||!Number.isFinite(dt)||dt<=0||dt>.05||typeof predictHumanMovement!=='function')return false;
    prediction.actionEdges=prediction.actionEdges.filter(e=>now()-e.time<=inputLimits.maxAgeMs);
    const copy={...input,keys:{...input.keys},pressed:{...input.pressed}};
    const pressedMove=Object.fromEntries(movementEdges.filter(k=>input.pressed?.[k]).map(k=>[k,true]));
    const edgeActions=input.command&&input.moveActions?.length?input.moveActions.map(([actionSeq,mask])=>({actionSeq,pressed:movementPressed(mask)})):
      [{actionSeq:input.command?input.moveActionSeq:input.actionSeq,pressed:pressedMove}];
    for(const edge of edgeActions)if(Number.isSafeInteger(edge.actionSeq)&&edge.actionSeq>0&&Object.keys(edge.pressed).length&&!prediction.actionEdges.some(e=>e.actionSeq===edge.actionSeq)){
      prediction.actionEdges.push({actionSeq:edge.actionSeq,seq:input.seq,lifeId:player.lifeId,time:now(),pressed:edge.pressed,needsReplay:false});
      if(prediction.actionEdges.length>inputLimits.actions){prediction.droppedActionSeq=prediction.actionEdges.shift().actionSeq;prediction.droppedInputs++;}
    }
    // movementのackがcontrolの到着より先なら、消化していない押下を次の実在する仮dtへ一度だけ乗せる。
    // 送信情報にdtを含めない。履歴が上限に達したら古い仮stepを捨て、次の確定写真で合わせる。
    prediction.pending.push({input:copy,provisionalDt:dt,lifeId:player.lifeId,time:now()});
    let seconds=prediction.pending.reduce((n,p)=>n+p.provisionalDt,0);
    while(prediction.pending.length>predictionLimits.inputs||seconds>predictionLimits.seconds){const dropped=prediction.pending.shift();seconds-=dropped.provisionalDt;if(dropped.input.seq>=prediction.droppedThroughSeq){prediction.droppedThroughSeq=dropped.input.seq;prediction.droppedThroughDt=dropped.provisionalDt;}prediction.droppedInputs++;}
    const index=prediction.pending.length-1-(input.command?(prediction.repeatDebt||0):0);
    if(index<0)return false;
    const source=input.command?prediction.pending[index].input:copy;
    const applied={...source,pressed:{...source.pressed}};
    if(input.command&&(source.moveActions?.length||source.moveActionSeq)){
      for(const key of movementEdges)delete applied.pressed[key];
      for(const edge of prediction.actionEdges)if(edge.seq===source.seq)Object.assign(applied.pressed,edge.pressed);
    }
    for(const edge of prediction.actionEdges)if(edge.needsReplay&&edge.lifeId===player.lifeId&&edge.seq<=source.seq){Object.assign(applied.pressed,edge.pressed);edge.needsReplay=false;}
    // 反復時間を引いた先読みは古い命令の向きで移動するが、描画する視点は最新入力を保つ。
    // 写真照合だけで戻すと、その次の通常stepでマウス/右スティック/lock追従が巻き戻る。
    const yaw=player.yaw,pitch=player.pitch;let moved;
    try{moved=predictHumanMovement(player,applied,dt);}
    finally{
      const angle=Math.max(Math.abs(wrapAngle(player.yaw-yaw)),Math.abs(player.pitch-pitch));
      if(angle>1e-7)diagnosticSample(prediction.preventedLook,angle*180/Math.PI);
      player.yaw=yaw;player.pitch=pitch;
    }
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
    const fixed=ack?.fixed===true;
    // held補完で既に進んだ固定tickも写真に含まれる。未到着命令を同じ時間へ重ねない。
    const replaySeq=fixed&&Number.isSafeInteger(ack.replaySeq)?ack.replaySeq:0;
    const seq=Number.isSafeInteger(ack?.seq)?ack.seq:legacyAck,seqDt=Number.isFinite(ack?.seqDt)?Math.max(0,ack.seqDt):Infinity;
    if(ack&&Number.isSafeInteger(ack.step)&&ack.step>=m.lastAckStep){
      for(const step of ack.steps||[])if(Number.isSafeInteger(step.step)&&step.step>m.lastAckStep&&Number.isFinite(step.dt)&&step.dt>0&&step.dt<=.05){m.hostSteps.push({...step});m.hostStepSamples++;}
      while(m.hostSteps.length>predictionLimits.hostSteps)m.hostSteps.shift();
      m.lastAckStep=ack.step;m.confirmedHostSeconds=Number.isFinite(ack.totalDt)?ack.totalDt:m.confirmedHostSeconds;
    }
    m.lastAckSeq=Math.max(m.lastAckSeq,seq);
    m.repeatDebt=fixed?Math.max(0,replaySeq-seq):0;
    const actionSeq=Number.isSafeInteger(ack?.actionSeq)?ack.actionSeq:0;m.lastAckActionSeq=Math.max(m.lastAckActionSeq,actionSeq);
    const movementAck=fixed?(ack.movementSeq||0):actionSeq,movementIds=new Set(fixed&&Array.isArray(ack.movementIds)?ack.movementIds:[]);
    m.actionEdges=m.actionEdges.filter(e=>(fixed?!movementIds.has(e.actionSeq):e.actionSeq>movementAck)&&e.lifeId===v.lifeId&&now()-e.time<=inputLimits.maxAgeMs);for(const e of m.actionEdges)e.needsReplay=true;
    const previous=m.authoritative,wasMelee=previous?.predictionBlocked==='melee',isMelee=v.predictionBlocked==='melee';
    let reason=discontinuityReason(previous,v);
    // 行動不能・大破待ちの見回しは手元のまま。Fで大破しても向きを巻き戻さない。
    // 初回死亡・蘇生・生命/装備/転送の境界は従来どおり確定写真に合わせる。
    const keepInactiveLook=reason==='down'&&previous?.alive===false&&v.alive===false&&
      (previous.motionEpoch||0)===(v.motionEpoch||0)&&(previous.lagEpoch||0)===(v.lagEpoch||0)&&
      !previous.transfer&&!v.transfer;
    if(!reason&&(seq<m.droppedThroughSeq||!fixed&&seq===m.droppedThroughSeq&&seqDt+1e-9<m.droppedThroughDt||(fixed?m.droppedActionSeq>0&&!movementIds.has(m.droppedActionSeq):movementAck<m.droppedActionSeq)))reason='history';
    m.authoritative=v;
    if(!m.enabled||state.phase!=='playing'||!previousView)return;
    m.reconciliations++;
    m.pending=m.pending.filter(p=>(fixed?p.input.seq>seq:p.input.seq>=seq)&&p.lifeId===v.lifeId);
    if(reason){m.pending=[];m.actionEdges=[];inputSending.history=[];if(fixed)m.droppedActionSeq=0;}
    else for(const [index,p] of m.pending.entries()){
      // hostの次は未適用queueの先頭。反復ぶんは再生時間から引き、入力の順序は飛ばさない。
      if(fixed&&index>=Math.max(0,m.pending.length-Math.max(0,replaySeq-seq)))break;
      const confirmed=p.input.seq===seq,dt=fixed?commandLimits.dt:confirmed?Math.max(0,p.provisionalDt-seqDt):p.provisionalDt;
      if(dt<=1e-9)continue;
      if(confirmed)m.partialAcks++;
      // 部分適用の残りdtを作り、押下の消化は下の独立action ackで判断する。
      const input={...p.input,pressed:confirmed?{}:{...p.input.pressed}};
      // controlへ載せた押下はmovement seqでは消化を決めない。独立action ack後だけ捨てる。
      if(p.input.command?p.input.moveActions?.length||Number.isSafeInteger(p.input.moveActionSeq)&&p.input.moveActionSeq>0:Number.isSafeInteger(p.input.actionSeq))for(const k of movementEdges)delete input.pressed[k];
      for(const edge of m.actionEdges)if(edge.needsReplay&&edge.seq<=p.input.seq){Object.assign(input.pressed,edge.pressed);edge.needsReplay=false;}
      if(typeof predictHumanMovement==='function'&&predictHumanMovement(player,input,dt)){m.replayedSteps++;m.replayedSeconds+=dt;}
    }
    m.pending=m.pending.filter(p=>p.input.seq>seq||!fixed&&p.provisionalDt>seqDt+1e-9);
    // 写真が来るまでに増えたマウス/右スティックの向きは見た目だけの遅延を付けない。
    // カタパルト・ジャンプ台・よろけ・近接など先読みを止める間も、向きはゲストの物（写真の向きは自分が少し前に送った値）。
    // 戻すと、遅れて返る向きと今の向きの間を行き来して画面が震える（2026-11-08 揺れ計測 online_jitter_check で検知）。
    // ホストの向きに合わせるのは、再出撃・移動（エリア移動など）・ダウンと蘇生・兵装変更だけ（向きが作り直される時。行動不能中の見回しは除く）。
    if(keepInactiveLook||!['respawn','transfer','down','equipment'].includes(reason)){player.yaw=previousView.yaw;player.pitch=previousView.pitch;}
    const distance=Math.sqrt(previousView.pos.distanceToSquared(player.pos));
    m.correctionCount++;m.correctionTotal+=distance;m.correctionMax=Math.max(m.correctionMax,distance);
    // 近接中の写真位置は予測誤差ではない。外挿の上へ通常移動の巻戻しを重ねない。
    // 開始・終了は直前に描いた位置から引き継ぐが、生命/転送/被弾/装備の境界と3m以上の差は跨がない。
    const meleeView=(isMelee||wasMelee||meleeRelease)&&(!reason||reason==='melee')&&previousView.renderPos&&previousView.renderPos.distanceToSquared(player.pos)<9;
    if(meleeView){
      m.visualFrames=0;
      if(isMelee){
        delete player.onlineVisualOffset;
        // 写真でposの基準が変わった直後も、次のlock計算には最後に描いた位置を渡す。
        (player.onlineRenderOffset||(player.onlineRenderOffset=vector([0,0,0]))).copy(previousView.renderPos).addScaledVector(player.pos,-1);
        if(!blockedView||!wasMelee)blockedView={pos:previousView.renderPos.clone(),lifeId:player.lifeId,reason:'melee',time:now()};
        meleeRelease=null;
      }else{
        // 通常移動の固定tick補間とは別の残差として引き継ぐ。rawの移動差分は足さない。
        player.onlineVisualOffset=(wasMelee?previousView.renderPos:previousView.visualPos).clone().addScaledVector(player.pos,-1);
        if(wasMelee){delete player.onlineRenderOffset;localStepDelta=null;}
        meleeRelease={until:meleeRelease?.until??now()+250};blockedView=null;
      }
      reason='';
    }else if(!reason&&distance>=.5)reason='distance';
    if(reason){
      if(wasMelee||isMelee||meleeRelease||['respawn','equipment','down','transfer','stun','electric','shock','history'].includes(reason))blockedView=null;
      meleeRelease=null;localMeleeSwing=null;
      delete player.onlineVisualOffset;delete player.onlineRenderOffset;localStepDelta=null;m.visualFrames=0;m.hardSnaps++;m.hardSnapReasons[reason]=(m.hardSnapReasons[reason]||0)+1;
    }else if(!meleeView){
      const offset=previousView.visualPos.clone().addScaledVector(player.pos,-1);
      // 小補正が重なっても0.5m以上を見た目の遅れとして蓄積しない。
      if(offset.distanceToSquared(vector([0,0,0]))<.25){player.onlineVisualOffset=offset;m.visualFrames=predictionLimits.visualFrames;}
      else {delete player.onlineVisualOffset;m.visualFrames=0;m.hardSnaps++;m.hardSnapReasons.accumulated=(m.hardSnapReasons.accumulated||0)+1;reason='accumulated';}
    }
    m.corrections.push({at:now(),distance,reason:reason||'smooth',predictionBlocked:v.predictionBlocked||'',seq,step:m.lastAckStep});if(m.corrections.length>1000)m.corrections.shift();
  }
  function decayPredictionVisual() {
    if(!player?.onlineVisualOffset||meleeRelease)return;
    if(prediction.visualFrames<=1){delete player.onlineVisualOffset;prediction.visualFrames=0;return;}
    const frames=prediction.visualFrames--;player.onlineVisualOffset.multiplyScalar((frames-1)/frames);
  }
  function recordHostInputStep(u,input,dt) {
    if(state.role!=='host'||state.phase!=='playing'||u.controller!=='remoteHuman'||!Number.isSafeInteger(input?.seq)||!Number.isFinite(dt)||dt<=0||dt>.05)return;
    const p=state.peers.get(u.ownerPeerId);if(!p)return;
    if(!input.command)acknowledgeInputAction(p);
    if(p.appliedSeq!==input.seq)p.appliedSeqDt=0;
    p.appliedSeq=input.seq;p.appliedSeqDt=(p.appliedSeqDt||0)+dt;p.appliedTotalDt=(p.appliedTotalDt||0)+dt;p.appliedStep=(p.appliedStep||0)+1;
    (p.appliedSteps||=[]).push({step:p.appliedStep,seq:input.seq,dt,seqDt:p.appliedSeqDt,actionSeq:p.appliedActionSeq||0,pressed:Object.keys(input.pressed||{}).filter(k=>input.pressed[k])});
    if(p.appliedSteps.length>predictionLimits.hostSteps)p.appliedSteps.shift();
  }
  function acknowledgeInputAction(p){
    p.pendingEdges={};
    if(p.activeAction){p.appliedActionSeq=p.activeAction.actionSeq;p.actionState=p.activeAction;p.actions=p.actions.filter(a=>a.actionSeq>p.appliedActionSeq);p.activeAction=null;}
    // 押下を適用したstepに発射しなかった場合、spin/装填待ち後に古い照準を復活させない。
    p.pendingShot=null;
  }

  const displayedLatencies = [];
  const remoteShells = new Map(), remoteEquipment = new Map();
  const equipmentActions=[];
  const equipmentVectors=['escortAim','bombard','seekAim'];
  const equipmentScalars='fieldOn fieldN barrierOn escortOn escortT escortCd mirageOn mirageWait postRecall radarHeading radarScanT seekMode repairBlock'.split(' ');
  const scalarKeys = ('lifeId hp maxHp alive respawnT downT downYaw reviveAcc yaw pitch boost maxBoost overheat boostIdle onGround dashT longDash dashState dodgeT flying ctrlLockT catCd weapon prevWeapon switchT moveInput scoped scopeStep planted charging chargerOn stun stunT tilt invulT invulCancelOnAttack recoil recoilYaw recoilWait recoilRecovery cameraRecoil cameraRecoilYaw weakT weakMult crouching actionHeld kneeSlideT lungeT lungeT0 lungeSpeed slideT recoverT electricT shockT jamT cannonDeploy repairing podT podN cloak vis shimmer cloakT actCd jumpBuf actionBlockBoost shockSlow zipCd flightSpeed').split(' ').concat(equipmentScalars);
  // 他機の武器枠は外見だけ。残弾/CD等は自機へだけ送り、装備が変わっても枠の形を固定する。
  const remoteSlotKeys={main:['scanRadius'],sub:['scanRadius'],aux:['chargeT','sheathed','scanRadius'],sp:['heat','overheat','scanRadius']};
  const slotKeys = ('ammo reserve resMax reloadT cd spin temp ohT conv heat overheat bn held chargeT holdT cap supply sheathed mode modeHeld pulseT scanT scanRadius').split(' ');
  const safe = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined && (typeof o[k] !== 'number' || Number.isFinite(o[k]))).map(k => [k,o[k]]));
  const unit = id => units.find(u => u.entityId === id);
  const lockId = e => e?.entityId || (e?.onlinePublicId?'gadget:'+e.onlinePublicId:null) || (e?.kind==='turret' ? 'turret:'+turrets.indexOf(e) : null);
  const lockEntity = (id,p=null) => typeof id==='string'&&id.startsWith('gadget:') ? (p?.replication?.gadgetSlots||[]).find(s=>s?.id===Number(id.slice(7)))?.g||null : typeof id==='string'&&id.startsWith('turret:') ? turrets[Number(id.slice(7))] : unit(id);
  function status(text) { state.status = text; state.onStatus?.(text, state); }
  // 定型通信はIDだけを受け、本文・送信者・宛先はホストが決める。既存GのBot指示とは独立。
  const quickChatCategories = [
    {label:'作戦',items:[['attack','攻撃しよう'],['defend','ベースを守ろう'],['capture','プラントを確保しよう'],['retreat','いったん後退しよう']]},
    {label:'援護',items:[['help','援護を頼む'],['follow','一緒に行こう'],['repair','修理を頼む'],['cover','援護する']]},
    {label:'報告',items:[['enemy','敵を発見'],['incoming','ベースに敵が接近'],['moving','目標へ向かう'],['ready','準備できた']]},
    {label:'返答',items:[['yes','了解'],['no','今は難しい'],['thanks','ありがとう'],['sorry','ごめん']]}
  ].map(group=>Object.freeze({label:group.label,items:Object.freeze(group.items.map(([id,text])=>Object.freeze({id,text})))}));
  Object.freeze(quickChatCategories);
  const quickChatPhrases=new Map(quickChatCategories.flatMap(g=>g.items.map(item=>[item.id,item.text])));
  const quickChatLimits=Object.freeze({gapMs:1500,sameMs:5000,windowMs:10000,burst:3,requestMs:250,visibleMs:8000,lines:5});
  const quickChatBudgets=new Map();
  let quickChatSeq=0,quickChatEvent=0,quickChatSeen=0,quickChatLastAttempt=-Infinity;
  const quickChatLines=[];
  const quickChatListeners=new Set();
  const notifyQuickChat=(type,value)=>{for(const fn of quickChatListeners)fn(type,value);};
  function resetQuickChat(){
    quickChatBudgets.clear();quickChatLines.length=0;quickChatSeq=quickChatEvent=quickChatSeen=0;quickChatLastAttempt=-Infinity;
    notifyQuickChat('reset');
  }
  function quickChatAllowed(u=typeof player==='undefined'?null:player){
    if(!state.transport||!state.roomId||!['host','guest'].includes(state.role))return false;
    if(state.phase==='lobby')return true;
    return state.phase==='playing'&&!!u?.alive&&u.hp>0&&!(u.downT>0);
  }
  function quickChatReason(){return state.phase==='playing'?'死亡・行動不能中は送信できません':'ロビーか試合中に使えます';}
  function quickChatNotice(reason,retryMs=0){notifyQuickChat('notice',{reason,retryMs});return {ok:false,reason,retryMs};}
  function receiveQuickChat(data){
    if(!data||!quickChatPhrases.has(data.id)||!Number.isSafeInteger(data.event)||data.event<=quickChatSeen||
      data.phase!==state.phase||!['lobby','playing'].includes(data.phase)||data.matchId!==(state.matchId||null)||
      typeof data.sender!=='string'||data.sender.length>128||typeof data.name!=='string'||[...data.name].length>24||
      !['B','R'].includes(data.team)||data.scope!==(state.phase==='lobby'?'all':'team'))return false;
    // 敵向けの通知をクライアントでも表示しない。配信自体の遮断はacceptQuickChatが担当。
    if(state.phase==='playing'&&data.team!==player?.team)return false;
    quickChatSeen=data.event;
    const line={id:data.id,event:data.event,name:data.name,sender:data.sender,team:data.team,scope:data.scope,phase:data.phase,matchId:data.matchId,text:quickChatPhrases.get(data.id),at:now()};
    quickChatLines.push(line);while(quickChatLines.length>quickChatLimits.lines)quickChatLines.shift();
    notifyQuickChat('message',{...line});return true;
  }
  function acceptQuickChat(data,peerId){
    const hostId=state.transport?.peer?.id,p=state.peers.get(peerId),self=peerId===hostId;
    if(state.role!=='host'||!self&&!p)return {ok:false,reason:'参加者ではありません'};
    let budget=quickChatBudgets.get(peerId);
    if(!budget){budget={attempt:-Infinity,seq:0,last:-Infinity,phrases:new Map(),times:[]};quickChatBudgets.set(peerId,budget);}
    const at=now();
    // 無効IDを含め受信処理と拒否通知も4件/秒以下。キー/履歴は参加者数と定型数で有界。
    if(at-budget.attempt<quickChatLimits.requestMs)return {ok:false,reason:'連続入力を制限しています'};
    budget.attempt=at;
    const reject=(reason,retryMs=0)=>{
      if(self)quickChatNotice(reason,retryMs);else state.transport.send('quickChatResult',{ok:false,reason,retryMs},peerId);
      return {ok:false,reason,retryMs};
    };
    if(!data||typeof data!=='object'||Array.isArray(data)||!quickChatPhrases.has(data.id)||
      !Number.isSafeInteger(data.seq)||data.seq<=budget.seq||data.seq>budget.seq+1024)return reject('定型通信の番号が正しくありません');
    budget.seq=data.seq;
    const u=self?(typeof player==='undefined'?null:player):unit(p.unitId);
    if(data.phase!==state.phase||data.matchId!==(state.matchId||null)||!quickChatAllowed(u)||
      state.phase==='playing'&&(data.lifeId!==u.lifeId||!self&&(u.controller!=='remoteHuman'||u.ownerPeerId!==peerId)))return reject(quickChatReason());
    budget.times=budget.times.filter(t=>at-t<quickChatLimits.windowMs);
    const wait=Math.max(0,quickChatLimits.gapMs-(at-budget.last),quickChatLimits.sameMs-(at-(budget.phrases.get(data.id)??-Infinity)),
      budget.times.length>=quickChatLimits.burst?quickChatLimits.windowMs-(at-budget.times[0]):0);
    if(wait>0)return reject('連投を制限しています。あと'+Math.ceil(wait/1000)+'秒お待ちください',Math.ceil(wait));
    budget.last=at;budget.times.push(at);budget.phrases.set(data.id,at);
    const team=state.phase==='playing'?u.team:self?state.hostTeam:p.team;
    const message={id:data.id,event:++quickChatEvent,sender:peerId,name:[...String(self?state.transport.displayName||'ホスト':p.name||'ゲスト').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,'')].slice(0,24).join(''),team,scope:state.phase==='lobby'?'all':'team',phase:state.phase,matchId:state.matchId||null};
    if(state.phase==='lobby'||player?.team===team)receiveQuickChat(message);
    for(const recipient of state.peers.values())if(state.phase==='lobby'||unit(recipient.unitId)?.team===team)state.transport.send('quickChat',message,recipient.id);
    return {ok:true};
  }
  function sendQuickChat(id){
    if(!quickChatPhrases.has(id))return quickChatNotice('選べる定型文だけ送信できます');
    if(!quickChatAllowed())return quickChatNotice(quickChatReason());
    if(now()-quickChatLastAttempt<quickChatLimits.requestMs)return quickChatNotice('連続入力を制限しています');
    quickChatLastAttempt=now();
    const data={id,seq:++quickChatSeq,phase:state.phase,matchId:state.matchId||null,lifeId:state.phase==='playing'?player.lifeId:null};
    if(state.role==='host')return acceptQuickChat(data,state.transport.peer.id);
    return state.transport.send('quickChatRequest',data)?{ok:true,pending:true}:quickChatNotice('送信できませんでした');
  }
  // ロビーのReadyは、試合データの読み込み完了（peer.ready）とは別に扱う。
  function hostRoster() {
    return [{id:state.transport?.peer?.id||'host',name:state.transport?.displayName||'ホスト',cls:state.equipment?.cls||'assault',team:state.hostTeam,host:true,ready:state.lobbyReady,editing:state.editing,equipment:state.equipment,equipmentVersion:state.equipmentVersion},
      ...[...state.peers.values()].map(p=>({id:p.id,name:p.name||'ゲスト',cls:p.cls||'assault',team:p.team,host:false,ready:!!p.lobbyReady,editing:!!p.editing,equipment:p.equipment||null,equipmentVersion:p.equipmentVersion||0}))];
  }
  function localMember(){return state.roster.find(p=>p.id===state.transport?.peer?.id);}
  function canStart(){return state.role==='host'&&state.phase==='lobby'&&state.roster.length>=2&&state.roster.every(p=>p.ready&&!p.editing)&&[...state.peers.values()].every(p=>p.preferred);}
  function resetLobbyReady(){state.lobbyRevision++;state.lobbyReady=false;for(const p of state.peers.values())p.lobbyReady=false;}
  function rosterChanged() {
    if(state.role==='host')state.roster=hostRoster();
    const self=localMember();
    if(self){state.lobbyReady=!!self.ready;state.editing=!!self.editing;state.equipmentVersion=self.equipmentVersion;}
    // 装備中の本人だけへ一度。状態が変わっても30秒以内には繰り返さない。
    const nudge=state.phase==='lobby'&&self?.editing&&!self.ready&&state.roster.length>=2&&state.roster.filter(p=>p.id!==self.id).every(p=>p.ready);
    const wasNudging=state.nudgeActive;state.nudgeActive=!!nudge;
    callbacks.onRoster?.(state.roster.map(p=>({...p})));
    if(nudge&&!wasNudging&&(state.lastNudgeAt==null||now()-state.lastNudgeAt>=30000)){
      state.lastNudgeAt=now();callbacks.onNudge?.('ほかのみんなはReadyです。そろそろ行くよ。装備が決まったらReadyを押してください。');
    }
  }
  function lobbyChanged() {
    rosterChanged();callbacks.onSettings?.(state.settings?{...state.settings}:null,state.resolvedMapId);
    if(state.role==='host'&&state.phase==='lobby')state.transport?.broadcast('lobby',{settings:state.settings,resolvedMapId:state.resolvedMapId,roster:state.roster,revision:state.lobbyRevision});
  }
  // 正規カタログの全兵装・武器。兵装と4枠の組み合わせはcheckedEquipmentで検査する。
  function onlineWeapon(key){return Object.hasOwn(WEAPONS,key);}
  function equipmentOptions(cls='assault'){
    if(!roomClasses.includes(cls))throw Error('オンラインの兵装を選んでください');
    return {weapons:Object.fromEntries(SLOTS.map(slot=>[slot,ARMORY[cls][slot].filter(onlineWeapon).map(key=>({id:key,name:WEAPONS[key].name}))])),
      parts:Object.fromEntries(PART_SLOTS.map(slot=>[slot,Object.entries(PARTS[slot]).map(([id,p])=>({id,name:p.model||p.name||id}))])),paints:PAINTS.map(p=>({id:p.id,name:p.name}))};
  }
  function checkedEquipment(input){
    if(!input||!roomClasses.includes(input.cls))throw Error('オンラインの兵装を選んでください');
    const cls=input.cls,loadout=input.loadout||preset(cls),mech=input.mech||MECH_DEFAULT;
    if(!SLOTS.every(k=>typeof loadout[k]==='string'&&ARMORY[cls][k].includes(loadout[k])&&onlineWeapon(loadout[k])))throw Error('オンライン未対応の武器、または兵装に合わない武器です');
    if(!PART_SLOTS.every(k=>typeof mech[k]==='string'&&Object.hasOwn(PARTS[k],mech[k]))||!PAINTS.some(p=>p.id===mech.color))throw Error('機体パーツが正しくありません');
    return {cls,loadout:Object.fromEntries(SLOTS.map(k=>[k,loadout[k]])),mech:Object.fromEntries([...PART_SLOTS,'color'].map(k=>[k,mech[k]]))};
  }
  function setEquipment(input){
    if(state.phase!=='lobby')throw Error('装備はロビーで変更してください');
    const equipment=checkedEquipment(input);
    if(JSON.stringify(equipment)===JSON.stringify(state.equipment))return true;
    if(state.role==='host'){state.equipment=equipment;state.equipmentVersion++;state.lobbyReady=false;lobbyChanged();return true;}
    if(state.role==='guest'){
      if(!state.transport.send('preference',equipment))throw Error('装備の変更を送信できませんでした');
      state.equipmentPending=true;state.lobbyReady=false;return true;
    }
    throw Error('先に部屋へ入ってください');
  }
  function setEditing(editing){
    if(state.phase!=='lobby'||typeof editing!=='boolean')throw Error('装備はロビーで変更してください');
    if(state.role==='host'){state.editing=editing;if(editing)state.lobbyReady=false;lobbyChanged();return true;}
    if(state.role==='guest')return state.transport.send('lobbyEditing',{editing});
    return false;
  }
  function setReady(ready){
    if(state.phase!=='lobby'||typeof ready!=='boolean')throw Error('Readyはロビーで操作してください');
    if(ready&&(state.editing||state.equipmentPending))throw Error('装備を確定してからReadyを押してください');
    if(state.role==='host'){state.lobbyReady=ready;lobbyChanged();return true;}
    if(state.role==='guest')return state.transport.send('lobbyReady',{ready,revision:state.lobbyRevision,equipmentVersion:state.equipmentVersion});
    return false;
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
    const changed=Object.keys(next).some(k=>next[k]!==state.settings[k]);
    state.settings=next;if(changed)resetLobbyReady();lobbyChanged();status(changed?'部屋の設定を更新しました。全員もう一度Readyを押してください':'部屋の設定は変わっていません');return {...next};
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
    assignTeam(id,team);resetLobbyReady();lobbyChanged();return true;
  }
  function chooseTeam(team) {
    if(state.phase!=='lobby'||state.settings?.teamMode!=='choice')throw Error('待機中の希望選択モードだけでチームを選べます');
    if(!['B','R'].includes(team))throw Error('チームを選んでください');
    if(state.role==='host')return setPlayerTeam(state.transport.peer.id,team);
    if(state.role==='guest')return state.transport.send('teamChoice',{team});
    return false;
  }
  function shuffleTeams(forStart=false) {
    requireHostLobby();
    const roster=hostRoster(),shuffled=roster.slice(),first=Math.random()<.5?'B':'R';
    for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    const next=shuffled.map((p,i)=>({id:p.id,team:i%2?(first==='B'?'R':'B'):first}));
    // 同じ並びを偶然引いた場合も、ボタンを押した結果が必ず変わる。
    if(next.every(p=>roster.find(r=>r.id===p.id).team===p.team))for(const p of next)p.team=p.team==='B'?'R':'B';
    for(const p of next)assignTeam(p.id,p.team);
    if(!forStart)resetLobbyReady();lobbyChanged();status('チームをシャッフルしました');return state.roster.map(p=>({...p}));
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
    clearRemoteEquipment();equipmentActions.length=0;clearRemoteShells();
    for(const p of state.peers.values())delete p.replication;remoteUnitHistory.clear();snapshotDecoder=new CBOnlineCodec.Decoder();lastResync=-Infinity;resyncBackoff=250;
    pendingPrepare=null;prepared=false;finalFrame=null;lastSnapshotBaseId=0;pendingSnapshotWires.clear();pendingSnapshotBases.clear();interpolation=interpolationState();
    resetPrediction();resetLocalFire();resetLagCompensation();diagnosticTiming=diagnosticState();
    state.frame = state.seq = 0; state.inputLatency = []; state.hitLatency = []; state.frameMs = []; state.sendMs = [];
    state.shots = []; state.pendingInputs.clear(); state.history = []; state.receivedEvents.clear(); state.events = [];
    state.lastSnapshot = null; state.lastSent = state.nextSnapshotAt = state.lastInput = 0; eventId = projectileId = 0; previousMove=previousTrigger=false; displayedLatencies.length=0;
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
  // 初期装備・同じパーツで生成してから、参加者の部屋専用構成を適用する。保存用の構成には書き戻さない。
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
      const cls = r?.cls || (Object.keys(CLASSES)[u.idx % Object.keys(CLASSES).length]);
      u.controller = 'bot'; u.localView = u.entityId === localId;
      u.isPlayer = u.localView; // 旧い外部試験から読む互換用。動作判定は3関数を使う。
      u.controlLoadout = preset(cls); u.cls = cls; u.nextCls = null;
      equip(u, cls); u.name = r?.name || `Bot ${u.team === 'B' ? 'A' : 'B'}${u.idx + 1}`;
      // 初回写真を適用し終えるまで、生成済みの遠隔機を一瞬も描画しない。
      u.onlineHidden=state.role==='guest'&&!u.localView;u.group.visible=!u.onlineHidden;
    }
    player = unit(localId); state.localUnitId = localId;
    if (!player) throw Error('自機の割り当てがありません');
    player.localView = true; player.isPlayer = true;
    chosenTeam = player.team; chosenCls = player.cls; renderTeamView();
    ended = false; running = false; releaseLock(); resetCombatFeedback();
    $('overlay').hidden = true;
  }
  // 生のmetrics/通信本文/相手IDを診断記録へ渡さない。
  function logSample(){return {role:state.role,phase:state.phase,humans:state.role==='host'?state.peers.size+1:state.roster.length,
    capacity:state.settings?.capacity,teamSize:state.settings?.teamSize,map:state.resolvedMapId,
    diagnostic:diagnostics(),cpu:diagnosticSummary(diagnosticTiming.cpu),transport:state.transport?.diagnostics?.(),interpolation,lagCompensation:lagMetrics};}
  function logCheckpoint(code,reason='none'){diagnosticLog?.checkpoint(code,reason,logSample());}
  function transportOptions(opts) {
    state.onStatus = opts.onStatus || null; callbacks = opts;prediction.enabled=opts.predictionEnabled!==false;
    return { appVersion: (opts.appVersion || localVersion()) + ' / lobby-ready-1 / all-equipment-1 / snapshot-payload-1', peerOptions: opts.peerOptions, latencyMs: opts.latencyMs || 0, snapshotDropRate:opts.snapshotDropRate || 0, inputDropRate:opts.inputDropRate||0,inputRandom:opts.inputRandom,displayName: opts.displayName, capacity:state.settings?.capacity||4,
      onDiagnostic:(code,reason)=>logCheckpoint(code,reason),
      onSnapshotSent:(id,payload)=>rememberPeerSnapshot(id,payload),
      filterEvents:(id,payload)=>filterQueuedEvents(id,payload),
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
        logCheckpoint('peer_joined');
        resetLobbyReady();status(`参加者 ${state.peers.size + 1} 人`); lobbyChanged();
      },
      onPeerLeave: (id, reason) => peerLeft(id, reason), onMessage: onMessage };
  }
  async function create(opts = {}) {
    requireVisibilitySupport();
    const settings=checkedSettings({...defaultSettings,...opts.settings}),equipment=checkedEquipment(opts.equipment||{cls:roomClasses.includes(opts.cls)?opts.cls:'assault'});
    leave('部屋を作り直す'); saveSettings(); resetMeasurements(); state.role = 'host'; state.phase = 'lobby'; running=false; stopSessionAudio();
    lagEnabled=opts.lagCompensationEnabled!==false;
    state.settings=settings;state.resolvedMapId=resolveMap(settings.mapId);state.hostTeam='B';state.equipment=equipment;
    setSimulationRole('host'); state.transport = new CBOnlineTransport(transportOptions(opts));
    diagnosticLog?.begin({role:'host',version:localVersion(),protocol:CBOnlineTransport.PROTOCOL},logSample());
    const transport=state.transport;let id;try{id=await transport.createRoom();}catch(e){logCheckpoint('transport_error',e.message);diagnosticLog?.end(e.message,logSample());throw e;}
    if(state.transport!==transport||state.phase!=='lobby')throw Error('部屋の作成を取り消しました');
    logCheckpoint('connection_ready');
    state.roomId = id; lobbyChanged();status('部屋を作成しました：' + id); return id;
  }
  async function join(roomId, opts = {}) {
    requireVisibilitySupport();
    leave('接続を作り直す'); saveSettings(); resetMeasurements(); state.role = 'guest'; state.phase = 'lobby'; running=false; stopSessionAudio();
    setSimulationRole('guest'); state.transport = new CBOnlineTransport(transportOptions(opts));
    diagnosticLog?.begin({role:'guest',version:localVersion(),protocol:CBOnlineTransport.PROTOCOL},logSample());
    const transport=state.transport;
    try{await transport.connect(roomId);}catch(e){logCheckpoint('transport_error',e.message);diagnosticLog?.end(e.message,logSample());throw e;}
    logCheckpoint('connection_ready');
    if(state.transport!==transport||state.phase!=='lobby')throw Error('入室を取り消しました');
    state.roomId = roomId;
    await transport.waitForClock();
    if(state.transport!==transport||state.phase!=='lobby')throw Error('入室を取り消しました');
    await new Promise((resolve,reject)=>{
      preferenceResolve=resolve;preferenceReject=reject;preferenceTimer=setTimeout(()=>{preferenceResolve=preferenceReject=null;preferenceTimer=null;reject(Error('兵装の確認が時間切れになりました'));},10000);
      transport.send('preference', checkedEquipment(opts.equipment||{cls:roomClasses.includes(opts.cls)?opts.cls:'assault'}));
    });
    if(state.transport!==transport||['ended','leaving','idle'].includes(state.phase))throw Error('入室を取り消しました');
    if(state.phase==='lobby')status('ホストの開始を待っています');
  }
  function start(options = {}) {
    requireVisibilitySupport();
    if (state.role !== 'host' || state.phase !== 'lobby') throw Error('待機中のホストだけが開始できます');
    if (state.peers.size < 1 || state.peers.size + 1 > state.settings.capacity) throw Error('定員内の人間2〜4人で開始してください');
    if(![...state.peers.values()].every(p=>p.preferred))throw Error('ゲストの兵装確認を待ってください');
    if(state.transport.canStartMatch&&!state.transport.canStartMatch())throw Error('写真用の通信経路の準備を待ってください');
    if(options.teamSize!==undefined&&options.teamSize!==state.settings.teamSize)updateSettings({teamSize:options.teamSize});
    if(!canStart())throw Error('人間全員のReadyを待ってください');
    checkedSettings(state.settings);
    if(state.settings.teamMode==='random')shuffleTeams(true);
    const teamSize=state.settings.teamSize,roster=hostRoster(),counts={B:0,R:0};
    if(['B','R'].some(t=>roster.filter(p=>p.team===t).length>teamSize))throw Error('チームの人間数が片軍の人数を超えています');
    const assignments=roster.map(p=>({...p,unitId:p.team+':'+counts[p.team]++}));
    const host=assignments.find(p=>p.host);
    clearStartReservation();state.actualStartAt=null;running=false;stopSessionAudio();
    state.phase = 'preparing';
    clearTimeout(state.prepareTimer);state.prepareTimer=setTimeout(()=>{if(state.role==='host'&&state.phase==='preparing')abortPreparation('ゲストの読み込みが15秒以内に完了しなかったため、開始を中止しました');},15000);
    state.matchId = 'match-' + Date.now().toString(36); state.teamSize = teamSize;resetLagCompensation();
    state.transport.startMatch(state.matchId); setupWorld(teamSize,host.unitId,state.resolvedMapId); player.controller = 'localHuman'; player.name = host.name; applyEquipment(player,host.equipment);
    for (const p of state.peers.values()) {
      p.unitId = assignments.find(r=>r.id===p.id).unitId; p.ready = false; p.last = now(); p.joinedAt = now();
      Object.assign(p,{fixedCommands:true,commandQueue:[],lastCommand:null,fixedStarted:false,fixedClock:0,catchupClock:0,fixedElapsed:0,fixedSteps:0,fixedReplaySeq:0,fixedNeedsResync:false,lastCommandArrival:null,movementActions:[],utilityActions:[],appliedMovementIds:new Set(),appliedMovementActionSeq:0,repeatedCommands:0,droppedCommands:0,inputLifeId:null,input:null,receivedSeq:0,appliedSeq:0,appliedSeqDt:0,appliedTotalDt:0,appliedStep:0,appliedSteps:[],receivedActionSeq:0,appliedActionSeq:0,actions:[]});
      const u = unit(p.unitId); u.controller = 'remoteHuman'; u.onlineFixedMovement=true;u.ownerPeerId = p.id;
      u.name = p.name;applyEquipment(u,p.equipment);
    }
    const initialState=snapshot();
    for (const p of state.peers.values()) {
      const initial=encodePeerSnapshot(p,initialState,true);
      p.lastResync=-Infinity;
      // 開始条件だけを制御線へ。大きな初期基準も写真専用線に載せ、復元できてからreadyにする。
      if(!state.transport.send('prepare', {matchId:state.matchId, teamSize, mapId:state.resolvedMapId, localId:p.unitId},p.id)||
         !state.transport.send('snapshotBase',initial.baseline,p.id)||!state.transport.send('snapshot',initial.wire,p.id)){
        abortPreparation('初期状態が送信上限を超えたため開始できません');return;
      }
    }
    status('ゲストの読み込みを待っています');
  }
  function begin() {
    if(state.phase!=='countdown')return;
    state.actualStartAt=now();state.countdownNumber=0;$('announce').querySelector('[data-online-countdown]')?.remove();tutorialClearInput();
    clearTimeout(state.prepareTimer);state.prepareTimer=null;
    state.phase = 'playing'; running = true; ended = false; state.lastHost = now();state.nextSnapshotAt=0;
    logCheckpoint('match_started');
    // 読み込み＋4秒の開始待ちを回線jitterに数えない。初期状態は残し、対戦中の写真で描画時計を始める。
    if(state.role==='guest'){
      lastRenderedView=null;
      state.history=[];Object.assign(interpolation,{delayMs:100,targetDelayMs:100,intervalMs:SNAPSHOT_INTERVAL_MS,jitterMs:0,lastArrival:null,lastRender:null,renderTime:null,localOffset:null});
    }
    // 早く準備できたゲストも、全員の開始時点から入力待機の猶予を持つ。
    if (state.role === 'host') for (const p of state.peers.values()) p.last = state.lastHost;
    $('overlay').hidden = true; annReset(); announce('作戦開始', 'info'); callbacks.onStarted?.();
  }
  function onMessage(type, data, peerId) {
    if(handleSnapshotControl(type,data,peerId))return;
    if (state.role === 'host') {
      const p = state.peers.get(peerId); if (!p) return;
      if(type==='quickChatRequest'){acceptQuickChat(data,peerId);return;}
      if(type==='preference'&&state.phase==='lobby'){
        try{const equipment=checkedEquipment(data),changed=JSON.stringify(equipment)!==JSON.stringify(p.equipment);
          if(changed){p.equipment=equipment;p.cls=equipment.cls;p.equipmentVersion=(p.equipmentVersion||0)+1;p.lobbyReady=false;}
          p.preferred=true;state.transport.send('preferenceAck',{ok:true,equipment:p.equipment,equipmentVersion:p.equipmentVersion},peerId);lobbyChanged();
        }catch(e){state.transport.send('preferenceAck',{ok:false,reason:e.message},peerId);}return;
      }
      if(type==='lobbyEditing'&&state.phase==='lobby'&&typeof data?.editing==='boolean'){
        p.editing=data.editing;if(p.editing)p.lobbyReady=false;lobbyChanged();return;
      }
      if(type==='lobbyReady'&&state.phase==='lobby'&&typeof data?.ready==='boolean'){
        if(!data.ready)p.lobbyReady=false;
        else if(p.preferred&&!p.editing&&data.revision===state.lobbyRevision&&data.equipmentVersion===p.equipmentVersion)p.lobbyReady=true;
        else state.transport.send('lobbyNotice',{reason:'部屋・装備の変更がありました。確認してもう一度Readyを押してください'},peerId);
        lobbyChanged();return;
      }
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
    if(type==='quickChat'){receiveQuickChat(data);return;}
    if(type==='quickChatResult'){if(data?.ok===false&&typeof data.reason==='string')quickChatNotice(data.reason.slice(0,100),Math.max(0,Math.min(10000,Number(data.retryMs)||0)));return;}
    if(type==='lobby'&&state.phase==='lobby'){
      try{
        const settings=checkedSettings(data?.settings);
        if(!roomMaps.some(m=>m.id===data.resolvedMapId)||!Array.isArray(data.roster)||data.roster.length>settings.capacity||data.roster.some(p=>typeof p.id!=='string'||typeof p.name!=='string'||!['B','R'].includes(p.team)))throw Error('部屋の参加者情報が正しくありません');
        state.settings=settings;state.resolvedMapId=data.resolvedMapId;state.lobbyRevision=data.revision;state.roster=data.roster.map(p=>({...p}));lobbyChanged();
      }catch(e){endGuest(e.message);}return;
    }
    if(type==='teamChoiceResult'){status(data?.ok?'希望するチームへ移動しました':data?.reason||'チームを変更できませんでした');return;}
    if(type==='lobbyNotice'){status(data?.reason||'Readyを確認してください');return;}
    if(type==='preferenceAck'){
      clearTimeout(preferenceTimer);preferenceTimer=null;state.equipmentPending=false;
      if(data?.ok){state.equipment=checkedEquipment(data.equipment);state.equipmentVersion=data.equipmentVersion;preferenceResolve?.();}
      else{const reason=data?.reason||'装備を変更できませんでした';preferenceReject?.(Error(reason));status(reason);}
      preferenceResolve=preferenceReject=null;return;
    }
    if (type === 'reject' || type === 'endHost') { endGuest(data?.reason || 'ホストが退出しました'); return; }
    if (type === 'prepare' && state.phase === 'lobby') {
      if(!visibilitySupport){endGuest('公開範囲を保護する機能を読み込めないため、ネット対戦を開始できません。ページを再読み込みしてください');return;}
      if(!data||typeof data!=='object'||Array.isArray(data)||!state.settings||typeof data.matchId!=='string'||!data.matchId||data.matchId.length>128||data.teamSize!==state.settings.teamSize||data.mapId!==state.resolvedMapId||!roomMaps.some(m=>m.id===data.mapId)||typeof data.localId!=='string'||!/^[BR]:(0|[1-9][0-9]*)$/.test(data.localId)||Number(data.localId.slice(2))>=data.teamSize){endGuest('開始するマップ・人数が部屋の設定と一致しません');return;}
      state.matchId = data.matchId; state.teamSize = data.teamSize;pendingPrepare=data;state.phase='preparing';
      // 制御線だけ先着しても正常な初回写真を重複要求しない。最初の250msは待つ。
      lastResync=now();resyncBackoff=250;retryPendingSnapshots();
    } else if (type === 'begin' && state.phase==='preparing' && prepared && data?.matchId === state.matchId) { countdown(data.startAtHost); }
    else if (type === 'snapshot' && ['lobby','preparing','countdown','playing'].includes(state.phase)) receiveSnapshot(data);
    else if (type === 'matchEnded') receiveMatchEnded(data);
    else if (type === 'lobbyReturn' && ['ended','playing','countdown','preparing'].includes(state.phase) && data?.matchId === state.matchId) {
      if(state.phase!=='ended'){showPage('pgMenu');$('overlay').hidden=false;document.exitPointerLock?.();}
      backToLobby();
    }
    else if (type === 'events' && state.phase === 'playing') playEvents(data);
  }
  function validInput(v) {
    if (!v || typeof v!=='object' || Array.isArray(v) || !Number.isSafeInteger(v.seq) || v.seq<1 ||
      !Number.isSafeInteger(v.actionSeq) || v.actionSeq<0 || !Number.isSafeInteger(v.lifeId) || v.lifeId<1 || !Number.isFinite(v.sentAt)) return false;
    // yawは周回を累積する。pitchは本体の視点範囲、反動は通常上限に余裕を持たせた1radまで。
    if (!Number.isFinite(v.yaw) || Math.abs(v.yaw)>1e6 || !Number.isFinite(v.pitch) || v.pitch<-.9 || v.pitch>.7) return false;
    if (!Array.isArray(v.aimPoint) || v.aimPoint.length !== 3 || !v.aimPoint.every(n => Number.isFinite(n) && Math.abs(n)<1e6)) return false;
    // padとtouchは合算されるので軸は±2を許し、従来どおり受理時に±1へ収める。
    return [['fwd',-2,2],['side',-2,2],['cameraRecoil',0,1],['cameraRecoilYaw',-1,1],['wheel',-1,1]]
      .every(([k,lo,hi])=>v[k]===undefined||Number.isFinite(v[k])&&v[k]>=lo&&v[k]<=hi) &&
      (v.equipmentActions===undefined||Array.isArray(v.equipmentActions)&&v.equipmentActions.length<=8&&v.equipmentActions.every(validEquipmentAction)) &&
      (v.moveActionSeq===undefined||Number.isSafeInteger(v.moveActionSeq)&&v.moveActionSeq>=0&&v.moveActionSeq<=v.actionSeq) &&
      (v.moveActions===undefined||Array.isArray(v.moveActions)&&v.moveActions.length<=8&&v.moveActions.every(row=>
        Array.isArray(row)&&row.length===2&&Number.isSafeInteger(row[0])&&row[0]>=1&&row[0]<=v.actionSeq&&Number.isSafeInteger(row[1])&&row[1]>=1&&row[1]<=7));
  }
  const inputKeys = ['KeyW','KeyS','KeyA','KeyD','KeyR','KeyC','KeyF','KeyH','KeyE','ShiftLeft','ShiftRight','Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Digit1','Digit2','Digit3','Digit4'];
  const pickedKeys=(o,allowed=inputKeys)=>Object.fromEntries(allowed.filter(k=>o?.[k]).map(k=>[k,true]));
  function currentInputLife(p,v) {
    const u=unit(p.unitId),age=now()-v?.sentAt;
    if(!u||v.lifeId!==u.lifeId||!Number.isFinite(v.sentAt)||age>inputLimits.maxAgeMs||age< -inputLimits.futureMs)return null;
    if(p.inputLifeId!==u.lifeId){
      p.inputLifeId=u.lifeId;p.input=null;p.commandQueue=[];p.lastCommand=null;p.fixedStarted=false;p.fixedClock=0;p.catchupClock=0;p.fixedElapsed=0;p.fixedSteps=0;p.fixedReplaySeq=0;p.fixedNeedsResync=false;p.movementActions=[];p.utilityActions=[];p.appliedMovementActionSeq=0;p.appliedMovementIds=new Set();p.appliedSeq=0;p.appliedSeqDt=0;p.inputTimes=[];p.inputHistoryTruncated=false;p.firstInputAt=null;p.pendingEdges={};p.actions=[];p.actionState=null;p.activeAction=null;p.pendingShot=null;p.shotActionSeq=0;
    }
    return u;
  }
  function acceptInput(p,v) {
    if(!validInput(v)||!currentInputLife(p,v))return;
    const fixed=v.command===true,queue=p.commandQueue||=[];
    if(p.fixedCommands&&!fixed)return;
    if(fixed){
      if(v.seq<=(p.appliedSeq||0)||queue.some(x=>x.seq===v.seq)||
        v.seq>(p.receivedSeq||0)+commandLimits.sequenceJump+Math.floor(Math.max(0,now()-(p.lastCommandArrival??now()))/1000/commandLimits.dt))return;
    }else if(v.seq<=p.receivedSeq)return;
    p.receivedSeq=Math.max(p.receivedSeq||0,v.seq);p.last=now();p.lastCommandArrival=now();
    p.firstInputAt??=now();(p.inputTimes||=[]).push({seq:v.seq,at:now()});p.inputTimes.sort((a,b)=>a.seq-b.seq);
    while(p.inputTimes.length>120){p.inputTimes.shift();p.inputHistoryTruncated=true;}
    // 移動の押下だけを命令へ結び付ける。射撃/武器/施設操作はreliable側のまま。
    const value={...safe(v,['seq','lifeId','sentAt','actionSeq','yaw','pitch','cameraRecoil','cameraRecoilYaw']),keys:pickedKeys(v.keys,movementKeys),pressed:{},
      fwd:clamp(v.fwd||0,-1,1),side:clamp(v.side||0,-1,1),aimPoint:v.aimPoint.slice(),lockTarget:typeof v.lockTarget==='string'?v.lockTarget:null,
      receivedAt:now(),view:copyView(v.view)};
    if(fixed){
      value.command=true;value.movePressed=pickedKeys(v.movePressed,movementEdges);
      value.moveActionSeq=Number.isSafeInteger(v.moveActionSeq)&&v.moveActionSeq>0&&v.moveActionSeq<=v.actionSeq?v.moveActionSeq:0;
      if(v.moveActions?.length){
        value.moveActions=v.moveActions.map(row=>row.slice());
        for(const [actionSeq,mask]of value.moveActions)rememberMovementAction(p,{...value,actionSeq,pressed:movementPressed(mask)});
      }else if(value.moveActionSeq)rememberMovementAction(p,{...value,actionSeq:value.moveActionSeq,pressed:value.movePressed});
      p.fixedCommands=true;const u=unit(p.unitId);if(u)u.onlineFixedMovement=true;
      queue.push(value);queue.sort((a,b)=>a.seq-b.seq);
      while(queue.length>commandLimits.queue){queue.shift();p.droppedCommands=(p.droppedCommands||0)+1;}
    }else p.input=value;
  }
  function acceptInputBatch(p,data) {
    if(!Array.isArray(data?.inputs)||!data.inputs.length||data.inputs.length>inputLimits.batch)return;
    // 型変換するsortより先に検証。不正な1件だけを捨て、同じbatchの正常な命令は残す。
    // 逆順batchでも各入力番号で判断。過去batchが最新入力を巻き戻すことはない。
    for(const input of data.inputs.filter(validInput).sort((a,b)=>a.seq-b.seq))acceptInput(p,input);
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
  function rememberMovementAction(p,action){
    const pressed=pickedKeys(action.pressed,movementEdges);
    if(!Object.keys(pressed).length||p.appliedMovementIds?.has(action.actionSeq))return;
    const queue=p.movementActions||=[];
    if(queue.some(a=>a.actionSeq===action.actionSeq))return;
    queue.push({...action,pressed});queue.sort((a,b)=>a.actionSeq-b.actionSeq);
    while(queue.length>inputLimits.actions)queue.shift();
  }
  function acceptInputActions(p,v) {
    // reliable側も照準・反動・wheelまで検証してから、生命/番号/queueを変更する。
    if(!validInput(v)||v.actionSeq<1||v.actionSeq<=(p.receivedActionSeq||0))return;
    const u=currentInputLife(p,v);if(!u||!actionIsRecent(p,v))return;
    p.receivedActionSeq=v.actionSeq;p.last=now();
    const action={...safe(v,['actionSeq','seq','lifeId','sentAt']),receivedAt:now(),trigger:!!v.trigger,alt:!!v.alt,keys:pickedKeys(v.keys,inputKeys.filter(k=>!movementKeys.includes(k))),
      pressed:pickedKeys(v.pressed),wheel:Math.sign(v.wheel||0),weapon:SLOTS.includes(v.weapon)?v.weapon:undefined,equipmentActions:v.equipmentActions?.map(a=>({...a,point:a.point?.slice()}))};
    Object.assign(action,safe(v,['yaw','pitch','cameraRecoil','cameraRecoilYaw']),{aimPoint:v.aimPoint.slice(),view:copyView(v.view)});
    rememberMovementAction(p,action);
    if(action.pressed.KeyH||action.pressed.KeyE){
      (p.utilityActions||=[]).push({...action,pressed:pickedKeys(action.pressed,['KeyH','KeyE'])});
      while(p.utilityActions.length>inputLimits.actions)p.utilityActions.shift();
    }
    (p.actions||=[]).push(action);while(p.actions.length>inputLimits.actions)p.actions.shift();
    // 再出撃先の選択は移動の実行を待たず受理する。古い命の選択はcurrentInputLifeが落とす。
    if(!u.alive||u.transfer){
      if(spawnPoints(u.team).some(x=>x.id===v.spawnChoice))u.spawnChoice=v.spawnChoice;
      if((!u.alive||u.transfer?.base)&&Object.keys(CLASSES).includes(v.nextCls)){u.nextCls=v.nextCls;u.controlLoadout=respawnLoadout(v.nextCls,p);}
    }
  }
  function sendLocalInput(input,deferBatch=false,actionsOnly=false,skipActions=false) {
    const clock=state.transport.clock?.(),sentAt=now()+(Number.isFinite(clock?.offsetMs)?clock.offsetMs:0);
    input.lifeId=player.lifeId;input.sentAt=sentAt;
    // 入力を取った時点で既に描き終わっている写真。今frameの未描画renderTimeとは区別する。
    input.view=copyView(lastRenderedView);
    if(inputSending.lifeId!==input.lifeId){inputSending.history=[];inputSending.signature=null;inputSending.lifeId=input.lifeId;}
    const actionKeys=pickedKeys(input.keys,inputKeys.filter(k=>!movementKeys.includes(k))),edges=pickedKeys(input.pressed);
    const signature=JSON.stringify([input.lifeId,!!input.trigger,!!input.alt,actionKeys,input.spawnChoice,input.nextCls]);
    // 古いcontrolが期限切れなら、現在のheld状態だけを新番号で再送する。失効した押下は複製しない。
    const refresh=inputSending.actionSeq>prediction.lastAckActionSeq&&now()-inputSending.lastActionAt>=inputLimits.maxAgeMs;
    if(!skipActions&&(signature!==inputSending.signature||Object.keys(edges).length||input.wheel||input.weapon||input.equipmentActions?.length||refresh)){
      const action={seq:input.seq,lifeId:input.lifeId,sentAt,actionSeq:++inputSending.actionSeq,trigger:!!input.trigger,alt:!!input.alt,keys:actionKeys,pressed:edges,
        wheel:Math.sign(input.wheel||0),weapon:input.weapon,equipmentActions:input.equipmentActions,spawnChoice:input.spawnChoice,nextCls:input.nextCls,
        ...safe(input,['yaw','pitch','cameraRecoil','cameraRecoilYaw']),aimPoint:input.aimPoint.slice(),view:copyView(input.view)};
      input.actionSeq=action.actionSeq;
      if(!state.transport.send('inputActions',action)){endGuest('操作の送信ができないため対戦を中断しました');return false;}
      inputSending.signature=signature;inputSending.lastActionAt=now();
    }
    input.actionSeq=inputSending.actionSeq;
    if(actionsOnly)return true;
    const movement={...safe(input,['command','moveActions','moveActionSeq','seq','lifeId','sentAt','actionSeq','yaw','pitch','cameraRecoil','cameraRecoilYaw','fwd','side']),keys:pickedKeys(input.keys,movementKeys),
      aimPoint:input.aimPoint,lockTarget:input.lockTarget,view:copyView(input.view),...(input.command?{movePressed:pickedKeys(input.pressed,movementEdges)}:{})};
    inputSending.history.push(movement);while(inputSending.history.length>inputLimits.batch)inputSending.history.shift();
    if(!deferBatch)flushLocalInputs();
    return true;
  }
  function flushLocalInputs(){
    if(!inputSending.history.length)return;
    const latest=inputSending.history.at(-1);
    // 新固定命令を作った描画frameで送る。高Hzの命令なしframeは重複enqueueせず、実wireはtransportのpumpへ任せる。
    const fixed=latest.command;
    if(fixed?latest.seq!==inputSending.lastBatchSeq:now()-inputSending.lastBatch>=inputLimits.sendMs-.001){
      state.transport.send('inputBatch',{inputs:inputSending.history.map(v=>({...v,keys:{...v.keys},aimPoint:v.aimPoint.slice(),view:copyView(v.view)}))});
      inputSending.lastBatch=now();inputSending.lastBatchSeq=latest.seq;
    }
  }

  // 自機は1/60秒の固定命令で進むので、60Hzより速い画面では0歩・1歩のコマが混ざり段になる。
  // 描画だけ直前の1歩の中を補間する（最大1歩=16.7msの見た目の遅れ）。pos・当たり判定・送信は確定値のまま。
  let localStepDelta=null;
  // 描画のずらし＝補正のなめらか戻し＋刻みの補間（本体のonlineViewOffsetと同じ）。無ければnull。
  function viewOffsetOf(u){
    const a=u?.onlineVisualOffset,b=u?.onlineRenderOffset;if(!a&&!b)return null;
    const o=(a||b).clone();if(a&&b)o.add(b);return o;
  }
  function updateLocalRenderOffset(){
    if(!player)return;
    const alpha=clamp(localCommands.accumulator/commandLimits.dt,0,1);
    if(!localStepDelta||localStepDelta.x**2+localStepDelta.y**2+localStepDelta.z**2>4||alpha>=1){delete player.onlineRenderOffset;return;}
    (player.onlineRenderOffset||(player.onlineRenderOffset=vector([0,0,0]))).copy(localStepDelta).multiplyScalar(alpha-1);
  }
  // 先読みできない間（カタパルト・ジャンプ台の飛翔、リフト、ジップライン、格闘の踏み込みなど）は、自機は写真（30Hz）の
  // 位置へ飛び飛びに置かれ、画面ががたつく（2026-11-08 オーナー「カタパルト飛翔時も画面がガタガタ」）。
  // 描画だけ、最後の写真の速度でホスト時刻の今まで（最大100ms）進めた所に置く。確定位置は写真のまま。
  // 写真到着の揺れは毎コマ3割（近接では60Hz相当の秒基準）で寄せる。3m以上の差は即座に合わせる。
  let ownSnapshotTime=null,blockedView=null,meleeRelease=null,localMeleeSwing=null;
  function blockedRenderOffset(dt){
    const reason=player&&Number.isFinite(ownSnapshotTime)&&Number.isFinite(interpolation.localOffset)?
      player.onlinePredictionBlocked||(typeof movementPredictionBlockReason==='function'?movementPredictionBlockReason(player):''):'';
    if(!reason||reason==='inactive'||reason==='transfer'||reason==='planted'){blockedView=null;return false;}
    // 写真の時刻から今までを先へ進める。片道の遅れ＋写真の間隔＋揺らぎで100msを超えることがあり、上限が100msだと
    // そのたびに描画が一瞬止まりかけて次の写真で跳んだ（2026-11-08 揺れ計測 online_jitter_check）。250msまで先読みする（近接は踏み込みの急停止があるので従来どおり100ms）。
    const lead=clamp(now()-interpolation.localOffset-ownSnapshotTime,0,reason==='melee'?100:250)/1000;
    // 宙にいる間（カタパルト・ジャンプ台）は重力も足す。速度だけで先へ置くと、写真の間に上下のずれが二乗で増え、
    // 写真が来るたびに戻って画面が上下に波打つ（2026-11-08 揺れ計測 online_jitter_check で検知）。
    const fall=!player.onGround&&typeof GRAV==='number'?GRAV:0,step=Math.max(0,Math.min(.05,dt||0));
    const target=player.pos.clone().addScaledVector(player.vel,lead);target.y-=.5*fall*lead*lead;
    if(blockedView&&blockedView.lifeId===player.lifeId){
      // 近接の急停止・欠落でも外挿を100ms以内に収める。描画Hzで追従率を変えない。
      const seconds=reason==='melee'?clamp((Math.min(now(),interpolation.localOffset+ownSnapshotTime+100)-(blockedView.time??now()))/1000,0,.05):step;
      const moved=blockedView.pos.clone().addScaledVector(player.vel,seconds);moved.y-=fall*lead*seconds;
      // 写真が来るたびの小さな食い違いは、1コマに1割ずつ寄せる（3割だと写真ごとに速さが2〜3割脈打ち、30Hzのガタつきに見えた。
      // 2026-11-08 揺れ計測 online_jitter_check）。3m以上離れたら寄せずに合わせる。
      if(moved.distanceToSquared(target)<9)target.addScaledVector(moved.addScaledVector(target,-1),reason==='melee'?Math.pow(.7,Math.max(0,dt||0)*60):.9);
    }
    blockedView={pos:target.clone(),lifeId:player.lifeId,reason,time:now()};
    (player.onlineRenderOffset||(player.onlineRenderOffset=vector([0,0,0]))).copy(target).addScaledVector(player.pos,-1);
    return true;
  }
  // 近接終了の引継ぎは初回から250msまで。小補正写真が続いても通常の巻戻しを無期限に置き換えない。
  function finishMeleeRender(dt){
    if(!meleeRelease)return;
    const offset=player.onlineVisualOffset;
    if(!offset||now()>=meleeRelease.until){delete player.onlineVisualOffset;meleeRelease=null;return;}
    offset.multiplyScalar(Math.pow(.7,Math.max(0,dt||0)*60));
    if(offset.x**2+offset.y**2+offset.z**2<1e-6){delete player.onlineVisualOffset;meleeRelease=null;}
  }
  // 自機の剣だけ描画時計を進める。確定swingと攻撃処理は触らず、写真+100ms/振り終端で止める。
  // ホストの低FPSでは写真時計と攻撃時計の進みが違う。確定tの減少/振り変更で新しい攻撃に戻す。
  function localMeleeRenderSwing(u){
    const sw=u.swing;
    if(u!==player||state.role!=='guest'||state.phase!=='playing'||!u.alive||u.downT>0||!sw||!Number.isFinite(ownSnapshotTime)||!Number.isFinite(interpolation.localOffset)){
      if(u===player)localMeleeSwing=null;return sw;
    }
    const key=JSON.stringify(sw.a);
    const same=localMeleeSwing&&localMeleeSwing.lifeId===u.lifeId&&localMeleeSwing.key===key&&sw.t>=localMeleeSwing.rawT;
    const lead=clamp(now()-interpolation.localOffset-ownSnapshotTime,0,100)/1000;
    const t=Math.min(sw.a.time,sw.t+.1,Math.max(same?localMeleeSwing.t:0,sw.t+lead));
    localMeleeSwing={key,lifeId:u.lifeId,rawT:sw.t,t};
    return {...sw,t};
  }
  function stepLocalCommands(input,dt){
    if(localCommands.lifeId!==player.lifeId){localStepDelta=null;delete player.onlineRenderOffset;}
    if(localCommands.lifeId!==player.lifeId)localCommands={accumulator:0,pressed:{},wheel:0,weapon:null,movementActionSeq:0,moveActions:[],lifeId:player.lifeId};
    // 描画間の短い押下/射撃端もcontrolへ直ちに残す。移動命令自体はまだ作らない。
    const sampled={...input,seq:state.seq+1,spawnChoice:player.spawnChoice,nextCls:player.nextCls};
    if(!sendLocalInput(sampled,true,true))return;
    if(movementEdges.some(k=>input.pressed?.[k])){
      localCommands.moveActions.push([sampled.actionSeq,movementMask(input.pressed)]);
      while(localCommands.moveActions.length>8)localCommands.moveActions.shift();
    }
    Object.assign(localCommands.pressed,pickedKeys(input.pressed));
    if(input.wheel)localCommands.wheel=Math.sign(input.wheel);
    if(input.weapon)localCommands.weapon=input.weapon;
    localCommands.accumulator+=Math.min(.05,Math.max(0,dt));
    let generated=0;
    while(localCommands.accumulator+1e-9>=commandLimits.dt&&generated++<commandLimits.maxFrameSteps){
      localCommands.accumulator=Math.max(0,localCommands.accumulator-commandLimits.dt);
      const command={...input,keys:{...input.keys},pressed:{...localCommands.pressed},wheel:localCommands.wheel,weapon:localCommands.weapon||undefined,
        command:true,moveActions:localCommands.moveActions.map(row=>row.slice()),seq:++state.seq,spawnChoice:player.spawnChoice,nextCls:player.nextCls};
      localCommands.pressed={};localCommands.wheel=0;localCommands.weapon=null;localCommands.movementActionSeq=0;localCommands.moveActions=[];
      if(state.pendingInputs.size>600)state.pendingInputs.delete(state.pendingInputs.keys().next().value);
      const moving=!!(command.keys?.KeyW||command.keys?.KeyS||command.keys?.KeyA||command.keys?.KeyD||command.fwd||command.side);
      if(moving&&!previousMove)state.pendingInputs.set(command.seq,{time:now(),pos:player.pos.toArray(),move:true});
      if(command.trigger&&!previousTrigger){state.shots.push({seq:command.seq,time:now(),until:Infinity,done:false});if(state.shots.length>1000)state.shots.shift();}
      if(!command.trigger&&previousTrigger&&state.shots.length)state.shots[state.shots.length-1].until=command.seq;
      previousMove=moving;previousTrigger=!!command.trigger;
      if(!sendLocalInput(command,true,false,true))return;
      const before=player.pos.clone();
      localStepDelta=predictLocalInput(command,commandLimits.dt)?player.pos.clone().addScaledVector(before,-1):null;
    }
    if(!blockedRenderOffset(dt)){updateLocalRenderOffset();finishMeleeRender(dt);}
    // 写真なしでリフト面へ入る場合も、新しい非予測表示へ旧近接の残差を重ねない。
    else if(meleeRelease){meleeRelease=null;delete player.onlineVisualOffset;}
    flushLocalInputs();
  }
  function remoteInput(u) {
    const p=state.peers.get(u.ownerPeerId);
    if(p&&p.inputLifeId!==u.lifeId){p.input=null;p.commandQueue=[];p.lastCommand=null;p.fixedStarted=false;p.fixedClock=0;p.pendingEdges={};p.actions=[];p.activeAction=null;p.actionState=null;p.pendingShot=null;p.shotActionSeq=0;}
    // 行動不能中は移動schedulerが止まる。Fだけはreliable操作から取り出し、downTickの後でACKする。
    // 移動番号の到着/消化は待たず、生命・有効期限・独立action番号の検査は通常どおり使う。
    if(p&&!u.alive&&u.downT>0){
      p.actions=(p.actions||[]).filter(a=>a.lifeId===u.lifeId&&actionIsRecent(p,a));
      p.activeAction=p.actions[0]||null;p.pendingShot=null;u.controlTarget=null;
      return {keys:{},pressed:pickedKeys(p.activeAction?.pressed,['KeyF']),trigger:false,alt:false,yaw:u.yaw,pitch:u.pitch};
    }
    if(!p||!p.input||now()-p.input.sentAt>250||now()-p.last>250){
      if(p){p.pendingEdges={};p.activeAction=null;p.actions=(p.actions||[]).filter(a=>actionIsRecent(p,a));}
      u.controlTarget=null;return {keys:{},pressed:{},trigger:false,alt:false,yaw:u.yaw,pitch:u.pitch,aimPoint:u.aimPos?.toArray()||u.pos.clone().addScaledVector(fwdOf(u),100).toArray()};
    }
    const target=lockEntity(p.input.lockTarget,p);
    u.controlTarget=target&&(!p.replication||(target.gadget?!!p.replication.gadgetPublic?.has(target):!target.entityId||p.replication.visible.has(target.entityId)))&&target.alive&&!target.downT&&target.team!==u.team&&!target.cloak&&lockAllowed(u)&&target.pos.distanceTo(u.pos)<=u.lockRange*1.15*spotMul(u.team,target)&&canSee(u,target,targetPoint(target))?target:null;
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
      pressed:{...p.pendingEdges,...(p.activeAction?.pressed||{})},wheel:p.activeAction?.wheel||0,weapon:p.activeAction?.weapon||undefined,equipmentActions:p.activeAction?.equipmentActions};
    u.onlineInputSeq=p.input.seq;return result;
  }
  function abortPreparation(reason) {
    logCheckpoint('preparation_aborted',reason);
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
    logCheckpoint('peer_departed',reason);
    const preparing=['preparing','countdown'].includes(state.phase);
    if(preparing)abortPreparation('準備中にゲストが退出したため、開始を中止しました');
    const u = unit(p.unitId);
    if (u) { u.controller = 'bot';delete u.onlineFixedMovement; u.ownerPeerId = null; u.controlInput = {}; u.controlTarget = null; u.actionHeld = false; u.actionBlockBoost = false; u.onlineInputSeq = 0; }
    quickChatBudgets.delete(id);state.peers.delete(id);if(state.phase==='lobby')resetLobbyReady(); lobbyChanged(); state.disconnected.push({peer:id,reason,time:now()}); if(!preparing)status(state.phase==='lobby'?'参加者がロビーから退出しました':'ゲストが退出しました。Botが引き継ぎます');
  }
  // 試合の後、同じ部屋の待機へ戻る。ホストは試合終了の通知の直後に全員へ知らせ、ゲストはそれを受けて戻る。
  // 参加者・兵装の確認・部屋の設定はそのまま。結果画面はそのまま見られ、次の試合はホストがロビーから始める。
  function backToLobby(){
    logCheckpoint('lobby_returned');
    clearStartReservation();clearTimeout(state.prepareTimer);state.prepareTimer=null;
    if(state.phase!=='ended'){clearPrediction();running=false;ended=true;tutorialClearInput();stopSessionAudio();}
    state.transport?.returnToLobby?.();
    // 試合の番号（frame）は戻さない。終わった試合の最終frameを後から照合でき、次の試合も番号が増え続ける。
    const lastFrame=state.frame;resetMeasurements();state.frame=lastFrame;
    for(const p of state.peers.values())Object.assign(p,{ready:false,unitId:null,input:null});
    resetLobbyReady();state.editing=false;state.equipmentPending=false;for(const p of state.peers.values())p.editing=false;
    state.roster=state.roster.map(p=>({...p,ready:false,editing:false}));state.nudgeActive=false;state.lastNudgeAt=null;
    state.phase='lobby';state.matchId=null;running=false;ended=true;
    state.matchesFinished=(state.matchesFinished||0)+1;lobbyChanged();callbacks.onLobbyReturn?.();
    status(state.role==='host'?'ロビーに戻りました。同じメンバーで次の試合を始められます':'ロビーに戻りました。ホストの開始を待っています');
  }
  function endGuest(reason) {
    logCheckpoint('match_interrupted',reason);
    clearStartReservation();
    clearPrediction();state.phase = 'ended'; running = false; ended = true; tutorialClearInput();stopSessionAudio();
    status(reason); callbacks.onEnded?.(reason); $('ovTitle').textContent = 'オンライン対戦を中断'; $('ovText').textContent = reason;
    showPage('pgMenu'); $('overlay').hidden = false; document.exitPointerLock?.();
  }
  function leave(reason = '退出') {
    diagnosticLog?.end(reason,logSample());
    resetQuickChat();
    clearRemoteEquipment();equipmentActions.length=0;
    clearStartReservation();clearPrediction();resetLagCompensation();running=false;stopSessionAudio();
    clearTimeout(state.prepareTimer);state.prepareTimer=null;
    clearTimeout(preferenceTimer);preferenceTimer=null;preferenceReject?.(Error(reason));preferenceResolve=preferenceReject=null;
    const t = state.transport;
    state.phase = 'leaving';
    if (t) { if (state.role === 'host') t.broadcast('endHost',{reason}); else t.send('leave',{reason}); t.close(reason); }
    Object.assign(state,{lobbyReady:false,lobbyRevision:0,editing:false,equipment:null,equipmentVersion:0,equipmentPending:false,nudgeActive:false,lastNudgeAt:null});
    state.transport = null; state.role = 'offline'; state.phase = 'idle'; state.matchId=null; state.peers.clear();state.requests.clear();state.settings=null;state.roster=[];state.resolvedMapId=null;state.roomId=null;requestsChanged();lobbyChanged(); state.events=[]; state.history=[];remoteUnitHistory.clear();
    clearRemoteShells();
    setSimulationRole('offline');
    if (saved) {
      running = false; ended = true; tutorialClearInput(); chosenCls = saved.chosenCls; chosenTeam = saved.chosenTeam; selectedTeamSize = saved.selectedTeamSize;
      selectMap(saved.mapId,false); saved = null; $('overlay').hidden = false;
    }
  }
  // 武器ごとのゲーム計算はホストだけ。写真には描画/HUDに必要な値と公開可能な参照だけを載せる。
  function equipmentRef(e){return e?.entityId||(e?.gadget?'gadget:'+gadgets.indexOf(e):null)||(['turret','radar'].includes(e?.kind)?e.kind+':'+(e.kind==='turret'?turrets:radars).indexOf(e):null);}
  function equipmentEntity(id){if(typeof id!=='string')return null;if(id.startsWith('gadget:'))return remoteEquipment.get('g:'+id.slice(7))||null;const m=/^(turret|radar):(\d+)$/.exec(id);return m?(m[1]==='turret'?turrets:radars)[+m[2]]||null:unit(id)||null;}
  function packEquipmentUnit(u){
    const f=u.reflect,b=u.beamFire;
    return {vectors:Object.fromEntries(equipmentVectors.map(k=>[k,u[k]?.toArray()||null])),
      reflect:f?{...safe(f,['phase','t','along']),...Object.fromEntries(['a','at','goal','ground'].map(k=>[k,f[k]?.toArray()||null]))}:null,
      beam:b?{...safe(b,['warm','elapsed','yaw','pitch']),paths:(u.onlineBeamPaths||[]).map(p=>({...p,from:p.from.slice(),dir:p.dir.slice()}))}:null,
      recovery:u.meleeRecovery?{a:u.meleeRecovery.a,...safe(u.meleeRecovery,['t','phi','yaw0','aimed','tilt','slope','pike','chargeStage','chargeRatio','dashAttack','stopped','queued'])}:null,
      missiles:Object.fromEntries(SLOTS.map(k=>{const sl=u.slots[k];return [k,{locks:(sl.missileLocks||[]).map(e=>[equipmentRef(e.target),e.life]),progress:[...(sl.missileProgress||[])].map(([e,n])=>[equipmentRef(e),n]),candidates:(sl.missileCandidates||[]).map(equipmentRef)}];}))};
  }
  function equipmentUnitForPeer(v,view){
    if(!v.equipment)return null;const e=JSON.parse(JSON.stringify(v.equipment));
    const peer=[...state.peers.values()].find(p=>p.unitId===view.viewer.entityId),slots=peer?.replication?.gadgetSlots||[];
    const reference=id=>{if(!id)return null;if(id.startsWith('gadget:')){const g=gadgets[Number(id.slice(7))],slot=slots.find(s=>s?.g===g);return slot?'gadget:'+slot.id:null;}return !unit(id)||view.visible.has(id)?id:null;};
    for(const sl of Object.values(e.missiles)){sl.locks=sl.locks.map(([id,n])=>[reference(id),n]).filter(([id])=>id);sl.progress=sl.progress.map(([id,n])=>[reference(id),n]).filter(([id])=>id);sl.candidates=sl.candidates.map(reference).filter(Boolean);}
    // 背部自動砲の照準と遠距離SPの非公開地点を、可視機体に付けて迂回送信しない。
    if(e.vectors.escortAim&&!view.pointVisible(vector(e.vectors.escortAim)))e.vectors.escortAim=null;
    if(v.id!==view.viewer.entityId){e.vectors.seekAim=null;e.vectors.bombard=null;e.recovery=null;
      if(e.reflect&&!['a','at','goal','ground'].every(k=>!e.reflect[k]||view.pointVisible(vector(e.reflect[k]))))e.reflect=null;
      if(e.beam)e.beam.paths=e.beam.paths.filter(p=>view.pointVisible(vector(p.from))&&view.pointVisible(vector(p.from).addScaledVector(vector(p.dir),p.length)));}
    return e;
  }
  function applyEquipmentUnit(u,e){
    for(const k of equipmentVectors)u[k]=e?.vectors?.[k]?vector(e.vectors[k]):null;
    u.reflect=e?.reflect?{...e.reflect,...Object.fromEntries(['a','at','goal','ground'].map(k=>[k,e.reflect[k]?vector(e.reflect[k]):null]))}:null;
    u.beamFire=e?.beam?{...e.beam}:null;u.onlineBeamPaths=e?.beam?.paths||[];
    u.meleeRecovery=e?.recovery||null;
    for(const k of SLOTS){const sl=u.slots[k],m=e?.missiles?.[k];if(!sl.w?.missile)continue;
      sl.missileLocks=(m?.locks||[]).map(([id,life])=>({target:equipmentEntity(id),life})).filter(e=>e.target);
      sl.missileProgress=new Map((m?.progress||[]).map(([id,n])=>[equipmentEntity(id),n]).filter(([e])=>e));
      sl.missileCandidates=(m?.candidates||[]).map(equipmentEntity).filter(Boolean);}
  }
  function respawnLoadout(cls,p=null){const e=p?.equipment||state.equipment;return {...(e?.cls===cls?e.loadout:preset(cls))};}
  function matchEquipmentLoadouts(){return [...Object.keys(CLASSES).map(preset),...units.map(u=>Object.fromEntries(SLOTS.map(k=>[k,u.slots[k].w.key])))];}
  let gadgetKeyCache=null;
  const gadgetWeaponKey=g=>{gadgetKeyCache||=new Map(Object.entries(WEAPONS).flatMap(([k,w])=>[[w,k],...(w.proj?[[w.proj,k]]:[])]));return gadgetKeyCache.get(g.spec)||'';};
  function visibleEquipmentSources(view){
    const seen=new Set(),add=(o,team,at)=>{if(at&&(team===view.viewer?.team||view.pointVisible(at)))seen.add(o);};
    for(const d of drones)add(d,d.team,d.pos);
    for(const b of barrages){if(b.mesh.visible)add(b,b.team,b.mesh.position);if(b.warn)add(b.warn,b.team,b.warn.position);}
    for(const h of heatFields)add(h,h.team,h.pos);for(const f of stunFields)add(f,f.team,f.mesh.position);
    for(const u of units)if(u.postFlight)add(u.postFlight,u.team,u.postFlight.pos);
    return seen;
  }
  function equipmentObjectsForPeer(view){
    const result=[],publicObjects=new Set(),put=(o,type,at,data)=>{
      if(!at||!(o.team===view.viewer.team||view.pointVisible(at)))return;
      // 非公開の出現・消滅は公開IDの連番にも影響させない。
      const p=[...state.peers.values()].find(p=>p.unitId===view.viewer.entityId),r=replicationFor(p);
      r.objectIds||=new Map();if(!r.objectIds.has(o))r.objectIds.set(o,r.nextObjectId=(r.nextObjectId||0)+1);
      publicObjects.add(o);result.push({id:r.objectIds.get(o),type,team:o.team,pos:at.toArray(),...data});
    };
    for(const d of drones)put(d,'drone',d.pos,{dir:d.dir.toArray(),rotation:d.mesh.rotation.toArray().slice(0,3),spec:safe(d.spec,['scan','keep','hover','alt','dist','speed']),owner:view.visible.has(d.owner?.entityId)?d.owner.entityId:null});
    for(const b of barrages){if(b.mesh.visible)put(b,'artillery',b.mesh.position,{rotation:b.mesh.rotation.toArray().slice(0,3)});if(b.warn){b.warn.team=b.team;put(b.warn,'artilleryWarn',b.warn.position,{});}}
    for(const h of heatFields)put(h,'heat',h.pos,{radius:h.spec.blast,life:h.life,age:h.age||0});
    for(const f of stunFields)put(f,'stun',f.mesh.position,{dir:f.dir.toArray(),len:f.len,width:f.width,height:f.height,life:f.life,max:f.max});
    for(const u of units)if(u.postFlight){u.postFlight.team=u.team;put(u.postFlight,'postFlight',u.postFlight.pos,{key:u.postFlight.w.key,owner:view.visible.has(u.entityId)?u.entityId:null});}
    const peer=[...state.peers.values()].find(p=>p.unitId===view.viewer.entityId),r=replicationFor(peer);
    for(const o of r.objectIds?.keys()||[])if(!publicObjects.has(o))r.objectIds.delete(o);
    r.objectPublic=publicObjects;
    return result;
  }
  function removeRemoteEquipment(id){
    const o=remoteEquipment.get(id);if(!o)return;
    if(o.type==='postFlight'&&o.owner?.postFlight===o)o.owner.postFlight=null;
    if(o.gadget){const i=gadgets.indexOf(o);if(i>=0)gadgets.splice(i,1);const j=mirages.indexOf(o);if(j>=0)mirages.splice(j,1);if(o.owner?.post===o)o.owner.post=null;}
    const i=drones.indexOf(o);if(i>=0)drones.splice(i,1);
    for(const mesh of [o.mesh,o.field,o.warn])if(mesh){scene.remove(mesh);const j=hittables.indexOf(mesh);if(j>=0)hittables.splice(j,1);}
    if(o.type==='heat')removeHeatVisual(o);if(o.bolts)shockDispose(o.bolts);
    if(o.decoyModel){o.decoyModel.geometry.dispose();o.decoyModel.material.dispose();}remoteEquipment.delete(id);
  }
  function packShellVisual(sh){
    const m=sh.mesh;return {kind:sh.spec.kind||'',model:sh.spec.model||'',wave:!!sh.spec.bladeWave,energy:!!sh.energyFrom,style:sh.plasmaVisual?'plasma':sh.chargeVisual?'charge':'',
      rotation:m.rotation.toArray().slice(0,3),scale:m.scale.toArray(),children:m.children.map(o=>({pos:o.position.toArray(),scale:o.scale.toArray(),rotation:o.rotation.toArray().slice(0,3)}))};
  }
  function makeRemoteShell(sh){
    const v=sh.visual;let m;
    if(v?.style)m=cannonShotMesh(v.style);
    else if(v?.model)m=new T.Mesh(weaponGeo(v.model),toolMat[sh.team]);
    else if(v?.wave)m=new T.Mesh(bladeWaveGeo,bladeWaveMat[sh.team]);
    else if(v?.energy)m=new T.Mesh(energyShotGeo,energyShotMat);
    else {m=new T.Mesh(sh.rocket?new T.CylinderGeometry(.2,.2,1.4,8):new T.SphereGeometry(v?.kind==='shell'?.7:.4,8,6),new T.MeshBasicMaterial({color:sh.weak?0xa070ff:BALLISTIC_COLOR}));m.userData.onlineOwned=true;}
    return m;
  }
  function removeRemoteShell(m){scene.remove(m);if(m.userData.onlineOwned){m.geometry.dispose();m.material.dispose();}}
  function clearRemoteShells(){for(const mesh of remoteShells.values())removeRemoteShell(mesh);remoteShells.clear();}
  function clearRemoteEquipment(){for(const id of [...remoteEquipment.keys()])removeRemoteEquipment(id);}
  function applyEquipmentObjects(slots,objects){
    const live=new Set();
    for(const row of slots){if(row[0]!==0)continue;
      const [_,id,kind,team,key,pos,rotation,scale,hp,maxHp,ownerId,meshPos,fieldOn,decoy]=row,token='g:'+id;live.add(token);
      const w=WEAPONS[key],spec=w?.proj||w;if(!spec)continue;let o=remoteEquipment.get(token);
      if(o&&!o.mesh.parent){removeRemoteEquipment(token);o=null;}
      if(!o){
        let mesh,decoyModel=null;
        if(kind==='decoy'){
          // 残像は公開された模型だけを独立生成。隠れている所有者の実体は参照しない。
          const built=buildMech(TEAM[team].color,decoy?.mech||MECH_DEFAULT);
          for(const [part,slot]of [['gun','main'],['blade','aux'],['pack','sp']])if(decoy?.loadout?.[slot])setWeaponGeo(built[part],decoy.loadout[slot]);
          mesh=mirageMesh({group:built.g,flame:built.flame,pos:vector(pos)},spec);disposeMech(built.g);decoyModel=mesh;
        }else mesh=new T.Mesh(weaponGeo(spec.model||key),toolMat[team]);
        o={type:'gadget',gadget:true,onlinePublicId:id,lifeId:1,kind,team,spec,mesh,decoyModel,name:kind==='decoy'?'残像':GADGET_NAME[kind]||w.name,weaponName:w.name,pos:new T.Vector3(),vel:new T.Vector3(),dir:new T.Vector3(),alive:true,owner:null};
        if(kind==='repairPost'){o.field=new T.Mesh(fieldGeo,fieldMat);scene.add(o.field);}
        mesh.userData.ref=o;scene.add(mesh);if(!spec.invulnerable)hittables.push(mesh);gadgets.push(o);if(kind==='decoy')mirages.push(o);remoteEquipment.set(token,o);
      }
      Object.assign(o,{hp,maxHp,owner:equipmentEntity(ownerId),yaw:rotation[1]});o.pos.fromArray(pos);o.mesh.position.fromArray(meshPos||pos);o.mesh.rotation.set(...rotation);o.mesh.scale.fromArray(scale);o.dir.set(-Math.sin(rotation[1]),0,-Math.cos(rotation[1]));
      if(kind==='decoy'&&decoy){o.mesh.material.opacity=decoy.opacity;o.mesh.material.transparent=decoy.opacity<1;}
      if(o.field){o.field.visible=fieldOn;o.field.position.copy(o.pos);o.field.scale.setScalar(spec.radius);if(o.owner)o.owner.post=o;}
    }
    for(const v of objects){const token='o:'+v.id;live.add(token);let o=remoteEquipment.get(token);
      if(!o){
        let mesh,bolts=null;
        if(v.type==='heat')mesh=makeHeatField(vector(v.pos),v.radius);
        else if(v.type==='stun'){mesh=new T.Group();bolts=shockLines(16);mesh.add(bolts);}
        else mesh=new T.Mesh(v.type==='artilleryWarn'?artilleryWarnGeo:v.type==='artillery'?artilleryShellGeo:weaponGeo(v.type==='drone'?'drone':v.key),v.type==='artilleryWarn'?artilleryWarnMat:v.type==='artillery'?shellMat[v.team]:toolMat[v.team]);
        o={type:v.type,team:v.team,mesh,bolts,pos:new T.Vector3(),dir:new T.Vector3(),spec:v.spec||{},owner:equipmentEntity(v.owner)};
        if(v.type==='drone'){mesh.scale.setScalar(1.4);drones.push(o);}
        scene.add(mesh);remoteEquipment.set(token,o);
      }
      // 投擲模型が見えても、持ち主が隠れた写真ではHUD用の参照を残さない。
      if(o.type==='postFlight'&&o.owner?.postFlight===o)o.owner.postFlight=null;
      o.owner=equipmentEntity(v.owner);if(v.spec)o.spec=v.spec;
      if(o.type==='postFlight'){o.w=WEAPONS[v.key];if(o.owner)o.owner.postFlight=o;}
      o.pos.fromArray(v.pos);o.mesh.position.copy(o.pos);o.mesh.visible=v.visible!==false;if(v.rotation)o.mesh.rotation.set(...v.rotation);if(v.dir)o.dir.fromArray(v.dir);
      if(v.type==='artillery'){if(v.warn&&!o.warn){o.warn=new T.Mesh(artilleryWarnGeo,artilleryWarnMat);scene.add(o.warn);}if(o.warn){o.warn.visible=!!v.warn;if(v.warn)o.warn.position.fromArray(v.warn);}}
      if(v.type==='heat'){o.life=v.life;o.age=v.age;heatVisualTick(o,0);}
      if(v.type==='stun'){o.mesh.rotation.y=Math.atan2(v.dir[0],v.dir[2]);shockBolts(o.bolts,16,(x,y,z)=>[x*v.width/2,(y-.5)*v.height,z*v.len/2],.12,.08);shockOpacity(o.bolts,Math.max(0,Math.min(1,v.life/.25)));}
    }
    for(const id of [...remoteEquipment.keys()])if(!live.has(id))removeRemoteEquipment(id);
  }
  function guestEquipmentVisuals(dt){
    for(const u of units){
      if(u.onlineHidden)continue;
      if(u.beamFire&&u.onlineBeamPaths?.length)beamCannonVisual(u,u.onlineBeamPaths.map(p=>({...p,from:vector(p.from),dir:vector(p.dir)})),u.beamFire.warm<=0);
      else if(u.beamVisual)u.beamVisual.root.visible=false;
      const w=u.slots?.[u.weapon]?.w;if(w?.type==='radarTool')emitReconPulse(u,w.arc>=360?'radial':'fan',w.arc);
    }
    reflectorUpdate();
    for(const o of remoteEquipment.values()){
      if(o.kind==='sensor')emitReconPulse(o,o.spec.planar?'plane':o.spec.col?'down':o.spec.cone?'fan':'radial',o.spec.cone||360);
      if(o.type==='drone')emitReconPulse(o,'down');
      if(o.type==='heat')heatVisualTick(o,dt);
    }
  }
  const equipmentActionKinds=['mapConfirm','mapCancel','beamCancel','scopeCycle','seekToggle'];
  function validEquipmentAction(a){return !!a&&equipmentActionKinds.includes(a.kind)&&(a.point===undefined||Array.isArray(a.point)&&a.point.length===3&&a.point.every(n=>Number.isFinite(n)&&Math.abs(n)<1e6));}
  function queueEquipmentAction(kind,point){if(state.role!=='guest'||state.phase!=='playing')return false;if(equipmentActions.length<8)equipmentActions.push({kind,...(point?{point:point.toArray()}: {})});return true;}
  function applyEquipmentActions(u,input){
    for(const a of input.equipmentActions||[]){
      if(a.kind==='mapConfirm'&&a.point&&isArtilleryMode(u))artilleryConfirm(u,vector(a.point));
      if(a.kind==='mapCancel')stopArtillery(u);
      if(a.kind==='beamCancel')stopBeamCannon(u,true);
      if(a.kind==='scopeCycle'&&u.slots[u.weapon].w.scopeHigh&&!u.repairing&&!u.transfer&&u.switchT<=0)u.scopeStep=((u.scopeStep||0)+1)%3;
      if(a.kind==='seekToggle'&&seekerHeld(u))setSeekMode(u,!u.seekMode);
    }
  }
  for(const [name,kind]of [['artilleryConfirm','mapConfirm'],['reflectorConfirm','mapConfirm'],['stopArtillery','mapCancel'],['stopBeamCannon','beamCancel'],['setSeekMode','seekToggle']]){
    const old=globalThis[name];if(typeof old!=='function')continue;globalThis[name]=function(u,arg){if(u===player&&state.role==='guest'&&state.phase==='playing'&&(kind!=='beamCancel'||arg===true)){queueEquipmentAction(kind,kind==='mapConfirm'?arg:null);if(kind==='mapCancel'){mapOpen=false;mouseDown=rightDown=false;}return true;}return old.apply(this,arguments);};
  }
  if(typeof aimPress==='function'){const oldEquipmentAimPress=aimPress;aimPress=function(button,pad){
    const cycle=state.role==='guest'&&state.phase==='playing'&&button===2&&player?.slots[player.weapon]?.w.scopeHigh,previous=player?.scopeStep;
    const result=oldEquipmentAimPress(...arguments);if(cycle){player.scopeStep=previous;queueEquipmentAction('scopeCycle');}return result;
  };}
  if(typeof deployMirage==='function'){const old=deployMirage;deployMirage=function(u){const g=old(...arguments);if(g&&state.role==='host')g.onlineAppearance={mech:{...u.mech},cls:u.cls,loadout:Object.fromEntries(SLOTS.map(k=>[k,u.slots[k].w.key]))};return g;};}
  if(typeof beamCannonVisual==='function'){const oldBeamVisual=beamCannonVisual;beamCannonVisual=function(u,paths,active){if(state.role==='host')u.onlineBeamPaths=paths.map(p=>({...p,from:p.from.toArray(),dir:p.dir.toArray()}));return oldBeamVisual(...arguments);};}

  function packUnit(u) {
    return {id:u.entityId,team:u.team,idx:u.idx,cls:u.cls,name:u.name,controller:u.controller,mech:u.mech,motionEpoch:u.onlineMotionEpoch||0,lagEpoch:u.onlineLagEpoch||0,renderCrouch:u.rig?.crouch||0,
      ...safe(u,scalarKeys),pos:u.pos.toArray(),vel:u.vel.toArray(),predictionBlocked:typeof movementPredictionBlockReason==='function'?movementPredictionBlockReason(u):'',
      motionVectors:Object.fromEntries(['dashDir','boostVisualDir','catMomentum','lungeDir'].map(k=>[k,u[k]?.toArray()||null])),
      healTarget:equipmentRef(u.healTarget),equipment:packEquipmentUnit(u),catLaunch:u.catLaunch?{...u.catLaunch}:null,jumpPadIndex:u.jumpPad?jumpPads.indexOf(u.jumpPad):-1,sc:{...u.sc},zipLine:u.zip?ziplines.indexOf(u.zip.line):-1,
      swing:u.swing ? {a:u.swing.a,...safe(u.swing,['t','phi','yaw0','aimed','tilt','slope','pike','chargeStage','chargeRatio','dashAttack','stopped','queued'])} : null,
      transfer:u.transfer ? safe(u.transfer,['t','base','at']) : null,
      slots:Object.fromEntries(SLOTS.map(k=>[k,{key:u.slots[k].w.key,...safe(u.slots[k],slotKeys)}]))};
  }
  function snapshot(stateTime=now()) {
    const s={frame:state.frame,time:stateTime,timeLeft,running,ended,hostTiming:diagnosticHostTiming(),teamSize:state.teamSize,units:units.map(packUnit),
      cores:{B:cores.B.hp,R:cores.R.hp},
      spotted:Object.fromEntries(['B','R'].map(k=>[k,[...spotted[k]].filter(([u])=>u.entityId).map(([u,left])=>[u.entityId,left])])),
      spotSrc:Object.fromEntries(['B','R'].map(k=>[k,[...spotSrc[k]].filter(([u])=>u.entityId).map(([u,m])=>[u.entityId,[...m]])])),
      plants:plants.map(p=>safe(p,['id','owner','gauge','capturing','contested'])),
      turrets:turrets.map(p=>safe(p,['hp','alive','yaw','revive','team'])),radars:radars.map(p=>({...safe(p,['hp','alive','revive']),headYaw:p.head.rotation.y,intruders:p.intruders.map(u=>u.entityId)})),
      barricades:barricades.map(p=>safe(p,['hp','alive'])),
      mobility:{lifts:lifts.map(l=>({pos:l.pos.toArray(),direction:l.direction,waitT:l.waitT,blocked:l.blocked})),
        jumpPads:jumpPads.map(p=>p.flash),catapults:catapults.map(p=>({flash:p.flash,opacity:p.film.material.opacity}))},
      shells:shells.map(s=>({id:s.onlineId||(s.onlineId=++projectileId),pos:s.pos.toArray(),vel:s.vel.toArray(),rocket:!!s.spec.rocket,weak:!!s.spec.weak,team:s.team,visual:packShellVisual(s)})),
      acks:Object.fromEntries([...state.peers.values()].map(p=>[p.unitId,p.appliedSeq])),
      inputAcks:Object.fromEntries([...state.peers.values()].map(p=>[p.unitId,{fixed:!!p.fixedCommands,replaySeq:p.fixedReplaySeq||0,movementSeq:p.appliedMovementActionSeq||0,movementIds:[...(p.appliedMovementIds||[])],seq:p.appliedSeq||0,step:p.appliedStep||0,seqDt:p.appliedSeqDt||0,actionSeq:p.appliedActionSeq||0,totalDt:p.appliedTotalDt||0,
        // 写真以前のdtをもう一度適用しない。写真欠落後も累積境界だけで復元でき、最近8stepは検証用に残す。
        steps:(p.appliedSteps||[]).slice(-predictionLimits.wireSteps)}]))};
    if(state.role==='host')rememberLagSnapshot(s);return s;
  }
  function replicationFor(p){
    return p.replication||=( {encoder:new CBOnlineCodec.Encoder(),latestWire:null,visible:new Set(),epochs:new Map(),signature:null,tick:0,sent:new Map(),queued:new Map(),eventCache:new Map()} );
  }
  function createPeerView(p){
    const viewer=p?.unitId?unit(p.unitId):null;
    // 未割当・機能欠落時はオフラインや前試合の世界を公開しない。
    if(!viewer||!visibilitySupport)return {viewer:null,visible:new Set(),cadence:new Map(),sourceVisible:()=>false,pointVisible:()=>false,gadgetVisible:()=>false};
    const lineOfSight=(observer,at,ref)=>{
      const eye=observer.pos.clone();eye.y+=3;const dir=at.clone().sub(eye),distance=dir.length();if(distance<.001)return true;
      const hit=castFrom(eye,dir.multiplyScalar(1/distance),observer,distance+.5);
      return !hit||hit.ref===ref||hit.dist>=distance-.6;
    };
    return visibilitySupport.createView({viewer,units,spotted,noticed,canSee,targetPoint,lineOfSight,locksPlayer:typeof locksPlayer==='function'?locksPlayer:null});
  }
  // 実機のoptional値から枠の形を作らない。秘匿中に装備・行動が変わっても同じ値になる。
  function fixedUnitForPeer(v,hidden,epoch,own=true){
    const value={fixedUnit:true,id:v.id,hidden:!!hidden,visibilityEpoch:epoch,
      team:hidden?'':v.team,idx:hidden?0:v.idx,cls:hidden?'':v.cls,controller:hidden?'':v.controller,
      mech:hidden?null:v.mech||null,motionEpoch:hidden?0:v.motionEpoch||0,lagEpoch:hidden?0:v.lagEpoch||0,renderCrouch:hidden?0:v.renderCrouch||0,
      pos:hidden?[0,0,0]:v.pos,vel:hidden?[0,0,0]:v.vel,predictionBlocked:hidden?'':v.predictionBlocked||'',
      motionVectors:Object.fromEntries(['dashDir','boostVisualDir','catMomentum','lungeDir'].map(k=>[k,hidden?null:v.motionVectors?.[k]||null])),
      healTarget:hidden?null:v.healTarget||null,equipment:hidden?null:v.equipment||null,catLaunch:hidden?null:v.catLaunch||null,jumpPadIndex:hidden?-1:v.jumpPadIndex??-1,zipLine:hidden?-1:v.zipLine??-1,
      swing:hidden?null:v.swing||null,transfer:hidden?null:v.transfer||null,
      slots:Object.fromEntries(SLOTS.map(k=>[k,{key:hidden?'':v.slots?.[k]?.key||'',...Object.fromEntries((own?slotKeys:remoteSlotKeys[k]).map(f=>[f,hidden?null:v.slots?.[k]?.[f]??null]))}]))};
    for(const k of scalarKeys)value[k]=hidden?null:v[k]??null;
    return value;
  }
  // 試合開始時の公開装備集合と再出撃用初期装備から上限を固定。秘匿中の設置/消去で枠数を変えない。
  function gadgetPolicyForLoadouts(loadouts){
    const specs=new Set(),special=new Set();let perUnit=0;
    for(const key of new Set(loadouts.flatMap(loadout=>Object.values(loadout)))){
      const w=WEAPONS[key];if(!w)continue;
      if(w.proj&&Number.isSafeInteger(w.proj.max)&&w.proj.max>0&&!specs.has(w.proj)){specs.add(w.proj);perUnit+=w.proj.max;}
      if(w.type==='mirage')special.add('decoy');
      if(w.type==='repairPost')special.add('repairPost');
    }
    if(special.has('decoy'))perUnit+=4;if(special.has('repairPost'))perUnit++;
    return {specs,special,perUnit};
  }
  function gadgetCapacityForLoadouts(loadouts,unitCount=units.length){return gadgetPolicyForLoadouts(loadouts).perUnit*unitCount;}
  function permittedGadgets(p,view){
    const r=replicationFor(p),policy=r.gadgetPolicy||=(gadgetPolicyForLoadouts(matchEquipmentLoadouts()));
    return (typeof gadgets!=='undefined'?gadgets:[]).filter(g=>g.alive!==false&&(policy.specs.has(g.spec)||policy.special.has(g.kind))&&(!g.attached||view.visible.has(g.attached.entityId))&&view.gadgetVisible(g));
  }
  function gadgetSlotsForPeer(p,view=createPeerView(p)){
    const r=replicationFor(p),policy=r.gadgetPolicy||=(gadgetPolicyForLoadouts(matchEquipmentLoadouts()));
    if(r.gadgetCapacityPolicy!==policy){r.gadgetCapacityPolicy=policy;r.gadgetCapacity=policy.perUnit*units.length;r.gadgetSlots=Array(r.gadgetCapacity).fill(null);}
    const capacity=r.gadgetCapacity,live=typeof gadgets!=='undefined'?gadgets:[],eligible=permittedGadgets(p,view),set=new Set(eligible);
    for(let i=0;i<capacity;i++)if(r.gadgetSlots[i]&&!set.has(r.gadgetSlots[i].g))r.gadgetSlots[i]=null;
    let omitted=live.filter(g=>g.alive!==false&&!policy.specs.has(g.spec)&&!policy.special.has(g.kind)).length;
    for(const g of eligible)if(!r.gadgetSlots.some(slot=>slot?.g===g)){
      const index=r.gadgetSlots.indexOf(null);if(index<0){omitted++;continue;}
      r.gadgetSlots[index]={g,id:r.nextGadgetId=(r.nextGadgetId||0)+1};
    }
    r.gadgetOmitted=Math.min(65535,omitted); // ローカル診断だけ。隠れた個数をwireへ載せない。
    return r.gadgetSlots.map(slot=>{
      if(!slot)return [1];const {g,id}=slot,mesh=g.mesh;
      return [0,id,g.kind,g.team,gadgetWeaponKey(g),g.pos.toArray(),[mesh?.rotation.x||0,mesh?.rotation.y||0,mesh?.rotation.z||0],
        [mesh?.scale.x??1,mesh?.scale.y??1,mesh?.scale.z??1],g.hp||0,g.maxHp||0,
        view.visible.has(g.owner?.entityId)?g.owner.entityId:null,mesh?.position.toArray()||g.pos.toArray(),!!g.field?.visible,
        g.kind==='decoy'?{...(g.onlineAppearance||={mech:{...g.owner.mech},cls:g.owner.cls,loadout:Object.fromEntries(SLOTS.map(k=>[k,g.owner.slots[k].w.key]))}),yaw:g.yaw,opacity:mesh.material.opacity}:null];
    });
  }
  function snapshotForPeer(p,full=null,forceAll=false){
    requireVisibilitySupport();
    if(!p?.unitId||!unit(p.unitId))throw Error('対戦機体が割り当てられていない参加者へ写真を送れません');
    full||=snapshot();
    const r=replicationFor(p),view=createPeerView(p),viewer=view.viewer;
    const gadgetRows=gadgetSlotsForPeer(p,view);
    const ordered=full.units.slice().sort((a,b)=>a.id.localeCompare(b.id));let mask=0;
    const spatial=ordered.map((v,i)=>{
      const hidden=!view.visible.has(v.id);
      if(hidden&&!r.epochs.has(v.id))r.epochs.set(v.id,1);
      if(!hidden&&!r.visible.has(v.id))r.epochs.set(v.id,(r.epochs.get(v.id)||0)+1);
      // hiddenは毎回適用する。codecが基準の非公開値を中立化し、最初のhide欠落からも復旧する。
      if(hidden||forceAll||!r.visible.has(v.id)||(r.tick+i)%view.cadence.get(v.id)===0)mask|=1<<i;
      const packed=fixedUnitForPeer(v,hidden,r.epochs.get(v.id)||1,v.id===p.unitId);
      if(!hidden){packed.equipment=equipmentUnitForPeer(v,view);if(unit(packed.healTarget)&&!view.visible.has(packed.healTarget))packed.healTarget=null;}
      return packed;
    });
    const own=viewer.team,foe=own==='B'?'R':'B';
    return {...full,units:spatial,unitUpdates:mask,
      roster:full.units.map(v=>({id:v.id,team:v.team,idx:v.idx,name:v.name,cls:v.cls,sc:{...v.sc}})),
      gadgets:gadgetRows,equipmentObjects:equipmentObjectsForPeer(view),
      spotted:Object.fromEntries(['B','R'].map(team=>[team,team===own?(full.spotted?.[team]||[]).filter(([id])=>view.visible.has(id)):[]])),
      spotSrc:Object.fromEntries(['B','R'].map(team=>[team,team===foe?(full.spotSrc?.[team]||[]).filter(([id])=>id===p.unitId):[]])),
      radars:full.radars.map((v,i)=>({...v,intruders:radars[i]?.team===own?v.intruders.filter(id=>view.visible.has(id)):[]})),
      acks:{[p.unitId]:full.acks?.[p.unitId]||0},
      inputAcks:full.inputAcks?.[p.unitId]?{[p.unitId]:full.inputAcks[p.unitId]}:{},
      shells:full.shells.filter(value=>{
        const sh=shells.find(sh=>sh.onlineId===value.id);if(!sh)return false;
        if(sh.team===own)return true;
        if(['mine','remote','sensor','sentry'].includes(sh.spec.kind))return view.gadgetVisible({...sh,gadget:true,kind:sh.spec.kind});
        return view.sourceVisible(sh.owner)&&view.pointVisible(sh.pos);
      })};
  }
  function encodePeerSnapshot(p,full=null,forceAll=false,forceBaseline=false){
    const r=replicationFor(p),s=snapshotForPeer(p,full,forceAll),publicUnits=s.units.filter(v=>!v.hidden),signature=publicUnits.map(v=>v.id+':'+v.visibilityEpoch).join('|')+';'+s.gadgets.map((v,i)=>v[0]===0?i+':'+v[1]:'').join('|')+';'+s.equipmentObjects.map(v=>v.id).join('|'),changed=signature!==r.signature;
    if(changed){state.transport?.dropPendingSnapshots?.(p.id);r.queued.clear();}
    const rebase=r.encoder.willRebase?.(s,{forceBaseline})??(!r.encoder.currentBase()||forceBaseline);
    if(rebase||forceAll)s.unitUpdates=(1<<s.units.length)-1;
    const encoded=r.encoder.encode(s,{forceBaseline,includePath:path=>path[0]!=='units'||['id','fixedUnit','hidden','visibilityEpoch'].includes(path[2])||s.units[path[1]]?.hidden||!!(s.unitUpdates&(1<<path[1]))});
    const wire={frame:s.frame,delta:encoded.delta};r.latestWire=wire;r.signature=signature;r.visible=new Set(publicUnits.map(v=>v.id));r.gadgetPublic=new Set((r.gadgetSlots||[]).filter(Boolean).map(slot=>slot.g));r.tick++;
    const updates=new Map(s.units.filter((v,i)=>!v.hidden&&(s.unitUpdates&(1<<i))).map(v=>[v.id,{time:s.time,epoch:v.visibilityEpoch,lifeId:v.lifeId,motionEpoch:v.motionEpoch||0,lagEpoch:v.lagEpoch||0}]));
    r.queued.set(s.frame,{time:s.time,baseId:encoded.delta[1],delta:JSON.stringify(encoded.delta),visible:new Map(publicUnits.map(v=>[v.id,v.visibilityEpoch])),updates});
    while(r.queued.size>128)r.queued.delete(r.queued.keys().next().value);
    return {baseline:encoded.baseline,wire,snapshot:s};
  }
  function rememberPeerSnapshot(id,payload){
    const p=state.peers.get(id),r=p?.replication,record=r?.queued.get(payload?.frame);
    if(!record||record.baseId!==payload?.delta?.[1]||record.delta!==JSON.stringify(payload.delta))return;
    r.sent.set(payload.frame,record);r.queued.delete(payload.frame);
    for(const [frame,v]of r.sent)if(v.time<record.time-2000)r.sent.delete(frame);
    while(r.sent.size>128)r.sent.delete(r.sent.keys().next().value);
  }
  function validPeerSnapshot(s){
    if(s.unitUpdates===undefined)return true; // 旧い単体fixtureとの互換。製品v8は常にmaskを載せる。
    if(!Number.isSafeInteger(s.unitUpdates)||s.units.length>20||s.unitUpdates<0||s.unitUpdates>=(1<<s.units.length)||!Array.isArray(s.roster)||s.roster.length>20)return false;
    const roster=new Set();
    for(const v of s.roster){if(!v||typeof v.id!=='string'||roster.has(v.id)||typeof v.name!=='string'||!['B','R'].includes(v.team)||!v.sc||typeof v.sc!=='object')return false;roster.add(v.id);}
    const ids=new Set();
    if(s.units.some(v=>v?.fixedUnit)&&s.units.length!==s.roster.length)return false;
    for(const v of s.units){
      if(!v||!roster.has(v.id)||ids.has(v.id)||!Number.isSafeInteger(v.visibilityEpoch)||v.visibilityEpoch<1||!['pos','vel'].every(k=>Array.isArray(v[k])&&v[k].length===3&&v[k].every(Number.isFinite)))return false;
      if(v.fixedUnit&&(typeof v.hidden!=='boolean'||v.hidden&&(v.pos.some(x=>x!==0)||v.vel.some(x=>x!==0))))return false;
      if(v.id===(pendingPrepare?.localId||state.localUnitId)&&v.hidden)return false;
      ids.add(v.id);
    }
    return ids.has(pendingPrepare?.localId||state.localUnitId);
  }
  function hideRemoteUnit(u){
    if(u===player)return;
    u.onlineHidden=true;u.group.visible=false;u.reflect=null;u.beamFire=null;u.onlineBeamPaths=[];remoteUnitHistory.delete(u.entityId);
    for(const mesh of [u.fieldMesh,u.barrierMesh,u.beam,u.shockFx?.root,u.beamVisual?.root,u.reflectVisual?.root,u.postFlight?.mesh])if(mesh)mesh.visible=false;
    if(typeof stopMovementSound==='function')stopMovementSound(u);
    if(u.tagEl)u.tagEl.style.display='none';
    if(typeof lock!=='undefined'&&lock.target===u)releaseLock();
  }
  function interpolatePeerUnits(target){
    for(const [id,h]of remoteUnitHistory){
      const u=unit(id);if(!u||u.onlineHidden||u===player)continue;
      const samples=h.samples,last=samples.at(-1);if(!last)continue;
      let a=last,b=last,time=last.time,f=0;
      if(!h.snap&&u.alive&&!u.downT&&!last.unit.transfer){
        if(target>=last.time)time=Math.min(target,last.time+100);
        else if(target>=samples[0].time){
          a=samples[0];b=a;for(let i=1;i<samples.length;i++){a=samples[i-1];b=samples[i];if(b.time>=target)break;}
          time=Math.max(a.time,Math.min(target,b.time));f=clamp((time-a.time)/Math.max(.001,b.time-a.time),0,1);
        }
      }
      if(time>last.time){u.pos.copy(vector(last.unit.pos)).addScaledVector(vector(last.unit.vel),(time-last.time)/1000);u.yaw=last.unit.yaw;interpolateRemotePose(u,last.unit,last.unit,0);}
      else {u.pos.copy(vector(a.unit.pos)).lerp(vector(b.unit.pos),f);u.yaw=a.unit.yaw+wrapAngle(b.unit.yaw-a.unit.yaw)*f;interpolateRemotePose(u,a.unit,b.unit,f);}
      h.stamp=[visibilitySupport.unitNumber(id),a.frame,b.frame,Math.round(time*1000)/1000,u.onlineVisibilityEpoch];
      h.snap=false;
    }
  }
  function eventsForPeer(p,events,view=createPeerView(p)){
    return events.filter(e=>{
      const d=e.data||{};
      if(e.type==='hit'||personalEvents.has(e.type))return d.unit===p.unitId;
      if(!view.sourceVisible(e.source)||!view.sourceVisible(e.target))return false;
      if(d.unit&&!view.visible.has(d.unit))return false;
      if(e.type==='sfx'&&!d.at)return d.unit===p.unitId||d.name==='capture';
      const points=[d.at,d.from,d.end].filter(Boolean).map(vector);
      if(points.some(at=>!view.pointVisible(at)))return false;
      // source無しの古い表示呼出しも、秘匿機体/設置物の位置を偶然含めない。
      if(points.some(at=>units.some(u=>u.team!==view.viewer?.team&&!view.visible.has(u.entityId)&&at.distanceTo(u.pos)<6)||
        typeof gadgets!=='undefined'&&gadgets.some(g=>!view.gadgetVisible(g)&&at.distanceTo(g.pos)<3)))return false;
      return true;
    }).map(({id,type,data})=>({id,type,data}));
  }
  // 本人にだけ送る手応え（撃破・破壊・蘇生の札、得点、被弾の方向）。本体は遠隔の人間に対して remoteFeedback を呼ぶ。
  const personalEvents=new Set(['popup','score','hurt']);
  // 本体が window.CBOnlineGame?.remoteFeedback で呼ぶ（公開は下の CBOnlineGame の後で足す）。
  function remoteFeedback(u,type,data){
    if(state.role!=='host'||state.phase!=='playing'||!personalEvents.has(type)||u?.controller!=='remoteHuman'||!u.entityId)return;
    emit(type,{...data,unit:u.entityId},u,null);
  }
  function filterQueuedEvents(id,payload){
    const p=state.peers.get(id);if(!p)return [];
    const r=replicationFor(p),events=[];
    for(const e of payload||[]){const saved=r.eventCache.get(e.id);if(saved)events.push(saved);else if((e.type==='hit'||personalEvents.has(e.type))&&e.data?.unit===p.unitId)events.push(e);}
    return eventsForPeer(p,events);
  }
  function replaceMech(u,mech){
    if(Object.keys(mech).every(k=>u.mech?.[k]===mech[k]))return;
    const old=u.group,m=buildMech(TEAM[u.team].color,mech);
    for(let i=hittables.length-1;i>=0;i--)if(refOf(hittables[i])===u)hittables.splice(i,1);
    scene.remove(old);disposeMech(old);scene.add(m.g);u.blade2=null;
    Object.assign(u,{mech:{...mech},group:m.g,gun:m.gun,gun2:m.gun2,flame:m.flame,blade:m.blade,pack:m.pack,mount:m.mount,armorMat:m.armor,rig:m.rig,hoverJet:m.hoverJet});
    m.g.rotation.order='YXZ';m.g.position.copy(u.pos);m.g.rotation.y=u.yaw;
    m.g.traverse(o=>{if(o.isMesh&&!o.userData.visualOnly){o.userData.ref=u;hittables.push(o);}});
  }
  function applyEquipment(u,equipment){replaceMech(u,equipment.mech);u.controlLoadout={...equipment.loadout};equip(u,equipment.cls);}
  function applyUnit(u,s) {
    if(u===player&&(!s.swing||u.lifeId!==s.lifeId||u.onlineMotionEpoch!==(s.motionEpoch||0)||u.onlineLagEpoch!==(s.lagEpoch||0)||u.cls!==s.cls))localMeleeSwing=null;
    const mechChanged=!!s.mech&&Object.keys(s.mech).some(k=>s.mech[k]!==u.mech?.[k]);
    if(mechChanged)replaceMech(u,s.mech);
    if (mechChanged || (u.onlineRenderClass??u.cls) !== s.cls || SLOTS.some(k=>s.slots[k]?.key!==u.slots[k]?.w.key)) {
      if(u===player)localMeleeSwing=null;
      u.controlLoadout=Object.fromEntries(SLOTS.map(k=>[k,WEAPONS[s.slots[k]?.key]?s.slots[k].key:CLASSES[s.cls][k]]));equip(u,s.cls);
    }
    u.onlineHidden=false;u.onlineRenderClass=s.cls;u.onlineVisibilityEpoch=s.visibilityEpoch||0;
    const localYaw = u.yaw, localPitch = u.pitch;
    u.onlineMotionEpoch=s.motionEpoch||0;u.onlineLagEpoch=s.lagEpoch||0;u.onlinePredictionBlocked=s.predictionBlocked||'';
    u.onlineRenderCrouch=Number.isFinite(s.renderCrouch)?s.renderCrouch:null;
    for(const k of ['dashDir','boostVisualDir','catMomentum','lungeDir'])u[k]=s.motionVectors?.[k]?vector(s.motionVectors[k]):null;
    u.catLaunch=s.catLaunch?{...s.catLaunch}:null;u.healTarget=equipmentEntity(s.healTarget);applyEquipmentUnit(u,s.equipment);u.jumpPad=s.jumpPadIndex>=0?jumpPads[s.jumpPadIndex]||null:null;
    u.localView=u===player;u.controller=u.localView?'localHuman':s.controller==='bot'?'bot':'remoteHuman';
    for(const k of scalarKeys)if(s[k]==null)delete u[k];
    Object.assign(u,safe(Object.fromEntries(Object.entries(s).filter(([,v])=>v!==null)),scalarKeys)); u.pos.fromArray(s.pos); u.vel.fromArray(s.vel); Object.assign(u.sc,s.sc);
    if (u === player && !prediction.enabled) {u.yaw=localYaw; u.pitch=localPitch;} // 比較試験で予測を切った場合も視点は即時。
    u.swing=s.swing?{...s.swing,hit:new Set()}:null;
    u.zip=Number.isInteger(s.zipLine)&&s.zipLine>=0&&ziplines[s.zipLine]?{line:ziplines[s.zipLine]}:null;
    if(s.name!==undefined)u.name=s.name; u.group.visible=u.alive || u.downT>0; u.transfer=s.transfer?{...s.transfer}:null;
    for (const k of SLOTS) if (s.slots[k]) {for(const field of slotKeys)if(s.slots[k][field]==null)delete u.slots[k][field];Object.assign(u.slots[k],safe(Object.fromEntries(Object.entries(s.slots[k]).filter(([,v])=>v!==null)),slotKeys));}
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
    const sparse=Number.isSafeInteger(s.unitUpdates),visible=new Set(s.units.filter(v=>!v.hidden).map(v=>v.id));
    if(sparse)for(const u of units)if(!visible.has(u.entityId))hideRemoteUnit(u);
    for(const v of s.roster||[]){const u=unit(v.id);if(u){u.onlineRenderClass??=u.cls;u.name=v.name;u.cls=v.cls;Object.assign(u.sc,v.sc);}}
    for (const [i,v] of s.units.entries()) {
      const u=unit(v.id);if(v.hidden){if(u)hideRemoteUnit(u);continue;}if(!u||sparse&&!(s.unitUpdates&(1<<i)))continue;
      const previous=remoteUnitHistory.get(v.id),snap=!previous||previous.snap||u.onlineHidden||u.lifeId!==v.lifeId||u.onlineMotionEpoch!==(v.motionEpoch||0)||(u.onlineLagEpoch||0)!==(v.lagEpoch||0)||u.onlineVisibilityEpoch!==(v.visibilityEpoch||0)||u.alive!==v.alive;
      applyUnit(u,v);if(u===player)ownSnapshotTime=s.time;
      if(sparse&&u!==player){
        const samples=snap?[]:previous.samples,before=samples.at(-1);
        // 止まっていた機体は変化が無いので写真に載らず、前の記録が古いまま残る。そのまま新しい写真と補間すると、
        // 動き出した最初のコマで古い時刻からの残りを一度に進めて跳ぶ（2026-11-08 揺れ計測 online_jitter_check で検知）。
        // 前の記録で止まっていたなら、1つ前の写真の時刻にも同じ所にいたことにする（位置が動いたときだけ。しゃがみなど姿勢だけの変化は写真どおり補間する）。
        const bp=before?.unit.pos,np=v.pos,moved=bp&&np&&Math.hypot(np[0]-bp[0],np[1]-bp[1],np[2]-bp[2])>.01;
        if(moved&&s.time-before.time>SNAPSHOT_INTERVAL_MS*1.5&&Math.hypot(...(before.unit.vel||[0,0,0]))<.05)
          samples.push({frame:before.frame,time:s.time-SNAPSHOT_INTERVAL_MS,unit:before.unit});
        samples.push({frame:s.frame,time:s.time,unit:v});while(samples.length>16)samples.shift();
        remoteUnitHistory.set(v.id,{samples,stamp:[visibilitySupport.unitNumber(v.id),s.frame,s.frame,s.time,v.visibilityEpoch],snap});
      }
    }
    cores.B.hp=s.cores.B; cores.R.hp=s.cores.R; timeLeft=s.timeLeft;
    for(const k of ['B','R']){
      spotted[k].clear();spotSrc[k].clear();
      for(const [id,left] of s.spotted?.[k]||[]){const u=unit(id);if(u)spotted[k].set(u,left);}
      for(const [id,list] of s.spotSrc?.[k]||[]){const u=unit(id);if(u)spotSrc[k].set(u,new Map(list));}
    }
    for(const v of s.plants){const p=plants.find(p=>p.id===v.id);if(p){Object.assign(p,v);paintPlant(p);}}
    applyFacilities(s);applyEquipmentObjects(s.gadgets||[],s.equipmentObjects||[]);
    for(const [i,v]of s.units.entries())if(!v.hidden&&(!sparse||(s.unitUpdates&(1<<i)))){const u=unit(v.id);if(u)applyEquipmentUnit(u,v.equipment);}
    // ホスト確定の施設位置・発光のみ反映。乗客移動/接触/射出の物理はゲストで行わない。
    for(const [i,v] of (s.mobility?.lifts||[]).entries()){const l=lifts[i];if(l){setLiftPosition(l,vector(v.pos));l.direction=v.direction;l.waitT=v.waitT;l.blocked=v.blocked;}}
    for(const [i,flash] of (s.mobility?.jumpPads||[]).entries()){const p=jumpPads[i];if(p){p.flash=flash;p.ring.scale.setScalar(1+flash*.12);}}
    for(const [i,v] of (s.mobility?.catapults||[]).entries()){const p=catapults[i];if(p){p.flash=v.flash;p.film.material.opacity=v.opacity;}}
    const alive=new Set(s.shells.map(x=>x.id));
    for(const [id,m] of remoteShells)if(!alive.has(id)){removeRemoteShell(m);remoteShells.delete(id);}
    for(const sh of s.shells){let m=remoteShells.get(sh.id);if(!m){m=makeRemoteShell(sh);remoteShells.set(sh.id,m);scene.add(m);}m.position.fromArray(sh.pos);if(sh.visual){m.rotation.set(...sh.visual.rotation);m.scale.fromArray(sh.visual.scale);for(const [i,v]of sh.visual.children.entries()){const o=m.children[i];if(o){o.position.fromArray(v.pos);o.rotation.set(...v.rotation);o.scale.fromArray(v.scale);}}}else if(sh.rocket&&sh.vel.some(n=>n))m.quaternion.setFromUnitVectors(UP,vector(sh.vel).normalize());}
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
      if(visibilitySupport&&state.matchId&&['preparing','countdown','playing'].includes(state.phase)&&p?.unitId&&unit(p.unitId)&&t-(p.lastResync??-Infinity)>=250){
        p.lastResync=t;
        // 再要求の時にも現在の公開範囲で作り直す。以前の可視座標が入った基準を再送しない。
        const result=encodePeerSnapshot(p,snapshot(),true,true),base=replicationFor(p).encoder.currentBase();
        if(base){state.transport.send('snapshotBase',base,peerId);state.transport.send('snapshot',result.wire,peerId);}
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
    diagnosticArrival(wire.frame);
    if(wire.frame<=(state.lastSnapshot?.frame??-1)){interpolation.staleSnapshots++;const pending=pendingSnapshotWires.get(wire.delta[1]);if(pending?.frame<=wire.frame)pendingSnapshotWires.delete(wire.delta[1]);return;}
    const s=snapshotDecoder.decode(wire.delta),baseId=wire.delta[1];
    if(!s||(!prepared&&!pendingPrepare)){
      const pending=pendingSnapshotWires.get(baseId);
      if(!pending||wire.frame>pending.frame)pendingSnapshotWires.set(baseId,wire);
      while(pendingSnapshotWires.size>4)pendingSnapshotWires.delete(pendingSnapshotWires.keys().next().value);
      if(!s)interpolation.missingBaselines++;requestSnapshotResync();return;
    }
    if(s.frame!==wire.frame||!Number.isFinite(s.time)||!Array.isArray(s.units)||!validPeerSnapshot(s))return;
    pendingSnapshotWires.delete(baseId);
    for(const [id,pending] of pendingSnapshotWires)if(pending.frame<=s.frame)pendingSnapshotWires.delete(id);
    // この写真の基準があれば過去に欠けた別基準はもう要らない。
    for(const id of pendingSnapshotBases.keys())if(id<=baseId)pendingSnapshotBases.delete(id);
    if(!pendingSnapshotWires.size&&!pendingSnapshotBases.size){lastResync=-Infinity;resyncBackoff=250;}
    const t=now(),m=interpolation;
    if(!prepared){
      const d=pendingPrepare;setupWorld(d.teamSize,d.localId,d.mapId,s.roster||s.units);player.controller='localHuman';
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
      if(!v||typeof v!=='object'||Array.isArray(v)||!unit(v.id)||ids.has(v.id)||typeof v.name!=='string'||!Object.keys(CLASSES).includes(v.cls)||!v.sc||typeof v.sc!=='object'||Array.isArray(v.sc)||
         Object.keys(unit(v.id).sc).some(k=>typeof v.sc[k]!==typeof unit(v.id).sc[k])||
         Object.entries(v.sc).some(([k,n])=>!Object.hasOwn(unit(v.id).sc,k)||!Number.isFinite(n)))return;
      ids.add(v.id);
    }
    logCheckpoint('match_finished');
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
    if(Number.isSafeInteger(latest.unitUpdates)){interpolatePeerUnits(target);return;}
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
  // ゲストの発砲の見た目を手元で先に出す（2026-11-08 オーナー「ゲストの快適さ」）。
  // 発砲炎と発射音だけ。弾・命中・ダメージ・弾数は今どおりホストが決める。対象はふつうの即着弾銃
  // （飛ぶ弾・チャージ・ガトリングの回し・ミサイル・3点射は除く）。ホストから届く炎と音の重複を減らす。
  const localFireWindowMs=500;
  let localTracer=null;const localTracerStats={drawn:0,covered:0,host:0};
  let localFire;
  function resetLocalFire(u=null){
    const sl=u?.slots?.[u.weapon];
    localFire={cd:Math.max(0,sl?.cd||0),held:!!sl?.held,unit:u,weapon:u?.weapon,weaponKey:sl?.w?.key,
      lifeId:u?.lifeId,alive:u?.alive,matchId:state.matchId,shots:0,pending:[]};
  }
  function localFireMatches(){
    return localFire&&localFire.unit===player&&localFire.matchId===state.matchId&&localFire.lifeId===player?.lifeId&&
      localFire.alive===player?.alive&&localFire.weapon===player?.weapon&&localFire.weaponKey===player?.slots?.[player.weapon]?.w.key;
  }
  function localFireWeapon(u){
    const sl=u?.slots?.[u.weapon],w=sl?.w;
    if(!w||w.type!=='gun'||w.proj||w.chargeTime||w.spin||w.missile||w.burst||w.drone||w.stunField||!(w.rpm>0))return null;
    return sl;
  }
  function trimLocalFire(){
    const t=now();localFire.pending=localFire.pending.filter(p=>t>=p.at&&t-p.at<=localFireWindowMs&&(p.shot||p.sfx||p.tracer>0));
  }
  function predictLocalFire(input,dt){
    if(!player||state.role!=='guest'||state.phase!=='playing'||!Number.isFinite(dt)||dt<=0)return;
    if(!localFireMatches())resetLocalFire(player);
    trimLocalFire();
    const sl=localFireWeapon(player),w=sl?.w;
    localFire.cd=Math.max(localFire.cd-dt,-dt);
    if(!sl)return;
    // 持ち替え・リロード・エリア移動はhostが先に処理する。このコマは古い武器を先出ししない。
    const edge=input.pressed||{},held=input.keys||{};
    const action=held.KeyR||input.wheel||input.weapon&&input.weapon!==player.weapon||
      ['Digit1','Digit2','Digit3','Digit4','KeyH'].some(k=>edge[k]);
    // shockTとzipは銃を禁止しない（本体weaponsTickと同じ）。感電electricTとよろけは撃てない。
    const trigger=!!input.trigger&&!action&&player.alive&&!(player.downT>0)&&(!player.stun||player.stun==='land')&&
      !(player.electricT>0)&&!player.repairing&&!player.transfer&&!(player.switchT>0);
    // gunTickはreload中にheldを進めず、CD中の押下だけではheldを立てない。
    if(sl.reloadT>0||!(sl.ammo>0))return;
    if(!trigger)localFire.held=false;
    if(!trigger||sl.overheat||w.semi&&localFire.held)return;
    for(let n=0;localFire.cd<=0&&n<4;n++){
      localFire.cd+=60/w.rpm;localFire.shots++;
      if(player.weapon==='main'){
        mainMuzzleFlash(player,false,w);
        if(w.dual)mainMuzzleFlash(player,true,w);
      }
      sfx(w.sfx,player.pos,player,w.sfxRate);
      const tracers=localTracers(sl,input.aimPoint);
      localFire.pending.push({at:now(),shot:player.weapon==='main',sfx:true,tracer:tracers});
      if(localFire.pending.length>64)localFire.pending.shift();
      if(w.semi){localFire.held=true;break;}
    }
  }
  // 弾の筋も手元の銃口から、手元の照準点へ向けて先に描く。散らばりは本体のfire()と同じ式の乱数で、
  // ホストの実際の弾とは別の筋になる（当たり・ダメージはホストの弾で決まる）。戻り値は描いた本数。
  function localTracers(sl,aimPoint){
    const w=sl.w;if(!Array.isArray(aimPoint)||typeof fire!=='function')return 0;
    const offset=viewOffsetOf(player);
    let sp=movementSpread(player)+(w.spread||0);
    if(w.scope)sp+=player.scoped?(w.sway||0)*(1-(sl.conv||0)):(w.hip||0)*(Math.hypot(player.vel.x,player.vel.z)>3||!player.onGround?w.hipMove||1:1);
    sp*=player.aimMul||1;
    const aim=vector(aimPoint),froms=w.dual?[muzzle(player),muzzle(player,true)]:[muzzle(player)];let n=0;
    for(const from of froms)for(let i=0;i<(w.pellets||1);i++){
      const to=w.fan?aim.clone().sub(from).applyAxisAngle(UP,(i-((w.pellets||1)-1)/2)*w.fan).add(from):aim;
      const dir=to.clone().sub(from).normalize();
      dir.x+=(Math.random()-.5)*sp;dir.y+=(Math.random()-.5)*sp;dir.z+=(Math.random()-.5)*sp;dir.normalize();
      const hit=castFrom(from,dir,player,w.range||400),end=hit?hit.point:from.clone().addScaledVector(dir,w.range||300);
      const a=offset?from.clone().add(offset):from;
      if(w.laserFade>0)laserTrail(a,end,w.laserFade);else localTracer(a,end,player.team,w.energy,w,primaryShot(player,w)||BIG_TRACE_SERIES.has(w.series));
      n++;
    }
    localTracerStats.drawn+=n;return n;
  }
  // 同じlife/武器の未消費の炎・音だけを各1回抑える。時刻窓は厳密な射撃ID照合ではない。
  // host拒否や500ms超の遅着は一致を保証できない。弾数・命中・ダメージは予測しない。
  function localFireCovers(type,data){
    if(!localFireMatches()||!localFireWeapon(player)||data.lifeId!==localFire.lifeId||data.weapon!==localFire.weaponKey)return false;
    trimLocalFire();const pending=localFire.pending.find(p=>p[type]);
    if(!pending)return false;if(type==='tracer'){pending.tracer--;localTracerStats.covered++;}else pending[type]=false;return true;
  }
  // リペアポッドの光はホストのpodUpdateだけが付けていた。ゲストでは写真の repairing から同じ見た目にする
  // （2026-11-08 オーナー「repairのエフェクトが出なかったり」）。回復・補給そのものはホスト。
  function guestPodVisuals(){
    if(typeof pods==='undefined'||typeof podTeam!=='function')return;
    for(const pd of pods){
      const team=podTeam(pd);if(pd.ring)pd.ring.material.opacity=team?1:.25;
      if(pd.beam)pd.beam.visible=!!team&&units.some(u=>!u.onlineHidden&&u.alive&&u.repairing&&u.team===team&&u.pos.y-pd.pos.y<=1&&Math.hypot(u.pos.x-pd.pos.x,u.pos.z-pd.pos.z)<=POD_R);
    }
  }
  function beforeFrame(dt,t) {
    frameStart=now();diagnosticFrameStart(frameStart);
    if(state.role!=='offline'&&state.phase!=='playing'){running=false;stopSessionAudio();}
    countdownTick();requestSnapshotResync();
    if(state.role==='host'&&state.phase==='playing'){
      for(const p of [...state.peers.values()]){if(now()-p.last>3000){const reason='入力が3秒途絶えたため、対戦から退出しました。機体はBotが引き継ぎます';peerLeft(p.id,reason);state.transport.disconnectPeer(p.id,reason);continue;}const u=unit(p.unitId);if(u)u.controlInput=remoteInput(u);}
    }
    if(state.role!=='guest'||state.phase!=='playing')return;
    if(now()-state.lastHost>5000){endGuest('ホストから5秒間応答がありません');return;}
    if(now()-state.lastHost>500)status('通信遅延：ホストの状態を待っています');
    interpolate(now());decayPredictionVisual();guestPodVisuals();if(typeof reflectorUpdate==='function')guestEquipmentVisuals(dt);
    if(!player)return;
    if(!overrideInput){
      const turn=2.2*dt;
      if(keys.ArrowLeft)player.yaw+=turn;if(keys.ArrowRight)player.yaw-=turn;
      if(keys.ArrowUp)player.pitch=Math.min(.7,player.pitch+1.5*dt);if(keys.ArrowDown)player.pitch=Math.max(-.9,player.pitch-1.5*dt);
    }
    const aimed=updateLocalHumanAim(player,dt,typeof isArtilleryMode==='function'&&isArtilleryMode(player));
    const input=overrideInput?{...overrideInput}:collectLocalInput(player);
    if(!overrideInput)for(const k of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'])delete input.keys[k];
    input.aimPoint=input.aimPoint||aimed.aim.toArray();input.lockTarget=overrideInput?.lockTarget??(lock.visible?lockId(lock.target):null);input.yaw=input.yaw??player.yaw;input.pitch=input.pitch??player.pitch;
    if(requestedWeapon){input.weapon=requestedWeapon;requestedWeapon=null;}
    if(equipmentActions.length)input.equipmentActions=equipmentActions.splice(0,8);
    predictLocalFire(input,dt);
    stepLocalCommands(input,dt);
    if(prediction.enabled)for(const [seq,p]of state.pendingInputs)if(p.move&&player.pos.distanceToSquared(vector(p.pos))>1e-10){displayedLatencies.push({kind:'input',time:p.time});state.pendingInputs.delete(seq);}
    wheelDir=0;state.lastInput=now();
  }
  function afterFrame(dt,t) {
    if(state.role==='guest'){
      if(state.phase==='playing'&&Number.isFinite(interpolation.renderTime)&&state.lastSnapshot){
        lastRenderedView={time:interpolation.renderTime,frame:state.lastSnapshot.frame,delayMs:interpolation.delayMs};
        if(Number.isSafeInteger(state.lastSnapshot.unitUpdates))lastRenderedView.units=[...remoteUnitHistory].filter(([id,h])=>!unit(id)?.onlineHidden&&h.stamp&&Math.abs(h.stamp[3]-interpolation.renderTime)>.001).map(([,h])=>h.stamp.slice());
      }
      for(const p of displayedLatencies.splice(0))state[p.kind==='input'?'inputLatency':'hitLatency'].push(now()-p.time);diagnosticFrameEnd();return;
    }
    if(state.role!=='host'||state.phase!=='playing')return;
    const stateTime=now();captureLagHistory(stateTime);
    state.frameMs.push(now()-frameStart);if(state.frameMs.length>60000)state.frameMs.shift();
    state.frame++;
    const begin=now();
    // 次の定期写真を待たず、公開範囲が変わったframeで旧待機写真を破棄する。
    const privacyChanged=[...state.peers.values()].some(p=>{const r=replicationFor(p),view=createPeerView(p),v=view.visible,g=new Set(permittedGadgets(p,view)),old=r.gadgetPublic||new Set(),objects=visibleEquipmentSources(view),previousObjects=r.objectPublic||new Set();return v.size!==r.visible.size||[...v].some(id=>!r.visible.has(id))||[...old].some(item=>!g.has(item))||old.size<(r.gadgetCapacity||0)&&[...g].some(item=>!old.has(item))||objects.size!==previousObjects.size||[...objects].some(o=>!previousObjects.has(o));});
    if(state.events.length){const events=state.events.splice(0);for(const p of state.peers.values()){const r=replicationFor(p);for(const e of events)r.eventCache.set(e.id,e);while(r.eventCache.size>2048)r.eventCache.delete(r.eventCache.keys().next().value);const visible=eventsForPeer(p,events);if(visible.length)state.transport.send('events',visible,p.id);}}
    if(!state.nextSnapshotAt)state.nextSnapshotAt=stateTime;
    const snapshotDue=stateTime+1e-6>=state.nextSnapshotAt;
    if(snapshotDue || ended||privacyChanged){
      // 前回の実行時刻へ丸めず予定の余りを保持。処理落ち時は欠けた予定を飛ばし、1frame最大1枚。
      // 秘匿変更の臨時送信で、次の定期送信を後ろへずらさない。
      if(snapshotDue)state.nextSnapshotAt+=(Math.floor((stateTime-state.nextSnapshotAt+1e-6)/SNAPSHOT_INTERVAL_MS)+1)*SNAPSHOT_INTERVAL_MS;
      const full=snapshot(stateTime);
      for(const p of state.peers.values()){const result=encodePeerSnapshot(p,full);if(result.baseline)state.transport.send('snapshotBase',result.baseline,p.id);state.transport.send('snapshot',result.wire,p.id);}
      state.lastSent=now();
    }
    state.sendMs.push(now()-begin);if(state.sendMs.length>60000)state.sendMs.shift();diagnosticFrameEnd();
    if(ended&&state.phase==='playing'){if(typeof logCheckpoint==='function')logCheckpoint('match_finished');state.transport.broadcast('matchEnded',matchResult());clearPrediction();lagHistory?.clear();state.phase='ended';window.CBOnlineGame.stopSessionAudio?.();status('試合終了');callbacks.onEnded?.('試合終了');
      // 同じ部屋の待機へ戻る（afterFrameだけを取り出す試験では関数が無い）。
      if(typeof backToLobby==='function'){state.transport.broadcast('lobbyReturn',{matchId:state.matchId});backToLobby();}}
  }
  function emit(type,data,source=effectSource,target=effectTarget) {if(state.role==='host'&&state.phase==='playing'&&!playingEffects&&state.events.length<1024)state.events.push({id:++eventId,type,data,source:source||unit(data.unit),target});}
  function playEvents(events) {
    if(!Array.isArray(events))return;playingEffects=true;
    try{for(const e of events){if(state.receivedEvents.has(e.id))continue;state.receivedEvents.add(e.id);if(state.receivedEvents.size>4096)state.receivedEvents.delete(state.receivedEvents.values().next().value);const d=e.data;
      if(e.type==='tracer'&&d.unit===state.localUnitId&&d.unit)localTracerStats.host++;
      if(e.type==='tracer'&&!(d.unit===state.localUnitId&&localFireCovers('tracer',d)))tracer(vector(d.from),vector(d.end),d.team,d.energy,WEAPONS[d.weapon]||null,d.enlarged);
      if(e.type==='boom')boom(vector(d.at),d.k,d.radius,d.energy);
      if(e.type==='impact')impact(vector(d.at),d.kind,d.delay);
      if(e.type==='sfx'&&!(d.unit===state.localUnitId&&d.name===localFireWeapon(player)?.w.sfx&&localFireCovers('sfx',d)))sfx(d.name,d.at?vector(d.at):null,d.unit?unit(d.unit):null,d.rate,d.level);
      if(e.type==='shot'){const u=unit(d.unit);if(u&&!u.onlineHidden&&!(u===player&&localFireCovers('shot',d)))mainMuzzleFlash(u,false,u.slots[u.weapon].w);}
      if(e.type==='popup'&&d.unit===state.localUnitId&&Array.isArray(d.at))popup(vector(d.at),htmlText(d.label),htmlText(d.sub),!!d.good);
      if(e.type==='score'&&d.unit===state.localUnitId&&Number.isFinite(d.pt)&&typeof scorePopShow==='function')scorePopShow(d.pt,htmlText(d.label));
      if(e.type==='hurt'&&d.unit===state.localUnitId&&Array.isArray(d.at)&&Number.isFinite(d.real)){flashDamage(vector(d.at),d.real);if(d.blast)kickBlastShake(d.real);}
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
  // 遠隔機の移動だけ固定命令で進め、武器・非移動操作はhost frameで一度だけ処理する。
  function advanceRemoteCommands(u,p,dt){
    const queue=p.commandQueue||=[];
    if(!p.fixedStarted){
      // 最初だけhost1frameぶん+1命令（最低2）を待つ。初回に使い切らない小さいバッファ。
      if(queue.length<Math.max(2,Math.ceil(Math.min(.05,Math.max(0,dt))/commandLimits.dt)+1)&&(!queue.length||now()-queue[0].receivedAt<50))return;
      p.fixedStarted=true;p.fixedClock=0;p.catchupClock=0;p.fixedElapsed=0;p.fixedSteps=0;
    }
    dt=Math.min(.05,Math.max(0,dt));
    p.fixedElapsed=(p.fixedElapsed||0)+dt;
    p.fixedClock=Math.min(.1,(p.fixedClock||0)+dt);
    p.catchupClock=Math.min(commandLimits.catchupSeconds,(p.catchupClock||0)+dt);
    let count=Math.min(commandLimits.maxFrameSteps,Math.floor((p.fixedClock+1e-9)/commandLimits.dt));
    p.fixedClock=Math.max(0,p.fixedClock-count*commandLimits.dt);
    if(queue.length>commandLimits.catchupBacklog&&p.catchupClock>=commandLimits.catchupSeconds&&count<commandLimits.maxFrameSteps&&
      (p.fixedSteps||0)+count<Math.floor((p.fixedElapsed+1e-9)/commandLimits.dt)+commandLimits.maxAheadSteps){count++;p.catchupClock=0;}
    for(let i=0;i<count;i++){
      while(queue.length&&(queue[0].lifeId!==u.lifeId||queue[0].seq<=(p.appliedSeq||0)||now()-queue[0].sentAt>inputLimits.maxAgeMs))queue.shift();
      let command=queue[0],fresh=false;
      // 欠番は短く待って冗長再送で埋める。それでも来なければ最新の既知入力へ進む。
      if(command&&p.lastCommand&&command.seq>p.lastCommand.seq+1&&now()-command.receivedAt<50)command=null;
      if(command){queue.shift();p.lastCommand=command;p.input=command;fresh=true;}
      else command=p.lastCommand;
      if(!p.frameAction){
        p.frameAction=remoteInput(u);
      }
      // 施設操作は実移動の直前に一度だけ。0step frameのcontrol ackでは捨てない。
      p.utilityActions=(p.utilityActions||[]).filter(a=>a.lifeId===u.lifeId&&actionIsRecent(p,a));
      const utility=p.utilityActions.find(a=>a.seq<=(command?.seq||0));
      if(utility){
        if(typeof humanUtilityInput==='function')humanUtilityInput(u,utility);
        p.utilityActions=p.utilityActions.filter(a=>a!==utility);
      }
      p.movementActions=(p.movementActions||[]).filter(a=>a.lifeId===u.lifeId&&!p.appliedMovementIds?.has(a.actionSeq)&&actionIsRecent(p,a));
      const edges=p.movementActions.filter(a=>a.seq<=(command?.seq||0));
      const pressed=edges.length?Object.assign({},...edges.map(edge=>edge.pressed)):fresh&&!command.moveActionSeq&&!command.moveActions?.length?{...command.movePressed}:{};
      const active=command&&now()-command.sentAt<=250&&now()-p.last<=250;
      // 250msの中立化を跨いだ復帰は予測時計だけ再基準化。host移動時間budget・未適用queueは戻さない。
      if(!active)p.fixedNeedsResync=true;
      else if(fresh&&p.fixedNeedsResync){p.fixedReplaySeq=command.seq-1;p.fixedNeedsResync=false;}
      const movement=active?{...command,pressed}:{command:true,seq:command?.seq,keys:{},pressed:{},yaw:u.yaw,pitch:u.pitch};
      if(typeof movementStatusTick==='function')movementStatusTick(u,commandLimits.dt);
      updateHumanMovement(u,movement,commandLimits.dt,{movementOnly:true});
      p.fixedSteps=(p.fixedSteps||0)+1;
      // seqは実命令の消化、replaySeqは反復も含む移動時間の境界。欠番skipでも後退させない。
      p.fixedReplaySeq=Math.max(command?.seq||0,(p.fixedReplaySeq||0)+1);
      for(const edge of active?edges:[]){
        // 非再送線の新押下がreliableの古い押下を追い越しても、番号の大小で消さない。
        (p.appliedMovementIds||=new Set()).add(edge.actionSeq);
        while(p.appliedMovementIds.size>128)p.appliedMovementIds.delete(p.appliedMovementIds.values().next().value);
        p.appliedMovementActionSeq=Math.max(p.appliedMovementActionSeq||0,edge.actionSeq);
        p.movementActions=p.movementActions.filter(a=>a.actionSeq!==edge.actionSeq);
      }
      if(command)recordHostInputStep(u,movement,commandLimits.dt);
      if(!fresh)p.repeatedCommands=(p.repeatedCommands||0)+1;
    }
  }
  if(typeof downTick==='function'){
    const oldDownTick=downTick;downTick=function(u,dt){
      const p=state.role==='host'&&state.phase==='playing'&&u.controller==='remoteHuman'&&!u.alive&&u.downT>0?state.peers.get(u.ownerPeerId):null;
      const result=oldDownTick(...arguments);
      if(p)acknowledgeInputAction(p);
      return result;
    };
  }
  if(typeof updateHumanUnit==='function'){
    const oldUpdateHumanUnit=updateHumanUnit;updateHumanUnit=function(u,input,dt){
      const applied=state.role==='host'&&state.phase==='playing'&&u.alive&&u.controller==='remoteHuman';
      const p=applied?state.peers.get(u.ownerPeerId):null;
      if(p?.fixedCommands&&typeof updateHumanMovement==='function'){
        p.frameAction=null;advanceRemoteCommands(u,p,dt);
        const action=p.frameAction||remoteInput(u);
        // Space/Shiftと施設操作は別queueで一度だけ消化。武器側で重ねて実行しない。
        action.pressed=Object.fromEntries(Object.entries(action.pressed||{}).filter(([k])=>!movementEdges.includes(k)&&k!=='KeyH'&&k!=='KeyE'));
        u.controlInput=action;
        applyEquipmentActions(u,action);
        const result=oldUpdateHumanUnit(u,action,dt,{movementDone:true,utilityDone:true});
        acknowledgeInputAction(p);return result;
      }
      if(applied)applyEquipmentActions(u,input);
      const result=oldUpdateHumanUnit(...arguments);if(applied)recordHostInputStep(u,input,dt);return result;
    };
  }
  // ロックの枠・名札・得点の飛び出しなど画面へ投影する表示も、描画と同じずらしたカメラで計算する
  // （2026-11-08 オーナー「ロックオンカーソルが微振動」：ずらす前のカメラで投影すると、枠だけが刻みごとに揺れた）。
  for(const name of ['hud','popUpdate'])if(typeof globalThis[name]==='function'){
    const old=globalThis[name];if(typeof old!=='function')continue;globalThis[name]=function(){
      const offset=state.role==='guest'?viewOffsetOf(player):null;if(!offset)return old.apply(this,arguments);
      const position=camera.position.clone();camera.position.add(offset);camera.updateMatrixWorld();
      try{return old.apply(this,arguments);}finally{camera.position.copy(position);camera.updateMatrixWorld();}
    };
  }
  // 描画中だけカメラをずらし、次frameの照準/送信aimPointにはoffsetを混ぜない。
  if(typeof renderView==='function'){
    const oldRenderView=renderView;renderView=function(){
      const offset=state.role==='guest'?viewOffsetOf(player):null;if(!offset)return oldRenderView(...arguments);
      const position=camera.position.clone();camera.position.add(offset);camera.updateMatrixWorld();
      try{return oldRenderView(...arguments);}finally{camera.position.copy(position);camera.updateMatrixWorld();}
    };
  }
  // 表示関数だけを包む。ゲスト側で発射/ダメージ関数を呼び出さない。
  const oldWeaponLook=weaponLook;weaponLook=function(u,dt){
    const d=u.cannonDeploy,sw=u.swing;
    try{if(state.role==='guest')u.swing=localMeleeRenderSwing(u);return oldWeaponLook(u,dt);}
    finally{u.swing=sw;if(state.role==='guest')u.cannonDeploy=d;}
  };
  const oldTracer=tracer;localTracer=oldTracer;tracer=function(from,end,team,energy,w,enlarged=true){const src=effectSource?.entityId?effectSource:null;emit('tracer',{from:from.toArray(),end:end.toArray(),team,energy,weapon:w?.key,enlarged,unit:src?.entityId,lifeId:src?.lifeId});return oldTracer(...arguments);};
  const oldBoom=boom;boom=function(at,k=1,radius=0,energy=false){emit('boom',{at:at.toArray(),k,radius,energy});return oldBoom(...arguments);};
  const oldImpact=impact;impact=function(at,kind,delay){emit('impact',{at:at.toArray(),kind,delay});return oldImpact(...arguments);};
  const oldSfx=sfx;sfx=function(name,at,src,rate=1,level=1){
    if(state.role!=='offline'&&state.phase!=='playing'&&(SFX[name]?.motion||SFX[name]?.loop))return;
    // 足音と持続ブーストは双方の描画から鳴る。通信で複製すると未管理のloop音が残る。
    if(name!=='boostLoop'&&name!=='step')emit('sfx',{name,at:at?.toArray(),unit:src?.entityId,rate,level,lifeId:src?.lifeId,weapon:src?.slots?.[src.weapon]?.w.key},src||effectSource);
    if(playingEffects&&(name==='boostLoop'||name==='step'))return;
    return oldSfx(...arguments);
  };
  const oldFinish=finish;finish=function(){try{return oldFinish(...arguments);}finally{if(state.role!=='offline'){clearStartReservation();stopSessionAudio();}}};
  if(typeof fire==='function'){
    const oldFire=fire;fire=function(u){const source=effectSource,target=effectTarget;effectSource=source?.gadget?source:u;effectTarget=null;try{return oldFire(...arguments);}finally{effectSource=source;effectTarget=target;}};
  }
  if(typeof detonate==='function'){
    const oldDetonate=detonate;detonate=function(g){const source=effectSource,target=effectTarget;effectSource=g;effectTarget=null;try{return oldDetonate(...arguments);}finally{effectSource=source;effectTarget=target;}};
  }
  if(typeof sentryTick==='function'){
    const oldSentry=sentryTick;sentryTick=function(g){const source=effectSource,target=effectTarget;effectSource=g;effectTarget=null;try{return oldSentry(...arguments);}finally{effectSource=source;effectTarget=target;}};
  }
  const oldShot=shot;shot=function(u,sl,aim,spread,missileTarget){
    const previousSource=effectSource,previousTarget=effectTarget;effectSource=u;effectTarget=null;
    const previous=hitscanContext,previousDamageSeq=damageInputSeq,p=state.role==='host'?state.peers.get(u.ownerPeerId):null,eligible=u.controller==='remoteHuman'&&sl?.w&&!sl.w.proj&&sl.w.type==='gun';
    // release照準は充填銃だけ。解除後に残る通常burst弾は最新movementの照準を使う。
    const pending=p?.pendingShot&&actionIsRecent(p,p.pendingShot)&&(p.pendingShot.trigger||sl?.w.chargeTime)?p.pendingShot:null;
    if(p)p.pendingShot=null;
    const input=eligible&&pending?pending:u.controlInput,cameraRecoil=u.cameraRecoil,cameraRecoilYaw=u.cameraRecoilYaw;
    emit('shot',{unit:u.entityId,seq:eligible&&input?.seq||u.onlineInputSeq||0,lifeId:u.lifeId,weapon:sl?.w.key});
    hitscanContext=eligible?{unit:u,weapon:sl.w,input}:null;
    if(eligible)damageInputSeq=input?.seq??null;
    if(eligible&&pending){aim=vector(pending.aimPoint);u.cameraRecoil=pending.cameraRecoil||0;u.cameraRecoilYaw=pending.cameraRecoilYaw||0;}
    try{return oldShot(u,sl,aim,spread,missileTarget);}finally{effectSource=previousSource;effectTarget=previousTarget;hitscanContext=previous;damageInputSeq=previousDamageSeq;if(eligible&&pending){u.cameraRecoil=cameraRecoil;u.cameraRecoilYaw=cameraRecoilYaw;}}
  };
  const oldShoot=shoot;shoot=function(owner){const sh=oldShoot(...arguments);if(sh)sh.onlineInputSeq=owner?.onlineInputSeq||0;return sh;};
  const oldBlast=blast;blast=function(sh){
    const previousSource=effectSource,previousTarget=effectTarget;effectSource=effectSource?.gadget?effectSource:sh.owner;effectTarget=null;
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
    } finally {blastDepth--;damageInputSeq=prev;effectSource=previousSource;effectTarget=previousTarget;}
  };
  const oldDamage=damage;damage=function(r,by,dmg,head){const result=oldDamage(...arguments);if(result&&!blastDepth&&by?.controller==='remoteHuman')emit('hit',{unit:by.entityId,seq:damageInputSeq??(by.onlineInputSeq||0),head:!!head});return result;};
  addEventListener('beforeunload',()=>{if(state.role==='host')state.transport?.broadcast('endHost',{reason:'ホストが退出しました'});});
  let logStorage;try{logStorage=localStorage;}catch(_){}
  const diagnosticLog=typeof CBOnlineDiagnosticLog!=='undefined'?new CBOnlineDiagnosticLog.Recorder({storage:logStorage,maps:roomMaps.map(m=>m.id)}):null;
  if(diagnosticLog){
    setInterval(()=>{if(diagnosticLog.active)diagnosticLog.sample(logSample());},2000);
    document.addEventListener('visibilitychange',()=>logCheckpoint(document.hidden?'page_hidden':'page_visible'));
    addEventListener('pagehide',()=>logCheckpoint('page_closed'));
  }
  const logs={preview:()=>{if(diagnosticLog?.active)diagnosticLog.sample(logSample(),true);return diagnosticLog?.preview()||'';},
    status:()=>({available:!!diagnosticLog?.sessions.length,storageAvailable:!!diagnosticLog?.storageAvailable}),
    clear:()=>{const removed=diagnosticLog?.clear()!==false;if(state.role!=='offline')diagnosticLog?.begin({role:state.role,version:localVersion(),protocol:CBOnlineTransport.PROTOCOL},logSample());return removed;}};
  // 診断は直近2秒の上限付き標本。フレーム間隔とJS処理時間を分け、位置や個人情報は送らない。
  const diagnosticWindowMs=2000;
  function diagnosticState(){return {lastFrame:null,lastWire:null,lastWireFrame:-1,frames:[],cpu:[],arrivals:[],hostCache:null,hostCacheAt:-Infinity};}
  let diagnosticTiming=diagnosticState();
  function diagnosticSample(list,value,at=now()){
    if(!Number.isFinite(value)||value<0)return;
    list.push({at,value});while(list.length&&list[0].at<at-diagnosticWindowMs)list.shift();while(list.length>1200)list.shift();
  }
  function diagnosticSummary(list,at=now()){
    const values=list.filter(s=>s.at>=at-diagnosticWindowMs).map(s=>s.value).sort((a,b)=>a-b),n=values.length;
    return {count:n,meanMs:n?values.reduce((a,b)=>a+b,0)/n:0,p95Ms:n?values[Math.ceil(n*.95)-1]:0,maxMs:n?values[n-1]:0};
  }
  function diagnosticFrameStart(at){
    if(state.phase!=='playing'||state.role==='offline'){diagnosticTiming.lastFrame=null;return;}
    if(diagnosticTiming.lastFrame!==null)diagnosticSample(diagnosticTiming.frames,at-diagnosticTiming.lastFrame,at);
    diagnosticTiming.lastFrame=at;
  }
  function diagnosticFrameEnd(){if(state.phase==='playing'&&state.role!=='offline')diagnosticSample(diagnosticTiming.cpu,now()-frameStart);}
  function diagnosticArrival(frame){
    if(frame<=diagnosticTiming.lastWireFrame)return;const at=now();
    if(diagnosticTiming.lastWire!==null)diagnosticSample(diagnosticTiming.arrivals,at-diagnosticTiming.lastWire,at);
    diagnosticTiming.lastWire=at;diagnosticTiming.lastWireFrame=frame;
  }
  function diagnosticHostTiming(){
    const at=now();if(diagnosticTiming.hostCache&&at-diagnosticTiming.hostCacheAt<250)return diagnosticTiming.hostCache;
    diagnosticTiming.hostCacheAt=at;
    return diagnosticTiming.hostCache={windowMs:diagnosticWindowMs,frame:diagnosticSummary(diagnosticTiming.frames,at),cpu:diagnosticSummary(diagnosticTiming.cpu,at)};
  }
  function diagnostics() {
    const at=now(),clock=state.role==='guest'?state.transport?.clock?.():null;
    const samples=prediction.corrections.filter(c=>c.at>=at-diagnosticWindowMs),changed=samples.filter(c=>c.distance>.001),reasons={};
    let hardSnaps=0;for(const c of samples)if(c.reason!=='smooth'){hardSnaps++;reasons[c.reason]=(reasons[c.reason]||0)+1;}
    const local=diagnosticSummary(diagnosticTiming.frames,at),host=state.role==='host'?diagnosticHostTiming():state.lastSnapshot?.hostTiming;
    const prevented=prediction.preventedLook.filter(c=>c.at>=at-diagnosticWindowMs);
    return {role:state.role,phase:state.phase,windowMs:diagnosticWindowMs,frame:local,fps:local.count&&local.meanMs>0?1000/local.meanMs:null,
      host:host?.windowMs===diagnosticWindowMs?host:null,arrivals:diagnosticSummary(diagnosticTiming.arrivals,at),
      snapshotAgeMs:state.role==='guest'&&diagnosticTiming.lastWire!==null?Math.max(0,at-diagnosticTiming.lastWire):null,
      rttMs:Number.isFinite(clock?.rttMs)?clock.rttMs:null,
      corrections:{count:changed.length,samples:samples.length,meanM:changed.length?changed.reduce((n,c)=>n+c.distance,0)/changed.length:0,maxM:changed.length?Math.max(...changed.map(c=>c.distance)):0,hardSnaps,reasons},
      predictionBlocked:player?.onlinePredictionBlocked||(typeof movementPredictionBlockReason==='function'?movementPredictionBlockReason(player,inputSending.history.at(-1)):''),
      blockedCorrections:samples.filter(c=>c.distance>.001&&c.predictionBlocked).length,
      repeatDebt:prediction.repeatDebt||0,preventedLook:{count:prevented.length,maxDeg:prevented.length?Math.max(...prevented.map(c=>c.value)):0},
      pendingInputs:prediction.pending.length,visibility:typeof document!=='undefined'?document.visibilityState:'unknown'};
  }
  window.CBOnlineGame={create,join,start,leave,setReady,setEditing,setEquipment,equipmentOptions,canStart,
    quickChat:{categories:quickChatCategories,limits:quickChatLimits,allowed:quickChatAllowed,send:sendQuickChat,lines:()=>quickChatLines.filter(line=>line.phase===state.phase&&line.matchId===(state.matchId||null)&&now()-line.at<quickChatLimits.visibleMs).map(line=>({...line})),subscribe:fn=>{quickChatListeners.add(fn);return ()=>quickChatListeners.delete(fn);}},approveGuest,rejectGuest,kickGuest,updateSettings,chooseTeam,shuffleTeams,state,stopSessionAudio,beforeFrame,afterFrame,remoteInput,emit,snapshot,castHitscan,diagnostics,logs,respawnLoadout,
    roomOptions:{classes:roomClasses.map(id=>({id,name:CLASSES[id].name||id})),maps:roomMaps.map(m=>({...m})),teamSizes:roomTeamSizes.slice(),capacities:[2,3,4]},
    active:()=>state.role!=='offline',requestWeapon:slot=>{if(SLOTS.includes(slot))requestedWeapon=slot;},testInput:v=>{overrideInput=v;},metrics:()=>({role:state.role,phase:state.phase,localEntityId:state.localUnitId,peers:state.peers.size,frame:state.frame,
      inputLatency:state.inputLatency.slice(),hitLatency:state.hitLatency.slice(),frameMs:state.frameMs.slice(),sendMs:state.sendMs.slice(),transport:state.transport?.metrics(),prediction:predictionMetrics(),lagCompensation:{enabled:lagEnabled,...lagMetrics,reasons:{...lagMetrics.reasons},historyFrames:lagHistory?.frames.length||0},interpolation:{...interpolation,meanDelayMs:interpolation.frames?interpolation.totalDelayMs/interpolation.frames:100,meanEffectiveDelayMs:interpolation.frames?interpolation.totalEffectiveDelayMs/interpolation.frames:100},disconnected:state.disconnected.slice(),localTracers:{...localTracerStats}})};
  window.CBOnlineGame.remoteFeedback=remoteFeedback;
})();
