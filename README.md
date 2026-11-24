<p align="center">
  <img src="Thunder/assets/logo.png" alt="TJ Logo" width="120">
</p>

<h1 align="center">⚡ Thunder · File to Link</h1>

<p align="center">
  <b>Turn any Telegram file into a fast watch link and a direct download link.</b><br>
  In-browser player with audio tracks and subtitles · links that expire or can be revoked · 17 languages on the watch page
</p>

<p align="center">
  <a href="https://t.me/TJ_Bots"><img src="https://img.shields.io/badge/Telegram-Channel-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Channel"></a>
  <a href="https://t.me/TJ_Bots_Chat"><img src="https://img.shields.io/badge/Telegram-Group-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Group"></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/python-3.13+-blue?style=for-the-badge&logo=python&logoColor=white" alt="Python"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-green?style=for-the-badge" alt="License"></a>
</p>

<hr>

## 📑 Table of Contents

- [What it does](#what-it-does)
- [Features](#features)
- [The watch page](#the-watch-page)
- [Your links and settings](#your-links-and-settings)
- [Configuration](#configuration)
- [Commands](#commands)
- [Updating](#updating)
- [Advanced setup](#advanced-feature-setup)
- [Deployment](#deployment-guide)
- [Support & FAQ](#support--community)
- [Credits](#credits)

<hr>

## What it does

Send the bot any file (or reply to one with `/link` in a group) and it answers in seconds with:

> 🖥 **Watch** — a page that plays the file in the browser
> 📥 **Download** — a direct, resumable download link

The file is kept in your private storage channel (`BIN_CHANNEL`), so nothing has to be saved to the phone first.

```
You send a file → bot stores it in BIN_CHANNEL → you get a watch link + a download link
```

## Features

#### 🎬 Watch in the browser
- Plays **MKV, MP4, HEVC, AV1 and more** (the container is read in the browser, so most files play without converting).
- **Audio track picker** and **embedded subtitles**, with right-to-left subtitle fixing for Hebrew and Arabic.
- Fullscreen, picture-in-picture, playback speed, sleep timer, double-tap to skip ±10 s, long-press to speed up.
- The watch page speaks **17 languages** and follows the visitor's browser language.

#### 🔗 Links you control
- Each user gets **personal links**: choose **24 hours, 7 days, 30 days or forever**.
- `/mylinks` lists your links with time left; **extend** or **revoke** any of them.
- An expired or revoked link shows a clear "expired" page.

#### 🚀 Performance
- Downloads are read straight from Telegram's media connection, several pieces at once, so multi-connection downloaders (aria2, IDM) get full speed.
- **Multi-client support**: add `MULTI_TOKEN`s to spread the load.
- Async from top to bottom (`aiohttp`, `asyncio`, MongoDB).

#### 🛡️ Control
- Token system, permanent authorization, bans, forced channel join, rate limiting.
- Works in private chats, groups and channels. Batch mode: `/link 5`.
- Owner tools: `/status`, `/stats`, `/broadcast`, `/log`, `/shell`, `/restart`, `/speedtest`.

## The watch page

| | |
| :--- | :--- |
| 🎧 **Audio & subtitles** | Pick the audio track and subtitles from a sheet; subtitle size, position, sync and style are adjustable. |
| 📱 **Phone first** | Compact player on the page, fullscreen with gestures, works in Telegram's built-in browser. |
| 🌍 **Languages** | English, עברית, العربية, فارسی, Русский, Українська, Español, Português, Français, Deutsch, Italiano, Türkçe, Bahasa Indonesia, हिन्दी, 中文, 日本語, 한국어. |
| 📂 **Open in…** | One tap to open the link in VLC, MX Player, Infuse, nPlayer, mpv and others. |

## Your links and settings

In private chat the bot has two panels, both reachable from `/start`:

- **⚙️ `/settings`** — *Link lifetime* (default **24 hours**) and *Save to My links* (default on).
- **🗂 `/mylinks`** — every link you made, with the time left. Open one to watch, download, **extend** (24 h / 7 d / 30 d / forever) or **revoke** it. Revoking stops it working immediately, for everyone who has it.

Links made before this feature, and links in groups and channels, keep working as before.

## Configuration

Copy `config_sample.env` to `config.env` and fill in your values.

### Essential Configuration

| Variable | Description | Example |
| :--- | :--- | :--- |
| `API_ID` | Telegram API ID | `12345678` |
| `API_HASH` | Telegram API Hash | `abc123def456` |
| `BOT_TOKEN` | Bot token from @BotFather | `123456:ABCdefGHI` |
| `BIN_CHANNEL` | Storage channel ID | `-1001234567890` |
| `OWNER_ID` | Owner user ID | `12345678` |
| `DATABASE_URL` | MongoDB connection | `mongodb+srv://...` |
| `FQDN` | Domain/IP address | `f2l.thunder.com` |
| `HAS_SSL` | HTTPS enabled | `True` or `False` |
| `PORT` | Server port | `8080` |
| `NO_PORT` | Hide port in URLs | `True` or `False` |

### Optional Configuration

<details>
<summary>Optional Configuration Details</summary>

| Variable | Description | Default |
| :--- | :--- | :--- |
| `MULTI_TOKEN1` | Additional bot token 1 (use MULTI_TOKEN1, MULTI_TOKEN2, etc.) | *(empty)* |
| `FORCE_CHANNEL_ID` | Required channel join | *(empty)* |
| `MAX_BATCH_FILES` | Maximum files in batch processing | `50` |
| `CHANNEL` | Allow processing messages from channels | `False` |
| `BANNED_CHANNELS` | Blocked channel IDs | *(empty)* |
| `SLEEP_THRESHOLD` | Flood-wait threshold in seconds | `600` |
| `WORKERS` | Async workers | `8` |
| `NAME` | Bot name; also the MongoDB database name (unsafe chars become `_`) | `ThunderF2L` |
| `BIND_ADDRESS` | Bind address | `0.0.0.0` |
| `PING_INTERVAL` | Ping interval (seconds) | `840` |
| `TOKEN_ENABLED` | Enable tokens | `False` |
| `SHORTEN_ENABLED` | URL shortening for tokens | `False` |
| `SHORTEN_MEDIA_LINKS` | URL shortening for media | `False` |
| `TOKEN_TTL_HOURS` | Token validity duration in hours | `24` |
| `URL_SHORTENER_API_KEY` | Shortener API key | *(empty)* |
| `URL_SHORTENER_SITE` | Shortener service | *(empty)* |
| `SET_COMMANDS` | Auto-set bot commands | `True` |
| `RATE_LIMIT_ENABLED` | Enable rate limiting | `False` |
| `MAX_FILES_PER_PERIOD` | Files per window | `2` |
| `RATE_LIMIT_PERIOD_MINUTES` | Time window | `1` |
| `MAX_QUEUE_SIZE` | Queue size | `100` |
| `GLOBAL_RATE_LIMIT` | Global limiting | `True` |
| `MAX_GLOBAL_REQUESTS_PER_MINUTE` | Global limit | `4` |

</details>

## Commands

#### User commands

| Command | Description |
| :--- | :--- |
| `/start` | Welcome screen with quick buttons. Also used for token activation. |
| `/settings` | Link lifetime and whether links are saved to *My links*. |
| `/mylinks` | See, extend or revoke your links. |
| `/link` | (Groups) Reply to a file. For several files, reply to the **first** one: `/link 5`. |
| `/dc` | Data center of a user or file. |
| `/ping` | Check that the bot is online. |
| `/about` · `/help` | About the bot and how to use it. |

#### Owner commands

| Command | Description |
| :--- | :--- |
| `/status` · `/stats` | Bot status, uptime, workload and usage. |
| `/broadcast` | Send a message to all users. |
| `/ban` · `/unban` | Ban or unban a user or channel. |
| `/authorize` · `/deauthorize` · `/listauth` | Permanent access (bypasses the token system). |
| `/users` | Number of users. |
| `/log` | Send the bot log. |
| `/restart` | Update from this repository and restart. |
| `/shell` | Run a shell command. |
| `/speedtest` | Network speed test. |

## Updating

`/restart` (or `bash thunder.sh`) **updates the bot from this repository first**, then starts it.

- By default it follows `Tj-Bots/FileToLink`, branch `new`. Set `UPSTREAM_REPO` / `UPSTREAM_BRANCH` to follow another repository, or set `UPSTREAM_REPO=` (empty) to turn updating off.
- With **git** available it fast-forwards the checkout. Without git (for example a Heroku slug) it downloads the branch as an archive and replaces only the code files; `config.env`, sessions, logs and the runtime are left alone.
- Before changing anything it takes a snapshot, and if the new code can't start it **rolls back automatically**.
- Heroku resets a dyno to its last deploy once a day, so keep the app connected to this repository's `new` branch if you want updates to stick.

<details>
<summary><h4>BotFather Commands Setup</h4></summary>

```text
start - Welcome and quick buttons
settings - Link lifetime and history
mylinks - See, extend or revoke your links
link - Generate direct link
dc - Get data center info
ping - Check bot status
about - Bot information
help - Show help guide
status - [Admin] System status
stats - [Admin] Usage statistics
broadcast - [Admin] Message all users
ban - [Admin] Ban user
unban - [Admin] Unban user
users - [Admin] User count
authorize - [Admin] Grant access
deauthorize - [Admin] Revoke access
listauth - [Admin] List authorized
log - [Admin] Send bot logs
restart - [Admin] Restart the bot
shell - [Admin] Execute shell command
speedtest - [Admin] Run network speed test
```

</details>

## Advanced Feature Setup

### Token System

Enable controlled access with tokens:

1. Set `TOKEN_ENABLED=True` in your `config.env`.
2. Users receive automatic tokens on first use.
3. Admins can grant permanent authorization with `/authorize` to bypass tokens.
4. Tokens include activation links for secure access.

### URL Shortening

Configure URL shortening for cleaner links:

```env
SHORTEN_ENABLED=True
SHORTEN_MEDIA_LINKS=True
URL_SHORTENER_API_KEY=your_api_key
URL_SHORTENER_SITE=shortener.example.com
```

### Rate Limiting System

Thunder implements a sophisticated multi-tier rate limiting system designed for high-performance file sharing:

#### **Priority Queue Architecture**

- **Owner Priority**: Complete bypass of all rate limits.
- **Authorized Users**: Dedicated priority queue with faster processing.
- **Regular Users**: Standard queue with fair scheduling.

#### **Multi-Level Rate Limiting**

- **Per-User Limits**: Configurable files per time window.
- **Global Limits**: System-wide request throttling.
- **Sliding Window**: Time-based rate limiting with automatic cleanup.

#### **Smart Queue Management**

- **Automatic Re-queuing**: Failed requests due to rate limits are intelligently re-queued.
- **Queue Size Limits**: Configurable maximum queue size.
- **Flood Protection**: Built-in protection against Telegram flood waits.

### Network Speed Testing

Monitor server performance with built-in speed testing:

```bash
/speedtest
```

Features include download/upload speeds, latency measurements, and shareable result images for performance monitoring.

## Deployment Guide

This section covers the complete setup process for deploying Thunder, from prerequisites to production deployment.

### Prerequisites

| Requirement | Description | Source |
| :--- | :--- | :--- |
| Python 3.15 | Programming language | [python.org](https://python.org) |
| MongoDB | Database | [mongodb.com](https://mongodb.com) |
| Telegram API | API credentials | [my.telegram.org](https://my.telegram.org/apps) |
| Bot Token | From @BotFather | [@BotFather](https://t.me/BotFather) |
| Public Server | VPS/Dedicated server | Any provider |
| Storage Channel | For file storage | Create in Telegram |

### Installation

#### Docker Installation (Recommended)

```bash
# 1. Clone repository
git clone https://github.com/Tj-Bots/FileToLink.git
cd FileToLink
git checkout new

# 2. Configure
cp config_sample.env config.env
nano config.env  # Edit your settings

# 3. Build and run (the config is mounted — it is not baked into the image)
docker build -t thunder .
docker run -d --name thunder -p 8080:8080 \
  -v "$PWD/config.env:/app/config.env:ro" thunder
```

(PowerShell: `-v "${PWD}\config.env:/app/config.env:ro"`.)

The container runs as uid `10001`, which is not you, so `config.env` must be
readable by others. A file created with a normal umask (`cp` gives `644`) already
is; if yours is `600`, widen it without changing ownership:

```bash
chmod 644 config.env
```

`--stop-timeout 30` is optional — it lets the server's 25s shutdown drain
finish, since `docker stop` defaults to 10s:

```bash
docker run -d --stop-timeout 30 --name thunder -p 8080:8080 \
  -v "$PWD/config.env:/app/config.env:ro" thunder
```

The image runs as unprivileged user `10001` without a build toolchain. Env files are
excluded from the build context (`.dockerignore`), so `config.env` is not baked in and
must be supplied at runtime.

<details>
<summary>Alternative: pass configuration as environment variables</summary>

Docker's `--env-file` passes values verbatim, so inline comments and quotes in
`config_sample.env` (`HAS_SSL="True" # ...`) corrupt variables. Generate a clean file
using `python-dotenv`:

```bash
python3 -c "from dotenv import dotenv_values as d; [print(f'{k}={v}') for k, v in d('config.env').items()]" > /tmp/thunder-docker.env
docker run -d --name thunder -p 8080:8080 --env-file /tmp/thunder-docker.env thunder
```

Requires `python-dotenv` locally (`pip install python-dotenv`); mounting `config.env`
avoids this step. Keep the generated file outside the repository so it cannot enter the
build context.

</details>

<details>
<summary>Manual Installation</summary>

```bash
# 1. Clone repository
git clone https://github.com/Tj-Bots/FileToLink.git
cd FileToLink

# 2. Setup virtual environment
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure
cp config_sample.env config.env
nano config.env

# 5. Run bot
python -m Thunder
```

> **Tip:** Start with the essential configuration to get Thunder running, then add optional features as needed.

</details>

## Quick Deploy

### Deploy to Koyeb

[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&repository=github.com/Tj-Bots/FileToLink&branch=new&builder=dockerfile&name=thunder&ports=8080;http;/&env[API_ID]=&env[API_HASH]=&env[BOT_TOKEN]=&env[BIN_CHANNEL]=&env[OWNER_ID]=&env[DATABASE_URL]=&env[FQDN]=)

After deployment, to add any additional environment variables, use the Koyeb dashboard under **Settings** → **Environment Variables**.

### Deploy to Render

1. Open [Render Dashboard](https://dashboard.render.com) → **New** → **Web Service**
2. Choose **Public Git Repository**: `https://github.com/Tj-Bots/FileToLink` (branch `new`, **Dockerfile** build)
3. Add your environment variables
4. Click **Deploy**

### Deploy to Railway

1. Open [Railway](https://railway.app) → **New Project** → **Deploy Service**
2. Choose **GitHub Repo**: `Tj-Bots/FileToLink` (branch `new`; Railway builds the `Dockerfile`)
3. Add your environment variables
4. Click **Deploy**

### Deploy to Heroku

1. Install the [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) and login.
2. Create an app in the EU region (required for GDPR compliance):
   ```bash
   heroku create your-app-name --region eu
   heroku stack:set container
   ```
3. Set your config vars:
   ```bash
   heroku config:set API_ID="your_id" API_HASH="your_hash" BOT_TOKEN="your_token" \
     BIN_CHANNEL="-100xxx" OWNER_ID="your_id" FQDN="your-app-name.herokuapp.com" \
     HAS_SSL="True" NO_PORT="True" PORT="8080"
   ```
4. Set `DATABASE_URL` via the Heroku Dashboard or API (ampersand in MongoDB URL causes shell issues).
5. Deploy via source upload (Heroku does not support direct git push with API key auth):
   ```bash
   # Create source tarball
   tar -czf source.tar.gz --exclude='.git' --exclude='__pycache__' .
   # Upload via Heroku Builds API — see devcenter.heroku.com/articles/build-and-release-using-the-api
   ```
6. Scale the dyno:
   ```bash
   heroku ps:scale web=1
   ```
7. `/restart` updates the code from this repository (branch `new`) even though a Heroku slug has no `.git` — see [Updating](#updating). Heroku resets the dyno daily, so for updates that stick, connect the app to the repository's `new` branch in the Heroku dashboard (**Deploy** → **GitHub**).

> **Note:** Heroku provides HTTPS automatically. Set `FQDN` to `your-app-name.herokuapp.com` and `HAS_SSL` to `True`.

> **Note:** `heroku.yml` builds this repo's `Dockerfile`, so the dyno runs as uid `10001`
> and cannot read a root-only `config.env`. Config vars avoid the file entirely, which is
> why this path uses them; the container's own `Thunder/logs` is already writable from the
> image, so no `chmod` step is needed here.

> **Note:** See the [Configuration](#configuration) section for required environment variables.

## Reverse Proxy Setup

<details>
<summary>Reverse Proxy Guide</summary>

This guide will help you set up a secure reverse proxy using **NGINX** for your file streaming bot with **Cloudflare SSL protection**.

---

#### ✅ What You Need

- A **VPS or server** running Ubuntu/Debian with NGINX installed.
- Your **file streaming bot** running on a local port (e.g., `8080`).
- A **subdomain** (e.g., `f2l.thunder.com`) set up in **Cloudflare**.
- **Cloudflare Origin Certificate** files: `cert.pem` and `key.key`.

---

#### 🔐 Step 1: Configure Cloudflare

- **DNS**: Add an `A` record for your subdomain pointing to your server's IP. Ensure **Proxy Status** is **Proxied (orange cloud)**.
- **SSL**: In the **SSL/TLS** tab, set the encryption mode to **Full (strict)**.

---

#### 🛡️ Step 2: Set Up SSL Certificates on Server

Create a folder for your certificates and place `cert.pem` and `key.key` inside. Secure the private key.

```bash
sudo mkdir -p /etc/ssl/cloudflare/f2l.thunder.com
# Move/copy your cert.pem and key.key files into this directory
sudo chmod 600 /etc/ssl/cloudflare/f2l.thunder.com/key.key
sudo chmod 644 /etc/ssl/cloudflare/f2l.thunder.com/cert.pem
```

---

#### 🛠️ Step 3: Create NGINX Configuration

Create a new file at `/etc/nginx/sites-available/f2l.thunder.conf` and paste the following, replacing `f2l.thunder.com` and `8080` with your values.

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name f2l.thunder.com;

    # SSL Configuration
    ssl_certificate     /etc/ssl/cloudflare/f2l.thunder.com/cert.pem;
    ssl_certificate_key /etc/ssl/cloudflare/f2l.thunder.com/key.key;

    # Basic security
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;

    location / {
        # Forward requests to your bot
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Settings for file streaming
        proxy_buffering off;
        proxy_request_buffering off;
        client_max_body_size 0;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name f2l.thunder.com;
    return 301 https://$host$request_uri;
}
```

---

#### 🔄 Step 4: Test and Apply Changes

Enable the configuration, test it, and reload NGINX.

```bash
sudo ln -s /etc/nginx/sites-available/f2l.thunder.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Your reverse proxy is now securely streaming files behind Cloudflare!

</details>

## Support & Community

### Troubleshooting & FAQ

#### **Initial Setup**

**Q: Why isn't my bot responding after setup?**
A: This is usually a configuration issue. Please check the following:

1. **Verify `config.env`**: Make sure all essential variables (`API_ID`, `API_HASH`, `BOT_TOKEN`, `BIN_CHANNEL`, `DATABASE_URL`) are filled in correctly.
2. **Use `config.env` Only**: Do not edit `vars.py` or `config_sample.env`. The bot is designed to only read your settings from `config.env`.
3. **Check Logs**: Review the console logs on your server or hosting platform (Koyeb, Render, Heroku) for any startup errors.

**Q: What do I use for the `FQDN` variable?**
A: It's the public URL or IP address of your bot.

- **With a Domain**: Use your subdomain (e.g., `f2l.thunder.com`).
- **On Koyeb/Render/Heroku**: Use the public URL provided by the platform.
- **On a VPS**: Use your server's public IP address.

**Q: Why are my links not working on a VPS?**
A: For links to work on a VPS, the URL must include the port number (e.g., `http://YOUR_VPS_IP:8080`). Ensure that `NO_PORT` is set to `False` in `config.env` and that your server is configured to allow traffic through that port.

#### **Common Errors**

**Q: Why are my links showing a "Resource Not Found" error or not working?**
A: This error means the bot can't access the file. Check these three things:

1. **Invalid Token**: Your `BOT_TOKEN` or one of the `MULTI_TOKEN`s might be wrong. Double-check them with @BotFather.
2. **Missing Admin Rights**: The bot and **all** your client accounts must be **administrators** in the `BIN_CHANNEL`.
3. **File Deleted**: The link will break if the file was deleted from your `BIN_CHANNEL`.

**Q: Why isn't video or audio playing correctly in my browser?**
A: Your browser likely doesn't support the file's audio or video format (codec). This is a browser limitation, not a bot issue.

- **Solution**: For perfect playback, copy the link and play it in a dedicated media player. Recommended players include **VLC Media Player**, **MX Player**, **PotPlayer**, **IINA**, and **MPV**.

**Q: Why does the bot sometimes become unresponsive?**
A: This is likely a **Telegram Flood Wait**. To prevent spam, Telegram temporarily limits accounts that make too many requests. The bot is designed to handle this automatically by pausing and will resume on its own once the limit is lifted.

**Q: On shutdown I see `Task was destroyed but it is pending!` — is something broken?**
A: No, if `✓ Database connection closed` was printed first. The library leaves its media
sessions open on teardown; the bot still exits cleanly. Expect six after a download, none if
nothing was streamed.

#### **Performance**

**Q: How can I fix slow download and streaming speeds?**
A: If your speeds are slow, here’s how to fix it:

- **Add More Clients**: This is the best solution. Add `MULTI_TOKEN`s to your `config.env` to distribute the workload and increase throughput.
- **Use DC4 Accounts**: For top performance, use Telegram accounts from **Data Center 4 (DC4)**, as they often have the fastest connection. Use `/dc` to check an account's data center.
- **Upgrade Your Server**: A server with a slow network will bottleneck your speeds. Consider upgrading your VPS plan.

#### **Bot Usage**

**Q: How do I generate links for multiple files at once?**
A: The `/link` command can process multiple files sent in sequence. To use it, **reply to the first file** of the series with the command and the total count.

- **Example**: For a series of 5 files, reply to the very first file with `/link 5`.

**Q: Can I mix tokens from different accounts and data centers?**
A: Yes. Mixing clients from different accounts and data centers (like DC1, DC4, and DC5) is a great way to improve bot performance and reliability.

### Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository.
2. Create a new feature branch (`git checkout -b feature/amazing-feature`).
3. Make your change and run the suite and linter:
   ```bash
   PYYAML_FORCE_LIBYAML=0 pip install -r requirements-dev.txt   # POSIX
   python -m pytest -q
   python -m ruff check .
   ```
   The env var is needed on Python 3.15 (no `cp315` wheel). On Windows, where that
   assignment is not valid, set it first:
   ```powershell
   $env:PYYAML_FORCE_LIBYAML = "0"; pip install -r requirements-dev.txt
   ```
4. Commit your changes (`git commit -m 'Add some amazing feature'`).
5. Push to the branch (`git push origin feature/amazing-feature`).
6. Open a Pull Request.

CI runs the suite on Linux and Windows, then builds the image only once those
pass.

## License

Licensed under the [Apache License 2.0](LICENSE). See the `LICENSE` file for details.

## Credits

Thunder started as [fyaz05/FileToLink](https://github.com/fyaz05/FileToLink) and has since been reworked by [@TJ_Bots](https://t.me/TJ_Bots): a new watch page, personal links, and a new bot interface. The old look of the bot owes a lot to [FileStreamBot](https://github.com/avipatilpro/FileStreamBot).

Built on:

- [wzgram](https://github.com/rjriajul/wzgram) — Telegram MTProto framework
- [movi-player](https://github.com/mrujjwalg/movi-player) — in-browser demuxing and decoding for the watch page
- [aiohttp](https://github.com/aio-libs/aiohttp) · [PyMongo](https://github.com/mongodb/mongo-python-driver) · [WarpCrypto](https://github.com/rjriajul/warpcrypto)

## ⚠️ Disclaimer

This project is not affiliated with Telegram. Use it responsibly and in compliance with Telegram's Terms of Service and all applicable local regulations.

---

<p align="center">
  <b>⭐ Star this project if you find it useful!</b><br>
  <a href="https://github.com/Tj-Bots/FileToLink/issues/new">Report Bug</a> •
  <a href="https://github.com/Tj-Bots/FileToLink/issues/new">Request Feature</a>
</p>
