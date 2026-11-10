#!/usr/bin/env python3
"""配布のSRI置換とオンライン資材を、ブラウザなしで確かめる。

python3 tools/test/distribution_check.py
python3 tools/test/distribution_check.py <Pages出力先> <配布zip>
python3 tools/test/distribution_check.py <Pages出力先> <配布zip> --maps <zipに渡したmaps.js>
後者は実際に生成した両配布物の参照先・元ファイルとの一致・Pagesのハッシュも検査する。
ブラウザの起動・出撃・実WebRTCは検査しない（pages_check.jsなどで別に確かめる）。
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys
import zipfile
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from build_zip import THREE_CDN, bundled_three, online_files

checks = 0


def check(value, message):
    global checks
    if not value:
        raise AssertionError(message)
    checks += 1


class Scripts(HTMLParser):
    def __init__(self, src):
        super().__init__()
        self.sources = []
        self.external = []
        self.feed(src)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag != "script" or not attrs.get("src"):
            return
        if attrs["src"].startswith(("https://", "http://", "//")):
            self.external.append(attrs)
        else:
            self.sources.append(attrs["src"])


def unit_checks():
    for tag in [
        f'<script src="{THREE_CDN}"></script>',
        f'<script src="{THREE_CDN}" integrity="sha384-test" crossorigin="anonymous"></script>',
        f"<script crossorigin='anonymous' integrity='sha384-test' src='{THREE_CDN}'>\n</script>",
        f'<SCRIPT\n src = "{THREE_CDN}"\n></SCRIPT>',
    ]:
        other = '<script src="https://example.invalid/other.js" integrity="sha384-keep"></script>'
        result = bundled_three(other + tag)
        check(result == other + '<script src="three.min.js"></script>', "SRI・属性順序・引用符によらず指定版だけ置換")
    for src in ["", '<script src="three.min.js"></script>', f'<script src="{THREE_CDN}"></script>' * 2]:
        try:
            bundled_three(src)
        except SystemExit:
            check(True, "three.jsタグの欠落・重複は生成を拒否")
        else:
            check(False, "three.jsタグの欠落・重複を見逃した")
    src = (ROOT / "prototype/index.html").read_text(encoding="utf-8")
    result = bundled_three(src)
    check(THREE_CDN not in result, "実index.htmlも同梱three.jsへ置換")
    check(Scripts(result).sources.count("three.min.js") == 1, "同梱three.js参照は1つ")
    online = online_files()
    expected = {"online/" + name for name in ("transport.js", "codec.js", "lag-compensation.js", "visibility.js", "game.js", "ui.js", "ui.css")}
    check(set(online) == expected, "配布対象7資材だけを収録し、作業用JS/CSSを含めない")
    check("online/ui.css" in online, "スクリプトが動的に読むオンラインCSSを収録")
    for name in Scripts(src).sources:
        if name.startswith("online/"):
            check(name in online, "オンラインJSを収録: " + name)
    for name, path in online.items():
        check(path.read_bytes() == (ROOT / "prototype" / name).read_bytes(), "相対パスと元資材が一致: " + name)


def artifact_checks(pages, archive, zip_maps=None):
    info = json.loads((pages / "build-info.json").read_text(encoding="utf-8"))
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    check(info["sourceCommit"] == head, "PagesのsourceCommitは現在のhead")
    for name, meta in info["files"].items():
        data = (pages / name).read_bytes()
        check(len(data) == meta["bytes"], "Pagesのサイズ: " + name)
        check(hashlib.sha256(data).hexdigest() == meta["sha256"], "Pagesのハッシュ: " + name)
    with zipfile.ZipFile(archive) as z:
        check(z.testzip() is None, "zipのCRC")
        for label, read in [("Pages", lambda name: (pages / name).read_bytes()),
                            ("zip", lambda name: z.read("core-breaker/" + name))]:
            html = read("index.html").decode("utf-8")
            scripts = Scripts(html)
            check(THREE_CDN not in html and scripts.sources.count("three.min.js") == 1, label + "は同梱three.jsを参照")
            check(read("three.min.js") == (ROOT / "vendor/three-r128/three.min.js").read_bytes(), label + "のthree.jsはvendorと一致")
            for name in scripts.sources:
                check(bool(read(name)), label + "の全ローカルscript参照を解決: " + name)
                if name != "three.min.js":
                    source = zip_maps if label == "zip" and name == "maps.js" and zip_maps else ROOT / "prototype" / name
                    check(read(name) == source.read_bytes(), label + "のJSが元資材と一致: " + name)
            for name, source in online_files().items():
                check(read(name) == source.read_bytes(), label + "のオンライン資材が一致: " + name)
                if label == "Pages":
                    check(name in info["files"], "オンライン資材をPages manifestへ収録: " + name)
            # PeerJSは既存どおりネット対戦用CDN。版固定・SRIを変えず、同梱three.jsと混同しない。
            peer = [a for a in scripts.external if "peerjs@" in a["src"]]
            check(len(peer) == 1 and "peerjs@1.5.5/" in peer[0]["src"] and peer[0].get("integrity", "").startswith("sha384-")
                  and peer[0].get("crossorigin") == "anonymous", label + "はPeerJSの版・SRIを保持")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pages", nargs="?", type=pathlib.Path)
    parser.add_argument("archive", nargs="?", type=pathlib.Path)
    parser.add_argument("--maps", type=pathlib.Path, help="zip生成時に--mapsへ渡した元ファイル")
    args = parser.parse_args()
    if bool(args.pages) != bool(args.archive) or args.maps and not args.archive:
        parser.error("Pages出力先とzipは両方指定してください")
    unit_checks()
    if args.pages:
        artifact_checks(args.pages, args.archive, args.maps)
    print(f"配布物検査: {checks}項目 成功（ブラウザ・実WebRTCは対象外）")
