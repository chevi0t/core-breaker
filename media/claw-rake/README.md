# ガントレットの爪方向と重装型3連撃

Issue #79。ダッシュ中の手首を袈裟の軌道に合わせ、3本が同じ軌跡をなぞらない向きへ回す。中心の刃先軌道とリーチは維持。重装型だけ右→左→右の4500×3段へ変更する。段間隔と振りの速さは従来の値を使い、技全体を延長する。

確認動画は次の手順でゲーム本体のモデルを撮影できる。外部素材は使用しない。動画は水平移動を据え置いた動作確認であり、実ゲームのフレームレート測定ではない。

```sh
python3 tools/test/make_dbg.py dbg/claw-rake
node tools/test/melee_dash_capture.js dbg/claw-rake /tmp/claw-motion claw,clawM
node tools/test/claw_rake_check.js dbg/claw-rake /tmp/claw-check
node tools/test/katana_laser_check.js dbg/claw-rake
node tools/test/unique_melee_dash_check.js dbg/claw-rake
node tools/test/quick_check.js origin/main
```

107項目で4型の実メッシュ・中心軌道・3本の方向、重装型の30/60/120Hzでの3回の実損傷と表示を確認。日本刀/レーザー爪45項目、専用ダッシュ194項目と3系統の実入力、city/dock各60秒のBot戦も成功。JavaScript/WebGLエラーなし。
