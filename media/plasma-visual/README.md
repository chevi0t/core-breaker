# プラズマ砲と光弾狙撃ライフルの描画（2026-10-21）

ユーザー指定：プラズマ砲が細すぎて見えないため、ピンクの砲弾と、砲口から広がる輪を追加する。通常の狙撃銃の軌跡は維持する。光弾狙撃ライフルだけは即時の緑レーザーにし、発射直後にはっきり光り、0.4秒ぼやけた軌跡を残す。

## プラズマ砲

[変更前・射手の視点](before-ring.png)／[変更後・発射時の輪と砲弾](after-ring.png)／[変更前・約100m先](before-distant.png)／[変更後・約100m先](after-distant.png)

球状の先端、淡い外周、太い尾をピンクにする。普通の光学弾と同じ細い中空の筒だけでは後方から追いにくかったため、先端を実際の弾の位置へ置く。先端の見た目の半径は0.36〜0.75m、尾は0.12〜0.32mで、距離に応じて太くする。尾の最大長10m、発射点より後ろへ伸ばさない規則は継承する。色と寸法は本作の見た目の調整値。

発射したときだけ、補正済みの砲口からピンクの輪を出す。輪は射出方向に直交し、0.28秒で広がって薄れる。機体や弾へ当たり判定は足さない。先端・外周・尾・輪は共有形を使い、光源は増やさない。

## 光弾狙撃ライフル

[発射直後のレーザー](laser-flash.png)／[0.18秒後の残光](laser-afterglow.png)

発射時に、銃口から命中点まで全長を緑に表示する。最初の0.08秒は明瞭な線にし、その後は柔らかいテクスチャへ切り替え、幅を広げながら薄れて0.4秒で消える。着弾演出を発射時へ揃える。元から即着弾の命中処理を維持し、弾が飛ぶように見える筋と白い煙は重ねない。カメラに向く板を50mごとに分け、後方と側方の両方から見えるようにする。

他の狙撃銃と、通常の細いライム色の光学弾は維持する。全286武器・72パーツの定義、装備順、威力・弾速・射程・精度・弾数・発射間隔・爆風・反動の値は変更しない。

## 確認

- `plasma_visual_check.js`：54項目成功。プラズマ砲4型×敵味方、同じ発射点・位置・速度・寿命・威力・爆風、ピンクの先端と尾、共有形、輪の向き・拡大・消滅、壁での消滅を確認。射手から約100m先の先端付近でもピンクの画素23pxを検出した。変更前後の全武器・パーツ・装備順と、光弾狙撃以外の全スコープ武器の白い軌跡も同値。[結果](validation.json)／[ログ](check.log)。
- `laser_sniper_check.js`：33項目・2型×敵味方4ケース成功。従来の威力で即時命中、全長の即時表示、発射直後の強い発光、柔らかい残光、0.39秒での残存と0.4秒での消滅、壁で止まることを確認。[結果](laser-validation.json)／[ログ](laser-check.log)。
- `energy_trail_check.js`：光学兵器39種×敵味方を含む173項目成功。プラズマの色と光弾狙撃の瞬時表示だけ合格条件を更新し、既存の細い軌跡・残光・充填光弾・ロケット・光波・壁との衝突・マップ切替の片付けを確認。[結果](energy-validation.json)／[ログ](energy-check.log)。
- `quick_check.js origin/main`：武器・パーツ・マップの定義変更なし。city/dock各60秒のBot戦が成功。[ログ](quick-check.log)。
- ブラウザエラーなし。画像は本体の射撃・飛翔弾・エフェクトを時間指定で進め、実際のWebGL描画を撮った。弾の色・大きさ、輪、レーザーと残光を目視確認した。外部素材は追加していない。

## 再実行

```sh
python3 tools/test/make_dbg.py dbg/projectile-visibility-after
node tools/test/plasma_visual_check.js dbg/projectile-visibility-after dbg/projectile-visibility-before media/plasma-visual
node tools/test/laser_sniper_check.js dbg/projectile-visibility-after media/plasma-visual
node tools/test/energy_trail_check.js dbg/projectile-visibility-after media/plasma-visual/energy-validation.json
node tools/test/quick_check.js origin/main
```

比較前のdbgはmain `6738151` のHTMLから作った。対象ソースのSHA-256は [source-manifest.json](source-manifest.json) に保持する。
