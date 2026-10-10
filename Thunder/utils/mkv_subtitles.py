# Thunder/utils/mkv_subtitles.py
#
# Pure-Python Matroska (EBML) reader for embedded text subtitle tracks.
#
# There is no ffmpeg/mkvextract on this project's typical host (Heroku's
# standard buildpack has no apt-get), so this reads the container itself:
# the Tracks list to find subtitle streams, and the Cues index to jump
# straight to the subtitle blocks of a given time window (see "Indexed,
# windowed subtitle extraction" below).
#
# Scope: text-based subtitle codecs only (S_TEXT/UTF8 "SRT", S_TEXT/ASS,
# S_TEXT/SSA, S_TEXT/WEBVTT). Bitmap subtitle codecs (S_HDMV/PGS, S_VOBSUB)
# carry images, not text - they're skipped.

import asyncio
import re
import time
import zlib
from typing import Any, AsyncGenerator, Dict, List, Optional

from Thunder.utils.logger import logger

# ---- EBML / Matroska element IDs we care about -----------------------------

ID_EBML_HEADER = 0x1A45DFA3
ID_SEGMENT = 0x18538067
ID_SEEK_HEAD = 0x114D9B74
ID_SEEK = 0x4DBB
ID_SEEK_ID = 0x53AB
ID_SEEK_POSITION = 0x53AC
ID_INFO = 0x1549A966
ID_TIMECODE_SCALE = 0x2AD7B1
ID_TRACKS = 0x1654AE6B
ID_TRACK_ENTRY = 0xAE
ID_TRACK_NUMBER = 0xD7
ID_TRACK_TYPE = 0x83
ID_CODEC_ID = 0x86
ID_LANGUAGE = 0x22B59C
ID_LANGUAGE_IETF = 0x22B59D
ID_NAME = 0x536E
ID_CONTENT_ENCODINGS = 0x6D80
ID_CONTENT_ENCODING = 0x6240
ID_CONTENT_COMPRESSION = 0x5034
ID_CONTENT_COMP_ALGO = 0x4254
ID_CLUSTER = 0x1F43B675
ID_TIMECODE = 0xE7
ID_SIMPLE_BLOCK = 0xA3
ID_BLOCK_GROUP = 0xA0
ID_BLOCK = 0xA1
ID_BLOCK_DURATION = 0x9B
ID_CUES = 0x1C53BB6B

TRACK_TYPE_VIDEO = 1
TRACK_TYPE_AUDIO = 2
TRACK_TYPE_SUBTITLE = 17

TEXT_SUBTITLE_CODECS = {"S_TEXT/UTF8", "S_TEXT/ASS", "S_TEXT/SSA", "S_TEXT/WEBVTT"}

class _ParseGiveUp(Exception):
    """Internal: stop parsing cleanly (cap/timeout/EOF), keep what we have."""


class _AsyncByteReader:
    """Buffers an async chunk generator so EBML elements (which don't align to
    chunk boundaries) can be read with ordinary read(n)/peek(n) calls."""

    def __init__(self, chunks: AsyncGenerator[bytes, None]):
        self._chunks = chunks
        self._buf = bytearray()
        self._pos = 0  # bytes consumed, for diagnostics/caps
        self._exhausted = False

    async def _fill(self, n: int) -> None:
        while len(self._buf) < n and not self._exhausted:
            try:
                chunk = await self._chunks.__anext__()
            except StopAsyncIteration:
                self._exhausted = True
                break
            if chunk:
                self._buf += chunk

    async def read(self, n: int) -> bytes:
        await self._fill(n)
        data = bytes(self._buf[:n])
        del self._buf[:n]
        self._pos += len(data)
        if len(data) < n:
            raise _ParseGiveUp("Unexpected end of stream")
        return data

    async def skip(self, n: int) -> None:
        remaining = n
        while remaining > 0:
            take = min(remaining, max(len(self._buf), 65536))
            data = await self.read(min(take, remaining))
            remaining -= len(data)

    @property
    def position(self) -> int:
        return self._pos


