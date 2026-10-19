# コアブレイカー（ファンメイド試作）

SEGA の「ボーダーブレイク」（2023年にサービス終了）の遊びをブラウザで再現する、非公式のファンメイド試作です。
公式の素材・名称・ロゴ・音は使っていません。機体や武器の形はコードで組んだオリジナル、数値は攻略 wiki の値を参考にしています。

## 遊び方

`prototype/index.html` をブラウザで開きます（three.js をネットから読むので接続が要ります）。
ルールとキー操作はゲームのメニューの「操作説明」にあります。オフラインで遊べる zip は `python3 tools/build_zip.py <版>` で作れます。

## フォルダ

| パス | 中身 |
|---|---|
| `prototype/index.html` | ゲーム本体（1ファイル、three.js r128、ビルド不要） |
| `prototype/maps/<id>.js` | マップのデータ。`prototype/maps.js` は `tools/build_maps.py` がここから作る |
| `prototype/sounds.js`・`music.js` | 効果音と BGM（`tools/build_sounds.py` が `sounds/` から作る） |
| `docs/DESIGN.md` | 設計書（コードの構成、データの約束事、数値の出典、決まっている仕様） |
| `plan.md` | 計画と残タスク |
| `research/` | wiki から調べた武器・パーツの数値 |
| `mapdesign/` | マップの設計メモと俯瞰図 |
| `tools/` | マップ・音・zip を作る道具と、ブラウザでの動作確認（`tools/test/`） |
| `vendor/three-r128/` | オフライン用の three.js（MIT） |

## 進め方

作業は Issue に書き、Codex がブランチで実装して PR を出し、Claude が確かめて main に入れます。
main に入った物は Claude が公開版のページと zip に反映します。AI 向けの決まりは `AGENTS.md` にあります。

## 謝辞

- 戦闘中の BGM は、Author: Centurion_of_war さんの nightmareheavy.ogg を使わせていただいています。ありがとうございます。出典：OpenGameArt.org「Nightmare(prototype)」（CC0）
- 効果音は Freesound で CC0 として公開されている音を使っています（作者の一覧は `sounds/CREDITS.md`）。
- three.js（MIT License）
