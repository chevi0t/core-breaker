# 熱球・プラント・コア塔・全体マップ

Issue #75。外部の画像・モデルは使用せず、コードで形状と熱球の模様を生成する。

- 熱球：白熱した筋のある球面、回転する光の環、火の粉。描画は3回、形状は使い回す。
- プラント：上部フレームに浮遊結晶、所有色の床リング、占拠ゲージ。従来の占拠範囲と中央支柱の衝突を保つ。
- コア：屋根上から床+84mまで伸びる目印塔。構造とチーム色の光を各1描画に統合。塔への射撃はコアへの損傷にならない。
- 全体マップ：Mで開閉し、ボタンから「中・大・最大」を選択。初期は最大。画面サイズと縦横比に合わせ、カーソルと地点指示も追従する。

```sh
python3 tools/test/make_dbg.py dbg/battlefield
node tools/test/battlefield_visuals_check.js dbg/battlefield dbg/battlefield/results
node tools/test/secondary_weapons_check.js dbg/battlefield
node tools/test/artillery_check.js dbg/battlefield
node tools/test/tutorial_check.js dbg/battlefield
node tools/test/quick_check.js origin/main
```

確認用のpngは上記試験で生成できる。外部フォントのTLSエラーを避けるため、この環境の既存副武器/榴弾砲試験ではPlaywrightの事前フックでフォントCSSだけを空応答にして検査した。ゲーム本体の通信や試験の計算は変更していない。

検証結果：固有49項目、副武器44項目、榴弾砲125項目、チュートリアル13課題、city/dock各60秒のBot戦が成功。JavaScript・WebGLエラーなし。既存の武器/パーツ/マップデータの変更なし。
