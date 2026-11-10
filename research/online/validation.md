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

### 最大写真の内容内訳（追加採取、製品の圧縮変更なし）

`online_snapshot_check.js --mock-transport`：8項目成功。対象ec635919、mesa・10機・人間2人は中立入力、Botは通常動作、300秒の自然試合を50ms固定コマで進め、勝敗とゲスト最終状態まで確認。描画省略・通信代替で、実回線20Hzの性能測定ではない。先の武器fixtureを含む40項目回帰とは別試行で、乱数/戦況により平均・最大が変わる。

成功送信snapshotは1,304枚、平均2,001.3B、中央値2,079B、p95 2,716B、最大3,280B。平均も約2.0KBまで振れたため、先の1.7〜1.9KBを固定上限とはしない。

毎回送る差分は直前の写真でなく共通基準からの変更。主に機体の位置/速度/向き/耐久/動作タイマー/武器残量/スコア、弾、施設状態、時計と入力確認を含む。この試行の変更項目数は平均219.2個、base64前の二進差分は平均1,347.3B。名前/装備等が変化した時だけその変更を追加し、消えた項目や基準変更は再同期で整合を保つ。

最大は開始133.9秒時点（残り166.1秒、frame 2678、基準ID10）、10機・飛翔弾2個、262変更項目。以下はbase64前の二進byte数で、項目index差のvarintも該当カテゴリに含める。

- 機体：1,425B、242項目。
- 砲台：249B、1項目。
- プラント：218B、1項目。
- 飛翔弾：214B、1項目。
- レーダー：142B、1項目。
- 移動施設：30B、10項目。
- コア/入力確認/時計/フレーム：計29B、6項目。
- 機体1,425Bのうち、近接動作（swing）2機614B、スロット状態140B、スコア123B、位置72B、速度48B。名前等の静的情報を毎回詰めた結果ではない。

合計は二進差分2,307B + base64増分769B + delta配列外枠9B + 通信envelope195B = 3,280B。全1,304枚でカテゴリ合計と二進長、最大時の外枠込み送信量の一致も確認。

初期同期prepareは65,145Bを1通。中のbaselineは64,850B（schema 58,105B/1,708項目、値6,721B、構造外枠24B）、delta8B、他のprepare項目と通信envelope287B。初期情報の大半は汎用schemaであり、毎回は送らない。途中snapshotBaseは15通・計567,985B、平均37,865.7B/最大61,752B。構造変化時はschemaが必要となるため、通常差分だけで総通信量を説明しない。これらとeventsも専用試験で別々に計上する。

追加圧縮は行わない。非再送経路・遠方の送信頻度低下は今回未実装の次段階。mesa短期Bot戦（30秒）もブラウザエラーなしで終了。

## 次段階①：非再送の写真専用線と自動補間（2026-11-08）

実装は通信規格v5。control（承認/入力/出来事/開始/終了）はreliable ordered、snapshot/snapshotBaseは別PeerJS接続のordered:false/maxRetransmits:0。PeerJS1.5.5の公開reliable:falseだけでは再送0にならないため、写真labelの同期生成時だけ設定を補い、finallyで元に戻す。両接続の同一peer/control ID/承認tokenを照合し、両ready前は試合開始不可。承認前/古いroom・match/逆方向の写真は拒否。

基準は16KiB未満のdatagramへ分割。最大262144B/4組、基準断片10秒・通常写真断片1秒の上限。同じ基準の再同期で足りない片を補えるが、異なる内容は混ぜない。状態と基準は別番号系列で、遅れた親基準と状態の逆戻りを区別する。初期prepareはmetadataだけ、基準/差分が復元できてreadyを返す。最終コア・全員の表彰得点はcontrolのmatchEndedで確定し、最後の写真に依存しない。

### 確認済み

- `online_channel_check.js`：6項目成功。実PeerJS→実RTCPeerConnectionでcontrol ordered=true/maxRetransmits=null、snapshot ordered=false/maxRetransmits=0を観測。正常/例外両方で限定patchを復元し無関係な接続を変えない。PeerServer登録とDataChannel生成の検証であり、ICE/NAT接続成立は未確認。
- `online_transport.test.js`：5%/20%論理損失で100写真中95/80到達、control100件到達。144KB基準へ異なる20%断片損失を2回注入して復旧。逆順・遅着親基準・容量/期限・孤児token・承認前秘匿・両ready・片線切断・経路混入・不正RTC設定を検査。
- `online_interpolation.test.js`：損失/逆順各300秒相当、初期線順序差、基準欠落、backoff、malformed通知拒否、終了写真欠落、300/3900ms連続欠落の復旧追従、lifeId/motionEpochの境界を確認。codec/rooms既存Node回帰も成功。
- `online_loss_check.js --recovery-only --mock-transport`：10項目成功。承認前両線秘匿、片側写真詰まりでもcontrolと他ゲストが進む、基準欠落→再同期、古い写真拒否、最終基準/写真を落としてもcontrol結果へ復旧。
- `online_room_check.js --mock-transport`：18項目成功。部屋設定・希望所属・定員・マップ/移動施設・両陣営の色を維持。
- `online_check.js --connections-only --mock-transport`：15項目成功。版拒否、準備時間差、途中参加、切断/入力途絶/ホスト終了を維持。

### 止まり方の変更前後

`online_loss_check.js --trajectory-only --mock-transport`：13項目成功。製品補間と旧v4の固定100ms/外挿なしを、同じ20Hz写真・60fps描画時計・10m/s直線移動・同一乱数seed214で比較。20秒の受信列に25〜55msの揺れ、時々120ms追加遅延、300ms連続欠落、順序逆転を含めた。開始2秒と再出撃/瞬間移動前後600msは測定から除外。各適用写真の復号位置・lifeId・移動epochと生成源の一致を検査。これは決定的な表示軌跡試験で、実回線や人間の操作感ではない。

- 5%欠落：停止合計316.7→133.3ms、停止5→1回、最大1コマ移動2.526→0.200m。
- 20%欠落：停止合計1166.7→83.3ms、停止19→1回、最大1コマ移動2.526→0.200m。
- 両条件で逆方向移動0、外挿最大100ms。目標補間待ちは60〜200ms（平均110.4/153.3ms）。

300ms連続欠落では停止自体は残る。表示時計も最新写真+100msで止め、復旧後は最大1.2倍速で追いつくため、欠落分を一度に飛ばさない。この代わりに推定された表示遅れ（最小到着時刻差を基準とするeffectiveDelayMs）は一時的に目標200msを超え、両条件最大241.6ms。回線の片道遅延込みの総遅延を実測した値ではない。追加の復旧遅れ最大135.3/100.5msを別計測した。60〜200msを障害中の実遅延上限とは主張しない。catchupFramesは通常のバッファ縮小も含む「実時間より速く描画時計を進めたコマ数」で、欠落復旧だけの回数ではない。

比較の小さい集計はloss-summary.json。試験の古いfixtureでは実試合と試験用の基準IDが衝突したため、その測定値は破棄し、decoder状態を隔離した上記の再測定だけを採用した。

### 5%/20%損失での自然試合

`online_loss_check.js --soak-only --mock-transport`：5項目成功。両条件ともmesa・人間2人+Bot計10機、300秒の試合を勝敗まで完走し、host/guestの最終コア一致、ブラウザエラーなし。初期同期前から論理message損失を注入した。実RTC packet損失と同じとは扱わない。

- 5%設定：通常写真1,315通を観測し59通を破棄、基準16通。controlの出来事2,528通と終了1通を受信。
- 20%設定：通常写真1,364通を観測し269通を破棄、基準17通中1通を破棄。controlの出来事2,823通と終了1通を受信。
- 保存済み採用写真列のframe>0だけから別途集計した試合中の受信間隔は、5%平均65.9ms/最大219.8ms、20%平均78.3ms/最大468.3ms。これは画面停止時間ではない。初期写真→4秒カウントダウンを跨ぐ間隔は除外した。次回用collectorはphaseで試合中/開始待ちの間隔を別々に保存する。

機能試験は固定50msのコマ送り・描画省略（実時間約82.8/85.7秒）。製品の可変dtは変更していない。実PCのCPU性能や実時間20Hz帯域、別回線の操作感の測定ではない。

`online_revision_check.js --mock-transport`：46項目成功。承認UI、3/2/1、静的情報の初期重複なし、装備/再出撃/施設、基準復旧、最後の基準/写真欠落からcontrol結果、両側の音停止、10/20機の経路別/断片合計を確認。

初期同期のv5実測：10機はcontrol metadata266B＋写真専用線89,612B（基準89,368B/8片＋初期差分244B）。20機は267B＋177,850B（基準177,606B/15片＋244B）。最大datagram12,268Bで16KiB未満。基準の分割前JSONは65,429/130,197Bだが、断片のbase64/外枠が増えるため初期総量は大きくなる。今回の主目的は制御と写真の待ちを分離し、古い写真のRTC再送を止めることであり、通常時や初期同期のbyte数が一律減ったとは主張しない。WebRTC/SCTP/DTLS等のヘッダー・再送はこれらのアプリ送信量に含めない。

最終 `quick_check.js origin/main` 成功（カスタマイズ一覧34項目・city/dock各60秒Bot戦、ブラウザエラーなし）。構文/差分検査とtransport/interpolation/codec/rooms Node回帰成功。描画つきbenchとsnapshot専用最大内訳ツールはv5形式へ更新・構文確認済みだが、この段階では再計測していない。後続②/④で目的別に測定する。別PC/別回線の実通信・実機の操作感は未確認。①をpush後、②自機先読み→③hitscan巻戻し→④ゲスト別選別へ順に進む。

## 次段階② 自機移動予測・非再送入力（2026-11-08）

### 変更前・変更後・決めたこと

①では自機もhostの写真を待って動いた。②はhost/offlineと共通の `updateHumanMovement` / `predictHumanMovement` とphysicsで移動・ブースト・ジャンプ・向きを先読みする。命中・HP・弾数・施設起動・近接/SP消費はhostだけが決める。TURN/途中参加/ホスト移譲は追加せず、可変dtを維持した。

通信規格はv6。連続入力は写真と同じ非再送・順不同線へ最新5コマをまとめて最大60Hz送る。高FPSでは毎frameの予測と送信制限を分ける。ホストは番号/life/型/長さ/頻度を検査して重複と古い入力を除外する。押下（ジャンプ/ブースト開始を含む）・射撃開始/解除・武器等はcontrolの独立actionSeqで扱う。movement ack先着で一度きり操作を消さず、逆にaction ack前のreplayで繰り返し発火させない。500msを超えた一度きり操作は失効し、保持状態だけ押下なしの新番号で再同期する。250ms入力途絶の中立化と3秒でBotへの引継ぎは維持。

ホストの実適用dt、入力seqごとの累積dt、適用stepとactionSeqを写真へ含める。dtはcodecで丸めずJSON roundtripし、1/60・1/144秒も保持する。ゲストは確定状態へ戻し、同seqの未適用時間と後続入力だけを再実行する。未来のhost dtはまだ存在せず、未確定部分は仮dtである。client指定dtでhostを余計に進めない。

表示補正は累積差0.5m未満なら6描画frame以内、camera描画中/機体モデルだけへ適用する。照準・衝突・送信値は補正しない。大きな差、再出撃、行動不能、施設、装備/機体変更、履歴欠落は即snap。予測履歴は240件/1秒。通常の弾数変化は装備変更扱いにしない。施設・近接・実SP消費を伴う加速中は先読みを止めるが、加速装置ONだけなら歩行/ジャンプは予測する。

### 機能・遅延測定

