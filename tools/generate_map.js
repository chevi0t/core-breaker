#!/usr/bin/env node
// Issue #1：地形・配置・通り道を生成し、実際のゲームで検査して保存する。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const {geometry, placements, selectDiverse, save, facilitiesPass} = require('./mapgen');
const {openMap, candidateSites, navigation, driveRoutes} = require('./mapgen_browser');
const ROOT = path.resolve(__dirname, '..');

function options(args) {
  const result = {id:'circulation', seed:20261019, placementSeed:undefined, terrainAttempts:30, placementAttempts:64, variants:3};
  const names = {'--id':'id','--seed':'seed','--placement-seed':'placementSeed','--terrain-attempts':'terrainAttempts','--placement-attempts':'placementAttempts','--variants':'variants'};
  for (let i=0; i<args.length; i+=2) {
    if (!names[args[i]] || args[i+1] === undefined) throw new Error('引数: --id ID --seed N --placement-seed N --terrain-attempts N --placement-attempts N --variants N');
    const key=names[args[i]];
    result[key] = key==='id' ? args[i+1] : Number(args[i+1]);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(result.id)) throw new Error('マップIDが不正です');
  for (const k of ['seed','placementSeed']) if (result[k]!==undefined && (!Number.isSafeInteger(result[k]) || result[k]<0 || result[k]>0xFFFFFFFF)) throw new Error(`${k} は32bitの非負整数にしてください`);
  for (const k of ['terrainAttempts','placementAttempts','variants']) if (!Number.isInteger(result[k]) || result[k]<1) throw new Error(`${k} は正の整数にしてください`);
  if (result.variants<3) throw new Error('戦場は3種類以上必要です');
  result.placementSeed ??= (result.seed ^ 0x5EED) >>> 0;
  return result;
}

async function generate(config) {
  const destination=path.join(ROOT,'prototype/maps',config.id+'.js');
  if (fs.existsSync(destination) && !fs.readFileSync(destination,'utf8').startsWith('// tools/generate_map.js')) throw new Error('手書きの既存マップは上書きしません');
  const work=path.join(ROOT,'dbg/mapgen',config.id), reportDir=path.join(ROOT,'mapdesign',config.id);
  fs.mkdirSync(work,{recursive:true}); fs.mkdirSync(reportDir,{recursive:true});
  execFileSync('python3',['tools/test/make_dbg.py','dbg'],{cwd:ROOT,stdio:'inherit'});
  const failures=[];
  let browser;
  try {
    browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
    for (let attempt=0; attempt<config.terrainAttempts; attempt++) {
      const seed=(config.seed+attempt)>>>0;
      let data=geometry(seed), page;
      try {
        const candidate=path.join(work,'terrain.js'), count=data.terrain.length;
        save(config.id,data,candidate);
        execFileSync('python3',['tools/gen_rough.py',config.id,'--seed',String(seed),'--src',candidate],{cwd:ROOT,stdio:'inherit'});
        const context={window:{}};
        vm.runInNewContext(fs.readFileSync(candidate,'utf8'),context);
        data=JSON.parse(JSON.stringify(context.window.MAP_DATA[config.id]));
        data.generation.roughCount=data.terrain.length-count;
        const opened=await openMap(browser,config.id,data,seed); page=opened.page;
        const sites=await page.evaluate(candidateSites);
        const proposals=placements(sites,config.placementSeed,config.placementAttempts);
        const choices=selectDiverse(proposals,config.variants);
        if (choices.length<config.variants) throw new Error(`異なる配置が不足: ${choices.length}/${config.variants}`);
        console.log(`地形 seed=${seed}、候補地点${sites.length}、配置候補${proposals.length}、選抜${choices.length}`);
        const variants=[], validations=[];
        for (const [i,choice] of choices.entries()) {
          const def={...data,...choice}; delete def.signature; delete def.metrics;
          await page.evaluate(([id,def])=>{__g.MAPS[id]=def;__g.buildMap(id);},[config.id,def]);
          const built=await page.evaluate(navigation);
          def.nav=built.nav;
          await page.click('#start');
          const routes=await page.evaluate(driveRoutes);
          const variant={name:choice.name,plants:choice.plants,plantPods:choice.plantPods,nav:built.nav,desc:data.desc+' '+choice.name+'。勝率未確定。'};
          variants.push(variant);
          validations.push({id:i===0?config.id:`${config.id}-v${i+1}`,metrics:choice.metrics,nav:{nodes:built.retained,links:built.links},routes});
          // 次の buildMap は進行中の機体を再利用しない。
          await page.evaluate(()=>{__g.setup();document.querySelector('#overlay').hidden=false;});
        }
        if (opened.errors.length) throw new Error('ページエラー: '+opened.errors.join('; '));
        const first=variants[0];
        data={...data,...first,name:data.name,subtitle:first.name,variants:Object.fromEntries(variants.slice(1).map((v,i)=>['v'+(i+2),v]))};
        data.generation={...data.generation,placementSeed:config.placementSeed,configuration:config};
        const checked=path.join(work,config.id+'.js');
        save(config.id,data,checked);
        // 既存の施設検査も未登録の作業用データに対して行い、★を残したまま登録しない。
        const inspect=path.join(work,'inspect');
        execFileSync('python3',['tools/test/make_dbg.py',inspect],{cwd:ROOT,stdio:'inherit'});
        fs.copyFileSync(checked,path.join(inspect,'maps.js'));
        for (const v of validations) {
          const log=execFileSync(process.execPath,['tools/test/map_check.js',inspect,v.id,'--quick'],{cwd:ROOT,encoding:'utf8'});
          fs.writeFileSync(path.join(work,v.id+'-facilities.log'),log);
          if(!facilitiesPass(log)) throw new Error(`${v.id}: 施設検査に不合格（${work} のログを参照）`);
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
        fs.writeFileSync(path.join(reportDir,'generation.json'),JSON.stringify({configuration:config,terrainSeed:seed,balance:'勝率未確定',stage:'地形・配置・経路生成と実走行。統計的な最終合格は未判定',candidateSites:sites,validations,failures},null,2)+'\n');
        console.log(`保存: ${path.relative(ROOT,destination)}（${variants.length}戦場、勝率未確定）`);
        return data;
      } catch(error) {
        failures.push({attempt:attempt+1,seed,reason:error.message});
        fs.writeFileSync(path.join(reportDir,'generation-failures.json'),JSON.stringify({configuration:config,failures,status:'未合格'},null,2)+'\n');
        console.error(`試行${attempt+1}/${config.terrainAttempts}: ${error.message}`);
      } finally {if(page) await page.close();}
    }
    throw new Error(`予算内に合格候補なし（${config.terrainAttempts}地形）。既存の登録マップは保持しました`);
  } finally {if(browser) await browser.close();}
}
if(require.main===module) generate(options(process.argv.slice(2))).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={options,generate};
