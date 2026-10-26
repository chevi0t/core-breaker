# 弾の視認性と弾種の色分け

Issue #83、#85。オーナー指定の見た目の変更。通常実弾は黄橙、通常光学弾はライムグリーン。プラズマ砲のピンク、状態異常弾・投擲/設置モデルの固有配色は維持する。

- 主武器の通常実弾の太さを2倍（自機5.2px/敵6.8px以上）。主武器の光学弾も5.2px以上とし、端面を閉じ、通常合成と霧なしで後方や明るい背景から追えるようにする。
- 副武器が大きすぎるとの再指定で、副・補助・特別装備と砲台は#84前の寸法へ戻す。副武器82種類の描画寸法を基準版と照合。主武器の拡大と弾種の色分けは維持する。設置物と光波剣は拡大しない。
- 拡大の有無を発射時に記録し、飛翔中の持ち替えでは変更しない。充填主武器の一時的な定義の複製も武器キーで判定する。
- 新しい描画オブジェクト、外部素材、戦闘の乱数消費は増やさない。弾道・衝突・威力・射撃間隔・反動は変更しない。

比較基準はmain `340df1a1f274c718a9f03d4726083a26f2be719f`。`tools/test/make_dbg.py`で現在と基準版のdbgを作り、次の比較を実行する。

```sh
node tools/test/bullet_visibility_check.js dbg/bullets dbg/bullets-base /tmp/bullet-check
node tools/test/energy_trail_check.js dbg/bullets
node tools/test/laser_sniper_check.js dbg/bullets
node tools/test/artillery_check.js dbg/bullets
node tools/test/quick_check.js origin/main
```

`checks.json`：GM/LV各4型、敵味方、主要22武器の実射・乱数・軌道比較、明暗背景・真後ろからの実ピクセルと壁の遮蔽、資源の片付けを174項目で確認。720px高・70度の検査条件でGMの表示面積は明背景4→26px、暗背景6→26px。LVは両背景で0→26px。一般の視点や環境で同じ画素数になることを保証する値ではない。光学弾173項目、レーザー33項目、榴弾砲125項目と、city/dock各60秒のBot戦も成功。
