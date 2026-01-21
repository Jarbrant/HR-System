// ============================================================
// PRC-BYGGORDER — AO-WORKER-PUBLIC-TOKEN-CORS-01 (PROD v1.3)
// FIL: worker/index.js
// PATCH: AO-WORKER-AI-ITEMS-01 (HOTFIX v1.3.1)
//
// Mål (P0):
// - Returnera data.items[] (UI/pages/trainings/04-contract.js kräver items)
// - Generera "riktiga" frågor som kan auto-rättas (MCQ: choices + correctChoiceId)
// - Behåll legacy: data.blocks + root.blocks för bakåtkomp.
//
// POLICY (LÅST):
// - Stateless (ingen lagring)
// - Fail-closed
// - Endast JSON
// - Max payload 64KB
// - Logga aldrig payload (endast requestId + felkod)
// - CORS strikt: aldrig wildcard
//
// Endpoints (MUST) — versionerade:
// - GET  /v1/health
// - GET  /v1/version
// - POST /v1/ai/generate
// - POST /v1/ai/training (alias)
// - POST /v1/ai/document (alias)
// - OPTIONS * (CORS preflight)
//
// Ändringslogg (max 8 rader):
// - v1.3.1: data.items[] läggs till (UI-kontrakt kräver items).
// - v1.3.1: question-items blir MCQ (choices + correctChoiceId + answer/correct).
// - v1.3.1: items mappas deterministiskt från blocks (legacy kvar).
// ============================================================

/**
 * OBS: JSON-importer kräver Wrangler "modules" (vilket du kör).
 * Om någon av dessa saknas i repo får du "Could not resolve" vid deploy.
 */
import INDEX from "../ai-rules/index.json";
import GLOBAL from "../ai-rules/v1/global.json";

import SWEDISH from "../ai-rules/v1/subjects/swedish.json";
import MATH from "../ai-rules/v1/subjects/math.json";

import QUESTION from "../ai-rules/v1/formats/question.json";
import TASK from "../ai-rules/v1/formats/task.json";
import TRAINING_BLOCKS from "../ai-rules/v1/formats/training-blocks.json";

// Valfri: om du har denna fil, behåll importen. Om du INTE har den: kommentera bort raden.
import DOCUMENT from "../ai-rules/v1/formats/document.json";

const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.3.1";

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

    // ---------- GET /v1/health ----------
    // Tillåt utan Origin, men om Origin finns måste matcha
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
            version: VERSION,
            v: "v1",
            rulesets: { ok: true, base: "ai-rules" }
          }
        },
        corsHeaders
      );
    }

    // ---------- GET /v1/version ----------
    if (request.method === "GET" && path === "/v1/version") {
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
            version: VERSION,
            build: "wrangler",
            rulesBase: "worker/ai-rules"
          }
        },
        corsHeaders
      );
    }

    // ---------- Endast POST för AI ----------
    if (request.method !== "POST") {
      return errorJSON(405, requestId, "METHOD_NOT_ALLOWED", "Endast POST tillåtet för AI-endpoints", corsHeaders, true);
    }

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
    const modeRaw = safeStr(body.mode || body.type).trim();
    const mode = normalizeMode(modeRaw);

    const countRaw = body.count ?? body.n;
    const context = safeStr(body.context || body.prompt || "").trim();
    const language = safeStr(body.language || "sv").trim();

    // optional
    const format = safeStr(body.format || "").trim();
    const subject = safeStr(body.subject || "").trim();
    const difficultyHint = body.difficultyHint ?? body.difficulty;

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

    // Behåll 4000 här (SDK trunkar 4000). Harmoniseras i senare AO.
    if (context.length > 4000) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "context max 4000 tecken", corsHeaders, true);
    }

    // ---------- AI (ruleset-driven generator / mock) ----------
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

    // P0: UI-kontrakt kräver data.items[]
    const items = blocksToItems(data && Array.isArray(data.blocks) ? data.blocks : []);

    // Fail-closed: om items saknas => validation error
    if (!Array.isArray(items) || items.length <= 0) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "AI-resultat saknar items[]", corsHeaders, true);
    }

    const outData = { ...(data || {}), items };

    // Legacy: root.blocks + data.blocks kvar
    return okJSON(200, { ok: true, requestId, data: outData, blocks: outData.blocks, mode }, corsHeaders);
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

// ------------------------------------------------------------
// MODE NORMALIZER (fixar "ai training" etc)
// ------------------------------------------------------------
function normalizeMode(modeRaw) {
  const s = safeStr(modeRaw).toLowerCase().trim();
  if (!s) return "";
  if (s === "training" || s === "document") return s;
  if (s.includes("train")) return "training";
  if (s.includes("doc")) return "document";
  return s;
}

// ============================================================
// RULESET-DRIVEN GENERATOR
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
  return (mode === "document") ? "document" : "training-blocks";
}

function getRulesetBundle(subject) {
  const s = normalizeSubject(subject);
  const subj = (s === "math") ? (MATH || {}) : (s === "swedish") ? (SWEDISH || {}) : {};

  return {
    index: INDEX || {},
    global: GLOBAL || {},
    subject: subj,
    formats: {
      question: QUESTION || {},
      task: TASK || {},
      "training-blocks": TRAINING_BLOCKS || {},
      document: (typeof DOCUMENT !== "undefined" && DOCUMENT) ? DOCUMENT : {}
    }
  };
}

