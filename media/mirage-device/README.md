# ミラージュデバイスの動作確認

Issue #71。`variants.png` はゲームの実モデルを同じ姿勢で残像化した比較。左から標準・堅牢・省エネ・長時間。長時間型は実行時には青緑に明滅する。外部素材は使用していない。

`checks.json` は実際のゲーム処理で検証した58項目。SP消費と回復、出発点・空中残存、通常ロックとBotの追従、ミサイルの捕捉/予約/飛翔中の参照、撃破/寿命と描画資源解放、得点の除外、Bot使用、実弾/爆風、4型の装備選択と保存を確認。

再実行：

```sh
python3 tools/test/make_dbg.py dbg/mirage
node tools/test/mirage_device_check.js dbg/mirage dbg/mirage/results
```

既存挙動の確認には `quick_check.js origin/main`、`weapons_check.js`、`manual_lock_check.js`、`guided_missiles_check.js`、`bot_battle.js dbg/mirage city,wide,mesa,dock 150` を使う。描画例は1体につき4716頂点・1メッシュ。複製元の機体・武器によって頂点数は変わる。
