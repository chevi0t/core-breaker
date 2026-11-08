// 部屋設定の純粋な状態遷移。ブラウザ・WebRTC成立・描画負荷は検証しない。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const maps={mesa:{name:'台地演習場',team:5,time:300},city:{name:'丘の市街地',team:10,time:600},dock:{name:'港の倉庫街',team:2,time:300,vs:{}},test:{name:'試験場',team:5,time:300,testOnly:true},melee:{name:'近接戦',team:2,time:300,meleeOnly:true}};
let nextId=0;
class Transport {
  constructor(options){this.options=options;this.displayName=options.displayName||'ゲスト';this.peer={id:'host-'+(++nextId)};this.capacity=options.capacity;this.sent=[];this.started=false;}
  async createRoom(){return this.peer.id;}
  setCapacity(n){assert(!this.started);this.capacity=n;return true;}
  send(type,data,id){this.sent.push({type,data,id});return true;}
  broadcast(type,data){return this.send(type,data);}
  close(){}
}
const elements=new Map(),empty=()=>{};
const c={MAPS:maps,performance,Map,Set,Date,Math,console,setTimeout,clearTimeout,CBOnlineTransport:Transport,CBOnlineCodec:{Encoder:class{},Decoder:class{}},
  window:{},mapId:'mesa',chosenCls:'assault',chosenTeam:'B',selectedTeamSize:null,running:false,ended:true,units:[],scene:{remove:empty},
  document:{exitPointerLock:empty},$:id=>{if(!elements.has(id))elements.set(id,{textContent:'test-v1',querySelector:()=>null});return elements.get(id);},
  stopLoopingGameSounds:empty,bgmTick:empty,tutorialClearInput:empty,setSimulationRole:empty,selectMap:empty,addEventListener:empty,
  weaponLook:empty,tracer:empty,boom:empty,impact:empty,sfx:empty,finish:empty,shot:empty,shoot:empty,blast:empty,damage:empty};
vm.createContext(c);vm.runInContext(fs.readFileSync(require.resolve('../../prototype/online/game.js'),'utf8'),c);const game=c.window.CBOnlineGame;
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
  const existing=game.state.roomId;await assert.rejects(game.create({settings:{mapId:'dock'}}));assert.equal(game.state.roomId,existing);
  game.leave();assert.equal(game.state.role,'offline');assert.equal(game.state.settings,null);assert.equal(game.state.roster.length,0);
  console.log('オンライン部屋設定：マップ除外・定員・所属満員・縮小拒否・shuffle・random一度抽選・guest権威制限・開始後変更拒否 成功');
})().catch(e=>{console.error(e);process.exitCode=1;});
