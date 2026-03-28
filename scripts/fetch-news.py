#!/usr/bin/env python3
"""
World News Map Viewer — GDELT News Data Fetcher
------------------------------------------------
Runs via GitHub Actions to pre-fetch news data and save as static JSON.
Output files:
  data/world-latest.json    — all events (sorted by attention score)
  data/top-headlines.json   — top 10 events
  data/trends.json          — trend metadata
  data/heatmap-1h.json      — heatmap for last 1h
  data/heatmap-24h.json     — heatmap for last 24h
  data/meta.json            — generation metadata (read by client)
"""

import json
import os
import time
import math
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from collections import defaultdict

# ── Config ──────────────────────────────────────────────────────────────────

GDELT_API   = "https://api.gdeltproject.org/api/v2/doc/doc"
OUTPUT_DIR  = os.path.join(os.path.dirname(__file__), "..", "data")
REQUEST_DELAY_S = 0.6    # Seconds between GDELT requests (be polite)
ARTICLES_PER_TOPIC = 25  # Max articles fetched per topic

# ── Scoring weights ──────────────────────────────────────────────────────────

CATEGORY_WEIGHTS = {
    "conflict":   1.0,
    "politics":   0.9,
    "disaster":   0.9,
    "economy":    0.8,
    "health":     0.7,
    "technology": 0.6,
    "science":    0.5,
    "sports":     0.4,
    "culture":    0.3,
    "other":      0.2,
}

# ── Country coordinate lookup ────────────────────────────────────────────────

COUNTRY_COORDS = {
    "United States":    {"code": "US", "lat":  38.89, "lng":  -77.03},
    "United Kingdom":   {"code": "GB", "lat":  51.51, "lng":   -0.13},
    "France":           {"code": "FR", "lat":  48.86, "lng":    2.35},
    "Germany":          {"code": "DE", "lat":  52.52, "lng":   13.40},
    "Russia":           {"code": "RU", "lat":  55.75, "lng":   37.62},
    "China":            {"code": "CN", "lat":  39.91, "lng":  116.39},
    "Japan":            {"code": "JP", "lat":  35.69, "lng":  139.69},
    "India":            {"code": "IN", "lat":  28.61, "lng":   77.21},
    "Brazil":           {"code": "BR", "lat": -15.78, "lng":  -47.93},
    "Australia":        {"code": "AU", "lat": -33.87, "lng":  151.21},
    "Canada":           {"code": "CA", "lat":  45.42, "lng":  -75.70},
    "South Korea":      {"code": "KR", "lat":  37.57, "lng":  126.98},
    "Ukraine":          {"code": "UA", "lat":  50.45, "lng":   30.52},
    "Israel":           {"code": "IL", "lat":  31.77, "lng":   35.22},
    "Iran":             {"code": "IR", "lat":  35.69, "lng":   51.39},
    "Pakistan":         {"code": "PK", "lat":  33.72, "lng":   73.06},
    "Turkey":           {"code": "TR", "lat":  39.93, "lng":   32.86},
    "Saudi Arabia":     {"code": "SA", "lat":  24.69, "lng":   46.72},
    "Nigeria":          {"code": "NG", "lat":   9.08, "lng":    7.40},
    "Egypt":            {"code": "EG", "lat":  30.04, "lng":   31.24},
    "Mexico":           {"code": "MX", "lat":  19.43, "lng":  -99.13},
    "Indonesia":        {"code": "ID", "lat":  -6.21, "lng":  106.85},
    "Poland":           {"code": "PL", "lat":  52.23, "lng":   21.01},
    "Taiwan":           {"code": "TW", "lat":  25.05, "lng":  121.56},
    "Spain":            {"code": "ES", "lat":  40.42, "lng":   -3.70},
    "Italy":            {"code": "IT", "lat":  41.90, "lng":   12.50},
    "Netherlands":      {"code": "NL", "lat":  52.37, "lng":    4.90},
    "Switzerland":      {"code": "CH", "lat":  46.95, "lng":    7.45},
    "Sweden":           {"code": "SE", "lat":  59.33, "lng":   18.07},
    "Singapore":        {"code": "SG", "lat":   1.35, "lng":  103.82},
    "South Africa":     {"code": "ZA", "lat": -25.75, "lng":   28.19},
    "Ethiopia":         {"code": "ET", "lat":   9.03, "lng":   38.74},
    "Kenya":            {"code": "KE", "lat":  -1.29, "lng":   36.82},
    "Argentina":        {"code": "AR", "lat": -34.61, "lng":  -58.38},
    "Thailand":         {"code": "TH", "lat":  13.75, "lng":  100.52},
    "Philippines":      {"code": "PH", "lat":  14.60, "lng":  120.98},
    "Vietnam":          {"code": "VN", "lat":  21.03, "lng":  105.85},
    "Iraq":             {"code": "IQ", "lat":  33.34, "lng":   44.40},
    "Syria":            {"code": "SY", "lat":  33.51, "lng":   36.29},
    "Yemen":            {"code": "YE", "lat":  15.36, "lng":   44.19},
    "Libya":            {"code": "LY", "lat":  32.90, "lng":   13.18},
    "Myanmar":          {"code": "MM", "lat":  16.87, "lng":   96.15},
    "North Korea":      {"code": "KP", "lat":  39.02, "lng":  125.76},
    "Colombia":         {"code": "CO", "lat":   4.71, "lng":  -74.07},
    "Venezuela":        {"code": "VE", "lat":  10.49, "lng":  -66.88},
}

