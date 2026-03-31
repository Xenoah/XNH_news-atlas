/* ============================================================
   UI — World News Map Viewer
   Handles DOM interactions and panel updates.
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.ui = (function() {
  const TRANSLATE_STORAGE_KEY = 'newsatlas:translate-language';
  const TRANSLATE_LANGUAGES = ['ja', 'ko', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt', 'ar', 'hi', 'ru'];
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

  /* ── Init ──────────────────────────────────────────────────── */

  function init() {
    el.header         = document.getElementById('header');
    el.leftPanel      = document.getElementById('left-panel');
    el.rightPanel     = document.getElementById('right-panel');
    el.searchInput    = document.getElementById('search-input');
    el.languageSelect = document.getElementById('language-select');
    el.modeButtons    = document.querySelectorAll('.mode-btn');
    el.timeButtons    = document.querySelectorAll('.time-btn');
    el.categoryChips  = document.querySelectorAll('.category-chip');
    el.statusBadge    = document.getElementById('status-badge');
    el.updateTime     = document.getElementById('update-time');
    el.leftContent    = document.getElementById('left-content');
    el.rightContent   = document.getElementById('right-content');
    el.mobileDrawer   = document.getElementById('mobile-drawer');
    el.drawerContent  = document.getElementById('drawer-content');
    el.licenseWidget  = document.getElementById('map-license');
    el.licenseMenu    = document.getElementById('license-menu');
    el.licenseMenuBody = document.getElementById('license-menu-body');
    el.licenseClose   = document.getElementById('license-close');

    renderLicenseMenu();
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

    // Close drawer when clicking the overlay backdrop (outside drawer)
    if (el.mobileDrawer) {
      el.mobileDrawer.addEventListener('click', (e) => {
        if (e.target === el.mobileDrawer) closeDrawer();
      });
    }

    // Keyboard shortcut: Escape closes drawer
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDrawer();
        setLicenseMenuOpen(false);
      }
    });

    document.addEventListener('click', (e) => {
      if (!_licenseMenuOpen || !el.licenseWidget) return;
      if (!el.licenseWidget.contains(e.target)) {
        setLicenseMenuOpen(false);
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

  function initGoogleTranslate() {
    const savedLanguage = getStoredLanguage();

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
      if (el.languageSelect) {
        el.languageSelect.title = 'Google Translate could not be loaded';
      }
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
    } catch (_) {
      if (el.languageSelect) {
        el.languageSelect.title = 'Google Translate could not be initialized';
      }
    }
  }

  function applyTranslationLanguage(language) {
    storeLanguage(language);
    setTranslateCookie(language);
    window.location.reload();
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

  function setTranslateCookie(language) {
    const cookieValue = language ? `/en/${language}` : '';
    const maxAge = language ? '31536000' : '0';
    const host = window.location.hostname;
    const cookieTargets = [`path=/;max-age=${maxAge}`];

    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      cookieTargets.push(`domain=${host};path=/;max-age=${maxAge}`);

      const hostParts = host.split('.');
      if (hostParts.length > 2) {
        const rootDomain = hostParts.slice(-2).join('.');
        cookieTargets.push(`domain=.${rootDomain};path=/;max-age=${maxAge}`);
      }
    }

    cookieTargets.forEach(target => {
      document.cookie = `googtrans=${cookieValue};${target}`;
    });
  }

  /* ── Active State Helpers ─────────────────────────────────── */

  function setActiveMode(mode) {
    el.modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
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
  }

  function updateRightPanel(html) {
    if (el.rightContent) el.rightContent.innerHTML = html;
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
  }

  function setUpdateTime(dateStr) {
    if (el.updateTime) el.updateTime.textContent = `Updated: ${dateStr}`;
  }

  /* ── Mobile Drawer ────────────────────────────────────────── */

  function openDrawer(html) {
    if (!el.mobileDrawer) return;
    if (el.drawerContent) el.drawerContent.innerHTML = html;
    el.mobileDrawer.classList.add('drawer-open');
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
    showLoading,
    setLicenseMenuOpen,
    registerLicenseControl
  };
})();
