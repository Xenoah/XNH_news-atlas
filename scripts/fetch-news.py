#!/usr/bin/env python3
"""
World News Map Viewer — RSS/Geo News Data Fetcher v5
------------------------------------------------
Replaces GDELT DOC API (blocked GitHub Actions IPs) with public RSS feeds.
Sources: major RSS publishers plus explicit-geo services such as GDACS, USGS, and NASA EONET

Strategy:
  1. Load existing world-latest.json (accumulation base)
  2. Fetch broad RSS feeds plus explicit GeoRSS/GeoJSON services
  3. Prefer explicit coordinates when present; otherwise fall back to keyword geocoding
  4. Merge: add only new URLs — skip duplicates
  5. Prune events 7 days after publication
  6. Sort by attention score → write top MAX_EVENTS_OUTPUT

Runtime: ~30-35 sources × ~1s each ≈ 30–90 s per run (well under 10 min limit)
"""

import hashlib
import json
import math
import os
import random
import re
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

# ── Config ────────────────────────────────────────────────────────────────────

OUTPUT_DIR        = os.path.join(os.path.dirname(__file__), "..", "data")
COPILOT_GEOTAGS_PATH = os.path.join(os.path.dirname(__file__), "copilot-geotags.json")
MAX_EVENTS_OUTPUT = 5000   # top N events written to world-latest.json
PRUNE_DAYS        = 7      # remove events this many days after publication
FETCH_TIMEOUT_S   = 15     # per-feed HTTP timeout
BUBBLE_THRESHOLD  = 0.82   # attentionScore above which bubble:true is set

# Only publishers with feed terms we could confirm are allowed here.
# Keep this list conservative and re-check before any commercial use.
THUMBNAIL_WHITELIST = {
    "abc.net.au",
}

MEDIA_NS = "http://search.yahoo.com/mrss/"
ATOM_NS  = "http://www.w3.org/2005/Atom"
GEORSS_NS = "http://www.georss.org/georss"
GML_NS = "http://www.opengis.net/gml"
WGS84_NS = "http://www.w3.org/2003/01/geo/wgs84_pos#"

# ── RSS Sources ───────────────────────────────────────────────────────────────

RSS_SOURCES = [
    # BBC (most reliable, many regional sub-feeds)
    {"url": "http://feeds.bbci.co.uk/news/world/rss.xml",                    "cat": "politics"},
    {"url": "http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml",      "cat": "politics"},
    {"url": "http://feeds.bbci.co.uk/news/world/europe/rss.xml",             "cat": "politics"},
    {"url": "http://feeds.bbci.co.uk/news/world/asia/rss.xml",               "cat": "politics"},
    {"url": "http://feeds.bbci.co.uk/news/world/africa/rss.xml",             "cat": "conflict"},
    {"url": "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml",        "cat": "conflict"},
    {"url": "http://feeds.bbci.co.uk/news/world/latin_america/rss.xml",      "cat": "politics"},
    {"url": "http://feeds.bbci.co.uk/news/business/rss.xml",                 "cat": "economy"},
    {"url": "http://feeds.bbci.co.uk/news/technology/rss.xml",               "cat": "technology"},
    {"url": "http://feeds.bbci.co.uk/news/science_and_environment/rss.xml",  "cat": "science"},
    {"url": "http://feeds.bbci.co.uk/news/health/rss.xml",                   "cat": "health"},
    {"url": "http://feeds.bbci.co.uk/sport/rss.xml",                         "cat": "sports"},
    # Al Jazeera
    {"url": "https://www.aljazeera.com/xml/rss/all.xml",                     "cat": "politics"},
    # Deutsche Welle
    {"url": "https://rss.dw.com/rdf/rss-en-world",                           "cat": "politics"},
    {"url": "https://rss.dw.com/rdf/rss-en-top",                             "cat": "politics"},
    # France 24
    {"url": "https://www.france24.com/en/rss",                               "cat": "politics"},
    # The Guardian
    {"url": "https://www.theguardian.com/world/rss",                         "cat": "politics"},
    {"url": "https://www.theguardian.com/us-news/rss",                       "cat": "politics"},
    {"url": "https://www.theguardian.com/business/rss",                      "cat": "economy"},
    {"url": "https://www.theguardian.com/technology/rss",                    "cat": "technology"},
    {"url": "https://www.theguardian.com/environment/rss",                   "cat": "science"},
    {"url": "https://www.theguardian.com/society/rss",                       "cat": "health"},
    # NPR
    {"url": "https://feeds.npr.org/1001/rss.xml",                            "cat": "politics"},
    {"url": "https://feeds.npr.org/1004/rss.xml",                            "cat": "politics"},
    # VOA
    {"url": "https://www.voanews.com/api/zommqveiqt",                        "cat": "politics"},
    # ABC Australia
    {"url": "https://www.abc.net.au/news/feed/51120/rss.xml",                "cat": "politics"},
    # Euronews
    {"url": "https://www.euronews.com/rss",                                  "cat": "politics"},
    # Hacker News (tech)
    {"url": "https://hnrss.org/frontpage",                                   "cat": "technology"},
]

EXPLICIT_GEO_SOURCES = [
    {
        "type": "rss",
        "service": "gdacs",
        "url": "https://gdacs.org/Default.aspx/Alerts/xml/xml/rss.xml",
        "cat": "disaster",
    },
    {
        "type": "json",
        "service": "usgs",
        "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson",
        "cat": "disaster",
        "parser": "usgs",
    },
    {
        "type": "json",
        "service": "usgs",
        "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
        "cat": "disaster",
        "parser": "usgs",
    },
    {
        "type": "json",
        "service": "eonet",
        "url": "https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=7&limit=200",
        "cat": "disaster",
        "parser": "eonet",
    },
]

# ── Source reputation weights (for attention scoring) ─────────────────────────

SOURCE_REPUTATION: dict[str, float] = {
    "bbc.co.uk": 1.0, "bbc.com": 1.0,
    "aljazeera.com": 0.95,
    "theguardian.com": 0.90,
    "dw.com": 0.88,
    "france24.com": 0.85,
    "npr.org": 0.85,
    "voanews.com": 0.80,
    "abc.net.au": 0.80,
    "euronews.com": 0.75,
    "ycombinator.com": 0.65,
}
DEFAULT_REPUTATION = 0.60

# ── Category weights ──────────────────────────────────────────────────────────

