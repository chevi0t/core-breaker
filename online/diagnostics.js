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
    '部屋が見つかりません。部屋IDとホストが待機中か確認してください':'peer_unavailable',
    'ゲームの版が一致しません':'version_mismatch','通信の版が一致しません':'protocol_mismatch',
    '接続サービスが終了しました':'signaling_closed','対戦通信の応答がありません':'response_timeout','ホストから5秒間応答がありません':'host_timeout',
    '入力が3秒途絶えたため、対戦から退出しました。機体はBotが引き継ぎます':'input_timeout',
    '準備中にゲストが退出したため、開始を中止しました':'prepare_peer_left',
    '直接接続が時間切れです。STUN のみでは接続できない回線があります':'connection_timeout','接続が時間切れです。中継サーバーを通してもつながりませんでした':'connection_timeout','接続サービスへの登録が時間切れになりました':'connection_timeout',
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
  // BEGIN fflate 0.8.3 synchronous DEFLATE / dcb3714a6c25db3a2748641019c5277413d09714
  /*
MIT License

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

  */
  const diagnosticDeflate=(()=>{
const u8 = Uint8Array, u16 = Uint16Array, i32 = Int32Array;
const fleb = new u8([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    4,
    4,
    5,
    5,
    5,
    5,
    0,
    0,
    0,
    0
]);
const fdeb = new u8([
    0,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    8,
    9,
    9,
    10,
    10,
    11,
    11,
    12,
    12,
    13,
    13,
    0,
    0
]);
const clim = new u8([
    16,
    17,
    18,
    0,
    8,
    7,
    9,
    6,
    10,
    5,
    11,
    4,
    12,
    3,
    13,
    2,
    14,
    1,
    15
]);
const freb = (eb, start)=>{
    const b = new u16(31);
    for(let i = 0; i < 31; ++i){
        b[i] = start += 1 << eb[i - 1];
    }
    const r = new i32(b[30]);
    for(let i = 1; i < 30; ++i){
        for(let j = b[i]; j < b[i + 1]; ++j){
            r[j] = j - b[i] << 5 | i;
        }
    }
    return {
        b,
        r
    };
};
const { b: fl, r: revfl } = freb(fleb, 2);
fl[28] = 258, revfl[258] = 28;
const { b: fd, r: revfd } = freb(fdeb, 0);
const rev = new u16(32768);
for(let i = 0; i < 32768; ++i){
    let x = (i & 0xAAAA) >> 1 | (i & 0x5555) << 1;
    x = (x & 0xCCCC) >> 2 | (x & 0x3333) << 2;
    x = (x & 0xF0F0) >> 4 | (x & 0x0F0F) << 4;
    rev[i] = ((x & 0xFF00) >> 8 | (x & 0x00FF) << 8) >> 1;
}
const hMap = (cd, mb, r)=>{
    const s = cd.length;
    let i = 0;
    const l = new u16(mb);
    for(; i < s; ++i){
        if (cd[i]) ++l[cd[i] - 1];
    }
    const le = new u16(mb);
    for(i = 1; i < mb; ++i){
        le[i] = le[i - 1] + l[i - 1] << 1;
    }
    let co;
    if (r) {
        co = new u16(1 << mb);
        const rvb = 15 - mb;
        for(i = 0; i < s; ++i){
            if (cd[i]) {
                const sv = i << 4 | cd[i];
                const r = mb - cd[i];
                let v = le[cd[i] - 1]++ << r;
                for(const m = v | (1 << r) - 1; v <= m; ++v){
                    co[rev[v] >> rvb] = sv;
                }
            }
        }
    } else {
        co = new u16(s);
        for(i = 0; i < s; ++i){
            if (cd[i]) {
                co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
            }
        }
    }
    return co;
};
const flt = new u8(288);
for(let i = 0; i < 144; ++i)flt[i] = 8;
for(let i = 144; i < 256; ++i)flt[i] = 9;
for(let i = 256; i < 280; ++i)flt[i] = 7;
for(let i = 280; i < 288; ++i)flt[i] = 8;
const fdt = new u8(32);
for(let i = 0; i < 32; ++i)fdt[i] = 5;
const flm = hMap(flt, 9, 0), flrm = hMap(flt, 9, 1);
const fdm = hMap(fdt, 5, 0), fdrm = hMap(fdt, 5, 1);
const max = (a)=>{
    let m = a[0];
    for(let i = 1; i < a.length; ++i){
        if (a[i] > m) m = a[i];
    }
    return m;
};
const bits = (d, p, m)=>{
    const o = p / 8 | 0;
    return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
const bits16 = (d, p)=>{
    const o = p / 8 | 0;
    return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
const shft = (p)=>(p + 7) / 8 | 0;
const slc = (v, s, e)=>{
    if (s == null || s < 0) s = 0;
    if (e == null || e > v.length) e = v.length;
    return new u8(v.subarray(s, e));
};
const FlateErrorCode = {
    UnexpectedEOF: 0,
    InvalidBlockType: 1,
    InvalidLengthLiteral: 2,
    InvalidDistance: 3,
    StreamFinished: 4,
    NoStreamHandler: 5,
    InvalidHeader: 6,
    NoCallback: 7,
    InvalidUTF8: 8,
    ExtraFieldTooLong: 9,
    InvalidDate: 10,
    FilenameTooLong: 11,
    StreamFinishing: 12,
    InvalidZipData: 13,
    UnknownCompressionMethod: 14
};
const ec = [
    'unexpected EOF',
    'invalid block type',
    'invalid length/literal',
    'invalid distance',
    'stream finished',
    'no stream handler',
    ,
    'no callback',
    'invalid UTF-8 data',
    'extra field too long',
    'date not in range 1980-2099',
    'filename too long',
    'stream finishing',
    'invalid zip data'
];
const err = (ind, msg, nt)=>{
    const e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace) Error.captureStackTrace(e, err);
    if (!nt) throw e;
    return e;
};
const wbits = (d, p, v)=>{
    v <<= p & 7;
    const o = p / 8 | 0;
    d[o] |= v;
    d[o + 1] |= v >> 8;
};
const wbits16 = (d, p, v)=>{
    v <<= p & 7;
    const o = p / 8 | 0;
    d[o] |= v;
    d[o + 1] |= v >> 8;
    d[o + 2] |= v >> 16;
};
const hTree = (d, mb)=>{
    const t = [];
    for(let i = 0; i < d.length; ++i){
        if (d[i]) t.push({
            s: i,
            f: d[i]
        });
    }
    const s = t.length;
    const t2 = t.slice();
    if (!s) return {
        t: et,
        l: 0
    };
    if (s == 1) {
        const v = new u8(t[0].s + 1);
        v[t[0].s] = 1;
        return {
            t: v,
            l: 1
        };
    }
    t.sort((a, b)=>a.f - b.f);
    t.push({
        s: -1,
        f: 25001
    });
    let l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
    t[0] = {
        s: -1,
        f: l.f + r.f,
        l,
        r
    };
    while(i1 != s - 1){
        l = t[t[i0].f < t[i2].f ? i0++ : i2++];
        r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
        t[i1++] = {
            s: -1,
            f: l.f + r.f,
            l,
            r
        };
    }
    let maxSym = t2[0].s;
    for(let i = 1; i < s; ++i){
        if (t2[i].s > maxSym) maxSym = t2[i].s;
    }
    const tr = new u16(maxSym + 1);
    let mbt = ln(t[i1 - 1], tr, 0);
    if (mbt > mb) {
        let i = 0, dt = 0;
        const lft = mbt - mb, cst = 1 << lft;
        t2.sort((a, b)=>tr[b.s] - tr[a.s] || a.f - b.f);
        for(; i < s; ++i){
            const i2 = t2[i].s;
            if (tr[i2] > mb) {
                dt += cst - (1 << mbt - tr[i2]);
                tr[i2] = mb;
            } else break;
        }
        dt >>= lft;
        while(dt > 0){
            const i2 = t2[i].s;
            if (tr[i2] < mb) dt -= 1 << mb - tr[i2]++ - 1;
            else ++i;
        }
        for(; i >= 0 && dt; --i){
            const i2 = t2[i].s;
            if (tr[i2] == mb) {
                --tr[i2];
                ++dt;
            }
        }
        mbt = mb;
    }
    return {
        t: new u8(tr),
        l: mbt
    };
};
const ln = (n, l, d)=>{
    return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
const lc = (c)=>{
    let s = c.length;
    while(s && !c[--s]);
    const cl = new u16(++s);
    let cli = 0, cln = c[0], cls = 1;
    const w = (v)=>{
        cl[cli++] = v;
    };
    for(let i = 1; i <= s; ++i){
        if (c[i] == cln && i != s) ++cls;
        else {
            if (!cln && cls > 2) {
                for(; cls > 138; cls -= 138)w(32754);
                if (cls > 2) {
                    w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
                    cls = 0;
                }
            } else if (cls > 3) {
                w(cln), --cls;
                for(; cls > 6; cls -= 6)w(8304);
                if (cls > 2) w(cls - 3 << 5 | 8208), cls = 0;
            }
            while(cls--)w(cln);
            cls = 1;
            cln = c[i];
        }
    }
    return {
        c: cl.subarray(0, cli),
        n: s
    };
};
const clen = (cf, cl)=>{
    let l = 0;
    for(let i = 0; i < cl.length; ++i)l += cf[i] * cl[i];
    return l;
};
const wfblk = (out, pos, dat)=>{
    const s = dat.length;
    const o = shft(pos + 2);
    out[o] = s & 255;
    out[o + 1] = s >> 8;
    out[o + 2] = out[o] ^ 255;
    out[o + 3] = out[o + 1] ^ 255;
    for(let i = 0; i < s; ++i)out[o + i + 4] = dat[i];
    return (o + 4 + s) * 8;
};
const wblk = (dat, out, final, syms, lf, df, eb, li, bs, bl, p)=>{
    wbits(out, p++, final);
    ++lf[256];
    const { t: dlt, l: mlb } = hTree(lf, 15);
    const { t: ddt, l: mdb } = hTree(df, 15);
    const { c: lclt, n: nlc } = lc(dlt);
    const { c: lcdt, n: ndc } = lc(ddt);
    const lcfreq = new u16(19);
    for(let i = 0; i < lclt.length; ++i)++lcfreq[lclt[i] & 31];
    for(let i = 0; i < lcdt.length; ++i)++lcfreq[lcdt[i] & 31];
    const { t: lct, l: mlcb } = hTree(lcfreq, 7);
    let nlcc = 19;
    for(; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc);
    const flen = bl + 5 << 3;
    const ftlen = clen(lf, flt) + clen(df, fdt) + eb;
    const dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
    if (bs >= 0 && flen <= ftlen && flen <= dtlen) return wfblk(out, p, dat.subarray(bs, bs + bl));
    let lm, ll, dm, dl;
    wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
    if (dtlen < ftlen) {
        lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
        const llm = hMap(lct, mlcb, 0);
        wbits(out, p, nlc - 257);
        wbits(out, p + 5, ndc - 1);
        wbits(out, p + 10, nlcc - 4);
        p += 14;
        for(let i = 0; i < nlcc; ++i)wbits(out, p + 3 * i, lct[clim[i]]);
        p += 3 * nlcc;
        const lcts = [
            lclt,
            lcdt
        ];
        for(let it = 0; it < 2; ++it){
            const clct = lcts[it];
            for(let i = 0; i < clct.length; ++i){
                const len = clct[i] & 31;
                wbits(out, p, llm[len]), p += lct[len];
                if (len > 15) wbits(out, p, clct[i] >> 5 & 127), p += clct[i] >> 12;
            }
        }
    } else {
        lm = flm, ll = flt, dm = fdm, dl = fdt;
    }
    for(let i = 0; i < li; ++i){
        const sym = syms[i];
        if (sym > 255) {
            const len = sym >> 18 & 31;
            wbits16(out, p, lm[len + 257]), p += ll[len + 257];
            if (len > 7) wbits(out, p, sym >> 23 & 31), p += fleb[len];
            const dst = sym & 31;
            wbits16(out, p, dm[dst]), p += dl[dst];
            if (dst > 3) wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
        } else {
            wbits16(out, p, lm[sym]), p += ll[sym];
        }
    }
    wbits16(out, p, lm[256]);
    return p + ll[256];
};
const deo = new i32([
    65540,
    131080,
    131088,
    131104,
    262176,
    1048704,
    1048832,
    2114560,
    2117632
]);
const et = new u8(0);
const dflt = (dat, lvl, plvl, pre, post, st)=>{
    const s = st.z || dat.length;
    const o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7000)) + post);
    const w = o.subarray(pre, o.length - post);
    const lst = st.l;
    let pos = (st.r || 0) & 7;
    if (lvl) {
        if (pos) w[0] = st.r >> 3;
        const opt = deo[lvl - 1];
        const n = opt >> 13, c = opt & 8191;
        const msk = (1 << plvl) - 1;
        const prev = st.p || new u16(32768), head = st.h || new u16(msk + 1);
        const bs1 = Math.ceil(plvl / 3), bs2 = 2 * bs1;
        const hsh = (i)=>(dat[i] ^ dat[i + 1] << bs1 ^ dat[i + 2] << bs2) & msk;
        const syms = new i32(25000);
        const lf = new u16(288), df = new u16(32);
        let lc = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
        for(; i + 2 < s; ++i){
            const hv = hsh(i);
            let imod = i & 32767, pimod = head[hv];
            prev[imod] = pimod;
            head[hv] = imod;
            if (wi <= i) {
                const rem = s - i;
                if ((lc > 7000 || li > 24576) && (rem > 423 || !lst)) {
                    pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
                    li = lc = eb = 0, bs = i;
                    for(let j = 0; j < 286; ++j)lf[j] = 0;
                    for(let j = 0; j < 30; ++j)df[j] = 0;
                }
                let l = 2, d = 0, ch = c, dif = imod - pimod & 32767;
                if (rem > 2 && hv == hsh(i - dif)) {
                    const maxn = Math.min(n, rem) - 1;
                    const maxd = Math.min(32767, i);
                    const ml = Math.min(258, rem);
                    while(dif <= maxd && --ch && imod != pimod){
                        if (dat[i + l] == dat[i + l - dif]) {
                            let nl = 0;
                            for(; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl);
                            if (nl > l) {
                                l = nl, d = dif;
                                if (nl > maxn) break;
                                const mmd = Math.min(dif, nl - 2);
                                let md = 0;
                                for(let j = 0; j < mmd; ++j){
                                    const ti = i - dif + j & 32767;
                                    const pti = prev[ti];
                                    const cd = ti - pti & 32767;
                                    if (cd > md) md = cd, pimod = ti;
                                }
                            }
                        }
                        imod = pimod, pimod = prev[imod];
                        dif += imod - pimod & 32767;
                    }
                }
                if (d) {
                    syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
                    const lin = revfl[l] & 31, din = revfd[d] & 31;
                    eb += fleb[lin] + fdeb[din];
                    ++lf[257 + lin];
                    ++df[din];
                    wi = i + l;
                    ++lc;
                } else {
                    syms[li++] = dat[i];
                    ++lf[dat[i]];
                }
            }
        }
        for(i = Math.max(i, wi); i < s; ++i){
            syms[li++] = dat[i];
            ++lf[dat[i]];
        }
        pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
        if (!lst) {
            st.r = pos & 7 | w[pos / 8 | 0] << 3;
            pos -= 7;
            st.h = head, st.p = prev, st.i = i, st.w = wi;
        }
    } else {
        for(let i = st.w || 0; i < s + lst; i += 65535){
            let e = i + 65535;
            if (e >= s) {
                w[pos / 8 | 0] = lst;
                e = s;
            }
            pos = wfblk(w, pos + 1, dat.subarray(i, e));
        }
        st.i = s;
    }
    return slc(o, 0, pre + shft(pos) + post);
};
const crct = (()=>{
    const t = new Int32Array(256);
    for(let i = 0; i < 256; ++i){
        let c = i, k = 9;
        while(--k)c = (c & 1 && -306674912) ^ c >>> 1;
        t[i] = c;
    }
    return t;
})();
const crc = ()=>{
    let c = -1;
    return {
        p (d) {
            let cr = c;
            for(let i = 0; i < d.length; ++i)cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
            c = cr;
        },
        d () {
            return ~c;
        }
    };
};
const dopt = (dat, opt, pre, post, st)=>{
    if (!st) {
        st = {
            l: 1
        };
        if (opt.dictionary) {
            const dict = opt.dictionary.subarray(-32768);
            const newDat = new u8(dict.length + dat.length);
            newDat.set(dict);
            newDat.set(dat, dict.length);
            dat = newDat;
            st.w = dict.length;
        }
    }
    return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
function deflateSync(data, opts) {
    return dopt(data, opts || {}, 0, 0);
}

return {deflate:data=>deflateSync(data,{level:9,mem:8}),crc32:data=>{const c=crc();c.p(data);return c.d()>>>0;}};
})();
  // END fflate synchronous DEFLATE
