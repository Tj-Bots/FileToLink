"""Streams a Telegram file over HTTP without buffering the whole thing.

ByteStreamer yields byte ranges from the storage channel, which is what lets
the download routes answer Range requests and serve files far larger than RAM.
"""

import asyncio
import os
from collections import deque
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, Optional

from pyrogram import Client, raw
from pyrogram.errors import FloodWait
from pyrogram.file_id import FileId, FileType
from pyrogram.types import Message

from Thunder.server.exceptions import FileNotFound
from Thunder.utils.file_properties import get_media
from Thunder.utils.logger import logger
from Thunder.vars import Var


CHUNK = 1024 * 1024
# GetFile requests kept in flight per HTTP request. wzgram's own get_file paces
# bots to a fixed request rate and shares one read-ahead budget between every
# transfer, which caps a multi-connection download (aria2, IDM) at a few MB/s.
# Serving reads straight from the media session, as pyrogram used to, does not.
PREFETCH = max(1, int(os.environ.get("STREAM_PREFETCH", "4")))


def _file_location(file_id: FileId):
    if file_id.file_type == FileType.PHOTO:
        return raw.types.InputPhotoFileLocation(
            id=file_id.media_id,
            access_hash=file_id.access_hash,
            file_reference=file_id.file_reference,
            thumb_size=file_id.thumbnail_size,
        )
    return raw.types.InputDocumentFileLocation(
        id=file_id.media_id,
        access_hash=file_id.access_hash,
        file_reference=file_id.file_reference,
        thumb_size=file_id.thumbnail_size,
    )


class _Unsupported(Exception):
    """The direct path cannot serve this file; use the library's get_file."""


