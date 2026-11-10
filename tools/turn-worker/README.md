# 中継（TURN）

オンライン試作（`prototype/online/`）で、直接つながらない回線の人（スマホのテザリング、回線会社の CGNAT、一部のルーター）を中継でつなぐための物です。

- 中継サーバーは、定額の VPS に自分で立てた coturn（オーナーの指定 2026-11-09：超過の請求が出ない所。Cloudflare の TURN はカードの登録が要るので見送った）。
- 中継の合言葉は Cloudflare の Worker（`worker.mjs`、無料プラン）が、共有の秘密から期限つき（4時間）で作って配る。秘密そのものはページに出さない。
- ゲームは部屋を作るとき・入るときに `POST <Worker>/ice` を呼び、受け取った `iceServers` を WebRTC に渡す。ブラウザは直接の通り道を先に試し、だめなときだけ中継を使う。中継のときは「部屋に接続しました（中継サーバー経由）」と出る。
- Worker が答えないときは、今までどおり STUN だけで続ける（直接つながる相手とは遊べる）。
- 名前や IP は記録しない（coturn の syslog には接続元の IP が残る。VPS の中だけ）。

| ファイル | 中身 |
|---|---|
| `coturn-setup.sh` | VPS（Ubuntu 22.04/24.04）で root で1回実行する。coturn を入れ、設定を書き、ファイアウォールを開け、`TURN_HOST` と `TURN_SECRET` を出す |
| `worker.mjs` | Worker の本体。`TURN_HOST`＋`TURN_SECRET`（coturn）のほか、Metered（`METERED_APP`・`METERED_API_KEY`）、Cloudflare の TURN（`TURN_KEY_ID`・`TURN_KEY_API_TOKEN`）にも設定だけで切り替えられる |
| `wrangler.toml` | `npx wrangler deploy` で置くときの設定と、`ALLOWED_ORIGINS` の既定値 |

## 置き方

1. VPS を借りる（メモリ 512MB〜1GB、Ubuntu 24.04、転送量で追加料金がかからない定額のプラン）。管理画面にファイアウォール（セキュリティグループ）があれば、22（TCP）、3478（UDP と TCP）、49160-49260（UDP）を開ける。
2. VPS に SSH（か管理画面のコンソール）で入り、`coturn-setup.sh` を置いて `sudo sh coturn-setup.sh`。最後に出る `TURN_HOST` と `TURN_SECRET` を控える。
3. Cloudflare（無料プラン）の「Workers & Pages」→「作成」→「Hello World」で Worker を作る（名前は `core-breaker-online`）。「コードを編集」で中身を `worker.mjs` に差し替えてデプロイする。
4. Worker の「設定」→「変数とシークレット」に足す：
   - `TURN_HOST`：VPS の IP（テキスト）
   - `TURN_SECRET`：手順2の秘密（シークレット）
   - `ALLOWED_ORIGINS`：`wrangler.toml` の値（公開サイト、試験サイト、zip を開いたときの `null`）
5. Worker の URL（`https://core-breaker-online.<名前>.workers.dev/ice`）を `prototype/online/transport.js` の `ICE_URL` に入れる。

## 確かめ方

- `node tools/test/online_turn.test.js`：Worker の答え方（許可した出どころだけ、秘密を出さない、HMAC の合言葉、53番ポートを外す）と、ゲーム側の受け取り方（取れないときは STUN だけで続ける、時間切れの理由を上書きしない）。
- `node tools/test/online_turn_relay_check.js dbg`：この PC で本物の coturn を動かし、ホストとゲストを中継だけでつなぐ（`turnserver` が無ければ飛ばす）。
- 置いた後：`curl -X POST -H 'Origin: null' https://<Worker>/ice` で `turn:` の入った `iceServers` が返ること。
