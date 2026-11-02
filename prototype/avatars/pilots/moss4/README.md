# テストパイロットちゃん（内部ID moss4）

## ページに入れる縮小版（2026-11-02）

揺れ（`PILOT_RIGS`）を入れたので、ページに入れるのは `normal` と `damage` の2枚だけ。`boost_left/right.png` は原画として残すが埋め込まない（オーナー指定 2026-11-02「量産は標準＋やられ顔」）。

原画4枚（下の表）はこのフォルダにそのまま残す。ページが重くなったので（原画のまま埋め込むと約9MB）、`embed/` に320px・WebP（品質88）の縮小版を置き、`tools/embed_pilot_sprites.py` はそちらを埋め込む（オーナー指定 2026-11-02）。作り直しは `python3 tools/embed_pilot_sprites.py --shrink`。

## 現在のユーザー提供透過版

最新添付 `MOSS4_sprite_03_defeated_00015_.zip`（Library `libfile_01b1f91c75c08191991112e510b088d2`）の4枚を、そのまま採用。全て1024×1024 RGBA PNGで実アルファあり。再描画・追加背景除去・反転・縮小は行わず、原本とバイト一致。692dc17のAI編集版は不採用とし、混在させていません。左右は提供ファイル名のleft/rightに従います。表示名・選択保存・状態切替・猫画像は維持。

| 格納名 | 提供ファイル | SHA-256 |
| --- | --- | --- |
| `normal.png` | `MOSS4_sprite_00_idle_00012_.png` | `3f262072d11ce2e416bccfb34f6024fbb945a38f7cb8cc1175853469dae3e537` |
| `boost_left.png` | `MOSS4_sprite_02_boost_left_00013_.png` | `cc8822f2b5a015258180afa063400dc7c0413d85c19992fa7217f9682519485b` |
| `boost_right.png` | `MOSS4_sprite_01_boost_right_00013_.png` | `f15ba096c3d158937ac3cc98b86f3ad53a89bd0d4e5cf7265f2e8586b2b4aa6a` |
| `damage.png` | `MOSS4_sprite_03_defeated_00015_.png` | `2423cf03bcff6053926d7d0b9cdf64e1fa72c8b368d51c08074da019d30ff6af` |

確認：4状態の実描画とPNGバイト一致、選択保存・復帰、猫68項目/16配置を検証し、ブラウザエラーなし。実描画比較は Library `libfile_3269c4ddae948191bd83c07aff809a64` 版1（一覧部分は検査用で製品UIには含めない）。

## 不採用となったAI透過編集版（692dc17、履歴）

ユーザー依頼で最新添付の白背景をOpenAI画像編集により除去。旧画像へ戻さず、2070c46の4枚を元にした1254×1254 RGBA PNGへ差替え。原本は2070c46と受領ZIPに保持。ゲームの表示サイズ・配置・状態切替はそのまま。

白衣、髪、操縦桿、座席、煙を黒/緑/橙背景で目視確認。左右ブーストの座席を誤って抜いた初回結果は再編集して修正。アルファ0〜255が実在し、輪郭と煙の縁に半透明を含む。人物の大半はアルファ253前後（完全255ではない）。加工は単純なマスク処理ではなく画像編集AIの出力のため、顔・髪・衣装の細線や色調には差があり、元画素の完全維持は保証しない。ポーズ/フレーミング/4状態の対応は維持した。画像編集以外のPython等による画素加工は行わず、検査・コピー・HTML埋め込みのみ。

4状態表示と埋め込んだ画像のバイト一致、選択保存・復帰、猫68項目/16レイアウト、ブラウザエラーなしを確認。比較用一覧は検査画面に一時追加したものでゲームUIには含めない。サイト公開は未承認。

| 格納名 | 透過編集PNG SHA-256 |
| --- | --- |
| `normal.png` | `e1cebcc584e8485ce4edf1d53186d5a6b6390395664d680b7c91462cba38fa55` |
| `boost_left.png` | `2a05b75b66914503d2262768140dfc805c73af6a6d30f83c7495680cd54155ae` |
| `boost_right.png` | `feddc5b5e628834d3af8124ad97df627d4ffd89e4e4fbbeca7e8ee2af58d2d7e` |
| `damage.png` | `d338181b52e4ce83a30e0c717bac25cf079af108c42d7b7705ea2956124ba4ab` |

