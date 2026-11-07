# #212 実装と検証の記録

## 判定

①の操作分離から⑤の切断・計測までのコードは実装した。実WebRTC対戦は接続できず、完成したオンライン対戦としての検証は未完了。mainへマージしない。通信代替の試験を実WebRTCの成功と扱わない。

## 通信代替の機能試験

製品コード `372945e` に対して `online_check.js --mock-transport` が33項目成功。2人/4人＋Botの10機で300秒の試合終了、移動・ライフル命中・ロケット、ゲストで独立計算しないこと、版不一致、途中参加拒否、通常切断時の状態保持Bot移譲、通信を保って入力だけ停止した場合の当該ゲスト終了、他ゲスト継続、ホスト終了を確認。ブラウザエラーなし。詳細は `functional-check.json`。

入力途絶時に対象の通信を残してしまう点と、Botへ人間のしゃがみ/ブースト抑止/ロック保持が残る点は独立レビューで見つけ、修正してからこの試験を実行した。

## 最終回帰と準備差の追加確認

- `quick_check.js origin/main`：成功（基準 main は `fb371d4`）。
- `weapons_check.js dbg`：全武器を実行し終了コード0、ブラウザエラー配列は空。
- `bot_battle.js dbg city,wide,mesa,dock 150`：4マップすべてエラーなし。実際の出力はcity 151秒、wide 150秒、mesa 160秒。dockは62秒で赤コア0の決着。
- `online_check.js --mock-transport --connections-only`：準備に3.5秒差を付けたケースを追加して15項目成功。先にreadyを送ったゲストの3秒入力期限を、全員の試合開始時に更新する修正を検証。両人の操作権と受信/適用入力番号の進行を確認。`connection-regression.json` に記録。
- `online_transport.test.js`、名前重複検査、変更JavaScriptの構文検査、`git diff --check`：成功。
- GitHubのPRトリガーworkflow/commit statusは `b70512a` 時点で登録なし。ローカル試験結果とCI成功を混同しない。

機体形状試験は**全体として未完了**。6,561組合せ・32,805発の数値検査は成功したが、続く画像用 `page.evaluate`（`mech_shapes_check.js:116`）が返らない。最初はブラウザ終了、単独再試行では240秒で打切り。

比較用の**未変更 origin/main** のHTMLでも同じ数値検査まで成功し、同じ116行でブラウザがSIGKILLされ終了コード1になった。今回の変更だけで起きる現象ではないことは確認したが、SIGKILLの原因をOOM等と断定はしていない。画像確認を通過済みとは扱わず、別の安定した実行環境での再試験を残す。

## 描画付き予備計測

`load-preliminary.json` は `30159d7` の10/20機×2/4人、各30秒＋準備5秒。可変dt・描画あり・同一クラウド内の複数Chromiumページ・SwiftShader・BroadcastChannel代替通信。ユーザーPCの性能ではない。

| 機数 / 人数 | ホストframe CPU p50 / p95 | frame間隔 p50 | 観測送信量 |
|---|---:|---:|---:|
| 10機 / 2人 | 9.3 / 20.9ms | 333.3ms | 37.4KB/s |
| 10機 / 4人 | 8.4 / 12.9ms | 683.3ms | 53.1KB/s |
| 20機 / 2人 | 11.5 / 17.4ms | 350.0ms | 79.3KB/s |
| 20機 / 4人 | 10.7 / 27.4ms | 666.7ms | 87.1KB/s |

KBは1000バイト。frame間隔は約1〜3FPS相当で、GPU/プロセス間待機をframe CPUだけでは表せない。スパイクもある。30秒の実時間に対しゲームは約2〜4秒しか進まない。この環境の観測帯域を20Hz設計やユーザーPCに外挿しない。

## 20人時の送信量概算

`bandwidth-preliminary.json`：20機状態の終了時1枚は46,903バイト（ゲーム用envelope込み）。19ゲスト用のcontroller/入力ackを補った仮の20人状態は47,228バイト。