# ---- EBML variable-length integer parsing ----------------------------------

async def _read_vint(reader: _AsyncByteReader, keep_marker: bool) -> int:
    first = (await reader.read(1))[0]
    if first == 0:
        raise _ParseGiveUp("Invalid VINT (zero first byte)")
    length = 1
    mask = 0x80
    while not (first & mask):
        length += 1
        mask >>= 1
        if length > 8:
            raise _ParseGiveUp("Invalid VINT (too long)")
    if keep_marker:
        value = first
    else:
        value = first & (mask - 1)
    if length > 1:
        rest = await reader.read(length - 1)
        for b in rest:
            value = (value << 8) | b
    return value


async def _read_element_header(reader: _AsyncByteReader):
    element_id = await _read_vint(reader, keep_marker=True)
    size = await _read_vint(reader, keep_marker=False)
    return element_id, size


def _parse_signed_int(data: bytes) -> int:
    if not data:
        return 0
    value = int.from_bytes(data, "big", signed=False)
    bits = len(data) * 8
    if value >= (1 << (bits - 1)):
        value -= 1 << bits
    return value


def _parse_uint(data: bytes) -> int:
    return int.from_bytes(data, "big", signed=False) if data else 0


# ---- Track list ---------------------------------------------------------

async def _parse_tracks(reader: _AsyncByteReader, tracks_size: int) -> List[Dict[str, Any]]:
    end_pos = reader.position + tracks_size
    tracks: List[Dict[str, Any]] = []
    while reader.position < end_pos:
        eid, size = await _read_element_header(reader)
        if eid == ID_TRACK_ENTRY:
            entry_end = reader.position + size
            track: Dict[str, Any] = {
                "number": None, "type": "other", "codec": None,
                "language": None, "name": None,
            }
            while reader.position < entry_end:
                cid, csize = await _read_element_header(reader)
                if cid == ID_TRACK_NUMBER:
                    track["number"] = _parse_uint(await reader.read(csize))
                elif cid == ID_TRACK_TYPE:
                    ttype = _parse_uint(await reader.read(csize))
                    track["type"] = {
                        TRACK_TYPE_VIDEO: "video",
                        TRACK_TYPE_AUDIO: "audio",
                        TRACK_TYPE_SUBTITLE: "subtitle",
                    }.get(ttype, "other")
                elif cid == ID_CODEC_ID:
                    track["codec"] = (await reader.read(csize)).decode("ascii", "replace")
                elif cid in (ID_LANGUAGE, ID_LANGUAGE_IETF):
                    track["language"] = (await reader.read(csize)).decode("ascii", "replace")
                elif cid == ID_NAME:
                    track["name"] = (await reader.read(csize)).decode("utf-8", "replace")
                elif cid == ID_CONTENT_ENCODINGS:
                    track["zlib"] = await _has_zlib_compression(reader, csize)
                else:
                    await reader.skip(csize)
            if track["number"] is not None:
                tracks.append(track)
        else:
            await reader.skip(size)
    return tracks


async def _has_zlib_compression(reader: _AsyncByteReader, size: int) -> bool:
    end_pos = reader.position + size
    found = False
    while reader.position < end_pos:
        eid, esize = await _read_element_header(reader)
        if eid == ID_CONTENT_ENCODING:
            enc_end = reader.position + esize
            while reader.position < enc_end:
                cid, csize = await _read_element_header(reader)
                if cid == ID_CONTENT_COMPRESSION:
                    comp_end = reader.position + csize
                    while reader.position < comp_end:
                        ccid, ccsize = await _read_element_header(reader)
                        if ccid == ID_CONTENT_COMP_ALGO:
                            algo = _parse_uint(await reader.read(ccsize))
                            found = algo == 0  # 0 == zlib
                        else:
                            await reader.skip(ccsize)
                else:
                    await reader.skip(csize)
        else:
            await reader.skip(esize)
    return found


