# 潮路搬送区：両後方の段積みコンテナ

2026-10-20。登録版は `tidal7`。370×1136m・10対10・600秒。A–B間に6群、中央Cから橙側後方へ進むC–E間に8群、合計14群のコンテナを追加した。下段6m・全高12mで上段を狭くし、前後・左右へずらして置く。陸側・中央・沿岸に抜け道を残す。

マージに向けて最新mainのHUD・機体・武器・ジップライン更新を取り込んだ。統合後の動作確認は[main統合検査](v7/integration-main/README.md)を参照。以下の各4戦・リプレイと[上層Cへの到達時間診断](v7/access-diagnostic/README.md)は統合前の本体で記録した履歴であり、統合後の勝率として流用しない（M11）。上層配置の前線カタパルト補填は未実装の課題として引き継ぐ。

[A–B間の実景](v7/approach-blue.png)／[C–E間の実景](v7/approach-orange.png)／[全体平面図](top.png)／[断面9本](v7/drawings/sections.png)／[PDF・3ページ](v7/drawings/tidal-plan-sections.pdf)。追加14群を緑の破線で表示。本体から形状を採取し、実景の撮影だけ霧を省いた。[採取方法](v7/drawings/README.md)。

20mの斜め高架と昇降設備、基地前の工場街・住宅地、橙基地の山岳路、プラント3配置・地形・施設・侵入経由点・本体は前回と一致。既存倉庫1棟のみ、出撃の安全余白のため2mずらした。[固定条件の照合](v7/final/fixed-conditions.json)。

## 見通しと機能検査

[新旧の地上視認範囲](v7/drawings/exposure-comparison.png)／[視点別JSON](v7/final/exposure-comparison.json)。変更前後とも立てる共通の地上点から、固定3視点に見える割合を比較した。A–Bは56.6%→30.0%、C–Dは23.0%→16.3%、D–Eは38.2%→25.8%。高架と展望台も視点に含むが、固定視点の形状検査であり被弾率・生存率ではない。

[生成記録](v7/runs/2026-10-20T07-59-19-042Z-tidal7-ysKtTo/generation.json)：徒歩370経路・全パッド/リフト120件。[射線と実弾33組・積み荷脇168経路](v7/final/approach-after.json)、[出撃の範囲端を含む3,808点](v7/final/respawn-band.json)、[ランダム再出撃1,280回・本体Bot占拠40経路](v7/final/bot-access.json)を確認。[単独Botの攻略8経路](v7/final/raid-check.json)、[B–Cの射線と通行](v7/final/frontline-check.json)、[街区・既存侵入経由点と端ポッドの遮蔽](v7/final/district-check.json)、17単体テストも合格。[最終ソース](v7/final/manifest.json)。

## 同条件の各4戦

通常Bot・無音・600秒、前回と同じseedと陣営入替。全12戦の初期編成と損失内訳を照合した。[比較JSON](v7/final/comparison.json)／[試合別JSON](v7/final/battles.json)。

| 配置名 | ID | v6：青/橙/引分 | v7：青/橙/引分 | 平面図 |
|---|---|---:|---:|---|
| 屈折前線 | `tidal` | 1 / 3 / 0 | 3 / 1 / 0 | [主配置](top.png) |
| 上層干渉 | `tidal-v2` | 2 / 2 / 0 | 0 / 4 / 0 | [上層](top-v2.png) |
| 複路争奪 | `tidal-v3` | 1 / 2 / 1 | 3 / 1 / 0 | [複路](top-v3.png) |

**合計は青6勝・橙6勝だが、バランスは未合格・勝率未確定。** 主配置と複路は青の勝ちが増えた一方、上層は橙4勝。追加後は全12戦で両軍のコア直接攻撃0、すべて大破損失で決着した。両区間のコンテナと倉庫の移動を一緒に比較しているため、区間単独の因果効果は未分離。[被害内訳と次の診断](v7/README.md)。

[新しい主配置リプレイ](v7/replay/replay.html)／[前回の同seed](v6/replay/replay.html)／[新旧HTMLと図面のzip](replays.zip)。新リプレイはseed20261410通常戦で、初期状態・終局・勝者・撃破を対戦バッチへ照合した。

## 再現と設計知識

```sh
source /workspace/.cloud-setup/core-breaker/env.sh
node tools/generate_map.js --theme tidal --seed 20261020 --placement-seed 20261020 --terrain-attempts 1 --placement-attempts 192
python3 tools/test/make_dbg.py dbg --trace
node tools/test/tidal_approach_check.js dbg
node tools/test/tidal_respawn_band_check.js dbg
node tools/test/tidal_check.js dbg
node tools/test/tidal_frontline_check.js dbg
node tools/test/tidal_district_check.js dbg
```

[今回の設計・検証](v7/README.md)／[試作と修正](v7/iterations.md)。出撃帯の範囲端まで確認するM25、合計五分でも配置ごとの悪化を隠さないM26を[知識台帳](../LESSONS.md)へ追記した。M01〜M24も継承する。

旧版は `--revision tidal1|tidal3|tidal4|tidal5|tidal6` で再生成できる。[v1](v1/README.md)、[基地拡張v2](v2/README.md)、[延長・基地強化v3](v3/README.md)、[街区v4](v4/README.md)、[山岳路v5](v5/README.md)、[斜め高架v6](v6/README.md)の記録を保持する。
