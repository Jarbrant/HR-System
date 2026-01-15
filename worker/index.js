// ============================================================
// PRC-BYGGORDER — AO-WORKER-PUBLIC-TOKEN-CORS-01 (PROD v1.2)
// FIL: worker/index.js
// Mål: Publik API-worker med Bearer-token + strikt CORS (env-styrt)
//
// NYTT i v1.2 (RULESETS + FORMATS, bakåtkompat):
// - Stöd för body.format (training-blocks|question|task|document) + body.subject (swedish|math|generic)
// - Stöd för body.difficultyHint (auto|1..5)
// - Genererar block med typanpassade fält: info.text, task.instruction+deliverable, question.question+answerKey
// - Läsning av rulesets via bundlade JSON-importer (worker/rulesets/**)
// - Fortfarande stateless, fail-closed, JSON-only, max 64KB, logga aldrig payload
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
// Endpoints (MUST) — versionerade:
// - GET  /v1/health
// - POST /v1/ai/generate
// - POST /v1/ai/training (alias)
// - POST /v1/ai/document (alias)
// - OPTIONS * (CORS preflight)
// ============================================================

/**
 * OBS: JSON-importer kräver att din Worker build/bundler stödjer det.
 * Wrangler v3+ med modules brukar göra det.
 */
import INDEX from "./rulesets/index.json";
import GLOBAL from "./rulesets/global.json";
import SWEDISH from "./rulesets/swedish.json";
import MATH from "./rulesets/math.json";
import QUESTION from "./rulesets/question.json";
import TASK from "./rulesets/task.json";
import TRAINING_BLOCKS from "./rulesets/training-blocks.json";

const MAX_BODY_BYTES = 64 * 1024;

export default {
  async fetch(request, env) {
    const requestId = makeRequestId();
    const url = new URL(request.url);

    const allowedOrigin = safeStr(env.ALLOWED_ORIGIN).trim();
    const requireAuth = safeStr(env.REQUIRE_AUTH).trim().toLowerCase() === "true";
    const aiEnabled = safeStr(env.AI_ENABLED).trim().toLowerCase() === "true";

    // ---------- ENV GUARD (fail-closed) ----------
    if (!allowedOrigin) {
      console.error("ERR", requestId, "ENV_MISSING");
      return okJSON(
        500,
        { ok: false, requestId, error: { code: "ENV_MISSING", message: "ALLOWED_ORIGIN saknas i env" } },
        { "Content-Type": "application/json; charset=utf-8" }
      );
    }

    const origin = request.headers.get("Origin") || "";
    const corsHeaders = buildCorsHeaders(origin, allowedOrigin);

    // ---------- OPTIONS (Preflight) ----------
    if (request.method === "OPTIONS") {
      if (origin !== allowedOrigin) {
        return errorJSON(403, requestId, "CORS_FORBIDDEN", "Origin är inte tillåten", corsHeaders, true);
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const path = url.pathname || "/";

    // Health: tillåt utan Origin, men om Origin finns måste matcha
    if (request.method === "GET" && path === "/v1/health") {
      if (origin && origin !== allowedOrigin) {
        return errorJSON(403, requestId, "CORS_FORBIDDEN", "Origin är inte tillåten", corsHeaders, true);
      }
      return okJSON(
        200,
        {
          ok: true,
          requestId,
          data: {
            service: "hr-worker",
            version: "1.2",
            v: "v1",
            rulesets: { ok: true }
          }
        },
        corsHeaders
      );
    }

    // Endast POST för AI
    if (request.method !== "POST") {
      return errorJSON(405, requestId, "METHOD_NOT_ALLOWED", "Endast POST tillåtet för AI-endpoints", corsHeaders, true);
    }

    // v1 AI endpoints + aliases
    const isAIPath =
      path === "/v1/ai/generate" ||
      path === "/v1/ai/training" ||
      path === "/v1/ai/document";

    if (!isAIPath) {
      return errorJSON(404, requestId, "NOT_FOUND", "Endpoint finns inte", corsHeaders, true);
    }

    // CORS strikt för AI
    if (origin !== allowedOrigin) {
      return errorJSON(403, requestId, "CORS_FORBIDDEN", "Origin är inte tillåten", corsHeaders, true);
    }

    // ---------- AUTH (Bearer) ----------
    if (requireAuth) {
      const token = extractBearerToken(request.headers.get("Authorization") || "");
      const expected = safeStr(env.WORKER_TOKEN);
      if (!token || !expected || token !== expected) {
        return errorJSON(401, requestId, "UNAUTHORIZED", "Ogiltig eller saknad token", corsHeaders, true);
      }
    }

    // ---------- CONTENT-TYPE (JSON only) ----------
    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return errorJSON(400, requestId, "BAD_JSON", "Endast application/json tillåtet", corsHeaders, true);
    }

    // ---------- PAYLOAD SIZE (<= 64KB) ----------
    const lenHeader = request.headers.get("Content-Length");
    if (lenHeader) {
      const len = Number(lenHeader);
      if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
        return errorJSON(413, requestId, "PAYLOAD_TOO_LARGE", "Payload för stor", corsHeaders, true);
      }
    }

    let rawBytes;
    try {
      rawBytes = await request.clone().arrayBuffer();
    } catch {
      return errorJSON(400, requestId, "BAD_JSON", "Kunde inte läsa request body", corsHeaders, true);
    }

    if (rawBytes.byteLength > MAX_BODY_BYTES) {
      return errorJSON(413, requestId, "PAYLOAD_TOO_LARGE", "Payload för stor", corsHeaders, true);
    }

    // ---------- PARSE JSON ----------
    let body;
    try {
      const txt = new TextDecoder("utf-8").decode(rawBytes);
      body = JSON.parse(txt);
    } catch {
      return errorJSON(400, requestId, "BAD_JSON", "Kunde inte tolka JSON", corsHeaders, true);
    }

    if (!isPlainObject(body)) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "Body måste vara ett JSON-objekt", corsHeaders, true);
    }

    // ---------- BACKWARD TOLERANT INPUT ----------
    const mode = safeStr(body.mode || body.type).trim();               // mode | type
    const countRaw = body.count ?? body.n;                             // count | n
    const context = safeStr(body.context || body.prompt).trim();       // context | prompt
    const language = safeStr(body.language || "sv").trim();            // sv|en (default sv)

    // NYTT (optional)
    const format = safeStr(body.format || "").trim();                  // training-blocks|question|task|document
    const subject = safeStr(body.subject || "").trim();                // swedish|math|generic
    const difficultyHint = body.difficultyHint ?? body.difficulty;     // auto|1..5

    // ---------- VALIDATION ----------
    if (mode !== "training" && mode !== "document") {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "mode måste vara training eller document", corsHeaders, true);
    }

    let count = Number(countRaw ?? 4);
    if (!Number.isInteger(count) || count < 1 || count > 12) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "count måste vara mellan 1 och 12", corsHeaders, true);
    }

    if (language !== "sv" && language !== "en") {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "language måste vara sv eller en", corsHeaders, true);
    }

    if (context.length > 2000) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "context max 2000 tecken", corsHeaders, true);
    }

    // ---------- AI (v1.2: ruleset-driven mock/generator) ----------
    let data;
    try {
      data = buildRulesetDrivenMock({
        mode,
        count,
        language,
        context,
        requestId,
        aiEnabled,
        format,
        subject,
        difficultyHint
      });
    } catch {
      console.error("ERR", requestId, "UPSTREAM_ERROR");
      return errorJSON(502, requestId, "UPSTREAM_ERROR", "AI-tjänsten svarade inte", corsHeaders, false);
    }

    return okJSON(200, { ok: true, requestId, data }, corsHeaders);
  }
};

