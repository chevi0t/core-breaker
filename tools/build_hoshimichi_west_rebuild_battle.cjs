// 再構築した街区と通常の対戦設備を含む、オフライン試遊用HTMLを生成する。
const fs=require('node:fs'),path=require('node:path');
const {inlineGame}=require('./build_hoshimichi_west_walk.cjs');
const ROOT=path.resolve(__dirname,'..');
function build(output,source=path.join(ROOT,'prototype/index.html')){
 const definition=JSON.parse(fs.readFileSync(path.join(ROOT,'mapdesign/hoshimichi_west/rebuild/battle/map.json'),'utf8'));
 return inlineGame(output,source,definition,'hoshimichi_west');
}
if(require.main===module)console.log(JSON.stringify(build(path.resolve(process.argv[2]||'/tmp/hoshimichi-west-rebuild-battle.html'),process.argv[3]&&path.resolve(process.argv[3]))));
module.exports={build};