## 白背景版の未加工受領記録（2070c46）

2026-11-01 UTCに受領した `MOSS4_sprite_03_defeated_00013_.zip`（Library `libfile_a761492a6abc81918f96a62299acd15c`）の4枚へ差替え。全て1024×1024、RGB PNG、白背景付き・透過なし。元ファイルのバイト列を変更せず格納・HTML埋め込み。描き直し・反転・背景除去・縮小なし。名前、保存ID、状態切替、既存猫は不変更。今回はローカル差替えまでで公開未承認。添付ZIP原本はローカル受領フォルダに保管。旧透過版は親コミット51824f3から復元可能。

| 格納名 | 元ファイル | SHA-256 |
| --- | --- | --- |
| `normal.png` | `MOSS4_sprite_00_idle_00011_.png` | `cbae29814ffb05ef7a7dc05e77c3d101eb6f1828bfb25bb0d16eca24a245e183` |
| `boost_left.png` | `MOSS4_sprite_02_boost_left_00011_.png` | `d28eafa1811dcfd13bb31a799766bff86daf6574cd5bb29195002ca2146fe98a` |
| `boost_right.png` | `MOSS4_sprite_01_boost_right_00011_.png` | `eeaffbedfcf1b6961eb48df9319b493fb76dff08c137877e8ff4ea7a8dc3dcba` |
| `damage.png` | `MOSS4_sprite_03_defeated_00013_.png` | `b42534b607611e89de94035aef09dc54ad71f451498c42c6479ad023bfb9e4a6` |

## 過去の採用記録

### 初回の受領・採用記録

旧透過版PNGは、ユーザー承認済みの背景透過編集版（1254×1254、RGBA）。画像編集AIにより白背景を除去した版で、元絵との細部の差もユーザー確認済み。下記の元画像/ハッシュは初回受領の履歴であり旧透過版PNGとは異なります。元絵はコミット455a84cに保存。ローカルで選択・4状態切替を実装し、2026-11-01にユーザーがWeb公開を承認。

ユーザー提供ZIP `MOSS4_sprite_03_defeated_00006_.zip` の4枚をファイル名の状態表記に従い配置（2026-11-01）。画像生成・反転・縮小・背景除去は行っていません。全画像1024×1024px、RGB PNG、白背景付き（透過なし）。提供者の素材として受領。権利・生成手段の詳細は未確認。

初回受領時点では格納のみ。その後、上記の透過編集版をMOSS4として追加登録し、4状態切替まで実装済み。配布最適化とサイト公開はユーザー承認済みです。

| 格納名 | 元ファイル | SHA-256 |
| --- | --- | --- |
| `normal.png` | `MOSS4_sprite_00_idle_00003_.png` | `a28750c64f4a30f6eeb55495c9abd8f1d81a482660dae4c04e1f8a31148e9376` |
| `boost_left.png` | `MOSS4_sprite_02_boost_left_00003_.png` | `434fc40e79a6c0b4fec6ffea897d09c7aa1e84dd8439023cb3bfb3ed7f8d1360` |
| `boost_right.png` | `MOSS4_sprite_01_boost_right_00003_.png` | `a01eebe2e9700f2582b5765f2ee83f462aa629a92e0f3dbbdc5b46df77d56e19` |
| `damage.png` | `MOSS4_sprite_03_defeated_00006_.png` | `ab59445641ff5d05ff026a986b5bb06401175b864068986bd60a84b576035664` |

今回の確認：4状態の描画画像が提供PNGとバイト一致、選択保存・復帰・猫への切替成功。既存猫68項目/16レイアウト成功。プレビュー（比較用の4状態一覧を検査画面に一時追加、製品UIには含めない）：Library `libfile_3269c4ddae948191bd83c07aff809a64`。