# ── Topic definitions ────────────────────────────────────────────────────────
# Each topic: q=GDELT query, country/code/lat/lng=event location (None=auto-detect)

TOPICS = [
    # ── Conflict ──────────────────────────────────────────────────────────
    {"q": "ukraine russia war military ceasefire frontline Kyiv Zaporizhzhia",
     "country": "Ukraine",       "code": "UA", "lat":  50.45, "lng":  30.52, "cat": "conflict"},
    {"q": "israel gaza hamas war ceasefire hostages West Bank IDF strike",
     "country": "Israel",        "code": "IL", "lat":  31.77, "lng":  35.22, "cat": "conflict"},
    {"q": "taiwan strait china military PLA threat invasion deterrence",
     "country": "Taiwan",        "code": "TW", "lat":  25.05, "lng": 121.56, "cat": "conflict"},
    {"q": "north korea missile nuclear Kim Jong-un Pyongyang ICBM launch",
     "country": "North Korea",   "code": "KP", "lat":  39.02, "lng": 125.76, "cat": "conflict"},
    {"q": "nigeria africa sahel conflict coup insurgency Boko Haram Lagos",
     "country": "Nigeria",       "code": "NG", "lat":   9.08, "lng":   7.40, "cat": "conflict"},
    {"q": "pakistan india kashmir border military tensions ceasefire line",
     "country": "Pakistan",      "code": "PK", "lat":  33.72, "lng":  73.06, "cat": "conflict"},
    {"q": "mexico cartel violence drugs narco border crime Culiacan Sinaloa",
     "country": "Mexico",        "code": "MX", "lat":  19.43, "lng": -99.13, "cat": "conflict"},
    {"q": "myanmar civil war military junta resistance coup protest",
     "country": "Myanmar",       "code": "MM", "lat":  16.87, "lng":  96.15, "cat": "conflict"},
    {"q": "sudan civil war RSF fighting Khartoum humanitarian crisis",
     "country": "Sudan",         "code": "SD", "lat":  15.55, "lng":  32.53, "cat": "conflict"},
    {"q": "iran israel strike missile attack Middle East escalation",
     "country": "Iran",          "code": "IR", "lat":  35.69, "lng":  51.39, "cat": "conflict"},

    # ── Politics ──────────────────────────────────────────────────────────
    {"q": "united states trump congress white house senate politics tariff",
     "country": "United States", "code": "US", "lat":  38.89, "lng": -77.03, "cat": "politics"},
    {"q": "france macron paris government politics parliament snap election",
     "country": "France",        "code": "FR", "lat":  48.86, "lng":   2.35, "cat": "politics"},
    {"q": "india modi BJP parliament New Delhi election coalition",
     "country": "India",         "code": "IN", "lat":  28.61, "lng":  77.21, "cat": "politics"},
    {"q": "iran nuclear sanctions Tehran Khamenei negotiations deal",
     "country": "Iran",          "code": "IR", "lat":  35.69, "lng":  51.39, "cat": "politics"},
    {"q": "UK Britain parliament London Starmer government reform",
     "country": "United Kingdom","code": "GB", "lat":  51.51, "lng":  -0.13, "cat": "politics"},
    {"q": "brazil lula amazon deforestation politics rio de janeiro",
     "country": "Brazil",        "code": "BR", "lat": -15.78, "lng": -47.93, "cat": "politics"},
    {"q": "turkey erdogan istanbul economy lira politics opposition",
     "country": "Turkey",        "code": "TR", "lat":  39.93, "lng":  32.86, "cat": "politics"},
    {"q": "russia kremlin putin opposition war politics",
     "country": "Russia",        "code": "RU", "lat":  55.75, "lng":  37.62, "cat": "politics"},
    {"q": "south africa ANC election politics Ramaphosa Johannesburg",
     "country": "South Africa",  "code": "ZA", "lat": -25.75, "lng":  28.19, "cat": "politics"},

    # ── Economy ───────────────────────────────────────────────────────────
    {"q": "germany economy recession GDP inflation Berlin Scholz Friedrich",
     "country": "Germany",       "code": "DE", "lat":  52.52, "lng":  13.40, "cat": "economy"},
    {"q": "china economy market trade tariff GDP Beijing stimulus exports",
     "country": "China",         "code": "CN", "lat":  39.91, "lng": 116.39, "cat": "economy"},
    {"q": "oil gas energy prices OPEC Saudi Arabia barrel market supply",
     "country": "Saudi Arabia",  "code": "SA", "lat":  24.69, "lng":  46.72, "cat": "economy"},
    {"q": "japan economy yen Tokyo stock markets Bank of Japan interest rates",
     "country": "Japan",         "code": "JP", "lat":  35.69, "lng": 139.69, "cat": "economy"},
    {"q": "federal reserve interest rates inflation Wall Street US economy",
     "country": "United States", "code": "US", "lat":  40.71, "lng": -74.01, "cat": "economy"},
    {"q": "cryptocurrency bitcoin ethereum blockchain DeFi market crash surge",
     "country": "United States", "code": "US", "lat":  37.77, "lng":-122.42, "cat": "economy"},
    {"q": "india economy growth GDP RBI Mumbai Sensex investment",
     "country": "India",         "code": "IN", "lat":  19.08, "lng":  72.88, "cat": "economy"},
    {"q": "European Union ECB euro economy trade tariffs Brussels",
     "country": "Belgium",       "code": "BE", "lat":  50.85, "lng":   4.35, "cat": "economy"},

    # ── Technology ────────────────────────────────────────────────────────
    {"q": "artificial intelligence AI OpenAI ChatGPT regulation technology",
     "country": "United States", "code": "US", "lat":  37.38, "lng":-122.08, "cat": "technology"},
    {"q": "south korea technology Samsung LG semiconductor Seoul chip",
     "country": "South Korea",   "code": "KR", "lat":  37.57, "lng": 126.98, "cat": "technology"},
    {"q": "cybersecurity hack data breach ransomware attack malware",
     "country": "United States", "code": "US", "lat":  38.89, "lng": -77.03, "cat": "technology"},
    {"q": "china technology Huawei chip semiconductor ban restriction",
     "country": "China",         "code": "CN", "lat":  22.54, "lng": 114.06, "cat": "technology"},
    {"q": "space mission nasa SpaceX rocket moon Mars Starship launch",
     "country": "United States", "code": "US", "lat":  28.45, "lng": -80.53, "cat": "science"},

    # ── Health ────────────────────────────────────────────────────────────
    {"q": "WHO health pandemic disease outbreak virus epidemic warning",
     "country": "Switzerland",   "code": "CH", "lat":  46.95, "lng":   7.45, "cat": "health"},
    {"q": "mpox bird flu H5N1 influenza outbreak spread cases",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "health"},
    {"q": "cancer drug trial vaccine approval FDA medicine",
     "country": "United States", "code": "US", "lat":  39.00, "lng": -77.10, "cat": "health"},

    # ── Disaster ──────────────────────────────────────────────────────────
    {"q": "earthquake tsunami magnitude Richter victims evacuate",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "disaster"},
    {"q": "hurricane typhoon cyclone storm landfall Category emergency",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "disaster"},
    {"q": "flood wildfire drought extreme weather disaster relief",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "disaster"},

    # ── Science ───────────────────────────────────────────────────────────
    {"q": "climate change global warming emissions carbon Paris agreement",
     "country": "United Kingdom","code": "GB", "lat":  51.51, "lng":  -0.13, "cat": "science"},

    # ── Culture / Sports ──────────────────────────────────────────────────
    {"q": "FIFA World Cup Olympic Games tournament championship sports",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "sports"},
]


