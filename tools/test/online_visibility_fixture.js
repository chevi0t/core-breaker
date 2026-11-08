// 10/20機を同じ決定軌跡へ通すサイズ用fixture。実時間throughputの計測ではない。
// 関数をpage.evaluateへ渡せるよう外側の名前を参照しない。
function visibilitySizeFixture({frames=245}={}) {
  const g=__g,game=CBOnlineGame,h=__visibilityTest,t=game.state.transport,C=CBOnlineCodec;
  const clone=x=>JSON.parse(JSON.stringify(x)),bytes=x=>new TextEncoder().encode(typeof x==='string'?x:JSON.stringify(x)).length;
  const peers=[...game.state.peers.values()],reports=[],trace=[];
  const phase=f=>f===0?'initial':f<=80?'steady-visible':f<=160?'hidden-set':f<=185?'visibility-change':'steady-hidden';
  const peerStates=peers.map(p=>({p,off:new C.Encoder(),rows:[],raw:[],seq:{off:{snapshot:0,snapshotBase:0},on:{snapshot:0,snapshotBase:0}}}));
  for(const {p}of peerStates)p.replication=null;
  const packet=(type,payload,mode,entry)=>{
    const envelope=t._envelope(type,payload);if(type==='snapshot'||type==='snapshotBase')envelope.snapshotSequence=++entry.seq[mode][type];
    const text=JSON.stringify(envelope),chunks=type==='events'?[{text,bytes:bytes(text)}]:t._snapshotPackets(envelope,text);
    const wireBytes=chunks.reduce((n,p)=>n+p.bytes,0),logicalBytes=bytes(text),base64=chunks.filter(p=>JSON.parse(p.text).type==='snapshotChunk').reduce((n,p)=>n+JSON.parse(p.text).payload.data.length,0);
    return {type,wireBytes,logicalBytes,fragmentCount:chunks.length,maximumDatagramBytes:Math.max(...chunks.map(p=>p.bytes)),
      base64ExpansionBytes:base64?base64-logicalBytes:0,fragmentEnvelopeBytes:base64?wireBytes-base64:0,raw:chunks.map(p=>p.text)};
  };
  const original={frame:game.state.frame,positions:g.units.map(u=>({u,pos:u.pos.toArray(),vel:u.vel.toArray(),cloak:u.cloak,vis:u.vis,yaw:u.yaw,scoped:u.scoped,alive:u.alive,sc:{...u.sc}})),spotted:{B:[...g.spotted.B],R:[...g.spotted.R]}};
  try {
    for(let f=0;f<frames;f++){
      const name=phase(f),hidden=name==='hidden-set'||name==='steady-hidden'||name==='visibility-change'&&f%6<3;
      for(const k of ['B','R'])g.spotted[k].clear();
      for(const [i,u]of g.units.entries()){
        const side=u.team==='B'?-1:1,idx=u.idx??i%game.state.teamSize;
        u.pos.set(side*(150+idx*14)+Math.sin(f/17+i)*3,200,50+idx*12+f*.35);u.vel.set(Math.cos(f/17+i)*3/17/.05,0,7);
        u.yaw=0;u.scoped=false;u.alive=true;u.cloak=hidden&&idx%2===1;u.vis=u.cloak?.02:1;
        u.group.position.copy(u.pos);u.group.updateMatrixWorld(true);
        g.spotted[u.team==='B'?'R':'B'].set(u,5);
      }
      game.state.frame=1000+f;
      const full=game.snapshot(100000+f*50);
      // 両codecとも、この部屋の実ゲストだけに同じ8stepの確定入力履歴を入れる。
      full.acks={};full.inputAcks={};
      for(const p of peers){const u=full.units.find(u=>u.id===p.unitId);full.acks[u.id]=f+1;full.inputAcks[u.id]={seq:f+1,step:8*f+8,seqDt:1/60,actionSeq:f,totalDt:(f+1)/20,
        steps:Array.from({length:8},(_,j)=>({step:8*f+j+1,seq:f+1,dt:1/144,seqDt:(j+1)/144,pressed:false}))};}
      const source=g.units.find(u=>u.team==='R'&&(u.idx??0)%2===1)||g.units.at(-1);
      const events=[{id:f*2+1,type:'sfx',data:{unit:source.entityId,at:source.pos.toArray(),name:'rifle',rate:1,level:1}},
        {id:f*2+2,type:'shot',data:{unit:source.entityId,seq:f+1}}];
      trace.push({frame:full.frame,time:full.time,phase:name,units:full.units.map(u=>({id:u.id,pos:u.pos,cloak:u.cloak,vis:u.vis})),events});
      for(const entry of peerStates){
        const {p}=entry,off=entry.off.encode(full),on=h.encodePeerSnapshot(p,full),filtered=h.eventsForPeer(p,events);
        if(!on)throw Error('承認済みpeerのencodePeerSnapshotが空');
        const onWire=on.wire;
        const onBase=on.baseline??on.base;
        const rows=[];
        for(const [mode,encoded,wire,ev]of [['off',off,{frame:full.frame,delta:off.delta},events],['on',{baseline:onBase},onWire,filtered]]){
          if(encoded.baseline)rows.push({mode,...packet('snapshotBase',encoded.baseline,mode,entry)});
          rows.push({mode,...packet('snapshot',wire,mode,entry)});
          if(ev.length)rows.push({mode,...packet('events',ev,mode,entry)});
        }
        const visible=on.snapshot.units.filter(u=>!u.hidden);
        entry.rows.push({frame:full.frame,time:full.time,phase:name,hiddenIds:full.units.filter(u=>!visible.some(v=>v.id===u.id)).map(u=>u.id),
          messages:rows.map(({raw,...r})=>r)});
        if(f===0||f===1||[80,81,160,161,164,185,186,200,244].includes(f))entry.raw.push({frame:full.frame,phase:name,messages:rows});
      }
    }
    for(const e of peerStates){
      const groups={};
      for(const row of e.rows)for(const m of row.messages){const key=row.phase+'/'+m.mode,g=groups[key]||(groups[key]={phase:row.phase,mode:m.mode,frames:new Set(),snapshotBytes:0,baselineBytes:0,eventBytes:0,fragmentBase64ExpansionBytes:0,fragmentEnvelopeBytes:0,totalBytes:0,snapshotSizes:[],baselineSizes:[],eventSizes:[],datagramMax:0});
        g.frames.add(row.frame);g.totalBytes+=m.wireBytes;g.fragmentBase64ExpansionBytes+=m.base64ExpansionBytes;g.fragmentEnvelopeBytes+=m.fragmentEnvelopeBytes;g.datagramMax=Math.max(g.datagramMax,m.maximumDatagramBytes);
        if(m.type==='snapshot'){g.snapshotBytes+=m.wireBytes;g.snapshotSizes.push(m.wireBytes);}else if(m.type==='snapshotBase'){g.baselineBytes+=m.wireBytes;g.baselineSizes.push(m.wireBytes);}else{g.eventBytes+=m.wireBytes;g.eventSizes.push(m.wireBytes);}}
      const summarize=a=>({count:a.length,mean:a.length?a.reduce((s,n)=>s+n,0)/a.length:0,max:a.length?Math.max(...a):0});
      const phases=Object.values(groups).map(v=>({...v,frames:v.frames.size,fixtureSeconds:v.frames.size*.05,estimatedKBpsAt20Hz:v.totalBytes/(v.frames.size*.05)/1000,snapshotSizes:summarize(v.snapshotSizes),baselineSizes:summarize(v.baselineSizes),eventSizes:summarize(v.eventSizes)}));
      reports.push({peerId:e.p.id,unitId:e.p.unitId,phases,rows:e.rows,rawSamples:e.raw,
        changes:[...new Set(e.rows.map(r=>r.phase))].map(name=>{const off=phases.find(x=>x.phase===name&&x.mode==='off'),on=phases.find(x=>x.phase===name&&x.mode==='on');return {phase:name,offBytes:off.totalBytes,onBytes:on.totalBytes,changeBytes:on.totalBytes-off.totalBytes,changePercent:100*(on.totalBytes/off.totalBytes-1)};})});
    }
    return {units:g.units.length,frames,guestCount:peers.length,method:'決定的fixtureの同一完全状態を旧全体codecと本体peer別codecへ通す。fragmentは本体transportで作成するが送信しない。実時間throughputではない。',
      assumptions:'入力ackは部屋の実ゲスト一人分・8stepの決定値。10/20機はBot込み。20人接続、19peerのCPU、SCTP/DTLS/IPヘッダー・再送は未測定。2KBは合格条件にしない。',trace,peers:reports};
  } catch(error) {
    return {units:g.units.length,frames,guestCount:peers.length,failure:error.stack||error.message,trace,peers:peerStates.map(e=>({peerId:e.p.id,unitId:e.p.unitId,rows:e.rows,rawSamples:e.raw}))};
  } finally {
    game.state.frame=original.frame;
    for(const r of original.positions){r.u.pos.fromArray(r.pos);r.u.vel.fromArray(r.vel);Object.assign(r.u,{cloak:r.cloak,vis:r.vis,yaw:r.yaw,scoped:r.scoped,alive:r.alive,sc:r.sc});r.u.group.position.copy(r.u.pos);}
    for(const k of ['B','R']){g.spotted[k].clear();for(const [u,n]of original.spotted[k])g.spotted[k].set(u,n);}
  }
}
module.exports={visibilitySizeFixture};
