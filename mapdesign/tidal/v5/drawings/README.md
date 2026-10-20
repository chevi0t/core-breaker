# 橙基地の山岳侵入路を追加した図面

現行の `tidal5`（主配置「屈折前線」）を本体の地面・衝突形状から描く。370×1136m、地形は3配置共通。旧図面はv3/v4に保持する。

- [全体平面図](plan.png)：青を左、橙を右、海側を上に回転。縦横同縮尺。桃色破線が追加した山岳経路。
- [山岳部の拡大平面図](mountain-plan.png)：上が住宅地側、下が橙基地奥。14mの尾根、10mの横断足場、8mの側壁、壁沿いの下り坂を表示。
- [縦断・横断9本](sections.png)：A〜Iが平面図の切断線に対応。Hは山沿い（x=−164m）、Iは側壁越え（z=−480m）。Hだけ縦方向を拡大し、表示範囲を青端から918〜1093mへ絞る。
- [PDF・3ページ](tidal-plan-sections.pdf)：全体平面・9断面・山岳部の拡大図。
- [上層干渉](plan-v2.png)／[複路争奪](plan-v3.png)：プラント配置だけを各戦場へ置換した平面図。

高さは海抜0m基準。全長の縦断A/Bは高さ4倍、中央Cは縦横同縮尺、街区・基地・山岳の断面は高さ2倍。元のA〜Gの位置と採取方法は [v4の説明](../../v4/drawings/README.md)。平面の地面を2m、断面を0.5m間隔で本体から採取し、geometry.jsonに本体・マップのSHA256を記録した。低層住宅の切妻は装飾で、断面では箱の衝突高さを示す。リフトの移動床は固定物から除く。

```sh
source /workspace/.cloud-setup/core-breaker/env.sh
node mapdesign/tidal/sample_drawings.js
XDG_CACHE_HOME=/tmp/core-breaker-figure-cache MPLCONFIGDIR=/tmp/core-breaker-map-mpl python3 mapdesign/tidal/render_drawings.py v5
node mapdesign/tidal/render_views.js dbg/drawings
```

実景のmountain.png・housing.png等は建物と山を確認するため霧を省いて撮影する。ゲーム中の霧・射線・索敵・物理は通常どおり。
