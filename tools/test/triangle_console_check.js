// 三角計器・三方向の捕捉演出・実噴射/特殊兵装の明滅を、表示値と実操作で確認。
// python3 tools/test/make_dbg.py dbg && node tools/test/triangle_console_check.js dbg [画像の出力先]
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  const out=path.resolve(process.argv[3]||'dbg/triangle-results');fs.mkdirSync(out,{recursive:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
    page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED/.test(m.text()))errors.push(m.text());});
    await page.route('https://**/*',r=>r.fulfill({body:''}));
    await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(k,a){return get.call(this,k,k.includes('webgl')?{...a,preserveDrawingBuffer:true}:a);};});
    await page.goto(pathToFileURL(path.resolve(process.argv[2]||'dbg','dbg.html')).href);
    const checks=await page.evaluate(()=>{
      const g=__g,$=id=>document.getElementById(id),checks=[],yes=(v,s)=>{if(!v)throw Error(s);checks.push(s);};
      g.selectMap('dock');$('start').click();for(const v of g.units)v.frozen=true;
      const u=g.player,e=g.units.find(v=>v.team!==u.team),draw=dt=>g.hud(240,dt??1/60);
      window.triangleTest={g,u,e,$,checks,yes,draw};
      u.hp=u.maxHp*.76;u.boost=u.maxBoost*.43;u.slots.sp.heat=37;u.slots.main.ammo=u.slots.main.w.mag/2;
      const fraction=id=>parseFloat($(id).getAttribute('stroke-dasharray'));
      const colors=[];
      for(const mode of ['standard','arcade','flight','mechanical','retro']){
        document.querySelector(`[data-console-choice="${mode}"]`).click();draw();
        yes(getComputedStyle($('triangleAim')).display!=='none',mode+'で三角ゲージを表示');
        yes(['lockRing','aimGauge','aimSp','mechAim'].every(id=>getComputedStyle($(id)).display==='none'),mode+'で範囲円と旧中央ゲージを隠す');
        yes(fraction('taAmmoFill')===50&&fraction('taHpFill')===76&&fraction('taBoostFill')===43&&fraction('taSpFill')===37,mode+'の4残量が実値に一致');
        yes($('taHpValue').textContent==='7,600'&&$('taSpValue').textContent==='SP 37%'&&$('taAmmoLabel').textContent==='AMMO'&&$('taHpLabel').textContent==='AP'&&$('taBoostValue').textContent==='BOOST 43%',mode+'の数値と英語名');
        yes(!$('taHpMax')&&!$('taAmmoState').textContent.includes('/'),mode+'の現在値に分母を付けない');
        colors.push(getComputedStyle($('taAmmoFill')).stroke);
      }
      yes(colors[0]===colors[1]&&colors[1]===colors[2]&&colors[3]!==colors[0]&&colors[4]!==colors[3],'標準・アーケード・フライトは共通、メカニカルとレトロは専用配色');
      const sl=u.slots.main;u.reloadMul=1.5;sl.reloadT=sl.w.reload*u.reloadMul/2;draw();
      yes(fraction('taAmmoFill')===50&&$('taAmmoState').textContent.includes('RELOAD'),'腕の装填倍率を含むリロード途中を英語で表示');sl.reloadT=0;
      const flags=['mirageOn','chargerOn','cloak','fieldOn','barrierOn','escortOn','post','postFlight','bombard','beamFire','healTarget'];
      for(const flag of flags){for(const k of flags)u[k]=null;u[flag]=true;draw();yes($('taSp').classList.contains('act'),flag+'の作動中はSPを連続明滅');}
      for(const k of flags)u[k]=null;draw();yes(!$('taSp').classList.contains('act'),'停止するとSP明滅を解除');
      u.chargerOn=true;u.slots.sp.overheat=true;draw();yes(!$('taSp').classList.contains('act'),'SP枯渇後は作動明滅しない');u.chargerOn=false;u.slots.sp.overheat=false;
      u.slots.sp=g.slotOf('charger');u.slots.sp.heat=37;g.toggleSp(u);g.physics(u,new g.T.Vector3(0,0,-1),true,false,.1,false);g.weaponsTick(u,.1,false,new g.T.Vector3(0,170,-100),0);draw();
      yes(u.chargerOn&&$('taSp').classList.contains('act')&&u.slots.sp.heat<37,'実際の特殊兵装起動とSP消費で明滅');u.slots.sp.cd=0;g.toggleSp(u);u.charging=false;
      u.dashState='';g.boosterFlameUpdate(u,.016);draw();
      u.dashState='short';u.dashT=.24;g.boosterFlameUpdate(u,.016);draw();
      let animation=$('taBoostFill').getAnimations()[0];yes(!!animation&&animation.effect.getTiming().duration===220&&animation.effect.getTiming().iterations===1,'実噴射開始で一回だけ短く明滅');
      animation.pause();animation.currentTime=0;const bright=+getComputedStyle($('taBoostFill')).opacity;animation.currentTime=110;
      yes(+getComputedStyle($('taBoostFill')).opacity<bright,'ブースト明滅の中間で暗くなる');draw();yes($('taBoostFill').getAnimations()[0]===animation,'HUD更新で明滅を再開しない');animation.finish();
      u.dashState='long';u.dashT=0;g.boosterFlameUpdate(u,.016);draw();yes(!$('taBoostFill').getAnimations().length,'ショートから巡航への移行で再明滅しない');
      u.overheat=true;yes(!g.shortDash(u,new g.T.Vector3(0,0,-1)),'燃料不足の噴射要求は不成立');g.boosterFlameUpdate(u,.016);draw();yes(!$('taBoostFill').getAnimations().length,'不成立の噴射要求では明滅しない');u.overheat=false;u.dashState='';
      u.slots.main=g.slotOf('gatling');u.weapon='main';u.switchT=0;u.slots.main.temp=50;draw();
      yes(!$('thermalReticle').hidden&&['trHeat0','trHeat1','trHeat2'].every(id=>+$(id).dataset.degrees===60),'熱50%で三本が各60度');
      for(const mode of ['standard','arcade','flight','mechanical','retro']){
        document.querySelector(`[data-console-choice="${mode}"]`).click();
        const colors=[0,25,50,75,99].map(temp=>{u.slots.main.temp=temp;draw();return getComputedStyle($('trHeat0')).stroke.match(/\d+/g).map(Number);});
        yes(colors[0].join(',')==='255,182,213'&&colors.every((c,i)=>c[0]===255&&(!i||c[1]<colors[i-1][1]&&c[2]<colors[i-1][2])),mode+'の熱量に合わせ桃色から赤へ段階的に変化');
      }
      Object.assign(u.slots.main,{temp:99,spin:1,cd:0});g.weaponsTick(u,.05,true,new g.T.Vector3(0,200,-100),0);draw();
      yes(u.slots.main.overheat&&['trHeat0','trHeat1','trHeat2'].every(id=>+$(id).dataset.degrees===120)&&!$('weaponAlert').hidden&&$('waLabel').textContent==='OVERHEAT','実過熱で120度×3の円が完成しOVERHEAT');
      const alertBox=()=>$('weaponAlert').getBoundingClientRect(),ohBox=alertBox(),ringBox=$('thermalReticle').getBoundingClientRect();
      yes(getComputedStyle($('trHeat0')).stroke==='rgb(255, 48, 48)'&&getComputedStyle($('waLabel')).fontSize==='16px'&&ohBox.bottom<ringBox.top-40,'実過熱は赤、OVERHEATの札は16pxで照準の円より上');
      const cool=+$('waSub').textContent.match(/COOLING ([\d.]+)s/)[1];g.weaponsTick(u,1,false,new g.T.Vector3(0,200,-100),0);draw();
      yes(Math.abs(cool-1-+$('waSub').textContent.match(/COOLING ([\d.]+)s/)[1])<.11&&parseFloat($('weaponAlert').style.getPropertyValue('--wa-p'))<100,'冷却の残り秒が減り、赤い地も減る');
      yes(+$('trHeat0').style.opacity<1&&+$('trHeat0').style.opacity>0&&Math.abs(+$('trHeat0').style.opacity-u.slots.main.ohT/u.slots.main.w.ohTime)<.01,'過熱の赤い円は冷却の残りに合わせて薄くなる');
      g.weaponsTick(u,u.slots.main.w.ohTime+.1,false,new g.T.Vector3(0,200,-100),0);draw();yes(!u.slots.main.overheat&&$('weaponAlert').hidden&&$('trHeat0').style.opacity==='','実冷却完了で過熱表示が消え、円の薄さも元に戻る');
      u.slots.main=g.slotOf('glint');u.weapon='main';
      const chargeIds=['trCharge0','trCharge1','trCharge2'],heatIds=['trHeat0','trHeat1','trHeat2'],aim=new g.T.Vector3(0,200,-100);
      g.weaponsTick(u,u.slots.main.w.chargeTime/2,true,aim,0);draw();
      yes(!$('thermalReticle').hidden&&chargeIds.every(id=>+$(id).dataset.degrees===60)&&heatIds.every(id=>+$(id).dataset.degrees===0)&&$('waLabel').textContent==='CHARGING'&&!/\d/.test($('waSub').textContent)&&!$('weaponAlert').querySelector('.wa-bar'),'過熱しない充填銃も実充填50%で共有円の三本が各60度、札はCHARGINGの文字だけ（％も棒も出さない）');
      const chargeBox=alertBox();yes(['left','top','width','height'].every(k=>Math.abs(chargeBox[k]-ohBox[k])<.5),'CHARGINGの札はOVERHEATと同じ位置・同じ大きさ');
      for(const mode of ['standard','arcade','flight','mechanical','retro']){document.querySelector(`[data-console-choice="${mode}"]`).click();draw();yes(chargeIds.every(id=>getComputedStyle($(id)).stroke==='rgb(125, 255, 176)'),mode+'のチャージは緑色');}
      g.weaponsTick(u,u.slots.main.w.chargeTime/2,true,aim,0);draw();
      yes(chargeIds.every(id=>+$(id).dataset.degrees===120)&&!u.slots.main.overheat&&$('waLabel').textContent==='FULL CHARGE'&&/^(HOLD |READY)/.test($('waSub').textContent),'満充填で緑の円が完成しても実過熱前はOVERHEATを出さず、FULL CHARGE');
      const fullBox=alertBox();yes(['left','top','width','height'].every(k=>Math.abs(fullBox[k]-ohBox[k])<.5),'FULL CHARGEの札もOVERHEATと同じ位置・同じ大きさ');
      const ammo=u.slots.main.ammo;g.weaponsTick(u,.016,false,aim,0);draw();
      yes(u.slots.main.ammo<ammo&&chargeIds.every(id=>+$(id).dataset.degrees===0),'実際に離して撃つと充填円を空に戻す');
      u.slots.main=g.slotOf('wave');for(let i=0;i<25;i++)g.weaponsTick(u,.05,true,aim,0);draw();
      yes(chargeIds.every(id=>+$(id).dataset.degrees===120)&&heatIds.some(id=>+$(id).dataset.degrees>0)&&!u.slots.main.overheat,'満充填の緑へ実保持時間の熱を同じ円で重ねる');
      for(let i=0;i<200&&!u.slots.main.overheat;i++)g.weaponsTick(u,.05,true,aim,0);draw();
      yes(u.slots.main.overheat&&heatIds.every(id=>+$(id).dataset.degrees===120)&&chargeIds.every(id=>+$(id).dataset.degrees===0)&&$('waLabel').textContent==='OVERHEAT','実保持過熱では共有円を赤く満たしてOVERHEAT');
      g.weaponsTick(u,u.slots.main.w.ohTime+.1,false,aim,0);draw();yes(!u.slots.main.overheat&&$('weaponAlert').hidden,'保持過熱の冷却完了で警告を解除');
      u.slots.aux=g.slotOf('waveSword');u.weapon='aux';u.swing=null;g.weaponsTick(u,u.slots.aux.w.chargeTime/2,true,aim,0);draw();
      yes(chargeIds.every(id=>+$(id).dataset.degrees===60)&&$('waLabel').textContent==='CHARGING','光波剣の実充填も同じ緑の円とCHARGINGの札で表示');
      u.slots.aux=g.slotOf('pike');u.slots.aux.chargeT=u.slots.aux.w.chargeTime;u.slots.aux.holdT=u.slots.aux.w.chargeHold/2;draw();
      yes(heatIds.every(id=>+$(id).dataset.degrees===60)&&chargeIds.every(id=>+$(id).dataset.degrees===120),'保持過熱の50%が満充填の緑と同じ円を共有');
      const slowBlink=+$('weaponAlert').dataset.blink;u.slots.aux.holdT=u.slots.aux.w.chargeHold*.9;draw();
      yes($('waLabel').textContent==='FULL CHARGE'&&slowBlink>0&&+$('weaponAlert').dataset.blink>slowBlink*2,'満充填は点滅し、保持の残りが減るほど点滅が速い');
      u.weapon='main';u.slots.main=g.slotOf('ar');draw();yes($('thermalReticle').hidden,'熱のない武器では熱リングを隠す');
      for(const v of g.units)if(v!==u)v.alive=false;for(const t of g.turrets)t.alive=false;
      Object.assign(u,{yaw:0,pitch:0,recoil:0,recoilYaw:0,alive:true,downT:0,stun:'',electricT:0,repairing:false,transfer:null,switchT:0});u.pos.set(0,160,0);u.group.position.copy(u.pos);
      Object.assign(e,{alive:true,downT:0,cloak:false});e.pos.set(0,160,-30);e.group.position.copy(e.pos);g.scene.updateMatrixWorld(true);
      g.camera.position.set(0,163,5);g.camera.lookAt(g.targetPoint(e));g.camera.updateMatrixWorld(true);
      g.lock.target=null;for(let i=0;i<8;i++)draw(.05);
      const pre=document.querySelector('.preLockMark.selected .cursor-outline');yes(!!pre&&pre.getAttribute('d').match(/[ML]/g).length===6,'捕捉可能な敵へ六角形プレロックを表示');
      g.toggleLock(u);const yaw=u.yaw,pitch=u.pitch;draw(0);
      yes(g.lock.target===e&&u.yaw===yaw&&u.pitch===pitch,'HUD更新が捕捉後の向きと照準を変えない');
      const mk=$('lockMark'),first=mk.querySelector('.lock-arm').getAttribute('d');for(let i=0;i<6;i++)draw(1/60);const middle=mk.querySelector('.lock-arm').getAttribute('d');for(let i=0;i<14;i++)draw(1/60);const last=mk.querySelector('.lock-arm').getAttribute('d');
      yes(first!==middle&&middle!==last&&+mk.dataset.progress===1,'三方向の赤線が回り込み回転して一度だけ収束');
      const numbers=d=>d.match(/-?\d+(?:\.\d+)?/g).map(Number),hex=numbers(mk.querySelector('.cursor-outline').getAttribute('d')),red=numbers(last),indices=[5,0,1];
      yes(red.every((n,i)=>Math.abs(n-hex[indices[Math.floor(i/2)]*2+i%2])<.002),'終点が六角形の短辺と斜辺に一致');
      for(const fps of [30,60,120]){
        g.lock.visualSeq++;g.camera.fov=g.gameOptions.fov;u.dashState='';draw(0);
        let elapsed=0;while(+mk.dataset.progress<1&&elapsed<.5){g.updateCamera(u,1/fps);draw(1/fps);elapsed+=1/fps;}
        yes(elapsed<=.35&&Math.abs(g.camera.fov-g.gameOptions.fov/1.3)<1,`${fps}fpsでズームの収束と同じ約0.3秒で赤線が完成`);
      }
      g.lock.visible=false;draw();g.lock.visible=true;draw();yes(mk.querySelector('.lock-arm').getAttribute('d')===last,'一時遮蔽から復帰しても再演出しない');
      u.slots.main=g.slotOf('gatling');u.slots.main.temp=50;draw();
      yes(Math.abs(parseFloat($('thermalReticle').style.left)-(g.targetPoint(e).project(g.camera).x+1)/2*innerWidth)<.1,'熱リングがロック対象のカーソルへ追従');
      g.showPage('pgOptions');$('overlay').hidden=false;draw();yes($('triangleAim').hasAttribute('hidden')&&$('thermalReticle').hidden&&mk.hidden,'メニューで中央表示と捕捉演出を隠す');
      $('overlay').hidden=true;draw();yes(+mk.dataset.progress===1,'メニュー復帰で捕捉演出を再開しない');
      u.alive=false;draw();yes($('triangleAim').hasAttribute('hidden')&&$('thermalReticle').hidden&&!$('taSp').classList.contains('act'),'大破時にゲージと明滅を解除');u.alive=true;
      u.weapon='main';u.slots.main=g.slotOf('ar');u.scoped=true;draw();yes(getComputedStyle($('triangleAim').querySelector('.ta-side')).display==='none'&&getComputedStyle($('taSp')).display!=='none','スコープ中は左右の計器を隠しSPを維持');u.scoped=false;
      return checks;
    });
    for(const [w,h]of [[3840,2160],[1920,1080],[1280,720],[960,540],[640,480]]){
      await page.setViewportSize({width:w,height:h});
      for(const mode of ['standard','arcade','flight','mechanical','retro']){
        const result=await page.evaluate(mode=>{
          const{g,u,$,draw}=triangleTest;dispatchEvent(new Event('resize'));document.querySelector(`[data-console-choice="${mode}"]`).click();draw();
          const svg=$('triangleAim'),bounds=svg.getBoundingClientRect(),r=Math.min(154,Math.max(78,innerHeight*.215));
          const lines=Object.fromEntries(['Ammo','Hp','Boost','Sp'].map(k=>{const el=$('ta'+k+'Bg'),length=el.getTotalLength();return[k,{a:el.getPointAtLength(0),b:el.getPointAtLength(length),length}];}));
          for(const k of ['Ammo','Hp']){
            const{a,b,length}=lines[k],distance=Math.abs(a.x*b.y-a.y*b.x)/length;
            if(Math.abs(distance-Math.max(r/2,innerHeight*.08))>.01||Math.abs(length-r*Math.sqrt(3)*.84)>.01)throw Error(k+'の接線配置と長さ');
            const text=$('ta'+k+'Text').transform.baseVal.consolidate().matrix,tx=text.a,ty=text.b,dx=b.x-a.x,dy=b.y-a.y;
            if(Math.abs(tx*dy-ty*dx)>.01)throw Error(k+'の文字がゲージと平行でない');
            const value=$('ta'+k+'Value'),label=$('ta'+k+'Label');
            if(value.parentElement!==label.parentElement||value.parentElement.tagName!=='text'||value.hasAttribute('y')||label.hasAttribute('y'))throw Error(k+'の文字が1行でない');
            if(parseFloat(getComputedStyle(value).fontSize)>=22||parseFloat(getComputedStyle(label).fontSize)>=12)throw Error(k+'の文字が一段小さくない');
          }
          const boost=lines.Boost,sp=lines.Sp;
          if(Math.abs(boost.length-lines.Ammo.length)>.01||Math.abs(boost.length-lines.Hp.length)>.01||Math.abs(boost.length-sp.length)>.01||Math.abs(boost.a.x-sp.a.x)>.01||Math.abs(boost.b.x-sp.b.x)>.01||sp.a.y<=boost.a.y)throw Error('4ゲージの長さとBOOST/SPの上下配置');
          return [...svg.querySelectorAll('text')].map(el=>({text:el.textContent,r:el.getBoundingClientRect()})).filter(({r})=>r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight).map(x=>x.text);
        },mode);assert.deepEqual(result,[],`${mode} ${w}x${h} の表示が画面内`);checks.push(`${mode} ${w}x${h} の接線・元の長さ・文字角度・上下配置・画面内を確認`);
      }
    }
    // 実際のコンソール選択と保存操作を使い、メカニカル専用倍率と下段の余白を確かめる。
    for(const [w,h]of [[3840,2160],[1920,1080],[1280,720],[960,540],[640,480]]){
      await page.setViewportSize({width:w,height:h});
      for(const size of [0,50,100]){
        const result=await page.evaluate(size=>{
          const{g,$,draw}=triangleTest;document.querySelector('[data-console-choice="mechanical"]').click();g.gameOptions.uiFit=1;g.gameOptions.uiSize=size;g.saveOptions();draw();
          const boxes=['pilot','status','mechBoost','consoleHeading','ammoBox'].map(id=>({id,r:$(id).getBoundingClientRect()}));
          const issues=[];for(let i=0;i<boxes.length;i++){
            const a=boxes[i];if(a.r.left<0||a.r.right>innerWidth+.5||a.r.top<0||a.r.bottom>innerHeight+.5)issues.push(a.id+'が画面外');
            for(const b of boxes.slice(i+1))if(Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>1&&Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>1)issues.push(a.id+'と'+b.id+'が重なる');
          }
          return{issues,zoom:+getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')};
        },size);
        assert.deepEqual(result.issues,[],`メカニカル ${w}x${h} UI${size}`);
        assert(Math.abs(result.zoom-Math.max(.6,Math.min(3,w/1600,h/900))*(.7+size*.006))<.002);
        checks.push(`メカニカル ${w}x${h} UI${size}：専用倍率で下段5欄が重ならず画面内`);
      }
    }
    assert(await page.evaluate(()=>{const{g,draw}=triangleTest;g.gameOptions.uiFit=0;g.gameOptions.uiSize=50;g.saveOptions();draw();return+getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')===1;}));checks.push('メカニカル自動調整OFFでは従来の等倍を維持');
    await page.evaluate(()=>{const{g}=triangleTest;g.gameOptions.uiFit=1;g.gameOptions.uiSize=50;g.saveOptions();});
    await page.emulateMedia({reducedMotion:'reduce'});
    assert(await page.evaluate(()=>{const{g,u,$,draw}=triangleTest;u.chargerOn=true;u.dashState='';g.boosterFlameUpdate(u,.016);draw();u.dashState='short';u.dashT=.24;g.boosterFlameUpdate(u,.016);draw();return getComputedStyle($('taSpFill')).animationName==='none'&&!$('taBoostFill').getAnimations().length;}));checks.push('動きを減らす設定でSPとブーストの明滅を止める');
    await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1280,height:720});
    for(const mode of ['standard','arcade','flight','mechanical','retro']){
      const shot=await browser.newPage({viewport:{width:1280,height:720}});
      shot.on('pageerror',e=>errors.push(e.message));await shot.route('https://**/*',r=>r.fulfill({body:''}));await shot.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
      await shot.goto(pathToFileURL(path.resolve(process.argv[2]||'dbg','dbg.html')).href);
      await shot.evaluate(mode=>{const g=__g;g.selectMap('city');document.getElementById('start').click();for(const u of g.units)u.frozen=true;document.querySelector(`[data-console-choice="${mode}"]`).click();g.loop(50);g.loop(100);g.loop(150);},mode);
      await shot.screenshot({path:path.join(out,mode+'.png')});await shot.close();
    }
    const mobile=await browser.newPage({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
    mobile.on('pageerror',e=>errors.push(e.message));await mobile.route('https://**/*',r=>r.fulfill({body:''}));await mobile.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
    await mobile.goto(pathToFileURL(path.resolve(process.argv[2]||'dbg','dbg.html')).href);
    const touch=await mobile.evaluate(()=>{
      const g=__g,$=id=>document.getElementById(id);g.selectMap('mesa');$('start').click();g.touchTick();g.hud(240,.016);
      const controls=[...document.querySelectorAll('[data-tc]')].filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect());
      const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
      return{visible:g.touchPlay&&!$('triangleAim').hasAttribute('hidden'),passThrough:getComputedStyle($('triangleAim')).pointerEvents==='none',clear:[...$('triangleAim').querySelectorAll('text')].every(el=>controls.every(r=>!overlap(el.getBoundingClientRect(),r)))};
    });assert(touch.visible&&touch.passThrough&&touch.clear,'タッチで中央計器が表示され操作ボタンを塞がない');checks.push('844x390タッチで三角計器が表示され操作ボタンを塞がない');await mobile.close();
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({checks,errors},null,2));console.log(checks.join('\n'));console.log('PASS '+checks.length);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
