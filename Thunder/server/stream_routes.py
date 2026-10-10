# Thunder/server/stream_routes.py

import asyncio
import re
import secrets
import time
from urllib.parse import quote, unquote

from aiohttp import web
from pyrogram import raw
from pyrogram.errors import FloodWait
from pyrogram.file_id import FileId

from Thunder import __version__, StartTime
from Thunder.bot import StreamBot, multi_clients, work_loads
from Thunder.server.exceptions import FileNotFound, InvalidHash
from Thunder.utils.bot_utils import quote_media_name
from Thunder.utils.canonical_files import (
    PUBLIC_HASH_LENGTH,
    get_file_by_hash,
    update_cached_file_id,
)
from Thunder.utils.custom_dl import ByteStreamer
from Thunder.utils.file_properties import get_media
from Thunder.utils.logger import logger
from Thunder.utils.mkv_subtitles import (
    WINDOW_MS, MkvIndex, extract_subtitle_window, load_index, read_chunk_range,
    subtitle_track_indexed,
)
from Thunder.utils.render_template import render_media_page, render_page
from Thunder.utils.time_format import get_readable_time
from Thunder.vars import Var

routes = web.RouteTableDef()

SECURE_HASH_LENGTH = 6
CHUNK_SIZE = 1024 * 1024
MAX_CONCURRENT_PER_CLIENT = 8
OVERLOAD_RETRY_AFTER_SECONDS = 2
RANGE_REGEX = re.compile(r"^bytes=(?P<start>\d*)-(?P<end>\d*)$")
PATTERN_HASH_FIRST = re.compile(
    rf"^([a-zA-Z0-9_-]{{{SECURE_HASH_LENGTH}}})(\d+)(?:/.*)?$")
PATTERN_ID_FIRST = re.compile(r"^(\d+)(?:/.*)?$")
VALID_HASH_REGEX = re.compile(r'^[a-zA-Z0-9_-]+$')
VALID_PUBLIC_HASH_REGEX = re.compile(rf'^[0-9a-f]{{{PUBLIC_HASH_LENGTH}}}$')
VALID_DISPOSITIONS = {"inline", "attachment"}

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, *",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Disposition",
}

streamers = {}

# Per-process caches so a file's Matroska index is read once, and each
# minute of a subtitle track is extracted once, not once per viewer.
_index_cache: dict[tuple, "asyncio.Future"] = {}
_window_cache: dict[tuple, list] = {}
_INDEX_CACHE_MAX = 200
_WINDOW_CACHE_MAX = 3000


def get_streamer(client_id: int) -> ByteStreamer:
    if client_id not in streamers:
        streamers[client_id] = ByteStreamer(multi_clients[client_id])
    return streamers[client_id]


def parse_media_request(path: str, query: dict) -> tuple[int, str]:
    clean_path = unquote(path).strip('/')

    match = PATTERN_HASH_FIRST.match(clean_path)
    if match:
        try:
            message_id = int(match.group(2))
            secure_hash = match.group(1)
            if (len(secure_hash) == SECURE_HASH_LENGTH and
                    VALID_HASH_REGEX.match(secure_hash)):
                return message_id, secure_hash
        except ValueError as e:
            raise InvalidHash(f"Invalid message ID format in path: {e}") from e

    match = PATTERN_ID_FIRST.match(clean_path)
    if match:
        try:
            message_id = int(match.group(1))
            secure_hash = query.get("hash", "").strip()
            if (len(secure_hash) == SECURE_HASH_LENGTH and
                    VALID_HASH_REGEX.match(secure_hash)):
                return message_id, secure_hash
            else:
                raise InvalidHash("Invalid or missing hash in query parameter")
        except ValueError as e:
            raise InvalidHash(f"Invalid message ID format in path: {e}") from e

    raise InvalidHash("Invalid URL structure or missing hash")


def validate_public_hash(public_hash: str) -> str:
    secure_hash = public_hash.strip().lower()
    if len(secure_hash) != PUBLIC_HASH_LENGTH or not VALID_PUBLIC_HASH_REGEX.match(secure_hash):
        raise InvalidHash("Invalid canonical file hash")
    return secure_hash


