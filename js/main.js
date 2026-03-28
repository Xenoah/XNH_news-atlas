/* ============================================================
   MAIN — World News Map Viewer
   Entry point: called after all scripts load via DOMContentLoaded.
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Initialize UI bindings (caches DOM refs, wires events)
    NewsAtlas.ui.init();

    // 2. Initialize the map (async tile loading starts here)
    const mapInstance = NewsAtlas.map.init('map');

    // 3. Initialize the app — loads data, populates panels
    await NewsAtlas.app.init();

  } catch (err) {
    console.error('[NewsAtlas] Initialization error:', err);

    // Show error message in the map container if something goes wrong
    const mapEl = document.getElementById('map');
    if (mapEl) {
      mapEl.innerHTML = `
        <div style="
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          height:100%;
          color:#f85149;
          padding:24px;
          text-align:center;
          font-family:system-ui,sans-serif;
        ">
          <div style="font-size:32px;margin-bottom:12px">⚠</div>
          <div style="font-size:16px;font-weight:700;margin-bottom:8px">Failed to initialize</div>
          <div style="font-size:13px;color:#8b949e;max-width:400px">${err.message || 'Unknown error'}</div>
          <div style="margin-top:16px;font-size:12px;color:#6e7681">
            Check the browser console for details.
          </div>
        </div>`;
    }

    // Also show error in left panel
    const leftContent = document.getElementById('left-content');
    if (leftContent) {
      leftContent.innerHTML = `
        <div style="padding:16px;color:#f85149;font-size:13px">
          Error loading data: ${err.message || 'Unknown error'}
        </div>`;
    }
  }
});
