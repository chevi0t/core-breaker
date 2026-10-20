# #15のレビュー修正

対象ゲームコード：`c199e78d12337aa0150635fee469f2944e973ba5`。HTML blob：`bce2672451d91875eadf60d24f0a77999052b2ba`。
最新main `9aa19a5` と #12 のレビュー修正 `b657a0b` を取り込み済み。以降の検査・記録のコミットも同じゲーム本体。

## 修正前後の実描画

同じ機体、カメラ、姿勢、着地時刻で撮影。画像は本作の形とグリッドだけで、参考動画の素材は含まない。

| 状態 | 修正前 | 修正後 |
| --- | --- | --- |
| 重装機の屈み | [画像](review15-before-bastion-crouch.png)、脚最下点 −0.429m | [画像](review15-bastion-crouch.png)、約0m |
| 屈み＋着地 | [画像](review15-before-bastion-land.png)、−0.501m | [画像](review15-bastion-land.png)、−0.002m |
| 通常剣の待機 | [画像](review15-before-sword.png)、長さ倍率1.246 | [画像](review15-sword.png)、1.000 |
| 槍の待機 | [画像](review15-before-spear.png)、長さ倍率1.094 | [画像](review15-spear.png)、1.000 |

測定値は [poses.json](poses.json)。ブーツ側を足首へ残し、深い屈みと着地が重なる腰下げを最大0.64mにする。刃は待機中に元の寸法、攻撃中だけ間合いへ伸ばす。カスタマイズも同じ構え：[剣](preview-sword.png)／[大剣](preview-blade.png)／[槍](preview-spear.png)／[細剣](preview-sabre.png)／[電棍](preview-rod.png)／[爪](preview-clawB.png)／[杭](preview-pikeM.png)。

## 10対10の比較計測

wide、seed 15485863、640×400、時間刻み1/60秒。実際のBot20機で120フレーム準備後、300フレームを測定。他の検証は止めて実行し、各条件の全フレームで20機が生存・表示状態。各条件1回。描画なしはシーンの行列更新を残す。描画ありは実描画で、明示的なGPU完了待ちは追加しない。

| コード | 描画なし平均 | 描画あり平均 |
| --- | ---: | ---: |
| モーション追加前：`2c45c09a3eb0c9b45a4a884a0f0d6ea5f9862cb0` | 1.84ms | 307.30ms |
| レビュー修正前：`6d8a62fff651e3a1621e9e5274d587537b24b912` | 2.51ms | 325.94ms |
| 修正後：`c199e78d12337aa0150635fee469f2944e973ba5` | 1.97ms | 303.69ms |

描画なしは修正前比約22%減、モーション追加前比では約7%増が残る。描画込みは追加前と同程度。このクラウドのSwiftShaderでは描画が律速するため、レビュー側のハードウェアGPUの7.4/10.3msと直接比較できない。FPSや実機での同等性能を保証する値ではない。

全6条件の測定完了後、追加の反復は終了した。平均・中央値・p95・機体数を含む生データは [performance.json](performance.json)。Node24・Playwright1.56.1・Chromium141・Three.js r128・SwiftShader。`mech_animation_check`末尾のCPU診断値は並列検証中のため、この比較には用いない。

作業用ベクトル/四元数/握り配列/姿勢オブジェクトを再利用し、親の座標内で逆運動学を解く。変化した骨の頂点だけ更新し、頭は剛体行列で動かす。全頂点の外接球の再計算を省き、非表示機と試合停止中の構え/スキン処理を止める。装甲は4メッシュを維持し、接地の分割を含めた全混成機の実測最大は80箱相当・2880頂点。

## 検証

件数・コード・ログのハッシュは [validation.json](validation.json)、全出力は [logs](logs/)。武器285種・72パーツ・全装備候補は修正前後で完全一致。

- `mech_animation_check.js`：1995姿勢、近接2023フレーム、動いた部位への実射28発、7プレビュー。待機中の刃189本と攻撃後の復帰、接地3059ケース、非表示/試合停止中の頂点更新停止も確認。脚の全頂点の最下点は−0.01m以上、少なくとも片足が地面から0.03m以内。
- `mech_shapes_check.js`：混成1296通り、実射6480発、塗装、基準高さ、型によらない形。ブーツ分割は従来の装甲/関節予算に最大10箱分を加える。
- `auxiliary_equipment_check.js`：85項目、実押下/解放、6画面の比較と保存。実入力はポッドから離れた地点へ固定し、右クリックでポインタロックの成立を待ってから左長押しする。
- `weapons_check.js` と4マップの `bot_battle.js` の結果は [validation.json](validation.json) とログに記録。

再現：対象コミットごとに `python3 tools/test/make_dbg.py dbg/<名前> --src <保存したindex.html>` を作り、`node tools/test/mech_performance_check.js dbg/追加前,dbg/修正前,dbg/修正後 /tmp/performance.json 1`。画像は `node tools/test/mech_review_capture.js dbg/修正前,dbg/修正後 /tmp/capture`。通常の検証コマンドは各ログの先頭に記載。

両腕が胴の前へ出ることによる被弾部位の変化、近接の背中への格納による被弾面の縮小、動く腕/武器で投擲物が反射する遊びの変化は採用判断としてDESIGNとPRへ記載。壁に密着した時の壁越し射撃は、オーナーが#12〜#15のマージ後に修正する別件。
