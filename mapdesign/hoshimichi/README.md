# 星路駅前・四街区争奪戦（通常本体への統合）

確認済みの都市対戦試作を通常の `prototype/index.html` のマップ選択へ登録する。独立した試走HTMLを起動する形から、既存の機体・武器・HUD・設定・対戦進行をそのまま使うマップへ移した。IDは `hoshimichi`。

## 引き継ぐ配置

600m四方、10対10、上限10分、4プラントは中立から開始。北西と南東の基地は半径28m。各基地にカタパルト4基・砲台4基・レーダー1基・補給ポッド2基、各プラントにポッド1基。橙側だけの高層棟用ジャンプパッドは撤去済み。

| プラント | x,z（m） | ユーザー図の赤丸 |
| --- | --- | --- |
| A | 51, -23 | 中央東、白いランドマークの西 |
| B | -70, -56 | 中央西、南北高架の西 |
| C | 196, -218 | 北東の道路 |
| D | -250, 215 | 南西の川沿い |

元の形状・対戦配置は `source/` のJSON。入力は対戦試作commit `5649404` と同一のハッシュを保持する。路地、駅屋根、上下の線路、配色、川の8本の復帰路、A/Bポッドの窪地と坂も引き継ぐ。初期配置とBotの通常の役割を維持し、勝率は未確定とする。

統合時、南東基地の4番目のカタパルトだけは、建物の角へ接触せず降りられる街路へ着地点を `(230,116)` から `(218,152)` へ調整した。元の入力は変更せず、変換器と `import.json` に差分を記録する。

## 本体との接続

本体の地面・接触・射線・視点とBot経路に、都市データのあるマップだけが使う処理を追加した。従来マップは既存の処理を使う。基地の座標を任意のXZ位置へ置けるようにし、コア・傘・索敵・施設・防衛得点を同じ基準で扱う。再出撃は基地側46〜52mの安全な陸上候補を使う。

形状から描画と接触・射線の面を作り、街路の839節点・1,189辺を使用する。マップを切り替えると都市の判定形状と材質を破棄する。地図の元画像・座標の展開はキャッシュし、繰り返し切り替えても形状を積み重ねない。

都市データは `prototype/maps/hoshimichi.js` → `tools/build_maps.py` → `prototype/maps.js` に同梱する。地形の追加ダウンロードや、配布に新しい実行ファイル・JSファイルを要求しない。通常本体のThree.js・フォントの取り扱いは同じ。

登録するマップJSON全体は **97,599 B**、コメントを含むマップファイルは **97,837 B**。形状と施設・Bot経路・再出撃データを合わせた非圧縮値で100,000 B以下。変換器の入力ハッシュと容量は [import.json](import.json)、地理データの出典・加工内容・謝辞は [CREDITS.md](CREDITS.md)。

## 再生成と検査

```sh
python3 tools/import_city_map.py
python3 tools/build_maps.py
python3 tools/test/city_map_format_check.py
python3 tools/test/make_dbg.py dbg
node tools/test/hoshimichi_check.js dbg 600
node tools/test/hoshimichi_integration_check.js dbg
node tools/test/map_check.js dbg hoshimichi
node tools/test/quick_check.js origin/main 60
node tools/test/weapons_check.js dbg
node tools/test/mech_shapes_check.js dbg
node tools/test/bot_battle.js dbg city,wide,mesa,dock 150
```

専用検査はカタパルト48条件（軽量・標準・重量機、30/120Hz）、占拠・再出撃192サンプル、両基地から4地点への徒歩経路、補給の制約、隠れたポッドの視認、砲台・レーダーを本体で確認する。カタパルトは最初の接地と停止後の位置を別々に検査し、最初の接地の目標誤差は最大1.79m。対戦の記録は [battle-check.json](battle-check.json)。この本体での確認試合は600秒で正常終了し、撃破270回・占拠16回・射出台使用120回だった。

通常HTMLでの操作、従来マップとの切替と破棄、既存配置の同値性の結果は [integration-check.json](integration-check.json)。既存武器・パーツの値は簡易検査でも変更0を確認する。これらは動作確認で、200〜2,000試合による勝率の検証やFPSの測定は行っていない。
