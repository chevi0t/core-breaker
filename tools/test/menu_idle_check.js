// メニューを開いている間は裏の戦闘画面を描かない（2026-11-11 メニューの再設計：軽く動かす）。
// node tools/test/menu_idle_check.js [dbg]
const { check } = require('./lib');

check('メニュー中の描画の停止', async ({ ev, step, ok }) => {
  await ev(() => { const r = __g.renderer, f = r.render.bind(r); window.__draws = 0; r.render = (...a) => { window.__draws++; return f(...a); }; });
  const draws = async n => { await ev(() => { window.__draws = 0; }); await step(n); return ev(() => window.__draws); };
  ok(await draws(3) <= 1, 'メニューを開いた直後は1コマだけ描く');
  ok(await draws(20) === 0, 'その後のメニュー中は描かない');
  await ev(() => __g.selectMap('wide'));
  ok(await draws(5) === 1, 'マップを選び直したら1コマだけ描く');
  await ev(() => document.getElementById('start').click());
  ok(await draws(5) === 5, '出撃したら毎コマ描く');
}, { errorsOk: /ERR_TUNNEL_CONNECTION_FAILED/ });
