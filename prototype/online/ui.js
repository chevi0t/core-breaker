// #212 の試作専用メニュー。保存済み装備やマップ設定は書き換えない。
(() => {
  const menu = document.getElementById('menuRange');
  const button = document.createElement('button'); button.type = 'button'; button.id = 'menuOnline';
  button.textContent = 'オンライン（試作）'; menu.insertAdjacentElement('afterend', button);
  const panel = document.createElement('section'); panel.id = 'onlinePanel'; panel.hidden = true;
  // スクリプトと同じ場所から読むので、dbg と公開サイトでも同じ見た目になる。
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('ui.css', document.currentScript.src).href; document.head.append(stylesheet);
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'オンライン出撃ロビー');
  panel.innerHTML = `<header class="online-header"><div><p class="online-eyebrow">コアブレイカー / 通信司令室</p><h2>オンライン出撃</h2><p>仲間と集まり、同じ戦場へ。</p></div><span class="online-badge">試作・通信 v9</span></header>
  <div class="online-body"><div class="online-main">
  <section class="online-card"><h3><span>01</span> パイロット登録</h3><div class="online-fields">
    <label for="onlineName">申告名 <small>本人確認なし</small><input id="onlineName" maxlength="24" value="ゲスト" aria-label="オンラインの申告名"></label>
    <label for="onlineClass">兵装<select id="onlineClass"><option value="assault">強襲</option><option value="heavy">重火力</option></select></label>
  </div><p class="online-note">初期装備で出撃します。保存済みの装備は変更しません。</p></section>
  <section class="online-card"><h3><span>02</span> 部屋を作る・参加する</h3>
    <div class="online-entry"><div><p>ホストとして招待する</p><button type="button" id="onlineCreate" class="online-primary">部屋を作る</button></div><div><label for="onlineRoom">受け取った部屋IDで参加</label><div class="online-join"><input id="onlineRoom" maxlength="100" placeholder="部屋IDを入力" aria-label="部屋ID" spellcheck="false" autocomplete="off"><button type="button" id="onlineJoin">部屋に入る</button></div></div></div>
    <div class="online-share"><p class="online-note">作成した部屋IDを友人に共有してください。入室は自動です。</p><button type="button" id="onlineCopy" hidden>部屋IDをコピー</button></div>
  </section>
  <section class="online-card online-squad"><h3><span>03</span> 出撃メンバー</h3><div id="onlineRequests" aria-label="入室承認待ち" hidden></div><div id="onlineRoster" aria-label="参加者"></div><p id="onlineEmpty" class="online-empty">まだ部屋に入っていません。<br><small>人間2〜4人で出撃。空き枠はBotが担当します。</small></p><button type="button" id="onlineShuffle" hidden>チームをシャッフル</button></section>
  </div><aside class="online-side">
  <fieldset id="onlineSettings" class="online-card"><legend>作戦設定</legend><p class="online-note">作成後はホストだけが変更できます。</p><div class="online-fields">
    <label for="onlineCapacity">人間の定員（ホストを含む）<select id="onlineCapacity"></select></label>
    <label for="onlineTeamSize">片軍の人数（人間＋Bot）<select id="onlineTeamSize"></select></label>
    <label for="onlineMap">マップ<select id="onlineMap"></select></label>
    <label for="onlineTeamMode">チーム<select id="onlineTeamMode"><option value="random">ランダム</option><option value="choice">希望するチームを選ぶ</option></select></label>
  </div><p id="onlineResolvedMap" class="online-map"></p><button type="button" id="onlineApplySettings" hidden>部屋の設定を反映</button>
  <details><summary>抽選のタイミング</summary><p>マップは作成時・ランダムへ変えたときに一度だけ抽選。チームはシャッフル時と開始時に抽選します。希望選択では開始時の所属を保ちます。</p></details></fieldset>
  <details class="online-card online-measure"><summary>計測設定</summary><label class="online-diagnostic-toggle"><input type="checkbox" id="onlineDiagnostics">試合中の診断表示（F3）</label><label for="onlineLatency">人工片道遅延<select id="onlineLatency"><option value="0">なし</option><option value="50">50ms</option><option value="100">100ms</option></select></label><p>両端に同じ値を指定してください。送信側に追加する遅延です。通信中は変更できません。</p></details>
  <details class="online-card"><summary>実回線で試す手順</summary><ol class="online-test-steps"><li>PCを2台、別々の回線につなぎます。</li><li>ホストが部屋を作り、IDを共有します。</li><li>もう1台でIDを入力して入室。ホストが試合を始めます。</li><li>ホストのタブを前面にしたまま、両画面の移動・射撃・終了を確認します。</li></ol></details>
  <p class="online-caution">ホストのタブは前面にしてください。ホストの退出で試合終了。STUNのみのため、回線によっては接続できません。大人数・重いマップは負荷が増えます。</p>
  </aside></div>
  <footer class="online-footer"><div class="online-status-wrap"><span class="online-status-dot" aria-hidden="true"></span><div><span id="onlinePhase" class="online-eyebrow">接続待機</span><p id="onlineStatus" role="status" aria-live="polite">部屋を作るか、友人から受け取ったIDで入ってください。</p></div></div><div class="online-actions"><button type="button" id="onlineClose">戻る／退出</button><button type="button" id="onlineStart" class="online-primary" hidden>試合を始める</button></div></footer>`;
  document.body.appendChild(panel);
  const diagnostic=document.createElement('div');diagnostic.id='onlineDiagnostic';diagnostic.hidden=true;diagnostic.setAttribute('aria-label','オンライン試験の診断');document.body.append(diagnostic);
  const number=(v,digits=0)=>Number.isFinite(v)?v.toFixed(digits):'—';
  const diagnosticReasons={distance:'距離',accumulated:'見た目の蓄積',respawn:'再出撃',equipment:'装備',down:'行動不能',transfer:'転送',jumpPad:'ジャンプ台',catapult:'射出台',stun:'よろけ',electric:'電撃',shock:'衝撃',history:'履歴不足',disabled:'予測OFF',melee:'近接',special:'加速・特殊動作',zip:'ジップライン',repair:'修理',launch:'射出',lift:'リフト',planted:'構え',inactive:'行動不能'};
  const diagnosticStats=s=>s?.count?number(s.meanMs,1)+' / '+number(s.p95Ms,1)+' / '+number(s.maxMs,1)+'ms':'標本待ち';
  function refreshDiagnostic(){
    const d=CBOnlineGame.diagnostics(),show=d.phase==='playing'&&document.getElementById('onlineDiagnostics').checked;
    diagnostic.hidden=!show;if(!show)return;
    const rows=[(d.role==='host'?'HOST':'GUEST')+' 診断 / F3で開閉 / 直近2秒（起動直後は得られた標本）',
      '画面更新 '+number(d.fps)+'fps / コマ間隔 平均・p95・最大 '+diagnosticStats(d.frame)];
    if(d.role==='guest'){
      const c=d.corrections,h=d.host;
      rows.push('先読み停止: '+(diagnosticReasons[d.predictionBlocked]||d.predictionBlocked||'なし')+' / 停止状態の写真での補正 '+(d.blockedCorrections||0)+'回',
        '予測の反復控除（現在） '+(d.repeatDebt||0)+'コマ / 防いだ視点上書き '+(d.preventedLook?.count||0)+'回 / 最大 '+number(d.preventedLook?.maxDeg||0,3)+'°（横・縦の大きい方）',
        '自機補正（1mm超） '+c.count+'回 / 平均 '+number(c.meanM,3)+'m / 最大 '+number(c.maxM,3)+'m / 照合 '+c.samples+'回',
        '瞬間合わせ（hardSnap） '+c.hardSnaps+'回 / '+(Object.entries(c.reasons).map(([key,n])=>(diagnosticReasons[key]||key)+':'+n).join('、')||'なし'),
        '新しい写真の到着 平均・p95・最大 '+diagnosticStats(d.arrivals)+' / 最終到着 '+number(d.snapshotAgeMs)+'ms前 / RTT '+number(d.rttMs)+'ms',
        'ホスト実測コマ間隔（最後の受信値） 平均・p95・最大 '+diagnosticStats(h?.frame),
        'ホストJS処理 平均・p95・最大 '+diagnosticStats(h?.cpu)+'（GPU完了待ちは含まない）');
    }
    diagnostic.textContent=rows.join('\n');
  }
  setInterval(refreshDiagnostic,500);

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
    for(const id of ['onlineCreate','onlineJoin','onlineClass','onlineLatency','onlineName'])el(id).disabled=busy||active;
    el('onlineRoom').readOnly=active;el('onlineRoom').disabled=busy;
    for(const id of ['onlineCapacity','onlineTeamSize','onlineMap','onlineTeamMode','onlineApplySettings'])el(id).disabled=!editable;
    panel.dataset.phase=s.phase;panel.setAttribute('aria-busy',String(busy));
    el('onlinePhase').textContent=busy?'通信中':s.phase==='lobby'?(s.role==='host'?'ホスト / 入室待機':'ゲスト / 開始待機'):s.phase==='playing'?'作戦進行中':'接続待機';
    el('onlineCopy').hidden=!s.roomId;el('onlineCopy').disabled=busy;
    el('onlineEmpty').hidden=s.roster.length>0;
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
  // 試合後も部屋に残る。結果画面のボタンはロビーを開くだけで、退出はロビーの「退出」から。
  const lobbyReturned = () => { panel.hidden = true; returnButton.hidden = false; returnButton.textContent = 'ロビーへ戻る'; document.getElementById('start').textContent='ロビーへ戻る（同じメンバー）';controls(); };
  const peerLabel = entry => (entry.name || 'ゲスト') + '（未認証・' + entry.id.slice(0, 8) + '）';
  const peerAction = (label,id,action) => {
    const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.peerId=id;b.dataset.action=action;
    b.onclick=e=>{e.stopPropagation();try{CBOnlineGame[action](id);}catch(error){status(error.message);}};return b;
  };
  const requestsChanged = entries => {
    const list=el('onlineRequests');list.replaceChildren();list.hidden=!entries.length;if(!entries.length)return;
    const caption=document.createElement('p');caption.textContent='入室承認待ち。名前は本人確認されていません。';list.append(caption);
    for(const entry of entries){const row=document.createElement('p'),name=document.createElement('span');name.textContent=peerLabel(entry);row.append(name,peerAction('許可',entry.id,'approveGuest'),peerAction('拒否',entry.id,'rejectGuest'));list.append(row);}
  };
  function rosterChanged(entries) {
    const list=el('onlineRoster'),s=CBOnlineGame.state;list.replaceChildren();if(!entries.length){controls();return;}
    const caption=document.createElement('p');caption.textContent='参加者: '+entries.length+' / '+s.settings.capacity+'人（ホストを含む）';list.append(caption);
    const localId=s.transport?.peer?.id,choice=s.settings.teamMode==='choice',editable=s.phase==='lobby';
    const participant = entry => {
      const member=document.createElement('span');member.className='online-member';
      const name=document.createElement('span');name.textContent=peerLabel(entry)+(entry.host?'・ホスト':'')+(entry.id===localId?'・あなた':'')+(!choice?'・グループ'+(entry.team==='B'?'A':'B'):'');member.append(name);
      if(s.role==='host'&&!entry.host&&editable)member.append(peerAction('退出させる',entry.id,'kickGuest'));
      return member;
    };
    for(const team of choice?['B','R']:[null]){
      const row=document.createElement('div'),members=team?entries.filter(p=>p.team===team):entries;
      row.className='online-team';
      if(team){
        row.dataset.team=team;row.setAttribute('role','button');row.tabIndex=editable?0:-1;
        const own=entries.find(p=>p.id===localId)?.team===team,full=members.length>=s.settings.teamSize&&!own;
        row.setAttribute('aria-pressed',String(own));row.setAttribute('aria-disabled',String(!editable||full));
        const label=document.createElement('strong');label.textContent='グループ'+(team==='B'?'A':'B')+'（人間'+members.length+'＋Bot'+(s.settings.teamSize-members.length)+'）';row.append(label);
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
  const options = () => ({displayName:el('onlineName').value.trim()||'ゲスト',cls:el('onlineClass').value,latencyMs:Number(el('onlineLatency').value),settings:roomSettings(),onStatus:status,onCountdown:hideDuringPlay,onStarted:hideDuringPlay,onRequests:requestsChanged,onRoster:rosterChanged,onSettings:settingsChanged,onEnded:showResult,onLobbyReturn:lobbyReturned});
  const act = async fn => {if(busy)return;busy=true;controls();const mine=++generation;try{await fn(mine);}catch(e){if(mine===generation)status(e.message);}finally{if(mine===generation){busy=false;controls();}}};
  const resetRoomControls = () => {returnButton.textContent='オンラインへ戻る';if(document.getElementById('start').textContent.startsWith('ロビーへ戻る'))document.getElementById('start').textContent='もう一度出撃する';generation++;busy=false;el('onlineRoom').value='';el('onlineRoom').readOnly=false;el('onlineRequests').hidden=true;el('onlineRoster').replaceChildren();el('onlineRequests').replaceChildren();returnButton.hidden=true;controls();};
  const startLabel = () => document.getElementById('start');
  const leaveResult = (openPanel=true) => {CBOnlineGame.leave('試合結果から退出');resetRoomControls();startLabel().textContent='もう一度出撃する';panel.hidden=!openPanel;status('前の部屋を終了しました。新しく部屋を作るか、部屋IDを入力してください。');};
  returnButton.onclick = () => { if (CBOnlineGame.state.phase === 'lobby') { panel.hidden = false; returnButton.hidden = true; controls(); } else leaveResult(true); };
  button.onclick = () => {panel.hidden=false;controls();document.exitPointerLock?.();el('onlineName').focus();};
  el('onlineCopy').onclick=async()=>{const id=CBOnlineGame.state.roomId;if(!id)return;try{await navigator.clipboard.writeText(id);status('部屋IDをコピーしました。友人に共有してください。');}catch{status('コピーできませんでした。部屋ID欄を選択してコピーしてください。');el('onlineRoom').focus();el('onlineRoom').select();}};
  el('onlineCreate').onclick=()=>act(async mine=>{let room;try{room=await CBOnlineGame.create(options());}catch(e){if(mine===generation)CBOnlineGame.leave('部屋を作成できませんでした');throw e;}if(mine!==generation)return;el('onlineRoom').value=room;status('部屋ID: '+room+'　ゲストの入室を待っています。');});
  el('onlineJoin').onclick=()=>act(async mine=>{const id=el('onlineRoom').value.trim();if(!id)throw Error('部屋IDを入力してください');try{await CBOnlineGame.join(id,options());}catch(e){if(mine===generation)CBOnlineGame.leave('接続できませんでした');throw e;}if(mine===generation)status('接続しました。ホストの開始を待っています。');});
  el('onlineApplySettings').onclick=()=>{try{CBOnlineGame.updateSettings(roomSettings());}catch(e){settingsChanged(CBOnlineGame.state.settings,CBOnlineGame.state.resolvedMapId);status(e.message);}};
  el('onlineShuffle').onclick=()=>{try{CBOnlineGame.shuffleTeams();}catch(e){status(e.message);}};
  el('onlineStart').onclick=()=>act(async()=>{CBOnlineGame.updateSettings(roomSettings());await CBOnlineGame.start();status('ゲストの準備完了を待っています');});
  el('onlineClose').onclick=()=>{CBOnlineGame.leave();resetRoomControls();panel.hidden=true;button.focus();};
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
    panel.hidden = false;
    if (CBOnlineGame.state.phase === 'lobby' && e.target.closest('#start')) { returnButton.hidden = true; controls(); return; }
    status('オンラインを退出してから通常メニューを使ってください。');
  } }, true);
  el('onlineDiagnostics').addEventListener('change',refreshDiagnostic);
  addEventListener('keydown', e => {
    if(!CBOnlineGame.active()||!['F3','Escape'].includes(e.code))return;
    // F3のブラウザ検索・長押し反復を抑え、診断の開閉ではpointer lockを解除しない。
    e.stopImmediatePropagation();e.preventDefault();if(e.repeat)return;
    if(e.code==='F3'){if(CBOnlineGame.state.phase==='playing'){el('onlineDiagnostics').checked=!el('onlineDiagnostics').checked;refreshDiagnostic();}return;}
    // 結果画面の間（試合後にロビーへ戻っていても、戻るボタンを押すまで）はEscapeでパネルを開かない。
    panel.hidden=CBOnlineGame.state.phase==='ended'||CBOnlineGame.state.phase==='lobby'&&!returnButton.hidden?true:!panel.hidden;document.exitPointerLock?.();
  }, true);
  // 試作中の通常再出撃ボタンから、独立したオフライン戦を重ねて開始させない。
  document.getElementById('start').addEventListener('click', e => { if (CBOnlineGame.active?.()) { e.stopImmediatePropagation(); e.preventDefault(); panel.hidden = false; status('オンラインの試合中です。終了してから通常出撃してください。'); } }, true);
})();
