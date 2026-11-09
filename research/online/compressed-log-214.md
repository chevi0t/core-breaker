# 診断ログ全体を可逆圧縮（#214、2026-11-09）

## 変更前・変更後

「人間が読める必要はなく、最大圧縮」という指定に合わせ、人間向け要約を廃止した。**F8は保持中の全接続・全標本・全イベント・試合/切断境界を可逆圧縮してコピー**する。要約・間引き・追加丸めはしない。以前と同じ許可リスト済みschema1のみを使い、IP・部屋/参加者ID・名前・チャット・SDP・生エラーを含めない。保存形式・保持上限は変更しない。

圧縮データをこのdotへそのまま貼れば、同梱の復元器で元の時系列を解析できる。改行されてもよいが、CBL2から末尾まで欠けずに必要。圧縮は暗号化ではないため、内容を確認したい場合はプレビューの「詳細を表示」を使う。

- 通常のF8は全保持データ。プレビュー中のF8/内容コピーは表示している固定内容（圧縮か詳細）。詳細保存はどちらの表示中でも同じ時点の従来テキスト。
- 圧縮失敗やコピー上限超過で黙って削らない。旧クリップボードを貼らない案内を出し、詳細の確認/保存を残す。
- 詳細と圧縮は単一snapshotから作り、7日期限をまたいでも別の記録にならない。
- 自動送信/掲示板投稿なし。部屋IDコピーとは別。入力欄・IME・修飾キー・長押し・処理中の再入力を除外する。

## 圧縮の形式

`CBL2.D.<展開バイト数をbase36>.<CRC32の小文字hex8桁>.<paddingなしbase64url>`

Dはraw DEFLATE。展開結果はUTF-8 JSON `['CBP1', encoded]`。CBP1はschema1の固定列配列で、項目順はgame.jsとtools/diagnostic_log_format.pyのSCHEMAで定義する。固定項目は全て必須。可変counterのnullはキー欠落、0は存在する0を表す。それ以外のnullは未取得値として保持する。型・値・全配列順・全境界・dropped件数が復元後に一致する。

fflateの設定可能な最大level 9を使用する。ブラウザ標準CompressionStreamに依存せず同期で圧縮し、F8のユーザー操作中にclipboardを呼ぶ。未対応APIのfallbackも同じ実装/形式になり、追加CDNや通信は不要。小ささはデータと実装で変わり、全圧縮方式での絶対最小を保証するものではない。Node zlib9/標準CompressionStreamとの比較は下表。同期処理のため最大近辺のログでは一時的なフレーム遅延が生じ得る。

## 容量の比較

実Recorderから生成した決定的な**合成例**。ユーザーが貼った原文や実回線の計測値ではない。従来詳細は説明/整形/改行込みの文字数、圧縮はヘッダー込みASCII文字数。全時系列を復元して一致を検査した。

| 条件 | 従来詳細文字数 | 保存JSON bytes | 圧縮文字数 | 計測時の同期処理 ms |
|---|---:|---:|---:|---:|
| 1名ロビー | 37,735 | 17,610 | 402 | 7.66 |
| 試合中 | 21,026 | 9,681 | 403 | 4.14 |
| 切断 | 14,425 | 6,731 | 419 | 5.86 |
| 異常→回復 | 11,270 | 5,091 | 486 | 2.00 |
| 3接続・保存上限付近 | 1,003,724 | 522,719 | 57,916 | 135.06 |

処理時間はこのNode/VM環境の単発値であり、実ブラウザ・他端末の保証ではない。上限付近例は保持標本61/82/82件、droppedSamples21/0/0を含む。この21件は元の保存上限で失われており圧縮による欠落ではない。

同じ固定列配列の圧縮本体bytes（base64url/ヘッダー前）:

| 条件 | 同梱同期DEFLATE9 | Node zlib raw9 | gzip9 | zlib wrapper9 | Node標準API raw | 標準API gzip |
|---|---:|---:|---:|---:|---:|---:|
| 1名ロビー | 286 | 280 | 298 | 286 | 281 | 299 |
| 試合中 | 287 | 277 | 295 | 283 | 277 | 295 |
| 切断 | 299 | 292 | 310 | 298 | 292 | 310 |
| 異常→回復 | 349 | 336 | 354 | 342 | 338 | 356 |
| 3接続・保存上限付近 | 43,421 | 39,505 | 39,523 | 39,511 | 40,750 | 40,768 |

raw形式は同じ圧縮本体にgzip/zlibの外枠を付けるより小さい。Node zlib9は同期同梱実装より小さくなる例があるがブラウザの同期APIでは使えない。標準CompressionStreamは非同期でlevel指定がなく、後からwriteTextするとブラウザ次第でユーザー操作の有効期間を失うため、製品のF8では同期実装を採用した。将来の再比較は同じ固定例・同じデータで行う。

