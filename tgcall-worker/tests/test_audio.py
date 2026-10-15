import asyncio

import numpy as np
import pytest

from app import audio as A


def test_frame_uuid_matches_backend_vector():
    # backend callBridge.sessionFrameUuid('0123456789abcdef01234567') bilan bir xil
    assert A.session_frame_uuid("0123456789ABCDEF01234567") == "01234567-89ab-cdef-0123-456700000000"
    with pytest.raises(ValueError):
        A.session_frame_uuid("xyz")


def test_encode_decode_roundtrip_and_flush():
    u = A.session_frame_uuid("0123456789abcdef01234567")
    pcm = b"\x01\x00" * 320
    f = A.encode_frame(u, 7, pcm)
    assert len(f) == A.HEADER_BYTES + len(pcm)
    assert f[16:20] == (7).to_bytes(4, "little")
    assert A.decode_frame(f) == (u, 7, pcm)
    fl = A.flush_frame(u)
    assert len(fl) == A.HEADER_BYTES
    assert A.decode_frame(fl) == (u, A.FLUSH_SEQ, b"")
    # Noto'g'ri kadrlar
    assert A.decode_frame(f[:10]) is None
    assert A.decode_frame(f + b"\x00") is None               # toq PCM
    assert A.decode_frame(A.encode_frame(u, 1, b"")) is None  # bo'sh, flush emas
    assert A.decode_frame(b"\x00" * (A.FRAME_MAX_BYTES + 2)) is None
    with pytest.raises(ValueError):
        A.encode_frame(u, 1, b"\x00")


def _sine(rate, ms, freq=440):
    t = np.arange(int(rate * ms / 1000)) / rate
    return (np.sin(2 * np.pi * freq * t) * 8000).astype(np.int16).tobytes()


def test_resample_lengths():
    src = _sine(48000, 100)
    out16 = A.resample_once(src, 48000, 16000)
    assert abs(len(out16) // 2 - 1600) <= 4
    out48 = A.resample_once(_sine(24000, 100), 24000, 48000)
    assert abs(len(out48) // 2 - 4800) <= 8


def test_stream_resampler_keeps_total_length():
    r = A.StreamResampler(48000, 16000)
    total = 0
    src = _sine(48000, 1000)
    for i in range(0, len(src), 960):
        total += len(r.process(src[i:i + 960]))
    # 1 s → ~16000 namuna (oqim kechikishi bir necha ms)
    assert 15000 <= total // 2 <= 16100


def test_stream_resampler_odd_bytes_buffered():
    r = A.StreamResampler(24000, 24000)
    assert r.process(b"\x01\x02\x03") == b"\x01\x02"
    assert r.process(b"\x04") == b"\x03\x04"


def test_chunker():
    c = A.Chunker(4)
    assert c.push(b"abc") == []
    assert c.push(b"defgh") == [b"abcd", b"efgh"]


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    async def sleep(self, s):
        self.t += s
        await asyncio.sleep(0)


async def test_paced_sender_pacing_and_silence_fill():
    clk = FakeClock()
    sent = []

    async def send(b):
        sent.append((clk.t, b))

    s = A.PacedSender(send, clock=clk, sleep=clk.sleep)
    s.push(b"\x01" * (A.TG_FRAME_BYTES * 2 + 100))
    await s.run(max_frames=5)
    assert [len(b) for _, b in sent] == [A.TG_FRAME_BYTES] * 5
    # 3-kadr: qoldiq + nol bilan to'ldirilgan; 4-5: sukunat
    assert sent[2][1][:100] == b"\x01" * 100 and sent[2][1][100:] == b"\0" * (A.TG_FRAME_BYTES - 100)
    assert sent[3][1] == b"\0" * A.TG_FRAME_BYTES
    assert s.silence_frames == 2
    # Har 10 ms
    times = [t for t, _ in sent]
    assert all(abs((b - a) - 0.01) < 1e-9 for a, b in zip(times, times[1:]))


async def test_paced_sender_flush_and_resync():
    clk = FakeClock()
    n = {"c": 0}

    async def send(_b):
        n["c"] += 1
        if n["c"] == 2:
            clk.t += 1.0   # kompyuter "qotdi"

    s = A.PacedSender(send, clock=clk, sleep=clk.sleep)
    s.push(b"\x01" * A.TG_FRAME_BYTES * 50)
    s.flush()
    assert s.buffered_ms == 0
    await s.run(max_frames=4)
    assert s.resyncs == 1


def test_paced_sender_buffer_cap():
    async def send(_b):
        pass

    s = A.PacedSender(send)
    s.push(b"\x00" * (s.MAX_BUFFER_BYTES + 1000))
    assert len(s._buf) <= s.MAX_BUFFER_BYTES
