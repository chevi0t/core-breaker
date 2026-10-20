// 初期画面の名前入力・保存・安全な表示と、アーケードの猫を実ブラウザで確認する。
// node tools/test/player_profile_check.js dbg/player-profile [結果と画像のフォルダ]
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const dir=path.resolve(process.argv[2]||'dbg/player-profile'),out=path.resolve(process.argv[3]||'dbg/player-profile/results');
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']}),checks=[],errors=[],layouts=[];
  const yes=(ok,label)=>{assert.ok(ok,label);checks.push(label);};
  try{
    const p=await browser.newPage({viewport:{width:1280,height:720}});
    p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await p.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
    await p.addInitScript(()=>{
      window.requestAnimationFrame=()=>0;window.AudioContext=window.webkitAudioContext=undefined;
      // 1フレームだけ描く確認画像でも、スクリーンショットまでWebGLの画素を残す。
      const getContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,options){return getContext.call(this,kind,/^webgl/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};
    });
    await p.goto('file://'+path.join(dir,'dbg.html'));
    const input=p.getByRole('textbox',{name:'プレイヤー名'});
    yes(await input.isVisible()&&await input.inputValue()==='あなた','初期画面に名前欄と既定名');
    await input.fill('');await input.pressSequentially('NEKO M G 01');
    yes(await input.inputValue()==='NEKO M G 01'&&await p.evaluate(()=>!__g.keys.KeyN&&!__g.keys.KeyM&&!__g.keys.KeyG&&!__g.keys.Space&&document.getElementById('feed').children.length===0),'スペースやゲームの操作キーを名前として入力できる');
    const name='三毛のパイロット';await input.fill(name);await input.press('Tab');
    yes(await p.evaluate(name=>localStorage.getItem('coreBreakerPlayerName')===name,name),'日本語の名前を保存');
    await p.reload();yes(await input.inputValue()===name,'再読み込み後も名前を復元');
    await p.screenshot({path:path.join(out,'initial-screen.png')});
    await p.setViewportSize({width:390,height:844});
    const r=await input.boundingBox();yes(r.x>=0&&r.x+r.width<=390&&await input.isVisible(),'狭い初期画面でも名前を入力できる');
    await p.setViewportSize({width:1280,height:720});
    await p.evaluate(()=>{const g=__g;window.profileRender=g.renderer.render.bind(g.renderer);g.renderer.render=()=>g.scene.updateMatrixWorld();g.selectMap('city');document.getElementById('start').click();g.running=false;for(const u of g.units)u.frozen=true;g.hud(240,.016);});
    yes(await p.evaluate(name=>__g.player.name===name&&document.getElementById('pilotName').textContent===name,name),'出撃したプレイヤーとHUDに名前を反映');
    yes(await p.evaluate(()=>{const g=__g;return Object.keys(g.CLASSES).every(cls=>{g.equip(g.player,cls);g.spawn(g.player);g.hud(240,.016);return g.player.name==='三毛のパイロット';});}),'兵装変更と再出撃で名前を維持');
    for(const [width,height,size] of [[640,480,96],[800,600,120],[1280,720,156],[1920,1080,156]]){
      await p.setViewportSize({width,height});
      for(const mode of ['standard','arcade','flight','mechanical']){
        await p.evaluate(mode=>{document.querySelector(`[data-console-choice="${mode}"]`).click();__g.equip(__g.player,'assault');__g.hud(240,.016);},mode);
        const boxes=await p.evaluate(()=>Object.fromEntries(['pilot','pilotMark','pilotName','pilotCls','status','aimSp','ammoBox','mini'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return[id,{x:r.x,y:r.y,w:r.width,h:r.height}];})));
        const inside=r=>r.x>=0&&r.y>=0&&r.x+r.w<=width+1&&r.y+r.h<=height+1;
        const overlaps=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1;
        yes(inside(boxes.pilot)&&inside(boxes.pilotMark),`${width}/${mode}の猫と名前が画面内`);
        if(mode==='arcade'){
          yes(boxes.pilotMark.w===size&&boxes.pilotMark.h===size&&boxes.pilotName.y>=boxes.pilotMark.y+size&&boxes.pilotCls.y>=boxes.pilotName.y+boxes.pilotName.h-1,`${width}の猫を3倍にし、下に名前と兵装`);
          yes(['aimSp','ammoBox','mini'].every(id=>!overlaps(boxes.pilot,boxes[id])),`${width}の顔とSP・装備・地図が重ならない`);
          yes(await p.evaluate(()=>__g.SLOTS.every((k,i)=>document.getElementById('w-'+k).dataset.name===`${i+1} ${__g.player.slots[k].w.name}`)),`${width}の武器名の前に1・2・3・4キーを表示`);
          if(width===1280||width===640){
            await p.waitForTimeout(150); // 画面サイズ変更による描画バッファの作り直しを待つ。
            await p.evaluate(()=>{const g=__g;for(const u of g.units)u.group.position.copy(u.pos);g.scene.updateMatrixWorld(true);g.camera.position.copy(g.player.pos).add(new g.T.Vector3(0,9,18));g.camera.lookAt(g.player.pos.clone().add(new g.T.Vector3(0,3,0)));profileRender(g.scene,g.camera);});
            await p.screenshot({path:path.join(out,`arcade-${width}.png`)});
          }
        }else yes(boxes.pilotMark.w===(width<=700?40:52),`${width}/${mode}の顔は従来の大きさ`);
        yes(await p.locator('.pilotRole').count()===0,'顔に兵装の一文字バッジがない');layouts.push({width,height,mode,boxes});
      }
    }
    await p.evaluate(()=>{__g.selectMap('dock');document.getElementById('start').click();__g.running=false;for(const u of __g.units)u.frozen=true;});
    yes(await p.evaluate(()=>__g.player.name==='三毛のパイロット'),'マップを変えても名前を維持');
    // 入力された記号を、スコア・表彰・戦闘ログで要素として組み立てない。
    await p.reload();await input.fill('<img src=x>');await input.press('Tab');
    await p.evaluate(()=>{const g=__g;g.renderer.render=()=>g.scene.updateMatrixWorld();g.selectMap('city');document.getElementById('start').click();g.running=false;for(const u of g.units)u.frozen=true;g.keys.Tab=true;g.running=true;g.kill(g.units.find(u=>u.team==='R'),g.player,false);g.hud(240,.016);g.keys.Tab=false;});
    yes(await p.evaluate(()=>document.querySelector('#boardBody .me .sbName').textContent==='<img src=x>'&&!document.querySelector('#boardBody img, #feed img')&&document.getElementById('feed').textContent.includes('<img src=x>')),'名前の記号をスコアと撃破ログで文字として表示');
    await p.evaluate(()=>{__g.player.sc.total=999;__g.timeLeft=0;__g.loop(performance.now()+50);});
    yes(await p.evaluate(()=>document.querySelector('#ovBoard .medal.me b')?.textContent==='<img src=x>'&&!document.querySelector('#ovBoard img')),'結果の表彰でも名前を文字として表示');
    await p.reload();await input.fill('   ');await input.press('Tab');
    yes(await input.inputValue()==='あなた','空欄は既定名へ戻す');
    await p.evaluate(()=>localStorage.setItem('coreBreakerPlayerName','あ'.repeat(40)+'\n'));await p.reload();
    yes(await input.inputValue()==='あ'.repeat(20),'長すぎる保存名を20文字へ収める');
    await input.evaluate(el=>{el.value='猫';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
    yes(await p.evaluate(()=>localStorage.getItem('coreBreakerPlayerName')==='あ'.repeat(40)+'\n'),'日本語変換中の値を保存しない');
    await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    yes(await p.evaluate(()=>localStorage.getItem('coreBreakerPlayerName')==='猫'),'日本語変換の確定後に保存');
    await p.addInitScript(()=>{Storage.prototype.getItem=Storage.prototype.setItem=()=>{throw Error('storage denied');};});await p.reload();
    await input.fill('保存なしの猫');await input.press('Tab');
    await p.evaluate(()=>{__g.renderer.render=()=>{};document.getElementById('start').click();__g.running=false;});
    yes(await p.evaluate(()=>__g.player.name==='保存なしの猫'),'保存できなくても名前を設定して出撃できる');
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify({passed:checks.length,checks,layouts,errors},null,2)+'\n');
    console.log(`プレイヤー名とアーケード猫：${checks.length}項目・${layouts.length}配置、成功。ブラウザエラー0`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
