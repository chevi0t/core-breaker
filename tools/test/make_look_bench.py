#!/usr/bin/env python3
"""都市マップの見た目（写真の地面・木・空・海・外壁の模様）と影が、実機でどれだけ重いかを測るページを作る。

  python3 tools/test/make_dbg.py dbg
  python3 tools/test/make_look_bench.py dbg          # dbg/bench.html を書く（dbg.html と同じフォルダに置いて開く）

bench.html をブラウザで開くと、双湾展示区（sowan）へ出撃し、機能を1つずつ外した状態で描画の時間を測って、
最後に表を出す（1〜2分。途中で何度か読み込み直す）。ヘッドレスの Chromium はソフトウェア描画なので、
木（インスタンス描画）が実機よりずっと重く出る。実機の GPU で重い所を知るには、このページを実機で開く。

測り方：機能を外すのは読み込み時（maps.js の直後にマップのデータから指定を消す）。視点を3つ決め、
同じコマを続けて描いて readPixels で描き終わりを待ち、1コマあたりの時間を出す（垂直同期に縛られない）。
"""
import sys
from pathlib import Path

PATCH = r"""<script>
// 計測する状態（sessionStorage に進み具合を持ち、読み込み直すたびに次へ進む）
(()=>{
  const VARIANTS=[['今のまま',''],['木なし','trees'],['空なし','sky'],['海の波なし','sea'],['写真なし','photo'],['外壁の模様なし','facade'],['見た目を全部なし','trees,sky,sea,photo,facade'],['影なし','shadow']];
  let state=null;try{state=JSON.parse(sessionStorage.getItem('cbLookBench')||'null');}catch(_){}
  if(!state||!(state.i<VARIANTS.length))state={i:0,rows:[]};
  const map=new URLSearchParams(location.search).get('map')||'sowan',d=window.MAP_DATA[map].cityTerrain,off=new Set(VARIANTS[state.i][1].split(','));
  if(off.has('trees'))delete d.district.trees;
  if(off.has('sky'))delete d.district.sky;
  if(off.has('sea')&&d.river)delete d.river.sea;
  if(off.has('photo'))delete d.district.photo;
  if(off.has('facade'))d.volumes.forEach(r=>{if(r[4])delete r[4].facade;});
  window.__lookBench={VARIANTS,state,map,noShadow:off.has('shadow')};
})();
</script>"""

DRIVER = r"""<script>
(()=>{
  const {VARIANTS,state,map,noShadow}=window.__lookBench,g=window.__g;
  // 視点：[名前, カメラの位置, 見る先]
  const VIEWS=[['上空から',[0,170,340],[0,74,164]],['地上',[-80,7,-70],[-80,5,-170]],['水辺',[-100,8,280],[-100,4,80]]];
  const box=document.createElement('div');
  box.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-start;justify-content:center;pointer-events:none;font:16px/1.6 sans-serif;color:#fff';
  const panel=document.createElement('div');panel.style.cssText='margin-top:12px;padding:10px 18px;background:rgba(10,18,28,.88);border-radius:8px;pointer-events:auto;max-width:92vw';
  box.appendChild(panel);document.body.appendChild(box);
  const say=text=>{panel.textContent=text;};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const median=a=>a.slice().sort((x,y)=>x-y)[a.length>>1];
  async function run(){
    say(`描画の重さを計測中 ${state.i+1}/${VARIANTS.length}（${VARIANTS[state.i][0]}）。1〜2分、このままお待ちください。`);
    await wait(1200);
    if(noShadow)g.renderer.shadowMap.enabled=false;
    g.selectMap(map);document.getElementById('start').click();
    await wait(6000); // 出撃と、写真の読み込み
    if(noShadow)g.scene.traverse(m=>{if(m.isLight)m.castShadow=false;if(m.material)[].concat(m.material).forEach(x=>{x.needsUpdate=true;});});
    const gl=g.renderer.getContext(),px=new Uint8Array(4),sync=()=>gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
    const aim=([,at,to])=>{g.camera.position.set(...at);g.camera.lookAt(...to);g.camera.updateMatrixWorld(true);};
    const batch=(view,n)=>{aim(view);sync();const t=performance.now();for(let i=0;i<n;i++)g.renderer.render(g.scene,g.camera);sync();const ms=(performance.now()-t)/n;drawn=[g.renderer.info.render.calls,g.renderer.info.render.triangles];return ms;};
    const ms=[];let drawn=[0,0];
    for(const view of VIEWS){
      batch(view,2); // 木の間引きは1コマ遅れて効くので、先に2コマ描く
      const once=batch(view,3),n=Math.max(3,Math.min(60,Math.round(250/Math.max(once,.1)))),times=[];
      for(let k=0;k<5;k++){times.push(batch(view,n));await wait(30);}
      ms.push(+median(times).toFixed(2));
    }
    state.rows.push({name:VARIANTS[state.i][0],ms,calls:drawn[0],triangles:drawn[1]});state.i++;
    if(state.i<VARIANTS.length){sessionStorage.setItem('cbLookBench',JSON.stringify(state));location.reload();return;}
    sessionStorage.removeItem('cbLookBench');
    const info=gl.getExtension('WEBGL_debug_renderer_info'),gpu=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    const base=state.rows[0].ms,lines=[`描画の重さ（1コマあたりのミリ秒。小さいほど軽い。60fps には 16.7 以下が要る）`,`GPU：${gpu}`,`描く大きさ：${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`,'',`状態\t${VIEWS.map(v=>v[0]).join('\t')}`];
    for(const row of state.rows)lines.push(`${row.name}\t${row.ms.map((v,i)=>row===state.rows[0]?v.toFixed(1):`${v.toFixed(1)}（${v-base[i]>=0?'+':''}${(v-base[i]).toFixed(1)}）`).join('\t')}`);
    panel.textContent='';
    const title=document.createElement('div');title.textContent='計測が終わりました。下の文字を全部コピーして、マップ製作のスレッドに貼ってください。';
    const text=document.createElement('textarea');text.readOnly=true;text.value=lines.join('\n');text.style.cssText='display:block;width:min(820px,88vw);height:330px;margin:8px 0;font:14px/1.5 monospace;background:#0b141e;color:#dfe9f2;border:1px solid #456;padding:8px';
    const copy=document.createElement('button');copy.textContent='コピー';copy.style.cssText='font:16px sans-serif;padding:6px 18px';
    copy.onclick=()=>{text.select();try{document.execCommand('copy');copy.textContent='コピーしました';}catch(_){}};
    panel.append(title,text,copy);
  }
  window.addEventListener('load',()=>{run().catch(e=>{sessionStorage.removeItem('cbLookBench');say('計測に失敗しました：'+(e&&e.message||e));});});
})();
</script>"""


def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "dbg")
    html = (folder / "dbg.html").read_text(encoding="utf-8")
    tag = '<script src="maps.js"></script>'
    if html.count(tag) != 1:
        sys.exit("dbg.html の形が変わっていて bench.html を作れません")
    html = html.replace(tag, tag + "\n" + PATCH)
    # 通信対戦の部品（外の CDN）は計測に要らないので読まない
    lines = [line for line in html.split("\n") if "cdn.jsdelivr.net/npm/peerjs" not in line]
    html = "\n".join(lines)
    html = html.rstrip("\n") + "\n" + DRIVER + "\n"  # 本体の後（__g ができた後）に計測の部品を足す
    (folder / "bench.html").write_text(html, encoding="utf-8")
    print("書き出し:", folder / "bench.html")


if __name__ == "__main__":
    main()