## 安全な復元

```sh
python3 tools/decode_diagnostic_log.py compressed.txt --output restored.json
# 標準入力を使う場合
python3 tools/decode_diagnostic_log.py - --output restored.json
```

標準Pythonのzlibだけを使い、ネットワークやeval等は使わない。出力はcompact JSON、既存ファイルは上書きしない。必要な情報は元のキーで取り出せる。startedAtはUTC epoch milliseconds、elapsedMsは接続開始からの経過時間。JSONの詳細な測定定義は既存の診断ログ説明と同じで、回線全体の帯域やパケット損失率を示すものではない。

- 入力256KiB＋許容空白8KiB、空白を除くトークン256KiB、展開512KiB、復元JSON512KiB。
- 厳格なbase64url/形式版/サイズ/CRC/EOF/余剰データ検査。連結圧縮stream、展開爆弾、打切り、未知キー、不正コード/型、非有限値、過大配列、深い構造を拒否する。
- 復元側は3接続・300標本・128イベントを検査。受け取った過去ログの7日期限切れ削除はしない。収集側の上限/期限で既に失った内容は復元できず、droppedSamples/droppedEventsを確認する。3接続より古いものやクラッシュ直前の未保存分は元から入っていない。
- **CRCは誤貼付/破損検査。暗号化・署名・改ざん防止ではない。** CRCを再計算して妥当な数値へ変更した人の偽装は検出できず、本人確認や原因の断定には使わない。この限界もテストしている。

## 圧縮ライブラリの出典・再生成

fflate 0.8.3、Arjun Barrett氏、MIT。優れた同期圧縮実装に感謝します。公式固定commit:
https://github.com/101arrowz/fflate/tree/dcb3714a6c25db3a2748641019c5277413d09714

同commitのsrc/index.tsをNode 24.22.1のstripTypeScriptTypesで変換し、同期DEFLATE/CRCの依存定義だけを抽出。アルゴリズム本文は変更しない。Worker/ZIP/通信/展開機能は同梱しない。ライセンス全文はgame.jsの同梱箇所に保持する。

- src/index.ts SHA-256: `1addfe34aa01d4998853dc5cf2430df14e294889d1ae7420341103eb5b1c2720`
- LICENSE SHA-256: `766daa9b2ab0ab2698c769f334a6d72c42437b0a7d0d0dfd5c13c64b3120117b`
- `node tools/test/build_diagnostic_deflate.js /path/to/index.ts /path/to/LICENSE --check` で公式ソースのhashと同梱一致を確認。取得は公式固定commitから行い、生成器自身はダウンロードしない。

## 検証と残り

- 最終オンラインNode/VM回帰79テスト成功。圧縮8テスト、診断UI15テストを含む。JS→標準zlib→Pythonの完全往復、上限付近3接続、null/0/欠落、全時系列/境界、未知値拒否、固定プレビュー、非同期通知競合、圧縮失敗時の詳細保存を検査。
- Python安全性試験はNode回帰から実行し、正常/改行/独立zlib圧縮、破損/過大/型違い等の拒否、再計算CRCの限界、出力非上書きを確認。
- 秘匿境界154項目、名前14ファイル、静的配布24項目、構文/diff検査、dbg生成、同梱圧縮コードの再生成一致が成功。
- F8/詳細ログ/quick_checkは指定Chromium未配置で起動前停止。前段と同じ環境で実ブラウザ・実clipboard権限/書込み/貼付・実保存・実pointer lock・OS/Fnキー・実WebRTCは未確認。VMのclipboardやBlob代役を実端末成功とは扱わない。
- #214はdraft維持。main・#220・gh-pages・正式公開版・テストSiteはこの担当では変更しない。Siteは確定headへ別途更新が必要。

再実行:

```sh
python3 tools/test/make_dbg.py dbg
node --test tools/test/online_*.test.js
node tools/test/online_diagnostic_compression_fixtures.js
node tools/test/online_visibility_check.js --node-only
node tools/test/names_check.js
python3 tools/test/distribution_check.py
node tools/test/online_log_shortcut_check.js dbg /tmp/compressed-f8 --mock-transport
node tools/test/online_diagnostic_log_check.js dbg /tmp/compressed-detail --mock-transport
node tools/test/quick_check.js origin/main
```

実端末では同じ版を両画面へ読み直し、ロビー/試合/切断後にF8→テキストエディター貼付→復元で役割・各時系列を確認する。詳細切替後のF8、圧縮表示中の詳細保存、許可拒否時の手動コピーも検査。コピー失敗時は以前のクリップボードを掲示板へ貼らない。
