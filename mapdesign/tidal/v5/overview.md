# 潮路搬送区：工場街・住宅地と山岳侵入路

2026-10-20。現在の生成版は `tidal5`。370×1136m・10対10・600秒。青基地前の工場街と橙拠点前の住宅地に加え、橙基地の陸側に防壁より高い山を置いた。名称・形・座標・モデルは本作独自。[AC版からの特徴抽出](../../research/arcade/maps/third-mining-island-rinkai.md)を参考にする。

## 地形と侵入の選択肢

- **青基地前：工場街**。工場の隙間・連絡橋下・10〜12mの屋根から接近する。[実景](v5/factory.png)。基地はコンクリート防壁・事務所・兵舎・コンテナ・トレーラー。
- **橙拠点前：住宅地**。12棟の低層住宅・庭壁・路地と、2棟の共同住宅の屋上を使う。[実景](v5/housing.png)。基地はHESCO・分散プレハブ・前後へずらした内壁。
- **橙基地横：山岳ルート**。14mの尾根を徒歩で進み、10mの短い足場で8mの側壁を越え、壁沿いの坂から基地内へ下る。既存の射出台は高さ0のまま。[山の実景](v5/mountain.png)／[侵入経路図](v5/drawings/mountain-plan.png)。
- 両軍とも正面ゲート、両側の搬入口、荷役屋根から入れる。内部の建屋・内壁は警報後も射線を切る。[青基地](v5/base-blue.png)／[橙拠点](v5/base-orange.png)。

2機の守備役は門内・コア脇へ常駐。通常の索敵で接近を知ると占拠役から最大2機が通常のエリア移動待機を経て帰還する。レーダー破壊後もセンサーに映れば迎撃が始まる。山の上でも基地境界を越えれば通常の侵入警報が鳴る。失効した索敵情報は使わない。

## 3つの配置と図面

| 選択名 | ID | 狙い | 平面図 |
|---|---|---|---|
| 潮路搬送区 ～屈折前線～ | `tidal` | 5プラント、中央Cは地上、B/Dが補給支点 | [主配置](top.png) |
| 潮路搬送区 ～上層干渉～ | `tidal-v2` | 5プラント、中央Cを22mの展望台へ | [上層](top-v2.png) |
| 潮路搬送区 ～複路争奪～ | `tidal-v3` | 6プラント、中央の争奪を左右へ分ける | [複路](top-v3.png) |

地形・基地・街区・山は共通。採用された長方形、再出撃46〜52m、補給窪地2mと土手5m、既存の施設・プラントは維持する。水面は装飾。

[全体平面図](v5/drawings/plan.png)／[縦断・横断9本](v5/drawings/sections.png)／[PDF・3ページ](v5/drawings/tidal-plan-sections.pdf)。Hが山沿い、Iが側壁越え。[採取方法と縮尺](v5/drawings/README.md)。実景は形状確認用に霧を省いた撮影で、ゲーム中の霧・射線・物理は通常どおり。

## 検証と同条件12戦

[最終生成記録](v5/runs/2026-10-20T05-37-59-044Z-tidal5-bUdY9D/generation.json)。地形/配置seed20261020、軽量・重量機で徒歩334経路、パッド/リフト120件が成立。

[山の徒歩往復4経路](v5/final/mountain-check.json)、[街路・正面8経路と射線6ケース](v5/final/district-check.json)、[固定編成の単独Bot侵入8経路](v5/final/raid-check.json)、[再出撃1,280回・占拠40経路](v5/final/bot-access.json)、[基地守備8ケース](v5/final/base-defense-check.json)を検査。単独Botの青潜行役は山と横断帯を使い、72.9秒でコアを攻撃した。敵・砲台の射撃を止めた到達性検査で、迎撃下の成功率ではない。

[17テスト](v5/final/generator-tests.log)、[全250武器と既存4マップの回帰](v5/final/regression.log)、施設・ポッド・nav・着地の完全検査（[主配置](v5/final/map-check-tidal.log)／[上層](v5/final/map-check-tidal-v2.log)／[複路](v5/final/map-check-tidal-v3.log)）を保存。[ソースと版の照合](v5/final/manifest.json)。

通常Bot・無音・編成入替・各600秒で、前回と同じseedの各4戦を実行した。[比較JSON](v5/final/comparison.json)／[試合別JSON](v5/final/battles.json)。全12戦の初期編成が旧版と一致し、新本体での旧主配置の対照4戦も前回の終局・占拠経過等と一致した。全戦の直接攻撃と大破損失を実HP差へ照合。

| 配置 | 山の追加前：青/橙/引分 | 追加後：青/橙/引分 |
|---|---:|---:|
| 屈折前線 | 1 / 3 / 0 | 0 / 3 / 1 |
| 上層干渉 | 1 / 3 / 0 | 1 / 3 / 0 |
| 複路争奪 | 0 / 4 / 0 | 0 / 4 / 0 |

**山岳経路は追加したが、今回の12戦では橙有利を改善できていない。** 合計は青1勝・橙10勝・引分1。青のコア直接攻撃は前回828から0となり、大破損失も減っていない。山の地形と青の潜行経由点・到達半径をまとめて変えた比較で、個々の原因は未分離。各4戦で勝率は未確定だが、バランス改善案として合格とは扱わない。[詳しい結果と次の診断](v5/README.md)。

[新しい主配置リプレイ](v5/replay/replay.html)はseed20261410通常戦。B4を選ぶと583秒付近で尾根へ入り、596秒に側壁を越える。この1戦は終盤の侵入で、両軍ともコアへの直接攻撃0。[同条件の旧リプレイ](v4/replay/replay.html)／[新旧HTMLと図面のzip](replays.zip)。記録した位置・イベントの再生で、初期状態と終局を対戦バッチへ照合した。

## 再現と設計知識

```sh
source /workspace/.cloud-setup/core-breaker/env.sh
node tools/generate_map.js --theme tidal --seed 20261020 --placement-seed 20261020 --terrain-attempts 1 --placement-attempts 192
python3 tools/test/make_dbg.py dbg --trace
node tools/test/tidal_mountain_check.js dbg
node tools/test/tidal_raid_check.js dbg
node tools/test/tidal_district_check.js dbg
node tools/test/tidal_check.js dbg
node tools/test/base_defense_check.js dbg
```

[山の設計・検証](v5/README.md)／[失敗と修正](v5/iterations.md)／[除外した途中記録](v5/first-pass/README.md)。旧版は `--revision tidal1|tidal3|tidal4` のいずれかで再生成できる。[v1](v1/README.md)、[途中の基地設計](v2/README.md)、[延長・基地強化v3](v3/README.md)、[街区追加v4](v4/README.md)の記録を残す。

次へ引き継ぐ知識は [M21/M22](../LESSONS.md)。地形外の起伏と初期状態も一致させること、徒歩成立とBotの経由点省略・往復・実戦の成功を分けることを蓄積した。M01〜M20も継承する。
