# 写真の秘匿・他機武器枠・固定施設の削減（#214、2026-11-09）

## 変更前と変更後

基点は `8b49cebc`（全4兵装統合）。main、transport、ACK履歴、base64/binary処理は変更しない。#214はdraftのまま。

- 以前は不可視機体の非公開項目をすべて空値へ書き換えて差分送信していた。codec v2では通常差分・定期基準patchに識別子、hidden、公開epochだけを載せ、復元時にschemaから位置・装備等を中立化する。最初のhideを失っても次の写真だけで消去できる。完全基準は現在の中立値から生成する。初回schemaは依然として固定枠を列挙する。
- 自機は従来どおり全武器枠状態。他機は全4枠key、補助のchargeT/sheathed、特別のheat/overheat、各枠scanRadiusへ絞る。近接の構え/発光、納刀、盾、索敵波を保持。swing、beam/reflect、背部砲照準、scope、ミサイル捕捉警告は既存の状態を保持する。
- 固定施設4種類は一覧丸ごとでなく施設番号/項目ごとの差分。owner/capturingのnull切替、intrudersの長さ変化もschemaを変えない。施設yawは従来の角度値のまま丸める。
- 受信契約が変わるためcodecをv2へ上げ、appVersionに `snapshot-payload-1` を追加。旧版は入室時/codec復号時に拒否する。両ブラウザの再読込が必要。

## 前後比較の条件

`online_snapshot_check.js --fixtures` を追加し、**製品のsnapshot構築・ゲスト別公開判定・codec** をNodeで前後実行した。前版も同じfixtureから読み込む。10機・4兵装、5プラント/4砲台/2レーダー/8バリケード。各場面30コマwarmup後240コマを2回、2回目は前後の実行順を逆にし、計480枚/版。時間30ms刻み、全機更新。ACK履歴は両版で毎回8step更新し、差分内のinputAcksは両版とも平均1,009.8125 B。ACK削減の効果は混ぜていない。

表の送信量は `{frame,delta}` のJSON UTF8量。transport envelope、断片、回線ヘッダー、再送を含まない。CPUはNode内のsnapshot構築+公開判定+encodeとdecodeの時間。**固定入力の局所比較であり、Bot自然戦、実WebRTC帯域、描画FPS、敵の実画面の動き、操作感の測定ではない。** 製品コードのハッシュ、p95/max、二進差分の内訳は [実測JSON](snapshot-payload-fixtures-20261109.json) を参照。

| 場面 | 写真payload平均 B（前→後） | 削減率 | 構築+encode中央値 ms（前→後） | decode中央値 ms（前→後） |
|---|---:|---:|---:|---:|
| 可視基準から敵5機を秘匿 | 4910.6 → 1409.0 | 71.3% | 4.420 → 3.161 | 0.428 → 0.278 |
| 他機9機の射撃枠状態 | 1634.3 → 1394.6 | 14.7% | 4.362 → 3.351 | 0.355 → 0.258 |
| 施設4種類の変化 | 2634.1 → 1420.7 | 46.1% | 4.465 → 3.896 | 0.370 → 0.321 |
| 移動・射撃・施設・見え隠れ | 5511.1 → 1598.5 | 71.0% | 4.144 → 3.098 | 0.401 → 0.263 |

全機可視の初回基準は89,668→58,307 B、schemaは2,241→1,552項目。自然戦初期配置の実送信量とは異なる。

再実行例（比較元checkoutを別に用意する）：

```sh
git worktree add --detach /tmp/core-breaker-before 8b49cebc
node tools/test/online_snapshot_check.js dbg /tmp/snapshot-comparison --fixtures --baseline-root=/tmp/core-breaker-before
```

## 確認

- `online*.test.js` 全28本成功。既存の入力/予測/補間/近接/ロビー/通信回帰も対象。
- `online_visibility_check.js --node-only`：154項目成功。実gameの送信境界、欠落後の秘匿、公開再開/間引き、設置物枠と送信台帳を確認。
- 新規 `online_snapshot_payload.test.js`：秘匿中の値変更がwireへ影響しないこと、最初のhide欠落、定期基準patch、hidden中の別schema更新、基準欠落と完全復旧、再可視化・再出撃、全323武器の他機枠復元、捕捉警告の参照、施設の破壊/復旧/null切替、旧codec拒否を確認。
- `online_equipment.test.js`：全323武器と48設置物の既存往復。fixtureを共有ファイルへ切り出しただけで元の検査は保持。
- `names_check.js`：14ファイル重複なし。`distribution_check.py`：24項目成功。`git diff --check` 成功。

## 未確認と並行変更の注意

ブラウザの `online_snapshot_check` は起動前に停止（Playwright Chromium headless shellが無い）。この環境の既存Chromium起動もsocket権限制限が確認されているため、ブラウザ/実RTC・自然戦の前後比較、quick_check、bot_battle、実画面確認は未完。Node成功をそれらの成功に読み替えない。draftの解除やmainへのマージは行わない。

Claude側のACK履歴削減・binary化とは別変更。codecのflatten/基準patch/復号後中立化とゲーム側の公開選別が本変更の責任範囲で、pack/unpackのbinary化やtransportは変更しない。統合時はcodec v2、appVersion識別子、観測器のbase64前提を整合させ、欠落/再同期と同条件の前後比較を再実行する。
