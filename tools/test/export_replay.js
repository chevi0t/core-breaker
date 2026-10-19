// 保存済みの観測データを再計算せず、閲覧HTMLとPNG、任意で5倍速動画を作る。
// node tools/test/export_replay.js 記録.json 出力フォルダ [試合番号0始まり] [--video]
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright');
const [input,output,indexArg='1']=process.argv.slice(2).filter(a=>!['--video','--mobility'].includes(a));
const mobility=process.argv.includes('--mobility');
if(!input || !output)throw new Error('観測JSONと出力フォルダを指定してください');
const data=JSON.parse(fs.readFileSync(input,'utf8')),index=Number(indexArg);
if(!Number.isInteger(index) || index<0 || index>=data.matches.length)throw new Error('試合番号が範囲外です');
fs.mkdirSync(output,{recursive:true});
const template=fs.readFileSync(path.join(__dirname,'battle_viewer.html'),'utf8');
const html=path.resolve(output,'replay.html');fs.writeFileSync(html,template.replace('/*__BATTLE_DATA__*/',JSON.stringify(data).replace(/</g,'\\u003c')));
(async()=>{
  let browser,encoder;
  try{
    browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
    const page=await browser.newPage({viewport:{width:1280,height:1280}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('file://'+html);await page.waitForFunction(()=>!!window.__replay);
    await page.selectOption('#match',String(index));
    await page.evaluate(({i,mobility})=>{const events=__replay.data.matches[i].events,e=events.find(e=>e.type===(mobility?'liftExit':'coreHit'))||events.find(e=>e.type==='padLand');if(e){__replay.focusEvent(e);__replay.seek(e.t);}document.querySelector('#trails').value='sortie';}, {i:index,mobility});
    await page.screenshot({path:path.join(output,'preview.png'),fullPage:true});
    if(process.argv.includes('--video')){
      const fps=8,speed=5,frames=Math.ceil(data.matches[index].seconds/speed*fps);
      encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-threads','2','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',path.resolve(output,'preview.mp4')],{stdio:['pipe','ignore','inherit']});
      let encoderError=null;encoder.on('error',e=>encoderError=e);encoder.stdin.on('error',e=>encoderError=e);
      const done=once(encoder,'close');
      await page.evaluate(()=>{document.querySelector('#speed').value='5';document.querySelector('.tag').textContent='5倍速プレビュー／本編は停止・巻き戻し可';document.querySelector('#trails').value='30';});
      for(let frame=0;frame<=frames;frame++){
        if(encoderError)throw encoderError;
        await page.evaluate(({t,i,mobility})=>{const e=__replay.data.matches[i].events.filter(e=>(mobility?!!e.facility:e.type==='coreHit')&&e.t<=t).at(-1);if(e&&__replay.selected!==e.unit)__replay.selectUnit(e.unit);__replay.seek(t);},{t:Math.min(frame/fps*speed,data.matches[index].seconds),i:index,mobility});
        const png=await page.screenshot({type:'png'});
        if(!encoder.stdin.write(png))await Promise.race([once(encoder.stdin,'drain'),done.then(()=>{throw new Error('動画エンコーダーが途中終了しました');})]);
        if(frame%80===0)console.log(`動画 ${frame}/${frames}`);
      }
      encoder.stdin.end();const [code]=await done;if(code!==0)throw new Error('ffmpeg の終了コード '+code);
    }
    if(errors.length)throw new Error(errors.join('\n'));
    console.log('保存済みデータから閲覧用ファイルを作成、ページエラー0');
  }finally{if(encoder && !encoder.stdin.destroyed)encoder.stdin.end();if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
