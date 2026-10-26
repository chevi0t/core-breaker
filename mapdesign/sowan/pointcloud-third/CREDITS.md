# 地形確認版の出典と謝辞

東京都デジタルサービス局、国土地理院、東京都・江東区・港区および国土交通省 Project PLATEAUの皆さまに感謝します。点群と地図・都市モデルの整備、測量、公開に携わる皆さまのデータを、現実の街をゲーム用の形状へ再構築するための資料として利用させていただきました。

- [東京都デジタルツイン実現プロジェクト 区部点群データ2024](https://catalog.data.metro.tokyo.lg.jp/dataset/t000029d0000000024)：CC BY 4.0表記。対象区画を抽出し、標高・色の格子化、形状の再構築、回転・1/3縮尺を行いました。
- [点群配布元の利用規程](https://gic-tokyo.s3.ap-northeast-1.amazonaws.com/2023/dig/doc/license.pdf)
- [地理院地図ベクトルタイル](https://maps.gsi.go.jp/development/vt.html)：[国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)（CC BY 4.0互換）。建物・道路・鉄道・水域の輪郭を加工しています。
- [Project PLATEAU](https://www.mlit.go.jp/plateau/opendata/)：[利用条件](https://www.mlit.go.jp/plateau/site-policy/)（CC BY 4.0互換）。点群で高さを観測できない1件の補助資料として利用しています。
- 原データのURL・SHA256と補助資料の建物IDは `research/maps/odaiba-pointcloud-third.json`。現況を正確に測量した完成品や、各施設による公認を示すものではありません。

会議棟の逆四角錐と門状ビルの開口部は、観測できた主要寸法と外観写真の情報を合わせた独自の簡易形状です。公式の写真・画像・ロゴは同梱していません。

表示にはthree.js r128（MITライセンス）を使用しています。著作権表示は既存の `vendor/three-r128/three.min.js` と生成HTMLへ保持しています。比較用の機体モデルは本リポジトリのゲームから取り出しています。
