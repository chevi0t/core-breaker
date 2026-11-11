#!/usr/bin/env python3
"""公開点群ZIPと地図タイルを取得する。原LASはディスクへ一括展開しない。"""

import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(
    os.environ.get(
        "ODAIBA_POINTCLOUD_CACHE",
        str(Path(tempfile.gettempdir()) / "core-breaker-odaiba-pointcloud"),
    )
)
CONFIG = json.loads((ROOT / "research/maps/odaiba-pointcloud-third.json").read_text())


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(4 * 1024 * 1024):
            result.update(block)
    return result.hexdigest()


def download(url, path, expected):
    if not path.exists():
        part = path.with_suffix(path.suffix + ".part")
        with urllib.request.urlopen(url, timeout=90) as source, part.open(
            "wb"
        ) as target:
            while block := source.read(1024 * 1024):
                target.write(block)
        part.replace(path)
    if digest(path) != expected:
        raise ValueError("公開データのSHA256が取得記録と違います: " + path.name)


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    old_path = CACHE / "manifest.json"
    old = (
        {r["file"]: r for r in json.loads(old_path.read_text())["files"]}
        if old_path.exists()
        else {}
    )

    def fetch(record):
        previous = old.get(record["file"], {})
        path = Path(previous.get("localPath", CACHE / record["file"]))
        if not path.exists():
            path = CACHE / record["file"]
        download(record["url"], path, record["sha256"])
        if path.stat().st_size != record["zipBytes"]:
            raise ValueError("ZIPの容量が取得記録と違います: " + path.name)
        with zipfile.ZipFile(path) as archive:
            member = archive.getinfo(record["lasFile"])
            if member.file_size != record["lasBytes"]:
                raise ValueError("LASの容量が取得記録と違います: " + path.name)
        print(record["file"], flush=True)
        return {**record, "localPath": str(path.resolve())}

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        records = list(pool.map(fetch, CONFIG["files"]))
    (CACHE / "manifest.json").write_text(
        json.dumps(
            {"source": "東京都区部点群2024", "files": records},
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    target = CACHE / "gsi"
    target.mkdir(exist_ok=True)
    for r in CONFIG["gsi"]:
        x, y = r["url"].split("/")[-2:]
        download(r["url"], target / (x + "-" + y), r["sha256"])
    (CACHE / "plateau-height-reference.json").write_text(
        json.dumps(CONFIG["heightReference"], ensure_ascii=False, indent=2) + "\n"
    )
    print(
        "取得・ハッシュ確認完了:",
        len(records),
        "区画、地理院",
        len(CONFIG["gsi"]),
        "タイル",
    )


if __name__ == "__main__":
    main()
