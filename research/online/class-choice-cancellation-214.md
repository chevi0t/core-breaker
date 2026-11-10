# オンライン兵装予約の自動取消と遅着

## 基準と変更前

PR #214の `ab5c0cebc343dcf5964f8a0de27595562383d92f` を基準にした限定修正。
テストSiteはv24、ソース `850e8313aa5aa1728ca5c11a325efc37d8d6b8ff` が配備済みであることを確認した。この作業はSite、GitHub、main、gh-pages、Claude担当の#220/#221とキルログを変更していない。

変更前の既存two-sided試験は13件中11件成功、既知失敗2件だった。ホストの自動転送取消後、取消写真が届いても、欠けても、手元に残った兵装を後の死亡時に再採用できた。

初期候補では明示選択の番号と専用ACKを追加し38件が成功したが、独立試験で別の遅着を再現した。転送Aの最初の兵装選択が転送Bで初めて届くと、phaseとlagEpochが同じなので採用される。専用ACKだけでは未受信の古い選択を区別できなかった。

## 変更後

- 明示選択のたびに番号を進め、同じ予約の再送は番号を変えない。専用ACKまでは地点更新にも予約を載せ、通常入力の累積ACKで消さない。
- ホストは番号を一度だけ評価し、取消・不適切な局面・生命境界で退役させる。現在の予約とACKは自機の公開枠だけへ送り、他機/秘匿枠にはnullを載せる。
- 転送の開始H操作番号へ選択を結び付ける。Hの実行を待つ選択は最新1件だけ保留する。成功したH実行後に採用し、取消・開始失敗・失効Hでは退役させる。H以外の開始はホストの転送世代で区別する。
- H取消→再開後、まだ写真が来ない間に選んだ新予約を保つ。古い取消ACKは新しい番号を消せない。死亡→蘇生→再死亡は既存lagEpochで区別する。
- 再接続後の操作番号をホストの処理済Hより先に進め、以前のH番号を別の転送へ再利用しない。
- 互換印 `class-choice-1` を追加。双方の更新が必要。transport v9、codec、移動/照準世代、性能値は変えない。

既存の出撃先再送、H/F、武器・移動、4兵装の保存構成、開始取消、可視基準修正を保持する。自動取消の仕様を変更するのではなく、既に取り消された予約の再採用を防ぐ。

## 試験

実行コマンド:

- `node --test --test-concurrency=1 tools/test/online*.test.js`
- `node tools/test/names_check.js`
- `python3 tools/test/distribution_check.py`
- `python3 tools/test/make_dbg.py dbg`
- `node tools/test/quick_check.js origin/main`
- `node tools/test/bot_battle.js dbg city,wide,mesa,dock 150`

結果:

- 全オンラインNode/VM回帰222/222。失敗・skip・TODOなし（最終コード、約63秒）。
- two-sided兵装選択38/38。既知失敗として除外する条件は0。
- 因果関係16/16。H実行前の保留、最新選択の優先、H取消/開始失敗/期限切れ、再接続、旧H番号、累積ACK、実advanceRemoteCommandsの実行/退役/再実行防止を含む。
- 既存の装備組合せ128/128、出撃先19/19。
- 独立レビュー41/41（上記two-sided38件＋実scheduler3件）。最終レビューで追加ブロッカーなし。
- 名前14ファイル、配布物静的検査24項目、indexのinline scriptとgame.js構文、diff検査、dbg生成成功。

既存fixtureは新しい自機専用データを正しく指定するよう更新した。cameraとpredictionでown指定を追加し、可視性fixtureへ兵装表を渡した。旧形式の手書き兵装入力には新しい予約番号を追加した。新しいsnapshot検証を緩めて旧fixtureを通す変更はしていない。

拡張試験の「新転送写真前の新選択」2件は、ホストのstartTransferを直接呼ぶ代わりに、実際の操作に対応する送信済Hで開始する。写真到着前に選んだ予約と、順序どおり遅着する旧取消写真の順序は維持した。Hなしで古い転送画面から送った未受信予約は別の否定試験で拒否を確認する。

## 未確認と公開状態

quick_checkと4マップBot戦はPlaywright指定Chromiumがなく、ブラウザ起動前に停止。代替のシステムChromiumも `socket() failed: Operation not permitted` で起動できなかった。実ブラウザのコンソール/描画/キー入力、実WebRTC、実回線、操作感は未確認。

Node試験は実sender/receiver・snapshot codec・H/転送/再出撃の本体を使うが、描画、地形、物理、時刻、通信配送にはfixtureがある。後半3件と独立試験は実移動schedulerを通し、移動物理そのものは代役。成功数は実端末の受入結果ではない。

配布物は作り直しておらず、push、merge、Site保存/配備は未実施。公開前に同じ修正を最新Siteソースへ統合し、版表示/cache key/資材hashを更新して、その正確なソースを再検証する必要がある。

最終製品SHA-256: `prototype/online/game.js` は `aa72f74278c78f6424a9612023931e8e1802f679cecd9bfa309683e33c2d5335`、`prototype/index.html` は `37424496b414175063a8c83bf0adfea9a1339db2195e0abe995ce07935f3f9b6`。
