Preview → https://xenoah.github.io/XNH_news-atlas/


# World News Map Viewer

A production-quality static web application that visualizes global news events on an interactive dark-themed world map. Data is pre-fetched hourly from RSS, GeoRSS, and GeoJSON services via GitHub Actions and served as static JSON — no backend required.

---

## Features

- **Interactive Map** — MapLibre GL JS with CartoDB dark tiles; clusters, individual event points, and animated bubble markers for breaking news
- **Four View Modes** — Events (ranked list), Density (heatmap), Trends (velocity ranking), Analysis (statistical breakdown)
- **Time Filters** — 1H, 6H, 24H, 7D windows applied across map and panels simultaneously
- **Category Filters** — 10 categories with color-coded chips; multi-select supported
- **Full-text Search** — Filters across title, summary, country, location, and tags in real-time
- **Source Links** — Each event links to original article sources with domain, title, and timestamp
- **Multi-Source Ingestion** — Real news data pre-fetched hourly from publisher RSS plus explicit-geo services such as GDACS, USGS, and NASA EONET
- **Non-Geotag Queue** — Articles without a reliable location are stored separately so they can still be reviewed without polluting the map
- **3-Tier Data Priority** — Live API (`localhost:8787`) → Static JSON (GitHub Actions) → Browser GDELT fetch
- **7-Day Accumulation** — Hourly runs accumulate non-duplicate articles for up to 7 days; events decay in score as they age
- **Map Legend** — Collapsible category legend with color reference
- **Auto-refresh** — Static JSON silently reloads every 5 minutes; "last updated X ago" shown in header
- **Mobile Support** — Responsive layout with bottom drawer for event detail on small screens

---

## Project Structure

```
XNH_news-atlas/
├── index.html                        # Main entry point
├── css/
│   ├── reset.css                     # CSS reset
│   ├── variables.css                 # CSS custom properties
│   └── style.css                     # Complete dark-theme styles
├── js/
│   ├── utils.js                      # Shared utility functions
│   ├── scoring.js                    # Attention score & ranking logic
│   ├── filters.js                    # Time, category, and search filters
│   ├── data.js                       # Data layer (live API / static JSON / GDELT)
│   ├── renderers.js                  # HTML string renderers for all UI components
│   ├── ui.js                         # DOM interactions and panel updates
│   ├── map.js                        # MapLibre GL JS integration
│   ├── app.js                        # Central state management
│   └── main.js                       # Entry point (DOMContentLoaded)
├── scripts/
│   └── fetch-news.py                 # GDELT data fetcher (run by GitHub Actions)
├── .github/
│   └── workflows/
│       └── fetch-news.yml            # Hourly GitHub Actions workflow
└── data/                             # Pre-fetched static JSON (auto-updated)
    ├── world-latest.json             # Up to 5000 world news events
    ├── top-headlines.json            # Top 10 events by attention score
    ├── trends.json                   # Trend metadata and category statistics
    ├── heatmap-1h.json               # Heatmap GeoJSON for 1-hour window
    ├── heatmap-24h.json              # Heatmap GeoJSON for 24-hour window
    ├── non-geotag.json              # Articles excluded from the map due to unresolved location
    └── meta.json                     # Generation metadata (timestamp, event count)
```

---

## Data Pipeline

### GitHub Actions (Hourly)

The workflow `.github/workflows/fetch-news.yml` runs every hour:

1. Fetches broad publisher RSS feeds for world coverage
2. Supplements them with explicit-coordinate GeoRSS / GeoJSON services for infrastructure resilience
3. Uses feed-provided coordinates when available; explicit-geo sources are accepted only when coordinates are present
4. Optional Copilot-reviewed coordinates in `scripts/copilot-geotags.json` are accepted and marked as AI-derived in the UI
5. Articles that still lack a reliable geotag are excluded from the map and written to `data/non-geotag.json`
6. Deduplicates by URL — new articles are added; existing URLs are skipped
7. Prunes events older than **7 days by publishedAt**
8. If the pool exceeds **5000**, drops the oldest published items first, then ranks the retained set by attention score
9. Commits updated JSON to the `data/` directory if anything changed

Total runtime: ~2 minutes per run, well within GitHub Actions limits.

### Browser-Side Refresh

The **↻** button in the header triggers a direct GDELT query from the browser (no Actions required). This is useful for getting events not yet in the latest hourly snapshot. Data mode badge changes to `GDELT` while active.

---

## Quick Start

The app must be served from a local HTTP server (not `file://`) due to browser CORS restrictions on `fetch()`:

```bash
# Python
python -m http.server 8080

# Node.js
npx serve .

# Then open: http://localhost:8080
```

