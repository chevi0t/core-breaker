// #212 の試作専用メニュー。保存済み装備やマップ設定は書き換えない。
(() => {
  const menu = document.getElementById('menuRange');
  const button = document.createElement('button'); button.type = 'button'; button.id = 'menuOnline';
  button.textContent = 'オンライン（試作）'; menu.insertAdjacentElement('afterend', button);
  const panel = document.createElement('section'); panel.id = 'onlinePanel'; panel.hidden = true;
  panel.style.cssText = 'position:fixed;z-index:10000;inset:6vh 10vw;overflow:auto;padding:24px;background:#10212ff5;color:#eef;border:1px solid #79b6ce;border-radius:12px;pointer-events:auto';
  panel.innerHTML = `<h2>オンライン（試作）</h2><p>ホストを含め2〜4人＋Botで10機。mesa／強襲・重火力の初期装備。ホストのタブは前面にしてください。</p>
  <p>STUNのみ。回線によっては接続できません。ホストが退出すると試合は終了します。</p>
  <label>申告名（未認証） <input id="onlineName" maxlength="24" value="ゲスト" aria-label="オンラインの申告名"></label>
  <label>兵装 <select id="onlineClass"><option value="assault">強襲</option><option value="heavy">重火力</option></select></label>
  <p><button id="onlineCreate">部屋を作る</button> <input id="onlineRoom" maxlength="100" placeholder="部屋ID" aria-label="部屋ID"> <button id="onlineJoin">部屋に入る</button></p>
  <p id="onlineStatus" role="status">部屋を作るか、友人から受け取ったIDで入ってください。</p>
  <div id="onlineRequests" aria-label="入室承認待ち"></div><div id="onlineRoster" aria-label="許可済み参加者"></div><button id="onlineStart" hidden>試合を始める</button> <button id="onlineClose">戻る／退出</button>
  <details><summary>計測設定（両端に同じ値を指定）</summary><label>人工片道遅延 <select id="onlineLatency"><option value="0">なし</option><option value="50">50ms</option><option value="100">100ms</option></select></label><p>通信の送信側に追加する遅延です。通信中の変更はできません。</p></details>`;
  document.body.appendChild(panel);
  const returnButton = document.createElement('button'); returnButton.type = 'button'; returnButton.id = 'onlineReturn';
  returnButton.textContent = 'オンラインへ戻る'; returnButton.hidden = true;
  document.getElementById('ovBoard').insertAdjacentElement('afterend', returnButton);
  const hideDuringPlay = () => { panel.hidden = true; returnButton.hidden = true; };
  const showResult = () => { panel.hidden = true; returnButton.hidden = false; document.getElementById('onlineStart').hidden = true; };
  const status = t => { document.getElementById('onlineStatus').textContent = typeof t === 'string' ? t : t?.message || t?.reason || t?.status || JSON.stringify(t); };
  let busy = false;
  const controls = value => { for (const id of ['onlineCreate','onlineJoin','onlineClass','onlineLatency','onlineName']) document.getElementById(id).disabled = value; };
  const peerLabel = entry => (entry.name || 'ゲスト') + '（未認証・' + entry.id.slice(0, 8) + '）';
  const peerAction = (label, id, action) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.peerId = id; b.dataset.action = action;
    b.onclick = () => { try { CBOnlineGame[action](id); } catch (e) { status(e.message); } }; return b;
  };
  const requestsChanged = entries => {
    const list = document.getElementById('onlineRequests'); list.replaceChildren();
    if (!entries.length) return;
    const caption = document.createElement('p'); caption.textContent = '入室承認待ち。名前は本人確認されていません。'; list.append(caption);
    for (const entry of entries) { const row = document.createElement('p'), name = document.createElement('span'); name.textContent = peerLabel(entry); row.append(name, peerAction('許可', entry.id, 'approveGuest'), peerAction('拒否', entry.id, 'rejectGuest')); list.append(row); }
  };
  const rosterChanged = entries => {
    const list = document.getElementById('onlineRoster'); list.replaceChildren();
    const caption = document.createElement('p'); caption.textContent = '許可済み参加者: ' + (entries.length + 1) + '人（ホストを含む）'; list.append(caption);
    for (const entry of entries) { const row = document.createElement('p'); row.textContent = peerLabel(entry); if (CBOnlineGame.state.role === 'host' && CBOnlineGame.state.phase === 'lobby') row.append(peerAction('退出させる', entry.id, 'kickGuest')); list.append(row); }
  };
  const options = () => ({ displayName: document.getElementById('onlineName').value.trim() || 'ゲスト', cls: document.getElementById('onlineClass').value, latencyMs: Number(document.getElementById('onlineLatency').value), onStatus: status, onCountdown: hideDuringPlay, onStarted: hideDuringPlay, onRequests: requestsChanged, onRoster: rosterChanged, onEnded: showResult });
  const act = async fn => { if (busy) return; busy = true; controls(true); try { await fn(); } catch (e) { status(e.message); controls(false); } finally { busy = false; } };
  const resetRoomControls = () => { controls(false); document.getElementById('onlineStart').hidden = true; document.getElementById('onlineRoom').value = ''; document.getElementById('onlineRoster').textContent = ''; document.getElementById('onlineRequests').replaceChildren(); returnButton.hidden = true; };
  returnButton.onclick = () => { CBOnlineGame.leave('試合結果から退出'); resetRoomControls(); panel.hidden = false; status('前の部屋を終了しました。新しく部屋を作るか、部屋IDを入力してください。'); };
  button.onclick = () => { panel.hidden = false; document.exitPointerLock?.(); };
  document.getElementById('onlineCreate').onclick = () => act(async () => { const room = await CBOnlineGame.create(options()); document.getElementById('onlineRoom').value = room; document.getElementById('onlineStart').hidden = false; status('部屋ID: ' + room + '　ゲストの入室を待っています。'); });
  document.getElementById('onlineJoin').onclick = () => act(async () => { const id = document.getElementById('onlineRoom').value.trim(); if (!id) throw new Error('部屋IDを入力してください'); await CBOnlineGame.join(id, options()); status('接続しました。ホストの開始を待っています。'); });
  document.getElementById('onlineStart').onclick = () => act(async () => { await CBOnlineGame.start(); status('ゲストの準備完了を待っています'); });
  document.getElementById('onlineClose').onclick = () => { CBOnlineGame.leave(); resetRoomControls(); panel.hidden = true; };
  // 通常のマップ変更・射撃場・チュートリアルへ対戦中のまま入らない。
  document.addEventListener('click', e => { if (CBOnlineGame.active() && e.target.closest?.('#overlay') && !e.target.closest?.('#onlineReturn')) {
    // 表彰/スコアを触っただけで窓を開かない。結果から戻る操作は専用ボタンだけ。
    if (!e.target.closest?.('button,a,input,select')) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (CBOnlineGame.state.phase !== 'ended') { panel.hidden = false; status('オンラインを退出してから通常メニューを使ってください。'); }
  } }, true);
  addEventListener('keydown', e => { if (CBOnlineGame.active() && ['F3','Escape'].includes(e.code)) { e.stopImmediatePropagation(); e.preventDefault(); panel.hidden = CBOnlineGame.state.phase === 'ended' ? true : !panel.hidden; document.exitPointerLock?.(); } }, true);
  // 試作中の通常再出撃ボタンから、独立したオフライン戦を重ねて開始させない。
  document.getElementById('start').addEventListener('click', e => { if (CBOnlineGame.active?.()) { e.stopImmediatePropagation(); e.preventDefault(); panel.hidden = false; status('オンラインの試合中です。終了してから通常出撃してください。'); } }, true);
})();
