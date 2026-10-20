# アーケードの猫とプレイヤー名

2026-10-20、ユーザー依頼。

- アーケードの猫を52→156px、幅1000px以下40→120px、幅700px以下32→96pxへ拡大。下にプレイヤー名、その下に兵装名を表示する。[1280px](arcade-1280.png)／[640px](arcade-640.png)。ほかのコンソールの画像サイズは維持。
- 顔に重なる「強」などの一文字バッジを削除。
- 透過PNGの下にあったCSSのベージュ塗りを削除。アーケードの肖像・耐久欄の濃いパネルも外し、顔の輪郭の外から地形が見えるようにした。入力された参考画像は同梱しない。
- [最初の画面](initial-screen.png)に名前欄を追加。20文字まで、空欄は「あなた」。保存・復元し、兵装変更・再出撃・マップ変更後も使う。入力中のキーをゲームへ渡さず、日本語変換の確定を待つ。
- 武器のひし形には、武器名の前に数字キーを表示。上1=主武器、右2=副武器、左3=補助装備、下4=特別装備。ゲームの切り替え順序と同じ `SLOTS` を使う。
- 入力した記号はHUD、スコア、表彰、撃破ログで文字として表示する。

## 確認

`python3 tools/test/make_dbg.py dbg/player-profile` の後に実行。

- `node tools/test/player_profile_check.js dbg/player-profile media/player-profile`：[75項目・16配置](validation.json)。名前入力・保存・空欄・長い保存値・日本語変換・保存不可時・各コンソールと画面幅、猫のサイズ、名前の上下位置、透過を塞ぐ下地がないこと、バッジ削除、武器番号、記号の表示を確認。[ログ](profile-check.log)。
- `node tools/test/pilot_avatars_check.js dbg/player-profile media/player-profile/avatars-validation.json`：[既存の猫68項目・16配置](avatars-validation.json)成功。[ログ](avatars-check.log)。
- `node tools/test/console_hud_check.js dbg/player-profile media/player-profile/console-validation.json`：[HUD359項目・32配置](console-validation.json)成功。[ログ](console-check.log)。
- `node tools/test/quick_check.js origin/main`：成功。武器286種・パーツ・マップに増減変更なし。cityは64秒、dockは25秒で青戦力0の正常終局。ともにブラウザエラーなし。[ログ](quick-check.log)。

画像は本体のHTML・HUDと埋め込み済みの猫から取得。新しい画像素材は追加していない。