# ── Helpers ──────────────────────────────────────────────────────────────────

def parse_gdelt_date(s: str) -> str:
    """Parse GDELT seendate '20260328T120000Z' → ISO-8601 string."""
    if not s:
        return datetime.now(timezone.utc).isoformat()
    try:
        c = s.replace("T", "").replace("Z", "")
        return f"{c[:4]}-{c[4:6]}-{c[6:8]}T{c[8:10] or '00'}:{c[10:12] or '00'}:00Z"
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def calc_freshness(iso: str) -> str:
    try:
        pub = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        h = (datetime.now(timezone.utc) - pub).total_seconds() / 3600
        if h < 3:   return "fresh"
        if h < 24:  return "recent"
        if h < 168: return "ongoing"
        return "archive"
    except Exception:
        return "recent"


def calc_attention_score(article_count, source_count, velocity, category, cross_border) -> float:
    art   = min(article_count / 200, 1.0)
    src   = min(source_count  /  30, 1.0)
    vel   = min(velocity,            1.0)
    cat_w = CATEGORY_WEIGHTS.get(category, 0.2)
    score = 0.30*art + 0.25*src + 0.20*vel + 0.15*cat_w + 0.10*cross_border
    return round(min(score, 0.99), 4)


def fetch_gdelt(query: str, timespan: str = "24h", max_records: int = 25) -> list:
    """Fetch articles from GDELT DOC API. Returns list of article dicts."""
    params = urllib.parse.urlencode({
        "query":       query,
        "mode":        "artlist",
        "maxrecords":  str(max_records),
        "format":      "json",
        "sourcelang":  "english",
        "timespan":    timespan,
    })
    url = f"{GDELT_API}?{params}"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "WorldNewsMapViewer/1.0 (github.com; news visualization)"}
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return [a for a in (data.get("articles") or []) if a.get("url") and a.get("title")]
    except Exception as e:
        print(f"    [GDELT error] {type(e).__name__}: {e}")
        return []


