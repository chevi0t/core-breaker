#!/usr/bin/env python3
"""sounds/src/ の効果音を prototype/sounds.js にまとめる（ゲームはこのファイルを読んで鳴らす）。

使い方: python3 tools/build_sounds.py [--src 音のフォルダ] [--out 出力ファイル]
       python3 tools/build_sounds.py --music   （戦闘中BGMの prototype/music.js だけを作る）
- sounds/src/<名前>.<拡張子>（wav・mp3・ogg・flac など）を ffmpeg で頭の無音を削り、長さの上限で切り、
  音量の山をそろえてモノラル・96kbps の mp3 にし、base64 にして sounds.js に書き出す。
  boostStart は短い噴射の質感を保つため PCM WAV。--only 名前 はほかの生成済み音声を保持して更新する。
- 名前と長さの上限は下の SOUNDS。どの場面でどの音を使うかは index.html の SFX。
- 出典とライセンスは sounds/CREDITS.md に書く（CC BY の音は作者名の表示が必要）。
- 戦闘中BGM（sounds/music/<名前>.ogg）は手を加えずに base64 にして prototype/music.js に書き出す（繰り返しの継ぎ目が出ないよう再圧縮しない）。
"""
import argparse
import base64
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 名前: 長さの上限（秒）
SOUNDS = {
    "ar": 0.5,        # アサルトライフル・ガトリングの発射音
    "pistol": 0.5,    # 二丁拳銃
    "sniper": 1.5,    # 狙撃銃
    "shotgun": 1.2,   # ショットガン、防衛砲台（低く再生）
    "rocket": 1.2,    # ロケットの発射
    "explode": 2.0,   # 爆発（ロケット、砲弾、撃破、砲台やバリケードの破壊）
    "swing": 0.6,     # ソードを振る音（回転斬りは低く再生）
    "slash": 0.8,     # ソードが当たった金属音
    "hit": 0.5,       # 自分の弾が当たった音・撃たれた音
    "dash": 0.8,      # ブーストの噴射（ダッシュ、ジャンプ、カタパルト）
    "reload": 0.8,    # リロード、武器の持ち替え
    "beep": 0.4,      # ロックオン、プラント占拠
    "heal": 1.0,      # リペアユニット、リペアポッド
    "boostStart": 0.32,  # ユーザー提供動画から切り出した短い噴射
}

# 戦闘中BGM（v0.10、ユーザー指定の曲）。名前: ファイル
MUSIC = {
    "bgm": "bgm.ogg",  # OpenGameArt.org「Nightmare(prototype)」Centurion_of_war、CC0（出典は sounds/CREDITS.md）
}


def build_music(out: pathlib.Path):
    data = {}
    for name, file in MUSIC.items():
        data[name] = base64.b64encode((ROOT / "sounds" / "music" / file).read_bytes()).decode()
        print(f"{name}: {file} → {len(data[name]) * 3 // 4 // 1024} KB")
    body = ",\n".join(f'  {k}: "{v}"' for k, v in data.items())
    out.write_text(
        "// 戦闘中BGMのデータ（tools/build_sounds.py --music が sounds/music/ から作る。手で編集しない）。出典は sounds/CREDITS.md\n"
        f"window.MUSIC_DATA = {{\n{body}\n}};\n", encoding="utf-8")
    print("書き出し:", out)


def convert(src: pathlib.Path, limit: float, lossless: bool = False) -> bytes:
    trim = f"silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:{limit},afade=t=out:st={max(0, limit - 0.08)}:d=0.08"
    probe = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(src), "-af", trim + ",volumedetect", "-f", "null", "-"],
                           capture_output=True, text=True)
    m = re.search(r"max_volume: (-?[\d.]+) dB", probe.stderr)
    gain = -1.0 - float(m.group(1)) if m else 0.0  # 山を -1dB にそろえる
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / ("a.wav" if lossless else "a.mp3")
        codec = ["-c:a", "pcm_s16le"] if lossless else ["-b:a", "96k"]
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
                        "-af", f"{trim},volume={gain:.2f}dB", "-ac", "1", "-ar", "44100", *codec, str(out)], check=True)
        return out.read_bytes()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / "sounds" / "src"))
    ap.add_argument("--out", default=str(ROOT / "prototype" / "sounds.js"))
    ap.add_argument("--only", help="指定した音だけを更新（カンマ区切り）。ほかの生成済みデータは保持")
    ap.add_argument("--music", action="store_true", help="戦闘中BGMの music.js だけを作る")
    a = ap.parse_args()
    if a.music:
        return build_music(ROOT / "prototype" / "music.js")
    src = pathlib.Path(a.src)
    selected = set(a.only.split(",")) if a.only else set(SOUNDS)
    if selected - SOUNDS.keys():
        ap.error("知らない音: " + ",".join(sorted(selected - SOUNDS.keys())))
    data, missing = {}, []
    out = pathlib.Path(a.out)
    if a.only and out.exists():
        data.update(re.findall(r'^\s*(\w+): "([A-Za-z0-9+/=]+)"', out.read_text(encoding="utf-8"), re.M))
        if not data:
            ap.error("更新先の音声データを読めません: " + str(out))
    for name, limit in SOUNDS.items():
        if name not in selected:
            continue
        files = sorted(src.glob(name + ".*"))
        if not files:
            missing.append(name)
            continue
        data[name] = base64.b64encode(convert(files[0], limit, lossless=name == "boostStart")).decode()
        print(f"{name}: {files[0].name} → {len(data[name]) * 3 // 4 // 1024} KB")
    body = ",\n".join(f'  {k}: "{v}"' for k, v in data.items())
    pathlib.Path(a.out).write_text(
        "// 効果音のデータ（tools/build_sounds.py が sounds/src/ から作る。手で編集しない）。出典は sounds/CREDITS.md\n"
        f"window.SOUND_DATA = {{\n{body}\n}};\n", encoding="utf-8")
    print("書き出し:", a.out, "／ 無い音:", ", ".join(missing) or "なし")


if __name__ == "__main__":
    sys.exit(main())
