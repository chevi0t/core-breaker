// #212 の試作専用メニュー。保存済み装備やマップ設定は書き換えない。
(() => {
  const menu = document.getElementById('menuRange');
  const button = document.createElement('button'); button.type = 'button'; button.id = 'menuOnline';
  button.textContent = 'オンライン（試作）'; menu.insertAdjacentElement('afterend', button);
  const panel = document.createElement('section'); panel.id = 'onlinePanel'; panel.hidden = true;
  panel.style.cssText = 'position:fixed;z-index:10000;inset:4vh 5vw;overflow:auto;padding:20px;background:#10212ff5;color:#eef;border:1px solid #79b6ce;border-radius:12px;pointer-events:auto';
  panel.innerHTML = `<h2>オンライン（試作）</h2><p>人間はホストを含め2〜4人。片軍2〜10機で、空き枠はBotが担当します。強襲・重火力の初期装備。ホストのタブは前面にしてください。</p>
  <p>STUNのみ。回線によっては接続できません。ホストが退出すると試合は終了します。大人数・重いマップは処理負荷が増えます。</p>
  <label>申告名（未認証） <input id="onlineName" maxlength="24" value="ゲスト" aria-label="オンラインの申告名"></label>
  <label>兵装 <select id="onlineClass"><option value="assault">強襲</option><option value="heavy">重火力</option></select></label>
  <fieldset id="onlineSettings"><legend>部屋の設定（作成後はホストだけが変更できます）</legend>
    <label>人間の定員（ホストを含む） <select id="onlineCapacity"></select></label>
    <label>片軍の人数（人間＋Bot） <select id="onlineTeamSize"></select></label>
    <label>マップ <select id="onlineMap"></select></label>
    <label>チーム <select id="onlineTeamMode"><option value="random">ランダム</option><option value="choice">希望するチームを選ぶ</option></select></label>
    <button type="button" id="onlineApplySettings" hidden>部屋の設定を反映</button>
    <p id="onlineResolvedMap"></p><p>ランダムのマップは作成時・設定をランダムへ変えたときに一度だけ抽選します。チームのランダム分けはシャッフル時と試合開始時に行います。希望選択では開始時の所属を保ちます。</p>
  </fieldset>
  <p><button id="onlineCreate">部屋を作る</button> <input id="onlineRoom" maxlength="100" placeholder="部屋ID" aria-label="部屋ID"> <button id="onlineJoin">部屋に入る</button></p>
  <p id="onlineStatus" role="status">部屋を作るか、友人から受け取ったIDで入ってください。</p>
  <div id="onlineRequests" aria-label="入室承認待ち"></div><div id="onlineRoster" aria-label="許可済み参加者"></div>
  <button type="button" id="onlineShuffle" hidden>チームをシャッフル</button> <button id="onlineStart" hidden>試合を始める</button> <button id="onlineClose">戻る／退出</button>
  <details><summary>計測設定（両端に同じ値を指定）</summary><label>人工片道遅延 <select id="onlineLatency"><option value="0">なし</option><option value="50">50ms</option><option value="100">100ms</option></select></label><p>通信の送信側に追加する遅延です。通信中の変更はできません。</p></details>`;
  document.body.appendChild(panel);
  const el = id => document.getElementById(id);
  const addOption = (id,value,label) => { const option=document.createElement('option');option.value=value;option.textContent=label;el(id).append(option); };
  const supported=CBOnlineGame.roomOptions;
  supported.capacities.forEach(n=>addOption('onlineCapacity',n,n+'人'));
  supported.teamSizes.forEach(n=>addOption('onlineTeamSize',n,n+'対'+n+'（合計'+n*2+'機）'));
  addOption('onlineMap','random','ランダム');supported.maps.forEach(m=>addOption('onlineMap',m.id,m.name));
  el('onlineCapacity').value='4';el('onlineTeamSize').value='5';el('onlineMap').value='mesa';
  const returnButton = document.createElement('button'); returnButton.type = 'button'; returnButton.id = 'onlineReturn';
  returnButton.textContent = 'オンラインへ戻る'; returnButton.hidden = true;
  el('ovBoard').insertAdjacentElement('afterend', returnButton);
  let busy = false, generation = 0;
  const roomSettings = () => ({capacity:Number(el('onlineCapacity').value),teamSize:Number(el('onlineTeamSize').value),mapId:el('onlineMap').value,teamMode:el('onlineTeamMode').value});
  function controls() {
    const s=CBOnlineGame.state,active=CBOnlineGame.active(),host=s.role==='host'&&s.phase==='lobby',editable=!busy&&(!active||host);
    for(const id of ['onlineCreate','onlineJoin','onlineClass','onlineLatency','onlineName','onlineRoom'])el(id).disabled=busy||active;
    for(const id of ['onlineCapacity','onlineTeamSize','onlineMap','onlineTeamMode','onlineApplySettings'])el(id).disabled=!editable;
    el('onlineSettings').hidden=s.role==='guest'&&!s.settings;
    el('onlineApplySettings').hidden=!host;el('onlineShuffle').hidden=!host;el('onlineShuffle').disabled=busy||!host;
    el('onlineStart').hidden=!host;el('onlineStart').disabled=busy||!host||s.peers.size<1||![...s.peers.values()].every(p=>p.preferred);
    for(const b of panel.querySelectorAll('[data-action]'))b.disabled=!host;
    for(const row of panel.querySelectorAll('#onlineRoster [data-team]')){
      const full=s.roster.filter(p=>p.team===row.dataset.team).length>=s.settings?.teamSize&&row.getAttribute('aria-pressed')!=='true';
      row.tabIndex=s.phase==='lobby'?0:-1;row.setAttribute('aria-disabled',String(s.phase!=='lobby'||full));
    }
  }
  const status = t => { el('onlineStatus').textContent = typeof t === 'string' ? t : t?.message || t?.reason || t?.status || JSON.stringify(t);controls(); };
  const hideDuringPlay = () => { panel.hidden = true; returnButton.hidden = true;controls(); };
  const showResult = () => { panel.hidden = true; returnButton.hidden = false;document.getElementById('start').textContent='オンラインのメニューへ戻る';controls(); };
  const peerLabel = entry => (entry.name || 'ゲスト') + '（未認証・' + entry.id.slice(0, 8) + '）';
  const peerAction = (label,id,action) => {
    const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.peerId=id;b.dataset.action=action;
    b.onclick=e=>{e.stopPropagation();try{CBOnlineGame[action](id);}catch(error){status(error.message);}};return b;
  };
  const requestsChanged = entries => {
    const list=el('onlineRequests');list.replaceChildren();if(!entries.length)return;
    const caption=document.createElement('p');caption.textContent='入室承認待ち。名前は本人確認されていません。';list.append(caption);
    for(const entry of entries){const row=document.createElement('p'),name=document.createElement('span');name.textContent=peerLabel(entry);row.append(name,peerAction('許可',entry.id,'approveGuest'),peerAction('拒否',entry.id,'rejectGuest'));list.append(row);}
  };
  function rosterChanged(entries) {
    const list=el('onlineRoster'),s=CBOnlineGame.state;list.replaceChildren();if(!entries.length){controls();return;}
    const caption=document.createElement('p');caption.textContent='許可済み参加者: '+entries.length+' / '+s.settings.capacity+'人（ホストを含む）';list.append(caption);
    const localId=s.transport?.peer?.id,choice=s.settings.teamMode==='choice',editable=s.phase==='lobby';
    const participant = entry => {
      const member=document.createElement('span');member.style.cssText='display:inline-flex;align-items:center;gap:4px;flex:none';
      const name=document.createElement('span');name.textContent=peerLabel(entry)+(entry.host?'・ホスト':'')+(entry.id===localId?'・あなた':'')+(!choice?'・グループ'+(entry.team==='B'?'A':'B'):'');member.append(name);
      if(s.role==='host'&&!entry.host&&editable)member.append(peerAction('退出させる',entry.id,'kickGuest'));
      return member;
    };
    for(const team of choice?['B','R']:[null]){
      const row=document.createElement('div'),members=team?entries.filter(p=>p.team===team):entries;
      row.style.cssText='display:flex;align-items:center;gap:14px;flex-wrap:nowrap;overflow-x:auto;padding:14px 8px;margin:8px 0;border:1px solid #79b6ce;border-radius:6px';
      if(team){
        row.dataset.team=team;row.setAttribute('role','button');row.tabIndex=editable?0:-1;
        const own=entries.find(p=>p.id===localId)?.team===team,full=members.length>=s.settings.teamSize&&!own;
        row.setAttribute('aria-pressed',String(own));row.setAttribute('aria-disabled',String(!editable||full));
        if(own)row.style.background='#284b60';
        const label=document.createElement('strong');label.style.flex='none';label.textContent='グループ'+(team==='B'?'A':'B')+'（人間'+members.length+'＋Bot'+(s.settings.teamSize-members.length)+'）';row.append(label);
        const select=()=>{if(!editable)return;try{CBOnlineGame.chooseTeam(team);}catch(error){status(error.message);}};
        row.onclick=select;row.onkeydown=e=>{if(e.target===row&&['Enter',' '].includes(e.key)){e.preventDefault();select();}};
      }else row.dataset.randomRoster='';
      for(const entry of members)row.append(participant(entry));list.append(row);
    }
    const note=document.createElement('p');note.textContent=choice?'希望する行をクリックして所属を選べます。空き枠はBotになります。出撃後はどちらの所属でも自軍が青、敵軍が橙です。':'開始時にチームを再抽選します。今の所属は名前の横に表示しています。空き枠はBotになります。';list.append(note);controls();
  }
  function settingsChanged(settings,resolvedMapId) {
    if(settings){el('onlineCapacity').value=String(settings.capacity);el('onlineTeamSize').value=String(settings.teamSize);el('onlineMap').value=settings.mapId;el('onlineTeamMode').value=settings.teamMode;}
    el('onlineResolvedMap').textContent=settings?'出撃マップ: '+(supported.maps.find(m=>m.id===resolvedMapId)?.name||resolvedMapId)+(settings.mapId==='random'?'（抽選済み）':''):'';controls();
  }
  const options = () => ({displayName:el('onlineName').value.trim()||'ゲスト',cls:el('onlineClass').value,latencyMs:Number(el('onlineLatency').value),settings:roomSettings(),onStatus:status,onCountdown:hideDuringPlay,onStarted:hideDuringPlay,onRequests:requestsChanged,onRoster:rosterChanged,onSettings:settingsChanged,onEnded:showResult});
  const act = async fn => {if(busy)return;busy=true;controls();const mine=++generation;try{await fn(mine);}catch(e){if(mine===generation)status(e.message);}finally{if(mine===generation){busy=false;controls();}}};
  const resetRoomControls = () => {generation++;busy=false;el('onlineRoom').value='';el('onlineRoster').replaceChildren();el('onlineRequests').replaceChildren();returnButton.hidden=true;controls();};
  const startLabel = () => document.getElementById('start');
  const leaveResult = (openPanel=true) => {CBOnlineGame.leave('試合結果から退出');resetRoomControls();startLabel().textContent='もう一度出撃する';panel.hidden=!openPanel;status('前の部屋を終了しました。新しく部屋を作るか、部屋IDを入力してください。');};
  returnButton.onclick = () => leaveResult(true);
  button.onclick = () => {panel.hidden=false;controls();document.exitPointerLock?.();};
  el('onlineCreate').onclick=()=>act(async mine=>{let room;try{room=await CBOnlineGame.create(options());}catch(e){if(mine===generation)CBOnlineGame.leave('部屋を作成できませんでした');throw e;}if(mine!==generation)return;el('onlineRoom').value=room;status('部屋ID: '+room+'　ゲストの入室を待っています。');});
  el('onlineJoin').onclick=()=>act(async mine=>{const id=el('onlineRoom').value.trim();if(!id)throw Error('部屋IDを入力してください');try{await CBOnlineGame.join(id,options());}catch(e){if(mine===generation)CBOnlineGame.leave('接続できませんでした');throw e;}if(mine===generation)status('接続しました。ホストの開始を待っています。');});
  el('onlineApplySettings').onclick=()=>{try{CBOnlineGame.updateSettings(roomSettings());}catch(e){settingsChanged(CBOnlineGame.state.settings,CBOnlineGame.state.resolvedMapId);status(e.message);}};
  el('onlineShuffle').onclick=()=>{try{CBOnlineGame.shuffleTeams();}catch(e){status(e.message);}};
  el('onlineStart').onclick=()=>act(async()=>{CBOnlineGame.updateSettings(roomSettings());await CBOnlineGame.start();status('ゲストの準備完了を待っています');});
  el('onlineClose').onclick=()=>{CBOnlineGame.leave();resetRoomControls();panel.hidden=true;};
  // 通常のマップ変更・射撃場・チュートリアルへ対戦中のまま入らない。
  document.addEventListener('click', e => { if (CBOnlineGame.active() && e.target.closest?.('#overlay') && !e.target.closest?.('#onlineReturn')) {
    // 表彰/スコアを触っただけで窓を開かない。結果から戻る操作は専用ボタンだけ。
    if (!e.target.closest?.('button,a,input,select')) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (CBOnlineGame.state.phase === 'ended') {
      // 試合結果のボタンは部屋を出てから働かせる（前は「もう一度出撃する」などが何も起きず、固まって見えた）。
      // 出撃ボタンはオンラインのメニューへ戻し、それ以外のボタンは退出した後でふつうに働かせる。
      const toOnline = !!e.target.closest('#start');
      leaveResult(toOnline);
      if (!toOnline) e.target.closest('button,a,input,select').click();
      return;
    }
    panel.hidden = false; status('オンラインを退出してから通常メニューを使ってください。');
  } }, true);
  addEventListener('keydown', e => { if (CBOnlineGame.active() && ['F3','Escape'].includes(e.code)) { e.stopImmediatePropagation(); e.preventDefault(); panel.hidden = CBOnlineGame.state.phase === 'ended' ? true : !panel.hidden; document.exitPointerLock?.(); } }, true);
  // 試作中の通常再出撃ボタンから、独立したオフライン戦を重ねて開始させない。
  document.getElementById('start').addEventListener('click', e => { if (CBOnlineGame.active?.()) { e.stopImmediatePropagation(); e.preventDefault(); panel.hidden = false; status('オンラインの試合中です。終了してから通常出撃してください。'); } }, true);
})();