47,228バイト × 20Hz × 19接続 = 17,946,640バイト/秒 ≒ **17.95MB/s、143.6Mbps**（ホスト送信合計）。

これはsnapshotだけ。イベント、暗号化、通信ヘッダー、再送は加算される。弾0発の1枚を採った概算で、試合全体の平均/最大や19接続のCPU/回線成立を保証しない。同じ予備計測の低FPS観測量を19倍した1.26MB/sとは区別する。

全状態JSON方式のまま20人に拡張する前に差分送信・数値量子化・更新頻度などを改めて検討する必要がある。今回の実装上限は指定の人間2〜4人のまま。

## 実通信・操作感の未確認事項

実PeerJS＋ローカルPeerServerの試験は接続タイムアウトで失敗。前の診断でもICE候補が得られず、STUNのみで対戦接続が成立していない。版不一致の試験を単なる接続失敗で成功扱いしない。

別PC・別回線、Edge/Firefox、NATの組み合わせ、人間20人の接続、実GPU/実ユーザーPC負荷、人間による主観的操作感は未実施。TURNやホスト交代、予測処理を勝手に追加して回避していない。

## 人工遅延の予備計測

`latency-preliminary.json`：片道0/50/100msを両端の送信側に設定し、各5回。前方の水平変位だけを移動として検出し、落下を移動に数えない。Bot AIはこの試験だけ停止。測定は入力投入からゲストRAF上の確定状態変化までで、ディスプレイ発光時刻ではない。

| 人工片道遅延 | 入力→自機移動 p50 / p95 | 射撃→標的HP表示 p50 / p95 |
|---|---:|---:|
| 0ms | 1128.7 / 1197.6ms | 1711.6 / 2089.9ms |
| 50ms | 1158.6 / 1458.1ms | 1829.5 / 1889.8ms |
| 100ms | 836.8 / 1465.3ms | 1225.3 / 1607.3ms |

全条件で5回ずつ測定でき、タイムアウト・ブラウザエラーなし。ただし通信代替と低FPS描画・実行待ちが支配的で、50msと100msの優劣や通常PCの実際の操作感を判断できない。100ms条件が短い数字になったことを改善とは扱わない。p95は5件を並べた補間なしの標本値で、母集団の95パーセンタイルを精密に推定した値ではない。

人間の主観的試遊は未実施。設計上は先読みなしなので入力が往復してから機体と命中が見えるため、人工遅延だけでも往復100/200msに送信周期・処理・描画待ちが加わる。これは設計からの予想であり、人間が試した所感ではない。実PCで実WebRTCが成立してから同じコマンドと人間の試遊を行う必要がある。

## 判定の使用関数一覧（prototype/index.html）

- `isHumanControlled`：`clearPath`, `walkClearPath`, `zipRide`, `mechPose`, `startTransfer`, `cancelTransfer`, `doTransfer`, `jolt`, `kill`, `wreck`, `downTick`, `baseDefenseTask`, `raidGoal`, `gadgetUpdate`, `equip`, `missileLockTick`, `missileGunTick`, `gunTick`, `shot`, `swordTick`, `weaponLook`, `reflectorTick`, `qchatSend`, `gameFrame`
- `isLocalView`：`destroyRadar`, `destroyTurret`, `bladeWaveTick`, `stunFieldUpdate`, `blast`, `damageBarricade`, `boosterFlameUpdate`, `humanLockTarget`, `spawn`, `doTransfer`, `fire`, `damage`, `kill`, `wreck`, `downTick`, `revive`, `addScore`, `boardHtml`, `medalsHtml`, `equip`, `selectWeapon`, `missileLockTick`, `seekerFlight`, `setSeekMode`, `iaiPathCut`, `slashSweep`, `bladeSweep`, `stopArtillery`, `cloakHit`, `qchatSend`, `updateHumanUnit`, `updatePlayerName`, `drawMapOn`, `setup`, `finish`, `gameFrame`
- `isSimulationAuthority`：`selectWeapon`, `updateHumanUnit`, `pickClass`, `gameFrame`
