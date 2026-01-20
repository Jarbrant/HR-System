/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-04) | FILE 03/06 | FIL-ID: UI/pages/trainings/03-store.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Storage-layer för trainings (AO-057_TRAININGS_V1) • load/save/purge
      Fail-closed vid korrupt data. Ingen DOM här.

POLICY (LÅST):
- UI-only • Fail-closed
- Endast denna fil pratar storage (trainings)
- Inga nya storage-keys (använder endast AO-057_TRAININGS_V1)
- Logga aldrig payload (endast felkod/orsak om behövs)
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.store) return;

  const core = NS.core || null;
  const store = (NS.store = {});
  store.__VERSION = "v1.0.4-PP-SC-010-04";

  const KEY = "AO-057_TRAININGS_V1"; // LÅST

  function normStr(v) {
    return (core && core.normStr) ? core.normStr(v) : String(v ?? "").trim();
  }

  function safeArr(a) { return Array.isArray(a) ? a : []; }

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function fail(code, msg) {
    if (core && typeof core.fail === "function") return core.fail(code, msg);
    return { ok: false, code: String(code || "ERR"), err: String(msg || "Fel") };
  }

  function ok(data) {
    if (core && typeof core.ok === "function") return core.ok(data);
    return Object.assign({ ok: true }, data || {});
  }

  function getStorage() {
    // LÅST policy i projektet: sessionStorage först, fallback localStorage via CORE/HRApp normalt.
    // Här: vi läser/skriv direkt i localStorage eftersom trainings är "data". Fail-closed om ej tillgängligt.
    try {
      if (window && window.localStorage) return window.localStorage;
    } catch (_) {}
    return null;
  }

  function readRaw() {
    const st = getStorage();
    if (!st) return { ok: false, missing: true, raw: "" };

    let raw = "";
    try { raw = st.getItem(KEY) || ""; } catch (_) { raw = ""; }

    if (!raw) return { ok: true, missing: true, raw: "" };
    return { ok: true, missing: false, raw };
  }

  function writeRaw(str) {
    const st = getStorage();
    if (!st) return fail("STORAGE_MISSING", "Storage saknas");

    try {
      st.setItem(KEY, String(str ?? ""));
      return ok({ key: KEY });
    } catch (e) {
      return fail("STORAGE_WRITE_FAIL", String(e && e.message ? e.message : e));
    }
  }

  function removeKey() {
    const st = getStorage();
    if (!st) return fail("STORAGE_MISSING", "Storage saknas");
    try {
      st.removeItem(KEY);
      return ok({ removed: true, key: KEY });
    } catch (e) {
      return fail("STORAGE_REMOVE_FAIL", String(e && e.message ? e.message : e));
    }
  }

  // ------------------------------------------------------------
  // Shape validation (tolerant but bounded)
  // ------------------------------------------------------------
  function normalizeTraining(t) {
    const x = isPlainObject(t) ? t : {};

    const id = normStr(x.id);
    if (!id) return null;

    const out = {
      id: id,
      status: normStr(x.status) === "published" ? "published" : "draft",
      module: normStr(x.module),
      area: normStr(x.area),
      courseTitle: normStr(x.courseTitle),
      courseStep: normStr(x.courseStep),
      goalsLevel: normStr(x.goalsLevel),
      goals: normStr(x.goals),
      title: normStr(x.title),
      blocks: [],
      meta: isPlainObject(x.meta) ? x.meta : {}
    };

    // blocks/items tolerant
    if (Array.isArray(x.blocks)) out.blocks = x.blocks;
    else if (Array.isArray(x.items)) out.blocks = [{ title: out.title || "(block)", items: x.items }];

    return out;
  }

  function validatePayload(obj) {
    // Accept either {trainings:[...]} or direct array
    if (Array.isArray(obj)) return ok({ trainings: obj });
    if (isPlainObject(obj) && Array.isArray(obj.trainings)) return ok({ trainings: obj.trainings });
    return fail("SHAPE_BAD", "Fel format");
  }

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  store.lockReasonFor = function () {
    return "Korrupt data i AO-057_TRAININGS_V1 (fail-closed).";
  };

  store.load = function () {
    const rr = readRaw();
    if (!rr.ok) return fail("READ_FAIL", "Kunde inte läsa");

    if (rr.missing) return ok({ trainings: [], missing: true });

    let parsed = null;
    try {
      parsed = JSON.parse(rr.raw);
    } catch (_) {
      return { ok: false, corrupt: true, code: "JSON_PARSE", err: "Korrupt JSON" };
    }

    const vp = validatePayload(parsed);
    if (!vp.ok) return { ok: false, corrupt: true, code: vp.code || "SHAPE", err: vp.err || "Korrupt shape" };

    const listIn = safeArr(vp.trainings);
    const out = [];
    for (const t of listIn) {
      const nt = normalizeTraining(t);
      if (nt) out.push(nt);
    }

    return ok({ trainings: out, missing: false });
  };

  store.save = function (trainings) {
    const list = safeArr(trainings);
    // Minimal deterministic wrapper
    const payload = { trainings: list };

    let raw = "";
    try { raw = JSON.stringify(payload); } catch (e) { return fail("JSON_STRINGIFY", String(e && e.message ? e.message : e)); }

    return writeRaw(raw);
  };

  store.purgeAll = function () {
    return removeKey();
  };

  store.getKey = function () { return KEY; };
})();
