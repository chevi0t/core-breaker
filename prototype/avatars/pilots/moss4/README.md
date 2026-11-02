# テストパイロットちゃん（内部ID moss4）

## 今の絵（2026-11-02、オーナー提供）

オーナーが ComfyUI のワークフローを変え、標準とやられ顔でポーズが同じになった2枚（450×450 の透過 WebP）。「かぶせても問題ないことを確認済」（オーナー）。

| 格納名 | 提供ファイル | SHA-256 |
| --- | --- | --- |
| `normal.webp` | `MOSS4_sprite_00_normal_00007_.webp` | `c506dabc23c3d3b02959881fc497d711263e02a03249299e3949bc22fcb43888` |
| `damage.webp` | `MOSS4_sprite_01_defeated_00007_.webp` | `78cb514548266bfcb5d5cc82a1db105b1c07291c55beb91419b556514f58f247` |

ページには `embed/normal.webp`（320px）と、やられ顔の顔だけの切り抜き `embed/damage_patch.webp`（位置は `embed/damage_patch.json`、絵の幅と高さを1とした x・y・幅・高さ）を入れる。やられ顔は標準の絵に切り抜きを重ねて出す（HUD では揺れたまま顔だけ替わる）。作り直しは `python3 tools/embed_pilot_sprites.py --shrink`（Pillow が要る）。2枚の違いが顔のまわりに収まっていない絵は、自動でまるごとの1枚に戻る。

揺れの設定は `prototype/index.html` の `PILOT_RIGS.moss4`（この絵に合わせた位置。髪は紫の色相で拾い、`hairMaxY` より下は拾わない）。

## 前の絵（履歴）

1024×1024 の透過 PNG 4枚（標準・左右ブースト・被撃破、`MOSS4_sprite_*_00012〜00015_`）。2026-11-02 に今の絵へ置き換えた。git の履歴（main 7027dad まで）に残っている。
