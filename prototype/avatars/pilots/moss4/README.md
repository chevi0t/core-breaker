# テストパイロットちゃん（内部ID moss4）

## 今の絵（2026-11-02 13:16、オーナー提供）

オーナーが ComfyUI で作った、標準とやられ顔でポーズが同じ2枚（1024×1024 の透過 PNG。白衣と黒いスーツ、やられ顔は×目）。違いは顔の四角の中だけ。ここには WebP（品質95）にして置いた。

| 格納名 | 元の PNG の SHA-256 |
| --- | --- |
| `normal.webp` | `798edd62605a76909d0bf7a8beca12356e5dd14aa171d3f879278eab54d02c9d` |
| `damage.webp` | `301ee768c0a6cc6a6d913faa52a4a35dacb7b3dbe51d954ee81a90feda5b3860` |

ページには `embed/normal.webp`（320px）と、やられ顔の顔だけの切り抜き `embed/damage_patch.webp`（位置は `embed/damage_patch.json`）を入れる（メニューのカードや、層が使えない時の絵）。作り直しは `python3 tools/embed_pilot_sprites.py --shrink`（Pillow が要る）。

### 層（2026-11-02）

HUD の揺れは `layers/` の層で動かす（後ろ髪・体・左腕・右腕・顔・前髪、やられ顔の顔）。範囲は `layers/rig.json`（絵の幅と高さを1とした多角形）、作り直しは `python3 tools/pilot_layers.py moss4` の後に `python3 tools/embed_pilot_sprites.py`（Pillow・numpy・scipy が要る）。腕と前の髪・前髪に隠れていた所は、今は色をにじませた仮の描き足し。ComfyUI の MOSS_layers_v11（共有フォルダ borderbreak-pilot-sway/layers/）で描き足した絵を `layers/plate_body.png`・`layers/plate_face.png` に置いて作り直すと、本番の描き足しになる。

揺れの設定は `prototype/index.html` の `PILOT_RIGS.moss4.layers`。

## 前の絵（履歴）

2026-11-02 10:19 の絵（黒いタートルネック、450×450 の透過 WebP、`MOSS4_sprite_00_normal_00007_` など）。git の履歴（main 58d2d16 まで）に残っている。

1024×1024 の透過 PNG 4枚（標準・左右ブースト・被撃破、`MOSS4_sprite_*_00012〜00015_`）。2026-11-02 に今の絵へ置き換えた。git の履歴（main 7027dad まで）に残っている。