CATEGORY_WEIGHTS: dict[str, float] = {
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

# ── Category keyword overrides ────────────────────────────────────────────────
# If any of these words appear in title (case-insensitive), override feed's default category.

CATEGORY_KEYWORDS: list[tuple[str, str]] = [
    # conflict first (highest priority)
    ("war",            "conflict"), ("military",    "conflict"), ("troops",     "conflict"),
    ("ceasefire",      "conflict"), ("airstrike",   "conflict"), ("offensive",  "conflict"),
    ("frontline",      "conflict"), ("invasion",    "conflict"), ("insurgent",  "conflict"),
    ("rebel",          "conflict"), ("jihadist",    "conflict"), ("killed in",  "conflict"),
    ("casualties",     "conflict"), ("bombing",     "conflict"), ("missile strike","conflict"),
    # disaster
    ("earthquake",     "disaster"), ("tsunami",     "disaster"), ("hurricane",  "disaster"),
    ("typhoon",        "disaster"), ("cyclone",     "disaster"), ("tornado",    "disaster"),
    ("wildfire",       "disaster"), ("volcano",     "disaster"), ("eruption",   "disaster"),
    ("flood",          "disaster"), ("landslide",   "disaster"), ("drought",    "disaster"),
    # economy
    ("inflation",      "economy"),  ("recession",   "economy"),  ("tariff",     "economy"),
    ("gdp",            "economy"),  ("interest rate","economy"), ("bitcoin",    "economy"),
    ("cryptocurrency", "economy"),  ("oil price",   "economy"),  ("stock market","economy"),
    ("trade war",      "economy"),  ("sanctions",   "economy"),  ("imf",        "economy"),
    # health
    ("outbreak",       "health"),   ("pandemic",    "health"),   ("epidemic",   "health"),
    ("vaccine",        "health"),   ("virus",       "health"),   ("who ",       "health"),
    ("bird flu",       "health"),   ("mpox",        "health"),   ("cancer",     "health"),
    # technology
    ("artificial intelligence","technology"), ("chatgpt","technology"),
    ("cybersecurity",  "technology"), ("ransomware","technology"),
    ("semiconductor",  "technology"), ("openai",    "technology"),
    # science
    ("climate change", "science"),  ("global warming","science"), ("emissions","science"),
    ("nasa",           "science"),  ("spacex",      "science"),   ("asteroid",  "science"),
    # sports
    ("world cup",      "sports"),   ("olympic",     "sports"),   ("championship","sports"),
    ("tournament",     "sports"),   ("premier league","sports"),
]

# ── Location keyword table ────────────────────────────────────────────────────
# Checked against title + description (case-sensitive scan, longest match wins).
# Cities/specific places listed before country names so they match first.

LOCATION_KEYWORDS: list[tuple[str, dict]] = [
    # ── Specific cities / places ──────────────────────────────────────────────
    ("Gaza",          {"country": "Israel",        "code": "IL", "lat":  31.50, "lng":  34.47}),
    ("West Bank",     {"country": "Israel",        "code": "IL", "lat":  31.90, "lng":  35.20}),
    ("Kyiv",          {"country": "Ukraine",       "code": "UA", "lat":  50.45, "lng":  30.52}),
    ("Kiev",          {"country": "Ukraine",       "code": "UA", "lat":  50.45, "lng":  30.52}),
    ("Kharkiv",       {"country": "Ukraine",       "code": "UA", "lat":  49.99, "lng":  36.23}),
    ("Zaporizhzhia",  {"country": "Ukraine",       "code": "UA", "lat":  47.84, "lng":  35.14}),
    ("Moscow",        {"country": "Russia",        "code": "RU", "lat":  55.75, "lng":  37.62}),
    ("Kremlin",       {"country": "Russia",        "code": "RU", "lat":  55.75, "lng":  37.62}),
    ("Beijing",       {"country": "China",         "code": "CN", "lat":  39.91, "lng": 116.39}),
    ("Shanghai",      {"country": "China",         "code": "CN", "lat":  31.23, "lng": 121.47}),
    ("Washington",    {"country": "United States", "code": "US", "lat":  38.89, "lng": -77.03}),
    ("White House",   {"country": "United States", "code": "US", "lat":  38.89, "lng": -77.03}),
    ("Wall Street",   {"country": "United States", "code": "US", "lat":  40.71, "lng": -74.01}),
    ("New York",      {"country": "United States", "code": "US", "lat":  40.71, "lng": -74.01}),
    ("Silicon Valley",{"country": "United States", "code": "US", "lat":  37.38, "lng":-122.08}),
    ("San Francisco", {"country": "United States", "code": "US", "lat":  37.77, "lng":-122.42}),
    ("London",        {"country": "United Kingdom","code": "GB", "lat":  51.51, "lng":  -0.13}),
    ("Paris",         {"country": "France",        "code": "FR", "lat":  48.86, "lng":   2.35}),
    ("Berlin",        {"country": "Germany",       "code": "DE", "lat":  52.52, "lng":  13.40}),
    ("Brussels",      {"country": "Belgium",       "code": "BE", "lat":  50.85, "lng":   4.35}),
    ("Rome",          {"country": "Italy",         "code": "IT", "lat":  41.90, "lng":  12.50}),
    ("Madrid",        {"country": "Spain",         "code": "ES", "lat":  40.42, "lng":  -3.70}),
    ("Warsaw",        {"country": "Poland",        "code": "PL", "lat":  52.23, "lng":  21.01}),
    ("Budapest",      {"country": "Hungary",       "code": "HU", "lat":  47.50, "lng":  19.04}),
    ("Kyiv",          {"country": "Ukraine",       "code": "UA", "lat":  50.45, "lng":  30.52}),
    ("Tokyo",         {"country": "Japan",         "code": "JP", "lat":  35.69, "lng": 139.69}),
    ("Seoul",         {"country": "South Korea",   "code": "KR", "lat":  37.57, "lng": 126.98}),
    ("Pyongyang",     {"country": "North Korea",   "code": "KP", "lat":  39.02, "lng": 125.76}),
    ("Taipei",        {"country": "Taiwan",        "code": "TW", "lat":  25.05, "lng": 121.56}),
    ("New Delhi",     {"country": "India",         "code": "IN", "lat":  28.61, "lng":  77.21}),
    ("Mumbai",        {"country": "India",         "code": "IN", "lat":  19.08, "lng":  72.88}),
    ("Islamabad",     {"country": "Pakistan",      "code": "PK", "lat":  33.72, "lng":  73.06}),
    ("Kabul",         {"country": "Afghanistan",   "code": "AF", "lat":  34.52, "lng":  69.18}),
    ("Tehran",        {"country": "Iran",          "code": "IR", "lat":  35.69, "lng":  51.39}),
    ("Baghdad",       {"country": "Iraq",          "code": "IQ", "lat":  33.34, "lng":  44.40}),
    ("Damascus",      {"country": "Syria",         "code": "SY", "lat":  33.51, "lng":  36.29}),
    ("Riyadh",        {"country": "Saudi Arabia",  "code": "SA", "lat":  24.69, "lng":  46.72}),
    ("Ankara",        {"country": "Turkey",        "code": "TR", "lat":  39.93, "lng":  32.86}),
    ("Istanbul",      {"country": "Turkey",        "code": "TR", "lat":  41.01, "lng":  28.98}),
    ("Cairo",         {"country": "Egypt",         "code": "EG", "lat":  30.04, "lng":  31.24}),
    ("Nairobi",       {"country": "Kenya",         "code": "KE", "lat":  -1.29, "lng":  36.82}),
    ("Lagos",         {"country": "Nigeria",       "code": "NG", "lat":   6.45, "lng":   3.40}),
    ("Abuja",         {"country": "Nigeria",       "code": "NG", "lat":   9.08, "lng":   7.40}),
    ("Johannesburg",  {"country": "South Africa",  "code": "ZA", "lat": -26.20, "lng":  28.04}),
    ("Addis Ababa",   {"country": "Ethiopia",      "code": "ET", "lat":   9.03, "lng":  38.74}),
    ("Kinshasa",      {"country": "DR Congo",      "code": "CD", "lat":  -4.32, "lng":  15.32}),
    ("Mogadishu",     {"country": "Somalia",       "code": "SO", "lat":   2.05, "lng":  45.34}),
    ("Khartoum",      {"country": "Sudan",         "code": "SD", "lat":  15.55, "lng":  32.53}),
    ("Tripoli",       {"country": "Libya",         "code": "LY", "lat":  32.90, "lng":  13.18}),
    ("Sanaa",         {"country": "Yemen",         "code": "YE", "lat":  15.36, "lng":  44.19}),
    ("Yangon",        {"country": "Myanmar",       "code": "MM", "lat":  16.87, "lng":  96.15}),
    ("Bangkok",       {"country": "Thailand",      "code": "TH", "lat":  13.75, "lng": 100.52}),
    ("Jakarta",       {"country": "Indonesia",     "code": "ID", "lat":  -6.21, "lng": 106.85}),
    ("Manila",        {"country": "Philippines",   "code": "PH", "lat":  14.60, "lng": 120.98}),
    ("Hanoi",         {"country": "Vietnam",       "code": "VN", "lat":  21.03, "lng": 105.85}),
    ("Brasilia",      {"country": "Brazil",        "code": "BR", "lat": -15.78, "lng": -47.93}),
    ("Buenos Aires",  {"country": "Argentina",     "code": "AR", "lat": -34.61, "lng": -58.38}),
    ("Bogota",        {"country": "Colombia",      "code": "CO", "lat":   4.71, "lng": -74.07}),
    ("Caracas",       {"country": "Venezuela",     "code": "VE", "lat":  10.49, "lng": -66.88}),
    ("Mexico City",   {"country": "Mexico",        "code": "MX", "lat":  19.43, "lng": -99.13}),
    ("Ottawa",        {"country": "Canada",        "code": "CA", "lat":  45.42, "lng": -75.70}),
    ("Sydney",        {"country": "Australia",     "code": "AU", "lat": -33.87, "lng": 151.21}),
    ("Canberra",      {"country": "Australia",     "code": "AU", "lat": -35.28, "lng": 149.13}),
    ("Singapore",     {"country": "Singapore",     "code": "SG", "lat":   1.35, "lng": 103.82}),
    # ── Countries / political entities ────────────────────────────────────────
    ("Ukraine",       {"country": "Ukraine",       "code": "UA", "lat":  50.45, "lng":  30.52}),
    ("Russia",        {"country": "Russia",        "code": "RU", "lat":  55.75, "lng":  37.62}),
    ("China",         {"country": "China",         "code": "CN", "lat":  39.91, "lng": 116.39}),
    ("United States", {"country": "United States", "code": "US", "lat":  38.89, "lng": -77.03}),
    ("Trump",         {"country": "United States", "code": "US", "lat":  38.89, "lng": -77.03}),
    ("Biden",         {"country": "United States", "code": "US", "lat":  38.89, "lng": -77.03}),
    ("American",      {"country": "United States", "code": "US", "lat":  38.89, "lng": -77.03}),
    ("Britain",       {"country": "United Kingdom","code": "GB", "lat":  51.51, "lng":  -0.13}),
    ("British",       {"country": "United Kingdom","code": "GB", "lat":  51.51, "lng":  -0.13}),
    (" UK ",          {"country": "United Kingdom","code": "GB", "lat":  51.51, "lng":  -0.13}),
    ("France",        {"country": "France",        "code": "FR", "lat":  48.86, "lng":   2.35}),
    ("Germany",       {"country": "Germany",       "code": "DE", "lat":  52.52, "lng":  13.40}),
    ("Japan",         {"country": "Japan",         "code": "JP", "lat":  35.69, "lng": 139.69}),
    ("South Korea",   {"country": "South Korea",   "code": "KR", "lat":  37.57, "lng": 126.98}),
    ("North Korea",   {"country": "North Korea",   "code": "KP", "lat":  39.02, "lng": 125.76}),
    ("Taiwan",        {"country": "Taiwan",        "code": "TW", "lat":  25.05, "lng": 121.56}),
    ("India",         {"country": "India",         "code": "IN", "lat":  28.61, "lng":  77.21}),
    ("Pakistan",      {"country": "Pakistan",      "code": "PK", "lat":  33.72, "lng":  73.06}),
    ("Afghanistan",   {"country": "Afghanistan",   "code": "AF", "lat":  34.52, "lng":  69.18}),
    ("Taliban",       {"country": "Afghanistan",   "code": "AF", "lat":  34.52, "lng":  69.18}),
    ("Iran",          {"country": "Iran",          "code": "IR", "lat":  35.69, "lng":  51.39}),
    ("Iraq",          {"country": "Iraq",          "code": "IQ", "lat":  33.34, "lng":  44.40}),
    ("Syria",         {"country": "Syria",         "code": "SY", "lat":  33.51, "lng":  36.29}),
    ("Saudi Arabia",  {"country": "Saudi Arabia",  "code": "SA", "lat":  24.69, "lng":  46.72}),
    ("Turkey",        {"country": "Turkey",        "code": "TR", "lat":  39.93, "lng":  32.86}),
    ("Egypt",         {"country": "Egypt",         "code": "EG", "lat":  30.04, "lng":  31.24}),
    ("Libya",         {"country": "Libya",         "code": "LY", "lat":  32.90, "lng":  13.18}),
    ("Sudan",         {"country": "Sudan",         "code": "SD", "lat":  15.55, "lng":  32.53}),
    ("Ethiopia",      {"country": "Ethiopia",      "code": "ET", "lat":   9.03, "lng":  38.74}),
    ("Nigeria",       {"country": "Nigeria",       "code": "NG", "lat":   9.08, "lng":   7.40}),
    ("Kenya",         {"country": "Kenya",         "code": "KE", "lat":  -1.29, "lng":  36.82}),
    ("South Africa",  {"country": "South Africa",  "code": "ZA", "lat": -25.75, "lng":  28.19}),
    ("Brazil",        {"country": "Brazil",        "code": "BR", "lat": -15.78, "lng": -47.93}),
    ("Argentina",     {"country": "Argentina",     "code": "AR", "lat": -34.61, "lng": -58.38}),
    ("Mexico",        {"country": "Mexico",        "code": "MX", "lat":  19.43, "lng": -99.13}),
    ("Canada",        {"country": "Canada",        "code": "CA", "lat":  45.42, "lng": -75.70}),
    ("Australia",     {"country": "Australia",     "code": "AU", "lat": -33.87, "lng": 151.21}),
    ("Indonesia",     {"country": "Indonesia",     "code": "ID", "lat":  -6.21, "lng": 106.85}),
    ("Philippines",   {"country": "Philippines",   "code": "PH", "lat":  14.60, "lng": 120.98}),
    ("Myanmar",       {"country": "Myanmar",       "code": "MM", "lat":  16.87, "lng":  96.15}),
    ("Venezuela",     {"country": "Venezuela",     "code": "VE", "lat":  10.49, "lng": -66.88}),
    ("Colombia",      {"country": "Colombia",      "code": "CO", "lat":   4.71, "lng": -74.07}),
    ("Yemen",         {"country": "Yemen",         "code": "YE", "lat":  15.36, "lng":  44.19}),
    ("Somalia",       {"country": "Somalia",       "code": "SO", "lat":   2.05, "lng":  45.34}),
    ("DR Congo",      {"country": "DR Congo",      "code": "CD", "lat":  -4.32, "lng":  15.32}),
    ("Congo",         {"country": "DR Congo",      "code": "CD", "lat":  -4.32, "lng":  15.32}),
    ("Poland",        {"country": "Poland",        "code": "PL", "lat":  52.23, "lng":  21.01}),
    ("Israel",        {"country": "Israel",        "code": "IL", "lat":  31.77, "lng":  35.22}),
    ("Hamas",         {"country": "Israel",        "code": "IL", "lat":  31.50, "lng":  34.47}),
    ("Lebanon",       {"country": "Lebanon",       "code": "LB", "lat":  33.89, "lng":  35.50}),
    ("Hezbollah",     {"country": "Lebanon",       "code": "LB", "lat":  33.89, "lng":  35.50}),
    ("Vietnam",       {"country": "Vietnam",       "code": "VN", "lat":  21.03, "lng": 105.85}),
    ("Thailand",      {"country": "Thailand",      "code": "TH", "lat":  13.75, "lng": 100.52}),
    ("Malaysia",      {"country": "Malaysia",      "code": "MY", "lat":   3.14, "lng": 101.69}),
    ("NATO",          {"country": "Belgium",       "code": "BE", "lat":  50.85, "lng":   4.35}),
    ("European Union",{"country": "Belgium",       "code": "BE", "lat":  50.85, "lng":   4.35}),
    (" EU ",          {"country": "Belgium",       "code": "BE", "lat":  50.85, "lng":   4.35}),
    ("OPEC",          {"country": "Saudi Arabia",  "code": "SA", "lat":  24.69, "lng":  46.72}),
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def url_hash(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:12]


def stable_jitter(url: str, lat: float, lng: float, radius: float = 0.5) -> tuple[float, float]:
    """Deterministic per-URL coordinate jitter. Same article → same map position."""
    seed = int(hashlib.md5(url.encode()).hexdigest()[:8], 16)
    rng  = random.Random(seed)
    angle = rng.uniform(0.0, 2.0 * math.pi)
    r     = rng.uniform(0.02, radius)
    return round(lat + r * math.sin(angle), 4), round(lng + r * math.cos(angle), 4)


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text or "").strip()


def parse_pub_date(date_str: str) -> str:
    """Convert RSS (RFC 822) or Atom (ISO 8601) date → ISO 8601 UTC string."""
    if not date_str:
        return datetime.now(timezone.utc).isoformat()
    date_str = date_str.strip()
    # ISO 8601 (Atom)
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(date_str[:len(fmt)], fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    # RFC 822 (RSS 2.0)
    try:
        dt = parsedate_to_datetime(date_str)
        return dt.astimezone(timezone.utc).isoformat()
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


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def get_published_at(event: dict) -> datetime | None:
    return parse_iso_datetime(event.get("publishedAt"))


def is_within_window(event: dict, days: int = PRUNE_DAYS) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    published_at = get_published_at(event)
    return True if published_at is None else published_at >= cutoff


def load_json_list_with_fallback(*paths: str) -> list[dict]:
    last_error = None
    for path in paths:
        if not path or not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                payload = json.load(f)
            return payload if isinstance(payload, list) else []
        except Exception as ex:
            last_error = ex
    if last_error:
        raise last_error
    return []


def resolve_existing_non_geotag_event(
    event: dict,
    copilot_geotags: dict[str, dict] | None = None,
) -> dict | None:
    sources = event.get("sources") or [{}]
    source_url = sources[0].get("url", event.get("id", ""))
    copilot_geo = get_copilot_geo(source_url, copilot_geotags)
    lat = parse_float(event.get("lat"))
    lng = parse_float(event.get("lng"))
    if lat is None or lng is None:
        if not copilot_geo:
            return None
        lat = copilot_geo["lat"]
        lng = copilot_geo["lng"]

    title = strip_html(event.get("title", ""))
    summary = strip_html(event.get("summary", ""))
    keyword_loc = extract_location(title, summary)
    promoted = dict(event)
    location_label = (
        (copilot_geo or {}).get("label")
        or promoted.get("locationName")
        or (keyword_loc["country"] if keyword_loc else "")
        or "Geotagged event"
    )
    promoted.update({
        "countryCode": ((copilot_geo or {}).get("countryCode") or promoted.get("countryCode") or (keyword_loc["code"] if keyword_loc else "")),
        "countryName": ((copilot_geo or {}).get("countryName") or promoted.get("countryName") or (keyword_loc["country"] if keyword_loc else location_label)),
        "regionName": ((copilot_geo or {}).get("regionName") or promoted.get("regionName") or (keyword_loc["country"] if keyword_loc else location_label)),
        "locationName": location_label,
        "lat": round(lat, 4),
        "lng": round(lng, 4),
        "geoPrecision": ((copilot_geo or {}).get("precision") or promoted.get("geoPrecision") or "point"),
        "geoSource": ((copilot_geo or {}).get("source") or promoted.get("geoSource") or "keyword"),
        "geotagStatus": "resolved",
    })
    return promoted


def extract_location(title: str, description: str) -> dict | None:
    """Scan title then description for known location keywords. Return first match."""
    text = f"{title} {strip_html(description)}"
    for keyword, loc in LOCATION_KEYWORDS:
        if keyword in text:
            return loc
    return None


def extract_category(title: str, default_cat: str) -> str:
    """Override feed's default category if title contains a stronger keyword."""
    title_lower = title.lower()
    for keyword, cat in CATEGORY_KEYWORDS:
        if keyword.lower() in title_lower:
            return cat
    return default_cat


def get_source_domain(url: str) -> str:
    try:
        host = url.split("//", 1)[1].split("/")[0].lstrip("www.")
        return host
    except Exception:
        return "unknown"


def is_thumbnail_allowed(domain: str) -> bool:
    return any(allowed in domain for allowed in THUMBNAIL_WHITELIST)


def normalize_thumbnail_url(url: str | None) -> str:
    if not url:
        return ""
    url = url.strip()
    if url.startswith("//"):
        return f"https:{url}"
    return url if url.startswith(("http://", "https://")) else ""


def parse_float(value) -> float | None:
    try:
        return float(value)
    except Exception:
        return None


def extract_explicit_geo(node: ET.Element) -> dict | None:
    point = (node.findtext(f"{{{GEORSS_NS}}}point") or "").strip()
    if point:
        parts = re.split(r"[\s,]+", point)
        if len(parts) >= 2:
            lat = parse_float(parts[0])
            lng = parse_float(parts[1])
            if lat is not None and lng is not None:
                return {"lat": round(lat, 4), "lng": round(lng, 4), "precision": "point", "source": "feed"}

    pos = (node.findtext(f".//{{{GML_NS}}}pos") or "").strip()
    if pos:
        parts = re.split(r"[\s,]+", pos)
        if len(parts) >= 2:
            lat = parse_float(parts[0])
            lng = parse_float(parts[1])
            if lat is not None and lng is not None:
                return {"lat": round(lat, 4), "lng": round(lng, 4), "precision": "point", "source": "feed"}

    lat = parse_float(node.findtext(f"{{{WGS84_NS}}}lat"))
    lng = parse_float(node.findtext(f"{{{WGS84_NS}}}long") or node.findtext(f"{{{WGS84_NS}}}lon"))
    if lat is not None and lng is not None:
        return {"lat": round(lat, 4), "lng": round(lng, 4), "precision": "point", "source": "feed"}

    return None


def extract_thumbnail_url(node: ET.Element) -> str:
    media_thumb = node.find(f"{{{MEDIA_NS}}}thumbnail")
    if media_thumb is not None:
        thumb_url = normalize_thumbnail_url(media_thumb.get("url"))
        if thumb_url:
            return thumb_url

    for media_content in node.findall(f"{{{MEDIA_NS}}}content"):
        media_url  = normalize_thumbnail_url(media_content.get("url"))
        media_type = (media_content.get("type") or "").lower()
        medium     = (media_content.get("medium") or "").lower()
        if media_url and (media_type.startswith("image/") or medium == "image"):
            return media_url

    enclosure = node.find("enclosure")
    if enclosure is not None:
        enc_url  = normalize_thumbnail_url(enclosure.get("url"))
        enc_type = (enclosure.get("type") or "").lower()
        if enc_url and enc_type.startswith("image/"):
            return enc_url

    for atom_link in node.findall(f"{{{ATOM_NS}}}link"):
        rel   = (atom_link.get("rel") or "").lower()
        href  = normalize_thumbnail_url(atom_link.get("href"))
        ltype = (atom_link.get("type") or "").lower()
        if href and rel == "enclosure" and ltype.startswith("image/"):
            return href

    return ""


def reputation(domain: str) -> float:
    for key, val in SOURCE_REPUTATION.items():
        if key in domain:
            return val
    return DEFAULT_REPUTATION


# ── RSS Fetching & Parsing ────────────────────────────────────────────────────

def fetch_rss(url: str) -> str:
    """Fetch raw XML from an RSS/Atom URL. Returns empty string on failure."""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "WorldNewsMapViewer/3.0 (news visualization; github.com)",
                "Accept": "application/rss+xml, application/atom+xml, text/xml, */*",
            }
        )
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:
            raw = resp.read()
            # Try UTF-8, fall back to latin-1
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError:
                return raw.decode("latin-1")
    except Exception as e:
        print(f"    [fetch error] {type(e).__name__}: {e}")
        return ""


