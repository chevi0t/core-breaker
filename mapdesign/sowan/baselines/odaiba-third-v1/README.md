# お台場原本v1（複数マップの制作元）

2026-10-26、地表のちらつき修正後にユーザーが採用した状態を保管しています。あとから「**お台場原本v1を使う**」で、この地形を制作元として引き出せます。

**原本は上書きせず、派生先へコピーして使ってください。** この版は基地・プラント・カタパルト未配置の地形確認版です。ゲーム統合・実機移動・BOT対戦の合格済みマップとは扱いません。

## 固定した状態

- 採用時のコミット：`919d44e1ac951a3c4ea5403367a12a487d74cf9b`
- 保存用のGitタグ：`map-baseline/odaiba-third-v1`（この保管ディレクトリと生成ツール一式を含むコミットを指す）
- 実寸1/3、回転40.7度、外接約1330×709ゲームm。元の原点を維持した53区画。
- 建物・橋・高速道路・新交通高架・水域と、同じ高さ0mに分けた地表の材質。
- 地形204,809バイト＋専用描画コード12,671バイト＝217,480バイト。確認HTMLや見本機体・確認画像の容量は別。
- 地表の重複なし・被覆・高さ0m、81条件の描画、オフライン通信0、JavaScript/WebGLエラー0を確認した記録。
- 施設位置による地形の切り欠きなし。芝生の抽出範囲は約432ゲーム㎡で、公園全域の植生を収録したものではありません。

## 今の見た目を開く

[preview.html](preview.html) を単体で開けます。HTMLへ地形・材質・three.js・見本機体を埋め込んであり、外部通信は不要です。[俯瞰図](overview.png) も保管しています。

このHTMLは固定した見た目の保存用です。隣の `terrain.json` を編集してもHTML内のモデルは自動更新されません。

## 派生マップを作る

`terrain.json` と `surface-render.js` を別の制作ディレクトリ（例：`mapdesign/sowan/variants/plan-a/`）へコピーします。範囲・形状を変える場合も、原本を直接編集しません。複数案で同じ原点・縮尺を使えば施設配置や切り取り範囲を比較できます。

先に地形を確認し、基地→確認→プラント→確認→移動設備→実走・BOT対戦の順で進めます。既存の予備検査を、派生マップの移動・対戦の検査として流用しません。

派生した `terrain.json` の確認HTMLは、固定タグ側の `tools/odaiba_pointcloud_preview.py` を使い、`ODAIBA_POINTCLOUD_OUTPUT` に派生先を指定して生成できます。元の `sources.json` から新たに点群を再構築する場合は、下記の固定タグのツールと設定を使用します。

## 生成ツールごと取り出す

元の作業ブランチがなくなった場合も、タグから別ディレクトリへ取り出せます。既存の作業ツリーを戻す操作は不要です。

```sh
git fetch origin tag map-baseline/odaiba-third-v1
git worktree add --detach ../core-breaker-odaiba-original-v1 map-baseline/odaiba-third-v1
```

その作業ツリーの `tools/odaiba_pointcloud_*.py`、`tools/odaiba_ground_surfaces.py`、`tools/odaiba_transport_detail.py`、`tools/requirements-pointcloud-map.txt` と `mapdesign/sowan/pointcloud-third/README.md` に取得・再生成の手順があります。タグは移動・付け直しせず、次の採用版はv2として別保存します。

## 出典と整合性

`sources.json` に原データのURL・SHA256・取得範囲・補助高さ、`REFERENCES.md` に外観の参照と補完方法、`CREDITS.md` に利用条件と謝辞を保管しています。原ZIP約4.1GB・LAS約7.6GBはGitに同梱せず、完成モデルと取得記録を保管しています。このモデルを使うだけなら原点群の再取得は不要です。

`manifest.json` のファイル容量・SHA256で原本の整合性を確認できます。元の生成器・依存関係・テンプレートについても、採用コミット時点のハッシュを記録しています。会議棟や門状ビルの下面は外観参照による独自補完であり、測量で復元した部分とは区別します。
