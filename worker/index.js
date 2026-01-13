// ============================================================
// PRC-MASTER-BYGGORDER — MASTER-AO-WORKER-STACK-01 (PROD v1.0)
// FIL: worker/index.js
// Syfte: Versionerad API-worker (v1 krävs), Bearer-token (env), strikt CORS (env)
//
// POLICY (LÅST):
// - Stateless (ingen lagring)
// - Fail-closed
// - Endast JSON
// - Max payload 64KB
// - Logga aldrig payload (endast requestId + felkod)
// - Env (exakt): WORKER_TOKEN (secret), ALLOWED_ORIGIN, REQUIRE_AUTH, AI_ENABLED
//
// VERSIONERING (LÅST):
// - Endast /v1/* är giltigt
// - /v2/* => 410 VERSION_NOT_AVAILABLE
// - Alla paths utan version => 404 "API-version saknas. Använd /v1/..."
//
// ENDPOINTS (MUST, v1):
// - GET  /v1/health
// - POST /v1/ai/generate
// - POST /v1/ai/training (alias)
// - POST /v1/ai/document (alias)
// - OPTIONS /v1/* (CORS preflight)
// ============================================================

const MAX_BODY_BYTES = 64 * 1024;

export default {
  async fetch(request, env, ctx) {
    const requestId = makeRequestId();
    const url = new URL(request.url);

    const allowedOrigin = safeStr(env && env.ALLOWED_ORIGIN).trim();
    const requireAuth = safeStr(env && env.REQUIRE_AUTH).trim().toLowerCase() === "true";
    const aiEnabled = safeStr(env && env.AI_ENABLED).trim().toLowerCase() === "true";
    const workerToken = safeStr(env && env.WORKER_TOKEN).trim();

    // ---------- ENV GUARD (fail-closed) ----------
    if (!allowedOrigin) {
      console.error("ERR", requestId, "ENV_MISSING");
      return okJSON(
        500,
        {
          ok: false,
          requestId,
          error: { code: "ENV_MISSING", message: "ALLOWED_ORIGIN saknas i env" }
        },
        { "Content-Type": "application/json; charset=utf-8" }
      );
    }

    // ---------- VERSION BLOCK (/v2 reserved) ----------
    if (url.pathname === "/v2" || url.pathname.startsWith("/v2/")) {
      console.error("ERR", requestId, "VERSION_NOT_AVAILABLE");
      return errorJSON(
        410,
        requestId,
        "VERSION_NOT_AVAILABLE",
        "API-version /v2 är reserverad och inte tillgänglig",
        { "Content-Type": "application/json; charset=utf-8" },
        false
      );
    }

    // ---------- REQUIRE /v1 ----------
    const isV1 = (url.pathname === "/v1" || url.pathname.startsWith("/v1/"));
    if (!isV1) {
      return errorJSON(
        404,
        requestId,
        "NOT_FOUND",
        "API-version saknas. Använd /v1/...",
        { "Content-Type": "application/json; charset=utf-8" },
        false
      );
    }

    const origin = request.headers.get("Origin") || "";
    const corsHeaders = buildCorsHeaders(origin, allowedOrigin);

    // ---------- OPTIONS (Preflight) /v1/* ----------
    if (request.method === "OPTIONS") {
      // strict: Origin måste matcha exakt, annars 403 JSON
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
      // 204 utan body enligt AO
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ---------- ROUTES (v1) ----------
    if (request.method === "GET" && url.pathname === "/v1/health") {
      // Health: tillåt utan Origin, men om Origin finns måste matcha
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
        { ok: true, requestId, data: { service: "hr-worker", version: "v1" } },
        corsHeaders
      );
    }

    // AI endpoints: endast POST
    const isAIPath =
      url.pathname === "/v1/ai/generate" ||
      url.pathname === "/v1/ai/training" ||
      url.pathname === "/v1/ai/document";

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

    // CORS strikt för AI: Origin måste matcha exakt
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
      if (!workerToken) {
        console.error("ERR", requestId, "ENV_MISSING");
        return errorJSON(
          500,
          requestId,
          "ENV_MISSING",
          "WORKER_TOKEN saknas i env",
          corsHeaders,
          false
        );
      }
      const token = extractBearerToken(request.headers.get("Authorization") || "");
      if (!token || token !== workerToken) {
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
    // UI kan skicka mode/type, count/n, context/prompt
    const mode = safeStr(body.mode || body.type).trim();
    const countRaw = body.count ?? body.n;
    const context = safeStr(body.context || body.prompt || "").trim();
    const language = safeStr(body.language || "sv").trim(); // sv|en

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

    // ---------- AI (v1: deterministisk mock) ----------
    // AI_ENABLED är env-styrt men i v1 levererar vi deterministisk mock oavsett,
    // för testbarhet. (aiEnabled finns kvar för framtida upstream, men påverkar inte payload i v1.)
    let data;
    try {
      data = buildDeterministicMock({ mode, count, language, context });
    } catch {
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
  // Aldrig wildcard. Vary: Origin för cache-correctness.
  // Om origin inte matchar -> tom Allow-Origin (och guards returnerar 403)
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
  try {
    return "req_" + crypto.randomUUID();
  } catch {
    return "req_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }
}

// ============================================================
// Deterministic Mock AI (v1)
// - Deterministiskt baserat på input (inte requestId)
// ============================================================

function buildDeterministicMock({ mode, count, language, context }) {
  const seed = hash32(`${mode}|${count}|${language}|${(context || "").slice(0, 128)}`);

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
    const tag = (mode === "training") ? "training" : "document";

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

function hash32(str) {
  let h = 2166136261 >>> 0; // FNV-1a base
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
