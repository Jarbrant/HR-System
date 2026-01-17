/* ============================================================
AO-WORKER-CLIENT-SDK-01 (PROD) | FIL-ID: UI/UI-04-WORKER-SDK.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Gemensam “Hand” (SDK) som alla sidor använder för att prata med Worker.

POLICY (LÅST):
- UI-only
- Fail-closed: om init saknas / baseUrl saknas => return ok:false
- Ingen token lagras i webbläsaren (SDK tar getToken() callback)
- Inga storage-keys
- XSS-säker: SDK renderar inget, returnerar endast data

API (LÅST):
- HRWorkerSDK.init({ baseUrl, requireAuth, getToken })
- HRWorkerSDK.health()
- HRWorkerSDK.aiGenerate({ mode, count, context, language })

Kontrakt (return-format):
- { ok:true,  data, requestId? }
- { ok:false, error:{ code, message, details? }, requestId? }

PATCH v1.1 (SDK-CONTRACT-FIX + TRACE):
- Om workern svarar med {ok:false,...} vid HTTP 200 => SDK returnerar ok:false (inte ok:true).
- requestId hämtas både från headers och body (fallback).
- Lägger på ofarliga client-trace headers (X-HR-Client / X-HR-SDK).
============================================================ */

(function(){
  "use strict";

  const SDK = {};
  SDK.VERSION = "1.1.0";

  const STATE = {
    inited: false,
    baseUrl: "",
    requireAuth: false,
    getToken: null
  };

  function safeStr(v){
    return (v === null || v === undefined) ? "" : String(v);
  }

  function trimStr(v){
    return safeStr(v).trim();
  }

  function normalizeBaseUrl(url){
    let u = trimStr(url);
    // ta bort trailing slash
    while (u.endsWith("/")) u = u.slice(0, -1);
    return u;
  }

  function mkErr(code, message, details, requestId){
    const out = {
      ok: false,
      error: {
        code: safeStr(code || "ERROR"),
        message: safeStr(message || "Fel")
      }
    };
    if (details !== undefined) out.error.details = details;
    if (requestId) out.requestId = safeStr(requestId);
    return out;
  }

  function mkOk(data, requestId){
    const out = { ok: true, data: (data === undefined ? null : data) };
    if (requestId) out.requestId = safeStr(requestId);
    return out;
  }

  function isObj(v){
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function getHeaderRequestId(headers){
    try{
      if (!headers) return "";
      return trimStr(headers.get("x-request-id") || headers.get("x-hr-request-id") || "");
    }catch(_){
      return "";
    }
  }

  function getBodyRequestId(data){
    try{
      if (!isObj(data)) return "";
      // vanligast: {requestId:"..."} eller {data:{requestId:"..."}}
      const a = trimStr(data.requestId || "");
      if (a) return a;
      if (isObj(data.data)){
        const b = trimStr(data.data.requestId || "");
        if (b) return b;
      }
      return "";
    }catch(_){
      return "";
    }
  }

  function attachRequestId(obj, requestId){
    try{
      if (!obj || !requestId) return obj;
      if (typeof obj.requestId === "string" && trimStr(obj.requestId)) return obj;
      obj.requestId = requestId;
      return obj;
    }catch(_){
      return obj;
    }
  }

  function getAuthHeader(){
    try{
      if (!STATE.requireAuth) return null;
      if (typeof STATE.getToken !== "function") return null;
      const token = trimStr(STATE.getToken() || "");
      if (!token) return null;
      return "Bearer " + token;
    }catch(_){
      return null;
    }
  }

  function addClientTraceHeaders(headers){
    try{
      headers["X-HR-Client"] = "HR-System";
      headers["X-HR-SDK"] = "UI-04-WORKER-SDK.js@" + SDK.VERSION;
    }catch(_){}
    return headers;
  }

  async function safeFetchJson(url, opts){
    try{
      const r = await fetch(url, opts);

      const headerReqId = getHeaderRequestId(r.headers);

      let data = null;
      let text = "";
      try{
        text = await r.text();
      }catch(_){
        text = "";
      }

      if (text){
        try{ data = JSON.parse(text); }catch(_){ data = null; }
      }

      const bodyReqId = getBodyRequestId(data);
      const reqId = trimStr(headerReqId || bodyReqId || "");

      if (!r.ok){
        // fail-closed: försök läsa standardfel
        const msg =
          (data && isObj(data) && data.error && isObj(data.error) && data.error.message)
            ? safeStr(data.error.message)
            : ("HTTP " + r.status);

        if (r.status === 401 || r.status === 403){
          return mkErr("UNAUTHORIZED", msg || "Obehörig", { status:r.status }, reqId);
        }
        if (r.status === 404){
          return mkErr("NOT_FOUND", msg || "Hittas ej", { status:r.status }, reqId);
        }
        if (r.status === 400){
          return mkErr("VALIDATION_ERROR", msg || "Valideringsfel", { status:r.status, body:data || text || "" }, reqId);
        }

        return mkErr("HTTP_ERROR", msg || "Fel", { status:r.status, body:data || text || "" }, reqId);
      }

      // HTTP ok
      if (data === null){
        // accept tomt svar som ok (men data=null)
        return mkOk(null, reqId);
      }

      // Viktigt: om workern redan använder {ok:true/false,...} ska vi respektera det
      if (isObj(data) && typeof data.ok === "boolean"){
        attachRequestId(data, reqId);

        // Normalisera minimalt: om ok:true men saknar data-fält -> skapa data:null
        if (data.ok === true && !("data" in data)) data.data = null;

        // Om ok:false men saknar error -> fail-closed ändå
        if (data.ok === false && !(data.error && isObj(data.error) && data.error.code)){
          data.error = data.error && isObj(data.error) ? data.error : {};
          if (!data.error.code) data.error.code = "ERROR";
          if (!data.error.message) data.error.message = "Fel";
        }
        return data;
      }

      // Annars: legacy/raw-json => wrappar enligt SDK-kontraktet
      return mkOk(data, reqId);

    }catch(e){
      return mkErr("NETWORK_ERROR", "Nät/CORS-fel", { message: safeStr(e && e.message) }, "");
    }
  }

  function ensureInited(){
    if (!STATE.inited) return mkErr("NOT_INITED", "SDK ej initierad");
    if (!STATE.baseUrl) return mkErr("NO_BASE_URL", "Worker baseUrl saknas");
    return null;
  }

  // ---------- Public API ----------
  SDK.init = function(cfg){
    try{
      const c = isObj(cfg) ? cfg : {};
      const baseUrl = normalizeBaseUrl(c.baseUrl || "");
      const requireAuth = !!c.requireAuth;
      const getToken = (typeof c.getToken === "function") ? c.getToken : null;

      if (!baseUrl){
        STATE.inited = false;
        STATE.baseUrl = "";
        STATE.requireAuth = requireAuth;
        STATE.getToken = getToken;
        return mkErr("NO_BASE_URL", "Worker baseUrl saknas");
      }

      STATE.inited = true;
      STATE.baseUrl = baseUrl;
      STATE.requireAuth = requireAuth;
      STATE.getToken = getToken;

      return mkOk({ baseUrl: STATE.baseUrl, requireAuth: STATE.requireAuth, sdkVersion: SDK.VERSION });
    }catch(e){
      STATE.inited = false;
      return mkErr("INIT_ERROR", "Kunde inte initiera SDK", { message: safeStr(e && e.message) });
    }
  };

  SDK.health = async function(){
    const notOk = ensureInited();
    if (notOk) return notOk;

    const url = STATE.baseUrl + "/v1/health";
    let headers = { "Accept": "application/json" };

    const auth = getAuthHeader();
    if (auth) headers["Authorization"] = auth;

    headers = addClientTraceHeaders(headers);

    return await safeFetchJson(url, {
      method: "GET",
      mode: "cors",
      headers
    });
  };

  SDK.aiGenerate = async function(payload){
    const notOk = ensureInited();
    if (notOk) return notOk;

    const p = isObj(payload) ? payload : {};
    const mode = trimStr(p.mode || "training");
    const count = (typeof p.count === "number" && isFinite(p.count)) ? p.count : parseInt(p.count, 10);
    const language = trimStr(p.language || "sv");
    const context = safeStr(p.context || "");

    // fail-closed validering
    if (!(mode === "training" || mode === "document")){
      return mkErr("VALIDATION_ERROR", "mode måste vara 'training' eller 'document'", { mode });
    }
    if (!(count >= 1 && count <= 12)){
      return mkErr("VALIDATION_ERROR", "count måste vara 1–12", { count });
    }
    if (!language){
      return mkErr("VALIDATION_ERROR", "language saknas", {});
    }
    // context får vara tomt, men begränsa storlek för stabilitet
    const ctx = (context.length > 4000) ? context.slice(0, 4000) : context;

    const url = STATE.baseUrl + "/v1/ai/generate";
    let headers = {
      "Accept": "application/json",
      "Content-Type": "application/json"
    };

    const auth = getAuthHeader();
    if (auth) headers["Authorization"] = auth;

    headers = addClientTraceHeaders(headers);

    const body = JSON.stringify({
      mode,
      count,
      language,
      context: ctx
    });

    return await safeFetchJson(url, {
      method: "POST",
      mode: "cors",
      headers,
      body
    });
  };

  // export
  try{
    Object.defineProperty(window, "HRWorkerSDK", {
      value: SDK,
      writable: false,
      configurable: false,
      enumerable: true
    });
  }catch(_){
    // fallback om defineProperty misslyckas
    window.HRWorkerSDK = SDK;
  }
})();
