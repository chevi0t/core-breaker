# AGENTS.md（Codex など AI エージェント向け）

このリポジトリは、ボーダーブレイクの遊びを再現する非公式のファンメイド試作「コアブレイカー」です。
作業の前に `docs/DESIGN.md`（設計書）と、下の「作業ごとの手引き」のうち関係する所を読んでください。
会話・コメント・画面の文言・PR の説明は日本語です。

## 体制

- オーナー（ユーザー）が決め、Claude が Issue を書いてレビューし、Codex などが実装する。
- 1つの Issue に1つのブランチと PR。main へ直接 push しない。マージは Claude かオーナーがする。ただし下の「自分でマージしてよい変更」に当たる PR だけは、Codex が自分でマージしてよい。
- Issue に書いていない仕様は変えない。決める必要があった所は、PR の説明に「決めたこと」として書く（オーナーと Claude が確かめる）。
- PR の説明には「変更前」「変更後」と、確かめたこと（動かしたテストとその結果）を書く。
- 公開版のページ（claude.ai）と配布 zip（`dist/`、`tools/build_zip.py`）は Claude が作る。PR では扱わない。
- GitHub Pages（https://chevi0t.github.io/core-breaker/ 、`gh-pages` ブランチ）は、main が変わった後に Claude でも Codex でも作り直して push してよい（オーナーの指定 2026-10-27）。手順は下の「GitHub Pages の更新」。

## 自分でマージしてよい変更（オーナーの指定 2026-10-20）

オーナーの指定で、次の「任せる所」だけを変えた PR は、Claude の確認を待たずに Codex が自分でマージしてよい。「確認する所」か「触らない所」に当たる変更が1つでも入っていれば、今までどおり Claude かオーナーがマージする。迷ったら「確認する所」として扱う。

手順（任せる所だけの PR）：

1. ブランチを切って PR を出す（main へ直接 push しない）。PR の説明は今までどおり（変更前・変更後・決めたこと・確かめたこと）で、頭に「自分でマージ：任せる所だけ」と書く。
2. 最新の main を取り込んで衝突を直し、`quick_check.js origin/main` と、その変更の `*_check.js` を回す。両方とも成功し、ブラウザのエラーが無ければ、merge でマージする（squash しない）。
3. 失敗や衝突を残したままマージしない。前の PR がマージされるまで、次の PR を重ねない（1つずつ）。
4. マージした物は、Claude が1時間ごとの確認で共有フォルダへ写し、公開ページに入れる。公開ページと配布 zip は今どおり Claude が作る。

**任せる所**

| 変更 | 場所と条件 |
|---|---|
| 新しい武器・パーツ・特別装備を足す | `index.html` の「武器のモデル」「機体パーツ」「兵装と武器」「武器の型」「特別装備」「AC由来の追加特別装備」の節と、機体カスタマイズで選べる一覧（`ARMORY`・`SERIES` など）。数値はアーケード版 wiki、採用記録は `research/` |
| 見た目だけの変更 | 武器の形（`buildWeaponGeo`）、光る演出（発砲炎など）。威力・当たり判定・動きの数値は変えない |
| 新しいマップ | 新しい `prototype/maps/<新しいID>.js` と、マップの自動生成（`tools/mapgen*.js`、`tools/generate_map.js`）。`maps.js` の作り直しと公開はマップ製作スレッド（Claude）がする |
| 調べ物・記録・試験 | `research/`、`media/`（大きな動画や試合の記録は入れない）、新しい `tools/test/*_check.js`、`make_dbg.py` の `__g` に読み口を足すこと、自分が足した物の `docs/DESIGN.md` の説明 |

**確認する所**（今までどおり PR を出し、Claude かオーナーがマージ）

- 全部に効く仕組み：`index.html` の「当たり判定」「射撃」「弾道とヒットエフェクト」「Bot」「ロックオン」「プレイヤー入力」「HUD」「スコア」「進行」「機体」（体の形と動き）「マップ」「マップ要素」「マップの組み立て」「設置物と索敵」「メニュー」「機体カスタマイズ」（一覧に足すだけなら任せる所）、効果音とBGM。
- 今ある武器・パーツの数値（PS4版からアーケード版へ直すかは、オーナーがまだ決めていない）と、今あるマップのデータ（今ある `prototype/maps/*.js`、`RULES.md`、`README.md`）。
- 下の「変えてはいけないこと」に関わる変更。
- 外から持ってくる素材（音・画像・モデル。ライセンスとクレジット）。
- 保存データの形（`localStorage` のキーと中身。今ある武器・パーツのキー、例えば `rod` の名前を変えない）。
- 試験の共通の道具（`quick_check.js`、`bot_battle.js`、`mapgen_browser.js`）と `package.json`。

**触らない所**（Claude かオーナーの物）

- claude.ai の公開ページ、`dist/`、`releases/`、`tools/build_zip.py`、`tools/repo_sync.py`、`tools/build_pages.py`（使うのはよい）。
- 道具で作るファイル：`prototype/maps.js`・`sounds.js`・`music.js`（手で書き換えない）。
- `AGENTS.md`、`CLAUDE.md`、`docs/codex/`（手順書と Issue の中身）、`plan.md`。

## GitHub Pages の更新（Codex も push してよい。オーナーの指定 2026-10-27）

https://chevi0t.github.io/core-breaker/ は `gh-pages` ブランチの直下をそのまま配信している。main に変更がマージされた後（自分でマージした PR も含む）、次の手順で作り直して `gh-pages` へ push してよい。PR は要らない。

