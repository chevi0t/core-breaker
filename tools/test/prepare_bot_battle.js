// page.evaluate で使う。試験専用の初期化だけを切り替え、本体の移動・戦闘は変えない。
module.exports=function prepareBotBattle(legacy=false){
  const g=__g;
  if(window.__allBotSetupVersion!==1)throw new Error('最新の make_dbg.py でdbgを作成してください');
  if(legacy){g.player.isPlayer=false;g.spawn(g.player,'base');}
  else{window.__allBotBattle=true;g.setup();}
  const scene=g.units[0].group.parent;g.renderer.render=()=>scene.updateMatrixWorld();
  return {version:legacy?'legacy-player-conversion':'ordinary-bots-v1',silent:!!window.__battleSilent,units:g.units.map(u=>({
    id:u.team+(u.idx+1),isPlayer:u.isPlayer,cls:u.cls,role:u.role,mech:{...u.mech},
    weapons:Object.fromEntries(g.SLOTS.map(k=>[k,u.slots[k].w.name])),
    position:u.pos.toArray(),waypoint:u.waypoint?.toArray()||null,
    walk:u.walkV,cruise:u.cruiseV,weight:u.stats.weight}))};
};
