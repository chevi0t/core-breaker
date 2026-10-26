# クイックブーストの合成音（#44 の差し替え候補）

外部の録音を使わず、`synth.py` で雑音にフィルターと音量の形を付けて作った音です（2026-10-27、Claude）。ライセンスの制約はありません。D〜F は、A〜C を聞いたオーナーの「A→B合わせたようなドシュー！かボシュー！」を受けて作った物です。

| 案 | 単発（ゲーム用） | 試聴（単発→3連発） | 特徴 |
|---|---|---|---|
| A 低い燃焼 | boost-a-low.wav（0.30秒） | boost-a-low-preview.wav | 気球のバーナーに近い太い「ボォッ」 |
| B 明るい噴射 | boost-b-bright.wav（0.25秒） | boost-b-bright-preview.wav | 空気の吹き出しが前に出る「シュボッ」 |
| C 重い衝撃 | boost-c-heavy.wav（0.32秒） | boost-c-heavy-preview.wav | 踏み出しの低い押しを足した「ドゥッ」 |
| D ドシュー | boost-d-doshu.wav（0.44秒） | boost-d-doshu-preview.wav | オーナーの「A→B合わせたような」から。低い押しの頭→長めのシュー |
| E ボシュー | boost-e-boshu.wav（0.44秒） | boost-e-boshu-preview.wav | 押しなし。太い燃焼の頭→轟きを少し残したシュー |
| F ボシュッ | boost-f-boshu-short.wav（0.32秒） | boost-f-boshu-short-preview.wav | Eを短くして、連発でも重なりにくくした物 |

**採用：E ボシュー**（オーナーが2026-10-27に選択）。#44 で `sounds/src/boostStart.wav` に使う。

作り直し：`python3 synth.py <出力フォルダ>`（乱数の種は固定なので同じ音になる）。
