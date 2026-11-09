# F8で端末内の診断ログをコピー（#214、2026-11-09）

## 変更前・変更後

変更前はロビー・結果・メニューから診断プレビューを開き、コピーをクリックする必要があった。今回、ホスト/ゲスト共通で **F8単独** による直接コピーを追加した。既存のコピー・テキスト保存も残す。

- 通常は押した時点の最新の端末内ログ。プレビュー中は表示時点の固定本文。本文の `sessions[].role` でhost/guestを区別できる。
- F2（コンソール）、F3（診断表示）、戦闘/定型通信キーと分ける。入力欄・IME変換中・修飾キー付きのF8は対象外。長押しや処理中の連打で書込みを重ねない。
- コピー処理の成功/失敗は画面上に通知するだけで、試合・pointer lock・フォーカスを変えない。成功を確認してから共有先へ貼り付ける。
- HTTPS・ブラウザ許可・ファイル起動等の制約で失敗した時は、**以前のクリップボード内容を貼り付けない**と明記。Esc→計測設定→診断ログを確認、またはメニューの診断ログを見る→手動コピー/テキスト保存へ進める。プレビューでの失敗は本文を選択する。
- メニュー、結果ボタン、計測設定、F3表示、診断ダイアログへF8の説明を追加。入力欄にフォーカスしている時は既存のコピーボタンを使う。

## 安全性と変更範囲

既存の許可リストを通る `logs.preview()` のみをコピーする。Recorder、通信方式、保存形式、IP・部屋/参加者ID・名前・チャット・SDP・生エラーの除外条件は未変更。失敗例外の本文も表示・記録しない。部屋IDのコピーボタンとは別で、サーバー送信や掲示板への自動投稿は追加しない。

コピー中にプレビューを開閉/消去した場合、古い非同期処理の完了で新しい画面へ誤った通知を出さない。通知の古いタイマーで新しい通知を消さない。

#214の9aeb4d5を基点とする独立ブランチで変更。main、#220、gh-pages、正式公開版、試験Site、保護された配布生成器は変更していない。

## 確かめたこと

- `node --test tools/test/online_*.test.js`：68テスト成功、失敗/skip/TODOなし。既存のReady・全装備・秘匿・定型通信を含む。
- 診断UIは12テスト（うち追加9件）。F8の最新/固定本文、長押し/連打、入力欄/IME/修飾キー、blur/非表示、成功/拒否/API欠落、ログなし/消去、古い非同期完了、実Recorderによるhost/guest両役割の機密除外を確認。
- `online_visibility_check.js --node-only`：154項目成功。名前検査14ファイル、配布物の静的検査24項目、JS構文、`git diff --check`、dbg生成も成功。
- 独立レビューで、ブラウザ試験のdisabled入力欄を修正。実際にフォーカスできる部屋ID欄とactiveElementを確認するようにした。pointer lockも前後比較だけでなく、試験前に取得を必須にした。

## ブラウザ試験と未確認範囲

`online_log_shortcut_check.js` と `quick_check.js` を試行したが、この環境ではPlaywright指定のChromium headless shellが未配置のため、**ブラウザ起動前に停止**した。Node/VMでの成功を実画面・実入力・実clipboard・実WebRTCの成功とは扱わない。画面レイアウト、OSのFnキー/ブラウザ・拡張機能との競合、実際の権限要求と書込み、別回線での動作は未確認。

新ブラウザ試験は製品の2画面UIでロビーと試合のF8、W保持と解放、実pointer lockの取得/保持、F3/Vとの共存、機密除外、拒否通知、PC/小画面、手動コピーへの導線、入力欄を検査する。clipboardはspy、`--mock-transport`使用時はBroadcastChannelなので、成功しても実clipboard権限・実WebRTCの確認にはならない。

再実行：

```sh
python3 tools/test/make_dbg.py dbg
node --test tools/test/online_*.test.js
node tools/test/online_log_shortcut_check.js dbg /tmp/online-log-copy --mock-transport
node tools/test/online_diagnostic_log_check.js dbg /tmp/online-diagnostic --mock-transport
node tools/test/quick_check.js origin/main
```

実端末の受入では、固定した同じ版を両画面で読み直し、ホスト/ゲストそれぞれF8→テキストエディターへ貼付→役割と本文を確認する。入力欄にフォーカスしたままでは押さない。許可拒否とファイル起動でも、成功を誤表示せず手動保存へ進めることを確認する。掲示板へは内容を見てから手動で送る。