def select_optimal_client() -> tuple[int, ByteStreamer]:
    if not work_loads:
        raise web.HTTPInternalServerError(
            text=("No available clients to handle the request. "
                  "Please try again later."),
            headers=CORS_HEADERS,
        )

    available_clients = [
        (cid, load) for cid, load in work_loads.items()
        if load < MAX_CONCURRENT_PER_CLIENT]

    if not available_clients:
        loads = list(work_loads.values())
        load_range = f"~{min(loads)}–{max(loads)}" if min(loads) != max(loads) else f"~{min(loads)}"
        raise web.HTTPServiceUnavailable(
            text=(
                "All Telegram clients are currently at capacity "
                f"({load_range} active streams). Please retry shortly."
            ),
            headers={
                **CORS_HEADERS,
                "Retry-After": str(OVERLOAD_RETRY_AFTER_SECONDS),
            },
        )

    client_id = min(available_clients, key=lambda x: x[1])[0]
    return client_id, get_streamer(client_id)


def get_content_disposition(request: web.Request) -> str:
    disposition = request.query.get("disposition", "attachment").strip().lower()
    return disposition if disposition in VALID_DISPOSITIONS else "attachment"


def parse_range_header(range_header: str, file_size: int) -> tuple[int, int]:
    if not range_header:
        return 0, file_size - 1

    match = RANGE_REGEX.fullmatch(range_header)
    if not match:
        raise web.HTTPBadRequest(text=f"Invalid range header: {range_header}")

    start_str = match.group("start")
    end_str = match.group("end")
    if start_str:
        start = int(start_str)
        end = int(end_str) if end_str else file_size - 1
    else:
        if not end_str:
            raise web.HTTPBadRequest(text=f"Invalid range header: {range_header}")
        suffix_len = int(end_str)
        if suffix_len <= 0:
            raise web.HTTPRequestRangeNotSatisfiable(
                headers={"Content-Range": f"bytes */{file_size}"})
        start = max(file_size - suffix_len, 0)
        end = file_size - 1

    if start < 0 or end >= file_size or start > end:
        raise web.HTTPRequestRangeNotSatisfiable(
            headers={"Content-Range": f"bytes */{file_size}"}
        )

    return start, end


def _resolve_unique_id(file_info: dict) -> str:
    unique_id = file_info.get("unique_id") or file_info.get("file_unique_id")
    if not unique_id:
        raise FileNotFound("File unique ID not found in info.")
    return unique_id


def _resolve_filename(file_info: dict, mime_type: str) -> str:
    filename = file_info.get("file_name")
    if filename:
        return filename

    ext = mime_type.split('/')[-1] if '/' in mime_type else 'bin'
    ext_map = {'jpeg': 'jpg', 'mpeg': 'mp3', 'octet-stream': 'bin'}
    ext = ext_map.get(ext, ext)
    return f"file_{secrets.token_hex(4)}.{ext}"


