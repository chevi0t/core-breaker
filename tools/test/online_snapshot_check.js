// node tools/test/online_snapshot_check.js dbg /tmp/online-snapshot [--mock-transport]
// 自然Bot戦の成功送信を観測するだけ。製品codec・通信間引き・ゲーム状態は変更しない。
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {check}=require('./lib');
const {harness,room,frames,summary,stats,sleep,TRANSPORT_MODE,ROOT,installWireObserver}=require('./online_test_helpers');
async function installProbe(host){await installWireObserver(host);await host.evaluate(()=>{
  const decoder=new CBOnlineCodec.Decoder(),utf8=new TextEncoder();
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
      const {envelope,channel,messageBytes,logicalMessageBytes,fragmentCount,maxDatagramBytes,chunkBase64ExpansionBytes,chunkEnvelopeBytes}=wire;
      const {type,payload:data}=envelope;
      if(!['prepare','snapshotBase','snapshot'].includes(type))return;
      const framing={channel,messageBytes,logicalMessageBytes,fragmentCount,maxDatagramBytes,chunkBase64ExpansionBytes,chunkEnvelopeBytes};
      if(type==='prepare'){
        probe.prepare.push({...framing,payloadBytes:bytes(data),hasSnapshotState:['baseline','delta','units'].some(k=>Object.hasOwn(data,k)),metadataKeys:Object.keys(data).sort()});
      }else if(type==='snapshotBase'){
        if(!decoder.seed(data))throw Error('基準seed失敗');
        const full=decoder.decode([data.v,data.id,'']);if(!full)throw Error('基準decode失敗');
        const schemaBytes=data.s?bytes(data.s):0,valuesBytes=data.d?bytes(data.d):0,patchBytes=data.p?bytes(data.p):0;
        probe.baselines.push({...framing,payloadBytes:bytes(data),baseId:data.id,parent:data.parent||null,hasSchema:!!data.s,schemaBytes,valuesBytes,patchBytes,baselineWrapperBytes:bytes(data)-schemaBytes-valuesBytes-patchBytes,envelopeOverheadBytes:logicalMessageBytes-bytes(data),schemaFields:data.s?.length||0,patchChangedFields:data.p?data.p.length/2:null,unitCount:full.units.length});
      }else{
        if(!Number.isSafeInteger(data.frame)||!Array.isArray(data.delta))throw Error('snapshot frame外枠が不正');
        const delta=data.delta,base=decoder.bases.get(delta[1]);if(!base)throw Error('snapshotの共通基準なし');
        const decoded=decoder.decode(delta);if(!decoded||decoded.frame!==data.frame)throw Error('snapshot decode/frame一致失敗');
        const detail=inspect(delta,base.s),sample={...framing,payloadBytes:bytes(data),deltaBytes:bytes(delta),binaryBytes:detail.binaryBytes,base64Bytes:detail.base64Bytes,changedFields:detail.changedFields,baseId:delta[1],frame:data.frame,gameTimeLeft:decoded.timeLeft,shellCount:decoded.shells?.length||0,unitCount:decoded.units.length,categories:detail.categories,
          envelopeOverheadBytes:logicalMessageBytes-bytes(data),frameWrapperBytes:bytes(data)-bytes(delta),deltaWrapperBytes:bytes(delta)-detail.base64Bytes,base64ExpansionBytes:detail.base64Bytes-detail.binaryBytes};
        if(decoded.frame===0){probe.initialSnapshots.push(sample);return;}
        probe.samples.push(sample);
        for(const [key,value]of Object.entries(detail.categories)){const c=probe.categories[key]||(probe.categories[key]={encodedBytes:0,changedFields:0,snapshotsWithChange:0});c.encodedBytes+=value.encodedBytes;c.changedFields+=value.changedFields;c.snapshotsWithChange++;}
        if(!probe.maximum||messageBytes>probe.maximum.messageBytes){
          const units={};for(const f of detail.fields)if(f.path[0]==='units'){const key=String(f.path[2]??'(unit)');const c=units[key]||(units[key]={encodedBytes:0,changedFields:0});c.encodedBytes+=f.encodedBytes;c.changedFields++;}
          probe.maximum={...sample,categories:detail.categories,unitFieldGroups:units,fields:detail.fields,shells:decoded.shells,counts:{units:decoded.units.length,shells:decoded.shells?.length||0,plants:decoded.plants?.length||0,turrets:decoded.turrets?.length||0,radars:decoded.radars?.length||0,barricades:decoded.barricades?.length||0},payload:data};
        }
      }
    }catch(error){probe.errors.push(error.message);}
  });
});}
check('自然Bot戦のsnapshot内訳',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir);let active;
  const report={mode:TRANSPORT_MODE,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),method:'mesa・10機・人間2人の入力は中立、Botを通常実行。300秒設定の自然試合を固定50msコマ送り、描画省略。実時間20Hz・回線帯域・人間の操作感の測定ではない。',accounting:'messageBytesは1論理メッセージを構成する成功したDataConnection.send全fragmentのJSON UTF8量。logicalMessageBytesは分割前JSON、maxDatagramBytesは1回のsendの最大量。ネットワークヘッダー・WebRTC再送を含まない。カテゴリencodedBytesはbase64化前の二進数（index差varintを当該項目へ加算）、差分base64増量・delta外枠・frame外枠・JSON envelope・fragment base64増量・fragment外枠は別計上。差分は直前snapshotではなく共通基準との比較。'};
  try{
    active=await room(browser,h,errors,{guests:1,teamSize:5,beforeStart:installProbe});
    for(let n=0;n<6400;n+=10){await frames(active.pages,10);if(n%400===0)console.log('自然Bot戦',Math.round(300-(await summary(active.host)).time)+'秒');if((await summary(active.host)).phase==='ended')break;}
    await frames(active.pages,8);await sleep(150);
    const end=await summary(active.host);ok(end.phase==='ended','300秒設定の自然Bot戦が勝敗まで完走');
    const guest=await summary(active.guests[0]);ok(guest.phase==='ended'&&JSON.stringify(guest.cores)===JSON.stringify(end.cores),'ゲストも同じ最終結果へ到達');
    const probe=await active.host.evaluate(()=>({...__snapshotProbe,observerErrors:__wireObserverErrors}));Object.assign(report,probe,{final:{phase:end.phase,timeLeft:end.time,cores:end.cores}});
    ok(probe.errors.length===0&&probe.observerErrors.length===0,'成功送信した全基準・差分を独立観測器で解析できる');
    ok(probe.prepare.length===1&&probe.prepare[0].channel==='control'&&!probe.prepare[0].hasSnapshotState&&JSON.stringify(probe.prepare[0].metadataKeys)===JSON.stringify(['localId','mapId','matchId','teamSize'])&&probe.prepare[0].messageBytes<262144,'初期prepareはcontrol metadata1通で静的基準を重複収録しない');
    ok(probe.baselines[0]?.unitCount===10&&probe.baselines[0].channel==='snapshot'&&probe.baselines[0].hasSchema&&probe.baselines[0].valuesBytes>0&&probe.baselines[0].logicalMessageBytes<=262144,'10機の初期schema・基準値を写真専用線で採取');
    ok(probe.initialSnapshots.length===1&&probe.initialSnapshots[0].unitCount===10,'初期状態写真を通常snapshotと分けて1枚採取');
    ok(probe.samples.length>0&&probe.maximum?.counts.units===10,'通常snapshotの最大payloadを保存');
    ok(probe.samples.every(s=>Object.values(s.categories).reduce((n,c)=>n+c.encodedBytes,0)===s.binaryBytes),'全snapshotのカテゴリbyte合計が二進payload長と一致');
    ok(probe.samples.every(s=>s.channel==='snapshot'&&s.messageBytes===s.binaryBytes+s.base64ExpansionBytes+s.deltaWrapperBytes+s.frameWrapperBytes+s.envelopeOverheadBytes+s.chunkBase64ExpansionBytes+s.chunkEnvelopeBytes),'全snapshotの二進差分・base64増量・delta/frame/envelope外枠・fragment増量の合計が送信量と一致');
    ok(probe.baselines.every(b=>b.messageBytes===b.schemaBytes+b.valuesBytes+b.patchBytes+b.baselineWrapperBytes+b.envelopeOverheadBytes+b.chunkBase64ExpansionBytes+b.chunkEnvelopeBytes),'全基準のschema・値・patch・外枠・fragment増量の合計が送信量と一致');
    ok(probe.byChannel.snapshot===(probe.byType.snapshot||0)+(probe.byType.snapshotBase||0)&&Object.values(probe.byType).reduce((n,b)=>n+b,0)===probe.byChannel.snapshot+probe.byChannel.control,'写真専用線とcontrolの実送信量を二重計上なく分類');
    report.summary={snapshotMessageBytes:stats(probe.samples.map(s=>s.messageBytes)),snapshotBinaryBytes:stats(probe.samples.map(s=>s.binaryBytes)),changedFields:stats(probe.samples.map(s=>s.changedFields)),snapshotLogicalMessageBytes:stats(probe.samples.map(s=>s.logicalMessageBytes)),snapshotFragmentCount:stats(probe.samples.map(s=>s.fragmentCount)),baselineMessageBytes:stats(probe.baselines.map(b=>b.messageBytes)),initialPrepare:probe.prepare[0],initialBaseline:probe.baselines[0],initialSnapshot:probe.initialSnapshots[0],byChannel:probe.byChannel,maxDatagramBytes:probe.maxDatagramBytes,maximum:(({fields,payload,shells,...rest})=>rest)(probe.maximum)};
    console.log('snapshot内訳',JSON.stringify(report.summary));
  }finally{if(active)await active.close();await h.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-snapshot.json'),JSON.stringify(report,null,2));}
},{page:false});
