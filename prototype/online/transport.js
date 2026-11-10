/* #212: PeerJS 1.5.5 用のブラウザホスト通信。ゲームの状態はここで計算しない。 */
(function (root) {
  'use strict';
  const PROTOCOL = 11, MAX_BYTES = 262144, MAX_QUEUE = 256, HIGH_WATER = 262144;
  const CONTROL_LABEL = 'core-breaker-control-v10', SNAPSHOT_LABEL = 'core-breaker-snapshot-v10';
  const PACKET_BYTES = 16384, CHUNK_BYTES = 9000, MAX_ASSEMBLIES = 4, ASSEMBLY_TTL = 1000, BASE_TTL = 10000;
  const INPUT_BYTES = 8192, INPUT_FRAMES = 5, INPUT_RATE = 120, INPUT_QUEUE = 16, INPUT_TTL = 250;
  // 直接つながらない回線のための中継（TURN）。期限つきの合言葉を Worker（tools/turn-worker/）から受け取る。
  // 中継の既定先は coturn。URL が空のうちは今までどおり STUN だけ。
  const ICE_URL = '';
  const STUN_ONLY = [{ urls: 'stun:stun.l.google.com:19302' }];
  const ICE_FETCH_MS = 5000;
  // 貼り付けた部屋IDの掃除（2026-11-10 オーナー「コピペのときに半角スペース混じって入れなかった人居る疑惑」）。
  // 前後だけでなく途中の空白・改行・見えない文字（ゼロ幅）を取り、全角の英数字と記号は半角へ直す。
  // 「部屋ID: xxxx　ゲストの…」のように文ごと貼られたときは、中の UUID の形だけを拾う。
  const ROOM_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  function cleanRoomId(value) {
    if (typeof value !== 'string') return '';
    const text = value.normalize('NFKC').replace(/[\u2010-\u2015\u2212\u30fc\uff0d]/g, '-');
    const spaced = text.replace(/[\s\u200b-\u200d\u2060\ufeff\u00ad]/g, '');
    const found = ROOM_UUID.exec(spaced) || ROOM_UUID.exec(text);
    return found ? found[0].toLowerCase() : spaced;
  }
  const iceUrls = s => Array.isArray(s?.urls) ? s.urls : [s?.urls];
  // stun:/turn:/turns: だけ。TURN には合言葉が要る。ブラウザが待たされる53番ポートは外す（Cloudflare の案内）。
  const cleanIceServers = list => {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const s of list) {
      if (!s || typeof s !== 'object') return null;
      const urls = iceUrls(s).filter(u => typeof u === 'string' && !/:53(\?|$)/.test(u));
      if (iceUrls(s).some(u => typeof u !== 'string' || !/^(stun|turns?):/.test(u))) return null;
      const relay = urls.some(u => /^turns?:/.test(u));
      if (relay && (typeof s.username !== 'string' || typeof s.credential !== 'string' || !s.username || !s.credential)) return null;
      if (urls.length) out.push(relay ? { urls, username: s.username, credential: s.credential } : { urls });
    }
    return out.length ? out : null;
  };
  const hasRelay = list => list.some(s => iceUrls(s).some(u => /^turns?:/.test(u)));
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
  // 状態写真（差分）は、中身のbase64文字列をやめてバイナリのまま送る（約3割減。2026-11-08 オーナーと分担した通信量の削減）。
  // 形：[0xCB][見出しJSONの長さ varint][見出しJSON utf8][差分の生バイト]。見出しは delta[2] を0にした元の封筒そのもの。
  // 受け手は base64 に戻して元のJSON文字列を作り直し、今までと同じ検査へ渡す。分割する大きな基準写真は今までどおり文字。
  const BINARY_MAGIC = 0xCB, textDecoder = new TextDecoder();
  const bytesFrom64 = s => typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const bytesTo64 = b => { if (typeof Buffer !== 'undefined') return Buffer.from(b).toString('base64'); let t = ''; for (let i = 0; i < b.length; i += 32768) t += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(t); };
  const isBinaryWire = raw => raw instanceof ArrayBuffer || ArrayBuffer.isView(raw);
  function binarySnapshot(envelope) {
    const delta = envelope?.payload?.delta;
    if (envelope?.type !== 'snapshot' || !Array.isArray(delta) || delta.length !== 3 || typeof delta[2] !== 'string') return null;
    const body = bytesFrom64(delta[2]), header = encoder.encode(JSON.stringify({ ...envelope, payload: { ...envelope.payload, delta: [delta[0], delta[1], 0] } }));
    const length = []; let n = header.length; while (n >= 128) { length.push(n % 128 + 128); n = Math.floor(n / 128); } length.push(n);
    const out = new Uint8Array(1 + length.length + header.length + body.length);
    out[0] = BINARY_MAGIC; out.set(length, 1); out.set(header, 1 + length.length); out.set(body, 1 + length.length + header.length);
    return out;
  }
  // 受け取ったバイナリ写真を元のJSON文字列へ戻す。形が違えば null（呼び手が不正な通信として切る）。
  function textFromBinary(raw) {
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (bytes.length < 3 || bytes[0] !== BINARY_MAGIC) return null;
    let at = 1, n = 0, mul = 1;
    for (let count = 0; ; count++) { if (at >= bytes.length || count > 4) return null; const b = bytes[at++]; n += (b & 127) * mul; if (b < 128) break; mul *= 128; }
    if (at + n > bytes.length) return null;
    try {
      const envelope = JSON.parse(textDecoder.decode(bytes.subarray(at, at + n))), delta = envelope?.payload?.delta;
      if (envelope?.type !== 'snapshot' || !Array.isArray(delta) || delta.length !== 3 || delta[2] !== 0) return null;
      delta[2] = bytesTo64(bytes.subarray(at + n));
      return JSON.stringify(envelope);
    } catch (_) { return null; }
  }
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
      // 復帰証明はこのページのメモリだけ。名前/部屋IDだけでは元の席を取り戻せない。
      this.resumeSessions = new Map(); this.resumeToken = ''; this.reconnectUntil = 0; this.reconnectTimer = null;
      this.createdAt = now(); this.samples = []; this.sequence = 0;
      this.totals = { sentBytes: 0, receivedBytes: 0, sentMessages: 0, receivedMessages: 0, byType: {}, maxBufferedBytes: 0, maxQueue: 0 };
      this.messageSizes = Object.create(null);
      this.byChannel=Object.fromEntries(['control','snapshot'].map(k=>[k,{sentBytes:0,receivedBytes:0,sentMessages:0,receivedMessages:0}]));
      this.history = new Map(); this._timers = new Set();
      this._tickTimer = setInterval(() => this._tick(), 20);
    }
    _status(text, detail = {}) {
      if(detail.signaling===false)this.options.onDiagnostic?.('signaling_lost','none');
      else if(detail.error)this.options.onDiagnostic?.('transport_error', detail.type==='peer-unavailable'?'peer_unavailable':detail.type==='network'?'network_error':detail.type==='browser-incompatible'?'browser_unsupported':text);
      this.options.onStatus?.(text, detail);
    }
    // 中継の合言葉を Worker から受け取る。取れなくても STUN だけで続ける（直接つながる相手とは今までどおり）。
    async _fetchIceServers() {
      // 既定の ICE_URL は game.js が渡す（試験の偽 Peer では外へ問い合わせない）。
      const url = this.options.iceServersUrl || '';
      if (!url) { this.relayStatus = 'off'; return STUN_ONLY; }
      const fetcher = this.options.fetch || root.fetch;
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      // Peer登録より前の待機もcloseで完了する。fetch/jsonがabortを無視しても遅着を採用しない。
      let rejectWait;
      const interrupted = new Promise((_, reject) => { rejectWait = reject; });
      const cancel = error => { rejectWait(error); ctrl?.abort(); };
      this._cancelIce = cancel;
      const t = this._later(() => cancel(new Error('中継情報の取得が時間切れになりました')), ICE_FETCH_MS);
      try {
        const request = (async () => {
          const res = await fetcher(url, { method: 'POST', signal: ctrl?.signal, headers: { 'content-type': 'application/json' }, body: '{}' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const list = cleanIceServers((await res.json())?.iceServers);
          if (!list || !hasRelay(list)) throw new Error('中継先がありません');
          return list;
        })();
        const list = await Promise.race([request, interrupted]);
        if (this.closed) throw new Error('接続を取り消しました');
        this.relayStatus = 'ready';
        // 直接の通り道も探す（STUN）。中継は直接がダメなときだけブラウザが選ぶ。
        return list.some(s => iceUrls(s).some(u => u.startsWith('stun:'))) ? list : STUN_ONLY.concat(list);
      } catch (e) {
        if (this.closed) throw e;
        this.relayStatus = 'unavailable';
        this._status('中継サーバーの情報を受け取れませんでした。直接つながる相手とだけ接続します', { relay: false });
        return STUN_ONLY;
      } finally { clearTimeout(t); this._timers.delete(t); if (this._cancelIce === cancel) this._cancelIce = null; }
    }
    // つながった経路（直接か中継か）。診断と表示だけに使い、相手のアドレスは持ち出さない。
    async _checkRoute(link) {
      try {
        const pc = link.conn.peerConnection; if (!pc?.getStats) return;
        const stats = await pc.getStats(); let pair = null;
        stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
        if (!pair) stats.forEach(r => { if (!pair && r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
        if (!pair) return;
        const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
        link.route = local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direct';
        if (this.role === 'guest' && link.route === 'relay') this._status('部屋に接続しました（中継サーバー経由）', { route: 'relay' });
      } catch (_) {}
    }
    _later(fn, ms) { const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms); this._timers.add(t); return t; }
    async _openPeer() {
      const PeerClass = this.options.Peer || root.Peer;
      if (!PeerClass) throw new Error('PeerJS 1.5.5 を読み込めませんでした');
      const supplied = this.options.peerOptions || {};
      // 試験では iceServers: [] も指定できる（指定があれば中継の合言葉を取りに行かない）。
      let iceServers = supplied.config?.iceServers;
      if (iceServers) {
        if (iceServers.length && !cleanIceServers(iceServers)) throw new Error('接続の設定（STUN/TURN）が正しくありません');
        iceServers = iceServers.length ? cleanIceServers(iceServers) : [];
      } else if (!this.options.iceServersUrl) { this.relayStatus = 'off'; iceServers = STUN_ONLY; } // 中継なしは待たずに Peer を作る（今までどおり同期）
      else {
        iceServers = await this._fetchIceServers();
        if (this.closed) throw new Error('接続を取り消しました');
      }
      this.relayAvailable = hasRelay(iceServers);
      this.peer = new PeerClass(undefined, { ...supplied, config: { ...(supplied.config || {}), iceServers } });
      this.peer.on('disconnected', () => {
        if(this.closed)return;
        this._status('接続の仲立ちが切れました。接続済みの対戦は続けます', { signaling: false });
        // 対戦線が生きていても、仲立ちへの登録を復旧しないと新しい接続を受けられない。
        const until=now()+30000;
        const retry=()=>{if(this.closed||this.peer.destroyed||!this.peer.disconnected||now()>until)return;
          try{this.peer.reconnect();}catch(_){}this._later(retry,1000);};
        this._later(retry,500);
      });
      this.peer.on('error', e => {
        if(this.closed)return;
        // 制御線が未open・未承認の初回入室だけ、相手不在で待ちを終える。
        // 制御線open後や承認後はsnapshot交渉のerrorもあるため、不在と断定しない。
        // 試合中の一時切断・復帰は従来の再試行期限で扱う。
        const joining=this.role==='guest'&&!this.started?this.links.get(this.roomId):null;
        if(e.type==='peer-unavailable'&&joining&&!joining.ready&&!joining.approved&&!joining.conn.open&&!joining.closing){
          this._drop(joining,'部屋が見つかりません。部屋IDとホストが待機中か確認してください',false);return;
        }
        this._status('接続エラー: ' + (e.message || e.type), { error: true, type: e.type });
      });
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
        const resume=this.resumeSessions.get(conn.peer),meta=conn.metadata;
        const resuming=this.started&&this.options.reconnect===true&&resume&&resume.matchId===this.matchId&&resume.until>now()&&
          meta?.matchId===this.matchId&&meta?.resumeToken===resume.token&&this.options.canResumePeer?.(conn.peer)!==false;
        const reject = this.started&&!resuming ? '試合開始後の途中参加はできません' : !resuming&&[...this.links.values()].filter(l=>l.approved&&!l.closing).length >= this.capacity - 1 ? `部屋は満員です（ホストを含め${this.capacity}人まで）` : !resuming&&[...this.links.values()].filter(l=>!l.approved).length >= 8 ? '入室の承認待ちが上限です。少し待ってから入り直してください' : !resuming&&this.links.has(conn.peer) ? '同じ相手は既に接続しています' : '';
        if (reject) { conn.on('open', () => { try { conn.send(JSON.stringify({ type: 'reject', reason: reject })); } catch (_) {} this._later(() => conn.close(), 100); }); return; }
        if(resuming){
          const old=this.links.get(conn.peer);if(old)this._drop(old,'対戦接続が切れました',true);
          const link=this._attach(conn);link.resuming=true;link.displayName=resume.name;return;
        }
        this._attach(conn);
      });
      return new Promise((resolve, reject) => {
        let settled=false;
        const finish=(error,id)=>{
          if(settled)return;settled=true;clearTimeout(t);this._timers.delete(t);
          if(this._cancelOpen===cancel)this._cancelOpen=null;
          if(error)reject(error);else resolve(id);
        };
        const cancel=error=>finish(error);
        const t=this._later(()=>finish(new Error('接続サービスへの登録が時間切れになりました')),15000);
        this._cancelOpen=cancel;
        this.peer.on('open',id=>finish(this.closed?new Error('接続を取り消しました'):null,id));
        this.peer.on('error',e=>finish(new Error(e.message||e.type)));
      });
    }
    async createRoom() {
      if (this.peer || this.closed) throw new Error('新しい通信インスタンスで部屋を作ってください');
      this.role = 'host';
      try { const id=await this._openPeer();if(this.closed)throw new Error('部屋の作成を取り消しました');this.roomId=id; this._status('部屋を作成しました', { roomId: this.roomId }); return this.roomId; }
      catch (e) { this.close(e.message); throw e; }
    }
    async connect(roomId) {
      if (this.peer || this.closed) throw new Error('新しい通信インスタンスで接続してください');
      if (typeof roomId !== 'string' || roomId.length > 512) throw new Error('部屋 ID が正しくありません');
      roomId = cleanRoomId(roomId);
      if (!roomId || roomId.length > 128) throw new Error('部屋 ID が正しくありません');
      this.role = 'guest'; this.roomId = roomId;
      try {
        await this._openPeer();
        if(this.closed)throw new Error('接続を取り消しました');
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
      const link = { conn, snapshotConn: null, snapshotToken: '', resumeToken: '', resuming: false, terminal: false, snapshotOpen: false, remoteChannelsReady: false,
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
      conn.on('error', e => { if (!link.closing) this._drop(link, '対戦接続エラー: ' + (e.message || e.type),true); });
      return link;
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
      conn.on('error',e=>this._drop(link,'状態用チャネルの接続エラー: '+(e.message||e.type),true));
    }
    _maybeReady(link) {
      if(link.ready || link.closing || !link.approved || !link.conn.open || !link.snapshotOpen || !link.remoteChannelsReady)return;
      link.ready=true;link.pending=false;link.lastReceive=now();
      link.resolve?.(this.roomId);link.resolve=null;link.reject=null;
      if(this.role==='guest'&&link.resuming){this.reconnectUntil=0;clearTimeout(this.reconnectTimer);this.reconnectTimer=null;}
      const resume=this.resumeSessions.get(link.conn.peer);if(resume)resume.until=Infinity;
      this.options.onPeerJoin?.(link.conn.peer,link.displayName,{reconnected:link.resuming});
      if(this.role==='guest')this._status('部屋に接続しました');
      this._checkRoute(link);
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
        if(item.packets.length===1&&item.packets[0].binary)item.bytes=item.packets[0].bytes;
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
      if(data.byteLength<=PACKET_BYTES){
        const binary=binarySnapshot(envelope);
        return [binary?{text,binary,bytes:binary.byteLength,type:envelope.type,channel:'snapshot'}:{text,bytes:data.byteLength,type:envelope.type,channel:'snapshot'}];
      }
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
    dropPendingSnapshots(peerId,{details=false}={}) {
      const link=this.links.get(peerId);
      if(this.role!=='host'||!link)return details?{count:0,baselines:0}:0;
      // 可視範囲の切替時は旧写真の残り断片も捨てる。既にsend済みの情報は撤回できない。
      // controlや逆方向の入力は触らず、この相手の写真と再同期用基準番号だけを無効化する。
      const count=link.snapshots.length,baselines=link.snapshots.filter(item=>item.type==='snapshotBase').length;
      this.snapshotDrops.superseded+=count;link.snapshots.length=0;link.lastBase=null;
      // 従来の件数返却を維持。詳細は破棄したローカル待機列だけを表し、相手の受信状況ではない。
      return details?{count,baselines}:count;
    }
    canStartMatch() {
      return this.role==='host' && !this.closed && !this.started && [...this.links.values()].every(l=>l.closing || !l.approved || l.ready);
    }
    // 試合が終わったら同じ接続のまま部屋の待機へ戻る（2026-11-08 オーナー「さっき繋いだ人らがまたロビーに戻る形に」）。
    // 次の startMatch と、ロビー中の新しい入室を受け付けられるようにする。古い試合番号の写真や入力は捨てられる。
    returnToLobby() {
      if (this.closed) return false;
      // 送信待ちの写真は前の試合番号で包んであり、受け手が試合番号の不一致で捨てる。ここでは消さない
      // （最後の写真も相手へ届け、取りこぼしの観測と結果の照合に使えるようにする）。
      this.started = false; this.matchId = '';this.resumeSessions.clear();this.reconnectUntil=0;clearTimeout(this.reconnectTimer);this.reconnectTimer=null;
      return true;
    }
    startMatch(matchId) {
      if (!this.canStartMatch()) throw new Error('両方の通信チャネルの準備が完了していないため、試合を開始できません');
      this.matchId = matchId || ('match-' + Math.random().toString(36).slice(2));
      if (typeof this.matchId !== 'string' || this.matchId.length > 128) throw new Error('試合 ID が正しくありません');
      this.started = true;
      const startingMatchId=this.matchId;
      const stillStarting=()=>!this.closed&&this.started&&this.matchId===startingMatchId;
      for (const link of [...this.links.values()]) {
        // enqueue/reject中の同期通知で退出やロビー復帰が起きたら、残りの相手へ開始を流さない。
        if(!stillStarting())return null;
        if (link.ready && link.approved) {
          if(link.resumeToken)this.resumeSessions.set(link.conn.peer,{token:link.resumeToken,matchId:this.matchId,name:link.displayName,until:Infinity});
          if(!this._enqueue(link, 'match', { matchId: startingMatchId }, true))return null;
        }
        else this._reject(link, 'ホストが試合を開始したため、承認待ちの入室を取り消しました');
      }
      return stillStarting()?startingMatchId:null;
    }
    _receive(link, raw, channel = 'control') {
      if (this.closed || link.closing || this.links.get(link.conn.peer)!==link) return;
      if(channel==='snapshot' && (!link.ready || !link.approved))return;
      let wireBytes=null;
      if (isBinaryWire(raw)) {
        // バイナリは写真専用線のゲスト受信だけ。大きさを先に確かめてから戻す。
        wireBytes=raw.byteLength;
        const text=channel==='snapshot'&&this.role==='guest'&&wireBytes<=PACKET_BYTES?textFromBinary(raw):null;
        if(text===null){this._drop(link,'不正な通信形式です');return;}
        raw=text;
      }
      if (typeof raw !== 'string' || raw.length > MAX_BYTES) { this._drop(link, '不正な通信形式です'); return; }
      const bytes = wireBytes ?? encoder.encode(raw).byteLength;
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
      if (msg.type === 'reject' && !link.ready) { link.terminal=true;this._drop(link, typeof msg.reason === 'string' ? msg.reason.slice(0,200) : '参加を拒否されました'); return; }
      if (msg.protocolVersion !== PROTOCOL) { this._reject(link, 'オンライン通信規格が違います（自分: ' + PROTOCOL + ' / 相手: ' + String(msg.protocolVersion).slice(0,20) + '）。同じ試作版で入り直してください'); return; }
      if(channel==='control' && link.conn.label!==CONTROL_LABEL){this._reject(link,'制御用チャネルの名前が一致しません');return;}
      if (msg.roomId !== this.roomId || msg.sender !== link.conn.peer || typeof msg.type !== 'string') { this._drop(link, '通信規格または部屋情報が一致しません'); return; }
      if (msg.appVersion !== this.appVersion) { this._reject(link, 'ゲームの版が違います（自分: ' + this.appVersion + ' / 相手: ' + String(msg.appVersion).slice(0,40) + '）。同じ版で入り直してください'); return; }
      this.totals.receivedBytes += bytes; this.totals.receivedMessages++; link.receivedBytes += bytes; link.lastReceive = now();
      this.byChannel[channel].receivedBytes+=bytes;this.byChannel[channel].receivedMessages++;
      if (msg.type === 'hello' && this.role === 'host' && !link.ready && !link.pending && !link.approved) {
        if (this.started&&!link.resuming) { this._reject(link, '試合開始後の途中参加はできません'); return; }
        if (msg.matchId !== (link.resuming?this.matchId:'')) { this._reject(link, '試合情報が一致しません'); return; }
        if(typeof msg.payload?.displayName !== 'string' || msg.payload.displayName.length>256) {this._reject(link,'表示名が長すぎるか、形式が正しくありません');return;}
        if(link.resuming){this._approveLink(link);return;}
        link.requested=link.pending=true;link.opened=now();link.displayName=cleanName(msg.payload.displayName);
        this._enqueue(link,'pending',{name:link.displayName,timeoutSeconds:180},true);
        this.options.onPeerRequest?.(link.conn.peer,link.displayName); return;
      }
      if(msg.type==='pending' && this.role==='guest' && !link.ready && !link.approved && msg.matchId==='') {
        link.pending=true;link.opened=now();this._status('ホストの入室許可を待っています（3分まで）',{approvalPending:true});return;
      }
      if (msg.type === 'welcome' && this.role === 'guest' && !link.approved && msg.matchId === (link.resuming?this.matchId:'')) {
        if(typeof msg.payload?.snapshotToken!=='string' || msg.payload.snapshotToken.length<16 || msg.payload.snapshotToken.length>128){this._drop(link,'状態用チャネルの確認情報がありません');return;}
        link.approved=true;link.pending=false;link.opened=now();link.snapshotToken=msg.payload.snapshotToken;
        if(typeof msg.payload.resumeToken==='string'&&/^[a-f0-9]{48}$/.test(msg.payload.resumeToken))this.resumeToken=msg.payload.resumeToken;
        this._connectSnapshot(link);return;
      }
      if(msg.type==='channelsReady' && link.approved && msg.matchId===(link.resuming?this.matchId:'') && msg.payload?.token===link.snapshotToken) {
        link.remoteChannelsReady=true;this._maybeReady(link);return;
      }
      if (!link.ready || !link.approved) { this._drop(link, '接続確認が終わっていません'); return; }
      if (msg.type === 'match' && this.role === 'guest' && !this.started && typeof msg.payload?.matchId === 'string' && msg.payload.matchId === msg.matchId) {
        this.matchId = msg.matchId; this.started = true; this.options.onMatch?.(this.matchId); return;
      }
      // 明示退出は試合ではなく現在の接続を終了する。ロビー復帰通知の送信待ちでも受け取る。
      // 現在link・部屋・sender・版・readyの確認後だけ許し、復帰可能byeは試合番号を維持する。
      const terminalBye=msg.type==='bye'&&msg.payload?.reconnect!==true;
      if (msg.matchId !== this.matchId && !['ping','pong'].includes(msg.type) && !terminalBye) { return; } // 開始前に送られた入力が残っていても新しい試合へ適用しない。
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
      if (msg.type === 'bye') {
        const recoverable=this.role==='guest'&&msg.payload?.reconnect===true;
        if(!recoverable){link.terminal=true;this.resumeSessions.delete(link.conn.peer);}
        this._drop(link, String(msg.payload?.reason || '相手が退出しました').slice(0,200),recoverable); return;
      }
      if(msg.type==='leave'&&this.role==='host'){link.terminal=true;this.resumeSessions.delete(link.conn.peer);}
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
      if(link.closing)return;link.terminal=true;link.closing=true;link.queue.length=0;link.snapshots.length=0;link.inputs.length=0;
      this._status(reason, { error: true });
      // 開く前の PeerJS 接続へ送ると「Connection is not open」のエラーが出て、本当の理由を上書きする（2026-11-09）。
      if (link.conn.open) { try { link.conn.send(JSON.stringify({ type: 'reject', reason })); } catch (_) {} this._later(() => this._drop(link, reason), 100); }
      else this._drop(link, reason);
    }
    _drop(link, reason, recoverable = ['対戦接続が切れました','状態用チャネルが切れました','対戦通信の応答がありません','通信の詰まりが回復しません'].includes(reason)) {
      if (this.links.get(link.conn.peer) !== link) return;
      recoverable=!!(recoverable&&!link.terminal&&!this.closed&&this.started&&this.options.reconnect===true);
      const resume=this.resumeSessions.get(link.conn.peer);
      if(resume){if(recoverable)resume.until=now()+30000;else this.resumeSessions.delete(link.conn.peer);}
      this.options.onDiagnostic?.('peer_disconnected',reason);
      this.links.delete(link.conn.peer);
      this.history.set(link.conn.peer, { sentBytes: link.sentBytes, receivedBytes: link.receivedBytes, rttMs: link.rttMs, reason, channels:{control:channelSettings(link.conn),snapshot:channelSettings(link.snapshotConn)} });
      link.assemblies.clear();link.receivedInputBatches.clear();link.queue.length=0;link.snapshots.length=0;link.inputs.length=0;
      link.reject?.(new Error(reason)); link.reject = null;
      try { link.conn.close(); } catch (_) {}
      try { link.snapshotConn?.close(); } catch (_) {}
      this._status(reason, { peerId: link.conn.peer, error: true });
      if (link.ready && link.approved) this.options.onPeerLeave?.(link.conn.peer, reason,{reconnecting:recoverable});
      else if(link.requested || link.pending)this.options.onRequestClosed?.(link.conn.peer,reason);
      if(this.role==='guest'&&recoverable&&this.resumeToken)this._scheduleReconnect();
      else if(this.role==='guest'&&link.resuming&&this.reconnectUntil&&!this.closed){this.reconnectUntil=0;this.options.onReconnectFailed?.(reason);}
    }
    _scheduleReconnect() {
      if(this.closed||!this.started||!this.resumeToken)return;
      if(!this.reconnectUntil)this.reconnectUntil=now()+30000;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer=this._later(()=>{
        this.reconnectTimer=null;
        if(this.closed||!this.started)return;
        if(now()>=this.reconnectUntil){this.reconnectUntil=0;this.options.onReconnectFailed?.('30秒以内に再接続できませんでした');return;}
        if(this.links.has(this.roomId)){this._scheduleReconnect();return;}
        if(this.peer.disconnected||this.peer.destroyed){this._scheduleReconnect();return;}
        try{
          const conn=this.peer.connect(this.roomId,{reliable:true,serialization:'raw',label:CONTROL_LABEL,metadata:{matchId:this.matchId,resumeToken:this.resumeToken}});
          const link=this._attach(conn);link.resuming=true;
        }catch(_){this._scheduleReconnect();}
      },1000);
    }
    reconnect(reason='ホストから5秒間応答がありません') {
      const link=this.links.get(this.roomId);
      if(this.role!=='guest'||!this.started||!this.resumeToken||this.closed)return false;
      if(link)this._drop(link,reason,true);else this._scheduleReconnect();return true;
    }
    _tick() {
      if (this.closed) return;
      const t = now();
      for(const [id,s] of this.resumeSessions)if(s.until<=t)this.resumeSessions.delete(id);
      for (const link of [...this.links.values()]) {
        if (link.closing) continue;
        if(this.role==='guest'&&link.resuming&&!link.ready&&this.reconnectUntil&&t>=this.reconnectUntil){link.terminal=true;this._drop(link,'30秒以内に再接続できませんでした');continue;}
        if(link.resuming&&!link.ready&&t-link.opened>4000){this._drop(link,'対戦通信の応答がありません',true);continue;}
        if (!link.ready && t - link.opened > (link.pending?180000:this.relayAvailable?20000:15000)) { this._reject(link, link.pending?'入室許可の待ち時間が3分を超えました':this.relayAvailable?'接続が時間切れです。中継サーバーを通してもつながりませんでした':'直接接続が時間切れです。STUN のみでは接続できない回線があります'); continue; }
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
      try { conn.send(item.binary||item.text); } catch (e) { this._drop(link, '送信に失敗しました: ' + e.message); return false; }
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
    // 個人を識別するキーや接続情報を含まない、診断ログ専用の集計。
    diagnostics() {
      const links=[...this.links.values()],rtts=links.filter(l=>Number.isFinite(l.rttMs)).map(l=>l.rttMs);
      return {sentBytes:this.totals.sentBytes,receivedBytes:this.totals.receivedBytes,sentMessages:this.totals.sentMessages,receivedMessages:this.totals.receivedMessages,
        connectedPeers:links.filter(l=>l.ready&&l.approved&&!l.closing).length,pendingPeers:links.filter(l=>l.pending&&!l.closing).length,
        maxBufferedBytes:this.totals.maxBufferedBytes,maxQueue:this.totals.maxQueue,
        bufferedBytes:links.reduce((n,l)=>n+(l.conn.dataChannel?.bufferedAmount||0)+(l.snapshotConn?.dataChannel?.bufferedAmount||0),0),queue:links.reduce((n,l)=>n+l.queue.length+l.snapshots.length+l.inputs.length,0),
        rtt:{count:rtts.length,minMs:rtts.length?Math.min(...rtts):null,meanMs:rtts.length?rtts.reduce((a,b)=>a+b,0)/rtts.length:null,maxMs:rtts.length?Math.max(...rtts):null},
        control:this.byChannel.control,snapshot:this.byChannel.snapshot,latencyMs:this.latencyMs,snapshotDropRate:this.snapshotDropRate,inputDropRate:this.inputDropRate,
        snapshotDrops:this.snapshotDrops,inputDrops:this.inputDrops};
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
      return this._approveLink(link);
    }
    _approveLink(link) {
      // randomUUIDが無い非HTTPS表示でも、暗号学的乱数で接続を結び付ける。
      const token=()=>[...root.crypto.getRandomValues(new Uint8Array(24))].map(n=>n.toString(16).padStart(2,'0')).join('');
      try { link.snapshotToken=token();link.resumeToken=link.resuming?this.resumeSessions.get(link.conn.peer)?.token:this.options.reconnect===true?token():''; }
      catch (_) {this._status('接続確認用の乱数を作れませんでした',{error:true});return false;}
      link.pending=false;link.approved=true;link.opened=link.lastReceive=now();
      this._enqueue(link,'welcome',{peerId:link.conn.peer,snapshotToken:link.snapshotToken,resumeToken:link.resumeToken},true);
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
    disconnectPeer(peerId, reason = '対戦から退出しました', {reconnect=false} = {}) {
      const link = this.links.get(peerId);
      if (!link || link.closing) return false;
      // 所有権を失った相手には状態も入力も送受信せず、終了理由だけを通知する。
      link.terminal=!reconnect;if(!reconnect)this.resumeSessions.delete(peerId);
      link.closing = true; link.queue.length = 0; link.snapshots.length = 0; link.inputs.length = 0;
      if (link.conn.open) { try { link.conn.send(JSON.stringify(this._envelope('bye', { reason,reconnect }))); } catch (_) {} }
      // 通知は最善努力。相手の応答がなくてもこの接続だけを必ず閉じる。
      this._later(() => this._drop(link, reason,reconnect), 500);
      return true;
    }
    close(reason = '部屋を閉じました') {
      if (this.closed) return;
      // 終了通知は最善努力。閉じた後の通信成功を保証しない。
      for (const link of this.links.values()) if (link.ready && link.conn.open) { try { link.conn.send(JSON.stringify(this._envelope('bye', { reason }))); } catch (_) {} }
      const wasReconnecting=this.role==='guest'&&this.reconnectUntil>0;
      this.closed = true;this._cancelIce?.(new Error(reason));this._cancelOpen?.(new Error(reason));this.resumeToken='';this.resumeSessions.clear();this.reconnectUntil=0;clearTimeout(this.reconnectTimer);clearInterval(this._tickTimer);
      for (const t of this._timers) clearTimeout(t); this._timers.clear();
      for (const link of [...this.links.values()]) this._drop(link, reason);
      try { this.peer?.destroy(); } catch (_) {}
      if(wasReconnecting)this.options.onReconnectFailed?.(reason);
    }
  }
  CBOnlineTransport.PROTOCOL = PROTOCOL;
  // 試験が送信内容を読むための道具（バイナリ写真も元のJSON文字列で返す）。
  CBOnlineTransport.wireText = raw => isBinaryWire(raw) ? textFromBinary(raw) : raw;
  CBOnlineTransport.SNAPSHOT_LABEL = SNAPSHOT_LABEL;
  CBOnlineTransport.CONTROL_LABEL = CONTROL_LABEL;
  CBOnlineTransport.PEERJS_VERSION = '1.5.5';
  CBOnlineTransport.ICE_URL = ICE_URL;
  CBOnlineTransport.cleanIceServers = cleanIceServers;
  CBOnlineTransport.cleanRoomId = cleanRoomId;
  root.CBOnlineTransport = CBOnlineTransport;
  if (typeof module !== 'undefined' && module.exports) module.exports = CBOnlineTransport;
})(typeof window !== 'undefined' ? window : globalThis);