async def _serve_media_response(
    request: web.Request,
    *,
    file_info: dict,
    streamer: ByteStreamer,
    client_id: int,
    media_ref: int | str,
    fallback_message_id: int | None = None,
    on_fallback_message=None
):
    file_size = int(file_info.get('file_size', 0) or 0)
    if file_size == 0:
        raise FileNotFound("File size is reported as zero or unavailable.")

    range_header = request.headers.get("Range", "")
    start, end = parse_range_header(range_header, file_size)
    content_length = end - start + 1

    if start == 0 and end == file_size - 1:
        range_header = ""

    mime_type = file_info.get('mime_type') or 'application/octet-stream'
    filename = _resolve_filename(file_info, mime_type)
    disposition = get_content_disposition(request)

    headers = {
        "Content-Type": mime_type,
        "Content-Length": str(content_length),
        "Content-Disposition": (
            f"{disposition}; filename*=UTF-8''{quote(filename, safe='')}"),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Range, Content-Type, *",
        "Access-Control-Expose-Headers": (
            "Content-Length, Content-Range, Content-Disposition"),
        "X-Content-Type-Options": "nosniff"
    }

    if range_header:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    if request.method == 'HEAD':
        work_loads[client_id] -= 1
        return web.Response(
            status=206 if range_header else 200,
            headers=headers
        )

    async def stream_generator():
        try:
            bytes_sent = 0
            bytes_to_skip = start % CHUNK_SIZE

            async for chunk in streamer.stream_file(
                media_ref,
                offset=start,
                limit=content_length,
                fallback_message_id=fallback_message_id,
                on_fallback_message=on_fallback_message
            ):
                if bytes_to_skip > 0:
                    if len(chunk) <= bytes_to_skip:
                        bytes_to_skip -= len(chunk)
                        continue
                    chunk = chunk[bytes_to_skip:]
                    bytes_to_skip = 0

                remaining = content_length - bytes_sent
                if len(chunk) > remaining:
                    chunk = chunk[:remaining]

                if chunk:
                    yield chunk
                    bytes_sent += len(chunk)

                if bytes_sent >= content_length:
                    break
        finally:
            work_loads[client_id] -= 1

    return web.Response(
        status=206 if range_header else 200,
        body=stream_generator(),
        headers=headers
    )


@routes.get("/", allow_head=True)
async def root_redirect(request):
    raise web.HTTPFound("https://github.com/Tj-Bots/FileToLink")


@routes.get("/status", allow_head=True)
async def status_endpoint(request):
    uptime = time.time() - StartTime
    total_load = sum(work_loads.values())

    workload_distribution = {str(k): v for k, v in sorted(work_loads.items())}

    return web.json_response(
        {
            "server": {
                "status": "operational",
                "version": __version__,
                "uptime": get_readable_time(uptime)
            },
            "telegram_bot": {
                "username": f"@{StreamBot.username}",
                "active_clients": len(multi_clients)
            },
            "resources": {
                "total_workload": total_load,
                "workload_distribution": workload_distribution
            }
        },
        headers={"Access-Control-Allow-Origin": "*"}
    )


@routes.options("/status")
async def status_options(request: web.Request):
    return web.Response(headers={
        **CORS_HEADERS,
        "Access-Control-Max-Age": "86400"
    })


@routes.options(r"/{path:.+}")
async def media_options(request: web.Request):
    return web.Response(headers={
        **CORS_HEADERS,
        "Access-Control-Max-Age": "86400"
    })


@routes.get(r"/watch/f/{secure_hash}/{name:.+}", allow_head=True)
async def canonical_media_preview(request: web.Request):
    try:
        secure_hash = validate_public_hash(request.match_info["secure_hash"])
        file_record = await get_file_by_hash(secure_hash, raise_on_error=False)
        if not file_record:
            raise FileNotFound("Canonical file not found")

        file_name = file_record.get("file_name") or f"file_{secure_hash}"
        src = f"{Var.URL.rstrip('/')}/f/{secure_hash}/{quote_media_name(file_name)}"
        rendered_page = await render_media_page(file_name, src, requested_action='stream')

        response = web.Response(
            text=rendered_page,
            content_type='text/html',
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Range, Content-Type, *",
                "X-Content-Type-Options": "nosniff",
            }
        )
        response.enable_compression()
        return response
    except (InvalidHash, FileNotFound) as e:
        logger.debug(f"Canonical preview error: {type(e).__name__} - {e}", exc_info=True)
        raise web.HTTPNotFound(text="Resource not found") from e
    except Exception as e:
        error_id = secrets.token_hex(6)
        logger.error(f"Canonical preview error {error_id}: {e}", exc_info=True)
        raise web.HTTPInternalServerError(
            text=f"Server error occurred: {error_id}") from e


