# 双湾展示区の出典・加工・謝辞

ゲームの「双湾展示区」（`prototype/maps/sowan.js`）は、[点群による実寸1/3の地形確認版](pointcloud-third/README.md)を遊べる形へ変換したものです。

## 地理データ

東京都デジタルサービス局、国土地理院、東京都・江東区・港区および国土交通省 Project PLATEAU の皆さまに、心から感謝します。点群・地図・都市モデルの整備、測量、公開に携わる皆さまのデータのおかげで、現実の湾岸の街をゲームの戦場として組み立てることができました。

- [東京都デジタルツイン実現プロジェクト 区部点群データ2024](https://catalog.data.metro.tokyo.lg.jp/dataset/t000029d0000000024)（CC BY 4.0表記。[点群配布元の利用規程](https://gic-tokyo.s3.ap-northeast-1.amazonaws.com/2023/dig/doc/license.pdf)）
- [地理院地図ベクトルタイル](https://maps.gsi.go.jp/development/vt.html)（[国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)、CC BY 4.0互換）
- [Project PLATEAU](https://www.mlit.go.jp/plateau/opendata/)（[利用条件](https://www.mlit.go.jp/plateau/site-policy/)、CC BY 4.0互換）
  - 点群で高さを測れない建物1件の補助
  - 建物の壁の色：国土交通省 3D都市モデル 建築物モデル LOD2 テクスチャ付き（東京都 港区・江東区・品川区、2025年度版、3D Tiles）。目録は [PLATEAU VIEW のデータカタログ](https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets)（`13103_bldg_lod2`・`13108_bldg_lod2`・`13109_bldg_lod2`）

原データのURL・SHA256は `research/maps/odaiba-pointcloud-third.json` にあります。

## 加工

対象区画の切り出し、回転、実寸1/3への縮小、標高と撮影色の格子化、撮影色の正射画像化と影の補正、木の抽出、建物の外形と屋根の段差の再構築、地面の平坦化、橋・高架・新交通の単純化と通れる高さへの補正、岸壁、配色、ゲーム用の基地・プラント・カタパルト・リペアポッド・遮蔽用の塀・Botの通り道の追加。変換は `tools/build_sowan_third.py`。

地面・屋上・橋の床の色は、点群の撮影色を真上から見た画像（`photo.webp`）にして貼っています。撮影時の影は、点群の高さから計算した太陽の向きで明るさを戻し、彩度と明暗を少し上げています。木の位置・高さ・枝の広がりも点群から取りました（`trees.npz`）。作るのは `tools/sowan_photo.py` です。

建物の壁の色は点群に入っていないので、PLATEAU の建築物モデルに貼られた航空写真から、建物ごとに色を1つ取りました（`walls.json`、作るのは `tools/sowan_walls.py`）。壁の面だけを選び、写真の青かぶりを地面の写真の色合いへ直し、影と窓を除いた明るい側を平均しています。ゲームに入れたのは色の値だけで、PLATEAU の形や写真そのものは同梱していません。斜めの写真を1棟ずつ壁へ貼るという大変な整備のおかげで、真上からの点群だけでは分からなかった街の横顔の色を知ることができました。重ねてお礼申し上げます。PLATEAU に写真付きの形が無い建物は、点群の屋根の色から決めています。窓の模様は入れていません。木の緑、桜の色、海と空の色は独自に選びました。

現実の安全な通行範囲や現況を正確に示すものではなく、各施設・団体による公認や提携を示すものでもありません。会議棟の逆四角錐、門状のビルなどは、測れた主要寸法に合わせた独自の簡易形状です。公式の写真・画像・ロゴは同梱していません。

橋・新交通システムの構造は、日本橋梁建設協会の紹介情報、Wikipedia の橋の写真、[ゆりかもめ公式・システムの説明](https://www.yurikamome.co.jp/feature/comfortable/system.html)を参考にしました（[参照範囲](../../research/maps/odaiba-transport-reference.md)）。分かりやすい資料を公開してくださった皆さまに感謝します。
