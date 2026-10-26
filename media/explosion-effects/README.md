# 爆発エフェクトの強化

Issue #65。従来の単色球を、短い閃光、膨らむ火球、衝撃波、火花と軌跡、立ち上る煙へ変更しました。武器の爆風半径に合わせて大きさを変え、煙は最長1.3秒で消します。形状・材質・テクスチャを共有して5つの描画へまとめ、最大32件まで表示します。地図データや武器の威力・半径・音の割り当ては変更しません。

外部の画像・映像素材は使用していません。独自の生成テクスチャと粒の動きで表現しています。

## 確認画面の生成

```sh
python tools/explosion_preview.py /tmp/explosion-preview.html
```

ゲーム本体から同じ爆発の処理とテクスチャを取り出し、three.jsと一緒にHTMLへ埋め込みます。外部通信なしで、通常・小さい炸裂・連続爆発、壁による遮蔽を確認できます。確認画面は無音です。ゲーム内の音の呼び分けは従来のままです。

## 検査

```sh
python tools/test/make_dbg.py dbg/explosions
node tools/test/explosion_visual_check.js dbg/explosions
node tools/test/blast_camera_shake_check.js dbg/explosions
node tools/test/quick_check.js origin/main
```

爆発の126項目、爆風と視界揺れの39項目、city/dockの各60秒のBot戦が成功しました。新しい描画に関してJavaScript・WebGLエラー0、反復時のGPU形状・テクスチャ数の増加なし、壁越しの漏れなしを確認しています。小さな確認場面だけでなく、ゲーム本体の場面も描画しました。

`checks.json` の更新時間は、この環境での爆発32件のCPU更新だけの計測です。機体やBot・描画全体のFPSの計測とは分けて扱います。

## 描画サイズの修正（Issue #73）

武器の爆発は、従来の「通常/小」の固定サイズから、実際の爆風半径に比例する描画へ変更。衝撃波の最大半径を爆風半径に合わせ、火球・煙・火花も同じ倍率で拡縮する。音・寿命・粒数は従来の大小区分を保つ。機体や施設の撃破エフェクトは従来の大きさ。描画中の火球や火花の外形を、ダメージ範囲の境界とは扱わない。

`node tools/test/explosion_radius_check.js dbg/explosions`で、半径2.5〜40mの比例、通常/小の独立性、75種類の爆発武器からの受け渡しを180項目で確認する。既存の描画126項目と爆風39項目も維持。
