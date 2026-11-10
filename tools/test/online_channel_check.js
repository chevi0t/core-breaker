// node tools/test/online_channel_check.js dbg /tmp/online-channel
// 実PeerJS 1.5.5で生成したRTCDataChannelの値だけを検証。接続成立やNAT越えの試験ではない。
const fs=require('node:fs'),path=require('node:path');
const {check}=require('./lib');
const {ROOT,harness,pageFor}=require('./online_test_helpers');
check('実PeerJSの制御・状態チャネル設定',async({browser,dir,out,ok,errors})=>{
  const h=await harness(dir);let page;
  const report={method:'実Chromium・npm版PeerJS 1.5.5・ローカルPeerServer。製品connectでcontrolを生成し、承認後経路_connectSnapshotでsnapshotを生成する。openを待たず実RTCDataChannel.ordered/maxRetransmits/maxPacketLifeTimeを読む。相手のいないIDなので通信成立・NAT/STUN接続・packet loss耐性は一切主張しない。',actualRTCConstruction:true,connectionEstablished:false,productionNetworkPerformanceVerified:false};
  try{
    page=await pageFor(browser,h,errors,{autoApprove:false});
    // --mock-transportを付けて起動されても、この試験のPeerJSだけは本物に戻す。
    if(await page.evaluate(()=>!!window.__mockTransport))await page.addScriptTag({path:path.join(ROOT,'node_modules/peerjs/dist/peerjs.min.js')});
    report.result=await page.evaluate(async peerOptions=>{
      const proto=RTCPeerConnection.prototype,original=proto.createDataChannel,created=[],status=[];
      const details=dc=>({label:dc.label,ordered:dc.ordered,maxRetransmits:dc.maxRetransmits,maxPacketLifeTime:dc.maxPacketLifeTime,readyState:dc.readyState});
      const probe=function(label,options){const dc=original.call(this,label,options);created.push({options:{...options},actual:details(dc)});return dc;};
      proto.createDataChannel=probe;
      const t=new CBOnlineTransport({appVersion:document.getElementById('appVersion').textContent.trim(),peerOptions:{...peerOptions,config:{iceServers:[]}},onStatus:(message,detail)=>status.push({message,detail})});
      let joining,extra;
      try{
        joining=t.connect('cb-channel-unregistered-'+crypto.randomUUID()).catch(error=>({error:error.message}));
        const until=performance.now()+6000;
        while(t.links.size===0&&performance.now()<until)await new Promise(r=>setTimeout(r,10));
        const link=[...t.links.values()][0];if(!link)throw Error('実PeerJS controlが生成されませんでした: '+JSON.stringify(status));
        const control=details(link.conn.dataChannel);link.snapshotToken='local-construction-only';
        t._connectSnapshot(link);
        if(!link.snapshotConn?.dataChannel)throw Error('実PeerJS snapshotが生成されませんでした: '+JSON.stringify(status));
        const snapshot=details(link.snapshotConn.dataChannel),restoredAfterSuccess=proto.createDataChannel===probe;
        // 製品の一時patchが、後続の無関係なチャネルをunreliableにしない。
        extra=new RTCPeerConnection({iceServers:[]});const unrelated=details(extra.createDataChannel('unrelated-reliable',{ordered:true}));
        // 例外経路でもcreateDataChannelを必ず戻すことを同じ本物のprototype上で確認。
        const connect=t.peer.connect;t.peer.connect=()=>{throw Error('試験用connect例外');};
        t._connectSnapshot(link);t.peer.connect=connect;
        const restoredAfterFailure=proto.createDataChannel===probe;
        return {peerRegistered:!!t.peer.id,control,snapshot,unrelated,restoredAfterSuccess,restoredAfterFailure,created,status};
      }finally{proto.createDataChannel=original;extra?.close();t.close('チャネル生成設定の試験終了');if(joining)await joining;}
    },h.peerOptions);
    const r=report.result;
    ok(r.peerRegistered,'実PeerJSをローカルPeerServerへ登録できた');
    ok(r.control.label==='core-breaker-control-v10'&&r.control.ordered===true&&r.control.maxRetransmits===null&&r.control.maxPacketLifeTime===null,'製品controlは実RTC上でも順序保証あり・再送上限なし');
    ok(r.snapshot.label==='core-breaker-snapshot-v10'&&r.snapshot.ordered===false&&r.snapshot.maxRetransmits===0&&r.snapshot.maxPacketLifeTime===null,'製品snapshotは実RTC上でも順序保証なし・再送0回');
    ok(r.created.some(x=>x.actual.label==='core-breaker-snapshot-v10'&&x.options.maxRetransmits===0),'PeerJSが作るcreateDataChannelの実引数にもmaxRetransmits:0が入る');
    ok(r.restoredAfterSuccess&&r.restoredAfterFailure&&r.unrelated.ordered===true&&r.unrelated.maxRetransmits===null,'成功時・例外時とも一時patchを戻し、無関係なチャネルは変更しない');
    console.log('実RTC生成設定',JSON.stringify({control:r.control,snapshot:r.snapshot,unrelated:r.unrelated,connectionEstablished:false}));
  }finally{if(page&&!page.isClosed())await page.close();await h.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'online-channel.json'),JSON.stringify(report,null,2));}
},{page:false});
