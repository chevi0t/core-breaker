#!/usr/bin/env node
// Issue #1：地形・配置・通り道を生成し、実際のゲームで検査して保存する。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const {geometry, placements, selectDiverse, routeCover, save, facilitiesPass} = require('./mapgen');
const {openMap, candidateSites, navigation, driveRoutes, driveMobility} = require('./mapgen_browser');
const ROOT = path.resolve(__dirname, '..');

// 同じシード・同じ修正案の再実行でも、以前の失敗と検証結果を消さない。
function reportDirectory(root,id,revision){
  const version=/^tidal(\d+)$/.exec(revision);
  const parent=path.join(root,'mapdesign',id,version?'v'+version[1]:revision==='baseline'?'v2':'v3','runs');
  fs.mkdirSync(parent,{recursive:true});
  return fs.mkdtempSync(path.join(parent,new Date().toISOString().replace(/[:.]/g,'-')+'-'+revision+'-'));
}

function options(args) {
  const result = {id:'circulation', theme:'circulation', seed:20261019, placementSeed:undefined, terrainAttempts:30, placementAttempts:64, variants:3,revision:'reviewed250'};
  const names = {'--id':'id','--theme':'theme','--seed':'seed','--placement-seed':'placementSeed','--terrain-attempts':'terrainAttempts','--placement-attempts':'placementAttempts','--variants':'variants','--revision':'revision'};
  for (let i=0; i<args.length; i+=2) {
    if (!names[args[i]] || args[i+1] === undefined) throw new Error('引数: --theme circulation|tidal --id ID --seed N --placement-seed N --terrain-attempts N --placement-attempts N --variants N --revision baseline|cover1|cover2|repair3|reviewed250|tidal1|tidal2|tidal3|tidal4|tidal5|tidal6|tidal7');
    const key=names[args[i]];
    result[key] = ['id','theme','revision'].includes(key) ? args[i+1] : Number(args[i+1]);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(result.id)) throw new Error('マップIDが不正です');
  if(!['circulation','tidal'].includes(result.theme))throw new Error('theme は circulation / tidal');
  if(result.theme==='tidal'&&!args.includes('--id'))result.id='tidal';
  if(result.theme==='tidal'&&!args.includes('--revision'))result.revision='tidal7';
  for (const k of ['seed','placementSeed']) if (result[k]!==undefined && (!Number.isSafeInteger(result[k]) || result[k]<0 || result[k]>0xFFFFFFFF)) throw new Error(`${k} は32bitの非負整数にしてください`);
  for (const k of ['terrainAttempts','placementAttempts','variants']) if (!Number.isInteger(result[k]) || result[k]<1) throw new Error(`${k} は正の整数にしてください`);
  if (result.variants<3) throw new Error('戦場は3種類以上必要です');
  if (!['baseline','cover1','cover2','repair3','reviewed250','tidal1','tidal2','tidal3','tidal4','tidal5','tidal6','tidal7'].includes(result.revision)) throw new Error('revision が不正です');
  if((result.theme==='tidal')!==['tidal1','tidal2','tidal3','tidal4','tidal5','tidal6','tidal7'].includes(result.revision))throw new Error('tidal テーマの revision は tidal1 / tidal2 / tidal3 / tidal4 / tidal5 / tidal6 / tidal7');
  result.placementSeed ??= (result.seed ^ 0x5EED) >>> 0;
  return result;
}

