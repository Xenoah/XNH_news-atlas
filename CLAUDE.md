# CLAUDE.md — Project Working Log

## Project: World News Map Viewer

**Repository:** `XNH_news-atlas`
**Started:** 2026-03-28
**Status:** Initial implementation complete

---

## Completed Tasks

### Phase 1: Core Infrastructure
- [x] Created `css/reset.css` — comprehensive box-sizing and browser-normalization reset
- [x] Created `css/variables.css` — all CSS custom properties (colors, layout, radii, transitions, shadows, z-index)
- [x] Created `css/style.css` — full dark-theme stylesheet (800+ lines) covering all components, animations, media queries, MapLibre overrides, and scrollbar styling

### Phase 2: JavaScript Modules
- [x] Created `js/utils.js` — timeAgo, formatDate, formatCount, clamp, normalize, deepClone, debounce, categoryColor, categoryHex, escapeHtml, get
- [x] Created `js/scoring.js` — CATEGORY_WEIGHTS, getFreshness, calcAttentionScore, shouldBubble, rankEvents, getTrending, countByCategory, countByCountry
- [x] Created `js/filters.js` — byTime, byCategory, bySearch, apply
- [x] Created `js/data.js` — IIFE module, checkLive (2s timeout), fetchJSON (with cache), init, getEvents, getHeadlines, getTrends, getHeatmap, getMode, clearCache
- [x] Created `js/renderers.js` — 17 rendering functions producing complete HTML strings (no placeholders)
- [x] Created `js/ui.js` — IIFE module, init, bindEvents, setActiveMode, setActiveTime, toggleCategory, updateLeftPanel, updateRightPanel, showEventDetail, showRegionDetail, setStatusBadge, setUpdateTime, openDrawer, closeDrawer, togglePanel, showLoading
- [x] Created `js/map.js` — IIFE module with MapLibre GL JS integration; 5 map layers, cluster click expansion, HTML bubble markers with pulse animation, heatmap, popup, flyTo
- [x] Created `js/app.js` — IIFE module; full state management, _applyFiltersAndRender, _renderAll, mode/time/category/search/event handlers, mapready event coordination
- [x] Created `js/main.js` — DOMContentLoaded entry point with error handling

### Phase 3: Data Files
- [x] Created `data/world-latest.json` — 38 realistic news events from 6 continents, all fields populated, 5 events marked `bubble:true`
- [x] Created `data/top-headlines.json` — top 10 events with full schemas
- [x] Created `data/trends.json` — risingEvents, risingRegions, categoryTrends (all 10 categories), globalStats, totalEvents/totalSources
- [x] Created `data/heatmap-1h.json` — 20-point GeoJSON FeatureCollection with intensity/count properties
- [x] Created `data/heatmap-24h.json` — 37-point GeoJSON FeatureCollection with broader global spread

### Phase 4: Entry Point & Documentation
- [x] Created `index.html` — full semantic HTML with header, category bar, left/right panels, map container, mobile drawer, all script tags in correct load order
- [x] Updated `README.md` — comprehensive documentation with quick start, data model, architecture, API spec, color reference, browser support
- [x] Created `CLAUDE.md` — this file

---

## Architecture Decisions

### Namespace Pattern (`window.NewsAtlas`)
Chosen over ES modules to avoid any build tooling requirement. All scripts load via `<script src="...">` tags in dependency order. The namespace is initialized with `window.NewsAtlas = window.NewsAtlas || {}` at the top of every file, making load order robust.

### IIFE Modules for Stateful Code
`data.js`, `ui.js`, `map.js`, and `app.js` use Immediately Invoked Function Expressions (IIFEs) returning public API objects. This keeps internal state (`_cache`, `_markers`, `state`, `el`) genuinely private without needing ES module scope.

### Renderers as Pure HTML String Generators
`renderers.js` is a plain object (not an IIFE) with methods that take data and return HTML strings. This makes testing trivial and avoids tight coupling to the DOM. All rendering is via `innerHTML = html`.

### Map-Ready Event Coordination
A timing issue exists where `data.init()` (fast — just a fetch probe) may complete before the MapLibre map fires its `load` event. The solution: `app.js` catches any map update errors, sets `_pendingRender = true`, and listens for a custom `newsatlas:mapready` event dispatched by `map.js` after the `load` handler completes.

### CartoDB Tiles (No API Key)
The CartoDB dark matter tiles (`dark_all`) are publicly accessible without an API key. The `DARK_STYLE` object is a minimal MapLibre style spec version 8 pointing directly to CartoDB raster tiles across 4 CDN subdomains (a–d) for load balancing. Glyphs are served from MapLibre's demo tile server for cluster count labels.

### Cluster Properties Limitation
MapLibre GL JS cluster properties with string-type aggregation are limited. The `clusterProperties` object uses only `maxAttention` (numeric `max`). Dominant category is not aggregated at the cluster level — instead, cluster circles use a step-based color scheme (blue → amber → red) based purely on `point_count`.

### Mobile Drawer Pattern
On screens ≤ 768px, both side panels are `display:none`. Event detail (normally in the right panel) instead opens a bottom drawer (`#mobile-drawer`) via CSS `transform: translateY()` transition. The drawer is always in the DOM but off-screen until `.drawer-open` is toggled.

---

## Key File Paths

| File | Purpose |
|---|---|
| `/c/GitHub/XNH_news-atlas/index.html` | App entry point |
| `/c/GitHub/XNH_news-atlas/css/style.css` | All component styles |
| `/c/GitHub/XNH_news-atlas/js/app.js` | Central state manager |
| `/c/GitHub/XNH_news-atlas/js/map.js` | MapLibre integration |
| `/c/GitHub/XNH_news-atlas/js/renderers.js` | HTML generation |
| `/c/GitHub/XNH_news-atlas/data/world-latest.json` | Primary mock data |

---

## Known Issues & Limitations

1. **CORS on file://** — The app must be served from an HTTP server (`python -m http.server`, `npx serve`, etc.). Direct `file://` loading will fail because `fetch()` is blocked by browser CORS policy for local files.

2. **MapLibre Glyphs** — The cluster count labels use `https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf` for glyph rendering. In production, self-host glyphs or use a provider that guarantees uptime.

3. **CartoDB Attribution** — CartoDB tiles require attribution. This is included via the `attribution` field in the source definition and rendered by MapLibre's built-in attribution control.

4. **No Offline Support** — The app requires internet access to load MapLibre GL JS from unpkg.com and CartoDB tiles. For offline use, bundle MapLibre locally and use a local tile server.

5. **Event Card Click Relies on `getEventById`** — Event cards rendered in the left panel use `onclick` with `NewsAtlas.app.getEventById(id)`. This means events must be in `state.allEvents` (not just `filteredEvents`) to be selectable. This is by design — clicking a ranked card should always work even if data was refreshed.

---

## Next Steps / Future Work

- [ ] Add a real backend API (Cloudflare Workers at `localhost:8787`)
- [ ] Implement WebSocket for true real-time event streaming
- [ ] Add keyboard navigation (arrow keys to cycle through events)
- [ ] Add a minimap / overview inset for context at low zoom levels
- [ ] Implement region-level aggregation (click a country to see all its events)
- [ ] Add share-by-URL functionality (encode state in URL hash)
- [ ] Self-host MapLibre GL JS and CartoDB fonts for full offline capability
- [ ] Add a print/export view for event summaries
- [ ] Integrate actual news APIs (NewsAPI, GDELT, EventRegistry) for real data
- [ ] Add event timeline view (horizontal scroll by publishedAt)
- [ ] Implement proper SSR/SSG for SEO and faster initial load