def fetch_json(url: str):
    raw = fetch_rss(url)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"    [json parse error] {e}")
        return None


def parse_rss(xml_text: str) -> list[dict]:
    """Parse RSS 2.0, Atom, or RDF. Returns list of raw item dicts."""
    if not xml_text:
        return []
    try:
        # Strip any XML declaration encoding to avoid ElementTree complaints
        xml_text = re.sub(r"<\?xml[^>]+\?>", "", xml_text, count=1).strip()
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        print(f"    [parse error] {e}")
        return []

    items: list[dict] = []
    tag = root.tag.lower()

    # ── RSS 2.0 ──────────────────────────────────────────────────────────────
    if "rss" in tag or "rdf" in tag:
        for item in root.iter("item"):
            title = (item.findtext("title") or "").strip()
            link  = (item.findtext("link")  or "").strip()
            desc  = (item.findtext("description") or "").strip()
            pub   = (item.findtext("pubDate") or
                     item.findtext("{http://purl.org/dc/elements/1.1/}date") or "").strip()
            thumbnail = extract_thumbnail_url(item)
            if title and link:
                items.append({
                    "title": title,
                    "url": link,
                    "description": desc,
                    "pubDate": pub,
                    "thumbnailUrl": thumbnail,
                    "geo": extract_explicit_geo(item),
                })

    # ── Atom ─────────────────────────────────────────────────────────────────
    else:
        ns = ATOM_NS
        for entry in root.iter(f"{{{ns}}}entry"):
            t_el  = entry.find(f"{{{ns}}}title")
            l_el  = entry.find(f"{{{ns}}}link")
            s_el  = entry.find(f"{{{ns}}}summary")
            u_el  = entry.find(f"{{{ns}}}updated")
            title = t_el.text.strip() if t_el is not None and t_el.text else ""
            link  = l_el.get("href", "") if l_el is not None else ""
            desc  = s_el.text or "" if s_el is not None else ""
            pub   = u_el.text or "" if u_el is not None else ""
            thumbnail = extract_thumbnail_url(entry)
            if title and link:
                items.append({
                    "title": title,
                    "url": link,
                    "description": desc,
                    "pubDate": pub,
                    "thumbnailUrl": thumbnail,
                    "geo": extract_explicit_geo(entry),
                })

    return items


