/* ============================================================
   UI — World News Map Viewer
   Handles DOM interactions and panel updates.
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.ui = (function() {
  const TRANSLATE_STORAGE_KEY = 'newsatlas:translate-language';
  const DISPLAY_SETTINGS_STORAGE_KEY = 'newsatlas:display-settings';
  const TRANSLATE_LANGUAGES = ['ja', 'ko', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt', 'ar', 'hi', 'ru'];
  const DEBUG_KONAMI_CODE = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a'];
  const DEBUG_LOG_LIMIT = 80;
  const DEFAULT_DISPLAY_SETTINGS = {
    theme: 'dark',
    showSunlight: true,
    showTimezoneGrid: true
  };
  const LICENSE_SECTIONS = [
    {
      id: 'oss',
      label: 'Open-Source Libraries',
      items: [
        {
          name: 'MapLibre GL JS',
          version: 'v3.6.2',
          badge: 'BSD-3-Clause',
          accent: 'blue',
          description: 'Interactive map rendering engine loaded from unpkg.',
          usage: 'Used for the map canvas, popups, navigation controls, and map interactions.',
          url: 'https://maplibre.org/maplibre-gl-js/docs/'
        }
      ]
    },
    {
      id: 'map-data',
      label: 'Basemap & Geographic Data',
      items: [
        {
          name: 'OpenStreetMap Contributors',
          version: 'Map Data',
          badge: 'ODbL 1.0',
          accent: 'green',
          description: 'Underlying geographic data used through the basemap attribution chain.',
          usage: 'Credited for the base map data shown beneath event overlays.',
          url: 'https://www.openstreetmap.org/copyright'
        },
        {
          name: 'CARTO Basemaps',
          version: 'Raster Tiles',
          badge: 'Attribution',
          accent: 'orange',
          description: 'Dark raster basemap tiles served from the CARTO CDN.',
          usage: 'Used as the visual world map style behind the event layers.',
          url: 'https://carto.com/attributions'
        }
      ]
    },
    {
      id: 'feeds',
      label: 'Data Sources & Terms',
      items: [
        {
          name: 'GDELT Project',
          version: 'Live Refresh',
          badge: 'Data Terms',
          accent: 'violet',
          description: 'Browser refresh mode pulls live event data from the GDELT DOC API.',
          usage: 'Used when the refresh button requests live updates instead of static snapshots.',
          url: 'https://www.gdeltproject.org/'
        },
        {
          name: 'Public RSS Publishers',
          version: 'News Feeds',
          badge: 'Publisher Rights',
          accent: 'red',
          description: 'Static snapshots are built from public RSS feeds such as BBC, Al Jazeera, DW, France 24, The Guardian, NPR, VOA, ABC, Euronews, and HNRSS.',
          usage: 'Original article copyrights remain with each publisher. This app stores headlines, summaries, and source links for aggregation.',
          url: ''
        }
      ]
    }
  ];

  // Cached DOM element references
  const el = {};
  let _licenseMenuOpen = false;
  let _translateScriptRequested = false;
  let _translateReadyPromise = null;
  let _translateRefreshTimer = null;
  let _translateFallbackUrl = '';
  let _translateChromeObserver = null;
  let _displaySettingsOpen = false;
  let _displaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
  let _debugConsoleOpen = false;
  let _clockTimer = null;
  let _debugConsoleTimer = null;
  let _debugKonamiIndex = 0;
  let _debugConsoleHooked = false;
  let _debugPopupWindow = null;
  const _debugLogEntries = [];

  /* ── Init ──────────────────────────────────────────────────── */

  function init() {
    el.header         = document.getElementById('header');
    el.leftPanel      = document.getElementById('left-panel');
    el.rightPanel     = document.getElementById('right-panel');
    el.searchInput    = document.getElementById('search-input');
    el.languageSelect = document.getElementById('language-select');
    el.displaySettings = document.getElementById('display-settings');
    el.displaySettingsToggle = document.getElementById('display-settings-toggle');
    el.displaySettingsMenu = document.getElementById('display-settings-menu');
    el.displaySettingsClose = document.getElementById('display-settings-close');
    el.displayThemeButtons = document.querySelectorAll('.display-theme-btn');
    el.sunlightToggle = document.getElementById('sunlight-toggle');
    el.timezoneGridToggle = document.getElementById('timezone-grid-toggle');
    el.clockUtcValue = document.getElementById('clock-utc-value');
    el.clockJstValue = document.getElementById('clock-jst-value');
    el.modeButtons    = document.querySelectorAll('.mode-btn');
    el.timeButtons    = document.querySelectorAll('.time-btn');
    el.categoryChips  = document.querySelectorAll('.category-chip');
    el.statusBadge    = document.getElementById('status-badge');
    el.updateTime     = document.getElementById('update-time');
    el.leftContent    = document.getElementById('left-content');
    el.nonGeotagButton = document.getElementById('non-geotag-btn');
    el.nonGeotagCount = document.getElementById('non-geotag-count');
    el.rightContent   = document.getElementById('right-content');
    el.mobileDrawer   = document.getElementById('mobile-drawer');
    el.drawerContent  = document.getElementById('drawer-content');
    el.licenseWidget  = document.getElementById('map-license');
    el.licenseMenu    = document.getElementById('license-menu');
    el.licenseMenuBody = document.getElementById('license-menu-body');
    el.licenseClose   = document.getElementById('license-close');
    el.translateFallback = document.getElementById('translate-fallback');
    el.translateFallbackText = document.getElementById('translate-fallback-text');
    el.translateFallbackOpen = document.getElementById('translate-fallback-open');
    el.translateFallbackClose = document.getElementById('translate-fallback-close');
    el.debugConsole = document.getElementById('debug-console');
    el.debugSummary = document.getElementById('debug-summary');
    el.debugJson = document.getElementById('debug-json');
    el.debugLog = document.getElementById('debug-log');
    el.debugCopy = document.getElementById('debug-copy');
    el.debugRefresh = document.getElementById('debug-refresh');
    el.debugClose = document.getElementById('debug-close');

    renderLicenseMenu();
    initDisplaySettings();
    initClocks();
    protectInteractiveControlsFromTranslation();
    initDebugConsole();
    initGoogleTranslate();
    bindEvents();
  }

  /* ── Event Bindings ──────────────────────────────────────── */

  function bindEvents() {
    // Mode buttons
    el.modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        setActiveMode(mode);
        NewsAtlas.app.onModeChange(mode);
      });
    });

    if (el.nonGeotagButton) {
      el.nonGeotagButton.addEventListener('click', () => {
        setActiveMode('non-geotag');
        NewsAtlas.app.onModeChange('non-geotag');
      });
    }

    // Time filter buttons
    el.timeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const time = btn.dataset.time;
        setActiveTime(time);
        NewsAtlas.app.onTimeChange(time);
      });
    });

    // Category chips
    el.categoryChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const cat = chip.dataset.category;
        toggleCategory(chip, cat);
        NewsAtlas.app.onCategoryChange(NewsAtlas.app.getState().categoryFilters);
      });
    });

    // Search input
    if (el.searchInput) {
      el.searchInput.addEventListener('input',
        NewsAtlas.utils.debounce(e => {
          NewsAtlas.app.onSearchChange(e.target.value);
        }, 300)
      );
    }

    if (el.languageSelect) {
      el.languageSelect.addEventListener('change', (e) => {
        applyTranslationLanguage(e.target.value);
      });
    }

    if (el.displaySettingsToggle) {
      el.displaySettingsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setDisplaySettingsOpen(!_displaySettingsOpen);
      });
    }

    if (el.displaySettingsClose) {
      el.displaySettingsClose.addEventListener('click', () => setDisplaySettingsOpen(false));
    }

    if (el.displaySettingsMenu) {
      el.displaySettingsMenu.addEventListener('click', (e) => e.stopPropagation());
    }

    if (el.displayThemeButtons && el.displayThemeButtons.length) {
      el.displayThemeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          updateDisplaySettings({ theme: btn.dataset.theme || 'dark' });
        });
      });
    }

    if (el.sunlightToggle) {
      el.sunlightToggle.addEventListener('change', (e) => {
        updateDisplaySettings({ showSunlight: Boolean(e.target.checked) });
      });
    }

    if (el.timezoneGridToggle) {
      el.timezoneGridToggle.addEventListener('change', (e) => {
        updateDisplaySettings({ showTimezoneGrid: Boolean(e.target.checked) });
      });
    }

    if (el.translateFallbackOpen) {
      el.translateFallbackOpen.addEventListener('click', () => {
        if (_translateFallbackUrl) window.location.href = _translateFallbackUrl;
      });
    }

    if (el.translateFallbackClose) {
      el.translateFallbackClose.addEventListener('click', hideTranslateFallback);
    }

    if (el.debugCopy) {
      el.debugCopy.addEventListener('click', copyDebugSnapshot);
    }

    if (el.debugRefresh) {
      el.debugRefresh.addEventListener('click', renderDebugConsole);
    }

    if (el.debugClose) {
      el.debugClose.addEventListener('click', () => setDebugConsoleOpen(false));
    }

    if (el.debugConsole) {
      el.debugConsole.addEventListener('click', (e) => {
        if (e.target === el.debugConsole) setDebugConsoleOpen(false);
      });
    }

    // Mobile panel toggles
    const leftToggle  = document.getElementById('toggle-left');
    const rightToggle = document.getElementById('toggle-right');
    if (leftToggle)  leftToggle.addEventListener('click',  () => togglePanel('left'));
    if (rightToggle) rightToggle.addEventListener('click', () => togglePanel('right'));

    // Drawer close button
    const drawerClose = document.getElementById('drawer-close');
    if (drawerClose) drawerClose.addEventListener('click', closeDrawer);

    if (el.licenseClose) {
      el.licenseClose.addEventListener('click', () => setLicenseMenuOpen(false));
    }

    if (el.licenseMenu) {
      el.licenseMenu.addEventListener('click', (e) => e.stopPropagation());
    }

    if (el.translateFallback) {
      el.translateFallback.addEventListener('click', (e) => {
        if (e.target === el.translateFallback) hideTranslateFallback();
      });
    }

    // Close drawer when clicking the overlay backdrop (outside drawer)
    if (el.mobileDrawer) {
      el.mobileDrawer.addEventListener('click', (e) => {
        if (e.target === el.mobileDrawer) closeDrawer();
      });
    }

    // Keyboard shortcut: Escape closes drawer
    document.addEventListener('keydown', (e) => {
      trackDebugKonamiCode(e);
      if (e.key === 'Escape') {
        closeDrawer();
        setLicenseMenuOpen(false);
        setDisplaySettingsOpen(false);
        hideTranslateFallback();
        setDebugConsoleOpen(false);
      }
    });

    document.addEventListener('click', (e) => {
      if (!_licenseMenuOpen || !el.licenseWidget) return;
      if (!el.licenseWidget.contains(e.target)) {
        setLicenseMenuOpen(false);
      }
    });

    document.addEventListener('click', (e) => {
      if (!_displaySettingsOpen || !el.displaySettings) return;
      if (!el.displaySettings.contains(e.target)) {
        setDisplaySettingsOpen(false);
      }
    });

    // Refresh button (manual GDELT browser fetch)
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        if (NewsAtlas.app) NewsAtlas.app.onRefresh();
      });
    }

    // Map legend toggle
    const legendToggle = document.getElementById('legend-toggle');
    if (legendToggle) {
      legendToggle.addEventListener('click', () => {
        const body  = document.getElementById('legend-body');
        const arrow = legendToggle.querySelector('.legend-arrow');
        if (body) body.classList.toggle('collapsed');
        if (arrow) arrow.textContent = body && body.classList.contains('collapsed') ? '▸' : '▾';
      });
    }

    // Populate legend category dots (requires renderers to be loaded)
    const legendCatsEl = document.getElementById('legend-cats');
    if (legendCatsEl && NewsAtlas.renderers) {
      legendCatsEl.innerHTML = NewsAtlas.renderers.legendCatsHTML();
    }
  }

  function renderLicenseMenu() {
    if (!el.licenseMenuBody) return;

    el.licenseMenuBody.innerHTML = LICENSE_SECTIONS.map(section => `
      <section class="license-section">
        <div class="license-section-label">${NewsAtlas.utils.escapeHtml(section.label)}</div>
        <div class="license-card-list">
          ${section.items.map(item => `
            <article class="license-card ${NewsAtlas.utils.escapeHtml(item.accent)}">
              <div class="license-card-top">
                <div>
                  <div class="license-card-name">${NewsAtlas.utils.escapeHtml(item.name)}</div>
                  <div class="license-card-version">${NewsAtlas.utils.escapeHtml(item.version)}</div>
                </div>
                <span class="license-card-badge">${NewsAtlas.utils.escapeHtml(item.badge)}</span>
              </div>
              <p class="license-card-description">${NewsAtlas.utils.escapeHtml(item.description)}</p>
              <p class="license-card-usage">${NewsAtlas.utils.escapeHtml(item.usage)}</p>
              ${item.url ? `
                <a
                  class="license-card-link"
                  href="${NewsAtlas.utils.escapeHtml(item.url)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View source
                </a>
              ` : '<span class="license-card-link muted">See source-specific terms</span>'}
            </article>
          `).join('')}
        </div>
      </section>
    `).join('');
  }

  function setLicenseMenuOpen(open) {
    _licenseMenuOpen = Boolean(open);

    if (el.licenseWidget) {
      el.licenseWidget.classList.toggle('open', _licenseMenuOpen);
    }

    if (el.licenseToggle) {
      el.licenseToggle.setAttribute('aria-expanded', String(_licenseMenuOpen));
    }

    if (el.licenseMenu) {
      el.licenseMenu.setAttribute('aria-hidden', String(!_licenseMenuOpen));
    }
  }

  function registerLicenseControl(buttonEl) {
    if (!buttonEl) return;

    el.licenseToggle = buttonEl;
    el.licenseToggle.setAttribute('aria-expanded', String(_licenseMenuOpen));
    el.licenseToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setLicenseMenuOpen(!_licenseMenuOpen);
    });
  }

  function initDisplaySettings() {
    _displaySettings = loadDisplaySettings();
    applyTheme(_displaySettings.theme, true);
    syncDisplaySettingsControls();
  }

  function initClocks() {
    renderClocks();
    window.clearInterval(_clockTimer);
    _clockTimer = window.setInterval(renderClocks, 1000);
  }

  function formatZoneTime(timeZone) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(new Date());
    } catch (_) {
      return '--:--:--';
    }
  }

  function renderClocks() {
    if (el.clockUtcValue) {
      el.clockUtcValue.textContent = formatZoneTime('UTC');
    }
    if (el.clockJstValue) {
      el.clockJstValue.textContent = formatZoneTime('Asia/Tokyo');
    }
  }

  function loadDisplaySettings() {
    try {
      const raw = window.localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_DISPLAY_SETTINGS };
      const parsed = JSON.parse(raw);
      return {
        theme: parsed && parsed.theme === 'light' ? 'light' : 'dark',
        showSunlight: parsed && typeof parsed.showSunlight === 'boolean'
          ? parsed.showSunlight
          : DEFAULT_DISPLAY_SETTINGS.showSunlight,
        showTimezoneGrid: parsed && typeof parsed.showTimezoneGrid === 'boolean'
          ? parsed.showTimezoneGrid
          : DEFAULT_DISPLAY_SETTINGS.showTimezoneGrid
      };
    } catch (_) {
      return { ...DEFAULT_DISPLAY_SETTINGS };
    }
  }

  function saveDisplaySettings() {
    try {
      window.localStorage.setItem(DISPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(_displaySettings));
    } catch (_) {}
  }

  function getDisplaySettings() {
    return { ..._displaySettings };
  }

  function updateDisplaySettings(nextSettings) {
    const nextTheme = nextSettings && (nextSettings.theme === 'light' || nextSettings.theme === 'dark')
      ? nextSettings.theme
      : _displaySettings.theme;
    _displaySettings = {
      ..._displaySettings,
      ...nextSettings,
      theme: nextTheme || 'dark',
      showSunlight: nextSettings && typeof nextSettings.showSunlight === 'boolean'
        ? nextSettings.showSunlight
        : _displaySettings.showSunlight,
      showTimezoneGrid: nextSettings && typeof nextSettings.showTimezoneGrid === 'boolean'
        ? nextSettings.showTimezoneGrid
        : _displaySettings.showTimezoneGrid
    };

    saveDisplaySettings();
    applyTheme(_displaySettings.theme);
    syncDisplaySettingsControls();

    if (NewsAtlas.map && NewsAtlas.map.refreshSunlightOverlay) {
      NewsAtlas.map.refreshSunlightOverlay();
    }
    if (NewsAtlas.map && NewsAtlas.map.refreshTimezoneGrid) {
      NewsAtlas.map.refreshTimezoneGrid();
    }

    if (NewsAtlas.app && NewsAtlas.app.refreshView) {
      NewsAtlas.app.refreshView();
    }
  }

  function syncDisplaySettingsControls() {
    if (el.displaySettingsToggle) {
      el.displaySettingsToggle.setAttribute('aria-expanded', String(_displaySettingsOpen));
    }
    if (el.displaySettings) {
      el.displaySettings.classList.toggle('open', _displaySettingsOpen);
    }
    if (el.displaySettingsMenu) {
      el.displaySettingsMenu.setAttribute('aria-hidden', String(!_displaySettingsOpen));
    }
    if (el.displayThemeButtons && el.displayThemeButtons.length) {
      el.displayThemeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === _displaySettings.theme);
      });
    }
    if (el.sunlightToggle) {
      el.sunlightToggle.checked = Boolean(_displaySettings.showSunlight);
    }
    if (el.timezoneGridToggle) {
      el.timezoneGridToggle.checked = Boolean(_displaySettings.showTimezoneGrid);
    }
  }

  function setDisplaySettingsOpen(open) {
    _displaySettingsOpen = Boolean(open);
    syncDisplaySettingsControls();
  }

  function applyTheme(theme, skipRenderSync) {
    const resolvedTheme = theme === 'light' ? 'light' : 'dark';
    _displaySettings.theme = resolvedTheme;

    document.documentElement.dataset.theme = resolvedTheme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute('content', resolvedTheme === 'light' ? '#eef3fb' : '#0d1117');
    }

    if (NewsAtlas.map && NewsAtlas.map.setTheme) {
      NewsAtlas.map.setTheme(resolvedTheme);
    }
    if (NewsAtlas.map && NewsAtlas.map.refreshSunlightOverlay) {
      NewsAtlas.map.refreshSunlightOverlay();
    }
    if (NewsAtlas.map && NewsAtlas.map.refreshTimezoneGrid) {
      NewsAtlas.map.refreshTimezoneGrid();
    }

    if (!skipRenderSync && _debugConsoleOpen) {
      renderDebugConsole();
    }
  }

  function initGoogleTranslate() {
    const savedLanguage = getStoredLanguage();
    startTranslateChromeSuppression();

    if (el.languageSelect) {
      el.languageSelect.value = savedLanguage;
    }

    if (window.google && window.google.translate && window.google.translate.TranslateElement) {
      mountGoogleTranslate();
      return;
    }

    if (_translateScriptRequested) return;
    _translateScriptRequested = true;

    window.googleTranslateElementInit = mountGoogleTranslate;

    const script = document.createElement('script');
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    script.onerror = () => {
      showTranslateFallback('Google Translate could not be loaded in-page.');
    };
    document.head.appendChild(script);
  }

  function mountGoogleTranslate() {
    const host = document.getElementById('google_translate_element');
    if (!host || !(window.google && window.google.translate && window.google.translate.TranslateElement)) return;

    host.innerHTML = '';

    try {
      new window.google.translate.TranslateElement({
        pageLanguage: 'en',
        autoDisplay: false,
        includedLanguages: TRANSLATE_LANGUAGES.join(',')
      }, 'google_translate_element');

      _translateReadyPromise = waitForTranslateCombo().catch(err => {
        _translateReadyPromise = null;
        throw err;
      });
      const savedLanguage = getStoredLanguage();
      if (savedLanguage) {
        window.setTimeout(() => {
          applyTranslationLanguage(savedLanguage, true);
        }, 150);
      }
    } catch (_) {
      showTranslateFallback('Google Translate could not be initialized in-page.');
    }
  }

  async function applyTranslationLanguage(language, silent) {
    hideTranslateFallback();
    storeLanguage(language);

    if (!language) {
      clearTranslateState();
      window.location.reload();
      return;
    }

    try {
      const combo = await getTranslateCombo();
      if (!combo) throw new Error('combo-unavailable');
      combo.value = language;
      combo.dispatchEvent(new Event('change', { bubbles: true }));
      combo.dispatchEvent(new Event('input', { bubbles: true }));
      window.setTimeout(suppressTranslateChrome, 60);
      window.setTimeout(suppressTranslateChrome, 240);
      if (el.languageSelect) {
        el.languageSelect.title = '';
      }
      if (!silent && el.languageSelect) {
        el.languageSelect.blur();
      }
    } catch (_) {
      showTranslateFallback('Inline translation could not start. You can open the Google-translated page instead.', language);
    }
  }

  function getStoredLanguage() {
    try {
      return window.localStorage.getItem(TRANSLATE_STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function storeLanguage(language) {
    try {
      if (language) {
        window.localStorage.setItem(TRANSLATE_STORAGE_KEY, language);
      } else {
        window.localStorage.removeItem(TRANSLATE_STORAGE_KEY);
      }
    } catch (_) {}
  }

  function clearTranslateState() {
    document.cookie = 'googtrans=;path=/;max-age=0';
    document.cookie = 'googtrans=;domain=' + window.location.hostname + ';path=/;max-age=0';
  }

  function waitForTranslateCombo(timeoutMs) {
    const timeout = typeof timeoutMs === 'number' ? timeoutMs : 5000;

    return new Promise((resolve, reject) => {
      const start = Date.now();

      const poll = () => {
        const combo = document.querySelector('.goog-te-combo');
        if (combo) {
          resolve(combo);
          return;
        }

        if (Date.now() - start >= timeout) {
          reject(new Error('translate-combo-timeout'));
          return;
        }

        window.setTimeout(poll, 120);
      };

      poll();
    });
  }

  function getTranslateCombo() {
    if (document.querySelector('.goog-te-combo')) {
      return Promise.resolve(document.querySelector('.goog-te-combo'));
    }

    if (_translateReadyPromise) return _translateReadyPromise;

    _translateReadyPromise = waitForTranslateCombo().catch(err => {
      _translateReadyPromise = null;
      throw err;
    });
    return _translateReadyPromise;
  }

  function scheduleTranslationRefresh() {
    const currentLanguage = getStoredLanguage();
    if (!currentLanguage) return;

    window.clearTimeout(_translateRefreshTimer);
    _translateRefreshTimer = window.setTimeout(() => {
      protectInteractiveControlsFromTranslation();
      suppressTranslateChrome();
      getTranslateCombo()
        .then(combo => {
          if (!combo) return;
          combo.value = currentLanguage;
          combo.dispatchEvent(new Event('change', { bubbles: true }));
          window.setTimeout(suppressTranslateChrome, 60);
        })
        .catch(() => {});
    }, 220);
  }

  function protectInteractiveControlsFromTranslation(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('input, textarea, select, option, [contenteditable="true"]').forEach(node => {
      node.classList.add('notranslate');
      node.setAttribute('translate', 'no');
    });
  }

  function showTranslateFallback(message, language) {
    _translateFallbackUrl = buildGoogleTranslateUrl(language || getStoredLanguage());
    const canOpenExternal = canOpenGoogleTranslateFallback();

    if (el.languageSelect) {
      el.languageSelect.title = message;
    }

    if (el.translateFallbackText) {
      el.translateFallbackText.textContent = canOpenExternal
        ? message
        : `${message} External Google fallback is unavailable for local or private URLs.`;
    }

    if (el.translateFallbackOpen) {
      el.translateFallbackOpen.hidden = !canOpenExternal;
    }

    if (el.translateFallback) {
      el.translateFallback.hidden = false;
      el.translateFallback.classList.add('visible');
    }
  }

  function hideTranslateFallback() {
    if (el.translateFallback) {
      el.translateFallback.hidden = true;
      el.translateFallback.classList.remove('visible');
    }
  }

  function buildGoogleTranslateUrl(language) {
    const targetLanguage = language || 'ja';
    return `https://translate.google.com/translate?sl=en&tl=${encodeURIComponent(targetLanguage)}&hl=${encodeURIComponent(targetLanguage)}&u=${encodeURIComponent(window.location.href)}`;
  }

  function canOpenGoogleTranslateFallback() {
    const host = window.location.hostname || '';
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
    const isPrivateRange =
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

    return !isLocal && !isPrivateRange;
  }

  function startTranslateChromeSuppression() {
    suppressTranslateChrome();

    if (_translateChromeObserver) return;

    _translateChromeObserver = new MutationObserver(() => {
      suppressTranslateChrome();
    });

    _translateChromeObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }

  function suppressTranslateChrome() {
    const selectors = [
      'iframe.goog-te-banner-frame',
      '.goog-te-banner-frame',
      '.goog-te-menu-frame',
      '.goog-te-balloon-frame',
      '#goog-gt-tt',
      'body > .skiptranslate'
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(node => {
        node.style.setProperty('display', 'none', 'important');
        node.style.setProperty('visibility', 'hidden', 'important');
        node.style.setProperty('opacity', '0', 'important');
        node.setAttribute('aria-hidden', 'true');
      });
    });

    if (document.body) {
      document.body.style.setProperty('top', '0px', 'important');
      document.body.style.setProperty('position', 'static', 'important');
      document.body.classList.remove('translated-ltr', 'translated-rtl');
    }

    if (document.documentElement) {
      document.documentElement.style.setProperty('top', '0px', 'important');
    }
  }

  /* ── Active State Helpers ─────────────────────────────────── */

  function initDebugConsole() {
    hookDebugConsole();
    pushDebugLog('info', ['Debug console ready. Enter Up Up Down Down Left Right Left Right B A.']);
  }

  function trackDebugKonamiCode(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const key = normalizeDebugKey(event.key);
    if (!key) return;

    if (key === DEBUG_KONAMI_CODE[_debugKonamiIndex]) {
      _debugKonamiIndex += 1;
      if (_debugKonamiIndex === DEBUG_KONAMI_CODE.length) {
        _debugKonamiIndex = 0;
        setDebugConsoleOpen(!_debugConsoleOpen);
      }
      return;
    }

    _debugKonamiIndex = key === DEBUG_KONAMI_CODE[0] ? 1 : 0;
  }

  function normalizeDebugKey(key) {
    const normalized = String(key || '').toLowerCase();
    if (normalized === 'arrowup') return 'up';
    if (normalized === 'arrowdown') return 'down';
    if (normalized === 'arrowleft') return 'left';
    if (normalized === 'arrowright') return 'right';
    if (normalized === 'b' || normalized === 'a') return normalized;
    return '';
  }

  function setDebugConsoleOpen(open) {
    _debugConsoleOpen = Boolean(open);

    if (_debugConsoleOpen) {
      const popupOpened = ensureDebugPopupWindow();
      if (el.debugConsole) {
        el.debugConsole.hidden = popupOpened;
        el.debugConsole.classList.toggle('visible', !popupOpened);
      }
      renderDebugConsole();
      window.clearInterval(_debugConsoleTimer);
      _debugConsoleTimer = window.setInterval(renderDebugConsole, 1000);
      pushDebugLog('info', [popupOpened ? 'Debug console opened in a separate window.' : 'Debug console opened in overlay mode.']);
    } else {
      if (el.debugConsole) {
        el.debugConsole.hidden = true;
        el.debugConsole.classList.remove('visible');
      }
      window.clearInterval(_debugConsoleTimer);
      _debugConsoleTimer = null;
      if (_debugPopupWindow && !_debugPopupWindow.closed) {
        _debugPopupWindow.close();
      }
      _debugPopupWindow = null;
    }
  }

  function renderDebugConsole() {
    if (!_debugConsoleOpen) return;

    const snapshot = collectDebugSnapshot();
    const summaryCards = [
      { label: 'Mode', value: snapshot.mode },
      { label: 'Filtered', value: String(snapshot.counts.filteredEvents) },
      { label: 'Selected', value: snapshot.selected.eventTitle || 'none' },
      { label: 'Zoom', value: snapshot.map.zoom }
    ];

    renderDebugPopup(snapshot, summaryCards);

    if (el.debugConsole && !el.debugConsole.hidden && el.debugSummary) {
      el.debugSummary.innerHTML = summaryCards.map(card => `
        <div class="debug-summary-card">
          <div class="debug-summary-label">${NewsAtlas.utils.escapeHtml(card.label)}</div>
          <div class="debug-summary-value">${NewsAtlas.utils.escapeHtml(card.value)}</div>
        </div>
      `).join('');
    }

    if (el.debugConsole && !el.debugConsole.hidden && el.debugJson) {
      el.debugJson.textContent = JSON.stringify(snapshot, null, 2);
    }

    if (el.debugConsole && !el.debugConsole.hidden && el.debugLog) {
      el.debugLog.innerHTML = _debugLogEntries.slice().reverse().map(entry => `
        <div class="debug-log-entry ${NewsAtlas.utils.escapeHtml(entry.type)}">
          <div class="debug-log-meta">
            <span>${NewsAtlas.utils.escapeHtml(entry.time)}</span>
            <span>${NewsAtlas.utils.escapeHtml(entry.type.toUpperCase())}</span>
          </div>
          <div class="debug-log-text">${NewsAtlas.utils.escapeHtml(entry.message)}</div>
        </div>
      `).join('');
    }
  }

  function collectDebugSnapshot() {
    const appState = NewsAtlas.app && NewsAtlas.app.getState ? NewsAtlas.app.getState() : null;
    const map = NewsAtlas.map && NewsAtlas.map.getMap ? NewsAtlas.map.getMap() : null;
    const mapCenter = map && map.getCenter ? map.getCenter() : null;
    const selectedEvent = appState && appState.selectedEvent ? appState.selectedEvent : null;

    return {
      timestamp: new Date().toISOString(),
      mode: appState ? appState.mode : 'unknown',
      timeFilter: appState ? appState.timeFilter : '',
      searchQuery: appState ? appState.searchQuery : '',
      dataMode: appState ? appState.dataMode : '',
      translationLanguage: getStoredLanguage() || 'en',
      counts: {
        allEvents: appState && Array.isArray(appState.allEvents) ? appState.allEvents.length : 0,
        filteredEvents: appState && Array.isArray(appState.filteredEvents) ? appState.filteredEvents.length : 0,
        headlines: appState && Array.isArray(appState.headlines) ? appState.headlines.length : 0
      },
      filters: {
        categories: appState && appState.categoryFilters ? Array.from(appState.categoryFilters) : [],
        selectedRegion: appState ? appState.selectedRegion : null
      },
      selected: {
        eventId: selectedEvent ? selectedEvent.id : null,
        eventTitle: selectedEvent ? selectedEvent.title : null,
        country: selectedEvent ? selectedEvent.countryName : null
      },
      panels: {
        leftHidden: el.leftPanel ? el.leftPanel.classList.contains('panel-hidden') : false,
        rightHidden: el.rightPanel ? el.rightPanel.classList.contains('panel-hidden') : false,
        drawerOpen: el.mobileDrawer ? el.mobileDrawer.classList.contains('drawer-open') : false,
        licenseOpen: _licenseMenuOpen
      },
      map: {
        ready: Boolean(map),
        zoom: NewsAtlas.map && NewsAtlas.map.getZoom ? NewsAtlas.map.getZoom().toFixed(2) : '0.00',
        center: mapCenter ? {
          lng: Number(mapCenter.lng).toFixed(4),
          lat: Number(mapCenter.lat).toFixed(4)
        } : null
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        mobile: window.innerWidth <= 768
      }
    };
  }

  async function copyDebugSnapshot() {
    const snapshot = JSON.stringify(collectDebugSnapshot(), null, 2);

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(snapshot);
        pushDebugLog('info', ['Snapshot copied to clipboard.']);
        renderDebugConsole();
        return;
      }
    } catch (_) {}

    pushDebugLog('warn', ['Clipboard copy is unavailable in this browser context.']);
    renderDebugConsole();
  }

  function ensureDebugPopupWindow() {
    if (_debugPopupWindow && !_debugPopupWindow.closed) {
      _debugPopupWindow.focus();
      return true;
    }

    try {
      _debugPopupWindow = window.open('', 'newsatlas-debug-console', 'popup=yes,width=980,height=760,resizable=yes,scrollbars=yes');
    } catch (_) {
      _debugPopupWindow = null;
    }

    if (!_debugPopupWindow) {
      pushDebugLog('warn', ['Popup window was blocked. Falling back to the in-page overlay.']);
      return false;
    }

    _debugPopupWindow.document.title = 'News Atlas Debug Console';
    _debugPopupWindow.addEventListener('beforeunload', () => {
      _debugPopupWindow = null;
      _debugConsoleOpen = false;
      window.clearInterval(_debugConsoleTimer);
      _debugConsoleTimer = null;
      if (el.debugConsole) {
        el.debugConsole.hidden = true;
        el.debugConsole.classList.remove('visible');
      }
    });
    return true;
  }

  function renderDebugPopup(snapshot, summaryCards) {
    if (!_debugPopupWindow || _debugPopupWindow.closed) {
      _debugPopupWindow = null;
      return;
    }

    const popupDoc = _debugPopupWindow.document;
    const logHtml = _debugLogEntries.slice().reverse().map(entry => `
      <div class="entry ${escapeDebugHtml(entry.type)}">
        <div class="entry-meta">
          <span>${escapeDebugHtml(entry.time)}</span>
          <span>${escapeDebugHtml(entry.type.toUpperCase())}</span>
        </div>
        <div class="entry-text">${escapeDebugHtml(entry.message)}</div>
      </div>
    `).join('');
    const summaryHtml = summaryCards.map(card => `
      <div class="summary-card">
        <div class="summary-label">${escapeDebugHtml(card.label)}</div>
        <div class="summary-value">${escapeDebugHtml(card.value)}</div>
      </div>
    `).join('');

    popupDoc.open();
    popupDoc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>News Atlas Debug Console</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top right, rgba(59, 130, 246, 0.16), transparent 28%),
        linear-gradient(180deg, #08111f, #050913 68%);
      color: #e5edf7;
    }
    .shell {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 18px;
    }
    .header, .summary, .grid, .actions { display: flex; }
    .header {
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .kicker, .panel-title, .summary-label, .entry-meta {
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .kicker { font-size: 11px; color: #8ea3bf; font-weight: 700; }
    .title { margin-top: 4px; font-size: 26px; font-weight: 800; }
    .actions { gap: 10px; flex-wrap: wrap; }
    button {
      border: 1px solid rgba(148, 163, 184, 0.25);
      background: rgba(15, 23, 42, 0.88);
      color: #e5edf7;
      border-radius: 999px;
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    button.primary {
      border-color: rgba(96, 165, 250, 0.45);
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.94), rgba(59, 130, 246, 0.88));
    }
    .summary { gap: 12px; flex-wrap: wrap; }
    .summary-card, .panel, .entry {
      border: 1px solid rgba(148, 163, 184, 0.16);
      background: rgba(15, 23, 42, 0.72);
      border-radius: 16px;
    }
    .summary-card { min-width: 160px; padding: 12px 14px; }
    .summary-label { font-size: 10px; color: #8ea3bf; font-weight: 700; }
    .summary-value { margin-top: 6px; font-size: 16px; font-weight: 700; }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(300px, 0.9fr);
      gap: 14px;
      min-height: 0;
      flex: 1;
    }
    .panel {
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
    }
    .panel-title { font-size: 10px; font-weight: 800; color: #93c5fd; }
    pre, .log {
      margin: 0;
      min-height: 0;
      overflow: auto;
      background: rgba(2, 6, 23, 0.84);
      border-radius: 14px;
      padding: 14px;
      font-family: "IBM Plex Mono", Consolas, monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #e2e8f0;
    }
    .log { display: flex; flex-direction: column; gap: 10px; }
    .entry { padding: 10px 12px; border-radius: 12px; }
    .entry.warn { border-color: rgba(251, 191, 36, 0.3); }
    .entry.error { border-color: rgba(248, 113, 113, 0.34); }
    .entry-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 10px;
      font-weight: 700;
      color: #8ea3bf;
    }
    .entry-text {
      margin-top: 6px;
      white-space: pre-wrap;
      word-break: break-word;
      color: #d4dde9;
    }
    @media (max-width: 860px) {
      .header { flex-direction: column; align-items: flex-start; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <div>
        <div class="kicker">Secret Debug</div>
        <div class="title">Atlas Console</div>
      </div>
      <div class="actions">
        <button onclick="window.opener.NewsAtlas.ui.copyDebugSnapshot()">Copy JSON</button>
        <button onclick="window.opener.NewsAtlas.ui.refreshDebugConsole()">Refresh</button>
        <button class="primary" onclick="window.opener.NewsAtlas.ui.closeDebugConsole()">Close</button>
      </div>
    </div>
    <div class="summary">${summaryHtml}</div>
    <div class="grid">
      <section class="panel">
        <div class="panel-title">Snapshot</div>
        <pre>${escapeDebugHtml(JSON.stringify(snapshot, null, 2))}</pre>
      </section>
      <section class="panel">
        <div class="panel-title">Runtime Log</div>
        <div class="log">${logHtml}</div>
      </section>
    </div>
  </div>
</body>
</html>`);
    popupDoc.close();
  }

  function escapeDebugHtml(value) {
    return NewsAtlas.utils.escapeHtml(String(value == null ? '' : value));
  }

  function hookDebugConsole() {
    if (_debugConsoleHooked) return;
    _debugConsoleHooked = true;

    ['log', 'warn', 'error'].forEach(type => {
      const original = console[type];
      console[type] = function(...args) {
        pushDebugLog(type, args);
        return original.apply(console, args);
      };
    });

    window.addEventListener('error', (event) => {
      pushDebugLog('error', [event.message || 'Unhandled error']);
      renderDebugConsole();
    });

    window.addEventListener('unhandledrejection', (event) => {
      pushDebugLog('error', [event.reason || 'Unhandled promise rejection']);
      renderDebugConsole();
    });
  }

  function pushDebugLog(type, args) {
    const message = args.map(formatDebugLogArg).join(' ');
    _debugLogEntries.push({
      type,
      time: new Date().toLocaleTimeString(),
      message
    });

    if (_debugLogEntries.length > DEBUG_LOG_LIMIT) {
      _debugLogEntries.splice(0, _debugLogEntries.length - DEBUG_LOG_LIMIT);
    }
  }

  function formatDebugLogArg(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;

    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function setActiveMode(mode) {
    el.modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    if (el.nonGeotagButton) {
      el.nonGeotagButton.classList.toggle('active', mode === 'non-geotag');
    }
  }

  function setNonGeotagCount(count) {
    if (el.nonGeotagCount) {
      el.nonGeotagCount.textContent = String(Math.max(0, Number(count) || 0));
    }
  }

  function setActiveTime(time) {
    el.timeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.time === time);
    });
  }

  function toggleCategory(chip, cat) {
    const state = NewsAtlas.app.getState();

    if (cat === 'all') {
      // Reset to "all"
      state.categoryFilters = new Set(['all']);
      el.categoryChips.forEach(c => {
        c.classList.toggle('active', c.dataset.category === 'all');
      });
    } else {
      // Remove "all" sentinel and toggle the specific category
      state.categoryFilters.delete('all');
      el.categoryChips.forEach(c => {
        if (c.dataset.category === 'all') c.classList.remove('active');
      });

      if (state.categoryFilters.has(cat)) {
        state.categoryFilters.delete(cat);
        chip.classList.remove('active');
      } else {
        state.categoryFilters.add(cat);
        chip.classList.add('active');
      }

      // If nothing selected, fall back to "all"
      if (state.categoryFilters.size === 0) {
        state.categoryFilters.add('all');
        el.categoryChips.forEach(c => {
          c.classList.toggle('active', c.dataset.category === 'all');
        });
      }
    }
  }

  /* ── Panel Content ────────────────────────────────────────── */

  function updateLeftPanel(html) {
    if (el.leftContent) el.leftContent.innerHTML = html;
    scheduleTranslationRefresh();
  }

  function updateRightPanel(html) {
    if (el.rightContent) el.rightContent.innerHTML = html;
    scheduleTranslationRefresh();
  }

  function showEventDetail(event) {
    const html = NewsAtlas.renderers.eventDetail(event);
    if (window.innerWidth <= 768) {
      openDrawer(html);
    } else {
      updateRightPanel(html);
    }
  }

  function showRegionDetail(regionName, events) {
    const html = NewsAtlas.renderers.regionDetail(regionName, events);
    if (window.innerWidth <= 768) {
      openDrawer(html);
    } else {
      updateRightPanel(html);
    }
  }

  /* ── Status ───────────────────────────────────────────────── */

  function setStatusBadge(mode) {
    if (!el.statusBadge) return;
    const labels = { live: 'LIVE', gdelt: 'GDELT', static: 'STATIC' };
    el.statusBadge.textContent = labels[mode] || mode.toUpperCase();
    el.statusBadge.className   = `status-badge ${mode}`;
    scheduleTranslationRefresh();
  }

  function setUpdateTime(dateStr) {
    if (el.updateTime) el.updateTime.textContent = `Updated: ${dateStr}`;
    scheduleTranslationRefresh();
  }

  /* ── Mobile Drawer ────────────────────────────────────────── */

  function openDrawer(html) {
    if (!el.mobileDrawer) return;
    if (el.drawerContent) el.drawerContent.innerHTML = html;
    el.mobileDrawer.classList.add('drawer-open');
    scheduleTranslationRefresh();
  }

  function closeDrawer() {
    if (el.mobileDrawer) el.mobileDrawer.classList.remove('drawer-open');
  }

  /* ── Panel Toggle ─────────────────────────────────────────── */

  function togglePanel(side) {
    const panel = side === 'left' ? el.leftPanel : el.rightPanel;
    if (panel) panel.classList.toggle('panel-hidden');
  }

  /* ── Loading ──────────────────────────────────────────────── */

  function showLoading() {
    if (el.leftContent) {
      el.leftContent.innerHTML = NewsAtlas.renderers.loadingState();
    }
    scheduleTranslationRefresh();
  }

  /* ── Refresh button state ─────────────────────────────────── */

  function setRefreshing(isRefreshing) {
    const btn = document.getElementById('refresh-btn');
    if (!btn) return;
    btn.disabled = isRefreshing;
    btn.classList.toggle('refreshing', isRefreshing);
    btn.title = isRefreshing ? 'Fetching from GDELT…' : 'Refresh from GDELT live feed';
  }

  /* ── Public API ───────────────────────────────────────────── */

  return {
    init,
    updateLeftPanel,
    updateRightPanel,
    showEventDetail,
    showRegionDetail,
    setStatusBadge,
    setUpdateTime,
    setRefreshing,
    openDrawer,
    closeDrawer,
    setActiveMode,
    setActiveTime,
    setNonGeotagCount,
    showLoading,
    setLicenseMenuOpen,
    registerLicenseControl,
    getDisplaySettings,
    copyDebugSnapshot,
    refreshDebugConsole: renderDebugConsole,
    closeDebugConsole: () => setDebugConsoleOpen(false)
  };
})();