`online_prediction_check.js --mock-transport --functional-only` は62項目成功。最新5入力の欠落/逆転/重複、独立action ack、life/期限、部分ack、history欠落、機体stats、13種類以上のsnap境界、表示とaim隔離、240Hz描画→最大60Hz送信を含む。`--latency-only` は23項目成功。JSON要約は `prediction-summary.json`。

人工片道50/100msを両端へ加算し、予測OFF/ON各5回。同一guestのperformance.nowで入力投入から物理位置/描画groupが2cm超動く最初のframeまでを測る。実RAFの可変dt、描画省略、BroadcastChannelによる通信代替であり、実WebRTC/実回線/GPU描画/ディスプレイ発光の性能ではない。

| 人工片道 | 予測OFF平均 | ON平均 | ON最大 | 補正距離平均 | 補正距離最大 |
|---|---:|---:|---:|---:|---:|
| 50ms | 172.54ms | 9.90ms | 12.80ms | 0.02687m | 0.36935m |
| 100ms | 282.90ms | 10.72ms | 15.30ms | 0.02470m | 0.21842m |

全条件timeoutなし。物理/描画groupの開始時刻はこのfixtureでは同じ。補正はsnapshot受信直前と復元+replay直後の物理位置差を独立採取し、初期reset期間は除外した（50ms:36回、100ms:45回）。測定中hard snapなし。これは数値上の即応改善であり、人の操作感を確認したという意味ではない。命中表示を早める変更はしていない。

transport Nodeでは60/240Hz×50/100msの全実送信batchについて最新コマ生成からsendまでを測り、指定人工遅延以上を確認した。最古queue itemのpayload/dueをそのまま保ち中間itemだけを捨てるため、新payloadを古いdueで早送りしない。5%/20%の入力損失、4batch連続欠落から5コマ冗長で回復、写真との独立番号、別peer/control非閉塞も検査した。

### 回帰・未確認

共有移動の変更前後比較は6条件×600可変dt frame、独立レビューでも5条件×500frameで状態/副作用回数一致。Node movement（8項目）、prediction、codec（実dt精度追加）、interpolation、rooms、transport、構文、diff検査成功。実PeerJS→実RTCDataChannel v6設定は6項目成功（接続/NAT成立とは別）。既存対戦/オフラインの最終回帰は下欄へ追記する。

別回線の知り合いとの試遊は未確認。人による操作感も未確認。古いリリースでのオーナーの1PC・2窓成功報告を今回ビルドの実回線成功へ転用しない。段階③のhitscan巻戻し、④のゲスト別秘匿/優先度と10/20機通信量再測定はこれから。実dt ack追加の通信増も④の前後比較に含める。

最終オフライン回帰: `quick_check.js origin/main` 成功（一覧34項目＋city/dock各60秒）。`weapons_check.js dbg` は全武器を確認しブラウザエラー配列は空。`bot_battle.js dbg city,wide,mesa,dock 150` は4マップ各150秒ともエラーなし。`mech_shapes_check.js` の数値段階は6,561組・32,805射を通過したが、その後の画像段階 `page.evaluate`（116行）で停止し180秒で打ち切った。以前のmainでも同じ画像段階停止を確認しており、今回も画像回帰は未完了として残す。

初期同期の追加診断では、再同期要求0の正常接続でもplaying/frame1にschema追補が1通発生した。10機中7機の `motionVectors.boostVisualDir` がnull（JSON atom）からVector3（xyz）へ変わり、7項目削除＋21項目追加となるため。初期基準1は論理71,440B/断片外枠込み97,384B、playingの基準2はschema64,752B＋patch1,957B、論理66,964B/外枠込み91,416B。これは初期基準の重複再送ではない。試験はpreparing/countdownの初期送信とplayingのschema追補を別集計し、初期基準が1回であるassertを維持する。追加圧縮はこの段階では追わず、実際の通信増を隠さず記録した。

最終オンライン回帰: `online_revision_check.js --mock-transport` は52項目成功（初期/playing追補の別集計と合計一致を含む）。`online_check.js --mock-transport --connections-only` は16項目成功、入力途絶fixtureでは両入力型が実際に遮断されたことも確認。`online_room_check.js --mock-transport` は18項目成功。全てブラウザエラーなし。帯域/CPU用の旧online_benchは新input/action/ackへ追随・構文確認したが、この段階では再計測していない。新予測機能の測定値は専用predictionチェックのものを採用する。

## 次段階③ ゲストhitscanのラグ補償（2026-11-08）

### 変更前・変更後・決めたこと

②ではゲストの射撃もhostが入力を受け取った現在のcolliderで判定した。③ではゲストの手持ちhitscanだけ、実際に描き終わった写真時刻を入力へ付け、hostの過去の機体colliderで射線を検査する。hostの履歴は直近250ms・最大128件。巻戻しは最大200ms。時計/anchor/RTTを検査し、許容ageを `min(200ms, host測定RTT + 申告補間待ち60〜200ms + 50ms + host内の実待ち時間)` に制限する。RTT0/待ち60なら古い申告でも110msまで。未来・非有限値・未知anchor・古いlife・期限切れ操作は現在判定へ戻す。host内待ちは独立actionの500ms期限内のみ。

初回の射撃端はcontrolに表示時刻・照準・反動の対を保持し、movementが先着/後着/欠落しても新しい照準と混ぜない。そのactionを適用したhost stepで撃たなければ破棄し、cooldown後の連射を古い照準へ戻さない。通常burstの解除後の残弾も最新movementを使い、release発射を持つ充填銃だけ解除端の対を使う。shot/hit eventの入力番号も同じ射撃対へ揃え、次の射撃へ混入させない。移動のyawや予測状態を古い射撃方向へ巻き戻さない。

巻戻すのは射線判定中の他機mesh世界行列と骨付き被弾頂点/境界/cacheだけ。unit.pos/HP・現在の壁・施設・バリアは動かさない。finallyで全て復元してから既存damage/killへ進むため、撃破/死体は現在位置（既存の地面への落下処理は維持）。最初の致死pellet後は死亡した過去像へ繰り返し当てない。初回lazy境界生成や途中例外も復旧する。再出撃・転送・構成変更・死亡/蘇生epochを跨がない。

手持ちgunだけのcontextを作り、Bot自身の射撃、sentry、背部escort、ロケット等の飛翔弾、近接、設置物には巻戻しを加えない。ゲストが撃つBot標的は対象。標準の照準・散布を使い、ロックオンで弾を中心へ補正しない。

相手機のしゃがみ量はhostのrig.crouchを写真へ送り、表示時刻で補間して二重平滑化を止める。tiltも同時刻に合わせる。歩行位相・着地アニメを含む全骨姿勢の完全同期は行わず、動的な見た目の全頂点と過去host形状の厳密一致は未保証。静止/しゃがみの部位判定と、この近似の限界を分けて扱う。

### 試験方法と制約

`online_lag_check.js` は実機体colliderの人工配置fixture、描画済み時刻/動的しゃがみのwire検査、命中率比較を別々に保存する。描画省略・BroadcastChannel代替であり、実WebRTC/NAT/実回線や人の操作感を証明しない。部位判定では固定時計を使うが、命中率は両端へ実際に100ms人工送信遅延を入れ、同一の横移動軌跡・照準方法・12発でON/OFFを比較する。命中率の必ずの改善はassertせず、実HP/damage/host発射数と結果を保存する。

命中率fixtureは標的12m/s、開始x=-30m、距離z=60m、高度200m、300msごと12発、warmup1.8秒。武器は初期ライフルを基に散布/反動0・damage100・1pelletとし、射線/巻戻しの差を比較する。実ゲーム全体の戦績や人の射撃精度の値ではない。発射分母はhost実shot、命中はhost HP減少とdamage呼出しから数える。各shotの申告表示age・実巻戻し・残差・実transport遅延も保存する。

現表示時計は写真の片道遅延も含むため、host受信時のageは概ねRTT＋補間待ちとなる。片道100msでは200ms上限に達し、見ていた時刻まで全て戻せない場合がある。結果を都合良くするため軌跡を変えず、その残差を記録する。

### 最終の結果

最新版3ファイルのsource hashが一致する `online_lag_check.js --mock-transport` の全モードは **200項目成功**。50/100msの部位・遮蔽・散弾・致死・死亡/蘇生/機体/移動境界・初回lazy/途中例外復旧、時刻不正、control先着/後着/逆順/初回movement欠落、射撃対とevent番号、一度きり操作の重複除外を含む。動的しゃがみは各28描画frameを同tickで独立観測し、写真間補間値と実rig.crouchの差0。頭部高さのしゃがみ補正後残差は50msで約2.65e-14m、100msで約7.54e-6m（全骨アニメの一致を示す値ではない）。

| 人工片道 | OFF 命中/実発射 | ON 命中/実発射 | 差 | ONで200ms上限へ丸めた数 |
|---|---:|---:|---:|---:|
| 50ms | 0/12（0%） | 12/12（100%） | +100pt | 12/12 |
| 100ms | 0/12（0%） | 5/12（41.67%） | +41.67pt | 12/12 |

ONの申告表示ageは50ms条件で平均233.31ms（219.40〜257.37ms）、100ms条件で333.51ms（317.13〜348.68ms）。巻戻し先と実際の表示時刻の残差は平均35.58ms/135.06ms、最大58.67ms/149.58ms。製品の最大巻戻し記録は両方200ms。サンプル先頭から実射撃処理までの数ms差があるため、外側の試験時計で算出したrewind ageは192〜199ms程度になる。実受信時刻−送信時刻は50ms条件で52.25〜69.25ms、100ms条件で100.35〜116.85ms。設定の両端50/100msも別assertで確認した。

100msで外れる7発は『巻戻しがなければ当たらない横移動』を全て吸収できるという意味ではなく、200ms上限の残差を残した比較結果である。同一条件の12発という小規模の人工fixtureで、一般的な命中率/公平性の保証には使わない。試験要約・各shot・source hashは `lag-summary.json`。

独立レビューはblockingなし。Node lag16項目、codec/transport/rooms/prediction/movement/interpolation成功。実RTC v7設定6項目成功（接続成立ではない）。自機予測機能のブラウザ回帰62項目も成功。最終の全武器/Bot等の結果は次欄に追記する。

最終オフライン回帰もquick_check origin/main、全武器（ブラウザエラー配列空）、city/wide/mesa/dockのBot戦150秒設定（自然終戦を含む）が成功。機体形状は6,561組/32,805射の数値検査を通過し、画像部分は以前のmainと同じ116行のpage.evaluate停止により180秒で打切り。画像まで成功したとは扱わない。

20機の初期/通常同期、装備/再出撃/施設、基準欠落、開始/終了/音/承認を含む既存 `online_revision_check.js --mock-transport` も52項目成功。ブラウザエラーなし。


## 次段階④：固定枠方式へ変更する前の測定（2026-11-08）

最初の実装は可視機体だけの配列を作り、可視集合が変わるたびに独立した完全基準を送った。秘匿機能529項目、サイズ集計101項目は成功したが、帯域は改善しない場面があるため、この方式を最終採用しない。以下は変更前の比較資料。実WebRTCではなくBroadcastChannelの機能試験と、決定的な同一軌跡をcodecへ通した送信予定byteの計算である。

10/20機とも実guest1人+Bot、入力ackはguest1人分の8step。245枚、20Hz換算。通常の見える区間80枚では写真平均が10機1,527.0→1,483.7B、20機1,672.2→1,541.8B。snapshot+event合計の換算は37.81→35.52KB/s、40.72→38.11KB/sと小幅減。全機にackを付けた初期の人工測定は通常Bot条件ではないため採用しない。

