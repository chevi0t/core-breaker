/* #212: PeerJS 1.5.5 用のブラウザホスト通信。ゲームの状態はここで計算しない。 */
(function (root) {
  'use strict';
  const PROTOCOL = 9, MAX_BYTES = 262144, MAX_QUEUE = 256, HIGH_WATER = 262144;
  const CONTROL_LABEL = 'core-breaker-control-v9', SNAPSHOT_LABEL = 'core-breaker-snapshot-v9';
  const PACKET_BYTES = 16384, CHUNK_BYTES = 9000, MAX_ASSEMBLIES = 4, ASSEMBLY_TTL = 1000, BASE_TTL = 10000;
  const INPUT_BYTES = 8192, INPUT_FRAMES = 5, INPUT_RATE = 120, INPUT_QUEUE = 16, INPUT_TTL = 250;
  const isSnapshot = type => type === 'snapshot' || type === 'snapshotBase';
  const isInputBatch = payload => payload && !Array.isArray(payload) && Array.isArray(payload.inputs) &&
    payload.inputs.length > 0 && payload.inputs.length <= INPUT_FRAMES && payload.inputs.every(input =>
      input && typeof input === 'object' && !Array.isArray(input) && Number.isSafeInteger(input.seq) && input.seq > 0);
  const channelSettings = conn => conn?.dataChannel ? {
    ordered: conn.dataChannel.ordered, maxRetransmits: conn.dataChannel.maxRetransmits,
    maxPacketLifeTime: conn.dataChannel.maxPacketLifeTime, readyState: conn.dataChannel.readyState,
    bufferedBytes: conn.dataChannel.bufferedAmount || 0
  } : null;
  const encoder = new TextEncoder();
  const now = () => performance.now();
  // 表示名は本人確認済みのIDではない。制御文字・方向制御を除き24コードポイントまで。
  const cleanName = value => [...(typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').trim()].slice(0,24).join('') || 'ゲスト';
  class CBOnlineTransport {
    constructor(options = {}) {
      this.options = options;
      this.capacity = Number.isInteger(options.capacity) && options.capacity >= 2 && options.capacity <= 4 ? options.capacity : 4;
      this.appVersion = String(options.appVersion || '').trim();
      this.displayName = cleanName(options.displayName);
      if (!this.appVersion) throw new Error('ゲームの版が指定されていません');
      this.latencyMs = [0, 50, 100].includes(options.latencyMs) ? options.latencyMs : 0;
      // 人工欠損は論理メッセージ単位。SCTPのパケット損失率とは別の試験値。
      this.snapshotDropRate = [0, .05, .2].includes(options.snapshotDropRate) ? options.snapshotDropRate : 0;
      this.snapshotDrops = { artificial: 0, stale: 0, congestion: 0, superseded: 0, incomplete: 0 };
      // 写真欠損の注入とは独立。連続入力は再送せず、次の5コマ入りbatchで補う。
      this.inputDropRate = [0, .05, .2].includes(options.inputDropRate) ? options.inputDropRate : 0;
      this.inputDrops = { artificial: 0, stale: 0, duplicate: 0, congestion: 0, superseded: 0, rateLimited: 0 };
      this.peer = null; this.role = ''; this.roomId = ''; this.matchId = '';
      this.links = new Map(); this.closed = false; this.started = false;
      this.createdAt = now(); this.samples = []; this.sequence = 0;
      this.totals = { sentBytes: 0, receivedBytes: 0, sentMessages: 0, receivedMessages: 0, byType: {}, maxBufferedBytes: 0, maxQueue: 0 };
      this.messageSizes = Object.create(null);
      this.byChannel=Object.fromEntries(['control','snapshot'].map(k=>[k,{sentBytes:0,receivedBytes:0,sentMessages:0,receivedMessages:0}]));
      this.history = new Map(); this._timers = new Set();
      this._tickTimer = setInterval(() => this._tick(), 20);
    }
    _status(text, detail = {}) { this.options.onStatus?.(text, detail); }
    _later(fn, ms) { const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms); this._timers.add(t); return t; }
    async _openPeer() {
      const PeerClass = this.options.Peer || root.Peer;
      if (!PeerClass) throw new Error('PeerJS 1.5.5 を読み込めませんでした');
      const supplied = this.options.peerOptions || {};
      // TURN を既定値からも持ち込まない。試験では iceServers: [] も指定できる。
      const iceServers = supplied.config?.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
      if (iceServers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => typeof u !== 'string' || !u.startsWith('stun:')))) throw new Error('試作は STUN のみです（TURN は使えません）');
      this.peer = new PeerClass(undefined, { ...supplied, config: { ...(supplied.config || {}), iceServers } });
      this.peer.on('disconnected', () => this._status('接続の仲立ちが切れました。接続済みの対戦は続けます', { signaling: false }));
      this.peer.on('error', e => this._status('接続エラー: ' + (e.message || e.type), { error: true, type: e.type }));
      this.peer.on('close', () => { if (!this.closed) this.close('接続サービスが終了しました'); });
      this.peer.on('connection', conn => {
        if (this.role !== 'host') { this._closeOrphan(conn); return; }
        if (conn.label === SNAPSHOT_LABEL) {
          const link = this.links.get(conn.peer), meta = conn.metadata;
          if (!link || link.closing || !link.approved || link.snapshotConn || !meta ||
              meta.protocolVersion !== PROTOCOL || meta.roomId !== this.roomId ||
              meta.controlId !== link.conn.connectionId || meta.token !== link.snapshotToken) {
            this._closeOrphan(conn); return;
          }
          this._attachSnapshot(link, conn); return;
        }
        const reject = this.started ? '試合開始後の途中参加はできません' : [...this.links.values()].filter(l=>l.approved&&!l.closing).length >= this.capacity - 1 ? `部屋は満員です（ホストを含め${this.capacity}人まで）` : [...this.links.values()].filter(l=>!l.approved).length >= 8 ? '入室の承認待ちが上限です。少し待ってから入り直してください' : this.links.has(conn.peer) ? '同じ相手は既に接続しています' : '';
        if (reject) { conn.on('open', () => { try { conn.send(JSON.stringify({ type: 'reject', reason: reject })); } catch (_) {} this._later(() => conn.close(), 100); }); return; }
        this._attach(conn);
      });
      return new Promise((resolve, reject) => {
        const t = this._later(() => reject(new Error('接続サービスへの登録が時間切れになりました')), 15000);
        this.peer.on('open', id => { clearTimeout(t); this._timers.delete(t); resolve(id); });
        this.peer.on('error', e => { clearTimeout(t); this._timers.delete(t); reject(new Error(e.message || e.type)); });
      });
    }
    async createRoom() {
      if (this.peer || this.closed) throw new Error('新しい通信インスタンスで部屋を作ってください');
      this.role = 'host';
      try { this.roomId = await this._openPeer(); this._status('部屋を作成しました', { roomId: this.roomId }); return this.roomId; }
      catch (e) { this.close(e.message); throw e; }
    }
    async connect(roomId) {
      if (this.peer || this.closed) throw new Error('新しい通信インスタンスで接続してください');
      if (typeof roomId !== 'string' || !roomId.trim() || roomId.length > 128) throw new Error('部屋 ID が正しくありません');
      this.role = 'guest'; this.roomId = roomId.trim();
      try {
        await this._openPeer();
        return await new Promise((resolve, reject) => {
          const conn = this.peer.connect(this.roomId, { reliable: true, serialization: 'raw', label: CONTROL_LABEL });
          this._attach(conn, resolve, reject);
        });
      } catch (e) { this.close(e.message); throw e; }
    }
    _closeOrphan(conn) {
      conn.on('error', () => {});
      conn.on('open', () => { try { conn.close(); } catch (_) {} });
      // 未openのPeerConnectionも閉じ、承認前の第2接続を保管しない。
      try { conn.close(); } catch (_) {}
    }
    _attach(conn, resolve, reject) {
      const link = { conn, snapshotConn: null, snapshotToken: '', snapshotOpen: false, remoteChannelsReady: false,
        ready: false, approved: false, pending: false, requested: false, displayName: '', queue: [], snapshots: [], inputs: [],
        inputSequence:0, receivedInputSequence:0, receivedInputBatches:new Set(), inputSendWindow:{at:now(),tokens:INPUT_RATE}, inputReceiveWindow:{at:now(),tokens:INPUT_RATE*2},
        lastBase:null,receivedBases:new Set(),snapshotSequence: {snapshot:0,snapshotBase:0}, receivedSequence: {snapshot:0,snapshotBase:0}, assemblies:new Map(),
        lastReceive: now(), opened: now(), stalledAt: 0, resolve, reject, sentBytes: 0, receivedBytes: 0,
        rttMs: null, pingAt: 0, pendingPing: null, clockSamples: [], clockOffsetMs: null };
      this.links.set(conn.peer, link);
      conn.on('open', () => {
        link.opened = now();
        const dc=conn.dataChannel;
        if (!dc || dc.ordered !== true || dc.maxRetransmits != null || dc.maxPacketLifeTime != null) {
          this._reject(link,'制御用チャネルの設定が正しくありません'); return;
        }
        if (this.role === 'guest') this._enqueue(link, 'hello', { appVersion: this.appVersion, displayName: this.displayName }, true);
      });
      conn.on('data', data => this._receive(link, data, 'control'));
      conn.on('close', () => this._drop(link, '対戦接続が切れました'));
      conn.on('error', e => this._drop(link, '対戦接続エラー: ' + (e.message || e.type)));
    }
    _connectSnapshot(link) {
      // PeerJS 1.5.5のNegotiatorは公開connectオプションのmaxRetransmitsを渡さない。
      // connect内の同期createDataChannel呼び出しだけを補い、他のlabelは変えず即復元する。
      // ライブラリ更新時はonline_channel_check.jsで実RTCDataChannelの設定を再確認する。
      const proto=root.RTCPeerConnection?.prototype, original=proto?.createDataChannel;
      try {
        if (original) proto.createDataChannel=function(label, config) {
          return original.call(this,label,label===SNAPSHOT_LABEL?{...config,ordered:false,maxRetransmits:0}:config);
        };
        const conn=this.peer.connect(this.roomId,{reliable:false,serialization:'raw',label:SNAPSHOT_LABEL,
          metadata:{protocolVersion:PROTOCOL,roomId:this.roomId,controlId:link.conn.connectionId,token:link.snapshotToken}});
        if(!conn)throw Error('状態用チャネルを作成できません');
        this._attachSnapshot(link,conn);
      } catch(e) { this._drop(link,'状態用チャネルの作成に失敗しました: '+e.message); }
      finally { if(original)proto.createDataChannel=original; }
    }
    _attachSnapshot(link, conn) {
      link.snapshotConn=conn;
      conn.on('open',()=>{
        if(this.closed || link.closing || this.links.get(link.conn.peer)!==link){this._closeOrphan(conn);return;}
        const dc=conn.dataChannel;
        if(!dc || dc.ordered!==false || dc.maxRetransmits!==0 || dc.maxPacketLifeTime!=null){
          this._reject(link,'状態用チャネルが再送なし・順序保証なしで開かれていません');return;
        }
        link.snapshotOpen=true;
        this._enqueue(link,'channelsReady',{token:link.snapshotToken},true); this._maybeReady(link);
      });
      conn.on('data',data=>this._receive(link,data,'snapshot'));
      conn.on('close',()=>this._drop(link,'状態用チャネルが切れました'));
      conn.on('error',e=>this._drop(link,'状態用チャネルの接続エラー: '+(e.message||e.type)));
    }
    _maybeReady(link) {
      if(link.ready || link.closing || !link.approved || !link.conn.open || !link.snapshotOpen || !link.remoteChannelsReady)return;
      link.ready=true;link.pending=false;link.lastReceive=now();
      link.resolve?.(this.roomId);link.resolve=null;link.reject=null;
      this.options.onPeerJoin?.(link.conn.peer,link.displayName);
      if(this.role==='guest')this._status('部屋に接続しました');
    }
    _envelope(type, payload) {
      return { protocolVersion: PROTOCOL, appVersion: this.appVersion, roomId: this.roomId, matchId: this.matchId, sender: this.peer?.id, type, payload };
    }
    _enqueue(link, type, payload, internal = false) {
      if (this.closed || link.closing || (!internal && (!link.ready || !link.approved))) return false;
      if (!link.approved && !['hello','pending','welcome','reject','bye'].includes(type)) return false;
      if(isSnapshot(type) && this.role!=='host')return false;
      if(type==='input' || (type==='inputActions' && this.role!=='guest'))return false;
      if(type==='inputBatch' && (this.role!=='guest' || !this.started || !this.matchId || !isInputBatch(payload)))return false;
      const envelope=this._envelope(type,payload);
      let text,baseCache;
      try {
        if(type==='snapshotBase') {
          const body=JSON.stringify(payload);
          if(link.lastBase?.matchId===this.matchId && link.lastBase.body===body)envelope.snapshotSequence=link.lastBase.sequence;
          else {
            envelope.snapshotSequence=++link.snapshotSequence[type];
            baseCache={matchId:this.matchId,body,sequence:envelope.snapshotSequence};
          }
        } else if(type==='snapshot')envelope.snapshotSequence=++link.snapshotSequence[type];
        else if(type==='inputBatch') {
          // 写真番号とは別系列。古いcontrol接続に属する入力も使い回せない。
          envelope.inputSequence=++link.inputSequence;envelope.connectionToken=link.snapshotToken;
        }
        text = JSON.stringify(envelope);
      } catch (_) { this._status('送信データを JSON に変換できません', { error: true }); return false; }
      const bytes = encoder.encode(text).byteLength;
      if (bytes > MAX_BYTES) { this._status('送信データが上限を超えました', { error: true, bytes }); return false; }
      if(type==='inputBatch' && bytes>INPUT_BYTES)return false;
      if(baseCache)link.lastBase=baseCache;
      if(type==='snapshotBase' && link.snapshots.some(x=>x.type===type&&x.text===text))return true;
      const item = { text, bytes, type, channel:isSnapshot(type)||type==='inputBatch'?'snapshot':'control', due: now() + this.latencyMs };
      // 呼出元のpayloadが後で変わっても、実際にwireへ載る内容だけを送信完了時に返す。
      if(type==='snapshot')item.snapshotPayload=JSON.parse(text).payload;
      if(type==='inputBatch') {
        // 人工片道遅延中の数コマは残す。毎回dueを延ばして永久に未送信にしない。
        link.inputs.push(item);
        // 上限時も最古dueを残す。高Hz採取と遅延注入が重なって全件が期限前に消えるのを防ぐ。
        if(link.inputs.length>INPUT_QUEUE){link.inputs.splice(1,1);this.inputDrops.superseded++;}
      } else if (isSnapshot(type)) {
        item.packets=this._snapshotPackets(envelope,text);item.packetIndex=0;
        if(item.packets.some(p=>p.bytes>PACKET_BYTES)){this._status('状態用の分割データが上限を超えました',{error:true});return false;}
        if(type==='snapshotBase') {
          const old=link.snapshots.filter(x=>x.type===type);this.snapshotDrops.superseded+=old.length;
          link.snapshots=link.snapshots.filter(x=>x.type!==type);
        }
        link.snapshots.push(item);
        if(link.snapshots.length>18){link.snapshots.shift();this.snapshotDrops.superseded++;}
      } else {
        if (link.queue.length >= MAX_QUEUE) { this._drop(link, '送信待ちが上限を超えました'); return false; }
        link.queue.push(item);
      }
      this.totals.maxQueue = Math.max(this.totals.maxQueue, link.queue.length + link.snapshots.length + link.inputs.length);
      return true;
    }
    _takeInputBudget(link,key) {
      const window=link[key],t=now(),capacity=key==='inputReceiveWindow'?INPUT_RATE*2:INPUT_RATE;
      // 固定1秒窓ではなく120件/秒の補充。受信は短期jitterのまとまった到着を許す。
      window.tokens=Math.min(capacity,window.tokens+Math.max(0,t-window.at)*INPUT_RATE/1000);window.at=t;
      if(window.tokens<1)return false;
      window.tokens--;return true;
    }
    _snapshotPackets(envelope, text) {
      const data=encoder.encode(text);
      if(data.byteLength<=PACKET_BYTES)return [{text,bytes:data.byteLength,type:envelope.type,channel:'snapshot'}];
      const packets=[],count=Math.ceil(data.byteLength/CHUNK_BYTES);
      for(let index=0;index<count;index++) {
        const chunk=data.subarray(index*CHUNK_BYTES,(index+1)*CHUNK_BYTES);
        const payload={type:envelope.type,sequence:envelope.snapshotSequence,index,count,data:btoa(String.fromCharCode(...chunk))};
        const wire=JSON.stringify(this._envelope('snapshotChunk',payload));
        packets.push({text:wire,bytes:encoder.encode(wire).byteLength,type:envelope.type,channel:'snapshot'});
      }
      return packets;
    }
    send(type, payload, peerId) {
      if (typeof type !== 'string' || !type || ['hello', 'pending', 'welcome', 'reject', 'match', 'ping', 'pong', 'bye', 'channelsReady', 'snapshotChunk'].includes(type)) return false;
      const target = peerId || (this.role === 'guest' ? this.roomId : '');
      const link = this.links.get(target);
      return !!link && this._enqueue(link, type, payload);
    }
    broadcast(type, payload) { let count = 0; for (const id of this.links.keys()) if (this.send(type, payload, id)) count++; return count; }
    dropPendingSnapshots(peerId) {
      const link=this.links.get(peerId);
      if(this.role!=='host'||!link)return 0;
      // 可視範囲の切替時は旧写真の残り断片も捨てる。既にsend済みの情報は撤回できない。
      // controlや逆方向の入力は触らず、この相手の写真と再同期用基準番号だけを無効化する。
      const count=link.snapshots.length;
      this.snapshotDrops.superseded+=count;link.snapshots.length=0;link.lastBase=null;
      return count;
    }
    canStartMatch() {
      return this.role==='host' && !this.closed && !this.started && [...this.links.values()].every(l=>l.closing || !l.approved || l.ready);
    }
    startMatch(matchId) {
      if (!this.canStartMatch()) throw new Error('両方の通信チャネルの準備が完了していないため、試合を開始できません');
      this.matchId = matchId || ('match-' + Math.random().toString(36).slice(2));
      if (typeof this.matchId !== 'string' || this.matchId.length > 128) throw new Error('試合 ID が正しくありません');
      this.started = true;
      for (const link of [...this.links.values()]) {
        if (link.ready && link.approved) this._enqueue(link, 'match', { matchId: this.matchId }, true);
        else this._reject(link, 'ホストが試合を開始したため、承認待ちの入室を取り消しました');
      }
      return this.matchId;
    }
    _receive(link, raw, channel = 'control') {
      if (this.closed || link.closing || this.links.get(link.conn.peer)!==link) return;
      if(channel==='snapshot' && (!link.ready || !link.approved))return;
      if (typeof raw !== 'string' || raw.length > MAX_BYTES) { this._drop(link, '不正な通信形式です'); return; }
      const bytes = encoder.encode(raw).byteLength;
      if (bytes > (channel==='snapshot'?(this.role==='host'?INPUT_BYTES:PACKET_BYTES):MAX_BYTES)) { this._drop(link, '受信データが大きすぎます'); return; }
      let msg; try { msg = JSON.parse(raw); } catch (_) { this._drop(link, 'JSON が壊れています'); return; }
      if (!msg || typeof msg !== 'object') { this._drop(link, '不正な通信データです'); return; }
      // 非再送線は方向ごとに型を限定。ゲスト由来の断片は復元処理へ入れない。
      if(channel==='snapshot' && (this.role==='host'?msg.type!=='inputBatch':!isSnapshot(msg.type)&&msg.type!=='snapshotChunk')) {
        this._drop(link,'状態・入力用チャネルの送信方向またはデータ種別が正しくありません');return;
      }
      if(msg.type==='input' || (channel==='control' && (isSnapshot(msg.type)||msg.type==='snapshotChunk'||msg.type==='inputBatch'))) {
        this._drop(link,'制御用チャネルに連続入力または状態データが届きました');return;
      }
      if(msg.type==='inputActions' && this.role!=='host'){this._drop(link,'入力操作の送信方向が正しくありません');return;}
      if (msg.type === 'reject' && !link.ready) { this._drop(link, typeof msg.reason === 'string' ? msg.reason.slice(0,200) : '参加を拒否されました'); return; }
      if (msg.protocolVersion !== PROTOCOL) { this._reject(link, 'オンライン通信規格が違います（自分: ' + PROTOCOL + ' / 相手: ' + String(msg.protocolVersion).slice(0,20) + '）。同じ試作版で入り直してください'); return; }
      if(channel==='control' && link.conn.label!==CONTROL_LABEL){this._reject(link,'制御用チャネルの名前が一致しません');return;}
      if (msg.roomId !== this.roomId || msg.sender !== link.conn.peer || typeof msg.type !== 'string') { this._drop(link, '通信規格または部屋情報が一致しません'); return; }
      if (msg.appVersion !== this.appVersion) { this._reject(link, 'ゲームの版が違います（自分: ' + this.appVersion + ' / 相手: ' + String(msg.appVersion).slice(0,40) + '）。同じ版で入り直してください'); return; }
      this.totals.receivedBytes += bytes; this.totals.receivedMessages++; link.receivedBytes += bytes; link.lastReceive = now();
      this.byChannel[channel].receivedBytes+=bytes;this.byChannel[channel].receivedMessages++;
      if (msg.type === 'hello' && this.role === 'host' && !link.ready && !link.pending && !link.approved) {
        if (this.started) { this._reject(link, '試合開始後の途中参加はできません'); return; }
        if (msg.matchId !== '') { this._reject(link, '試合情報が一致しません'); return; }
        if(typeof msg.payload?.displayName !== 'string' || msg.payload.displayName.length>256) {this._reject(link,'表示名が長すぎるか、形式が正しくありません');return;}
        link.requested=link.pending=true;link.opened=now();link.displayName=cleanName(msg.payload.displayName);
        this._enqueue(link,'pending',{name:link.displayName,timeoutSeconds:180},true);
        this.options.onPeerRequest?.(link.conn.peer,link.displayName); return;
      }
      if(msg.type==='pending' && this.role==='guest' && !link.ready && !link.approved && msg.matchId==='') {
        link.pending=true;link.opened=now();this._status('ホストの入室許可を待っています（3分まで）',{approvalPending:true});return;
      }
      if (msg.type === 'welcome' && this.role === 'guest' && !link.approved && msg.matchId === '') {
        if(typeof msg.payload?.snapshotToken!=='string' || msg.payload.snapshotToken.length<16 || msg.payload.snapshotToken.length>128){this._drop(link,'状態用チャネルの確認情報がありません');return;}
        link.approved=true;link.pending=false;link.opened=now();link.snapshotToken=msg.payload.snapshotToken;
        this._connectSnapshot(link);return;
      }
      if(msg.type==='channelsReady' && link.approved && msg.matchId==='' && msg.payload?.token===link.snapshotToken) {
        link.remoteChannelsReady=true;this._maybeReady(link);return;
      }
      if (!link.ready || !link.approved) { this._drop(link, '接続確認が終わっていません'); return; }
      if (msg.type === 'match' && this.role === 'guest' && !this.started && typeof msg.payload?.matchId === 'string' && msg.payload.matchId === msg.matchId) {
        this.matchId = msg.matchId; this.started = true; this.options.onMatch?.(this.matchId); return;
      }
      if (msg.matchId !== this.matchId && !['ping','pong'].includes(msg.type)) { return; } // 開始前に送られた入力が残っていても新しい試合へ適用しない。
      if(channel==='snapshot'){
        if(msg.type==='inputBatch')this._deliverInputBatch(link,msg);
        else if(msg.type==='snapshotChunk')this._receiveChunk(link,msg);else this._deliverSnapshot(link,msg);
        return;
      }
      if (msg.type === 'ping') { this._enqueue(link, 'pong', { token: msg.payload?.token, receivedAt: now() }, true); return; }
      if (msg.type === 'pong') {
        if (msg.payload?.token === link.pendingPing?.token) {
          const t1 = link.pendingPing.at, t2 = msg.payload.receivedAt, t3 = msg.payload.sentAt, t4 = now();
          link.rttMs = t4 - t1; link.pendingPing = null;
          if ([t1,t2,t3,t4].every(Number.isFinite) && t3 >= t2) {
            // NTPと同じ4時刻。端末ごとのperformance.nowの原点と応答側の待ち時間を分離する。
            const sample = { offsetMs: ((t2-t1)+(t3-t4))/2, rttMs: Math.max(0,(t4-t1)-(t3-t2)), at:t4 };
            link.clockSamples.push(sample); if(link.clockSamples.length>12)link.clockSamples.shift();
            link.clockOffsetMs = [...link.clockSamples].sort((a,b)=>a.rttMs-b.rttMs)[0].offsetMs;
          }
        }
        return;
      }
      if (msg.type === 'bye') { this._drop(link, String(msg.payload?.reason || '相手が退出しました').slice(0,200)); return; }
      if (['hello','pending','welcome','reject','match','channelsReady'].includes(msg.type)) { this._drop(link, '通信順序が正しくありません'); return; }
      this.options.onMessage?.(msg.type, msg.payload, link.conn.peer);
    }
    _deliverInputBatch(link,msg) {
      if(!this.started || !this.matchId || msg.connectionToken!==link.snapshotToken){this.inputDrops.stale++;return;}
      if(!this._takeInputBudget(link,'inputReceiveWindow')){this.inputDrops.rateLimited++;this._drop(link,'連続入力の受信頻度が上限を超えました');return;}
      if(!Number.isSafeInteger(msg.inputSequence)||msg.inputSequence<1||!isInputBatch(msg.payload)) {
        this._drop(link,'連続入力の番号またはコマ数が正しくありません');return;
      }
      const seq=msg.inputSequence;
      if(link.receivedInputBatches.has(seq)){this.inputDrops.duplicate++;return;}
      if(seq<=link.receivedInputSequence-256){this.inputDrops.stale++;return;}
      link.receivedInputBatches.add(seq);link.receivedInputSequence=Math.max(link.receivedInputSequence,seq);
      for(const n of link.receivedInputBatches)if(n<=link.receivedInputSequence-256)link.receivedInputBatches.delete(n);
      // batchの逆転だけでは捨てない。各コマ番号・lifeId・失効はゲーム側で検証する。
      this.options.onMessage?.('inputBatch',msg.payload,link.conn.peer);
    }
    _snapshotIsStale(link,type,seq) {
      // 基準は遅れて届く親も必要。状態とは番号を分け、基準は直近32件の未受信分を許す。
      return type==='snapshot' ? seq<=link.receivedSequence.snapshot :
        link.receivedBases.has(seq) || seq<=link.receivedSequence.snapshotBase-32;
    }
    _deliverSnapshot(link, msg) {
      const seq=msg.snapshotSequence;
      if(!Number.isSafeInteger(seq)||seq<1){this._drop(link,'状態の通し番号が正しくありません');return;}
      if(this._snapshotIsStale(link,msg.type,seq)){this.snapshotDrops.stale++;return;}
      link.receivedSequence[msg.type]=Math.max(link.receivedSequence[msg.type],seq);
      if(msg.type==='snapshotBase') {
        link.receivedBases.add(seq);
        for(const n of link.receivedBases)if(n<=link.receivedSequence.snapshotBase-32)link.receivedBases.delete(n);
      }
      for(const [key,a] of link.assemblies)if(a.type===msg.type&&this._snapshotIsStale(link,a.type,a.sequence))link.assemblies.delete(key);
      this.options.onMessage?.(msg.type,msg.payload,link.conn.peer);
    }
    _receiveChunk(link, msg) {
      const p=msg.payload,maxCount=Math.ceil(MAX_BYTES/CHUNK_BYTES);
      if(!p||!isSnapshot(p.type)||!Number.isSafeInteger(p.sequence)||p.sequence<1||!Number.isInteger(p.index)||
          !Number.isInteger(p.count)||p.count<2||p.count>maxCount||p.index<0||p.index>=p.count||
          typeof p.data!=='string'||p.data.length>CHUNK_BYTES*4/3||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.data)) {
        this._drop(link,'状態の分割データが正しくありません');return;
      }
      if(this._snapshotIsStale(link,p.type,p.sequence)){this.snapshotDrops.stale++;return;}
      const key=p.type+':'+p.sequence;
      let a=link.assemblies.get(key);
      if(!a) {
        if(link.assemblies.size>=MAX_ASSEMBLIES){link.assemblies.delete(link.assemblies.keys().next().value);this.snapshotDrops.incomplete++;}
        a={type:p.type,sequence:p.sequence,count:p.count,parts:new Map(),bytes:0,at:now()};link.assemblies.set(key,a);
      }
      if(a.count!==p.count){this._drop(link,'状態の分割数が一致しません');return;}
      if(a.parts.has(p.index))return;
      const binary=atob(p.data),part=Uint8Array.from(binary,c=>c.charCodeAt(0));
      a.bytes+=part.length;if(a.bytes>MAX_BYTES){this._drop(link,'状態の復元サイズが上限を超えました');return;}
      a.parts.set(p.index,part);
      if(a.parts.size!==a.count)return;
      link.assemblies.delete(key);
      const bytes=new Uint8Array(a.bytes);let offset=0;
      for(let i=0;i<a.count;i++){bytes.set(a.parts.get(i),offset);offset+=a.parts.get(i).length;}
      let full;try{full=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch(_){this._drop(link,'状態の分割データを復元できません');return;}
      if(!full || typeof full!=='object' || Array.isArray(full) || full.type!==p.type || full.snapshotSequence!==p.sequence || full.protocolVersion!==PROTOCOL ||
          full.appVersion!==this.appVersion || full.roomId!==this.roomId || full.matchId!==this.matchId || full.sender!==link.conn.peer){
        this._drop(link,'復元した状態の接続情報が一致しません');return;
      }
      this._deliverSnapshot(link,full);
    }
    _reject(link, reason) {
      if(link.closing)return;link.closing=true;link.queue.length=0;link.snapshots.length=0;link.inputs.length=0;
      this._status(reason, { error: true });
      try { link.conn.send(JSON.stringify({ type: 'reject', reason })); } catch (_) {}
      this._later(() => this._drop(link, reason), 100);
    }
    _drop(link, reason) {
      if (this.links.get(link.conn.peer) !== link) return;
      this.links.delete(link.conn.peer);
      this.history.set(link.conn.peer, { sentBytes: link.sentBytes, receivedBytes: link.receivedBytes, rttMs: link.rttMs, reason, channels:{control:channelSettings(link.conn),snapshot:channelSettings(link.snapshotConn)} });
      link.assemblies.clear();link.receivedInputBatches.clear();link.queue.length=0;link.snapshots.length=0;link.inputs.length=0;
      link.reject?.(new Error(reason)); link.reject = null;
      try { link.conn.close(); } catch (_) {}
      try { link.snapshotConn?.close(); } catch (_) {}
      this._status(reason, { peerId: link.conn.peer, error: true });
      if (link.ready && link.approved) this.options.onPeerLeave?.(link.conn.peer, reason);
      else if(link.requested || link.pending)this.options.onRequestClosed?.(link.conn.peer,reason);
    }
    _tick() {
      if (this.closed) return;
      const t = now();
      for (const link of [...this.links.values()]) {
        if (link.closing) continue;
        if (!link.ready && t - link.opened > (link.pending?180000:15000)) { this._reject(link, link.pending?'入室許可の待ち時間が3分を超えました':'直接接続が時間切れです。STUN のみでは接続できない回線があります'); continue; }
        if (link.ready && t - link.lastReceive > 10000) { this._drop(link, '対戦通信の応答がありません'); continue; }
        if (!link.conn.open) continue;
        for(const [key,a] of link.assemblies)if(t-a.at>(a.type==='snapshotBase'?BASE_TTL:ASSEMBLY_TTL)){link.assemblies.delete(key);this.snapshotDrops.incomplete++;}
        const buffered = link.conn.dataChannel?.bufferedAmount || 0;
        this.totals.maxBufferedBytes = Math.max(this.totals.maxBufferedBytes, buffered);
        if (buffered > HIGH_WATER || (link.conn.bufferSize || 0) > 32) {
          if (!link.stalledAt) { link.stalledAt = t; this._status('制御通信が詰まっています', { peerId: link.conn.peer }); }
          if (t - link.stalledAt > 5000) {this._drop(link, '通信の詰まりが回復しません');continue;}
        } else {
          link.stalledAt = 0;
          if (link.ready && t - link.pingAt > 1000 && !link.pendingPing) {
            link.pingAt = t; const token = ++this.sequence; link.pendingPing = { token, at: t }; this._enqueue(link, 'ping', { token }, true);
          }
          let budget=HIGH_WATER-buffered;
          while(link.queue.length && link.queue[0].due<=t) {
            const item=link.queue[0];if(item.bytes>budget)break;
            link.queue.shift();if(!this._write(link,item))break;budget-=item.bytes;
          }
        }
        if(!link.closing && this.links.get(link.conn.peer)===link) {
          if(this.role==='host')this._flushSnapshots(link,t);else this._flushInputs(link,t);
        }
      }
      if (!this.samples.length || t - this.samples[this.samples.length - 1].at >= 1000) {
        this.samples.push({ at: t, sentBytes: this.totals.sentBytes }); if (this.samples.length > 600) this.samples.shift();
      }
    }
    _flushSnapshots(link,t) {
      if(!link.ready || !link.snapshotConn?.open)return;
      const buffered=link.snapshotConn.dataChannel?.bufferedAmount||0;
      this.totals.maxBufferedBytes=Math.max(this.totals.maxBufferedBytes,buffered);
      if(buffered>HIGH_WATER || (link.snapshotConn.bufferSize||0)>0) {
        this.snapshotDrops.congestion+=link.snapshots.length;link.snapshots.length=0;return;
      }
      let budget=HIGH_WATER-buffered;
      for(const type of ['snapshotBase','snapshot']) {
        const due=link.snapshots.filter(x=>x.type===type && x.due<=t);
        if(!due.length)continue;
        const item=due.at(-1);
        this.snapshotDrops.superseded+=due.length-1;
        link.snapshots=link.snapshots.filter(x=>!due.includes(x)||x===item);
        if(!item.lossChecked){
          item.lossChecked=true;
          if((this.options.random||Math.random)()<this.snapshotDropRate){
            this.snapshotDrops.artificial++;link.snapshots=link.snapshots.filter(x=>x!==item);continue;
          }
        }
        if(t-item.due>ASSEMBLY_TTL){this.snapshotDrops.congestion++;link.snapshots=link.snapshots.filter(x=>x!==item);continue;}
        while(item.packetIndex<item.packets.length) {
          const packet=item.packets[item.packetIndex];if(packet.bytes>budget)break;
          if(!this._write(link,packet,link.snapshotConn))return;
          item.packetIndex++;budget-=packet.bytes;
        }
        if(item.packetIndex===item.packets.length){
          link.snapshots=link.snapshots.filter(x=>x!==item);
          // enqueue成功・一部断片の送信では記録しない。相手の到着保証とは別で、
          // この論理写真の全断片をsendへ渡し終えた時だけラグ補償の検証候補にする。
          if(item.type==='snapshot'){
            try{this.options.onSnapshotSent?.(link.conn.peer,item.snapshotPayload);}
            catch(_){/* 送信は完了済み。通知先の失敗で再送したり、他の相手の送信を止めない。 */}
          }
        }
      }
    }
    _flushInputs(link,t) {
      if(!link.ready || !link.snapshotConn?.open)return;
      const buffered=link.snapshotConn.dataChannel?.bufferedAmount||0;
      this.totals.maxBufferedBytes=Math.max(this.totals.maxBufferedBytes,buffered);
      if(buffered>HIGH_WATER || (link.snapshotConn.bufferSize||0)>0) {
        // SCTPへ渡せなかった古い入力は積まず、次に出せる最新batchを1件だけ保つ。
        this.inputDrops.congestion+=Math.max(0,link.inputs.length-1);link.inputs=link.inputs.slice(-1);return;
      }
      const due=link.inputs.filter(x=>x.due<=t);
      if(!due.length)return;
      const item=due.at(-1);
      if(item.bytes>HIGH_WATER-buffered)return;
      // 採取回数ではなく実送信に上限をかける。超過中も最新の待ち入力を失わない。
      if(!this._takeInputBudget(link,'inputSendWindow')){this.inputDrops.rateLimited++;return;}
      this.inputDrops.superseded+=due.length-1;link.inputs=link.inputs.filter(x=>!due.includes(x));
      if(t-item.due>INPUT_TTL){this.inputDrops.stale++;return;}
      if((this.options.inputRandom||Math.random)()<this.inputDropRate){this.inputDrops.artificial++;return;}
      this._write(link,item,link.snapshotConn);
    }
    _write(link, item, conn = link.conn) {
      if(this.role==='host'&&item.type==='events'&&this.options.filterEvents){
        // 遅延待ちの間に観測範囲が変わり得るため、空間情報を渡す直前に再選別する。
        // filterは縮小専用。例外や拡張はこの出来事だけ安全側へ捨て、他の制御を続ける。
        try{
          const envelope=JSON.parse(item.text),filtered=this.options.filterEvents(link.conn.peer,envelope.payload);
          if(!Array.isArray(filtered)||!filtered.length){item.bytes=0;return true;}
          envelope.payload=filtered;const text=JSON.stringify(envelope),bytes=encoder.encode(text).byteLength;
          if(bytes>item.bytes){item.bytes=0;return true;}
          item.text=text;item.bytes=bytes;
        }catch(_){item.bytes=0;return true;}
      }
      // 実際に送信バッファへ渡す時刻を使う（送信待ち・遅延注入を時計差と誤認しない）。
      if (item.type === 'ping' || item.type === 'pong') {
        const envelope = JSON.parse(item.text); envelope.payload.sentAt = now();
        if(item.type === 'ping' && link.pendingPing?.token === envelope.payload.token)link.pendingPing.at=envelope.payload.sentAt;
        item.text=JSON.stringify(envelope);item.bytes=encoder.encode(item.text).byteLength;
      }
      try { conn.send(item.text); } catch (e) { this._drop(link, '送信に失敗しました: ' + e.message); return false; }
      this.totals.sentBytes += item.bytes; this.totals.sentMessages++; link.sentBytes += item.bytes;
      const lane=conn===link.snapshotConn?'snapshot':'control';
      this.byChannel[lane].sentBytes+=item.bytes;this.byChannel[lane].sentMessages++;
      this.totals.byType[item.type] = (this.totals.byType[item.type] || 0) + item.bytes;
      // 成功送信だけを集計。履歴を保存せず、種類数も64種類＋その他に制限する。
      const sizeKey = Object.hasOwn(this.messageSizes, item.type) || Object.keys(this.messageSizes).length < 64 ? item.type : '__other__';
      const size = this.messageSizes[sizeKey] ||= { count: 0, totalBytes: 0, minBytes: item.bytes, maxBytes: item.bytes };
      size.count++; size.totalBytes += item.bytes;
      size.minBytes = Math.min(size.minBytes, item.bytes); size.maxBytes = Math.max(size.maxBytes, item.bytes);
      return true;
    }
    clock(peerId = this.role === 'guest' ? this.roomId : '') {
      const link=this.links.get(peerId);
      return link && Number.isFinite(link.clockOffsetMs) ? {offsetMs:link.clockOffsetMs,rttMs:link.rttMs,samples:link.clockSamples.length} : null;
    }
    async waitForClock(peerId = this.role === 'guest' ? this.roomId : '', timeoutMs = 5000) {
      const deadline=now()+timeoutMs;
      while(!this.closed && now()<deadline) {
        const link=this.links.get(peerId); if(!link?.ready)throw new Error('時刻を合わせる相手と接続されていません');
        const sample=this.clock(peerId);if(sample?.samples>=3)return sample;
        if(!link.pendingPing) {const token=++this.sequence;link.pingAt=now();link.pendingPing={token,at:now()};this._enqueue(link,'ping',{token},true);}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw new Error('ホストとの時刻合わせが時間切れになりました');
    }
    metrics() {
      const seconds = Math.max(.001, (now() - this.createdAt) / 1000);
      const rates = this.samples.slice(1).map((s, i) => (s.sentBytes - this.samples[i].sentBytes) / ((s.at - this.samples[i].at) / 1000) / 1000).sort((a,b)=>a-b);
      return { ...this.totals, byChannel:Object.fromEntries(Object.entries(this.byChannel).map(([k,v])=>[k,{...v}])), byType: { ...this.totals.byType }, messageSizes: Object.fromEntries(Object.entries(this.messageSizes).map(([type, size]) => [type, { ...size }])), elapsedSeconds: seconds, sentKBps: this.totals.sentBytes / seconds / 1000, p95KBps: rates[Math.floor((rates.length - 1) * .95)] || 0, maxKBps: rates[rates.length - 1] || 0,
        connectedPeers: [...this.links.values()].filter(l=>l.ready&&l.approved&&!l.closing).length, pendingPeers:[...this.links.values()].filter(l=>l.pending&&!l.closing).length,
        peers: [...this.links].map(([id,l])=>({ id, sentBytes:l.sentBytes, receivedBytes:l.receivedBytes, rttMs:l.rttMs,
          bufferedBytes:(l.conn.dataChannel?.bufferedAmount||0)+(l.snapshotConn?.dataChannel?.bufferedAmount||0), queue:l.queue.length+l.snapshots.length+l.inputs.length,
          channels:{control:channelSettings(l.conn),snapshot:channelSettings(l.snapshotConn)},ready:l.ready })),
        closedPeers: [...this.history].map(([id,s])=>({id,...s})), latencyMs:this.latencyMs,
        snapshotDropRate:this.snapshotDropRate,snapshotDropUnit:'logical-message',snapshotDrops:{...this.snapshotDrops},
        inputDropRate:this.inputDropRate,inputDropUnit:'logical-batch',inputDrops:{...this.inputDrops} };
    }
    setCapacity(next) {
      // 承認待ちは定員に含めない。既に許可した参加者を設定変更で追い出さない。
      if(this.role!=='host'||this.started||this.closed||!Number.isInteger(next)||next<2||next>4)return false;
      if([...this.links.values()].filter(l=>l.approved&&!l.closing).length+1>next)return false;
      this.capacity=next;return true;
    }
    approvePeer(peerId) {
      const link=this.links.get(peerId);
      if(this.role!=='host'||this.started||this.closed||!link?.pending||link.approved||link.closing)return false;
      if([...this.links.values()].filter(l=>l.approved&&!l.closing).length>=this.capacity-1) {this._reject(link,`部屋は満員です（ホストを含め${this.capacity}人まで）`);return false;}
      // randomUUIDが無い非HTTPS表示でも、暗号学的乱数で接続を結び付ける。
      try { link.snapshotToken=[...root.crypto.getRandomValues(new Uint8Array(24))].map(n=>n.toString(16).padStart(2,'0')).join(''); }
      catch (_) {this._status('接続確認用の乱数を作れませんでした',{error:true});return false;}
      link.pending=false;link.approved=true;link.opened=link.lastReceive=now();
      this._enqueue(link,'welcome',{peerId:link.conn.peer,snapshotToken:link.snapshotToken},true);
      return true;
    }
    rejectPeer(peerId, reason='ホストが入室を拒否しました') {
      const link=this.links.get(peerId);
      if(this.role!=='host'||this.started||this.closed||!link?.pending||link.approved||link.closing)return false;
      this._reject(link,reason);return true;
    }
    kickPeer(peerId, reason='ホストがロビーから退出させました') {
      const link=this.links.get(peerId);
      if(this.role!=='host'||this.started||this.closed||!link?.approved||link.closing)return false;
      return this.disconnectPeer(peerId,reason);
    }
    disconnectPeer(peerId, reason = '対戦から退出しました') {
      const link = this.links.get(peerId);
      if (!link || link.closing) return false;
      // 所有権を失った相手には状態も入力も送受信せず、終了理由だけを通知する。
      link.closing = true; link.queue.length = 0; link.snapshots.length = 0; link.inputs.length = 0;
      if (link.conn.open) { try { link.conn.send(JSON.stringify(this._envelope('bye', { reason }))); } catch (_) {} }
      // 通知は最善努力。相手の応答がなくてもこの接続だけを必ず閉じる。
      this._later(() => this._drop(link, reason), 500);
      return true;
    }
    close(reason = '部屋を閉じました') {
      if (this.closed) return;
      // 終了通知は最善努力。閉じた後の通信成功を保証しない。
      for (const link of this.links.values()) if (link.ready && link.conn.open) { try { link.conn.send(JSON.stringify(this._envelope('bye', { reason }))); } catch (_) {} }
      this.closed = true; clearInterval(this._tickTimer);
      for (const t of this._timers) clearTimeout(t); this._timers.clear();
      for (const link of [...this.links.values()]) this._drop(link, reason);
      try { this.peer?.destroy(); } catch (_) {}
    }
  }
  CBOnlineTransport.PROTOCOL = PROTOCOL;
  CBOnlineTransport.SNAPSHOT_LABEL = SNAPSHOT_LABEL;
  CBOnlineTransport.CONTROL_LABEL = CONTROL_LABEL;
  CBOnlineTransport.PEERJS_VERSION = '1.5.5';
  root.CBOnlineTransport = CBOnlineTransport;
  if (typeof module !== 'undefined' && module.exports) module.exports = CBOnlineTransport;
})(typeof window !== 'undefined' ? window : globalThis);
