// 部屋設定の純粋な状態遷移。ブラウザ・WebRTC成立・描画負荷は検証しない。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const maps={mesa:{name:'台地演習場',team:5,time:300},city:{name:'丘の市街地',team:10,time:600},dock:{name:'港の倉庫街',team:2,time:300,vs:{}},test:{name:'試験場',team:5,time:300,testOnly:true},melee:{name:'近接戦',team:2,time:300,meleeOnly:true}};
let nextId=0,time=0;
class Transport {
  constructor(options){this.options=options;this.displayName=options.displayName||'ゲスト';this.peer={id:'host-'+(++nextId)};this.capacity=options.capacity;this.sent=[];this.started=false;}
  async createRoom(){return this.peer.id;}
  setCapacity(n){assert(!this.started);this.capacity=n;return true;}
  send(type,data,id){this.sent.push({type,data,id});return true;}
  broadcast(type,data){return this.send(type,data);}
  close(){}
  returnToLobby(){this.started=false;}
}
const elements=new Map(),empty=()=>{};
const slots=['main','sub','aux','sp'],parts=['head','body','arms','legs'];
const base=Object.fromEntries(slots.map(k=>[k,k]));
const c={SLOTS:slots,PART_SLOTS:parts,MECH_DEFAULT:{...Object.fromEntries(parts.map(k=>[k,'standard'])),color:'team'},PARTS:Object.fromEntries(parts.map(k=>[k,{standard:{name:'標準'},light:{name:'軽量'}}])),PAINTS:[{id:'team',name:'所属色'}],
  WEAPONS:Object.fromEntries([...slots,'alternate'].map(k=>[k,{name:k,type:'gun'}])),CLASSES:{assault:base,heavy:base},ARMORY:Object.fromEntries(['assault','heavy'].map(k=>[k,Object.fromEntries(slots.map(slot=>[slot,[slot,'alternate']]))])),MAPS:maps,performance:{now:()=>time},Map,Set,Date,Math,console,setTimeout,clearTimeout,CBOnlineTransport:Transport,CBOnlineVisibility:require('../../prototype/online/visibility'),CBOnlineCodec:{Encoder:class{},Decoder:class{}},
  window:{},mapId:'mesa',chosenCls:'assault',chosenTeam:'B',selectedTeamSize:null,running:false,ended:true,units:[],scene:{remove:empty},
  document:{exitPointerLock:empty},$:id=>{if(!elements.has(id))elements.set(id,{textContent:'test-v1',querySelector:()=>null});return elements.get(id);},
  stopLoopingGameSounds:empty,bgmTick:empty,tutorialClearInput:empty,setSimulationRole:empty,selectMap:empty,addEventListener:empty,
  weaponLook:empty,tracer:empty,boom:empty,impact:empty,sfx:empty,finish:empty,shot:empty,shoot:empty,blast:empty,damage:empty};