一方、可視切替25枚/1.25秒で完全基準を9回作ると、10機は全体配信48,581Bに対して894,033B（うち基準858,322B）、20機は52,578Bに対して1,700,208B（基準1,663,688B）。完全schema辞書の再送が支配した。『通信全体が軽くなった』とは扱わない。ユーザーの追加指定に従い、機体・設置物の固定枠と非表示印、隠された値の中立化へ変更し、同じ245枚の軌跡で再測定する。

途中の旧方式回帰：revision54項目、prediction84項目成功。これらは固定枠変更後の検証ではない。#215はdraft・未merge、head cfd5458、基点0a0ba66を確認。自動入室/結果ボタン変更は別作業のため取り込まず、同じgame.js/旧回帰試験への変更を上書きしない。

### 固定枠変更中のオフライン回帰

quick_check origin/main、全武器、city/wide/mesa/dock各150秒設定のBot戦は成功（エラーなし）。Bot戦は自然決着した場合そこで終了する。試験用dbg.htmlのSHA-256は f3ec7992ab8df721dd6557d5e116a1edf7852663da82a92b663eda1897666731 で、固定枠実装後に本体から再生成したdbg.htmlと一致した。オンラインmoduleの固定枠差分は別のオンライン試験で検証する。形状試験は6,561組・32,805射まで成功したが、既知の画像段階（mech_shapes_check.js:116）が返らず180秒で終了コード124。画像確認は未完了であり、形状試験全体を成功とは扱わない。

## 次段階④：固定枠版の最終比較（2026-11-08）

全機体をID順の固定枠へ変更。hidden印を立てた機体はid/visibilityEpochを除く内部値を固定中立値へ置換し、位置・速度は0、行動・HP・装備等はnull/空値にする。実状態をたどって枠を作らない。nullableな項目を項目単位のatomにするため、null/数値/配列/オブジェクトや見え隠れでschemaが変わらない。機体や装備全体を毎回JSONで送る方式にはしていない。

hidden枠の中立差分は間引かず毎回送る。最初のhide写真を落としても次の写真だけで中立値へ復元できる。逆に初回hidden基準からreveal後の省略frameでhiddenに戻らないよう、id/fixedUnit/hidden/visibilityEpochは必ず差分へ含める。可視集合変更時に未送信の古い写真は破棄するが、基準は送り直さない。初期・10秒定期・schemaの実変更・明示resyncは引き続き基準更新の対象。resyncは現在の中立化済み状態の独立基準を返す。

設置物は許可兵装由来の固定容量。現在の強襲/重火力初期装備では0枠。全45設置specのmax合計140＋decoy4＋repairPost1を無条件に全機へ割り当てる2900枠案は採用せず、全武器開放もしていない。有限の地雷許可fixtureでは4枠を用いて空き/未発見が同じ[1]、再発見、上限、許可外を確認。個数・種類・識別子・位置を未発見枠へ載せず、溢れはホストの有界診断だけ。将来の全設置物のguest描画まで実装したとは扱わない。

### 同じ見え隠れ軌跡での比較

guest R:0・10/20機、同じ245枚の位置/迷彩/イベント軌跡が一致することを試験で確認した。20Hz換算、両端の通信代替で機能を検査し、サイズは製品codec/fragment処理を通したbyte数。SCTP/DTLS/IPヘッダー・実再送・実回線throughput・20人のCPU負荷は含めない。写真、基準、イベント、base64増分/外枠を別集計した詳細はvisibility-summary.json。

| 条件 | 可変配列の旧案 | 固定枠の新案 |
|---|---:|---:|
| 10機、切替25枚/1.25秒の基準回数 | 9 | 0 |
| 同区間の総送信量 | 894,033B | 76,185B |
| 20機、同区間の基準回数 | 9 | 0 |
| 同区間の総送信量 | 1,700,208B | 116,968B |

総量は同区間で約91%/93%減。ただし**秘匿無しの配信より全区間で軽くなったわけではない**。初期可視基準に対する中立差分を繰り返すため、hidden-set80枚の写真平均/最大は10機3,897.6/3,925B、20機7,448.4/7,481B。基準+event込み換算は83.35/153.98KB/s。元の秘匿無し配信は同区間38.84/42.38KB/sであり、新方式の方が増える。定常可視80枚は1,483.7/1,541.8B、最大1,500/1,552Bで、換算35.61/35.82KB/s。2KBを必須条件とせず、追加圧縮を追わない指示に従い、このコストを記録する。

初期基準は断片外枠込み10機100,374B、20機198,702B（各1回）。定期更新のある最後59枚は基準4,148/8,956Bを各1回、写真平均2,060.1/2,940.1B。初期基準を毎秒の定常量と混同しない。見え隠れ25枚だけの写真平均/最大は10機2,677.2/3,933B、20機4,427.7/7,501B。初期値が可視/不可視のどちらかや、可視化する人数により差分量は変わる。

### 固定枠の試験

- 新ブラウザ機能795項目成功。3guest・両陣営、初期/通常/定期/schema/resync/結果、迷彩・設置物由来のイベント、実受信wireと独立復号、hidden/reveal/間引き、表示/履歴の維持、ロビーresyncの無送信を確認。ブラウザエラーなし。
- サイズ比較191項目成功。前後245枚の軌跡・guest一致、切替区間の基準0回と送信量内訳の合計を検算。
- Node visibility154項目、online7スイート成功。20固定枠120回の切替で初期以外基準0、旧基準からの独立復号、hidden/revealの制御header保持、入力最新5件5977B、実送信完了台帳、機体別描画時刻の検査等。
- 独立レビューで判明した同frame別差分の承認、tuple省略の+100ms境界迂回、sentryのsource上書き、未割当ロビーresync、再表示後の間引き点滅を修正し恒久回帰へ追加。
- 実PeerJS/RTCDataChannelのv8生成設定6項目成功。unordered/maxRetransmits:0を確認しただけで、実WebRTC対戦接続の成功ではない。

### 固定枠版の既存回帰

revision54項目、自機予測の機能63項目、50/100msラグ補償200項目が成功。ラグ試験の初回診断保存でeffect sourceの循環参照が元assertを隠したため、診断を参照ID化して修正した。元の失敗は計測時計を射線処理の前後で取り直して201.6msとなるもの。同じacceptedAtを検証・個別巻戻し・metricsで使うよう修正し、200ms条件を緩めず再試験で最大200msを確認。

同じ人工横移動12発では片道50msが0/12→12/12、100msが0/12→1/12。前段階の100msで5/12という値を現版の値として流用しない。RTT＋表示待ちが巻戻し上限200msを超えるため完全一致せず、ブラウザ実行の時刻条件でも変わる少数の人工試験であり、一般的な命中率や人の操作感を保証しない。実回線・別PC・別回線・人による操作感は引き続き未検証。

接続/切断16項目、写真詰まり・基準欠落/逆転/再取得・最終結果の復旧10項目も成功。旧復旧fixtureのsource情報なし汎用sfxは新秘匿規則で正しく拒否されたため、正式に許可される当該peer自己hit通知へ変更し、正確なcontrol受信・他peerへ未配信・他peer写真の進行を検証した。本体filterは緩めていない。fixedSlotComparisonは見え隠れだけで基準が作られないことを測り、復旧fixtureは明示的に新しい独立基準を要求するので目的を分けている。

今回のコードと試験のsource hashはvisibility-summary.jsonに記録。別回線・人の操作感・実NAT成立、画像段階と将来の全設置物guest描画は未確認。#215は取り込まず、draftを保ち、mainへはマージしない。

## 入室承認の省略と、結果画面で固まる件（Claude、2026-11-08）

- オーナーの指定で入室承認を省いた。ゲストの申請はホストが自動で許可する（満員・試合中・版違いは今どおり断る）。追い出しはロビーのキックで行う。
- オーナー報告「試合が終わると固まる」（両方の画面、結果画面のボタンが効かない）を再現した。原因は、オンラインの結果画面では `#overlay` のボタンを試作のガードが全部止めていたこと（戻れるのは小さな「オンラインへ戻る」だけ）。結果画面の出撃ボタンを「オンラインのメニューへ戻る」に変え、ほかのボタンは部屋を出てから働くようにした。
- `online_result_buttons_check.js --mock-transport` 6項目、`online_room_check.js` 18項目、`online_revision_check.js` 45項目（承認・拒否の項目を自動入室とキックに置き換え）が成功。`online_room_check.js` は1回目に「定員縮小を断る」が失敗し、2回目は成功（タイミング依存。要観察）。

## #215の取り込み（2026-11-08）

上の「#215未取込」は④単独の検証時点の記録。オーナーの追加依頼に従い、④のcommit 72b0254を保ったまま#215（cfd5458）を同じ試作ブランチへ統合した。mainと正式公開版には反映しない。統合後の検証は以下へ追記する。

### 統合・UI更新後の確認

オンラインNode 7スイート（codec/interpolation/lag/movement/prediction/rooms/transport）、新旧ui.jsの構文、diff検査は成功。結果画面のブラウザ試験は起動を試したが、この実行環境ではPlaywright同梱Chromiumがなく、既存Chromiumもsocket Operation not permittedで起動できなかった（昇格実行でも同じ）。統合後のE2E成功とは扱わない。新しいonline_ui_check.jsは1440/390/320px配置、繰り返し開閉、自動入室、コピー、権限、キーボード所属の回帰を追加。以前の④の試験結果は当時のcommitに対する結果であり、今回の統合後E2Eへ流用しない。サイトでのスモーク確認は別途記録する。

## 通常移動の照合修正・固定命令v9（2026-11-08）

### 診断と原因の範囲

診断先行版1838915のF3は直近2秒を表示する。補正は1mm超の件数・平均・最大m、hardSnapは全件と理由。host開始間隔は実now差、JS処理時間とは別でGPU完了を含まない。到着間隔は最新の受理写真だけ（重複/逆順を除外）、host値は最後に届いた集計。追加の「先読み停止理由」「停止写真の補正件数」は写真のpredictionBlockedタグであり、全replay stepの停止を意味しない。

ユーザーは同じPCのFirefox host/Edge guest、双方60fps、RTT24ms、通常Shiftのみ（加速装置なし）で2秒平均0.970m・最大2.415m・hard18を報告。この値を完全再現したわけではない。旧版の16.7ms送信判定は±0.1msの描画揺れでも30Hzへ落ち、同seq反復と後続の仮dtの重なりを作る。固定命令は生成/実適用/ACKの時間を揃える。初期候補はbatch30Hzのままでも改善したため「送信Hzだけが原因」とはしない。最終版は新固定命令を作ったframeで時間閾値なしにenqueueし、高Hzの命令なしframeは送らない。実wireは既存20ms pump（最大約50Hz）であり、描画Hz/命令Hz/送信Hzを混同しない。

### 実physics・実初期装備・実codecの比較

`node tools/test/online_sync_report.js > research/online/physics-sync-summary.json` で再計算。beforeは1838915、afterは作業ツリー、各source SHA256・正確な装備値・条件・補正例をJSONへ保存。旧commitのないshallow cloneは理由付きで止まり、履歴取得が必要（自動fetchなし）。通常回帰 `online_physics_sync.test.js` は旧commitもネットも不要。

本体physics、parts/weapons/mechStatsによる初期強襲/重火力、送信→host移動→fixedUnit写真→実codec encode/decode→ACK照合を接続した平地VM。Bot射撃/被弾・近接・施設外力なし、製品マップ全体でも実RTC/描画でもない。壁/斜面等は既存online_movement.test.jsで別回帰。初期強襲weight4340/cap4800、walk13/dash46/cruise30。重火力weight5430/cap4800、walk10.9525/dash38.755/cruise25.275。装備値を代役速度で置き換えない。

