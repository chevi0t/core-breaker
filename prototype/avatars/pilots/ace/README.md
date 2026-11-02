# エースパイロットちゃん（内部ID ace）

## 今の絵（2026-11-02、オーナー提供）

標準とやられ顔でポーズが同じ2枚（450×450 の透過 WebP）。オーナーの依頼「エースパイロットちゃんも同様に差し替え願います」。

| 格納名 | 提供ファイル | SHA-256 |
| --- | --- | --- |
| `normal.webp` | `MOSS4_sprite_00_normal_00013_.webp` | `b06f0e3cae0068b93efa6fdc87fe0056baa229ab25f3026c1a9a9e97997f9dbd` |
| `damage.webp` | `MOSS4_sprite_01_defeated_00013_.webp` | `122dc219f8009d79320c84623b50a8ec8d0e0e32e7948e347a31ef236fc9d8dd` |

ページには `embed/normal.webp`（320px）と、やられ顔の顔だけの切り抜き `embed/damage_patch.webp`（位置は `embed/damage_patch.json`）を入れ、やられ顔は重ねて出す。作り直しは `python3 tools/embed_pilot_sprites.py --shrink`。

揺れの設定は `prototype/index.html` の `PILOT_RIGS.ace`。髪が白く、色だけでは白い服や袖と見分けられないので、明るさ（彩度0.13未満・明るさ0.78より上）と「髪がある所」の楕円（`hairAreas`：頭と左右の外側の房）で髪を拾い、両腕（`hairCuts`）と `hairMaxY` より下を除いている。

## 前の絵（履歴）

300×300 の透過 WebP 2枚（`MOSS4_sprite_00_normal_00002_` と `MOSS4_sprite_01_defeated_00002_`、やられ顔はまるごとの1枚）。main 7f4a55c までの履歴に残っている。
