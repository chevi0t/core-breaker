# 動きに合わせた移動音

[8秒の試聴音声](movement-demo.ogg)。専用テストがゲーム本体のWeb Audio処理を使って合成した音で、BGM・銃声は入れていません。

| 時刻 | 動作 |
| --- | --- |
| 0.3〜1.5秒 | 歩行。左右の足の接地に合わせた金属音 |
| 1.5秒〜 | 短いダッシュの噴射。1.76〜2.8秒は巡航の継続音 |
| 3.10秒 → 4.34秒 | 通常ジャンプ → 硬直しない着地 |
| 4.70秒 | 強い落下の着地 |
| 5.10〜5.60秒 | 滞空の継続音 |
| 6.00〜6.50秒 | 加速装置の継続音 |

既存CC0素材の再利用です。音源と作者への謝辞は [sounds/CREDITS.md](../../sounds/CREDITS.md) を参照してください。

`validation.json` に専用53項目、実音声の開始・停止時刻と音圧、600フレームの移動の変更前との一致を記録しています。停止後の音圧は0、再生終了時の使用音源数は0、ブラウザエラーも0です。`options-validation.json` は音量・保存・大人数ミックス・警告音の既存21項目の結果です。

`animation-validation.json` は2002姿勢・2093近接フレーム・3059足裏検査・28部位への実射・7プレビューの結果です。変更前 `b4c02bf` との全形状指標の一致も確認しました。`quick-check.log` のcity・dock各60秒のBot戦も成功しています。アニメーション検査の武器数285固定は既存mainでも失敗するため、今回、一覧から数えるよう修正しています。

```sh
python3 tools/test/make_dbg.py dbg/movement-audio-sync
node tools/test/movement_audio_check.js dbg/movement-audio-sync dbg/movement-audio-sync/results
node tools/test/options_audio_check.js dbg/movement-audio-sync dbg/movement-audio-sync/options
node tools/test/quick_check.js origin/main
```

専用テストの最後の引数に変更前のdbgフォルダを渡すと、同じ入力600フレームの位置・速度・ブースト/SP消費・接地・硬直を照合します。
