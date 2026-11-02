"""実ゲームの層描画・rigを抽出した、通信不要のパイロット動作レビューHTML。"""
import json,re,pathlib,sys,subprocess
root=pathlib.Path(__file__).resolve().parents[1]
s=(root/'prototype/index.html').read_text()
layers=json.loads(re.search(r'const PILOT_LAYERS = (.*?);\n',s).group(1))
rig=s[s.index('const PILOT_RIGS = {'):s.index('function pilotSwayWeights')]
renderer=s[s.index('function createPilotLayers('):s.index('let pilotSway=null')]
inputfn=s[s.index('function pilotSwayInput('):s.index('function pilotHud(')]
html=(root/'tools/review/pilot.html').read_text()
version=subprocess.check_output(['git','rev-parse','--short','HEAD'],cwd=root,text=True).strip()
html=html.replace('__VERSION__',version).replace('/* GAME_DATA */','const PILOT_LAYERS = '+json.dumps({'officer':layers['officer']})+';\n'+rig+renderer+inputfn)
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/workspace/officer-motion-review.html');out.write_text(html)
print(out, out.stat().st_size,'bytes')
