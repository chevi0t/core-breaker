# 装備編集から部屋へ戻る導線（#214、2026-11-10）

## 変更前

基準は #214 の `ab5c0cebc343dcf5964f8a0de27595562383d92f`。独立テストSite v24 の `dist/online/ui.js` と内容が一致した。

- 保存と下書き破棄はスクロール内にあるが、固定欄の「戻る／退出」は `CBOnlineGame.leave()` を呼び、部屋を切断して最初のメニューへ移る。同じ「戻る」に異なる行き先が混じっていた。
- ロビーのEscapeもパネルを隠し、接続・編集中フラグは残ったまま背後の最初のメニューを表示した。
- ゲストの装備確定待ちでは編集終了後のフォーカス先のReadyがdisabledになり、フォーカスを移せないことがあった。

## 変更後

- 編集中は固定欄を「保存して部屋に戻る」「下書きを破棄して部屋に戻る」に切り替え、保存を主ボタンにする。Ready・開始の代わりに表示し、保存/破棄は同じ部屋・参加者を維持する。
- 「部屋を退出して最初のメニューへ」は別領域・別色に分離。部屋参加中や接続待ちはnative dialogで確認し、ホストは全員の接続/試合終了、ゲストは自身の接続終了、編集中は未保存下書き破棄を説明する。保存済み構成は削除しない。初期フォーカスは退出しないボタン。
- ロビーのEscapeは編集と接続を保持し、明示的な部屋戻り操作を案内する。確認のEscapeは確認だけを閉じる。試合中のEscape、F3、結果画面の同じ部屋への復帰は維持する。
- ゲスト確認待ちのフォーカスは見える状態欄へ。保存/編集終了通知の例外では既存どおり編集を保持する。保存API・保存形式・通信・Readyの条件は変更しない。ストレージ禁止時に画面内の構成を維持する既存仕様も維持する。
- 通常高さは操作欄を常設。高さ560px以下は窓全体の単一スクロールへ切り替え、低い画面や拡大時に下端操作を切らない。状態文は長くなっても内部スクロールできる。

## 検査

- `node --test tools/test/online_lobby_navigation.test.js`：8テスト成功。実ui.jsとgame.js全体をDOM/通信/保存媒体の代役で実行する。固定欄、Esc反復、複数構成の下書き、退出確認取消、保存/編集終了送信失敗、host/guest確認、遅い二重イベント、接続取消後の遅着、装備確認待ちを含む。
- 最終 `node --test --test-concurrency=1 tools/test/online*.test.js`：214テスト成功、runnerの失敗/skip/TODOなし。基準版に元からある `online_site_transfer_two_sided.test.js` の自動取消2条件は既知の失敗として内部出力するまま（runnerは成功扱い）。これは別の兵装予約修正で扱い、このUI修正の成功へ含めない。
- 同じ新試験へ基準のui.jsだけを渡す対照：7失敗・1成功。保存/終了失敗時に編集を残す1件は修正前から成功。今回の追加仕様を基準版が満たさないことを確認した。
- 独立レビュー：追加VM操作検査と、別担当の7シナリオ・関連13ファイル82テストが成功。native dialogの安全側フォーカス・Esc、低高さのCSS分岐も静的確認。実レンダリングの保証ではない。
- `node tools/test/names_check.js`：14ファイル、重複キーなし。`python3 tools/test/distribution_check.py`：静的24項目成功。構文検査、`git diff --check`、dbg生成成功。
- 既存のUI/Ready/結果画面のブラウザ試験は、明示的な退出確認操作へ更新。Ready試験の古い「保存はオフライン構成を変えない」という期待値も、現在の共通保存仕様へ合わせた。

追加npm依存はない。新Node試験は `online_lobby_ui.test.js`、`online_rooms.test.js`、`online_saved_build_fixture.js` を既存fixtureとして使う。Site側へ移す場合はこの3ファイルと `prototype/online` → `dist/online`、`tools/test` → `tests` の読み込み先を揃える。

## 実ブラウザの未確認範囲

再実行用：

```
python3 tools/test/make_dbg.py dbg
node tools/test/online_lobby_navigation_check.js dbg /tmp/online-navigation --mock-transport
node tools/test/online_ui_check.js dbg /tmp/online-ui --mock-transport
node tools/test/online_ready_check.js dbg /tmp/online-ready --mock-transport
node tools/test/online_result_buttons_check.js dbg /tmp/online-result --mock-transport
node tools/test/quick_check.js fb371d4e3ce5b3335880efe074c9bf00db5331be
```

新しいブラウザ試験は1440×900・390×844・320×568の固定欄、844×390・320×300の全体スクロール、host/guest両方の保存/破棄/確認取消/確定を検査し、スクリーンショットを出力する。

この環境では指定Chromium未配置のため新試験とquick_checkは起動前に停止。`/usr/bin/chromium`も許可付き起動を含め `socket() failed: Operation not permitted` で停止した。実UI描画・実キーボード/native dialog・タッチ・高倍率・WebRTC/回線・保存媒体は未検証。VM成功を実画面成功として扱わない。試験中のスクリーンショットは作成されていない。

## 公開範囲

製品変更は `prototype/online/ui.js` と `ui.css` のみ。game.js、transport.js、保存schema、main、正式公開版、gh-pages、Siteへはこの作業で書き込んでいない。#214/試験Siteへの統合・配備は親担当が行う。
