// #212 の試作メニュー。装備はオフラインの3構成と共用、マップ設定は部屋専用。
(() => {
  const menu = document.getElementById('menuRange');
  const button = document.createElement('button'); button.type = 'button'; button.id = 'menuOnline';
  button.textContent = 'オンライン（試作）'; menu.insertAdjacentElement('afterend', button);
  // スマホ・タブレット（指が主な操作）ではオンラインを出さない（オーナーの指定 2026-11-10）。本体の TOUCH と同じ判定。
  const PHONE = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (PHONE) button.style.display = 'none';
  const panel = document.createElement('section'); panel.id = 'onlinePanel'; panel.hidden = true;
  // スクリプトと同じ場所から読むので、dbg と公開サイトでも同じ見た目になる。
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('ui.css', document.currentScript.src).href; document.head.append(stylesheet);
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'オンライン出撃ロビー');
  panel.innerHTML = `<header class="online-header"><div><p class="online-eyebrow">コアブレイカー / 通信司令室</p><h2>オンライン出撃</h2><p id="onlineLocation" aria-live="polite">部屋を作る・参加する</p></div><span class="online-badge">試作・通信 v9</span></header>
  <div class="online-body"><div class="online-main">
  <section class="online-card"><h3><span>01</span> パイロット登録</h3><div class="online-fields">
    <label for="onlineName">パイロット名 <small>本人確認なし</small><input id="onlineName" maxlength="24" aria-label="オンラインのパイロット名"></label>
    <label for="onlineClass">兵装<select id="onlineClass"></select></label><label for="onlineBuild">共通の構成<select id="onlineBuild"></select></label>
  </div><p class="online-note">パイロット画面の名前と、オフラインで保存した3構成を使います。装備は入室後も変更できます。同じブラウザ・同じサイトの保存を共用します。別サイト・端末の装備は、通常のカスタマイズ画面で設定ファイルを読み込んで移せます。</p><p id="onlineBuildStatus" class="online-note" role="status"></p></section>
  <section class="online-card"><h3><span>02</span> 部屋を作る・参加する</h3>
    <div class="online-entry"><div><p>ホストとして招待する</p><button type="button" id="onlineCreate" class="online-primary">部屋を作る</button></div><div><label for="onlineRoom">受け取った部屋IDで参加</label><div class="online-join"><input id="onlineRoom" maxlength="100" placeholder="部屋IDを入力" aria-label="部屋ID" spellcheck="false" autocomplete="off"><button type="button" id="onlineJoin">部屋に入る</button></div></div></div>
    <div class="online-share"><p class="online-note">作成した部屋IDを友人に共有してください。入室は自動です。</p><button type="button" id="onlineCopy" hidden>部屋IDをコピー</button></div>
  </section>
  <section class="online-card online-squad"><h3><span>03</span> 出撃メンバー</h3><div id="onlineRequests" aria-label="入室承認待ち" hidden></div><div id="onlineRoster" aria-label="参加者"></div><p id="onlineEmpty" class="online-empty">まだ部屋に入っていません。<br><small>人間2〜4人で出撃。空き枠はBotが担当します。</small></p><button type="button" id="onlineShuffle" hidden>チームをシャッフル</button><p id="onlineReadySummary" class="online-note"></p><button type="button" id="onlineEquipment" hidden>装備を変更</button>
    <section id="onlineEquipmentEditor" hidden aria-label="共通の保存構成"><h4>オフラインと共通の3構成</h4><p class="online-note">部屋には参加したまま編集します。下の「保存して部屋に戻る」で、編集した構成の全兵装・パーツ・塗装をオフラインと共通の保存へ反映します。構成を切り替えても下書きは残ります。「下書きを破棄して部屋に戻る」は未保存の下書きだけを破棄し、保存済みの構成は残します。編集後はもう一度Readyを押してください。</p><div class="online-fields"><label>共通の構成<select id="onlineEquipmentBuild"></select></label><label>兵装<select id="onlineEquipmentClass"></select></label></div><div id="onlineEquipmentFields" class="online-fields"></div><p id="onlineEquipmentWeight" class="online-note"></p><p id="onlineReadyNudge" role="status" aria-live="polite" hidden></p></section></section>
  </div><aside class="online-side">
  <fieldset id="onlineSettings" class="online-card"><legend>作戦設定</legend><p class="online-note">作成後はホストだけが変更できます。</p><div class="online-fields">
    <label for="onlineCapacity">人間の定員（ホストを含む）<select id="onlineCapacity"></select></label>
    <label for="onlineTeamSize">片軍の人数（人間＋Bot）<select id="onlineTeamSize"></select></label>
    <label for="onlineMap">マップ<select id="onlineMap"></select></label>
    <label for="onlineTeamMode">チーム<select id="onlineTeamMode"><option value="random">ランダム</option><option value="choice">希望するチームを選ぶ</option></select></label>
  </div><p id="onlineResolvedMap" class="online-map"></p><button type="button" id="onlineApplySettings" hidden>部屋の設定を反映</button>
  <details><summary>抽選のタイミング</summary><p>マップは作成時・ランダムへ変えたときに一度だけ抽選。チームはシャッフル時と開始時に抽選します。希望選択では開始時の所属を保ちます。</p></details></fieldset>
  <details class="online-card online-measure"><summary>計測設定</summary><label class="online-diagnostic-toggle"><input type="checkbox" id="onlineDiagnostics">試合中の診断表示（F3）</label><label for="onlineLatency">人工片道遅延<select id="onlineLatency"><option value="0">なし</option><option value="50">50ms</option><option value="100">100ms</option></select></label><p>両端に同じ値を指定してください。送信側に追加する遅延です。通信中は変更できません。</p></details>
  <details class="online-card"><summary>実回線で試す手順</summary><ol class="online-test-steps"><li>PCを2台、別々の回線につなぎます。</li><li>ホストが部屋を作り、IDを共有します。</li><li>もう1台でIDを入力して入室。全員がReadyを押したら、ホストが試合を始めます。</li><li>ホストのタブを前面にしたまま、両画面の移動・射撃・終了を確認します。</li></ol></details>
  <p class="online-caution">ホストのタブは前面にしてください。ホストの退出で試合終了。${window.CBOnlineTransport?.ICE_URL?'直接つながらない回線では中継サーバーを通します（少し遅れます）。':'STUNのみのため、回線によっては接続できません。'}大人数・重いマップは負荷が増えます。</p>
  </aside></div>
  <footer class="online-footer"><div class="online-status-wrap"><span class="online-status-dot" aria-hidden="true"></span><div><span id="onlinePhase" class="online-eyebrow">接続待機</span><p id="onlineStatus" role="status" aria-live="polite" tabindex="-1">部屋を作るか、友人から受け取ったIDで入ってください。</p></div></div><div class="online-actions"><div id="onlineEquipmentActions" class="online-equipment-actions" hidden aria-label="装備編集を終えて部屋に戻る"><button type="button" id="onlineEquipmentSave" class="online-primary">保存して部屋に戻る</button><button type="button" id="onlineEquipmentCancel">下書きを破棄して部屋に戻る</button></div><div id="onlineRoomActions" class="online-room-actions"><button type="button" id="onlineReady" hidden aria-pressed="false">Ready（準備完了）</button><button type="button" id="onlineStart" class="online-primary" hidden>試合を始める</button></div><div class="online-exit-actions"><button type="button" id="onlineClose">最初のメニューへ</button></div></div></footer>`;
  document.body.appendChild(panel);
  const leaveDialog=document.createElement('dialog');leaveDialog.id='onlineLeaveDialog';
  leaveDialog.setAttribute('aria-labelledby','onlineLeaveTitle');leaveDialog.setAttribute('aria-describedby','onlineLeaveDescription');
  leaveDialog.innerHTML='<h2 id="onlineLeaveTitle">部屋を退出しますか？</h2><p id="onlineLeaveDescription"></p><div class="online-leave-actions"><button type="button" id="onlineLeaveCancel" autofocus>退出せず戻る</button><button type="button" id="onlineLeaveConfirm">退出して最初のメニューへ</button></div>';
  document.body.appendChild(leaveDialog);
  const diagnostic=document.createElement('div');diagnostic.id='onlineDiagnostic';diagnostic.hidden=true;diagnostic.setAttribute('aria-label','オンライン試験の診断');document.body.append(diagnostic);
  const number=(v,digits=0)=>Number.isFinite(v)?v.toFixed(digits):'—';
  const diagnosticReasons={distance:'距離',accumulated:'見た目の蓄積',respawn:'再出撃',equipment:'装備',down:'行動不能',transfer:'転送',jumpPad:'ジャンプ台',catapult:'射出台',stun:'よろけ',electric:'電撃',shock:'衝撃',history:'履歴不足',disabled:'予測OFF',melee:'近接',special:'加速・特殊動作',zip:'ジップライン',repair:'修理',launch:'射出',lift:'リフト',planted:'構え',inactive:'行動不能'};
  const diagnosticStats=s=>s?.count?number(s.meanMs,1)+' / '+number(s.p95Ms,1)+' / '+number(s.maxMs,1)+'ms':'標本待ち';
  function refreshDiagnostic(){
    const d=CBOnlineGame.diagnostics(),show=d.phase==='playing'&&document.getElementById('onlineDiagnostics').checked;
    diagnostic.hidden=!show;if(!show)return;
    const rows=[(d.role==='host'?'HOST':'GUEST')+' 診断 / F3で開閉 / F8で圧縮ログをコピー / 直近2秒（起動直後は得られた標本）',
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
  supported.classes.forEach(c=>{addOption('onlineClass',c.id,c.name);addOption('onlineEquipmentClass',c.id,c.name);});
  for(let i=0;i<3;i++){addOption('onlineBuild',i,'構成'+(i+1));addOption('onlineEquipmentBuild',i,'構成'+(i+1));}
  el('onlineBuild').value=String(CBOnlineGame.savedBuilds().cur);el('onlineName').value=CBOnlineGame.pilotNameForOnline();
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
    for(const id of ['onlineCreate','onlineJoin','onlineClass','onlineBuild','onlineLatency','onlineName'])el(id).disabled=busy||active;
    el('onlineRoom').readOnly=active;el('onlineRoom').disabled=busy;
    if(!active)el('onlineBuild').value=String(CBOnlineGame.savedBuilds().cur);
    const saved=CBOnlineGame.savedBuildStatus();el('onlineBuildStatus').textContent=saved.text;el('onlineBuildStatus').style.color=saved.failed?'#ffbd7f':'';
    for(const id of ['onlineCapacity','onlineTeamSize','onlineMap','onlineTeamMode','onlineApplySettings'])el(id).disabled=!editable;
    panel.dataset.phase=s.phase;panel.setAttribute('aria-busy',String(busy));
    el('onlinePhase').textContent=busy?'通信中':s.phase==='lobby'?(s.role==='host'?'ホスト / 入室待機':'ゲスト / 開始待機'):s.phase==='playing'?'作戦進行中':'接続待機';
    el('onlineCopy').hidden=!s.roomId;el('onlineCopy').disabled=busy;
    el('onlineEmpty').hidden=s.roster.length>0;
    el('onlineSettings').hidden=s.role==='guest'&&!s.settings;
    el('onlineApplySettings').hidden=!host;el('onlineShuffle').hidden=!host;el('onlineShuffle').disabled=busy||!host;
    el('onlineStart').hidden=!host;el('onlineStart').disabled=busy||!CBOnlineGame.canStart();
    const lobby=active&&s.phase==='lobby'&&!!s.equipment;
    if(!lobby)el('onlineEquipmentEditor').hidden=true;
    const editing=!el('onlineEquipmentEditor').hidden;
    el('onlineLocation').textContent=editing?'部屋に参加中 › 装備を変更中':lobby?'部屋に参加中 › 出撃準備':s.phase==='playing'?'試合中':'部屋を作る・参加する';
    el('onlineEquipmentActions').hidden=!editing;el('onlineRoomActions').hidden=editing;
    el('onlineClose').textContent=active?'部屋を退出して最初のメニューへ':busy?'接続を取り消して最初のメニューへ':'最初のメニューへ';
    el('onlineReady').hidden=!lobby;el('onlineReady').disabled=busy||editing||s.editing||s.equipmentPending;
    el('onlineReady').textContent=s.lobbyReady?'Readyを取り消す':'Ready（準備完了）';el('onlineReady').setAttribute('aria-pressed',String(s.lobbyReady));
    el('onlineEquipment').hidden=!lobby;el('onlineEquipment').disabled=busy||editing||s.equipmentPending;
    for(const field of el('onlineEquipmentEditor').querySelectorAll('button,select'))field.disabled=!lobby||busy||s.equipmentPending;
    for(const field of el('onlineEquipmentActions').querySelectorAll('button'))field.disabled=!lobby||busy||s.equipmentPending;
    el('onlineReadySummary').textContent=lobby?'Ready '+s.roster.filter(p=>p.ready).length+' / '+s.roster.length+'人。全員Readyの後、ホストが開始します。BotはReady不要です。':'';
    if(!s.nudgeActive)el('onlineReadyNudge').hidden=true;
    if(leaveDialog.open)refreshLeavePrompt();
    for(const b of panel.querySelectorAll('[data-action]'))b.disabled=!host;
    for(const row of panel.querySelectorAll('#onlineRoster [data-team]')){
      const full=s.roster.filter(p=>p.team===row.dataset.team).length>=s.settings?.teamSize&&row.getAttribute('aria-pressed')!=='true';
      row.tabIndex=s.phase==='lobby'?0:-1;row.setAttribute('aria-disabled',String(s.phase!=='lobby'||full));
    }
  }
  const status = t => { el('onlineStatus').textContent = typeof t === 'string' ? t : t?.message || t?.reason || t?.status || JSON.stringify(t);controls(); };
  const hideDuringPlay = () => { if(leaveDialog.open)leaveDialog.close();panel.hidden = true; returnButton.hidden = true;controls(); };
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
      const readiness=document.createElement('span');readiness.className='online-readiness';readiness.dataset.ready=String(!!entry.ready);readiness.textContent=entry.editing?'装備中':entry.ready?'Ready':'準備中';member.append(readiness);
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
  let lastSettingsSignature=null;
  function settingsChanged(settings,resolvedMapId,force=false) {
    const signature=settings?JSON.stringify([settings.capacity,settings.teamSize,settings.mapId,settings.teamMode,resolvedMapId]):null;
    // Ready/装備中の通知でも呼ばれる。確定設定が同じならホストの未反映の選択を消さない。
    if(settings&&(force||signature!==lastSettingsSignature)){el('onlineCapacity').value=String(settings.capacity);el('onlineTeamSize').value=String(settings.teamSize);el('onlineMap').value=settings.mapId;el('onlineTeamMode').value=settings.teamMode;}
    lastSettingsSignature=signature;
    el('onlineResolvedMap').textContent=settings?'出撃マップ: '+(supported.maps.find(m=>m.id===resolvedMapId)?.name||resolvedMapId)+(settings.mapId==='random'?'（抽選済み）':''):'';controls();
  }
  const options = () => ({displayName:el('onlineName').value.trim()||CBOnlineGame.pilotNameForOnline(),cls:el('onlineClass').value,latencyMs:Number(el('onlineLatency').value),settings:roomSettings(),onStatus:status,onCountdown:hideDuringPlay,onStarted:hideDuringPlay,onRequests:requestsChanged,onRoster:rosterChanged,onSettings:settingsChanged,onEnded:showResult,onLobbyReturn:lobbyReturned,onNudge:text=>{el('onlineReadyNudge').textContent=text;el('onlineReadyNudge').hidden=false;}});
  const act = async fn => {if(busy)return;busy=true;controls();const mine=++generation;try{await fn(mine);}catch(e){if(mine===generation)status(e.message);}finally{if(mine===generation){busy=false;controls();}}};
  const resetRoomControls = () => {equipmentDraft=buildDraft=buildBaseline=null;el('onlineEquipmentEditor').hidden=true;el('onlineReadyNudge').hidden=true;returnButton.textContent='オンラインへ戻る';if(document.getElementById('start').textContent.startsWith('ロビーへ戻る'))document.getElementById('start').textContent='もう一度出撃する';generation++;busy=false;el('onlineRoom').value='';el('onlineRoom').readOnly=false;el('onlineRequests').hidden=true;el('onlineRoster').replaceChildren();el('onlineRequests').replaceChildren();returnButton.hidden=true;controls();};
  const startLabel = () => document.getElementById('start');
  const leaveResult = (openPanel=true) => {CBOnlineGame.leave('試合結果から退出');resetRoomControls();startLabel().textContent='もう一度出撃する';panel.hidden=!openPanel;status('前の部屋を終了しました。新しく部屋を作るか、部屋IDを入力してください。');};
  returnButton.onclick = () => { if (CBOnlineGame.state.phase === 'lobby') { panel.hidden = false; returnButton.hidden = true; controls(); } else leaveResult(true); };
  button.onclick = () => {if(!CBOnlineGame.active())el('onlineName').value=CBOnlineGame.pilotNameForOnline();panel.hidden=false;controls();document.exitPointerLock?.();el('onlineName').focus();};
  el('onlineBuild').onchange=()=>{try{CBOnlineGame.chooseSavedBuild(Number(el('onlineBuild').value));controls();}catch(e){status(e.message);}};
  el('onlineCopy').onclick=async()=>{const id=CBOnlineGame.state.roomId;if(!id)return;try{await navigator.clipboard.writeText(id);status('部屋IDをコピーしました。友人に共有してください。');}catch{status('コピーできませんでした。部屋ID欄を選択してコピーしてください。');el('onlineRoom').focus();el('onlineRoom').select();}};
  el('onlineCreate').onclick=()=>act(async mine=>{let room;try{room=await CBOnlineGame.create(options());}catch(e){if(mine===generation)CBOnlineGame.leave('部屋を作成できませんでした');throw e;}if(mine!==generation)return;el('onlineRoom').value=room;status('部屋ID: '+room+'　ゲストの入室を待っています。');});
  el('onlineJoin').onclick=()=>act(async mine=>{const id=el('onlineRoom').value.trim();if(!id)throw Error('部屋IDを入力してください');try{await CBOnlineGame.join(id,options());}catch(e){if(mine===generation)CBOnlineGame.leave('接続できませんでした');throw e;}if(mine===generation)status('接続しました。ホストの開始を待っています。');});
  el('onlineApplySettings').onclick=()=>{try{CBOnlineGame.updateSettings(roomSettings());}catch(e){settingsChanged(CBOnlineGame.state.settings,CBOnlineGame.state.resolvedMapId,true);status(e.message);}};
  el('onlineShuffle').onclick=()=>{try{CBOnlineGame.shuffleTeams();}catch(e){status(e.message);}};
  let equipmentDraft=null,buildDraft=null,buildBaseline=null;
  function selectDraftBuild(cls){
    const build=buildDraft.list[buildDraft.cur];
    equipmentDraft={cls,mech:build.mech,loadouts:build.loadout,loadout:build.loadout[cls]};
  }
  function renderEquipment(){
    const cls=equipmentDraft.cls,options=CBOnlineGame.equipmentOptions(cls),fields=el('onlineEquipmentFields');fields.replaceChildren();
    el('onlineEquipmentClass').value=cls;el('onlineEquipmentBuild').value=String(buildDraft.cur);
    const add=(labelText,key,values,current,onChange)=>{
      const label=document.createElement('label'),select=document.createElement('select');label.textContent=labelText;select.dataset.equipment=key;
      for(const value of values){const option=document.createElement('option');option.value=value.id;option.textContent=value.name;select.append(option);}
      select.value=current;select.onchange=()=>{onChange(select.value);equipmentWeight();};label.append(select);fields.append(label);
    };
    const slotNames={main:'主武器',sub:'副武器',aux:'補助装備',sp:'特別装備'};
    for(const slot of SLOTS)add(slotNames[slot],slot,options.weapons[slot],equipmentDraft.loadout[slot],value=>equipmentDraft.loadout[slot]=value);
    for(const slot of PART_SLOTS)add(PART_NAMES[slot]||slot,slot,options.parts[slot],equipmentDraft.mech[slot],value=>equipmentDraft.mech[slot]=value);
    add('塗装','color',options.paints,equipmentDraft.mech.color,value=>equipmentDraft.mech.color=value);equipmentWeight();controls();
  }
  function equipmentWeight(){const st=mechStats(equipmentDraft.mech,equipmentDraft.loadout);el('onlineEquipmentWeight').textContent='総重量 '+st.weight+'kg / 積載 '+st.cap+'kg'+(st.excess>0?'（重量超過 +'+st.excess+'kg、速度 −'+Math.round(st.slow*100)+'%）':'');}
  el('onlineEquipment').onclick=()=>{try{
    CBOnlineGame.setEditing(true);buildBaseline=CBOnlineGame.savedBuilds();buildDraft=JSON.parse(JSON.stringify(buildBaseline));
    selectDraftBuild(CBOnlineGame.state.equipment.cls);el('onlineEquipmentEditor').hidden=false;renderEquipment();el('onlineEquipmentBuild').focus();
  }catch(e){status(e.message);}};
  el('onlineEquipmentClass').onchange=()=>{selectDraftBuild(el('onlineEquipmentClass').value);renderEquipment();};
  el('onlineEquipmentBuild').onchange=()=>{buildDraft.cur=Number(el('onlineEquipmentBuild').value);selectDraftBuild(equipmentDraft.cls);renderEquipment();};
  const closeEquipment=save=>{if(el('onlineEquipmentEditor').hidden)return;try{
    const result=save?CBOnlineGame.saveEquipmentBuilds(buildDraft,buildBaseline,equipmentDraft.cls):null;
    CBOnlineGame.setEditing(false);el('onlineEquipmentEditor').hidden=true;el('onlineReadyNudge').hidden=true;
    if(save){el('onlineBuild').value=String(buildDraft.cur);el('onlineClass').value=equipmentDraft.cls;
      status(result.saved?'構成'+(buildDraft.cur+1)+'を共通の保存へ反映しました。'+(result.pending?'ホストの装備確認を待っています。':'Readyを押してください。'):CBOnlineGame.savedBuildStatus().text);}
    if(!save)status('下書きを破棄して部屋に戻りました。保存済みの構成は変わりません。Readyを押してください。');
    equipmentDraft=buildDraft=buildBaseline=null;controls();(el('onlineReady').disabled?el('onlineStatus'):el('onlineReady')).focus();
  }catch(e){status(e.message);}};
  el('onlineEquipmentSave').onclick=()=>closeEquipment(true);el('onlineEquipmentCancel').onclick=()=>closeEquipment(false);
  el('onlineReady').onclick=()=>{try{CBOnlineGame.setReady(!CBOnlineGame.state.lobbyReady);controls();}catch(e){status(e.message);}};
  el('onlineStart').onclick=()=>act(async()=>{CBOnlineGame.updateSettings(roomSettings());await CBOnlineGame.start();status('ゲームの読み込みを待っています');});
  function refreshLeavePrompt(){
    const s=CBOnlineGame.state;
    el('onlineLeaveTitle').textContent=busy?'接続を取り消して退出しますか？':'部屋を退出しますか？';
    el('onlineLeaveDescription').textContent=(s.role==='host'?'ホストが退出すると部屋を閉じ、全員の接続と試合を終了します。':s.role==='guest'?'この部屋との接続を終了します。':'接続を取り消します。')+(!el('onlineEquipmentEditor').hidden?'未保存の装備の下書きは破棄します。':'')+'保存済みの構成は残ります。最初のメニューへ移動します。';
    el('onlineLeaveCancel').textContent=!el('onlineEquipmentEditor').hidden?'退出せず装備編集を続ける':'退出せず戻る';
  }
  const leaveToMenu=()=>{CBOnlineGame.leave();resetRoomControls();panel.hidden=true;button.focus();};
  el('onlineClose').onclick=()=>{
    if(!CBOnlineGame.active()&&!busy){leaveToMenu();return;}
    refreshLeavePrompt();if(!leaveDialog.open)leaveDialog.showModal();el('onlineLeaveCancel').focus();
  };
  el('onlineLeaveCancel').onclick=()=>leaveDialog.close();
  el('onlineLeaveConfirm').onclick=()=>{if(!leaveDialog.open)return;leaveDialog.close();leaveToMenu();};
  leaveDialog.addEventListener('close',()=>{if(!panel.hidden)el('onlineClose').focus();});
  // 確認のEscapeは確認だけを閉じる。背後のロビー・下書き・ゲーム入力へ伝えない。
  for(const type of ['keydown','keyup'])leaveDialog.addEventListener(type,e=>e.stopPropagation());
  // 通常のマップ変更・射撃場・チュートリアルへ対戦中のまま入らない。
  document.addEventListener('click', e => { if (CBOnlineGame.active() && e.target.closest?.('#overlay') && !e.target.closest?.('#onlineReturn,#onlineLogResult,#menuOnlineLog')) {
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
  // V → 数字でカテゴリ → 数字で送信。押下を消費したキーはkeyupまで隔離し、長押しでも武器へ漏らさない。
  const chat=CBOnlineGame.quickChat;
  const chatBox=document.createElement('section');chatBox.id='onlineQuickChat';chatBox.hidden=true;
  chatBox.setAttribute('aria-label','定型通信');chatBox.innerHTML='<strong id="onlineQuickChatTitle"></strong><div id="onlineQuickChatChoices"></div><p>数字で選択 / 0で戻る / V・Escで閉じる</p><small>テキスト通信。音声・地点指定・Botへの指示はありません。</small>';
  const chatLog=document.createElement('div');chatLog.id='onlineQuickChatLog';chatLog.hidden=true;chatLog.setAttribute('role','log');chatLog.setAttribute('aria-live','polite');chatLog.setAttribute('aria-label','定型通信の受信');
  const chatNotice=document.createElement('div');chatNotice.id='onlineQuickChatNotice';chatNotice.hidden=true;chatNotice.setAttribute('role','status');
  const chatButton=document.createElement('button');chatButton.type='button';chatButton.id='onlineQuickChatOpen';chatButton.textContent='V 定型通信';chatButton.hidden=true;
  const lobbyChatButton=document.createElement('button');lobbyChatButton.type='button';lobbyChatButton.id='onlineLobbyChat';lobbyChatButton.textContent='V 定型通信（全員）';lobbyChatButton.hidden=true;
  const lobbyChatSection=document.createElement('section');lobbyChatSection.className='online-card online-lobby-chat';lobbyChatSection.hidden=true;
  const lobbyChatTitle=document.createElement('h3');lobbyChatTitle.textContent='定型通信 / 全員';lobbyChatSection.append(lobbyChatTitle,lobbyChatButton);panel.querySelector('.online-main').append(lobbyChatSection);
  document.body.append(chatBox,chatLog,chatNotice,chatButton);
  let chatGroup=null,chatContext='',chatOpenedAt=0,chatNoticeUntil=0,chatLogSignature='';
  const chatConsumed=new Set();
  const chatStamp=()=>[CBOnlineGame.state.roomId,CBOnlineGame.state.phase,CBOnlineGame.state.matchId,CBOnlineGame.state.phase==='playing'?player?.lifeId:''].join('|');
  const chatAvailable=()=>!el('onlineLeaveDialog')?.open&&!el('onlineLogDialog')?.open&&chat.allowed()&&(CBOnlineGame.state.phase==='lobby'?!panel.hidden:panel.hidden);
  const closeChat=()=>{chatBox.hidden=true;chatGroup=null;};
  function showChatChoices(){
    const list=el('onlineQuickChatChoices');list.replaceChildren();
    el('onlineQuickChatTitle').textContent=(CBOnlineGame.state.phase==='lobby'?'全員':'味方のみ')+' / '+(chatGroup===null?'定型通信':chat.categories[chatGroup].label);
    const entries=chatGroup===null?chat.categories:chat.categories[chatGroup].items;
    entries.forEach((entry,index)=>{const b=document.createElement('button');b.type='button';b.textContent=(index+1)+'  '+(entry.label||entry.text);b.onclick=()=>chooseChat(index);list.append(b);});
  }
  function openChat(){
    if(!chatAvailable())return;
    chatGroup=null;chatContext=chatStamp();chatOpenedAt=performance.now();chatBox.hidden=false;
    // 既に開いていた円形メニューのキー解放で旧指示・武器選択を送らない。
    wsel.open=qc.open=false;showChatChoices();
  }
  function chooseChat(index){
    if(!chatAvailable()||chatContext!==chatStamp()){closeChat();return;}
    if(chatGroup===null){if(chat.categories[index]){chatGroup=index;chatOpenedAt=performance.now();showChatChoices();}return;}
    const phrase=chat.categories[chatGroup].items[index];if(!phrase)return;
    closeChat();chat.send(phrase.id);
  }
  chatButton.onclick=lobbyChatButton.onclick=()=>chatBox.hidden?openChat():closeChat();
  for(const node of [chatBox,chatButton,lobbyChatButton])for(const type of ['mousedown','mouseup','auxclick','wheel'])node.addEventListener(type,e=>{e.stopPropagation();if(type!=='wheel')e.preventDefault();});
  const eatChatKey=e=>{e.preventDefault();e.stopImmediatePropagation();chatConsumed.add(e.code);delete keys[e.code];delete pressed[e.code];};
  addEventListener('keydown',e=>{
    if(chatConsumed.has(e.code)){eatChatKey(e);return;}
    if(!chatBox.hidden&&(!chatAvailable()||chatContext!==chatStamp()))closeChat();
    if(e.isComposing||e.ctrlKey||e.altKey||e.metaKey||e.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
    if(e.code==='KeyV'&&chatAvailable()){eatChatKey(e);if(!e.repeat)chatBox.hidden?openChat():closeChat();return;}
    if(chatBox.hidden)return;
    if(['Escape','Backspace'].includes(e.code)){eatChatKey(e);if(!e.repeat){if(e.code==='Backspace'&&chatGroup!==null){chatGroup=null;showChatChoices();}else closeChat();}return;}
    const digit=/^(?:Digit|Numpad)([0-9])$/.exec(e.code);if(!digit)return;
    eatChatKey(e);if(e.repeat)return;
    if(digit[1]==='0'){if(chatGroup===null)closeChat();else{chatGroup=null;showChatChoices();}}else chooseChat(Number(digit[1])-1);
  },true);
  addEventListener('keyup',e=>{if(!chatConsumed.delete(e.code))return;e.preventDefault();e.stopImmediatePropagation();delete keys[e.code];delete pressed[e.code];},true);
  addEventListener('blur',()=>{closeChat();chatConsumed.clear();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){closeChat();chatConsumed.clear();}});
  function refreshChat(){
    const s=CBOnlineGame.state,at=performance.now();
    if(!chatBox.hidden&&(!chatAvailable()||chatContext!==chatStamp()||at-chatOpenedAt>10000))closeChat();
    lobbyChatButton.hidden=s.phase!=='lobby'||!CBOnlineGame.active();lobbyChatButton.disabled=!chat.allowed();
    chatButton.hidden=s.phase!=='playing'||!panel.hidden||!chat.allowed();
    lobbyChatSection.hidden=s.phase!=='lobby'||!CBOnlineGame.active();
    const logParent=s.phase==='lobby'?lobbyChatSection:document.body;if(chatLog.parentNode!==logParent)logParent.append(chatLog);
    const lines=chat.lines(),signature=lines.map(line=>line.event).join(',');
    if(signature!==chatLogSignature){chatLogSignature=signature;chatLog.replaceChildren();for(const line of lines){const row=document.createElement('p');row.textContent=(line.scope==='all'?'[全員] ':'[味方] ')+line.name+'：'+line.text;chatLog.append(row);}}
    chatLog.hidden=!lines.length||!CBOnlineGame.active()||!['lobby','playing'].includes(s.phase);
    chatNotice.hidden=at>=chatNoticeUntil||!CBOnlineGame.active();
  }
  chat.subscribe((type,value)=>{
    if(type==='notice'){chatNotice.textContent=value.reason;chatNoticeUntil=performance.now()+3500;}
    if(type==='reset'){closeChat();chatConsumed.clear();chatNoticeUntil=0;chatLogSignature='';chatLog.replaceChildren();}
    refreshChat();
  });
  setInterval(refreshChat,100);
  el('onlineDiagnostics').addEventListener('change',refreshDiagnostic);
  addEventListener('keydown', e => {
    if(!CBOnlineGame.active()||!['F3','Escape'].includes(e.code))return;
    if(document.getElementById('onlineLogDialog')?.open)return;
    if(document.getElementById('onlineLeaveDialog')?.open)return;
    // F3のブラウザ検索・長押し反復を抑え、診断の開閉ではpointer lockを解除しない。
    e.stopImmediatePropagation();e.preventDefault();if(e.repeat)return;
    if(e.code==='F3'){if(CBOnlineGame.state.phase==='playing'){el('onlineDiagnostics').checked=!el('onlineDiagnostics').checked;refreshDiagnostic();}return;}
    // ロビーのEscapeで最初のメニューを露出しない。装備の下書きも暗黙に捨てない。
    if(CBOnlineGame.state.phase==='lobby'){
      if(!panel.hidden)status(!el('onlineEquipmentEditor').hidden?'編集内容は残っています。下の「保存して部屋に戻る」か「下書きを破棄して部屋に戻る」を選んでください。':'この部屋に参加しています。終了するときは「部屋を退出して最初のメニューへ」を選んでください。');
      return;
    }
    // 結果画面の間はEscapeでパネルを開かない。試合中は従来どおり開閉する。
    panel.hidden=CBOnlineGame.state.phase==='ended'?true:!panel.hidden;document.exitPointerLock?.();
  }, true);
  // 試作中の通常再出撃ボタンから、独立したオフライン戦を重ねて開始させない。
  document.getElementById('start').addEventListener('click', e => { if (CBOnlineGame.active?.()) { e.stopImmediatePropagation(); e.preventDefault(); panel.hidden = false; status('オンラインの試合中です。終了してから通常出撃してください。'); } }, true);
})();

// 共有は手動だけ。プレビューかF8操作の時点で固定した安全なテキストだけをコピーする。
(() => {
  const logs=window.CBOnlineGame?.logs;if(!logs)return;
  const dialog=document.createElement('dialog');dialog.id='onlineLogDialog';dialog.setAttribute('aria-labelledby','onlineLogTitle');
  dialog.innerHTML=`<h2 id="onlineLogTitle">試験用の診断ログ</h2><p>不具合が起きたらF8を押して、コピーされたログを投稿してください。投稿は任意です。自動送信・自動投稿はしません。F8は現試合だけの診断要約を、改行なし・241字以内でコピーします。この画面でもF8は241字以内の選別版です。「内容をコピー」は表示中の内容をコピーします。共有するかは内容を確認して決めてください。部屋IDのコピーとは別です。</p><p>IP・部屋/参加者ID・名前・チャット・SDP・生のエラー本文は記録しません。最新3接続、直近300標本・128イベント、合計512KiB、7日まで保持します。</p><p id="onlineLogStorage" role="status"></p><p>圧縮は暗号化ではありません。現試合（終了後は直前の試合）の版・役割・状態・失敗コード・代表値/極値だけを残します。別の試合・接続、全時系列、未収録の項目は意図的に省きます。開始境界の欠落は復元結果で確認できます。内容を確認するには「詳細を表示」。CBL3から始まる全文をdotに貼るか、リポジトリの復元ツールで解析できます。既存の保持上限で失った件数はデータ内に残します。</p><button type="button" id="onlineLogToggle">詳細を表示</button><label id="onlineLogLabel" for="onlineLogText">圧縮データ（プレビューを開いた時点）</label><textarea id="onlineLogText" readonly spellcheck="false"></textarea><p id="onlineLogStatus" role="status" aria-live="polite"></p><div class="online-log-actions"><button type="button" id="onlineLogCopy">内容をコピー</button><button type="button" id="onlineLogSave">詳細を保存</button><button type="button" id="onlineLogClear">保存済みログを消す</button><button type="button" id="onlineLogClose">閉じる</button></div>`;
  document.body.append(dialog);
  const notice=document.createElement('p');notice.id='onlineLogNotice';notice.hidden=true;notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');document.body.append(notice);
  let noticeRevision=0;
  function notify(text,persistent=false){const at=++noticeRevision;notice.textContent=text;notice.hidden=false;if(!persistent)setTimeout(()=>{if(at===noticeRevision)notice.hidden=true;},6000);}
  // 文字選択やTab/Spaceをゲームの入力へ渡さない。Escapeの標準closeは妨げない。
  for(const type of ['keydown','keyup'])dialog.addEventListener(type,e=>e.stopPropagation());
  const el=id=>document.getElementById(id),status=t=>{el('onlineLogStatus').textContent=t;};
  let preview='',captured={compressed:'',detail:''},showDetail=false,returnFocus=null,revision=0,copyPending=false,shortcutHeld=false;
  function showCaptured(){preview=showDetail?captured.detail:captured.compressed;el('onlineLogText').value=preview;el('onlineLogToggle').textContent=showDetail?'圧縮データを表示':'詳細を表示';el('onlineLogCopy').textContent=showDetail?'詳細をコピー（字数制限なし）':'圧縮データをコピー';el('onlineLogLabel').textContent=(showDetail?'詳細':'圧縮データ')+'（プレビューを開いた時点）';}
  function open(){
    if(dialog.open)return;notice.hidden=true;noticeRevision++;returnFocus=document.activeElement;captured=logs.capture();showDetail=!!captured.error;revision++;showCaptured();status(captured.error?'圧縮できませんでした。詳細は確認・コピー・保存できます。':'内容は端末内だけです。圧縮は暗号化ではありません。');
    el('onlineLogStorage').textContent=logs.status().storageAvailable?'再読み込み後も、このブラウザの直近ログを確認できます。ブラウザのデータ削除で消えます。':'ブラウザへの保存ができません。この画面を閉じる前にコピーかテキスト保存をしてください。';
    el('onlineLogCopy').disabled=el('onlineLogSave').disabled=!logs.status().available;
    dialog.showModal();el('onlineLogClose').focus();
  }
  function addButton(id,label,target){const b=document.createElement('button');b.type='button';b.id=id;b.textContent=label;b.onclick=open;target.append(b);return b;}
  const menu=addButton('menuOnlineLog','不具合のログ（F8でコピー）',el('menuOnline').parentElement);el('menuOnline').insertAdjacentElement('afterend',menu);if(typeof matchMedia==='function'&&matchMedia('(hover: none) and (pointer: coarse)').matches)menu.style.display='none';
  const measure=document.querySelector('#onlinePanel .online-measure');
  if(measure){const note=document.createElement('p');note.textContent='不具合が起きたらF8を押して、コピーされたログを投稿してください（任意）。現試合だけ・241字以内。自動投稿はしません。入力欄では無効です。';measure.append(note);addButton('onlineLogOpen','診断ログを確認',measure);}
  const result=addButton('onlineLogResult','試験ログを確認・保存（F8で圧縮）',el('onlineReturn').parentElement);el('onlineReturn').insertAdjacentElement('afterend',result);result.hidden=true;
  const refresh=()=>{const available=logs.status().available;menu.hidden=!available;result.hidden=!available||el('onlineReturn').hidden;};setInterval(refresh,500);refresh();
  async function copyLog(shortcut=false){
    if(copyPending)return;
    const wasOpen=!!dialog.open,at=revision;
    // 許可リストを通した既存APIだけを使い、部屋ID欄・生のmetrics・DOMの編集値を読まない。
    let text;try{text=wasOpen?(shortcut?captured.compressed:preview):logs.compressed();}catch(_){const message='圧縮できませんでした。以前のクリップボード内容を貼り付けないでください。診断ログを開いて詳細を保存してください。';wasOpen?status(message):notify(message,true);return;}
    if(shortcut&&wasOpen&&captured.error){status('共有用ログを作れませんでした。以前のクリップボード内容を貼らず、詳細を保存してください。');return;}
    if(!logs.status().available){const message='コピーする診断ログがありません。以前のクリップボード内容を貼り付けないでください。オンライン接続後に試してください。';wasOpen?status(message):notify(message);return;}
    if((shortcut||!showDetail)&&(typeof text!=='string'||text.length>241||/[\r\n]/.test(text))){const message='241字以内の診断要約を作れませんでした。詳細を保存してください。';wasOpen?status(message):notify(message,true);return;}
    copyPending=true;
    try{
      // キー/クリックのユーザー操作中に呼ぶ。許可の事前要求や自動再試行はしない。
      await navigator.clipboard.writeText(text);
      if(at===revision&&wasOpen===!!dialog.open){const message='診断ログ'+(wasOpen&&showDetail&&!shortcut?'（詳細）':'（241字以内・選別圧縮）')+'をコピーしました。貼り付け先と内容を確認して共有してください（自動投稿なし）。';wasOpen?status(message):notify(message);}
    }catch(_){
      // 生の例外には接続情報が混ざり得るため、その本文は表示・記録しない。
      if(at===revision&&wasOpen===!!dialog.open){
        const message='コピーできませんでした。以前のクリップボード内容を貼り付けないでください。HTTPS・ブラウザの許可・ファイル起動の制限を確認してください。';
        if(wasOpen){if(shortcut&&showDetail){showDetail=false;revision++;showCaptured();}status(message+' 選択された内容を手動コピーするか、テキスト保存を使ってください。');el('onlineLogText').focus();el('onlineLogText').select();}
        else notify(message+' Escでメニューを開き、「計測設定 → 診断ログを確認」または「診断ログを見る」から手動コピー・保存できます。',true);
      }
    }finally{copyPending=false;}
  }
  el('onlineLogCopy').onclick=()=>copyLog();
  // F2/F3・戦闘・定型通信と重ならない単独F8。成功/失敗とも試合とpointer lockを止めない。
  addEventListener('keydown',e=>{
    if(e.code!=='F8')return;
    if(!shortcutHeld&&(e.isComposing||e.ctrlKey||e.altKey||e.metaKey||e.shiftKey||e.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')))return;
    e.preventDefault();e.stopImmediatePropagation();if(shortcutHeld||e.repeat)return;
    shortcutHeld=true;void copyLog(true);
  },true);
  addEventListener('keyup',e=>{if(e.code!=='F8'||!shortcutHeld)return;shortcutHeld=false;e.preventDefault();e.stopImmediatePropagation();},true);
  addEventListener('blur',()=>{shortcutHeld=false;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)shortcutHeld=false;});
  el('onlineLogToggle').onclick=()=>{if(captured.error){status('圧縮できませんでした。詳細を保存してください。');return;}showDetail=!showDetail;revision++;showCaptured();status('表示を切り替えました。開いた時点の記録です。圧縮は選別版、詳細保存は全保持データです。');};
  el('onlineLogSave').onclick=()=>{let url;try{url=URL.createObjectURL(new Blob([captured.detail],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='core-breaker-diagnostic.txt';document.body.append(a);a.click();a.remove();status('開いた時点の詳細ログのテキスト保存を開始しました。');}catch(_){status('保存を開始できませんでした。内容をコピーしてください。');}finally{if(url)setTimeout(()=>URL.revokeObjectURL(url),1000);}};
  el('onlineLogClear').onclick=()=>{const removed=logs.clear()!==false;captured=logs.capture();if(captured.error)showDetail=true;revision++;showCaptured();el('onlineLogCopy').disabled=el('onlineLogSave').disabled=!logs.status().available;status(removed?'保存済みログを消しました。他のタブや接続中の新しい記録は続きます。':'ブラウザ保存分を消せませんでした。ブラウザのサイトデータ設定から削除してください。');refresh();};
  el('onlineLogClose').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{revision++;returnFocus?.focus();});
})();
