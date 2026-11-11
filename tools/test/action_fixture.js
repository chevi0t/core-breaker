// VMで本体関数を部分読込する試験にも、製品と同じアクション定義を用意する。
const fs=require('node:fs'),vm=require('node:vm');
module.exports=function(c,html=fs.readFileSync(require.resolve('../../prototype/index.html'),'utf8')){
  const start=html.indexOf('const ACTIONS ='),end=html.indexOf('\nfunction actionUpdate(',start);
  if(start<0||end<0||!html.includes('function normalizeAction('))return;
  vm.runInContext(html.slice(start,end)+'\nObject.assign(this,{ACTIONS,DEFAULT_ACTION,normalizeAction,actionBusy});',c);
  c.selectedAction='crouch';
};
