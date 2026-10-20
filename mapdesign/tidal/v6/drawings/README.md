# 斜め高架とB–C遮蔽の図面

現行tidal6を本体の地形・固定衝突形状から採取。370×1136m、主配置「屈折前線」。全体平面は青を左・橙を右・海側を上に回転し、縦横同縮尺。金色の長い斜めの床が20m高架。床の矩形分割も実データに合わせる。

[全体平面](plan.png)／[上層配置](plan-v2.png)／[複路配置](plan-v3.png)／[断面9本](sections.png)／[山岳部](mountain-plan.png)／[PDF・3ページ](tidal-plan-sections.pdf)。A〜Iは平面の切断線に対応する。Aは固定x=−38mの縦断で斜め橋を途中で横切る。橋に沿う切断ではない。Cはz=0の横断で橋床20m・展望台22m・地上横断路を示す。

地面は本体から2m、断面は0.5m間隔で採取し、geometry.jsonにマップと本体のSHA256を保存した。A/Bは高さ4倍、Cは同縮尺、その他は高さ2倍。リフトの移動床は固定断面から除外する。実景の撮影だけ霧を省略する。

再現：`node mapdesign/tidal/sample_drawings.js`、`MPLCONFIGDIR=/tmp/core-breaker-matplotlib python3 mapdesign/tidal/render_drawings.py v6`、`node mapdesign/tidal/render_views.js dbg/drawings`。Playwrightは環境のenv.shを読み込んで使う。
