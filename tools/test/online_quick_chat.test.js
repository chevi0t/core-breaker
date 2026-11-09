// 定型通信のホスト権威・配信先・連投制限。時刻だけを進める独立VM試験。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
  let at=0;const empty=()=>{},elements=new Map();
  class Transport {
    constructor(options){this.options=options;this.displayName=options.displayName||'ホスト';this.peer={id:'host'};this.sent=[];}
    async createRoom(){return 'host';}send(type,data,id){this.sent.push({type,data,id});return true;}broadcast(type,data){return this.send(type,data);}close(){}
  }
  const slots=['main','sub','aux','sp'],parts=['head','body','arms','legs'];
  const base=Object.fromEntries(slots.map(k=>[k,k]));
  const c={SLOTS:slots,PART_SLOTS:parts,MECH_DEFAULT:{...Object.fromEntries(parts.map(k=>[k,'standard'])),color:'team'},
    PARTS:Object.fromEntries(parts.map(k=>[k,{standard:{name:'標準'}}])),PAINTS:[{id:'team',name:'所属色'}],
    WEAPONS:Object.fromEntries(slots.map(k=>[k,{name:k,type:'gun'}])),
    CLASSES:Object.fromEntries(['assault','heavy','raid','support'].map(k=>[k,base])),
    ARMORY:Object.fromEntries(['assault','heavy','raid','support'].map(k=>[k,Object.fromEntries(slots.map(slot=>[slot,[slot]]))])),MAPS:{mesa:{name:'演習場',team:5,time:300}},performance:{now:()=>at},Map,Set,Date,Math,console,setTimeout,clearTimeout,CBOnlineTransport:Transport,
    CBOnlineVisibility:require('../../prototype/online/visibility'),CBOnlineCodec:{Encoder:class{},Decoder:class{}},window:{},mapId:'mesa',chosenCls:'assault',chosenTeam:'B',selectedTeamSize:null,running:false,ended:true,units:[],player:null,scene:{remove:empty},
    document:{exitPointerLock:empty},$:id=>{if(!elements.has(id))elements.set(id,{textContent:'test-v1',querySelector:()=>null});return elements.get(id);},
    stopLoopingGameSounds:empty,bgmTick:empty,tutorialClearInput:empty,setSimulationRole:empty,selectMap:empty,addEventListener:empty,
    weaponLook:empty,tracer:empty,boom:empty,impact:empty,sfx:empty,finish:empty,shot:empty,shoot:empty,blast:empty,damage:empty};
  vm.createContext(c);vm.runInContext(fs.readFileSync(require.resolve('../../prototype/online/game.js'),'utf8'),c);
  const game=c.window.CBOnlineGame;
  const join=(id)=>{game.state.transport.options.onPeerJoin(id,id);game.state.transport.options.onMessage('preference',{cls:'assault'},id);};
  const req=(id,seq,extra={})=>({id,seq,phase:game.state.phase,matchId:game.state.matchId||null,lifeId:1,...extra});
  const receive=(data,id='g1')=>game.state.transport.options.onMessage('quickChatRequest',data,id);
  const messages=()=>game.state.transport.sent.filter(x=>x.type==='quickChat');
  const play=()=>{game.state.phase='playing';game.state.matchId='match-1';c.player={entityId:'B:0',team:'B',alive:true,hp:100,lifeId:1};c.units.push(c.player);
    for(const p of game.state.peers.values()){p.unitId=p.team+':'+p.id;c.units.push({entityId:p.unitId,team:p.team,alive:true,hp:100,lifeId:1,controller:'remoteHuman',ownerPeerId:p.id});}};
  return {c,game,join,req,receive,messages,play,at:n=>at=n};
}
(async()=>{
  const h=harness();await h.game.create({displayName:'<img src=x onerror=alert(1)>',settings:{teamMode:'choice'}});h.join('g1');h.join('g2');h.join('g3');
  const {game}=h;let t=game.state.transport;t.sent=[];
  assert.equal(game.quickChat.categories.length,4);assert.equal(new Set(game.quickChat.categories.flatMap(g=>g.items.map(i=>i.id))).size,16);
  assert(game.quickChat.send('ready').ok);assert.deepEqual(h.messages().map(x=>x.id),['g1','g2','g3'],'ロビーは敵味方に関係なく全員');
  assert.equal(game.state.lobbyReady,false,'準備できたという定型文は明示Readyを代行しない');
  assert.equal(game.quickChat.lines().length,1);assert.equal(h.messages()[0].data.scope,'all');
  h.at(1500);t.sent=[];h.receive(h.req('thanks',1,{sender:'host',name:'偽装',team:'B',text:'任意本文'}));
  assert.equal(h.messages()[0].data.sender,'g1');assert.equal(h.messages()[0].data.name,'g1');assert.equal(h.messages()[0].data.id,'thanks');assert(!('text' in h.messages()[0].data));
  assert.equal(game.quickChat.lines().at(-1).text,'ありがとう');
  h.at(2000);t.sent=[];h.receive(h.req('<script>',2));assert.equal(h.messages().length,0);
  h.at(2500);h.receive(h.req('yes',3),'outsider');assert.equal(h.messages().length,0,'未登録接続から送れない');
  h.play();h.at(3000);t.sent=[];h.receive(h.req('attack',3));
  assert.deepEqual(h.messages().map(x=>x.id),['g1','g3'],'R陣営の発言はRゲストだけに配信');assert.equal(game.quickChat.lines().length,0,'BホストにR発言を表示しない');
  h.at(4500);t.sent=[];h.receive(h.req('help',1),'g2');assert.deepEqual(h.messages().map(x=>x.id),['g2']);assert.equal(game.quickChat.lines().length,1,'味方ゲスト発言はホストにも一度表示');
  h.at(6000);t.sent=[];assert(game.quickChat.send('cover').ok);assert.deepEqual(h.messages().map(x=>x.id),['g2'],'ホストも味方だけ');
  const g1=h.c.units.find(u=>u.ownerPeerId==='g1');
  for(const [n,change,payload] of [[1,{alive:false,downT:10},{}],[2,{alive:false,downT:0},{}],[3,{alive:true,hp:0},{}],[4,{hp:100,downT:2},{}],[5,{downT:0},{lifeId:99}],[6,{}, {phase:'lobby'}],[7,{}, {matchId:'old'}]]){
    h.at(10000+n*1000);Object.assign(g1,change);t.sent=[];h.receive(h.req('enemy',3+n,payload));assert.equal(h.messages().length,0,'死・行動不能・古いlife/phase/matchをホストで拒否 '+n);
  }
  h.at(19000);t.sent=[];h.receive(h.req('enemy',11));assert.equal(h.messages().length,2,'生存復帰後に送信可能');
  h.at(21000);t.sent=[];h.receive(h.req('enemy',11));assert.equal(h.messages().length,0,'重複seqを拒否');
  h.at(22000);h.receive(h.req('enemy',12));assert.equal(h.messages().length,0,'同じ定型は5秒制限');
  h.at(24000);h.receive(h.req('enemy',13));assert.equal(h.messages().length,2,'同文5秒後は送れる');
  h.at(40000);t.sent=[];h.receive(h.req('yes',14));h.at(41500);h.receive(h.req('no',15));h.at(43000);h.receive(h.req('sorry',16));h.at(44500);h.receive(h.req('cover',17));assert.equal(h.messages().length,6,'10秒3通の窓');
  h.at(50000);h.receive(h.req('cover',18));assert.equal(h.messages().length,8,'10秒後に枠が戻る');
  h.at(51000);t.sent=[];for(let i=0;i<1000;i++)h.receive(h.req('unknown',19+i));assert(t.sent.length<=1,'拒否応答も無制限に増えない');
  h.at(52000);game.state.phase='countdown';assert.equal(game.quickChat.send('ready').ok,false);h.receive(h.req('ready',19));assert.equal(h.messages().length,0);
  game.state.phase='playing';h.c.player.alive=false;assert.equal(game.quickChat.send('yes').ok,false,'死亡ホストも拒否');h.c.player.alive=true;
  // クライアント側も敵向け・不正ID・再送を表示しない。受信名は本文に解釈せずUIでtextContent。
  game.state.role='guest';const message={id:'yes',event:100,phase:'playing',matchId:'match-1',sender:'g2',name:'<b>名前</b>',team:'B',scope:'team'};
  t.options.onMessage('quickChat',message,'host');assert.equal(game.quickChat.lines().at(-1).name,'<b>名前</b>');const before=game.quickChat.lines().length;
  for(const data of [message,{...message,event:101,team:'R'},{...message,event:102,id:'free'},{...message,event:103,matchId:'other'}])t.options.onMessage('quickChat',data,'host');
  assert.equal(game.quickChat.lines().length,before);
  h.at(70000);assert.equal(game.quickChat.lines().length,0,'8秒で表示を消す');game.leave();assert.equal(game.quickChat.lines().length,0);assert(!game.quickChat.allowed());
  console.log('定型通信：ID限定・送信者偽装拒否・ロビー全員・試合味方のみ・死/行動不能拒否・life/phase/match/seq境界・間隔/同文/連投/拒否通知制限・期限・退出 成功');
})().catch(e=>{console.error(e);process.exitCode=1;});
