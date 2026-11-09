#!/usr/bin/env python3
"""CBL2の診断データを端末内で復元する。圧縮は暗号・署名ではない。

python3 tools/decode_diagnostic_log.py compressed.txt --output restored.json
入力省略または - は標準入力。出力先なしは標準出力。既存ファイルは上書きしない。
ネットワーク、eval、pickle、アーカイブ展開、入力内のパスは使わない。
"""
import argparse
import base64
import binascii
import json
import math
import re
import sys
import zlib

from diagnostic_log_format import unpack, strict_json_loads

MAX_TEXT = 256 * 1024
MAX_INPUT = MAX_TEXT + 8192  # 掲示板で入った改行・空白の分も有界
MAX_PACKED = 512 * 1024
MAX_JSON = 512 * 1024
HEADER = re.compile(r"CBL2\.([DS])\.([1-9a-z][0-9a-z]{0,5})\.([0-9a-f]{8})\.([A-Za-z0-9_-]+)", re.ASCII)


def decode(text):
    if not isinstance(text, str) or len(text) > MAX_INPUT:
        raise ValueError("入力上限を超えています")
    text = re.sub(r"[ \t\r\n]", "", text)
    if len(text) > MAX_TEXT:
        raise ValueError("圧縮テキストの上限を超えています")
    match = HEADER.fullmatch(text)
    if not match:
        raise ValueError("形式が不正です。CBL2から始まる全文が必要です")
    method, size36, checksum, encoded = match.groups()
    if method == "S" and len(text) > 6000:
        raise ValueError("掲示板用ログが6000字を超えています")
    size = int(size36, 36)
    if not 0 < size <= MAX_PACKED:
        raise ValueError("展開サイズが上限外です")
    try:
        compressed = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("base64urlが不正です") from exc
    if base64.urlsafe_b64encode(compressed).decode("ascii").rstrip("=") != encoded:
        raise ValueError("base64urlの末尾が不正です")
    inflater = zlib.decompressobj(wbits=-15)
    try:
        packed = inflater.decompress(compressed, size + 1)
    except zlib.error as exc:
        raise ValueError("圧縮データが壊れています") from exc
    # flush()で無制限に追加展開しない。上限超過・打切り・連結streamを全て拒否。
    if len(packed) != size or not inflater.eof or inflater.unconsumed_tail or inflater.unused_data:
        raise ValueError("展開サイズ不一致、打切り、または余分なデータがあります")
    if f"{zlib.crc32(packed) & 0xffffffff:08x}" != checksum:
        raise ValueError("CRC不一致です。内容が変化しています")
    try:
        payload = strict_json_loads(packed.decode("utf-8", errors="strict"))
        if method == 'D':
            result = unpack(payload)
        else:
            if type(payload) is not list or len(payload) != 4 or payload[0] != 'CBS1':
                raise ValueError('選別ログの形式が不正です')
            counts, extrema, body = payload[1:]
            if type(counts) is not list or len(counts) != 4 or any(type(n) is not int or not 0 <= n <= limit for n, limit in zip(counts, [3, 900, 384, 6])):
                raise ValueError('省略件数が不正です')
            if type(extrema) is not list or len(extrema) > 9:
                raise ValueError('極値の形式が不正です')
            names = ['fps_min', 'frame_max_ms', 'cpu_max_ms', 'rtt_max_ms', 'snapshot_age_max_ms', 'correction_max_m', 'hard_snaps_max_per_window', 'queue_max', 'buffered_max_bytes']
            peaks = {}; seen = set()
            for peak in extrema:
                if type(peak) is not list or len(peak) != 3 or type(peak[0]) is not int or not 0 <= peak[0] < len(names) or peak[0] in seen or any(type(n) not in (int, float) or not math.isfinite(n) or not 0 <= n <= 1e12 for n in peak[1:]):
                    raise ValueError('極値の値が不正です')
                seen.add(peak[0]); peaks[names[peak[0]]] = {'value': peak[1], 'elapsedMs': peak[2]}
            data = unpack(body)
            if len(data['sessions']) > 1:
                raise ValueError('選別ログの接続数が不正です')
            selected = [len(data['sessions']), sum(len(s['samples']) for s in data['sessions']), sum(len(s['events']) for s in data['sessions']), sum((s['lastMatch'] is not None) + (s['lastConnection'] is not None) for s in data['sessions'])]
            if any(a < b for a, b in zip(counts, selected)):
                raise ValueError('省略件数が不正です')
            keys = ['sessions', 'samples', 'events', 'boundaries']
            result = {'format': 'CBS1', 'originalRetained': dict(zip(keys, counts)), 'omittedForSharing': dict(zip(keys, [a-b for a,b in zip(counts,selected)])), 'extremaOfSelectedSession': peaks, 'data': data}
    except (UnicodeError, RecursionError, TypeError, KeyError, IndexError, OverflowError) as exc:
        raise ValueError("診断データの構造が不正です") from exc
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_JSON:
        raise ValueError("復元JSONが保存上限を超えています")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", default="-")
    parser.add_argument("--output", help="復元JSONの新規ファイル（既存ファイルは上書きしません）")
    args = parser.parse_args()
    try:
        if args.input == "-":
            raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        else:
            with open(args.input, "rb") as handle:
                raw = handle.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise ValueError("入力上限を超えています")
        restored = decode(raw.decode("ascii", errors="strict"))
        output = json.dumps(restored, ensure_ascii=False, separators=(',', ':'))
        if args.output:
            with open(args.output, "x", encoding="utf-8") as handle:
                handle.write(output)
        else:
            sys.stdout.write(output)
        print("復元成功。CRCは破損検査であり、改ざん防止・本人確認ではありません。保持上限は3接続・各300標本/128イベント・512KiB・7日。droppedSamples/droppedEventsは保持時に省かれた件数です。", file=sys.stderr)
    except (ValueError, OSError, UnicodeError, RecursionError) as exc:
        print("復元失敗: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
