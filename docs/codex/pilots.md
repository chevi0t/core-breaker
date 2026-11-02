# パイロットの絵を足す・差し替える手順（Codex など向け）

オーナーの指定（2026-11-02）：パイロットの絵の取り込みと、層に分けて揺らす作業は Codex に任せる（Claude の作業量を減らすため）。ここまでの3人（テストパイロットちゃん `moss4`、エースパイロットちゃん `ace`、戦術士官ちゃん `officer`）は Claude が入れた。その時に分かったことをここにまとめる。

## 今の作り

| 所 | 中身 |
|---|---|
| `prototype/avatars/pilots/<id>/` | `normal.webp`・`damage.webp`（オーナーの元絵。ポーズが同じ2枚、透過、1024px）、`README.md`（出所と SHA-256、決めたこと） |
| `<id>/layers/rig.json` | 層の分け方（多角形と色の条件。位置は絵の幅と高さを1とした値）。項目の意味は `tools/pilot_layers.py` の先頭 |
| `<id>/layers/*.webp`・`manifest.json` | `tools/pilot_layers.py <id>` が作る7枚（後ろ髪 hairB・体 body・左腕 armL・右腕 armR・顔 head・やられ顔 headD・前髪 hairF）。手で書き換えない |
| `<id>/layers/v11.json` | ComfyUI の描き足し（v11）の指示文。`tools/pilot_v11.py` が読む |
| `<id>/layers/plate_body.png`・`plate_face.png` | オーナーが v11 で描き足した絵（無ければ色をにじませた仮の描き足し） |
| `prototype/index.html` の `PILOTS` | 選べるパイロットの一覧（`id`・`name`・`trait`）。`if (PILOT_SPRITES.<id>) PILOTS.push(...)` の形で足す |
| `prototype/index.html` の `PILOT_RIGS.<id>` | 揺れの設定。`layers` の中が層で揺らす時の値（腰の支点 `pivot`、胸 `chest`、首 `neck`、腕の肩と手 `arms`、髪の根元と届く範囲 `hairB`・`hairF`、倍率 `amp`）。外側は層が読めない時の1枚絵用のおおよその値 |
| `PILOT_SPRITES`・`PILOT_LAYERS` | `tools/embed_pilot_sprites.py --shrink` が埋め込む。手で書き換えない |

揺れの仕組み（ばね、網目、髪の3節の鎖）は `createPilotLayers` と `docs/DESIGN.md`「パイロット絵の揺れ」。仕組みは変えない（変えるなら「確認する所」）。

## 手順

1. **絵を置く**：オーナーの2枚を `prototype/avatars/pilots/<id>/normal.webp`・`damage.webp` に置く（PNG なら WebP 品質95 にする）。`README.md` に出所・日付・元の PNG の SHA-256・決めたことを書く（`officer/README.md` が見本）。`id` は小文字英数字と `_`。今ある id は変えない（保存した選択が読めなくなる）。
2. **rig.json を書く**：似たキャラの `rig.json` を写して直す。
   - 髪の色で選ぶ：紫など服と色相が違う髪は `hairHue` だけ、白い髪は `hairLight`（`ace`）、黒髪で服も紺は `hairDark`（`officer`）。
   - `head`（顔。帽子は顔に入れる）・`armL`・`armR`（肩から手まで）・`frontHair`（この中の髪が前髪）・`bodyHull`（体の外形。**腰の輪郭に沿わせる**）を多角形で描く。
   - 服と同じ色の房は `hairPolyAll`（輪郭をなぞる）、目・眉・ほくろは `notHair`、操縦桿の頭などは `notHairPoly`。
   - 腕の多角形が髪にかかる時は `armRefine` で袖の色で絞る（`light`＝白い袖、`dark`＝黒い袖、`sat`＝髪より彩度の高い袖。手と袖口は `keep`）。
3. **層を作って重ねて見る**：
   ```sh
   python3 tools/pilot_layers.py <id>            # 重ねて元の絵に戻るかの誤差も出る（0.06 前後なら良い）
   python3 tools/pilot_overlay.py <id> out.png   # 層の色分けを絵に重ねる
   ```
   重ね絵で必ず確かめる所（今までの失敗）：
   - 腕の層に髪の筋が入って腕が太い、または髪の層に腕の形が残る → `armL`・`armR` を細く、`armRefine` で絞る。
   - 腰や太ももが髪になる、髪が体の中に残る → `bodyHull` を腰の輪郭に沿わせる。細かい格子で輪郭を取ると早い。
   - 操縦桿の下の端などが「体の外の細い毛」として髪に入る → `strayMaxY` を下げる。
   - 前に垂れる房がまだらにしか拾えない → `hairPolyAll`。
   - 白い髪で、後ろ髪の描き足しに体の暗い色がにじむ → `hairLight` の時は明るい所だけ使う（実装済み）。
   - やられ顔の違いが顔の外にある（湯気のしるしなど）→ 出ない。`pilot_layers.py` が警告を出すので、README に書く。
4. **ゲームに入れる**：`PILOTS` に1行（名前の下の一言 `trait` はオーナーに聞くか、決めて PR に「決めたこと」と書く）、`PILOT_RIGS.<id>` を似たキャラから写して、腰・胸・首・肩・手・髪の根元の位置をこの絵に合わせる（倍率 `amp` はオーナーが決めた moss4 の値のまま）。それから
   ```sh
   python3 tools/embed_pilot_sprites.py --shrink
   ```
5. **確かめる**：
   ```sh
   python3 tools/test/make_dbg.py dbg
   node tools/test/pilot_sprites_check.js          # 層のキャラが全員層で揺れるか
   node tools/test/pilot_avatars_check.js         # パイロットの選択と表示
   node tools/test/pilot_sway_frames.js <id> out/<id>   # 止まる・左右に吹かす・着地・被弾の7枚。目で見て、顔や体がゆがまないか
   node tools/test/quick_check.js origin/main
   ```
   ページの大きさ（`index.html` は claude.ai の上限 16MB。今は約1.8MB）も PR に書く。層は1人あたり約60KB で、オーナーの上限は1人100KB 前後。
6. **v11 の材料を作る**：`<id>/layers/v11.json` に指示文を書き（`officer` を写して、消す物と描き足す物をその絵に合わせて英語で書く）、
   ```sh
   python3 tools/pilot_v11.py <id> <出力フォルダ>
   ```
   出力フォルダ（マスク2枚・元絵・ワークフロー JSON・README_JA.txt・重ね絵）を zip にしてオーナーに渡す。リポジトリには入れない。
7. **v11 の絵が届いたら**：`<id>_body_plate`・`<id>_face_plate` を `layers/plate_body.png`・`plate_face.png` に置いて 3〜5 をやり直し、PR を出す。

## PR とマージ

- 1キャラ1つの PR。説明は AGENTS.md のとおり（変更前・変更後・決めたこと・確かめたこと）。7枚の重ね絵と揺れの絵を、PR の説明に貼るかオーナーに渡す。
- `index.html` の `PILOTS`・`PILOT_RIGS` に足すだけで、`createPilotLayers` などの仕組みを変えていなければ、オーナーの OK でマージする（オーナーが別に決めるまで、自分ではマージしない）。仕組みや `tools/pilot_layers.py` の共通の処理を変えたら「確認する所」。
- 公開ページと GitHub Pages は今までどおり（AGENTS.md）。
