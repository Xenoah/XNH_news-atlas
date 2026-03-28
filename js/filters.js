/* ============================================================
   FILTERS — World News Map Viewer
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.filters = {
  /**
   * Filter events by time range label
   * @param {object[]} events
   * @param {'1h'|'6h'|'24h'|'7d'} timeFilter
   */
  byTime(events, timeFilter) {
    const now = Date.now();
    const ranges = {
      '1h':  3_600_000,
      '6h':  21_600_000,
      '24h': 86_400_000,
      '7d':  604_800_000
    };
    const ms = ranges[timeFilter] || ranges['24h'];
    return events.filter(e => {
      const published = new Date(e.publishedAt).getTime();
      return !isNaN(published) && (now - published) <= ms;
    });
  },

  /**
   * Filter events by category Set (or 'all' sentinel)
   * @param {object[]} events
   * @param {Set<string>|null} categories
   */
  byCategory(events, categories) {
    if (!categories || categories.has('all') || categories.size === 0) {
      return events;
    }
    return events.filter(e => categories.has(e.category));
  },

  /**
   * Filter events by free-text search query across multiple fields
   * @param {object[]} events
   * @param {string} query
   */
  bySearch(events, query) {
    if (!query || query.trim() === '') return events;
    const q = query.toLowerCase().trim();
    return events.filter(e => {
      const inTitle    = (e.title        || '').toLowerCase().includes(q);
      const inSummary  = (e.summary      || '').toLowerCase().includes(q);
      const inCountry  = (e.countryName  || '').toLowerCase().includes(q);
      const inLocation = (e.locationName || '').toLowerCase().includes(q);
      const inTags     = (e.tags || []).some(t => t.toLowerCase().includes(q));
      const inCategory = (e.category     || '').toLowerCase().includes(q);
      return inTitle || inSummary || inCountry || inLocation || inTags || inCategory;
    });
  },

  /**
   * Apply all filters at once using state object
   * @param {object[]} events
   * @param {{ timeFilter: string, categoryFilters: Set, searchQuery: string }} state
   */
  apply(events, state) {
    let result = events;
    result = this.byTime(result, state.timeFilter);
    result = this.byCategory(result, state.categoryFilters);
    result = this.bySearch(result, state.searchQuery);
    return result;
  }
};
