/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 03/06 | FIL-ID: UI/pages/packages-block/03-store.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Fail-closed storage för Blockbank + Trainings (read/write enligt policy)
Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys
- XSS-safe rendering (render görs i 05-render.js)
- BLOCKS_KEY: AO-0XX_BLOCKS_V1 (read/write)
- TRAININGS_KEY: AO-057_TRAININGS_V1 (read-only)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.store) return; // idempotent

  const core = NS.core;

  // ---------- KEYS (LÅSTA) ----------
  const BLOCKS_KEY = "AO-0XX_BLOCKS_V1";
  const TRAININGS_KEY = "AO-057_TRAININGS_V1";

  // ---------- JSON helpers (fail-closed) ----------
  function loadJsonSafe(key) {
    try {
      const s = localStorage.getItem(key);
      if (!s) return { ok: true, missing: true, data: null };
      const data = JSON.parse(s);
      return { ok: true, missing: false, data: data };
    } catch (_) {
      return { ok: false, missing: false, data: null };
    }
  }

  function saveJsonSafe(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || "Kunde inte spara.") };
    }
  }

  // ---------- Blocks (AO-0XX_BLOCKS_V1) ----------
  function extractBlocks(data) {
    // Tillåter:
    // 1) [ ... ] (array)
    // 2) { blocks: [ ... ] }
    // Allt annat -> tomt, men INTE corrupt om det är tydligt tomt.
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray(data.blocks)) return data.blocks;
    return null;
  }

  function loadBlocksState() {
    const r = loadJsonSafe(BLOCKS_KEY);
    if (!r.ok) return { ok: false, corrupt: true, missing: false, blocks: [] };
    if (r.missing) return { ok: true, corrupt: false, missing: true, blocks: [] };

    const blocks = extractBlocks(r.data);
    if (!Array.isArray(blocks)) return { ok: false, corrupt: true, missing: false, blocks: [] };
    return { ok: true, corrupt: false, missing: false, blocks: blocks };
  }

  function saveBlocks(blocksArray) {
    const arr = Array.isArray(blocksArray) ? blocksArray : [];
    // Skriv alltid wrapper-shape för stabilitet
    return saveJsonSafe(BLOCKS_KEY, { blocks: arr });
  }

  // ---------- Trainings (AO-057_TRAININGS_V1) read-only ----------
  function extractTrainings(data) {
    // Tillåter flera legacy-shapes:
    // 1) [ ... ] (array)
    // 2) { trainings:[...] }
    // 3) { items:[...] }
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      if (Array.isArray(data.trainings)) return data.trainings;
      if (Array.isArray(data.items)) return data.items;
    }
    return null;
  }

  function loadTrainingsState() {
    const r = loadJsonSafe(TRAININGS_KEY);
    if (!r.ok) return { ok: false, corrupt: true, missing: false, trainings: [] };
    if (r.missing) return { ok: true, corrupt: false, missing: true, trainings: [] };

    const trainings = extractTrainings(r.data);
    if (!Array.isArray(trainings)) return { ok: false, corrupt: true, missing: false, trainings: [] };
    return { ok: true, corrupt: false, missing: false, trainings: trainings };
  }

  // ---------- Fail-closed lock reason builder ----------
  function lockReasonFor(key) {
    if (key === BLOCKS_KEY) return `Låst för säkerhet: ${BLOCKS_KEY} är korrupt.`;
    if (key === TRAININGS_KEY) return `Låst för säkerhet: ${TRAININGS_KEY} är korrupt.`;
    return "Låst för säkerhet: storage är korrupt.";
  }

  // ---------- Exports ----------
  NS.store = {
    // keys
    BLOCKS_KEY,
    TRAININGS_KEY,

    // json
    loadJsonSafe,
    saveJsonSafe,

    // blocks
    loadBlocksState,
    saveBlocks,

    // trainings
    loadTrainingsState,

    // helpers
    lockReasonFor,
  };

  // Minimal dependency check (om core saknas vill vi ändå inte krascha)
  if (!core) {
    // inget hårt fail här – sidan kan fortfarande ladda men visar fel i 06-page.js
    try {
      // eslint-disable-next-line no-console
      console.warn("PackagesBlock.core saknas (02-core.js).");
    } catch (_) {}
  }
})();

