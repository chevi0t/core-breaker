# 双湾展示区・点群による実寸1/3の地形確認版

ユーザーが選んだ39区画を、点群と地理院の建物輪郭から再構築した地形の初稿です。縮尺はユーザー確認済みの**実寸1/3**、回転は40.7度、外接範囲は約1330×620mです。

これは地形を確認する段階のデータです。基地・プラント・カタパルトは未配置で、ゲームへの登録、実機体の移動・落下・脱出、BOT対戦はまだ検証していません。PR #64の旧半縮尺マップへの差し替えも未完了です。旧案の試験結果を、この新しい地形の試験結果として扱わないでください。

## 取得・再構築した内容

- 添付 `filelist.txt` の実数は39件。公式配信元のZIP合計2,987,916,318バイト、LAS合計5,619,759,094バイト、165,285,697点。
- 元の点群を順番に読み、実寸1m格子へ地表・最高標高・撮影色を集約。元LASをゲームへ同梱せず、建物の単純な立体・主要な屋根の段差・道路・水域・草地・高架として保存しました。
- 地理院の建物輪郭398件を高さと照合。屋根として成立する高さが取れず、地面が観測できた53件は高い箱にせず空地としました。点が欠損する1件はPLATEAUの高さを補助資料として使用しています。
- 普通の建物は外周と最大3段程度の屋根で表し、囲まれた小さな屋上穴を残す内周は埋めています。道路・水面は輪郭を保持し、プラント位置による地形の切り欠きは行っていません。
- 会議棟の逆四角錐と門状ビルの貫通アーチは、点群で測れた屋根の位置・向き・主要寸法と、外観写真の情報を合わせた独自の簡易形状です。点群で見えない下面を、測量から復元できた形状と説明しないこと。
- データセットは2024年公開、LASヘッダーの作成日は2023-10-30です。現況の新築施設がすべて反映されているわけではありません。

## データと表示

`terrain.json` が地形確認モデルです。量子化後に輪郭の妥当性を確認しています。`coordinateStep` は0.05ゲームm、座標と頂点番号は16bitで保存しています。モデルは500,000バイト以内です。確認HTMLにはthree.jsと機体見本も含むため、地形データ単体より大きくなります。

`viewer-template.html` には全体・真上・主要ランドマークへの切り替え、回転・移動・拡大縮小、稜線の表示があります。比較用として、黄色い高さ8mの棒と、現行ゲームから取り出した約4mの機体モデルを並べています。8m棒を現行機体そのものの寸法と説明しないこと。

## 再生成

Python 3.12で使用しました。`tools/requirements-pointcloud-map.txt` は制作専用で、ブラウザでゲームを遊ぶ人には不要です。大きな原データをGitへ入れないでください。

```sh
python -m pip install -r tools/requirements-pointcloud-map.txt
python tools/odaiba_pointcloud_fetch.py
python tools/odaiba_pointcloud_grid.py
python tools/odaiba_pointcloud_vectors.py
python tools/odaiba_pointcloud_terrain.py
python tools/test/odaiba_pointcloud_terrain_check.py
python tools/test/odaiba_pointcloud_roof_check.py
python tools/odaiba_pointcloud_preview.py
```

キャッシュ既定値はOSの一時ディレクトリ下の `core-breaker-odaiba-pointcloud`、出力先はこのディレクトリです。環境変数 `ODAIBA_POINTCLOUD_CACHE` と `ODAIBA_POINTCLOUD_OUTPUT` で変更できます。空のキャッシュでは約3GBを取得します。ZIPのSHA256を照合し、LASを一括展開せず順番に読みます。

## 確かめたことと限界

- 公開ZIP39件と地理院33タイルの取得記録・SHA256照合。
- 500KB以内、縮尺・範囲・施設非依存、量子化後の輪郭、三角形の頂点番号と面積を検査。
- オフラインの確認HTMLで全体・各ランドマークの表示、JavaScript・WebGLエラーなし、外部通信なしを確認。
- 屋上の検査は上面1m格子での予備検査です。細い隙間や複層の影響を含む候補が残っています。`roof-grid-check.json` は機体の横幅・実移動・橋や門の下の到達性の合格証明ではありません。ゲーム統合後に実機で落下・離脱を確認する必要があります。
- 地形輪郭が確定してから、基地→確認→プラント→確認→移動設備→実走・BOT対戦の順で進めます。

## 出典と謝辞

東京都デジタルサービス局、国土地理院、東京都・江東区・港区および国土交通省 Project PLATEAUの測量・整備・公開に携わった皆さまに感謝します。公開データを、現実の街をゲーム用に再構築する資料として利用させていただきました。

- [東京都区部点群データの説明・CC BY 4.0表記](https://catalog.data.metro.tokyo.lg.jp/dataset/t000029d0000000024)
- [点群配布元の利用規程](https://gic-tokyo.s3.ap-northeast-1.amazonaws.com/2023/dig/doc/license.pdf)
- [地理院ベクトルタイル仕様](https://maps.gsi.go.jp/development/vt.html)
- [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)（CC BY 4.0互換）
- [PLATEAU利用条件](https://www.mlit.go.jp/plateau/site-policy/)（CC BY 4.0互換）
- URLとハッシュは `research/maps/odaiba-pointcloud-third.json`。three.js r128はMITライセンス、表示用の現行機体は本リポジトリのゲームから取り出したものです。外部施設の公式画像・ロゴは同梱していません。

適用した既存知識：M16（縮尺変更時の施設・通路は別に検証）、M32（保存後の輪郭と施設配置の独立性）。地形と施設はユーザー指定の確認順で分けています。
