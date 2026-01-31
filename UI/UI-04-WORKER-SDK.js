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
- HRWorkerSDK.aiGenerate({ mode, count, context, language, questionType, feedbackEnabled })

Kontrakt (return-format):
- { ok:true,  data, requestId? }
- { ok:false, error:{ code, message, details? }, requestId? }

PATCH v1.1.2 (AI-PAYLOAD-FIX):
- Skickar med questionType + feedbackEnabled (var saknade)
- Skickar context som riktig JSON (inte "[object Object]")
- Fail-closed om payload blir för stor (≈64KB)

PATCH v1.1.3 (CORS+CONTEXT-CONTRACT):
- Header-namn matchar CORS allowlist: X-Hr-Client + X-Hr-Sdk
- Context normaliseras alltid till { text:"..." } (så Worker kan inferera + undvika tom context)
- Payload size-check görs på UTF-8 bytes (inte string.length)

PATCH v1.1.4 (AI-ENDPOINT-MODE-FIX):
- mode=document -> POST /v1/ai/document (inte /v1/ai/generate)
- mode=training -> POST /v1/ai/training
- Backward compatible: om /document|/training ger 404, fallback till /v1/ai/generate
- Skickar questionType/feedbackEnabled bara i training-läge (minskar valideringsrisk i document-läge)
============================================================ */

