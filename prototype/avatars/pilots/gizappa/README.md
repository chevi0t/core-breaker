# ギザっ歯ちゃん（gizappa）

2026-11-03、ユーザー添付MOSS4_sprite_00_normal_00051_.zip（file_0000000040288209af25013749d7ada0）から通常/被弾の1024×1024 RGBA WebPを無加工で採用。紺〜水色の短髪、金色の目、ギザ歯、濃色のパイロットスーツ。既存のキャラは置換しません。

- normal.webp: MOSS4_sprite_00_normal_00051_.webp / SHA256 `e3922f54c42285d2c6f7b5ac5b47ed92e28eaefd3ec53a391c2d5d6f22651f78`
- damage.webp: MOSS4_sprite_01_defeated_00052_.webp / SHA256 `73f8ea74051580e7f973d708312cc0410baf9163a4cf52c3201b6f6ab6e60d83`

髪・顔・左右袖・体へ分離し、7層（47,246bytes）として既存の揺れ描画へ登録。操縦桿の軸と台座、手元を固定。倍率と描画処理は既存仕様を継承。短髪の支点、腕、胸、腰の範囲を原画へ合わせています。

重ね合わせ最大誤差0.064。補完プレート未提供につき、隠れた部分は既存の色にじませによる仮補完です。最大倍率では輪郭の伸び等が見え得ます。通常/被弾で前髪の形にも微差があり、顔外124px（450px作業サイズ）の差分は顔のみ切替のため反映しません。閉じ目・口・頬/汗を含む被弾表情は切替対象です。

生成: `python3 tools/pilot_layers.py gizappa` → `python3 tools/embed_pilot_sprites.py --shrink`。
確認: `gizappa_layers_check.js`、`pilot_sprites_check.js`。
レビュー: `python3 tools/build_pilot_review.py /workspace/gizappa-motion-review.html gizappa`。
新規画像の生成や顔/衣装の描き変えは行っていません。

検証：36描画条件（PC/狭幅・倍率0/1/3・6動作）と保存、全4キャラの被弾/撃破/復帰・左右揺れ、レビューHTMLのボタン/キー/ジャンプ/倍率/被弾/通信不要・横溢れなしを確認。既存3キャラの埋め込み層は一致。