60/60、guest frame±0.1ms、片道12ms、host位相1ms、2.2秒中の最後2秒。写真判定50msで実到着平均54.76ms（ユーザー実測64msとは異なる）。下は強襲の補正>1mm平均/最大m、hard件数。

| 動作 | 旧 平均/最大/hard | 修正 平均/最大/hard |
|---|---|---|
| 停止 | 0/0/0 | 0/0/0 |
| 直進 | .1500/.2154/0 | .0042/.0076/0 |
| 短dash | .3651/.7621/11 | .0044/.0082/0 |
| 長dash | .4016/.6460/5 | .0045/.0086/0 |
| ジャンプ | .1666/.3821/0 | .0047/.0100/0 |

重火力も5動作で最大2cm未満・hard0。cm丸めを通すので「0補正」とはしない。丸めなし直進対照は一致。加速装置ON対照は実speed45/use2.4で旧平均2.4858m→新2.4864m、hard36のまま。従来の意図的非予測を変更していない別経路で、今回ユーザーの原因とは扱わない。

### 指定の間引き・反復・復帰

60/60、60/144、144/60 × batchを1/2/3guest frameごと × 短/長dashの18組、各4.2秒・最後2秒、実physics/codec/RTT24msに20ms送信pumpの時刻代役（同tickのinput/photoは最新1件）を追加。全組平均/最大とも0.05m未満・hard0。pumpは時刻代役で、製品transportのfragment/bucket/実RTCまで検証したものではない。144/240Hz各12秒でもenqueueは720件以下。transportの120token/秒上限を無条件に上げていない。

追加対照の150ms途中入力欠落では12反復が発生。旧固定候補の長dash最大2.5m/hard4は反復時間控除で0へ。操作変化を含む短dashには欠落境界の大補正が残る。復旧数秒後は短dash/反転最大1cm未満・hard0になるが、queue7・予測負債7tickが残り、hostの新操作反映は約117ms遅れたまま。この上限付き追いつきの制約を隠さず、命令破棄や継続速度増加は追加しない。

500ms guest描画停止ではhost時計が先行し、初期控除案は永久負債30tick・長dash毎写真.65m補正に退行した。250ms中立化後のfresh命令で予測時計のみ再基準化し、最後2秒は短dash/反転最大1cm未満・長dashほぼ0・hard0、負債0に復帰。復帰ACK写真の欠落とジャンプ押下4回の一度ずつ実行も恒久回帰へ追加。host位置/速度budget/未適用命令は巻き戻さない。

### 線形同期対照と保護回帰

線形30m/s・片道1ms・10秒（実physicsではない）を別のfixed-command-rates-summary.jsonに保存。旧可変方式対照→固定方式の平均/最大/hardは60/60が0/0/0→0/0/0、60/144が.3002/.3750/0→0/0/0、144/60が.1108/.1667/0→0/0/0。30/144、60/240、急反転100ms、150ms写真バースト、写真欠落もJSONに残す。通常の実ゲーム値へ流用しない。

固定テストはseq/重複/欠番/2.1秒入力欠落復旧/queue上限/改造70Hz相当の継続速度増加防止、可変dt余り維持、独立通信線の押下順逆転、240Hz複数押下ID、0step施設保持、実H+Space順序、武器host frame一度を確認。移動SP/zip等は固定移動総時間ぶん進み、武器は追いつきで増えない。時間budgetはwallclockでなく既存gameFrame dt（最大50ms）で、10fps等では実時間60命令に届かない制限が残る。

inputAcksはcodecのj原子で、適用済みID0→128→0でも初期以外schema baseline増加0。ただし128ID（1〜128）のJSON deltaは本fixtureで604B増える。2KBは目安で上限ではなく、帯域を無条件に軽量化したとは主張しない。visibilityは呼出内だけpoint/LOSを再利用、10,000比較で出力同一、LOS15554→14193、point176084→87352。実FPS改善量は未測定。

v9はv8を拒否するため両ブラウザを再読込する。高Hzで自機位置が60Hzの階段になる描画補間は未追加。今回環境はChromium socket EPERM、別cloud browserはWebGL作成不可のため新E2E/人の操作感/実FPSは未検証。過去のブラウザ成功を今回版へ転用しない。

## ゲストのマウス回転・通常予測stepの視点保護（2026-11-08）

公開v9後のユーザー画像はhost/guestとも60fps、guest補正平均.005m・最大.010m・hardSnap0、RTT4ms、写真到着平均62.8ms。位置の修正結果と、マウスを回した時のカクつきは分けて調べた。

`predictLocalInput` は反復時間控除（repeatDebt）があると過去命令を選び、本体 `updateHumanMovement` がそのyaw/pitchをplayerへ代入する。写真受理後の `reconcilePrediction` は通常時に最新視点へ戻すが、その次の通常frameの予測は戻さず、末尾の `updateCamera` が古い方向を使っていた。今回は予測呼出し前に最新yaw/pitchを保存し、同じ過去命令で移動計算した後、例外時も含めて戻す。写真hardSnapの仕様は変更しない。

新しい `online_camera_fixture.js` は実lookMove・入力採取・beforeFrame・本体physics・host命令queue・実codec・receiveSnapshot・updateCameraを平地VMで接続する。マウスの相対量を積算し、期待角を毎frameのplayerへ直接代入して巻き戻りを隠すことはしない。WebGL描画、OS/ブラウザのmousemove配送、実RTC、lockUpdate/castFrom/遮蔽処理は検証外。

60/60・60/144・144/60Hz、回転30/360°毎秒、片道2/12ms、入力70ms・写真90ms、150ms入力欠落＋160ms写真欠落の24条件を比較。低遅延や一定の高遅延だけでは旧版も巻き戻りを再現しなかった。欠落を含む6条件で再現し、60/60の通常予測stepは低速時最大1.5°・高速時18°戻り、192描画frame中33frameで逆回転。修正後は同条件も通常stepの視点誤差0・逆回転0（カメラ方向の丸め誤差を除く）。写真受理直後の角度差は前後とも0で、故障箇所を通常予測stepへ切り分けた。

これは入力途絶後に起きる確実な不具合の修正であり、RTT4msの実PC報告を完全再現したという意味ではない。F3に反復控除と過去向きの上書き防止を出し、実環境でも同じ条件だったかを確かめられるようにする。既存の物理比較JSONはe8b0140時点の記録として残す。今回の比較元/source hash/数値と回帰結果は以下へ記録する。

比較は `node tools/test/online_camera_fixture.js --revision=e8b0140` と `node tools/test/online_camera_fixture.js --revision=working`。両出力を `camera-sync-summary.json` のbefore/afterへ保存した（各24条件、製品source SHA256付き）。新しい通常回帰は `node tools/test/online_camera.test.js` で36条件成功。歩行/長dashの60/144Hz、FOV・武器旋回倍率、0step/複数step、実lock追従式と採取済み発射照準点、例外時復元、再出撃/転送/蘇生を検査。過去命令のboost/jump/crouchを含む120step比較でも、視点以外の位置・速度・方向ベクトル・タイマーは全step一致した。

F3の反復控除は現在のtick数。防いだ視点上書きは直近2秒・最大1200件、yaw差を±πへ折り返した絶対値とpitch差の大きい方を度で集計する。1e-7rad以下の差は除外する。画面に残った角度誤差ではなく、今回保存復元した角度差である。値が0でも別の描画/入力原因を否定するものではない。

最終コードでオンラインNode12スイート、visibility154項目、名前14ファイル、変更JS構文、diff検査が成功。実ブラウザ試験は既知のsocket/WebGL制限で未実行。通信形式はv9のまま、main/gh-pagesは変更しない。

## #216の取り込みと固定命令後の予測試験更新（2026-11-08）

#216（44614b1）はe8b0140から分岐し、通常予測後のyaw/pitch復元と `online_view_turn_check.js` を追加した。#214のb220afaと同じ場所・目的の修正なので、例外時のfinally復元とF3防止量を持つb220afaの製品実装を一度だけ残し、#216の履歴と旋回試験を取り込む。製品game.jsはb220afaとバイト単位で同一、main/gh-pagesには反映しない。

#216記載の「向きが変わらない0/210コマ、補正平均.0066m、hardSnap0」はその担当側の通信代替試験の記録で、こちらの実行結果ではない。取込時にharnessのrealTime指定が省略されていたことを確認した。rAFは実時間だが、make_dbgの既定ではゲームdtが毎コマ50msに固定されるため、実時間dtを使う指定を足し、実際のdtの件数/平均/最大/種類数をログへ出す。不要な未使用ページも開かない。今回環境でこのブラウザ試験を実行できたとは扱わない。

報告された `online_prediction_check.js` の例外は、同じhostSteps evaluate処理を実game.js/physicsのVMへ接続してe8b0140とb220afaの両方で再現した。fixedCommands=trueのpeerへ旧形式（command印なし）の入力を送るため製品が正しく拒否し、accepted=p.inputがnullになる。その後の `Object.hasOwn(accepted,'dt')` が `Cannot convert undefined or null to object` を投げる。#216の視点復元が原因ではない。旧形式を許可したりnullだけ飛ばしたりせず、固定命令queueと実適用ACKを検査する試験へ更新する。

修正版はhost frame 11/29/7/23msに対して固定移動0/2/0/2step、実消化seqと反復込みreplaySeq、移動/control両線の押下一度、個別適用ID、旧life/期限、240Hz描画でも60命令を生成することを検査する。ゲスト側の旧可変dt部分ACK期待値も固定命令と反復時間控除へ置き換え、旧可変方式の対照は `online_prediction.test.js` に残した。生成元から独立codecで復号したpeer別公開snapshotを使い、未発見枠を追加公開しない検査も保っている。

`node tools/test/online_prediction_contract.test.js` はbrowser版のfunctional関数と全3つのevaluate処理をそのまま平地VMへ接続し、67項目・生成元/復号状態の照合74回・秘匿枠1件で成功。通常実行は過去commitやネットワーク不要。`--before-v9-fixture=/path/to/old/check.js` を指定すると旧fixtureの同じnull例外を検証できる。再現例はファイル冒頭、最終結果とsource hashは `prediction-contract-summary.json`。VMの地形/施設/射撃、equipの機体再構築、camera/aimには代役があり、結果にも列挙した。

統合後はオンラインNode13スイート、visibility154項目、名前14ファイル、変更JS構文、diff検査が成功。新旋回checkは実時間dt・入力方向への単調回転を確認する通常通信のsmokeとし、反復控除を強制した回帰は既存camera36条件が担当する。今回のbrowser版の実実行、WebRTC、latencyCaseの50/100ms実時間測定は環境制限により未実行であり、VM成功をその代わりの成功とはしない。

## #216提出時の記録：写真30Hzと発砲の先出し（Claude、2026-11-08）

以下は提出者がe446606で記録した過去の結果で、取込環境で再実行した結果ではない。最終実装と今回の検証は次節を参照。