vm.createContext(c);vm.runInContext(fs.readFileSync(require.resolve('../../prototype/online/game.js'),'utf8').replace('  window.CBOnlineGame={create','  window.__lobbyTest={backToLobby};\n  window.CBOnlineGame={create'),c);const game=c.window.CBOnlineGame;
const json=x=>JSON.parse(JSON.stringify(x));
function join(id,name=id){game.state.transport.options.onPeerJoin(id,name);game.state.transport.options.onMessage('preference',{cls:'assault'},id);}
function team(id){return game.state.roster.find(p=>p.id===id).team;}
(async()=>{
  assert.deepEqual(json(game.roomOptions.maps.map(m=>m.id)),['mesa','city']);
  assert.deepEqual(json(game.roomOptions.teamSizes),[2,3,4,5,6,7,8,9,10]);
  await game.create({settings:{capacity:4,teamSize:2,mapId:'city',teamMode:'choice'},displayName:'ホスト'});
  assert.equal(game.state.resolvedMapId,'city');assert.equal(c.mapId,'mesa');assert.equal(game.state.transport.capacity,4);
  join('guest1','<b>名前</b>');join('guest2');
  assert.equal(game.state.roster.length,3);assert.equal(game.state.roster.find(p=>p.id==='guest1').name,'<b>名前</b>');
  assert.equal(team('guest1'),'R');assert.equal(team('guest2'),'B');
  const t=game.state.transport;
  t.options.onMessage('teamChoice',{team:'B',peerId:'guest2'},'guest1');
  assert.equal(team('guest1'),'R');assert.equal(t.sent.at(-1).data.ok,false);assert.match(t.sent.at(-1).data.reason,/満員/);
  game.chooseTeam('R');assert.equal(game.state.hostTeam,'R');
  t.options.onMessage('teamChoice',{team:'B',peerId:'guest2'},'guest1');assert.equal(team('guest1'),'B');assert.equal(team('guest2'),'B');
  assert.throws(()=>game.chooseTeam('B'),/満員/);
  assert.throws(()=>game.updateSettings({capacity:2}),/参加済み/);assert.equal(t.capacity,4);
  game.updateSettings({capacity:3,mapId:'random'});const picked=game.state.resolvedMapId;
  assert(['mesa','city'].includes(picked));game.updateSettings({teamMode:'random'});assert.equal(game.state.resolvedMapId,picked);
  assert.throws(()=>game.chooseTeam('B'),/希望選択/);
  const before=game.state.roster.map(p=>p.team).join('');game.shuffleTeams();const after=game.state.roster.map(p=>p.team).join('');
  assert.notEqual(after,before);assert(Math.abs(game.state.roster.filter(p=>p.team==='B').length-game.state.roster.filter(p=>p.team==='R').length)<=1);
  t.options.onMessage('settings',{capacity:4,mapId:'mesa'},'guest1');assert.equal(game.state.settings.capacity,3);assert.equal(game.state.settings.mapId,'random');
  for(const phase of ['preparing','countdown','playing','ended']){
    game.state.phase=phase;assert.throws(()=>game.updateSettings({capacity:4}),/待機中/);assert.throws(()=>game.shuffleTeams(),/待機中/);assert.throws(()=>game.chooseTeam('B'),/待機中/);
    t.options.onMessage('teamChoice',{team:'R'},'guest1');assert.equal(t.sent.at(-1).data.ok,false);
  }
  game.state.phase='lobby';game.updateSettings({teamMode:'choice',teamSize:5});game.chooseTeam('B');
  for(const id of ['guest1','guest2'])t.options.onMessage('teamChoice',{team:'B'},id);
  assert.throws(()=>game.updateSettings({teamSize:2}),/チーム人数/);assert.equal(game.state.settings.teamSize,5);
  for(const invalid of [{capacity:5},{teamSize:1},{teamSize:11},{teamSize:2.5},{mapId:'dock'},{mapId:'__practice'},{teamMode:'invalid'}])assert.throws(()=>game.updateSettings(invalid));
  // 入室だけではReadyにならず、本人の明示操作を必要とする。
  assert(game.state.roster.every(p=>!p.ready));assert.equal(game.canStart(),false);
  const ready=()=>{game.setReady(true);for(const id of ['guest1','guest2'])t.options.onMessage('lobbyReady',{ready:true,revision:game.state.lobbyRevision,equipmentVersion:game.state.peers.get(id).equipmentVersion},id);};
  ready();assert.equal(game.canStart(),true);assert.equal(game.state.phase,'lobby');
  const rev=game.state.lobbyRevision;game.updateSettings({teamSize:5});assert.equal(game.canStart(),true);assert.equal(game.state.lobbyRevision,rev,'同一設定の再適用ではReadyを消さない');
  game.updateSettings({teamSize:6});assert(game.state.roster.every(p=>!p.ready));
  t.options.onMessage('lobbyReady',{ready:true,revision:rev,equipmentVersion:game.state.peers.get('guest1').equipmentVersion},'guest1');assert.equal(game.state.peers.get('guest1').lobbyReady,false,'旧設定に対するReadyは無効');
  ready();const gear={...game.state.equipment,loadout:{...game.state.equipment.loadout,main:'alternate'}};
  game.setEquipment(gear);assert.equal(game.state.lobbyReady,false);assert(game.state.roster.filter(p=>!p.host).every(p=>p.ready),'装備変更では自分だけ解除');
  game.setReady(true);t.options.onMessage('lobbyEditing',{editing:true},'guest1');assert.equal(game.state.peers.get('guest1').lobbyReady,false);
  t.options.onMessage('lobbyReady',{ready:true,revision:game.state.lobbyRevision,equipmentVersion:game.state.peers.get('guest1').equipmentVersion},'guest1');assert.equal(game.state.peers.get('guest1').lobbyReady,false,'装備中はReady不可');
  const beforeEquipment=JSON.stringify(game.state.peers.get('guest1').equipment);t.options.onMessage('preference',{cls:'assault',loadout:{main:'illegal'}},'guest1');assert.equal(JSON.stringify(game.state.peers.get('guest1').equipment),beforeEquipment);
  assert.throws(()=>game.setEquipment({...gear,mech:{...gear.mech,head:'unknown'}}),/パーツ/);
  game.state.phase='playing';assert.throws(()=>game.setReady(true),/ロビー/);assert.throws(()=>game.setEquipment(gear),/ロビー/);game.state.phase='lobby';
  const existing=game.state.roomId;await assert.rejects(game.create({settings:{mapId:'dock'}}));assert.equal(game.state.roomId,existing);
  game.leave();let nudges=0;await game.create({onNudge:()=>nudges++});join('guest1');join('guest2');const t2=game.state.transport;
  const guestReady=()=>{for(const id of ['guest1','guest2'])t2.options.onMessage('lobbyReady',{ready:true,revision:game.state.lobbyRevision,equipmentVersion:game.state.peers.get(id).equipmentVersion},id);};
  guestReady();assert.equal(nudges,0,'装備中でなければ催促なし');game.setEditing(true);assert.equal(nudges,1,'他の全員Readyなら本人だけへ催促');
  guestReady();assert.equal(nudges,1);game.setEditing(false);game.setEditing(true);assert.equal(nudges,1,'30秒以内は繰り返さない');
  time=31000;game.setEditing(false);game.setEditing(true);assert.equal(nudges,2);game.setEditing(false);game.setReady(true);assert(game.canStart());
  game.state.phase='ended';c.window.__lobbyTest.backToLobby();assert(game.state.roster.every(p=>!p.ready&&!p.editing));assert.equal(game.canStart(),false);assert.equal(game.state.equipment.cls,'assault');
  guestReady();game.setReady(true);assert(game.canStart());t2.options.onPeerLeave('guest1','退出');assert(game.state.roster.every(p=>!p.ready));
  game.leave();assert.equal(game.state.role,'offline');assert.equal(game.state.settings,null);assert.equal(game.state.roster.length,0);
  console.log('オンライン部屋設定：マップ除外・定員・所属満員・縮小拒否・shuffle・random一度抽選・guest権威制限・開始後変更拒否 成功');
})().catch(e=>{console.error(e);process.exitCode=1;});
