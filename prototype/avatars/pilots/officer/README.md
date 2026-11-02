# 戦術士官ちゃん（内部ID officer）

## 今の絵（2026-11-02 15:36、オーナー提供）

オーナーが作った、標準とやられ顔でポーズが同じ2枚（1024×1024 の透過 PNG。紺の制服と制帽、黒髪、縁なし眼鏡、やられ顔は×目と赤面）。ここには WebP（品質95）にして置いた。名前の下の一言「眼鏡の戦術士官」は Claude が付けた。

| 格納名 | 元の PNG の SHA-256 |
| --- | --- |
| `normal.webp` | `2192fb84c32e83b570eb085e2498068237dbf8b133477393d1434d71cff169ab` |
| `damage.webp` | `d171d920f02c2b76f204c67e0a97d7bc8d852d5a5747ab76a37b45bf55c0dac7` |

ページには層だけを入れる（止まった絵はページを開いた時に層を重ねて作る）。

### 層（2026-11-02）

後ろ髪・体・左腕・右腕・顔（制帽を含む）・前髪、やられ顔の顔の7枚で約60KB。範囲は `layers/rig.json`、作り直しは `python3 tools/pilot_layers.py officer` の後に `python3 tools/embed_pilot_sprites.py --shrink`。

黒髪と紺の制服は色相が同じ（230前後）なので、彩度で分ける（`hairDark`：髪は彩度0.42未満、制服は0.45〜0.55）。範囲はエースと同じく、体（`bodyHull`）と腕の外を髪にする。上着の前に垂れる左の房は制服とほとんど同じ色なので、輪郭に沿った多角形の中を全部髪にする（`hairPolyAll`）。腕は多角形の中を袖の彩度で絞る（`armRefine` の `sat`）。制帽は顔の層に入れ、髪から除く（`notHairPoly`）。眉・目・ほくろも髪から除く（`notHair`）。

やられ顔は顔の層だけ差し替える。帽子の右の下の湯気のしるしは一部が顔の層の外にあり、そこは出ない。

隠れていた所の描き足しは今は仮（色をにじませる）。オーナーが ComfyUI の v11（材料は `python3 tools/pilot_v11.py officer <出力>` で作る。指示文は `layers/v11.json`。渡した物は共有フォルダ `borderbreak-pilot-sway/officer/OFFICER_layers_v11_fill.zip`）で描き足した2枚を `layers/plate_body.png`・`layers/plate_face.png` に置いて作り直すと本番の描き足しになる。

揺れの設定は `prototype/index.html` の `PILOT_RIGS.officer.layers`（倍率はテストパイロットちゃんでオーナーが決めた値と同じ）。
