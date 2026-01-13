/* ============================================================
AO: MASTER-AO-WORKER-STACK-01 (PROD v1.0) | FIL: UI/UI-04-WORKER-SDK.js
Projekt: HR-System
Syfte: Klient-SDK som kapslar Worker-fetch (version /v1), validering, felhantering, timeout
Policy (LÅST):
- UI-only
- Inga nya datamodeller / storage-keys
- Token får inte lagras i localStorage/sessionStorage
- XSS-safe (ingen innerHTML)
- Fail-closed: om config saknas → gör inget / returnera standardfel
- SDK använder endast /v1/...
============================================================ */

(function () {
  "use strict";

  var DEFAULT_TIMEOUT_MS = 10000;

  // Runtime state (INTE storage)
  var _state = {
    inited: false,
    baseV1: "",          // alltid utan trailing slash, alltid slutar med /v1
    requireAuth: false,
    getToken: function () { return ""; },
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  // ------------------------------
  // Helpers (safe)
  // ------------------------------
  function safeStr(v) {
    return (v === null || v === undefined) ? "" : String(v);
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function trimSlashRight(s) {
    return safeStr(s).replace(/\/+$/, "");
  }

  function normalizeBaseV1(inputBaseUrl) {
    // Accept either:
    // - https://x.workers.dev (we append /v1)
    // - https://x.workers.dev/v1 (we keep)
    // Never trailing slash.
    var u = trimSlashRight(inputBaseUrl);

    // Must be https
    if (!u || !/^https:\/\/[^/\s]+/i.test(u)) return "";

    // If already ends with /v1
    if (/\/v1$/i.test(u)) return u;

    // If includes /v1/ somewhere (e.g. .../v1/api) -> reject (SDK contract expects base = .../v1)
    if (/\/v1\//i.test(u)) return "";

    return u + "/v1";
  }

  function makeOk(requestId, data) {
    return { ok: true, requestId: safeStr(requestId), data: data };
  }

  function makeErr(code, message, status, requestId) {
    return {
      ok: false,
      requestId: safeStr(requestId || ""),
      error: { code: safeStr(code), message: safeStr(message) },
      status: (typeof status === "number" && Number.isFinite(status)) ? status : 0
    };
  }

  function ensureInitedOrFail() {
    if (!_state.inited || !_state.baseV1) {
      return makeErr("SDK_NOT_INITIALIZED", "HRWorkerSDK.init() måste köras först", 0, "");
    }
    return null;
  }

  function buildUrl(pathAfterV1) {
    // _state.baseV1 ends with /v1 (no trailing slash)
    var p = safeStr(pathAfterV1);
    if (!p || p.charAt(0) !== "/") p = "/" + p;
    return _state.baseV1 + p;
  }

  // ------------------------------
  // Local validation (LÅST)
  // ------------------------------
  function normalizeAndValidateGenerateInput(input) {
    var o = isPlainObject(input) ? input : {};

    var mode = safeStr(o.mode || o.type).trim();
    var countRaw = (o.count !== undefined && o.count !== null) ? o.count : o.n;
    var context = safeStr(o.context || o.prompt || "").trim();
    var language = safeStr(o.language || "sv").trim();

    if (mode !== "training" && mode !== "document") {
      return makeErr("VALIDATION_ERROR", "mode måste vara training eller document", 0, "");
    }

    var count;
    if (countRaw === undefined || countRaw === null || countRaw === "") count = 4;
    else {
      var n = Number(countRaw);
      if (!Number.isFinite(n) || Math.trunc(n) !== n) {
        return makeErr("VALIDATION_ERROR", "count måste vara mellan 1 och 12", 0, "");
      }
      count = n;
    }

    if (count < 1 || count > 12) {
      return makeErr("VALIDATION_ERROR", "count måste vara mellan 1 och 12", 0, "");
    }

    if (language !== "sv" && language !== "en") {
      return makeErr("VALIDATION_ERROR", "language måste vara sv eller en", 0, "");
    }

    if (context.length > 2000) {
      return makeErr("VALIDATION_ERROR", "context max 2000 tecken", 0, "");
    }

    return { ok: true, data: { mode: mode, count: count, context: context, language: language } };
  }

  // ------------------------------
  // Fetch wrapper (no-throw)
  // ------------------------------
  async function fetchJson(method, url, bodyObj) {
    var errInit = ensureInitedOrFail();
    if (errInit) return errInit;

    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutMs = (typeof _state.timeoutMs === "number" && _state.timeoutMs > 0) ? _state.timeoutMs : DEFAULT_TIMEOUT_MS;
    var t = null;

    if (controller) {
      t = setTimeout(function () {
        try { controller.abort(); } catch (_) {}
      }, timeoutMs);
    }

    var headers = {
      "Accept": "application/json",
      "Content-Type": "application/json"
    };

    if (_state.requireAuth === true) {
      // Token lagras aldrig – hämtas i runtime
      var tok = "";
      try { tok = safeStr(_state.getToken && _state.getToken()); } catch (_) { tok = ""; }
      if (tok) headers["Authorization"] = "Bearer " + tok;
      // Om requireAuth=true men token saknas: låt servern svara 401 (fail-closed)
    }

    var init = {
      method: method,
      headers: headers
    };
    if (controller) init.signal = controller.signal;

    if (bodyObj !== undefined) {
      try {
        init.body = JSON.stringify(bodyObj);
      } catch (_) {
        if (t) clearTimeout(t);
        return makeErr("BAD_JSON", "Kunde inte serialisera JSON", 0, "");
      }
    }

    var resp;
    try {
      resp = await fetch(url, init);
    } catch (_) {
      if (t) clearTimeout(t);
      return makeErr("NETWORK_ERROR", "Nätfel eller CORS-block", 0, "");
    } finally {
      if (t) clearTimeout(t);
    }

    var status = resp ? resp.status : 0;
    var text = "";
    try {
      text = await resp.text();
    } catch (_) {
      return makeErr("UPSTREAM_ERROR", "Kunde inte läsa svar", status || 0, "");
    }

    var json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      // Worker ska alltid svara JSON — men fail-closed
      return makeErr("UPSTREAM_ERROR", "Svar var inte giltig JSON", status || 0, "");
    }

    // Standardisera return
    if (json && json.ok === true) {
      return makeOk(json.requestId || "", json.data);
    }

    // Fel-format från worker
    if (json && json.ok === false && isPlainObject(json.error)) {
      return makeErr(
        json.error.code || "UPSTREAM_ERROR",
        json.error.message || "Fel från Worker",
        status || 0,
        json.requestId || ""
      );
    }

    // Okänt format
    return makeErr("UPSTREAM_ERROR", "Okänt svarformat", status || 0, "");
  }

  // ------------------------------
  // Public API (LÅST)
  // ------------------------------
  function init(opts) {
    var o = isPlainObject(opts) ? opts : {};

    var baseV1 = normalizeBaseV1(o.baseUrl);
    if (!baseV1) {
      // Fail-closed: init misslyckas, men vi throwar inte
      _state.inited = false;
      _state.baseV1 = "";
      _state.requireAuth = false;
      _state.getToken = function () { return ""; };
      _state.timeoutMs = DEFAULT_TIMEOUT_MS;
      return { ok: false };
    }

    _state.inited = true;
    _state.baseV1 = baseV1;
    _state.requireAuth = (o.requireAuth === true);
    _state.getToken = (typeof o.getToken === "function") ? o.getToken : function () { return ""; };
    _state.timeoutMs = DEFAULT_TIMEOUT_MS;

    return { ok: true };
  }

  async function health() {
    var errInit = ensureInitedOrFail();
    if (errInit) return errInit;
    return fetchJson("GET", buildUrl("/health"));
  }

  async function aiGenerate(input) {
    var errInit = ensureInitedOrFail();
    if (errInit) return errInit;

    var vr = normalizeAndValidateGenerateInput(input);
    if (!vr || vr.ok !== true) return vr || makeErr("VALIDATION_ERROR", "Ogiltigt input", 0, "");

    return fetchJson("POST", buildUrl("/ai/generate"), vr.data);
  }

  // Attach to window
  window.HRWorkerSDK = {
    init: init,
    health: health,
    aiGenerate: aiGenerate
  };
})();

