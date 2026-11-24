"""User panels: /settings and /mylinks, in the user's language.

One short screen at a time: a heading and a line or two, with buttons doing
the work. Callbacks register in group -1 so they run before callbacks.py's
catch-all, and every query is scoped to the user who pressed the button.
"""

import asyncio
import datetime
import math

from pyrogram import Client, filters
from pyrogram.enums import ButtonStyle
from pyrogram.errors import FloodWait, MessageNotModified
from pyrogram.types import (CallbackQuery, InlineKeyboardButton,
                            InlineKeyboardMarkup, Message)

from Thunder.bot import StreamBot
from Thunder.utils import user_links
from Thunder.utils.bot_i18n import tr
from Thunder.utils.bot_utils import _build_links, back_button, close_button, log_newusr
from Thunder.utils.database import db
from Thunder.utils.decorators import check_banned
from Thunder.utils.human_readable import humanbytes
from Thunder.utils.logger import logger

PER_PAGE = 8
B = InlineKeyboardButton


# ------------------------------------------------------------------ helpers

async def _send(msg: Message, text: str, markup: InlineKeyboardMarkup):
    try:
        await msg.reply_text(text, reply_markup=markup, quote=True, disable_web_page_preview=True)
    except FloodWait as e:
        await asyncio.sleep(e.value)
        await msg.reply_text(text, reply_markup=markup, quote=True, disable_web_page_preview=True)


async def _edit(cq: CallbackQuery, text: str, markup: InlineKeyboardMarkup):
    try:
        await cq.message.edit_text(text, reply_markup=markup, disable_web_page_preview=True)
    except MessageNotModified:
        pass
    except FloodWait as e:
        await asyncio.sleep(e.value)
        await cq.message.edit_text(text, reply_markup=markup, disable_web_page_preview=True)


async def _answer(cq: CallbackQuery, text: str = "", alert: bool = False):
    try:
        await cq.answer(text, show_alert=alert)
    except Exception:
        pass


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


def _tick(label: str, on: bool) -> str:
    return f"✅ {label}" if on else label


