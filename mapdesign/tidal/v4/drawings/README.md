# 工場街・住宅地追加後の全体平面図と断面図

現行の `tidal`（主配置「屈折前線」、地形改訂 `tidal4`）を描く。全体370×1136m。地形は3配置で共通、プラントは主配置A〜E。

- [平面図PNG](plan.png)／[SVG](plan.svg)：青の常設基地・工場街を左、橙の野戦拠点・住宅地を右、海側（+x）を上に回転。平面の縦横は同縮尺。
- [断面図PNG](sections.png)／[SVG](sections.svg)：平面図の切断線A〜Gに対応する。
- [PDF・2ページ](tidal-plan-sections.pdf)：平面図と断面図をまとめたもの。

| 断面 | 切断位置 | 対象 | 高さの表示 |
|---|---|---|---|
| A–A′ | x = −38m | 高架沿いの全長縦断 | 横方向に対して4倍 |
| B–B′ | x = +58m | 工場・倉庫屋根・展望台の全長縦断 | 4倍 |
| C–C′ | z = 0m | 中央の横断 | 縦横同縮尺 |
| F–F′ | z = +383m | 工場街の作業棟・屋根・設備 | 2倍 |
| G–G′ | z = −371m | 住宅地の路地・共同住宅の屋上 | 2倍 |
| D–D′ | z = +531.2m | 青基地の建屋・荷役屋根 | 2倍 |
| E–E′ | z = −531.2m | 橙拠点の仮設建屋・荷役屋根 | 2倍 |

高さは海抜0m基準。各断面はその切断線上の地面と固定物の当たり判定を描く。リフトは移動範囲、パッドの垂直矢印は理論射出高、菱形は着地先。低層住宅の切妻は装飾で、断面には箱の衝突高さを表示する。

`geometry.json` は本体の `terrainH` を平面2m・断面0.5m間隔で採取したもの。固定物には本体の衝突用の上下端を使い、橋の下の通路を残す。データに本体・マップのSHA256を保存する。

```sh
source /workspace/.cloud-setup/core-breaker/env.sh
node mapdesign/tidal/sample_drawings.js
XDG_CACHE_HOME=/tmp/core-breaker-figure-cache MPLCONFIGDIR=/tmp/core-breaker-map-mpl python3 mapdesign/tidal/render_drawings.py v4
node mapdesign/tidal/render_views.js dbg/drawings
```

採取スクリプトは専用の `dbg/drawings` を現行本体から作り直し、版に対応したフォルダへ保存する。描画はMatplotlib・NumPyとNoto Sans CJKを使う。