def process_topic(topic: dict, timespan: str = "24h") -> dict | None:
    """Fetch one topic from GDELT and return an event dict, or None."""
    cat     = topic["cat"]
    country = topic.get("country")
    code    = topic.get("code")
    lat     = topic.get("lat")
    lng     = topic.get("lng")
    label   = f"{cat}/{country or '?'}"
    print(f"  → {label:<28} {topic['q'][:55]}…")

    articles = fetch_gdelt(topic["q"], timespan=timespan, max_records=ARTICLES_PER_TOPIC)
    if not articles:
        return None

    # Auto-detect location from most common source country
    if lat is None:
        freq: dict[str, int] = defaultdict(int)
        for a in articles:
            sc = a.get("sourcecountry")
            if sc:
                freq[sc] += 1
        if freq:
            best = max(freq.items(), key=lambda x: x[1])[0]
            coords = COUNTRY_COORDS.get(best)
            if coords:
                lat, lng = coords["lat"], coords["lng"]
                country  = best
                code     = coords["code"]

    if lat is None:
        print(f"    ✗  No location found — skipped")
        return None

    # Sort by date (most recent first)
    articles.sort(key=lambda a: a.get("seendate", ""), reverse=True)
    top0 = articles[0]

    n_articles   = len(articles)
    domains      = {a.get("domain", "") for a in articles if a.get("domain")}
    n_sources    = len(domains)
    velocity     = round(min(n_articles / ARTICLES_PER_TOPIC, 1.0), 4)
    cross_border = 0.9 if n_sources >= 6 else (0.5 if n_sources >= 3 else 0.2)
    attention    = calc_attention_score(n_articles, n_sources, velocity, cat, cross_border)
    published_at = parse_gdelt_date(top0.get("seendate"))
    freshness    = calc_freshness(published_at)

    uid = f"ga_{cat}_{code or 'XX'}_{int(time.time())}"
    loc = f" in {country}" if country else ""

    print(f"    ✓  {n_articles} articles / {n_sources} sources / attention={attention:.2f}")

    return {
        "id":               uid,
        "title":            top0["title"],
        "summary":          f"{n_articles} articles from {n_sources} sources covering {cat} developments{loc}.",
        "category":         cat,
        "countryCode":      code or "XX",
        "countryName":      country or "Unknown",
        "regionName":       country or "Unknown",
        "locationName":     country or "Unknown",
        "lat":              lat,
        "lng":              lng,
        "geoPrecision":     "city" if topic.get("lat") else "country",
        "publishedAt":      published_at,
        "firstSeenAt":      published_at,
        "lastUpdatedAt":    datetime.now(timezone.utc).isoformat(),
        "freshness":        freshness,
        "articleCount":     n_articles,
        "sourceCount":      n_sources,
        "attentionScore":   attention,
        "velocityScore":    velocity,
        "crossBorderFactor": cross_border,
        "bubble":           attention >= 0.78 and freshness in ("fresh", "recent"),
        "tags":             [w for w in topic["q"].split() if len(w) > 3][:6],
        "sources": [
            {
                "name":        a.get("domain", "unknown"),
                "url":         a["url"],
                "title":       a.get("title", ""),
                "publishedAt": parse_gdelt_date(a.get("seendate")),
            }
            for a in articles[:12]
        ],
    }


