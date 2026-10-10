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

    const seekBackBtn = document.getElementById('seekBackBtn');
    const seekFwdBtn = document.getElementById('seekFwdBtn');
    const playBtn = document.getElementById('playBtn');
    const iconPlay = playBtn?.querySelector('.icon-play');
    const iconPause = playBtn?.querySelector('.icon-pause');
    const iconSpinner = playBtn?.querySelector('.icon-spinner');

    const brightnessSlider = document.getElementById('brightnessSlider');
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeIcon = document.getElementById('volumeIcon');

    const seekBar = document.getElementById('seekBar');
    const timeCurrent = document.getElementById('timeCurrent');
    const timeDuration = document.getElementById('timeDuration');

    const speedBtn = document.getElementById('speedBtn');
    const speedLabel = document.getElementById('speedLabel');
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
    // PLAYER WIRING — operates on the native <video>
    // element directly (standard HTMLMediaElement /
    // TextTrack APIs) rather than vidstack's own
    // subscribe()/textTracks.add() proxy, which turned
    // out not to behave as documented in this player
    // version: play/pause state never reflected and
    // added text tracks never actually showed captions.
    // ═══════════════════════════════════════════
    if (!player) return;

    let duration = 0;
    let userSeeking = false;
    let video = null;

    const setPlayButtonState = () => {
        if (!video) return;
        const showSpinner = video.readyState < 3 && !video.paused && !video.ended;
        const showPause = !video.paused && !showSpinner && !video.ended;
        setHidden(iconPlay, showPause || showSpinner);
        setHidden(iconPause, !showPause);
        setHidden(iconSpinner, !showSpinner);
    };

    const togglePlay = () => {
        if (!video) return;
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
        if (!video) return;
        duration = video.duration || 0;
        if (timeDuration) timeDuration.textContent = formatTime(duration);
        if (!userSeeking) {
            if (seekBar && duration > 0) {
                const pct = Math.min(1000, Math.max(0, (video.currentTime / duration) * 1000));
                seekBar.value = String(pct);
                seekBar.style.setProperty('--fill', `${pct / 10}%`);
            }
            if (timeCurrent) timeCurrent.textContent = formatTime(video.currentTime || 0);
        }
    };

    const onVideoReady = (el) => {
        if (video === el) return;
        video = el;

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
            if (!speedLabel) return;
            const rate = video.playbackRate || 1;
            speedLabel.textContent = rate === 1 ? '1x' : `${rate}x`;
        });
        video.addEventListener('error', () => {
            setHidden(bgMessage, false);
        });

        setPlayButtonState();
        updateTimeDisplay();
        initTracks();
    };

    // The native <video> is created lazily inside <media-provider>; watch
    // for it rather than relying on any particular vidstack lifecycle event.
    const videoWatcher = new MutationObserver(() => {
        const el = stage?.querySelector('video');
        if (el) onVideoReady(el);
    });
    videoWatcher.observe(stage, { childList: true, subtree: true });

    customElements.whenDefined('media-player').then(() => {
        const isSupportedAudio = /\.(mp3|wav|ogg|flac|m4a|aac)(\?.*)?$/i.test(VIDEO_SRC);
        const isUnsupportedAudio = /\.(wma|ac3|dts|aif|aiff|alac)(\?.*)?$/i.test(VIDEO_SRC);

        if (isSupportedAudio) {
            player.src = VIDEO_SRC;
        } else if (isUnsupportedAudio) {
            player.src = { src: VIDEO_SRC, type: 'audio/mp3' };
        } else {
            player.src = { src: VIDEO_SRC, type: 'video/mp4' };
        }

        // In case the <video> already exists by the time src is set.
        const el = stage?.querySelector('video');
        if (el) onVideoReady(el);
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
    backBtn?.addEventListener('click', () => {
        if (window.history.length > 1) window.history.back();
        else window.location.href = '/';
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
    // ═══════════════════════════════════════════
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

    speedBtn?.addEventListener('click', () => {
        renderSpeedOptions();
        openSheet(speedSheet);
    });

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
                const offBtn = document.createElement('button');
                offBtn.className = 'sheet-option selected';
                offBtn.textContent = 'Off';
                offBtn.addEventListener('click', () => {
                    if (video) {
                        Array.from(video.textTracks || []).forEach((t) => { t.mode = 'disabled'; });
                    }
                    syncSelectedOption(subtitleOptions, offBtn);
                    closeSheets();
                });
                subtitleOptions.appendChild(offBtn);

                subtitleTracks.forEach((track, index) => {
                    const hasLanguage = track.language && track.language !== 'und';
                    const label = track.name || (hasLanguage ? track.language.toUpperCase() : `Track ${index + 1}`);
                    const btn = document.createElement('button');
                    btn.className = 'sheet-option';
                    btn.textContent = label;
                    btn.addEventListener('click', () => {
                        const trackEl = ensureSubtitleAdded(track, index);
                        if (video) {
                            Array.from(video.textTracks || []).forEach((t) => {
                                t.mode = (trackEl && t.label === trackEl.label) ? 'showing' : 'disabled';
                            });
                        }
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

    tracksBtn?.addEventListener('click', () => {
        renderTrackSheets();
        openSheet(tracksSheet);
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
                try {
                    if (document.fullscreenElement) document.exitFullscreen();
                    else stage?.requestFullscreen?.();
                } catch { /* ignore */ }
                break;
            case 'm':
                try { if (video) video.muted = !video.muted; } catch { /* ignore */ }
                break;
            case 'Escape':
                closeSheets();
                break;
        }
    });
})();
