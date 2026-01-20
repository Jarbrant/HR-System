/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-03) | FILE 03/06 | FIL-ID: UI/pages/trainings/03-store.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Storage-lager för trainings (AO-057_TRAININGS_V1) – load/save/purge + fail-closed vid korrupt JSON.

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys (ENDAST: AO-057_TRAININGS_V1)
- Lagra aldrig tokens här
- Ingen DOM här
- XSS-safe: render sker i 05-render via textContent

PATCH v1.0.3 (PP-SC-010-03) – CORRUPT-GUARD:
- P0: Fail-closed: korrupt JSON => ok:false + corrupt:true + tydlig lockReason.
- P0: Tolerant read: accepterar både array och wrapper {trainings:[...]} (för bakåtkomp).
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.store) return;

  const store = (NS.store = {});
  store.__VERSION = "v1.0.3-PP-SC-010-03";

  // LÅST key
  const TRAININGS_KEY = "AO-057_TRAININGS_V1";

  // ------------------------------------------------------------
  // Internal helpers (no side effects)
  // ------------------------------------------------------------
  function normStr(v) { return String(v ?? "").trim(); }

  function safeJsonParse(s) {
    try { return { ok: true, value: JSON.parse(s) }; }
    catch (e) { return { ok: false, err: String(e && e.message ? e.message : e) }; }
  }

  function safeJsonStringify(v) {
    try { return { ok: true, value: JSON.stringify(v) }; }
    catch (e) { return { ok: false, err: String(e && e.message ? e.message : e) }; }
  }

  function safeArr(a) { return Array.isArray(a) ? a : []; }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizeTrainingsShape(parsed) {
    // Tolerant: array OR { trainings: [] }
    if (Array.isArray(parsed)) return parsed;
    if (isPlainObject(parsed) && Array.isArray(parsed.trainings)) return parsed.trainings;
    // Some older shapes might use { items: [] } or { data: [] }
    if (isPlainObject(parsed) && Array.isArray(parsed.items)) return parsed.items;
    if (isPlainObject(parsed) && Array.isArray(parsed.data)) return parsed.data;
    return [];
  }

  function tryGetItem(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function trySetItem(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function tryRemoveItem(key) {
    try { localStorage.removeItem(key); return true; } catch (_) { return false; }
  }

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  store.key = function () { return TRAININGS_KEY; };

  store.lockReasonFor = function (details) {
    const d = normStr(details);
    if (d) return "Låst: Trainings-data är korrupt (" + d + ").";
    return "Låst: Trainings-data är korrupt.";
  };

  store.load = function () {
    const raw = tryGetItem(TRAININGS_KEY);

    if (raw == null || raw === "") {
      return { ok: true, trainings: [], empty: true };
    }

    const parsed = safeJsonParse(String(raw));
    if (!parsed.ok) {
      return {
        ok: false,
        corrupt: true,
        err: "JSON_PARSE",
        detail: parsed.err || "parse-fel"
      };
    }

    const trainings = normalizeTrainingsShape(parsed.value);

    // Fail-closed: om shape inte ens går att normalisera men rådata fanns -> markera corrupt
    // (Annars risk att UI ”tappar kedjan” när data i praktiken är fel.)
    const isMeaningful =
      Array.isArray(parsed.value) ||
      (isPlainObject(parsed.value) && (
        Array.isArray(parsed.value.trainings) ||
        Array.isArray(parsed.value.items) ||
        Array.isArray(parsed.value.data)
      ));

    if (!isMeaningful && trainings.length === 0) {
      return {
        ok: false,
        corrupt: true,
        err: "SHAPE",
        detail: "okänd wrapper"
      };
    }

    return { ok: true, trainings: safeArr(trainings) };
  };

  store.save = function (trainings) {
    // LÅST: Vi sparar en wrapper med tydlig struktur (bakåtkomp på load).
    const payload = { trainings: safeArr(trainings) };

    const str = safeJsonStringify(payload);
    if (!str.ok) {
      return { ok: false, err: "JSON_STRINGIFY", detail: str.err || "stringify-fel" };
    }

    const ok = trySetItem(TRAININGS_KEY, str.value);
    if (!ok) return { ok: false, err: "STORAGE_WRITE", detail: "localStorage write-fel" };

    return { ok: true };
  };

  store.purgeAll = function () {
    const ok = tryRemoveItem(TRAININGS_KEY);
    if (!ok) return { ok: false, err: "STORAGE_REMOVE", detail: "localStorage remove-fel" };
    return { ok: true };
  };
})();
