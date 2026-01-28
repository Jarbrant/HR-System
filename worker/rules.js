// ============================================================
// PRC-MASTER-BYGGORDER — MASTER-AO-WORKER-STACK-01 (PROD v1.1 AUTOPATCH)
// FIL: worker/rules.js
// Syfte: Guards + response helpers + requestId + low-level utils
//
// POLICY (LÅST):
// - Stateless
// - Fail-closed
// - Endast JSON
// - Max payload 64KB
// - Logga aldrig payload (endast requestId + felkod)
// - CORS strikt: aldrig wildcard
// ============================================================

export const MAX_BODY_BYTES = 64 * 1024;

// ------------------------------
// RequestId
// ------------------------------
export function makeRequestId() {
  try {
    // Cloudflare Workers stödjer crypto.randomUUID i modern runtime
    return "req_" + crypto.randomUUID();
  } catch {
    return "req_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }
}

// ------------------------------
// Safe primitives
// ------------------------------
export function safeStr(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ------------------------------
// JSON responses (standardformat)
// ------------------------------
// Backwards compatible: okJSON(status, payload, extraHeaders)
// + ny optional: okJSON(status, payload, extraHeaders, requestId)
export function okJSON(status, payload, extraHeaders, requestId) {
  const rid = safeStr(requestId || "").trim();

  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(rid ? { "X-Request-Id": rid, "X-HR-Request-Id": rid } : {}),
      ...(extraHeaders || {})
    }
  });
}

// Backwards compatible signature:
// errorJSON(status, requestId, code, message, extraHeaders, logIt)
export function errorJSON(status, requestId, code, message, extraHeaders, logIt) {
  // Logga ALDRIG payload
  if (logIt) console.error("ERR", safeStr(requestId), safeStr(code));

  const rid = safeStr(requestId);
  const c = safeStr(code);
  const m = safeStr(message);

  // Inkludera errorCode på toppnivå (kompat med index.js)
  return okJSON(
    status,
    {
      ok: false,
      requestId: rid,
      errorCode: c,
      error: { code: c, message: m }
    },
    extraHeaders,
    rid
  );
}

// ------------------------------
// CORS (strict, no wildcard)
// ------------------------------
export function buildCorsHeaders(origin, allowedOrigin) {
  const o = safeStr(origin).trim();
  const allowed = safeStr(allowedOrigin).trim();

  // Strict: endast exakt match får en Allow-Origin. Annars tom sträng.
  const allowOrigin = (allowed && o && o === allowed) ? allowed : "";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    // Preflight måste matcha exakt header-namn som klienten använder
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Hr-Sdk, X-Hr-Client, X-HR-SDK, X-HR-Client, X-HR-CLIENT",
    "Vary": "Origin"
  };
}

export function ensureEnvOr500({ requestId, allowedOrigin }) {
  const ao = safeStr(allowedOrigin).trim();
  if (!ao) {
    console.error("ERR", safeStr(requestId), "ENV_MISSING");
    return {
      ok: false,
      response: errorJSON(
        500,
        requestId,
        "ENV_MISSING",
        "ALLOWED_ORIGIN saknas i env",
        { "Content-Type": "application/json; charset=utf-8" },
        false
      )
    };
  }
  return { ok: true };
}

export function guardCorsPreflightOr403({ request, requestId, allowedOrigin }) {
  const origin = request.headers.get("Origin") || "";
  const corsHeaders = buildCorsHeaders(origin, allowedOrigin);

  // Preflight måste ha origin som exakt matchar
  if (safeStr(origin).trim() !== safeStr(allowedOrigin).trim()) {
    return {
      ok: false,
      corsHeaders,
      response: errorJSON(
        403,
        requestId,
        "CORS_FORBIDDEN",
        "Origin är inte tillåten",
        corsHeaders,
        true
      )
    };
  }

  // 204 utan body enligt AO
  return { ok: true, corsHeaders, response: new Response(null, { status: 204, headers: corsHeaders }) };
}

