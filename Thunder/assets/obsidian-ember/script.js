(() => {
    'use strict';

    // ═══════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════
    const VIDEO_SRC = window.__CINEMA_CONFIG__?.src || '';
    const THEME_KEY = 'theme-preference';

    // ═══════════════════════════════════════════
    // DOM ELEMENTS
    // ═══════════════════════════════════════════
    const player = document.getElementById('player');
    const copyBtn = document.getElementById('copyBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const playersToggle = document.getElementById('playersToggle');
    const drawerPanel = document.getElementById('drawerPanel');
    const toastStack = document.getElementById('toastStack');
    const keyboardHints = document.getElementById('keyboardHints');
    const themeToggle = document.getElementById('themeToggle');
    const metaDuration = document.getElementById('metaDuration');
    const metaResolution = document.getElementById('metaResolution');

    // ═══════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════
    const formatTime = (secs, showHrs = false) => {
        if (isNaN(secs) || secs < 0) return showHrs ? '0:00:00' : '0:00';
        secs = Math.round(secs);
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        return (showHrs || h > 0)
            ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
            : `${m}:${s.toString().padStart(2, '0')}`;
    };

    // ═══════════════════════════════════════════
    // VIDEO METADATA
    // ═══════════════════════════════════════════
    const initVideoMetadata = () => {
        if (!player) return;

        let resolutionSet = false;

        // Use Vidstack's subscribe API for reactive state access
        player.subscribe(({ duration }) => {
            // Update duration
            if (metaDuration && !isNaN(duration) && duration > 0) {
                const formattedDuration = formatTime(duration, duration >= 3600);
                const span = metaDuration.querySelector('span');
                if (span) span.textContent = formattedDuration;
                metaDuration.classList.add('loaded');
            }
        });

        // Get native video resolution from the underlying video element
        // Vidstack uses kebab-case events: 'loaded-metadata' not 'loadedmetadata'
        player.addEventListener('loaded-metadata', (event) => {
            if (resolutionSet) return;

            // Access video element from event trigger target (per Vidstack docs)
            const target = event.trigger?.target;
            if (target instanceof HTMLVideoElement && target.videoWidth > 0 && target.videoHeight > 0) {
                const span = metaResolution?.querySelector('span');
                if (span) span.textContent = `${target.videoWidth}×${target.videoHeight}`;
                metaResolution?.classList.add('loaded');
                resolutionSet = true;
            }
        });
    };

    // Initialize when player is ready
    if (player) {
        // Wait for custom element to be defined
        customElements.whenDefined('media-player').then(() => {
            // ═══════════════════════════════════════════
            // SMART MIME TYPE HANDLING
            // ═══════════════════════════════════════════
            // Force 'video/mp4' for non-audio files to enable MKV/container playback
            // via browser content sniffing.
            const isSupportedAudio = /\.(mp3|wav|ogg|flac|m4a|aac)(\?.*)?$/i.test(VIDEO_SRC);
            const isUnsupportedAudio = /\.(wma|ac3|dts|aif|aiff|alac)(\?.*)?$/i.test(VIDEO_SRC);

            if (isSupportedAudio) {
                player.src = VIDEO_SRC;
            } else if (isUnsupportedAudio) {
                player.src = { src: VIDEO_SRC, type: 'audio/mp3' };
            } else {
                player.src = { src: VIDEO_SRC, type: 'video/mp4' };
            }

            initVideoMetadata();
        });
    }

    // ═══════════════════════════════════════════
    // THEME SYSTEM
    // ═══════════════════════════════════════════
    const getSystemTheme = () => {
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    };

    const getSavedTheme = () => {
        return localStorage.getItem(THEME_KEY);
    };

    const setTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_KEY, theme);
    };

    const initTheme = () => {
        const saved = getSavedTheme();
        const theme = saved || getSystemTheme();
        setTheme(theme);
    };

    const toggleTheme = () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        setTheme(next);
    };

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (!getSavedTheme()) {
            setTheme(e.matches ? 'light' : 'dark');
        }
    });

    themeToggle?.addEventListener('click', toggleTheme);

    // ═══════════════════════════════════════════
    // PLATFORM DETECTION
    // ═══════════════════════════════════════════
    const detectPlatform = () => {
        const ua = navigator.userAgent;
        const isAndroid = /android/i.test(ua);
        const isIOS = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
        const isMobile = isAndroid || isIOS;
        const isMac = /macintosh|mac os x/i.test(ua) && !isIOS;
        const isWindows = /windows/i.test(ua);

        const androidGroup = document.getElementById('androidGroup');
        const iosGroup = document.getElementById('iosGroup');
        const desktopGroup = document.getElementById('desktopGroup');

        if (isAndroid) {
            iosGroup?.remove();
            desktopGroup?.remove();
        } else if (isIOS) {
            androidGroup?.remove();
            desktopGroup?.remove();
        } else {
            // Desktop: remove mobile groups
            androidGroup?.remove();
            iosGroup?.remove();

            // Filter desktop players based on OS
            if (desktopGroup) {
                desktopGroup.querySelectorAll('.player-link').forEach(link => {
                    const os = link.dataset.os;
                    if ((os === 'mac' && !isMac) || (os === 'windows' && !isWindows)) {
                        link.remove();
                    }
                });
            }
        }

        if (isMobile) {
            keyboardHints?.remove();
        }
    };

    // ═══════════════════════════════════════════
    // TOAST NOTIFICATIONS
    // ═══════════════════════════════════════════
    const showToast = (message, type = 'default') => {
        if (!toastStack) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toastStack.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toastExit 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    };

    // ═══════════════════════════════════════════
    // DRAWER TOGGLE
    // ═══════════════════════════════════════════
    playersToggle?.addEventListener('click', () => {
        const isExpanded = playersToggle.getAttribute('aria-expanded') === 'true';
        playersToggle.setAttribute('aria-expanded', String(!isExpanded));
        drawerPanel?.classList.toggle('open');
    });

    // ═══════════════════════════════════════════
    // COPY LINK
    // ═══════════════════════════════════════════
    copyBtn?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(VIDEO_SRC);
            showToast('Link copied', 'success');
        } catch {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = VIDEO_SRC;
            ta.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                showToast('Link copied', 'success');
            } catch {
                showToast('Failed to copy', 'error');
            }
            ta.remove();
        }
    });

    // ═══════════════════════════════════════════
    // DOWNLOAD FEEDBACK
    // ═══════════════════════════════════════════
    downloadBtn?.addEventListener('click', () => {
        showToast('Download started', 'success');
    });

    // ═══════════════════════════════════════════
    // COPYRIGHT YEAR
    // ═══════════════════════════════════════════
    const initCopyright = () => {
        const yearSpan = document.getElementById('copyrightYear');
        if (yearSpan) {
            yearSpan.textContent = new Date().getFullYear();
        }
    };

    // ═══════════════════════════════════════════
    // FIX ANDROID INTENT LINKS
    // ═══════════════════════════════════════════
    const fixAndroidIntentLinks = () => {
        // Android intent:// scheme expects URL without protocol
        // e.g., intent://example.com/video.mkv#Intent;...
        // NOT intent://https://example.com/video.mkv#Intent;...
        const androidGroup = document.getElementById('androidGroup');
        if (!androidGroup) return;

        const srcWithoutProtocol = VIDEO_SRC.replace(/^https?:\/\//, '');

        androidGroup.querySelectorAll('a.player-link').forEach(link => {
            const href = link.getAttribute('href');
            if (href && href.startsWith('intent://')) {
                // Replace the incorrectly embedded full URL with protocol-less version
                const fixedHref = href.replace(VIDEO_SRC, srcWithoutProtocol);
                link.setAttribute('href', fixedHref);
            }
        });
    };

    // ═══════════════════════════════════════════
    // WATERMARK
    // ═══════════════════════════════════════════
    const initWatermark = () => {
        const watermark = document.createElement('div');
        watermark.textContent = 'Thunder FileToLink';
        Object.assign(watermark.style, {
            position: 'fixed',
            bottom: '12px',
            right: '24px',
            fontFamily: 'var(--font-display)',
            fontSize: '10px',
            fontWeight: '600',
            letterSpacing: '0.05em',
            color: 'var(--pearl)',
            opacity: '0.5',
            pointerEvents: 'none',
            zIndex: '9999',
            userSelect: 'none',
            textShadow: '0 1px 2px rgba(0,0,0,0.1)'
        });
        document.body.appendChild(watermark);
    };

    // ═══════════════════════════════════════════
    // INITIALIZE
    // ═══════════════════════════════════════════
    initTheme();
    fixAndroidIntentLinks();
    detectPlatform();
    initCopyright();
    initWatermark();
})();