- オーナー「通信ラグが無いのに快適なのがホストだけ」への対応。写真の送信間隔を 50ms（20Hz）から 1000/30ms（30Hz）にした（`SNAPSHOT_INTERVAL_MS`）。④で1枚が小さくなった分を回す。補間の初期値も同じ間隔にした。
- ゲストの発砲炎と発射音を、引き金を引いたコマに手元で出す（`predictLocalFire`）。対象はふつうの即着弾銃（飛ぶ弾・チャージ・ガトリング・ミサイル・3点射は除く）。弾・命中・ダメージ・弾数は今どおりホスト。手元で 0.5 秒以内に撃っていた時は、ホストから届く自機の同じ発砲の炎と音を出さない。
- `online_local_fire_check.js`：4項目成功（引き金のコマで炎と音、ホストの発射 41 に対して炎 40・音 40）。`online_view_turn_check.js`：4項目成功（4秒で補正 115 回＝写真が約 29 枚/秒、平均 0.0047m、瞬間合わせ 0）。`online_revision_check.js` 53・`online_room_check.js` 18・`online_result_buttons_check.js` 6 項目成功。Node の online_*.test.js は全て成功（`online_interpolation.test.js` は下限 60ms への収束を誤差込みで見るよう直した）。通信は代役（--mock-transport）で、実回線の通信量は未計測。


## #216更新版e446606の統合・補修（2026-11-08）

#216は視点保護だけの44614b1から、b220afaを基準にした写真30Hz・発砲演出先出しのe446606へ更新された。元版を取り込んだa4b1d04に、新版の履歴もmergeする。重複する視点保護は再適用せず、finally復元とF3計測、実時間dtを使う旋回smokeを維持する。validation.mdの追記を両方保存し、同名の旋回checkは#214の強化済み版を残した。

### 写真予定の端数と実送信を区別

提出版の「前回の実行から32.3ms以上なら生成、実行時刻を次の起点にする」判定は端数を捨て、62fpsで20.67Hz、75fpsで25Hz、144fpsで28.8Hzへ下がることを製品afterFrameで再現した。予定時刻を33.333msずつ進めて端数を持ち越す方式へ修正。30/60/61/62/63/75/90/120/144/240fps各30秒で900枚、20fpsは600枚。1frame最大1枚、停止からの追いつきburst禁止、秘匿変更の即送信で定期予定を延期しないこと、終了/次試合のresetを含む29項目が成功した。

`online_snapshot_cadence.test.js` は製品afterFrameを実行し、payload・可視性・codec・20ms最新優先pumpは代役。前後比較は `snapshot-cadence-summary.json`。20ms pump後の間隔は60fpsで20/40ms、62fpsで20/40/60msとなる。平均生成30Hzと毎33.3msの実到着は同義ではない。実RTC・混雑時・総帯域は未測定。同一payloadの20→30Hzは写真部分を約1.5倍にする。④の最適化で必ず相殺されるとは扱わない。

### 発砲先出しの境界と抑止回数

提出版では先出し1回のあと100ms以内に来るhost発砲5回すべての炎・音を消した。修正版では同じ生命/武器の先出し1回ぶんだけを各1回消費し、残り4回を再生する。64件・500msの上限を設け、機体/試合/生命/生死/slot/武器keyの変更でreset。確定CDから開始し、semiは実際に発砲した時だけheldを立て、reload/持替え要求コマは先出しせず、二丁銃は左右の炎を出す。host演出に生命と武器keyを付加し、旧metadataのない演出は抑止しない。

`online_local_fire.test.js` の実関数VM50項目が成功。本体gunTickとの可変dt120frame対照はauto19発・semi4発が一致。末端の炎/音は代役であり実聴感の測定ではない。既知限界もassertする。501ms遅着は二重演出、500ms以内の別seqは1回ぶん誤照合し得る。残弾写真が1秒更新されないammo=1対照では見た目11回・実ammo1のままで、先出しは未確定の弾数を消費しない。host拒否の先出しを取り消す仕組みもない。結果とsource hashは `local-fire-summary.json`。

ブラウザsmoke `online_local_fire_check.js` はmake_dbg既定の50ms固定dtをやめ、手動の16.7ms時計をgame dtへ反映するrealTimeモードへ修正し、回数の上限だけでなく下限も確認する。実時間通信の計測ではない。既存予測契約VMには炎の末端adapterを足し、browserと同じfunctionalの67項目・公開状態照合74回・秘匿枠1件が成功した。最新hash付き `prediction-contract-summary.json` を更新する。

今回の統合後、オンラインNode15スイート、visibility154項目、名前14ファイル、変更JS構文、diff検査が成功。独立レビューでも同一game hashで全15スイートを再成功。実ブラウザcheck・quick_check/npm testのbrowser部分は既知のChromium socket EPERM/WebGL不可により未実行。提出者のブラウザ成功を今回版の成功へ転用しない。新しい製品変更はonline/game.jsだけで、通信v9・draft #214を維持し、main/gh-pagesは変更しない。

## ゲストの自機表示の刻み補間と、弾の筋の先出し（Claude、2026-11-08）

オーナー報告「ゲスト側のロックオン後の挙動がカックカク、弾の表示も怪しい」「自分の操作が反映されない風に見えるのは同期ズレ以上にストレスフル」への対応。

### 原因

- ゲストの自機は 1/60 秒の固定命令（e8b0140）で進む。60Hz より速い画面（144Hz など）では、命令が0個のコマと1個のコマが混ざり、自機の位置が段々に進む（7ms コマで1コマの移動量の変動係数 1.16、80コマ中 29〜35 コマは止まる）。
- カメラは自機の位置から作るので画面全体が段になる。ロックオン中は、ロック追従（`updateLocalHumanAim`）が「自機から目標への角度の変化」で視点を回すので、自機の段がそのまま視点の回転の段になる。ホストは可変 dt で毎コマ動くので起きない。60Hz の画面でも、写真との照合で自機を小さく直した瞬間、カメラと機体は滑らかに戻す（`onlineVisualOffset`）のに、ロック追従の角度だけは確定位置から計算していたので、そのコマだけ視点が跳ねていた。
- 自分の弾の筋はホストから届く物だけだった。ホストの位置（往復の遅れぶん後ろ）の銃口から、引き金から往復ぶん遅れて出ていた。

### 直したこと

- 固定命令の最後の1歩の移動量を覚え、描画だけ「確定位置 −（1−残り時間/1歩）×1歩」に置く（`onlineRenderOffset`、最大1歩＝16.7ms の見た目の遅れ）。確定位置・当たり判定・送信は変えない。本体の `onlineViewOffset(u)` が補正のなめらか戻しと合わせたずらしを返し、カメラ（`renderView` の包み）・機体の模型・`anglesTo`（ロック追従の角度）が同じずらしを使う。ずらしが無い機体（ホスト・Bot・他人）は今までどおり。
- ふつうの即着弾銃は、引き金を引いたコマに手元の銃口から手元の照準点へ弾の筋を描く（`localTracers`。散らばりは本体 `shot`/`fire` と同じ式の乱数なので、ホストの実際の弾とは別の筋）。ホストの筋の演出に撃った機体と生命を付け、手元で描いた本数ぶん、届いた自分の筋を描かない。当たり・ダメージは今どおりホスト。

### 確かめたこと

- `online_smooth_view_check.js`（新規、7ms コマ＝144Hz 相当）：前進で表示位置の変動係数 0.017（補間を外すと 1.16）、止まるコマ 0。見通せる所に置いた敵へロックして横移動：表示位置 0.012〜0.014、ロック追従の向きの変化の変動係数 0.017、向きが止まるコマ 0。
- `online_local_fire_check.js`（項目追加、6項目）：ホストの発射 14 に対し手元の筋 14、届いた自分の筋 13 は全部重ならずに済んだ。
- Node の online_*.test.js 15本は全て成功（VM の代役ベクトルにある演算だけで書いた）。
- 通信は代役（--mock-transport）。実回線・実際の 144Hz 画面での見え方はオーナーの試験待ち。

### 追加：ロックの枠の微振動、飛翔中のがたつき、手応えの抜け（同日、オーナーの試験から）

- 「ロックオンカーソルが微振動」：画面の描画はずらしたカメラだったが、`hud`・`popUpdate` の投影はずらす前のカメラだったので、枠だけが刻みごとに揺れた。両方を描画と同じずらしたカメラで包む。枠と描画上の敵の差は最大 0.0006px。
- 「カタパルト飛翔時も画面がガタガタ」：飛翔・ジャンプ台・リフト・ジップライン・格闘の踏み込みの間は先読みできず、自機は写真（30Hz）の位置に飛び飛びに置かれていた。描画だけ、最後の写真の速度でホスト時刻の今まで（最大100ms）進め、写真の届く間隔のゆらぎによる差は毎コマ3割ずつ寄せる（3m以上は即座）。7ms コマの飛翔で変動係数 2.0 → 0.08〜0.25（代役通信の届き方の乱れ込み）。
- 「撃破のシンボルとか出なかったり、repairのエフェクトが出なかったり」：撃破・破壊・蘇生の札、得点、被弾の方向・爆風の揺れは、本体が「ローカルの機体なら」でホスト画面にだけ出していた。遠隔の人間の物は `remoteFeedback` で本人だけへ送る（`popup`・`score`・`hurt`。文字はゲストで HTML を無害化）。リペアユニットの相手（`healTarget`）を写真に載せ、光線を出す。リペアポッドの光はゲストで写真の `repairing` から付ける。
- 試験：`online_smooth_view_check.js` 12項目（枠のずれ、飛翔を追加）、新 `online_feedback_check.js` 6項目。

## マージ前レビューで見つかった入力境界・配布生成の修正（2026-11-08）

対象は #217 統合済みの 1970ec0。オーナーの依頼により、再現できたこの2点だけを修正した。ロビーの連続試合対応は別作業であり触らない。main/gh-pagesへのマージ・公開はしない。

### 変更前と変更後

- 連続入力の `actionSeq` が無検証でqueueへ入り、後の数値比較で例外になる。極端に大きい有限の視点反動も本体状態へ入り、写真の整数化で例外になる。reliable入力は照準検査より先にpeerの番号等を更新し、batchの並べ替えにも検査前の型変換があった。
- 移動/control双方で、型・安全な整数・照準/反動/軸/wheelの範囲を、sort・生命切替・番号・queue更新より先に検査する。不正1件だけを捨て、同じbatchの正常命令と他peerは処理する。広いtry/catchで製品例外を隠す変更は入れない。範囲はDESIGN.mdの入力境界節を参照。通信v9と正常な送信形式、移動/射撃規則は変更しない。
- Pages/zipは旧three.jsタグの完全一致を要求し、SRI追加後は生成で停止した。また配布一覧にオンライン資材が無かった。指定URLのscriptだけを属性順序・SRIに依存せず同梱版へ置換する共通関数を使い、オンラインのJS6本とui.cssを両方へ収録する。欠落/重複タグは拒否し、作業用の未追跡JS/CSSを混ぜないよう配布する7資材を明示した。Pagesのmanifestも7資材のサイズ/ハッシュを含む。PeerJSの版固定・SRI付きCDN参照と既存zipの `--maps` 指定は維持する。

### 検証

- `node tools/test/online_input_boundary.test.js`：366条件成功。実onMessage・固定scheduler・本体の平地physics・通常/固定スロットの両codecを接続。型/数値の境界、受理前のpeer状態不変、初回/再出撃、同じbatchの正常入力、他peerの移動・写真継続を確認。WebGL・実RTC・実機の操作感は対象外。
- `node tools/test/online_input_boundary.test.js --revision=1970ec0` は不正actionSeqがpeer状態を変える箇所で失敗することを確認した（比較元の失敗が期待結果）。これとは別に旧版の型変換例外と縦/横反動の写真整数化例外も製品scheduler/physics/codecで再現した。
- `node --test tools/test/online_*.test.js`：16/16成功。既存fixtureのactionSeq省略3箇所とcontrol照準省略を製品の送信形式へ合わせた。予測契約を緩めたり、不正値を製品側で許す変更ではない。
- `node tools/test/names_check.js`：14ファイル、重複キーなし。秘匿境界VM91項目、変更JS構文、Python構文、`git diff --check` 成功。
- `python3 tools/test/distribution_check.py`：24項目成功。SRIあり/なし・引用符・属性順序・欠落/重複・明示資材一覧を確認。
- 確定したPR版から一時フォルダへ実Pagesを生成し、実zipも生成した。`distribution_check.py <Pages出力先> <zip>` は141項目成功。全ローカルscriptの参照先、元ファイルとのバイト一致、オンライン7資材、Pagesの19ファイルのサイズ/SHA-256、zip CRC等を確認。既定zipは23ファイル、2,576,369 bytes。
- `--maps` で別パスのマップを指定したzipを別生成し、validatorにも同じ元パスを渡して141項目成功。