class ByteStreamer:
    __slots__ = ('client', 'chat_id')

    def __init__(self, client: Client) -> None:
        self.client = client
        self.chat_id = int(Var.BIN_CHANNEL)

    async def get_message(self, message_id: int) -> Message:
        while True:
            try:
                message = await self.client.get_messages(self.chat_id, message_id)
                break
            except FloodWait as e:
                logger.debug(f"FloodWait: get_message, sleep {e.value}s")
                await asyncio.sleep(e.value)
            except Exception as e:
                logger.debug(f"Error fetching message {message_id}: {e}", exc_info=True)
                raise FileNotFound(f"Message {message_id} not found") from e

        if not message or not message.media:
            raise FileNotFound(f"Message {message_id} not found")
        return message

    async def _get_chunk(self, session, location, offset: int) -> bytes:
        for _attempt in range(5):
            try:
                r = await session.invoke(
                    raw.functions.upload.GetFile(location=location, offset=offset, limit=CHUNK),
                    sleep_threshold=0,
                )
            except FloodWait as e:
                if e.value > 60:
                    raise
                await asyncio.sleep(e.value)
                continue
            if isinstance(r, raw.types.upload.File):
                return r.bytes
            raise _Unsupported(type(r).__name__)
        raise _Unsupported("repeated FloodWait")

    async def _direct_chunks(self, message: Message, chunk_offset: int,
                             chunk_limit: int) -> AsyncGenerator[bytes, None]:
        media = get_media(message)
        if media is None or not getattr(media, "file_id", None):
            raise _Unsupported("no media")
        file_id = FileId.decode(media.file_id)
        if file_id.file_type in (FileType.CHAT_PHOTO, FileType.THUMBNAIL):
            raise _Unsupported("chat photo")
        location = _file_location(file_id)
        session = await self.client.get_session(file_id.dc_id, is_media=True)

        size = int(getattr(media, "file_size", 0) or 0)
        last = (size + CHUNK - 1) // CHUNK if size else None
        stop = chunk_offset + chunk_limit if chunk_limit else last
        if stop is not None and last is not None:
            stop = min(stop, last)

        pending: deque = deque()
        nxt = chunk_offset

        def fill():
            nonlocal nxt
            while len(pending) < PREFETCH and (stop is None or nxt < stop):
                pending.append(asyncio.ensure_future(self._get_chunk(session, location, nxt * CHUNK)))
                nxt += 1

        try:
            fill()
            while pending:
                data = await pending.popleft()
                if not data:
                    return
                yield data
                if len(data) < CHUNK:
                    return
                fill()
        finally:
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

    async def stream_file(
        self,
        media_ref: int | Message,
        offset: int = 0,
        limit: int = 0,
        fallback_message_id: int | None = None,
        on_fallback_message: Optional[Callable[[Message], Awaitable[None]]] = None
    ) -> AsyncGenerator[bytes, None]:
        chunk_offset = offset // (1024 * 1024)
        chunk_limit = 0
        if limit > 0:
            chunk_limit = ((limit + (1024 * 1024) - 1) // (1024 * 1024)) + 1

        refs: list[int | Message] = [media_ref]
        media_id = media_ref if isinstance(media_ref, int) else None
        if isinstance(media_ref, Message):
            media_id = getattr(media_ref, "id", getattr(media_ref, "message_id", None))
        if fallback_message_id is not None and (media_id is None or fallback_message_id != media_id):
            refs.append(fallback_message_id)

        last_error: Exception | None = None
        for ref in refs:
            started_stream = False
            while True:
                try:
                    target = await self.get_message(ref) if isinstance(ref, int) else ref
                    if (
                        on_fallback_message is not None and
                        fallback_message_id is not None and
                        ref == fallback_message_id and
                        isinstance(target, Message)
                    ):
                        await on_fallback_message(target)
                    try:
                        async for chunk in self._direct_chunks(target, chunk_offset, chunk_limit):
                            started_stream = True
                            yield chunk
                        return
                    except _Unsupported as e:
                        if started_stream:
                            raise
                        logger.debug(f"Direct stream unavailable ({e}); using get_file")
                    async for chunk in self.client.stream_media(
                        target, offset=chunk_offset, limit=chunk_limit
                    ):
                        started_stream = True
                        yield chunk
                    return
                except FloodWait as e:
                    logger.debug(f"FloodWait: stream_file, sleep {e.value}s")
                    await asyncio.sleep(e.value)
                except Exception as e:
                    last_error = e
                    logger.debug(f"Error streaming media ref {ref}: {e}", exc_info=True)
                    if started_stream:
                        raise
                    break

        raise FileNotFound(f"Unable to stream file: {last_error}")

    def get_file_info_sync(self, message: Message) -> Dict[str, Any]:
        media = get_media(message)
        if not media:
            return {"message_id": message.id, "error": "No media"}

        media_type = type(media).__name__.lower()
        file_name = getattr(media, 'file_name', None)
        mime_type = getattr(media, 'mime_type', None)

        if not file_name:
            ext_map = {
                "photo": "jpg",
                "audio": "mp3",
                "voice": "ogg",
                "video": "mp4",
                "animation": "mp4",
                "videonote": "mp4",
                "sticker": "webp",
            }
            ext = ext_map.get(media_type, "bin")
            file_name = f"Thunder_{message.id}.{ext}"

        if not mime_type:
            mime_map = {
                "photo": "image/jpeg",
                "voice": "audio/ogg",
                "videonote": "video/mp4",
            }
            mime_type = mime_map.get(media_type)

        return {
            "message_id": message.id,
            "file_size": getattr(media, 'file_size', 0) or 0,
            "file_name": file_name,
            "mime_type": mime_type,
            "unique_id": getattr(media, 'file_unique_id', None),
            "media_type": media_type
        }

    async def get_file_info(self, message_id: int) -> Dict[str, Any]:
        try:
            message = await self.get_message(message_id)
            return self.get_file_info_sync(message)
        except Exception as e:
            logger.debug(f"Error getting file info for {message_id}: {e}", exc_info=True)
            return {"message_id": message_id, "error": str(e)}