def usgs_geojson_to_items(payload: dict) -> list[dict]:
    items: list[dict] = []
    for feature in payload.get("features", []):
        props = feature.get("properties", {}) or {}
        geometry = feature.get("geometry", {}) or {}
        coords = geometry.get("coordinates") or []
        if geometry.get("type") != "Point" or len(coords) < 2:
            continue

        lon = parse_float(coords[0])
        lat = parse_float(coords[1])
        if lat is None or lon is None:
            continue

        place = (props.get("place") or "").strip()
        time_ms = props.get("time")
        published_at = ""
        if isinstance(time_ms, (int, float)):
            published_at = datetime.fromtimestamp(time_ms / 1000, tz=timezone.utc).isoformat()
        mag = props.get("mag")
        title = (props.get("title") or "").strip()
        if not title:
            if mag is not None and place:
                title = f"M{mag} earthquake - {place}"
            else:
                title = place or "Earthquake"

        items.append({
            "title": title,
            "url": props.get("url") or props.get("detail") or "",
            "description": place,
            "pubDate": published_at,
            "thumbnailUrl": "",
            "geo": {
                "lat": round(lat, 4),
                "lng": round(lon, 4),
                "precision": "point",
                "label": place or "Earthquake epicenter",
                "source": "feed",
            },
        })
    return items


