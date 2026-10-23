# 出典・加工内容と謝辞

## 都市モデル

出典：大阪市・国土交通省 Project PLATEAU「3D都市モデル（大阪市・2025年度）」北区、建物LOD2・テクスチャなし。

- [大阪市2025年度3D都市モデル](https://www.geospatial.jp/ckan/dataset/plateau-27100-osaka-shi-2025)
- [PLATEAU公開データ](https://www.mlit.go.jp/plateau/open-data/) / [サイトポリシー](https://www.mlit.go.jp/plateau/site-policy/)
- 個別の公開3D Tiles・バイナリURL・SHA-256：[source-manifest.json](source-manifest.json)

公式公開カタログで参照される公開アセットを取得し、Draco圧縮を復号、座標・軸・高さを変換して1km四方を切り出した。建物の輪郭と面積のある屋根からゲーム用の体積を作り、薄い張り出し・屋上小物・小屋を省略した。道路・駅の通路上は下部を空けた。

## 道路と標高

出典：国土地理院「道路中心線（試験提供）」「標高タイル」、標高取得・ジオイド高計算サービス。

- [地理院タイル一覧](https://maps.gsi.go.jp/development/ichiran.html)
- 道路の元データ：`https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/16/{x}/{y}.geojson`
- [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)
- [標高タイル仕様](https://maps.gsi.go.jp/development/demtile.html) / [測量計算サイト](https://vldb.gsi.go.jp/sokuchi/surveycalc/main.html)

道路中心線9タイルの座標・幅属性から舗装を作成した。地下・トンネル・自動車専用の線は地上道路から除外し、幅はゲーム用に補正した。地下街は作らず、中央駅を横断する通路と南北の広場を制作側で補った。収録年代・構造・幅の違いを含み、現実の地下施設・避難経路・道路構造の正確な再現を示さない。

元の高さ合わせには中心標高0.4m・ジオイド高37.5980mと5m標高タイルを使用した。ゲーム用の地面は起伏を省き0mへ平坦化した。加工した表示は国土地理院の原データそのものではない。写真・店舗看板・公式ロゴの素材は使用していない。

大阪市、国土交通省、国土地理院、都市モデルと道路・標高データの制作・整備・公開・維持管理に携わる皆さまに、心より感謝します。建物の形と道路の位置を公開データから確認できたことで、街区の特徴を残したゲーム用の再構築を試すことができました。

このフォルダの加工済み地理データと描画画像は、原出典および加工した旨を示して [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) で利用できる。

## ソフトウェア

Three.js r128はMIT Licenseで、[ライセンス全文](../../vendor/three-r128/LICENSE)をHTMLにも保持する。変換時のGoogle Draco / draco3d@1.5.7はApache-2.0。NumPy・SciPy・Pillow・Shapely・Mapbox Earcut・fast-simplificationも変換時に使用し、ライブラリ自体を地形データに同梱しない。比較用の4m機体は本作独自の形状。

オープンソースの制作者・維持管理者の皆さまにも心より感謝します。地理データのCC BY表記は、ソフトウェアのライセンスを変更するものではありません。
