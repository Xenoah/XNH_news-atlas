/* ============================================================
   DATA LAYER — World News Map Viewer
   ============================================================
   Data priority:
     1. Live local API  (localhost:8787)  → mode = 'live'
     2. Static JSON     (pre-fetched GA)  → mode = 'static'  ← default
     3. Browser GDELT   (user refreshes)  → mode = 'gdelt'
     4. Country detail  (zoom drill-down) → mode = 'gdelt'

   The initial page load always uses static JSON (fast).
   GDELT is only called from the browser when the user
   explicitly requests a refresh or drills into a region.
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.data = (function() {
  const LIVE_API_BASE = 'http://localhost:8787';
  const STATIC_BASE   = './data';
  const GDELT_API     = 'https://api.gdeltproject.org/api/v2/doc/doc';

  let _mode        = 'static';
  let _cache       = {};
  let _gdeltActive = false;   // true only when user triggered a browser GDELT refresh

  async function _fetchStaticWithFallback(files, fallbackValue) {
    let lastError = null;
    for (const file of files) {
      try {
        return await _fetchJSON(`${STATIC_BASE}/${file}`);
      } catch (err) {
        lastError = err;
      }
    }
    if (typeof fallbackValue !== 'undefined') return fallbackValue;
    throw lastError || new Error('Static JSON not available');
  }

  /* ── Country Coordinates ──────────────────────────────────── */

  const CC = {
    'United States':    { code: 'US', lat:  38.89, lng:  -77.03 },
    'United Kingdom':   { code: 'GB', lat:  51.51, lng:   -0.13 },
    'France':           { code: 'FR', lat:  48.86, lng:    2.35 },
    'Germany':          { code: 'DE', lat:  52.52, lng:   13.40 },
    'Russia':           { code: 'RU', lat:  55.75, lng:   37.62 },
    'China':            { code: 'CN', lat:  39.91, lng:  116.39 },
    'Japan':            { code: 'JP', lat:  35.69, lng:  139.69 },
    'India':            { code: 'IN', lat:  28.61, lng:   77.21 },
    'Brazil':           { code: 'BR', lat: -15.78, lng:  -47.93 },
    'Australia':        { code: 'AU', lat: -33.87, lng:  151.21 },
    'Canada':           { code: 'CA', lat:  45.42, lng:  -75.70 },
    'South Korea':      { code: 'KR', lat:  37.57, lng:  126.98 },
    'Ukraine':          { code: 'UA', lat:  50.45, lng:   30.52 },
    'Israel':           { code: 'IL', lat:  31.77, lng:   35.22 },
    'Iran':             { code: 'IR', lat:  35.69, lng:   51.39 },
    'Pakistan':         { code: 'PK', lat:  33.72, lng:   73.06 },
    'Turkey':           { code: 'TR', lat:  39.93, lng:   32.86 },
    'Saudi Arabia':     { code: 'SA', lat:  24.69, lng:   46.72 },
    'Nigeria':          { code: 'NG', lat:   9.08, lng:    7.40 },
    'Egypt':            { code: 'EG', lat:  30.04, lng:   31.24 },
    'Mexico':           { code: 'MX', lat:  19.43, lng:  -99.13 },
    'Indonesia':        { code: 'ID', lat:  -6.21, lng:  106.85 },
    'Poland':           { code: 'PL', lat:  52.23, lng:   21.01 },
    'Taiwan':           { code: 'TW', lat:  25.05, lng:  121.56 },
    'Spain':            { code: 'ES', lat:  40.42, lng:   -3.70 },
    'Italy':            { code: 'IT', lat:  41.90, lng:   12.50 },
    'Netherlands':      { code: 'NL', lat:  52.37, lng:    4.90 },
    'Switzerland':      { code: 'CH', lat:  46.95, lng:    7.45 },
    'Sweden':           { code: 'SE', lat:  59.33, lng:   18.07 },
    'Singapore':        { code: 'SG', lat:   1.35, lng:  103.82 },
    'South Africa':     { code: 'ZA', lat: -25.75, lng:   28.19 },
    'North Korea':      { code: 'KP', lat:  39.02, lng:  125.76 },
    'Colombia':         { code: 'CO', lat:   4.71, lng:  -74.07 },
  };

  /* ── GDELT Topic Definitions ──────────────────────────────── */

  const TOPICS = [
    // conflict
    { q: 'ukraine russia war military ceasefire Kyiv frontline',
      country: 'Ukraine',        code: 'UA', lat:  50.45, lng:  30.52, cat: 'conflict' },
    { q: 'israel gaza hamas war ceasefire hostages West Bank IDF',
      country: 'Israel',         code: 'IL', lat:  31.77, lng:  35.22, cat: 'conflict' },
    { q: 'taiwan strait china military PLA threat',
      country: 'Taiwan',         code: 'TW', lat:  25.05, lng: 121.56, cat: 'conflict' },
    { q: 'north korea missile nuclear Kim Jong-un Pyongyang',
      country: 'North Korea',    code: 'KP', lat:  39.02, lng: 125.76, cat: 'conflict' },
    { q: 'nigeria sahel africa conflict insurgency coup',
      country: 'Nigeria',        code: 'NG', lat:   9.08, lng:   7.40, cat: 'conflict' },
    { q: 'iran israel strike missile attack Middle East escalation',
      country: 'Iran',           code: 'IR', lat:  35.69, lng:  51.39, cat: 'conflict' },
    { q: 'myanmar civil war junta resistance coup',
      country: 'Myanmar',        code: 'MM', lat:  16.87, lng:  96.15, cat: 'conflict' },
    // politics
    { q: 'united states trump congress white house tariff politics',
      country: 'United States',  code: 'US', lat:  38.89, lng: -77.03, cat: 'politics' },
    { q: 'france macron paris government politics parliament',
      country: 'France',         code: 'FR', lat:  48.86, lng:   2.35, cat: 'politics' },
    { q: 'india modi BJP parliament Delhi election',
      country: 'India',          code: 'IN', lat:  28.61, lng:  77.21, cat: 'politics' },
    { q: 'UK Britain parliament London Starmer government',
      country: 'United Kingdom', code: 'GB', lat:  51.51, lng:  -0.13, cat: 'politics' },
    { q: 'russia kremlin Putin opposition politics',
      country: 'Russia',         code: 'RU', lat:  55.75, lng:  37.62, cat: 'politics' },
    { q: 'iran nuclear sanctions Tehran Khamenei deal',
      country: 'Iran',           code: 'IR', lat:  35.69, lng:  51.39, cat: 'politics' },
    // economy
    { q: 'germany economy recession inflation Berlin GDP',
      country: 'Germany',        code: 'DE', lat:  52.52, lng:  13.40, cat: 'economy' },
    { q: 'china economy trade tariff GDP Beijing stimulus',
      country: 'China',          code: 'CN', lat:  39.91, lng: 116.39, cat: 'economy' },
    { q: 'oil gas OPEC Saudi Arabia energy prices market',
      country: 'Saudi Arabia',   code: 'SA', lat:  24.69, lng:  46.72, cat: 'economy' },
    { q: 'federal reserve interest rates inflation Wall Street',
      country: 'United States',  code: 'US', lat:  40.71, lng: -74.01, cat: 'economy' },
    { q: 'japan economy yen Tokyo Bank of Japan interest',
      country: 'Japan',          code: 'JP', lat:  35.69, lng: 139.69, cat: 'economy' },
    { q: 'cryptocurrency bitcoin blockchain market crash',
      country: 'United States',  code: 'US', lat:  37.77, lng:-122.42, cat: 'economy' },
    // technology
    { q: 'artificial intelligence AI OpenAI ChatGPT regulation',
      country: 'United States',  code: 'US', lat:  37.38, lng:-122.08, cat: 'technology' },
    { q: 'cybersecurity hack data breach ransomware attack',
      country: 'United States',  code: 'US', lat:  38.89, lng: -77.03, cat: 'technology' },
    { q: 'space mission NASA SpaceX rocket Starship launch moon',
      country: 'United States',  code: 'US', lat:  28.45, lng: -80.53, cat: 'science' },
    // health
    { q: 'WHO health pandemic disease outbreak virus epidemic',
      country: 'Switzerland',    code: 'CH', lat:  46.95, lng:   7.45, cat: 'health' },
    { q: 'mpox bird flu H5N1 outbreak spread cases',
      country: null,             code: null, lat:  null,  lng:  null,  cat: 'health' },
    // disaster (auto-detect location)
    { q: 'earthquake tsunami magnitude Richter victims',
      country: null,             code: null, lat:  null,  lng:  null,  cat: 'disaster' },
    { q: 'hurricane typhoon cyclone flood disaster emergency',
      country: null,             code: null, lat:  null,  lng:  null,  cat: 'disaster' },
    // science
    { q: 'climate change global warming emissions carbon',
      country: 'United Kingdom', code: 'GB', lat:  51.51, lng:  -0.13, cat: 'science' },
  ];

  /* ── GDELT Date Parser ────────────────────────────────────── */

  function _parseDate(s) {
    if (!s) return new Date().toISOString();
    try {
      const c = s.replace('T', '').replace('Z', '');
      return `${c.slice(0,4)}-${c.slice(4,6)}-${c.slice(6,8)}T${c.slice(8,10)||'00'}:${c.slice(10,12)||'00'}:00Z`;
    } catch { return new Date().toISOString(); }
  }

  /* ── Fetch one GDELT topic ────────────────────────────────── */

  async function _fetchTopic(topic, timespan) {
    const params = new URLSearchParams({
      query: topic.q, mode: 'artlist', maxrecords: '25',
      format: 'json', sourcelang: 'english', timespan: timespan || '24h'
    });

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 12000);
    let articles;
    try {
      const res  = await fetch(`${GDELT_API}?${params}`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) return null;
      const body = await res.json();
      articles   = (body.articles || []).filter(a => a.url && a.title);
    } catch { clearTimeout(tid); return null; }

    if (!articles.length) return null;

    // Resolve location
    let { country, code, lat, lng } = topic;
    if (lat == null) {
      const freq = {};
      articles.forEach(a => { if (a.sourcecountry) freq[a.sourcecountry] = (freq[a.sourcecountry]||0)+1; });
      const top = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];
      if (top && CC[top[0]]) {
        const c = CC[top[0]]; lat = c.lat; lng = c.lng; country = top[0]; code = c.code;
      }
    }
    if (lat == null) return null;

    articles.sort((a,b) => (b.seendate||'').localeCompare(a.seendate||''));
    const top0         = articles[0];
    const articleCount = articles.length;
    const sourceCount  = new Set(articles.map(a=>a.domain).filter(Boolean)).size;
    const velocity     = Math.min(articleCount / 25, 1);
    const crossBorder  = sourceCount >= 6 ? 0.9 : sourceCount >= 3 ? 0.5 : 0.2;
    const attention    = (NewsAtlas.scoring && NewsAtlas.scoring.calcAttentionScore)
      ? NewsAtlas.scoring.calcAttentionScore({ articleCount, sourceCount, velocityScore: velocity, category: topic.cat, crossBorderFactor: crossBorder })
      : Math.min(0.25 + articleCount*0.05 + sourceCount*0.03, 0.98);
    const publishedAt  = _parseDate(top0.seendate);

    return {
      id: `gdelt_${topic.cat}_${code||'XX'}_${Date.now().toString(36)}`,
      title: top0.title,
      summary: `${articleCount} articles from ${sourceCount} sources covering ${topic.cat} developments${country ? ' in '+country : ''}.`,
      category: topic.cat,
      countryCode: code || 'XX', countryName: country || 'Unknown',
      regionName: country || 'Unknown', locationName: country || 'Unknown',
      lat, lng,
      geoPrecision: topic.lat != null ? 'city' : 'country',
      publishedAt, firstSeenAt: publishedAt,
      lastUpdatedAt: new Date().toISOString(),
      freshness: 'fresh', articleCount, sourceCount,
      attentionScore: attention, velocityScore: velocity,
      crossBorderFactor: crossBorder,
      bubble: attention >= 0.78,
      tags: topic.q.split(' ').filter(w=>w.length>3).slice(0, 5),
      sources: articles.slice(0, 12).map(a => ({
        name: a.domain || 'unknown', url: a.url,
        title: a.title, publishedAt: _parseDate(a.seendate)
      }))
    };
  }

  /* ── Fetch all topics from GDELT ──────────────────────────── */

  async function _fetchAllGDELT(timespan) {
    const BATCH = 4;
    const results = [];
    for (let i = 0; i < TOPICS.length; i += BATCH) {
      const batch   = TOPICS.slice(i, i + BATCH);
      const settled = await Promise.allSettled(batch.map(t => _fetchTopic(t, timespan)));
      settled.forEach(r => { if (r.status === 'fulfilled' && r.value) results.push(r.value); });
      if (i + BATCH < TOPICS.length) await new Promise(r => setTimeout(r, 150));
    }
    if (!results.length) throw new Error('GDELT: no results');
    return results;
  }

  /* ── Live local probe ─────────────────────────────────────── */

  async function _checkLive() {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(`${LIVE_API_BASE}/status`, { signal: ctrl.signal });
      return res.ok;
    } catch { return false; }
  }

  /* ── fetchJSON with cache ─────────────────────────────────── */

  async function _fetchJSON(url) {
    if (_cache[url]) return _cache[url];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _cache[url] = data;
    return data;
  }

  /* ── Public: init ─────────────────────────────────────────── */

  async function init() {
    const live = await _checkLive();
    _mode = live ? 'live' : 'static';
    return _mode;
  }

  /* ── Public: getEvents ────────────────────────────────────── */
  // Default: load pre-fetched static JSON (instant).
  // If user triggered a GDELT refresh, fetch from browser.

  async function getEvents() {
    if (_mode === 'live') {
      const data = await _fetchJSON(`${LIVE_API_BASE}/events/latest`);
      return Array.isArray(data) ? data : (data.events || []);
    }

    if (_gdeltActive) {
      try {
        const events = await _fetchAllGDELT('24h');
        _mode = 'gdelt';
        return events;
      } catch (err) {
        console.warn('[data] Browser GDELT failed, falling back to static:', err.message);
        _gdeltActive = false;
        _mode = 'static';
      }
    }

    // Default: fast static JSON
    const data = await _fetchStaticWithFallback(
      ['world-latest.json', 'world-latest.fixed.json'],
      []
    );
    return Array.isArray(data) ? data : (data.events || []);
  }

  async function getNonGeotag() {
    if (_mode === 'live') {
      const data = await _fetchJSON(`${LIVE_API_BASE}/events/non-geotag`).catch(() => []);
      return Array.isArray(data) ? data : (data.events || []);
    }
    const data = await _fetchJSON(`${STATIC_BASE}/non-geotag.json`).catch(() => []);
    return Array.isArray(data) ? data : (data.events || []);
  }

  /* ── Public: refreshFromGDELT ─────────────────────────────── */
  // Called when user clicks the Refresh button.

  async function refreshFromGDELT() {
    _gdeltActive = true;
    _mode = 'gdelt';
    clearCache();
    return getEvents();
  }

  /* ── Public: fetchCountryEvents ───────────────────────────── */
  // Called when user zooms into a specific country for extra detail.
  // countryCode e.g. 'FR', query e.g. 'France news'

  async function fetchCountryEvents(countryName) {
    const q = `${countryName} news politics economy`;
    const params = new URLSearchParams({
      query: q, mode: 'artlist', maxrecords: '20',
      format: 'json', sourcelang: 'english', timespan: '24h'
    });
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res  = await fetch(`${GDELT_API}?${params}`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) return [];
      const body = await res.json();
      const articles = (body.articles || []).filter(a => a.url && a.title);
      // Return raw articles as source links for the detail panel
      return articles.slice(0, 15).map(a => ({
        name: a.domain || 'unknown', url: a.url,
        title: a.title, publishedAt: _parseDate(a.seendate)
      }));
    } catch { clearTimeout(tid); return []; }
  }

  /* ── Public: getMeta ──────────────────────────────────────── */

  async function getMeta() {
    return _fetchJSON(`${STATIC_BASE}/meta.json`).catch(() => null);
  }

  /* ── Other accessors ──────────────────────────────────────── */

  async function getHeadlines() {
    if (_mode === 'live') {
      const data = await _fetchJSON(`${LIVE_API_BASE}/headlines`).catch(() => ({}));
      return Array.isArray(data) ? data : (data.headlines || []);
    }
    const data = await _fetchStaticWithFallback(
      ['top-headlines.json', 'top-headlines.fixed.json'],
      {}
    );
    return Array.isArray(data) ? data : (data.headlines || data.events || []);
  }

  async function getTrends() {
    if (_mode === 'live') return _fetchJSON(`${LIVE_API_BASE}/trends`);
    return _fetchStaticWithFallback(['trends.json', 'trends.fixed.json'], {});
  }

  async function getHeatmap(range) {
    if (_mode === 'live') return _fetchJSON(`${LIVE_API_BASE}/heatmap?range=${range}`);
    const file = range === '1h' ? 'heatmap-1h.json' : 'heatmap-24h.json';
    return _fetchJSON(`${STATIC_BASE}/${file}`).catch(() => null);
  }

  function getMode()    { return _mode; }
  function clearCache() { _cache = {}; }

  return {
    init, getEvents, getHeadlines, getTrends, getHeatmap,
    refreshFromGDELT, fetchCountryEvents, getMeta, getNonGeotag,
    getMode, clearCache
  };
})();
