// 配布するgame.js冒頭の独立Recorder節をそのまま読む。複製ソースは持たない。
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('../../prototype/online/game.js'),'utf8');
const end=source.indexOf('/* #212 ブラウザホスト試作。');assert(end>0,'Recorderとゲーム本体の境界');
const c={module:{exports:{}},TextEncoder,performance,Date};vm.runInNewContext(source.slice(0,end),c);
module.exports=c.module.exports;
