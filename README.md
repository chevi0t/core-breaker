# コアブレイカー

**▶ 遊ぶときはここから：https://chevi0t.github.io/core-breaker/**

ブラウザで開くだけで遊べます（インストール不要。PC のキーボード・マウス、ゲームパッド、スマホのタッチに対応）。
ルールと操作は、ゲームのメニューの「操作説明」にあります。

---

## どういうプロジェクト？

SEGA のロボット対戦ゲーム「ボーダーブレイク」（2023年にサービス終了）の遊びを、PC のブラウザで再現しようとしている**非公式のファンメイド作品**です。

> **牛マン非公認です。株式会社セガ（SEGA）とは関係ありません。** セガや開発元へのお問い合わせはご遠慮ください。

- 2チームに分かれてロボット（機体）で戦い、相手の基地の「コア」を壊すか、より多く削った方が勝ち。
- 兵装（強襲・重火力・遊撃・支援）ごとに主武器・副武器・補助装備・特別装備の4枠を持ち、機体のパーツ（頭・胴・腕・脚）を組み替えて出撃します。
- 味方も敵も Bot が動かすので、1人で試合を最後まで遊べます。
- **オンライン対戦の試作**（Ver180〜）：PC どうしで、1人がホストになって部屋を作り、ほかの人が参加します。まだ試作なので、回線によってはつながらないことがあります（スマホではオンラインのボタンを出していません）。

公式の画像・モデル・音・ロゴは使っていません。機体や武器の形はコードで組んだオリジナルで、画面に出す名前も独自の物です。武器やパーツの数値は、攻略 wiki（[BORDER BREAK @ ウィキ](https://w.atwiki.jp/borderbreak/)）の値を参考にしています。

今の版は画面のメニュー右上に出ています（例 `Ver180`）。変更の記録は [CHANGELOG.md](CHANGELOG.md) にあります。

## ほかの遊び方

- **ネットにつながっていない所で**：[releases/](releases/) の zip を解凍して、中の `index.html` を開きます（古い版です）。
- **このリポジトリから**：`prototype/index.html` をブラウザで開きます（three.js などをネットから読むので接続が要ります）。

## 素材の出典と謝辞

このゲームは、素材やデータを自由に使える形で公開してくださった皆さまのおかげで作れています。心より感謝します。
全部の一覧は、公開ページのメニューの「素材の出典・ライセンス」（[出典の一覧](https://chevi0t.github.io/core-breaker/credits/)）から読めます。

- **戦闘中の BGM**：Author: Centurion_of_war さんの nightmareheavy.ogg を使わせていただいています。ありがとうございます。出典：OpenGameArt.org「[Nightmare(prototype)](https://opengameart.org/content/nightmareprototype)」（CC0）
- **効果音**：Freesound で CC0 として公開されている音を使わせていただいています。表示の義務はありませんが、作者の皆さま（bolkmar さん、vabadus さん、qubodup さん、LeMudCrab さん、Jarusca さん、alienbomb さん、loudernoises さん、coolguy244e さん、Joao_Janz さん、pumodi さん、florianreichelt さん、Rickplayer さん）への感謝として、曲名と元のページを [sounds/CREDITS.md](sounds/CREDITS.md) に載せています。
- **都市のマップ**：国土交通省 Project PLATEAU の 3D 都市モデル（公開した各自治体の皆さま）と、国土地理院の標高・道路のデータを加工して使っています。出典・加工の内容は各マップの CREDITS（[mapdesign/kanto](mapdesign/kanto/CREDITS.md)、[mapdesign/kanto_half](mapdesign/kanto_half/CREDITS.md)、[mapdesign/hoshimichi](mapdesign/hoshimichi/CREDITS.md)）にあります。
- **パイロットの絵**：オーナーが用意した絵と、本作用に作った絵です（[prototype/avatars/CREDITS.md](prototype/avatars/CREDITS.md)）。
- **ソフトウェア**：[three.js](https://threejs.org/)（r128、MIT License、[vendor/three-r128/](vendor/three-r128/)）、オンライン対戦の通信に [PeerJS](https://peerjs.com/)（1.5.5、MIT License）。

外から素材を足すときは CC0 か CC BY の物だけにし、出典をこのように書いています。

## フォルダ

| パス | 中身 |
|---|---|
| `prototype/index.html` | ゲーム本体（HTML と JavaScript、three.js r128、ビルド不要） |
| `prototype/style.css` | 画面の見た目 |
| `prototype/weapons.js`・`parts.js`・`pilots.js` | 武器・パーツ・パイロットの表 |
| `prototype/online/` | オンライン対戦の試作（通信と同期） |
| `prototype/maps/<id>.js` | マップのデータ。`prototype/maps.js` は `tools/build_maps.py` がここから作る |
| `prototype/sounds.js`・`music.js` | 効果音と BGM（`tools/build_sounds.py` が `sounds/` から作る） |
| `docs/DESIGN.md` | 設計書（コードの構成、データの約束事、数値の出典、決まっている仕様） |
| `plan.md` | 計画と残タスク |
| `research/` | wiki から調べた武器・パーツの数値 |
| `mapdesign/` | マップの設計メモと俯瞰図、都市マップの出典 |
| `tools/` | マップ・音・公開ページを作る道具と、ブラウザでの動作確認（`tools/test/`） |
| `releases/` | 配布版の zip |
| `vendor/three-r128/` | 同梱の three.js（MIT） |

## 作り方

オーナーが決め、Claude が Issue を書いて確かめ、Codex などの AI が実装して PR を出しています。main に入った物は、GitHub Pages（`gh-pages` ブランチ、`tools/build_pages.py` で作る）と claude.ai の公開ページに反映します。AI 向けの決まりは [AGENTS.md](AGENTS.md) にあります。
