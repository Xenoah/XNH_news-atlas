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

    // Based on NOAA's published solar position equations.
    const dayOfYear = this.getDayOfYear(date);
    const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    const daysInYear = this.isLeapYear(date.getUTCFullYear()) ? 366 : 365;
    const gamma = 2 * Math.PI / daysInYear * (dayOfYear - 1 + (utcMinutes / 60 - 12) / 24);
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

  normalizeLongitude(lng) {
    const normalized = ((Number(lng) + 180) % 360 + 360) % 360 - 180;
    return normalized === -180 ? -180 : normalized;
  },

  getSubsolarLongitude(context) {
    return this.normalizeLongitude(180 - (context.utcMinutes + context.eqTime) / 4);
  },

  getAboveAltitudeIntervals(lat, altitudeDeg, context) {
    const latitude = this.clamp(Number(lat), -89.999, 89.999);
    const latRad = latitude * Math.PI / 180;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const sinDecl = Math.sin(context.declination);
    const cosDecl = Math.cos(context.declination);
    const denominator = cosLat * cosDecl;

    if (Math.abs(denominator) < 1e-6) {
      const solar = this.getSunAltitude(latitude, this.getSubsolarLongitude(context), context);
      return solar && solar.altitude >= altitudeDeg ? [[-180, 180]] : [];
    }

    const target = Math.sin(altitudeDeg * Math.PI / 180);
    const ratio = (target - sinLat * sinDecl) / denominator;
    if (ratio <= -1) return [[-180, 180]];
    if (ratio >= 1) return [];

    const halfWidth = Math.acos(this.clamp(ratio, -1, 1)) * 180 / Math.PI;
    const center = this.getSubsolarLongitude(context);
    const west = this.normalizeLongitude(center - halfWidth);
    const east = this.normalizeLongitude(center + halfWidth);

    if (west <= east) return [[west, east]];
    return [[-180, east], [west, 180]];
  },

  complementIntervals(intervals) {
    if (!intervals.length) return [[-180, 180]];

    const result = [];
    let cursor = -180;
    intervals.forEach(([start, end]) => {
      if (start > cursor) result.push([cursor, start]);
      cursor = Math.max(cursor, end);
    });
    if (cursor < 180) result.push([cursor, 180]);
    return result.filter(([start, end]) => end - start > 1e-6);
  },

  subtractIntervals(baseIntervals, removeIntervals) {
    if (!baseIntervals.length) return [];
    if (!removeIntervals.length) return baseIntervals.map(([start, end]) => [start, end]);

    const result = [];
    baseIntervals.forEach(([baseStart, baseEnd]) => {
      let cursor = baseStart;
      removeIntervals.forEach(([removeStart, removeEnd]) => {
        if (removeEnd <= cursor || removeStart >= baseEnd) return;
        if (removeStart > cursor) result.push([cursor, Math.min(removeStart, baseEnd)]);
        cursor = Math.max(cursor, removeEnd);
      });
      if (cursor < baseEnd) result.push([cursor, baseEnd]);
    });

    return result.filter(([start, end]) => end - start > 1e-6);
  },

  getSunPhaseIntervals(lat, context) {
    const day = this.getAboveAltitudeIntervals(lat, 6, context);
    const lit = this.getAboveAltitudeIntervals(lat, -6, context);
    return {
      day,
      twilight: this.subtractIntervals(lit, day),
      night: this.complementIntervals(lit)
    };
  },

  intervalMidpoint(interval) {
    return (interval[0] + interval[1]) / 2;
  },

  pickMatchingInterval(intervals, seedInterval) {
    if (!intervals.length) return null;
    const midpoint = this.intervalMidpoint(seedInterval);
    const containing = intervals.find(([start, end]) => midpoint >= start && midpoint <= end);
    if (containing) return containing;

    return intervals.reduce((best, current) => {
      const bestDistance = Math.abs(this.intervalMidpoint(best) - midpoint);
      const currentDistance = Math.abs(this.intervalMidpoint(current) - midpoint);
      return currentDistance < bestDistance ? current : best;
    });
  },

  getSunlightOverlayGeoJSON(atDate, cellSizeDeg) {
    const context = this.getSolarContext(atDate);
    if (!context) {
      return { type: 'FeatureCollection', features: [] };
    }

    const step = Number(cellSizeDeg) > 0 ? Number(cellSizeDeg) : 1;
    const features = [];
    const phases = ['day', 'twilight', 'night'];

    for (let south = -90; south < 90; south += step) {
      const north = Math.min(south + step, 90);
      const centerLat = this.clamp(south + step / 2, -89.999, 89.999);
      const southPhases = this.getSunPhaseIntervals(this.clamp(south, -89.999, 89.999), context);
      const centerPhases = this.getSunPhaseIntervals(centerLat, context);
      const northPhases = this.getSunPhaseIntervals(this.clamp(north, -89.999, 89.999), context);

      for (const phase of phases) {
        centerPhases[phase].forEach((interval) => {
          const southInterval = this.pickMatchingInterval(southPhases[phase], interval) || interval;
          const northInterval = this.pickMatchingInterval(northPhases[phase], interval) || interval;
          const westSouth = southInterval[0];
          const eastSouth = southInterval[1];
          const westNorth = northInterval[0];
          const eastNorth = northInterval[1];

          if (
            eastSouth - westSouth <= 1e-6 &&
            eastNorth - westNorth <= 1e-6
          ) {
            return;
          }

          features.push({
            type: 'Feature',
            properties: { phase },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [westSouth, south],
                [eastSouth, south],
                [eastNorth, north],
                [westNorth, north],
                [westSouth, south]
              ]]
            }
          });
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

  isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
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