# ---- Subtitle cue extraction -------------------------------------------

_ASS_OVERRIDE = re.compile(r"\{[^}]*\}")
def _ass_dialogue_text(payload: str) -> Optional[str]:
    # Matroska stores ASS/SSA payload as the Dialogue line's fields after
    # ReadOrder, i.e. "Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text".
    parts = payload.split(",", 8)
    if len(parts) < 9:
        return None
    text = parts[8]
    text = _ASS_OVERRIDE.sub("", text)
    text = text.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
    return text.strip() or None


class _Cue:
    __slots__ = ("start_ms", "end_ms", "text")

    def __init__(self, start_ms: int, end_ms: int, text: str):
        self.start_ms = start_ms
        self.end_ms = end_ms
        self.text = text


async def _parse_info(reader: _AsyncByteReader, size: int, default_scale: int) -> int:
    end_pos = reader.position + size
    scale = default_scale
    while reader.position < end_pos:
        cid, csize = await _read_element_header(reader)
        if cid == ID_TIMECODE_SCALE:
            scale = _parse_uint(await reader.read(csize)) or default_scale
        else:
            await reader.skip(csize)
    return scale


async def _parse_block_group(
    reader: _AsyncByteReader, size: int, track_number: int,
    cluster_timecode: int, timecode_scale: int, codec: str, use_zlib: bool,
) -> Optional["_Cue"]:
    end_pos = reader.position + size
    block_bytes: Optional[bytes] = None
    duration_ticks: Optional[int] = None
    while reader.position < end_pos:
        cid, csize = await _read_element_header(reader)
        if cid == ID_BLOCK:
            block_bytes = await reader.read(csize)
        elif cid == ID_BLOCK_DURATION:
            duration_ticks = _parse_uint(await reader.read(csize))
        else:
            await reader.skip(csize)
    if block_bytes is None:
        return None
    duration_ms = None
    if duration_ticks is not None:
        duration_ms = duration_ticks * timecode_scale // 1_000_000
    return _decode_block(
        block_bytes, track_number, cluster_timecode, timecode_scale,
        codec, use_zlib, default_duration_ms=duration_ms or 2000,
    )


def _decode_block(
    block: bytes, wanted_track: int, cluster_timecode: int, timecode_scale: int,
    codec: str, use_zlib: bool, default_duration_ms: int,
) -> Optional["_Cue"]:
    try:
        pos = 0
        track_num, consumed = _read_vint_from_bytes(block, pos)
        pos += consumed
        if track_num != wanted_track:
            return None
        rel_timecode = int.from_bytes(block[pos:pos + 2], "big", signed=True)
        pos += 2
        flags = block[pos]
        pos += 1
        lacing = (flags >> 1) & 0x03
        if lacing != 0:
            # Lacing is for audio/video frame batching; text subtitle blocks
            # are practically always unlaced, one cue per block. Bail rather
            # than risk misreading rather than guess at a lacing layout.
            return None
        payload = block[pos:]
        if use_zlib:
            try:
                payload = zlib.decompress(payload)
            except Exception:
                pass
        if codec == "S_TEXT/ASS" or codec == "S_TEXT/SSA":
            text = _ass_dialogue_text(payload.decode("utf-8", "replace"))
        else:
            text = payload.decode("utf-8", "replace").strip()
        if not text:
            return None
        start_ms = (cluster_timecode + rel_timecode) * timecode_scale // 1_000_000
        end_ms = start_ms + max(default_duration_ms, 500)
        return _Cue(start_ms, end_ms, text)
    except Exception:
        return None


def _read_vint_from_bytes(data: bytes, pos: int):
    first = data[pos]
    if first == 0:
        raise ValueError("Invalid VINT")
    length = 1
    mask = 0x80
    while not (first & mask):
        length += 1
        mask >>= 1
    value = first & (mask - 1)
    for i in range(1, length):
        value = (value << 8) | data[pos + i]
    return value, length