@routes.get(r"/watch/{path:.+}", allow_head=True)
async def media_preview(request: web.Request):
    try:
        path = request.match_info["path"]
        message_id, secure_hash = parse_media_request(path, request.query)

        rendered_page = await render_page(
            message_id, secure_hash, requested_action='stream')

        response = web.Response(
            text=rendered_page,
            content_type='text/html',
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Range, Content-Type, *",
                "X-Content-Type-Options": "nosniff",
            }
        )
        response.enable_compression()
        return response

    except (InvalidHash, FileNotFound) as e:
        logger.debug(
            f"Client error in preview: {type(e).__name__} - {e}",
            exc_info=True)
        raise web.HTTPNotFound(text="Resource not found") from e
    except Exception as e:
        error_id = secrets.token_hex(6)
        logger.error(f"Preview error {error_id}: {e}", exc_info=True)
        raise web.HTTPInternalServerError(
            text=f"Server error occurred: {error_id}") from e


@routes.get(r"/f/{secure_hash}/{name:.+}", allow_head=True)
async def canonical_media_delivery(request: web.Request):
    try:
        secure_hash = validate_public_hash(request.match_info["secure_hash"])
        file_record = await get_file_by_hash(secure_hash, raise_on_error=False)
        if not file_record:
            raise FileNotFound("Canonical file not found")

        client_id, streamer = select_optimal_client()
        work_loads[client_id] += 1

        try:
            _resolve_unique_id(file_record)
            media_ref = int(file_record["canonical_message_id"])
            fallback_message_id = int(file_record["canonical_message_id"])

            async def persist_refreshed_file_id(message):
                if client_id != 0:
                    return
                media = get_media(message)
                new_file_id = getattr(media, "file_id", None) if media else None
                if new_file_id and new_file_id != file_record.get("file_id"):
                    try:
                        await update_cached_file_id(file_record, new_file_id)
                    except Exception as e:
                        logger.warning(
                            f"Failed to refresh cached file_id for canonical file {secure_hash}: {e}",
                            exc_info=True
                        )

            return await _serve_media_response(
                request,
                file_info=file_record,
                streamer=streamer,
                client_id=client_id,
                media_ref=media_ref,
                fallback_message_id=fallback_message_id,
                on_fallback_message=persist_refreshed_file_id
            )
        except (FileNotFound, InvalidHash):
            work_loads[client_id] -= 1
            raise
        except web.HTTPException as e:
            work_loads[client_id] -= 1
            logger.debug(f"Client HTTP error in canonical stream: {e}")
            raise
        except Exception as e:
            work_loads[client_id] -= 1
            error_id = secrets.token_hex(6)
            logger.error(f"Canonical stream error {error_id}: {e}", exc_info=True)
            raise web.HTTPInternalServerError(
                text=f"Server error during streaming: {error_id}") from e
    except (InvalidHash, FileNotFound) as e:
        logger.debug(f"Canonical client error: {type(e).__name__} - {e}", exc_info=True)
        raise web.HTTPNotFound(text="Resource not found") from e
    except web.HTTPException as e:
        logger.warning(f"HTTP exception in canonical stream: {e}")
        raise
    except Exception as e:
        error_id = secrets.token_hex(6)
        logger.error(f"Canonical server error {error_id}: {e}", exc_info=True)
        raise web.HTTPInternalServerError(
            text=f"An unexpected server error occurred: {error_id}") from e


