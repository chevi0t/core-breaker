// ゲストの発砲の見た目（発砲炎・発射音・弾の筋）を手元で先に出し、ホストから届く炎と音の重複が増えないこと（2026-11-08）。
// node tools/test/online_local_fire_check.js dbg <出力先> --mock-transport
const {check}=require('./lib');
const {harness,room,frames,input,neutral}=require('./online_test_helpers');
// 描画時計16.7msとゲームdtを揃える。make_dbg既定の固定50msでは発射数の時間比較にならない。
check('オンラインのゲスト発砲の先出し',async({browser,dir,ok,errors})=>{
  const h=await harness(dir,{realTime:true});let r;
  try{
    r=await room(browser,h,errors,{guests:1,teamSize:2});
    const g=r.guests[0];
    await frames(r.pages,20,16.7);
    const weapon=await g.evaluate(()=>{const sl=__g.player.slots[__g.player.weapon];return {slot:__g.player.weapon,key:sl.w.key,type:sl.w.type,sfx:sl.w.sfx,rpm:sl.w.rpm,ammo:sl.ammo};});
    console.log('ゲストの武器',JSON.stringify(weapon));
    await g.evaluate(()=>{
      window.__fx={flash:0,sound:0};const me=()=>__g.player;
      const f=window.mainMuzzleFlash;window.mainMuzzleFlash=function(u,...a){if(u===me())__fx.flash++;return f.call(this,u,...a);};
      const s=window.sfx;window.sfx=function(name,at,src,...a){if(src===me()&&name===me().slots[me().weapon].w.sfx)__fx.sound++;return s.call(this,name,at,src,...a);};
    });
    await r.host.evaluate(()=>{window.__hostShots=0;const id=CBOnlineGame.state.peers.values().next().value.unitId;const f=window.shot;window.shot=function(u,...a){if(u.entityId===id)__hostShots++;return f.call(this,u,...a);};});
    await input(g,{...neutral,trigger:true});
    // ゲストだけ1コマ進める（ホストはまだ撃っていない）
    await frames([g],1,16.7);
    const first=await g.evaluate(()=>({...__fx}));
    const hostFirst=await r.host.evaluate(()=>__hostShots);
    ok(first.flash>=1&&first.sound>=1&&hostFirst===0,'引き金を引いたコマに、ホストの返事を待たずに発砲炎と発射音が出る');
    await frames(r.pages,60,16.7);
    await input(g,{...neutral,trigger:false});
    await frames(r.pages,30,16.7);
    const total=await g.evaluate(()=>({...__fx}));
    const hostShots=await r.host.evaluate(()=>__hostShots);
    console.log('ゲストの発砲炎',total.flash,'発射音',total.sound,'ホストの発射数',hostShots);
    ok(hostShots>0,'ホストが実際に撃つ（命中・弾数はホストが決める）');
    const tr=await g.evaluate(()=>CBOnlineGame.metrics().localTracers);
    console.log('弾の筋 手元',tr.drawn,'ホストから届いた自分の筋',tr.host,'うち手元と重なるので描かなかった',tr.covered);
    ok(tr.drawn>=hostShots*.75-2&&tr.drawn<=hostShots*1.25+2,'弾の筋も手元で先に描く（ホスト発射数から大きく外れない）');
    ok(tr.host>0&&tr.covered>=tr.host*.75-2,'ホストから届く自分の弾の筋は、手元で描いた分だけ二重に描かない');
    ok(total.flash>=hostShots*.75-2&&total.sound>=hostShots*.75-2&&total.flash<=hostShots*1.25+2&&total.sound<=hostShots*1.25+2,'炎・音の回数がホスト発射数から大きく外れない（この試験条件）');
  }finally{await r?.close().catch(()=>{});await h.close();}
},{page:false});
