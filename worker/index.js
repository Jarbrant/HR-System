// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.3 FIX)
// FIL: worker/index.js
// Mål: Lås worker-output till training-blocks + UI-frågeformat när MCQ begärs.
//      FIX: Undvik “samma frågor”, förbjud placeholder-fraser, kräver förklaring,
//           och gör batchen unik (dedupe) + bättre variation.
//
// UI kräver vid MCQ:
// - type: "question"
// - question: string
// - options: string[]
// - correctIndex: number (eller correctIndices: number[])
//
// POLICY (LÅST):
// - Stateless (ingen lagring)
// - Fail-closed
// - Endast JSON
// - Max payload 64KB
// - Logga aldrig payload (endast requestId + felkod)
// - CORS strikt: aldrig wildcard
// - ENV:
//   - ALLOWED_ORIGIN (MUST)
//   - REQUIRE_AUTH ("true"/"false")
//   - WORKER_TOKEN (secret, om REQUIRE_AUTH=true)
//   - AI_ENABLED ("true"/"false")  // just nu påverkar text (mock), inte extern AI-call
//
// Endpoints (versionerade):
// - GET  /v1/health
// - GET  /v1/version
// - POST /v1/ai/generate
// - POST /v1/ai/training   (alias)
// - POST /v1/ai/document   (alias)
// - OPTIONS *              (CORS preflight)
//
// PATCH (CORS FIX):
// - Tillåt UI headers: X-Hr-Sdk + X-Hr-Client i Access-Control-Allow-Headers
//
// PATCH v1.5.2:
// - MCQ: alltid exakt 5 svarsalternativ (TF=2). Stabil correctIndex.
//
// PATCH v1.5.3 (UNIQ + QUALITY):
// - P0: Ta bort förbjudna placeholder-fraser i frågetext (ingen “Använd detta sammanhang …”/”kontext dolt”)
// - P0: Unikhetskrav i batch (dedupe på frågetext) – fail-closed om inte går att generera unikt
// - P0: Variation per item (requestId + itemIndex salt) så count>1 inte blir samma
// - P1: Bättre MCQ-stems (tydligare scope: vardag/ej akut, rutinstart, dialogstart)
// - P1: Require explanation + min-längd (enligt ruleset om finns)
// - P2: UI-map inkluderar explanation (förklaring) så modal visar det
// ============================================================

import INDEX from "../ai-rules/index.json";
import GLOBAL from "../ai-rules/v1/global.json";
import MODULES from "../ai-rules/v1/modules.json";

import SWEDISH from "../ai-rules/v1/subjects/swedish.json";
import MATH from "../ai-rules/v1/subjects/math.json";
import GENERIC from "../ai-rules/v1/subjects/generic.json";

import QUESTION_FORMAT from "../ai-rules/v1/formats/question.json";
import TASK_FORMAT from "../ai-rules/v1/formats/task.json";
import TRAINING_BLOCKS_FORMAT from "../ai-rules/v1/formats/training-blocks.json";

// NYTT (Steg 1): ruleset för kvalitet (din fil)
// LÄGG DEN HÄR: ai-rules/v1/rulesets/training_prompt.json
import TRAINING_PROMPT from "../ai-rules/v1/rulesets/training_prompt.json";

export const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.5.3";

// ------------------------------
// Fetch
// ------------------------------
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
            rulesBase: "ai-rules",
            outputContract: "training-blocks@v1 + ui-mcq@v1.2 (explanation+uniq)"
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
      const expected = safeStr(env.WORKER_TOKEN).trim();
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

    // ---------- INPUT (backward tolerant) ----------
    let modeRaw = safeStr(body.mode || body.type).trim();
    if (path === "/v1/ai/training") modeRaw = "training";
    if (path === "/v1/ai/document") modeRaw = "document";
    const mode = normalizeMode(modeRaw);

    const countRaw = body.count ?? body.n;
    const language = safeStr(body.language || "sv").trim();

    // P0 FIX: UI skickar ofta context som object { text: "..." } eller ruleset-objekt.
    // Vi normaliserar till ren text och SANITIZER:ar bort "(kontext dolt)" / "[object Object]" etc.
    const context = sanitizeContextText(normalizeContextInput(body.context ?? body.prompt ?? ""));

    const format = safeStr(body.format || "").trim();
    const subjectId = safeStr(body.subjectId || body.subject || "").trim();
    const difficultyHint = body.difficultyHint ?? body.difficulty;

    // UI: frågetyp (tolerant mot olika fältnamn)
    const questionType = normalizeQuestionType(
      body.questionType ??
      body.qType ??
      body.questionMode ??
      body.question_mode ??
      body.questionKind ??
      body.question_kind ??
      body.quizMode ??
      body.mcqMode ??
      body.mcq_type ??
      body.question ??
      ""
    );

    const subjectObj = isPlainObject(body.subjectObj)
      ? body.subjectObj
      : (isPlainObject(body.subject) ? body.subject : null);
    const course = normalizeCourseSubject(subjectObj);

    // ---------- VALIDATION ----------
    if (!(mode === "training" || mode === "document")) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "mode måste vara training eller document", corsHeaders, true);
    }

    const count = normalizeCount(countRaw);
    if (count === null) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "count måste vara mellan 1 och 12", corsHeaders, true);
    }

    if (!(language === "sv" || language === "en" || language === "sv-SE")) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "language måste vara sv, sv-SE eller en", corsHeaders, true);
    }

    if (context.length > 4000) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "context max 4000 tecken", corsHeaders, true);
    }

    const courseCheck = validateCourseSubject(course);
    if (!courseCheck.ok) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", courseCheck.message, corsHeaders, true);
    }

    // ---------- BUILD ----------
    let training;
    try {
      training = buildTrainingBlocks({
        requestId,
        mode,
        count,
        language: (language === "sv-SE" ? "sv" : language),
        context,
        aiEnabled,
        format,
        subjectId,
        difficultyHint,
        course,
        questionType
      });
    } catch (e) {
      // Fail-closed utan payload
      console.error("ERR", requestId, "UPSTREAM_ERROR");
      return errorJSON(502, requestId, "UPSTREAM_ERROR", "AI-tjänsten svarade inte", corsHeaders, false);
    }

    // ---------- TOPP-NIVÅ blocks ----------
    let topBlocks = Array.isArray(training.blocks) ? training.blocks : [];

    // Om UI ber om MCQ/TF: returnera UI-frågeblock i exakt UI-format
    if (isUiQuestionRequest(questionType)) {
      const mapped = mapTrainingBlocksToUiQuestions(topBlocks, questionType, (language === "sv-SE" ? "sv" : language));
      if (!mapped.ok) {
        return errorJSON(422, requestId, mapped.errorCode, mapped.message, corsHeaders, true);
      }
      topBlocks = mapped.blocks;
    }

    return okJSON(
      200,
      {
        ok: true,
        requestId,
        data: { training },
        training,
        blocks: topBlocks,
        mode: training.mode
      },
      corsHeaders
    );
  }
};

