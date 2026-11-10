// ゲストの画面にも、戦況ログ（撃破・占拠）とアナウンス（プラント・コア）が出ること（2026-11-10 #214 の確認：ゲストには撃破ログもアナウンスも出なかった）。
// 色と「自軍・敵軍」はゲスト自身の軍で出し、ホストから届いた文字列は色付きの span と文字だけを通す。
// node tools/test/online_feed_check.js dbg <出力先> --mock-transport
const {check}=require('./lib');
const {harness,room,frames}=require('./online_test_helpers');
check('オンラインのゲストの戦況ログとアナウンス',async({browser,dir,ok,errors})=>{
  const h=await harness(dir,{realTime:true});let r;
  try{
    r=await room(browser,h,errors,{guests:1,teamSize:3});
    const g=r.guests[0];
    await frames(r.pages,20,16.7);
    await g.evaluate(()=>{document.getElementById('feed').innerHTML='';document.getElementById('announce').innerHTML='';});
    const info=await r.host.evaluate(()=>{
      const id=CBOnlineGame.state.peers.values().next().value.unitId,me=__g.units.find(u=>u.entityId===id);
      const enemy=__g.units.find(u=>u.team!==me.team&&u.alive),ally=__g.units.find(u=>u.team===me.team&&u!==me&&u.alive);
      document.getElementById('feed').innerHTML='';
      __g.kill(ally,enemy,false,1000,null); // ゲストの味方が、敵に撃破される
      // プラントを1つゲストの軍の物にし、ゲストの軍のコアを削る（写真で届く値）
      const pl=__g.plants[0];pl.owner=me.team;pl.gauge=me.team==='B'?1:-1;__g.cores[me.team].hp-=500;
      // 別のプラントを、ゲストの敵が占拠中（中立のままゲージだけ敵側へ）にする
      const p2=__g.plants[1];if(p2){p2.owner=null;p2.gauge=me.team==='B'?-60:60;window.__p2=p2.id;}
      return {guestTeam:me.team,enemy:enemy.name,ally:ally.name,plant:pl.id,hostFeed:document.getElementById('feed').textContent};
    });
    await frames(r.pages,30,16.7);
    const got=await g.evaluate(()=>({team:__g.player.team,
      feed:[...document.getElementById('feed').children].map(e=>({text:e.textContent,colors:[...e.querySelectorAll('span')].map(s=>s.style.color)})),
      ann:[...document.getElementById('announce').children].map(e=>e.textContent),
      ally:__g.sideColors(__g.player.team,__g.player.team).css,enemy:__g.sideColors(__g.player.team==='B'?'R':'B',__g.player.team).css}));
    console.log('ホスト',JSON.stringify(info),'ゲスト',JSON.stringify(got));
    // 画面上のプラントの占拠ゲージ：敵が占拠中なら敵の色（R側のゲストでも、自軍が青・敵が橙）
    const p2=await r.host.evaluate(()=>window.__p2||null);
    if(p2){
      const bar=await g.evaluate(({id,enemy})=>{const f=c=>{const e=document.createElement('i');e.style.color=c;document.body.append(e);const v=getComputedStyle(e).color;e.remove();return v;};
        const b=document.querySelector('#pl-'+id+' i');return {bg:getComputedStyle(b).backgroundColor,width:b.style.width,want:f(enemy)};},{id:p2,enemy:got.enemy});
      console.log('占拠ゲージ',JSON.stringify(bar));
      ok(bar.width==='60%'&&bar.bg===bar.want,'敵が占拠中のプラントのゲージは、ゲストの画面で敵の色');
    }
    const row=got.feed.find(f=>f.text.includes('を撃破'));
    ok(info.hostFeed.includes(info.enemy)&&info.hostFeed.includes('を撃破'),'ホストの戦況ログは今までどおり出る');
    ok(!!row&&row.text.includes(info.enemy)&&row.text.includes(info.ally),'ゲストにも撃破の戦況ログが出る（倒した機体と倒された機体の名前）');
    const want=await g.evaluate(({a,b})=>{const f=c=>{const e=document.createElement('i');e.style.color=c;return e.style.color;};return [f(b),f(a)];},{a:got.ally,b:got.enemy});
    ok(!!row&&row.colors.length===2&&row.colors[0]===want[0]&&row.colors[1]===want[1],'色はゲスト自身の軍から見た色（倒した敵は敵の色、倒された味方は味方の色）');
    ok(got.ann.some(t=>t===`プラント${info.plant}を占拠しました`),'ゲストにプラント占拠のアナウンスが出る');
    ok(got.ann.some(t=>t==='自軍コアが攻撃を受けています'),'ゲストに自軍コアのアナウンスが出る');
    // 届いた文字列の扱い：印を自分の軍で戻し、span と文字以外は文字にする
    const safe=await g.evaluate(()=>{const own=__g.player.team,other=own==='B'?'R':'B';
      const d=document.createElement('div');d.innerHTML=CBOnlineGame.safeFeedHtml(`<span style="color:{c${other}}">{n${other}}</span> が <img src=x onerror="window.__xss=1"><span style="color:red" onclick="window.__xss=1">名前</span><script>window.__xss=1</script>`);
      return {text:d.textContent,tags:[...d.querySelectorAll('*')].map(e=>e.tagName+':'+[...e.attributes].map(a=>a.name).join(',')),xss:window.__xss||0};});
    console.log('届いた文字列',JSON.stringify(safe));
    ok(safe.text.startsWith('敵軍 が ')&&safe.tags.length===1&&safe.tags[0]==='SPAN:style'&&!safe.xss,'届いた戦況ログは色付きの span と文字だけを通し、相手の軍は「敵軍」と出る');
  }finally{await r?.close().catch(()=>{});await h.close();}
},{page:false});
