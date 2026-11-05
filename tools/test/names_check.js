// 名前の重なりの検査（2026-11-06、オーナー「新武器実装時の手順に名称チェック入れよっか」）。ブラウザは使わない。
// JavaScript では同じオブジェクトの中に同じキーを2回書いてもエラーにならず、後の方だけが残る。
// スタンガンのシリーズ名 ie が索敵センサーの ie と重なり、支援の補助装備の一覧が開けなかった（#192）ので、
// 本体（index.html の中の script）と prototype/*.js・prototype/maps/*.js の、全部のオブジェクトの重複キーを探す。
// 表の中身のつながり（シリーズの型番の頭の重なり、画面に出す名前の重なりなど）は custom_lists_check.js が確かめる。
// node tools/test/names_check.js [ファイル…]（省略すると上の全部）
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..', '..');
const files = process.argv.slice(2).length ? process.argv.slice(2) : [
  'prototype/index.html',
  ...fs.readdirSync(path.join(root, 'prototype')).filter(f => f.endsWith('.js')).map(f => 'prototype/' + f),
  ...fs.readdirSync(path.join(root, 'prototype/maps')).filter(f => f.endsWith('.js')).map(f => 'prototype/maps/' + f),
];
const SKIP = new Set(['maps.js', 'sounds.js', 'music.js', 'three.min.js']); // 道具が作る大きなファイル

// <script> の中だけを残し、ほかは空白にする（行の番号を保つ）
function scriptOnly(src) {
  let out = '', last = 0;
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  for (let m; (m = re.exec(src));) {
    const open = m.index + m[0].indexOf('>') + 1;
    out += src.slice(last, open).replace(/[^\n]/g, ' ') + m[1];
    last = open + m[1].length;
  }
  return out + src.slice(last).replace(/[^\n]/g, ' ');
}

// 字句に分ける：文字列・テンプレート（${} の入れ子も）・コメント・正規表現を読み飛ばし、記号と名前と文字列を返す
function tokens(src) {
  const out = []; let i = 0, line = 1;
  const regexOk = () => { const p = out[out.length - 1]; return !p || (p.t === 'p' && !')]}'.includes(p.v)) || (p.t === 'id' && /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(p.v)); };
  const tmpl = depth => { // ` の次から閉じる ` まで。${ … } の中は普通の字句として読む
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') line++;
      if (c === '`') { i++; return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; code(1); continue; }
      i++;
    }
  };
  const code = stopAt => { // stopAt：${ の中なら、閉じる } で戻る
    let depth = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === '\n') { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); for (let k = i; k < (e < 0 ? src.length : e); k++) if (src[k] === '\n') line++; i = e < 0 ? src.length : e + 2; continue; }
      if (c === '"' || c === "'") { const s = i, l = line; i++; while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; else if (src[i] === '\n') line++; i++; } i++; out.push({ t: 'str', v: src.slice(s + 1, i - 1), line: l }); continue; }
      if (c === '`') { const l = line; i++; tmpl(); out.push({ t: 'tmpl', v: '', line: l }); continue; }
      if (c === '/' && regexOk()) { i++; let cls = false; while (i < src.length && (src[i] !== '/' || cls)) { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; else if (src[i] === '\n') break; i++; } i++; while (/[a-z]/.test(src[i] || '')) i++; out.push({ t: 're', v: '', line }); continue; }
      if (/[A-Za-z_$\u0080-￿]/.test(c)) { const s = i; while (i < src.length && /[\w$\u0080-￿]/.test(src[i])) i++; out.push({ t: 'id', v: src.slice(s, i), line }); continue; }
      if (/[0-9.]/.test(c) && /[0-9]/.test(c === '.' ? d || '' : c)) { const s = i; while (i < src.length && /[\w.]/.test(src[i])) i++; out.push({ t: 'num', v: src.slice(s, i), line }); continue; }
      if (c === '{') depth++;
      if (c === '}') { if (stopAt && depth === 0) { i++; return; } depth--; }
      if (c === '.' && d === '.' && src[i + 2] === '.') { out.push({ t: 'p', v: '...', line }); i += 3; continue; }
      if (c === '?' && (d === '.' || d === '?')) { out.push({ t: 'p', v: c + d, line }); i += 2; continue; }
      out.push({ t: 'p', v: c, line }); i++;
    }
  };
  code(0);
  return out;
}

// { の中で、{ か , の直後に「名前 :」と続く物をキーとして数える
function dupKeys(ts) {
  const found = [], stack = [];
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    if (t.t === 'p' && '{(['.includes(t.v)) { stack.push(t.v === '{' ? new Map() : null); continue; }
    if (t.t === 'p' && '})]'.includes(t.v)) { stack.pop(); continue; }
    const top = stack[stack.length - 1];
    if (!top || !['id', 'str', 'num'].includes(t.t)) continue;
    const prev = ts[k - 1], next = ts[k + 1];
    if (!prev || prev.t !== 'p' || (prev.v !== '{' && prev.v !== ',') || !next || next.t !== 'p' || next.v !== ':') continue;
    if (t.t === 'id' && /^(case|default)$/.test(t.v)) continue;
    const key = t.t === 'num' ? String(Number(t.v)) : t.v;
    if (top.has(key)) found.push({ key, line: t.line, first: top.get(key) });
    else top.set(key, t.line);
  }
  return found;
}

let bad = 0, n = 0;
for (const f of files) {
  if (SKIP.has(path.basename(f))) continue;
  let src = fs.readFileSync(path.resolve(root, f), 'utf8');
  if (f.endsWith('.html')) src = scriptOnly(src);
  n++;
  for (const d of dupKeys(tokens(src))) { bad++; console.log(`  ${f}:${d.line} キー「${d.key}」が同じオブジェクトの中で2回目（1回目は ${d.first} 行）`); }
}
if (bad) { console.log(`名前の重なり：${bad}件（${n}ファイル）。後に書いた方だけが残るので、どちらかの名前を変えてください`); process.exit(1); }
console.log(`名前の重なり：${n}ファイル、重複キーなし`);
