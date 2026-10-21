# 効果音とBGMの出典とライセンス

効果音は [Openverse](https://openverse.org/) で探した、自由に使えるライセンスの音を使う（ユーザー指定）。

- 使ってよいライセンス：CC0（表示不要）、CC BY（作者名・タイトル・ライセンス・元のURLの表示が必要）。
- 使わないライセンス：NC（非営利のみ）、ND（改変禁止。短く切る・音量をそろえるのも改変になる）、SA（配布物全体に同じライセンスが及ぶ）。
- 公式（SEGA・ボーダーブレイク）の音や、それを録音・抜き出した音は使わない。

## 置き方

1. 音を `sounds/src/<名前>.<拡張子>` に置く（名前は下の表。wav・mp3・ogg・flac など）。
2. `python3 tools/build_sounds.py` を実行すると `prototype/sounds.js` ができる（ffmpeg が必要）。
3. 下の表に出典を書く。

## 一覧

[Openverse](https://openverse.org/) で探した Freesound の音（プレビューのmp3）。すべて CC0 1.0（表示義務なし・商用可・改変可）。2026-10-17 に Freesound の各ページでライセンスを確認済み。表示の義務はないが、作者への感謝として載せている。

| 名前 | 使う場面 | タイトル | 作者 | ライセンス | 元のURL |
|---|---|---|---|---|---|
| ar | アサルトライフル・ガトリングの発射 | FX - SHOT - Machine Gun | [bolkmar](https://freesound.org/people/bolkmar) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/bolkmar/sounds/445345 |
| pistol | 二丁拳銃の発射 | Beretta M9 Shot | [vabadus](https://freesound.org/people/vabadus) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/vabadus/sounds/151065 |
| sniper | 狙撃銃の発射 | Sniper Rifle Shot [FpR3Ni1LSBg].flac | [qubodup](https://freesound.org/people/qubodup) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/qubodup/sounds/182051 |
| shotgun | ショットガンの発射、防衛砲台（低く再生） | Shotgun Shot | [LeMudCrab](https://freesound.org/people/LeMudCrab) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/LeMudCrab/sounds/163455 |
| rocket | ロケットの発射 | Rocket Launch | [Jarusca](https://freesound.org/people/Jarusca) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/Jarusca/sounds/521377 |
| explode | 爆発 | explosion.2.wav | [alienbomb](https://freesound.org/people/alienbomb) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/alienbomb/sounds/39069 |
| swing | ソードを振る音 | Fast Sword Swing Sound | [qubodup](https://freesound.org/people/qubodup) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/qubodup/sounds/60004 |
| slash | ソードが当たった金属音 | Sword Clash | [loudernoises](https://freesound.org/people/loudernoises) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/loudernoises/sounds/334169 |
| hit | 命中・被弾 | Bullet Hit Metal | [coolguy244e](https://freesound.org/people/coolguy244e) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/coolguy244e/sounds/267893 |
| dash | カタパルト・偵察機・榴弾の落下予告 | Boomy Whoosh 1_1 | [Joao_Janz](https://freesound.org/people/Joao_Janz) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/Joao_Janz/sounds/485242 |
| reload | リロード・武器の持ち替え | Reload 1 | [pumodi](https://freesound.org/people/pumodi) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/pumodi/sounds/150220 |
| beep | ロックオン・プラント占拠 | Beep Short | [florianreichelt](https://freesound.org/people/florianreichelt) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/florianreichelt/sounds/459992 |
| heal | リペア | Heal Up | [Rickplayer](https://freesound.org/people/Rickplayer) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://freesound.org/people/Rickplayer/sounds/530488 |

## 移動音への再利用（2026-10-21）

歩行・着地には coolguy244e さんの「Bullet Hit Metal」を短く低くし、フィルターとフェードを加えて使っています。噴射音の初版では Jarusca さんの「Rocket Launch」と Joao_Janz さんの「Boomy Whoosh 1_1」を再利用しました。機体の動きを支える音を公開してくださった皆さま、ありがとうございます。

自機のクイックブースト・ジャンプ・加速装置の開始音と、巡航・滞空の持続音は、2026-10-21の音質調整から本プロジェクトのコードで合成した専用音です。帯域ごとにフィルターを通したノイズで空気圧と乱流を表しており、公式音源や外部録音を使用していません。上のCC0素材は、射撃・カタパルト・着弾予告などで引き続き使わせていただいています。

## 戦闘中BGM（v0.10）

ユーザーが指定した OpenGameArt.org の曲を1つ（2026-10-18 にページでライセンスを確認済み。CC0 なので表示義務はないが、礼儀として操作説明の謝辞に「Author: Centurion_of_war さんの nightmareheavy.ogg を使わせていただいています。ありがとうございます」と載せる。ユーザー指定）、試合中だけ繰り返し流す（メニューのスイッチでオン・オフ）。手を加えずに `sounds/music/bgm.ogg` に置き、`python3 tools/build_sounds.py --music` で `prototype/music.js` にしている。

| 名前 | 使う場面 | タイトル | 作者 | ライセンス | 元のURL |
|---|---|---|---|---|---|
| bgm | 試合中のBGM（19.2秒の繰り返し） | Nightmare(prototype) のうち nightmareheavy.ogg | [Centurion_of_war](https://opengameart.org/users/centurionofwar) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | https://opengameart.org/content/nightmareprototype |
