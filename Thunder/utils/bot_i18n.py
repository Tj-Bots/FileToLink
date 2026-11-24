"""User-facing bot texts: English, in the FileStreamBot look.

Small-caps lettering (Hᴇʏ, Fɪʟᴇ ɴᴀᴍᴇ…), bold labels and > quote blocks. Texts
are written in plain English below and converted to small caps once, at
import: placeholders {…}, `code`, /commands, @handles and links are left as
they are. The lang argument is kept so callers need not change if more
languages come back.
"""

import re
from typing import Any, Optional

_SMALL = str.maketrans("abcdefghijklmnopqrstuvwxyz", "ᴀʙᴄᴅᴇғɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ")
# Pieces that must survive untouched: placeholders, code, commands, handles, URLs, markup links.
_KEEP = re.compile(r"(\{[^}]*\}|`[^`]*`|\[[^\]]*\]\([^)]*\)|https?://\S+|/[a-z_]+|@\w+)")


def sc(text: str) -> str:
    """Small caps for lowercase letters outside the protected pieces."""
    return "".join(part if _KEEP.fullmatch(part) else part.translate(_SMALL)
                   for part in _KEEP.split(text))


LANG_NAMES = {"en": "English"}

_EN = {
    # ---- start / help / about
    "start": (
        "👋 **Hey, {name}**\n\n"
        "> **I'm a Telegram file streaming bot and direct link generator** ⚡\n"
        "> Send me any file and get a watch link and a download link in seconds.\n\n"
        "**Works in private chats, groups and channels.**\n\n"
        "💕 **@TJ_Bots**"
    ),
    "help": (
        "📖 **How to use me**\n\n"
        "> **1.** Send or forward me any file\n"
        "> **2.** I'll reply with a watch link and a download link\n"
        "> **3.** Manage your links any time in /mylinks\n\n"
        "👥 **In groups**\n"
        "> Reply to a file with /link, or /link 5 for five files in a row (up to {max}).\n"
        "> I need to be an admin there.\n\n"
        "⚙️ **Commands**\n"
        "> /settings · link lifetime and history\n"
        "> /mylinks · see, extend or revoke your links\n"
        "> /link · make links in groups\n"
        "> /ping · /dc · /about"
    ),
    "about": (
        "⚜️ **About me**\n\n"
        "> ✦ **Name :** Thunder File to Link\n"
        "> ✦ **Player :** audio tracks & subtitles in the browser\n"
        "> ✦ **Downloads :** fast, resumable, any size\n"
        "> ✦ **Links :** choose how long they last, revoke any time\n"
        "> ✦ **Developer :** **@TJ_Bots**\n\n"
        "💕 If I help you, share me with your friends!"
    ),
    "b_links": "🗂 My links", "b_settings": "⚙️ Settings", "b_help": "📖 Help", "b_about": "⚜️ About",
    "b_back": "⬅️ Back", "b_close": "✖️ Close", "b_channel": "📢 Updates", "b_group": "💬 Group",
    # ---- link message
    "ready": (
        "--__**Your Link Generated !**__--\n\n"
        "> 📂 **File name :** `{name}`\n"
        "> 📦 **File size :** `{size}`\n"
        "> ⏳ **Valid for :** `{validity}`\n\n"
        "📥 **Download :**\n> {download}\n\n"
        "🖥 **Watch :**\n> {watch}"
    ),
    "v_forever": "Forever ♾", "v_until": "{ttl} · until {when} UTC",
    "b_watch": "🖥 Stream", "b_download": "📥 Download", "b_copy": "📋 Copy link", "b_revoke": "🗑 Revoke link",
    "b_delete": "🗑 Revoke", "processing": "⏳ **Processing your file...**",
    # ---- settings
    "settings": (
        "⚙️ **Your settings**\n\n"
        "> ⏳ **Link lifetime :** `{ttl}`\n"
        "> 💾 **Save to My links :** `{hist}`\n\n"
        "**Tap a button below to change it.**"
    ),
    "s_ttl": "⏳ Link lifetime", "s_hist": "💾 Save to My links · {v}",
    "on": "On", "off": "Off",
    "ttl_title": "⏳ **Link lifetime**\n\n> How long should your new links keep working?",
    "ttl_24h": "24 hours", "ttl_7d": "7 days", "ttl_30d": "30 days", "ttl_forever": "Forever",
    "saved": "✅ Saved",
    # ---- my links
    "links": "🗂 **My links**\n\n> 🔗 **Total links :** `{n}`\n> Tap a link to manage it.",
    "links_empty": "🗂 **My links**\n\n> You have no links yet.\n> Send me a file and its link will show up here.",
    "b_clear": "🧹 Clear expired",
    "d": "{n}d", "h": "{n}h", "m": "{n}m",
    "detail": (
        "--__**Link Details**__--\n\n"
        "> 📂 **File name :** `{name}`\n"
        "> 📦 **File size :** `{size}`\n"
        "> ⏳ **Valid for :** `{status}`\n"
        "> 📅 **Created on :** `{created}`"
    ),
    "detail_links": "\n\n📥 **Download :**\n> {download}\n\n🖥 **Watch :**\n> {watch}",
    "st_forever": "Forever ♾", "st_left": "{left} left · until {when} UTC", "st_expired": "Expired ⛔",
    "dead": "\n\n⚠️ **This link no longer works.**\n> Extend it to turn it back on.",
    "b_extend": "⏳ Extend",
    "ext_title": "⏳ **Extend link**\n\n> From now on, keep this link working for:",
    "extended": "✅ Extended",
    "del_q": "🗑 **Revoke this link?**\n\n> 📂 `{name}`\n> It stops working right away for everyone who has it.",
    "b_yes_del": "✅ Yes, revoke", "b_cancel": "❌ No",
    "deleted": "🗑 Link revoked", "cleared": "🧹 Removed {n}",
    "gone": "This link no longer exists.", "error": "⚠️ Something went wrong. Please try again.",
}

# Texts that are not converted: toasts (shown as plain popups) and durations.
_PLAIN = {"saved", "extended", "deleted", "cleared", "gone", "error", "d", "h", "m"}

T: dict[str, dict[str, str]] = {"en": {k: (v if k in _PLAIN else sc(v)) for k, v in _EN.items()}}


def detect(language_code: Optional[str]) -> str:
    return "en"


def resolve_lang(setting: Optional[str], language_code: Optional[str]) -> str:
    return "en"


def tr(lang: str, key: str, **kw: Any) -> str:
    text = T["en"][key]
    return text.format(**kw) if kw else text
