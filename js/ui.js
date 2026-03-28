/* ============================================================
   UI — World News Map Viewer
   Handles DOM interactions and panel updates.
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.ui = (function() {
  // Cached DOM element references
  const el = {};

  /* ── Init ──────────────────────────────────────────────────── */

  function init() {
    el.header         = document.getElementById('header');
    el.leftPanel      = document.getElementById('left-panel');
    el.rightPanel     = document.getElementById('right-panel');
    el.searchInput    = document.getElementById('search-input');
    el.modeButtons    = document.querySelectorAll('.mode-btn');
    el.timeButtons    = document.querySelectorAll('.time-btn');
    el.categoryChips  = document.querySelectorAll('.category-chip');
    el.statusBadge    = document.getElementById('status-badge');
    el.updateTime     = document.getElementById('update-time');
    el.leftContent    = document.getElementById('left-content');
    el.rightContent   = document.getElementById('right-content');
    el.mobileDrawer   = document.getElementById('mobile-drawer');
    el.drawerContent  = document.getElementById('drawer-content');

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

    // Mobile panel toggles
    const leftToggle  = document.getElementById('toggle-left');
    const rightToggle = document.getElementById('toggle-right');
    if (leftToggle)  leftToggle.addEventListener('click',  () => togglePanel('left'));
    if (rightToggle) rightToggle.addEventListener('click', () => togglePanel('right'));

    // Drawer close button
    const drawerClose = document.getElementById('drawer-close');
    if (drawerClose) drawerClose.addEventListener('click', closeDrawer);

    // Close drawer when clicking the overlay backdrop (outside drawer)
    if (el.mobileDrawer) {
      el.mobileDrawer.addEventListener('click', (e) => {
        if (e.target === el.mobileDrawer) closeDrawer();
      });
    }

    // Keyboard shortcut: Escape closes drawer
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
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
    showLoading
  };
})();
