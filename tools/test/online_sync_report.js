// node tools/test/online_sync_report.js > research/online/physics-sync-summary.json
// 詳細調査専用。旧commitが必要なため、通常のオフライン回帰とは分ける。
const {createPhysicsSuite}=require('./online_physics_sync_fixture');
const before=createPhysicsSuite('1838915'),after=createPhysicsSuite();
const compact=r=>{const {rows,...summary}=r;return {...summary,firstCorrections:rows.filter(row=>row.distance>.001).slice(0,3),lastRow:rows.at(-1)};};
const report={notice:'実physics/default装備/fixed schema/codecの平地VM。描画/RTC/製品マップ全体/被弾・近接・施設外力なし。ユーザー平均0.970mの完全再現ではない。',beforeHashes:before.sourceHashes,afterHashes:after.sourceHashes,ordinary:[],throttled:[],recovery:[]};
for(const unitClass of ['assault','heavy'])for(const mode of ['stop','walk','shortDash','longDash','jump',...(unitClass==='assault'?['charger']:[])])for(const suite of [before,after])report.ordinary.push(compact(suite.run({mode,unitClass})));
for(const [hostHz,guestHz] of [[60,60],[60,144],[144,60]])for(const inputEveryFrames of [1,2,3])for(const mode of ['shortDash','longDash'])report.throttled.push(compact(after.run({hostHz,guestHz,guestPattern:null,inputEveryFrames,mode,durationMs:4200,transportPumpMs:20})));
for(const options of [{inputGap:[2300,2450]},{guestPause:[2300,2800]}])for(const mode of ['shortDash','longDash','reverse'])report.recovery.push(compact(after.run({mode,durationMs:6500,guestPattern:null,...options})));
console.log(JSON.stringify(report,null,2));
