"""CBP1 固定列を厳密に復元。展開・外部入出力は呼び出し元の責任。"""
import json
import math
import re

MAX_BYTES = 512 * 1024
DEFAULT_MAPS = ('city', 'dock', 'hoshimichi', 'kanto', 'mesa', 'mobility', 'tidal', 'wide')
SCHEMA = json.loads(r'''["object",[["schema",["literal",1]],["sessions",["array",["object",[["startedAt",["number",1000000000000000.0,false]],["version",["version"]],["protocol",["number",1000,true]],["role",["enum",["host","guest"]]],["ended",["bool"]],["droppedSamples",["number",1000000000000.0,false]],["droppedEvents",["number",1000000000000.0,false]],["lastMatch",["nullable",["object",[["elapsedMs",["number",1000000000000.0,false]],["code",["enum",["session_started","sample","peer_joined","peer_disconnected","peer_departed","match_interrupted","transport_error","signaling_lost","connection_ready","match_started","match_finished","lobby_returned","preparation_aborted","session_ended","page_hidden","page_visible","page_closed"]]],["reason",["enum",["none","other","local_leave","reconnect","host_left","kicked","rejected","full","version_mismatch","protocol_mismatch","connection_error","snapshot_channel_error","channel_closed","signaling_closed","signaling_error","peer_unavailable","network_error","browser_unsupported","connection_timeout","approval_timeout","response_timeout","input_timeout","host_timeout","prepare_timeout","prepare_peer_left","invalid_data","send_failed"]]],["data",["object",[["role",["enum",["host","guest"]]],["phase",["enum",["idle","lobby","preparing","countdown","playing","ended","leaving"]]],["humans",["number",100,true]],["capacity",["number",100,true]],["teamSize",["number",100,true]],["map",["map"]],["visibility",["enum",["visible","hidden","unknown"]]],["fps",["number",10000,true]],["frame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["cpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostFrame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostCpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["arrivals",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["snapshotAgeMs",["number",1000000000000.0,true]],["rttMs",["number",1000000000000.0,true]],["corrections",["object",[["count",["number",1000000000000.0,true]],["samples",["number",1000000000000.0,true]],["meanM",["number",1000000000000.0,true]],["maxM",["number",1000000000000.0,true]],["hardSnaps",["number",1000000000000.0,true]],["reasons",["counter",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other"]]]]]],["predictionBlocked",["enum",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other","none"]]],["blockedCorrections",["number",1000000000000.0,true]],["repeatDebt",["number",1000000000000.0,true]],["pendingInputs",["number",1000000000000.0,true]],["preventedLook",["object",[["count",["number",1000000000000.0,true]],["maxDeg",["number",1000000000000.0,true]]]]],["transport",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]],["connectedPeers",["number",1000000000000.0,true]],["pendingPeers",["number",1000000000000.0,true]],["maxBufferedBytes",["number",1000000000000.0,true]],["maxQueue",["number",1000000000000.0,true]],["bufferedBytes",["number",1000000000000.0,true]],["queue",["number",1000000000000.0,true]],["latencyMs",["number",1000000000000.0,true]],["snapshotDropRate",["number",1000000000000.0,true]],["inputDropRate",["number",1000000000000.0,true]],["rtt",["object",[["count",["number",1000000000000.0,true]],["minMs",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["control",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshot",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshotDrops",["counter",["artificial","stale","congestion","superseded","incomplete"]]],["inputDrops",["counter",["artificial","stale","duplicate","congestion","superseded","rateLimited"]]]]]],["interpolation",["object",[["acceptedSnapshots",["number",1000000000000.0,true]],["staleSnapshots",["number",1000000000000.0,true]],["missingBaselines",["number",1000000000000.0,true]],["resyncRequests",["number",1000000000000.0,true]],["interpolatedFrames",["number",1000000000000.0,true]],["extrapolatedFrames",["number",1000000000000.0,true]],["clampedFrames",["number",1000000000000.0,true]],["delayMs",["number",1000000000000.0,true]],["effectiveDelayMs",["number",1000000000000.0,true]],["maxGapMs",["number",1000000000000.0,true]]]]],["lagCompensation",["object",[["shots",["number",1000000000000.0,true]],["rewinds",["number",1000000000000.0,true]],["clamped",["number",1000000000000.0,true]],["rejected",["number",1000000000000.0,true]],["maxRewindMs",["number",1000000000000.0,true]]]]]]]]]]]],["lastConnection",["nullable",["object",[["elapsedMs",["number",1000000000000.0,false]],["code",["enum",["session_started","sample","peer_joined","peer_disconnected","peer_departed","match_interrupted","transport_error","signaling_lost","connection_ready","match_started","match_finished","lobby_returned","preparation_aborted","session_ended","page_hidden","page_visible","page_closed"]]],["reason",["enum",["none","other","local_leave","reconnect","host_left","kicked","rejected","full","version_mismatch","protocol_mismatch","connection_error","snapshot_channel_error","channel_closed","signaling_closed","signaling_error","peer_unavailable","network_error","browser_unsupported","connection_timeout","approval_timeout","response_timeout","input_timeout","host_timeout","prepare_timeout","prepare_peer_left","invalid_data","send_failed"]]],["data",["object",[["role",["enum",["host","guest"]]],["phase",["enum",["idle","lobby","preparing","countdown","playing","ended","leaving"]]],["humans",["number",100,true]],["capacity",["number",100,true]],["teamSize",["number",100,true]],["map",["map"]],["visibility",["enum",["visible","hidden","unknown"]]],["fps",["number",10000,true]],["frame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["cpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostFrame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostCpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["arrivals",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["snapshotAgeMs",["number",1000000000000.0,true]],["rttMs",["number",1000000000000.0,true]],["corrections",["object",[["count",["number",1000000000000.0,true]],["samples",["number",1000000000000.0,true]],["meanM",["number",1000000000000.0,true]],["maxM",["number",1000000000000.0,true]],["hardSnaps",["number",1000000000000.0,true]],["reasons",["counter",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other"]]]]]],["predictionBlocked",["enum",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other","none"]]],["blockedCorrections",["number",1000000000000.0,true]],["repeatDebt",["number",1000000000000.0,true]],["pendingInputs",["number",1000000000000.0,true]],["preventedLook",["object",[["count",["number",1000000000000.0,true]],["maxDeg",["number",1000000000000.0,true]]]]],["transport",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]],["connectedPeers",["number",1000000000000.0,true]],["pendingPeers",["number",1000000000000.0,true]],["maxBufferedBytes",["number",1000000000000.0,true]],["maxQueue",["number",1000000000000.0,true]],["bufferedBytes",["number",1000000000000.0,true]],["queue",["number",1000000000000.0,true]],["latencyMs",["number",1000000000000.0,true]],["snapshotDropRate",["number",1000000000000.0,true]],["inputDropRate",["number",1000000000000.0,true]],["rtt",["object",[["count",["number",1000000000000.0,true]],["minMs",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["control",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshot",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshotDrops",["counter",["artificial","stale","congestion","superseded","incomplete"]]],["inputDrops",["counter",["artificial","stale","duplicate","congestion","superseded","rateLimited"]]]]]],["interpolation",["object",[["acceptedSnapshots",["number",1000000000000.0,true]],["staleSnapshots",["number",1000000000000.0,true]],["missingBaselines",["number",1000000000000.0,true]],["resyncRequests",["number",1000000000000.0,true]],["interpolatedFrames",["number",1000000000000.0,true]],["extrapolatedFrames",["number",1000000000000.0,true]],["clampedFrames",["number",1000000000000.0,true]],["delayMs",["number",1000000000000.0,true]],["effectiveDelayMs",["number",1000000000000.0,true]],["maxGapMs",["number",1000000000000.0,true]]]]],["lagCompensation",["object",[["shots",["number",1000000000000.0,true]],["rewinds",["number",1000000000000.0,true]],["clamped",["number",1000000000000.0,true]],["rejected",["number",1000000000000.0,true]],["maxRewindMs",["number",1000000000000.0,true]]]]]]]]]]]],["samples",["array",["object",[["elapsedMs",["number",1000000000000.0,false]],["data",["object",[["role",["enum",["host","guest"]]],["phase",["enum",["idle","lobby","preparing","countdown","playing","ended","leaving"]]],["humans",["number",100,true]],["capacity",["number",100,true]],["teamSize",["number",100,true]],["map",["map"]],["visibility",["enum",["visible","hidden","unknown"]]],["fps",["number",10000,true]],["frame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["cpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostFrame",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["hostCpu",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["arrivals",["object",[["count",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["p95Ms",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["snapshotAgeMs",["number",1000000000000.0,true]],["rttMs",["number",1000000000000.0,true]],["corrections",["object",[["count",["number",1000000000000.0,true]],["samples",["number",1000000000000.0,true]],["meanM",["number",1000000000000.0,true]],["maxM",["number",1000000000000.0,true]],["hardSnaps",["number",1000000000000.0,true]],["reasons",["counter",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other"]]]]]],["predictionBlocked",["enum",["distance","accumulated","respawn","equipment","down","transfer","jumpPad","catapult","stun","electric","shock","history","disabled","melee","special","zip","repair","launch","lift","planted","inactive","smooth","other","none"]]],["blockedCorrections",["number",1000000000000.0,true]],["repeatDebt",["number",1000000000000.0,true]],["pendingInputs",["number",1000000000000.0,true]],["preventedLook",["object",[["count",["number",1000000000000.0,true]],["maxDeg",["number",1000000000000.0,true]]]]],["transport",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]],["connectedPeers",["number",1000000000000.0,true]],["pendingPeers",["number",1000000000000.0,true]],["maxBufferedBytes",["number",1000000000000.0,true]],["maxQueue",["number",1000000000000.0,true]],["bufferedBytes",["number",1000000000000.0,true]],["queue",["number",1000000000000.0,true]],["latencyMs",["number",1000000000000.0,true]],["snapshotDropRate",["number",1000000000000.0,true]],["inputDropRate",["number",1000000000000.0,true]],["rtt",["object",[["count",["number",1000000000000.0,true]],["minMs",["number",1000000000000.0,true]],["meanMs",["number",1000000000000.0,true]],["maxMs",["number",1000000000000.0,true]]]]],["control",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshot",["object",[["sentBytes",["number",1000000000000.0,true]],["receivedBytes",["number",1000000000000.0,true]],["sentMessages",["number",1000000000000.0,true]],["receivedMessages",["number",1000000000000.0,true]]]]],["snapshotDrops",["counter",["artificial","stale","congestion","superseded","incomplete"]]],["inputDrops",["counter",["artificial","stale","duplicate","congestion","superseded","rateLimited"]]]]]],["interpolation",["object",[["acceptedSnapshots",["number",1000000000000.0,true]],["staleSnapshots",["number",1000000000000.0,true]],["missingBaselines",["number",1000000000000.0,true]],["resyncRequests",["number",1000000000000.0,true]],["interpolatedFrames",["number",1000000000000.0,true]],["extrapolatedFrames",["number",1000000000000.0,true]],["clampedFrames",["number",1000000000000.0,true]],["delayMs",["number",1000000000000.0,true]],["effectiveDelayMs",["number",1000000000000.0,true]],["maxGapMs",["number",1000000000000.0,true]]]]],["lagCompensation",["object",[["shots",["number",1000000000000.0,true]],["rewinds",["number",1000000000000.0,true]],["clamped",["number",1000000000000.0,true]],["rejected",["number",1000000000000.0,true]],["maxRewindMs",["number",1000000000000.0,true]]]]]]]]]],300]],["events",["array",["object",[["elapsedMs",["number",1000000000000.0,false]],["code",["enum",["session_started","sample","peer_joined","peer_disconnected","peer_departed","match_interrupted","transport_error","signaling_lost","connection_ready","match_started","match_finished","lobby_returned","preparation_aborted","session_ended","page_hidden","page_visible","page_closed"]]],["reason",["enum",["none","other","local_leave","reconnect","host_left","kicked","rejected","full","version_mismatch","protocol_mismatch","connection_error","snapshot_channel_error","channel_closed","signaling_closed","signaling_error","peer_unavailable","network_error","browser_unsupported","connection_timeout","approval_timeout","response_timeout","input_timeout","host_timeout","prepare_timeout","prepare_peer_left","invalid_data","send_failed"]]],["phase",["enum",["idle","lobby","preparing","countdown","playing","ended","leaving"]]],["humans",["number",100,true]]]],128]]]],3]]]]''')


