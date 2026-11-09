# 初期写真の公開状態検査の誤検出（2026-11-09）

## 結論

`online_visibility_check` の「initial/base CORE/plants/timeを保存」は試験側の誤検出。
プラントの値は保存されているが、オブジェクトのキーの挿入順まで `JSON.stringify` で比較していた。
製品の `prototype/` は変更しない。#220 の ACK履歴削減・バイナリ化も変更しない。

調査時の head は #214 `0daadcb3094b73e6e3bf234386a4d268e770d59b`、
#220 `dbf49593b70fcfaa10d3c90e07651e860a79192c`。

## 変更前と原因

`game.snapshot()` のプラント項目順は `id, owner, gauge, capturing, contested`。
`b7335049b4f7ca926a5f48c354efb84b7647df00` で施設一覧を項目別の差分へ変更したため、
codec の通常のキー整列を通り、復号後は `capturing, contested, gauge, id, owner` になる。

例として `{id:'A', owner:null, gauge:0, capturing:null, contested:false}` は、
全項目・型・値が一致するのに、JSON文字列が異なる。
同じ入力に対し b733504 の直前の codec は旧文字列比較が成功し、b733504 は失敗する。
両版とも独立した `assert.deepEqual` は成功する。CORE と残り時間も一致する。

## 変更後

- 試験専用の `publicStateChecks` で、オブジェクトのキー順だけを揃えて比較する。
- 配列の順序・長さ、数値・文字列・boolean・null、項目の有無はそのまま比較する。
- CORE・プラント・残り時間を別々に検査し、失敗時は対象項目と実値・期待値を記録する。
- 同じ関数をブラウザの dbg へ渡し、Node 回帰でも使う。本体の codec、施設、秘匿規則は変えない。

## 確かめたこと

`node --test tools/test/online_visibility_public_state.test.js` は3テスト成功。
B/R 両ゲストについて実 `game.snapshot → encodePeerSnapshot → codec → 別VMのapplySnapshot` を通し、
初期基準・差分・差分欠落後・定期基準patch・schema更新・完全基準再同期の公開状態を確認した。
描画末端の `paintPlant` などは代役であり、見た目の検証ではない。

比較器の成功だけに依存せず Node の `assert.deepEqual` でも全公開値を照合した。
COREの減少/欠落、時間の変更/型違い、各プラント項目の変更/欠落、項目追加、
プラント配列の並べ替え/欠落は失敗することも確認した。許したのはオブジェクトのキー順だけ。

同じ新回帰を `CB_VISIBILITY_ROOT` で b733504 と #220 の上記 head の実製品コードへ向けても、それぞれ3テスト成功。
#214 の最終ローカル変更では以下が成功した。

- `node --test tools/test/online_*.test.js`：59テスト成功、失敗/skip/TODOなし。
- `node tools/test/online_visibility_check.js dbg /tmp/214-visibility-node --node-only`：154項目成功。
- `node tools/test/names_check.js`：14ファイルの重複キーなし。
- 変更JavaScriptの `node --check`、`git diff --check`、`make_dbg.py` 成功。

## 未確認と再実行

ブラウザ版 visibility と `quick_check.js origin/main` は、Playwright指定のChromium未配置で起動前停止。
システムの `/usr/bin/chromium` も `socket() failed: Operation not permitted` で起動前停止した。
したがって本修正後のブラウザ全機能・実描画・実WebRTCを成功とは扱わない。
ブラウザを使える環境では、次を順に実行する。

```sh
python3 tools/test/make_dbg.py dbg
node tools/test/online_visibility_check.js dbg /tmp/online-visibility --mock-transport --functional-only
node tools/test/quick_check.js origin/main
```

#214 は draft のまま。main・#220・公開ページは更新しない。
