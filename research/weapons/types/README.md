# 武器の型の元データ（v0.14、v0.15）

wiki（PS4版）の各系統の表（`../*.md`）から、本作の武器ごとに選んだ型。`index.html` の `WEAPON_TYPES` はここから作った。

- 1つのオブジェクトが本作の武器1つ：`base`（本作の武器のキー）、`series`（wiki の系統）、`baseRow`（元にした型の強化前の値）、`types`（足した型。`label` が型の名前、`trait` が説明）、`skipped`（入れなかった行と理由）。
- 値は強化前。キーの意味は docs/DESIGN.md の「武器の型」の節。
- `codex.json` は Codex 版から移した主武器7系統（carbine・gale・vulcan・margay・gemini・haggard・aurora）の型。
- 本作で変えた所：大剣（`blade`）の型と遠隔爆弾は使っていない。ソードはマーシャルソードを使わず、ティアダウナー・エグゼクターだけ。AC－オーバーラップは「巡航型」、光学迷彩・実用型は「即応型」と呼ぶ。LSG の表には精度が無いので、拡散率（大・小・極小）を精度 D+・C・B として扱った。
- `mech.json`（v0.15）は仕組みの要る7系統（wave・lec・explo・cls・omni・wide・glint）の型。追加のキー：`chargeTime`（満タンまでの秒）、`chargeDmg`（満タンの威力。グリントは光弾の威力）、`blast`（爆発半径）。ワイドショットは系統のページ（pages/680.html）、グリントは wiki の主武器性能比較（ps4borderbreakimage の pages/371.html、Ver.3.14）から取った（`source`）。グリントの基本の値は Codex 版の物。ワイドショットの拡散率（中・極小）は横の広がり `fan` の比（1・0.45）にした（Claude の判断）。ウェーブショットC の「弾幅が広い」は本作では表していない。
