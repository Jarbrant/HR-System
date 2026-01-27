// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.4 QUALITY)
// FIL: worker/index.js
// Mål: Lås worker-output till training-blocks + UI-frågeformat när MCQ begärs.
//      FIX: Undvik “samma frågor”, förbjud placeholder-fraser, kräver förklaring,
//           och gör batchen unik (dedupe) + bättre variation.
//
// NYTT v1.5.4 (QUALITY CORE):
// - P0: Facit blir semantiskt korrekt (best answer + plausibla distraktorer)
// - P0: Rationale kopplas till valt facit (inte generisk mall)
// - P1: Steg 1–5 styr dimension-rotation (stepProfile)
// - P1: Parse Modul/Område/Kapitel/Steg från context.text när subjectObj saknas
// - P2: Batch-unikhet även på “best answer text” (inte bara stem)
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
const VERSION = "1.5.4";

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
            outputContract: "training-blocks@v1 + ui-mcq@v1.2 (explanation+uniq+semantic-facit)"
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

    // language: stöd för sv, sv-SE, sv_SE, en, en-US → normaliseras till "sv"|"en"
    const language = normalizeLanguage(body.language || "sv");

    // context: UI kan skicka string ELLER object {text:"..."} → normalisera
    const context = normalizeContextText(body.context ?? body.prompt ?? "");

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

    // NOTE: ofta saknas subjectObj → då infererar vi från context.text
    const course = normalizeCourseSubject(subjectObj);

    // ---------- VALIDATION ----------
    if (!(mode === "training" || mode === "document")) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "mode måste vara training eller document", corsHeaders, true);
    }

    const count = normalizeCount(countRaw);
    if (count === null) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "count måste vara mellan 1 och 12", corsHeaders, true);
    }

    if (!(language === "sv" || language === "en")) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "language måste vara sv eller en", corsHeaders, true);
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
        language,
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
      const mapped = mapTrainingBlocksToUiQuestions(topBlocks, questionType, language);
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

function safeArr(a) {
  return Array.isArray(a) ? a : [];
}

function normalizeLanguage(v) {
  const s = safeStr(v).trim().toLowerCase();
  if (!s) return "sv";
  if (s === "sv" || s === "sv-se" || s === "sv_se" || s.startsWith("sv")) return "sv";
  if (s === "en" || s === "en-us" || s === "en_gb" || s.startsWith("en")) return "en";
  return "sv";
}

