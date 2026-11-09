// 実Recorder→製品DEFLATE→標準zlib/Pythonの独立復元。通信や実clipboardは使わない。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),z=require('node:zlib');
const {Recorder,Pack,compressData,COMPRESSED_LIMITS}=require('./online_diagnostic_fixture');
const {setup,lobby,playing,fixtures,heavy}=require('./online_diagnostic_compression_fixtures');
const root=path.resolve(__dirname,'../..'),clone=x=>JSON.parse(JSON.stringify(x));
function decodeJS(text){const [prefix,method,size,crc,encoded]=text.split('.');assert.equal(prefix,'CBL2');assert.equal(method,'D');const packed=z.inflateRawSync(Buffer.from(encoded,'base64url'),{maxOutputLength:COMPRESSED_LIMITS.packed});assert.equal(packed.length,parseInt(size,36));return clone(Pack.unpack(JSON.parse(packed)));}
function decodePython(text){return JSON.parse(cp.execFileSync('python3',['tools/decode_diagnostic_log.py'],{cwd:root,input:text,maxBuffer:2*1024*1024,stdio:['pipe','pipe','pipe']}).toString());}
test('4場面と3接続・保存上限付近の全データを欠損なしで復元',()=>{
 for(const [name,r]of Object.entries({...fixtures(),heavy:heavy()})){
  const detail=r.preview(),json=r.json(),text=r.compressed(),original=JSON.parse(json);assert.deepEqual(decodeJS(text),original,name);assert.deepEqual(decodePython(text),original,name);assert.equal(r.preview(),detail);assert.equal(r.json(),json);assert(text.length<detail.length*.1);assert(text.length<=COMPRESSED_LIMITS.text);assert(/^[A-Za-z0-9_.-]+$/.test(text));
 }
});
test('null・0・counterキー欠落と全境界/イベント順を保持',()=>{
 const h=setup();const s=playing();s.diagnostic.fps=0;s.diagnostic.rttMs=null;s.diagnostic.corrections.reasons={distance:0,history:2};s.transport.snapshotDrops={stale:0};h.begin(s);h.tick(20);h.r.checkpoint('match_finished','none',s);h.tick(20);h.r.end('host_timeout',s);const d=decodePython(h.r.compressed());assert.deepEqual(d,JSON.parse(h.r.json()));const first=d.sessions[0].samples[0].data;assert.equal(first.fps,0);assert.equal(first.rttMs,null);assert.deepEqual(first.corrections.reasons,{distance:0,history:2});assert(!Object.hasOwn(first.transport.snapshotDrops,'artificial'));assert.equal(d.sessions[0].lastConnection.reason,'host_timeout');
});
test('圧縮前の未知項目・私的文字列・型違い・過大配列は黙って落とさず拒否',()=>{
 const original=JSON.parse(fixtures().playing.json());
 const mutations=[o=>o.secret='PRIVATE',o=>o.sessions[0].samples[0].data.secret=1,o=>delete o.sessions[0].samples[0].data.fps,o=>o.sessions[0].samples[0].data.fps=NaN,o=>o.sessions[0].samples[0].data.fps=-1,o=>o.sessions[0].samples[0].data.humans=101,o=>o.sessions[0].samples[0].data.phase='PRIVATE',o=>o.sessions[0].version='Ver1234567',o=>o.sessions[0].samples[0].data.transport.rtt.count=true,o=>o.sessions[0].samples[0].data.transport.snapshotDrops.stale=null,o=>o.sessions[0].samples[0].data.transport.inputDrops.PRIVATE=0,o=>o.sessions.push(o.sessions[0],o.sessions[0],o.sessions[0]),o=>o.sessions[0].samples=Array(301).fill(o.sessions[0].samples[0]),o=>o.sessions[0].events=Array(129).fill(o.sessions[0].events[0]),o=>Object.defineProperty(o.sessions[0],'private',{value:'secret'}),o=>Object.defineProperty(o.sessions[0],'role',{get(){throw Error('getter must not run');}})];
 for(const mutation of mutations){const v=clone(original);mutation(v);assert.throws(()=>compressData(v,['mesa']));}
 for(const value of [null,[],['CBP2',[]],['CBP1',[]],['CBP1',[true,[]]],['CBP1',[1,[]],1]])assert.throws(()=>Pack.unpack(value));
});
test('実収集/保存復元の秘匿済みデータだけを圧縮し過去接続も残す',()=>{
 const secret='PRIVATE_ROOM_192.0.2.1_PEER_NAME_CHAT_SDP_ERROR',h=setup('host'),sample={...lobby(),roomId:secret,name:secret,chat:secret,diagnostic:{fps:secret},transport:{peers:[{id:secret}]}};h.begin(sample);h.r.event(secret,secret,sample);h.r.end('local_leave',sample);h.tick(1);h.begin(sample);const d=decodePython(h.r.compressed());assert.equal(d.sessions.length,2);assert(!JSON.stringify(d).includes(secret));
});
test('期限をまたいでも圧縮と詳細は単一snapshot・7日超の解析は可能',()=>{
 const h=setup();h.begin(playing());h.r.end('local_leave',playing());const capture=h.r.capture(),packed=decodePython(capture.compressed),detail=JSON.parse(capture.detail.slice(capture.detail.indexOf('{')));for(const s of detail.sessions)delete s.startedUtc;assert.equal(packed.role,detail.sessions[0].role);assert.equal(packed.representative.fps,detail.sessions[0].samples.at(-1).data.fps);h.tick(8*86400000);assert.equal(h.r.sessions.length,1);assert.deepEqual(decodePython(capture.compressed),packed);assert.equal(decodeJS(h.r.compressed()).sessions.length,0);
});
test('ネイティブCompressionStream・btoa・cryptoなしでも同期圧縮',()=>{
 const vm=require('node:vm'),src=fs.readFileSync(path.join(root,'prototype/online/game.js'),'utf8').split('/* #212 ブラウザホスト試作。')[0],c={module:{exports:{}},TextEncoder,performance,Date};vm.runInNewContext(src,c);const r=new c.module.exports.Recorder({maps:['mesa'],now:()=>1800000000000,monotonic:()=>0});r.begin({role:'host',version:'Ver179',protocol:9},lobby());const result=r.compressed();assert.equal(typeof result,'string');assert.equal(decodeJS(result).sessions[0].role,'host');
});
test('Python CLIの入力/展開/型/破損/出力ファイル安全性を検査',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cb-log-')),r=fixtures().playing,text=r.compressed();try{
  fs.writeFileSync(path.join(dir,'input.txt'),text);fs.writeFileSync(path.join(dir,'raw.json'),r.json());cp.execFileSync('python3',['tools/test/online_diagnostic_decode_test.py',path.join(dir,'input.txt'),path.join(dir,'raw.json')],{cwd:root,maxBuffer:200000,stdio:['pipe','pipe','pipe']});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('出力/展開上限超過時は切り捨てず失敗し詳細保存を残す',()=>{
 const r=fixtures().playing,raw=r.json(),textLimit=COMPRESSED_LIMITS.text,packedLimit=COMPRESSED_LIMITS.packed;
 try{COMPRESSED_LIMITS.text=10;assert.throws(()=>r.compressed());const captured=r.capture();assert(!captured.error);assert(captured.compressed.startsWith('CBL3.'));assert(captured.detail.includes('sentBytes'));COMPRESSED_LIMITS.text=textLimit;COMPRESSED_LIMITS.packed=10;assert.throws(()=>r.compressed());assert.equal(r.json(),raw);}finally{COMPRESSED_LIMITS.text=textLimit;COMPRESSED_LIMITS.packed=packedLimit;}
});
