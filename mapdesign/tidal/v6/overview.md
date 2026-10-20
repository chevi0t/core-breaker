# 潮路搬送区：斜め高架と前線遮蔽

2026-10-20。登録版は `tidal6`。370×1136m・10対10・600秒。中央の橋を左手前から右奥へ渡る斜め1本に変更し、B–C間へ遮蔽を追加した。基地前の工場街・住宅地、橙基地側面の山岳侵入路は維持する。名称・座標・モデルは本作独自。[参照マップからの特徴抽出](../../research/arcade/maps/third-mining-island-rinkai.md)。

## 地形と図面

中央は幅約20m、床20mの斜め高架。両端の坂・途中のリフト2基から上り、橋の下の地上路も使える。B–C間は14mの地上防壁・橋上塔・積み荷で射線を分け、両脇を通れる。倉庫屋根と橋の間の空間は4.5m。[橋の実景](v6/central-bridge.png)／[B–C間](v6/frontline.png)。

青基地前は工場の隙間・橋下・10〜12mの屋根、橙拠点前は住宅の路地・庭壁・共同住宅の屋上を使う。[工場街](v6/factory.png)／[住宅地](v6/housing.png)。両軍の基地は正面・左右の搬入口・屋根から侵入でき、内部の建物と防壁が警報後も射線を切る。[青基地](v6/base-blue.png)／[橙拠点](v6/base-orange.png)。橙基地の陸側には14mの尾根と、8m側壁を越える10mの足場・内側の坂がある。[山岳路](v6/mountain.png)。

[全体平面図](top.png)／[縦断・横断9本](v6/drawings/sections.png)／[PDF・3ページ](v6/drawings/tidal-plan-sections.pdf)。Aは固定x=−38mで斜め橋を途中で横切る。図面は本体から採取し、実景の撮影だけ霧を省く。[採取方法](v6/drawings/README.md)。

| 配置名 | ID | 形 | 平面図 |
|---|---|---|---|
| 屈折前線 | `tidal` | 中央Cが地上の5プラント | [主配置](top.png) |
| 上層干渉 | `tidal-v2` | 中央Cが22mの展望台 | [上層](top-v2.png) |
| 複路争奪 | `tidal-v3` | 中央を左右へ分けた6プラント | [複路](top-v3.png) |

プラント3配置・再出撃46〜52m・補給の窪地と土手・基地施設・山岳経由点・既存起伏・本体を前回と照合した。2機の守備役と索敵からの帰還迎撃も従来どおり。

## 検証と同条件12戦

[生成記録](v6/runs/2026-10-20T07-28-42-676Z-tidal6-Kx6iKf/generation.json)：徒歩334経路・全パッド/リフト120件。[射線・実弾15組と両脇/橋下84経路](v6/final/frontline-after.json)、[両所有の再出撃1,280回・Bot占拠40経路](v6/final/bot-access.json)、[単独攻略8経路](v6/final/raid-check.json)、[街区8経路・射線6組](v6/final/district-check.json)を確認。単独検査では敵と砲台の射撃を止め、交戦下の生還率と区別する。主配置の施設完全検査と3配置の簡易検査、17単体テストも合格。[最終ソース](v6/final/manifest.json)。

同じseed・編成入替・通常Bot・無音・600秒で各4戦を比較した。全12戦の初期編成がv5と一致。[比較JSON](v6/final/comparison.json)／[試合別JSON](v6/final/battles.json)。

| 配置 | v5：青/橙/引分 | v6：青/橙/引分 |
|---|---:|---:|
| 屈折前線 | 0 / 3 / 1 | 1 / 3 / 0 |
| 上層干渉 | 1 / 3 / 0 | 2 / 2 / 0 |
| 複路争奪 | 0 / 4 / 0 | 1 / 2 / 1 |

合計は青4勝・橙7勝・引分1。前回の青1勝・橙10勝・引分1から差は縮まったが、バランスの最終合格にはしない。主配置の青の大破は増えており、射線が切れたことと損耗改善は別に評価する。橋・高さ・アクセス・遮蔽をまとめて変更した比較で、遮蔽単独の効果は未確定。[詳しい判断と被害内訳](v6/README.md)。

[新リプレイ](v6/replay/replay.html)／[前回の同seedリプレイ](v5/replay/replay.html)／[大破地点・時刻の新旧比較図](v6/drawings/frontline-diagnostic.png)／[新旧HTMLと図面のzip](replays.zip)。新リプレイは主配置seed20261410通常戦。B–C帯の青の大破32→65、橙31→52だが、滞在時間も変わる1戦の観測で、集中攻撃の原因を示すものではない。

## 再現と設計知識

```sh
source /workspace/.cloud-setup/core-breaker/env.sh
node tools/generate_map.js --theme tidal --seed 20261020 --placement-seed 20261020 --terrain-attempts 1 --placement-attempts 192
python3 tools/test/make_dbg.py dbg --trace
node tools/test/tidal_frontline_check.js dbg
node tools/test/tidal_check.js dbg
node tools/test/tidal_district_check.js dbg
node tools/test/tidal_raid_check.js dbg
```

[v6の失敗と修正](v6/iterations.md)／[除外した22m版](v6/first-pass-22m/README.md)。設備の単体検査だけでは、同高の別の床を目指すBotの遠回りを見逃すというM23と、代表射線の合格と局所損耗を分けるM24を[知識台帳](../LESSONS.md)に追加した。M01〜M22も継承する。

旧版は `--revision tidal1|tidal3|tidal4|tidal5` で再生成できる。[v1](v1/README.md)、[基地拡張](v2/README.md)、[延長・基地強化v3](v3/README.md)、[街区v4](v4/README.md)、[山岳路v5](v5/README.md)の記録を保持する。
