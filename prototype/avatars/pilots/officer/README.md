# 戦術士官ちゃん（内部ID officer）

## 最新原画（2026-11-02、ユーザー提供のスカート版）

添付 `MOSS4_sprite_01_defeated_00040_.zip`（file_0000000032848209a545e32a496a3783）内の通常/被弾WebP2枚を無加工で採用。1024×1024、RGBA、透過あり。以前の短いスカート版は今回の表示に使用しません。原本はこのディレクトリのnormal.webp/damage.webpです。

| 状態 | 元ファイル | SHA-256 |
| --- | --- | --- |
| 通常 | MOSS4_sprite_00_normal_00039_.webp | cc5eb22efc75ee3b4892f33b487336b1ca6f4f3a9dd479417b1b1b66fc17c97f |
| 被弾 | MOSS4_sprite_01_defeated_00040_.webp | ff838f795c3051762e8b4b8b94437c4e7a403a54d2e4d76320315cd1e25cf5bf |

PR144の7層描画を継承。新しい絵に合わせ帽子/顔、前髪/横髪、左右袖、腰/長いスカートのマスクと支点を調整。操縦桿と手元を固定し、既存の揺れ倍率は維持。顔・衣装を描き直していません。

生成：`python3 tools/pilot_layers.py officer` → `python3 tools/embed_pilot_sprites.py --shrink`。
層は48,206バイト、重ね合わせ最大誤差0.021（0〜1）。既存moss4/aceの埋め込み層は変更していません。

限界：補完プレートは未提供のため、層で隠れている部分は既存の色にじませによる仮補完。最大揺れでは伸びが見え得ます。被弾原画の前髪にも差分94px（450px作業サイズ）があり、顔のみ切替の仕様ではその髪差分は採用されません。表情の×目/口は被弾顔へ切り替わります。

レビュー：`python3 tools/build_pilot_review.py /workspace/officer-motion-review.html`。サーバー不要で左右入力/ジャンプ/被弾を閲覧可能。実ゲームの層描画を使用し、移動入力のみ簡易再生します。公開はしていません。
