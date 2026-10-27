#!/usr/bin/env python3
"""GitHub Pages（https://chevi0t.github.io/core-breaker/ 、gh-pages ブランチの直下）の中身を、今の main から作り直す。

使い方（リポジトリの直下で、マージ済みの main を取り出した状態で）:
  git fetch origin main gh-pages
  git worktree add ../core-breaker-pages origin/gh-pages -B gh-pages   # 2回目からは cd ../core-breaker-pages && git pull --ff-only
  python3 tools/build_pages.py ../core-breaker-pages
  node tools/test/pages_check.js ../core-breaker-pages                 # スマホと PC の大きさで出撃まで動くか
  cd ../core-breaker-pages && git add -A && git commit -m "…を公開版へ反映" && git push origin gh-pages

書き出す物：index.html（prototype/index.html に骨組みを付け、three.js を同梱の物に替え、マップ選択の画面に出典のリンクを足す）、
maps.js・sounds.js・music.js（prototype/ のまま）、three.min.js、credits/（各 CREDITS.md と three.js のライセンス）、
build-info.json（元の main のコミットと各ファイルのハッシュ）、README.md。.nojekyll はそのまま残す。
gh-pages は配信専用のブランチで、main へマージしない。push を強制（--force）しない。
"""
import datetime
import hashlib
import html
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from build_zip import CDN_TAG, HEAD  # 配布 zip と同じ骨組みと three.js の読み込みタグ

REPO = "https://github.com/chevi0t/core-breaker"
ATTRIBUTION = '      <p class="note" id="mapAttribution"></p>\n'
CREDITS_LINK = '<p class="note"><a href="credits/" target="_blank" rel="noopener noreferrer" style="color:#9bdfff">素材の出典・ライセンス</a></p>\n'
# 出典のページに載せる CREDITS（効果音・パイロットの絵が先、マップの都市モデルが後）
CREDITS = ["sounds/CREDITS.md", "prototype/avatars/CREDITS.md"]
CREDITS_STYLE = "body{max-width:960px;margin:40px auto;padding:0 20px;background:#101c28;color:#e5edf4;font:16px/1.8 system-ui,sans-serif}a{color:#9bdfff}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}section{border-top:1px solid #526677;padding:16px 0}h1{font-size:26px}h2{font-size:19px}"
README = """# コアブレイカー・GitHub Pages配信物

マージ済みmain `{commit}` から生成。ゲームの実行ファイルと出典だけを収録する。

GitHub Pagesの公開元は、このgh-pagesブランチのルート。`.nojekyll`により静的ファイルとして配信する。Three.jsは同梱し、ゲームのメニューから素材の出典・ライセンスを開ける。

これは配信専用ブランチで、mainへマージしない。更新元はmainのprototypeとvendor、各CREDITS。作り直しは main の `tools/build_pages.py`。
"""


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def credit_files():
    found = [p for p in git("ls-files", "*CREDITS.md").splitlines() if p not in CREDITS]
    maps = sorted(p for p in found if p.startswith("mapdesign/"))
    return CREDITS + maps + sorted(p for p in found if p not in maps)


def md_links(text):
    """Markdown を HTML に直さず、そのまま読める形で出す。[名前](URL) だけを新しいタブで開くリンクにする。"""
    esc = html.escape(text)
    return re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', esc)


def credits_page():
    parts = [f'<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>コアブレイカー — 素材の出典・ライセンス</title><style>{CREDITS_STYLE}</style>',
             f'<h1>素材の出典・ライセンス</h1><p><a href="../">ゲームへ戻る</a> · <a href="{REPO}">開発リポジトリ</a></p><p>公開データと素材・ソフトウェアを制作し、整備・公開してくださった皆さまに感謝します。</p>']
    for rel in credit_files():
        parts.append(f"<section><h2>{html.escape(rel)}</h2><pre>{md_links((ROOT / rel).read_text(encoding='utf-8'))}</pre></section>")
    lic = (ROOT / "vendor" / "three-r128" / "LICENSE").read_text(encoding="utf-8")
    parts.append(f"<section><h2>Three.js r128 — MIT License</h2><pre>{html.escape(lic)}</pre></section></html>")
    return "".join(parts)


def game_page():
    src = (ROOT / "prototype" / "index.html").read_text(encoding="utf-8")
    for tag in (CDN_TAG, ATTRIBUTION):
        if src.count(tag) != 1:
            sys.exit("prototype/index.html に次の行が1つだけあるはずです: " + tag.strip())
    src = src.replace(CDN_TAG, '<script src="three.min.js"></script>').replace(ATTRIBUTION, ATTRIBUTION + CREDITS_LINK)
    return HEAD + src + "\n</html>\n"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = pathlib.Path(sys.argv[1]).resolve()
    if not (out / "build-info.json").exists() or out == ROOT:
        sys.exit(f"{out} は gh-pages を取り出したフォルダではありません（build-info.json がありません）")
    if git("status", "--porcelain", "--untracked-files=no", "--", "prototype", "vendor", "*CREDITS.md"):
        sys.exit("prototype・vendor・CREDITS にコミットしていない変更があります。マージ済みの main から作ってください")
    commit = git("rev-parse", "HEAD")
    files = {
        "index.html": game_page().encode("utf-8"),
        "credits/index.html": credits_page().encode("utf-8"),
    }
    copies = {"maps.js": "prototype/maps.js", "sounds.js": "prototype/sounds.js", "music.js": "prototype/music.js",
              "three.min.js": "vendor/three-r128/three.min.js", "credits/LICENSE-THREE.txt": "vendor/three-r128/LICENSE"}
    for dst, src in copies.items():
        files[dst] = (ROOT / src).read_bytes()
    (out / "credits").mkdir(exist_ok=True)
    for dst, data in files.items():
        (out / dst).write_bytes(data)
    (out / ".nojekyll").touch()
    names = [".nojekyll", "index.html", "maps.js", "sounds.js", "music.js", "three.min.js", "credits/index.html", "credits/LICENSE-THREE.txt"]
    info = {
        "sourceRepository": REPO,
        "sourceBranch": "main",
        "sourceCommit": commit,
        "builtDateJapan": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime("%Y-%m-%d"),
        "entry": "index.html",
        "files": {n: {"bytes": (out / n).stat().st_size, "sha256": hashlib.sha256((out / n).read_bytes()).hexdigest()} for n in names},
    }
    (out / "build-info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "README.md").write_text(README.format(commit=commit), encoding="utf-8")
    print(f"{out} を main {commit[:7]} から作り直しました：" + "、".join(names[1:]))


if __name__ == "__main__":
    main()