class _ChunkFetcher:
    """Reads a Telegram file for the Matroska index/subtitle readers.

    fetch(i) returns the i-th 1 MiB chunk (used for the file head, the Cues
    index and the rare unindexed-subtitle scan). fetch.read_range(start, n)
    returns just those bytes, downloaded in 4 KiB-aligned pieces with
    upload.getFile's `precise` flag - so reading one subtitle line costs a
    few KiB, not the megabyte of video around it.
    """

    PIECE = 4096

    def __init__(self, streamer: ByteStreamer, media_ref: int):
        self._streamer = streamer
        self._media_ref = media_ref
        self._message = None
        self._location = None
        self._message_lock = asyncio.Lock()
        self._chunks: dict[int, asyncio.Future] = {}
        self._pieces: dict[tuple, asyncio.Future] = {}
        self._sem = asyncio.Semaphore(6)
        self._precise_ok = True

    async def _get_message(self):
        async with self._message_lock:
            if self._message is None:
                self._message = await self._streamer.get_message(self._media_ref)
            return self._message

    async def _download(self, idx: int) -> bytes:
        message = await self._get_message()
        async with self._sem:
            for _attempt in range(3):
                try:
                    async for chunk in self._streamer.client.stream_media(message, offset=idx, limit=1):
                        return bytes(chunk)
                    return b""
                except FloodWait as e:
                    await asyncio.sleep(e.value)
            return b""

    async def __call__(self, idx: int) -> bytes:
        task = self._chunks.get(idx)
        if task is None:
            task = asyncio.ensure_future(self._download(idx))
            self._chunks[idx] = task
        try:
            return await task
        except Exception:
            self._chunks.pop(idx, None)
            raise

    async def _media_session(self):
        """The media DC session pyrogram itself uses for this file; created
        (by pyrogram) on first use with a 1 MiB read if it doesn't exist yet."""
        client = self._streamer.client
        message = await self._get_message()
        if self._location is None:
            file_id = FileId.decode(get_media(message).file_id)
            self._location = (file_id.dc_id, raw.types.InputDocumentFileLocation(
                id=file_id.media_id,
                access_hash=file_id.access_hash,
                file_reference=file_id.file_reference,
                thumb_size=file_id.thumbnail_size,
            ))
        dc_id, location = self._location
        session = client.media_sessions.get(dc_id)
        if session is None:
            await self(0)
            session = client.media_sessions.get(dc_id)
        return session, location

    async def _download_piece(self, offset: int, limit: int) -> bytes:
        session, location = await self._media_session()
        if session is None:
            raise RuntimeError("no media session")
        async with self._sem:
            for _attempt in range(3):
                try:
                    r = await session.invoke(raw.functions.upload.GetFile(
                        location=location, offset=offset, limit=limit, precise=True))
                    if isinstance(r, raw.types.upload.File):
                        return bytes(r.bytes)
                    raise RuntimeError(f"unexpected {type(r).__name__}")
                except FloodWait as e:
                    await asyncio.sleep(e.value)
            return b""

    async def _piece(self, offset: int, limit: int) -> bytes:
        idx = offset // CHUNK_SIZE
        whole = self._chunks.get(idx)
        if whole is not None and whole.done() and not whole.exception():
            base = offset - idx * CHUNK_SIZE
            return whole.result()[base:base + limit]
        key = (offset, limit)
        task = self._pieces.get(key)
        if task is None:
            task = asyncio.ensure_future(self._download_piece(offset, limit))
            self._pieces[key] = task
        try:
            return await task
        except Exception:
            self._pieces.pop(key, None)
            raise

    async def read_range(self, start: int, length: int) -> bytes:
        if length <= 0:
            return b""
        if self._precise_ok:
            try:
                begin = start - start % self.PIECE
                end = -(-(start + length) // self.PIECE) * self.PIECE
                parts = []
                pos = begin
                # One request may not cross a 1 MiB boundary.
                while pos < end:
                    stop = min(end, (pos // CHUNK_SIZE + 1) * CHUNK_SIZE)
                    parts.append(self._piece(pos, stop - pos))
                    pos = stop
                data = b"".join(await asyncio.gather(*parts))
                return data[start - begin:start - begin + length]
            except Exception as e:
                logger.debug(f"precise range read failed, using 1 MiB chunks: {e}", exc_info=True)
                self._precise_ok = False
        return await read_chunk_range(self, start, length)


def _trim_cache(cache: dict, limit: int) -> None:
    while len(cache) > limit:
        cache.pop(next(iter(cache)))


async def _get_index(cache_key: tuple, streamer: ByteStreamer, media_ref: int) -> MkvIndex | None:
    task = _index_cache.get(cache_key)
    if task is None:
        task = asyncio.ensure_future(load_index(_ChunkFetcher(streamer, media_ref)))
        _index_cache[cache_key] = task
        _trim_cache(_index_cache, _INDEX_CACHE_MAX)
    try:
        return await task
    except Exception:
        _index_cache.pop(cache_key, None)
        raise


def _public_tracks(index: MkvIndex | None) -> list:
    if not index:
        return []
    return [
        {k: t.get(k) for k in ("number", "type", "codec", "language", "name")}
        for t in index.tracks
    ]


async def _get_subtitle_window(cache_key: tuple, streamer: ByteStreamer, media_ref: int,
                               track_number: int, window: int):
    """(cues | None, indexed). `indexed` means every subtitle block of the
    track is in the file's Cues index, so reading it costs only a few KiB per
    line - the player then preloads the rest of the track in the background."""
    index = await _get_index(cache_key, streamer, media_ref)
    if index is None:
        return None, False
    indexed = subtitle_track_indexed(index, track_number)
    key = (*cache_key, track_number, window)
    if key in _window_cache:
        return _window_cache[key], indexed
    cues = await extract_subtitle_window(
        _ChunkFetcher(streamer, media_ref), index, track_number,
        window * WINDOW_MS, (window + 1) * WINDOW_MS)
    if cues is not None:
        _window_cache[key] = cues
        _trim_cache(_window_cache, _WINDOW_CACHE_MAX)
    return cues, indexed


def _parse_track_query(request: web.Request) -> tuple[int, int]:
    try:
        track = int(request.query.get("track", ""))
        at = float(request.query.get("t", "0"))
    except ValueError as e:
        raise web.HTTPBadRequest(text="Invalid 'track' or 't' query parameter") from e
    return track, max(0, int(at * 1000) // WINDOW_MS)


def _subtitle_response(result, window: int) -> web.Response:
    cues, indexed = result
    if cues is None:
        raise FileNotFound("Subtitle track not found or not a text subtitle track")
    return web.json_response(
        {"from": window * WINDOW_MS, "to": (window + 1) * WINDOW_MS, "indexed": indexed, "cues": cues},
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"})


@routes.get(r"/tracks/f/{secure_hash}/{name:.+}")
async def canonical_tracks(request: web.Request):
    try:
        secure_hash = validate_public_hash(request.match_info["secure_hash"])
        file_record = await get_file_by_hash(secure_hash, raise_on_error=False)
        if not file_record:
            raise FileNotFound("Canonical file not found")
        _resolve_unique_id(file_record)
        media_ref = int(file_record["canonical_message_id"])

        client_id, streamer = select_optimal_client()
        work_loads[client_id] += 1
        try:
            tracks = _public_tracks(await _get_index(("f", secure_hash), streamer, media_ref))
        finally:
            work_loads[client_id] -= 1

        return web.json_response(
            {"tracks": tracks}, headers={"Access-Control-Allow-Origin": "*"})
    except (InvalidHash, FileNotFound) as e:
        raise web.HTTPNotFound(text="Resource not found") from e
    except web.HTTPException:
        raise
    except Exception as e:
        error_id = secrets.token_hex(6)
        logger.error(f"Canonical tracks error {error_id}: {e}", exc_info=True)
        raise web.HTTPInternalServerError(
            text=f"Server error occurred: {error_id}") from e


@routes.get(r"/subtitle/f/{secure_hash}/{name:.+}")
async def canonical_subtitle(request: web.Request):
    try:
        secure_hash = validate_public_hash(request.match_info["secure_hash"])
        track_number, window = _parse_track_query(request)
        file_record = await get_file_by_hash(secure_hash, raise_on_error=False)
        if not file_record:
            raise FileNotFound("Canonical file not found")
        _resolve_unique_id(file_record)
        media_ref = int(file_record["canonical_message_id"])

        client_id, streamer = select_optimal_client()
        work_loads[client_id] += 1
        try:
            result = await _get_subtitle_window(
                ("f", secure_hash), streamer, media_ref, track_number, window)
        finally:
            work_loads[client_id] -= 1
        return _subtitle_response(result, window)
    except (InvalidHash, FileNotFound) as e:
        raise web.HTTPNotFound(text="Resource not found") from e
    except web.HTTPException:
        raise
    except Exception as e:
        error_id = secrets.token_hex(6)
        logger.error(f"Canonical subtitle error {error_id}: {e}", exc_info=True)
        raise web.HTTPInternalServerError(
            text=f"Server error occurred: {error_id}") from e


@routes.get(r"/tracks/{path:.+}")
async def adhoc_tracks(request: web.Request):
    try:
        path = request.match_info["path"]
        message_id, secure_hash = parse_media_request(path, request.query)

        client_id, streamer = select_optimal_client()
        work_loads[client_id] += 1
        try:
            file_info = await streamer.get_file_info(message_id)
            unique_id = _resolve_unique_id(file_info)
            if unique_id[:SECURE_HASH_LENGTH] != secure_hash:
                raise InvalidHash("Provided hash does not match file's unique ID.")
            tracks = _public_tracks(
                await _get_index(("adhoc", secure_hash, message_id), streamer, message_id))
        finally:
            work_loads[client_id] -= 1

        return web.json_response(
            {"tracks": tracks}, headers={"Access-Control-Allow-Origin": "*"})
    except (InvalidHash, FileNotFound) as e:
        raise web.HTTPNotFound(text="Resource not found") from e
    except web.HTTPException:
        raise
    except Exception as e:
        error_id = secrets.token_hex(6)
        logger.error(f"Tracks error {error_id}: {e}", exc_info=True)
        raise web.HTTPInternalServerError(
            text=f"Server error occurred: {error_id}") from e


@routes.get(r"/subtitle/{path:.+}")
async def adhoc_subtitle(request: web.Request):
    try:
        path = request.match_info["path"]
        track_number, window = _parse_track_query(request)
        message_id, secure_hash = parse_media_request(path, request.query)

        client_id, streamer = select_optimal_client()
        work_loads[client_id] += 1
        try:
            file_info = await streamer.get_file_info(message_id)
            unique_id = _resolve_unique_id(file_info)
            if unique_id[:SECURE_HASH_LENGTH] != secure_hash:
                raise InvalidHash("Provided hash does not match file's unique ID.")
            result = await _get_subtitle_window(
                ("adhoc", secure_hash, message_id), streamer, message_id, track_number, window)
        finally:
            work_loads[client_id] -= 1
        return _subtitle_response(result, window)
    except (InvalidHash, FileNotFound) as e:
        raise web.HTTPNotFound(text="Resource not found") from e
    except web.HTTPException:
        raise
    except Exception as e:
        error_id = secrets.token_hex(6)
        logger.error(f"Subtitle error {error_id}: {e}", exc_info=True)
        raise web.HTTPInternalServerError(
            text=f"Server error occurred: {error_id}") from e


@routes.get(r"/{path:.+}", allow_head=True)
async def media_delivery(request: web.Request):
    try:
        path = request.match_info["path"]
        message_id, secure_hash = parse_media_request(path, request.query)

        client_id, streamer = select_optimal_client()

        work_loads[client_id] += 1

        try:
            file_info = await streamer.get_file_info(message_id)
            unique_id = _resolve_unique_id(file_info)

            if unique_id[:SECURE_HASH_LENGTH] != secure_hash:
                raise InvalidHash(
                    "Provided hash does not match file's unique ID.")
            return await _serve_media_response(
                request,
                file_info=file_info,
                streamer=streamer,
                client_id=client_id,
                media_ref=message_id
            )

        except (FileNotFound, InvalidHash):
            work_loads[client_id] -= 1
            raise
        except web.HTTPException as e:
            work_loads[client_id] -= 1
            logger.debug(f"Client HTTP error in media stream: {e}")
            raise
        except Exception as e:
            work_loads[client_id] -= 1
            error_id = secrets.token_hex(6)
            logger.error(
                f"Stream error {error_id}: {e}",
                exc_info=True)
            raise web.HTTPInternalServerError(
                text=f"Server error during streaming: {error_id}") from e

    except (InvalidHash, FileNotFound) as e:
        logger.debug(f"Client error: {type(e).__name__} - {e}", exc_info=True)
        raise web.HTTPNotFound(text="Resource not found") from e
    except web.HTTPException as e:
        logger.warning(f"HTTP exception in media stream: {e}")
        raise
    except Exception as e:
        error_id = secrets.token_hex(6)
        logger.error(f"Server error {error_id}: {e}", exc_info=True)
        raise web.HTTPInternalServerError(
            text=f"An unexpected server error occurred: {error_id}") from e
