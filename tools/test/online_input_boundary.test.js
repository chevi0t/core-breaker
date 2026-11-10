// node tools/test/online_input_boundary.test.js [--revision=<比較元commit>]
// 製品の受信口・固定scheduler・平地physics・写真codecを接続する。WebGL/RTCは使わない。
const assert=require('node:assert/strict');
const {createPhysicsSuite}=require('./online_physics_sync_fixture');
const {Encoder,Decoder}=require('../../prototype/online/codec');
const revision=process.argv.find(arg=>arg.startsWith('--revision='))?.slice(11)||'working';
const api=createPhysicsSuite(revision).load('assault'),DT=1/60;
const json=x=>JSON.stringify(x,(_,v)=>Object.prototype.toString.call(v)==='[object Set]'?[...v]:v);
let checked=0;
function host(){
  const h=api.harness();h.game.state.role='host';
  const peers=h.units.map((u,i)=>{
    const p={id:'guest'+i,unitId:u.entityId,receivedSeq:0,appliedSeq:0,last:0,fixedCommands:true};
    h.game.state.peers.set(p.id,p);
    Object.assign(u,{controller:'remoteHuman',ownerPeerId:p.id,onlineFixedMovement:true,cameraRecoil:0,cameraRecoilYaw:0});
    return p;
  });
  const receive=(type,value,p=peers[0])=>h.test.onMessage(type,type==='inputBatch'?{inputs:value}:value,p.id);
  const command=(seq,extra={})=>({...api.input(seq),command:true,movePressed:{},cameraRecoil:0,cameraRecoilYaw:0,...extra});
  const tick=time=>{h.at(time);h.game.beforeFrame(DT,time);for(const u of h.units)h.c.updateHumanUnit(u,u.controlInput,DT);};
  const codecs=[false,true].map(fixed=>({fixed,encoder:new Encoder(),decoder:new Decoder()}));
  const snapshot=()=>{
    const raw=h.game.snapshot();
    for(const {fixed,encoder,decoder}of codecs){
      const photo=fixed?{...raw,units:raw.units.map(u=>h.test.fixedUnitForPeer(u,false,1)),unitUpdates:3}:raw;
      const wire=encoder.encode(photo);if(wire.baseline)assert(decoder.seed(wire.baseline),'正常な基準');
      const restored=decoder.decode(wire.delta);assert(restored,'正常な写真差分');
      for(const u of restored.units){
        assert(Number.isFinite(u.cameraRecoil)&&u.cameraRecoil>=0&&u.cameraRecoil<=1);
        assert(Number.isFinite(u.cameraRecoilYaw)&&Math.abs(u.cameraRecoilYaw)<=1);
      }
    }
    return raw;
  };
  return {h,peers,receive,command,tick,snapshot};
}
const badObject=JSON.parse('{"valueOf":null,"toString":null}');
const invalid=[];
for(const key of ['seq','actionSeq','lifeId'])for(const value of [undefined,null,true,'1',[],{},badObject,-1,.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1])invalid.push([key,value]);
for(const key of ['yaw','pitch','sentAt'])for(const value of [undefined,null,true,'0',[],{},badObject,NaN,Infinity,-Infinity])invalid.push([key,value]);
for(const key of ['fwd','side','cameraRecoil','cameraRecoilYaw','wheel'])for(const value of [null,true,'0',[],{},badObject,NaN,Infinity,-Infinity,Number.MAX_VALUE,-Number.MAX_VALUE])invalid.push([key,value]);
invalid.push(['seq',0],['lifeId',0],['yaw',1e6+.01],['yaw',-1e6-.01],['pitch',-.900001],['pitch',.700001],
  ['fwd',2.000001],['fwd',-2.000001],['side',2.000001],['side',-2.000001],
  ['cameraRecoil',-.000001],['cameraRecoil',1.000001],['cameraRecoil',1e20],['cameraRecoilYaw',-1.000001],['cameraRecoilYaw',1.000001],['cameraRecoilYaw',1e20],['wheel',-1.000001],['wheel',1.000001]);
for(const value of [undefined,null,{},[],[0,0],[0,0,0,0],[0,NaN,0],[0,Infinity,0],[0,'0',0],[0,badObject,0],[0,1e6,0],[0,-1e6,0]])invalid.push(['aimPoint',value]);
for(const value of [null,'1',badObject,-1,.5,2,Number.MAX_SAFE_INTEGER+1])invalid.push(['moveActionSeq',value]);
for(const value of [null,{},[null],[[0,1]],[[2,1]],[[1,0]],[[1,8]],[[1,1.5]],[[1,'1']],[[badObject,1]],[[1,1,1]],Array(9).fill([1,1])])invalid.push(['moveActions',value]);

