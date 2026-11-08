# #212 実装と検証の記録

## 判定

①の操作分離から⑤の切断・計測までのコードは実装した。このクラウド環境では実WebRTC対戦へ接続できず、実通信の自動検証は未完了。一方、オーナーから前版のpublic PeerServer・file://・1台2窓で2人対戦を最後まで遊べた報告を受けている（オーナーの試遊結果であり、この環境の実測ではない）。mainへマージしない。通信代替の試験を実WebRTCの成功と扱わない。

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

## 2026-11-08 追加修正の途中記録（#214）

オーナー報告：1台のPC・2窓、public PeerServer、file://で2人対戦が最後まで動いた。これはオーナーによる前版の確認であり、以下の改修後・別PC/別回線の確認とは区別する。

- ホストが全員準備後の開始時刻を配り、時計差を補正して3→2→1を表示。基準mainの通常出撃には数秒のカウントダウン実装が無かったため、既存アナウンス欄の見た目を利用。カウントダウン中はシミュレーションを進めない。
- 終了時はオンライン窓を開かず表彰・結果を表示。「オンラインへ戻る」を押して旧部屋から退出し、新しい部屋の作成/参加へ戻る。
- 移動音のイベント複製で停止用参照を持たないboostLoopが残っていた。歩行/ブーストの重複イベントを除外し、音源プールまで含め終了・退出時に停止する。
- 同期は共通基準から独立復元できる差分、cm単位の位置/速度と1/1000radの角度、varint/base64化。不変項目は初期基準と変更時のみ。10秒ごとの基準更新も変化値だけ。間引かれた直前snapshotに依存しない。基準再取得時は最後のdeltaを保持して、試合終了も再適用する。
- 入室にはホストの明示許可が必要。申告名は未認証としてテキスト表示し、ゲーム本体のHTMLに流さない。拒否とロビー退出ボタンを追加。未許可者への初期/基準/差分/試合/event送受信を通信層で遮断。待機8件・180秒、許可済み3ゲストまで。通信規格v3で旧方式を拒否する。TURNは追加しない。

短い通信代替試験では34項目成功。カウントダウン、許可/拒否/退出/再申請、結果UI、fake音ノードの停止、装備・再出撃・施設、間引き、基準欠落、最後のdeltaだけでの終了復旧を含む。実音を人間が聴いた確認ではない。Node codec/transport回帰も成功。

短期のsnapshotサイズ（JSON envelope込み、基準メッセージとeventは別）：

| 機数 | 従来の完全snapshot | compact平均 | compact最大 |
|---|---:|---:|---:|
| 10 | 23,731 bytes | 1,032.9 bytes | 1,111 bytes |
| 20 | 46,655 bytes | 1,718.7 bytes | 1,903 bytes |

これは短い試験での値であり、全試合の最大2KB以下をまだ保証しない。初期基準一本化、長時間回帰、追加の部屋設定/陣営UIは続行中。

### 外部スクリプトのSRI

実際のURLから取得した応答本体をSHA-384で計算し、integrityとcrossorigin="anonymous"を追加した。両CDNは Origin:null に対し Access-Control-Allow-Origin:* を返した。同梱three.jsとnpm PeerJSのバイトも同じハッシュだった。

- three.js r128（603,445 bytes）：`sha384-CI3ELBVUz9XQO+97x6nwMDPosPR5XvsxW2ua7N1Xeygeh1IxtgqtCkGfQY9WWdHu`
- PeerJS 1.5.5（86,948 bytes）：`sha384-x0YgkOr/3UOZP2CRDxGW9e0Q+2Qjyr3uJrm4xU32Y7ZCNAo7Cc7bjhrZMi/dwczu`

再計算方法（URLはindex.htmlと同一、結果の先頭にsha384-を付ける）：

```sh
curl -fsSL 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js' | openssl dgst -sha384 -binary | openssl base64 -A
curl -fsSL 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js' | openssl dgst -sha384 -binary | openssl base64 -A
```

`tools/test/sri_check.js` は実配信バイトとハッシュ/CORSを検査する。この環境のChromiumからCDNへの直接接続はERR_EMPTY_RESPONSEだったため、その部分は未検証。同じ実取得バイトと応答CORSを再現する `--cached-response` では、file://で正しいSRIの両スクリプト実行・誤ったSRIの実行拒否を確認し14項目成功。CDNへのブラウザ直結成功とは扱わない。

ローカルdbg試験は同梱ファイルを使うため外部CDN用SRI/CORS属性を除外する。製品index.htmlの属性は残し、別のSRI試験で検証する。

