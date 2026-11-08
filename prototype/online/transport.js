/* #212: PeerJS 1.5.5 用のブラウザホスト通信。ゲームの状態はここで計算しない。 */
(function (root) {
  'use strict';
  const PROTOCOL = 4, MAX_BYTES = 262144, MAX_QUEUE = 256, HIGH_WATER = 262144;
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
      this.peer = null; this.role = ''; this.roomId = ''; this.matchId = '';
      this.links = new Map(); this.closed = false; this.started = false;
      this.createdAt = now(); this.samples = []; this.sequence = 0;
      this.totals = { sentBytes: 0, receivedBytes: 0, sentMessages: 0, receivedMessages: 0, byType: {}, maxBufferedBytes: 0, maxQueue: 0 };
      this.messageSizes = Object.create(null);
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
        if (this.role !== 'host') { conn.on('open', () => conn.close()); return; }
        const reject = this.started ? '試合開始後の途中参加はできません' : [...this.links.values()].filter(l=>l.approved&&!l.closing).length >= this.capacity - 1 ? `部屋は満員です（ホストを含め${this.capacity}人まで）` : [...this.links.values()].filter(l=>!l.approved).length >= 8 ? '入室の承認待ちが上限です。少し待ってから入り直してください' : this.links.has(conn.peer) ? '同じ相手は既に接続しています' : '';
        if (reject) { conn.on('open', () => { conn.send(JSON.stringify({ type: 'reject', reason: reject })); this._later(() => conn.close(), 100); }); return; }
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
          const conn = this.peer.connect(this.roomId, { reliable: true, serialization: 'raw', label: 'core-breaker-online-v4' });
          this._attach(conn, resolve, reject);
        });
      } catch (e) { this.close(e.message); throw e; }
    }
    _attach(conn, resolve, reject) {
      const link = { conn, ready: false, approved: false, pending: false, displayName: '', queue: [], snapshots: [], lastReceive: now(), opened: now(), stalledAt: 0, resolve, reject, sentBytes: 0, receivedBytes: 0, rttMs: null, pingAt: 0, pendingPing: null, clockSamples: [], clockOffsetMs: null };
      this.links.set(conn.peer, link);
      conn.on('open', () => {
        link.opened = now();
        if (this.role === 'guest') this._enqueue(link, 'hello', { appVersion: this.appVersion, displayName: this.displayName }, true);
      });
      conn.on('data', data => this._receive(link, data));
      conn.on('close', () => this._drop(link, '対戦接続が切れました'));
      conn.on('error', e => this._drop(link, '対戦接続エラー: ' + (e.message || e.type)));
    }
    _envelope(type, payload) {
      return { protocolVersion: PROTOCOL, appVersion: this.appVersion, roomId: this.roomId, matchId: this.matchId, sender: this.peer?.id, type, payload };
    }
    _enqueue(link, type, payload, internal = false) {
      if (this.closed || link.closing || (!internal && (!link.ready || !link.approved))) return false;
      if (!link.approved && !['hello','pending','welcome','reject','bye'].includes(type)) return false;
      let text;
      try { text = JSON.stringify(this._envelope(type, payload)); } catch (_) { this._status('送信データを JSON に変換できません', { error: true }); return false; }
      const bytes = encoder.encode(text).byteLength;
      if (bytes > MAX_BYTES) { this._status('送信データが上限を超えました', { error: true, bytes }); return false; }
      const item = { text, bytes, type, due: now() + this.latencyMs };
      if (type === 'snapshot') {
        // 遅延中の履歴は保持する。毎回 due を延ばすと100ms注入時に永久に送れなくなる。
        link.snapshots.push(item);
        if (link.snapshots.length > 16) link.snapshots.shift();
      }
      else {
        if (link.queue.length >= MAX_QUEUE) { this._drop(link, '送信待ちが上限を超えました'); return false; }
        link.queue.push(item);
      }
      this.totals.maxQueue = Math.max(this.totals.maxQueue, link.queue.length + link.snapshots.length);
      return true;
    }
    send(type, payload, peerId) {
      if (typeof type !== 'string' || !type || ['hello', 'pending', 'welcome', 'reject', 'match', 'ping', 'pong', 'bye'].includes(type)) return false;
      const target = peerId || (this.role === 'guest' ? this.roomId : '');
      const link = this.links.get(target);
      return !!link && this._enqueue(link, type, payload);
    }
    broadcast(type, payload) { let count = 0; for (const id of this.links.keys()) if (this.send(type, payload, id)) count++; return count; }
    startMatch(matchId) {
      if (this.role !== 'host' || this.started) throw new Error('試合を開始できません');
      this.matchId = matchId || ('match-' + Math.random().toString(36).slice(2));
      if (typeof this.matchId !== 'string' || this.matchId.length > 128) throw new Error('試合 ID が正しくありません');
      this.started = true;
      for (const link of [...this.links.values()]) {
        if (link.ready && link.approved) this._enqueue(link, 'match', { matchId: this.matchId }, true);
        else this._reject(link, 'ホストが試合を開始したため、承認待ちの入室を取り消しました');
      }
      return this.matchId;
    }
    _receive(link, raw) {
      if (this.closed || link.closing || !this.links.has(link.conn.peer)) return;
      if (typeof raw !== 'string' || raw.length > MAX_BYTES) { this._drop(link, '不正な通信形式です'); return; }
      const bytes = encoder.encode(raw).byteLength;
      if (bytes > MAX_BYTES) { this._drop(link, '受信データが大きすぎます'); return; }
      let msg; try { msg = JSON.parse(raw); } catch (_) { this._drop(link, 'JSON が壊れています'); return; }
      if (!msg || typeof msg !== 'object') { this._drop(link, '不正な通信データです'); return; }
      if (msg.type === 'reject' && !link.ready) { this._drop(link, typeof msg.reason === 'string' ? msg.reason.slice(0,200) : '参加を拒否されました'); return; }
      if (msg.protocolVersion !== PROTOCOL) { this._reject(link, 'オンライン通信規格が違います（自分: ' + PROTOCOL + ' / 相手: ' + String(msg.protocolVersion).slice(0,20) + '）。同じ試作版で入り直してください'); return; }
      if (msg.roomId !== this.roomId || msg.sender !== link.conn.peer || typeof msg.type !== 'string') { this._drop(link, '通信規格または部屋情報が一致しません'); return; }
      if (msg.appVersion !== this.appVersion) { this._reject(link, 'ゲームの版が違います（自分: ' + this.appVersion + ' / 相手: ' + String(msg.appVersion).slice(0,40) + '）。同じ版で入り直してください'); return; }
      this.totals.receivedBytes += bytes; this.totals.receivedMessages++; link.receivedBytes += bytes; link.lastReceive = now();
      if (msg.type === 'hello' && this.role === 'host' && !link.ready && !link.pending) {
        if (this.started) { this._reject(link, '試合開始後の途中参加はできません'); return; }
        if (msg.matchId !== '') { this._reject(link, '試合情報が一致しません'); return; }
        if(typeof msg.payload?.displayName !== 'string' || msg.payload.displayName.length>256) {this._reject(link,'表示名が長すぎるか、形式が正しくありません');return;}
        link.pending=true;link.opened=now();link.displayName=cleanName(msg.payload.displayName);
        this._enqueue(link,'pending',{name:link.displayName,timeoutSeconds:180},true);
        this.options.onPeerRequest?.(link.conn.peer,link.displayName); return;
      }
      if(msg.type==='pending' && this.role==='guest' && !link.ready && msg.matchId==='') {
        link.pending=true;link.opened=now();this._status('ホストの入室許可を待っています（3分まで）',{approvalPending:true});return;
      }
      if (msg.type === 'welcome' && this.role === 'guest' && !link.ready && msg.matchId === '') {
        link.ready = link.approved = true;link.pending=false; link.resolve?.(this.roomId); link.resolve = null; link.reject = null;
        this.options.onPeerJoin?.(link.conn.peer); this._status('部屋に接続しました'); return;
      }
      if (!link.ready || !link.approved) { this._drop(link, '接続確認が終わっていません'); return; }
      if (msg.type === 'match' && this.role === 'guest' && !this.started && typeof msg.payload?.matchId === 'string' && msg.payload.matchId === msg.matchId) {
        this.matchId = msg.matchId; this.started = true; this.options.onMatch?.(this.matchId); return;
      }
      if (msg.matchId !== this.matchId && !['ping','pong'].includes(msg.type)) { return; } // 開始前に送られた入力が残っていても新しい試合へ適用しない。
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
      if (['hello','pending','welcome','reject','match'].includes(msg.type)) { this._drop(link, '通信順序が正しくありません'); return; }
      this.options.onMessage?.(msg.type, msg.payload, link.conn.peer);
    }
    _reject(link, reason) {
      if(link.closing)return;link.closing=true;link.queue.length=0;link.snapshots.length=0;
      this._status(reason, { error: true });
      try { link.conn.send(JSON.stringify({ type: 'reject', reason })); } catch (_) {}
      this._later(() => this._drop(link, reason), 100);
    }
    _drop(link, reason) {
      if (this.links.get(link.conn.peer) !== link) return;
      this.links.delete(link.conn.peer);
      this.history.set(link.conn.peer, { sentBytes: link.sentBytes, receivedBytes: link.receivedBytes, rttMs: link.rttMs, reason });
      link.reject?.(new Error(reason)); link.reject = null;
      try { link.conn.close(); } catch (_) {}
      this._status(reason, { peerId: link.conn.peer, error: true });
      if (link.ready && link.approved) this.options.onPeerLeave?.(link.conn.peer, reason);
      else if(link.pending)this.options.onRequestClosed?.(link.conn.peer,reason);
    }
    _tick() {
      if (this.closed) return;
      const t = now();
      for (const link of [...this.links.values()]) {
        if (link.closing) continue;
        if (!link.ready && t - link.opened > (link.pending?180000:15000)) { this._reject(link, link.pending?'入室許可の待ち時間が3分を超えました':'直接接続が時間切れです。STUN のみでは接続できない回線があります'); continue; }
        if (link.ready && t - link.lastReceive > 10000) { this._drop(link, '対戦通信の応答がありません'); continue; }
        if (!link.conn.open) continue;
        const buffered = link.conn.dataChannel?.bufferedAmount || 0;
        this.totals.maxBufferedBytes = Math.max(this.totals.maxBufferedBytes, buffered);
        if (buffered > HIGH_WATER || (link.conn.bufferSize || 0) > 32) {
          if (!link.stalledAt) { link.stalledAt = t; this._status('通信が詰まっています', { peerId: link.conn.peer }); }
          if (t - link.stalledAt > 5000) this._drop(link, '通信の詰まりが回復しません');
          continue;
        }
        link.stalledAt = 0;
        if (link.ready && t - link.pingAt > 1000 && !link.pendingPing) {
          link.pingAt = t; const token = ++this.sequence; link.pendingPing = { token, at: t }; this._enqueue(link, 'ping', { token }, true);
        }
        // 上限を見ながら投入する。遅延注入は送信側で一度だけ行い、順序を保持する。
        let budget = HIGH_WATER - buffered;
        while (link.queue.length && link.queue[0].due <= t) {
          const item = link.queue[0]; if (item.bytes > budget) break;
          link.queue.shift(); if (!this._write(link, item)) break; budget -= item.bytes;
        }
        if (!link.queue.length || link.queue[0].due > t) {
          let ready = -1;
          for (let i = 0; i < link.snapshots.length && link.snapshots[i].due <= t; i++) ready = i;
          if (ready >= 0 && link.snapshots[ready].bytes <= budget) {
            const item = link.snapshots[ready]; link.snapshots.splice(0, ready + 1); this._write(link, item);
          }
        }
      }
      if (!this.samples.length || t - this.samples[this.samples.length - 1].at >= 1000) {
        this.samples.push({ at: t, sentBytes: this.totals.sentBytes }); if (this.samples.length > 600) this.samples.shift();
      }
    }
    _write(link, item) {
      // 実際に送信バッファへ渡す時刻を使う（送信待ち・遅延注入を時計差と誤認しない）。
      if (item.type === 'ping' || item.type === 'pong') {
        const envelope = JSON.parse(item.text); envelope.payload.sentAt = now();
        if(item.type === 'ping' && link.pendingPing?.token === envelope.payload.token)link.pendingPing.at=envelope.payload.sentAt;
        item.text=JSON.stringify(envelope);item.bytes=encoder.encode(item.text).byteLength;
      }
      try { link.conn.send(item.text); } catch (e) { this._drop(link, '送信に失敗しました: ' + e.message); return false; }
      this.totals.sentBytes += item.bytes; this.totals.sentMessages++; link.sentBytes += item.bytes;
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
      return { ...this.totals, byType: { ...this.totals.byType }, messageSizes: Object.fromEntries(Object.entries(this.messageSizes).map(([type, size]) => [type, { ...size }])), elapsedSeconds: seconds, sentKBps: this.totals.sentBytes / seconds / 1000, p95KBps: rates[Math.floor((rates.length - 1) * .95)] || 0, maxKBps: rates[rates.length - 1] || 0,
        connectedPeers: [...this.links.values()].filter(l=>l.ready&&l.approved&&!l.closing).length, pendingPeers:[...this.links.values()].filter(l=>l.pending&&!l.closing).length,
        peers: [...this.links].map(([id,l])=>({ id, sentBytes:l.sentBytes, receivedBytes:l.receivedBytes, rttMs:l.rttMs, bufferedBytes:l.conn.dataChannel?.bufferedAmount||0, queue:l.queue.length + l.snapshots.length })), closedPeers: [...this.history].map(([id,s])=>({id,...s})), latencyMs: this.latencyMs };
    }
    setCapacity(next) {
      // 承認待ちは定員に含めない。既に許可した参加者を設定変更で追い出さない。
      if(this.role!=='host'||this.started||this.closed||!Number.isInteger(next)||next<2||next>4)return false;
      if([...this.links.values()].filter(l=>l.approved&&!l.closing).length+1>next)return false;
      this.capacity=next;return true;
    }
    approvePeer(peerId) {
      const link=this.links.get(peerId);
      if(this.role!=='host'||this.started||this.closed||!link?.pending||link.closing)return false;
      if([...this.links.values()].filter(l=>l.approved&&!l.closing).length>=this.capacity-1) {this._reject(link,`部屋は満員です（ホストを含め${this.capacity}人まで）`);return false;}
      link.pending=false;link.approved=link.ready=true;link.lastReceive=now();
      this._enqueue(link,'welcome',{peerId:link.conn.peer},true);
      this.options.onPeerJoin?.(link.conn.peer,link.displayName);return true;
    }
    rejectPeer(peerId, reason='ホストが入室を拒否しました') {
      const link=this.links.get(peerId);
      if(this.role!=='host'||this.started||this.closed||!link?.pending||link.closing)return false;
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
      link.closing = true; link.queue.length = 0; link.snapshots.length = 0;
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
  CBOnlineTransport.PEERJS_VERSION = '1.5.5';
  root.CBOnlineTransport = CBOnlineTransport;
  if (typeof module !== 'undefined' && module.exports) module.exports = CBOnlineTransport;
})(typeof window !== 'undefined' ? window : globalThis);
