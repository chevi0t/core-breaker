// メモリ内の保存先代役。ブラウザstorageの検証ではない。実オンラインAPIへ3構成を供給する。
module.exports=function(c){
 const copy=x=>JSON.parse(JSON.stringify(x));
 let record={cur:0,list:[0,1,2].map(()=>({mech:copy(c.MECH_DEFAULT),loadout:copy(c.CLASSES)}))};
 let writes=0;
 c.buildSaveState={failed:false,text:''};
 c.buildRecord=()=>copy(record);
 c.switchBuild=i=>{record.cur=i;};
 c.applyBuildRecord=r=>{record=copy(r);};
 c.saveBuilds=()=>{writes++;return !c.buildSaveState.failed;};
 c.renderBuildTabs=c.renderClsButtons=()=>{};
 c.validBuildImport=r=>r?.format==='core-breaker-settings'&&r.version===2&&[0,1,2].includes(r.cur)&&Array.isArray(r.list)&&r.list.length===3&&r.list.every(b=>b?.mech&&b?.loadout&&Object.keys(c.CLASSES).every(cls=>b.loadout[cls]&&c.SLOTS.every(k=>c.ARMORY[cls][k].includes(b.loadout[cls][k]))));
 return {read:()=>copy(record),writes:()=>writes};
};
