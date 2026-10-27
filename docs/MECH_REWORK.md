# 機体外装再制作のローカル検証

基準はmain `05d40f8`（`88f4a15` のPR106とPR105を含む）。旧タスクは触らず、取得できない試作ZIPからの復元はしていない。変更は外装形状と旧被弾面の維持だけ。武器・マップ・性能・保存キーを変更しない。

## 動かす

通常版は `python3 -m http.server 8000 --directory prototype` の後 `http://localhost:8000`。ゲーム本体はビルド不要。配布レビューZIPでは `game/index.html` にthree.jsを同梱し、CDN依存を除く。リポジトリの公開用distや配布生成ツールは変更しない。

レビューZIPのルートで `python3 -m http.server 8000` を実行すると、`http://localhost:8000/compare.html` で旧版と新版を並べて角度・距離・武器・屈みを操作できる。`game/` がデバッグフックを含まない実ゲーム。比較ビューアはデバッグ用コピーで、本体へ機能は追加しない。

## 系列の方向

- ハウンド：釣り合いの取れたくさび胸、細い腹、独立肩。全3型の頭は同形。
- スウィフト：狭い胸と薄い肩、細い四肢。
- ハリアー：前へ流れる胸板、後ろへ流れる肩板と踵。
- プリズム：縦の胸パネル、三眼、二段肩。
- ブルワーク：広い胸、厚い外肩、太い脛。
- バスティオン：広い襟、水平な肩、外側の脚支柱。
- ウィスプ：細い上体と頭頂板、既存の軽量ホバー脚。
- スキマー：中量の胸・肩、既存の標準ホバー脚。
- アンカー：厚い胸・肩・襟、既存の重量ホバー脚。

## 再現可能な検査

`npm install` と `npx playwright install chromium` を準備する。任意の `PLAYWRIGHT_BROWSERS_PATH` を指定してもよい。基準版は `git show 05d40f8:prototype/index.html > /tmp/mech-before.html`、`python3 tools/test/make_dbg.py /tmp/mech-before --src /tmp/mech-before.html`。新版は `python3 tools/test/make_dbg.py /tmp/mech-after`。

```sh
node tools/test/mech_rework_check.js /tmp/mech-before /tmp/mech-after /tmp/mech-compatibility
node tools/test/mech_rework_ui_check.js /tmp/mech-after /tmp/mech-ui
node tools/test/mech_rework_performance_check.js /tmp/mech-before,/tmp/mech-after /tmp/mech-performance.json
node tools/test/mech_animation_check.js /tmp/mech-after
node tools/test/mech_shapes_check.js /tmp/mech-after
node tools/test/quick_check.js origin/main
node tools/test/weapons_check.js /tmp/mech-after
node tools/test/bot_battle.js /tmp/mech-after city,wide,mesa,dock 150
```

比較検査は全9系列と極端な混成2構成、各8姿勢で旧被弾面を1e-5単位へ量子化して比較し、正面格子レイの距離・法線・部位の結果を照合する。遅延更新と従来の微小変化スキップとの差は浮動小数点の微小値に現れるため、生のバイト一致とは扱わない。全型の形の統一、武器302種とパーツ120個の定義の一致、ホバー表示と噴流のバイト一致も検査する。残像の旧被弾面と解放も同じ8姿勢で照合する。

性能検査は20/50/100機、同じ系列順・歩行・カメラ・640×400で3回交互に測る。姿勢CPU、各機へ1射線を加えたCPU、描画してGPU完了待ちを含む時間を分ける。これは機体の合成負荷検査であり、BOTの戦闘AIを含む実プレイFPSではない。SwiftShaderはソフトウェア描画。実GPU、スマートフォン、実プレイのFPS同等性はこの環境では証明しない。

実行した版、結果、失敗・未実行はレビューZIPの `REVIEW.md` とログを参照。旧 `mech_series_check.js` は72パーツ固定で現在の120パーツに対応していない。旧 `hover_models_check.js` は二脚の外装不変と被弾面追加なしを前提にするため、この再制作にはそのまま適用できない。共有の古い試験を通すために本体を戻したり、期待値を書き換えたりはしない。

