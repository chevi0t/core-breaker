// 試験を1つずつ順に回して、最後にまとめを出す（2026-11-04 リファクタ）。
// 使い方：
//   node tools/test/run_checks.js --since origin/main          # その版から増えた・変わった *_check.js を全部（PR の自分の試験）
//   node tools/test/run_checks.js hover_dive camera_fade        # 名前で選ぶ（_check.js は省いてよい）
//   node tools/test/run_checks.js --dbg dbg --timeout 600 ...   # dbg のフォルダ（既定 dbg）、1つの制限秒（既定 900）
// 各試験には `node tools/test/<名前>_check.js <dbg> <出力フォルダ>` と渡す（出力は一時フォルダの下）。
// Chromium を同時に何本も開くとメモリが足りなくなるので、並べずに1つずつ回す。dbg が無ければ先に make_dbg.py で作る。
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), { spawnSync, execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..'), TEST = __dirname;
const args = process.argv.slice(2);
let dbg = 'dbg', timeout = 900, since = null;
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dbg') dbg = args[++i];
  else if (args[i] === '--timeout') timeout = +args[++i];
  else if (args[i] === '--since') since = args[++i];
  else names.push(args[i].replace(/(_check)?\.js$/, ''));
}
if (since) {
  const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', since, '--', 'tools/test/'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(f => /_check\.js$/.test(f)).map(f => path.basename(f, '_check.js'));
  names.push(...changed.filter(n => !names.includes(n)));
}
if (!names.length) { console.log('回す試験がありません（名前か --since を渡す）'); process.exit(0); }
const missing = names.filter(n => !fs.existsSync(path.join(TEST, n + '_check.js')));
if (missing.length) { console.error('見つからない試験：' + missing.join(', ')); process.exit(1); }
const dbgDir = path.resolve(ROOT, dbg);
if (!fs.existsSync(path.join(dbgDir, 'dbg.html'))) {
  console.log(`${dbg}/dbg.html が無いので作る`);
  if (spawnSync('python3', ['tools/test/make_dbg.py', dbg], { cwd: ROOT, stdio: 'inherit' }).status) process.exit(1);
}
const results = [];
for (const n of names) {
  const out = path.join(os.tmpdir(), 'run-checks', n), t0 = Date.now();
  console.log(`\n▶ ${n}`);
  const r = spawnSync('node', [path.join(TEST, n + '_check.js'), dbgDir, out], { cwd: ROOT, stdio: 'inherit', timeout: timeout * 1000 });
  const s = ((Date.now() - t0) / 1000).toFixed(0);
  results.push({ n, ok: r.status === 0, s, why: r.error ? (r.error.code === 'ETIMEDOUT' ? `${timeout}秒で打ち切り` : r.error.message) : r.signal ? '止められた（' + r.signal + '）' : r.status ? '終了コード ' + r.status : '' });
}
const bad = results.filter(r => !r.ok);
console.log('\nまとめ');
for (const r of results) console.log(`  ${r.ok ? '成功' : '失敗'}  ${r.n}（${r.s}秒）${r.why ? ' ' + r.why : ''}`);
console.log(bad.length ? `${results.length}本のうち ${bad.length}本 失敗` : `${results.length}本 全部成功`);
process.exitCode = bad.length ? 1 : 0;
