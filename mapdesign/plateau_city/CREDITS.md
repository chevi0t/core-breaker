# 出典・利用条件と謝辞

## 都市モデル

出典：東京都・国土交通省 Project PLATEAU「3D都市モデル（新宿区・2025年度）」公開3D Tiles。

- [配布データの案内](https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2025)
- [国土交通省公開一覧](https://www.mlit.go.jp/plateau/open-data/)
- [公式公開ビューア](https://plateauview.mlit.go.jp/)
- [PLATEAUサイトポリシー](https://www.mlit.go.jp/plateau/site-policy/)：公共データ利用規約1.0、CC BY 4.0と互換。

建物LOD2（テクスチャなし）、道路LOD3、橋梁LOD2を取得し、Draco圧縮を復号、座標・軸・高さの基準を変換して600m四方に切り出し、材質・色・輪郭線を付けた。公式ビューアの公開カタログAPIと公開アセットCDNを利用した。個別の取得URLとハッシュは [source-manifest.json](source-manifest.json)。G空間情報センターの配布ページはこの環境では403のため直接ダウンロードせず、公式カタログで参照される公開リソースを用いた。

## 標高と高さの基準

出典：国土地理院「地理院タイル（標高タイル（基盤地図情報数値標高モデル））」および標高・ジオイド高の計算サービス。

- [標高タイル仕様](https://maps.gsi.go.jp/development/demtile.html)
- [タイル一覧](https://maps.gsi.go.jp/development/ichiran.html)：`dem5a_png`、5mメッシュ（レーザ）
- [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)：公共データ利用規約1.0。
- [測量計算サイト](https://vldb.gsi.go.jp/sokuchi/surveycalc/main.html)

地理院タイルのPNG標高を復号し、4m格子に補間して地面を作成した。中心標高35m・中心ジオイド高37.0995mを参照した。道路が地面に隠れる箇所は、周囲1格子の余白を含め地面を道路より低く加工した。加工後の地形は国土地理院の元データそのものではなく、コアブレイカー制作側の確認用表示である。

都市モデルと標高データを整備・公開してくださった東京都、新宿区、国土交通省、国土地理院、関係する制作者・事業者・開発者の皆さまに、心より感謝します。公開データがあることで、街区の形や道路の上下を実際の形状から確かめられました。

このフォルダの加工済み地理データ・その描画画像は [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) として、上記の原出典および加工した旨を添えて利用できます。

## ソフトウェア

- three.js r128：MIT License。既存の `vendor/three-r128/three.min.js` を単体HTMLへ埋め込み、[ライセンス全文](../../vendor/three-r128/LICENSE) をHTML内にも保持する。
- Google Draco / `draco3d@1.5.7`：[Apache License 2.0](https://github.com/google/draco/blob/1.5.7/LICENSE)。変換時にのみ使い、復号ライブラリ自体はHTMLやこのフォルダへ同梱しない。
- NumPy・SciPy・Pillow：変換時の計算・画像読み出しに利用し、ライブラリ自体はHTMLへ同梱しない。

3D表示・圧縮形式・地理情報を扱うオープンソースの開発者の皆さまにも感謝します。4mの比較用機体は本プロジェクト独自の簡略形状です。上記の地理データのCC BY表記は、ソフトウェアの各ライセンスを変更するものではありません。
