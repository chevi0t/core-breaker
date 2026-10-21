# 爆風を受けたときの視界揺れ

同じ被弾場面をゲーム本体の `renderView` で描画した比較。`before.png` は揺れを抑えた状態、`shaken.png` は被弾から0.04秒後。0.5秒後は揺れを抑えた画像と同じ画素へ戻る。

`validation.json` は専用テストの38項目と、本描画・迷彩描画の一致の結果。距離減衰、自爆、無敵・遮蔽・バリア、炸裂狙撃銃の直撃、ロケット・プラズマ砲・蓄圧砲の実着弾、スコープの揺れ幅、照準用カメラの復元、連続被弾の上限と周期、撃破・再出撃・試合開始・マップ変更を確認する。ブラウザエラー0。

再現：

```sh
python3 tools/test/make_dbg.py dbg/blast-camera-shake
node tools/test/blast_camera_shake_check.js dbg/blast-camera-shake dbg/blast-camera-shake/results
```

強さは実ダメージ6000で上限、被弾から0.45秒で収束する本作用の演出値。武器の威力・爆風の距離減衰・よろけ・吹き飛ばしの規則は従来どおり。
