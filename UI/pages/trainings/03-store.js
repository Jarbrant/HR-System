/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-04) | FILE 03/06 | FIL-ID: UI/pages/trainings/03-store.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Storage-adapter för trainings (AO-057_TRAININGS_V1) • load/save/purge
      Fail-closed: korrupt data låser skrivning (caller får ok:false + corrupt:true)

POLICY (LÅST):
- UI-only • Fail-closed
- Endast denna fil får skriva AO-057_TRAININGS_V1
- Ingen DOM-render här
- XSS-safe (ingen innerHTML)
- Inga nya storage-keys
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.store) return;

  const core = NS.core || null;
  const store = (NS.store = {});
  store.__VERSION = "v1.0.4-PP-SC-010-04";

  // LÅST KEY
  const KEY = "AO-057_TRAININGS_V1";

  // In-memory lock flag (persistas inte)
  let _locked = false;
  let _lockReason = "";

  function normStr(v) {
    return (core && core.normStr) ? core.normStr(v) : String(v ?? "").trim();
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function fail(code, msg, extra) {
    const out = Object.assign({ ok: false, code: String(code || "ERR"), err: String(msg || "Fel") }, extra || {});
    return out;
  }

  function ok(data) {
    return Object.assign({ ok: true }, data || {});
  }

  function safeParse(jsonText) {
    try { return { ok: true, data: JSON.parse(String(jsonText || "")) }; }
    catch (e) { return { ok: false, err: String(e && e.message ? e.message : e) }; }
  }

  function validateShape(root) {
    // Tillåter två shapes:
    // A) { trainings: [...] } (preferred wrapper)
    // B) [...] (legacy array)
    if (Array.isArray(root)) return ok({ trainings: root, legacyArray: true });

    if (!isPlainObject(root)) return fail("SHAPE", "Trainings: ogiltigt format");
    if (!Array.isArray(root.trainings)) return fail("SHAPE", "Trainings: saknar trainings[]");
    return ok({ trainings: root.trainings, legacyArray: false });
  }

  function scrubTraining(t) {
    // Minimal normalisering: vi tar inte bort fält, bara säkrar grundfält
    const x = isPlainObject(t) ? t : {};
    const id = normStr(x.id) || ("tr_" + Date.now());
    const status = (normStr(x.status) === "published") ? "published" : "draft";
    const title = normStr(x.title);
    const module = normStr(x.module);
    const area = normStr(x.area);

    // blocks/items tolereras, inget krav här
    const out = Object.assign({}, x, { id, status, title, module, area });
    return out;
  }

  function scrubList(list) {
    const arr = Array.isArray(list) ? list : [];
    return arr.map(scrubTraining);
  }

  function readRaw() {
    // Fail-closed: om HRApp finns kan den ha guardad storage wrapper
    try {
      if (window.HRApp && typeof window.HRApp.safeGet === "function") {
        return window.HRApp.safeGet(KEY);
      }
    } catch (_) {}
    try {
      return localStorage.getItem(KEY);
    } catch (_) {
      return null;
    }
  }

  function writeRaw(value) {
    try {
      if (window.HRApp && typeof window.HRApp.safeSet === "function") {
        window.HRApp.safeSet(KEY, value);
        return ok();
      }
    } catch (_) {}
    try {
      localStorage.setItem(KEY, value);
      return ok();
    } catch (e) {
      return fail("WRITE_FAIL", "Kunde inte skriva till storage", { detail: String(e && e.message ? e.message : e) });
    }
  }

  function removeRaw() {
    try {
      if (window.HRApp && typeof window.HRApp.safeRemove === "function") {
        window.HRApp.safeRemove(KEY);
        return ok();
      }
    } catch (_) {}
    try {
      localStorage.removeItem(KEY);
      return ok();
    } catch (e) {
      return fail("REMOVE_FAIL", "Kunde inte rensa storage", { detail: String(e && e.message ? e.message : e) });
    }
  }

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  store.key = function () { return KEY; };

  store.isLocked = function () { return _locked === true; };

  store.lockReasonFor = function () { return normStr(_lockReason) || "Korrupt data."; };

  store.unlock = function () {
    _locked = false;
    _lockReason = "";
    return ok();
  };

  store.load = function () {
    if (_locked) return fail("LOCKED", store.lockReasonFor(), { corrupt: true, trainings: [] });

    const raw = readRaw();
    if (!raw) return ok({ trainings: [], empty: true });

    const parsed = safeParse(raw);
    if (!parsed.ok) {
      _locked = true;
      _lockReason = "Trainings är korrupt JSON.";
      return fail("CORRUPT_JSON", _lockReason, { corrupt: true, trainings: [] });
    }

    const shape = validateShape(parsed.data);
    if (!shape.ok) {
      _locked = true;
      _lockReason = "Trainings har fel format.";
      return fail("CORRUPT_SHAPE", _lockReason, { corrupt: true, trainings: [] });
    }

    const trainings = scrubList(shape.trainings);
    return ok({ trainings, legacyArray: !!shape.legacyArray });
  };

  store.save = function (trainingsList) {
    if (_locked) return fail("LOCKED", store.lockReasonFor(), { corrupt: true });

    const trainings = scrubList(trainingsList);
    const payload = JSON.stringify({ trainings: trainings });

    const w = writeRaw(payload);
    if (!w.ok) return w;

    return ok({ count: trainings.length });
  };

  store.purgeAll = function () {
    if (_locked) return fail("LOCKED", store.lockReasonFor(), { corrupt: true });

    const r = removeRaw();
    if (!r.ok) return r;
    return ok();
  };

})();
