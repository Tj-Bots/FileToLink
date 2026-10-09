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
        allSheets.forEach((s) => { s.hidden = true; });
        if (sheetBackdrop) sheetBackdrop.hidden = true;
    };

    const openSheet = (sheet) => {
        closeSheets();
        if (!sheet) return;
        sheet.hidden = false;
        if (sheetBackdrop) sheetBackdrop.hidden = false;
    };

    sheetBackdrop?.addEventListener('click', closeSheets);

    // ═══════════════════════════════════════════
    // PLAYER WIRING
    // ═══════════════════════════════════════════
    if (!player) return;

    let duration = 0;
    let userSeeking = false;

    const setPlayButtonState = ({ paused, waiting, ended }) => {
        const showSpinner = !!waiting;
        const showPause = !paused && !showSpinner && !ended;
        if (iconPlay) iconPlay.hidden = showPause || showSpinner;
        if (iconPause) iconPause.hidden = !showPause;
        if (iconSpinner) iconSpinner.hidden = !showSpinner;
    };

    const togglePlay = () => {
        try {
            if (player.paused) {
                const p = player.play();
                p?.catch?.(() => {});
            } else {
                player.pause();
            }
        } catch {
            // Ignore - player may not be ready yet.
        }
    };

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

        player.subscribe((state) => {
            duration = state.duration || 0;
            if (timeDuration) timeDuration.textContent = formatTime(duration);
            if (!userSeeking && seekBar && duration > 0) {
                const pct = Math.min(1000, Math.max(0, (state.currentTime / duration) * 1000));
                seekBar.value = String(pct);
                seekBar.style.setProperty('--fill', `${pct / 10}%`);
            }
            if (!userSeeking && timeCurrent) {
                timeCurrent.textContent = formatTime(state.currentTime || 0);
            }
            setPlayButtonState(state);

            if (state.error && bgMessage) {
                bgMessage.hidden = false;
            }

            if (speedLabel) {
                const rate = state.playbackRate || 1;
                speedLabel.textContent = rate === 1 ? '1x' : `${rate}x`;
            }
        });

        initTracks();
    });

    // ═══════════════════════════════════════════
    // CONTROLS VISIBILITY (auto-hide)
    // ═══════════════════════════════════════════
    let hideTimer = null;
    const showControls = () => {
        stage?.removeAttribute('data-hidden');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (!player.paused) stage?.setAttribute('data-hidden', '');
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
        const video = stage?.querySelector('video');
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

    const seekBy = (delta) => {
        try {
            const t = (player.currentTime || 0) + delta;
            player.currentTime = Math.min(duration || Infinity, Math.max(0, t));
        } catch {
            // Ignore.
        }
        showControls();
    };

    seekBackBtn?.addEventListener('click', (e) => { e.stopPropagation(); seekBy(-10); });
    seekFwdBtn?.addEventListener('click', (e) => { e.stopPropagation(); seekBy(10); });

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
        if (duration > 0) {
            try {
                player.currentTime = (Number(seekBar.value) / 1000) * duration;
            } catch {
                // Ignore.
            }
        }
        userSeeking = false;
    });

    // ═══════════════════════════════════════════
    // SIDE SLIDERS: brightness / volume
    // ═══════════════════════════════════════════
    brightnessSlider?.addEventListener('input', () => {
        const video = stage?.querySelector('video');
        if (video) video.style.filter = `brightness(${brightnessSlider.value}%)`;
        showControls();
    });

    volumeSlider?.addEventListener('input', () => {
        const val = Number(volumeSlider.value);
        try {
            player.volume = val / 100;
            player.muted = val === 0;
        } catch {
            // Ignore.
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
        const current = player.playbackRate || 1;
        speedOptions.innerHTML = '';
        SPEEDS.forEach((rate) => {
            const btn = document.createElement('button');
            btn.className = 'sheet-option' + (rate === current ? ' selected' : '');
            btn.textContent = rate === 1 ? 'Normal (1x)' : `${rate}x`;
            btn.addEventListener('click', () => {
                try { player.playbackRate = rate; } catch { /* ignore */ }
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
                        try { player.pause(); } catch { /* ignore */ }
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
        if (unlockBtn) unlockBtn.hidden = false;
    });

    unlockBtn?.addEventListener('click', () => {
        stage?.removeAttribute('data-locked');
        if (unlockBtn) unlockBtn.hidden = true;
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
                    Array.from(player.textTracks || []).forEach((t) => {
                        if (t.kind === 'subtitles' || t.kind === 'captions') t.mode = 'disabled';
                    });
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
                        ensureSubtitleAdded(track, index);
                        Array.from(player.textTracks || []).forEach((t) => {
                            if (t.kind === 'subtitles' || t.kind === 'captions') {
                                t.mode = (t.language === track.language && t.label === label) ? 'showing' : 'disabled';
                            }
                        });
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

    const addedSubtitles = new Set();

    const ensureSubtitleAdded = (track, index) => {
        const key = `${track.number}`;
        if (addedSubtitles.has(key)) return;
        const subUrl = deriveAuxUrl('subtitle');
        if (!subUrl || track.number == null) return;
        subUrl.searchParams.set('track', track.number);
        const hasLanguage = track.language && track.language !== 'und';
        const label = track.name || (hasLanguage ? track.language.toUpperCase() : `Track ${index + 1}`);
        try {
            player.textTracks.add({
                src: subUrl.toString(),
                kind: 'subtitles',
                label,
                language: hasLanguage ? track.language : undefined,
                type: 'vtt',
            });
            addedSubtitles.add(key);
        } catch {
            // Fail quietly — surfaced tracks just won't be selectable.
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
                try { player.muted = !player.muted; } catch { /* ignore */ }
                break;
            case 'Escape':
                closeSheets();
                break;
        }
    });
})();
