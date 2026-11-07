# Node の戦闘 CPU 試作（Issue #212）

通信を持たない測定用アダプター。Node.js 24 で検証。npm の追加依存はない。

```sh
node server/sim_bench.js --map mesa --units 10 --seconds 660 --out /tmp/bench10.json
node server/sim_bench.js --map mesa --units 20 --seconds 660 --out /tmp/bench20.json
```

各コマは 1/60 秒。Node の `performance.now()` を基準に実時間でスケジュールする。
遅れた場合は時間を捨てずに追いつくまで処理するため、過負荷では指定秒数より実行が長くなる。
`--seconds` は累積ゲーム内秒数。試合終了時には同じマップで次の試合へ進む。
毎分の結果は stderr、最終 JSON は stdout と `--out` へ出す。
`--fast` は待機なしの動作検証専用で、CPU 使用率による部屋数推定には使わない。

`prototype/index.html` のスクリプトを読んで VM 内だけで固定刻み・全員 BOT・初期装備に差し替える。
ファイル本体や武器・パーツ・マップの数値は変更しない。
ソースの形が変わって差し替え箇所を特定できない場合は例外で停止する。
三次元 Mesh、行列、Raycaster、銃口・武器姿勢を残し、WebGLRenderer と描画・音の入口を無処理にする。
DOM/2D canvas の参照は初期化用スタブ。HTML の解釈・画面描画はしない。
描画に付随する形状・材質の生成や一部の視覚状態更新は残るので、最終的なサーバーの最小負荷ではない。

**これはシミュレーション分離の完成形ではない。** 本体の大域変数、UI 初期化、プレイヤー参照が残る。
人間の入力経路、カメラ依存の照準、ネットワーク、予測・巻き戻しは未実装。
VM はコード分離の便宜に使うもので、信頼できないコードの安全な実行環境ではない。

ブラウザとの比較（Playwright と Chromium を事前導入）：

```sh
node server/browser_compare.js 10
node server/browser_compare.js 20
node tools/test/quick_check.js origin/main
```

比較用スクリプトは一時フォルダーに `make_dbg.py` の結果を作り、人数と初期装備を揃えて、
既存の `bot_battle.js` をそのまま実行する。終了後は一時フォルダーを削除する。
既存試験の刻みは 0.05 秒（20Hz）、Node は 60Hz。乱数・描画演出による乱数消費・壁時計・
ブラウザ試験の最初の1機の再出撃にも差がある。決定論的一致や描画 FPS の試験ではない。

結果と計測範囲・限界は [測定資料](../research/online/cpu-bench.md) を参照。
