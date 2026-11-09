const {test}=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),z=require('node:zlib');
const {Recorder,SHARE_LIMIT}=require('./online_diagnostic_fixture'),{fixtures,heavy,setup,playing,lobby}=require('./online_diagnostic_compression_fixtures');
const decode=text=>JSON.parse(cp.execFileSync('python3',['tools/decode_diagnostic_log.py'],{input:text,stdio:['pipe','pipe','pipe']}).toString());
function start(h,d=playing()){h.begin(d);h.r.checkpoint('match_started','none',d);}
test('F8用の最小・ロビー・試合・切断・異常・保持上限は241字以内/無改行/可逆、詳細は不変',()=>{
 assert.equal(SHARE_LIMIT,241);
 for(const [name,r]of Object.entries({empty:setup().r,...fixtures(),heavy:heavy()})){const raw=r.json(),detail=r.preview(),text=r.share(),d=decode(text);assert(text.length<=241,name+': '+text.length);assert(!/[\r\n]/.test(text));assert.equal(d.format,'CBM1');assert.equal(d.selectedOnly,true);assert(d.omitted.includes('other matches'));assert.equal(r.json(),raw);assert.equal(r.preview(),detail);const payload=Buffer.from(text.split('.').at(-1),'base64url');assert.equal(text.split('.')[1]==='Z'?z.inflateRawSync(payload).length:payload.length,152);}
});
test('現在の試合だけを集計し終了後も直前の試合だけ。古い試合/ロビー/接続の値は混ぜない',()=>{
 const h=setup();start(h);let old=playing();old.diagnostic.snapshotAgeMs=999999;h.tick(2000);h.r.sample(old);h.r.checkpoint('match_finished','none',old);h.tick(2000);h.r.sample(lobby(),true);h.tick(2000);const current=playing();current.transport.queue=2;current.transport.bufferedBytes=22;current.transport.maxQueue=999999;current.transport.maxBufferedBytes=999999;h.r.checkpoint('match_started','none',current);h.tick(2000);h.r.sample(current);let d=decode(h.r.share());assert.equal(d.scope,'current_match');assert.equal(d.durationMs,2000);assert.equal(d.extrema.snapshotAgeMaxMs,25);assert.equal(d.extrema.queueMax,2);assert.equal(d.extrema.bufferedMaxBytes,22);
 h.r.checkpoint('match_interrupted','host_timeout',current);h.tick(2000);h.r.sample({...old,phase:'lobby'},true);d=decode(h.r.share());assert.equal(d.scope,'last_match');assert.equal(d.durationMs,2000);assert.equal(d.extrema.snapshotAgeMaxMs,25);assert.equal(d.event.reason,'host_timeout');
 h.r.end('local_leave',lobby());h.tick(2);start(h);d=decode(h.r.share());assert.equal(d.scope,'current_match');assert.equal(d.durationMs,0);assert.equal(d.event.reason,'none');assert.equal(d.faultCount,0);
});
test('直近の障害コード・障害時観測・今回の極値を残し、後続の正常イベントで隠さない',()=>{
 const h=setup();start(h);h.tick(2000);const a=playing();a.diagnostic.fps=12.5;a.diagnostic.snapshotAgeMs=700;a.diagnostic.corrections.maxM=4;a.transport.rtt={count:1,maxMs:600};h.r.checkpoint('transport_error','send_failed',a);h.tick(2000);h.r.checkpoint('page_visible','none',playing());const d=decode(h.r.share());assert.equal(d.event.code,'transport_error');assert.equal(d.event.reason,'send_failed');assert.equal(d.event.elapsedMs,2000);assert.equal(d.representative.elapsedMs,2000);assert.equal(d.representative.fps,12.5);assert.equal(d.representative.snapshotAgeMs,700);assert.equal(d.extrema.fpsMin,12.5);assert.equal(d.extrema.rttMaxMs,600);assert.equal(d.faultCount,1);
});
test('開始境界を失った記録は1時点に限定し欠落を明示、未出撃・空記録は区別',()=>{
 const h=setup();start(h);h.tick(2000);const old=playing();old.diagnostic.snapshotAgeMs=999999;h.r.sample(old);h.tick(2000);h.r.sample(playing());h.r.active.events=[];h.r.active.droppedEvents=1;const d=decode(h.r.share());assert(d.scopeBoundaryMissing);assert(d.retentionDropped);assert.equal(d.durationMs,null);assert.equal(d.observationCount,1);assert.equal(d.extrema.snapshotAgeMaxMs,25);assert.equal(decode(fixtures().lobby.share()).scope,'no_match');h.r.clear();assert.equal(decode(h.r.share()).scope,'no_session');
});
test('別タブが新しくても現画面の接続を優先。退出直後も同じ接続で他タブを採らない',()=>{
 const a=setup('host');start(a,{...playing(),role:'host'});const b=setup();b.tick(1);start(b);a.r.sessions.push(b.r.active);assert.equal(decode(a.r.share()).role,'host');a.r.end('local_leave',{...playing(),role:'host'});assert.equal(decode(a.r.share()).role,'host');
});
test('再試合の準備失敗や開始待機に前の試合を混ぜない',()=>{
 const h=setup();start(h);h.tick(2000);const old=playing();old.diagnostic.snapshotAgeMs=999999;h.r.checkpoint('match_finished','none',old);h.tick(2000);h.r.checkpoint('preparation_aborted','prepare_timeout',{...playing(),phase:'preparing'});let d=decode(h.r.share());assert.equal(d.scope,'no_match');assert.equal(d.extrema.snapshotAgeMaxMs,25);assert.equal(d.event.reason,'prepare_timeout');h.tick(2000);h.r.sample({...playing(),phase:'countdown'},true);d=decode(h.r.share());assert.equal(d.scope,'no_match');assert.equal(d.extrema.snapshotAgeMaxMs,25);
});
test('0と未取得を区別し、無効値・個人情報は復元先にも出さない',()=>{
 const h=setup('host'),secret='SECRET_IP_192.0.2.1_ROOM_NAME_SDP_CHAT';const s=playing();s.roomId=secret;s.name=secret;s.diagnostic.fps=0;s.diagnostic.snapshotAgeMs=NaN;s.diagnostic.rttMs=secret;s.transport.rtt={count:0};s.transport.queue=Infinity;s.transport.bufferedBytes=-1;start(h,s);h.r.event(secret,secret,s);const t=h.r.share(),d=decode(t);assert(!JSON.stringify(d).includes(secret));assert.equal(d.representative.fps,0);assert.equal(d.extrema.snapshotAgeMaxMs,null);assert.equal(d.extrema.rttMaxMs,null);assert.equal(d.extrema.queueMax,null);assert.equal(d.extrema.bufferedMaxBytes,null);assert.equal(d.event.reason,'other');
});
test('全数値最大/高エントロピーでも固定152バイトで上限を保証しFloat64を復元',()=>{
 let seed=12345;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.round(seed/2**32*1e12*1000)/1000;};
 for(let i=0;i<30;i++){const h=setup();let s=playing();s.diagnostic.fps=i?9999.123:0;s.diagnostic.frame.maxMs=i?rnd():1e12;s.cpu.maxMs=i?rnd():1e12;s.transport.rtt={count:1,maxMs:i?rnd():1e12};s.diagnostic.snapshotAgeMs=i?rnd():1e12;s.diagnostic.corrections.maxM=i?rnd():1e12;s.diagnostic.corrections.hardSnaps=i?rnd():1e12;s.transport.queue=i?rnd():1e12;s.transport.bufferedBytes=i?rnd():1e12;start(h,s);const t=h.r.share(),d=decode(t);assert(t.length<=219);assert.equal(d.extrema.correctionMaxM,s.diagnostic.corrections.maxM);assert.equal(d.extrema.snapshotAgeMaxMs,s.diagnostic.snapshotAgeMs);assert.equal(d.extrema.bufferedMaxBytes,s.transport.bufferedBytes);}
});
