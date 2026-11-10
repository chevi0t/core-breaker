// 公式fflate 0.8.3の同期圧縮依存部分を抽出。アルゴリズム本文は変えない。
const fs=require('node:fs'),crypto=require('node:crypto'),{stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(process.argv[2],'utf8'),license=fs.readFileSync(process.argv[3],'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
if(sha(source)!=='1addfe34aa01d4998853dc5cf2430df14e294889d1ae7420341103eb5b1c2720'||sha(license)!=='766daa9b2ab0ab2698c769f334a6d72c42437b0a7d0d0dfd5c13c64b3120117b')throw Error('固定版の公式ソース/ライセンスと一致しません');
let js=stripTypeScriptTypes(source,{mode:'transform'});
const span=(a,b)=>{const start=js.indexOf(a),end=js.indexOf(b,start);if(start<0||end<=start)throw Error('公式ソースの構造が変わりました');return js.slice(start,end);};
let code=span('const u8 =','const inflt =')+span('const wbits =','const adler =')+span('const dopt =','const mrg =')+span('export function deflateSync','export class Inflate');
code=code.replace(/\bexport /g,'');
const output='  // BEGIN fflate 0.8.3 synchronous DEFLATE / dcb3714a6c25db3a2748641019c5277413d09714\n  /*\n'+license+'\n  */\n  const diagnosticDeflate=(()=>{\n'+code+'\nreturn {deflate:data=>deflateSync(data,{level:9,mem:8}),crc32:data=>{const c=crc();c.p(data);return c.d()>>>0;}};\n})();\n  // END fflate synchronous DEFLATE\n';
if(process.argv[4]==='--check'){const product=fs.readFileSync(require.resolve('../../prototype/online/diagnostics.js'),'utf8');if(!product.includes(output))throw Error('同梱コードが生成結果と違います');console.log('固定版fflateの生成・同梱一致');}else{if(!process.argv[4])throw Error('出力先または--checkを指定してください');fs.writeFileSync(process.argv[4],output);}
