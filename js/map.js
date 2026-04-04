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
  const TIMEZONE_BOUNDARIES_URL = 'https://cdn.jsdelivr.net/gh/dejurin/simplified-timezone-boundaries@main/output.geojson';
  const COUNTRY_BOUNDARY_URLS = [
    'https://cdn.jsdelivr.net/gh/datasets/geo-boundaries-world-110m@main/countries.geojson',
    'https://datahub.io/core/geo-boundaries-world-110m/_r/-/countries.geojson'
  ];
  let _timezoneDataPromise = null;
  let _timezoneDataLoaded = false;
  let _countryDataPromise = null;
  let _countryDataLoaded = false;

  function _getTimezoneFillExpression(theme) {
    const palette = theme === 'light'
      ? [
          'rgba(214, 132, 88, 0.18)',
          'rgba(120, 176, 204, 0.18)',
          'rgba(202, 158, 88, 0.18)',
          'rgba(136, 192, 146, 0.18)',
          'rgba(181, 144, 209, 0.18)',
          'rgba(226, 154, 118, 0.18)',
          'rgba(144, 184, 132, 0.18)',
          'rgba(120, 164, 219, 0.18)',
          'rgba(214, 138, 170, 0.18)',
          'rgba(190, 182, 114, 0.18)',
          'rgba(112, 190, 186, 0.18)',
          'rgba(196, 148, 118, 0.18)'
        ]
      : [
          'rgba(170, 101, 72, 0.14)',
          'rgba(79, 137, 165, 0.14)',
          'rgba(174, 133, 67, 0.14)',
          'rgba(86, 148, 101, 0.14)',
          'rgba(135, 101, 177, 0.14)',
          'rgba(186, 110, 80, 0.14)',
          'rgba(104, 140, 82, 0.14)',
          'rgba(78, 120, 182, 0.14)',
          'rgba(172, 95, 128, 0.14)',
          'rgba(154, 145, 71, 0.14)',
          'rgba(71, 148, 144, 0.14)',
          'rgba(154, 112, 84, 0.14)'
        ];

    const expression = ['match', ['get', 'utcOffsetMinutes']];
    for (let minutes = -720; minutes <= 840; minutes += 15) {
      const colorIndex = Math.floor((minutes + 720) / 15) % palette.length;
      expression.push(minutes, palette[colorIndex]);
    }
    expression.push(theme === 'light' ? 'rgba(180, 180, 180, 0.14)' : 'rgba(120, 120, 120, 0.12)');
    return expression;
  }

  function _getTimezoneOutlineColor(theme) {
    return theme === 'light' ? 'rgba(138,88,58,0.55)' : 'rgba(232,196,154,0.36)';
  }

  function _getTimezoneLabelColor(theme) {
    return theme === 'light' ? 'rgba(102,51,22,0.82)' : 'rgba(245,222,189,0.74)';
  }

  function _getTimezoneLabelHaloColor(theme) {
    return theme === 'light' ? 'rgba(252,248,238,0.86)' : 'rgba(8,12,18,0.82)';
  }

  function _getCountryBoundaryColor(theme) {
    return theme === 'light' ? 'rgba(122,72,42,0.72)' : 'rgba(240,213,176,0.42)';
  }

  function _getCountryFillColor(theme) {
    return theme === 'light' ? 'rgba(191, 137, 108, 0.08)' : 'rgba(226, 192, 160, 0.05)';
  }

  function _getTaiwanBoundaryColor(theme) {
    return theme === 'light' ? 'rgba(161,74,42,0.94)' : 'rgba(255,210,138,0.82)';
  }

  function _parseTimeZoneOffset(tzid, atDate = new Date()) {
    if (!tzid) return null;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tzid,
        timeZoneName: 'shortOffset',
        hour: '2-digit'
      });
      const parts = formatter.formatToParts(atDate);
      const zoneName = parts.find(part => part.type === 'timeZoneName')?.value || '';
      if (zoneName === 'GMT' || zoneName === 'UTC') {
        return { minutes: 0, label: 'UTC+0' };
      }
      const match = zoneName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
      if (!match) return null;
      const sign = match[1] === '-' ? -1 : 1;
      const hours = Number(match[2] || 0);
      const mins = Number(match[3] || 0);
      const totalMinutes = sign * (hours * 60 + mins);
      const offsetLabel = mins
        ? `UTC${sign > 0 ? '+' : '-'}${hours}:${String(mins).padStart(2, '0')}`
        : `UTC${sign > 0 ? '+' : '-'}${hours}`;
      return { minutes: totalMinutes, label: offsetLabel };
    } catch (_) {
      return null;
    }
  }

  function _buildTimezoneBoundaryData(rawData) {
    const base = rawData && rawData.type === 'FeatureCollection' ? rawData : { type: 'FeatureCollection', features: [] };
    const now = new Date();
    return {
      type: 'FeatureCollection',
      features: (base.features || []).map(feature => {
        const props = feature && feature.properties ? { ...feature.properties } : {};
        const offset = _parseTimeZoneOffset(props.tzid, now);
        props.utcOffsetMinutes = offset ? offset.minutes : 0;
        props.utcOffsetLabel = offset ? offset.label : 'UTC';
        return {
          ...feature,
          properties: props
        };
      })
    };
  }

  function _buildCountryBoundaryData(rawData) {
    const base = rawData && rawData.type === 'FeatureCollection' ? rawData : { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: (base.features || []).map(feature => {
        const props = feature && feature.properties ? { ...feature.properties } : {};
        const iso3 = String(
          props['ISO3166-1-Alpha-3'] ||
          props.iso_a3 ||
          props.ADM0_A3 ||
          props.adm0_a3 ||
          ''
        ).toUpperCase();
        return {
          ...feature,
          properties: {
            ...props,
            countryCode3: iso3,
            countryName: iso3 === 'TWN'
              ? 'Taiwan'
              : (props.name || props.ADMIN || props.admin || props.NAME || ''),
            isTaiwan: iso3 === 'TWN'
          }
        };
      })
    };
  }

  async function _ensureTimezoneBoundariesLoaded() {
    if (_timezoneDataLoaded) return true;
    if (_timezoneDataPromise) return _timezoneDataPromise;
    _timezoneDataPromise = fetch(TIMEZONE_BOUNDARIES_URL)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Timezone boundaries fetch failed: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        const src = _map && _map.getSource('timezone-grid');
        if (src) {
          src.setData(_buildTimezoneBoundaryData(data));
          _timezoneDataLoaded = true;
        }
        return true;
      })
      .catch(err => {
        console.warn('[map] Failed to load timezone boundaries:', err);
        return false;
      })
      .finally(() => {
        _timezoneDataPromise = null;
      });
    return _timezoneDataPromise;
  }

  async function _ensureCountryBoundariesLoaded() {
    if (_countryDataLoaded) return true;
    if (_countryDataPromise) return _countryDataPromise;
    _countryDataPromise = (async () => {
      let lastError = null;
      for (const url of COUNTRY_BOUNDARY_URLS) {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Country boundaries fetch failed: ${response.status}`);
          }
          const data = await response.json();
          const src = _map && _map.getSource('country-boundaries');
          if (src) {
            src.setData(_buildCountryBoundaryData(data));
            _countryDataLoaded = true;
          }
          return true;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error('Country boundaries fetch failed');
    })()
      .then(data => {
        return true;
      })
      .catch(err => {
        console.warn('[map] Failed to load country boundaries:', err);
        return false;
      })
      .finally(() => {
        _countryDataPromise = null;
      });
    return _countryDataPromise;
  }

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
        refreshTimezoneGrid();
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
    if (_map.getLayer('timezone-zone-fills')) {
      _map.setPaintProperty('timezone-zone-fills', 'fill-color', _getTimezoneFillExpression(_currentBaseTheme));
    }
    if (_map.getLayer('timezone-grid-lines')) {
      _map.setPaintProperty('timezone-grid-lines', 'line-color', _getTimezoneOutlineColor(_currentBaseTheme));
    }
    if (_map.getLayer('timezone-grid-labels')) {
      _map.setPaintProperty('timezone-grid-labels', 'text-color', _getTimezoneLabelColor(_currentBaseTheme));
      _map.setPaintProperty('timezone-grid-labels', 'text-halo-color', _getTimezoneLabelHaloColor(_currentBaseTheme));
    }
    if (_map.getLayer('country-boundary-lines')) {
      _map.setPaintProperty('country-boundary-lines', 'line-color', _getCountryBoundaryColor(_currentBaseTheme));
    }
    if (_map.getLayer('country-boundary-fills')) {
      _map.setPaintProperty('country-boundary-fills', 'fill-color', _getCountryFillColor(_currentBaseTheme));
    }
    if (_map.getLayer('country-boundary-taiwan')) {
      _map.setPaintProperty('country-boundary-taiwan', 'line-color', _getTaiwanBoundaryColor(_currentBaseTheme));
    }
  }

  /* ── Sources ──────────────────────────────────────────────── */

  function _setupSources() {
    _map.addSource('sunlight-overlay', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    _map.addSource('timezone-grid', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    _map.addSource('country-boundaries', {
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
      id: 'timezone-zone-fills',
      type: 'fill',
      source: 'timezone-grid',
      paint: {
        'fill-color': _getTimezoneFillExpression(_currentBaseTheme),
        'fill-opacity': 1
      }
    });

    _map.addLayer({
      id: 'timezone-grid-lines',
      type: 'line',
      source: 'timezone-grid',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': _getTimezoneOutlineColor(_currentBaseTheme),
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          1, 0.7,
          3, 1,
          6, 1.6
        ],
        'line-opacity': 0.92
      }
    });

    _map.addLayer({
      id: 'timezone-grid-labels',
      type: 'symbol',
      source: 'timezone-grid',
      minzoom: 1.5,
      layout: {
        'text-field': ['get', 'utcOffsetLabel'],
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          1.5, 10,
          3, 12,
          5, 14
        ],
        'text-letter-spacing': 0.08,
        'text-max-width': 4,
        'symbol-placement': 'point',
        'text-allow-overlap': false
      },
      paint: {
        'text-color': _getTimezoneLabelColor(_currentBaseTheme),
        'text-halo-color': _getTimezoneLabelHaloColor(_currentBaseTheme),
        'text-halo-width': 1.2,
        'text-opacity': 0.95
      }
    });

    _map.addLayer({
      id: 'country-boundary-fills',
      type: 'fill',
      source: 'country-boundaries',
      paint: {
        'fill-color': _getCountryFillColor(_currentBaseTheme),
        'fill-opacity': 1
      }
    });

    _map.addLayer({
      id: 'country-boundary-lines',
      type: 'line',
      source: 'country-boundaries',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': _getCountryBoundaryColor(_currentBaseTheme),
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          1, 0.65,
          3, 0.9,
          6, 1.25,
          10, 1.8
        ],
        'line-opacity': 0.92
      }
    });

    _map.addLayer({
      id: 'country-boundary-taiwan',
      type: 'line',
      source: 'country-boundaries',
      filter: ['==', ['get', 'countryCode3'], 'TWN'],
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': _getTaiwanBoundaryColor(_currentBaseTheme),
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          1, 1.1,
          3, 1.35,
          6, 1.85,
          10, 2.4
        ],
        'line-opacity': 1
      }
    });

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

    const ranked = [...events].sort((a, b) => (b.attentionScore || 0) - (a.attentionScore || 0));
    if (_currentZoomCategory === 'high') {
      return ranked;
    }

    if (_currentZoomCategory === 'mid') {
      return ranked
        .filter(e => NewsAtlas.scoring.shouldBubble(e) || (e.attentionScore || 0) >= 0.45)
        .slice(0, 1200);
    }

    const highPriority = ranked
      .filter(e => NewsAtlas.scoring.shouldBubble(e) || (e.attentionScore || 0) >= 0.72)
      .slice(0, 250);
    const regionalRepresentatives = _pickRegionalRepresentatives(ranked);
    return _mergeVisibleEvents(regionalRepresentatives, highPriority, 250);
  }

  function _pickRegionalRepresentatives(rankedEvents) {
    const regions = new Map();

    rankedEvents.forEach((event) => {
      const key = _getRegionKey(event);
      if (!key) return;
      if (!regions.has(key)) regions.set(key, []);
      regions.get(key).push(event);
    });

    return Array.from(regions.values())
      .map((regionEvents) => {
        const bubbleEvent = regionEvents.find(e => NewsAtlas.scoring.shouldBubble(e));
        return bubbleEvent || regionEvents[0];
      })
      .filter(Boolean)
      .sort((a, b) => (b.attentionScore || 0) - (a.attentionScore || 0));
  }

  function _getRegionKey(event) {
    const lat = Number(event && event.lat);
    const lng = Number(event && event.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const latBand = Math.max(0, Math.min(5, Math.floor((lat + 90) / 30)));
    const lngBand = Math.max(0, Math.min(7, Math.floor((lng + 180) / 45)));
    return `${latBand}:${lngBand}`;
  }

  function _mergeVisibleEvents(primaryEvents, supplementalEvents, limit) {
    const merged = [];
    const seenIds = new Set();

    [...primaryEvents, ...supplementalEvents].forEach((event) => {
      const eventKey = _getEventIdentity(event);
      if (!event || seenIds.has(eventKey)) return;
      seenIds.add(eventKey);
      merged.push(event);
    });

    return merged.slice(0, limit);
  }

  function _getEventIdentity(event) {
    if (!event) return null;
    if (event.id) return `id:${event.id}`;
    return `fallback:${event.title || ''}:${event.lat || ''}:${event.lng || ''}:${event.publishedAt || ''}`;
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

  function refreshTimezoneGrid() {
    if (!_map) return;

    const settings = NewsAtlas.ui && NewsAtlas.ui.getDisplaySettings
      ? NewsAtlas.ui.getDisplaySettings()
      : { boundaryMode: 'timezone' };
    const mode = ['off', 'timezone', 'country'].includes(settings.boundaryMode)
      ? settings.boundaryMode
      : (settings.showTimezoneGrid ? 'timezone' : 'off');
    const showTimezone = mode === 'timezone';
    const showCountry = mode === 'country';

    _setLayerVisibility('timezone-zone-fills', showTimezone);
    _setLayerVisibility('timezone-grid-lines', showTimezone);
    _setLayerVisibility('timezone-grid-labels', showTimezone);
    _setLayerVisibility('country-boundary-fills', showCountry);
    _setLayerVisibility('country-boundary-lines', showCountry);
    _setLayerVisibility('country-boundary-taiwan', showCountry);

    if (showTimezone && _map.getSource('timezone-grid')) {
      _ensureTimezoneBoundariesLoaded();
    }
    if (showCountry && _map.getSource('country-boundaries')) {
      _ensureCountryBoundariesLoaded();
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

  function clearPopup() {
    if (_popup) {
      _popup.remove();
      _popup = null;
    }
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
    clearPopup,
    flyTo,
    setTheme,
    refreshSunlightOverlay,
    refreshTimezoneGrid,
    getZoom,
    getMap
  };
})();
