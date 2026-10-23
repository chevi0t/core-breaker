# 出典・加工内容と謝辞

出典：東京都・国土交通省 Project PLATEAU「3D都市モデル（新宿区・2025年度）」、国土地理院。

- [3D都市モデル（新宿区・2025年度）](https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2025)
- [PLATEAUの公開データ](https://www.mlit.go.jp/plateau/open-data/) / [サイトポリシー](https://www.mlit.go.jp/plateau/site-policy/)
- [国土地理院・標高タイル](https://maps.gsi.go.jp/development/ichiran.html) / [利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)
- [初版の取得URL・SHA-256](../plateau_city/source-manifest.json) / [初版の利用条件・加工内容](../plateau_city/CREDITS.md)

初版の建物LOD2（テクスチャなし）、道路LOD3、橋梁LOD2とDEMの配置を資料にし、600m四方の建物輪郭・主要高さを単純化した。一般地面を平らにし、現地の上下関係についてユーザーから提供された指摘に基づき、下道・地上道路・歩行デッキ・復帰坂・公園の盛り土をゲーム用に再構築した。道路の高さ・幅と公園形状は仮値で、自治体の原データや実際の地下構造そのものを表すものではない。写真・看板・公式ロゴの素材は使用していない。

東京都、新宿区、国土交通省、国土地理院、公開データの作成・整備・公開に携わる皆さまに心より感謝します。建物と街区の位置を公開データから確認できたことで、ゲームに合わせて作り直しながら街並みの特徴を残すことができました。

このフォルダの加工済み地理データと描画画像は、原出典および加工した旨を示して [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) で利用できる。

Three.js r128はMIT Licenseで、[ライセンス全文](../../vendor/three-r128/LICENSE)をHTMLにも保持する。NumPy・SciPy・Pillow・Shapely・Mapbox Earcut・fast-simplificationは変換時に使用し、ライブラリ自体は地形データへ同梱しない。4mの比較用機体は本作独自の形状。オープンソースの制作者・維持管理者の皆さまにも心より感謝します。地理データのCC BY表記はソフトウェアのライセンスを変更しない。
