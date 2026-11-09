# #214 全兵装監査の表示同期2件を修正（2026-11-09）

通信量最適化の head `b7335049b4f7ca926a5f48c354efb84b7647df00` に、[独立監査](equipment-audit-214.md)で再現したA1/A2の修正を追加した。main・公開サイト・配布物は変更しない。実ブラウザ/実回線の受入は未完了。

## 変更前と変更後

- A1：ゲストは展開レーダー3型をすべて90度の扇形で表示していた。ホストと同じ `w.arc` を使い、60度/120度の扇形と360度の全周を使い分ける。索敵判定・半径・性能値は変えない。
- A2：投擲模型は届いても所有者の `postFlight` が復元されず、SP作動判定とHUDが食い違っていた。投擲の写真に公開可能な所有者だけを載せ、ゲストで模型と所有者を結び付ける。所有者が隠れた場合、投擲が消滅/着地した場合、再試合リセット/退出時は旧参照を解除する。新投擲の写真を先に適用してから旧模型を消す場合も、新しい参照を消さない。
- 所有者だけが隠れ、投擲模型は見えている場合は、模型を引き続き描画し所有者参照を送らない。再公開では関連付けを復元し、再秘匿で解除する。ゲストの投擲物理・回復・ダメージ計算は追加しない。

## 試験

監査の4 TODOを通常の回帰へ移し、投擲のライフサイクルと秘匿を追加した。`CB_AUDIT_STRICT` による結果の切替は廃止し、指定の有無によらずすべてのassertを通常の失敗として扱う。通信量最適化で分離された `online_equipment_fixture.js` を利用し、実 `applySnapshot` を試験内だけ公開する。

- 修正前の監査厳格モード：16テスト中12成功・4失敗。A1が3型、A2が1件。
- `CB_AUDIT_STRICT=1 node --test tools/test/online_equipment_audit.test.js`：18テストすべて成功、TODOなし。
- `node --test tools/test/*.test.js`：33ファイル、74テストすべて成功、失敗/skip/TODOなし。
- `node tools/test/names_check.js`：14ファイル、重複キーなし。
- `node --check`：変更した `game.js`、監査試験、共通fixtureで成功。`git diff --check` も成功。
- `python3 tools/test/make_dbg.py dbg`：成功。

追加した投擲回帰では、ホストの実 `postTick` / `postFlightTick` → peer別写真 → 実codec → 別VMの実 `applySnapshot` の経路を使う。前の武器へ戻った時のSP作動、再選択時の実HUD文言分岐、位置更新、着地後の設置状態、回収、寿命切れ、消滅写真を取り逃した再投擲、リセット、退出、敵の可視→秘匿→再公開を確認した。ロブ初速・地面・射線などはfixtureで、GPU描画/実地形の試験ではない。

## ブラウザ確認の制限

- `node tools/test/quick_check.js fb371d4e3ce5b3335880efe074c9bf00db5331be`：新旧dbg生成後、Playwright指定のChromiumが未配置で起動前失敗。参照は監査時に利用したmainコミットであり、最新mainとの比較が完了したという意味ではない。
- `node tools/test/online_equipment_check.js dbg /tmp/core-breaker-equipment-sync-browser --mock-transport`：同じChromium未配置で起動前失敗。
- インストール済み `/usr/bin/chromium` を起動時だけ指定して同試験を再実行：`socket() failed: Operation not permitted (1)`、SIGABRT。製品コードと共通ブラウザ試験の起動設定は変更していない。

実画面のレーダー波、実HUDのDOM/CSS、実入力・実命中・実音・実WebRTC・帯域/CPU・操作感は未確認。Nodeで実行したHUDの分岐や描画関数への引数一致は、ブラウザで見た結果ではない。ここに記載した結果はローカル実行で、GitHub Actionsの結果ではない。
