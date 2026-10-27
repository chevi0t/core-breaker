# 双湾展示区の出典・加工・謝辞

## 地理モデル

東京都、江東区、港区および国土交通省 **Project PLATEAU** の2025年度3D都市モデルを加工して使用しています。公開された都市モデルの整備・測量・配信に携わった皆さまに感謝します。現実の海岸と街区をゲーム用に再構築するための基礎として利用させていただきました。

- [Project PLATEAUオープンデータ](https://www.mlit.go.jp/plateau/opendata/)
- [江東区2025年度](https://www.geospatial.jp/ckan/dataset/plateau-13108-koto-ku-2025)
- [港区2025年度](https://www.geospatial.jp/ckan/dataset/plateau-13103-minato-ku-2025)
- [PLATEAU公式配信カタログ](https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets)
- ライセンス：[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- 使用層：建築物LOD2（テクスチャなし）、道路LOD3、橋梁LOD2。URL・ハッシュ・範囲は [取得記録](source-manifest.json) と `research/maps/odaiba-sources.json`。

加工：回転長方形での切り出し、XYZ半縮尺、地面・道路の平坦化、外周と屋根に基づく建物再構築、屋上穴・落下ポケットの閉鎖、基地敷地の確保、配色、特徴建物の外形補完、高架の単純化、ゲーム用施設とBOT経路の追加。施設や地形は実際の安全な通行範囲を示すものではありません。

## 海岸・道路

国土地理院の地理院地図・最適化ベクトルタイル（`WA`・`RdCL`）を加工して水域と道路の輪郭を作成しました。継続的な地理情報の整備と公開に感謝します。

- [地理院地図ベクトルタイル仕様](https://maps.gsi.go.jp/development/vt.html)
- [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)（CC BY 4.0互換）
- 地表標高・ジオイドの取得先はPLATEAU取得記録に記載。中心が海面なのでゲームの基準高は海抜0mとしています。
- タイルURL・SHA256は `research/maps/odaiba-reference.json` に保存。輪郭の簡略化、道路幅のゲーム用補正、海岸の浅い水底化を施しています。

## 外観の参照

ユーザー提示の衛星画像を切り出し範囲・配置・建物の位置の参照にしました。ビッグサイトの逆四角錐、テレコムセンターの門型構成などはPLATEAUの敷地と主要寸法に合わせた独自の簡易形状です。

現況を補完した施設は [TOYOTA ARENA TOKYO公式](https://www.toyota-arena-tokyo.jp/) の楕円形構造の説明、および [東京ドリームパーク公式](https://tdp.tv-asahi.co.jp/) の外観パースを参照しました。公式サイトの画像・動画・ロゴはゲームやリポジトリに同梱せず、独自の立体と色だけで表現しています。

取得・参照日：2026-10-25。測量の正確な再現や、各施設との提携・公認を示すものではありません。
