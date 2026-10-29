#!/usr/bin/env python3
"""Godot版だけを検証する。ブラウザ版のコード・保存データ・試験は変更しない。"""
import argparse
import concurrent.futures
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--godot", default=shutil.which("godot") or shutil.which("godot4"))
    parser.add_argument("--output", default="dbg/godot-validation")
    parser.add_argument("--battles", default="wide,city,dock,tidal")
    parser.add_argument("--seconds", type=float, default=150)
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    if not args.godot:
        parser.error("Godot 4.6の実行ファイルを --godot で指定してください")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ROOT / "data/catalog.json").read_text())
    maps = ([key for key, value in catalog["maps"].items() if not value.get("testOnly")]
            if args.battles == "all" else [key for key in args.battles.split(",") if key])
    with tempfile.TemporaryDirectory(prefix="core-breaker-godot-test-") as temporary:
        env = dict(os.environ)
        env.update({"XDG_CONFIG_HOME": temporary + "/config", "XDG_DATA_HOME": temporary + "/data",
                    "XDG_CACHE_HOME": temporary + "/cache", "GODOT_CHECK_REPORT": str(output / "checks.json")})

        def run(name, extra):
            command = [args.godot, "--headless", "--path", str(ROOT), *extra]
            process = subprocess.run(command, cwd=REPO, env=env, text=True,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=240)
            log = process.stdout
            (output / (name + ".log")).write_text(log)
            errors = re.findall(r"^(?:SCRIPT ERROR:|ERROR:|FAIL ).*$", log, re.MULTILINE)
            if process.returncode or errors:
                raise RuntimeError(f"{name}: exit={process.returncode}, " + "; ".join(dict.fromkeys(errors)))
            return log

        run("import", ["--editor", "--quit"])
        print("Godotの読み込み成功", flush=True)
        run("checks", ["--script", "res://tests/offline_check.gd"])
        checks = json.loads((output / "checks.json").read_text())
        if checks["failures"]:
            raise RuntimeError(str(checks["failures"]))
        print(f"機能検査 {checks['passed']}/{checks['checks']} 成功", flush=True)

        def battle(map_id):
            report_path = output / (map_id + ".json")
            run("battle-" + map_id, ["--fixed-fps", "60", "--", "--autoplay", "--map", map_id,
                                    "--seconds", str(args.seconds), "--seed", "20261021",
                                    "--report", str(report_path)])
            result = json.loads(report_path.read_text())
            assert result["units"] == catalog["maps"][map_id]["team"] * 2, map_id
            assert result["shots"] > 0 and result["hits"] > 0 and result["kills"] > 0, map_id
            assert all(math.isfinite(v) for actor in result["agents"] for v in actor["position"]), map_id
            assert all(value >= 0 for value in result["core"].values()), map_id
            print(f"{map_id}: {result['seconds']:.1f}秒 / {result['shots']}射 / "
                  f"{result['kills']}撃破 / 所有変更{result['captures']}回", flush=True)
            return {key: result[key] for key in ("map", "seconds", "units", "shots", "hits", "kills", "captures", "core", "ended")}

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
            battles = list(pool.map(battle, maps))
        summary = {"engine": subprocess.check_output([args.godot, "--version"], env=env, text=True).strip(),
                   "checks": checks, "battles": battles,
                   "scope": "Godot版の機能検査と無人戦。ブラウザ版との戦績一致や移植完了を意味しない。"}
        (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
        print(f"成功: {output / 'summary.json'}", flush=True)


if __name__ == "__main__":
    main()
