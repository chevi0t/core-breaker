# オンライン定型通信（#214）

## 変更前

オンラインのロビー・参加者間に定型文を送る機能はない。既存Gの円形メニューは本体のBot指示用。

## 変更後

- V、カテゴリの数字、定型文の数字の順で送信する。テンキー、画面の選択ボタンも使える。
- ロビーでは全参加者、試合中は味方だけ。ホストが送信者と配信先を決める。
- 死亡・行動不能中は送信不可。Vは元の兵装選択へ渡す。メニューを開いたまま倒れても閉じる。
- 0またはBackspaceで戻る。V、Escape、10秒放置、フォーカス喪失、試合・生命の変更で取り消す。
- 選択に使ったキーはkeyupまで隔離し、数字が武器変更や発砲につながらない。移動・視点は止めない。
- 受信履歴は最大5行、8秒間。ロビーに専用欄、戦闘中は右側。申告名と文章はtextContentで表示。
- テキスト先行。音声素材を追加しない。既存のGによるBot指示・地点指定とは独立。

## 決めたこと

| 番号 | カテゴリ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| 1 | 作戦 | 攻撃しよう | ベースを守ろう | プラントを確保しよう | いったん後退しよう |
| 2 | 援護 | 援護を頼む | 一緒に行こう | 修理を頼む | 援護する |
| 3 | 報告 | 敵を発見 | ベースに敵が接近 | 目標へ向かう | 準備できた |
| 4 | 返答 | 了解 | 今は難しい | ありがとう | ごめん |

送信者ごとに1.5秒間隔、同文5秒間隔、直近10秒で3通まで。検査はホスト自身も含めホスト側で実施し、無効要求への拒否応答も250msで間引く。連番とphase/match/lifeを検査する。本文・任意の宛先・名前・座標をゲスト要求からコピーしない。申告名自体の本人認証を追加する機能ではない。

新しい独立JSファイルは追加せず、既存配布対象のgame.js・ui.js・ui.cssで完結。通信形式は既存の信頼性付きcontrol線で`quickChatRequest` / `quickChat` / `quickChatResult`を使う。位置写真・秘匿情報・ゲーム計算を変更しない。

## 確かめたこと（2026-11-09）

成功:

- `node tools/test/online_quick_chat.test.js`：定型ID、送信者偽装、全員/味方配信、ホスト/ゲストの死・行動不能、生命/試合/phase/連番、間隔・同文・10秒窓、無効要求1000件の拒否応答抑制、表示期限・退出。
- `node tools/test/online_quick_chat_input.test.js`：製品UIのコードをDOM代役で実行。V/数字/テンキー、選択直後のrepeat/keyup、Esc/0、入力欄/修飾キー、死亡時の兵装入力、生命・phase・blur・放置・退出。
- `node --test tools/test/online_*.test.js`：22ファイル成功。
- `node tools/test/names_check.js`：14ファイル、重複キーなし。
- `python3 tools/test/make_dbg.py dbg`、構文検査、`git diff --check`。

未検証:

- `online_quick_chat_check.js`を追加。実PeerServerで3人、ロビー全員・試合味方配信、実キー入力、死亡、取消、申告名、PC/スマホの収まり、退出を確認しスクリーンショットを出す。
- この実行環境はPlaywright同梱Chromiumがなく、既存`/usr/bin/chromium`もsocket()がEPERMで起動できなかった。承認付き実行でも同じ。したがって実DOM・実WebRTC・目視・スクリーンショットの合格は主張しない。DOM代役試験はこれらの代わりではない。
- `node tools/test/quick_check.js origin/main`も実行を試みたが、基準dbg生成後に同梱Chromium不在で中断。武器・Bot戦まで到達していない。
- 実行可能な環境で `python3 tools/test/make_dbg.py dbg`、`node tools/test/online_quick_chat_check.js dbg`、`node tools/test/quick_check.js origin/main`を実施する。既存オンラインUI/部屋試験も統合後に実行する。
