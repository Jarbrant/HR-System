// ============================================================
// PRC-BYGGORDER — AO-WORKER-PUBLIC-TOKEN-CORS-01 (PROD v1)
// FIL: worker/index.js
// Mål: Publik API-worker med Bearer-token + strikt CORS (env-styrt)
//
// POLICY (LÅST):
// - Stateless (ingen lagring)
// - Fail-closed
// - Endast JSON
// - Max payload 64KB
// - Logga aldrig payload (endast requestId + felkod)
// - Använd env:
//   - WORKER_TOKEN (secret)
//   - ALLOWED_ORIGIN
//   - REQUIRE_AUTH
//   - AI_ENABLED
//
// Endpoints (MUST):
// - GET  /health
// - POST /ai/generate
// - POST /ai/training (alias)
// - POST /ai/document (alias)
// - OPTIONS * (CORS preflight)
// ============================================================

const MAX_BODY_BYTES = 64 * 1024;

export default {
  async fetch(request, env, ctx) {
    const requestId = makeRequestId();
    const url = new URL(request.url);

    const allowedOrigin = safeStr(env.ALLOWED_ORIGIN).trim();
    const requireAuth = safeStr(env.REQUIRE_AUTH).trim().toLowerCase() === "true";
    const aiEnabled = safeStr(env.AI_ENABLED).trim().toLowerCase() === "true";

    // ---------- ENV GUARD (fail-closed) ----------
    // Om ALLOWED_ORIGIN saknas -> fail-closed med tydlig felkod (ingen wildcard).
    if (!allowedOrigin) {
      console.error("ERR", requestId, "ENV_MISSING");
      return okJSON(
        500,
        {
          ok: false,
          requestId,
          error: { code: "ENV_MISSING", message: "ALLOWED_ORIGIN saknas i env" }
        },
        {
          "Content-Type": "application/json; charset=utf-8"
        }
      );
    }

    // ---------- CORS (STRICT) ----------
    // RULE:
    // - OPTIONS: origin måste matcha ALLOWED_ORIGIN, annars 403 (JSON)
    // - POST AI-endpoints: origin måste matcha ALLOWED_ORIGIN, annars 403 (JSON)
    // - GET /health: tillåt även utan Origin (praktiskt för curl/monitoring),
    //   men om Origin finns måste den matcha ALLOWED_ORIGIN.
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = buildCorsHeaders(origin, allowedOrigin);

    // ---------- OPTIONS (Preflight) ----------
    if (request.method === "OPTIONS") {
      if (origin !== allowedOrigin) {
        return errorJSON(
          403,
          requestId,
          "CORS_FORBIDDEN",
          "Origin är inte tillåten",
          corsHeaders,
          /*log*/ true
        );
      }
      // 204 utan body enligt AO
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ---------- ROUTES ----------
    if (request.method === "GET" && url.pathname === "/health") {
      // Health: om Origin finns måste matcha
      if (origin && origin !== allowedOrigin) {
        return errorJSON(
          403,
          requestId,
          "CORS_FORBIDDEN",
          "Origin är inte tillåten",
          corsHeaders,
          true
        );
      }
      return okJSON(
        200,
        { ok: true, requestId, data: { service: "hr-worker", version: "1.0" } },
        corsHeaders
      );
    }

    // Endast POST för AI
    if (request.method !== "POST") {
      return errorJSON(
        405,
        requestId,
        "METHOD_NOT_ALLOWED",
        "Endast POST tillåtet för AI-endpoints",
        corsHeaders,
        true
      );
    }

    // PATH: /ai/generate + aliases
    const isAIPath =
      url.pathname === "/ai/generate" ||
      url.pathname === "/ai/training" ||
      url.pathname === "/ai/document";

    if (!isAIPath) {
      return errorJSON(
        404,
        requestId,
        "NOT_FOUND",
        "Endpoint finns inte",
        corsHeaders,
        true
      );
    }

    // CORS strikt för AI
    if (origin !== allowedOrigin) {
      return errorJSON(
        403,
        requestId,
        "CORS_FORBIDDEN",
        "Origin är inte tillåten",
        corsHeaders,
        true
      );
    }

    // ---------- AUTH (Bearer) ----------
    if (requireAuth) {
      const token = extractBearerToken(request.headers.get("Authorization") || "");
      if (!token || token !== safeStr(env.WORKER_TOKEN)) {
        return errorJSON(
          401,
          requestId,
          "UNAUTHORIZED",
          "Ogiltig eller saknad token",
          corsHeaders,
          true
        );
      }
    }

    // ---------- CONTENT-TYPE (JSON only) ----------
    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return errorJSON(
        400,
        requestId,
        "BAD_JSON",
        "Endast application/json tillåtet",
        corsHeaders,
        true
      );
    }

    // ---------- PAYLOAD SIZE (<= 64KB) ----------
    // Fail-closed:
    // - Om Content-Length finns och > 64KB => 413
    // - Annars läs raw bytes och stoppa om > 64KB
    const lenHeader = request.headers.get("Content-Length");
    if (lenHeader) {
      const len = Number(lenHeader);
      if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
        return errorJSON(
          413,
          requestId,
          "PAYLOAD_TOO_LARGE",
          "Payload för stor",
          corsHeaders,
          true
        );
      }
    }

    let rawBytes;
    try {
      rawBytes = await request.clone().arrayBuffer();
    } catch {
      return errorJSON(
        400,
        requestId,
        "BAD_JSON",
        "Kunde inte läsa request body",
        corsHeaders,
        true
      );
    }

    if (rawBytes.byteLength > MAX_BODY_BYTES) {
      return errorJSON(
        413,
        requestId,
        "PAYLOAD_TOO_LARGE",
        "Payload för stor",
        corsHeaders,
        true
      );
    }

    // ---------- PARSE JSON ----------
    let body;
    try {
      const txt = new TextDecoder("utf-8").decode(rawBytes);
      body = JSON.parse(txt);
    } catch {
      return errorJSON(
        400,
        requestId,
        "BAD_JSON",
        "Kunde inte tolka JSON",
        corsHeaders,
        true
      );
    }

    if (!isPlainObject(body)) {
      return errorJSON(
        400,
        requestId,
        "VALIDATION_ERROR",
        "Body måste vara ett JSON-objekt",
        corsHeaders,
        true
      );
    }

    // ---------- BACKWARD TOLERANT INPUT ----------
    const mode = safeStr(body.mode || body.type).trim();               // mode | type
    const countRaw = body.count ?? body.n;                             // count | n
    const context = safeStr(body.context || body.prompt).trim();       // context | prompt
    const language = safeStr(body.language || "sv").trim();            // sv|en (default sv)

    // ---------- VALIDATION ----------
    if (mode !== "training" && mode !== "document") {
      return errorJSON(
        400,
        requestId,
        "VALIDATION_ERROR",
        "mode måste vara training eller document",
        corsHeaders,
        true
      );
    }

    let count = Number(countRaw ?? 4);
    if (!Number.isInteger(count) || count < 1 || count > 12) {
      return errorJSON(
        400,
        requestId,
        "VALIDATION_ERROR",
        "count måste vara mellan 1 och 12",
        corsHeaders,
        true
      );
    }

    if (language !== "sv" && language !== "en") {
      return errorJSON(
        400,
        requestId,
        "VALIDATION_ERROR",
        "language måste vara sv eller en",
        corsHeaders,
        true
      );
    }

    if (context.length > 2000) {
      return errorJSON(
        400,
        requestId,
        "VALIDATION_ERROR",
        "context max 2000 tecken",
        corsHeaders,
        true
      );
    }

    // ---------- AI (v1: mock-data om AI_ENABLED=false) ----------
    // Ingen extern AI krävs i v1.
    // Om aiEnabled=true kan FORGE senare byta in riktig upstream (men här: mock även då).
    // Vi håller det deterministiskt för testbarhet.
    let data;
    try {
      data = buildDeterministicMock({ mode, count, language, context, requestId, aiEnabled });
    } catch {
      // Aldrig rå upstream-text
      console.error("ERR", requestId, "UPSTREAM_ERROR");
      return errorJSON(
        502,
        requestId,
        "UPSTREAM_ERROR",
        "AI-tjänsten svarade inte",
        corsHeaders,
        false
      );
    }

    return okJSON(
      200,
      { ok: true, requestId, data },
      corsHeaders
    );
  }
};

