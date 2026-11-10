// 中継（TURN）と接続失敗の表示の試験（2026-11-09）。偽の Peer と偽の fetch で、ブラウザなしに回す。
// 1. 開く前の PeerJS 接続へ送ると NotOpenYet のエラーが出る（PeerJS 1.5.5 の send）。時間切れの本当の理由を上書きしない。
// 2. Worker から合言葉を受け取れたら TURN を WebRTC へ渡し、取れなければ STUN だけで続ける。
const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const Transport = require('../../prototype/online/transport.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
let serial = 0;
const peers = new Map();
// PeerJS 1.5.5 と同じく、開く前の send は例外でなく error イベントを出す。
class PeerJsLikeConnection extends EventEmitter {
  constructor(peer, options) { super(); this.peer = peer; this.open = false; this.label = options.label; this.connectionId = 'c' + ++serial; this.dataChannel = { bufferedAmount: 0, readyState: 'connecting' }; }
  send() { if (!this.open) { const e = new Error('Connection is not open. You should listen for the `open` event before sending messages.'); e.type = 'not-open-yet'; this.emit('error', e); return; } }
  close() { if (this.closed) return; this.closed = true; this.emit('close'); }
}
// 相手には届くが、WebRTC の通り道ができない（STUN だけでは抜けられない回線）。
class NeverOpenPeer extends EventEmitter {
  constructor(_, options) { super(); this.id = 'peer-' + ++serial; this.options = options; peers.set(this.id, this); queueMicrotask(() => this.emit('open', this.id)); }
  connect(id, options) { const a = new PeerJsLikeConnection(id, options), b = new PeerJsLikeConnection(this.id, options); queueMicrotask(() => peers.get(id)?.emit('connection', b)); return a; }
  destroy() { peers.delete(this.id); this.emit('close'); }
}
const ok = [];
const check = async (name, fn) => { await fn(); ok.push(name); };
const ICE = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }] };
const fakeFetch = (body, status = 200) => { const calls = []; const f = async (url, opts) => { calls.push({ url, opts }); if (body instanceof Error) throw body; return { ok: status < 300, status, json: async () => body }; }; f.calls = calls; return f; };
(async () => {
  const all = [];
  const make = o => { const t = new Transport({ appVersion: 'Ver179', Peer: NeverOpenPeer, ...o }); all.push(t); return t; };
  try {
    await check('開かない接続の時間切れは本当の理由を出す（ゲスト）', async () => {
      const host = make(), room = await host.createRoom(), guest = make();
      const join = guest.connect(room).then(() => null, e => e);
      await wait(10);
      guest.links.get(room).opened = performance.now() - 15001; guest._tick();
      const e = await join;
      assert.match(e.message, /直接接続が時間切れ/); assert.doesNotMatch(e.message, /not open/);
      assert.equal(guest.links.size, 0);
    });
    await check('ホスト側も開かない接続を正しい理由で閉じる', async () => {
      const status = [], host = make({ onStatus: m => status.push(m) }), room = await host.createRoom(), guest = make();
      guest.connect(room).catch(() => {});
      await wait(10);
      const [link] = host.links.values(); link.opened = performance.now() - 15001; host._tick();
      assert.equal(host.links.size, 0); assert(status.some(m => /直接接続が時間切れ/.test(m))); assert(!status.some(m => /not open/.test(m)));
    });
    await check('Worker の合言葉で TURN を渡し、53番ポートを外す', async () => {
      const f = fakeFetch(ICE), host = make({ iceServersUrl: 'https://w.example/ice', fetch: f });
      await host.createRoom();
      assert.equal(f.calls.length, 1); assert.equal(f.calls[0].opts.method, 'POST');
      const list = host.peer.options.config.iceServers;
      assert(list.some(s => s.urls.some(u => u.startsWith('turns:')) && s.username === 'u' && s.credential === 'c'));
      assert(!list.some(s => s.urls.some(u => /:53(\?|$)/.test(u))));
      assert.equal(host.relayStatus, 'ready'); assert.equal(host.relayAvailable, true);
    });
    await check('中継ありの時間切れは20秒で、中継でもダメと出す', async () => {
      const host = make({ iceServersUrl: 'https://w.example/ice', fetch: fakeFetch(ICE) }), room = await host.createRoom();
      const guest = make({ iceServersUrl: 'https://w.example/ice', fetch: fakeFetch(ICE) });
      const join = guest.connect(room).then(() => null, e => e);
      await wait(10);
      guest.links.get(room).opened = performance.now() - 15001; guest._tick(); assert.equal(guest.links.size, 1);
      guest.links.get(room).opened = performance.now() - 20001; guest._tick();
      assert.match((await join).message, /中継サーバーを通してもつながりませんでした/);
    });
    for (const [name, f] of [['通信エラー', fakeFetch(new Error('offline'))], ['HTTP 503', fakeFetch({ error: 'not_configured' }, 503)], ['TURN なしの答え', fakeFetch({ iceServers: [{ urls: 'stun:x:3478' }] })], ['合言葉なしの TURN', fakeFetch({ iceServers: [{ urls: 'turn:x:3478' }] })]]) {
      await check('Worker が使えないとき（' + name + '）は STUN だけで続ける', async () => {
        const status = [], host = make({ iceServersUrl: 'https://w.example/ice', fetch: f, onStatus: m => status.push(m) });
        await host.createRoom();
        assert.deepEqual(host.peer.options.config.iceServers.map(s => [].concat(s.urls)[0]), ['stun:stun.l.google.com:19302']);
        assert.equal(host.relayStatus, 'unavailable'); assert(status.some(m => /中継サーバーの情報を受け取れませんでした/.test(m)));
      });
    }
    await check('URL が空なら Worker を呼ばず今までどおり STUN だけ', async () => {
      const f = fakeFetch(ICE), host = make({ fetch: f }); await host.createRoom();
      assert.equal(f.calls.length, 0); assert.equal(host.relayStatus, 'off'); assert.equal(host.relayAvailable, false);
    });
    await check('手で渡す設定：TURN は合言葉つきなら通し、変な URL は断る', async () => {
      const good = make({ peerOptions: { config: { iceServers: [{ urls: 'turn:t.example:3478', username: 'a', credential: 'b' }] } } });
      await good.createRoom(); assert.equal(good.relayAvailable, true);
      await assert.rejects(make({ peerOptions: { config: { iceServers: [{ urls: 'turn:bad.invalid' }] } } }).createRoom(), /STUN\/TURN/);
      await assert.rejects(make({ peerOptions: { config: { iceServers: [{ urls: 'http://x' }] } } }).createRoom(), /STUN\/TURN/);
      const none = make({ peerOptions: { config: { iceServers: [] } } }); await none.createRoom(); assert.deepEqual(none.peer.options.config.iceServers, []);
    });
    await check('Worker：許可した出どころだけに答え、53番ポートを外す（coturn・Cloudflare・Metered）', async () => {
      const { default: worker } = await import('../turn-worker/worker.mjs');
      const env = { TURN_KEY_ID: 'k', TURN_KEY_API_TOKEN: 't', ALLOWED_ORIGINS: 'https://chevi0t.github.io,null' };
      const upstream = [], realFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => { upstream.push({ url, opts }); return new Response(JSON.stringify(ICE), { status: 201 }); };
      try {
        const ask = (origin, method = 'POST', path = '/ice') => worker.fetch(new Request('https://w.example' + path, { method, headers: origin ? { Origin: origin } : {}, body: method === 'POST' ? '{}' : undefined }), env);
        let r = await ask('https://chevi0t.github.io'); assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://chevi0t.github.io');
        const body = await r.json(); assert(!JSON.stringify(body).includes(':53'));
        assert(Transport.cleanIceServers(body.iceServers).some(s => s.username === 'u'));
        assert.equal(upstream[0].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/k/credentials/generate-ice-servers'); assert.equal(upstream[0].opts.headers.Authorization, 'Bearer t');
        assert.equal((await ask('null')).status, 200);
        assert.equal((await ask('https://other.example')).status, 403); assert.equal((await ask(null)).status, 403);
        assert.equal((await ask('null', 'OPTIONS')).status, 204); assert.equal((await ask('null', 'GET')).status, 405); assert.equal((await ask('null', 'POST', '/x')).status, 404);
        assert.equal(upstream.length, 2);
        assert.equal((await worker.fetch(new Request('https://w.example/ice', { method: 'POST', headers: { Origin: 'null' }, body: '{}' }), { ALLOWED_ORIGINS: 'null' })).status, 503);
        // coturn（定額 VPS。オーナーの指定）：秘密は渡さず、期限つきのユーザー名と HMAC-SHA1 の合言葉だけ。
        upstream.length = 0;
        const cot = { TURN_HOST: '203.0.113.5', TURN_SECRET: 's3cret', ALLOWED_ORIGINS: 'null' };
        r = await worker.fetch(new Request('https://w.example/ice', { method: 'POST', headers: { Origin: 'null' }, body: '{}' }), cot);
        assert.equal(r.status, 200); assert.equal(upstream.length, 0);
        const cotText = await r.text(), cotList = Transport.cleanIceServers(JSON.parse(cotText).iceServers), relay = cotList.find(s => s.username);
        assert(!cotText.includes('s3cret'));
        assert.deepEqual(relay.urls, ['turn:203.0.113.5:3478?transport=udp', 'turn:203.0.113.5:3478?transport=tcp']);
        const [expiry, tag] = relay.username.split(':'); assert.equal(tag, 'cb');
        assert(Math.abs(Number(expiry) - (Date.now() / 1000 + 4 * 3600)) < 5);
        assert.equal(relay.credential, require('node:crypto').createHmac('sha1', 's3cret').update(relay.username).digest('base64'));
        assert.equal((await worker.fetch(new Request('https://w.example/ice', { method: 'POST', headers: { Origin: 'null' }, body: '{}' }), { ...cot, TURN_HOST: 'x/y' })).status, 503);
        const ported = await (await worker.fetch(new Request('https://w.example/ice', { method: 'POST', headers: { Origin: 'null' }, body: '{}' }), { ...cot, TURN_HOST: 'turn.example.jp:5000' })).json();
        assert(ported.iceServers.some(s => s.urls.includes('turn:turn.example.jp:5000?transport=udp')));
        // Metered（カードなしの無料枠）：鍵は Worker からだけ送り、答えの配列をそのまま渡す。
        upstream.length = 0;
        globalThis.fetch = async (url, opts) => { upstream.push({ url, opts }); return new Response(JSON.stringify(ICE.iceServers), { status: 200 }); };
        const metered = { METERED_APP: 'core-breaker', METERED_API_KEY: 'k&y', ALLOWED_ORIGINS: 'null' };
        r = await worker.fetch(new Request('https://w.example/ice', { method: 'POST', headers: { Origin: 'null' }, body: '{}' }), metered);
        assert.equal(r.status, 200); assert.equal(upstream[0].url, 'https://core-breaker.metered.live/api/v1/turn/credentials?apiKey=k%26y');
        assert(Transport.cleanIceServers((await r.json()).iceServers).some(s => s.username === 'u'));
        assert.equal((await worker.fetch(new Request('https://w.example/ice', { method: 'POST', headers: { Origin: 'null' }, body: '{}' }), { ...metered, METERED_APP: 'a.evil/x' })).status, 503);
        globalThis.fetch = async () => new Response('no', { status: 401 });
        assert.equal((await worker.fetch(new Request('https://w.example/ice', { method: 'POST', headers: { Origin: 'null' }, body: '{}' }), metered)).status, 502);
      } finally { globalThis.fetch = realFetch; }
    });
    console.log('オンライン中継（TURN）：' + ok.length + '項目 成功');
  } finally { for (const t of all) t.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
