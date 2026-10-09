# Thunder/utils/mkv_subtitles.py
#
# Pure-Python Matroska (EBML) reader for embedded text subtitle tracks.
#
# There is no ffmpeg/mkvextract on this project's typical host (Heroku's
# standard buildpack has no apt-get), so this walks the container structure
# itself: read the Tracks list to find subtitle streams, then walk Clusters
# sequentially pulling out the SimpleBlock/BlockGroup payloads that belong to
# the requested track, and emit them as WebVTT.
#
# Scope: text-based subtitle codecs only (S_TEXT/UTF8 "SRT", S_TEXT/ASS,
# S_TEXT/SSA, S_TEXT/WEBVTT). Bitmap subtitle codecs (S_HDMV/PGS, S_VOBSUB)
# carry images, not text, and can't become a WebVTT file - they're skipped.
#
# There's no subtitle-only index in Matroska, so finding every cue means
# reading through the whole Clusters region once - the same amount of work
# ffmpeg would do for the same file. That cost is paid once per file and
# cached (see callers in Thunder/server/stream_routes.py), not per viewer.

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

# Elements whose children we want to step into while scanning; anything else
# with an unknown/irrelevant ID is skipped over as a single opaque blob.
_MASTER_IDS = {
    ID_SEGMENT, ID_SEEK_HEAD, ID_SEEK, ID_INFO, ID_TRACKS, ID_TRACK_ENTRY,
    ID_CONTENT_ENCODINGS, ID_CONTENT_ENCODING, ID_CONTENT_COMPRESSION,
    ID_CLUSTER, ID_BLOCK_GROUP,
}

DEFAULT_MAX_SCAN_BYTES = 450 * 1024 * 1024
DEFAULT_SCAN_TIMEOUT = 90


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


# ---- Track discovery ---------------------------------------------------

async def probe_tracks(
    chunk_source,
    *,
    max_scan_bytes: int = 8 * 1024 * 1024,
) -> List[Dict[str, Any]]:
    """Reads just far enough to parse the Tracks element (near the start of
    any properly muxed file) and returns track metadata dicts:
    {number, type: 'video'|'audio'|'subtitle'|'other', codec, language, name}.
    Returns [] if this isn't a Matroska file or Tracks wasn't found in range.
    """
    reader = _AsyncByteReader(chunk_source)
    tracks: List[Dict[str, Any]] = []
    try:
        eid, header_size = await _read_element_header(reader)
        if eid != ID_EBML_HEADER:
            return []
        await reader.skip(header_size)

        seg_id, _seg_size = await _read_element_header(reader)
        if seg_id != ID_SEGMENT:
            return []

        while reader.position < max_scan_bytes:
            eid, size = await _read_element_header(reader)
            if eid == ID_TRACKS:
                tracks = await _parse_tracks(reader, size)
                break
            if eid == ID_CLUSTER:
                # Tracks always precedes Clusters in a streamable mux; if we
                # hit a Cluster first there's nothing more to look for here.
                break
            await reader.skip(size)
    except _ParseGiveUp:
        pass
    except Exception as e:
        logger.debug(f"mkv_subtitles.probe_tracks: {e}", exc_info=True)
    return tracks


async def _skip_element_header_payload(reader: _AsyncByteReader, eid: int) -> None:
    # Used only right after reading the EBML header's own header; re-read its
    # size vint (we already consumed id+size as a pair in _read_element_header
    # for the header itself, so this helper is intentionally unused for that
    # path - kept as a no-op placeholder for clarity).
    return None


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
_WEBVTT_UNSAFE_ARROW = re.compile(r"-->")


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


def _format_timestamp(ms: int) -> str:
    if ms < 0:
        ms = 0
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    seconds, ms = divmod(ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{ms:03d}"


class _Cue:
    __slots__ = ("start_ms", "end_ms", "text")

    def __init__(self, start_ms: int, end_ms: int, text: str):
        self.start_ms = start_ms
        self.end_ms = end_ms
        self.text = text


async def extract_subtitle_vtt(
    chunk_source,
    *,
    track_number: int,
    max_scan_bytes: int = DEFAULT_MAX_SCAN_BYTES,
    timeout_seconds: float = DEFAULT_SCAN_TIMEOUT,
) -> Optional[str]:
    """Walks the Segment's Clusters pulling out every block belonging to
    track_number, and returns a complete WebVTT document, or None if nothing
    was found / the file isn't parseable Matroska.
    """
    reader = _AsyncByteReader(chunk_source)
    deadline = time.monotonic() + timeout_seconds
    codec = "S_TEXT/UTF8"
    use_zlib = False
    cues: List[_Cue] = []

    try:
        eid, header_size = await _read_element_header(reader)
        if eid != ID_EBML_HEADER:
            return None
        await reader.skip(header_size)
        seg_id, _seg_size = await _read_element_header(reader)
        if seg_id != ID_SEGMENT:
            return None

        timecode_scale = 1_000_000  # ns per Matroska tick, Matroska default
        cluster_timecode = 0

        while reader.position < max_scan_bytes:
            if time.monotonic() > deadline:
                logger.debug("mkv_subtitles: scan timed out, returning partial result")
                break

            eid, size = await _read_element_header(reader)

            if eid == ID_INFO:
                timecode_scale = await _parse_info(reader, size, timecode_scale)
            elif eid == ID_TRACKS:
                tracks = await _parse_tracks(reader, size)
                target = next((t for t in tracks if t["number"] == track_number), None)
                if target is None:
                    return None
                if target["codec"] not in TEXT_SUBTITLE_CODECS:
                    return None
                codec = target["codec"]
                use_zlib = bool(target.get("zlib"))
            elif eid == ID_CLUSTER:
                cluster_end = reader.position + size
                cluster_timecode = 0
                while reader.position < cluster_end:
                    cid, csize = await _read_element_header(reader)
                    if cid == ID_TIMECODE:
                        cluster_timecode = _parse_uint(await reader.read(csize))
                    elif cid == ID_SIMPLE_BLOCK:
                        block = await reader.read(csize)
                        cue = _decode_block(
                            block, track_number, cluster_timecode, timecode_scale,
                            codec, use_zlib, default_duration_ms=2000,
                        )
                        if cue:
                            cues.append(cue)
                    elif cid == ID_BLOCK_GROUP:
                        cue = await _parse_block_group(
                            reader, csize, track_number, cluster_timecode,
                            timecode_scale, codec, use_zlib,
                        )
                        if cue:
                            cues.append(cue)
                    else:
                        await reader.skip(csize)
            else:
                await reader.skip(size)
    except _ParseGiveUp:
        pass
    except Exception as e:
        logger.debug(f"mkv_subtitles.extract_subtitle_vtt: {e}", exc_info=True)

    if not cues:
        return None
    return _render_vtt(cues)


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


def _render_vtt(cues: List["_Cue"]) -> str:
    cues.sort(key=lambda c: c.start_ms)
    # A block only carries its own start time; if nothing (duration, next
    # cue) narrows it down we fall back to a flat length, which can make
    # adjacent cues overlap slightly - trimming each to the next cue's start
    # keeps overlapping captions from stacking on screen.
    for i in range(len(cues) - 1):
        if cues[i].end_ms > cues[i + 1].start_ms:
            cues[i].end_ms = max(cues[i].start_ms + 200, cues[i + 1].start_ms)

    lines = ["WEBVTT", ""]
    for cue in cues:
        text = _WEBVTT_UNSAFE_ARROW.sub("- -&gt;", cue.text)
        lines.append(f"{_format_timestamp(cue.start_ms)} --> {_format_timestamp(cue.end_ms)}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)
