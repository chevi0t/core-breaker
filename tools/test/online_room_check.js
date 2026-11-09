// 部屋設定UI・所属・非mesa移動施設の同期。ブラウザ試験は直列で実行する。
const fs=require('node:fs'),path=require('node:path');
const {check}=require('./lib');
const {readyAll,harness,pageFor,frames,sleep,TRANSPORT_MODE}=require('./online_test_helpers');
check('オンライン部屋設定と所属',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir),pages=[],report={mode:TRANSPORT_MODE,method:'描画省略の機能試験。実WebRTC/操作感/負荷性能を代替通信結果から推定しない。'};
  const page=async()=>{const p=await pageFor(browser,h,errors);pages.push(p);await p.evaluate(peerOptions=>{const create=CBOnlineGame.create,join=CBOnlineGame.join;CBOnlineGame.create=o=>create({...o,peerOptions});CBOnlineGame.join=(id,o)=>join(id,{...o,peerOptions});},h.peerOptions);return p;};
  try{
    const host=await page();await host.locator('#menuOnline').click();await host.locator('#onlineTeamSize').selectOption('2');await host.locator('#onlineTeamMode').selectOption('choice');await host.locator('#onlineCreate').click();
    await host.waitForFunction(()=>CBOnlineGame.state.roomId,{},{polling:20});const id=await host.evaluate(()=>CBOnlineGame.state.roomId);
    const guests=[];for(let i=0;i<3;i++){const g=await page();guests.push(g);await g.locator('#menuOnline').click();await g.locator('#onlineName').fill('設定試験'+i);await g.locator('#onlineRoom').fill(id);await g.locator('#onlineJoin').click();await g.waitForFunction(()=>CBOnlineGame.state.roster.length>=2,{},{polling:20});if(i===0){await g.locator('#onlineRoster [data-team="B"]').click();await host.waitForFunction(()=>CBOnlineGame.state.roster.length===2&&CBOnlineGame.state.roster.every(p=>p.team==='B'),{},{polling:20});ok(true,'ゲストが希望行を選ぶとホスト権威で所属を変更');}}
    await host.waitForFunction(()=>CBOnlineGame.state.roster.length===4,{},{polling:20});await sleep(150);
    ok(await host.locator('#onlineRoster [data-team]').count()===2,'希望選択は2行に分けて参加者を表示');
    const initial=await host.evaluate(()=>CBOnlineGame.state.roster);
    ok(initial.filter(p=>p.team==='B').length===2&&initial.filter(p=>p.team==='R').length===2,'片軍2人の部屋へ4人が均等に入る');
    const denied=await host.evaluate(()=>{try{CBOnlineGame.chooseTeam(CBOnlineGame.state.hostTeam==='B'?'R':'B');return '';}catch(e){return e.message;}});
    ok(/満員/.test(denied),'満員の相手チームへの移動を断る');
    await host.locator('#onlineCapacity').selectOption('3');await host.locator('#onlineApplySettings').click();
    ok(await host.evaluate(()=>CBOnlineGame.state.settings.capacity===4)&&/小さく/.test(await host.locator('#onlineStatus').textContent()),'参加人数未満への定員縮小を断る');
    const extra=await page();const full=await extra.evaluate(async([id,opts])=>{try{await CBOnlineGame.join(id,opts);return '';}catch(e){return e.message;}},[id,{peerOptions:h.peerOptions}]);
    ok(/満員|定員|上限/.test(full),'定員4人の部屋で5人目を断る');await extra.close();
    await guests[0].evaluate(()=>CBOnlineGame.state.transport.send('settings',{capacity:2,mapId:'mesa',teamSize:10}));await sleep(120);
    ok(await host.evaluate(()=>CBOnlineGame.state.settings.capacity===4&&CBOnlineGame.state.settings.teamSize===2),'ゲストからの設定改竄を採用しない');
    await host.locator('#onlineShuffle').click();const shuffled=await host.evaluate(()=>CBOnlineGame.state.roster);
    ok(shuffled.some(p=>initial.find(q=>q.id===p.id).team!==p.team)&&shuffled.filter(p=>p.team==='B').length===2,'ホストのシャッフルで所属を変え人数上限を守る');
    await host.locator('#onlineMap').selectOption('random');await host.locator('#onlineTeamMode').selectOption('random');await host.locator('#onlineApplySettings').click();await sleep(120);
    const randomMap=await host.evaluate(()=>CBOnlineGame.state.resolvedMapId);
    ok(await host.locator('#onlineRoster [data-random-roster]').count()===1,'ランダムは横1行の参加者表示');
    ok((await Promise.all(guests.map(g=>g.evaluate(()=>CBOnlineGame.state.resolvedMapId)))).every(m=>m===randomMap),'ランダムマップの抽選結果を全員で共有');
    // 移動施設がある通常コア戦マップを実データから選ぶ。存在しなければ未試験として失敗させる。
    const map=await host.evaluate(()=>CBOnlineGame.roomOptions.maps.map(m=>({id:m.id,lifts:MAPS[m.id].lifts?.length||0,pads:MAPS[m.id].jumpPads?.length||0,cats:MAPS[m.id].catapults?.length||0})).filter(m=>m.id!=='mesa').sort((a,b)=>(b.lifts*100+b.pads*10+b.cats)-(a.lifts*100+a.pads*10+a.cats))[0]);
    ok(!!map&&map.lifts+map.pads+map.cats>0,'移動施設を持つ非mesaマップを試験対象にする');report.map=map;
    await host.locator('#onlineMap').selectOption(map.id);await host.locator('#onlineTeamMode').selectOption('choice');await host.locator('#onlineApplySettings').click();await sleep(120);
    const before=await host.evaluate(()=>CBOnlineGame.state.roster);
    await readyAll([host,...guests],host);
    await host.locator('#onlineStart').click();const active=[host,...guests],deadline=Date.now()+25000;
    while(Date.now()<deadline){await frames(active,1);if(await host.evaluate(()=>CBOnlineGame.state.phase==='playing'))break;await sleep(25);}
    for(const p of active)await p.waitForFunction(()=>CBOnlineGame.state.phase==='playing',{},{polling:20});
    const state=await Promise.all(active.map(p=>p.evaluate(()=>({map:__g.mapId,team:__g.player.team,units:__g.units.length,color:__g.TEAM[__g.player.team].color,enemy:__g.TEAM[__g.player.team==='B'?'R':'B'].color,css:document.documentElement.style.getPropertyValue('--team-'+__g.player.team.toLowerCase()),armor:__g.player.armorMat.color.getHex(),roster:CBOnlineGame.state.roster}))));report.started=state;
    ok(state.every(s=>s.map===map.id&&s.units===4),'指定マップ・2対2で全員が開始');
    ok(state.every(s=>s.color===0x3ea6ff&&s.enemy===0xff8a2a&&s.css==='#3ea6ff'),'B/Rどちら所属でも自軍青・敵軍橙とCSSを一致させる');
    ok(state.some(s=>s.team==='R')&&state.every(s=>s.roster.every(p=>before.find(q=>q.id===p.id)?.team===p.team)),'希望選択では開始時も所属を維持');
    // 機体は部位色＋テクスチャ仕様があるため、同一役割のB/Rローカル装甲値が一致することを検査。
    ok(state.every(s=>s.armor===state[0].armor),'双方のローカル機体装甲は同じ自軍用の色になる');
    const locked=await host.evaluate(()=>{try{CBOnlineGame.updateSettings({mapId:'mesa'});return false;}catch{return true;}});ok(locked,'開始後のマップ設定変更を断る');
    const expected=await host.evaluate(()=>{if(lifts[0]){const v=lifts[0].pos.clone();v.y+=.25;setLiftPosition(lifts[0],v);lifts[0].direction=-1;lifts[0].waitT=.5;}if(jumpPads[0])jumpPads[0].flash=.5;if(catapults[0]){catapults[0].flash=.5;catapults[0].film.material.opacity=.25;}return CBOnlineGame.snapshot().mobility;});
    for(let i=0;i<6;i++){await host.evaluate(()=>{CBOnlineGame.beforeFrame(0,performance.now());CBOnlineGame.afterFrame(0,performance.now());});await frames(guests,1);await sleep(60);}
    const got=await guests[0].evaluate(()=>CBOnlineGame.snapshot().mobility);report.mobility={expected,got};
    const close=(a,b)=>Array.isArray(a)?Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>close(v,b[i])):a&&typeof a==='object'?b&&Object.keys(a).every(k=>close(a[k],b[k])):typeof a==='number'?Math.abs(a-b)<.021:a===b;
    ok(close(expected,got),'リフト位置・進行状態・ジャンプ台・カタパルトを量子化誤差内で複製');
  }finally{for(const p of pages)if(!p.isClosed())await p.evaluate(()=>CBOnlineGame.leave('設定試験終了')).catch(()=>{});await h.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-room.json'),JSON.stringify(report,null,2));}
},{page:false});
