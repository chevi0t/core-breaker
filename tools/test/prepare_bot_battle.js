// page.evaluate で使う。試験専用の初期化だけを切り替え、本体の移動・戦闘は変えない。
module.exports=function prepareBotBattle(options=false){
  const {legacy=false,fixture=null}=typeof options==='object'?options:{legacy:options};
  const g=__g;
  if(window.__allBotSetupVersion!==1)throw new Error('最新の make_dbg.py でdbgを作成してください');
  if(legacy){g.player.isPlayer=false;g.spawn(g.player,'base');}
  else{
    window.__allBotBattle=true;
    if(fixture){
      const random=seed=>{let state=seed>>>0;return()=>{state=Math.imul(1664525,state)+1013904223>>>0;return state/4294967296;};};
      // 事前のメニュー・試験用出撃で生成された武器形状が、UUID用の乱数消費を変える。
      // 初期構成の生成前にキャッシュを空にし、対照戦場の進行まで照合する。
      g.weaponGeoBank.clear();
      // THREEのUUIDや地形の描画による消費数から、編成の抽選を切り離す。
      Math.random=random(fixture.seed);
      window.__botFixturePhase=(team,idx,phase)=>{
        const side=(team==='R')!==!!fixture.swapped?1:0;
        Math.random=random((fixture.seed ^ Math.imul(1+idx+side*10,0x9e3779b1) ^ Math.imul(phase,0x85ebca6b))>>>0);
      };
      window.__botFixtureRandom=(team,idx)=>{
        const previous=Math.random;
        window.__botFixturePhase(team,idx,0);
        return()=>{Math.random=previous;};
      };
      try{g.setup();}finally{delete window.__botFixtureRandom;delete window.__botFixturePhase;}
      Math.random=random((fixture.seed^0x51f15e5d)>>>0);
    }else g.setup();
  }
  const scene=g.units[0].group.parent;g.renderer.render=()=>scene.updateMatrixWorld();
  return {version:legacy?'legacy-player-conversion':fixture?'paired-rosters-v2':'ordinary-bots-v1',fixture,silent:!!window.__battleSilent,units:g.units.map(u=>({
    id:u.team+(u.idx+1),isPlayer:u.isPlayer,cls:u.cls,role:u.role,mech:{...u.mech},
    weapons:Object.fromEntries(g.SLOTS.map(k=>[k,u.slots[k].w.name])),
    position:u.pos.toArray(),waypoint:u.waypoint?.toArray()||null,
    walk:u.walkV,cruise:u.cruiseV,weight:u.stats.weight}))};
};
