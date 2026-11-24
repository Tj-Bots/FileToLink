"""ByteStreamer reads chunks straight from the media session, in order, in parallel."""
import asyncio
from types import SimpleNamespace

from pyrogram import raw
from pyrogram.file_id import FileId, FileType

from Thunder.utils import custom_dl
from Thunder.utils.custom_dl import CHUNK, ByteStreamer

SIZE = 5 * CHUNK + 123
FILE_ID = FileId(file_type=FileType.DOCUMENT, dc_id=4, media_id=1, access_hash=2,
                 file_reference=b"ref").encode()


class FakeSession:
    def __init__(self):
        self.offsets = []
        self.in_flight = 0
        self.peak = 0

    async def invoke(self, query, sleep_threshold=None):
        self.offsets.append(query.offset)
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        # Later chunks answer first: order must still be preserved.
        await asyncio.sleep(0.01 * (10 - query.offset // CHUNK))
        self.in_flight -= 1
        n = max(0, min(CHUNK, SIZE - query.offset))
        return raw.types.upload.File(type=raw.types.storage.FilePartial(), mtime=0,
                                     bytes=bytes([query.offset // CHUNK]) * n)


def _streamer(session):
    client = SimpleNamespace(get_session=lambda dc_id, is_media: _ret(session),
                             stream_media=None)
    s = ByteStreamer.__new__(ByteStreamer)
    s.client = client
    s.chat_id = -1
    return s


async def _ret(v):
    return v


def _message():
    doc = SimpleNamespace(file_id=FILE_ID, file_size=SIZE)
    return SimpleNamespace(document=doc, media=True, id=7)


async def _collect(streamer, **kw):
    return [c async for c in streamer.stream_file(_message(), **kw)]


async def test_whole_file_in_order_with_parallel_requests(monkeypatch):
    monkeypatch.setattr(custom_dl, "get_media", lambda m: m.document)
    session = FakeSession()
    chunks = await _collect(_streamer(session))
    assert [c[0] for c in chunks] == [0, 1, 2, 3, 4, 5]
    assert sum(map(len, chunks)) == SIZE
    assert session.peak > 1, "requests must overlap"


async def test_range_reads_only_what_is_needed(monkeypatch):
    monkeypatch.setattr(custom_dl, "get_media", lambda m: m.document)
    session = FakeSession()
    chunks = await _collect(_streamer(session), offset=2 * CHUNK + 5, limit=CHUNK)
    assert [c[0] for c in chunks] == [2, 3]
    assert min(session.offsets) == 2 * CHUNK


async def test_falls_back_to_get_file_when_direct_path_is_unsupported(monkeypatch):
    monkeypatch.setattr(custom_dl, "get_media", lambda m: m.document)

    class CdnSession(FakeSession):
        async def invoke(self, query, sleep_threshold=None):
            return raw.types.upload.FileCdnRedirect(dc_id=1, file_token=b"", encryption_key=b"",
                                                   encryption_iv=b"", file_hashes=[])

    streamer = _streamer(CdnSession())

    async def stream_media(target, offset, limit):
        yield b"fallback"

    streamer.client.stream_media = stream_media
    assert await _collect(streamer) == [b"fallback"]