// 不正な値はpeerの番号・生命・queueを一切更新しない。正常peerのframeと写真は進む。
for(const type of ['inputBatch','inputActions'])for(const [key,value]of invalid){
  const f=host(),{h,peers,receive,command,tick,snapshot}=f,p=peers[0];
  for(const peer of peers)receive('inputBatch',[command(1),command(2)],peer);
  tick(20);snapshot();const before=json(p),position=h.units[1].pos.clone();
  const malformed=command(3,{actionSeq:1,[key]:value});
  assert.doesNotThrow(()=>receive(type,type==='inputBatch'?[malformed]:malformed),`${type} ${key} を受信`);
  assert.equal(json(p),before,`${type} ${key} の不正値で状態を変更しない`);
  receive('inputBatch',[command(3),command(4)],peers[1]);
  assert.doesNotThrow(()=>{tick(40);snapshot();tick(60);snapshot();},`${type} ${key} の後もframe/写真継続`);
  assert(h.units[1].pos.distanceToSquared(position)>0,'正常peerの移動を継続');
  assert.equal(peers[1].appliedSeq,3,'正常peerの命令を消化');checked++;
}

// sort前のseq検査。同じbatchの正常2件は不正な1件に巻き込まれない。
for(const malformed of [null,42,'input',[],{seq:badObject},{seq:'2'},{seq:Infinity}]){
  const {peers,receive,command,tick,snapshot}=host();
  assert.doesNotThrow(()=>receive('inputBatch',[command(2),malformed,command(1)]));
  assert.deepEqual(Array.from(peers[0].commandQueue,x=>x.seq),[1,2]);
  tick(20);tick(40);snapshot();assert.equal(peers[0].appliedSeq,2);checked++;
}
// 初回/再出撃の不正入力でも生命を切り替えず、同番号の正常な再送を受け付ける。
for(const type of ['inputBatch','inputActions'])for(const lifeId of [1,2]){
  const {h,peers,receive,command}=host(),p=peers[0];h.units[0].lifeId=lifeId;
  const before=json(p),bad=command(1,{lifeId,actionSeq:1,cameraRecoil:Number.MAX_VALUE,pressed:{KeyH:true},nextCls:'heavy'});
  receive(type,type==='inputBatch'?[bad]:bad);assert.equal(json(p),before);
  const good={...bad,cameraRecoil:0};receive(type,type==='inputBatch'?[good]:good);
  assert.equal(p.inputLifeId,lifeId);assert.equal(type==='inputBatch'?p.receivedSeq:p.receivedActionSeq,1);checked++;
}
{
  const {peers,receive,command}=host(),before=json(peers[0]);
  receive('inputActions',command(1,{actionSeq:0}));assert.equal(json(peers[0]),before);checked++;
}
// 正常な多周回yaw、視点/反動端、pad+touchの合算、独立action番号は互換。
for(const type of ['inputBatch','inputActions'])for(const extra of [
  {yaw:40*Math.PI+.5,pitch:-.9,cameraRecoil:0,cameraRecoilYaw:-1,fwd:-2,side:2,wheel:-1},
  {yaw:1e6,pitch:.7,cameraRecoil:1,cameraRecoilYaw:1,fwd:2,side:-2,wheel:1},
  {yaw:-1e6,cameraRecoil:undefined,cameraRecoilYaw:undefined,fwd:undefined,side:undefined,wheel:undefined},
  {actionSeq:Number.MAX_SAFE_INTEGER,moveActionSeq:Number.MAX_SAFE_INTEGER,moveActions:[[Number.MAX_SAFE_INTEGER,7]]}
]){
  const {peers,receive,command,tick,snapshot}=host(),p=peers[0],value=command(1,{actionSeq:1,...extra});
  if(type==='inputBatch')receive(type,[value,command(2)]);
  else {receive(type,value);assert.equal(p.receivedActionSeq,value.actionSeq);receive('inputBatch',[command(1,{actionSeq:value.actionSeq}),command(2,{actionSeq:value.actionSeq})]);}
  assert.equal(p.receivedSeq,2);tick(20);snapshot();tick(40);snapshot();checked++;
}
console.log(`オンライン入力境界：${checked}条件で型/数値範囲・受理前不変・不正混在batch・他peer継続・実physics/codec 成功`);