def _fail():
    raise ValueError('診断ログの形式または上限が不正です')


def _maps_option(maps):
    if maps is None:
        maps = DEFAULT_MAPS
    if type(maps) not in (list, tuple) or len(maps) > 256:
        _fail()
    for item in maps:
        if type(item) is not str or re.fullmatch(r'[-a-z0-9_]{1,48}', item) is None or item in ('__proto__', 'constructor', 'prototype'):
            _fail()
    return {'unknown', *maps}


def _array(v, limit):
    if type(v) is not list or len(v) > limit:
        _fail()


def _walk(d, v, maps, decode=True, depth=0):
    if depth > 16:
        _fail()
    kind = d[0]
    def next_value(s, x):
        return _walk(s, x, maps, decode, depth + 1)
    if kind == 'nullable':
        return None if v is None else next_value(d[1], v)
    if kind == 'object':
        fields = d[1]
        if decode:
            _array(v, len(fields))
            if len(v) != len(fields):
                _fail()
            return {k: next_value(s, v[i]) for i, (k, s) in enumerate(fields)}
        if type(v) is not dict or set(v) != {k for k, _ in fields}:
            _fail()
        return [next_value(s, v[k]) for k, s in fields]
    if kind == 'array':
        _array(v, d[2])
        return [next_value(d[1], x) for x in v]
    if kind == 'counter':
        keys = d[1]
        if decode:
            _array(v, len(keys))
            if len(v) != len(keys):
                _fail()
            return {k: next_value(['number', 1e12, False], v[i]) for i, k in enumerate(keys) if v[i] is not None}
        if type(v) is not dict or any(k not in keys for k in v):
            _fail()
        return [next_value(['number', 1e12, False], v[k]) if k in v else None for k in keys]
    if kind == 'number':
        if v is None and d[2]:
            return None
        if type(v) not in (int, float) or not 0 <= v <= d[1] or (type(v) is float and not math.isfinite(v)):
            _fail()
        return v
    if kind == 'enum':
        if type(v) is not str or v not in d[1]:
            _fail()
        return v
    if kind == 'map':
        if type(v) is not str or v not in maps:
            _fail()
        return v
    if kind == 'version':
        if type(v) is not str or (v != 'unknown' and re.fullmatch(r'Ver[0-9]{1,6}', v) is None):
            _fail()
        return v
    if kind == 'bool':
        if type(v) is not bool:
            _fail()
        return v
    if kind == 'literal':
        if type(v) not in (int, float) or v != d[1]:
            _fail()
        return v
    _fail()


def _size(value):
    if len(json.dumps(value, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode('utf-8')) > MAX_BYTES:
        _fail()


def unpack(payload, maps=None):
    """Return schema1 dict. Only bounded decoded CBP1 arrays are accepted."""
    _array(payload, 2)
    if len(payload) != 2 or type(payload[0]) is not str or payload[0] != 'CBP1':
        _fail()
    result = _walk(SCHEMA, payload[1], _maps_option(maps))
    _size(result)
    return result


def pack(value, maps=None):
    """Reference encoder for tests; unknown object keys fail closed."""
    encoded = _walk(SCHEMA, value, _maps_option(maps), False)
    _size(value)
    return ['CBP1', encoded]


def strict_json_loads(text):
    """Caller must cap bytes before parsing. Duplicate keys/nonfinite numbers fail."""
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result or key in ('__proto__', 'constructor', 'prototype'):
                _fail()
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=pairs, parse_constant=lambda _: _fail())