export function guardCorsForHealthOr403({ request, requestId, allowedOrigin }) {
  const origin = request.headers.get("Origin") || "";
  const corsHeaders = buildCorsHeaders(origin, allowedOrigin);

  // Health: tillåt utan Origin (curl), men om Origin finns måste matcha
  if (origin && safeStr(origin).trim() !== safeStr(allowedOrigin).trim()) {
    return {
      ok: false,
      corsHeaders,
      response: errorJSON(
        403,
        requestId,
        "CORS_FORBIDDEN",
        "Origin är inte tillåten",
        corsHeaders,
        true
      )
    };
  }

  return { ok: true, corsHeaders };
}

export function guardCorsForAIOr403({ request, requestId, allowedOrigin }) {
  const origin = request.headers.get("Origin") || "";
  const corsHeaders = buildCorsHeaders(origin, allowedOrigin);

  // AI: origin måste matcha exakt
  if (safeStr(origin).trim() !== safeStr(allowedOrigin).trim()) {
    return {
      ok: false,
      corsHeaders,
      response: errorJSON(
        403,
        requestId,
        "CORS_FORBIDDEN",
        "Origin är inte tillåten",
        corsHeaders,
        true
      )
    };
  }

  return { ok: true, corsHeaders };
}

// ------------------------------
// Auth (Bearer)
// ------------------------------
export function extractBearerToken(authHeaderRaw) {
  const h = safeStr(authHeaderRaw).trim();
  if (!h) return "";
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

export function guardAuthOr401({ request, requestId, requireAuth, workerToken, corsHeaders }) {
  if (!requireAuth) return { ok: true };

  const tokenEnv = safeStr(workerToken).trim();
  if (!tokenEnv) {
    console.error("ERR", safeStr(requestId), "ENV_MISSING");
    return {
      ok: false,
      response: errorJSON(
        500,
        requestId,
        "ENV_MISSING",
        "WORKER_TOKEN saknas i env",
        corsHeaders,
        false
      )
    };
  }

  const token = extractBearerToken(request.headers.get("Authorization") || "");
  if (!token || token !== tokenEnv) {
    return {
      ok: false,
      response: errorJSON(
        401,
        requestId,
        "UNAUTHORIZED",
        "Ogiltig eller saknad token",
        corsHeaders,
        true
      )
    };
  }

  return { ok: true };
}

// ------------------------------
// JSON-only + Payload size
// ------------------------------
export function guardJsonContentTypeOr400({ request, requestId, corsHeaders }) {
  const ct = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return {
      ok: false,
      response: errorJSON(
        400,
        requestId,
        "BAD_JSON",
        "Endast application/json tillåtet",
        corsHeaders,
        true
      )
    };
  }
  return { ok: true };
}

export function guardContentLengthOr413({ request, requestId, corsHeaders }) {
  const lenHeader = request.headers.get("Content-Length");
  if (!lenHeader) return { ok: true };

  const len = Number(lenHeader);
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorJSON(
        413,
        requestId,
        "PAYLOAD_TOO_LARGE",
        "Payload för stor",
        corsHeaders,
        true
      )
    };
  }

  return { ok: true };
}

export async function readBodyBytesOrErr({ request, requestId, corsHeaders }) {
  let rawBytes;
  try {
    rawBytes = await request.clone().arrayBuffer();
  } catch {
    return {
      ok: false,
      response: errorJSON(
        400,
        requestId,
        "BAD_JSON",
        "Kunde inte läsa request body",
        corsHeaders,
        true
      )
    };
  }

  if (rawBytes.byteLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorJSON(
        413,
        requestId,
        "PAYLOAD_TOO_LARGE",
        "Payload för stor",
        corsHeaders,
        true
      )
    };
  }

  return { ok: true, bytes: rawBytes };
}

export function parseJsonOrErr({ bytes, requestId, corsHeaders }) {
  try {
    const txt = new TextDecoder("utf-8").decode(bytes);
    const obj = JSON.parse(txt);
    return { ok: true, json: obj };
  } catch {
    return {
      ok: false,
      response: errorJSON(
        400,
        requestId,
        "BAD_JSON",
        "Kunde inte tolka JSON",
        corsHeaders,
        true
      )
    };
  }
}
