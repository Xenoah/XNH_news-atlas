#!/usr/bin/env python3
"""
World News Map Viewer — GDELT News Data Fetcher v2
--------------------------------------------------
Key changes from v1:
  - Each GDELT article → individual map event  (was: 1 topic = 1 event)
  - 75 articles per topic  (was 25)  →  up to ~3,900 raw before dedup
  - URL deduplication across topics  →  ~600–1,500 unique events
  - Top 300 output sorted by attention score
  - Stable URL-seeded jitter: same article always maps to same position
  - Top-N bubble markers controlled by absolute score threshold
  - 52 topics for broader geographic coverage

GitHub Actions runtime:
  52 topics × ~2.0 s avg (fetch + delay) ≈ 104 s/run ≈ 1.7 min/run
  Public repo  → unlimited Actions minutes (GitHub Pages)
  Private repo → 744 runs/month × 1.7 min ≈ 1,265 min  (under 2,000 limit)
"""

import hashlib
import json
import math
import os
import random
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from collections import defaultdict

# ── Config ───────────────────────────────────────────────────────────────────

GDELT_API          = "https://api.gdeltproject.org/api/v2/doc/doc"
OUTPUT_DIR         = os.path.join(os.path.dirname(__file__), "..", "data")
ARTICLES_PER_TOPIC = 25    # Keep small: GDELT responds faster, less timeout risk
MAX_EVENTS_OUTPUT  = 600   # Top N events written to world-latest.json
REQUEST_DELAY_S    = 0.3   # Polite delay between GDELT requests (seconds)
GDELT_TIMEOUT_S    = 10    # Per-request timeout — fail fast, retry next hour
TIME_BUDGET_S      = 480   # 8-minute global budget; stop fetching topics if exceeded
BUBBLE_THRESHOLD   = 0.93  # attentionScore above which bubble:true is set

# ── Scoring weights ───────────────────────────────────────────────────────────

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

# ── Country coordinate table ──────────────────────────────────────────────────
# Used for: (a) topic default coords  (b) CODE_TO_COORDS reverse lookup

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
    "Belgium":          {"code": "BE", "lat":  50.85, "lng":    4.35},
    "Afghanistan":      {"code": "AF", "lat":  34.52, "lng":   69.18},
    "DR Congo":         {"code": "CD", "lat":  -4.32, "lng":   15.32},
    "Somalia":          {"code": "SO", "lat":   2.05, "lng":   45.34},
    "Sudan":            {"code": "SD", "lat":  15.55, "lng":   32.53},
    "Hungary":          {"code": "HU", "lat":  47.50, "lng":   19.04},
    "Morocco":          {"code": "MA", "lat":  33.99, "lng":   -6.85},
    "Bangladesh":       {"code": "BD", "lat":  23.72, "lng":   90.41},
    "Kazakhstan":       {"code": "KZ", "lat":  51.18, "lng":   71.45},
    "New Zealand":      {"code": "NZ", "lat": -36.86, "lng":  174.77},
    "Chile":            {"code": "CL", "lat": -33.46, "lng":  -70.65},
    "Peru":             {"code": "PE", "lat": -12.05, "lng":  -77.04},
    "Greece":           {"code": "GR", "lat":  37.98, "lng":   23.73},
    "Portugal":         {"code": "PT", "lat":  38.72, "lng":   -9.14},
    "Czech Republic":   {"code": "CZ", "lat":  50.09, "lng":   14.42},
    "Romania":          {"code": "RO", "lat":  44.44, "lng":   26.10},
    "Austria":          {"code": "AT", "lat":  48.21, "lng":   16.37},
    "Malaysia":         {"code": "MY", "lat":   3.14, "lng":  101.69},
    "Pakistan":         {"code": "PK", "lat":  33.72, "lng":   73.06},
    "Qatar":            {"code": "QA", "lat":  25.29, "lng":   51.53},
    "United Arab Emirates": {"code": "AE", "lat": 24.45, "lng": 54.38},
}