### Live API Mode

If a backend is running at `http://localhost:8787`, the app auto-detects it and switches the status badge to `LIVE`.

| Endpoint | Returns |
|---|---|
| `GET /status` | `200 OK` health check |
| `GET /events/latest` | Array of events (same schema as `world-latest.json`) |
| `GET /headlines` | `{ headlines: [...] }` |
| `GET /trends` | Trends object (same schema as `trends.json`) |
| `GET /heatmap?range=1h` | GeoJSON FeatureCollection |
| `GET /heatmap?range=24h` | GeoJSON FeatureCollection |

---

## Data Model

Each event in `world-latest.json` follows this schema:

```json
{
  "id": "ga_abc123def456",
  "title": "string",
  "summary": "string",
  "category": "conflict | politics | economy | disaster | science | technology | health | sports | culture | other",
  "countryCode": "ISO 3166-1 alpha-2",
  "countryName": "string",
  "regionName": "string",
  "locationName": "string",
  "lat": 0.0,
  "lng": 0.0,
  "geoPrecision": "point | country | none",
  "geoSource": "feed | keyword | copilot | none",
  "geotagStatus": "resolved | unresolved",
  "fetchedAt": "ISO 8601",
  "publishedAt": "ISO 8601",
  "firstSeenAt": "ISO 8601",
  "lastUpdatedAt": "ISO 8601",
  "freshness": "fresh | recent | ongoing | archive",
  "articleCount": 1,
  "sourceCount": 1,
  "attentionScore": 0.0,
  "velocityScore": 0.0,
  "crossBorderFactor": 0.0,
  "bubble": false,
  "tags": ["string"],
  "sources": [
    {
      "name": "reuters.com",
      "url": "https://...",
      "title": "string",
      "publishedAt": "ISO 8601"
    }
  ]
}
```

`meta.json` schema:

```json
{
  "generatedAt": "ISO 8601",
  "eventCount": 5000,
  "nonGeotagCount": 85,
  "rawUniqueCount": 1200,
  "failedTopics": 2,
  "elapsedSec": 110.4,
  "source": "rss+geo",
  "version": 5
}
```

---

## Attention Score Formula

Per-article score at fetch time:

```
attentionScore =
  0.35 × positionRatio     (1.0 = first result, 0.0 = last)  +
  0.40 × categoryWeight                                        +
  0.25 × coverage          (unique domains in topic / 20)
```

Score is further decayed at render time by freshness:

| Freshness | Age | Decay |
|---|---|---|
| fresh | < 3 h | 1.0× |
| recent | < 24 h | 0.9× |
| ongoing | < 7 d | 0.7× |
| archive | > 7 d | pruned |

Category weights: conflict 1.0, politics/disaster 0.9, economy 0.8, health 0.7, technology 0.6, science 0.5, sports 0.4, culture 0.3, other 0.2

---

## Architecture

### Namespace Pattern

All modules attach to `window.NewsAtlas` — no build tools required:

```javascript
window.NewsAtlas = window.NewsAtlas || {};
NewsAtlas.utils      // utility functions
NewsAtlas.scoring    // scoring logic
NewsAtlas.filters    // filter logic
NewsAtlas.data       // data fetching (3-tier)
NewsAtlas.renderers  // HTML renderers
NewsAtlas.ui         // DOM management
NewsAtlas.map        // MapLibre integration
NewsAtlas.app        // central state + orchestration
```

### Data Flow

```
main.js
  → ui.init()
  → map.init('map')
  → app.init()
      → data.init()          (probe localhost:8787; read meta.json)
      → data.getEvents()     (static JSON by default)
      → filters.apply()
      → scoring.rankEvents()
      → renderers.*()
      → ui.updateLeftPanel() / ui.updateRightPanel()
      → map.updateEvents()   / map.updateHeatmap()
```

### Map Layers

| Layer ID | Type | Description |
|---|---|---|
| `carto-dark-tiles` | raster | CartoDB dark basemap |
| `heatmap-layer` | heatmap | Event density (Density mode only) |
| `cluster-circles` | circle | Clustered event groups |
| `cluster-count` | symbol | Cluster count labels |
| `event-points` | circle | Individual events (color by category) |
| `selected-glow` | circle | Selected event highlight (fill) |
| `selected-ring` | circle | Selected event highlight (ring) |

HTML `bubble-marker` elements are added as MapLibre `Marker` instances with CSS pulsing animation for high-attention events (`attentionScore ≥ 0.93`).

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

Requires a modern browser with ES2020+ and WebGL support:

- Chrome 90+, Firefox 88+, Safari 15+, Edge 90+

---

## License

MIT — see LICENSE file for details.
