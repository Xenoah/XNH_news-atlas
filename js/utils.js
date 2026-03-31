/* ============================================================
   UTILITIES — World News Map Viewer
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.utils = {
  /**
   * Format ISO date string to relative time: "2h ago", "5m ago", etc.
   */
  timeAgo(isoString) {
    if (!isoString) return 'unknown';
    const ms = Date.now() - new Date(isoString).getTime();
    if (isNaN(ms) || ms < 0) return 'just now';
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  },

  /**
   * Format ISO date to "Mar 28 14:32"
   */
  formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = months[d.getMonth()];
    const day = d.getDate();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${mon} ${day} ${h}:${m}`;
  },

  /**
   * Format number: 1200 -> "1.2K", 1500000 -> "1.5M"
   */
  formatCount(n) {
    if (n === null || n === undefined) return '0';
    const num = Number(n);
    if (isNaN(num)) return '0';
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return String(num);
  },

  /**
   * Clamp value between min and max
   */
  clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  },

  /**
   * Normalize value 0–max to 0–1
   */
  normalize(val, max) {
    if (!max || max === 0) return 0;
    return this.clamp(val / max, 0, 1);
  },

  /**
   * Deep clone object via JSON serialization
   */
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  /**
   * Create a debounced version of a function
   */
  debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Get CSS variable color string for a category
   */
  categoryColor(category) {
    const map = {
      politics:   'var(--cat-politics)',
      economy:    'var(--cat-economy)',
      conflict:   'var(--cat-conflict)',
      disaster:   'var(--cat-disaster)',
      science:    'var(--cat-science)',
      technology: 'var(--cat-technology)',
      health:     'var(--cat-health)',
      sports:     'var(--cat-sports)',
      culture:    'var(--cat-culture)',
      other:      'var(--cat-other)'
    };
    return map[category] || map.other;
  },

  /**
   * Get hex color for a category (needed for MapLibre which requires real colors)
   */
  categoryHex(category) {
    const map = {
      politics:   '#a78bfa',
      economy:    '#34d399',
      conflict:   '#f87171',
      disaster:   '#fb923c',
      science:    '#38bdf8',
      technology: '#818cf8',
      health:     '#f472b6',
      sports:     '#4ade80',
      culture:    '#fbbf24',
      other:      '#94a3b8'
    };
    return map[category] || map.other;
  },

  getSolarContext(atDate) {
    const date = atDate instanceof Date ? atDate : new Date(atDate || Date.now());
    if (isNaN(date.getTime())) return null;

    const dayOfYear = this.getDayOfYear(date);
    const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + (utcMinutes / 60 - 12) / 24);
    const eqTime = 229.18 * (
      0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma)
    );
    const decl = (
      0.006918 -
      0.399912 * Math.cos(gamma) +
      0.070257 * Math.sin(gamma) -
      0.006758 * Math.cos(2 * gamma) +
      0.000907 * Math.sin(2 * gamma) -
      0.002697 * Math.cos(3 * gamma) +
      0.00148 * Math.sin(3 * gamma)
    );

    return {
      date,
      utcMinutes,
      eqTime,
      declination: decl
    };
  },

  getSunAltitude(lat, lng, contextOrDate) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const context = contextOrDate && typeof contextOrDate === 'object' && 'declination' in contextOrDate
      ? contextOrDate
      : this.getSolarContext(contextOrDate);
    if (!context) return null;

    let trueSolarMinutes = context.utcMinutes + context.eqTime + 4 * longitude;
    trueSolarMinutes = ((trueSolarMinutes % 1440) + 1440) % 1440;

    let hourAngleDeg = trueSolarMinutes / 4 - 180;
    if (hourAngleDeg < -180) hourAngleDeg += 360;

    const latRad = latitude * Math.PI / 180;
    const haRad = hourAngleDeg * Math.PI / 180;
    const cosZenith = this.clamp(
      Math.sin(latRad) * Math.sin(context.declination) + Math.cos(latRad) * Math.cos(context.declination) * Math.cos(haRad),
      -1,
      1
    );
    return {
      altitude: 90 - (Math.acos(cosZenith) * 180 / Math.PI),
      localSolarMinutes: trueSolarMinutes,
      hourAngleDeg
    };
  },

  /**
   * Estimate current sunlight conditions for a coordinate using NOAA-style solar position math.
   */
  getSunlightState(lat, lng, atDate) {
    const solar = this.getSunAltitude(lat, lng, atDate);
    if (!solar) return null;
    const altitude = solar.altitude;

    let phase = 'night';
    let label = 'Night';
    let accent = 'night';
    if (altitude >= 6) {
      phase = 'day';
      label = 'Daylight';
      accent = 'day';
    } else if (altitude > -6) {
      phase = solar.hourAngleDeg < 0 ? 'dawn' : 'dusk';
      label = solar.hourAngleDeg < 0 ? 'Dawn' : 'Dusk';
      accent = phase;
    }

    return {
      phase,
      label,
      accent,
      altitude: Math.round(altitude * 10) / 10,
      localSolarTime: this.formatClock24(solar.localSolarMinutes)
    };
  },

  getSunlightOverlayGeoJSON(atDate, cellSizeDeg) {
    const context = this.getSolarContext(atDate);
    if (!context) {
      return { type: 'FeatureCollection', features: [] };
    }

    const step = Number(cellSizeDeg) > 0 ? Number(cellSizeDeg) : 6;
    const features = [];

    for (let lat = -90; lat < 90; lat += step) {
      const north = Math.min(lat + step, 90);
      const centerLat = Math.max(-89.5, Math.min(89.5, lat + step / 2));

      for (let lng = -180; lng < 180; lng += step) {
        const east = Math.min(lng + step, 180);
        const centerLng = lng + step / 2;
        const solar = this.getSunAltitude(centerLat, centerLng, context);
        if (!solar) continue;

        const phase = solar.altitude <= -6 ? 'night' : solar.altitude < 6 ? 'twilight' : '';
        if (!phase) continue;

        features.push({
          type: 'Feature',
          properties: { phase },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [lng, lat],
              [east, lat],
              [east, north],
              [lng, north],
              [lng, lat]
            ]]
          }
        });
      }
    }

    return {
      type: 'FeatureCollection',
      features
    };
  },

  getDayOfYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((current - start) / 86400000);
  },

  formatClock24(totalMinutes) {
    const minutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mins = String(minutes % 60).padStart(2, '0');
    return `${hours}:${mins}`;
  },

  /**
   * Escape HTML special characters
   */
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * Safely get a nested property from an object by dot-separated path
   * @param {object} obj
   * @param {string} path  e.g. "a.b.c"
   * @param {*} def  default value if not found
   */
  get(obj, path, def) {
    if (obj === null || obj === undefined) return def;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return def;
      current = current[part];
    }
    return current !== undefined ? current : def;
  }
};
