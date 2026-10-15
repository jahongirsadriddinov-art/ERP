"""UDP chiqish tekshiruvi: STUN Binding so'rovi (RFC 5389). Telegram qo'ng'iroqlari UDP talab qiladi.

Javob kelsa — UDP chiqishi bor (tashqi manzil/port 'details'da ko'rsatilmaydi, faqat ok/vaqt).
"""
from __future__ import annotations

import asyncio
import os
import socket
import struct
import time

MAGIC = 0x2112A442


def build_request(txid: bytes) -> bytes:
    return struct.pack("!HHI", 0x0001, 0, MAGIC) + txid


def parse_response(data: bytes, txid: bytes) -> bool:
    if len(data) < 20:
        return False
    msg_type, _length, magic = struct.unpack("!HHI", data[:8])
    return msg_type == 0x0101 and magic == MAGIC and data[8:20] == txid


class _Proto(asyncio.DatagramProtocol):
    def __init__(self, txid: bytes, fut: asyncio.Future):
        self.txid, self.fut = txid, fut

    def datagram_received(self, data, addr):  # noqa: D401
        if not self.fut.done() and parse_response(data, self.txid):
            self.fut.set_result(True)

    def error_received(self, exc):
        if not self.fut.done():
            self.fut.set_result(False)


async def probe(host: str = "stun.l.google.com", port: int = 19302, timeout: float = 3.0, tries: int = 2) -> dict:
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_DGRAM, family=socket.AF_INET)
    except OSError:
        return {"ok": False, "details": "dns_failed"}
    addr = infos[0][4]
    for _ in range(max(1, tries)):
        txid = os.urandom(12)
        fut = loop.create_future()
        t0 = time.monotonic()
        try:
            transport, _ = await loop.create_datagram_endpoint(lambda: _Proto(txid, fut), remote_addr=addr)
        except OSError:
            return {"ok": False, "details": "socket_failed"}
        try:
            transport.sendto(build_request(txid))
            ok = await asyncio.wait_for(fut, timeout)
            if ok:
                return {"ok": True, "details": f"stun_rtt_ms={int((time.monotonic() - t0) * 1000)}"}
        except asyncio.TimeoutError:
            pass
        finally:
            transport.close()
    return {"ok": False, "details": "no_udp_response"}
