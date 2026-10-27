# 双湾展示区 — 港越しの連絡路

Issue #63。お台場〜有明の提示図を基にした、PLATEAU由来の半縮尺マップ。通常のマップ選択に `sowan` として追加する。

- 実地の切り出しは約3,300×1,250m。東西の街区に合わせて40.7度回転してから切り出し、XYZを1/2にする。ゲーム内は **1,650×625m**。4mの機体は実都市に対して8m級になる。
- 推奨10対10・10分。既存の人数設定も利用できる。左右の基地、上側に並ぶ4プラントは提示図を基準とする。全プラント中立開始。
- 非圧縮の `prototype/maps/sowan.js` 全体（地形・施設・BOT経路・出典込み）を **500,000 bytes以下**で検査する。最終サイズは [generation.json](generation.json) に記録する。
- [配置図](layout.png)、[3D俯瞰](overview-3d.png)、[会議棟の外形](landmark-3d.png)。外部の写真やロゴをテクスチャには使わない。

## 地形とランドマーク

1. 江東区・港区2025年度のPLATEAU建築物LOD2、道路LOD3、橋梁LOD2を取得。原形状は境界だけで切断し、加工前の座標・標高範囲を照合する。
2. 建物の外周と面積のある屋根から、敷地の輪郭・主要な高さを残した立体を組む。小さな屋上設備・細片を省略する。道路は地理院ベクトルタイルで照合する。地面は海岸以外0mへそろえる。
3. 屋上の内側の穴を閉じ、道路の開口は地上側で残す。半径1.3mの機体が通れない入口で閉じられる窪地は追加の立体で塞ぐ。カタパルトの着地先だけでなく街区全体を対象とする。
4. ゆりかもめなどの高架はPLATEAU橋梁上面の投影を使い、下面9m・上面10mの連続した床へ整理する。地上道路の下り込みや細い橋脚を再現することは今回の対象に含めない。

ビッグサイトの会議棟は4つの逆四角錐と支持部を補完し、屋上中央の隙間を屋根直下で塞ぐ。テレコムセンターは青灰色の双塔と上部連絡棟、日本科学未来館は白系、研究施設は淡灰色、周辺の高層棟は青灰色のガラスとして識別する。原データに現在の建物が十分に入っていないアリーナとドリームパークは、提示画像と公式の外観資料を参考に、楕円形・白い帯を持つ黒い段状建物として補完する。補完した敷地の旧構内道は新しい建物へ置き換え、屋根を分断しない。現況の測量モデルではなくゲーム用の近似である。

海岸線は地理院水域を基にする。水面は-2m、水底は-4m。水底に着地しても通常ジャンプで岸へ戻れる高さにする。海を瞬間移動・即死領域にはしない。BOTの通常経路は陸と橋に限定する。

## 地形と配置の分離

`tools/build_sowan.py` の `terrain()` はプラント座標を受け取らない。プラントの候補は [placement.json](placement.json) だけで管理し、後段の `battle()` が占拠円・再出撃先・地上経路を確保できる既存空地へ置く。**プラントのための地形カットは0件**。

提示図から読み取った点が建物と重なる場合、最大65m以内の既存の空地へ移す。今回Cは約16m、Dは32m移動した。基地は半径39mの固定の敷地を確保する。基地の更地化と道路の開口は地理側の処理であり、プラントを移動しても変わらない。

各基地にカタパルト4基（左右2基ずつ）・防衛砲台2基・レーダー1基・リペアポッド2基。基地→外側のA/D、A→B・D→Cをそれぞれ結ぶ。全台6.8秒の高角軌道、初めの1秒以降は既存の空中操作を使える。両陣営がどの台も利用できる。プラント用の窪地や補給用の地形を固定しないため、初版のプラントにはリペアポッドを置かない。

再出撃は各プラントから基地側46〜52mにある安全な候補を両陣営分生成する。4m格子から街路経路を作り、実行時に施設を含めて通れない辺を落とす。プラント・基地・出撃点・着地点は同じ陸上経路成分へ接続する。

## 再生成

原データの出典・208タイルのURLとSHA256は [source-manifest.json](source-manifest.json)。加工前の検査は [source-summary.json](source-summary.json)。巨大な原データはリポジトリへ同梱しない。道路・海岸の取得結果は `research/maps/odaiba-reference.json` に固定している。

```sh
python3 -m venv /tmp/sowan-venv
/tmp/sowan-venv/bin/pip install -r tools/requirements-city-map.txt
npm install --prefix /tmp/sowan-deps draco3d@1.5.7
PLATEAU_DRACO_MODULE=/tmp/sowan-deps/node_modules/draco3d /tmp/sowan-venv/bin/python tools/plateau_rect_fetch.py /tmp/sowan-cache /tmp/sowan-source --config research/maps/odaiba-sources.json
/tmp/sowan-venv/bin/python tools/build_sowan.py /tmp/sowan-source
python3 tools/build_maps.py
python3 tools/test/make_dbg.py dbg
node tools/test/sowan_check.js dbg mapdesign/sowan
/tmp/sowan-venv/bin/python tools/test/sowan_geometry_check.py /tmp/sowan-source
```

地理院データも取り直す場合は `tools/odaiba_reference.py /tmp/sowan-gsi research/maps/odaiba-reference.json`。サーバーのデータ更新後はSHA256が変わり得るため、元版と混ぜず別の取得記録を保存する。図の作成にはmatplotlibも必要で、`tools/render_sowan.py mapdesign/sowan/layout.png` を実行する。

## 確認と限界

[runtime-check.json](runtime-check.json) に本体物理の実測を記録する。軽量・重量、両陣営、30/120fpsで全10台の射出80条件、着地後の退出、穴埋め屋上と特徴建物8地点の落下・退出、水底4地点のジャンプ復帰、長方形の四辺、都市と従来マップへの切替を検査する。屋根上面の2.5m格子も検査し、6m以下の上昇と降下では地上へ戻れない候補を除去した（[roof-grid-check.json](roof-grid-check.json)）。細部すべての着地座標を実走したという意味ではない。

既存のM01/M02/M14（施設の接続・実物理・両軍の再出撃）、M07（勝率と機能検査の分離）の知識を採用した。経路の成立、短時間のBOT戦、長期の勝率は別の評価とする。**陣営勝率・補給量・長距離の射線バランスは未確定**。初版の試遊結果を見て、地形を切らずにプラント配置を調整する。

最終版の動作確認：[checks.json](checks.json)。マップ単体197,562B。473輪郭の保存後検査、全10台×8条件の射出、24施設点と実経路の接続、8屋上から地上への退出、水底4地点の復帰に成功。2.5m格子164,091点の補助走査で退出不能候補0。通常の全員BOT・seed20261025で150秒、撃破は青17/橙20、占拠状態の変化5回、ブラウザエラー0。単一短時間試行なので勝率の判定には使わない。試遊HTMLの通常入力も通信なしで起動・歩行・全体地図を確認済み。
