/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-02) | FILE 03/06 | FIL-ID: UI/pages/trainings/03-store.js
Projekt: HR-System (GitHub Pages / UI-only / localStorage-first)
Syfte: Storage-lager för trainings (AO-057_TRAININGS_V1) + små guards

POLICY (LÅST):
- localStorage-first (data) • sessionStorage först (auth via HRApp)
- Fail-closed: korrupt JSON => ok:false + corrupt:true (ingen write)
- Inga nya storage-keys
- XSS: ingen rendering här
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.store) return;

  const store = (NS.store = {});

  const TRAININGS_KEY = "AO-057_TRAININGS_V1";
  store.KEY = TRAININGS_KEY;

  // ------------------------------
  // Safe JSON helpers
  // ------------------------------
  function safeJsonParse(s) {
    try { return { ok: true, value: JSON.parse(s) }; }
    catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
  }

  function safeJsonStringify(obj) {
    try { return { ok: true, value: JSON.stringify(obj) }; }
    catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
  }

  function getLocal() {
    try { return window.localStorage; } catch (_) { return null; }
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normStr(v) {
    return String(v ?? "").trim();
  }

  function lower(v) {
    return normStr(v).toLowerCase();
  }

  function uniqStrings(arr) {
    const out = [];
    const seen = new Set();
    const a = Array.isArray(arr) ? arr : [];
    for (let i = 0; i < a.length; i++) {
      const s = normStr(a[i]).replace(/\s+/g, " ");
      if (!s) continue;
      const k = lower(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  function sanitizeCatalog(candidate) {
    const cat = isPlainObject(candidate) ? candidate : {};
    const modules = uniqStrings(cat.modules);
    const titlePresets = uniqStrings(cat.titlePresets);

    const areasByModule = {};
    if (isPlainObject(cat.areasByModule)) {
      for (const k of Object.keys(cat.areasByModule)) {
        const mod = normStr(k).replace(/\s+/g, " ");
        if (!mod) continue;
        areasByModule[mod] = uniqStrings(cat.areasByModule[k]);
      }
    }

    return { modules, areasByModule, titlePresets };
  }

  // ------------------------------
  // Load (read-only)
  // Shape: wrapper { trainings:[...], meta:{...} } OR legacy array [...]
  // ------------------------------
  store.load = function () {
    const ls = getLocal();
    if (!ls) return { ok: false, missing: true, err: "localStorage saknas." };

    const raw = ls.getItem(TRAININGS_KEY);
    if (!raw) return { ok: true, trainings: [], missing: true };

    const p = safeJsonParse(raw);
    if (!p.ok) return { ok: false, corrupt: true, err: "Korrupt JSON i " + TRAININGS_KEY };

    const v = p.value;

    // legacy: array
    if (Array.isArray(v)) return { ok: true, trainings: v, legacy: true };

    // wrapper
    if (isPlainObject(v)) {
      const arr = Array.isArray(v.trainings) ? v.trainings : [];
      const meta = isPlainObject(v.meta) ? v.meta : {};
      return { ok: true, trainings: arr, wrapper: true, meta };
    }

    // unknown type => treat as corrupt (fail-closed)
    return { ok: false, corrupt: true, err: "Okänd dataform i " + TRAININGS_KEY };
  };

  // ------------------------------
  // Save (write) — bevarar meta om wrapper fanns
  // ------------------------------
  function writeWrapper(trainingsArr, metaPatch) {
    const ls = getLocal();
    if (!ls) return { ok: false, err: "localStorage saknas." };

    const load = store.load();
    if (!load.ok && load.corrupt) {
      return { ok: false, err: "Fail-closed: korrupt trainings. Spara stoppat.", corrupt: true };
    }

    const trainings = Array.isArray(trainingsArr) ? trainingsArr : [];

    // BEVARA meta om wrapper fanns tidigare (viktigt när vi lägger små meta-fält)
    const baseMeta = (load.ok && load.wrapper && isPlainObject(load.meta)) ? load.meta : {};
    const patch = isPlainObject(metaPatch) ? metaPatch : {};

    const nextMeta = Object.assign({}, baseMeta, patch);
    nextMeta.updatedAt = Date.now();

    const wrapper = { trainings, meta: nextMeta };

    const s = safeJsonStringify(wrapper);
    if (!s.ok) return { ok: false, err: "Kunde inte serialisera trainings." };

    try {
      ls.setItem(TRAININGS_KEY, s.value);
      return { ok: true };
    } catch (e) {
      return { ok: false, err: "Kunde inte spara: " + String((e && e.message) || e) };
    }
  }

  // Behåll original-API
  store.save = function (trainingsArr) {
    return writeWrapper(trainingsArr, null);
  };

  // Utökat API: spara trainings + metaPatch (utan ny storage-key)
  // (06-page kan använda detta om du vill kunna lägga till nya moduler/områden/titlar och spara det.)
  store.saveWithMeta = function (trainingsArr, metaPatch) {
    return writeWrapper(trainingsArr, metaPatch);
  };

  store.purgeAll = function () {
    const ls = getLocal();
    if (!ls) return { ok: false, err: "localStorage saknas." };

    const load = store.load();
    if (!load.ok && load.corrupt) return { ok: false, err: "Fail-closed: korrupt trainings. Rensa stoppat.", corrupt: true };

    try {
      ls.removeItem(TRAININGS_KEY);
      return { ok: true };
    } catch (e) {
      return { ok: false, err: "Kunde inte rensa: " + String((e && e.message) || e) };
    }
  };

  store.lockReasonFor = function () {
    const raw = (function () {
      try { return window.localStorage.getItem(TRAININGS_KEY); } catch (_) { return null; }
    })();
    if (!raw) return "Trainings saknas (tom key).";
    return "Trainings är korrupt JSON och måste rensas/återställas.";
  };

  // ============================================================
  // KATALOG-SEED (PP-SC-012)
  // - INGEN ny storage-key.
  // - Vi kan:
  //   A) extrahera seed från befintliga trainings (read-only),
  //   B) (valfritt) läsa/spara custom katalog i wrapper.meta.catalog.
  //
  // Detta gör att du kan ha:
  // - fasta listor via HR_CONFIG (hanteras i core),
  // - + egna tillägg som sparas utan att ändra trainings-items.
  // ============================================================

  function tryParseTitleParts(titleStr) {
    // tolerant: "<chapter> • Steg <n> • <area>"
    const t = normStr(titleStr);
    if (!t) return null;
    if (t.indexOf("•") === -1) return null;

    const parts = t.split("•").map((x) => normStr(x));
    if (!parts.length) return null;

    let chapter = parts[0] || "";
    let step = "";
    let area = parts[2] || "";

    if (parts[1]) {
      const m = parts[1].match(/steg\s*(\d+)/i);
      step = m ? String(m[1]) : "";
    }
    return { chapter, step, area };
  }

  // Seed från träningsdata (tål olika item-shapes)
  store.extractCatalogSeed = function (trainingsArr) {
    const trainings = Array.isArray(trainingsArr) ? trainingsArr : [];
    const modules = [];
    const titlePresets = [];
    const areasByModule = {};

    for (let i = 0; i < trainings.length; i++) {
      const t = trainings[i] || {};
      const mod = normStr(t.module || t.mod || "");
      const area = normStr(t.area || "");
      const courseTitle = normStr(t.courseTitle || (t.course && t.course.chapter) || "");

      // fallback: försök tolka från "title" om den ser ut som kursplanstitel
      const parsed = tryParseTitleParts(t.title || "");
      const parsedChapter = parsed && parsed.chapter ? parsed.chapter : "";
      const parsedArea = parsed && parsed.area ? parsed.area : "";

      if (mod) modules.push(mod);

      const finalArea = area || parsedArea;
      if (mod && finalArea) {
        areasByModule[mod] = areasByModule[mod] || [];
        areasByModule[mod].push(finalArea);
      }

      const ch = courseTitle || parsedChapter;
      if (ch) titlePresets.push(ch);
    }

    return sanitizeCatalog({ modules, areasByModule, titlePresets });
  };

  // Custom katalog i meta (valfritt)
  store.getCustomCatalog = function () {
    const load = store.load();
    if (!load.ok) return { ok: false, err: load.err || "Kunde inte läsa storage.", corrupt: !!load.corrupt };
    if (!load.wrapper || !isPlainObject(load.meta)) return { ok: true, catalog: null, missing: true };

    const c = load.meta.catalog;
    if (!c) return { ok: true, catalog: null, missing: true };

    return { ok: true, catalog: sanitizeCatalog(c) };
  };

  store.saveCustomCatalog = function (catalogObj) {
    const load = store.load();
    if (!load.ok && load.corrupt) return { ok: false, err: "Fail-closed: korrupt trainings. Spara stoppat.", corrupt: true };
    if (!load.ok) return { ok: false, err: load.err || "Kunde inte läsa storage." };

    const trainings = Array.isArray(load.trainings) ? load.trainings : [];
    const safeCatalog = sanitizeCatalog(catalogObj);

    return writeWrapper(trainings, { catalog: safeCatalog });
  };

  store.__VERSION = "v1.1-PP-SC-012";
})();