配布物を公開せず確認する例（コミット済みの作業ツリーから実行）:

```sh
mkdir -p /tmp/core-breaker-dist-check/pages
printf '{}\n' > /tmp/core-breaker-dist-check/pages/build-info.json
python3 tools/build_pages.py /tmp/core-breaker-dist-check/pages
python3 tools/build_zip.py review-214
python3 tools/test/distribution_check.py /tmp/core-breaker-dist-check/pages dist/core-breaker-vreview-214.zip
# 公開中のマップをzipへ渡した場合は、検査にも同じファイルを指定する
# python3 tools/test/distribution_check.py <Pages出力先> <zip> --maps <zip生成時に渡したmaps.js>
```

この検証に対応するSHA-256:

- `prototype/online/game.js`: `9d8a44000b0faa273a40bf1d9adee60bc5e72f754d98d4d9d73c816062519f8f`
- `tools/build_pages.py`: `db82b4966b6b8a0a51a7ecf6e73188b6dd2a9e679c9c104b01ef1c2c5c8403a2`
- `tools/build_zip.py`: `0924c6d35eb3f555c10208d10ac23b829d147264cf7fe4590b149bb356c8624d`
- `tools/test/online_input_boundary.test.js`: `fb4903b1166190fd3932a9e21de578bc1f04ddd412c514f7f20817db1b240375`
- `tools/test/distribution_check.py`: `50a41941fc4f2a8ff1115ae4fe72326aa6576f5c68fcf880efcc4b39f3aae3a3`

### 未確認と次の判断

`quick_check.js origin/main` はPlaywright既定のChromium実行ファイルが無く起動前に失敗した。環境にあるChromiumもsocketのOperation not permittedで起動できないことを確認済み。従って最終版のpages_check、全武器/Bot回帰、ブラウザ/WebGL/実RTC、操作感は未確認であり、上のNode/配布生成成功から推定しない。既知の `online_lag_check`・`online_loss_check`・`online_ui_check` の失敗は今回修正していない。オーナー側で最終版のブラウザ試験とこの3本を実行し、結果を見て再度マージを判断する。

## 行動不能のゲストF入力（2026-11-08）

変更前は行動不能中に固定移動schedulerが止まり、reliable側のFが受信済みでも `remoteInput` の移動入力/番号待ちで止まっていた。行動不能専用のF受け渡しと `downTick` 後の操作ACKを追加。`online_downed_input.test.js` は変更前に「移動未消化でもFを取得」で失敗し、変更後に成功する。移動線の先着/未到着、重複、他操作の抑止、古い生命/500ms超の入力、保持と押下、240Hzの移動0step時の送信を検査する。

`online_downed_input_check.js` は2画面の実キー入力、大破/再出撃写真、コア消費・撃破数・1回だけの大破を検査するために追加。この実行環境ではPlaywright付属Chromiumが未配置で、システムChromiumも `socket() failed: Operation not permitted` により起動前停止（許可付き再実行でも同じ）。今回このブラウザ回帰・実WebRTC・実回線・quick_checkのブラウザ部分は未検証。Node回帰をブラウザ確認の代わりとはしない。

確認済み：`tools/test/online_*.test.js` の既存16本＋今回追加1本、計17本が全成功。`git diff --check` とブラウザ試験ファイルの構文検査も成功。ゲーム本体 `prototype/index.html` の変更はなし。

## ゲストの近接表示とF入力の統合（2026-11-08）

### 変更前と変更後

- 比較元は試験Siteに配信された #214 `ab43ed89a931ad5d7f82787dfabd1d6749952287`。近接中は移動予測を止めるが、写真位置の通常補正が描画外挿へ重なり、遅い踏み込みでは進んだり戻ったりしていた。剣の振り時刻も写真ごとにしか進まなかった。近接開始で視点が写真の角度へ戻り、終了で外挿offsetが消える境界もあった。
- 確定swingを変えず描画時だけ先行時刻の複製を使う。先行は100ms/攻撃終端まで。近接中は補正を二重加算せず、入りと終わりの描画位置を継ぎ、終了の引継ぎは最大250msで通常移動へ戻す。近接中の速度外挿も欠落上限と描画dtを扱う。生命・被弾・転送・装備・3m以上の差は即時復帰を維持。
- レビューで、写真の実時間から求めた開始時刻だけでは低FPSホストの同じ振りを新しい攻撃と誤認することと、微小補正写真で終了の引継ぎが延々続くことを再現。確定tの非減少による識別と延長しない250ms期限へ修正し回帰した。
- F修正は上節のものを統合。通信v9、初期装備、ホストの命中/消費/硬直、ロック追従と照準の規則は変更しない。main/gh-pages/正式公開は変更しない。

### 再現・回帰

- `node tools/test/online_melee_view.test.js`：35条件成功。60/144Hz、到着間隔の揺れ、写真欠落/復旧、同型連打・連撃定義変更、低FPSホスト、開始/終了/通常歩行への復帰、死亡/再出撃/転送/装備/被弾/大差、例外時も確定swing/参照/HP等を復元、cameraのoffsetと描画後復元を確認。
- 人工10m/s軌道の30Hz写真で、60Hz描画は逆方向frame6→0、振りの停止frame12→0。144Hzは逆方向13→0、振り停止51→0。26m/sでは元から位置の逆方向frameは0で、剣の時刻停止が改善。到着揺れを加えた4条件も記録。評価区間は開始/終了を除く350〜800ms。全条件の数値・製品/試験hashは `melee-view-summary.json`。
- それとは別に実本体の `swordTick`・`physics`・`meleeHome` と初期ソードを使い、通常/ロック誘導/ダッシュ/誘導付きダッシュ/壁停止 × 60/144Hzの10条件を通した。全320写真の位置/速度/近接タイマー/振り定義は変更前後で一致。平地・初期装備のVMであり、bladeSweep/命中/演出/施設/本物の描画は代役。人の試遊や全マップ回帰とは扱わない。
- `node --test tools/test/online_*.test.js`：統合後18/18成功（既存16＋近接＋F）。既存の予測契約67項目は、近接開始の「常にhardSnap」を「過去入力を捨て物理は確定、描画は継ぐ」へ変更。他の即時復帰境界は従来どおり。
- 秘匿境界VM91項目、名前検査14ファイル・変更JS構文・diff検査成功。本体index.html、武器/パーツ表、physics・swordTick自体の変更なし。

再現コマンド（比較元commitの履歴が必要、fixtureは自動fetchしない）：

```sh
node tools/test/online_melee_view_fixture.js --revision=ab43ed8
node tools/test/online_melee_view_fixture.js
node tools/test/online_melee_view.test.js
node tools/test/online_downed_input.test.js
node --test tools/test/online_*.test.js
```

### 限界・次の確認

`quick_check.js origin/main` はPlaywrightのChromium未配置で起動前停止。既存 `/usr/bin/chromium` も `socket() failed: Operation not permitted` で起動不能。最終版のWebGL、実キー/実マウス配送、実RTC、別PC/別回線、音、人の操作感、全武器/Bot戦は未確認。Node成功からブラウザ成功を推定しない。Fのブラウザ回帰は `online_downed_input_check.js` を追加済みで未実行。

最初の近接開始はホスト写真待ちのまま。長い欠落では100ms先行後に停止し、復旧や3m以上の差では補正が残り得る。自機表示だけの修正で、相手機の剣の振り時計は従来どおり。試験Site更新後は両画面を再読込し、通常斬り・ロック踏み込み・ダッシュ斬り・硬直明け・行動不能中Fを実機で確認する。

## 近接表示修正後の悪化を再現・修正（2026-11-08）

オーナーが `10dda30` の試遊で「なんで前よりカクカクすんだろうな」と報告。旧 `ab43ed8`、悪化版 `10dda30`、今回の修正版へ同じ30Hz人工写真・片道35ms・入力・描画Hzを与えて比較した。旧35条件は振りの途中の直進と終了時の期限を主に見ており、終了後に歩き続ける高Hzのframe差と、実ロック追従式を接続した角度変化を見落としていた。実機報告の全原因を再現したとの主張はしない。

### 根拠と変更

1. 終了の250ms引継ぎが確定posの差分を足し直し、直前の通常移動の描画補間を壊していた。144Hzの1frame移動差は旧版0.0689〜0.0758m、悪化版0.0009〜0.1679m、修正版0.0697〜0.0795m。変動係数は0.027→1.025→0.040。120/240Hzも約0.891→約0.045、240Hzの逆行も解消。修正版は補正残差だけを減らし、通常の固定tick補間を上書きしない。250ms期限は延長しない。
2. 近接写真でposが更新されても描画offsetは旧pos基準のまま残り、次の `updateLocalHumanAim` の後まで更新されなかった。26m/sの人工踏み込みでは写真受理直後の描画原点が最大0.87m飛び、ロック追従が交互に逆向きへ戻った。写真受理時に直前の描画位置を維持するoffsetへ置き直し、最大差を0にした。
3. `anglesTo` は描画原点、`lockStick` は確定原点で計算していたため、上記を直しただけでも小さい逆行が残った。後者も描画原点へ揃える最小修正。機体の端へ戻す式・係数・速度上限・頭から肩への規則は維持し、照準中心への新たな補正は入れない。追従で変わったyaw/pitchは既存経路で送信入力にも入るため、入力角が不変の純粋な描画修正とは扱わない。ホスト/オフラインのoffsetなしでは従来計算と同じ。

ロック付き26m/s人工踏み込み、350〜800ms区間のyaw最大1frame差は60Hzで0.00930→0.000408rad、144Hzで0.01054→0.000244rad。60/120/144/240Hzすべてで逆行0。旧ab43ed8の60Hzは0.000395radであり、全数値が旧版より小さいわけではない。ロックなしの入力角は不変。写真の権威状態hashは全版・全Hzで一致した。比較・製品/fixture hashは `melee-transition-summary.json`。

### 検証と限界

- `node tools/test/online_melee_transition.test.js`：新14条件成功。60/120/144/240Hzの硬直明けW保持、ロック有無、写真受理直後の原点、物理/offset非変更、機体内の照準を中心へ寄せないことを確認。`--revision=10dda30` は120Hz終了歩行で期待どおり失敗し、上記回帰を検出する。
- `node tools/test/online_melee_view.test.js`：36条件成功。内部release.posの検査を合成描画位置の連続性へ置き換えた。生命・被弾・転送・大差・欠落・低FPS・同型連打などの条件を維持。写真なしで歩行からリフト面へ入ると残差が期限を超えて残る境界も追加検査し、新しい非予測表示に切り替わる際に旧近接残差を消す修正を加えた。
- `node --test tools/test/online_*.test.js`：下節の行動不能視点も含め20/20成功。F入力回帰も維持。秘匿境界VM91項目、名前検査14ファイル、変更JS構文、diff検査成功。独立レビューでも新14条件と高Hz終了歩行の回帰解消を確認。
- `quick_check.js origin/main`、`recoil_lock_check.js dbg`、`bot_battle.js dbg city,wide,mesa,dock 150` はPlaywrightのChromium実行ファイル未配置で起動前停止。既知のシステムChromium socket制限もある。最終版のブラウザ/WebGL/実WebRTC/実入力/全マップBot戦/操作感は未確認。
- 終了歩行は線形の移動代役、ロックは本体のanglesTo/lockStick/updateLocalHumanAim/updateCameraを使うが、選択/遮蔽/地形/命中/輸送は代役。新VMは実回線や実機のFPS測定ではない。今回の製品変更は `game.js` と `index.html` の座標整合のみ。F修正・ホストの命中/移動/消費/硬直・バランスを変えず、draft維持、main/gh-pages/正式公開へ反映しない。

