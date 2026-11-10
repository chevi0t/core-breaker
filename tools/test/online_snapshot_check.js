// node tools/test/online_snapshot_check.js dbg /tmp/online-snapshot [--mock-transport]
// --fixtures --baseline-root=/path/to/before ではNodeの決定的前後比較のみ。自然戦/ブラウザの代替ではない。
// 自然Bot戦の成功送信を観測するだけ。製品codec・通信間引き・ゲーム状態は変更しない。
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {check}=require('./lib');
const {harness,room,frames,summary,stats,sleep,TRANSPORT_MODE,ROOT,installWireObserver}=require('./online_test_helpers');
async function installProbe(host){await installWireObserver(host);await host.evaluate(()=>{
  const decoders=new Map(),locals=new Map(),utf8=new TextEncoder();
  const bytes=x=>utf8.encode(JSON.stringify(x)).length;
  const probe=window.__snapshotProbe={prepare:[],baselines:[],initialSnapshots:[],samples:[],categories:{},maximum:null,errors:[],byType:{},byChannel:{control:0,snapshot:0},datagrams:0,maxDatagramBytes:0};
  // 製品のbase64-varintを読み取る独立観測器。index差のvarintもその項目のbyteへ算入。
  function inspect(delta,schema){
    const raw=Uint8Array.from(atob(delta[2]),c=>c.charCodeAt(0)),fields=[],categories={};let at=0,index=-1;
    function get(){let n=0,mul=1,count=0;while(true){if(at>=raw.length||++count>8)throw Error('varint範囲外');const b=raw[at++];n+=(b&127)*mul;if(b<128)return n;mul*=128;}}
    while(at<raw.length){
      const start=at;index+=get()+1;const item=schema[index];if(!item)throw Error('schema項目なし');
      const [p,type]=item;let value;
      if(typeof type==='number'){const v=get();value=(v%2?-(v+1)/2:v/2)/type;}
      else if(type==='b')value=!!get();
      else{const len=get();if(at+len>raw.length)throw Error('JSON長不足');value=JSON.parse(new TextDecoder().decode(raw.subarray(at,at+len)));at+=len;}
      const size=at-start,category=String(p[0]);fields.push({path:p,type,encodedBytes:size,value});
      const c=categories[category]||(categories[category]={encodedBytes:0,changedFields:0});c.encodedBytes+=size;c.changedFields++;
    }
    return {binaryBytes:raw.length,base64Bytes:delta[2].length,changedFields:fields.length,categories,fields};
  }
  window.__observeOnlineWire(wire=>{
    probe.byType[wire.type]=(probe.byType[wire.type]||0)+wire.messageBytes;
    probe.byChannel[wire.channel]+=wire.messageBytes;
    probe.datagrams++;probe.maxDatagramBytes=Math.max(probe.maxDatagramBytes,wire.messageBytes);
  },wire=>{
    try{
      const {envelope,channel,messageBytes,logicalMessageBytes,fragmentCount,maxDatagramBytes,chunkBase64ExpansionBytes,chunkEnvelopeBytes,binaryWireSavedBytes}=wire;
      const {type,payload:data}=envelope,peerId=wire.peerId;
      let decoder=decoders.get(peerId);if(!decoder){decoder=new CBOnlineCodec.Decoder();decoders.set(peerId,decoder);}
      const hiddenNeutral=u=>Object.entries(u).every(([key,value])=>{
        if(['id','fixedUnit','hidden','visibilityEpoch'].includes(key))return true;
        if(['team','cls','controller','predictionBlocked'].includes(key))return value==='';
        if(['idx','motionEpoch','lagEpoch','renderCrouch'].includes(key))return value===0;
        if(['jumpPadIndex','zipLine'].includes(key))return value===-1;
        if(['pos','vel'].includes(key))return Array.isArray(value)&&value.length===3&&value.every(x=>x===0);
        if(key==='motionVectors')return Object.values(value).every(x=>x===null);
        if(key==='slots')return Object.values(value).every(slot=>Object.entries(slot).every(([field,x])=>field==='key'?x==='':x===null));
        return value===null;
      });
      const publicState=s=>{
        const localId=locals.get(peerId),team=localId?.split(':')[0],roster=s.roster||[],publicUnits=s.units.filter(u=>!u.hidden),ids=publicUnits.map(u=>u.id),expected=__g.units.map(u=>({id:u.entityId,team:u.team})),slotIds=roster.map(u=>u.id).sort();
        if(!localId||roster.length!==expected.length||new Set(roster.map(u=>u.id)).size!==expected.length||expected.some(u=>!roster.some(v=>v.id===u.id&&v.team===u.team)))throw Error('公開名簿が全機のid/所属を保持していません');
        if(!ids.includes(localId)||expected.filter(u=>u.team===team).some(u=>!ids.includes(u.id))||ids.some(id=>!roster.some(u=>u.id===id)))throw Error('自機/同陣営の公開状態が欠落しています');
        if(s.units.length!==roster.length||s.units.some((u,i)=>u.fixedUnit!==true||typeof u.hidden!=='boolean'||u.id!==slotIds[i]||u.hidden&&(!hiddenNeutral(u)||!(s.unitUpdates&(1<<i)))))throw Error('固定slot順または秘匿中立値が不正です');
        if(!Number.isSafeInteger(s.unitUpdates)||s.unitUpdates<0||s.unitUpdates>=(1<<s.units.length)||s.units.some(u=>!Number.isSafeInteger(u.visibilityEpoch)||u.visibilityEpoch<1)||Object.keys(s.acks||{}).some(id=>id!==localId)||Object.keys(s.inputAcks||{}).some(id=>id!==localId)||!Object.hasOwn(s.inputAcks||{},localId)||!Object.hasOwn(s.acks||{},localId))throw Error('公開epoch・更新mask・自機ackが不正です');
        return {localId,rosterCount:roster.length,fixedUnitCount:s.units.length,visibleUnitCount:publicUnits.length,hiddenUnitCount:s.units.length-publicUnits.length,alliedUnitCount:publicUnits.filter(u=>u.team===team).length,visibleEnemyCount:publicUnits.filter(u=>u.team!==team).length,unitUpdates:s.unitUpdates};
      };
      if(!['prepare','snapshotBase','snapshot'].includes(type))return;
      const framing={peerId,channel,messageBytes,logicalMessageBytes,fragmentCount,maxDatagramBytes,chunkBase64ExpansionBytes,chunkEnvelopeBytes,binaryWireSavedBytes:binaryWireSavedBytes||0};
      if(type==='prepare'){
        locals.set(peerId,data.localId);
        probe.prepare.push({...framing,payloadBytes:bytes(data),hasSnapshotState:['baseline','delta','units'].some(k=>Object.hasOwn(data,k)),metadataKeys:Object.keys(data).sort()});
      }else if(type==='snapshotBase'){
        if(!decoder.seed(data))throw Error('基準seed失敗');
        const full=decoder.decode([data.v,data.id,'']);if(!full)throw Error('基準decode失敗');
        const schemaBytes=data.s?bytes(data.s):0,valuesBytes=data.d?bytes(data.d):0,patchBytes=data.p?bytes(data.p):0;
        probe.baselines.push({...framing,payloadBytes:bytes(data),baseId:data.id,parent:data.parent||null,hasSchema:!!data.s,schemaBytes,valuesBytes,patchBytes,baselineWrapperBytes:bytes(data)-schemaBytes-valuesBytes-patchBytes,envelopeOverheadBytes:logicalMessageBytes-bytes(data),schemaFields:data.s?.length||0,patchChangedFields:data.p?data.p.length/2:null,unitCount:full.units.length,...publicState(full)});
      }else{
        if(!Number.isSafeInteger(data.frame)||!Array.isArray(data.delta))throw Error('snapshot frame外枠が不正');
        const delta=data.delta,base=decoder.bases.get(delta[1]);if(!base)throw Error('snapshotの共通基準なし');
        const decoded=decoder.decode(delta);if(!decoded||decoded.frame!==data.frame)throw Error('snapshot decode/frame一致失敗');
        const detail=inspect(delta,base.s),sample={...framing,payloadBytes:bytes(data),deltaBytes:bytes(delta),binaryBytes:detail.binaryBytes,base64Bytes:detail.base64Bytes,changedFields:detail.changedFields,baseId:delta[1],frame:data.frame,gameTimeLeft:decoded.timeLeft,shellCount:decoded.shells?.length||0,unitCount:decoded.units.length,...publicState(decoded),categories:detail.categories,
          envelopeOverheadBytes:logicalMessageBytes-bytes(data),frameWrapperBytes:bytes(data)-bytes(delta),deltaWrapperBytes:bytes(delta)-detail.base64Bytes,base64ExpansionBytes:detail.base64Bytes-detail.binaryBytes};
        if(decoded.frame===0){probe.initialSnapshots.push(sample);return;}
        probe.samples.push(sample);
        for(const [key,value]of Object.entries(detail.categories)){const c=probe.categories[key]||(probe.categories[key]={encodedBytes:0,changedFields:0,snapshotsWithChange:0});c.encodedBytes+=value.encodedBytes;c.changedFields+=value.changedFields;c.snapshotsWithChange++;}
        if(!probe.maximum||messageBytes>probe.maximum.messageBytes){
          const units={};for(const f of detail.fields)if(f.path[0]==='units'){const key=String(f.path[2]??'(unit)');const c=units[key]||(units[key]={encodedBytes:0,changedFields:0});c.encodedBytes+=f.encodedBytes;c.changedFields++;}
          probe.maximum={...sample,categories:detail.categories,unitFieldGroups:units,fields:detail.fields,shells:decoded.shells,counts:{roster:decoded.roster.length,units:decoded.units.length,shells:decoded.shells?.length||0,plants:decoded.plants?.length||0,turrets:decoded.turrets?.length||0,radars:decoded.radars?.length||0,barricades:decoded.barricades?.length||0},payload:data};
        }
      }
    }catch(error){probe.errors.push(error.message);}
  });
});}
if(process.argv.includes('--fixtures')){
  const baselineRoot=process.argv.find(v=>v.startsWith('--baseline-root='))?.slice('--baseline-root='.length);
  if(!baselineRoot)throw Error('--fixturesには--baseline-root=比較元checkoutが必要です');
  require('./online_snapshot_payload_fixture')({baselineRoot,output:path.resolve(process.argv[3]||'/tmp/online-snapshot-fixtures')});
}else check('自然Bot戦のsnapshot内訳',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir);let active;
  const report={mode:TRANSPORT_MODE,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),method:'mesa・10機・人間2人の入力は中立、Botを通常実行。300秒設定の自然試合を固定50msコマ送り、描画省略。実時間20Hz・回線帯域・人間の操作感の測定ではない。',accounting:'messageBytesは1論理メッセージを構成する成功したDataConnection.send全fragmentのJSON UTF8量。logicalMessageBytesは分割前JSON、maxDatagramBytesは1回のsendの最大量。ネットワークヘッダー・WebRTC再送を含まない。カテゴリencodedBytesはbase64化前の二進数（index差varintを当該項目へ加算）、差分base64増量・delta外枠・frame外枠・JSON envelope・fragment base64増量・fragment外枠は別計上。差分は直前snapshotではなくpeer専用基準との比較。公開名簿10機と可視機体数を分け、decode/基準idもpeerごとに独立。'};
  try{
    active=await room(browser,h,errors,{guests:1,teamSize:5,beforeStart:installProbe});
    for(let n=0;n<6400;n+=10){await frames(active.pages,10);if(n%400===0)console.log('自然Bot戦',Math.round(300-(await summary(active.host)).time)+'秒');if((await summary(active.host)).finished>0)break;}
    await frames(active.pages,8);await sleep(150);
    const end=await summary(active.host);ok(end.phase==='lobby'&&end.finished>0,'300秒設定の自然Bot戦が勝敗まで完走');
    const guest=await summary(active.guests[0]);ok(guest.phase==='lobby'&&guest.finished>0&&JSON.stringify(guest.cores)===JSON.stringify(end.cores),'ゲストも同じ最終結果へ到達');
    const probe=await active.host.evaluate(()=>({...__snapshotProbe,observerErrors:__wireObserverErrors}));Object.assign(report,probe,{final:{phase:end.phase,timeLeft:end.time,cores:end.cores}});
    ok(probe.errors.length===0&&probe.observerErrors.length===0,'成功送信した全基準・差分を独立観測器で解析できる');
    ok(probe.prepare.length===1&&probe.prepare[0].channel==='control'&&!probe.prepare[0].hasSnapshotState&&JSON.stringify(probe.prepare[0].metadataKeys)===JSON.stringify(['localId','mapId','matchId','teamSize'])&&probe.prepare[0].messageBytes<262144,'初期prepareはcontrol metadata1通で静的基準を重複収録しない');
    ok(probe.baselines[0]?.rosterCount===10&&probe.baselines[0]?.alliedUnitCount===5&&probe.baselines[0].channel==='snapshot'&&probe.baselines[0].hasSchema&&probe.baselines[0].valuesBytes>0&&probe.baselines[0].logicalMessageBytes<=262144,'10機の公開名簿と自機を含む味方5機の初期schema・基準値を写真専用線で採取');
    ok(probe.initialSnapshots.length===1&&probe.initialSnapshots[0].rosterCount===10&&probe.initialSnapshots[0].alliedUnitCount===5,'初期状態写真を通常snapshotと分けて1枚採取');
    ok(probe.samples.length>0&&probe.maximum?.counts.roster===10&&probe.maximum?.alliedUnitCount===5,'全10機の公開名簿と味方5機を維持した通常snapshotの最大payloadを保存');
    ok(probe.samples.every(s=>s.rosterCount===10&&s.alliedUnitCount===5&&s.fixedUnitCount===10&&s.visibleUnitCount===5+s.visibleEnemyCount&&s.hiddenUnitCount+s.visibleUnitCount===10&&s.visibleEnemyCount>=0&&s.visibleEnemyCount<=5),'全写真で公開名簿/固定slot10機と自機/味方5機を維持し、可視敵と中立化した秘匿枠を区別して計測');
    ok(probe.samples.every(s=>Object.values(s.categories).reduce((n,c)=>n+c.encodedBytes,0)===s.binaryBytes),'全snapshotのカテゴリbyte合計が二進payload長と一致');
    ok(probe.samples.every(s=>s.channel==='snapshot'&&s.messageBytes===s.binaryBytes+s.base64ExpansionBytes+s.deltaWrapperBytes+s.frameWrapperBytes+s.envelopeOverheadBytes+s.chunkBase64ExpansionBytes+s.chunkEnvelopeBytes-s.binaryWireSavedBytes),'全snapshotの二進差分・base64増量・delta/frame/envelope外枠・fragment増量の合計からバイナリ送信の節約分を引くと送信量と一致');
    ok(probe.baselines.every(b=>b.messageBytes===b.schemaBytes+b.valuesBytes+b.patchBytes+b.baselineWrapperBytes+b.envelopeOverheadBytes+b.chunkBase64ExpansionBytes+b.chunkEnvelopeBytes),'全基準のschema・値・patch・外枠・fragment増量の合計が送信量と一致');
    ok(probe.byChannel.snapshot===(probe.byType.snapshot||0)+(probe.byType.snapshotBase||0)&&Object.values(probe.byType).reduce((n,b)=>n+b,0)===probe.byChannel.snapshot+probe.byChannel.control,'写真専用線とcontrolの実送信量を二重計上なく分類');
    report.summary={snapshotMessageBytes:stats(probe.samples.map(s=>s.messageBytes)),snapshotBinaryBytes:stats(probe.samples.map(s=>s.binaryBytes)),changedFields:stats(probe.samples.map(s=>s.changedFields)),snapshotLogicalMessageBytes:stats(probe.samples.map(s=>s.logicalMessageBytes)),snapshotFragmentCount:stats(probe.samples.map(s=>s.fragmentCount)),baselineMessageBytes:stats(probe.baselines.map(b=>b.messageBytes)),initialPrepare:probe.prepare[0],initialBaseline:probe.baselines[0],initialSnapshot:probe.initialSnapshots[0],byChannel:probe.byChannel,maxDatagramBytes:probe.maxDatagramBytes,maximum:(({fields,payload,shells,...rest})=>rest)(probe.maximum)};
    console.log('snapshot内訳',JSON.stringify(report.summary));
  }finally{if(active)await active.close();await h.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-snapshot.json'),JSON.stringify(report,null,2));}
},{page:false});
