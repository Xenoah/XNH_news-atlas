# World News Map Viewer

A production-quality static web application that visualizes global news events on an interactive dark-themed world map. No build tools required — open `index.html` in a browser and everything works.

---

## Features

- **Interactive Map** — MapLibre GL JS with CartoDB dark tiles; clusters, individual event points, and animated bubble markers for breaking news
- **Four View Modes** — Events (ranked list), Density (heatmap), Trends (velocity ranking), Analysis (statistical breakdown)
- **Time Filters** — 1H, 6H, 24H, 7D windows applied across map and panels simultaneously
- **Category Filters** — 10 categories with color-coded chips; multi-select supported
- **Full-text Search** — Filters across title, summary, country, location, and tags in real-time
- **Attention Scoring** — Composite score from article count, source count, velocity, category weight, and cross-border factor
- **Live/Static Mode** — Auto-detects local API at `localhost:8787`; falls back gracefully to static JSON
- **Mobile Support** — Responsive layout; panels hidden on mobile with a bottom drawer for event detail
- **Auto-refresh** — 60s for live mode, 5 minutes for static mode

---

## Project Structure

```
XNH_news-atlas/
├── index.html              # Main entry point
├── css/
│   ├── reset.css           # Comprehensive CSS reset
│   ├── variables.css       # CSS custom properties
│   └── style.css           # Complete dark-theme styles
├── js/
│   ├── utils.js            # Shared utility functions
│   ├── scoring.js          # Attention score & ranking logic
│   ├── filters.js          # Time, category, and search filters
│   ├── data.js             # Data layer (live API + static JSON)
│   ├── renderers.js        # HTML string renderers for all UI components
│   ├── ui.js               # DOM interactions and panel updates
│   ├── map.js              # MapLibre GL JS integration
│   ├── app.js              # Central state management
│   └── main.js             # Entry point (DOMContentLoaded)
└── data/
    ├── world-latest.json   # 38 realistic world news events (mock)
    ├── top-headlines.json  # Top 10 events by attention score
    ├── trends.json         # Trend metadata and category statistics
    ├── heatmap-1h.json     # Heatmap GeoJSON for 1-hour window
    └── heatmap-24h.json    # Heatmap GeoJSON for 24-hour window
```

---

## Quick Start

### Static Mode (no server needed)

The app can be served directly from any static file server:

```bash
# Python (built-in)
cd XNH_news-atlas
python -m http.server 8080

# Node.js (npx)
npx serve .

# Then open in browser:
# http://localhost:8080
```

> **Note:** Opening `index.html` directly with `file://` protocol will fail due to CORS restrictions on `fetch()`. You must serve from a local server.

### Live API Mode

If you have a backend running at `http://localhost:8787`, the app will auto-detect it and switch the status badge from `STATIC` to `LIVE`. The app probes `/status` with a 2-second timeout.

Expected endpoints:
| Endpoint | Returns |
|---|---|
| `GET /status` | `200 OK` health check |
| `GET /events/latest` | Array of events (same schema as `world-latest.json`) |
| `GET /headlines` | Array or `{ headlines: [...] }` |
| `GET /trends` | Trends object (same schema as `trends.json`) |
| `GET /heatmap?range=1h` | GeoJSON FeatureCollection |
| `GET /heatmap?range=24h` | GeoJSON FeatureCollection |

---

## Data Model

Each event in `world-latest.json` follows this schema:

```json
{
  "id": "evt-001",
  "title": "string",
  "summary": "string (2-4 sentences)",
  "category": "conflict | politics | economy | disaster | science | technology | health | sports | culture | other",
  "countryCode": "ISO 3166-1 alpha-2",
  "countryName": "string",
  "regionName": "string",
  "locationName": "string",
  "lat": -90.0,
  "lng": -180.0,
  "geoPrecision": "city | region | country",
  "publishedAt": "ISO 8601",
  "firstSeenAt": "ISO 8601",
  "lastUpdatedAt": "ISO 8601",
  "freshness": "fresh | recent | ongoing | archive",
  "articleCount": 0,
  "sourceCount": 0,
  "attentionScore": 0.0,
  "velocityScore": 0.0,
  "crossBorderFactor": 0.0,
  "bubble": false,
  "tags": ["string"],
  "sources": [{ "name": "string", "articleCount": 0 }]
}
```