比較を再生成する例（各commitのローカル履歴が必要）：

```sh
node tools/test/online_melee_transition_fixture.js --revision=ab43ed8
node tools/test/online_melee_transition_fixture.js --revision=10dda30
node tools/test/online_melee_transition_fixture.js
node tools/test/online_melee_transition.test.js
```

試験Site更新後は両画面を再読込し、特にロック付き踏み込み中、攻撃を終えてWを押し続けた時、60Hzと高Hzの差を実機で確認する。配信の成功と操作感の解消は別々に判断する。

## 行動不能後の見回しが写真ごとに戻る問題（2026-11-08）

オーナーの「行動不能後にマウス動かして見回すとガガガガ！ってなるんだけど」を受けて追加調査。`discontinuityReason` が行動不能/大破待機の全写真をdown境界と扱い、30Hzの写真ごとに手元のyaw/pitchをホストの倒れた向きへ戻していた。移動hard-snapは維持し、同じ生命でalive=falseが続く場合の見回しだけ保持する。F大破の前後も同様。初回死亡・即時大破・蘇生・再出撃・装備変更・motion/lag epoch・転送の境界は既存の向きへ合わせる。通常移動と同じく位置の大差だけを理由に見回しを戻さない。

- 本体の `downTick` と `wreck` を使い、オフラインでもF前後のyaw/pitchと倒れた模型のdownYawは別で、見回しを保つことを照合した。キルカメラ中の専用視点とendKillcamの向き変更は今回対象外。
- 30Hz人工写真＋毎秒120度の相対マウスを2秒入力。60Hzで逆向き59frame→0、最大逆行2度→0、写真受理時の最大巻戻し4度→0。144Hzは60frame→0、3.333度→0、4.167度→0。行動不能継続・大破待機・F途中移行の3条件で確認。計6条件の前後値とsource hashは `downed-view-summary.json`。
- `online_downed_view.test.js`：6描画条件・19境界成功。見回し中のF送信、移動しないこと、位置hard-snap、生命/装備/転送境界を確認。`--revision=10dda30` では60Hzの逆行59frameを検出して失敗する。Fのホスト実行は既存 `online_downed_input.test.js` で検証し、新fixtureの大破遷移写真は人工列として区別した。
- 最終統合のオンラインNode20/20成功。近接36条件・境界14条件・行動不能F・通常camera36条件などを含む。実lookMove/beforeFrame/codec/updateCameraを接続した平地VMであり、ブラウザ/OSのマウス配送、WebGL、実WebRTC、実機の操作感は未確認。上節と同じChromium起動制限のため、最終版quick_checkのブラウザ部分も未検証。

再現：`node tools/test/online_downed_view_fixture.js --revision=10dda30`、`node tools/test/online_downed_view_fixture.js`、`node tools/test/online_downed_view.test.js`。試験Siteでは行動不能中に見回す→Fで大破→待機中にも見回す→再出撃、味方による蘇生を別々に確認する。

## 画面の震え・コマ送りの自動検知（2026-11-08、Claude）

オーナー「画面震えとか敵の震えとか、コマ送り的な表示になるとことか、AIのテストプレイで検知出来ないんかな」→「作ってください」。

`tools/test/online_jitter_check.js`（`node tools/test/online_jitter_check.js dbg <出力先> --mock-transport`）。ほかの試験は描画を止めて決まった刻みで回すので、
画面の速さの違い・通信の揺らぎ・途中のガタつきが出ない。この試験は実時間で、ホスト60Hz・ゲスト約144Hz（7ms前後）のコマ、代替通信に片道25〜60msの揺らぐ遅れを入れ、
ゲストが「歩き旋回」「動く敵をロックして左右に横移動」「カタパルトで飛びながら見回す」をする間、毎コマのカメラの向き・位置、自機・敵・味方・ロックの枠の画面上の位置を
1080p に直して記録し、1コマだけ外れた動き（跳ね・止まり・震え、1.5px以上）を数える。1場面2回までなら合格。

| 版 | 結果 |
|---|---|
| 1905251（#217 の前） | 不合格。ロック中の敵とロックの枠の震え 144〜160回、歩き旋回の味方の止まり83回など |
| ab43ed8（この試験の前の #214） | 不合格。カタパルト中のカメラの向き 50回前後（最大 30〜40px）、位置 40回前後 |
| この変更の後 | 3回続けて合格 |

この試験で見つけて直したこと（`prototype/online/game.js`）：

1. カタパルト・ジャンプ台など先読みを止める間、写真のたびにホストの向き（少し前に自分が送った値）で今の向きを戻していた。見回すと画面が引き戻され、止まっていても向きが行き来した。向きを戻すのは再出撃・移動・ダウンだけにした（`online_camera.test.js` に2件追加）。
2. 飛翔中の描画の先読みが速度だけで重力を入れておらず、写真の間に上下のずれが増えて写真ごとに波打った。重力を足し、写真ごとの食い違いは1コマに1割ずつ寄せる（3割だと速さが写真ごとに脈打った）。
3. 先読みの上限が100msで、遅れ＋写真の間隔が超えると描画が一瞬止まりかけて次の写真で跳んだ。250msにした。
4. 止まっていた機体は変化が無いので写真に載らず、動き出した最初のコマで古い記録からの残りを一度に進めて跳んだ（2m以上）。前の記録で止まっていたら、1つ前の写真の時刻にも同じ所にいたことにする。

分かっていて数えないこと：試験の機械が詰まってコマの間隔が揃わないコマ（引っかかり）。ロック追従はそういうコマで1〜2px乱れる（通信と関係なく起きる）。実WebRTC・実GPU・人の感じ方は測っていない。

## ロビーのReady・装備編集の回帰（2026-11-09）

- `node --test tools/test/online_*.test.js`：20ファイル成功。部屋設定・本人だけの装備変更解除・全員Readyの開始条件・装備中の拒否・古い設定のReady拒否・不正装備拒否・本人限定通知・30秒抑制・試合後/退出時のリセットを含む。通信代役/VMの回帰であり、実WebRTCや描画の成功ではない。
- `node tools/test/names_check.js`：14ファイル、重複キーなし。`node --check prototype/online/game.js`・`prototype/online/ui.js` と `git diff --check` も成功。
- 新規 `online_ready_check.js` は2画面で明示Ready、武器/パーツ変更、取消、保存不変、手動開始、選択装備/機体の反映、試合後と退出を確認する手順。既存のUI・部屋設定・結果画面・開始試験にも明示Ready操作を追加した。
- この実行環境ではブラウザ起動前に停止。Playwrightの指定Chromiumが未導入で、利用可能なシステムChromiumも `socket() failed: Operation not permitted` となった。したがって新規ブラウザ試験・画面/コンソール確認・quick_check は未完了。装備の組合せや実回線での操作感は未検証のまま。
- 統合後に再実行する順：上記Node回帰、`python3 tools/test/make_dbg.py dbg`、`node tools/test/online_ready_check.js dbg <出力先> --mock-transport`、`online_ui_check.js`・`online_room_check.js`・`online_result_buttons_check.js`（同様の引数）、`node tools/test/quick_check.js origin/main`。ブラウザを複数同時に起動しない。代替通信と実WebRTCは結果を分ける。

## 端末内の試験ログ（2026-11-09）

`online/game.js` 冒頭の診断Recorderがホスト・ゲストそれぞれで記録する。オンライン作成/参加から2秒ごとに集計し、参加/切断/試合終了/ロビー復帰/退出/タブ非表示の境界では状態を消す前にも確保する。サーバーへのログ送信、投稿、アップロードは追加しない。診断UI/CSSは既存の `online/ui.js` / `online/ui.css` 内に収め、配布の既存7資材の構成を変えない。

- ロビーの計測設定、通常メニュー、結果画面の「診断ログ」から全文プレビューを開く。コピー/テキスト保存は別の明示操作。プレビュー後に記録が増えても、コピー/保存する内容は表示した時点で固定する。clipboard不可なら本文を選択して手動コピーできる。保存済み記録の消去も可能。
- 記録はメモリと専用 `localStorage` キー `coreBreakerOnlineDiagnosticsV1` に置く。15秒ごと/境界で保存し、再読み込みにも残す。最大3接続、接続ごと300標本/128イベント、保存JSON合計512KiB。上限では古い標本を捨て、件数を記録する。最後の試合終了/切断直前の要約は通常標本と分け、ロビーで待って標本が一周しても残す。再表示・次回保存時に7日超を除去する。突然のクラッシュでは直前15秒程度を失い得る。保存不可でも現在画面内のプレビューは残る。別タブの保存は直近分を取り込み、現在接続を優先するが、ブラウザの同時書込みには完全な履歴保存を保証しない。削除後も接続中/他タブの新規記録は続く。
- 許可リスト方式。ホスト/ゲスト、固定の状態/理由コード、端末UTC開始時刻と経過ms、表示版（Ver番号）/通信版、組み込みマップコード、参加人数/定員/片軍人数、可視状態、数値集計だけを保存する。IP、部屋/試合/接続/参加者/機体ID、名前、チャット、SDP、ICE情報、UA、ページURL、位置、装備、任意のエラー文字列は保存しない。raw `metrics()` は使わない。保存からの復元でも同じ許可リストで再構成し、未知のキー/文字列/NaN/Infinity/範囲外値を捨てる。
- 数値: FPS（実フレーム間隔から算出）、直近2秒のframe/JS CPU/写真到着間隔、受信したhostのframe/CPU、写真年齢、アプリping RTT（hostは相手を識別しない最小/平均/最大）、送受信JSON UTF-8バイトとメッセージ数、control/snapshot別バイト、送信待ち/混雑上限、人工遅延/欠損設定、アプリ内破棄数、補正/hardSnap/固定理由、先読み停止/反復控除/視点上書き防止、補間/基準再同期、射撃ラグ補償。
- JSONバイトは既存transport計数値。WebRTC/IPヘッダー・再送・回線全体の量を含まない。欠落数はアプリの破棄/注入であり、回線パケット損失率ではない。JS CPUはGPU完了待ちを含まない。host値は最後の受信申告値。各時系列は端末時計由来であり外部監査による真正性は保証しない。回線原因は推測せず、未知の原因は `other` とする。累計の適用範囲・未取得値はログ冒頭に明記する。

検証:

