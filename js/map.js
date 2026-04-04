/* ============================================================
   MAP — World News Map Viewer
   MapLibre GL JS integration with CartoDB dark tiles.
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.map = (function() {
  let _map = null;
  let _markers = [];           // HTML bubble marker instances
  let _popup   = null;
  let _currentZoomCategory = 'low'; // 'low' | 'mid' | 'high'
  let _initialized = false;
  let _currentBaseTheme = 'dark';
  let _sunlightTimer = null;
  let _allEvents = [];
  let _currentMode = 'events';

  /* ── CartoDB Dark Style Definition ──────────────────────── */

  const CARTO_ATTRIBUTION = '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  function createBaseStyle(theme) {
    const resolvedTheme = theme === 'light' ? 'light' : 'dark';

    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        'carto-dark': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: CARTO_ATTRIBUTION
        },
        'carto-light': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
            'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: CARTO_ATTRIBUTION
        }
      },
      layers: [
        {
          id: 'carto-dark-tiles',
          type: 'raster',
          source: 'carto-dark',
          layout: { visibility: resolvedTheme === 'dark' ? 'visible' : 'none' },
          minzoom: 0,
          maxzoom: 22
        },
        {
          id: 'carto-light-tiles',
          type: 'raster',
          source: 'carto-light',
          layout: { visibility: resolvedTheme === 'light' ? 'visible' : 'none' },
          minzoom: 0,
          maxzoom: 22
        }
      ]
    };
  }

  /* ── Init ─────────────────────────────────────────────────── */

  function init(containerId) {
    const initialTheme = NewsAtlas.ui && NewsAtlas.ui.getDisplaySettings
      ? NewsAtlas.ui.getDisplaySettings().theme
      : 'dark';
    _currentBaseTheme = initialTheme === 'light' ? 'light' : 'dark';

    _map = new maplibregl.Map({
      container: containerId,
      style: createBaseStyle(_currentBaseTheme),
      center: [10, 20],
      zoom: 2,
      minZoom: 1,
      maxZoom: 18,
      attributionControl: true
    });

    _map.addControl(new maplibregl.NavigationControl(), 'top-right');
    _map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    _setupLicenseButton();

    _map.on('load', () => {
      _setupSources();
      _setupLayers();
      _setupZoomHandler();
      _setupClickHandlers();
      _initialized = true;

      // Dispatch a custom event so app.js knows map is ready
      document.dispatchEvent(new CustomEvent('newsatlas:mapready'));

      try {
        refreshSunlightOverlay(true);
        window.clearInterval(_sunlightTimer);
        _sunlightTimer = window.setInterval(() => refreshSunlightOverlay(), 300000);
      } catch (err) {
        console.warn('[map] Sunlight overlay initialization failed:', err);
      }
    });

    return _map;
  }

  function setTheme(theme) {
    _currentBaseTheme = theme === 'light' ? 'light' : 'dark';
    if (!_map || !_map.isStyleLoaded()) return;

    if (_map.getLayer('carto-dark-tiles')) {
      _map.setLayoutProperty('carto-dark-tiles', 'visibility', _currentBaseTheme === 'dark' ? 'visible' : 'none');
    }
    if (_map.getLayer('carto-light-tiles')) {
      _map.setLayoutProperty('carto-light-tiles', 'visibility', _currentBaseTheme === 'light' ? 'visible' : 'none');
    }
    if (_map.getLayer('sunlight-day')) {
      _map.setPaintProperty('sunlight-day', 'fill-color', _currentBaseTheme === 'light' ? 'rgba(255,244,214,0.10)' : 'rgba(250,204,21,0.08)');
    }
    if (_map.getLayer('sunlight-night')) {
      _map.setPaintProperty('sunlight-night', 'fill-color', _currentBaseTheme === 'light' ? 'rgba(15,23,42,0.22)' : 'rgba(2,6,23,0.46)');
    }
  }

  /* ── Sources ──────────────────────────────────────────────── */

  function _setupSources() {
    _map.addSource('sunlight-overlay', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // Clustered events source
    _map.addSource('events', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 6,
      clusterRadius: 60
    });

    // Heatmap source
    _map.addSource('heatmap', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // High-attention bubble events source
    _map.addSource('bubbles', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // Selected event highlight source
    _map.addSource('selected-event', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }

  function _setupLicenseButton() {
    const attrib = _map && _map.getContainer()
      ? _map.getContainer().querySelector('.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib')
      : null;

    if (!attrib || attrib.querySelector('.license-toggle-btn')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'license-toggle-btn';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'license-menu');
    button.setAttribute('aria-label', 'Show licenses and credits');
    button.title = 'Show licenses and credits';
    button.textContent = 'LISENSE';

    attrib.insertBefore(button, attrib.firstChild);

    if (NewsAtlas.ui && NewsAtlas.ui.registerLicenseControl) {
      NewsAtlas.ui.registerLicenseControl(button);
    }
  }

  /* ── Layers ───────────────────────────────────────────────── */

  function _setupLayers() {
    _map.addLayer({
      id: 'sunlight-day',
      type: 'fill',
      source: 'sunlight-overlay',
      filter: ['==', ['get', 'phase'], 'day'],
      paint: {
        'fill-antialias': false,
        'fill-color': _currentBaseTheme === 'light' ? 'rgba(255,244,214,0.10)' : 'rgba(250,204,21,0.08)',
        'fill-opacity': 1
      }
    });

    _map.addLayer({
      id: 'sunlight-night',
      type: 'fill',
      source: 'sunlight-overlay',
      filter: ['==', ['get', 'phase'], 'night'],
      paint: {
        'fill-antialias': false,
        'fill-color': _currentBaseTheme === 'light' ? 'rgba(15,23,42,0.22)' : 'rgba(2,6,23,0.46)',
        'fill-opacity': 1
      }
    });

    // ── Heatmap layer ──────────────────────────────────────────
    _map.addLayer({
      id: 'heatmap-layer',
      type: 'heatmap',
      source: 'heatmap',
      maxzoom: 9,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': [
          'interpolate', ['linear'], ['get', 'intensity'],
          0, 0, 1, 1
        ],
        'heatmap-intensity': [
          'interpolate', ['linear'], ['zoom'],
          0, 1, 9, 3
        ],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0,   'rgba(0,0,0,0)',
          0.2, 'rgba(65,105,225,0.4)',
          0.4, 'rgba(0,128,255,0.6)',
          0.6, 'rgba(255,165,0,0.7)',
          0.8, 'rgba(255,80,50,0.8)',
          1,   'rgba(255,30,30,0.9)'
        ],
        'heatmap-radius': [
          'interpolate', ['linear'], ['zoom'],
          0, 20, 9, 40
        ],
        'heatmap-opacity': [
          'interpolate', ['linear'], ['zoom'],
          6, 0.9, 9, 0
        ]
      }
    });

    // ── Cluster circles ────────────────────────────────────────
    _map.addLayer({
      id: 'cluster-circles',
      type: 'circle',
      source: 'events',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step', ['get', 'point_count'],
          '#3b82f6', 5,
          '#f59e0b', 15,
          '#ef4444'
        ],
        'circle-radius': [
          'step', ['get', 'point_count'],
          20, 5,
          30, 15,
          40
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(255,255,255,0.3)'
      }
    });

    // ── Cluster count label ────────────────────────────────────
    _map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'events',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': 13,
        'text-allow-overlap': true
      },
      paint: {
        'text-color': '#ffffff'
      }
    });

    // ── Individual event points ────────────────────────────────
    _map.addLayer({
      id: 'event-points',
      type: 'circle',
      source: 'events',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['get', 'colorHex'],
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 5, 10, 10
        ],
        'circle-opacity': 0.9,
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(255,255,255,0.5)'
      }
    });

    // ── Bubble rings (high attention events) ───────────────────
    _map.addLayer({
      id: 'bubble-rings',
      type: 'circle',
      source: 'bubbles',
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': 18,
        'circle-stroke-width': 2,
        'circle-stroke-color': ['get', 'colorHex'],
        'circle-opacity': 0
      }
    });

    // ── Selected event: outer glow ──────────────────────────────
    _map.addLayer({
      id: 'selected-glow',
      type: 'circle',
      source: 'selected-event',
      paint: {
        'circle-color': ['get', 'colorHex'],
        'circle-radius': 24,
        'circle-opacity': 0.18,
        'circle-stroke-width': 0
      }
    });

    // ── Selected event: sharp ring ──────────────────────────────
    _map.addLayer({
      id: 'selected-ring',
      type: 'circle',
      source: 'selected-event',
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': 18,
        'circle-opacity': 0,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff'
      }
    });
  }

  /* ── Zoom Handler ─────────────────────────────────────────── */

  function _setupZoomHandler() {
    _map.on('zoomend', () => {
      const zoom = _map.getZoom();
      const newCategory = zoom < 3 ? 'low' : zoom < 6 ? 'mid' : 'high';
      if (newCategory !== _currentZoomCategory) {
        _currentZoomCategory = newCategory;
        _refreshEventSources();
        if (NewsAtlas.app && NewsAtlas.app.onZoomChange) {
          NewsAtlas.app.onZoomChange(zoom, newCategory);
        }
      }
      // Update zoom indicator
      const indicator = document.getElementById('zoom-indicator');
      if (indicator) indicator.textContent = `Zoom: ${zoom.toFixed(1)}`;
    });
  }

  /* ── Click Handlers ───────────────────────────────────────── */

  function _setupClickHandlers() {

    // Cluster click → expand zoom
    _map.on('click', 'cluster-circles', (e) => {
      const features = _map.queryRenderedFeatures(e.point, { layers: ['cluster-circles'] });
      if (!features.length) return;
      const clusterId = features[0].properties.cluster_id;
      _map.getSource('events').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        _map.easeTo({
          center: features[0].geometry.coordinates,
          zoom: zoom + 0.5
        });
      });
    });

    // Individual event point click
    _map.on('click', 'event-points', (e) => {
      if (!e.features.length) return;
      const props   = e.features[0].properties;
      const eventId = props.id;
      const event   = NewsAtlas.app && NewsAtlas.app.getEventById(eventId);
      if (event) NewsAtlas.app.onEventSelect(event);
    });

    // Bubble ring click
    _map.on('click', 'bubble-rings', (e) => {
      if (!e.features.length) return;
      const props = e.features[0].properties;
      const event = NewsAtlas.app && NewsAtlas.app.getEventById(props.id);
      if (event) NewsAtlas.app.onEventSelect(event);
    });

    // Cursor changes on hover
    ['cluster-circles', 'event-points', 'bubble-rings'].forEach(layer => {
      _map.on('mouseenter', layer, () => {
        _map.getCanvas().style.cursor = 'pointer';
      });
      _map.on('mouseleave', layer, () => {
        _map.getCanvas().style.cursor = '';
      });
    });
  }

  /* ── Data Updates ─────────────────────────────────────────── */

  /**
   * Push filtered events to the map sources.
   * @param {object[]} events
   * @param {string}   mode  app display mode
   */
  function updateEvents(events, mode) {
    if (!_map || !_initialized) return;
    _allEvents = Array.isArray(events) ? events : [];
    _currentMode = mode || 'events';
    _refreshEventSources();
  }

  function _getVisibleEventsForZoom(events) {
    if (!Array.isArray(events) || !events.length) return [];

    if (_currentZoomCategory === 'high') {
      return events;
    }

    const ranked = [...events].sort((a, b) => (b.attentionScore || 0) - (a.attentionScore || 0));
    if (_currentZoomCategory === 'mid') {
      return ranked
        .filter(e => NewsAtlas.scoring.shouldBubble(e) || (e.attentionScore || 0) >= 0.45)
        .slice(0, 1200);
    }

    return ranked
      .filter(e => NewsAtlas.scoring.shouldBubble(e) || (e.attentionScore || 0) >= 0.72)
      .slice(0, 250);
  }

  function _refreshEventSources() {
    if (!_map || !_initialized) return;
    const visibleEvents = _getVisibleEventsForZoom(_allEvents);
    const features = visibleEvents.map(e => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [e.lng, e.lat]
      },
      properties: {
        id:             e.id,
        title:          e.title,
        category:       e.category,
        colorHex:       NewsAtlas.utils.categoryHex(e.category),
        attentionScore: e.attentionScore || 0,
        velocityScore:  e.velocityScore  || 0,
        articleCount:   e.articleCount   || 0,
        countryName:    e.countryName    || '',
        freshness:      e.freshness || NewsAtlas.scoring.getFreshness(e.publishedAt),
        bubble:         NewsAtlas.scoring.shouldBubble(e)
      }
    }));

    const eventsSrc = _map.getSource('events');
    if (eventsSrc) eventsSrc.setData({ type: 'FeatureCollection', features });

    // Bubble source — only high-attention events
    const bubbleFeatures = features.filter(f => f.properties.bubble);
    const bubblesSrc = _map.getSource('bubbles');
    if (bubblesSrc) bubblesSrc.setData({ type: 'FeatureCollection', features: bubbleFeatures });

    // HTML bubble markers
    _updateBubbleMarkers(visibleEvents.filter(e => NewsAtlas.scoring.shouldBubble(e)));

    // Layer visibility
    _setDisplayMode(_currentMode);
  }

  /**
   * Update the heatmap source data.
   * @param {object} heatmapData  GeoJSON FeatureCollection
   */
  function updateHeatmap(heatmapData) {
    if (!_map || !_initialized) return;
    const src = _map.getSource('heatmap');
    if (src && heatmapData) src.setData(heatmapData);
  }

  /* ── HTML Bubble Markers ──────────────────────────────────── */

  function refreshSunlightOverlay(force) {
    if (!_map || !_map.getSource('sunlight-overlay')) return;

    const settings = NewsAtlas.ui && NewsAtlas.ui.getDisplaySettings
      ? NewsAtlas.ui.getDisplaySettings()
      : { showSunlight: true };
    const visible = Boolean(settings.showSunlight);

    _setLayerVisibility('sunlight-day', visible);
    _setLayerVisibility('sunlight-night', visible);

    if (!visible) {
      if (force) {
        const hiddenSrc = _map.getSource('sunlight-overlay');
        if (hiddenSrc) hiddenSrc.setData({ type: 'FeatureCollection', features: [] });
      }
      return;
    }

    try {
      const src = _map.getSource('sunlight-overlay');
      if (src) {
        src.setData(NewsAtlas.utils.getSunlightOverlayGeoJSON(new Date(), 0.5));
      }
    } catch (err) {
      console.warn('[map] Failed to refresh sunlight overlay:', err);
      if (force) {
        const src = _map.getSource('sunlight-overlay');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
      }
    }
  }

  function _updateBubbleMarkers(bubbleEvents) {
    // Remove existing markers
    _markers.forEach(m => m.remove());
    _markers = [];

    // Add new markers for top N events
    const top = bubbleEvents.slice(0, 10);
    top.forEach(event => {
      const hex = NewsAtlas.utils.categoryHex(event.category);
      const markerEl = document.createElement('div');
      markerEl.className = 'bubble-marker';

      const pulse = document.createElement('div');
      pulse.className = 'bubble-pulse';
      pulse.style.background   = `${hex}22`;
      pulse.style.borderColor  = hex;
      pulse.style.color        = hex; // for ::after pseudo-element

      const label = document.createElement('div');
      label.className = 'bubble-label';
      const titleText = event.title || '';
      label.textContent = titleText.length > 45
        ? titleText.substring(0, 45) + '…'
        : titleText;

      markerEl.appendChild(pulse);
      markerEl.appendChild(label);

      markerEl.addEventListener('click', () => {
        if (NewsAtlas.app) NewsAtlas.app.onEventSelect(event);
      });

      const marker = new maplibregl.Marker({ element: markerEl, anchor: 'center' })
        .setLngLat([event.lng, event.lat])
        .addTo(_map);

      _markers.push(marker);
    });
  }

  /* ── Display Mode ─────────────────────────────────────────── */

  function _setDisplayMode(mode) {
    if (!_map || !_initialized) return;
    const isDensity = mode === 'density';
    _setLayerVisibility('heatmap-layer',   isDensity);
    _setLayerVisibility('cluster-circles', !isDensity);
    _setLayerVisibility('cluster-count',   !isDensity);
    _setLayerVisibility('event-points',    !isDensity);
    _setLayerVisibility('bubble-rings',    !isDensity);
    _markers.forEach(m => {
      m.getElement().style.display = isDensity ? 'none' : 'flex';
    });
  }

  function _setLayerVisibility(layerId, visible) {
    if (_map && _map.getLayer(layerId)) {
      _map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  }

  /* ── Selected Event Highlight ─────────────────────────────── */

  function highlightEvent(event) {
    if (!_map || !_initialized) return;
    const src = _map.getSource('selected-event');
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: event ? [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [event.lng, event.lat] },
        properties: { colorHex: NewsAtlas.utils.categoryHex(event.category) }
      }] : []
    });
  }

  /* ── Popup ────────────────────────────────────────────────── */

  function showPopup(event) {
    if (_popup) _popup.remove();
    _popup = new maplibregl.Popup({
      closeOnClick: true,
      maxWidth: '280px',
      className: 'map-popup'
    })
      .setLngLat([event.lng, event.lat])
      .setHTML(NewsAtlas.renderers.popupContent(event))
      .addTo(_map);
  }

  /* ── Camera ───────────────────────────────────────────────── */

  function flyTo(lng, lat, zoom) {
    if (!_map) return;
    _map.flyTo({
      center: [lng, lat],
      zoom: zoom || 8,
      essential: true,
      duration: 1200
    });
  }

  /* ── Accessors ────────────────────────────────────────────── */

  function getZoom() { return _map ? _map.getZoom() : 2; }
  function getMap()  { return _map; }

  /* ── Public API ───────────────────────────────────────────── */

  return {
    init,
    updateEvents,
    updateHeatmap,
    highlightEvent,
    showPopup,
    flyTo,
    setTheme,
    refreshSunlightOverlay,
    getZoom,
    getMap
  };
})();
