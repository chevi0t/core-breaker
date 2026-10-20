# 追加機体の検証記録と画面

Codexで実行済み：2026-10-20（日本時間）。ゲーム本体の対象コミットは `4e15aeb84e7d509592a83d2acd6f782009b1639c`、比較元は補助装備PR #12の `fcf2c742eb6e418461c2dcc4ef426cfe87ee2037`。対象の `prototype/index.html` のGit blobは `5123f321530c514746d193fd974dfffce1d37c80`。後続のコミットは出典・説明・画像・結果の追加で、ゲーム本体は同じ。

準備：リポジトリのPlaywright/Chromiumを用意し、`python3 tools/test/make_dbg.py dbg/mech-series`。ソフトウェア描画を使用。

| 実行コマンド | 確認結果 |
| --- | --- |
| `node tools/test/mech_series_check.js dbg/mech-series media/mech-series <追加前stats.json>` | AC36パーツ、旧36パーツ/285武器の同値、実動作119項目、型比較とSP表示・回転見本・保存再読込：成功 |
| `node tools/test/part_variants_check.js dbg/mech-series <画像出力先>` | 104976構成、486セット、48通りの型と同じ形、4000回のBot抽選で各部位全18型、旧保存・構成切替：成功 |
| `node tools/test/mech_shapes_check.js dbg/mech-series <画像出力先>` | 全1296混成、部位別6480実射、頭部の高さ・武器取付・塗装・チーム帯、最大48箱：成功 |
| `node tools/test/bot_battle.js dbg/mech-series city,wide,mesa,dock 150` | city151秒・wide159秒・mesa156秒、dock33秒（戦力0で正常終了）。全4マップでエラーなし。cityで新9型全てを確認 |

`追加前stats.json` は比較元コミットの実行時 `{weapons,parts,armory}`。機械可読の結果は [validation.json](validation.json)、全性能と重量例は [new-series-stats.md](../../research/parts/types/new-series-stats.md)。ゲーム本体の後続差分があれば、この記録の対象から分けて評価できる。

- `harrier` / `prism` / `bastion` の `-preview.png`：全身の回転見本を同じ角度で取得。
- `-compare.png`：頭部のⅠ〜Ⅲ型と▲▼の比較。
- `-body.png`：胴部のSP回復・ブーストの比較。
- `mixed.png`：新3系統を混ぜた機体と重量棒。

画面は実際のカスタマイズ画面からPlaywrightで取得。公式画像・モデル・ロゴは使用しない。