# ---- Indexed, windowed subtitle extraction ---------------------------------
#
# Reading every Cluster to collect one subtitle track means streaming the
# whole movie from Telegram before a single line can be shown - minutes for
# a feature film, far past Heroku's 30 s request limit. Instead:
#
#   1. Read the file head once (SeekHead/Info/Tracks) and the Cues index
#      (usually a few hundred KB at the end of the file).
#   2. For a time window, read only the bytes of the subtitle blocks the
#      index points at (mkvmerge and ffmpeg both index every subtitle block
#      with CueClusterPosition + CueRelativePosition).
#   3. If a file doesn't index its subtitle blocks, start at the indexed
#      cluster nearest the window and scan just that window's clusters.
#
# All reads go through `fetch(chunk_index) -> bytes`, one 1 MiB chunk at a
# time (Telegram's download granularity), supplied by the caller.

CHUNK_SIZE = 1024 * 1024

ID_CUE_POINT = 0xBB
ID_CUE_TIME = 0xB3
ID_CUE_TRACK_POSITIONS = 0xB7
ID_CUE_TRACK = 0xF7
ID_CUE_CLUSTER_POSITION = 0xF1
ID_CUE_RELATIVE_POSITION = 0xF0
ID_CUE_DURATION = 0xB2

WINDOW_MS = 60_000
_LOOKBEHIND_MS = 10_000
_HEAD_MAX_CHUNKS = 48
_CUES_MAX_CHUNKS = 16
_LINEAR_MAX_BYTES = 160 * CHUNK_SIZE
_WINDOW_TIMEOUT = 22.0
_FETCH_CONCURRENCY = 6


class MkvIndex:
    __slots__ = ("segment_start", "timecode_scale", "tracks", "cue_points", "first_cluster")

    def __init__(self):
        self.segment_start = 0
        self.timecode_scale = 1_000_000
        self.tracks: List[Dict[str, Any]] = []
        # track number -> sorted [(time_ticks, cluster_pos, rel_pos|None, duration_ticks|None)]
        self.cue_points: Dict[int, List[tuple]] = {}
        self.first_cluster: Optional[int] = None  # relative to segment_start

    def ticks_to_ms(self, ticks: int) -> int:
        return ticks * self.timecode_scale // 1_000_000

    def ms_to_ticks(self, ms: int) -> int:
        return ms * 1_000_000 // self.timecode_scale


async def _chunks_from(fetch, abs_pos: int, max_chunks: int):
    idx, skip = divmod(abs_pos, CHUNK_SIZE)
    for n in range(max_chunks):
        data = await fetch(idx + n)
        if not data:
            return
        full = len(data)
        if n == 0 and skip:
            data = data[skip:]
        if data:
            yield data
        if full < CHUNK_SIZE:
            return


async def read_range(fetch, start: int, length: int) -> bytes:
    # A fetcher that can download arbitrary small ranges does so; otherwise
    # assemble the range from whole chunks.
    ranged = getattr(fetch, "read_range", None)
    if ranged is not None:
        return await ranged(start, length)
    return await read_chunk_range(fetch, start, length)


async def read_chunk_range(fetch, start: int, length: int) -> bytes:
    out = bytearray()
    pos = start
    end = start + length
    while pos < end:
        idx, off = divmod(pos, CHUNK_SIZE)
        data = await fetch(idx)
        if not data or off >= len(data):
            break
        take = data[off:off + (end - pos)]
        out += take
        pos += len(take)
    return bytes(out)


def _vint_len(first: int) -> int:
    if first == 0:
        raise ValueError("Invalid VINT")
    length, mask = 1, 0x80
    while not (first & mask):
        length += 1
        mask >>= 1
    return length


