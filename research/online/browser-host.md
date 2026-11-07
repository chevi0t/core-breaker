# ブラウザホスト型オンライン試作（#212）

## 範囲

ホストのブラウザで現在のゲームを動かし、ゲストは PeerJS 1.5.5 の DataConnection で入力を送り、確定状態を表示する。mesa、強襲・重火力の初期装備、人間2〜4人＋Botで10機。時間刻みは既存の可変 dt。予測・ラグ補償・TURN・途中参加・ホスト移譲はない。main には入れず draft PR で確認する。

旧 `codex/212-node-sim-bench` は利用していない。Nodeの無描画CPU値はこの試作へ転用しない。

## 動かし方

```sh
npm install
npx playwright install chromium
python3 -m http.server 8000 --directory prototype
```

ブラウザで `http://localhost:8000/` を開き「オンライン（試作）」からホストが部屋作成、ゲストは部屋IDを入力する。通常は公開PeerServerで接続を仲立ちし、STUNだけを使う。音声・映像は接続しない。外部CDNで固定版PeerJSを読み込む。PeerJS/PeerServerはMITライセンスのソフトウェア依存であり、ゲーム素材ではない。

実試験は次の通り。ローカルPeerServerを自動起動し、固定版のnpm PeerJSを配信する。

```sh
node tools/test/online_transport.test.js
node tools/test/online_check.js dbg /tmp/online-check
node tools/test/online_bench.js dbg /tmp/online-bench
```

`online_bench` は既定で各300秒＋準備30秒。`--seconds=30 --warmup=5` は予備計測のみ。既存libのSwiftShaderを使う環境では実GPU/ユーザーPCの性能とは扱わない。

## 3つの判定と変更箇所

| 判定 | 意味 | 主な変更箇所 |
|---|---|---|
| `isHumanControlled(u)` | 人間から操作される機体 | 経路のBot条件、ジップ離脱、pitch、エリア移動、受け身、行動不能待ち、再出撃、装備、Bot役割、半自動/三点射、反動、近接対象、指示対象、機体更新 |
| `isLocalView(u)` | この画面の自機 | 命中/被弾/破壊/撃破/蘇生通知、カメラ・キルカメラ、ロック解除、スコア、ミニマップ、表彰、警告、武器UI、描画距離、チュートリアル/射撃場 |
| `isSimulationAuthority()` | 試合を計算するホスト/オフライン | gameFrameの試合進行全体、updateHumanUnit、ゲストの直接武器切替を要求へ変換 |

旧isPlayerは従来試験との互換と外部表示のため残す。controller未設定のオフライン機は旧判定にfallbackする。

`collectLocalInput` が入力を採取し、`updateHumanUnit` が共通の操作を行う。グローバルplayer/keys/cameraを遠隔機のたびに入れ替えない。遠隔機は `controlInput`、限定装備は `controlLoadout`。ゲストの視点操作だけ即座に反映し、機体位置・射撃・命中はホスト待ち。他機は受信状態を100ms補間する。

## 状態と出来事

完全な状態を20Hzで送る。機体、装備、飛翔弾、コア、プラント、施設、残り時間、スコア、適用済み入力番号を含む。発射・射線・命中・爆発・音の出来事はコマごとに送る。ゲストでは物理、Bot、武器更新、弾道/爆風ダメージ、補給、施設判断、占拠、スコア/勝敗計算を止める。guest側の表示はホストの確定値へ反映するだけ。

入力保持は最新値、押下操作は未適用分をホストで一度消費。入力番号の重複・逆転、非有限値、許可外装備/出撃地点を拒否する。appVersionと通信規格が違えば理由を表示して入室を拒否する。

信頼性あり・順序ありの1接続/ゲスト。送信バッファを監視し、未送信snapshotは最新へまとめる。送信量はJSONのUTF-8バイト数で、WebRTCの再送・暗号化・ヘッダーを含まない。

## 切断と制約

- 入力が250msない場合は保持入力を解除。3秒ない場合または接続が閉じた場合、HP・位置・装備を保ったままBotへ引き継ぐ。しゃがみなど人間の保持入力とロック対象だけは解除する。入力途絶でも通信が生きている場合、対象ゲストへ理由付き終了を通知し、その接続だけを閉じる。他のゲストは継続する。
- ホスト離脱、5秒の状態途絶でゲストは中断。ホスト移譲なし。
- シグナリングだけの切断では、確立済み対戦接続を閉じない。
- ホストのタブが裏に回るとブラウザが処理を抑制し、試合が止まる/中断する。前面で使用する。
- STUNのみなので直接接続できない回線の組み合わせがある。公開PeerServerの利用も不要になるわけではない。
- 知り合い用の試作。ホストの不正、照準自動化、秘匿情報の完全防御は対象外。

## 計測の区別

実WebRTCと異なる通信代替による機能試験を混同しない。

`--mock-transport` は試験コードだけがPeerJSをBroadcastChannelの代替へ差し替える。実WebRTC接続ができない環境で入力/状態/勝敗/切断ロジックを検査するためで、WebRTCの成立、NAT越え、本番通信性能を証明しない。結果JSONとログにもこの区別を書く。

入力遅延は同一ゲスト時計で入力採取から自機の確定位置を描画したコマまで。射撃遅延は入力から標的HP/命中表示まで。人工遅延50/100msは送信側で1回ずつ追加し、両端で同じ設定にする。実ディスプレイの発光までの計測ではない。人間の実機試遊は別途必要。

20人時の送信量概算は、20機状態を使った1接続あたりの量を19倍する。10機の1/3接続だけを19/3倍してはいけない。19接続でのCPU・回線・ICE成立は未確認として区別する。

## 使用部品

- PeerJS 1.5.5（MIT）: https://github.com/peers/peerjs/tree/v1.5.5 。接続APIを公開している開発者の皆様に感謝します。
- PeerServer (`peer` 1.0.2、MIT、試験専用): https://github.com/peers/peerjs-server 。ローカルで再現できる仲立ちサーバーとして利用します。
- WebRTC の仕組み: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols

ゲームの画像・音・モデル素材は追加していません。

## 再試験を分ける指定

- `online_check.js ... --connections-only`：版不一致・途中参加拒否・通常切断・入力だけ途絶・ホスト終了を再試験。既定では2/4人の試合完走と武器も試す。
- `online_bench.js ... --load-only` / `--latency-only`：負荷と遅延を別々に実行。`--team-size=5|10`、`--guests=1|3`、`--latency-ms=0|50|100` で条件を絞れる。
- 低FPS時の観測送信量を20Hz設計の帯域と混同しない。20機のsnapshotサイズを記録し、20人用の所有者・ack欄を補ったサイズ×20Hz×19接続をsnapshot-onlyの概算として別記する。イベント、暗号化、再送、ヘッダー、19接続のCPU負荷はこの式には含まない。
