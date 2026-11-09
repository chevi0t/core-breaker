// 掲示板用の要約。保存/詳細JSONを削らず、重複窓の合算と未取得=0を避ける。
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Recorder,KEY}=require('./online_diagnostic_fixture');
const {setup,lobby,playing,fixtures}=require('./online_diagnostic_summary_fixtures');
test('ロビー・試合中・切断・異常の短縮例と詳細不変',()=>{
 for(const [name,r]of Object.entries(fixtures())){const before=r.preview(),json=r.json(),text=r.summary();assert.equal(r.preview(),before);assert.equal(r.json(),json);assert(text.length<1600,name+': '+text.length);assert(text.length<before.length*.2);assert(!/null|undefined|NaN/.test(text));assert.match(text,/Ver179.*通信v9/);assert.match(text,/2026-11-09T12:00:00.000Z/);}
 const f=fixtures();assert.match(f.lobby.summary(),/HOST.*ロビー.*人間1\/4人/);assert(!/FPS|p95|予測停止|未ACK/.test(f.lobby.summary()));assert.match(f.playing.summary(),/GUEST.*試合中/);assert.match(f.playing.summary(),/補正最大 0.15m/);assert.match(f.disconnect.summary(),/切断\[ホスト応答途絶;host_timeout\]/);assert.match(f.disconnect.summary(),/接続終了/);assert.match(f.abnormal.summary(),/FPS最低 12.5/);assert.match(f.abnormal.summary(),/補正最大 4m/);assert.match(f.abnormal.summary(),/強制補正 2回\/2秒/);assert.match(f.abnormal.summary(),/RTT最大 600ms/);assert.match(f.abnormal.summary(),/人工写真欠損 10%/);assert.match(f.abnormal.summary(),/通信エラー\[送信失敗;send_failed\]/);
});
test('反復する2秒窓の補正や試合別累計を合算しない',()=>{
 const h=setup();const d=playing();d.diagnostic.corrections.hardSnaps=2;d.diagnostic.corrections.reasons={distance:2};h.begin(d);for(let i=0;i<8;i++){h.tick(50);h.r.sample(d,true);}assert.match(h.r.summary(),/強制補正 2回\/2秒/);assert.match(h.r.summary(),/距離差 2/);assert.match(h.r.summary(),/写真受理 300/);assert(!h.r.summary().includes('写真受理 2700'));
});
test('ロビー長時間待機後も試合終端の計測を日時つきで残す',()=>{
 const h=setup();h.begin(playing());h.tick(10000);h.r.checkpoint('match_finished','none',playing());for(let i=0;i<350;i++){h.tick(2000);h.r.sample({...lobby(),role:'guest'});}const t=h.r.summary();assert.match(t,/GUEST.*ロビー/);assert.match(t,/試合計測 \+10秒/);assert.match(t,/FPS 59.9/);assert.match(t,/保持上限で省略/);assert(!t.includes('試合計測なし'));
});
test('同時刻の境界より最新標本の状態を優先し、復元値を現在接続中と称さない',()=>{
 const h=setup();h.begin(playing());h.tick(10000);h.r.checkpoint('match_finished','none',playing());h.r.sample({...lobby(),role:'guest'},true);assert.match(h.r.summary(),/GUEST.*ロビー/);
 const store={getItem:()=>h.r.json(),setItem(){}};const r=new Recorder({storage:store,now:()=>Date.parse('2026-11-09T12:01:00Z'),maps:['mesa']});assert.match(r.summary(),/終了記録なし/);assert(!r.summary().includes('接続中'));assert.match(r.summary(),/試合計測 \+10秒/);
});
test('最新別タブの復元記録に自分のHOST/GUESTをすり替えない',()=>{
 const h=setup('host');h.begin(lobby());const other=setup();other.tick(1);other.begin(playing());h.r.sessions.push(other.r.active);assert.match(h.r.summary(),/HOST.*ロビー/);h.r.active=null;assert.match(h.r.summary(),/GUEST.*試合中/);
});
test('未知文字列・生エラー・ID・名前等は収集と復元の要約両方へ出さない',()=>{
 const secret='PRIVATE_IP_192.0.2.1_NAME_CHAT_SDP_PEER_ROOM';const h=setup();const d=playing();d.map=secret;d.peer=secret;d.diagnostic.corrections.reasons={[secret]:99};h.begin(d);h.r.event('transport_error',secret,d);assert(!h.r.summary().includes(secret));
 const raw=JSON.parse(h.r.json());raw.sessions[0].version=secret;raw.sessions[0].events[0].reason=secret;raw.sessions[0].samples[0].data.transport.snapshotDrops[secret]=900;const r=new Recorder({storage:{getItem:k=>k===KEY?JSON.stringify(raw):null,setItem(){}},now:()=>Date.parse('2026-11-09T12:00:01Z'),maps:['mesa']});assert(!r.summary().includes(secret));assert.match(r.summary(),/分類外;other/);
});
test('7日超の記録と消去後に架空の状態や成功を作らない',()=>{const h=setup();h.begin(playing());h.r.end('local_leave',playing());h.tick(8*86400000);assert.match(h.r.summary(),/記録なし/);h.r.clear();assert.match(h.r.summary(),/記録なし/);});

test('切断後もRecorderがactiveの実経路で通信継続を断定しない',()=>{const h=setup();h.begin(playing());h.tick(5000);h.r.checkpoint('match_interrupted','host_timeout',playing());h.r.sample({...playing(),phase:'ended'},true);const t=h.r.summary();assert.match(t,/試合終了/);assert.match(t,/試合中断\[ホスト応答途絶;host_timeout\]/);assert.match(t,/記録中/);assert(!t.includes('接続中'));});
test('通常イベントが増えても重要な古い切断/エラーを優先し、省略は明示',()=>{const h=setup();h.begin(playing());h.r.event('transport_error','send_failed',playing());for(const code of ['connection_ready','peer_joined','match_started','match_finished','lobby_returned','page_hidden','page_visible','page_closed','peer_departed']){h.tick(1);h.r.event(code,'none',playing());}assert.match(h.r.summary(),/send_failed/);assert.match(h.r.summary(),/他2種は詳細へ/);});
