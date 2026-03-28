/* ============================================================
   DATA LAYER — World News Map Viewer
   Priority: Live local API → GDELT real-time → Static JSON
   GDELT DOC 2.0 API is CORS-enabled, free, no API key.
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.data = (function() {
  const LIVE_API_BASE = 'http://localhost:8787';
  const STATIC_BASE   = './data';
  const GDELT_API     = 'https://api.gdeltproject.org/api/v2/doc/doc';

  let _mode  = 'static';   // 'live' | 'gdelt' | 'static'
  let _cache = {};

  /* ── Country Coordinates ────────────────────────────────── */

  const CC = {
    'United States':    { code: 'US', lat: 38.89,  lng: -77.03  },
    'United Kingdom':   { code: 'GB', lat: 51.51,  lng: -0.13   },
    'France':           { code: 'FR', lat: 48.86,  lng: 2.35    },
    'Germany':          { code: 'DE', lat: 52.52,  lng: 13.40   },
    'Russia':           { code: 'RU', lat: 55.75,  lng: 37.62   },
    'China':            { code: 'CN', lat: 39.91,  lng: 116.39  },
    'Japan':            { code: 'JP', lat: 35.69,  lng: 139.69  },
    'India':            { code: 'IN', lat: 28.61,  lng: 77.21   },
    'Brazil':           { code: 'BR', lat: -15.78, lng: -47.93  },
    'Australia':        { code: 'AU', lat: -33.87, lng: 151.21  },
    'Canada':           { code: 'CA', lat: 45.42,  lng: -75.70  },
    'South Korea':      { code: 'KR', lat: 37.57,  lng: 126.98  },
    'Ukraine':          { code: 'UA', lat: 50.45,  lng: 30.52   },
    'Israel':           { code: 'IL', lat: 31.77,  lng: 35.22   },
    'Iran':             { code: 'IR', lat: 35.69,  lng: 51.39   },
    'Pakistan':         { code: 'PK', lat: 33.72,  lng: 73.06   },
    'Turkey':           { code: 'TR', lat: 39.93,  lng: 32.86   },
    'Saudi Arabia':     { code: 'SA', lat: 24.69,  lng: 46.72   },
    'Nigeria':          { code: 'NG', lat: 9.08,   lng: 7.40    },
    'Egypt':            { code: 'EG', lat: 30.04,  lng: 31.24   },
    'Mexico':           { code: 'MX', lat: 19.43,  lng: -99.13  },
    'Indonesia':        { code: 'ID', lat: -6.21,  lng: 106.85  },
    'Poland':           { code: 'PL', lat: 52.23,  lng: 21.01   },
    'Taiwan':           { code: 'TW', lat: 25.05,  lng: 121.56  },
    'Spain':            { code: 'ES', lat: 40.42,  lng: -3.70   },
    'Italy':            { code: 'IT', lat: 41.90,  lng: 12.50   },
    'Netherlands':      { code: 'NL', lat: 52.37,  lng: 4.90    },
    'Switzerland':      { code: 'CH', lat: 46.95,  lng: 7.45    },
    'Belgium':          { code: 'BE', lat: 50.85,  lng: 4.35    },
    'Sweden':           { code: 'SE', lat: 59.33,  lng: 18.07   },
    'Singapore':        { code: 'SG', lat: 1.35,   lng: 103.82  },
    'South Africa':     { code: 'ZA', lat: -25.75, lng: 28.19   },
    'Ethiopia':         { code: 'ET', lat: 9.03,   lng: 38.74   },
    'Kenya':            { code: 'KE', lat: -1.29,  lng: 36.82   },
    'Argentina':        { code: 'AR', lat: -34.61, lng: -58.38  },
    'Thailand':         { code: 'TH', lat: 13.75,  lng: 100.52  },
    'Philippines':      { code: 'PH', lat: 14.60,  lng: 120.98  },
    'Vietnam':          { code: 'VN', lat: 21.03,  lng: 105.85  },
    'Iraq':             { code: 'IQ', lat: 33.34,  lng: 44.40   },
    'Syria':            { code: 'SY', lat: 33.51,  lng: 36.29   },
    'Yemen':            { code: 'YE', lat: 15.36,  lng: 44.19   },
    'Libya':            { code: 'LY', lat: 32.90,  lng: 13.18   },
    'Myanmar':          { code: 'MM', lat: 16.87,  lng: 96.15   },
    'North Korea':      { code: 'KP', lat: 39.02,  lng: 125.76  },
    'Colombia':         { code: 'CO', lat: 4.71,   lng: -74.07  },
    'Venezuela':        { code: 'VE', lat: 10.49,  lng: -66.88  },
    'Cuba':             { code: 'CU', lat: 23.13,  lng: -82.38  }
  };

  /* ── GDELT Topic Definitions ─────────────────────────────── */

  const TOPICS = [
    { q: 'ukraine russia war military ceasefire frontline Kyiv',
      country: 'Ukraine',        code: 'UA', lat: 50.45, lng: 30.52,   cat: 'conflict'    },
    { q: 'israel gaza hamas war ceasefire hostages West Bank',
      country: 'Israel',         code: 'IL', lat: 31.77, lng: 35.22,   cat: 'conflict'    },
    { q: 'taiwan strait china military threat PLA',
      country: 'Taiwan',         code: 'TW', lat: 25.05, lng: 121.56,  cat: 'conflict'    },
    { q: 'united states trump congress white house Washington politics',
      country: 'United States',  code: 'US', lat: 38.89, lng: -77.03,  cat: 'politics'    },
    { q: 'france macron paris government politics parliament',
      country: 'France',         code: 'FR', lat: 48.86, lng: 2.35,    cat: 'politics'    },
    { q: 'germany economy recession inflation Berlin Scholz',
      country: 'Germany',        code: 'DE', lat: 52.52, lng: 13.40,   cat: 'economy'     },
    { q: 'india modi BJP parliament Delhi election',
      country: 'India',          code: 'IN', lat: 28.61, lng: 77.21,   cat: 'politics'    },
    { q: 'china economy market trade tariff GDP Beijing',
      country: 'China',          code: 'CN', lat: 39.91, lng: 116.39,  cat: 'economy'     },
    { q: 'artificial intelligence AI OpenAI technology silicon valley',
      country: 'United States',  code: 'US', lat: 37.38, lng: -122.08, cat: 'technology'  },
    { q: 'north korea missile nuclear Kim Jong-un Pyongyang',
      country: 'North Korea',    code: 'KP', lat: 39.02, lng: 125.76,  cat: 'conflict'    },
    { q: 'japan economy yen Tokyo markets Bank of Japan',
      country: 'Japan',          code: 'JP', lat: 35.69, lng: 139.69,  cat: 'economy'     },
    { q: 'iran nuclear sanctions Tehran politics Khamenei',
      country: 'Iran',           code: 'IR', lat: 35.69, lng: 51.39,   cat: 'politics'    },
    { q: 'UK Britain parliament London government election',
      country: 'United Kingdom', code: 'GB', lat: 51.51, lng: -0.13,   cat: 'politics'    },
    { q: 'brazil lula amazon economy politics rio de janeiro',
      country: 'Brazil',         code: 'BR', lat: -15.78, lng: -47.93, cat: 'politics'    },
    { q: 'oil gas energy prices OPEC Saudi Arabia market',
      country: 'Saudi Arabia',   code: 'SA', lat: 24.69, lng: 46.72,   cat: 'economy'     },
    { q: 'WHO health pandemic disease outbreak virus epidemic',
      country: 'Switzerland',    code: 'CH', lat: 46.95, lng: 7.45,    cat: 'health'      },
    { q: 'earthquake tsunami flood disaster emergency victims',
      country: null,             code: null, lat: null,  lng: null,     cat: 'disaster'    },
    { q: 'south korea technology samsung Seoul politics',
      country: 'South Korea',    code: 'KR', lat: 37.57, lng: 126.98,  cat: 'technology'  },
    { q: 'nigeria africa sahel conflict coup Lagos',
      country: 'Nigeria',        code: 'NG', lat: 9.08,  lng: 7.40,    cat: 'conflict'    },
    { q: 'turkey erdogan istanbul economy inflation lira',
      country: 'Turkey',         code: 'TR', lat: 39.93, lng: 32.86,   cat: 'economy'     },
    { q: 'russia economy sanctions rouble Moscow Kremlin Putin',
      country: 'Russia',         code: 'RU', lat: 55.75, lng: 37.62,   cat: 'economy'     },
    { q: 'pakistan india kashmir border military tensions Islamabad',
      country: 'Pakistan',       code: 'PK', lat: 33.72, lng: 73.06,   cat: 'conflict'    },
    { q: 'climate change environment emissions carbon COP renewable',
      country: 'United Kingdom', code: 'GB', lat: 51.51, lng: -0.13,   cat: 'science'     },
    { q: 'mexico cartel violence drugs border crisis',
      country: 'Mexico',         code: 'MX', lat: 19.43, lng: -99.13,  cat: 'conflict'    }
  ];

  /* ── GDELT Date Parser ─────────────────────────────────── */

  function parseGDate(s) {
    // Format: "20260328T120000Z"  or  "20260328120000"
    if (!s) return new Date().toISOString();
    try {
      const clean = s.replace('T', '').replace('Z', '');
      return `${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}T${clean.slice(8,10)||'00'}:${clean.slice(10,12)||'00'}:00Z`;
    } catch { return new Date().toISOString(); }
  }

  /* ── Fetch one GDELT topic ─────────────────────────────── */

  async function fetchTopic(topic, timespan) {
    const params = new URLSearchParams({
      query:       topic.q,
      mode:        'artlist',
      maxrecords:  '15',
      format:      'json',
      sourcelang:  'english',
      timespan:    timespan || '24h'
    });

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 9000);

    let articles;
    try {
      const res = await fetch(`${GDELT_API}?${params}`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) return null;
      const body = await res.json();
      articles = (body.articles || []).filter(a => a.url && a.title);
    } catch {
      clearTimeout(tid);
      return null;
    }

    if (articles.length === 0) return null;

    // Determine location
    let { country, code, lat, lng } = topic;
    if (!lat) {
      // Infer from most common source country
      const freq = {};
      articles.forEach(a => { if (a.sourcecountry) freq[a.sourcecountry] = (freq[a.sourcecountry] || 0) + 1; });
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      if (top && CC[top[0]]) {
        const c = CC[top[0]];
        lat = c.lat; lng = c.lng; country = top[0]; code = c.code;
      }
    }
    if (!lat) return null;

    // Sort by date descending
    articles.sort((a, b) => (b.seendate || '').localeCompare(a.seendate || ''));
    const top0 = articles[0];

    const articleCount  = articles.length;
    const uniqueDomains = new Set(articles.map(a => a.domain).filter(Boolean));
    const sourceCount   = uniqueDomains.size;
    const velocityScore = Math.min(articleCount / 15, 1);
    const crossBorderFactor = sourceCount >= 6 ? 0.9 : sourceCount >= 3 ? 0.5 : 0.2;

    const attentionScore = (NewsAtlas.scoring && NewsAtlas.scoring.calcAttentionScore)
      ? NewsAtlas.scoring.calcAttentionScore({ articleCount, sourceCount, velocityScore, category: topic.cat, crossBorderFactor })
      : Math.min(0.25 + articleCount * 0.05 + sourceCount * 0.03, 0.98);

    const publishedAt = parseGDate(top0.seendate);
    const uid = `gdelt_${topic.cat}_${code || 'XX'}_${Date.now().toString(36)}`;

    return {
      id:               uid,
      title:            top0.title,
      summary:          `${articleCount} articles from ${sourceCount} sources covering ${topic.cat} developments${country ? ' in ' + country : ''}.`,
      category:         topic.cat,
      countryCode:      code  || 'XX',
      countryName:      country || 'Unknown',
      regionName:       country || 'Unknown',
      locationName:     country || 'Unknown',
      lat, lng,
      geoPrecision:     topic.lat ? 'city' : 'country',
      publishedAt,
      firstSeenAt:      publishedAt,
      lastUpdatedAt:    new Date().toISOString(),
      freshness:        'fresh',
      articleCount,
      sourceCount,
      attentionScore,
      velocityScore,
      crossBorderFactor,
      bubble:           attentionScore >= 0.78,
      tags:             topic.q.split(' ').filter(w => w.length > 3).slice(0, 5),
      sources:          articles.slice(0, 10).map(a => ({
        name:        a.domain || 'unknown',
        url:         a.url,
        title:       a.title,
        publishedAt: parseGDate(a.seendate)
      }))
    };
  }

  /* ── Fetch all GDELT topics ─────────────────────────────── */

  async function fetchGDELT(timespan) {
    const BATCH = 4;
    const results = [];

    for (let i = 0; i < TOPICS.length; i += BATCH) {
      const batch = TOPICS.slice(i, i + BATCH);
      const settled = await Promise.allSettled(batch.map(t => fetchTopic(t, timespan)));
      settled.forEach(r => { if (r.status === 'fulfilled' && r.value) results.push(r.value); });
      if (i + BATCH < TOPICS.length) await new Promise(r => setTimeout(r, 150));
    }

    if (results.length === 0) throw new Error('GDELT returned no usable results');
    return results;
  }

  /* ── Live API probe ─────────────────────────────────────── */

  async function checkLive() {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(`${LIVE_API_BASE}/status`, { signal: ctrl.signal });
      return res.ok;
    } catch { return false; }
  }

  /* ── fetchJSON with cache ─────────────────────────────── */

  async function fetchJSON(url) {
    if (_cache[url]) return _cache[url];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _cache[url] = data;
    return data;
  }

  /* ── Public: init ─────────────────────────────────────── */

  async function init() {
    const live = await checkLive();
    _mode = live ? 'live' : 'gdelt';
    return _mode;
  }

  /* ── Public: getEvents ────────────────────────────────── */

  async function getEvents() {
    if (_mode === 'live') {
      const data = await fetchJSON(`${LIVE_API_BASE}/events/latest`);
      return Array.isArray(data) ? data : (data.events || []);
    }

    // GDELT real-time
    try {
      const events = await fetchGDELT('24h');
      _mode = 'gdelt';
      return events;
    } catch (err) {
      console.warn('[data] GDELT unavailable, using static data:', err.message);
      _mode = 'static';
      const data = await fetchJSON(`${STATIC_BASE}/world-latest.json`);
      return Array.isArray(data) ? data : (data.events || []);
    }
  }

  /* ── Public: getHeadlines ─────────────────────────────── */

  async function getHeadlines() {
    if (_mode === 'live') {
      const data = await fetchJSON(`${LIVE_API_BASE}/headlines`).catch(() => ({}));
      return Array.isArray(data) ? data : (data.headlines || []);
    }
    const data = await fetchJSON(`${STATIC_BASE}/top-headlines.json`).catch(() => ({}));
    return Array.isArray(data) ? data : (data.headlines || data.events || []);
  }

  /* ── Public: getTrends ────────────────────────────────── */

  async function getTrends() {
    if (_mode === 'live') return fetchJSON(`${LIVE_API_BASE}/trends`);
    return fetchJSON(`${STATIC_BASE}/trends.json`).catch(() => ({}));
  }

  /* ── Public: getHeatmap ───────────────────────────────── */

  async function getHeatmap(range) {
    if (_mode === 'live') return fetchJSON(`${LIVE_API_BASE}/heatmap?range=${range}`);
    const file = range === '1h' ? 'heatmap-1h.json' : 'heatmap-24h.json';
    return fetchJSON(`${STATIC_BASE}/${file}`).catch(() => null);
  }

  function getMode()    { return _mode; }
  function clearCache() { _cache = {}; }

  return { init, getEvents, getHeadlines, getTrends, getHeatmap, getMode, clearCache };
})();