def eonet_geojson_to_items(payload: dict) -> list[dict]:
    items: list[dict] = []
    for feature in payload.get("features", []):
        props = feature.get("properties", {}) or {}
        geometry = feature.get("geometry", {}) or {}
        coords = geometry.get("coordinates") or []
        if geometry.get("type") != "Point" or len(coords) < 2:
            continue

        lon = parse_float(coords[0])
        lat = parse_float(coords[1])
        if lat is None or lon is None:
            continue

        sources = props.get("sources") or []
        first_source = sources[0] if sources else {}
        source_url = first_source.get("url") or props.get("link") or ""
        title = (props.get("title") or "").strip() or "Natural event"
        description = (props.get("description") or "").strip()
        categories = props.get("categories") or []
        category_title = ""
        if categories and isinstance(categories[0], dict):
            category_title = (categories[0].get("title") or "").strip()

        published_at = ""
        date_value = props.get("date") or props.get("openDate")
        if isinstance(date_value, str):
            published_at = parse_pub_date(date_value)

        label = category_title or title
        items.append({
            "title": title,
            "url": source_url,
            "description": description,
            "pubDate": published_at,
            "thumbnailUrl": "",
            "geo": {
                "lat": round(lat, 4),
                "lng": round(lon, 4),
                "precision": "point",
                "label": label,
                "source": "feed",
            },
        })
    return items


