# ブラウザ版の誘導ミサイル

Godot版の画面ではない。ブラウザ版の描画とHUDを1280×720で撮影した。敵機は画面確認のため市街地の見通せる場所へ固定配置しており、自然なBOT戦の記録や勝率の資料ではない。位置と捕捉数は [capture.json](capture.json)、検証の要約は [validation.json](validation.json)。

- [捕捉](lock.png)：2体へ3捕捉を配分。四角い捕捉枠、対象ごとの捕捉数・発数。通常の耐久/残弾の円弧も維持する。
- [発射後](flight.png)：捕捉数に応じた連射、発射済みの弾と噴射/煙。
- [飛来警告](warning.png)：自機へ向かう捕捉済みミサイルを追加した場面。既存の半透明な赤三角を使い、上部に被ロックオン/被発砲の文字は出さない。
- [カスタマイズ](custom.png)：副武器のGQ系、型ごとの一覧、差の表、オリジナルモデル。強装型へマウスを乗せて性能差を表示する。

```sh
python3 tools/test/make_dbg.py dbg/missiles
node tools/test/guided_missiles_check.js dbg/missiles --screenshots
```

原典の数値と暫定の誘導調整は [採用記録](../../research/weapons/types/guided-missiles.json)、既存副武器との比較と操作は [調査記録](../../research/weapons/guided-missiles.md)。ブラウザ版の追加で、Godot版のデータは更新しない。

ブースト回避は [120条件の比較](dodge-check.json) と [読み方](../../research/weapons/guided-missiles.md#ブースト回避と弾速の追加確認2026-10-21) に記録した。`node tools/test/missile_dodge_check.js dbg/missiles` で再実行できる。
