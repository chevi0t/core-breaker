# 命中と被弾の表示

通常命中は中心を空けた白い×、頭部命中は金色の×と文字。機体への着弾に白い芯を追加した。被弾は赤い画面端と方向の弧で表し、画面全体の色調変更を置き換えた。弧は同時8方向までで、カメラの向きに追従する。追加のカメラ揺れ・反動変更・武器性能変更はない。

## 再確認

```sh
python3 tools/test/make_dbg.py dbg/feedback
node tools/test/combat_feedback_check.js dbg/feedback
node tools/test/blast_camera_shake_check.js dbg/feedback
node tools/test/quick_check.js origin/main
```

`combat_feedback_check.js` は実射、連射中の上限、頭部通知、防御、爆心の方向、視点回転、無損傷、寿命・リセット、着弾物の解放を確認し、4種のHUD・スコープ・640×360の画像を出力する。画面サンプルは表示の比較用に命中と2方向の被弾を同時に発生させる。結果の `checks.json` をここへ保存。

既存爆風回帰39項目は成功。簡易確認は武器・機体パーツ・マップのカタログ差分0、city/dock各60秒のBOT戦が成功し、ブラウザエラーなし。BOT戦はソフトウェア描画環境の機能確認であり、実機GPUのフレームレート測定ではない。
