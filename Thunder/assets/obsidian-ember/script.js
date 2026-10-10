(() => {
    'use strict';

    // ═══════════════════════════════════════════
    // CONFIG & DOM
    // ═══════════════════════════════════════════
    const CONFIG = window.__CINEMA_CONFIG__ || {};
    const VIDEO_SRC = CONFIG.src || '';
    const FILE_NAME = CONFIG.fileName || document.title;

    const stage = document.getElementById('playerStage');
    const player = document.getElementById('player');
    const tapLayer = document.getElementById('tapLayer');
    const bgMessage = document.getElementById('bgMessage');

    const backBtn = document.getElementById('backBtn');
    const shareBtn = document.getElementById('shareBtn');
    const pipBtn = document.getElementById('pipBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const iconFsEnter = fullscreenBtn?.querySelector('.icon-fs-enter');
    const iconFsExit = fullscreenBtn?.querySelector('.icon-fs-exit');

    const metaDuration = document.getElementById('metaDuration');
    const metaResolution = document.getElementById('metaResolution');
    const pageCopyBtn = document.getElementById('pageCopyBtn');
    const pageOpenInBtn = document.getElementById('pageOpenInBtn');

    const seekBackBtn = document.getElementById('seekBackBtn');
    const seekFwdBtn = document.getElementById('seekFwdBtn');
    const playBtn = document.getElementById('playBtn');
    const iconPlay = playBtn?.querySelector('.icon-play');
    const iconPause = playBtn?.querySelector('.icon-pause');
    const iconSpinner = playBtn?.querySelector('.icon-spinner');

    const brightnessWrap = document.getElementById('brightnessWrap');
    const brightnessSlider = document.getElementById('brightnessSlider');
    const volumeWrap = document.getElementById('volumeWrap');
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeIcon = document.getElementById('volumeIcon');

    const seekBar = document.getElementById('seekBar');
    const timeCurrent = document.getElementById('timeCurrent');
    const timeDuration = document.getElementById('timeDuration');

    const speedBtn = document.getElementById('speedBtn');
    const speedLabel = document.getElementById('speedLabel');
    const topSpeedBtn = document.getElementById('topSpeedBtn');
    const topSpeedLabel = document.getElementById('topSpeedLabel');
    const topTracksBtn = document.getElementById('topTracksBtn');
    const sleepBtn = document.getElementById('sleepBtn');
    const lockBtn = document.getElementById('lockBtn');
    const unlockBtn = document.getElementById('unlockBtn');
    const tracksBtn = document.getElementById('tracksBtn');
    const openInBtn = document.getElementById('openInBtn');

    const sheetBackdrop = document.getElementById('sheetBackdrop');
    const speedSheet = document.getElementById('speedSheet');
    const speedOptions = document.getElementById('speedOptions');
    const sleepSheet = document.getElementById('sleepSheet');
    const sleepOptions = document.getElementById('sleepOptions');
    const tracksSheet = document.getElementById('tracksSheet');
    const subtitleOptions = document.getElementById('subtitleOptions');
    const audioOptions = document.getElementById('audioOptions');
    const openInSheet = document.getElementById('openInSheet');
    const subStyleSheet = document.getElementById('subStyleSheet');

    const toastStack = document.getElementById('toastStack');
    const copyrightYear = document.getElementById('copyrightYear');

    // ═══════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════
    const formatTime = (secs) => {
        if (isNaN(secs) || secs < 0) secs = 0;
        secs = Math.round(secs);
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        return h > 0
            ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
            : `${m}:${s.toString().padStart(2, '0')}`;
    };

    const toast = (message) => {
        if (!toastStack) return;
        const el = document.createElement('div');
        el.className = 'toast';
        el.dir = 'auto';
        el.textContent = message;
        toastStack.appendChild(el);
        setTimeout(() => el.remove(), 2600);
    };

    // The `hidden` IDL property doesn't reliably reflect to the attribute on
    // SVG elements in every browser, so toggle the attribute directly -
    // that works for every element type.
    const setHidden = (el, hide) => {
        if (!el) return;
        el.toggleAttribute('hidden', hide);
    };

    // ═══════════════════════════════════════════
    // LANGUAGE — Hebrew UI when the browser is in Hebrew, English otherwise
    // ═══════════════════════════════════════════
    const IS_HE = /^(he|iw)\b/i.test(navigator.language || '');
    const STRINGS = {
        en: {
            sleep: 'Sleep', lock: 'Lock', subtitles: 'Subtitles', audio: 'Audio', openIn: 'Open In',
            notPlaying: 'If video not playing', useExternal: 'Use External Player', tapUnlock: 'Tap to unlock',
            noSubs: 'No embedded subtitles found.', oneAudio: 'Only one audio track.',
            fontSize: 'Font size', position: 'Position', subSync: 'Subtitle sync', style: 'Style',
            outline: 'Outline', shadow: 'Shadow', background: 'Background',
            download: 'Download', copyLink: 'Copy Link', desktop: 'Desktop', close: 'Close',
            speed: 'Playback Speed', sleepTimer: 'Sleep Timer', openExternal: 'Open In External Player',
            audioSubs: 'Audio & Subtitles', subSettings: 'Subtitle Settings',
            pipActive: 'Playing in a floating window', pipReturn: 'Bring it back here',
            off: 'Off', timerOff: 'Off', normalSpeed: 'Normal (1x)', minutes: (n) => `${n} minutes`,
            linkCopied: 'Link copied to clipboard', copyFailed: 'Could not copy link',
            pipUnsupported: 'Picture-in-picture is not supported here',
            sleepPaused: 'Sleep timer: playback paused', sleepSet: (l) => `Sleep timer set: ${l}`, sleepOff: 'Sleep timer off',
            subsLoading: 'Loading subtitles…', subsRetry: "Couldn't load subtitles, retrying…",
            subsPreview: 'This is how subtitles will look.',
            imageSubs: 'Image-based subtitles (PGS/VobSub) can only be shown by an external player.',
            audioNoSwitch: "The browser can't switch audio tracks - use Open In for an external player.",
            track: (n) => `Track ${n}`,
        },
        he: {
            sleep: 'טיימר שינה', lock: 'נעילה', subtitles: 'כתוביות', audio: 'שמע', openIn: 'פתח בנגן',
            notPlaying: 'הסרטון לא מתנגן?', useExternal: 'פתח בנגן חיצוני', tapUnlock: 'הקש לביטול הנעילה',
            noSubs: 'לא נמצאו כתוביות בקובץ.', oneAudio: 'יש רק ערוץ שמע אחד.',
            fontSize: 'גודל גופן', position: 'מיקום', subSync: 'סנכרון כתוביות', style: 'סגנון',
            outline: 'מסגרת', shadow: 'צל', background: 'רקע מלא',
            download: 'הורדה', copyLink: 'העתק קישור', desktop: 'מחשב', close: 'סגירה',
            speed: 'מהירות', sleepTimer: 'טיימר שינה', openExternal: 'פתיחה בנגן חיצוני',
            audioSubs: 'שמע וכתוביות', subSettings: 'הגדרות כתוביות',
            pipActive: 'הסרטון מוצג עכשיו בחלון ממוזער', pipReturn: 'החזר לכאן',
            off: 'כבויות', timerOff: 'כבוי', normalSpeed: 'רגיל (1x)', minutes: (n) => `${n} דקות`,
            linkCopied: 'הקישור הועתק', copyFailed: 'לא ניתן להעתיק את הקישור',
            pipUnsupported: 'חלון ממוזער לא נתמך כאן',
            sleepPaused: 'טיימר שינה: הסרטון נעצר', sleepSet: (l) => `טיימר שינה: ${l}`, sleepOff: 'טיימר השינה כבוי',
            subsLoading: 'טוען כתוביות…', subsRetry: 'טעינת הכתוביות נכשלה, מנסה שוב…',
            subsPreview: 'כך ייראו הכתוביות.',
            imageSubs: 'כתוביות מסוג תמונה (PGS/VobSub) מוצגות רק בנגן חיצוני.',
            audioNoSwitch: 'הדפדפן לא יכול להחליף ערוץ שמע - אפשר דרך "פתח ב..." בנגן חיצוני.',
            track: (n) => `ערוץ ${n}`,
        },
    };
    const t = (key, ...args) => {
        const v = (IS_HE ? STRINGS.he : STRINGS.en)[key] ?? STRINGS.en[key] ?? key;
        return typeof v === 'function' ? v(...args) : v;
    };
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.dataset.i18n);
        if (IS_HE) el.dir = 'auto';
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
    if (IS_HE) document.querySelectorAll('.sheet, .pip-placeholder').forEach((el) => { el.dir = 'rtl'; });

    if (copyrightYear) copyrightYear.textContent = new Date().getFullYear();

    // ═══════════════════════════════════════════
    // AUX URL HELPERS (tracks / subtitle extraction)
    // ═══════════════════════════════════════════
    const deriveAuxUrl = (prefix) => {
        if (!VIDEO_SRC) return null;
        try {
            const url = new URL(VIDEO_SRC, window.location.href);
            url.search = '';
            url.pathname = `/${prefix}${url.pathname}`;
            return url;
        } catch {
            return null;
        }
    };

    // ═══════════════════════════════════════════
    // SHEETS (speed / sleep / tracks / open-in)
    // ═══════════════════════════════════════════
    const allSheets = [speedSheet, sleepSheet, tracksSheet, openInSheet, subStyleSheet].filter(Boolean);

    const closeSheets = () => {
        allSheets.forEach((s) => setHidden(s, true));
        setHidden(sheetBackdrop, true);
    };

    const openSheet = (sheet) => {
        closeSheets();
        if (!sheet) return;
        setHidden(sheet, false);
        setHidden(sheetBackdrop, false);
    };

    sheetBackdrop?.addEventListener('click', closeSheets);
    document.querySelectorAll('.sheet-close').forEach((b) => b.addEventListener('click', closeSheets));

    // ═══════════════════════════════════════════
    // PLAYER WIRING — #player is a plain <video>
    // element; everything here is the standard
    // HTMLMediaElement / TextTrack API. (An earlier
    // version routed this through the vidstack engine
    // purely to obtain this same native element, but
    // vidstack's own state proxy and manually-appended
    // <track> children didn't survive its internal
    // re-renders reliably, so it's cut out entirely.)
    // ═══════════════════════════════════════════
    if (!player) return;

    let duration = 0;
    let userSeeking = false;
    const video = player;

    const setPlayButtonState = () => {
        const showSpinner = video.readyState < 3 && !video.paused && !video.ended;
        const showPause = !video.paused && !showSpinner && !video.ended;
        setHidden(iconPlay, showPause || showSpinner);
        setHidden(iconPause, !showPause);
        setHidden(iconSpinner, !showSpinner);
    };

    const togglePlay = () => {
        try {
            if (video.paused) {
                video.play()?.catch?.(() => {});
            } else {
                video.pause();
            }
        } catch {
            // Ignore.
        }
    };

    const updateTimeDisplay = () => {
        duration = video.duration || 0;
        if (timeDuration) timeDuration.textContent = formatTime(duration);
        if (metaDuration) metaDuration.querySelector('span').textContent = formatTime(duration);
        if (metaResolution && video.videoWidth) {
            metaResolution.querySelector('span').textContent = `${video.videoWidth}x${video.videoHeight}`;
        }
        if (!userSeeking) {
            if (seekBar && duration > 0) {
                const pct = Math.min(1000, Math.max(0, (video.currentTime / duration) * 1000));
                seekBar.value = String(pct);
                seekBar.style.setProperty('--fill', `${pct / 10}%`);
            }
            if (timeCurrent) timeCurrent.textContent = formatTime(video.currentTime || 0);
        }
    };

    ['play', 'pause', 'waiting', 'playing', 'canplay', 'ended'].forEach((evt) => {
        video.addEventListener(evt, setPlayButtonState);
    });
    video.addEventListener('timeupdate', updateTimeDisplay);
    video.addEventListener('durationchange', updateTimeDisplay);
    video.addEventListener('loadedmetadata', updateTimeDisplay);
    video.addEventListener('volumechange', () => {
        if (!volumeSlider) return;
        const pct = video.muted ? 0 : Math.round(video.volume * 100);
        volumeSlider.value = String(pct);
        if (volumeIcon) volumeIcon.style.opacity = pct === 0 ? '.5' : '1';
    });
    video.addEventListener('ratechange', () => {
        const rate = video.playbackRate || 1;
        const text = rate === 1 ? '1x' : `${rate}x`;
        if (speedLabel) speedLabel.textContent = text;
        if (topSpeedLabel) topSpeedLabel.textContent = text;
    });
    video.addEventListener('error', () => {
        setHidden(bgMessage, false);
    });

    video.src = VIDEO_SRC;
    setPlayButtonState();
    updateTimeDisplay();

    // ═══════════════════════════════════════════
    // FULLSCREEN
    // ═══════════════════════════════════════════
    // The page shows a compact player; "expanded" is the full app-style
    // layout. It uses the real Fullscreen API where the browser allows it
    // on an element, and otherwise (iPhone Safari, some in-app browsers)
    // falls back to a fixed full-viewport overlay.
    const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const isExpanded = () => stage?.hasAttribute('data-expanded');

    const setExpanded = (on, pseudo) => {
        stage?.toggleAttribute('data-expanded', on);
        stage?.toggleAttribute('data-pseudo-fs', on && pseudo);
        document.body.classList.toggle('player-pseudo-fs', on && pseudo);
        setHidden(iconFsEnter, on);
        setHidden(iconFsExit, !on);
        closeSheets();
        showControls();
    };

    const lockLandscape = () => {
        if (video.videoWidth && video.videoWidth < video.videoHeight) return;
        try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* ignore */ }
    };

    const toggleFullscreen = () => {
        if (isExpanded()) {
            if (fsElement()) {
                (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
            } else {
                setExpanded(false, false);
            }
            try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
            return;
        }
        const request = stage?.requestFullscreen || stage?.webkitRequestFullscreen;
        if (!request) {
            setExpanded(true, true);
            return;
        }
        try {
            const result = request.call(stage);
            if (result && typeof result.then === 'function') {
                result.then(lockLandscape).catch(() => setExpanded(true, true));
            } else {
                lockLandscape();
            }
        } catch {
            setExpanded(true, true);
        }
    };

    const onFullscreenChange = () => {
        const fs = fsElement() === stage;
        if (fs !== isExpanded() || stage?.hasAttribute('data-pseudo-fs')) setExpanded(fs, false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    fullscreenBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullscreen();
    });

    // ═══════════════════════════════════════════
    // CONTROLS VISIBILITY (auto-hide)
    // ═══════════════════════════════════════════
    let hideTimer = null;
    const showControls = () => {
        stage?.removeAttribute('data-hidden');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (video && !video.paused) stage?.setAttribute('data-hidden', '');
        }, 3200);
    };

    const hideControlsNow = () => {
        stage?.setAttribute('data-hidden', '');
        clearTimeout(hideTimer);
    };

    // ═══════════════════════════════════════════
    // VIDEO GESTURES (on the tap layer)
    //   tap               show / hide the controls (never pauses)
    //   double-tap sides  -10s / +10s, further taps keep adding
    //   double-tap middle play / pause
    //   long-press        left half 1.5x, right half 2x, while held
    // ═══════════════════════════════════════════
    const boostBadge = document.getElementById('boostBadge');
    const boostLabel = document.getElementById('boostLabel');
    const DOUBLE_TAP_MS = 280;
    const LONG_PRESS_MS = 450;

    let press = null;
    let pressTimer = null;
    let boosting = false;
    let rateBeforeBoost = 1;
    let lastTap = null;
    let singleTapTimer = null;
    let seekChain = null;

    const tapZone = (x) => {
        const r = stage.getBoundingClientRect();
        const f = (x - r.left) / r.width;
        return f < 1 / 3 ? 'left' : f > 2 / 3 ? 'right' : 'center';
    };

    const sideFlash = (zone) => {
        if (!stage) return;
        stage.querySelectorAll(`.side-seek.${zone}`).forEach((el) => el.remove());
        const el = document.createElement('div');
        el.className = `side-seek ${zone}`;
        const label = document.createElement('span');
        label.textContent = zone === 'left' ? '« 10s' : '10s »';
        el.appendChild(label);
        stage.appendChild(el);
        setTimeout(() => el.remove(), 650);
    };

    const startBoost = (rate) => {
        boosting = true;
        rateBeforeBoost = video.playbackRate || 1;
        video.playbackRate = rate;
        if (boostLabel) boostLabel.textContent = `${rate}x`;
        setHidden(boostBadge, false);
        if (video.paused) video.play()?.catch?.(() => {});
        hideControlsNow();
    };

    const stopBoost = () => {
        if (!boosting) return;
        boosting = false;
        video.playbackRate = rateBeforeBoost;
        setHidden(boostBadge, true);
    };

    const handleTap = (x) => {
        const now = performance.now();
        const zone = tapZone(x);
        if (seekChain && now < seekChain.until && zone === seekChain.zone) {
            seekChain.until = now + 600;
            seekBy(zone === 'left' ? -10 : 10);
            sideFlash(zone);
            return;
        }
        if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && zone === lastTap.zone) {
            clearTimeout(singleTapTimer);
            lastTap = null;
            if (zone === 'center') {
                togglePlay();
                showControls();
            } else {
                seekBy(zone === 'left' ? -10 : 10);
                sideFlash(zone);
                seekChain = { zone, until: now + 600 };
            }
            return;
        }
        seekChain = null;
        lastTap = { t: now, zone };
        clearTimeout(singleTapTimer);
        singleTapTimer = setTimeout(() => {
            lastTap = null;
            if (stage?.hasAttribute('data-hidden')) showControls();
            else hideControlsNow();
        }, DOUBLE_TAP_MS);
    };

    tapLayer?.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        press = { x: e.clientX, y: e.clientY };
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            const r = stage.getBoundingClientRect();
            startBoost(e.clientX < r.left + r.width / 2 ? 1.5 : 2);
        }, LONG_PRESS_MS);
    });

    tapLayer?.addEventListener('pointermove', (e) => {
        if (!press || boosting) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) {
            clearTimeout(pressTimer);
            press = null;
        }
    });

    tapLayer?.addEventListener('pointerup', (e) => {
        clearTimeout(pressTimer);
        if (boosting) {
            stopBoost();
            press = null;
            return;
        }
        if (!press) return;
        press = null;
        handleTap(e.clientX);
    });

    ['pointercancel', 'pointerleave'].forEach((evt) => tapLayer?.addEventListener(evt, () => {
        clearTimeout(pressTimer);
        press = null;
        stopBoost();
    }));

    stage?.addEventListener('contextmenu', (e) => e.preventDefault());

    showControls();

    // ═══════════════════════════════════════════
    // TOP BAR
    // ═══════════════════════════════════════════
    backBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isExpanded()) toggleFullscreen();
    });

    shareBtn?.addEventListener('click', async () => {
        const shareData = { title: FILE_NAME, url: window.location.href };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
                return;
            }
        } catch {
            // Fall through to clipboard.
        }
        try {
            await navigator.clipboard.writeText(window.location.href);
            toast(t('linkCopied'));
        } catch {
            toast(t('copyFailed'));
        }
    });

    // ═══════════════════════════════════════════
    // FLOATING WINDOW (picture-in-picture)
    // Where the browser has Document Picture-in-Picture (desktop Chrome /
    // Edge), the whole player moves into the floating window - controls and
    // our subtitles included. Otherwise it's the plain video PiP, where the
    // browser draws only the picture (Chrome on Android shows no subtitles
    // there, and offers no way for a page to add any).
    // While floating, the video's place on the page says so and offers a
    // button to bring it back.
    // ═══════════════════════════════════════════
    const screenEl = stage?.parentElement;
    const pipPlaceholder = document.getElementById('pipPlaceholder');
    let docPipWindow = null;

    const setPipShown = (on) => {
        screenEl?.toggleAttribute('data-pip', on);
        setHidden(pipPlaceholder, !on);
    };

    const openDocumentPip = async () => {
        const pipWin = await window.documentPictureInPicture.requestWindow({
            width: Math.max(320, Math.round(stage.clientWidth)),
            height: Math.max(180, Math.round(stage.clientHeight)),
        });
        docPipWindow = pipWin;
        document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
            pipWin.document.head.appendChild(node.cloneNode(true));
        });
        pipWin.document.documentElement.classList.add('pip-doc');
        if (IS_HE) pipWin.document.documentElement.lang = 'he';
        stage.setAttribute('data-docpip', '');
        pipWin.document.body.appendChild(stage);
        setPipShown(true);
        pipWin.addEventListener('pagehide', () => {
            stage.removeAttribute('data-docpip');
            screenEl?.insertBefore(stage, pipPlaceholder);
            docPipWindow = null;
            setPipShown(false);
            positionSubs();
        }, { once: true });
        positionSubs();
    };

    const enterPip = async () => {
        if (isExpanded()) toggleFullscreen();
        try {
            if ('documentPictureInPicture' in window && stage && screenEl) {
                await openDocumentPip();
            } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
                await video.requestPictureInPicture();
            } else {
                toast(t('pipUnsupported'));
            }
        } catch {
            toast(t('pipUnsupported'));
        }
    };

    const exitPip = async () => {
        try {
            if (docPipWindow) docPipWindow.close();
            else if (document.pictureInPictureElement) await document.exitPictureInPicture();
        } catch { /* ignore */ }
    };

    pipBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (docPipWindow || document.pictureInPictureElement) exitPip();
        else enterPip();
    });
    document.getElementById('pipReturnBtn')?.addEventListener('click', exitPip);
    video.addEventListener('enterpictureinpicture', () => setPipShown(true));
    video.addEventListener('leavepictureinpicture', () => setPipShown(false));

    // ═══════════════════════════════════════════
    // CENTER CONTROLS
    // ═══════════════════════════════════════════
    playBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlay();
        showControls();
    });

    const flashSeek = (btn, delta) => {
        if (!btn) return;
        btn.classList.remove('seek-pulse');
        // Force reflow so re-adding the class restarts the animation on a
        // quick double-tap instead of being a no-op.
        void btn.offsetWidth;
        btn.classList.add('seek-pulse');
        const flash = document.createElement('span');
        flash.className = 'seek-flash';
        flash.textContent = delta > 0 ? `+${delta}` : `${delta}`;
        btn.appendChild(flash);
        setTimeout(() => flash.remove(), 650);
        setTimeout(() => btn.classList.remove('seek-pulse'), 650);
    };

    const seekBy = (delta) => {
        if (video) {
            video.currentTime = Math.min(duration || Infinity, Math.max(0, (video.currentTime || 0) + delta));
        }
        showControls();
    };

    seekBackBtn?.addEventListener('click', (e) => { e.stopPropagation(); flashSeek(seekBackBtn, -10); seekBy(-10); });
    seekFwdBtn?.addEventListener('click', (e) => { e.stopPropagation(); flashSeek(seekFwdBtn, 10); seekBy(10); });

    // ═══════════════════════════════════════════
    // SEEK BAR
    // ═══════════════════════════════════════════
    seekBar?.addEventListener('input', () => {
        userSeeking = true;
        const pct = Number(seekBar.value) / 1000;
        seekBar.style.setProperty('--fill', `${pct * 100}%`);
        if (timeCurrent && duration > 0) timeCurrent.textContent = formatTime(pct * duration);
        showControls();
    });

    seekBar?.addEventListener('change', () => {
        if (video && duration > 0) {
            video.currentTime = (Number(seekBar.value) / 1000) * duration;
        }
        userSeeking = false;
    });

    // ═══════════════════════════════════════════
    // SIDE SLIDERS: brightness / volume
    // Hidden at rest (only the icon shows); the track + thumb reveal
    // while the slider is actually being dragged, then fade back out
    // shortly after release.
    // ═══════════════════════════════════════════
    const wireSliderReveal = (wrap, range) => {
        if (!wrap || !range) return;
        let hideTimer = null;
        const reveal = () => {
            wrap.classList.add('active');
            clearTimeout(hideTimer);
        };
        const scheduleHide = () => {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => wrap.classList.remove('active'), 700);
        };
        range.addEventListener('pointerdown', reveal);
        range.addEventListener('input', reveal);
        range.addEventListener('pointerup', scheduleHide);
        range.addEventListener('change', scheduleHide);
    };
    wireSliderReveal(brightnessWrap, brightnessSlider);
    wireSliderReveal(volumeWrap, volumeSlider);

    brightnessSlider?.addEventListener('input', () => {
        if (video) video.style.filter = `brightness(${brightnessSlider.value}%)`;
        showControls();
    });

    volumeSlider?.addEventListener('input', () => {
        const val = Number(volumeSlider.value);
        if (video) {
            video.volume = val / 100;
            video.muted = val === 0;
        }
        if (volumeIcon) volumeIcon.style.opacity = val === 0 ? '.5' : '1';
        showControls();
    });

    // ═══════════════════════════════════════════
    // SPEED SHEET
    // ═══════════════════════════════════════════
    const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

    const renderSpeedOptions = () => {
        if (!speedOptions) return;
        const current = video?.playbackRate || 1;
        speedOptions.innerHTML = '';
        SPEEDS.forEach((rate) => {
            const btn = document.createElement('button');
            btn.className = 'sheet-option' + (rate === current ? ' selected' : '');
            btn.textContent = rate === 1 ? t('normalSpeed') : `${rate}x`;
            btn.addEventListener('click', () => {
                try { if (video) video.playbackRate = rate; } catch { /* ignore */ }
                closeSheets();
            });
            speedOptions.appendChild(btn);
        });
    };

    [speedBtn, topSpeedBtn].forEach((btn) => btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSpeedOptions();
        openSheet(speedSheet);
    }));

    // ═══════════════════════════════════════════
    // SLEEP TIMER SHEET
    // ═══════════════════════════════════════════
    let sleepTimerHandle = null;
    let sleepTimerMinutes = null;

    const SLEEP_OPTIONS = [
        { label: t('timerOff'), minutes: null },
        { label: t('minutes', 10), minutes: 10 },
        { label: t('minutes', 20), minutes: 20 },
        { label: t('minutes', 30), minutes: 30 },
        { label: t('minutes', 45), minutes: 45 },
        { label: t('minutes', 60), minutes: 60 },
    ];

    const renderSleepOptions = () => {
        if (!sleepOptions) return;
        sleepOptions.innerHTML = '';
        SLEEP_OPTIONS.forEach(({ label, minutes }) => {
            const btn = document.createElement('button');
            btn.className = 'sheet-option' + (minutes === sleepTimerMinutes ? ' selected' : '');
            btn.textContent = label;
            btn.addEventListener('click', () => {
                clearTimeout(sleepTimerHandle);
                sleepTimerMinutes = minutes;
                if (minutes) {
                    sleepTimerHandle = setTimeout(() => {
                        try { video?.pause(); } catch { /* ignore */ }
                        toast(t('sleepPaused'));
                    }, minutes * 60 * 1000);
                    toast(t('sleepSet', label));
                } else {
                    toast(t('sleepOff'));
                }
                closeSheets();
            });
            sleepOptions.appendChild(btn);
        });
    };

    sleepBtn?.addEventListener('click', () => {
        renderSleepOptions();
        openSheet(sleepSheet);
    });

    // ═══════════════════════════════════════════
    // LOCK
    // ═══════════════════════════════════════════
    lockBtn?.addEventListener('click', () => {
        stage?.setAttribute('data-locked', '');
        setHidden(unlockBtn, false);
    });

    unlockBtn?.addEventListener('click', () => {
        stage?.removeAttribute('data-locked');
        setHidden(unlockBtn, true);
        showControls();
    });

    // ═══════════════════════════════════════════
    // OPEN IN EXTERNAL PLAYER
    // ═══════════════════════════════════════════
    openInBtn?.addEventListener('click', () => openSheet(openInSheet));
    pageOpenInBtn?.addEventListener('click', () => openSheet(openInSheet));

    pageCopyBtn?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            toast(t('linkCopied'));
        } catch {
            toast(t('copyFailed'));
        }
    });

    // ═══════════════════════════════════════════
    // SUBTITLES
    // The server extracts embedded subtitles one minute at a time
    // (GET /subtitle/<file>?track=N&t=<seconds>) using the MKV index, so
    // the first line shows within seconds instead of after the whole movie
    // has been read. We keep the windows around the playhead loaded and draw
    // the lines ourselves: on the actual picture, lifted above the control
    // bar while it's visible, each line laid out in its own direction so
    // Hebrew/Arabic punctuation lands on the correct side.
    // ═══════════════════════════════════════════
    const subOverlay = document.getElementById('subOverlay');
    const ovBottom = document.getElementById('ovBottom');
    const SUB_WINDOW_S = 60;

    let discoveredTracks = [];
    let subTrack = null;          // selected track number, or null = off
    let subCues = [];             // [{s, e, t}] ms, sorted by start
    let subWindows = new Map();   // window index -> 'loading' | 'done' | 'error'
    let subGeneration = 0;        // bumps on every selection, drops stale responses
    let subLoadingToastShown = false;

    const languageName = (code) => {
        if (!code || code === 'und') return null;
        try {
            const name = new Intl.DisplayNames([navigator.language || 'en', 'en'], { type: 'language' }).of(code);
            if (name && name.toLowerCase() !== code.toLowerCase()) return name;
        } catch { /* fall through */ }
        return code.toUpperCase();
    };

    // Appearance, as in TjGramApp's subtitle settings. Kept per viewer.
    const SUB_PREFS_KEY = 'tj_sub_prefs';
    const SUB_DEFAULTS = { size: 18, pos: 0, sync: 0, style: 'outline' };
    let subPrefs = { ...SUB_DEFAULTS };
    try { subPrefs = { ...SUB_DEFAULTS, ...JSON.parse(localStorage.getItem(SUB_PREFS_KEY) || '{}') }; } catch { /* ignore */ }
    const saveSubPrefs = () => { try { localStorage.setItem(SUB_PREFS_KEY, JSON.stringify(subPrefs)); } catch { /* ignore */ } };
    let subPreview = false; // sample line while the settings sheet is open

    const positionSubs = () => {
        if (!subOverlay || !stage) return;
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        const vw = video.videoWidth || 16;
        const vh = video.videoHeight || 9;
        const picH = vh * Math.min(w / vw, h / vh);
        const picGap = (h - picH) / 2;
        const controlsUp = !stage.hasAttribute('data-hidden') && !stage.hasAttribute('data-locked');
        const barH = controlsUp && ovBottom ? ovBottom.offsetHeight : 0;
        // Bottom of the picture, raised by the chosen position - but never under the control bar.
        const bottom = Math.max(picGap + picH * (subPrefs.pos / 100), barH) + 8;
        subOverlay.style.bottom = `${Math.round(bottom)}px`;
        subOverlay.style.fontSize = `${Math.max(11, Math.round(subPrefs.size * Math.max(0.55, picH / 400)))}px`;
        subOverlay.dataset.style = subPrefs.style;
    };

    // ---- Right-to-left, exactly as TjGramApp's TjSubtitleView does it ----
    // Strip the bidi control characters the file already carries (a second
    // layer of them is what reverses a line instead of fixing it) and any
    // markup; then, if the cue has Hebrew/Arabic, move each line's trailing
    // punctuation run to its front and lay the line out left-to-right.
    const SUB_MARKUP = /\{[^}]*\}|<\/?[a-zA-Z][^>]*>/g;
    const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;
    const RTL_CHAR = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
    const TRAILING_PUNCT = new Set([',', '.', '!', '?', ':', ';', '…', '،', '؛', '؟']);

    const cueLines = (text) => text.replace(SUB_MARKUP, '').replace(BIDI_CONTROLS, '')
        .split(/\r?\n|\\[Nn]/).map((l) => l.trim()).filter(Boolean);

    const movePunctuationToFront = (line) => {
        if (line.length < 2 || TRAILING_PUNCT.has(line[0])) return line;
        let cut = line.length;
        while (cut > 0 && TRAILING_PUNCT.has(line[cut - 1])) cut -= 1;
        if (cut === line.length || cut === 0) return line;
        return line.slice(cut) + line.slice(0, cut);
    };

    const displayLines = (texts) => {
        const raw = texts.flatMap(cueLines);
        const rtl = RTL_CHAR.test(raw.join('\n'));
        return rtl ? raw.map(movePunctuationToFront) : raw;
    };

    const activeCues = () => {
        if (subTrack == null) return [];
        const now = video.currentTime * 1000 - subPrefs.sync * 1000;
        return subCues.filter((c) => c.s <= now && now < c.e);
    };

    let shownCueKey = '';
    const renderCues = () => {
        if (!subOverlay) return;
        let texts = activeCues().map((c) => c.t);
        if (!texts.length && subPreview) texts = [t('subsPreview')];
        const key = texts.join('|') + `|${subPreview}`;
        if (key === shownCueKey) return;
        shownCueKey = key;
        subOverlay.replaceChildren(...displayLines(texts).map((l) => {
            const line = document.createElement('div');
            line.className = 'sub-line';
            line.dir = 'ltr';
            line.textContent = l;
            return line;
        }));
        positionSubs();
    };


    const mergeCues = (incoming) => {
        const seen = new Set(subCues.map((c) => `${c.s}:${c.t}`));
        incoming.forEach((c) => {
            if (typeof c?.s !== 'number' || typeof c?.e !== 'number' || typeof c?.t !== 'string') return;
            const k = `${c.s}:${c.t}`;
            if (!seen.has(k)) { seen.add(k); subCues.push({ s: c.s, e: c.e, t: c.t }); }
        });
        subCues.sort((a, b) => a.s - b.s);
    };

    const loadSubWindow = async (idx) => {
        if (subTrack == null || idx < 0 || subWindows.has(idx)) return;
        if (duration > 0 && idx * SUB_WINDOW_S > duration) return;
        const url = deriveAuxUrl('subtitle');
        if (!url) return;
        url.searchParams.set('track', subTrack);
        url.searchParams.set('t', String(idx * SUB_WINDOW_S));
        const gen = subGeneration;
        subWindows.set(idx, 'loading');
        try {
            const res = await fetch(url.toString());
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (gen !== subGeneration) return;
            mergeCues(Array.isArray(data?.cues) ? data.cues : []);
            subIndexed = data?.indexed === true;
            subWindows.set(idx, 'done');
            shownCueKey = '';
            renderCues();
            scheduleSubFill();
        } catch {
            if (gen !== subGeneration) return;
            subWindows.set(idx, 'error');
            // Let a later timeupdate retry this window.
            setTimeout(() => { if (gen === subGeneration && subWindows.get(idx) === 'error') subWindows.delete(idx); }, 8000);
            if (idx === Math.floor(video.currentTime / SUB_WINDOW_S)) toast(t('subsRetry'));
        }
    };

    // After the minute under the playhead is in, keep pulling the rest of the
    // track one minute at a time (ahead of the playhead first, then from the
    // start), so seeking anywhere later already has its subtitles. Only for
    // files whose subtitle blocks are indexed: the server then reads just
    // those few KiB per line, never the video around them.
    let subFillBusy = false;
    let subIndexed = false;
    const scheduleSubFill = () => {
        if (subFillBusy || subTrack == null || !subIndexed || !(duration > 0)) return;
        const total = Math.ceil(duration / SUB_WINDOW_S);
        const here = Math.max(0, Math.floor(video.currentTime / SUB_WINDOW_S));
        let next = -1;
        for (let i = 0; i < total && next < 0; i++) {
            const idx = (here + i) % total;
            if (!subWindows.has(idx)) next = idx;
        }
        if (next < 0) return;
        subFillBusy = true;
        const gen = subGeneration;
        setTimeout(async () => {
            if (gen === subGeneration) await loadSubWindow(next);
            subFillBusy = false;
            if (gen === subGeneration) scheduleSubFill();
        }, 250);
    };

    const ensureSubWindows = () => {
        if (subTrack == null) return;
        const idx = Math.floor(Math.max(0, video.currentTime - subPrefs.sync) / SUB_WINDOW_S);
        loadSubWindow(idx);
        // Prefetch the next minute well before it's needed.
        loadSubWindow(idx + 1);
        if (!subLoadingToastShown && subWindows.get(idx) === 'loading') {
            subLoadingToastShown = true;
            toast(t('subsLoading'));
        }
    };

    const updateSubIndicator = () => {
        [tracksBtn, topTracksBtn].forEach((b) => b?.classList.toggle('is-on', subTrack != null));
    };

    const selectSubtitle = (trackNumber) => {
        subGeneration += 1;
        subTrack = trackNumber;
        subCues = [];
        subIndexed = false;
        subWindows = new Map();
        subLoadingToastShown = false;
        shownCueKey = '';
        renderCues();
        updateSubIndicator();
        ensureSubWindows();
    };

    video.addEventListener('timeupdate', () => { renderCues(); ensureSubWindows(); });
    video.addEventListener('seeked', () => { renderCues(); ensureSubWindows(); });
    video.addEventListener('loadedmetadata', positionSubs);
    if (stage) {
        new MutationObserver(positionSubs).observe(stage, {
            attributes: true,
            attributeFilter: ['data-hidden', 'data-expanded', 'data-locked'],
        });
        if (window.ResizeObserver) new ResizeObserver(positionSubs).observe(stage);
    }

    const syncSelectedOption = (container, selectedBtn) => {
        container.querySelectorAll('.sheet-option').forEach((el) => el.classList.remove('selected'));
        selectedBtn.classList.add('selected');
    };

    const optionWithLabels = (main, sub) => {
        const btn = document.createElement('button');
        btn.className = 'sheet-option';
        const text = document.createElement('span');
        text.className = 'opt-text';
        const mainEl = document.createElement('span');
        mainEl.className = 'opt-main';
        mainEl.textContent = main;
        text.appendChild(mainEl);
        if (sub && sub !== main) {
            const subEl = document.createElement('span');
            subEl.className = 'opt-sub';
            subEl.dir = 'auto';
            subEl.textContent = sub;
            text.appendChild(subEl);
        }
        btn.appendChild(text);
        return btn;
    };

    const renderTrackSheets = () => {
        const subtitleTracks = discoveredTracks.filter((t) => t.type === 'subtitle');
        const audioTracks = discoveredTracks.filter((t) => t.type === 'audio');

        if (subtitleOptions) {
            subtitleOptions.innerHTML = '';
            if (!subtitleTracks.length) {
                subtitleOptions.innerHTML = `<div class="sheet-empty">${t('noSubs')}</div>`;
            } else {
                const offBtn = optionWithLabels(t('off'));
                if (subTrack == null) offBtn.classList.add('selected');
                offBtn.addEventListener('click', () => {
                    selectSubtitle(null);
                    syncSelectedOption(subtitleOptions, offBtn);
                    closeSheets();
                });
                subtitleOptions.appendChild(offBtn);

                subtitleTracks.forEach((track, index) => {
                    const lang = languageName(track.language);
                    const btn = optionWithLabels(lang || track.name || t('track', index + 1), lang ? track.name : null);
                    const usable = !track.codec || track.codec.startsWith('S_TEXT/');
                    if (!usable) {
                        btn.disabled = true;
                        btn.title = t('imageSubs');
                    }
                    if (track.number === subTrack) btn.classList.add('selected');
                    btn.addEventListener('click', () => {
                        selectSubtitle(track.number);
                        syncSelectedOption(subtitleOptions, btn);
                        closeSheets();
                    });
                    subtitleOptions.appendChild(btn);
                });
            }
        }

        if (audioOptions) {
            audioOptions.innerHTML = '';
            if (audioTracks.length <= 1) {
                audioOptions.innerHTML = `<div class="sheet-empty">${t('oneAudio')}</div>`;
            } else {
                audioTracks.forEach((track, index) => {
                    const row = optionWithLabels(languageName(track.language) || track.name || t('track', index + 1), track.name);
                    row.disabled = true;
                    row.title = t('audioNoSwitch');
                    audioOptions.appendChild(row);
                });
            }
        }
    };

    const initTracks = async () => {
        const tracksUrl = deriveAuxUrl('tracks');
        if (!tracksUrl) return;
        try {
            const res = await fetch(tracksUrl.toString());
            if (!res.ok) return;
            const data = await res.json();
            discoveredTracks = Array.isArray(data?.tracks) ? data.tracks : [];
        } catch {
            discoveredTracks = [];
        }
        renderTrackSheets();
    };

    initTracks();

    [tracksBtn, topTracksBtn].forEach((btn) => btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        renderTrackSheets();
        openSheet(tracksSheet);
    }));

    // ═══════════════════════════════════════════
    // SUBTITLE SETTINGS SHEET
    // ═══════════════════════════════════════════
    const subSize = document.getElementById('subSize');
    const subPos = document.getElementById('subPos');
    const subSync = document.getElementById('subSync');
    const subStyleSeg = document.getElementById('subStyleSeg');

    const reflectSubPrefs = () => {
        if (subSize) subSize.value = subPrefs.size;
        if (subPos) subPos.value = subPrefs.pos;
        if (subSync) subSync.value = subPrefs.sync;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('subSizeVal', subPrefs.size);
        set('subPosVal', subPrefs.pos);
        set('subSyncVal', `${subPrefs.sync > 0 ? '+' : ''}${(+subPrefs.sync).toFixed(1).replace(/\.0$/, '')}s`);
        [subSize, subPos, subSync].forEach((r) => {
            if (!r) return;
            const pct = ((r.value - r.min) / (r.max - r.min)) * 100;
            r.style.setProperty('--fill', `${pct}%`);
        });
        subStyleSeg?.querySelectorAll('button').forEach((b) => b.classList.toggle('selected', b.dataset.style === subPrefs.style));
    };

    const applySubPrefs = (changes) => {
        const syncChanged = 'sync' in changes && changes.sync !== subPrefs.sync;
        subPrefs = { ...subPrefs, ...changes };
        saveSubPrefs();
        reflectSubPrefs();
        if (syncChanged) ensureSubWindows();
        shownCueKey = '';
        renderCues();
        positionSubs();
    };

    subSize?.addEventListener('input', () => applySubPrefs({ size: Number(subSize.value) }));
    subPos?.addEventListener('input', () => applySubPrefs({ pos: Number(subPos.value) }));
    subSync?.addEventListener('input', () => applySubPrefs({ sync: Math.round(Number(subSync.value) * 10) / 10 }));
    document.getElementById('subSyncMinus')?.addEventListener('click', () =>
        applySubPrefs({ sync: Math.max(-10, Math.round((subPrefs.sync - 0.1) * 10) / 10) }));
    document.getElementById('subSyncPlus')?.addEventListener('click', () =>
        applySubPrefs({ sync: Math.min(10, Math.round((subPrefs.sync + 0.1) * 10) / 10) }));
    subStyleSeg?.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => applySubPrefs({ style: b.dataset.style })));
    document.getElementById('subStyleReset')?.addEventListener('click', () => applySubPrefs({ ...SUB_DEFAULTS }));

    const setSubPreview = (on) => {
        subPreview = on;
        shownCueKey = '';
        renderCues();
    };
    document.getElementById('subStyleBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        reflectSubPrefs();
        openSheet(subStyleSheet);
        setSubPreview(true);
    });
    document.getElementById('subStyleBack')?.addEventListener('click', () => {
        setSubPreview(false);
        renderTrackSheets();
        openSheet(tracksSheet);
    });
    // Any way the settings sheet closes ends the sample line.
    new MutationObserver(() => {
        if (subPreview && subStyleSheet?.hasAttribute('hidden')) setSubPreview(false);
    }).observe(subStyleSheet || document.createElement('div'), { attributes: true, attributeFilter: ['hidden'] });
    reflectSubPrefs();

    // ═══════════════════════════════════════════
    // SHEETS: drag the top (handle / title) down to close
    // ═══════════════════════════════════════════
    allSheets.forEach((sheet) => {
        let drag = null;
        sheet.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('.sheet-handle, .sheet-head, .sheet-title')) return;
            if (e.target.closest('button')) return;
            if (window.matchMedia('(min-width: 700px)').matches) return; // side panel: closes with X
            drag = { y: e.clientY, time: performance.now(), dy: 0, id: e.pointerId };
            sheet.setPointerCapture?.(e.pointerId);
            sheet.style.transition = 'none';
        });
        sheet.addEventListener('pointermove', (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            drag.dy = Math.max(0, e.clientY - drag.y);
            sheet.style.transform = `translateY(${drag.dy}px)`;
        });
        const end = () => {
            if (!drag) return;
            const { dy, time } = drag;
            drag = null;
            const fast = dy / Math.max(1, performance.now() - time) > 0.5;
            sheet.style.transition = 'transform .2s ease';
            if (dy > 80 || (fast && dy > 20)) {
                sheet.style.transform = 'translateY(110%)';
                setTimeout(() => {
                    closeSheets();
                    sheet.style.transform = '';
                    sheet.style.transition = '';
                }, 200);
            } else {
                sheet.style.transform = '';
            }
        };
        sheet.addEventListener('pointerup', end);
        sheet.addEventListener('pointercancel', end);
    });

    // ═══════════════════════════════════════════
    // KEYBOARD SHORTCUTS
    // ═══════════════════════════════════════════
    document.addEventListener('keydown', (e) => {
        if (e.target instanceof HTMLInputElement) return;
        switch (e.key) {
            case ' ':
            case 'k':
                e.preventDefault();
                togglePlay();
                showControls();
                break;
            case 'ArrowLeft':
                seekBy(-10);
                break;
            case 'ArrowRight':
                seekBy(10);
                break;
            case 'f':
                toggleFullscreen();
                break;
            case 'm':
                try { if (video) video.muted = !video.muted; } catch { /* ignore */ }
                break;
            case 'Escape':
                if (allSheets.some((s) => !s.hasAttribute('hidden'))) closeSheets();
                else if (stage?.hasAttribute('data-pseudo-fs')) setExpanded(false, false);
                break;
        }
    });
})();
