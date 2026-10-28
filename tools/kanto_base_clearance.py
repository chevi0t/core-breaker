"""青基地の切欠きで残った、北側の薄い17m棟を除く。"""
import base64
import struct


def remove_north_sliver(data):
    removed = []
    for v in data['volumes']:
        if data['volumeKinds'][v[0]] != 'grounded' or v[1:3] != [-1, 17]:
            continue
        points = list(struct.iter_unpack('<hh', base64.b64decode(v[3][0])))
        step = data['ringCoordinateStep']
        bounds = [min(p[0] for p in points)*step, max(p[0] for p in points)*step,
                  min(p[1] for p in points)*step, max(p[1] for p in points)*step]
        if all(abs(a-b) < .021 for a,b in zip(bounds, [-158.5,-139.23,174.35,181.73])):
            removed.append(v)
    assert len(removed) <= 1, '北側の薄い棟が複数あるため要確認'
    for v in removed:
        data['volumes'].remove(v)
    return len(removed)