---

## Attention Score Formula

```
attentionScore =
  0.30 × min(articleCount / 200, 1)  +
  0.25 × min(sourceCount / 30, 1)    +
  0.20 × min(velocityScore, 1)       +
  0.15 × categoryWeight              +
  0.10 × crossBorderFactor
```

Category weights: conflict 1.0, politics 0.9, disaster 0.9, economy 0.8, health 0.7, technology 0.6, science 0.5, sports 0.4, culture 0.3, other 0.2

---

## Architecture

### Namespace Pattern

All modules attach to `window.NewsAtlas`:

```javascript
window.NewsAtlas = window.NewsAtlas || {};
NewsAtlas.utils    // utility functions
NewsAtlas.scoring  // scoring logic
NewsAtlas.filters  // filter logic
NewsAtlas.data     // data fetching
NewsAtlas.renderers // HTML renderers
NewsAtlas.ui       // DOM management
NewsAtlas.map      // MapLibre integration
NewsAtlas.app      // central state + orchestration
```

### Data Flow

```
main.js
  → ui.init()          (bind DOM events)
  → map.init('map')    (create MapLibre instance)
  → app.init()
      → data.init()    (detect live vs. static)
      → data.getEvents() + getHeadlines() + getTrends() + getHeatmap()
      → filters.apply()
      → scoring.rankEvents()
      → renderers.*()  (generate HTML strings)
      → ui.updateLeftPanel() / ui.updateRightPanel()
      → map.updateEvents() / map.updateHeatmap()
```

### State

All application state lives in `NewsAtlas.app.getState()`:

```javascript
{
  mode: 'events',           // 'events' | 'density' | 'trends' | 'analysis'
  timeFilter: '24h',        // '1h' | '6h' | '24h' | '7d'
  categoryFilters: Set,     // Set of category strings, or Set(['all'])
  searchQuery: '',
  selectedEvent: null,
  selectedRegion: null,
  dataMode: 'static',       // 'live' | 'static'
  lastUpdated: Date,
  allEvents: [],
  filteredEvents: [],
  headlines: [],
  trends: {},
  heatmapData: null
}
```

---

## Map Layers

| Layer ID | Type | Description |
|---|---|---|
| `carto-dark-tiles` | raster | CartoDB dark basemap |
| `heatmap-layer` | heatmap | Event density (Density mode only) |
| `cluster-circles` | circle | Clustered event groups |
| `cluster-count` | symbol | Cluster count labels |
| `event-points` | circle | Individual events (color by category) |
| `bubble-rings` | circle | High-attention event ring overlay |

HTML `bubble-marker` elements are added as MapLibre `Marker` instances with a CSS pulsing animation for the top 10 breaking events.

---

## Color Reference

| Category | Color |
|---|---|
| Conflict | `#f87171` (red) |
| Politics | `#a78bfa` (purple) |
| Economy | `#34d399` (green) |
| Disaster | `#fb923c` (orange) |
| Science | `#38bdf8` (sky blue) |
| Technology | `#818cf8` (indigo) |
| Health | `#f472b6` (pink) |
| Sports | `#4ade80` (lime) |
| Culture | `#fbbf24` (amber) |
| Other | `#94a3b8` (slate) |

---

## Browser Support

Requires a modern browser with ES2020+ support:
- Chrome 90+
- Firefox 88+
- Safari 15+
- Edge 90+

WebGL is required for the MapLibre map. The app will display an error message if WebGL is unavailable.

---

## License

MIT — see LICENSE file for details.