def _parse_header_bytes(data: bytes, pos: int = 0):
    """(element_id, size, header_length) from raw bytes."""
    id_len = _vint_len(data[pos])
    element_id = int.from_bytes(data[pos:pos + id_len], "big")
    size, size_len = _read_vint_from_bytes(data, pos + id_len)
    return element_id, size, id_len + size_len


async def _parse_seek_head(reader: _AsyncByteReader, size: int) -> Dict[int, int]:
    end_pos = reader.position + size
    found: Dict[int, int] = {}
    while reader.position < end_pos:
        eid, esize = await _read_element_header(reader)
        if eid != ID_SEEK:
            await reader.skip(esize)
            continue
        seek_end = reader.position + esize
        seek_id, seek_pos = None, None
        while reader.position < seek_end:
            cid, csize = await _read_element_header(reader)
            raw = await reader.read(csize)
            if cid == ID_SEEK_ID:
                seek_id = int.from_bytes(raw, "big")
            elif cid == ID_SEEK_POSITION:
                seek_pos = _parse_uint(raw)
        if seek_id is not None and seek_pos is not None:
            found[seek_id] = seek_pos
    return found


async def _parse_cues(reader: _AsyncByteReader, size: int, index: MkvIndex) -> None:
    end_pos = reader.position + size
    while reader.position < end_pos:
        eid, esize = await _read_element_header(reader)
        if eid != ID_CUE_POINT:
            await reader.skip(esize)
            continue
        data = await reader.read(esize)
        cue_time = None
        positions = []
        pos = 0
        while pos < len(data):
            cid, csize, hlen = _parse_header_bytes(data, pos)
            body = data[pos + hlen:pos + hlen + csize]
            pos += hlen + csize
            if cid == ID_CUE_TIME:
                cue_time = _parse_uint(body)
            elif cid == ID_CUE_TRACK_POSITIONS:
                track = cluster = rel = dur = None
                p = 0
                while p < len(body):
                    tid, tsize, thlen = _parse_header_bytes(body, p)
                    val = _parse_uint(body[p + thlen:p + thlen + tsize])
                    p += thlen + tsize
                    if tid == ID_CUE_TRACK:
                        track = val
                    elif tid == ID_CUE_CLUSTER_POSITION:
                        cluster = val
                    elif tid == ID_CUE_RELATIVE_POSITION:
                        rel = val
                    elif tid == ID_CUE_DURATION:
                        dur = val
                if track is not None and cluster is not None:
                    positions.append((track, cluster, rel, dur))
        if cue_time is None:
            continue
        for track, cluster, rel, dur in positions:
            index.cue_points.setdefault(track, []).append((cue_time, cluster, rel, dur))


async def load_index(fetch) -> Optional[MkvIndex]:
    index = MkvIndex()
    reader = _AsyncByteReader(_chunks_from(fetch, 0, _HEAD_MAX_CHUNKS))
    seek: Dict[int, int] = {}
    cues_parsed = False
    try:
        eid, header_size = await _read_element_header(reader)
        if eid != ID_EBML_HEADER:
            return None
        await reader.skip(header_size)
        seg_id, _ = await _read_element_header(reader)
        if seg_id != ID_SEGMENT:
            return None
        index.segment_start = reader.position
        while True:
            elem_pos = reader.position - index.segment_start
            eid, size = await _read_element_header(reader)
            if eid == ID_SEEK_HEAD:
                seek.update(await _parse_seek_head(reader, size))
            elif eid == ID_INFO:
                index.timecode_scale = await _parse_info(reader, size, index.timecode_scale)
            elif eid == ID_TRACKS:
                index.tracks = await _parse_tracks(reader, size)
            elif eid == ID_CUES:
                await _parse_cues(reader, size, index)
                cues_parsed = True
            elif eid == ID_CLUSTER:
                index.first_cluster = elem_pos
                break
            else:
                await reader.skip(size)
    except _ParseGiveUp:
        pass
    except Exception as e:
        logger.debug(f"mkv_subtitles.load_index head: {e}", exc_info=True)
    if not index.tracks:
        return None

    cues_pos = seek.get(ID_CUES)
    if not cues_parsed and cues_pos is not None:
        try:
            cue_reader = _AsyncByteReader(
                _chunks_from(fetch, index.segment_start + cues_pos, _CUES_MAX_CHUNKS))
            eid, size = await _read_element_header(cue_reader)
            if eid == ID_CUES:
                await _parse_cues(cue_reader, size, index)
        except _ParseGiveUp:
            pass
        except Exception as e:
            logger.debug(f"mkv_subtitles.load_index cues: {e}", exc_info=True)
    for points in index.cue_points.values():
        points.sort(key=lambda p: p[0])
    return index


