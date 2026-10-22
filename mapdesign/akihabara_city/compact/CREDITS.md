# 出典・利用条件と謝辞

## 都市モデル

出典：東京都・千代田区・台東区、国土交通省 Project PLATEAUの公開3D都市モデル。

- [3D都市モデル（千代田区・2025年度）](https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2025)
- [3D都市モデル（台東区・2025年度）](https://www.geospatial.jp/ckan/dataset/plateau-13106-taito-ku-2025)
- [PLATEAU公開データ案内](https://www.mlit.go.jp/plateau/open-data/) / [サイトポリシー](https://www.mlit.go.jp/plateau/site-policy/)

公式公開ビューアの公開カタログとアセットCDNを利用し、建物LOD2（テクスチャなし）、道路LOD3、橋梁LOD2を取得した。b3dm・GLBのDraco圧縮を復号し、軸・座標・高さの基準を変換して600m四方へ切り出し、単色の材質・輪郭線・位置の目安となる地名ラベルを付けている。原典の利用条件は公共データ利用規約1.0、CC BY 4.0互換。個別URL・ハッシュは [source-manifest.json](../source-manifest.json)。

## 標高とジオイド高

出典：国土地理院「地理院タイル（標高タイル（基盤地図情報数値標高モデル））」と、標高取得・ジオイド高計算サービス。

- [標高タイル仕様](https://maps.gsi.go.jp/development/demtile.html) / [タイル一覧](https://maps.gsi.go.jp/development/ichiran.html)
- [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)：公共データ利用規約1.0
- [測量計算サイト](https://vldb.gsi.go.jp/sokuchi/surveycalc/main.html)

5mメッシュのPNG標高タイルを4m格子へ補間し、欠測を含む面は描画しない。中心標高5.7m・中心ジオイド高36.8651mを参照した。道路が埋まる箇所は地面を下げて加工している。加工後の地形表示は制作側が作成したものであり、国土地理院の原データそのものではない。

都市モデルと地理情報を整備・公開してくださった東京都、千代田区、台東区、国土交通省、国土地理院、関係する制作者・事業者・開発者の皆さまに心より感謝します。地区をまたぐ街並みを、共通の座標で確認できることに助けられています。

このフォルダの加工済み地理データと描画画像は、原出典・加工した旨を添えて [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) で利用できる。

## ソフトウェア

three.js r128はMIT License。既存の `vendor/three-r128/three.min.js` と [ライセンス全文](../../../vendor/three-r128/LICENSE) をHTMLへ埋め込む。変換時の `draco3d@1.5.7` はGoogle Draco（[Apache-2.0](https://github.com/google/draco/blob/1.5.7/LICENSE)）、数値計算・画像読み出しにNumPy・SciPy・Pillowを利用し、これらの変換ライブラリ自体はHTMLへ同梱しない。

オープンソースの開発者の皆さまにも感謝します。比較用の4m機体は本作独自の簡略形状。地理データのCC BY表記はソフトウェアの各ライセンスを変更しない。

## 簡略化案で追加した加工

本フォルダは上記都市モデル・標高から作成したゲーム用の地形確認案。建物の小部品を削除し、外周と主な屋根の高さを基に角柱へ置換し、屋根の高さを1m単位へ丸めた。細い隙間・小さな中庭を新しい低層棟で埋め、既存道路の上を覆う建物は下面に空間を設けた。道路・地面の面数を削減し、元の水平外周へ切り戻した。現実の建物・通路を正確に再現する成果物ではない。新しい充填棟と形状加工も、地理データの改変として上記CC BY 4.0で提供する。

変換時には [fast-simplification 0.1.12](https://github.com/pyvista/fast-simplification)（MIT）、[Shapely 2.2.0](https://github.com/shapely/shapely)（BSD-3-Clause）、[mapbox-earcut 2.0.0](https://github.com/skogler/mapbox_earcut_python)（PythonバインディングISC、earcut本体ISC）を追加利用した。これらは変換環境だけで使用し、生成HTMLには同梱しない。地理データとソフトウェアのライセンスはそれぞれ別に適用する。幾何処理の公開ライブラリを整備してくださる皆さまにも感謝します。
