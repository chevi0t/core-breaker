#!/usr/bin/env python3
"""梅田由来の半縮尺案だけを収めた、独立したオフライン対戦HTMLを作る。

入力は出力先のmap.json。街区・施設・経路の加工は別の生成器で行い、
本体の移動・戦闘は変更せず、外壁模様の間隔だけ半縮尺に合わせる。
prototype/は読み取りのみ。
"""
import argparse
import hashlib
from html import escape
import json
from pathlib import Path
import re
import runpy
import subprocess


ROOT = Path(__file__).resolve().parents[1]
GAME_REVISION = '0ef53120d4ca6a43527b103c1544dc84926254ae'
MAP_ID = 'kanto_half'


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('本体の形が変わっています。接続箇所を再確認してください: ' + before[:100])
    return text.replace(before, after)


def inline_script(text):
    return re.sub(r'</script', r'<\\/script', text, flags=re.I)


def scale_facade_pattern(text):
    # 機体から見た階数を保つ。窓・ガラス反射の空間間隔だけを街と一緒に半分にする。
    text = replace_once(text, 'vec2 pane=fract(vec2(horizontal/2.8,cityPoint.y/3.5));',
                        'vec2 pane=fract(vec2(horizontal/1.4,cityPoint.y/1.75));')
    text = replace_once(text, 'step(2.0,cityPoint.y)', 'step(1.0,cityPoint.y)')
    return replace_once(text, 'sin(cityPoint.y*0.11+horizontal*0.012)',
                        'sin(cityPoint.y*0.22+horizontal*0.024)')


