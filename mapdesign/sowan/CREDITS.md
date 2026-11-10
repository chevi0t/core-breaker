# 双湾展示区の出典・加工・謝辞

ゲームの「双湾展示区」（`prototype/maps/sowan.js`）は、[点群による実寸1/3の地形確認版](pointcloud-third/README.md)を遊べる形へ変換したものです。

## 地理データ

東京都デジタルサービス局、国土地理院、東京都・江東区・港区および国土交通省 Project PLATEAU の皆さまに、心から感謝します。点群・地図・都市モデルの整備、測量、公開に携わる皆さまのデータのおかげで、現実の湾岸の街をゲームの戦場として組み立てることができました。

- [東京都デジタルツイン実現プロジェクト 区部点群データ2024](https://catalog.data.metro.tokyo.lg.jp/dataset/t000029d0000000024)（CC BY 4.0表記。[点群配布元の利用規程](https://gic-tokyo.s3.ap-northeast-1.amazonaws.com/2023/dig/doc/license.pdf)）
- [地理院地図ベクトルタイル](https://maps.gsi.go.jp/development/vt.html)（[国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)、CC BY 4.0互換）
- [Project PLATEAU](https://www.mlit.go.jp/plateau/opendata/)（[利用条件](https://www.mlit.go.jp/plateau/site-policy/)、CC BY 4.0互換。点群で高さを測れない建物1件の補助）

原データのURL・SHA256は `research/maps/odaiba-pointcloud-third.json` にあります。

## 加工

対象区画の切り出し、回転、実寸1/3への縮小、標高と撮影色の格子化、建物の外形と屋根の段差の再構築、地面の平坦化、橋・高架・新交通の単純化と通れる高さへの補正、岸壁、配色、ゲーム用の基地・プラント・カタパルト・リペアポッド・遮蔽用の塀・Botの通り道の追加。変換は `tools/build_sowan_third.py`。

色は点群の撮影色（屋根の色と、舗装・アスファルト・芝の基準色）から取り、建物は白〜明るい灰へ寄せ、芝は暗くしています。海の色は点群に無いので独自に選びました。

現実の安全な通行範囲や現況を正確に示すものではなく、各施設・団体による公認や提携を示すものでもありません。会議棟の逆四角錐、門状のビルなどは、測れた主要寸法に合わせた独自の簡易形状です。公式の写真・画像・ロゴは同梱していません。

橋・新交通システムの構造は、日本橋梁建設協会の紹介情報、Wikipedia の橋の写真、[ゆりかもめ公式・システムの説明](https://www.yurikamome.co.jp/feature/comfortable/system.html)を参考にしました（[参照範囲](../../research/maps/odaiba-transport-reference.md)）。分かりやすい資料を公開してくださった皆さまに感謝します。