function buildRulesetDrivenMock({ mode, count, language, context, requestId, aiEnabled, format, subject, difficultyHint }) {
  const seed = hash32(`${requestId}|${mode}|${count}|${language}|${context.slice(0, 96)}|${format}|${subject}|${safeStr(difficultyHint)}`);

  const fmt = normalizeFormat(format, mode);
  const subj = normalizeSubject(subject);

  // Laddat (för vidareutbyggnad)
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

function genInfoBlock({ i, language, context, subj, diff, mins }) {
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

function genTaskBlock({ i, language, context, subj, diff, mins }) {
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

  // MCQ (auto-rättningsbar)
  let qText = "";
  let choices = [];
  let correctChoiceId = "c1";
  let rationale = "";

  if (language === "sv") {
    if (subj === "math") {
      qText = "Vad blir 7 + 5?";
      choices = [
        { id: "c1", text: "12" },
        { id: "c2", text: "11" },
        { id: "c3", text: "13" }
      ];
      correctChoiceId = "c1";
      rationale = "7 + 5 = 12.";
    } else if (subj === "swedish") {
      qText = "Vilket ord är ett verb i meningen: 'Hon springer snabbt'?";
      choices = [
        { id: "c1", text: "springer" },
        { id: "c2", text: "snabbt" },
        { id: "c3", text: "hon" }
      ];
      correctChoiceId = "c1";
      rationale = "Verbet beskriver handlingen (springer).";
    } else {
      qText = "Vilket är ett bra första steg när du ska coacha en medarbetare?";
      choices = [
        { id: "c1", text: "Ställa öppna frågor och lyssna" },
        { id: "c2", text: "Ge direkt order utan dialog" },
        { id: "c3", text: "Undvika att prata om målet" }
      ];
      correctChoiceId = "c1";
      rationale = "Coachning börjar ofta med att förstå nuläge och behov.";
    }
  } else {
    qText = "What is the best first step in coaching?";
    choices = [
      { id: "c1", text: "Ask open questions and listen" },
      { id: "c2", text: "Give orders without dialogue" },
      { id: "c3", text: "Avoid discussing goals" }
    ];
    correctChoiceId = "c1";
    rationale = "Coaching starts by understanding the situation.";
  }

  // Kontext (kort, utan att “svälla”)
  const ctxLine =
    language === "sv"
      ? (context ? `\n\n(Kontext: ${context.slice(0, 240)})` : "")
      : (context ? `\n\n(Context: ${context.slice(0, 240)})` : "");

  // Legacy/raw block format (fortfarande type:"question")
  // Vi behåller question + answerKey men lägger även MCQ-fält.
  const answerKey = (choices.find(c => c.id === correctChoiceId) || {}).text || "";

  return {
    type: "question",
    title,
    question: qText + ctxLine,
    choices,
    correctChoiceId,
    answerKey,
    rationale,
    meta: { difficulty: diff, mins, tags: ["question", subj, "mcq"], seed: n >>> 0 }
  };
}

// ============================================================
// P0: Map blocks[] => items[] (UI-kontrakt kräver data.items[])
// ============================================================

function blocksToItems(blocks) {
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b) continue;
    const t = safeStr(b.type).toLowerCase().trim() || "info";

    if (t === "info") {
      out.push({
        type: "info",
        title: safeStr(b.title || ""),
        text: safeStr(b.text || ""),
        meta: isPlainObject(b.meta) ? b.meta : undefined
      });
      continue;
    }

    if (t === "task") {
      out.push({
        type: "task",
        title: safeStr(b.title || ""),
        instruction: safeStr(b.instruction || ""),
        deliverable: safeStr(b.deliverable || ""),
        meta: isPlainObject(b.meta) ? b.meta : undefined
      });
      continue;
    }

    if (t === "question") {
      // För UI-problemfilter: lägg både answer och correct (valfri redundans)
      const correctId = safeStr(b.correctChoiceId || "");
      const choices = Array.isArray(b.choices) ? b.choices : [];
      const correctText =
        (choices.find(c => c && safeStr(c.id) === correctId) || {}).text || safeStr(b.answerKey || "");

      out.push({
        type: "question",
        title: safeStr(b.title || ""),
        question: safeStr(b.question || ""),
        choices,
        correctChoiceId: correctId,
        correct: correctText || correctId || safeStr(b.answerKey || ""),
        answer: correctText || safeStr(b.answerKey || "") || correctId,
        rationale: safeStr(b.rationale || ""),
        meta: isPlainObject(b.meta) ? b.meta : undefined
      });
      continue;
    }

    if (t === "document") {
      out.push({
        type: "document",
        title: safeStr(b.title || ""),
        text: safeStr(b.text || ""),
        meta: isPlainObject(b.meta) ? b.meta : undefined
      });
      continue;
    }

    // fallback
    out.push({
      type: "info",
      title: safeStr(b.title || ""),
      text: safeStr(b.text || b.instruction || b.question || ""),
      meta: isPlainObject(b.meta) ? b.meta : undefined
    });
  }

  // Fail-closed: kräver minst 1 item
  return out.length ? out : [];
}
