#!/usr/bin/env python3
"""ブースター試験の機体と本体の更新処理を使い、オフラインの確認画面を作る。"""
import argparse,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('model',type=Path,help='booster_visual_check.js が出力した model.json')
p.add_argument('output',type=Path)
a=p.parse_args()
src=(ROOT/'prototype/index.html').read_text()
update=src[src.index('function resetBoosterFlame(u) {'):src.index('function buildMech(color, cfg = MECH_DEFAULT) {')]
page='''<!doctype html><meta charset="utf-8"><title>ブースター演出</title>
<style>body{margin:0;background:#101f2a;color:#eef6ff;font:14px system-ui}canvas{display:block}aside{position:absolute;top:18px;left:18px;background:#142633eb;padding:16px;border:1px solid #3d596c;border-radius:8px}h1{font-size:19px;margin:0 0 12px}button{cursor:pointer;padding:8px 12px;background:#264459;color:white;border:1px solid #7699aa;border-radius:4px;margin:0 6px 8px 0}button[aria-pressed=true]{background:#18778a}small{display:block;line-height:1.8;color:#b4cad9}</style>
<aside><h1>ブースター演出</h1><div id="controls"></div><small>ドラッグ：回転 ／ ホイール：拡大縮小<br>ゲーム本体の機体・噴流・更新処理を使用。音声なし。</small></aside><canvas id="view"></canvas>
<script>/*THREE*/</script><script>
const T=THREE,scene=new T.Scene(),camera=new T.PerspectiveCamera(50,innerWidth/innerHeight,.1,100);
const renderer=new T.WebGLRenderer({canvas:document.getElementById('view'),antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));scene.background=new T.Color(0x101f2a);
const model=new T.ObjectLoader().parse(/*MODEL*/);scene.add(model);const flame=model.getObjectByName('booster');
flame.userData.boostFx={mode:'',age:0,pulse:1,lastDash:0,power:0,length:0};
const u={flame,alive:true,isPlayer:true,dashState:'long',dashT:0,idx:0,pos:new T.Vector3()};
/*UPDATE*/
scene.add(new T.HemisphereLight(0xd7eeff,0x384451,.9));const lamp=new T.DirectionalLight(0xffffff,.8);lamp.position.set(-3,8,4);scene.add(lamp);
const ground=new T.Mesh(new T.PlaneGeometry(80,80),new T.MeshLambertMaterial({color:0x243746}));ground.rotation.x=-Math.PI/2;scene.add(ground);
const grid=new T.GridHelper(50,25,0x476373,0x2e4655);grid.position.y=.01;scene.add(grid);
let mode='long',clock=0,yaw=.66,polar=1.35,radius=11;
const controls=document.getElementById('controls');
for(const [id,label] of [['long','巡航'],['short','クイックブースト'],['charge','加速装置'],['hover','滞空'],['','停止']]){const b=document.createElement('button');b.textContent=label;b.dataset.mode=id;b.onclick=()=>setMode(id);controls.append(b);}
function setMode(next){mode=next;clock=0;resetBoosterFlame(u);for(const b of controls.children)b.setAttribute('aria-pressed',b.dataset.mode===mode);}
function tick(dt){clock+=dt;const phase=clock%.8;u.dashState=mode==='short'?(phase<.24?'short':''):mode;u.dashT=mode==='short'?Math.max(0,.24-phase):0;boosterFlameUpdate(u,dt);}
function render(){camera.position.set(Math.sin(yaw)*Math.sin(polar)*radius,2+Math.cos(polar)*radius,2+Math.cos(yaw)*Math.sin(polar)*radius);camera.lookAt(0,2,2);renderer.render(scene,camera);}
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();render();}addEventListener('resize',resize);
let pointer=null;const canvas=renderer.domElement;canvas.onpointerdown=e=>{pointer=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};canvas.onpointerup=()=>pointer=null;canvas.onpointermove=e=>{if(pointer){yaw-=(e.clientX-pointer[0])*.007;polar=Math.max(.3,Math.min(1.6,polar+(e.clientY-pointer[1])*.005));pointer=[e.clientX,e.clientY];}};canvas.onwheel=e=>{e.preventDefault();radius=Math.max(6,Math.min(25,radius*Math.exp(e.deltaY*.001)));};
window.demo={paused:false,setMode,tick,render,u,renderer};resize();setMode('long');let last=performance.now();function frame(now){const dt=Math.min(.05,(now-last)/1000);last=now;if(!demo.paused)tick(dt);render();requestAnimationFrame(frame);}requestAnimationFrame(frame);
</script>'''
page=page.replace('/*THREE*/',(ROOT/'vendor/three-r128/three.min.js').read_text()).replace('/*MODEL*/',json.dumps(json.loads(a.model.read_text()),separators=(',',':'))).replace('/*UPDATE*/',update)
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(page)
print(a.output)