# Reverse lookup: 2-letter ISO code → coords + name
# Used when article has sourcecountry but topic has no fixed coords
CODE_TO_COORDS: dict[str, dict] = {
    info["code"]: {"lat": info["lat"], "lng": info["lng"], "name": name}
    for name, info in COUNTRY_COORDS.items()
}

# ── Topic definitions ─────────────────────────────────────────────────────────
# country/code/lat/lng = fixed location for this topic (None = auto-detect from sourcecountry)

TOPICS = [
    # ── Conflict ─────────────────────────────────────────────────────────────
    {"q": "ukraine russia war military ceasefire frontline Kyiv Zaporizhzhia",
     "country": "Ukraine",       "code": "UA", "lat":  50.45, "lng":  30.52, "cat": "conflict"},
    {"q": "israel gaza hamas war ceasefire hostages West Bank IDF strike",
     "country": "Israel",        "code": "IL", "lat":  31.77, "lng":  35.22, "cat": "conflict"},
    {"q": "taiwan strait china military PLA threat invasion deterrence",
     "country": "Taiwan",        "code": "TW", "lat":  25.05, "lng": 121.56, "cat": "conflict"},
    {"q": "north korea missile nuclear Kim Jong-un Pyongyang ICBM launch",
     "country": "North Korea",   "code": "KP", "lat":  39.02, "lng": 125.76, "cat": "conflict"},
    {"q": "myanmar civil war military junta resistance coup protest Yangon",
     "country": "Myanmar",       "code": "MM", "lat":  16.87, "lng":  96.15, "cat": "conflict"},
    {"q": "sudan civil war RSF Khartoum humanitarian crisis famine",
     "country": "Sudan",         "code": "SD", "lat":  15.55, "lng":  32.53, "cat": "conflict"},
    {"q": "iran israel strike missile attack Middle East escalation",
     "country": "Iran",          "code": "IR", "lat":  35.69, "lng":  51.39, "cat": "conflict"},
    {"q": "mexico cartel violence drugs narco border crime Culiacan Sinaloa",
     "country": "Mexico",        "code": "MX", "lat":  19.43, "lng": -99.13, "cat": "conflict"},
    {"q": "pakistan india kashmir border military tensions line of control",
     "country": "Pakistan",      "code": "PK", "lat":  33.72, "lng":  73.06, "cat": "conflict"},
    {"q": "nigeria africa sahel conflict coup insurgency Boko Haram Lagos Abuja",
     "country": "Nigeria",       "code": "NG", "lat":   9.08, "lng":   7.40, "cat": "conflict"},
    {"q": "afghanistan Taliban Kabul attack bombing humanitarian women",
     "country": "Afghanistan",   "code": "AF", "lat":  34.52, "lng":  69.18, "cat": "conflict"},
    {"q": "DR Congo DRC M23 rebel fighting Kinshasa eastern Congo FDLR",
     "country": "DR Congo",      "code": "CD", "lat":  -4.32, "lng":  15.32, "cat": "conflict"},
    {"q": "somalia Al-Shabaab attack Mogadishu conflict Kenya Ethiopia AU",
     "country": "Somalia",       "code": "SO", "lat":   2.05, "lng":  45.34, "cat": "conflict"},
    {"q": "colombia FARC ELN guerrilla armed group ceasefire Petro Bogota",
     "country": "Colombia",      "code": "CO", "lat":   4.71, "lng": -74.07, "cat": "conflict"},

    # ── Politics ─────────────────────────────────────────────────────────────
    {"q": "united states trump congress white house senate tariff executive order",
     "country": "United States", "code": "US", "lat":  38.89, "lng": -77.03, "cat": "politics"},
    {"q": "russia kremlin putin opposition war diplomacy ceasefire talks",
     "country": "Russia",        "code": "RU", "lat":  55.75, "lng":  37.62, "cat": "politics"},
    {"q": "china xi jinping communist party policy Beijing Taiwan diplomacy",
     "country": "China",         "code": "CN", "lat":  39.91, "lng": 116.39, "cat": "politics"},
    {"q": "UK Britain parliament London Starmer government reform Labour",
     "country": "United Kingdom","code": "GB", "lat":  51.51, "lng":  -0.13, "cat": "politics"},
    {"q": "france macron paris government politics parliament far-right",
     "country": "France",        "code": "FR", "lat":  48.86, "lng":   2.35, "cat": "politics"},
    {"q": "india modi BJP parliament New Delhi election coalition opposition",
     "country": "India",         "code": "IN", "lat":  28.61, "lng":  77.21, "cat": "politics"},
    {"q": "turkey erdogan istanbul opposition politics lira arrested",
     "country": "Turkey",        "code": "TR", "lat":  39.93, "lng":  32.86, "cat": "politics"},
    {"q": "brazil lula amazon deforestation politics congress reform",
     "country": "Brazil",        "code": "BR", "lat": -15.78, "lng": -47.93, "cat": "politics"},
    {"q": "south africa ANC politics Ramaphosa Johannesburg election coalition",
     "country": "South Africa",  "code": "ZA", "lat": -25.75, "lng":  28.19, "cat": "politics"},
    {"q": "iran nuclear sanctions Tehran negotiations Khamenei deal IAEA",
     "country": "Iran",          "code": "IR", "lat":  35.69, "lng":  51.39, "cat": "politics"},
    {"q": "indonesia politics election Prabowo Jakarta government policy",
     "country": "Indonesia",     "code": "ID", "lat":  -6.21, "lng": 106.85, "cat": "politics"},
    {"q": "philippines marcos Manila politics South China Sea military US",
     "country": "Philippines",   "code": "PH", "lat":  14.60, "lng": 120.98, "cat": "politics"},
    {"q": "venezuela Maduro opposition election Caracas sanctions oil crisis",
     "country": "Venezuela",     "code": "VE", "lat":  10.49, "lng": -66.88, "cat": "politics"},
    {"q": "poland Warsaw NATO Russia border EU politics government",
     "country": "Poland",        "code": "PL", "lat":  52.23, "lng":  21.01, "cat": "politics"},
    {"q": "australia china trade Pacific AUKUS Albanese defense",
     "country": "Australia",     "code": "AU", "lat": -33.87, "lng": 151.21, "cat": "politics"},
    {"q": "kenya Nairobi East Africa politics election economy IMF",
     "country": "Kenya",         "code": "KE", "lat":  -1.29, "lng":  36.82, "cat": "politics"},

    # ── Economy ──────────────────────────────────────────────────────────────
    {"q": "federal reserve interest rates inflation Wall Street US economy recession",
     "country": "United States", "code": "US", "lat":  40.71, "lng": -74.01, "cat": "economy"},
    {"q": "china economy market trade GDP Beijing stimulus property sector",
     "country": "China",         "code": "CN", "lat":  39.91, "lng": 116.39, "cat": "economy"},
    {"q": "oil gas energy prices OPEC Saudi Arabia barrel market supply cut",
     "country": "Saudi Arabia",  "code": "SA", "lat":  24.69, "lng":  46.72, "cat": "economy"},
    {"q": "germany economy recession GDP inflation Berlin manufacturing",
     "country": "Germany",       "code": "DE", "lat":  52.52, "lng":  13.40, "cat": "economy"},
    {"q": "japan economy yen Tokyo stock Bank of Japan interest rates Nikkei",
     "country": "Japan",         "code": "JP", "lat":  35.69, "lng": 139.69, "cat": "economy"},
    {"q": "india economy growth GDP Mumbai RBI Sensex investment infrastructure",
     "country": "India",         "code": "IN", "lat":  19.08, "lng":  72.88, "cat": "economy"},
    {"q": "European Union ECB euro economy trade tariffs Brussels recession",
     "country": "Belgium",       "code": "BE", "lat":  50.85, "lng":   4.35, "cat": "economy"},
    {"q": "cryptocurrency bitcoin ethereum blockchain DeFi market crash surge",
     "country": "United States", "code": "US", "lat":  37.77, "lng":-122.42, "cat": "economy"},
    {"q": "argentina Milei peso inflation IMF austerity economy Buenos Aires",
     "country": "Argentina",     "code": "AR", "lat": -34.61, "lng": -58.38, "cat": "economy"},
    {"q": "trade tariff WTO import export sanction global supply chain",
     "country": "United States", "code": "US", "lat":  38.89, "lng": -77.03, "cat": "economy"},

    # ── Technology ───────────────────────────────────────────────────────────
    {"q": "artificial intelligence AI OpenAI ChatGPT Google Gemini regulation",
     "country": "United States", "code": "US", "lat":  37.38, "lng":-122.08, "cat": "technology"},
    {"q": "semiconductor chip TSMC Intel AMD Nvidia shortage supply chain",
     "country": "Taiwan",        "code": "TW", "lat":  25.05, "lng": 121.56, "cat": "technology"},
    {"q": "cybersecurity hack data breach ransomware attack malware espionage",
     "country": "United States", "code": "US", "lat":  38.89, "lng": -77.03, "cat": "technology"},
    {"q": "china technology Huawei ban restriction export control Shenzhen",
     "country": "China",         "code": "CN", "lat":  22.54, "lng": 114.06, "cat": "technology"},
    {"q": "space SpaceX nasa rocket moon Mars Starship Artemis satellite launch",
     "country": "United States", "code": "US", "lat":  28.45, "lng": -80.53, "cat": "science"},
    {"q": "south korea Samsung LG semiconductor battery EV electric vehicle Seoul",
     "country": "South Korea",   "code": "KR", "lat":  37.57, "lng": 126.98, "cat": "technology"},

    # ── Health ───────────────────────────────────────────────────────────────
    {"q": "WHO health pandemic disease outbreak virus epidemic warning Geneva",
     "country": "Switzerland",   "code": "CH", "lat":  46.95, "lng":   7.45, "cat": "health"},
    {"q": "mpox bird flu H5N1 influenza avian outbreak spread cases confirmed",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "health"},
    {"q": "cancer drug trial vaccine approval FDA medicine treatment clinical",
     "country": "United States", "code": "US", "lat":  39.00, "lng": -77.10, "cat": "health"},
    {"q": "mental health crisis children youth suicide depression anxiety",
     "country": "United States", "code": "US", "lat":  38.89, "lng": -77.03, "cat": "health"},

    # ── Disaster ─────────────────────────────────────────────────────────────
    {"q": "earthquake tsunami magnitude Richter victims evacuate rescue",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "disaster"},
    {"q": "hurricane typhoon cyclone storm landfall Category emergency evacuation",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "disaster"},
    {"q": "flood wildfire drought extreme weather heatwave disaster relief",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "disaster"},
    {"q": "volcano eruption ash lava alert evacuate seismic",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "disaster"},

    # ── Science ──────────────────────────────────────────────────────────────
    {"q": "climate change global warming emissions carbon net zero Paris COP",
     "country": "United Kingdom","code": "GB", "lat":  51.51, "lng":  -0.13, "cat": "science"},
    {"q": "nuclear energy power plant SMR reactor clean energy fusion",
     "country": "United States", "code": "US", "lat":  38.89, "lng": -77.03, "cat": "science"},

    # ── Sports ───────────────────────────────────────────────────────────────
    {"q": "FIFA World Cup soccer football tournament championship goal",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "sports"},
    {"q": "Olympic Games Paris 2028 Los Angeles athlete medal record",
     "country": None,            "code": None, "lat":  None,  "lng":  None,  "cat": "sports"},
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def url_hash(url: str) -> str:
    """Short deterministic hash of a URL for use as event ID."""
    return hashlib.md5(url.encode()).hexdigest()[:12]


def stable_jitter(url: str, lat: float, lng: float, radius: float = 0.7) -> tuple[float, float]:
    """
    Apply a small, deterministic offset to coords based on the URL hash.
    Same article always appears at exactly the same map position across refreshes.
    Avoids piling all same-country articles on a single point.
    """
    seed = int(hashlib.md5(url.encode()).hexdigest()[:8], 16)
    rng  = random.Random(seed)
    angle = rng.uniform(0.0, 2.0 * math.pi)
    r     = rng.uniform(0.05, radius)
    return round(lat + r * math.sin(angle), 4), round(lng + r * math.cos(angle), 4)


def parse_gdelt_date(s: str) -> str:
    """Convert GDELT seendate '20260328T120000Z' → ISO-8601 string."""
    if not s:
        return datetime.now(timezone.utc).isoformat()
    try:
        c = s.replace("T", "").replace("Z", "")
        hh = c[8:10] if len(c) > 8 else "00"
        mm = c[10:12] if len(c) > 10 else "00"
        return f"{c[:4]}-{c[4:6]}-{c[6:8]}T{hh}:{mm}:00Z"
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def calc_freshness(iso: str) -> str:
    try:
        pub = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        h   = (datetime.now(timezone.utc) - pub).total_seconds() / 3600
        if h < 3:   return "fresh"
        if h < 24:  return "recent"
        if h < 168: return "ongoing"
        return "archive"
    except Exception:
        return "recent"


def fetch_gdelt(query: str, timespan: str = "24h", max_records: int = ARTICLES_PER_TOPIC) -> list:
    """
    Call GDELT DOC 2.0 API (ArtList mode).
    Implements the API per official documentation:
      https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

    Valid URL parameters: query, mode, maxrecords, format, timespan,
                          startdatetime, enddatetime, sort
    Note: sourcelang / sourcecountry are query OPERATORS embedded in the
          query string (e.g. "ukraine war sourcelang:English"), NOT URL params.
    """
    # sourcelang:English goes inside the query string, per official docs
    full_query = f"{query} sourcelang:English"
    params = urllib.parse.urlencode({
        "query":      full_query,
        "mode":       "ArtList",
        "maxrecords": str(max_records),
        "format":     "json",
        "timespan":   timespan,
        "sort":       "HybridRel",   # hybrid relevance+recency, per official docs
    })
    request_url = f"{GDELT_API}?{params}"
    try:
        req = urllib.request.Request(
            request_url,
            headers={"User-Agent": "WorldNewsMapViewer/2.0 (github.com; news visualization)"}
        )
        with urllib.request.urlopen(req, timeout=GDELT_TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            arts = data.get("articles") or []
            return [a for a in arts if a.get("url") and a.get("title")]
    except Exception as e:
        print(f"    [GDELT error] {type(e).__name__}: {e}")
        return []


def process_topic(topic: dict, timespan: str = "24h") -> list[dict]:
    """
    Fetch one topic and return a list of individual article-level events.
    Each article becomes its own map event (vs. v1 where 1 topic = 1 event).
    """
    cat     = topic["cat"]
    country = topic.get("country")
    code    = topic.get("code")
    lat     = topic.get("lat")
    lng     = topic.get("lng")
    label   = f"{cat}/{country or '?'}"
    print(f"  → {label:<30} {topic['q'][:52]}…")

    articles = fetch_gdelt(topic["q"], timespan, ARTICLES_PER_TOPIC)
    if not articles:
        print(f"    ✗  No results")
        return []

    # Topic-level stats used to score every article in this topic
    domains   = {a.get("domain", "") for a in articles if a.get("domain")}
    n_sources = len(domains)
    coverage  = min(n_sources / 20.0, 1.0)  # 20+ unique domains = max coverage
    cat_w     = CATEGORY_WEIGHTS.get(cat, 0.2)
    n         = len(articles)

    print(f"    ✓  {n} articles / {n_sources} sources")

    events: list[dict] = []

    for i, article in enumerate(articles):
        art_url   = (article.get("url")   or "").strip()
        art_title = (article.get("title") or "").strip()
        if not art_url or not art_title:
            continue

        # ── Resolve coordinates ─────────────────────────────────────────────
        a_lat, a_lng = lat, lng
        a_country, a_code = country, code

        if a_lat is None:
            sc   = (article.get("sourcecountry") or "").upper()
            info = CODE_TO_COORDS.get(sc)
            if info:
                a_lat, a_lng = info["lat"], info["lng"]
                a_country    = info["name"]
                a_code       = sc

        if a_lat is None:
            continue  # can't place this article on the map

        # Stable per-URL jitter so position is reproducible across refreshes
        j_lat, j_lng = stable_jitter(art_url, a_lat, a_lng)

        # ── Attention score ─────────────────────────────────────────────────
        # position_ratio: 1.0 for first article (most relevant), 0.0 for last
        position_ratio = 1.0 - (i / max(n - 1, 1))
        attention = round(
            min(0.35 * position_ratio + 0.40 * cat_w + 0.25 * coverage, 0.99),
            4
        )
        velocity = round(position_ratio, 4)

        published_at = parse_gdelt_date(article.get("seendate"))
        freshness    = calc_freshness(published_at)
        domain       = article.get("domain", "unknown")

        # Build a slightly informative summary from available metadata
        rank_word = "Breaking" if i == 0 else ("Top story" if i < 5 else "Developing")
        summary   = (
            f"{rank_word} via {domain}. "
            f"Covered by {n_sources} source{'s' if n_sources != 1 else ''} "
            f"in {cat} category."
        )

        events.append({
            "id":                f"ga_{url_hash(art_url)}",
            "title":             art_title,
            "summary":           summary,
            "category":          cat,
            "countryCode":       a_code or "XX",
            "countryName":       a_country or "Unknown",
            "regionName":        a_country or "Unknown",
            "locationName":      a_country or "Unknown",
            "lat":               j_lat,
            "lng":               j_lng,
            "geoPrecision":      "city" if topic.get("lat") else "country",
            "publishedAt":       published_at,
            "firstSeenAt":       published_at,
            "lastUpdatedAt":     datetime.now(timezone.utc).isoformat(),
            "freshness":         freshness,
            "articleCount":      1,
            "sourceCount":       1,
            "attentionScore":    attention,
            "velocityScore":     velocity,
            "crossBorderFactor": round(coverage, 4),
            "bubble":            False,   # set in main() after global sort
            "tags":              [w for w in topic["q"].split() if len(w) > 3][:6],
            "sources": [{
                "name":        domain,
                "url":         art_url,
                "title":       art_title,
                "publishedAt": published_at,
            }],
        })

    return events


# ── Output builders ───────────────────────────────────────────────────────────

def build_heatmap(events: list) -> dict:
    """GeoJSON FeatureCollection for MapLibre heatmap layer."""
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
        if e.get("lat") is not None and e.get("lng") is not None
    ]
    return {"type": "FeatureCollection", "features": features}


def build_trends(events: list) -> dict:
    cat_counts: dict[str, int] = defaultdict(int)
    for e in events:
        cat_counts[e["category"]] += 1

    rising = sorted(events, key=lambda e: e.get("velocityScore", 0), reverse=True)[:8]

    return {
        "generatedAt":  datetime.now(timezone.utc).isoformat(),
        "timeRange":    "24h",
        "risingEvents": [
            {
                "id":            e["id"],
                "title":         e["title"],
                "velocityScore": e["velocityScore"],
                "category":      e["category"],
                "countryName":   e["countryName"],
            }
            for e in rising
        ],
        "risingRegions": [],
        "categoryTrends": {
            cat: {"count": cnt, "change": f"+{cnt}", "changePercent": 100}
            for cat, cnt in sorted(cat_counts.items(), key=lambda x: x[1], reverse=True)
        },
        "totalEvents":  len(events),
        "totalSources": sum(e.get("sourceCount", 0) for e in events),
        "globalStats": {
            "avgAttentionScore": round(
                sum(e.get("attentionScore", 0) for e in events) / max(len(events), 1), 3
            ),
            "totalArticles": sum(e.get("articleCount", 0) for e in events),
            "bubbleCount":   sum(1 for e in events if e.get("bubble")),
        },
    }


def write_json(path: str, data, indent: int = 2) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
    kb = os.path.getsize(path) // 1024
    print(f"  Wrote  {os.path.relpath(path)}  ({kb} KB)")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    start_ts = time.time()
    now_str  = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    print(f"\n{'='*68}")
    print(f"  World News Map — Data Fetcher v2")
    print(f"  {now_str}  |  {len(TOPICS)} topics  |  {ARTICLES_PER_TOPIC} art/topic")
    print(f"{'='*68}\n")

    # Collect all article-events, deduplicate by URL
    events_by_url: dict[str, dict] = {}
    failed = 0

    for i, topic in enumerate(TOPICS):
        elapsed_so_far = time.time() - start_ts
        if elapsed_so_far > TIME_BUDGET_S:
            print(f"  ⏱ Time budget ({TIME_BUDGET_S}s) reached after {i}/{len(TOPICS)} topics — stopping early")
            break

        new_events = process_topic(topic, timespan="24h")
        if not new_events:
            failed += 1
        for e in new_events:
            art_url = e["sources"][0]["url"]
            if art_url not in events_by_url:
                events_by_url[art_url] = e
            else:
                # Same article appeared in multiple topic queries; keep higher score
                if e["attentionScore"] > events_by_url[art_url]["attentionScore"]:
                    events_by_url[art_url] = e
        if i < len(TOPICS) - 1:
            time.sleep(REQUEST_DELAY_S)

    elapsed = round(time.time() - start_ts, 1)

    # Sort globally and take top MAX_EVENTS_OUTPUT
    all_events = sorted(events_by_url.values(),
                        key=lambda e: e["attentionScore"], reverse=True)
    all_events = all_events[:MAX_EVENTS_OUTPUT]

    # Mark top articles as bubble (high-attention events get pulsing marker)
    for e in all_events:
        e["bubble"] = e["attentionScore"] >= BUBBLE_THRESHOLD

    bubble_count = sum(1 for e in all_events if e["bubble"])

    print(f"\n{'─'*68}")
    print(f"  Raw unique events : {len(events_by_url)}")
    print(f"  Output (top {MAX_EVENTS_OUTPUT})    : {len(all_events)}")
    print(f"  Bubble markers    : {bubble_count}")
    print(f"  Failed topics     : {failed}")
    print(f"  Elapsed           : {elapsed}s")
    print(f"{'─'*68}\n")

    if not all_events:
        # Preserve existing data rather than overwriting with empty files.
        # This protects against GDELT rate-limiting on a single run.
        print("WARNING: No events fetched (possible rate limit). Existing data preserved.")
        return 0   # exit 0 so Actions marks the run green and retries next hour

    # Warn loudly but continue if yield is unusually low (< 5% of expected)
    expected_min = len(TOPICS) * 3
    if len(all_events) < expected_min:
        print(f"WARNING: Only {len(all_events)} events (expected ≥ {expected_min}). "
              "GDELT may be rate-limiting this run.")

    # ── Write output files ────────────────────────────────────────────────────
    print("Writing output files:")

    write_json(os.path.join(OUTPUT_DIR, "world-latest.json"), all_events)

    write_json(os.path.join(OUTPUT_DIR, "top-headlines.json"), {
        "headlines":   all_events[:10],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    })

    write_json(os.path.join(OUTPUT_DIR, "trends.json"), build_trends(all_events))

    write_json(os.path.join(OUTPUT_DIR, "heatmap-24h.json"), build_heatmap(all_events))

    fresh_events = [e for e in all_events if e.get("freshness") == "fresh"]
    write_json(os.path.join(OUTPUT_DIR, "heatmap-1h.json"),
               build_heatmap(fresh_events or all_events[:20]))

    write_json(os.path.join(OUTPUT_DIR, "meta.json"), {
        "generatedAt":    datetime.now(timezone.utc).isoformat(),
        "eventCount":     len(all_events),
        "rawUniqueCount": len(events_by_url),
        "failedTopics":   failed,
        "elapsedSec":     elapsed,
        "source":         "gdelt",
        "version":        2,
    })

    print(f"\n{'='*68}")
    print(f"  Done — {len(all_events)} events  ({bubble_count} bubbles)  in {elapsed}s")
    print(f"{'='*68}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
