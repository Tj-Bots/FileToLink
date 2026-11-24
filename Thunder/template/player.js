/* Thunder watch page.
 * Page chrome (language, copy, share, open-in) plus a custom control layer
 * over <movi-player>, which does the demuxing/decoding (MKV, HEVC, audio
 * tracks, embedded subtitles). movi's own UI is left off; this file drives it.
 */
(() => {
    'use strict';

    const CFG = window.__CINEMA_CONFIG__ || {};
    const I18N = window.__TJ_I18N__ || { rtl: [], langs: {} };
    const $ = (id) => document.getElementById(id);
    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    };

    // ------------------------------------------------------------ i18n
    const LANG_KEY = 'tj_lang';
    const pickLang = () => {
        let saved = null;
        try { saved = localStorage.getItem(LANG_KEY); } catch { /* ignore */ }
        if (saved && I18N.langs[saved]) return saved;
        for (const l of navigator.languages || [navigator.language || 'en']) {
            const code = String(l).toLowerCase().split('-')[0];
            if (code === 'iw' && I18N.langs.he) return 'he';
            if (I18N.langs[code]) return code;
        }
        return 'en';
    };
    let lang = pickLang();
    const langListeners = [];
    const t = (key, vars) => {
        let s = (I18N.langs[lang] || {})[key] ?? (I18N.langs.en || {})[key] ?? key;
        if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
        return s;
    };
    const applyLang = () => {
        document.documentElement.lang = lang;
        document.documentElement.dir = I18N.rtl.includes(lang) ? 'rtl' : 'ltr';
        document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
        document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
        langListeners.forEach((fn) => fn());
    };
    const langSelect = $('langSelect');
    if (langSelect) {
        Object.entries(I18N.langs).forEach(([code, dict]) => {
            const o = document.createElement('option');
            o.value = code; o.textContent = dict._name || code;
            langSelect.appendChild(o);
        });
        langSelect.value = lang;
        langSelect.addEventListener('change', () => {
            lang = langSelect.value;
            try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
            applyLang();
        });
    }
    applyLang();

    // ------------------------------------------------------------ helpers
    const fmt = (s) => {
        if (!Number.isFinite(s) || s < 0) s = 0;
        s = Math.floor(s);
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        const mm = h ? String(m).padStart(2, '0') : String(m);
        return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
    };
    let pageToastTimer;
    const pageToast = (msg) => {
        const el = $('pageToast');
        if (!el) return;
        el.textContent = msg; el.hidden = false;
        clearTimeout(pageToastTimer);
        pageToastTimer = setTimeout(() => { el.hidden = true; }, 2200);
    };
    const ua = navigator.userAgent;
    const OS = /android/i.test(ua) ? 'android'
        : (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) ? 'ios'
            : 'desktop';

    // ------------------------------------------------------------ page effects
    const topbar = $('topbar');
    const onScroll = () => topbar?.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    // Material-style press wave on every page button.
    document.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('.btn, .quick-btn');
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        const size = Math.max(r.width, r.height);
        const w = document.createElement('span');
        w.className = 'wave';
        w.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
        btn.appendChild(w);
        setTimeout(() => w.remove(), 650);
    });

    // ------------------------------------------------------------ page actions
    const copyBtn = $('copyBtn');
    copyBtn?.addEventListener('click', async () => {
        const link = copyBtn.dataset.link || location.href;
        try {
            await navigator.clipboard.writeText(link);
            pageToast(t('linkCopied'));
        } catch {
            const ta = document.createElement('textarea');
            ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            pageToast(ok ? t('linkCopied') : t('copyFailed'));
        }
    });
    const shareBtn = $('shareBtn');
    if (shareBtn && navigator.share) {
        shareBtn.hidden = false;
        shareBtn.addEventListener('click', () => {
            navigator.share({ title: CFG.fileName || document.title, url: location.href }).catch(() => {});
        });
    }
    const openInBtn = $('openInBtn');
    const openInPanel = $('openInPanel');
    if (openInPanel) {
        // Show this device's group first; keep the others for the rare cross-case.
        const mine = openInPanel.querySelector(`[data-os="${OS}"]`);
        if (mine) openInPanel.prepend(mine);
        if (OS !== 'desktop') openInPanel.querySelector('[data-os="desktop"]')?.remove();
        if (OS === 'android') openInPanel.querySelector('[data-os="ios"]')?.remove();
        if (OS === 'ios') openInPanel.querySelector('[data-os="android"]')?.remove();
    }
    const toggleOpenIn = (force) => {
        if (!openInPanel) return;
        const show = force ?? openInPanel.hidden;
        openInPanel.hidden = !show;
        openInBtn?.setAttribute('aria-expanded', String(show));
        if (show) openInPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    openInBtn?.addEventListener('click', () => toggleOpenIn());

    // ------------------------------------------------------------ player
    const stage = $('playerStage');
    const el = $('player');
    if (!stage || !el) return;

    const ui = {
        controls: $('controls'), gesture: $('gestureLayer'), play: $('playBtn'),
        back: $('backBtn'), fwd: $('fwdBtn'), cur: $('curTime'), dur: $('durTime'),
        timeline: $('timeline'), fill: $('tlFill'), buf: $('tlBuf'), knob: $('tlKnob'), tip: $('tlTip'),
        mute: $('muteBtn'), vol: $('volRange'), speedBtn: $('speedBtn'), speedLabel: $('speedLabel'),
        pip: $('pipBtn'), fs: $('fsBtn'), exitFs: $('exitFsBtn'), tracks: $('tracksBtn'), settings: $('settingsBtn'),
        subDot: $('subDot'), subs: $('subOverlay'), boost: $('boostBadge'), boostLabel: $('boostLabel'),
        rippleBack: $('rippleBack'), rippleFwd: $('rippleFwd'), toast: $('toast'), scrim: $('scrim'),
        pipCover: $('pipCover'), err: $('errorBox'),
    };

    let toastTimer;
    const toast = (msg) => {
        ui.toast.textContent = msg; ui.toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2000);
    };

    const ICONS = {
        play: '<svg viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z"/></svg>',
        pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
    };
    const osdEl = $('osd');
    const osd = (content, isText) => {
        osdEl.classList.remove('go');
        osdEl.classList.toggle('text', !!isText);
        if (isText) osdEl.textContent = content; else osdEl.innerHTML = content;
        void osdEl.offsetWidth;
        osdEl.classList.add('go');
    };

    // --- state
    let duration = 0;
    let loading = true;
    let scrubbing = false;
    const setState = () => {
        stage.dataset.state = loading ? 'loading' : 'ready';
        stage.classList.toggle('is-playing', !el.paused);
        ui.play.setAttribute('aria-label', el.paused ? 'Play' : 'Pause');
    };
    const setLoading = (on) => { loading = on; setState(); };

    const play = () => { const p = el.play?.(); if (p?.catch) p.catch(() => {}); };
    const togglePlay = () => {
        if (el.paused) { play(); osd(ICONS.play); } else { el.pause(); osd(ICONS.pause); }
    };
    const seekTo = (s) => {
        if (!duration) return;
        el.currentTime = Math.max(0, Math.min(duration - 0.25, s));
        renderTime(el.currentTime);
    };
    const seekBy = (d) => seekTo((el.currentTime || 0) + d);

    // --- time + timeline
    const renderTime = (now) => {
        const pct = duration ? Math.min(100, (now / duration) * 100) : 0;
        ui.fill.style.width = `${pct}%`;
        ui.knob.style.left = `${pct}%`;
        ui.cur.textContent = fmt(now);
    };
    const renderBuffered = () => {
        try {
            const b = el.buffered;
            if (!b || !b.length || !duration) return;
            const now = el.currentTime;
            let end = b.end(b.length - 1);
            for (let i = 0; i < b.length; i++) if (b.start(i) <= now && now <= b.end(i)) end = b.end(i);
            ui.buf.style.width = `${Math.min(100, (end / duration) * 100)}%`;
        } catch { /* not ready */ }
    };
    const setDuration = (d) => {
        if (!Number.isFinite(d) || d <= 0) return;
        duration = d;
        ui.dur.textContent = fmt(d);
        const chip = $('metaDuration');
        if (chip) { chip.querySelector('span').textContent = fmt(d); chip.hidden = false; }
    };
    const setResolution = () => {
        const w = el.videoWidth, h = el.videoHeight;
        const chip = $('metaResolution');
        if (!chip || !w || !h) return;
        const p = Math.min(w, h);
        const tag = p >= 2100 ? '4K' : p >= 1400 ? '1440p' : p >= 1000 ? '1080p' : p >= 700 ? '720p' : `${p}p`;
        chip.querySelector('span').textContent = `${tag} · ${w}×${h}`;
        chip.hidden = false;
    };

    const tlPos = (clientX) => {
        const r = ui.timeline.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        return { f, x: f * r.width };
    };
    const showTip = (clientX) => {
        const { f, x } = tlPos(clientX);
        ui.tip.textContent = fmt(f * duration);
        const r = ui.timeline.getBoundingClientRect();
        const half = ui.tip.offsetWidth / 2;
        ui.tip.style.left = `${Math.max(half, Math.min(r.width - half, x))}px`;
        return f;
    };
    ui.timeline.addEventListener('pointermove', (e) => { if (duration) showTip(e.clientX); });
    ui.timeline.addEventListener('pointerdown', (e) => {
        if (!duration) return;
        scrubbing = true;
        ui.timeline.classList.add('dragging');
        ui.timeline.setPointerCapture(e.pointerId);
        renderTime(showTip(e.clientX) * duration);
        keepControls();
    });
    ui.timeline.addEventListener('pointermove', (e) => {
        if (!scrubbing) return;
        renderTime(showTip(e.clientX) * duration);
    });
    const endScrub = (e) => {
        if (!scrubbing) return;
        scrubbing = false;
        ui.timeline.classList.remove('dragging');
        seekTo(tlPos(e.clientX).f * duration);
        scheduleHide();
    };
    ui.timeline.addEventListener('pointerup', endScrub);
    ui.timeline.addEventListener('pointercancel', endScrub);

    // --- controls visibility
    let hideTimer;
    const sheetOpen = () => !!stage.querySelector('.sheet:not([hidden])');
    const showControls = () => { stage.classList.add('controls-on'); scheduleHide(); };
    const hideControls = () => {
        if (el.paused || scrubbing || sheetOpen()) return;
        stage.classList.remove('controls-on');
    };
    const scheduleHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hideControls, 3200); };
    const keepControls = () => { stage.classList.add('controls-on'); clearTimeout(hideTimer); };
    stage.classList.add('controls-on');
    ui.controls.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showControls(); });
    ui.controls.addEventListener('click', () => scheduleHide());

    // --- buttons
    ui.play.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); scheduleHide(); });
    ui.back.addEventListener('click', () => { seekBy(-10); flash(ui.rippleBack); });
    ui.fwd.addEventListener('click', () => { seekBy(10); flash(ui.rippleFwd); });

    ui.mute?.addEventListener('click', () => { el.muted = !el.muted; });
    ui.vol?.addEventListener('input', () => {
        el.volume = Number(ui.vol.value);
        if (el.muted && el.volume > 0) el.muted = false;
    });
    const renderVolume = () => {
        stage.classList.toggle('is-muted', !!el.muted || el.volume === 0);
        if (ui.vol) ui.vol.value = el.muted ? 0 : el.volume;
    };

    // --- fullscreen
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const isFs = () => stage.classList.contains('is-fs');
    const setFsClass = (on) => {
        if (on !== stage.classList.contains('is-fs')) closeSheets();
        stage.classList.toggle('is-fs', on);
        document.body.classList.toggle('tj-fs', on);
    };
    const enterFs = async () => {
        const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
        if (req) {
            try {
                await req.call(stage, { navigationUI: 'hide' });
                if (CFG.isVideo) screen.orientation?.lock?.('landscape').catch(() => {});
                return;
            } catch { /* fall through to the in-page version */ }
        }
        setFsClass(true);
        history.pushState({ tjFs: 1 }, '');
    };
    const exitFs = () => {
        if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else if (isFs()) { setFsClass(false); if (history.state?.tjFs) history.back(); }
    };
    const toggleFs = () => (isFs() ? exitFs() : enterFs());
    const onFsChange = () => {
        const on = fsEl() === stage;
        setFsClass(on);
        if (!on) screen.orientation?.unlock?.();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    window.addEventListener('popstate', () => { if (isFs() && !fsEl()) setFsClass(false); });
    ui.fs.addEventListener('click', toggleFs);
    ui.exitFs.addEventListener('click', exitFs);

    // --- picture in picture (movi uses Document PiP)
    if (!('documentPictureInPicture' in window) || CFG.isAudio) ui.pip.hidden = true;
    ui.pip.addEventListener('click', () => {
        el.requestPictureInPicture?.().catch(() => toast(t('pipUnsupported')));
    });
    $('pipReturnBtn')?.addEventListener('click', () => {
        try { window.documentPictureInPicture?.window?.close(); } catch { /* ignore */ }
    });

    // --- gestures (tap / double-tap / long-press)
    // Repeated taps on the same side stack up (-10, -20, -30 …) like YouTube.
    const flash = (node) => {
        const sign = node === ui.rippleBack ? -1 : 1;
        node._n = node.classList.contains('show') ? (node._n || 0) + 10 : 10;
        node.querySelector('span').textContent = `${sign < 0 ? '-' : '+'}${node._n}`;
        node.classList.add('show');
        clearTimeout(node._t);
        node._t = setTimeout(() => { node.classList.remove('show'); node._n = 0; }, 650);
    };
    let tapTimer = null;
    let lastTap = { time: 0, zone: '' };
    let pressTimer = null;
    let boosting = false;
    let boostPrevRate = 1;
    let downAt = null;
    const zoneOf = (x) => {
        const r = stage.getBoundingClientRect();
        const f = (x - r.left) / r.width;
        const rtlFlip = false; // seek zones follow the picture, not the text direction
        if (f < 0.35) return rtlFlip ? 'fwd' : 'back';
        if (f > 0.65) return rtlFlip ? 'back' : 'fwd';
        return 'mid';
    };
    const startBoost = (rate) => {
        boosting = true;
        boostPrevRate = el.playbackRate || 1;
        el.playbackRate = rate;
        ui.boostLabel.textContent = `${rate}x`;
        ui.boost.hidden = false;
        if (el.paused) play();
    };
    const stopBoost = () => {
        if (!boosting) return;
        boosting = false;
        el.playbackRate = boostPrevRate;
        ui.boost.hidden = true;
    };

    ui.gesture.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        downAt = { x: e.clientX, y: e.clientY, type: e.pointerType };
        if (e.pointerType !== 'mouse') {
            clearTimeout(pressTimer);
            const half = (e.clientX - stage.getBoundingClientRect().left) / stage.clientWidth;
            pressTimer = setTimeout(() => { pressTimer = null; startBoost(half < 0.5 ? 1.5 : 2); }, 450);
        }
    });
    ui.gesture.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse') { showControls(); return; }
        if (downAt && pressTimer && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 12) {
            clearTimeout(pressTimer); pressTimer = null;
        }
    });
    ui.gesture.addEventListener('pointercancel', () => { clearTimeout(pressTimer); pressTimer = null; stopBoost(); downAt = null; });
    ui.gesture.addEventListener('pointerup', (e) => {
        if (!downAt) return;
        const wasPress = boosting;
        clearTimeout(pressTimer); pressTimer = null;
        stopBoost();
        downAt = null;
        if (wasPress) return;

        if (e.pointerType === 'mouse') {
            // Desktop: click = play/pause, double-click = fullscreen.
            const now = Date.now();
            if (now - lastTap.time < 300) { clearTimeout(tapTimer); lastTap.time = 0; toggleFs(); return; }
            lastTap.time = now;
            clearTimeout(tapTimer);
            tapTimer = setTimeout(() => { togglePlay(); showControls(); }, 220);
            return;
        }

        // Touch: tap = show/hide controls, double-tap a side = ±10s (keeps stacking).
        const zone = zoneOf(e.clientX);
        const now = Date.now();
        const isDouble = now - lastTap.time < 320 && zone === lastTap.zone && zone !== 'mid';
        const chaining = now - lastTap.time < 700 && lastTap.chain && zone === lastTap.zone;
        if ((isDouble || chaining) && zone !== 'mid') {
            clearTimeout(tapTimer);
            seekBy(zone === 'back' ? -10 : 10);
            flash(zone === 'back' ? ui.rippleBack : ui.rippleFwd);
            lastTap = { time: now, zone, chain: true };
            return;
        }
        lastTap = { time: now, zone, chain: false };
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => {
            if (stage.classList.contains('controls-on')) { stage.classList.remove('controls-on'); clearTimeout(hideTimer); }
            else showControls();
        }, zone === 'mid' ? 0 : 260);
    });
    ui.gesture.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- keyboard
    document.addEventListener('keydown', (e) => {
        if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase();
        const handled = {
            ' ': togglePlay, k: togglePlay, f: toggleFs, m: () => { el.muted = !el.muted; },
            arrowleft: () => seekBy(-5), arrowright: () => seekBy(5), j: () => seekBy(-10), l: () => seekBy(10),
            arrowup: () => { el.volume = Math.min(1, (el.volume || 0) + 0.1); osd(`${Math.round(el.volume * 100)}%`, true); },
            arrowdown: () => { el.volume = Math.max(0, (el.volume || 0) - 0.1); osd(`${Math.round(el.volume * 100)}%`, true); },
            escape: () => { if (sheetOpen()) closeSheets(); else if (isFs() && !fsEl()) exitFs(); },
        }[k];
        if (!handled) return;
        e.preventDefault();
        handled();
        showControls();
    });

    // ------------------------------------------------------------ sheets
    const sheets = [...stage.querySelectorAll('.sheet')];
    // In fullscreen the sheets must live inside the stage (nothing else is
    // shown); otherwise they open over the whole page, like the app does.
    const placeSheets = () => {
        const floating = !isFs();
        const host = floating ? document.body : stage;
        [ui.scrim, ...sheets].forEach((n) => {
            n.classList.toggle('floating', floating);
            if (n.parentNode !== host) host.appendChild(n);
        });
    };
    const resetSheet = (s) => { s.style.transform = ''; s.style.opacity = ''; s.classList.remove('dragging'); };
    const closeSheets = () => {
        sheets.forEach((s) => { s.hidden = true; resetSheet(s); });
        ui.scrim.hidden = true;
        ui.scrim.style.opacity = '';
        scheduleHide();
    };
    const openSheet = (id) => {
        placeSheets();
        sheets.forEach((s) => { s.hidden = s.id !== id; resetSheet(s); });
        ui.scrim.hidden = false;
        keepControls();
    };
    ui.scrim.addEventListener('click', closeSheets);
    stage.querySelectorAll('.sheet-x').forEach((b) => b.addEventListener('click', closeSheets));
    // Drag the handle/header down to dismiss.
    sheets.forEach((sheet) => {
        const grips = sheet.querySelectorAll('.grab, .sheet-head');
        let startY = null;
        grips.forEach((g) => {
            g.addEventListener('pointerdown', (e) => {
                if (e.target.closest('button')) return;
                startY = e.clientY; g.setPointerCapture(e.pointerId); sheet.classList.add('dragging');
            });
            g.addEventListener('pointermove', (e) => {
                if (startY == null) return;
                const dy = Math.max(0, e.clientY - startY);
                // The sheet fades as it is pulled down, and the backdrop clears with it.
                const pull = Math.min(1, dy / Math.max(120, sheet.offsetHeight * 0.45));
                sheet.style.transform = `translateY(${dy}px)`;
                sheet.style.opacity = String(1 - pull * 0.85);
                ui.scrim.style.opacity = String(1 - pull * 0.7);
            });
            const end = (e) => {
                if (startY == null) return;
                const dy = e.clientY - startY;
                startY = null;
                sheet.classList.remove('dragging');
                if (dy > 70) {
                    sheet.style.transition = 'transform .2s ease-in, opacity .2s ease-in';
                    sheet.style.transform = 'translateY(100%)';
                    sheet.style.opacity = '0';
                    ui.scrim.style.opacity = '0';
                    setTimeout(() => { sheet.style.transition = ''; closeSheets(); }, 200);
                    return;
                }
                sheet.style.transform = '';
                sheet.style.opacity = '';
                ui.scrim.style.opacity = '';
            };
            g.addEventListener('pointerup', end);
            g.addEventListener('pointercancel', end);
        });
    });
    ui.tracks.addEventListener('click', () => { renderTracks(); openSheet('tracksSheet'); });
    ['qAudio', 'qSubs'].forEach((id) => $(id)?.addEventListener('click', () => {
        renderTracks(); openSheet('tracksSheet');
        stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    ui.settings.addEventListener('click', () => { renderSettings(); openSheet('settingsSheet'); });
    ui.speedBtn.addEventListener('click', () => { renderSettings(); openSheet('settingsSheet'); });
    $('subStyleBtn').addEventListener('click', () => { reflectSubPrefs(); openSheet('subStyleSheet'); });
    $('errorOpenIn')?.addEventListener('click', () => {
        toggleOpenIn(true);
    });

    const chip = (label, on, onClick) => {
        const b = document.createElement('button');
        b.className = `chip-btn${on ? ' on' : ''}`;
        b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
    };

    // --- speed + sleep timer
    const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    let sleepMinutes = 0;
    let sleepTimer = null;
    const sleepLabel = (m) => (m ? t('minutes', { n: m }) : t('timerOff'));
    const renderSettings = () => {
        const sp = $('speedOptions');
        sp.replaceChildren(...SPEEDS.map((r) => chip(r === 1 ? t('normalSpeed') : `${r}x`,
            Math.abs((boosting ? boostPrevRate : el.playbackRate) - r) < 0.01,
            () => { el.playbackRate = r; osd(`${r}x`, true); renderSettings(); })));
        const sl = $('sleepOptions');
        sl.replaceChildren(...[0, 15, 30, 45, 60, 90].map((m) => chip(sleepLabel(m), m === sleepMinutes, () => {
            sleepMinutes = m;
            clearTimeout(sleepTimer);
            if (m) {
                sleepTimer = setTimeout(() => { el.pause(); sleepMinutes = 0; toast(t('sleepPaused')); }, m * 60000);
                toast(t('sleepSet', { l: sleepLabel(m) }));
            } else toast(t('sleepOff'));
            renderSettings();
        })));
    };
    const renderSpeed = () => {
        if (boosting) return;
        const r = el.playbackRate || 1;
        ui.speedLabel.textContent = `${Number(r.toFixed(2))}x`;
    };

    // ------------------------------------------------------------ tracks
    const LANG_NAMES = (() => {
        try { return new Intl.DisplayNames([lang, 'en'], { type: 'language' }); } catch { return null; }
    })();
    const ISO3 = { eng: 'en', heb: 'he', ara: 'ar', per: 'fa', fas: 'fa', rus: 'ru', ukr: 'uk', spa: 'es', por: 'pt',
        fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', tur: 'tr', ind: 'id', hin: 'hi', chi: 'zh', zho: 'zh',
        jpn: 'ja', kor: 'ko', dut: 'nl', nld: 'nl', pol: 'pl', swe: 'sv', tha: 'th', vie: 'vi', gre: 'el', ell: 'el' };
    const langName = (code) => {
        if (!code || code === 'und') return '';
        const c = ISO3[code.toLowerCase()] || code;
        try {
            const dn = new Intl.DisplayNames([lang], { type: 'language' });
            return dn.of(c) || code;
        } catch { return LANG_NAMES?.of(c) || code; }
    };
    const CODEC_NAMES = { subrip: 'SRT', srt: 'SRT', ass: 'ASS', ssa: 'SSA', webvtt: 'VTT', mov_text: 'TX3G',
        hdmv_pgs_subtitle: 'PGS', dvd_subtitle: 'VobSub', dvb_subtitle: 'DVB', eac3: 'E-AC3', truehd: 'TrueHD' };
    const CHANNELS = { 1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1' };
    const trackLabel = (tr, i) => {
        const name = langName(tr.language);
        const enName = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(ISO3[(tr.language || '').toLowerCase()] || tr.language); } catch { return ''; } })();
        const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
        const title = tr.label && !same(tr.label, name) && !same(tr.label, enName) ? tr.label : '';
        const main = name || title || t('track', { n: i + 1 });
        const codec = CODEC_NAMES[(tr.codec || '').toLowerCase()] || (tr.codec || '').toUpperCase();
        const extra = [name && title ? title : '', tr.channels ? CHANNELS[tr.channels] || `${tr.channels}ch` : '', codec]
            .filter(Boolean).join(' · ');
        return { main, extra };
    };
    const CHECK = '<svg class="check" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    const option = (main, sub, on, onClick) => {
        const b = document.createElement('button');
        b.className = `opt${on ? ' on' : ''}`;
        const box = document.createElement('span');
        box.className = 'opt-main';
        const m = document.createElement('span'); m.className = 'opt-title'; m.textContent = main; box.appendChild(m);
        if (sub) { const s = document.createElement('span'); s.className = 'opt-sub'; s.textContent = sub; box.appendChild(s); }
        b.appendChild(box);
        b.insertAdjacentHTML('beforeend', CHECK);
        b.addEventListener('click', onClick);
        return b;
    };
    const engine = () => el.player || null;
    // What the viewer picked wins over what the engine reports: the engine
    // switches asynchronously, and reading it back mid-switch shows the old track.
    let subTrackId = null;
    let subPicked = false;
    let audioPicked = null;
    const activeAudioId = () => {
        if (audioPicked != null) return audioPicked;
        try { return engine()?.trackManager?.getActiveAudioTrack?.()?.id ?? null; } catch { return null; }
    };
    const renderTracks = () => {
        const p = engine();
        const audio = p?.getAudioTracks?.() || [];
        const subs = p?.getSubtitleTracks?.() || [];
        if (!subPicked) {
            try { subTrackId = p?.trackManager?.getActiveSubtitleTrack?.()?.id ?? subTrackId; } catch { /* ignore */ }
        }

        const subBox = $('subOptions');
        if (!subs.length) {
            const d = document.createElement('div'); d.className = 'opts-empty'; d.textContent = t('noSubs');
            subBox.replaceChildren(d);
        } else {
            subBox.replaceChildren(
                option(t('off'), '', subTrackId == null, () => selectSub(null)),
                ...subs.map((s, i) => {
                    const { main, extra } = trackLabel(s, i);
                    return option(main, extra, s.id === subTrackId, () => selectSub(s.id));
                }),
            );
        }
        const audioBox = $('audioOptions');
        if (audio.length < 2) {
            const d = document.createElement('div'); d.className = 'opts-empty'; d.textContent = t('oneAudio');
            audioBox.replaceChildren(d);
        } else {
            const act = activeAudioId();
            audioBox.replaceChildren(...audio.map((a, i) => {
                const { main, extra } = trackLabel(a, i);
                return option(main, extra, a.id === act || (act == null && i === 0), () => selectAudio(a.id));
            }));
        }
        ui.subDot.hidden = subTrackId == null;

        const qa = $('qAudioVal'), qs = $('qSubsVal');
        if (qa) {
            const act = activeAudioId();
            const i = Math.max(0, audio.findIndex((a) => a.id === act));
            qa.textContent = audio.length ? trackLabel(audio[i], i).main : '—';
        }
        if (qs) {
            const i = subs.findIndex((x) => x.id === subTrackId);
            qs.textContent = i >= 0 ? trackLabel(subs[i], i).main : (subs.length ? t('off') : '—');
        }
    };
    const selectAudio = (id) => {
        if (id === activeAudioId()) return;
        audioPicked = id;
        renderTracks();
        try { engine()?.selectAudioTrack(id); } catch { /* ignore */ }
    };
    const SUB_CHOICE_KEY = 'tj_sub_choice';
    let subRequest = 0;
    const selectSub = async (id, auto = false) => {
        if (!auto) subPicked = true;
        if (id === subTrackId) return;
        const mine = ++subRequest;
        subTrackId = id;
        const tr = (engine()?.getSubtitleTracks?.() || []).find((s) => s.id === id);
        if (!auto) store.set(SUB_CHOICE_KEY, tr ? (tr.language || 'any') : 'off');
        renderTracks();
        clearSubs();
        try { await engine()?.selectSubtitleTrack(id); } catch { /* ignore */ }
        // A later pick superseded this one while it was switching.
        if (mine !== subRequest) return;
        renderTracks();
        mirror();
    };
    // Re-apply the viewer's last subtitle language on a new file.
    const autoPickSub = () => {
        const want = store.get(SUB_CHOICE_KEY, null);
        if (subPicked || !want || want === 'off' || subTrackId != null) return;
        const subs = (engine()?.getSubtitleTracks?.() || []).filter((s) => s.subtitleType !== 'image');
        const match = subs.find((s) => s.language === want) || (want === 'any' ? subs[0] : null);
        if (match) selectSub(match.id, true);
    };

    // ------------------------------------------------------------ subtitles
    // movi renders cues into its own overlay; it is hidden (::part) and mirrored
    // here so the TjGramApp RTL rule and the viewer's style apply.
    const SUB_DEFAULTS = { size: 100, pos: 0, style: 'outline' };
    let subPrefs = { ...SUB_DEFAULTS, ...store.get('tj_sub_prefs', {}) };
    if (!['outline', 'shadow', 'box'].includes(subPrefs.style)) subPrefs.style = 'outline';
    let subSync = 0;
    const applySubPrefs = () => {
        ui.subs.style.setProperty('--sub-scale', subPrefs.size / 100);
        ui.subs.style.setProperty('--sub-lift', subPrefs.pos);
        ui.subs.dataset.style = subPrefs.style;
    };
    const reflectSubPrefs = () => {
        $('subSize').value = subPrefs.size; $('subSizeVal').textContent = `${subPrefs.size}%`;
        $('subPos').value = subPrefs.pos; $('subPosVal').textContent = String(subPrefs.pos);
        $('subSyncVal').textContent = `${subSync > 0 ? '+' : ''}${subSync.toFixed(1)}s`;
        $('subStyleSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.style === subPrefs.style));
    };
    const saveSubPrefs = () => { store.set('tj_sub_prefs', subPrefs); applySubPrefs(); reflectSubPrefs(); };
    $('subSize').addEventListener('input', (e) => { subPrefs.size = Number(e.target.value); saveSubPrefs(); previewSubs(); });
    $('subPos').addEventListener('input', (e) => { subPrefs.pos = Number(e.target.value); saveSubPrefs(); previewSubs(); });
    $('subStyleSeg').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-style]');
        if (b) { subPrefs.style = b.dataset.style; saveSubPrefs(); previewSubs(); }
    });
    stage.querySelectorAll('[data-sync]').forEach((b) => b.addEventListener('click', () => {
        const d = Number(b.dataset.sync);
        subSync = d === 0 ? 0 : Math.round((subSync + d) * 10) / 10;
        try { el.subtitleDelay = subSync; } catch { /* ignore */ }
        reflectSubPrefs();
    }));
    $('subStyleReset').addEventListener('click', () => {
        subPrefs = { ...SUB_DEFAULTS }; subSync = 0;
        try { el.subtitleDelay = 0; } catch { /* ignore */ }
        saveSubPrefs(); previewSubs();
    });
    applySubPrefs();

    // TjGramApp's TjSubtitleView rule: strip bidi controls and markup, and when
    // the cue is Hebrew/Arabic move each line's trailing punctuation to its front,
    // then lay the line out left-to-right.
    const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;
    const RTL_CHAR = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
    const TRAILING = new Set([',', '.', '!', '?', ':', ';', '…', '،', '؛', '؟', '-']);
    const moveTrailing = (line) => {
        if (line.length < 2 || TRAILING.has(line[0])) return line;
        let cut = line.length;
        while (cut > 0 && TRAILING.has(line[cut - 1])) cut -= 1;
        if (cut === line.length || cut === 0) return line;
        return line.slice(cut) + line.slice(0, cut);
    };
    const fixLines = (lines) => {
        const clean = lines.map((l) => l.replace(BIDI_CONTROLS, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        return RTL_CHAR.test(clean.join('\n')) ? clean.map(moveTrailing) : clean;
    };
    let shownKey = '';
    let previewTimer = null;
    const drawLines = (lines) => {
        const key = lines.join('\n');
        if (key === shownKey) return;
        shownKey = key;
        ui.subs.replaceChildren(...lines.map((l) => {
            const d = document.createElement('div');
            d.className = 'sub-line'; d.dir = 'ltr'; d.textContent = l;
            return d;
        }));
    };
    const clearSubs = () => drawLines([]);
    const previewSubs = () => {
        clearTimeout(previewTimer);
        drawLines(fixLines([t('subsPreview')]));
        previewTimer = setTimeout(() => { previewTimer = null; shownKey = '\u0000'; mirror(); }, 1800);
    };

    let moviOverlay = null;
    const mirror = () => {
        if (previewTimer) return;
        const ov = moviOverlay;
        if (!ov) return;
        const hasImage = !!ov.querySelector('img, canvas, .movi-subtitle-image');
        // Bitmap subtitles (PGS) can only be drawn by movi itself.
        el.classList.toggle('own-subs', !hasImage);
        if (hasImage) { clearSubs(); return; }
        const shown = ov.style.display !== 'none';
        const nodes = ov.querySelectorAll('.movi-subtitle-line');
        let lines = nodes.length ? [...nodes].map((n) => n.textContent || '') : (ov.textContent ? [ov.textContent] : []);
        lines = lines.flatMap((l) => l.split(/\n/));
        drawLines(shown ? fixLines(lines) : []);
    };
    const hookOverlay = () => {
        const ov = el.shadowRoot?.querySelector('.movi-subtitle-overlay');
        if (!ov || ov === moviOverlay) return !!ov;
        moviOverlay = ov;
        new MutationObserver(mirror).observe(ov, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
        mirror();
        return true;
    };

    // ------------------------------------------------------------ engine events
    el.classList.add('own-subs');
    if (CFG.isVideo) stage.classList.add('no-frame');
    // Ambient glow from the picture itself: desktop only, it costs a sample per frame.
    if (CFG.isVideo && window.matchMedia('(min-width: 900px) and (hover: hover)').matches
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.setAttribute('ambientwrapper', 'ambient');
        el.setAttribute('ambientmode', '');
        $('ambient')?.classList.add('live');
    }
    const onEvt = (name, fn) => el.addEventListener(name, fn);
    onEvt('play', setState);
    onEvt('pause', () => { setState(); showControls(); });
    onEvt('playing', () => { stage.classList.remove('no-frame'); setLoading(false); scheduleHide(); });
    onEvt('waiting', () => setLoading(true));
    onEvt('seeking', () => setLoading(true));
    onEvt('seeked', () => setLoading(false));
    onEvt('canplay', () => setLoading(false));
    onEvt('loadeddata', () => { stage.classList.remove('no-frame'); setLoading(false); setResolution(); hookOverlay(); });
    onEvt('loadedmetadata', () => { setDuration(el.duration); setResolution(); renderTracks(); autoPickSub(); hookOverlay(); });
    onEvt('durationchange', () => setDuration(el.duration));
    onEvt('resize', setResolution);
    onEvt('statechange', (e) => {
        const s = e.detail;
        if (s === 'buffering' || s === 'seeking' || s === 'loading') setLoading(true);
        else if (s === 'playing' || s === 'paused' || s === 'ready' || s === 'ended') setLoading(false);
        setState();
    });
    onEvt('timeupdate', () => {
        if (!duration) setDuration(el.duration);
        if (!scrubbing) renderTime(el.currentTime);
        renderBuffered();
    });
    onEvt('progress', renderBuffered);
    onEvt('ended', () => { setState(); showControls(); });
    onEvt('volumechange', renderVolume);
    onEvt('ratechange', renderSpeed);
    onEvt('trackschange', () => { renderTracks(); autoPickSub(); });
    onEvt('audiotrackchange', renderTracks);
    onEvt('subtitletrackchange', () => { renderTracks(); mirror(); });
    onEvt('pipchange', (e) => { ui.pipCover.hidden = !e.detail?.pip; });
    onEvt('error', () => {
        // movi falls back to native <video> on its own; only a final failure lands here.
        setTimeout(() => {
            if (!(el.duration > 0) && !el.currentTime) { stage.classList.remove('no-frame'); setLoading(false); ui.err.hidden = false; }
        }, 1500);
    });

    customElements.whenDefined('movi-player').then(() => {
        hookOverlay();
        renderVolume(); renderSpeed(); setState();
        // The overlay is created lazily on some paths; keep looking briefly.
        let tries = 0;
        const iv = setInterval(() => { if (hookOverlay() || ++tries > 40) clearInterval(iv); }, 250);
    });
    // The module script failed to load (offline CDN, very old browser).
    setTimeout(() => {
        if (!customElements.get('movi-player')) { setLoading(false); ui.err.hidden = false; }
    }, 15000);

    langListeners.push(() => { renderTracks(); renderSettings(); });
    setState();
})();
