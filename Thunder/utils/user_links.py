"""Personal links: each user gets their own short code for a stored file.

The canonical /f/<hash> link is shared by everyone who sent the same file, so
it can neither expire nor be revoked for one person. A personal link
(/l/<code>/<name>) points at the same canonical file but carries its owner's
choice of lifetime, and the owner can extend or delete it from "My links".
"""

import datetime
import secrets
from typing import Any, Dict, Optional

from Thunder.utils import bot_i18n
from Thunder.utils.bot_utils import _build_links, quote_media_name
from Thunder.utils.database import db
from Thunder.utils.human_readable import humanbytes
from Thunder.utils.logger import logger

# Lifetime choices, in seconds (None = never expires). The key is what is stored.
TTL_CHOICES: Dict[str, Optional[int]] = {
    "24h": 24 * 3600,
    "7d": 7 * 24 * 3600,
    "30d": 30 * 24 * 3600,
    "forever": None,
}
DEFAULT_SETTINGS: Dict[str, Any] = {"link_ttl": "forever", "history": True, "lang": "auto"}
# How long an expired or deleted link is still listed before MongoDB removes it.
KEEP_EXPIRED = datetime.timedelta(days=14)
CODE_BYTES = 8  # 11 url-safe characters


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


async def get_settings(user_id: int) -> Dict[str, Any]:
    try:
        doc = await db.settings_col.find_one({"user_id": user_id}) or {}
    except Exception as e:
        logger.warning(f"Could not read settings for {user_id}: {e}")
        doc = {}
    settings = {**DEFAULT_SETTINGS, **{k: doc[k] for k in DEFAULT_SETTINGS if k in doc}}
    if settings["link_ttl"] not in TTL_CHOICES:
        settings["link_ttl"] = DEFAULT_SETTINGS["link_ttl"]
    if settings["lang"] != "auto" and settings["lang"] not in bot_i18n.T:
        settings["lang"] = "auto"
    settings["history"] = bool(settings["history"])
    return settings


async def set_setting(user_id: int, key: str, value: Any) -> None:
    if key not in DEFAULT_SETTINGS:
        raise ValueError(key)
    await db.settings_col.update_one({"user_id": user_id}, {"$set": {key: value}}, upsert=True)


def _expiry(ttl_key: str, start: datetime.datetime) -> Optional[datetime.datetime]:
    seconds = TTL_CHOICES.get(ttl_key)
    return start + datetime.timedelta(seconds=seconds) if seconds else None


def _purge_at(expires_at: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    return expires_at + KEEP_EXPIRED if expires_at else None


async def create_link(user_id: int, file_record: Dict[str, Any], settings: Dict[str, Any]) -> Dict[str, Any]:
    now = _now()
    expires_at = _expiry(settings["link_ttl"], now)
    doc = {
        "user_id": user_id,
        "public_hash": file_record["public_hash"],
        "file_name": str(file_record.get("file_name") or "file"),
        "file_size": int(file_record.get("file_size") or 0),
        "created_at": now,
        "expires_at": expires_at,
        "purge_at": _purge_at(expires_at),
        "revoked": False,
        "hidden": not settings["history"],
    }
    for _ in range(5):
        doc["code"] = secrets.token_urlsafe(CODE_BYTES)
        try:
            await db.links_col.insert_one(dict(doc))
            return doc
        except Exception as e:  # a code collision is astronomically rare; retry it
            if "duplicate key" not in str(e).lower():
                raise
    raise RuntimeError("could not allocate a link code")


def link_paths(doc: Dict[str, Any]) -> tuple[str, str]:
    name = quote_media_name(doc["file_name"])
    return f"/l/{doc['code']}/{name}", f"/watch/l/{doc['code']}/{name}"


async def personal_links(user_id: int, file_record: Dict[str, Any], shortener: bool) -> Dict[str, Any]:
    """Links for one user, honouring their settings. Shape matches gen_canonical_links."""
    settings = await get_settings(user_id)
    doc = await create_link(user_id, file_record, settings)
    download_path, stream_path = link_paths(doc)
    links = await _build_links(
        download_path=download_path,
        stream_path=stream_path,
        media_name=doc["file_name"],
        media_size=humanbytes(doc["file_size"]),
        shortener=shortener,
    )
    links.update(code=doc["code"], expires_at=doc["expires_at"], ttl=settings["link_ttl"], personal=True)
    return links


async def lang_for(user) -> str:
    """The language to talk to this Telegram user in."""
    if user is None:
        return "en"
    settings = await get_settings(user.id)
    return bot_i18n.resolve_lang(None if settings["lang"] == "auto" else settings["lang"],
                                 getattr(user, "language_code", None))


def link_state(doc: Optional[Dict[str, Any]]) -> str:
    """'ok', 'expired', 'revoked' or 'missing'."""
    if not doc:
        return "missing"
    if doc.get("revoked"):
        return "revoked"
    expires_at = doc.get("expires_at")
    if expires_at and expires_at <= _now():
        return "expired"
    return "ok"


async def resolve(code: str) -> tuple[Optional[Dict[str, Any]], str]:
    if not code or len(code) > 32 or not all(c.isalnum() or c in "-_" for c in code):
        return None, "missing"
    doc = await db.links_col.find_one({"code": code})
    return doc, link_state(doc)


async def list_links(user_id: int, page: int, per_page: int) -> tuple[list, int]:
    query = {"user_id": user_id, "hidden": {"$ne": True}, "revoked": {"$ne": True}}
    total = await db.links_col.count_documents(query)
    cursor = db.links_col.find(query).sort("created_at", -1).skip(page * per_page).limit(per_page)
    return [doc async for doc in cursor], total


async def get_own(user_id: int, code: str) -> Optional[Dict[str, Any]]:
    return await db.links_col.find_one({"code": code, "user_id": user_id})


async def revoke(user_id: int, code: str) -> bool:
    now = _now()
    result = await db.links_col.update_one(
        {"code": code, "user_id": user_id},
        {"$set": {"revoked": True, "revoked_at": now, "purge_at": now + KEEP_EXPIRED}},
    )
    return result.modified_count > 0


async def extend(user_id: int, code: str, ttl_key: str) -> Optional[Dict[str, Any]]:
    """Restart the link's lifetime from now with the given choice."""
    if ttl_key not in TTL_CHOICES:
        return None
    expires_at = _expiry(ttl_key, _now())
    await db.links_col.update_one(
        {"code": code, "user_id": user_id, "revoked": {"$ne": True}},
        {"$set": {"expires_at": expires_at, "purge_at": _purge_at(expires_at)}},
    )
    return await get_own(user_id, code)


async def purge_expired(user_id: int) -> int:
    result = await db.links_col.update_many(
        {"user_id": user_id, "revoked": {"$ne": True}, "expires_at": {"$ne": None, "$lte": _now()}},
        {"$set": {"revoked": True, "purge_at": _now() + datetime.timedelta(days=1)}},
    )
    return result.modified_count
