"""Personal links: lifetime, listing, extension and revocation, on a fake collection."""
import datetime

import pytest

from Thunder.server import stream_routes
from Thunder.utils import user_links


def _match(doc, query):
    for key, cond in query.items():
        value = doc.get(key)
        if isinstance(cond, dict):
            for op, arg in cond.items():
                if op == "$ne" and value == arg:
                    return False
                if op == "$lte" and (value is None or not value <= arg):
                    return False
        elif value != cond:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction):
        self.docs.sort(key=lambda d: d[key], reverse=direction < 0)
        return self

    def skip(self, n):
        self.docs = self.docs[n:]
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()


class FakeCollection:
    def __init__(self):
        self.docs = []

    async def find_one(self, query):
        return next((dict(d) for d in self.docs if _match(d, query)), None)

    async def insert_one(self, doc):
        if any(d.get("code") == doc.get("code") for d in self.docs if "code" in doc):
            raise Exception("E11000 duplicate key")
        self.docs.append(dict(doc))

    async def update_one(self, query, update, upsert=False):
        for d in self.docs:
            if _match(d, query):
                d.update(update["$set"])
                return type("R", (), {"modified_count": 1})()
        if upsert:
            self.docs.append({**{k: v for k, v in query.items() if not isinstance(v, dict)}, **update["$set"]})
        return type("R", (), {"modified_count": 0})()

    async def update_many(self, query, update):
        n = 0
        for d in self.docs:
            if _match(d, query):
                d.update(update["$set"])
                n += 1
        return type("R", (), {"modified_count": n})()

    async def count_documents(self, query):
        return sum(1 for d in self.docs if _match(d, query))

    def find(self, query):
        return _Cursor([dict(d) for d in self.docs if _match(d, query)])


@pytest.fixture
def fake_db(monkeypatch):
    links, settings = FakeCollection(), FakeCollection()
    monkeypatch.setattr(user_links.db, "links_col", links, raising=False)
    monkeypatch.setattr(user_links.db, "settings_col", settings, raising=False)
    return links, settings


FILE = {"public_hash": "abc123", "file_name": "Movie.2024.mkv", "file_size": 1024}


async def test_default_is_24h_and_listed(fake_db):
    links = await user_links.personal_links(1, FILE, shortener=False)
    assert "/l/" in links["online_link"] and "/watch/l/" in links["stream_link"]
    assert links["expires_at"] is not None and links["ttl"] == "24h"
    doc, state = await user_links.resolve(links["code"])
    assert state == "ok"
    listed, total = await user_links.list_links(1, 0, 10)
    assert total == 1 and listed[0]["code"] == links["code"]


async def test_24h_link_expires(fake_db, monkeypatch):
    links = await user_links.personal_links(1, FILE, shortener=False)
    assert links["expires_at"] is not None
    later = user_links._now() + datetime.timedelta(hours=25)
    monkeypatch.setattr(user_links, "_now", lambda: later)
    _, state = await user_links.resolve(links["code"])
    assert state == "expired"


async def test_extend_brings_an_expired_link_back(fake_db, monkeypatch):
    await user_links.set_setting(1, "link_ttl", "24h")
    code = (await user_links.personal_links(1, FILE, shortener=False))["code"]
    later = user_links._now() + datetime.timedelta(days=3)
    monkeypatch.setattr(user_links, "_now", lambda: later)
    assert (await user_links.resolve(code))[1] == "expired"
    await user_links.extend(1, code, "7d")
    assert (await user_links.resolve(code))[1] == "ok"


async def test_only_the_owner_can_revoke(fake_db):
    code = (await user_links.personal_links(1, FILE, shortener=False))["code"]
    assert not await user_links.revoke(2, code), "another user must not delete it"
    assert (await user_links.resolve(code))[1] == "ok"
    assert await user_links.revoke(1, code)
    assert (await user_links.resolve(code))[1] == "revoked"
    _, total = await user_links.list_links(1, 0, 10)
    assert total == 0, "a deleted link leaves the list"


async def test_history_off_still_works_but_is_not_listed(fake_db):
    await user_links.set_setting(1, "history", False)
    code = (await user_links.personal_links(1, FILE, shortener=False))["code"]
    assert (await user_links.resolve(code))[1] == "ok"
    assert (await user_links.list_links(1, 0, 10))[1] == 0


async def test_bad_codes_are_rejected_without_a_query(fake_db):
    for bad in ("", "a" * 40, "../x", "a b", "$ne"):
        assert (await user_links.resolve(bad))[1] == "missing"


async def test_route_refuses_an_expired_link(fake_db, monkeypatch):
    await user_links.set_setting(1, "link_ttl", "24h")
    code = (await user_links.personal_links(1, FILE, shortener=False))["code"]
    later = user_links._now() + datetime.timedelta(days=2)
    monkeypatch.setattr(user_links, "_now", lambda: later)
    _, _, gone = await stream_routes._personal_file(code)
    assert gone is not None and gone.status == 410
    assert "expired" in gone.text


async def test_route_serves_a_live_link(fake_db, monkeypatch):
    code = (await user_links.personal_links(1, FILE, shortener=False))["code"]

    async def fake_get_file_by_hash(h, raise_on_error=False):
        return {**FILE, "canonical_message_id": 5} if h == "abc123" else None

    monkeypatch.setattr(stream_routes, "get_file_by_hash", fake_get_file_by_hash)
    link, record, gone = await stream_routes._personal_file(code)
    assert gone is None and record["public_hash"] == "abc123" and link["code"] == code