def _block_text(block: bytes, wanted_track: int, codec: str, use_zlib: bool) -> Optional[str]:
    try:
        track_num, consumed = _read_vint_from_bytes(block, 0)
        if track_num != wanted_track:
            return None
        flags = block[consumed + 2]
        if (flags >> 1) & 0x03:
            return None
        payload = block[consumed + 3:]
        if use_zlib:
            try:
                payload = zlib.decompress(payload)
            except Exception:
                pass
        if codec in ("S_TEXT/ASS", "S_TEXT/SSA"):
            return _ass_dialogue_text(payload.decode("utf-8", "replace"))
        return payload.decode("utf-8", "replace").strip() or None
    except Exception:
        return None


async def _read_indexed_cue(fetch, index: MkvIndex, point: tuple, track: Dict[str, Any]) -> Optional["_Cue"]:
    cue_time, cluster_pos, rel_pos, cue_dur = point
    cluster_abs = index.segment_start + cluster_pos
    head = await read_range(fetch, cluster_abs, 12)
    cid, _csize, chlen = _parse_header_bytes(head)
    if cid != ID_CLUSTER:
        return None
    block_abs = cluster_abs + chlen + rel_pos
    bhead = await read_range(fetch, block_abs, 12)
    bid, bsize, bhlen = _parse_header_bytes(bhead)
    if bsize > 256 * 1024:
        return None
    body = await read_range(fetch, block_abs + bhlen, bsize)
    duration_ticks = cue_dur
    if bid == ID_SIMPLE_BLOCK:
        block = body
    elif bid == ID_BLOCK_GROUP:
        block = None
        p = 0
        while p < len(body):
            gid, gsize, ghlen = _parse_header_bytes(body, p)
            val = body[p + ghlen:p + ghlen + gsize]
            p += ghlen + gsize
            if gid == ID_BLOCK:
                block = val
            elif gid == ID_BLOCK_DURATION:
                duration_ticks = _parse_uint(val)
        if block is None:
            return None
    else:
        return None
    text = _block_text(block, track["number"], track["codec"], bool(track.get("zlib")))
    if not text:
        return None
    start_ms = index.ticks_to_ms(cue_time)
    end_ms = start_ms + (index.ticks_to_ms(duration_ticks) if duration_ticks else 0)
    return _Cue(start_ms, end_ms, text)


