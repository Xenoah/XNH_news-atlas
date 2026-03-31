/* ============================================================
   APP — World News Map Viewer
   Central state management and application logic.
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.app = (function() {

  /* ── State ────────────────────────────────────────────────── */

  const state = {
    mode: 'events',
    timeFilter: '24h',
    categoryFilters: new Set(['all']),
    searchQuery: '',
    selectedEvent: null,
    selectedRegion: null,
    dataMode: 'static',
    lastUpdated: null,
    allEvents: [],
    filteredEvents: [],
    headlines: [],
    trends: {},
    heatmapData: null
  };

  let _initialized   = false;
  let _pendingRender = false;

  /* ── Init ─────────────────────────────────────────────────── */

  async function init() {
    if (_initialized) return;
    _initialized = true;

    // Show loading placeholder in left panel
    NewsAtlas.ui.showLoading();

    // Detect data mode (live vs. static)
    state.dataMode = await NewsAtlas.data.init();
    NewsAtlas.ui.setStatusBadge(state.dataMode);

    // Load all initial data in parallel
    const [events, headlines, trends, heatmap] = await Promise.all([
      NewsAtlas.data.getEvents().catch(err    => { console.warn('[data] getEvents failed:', err);    return []; }),
      NewsAtlas.data.getHeadlines().catch(err => { console.warn('[data] getHeadlines failed:', err); return []; }),
      NewsAtlas.data.getTrends().catch(err    => { console.warn('[data] getTrends failed:', err);    return {}; }),
      NewsAtlas.data.getHeatmap('24h').catch(err => { console.warn('[data] getHeatmap failed:', err); return null; })
    ]);

    state.allEvents  = events;
    state.headlines  = headlines;
    state.trends     = trends;
    state.heatmapData = heatmap;
    state.lastUpdated = new Date();

    // Update mode badge
    state.dataMode = NewsAtlas.data.getMode();
    NewsAtlas.ui.setStatusBadge(state.dataMode);

    // Show data freshness from meta.json (GitHub Actions generation time)
    NewsAtlas.data.getMeta().then(meta => {
      if (meta && meta.generatedAt) {
        NewsAtlas.ui.setUpdateTime(NewsAtlas.utils.timeAgo(meta.generatedAt));
      } else {
        NewsAtlas.ui.setUpdateTime(NewsAtlas.utils.formatDate(state.lastUpdated.toISOString()));
      }
    });

    // Apply filters and render
    _applyFiltersAndRender();

    // Auto-refresh static data every 5 min (reloads GA-updated JSON)
    if (state.dataMode !== 'live') {
      setInterval(_autoRefreshStatic, 300_000);
    } else {
      setInterval(_refresh, 60_000);
    }
  }

  /* ── Auto-refresh static JSON (every 5 min, silent) ─────── */

  async function _autoRefreshStatic() {
    NewsAtlas.data.clearCache();
    try {
      const [events, trends] = await Promise.all([
        NewsAtlas.data.getEvents(),
        NewsAtlas.data.getTrends().catch(() => state.trends)
      ]);
      state.allEvents = events;
      state.trends    = trends;
      state.lastUpdated = new Date();
      _applyFiltersAndRender();
      // Update freshness from meta
      NewsAtlas.data.getMeta().then(meta => {
        if (meta && meta.generatedAt) NewsAtlas.ui.setUpdateTime(NewsAtlas.utils.timeAgo(meta.generatedAt));
      });
    } catch (err) {
      console.warn('[app] Auto-refresh failed:', err.message);
    }
  }

  /* ── Live API refresh ─────────────────────────────────────── */

  async function _refresh() {
    NewsAtlas.data.clearCache();
    const [events, trends] = await Promise.all([
      NewsAtlas.data.getEvents().catch(() => state.allEvents),
      NewsAtlas.data.getTrends().catch(() => state.trends)
    ]);
    state.allEvents   = events;
    state.trends      = trends;
    state.lastUpdated = new Date();
    NewsAtlas.ui.setUpdateTime(NewsAtlas.utils.formatDate(state.lastUpdated.toISOString()));
    _applyFiltersAndRender();
  }

  /* ── Manual GDELT Refresh (user-triggered) ───────────────── */

  async function onRefresh() {
    NewsAtlas.ui.setRefreshing(true);
    try {
      const events = await NewsAtlas.data.refreshFromGDELT();
      state.allEvents   = events;
      state.lastUpdated = new Date();
      state.dataMode    = NewsAtlas.data.getMode();
      NewsAtlas.ui.setStatusBadge(state.dataMode);
      NewsAtlas.ui.setUpdateTime('Just now (GDELT live)');
      _applyFiltersAndRender();
    } catch (err) {
      console.warn('[app] Manual GDELT refresh failed:', err);
      NewsAtlas.ui.setUpdateTime('Refresh failed — using cached data');
    } finally {
      NewsAtlas.ui.setRefreshing(false);
    }
  }

  /* ── Filter + Render ──────────────────────────────────────── */

  function _applyFiltersAndRender() {
    state.filteredEvents = NewsAtlas.filters.apply(state.allEvents, state);
    _renderAll();
  }

  function _renderAll() {
    // ── Map update ─────────────────────────────────────────────
    // Guard: map may not be ready yet (if data loads before map)
    try {
      NewsAtlas.map.updateEvents(state.filteredEvents, state.mode);
      if (state.heatmapData) NewsAtlas.map.updateHeatmap(state.heatmapData);
    } catch (e) {
      // Map not yet initialized; will be pushed on mapready event
      _pendingRender = true;
    }

    // ── Left panel ─────────────────────────────────────────────
    let leftHtml = '';
    const ranked       = NewsAtlas.scoring.rankEvents(state.filteredEvents);
    const catCounts    = NewsAtlas.scoring.countByCategory(state.filteredEvents);
    const countryCounts = NewsAtlas.scoring.countByCountry(state.filteredEvents);

    if (state.mode === 'events') {
      leftHtml =
        NewsAtlas.renderers.leftPanelRankings(ranked.slice(0, 10)) +
        NewsAtlas.renderers.leftPanelStats(state.filteredEvents, catCounts, countryCounts);
    } else if (state.mode === 'trends') {
      const trending = NewsAtlas.scoring.getTrending(state.filteredEvents);
      leftHtml = NewsAtlas.renderers.trendsPanel(trending, state.trends);
    } else if (state.mode === 'analysis') {
      leftHtml = NewsAtlas.renderers.analysisPanel(state.filteredEvents);
    } else if (state.mode === 'density') {
      leftHtml = NewsAtlas.renderers.leftPanelStats(state.filteredEvents, catCounts, countryCounts);
    }

    NewsAtlas.ui.updateLeftPanel(leftHtml || NewsAtlas.renderers.emptyState('No events match your filters'));

    // ── Right panel ────────────────────────────────────────────
    if (!state.selectedEvent && !state.selectedRegion) {
      if (state.mode === 'analysis') {
        NewsAtlas.ui.updateRightPanel(
          NewsAtlas.renderers.analysisRightPanel(state.filteredEvents)
        );
      } else {
        const topEvent = ranked[0];
        if (topEvent) {
          NewsAtlas.ui.updateRightPanel(NewsAtlas.renderers.eventDetail(topEvent));
        } else {
          NewsAtlas.ui.updateRightPanel(
            NewsAtlas.renderers.emptyState('No events match your filters')
          );
        }
      }
    }
  }

  /* ── Mode Change ──────────────────────────────────────────── */

  function onModeChange(mode) {
    state.mode = mode;
    state.selectedEvent  = null;
    state.selectedRegion = null;
    _applyFiltersAndRender();

    // Load appropriate heatmap data for density mode
    if (mode === 'density') {
      const heatRange = state.timeFilter === '1h' ? '1h' : '24h';
      NewsAtlas.data.getHeatmap(heatRange).then(data => {
        state.heatmapData = data;
        try { NewsAtlas.map.updateHeatmap(data); } catch (_) {}
      }).catch(() => {});
    }
  }

  /* ── Time Change ──────────────────────────────────────────── */

  function onTimeChange(timeFilter) {
    state.timeFilter = timeFilter;
    state.selectedEvent  = null;
    state.selectedRegion = null;
    _applyFiltersAndRender();
  }

  /* ── Category Change ──────────────────────────────────────── */

  function onCategoryChange(categories) {
    state.categoryFilters = categories;
    _applyFiltersAndRender();
  }

  /* ── Search Change ────────────────────────────────────────── */

  function onSearchChange(query) {
    state.searchQuery = query;
    _applyFiltersAndRender();
  }

  /* ── Event Select ─────────────────────────────────────────── */

  function onEventSelect(event) {
    if (!event) return;
    state.selectedEvent  = event;
    state.selectedRegion = null;
    NewsAtlas.ui.showEventDetail(event);
    try {
      NewsAtlas.map.highlightEvent(event);
      NewsAtlas.map.showPopup(event);
      const currentZoom = NewsAtlas.map.getZoom();
      NewsAtlas.map.flyTo(event.lng, event.lat, Math.max(currentZoom, 6));
    } catch (_) {}
  }

  /* ── Zoom Change ──────────────────────────────────────────── */

  function onZoomChange(_zoom, _zoomCategory) {
    // Reserved for future zoom-level-dependent behavior
  }

  /* ── Accessors ────────────────────────────────────────────── */

  function getEventById(id) {
    if (!id) return null;
    return state.allEvents.find(e => e.id === id) || null;
  }

  function refreshView() {
    _renderAll();
    if (state.selectedEvent) {
      NewsAtlas.ui.showEventDetail(state.selectedEvent);
    }
  }

  function getState() { return state; }

  /* ── Map Ready Listener ───────────────────────────────────── */

  // If data loaded before map, retry render when map signals ready
  document.addEventListener('newsatlas:mapready', () => {
    if (_pendingRender) {
      _pendingRender = false;
      try {
        NewsAtlas.map.updateEvents(state.filteredEvents, state.mode);
        if (state.heatmapData) NewsAtlas.map.updateHeatmap(state.heatmapData);
      } catch (e) {
        console.warn('[app] Map render after ready failed:', e);
      }
    }
  });

  /* ── Public API ───────────────────────────────────────────── */

  return {
    init,
    onModeChange,
    onTimeChange,
    onCategoryChange,
    onSearchChange,
    onEventSelect,
    onZoomChange,
    onRefresh,
    refreshView,
    getEventById,
    getState
  };
})();
