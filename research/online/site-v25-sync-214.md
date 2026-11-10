# 独立テストv25の2修正を #214 へ同期（2026-11-10）

## 基準と範囲

- 開始時の対象は `codex/212-browser-host` / draft PR #214、head `ab5c0cebc343dcf5964f8a0de27595562383d92f`。GitHubのPR情報とコメントを確認し、その後の追加コミット・コメントはなかった。
- 配備済み移植元は TEST 25-online、Site保存ソース `3949e4b0334f1d7afd750ebf49323d8209e37674`。
- 元の兵装予約修正 `5dc8eb0355006f565633282ef33d3f8c8139b245` とロビー導線修正 `18b279b2c11fd5120594e9d5471d4de503a1d8e0` を隔離checkoutで統合し、v25の期限切れHに関する追加修正と独立回帰も取り込んだ。
- 最新main `fb371d4e3ce5b3335880efe074c9bf00db5331be` は基準headの祖先。既存コミットを上書きせず前進更新する。main、gh-pages、正式配布、#220、#221は変更しない。#214はdraftを維持する。

## 変更前・変更後

1. 自動転送取消後の兵装予約の再採用と、転送をまたぐ初回遅着を防ぐ。選択番号・専用ACK・H操作番号・転送世代を使い、既に取り消された予約を復活させない。自機だけへ予約情報を公開し、旧版は `class-choice-1` で拒否する。
2. 失効したHの期限後に生成されたホスト写真で現在の転送を確認した場合は、新しく選び直せる。写真到着時刻や手元時計で期限を判定せず、既存予約の再送は別のHへ結び直さない。
3. 装備編集の「保存して部屋に戻る」「下書きを破棄して部屋に戻る」を固定欄に置き、接続を保つ。退出は別領域の確認付き操作へ分け、Escで編集や接続を隠したまま最初のメニューへ戻らない。低い画面では窓全体をスクロール可能にする。

先行したv24の接続理由・共通保存構成・開始取消・可視基準修正を保持する。通信v9、codec、移動・武器性能、保存schemaは変更しない。

## 配備済みソースとの一致

`prototype/online/game.js`、`ui.js`、`ui.css` はv25の対応資材とバイト一致。`prototype/index.html` はテスト用title、doctype/meta、ログ案内、badge、cache keyとscript charsetだけを除くと完全一致する。Site専用の配布物・案内・hosting設定は持ち込まない。

製品SHA-256:

- `prototype/index.html`: `37424496b414175063a8c83bf0adfea9a1339db2195e0abe995ce07935f3f9b6`
- `prototype/online/game.js`: `34db373df3e975c895cd16776230701a2487df9d14c63dbc81b515918c8ba44a`
- `prototype/online/ui.js`: `6f89e0dec5c5b29a8224eb6d5804aead40b3a1fcf26b5f7d525321096c673bee`
- `prototype/online/ui.css`: `d1774015def8bddedd117293fc753f86b922f12277fb85aa11119153608e8209`

## 確かめたこと

- `node --test --test-concurrency=1 tools/test/*.test.js`: **263 runner tests成功、失敗・skip・TODOなし**（約74秒）。オンラインだけでなく既存mapgen・地面高さ等のNode回帰も含む。
- 二側兵装選択38シナリオ、因果関係16件、期限切れHの独立15件を含む。v24で既知失敗として除外していた自動取消2条件も、今回は通常の成功必須条件へ変更済み。
- ロビー導線8件は保存・下書き破棄・Esc反復・退出確認取消・host/guest・送信失敗・遅着・確認待ちを含む。既存UI・Ready・結果画面のブラウザ試験も確認付き退出へ追随した。
- 名前14ファイル、配布物静的24項目、変更JSと本体inline scriptの構文、dbg生成、`git diff --check` が成功。
- 回帰の製品参照はGitHubの `prototype/` へ、three.jsは既存vendorへ変更した。テストの期待値は維持している。

## 未確認

`online_lobby_navigation_check`、`quick_check`、4マップ`bot_battle`は、Playwright指定Chromium (`chromium_headless_shell-1194`) が未配置で起動前に停止した。実画面・native dialog・実キーボード/タッチ・WebRTC・実回線・操作感は未検証。Node/VMでは描画、物理、配送、時計等にfixtureがあり、実端末の受入成功とは扱わない。

#220のACK履歴削減/バイナリ化/TURN、#221のモバイルUI・ブラウザ試験変更は未統合。今回も該当PRへのpush・マージ・リベースをしていない。

個別修正の設計・作業時点の検査は `class-choice-cancellation-214.md` と `lobby-navigation-214.md` に残す。この記録がv25統合後の結果を示す。
