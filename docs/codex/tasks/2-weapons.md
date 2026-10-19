# #2 武器：wiki にあって本作に無い系統を調べ、形と性能まで作ってゲームに入れる

## やること

手順は `docs/codex/weapons.md` に沿う。オーナーの指定（2026-10-19）：**調べるだけでなく、性能と形（モデル）まで作り込んでゲームに入れてよい**。

1. **調べる**：BORDER BREAK PS4版 wiki（https://w.atwiki.jp/ps4borderbreak/ ）にあって本作に無い武器の系統を `research/weapons/missing.md` にまとめる（兵装と枠、系統名とページの URL、基本の型の数値、撃ち方の仕組み、本作の仕組みで表せるか）。最後に足しやすい順のまとめを付ける。
2. **入れる**：足しやすい物から、系統ごとに `WEAPONS`・`WEAPON_KG`・`ARMORY`・`SERIES`・`WEAPON_TYPES`（1系統4つまで）・`MODEL_OF`・`SFX_TUNE` などに足す。新しい仕組みが要る物は、無くてもよいキーとして足し、Bot も使えるようにする。
3. **形を作る**：合う形が無い系統は `buildWeaponGeo` に新しい形を足す。デザインはオリジナル。

本作に入っている武器は `research/weapons/types/*.json`（`series` が wiki の系統）と `research/weapons/*.md` で分かる。入っている系統の型のうち入れなかった物（`skipped`）は対象外。

## 守ること

- 数値は wiki の初期値（強化前）。読めなかった所は「不明」と書き、推測で埋めない。定義の横のコメントに wiki の武器名と元の値を書く。
- 画面の名前はオリジナル（型番＋武器の種類の名前、メーカーは架空の5社）。wiki の名前は画面に出さない。
- 各枠の初期装備（`ARMORY` の各枠の先頭）と、今の武器の数値は変えない。

## 確かめること

- `node tools/test/weapons_check.js dbg` が全武器で通る。
- `node tools/test/bot_battle.js dbg city,wide,mesa,dock 150` で「エラー なし」。
- 機体カスタマイズのスクリーンショット（新しい系統の型が並び、数値の比べが出る）。
- 同じ枠の今の武器と比べた強さの表（秒間の威力、弾の総数、重さ）。

系統が多いときは PR を分けてよい（どの PR にもこの作業の番号 #2 を書く）。PR は Claude が確かめて承認・マージする。