- `node --test tools/test/online_diagnostic_log.test.js tools/test/online_diagnostic_ui.test.js tools/test/online_diagnostic_lifecycle.test.js`: 許可リスト/復元/上限/保持期限/保存不能/複数タブ、明示コピー/保存とプレビュー固定、失敗時選択、リセット前確保、IDなしtransport集計をNode/VMで確認。
- 既存 `tools/test/online*.test.js` を順次実行。`names_check.js` と `make_dbg.py` も確認。
- `node tools/test/online_diagnostic_log_check.js dbg /tmp/online-log-check --mock-transport` は実ブラウザ用の再検証手順。現在の実行環境ではPlaywright既定binaryが無く、既存 `/usr/bin/chromium` も通常/許可要求付き実行とも `socket() Operation not permitted` で起動前に停止した。ブラウザでの画面配置/clipboard/ダウンロード、quick_check/通常Bot戦、実WebRTC/実回線は今回未検証。VM成功と混同しない。

## 定型通信・Ready・端末内ログの部分統合（2026-11-09）

最新の #214 `b147a6a` を基点に、V→数字の定型通信、明示Readyと部屋専用装備、端末内診断ログを統合した。全4兵装・全武器の同期拡張は別段階で、この時点では未完了。main・gh-pages・正式公開版は変更しない。

統合で直したこと:

- 定型文「準備できた」はReady状態を変更しない。明示Readyを必要とする契約を試験へ追加した。
- 診断プレビューを開くと定型通信メニューを閉じ、V/数字/Escapeを背後の通信へ横取りしない。閉じた後は再び通信できる。
- Ready/装備中の更新で、ホストの未反映のマップ・人数等を元へ戻さない。同じ確定設定の通知だけを区別し、確定変更・拒否・退出後は正しい設定を反映する。
- 診断ログは既存のgame.js/ui.js/ui.cssへ収めた。新規配布資材を追加せず、配布7資材と保護された生成器を維持した。
- 装備の保存不変検査は、独立して増える診断専用キーだけを除外し、オフライン構成とその他の保存キーを引き続き比較する。

確認済み:

- `node --test --test-concurrency=1 tools/test/online_*.test.js`：26ファイル、36テストすべて成功。既存入力・予測・近接・行動不能・秘匿・部屋回帰に加え、定型通信、診断13ケース、ui.js全体のDOM代役での共存操作を含む。
- `node tools/test/online_visibility_check.js dbg <出力先> --node-only`：154項目成功。`names_check.js`：14ファイル、重複キーなし。オンラインJS全ファイルの構文、`git diff --check`、dbg生成も成功。
- `distribution_check.py`：単体24項目成功。未公開の一時Pagesと確認用ZIPを生成し、参照解決・元資材一致・7オンライン資材・manifestのサイズ/SHA-256・ZIP CRCなど141項目成功。生成器のファイルは変更していない。生成物はテスト用で公開していない。

未完了:

- `quick_check.js origin/main` は新旧dbg生成まで成功し、Playwright指定のChromiumが未配置のため起動前停止。追加した実ブラウザの定型通信試験も同じ理由で停止した。利用可能なシステムChromiumのsocket制限も各担当で確認済み。
- ブラウザの画面配置/実キー操作/clipboard/ダウンロード/コンソール、実WebRTC、別回線、人の操作感、全武器・4マップBot戦はこの統合版では確認できていない。Node/DOM代役/配布検査の成功を代用しない。
- 実行可能な環境ではdbgを再生成し、`online_ready_check.js`、`online_quick_chat_check.js`、`online_diagnostic_log_check.js`、既存UI/部屋/結果試験、quick_checkと必要なBot回帰を1本ずつ実行する。通信代替の結果と実WebRTCを分ける。

### 全兵装の戦闘同期（#214、2026-11-09）

兵装/武器の数値や設置上限は変えず、次を同期する。

- 4兵装の再出撃と混成Bot。ロビーで選択した兵装へ戻ると、その兵装のカスタム装備を保持する。他兵装は初期装備で出る。
- SPの作動、二段スコープ、精密誘導、展開レーダー、居合の納刀、ミサイル捕捉、機体と施設への修理先。ゲストのマップ指定/解除/スコープ/誘導操作は既存の番号・生命・期限つき信頼性あり入力へ載せる。
- 地雷、センサー、自動砲台、遠隔爆弾、補給箱、修理装置、残像。許可集合は開始時の装備と再出撃用初期装備から決め、固定枠の空と秘匿を同じ印にする。
- 偵察機、修理装置の投擲、榴弾と独立した着弾予告、熱/電撃の持続領域、照射砲/衛星砲。ゲストは描画のみで、ダメージ・索敵・回復・SP時計を再計算しない。
- 設置物/独立表示が秘匿へ変わった場合も送信待ち写真を破棄する。公開IDは再可視化で変わり、未発見物の出現で番号を増やさない。残像の外見は生成時に固定し、隠れた所有者の現在装備を送らない。

確認済み（ブラウザ不要）：

- `node --test tools/test/online*.test.js tools/test/gun_cycle_vm.test.js`：22ファイル成功。続けて `node --test tools/test/*.test.js` も25ファイル/39テスト成功。
- `online_equipment.test.js`：実武器表/pack/apply/codecで323武器の装備・残弾・SP等の往復、設置48型の生成/削除、施設修理、循環参照を持つ近接硬直、特殊表示の秘匿、榴弾予告、特殊操作の重複/不正拒否、再出撃、切断時Bot引継ぎ。
- `gun_cycle_vm.test.js`：実gunTick/slotOf/missileGunTickで252銃種×人間/Bot×2刻みとミサイルlife検査、計1016ケース。
- `online_visibility_check.js ... --node-only`：154項目。`names_check.js`、`make_dbg.py`も成功。

制限：上のNode試験はWebGL、RTC、実際の命中、音や画面の見え方を検証しない。模型や発射の末端を試験用に置き換えている。今回の実行環境では既定のPlaywright Chromiumが無く、別ブラウザ経路にもsocket制限があるため、ブラウザ試験を成功扱いにしない。全武器実射、4マップ混成Bot戦、追加オンライン装備試験、実回線の帯域/CPUは未確認。全兵装の入口を開けることと、配布テストへ進める品質判定は別とする。

追加した `online_equipment_check.js` は4画面で正規入室/装備API/Ready、全ARMORYの装備・残弾・SP往復、代表6系統のゲスト操作と消費/表示/停止、再試合、切断Botを確認するブラウザ用手順（未実行）。実行例は `node tools/test/online_equipment_check.js dbg <出力先> --mock-transport`。代替通信の成功後も実WebRTC試験は別に必要。センサー/地雷の実設置と秘匿切替の実画面はこの手順に含まれない。

通信量の削減候補は、飛翔/持続物の一覧を丸ごとの差分単位にせずID別にすること、モデル/specなど不変値を繰り返さないこと、センサー回転・索敵パルスを描画時計から再現すること。削減率は未計測であり、ゲーム規則の変更は行っていない。


## 全4兵装・全武器を開放した統合（2026-11-09）

部分統合 `030005ce` に全兵装の戦闘同期を加え、作成/参加/ロビー編集を4兵装・正規カタログ全323武器へ開放した。上の「部分統合」で未完了としたカタログ開放はこの段階で実装済み。`checkedEquipment` は未知の兵装/武器と別枠の正規武器を拒否する。通信規格はv9のまま、`appVersion` を `lobby-ready-1 / all-equipment-1` 付きにして旧部分版との混在を拒否する。ホスト・ゲスト両方の再読み込みが必要。

確認済み（統合した最終コード）：

- `node --test --test-concurrency=1 tools/test/*.test.js`：31ファイル/55テストすべて成功。定型通信・Ready・診断・全UI共存と既存同期/予測/秘匿の回帰を含む。
- `online_equipment.test.js`：4兵装の全スロットの選択肢とARMORYを照合。全323武器を正規装備検査へ通し、装備/残弾/SPのpack/apply/codec往復、設置48型、未知/他枠拒否、再出撃/切断を確認。
- `gun_cycle_vm.test.js`：252銃種×人間/Bot×2刻みとミサイルlifeを計1016ケース。実gunTick等を通すが、模型・発射末端は代役であり命中/実射の保証ではない。
- `online_visibility_check.js ... --node-only`：154項目成功。`names_check.js`：14ファイル成功。オンラインJS/追加試験の構文、`git diff --check`、dbg生成も成功。
- 未公開の一時Pages/確認用ZIPを生成して `distribution_check.py` 141項目成功。既存7資材のまま参照・元データ・manifestのサイズ/SHA-256・CRCを確認。保護された配布生成器、武器/パーツの数値は変更していない。

これから・未完了：

- `online_equipment_check.js` と `quick_check.js origin/main` を実行したが、指定Chromiumが無いためブラウザ起動前に停止。別経路のシステムChromiumにもsocket制限がある。実画面、実キー操作、音、コンソール、全武器実射、4マップBot戦、実WebRTC/別回線/操作感/帯域・CPUは確認できていない。Node成功はその代わりにならない。
- 起動可能な環境でdbgを再生成し、`online_equipment_check.js`、Ready/定型通信/診断/UI/部屋/結果の各ブラウザ試験、quick_check、全武器・4マップBot戦を1本ずつ実行する。装備試験の4画面代替通信成功後も、実WebRTCとセンサー/地雷の実設置・秘匿切替は別に確認する。
- 既存 `auxiliary_equipment_check.js` は歴史的な総数285の固定検査が現323武器に合わない。今回その試験は変更していないため、再利用時は総数検査を現カタログへ合わせてから補助35型の実射試験へ進む必要がある。
- ACK履歴の削減・バイナリ送信は別PRの担当範囲として触っていない。秘匿/武器枠/一覧の追加最適化と、その通信量の測定もこの実装段階には含めない。
- #214はdraft維持。mainへのマージ、gh-pages、正式公開版の更新はしない。生成物は確認専用で公開していない。

## 通信量の削減：受け取り確認の履歴とバイナリ送信（2026-11-09、Claude）

オーナーと Codex との分担（秘匿・武器枠・一覧の送り方は Codex、こちらは通信の部品だけ）。

- 受け取り確認（inputAcks）の `steps`（直近8stepの診断用履歴）を既定で送らない。巻き直しに使う seq・step・seqDt・totalDt・replaySeq・movementSeq・movementIds・actionSeq はそのまま。診断で要るときは `create({ackStepHistory:true})` で8件を送る。ゲスト側は届いた時だけ読む。
- 状態写真の差分（`delta[2]`）を base64 文字列でなくバイナリで送る：`[0xCB][見出しJSONの長さ varint][見出しJSON（delta[2]=0）][差分の生バイト]`。受け手は base64 に戻して元のJSON文字列を作り直し、今までと同じ検査に通す。分割する大きな基準写真は今までどおり文字。通信規格を v10 に上げた（チャネル名も -v10）。

`online_snapshot_check.js`（mesa・10機・自然Bot戦300秒、モック通信。Bot戦は乱数で同じ試合ではない）での前後：

| | 030005c | 本変更のみ（030005cの上） | b733504（Codex の削減） | b733504＋本変更 |
|---|---|---|---|---|
| 写真1通の平均 | 3483 B | 2305 B | 3038 B | 1536 B |
| 写真の p95 / 最大 | 4899 / 6254 B | 3792 / 5612 B | 4418 / 6832 B | 2576 / 3814 B |
| inputAcks（最大の写真） | 1036 B | 172 B | | |

確認（b733504の上）：`node --test tools/test/online_*.test.js` 38本、ブラウザ試験（モック通信）snapshot 13、online_check 41、channel 6（実PeerJS）、jitter 8、smooth_view 12、view_turn 4、feedback 6、local_fire 6、prediction 90、revision 53、result_buttons 14、downed_input 7、lag 200、loss 26、ui 22、room 18、ready 24 成功。visibility は「initial/base CORE/plants/timeを保存」の1項目が失敗するが、b733504 単体でも同じ所で失敗する（本変更の前から）。実回線の2台での確認はまだ。