// ============================================================
// HELPERS
// ============================================================

function buildCorsHeaders(origin, allowedOrigin) {
  const allowOrigin = (allowedOrigin && origin === allowedOrigin) ? allowedOrigin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    // CORS FIX: UI skickar X-Hr-Sdk + X-Hr-Client (preflight kräver att de är tillåtna)
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Hr-Sdk, X-Hr-Client",
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
  return okJSON(status, { ok: false, requestId, error: { code: safeStr(code), message: safeStr(message) } }, corsHeaders);
}

function extractBearerToken(authHeader) {
  const h = safeStr(authHeader).trim();
  if (!h) return "";
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

function normalizeCount(v) {
  const n = (v === null || v === undefined || v === "") ? 4 : Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i !== n) return null;
  if (i < 1 || i > 12) return null;
  return i;
}

function hash32(str) {
  let h = 2166136261 >>> 0; // FNV-1a base
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalizeMode(modeRaw) {
  const s = safeStr(modeRaw).toLowerCase().trim();
  if (!s) return "";
  if (s === "training" || s === "document") return s;
  if (s.includes("train")) return "training";
  if (s.includes("doc")) return "document";
  return s;
}

// P0: Context kan komma som string, {text:"..."}, eller ruleset-context.
// Vi normaliserar till ren text (och SANITIZER körs separat).
function normalizeContextInput(v) {
  if (typeof v === "string") return v;
  if (isPlainObject(v)) {
    // UI: { text: "Modul: ... • Steg: 1" }
    const t = safeStr(v.text || "").trim();
    if (t) return t;

    // Ruleset-form: moduleId/areaId/... + labels
    const ml = safeStr(v.moduleLabel || v.module || v.moduleId || "").trim();
    const al = safeStr(v.areaLabel || v.area || v.areaId || "").trim();
    const cl = safeStr(v.chapterLabel || v.chapter || v.chapterId || "").trim();
    const st = safeStr(v.step || "").trim();
    const df = safeStr(v.difficulty || "").trim();
    const parts = [];
    if (ml) parts.push(`Modul: ${ml}`);
    if (al) parts.push(`Område: ${al}`);
    if (cl) parts.push(`Kapitel: ${cl}`);
    if (st) parts.push(`Steg: ${st}`);
    if (df) parts.push(`Nivå: ${df}`);
    const joined = parts.join(" • ");
    return joined || "";
  }
  return "";
}

// P0: ta bort placeholder-text, "(kontext dolt)", "[object Object]" och förbjudna fraser
function sanitizeContextText(s) {
  let t = safeStr(s).trim();
  if (!t) return "";
  // vanliga UI-placeholders
  t = t
    .replace(/\(\s*kontext\s+dolt\s*\)/gi, "")
    .replace(/\[\s*object\s+object\s*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // om någon råkar skicka “Använd detta sammanhang …”
  t = t
    .replace(/använd\s+detta\s+sammanhang[^.]*\.?/gi, "")
    .replace(/utgå\s+från\s+detta\s+sammanhang[^.]*\.?/gi, "")
    .trim();
  return t;
}

function normalizeFormat(format, mode, questionType) {
  if (isUiQuestionRequest(questionType)) return "question";

  const f = safeStr(format).toLowerCase().trim();
  if (f === "question" || f === "questions") return "question";
  if (f === "task" || f === "tasks") return "task";
  if (f === "document") return "document";
  if (f === "training-blocks" || f === "training" || f === "blocks") return "training-blocks";
  return (mode === "document") ? "document" : "training-blocks";
}

function normalizeSubjectId(subjectId) {
  const s = safeStr(subjectId).toLowerCase().trim();
  if (s === "swedish" || s === "svenska") return "swedish";
  if (s === "math" || s === "matte") return "math";
  if (s) return s;
  return "generic";
}

function pickDifficultyLabel(difficultyHint, seedN) {
  const s = safeStr(difficultyHint).toLowerCase().trim();
  if (s === "intro" || s === "normal" || s === "advanced") return s;

  if (!s || s === "auto") {
    const lvl = 1 + (seedN % 5); // 1..5
    return (lvl <= 2) ? "intro" : (lvl <= 4) ? "normal" : "advanced";
  }

  const n = Number(difficultyHint);
  if (Number.isInteger(n) && n >= 1 && n <= 5) {
    return (n <= 2) ? "intro" : (n <= 4) ? "normal" : "advanced";
  }

  return "normal";
}

// ------------------------------------------------------------
// Course Subject (module/area/chapter/step)
// ------------------------------------------------------------
function normalizeCourseSubject(subjectObj) {
  if (!isPlainObject(subjectObj)) return null;
  const module = safeStr(subjectObj.module || "").trim();
  const area = safeStr(subjectObj.area || "").trim();
  const chapter = safeStr(subjectObj.chapter || "").trim();
  const step = safeStr(subjectObj.step || "").trim();

  const moduleId = safeStr(subjectObj.moduleId || "").trim();
  const areaId = safeStr(subjectObj.areaId || "").trim();
  const chapterId = safeStr(subjectObj.chapterId || "").trim();
  const stepId = safeStr(subjectObj.stepId || "").trim();

  return {
    module: module || "",
    area: area || "",
    chapter: chapter || "",
    step: (step || stepId || ""),
    moduleId,
    areaId,
    chapterId,
    stepId
  };
}

function validateCourseSubject(course) {
  if (course === null) return { ok: true };
  const step = safeStr(course.step).trim();
  if (step) {
    const allow = new Set(["1", "2", "3", "4", "5", "6", "7"]);
    if (!allow.has(step)) return { ok: false, message: "subject.step måste vara 1–7" };
  }
  return { ok: true };
}

function resolveCourseLabelFallback(course, mode) {
  if (!course) {
    return {
      module: "Generic",
      area: (mode === "document") ? "Dokument" : "Utbildning",
      chapter: "Introduktion",
      step: "1"
    };
  }

  return {
    module: course.module || "Generic",
    area: course.area || ((mode === "document") ? "Dokument" : "Utbildning"),
    chapter: course.chapter || "Introduktion",
    step: safeStr(course.step).trim() || "1"
  };
}

// ============================================================
// RULES BUNDLE
// ============================================================
function getRulesBundle(subjectId) {
  const s = normalizeSubjectId(subjectId);
  const subj =
    (s === "math") ? (MATH || {}) :
      (s === "swedish") ? (SWEDISH || {}) :
        (s === "generic") ? (GENERIC || {}) :
          (GENERIC || {});

  return {
    index: INDEX || {},
    global: GLOBAL || {},
    modules: MODULES || {},
    subject: subj,
    rulesets: {
      training_prompt: TRAINING_PROMPT || {}
    },
    formats: {
      question: QUESTION_FORMAT || {},
      task: TASK_FORMAT || {},
      "training-blocks": TRAINING_BLOCKS_FORMAT || {}
    }
  };
}

function getQuestionQuality(bundle) {
  const qp = bundle && bundle.rulesets && bundle.rulesets.training_prompt;
  const q = (qp && qp.questionQuality) ? qp.questionQuality : null;

  const forbiddenPhrases = safeArr(q && q.general && q.general.forbiddenPhrases).filter(Boolean);
  const forbidContextPlaceholderText = !!(q && q.general && q.general.forbidContextPlaceholderText);
  const requireExplanation = !!(q && q.general && q.general.requireExplanation);
  const explanationMinChars = Number(q && q.general && q.general.explanationMinChars) || 40;

  const minOptions = Number(q && q.mcq && q.mcq.minOptions) || 4;
  const maxOptions = Number(q && q.mcq && q.mcq.maxOptions) || 6;

  // VariationPlan (om finns)
  const vp = (q && q.general && q.general.variationPlan) ? q.general.variationPlan : null;
  const rotateDimensions = safeArr(vp && vp.rotateDimensions).filter(Boolean);
  const minDistinct = Number(vp && vp.minimumDistinctDimensionsInBatch) || 3;
  const vpEnabled = !!(vp && vp.enabled);

  return {
    forbidContextPlaceholderText,
    forbiddenPhrases,
    requireExplanation,
    explanationMinChars,
    mcq: { minOptions, maxOptions },
    variationPlan: { enabled: vpEnabled, rotateDimensions, minimumDistinctDimensionsInBatch: minDistinct }
  };
}

function safeArr(a) {
  return Array.isArray(a) ? a : [];
}

function containsForbiddenPhrase(text, forbiddenPhrases) {
  const t = safeStr(text).toLowerCase();
  for (const p of safeArr(forbiddenPhrases)) {
    const ph = safeStr(p).toLowerCase().trim();
    if (ph && t.includes(ph)) return true;
  }
  return false;
}

function stripAnyBracketedContext(s) {
  // Fail-soft: plocka bort typiska "(...)" eller "[...]" som kan vara placeholder
  const txt = safeStr(s);
  return txt
    .replace(/\(\s*kontext[^)]*\)/gi, "")
    .replace(/\(\s*använd[^)]*\)/gi, "")
    .replace(/\[\s*object\s+object\s*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ============================================================
// OUTPUT BUILDER — training-blocks + question-format (choices)
// ============================================================
function buildTrainingBlocks({ requestId, mode, count, language, context, aiEnabled, format, subjectId, difficultyHint, course, questionType }) {
  const fmt = normalizeFormat(format, mode, questionType);
  const subjId = normalizeSubjectId(subjectId);
  const bundle = getRulesBundle(subjId);

  const seed = hash32(`${requestId}|${mode}|${count}|${language}|${context.slice(0, 96)}|${fmt}|${subjId}|${safeStr(difficultyHint)}|${safeStr(questionType)}`);

  const courseLabel = resolveCourseLabelFallback(course, mode);
  const difficulty = pickDifficultyLabel(difficultyHint, seed);

  const title =
    (mode === "document")
      ? (language === "sv" ? `${courseLabel.module} – ${courseLabel.area} (Dokument)` : `${courseLabel.module} – ${courseLabel.area} (Document)`)
      : (language === "sv" ? `${courseLabel.module} – ${courseLabel.area} (Steg ${courseLabel.step})` : `${courseLabel.module} – ${courseLabel.area} (Step ${courseLabel.step})`);

  const summary =
    language === "sv"
      ? (aiEnabled ? "Regelstyrt genererat innehåll (mock)." : "AI avstängd (mock).")
      : (aiEnabled ? "Ruleset-driven content (mock)." : "AI disabled (mock).");

  const objectives =
    (mode === "training")
      ? (language === "sv"
        ? ["Förstå grunderna", "Tillämpa i vardagen", "Kunna göra en snabb självkontroll"]
        : ["Understand basics", "Apply in practice", "Do a quick self-check"])
      : [];

  const blocks = [];
  const seenQuestionStems = new Set(); // P0: dedupe i batch

  for (let i = 0; i < count; i++) {
    // P0: variation per item (salt med index)
    const n = (seed ^ hash32(`${requestId}#${i}`) ^ (i * 2654435761)) >>> 0;

    if (fmt === "question") {
      blocks.push(genQuestionBlock({
        i, n, language, context, courseLabel, difficulty, subjId, bundle, questionType,
        seenQuestionStems
      }));
      continue;
    }

    if (fmt === "task") {
      blocks.push(genTaskBlock({ i, n, language, context, courseLabel, difficulty, subjId, bundle }));
      continue;
    }

    if (fmt === "document" || mode === "document") {
      blocks.push(genDocumentBlock({ i, n, language, context, courseLabel, difficulty, subjId, bundle }));
      continue;
    }

    const pick = n % 3;
    if (pick === 0) blocks.push(genInfoBlock({ i, n, language, context, courseLabel, difficulty, subjId, bundle }));
    else if (pick === 1) blocks.push(genTaskBlock({ i, n, language, context, courseLabel, difficulty, subjId, bundle }));
    else blocks.push(genQuestionBlock({
      i, n, language, context, courseLabel, difficulty, subjId, bundle, questionType,
      seenQuestionStems
    }));
  }

  return {
    id: `tr_${subjId}_${hash32(requestId).toString(16)}`.slice(0, 24),
    mode,
    subject: {
      module: courseLabel.module,
      area: courseLabel.area,
      chapter: courseLabel.chapter,
      step: courseLabel.step
    },
    difficulty,
    title,
    summary,
    objectives,
    blocks,
    meta: {
      createdAt: Date.now(),
      createdBy: "worker",
      source: "mock-v1.5.3"
    }
  };
}

// ------------------------------
// Block generators
// ------------------------------
function genInfoBlock({ i, language, context, courseLabel, difficulty, subjId }) {
  const blockId = `b_info_${i + 1}_${subjId}`.slice(0, 32);

  const title =
    language === "sv"
      ? `Teori: ${courseLabel.area}`
      : `Theory: ${courseLabel.area}`;

  const ctx = context ? context : "";

  const text =
    language === "sv"
      ? `Kort teori kopplad till ${courseLabel.module} → ${courseLabel.area}.\n\nSammanhang (valfritt):\n${ctx || "—"}`
      : `Short theory for ${courseLabel.module} → ${courseLabel.area}.\n\nContext (optional):\n${ctx || "—"}`;

  return {
    blockId,
    kind: "info",
    title,
    items: [{ type: "text", text }],
    scoring: { points: 0 },
    meta: { tags: ["info", subjId], difficulty }
  };
}

function genTaskBlock({ i, language, context, courseLabel, difficulty, subjId }) {
  const blockId = `b_task_${i + 1}_${subjId}`.slice(0, 32);

  const title =
    language === "sv"
      ? `Uppgift: ${courseLabel.area}`
      : `Task: ${courseLabel.area}`;

  const ctx = context ? context : "";

  // OBS: task kan visa kontext, men aldrig placeholders som "(kontext dolt)".
  const instruction =
    language === "sv"
      ? `Gör en kort uppgift kopplad till ${courseLabel.area}.\n\nUtgångspunkt (om relevant):\n${ctx || "—"}`
      : `Complete a short task for ${courseLabel.area}.\n\nStarting point (if relevant):\n${ctx || "—"}`;

  return {
    blockId,
    kind: "task",
    title,
    items: [
      { type: "text", text: instruction },
      {
        type: "bullets",
        bullets: language === "sv"
          ? ["Skriv 2–4 punkter", "Var konkret", "Koppla till vardag"]
          : ["Write 2–4 bullets", "Be concrete", "Connect to practice"],
        tone: "neutral"
      }
    ],
    scoring: { points: 0 },
    meta: { tags: ["task", subjId], difficulty }
  };
}

function genDocumentBlock({ i, language, context, courseLabel, difficulty, subjId }) {
  const blockId = `b_doc_${i + 1}_${subjId}`.slice(0, 32);

  const title =
    language === "sv"
      ? `Dokument: ${courseLabel.area}`
      : `Document: ${courseLabel.area}`;

  const ctx = context ? context : "";

  const text =
    language === "sv"
      ? `Detta är ett informativt dokument om ${courseLabel.area}.\n\nBakgrund (valfritt):\n${ctx || "—"}`
      : `This is an informational document about ${courseLabel.area}.\n\nBackground (optional):\n${ctx || "—"}`;

  return {
    blockId,
    kind: "document",
    title,
    items: [
      { type: "text", text },
      {
        type: "callout",
        text: language === "sv" ? "Kom ihåg: håll det enkelt och praktiskt." : "Remember: keep it simple and practical.",
        tone: "info"
      }
    ],
    scoring: { points: 0 },
    meta: { tags: ["document", subjId], difficulty }
  };
}

function genQuestionBlock({ i, n, language, context, courseLabel, difficulty, subjId, bundle, questionType, seenQuestionStems }) {
  const blockId = `b_q_${i + 1}_${subjId}`.slice(0, 32);

  const title =
    language === "sv"
      ? `Kontrollfråga: ${courseLabel.area}`
      : `Check question: ${courseLabel.area}`;

  // P0: försök generera unik fråga (fail-closed om vi misslyckas)
  let q = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const nn = (n ^ (attempt * 0x9e3779b9)) >>> 0;
    const cand = makeQuestion({ n: nn, language, context, courseLabel, difficulty, subjId, questionType, bundle, i });

    const stemKey = safeStr(cand && (cand.text || cand.question || "")).trim().toLowerCase();
    if (!stemKey) continue;

    if (seenQuestionStems && seenQuestionStems.has(stemKey)) continue;

    if (seenQuestionStems) seenQuestionStems.add(stemKey);
    q = cand;
    break;
  }

  // Fail-closed: om vi inte lyckas skapa unikt (hellre fel än duplicat i batch)
  if (!q) {
    throw new Error("DUPLICATE_QUESTION_IN_BATCH");
  }

  return {
    blockId,
    kind: "question",
    title,
    items: [{ type: "questionInline", question: q }],
    scoring: { points: 1 },
    meta: { tags: ["question", subjId], difficulty }
  };
}

// ------------------------------
// QUESTION (choice-format, ruleset-quality)
// ------------------------------
function makeQuestion({ n, language, context, courseLabel, difficulty, subjId, questionType, bundle, i }) {
  const qt = normalizeQuestionType(questionType);
  const isTf = (qt === "tf");
  const isMulti = (qt === "mcq_multi");
  const isMcq = (qt === "mcq_single" || qt === "mcq_multi");

  const qq = getQuestionQuality(bundle);

  // PATCH v1.5.2: lås MCQ till exakt 5 alternativ (TF=2)
  const choiceCount = isTf ? 2 : (isMcq ? 5 : (3 + (n % 3))); // TF=2, MCQ=5, annars 3..5

  // P1: VariationPlan — skapa olika "dimensioner" i batchen
  const dimsDefault = [
    "definition_or_concept",
    "routine_first_step",
    "risk_consequence",
    "scenario_application",
    "roles_and_responsibility",
    "deviation_and_action"
  ];
  const dims = (qq.variationPlan && qq.variationPlan.enabled && qq.variationPlan.rotateDimensions && qq.variationPlan.rotateDimensions.length)
    ? qq.variationPlan.rotateDimensions
    : dimsDefault;

  const dim = dims[((n + (i || 0)) >>> 0) % dims.length];

  // P1: tydligare scope (varierar också)
  const scopeSv = [
    "i en vardagssituation (inte akut)",
    "när du ska starta en dialog",
    "när du ska välja första steg i en rutin",
    "när du vill förebygga fel innan de uppstår",
    "när du behöver få samma bild i teamet"
  ];
  const scopeEn = [
    "in a normal situation (not urgent)",
    "when you need to start a dialogue",
    "when you choose the first step in a routine",
    "when you want to prevent issues early",
    "when you need alignment in the team"
  ];
  const scope = (language === "sv" ? scopeSv : scopeEn)[(n + (i || 0)) % 5];

  // -----------------------
  // STEMS per dimension
  // -----------------------
  let text = "";
  if (language === "sv") {
    if (dim === "definition_or_concept") {
      text = `Vilket alternativ beskriver bäst kärnan i ${courseLabel.area} ${scope}?`;
    } else if (dim === "risk_consequence") {
      text = `Vad är den vanligaste risken om man hoppar över grunderna i ${courseLabel.area} ${scope}?`;
    } else if (dim === "scenario_application") {
      text = `Du märker en oklarhet i ${courseLabel.area} ${scope}. Vilket val hjälper dig mest att reda ut läget?`;
    } else if (dim === "roles_and_responsibility") {
      text = `I ${courseLabel.area} ${scope}, vilket alternativ tydliggör ansvar och nästa steg bäst?`;
    } else if (dim === "deviation_and_action") {
      text = `Om något avviker i ${courseLabel.area} ${scope}, vilket första val är mest rimligt?`;
    } else {
      // routine_first_step
      text = `Vad är ett bra första steg i ${courseLabel.area} ${scope}?`;
    }
  } else {
    if (dim === "definition_or_concept") {
      text = `Which option best captures the core of ${courseLabel.area} ${scope}?`;
    } else if (dim === "risk_consequence") {
      text = `What is the most common risk if you skip the basics in ${courseLabel.area} ${scope}?`;
    } else if (dim === "scenario_application") {
      text = `You notice uncertainty in ${courseLabel.area} ${scope}. Which choice helps you clarify the situation?`;
    } else if (dim === "roles_and_responsibility") {
      text = `In ${courseLabel.area} ${scope}, which option clarifies responsibility and next step best?`;
    } else if (dim === "deviation_and_action") {
      text = `If something deviates in ${courseLabel.area} ${scope}, which first choice is most reasonable?`;
    } else {
      text = `What is a good first step in ${courseLabel.area} ${scope}?`;
    }
  }

  // P0: ruleset forbjuder placeholder-fraser
  if (qq.forbidContextPlaceholderText) {
    text = stripAnyBracketedContext(text);
    if (containsForbiddenPhrase(text, qq.forbiddenPhrases)) {
      text = (language === "sv")
        ? `Vad är ett bra första steg i ${courseLabel.area} ${scope}?`
        : `What is a good first step in ${courseLabel.area} ${scope}?`;
    }
  }

  // --- choices ---
  const choices = [];

  if (isTf) {
    choices.push({ id: "c1", text: (language === "sv") ? "Sant" : "True" });
    choices.push({ id: "c2", text: (language === "sv") ? "Falskt" : "False" });
  } else {
    // P1: pools per dimension så det inte blir samma semantik hela tiden
    const poolsSv = {
      definition_or_concept: [
        "Att säkerställa tydlighet i mål, roller och arbetssätt",
        "Att öka tempo genom att hoppa över dokumentation",
        "Att fokusera på magkänsla i stället för rutin",
        "Att undvika uppföljning för att spara tid",
        "Att hålla information privat för att minska frågor",
        "Att göra allt själv för att undvika misstag"
      ],
      routine_first_step: [
        "Klargör målet och ställ en öppen fråga",
        "Samla fakta snabbt innan du bestämmer åtgärd",
        "Gör en enkel kontroll mot checklista",
        "Säkra att rätt person/roll kopplas in",
        "Stäm av förväntningar och nästa steg",
        "Lyssna klart och spegla det du hört"
      ],
      risk_consequence: [
        "Att beslut tas på otydlig grund och blir svåra att följa upp",
        "Att alla alltid blir nöjda oavsett hur man gör",
        "Att inga avvikelser någonsin kan uppstå",
        "Att processen automatiskt blir perfekt utan kontroll",
        "Att kvaliteten ökar när man skippar steg",
        "Att ansvar blir tydligare utan kommunikation"
      ],
      scenario_application: [
        "Ställ en öppen fråga för att få fram fakta innan du väljer åtgärd",
        "Gå direkt på åtgärd utan att bekräfta läget",
        "Vänta och hoppas att det löser sig av sig själv",
        "Byt ämne för att undvika osäkerhet",
        "Avsluta dialogen för att spara tid",
        "Lägg ansvaret på någon annan utan överlämning"
      ],
      roles_and_responsibility: [
        "Tydliggör vem som gör vad och vilket nästa steg som gäller",
        "Låt alla göra lite av allt utan ansvarsfördelning",
        "Undvik att utse ansvar för att minska press",
        "Flytta ansvaret vid minsta oklarhet",
        "Hoppa över avstämning för att inte störa",
        "Skriv inget — det blir ändå tydligt senare"
      ],
      deviation_and_action: [
        "Avgränsa, samla fakta och följ rutinen för avvikelse/åtgärd",
        "Ignorera avvikelsen om den inte känns stor",
        "Ändra rutinen direkt utan att informera",
        "Skyll på någon för att markera allvar",
        "Gör en större ombyggnad innan du vet orsaken",
        "Undvik att dokumentera för att slippa spår"
      ]
    };

    const poolsEn = {
      definition_or_concept: [
        "Ensuring clarity in goals, roles, and ways of working",
        "Increasing speed by skipping documentation",
        "Relying on gut feeling instead of routine",
        "Avoiding follow-up to save time",
        "Keeping information private to reduce questions",
        "Doing everything alone to avoid mistakes"
      ],
      routine_first_step: [
        "Clarify the goal and ask an open question",
        "Gather key facts before deciding",
        "Do a quick checklist check",
        "Make sure the right role is involved",
        "Align expectations and agree on next step",
        "Listen fully and reflect what you heard"
      ],
      risk_consequence: [
        "Decisions are made on unclear grounds and become hard to follow up",
        "Everyone will always be happy no matter what",
        "No deviations can ever occur",
        "The process becomes perfect automatically without checks",
        "Quality increases when you skip steps",
        "Responsibility becomes clearer without communication"
      ],
      scenario_application: [
        "Ask an open question to gather facts before choosing an action",
        "Act immediately without confirming the situation",
        "Wait and hope it fixes itself",
        "Change topic to avoid uncertainty",
        "End the dialogue to save time",
        "Push responsibility to someone else without handover"
      ],
      roles_and_responsibility: [
        "Clarify who does what and what the next step is",
        "Let everyone do a bit of everything with no ownership",
        "Avoid naming ownership to reduce pressure",
        "Shift ownership at the first sign of uncertainty",
        "Skip check-ins to avoid disturbance",
        "Write nothing — it will become clear later"
      ],
      deviation_and_action: [
        "Scope it, gather facts, and follow the deviation/action routine",
        "Ignore it if it doesn't feel big",
        "Change the routine immediately without informing anyone",
        "Blame someone to show seriousness",
        "Do a major rebuild before knowing the cause",
        "Avoid documenting to reduce traceability"
      ]
    };

    const pool = (language === "sv") ? (poolsSv[dim] || poolsSv.routine_first_step) : (poolsEn[dim] || poolsEn.routine_first_step);

    // Deterministisk sampling -> välj exakt 5 unika alternativ
    const need = choiceCount; // MCQ=5
    const picked = new Set();
    let cursor = (n ^ hash32(safeStr(context).slice(0, 64))) >>> 0;

    while (picked.size < need && picked.size < pool.length) {
      cursor = (cursor * 1664525 + 1013904223) >>> 0; // LCG
      picked.add(cursor % pool.length);
    }

    const idxs = Array.from(picked);
    for (let k = 0; k < idxs.length && choices.length < need; k++) {
      choices.push({ id: `c${choices.length + 1}`, text: pool[idxs[k]] });
    }

    while (choices.length < need) {
      const t = pool[(n + choices.length) % pool.length];
      choices.push({ id: `c${choices.length + 1}`, text: t });
    }
  }

  // Correct (stabil men varierad)
  const correctIdx = (choiceCount > 0) ? (n % choiceCount) : 0;
  const correctChoiceId = `c${correctIdx + 1}`;

  let correctChoiceIds = null;
  if (isMulti && choiceCount >= 3) {
    const idx2 = (correctIdx + 2) % choiceCount;
    correctChoiceIds = (idx2 === correctIdx)
      ? [`c${correctIdx + 1}`, `c${((correctIdx + 1) % choiceCount) + 1}`]
      : [`c${correctIdx + 1}`, `c${idx2 + 1}`];
  }

  // P1: explanation/rationale enligt ruleset-krav (dimension-specifik)
  let rationale = "";
  if (language === "sv") {
    if (dim === "risk_consequence") {
      rationale = "Att hoppa över grunderna gör att beslut tas på otydlig grund. Då blir det svårt att följa upp och lätt att missa viktiga detaljer som borde fångas tidigt.";
    } else if (dim === "roles_and_responsibility") {
      rationale = "När ansvar och nästa steg är tydliga minskar missförstånd. Det gör arbetet spårbart och lättare att koordinera i teamet.";
    } else if (dim === "deviation_and_action") {
      rationale = "Vid avvikelse är bästa start att avgränsa och samla fakta innan åtgärd. Då kan du följa rutin, välja rätt insats och dokumentera korrekt.";
    } else if (dim === "definition_or_concept") {
      rationale = "Kärnan är tydlighet: mål, roller och arbetssätt. Det skapar en stabil grund för att göra rätt saker i rätt ordning och kunna följa upp.";
    } else {
      rationale = "I en normal situation är en bra start att skapa tydlighet (mål, avgränsning och nästa steg) innan du går in på åtgärd. Då blir valet mer träffsäkert och lättare att följa upp.";
    }
  } else {
    if (dim === "risk_consequence") {
      rationale = "Skipping basics leads to decisions made on unclear grounds. That makes follow-up harder and increases the chance of missing important details.";
    } else if (dim === "roles_and_responsibility") {
      rationale = "Clear ownership and a clear next step reduce misunderstandings. It makes work traceable and easier to coordinate.";
    } else if (dim === "deviation_and_action") {
      rationale = "When something deviates, start by scoping and gathering facts before acting. That supports the routine, the right action, and correct documentation.";
    } else if (dim === "definition_or_concept") {
      rationale = "The core is clarity: goals, roles, and ways of working. That creates a stable basis for doing the right things in the right order and following up.";
    } else {
      rationale = "In a normal situation, a strong start is to create clarity (goal, scope, and next step) before acting. That makes the choice more accurate and easier to follow up.";
    }
  }

  if (qq.requireExplanation) {
    if (safeStr(rationale).trim().length < qq.explanationMinChars) {
      rationale = (language === "sv")
        ? "Förklaring: Börja med att skapa tydlighet om mål och läge. När du förstår vad som faktiskt ska uppnås kan du välja rätt åtgärd och följa upp enligt rutin."
        : "Explanation: Start by clarifying the goal and the situation. Once you know what needs to be achieved, you can choose the right action and follow up properly.";
    }
  }

  // Final ruleset-sanity (fail-soft)
  if (qq.forbidContextPlaceholderText) {
    if (containsForbiddenPhrase(text, qq.forbiddenPhrases)) {
      text = (language === "sv")
        ? `Vad är ett bra första steg i ${courseLabel.area} ${scope}?`
        : `What is a good first step in ${courseLabel.area} ${scope}?`;
    }
  }

  return {
    kind: "question",
    text,
    choices,
    correctChoiceId,
    ...(correctChoiceIds ? { correctChoiceIds } : {}),
    rationale,
    difficulty,
    tags: [subjId, "scenario", dim]
  };
}

// ============================================================
// UI-frågeformat (options + correctIndex)
// ============================================================

function normalizeQuestionType(v) {
  const s0 = safeStr(v).toLowerCase().trim();
  if (!s0) return "";

  const s = s0
    .replace(/\s+/g, "_")
    .replace(/[()]/g, "")
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o");

  if (s === "auto") return "auto";
  if (s === "mcq_single" || s === "single" || s === "mcq") return "mcq_single";
  if (s === "mcq_multi" || s === "multi") return "mcq_multi";
  if (s === "tf" || s === "truefalse" || s === "true_false" || s === "sant_falskt" || s === "true_false") return "tf";
  if (s === "short" || s === "short_answer" || s === "kort") return "short";

  if (s.includes("mcq") && s.includes("multi")) return "mcq_multi";
  if (s.includes("mcq") && (s.includes("single") || s.includes("ett") || s.includes("one"))) return "mcq_single";
  if (s.includes("true") || s.includes("false") || s.includes("tf") || s.includes("sant") || s.includes("falskt")) return "tf";

  return s0;
}

function isUiQuestionRequest(questionType) {
  const qt = normalizeQuestionType(questionType);
  return qt === "mcq_single" || qt === "mcq_multi" || qt === "tf";
}

function mapTrainingBlocksToUiQuestions(trainingBlocks, questionType, language) {
  const qt = normalizeQuestionType(questionType);
  const blocks = Array.isArray(trainingBlocks) ? trainingBlocks : [];
  const out = [];

  for (const b of blocks) {
    if (!b || b.kind !== "question") continue;
    const q = extractQuestionFromBlock(b);
    if (!q.ok) continue;

    const mapped = mapChoiceQuestionToUi(q.question, qt, language);
    if (mapped.ok) out.push(mapped.item);
  }

  if (out.length === 0) {
    return {
      ok: false,
      errorCode: "Q_SCHEMA_INVALID",
      message: "Kunde inte skapa giltiga svarsalternativ för frågan"
    };
  }

  return { ok: true, blocks: out };
}

function extractQuestionFromBlock(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  for (const it of items) {
    if (it && it.type === "questionInline" && isPlainObject(it.question)) {
      return { ok: true, question: it.question };
    }
  }
  return { ok: false };
}

function mapChoiceQuestionToUi(q, questionType, language) {
  const question = safeStr(q.text).trim();
  const choices = Array.isArray(q.choices) ? q.choices : [];
  if (!question || choices.length < 2) return { ok: false };

  const options = [];
  for (const c of choices) {
    const t = safeStr(c && c.text).trim();
    if (t) options.push(t);
  }
  if (options.length < 2) return { ok: false };

  // P2: skicka med explanation så UI kan visa "Förklaring" direkt
  const explanation = safeStr(q.rationale || q.explanation || q.feedback || "").trim();

  if (questionType === "tf") {
    const a = (language === "sv") ? "Sant" : "True";
    const b = (language === "sv") ? "Falskt" : "False";
    return { ok: true, item: { type: "question", question, options: [a, b], correctIndex: 0, explanation } };
  }

  if (questionType === "mcq_single") {
    const correctId = safeStr(q.correctChoiceId).trim();
    const idx = indexOfChoiceId(choices, correctId);
    if (idx < 0 || idx >= options.length) return { ok: false };
    return { ok: true, item: { type: "question", question, options, correctIndex: idx, explanation } };
  }

  if (questionType === "mcq_multi") {
    const ids = Array.isArray(q.correctChoiceIds) ? q.correctChoiceIds : [];
    const indices = [];
    for (const id of ids) {
      const idx = indexOfChoiceId(choices, safeStr(id).trim());
      if (idx >= 0 && idx < options.length && !indices.includes(idx)) indices.push(idx);
    }
    if (indices.length === 0) {
      const correctId = safeStr(q.correctChoiceId).trim();
      const idx = indexOfChoiceId(choices, correctId);
      if (idx < 0 || idx >= options.length) return { ok: false };
      indices.push(idx);
    }
    return { ok: true, item: { type: "question", question, options, correctIndices: indices, explanation } };
  }

  return { ok: false };
}

function indexOfChoiceId(choices, id) {
  if (!id) return -1;
  for (let i = 0; i < choices.length; i++) {
    if (safeStr(choices[i] && choices[i].id).trim() === id) return i;
  }
  return -1;
}
