# 独立テスト版の修正を #214 へ同期（2026-11-10）

## 対象と移植元

- 対象: `codex/212-browser-host` / draft PR [#214](https://github.com/chevi0t/core-breaker/pull/214)。開始時のGitHub headは `46ccba7784e34b2c376000b5170a7551d40fc52f`。
- 移植元: 独立テストSiteのv24 / TEST 24-visibility、保存ソース `850e8313aa5aa1728ca5c11a325efc37d8d6b8ff`。保存版のソース・成功済み配備を確認した。
- 最新main `fb371d4e3ce5b3335880efe074c9bf00db5331be` は元headの祖先。mainの追加取り込みは不要。
- main、gh-pages、正式配布、テストSiteの配備先は変更しない。既存の開発ブランチへ通常の前進更新だけを行う。

## 変更前・変更後

GitHub側には、テストサイトで先に修正・検証した以下の差分が無かった。現在配備されている製品コードへ揃える。

1. オフライン共通3構成と保存パイロット名。4兵装の保存武器を保持し、本人が保存した変更だけを共通保存へ反映する。
2. 同じページの元ゲストの一時切断復帰。同期中はBotが引き継ぎ、同じ機体・生命・装備・得点へ戻す。順次復帰の設置物固定枠と、復帰待機中の試合終了を維持する。
3. 入力ACKの精密座標、開始時の入力番号窓、実適用時の250ms期限切れ命令の破棄。
4. Peer登録の取消・終了時の待ち処理の完了。部屋不在・ホスト退出・復帰可能切断を分け、終了後の遅着イベントを無効化する。
5. 準備・カウントダウンの取消と同じ部屋での再試合。初回送信失敗や同期切断でも中止済みの開始を再開しない。
6. H転送取消時の現在4枠への復元、未確認の兵装選択の保持、出撃地点の再送。
7. 可視範囲の変更で未送信の基準写真を破棄したときだけ、現在の公開範囲による独立基準を生成する。

## 移植の境界

`dist/online/{codec,game,transport,ui}.js` を対応する `prototype/online/` へ移し、4ファイルが移植元とバイト一致することを確認した。本体 `prototype/index.html` は `cancelTransfer` の変更だけを適用した。

それ以外の対応するゲーム資材は元から一致している。テスト用のタイトル・バッジ・ログ案内・cache key、`.openai/hosting.json`、`dist/`、`build-info.json`、アーカイブは持ち込んでいない。three.jsは既存の `vendor/three-r128/` を試験から参照し、二重に同梱しない。

移植後の製品SHA-256:

- `prototype/index.html`: `4c8a83cf7491d4ba3b3175e301396b0e5cd9fdbb061e10994d060a5a6aceed76`
- `prototype/online/codec.js`: `adbcf596167f8e4b4737112e1eff0339c114e8abe956cec0f53b3641143a2a05`
- `prototype/online/game.js`: `11dc94cecacf7586a4249d46b7c7c9498f8865b65ed7b97f173ffb94588b4b16`
- `prototype/online/transport.js`: `b1a98eee6d7a71a88bd2c257e8c4f8370d567d5d8e541203fc8702c7733c26f3`
- `prototype/online/ui.js`: `8b6b2ada8cfdfcf6260628912a6692e6f2fdae799bba75464ace3dfc49acc23b`

## 試験

テストサイトの独立回帰11本を `tools/test/online_site_*.test.js` へ移した。製品参照を `prototype/` へ、three.js参照を既存vendorへ変更し、試験同士の読み込み名を合わせた。旧 `transport_existing` は既存 `online_transport.test.js` と同等で重複させず、Site専用の `verify_dist` は含めない。

- 接続理由、登録取消、明示退出、遅着イベント、再試合、500ms地点再送、転送取消、未確認選択、可視範囲と写真基準を検査する。
- 既存の診断・部屋・UI・定型通信・写真payload試験は、新しい状態と保存APIを持つfixtureへ追随させた。写真試験では「未送信の基準なし」を明示し、hide時の差分保持・秘匿のassertionを維持する。
- 共通3構成の追加回帰は、参照の独立、4兵装の保持、パイロット名、変更項目だけの統合、不正入力・確認待ちの拒否、保存不可時の画面内保持を検査する。

再実行:

```sh
node --test --test-concurrency=1 tools/test/*.test.js
node tools/test/names_check.js
python3 tools/test/distribution_check.py
python3 tools/test/make_dbg.py dbg
node tools/test/quick_check.js origin/main
node tools/test/bot_battle.js dbg city,wide,mesa,dock 150
```

最終結果（この移植後の製品コードと回帰試験）:

- `node --test --test-concurrency=1 tools/test/*.test.js`: **224 runner tests成功、失敗0**。約68秒。下記の自動転送取消2条件は個別の既知失敗として出力するため、この成功数とは分ける。
- 共通構成追加3件と、精密座標ACKの無丸め往復・他機ACK非公開を含む。既存の全オンライン回帰に加え、武器cycle・mapgen・mobility schema・地面高さのNode試験も再実行した。
- 名前の重複: 14ファイル成功。配布物静的検査: 24項目成功。JavaScript構文: 7スクリプト成功。dbg生成、`git diff --check` 成功。
- 移植元との照合: 87資材がバイト一致。本体HTMLもテスト専用wrapperだけを除くと一致。
- `quick_check` / 4マップ`bot_battle`: ブラウザ起動前に停止し未検証。詳細は次節。
- 初回の既存試験で出た5失敗はfixtureの旧状態・保存API不足・未送信基準契約の不足を修正し、最終全件で再確認した。製品コードは移植元のまま変更していない。

## 既知残件と未検証

- 二側転送回帰は13シナリオ中11成功。ホストの自動取消後にゲストの古い兵装予約が再採用される2条件は、移植元からの既知失敗として明示的に記録し、runnerの終了コードからは除外している。全シナリオ成功とは扱わない。明示H取消と新lifeの修正とは別に、予約世代または取消確認の同期が必要。
- `quick_check` と4マップの `bot_battle` は、指定のPlaywright Chromiumが無く起動前に停止。既存のシステムChromiumも `socket() failed: Operation not permitted` で起動不可。実画面・実入力・clipboard・実WebRTC・実回線の受入成功とは扱わない。
- VMでは描画、地形・配置、機体性能等の一部をfixtureにしている。実ブラウザ操作の代用ではない。
- 移動命令は実適用までの250msが期限。片道240msにpump等が加わる条件の改善、元の根本接続失敗やH転送で改善する開始時症状との因果確定は今回の対象外。

## 他のPRとの関係

- [#220](https://github.com/chevi0t/core-breaker/pull/220) は未統合。ACK履歴削減・バイナリ化・通信v10・TURNは含まない。game/transport/uiに重なりがあり、特に未open接続へrejectを送らない防御は両側にある。後の統合で差分を確認する必要がある。
- [#221](https://github.com/chevi0t/core-breaker/pull/221) は未統合。スマホのオンラインボタン非表示、ブラウザReady待ち・装備・なめらか表示の試験変更は含まない。ui.jsと設計書に重なりがある。今回のNode fixture修正とは別の変更。
- 両PRをマージ・リベース・更新していない。#214はdraftを維持する。