def load_copilot_geotags() -> dict[str, dict]:
    if not os.path.exists(COPILOT_GEOTAGS_PATH):
        return {}
    try:
        with open(COPILOT_GEOTAGS_PATH, encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, dict):
            return payload
    except Exception as ex:
        print(f"  [warn] Could not load copilot geotags: {ex}")
    return {}


def get_copilot_geo(item_url: str, copilot_geotags: dict[str, dict] | None) -> dict | None:
    if not item_url or not copilot_geotags:
        return None
    entry = copilot_geotags.get(item_url)
    if not isinstance(entry, dict):
        return None
    lat = parse_float(entry.get("lat"))
    lng = parse_float(entry.get("lng"))
    if lat is None or lng is None:
        return None
    return {
        "lat": round(lat, 4),
        "lng": round(lng, 4),
        "precision": entry.get("precision", "point"),
        "label": (entry.get("locationName") or entry.get("label") or "").strip(),
        "countryCode": entry.get("countryCode") or "",
        "countryName": entry.get("countryName") or "",
        "regionName": entry.get("regionName") or "",
        "source": "copilot",
    }


def build_location_meta(
    item: dict,
    title: str,
    description: str,
    require_explicit_geo: bool,
    copilot_geotags: dict[str, dict] | None = None,
) -> dict | None:
    explicit_geo = item.get("geo") if isinstance(item.get("geo"), dict) else None
    copilot_geo = get_copilot_geo(item.get("url", ""), copilot_geotags)
    keyword_loc = extract_location(title, description)

    if copilot_geo:
        location_label = copilot_geo.get("label", "")
        return {
            "countryCode": copilot_geo.get("countryCode") or (keyword_loc["code"] if keyword_loc else ""),
            "countryName": copilot_geo.get("countryName") or (keyword_loc["country"] if keyword_loc else (location_label or "AI geotagged event")),
            "regionName": copilot_geo.get("regionName") or (keyword_loc["country"] if keyword_loc else (location_label or "AI geotagged event")),
            "locationName": location_label or (keyword_loc["country"] if keyword_loc else "AI geotagged event"),
            "lat": copilot_geo["lat"],
            "lng": copilot_geo["lng"],
            "geoPrecision": copilot_geo.get("precision", "point"),
            "explicit": True,
            "geoSource": "copilot",
            "geotagStatus": "resolved",
        }

    if explicit_geo:
        location_label = (explicit_geo.get("label") or "").strip()
        return {
            "countryCode": keyword_loc["code"] if keyword_loc else "",
            "countryName": keyword_loc["country"] if keyword_loc else (location_label or "Geotagged event"),
            "regionName": keyword_loc["country"] if keyword_loc else (location_label or "Geotagged event"),
            "locationName": location_label or (keyword_loc["country"] if keyword_loc else "Geotagged event"),
            "lat": explicit_geo["lat"],
            "lng": explicit_geo["lng"],
            "geoPrecision": explicit_geo.get("precision", "point"),
            "explicit": True,
            "geoSource": explicit_geo.get("source", "feed"),
            "geotagStatus": "resolved",
        }

    if require_explicit_geo:
        return None

    if keyword_loc is None:
        return None

    return {
        "countryCode": keyword_loc["code"],
        "countryName": keyword_loc["country"],
        "regionName": keyword_loc["country"],
        "locationName": keyword_loc["country"],
        "lat": keyword_loc["lat"],
        "lng": keyword_loc["lng"],
        "geoPrecision": "country",
        "explicit": False,
        "geoSource": "keyword",
        "geotagStatus": "resolved",
    }


