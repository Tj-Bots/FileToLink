"""User panels: /settings (link lifetime, message style, history) and /mylinks.

Callbacks register in group -1 so they run before callbacks.py's catch-all.
Every query is scoped to the user who pressed the button, never to whoever
the message belongs to.
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
from Thunder.utils.bot_utils import _build_links, log_newusr
from Thunder.utils.database import db
from Thunder.utils.decorators import check_banned
from Thunder.utils.human_readable import humanbytes
from Thunder.utils.logger import logger
from Thunder.utils.messages import (
    MSG_BUTTON_BACK, MSG_BUTTON_BACK_TO_LIST, MSG_BUTTON_CANCEL,
    MSG_BUTTON_CLEAR_EXPIRED, MSG_BUTTON_CLOSE, MSG_BUTTON_CONFIRM_DELETE,
    MSG_BUTTON_DELETE, MSG_BUTTON_DOWNLOAD, MSG_BUTTON_EXTEND, MSG_BUTTON_HISTORY,
    MSG_BUTTON_MY_LINKS, MSG_BUTTON_SETTINGS, MSG_BUTTON_STREAM_NOW,
    MSG_EXPIRED_CLEARED, MSG_LINK_DELETE_CONFIRM, MSG_LINK_DELETED,
    MSG_LINK_DETAILS, MSG_LINK_DETAILS_DEAD, MSG_LINK_DETAILS_LINKS,
    MSG_LINK_EXTENDED, MSG_LINK_NOT_FOUND, MSG_LINK_STATUS_EXPIRED,
    MSG_LINK_STATUS_FOREVER, MSG_LINK_STATUS_LEFT, MSG_MYLINKS_EMPTY,
    MSG_MYLINKS_HEADER, MSG_MYLINKS_ITEM, MSG_OFF, MSG_ON, MSG_SETTING_SAVED,
    MSG_SETTINGS, MSG_STYLE_NAMES, MSG_TTL_NAMES
)

PER_PAGE = 6
CLOSE_BTN = InlineKeyboardButton(MSG_BUTTON_CLOSE, callback_data="close_panel", style=ButtonStyle.DANGER)


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


# ------------------------------------------------------------------ settings

def _mark(label: str, on: bool) -> str:
    return f"✓ {label}" if on else label


def _settings_view(settings: dict):
    text = MSG_SETTINGS.format(
        ttl=MSG_TTL_NAMES[settings["link_ttl"]],
        style=MSG_STYLE_NAMES[settings["style"]],
        history=MSG_ON if settings["history"] else MSG_OFF,
    )
    ttl_row = [
        InlineKeyboardButton(
            _mark(MSG_TTL_NAMES[key], settings["link_ttl"] == key),
            callback_data=f"st:t:{key}",
            style=ButtonStyle.SUCCESS if settings["link_ttl"] == key else ButtonStyle.DEFAULT,
        )
        for key in user_links.TTL_CHOICES
    ]
    rows = [
        ttl_row[:2], ttl_row[2:],
        [InlineKeyboardButton(
            _mark(MSG_STYLE_NAMES[key], settings["style"] == key),
            callback_data=f"st:s:{key}",
            style=ButtonStyle.SUCCESS if settings["style"] == key else ButtonStyle.DEFAULT,
        ) for key in user_links.STYLE_CHOICES],
        [InlineKeyboardButton(
            MSG_BUTTON_HISTORY.format(state=MSG_ON if settings["history"] else MSG_OFF),
            callback_data="st:h",
            style=ButtonStyle.SUCCESS if settings["history"] else ButtonStyle.DANGER,
        )],
        [InlineKeyboardButton(MSG_BUTTON_MY_LINKS, callback_data="ml:p:0", style=ButtonStyle.PRIMARY)],
        [InlineKeyboardButton(MSG_BUTTON_BACK, callback_data="back_to_start"), CLOSE_BTN],
    ]
    return text, InlineKeyboardMarkup(rows)


@StreamBot.on_message(filters.command("settings") & filters.private)
async def settings_command(bot: Client, msg: Message):
    if not await check_banned(bot, msg) or not msg.from_user:
        return
    await log_newusr(bot, msg.from_user.id, msg.from_user.first_name or "")
    text, markup = _settings_view(await user_links.get_settings(msg.from_user.id))
    await _send(msg, text, markup)


@StreamBot.on_callback_query(filters.regex(r"^st(:|$)"), group=-1)
async def settings_callback(client: Client, cq: CallbackQuery):
    try:
        uid = cq.from_user.id
        parts = cq.data.split(":")
        saved = False
        if len(parts) == 3 and parts[1] == "t" and parts[2] in user_links.TTL_CHOICES:
            await user_links.set_setting(uid, "link_ttl", parts[2])
            saved = True
        elif len(parts) == 3 and parts[1] == "s" and parts[2] in user_links.STYLE_CHOICES:
            await user_links.set_setting(uid, "style", parts[2])
            saved = True
        elif parts[1:] == ["h"]:
            current = await user_links.get_settings(uid)
            await user_links.set_setting(uid, "history", not current["history"])
            saved = True
        await _answer(cq, MSG_SETTING_SAVED if saved else "")
        text, markup = _settings_view(await user_links.get_settings(uid))
        await _edit(cq, text, markup)
    except Exception as e:
        logger.error(f"Settings callback error: {e}", exc_info=True)
        await _answer(cq, "⚠️ Something went wrong, please try again.", alert=True)
    cq.stop_propagation()


# ------------------------------------------------------------------ my links

def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


def _left(delta: datetime.timedelta) -> str:
    minutes = int(delta.total_seconds() // 60)
    if minutes >= 2 * 24 * 60:
        return f"{minutes // (24 * 60)}d"
    if minutes >= 60:
        return f"{minutes // 60}h"
    return f"{max(1, minutes)}m"


def _status(doc: dict) -> str:
    state = user_links.link_state(doc)
    if state != "ok":
        return MSG_LINK_STATUS_EXPIRED
    if not doc.get("expires_at"):
        return MSG_LINK_STATUS_FOREVER
    return MSG_LINK_STATUS_LEFT.format(left=_left(doc["expires_at"] - _now()))


def _short(name: str, n: int = 28) -> str:
    return name if len(name) <= n else name[: n - 1] + "…"


def _safe(name: str) -> str:
    # Inside `code` only a backtick can break the markup.
    return name.replace("`", "'")


async def _list_view(uid: int, page: int):
    total = await db_total(uid)
    if total == 0:
        return MSG_MYLINKS_EMPTY, InlineKeyboardMarkup([
            [InlineKeyboardButton(MSG_BUTTON_SETTINGS, callback_data="st")],
            [InlineKeyboardButton(MSG_BUTTON_BACK, callback_data="back_to_start"), CLOSE_BTN],
        ])
    pages = max(1, math.ceil(total / PER_PAGE))
    page = min(max(0, page), pages - 1)
    docs, _ = await user_links.list_links(uid, page, PER_PAGE)
    text = MSG_MYLINKS_HEADER.format(total=total, page=page + 1, pages=pages)
    rows = []
    any_expired = False
    for i, doc in enumerate(docs, start=page * PER_PAGE + 1):
        text += MSG_MYLINKS_ITEM.format(n=i, name=_safe(doc["file_name"]),
                                        size=humanbytes(doc.get("file_size") or 0), status=_status(doc))
        dead = user_links.link_state(doc) != "ok"
        any_expired |= dead
        rows.append([InlineKeyboardButton(
            f"{'⛔' if dead else '🔗'} {i}. {_short(doc['file_name'])}",
            callback_data=f"ml:v:{doc['code']}:{page}",
        )])
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton("◀️", callback_data=f"ml:p:{page - 1}"))
    if pages > 1:
        nav.append(InlineKeyboardButton(f"{page + 1}/{pages}", callback_data=f"ml:p:{page}"))
    if page < pages - 1:
        nav.append(InlineKeyboardButton("▶️", callback_data=f"ml:p:{page + 1}"))
    if nav:
        rows.append(nav)
    if any_expired or await db.links_col.count_documents(
            {"user_id": uid, "revoked": {"$ne": True}, "hidden": {"$ne": True},
             "expires_at": {"$ne": None, "$lte": _now()}}):
        rows.append([InlineKeyboardButton(MSG_BUTTON_CLEAR_EXPIRED, callback_data="ml:c")])
    rows.append([InlineKeyboardButton(MSG_BUTTON_SETTINGS, callback_data="st"), CLOSE_BTN])
    return text, InlineKeyboardMarkup(rows)


async def db_total(uid: int) -> int:
    return await db.links_col.count_documents(
        {"user_id": uid, "hidden": {"$ne": True}, "revoked": {"$ne": True}})


async def _detail_view(doc: dict, page: int):
    live = user_links.link_state(doc) == "ok"
    download_path, stream_path = user_links.link_paths(doc)
    links = await _build_links(download_path=download_path, stream_path=stream_path,
                               media_name=doc["file_name"], media_size="", shortener=False)
    status = _status(doc)
    if doc.get("expires_at") and live:
        status += f" · until {doc['expires_at'].strftime('%Y-%m-%d %H:%M')} UTC"
    text = MSG_LINK_DETAILS.format(
        name=_safe(doc["file_name"]),
        size=humanbytes(doc.get("file_size") or 0),
        created=doc["created_at"].strftime("%Y-%m-%d %H:%M"),
        status=status,
        links=(MSG_LINK_DETAILS_LINKS.format(watch=links["stream_link"], download=links["online_link"])
               if live else MSG_LINK_DETAILS_DEAD),
    )
    code = doc["code"]
    rows = []
    if live:
        rows.append([
            InlineKeyboardButton(MSG_BUTTON_STREAM_NOW, url=links["stream_link"], style=ButtonStyle.SUCCESS),
            InlineKeyboardButton(MSG_BUTTON_DOWNLOAD, url=links["online_link"], style=ButtonStyle.PRIMARY),
        ])
    rows.append([InlineKeyboardButton(MSG_BUTTON_EXTEND, callback_data=f"ml:v:{code}:{page}")])
    rows.append([InlineKeyboardButton(MSG_TTL_NAMES[key], callback_data=f"ml:x:{code}:{key}:{page}")
                 for key in user_links.TTL_CHOICES])
    rows.append([InlineKeyboardButton(MSG_BUTTON_DELETE, callback_data=f"ml:d:{code}:{page}",
                                      style=ButtonStyle.DANGER)])
    rows.append([InlineKeyboardButton(MSG_BUTTON_BACK_TO_LIST, callback_data=f"ml:p:{page}"), CLOSE_BTN])
    return text, InlineKeyboardMarkup(rows)


@StreamBot.on_message(filters.command("mylinks") & filters.private)
async def mylinks_command(bot: Client, msg: Message):
    if not await check_banned(bot, msg) or not msg.from_user:
        return
    await log_newusr(bot, msg.from_user.id, msg.from_user.first_name or "")
    text, markup = await _list_view(msg.from_user.id, 0)
    await _send(msg, text, markup)


def _page(value: str) -> int:
    try:
        return max(0, int(value))
    except ValueError:
        return 0


@StreamBot.on_callback_query(filters.regex(r"^ml:"), group=-1)
async def mylinks_callback(client: Client, cq: CallbackQuery):
    try:
        uid = cq.from_user.id
        parts = cq.data.split(":")
        action = parts[1] if len(parts) > 1 else "p"

        if action == "p":
            await _answer(cq)
            text, markup = await _list_view(uid, _page(parts[2]) if len(parts) > 2 else 0)
            await _edit(cq, text, markup)

        elif action == "c":
            count = await user_links.purge_expired(uid)
            await _answer(cq, MSG_EXPIRED_CLEARED.format(count=count))
            text, markup = await _list_view(uid, 0)
            await _edit(cq, text, markup)

        elif action in ("v", "x", "d", "D") and len(parts) >= 4:
            code, page = parts[2], _page(parts[-1])
            doc = await user_links.get_own(uid, code)
            if not doc or doc.get("revoked"):
                await _answer(cq, MSG_LINK_NOT_FOUND, alert=True)
                text, markup = await _list_view(uid, page)
                await _edit(cq, text, markup)
            elif action == "v":
                await _answer(cq)
                await _edit(cq, *await _detail_view(doc, page))
            elif action == "x" and len(parts) == 5:
                doc = await user_links.extend(uid, code, parts[3]) or doc
                await _answer(cq, MSG_LINK_EXTENDED)
                await _edit(cq, *await _detail_view(doc, page))
            elif action == "d":
                await _answer(cq)
                await _edit(cq, MSG_LINK_DELETE_CONFIRM.format(name=_safe(doc["file_name"])), InlineKeyboardMarkup([[
                    InlineKeyboardButton(MSG_BUTTON_CONFIRM_DELETE, callback_data=f"ml:D:{code}:{page}",
                                         style=ButtonStyle.DANGER),
                    InlineKeyboardButton(MSG_BUTTON_CANCEL, callback_data=f"ml:v:{code}:{page}"),
                ]]))
            elif action == "D":
                await user_links.revoke(uid, code)
                await _answer(cq, MSG_LINK_DELETED)
                text, markup = await _list_view(uid, page)
                await _edit(cq, text, markup)
        else:
            await _answer(cq)
    except Exception as e:
        logger.error(f"My links callback error: {e}", exc_info=True)
        await _answer(cq, "⚠️ Something went wrong, please try again.", alert=True)
    cq.stop_propagation()