def build_heatmap(events: list) -> dict:
    """Build GeoJSON FeatureCollection for MapLibre heatmap layer."""
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [e["lng"], e["lat"]]},
            "properties": {
                "intensity": e.get("attentionScore", 0.5),
                "count":     e.get("articleCount", 1),
                "region":    e.get("locationName", ""),
            },
        }
        for e in events
        if e.get("lat") and e.get("lng")
    ]
    return {"type": "FeatureCollection", "features": features}


def build_trends(events: list) -> dict:
    cat_counts: dict[str, int] = defaultdict(int)
    for e in events:
        cat_counts[e["category"]] += 1

    rising = sorted(events, key=lambda e: e.get("velocityScore", 0), reverse=True)[:5]

    return {
        "generatedAt":    datetime.now(timezone.utc).isoformat(),
        "timeRange":      "24h",
        "risingEvents":   [
            {
                "id":           e["id"],
                "title":        e["title"],
                "velocityScore": e["velocityScore"],
                "category":     e["category"],
                "countryName":  e["countryName"],
            }
            for e in rising
        ],
        "risingRegions":  [],
        "categoryTrends": {
            cat: {"count": cnt, "change": f"+{cnt}", "changePercent": 100}
            for cat, cnt in sorted(cat_counts.items(), key=lambda x: x[1], reverse=True)
        },
        "totalEvents":    len(events),
        "totalSources":   sum(e.get("sourceCount", 0) for e in events),
        "globalStats": {
            "avgAttentionScore": round(
                sum(e.get("attentionScore", 0) for e in events) / max(len(events), 1), 3
            ),
            "totalArticles":  sum(e.get("articleCount", 0) for e in events),
            "bubbleCount":    sum(1 for e in events if e.get("bubble")),
        },
    }


def write_json(path: str, data, indent: int = 2) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
    kb = os.path.getsize(path) // 1024
    print(f"  Wrote  {os.path.relpath(path)}  ({kb} KB)")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    start_ts = time.time()
    now_str  = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    print(f"\n{'='*64}")
    print(f"  World News Map — Data Fetcher")
    print(f"  {now_str}  |  {len(TOPICS)} topics")
    print(f"{'='*64}\n")

    events: list[dict] = []
    failed = 0

    for i, topic in enumerate(TOPICS):
        result = process_topic(topic, timespan="24h")
        if result:
            events.append(result)
        else:
            failed += 1
        # Polite delay between requests
        if i < len(TOPICS) - 1:
            time.sleep(REQUEST_DELAY_S)

    elapsed = round(time.time() - start_ts, 1)
    print(f"\n{'─'*64}")
    print(f"  {len(events)} events  |  {failed} failed  |  {elapsed}s elapsed")
    print(f"{'─'*64}\n")

    if not events:
        print("ERROR: No events fetched. Existing data unchanged.")
        return 1

    # Sort by attention score descending
    events.sort(key=lambda e: e.get("attentionScore", 0), reverse=True)

    print("Writing output files:")
    write_json(os.path.join(OUTPUT_DIR, "world-latest.json"),   events)
    write_json(os.path.join(OUTPUT_DIR, "top-headlines.json"),  {
        "headlines":   events[:10],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    })
    write_json(os.path.join(OUTPUT_DIR, "trends.json"),  build_trends(events))
    write_json(os.path.join(OUTPUT_DIR, "heatmap-24h.json"), build_heatmap(events))
    # 1h heatmap: only fresh events
    fresh_events = [e for e in events if e.get("freshness") == "fresh"]
    write_json(os.path.join(OUTPUT_DIR, "heatmap-1h.json"),  build_heatmap(fresh_events or events[:5]))

    # meta.json — read by client to show "data last updated X ago"
    write_json(os.path.join(OUTPUT_DIR, "meta.json"), {
        "generatedAt":  datetime.now(timezone.utc).isoformat(),
        "eventCount":   len(events),
        "failedTopics": failed,
        "elapsedSec":   elapsed,
        "source":       "gdelt",
    })

    print(f"\n{'='*64}")
    print(f"  Done — {len(events)} events saved in {elapsed}s")
    print(f"{'='*64}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