### 部屋設定の追加（通信規格v4）

- 人間定員2〜4、片軍2〜10（空席Bot）、通常コア戦10マップとランダム、ランダム/希望所属、ホストのシャッフルを追加。
- ランダムマップは作成/その設定への変更時に一度抽選し、ロビーとprepareで同じマップを共有。人数変更や出撃では再抽選しない。
- 所属はグループA/B、自軍青/敵橙は各画面の相対表示。希望方式は2行クリック、ランダム方式は1行。希望先満員、既存参加者を収容できない縮小、開始後変更を拒否。
- 人間20人の実接続は対象外。20機は人間+Botの合計上限。通信量の19ゲスト換算は容量試験ではない。
- Node room/codec/transport回帰は成功。通常マップ除外、定員、満員所属、縮小拒否、shuffle、random一度抽選、ゲスト権限、開始後変更、旧v3拒否、移動施設のcodecを確認。
- ブラウザ/全試合の最終結果は後続欄に記す。ソフトウェア描画・通信代替の結果を実PC/異なる回線での快適さと混同しない。

### v4 最終回帰と圧縮目標の判定

- `online_check.js --mock-transport`：40項目成功。2人/4人それぞれ300秒試合を完走、最終コア一致、主武器/ロケット、準備時間差、版拒否、途中参加拒否、切断/入力途絶のBot引継ぎ、ホスト終了。ブラウザエラーなし。固定コマ・描画省略の通信代替試験。
- `online_room_check.js --mock-transport`：18項目成功。4人2対2、定員/所属満員、縮小拒否、ゲスト改竄無視、shuffle、random共有、希望行クリック、非mesaマップ、両陣営自軍青、移動施設同期。ブラウザエラーなし。
- 人間2・10機・300秒試合：snapshot平均1869.8B、最大3,128B（送信1,337通、全接続合計）。初期prepareは1接続65,148B。snapshotBaseは全接続14通・計508,202B、最大61,821B。
- 人間4・10機・300秒試合：snapshot平均1743.5B、最大2,912B（送信6,999通、全接続合計）。初期prepareは1接続65,186B。snapshotBaseは全接続63通・計1,755,585B、最大61,603B。

**全ての写真を2,000B以下にする目標は未達**。平均は2KB未満だが、戦闘中最大は2.9〜3.1KB。短期の1KB程度の値だけで目標達成とは扱わない。比較元の完全JSONは10機23,731B/20機46,655B。初期基準（約65KB/10機）と途中基準更新、イベントは差分写真の平均・最大に含めず上に別記した。静的値を送らないことと、初期送信も2KBになることは別である。WebRTC暗号化/再送/ネットワークヘッダーはこれらの数に含まない。

- `online_revision_check.js --mock-transport`：36項目成功。承認前秘匿/拒否→再試行/許可/キック、両側3/2/1、スナップショット間引き、装備/再出撃/施設、基準欠落/最終終了delta復旧、結果復帰、ループ音停止、初期基準の一回送信を確認。擬似Audioによる停止検査で実際の聴感試験ではない。
- 同回帰の短期サイズ（移動施設情報を含む最新版）：10機は完全24,381B→差分平均1,072.8B/最大1,127B（22枚）、20機は47,415B→平均1,824.3B/最大1,923B（28枚）。初期prepareは10機65,156B、20機129,567Bを各1通、開始時snapshotBase重複送信0。
- 人間20人の概算更新：20機の短期差分平均1,824.3B × 20Hz × 19ゲスト = 約693KB/秒（約5.55Mbps、ホスト送信）。これはsnapshotだけの目安で、19人分のack増加、イベント、基準更新、再送/暗号化/ヘッダー、20人特有の弾数増加は別。20人をつないだ実測ではなく、全試合の最大帯域や回線推奨値として使わない。
- 予約開始の自動試験では両側3/2/1を表示し、開始時計差補正後の実行コマ差は56.45ms。予約時刻前の開始は無し。同じ時刻の予約であり、描画負荷/ブラウザのコマ刻みによる厳密な同時描画は保証しない。

オーナー追加指示：2KBは必須ではなく、上記の平均1.7〜1.9KB/最大約3KBで十分との確認を受けたため、追加圧縮は行わない。非再送の経路と遠方の送信頻度低下は次段階で、今回の実装には含めない。最大写真の内容内訳は専用採取で追記する。

`quick_check.js origin/main` は成功（カスタマイズ一覧、city/dockの各60秒Bot戦を含む）。
