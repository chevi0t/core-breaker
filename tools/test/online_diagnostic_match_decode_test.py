#!/usr/bin/env python3
"""CBL3の独立生成・安全な復元と、旧CBL2との互換性を標準Pythonだけで検査する。"""
import base64
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from decode_diagnostic_log import decode
from diagnostic_log_format import pack


# 復元器の定数を使い回さず、形式の並びと欠落表現も独立に確認する。
EVENTS = (
    'session_started', 'sample', 'peer_joined', 'peer_disconnected',
    'peer_departed', 'match_interrupted', 'transport_error', 'signaling_lost',
    'connection_ready', 'match_started', 'match_finished', 'lobby_returned',
    'preparation_aborted', 'session_ended', 'page_hidden', 'page_visible', 'page_closed',
)
REASONS = (
    'none', 'other', 'local_leave', 'reconnect', 'host_left', 'kicked',
    'rejected', 'full', 'version_mismatch', 'protocol_mismatch',
    'connection_error', 'snapshot_channel_error', 'channel_closed',
    'signaling_closed', 'signaling_error', 'peer_unavailable', 'network_error',
    'browser_unsupported', 'connection_timeout', 'approval_timeout',
    'response_timeout', 'input_timeout', 'host_timeout', 'prepare_timeout',
    'prepare_peer_left', 'invalid_data', 'send_failed',
)
MISSING_FLOAT = bytes.fromhex('000000000000f87f')


def deflate(raw):
    compressor = zlib.compressobj(9, wbits=-15)
    return compressor.compress(raw) + compressor.flush()


def token(raw, method='B', content=None):
    raw = bytes(raw)
    if content is None:
        content = deflate(raw) if method == 'Z' else raw
    encoded = base64.urlsafe_b64encode(content).decode('ascii').rstrip('=')
    return f'CBL3.{method}.{zlib.crc32(raw) & 0xffffffff:08x}.{encoded}'


def legacy_token(method, payload):
    raw = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    size = ''
    number = len(raw)
    while number:
        number, remainder = divmod(number, 36)
        size = '0123456789abcdefghijklmnopqrstuvwxyz'[remainder] + size
    encoded = base64.urlsafe_b64encode(deflate(raw)).decode('ascii').rstrip('=')
    return f'CBL2.{method}.{size}.{zlib.crc32(raw) & 0xffffffff:08x}.{encoded}'


