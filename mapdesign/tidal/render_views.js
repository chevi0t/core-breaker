// 登録マップを本体の描画で撮る。基地図と並べて建材・遮蔽を確認する。
const path=require('node:path'),{chromium}=require('playwright'),{openMap}=require('../../tools/mapgen_browser');
(async()=>{
  const browser=await chromium.launch();
  try{
    for(const [name,position,target] of [
      ['base-blue',[150,170,690],[0,0,492]],['base-orange',[-150,170,-690],[0,0,-492]],
      ['factory',[200,180,170],[0,3,380]],['housing',[-200,170,-180],[0,3,-380]],
      ['mountain',[-280,110,-365],[-120,5,-462]],
      ['central-bridge',[-280,290,340],[-5,5,0]],['frontline',[-220,150,200],[-45,10,85]],
      ['approach-blue',[200,190,420],[-15,4,258]],['approach-orange',[-220,220,-370],[12,5,-170]]]){
      if(process.argv[3]&&!process.argv[3].split(',').includes(name))continue;
      const {page,errors}=await openMap(browser,'tidal',null,1,{silent:true,debugDir:process.argv[2]||'dbg'});
      const version=await page.evaluate(()=>__g.curMap.generation.version);
      await page.setViewportSize({width:1200,height:700});
      await page.evaluate(({position,target})=>{
        const g=__g,canvas=g.renderer.domElement;document.body.replaceChildren(canvas);document.body.style.margin='0';
        g.scene.fog=null; // 建材と内部配置を確認する俯瞰画像では霧だけ省く。
        for(const u of g.units)u.group.visible=false;
        g.camera.fov=55;g.camera.aspect=1200/700;g.camera.far=2000;
        g.camera.position.set(...position);g.camera.lookAt(...target);g.camera.updateProjectionMatrix();
        g.renderer.setSize(1200,700);g.renderer.render(g.scene,g.camera);
      },{position,target});
      if(errors.length)throw new Error(errors.join('\n'));
      await page.screenshot({path:path.join(__dirname,'v'+version,`${name}.png`)});await page.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
