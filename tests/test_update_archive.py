"""update.py without git: the GitHub-archive path used on slug hosts (Heroku)."""
import io
import os
import tarfile

import pytest

import update


def _tarball(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, text in files.items():
            data = text.encode()
            info = tarfile.TarInfo(f"FileToLink-new/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


@pytest.fixture
def slug(tmp_path, monkeypatch):
    (tmp_path / "Thunder").mkdir()
    (tmp_path / "Thunder" / "a.py").write_text("old\n")
    (tmp_path / "update.py").write_text("old\n")
    (tmp_path / "config.env").write_text("KEEP=1\n")
    (tmp_path / ".heroku").mkdir()
    (tmp_path / ".heroku" / "MARK").write_text("runtime\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(update, "_install_requirements", lambda: True)
    return tmp_path


def _serve(monkeypatch, payload: bytes):
    monkeypatch.setattr(update.urllib.request, "urlopen", lambda *a, **k: io.BytesIO(payload))


def test_github_repo_without_git_uses_the_archive(monkeypatch, slug):
    monkeypatch.setenv("PATH", "/nonexistent")
    assert update._preflight("https://github.com/Tj-Bots/FileToLink", "new") == "archive"
    assert update._preflight("https://example.invalid/x.git", "main") is None


def test_archive_update_applies_code_and_keeps_runtime(monkeypatch, slug):
    monkeypatch.setattr(update, "_validate", lambda: True)
    _serve(monkeypatch, _tarball({"update.py": "new\n", "Thunder/a.py": "new\n", "Thunder/b.py": "added\n",
                                  "config.env": "UPSTREAM=1\n"}))

    assert update._archive_update("https://github.com/Tj-Bots/FileToLink", "new") is True
    assert (slug / "Thunder" / "a.py").read_text() == "new\n"
    assert (slug / "Thunder" / "b.py").exists()
    assert (slug / "config.env").read_text() == "KEEP=1\n", "config.env is never taken from the archive"
    assert (slug / ".heroku" / "MARK").exists(), "nothing outside the archive may be deleted"


def test_failed_archive_update_restores_the_tree(monkeypatch, slug):
    monkeypatch.setattr(update, "_validate", lambda: False)
    _serve(monkeypatch, _tarball({"update.py": "new\n", "Thunder/a.py": "broken\n", "Thunder/b.py": "added\n"}))

    assert update._archive_update("https://github.com/Tj-Bots/FileToLink", "new") is False
    assert (slug / "Thunder" / "a.py").read_text() == "old\n"
    assert (slug / "update.py").read_text() == "old\n"
    assert not (slug / "Thunder" / "b.py").exists()


def test_archive_paths_cannot_escape_the_tree(monkeypatch, slug):
    monkeypatch.setattr(update, "_validate", lambda: True)
    _serve(monkeypatch, _tarball({"update.py": "new\n", "Thunder/a.py": "new\n", "../../escape.txt": "x"}))

    assert update._archive_update("https://github.com/Tj-Bots/FileToLink", "new") is True
    assert not os.path.exists(slug.parent / "escape.txt")


@pytest.mark.parametrize("url", [
    "https://github.com/Tj-Bots/FileToLink",
    "https://github.com/Tj-Bots/FileToLink.git",
    "https://github.com/tj-bots/filetolink/",
    "git@github.com:Tj-Bots/FileToLink.git",
])
def test_every_spelling_of_this_repo_is_recognised(url):
    assert update._is_default_repo(url)


def test_other_repos_are_not_this_one():
    assert not update._is_default_repo("https://github.com/fyaz05/FileToLink")


def test_nothing_changed_skips_the_slow_steps(monkeypatch, slug):
    """Every restart runs the updater; an unchanged tree must not reinstall or re-probe."""
    (slug / "Thunder" / "a.py").write_text("same\n")
    (slug / "update.py").write_text("same\n")
    calls = []
    monkeypatch.setattr(update, "_install_requirements", lambda: calls.append("install") or True)
    monkeypatch.setattr(update, "_validate", lambda: calls.append("validate") or True)
    _serve(monkeypatch, _tarball({"update.py": "same\n", "Thunder/a.py": "same\n"}))

    assert update._archive_update("https://github.com/Tj-Bots/FileToLink", "new") is True
    assert calls == []