// ============================================================
// HELPERS (Fail-closed, no payload logs)
// ============================================================

function buildCorsHeaders(origin, allowedOrigin) {
  // Sätt aldrig wildcard. Vary: Origin för cache-correctness.
  // Om origin inte matchar -> vi lämnar Allow-Origin tomt (och returnerar 403 i guards).
  const allowOrigin = (allowedOrigin && origin === allowedOrigin) ? allowedOrigin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
}

function okJSON(status, payload, corsHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(corsHeaders || {})
    }
  });
}

function errorJSON(status, requestId, code, message, corsHeaders, logIt) {
  // Logga ALDRIG payload
  if (logIt) console.error("ERR", requestId, code);
  return okJSON(status, {
    ok: false,
    requestId,
    error: { code, message }
  }, corsHeaders);
}

function extractBearerToken(authHeader) {
  if (!authHeader) return "";
  const h = authHeader.trim();
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeStr(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

function makeRequestId() {
  // Cloudflare Workers stödjer crypto.randomUUID i modern runtime.
  try {
    return "req_" + crypto.randomUUID();
  } catch {
    // Fail-safe fallback (deterministisk nog för loggning, inte security)
    return "req_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }
}

// ============================================================
// Deterministic Mock AI (v1)
// - Om AI_ENABLED=false -> mock-data (krav)
// - Deterministiskt: baserat på requestId + mode + count + language
// ============================================================

function buildDeterministicMock({ mode, count, language, context, requestId, aiEnabled }) {
  // Vi ignorerar aiEnabled för innehållet i v1 och håller alltid mock deterministisk.
  const seed = hash32(`${requestId}|${mode}|${count}|${language}|${context.slice(0, 64)}`);

  const title =
    mode === "training"
      ? (language === "sv" ? "Ny utbildning" : "New training")
      : (language === "sv" ? "Nytt dokument" : "New document");

  const description =
    language === "sv"
      ? "Deterministiskt mock-svar (v1)."
      : "Deterministic mock response (v1).";

  const goals =
    mode === "training"
      ? (language === "sv"
          ? ["Förstå grunderna", "Utföra korrekt", "Följa rutiner"]
          : ["Understand basics", "Execute correctly", "Follow routines"])
      : [];

  const blocks = [];
  for (let i = 0; i < count; i++) {
    const n = (seed + i * 2654435761) >>> 0;
    const diff = 1 + (n % 5);
    const mins = 3 + (n % 8);
    const tag = mode === "training" ? "training" : "document";

    blocks.push({
      type: "info",
      title: language === "sv" ? `Block ${i + 1}` : `Block ${i + 1}`,
      text: language === "sv" ? "Exempeltext (mock)." : "Example text (mock).",
      meta: {
        difficulty: diff,
        mins,
        tags: [tag]
      }
    });
  }

  return { title, description, goals, blocks };
}

// Simple 32-bit hash (deterministisk)
function hash32(str) {
  let h = 2166136261 >>> 0; // FNV-1a base
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
