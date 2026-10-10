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
    const tracksLabel = document.getElementById('tracksLabel');
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
    const allSheets = [speedSheet, sleepSheet, tracksSheet, openInSheet].filter(Boolean);

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

    tapLayer?.addEventListener('click', () => {
        if (stage?.hasAttribute('data-hidden') || stage?.getAttribute('data-hidden') === '') {
            showControls();
        } else {
            togglePlay();
            stage?.setAttribute('data-hidden', '');
            clearTimeout(hideTimer);
        }
    });

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
            toast('Link copied to clipboard');
        } catch {
            toast('Could not copy link');
        }
    });

    pipBtn?.addEventListener('click', async () => {
        if (!video) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled) {
                await video.requestPictureInPicture();
            } else {
                toast('Picture-in-picture is not supported here');
            }
        } catch {
            toast('Picture-in-picture is not supported here');
        }
    });

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
            btn.textContent = rate === 1 ? 'Normal (1x)' : `${rate}x`;
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
        { label: 'Off', minutes: null },
        { label: '10 minutes', minutes: 10 },
        { label: '20 minutes', minutes: 20 },
        { label: '30 minutes', minutes: 30 },
        { label: '45 minutes', minutes: 45 },
        { label: '60 minutes', minutes: 60 },
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
                        toast('Sleep timer: playback paused');
                    }, minutes * 60 * 1000);
                    toast(`Sleep timer set: ${label}`);
                } else {
                    toast('Sleep timer off');
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
            toast('Link copied to clipboard');
        } catch {
            toast('Could not copy link');
        }
    });

    // ═══════════════════════════════════════════
    // SUBTITLE & AUDIO TRACK DISCOVERY
    // ═══════════════════════════════════════════
    let discoveredTracks = [];

    const renderTrackSheets = () => {
        const subtitleTracks = discoveredTracks.filter((t) => t.type === 'subtitle');
        const audioTracks = discoveredTracks.filter((t) => t.type === 'audio');

        if (subtitleOptions) {
            subtitleOptions.innerHTML = '';
            if (!subtitleTracks.length) {
                subtitleOptions.innerHTML = '<div class="sheet-empty">No embedded subtitles found.</div>';
            } else {
                // Reflect whatever is actually showing right now, not just "Off" -
                // this sheet gets rebuilt every time it's opened, so it must not
                // forget a selection that's already active on the video.
                const activeLabel = activeSubTrack()?.label || null;

                const offBtn = document.createElement('button');
                offBtn.className = 'sheet-option' + (activeLabel ? '' : ' selected');
                offBtn.textContent = 'Off';
                offBtn.addEventListener('click', () => {
                    Array.from(video.textTracks || []).forEach((t) => { t.mode = 'disabled'; });
                    renderCues();
                    syncSelectedOption(subtitleOptions, offBtn);
                    closeSheets();
                });
                subtitleOptions.appendChild(offBtn);

                subtitleTracks.forEach((track, index) => {
                    const hasLanguage = track.language && track.language !== 'und';
                    const label = track.name || (hasLanguage ? track.language.toUpperCase() : `Track ${index + 1}`);
                    const btn = document.createElement('button');
                    btn.className = 'sheet-option' + (label === activeLabel ? ' selected' : '');
                    btn.textContent = label;
                    btn.addEventListener('click', () => {
                        const trackEl = ensureSubtitleAdded(track, index);
                        Array.from(video.textTracks || []).forEach((t) => {
                            // 'hidden' = cues load and fire cuechange, but the
                            // browser doesn't draw them; our overlay does.
                            t.mode = (trackEl && t.label === trackEl.label) ? 'hidden' : 'disabled';
                            watchCues(t);
                        });
                        renderCues();
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
                audioOptions.innerHTML = '<div class="sheet-empty">Only one audio track.</div>';
            } else {
                audioTracks.forEach((track, index) => {
                    const hasLanguage = track.language && track.language !== 'und';
                    const label = track.name || (hasLanguage ? track.language.toUpperCase() : `Track ${index + 1}`);
                    const row = document.createElement('div');
                    row.className = 'sheet-option';
                    row.style.cursor = 'default';
                    row.textContent = label;
                    row.title = "In-browser audio switching isn't supported — download the file to pick a track in an external player.";
                    audioOptions.appendChild(row);
                });
            }
        }

        if (tracksLabel) {
            tracksLabel.textContent = audioTracks.length > 1 ? `${audioTracks.length} Audio` : 'Captions';
        }
    };

    const syncSelectedOption = (container, selectedBtn) => {
        container.querySelectorAll('.sheet-option').forEach((el) => el.classList.remove('selected'));
        selectedBtn.classList.add('selected');
    };

    const addedSubtitleTrackEls = new Map();

    // ═══════════════════════════════════════════
    // SUBTITLE RENDERING — our own overlay instead of the browser's, so
    // the text sits on the actual picture (not the bottom of a letterboxed
    // fullscreen screen), lifts above the control bar while it's showing,
    // and lays out each line by its own direction (Hebrew/Arabic RTL with
    // punctuation on the correct side).
    // ═══════════════════════════════════════════
    const subOverlay = document.getElementById('subOverlay');
    const ovBottom = document.getElementById('ovBottom');
    const watchedTracks = new WeakSet();

    const activeSubTrack = () => Array.from(video.textTracks || [])
        .find((t) => t.mode === 'hidden' || t.mode === 'showing') || null;

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
        subOverlay.style.bottom = `${Math.round(Math.max(picGap, barH) + picH * 0.04)}px`;
        subOverlay.style.fontSize = `${Math.round(Math.max(13, Math.min(34, picH * 0.055)))}px`;
    };

    const renderCues = () => {
        if (!subOverlay) return;
        const track = activeSubTrack();
        const cues = track?.activeCues ? Array.from(track.activeCues) : [];
        subOverlay.replaceChildren(...cues.map((cue) => {
            const line = document.createElement('div');
            line.className = 'sub-line';
            line.dir = 'auto';
            if (typeof cue.getCueAsHTML === 'function') line.appendChild(cue.getCueAsHTML());
            else line.textContent = cue.text || '';
            return line;
        }));
        positionSubs();
    };

    const watchCues = (t) => {
        if (watchedTracks.has(t)) return;
        watchedTracks.add(t);
        t.addEventListener('cuechange', renderCues);
    };

    video.addEventListener('loadedmetadata', positionSubs);
    if (stage) {
        new MutationObserver(positionSubs).observe(stage, {
            attributes: true,
            attributeFilter: ['data-hidden', 'data-expanded', 'data-locked'],
        });
        if (window.ResizeObserver) new ResizeObserver(positionSubs).observe(stage);
    }

    const ensureSubtitleAdded = (track, index) => {
        const key = `${track.number}`;
        if (addedSubtitleTrackEls.has(key)) return addedSubtitleTrackEls.get(key);
        if (!video || track.number == null) return null;
        const subUrl = deriveAuxUrl('subtitle');
        if (!subUrl) return null;
        subUrl.searchParams.set('track', track.number);
        const hasLanguage = track.language && track.language !== 'und';
        const label = track.name || (hasLanguage ? track.language.toUpperCase() : `Track ${index + 1}`);
        const trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.label = label;
        if (hasLanguage) trackEl.srclang = track.language;
        trackEl.src = subUrl.toString();
        video.appendChild(trackEl);
        addedSubtitleTrackEls.set(key, trackEl);
        return trackEl;
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