/* CBP1: schema 1 の固定列。未知の項目や値を削らず拒否し、null/0/欠落を保存する。 */
(function(root){
  'use strict';
  const MAX_BYTES=512*1024;
  const DEFAULT_MAPS=Object.freeze(['city','dock','hoshimichi','kanto','mesa','mobility','tidal','wide']);
  const SCHEMA=["object",[["schema",["literal",1]],["sessions",["array",["object",[["startedAt",["number",1000000000000000.0,false]],["version",["version"]],["protocol",["number",1000,true]],["role",["enum",["host","guest"]]],["ended",["bool"]],["droppedSamples",["number",1000000000000.0,false]],["droppedEvents",["number",1000000000000.0,false]],["lastMatch",["nullable",["object",[["elapsedMs",["number",1000000000000.0,false]],["code",["enum",["session_started","sample","peer_joined","peer_disconnected","peer_departed","match_interrupted","transport_error","signaling_lost","connection_ready","match_started","match_finished","lobby_returned","preparation_aborted","session_ended","page_hidden","page_visible","page_closed"]]],["reason",["enum",["none","other","local_leave","reconnect","host_left","kicked","rejected","full","version_mismatch","protocol_mismatch","connection_error","snapshot_channel_error","channel_closed","signaling_closed","signaling_error","peer_unavailable","network_error","browser_unsupported","connection_timeout","approval_timeout","response_timeout","input_timeout","host_timeout","prepare_timeout","prepare_peer_left","invalid_data","send_failed"]]],["data",["object",[["role",["enum",["host","guest"]]],["phase",["enum",["idle","lobby","preparing","countdown","playing","ended","leaving"]]],["humans",["number",100,true]],["capacity",["number",100,true]],["teamSize",["number",100,true]],["map",["map"]],["visibility",["enum",["visible","hidden","unknown"]]],["fps",["number",10000,true]],["frame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["cpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostFrame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostCpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["arrivals",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["snapshotAgeMs",["number",1000000000000.0,true]],["rttMs",["number",1000000000000.0,true]],["corrections",["object",[["count",["number",1000000000000.0,true]],["samples",["number",1000000000000.0,true]],["meanM",["number",1000000000000.0,true]],["maxM",["number",1000000000000.0,true]],["hardSnaps",["number",1000000000000.0,true]],["reasons",["counter",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other"]]]]]],["predictionBlocked",["enum",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other","none"]]],["blockedCorrections",["number",1000000000000.0,true]],["repeatDebt",["number",1000000000000.0,true]],["pendingInputs",["number",1000000000000.0,true]],["preventedLook",["object",[["count",["number",1000000000000.0,true]],["maxDeg",["number",1000000000000.0,true]]]]],["transport",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]],["connectedPeers",["number",1000000000000.0,true]],["pendingPeers",["number",1000000000000.0,true]],["maxBufferedBytes",["number",1000000000000.0,true]],["maxQueue",["number",1000000000000.0,true]],["bufferedBytes",["number",1000000000000.0,true]],["queue",["number",1000000000000.0,true]],["latencyMs",["number",1000000000000.0,true]],["snapshotDropRate",["number",1000000000000.0,true]],["inputDropRate",["number",1000000000000.0,true]],["rtt",["object",[["count",["number",1000000000000.0,true]],["minMs",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["control",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshot",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshotDrops",["counter",["artificial","stale","congestion","superseded","incomplete"]]],["inputDrops",["counter",["artificial","stale","duplicate","congestion","superseded","rateLimited"]]]]]],["interpolation",["object",[["acceptedSnapshots",["number",1000000000000.0,true]],["staleSnapshots",["number",1000000000000.0,true]],["missingBaselines",["number",1000000000000.0,true]],["resyncRequests",["number",1000000000000.0,true]],["interpolatedFrames",["number",1000000000000.0,true]],["extrapolatedFrames",["number",1000000000000.0,true]],["clampedFrames",["number",1000000000000.0,true]],["delayMs",["number",1000000000000.0,true]],["effectiveDelayMs",["number",1000000000000.0,true]],["maxGapMs",["number",1000000000000.0,true]]]]],["lagCompensation",["object",[["shots",["number",1000000000000.0,true]],["rewinds",["number",1000000000000.0,true]],["clamped",["number",1000000000000.0,true]],["rejected",["number",1000000000000.0,true]],["maxRewindMs",["number",1000000000000.0,true]]]]]]]]]]]],["lastConnection",["nullable",["object",[["elapsedMs",["number",1000000000000.0,false]],["code",["enum",["session_started","sample","peer_joined","peer_disconnected","peer_departed","match_interrupted","transport_error","signaling_lost","connection_ready","match_started","match_finished","lobby_returned","preparation_aborted","session_ended","page_hidden","page_visible","page_closed"]]],["reason",["enum",["none","other","local_leave","reconnect","host_left","kicked","rejected","full","version_mismatch","protocol_mismatch","connection_error","snapshot_channel_error","channel_closed","signaling_closed","signaling_error","peer_unavailable","network_error","browser_unsupported","connection_timeout","approval_timeout","response_timeout","input_timeout","host_timeout","prepare_timeout","prepare_peer_left","invalid_data","send_failed"]]],["data",["object",[["role",["enum",["host","guest"]]],["phase",["enum",["idle","lobby","preparing","countdown","playing","ended","leaving"]]],["humans",["number",100,true]],["capacity",["number",100,true]],["teamSize",["number",100,true]],["map",["map"]],["visibility",["enum",["visible","hidden","unknown"]]],["fps",["number",10000,true]],["frame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["cpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostFrame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostCpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["arrivals",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["snapshotAgeMs",["number",1000000000000.0,true]],["rttMs",["number",1000000000000.0,true]],["corrections",["object",[["count",["number",1000000000000.0,true]],["samples",["number",1000000000000.0,true]],["meanM",["number",1000000000000.0,true]],["maxM",["number",1000000000000.0,true]],["hardSnaps",["number",1000000000000.0,true]],["reasons",["counter",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other"]]]]]],["predictionBlocked",["enum",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other","none"]]],["blockedCorrections",["number",1000000000000.0,true]],["repeatDebt",["number",1000000000000.0,true]],["pendingInputs",["number",1000000000000.0,true]],["preventedLook",["object",[["count",["number",1000000000000.0,true]],["maxDeg",["number",1000000000000.0,true]]]]],["transport",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]],["connectedPeers",["number",1000000000000.0,true]],["pendingPeers",["number",1000000000000.0,true]],["maxBufferedBytes",["number",1000000000000.0,true]],["maxQueue",["number",1000000000000.0,true]],["bufferedBytes",["number",1000000000000.0,true]],["queue",["number",1000000000000.0,true]],["latencyMs",["number",1000000000000.0,true]],["snapshotDropRate",["number",1000000000000.0,true]],["inputDropRate",["number",1000000000000.0,true]],["rtt",["object",[["count",["number",1000000000000.0,true]],["minMs",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["control",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshot",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshotDrops",["counter",["artificial","stale","congestion","superseded","incomplete"]]],["inputDrops",["counter",["artificial","stale","duplicate","congestion","superseded","rateLimited"]]]]]],["interpolation",["object",[["acceptedSnapshots",["number",1000000000000.0,true]],["staleSnapshots",["number",1000000000000.0,true]],["missingBaselines",["number",1000000000000.0,true]],["resyncRequests",["number",1000000000000.0,true]],["interpolatedFrames",["number",1000000000000.0,true]],["extrapolatedFrames",["number",1000000000000.0,true]],["clampedFrames",["number",1000000000000.0,true]],["delayMs",["number",1000000000000.0,true]],["effectiveDelayMs",["number",1000000000000.0,true]],["maxGapMs",["number",1000000000000.0,true]]]]],["lagCompensation",["object",[["shots",["number",1000000000000.0,true]],["rewinds",["number",1000000000000.0,true]],["clamped",["number",1000000000000.0,true]],["rejected",["number",1000000000000.0,true]],["maxRewindMs",["number",1000000000000.0,true]]]]]]]]]]]],["samples",["array",["object",[["elapsedMs",["number",1000000000000.0,false]],["data",["object",[["role",["enum",["host","guest"]]],["phase",["enum",["idle","lobby","preparing","countdown","playing","ended","leaving"]]],["humans",["number",100,true]],["capacity",["number",100,true]],["teamSize",["number",100,true]],["map",["map"]],["visibility",["enum",["visible","hidden","unknown"]]],["fps",["number",10000,true]],["frame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["cpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostFrame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostCpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["arrivals",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["snapshotAgeMs",["number",1000000000000.0,true]],["rttMs",["number",1000000000000.0,true]],["corrections",["object",[["count",["number",1000000000000.0,true]],["samples",["number",1000000000000.0,true]],["meanM",["number",1000000000000.0,true]],["maxM",["number",1000000000000.0,true]],["hardSnaps",["number",1000000000000.0,true]],["reasons",["counter",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other"]]]]]],["predictionBlocked",["enum",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other","none"]]],["blockedCorrections",["number",1000000000000.0,true]],["repeatDebt",["number",1000000000000.0,true]],["pendingInputs",["number",1000000000000.0,true]],["preventedLook",["object",[["count",["number",1000000000000.0,true]],["maxDeg",["number",1000000000000.0,true]]]]],["transport",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]],["connectedPeers",["number",1000000000000.0,true]],["pendingPeers",["number",1000000000000.0,true]],["maxBufferedBytes",["number",1000000000000.0,true]],["maxQueue",["number",1000000000000.0,true]],["bufferedBytes",["number",1000000000000.0,true]],["queue",["number",1000000000000.0,true]],["latencyMs",["number",1000000000000.0,true]],["snapshotDropRate",["number",1000000000000.0,true]],["inputDropRate",["number",1000000000000.0,true]],["rtt",["object",[["count",["number",1000000000000.0,true]],["minMs",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["control",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshot",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshotDrops",["counter",["artificial","stale","congestion","superseded","incomplete"]]],["inputDrops",["counter",["artificial","stale","duplicate","congestion","superseded","rateLimited"]]]]]],["interpolation",["object",[["acceptedSnapshots",["number",1000000000000.0,true]],["staleSnapshots",["number",1000000000000.0,true]],["missingBaselines",["number",1000000000000.0,true]],["resyncRequests",["number",1000000000000.0,true]],["interpolatedFrames",["number",1000000000000.0,true]],["extrapolatedFrames",["number",1000000000000.0,true]],["clampedFrames",["number",1000000000000.0,true]],["delayMs",["number",1000000000000.0,true]],["effectiveDelayMs",["number",1000000000000.0,true]],["maxGapMs",["number",1000000000000.0,true]]]]],["lagCompensation",["object",[["shots",["number",1000000000000.0,true]],["rewinds",["number",1000000000000.0,true]],["clamped",["number",1000000000000.0,true]],["rejected",["number",1000000000000.0,true]],["maxRewindMs",["number",1000000000000.0,true]]]]]]]]]],300]],["events",["array",["object",[["elapsedMs",["number",1000000000000.0,false]],["code",["enum",["session_started","sample","peer_joined","peer_disconnected","peer_departed","match_interrupted","transport_error","signaling_lost","connection_ready","match_started","match_finished","lobby_returned","preparation_aborted","session_ended","page_hidden","page_visible","page_closed"]]],["reason",["enum",["none","other","local_leave","reconnect","host_left","kicked","rejected","full","version_mismatch","protocol_mismatch","connection_error","snapshot_channel_error","channel_closed","signaling_closed","signaling_error","peer_unavailable","network_error","browser_unsupported","connection_timeout","approval_timeout","response_timeout","input_timeout","host_timeout","prepare_timeout","prepare_peer_left","invalid_data","send_failed"]]],["phase",["enum",["idle","lobby","preparing","countdown","playing","ended","leaving"]]],["humans",["number",100,true]]]],128]]]],3]]]];
  const fail=()=>{throw new Error('診断ログの形式または上限が不正です');};
  function mapsOption(options){
    const maps=options?.maps??DEFAULT_MAPS;
    if(!Array.isArray(maps)||maps.length>256||maps.some(s=>typeof s!=='string'||!/^[-a-z0-9_]{1,48}$/.test(s)||['__proto__','constructor','prototype'].includes(s)))fail();
    return new Set(['unknown',...maps]);
  }
  function object(v){
    if(!v||typeof v!=='object'||Array.isArray(v))fail();
    // JSON由来の通常オブジェクトとnull prototypeだけ。アクセサーや隠し項目も拒否。
    const proto=Object.getPrototypeOf(v);
    if(proto!==null&&Object.getPrototypeOf(proto)!==null)fail();
    const keys=Reflect.ownKeys(v);
    if(keys.some(k=>typeof k!=='string'||!Object.getOwnPropertyDescriptor(v,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')))fail();
    return keys;
  }
  function array(v,max){
    if(!Array.isArray(v)||v.length>max)fail();
    const keys=Reflect.ownKeys(v);
    if(keys.length!==v.length+1)fail();
    for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail();}
  }
  function walk(d,v,decode,maps,depth=0){
    if(depth>16)fail();
    const kind=d[0],next=(s,x)=>walk(s,x,decode,maps,depth+1);
    if(kind==='nullable')return v===null?null:next(d[1],v);
    if(kind==='object'){
      const fields=d[1];
      if(decode){array(v,fields.length);if(v.length!==fields.length)fail();return Object.fromEntries(fields.map(([k,s],i)=>[k,next(s,v[i])]));}
      const keys=object(v);if(keys.length!==fields.length||fields.some(([k])=>!Object.hasOwn(v,k)))fail();
      return fields.map(([k,s])=>next(s,v[k]));
    }
    if(kind==='array'){array(v,d[2]);return v.map(x=>next(d[1],x));}
    if(kind==='counter'){
      const keys=d[1];
      if(decode){array(v,keys.length);if(v.length!==keys.length)fail();return Object.fromEntries(keys.flatMap((k,i)=>v[i]===null?[]:[[k,next(['number',1e12,false],v[i])]]));}
      const found=object(v);if(found.some(k=>!keys.includes(k)))fail();
      return keys.map(k=>Object.hasOwn(v,k)?next(['number',1e12,false],v[k]):null);
    }
    if(kind==='number'){if(v===null&&d[2])return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>d[1])fail();return v;}
    if(kind==='enum'){if(typeof v!=='string'||!d[1].includes(v))fail();return v;}
    if(kind==='map'){if(typeof v!=='string'||!maps.has(v))fail();return v;}
    if(kind==='version'){if(typeof v!=='string'||(v!=='unknown'&&!/^Ver[0-9]{1,6}$/.test(v)))fail();return v;}
    if(kind==='bool'){if(typeof v!=='boolean')fail();return v;}
    if(kind==='literal'){if(v!==d[1])fail();return v;}
    fail();
  }
  function size(v){if(new TextEncoder().encode(JSON.stringify(v)).length>MAX_BYTES)fail();}
  function pack(v,options){const maps=mapsOption(options),encoded=walk(SCHEMA,v,false,maps);size(walk(SCHEMA,encoded,true,maps));return ['CBP1',encoded];}
  function unpack(v,options){array(v,2);if(v.length!==2||v[0]!=='CBP1')fail();const result=walk(SCHEMA,v[1],true,mapsOption(options));size(result);return result;}
  const api={pack,unpack,MAX_BYTES,DEFAULT_MAPS};
  root.CBOnlineDiagnosticPack=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

  const COMPRESSED_LIMITS={text:256*1024,packed:512*1024};
  function base64url(bytes){
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let out='';
    for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);out+=alphabet[n>>>18]+alphabet[(n>>>12)&63];if(i+1<bytes.length)out+=alphabet[(n>>>6)&63];if(i+2<bytes.length)out+=alphabet[n&63];}
    return out;
  }
  function compressData(data,maps){
    const packed=CBOnlineDiagnosticPack.pack(data,{maps}),bytes=new TextEncoder().encode(JSON.stringify(packed));
    if(bytes.length>COMPRESSED_LIMITS.packed)throw Error('診断データの展開上限を超えました');
    const payload=diagnosticDeflate.deflate(bytes),crc=diagnosticDeflate.crc32(bytes).toString(16).padStart(8,'0');
    const text='CBL2.D.'+bytes.length.toString(36)+'.'+crc+'.'+base64url(payload);
    if(text.length>COMPRESSED_LIMITS.text)throw Error('診断データのコピー上限を超えました');
    return text;
  }
  // CBM1: 今の試合（終了後は直前の試合）だけの固定152バイト要約。全時系列は含めない。
  const SHARE_LIMIT=241,SHARE_BYTES=152;
  const shareMetricGetters=[
    d=>d.frame.count>0?d.fps:null,d=>d.frame.count>0?d.frame.maxMs:null,d=>d.cpu.count>0?d.cpu.maxMs:null,
    d=>d.transport.rtt.count>0?d.transport.rtt.maxMs:d.rttMs,d=>d.snapshotAgeMs,d=>d.corrections.maxM,d=>d.corrections.hardSnaps,
    // 接続全体のmaxQueue/maxBufferedBytesは過去試合を含むので使わない。
    d=>d.transport.queue,d=>d.transport.bufferedBytes
  ];
  const shareProblem=e=>['peer_disconnected','peer_departed','match_interrupted','transport_error','signaling_lost','preparation_aborted'].includes(e.code)||!['none','local_leave','reconnect'].includes(e.reason);
  function shareData(data,maps,active){
    const source=(active&&data.sessions.find(s=>s.startedAt===active.startedAt&&s.role===active.role))||(!active&&data.sessions.at(-1));
    let flags=1,start=null,end=null,observations=[],selectedEvents=[],latest=null;
    if(!source)flags|=16|32;
    else{
      latest=source.samples.at(-1)||source.lastMatch||source.lastConnection;
      start=source.events.findLast(e=>e.code==='match_started');
      end=source.lastMatch&&(!start||source.lastMatch.elapsedMs>=start.elapsedMs)?source.lastMatch:null;
      if(!end&&source.ended&&start&&source.lastConnection?.elapsedMs>=start.elapsedMs)end=source.lastConnection;
      const newerAttempt=latest&&end&&latest.elapsedMs>end.elapsedMs&&['preparing','countdown','playing'].includes(latest.data.phase);
      if(newerAttempt){start=null;end=null;}
      if(end?.code==='preparation_aborted'){start=null;flags|=16;}
      const inMatch=latest&&['playing','ended'].includes(latest.data.phase);
      if(start&&!newerAttempt){
        const until=end?.elapsedMs??Infinity;
        observations=source.samples.filter(x=>x.elapsedMs>=start.elapsedMs&&x.elapsedMs<=until);
        if(end&&!observations.some(x=>x.elapsedMs===end.elapsedMs))observations.push(end);
        selectedEvents=source.events.filter(e=>e.elapsedMs>=start.elapsedMs&&e.elapsedMs<=until);
      }else if(end||inMatch){
        // 開始境界が保持上限で無くなった場合、他の試合を推測で混ぜず最後の1時点だけ。
        flags|=2;const point=end||latest;observations=point?[point]:[];
        selectedEvents=source.events.filter(e=>e.elapsedMs===point?.elapsedMs);
      }else{
        flags|=16;start=null;end=null;
        // 未出撃時は現在の接続状態のみ。過去の試合データへは戻らない。
        observations=latest?[latest]:[];
        selectedEvents=source.events.filter(e=>e.elapsedMs===latest?.elapsedMs);
      }
      if(end){flags|=8;if(!selectedEvents.some(e=>e.elapsedMs===end.elapsedMs&&e.code===end.code&&e.reason===end.reason))selectedEvents.push(end);}
      if(source.droppedSamples||source.droppedEvents)flags|=4;
    }
    const problems=selectedEvents.filter(shareProblem),event=problems.at(-1)||selectedEvents.at(-1)||end;
    const representative=(event&&problems.length?observations.findLast(x=>x.elapsedMs<=event.elapsedMs):null)||observations.at(-1);
    const d=representative?.data,bytes=new Uint8Array(SHARE_BYTES),view=new DataView(bytes.buffer);
    const index=(v,list)=>{const n=list.indexOf(v);return n<0?255:n;};
    bytes[1]=index(source?.role,roles);bytes[2]=index((end||observations.at(-1))?.data.phase,phases);bytes[3]=index(event?.code,events);bytes[4]=index(event?.reason,reasons);
    bytes[5]=index(d?.map,CBOnlineDiagnosticPack.DEFAULT_MAPS);bytes[6]=index(d?.visibility,['visible','hidden','unknown']);if(bytes[6]===255)bytes[6]=2;
    const version=source?.version?.match(/^Ver([0-9]{1,6})$/);view.setUint32(8,version?Number(version[1]):0xffffffff,true);
    function small(at,v,max){if(v!==undefined&&v!==null&&(!Number.isInteger(v)||v<0||v>max))flags|=64;view.setUint16(at,Number.isInteger(v)&&v>=0&&v<=max?v:65535,true);}
    small(12,source?.protocol,1000);small(14,d?.humans,100);
    function number(at,v){if(v===undefined||v===null){view.setUint32(at,0,true);view.setUint32(at+4,0x7ff80000,true);}else if(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e12)view.setFloat64(at,v,true);else{flags|=64;view.setUint32(at,0,true);view.setUint32(at+4,0x7ff80000,true);}}
    const relative=x=>start&&x?Math.max(0,x.elapsedMs-start.elapsedMs):null;
    number(16,relative(end||observations.at(-1)));number(24,relative(event));
    for(let i=0;i<shareMetricGetters.length;i++){
      const values=observations.map(x=>shareMetricGetters[i](x.data)).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e12);
      number(32+i*8,values.length?(i===0?Math.min(...values):Math.max(...values)):null);
    }
    number(104,relative(representative));number(112,d&&shareMetricGetters[0](d));number(120,d&&shareMetricGetters[3](d));number(128,d?.snapshotAgeMs);number(136,d?.corrections.maxM);
    view.setUint16(144,observations.length,true);view.setUint16(146,selectedEvents.length,true);view.setUint16(148,problems.length,true);bytes[0]=flags;
    const compressed=diagnosticDeflate.deflate(bytes),useCompressed=compressed.length<bytes.length;
    const text='CBL3.'+(useCompressed?'Z':'B')+'.'+diagnosticDeflate.crc32(bytes).toString(16).padStart(8,'0')+'.'+base64url(useCompressed?compressed:bytes);
    // 非圧縮でも219字。途中切断・丸めで上限を合わせない。
    if(text.length>SHARE_LIMIT||/[\r\n]/.test(text))throw Error('共有用ログの上限を超えました');
    return text;
  }
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
      this.active=this.restore({startedAt:this.now(),role,version,protocol});this.lastLocal=this.active;this.sessions.push(this.active);this.started=this.monotonic();this.lastSample=-Infinity;
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
    exportData(){this.bound();return JSON.parse(this.json());}
    compressed(data=this.exportData()){return compressData(data,this.maps);}
    share(data=this.exportData()){return shareData(data,this.maps,this.active||this.lastLocal);}
    capture(){const data=this.exportData(),detail=this.preview(data);try{return {compressed:this.share(data),detail};}catch(_){return {compressed:'',detail,error:true};}}
    preview(data=this.exportData()){return 'コアブレイカー オンライン試験ログ v1\n端末内の記録。自動送信なし。コピー・保存した内容の共有は任意です。\n時刻は端末時計（UTC開始時刻＋elapsedMs）。本人確認や原因の断定には使えません。\n数値は観測値。FPSはフレーム間隔から算出。frame/cpu/arrivals/補正は直近2秒、bytes/欠落は接続中の累計、interpolation/lagCompensationは試合ごと。未取得はnull（count=0は標本なし）。\nbytesはアプリが数えたJSONのUTF-8量。WebRTC/IPヘッダー・再送・回線全体の通信量は含みません。RTTはアプリping、CPUはJSのみ。ホスト値は最後に受信した申告値。\n欠落数はアプリ内の破棄・人工欠損で、回線パケット損失率ではありません。推測した回線原因/IP/ID/名前/チャット/SDP/生エラーは含みません。\n最新3接続・各300標本/128イベント・合計512KiB・再表示時に7日超を除去。droppedは上限で省いた件数。急なクラッシュでは最後の15秒を失う場合があります。\n\n'+JSON.stringify({schema:1,sessions:data.sessions.map(s=>({...s,startedUtc:new Date(s.startedAt).toISOString()}))},null,2);}
    clear(){this.sessions=[];this.active=null;this.lastLocal=null;try{this.storage?.removeItem(KEY);return true;}catch(_){this.storageAvailable=false;return false;}}
  }
  const api={Recorder,LIMITS,KEY,reasonCode,safeSample,COMPRESSED_LIMITS,compressData,SHARE_LIMIT,shareData,Pack:root.CBOnlineDiagnosticPack};root.CBOnlineDiagnosticLog=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

