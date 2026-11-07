"""Android btsnoop_hci.log -> Gekoo-BLE-Verkehr als Text.

Aufruf: python3 tools/btsnoop_decode.py btsnoop_hci.log > session.txt
"""
import struct, sys
from collections import Counter, defaultdict

EPOCH_DELTA = 0x00dcddb30f2f8000  # btsnoop epoch (0 AD) -> unix, in us

def records(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'btsnoop\0', d[:8]
    ver, dlt = struct.unpack('>II', d[8:16])
    off = 16
    while off + 24 <= len(d):
        olen, ilen, flags, drops, ts = struct.unpack('>IIIIq', d[off:off+24])
        off += 24
        pkt = d[off:off+ilen]
        off += ilen
        t = (ts - EPOCH_DELTA) / 1e6
        yield t, flags, pkt

def att_packets(path):
    """Yield (time, direction, handle, att_bytes) for ATT over L2CAP CID 4. Reassemble simple ACL fragments."""
    frag = {}
    for t, flags, pkt in records(path):
        if not pkt: continue
        typ = pkt[0]
        if typ != 0x02:  # ACL
            yield t, 'hci', typ, pkt
            continue
        sent = (flags & 1) == 0  # 0 = sent (host->controller)
        h, ln = struct.unpack('<HH', pkt[1:5])
        conn = h & 0x0fff; pb = (h >> 12) & 3
        payload = pkt[5:5+ln]
        if pb in (0, 2):
            if len(payload) < 4: continue
            l2len, cid = struct.unpack('<HH', payload[:4])
            frag[(conn, sent)] = [l2len, cid, bytearray(payload[4:])]
        elif pb == 1:
            if (conn, sent) not in frag: continue
            frag[(conn, sent)][2] += payload
        f = frag.get((conn, sent))
        if f and len(f[2]) >= f[0]:
            l2len, cid, data = f
            del frag[(conn, sent)]
            yield t, 'TX' if sent else 'RX', (conn, cid), bytes(data[:l2len])



def dump(path, handle=0x12):
    """Gibt alle Writes/Notifies auf dem Gekoo-Characteristic als 'zeit RX|TX hex' aus
    (gleiches Format wie test/fixtures/session.txt)."""
    import datetime
    for t, d, h, p in att_packets(path):
        if d == 'hci' or h[1] != 4 or len(p) < 3:
            continue
        op = p[0]
        if op not in (0x52, 0x12, 0x1b):     # write cmd, write req, notify
            continue
        if struct.unpack('<H', p[1:3])[0] != handle:
            continue
        ts = datetime.datetime.fromtimestamp(t).strftime('%H:%M:%S.%f')[:-3]
        print(f"{ts} {'RX' if op == 0x1b else 'TX'} {p[3:].hex(' ')}".rstrip())


if __name__ == '__main__':
    dump(sys.argv[1])