async def _scan_window_linear(fetch, index: MkvIndex, track: Dict[str, Any],
                              start_ms: int, end_ms: int, deadline: float) -> List["_Cue"]:
    # Nearest indexed cluster at or before the window start, from any track.
    target = index.ms_to_ticks(max(0, start_ms - _LOOKBEHIND_MS))
    begin = index.first_cluster
    for points in index.cue_points.values():
        for t, cluster, _rel, _dur in points:
            if t <= target and (begin is None or cluster > begin):
                begin = cluster
            elif t > target:
                break
    if begin is None:
        return []
    cues: List[_Cue] = []
    end_ticks = index.ms_to_ticks(end_ms)
    reader = _AsyncByteReader(_chunks_from(
        fetch, index.segment_start + begin, _LINEAR_MAX_BYTES // CHUNK_SIZE))
    try:
        while time.monotonic() < deadline:
            eid, size = await _read_element_header(reader)
            if eid != ID_CLUSTER:
                await reader.skip(size)
                continue
            cluster_end = reader.position + size
            cluster_tc = 0
            while reader.position < cluster_end:
                cid, csize = await _read_element_header(reader)
                if cid == ID_TIMECODE:
                    cluster_tc = _parse_uint(await reader.read(csize))
                    if cluster_tc > end_ticks:
                        return cues
                elif cid == ID_SIMPLE_BLOCK:
                    cue = _decode_block(await reader.read(csize), track["number"], cluster_tc,
                                        index.timecode_scale, track["codec"], bool(track.get("zlib")),
                                        default_duration_ms=0)
                    if cue:
                        cue.end_ms = cue.start_ms  # SimpleBlock carries no duration
                        cues.append(cue)
                elif cid == ID_BLOCK_GROUP:
                    cue = await _parse_block_group(reader, csize, track["number"], cluster_tc,
                                                   index.timecode_scale, track["codec"],
                                                   bool(track.get("zlib")))
                    if cue:
                        cues.append(cue)
                else:
                    await reader.skip(csize)
    except _ParseGiveUp:
        pass
    except Exception as e:
        logger.debug(f"mkv_subtitles linear window: {e}", exc_info=True)
    return cues


def subtitle_track_indexed(index: MkvIndex, track_number: int) -> bool:
    points = index.cue_points.get(track_number) or []
    return bool(points) and all(p[2] is not None for p in points)


async def extract_subtitle_window(fetch, index: MkvIndex, track_number: int,
                                  start_ms: int, end_ms: int) -> Optional[List[Dict[str, Any]]]:
    """Cues of one text subtitle track overlapping [start_ms, end_ms), as
    [{"s": ms, "e": ms, "t": text}] sorted by start. None if the track isn't
    a text subtitle track in this file."""
    track = next((t for t in index.tracks if t["number"] == track_number), None)
    if track is None or track.get("codec") not in TEXT_SUBTITLE_CODECS:
        return None
    deadline = time.monotonic() + _WINDOW_TIMEOUT
    lo = index.ms_to_ticks(max(0, start_ms - _LOOKBEHIND_MS))
    hi = index.ms_to_ticks(end_ms)
    points = [p for p in index.cue_points.get(track_number, []) if lo <= p[0] < hi]
    indexed = [p for p in points if p[2] is not None]

    cues: List[_Cue] = []
    if indexed:
        sem = asyncio.Semaphore(_FETCH_CONCURRENCY)

        async def one(p):
            async with sem:
                try:
                    return await _read_indexed_cue(fetch, index, p, track)
                except Exception as e:
                    logger.debug(f"mkv_subtitles indexed cue: {e}", exc_info=True)
                    return None

        try:
            results = await asyncio.wait_for(
                asyncio.gather(*(one(p) for p in indexed)),
                timeout=max(1.0, deadline - time.monotonic()))
            cues = [c for c in results if c]
        except asyncio.TimeoutError:
            cues = []
    if not cues and not indexed:
        cues = await _scan_window_linear(fetch, index, track, start_ms, end_ms, deadline)

    cues.sort(key=lambda c: c.start_ms)
    for i, cue in enumerate(cues):
        nxt = cues[i + 1].start_ms if i + 1 < len(cues) else None
        if cue.end_ms <= cue.start_ms:
            cue.end_ms = cue.start_ms + 4000
            if nxt is not None:
                cue.end_ms = min(cue.end_ms, max(cue.start_ms + 500, nxt))
        elif nxt is not None and cue.end_ms > nxt:
            cue.end_ms = max(cue.start_ms + 200, nxt)
    return [
        {"s": c.start_ms, "e": c.end_ms, "t": c.text}
        for c in cues if c.end_ms > start_ms and c.start_ms < end_ms
    ]
