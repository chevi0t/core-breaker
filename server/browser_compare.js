#!/usr/bin/env node
'use strict';
// 既存bot_battle.jsを変更せず、人数・初期装備だけを揃えて実行する。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const units = Number(process.argv[2] || 10);
if (![10, 20].includes(units)) throw Error('人数は10か20');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-bench-browser-'));
try {
  execFileSync('python3', ['tools/test/make_dbg.py', dir], { cwd: root, stdio: 'inherit' });
  const file = path.join(dir, 'dbg.html');
  let html = fs.readFileSync(file, 'utf8');
  const before = 'const pick = k => u.isPlayer ? (tutorial ? c[k] : loadout[cls][k]) : A[k][Math.floor(Math.random() * A[k].length)];';
  if (html.split(before).length !== 2) throw Error('初期装備の本体コードが変化');
  html = html.replace(before, 'const pick = k => c[k];');
  const end = html.lastIndexOf('</script>');
  html = html.slice(0, end) + `\nselectedTeamSize = ${units / 2}; window.__allBotBattle = true;\n` + html.slice(end);
  fs.writeFileSync(file, html);
  const result = spawnSync(process.execPath, ['tools/test/bot_battle.js', dir, 'mesa', '300'], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