被弾面の遅延更新は従来と同じ包含球のレイ判定を先に行う。球から外れる射線では旧被弾頂点を更新しない。範囲内で判定する部位だけ更新する。

## 100機の射線CPU差の限定調査（追加確認）

懸念は**軽減したが未解決**。同条件の再測定でも100機は旧main 7.3ms、提出済み版11.7msとなり、最初の7.5→9.1msを単なるノイズとは判断しない。値そのものには変動がある。

実ゲームの装甲レイを監査し、描画形状での判定は0件、旧被弾形状での判定は32件だった。three.js r128の `Mesh.raycast` は頂点位置から三角形法線を求め、法線属性は読まない。法線属性をNaNにしても20機のレイ結果は変わらなかった。今回は法線更新の分離には踏み込まない。

部位共通の半径8mの球だけでは、胸を狙う射線でも脚の旧頂点を更新していた。追加の最適化は一案だけ。骨ごとに旧頂点を包む静止箱を作り、現在の骨行列で変換して部位の箱にまとめ、射線が外れる場合は更新・三角形判定を省く。Float32の丸め誤差用に0.0001m広げる。見た目・骨・被弾三角形は変更しない。

一度の交互3反復比較（ミリ秒、標本中央値の中央値）：

| 機数 | 旧main | 提出済み版 | 部位境界追加後 |
|---|---:|---:|---:|
| 20 | 1.2 | 1.4 | 1.2 |
| 50 | 2.7 | 3.6 | 3.0 |
| 100 | 6.3 | 8.7 | 7.4 |

100機で提出済み版より約15%減ったが、同じ比較内の旧main比では約17%の差が残る。骨姿勢の追加変換を必要とする旧被弾面の維持コストであり、同等性能とはしない。全機へ毎フレーム射線を当てる合成負荷で、実GPU・実プレイFPSの証明ではない。追加の方式変更や無制限の再測定は行わない。

`mech_hit_bounds_check.js` は11構成×8姿勢、位置・回転・拡縮を含む57,912本の表裏・接線寄りレイで、旧被弾面の直接判定と完全一致することを確認する。胸への射線で二脚7構成の脚頂点が更新されないことも検査する。承認済み表示とホバーのハッシュは11構成すべて不変。旧形状・残像の比較検査も継続する。

```sh
node tools/test/mech_hit_bounds_check.js /tmp/mech-after /tmp/mech-hit-bounds.json
```

## 腰・肩ブースターの追加改修

ユーザーのJPEG参照はLibraryからこの環境に取得し、640×640の実画像を確認した。配置だけを参照し、画像や他作品のモデルは同梱しない。背面の装飾箱は除去、機能する特殊装備は維持。腰の両側に前後口を持つポッド、肩の外側に横噴射口を追加した。既存の1噴流メッシュ内を4枠に配分し、864三角形と追加1描画を維持する。装甲は4メッシュ・共通Lambert材質、外装は20三角形（60頂点）増。新規の姿勢骨4個に被弾頂点は割り当てない。既存の部位境界による射線最適化も維持する。

移動処理から表示専用の方向を記録し、腰は前後、肩は左右の反対向きへ噴射。斜めでは両成分を使う。滞空は腰ノズルを下へ向ける。ホバー後方噴射は前進成分と同じ発停・余韻へ連動し、後退/横移動/静止/歩行/滞空では消す。下向き噴射の位置・頂点・表示条件・透明度は変えない。旧背中炎は残さない。炎とノズルを追加の被弾対象にしない。

追加の検証：`node tools/test/booster_direction_check.js /tmp/mech-after /tmp/booster-directions`。`node tools/test/booster_gameplay_check.js /tmp/mech-before /tmp/mech-after /tmp/booster-gameplay.json` では改修前3983099と物理・装備位置・下向き噴射の軌跡を照合する。方向一覧を実ゲームのThree.js描画で撮影する。既存の全混成検査の上限は今回の正味20三角形だけを明示して加算する（それ以外の予算は同じ）。当初のリング付きノズルは108三角形増で上限を超えたため、最終形状ではポッドの端面を使い20三角形増へ削減した。

ソフトウェア描画による今回差分の計測と合否はレビューZIPの `BOOSTER_REVIEW.md` を参照。以前の旧main比の性能差が解消したとは扱わない。
