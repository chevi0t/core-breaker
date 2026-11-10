// 実CDNの応答をSHA-384で検査し、file://からSRI成功/不一致拒否を確かめる。
// node tools/test/sri_check.js [dbg] [出力先]
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {check}=require('./lib');
const cached=process.argv.includes('--cached-response');
check('外部スクリプトのSRI',async({browser,out,ok})=>{
  const html=fs.readFileSync('prototype/index.html','utf8');
  const tags=[...html.matchAll(/<script\b[^>]*\bsrc="(https:[^"]+)"[^>]*><\/script>/g)];
  ok(tags.length===2,'外部スクリプトはthree.jsとPeerJSの2本');
  const bodies=new Map();
  const report={browserNetworkMode:cached?'実CDNから取得したバイトとCORS応答をPlaywrightで再現。ブラウザのCDN直接接続は未確認':'ブラウザからCDNへ直接接続',checkedAt:new Date().toISOString(),method:'SHA-384 of actual decoded HTTP response body; file:// browser import with crossorigin=anonymous',scripts:[]};
  for(const [tag,url] of tags){
    const integrity=tag.match(/\bintegrity="([^"]+)"/)?.[1];
    ok(/^sha384-/.test(integrity||'')&&/\bcrossorigin="anonymous"/.test(tag),'SRI SHA-384とanonymous CORSを指定: '+url);
    const r=await fetch(url,{headers:{Origin:'null'},signal:AbortSignal.timeout(30000)});
    ok(r.ok,'CDNの応答成功: '+url);
    const body=Buffer.from(await r.arrayBuffer()),computed='sha384-'+crypto.createHash('sha384').update(body).digest('base64');
    ok(computed===integrity,'実際の配信バイトとintegrityが一致: '+url);
    ok(r.headers.get('access-control-allow-origin')==='*','CDNがfile://のnull originをCORSで許可: '+url);
    bodies.set(url,{body,headers:{'access-control-allow-origin':r.headers.get('access-control-allow-origin'),'content-type':r.headers.get('content-type')}});
    report.scripts.push({url,finalUrl:r.url,bytes:body.length,integrity,accessControlAllowOrigin:r.headers.get('access-control-allow-origin')});
  }
  fs.mkdirSync(out,{recursive:true});
  const good=path.join(out,'sri-valid.html');fs.writeFileSync(good,'<!doctype html><meta charset="utf-8">'+tags.map(x=>x[0]).join('\n'));
  const p=await browser.newPage();const errors=[],network=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')network.push(m.text());});p.on('requestfailed',r=>network.push(r.url()+': '+r.failure()?.errorText));
  if(cached)for(const [url,response]of bodies)await p.route(url,r=>r.fulfill(response));
  await p.goto(pathToFileURL(good).href,{waitUntil:'load',timeout:45000});
  const loaded=await p.evaluate(()=>({three:window.THREE?.REVISION,peer:typeof window.Peer}));if(loaded.three!=='128'||loaded.peer!=='function')console.log('CDNブラウザ診断',JSON.stringify({loaded,network,errors}));
  ok(loaded.three==='128'&&loaded.peer==='function','file://で両スクリプトがSRI付きで実行される（'+(cached?'取得済みCDN応答の再現':'CDN直接')+'）');
  ok(errors.length===0,'正しいSRIのページにJavaScriptエラーなし');await p.close();
  const bad=path.join(out,'sri-invalid.html');fs.writeFileSync(bad,'<!doctype html>'+tags[0][0].replace(/integrity="[^"]+"/,'integrity="sha384-'+ 'A'.repeat(64)+'"'));
  const q=await browser.newPage();const blocked=[];q.on('console',m=>{if(m.type()==='error')blocked.push(m.text());});
  if(cached)for(const [url,response]of bodies)await q.route(url,r=>r.fulfill(response));
  await q.goto(pathToFileURL(bad).href,{waitUntil:'load',timeout:45000});
  ok(await q.evaluate(()=>typeof window.THREE==='undefined'),'誤ったSRIではスクリプトを実行しない');
  ok(blocked.some(s=>/integrity|digest/i.test(s)),'ブラウザがSRI不一致を理由にブロック');await q.close();
  report.browser={validLoaded:true,wrongIntegrityBlocked:true,version:browser.version()};
  fs.writeFileSync(path.join(out,'sri-result.json'),JSON.stringify(report,null,2));
},{page:false});