def _left(lang: str, delta: datetime.timedelta) -> str:
    minutes = int(delta.total_seconds() // 60)
    if minutes >= 2 * 24 * 60:
        return tr(lang, "d", n=minutes // (24 * 60))
    if minutes >= 60:
        return tr(lang, "h", n=minutes // 60)
    return tr(lang, "m", n=max(1, minutes))


def _short(name: str, n: int = 30) -> str:
    return name if len(name) <= n else name[: n - 1] + "…"


def _safe(name: str) -> str:
    return name.replace("`", "'")  # inside `code` only a backtick breaks the markup


def _ttl_name(lang: str, key: str) -> str:
    return tr(lang, f"ttl_{key}")


# ------------------------------------------------------------------ settings

def _settings_view(lang: str, s: dict):
    hist = tr(lang, "on") if s["history"] else tr(lang, "off")
    text = tr(lang, "settings", ttl=_ttl_name(lang, s["link_ttl"]), hist=hist)
    rows = [
        [B(tr(lang, "s_ttl"), callback_data="st:ttl")],
        [B(tr(lang, "s_hist", v=hist), callback_data="st:h")],
        [back_button(), close_button()],
    ]
    return text, InlineKeyboardMarkup(rows)


def _ttl_view(lang: str, s: dict):
    keys = list(user_links.TTL_CHOICES)
    buttons = [B(_tick(_ttl_name(lang, k), s["link_ttl"] == k), callback_data=f"st:t:{k}") for k in keys]
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    rows.append([back_button("st"), close_button()])
    return tr(lang, "ttl_title"), InlineKeyboardMarkup(rows)


@StreamBot.on_message(filters.command("settings") & filters.private)
async def settings_command(bot: Client, msg: Message):
    if not await check_banned(bot, msg) or not msg.from_user:
        return
    await log_newusr(bot, msg.from_user.id, msg.from_user.first_name or "")
    lang = await user_links.lang_for(msg.from_user)
    await _send(msg, *_settings_view(lang, await user_links.get_settings(msg.from_user.id)))


@StreamBot.on_callback_query(filters.regex(r"^st(:|$)"), group=-1)
async def settings_callback(client: Client, cq: CallbackQuery):
    try:
        user = cq.from_user
        parts = cq.data.split(":")
        view = _settings_view
        toast = ""
        if parts[1:] == ["ttl"]:
            view = _ttl_view
        elif len(parts) == 3 and parts[1] == "t" and parts[2] in user_links.TTL_CHOICES:
            await user_links.set_setting(user.id, "link_ttl", parts[2])
            toast = "saved"
        elif parts[1:] == ["h"]:
            current = await user_links.get_settings(user.id)
            await user_links.set_setting(user.id, "history", not current["history"])
            toast = "saved"
        lang = await user_links.lang_for(user)
        await _answer(cq, tr(lang, toast) if toast else "")
        await _edit(cq, *view(lang, await user_links.get_settings(user.id)))
    except Exception as e:
        logger.error(f"Settings callback error: {e}", exc_info=True)
        await _answer(cq, tr("en", "error"), alert=True)
    cq.stop_propagation()


# ------------------------------------------------------------------ my links

def _label(lang: str, doc: dict) -> str:
    if user_links.link_state(doc) != "ok":
        return f"🔴 {_short(doc['file_name'])}"
    if not doc.get("expires_at"):
        return f"🟢 {_short(doc['file_name'])} · ♾"
    return f"🟢 {_short(doc['file_name'])} · {_left(lang, doc['expires_at'] - _now())}"


def _status(lang: str, doc: dict) -> str:
    if user_links.link_state(doc) != "ok":
        return tr(lang, "st_expired")
    if not doc.get("expires_at"):
        return tr(lang, "st_forever")
    return tr(lang, "st_left", left=_left(lang, doc["expires_at"] - _now()),
              when=doc["expires_at"].strftime("%d.%m.%Y %H:%M"))


async def _list_view(lang: str, uid: int, page: int):
    query = {"user_id": uid, "hidden": {"$ne": True}, "revoked": {"$ne": True}}
    total = await db.links_col.count_documents(query)
    if total == 0:
        return tr(lang, "links_empty"), InlineKeyboardMarkup([[back_button(), close_button()]])
    pages = max(1, math.ceil(total / PER_PAGE))
    page = min(max(0, page), pages - 1)
    docs, _ = await user_links.list_links(uid, page, PER_PAGE)
    rows = [[B(_label(lang, d), callback_data=f"ml:v:{d['code']}:{page}")] for d in docs]
    if pages > 1:
        rows.append([
            B("‹", callback_data=f"ml:p:{max(0, page - 1)}"),
            B(f"{page + 1} / {pages}", callback_data=f"ml:p:{page}"),
            B("›", callback_data=f"ml:p:{min(pages - 1, page + 1)}"),
        ])
    expired = await db.links_col.count_documents(
        {**query, "expires_at": {"$ne": None, "$lte": _now()}})
    if expired:
        rows.append([B(tr(lang, "b_clear"), callback_data="ml:c")])
    rows.append([back_button(), close_button()])
    return tr(lang, "links", n=total), InlineKeyboardMarkup(rows)


async def _detail_view(lang: str, doc: dict, page: int):
    """The same card as the message a new link arrives in, plus extend / revoke."""
    live = user_links.link_state(doc) == "ok"
    text = tr(lang, "detail", name=_safe(doc["file_name"]), size=humanbytes(doc.get("file_size") or 0),
              status=_status(lang, doc), created=doc["created_at"].strftime("%d.%m.%Y"))
    code = doc["code"]
    rows = []
    if live:
        download_path, stream_path = user_links.link_paths(doc)
        links = await _build_links(download_path=download_path, stream_path=stream_path,
                                   media_name=doc["file_name"], media_size="", shortener=False)
        text += tr(lang, "detail_links", download=links["online_link"], watch=links["stream_link"])
        rows.append([B(tr(lang, "b_watch"), url=links["stream_link"], style=ButtonStyle.SUCCESS),
                     B(tr(lang, "b_download"), url=links["online_link"], style=ButtonStyle.SUCCESS)])
    else:
        text += tr(lang, "dead")
    rows.append([B(tr(lang, "b_extend"), callback_data=f"ml:e:{code}:{page}"),
                 B(tr(lang, "b_delete"), callback_data=f"ml:d:{code}:{page}", style=ButtonStyle.DANGER)])
    rows.append([back_button(f"ml:p:{page}"), close_button()])
    return text, InlineKeyboardMarkup(rows)


def _extend_view(lang: str, doc: dict, page: int):
    code = doc["code"]
    buttons = [B(_ttl_name(lang, k), callback_data=f"ml:x:{code}:{k}:{page}") for k in user_links.TTL_CHOICES]
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    rows.append([back_button(f"ml:v:{code}:{page}"), close_button()])
    return tr(lang, "ext_title"), InlineKeyboardMarkup(rows)


def _delete_view(lang: str, doc: dict, page: int):
    code = doc["code"]
    return tr(lang, "del_q", name=_safe(doc["file_name"])), InlineKeyboardMarkup([[
        B(tr(lang, "b_yes_del"), callback_data=f"ml:D:{code}:{page}", style=ButtonStyle.DANGER),
        B(tr(lang, "b_cancel"), callback_data=f"ml:v:{code}:{page}", style=ButtonStyle.PRIMARY),
    ]])


@StreamBot.on_message(filters.command("mylinks") & filters.private)
async def mylinks_command(bot: Client, msg: Message):
    if not await check_banned(bot, msg) or not msg.from_user:
        return
    await log_newusr(bot, msg.from_user.id, msg.from_user.first_name or "")
    lang = await user_links.lang_for(msg.from_user)
    await _send(msg, *await _list_view(lang, msg.from_user.id, 0))


def _page(value: str) -> int:
    try:
        return max(0, int(value))
    except ValueError:
        return 0


@StreamBot.on_callback_query(filters.regex(r"^ml:"), group=-1)
async def mylinks_callback(client: Client, cq: CallbackQuery):
    lang = "en"
    try:
        user = cq.from_user
        uid = user.id
        lang = await user_links.lang_for(user)
        parts = cq.data.split(":")
        action = parts[1] if len(parts) > 1 else "p"

        if action == "p":
            await _answer(cq)
            await _edit(cq, *await _list_view(lang, uid, _page(parts[2]) if len(parts) > 2 else 0))
        elif action == "c":
            count = await user_links.purge_expired(uid)
            await _answer(cq, tr(lang, "cleared", n=count))
            await _edit(cq, *await _list_view(lang, uid, 0))
        elif action in ("v", "e", "x", "d", "D") and len(parts) >= 4:
            code, page = parts[2], _page(parts[-1])
            doc = await user_links.get_own(uid, code)
            if not doc or doc.get("revoked"):
                await _answer(cq, tr(lang, "gone"), alert=True)
                await _edit(cq, *await _list_view(lang, uid, page))
            elif action == "v":
                await _answer(cq)
                await _edit(cq, *await _detail_view(lang, doc, page))
            elif action == "e":
                await _answer(cq)
                await _edit(cq, *_extend_view(lang, doc, page))
            elif action == "x" and len(parts) == 5:
                doc = await user_links.extend(uid, code, parts[3]) or doc
                await _answer(cq, tr(lang, "extended"))
                await _edit(cq, *await _detail_view(lang, doc, page))
            elif action == "d":
                await _answer(cq)
                await _edit(cq, *_delete_view(lang, doc, page))
            elif action == "D":
                await user_links.revoke(uid, code)
                await _answer(cq, tr(lang, "deleted"))
                await _edit(cq, *await _list_view(lang, uid, page))
        else:
            await _answer(cq)
    except Exception as e:
        logger.error(f"My links callback error: {e}", exc_info=True)
        await _answer(cq, tr(lang, "error"), alert=True)
    cq.stop_propagation()
