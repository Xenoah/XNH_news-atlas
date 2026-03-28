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
