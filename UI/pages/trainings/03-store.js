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

  // Shape: wrapper { trainings:[...], meta:{...} } OR legacy array [...]
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
    if (v && typeof v === "object") {
      const arr = Array.isArray(v.trainings) ? v.trainings : [];
      return { ok: true, trainings: arr, wrapper: true, meta: v.meta || {} };
    }

    // unknown type => treat as corrupt (fail-closed)
    return { ok: false, corrupt: true, err: "Okänd dataform i " + TRAININGS_KEY };
  };

  // Save uses wrapper (non-breaking): {trainings:[...], meta:{updatedAt}}
  store.save = function (trainingsArr) {
    const ls = getLocal();
    if (!ls) return { ok: false, err: "localStorage saknas." };

    const load = store.load();
    if (!load.ok && load.corrupt) return { ok: false, err: "Fail-closed: korrupt trainings. Spara stoppat.", corrupt: true };

    const trainings = Array.isArray(trainingsArr) ? trainingsArr : [];

    const wrapper = {
      trainings,
      meta: { updatedAt: Date.now() }
    };

    const s = safeJsonStringify(wrapper);
    if (!s.ok) return { ok: false, err: "Kunde inte serialisera trainings." };

    try {
      ls.setItem(TRAININGS_KEY, s.value);
      return { ok: true };
    } catch (e) {
      return { ok: false, err: "Kunde inte spara: " + String((e && e.message) || e) };
    }
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

  store.__VERSION = "v1.0-PP-SC-010-02";
})();

