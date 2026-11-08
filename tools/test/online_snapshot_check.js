// node tools/test/online_snapshot_check.js dbg /tmp/online-snapshot [--mock-transport]
// 自然Bot戦の成功送信を観測するだけ。製品codec・通信間引き・ゲーム状態は変更しない。
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {check}=require('./lib');
const {harness,room,frames,summary,stats,sleep,TRANSPORT_MODE,ROOT}=require('./online_test_helpers');
async function installProbe(host){await host.evaluate(()=>{
  const decoder=new CBOnlineCodec.Decoder(),utf8=new TextEncoder();
  const bytes=x=>utf8.encode(JSON.stringify(x)).length;
  const probe=window.__snapshotProbe={prepare:[],baselines:[],samples:[],categories:{},maximum:null,errors:[],byType:{}};
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
  const t=CBOnlineGame.state.transport,write=t._write.bind(t);
  t._write=(link,item)=>{
    const sent=write(link,item);if(!sent)return sent;
    try{
      probe.byType[item.type]=(probe.byType[item.type]||0)+item.bytes;
      if(!['prepare','snapshotBase','snapshot'].includes(item.type))return sent;
      const envelope=JSON.parse(item.text),data=envelope.payload;
      if(item.type==='prepare'){
        if(!decoder.seed(data.baseline))throw Error('prepare基準seed失敗');
        const full=decoder.decode(data.delta);if(!full)throw Error('prepare差分decode失敗');
        probe.prepare.push({messageBytes:item.bytes,payloadBytes:bytes(data),baselineBytes:bytes(data.baseline),schemaBytes:bytes(data.baseline.s),valuesBytes:bytes(data.baseline.d),deltaBytes:bytes(data.delta),schemaFields:data.baseline.s.length,unitCount:full.units.length,baseId:data.baseline.id});
      }else if(item.type==='snapshotBase'){
        if(!decoder.seed(data))throw Error('途中基準seed失敗');
        probe.baselines.push({messageBytes:item.bytes,payloadBytes:bytes(data),baseId:data.id,parent:data.parent||null,hasSchema:!!data.s,patchChangedFields:data.p?data.p.length/2:null});
      }else{
        const base=decoder.bases.get(data[1]);if(!base)throw Error('snapshotの共通基準なし');
        const decoded=decoder.decode(data);if(!decoded)throw Error('snapshot decode失敗');
        const detail=inspect(data,base.s),sample={messageBytes:item.bytes,payloadBytes:bytes(data),binaryBytes:detail.binaryBytes,base64Bytes:detail.base64Bytes,changedFields:detail.changedFields,baseId:data[1],frame:decoded.frame,gameTimeLeft:decoded.timeLeft,shellCount:decoded.shells?.length||0,unitCount:decoded.units.length,categories:detail.categories};
        probe.samples.push(sample);
        for(const [key,value]of Object.entries(detail.categories)){const c=probe.categories[key]||(probe.categories[key]={encodedBytes:0,changedFields:0,snapshotsWithChange:0});c.encodedBytes+=value.encodedBytes;c.changedFields+=value.changedFields;c.snapshotsWithChange++;}
        if(!probe.maximum||item.bytes>probe.maximum.messageBytes){
          const units={};for(const f of detail.fields)if(f.path[0]==='units'){const key=String(f.path[2]??'(unit)');const c=units[key]||(units[key]={encodedBytes:0,changedFields:0});c.encodedBytes+=f.encodedBytes;c.changedFields++;}
          probe.maximum={...sample,envelopeOverheadBytes:item.bytes-bytes(data),deltaWrapperBytes:bytes(data)-detail.base64Bytes,base64ExpansionBytes:detail.base64Bytes-detail.binaryBytes,categories:detail.categories,unitFieldGroups:units,fields:detail.fields,shells:decoded.shells,counts:{units:decoded.units.length,shells:decoded.shells?.length||0,plants:decoded.plants?.length||0,turrets:decoded.turrets?.length||0,radars:decoded.radars?.length||0,barricades:decoded.barricades?.length||0},payload:data};
        }
      }
    }catch(error){probe.errors.push(error.message);}
    return sent;
  };
});}
check('自然Bot戦のsnapshot内訳',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir);let active;
  const report={mode:TRANSPORT_MODE,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),method:'mesa・10機・人間2人の入力は中立、Botを通常実行。300秒設定の自然試合を固定50msコマ送り、描画省略。実時間20Hz・回線帯域・人間の操作感の測定ではない。',accounting:'messageBytesは成功したDataConnection.sendのJSON UTF8量。ネットワークヘッダー・WebRTC再送を含まない。カテゴリencodedBytesはbase64化前の二進数（index差varintを当該項目へ加算）、base64増量とJSON envelopeは別計上。差分は直前snapshotではなく共通基準との比較。'};
  try{
    active=await room(browser,h,errors,{guests:1,teamSize:5,beforeStart:installProbe});
    for(let n=0;n<6400;n+=10){await frames(active.pages,10);if(n%400===0)console.log('自然Bot戦',Math.round(300-(await summary(active.host)).time)+'秒');if((await summary(active.host)).phase==='ended')break;}
    await frames(active.pages,8);await sleep(150);
    const end=await summary(active.host);ok(end.phase==='ended','300秒設定の自然Bot戦が勝敗まで完走');
    const guest=await summary(active.guests[0]);ok(guest.phase==='ended'&&JSON.stringify(guest.cores)===JSON.stringify(end.cores),'ゲストも同じ最終結果へ到達');
    const probe=await active.host.evaluate(()=>__snapshotProbe);Object.assign(report,probe,{final:{phase:end.phase,timeLeft:end.time,cores:end.cores}});
    ok(probe.errors.length===0,'成功送信した全基準・差分を独立観測器で解析できる');
    ok(probe.prepare.length===1&&probe.prepare[0].unitCount===10&&probe.prepare[0].messageBytes<262144,'10機の初期prepareを1通として採取');
    ok(probe.samples.length>0&&probe.maximum?.counts.units===10,'通常snapshotの最大payloadを保存');
    ok(probe.samples.every(s=>Object.values(s.categories).reduce((n,c)=>n+c.encodedBytes,0)===s.binaryBytes),'全snapshotのカテゴリbyte合計が二進payload長と一致');
    ok(probe.maximum.messageBytes===probe.maximum.binaryBytes+probe.maximum.base64ExpansionBytes+probe.maximum.deltaWrapperBytes+probe.maximum.envelopeOverheadBytes,'最大snapshotの二進差分・base64増量・JSON外枠の合計が送信量と一致');
    report.summary={snapshotMessageBytes:stats(probe.samples.map(s=>s.messageBytes)),snapshotBinaryBytes:stats(probe.samples.map(s=>s.binaryBytes)),changedFields:stats(probe.samples.map(s=>s.changedFields)),baselineMessageBytes:stats(probe.baselines.map(b=>b.messageBytes)),initialPrepare:probe.prepare[0],maximum:(({fields,payload,shells,...rest})=>rest)(probe.maximum)};
    console.log('snapshot内訳',JSON.stringify(report.summary));
  }finally{if(active)await active.close();await h.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-snapshot.json'),JSON.stringify(report,null,2));}
},{page:false});
