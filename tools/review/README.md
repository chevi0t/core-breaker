# パイロット動作レビュー

`python3 tools/build_pilot_review.py /workspace/officer-motion-review.html`

出力HTMLをブラウザで開く。サーバーやネット接続は不要。左右ボタン/A・D/矢印、Space/ジャンプボタンで動かし、被弾顔・髪/胸倍率0〜300%・背景色・一時停止を操作できる。ボタンは1回再生、左右キーは保持。第2引数でキャラIDを指定できる（省略時officer）。例：`python3 tools/build_pilot_review.py /workspace/gizappa-motion-review.html gizappa`。

ゲームのcreatePilotLayers、PILOT_RIGS、pilotSwayInputと埋め込み層を生成時に抽出する。ゲームを丸ごと起動せず、正規化される移動入力を簡易再生するため、マップ衝突・装備別速度・実戦のジャンプ軌道を試すものではない。層の隙間、顔差分、揺れの見た目確認用。出力HTMLは公開サイトに含めない。

1100px/390pxでボタン、キー保持、ジャンプ着地、倍率、被弾、一時停止、順次再生、横溢れなし、外部HTTP要求なし、ブラウザエラーなしを確認。