def rss_item_to_event(
    item: dict,
    default_cat: str,
    feed_domain: str,
    require_explicit_geo: bool = False,
    copilot_geotags: dict[str, dict] | None = None,
) -> dict | None:
    """Convert a parsed item to our event schema. Returns None if location requirements are not met."""
    title = strip_html(item["title"])
    if not title or not item["url"]:
        return None

    summary_raw = strip_html(item.get("description", ""))
    loc = build_location_meta(item, title, summary_raw, require_explicit_geo, copilot_geotags)
    if loc is None:
        return None

    art_url      = item["url"]
    published_at = parse_pub_date(item.get("pubDate", ""))
    fetched_at   = datetime.now(timezone.utc).isoformat()
    freshness    = calc_freshness(published_at)
    if freshness == "archive":
        return None   # too old for this run

    cat    = extract_category(title, default_cat)
    cat_w  = CATEGORY_WEIGHTS.get(cat, 0.2)
    rep    = reputation(feed_domain)
    fresh_score = {"fresh": 1.0, "recent": 0.8, "ongoing": 0.5}.get(freshness, 0.3)

    attention = round(
        min(0.40 * cat_w + 0.35 * rep + 0.25 * fresh_score, 0.99),
        4
    )

    domain = get_source_domain(art_url)
    if loc["explicit"]:
        event_lat = loc["lat"]
        event_lng = loc["lng"]
    else:
        event_lat, event_lng = stable_jitter(art_url, loc["lat"], loc["lng"])

    summary = (summary_raw[:200] + "…") if len(summary_raw) > 200 else summary_raw
    if not summary:
        summary = f"Reported by {domain}."
    thumbnail_url = normalize_thumbnail_url(item.get("thumbnailUrl", ""))
    if thumbnail_url and not is_thumbnail_allowed(domain):
        thumbnail_url = ""

    return {
        "id":                f"rss_{url_hash(art_url)}",
        "title":             title,
        "summary":           summary,
        "category":          cat,
        "countryCode":       loc["countryCode"],
        "countryName":       loc["countryName"],
        "regionName":        loc["regionName"],
        "locationName":      loc["locationName"],
        "lat":               event_lat,
        "lng":               event_lng,
        "geoPrecision":      loc["geoPrecision"],
        "geoSource":         loc.get("geoSource", "keyword"),
        "geotagStatus":      loc.get("geotagStatus", "resolved"),
        "fetchedAt":         fetched_at,
        "publishedAt":       published_at,
        "firstSeenAt":       fetched_at,
        "lastUpdatedAt":     fetched_at,
        "freshness":         freshness,
        "articleCount":      1,
        "sourceCount":       1,
        "attentionScore":    attention,
        "velocityScore":     round(fresh_score, 4),
        "crossBorderFactor": round(rep, 4),
        "bubble":            False,
        "thumbnailUrl":      thumbnail_url,
        "tags":              [w for w in title.split() if len(w) > 4][:6],
        "sources": [{
            "name":        domain,
            "url":         art_url,
            "title":       title,
            "publishedAt": published_at,
            "thumbnailUrl": thumbnail_url,
        }],
    }


def build_non_geotag_record(item: dict, default_cat: str, feed_domain: str) -> dict | None:
    title = strip_html(item.get("title", ""))
    art_url = item.get("url", "")
    if not title or not art_url:
        return None

    published_at = parse_pub_date(item.get("pubDate", ""))
    freshness = calc_freshness(published_at)
    if freshness == "archive":
        return None

    fetched_at = datetime.now(timezone.utc).isoformat()
    summary_raw = strip_html(item.get("description", ""))
    summary = (summary_raw[:200] + "…") if len(summary_raw) > 200 else summary_raw
    if not summary:
        summary = f"Reported by {feed_domain}."

    cat = extract_category(title, default_cat)
    cat_w = CATEGORY_WEIGHTS.get(cat, 0.2)
    rep = reputation(feed_domain)
    fresh_score = {"fresh": 1.0, "recent": 0.8, "ongoing": 0.5}.get(freshness, 0.3)
    attention = round(
        min(0.40 * cat_w + 0.35 * rep + 0.25 * fresh_score, 0.99),
        4
    )

    thumbnail_url = normalize_thumbnail_url(item.get("thumbnailUrl", ""))
    if thumbnail_url and not is_thumbnail_allowed(feed_domain):
        thumbnail_url = ""

    return {
        "id":                f"nongeo_{url_hash(art_url)}",
        "title":             title,
        "summary":           summary,
        "category":          cat,
        "countryCode":       "",
        "countryName":       "",
        "regionName":        "",
        "locationName":      "Location unresolved",
        "lat":               None,
        "lng":               None,
        "geoPrecision":      "none",
        "geoSource":         "none",
        "geotagStatus":      "unresolved",
        "fetchedAt":         fetched_at,
        "publishedAt":       published_at,
        "firstSeenAt":       fetched_at,
        "lastUpdatedAt":     fetched_at,
        "freshness":         freshness,
        "articleCount":      1,
        "sourceCount":       1,
        "attentionScore":    attention,
        "velocityScore":     round(fresh_score, 4),
        "crossBorderFactor": round(rep, 4),
        "bubble":            False,
        "thumbnailUrl":      thumbnail_url,
        "tags":              [w for w in title.split() if len(w) > 4][:6],
        "sources": [{
            "name":        feed_domain,
            "url":         art_url,
            "title":       title,
            "publishedAt": published_at,
            "thumbnailUrl": thumbnail_url,
        }],
    }


# ── Output builders ───────────────────────────────────────────────────────────

def build_heatmap(events: list) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
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
        ],
    }


