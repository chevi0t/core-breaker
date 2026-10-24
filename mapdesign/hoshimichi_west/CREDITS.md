# 出典・加工内容と謝辞

## 都市モデル

東京都・千代田区・台東区・文京区、国土交通省 Project PLATEAUの2025年度3D都市モデルを使用した。

- [千代田区2025年度](https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2025)
- [台東区2025年度](https://www.geospatial.jp/ckan/dataset/plateau-13106-taito-ku-2025)
- [文京区2025年度](https://www.geospatial.jp/ckan/dataset/plateau-13105-bunkyo-ku-2025)
- [PLATEAUのサイトポリシー](https://www.mlit.go.jp/plateau/site-policy/)

公式公開アセットCDNの建物LOD2（千代田区・台東区、テクスチャなし）／LOD1（文京区）、道路LOD3、橋梁LOD2から実寸1,800×1,100mを取得した。出典URL・ファイルのSHA-256はsource-manifest.json。公共データ利用規約1.0／CC BY 4.0互換の条件に従い、加工を明示する。

建物の輪郭と主な屋根高さを再構築し、地面を平坦化し、街全体の縦横高さを1/2にした。進入範囲外の街並みは区画単位の単純な箱へ近似した。詳細側の路地を新しい建物で埋める処理は使っていない。駅の屋根・延長した線路の幅や高さ・線形はゲーム用の模式的な加工で、現実の土木構造や通行可否を示さない。長方形の切り取り枠を東西方向から30度傾けて取得した。街・道路を曲げる処理は行わない。

## 国土地理院

[標高タイル仕様](https://maps.gsi.go.jp/development/demtile.html)の5mメッシュPNGを参照し、水域の欠測や低点から連続した河道の輪郭を推定・簡略化した。河川の測量済み境界を再現したものではない。ジオイド高・中心標高は地理院の測量計算／標高取得サービスで照合した。

- [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)
- [測量計算サイト](https://vldb.gsi.go.jp/sokuchi/surveycalc/main.html)

比較用の600m四方の枠は既存の秋葉原マップの中心139.7734・35.6986から算出し、切り取り座標へ同じ剛体回転で移した。新御茶ノ水駅の表示点は[日本語版Wikipediaの座標API](https://ja.wikipedia.org/w/api.php?action=query&titles=%E6%96%B0%E5%BE%A1%E8%8C%B6%E3%83%8E%E6%B0%B4%E9%A7%85&prop=coordinates&format=json)に照合した目安で、地下駅の全長・全出入口を示すものではない。

都市モデルと標高・地理情報を整備し、公開してくださった東京都、千代田区、台東区、文京区、国土交通省、国土地理院、関係する制作者・維持管理者の皆さまに心より感謝します。

## ソフトウェア

### 2026-10-24の街区再構築案で追加した地理情報

`rebuild/`では、上記のPLATEAU建物・道路・橋梁の未加工メッシュから組み直した。西側の道路の欠測を補うため、[国土地理院の最適化ベクトルタイル](https://maps.gsi.go.jp/development/vt.html)の道路中心線（RdCL）、地上鉄道中心線（RailTrCL）、水域（WA）を加工して使用した。タイルURLとSHA-256は`research/maps/hoshimichi-west-rebuild-reference.json`に保存した。国土地理院コンテンツ利用規約・CC BY 4.0互換の条件で利用する。

この案の川岸は上記の標高格子による推定から、水域ポリゴンの簡略化と曲線化へ変更した。道路の幅、線路の帯幅と上下の高さ、駅屋根、高架下の店舗、復帰斜面、平坦化した地面はゲーム用の模式形状であり、現実の構造・境界・通行可否を示さない。標高は元の建物の地面からの高さの推定に使用した。街区ごとに建物を統合し、場外は同じ区画に沿った低い街並みへ単純化している。

地理情報を公開し、継続して整備してくださっている国土地理院の皆さまに改めて感謝します。ベクトルタイルの復号にはmapbox-vector-tile 2.2.0を制作時のみ使用する。

### 共通の描画・保存方式

three.js r128はMIT License。全文はvendor/three-r128/LICENSEとオフラインHTMLへ同梱する。取得時のDraco復号にはdraco3d 1.5.7（Apache-2.0）を使用する。PythonのNumPy、SciPy、Pillow、Shapely、mapbox-earcutは制作時のみ使用し、ゲームや確認用HTMLへ追加で同梱しない。

既存試作のPLATEAU取得・復号と輪郭再構築を再利用した。保存形式の座標整数化では実行時の可逆圧縮を使わず、Base64化した整数列をHTML内で展開する。共通の底面高と件数などの省略値は復元器で正確に戻し、元の座標・高さ・色・輪郭を変更しない。プレビューHTMLの転送用パッケージだけにgzipを使い、旧案の100KB目標・再構築案の250KB目安の計測値にはそのgzip圧縮を含めない。

オープンソースのライブラリを制作・維持してくださった皆さまにも、地理情報を試作へ活用できることへの感謝を申し上げます。
