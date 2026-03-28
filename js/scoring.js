/* ============================================================
   SCORING — World News Map Viewer
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.scoring = {
  CATEGORY_WEIGHTS: {
    conflict:   1.0,
    politics:   0.9,
    disaster:   0.9,
    economy:    0.8,
    health:     0.7,
    technology: 0.6,
    science:    0.5,
    sports:     0.4,
    culture:    0.3,
    other:      0.2
  },

  /**
   * Determine freshness label from publishedAt ISO string
   * @returns {'fresh'|'recent'|'ongoing'|'archive'}
   */
  getFreshness(publishedAt) {
    if (!publishedAt) return 'archive';
    const hoursAgo = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000;
    if (hoursAgo < 3)   return 'fresh';
    if (hoursAgo < 24)  return 'recent';
    if (hoursAgo < 168) return 'ongoing';
    return 'archive';
  },

  /**
   * Calculate attention score (0–1) for an event
   */
  calcAttentionScore(event) {
    const articleNorm  = Math.min((event.articleCount  || 0) / 200, 1);
    const sourceNorm   = Math.min((event.sourceCount   || 0) / 30,  1);
    const velocityNorm = Math.min((event.velocityScore || 0),       1);
    const catWeight    = this.CATEGORY_WEIGHTS[event.category] || 0.2;
    const crossBorder  = event.crossBorderFactor || 0;

    return (
      0.30 * articleNorm +
      0.25 * sourceNorm  +
      0.20 * velocityNorm +
      0.15 * catWeight   +
      0.10 * crossBorder
    );
  },

  /**
   * Determine whether an event should display a bubble marker
   */
  shouldBubble(event) {
    const freshness = this.getFreshness(event.publishedAt);
    return (event.attentionScore || 0) >= 0.78 &&
           ['fresh', 'recent'].includes(freshness);
  },

  /**
   * Return events sorted by attentionScore descending
   */
  rankEvents(events) {
    return [...events].sort((a, b) => (b.attentionScore || 0) - (a.attentionScore || 0));
  },

  /**
   * Get top trending events by velocityScore
   */
  getTrending(events, limit = 10) {
    return [...events]
      .filter(e => (e.velocityScore || 0) > 0.3)
      .sort((a, b) => (b.velocityScore || 0) - (a.velocityScore || 0))
      .slice(0, limit);
  },

  /**
   * Count events per category
   * @returns {{ [category: string]: number }}
   */
  countByCategory(events) {
    const counts = {};
    events.forEach(e => {
      counts[e.category] = (counts[e.category] || 0) + 1;
    });
    return counts;
  },

  /**
   * Count events per country
   * @returns {{ [countryCode: string]: { count: number, name: string } }}
   */
  countByCountry(events) {
    const counts = {};
    events.forEach(e => {
      if (!counts[e.countryCode]) {
        counts[e.countryCode] = { count: 0, name: e.countryName || e.countryCode };
      }
      counts[e.countryCode].count += 1;
    });
    return counts;
  }
};