def build_trends(events: list) -> dict:
    from collections import defaultdict
    cat_counts: dict[str, int] = defaultdict(int)
    for e in events:
        cat_counts[e["category"]] += 1
    rising = sorted(events, key=lambda e: e.get("velocityScore", 0), reverse=True)[:8]
    return {
        "generatedAt":  datetime.now(timezone.utc).isoformat(),
        "timeRange":    "24h",
        "risingEvents": [
            {"id": e["id"], "title": e["title"],
             "velocityScore": e["velocityScore"], "category": e["category"],
             "countryName": e["countryName"]}
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
            "totalArticles": len(events),
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
    copilot_geotags = load_copilot_geotags()

    print(f"\n{'='*68}")
    print(f"  World News Map — RSS/Geo Fetcher v5")
    print(f"  {now_str}  |  {len(RSS_SOURCES) + len(EXPLICIT_GEO_SOURCES)} sources")
    print(f"{'='*68}\n")

    # ── Step 1: Load existing events (7-day accumulation base) ────────────────
    existing_path = os.path.join(OUTPUT_DIR, "world-latest.json")
    existing_fallback_path = os.path.join(OUTPUT_DIR, "world-latest.fixed.json")
    non_geotag_path = os.path.join(OUTPUT_DIR, "non-geotag.json")
    events_by_url: dict[str, dict] = {}
    non_geotag_by_url: dict[str, dict] = {}
    if os.path.exists(existing_path):
        try:
            existing = load_json_list_with_fallback(existing_path, existing_fallback_path)
            for e in (existing if isinstance(existing, list) else []):
                if is_within_window(e):
                    url = e.get("sources", [{}])[0].get("url", e.get("id", ""))
                    if url:
                        events_by_url[url] = e
            print(f"  Loaded {len(events_by_url)} existing events (<= {PRUNE_DAYS} days since publish)\n")
        except Exception as ex:
            print(f"  [warn] Could not load existing data: {ex}\n")

    if os.path.exists(non_geotag_path):
        try:
            existing_non_geo = load_json_list_with_fallback(non_geotag_path)
            promoted_non_geo_count = 0
            for e in (existing_non_geo if isinstance(existing_non_geo, list) else []):
                if not is_within_window(e):
                    continue
                url = e.get("sources", [{}])[0].get("url", e.get("id", ""))
                if not url or url in events_by_url:
                    continue
                promoted = resolve_existing_non_geotag_event(e, copilot_geotags)
                if promoted is not None:
                    events_by_url[url] = promoted
                    promoted_non_geo_count += 1
                    continue
                non_geotag_by_url[url] = e
            print(
                f"  Loaded {len(non_geotag_by_url)} existing non-geotag events"
                f"  ({promoted_non_geo_count} promoted to map output)\n"
            )
        except Exception as ex:
            print(f"  [warn] Could not load non-geotag data: {ex}\n")

    # ── Step 2: Fetch all RSS feeds ───────────────────────────────────────────
    new_count  = 0
    skip_count = 0
    fail_count = 0
    geo_new_count = 0
    non_geo_count = 0

    for src in RSS_SOURCES:
        feed_url    = src["url"]
        default_cat = src["cat"]
        feed_domain = get_source_domain(feed_url)
        print(f"  ↓  {feed_domain:<30} {feed_url[:55]}")

        xml_text = fetch_rss(feed_url)
        items    = parse_rss(xml_text)

        if not items:
            fail_count += 1
            continue

        added = 0
        for item in items:
            art_url = item.get("url", "")
            if art_url in events_by_url:
                existing = events_by_url[art_url]
                if not existing.get("thumbnailUrl"):
                    thumb_url = normalize_thumbnail_url(item.get("thumbnailUrl", ""))
                    if thumb_url and is_thumbnail_allowed(get_source_domain(art_url)):
                        existing["thumbnailUrl"] = thumb_url
                        for src in existing.get("sources", []):
                            if src.get("url") == art_url:
                                src["thumbnailUrl"] = thumb_url
                                break
                skip_count += 1
                continue  # duplicate — skip

            event = rss_item_to_event(item, default_cat, feed_domain, copilot_geotags=copilot_geotags)
            if event is None:
                unresolved = build_non_geotag_record(item, default_cat, feed_domain)
                if unresolved and art_url not in non_geotag_by_url:
                    non_geotag_by_url[art_url] = unresolved
                    non_geo_count += 1
                continue

            events_by_url[art_url] = event
            non_geotag_by_url.pop(art_url, None)
            new_count += 1
            added += 1

        print(f"     {len(items)} items  →  {added} new")

    for src in EXPLICIT_GEO_SOURCES:
        feed_url    = src["url"]
        default_cat = src["cat"]
        feed_domain = get_source_domain(feed_url)
        print(f"  ↓  {feed_domain:<30} {feed_url[:55]}")

        source_type = src.get("type", "rss")
        items = []
        if source_type == "rss":
            xml_text = fetch_rss(feed_url)
            items = parse_rss(xml_text)
        else:
            payload = fetch_json(feed_url)
            parser_name = src.get("parser")
            if payload and parser_name == "usgs":
                items = usgs_geojson_to_items(payload)
            elif payload and parser_name == "eonet":
                items = eonet_geojson_to_items(payload)

        if not items:
            fail_count += 1
            continue

        added = 0
        for item in items:
            art_url = item.get("url", "")
            if not art_url:
                art_url = f"{feed_url}#geo-{url_hash(json.dumps(item, sort_keys=True))}"
                item["url"] = art_url

            if art_url in events_by_url:
                skip_count += 1
                continue

            event = rss_item_to_event(
                item,
                default_cat,
                feed_domain,
                require_explicit_geo=True,
                copilot_geotags=copilot_geotags,
            )
            if event is None:
                unresolved = build_non_geotag_record(item, default_cat, feed_domain)
                if unresolved and art_url not in non_geotag_by_url:
                    non_geotag_by_url[art_url] = unresolved
                    non_geo_count += 1
                continue

            events_by_url[art_url] = event
            non_geotag_by_url.pop(art_url, None)
            new_count += 1
            geo_new_count += 1
            added += 1

        print(f"     {len(items)} items  →  {added} new (explicit geo only)")

    elapsed = round(time.time() - start_ts, 1)

    # ── Step 3: Sort and cap ──────────────────────────────────────────────────
    retained_events = sorted(
        events_by_url.values(),
        key=lambda e: get_published_at(e) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:MAX_EVENTS_OUTPUT]
    dropped_count = max(len(events_by_url) - len(retained_events), 0)

    all_events = sorted(
        retained_events,
        key=lambda e: (
            e.get("attentionScore", 0) *
            {"fresh": 1.0, "recent": 0.9, "ongoing": 0.7}.get(
                calc_freshness(e.get("publishedAt", "")), 0.5
            )
        ),
        reverse=True,
    )

    for e in all_events:
        e["bubble"]    = e.get("attentionScore", 0) >= BUBBLE_THRESHOLD
        e["freshness"] = calc_freshness(e.get("publishedAt", ""))

    non_geotag_events = sorted(
        non_geotag_by_url.values(),
        key=lambda e: get_published_at(e) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:MAX_EVENTS_OUTPUT]

    bubble_count = sum(1 for e in all_events if e["bubble"])

    print(f"\n{'─'*68}")
    print(f"  Pool after merge+prune : {len(events_by_url)}")
    print(f"  Dropped oldest first   : {dropped_count}")
    print(f"  New this run           : {new_count}")
    print(f"    Explicit geo added   : {geo_new_count}")
    print(f"    Non-geotag queued    : {len(non_geotag_events)}")
    print(f"  Skipped (duplicate)    : {skip_count}")
    print(f"  Failed feeds           : {fail_count}/{len(RSS_SOURCES) + len(EXPLICIT_GEO_SOURCES)}")
    print(f"  Output (top {MAX_EVENTS_OUTPUT})        : {len(all_events)}")
    print(f"  Bubble markers         : {bubble_count}")
    print(f"  Elapsed                : {elapsed}s")
    print(f"{'─'*68}\n")

    if not all_events:
        print("WARNING: No events — existing data preserved.")
        return 0

    # ── Step 4: Write files ───────────────────────────────────────────────────
    print("Writing output files:")
    write_json(os.path.join(OUTPUT_DIR, "world-latest.json"), all_events)
    write_json(os.path.join(OUTPUT_DIR, "top-headlines.json"), {
        "headlines":   all_events[:10],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    })
    write_json(os.path.join(OUTPUT_DIR, "trends.json"),       build_trends(all_events))
    write_json(os.path.join(OUTPUT_DIR, "heatmap-24h.json"),  build_heatmap(all_events))
    fresh_ev = [e for e in all_events if e.get("freshness") == "fresh"]
    write_json(os.path.join(OUTPUT_DIR, "heatmap-1h.json"),
               build_heatmap(fresh_ev or all_events[:20]))
    write_json(os.path.join(OUTPUT_DIR, "non-geotag.json"), non_geotag_events)
    write_json(os.path.join(OUTPUT_DIR, "meta.json"), {
        "generatedAt":    datetime.now(timezone.utc).isoformat(),
        "eventCount":     len(all_events),
        "nonGeotagCount": len(non_geotag_events),
        "newThisRun":     new_count,
        "failedFeeds":    fail_count,
        "elapsedSec":     elapsed,
        "source":         "rss+geo",
        "version":        5,
    })

    print(f"\n{'='*68}")
    print(f"  Done — {len(all_events)} events  ({bubble_count} bubbles)  in {elapsed}s")
    print(f"{'='*68}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
