// コアブレイカーのオンライン試作：直接つながらない人のための中継（TURN）の合言葉を配る Cloudflare Worker。
// オーナーの指定 2026-11-09：中継は定額の VPS に自分で立てた coturn（超過の請求が出ない）。
// Cloudflare の TURN はカードの登録が要るので見送った。Metered と Cloudflare の TURN も設定だけで切り替えられる。
//
// 置く値（Cloudflare の画面の「設定 → 変数とシークレット」か `wrangler secret put`）。どれか1組：
//   coturn:     TURN_HOST（VPS の IP かドメイン。ポートが 3478 以外なら host:port）、TURN_SECRET（シークレット。coturn の static-auth-secret）
//   Metered:    METERED_APP（アプリ名。<名前>.metered.live の <名前>）、METERED_API_KEY（シークレット）
//   Cloudflare: TURN_KEY_ID（Realtime → TURN のキーの ID）、TURN_KEY_API_TOKEN（シークレット）
//   共通:       ALLOWED_ORIGINS … 使ってよいページの出どころ。カンマ区切り（wrangler.toml に既定値）
// 鍵とトークンはシークレットにする。ページへは出さない。
//
// ゲームは POST /ice を呼び、{ iceServers: [...] } を受け取って WebRTC に渡す。
// 合言葉は TTL 秒で切れる。相手の IP や名前は受け取らず、記録もしない。
const TTL = 4 * 60 * 60;

// どれも ICE サーバーの配列か、失敗の理由（文字列）を返す。
// coturn の「TURN REST API」方式：ユーザー名＝期限の秒、合言葉＝ユーザー名を共有の秘密で HMAC-SHA1 して base64。
// 秘密そのものは渡さない。合言葉は期限を過ぎると coturn が断る。
async function fromCoturn(env, nowSec = Math.floor(Date.now() / 1000)) {
  const host = String(env.TURN_HOST).trim();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return 'not_configured';
  const hostPort = host.includes(':') ? host : host + ':3478';
  const username = `${nowSec + TTL}:cb`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TURN_SECRET), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username)));
  const credential = btoa(String.fromCharCode(...mac));
  return [{ urls: [`stun:${hostPort}`] }, { urls: [`turn:${hostPort}?transport=udp`, `turn:${hostPort}?transport=tcp`], username, credential }];
}
async function fromMetered(env) {
  if (!/^[a-z0-9-]+$/i.test(env.METERED_APP)) return 'not_configured';
  const res = await fetch(`https://${env.METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.METERED_API_KEY)}`);
  if (!res.ok) return 'upstream';
  const data = await res.json();
  return Array.isArray(data) ? data : Array.isArray(data?.iceServers) ? data.iceServers : 'upstream';
}
async function fromCloudflare(env) {
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL })
  });
  if (!res.ok) return 'upstream';
  const data = await res.json();
  // 古い API（/generate）は iceServers を1つのオブジェクトで返すので、配列にそろえる。
  return Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : 'upstream';
}

export { fromCoturn, TTL };
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const ok = origin !== null && (allowed.includes('*') || allowed.includes(origin));
    const cors = ok ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : { Vary: 'Origin' };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    if (url.pathname !== '/ice') return json({ error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors });
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    if (!ok) return json({ error: 'origin' }, 403);
    const list = env.TURN_HOST && env.TURN_SECRET ? await fromCoturn(env) : env.METERED_APP && env.METERED_API_KEY ? await fromMetered(env) : env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN ? await fromCloudflare(env) : 'not_configured';
    if (typeof list === 'string') return json({ error: list }, list === 'not_configured' ? 503 : 502);
    // ブラウザが待たされる53番ポートは外す（Cloudflare の案内）。
    const iceServers = list.map(s => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(u => typeof u === 'string' && !/:53(\?|$)/.test(u)) })).filter(s => s.urls.length);
    return json({ iceServers, ttl: TTL });
  }
};
