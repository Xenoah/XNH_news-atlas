/* ============================================================
   RENDERERS — World News Map Viewer
   All functions return HTML strings. Use NewsAtlas.utils helpers.
   ============================================================ */

window.NewsAtlas = window.NewsAtlas || {};

NewsAtlas.renderers = {

  /* ── Category Badge ──────────────────────────────────────── */

  categoryBadge(category) {
    const u = NewsAtlas.utils;
    const label = u.escapeHtml((category || 'other').charAt(0).toUpperCase() + (category || 'other').slice(1));
    return `<span class="category-badge ${u.escapeHtml(category || 'other')}">${label}</span>`;
  },

  /* ── Freshness Badge ─────────────────────────────────────── */

  freshnessBadge(freshness) {
    const labels = { fresh: 'LIVE', recent: 'Recent', ongoing: 'Ongoing', archive: 'Archive' };
    const label = labels[freshness] || freshness || 'Unknown';
    return `<span class="freshness-badge ${NewsAtlas.utils.escapeHtml(freshness || 'archive')}">${NewsAtlas.utils.escapeHtml(label)}</span>`;
  },

  /* ── Score Bar ───────────────────────────────────────────── */

  scoreBar(score) {
    const pct = Math.round((score || 0) * 100);
    const color = score >= 0.8 ? '#f87171' : score >= 0.6 ? '#fb923c' : score >= 0.4 ? '#58a6ff' : '#8b949e';
    return `
      <div class="score-bar-container">
        <div class="score-bar">
          <div class="score-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="score-value">${pct}%</span>
      </div>`;
  },

  /* ── Event Card (left panel list) ───────────────────────── */

  eventCard(event, rank) {
    const u = NewsAtlas.utils;
    const freshness = event.freshness || NewsAtlas.scoring.getFreshness(event.publishedAt);
    return `
      <div class="event-card" data-event-id="${u.escapeHtml(event.id)}" onclick="NewsAtlas.app.onEventSelect(NewsAtlas.app.getEventById('${u.escapeHtml(event.id)}'))">
        <div class="event-card-header">
          <span class="event-card-title">${u.escapeHtml(event.title)}</span>
          ${this.categoryBadge(event.category)}
        </div>
        <div class="event-card-meta">
          <span class="event-card-location">📍 ${u.escapeHtml(event.locationName || event.countryName)}</span>
          <span class="event-card-time">${u.timeAgo(event.publishedAt)}</span>
          ${this.freshnessBadge(freshness)}
        </div>
        ${this.scoreBar(event.attentionScore)}
      </div>`;
  },

  /* ── Rank Item (compact 2-line, hover expands) ───────────── */

  rankItem(event, rank) {
    const u = NewsAtlas.utils;
    const isTop = rank <= 3;
    const score = event.attentionScore || 0;
    const pct   = Math.round(score * 100);
    const scoreClass = score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low';
    const scoreColor = score >= 0.8 ? '#f87171' : score >= 0.5 ? '#fb923c' : '#8b949e';
    return `
      <div class="rank-item" data-event-id="${u.escapeHtml(event.id)}"
           onclick="NewsAtlas.app.onEventSelect(NewsAtlas.app.getEventById('${u.escapeHtml(event.id)}'))">
        <div class="rank-number${isTop ? ' top-3' : ''}">${rank}</div>
        <div class="rank-body">
          <div class="rank-title">${u.escapeHtml(event.title)}</div>
          <div class="rank-meta">
            ${this.categoryBadge(event.category)}
            <span class="rank-country">${u.escapeHtml(event.countryName)}</span>
            <span class="rank-score ${scoreClass}">${pct}%</span>
          </div>
          <div class="rank-expand">
            <div class="score-bar-container" style="margin-top:4px">
              <div class="score-bar">
                <div class="score-bar-fill" style="width:${pct}%;background:${scoreColor}"></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  },

  /* ── Left Panel Rankings ─────────────────────────────────── */

  leftPanelRankings(events) {
    if (!events || events.length === 0) {
      return this.emptyState('No events match your filters');
    }
    const items = events.map((e, i) => this.rankItem(e, i + 1)).join('');
    return `
      <div class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-title">Top Stories</span>
          <span class="panel-section-count">${events.length}</span>
        </div>
        <div class="panel-section-body">
          ${items}
        </div>
      </div>`;
  },

  /* ── Left Panel Stats ────────────────────────────────────── */

  leftPanelStats(events, categoryCounts, countryCounts) {
    const total = events.length;
    const totalArticles = events.reduce((s, e) => s + (e.articleCount || 0), 0);
    const totalSources  = events.reduce((s, e) => s + (e.sourceCount  || 0), 0);
    const bubbleCount   = events.filter(e => NewsAtlas.scoring.shouldBubble(e)).length;

    const statGrid = `
      <div class="stat-grid" style="padding:12px">
        <div class="stat-card">
          <div class="stat-card-label">Events</div>
          <div class="stat-card-value">${total}</div>
          <div class="stat-card-sub">in view</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Articles</div>
          <div class="stat-card-value">${NewsAtlas.utils.formatCount(totalArticles)}</div>
          <div class="stat-card-sub">total</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Sources</div>
          <div class="stat-card-value">${NewsAtlas.utils.formatCount(totalSources)}</div>
          <div class="stat-card-sub">unique</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Breaking</div>
          <div class="stat-card-value" style="color:var(--accent-red)">${bubbleCount}</div>
          <div class="stat-card-sub">live events</div>
        </div>
      </div>`;

    const catBreakdown = this.categoryBreakdown(categoryCounts, total);

    const sortedCountries = Object.entries(countryCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);
    const countryItems = sortedCountries.map(([code, info], i) => `
      <div class="country-rank-item">
        <span class="country-rank-pos">${i + 1}</span>
        <span class="country-rank-name">${NewsAtlas.utils.escapeHtml(info.name)}</span>
        <span class="country-rank-count">${info.count}</span>
      </div>`).join('');

    return `
      <div class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-title">Overview</span>
        </div>
        ${statGrid}
      </div>
      <div class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-title">By Category</span>
        </div>
        <div class="panel-section-body">
          ${catBreakdown}
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-title">Top Countries</span>
        </div>
        <div class="panel-section-body">
          ${countryItems || '<div style="padding:12px;font-size:12px;color:var(--text-muted)">No data</div>'}
        </div>
      </div>`;
  },

  /* ── Category Breakdown ──────────────────────────────────── */

  categoryBreakdown(counts, total) {
    if (!counts || total === 0) return '<div style="padding:12px;font-size:12px;color:var(--text-muted)">No data</div>';
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const maxCount = sorted[0]?.[1] || 1;
    const rows = sorted.map(([cat, count]) => {
      const hex = NewsAtlas.utils.categoryHex(cat);
      const barWidth = Math.round((count / maxCount) * 100);
      return `
        <div class="cat-breakdown-item">
          <div class="cat-dot" style="background:${hex}"></div>
          <span class="cat-breakdown-name">${NewsAtlas.utils.escapeHtml(cat)}</span>
          <div class="cat-breakdown-bar-wrap">
            <div class="cat-breakdown-bar" style="width:${barWidth}%;background:${hex}"></div>
          </div>
          <span class="cat-breakdown-count">${count}</span>
        </div>`;
    }).join('');
    return rows;
  },

  /* ── Source Item ─────────────────────────────────────────── */

  sourceItem(source) {
    const u = NewsAtlas.utils;
    const name  = u.escapeHtml(source.name  || (typeof source === 'string' ? source : 'Unknown'));
    const url   = source.url || null;
    const title = source.title ? u.escapeHtml(source.title.substring(0, 90)) : '';
    const time  = source.publishedAt ? u.timeAgo(source.publishedAt) : '';

    if (url) {
      return `
        <div class="source-item">
          <a href="${u.escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="source-link">
            <span class="source-domain">${name}</span>
            ${title && title !== name ? `<span class="source-title-text">${title}</span>` : ''}
            ${time ? `<span class="source-time">${u.escapeHtml(time)}</span>` : ''}
            <span class="source-external">↗</span>
          </a>
        </div>`;
    }
    return `
      <div class="source-item">
        <span class="source-name">${name}</span>
        ${time ? `<span style="font-size:10px;color:var(--text-muted);padding-right:12px">${u.escapeHtml(time)}</span>` : ''}
      </div>`;
  },

  /* ── Popup Content (map marker popup) ────────────────────── */

  popupContent(event) {
    const u = NewsAtlas.utils;
    const freshness = event.freshness || NewsAtlas.scoring.getFreshness(event.publishedAt);
    return `
      <div class="popup-content">
        <div class="popup-badges">
          ${this.categoryBadge(event.category)}
          ${this.freshnessBadge(freshness)}
        </div>
        <div class="popup-title">${u.escapeHtml(event.title)}</div>
        <div class="popup-location">📍 ${u.escapeHtml(event.locationName || event.countryName)}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="popup-stat-label">Articles</span>
            <span class="popup-stat-value">${u.formatCount(event.articleCount)}</span>
          </div>
          <div class="popup-stat">
            <span class="popup-stat-label">Sources</span>
            <span class="popup-stat-value">${u.formatCount(event.sourceCount)}</span>
          </div>
          <div class="popup-stat">
            <span class="popup-stat-label">Score</span>
            <span class="popup-stat-value">${Math.round((event.attentionScore || 0) * 100)}%</span>
          </div>
        </div>
      </div>`;
  },

  /* ── Cluster Popup ───────────────────────────────────────── */

  clusterPopup(count, topEvent) {
    const u = NewsAtlas.utils;
    return `
      <div class="popup-content">
        <div class="popup-title" style="font-size:14px">${count} events in this area</div>
        ${topEvent ? `
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-muted)">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">TOP EVENT</div>
            <div class="popup-title">${u.escapeHtml(topEvent.title)}</div>
          </div>` : ''}
        <div style="margin-top:8px;font-size:11px;color:var(--accent-blue)">Click to zoom in</div>
      </div>`;
  },

  /* ── Full Event Detail (right panel) ─────────────────────── */

  eventDetail(event) {
    const u = NewsAtlas.utils;
    if (!event) return this.emptyState('Select an event to view details');

    const freshness  = event.freshness || NewsAtlas.scoring.getFreshness(event.publishedAt);
    const score      = event.attentionScore || 0;
    const scoreColor = score >= 0.8 ? 'var(--accent-red)'
      : score >= 0.6 ? 'var(--accent-orange)'
      : score >= 0.4 ? 'var(--accent-blue)'
      : 'var(--text-muted)';
    const tags    = (event.tags || []).map(t => `<span class="tag">${u.escapeHtml(t)}</span>`).join('');
    const allSrcs = event.sources || [];
    const thumbSource = allSrcs.find(s => s.thumbnailUrl) || null;
    const thumbnailUrl = u.escapeHtml(event.thumbnailUrl || (thumbSource && thumbSource.thumbnailUrl) || '');
    const sunlight = u.getSunlightState(event.lat, event.lng);
    const displaySettings = NewsAtlas.ui && NewsAtlas.ui.getDisplaySettings
      ? NewsAtlas.ui.getDisplaySettings()
      : { showSunlight: true };
    const sources = allSrcs.slice(0, 8).map(s => this.sourceItem(s)).join('');

    return `
      <div class="detail-card">

        <!-- Title block: badges → title → location/time in one clean block -->
        <div class="detail-header">
          <div class="detail-badges">
            ${this.categoryBadge(event.category)}
            ${this.freshnessBadge(freshness)}
            ${(event.crossBorderFactor || 0) > 0.5 ? '<span class="freshness-badge ongoing">🌐 Cross-border</span>' : ''}
          </div>
          <div class="detail-title">${u.escapeHtml(event.title)}</div>
          <div class="detail-meta-row">
            <span>📍 ${u.escapeHtml(event.locationName || event.countryName || '')}</span>
            <span class="detail-meta-sep">·</span>
            <span>${u.timeAgo(event.publishedAt)}</span>
            ${event.geoPrecision ? `<span class="detail-meta-sep">·</span><span>${u.escapeHtml(event.geoPrecision)}</span>` : ''}
          </div>
        </div>

        ${thumbnailUrl ? `
          <div class="detail-thumbnail-card">
            <img
              class="detail-thumbnail"
              src="${thumbnailUrl}"
              alt="${u.escapeHtml(event.title)}"
              loading="lazy"
              referrerpolicy="no-referrer"
            >
            <div class="detail-thumbnail-meta">
              <span class="detail-thumbnail-label">Licensed Feed Image</span>
              <span class="detail-thumbnail-source">${u.escapeHtml((thumbSource && thumbSource.name) || 'Whitelisted source')}</span>
            </div>
          </div>` : ''}

        <!-- Summary: prominent, readable -->
        <div class="detail-summary">${u.escapeHtml(event.summary)}</div>

        ${displaySettings.showSunlight && sunlight ? `
          <div class="detail-conditions">
            <div class="detail-condition-card ${u.escapeHtml(sunlight.accent)}">
              <div class="detail-condition-kicker">Current Light</div>
              <div class="detail-condition-value">${u.escapeHtml(sunlight.label)}</div>
              <div class="detail-condition-sub">Altitude ${u.escapeHtml(String(sunlight.altitude))}deg</div>
            </div>
            <div class="detail-condition-card neutral">
              <div class="detail-condition-kicker">Solar Time</div>
              <div class="detail-condition-value">${u.escapeHtml(sunlight.localSolarTime)}</div>
              <div class="detail-condition-sub">Approximate at this location</div>
            </div>
          </div>` : ''}

        <!-- Core metrics: 2×2 grid, values first -->
        <div class="detail-stats">
          <div class="detail-stat">
            <div class="detail-stat-value">${u.formatCount(event.articleCount)}</div>
            <div class="detail-stat-label">Articles</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-value">${u.formatCount(event.sourceCount)}</div>
            <div class="detail-stat-label">Sources</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-value" style="color:${scoreColor}">${Math.round(score * 100)}%</div>
            <div class="detail-stat-label">Attention</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-value" style="color:var(--accent-blue)">${Math.round((event.velocityScore || 0) * 100)}%</div>
            <div class="detail-stat-label">Velocity</div>
          </div>
        </div>

        <!-- Sources: most actionable, shown prominently -->
        ${sources ? `
          <div class="panel-section">
            <div class="panel-section-header">
              <span class="panel-section-title">Sources</span>
              <span class="panel-section-count">${allSrcs.length}</span>
            </div>
            <div class="source-list">${sources}</div>
            ${allSrcs.length > 8 ? `<div style="padding:8px 12px;font-size:11px;color:var(--text-muted)">+${allSrcs.length - 8} more</div>` : ''}
          </div>` : ''}

        <!-- Score bar: secondary emphasis -->
        <div class="panel-section">
          <div class="panel-section-header">
            <span class="panel-section-title">Attention Score</span>
          </div>
          <div style="padding:10px 12px">
            ${this.scoreBar(score)}
          </div>
        </div>

        <!-- Tags: low priority -->
        ${tags ? `
          <div class="panel-section">
            <div class="panel-section-header">
              <span class="panel-section-title">Tags</span>
            </div>
            <div style="padding:8px 12px">
              <div class="tag-list">${tags}</div>
            </div>
          </div>` : ''}

        <!-- Metadata: lowest priority -->
        <div style="font-size:10px;color:var(--text-muted);padding:8px 0 4px;display:flex;flex-direction:column;gap:2px">
          <span>First seen: ${u.formatDate(event.firstSeenAt)}</span>
          <span>Updated: ${u.formatDate(event.lastUpdatedAt)}</span>
          ${event.regionName ? `<span>Region: ${u.escapeHtml(event.regionName)}</span>` : ''}
        </div>
      </div>`;
  },

  /* ── Region Detail ───────────────────────────────────────── */

  regionDetail(regionName, events) {
    const u = NewsAtlas.utils;
    const sorted = NewsAtlas.scoring.rankEvents(events || []);
    const catCounts = NewsAtlas.scoring.countByCategory(events || []);

    const eventItems = sorted.slice(0, 8).map((e, i) => this.rankItem(e, i + 1)).join('');

    return `
      <div class="region-detail">
        <div class="detail-header">
          <div class="detail-badges">
            <span class="freshness-badge recent">Region</span>
          </div>
          <div class="detail-title">${u.escapeHtml(regionName)}</div>
          <div class="region-sub">${sorted.length} events tracked</div>
        </div>

        <div class="panel-section">
          <div class="panel-section-header">
            <span class="panel-section-title">Category Mix</span>
          </div>
          <div class="panel-section-body">
            ${this.categoryBreakdown(catCounts, sorted.length)}
          </div>
        </div>

        <div class="panel-section">
          <div class="panel-section-header">
            <span class="panel-section-title">Events</span>
            <span class="panel-section-count">${sorted.length}</span>
          </div>
          <div class="panel-section-body">
            ${eventItems || this.emptyState('No events')}
          </div>
        </div>
      </div>`;
  },

  /* ── Trending Section ────────────────────────────────────── */

  trendingSection(trendingEvents) {
    if (!trendingEvents || trendingEvents.length === 0) {
      return this.emptyState('No trending events right now');
    }
    const items = trendingEvents.map((e, i) => {
      const icons = ['🔥', '🔥', '⚡', '📈', '📈', '📰', '📰', '📰', '📰', '📰'];
      const icon = icons[i] || '📰';
      const velPct = Math.round((e.velocityScore || 0) * 100);
      return `
        <div class="trending-item" onclick="NewsAtlas.app.onEventSelect(NewsAtlas.app.getEventById('${NewsAtlas.utils.escapeHtml(e.id)}'))">
          <span class="trending-rank-icon">${icon}</span>
          <div class="trending-body">
            <div class="trending-title">${NewsAtlas.utils.escapeHtml(e.title)}</div>
            <div class="trending-velocity">
              ${this.categoryBadge(e.category)}
              <div class="velocity-bar">
                <div class="velocity-fill" style="width:${velPct}%"></div>
              </div>
              <span style="font-size:10px;color:var(--accent-blue)">${velPct}% velocity</span>
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-title">🔥 Trending Now</span>
          <span class="panel-section-count">${trendingEvents.length}</span>
        </div>
        <div class="panel-section-body">${items}</div>
      </div>`;
  },

  /* ── Trends Panel (left panel for trends mode) ───────────── */

  trendsPanel(trendingEvents, trendData) {
    const u = NewsAtlas.utils;
    const categoryTrends = (trendData && trendData.categoryTrends) ? trendData.categoryTrends : {};

    const catRows = Object.entries(categoryTrends)
      .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
      .map(([cat, data]) => {
        const change = data.change || '0';
        const isPos = String(change).startsWith('+');
        const isNeg = String(change).startsWith('-');
        const cls = isPos ? 'positive' : isNeg ? 'negative' : 'neutral';
        const hex = u.categoryHex(cat);
        return `
          <div class="trend-cat-row">
            <div class="cat-dot" style="background:${hex}"></div>
            <span class="trend-cat-name">${u.escapeHtml(cat)}</span>
            <span class="trend-cat-count">${data.count || 0}</span>
            <span class="trend-cat-change ${cls}">${u.escapeHtml(String(change))}</span>
          </div>`;
      }).join('');

    return `
      ${this.trendingSection(trendingEvents)}
      ${catRows ? `
        <div class="panel-section">
          <div class="panel-section-header">
            <span class="panel-section-title">Category Trends</span>
          </div>
          <div class="panel-section-body">${catRows}</div>
        </div>` : ''}
      ${trendData ? `
        <div style="padding:8px 0;font-size:10px;color:var(--text-muted);text-align:center">
          Based on ${u.formatCount(trendData.totalEvents || 0)} events · ${u.formatCount(trendData.totalSources || 0)} sources
        </div>` : ''}`;
  },

  /* ── Analysis Panel (left panel for analysis mode) ──────── */

  analysisPanel(events) {
    const catCounts     = NewsAtlas.scoring.countByCategory(events);
    const countryCounts = NewsAtlas.scoring.countByCountry(events);
    const total         = events.length;
    const bubbles       = events.filter(e => NewsAtlas.scoring.shouldBubble(e)).length;
    const avgScore      = total > 0
      ? (events.reduce((s, e) => s + (e.attentionScore || 0), 0) / total).toFixed(2)
      : 0;
    const crossBorder   = events.filter(e => (e.crossBorderFactor || 0) > 0.5).length;

    return `
      <div class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-title">Analysis Overview</span>
        </div>
        <div class="stat-grid" style="padding:12px">
          <div class="stat-card">
            <div class="stat-card-label">Total Events</div>
            <div class="stat-card-value">${total}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">Avg Score</div>
            <div class="stat-card-value">${Math.round(avgScore * 100)}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">Breaking</div>
            <div class="stat-card-value" style="color:var(--accent-red)">${bubbles}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">Cross-Border</div>
            <div class="stat-card-value" style="color:var(--accent-blue)">${crossBorder}</div>
          </div>
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-title">Category Distribution</span>
        </div>
        <div class="panel-section-body">
          ${this.categoryBreakdown(catCounts, total)}
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-section-header">
          <span class="panel-section-title">Top Countries</span>
        </div>
        <div class="panel-section-body">
          ${Object.entries(countryCounts)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 7)
            .map(([code, info], i) => `
              <div class="country-rank-item">
                <span class="country-rank-pos">${i + 1}</span>
                <span class="country-rank-name">${NewsAtlas.utils.escapeHtml(info.name)}</span>
                <span class="country-rank-count">${info.count}</span>
              </div>`).join('')}
        </div>
      </div>`;
  },

  /* ── Analysis Right Panel ────────────────────────────────── */

  analysisRightPanel(events) {
    const u = NewsAtlas.utils;
    const total      = events.length;
    const ranked     = NewsAtlas.scoring.rankEvents(events);
    const trending   = NewsAtlas.scoring.getTrending(events, 5);
    const catCounts  = NewsAtlas.scoring.countByCategory(events);
    const totalArt   = events.reduce((s, e) => s + (e.articleCount || 0), 0);
    const totalSrc   = events.reduce((s, e) => s + (e.sourceCount  || 0), 0);

    const topEvents = ranked.slice(0, 5).map((e, i) => `
      <div class="rank-item" onclick="NewsAtlas.app.onEventSelect(NewsAtlas.app.getEventById('${u.escapeHtml(e.id)}'))">
        <div class="rank-number${i < 3 ? ' top-3' : ''}">${i + 1}</div>
        <div class="rank-body">
          <div class="rank-title">${u.escapeHtml(e.title)}</div>
          <div class="rank-meta">
            ${this.categoryBadge(e.category)}
            <span style="font-size:11px;color:var(--text-muted)">${u.escapeHtml(e.countryName)}</span>
          </div>
        </div>
      </div>`).join('');

    const trendRows = trending.map(e => `
      <div class="trending-item" onclick="NewsAtlas.app.onEventSelect(NewsAtlas.app.getEventById('${u.escapeHtml(e.id)}'))">
        <span class="trending-rank-icon">📈</span>
        <div class="trending-body">
          <div class="trending-title">${u.escapeHtml(e.title)}</div>
          <div style="font-size:11px;color:var(--accent-blue)">${Math.round((e.velocityScore || 0) * 100)}% velocity</div>
        </div>
      </div>`).join('');

    // Dominant category
    const domCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];

    return `
      <div class="detail-card">
        <div class="detail-header">
          <div class="detail-badges">
            <span class="freshness-badge recent">Analysis</span>
          </div>
          <div class="detail-title">Global Event Analysis</div>
          <div class="detail-location">Showing ${total} filtered events</div>
        </div>

        <div class="detail-stats">
          <div class="detail-stat">
            <div class="detail-stat-label">Events</div>
            <div class="detail-stat-value">${total}</div>
            <div class="detail-stat-sub">tracked</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-label">Articles</div>
            <div class="detail-stat-value">${u.formatCount(totalArt)}</div>
            <div class="detail-stat-sub">total</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-label">Sources</div>
            <div class="detail-stat-value">${u.formatCount(totalSrc)}</div>
            <div class="detail-stat-sub">outlets</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-label">Dominant</div>
            <div class="detail-stat-value" style="font-size:13px;color:${domCat ? u.categoryHex(domCat[0]) : 'var(--text-muted)'}">${domCat ? domCat[0] : 'N/A'}</div>
            <div class="detail-stat-sub">category</div>
          </div>
        </div>

        <div class="panel-section">
          <div class="panel-section-header">
            <span class="panel-section-title">Highest Attention</span>
          </div>
          <div class="panel-section-body">
            ${topEvents || this.emptyState('No events')}
          </div>
        </div>

        ${trendRows ? `
          <div class="panel-section">
            <div class="panel-section-header">
              <span class="panel-section-title">Fastest Rising</span>
            </div>
            <div class="panel-section-body">${trendRows}</div>
          </div>` : ''}
      </div>`;
  },

  /* ── Map Legend Category HTML ────────────────────────────── */

  legendCatsHTML() {
    const cats = ['conflict','politics','economy','disaster','health','technology','science','sports','culture','other'];
    return cats.map(cat => `
      <div class="legend-cat-row">
        <div class="legend-cat-dot" style="background:${NewsAtlas.utils.categoryHex(cat)}"></div>
        <span class="legend-cat-name">${cat}</span>
      </div>`).join('');
  },

  /* ── Empty State ─────────────────────────────────────────── */

  emptyState(message) {
    return `
      <div class="empty-state">
        <div class="empty-icon">◎</div>
        <div class="empty-text">${NewsAtlas.utils.escapeHtml(message || 'No data available')}</div>
      </div>`;
  },

  /* ── Loading State ───────────────────────────────────────── */

  loadingState() {
    return `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading events…</div>
      </div>`;
  }
};
