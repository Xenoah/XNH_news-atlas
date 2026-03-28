/* ============================================================
   DATA LAYER — World News Map Viewer
   Tries live API first; falls back to static JSON files.
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.data = (function() {
  const LIVE_API_BASE = 'http://localhost:8787';
  const STATIC_BASE   = './data';

  let _mode  = 'static';
  let _cache = {};

  /**
   * Probe the live API endpoint with a short timeout.
   * @returns {Promise<boolean>}
   */
  async function checkLive() {
    try {
      const res = await fetch(`${LIVE_API_BASE}/status`, {
        signal: AbortSignal.timeout(2000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch JSON from a URL, caching the result in memory.
   */
  async function fetchJSON(url) {
    if (_cache[url]) return _cache[url];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const data = await res.json();
    _cache[url] = data;
    return data;
  }

  /**
   * Detect data mode. Returns 'live' or 'static'.
   */
  async function init() {
    const isLive = await checkLive();
    _mode = isLive ? 'live' : 'static';
    return _mode;
  }

  /**
   * Fetch the full list of world events.
   * @returns {Promise<object[]>}
   */
  async function getEvents() {
    const url = _mode === 'live'
      ? `${LIVE_API_BASE}/events/latest`
      : `${STATIC_BASE}/world-latest.json`;
    const data = await fetchJSON(url);
    return Array.isArray(data) ? data : (data.events || []);
  }

  /**
   * Fetch top headline events.
   * @returns {Promise<object[]>}
   */
  async function getHeadlines() {
    const url = _mode === 'live'
      ? `${LIVE_API_BASE}/headlines`
      : `${STATIC_BASE}/top-headlines.json`;
    const data = await fetchJSON(url);
    return Array.isArray(data) ? data : (data.headlines || data.events || []);
  }

  /**
   * Fetch trend metadata.
   * @returns {Promise<object>}
   */
  async function getTrends() {
    const url = _mode === 'live'
      ? `${LIVE_API_BASE}/trends`
      : `${STATIC_BASE}/trends.json`;
    return fetchJSON(url);
  }

  /**
   * Fetch heatmap GeoJSON for the given time range.
   * @param {'1h'|'24h'} range
   * @returns {Promise<object>}
   */
  async function getHeatmap(range) {
    const file = range === '1h' ? 'heatmap-1h.json' : 'heatmap-24h.json';
    const url = _mode === 'live'
      ? `${LIVE_API_BASE}/heatmap?range=${range}`
      : `${STATIC_BASE}/${file}`;
    return fetchJSON(url);
  }

  /** Return current data mode string ('live' | 'static') */
  function getMode() { return _mode; }

  /** Clear the in-memory fetch cache */
  function clearCache() { _cache = {}; }

  return { init, getEvents, getHeadlines, getTrends, getHeatmap, getMode, clearCache };
})();