1. マージ済みの最新の main を取り出す（`git checkout main && git pull --ff-only`）。コミットしていない変更がある状態では作らない。
2. `gh-pages` を別のフォルダに取り出す。初回は `git fetch origin gh-pages && git worktree add ../core-breaker-pages origin/gh-pages -B gh-pages`、2回目からは `git -C ../core-breaker-pages pull --ff-only origin gh-pages`。
3. `python3 tools/build_pages.py ../core-breaker-pages` で作り直す（index.html・maps.js・sounds.js・music.js・three.min.js・credits/・build-info.json・README.md）。
4. `node tools/test/pages_check.js ../core-breaker-pages` が成功することを確かめる（スマホと PC の大きさで出撃まで、同梱の three.js、出典のページ、ハッシュ）。
5. `../core-breaker-pages` でコミットし（メッセージは「〇〇を公開版へ反映」）、`git push origin gh-pages`。`--force` は使わない。push が断られたら（ほかの誰かが先に更新した）、2 からやり直す。

- `gh-pages` を main へマージしない。`gh-pages` の中身を手で書き換えない（いつも `tools/build_pages.py` で作る）。
- 出すのは main の物だけ（作業中のブランチや、マージ前の PR の中身を出さない）。

## 構成

| パス | 中身 |
|---|---|
| `prototype/index.html` | ゲーム本体（HTML・CSS・JavaScript の1ファイル、three.js r128、ビルド不要）。`// ---- 見出し ----` で区切ってある（`docs/DESIGN.md` 第2章） |
| `prototype/maps/<id>.js` | マップのデータ（書き方 `prototype/maps/README.md`、決まり `prototype/maps/RULES.md`） |
| `prototype/maps.js` | `python3 tools/build_maps.py` が `maps/` から作る。手で書き換えない |
| `prototype/sounds.js`・`music.js` | `tools/build_sounds.py` が `sounds/` から作る |
| `research/` | wiki から調べた数値。`weapons/*.md`、`weapons/types/*.json`、`parts/*.md` は PS4版 wiki の表（本作の今の数値の元）。アーケード版 wiki の表は `arcade/` に置く。ACの採用記録は `weapons/types/arcade.json` と `parts/types/` |
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
8. 数値の出典はアーケード版 wiki（BORDER BREAK @ ウィキ https://w.atwiki.jp/borderbreak/ 。オーナーの指定 2026-10-19：PS4版は終盤に性能のインフレが大きかったので、アーケード版に合わせて移植する）。PS4版 wiki の値は新しく足す物に使わない（PS4版の扱いはその後でオーナーが決める）。本作に今入っている数値の多くは PS4版の値で、Issue で頼まれない限り変えない。

## 確かめ方

Python 3、Node.js、Playwright（Chromium）を使う。ヘッドレスでは WebGL に `--use-gl=swiftshader` が要る（テストの中で指定済み）。

環境の準備（Codex の環境の setup script など）：`npm install && npx playwright install --with-deps chromium`。Python のライブラリは要らない。`npm test` で dbg の作成・全武器の確認・4マップの Bot 戦をまとめて回せる（Bot 戦は時間がかかる）。

```sh
node tools/test/quick_check.js origin/main             # 簡易テスト。main から増えた・変わった武器とパーツだけを試し、Bot 戦を2マップ60秒
python3 tools/test/make_dbg.py dbg                     # 動作確認用の dbg/dbg.html を作る（__g で中の状態を読める）
node tools/test/weapons_check.js dbg                   # 全武器を撃ってエラーが無いか
node tools/test/bot_battle.js dbg city,wide,mesa,dock 150   # Bot 同士の試合。各マップ「エラー なし」になること
python3 tools/build_maps.py                            # マップの検査と maps.js の作り直し
node tools/test/map_check.js dbg <マップID>            # 施設の置き場所、ポッドの見え方、カタパルトの着地点など
```

武器・パーツが多くなったので、PR ではまず `quick_check.js`（簡易テスト）と、その PR で足した仕組みの `*_check.js` を回す（オーナーの指定 2026-10-20：組み合わせの全件の試験は無理）。全武器の `weapons_check.js`、全混成の `mech_shapes_check.js`、4マップ150秒の `bot_battle.js` は、射撃・当たり判定・機体の形・Bot など全部に効く所を変えたときだけ回す。

`index.html` を変えたら、ブラウザのコンソールにエラーが無いことと、`bot_battle.js` が通ることを確かめる。仕様が変わったら `docs/DESIGN.md` の該当する所も直す。

## 作業ごとの手引き

頼まれる作業は `docs/codex/tasks/` に1ファイルずつある（GitHub の Issue と同じ中身）。詳しい手順は `docs/codex/` にある。作業を始める前に、その作業の手順書を最後まで読む。

| 作業 | 手順書 | 任せる範囲（オーナーの指定 2026-10-19） |
|---|---|---|
| マップ | `docs/codex/mapgen.md`（オーナーの設計書、2026-10-19）と `docs/codex/map.md` | 自動生成のルーチンごと。テーマ・名前・大きさ・プラント・地形・施設の配置から、Bot の通り道と動き方（Bot のルール）まで |
| 武器 | `docs/codex/weapons.md` | 調べ物から、性能・形（モデル）を作り込んでゲームに入れるまで |
| 機体パーツ | `docs/codex/parts.md` | 調べ物から、性能を作り込んでゲームに入れるまで |
| 機体の形 | Issue に書いた内容と `docs/codex/parts.md` の「今の作り」 | シリーズごとの形の作り分け |

どの作業も `prototype/index.html` を変えることが多い。PR を出す前に main を取り込み、衝突を直してからテストを回す。
