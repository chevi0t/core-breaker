#!/usr/bin/env python3
"""共有フォルダ（Claude の作業場所）と GitHub リポジトリ chevi0t/core-breaker の写しを合わせる。

  python3 tools/repo_sync.py to-repo <clone>          共有フォルダ → clone（足りない・違うファイルを写し、消えたファイルを消す）
  python3 tools/repo_sync.py from-repo <clone> <base>  clone の <base>..HEAD で変わったファイルだけ → 共有フォルダ

from-repo は、共有フォルダ側が <base> の時点から変わっているファイル（ほかのスレッドの作業中）は上書きせず、名前を出して飛ばす。
リポジトリに入れない物は SKIP（大きい zip、控え、公式のスクリーンショット、重複した効果音の元）。
"""
import filecmp, fnmatch, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = [
    'dist/*',               # 配布 zip（リリースで配る）
    '*/__pycache__/*',
    '*.bak*',               # 控え
    'media/*.mp4',          # 動画
    'research/map2/*',      # 元のゲームのスクリーンショット（ユーザーが貼った参考。公式の素材なのでリポジトリに入れない）
    'sfx/*',                # sounds/src と同じ物
    'dbg/*', 'node_modules/*',  # 動作確認の作業フォルダ（clone の中で作る）
]
# clone の側でだけ持つ物（共有フォルダには無い）
# releases/：配布版の zip（GitHub のリリースを作れないのでリポジトリに置く。2026-10-20）
REPO_ONLY = ['.git/*', '.gitignore', 'README.md', 'AGENTS.md', 'CLAUDE.md', '.github/*', 'package.json', 'package-lock.json', 'releases/*']


def skipped(rel, pats):
    return any(fnmatch.fnmatch(rel, p) for p in pats)


def walk(base, pats):
    out = set()
    for d, dirs, files in os.walk(base):
        for f in files:
            rel = os.path.relpath(os.path.join(d, f), base).replace(os.sep, '/')
            if not skipped(rel, pats):
                out.add(rel)
    return out


def to_repo(clone):
    src, dst = walk(ROOT, SKIP + REPO_ONLY), walk(clone, SKIP + REPO_ONLY)
    for rel in sorted(src):
        a, b = os.path.join(ROOT, rel), os.path.join(clone, rel)
        if rel not in dst or not filecmp.cmp(a, b, shallow=False):
            os.makedirs(os.path.dirname(b), exist_ok=True)
            shutil.copy2(a, b)
            print(('更新 ' if rel in dst else '追加 ') + rel)
    for rel in sorted(dst - src):
        os.remove(os.path.join(clone, rel))
        print('削除 ' + rel)


def from_repo(clone, base):
    git = lambda *a: subprocess.run(['git', '-C', clone, *a], capture_output=True, check=True).stdout
    # 名前の変更は「消す＋足す」として扱い、古い場所を消す
    names = git('diff', '--name-status', '--no-renames', base, 'HEAD').decode().splitlines()
    for line in names:
        st, rel = line.split('\t')[0], line.split('\t')[-1]
        if skipped(rel, SKIP + REPO_ONLY):
            continue
        dst = os.path.join(ROOT, rel)
        try:
            old = git('show', f'{base}:{rel}')
        except subprocess.CalledProcessError:
            old = None  # base に無かった（新しいファイル）
        if os.path.exists(dst) and old is not None and open(dst, 'rb').read() != old:
            print('飛ばした（共有フォルダの方も変わっている）' + rel)
            continue
        if st.startswith('D'):
            if os.path.exists(dst):
                os.remove(dst)
                print('削除 ' + rel)
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(clone, rel), dst)
        print('写した ' + rel)


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'to-repo':
        to_repo(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'from-repo':
        from_repo(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        sys.exit(1)