def build_html(output):
    output = Path(output).resolve()
    map_path = output / 'map.json'
    definition = json.loads(map_path.read_text(encoding='utf-8'))
    terrain = definition['cityTerrain']
    if definition['size'] != [250, 250] or terrain['half'] != 250:
        raise ValueError('500×500mの半縮尺案を指定してください')
    if terrain.get('halfExtents', [250, 250]) != [250, 250]:
        raise ValueError('ゲームの境界と都市データの寸法が一致しません')
    if terrain['geometryEncoding'] != 'city-layout-v1' or not definition['nav']['nodes']:
        raise ValueError('対応する都市地形と空でない経路が必要です')
    if definition.get('variants'):
        raise ValueError('この確認用HTMLは1マップだけを表示します')

    # この試作で使う本体を固定する。別のゲーム変更を意図せず取り込まない。
    engine_paths = ['prototype/index.html', 'prototype/sounds.js', 'prototype/music.js',
                    'vendor/three-r128/three.min.js', 'tools/test/make_dbg.py']
    for name in engine_paths:
        original = subprocess.check_output(['git', '-C', str(ROOT), 'show', GAME_REVISION + ':' + name])
        if (ROOT / name).read_bytes() != original:
            raise ValueError('参照本体が指定版と異なります: ' + name)

    source = ROOT / 'prototype/index.html'
    text = scale_facade_pattern(source.read_text(encoding='utf-8'))
    text = '<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n' + text
    text = re.sub(r'<link[^>]+href="https://fonts\.googleapis\.com[^>]+>\n?', '', text)
    sources = [source, map_path, Path(__file__)]
    for url, name in [('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'vendor/three-r128/three.min.js'),
                      ('sounds.js', 'prototype/sounds.js'), ('music.js', 'prototype/music.js')]:
        path = ROOT / name
        text = replace_once(text, '<script src="' + url + '"></script>',
                            '<script>' + inline_script(path.read_text(encoding='utf-8')) + '</script>')
        sources.append(path)
    # 猫のパイロット画像は本体のCSSに既に埋め込まれている。
    map_json = compact(definition)
    text = replace_once(text, '<script src="maps.js"></script>',
                        '<script>window.MAP_DATA={' + json.dumps(MAP_ID) + ':' + inline_script(map_json) + '};</script>')
    text = replace_once(text, '<title>コアブレイカー試作</title>',
                        '<title>' + escape(definition['name']) + ' · 縮尺1/2</title>')

    map_credits = output / 'CREDITS.md'
    if not map_credits.exists():
        map_credits = ROOT / 'mapdesign/kanto/CREDITS.md'
    credits_paths = [map_credits, ROOT / 'sounds/CREDITS.md',
                     ROOT / 'prototype/avatars/CREDITS.md', ROOT / 'vendor/three-r128/LICENSE']
    credits = '\n\n'.join(path.read_text(encoding='utf-8') for path in credits_paths)
    credits += ('\n\n半縮尺の試作：街区の幅・奥行き・高さを基本1/2へ加工。'
                '機体は本体と同じ4mで、実都市に対して8m級に相当します。'
                '施設と経路は、この試作のmap.jsonに保存した配置を使用します。')
    text = replace_once(text, '<p class="note" id="mapAttribution"></p>',
                        '<p class="note" id="mapAttribution"></p>\n'
                        '<details id="cityCredits"><summary>地理データ・素材の出典と謝辞</summary>'
                        '<pre style="white-space:pre-wrap;max-height:45vh;overflow:auto;font:12px/1.6 system-ui">'
                        + escape(credits) + '</pre></details>')
    sources.extend(credits_paths)

    # 共通試験道具から読み口だけを再利用。固定dt・Bot停止などの試験用変更は適用しない。
    expose_path = ROOT / 'tools/test/make_dbg.py'
    expose = runpy.run_path(str(expose_path), run_name='kanto_half_inspection')['EXPOSE']
    expose += '''
Object.defineProperties(window.__g,{
 city:{get:()=>cityMap},battle:{get:()=>cityBattle},frame:{get:()=>loop},
 chosenTeam:{get:()=>chosenTeam,set:v=>{chosenTeam=v;}},
 mouseDown:{get:()=>mouseDown,set:v=>{mouseDown=v;}},rightDown:{get:()=>rightDown,set:v=>{rightDown=v;}},
 selectedTeamSize:{get:()=>selectedTeamSize,set:v=>{selectedTeamSize=v;}},
 mapRoot:{get:()=>mapRoot},mapBounds:{get:()=>[MAP_X,MAP_Z]},
 GRAV:{get:()=>GRAV},CAT_LOCK:{get:()=>CAT_LOCK},UNIT_H:{get:()=>UNIT_H},R:{get:()=>R}
});
window.__cityBattle=window.__g;
'''
    text = replace_once(text, '\nrequestAnimationFrame(loop);\n', '\n' + expose + '\nrequestAnimationFrame(loop);\n')
    sources.append(expose_path)
    if re.search(r'<script\b[^>]*\bsrc=', text):
        raise ValueError('外部スクリプトが残っています')
    # 出典を開くa要素は自動通信しない。読込が発生する素材要素だけを検査する。
    if re.search(r'<(?:link|img|audio|video|source|iframe|object|embed)\b[^>]*(?:src|href|data|poster)=["\']https?://', text, re.I):
        raise ValueError('外部素材への通信が残っています')

    html = text.encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    (output / 'play.html').write_bytes(html)
    record = {'gameRevision': GAME_REVISION, 'mapID': MAP_ID, 'extentMeters': [500, 500],
              'mapDataBytes': len(map_json.encode('utf-8')), 'htmlBytes': len(html),
              'htmlSHA256': hashlib.sha256(html).hexdigest(), 'singleMap': True,
              'inlineDependencies': True, 'gameplayCodeUnchanged': True,
              'renderScalePatch': {'scope': '窓・ガラス反射の空間間隔', 'scale': .5,
                                   'windowPitchMeters': [1.4, 1.75], 'windowMinimumY': 1,
                                   'reflectionSpatialCoefficients': [.22, .024], 'paletteChanged': False},
              'sourceHashes': {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}}
    (output / 'html-generation.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', nargs='?', type=Path, default=ROOT / 'mapdesign/kanto_half')
    args = parser.parse_args()
    print(json.dumps(build_html(args.output), ensure_ascii=False))
