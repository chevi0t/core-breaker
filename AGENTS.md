# AGENTS.md（Codex など AI エージェント向け）

このリポジトリは、ボーダーブレイクの遊びを再現する非公式のファンメイド試作「コアブレイカー」です。
作業の前に `docs/DESIGN.md`（設計書）と、下の「作業ごとの手引き」のうち関係する所を読んでください。
会話・コメント・画面の文言・PR の説明は日本語です。

## 体制

- オーナー（ユーザー）が決め、Claude が Issue を書いてレビューし、Codex などが実装する。
- 1つの Issue に1つのブランチと PR。main へ直接 push しない。マージは Claude かオーナーがする。
- Issue に書いていない仕様は変えない。決める必要があった所は、PR の説明に「決めたこと」として書く（オーナーと Claude が確かめる）。
- PR の説明には「変更前」「変更後」と、確かめたこと（動かしたテストとその結果）を書く。
- 公開版のページ（claude.ai）と配布 zip（`dist/`、`tools/build_zip.py`）は Claude が作る。PR では扱わない。

## 構成

| パス | 中身 |
|---|---|
| `prototype/index.html` | ゲーム本体（HTML・CSS・JavaScript の1ファイル、three.js r128、ビルド不要）。`// ---- 見出し ----` で区切ってある（`docs/DESIGN.md` 第2章） |
| `prototype/maps/<id>.js` | マップのデータ（書き方 `prototype/maps/README.md`、決まり `prototype/maps/RULES.md`） |
| `prototype/maps.js` | `python3 tools/build_maps.py` が `maps/` から作る。手で書き換えない |
| `prototype/sounds.js`・`music.js` | `tools/build_sounds.py` が `sounds/` から作る |
| `research/` | wiki から調べた数値（`weapons/*.md`、`weapons/types/*.json`、`parts/*.md`） |
| `mapdesign/` | マップの設計メモと俯瞰図（`map_top.py`） |
| `tools/` | `build_maps.py`、`gen_rough.py`（地面の起伏）、`build_sounds.py`、`build_zip.py`、`repo_sync.py`、`test/` |
| `plan.md` | 計画と残タスク |

## 変えてはいけないこと（オーナーの決定。変えるなら先に確認）

`docs/DESIGN.md` 第5章「守ってほしい設計方針」と、各節で「ユーザー指定」と書いた値に従う。特に：

1. ロックオンで弾を照準の中心へ補正しない。
2. コアの傘はただの障害物。
3. リペアポッドの使用中は撃てず、ダッシュもジャンプもできない（リペアユニットだけ使える）。
4. 兵装ごとに主武器・副武器・補助装備・特別装備の4枠。
5. Bot もプレイヤーと同じルールで動く。
6. 公式の素材（画像・モデル・音・ロゴ）を使わない。画面に出す名前に公式の名称（武器名・マップ名・地名・メーカー名）を使わない。wiki の名前は出典としてコードのコメントや `research/` にだけ書く。
7. 外部の素材を足すなら CC0 か CC BY だけ。出典を `sounds/CREDITS.md` のような CREDITS に書き、作者への礼を丁寧に書く（オーナーの希望）。

## 確かめ方

Python 3、Node.js、Playwright（Chromium）を使う。ヘッドレスでは WebGL に `--use-gl=swiftshader` が要る（テストの中で指定済み）。

```sh
python3 tools/test/make_dbg.py dbg                     # 動作確認用の dbg/dbg.html を作る（__g で中の状態を読める）
node tools/test/weapons_check.js dbg                   # 全武器を撃ってエラーが無いか
node tools/test/bot_battle.js dbg city,wide,mesa,dock 150   # Bot 同士の試合。各マップ「エラー なし」になること
python3 tools/build_maps.py                            # マップの検査と maps.js の作り直し
node tools/test/map_check.js dbg <マップID>            # 施設の置き場所、ポッドの見え方、カタパルトの着地点など
```

`index.html` を変えたら、ブラウザのコンソールにエラーが無いことと、`bot_battle.js` が通ることを確かめる。仕様が変わったら `docs/DESIGN.md` の該当する所も直す。

## 作業ごとの手引き

詳しい手順は `docs/codex/` にある。作業を始める前に、その作業の手順書を最後まで読む。

| 作業 | 手順書 | 任せる範囲（オーナーの指定 2026-10-19） |
|---|---|---|
| マップ | `docs/codex/map.md` | テーマ・名前・大きさ・プラント・地形・施設の配置から、Bot の通り道と動き方（Bot のルール）まで |
| 武器 | `docs/codex/weapons.md` | 調べ物から、性能・形（モデル）を作り込んでゲームに入れるまで |
| 機体パーツ | `docs/codex/parts.md` | 調べ物から、性能を作り込んでゲームに入れるまで |
| 機体の形 | Issue に書いた内容と `docs/codex/parts.md` の「今の作り」 | シリーズごとの形の作り分け |

どの作業も `prototype/index.html` を変えることが多い。PR を出す前に main を取り込み、衝突を直してからテストを回す。