(function(){
  "use strict";

  /* =========================
     BLOCK 01/10 — SDK root + version + state
  ========================== */
  const SDK = {};
  SDK.VERSION = "1.1.4";

  const STATE = {
    inited: false,
    baseUrl: "",
    requireAuth: false,
    getToken: null
  };

  /* =========================
     BLOCK 02/10 — Small helpers (strings/objects)
  ========================== */
  function safeStr(v){
    return (v === null || v === undefined) ? "" : String(v);
  }

  function trimStr(v){
    return safeStr(v).trim();
  }

  function normalizeBaseUrl(url){
    let u = trimStr(url);
    while (u.endsWith("/")) u = u.slice(0, -1);
    return u;
  }

  function isObj(v){
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  /* =========================
     BLOCK 03/10 — Contract helpers (mkErr/mkOk) + requestId helpers
  ========================== */
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

  /* =========================
     BLOCK 04/10 — Auth + trace headers + UTF8 bytes
  ========================== */
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
      // Matchar Worker CORS allowlist (case-stabilt)
      headers["X-Hr-Client"] = "HR-System";
      headers["X-Hr-Sdk"] = "UI-04-WORKER-SDK.js@" + SDK.VERSION;
    }catch(_){}
    return headers;
  }

  function utf8ByteLen(str){
    try{
      return new TextEncoder().encode(String(str || "")).length;
    }catch(_){
      // fallback: approx
      return safeStr(str).length;
    }
  }

  /* =========================
     BLOCK 05/10 — Context normalization (always {text:"..."})
  ========================== */
  // PATCH: context normaliseras alltid till { text:"..." }
  // - Worker läser context.text / contextText / value → vi säkrar text.
  function normalizeContext(input){
    try{
      if (input === null || input === undefined) return { text: "" };

      // Already good
      if (isObj(input)){
        const direct = trimStr(input.text || input.contextText || "");
        if (direct) return { text: direct };

        // Känd shape från UI (utan ny datamodell): module/area/chapter/step
        const module = trimStr(input.module || input.modul || "");
        const area = trimStr(input.area || input.omrade || input.område || "");
        const chapter = trimStr(input.chapter || input.kapitel || "");
        const step = trimStr(input.step || input.steg || "");

        if (module || area || chapter || step){
          const parts = [];
          if (module) parts.push("Modul: " + module);
          if (area) parts.push("Område: " + area);
          if (chapter) parts.push("Kapitel: " + chapter);
          if (step) parts.push("Steg: " + step);
          return { text: parts.join(" • ") };
        }

        // Sista utväg: försök fånga något men håll det kort
        let s = "";
        try{
          s = JSON.stringify(input);
        }catch(_){
          s = "";
        }
        s = trimStr(s);
        if (s) return { text: s.slice(0, 2000) };
        return { text: "" };
      }

      if (Array.isArray(input)){
        let s = "";
        try{ s = JSON.stringify(input); }catch(_){ s = ""; }
        s = trimStr(s);
        return { text: s.slice(0, 2000) };
      }

      if (typeof input === "string"){
        const s = trimStr(input);
        if (!s) return { text: "" };
        // Om någon skickar JSON-sträng, försök parsa men behåll texten om det inte är {text:""}
        try{
          const parsed = JSON.parse(s);
          if (isObj(parsed)){
            const t = trimStr(parsed.text || parsed.contextText || "");
            if (t) return { text: t };
          }
          // annars behåll ursprungstexten (för worker-infer)
          return { text: s };
        }catch(_){
          return { text: s };
        }
      }

      // number/bool/etc
      return { text: trimStr(input) || safeStr(input) };
    }catch(_){
      return { text: "" };
    }
  }

  /* =========================
     BLOCK 06/10 — Network layer (safeFetchJson) + worker contract handling
  ========================== */
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
        return mkOk(null, reqId);
      }

      // Respektera worker-kontrakt {ok:true/false,...}
      if (isObj(data) && typeof data.ok === "boolean"){
        attachRequestId(data, reqId);

        if (data.ok === true && !("data" in data)) data.data = null;

        if (data.ok === false && !(data.error && isObj(data.error) && data.error.code)){
          data.error = data.error && isObj(data.error) ? data.error : {};
          if (!data.error.code) data.error.code = "ERROR";
          if (!data.error.message) data.error.message = "Fel";
        }
        return data;
      }

      // Legacy/raw json => wrap
      return mkOk(data, reqId);

    }catch(e){
      return mkErr("NETWORK_ERROR", "Nät/CORS-fel", { message: safeStr(e && e.message) }, "");
    }
  }

  /* =========================
     BLOCK 07/10 — Init guard
  ========================== */
  function ensureInited(){
    if (!STATE.inited) return mkErr("NOT_INITED", "SDK ej initierad");
    if (!STATE.baseUrl) return mkErr("NO_BASE_URL", "Worker baseUrl saknas");
    return null;
  }

  /* =========================
     BLOCK 08/10 — Public API: init()
  ========================== */
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

  /* =========================
     BLOCK 09/10 — Public API: health()
  ========================== */
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

  /* =========================
     BLOCK 10/10 — Public API: aiGenerate() (MODE endpoint fix + fallback)
  ========================== */
  SDK.aiGenerate = async function(payload){
    const notOk = ensureInited();
    if (notOk) return notOk;

    const p = isObj(payload) ? payload : {};
    const mode = trimStr(p.mode || "training");
    const count = (typeof p.count === "number" && isFinite(p.count)) ? p.count : parseInt(p.count, 10);
    const language = trimStr(p.language || "sv");

    const questionType = trimStr(p.questionType || "auto");
    const feedbackEnabled = !!p.feedbackEnabled;

    // Context måste vara {text:"..."} så worker kan inferera + inte få tom context
    const ctxObj = normalizeContext(p.context);

    if (!(mode === "training" || mode === "document")){
      return mkErr("VALIDATION_ERROR", "mode måste vara 'training' eller 'document'", { mode });
    }
    if (!(count >= 1 && count <= 12)){
      return mkErr("VALIDATION_ERROR", "count måste vara 1–12", { count });
    }
    if (!language){
      return mkErr("VALIDATION_ERROR", "language saknas", {});
    }

    // ✅ mode->endpoint (fixar UI_NO_QUESTIONS i document-läge)
    const primaryPath = (mode === "document") ? "/v1/ai/document" : "/v1/ai/training";
    const primaryUrl = STATE.baseUrl + primaryPath;

    let headers = {
      "Accept": "application/json",
      "Content-Type": "application/json"
    };

    const auth = getAuthHeader();
    if (auth) headers["Authorization"] = auth;

    headers = addClientTraceHeaders(headers);

    // Bygg body. Skicka questionType/feedbackEnabled bara i training-läge.
    const bodyObj = {
      mode,
      count,
      language,
      context: ctxObj
    };

    if (mode === "training"){
      bodyObj.questionType = questionType;
      bodyObj.feedbackEnabled = feedbackEnabled;
    }

    let body = "";
    try{
      body = JSON.stringify(bodyObj);
      const bytes = utf8ByteLen(body);
      if (bytes > (64 * 1024)){
        return mkErr("PAYLOAD_TOO_LARGE", "Payload för stor (max 64KB)", { bytes });
      }
    }catch(e){
      return mkErr("VALIDATION_ERROR", "Kunde inte serialisera payload", { message: safeStr(e && e.message) });
    }

    // 1) Försök med mode-specifik endpoint
    const res1 = await safeFetchJson(primaryUrl, {
      method: "POST",
      mode: "cors",
      headers,
      body
    });

    // 2) Backward compatibility: om worker saknar /document|/training -> fallback till /generate
    if (res1 && res1.ok === false && res1.error && res1.error.code === "NOT_FOUND"){
      const fallbackUrl = STATE.baseUrl + "/v1/ai/generate";
      return await safeFetchJson(fallbackUrl, {
        method: "POST",
        mode: "cors",
        headers,
        body
      });
    }

    return res1;
  };

  // ---------- Export (hardened) ----------
  (function exportSDK(){
    // 1) Sätt/uppgradera via merge (fungerar även om tidigare HRWorkerSDK är låst)
    try{
      const existing = window.HRWorkerSDK;
      if (existing && typeof existing === "object"){
        existing.VERSION = SDK.VERSION;
        existing.init = SDK.init;
        existing.health = SDK.health;
        existing.aiGenerate = SDK.aiGenerate;
      }else{
        window.HRWorkerSDK = SDK;
      }
    }catch(_){}

    // 2) Försök låsa med defineProperty om det är möjligt (men CONFIGURABLE=true så uppdatering inte låser fast permanent)
    try{
      const desc = Object.getOwnPropertyDescriptor(window, "HRWorkerSDK");
      const canDefine = !desc || desc.configurable === true;
      if (canDefine){
        Object.defineProperty(window, "HRWorkerSDK", {
          value: window.HRWorkerSDK || SDK,
          writable: false,
          configurable: true,
          enumerable: true
        });
      }
    }catch(_){}

    // 3) Minimal trace så du ser att filen verkligen körts (inte bara laddats)
    try{
      console.info("[UI-04-WORKER-SDK] loaded v" + SDK.VERSION);
    }catch(_){}
  })();

})();
