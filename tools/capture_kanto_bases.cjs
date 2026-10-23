// 両基地の設備を本体の実描画で並べて確認する。地形とゲーム用HTMLは変更しない。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const folder=path.resolve(process.argv[2]||'mapdesign/kanto_half');

(async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const page=await browser.newPage({offline:true,viewport:{width:1600,height:900}});
    const errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
    await page.goto(pathToFileURL(path.join(folder,'play.html')).href);
    await page.waitForFunction(()=>window.__cityBattle,null,{timeout:60000,polling:100});
    const report=await page.evaluate(()=>{
      const g=__cityBattle,T=g.T;g.setup();g.running=false;
      g.loop(performance.now()+16);g.scene.fog=null;
      for(const u of g.units)u.group.visible=false;
      g.scene.traverse(o=>{if(o.userData?.ref?.kind==='umbrella')o.visible=false;});
      for(const el of document.querySelectorAll('body *')){
        if(el!==g.renderer.domElement&&!el.contains(g.renderer.domElement))el.style.visibility='hidden';
      }
      g.renderer.setPixelRatio(1);g.renderer.setSize(1600,900,false);
      g.renderer.autoClear=false;g.renderer.setScissorTest(false);g.renderer.clear();
      g.scene.updateMatrixWorld(true);
      const overlay=document.createElement('div');
      overlay.style.cssText='position:fixed;inset:0;color:white;font-family:system-ui,sans-serif;pointer-events:none';
      const label=(text,x,y,color,size=18)=>{
        const e=document.createElement('span');e.textContent=text;
        e.style.cssText=`position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);background:#102027e8;color:${color};border:1px solid ${color};border-radius:4px;padding:3px 5px;white-space:nowrap;font-size:${size}px;font-weight:650`;
        overlay.append(e);
      };
      const panels=[];
      for(const [index,team]of ['B','R'].entries()){
        const base=g.city.base(team),sign=team==='B'?1:-1;
        const x=base.at[0],z=base.at[1],half=49;
        const camera=new T.OrthographicCamera(-half,half,half*900/800,-half*900/800,.1,1000);
        camera.position.set(x,250,z);camera.up.set(0,0,-sign);camera.lookAt(x,0,z);
        camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
        g.renderer.setScissorTest(true);g.renderer.setScissor(index*800,0,800,900);
        g.renderer.setViewport(index*800,0,800,900);g.renderer.render(g.scene,camera);
        label(team==='B'?'青基地':'橙基地',index*800+400,33,team==='B'?'#65c5ff':'#ffb35d',26);
        const markers=[{label:'コア',pos:new T.Vector3(x,0,z),color:'#f7f8fa'},
          ...g.catapults.filter(p=>!p.plant&&p.side===team).map((p,i)=>({label:'射'+(i+1),pos:p.pos,color:'#d9adff'})),
          ...g.pods.filter(p=>p.team===team).map((p,i)=>({label:'補'+(i+1),pos:p.pos,color:'#8ff2b9'})),
          ...g.turrets.filter(p=>p.team===team).map((p,i)=>({label:'砲'+(i+1),pos:p.pos,color:'#ffd66a'})),
          ...g.radars.filter(p=>p.team===team).map(p=>({label:'レーダー',pos:p.pos,color:'#c4e4ff'}))];
        for(const m of markers){
          const p=m.pos.clone().setY(0).project(camera);
          label(m.label,index*800+(p.x+1)*400,(1-p.y)*450+23,m.color);
        }
        panels.push({team,base:base.at,markers:markers.map(m=>({label:m.label,at:m.pos.toArray()})),view:'自軍の前方が画像上側'});
      }
      g.renderer.setScissorTest(false);
      const divider=document.createElement('div');divider.style.cssText='position:absolute;left:798px;top:0;bottom:0;width:4px;background:#102027';overlay.append(divider);
      label('射：カタパルト　補：リペアポッド　砲：防衛砲台',800,840,'#eaf2f5',20);
      label('設備確認用の俯瞰：コアの傘と機体のみ撮影時に非表示',800,875,'#eaf2f5',16);
      document.body.append(overlay);
      return {map:g.curMap.name,panels,geometryOrPhysicsChanges:false,
        captureOnlyChanges:['霧を非表示','コアの傘を非表示','機体を非表示','施設ラベルを追加']};
    });
    await page.screenshot({path:path.join(folder,'bases.png')});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const htmlSHA256=createHash('sha256').update(fs.readFileSync(path.join(folder,'play.html'))).digest('hex');
    fs.writeFileSync(path.join(folder,'bases-capture-check.json'),JSON.stringify({...report,htmlSHA256,errors,externalRequests:external},null,2)+'\n');
    console.log('両基地の配置画像を保存: '+path.join(folder,'bases.png'));
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
