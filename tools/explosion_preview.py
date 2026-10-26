#!/usr/bin/env python3
"""ゲーム本体の爆発処理を抜き出し、オフラインの確認画面を作る。"""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
args = parser.parse_args()
src = (ROOT/'prototype/index.html').read_text()
fx = src[src.index('// 爆発は共有バッファへまとめる。'):src.index('// ---- Bot ----')]
flash = src[src.index('const flashTex = (() => {'):src.index('const glow = color')]
page = '''<!doctype html><meta charset="utf-8"><title>爆発エフェクト確認</title>
<style>body{margin:0;background:#9fb4c4;color:#eef6fa;font:14px system-ui}canvas{display:block}#panel{position:absolute;left:20px;top:20px;background:#162631e8;padding:16px;border-radius:8px}h1{font-size:18px;margin:0 0 12px}button,label{margin-right:8px}button{background:#314f61;color:white;border:1px solid #7697a4;border-radius:4px;padding:8px;cursor:pointer}small{display:block;margin-top:12px;color:#b7cbd5}</style>
<canvas id="view"></canvas><div id="panel"><h1>爆発エフェクト確認</h1><button id="normal">通常</button><button id="small">小さな炸裂</button><button id="many">連続</button><label><input id="wall" type="checkbox">壁を置く</label><small>左ドラッグ：回転 ／ ホイール：拡大縮小<br>発生から <span id="time">0.00</span> 秒。通常の爆発を繰り返します。</small></div>
<script>/*THREE*/</script><script>
const T=THREE,renderer=new T.WebGLRenderer({canvas:document.getElementById('view'),antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));
const scene=new T.Scene();scene.background=new T.Color(0x9fb4c4);
const camera=new T.PerspectiveCamera(55,innerWidth/innerHeight,.1,1000);let yaw=.32,polar=1.21,radius=24;
const visualAlloc=make=>make(),sfx=()=>{};
/*FLASH*/
/*EFFECTS*/
scene.add(new T.HemisphereLight(0xffffff,0x566168,.9));const sun=new T.DirectionalLight(0xffefd7,.8);sun.position.set(10,25,10);scene.add(sun);
const ground=new T.Mesh(new T.PlaneGeometry(180,180),new T.MeshLambertMaterial({color:0x52646b}));ground.rotation.x=-Math.PI/2;scene.add(ground);
const grid=new T.GridHelper(120,40,0x728890,0x5c7079);grid.position.y=.01;scene.add(grid);
function box(x,y,z,w,h,d,color){const m=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshLambertMaterial({color}));m.position.set(x,y,z);scene.add(m);return m;}
box(-10,2,-6,3,4,7,0x71818b);box(12,3,-10,6,6,4,0x778991);
box(-10,.9,-.5,2,1.8,2,0x87949a);box(10,.7,1.5,2,1.4,3,0x8b969d);
const wall=box(0,3,6,18,6,.7,0x66767e);wall.visible=false;
document.getElementById('wall').onchange=e=>wall.visible=e.target.checked;
let clock=0,next=2.3,queue=[];
function trigger(scale=1,count=1){clearBooms();clock=0;next=2.3;queue=Array.from({length:count},(_,i)=>({at:i*.16,x:count===1?0:(i-(count-1)/2)*3,k:scale}));tick(0);}
function tick(dt){clock+=dt;for(const q of queue)if(!q.done&&q.at<=clock){boom(new T.Vector3(q.x,0,0),q.k);q.done=true;}boomUpdate(dt);document.getElementById('time').textContent=clock.toFixed(2);}
function render(){camera.position.set(Math.sin(yaw)*Math.sin(polar)*radius,2+Math.cos(polar)*radius,Math.cos(yaw)*Math.sin(polar)*radius);camera.lookAt(0,2,0);renderer.render(scene,camera);}
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();render();}addEventListener('resize',resize);
document.getElementById('normal').onclick=()=>trigger();document.getElementById('small').onclick=()=>trigger(.5);document.getElementById('many').onclick=()=>trigger(1,5);
const canvas=renderer.domElement;let pointer=null;canvas.onpointerdown=e=>{pointer=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};canvas.onpointerup=()=>pointer=null;canvas.onpointermove=e=>{if(pointer){yaw-=(e.clientX-pointer[0])*.007;polar=Math.max(.25,Math.min(1.5,polar+(e.clientY-pointer[1])*.005));pointer=[e.clientX,e.clientY];}};canvas.onwheel=e=>{e.preventDefault();radius=Math.max(10,Math.min(70,radius*Math.exp(e.deltaY*.001)));};
resize();trigger();let last=performance.now();function frame(now){const dt=Math.min(.05,(now-last)/1000);last=now;if(!window.demo.paused){tick(dt);if(clock>next)trigger();}render();requestAnimationFrame(frame);}
window.demo={paused:false,trigger,tick,render,renderer,camera,scene};requestAnimationFrame(frame);
</script>'''
page=page.replace('/*THREE*/',(ROOT/'vendor/three-r128/three.min.js').read_text()).replace('/*FLASH*/',flash).replace('/*EFFECTS*/',fx)
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(page)
print('確認画面:',args.output)
