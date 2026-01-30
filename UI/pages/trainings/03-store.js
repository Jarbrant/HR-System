/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-04) | FILE 03/06 | FIL-ID: UI/pages/trainings/03-store.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Storage-lager för Trainings (AO-057_TRAININGS_V1) • load/save/purge
      + fail-closed vid korrupt data • ingen DOM • ingen AI • inga nya keys

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys (endast AO-057_TRAININGS_V1)
- Ingen DOM-render här (05-render)
- XSS-safe: inga innerHTML (ingen rendering)
- ADMIN-only write styrs av page/core (inte här)
- Logga aldrig payload

NYCKEL (LÅST):
- AO-057_TRAININGS_V1

PATCH v1.0.1 (PP-SC-010-04) – AUTOPATCH P0:
- P0 FIX: meta.createdAt/meta.updatedAt normaliseras robust till number (hanterar strängar/NaN).
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.store) return;

  const store = (NS.store = {});
  store.__VERSION = "v1.0.1-PP-SC-010-04";

  const KEY = "AO-057_TRAININGS_V1";
  const MAX_BYTES = 1024 * 1024 * 2; // 2MB (best-effort), fail-closed om överskrids
  let _lockReason = "";

  function normStr(v) { return String(v ?? "").trim(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }
  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function safeJsonParse(str) {
    try { return { ok: true, value: JSON.parse(str) }; }
    catch (e) { return { ok: false, error: e }; }
  }

  function safeJsonStringify(obj) {
    try { return { ok: true, value: JSON.stringify(obj) }; }
    catch (e) { return { ok: false, error: e }; }
  }

  function byteLen(s) {
    try { return new Blob([String(s || "")]).size; } catch (_) { return String(s || "").length; }
  }

  function mkFail(code, msg, extra) {
    const out = { ok: false, code: String(code || "ERR"), message: String(msg || "Fel") };
    if (extra && typeof extra === "object") Object.assign(out, extra);
    return out;
  }

  function mkOk(extra) {
    return Object.assign({ ok: true }, extra || {});
  }

  function asFiniteNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeTraining(t) {
    // OBS: ingen ny datamodell – vi bevarar fält, men säkrar minsta shape.
    if (!isPlainObject(t)) return null;
    const id = normStr(t.id);
    if (!id) return null;

    const out = Object.assign({}, t);
    out.id = id;
    out.status = (String(out.status || "draft") === "published") ? "published" : "draft";

    if (!Array.isArray(out.blocks) && Array.isArray(out.items)) {
      // legacy: items -> wrap i ett block
      out.blocks = [{ title: normStr(out.title) || "(block)", items: safeArr(out.items) }];
      delete out.items;
    }
    if (!Array.isArray(out.blocks)) out.blocks = [];

    if (!isPlainObject(out.meta)) out.meta = {};

    // P0: robust timestamp-normalisering (string/NaN -> number)
    const created = asFiniteNumber(out.meta.createdAt);
    out.meta.createdAt = (created != null) ? created : Date.now();

    const updated = asFiniteNumber(out.meta.updatedAt);
    out.meta.updatedAt = (updated != null) ? updated : 0;

    // Minimalt skydd för stora strängar (fail-soft, inte loss av data)
    if (typeof out.title !== "string") out.title = normStr(out.title);
    if (typeof out.module !== "string") out.module = normStr(out.module);
    if (typeof out.area !== "string") out.area = normStr(out.area);

    return out;
  }

  function dedupeById(list) {
    const seen = new Set();
    const out = [];
    for (const x of safeArr(list)) {
      const t = normalizeTraining(x);
      if (!t) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  }

  function readRaw() {
    try {
      const v = localStorage.getItem(KEY);
      return (v == null) ? "" : String(v);
    } catch (e) {
      _lockReason = "Storage ej tillgänglig (localStorage).";
      return "";
    }
  }

  function writeRaw(str) {
    try {
      localStorage.setItem(KEY, String(str || ""));
      return true;
    } catch (e) {
      _lockReason = "Kunde inte skriva till storage.";
      return false;
    }
  }

  store.lockReasonFor = function () {
    return _lockReason || "Korrupt eller ogiltig data.";
  };

  store.load = function () {
    _lockReason = "";
    const raw = readRaw();

    if (!raw) {
      return mkOk({ trainings: [], empty: true });
    }

    const parsed = safeJsonParse(raw);
    if (!parsed.ok) {
      _lockReason = "Korrupt JSON i AO-057_TRAININGS_V1.";
      return mkFail("TRAININGS_CORRUPT_JSON", _lockReason, { corrupt: true, trainings: [] });
    }

    const obj = parsed.value;

    // Tillåt 2 former:
    // A) { trainings: [...] }
    // B) [...] (direkt lista)
    let trainings = [];
    if (Array.isArray(obj)) trainings = obj;
    else if (isPlainObject(obj) && Array.isArray(obj.trainings)) trainings = obj.trainings;
    else {
      _lockReason = "Ogiltigt format i AO-057_TRAININGS_V1.";
      return mkFail("TRAININGS_BAD_SHAPE", _lockReason, { corrupt: true, trainings: [] });
    }

    const norm = dedupeById(trainings);
    return mkOk({ trainings: norm });
  };

  store.save = function (trainingsList) {
    _lockReason = "";
    const list = dedupeById(trainingsList);

    const payload = { trainings: list };
    const js = safeJsonStringify(payload);
    if (!js.ok) {
      _lockReason = "Kunde inte serialisera trainings.";
      return mkFail("TRAININGS_STRINGIFY_FAIL", _lockReason);
    }

    const bytes = byteLen(js.value);
    if (bytes > MAX_BYTES) {
      _lockReason = "För stor data för lagring (max ~2MB).";
      return mkFail("TRAININGS_TOO_LARGE", _lockReason, { bytes, max: MAX_BYTES });
    }

    const ok = writeRaw(js.value);
    if (!ok) return mkFail("TRAININGS_WRITE_FAIL", _lockReason || "Write fail");

    return mkOk({ count: list.length, bytes });
  };

  store.purgeAll = function () {
    _lockReason = "";
    try {
      localStorage.removeItem(KEY);
      return mkOk({ purged: true });
    } catch (e) {
      _lockReason = "Kunde inte rensa storage.";
      return mkFail("TRAININGS_PURGE_FAIL", _lockReason);
    }
  };

  store.KEY = KEY;
})();