class MatchDecodeTest(unittest.TestCase):
    def setUp(self):
        self.raw = bytearray(152)
        self.raw[:8] = bytes([1, 1, 4, 5, 22, 4, 0, 0])
        struct.pack_into('<IHH', self.raw, 8, 179, 9, 2)
        for index, offset in enumerate(range(16, 144, 8)):
            struct.pack_into('<d', self.raw, offset, index * 1.125)
        struct.pack_into('<HHHH', self.raw, 144, 302, 130, 130, 0)
        self.text = token(self.raw)

    def reject(self, text):
        with self.assertRaises(ValueError):
            decode(text)

    def test_normal_binary_and_deflate(self):
        result = decode(self.text)
        self.assertEqual(len(self.text), 219)
        self.assertEqual(result['format'], 'CBM1')
        self.assertTrue(result['selectedOnly'])
        self.assertEqual(result['scope'], 'current_match')
        self.assertEqual(result['version'], 'Ver179')
        self.assertEqual(result['event'], {
            'code': 'match_interrupted', 'reason': 'host_timeout', 'elapsedMs': 1.125,
        })
        self.assertEqual(result['extrema'], dict(zip((
            'fpsMin', 'frameMaxMs', 'cpuMaxMs', 'rttMaxMs', 'snapshotAgeMaxMs',
            'correctionMaxM', 'hardSnapsMaxPerWindow', 'queueMax', 'bufferedMaxBytes',
        ), [index * 1.125 for index in range(2, 11)])))
        self.assertEqual(result['representative'], dict(zip((
            'elapsedMs', 'fps', 'rttMs', 'snapshotAgeMs', 'correctionMaxM',
        ), [index * 1.125 for index in range(11, 16)])))
        self.assertEqual(result['observationCount'], 302)
        self.assertEqual(result['eventCount'], 130)
        self.assertEqual(result['faultCount'], 130)
        self.assertEqual(decode(token(self.raw, 'Z')), result)
        self.assertEqual(decode(' \n' + self.text[:40] + '\r\n' + self.text[40:] + '\t'), result)

    def test_scopes_and_flags(self):
        for flags, scope in [(1, 'current_match'), (9, 'last_match'), (17, 'no_match'),
                             (33, 'no_session'), (49, 'no_session')]:
            with self.subTest(flags=flags):
                raw = self.raw.copy()
                raw[0] = flags
                self.assertEqual(decode(token(raw))['scope'], scope)
        for bit, name in [(2, 'scopeBoundaryMissing'), (4, 'retentionDropped'), (64, 'invalidScalar')]:
            with self.subTest(flag=name):
                raw = self.raw.copy()
                raw[0] |= bit
                self.assertTrue(decode(token(raw))[name])

    def test_all_enum_values(self):
        fields = [
            (1, ('host', 'guest'), 'role'),
            (2, ('idle', 'lobby', 'preparing', 'countdown', 'playing', 'ended', 'leaving'), 'phase'),
            (3, EVENTS, 'code'), (4, REASONS, 'reason'),
            (5, ('city', 'dock', 'hoshimichi', 'kanto', 'mesa', 'mobility', 'tidal', 'wide'), 'map'),
            (6, ('visible', 'hidden', 'unknown'), 'visibility'),
        ]
        for offset, choices, key in fields:
            for index, expected in enumerate(choices):
                with self.subTest(field=key, index=index):
                    raw = self.raw.copy()
                    raw[offset] = index
                    result = decode(token(raw))
                    self.assertEqual(result['event'][key] if offset in (3, 4) else result[key], expected)

    def test_canonical_missing_values(self):
        raw = self.raw.copy()
        raw[1:6] = b'\xff' * 5
        raw[6] = 2
        struct.pack_into('<IHH', raw, 8, 0xffffffff, 65535, 65535)
        for offset in range(16, 144, 8):
            raw[offset:offset + 8] = MISSING_FLOAT
        result = decode(token(raw))
        for key in ('version', 'role', 'phase', 'map'):
            self.assertEqual(result[key], 'unknown')
        for key in ('protocol', 'humans', 'durationMs'):
            self.assertIsNone(result[key])
        self.assertEqual(result['event'], {'code': 'none', 'reason': 'none', 'elapsedMs': None})
        self.assertTrue(all(value is None for value in result['extrema'].values()))
        self.assertTrue(all(value is None for value in result['representative'].values()))

    def test_header_crc_base64_and_text_limit(self):
        text = self.text
        bad_tokens = [
            text + '=', text + 'A', text[:-1], text.replace('.B.', '.Q.'),
            text.replace('CBL3', 'CBL4'), text.replace(text.split('.')[2], 'FFFFFFFF'),
            text.replace(text.split('.')[2], '00000000'), text + 'A' * (242 - len(text)),
        ]
        alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
        # 復号結果が同じでも、使われない末尾ビットが0でないbase64は拒否する。
        bad_tokens.append(text[:-1] + alphabet[alphabet.index(text[-1]) + 1])
        for bad in bad_tokens:
            with self.subTest(text=bad):
                self.reject(bad)

    def test_reserved_fields_and_invalid_enums(self):
        for offset, value in [(0, 0), (0, 129), (7, 1), (150, 1), (151, 1),
                              (1, 2), (2, 7), (3, 17), (4, 27), (5, 8), (6, 3), (6, 255)]:
            with self.subTest(offset=offset, value=value):
                raw = self.raw.copy()
                raw[offset] = value
                self.reject(token(raw))

    def test_integer_bounds_and_counts(self):
        for offset, fmt, value in [(8, '<I', 1000000), (8, '<I', 0xfffffffe),
                                   (12, '<H', 1001), (14, '<H', 101), (144, '<H', 303),
                                   (146, '<H', 131), (148, '<H', 131)]:
            with self.subTest(offset=offset, value=value):
                raw = self.raw.copy()
                struct.pack_into(fmt, raw, offset, value)
                self.reject(token(raw))
        raw = self.raw.copy()
        struct.pack_into('<HH', raw, 146, 0, 1)
        self.reject(token(raw))
        for version, protocol, humans in [(0, 0, 0), (999999, 1000, 100)]:
            raw = self.raw.copy()
            struct.pack_into('<IHH', raw, 8, version, protocol, humans)
            result = decode(token(raw))
            self.assertEqual((result['version'], result['protocol'], result['humans']),
                             (f'Ver{version}', protocol, humans))

    def test_float_bounds_nonfinite_and_noncanonical_nan(self):
        for offset in range(16, 144, 8):
            for value in (-1, 1e12 + 1, float('inf'), -float('inf')):
                with self.subTest(offset=offset, value=value):
                    raw = self.raw.copy()
                    struct.pack_into('<d', raw, offset, value)
                    self.reject(token(raw))
            for value in (0, 1e12):
                with self.subTest(offset=offset, valid=value):
                    raw = self.raw.copy()
                    struct.pack_into('<d', raw, offset, value)
                    decode(token(raw))
            for noncanonical in ('010000000000f87f', '000000000000f8ff', '010000000000f07f'):
                with self.subTest(offset=offset, nan=noncanonical):
                    raw = self.raw.copy()
                    raw[offset:offset + 8] = bytes.fromhex(noncanonical)
                    self.reject(token(raw))

    def test_fixed_length_bombs_truncation_and_trailing_data(self):
        for raw in (self.raw[:-1], self.raw + b'\0', self.raw + b'x' * 5000):
            for method in ('B', 'Z'):
                with self.subTest(length=len(raw), method=method):
                    self.reject(token(raw, method))
        compressed = deflate(self.raw)
        for bad in (compressed[:-1], compressed + b'x', compressed + compressed,
                    zlib.compress(self.raw), b'not deflate'):
            with self.subTest(compressed=bad):
                self.reject(token(self.raw, 'Z', bad))

    def test_legacy_binary_and_selected_formats(self):
        original = {'schema': 1, 'sessions': []}
        legacy = pack(original)
        self.assertEqual(decode(legacy_token('D', legacy)), original)
        self.assertEqual(decode(legacy_token('S', ['CBS1', [0, 0, 0, 0], [], legacy]))['data'], original)

    def test_cli_creates_json_without_overwriting(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'out.json'
            command = [sys.executable, str(TOOLS / 'decode_diagnostic_log.py'), '--output', str(destination)]
            first = subprocess.run(command, input=self.text, text=True, capture_output=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(json.loads(destination.read_text(encoding='utf-8')), decode(self.text))
            self.assertIn('1試合', first.stderr)
            before = destination.read_bytes()
            second = subprocess.run(command, input=self.text, text=True, capture_output=True)
            self.assertEqual(second.returncode, 1, second.stderr)
            self.assertEqual(destination.read_bytes(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