async function generate(config) {
  const profile=config.theme==='tidal'?require('./tidal_mapgen'):{geometry,placements,select:selectDiverse};
  const destination=path.join(ROOT,'prototype/maps',config.id+'.js');
  if (fs.existsSync(destination) && !fs.readFileSync(destination,'utf8').startsWith('// tools/generate_map.js')) throw new Error('手書きの既存マップは上書きしません');
  const work=path.join(ROOT,'dbg/mapgen',config.id), reportDir=reportDirectory(ROOT,config.id,config.revision);
  fs.mkdirSync(work,{recursive:true}); fs.mkdirSync(reportDir,{recursive:true});
  const sources=Object.fromEntries(['prototype/index.html','tools/mapgen.js','tools/generate_map.js','tools/mapgen_browser.js',...(config.theme==='tidal'?['tools/tidal_mapgen.js']:[])].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
  console.log('検査記録: '+path.relative(ROOT,reportDir));
  const runner=path.join(work,'runner');
  execFileSync('python3',['tools/test/make_dbg.py',runner],{cwd:ROOT,stdio:'inherit'});
  const failures=[];
  let browser;
  try {
    browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
    for (let attempt=0; attempt<config.terrainAttempts; attempt++) {
      const seed=(config.seed+attempt)>>>0;
      let data=profile.geometry(seed,config), page;
      try {
        const candidate=path.join(work,'terrain.js'), roughBase=profile.roughGeometry?.(seed,config), count=(roughBase||data).terrain.length;
        save(config.id,roughBase||data,candidate);
        execFileSync('python3',['tools/gen_rough.py',config.id,'--seed',String(seed),'--src',candidate],{cwd:ROOT,stdio:'inherit'});
        const context={window:{}};
        vm.runInNewContext(fs.readFileSync(candidate,'utf8'),context);
        const rough=JSON.parse(JSON.stringify(context.window.MAP_DATA[config.id]));
        const roughCount=rough.terrain.length-count;
        if(roughBase)data.terrain=[...rough.terrain.slice(0,roughCount),...data.terrain];
        else data=rough;
        data.generation.roughCount=roughCount;
        const opened=await openMap(browser,config.id,data,seed,{debugDir:path.relative(ROOT,runner)}); page=opened.page;
        const sites=await page.evaluate(candidateSites);
        const proposals=profile.placements(sites,config.placementSeed,config.placementAttempts);
        const choices=profile.select(proposals,config.variants);
        if (choices.length<config.variants) throw new Error(`異なる配置が不足: ${choices.length}/${config.variants}`);
        console.log(`地形 seed=${seed}、候補地点${sites.length}、配置候補${proposals.length}、選抜${choices.length}`);
        const variants=[], validations=[];
        for (const [i,choice] of choices.entries()) {
          const def={...data,...choice,...(config.theme==='tidal'?{barricades:[]}:routeCover(choice,config.revision))}; delete def.signature; delete def.metrics;
          await page.evaluate(([id,def])=>{__g.MAPS[id]=def;__g.buildMap(id);},[config.id,def]);
          const built=await page.evaluate(navigation);
          def.nav=built.nav;
          await page.click('#start');
          const routes=await page.evaluate(driveRoutes);
          const mobility=await page.evaluate(driveMobility);
          const variant={name:choice.name,plants:choice.plants,plantPods:def.plantPods,barricades:def.barricades,nav:built.nav,desc:data.desc+choice.name+'。'};
          variants.push(variant);
          validations.push({id:i===0?config.id:`${config.id}-v${i+1}`,metrics:choice.metrics,nav:{nodes:built.retained,links:built.links},routes,mobility});
          // 次の buildMap は進行中の機体を再利用しない。
          await page.evaluate(()=>{__g.setup();document.querySelector('#overlay').hidden=false;});
        }
        if (opened.errors.length) throw new Error('ページエラー: '+opened.errors.join('; '));
        const first=variants[0];
        data={...data,...first,name:data.name,subtitle:first.name,variants:Object.fromEntries(variants.slice(1).map((v,i)=>['v'+(i+2),v]))};
        data.generation={...data.generation,version:config.theme==='tidal'?Number(config.revision.at(-1)):config.revision==='baseline'?2:3,revision:config.revision,placementSeed:config.placementSeed,configuration:config};
        const checked=path.join(work,config.id+'.js');
        save(config.id,data,checked);
        // 既存の施設検査も未登録の作業用データに対して行い、★を残したまま登録しない。
        const inspect=path.join(work,'inspect');
        execFileSync('python3',['tools/test/make_dbg.py',inspect],{cwd:ROOT,stdio:'inherit'});
        fs.copyFileSync(checked,path.join(inspect,'maps.js'));
        for (const [i,v] of validations.entries()) {
          const log=execFileSync(process.execPath,['tools/test/map_check.js',inspect,v.id,'--quick'],{cwd:ROOT,encoding:'utf8'});
          fs.writeFileSync(path.join(reportDir,v.id+'-facilities.log'),log);
          if(!facilitiesPass(log,[variants[i].plants[0][0],variants[i].plants.at(-1)[0]])) throw new Error(`${v.id}: 施設検査に不合格（${reportDir} のログを参照）`);
          v.facilities='施設・両陣営の隠れたポッド・nav の検査に合格';
        }
        const existing=fs.readdirSync(path.join(ROOT,'prototype/maps')).filter(name=>name.endsWith('.js') && name!==config.id+'.js').map(name=>path.join(ROOT,'prototype/maps',name));
        execFileSync('python3',['tools/build_maps.py','--check',...existing,checked],{cwd:ROOT,stdio:'inherit'});
        const bundle=path.join(ROOT,'prototype/maps.js');
        const previous=fs.existsSync(destination)?fs.readFileSync(destination):null, previousBundle=fs.readFileSync(bundle);
        try {
          fs.copyFileSync(checked,destination);
          execFileSync('python3',['tools/build_maps.py'],{cwd:ROOT,stdio:'inherit'});
        } catch(error) {
          if(previous) fs.writeFileSync(destination,previous); else fs.rmSync(destination,{force:true});
          fs.writeFileSync(bundle,previousBundle); throw error;
        }
        fs.copyFileSync(checked,path.join(reportDir,'candidate-map.js'));
        fs.writeFileSync(path.join(reportDir,'generation.json'),JSON.stringify({configuration:config,sources,terrainSeed:seed,balance:'勝率未確定',stage:'地形・配置・経路生成と実走行。統計的な最終合格は未判定',candidateSites:sites,validations,failures},null,2)+'\n');
        fs.rmSync(path.join(reportDir,'generation-failures.json'),{force:true});
        console.log(`保存: ${path.relative(ROOT,destination)}（${variants.length}戦場、勝率未確定）`);
        return data;
      } catch(error) {
        failures.push({attempt:attempt+1,seed,reason:error.message});
        fs.writeFileSync(path.join(reportDir,'generation-failures.json'),JSON.stringify({configuration:config,sources,failures,status:'未合格'},null,2)+'\n');
        console.error(`試行${attempt+1}/${config.terrainAttempts}: ${error.message}`);
      } finally {if(page) await page.close();}
    }
    throw new Error(`予算内に合格候補なし（${config.terrainAttempts}地形）。既存の登録マップは保持しました`);
  } finally {if(browser) await browser.close();}
}
if(require.main===module) generate(options(process.argv.slice(2))).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={options,generate,reportDirectory};
