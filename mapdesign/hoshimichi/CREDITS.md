# 出典・利用条件と謝辞

## 都市モデル

出典：東京都・千代田区・台東区、国土交通省 Project PLATEAUの公開3D都市モデル。

- [3D都市モデル（千代田区・2025年度）](https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2025)
- [3D都市モデル（台東区・2025年度）](https://www.geospatial.jp/ckan/dataset/plateau-13106-taito-ku-2025)
- [PLATEAU公開データ案内](https://www.mlit.go.jp/plateau/open-data/) / [サイトポリシー](https://www.mlit.go.jp/plateau/site-policy/)

公式公開ビューアの公開カタログとアセットCDNを利用し、建物LOD2（テクスチャなし）、道路LOD3、橋梁LOD2を取得した。b3dm・GLBのDraco圧縮を復号し、軸・座標・高さの基準を変換して600m四方へ切り出した。原典の利用条件は公共データ利用規約1.0、CC BY 4.0互換。個別URL・ハッシュは[試作時の取得記録](https://github.com/chevi0t/core-breaker/blob/5649404/mapdesign/akihabara_city/source-manifest.json)。

## 標高とジオイド高

出典：国土地理院「地理院タイル（標高タイル（基盤地図情報数値標高モデル））」と、標高取得・ジオイド高計算サービス。

- [標高タイル仕様](https://maps.gsi.go.jp/development/demtile.html) / [タイル一覧](https://maps.gsi.go.jp/development/ichiran.html)
- [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)：公共データ利用規約1.0
- [測量計算サイト](https://vldb.gsi.go.jp/sokuchi/surveycalc/main.html)

5mメッシュのPNG標高タイルを4m格子へ補間し、欠測を含む面は描画しない。中心標高5.7m・中心ジオイド高36.8651mを参照した。道路が埋まる箇所は地面を下げて加工している。加工後の地形表示は制作側が作成したものであり、国土地理院の原データそのものではない。

都市モデルと地理情報を整備・公開してくださった東京都、千代田区、台東区、国土交通省、国土地理院、関係する制作者・事業者・開発者の皆さまに心より感謝します。地区をまたぐ街並みを、共通の座標で確認できることに助けられています。

このフォルダの加工済み地理データと描画画像は、原出典・加工した旨を添えて [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) で利用できる。

## ソフトウェア

three.js r128はMIT License。本体と同じThree.jsを使い、[ライセンス全文](../../vendor/three-r128/LICENSE)をリポジトリで保持する。変換時の `draco3d@1.5.7` はGoogle Draco（[Apache-2.0](https://github.com/google/draco/blob/1.5.7/LICENSE)）、数値計算・画像読み出しにNumPy・SciPy・Pillowを利用し、これらの変換ライブラリ自体はゲームへ同梱しない。

オープンソースの開発者の皆さまにも感謝します。比較用の4m機体は本作独自の簡略形状。地理データのCC BY表記はソフトウェアの各ライセンスを変更しない。

## 対戦用への加工と統合

初版から高架と駅屋根を延長し、道路と川を避けて高架下に店舗を追加した。路地を保護しながら建物の区画単位で輪郭と高さを単純化し、基地の更地化、地面の平坦化、川底・水面・護岸・復帰坂を追加した。窓・ガラス・建物の色は模式表現で、写真や看板・公式ロゴの画像を使用していない。ランドマークの位置照合には国土地理院の住所検索とOpenStreetMap contributorsの施設点も参照した。色はユーザー指定、建物の形状はPLATEAU由来。

4地点のプラント、各基地のカタパルト・砲台・レーダー・ポッド、補給場所の窪地・囲い・坂と再出撃地点は本作のゲーム用施設で、現実の施設・避難設備・地下構造を示さない。橙側だけにあった高層棟用ジャンプパッドはユーザー指定で撤去した。承認済みの[対戦試作](https://github.com/chevi0t/core-breaker/tree/5649404/mapdesign/akihabara_city/battle)から形状と配置を引き継ぎ、通常のマップ選択へ接続している。

取得・変換・再構築を支えてくださった自治体・公開データとライブラリの制作者・維持管理者、OpenStreetMap contributors、関係者の皆さまに改めて心より感謝します。