function normalizeContextText(v) {
  // UI kan skicka:
  // - string
  // - object { text: "..." }
  // - object { contextText: "..." } (framtida tolerant)
  // Fail-soft: annars tom sträng (stateless, säker)
  if (typeof v === "string") return v.trim();
  if (isPlainObject(v)) {
    const t = safeStr(v.text || v.contextText || v.value || "").trim();
    return t;
  }
  return safeStr(v).trim();
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

function inferCourseFromContextText(contextText) {
  // Förväntad sträng från UI:
  // "Modul: Kvalitet • Område: ISO 9001 • Kapitel: Introduktion • Steg: 1"
  const t = safeStr(contextText);

  function pick(label) {
    const re = new RegExp(`${label}\\s*:\\s*([^•\\n\\r]+)`, "i");
    const m = t.match(re);
    return m ? safeStr(m[1]).trim() : "";
  }

  const module = pick("Modul");
  const area = pick("Område");
  const chapter = pick("Kapitel");

  let step = "";
  const mStep = t.match(/Steg\s*:\s*([0-9]+)/i);
  if (mStep) step = safeStr(mStep[1]).trim();

  if (!module && !area && !chapter && !step) return null;

  return {
    module: module || "",
    area: area || "",
    chapter: chapter || "",
    step: step || ""
  };
}

function resolveCourseLabelFallback(course, mode, contextText) {
  const inferred = (!course) ? inferCourseFromContextText(contextText) : null;

  if (!course && !inferred) {
    return {
      module: "Generic",
      area: (mode === "document") ? "Dokument" : "Utbildning",
      chapter: "Introduktion",
      step: "1"
    };
  }

  const src = course || inferred || {};
  return {
    module: safeStr(src.module).trim() || "Generic",
    area: safeStr(src.area).trim() || ((mode === "document") ? "Dokument" : "Utbildning"),
    chapter: safeStr(src.chapter).trim() || "Introduktion",
    step: safeStr(src.step).trim() || "1"
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

  const nearDupThreshold = Number(q && q.general && q.general.batchUniqueness && q.general.batchUniqueness.forbidNearDuplicateThreshold);
  const forbidNearDuplicateThreshold = Number.isFinite(nearDupThreshold) ? nearDupThreshold : 0.85;

  const rotateDims = safeArr(q && q.general && q.general.variationPlan && q.general.variationPlan.rotateDimensions).filter(Boolean);
  const minDistinctDims = Number(q && q.general && q.general.variationPlan && q.general.variationPlan.minimumDistinctDimensionsInBatch) || 3;

  const minOptions = Number(q && q.mcq && q.mcq.minOptions) || 4;
  const maxOptions = Number(q && q.mcq && q.mcq.maxOptions) || 6;

  return {
    forbidContextPlaceholderText,
    forbiddenPhrases,
    requireExplanation,
    explanationMinChars,
    forbidNearDuplicateThreshold,
    variation: { rotateDims, minDistinctDims },
    mcq: { minOptions, maxOptions }
  };
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
  const txt = safeStr(s);
  return txt
    .replace(/\(\s*kontext[^)]*\)/gi, "")
    .replace(/\(\s*använd[^)]*\)/gi, "")
    .replace(/\[\s*object\s+object\s*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeContextForDisplay(contextText, qq) {
  const c = safeStr(contextText).trim();
  if (!c) return "—";
  if (qq && qq.forbidContextPlaceholderText) {
    if (containsForbiddenPhrase(c, qq.forbiddenPhrases)) return "—";
    if (/\(kontext\s+dolt\)/i.test(c)) return "—";
    if (/\[object\s+object\]/i.test(c)) return "—";
  }
  return c;
}

function tokenizeForSimilarity(s) {
  const t = safeStr(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!t) return [];
  const parts = t.split(/\s+/g).filter(Boolean);
  const stop = new Set(["i", "en", "ett", "att", "och", "du", "när", "vad", "vilket", "vilken", "är", "ska", "för", "på", "om", "som", "det", "de", "den", "ni"]);
  return parts.filter(w => w.length >= 3 && !stop.has(w));
}

function jaccardSimilarity(a, b) {
  const A = new Set(tokenizeForSimilarity(a));
  const B = new Set(tokenizeForSimilarity(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? (inter / uni) : 0;
}

function normKey(s) {
  return safeStr(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ============================================================
// STEP PROFILE (1–5) → styr frågedimensioner
// ============================================================
function getStepProfile(step) {
  const s = safeStr(step).trim();
  // Klassrumstanke:
  // 1) vad/varför  2) roller/rutin  3) tillämpning  4) risk  5) avvikelse/uppföljning
  if (s === "1") return ["definition_or_concept", "routine_first_step", "scenario_application"];
  if (s === "2") return ["roles_and_responsibility", "routine_first_step", "scenario_application"];
  if (s === "3") return ["scenario_application", "routine_first_step", "roles_and_responsibility"];
  if (s === "4") return ["risk_consequence", "scenario_application", "routine_first_step"];
  if (s === "5") return ["deviation_and_action", "risk_consequence", "roles_and_responsibility"];
  return [];
}

// ============================================================
// OUTPUT BUILDER — training-blocks + question-format (choices)
// ============================================================
function buildTrainingBlocks({ requestId, mode, count, language, context, aiEnabled, format, subjectId, difficultyHint, course, questionType }) {
  const fmt = normalizeFormat(format, mode, questionType);
  const subjId = normalizeSubjectId(subjectId);
  const bundle = getRulesBundle(subjId);
  const qq = getQuestionQuality(bundle);

  const seed = hash32(`${requestId}|${mode}|${count}|${language}|${safeStr(context).slice(0, 96)}|${fmt}|${subjId}|${safeStr(difficultyHint)}|${safeStr(questionType)}`);

  const courseLabel = resolveCourseLabelFallback(course, mode, context);
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

  // Batch-state (stateless per request, men hjälper unikhet inom batchen)
  const batch = {
    seenStems: [],
    seenDims: new Set(),
    seenBestAnswers: [], // P2: unikhet på korrekt svar-text (semantic)
    seenCorrectSlots: new Set()
  };

  for (let i = 0; i < count; i++) {
    // P0: variation per item (salt med index)
    const n = (seed ^ hash32(`${requestId}#${i}`) ^ (i * 2654435761)) >>> 0;

    if (fmt === "question") {
      blocks.push(genQuestionBlock({
        i, n, count, language, context, courseLabel, difficulty, subjId, bundle, questionType, qq, batch
      }));
      continue;
    }

    if (fmt === "task") {
      blocks.push(genTaskBlock({ i, n, language, context, courseLabel, difficulty, subjId, qq }));
      continue;
    }

    if (fmt === "document" || mode === "document") {
      blocks.push(genDocumentBlock({ i, n, language, context, courseLabel, difficulty, subjId, qq }));
      continue;
    }

    const pick = n % 3;
    if (pick === 0) blocks.push(genInfoBlock({ i, n, language, context, courseLabel, difficulty, subjId, qq }));
    else if (pick === 1) blocks.push(genTaskBlock({ i, n, language, context, courseLabel, difficulty, subjId, qq }));
    else blocks.push(genQuestionBlock({
      i, n, count, language, context, courseLabel, difficulty, subjId, bundle, questionType, qq, batch
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
      source: "mock-v1.5.4"
    }
  };
}

// ------------------------------
// Block generators
// ------------------------------
function genInfoBlock({ i, language, context, courseLabel, difficulty, subjId, qq }) {
  const blockId = `b_info_${i + 1}_${subjId}`.slice(0, 32);

  const title =
    language === "sv"
      ? `Teori: ${courseLabel.area}`
      : `Theory: ${courseLabel.area}`;

  const ctx = sanitizeContextForDisplay(context, qq);

  const text =
    language === "sv"
      ? `Kort teori kopplad till ${courseLabel.module} → ${courseLabel.area}.\n\nSammanhang (valfritt):\n${ctx}`
      : `Short theory for ${courseLabel.module} → ${courseLabel.area}.\n\nContext (optional):\n${ctx}`;

  return {
    blockId,
    kind: "info",
    title,
    items: [{ type: "text", text }],
    scoring: { points: 0 },
    meta: { tags: ["info", subjId], difficulty }
  };
}

function genTaskBlock({ i, language, context, courseLabel, difficulty, subjId, qq }) {
  const blockId = `b_task_${i + 1}_${subjId}`.slice(0, 32);

  const title =
    language === "sv"
      ? `Uppgift: ${courseLabel.area}`
      : `Task: ${courseLabel.area}`;

  const ctx = sanitizeContextForDisplay(context, qq);

  const instruction =
    language === "sv"
      ? `Gör en kort uppgift kopplad till ${courseLabel.area}.\n\nUtgångspunkt (om relevant):\n${ctx}`
      : `Complete a short task for ${courseLabel.area}.\n\nStarting point (if relevant):\n${ctx}`;

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

function genDocumentBlock({ i, language, context, courseLabel, difficulty, subjId, qq }) {
  const blockId = `b_doc_${i + 1}_${subjId}`.slice(0, 32);

  const title =
    language === "sv"
      ? `Dokument: ${courseLabel.area}`
      : `Document: ${courseLabel.area}`;

  const ctx = sanitizeContextForDisplay(context, qq);

  const text =
    language === "sv"
      ? `Detta är ett informativt dokument om ${courseLabel.area}.\n\nBakgrund (valfritt):\n${ctx}`
      : `This is an informational document about ${courseLabel.area}.\n\nBackground (optional):\n${ctx}`;

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

function genQuestionBlock({ i, n, count, language, context, courseLabel, difficulty, subjId, bundle, questionType, qq, batch }) {
  const blockId = `b_q_${i + 1}_${subjId}`.slice(0, 32);

  const title =
    language === "sv"
      ? `Kontrollfråga: ${courseLabel.area}`
      : `Check question: ${courseLabel.area}`;

  // P0: försök generera unik fråga (fail-closed om vi misslyckas)
  let q = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const nn = (n ^ (attempt * 0x9e3779b9)) >>> 0;

    const cand = makeQuestion({
      n: nn,
      i,
      count,
      language,
      context,
      courseLabel,
      difficulty,
      subjId,
      questionType,
      bundle,
      qq,
      batch
    });

    const stem = safeStr(cand && (cand.text || cand.question || "")).trim();
    if (!stem) continue;

    // P0: forbid placeholders
    if (qq && qq.forbidContextPlaceholderText) {
      if (containsForbiddenPhrase(stem, qq.forbiddenPhrases)) continue;
      if (/\(kontext\s+dolt\)/i.test(stem)) continue;
      if (/\[object\s+object\]/i.test(stem)) continue;
    }

    // P0: near-duplicate check (semantic-ish via Jaccard)
    let nearDup = false;
    for (const prev of (batch && Array.isArray(batch.seenStems) ? batch.seenStems : [])) {
      const sim = jaccardSimilarity(prev, stem);
      if (sim >= (qq ? qq.forbidNearDuplicateThreshold : 0.85)) {
        nearDup = true;
        break;
      }
    }
    if (nearDup) continue;

    // P2: batch-unikhet på best answer text (semantic)
    const bestText = safeStr(cand && cand.bestAnswerText).trim();
    if (bestText) {
      let bestDup = false;
      for (const prevBest of safeArr(batch && batch.seenBestAnswers)) {
        if (normKey(prevBest) === normKey(bestText)) { bestDup = true; break; }
      }
      if (bestDup) continue;
      if (batch && Array.isArray(batch.seenBestAnswers)) batch.seenBestAnswers.push(bestText);
    }

    if (batch && Array.isArray(batch.seenStems)) batch.seenStems.push(stem);
    q = cand;
    break;
  }

  // Fail-closed: om vi inte lyckas skapa unik (hellre fel än duplicat i batch)
  if (!q) {
    throw new Error("DUPLICATE_QUESTION_IN_BATCH");
  }

  // ta bort internfält innan lagring
  const qOut = { ...q };
  delete qOut.bestAnswerText;

  return {
    blockId,
    kind: "question",
    title,
    items: [{ type: "questionInline", question: qOut }],
    scoring: { points: 1 },
    meta: { tags: ["question", subjId], difficulty }
  };
}

// ------------------------------
// QUESTION (choice-format, ruleset-quality)
// ------------------------------
function makeQuestion({ n, i, count, language, context, courseLabel, difficulty, subjId, questionType, bundle, qq, batch }) {
  const qt = normalizeQuestionType(questionType);
  const isTf = (qt === "tf");
  const isMulti = (qt === "mcq_multi");
  const isMcq = (qt === "mcq_single" || qt === "mcq_multi");

  // PATCH: lås MCQ till exakt 5 alternativ (TF=2)
  const choiceCount = isTf ? 2 : (isMcq ? 5 : (3 + (n % 3)));

  // ---- Dimension rotation (StepProfile först) ----
  const dimsDefault = [
    "definition_or_concept",
    "routine_first_step",
    "risk_consequence",
    "scenario_application",
    "roles_and_responsibility",
    "deviation_and_action"
  ];

  const rotateBase = (qq && qq.variation && qq.variation.rotateDims && qq.variation.rotateDims.length)
    ? qq.variation.rotateDims
    : dimsDefault;

  const stepDims = getStepProfile(courseLabel.step);
  const rotate = (stepDims && stepDims.length) ? stepDims.concat(rotateBase.filter(d => !stepDims.includes(d))) : rotateBase;

  const dimIndex = (i + (n % rotate.length)) % rotate.length;
  let dim = rotate[dimIndex] || "scenario_application";

  if (batch && batch.seenDims && count > 1) {
    const minDistinct = (qq && qq.variation && qq.variation.minDistinctDims) ? qq.variation.minDistinctDims : 3;
    if (batch.seenDims.size < Math.min(minDistinct, count)) {
      for (let t = 0; t < rotate.length; t++) {
        const d2 = rotate[(dimIndex + t) % rotate.length];
        if (d2 && !batch.seenDims.has(d2)) { dim = d2; break; }
      }
    }
    batch.seenDims.add(dim);
  }

  // ---- Scenario-variation ----
  const scenariosSv = [
    { place: "på morgonmötet", role: "du som medarbetare", event: "ni ska enas om vad som gäller" },
    { place: "i köket", role: "du som ansvarig", event: "en rutin ska följas direkt" },
    { place: "vid en leverans", role: "du som tar emot", event: "något avviker från förväntan" },
    { place: "i en internkontroll", role: "du som kontrollerar", event: "du behöver säkerställa spårbarhet" },
    { place: "i dialog med chef", role: "du som rapporterar", event: "en avvikelse ska hanteras korrekt" }
  ];
  const scenariosEn = [
    { place: "in the morning briefing", role: "you as the employee", event: "you need shared understanding" },
    { place: "in the kitchen", role: "you as the responsible person", event: "a routine must be followed" },
    { place: "during a delivery", role: "you as receiver", event: "something deviates" },
    { place: "in an internal check", role: "you as the checker", event: "you need traceability" },
    { place: "in a manager dialogue", role: "you as reporter", event: "a deviation must be handled" }
  ];
  const sc = (language === "sv" ? scenariosSv : scenariosEn)[(n + i) % 5];

  const area = courseLabel.area || (language === "sv" ? "utbildning" : "training");

  function stemForDimension() {
    if (language === "sv") {
      if (dim === "definition_or_concept") return `Vad beskriver bäst kärnan i ${area} när ni vill ha tydlighet ${sc.place}?`;
      if (dim === "routine_first_step") return `När ${sc.event} i ${area} ${sc.place} – vad är bästa första steget?`;
      if (dim === "risk_consequence") return `Vilken risk ökar mest om ni hoppar över första steget i ${area} ${sc.place}?`;
      if (dim === "roles_and_responsibility") return `I ${area} ${sc.place}, vem bör ta första ansvaret för att starta rätt rutin – och varför?`;
      if (dim === "deviation_and_action") return `Om något avviker i ${area} ${sc.place}, vilket första agerande är mest korrekt?`;
      return `I ${area} ${sc.place}, vilket val leder till bäst start för ${sc.role}?`;
    }

    if (dim === "definition_or_concept") return `Which option best captures the core of ${area} when you need clarity ${sc.place}?`;
    if (dim === "routine_first_step") return `When ${sc.event} in ${area} ${sc.place}, what is the best first step?`;
    if (dim === "risk_consequence") return `Which risk increases most if you skip the first step in ${area} ${sc.place}?`;
    if (dim === "roles_and_responsibility") return `In ${area} ${sc.place}, who should take the first responsibility to start the right routine—and why?`;
    if (dim === "deviation_and_action") return `If something deviates in ${area} ${sc.place}, what first action is most correct?`;
    return `In ${area} ${sc.place}, which choice gives the best start for ${sc.role}?`;
  }

  let text = stemForDimension();

  if (qq && qq.forbidContextPlaceholderText) {
    text = stripAnyBracketedContext(text);
    if (containsForbiddenPhrase(text, qq.forbiddenPhrases)) {
      text = (language === "sv")
        ? `I ${area} ${sc.place}, vilket val ger tydligast start?`
        : `In ${area} ${sc.place}, which choice gives the clearest start?`;
    }
  }

  // --- choices ---
  const choices = [];

  if (isTf) {
    choices.push({ id: "c1", text: (language === "sv") ? "Sant" : "True" });
    choices.push({ id: "c2", text: (language === "sv") ? "Falskt" : "False" });
  } else {
    // P0: Semantiskt facit = välj best answer explicit per dimension (med flera varianter)
    const pools = getChoicePools(language);

    const bestVariants = safeArr(pools.bestByDim[dim] || pools.bestByDim.scenario_application);
    const distractors = safeArr(pools.distractorsByDim[dim] || pools.distractorsByDim.scenario_application);

    // välj best som inte redan används i batch (om möjligt)
    let best = "";
    const start = (n ^ hash32(`${dim}|${courseLabel.step}|${i}`)) >>> 0;
    for (let t = 0; t < bestVariants.length; t++) {
      const cand = bestVariants[(start + t) % bestVariants.length];
      if (!cand) continue;
      const dup = safeArr(batch && batch.seenBestAnswers).some(x => normKey(x) === normKey(cand));
      if (!dup) { best = cand; break; }
    }
    if (!best) best = bestVariants[start % Math.max(1, bestVariants.length)] || (language === "sv" ? "Klargör mål och avgränsning innan åtgärd" : "Clarify goal and scope before acting");

    // bygg alternativ: best + 4 distraktorer (plausibla men sämre givet scope)
    const picked = [];
    picked.push(best);

    // deterministisk distraktor-sampling (unika texter)
    const seen = new Set([normKey(best)]);
    let cursor = (start ^ hash32(safeStr(context).slice(0, 96))) >>> 0;

    while (picked.length < choiceCount && picked.length < 32) {
      cursor = (cursor * 1664525 + 1013904223) >>> 0;
      const cand = distractors[cursor % Math.max(1, distractors.length)] || "";
      const k = normKey(cand);
      if (!cand || !k || seen.has(k)) continue;
      seen.add(k);
      picked.push(cand);
    }

    // fail-soft: fyll om vi saknar
    while (picked.length < choiceCount) {
      const cand = distractors[(picked.length + (start % 7)) % Math.max(1, distractors.length)] || "";
      const k = normKey(cand);
      if (cand && k && !seen.has(k)) { seen.add(k); picked.push(cand); continue; }
      // sista utväg
      picked.push(language === "sv" ? "Be någon annan bestämma utan underlag" : "Let someone else decide without facts");
    }

    // blanda ordningen deterministiskt men spåra index för best
    const order = shuffledIndices(choiceCount, start);
    let bestIndex = -1;

    for (let idx = 0; idx < choiceCount; idx++) {
      const srcIndex = order[idx];
      const txt = safeStr(picked[srcIndex]).trim();
      if (!txt) continue;
      if (normKey(txt) === normKey(best)) bestIndex = choices.length;
      choices.push({ id: `c${choices.length + 1}`, text: txt });
    }

    // säkerställ count exakt
    while (choices.length < choiceCount) {
      choices.push({ id: `c${choices.length + 1}`, text: language === "sv" ? "Samla in mer fakta innan ni bestämmer" : "Collect more facts before deciding" });
    }
    while (choices.length > choiceCount) choices.pop();

    // om best tappades (ska inte ske), sätt bestIndex till 0
    if (bestIndex < 0) bestIndex = 0;

    // Correct kopplas till best answer (P0)
    const correctChoiceId = `c${bestIndex + 1}`;
    const bestAnswerText = choices[bestIndex] ? choices[bestIndex].text : best;

    // Multi: välj 2 “best-ish” (inte fokus just nu, men kontrakt finns)
    let correctChoiceIds = null;
    if (isMulti && choiceCount >= 3) {
      const idx2 = (bestIndex + 1) % choiceCount;
      correctChoiceIds = [`c${bestIndex + 1}`, `c${idx2 + 1}`];
    }

    // P0: Rationale kopplat till best answer + dim/scope
    let rationale = buildRationale({
      language,
      dim,
      area,
      place: sc.place,
      bestAnswerText,
      step: courseLabel.step
    });

    if (qq && qq.requireExplanation) {
      if (safeStr(rationale).trim().length < (qq.explanationMinChars || 40)) {
        rationale = (language === "sv")
          ? `Förklaring: Det bästa valet är "${bestAnswerText}" eftersom det skapar tydlighet om vad som gäller i just den här situationen, innan ni går vidare med åtgärd eller uppföljning.`
          : `Explanation: The best choice is "${bestAnswerText}" because it creates clarity for this situation before you act or follow up.`;
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
      tags: [subjId, "scenario", dim, `step_${safeStr(courseLabel.step).trim() || "1"}`],
      bestAnswerText // intern, används för batch-unikhet, tas bort i genQuestionBlock
    };
  }

  // TF (behåll enkelhet)
  const correctChoiceId = "c1";
  const rationale =
    (language === "sv")
      ? "Förklaring: Bedöm påståendet strikt som sant eller falskt utan gråzoner."
      : "Explanation: Evaluate strictly as true or false without gray areas.";

  return {
    kind: "question",
    text,
    choices,
    correctChoiceId,
    rationale,
    difficulty,
    tags: [subjId, "tf", dim, `step_${safeStr(courseLabel.step).trim() || "1"}`]
  };
}

function shuffledIndices(n, seed) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(i);
  let s = seed >>> 0;
  // Fisher-Yates deterministisk
  for (let i = n - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function getChoicePools(language) {
  if (language === "sv") {
    return {
      bestByDim: {
        definition_or_concept: [
          "En gemensam standard för hur ni arbetar och följer upp",
          "Ett sätt att skapa spårbarhet och förbättring över tid",
          "Tydliga arbetssätt som kan följas, mätas och förbättras"
        ],
        routine_first_step: [
          "Klargör mål och avgränsning innan åtgärd",
          "Samla fakta och kontrollera relevant rutin/checklista",
          "Säkerställ vem som ansvarar för nästa steg"
        ],
        risk_consequence: [
          "Missförstånd och olika tolkningar i teamet",
          "Brist på spårbarhet när ni ska följa upp",
          "Att fel åtgärd görs på fel problem"
        ],
        scenario_application: [
          "Välj ett första steg i rutinen och bekräfta ansvar",
          "Gör en snabb kontroll mot checklista innan beslut",
          "Klargör nästa steg och hur ni följer upp"
        ],
        roles_and_responsibility: [
          "Den som äger rutinen tar första initiativet och fördelar ansvar",
          "Den utsedda ansvariga rollen startar och säkrar samordning",
          "Den som har mandat för rutinen initierar och förankrar nästa steg"
        ],
        deviation_and_action: [
          "Stoppa och avgränsa: vad avviker, hur stort, vem berörs?",
          "Säkra fakta och dokumentera avvikelsen innan ni ändrar något",
          "Informera rätt roller och starta en kontrollerad uppföljning"
        ]
      },
      distractorsByDim: {
        definition_or_concept: [
          "En lista med valfria tips utan uppföljning",
          "En snabb lösning som passar alla situationer",
          "En personlig åsikt om vad som känns bäst",
          "Att hoppa över dokumentation för att spara tid",
          "Att alltid göra som man brukar utan kontroll"
        ],
        routine_first_step: [
          "Starta åtgärd direkt utan att avgränsa",
          "Vänta tills någon annan tar initiativ",
          "Byt rutin direkt utan att kontrollera fakta",
          "Fokusera på att det ska gå snabbt snarare än rätt",
          "Diskutera länge utan att bestämma nästa steg"
        ],
        risk_consequence: [
          "Att allt går snabbare utan kontroll",
          "Att uppföljning blir enklare av sig själv",
          "Att spårbarhet förbättras automatiskt",
          "Att avvikelser minskar utan åtgärd",
          "Att ansvar blir tydligt även utan beslut"
        ],
        scenario_application: [
          "Låt bli att dokumentera för att spara tid",
          "Gå direkt på en lösning utan att kontrollera scope",
          "Låt varje person välja sin egen tolkning",
          "Vänta tills problemet återkommer",
          "Ignorera skillnader för att undvika konflikt"
        ],
        roles_and_responsibility: [
          "Den som har mest tid tar ansvar oavsett roll",
          "Alla gör sin egen tolkning utan samordning",
          "Ingen tar ansvar förrän någon säger till",
          "Den som sist såg problemet tar hela ansvaret",
          "Den som pratar högst bestämmer"
        ],
        deviation_and_action: [
          "Fortsätt som vanligt och hoppas att det löser sig",
          "Ändra rutin direkt utan att dokumentera",
          "Vänta tills nästa vecka och se om det återkommer",
          "Informera ingen för att undvika oro",
          "Gör en snabb fix utan att följa upp"
        ]
      }
    };
  }

  return {
    bestByDim: {
      definition_or_concept: [
        "A shared standard for how you work and follow up",
        "A way to ensure traceability and improvement over time",
        "Clear ways of working that can be measured and improved"
      ],
      routine_first_step: [
        "Clarify goal and scope before acting",
        "Gather key facts and check the relevant routine/checklist",
        "Confirm who owns the next step"
      ],
      risk_consequence: [
        "Misunderstanding and different interpretations in the team",
        "Lack of traceability when you need to follow up",
        "Doing the wrong action for the wrong problem"
      ],
      scenario_application: [
        "Choose the first routine step and confirm responsibility",
        "Do a quick checklist check before deciding",
        "Clarify next step and how you will follow up"
      ],
      roles_and_responsibility: [
        "The routine owner starts and assigns responsibility",
        "The designated responsible role starts and coordinates",
        "Whoever has mandate initiates and aligns the next step"
      ],
      deviation_and_action: [
        "Stop and scope: what deviates, how big, who is affected?",
        "Secure facts and document the deviation before changing anything",
        "Inform the right roles and start controlled follow-up"
      ]
    },
    distractorsByDim: {
      definition_or_concept: [
        "A list of optional tips without follow-up",
        "A quick fix that fits every situation",
        "A personal opinion about what feels best",
        "Skip documentation to save time",
        "Always do what you usually do"
      ],
      routine_first_step: [
        "Act immediately without scoping",
        "Wait until someone else takes initiative",
        "Change the routine without checking facts",
        "Focus on speed over correctness",
        "Discuss a long time without deciding next step"
      ],
      risk_consequence: [
        "Everything becomes faster without checks",
        "Follow-up becomes easier automatically",
        "Traceability improves by itself",
        "Deviations decrease without action",
        "Responsibility becomes clear without decision"
      ],
      scenario_application: [
        "Avoid documenting to save time",
        "Jump to a solution without checking scope",
        "Let everyone choose their own interpretation",
        "Wait until the problem returns",
        "Ignore differences to avoid conflict"
      ],
      roles_and_responsibility: [
        "Whoever has time takes responsibility regardless of role",
        "Everyone makes their own interpretation without alignment",
        "No one takes responsibility until told",
        "Whoever noticed last owns everything",
        "Whoever speaks loudest decides"
      ],
      deviation_and_action: [
        "Continue as usual and hope it resolves",
        "Change the routine immediately without documenting",
        "Wait until next week and see if it returns",
        "Tell no one to avoid concern",
        "Do a quick fix without follow-up"
      ]
    }
  };
}

function buildRationale({ language, dim, area, place, bestAnswerText, step }) {
  const s = safeStr(step).trim() || "1";

  if (language === "sv") {
    if (dim === "definition_or_concept") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom kärnan i ${area} är att ni arbetar likadant och kan följa upp på samma sätt. Det blir extra viktigt ${place} när ni behöver en gemensam tolkning innan ni går vidare.`;
    }
    if (dim === "routine_first_step") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom ett bra förstasteg sätter ramarna (mål, avgränsning och nästa steg). Då blir efterföljande åtgärder relevanta, spårbara och lättare att följa upp. (Steg ${s})`;
    }
    if (dim === "risk_consequence") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom den största risken när ni hoppar över startmomentet är att ni agerar på olika bilder av läget. Då blir beslut, ansvar och uppföljning spretiga – särskilt ${place}.`;
    }
    if (dim === "roles_and_responsibility") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom den som äger/har mandat för rutinen kan säkra att ni följer samma arbetssätt och att ansvar fördelas tydligt. Det minskar “ingen tar tag i det” ${place}. (Steg ${s})`;
    }
    if (dim === "deviation_and_action") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom första åtgärden vid avvikelse är att stoppa, avgränsa och säkra fakta. Annars riskerar ni att “fixa fel sak” och tappa spårbarhet när ni senare ska följa upp.`;
    }
    return `Förklaring: "${bestAnswerText}" är rätt eftersom det skapar tydlighet i situationen ${place}: vad som gäller nu, vem som gör nästa steg och hur ni följer upp.`;
  }

  if (dim === "definition_or_concept") {
    return `Explanation: "${bestAnswerText}" is correct because the core of ${area} is consistent ways of working and follow-up. This matters ${place} when you need a shared interpretation before moving on.`;
  }
  if (dim === "routine_first_step") {
    return `Explanation: "${bestAnswerText}" is correct because a strong first step sets the frame (goal, scope, next step). That makes later actions relevant, traceable, and easier to follow up. (Step ${s})`;
  }
  if (dim === "risk_consequence") {
    return `Explanation: "${bestAnswerText}" is correct because skipping the start increases the risk of acting on different interpretations. Decisions and follow-up become inconsistent—especially ${place}.`;
  }
  if (dim === "roles_and_responsibility") {
    return `Explanation: "${bestAnswerText}" is correct because the routine owner/mandated role can align the team and assign responsibility clearly. This reduces “no one owns it” behavior ${place}. (Step ${s})`;
  }
  if (dim === "deviation_and_action") {
    return `Explanation: "${bestAnswerText}" is correct because the first action in a deviation is to stop, scope, and secure facts. Otherwise you risk fixing the wrong thing and losing traceability for follow-up.`;
  }
  return `Explanation: "${bestAnswerText}" is correct because it creates clarity ${place}: what applies now, who owns the next step, and how you will follow up.`;
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
