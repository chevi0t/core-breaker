// 配布する diagnostics.js（独立した Recorder。2026-11-10 に game.js の冒頭から分けた）をそのまま読む。複製ソースは持たない。
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('../../prototype/online/diagnostics.js'),'utf8');
assert(!fs.readFileSync(require.resolve('../../prototype/online/game.js'),'utf8').includes('CBOnlineDiagnosticPack='),'Recorderはgame.jsに置かない');
const c={module:{exports:{}},TextEncoder,performance,Date};vm.runInNewContext(source,c);
module.exports=c.module.exports;
