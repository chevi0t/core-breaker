# 全体平面図と断面図

現行の `tidal`（主配置「屈折前線」、地形改訂 `tidal3`）を描く。全体370×1136m。地形は3配置で共通、プラントは主配置A〜E。

- [平面図PNG](plan.png)／[SVG](plan.svg)：青の常設基地を左、橙の野戦拠点を右、海側（+x）を上に回転。平面の縦横は同縮尺。
- [断面図PNG](sections.png)／[SVG](sections.svg)：平面図の切断線A〜Eに対応する。
- [PDF・2ページ](tidal-plan-sections.pdf)：平面図と断面図をまとめたもの。

| 断面 | 切断位置 | 対象 | 高さの表示 |
|---|---|---|---|
| A–A′ | x = −38m | 高架沿いの全長縦断 | 横方向に対して4倍 |
| B–B′ | x = +58m | 倉庫屋根と展望台を通る全長縦断 | 4倍 |
| C–C′ | z = 0m | 中央の横断 | 縦横同縮尺 |
| D–D′ | z = +531.2m | 青基地の建屋・荷役屋根 | 2倍 |
| E–E′ | z = −531.2m | 橙拠点の仮設建屋・荷役屋根 | 2倍 |

高さは海抜0m基準。各断面はその切断線上の地面と固定物の当たり判定を描く。リフトは移動範囲、パッドの垂直矢印は理論射出高、菱形は着地先。主配置のコア位置は平面図に表示する。

`geometry.json` は本体の `terrainH` を平面2m・断面0.5m間隔で採取したもの。固定物には本体の衝突用の上下端を使い、橋の下の通路を残す。移動中のリフト床は固定物から除外。データに本体・マップのSHA256を保存している。

```sh
source /workspace/.cloud-setup/core-breaker/env.sh  # このクラウドでのChromium起動設定
node mapdesign/tidal/sample_drawings.js
XDG_CACHE_HOME=/tmp/core-breaker-figure-cache MPLCONFIGDIR=/tmp/core-breaker-map-mpl python3 mapdesign/tidal/render_drawings.py
```

採取スクリプトは専用の `dbg/drawings` を現行本体から作り直して使う。描画はMatplotlib・NumPyとNoto Sans CJKを使う。