// ============================================================
// HELPERS (Fail-closed, no payload logs)
// ============================================================

function buildCorsHeaders(origin, allowedOrigin) {
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
  if (logIt) console.error("ERR", requestId, code);
  return okJSON(status, { ok: false, requestId, error: { code, message } }, corsHeaders);
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

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  const i = Math.floor(x);
  return Math.max(min, Math.min(max, i));
}

function pickDifficulty(difficultyHint, seedN) {
  const s = safeStr(difficultyHint).toLowerCase().trim();
  if (s === "auto" || s === "") return 1 + (seedN % 5);
  const n = Number(difficultyHint);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  return 1 + (seedN % 5);
}

function hash32(str) {
  let h = 2166136261 >>> 0; // FNV-1a base
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ============================================================
// RULESET-DRIVEN GENERATOR (v1.2)
// ============================================================

function normalizeSubject(subject) {
  const s = safeStr(subject).toLowerCase().trim();
  if (s === "swedish" || s === "svenska") return "swedish";
  if (s === "math" || s === "matte") return "math";
  return "generic";
}

function normalizeFormat(format, mode) {
  const f = safeStr(format).toLowerCase().trim();
  if (f === "question" || f === "questions") return "question";
  if (f === "task" || f === "tasks") return "task";
  if (f === "document") return "document";
  if (f === "training-blocks" || f === "training" || f === "blocks") return "training-blocks";
  // Default: training uses training-blocks, document uses document
  return (mode === "document") ? "document" : "training-blocks";
}

function getRulesetBundle(subject) {
  const s = normalizeSubject(subject);
  const subj = (s === "math") ? MATH : (s === "swedish") ? SWEDISH : null;

  return {
    index: INDEX || {},
    global: GLOBAL || {},
    subject: subj || {},
    formats: {
      "question": QUESTION || {},
      "task": TASK || {},
      "training-blocks": TRAINING_BLOCKS || {}
    }
  };
}

function buildRulesetDrivenMock({ mode, count, language, context, requestId, aiEnabled, format, subject, difficultyHint }) {
  const seed = hash32(`${requestId}|${mode}|${count}|${language}|${context.slice(0, 96)}|${format}|${subject}|${safeStr(difficultyHint)}`);

  const fmt = normalizeFormat(format, mode);
  const subj = normalizeSubject(subject);

  const bundle = getRulesetBundle(subj);

  const title =
    mode === "training"
      ? (language === "sv" ? "Ny utbildning" : "New training")
      : (language === "sv" ? "Nytt dokument" : "New document");

  const description =
    language === "sv"
      ? (aiEnabled ? "Regelstyrt genererat innehåll." : "AI avstängd (mock).")
      : (aiEnabled ? "Ruleset-driven generated content." : "AI disabled (mock).");

  const goals =
    mode === "training"
      ? (language === "sv"
        ? ["Förstå grunderna", "Tillämpa korrekt", "Reflektera över varför"]
        : ["Understand basics", "Apply correctly", "Reflect on why"])
      : [];

  // Generator: välj blocktyper per format
  const blocks = [];
  for (let i = 0; i < count; i++) {
    const n = (seed + i * 2654435761) >>> 0;
    const diff = pickDifficulty(difficultyHint, n);
    const mins = 3 + (n % 8);

    if (fmt === "question") {
      blocks.push(genQuestionBlock({ i, language, context, subj, diff, mins, n, bundle }));
      continue;
    }
    if (fmt === "task") {
      blocks.push(genTaskBlock({ i, language, context, subj, diff, mins, n, bundle }));
      continue;
    }
    if (fmt === "document" || mode === "document") {
      blocks.push(genInfoBlock({ i, language, context, subj, diff, mins, n, bundle, docMode: true }));
      continue;
    }

    // training-blocks: varva info/task/question
    const pick = n % 3;
    if (pick === 0) blocks.push(genInfoBlock({ i, language, context, subj, diff, mins, n, bundle, docMode: false }));
    else if (pick === 1) blocks.push(genTaskBlock({ i, language, context, subj, diff, mins, n, bundle }));
    else blocks.push(genQuestionBlock({ i, language, context, subj, diff, mins, n, bundle }));
  }

  return { title, description, goals, blocks };
}

function genInfoBlock({ i, language, context, subj, diff, mins, n }) {
  const topicSv =
    subj === "math" ? "Matematik" :
    subj === "swedish" ? "Svenska" :
    "Kunskap";

  const title = language === "sv" ? `Teori ${i + 1}: ${topicSv}` : `Theory ${i + 1}`;
  const text =
    language === "sv"
      ? `Kort teori kopplad till ämnet (${topicSv}).\n\nUtgå från detta sammanhang:\n${context || "—"}`
      : `Short theory.\n\nContext:\n${context || "—"}`;

  return {
    type: "info",
    title,
    text,
    meta: { difficulty: diff, mins, tags: ["info", subj] }
  };
}

function genTaskBlock({ i, language, context, subj, diff, mins, n }) {
  const title = language === "sv" ? `Uppgift ${i + 1}` : `Task ${i + 1}`;
  const instruction =
    language === "sv"
      ? (subj === "math"
          ? "Räkna ut och visa dina steg. Svara tydligt."
          : subj === "swedish"
            ? "Skriv en kort text och motivera dina val."
            : "Utför uppgiften och beskriv hur du tänkte.")
      : "Complete the task and explain your reasoning.";

  const deliverable =
    language === "sv"
      ? "Lämna in: (1) ditt svar, (2) en kort motivering, (3) ev. mellanled."
      : "Submit: (1) your answer, (2) brief reasoning, (3) intermediate steps if any.";

  const hint =
    language === "sv"
      ? `Utgå från detta sammanhang:\n${context || "—"}`
      : `Context:\n${context || "—"}`;

  return {
    type: "task",
    title,
    instruction: `${instruction}\n\n${hint}`,
    deliverable,
    meta: { difficulty: diff, mins, tags: ["task", subj] }
  };
}

function genQuestionBlock({ i, language, context, subj, diff, mins, n }) {
  const title = language === "sv" ? `Fråga ${i + 1}` : `Question ${i + 1}`;

  const question =
    language === "sv"
      ? (subj === "math"
          ? "Vad blir 7 + 5? (Svara med ett tal.)"
          : subj === "swedish"
            ? "Vilket ord är ett verb i meningen: 'Hon springer snabbt'?"
            : "Vad är den viktigaste poängen i teorin du nyss läste?")
      : "What is the key point?";

  const answerKey =
    language === "sv"
      ? (subj === "math"
          ? "12"
          : subj === "swedish"
            ? "springer"
            : "En korrekt sammanfattning av huvudpoängen.")
      : "A correct summary of the main point.";

  const ctxLine =
    language === "sv"
      ? `\n\n(Använd detta sammanhang om relevant: ${context || "—"})`
      : `\n\n(Context: ${context || "—"})`;

  return {
    type: "question",
    title,
    question: question + ctxLine,
    answerKey,
    meta: { difficulty: diff, mins, tags: ["question", subj] }
  };
}
