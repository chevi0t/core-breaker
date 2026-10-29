#!/usr/bin/env python3
"""レシピからローカル試遊版を生成し、構造と脱出を検査する。公開処理はしない。"""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from build_pages import game_page, credits_page


def run(args):
    subprocess.run([str(a) for a in args], cwd=ROOT, check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('recipe', type=pathlib.Path)
    ap.add_argument('output', type=pathlib.Path)
    ap.add_argument('--seed', type=int)
    ap.add_argument('--skip-escape', action='store_true', help='全域脱出標本検査を省略し、未実施と記録する')
    args = ap.parse_args()
    recipe = args.recipe.resolve()
    out = args.output.resolve()
    if out == ROOT or out == ROOT / 'prototype' or (out / '.git').exists():
        ap.error('独立した試遊出力フォルダを指定してください')
    out.mkdir(parents=True, exist_ok=True)
    (out / 'validation.json').unlink(missing_ok=True)
    data = json.loads(recipe.read_text())
    seed = args.seed if args.seed is not None else data['seed']
    generated = out / (data['id'] + '.js')
    run(['node', ROOT / 'tools/terrain_recipe.js', recipe, generated, seed])
    run([sys.executable, ROOT / 'tools/build_maps.py', '--check', generated])
    # JS形式の既存マップ定義を共通のブラウザ検査へ渡す。
    definition = out / 'definition.json'
    run(['node', '-e', "global.window={};require(process.argv[1]);require('fs').writeFileSync(process.argv[2],JSON.stringify(Object.values(window.MAP_DATA)[0]));", generated, definition])
    dbg = out / 'check-game'
    run([sys.executable, ROOT / 'tools/test/make_dbg.py', dbg])
    if not args.skip_escape:
        run(['node', ROOT / 'tools/test/terrain_escape_check.js', dbg, out / 'escape', definition])
    # 配信ツールのHTML整形だけを再利用する。gh-pages作成・操作は行わない。
    game = out / 'game'
    (game / 'credits').mkdir(parents=True, exist_ok=True)
    # チェックUIと起動経路は出力HTMLのみに注入。prototype/公開ビルダーは変更しない。
    html = game_page()
    hook = 'function loop(now) {'
    end = 'requestAnimationFrame(loop);\n})();'
    if html.count(hook) != 1 or html.count(end) != 1:
        raise RuntimeError('試遊チェックモードの挿入位置が変わりました')
    html = html.replace(hook, hook + '\n  if (previewCheck.frame(now)) { requestAnimationFrame(loop); return; }')
    html = html.replace(end, (ROOT / 'tools/terrain_preview_check_mode.js').read_text().replace('__PREVIEW_SOURCE_VERSION__', subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()) + '\n' + end)
    (game / 'index.html').write_text(html)
    (game / 'credits/index.html').write_text(credits_page())
    for dst, src in {'sounds.js':'prototype/sounds.js', 'music.js':'prototype/music.js', 'three.min.js':'vendor/three-r128/three.min.js', 'credits/LICENSE-THREE.txt':'vendor/three-r128/LICENSE'}.items():
        shutil.copyfile(ROOT / src, game / dst)
    # 試遊ディレクトリ内だけ、選んだレシピの出力で同IDを上書きする。
    (game / 'maps.js').write_bytes((ROOT / 'prototype/maps.js').read_bytes() + b'\n' + generated.read_bytes())
    shutil.copyfile(recipe, out / 'recipe.json')
    report = {'recipe':data['id'], 'seed':seed, 'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(), 'localPrototype':True, 'structuralValidation':'passed', 'sampledEscapeValidation':'not run for this revision' if args.skip_escape else 'passed', 'files':{p.relative_to(game).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(game.rglob('*')) if p.is_file()}}
    (out / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    (out / 'README.txt').write_text(f'ローカル試遊版・未公開\n左上の「試遊専用・マップチェック」から開始。歩行と自由視点、座標コピー、プラント上空移動が使えます。開始/終了時は試合をリセット。自由視点は右ドラッグ、WASD、Q/E上下、Shift高速。歩行は通常の物理・資源消費です。PCキーボード/マウス向け。\nこのフォルダで python3 -m http.server 8000 を実行し、http://localhost:8000/game/ を開く。\nPCのマップ選択で「{data["name"]}」を選択。既存のモバイル都市除外条件は維持しており、この試作はPC向け。\n構造検査合格。脱出検査の実施有無はvalidation.jsonを参照。連続空間での完全保証、楽しさ、公平性、実スマホ性能は未検証。\n')
    print(f'ローカル試遊版・検査結果: {out}')


if __name__ == '__main__':
    main()
