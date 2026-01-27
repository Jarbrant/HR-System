// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.5 QUALITY)
// FIL: worker/index.js
// Mål: Lås worker-output till training-blocks + UI-frågeformat när MCQ begärs.
//      FIX: Undvik “samma frågor”, förbjud placeholder-fraser, kräver förklaring,
//           och gör batchen unik (dedupe) + bättre variation.
//
// PATCH v1.5.5 (HYG + VARIATION):
// - P0: Slutar injicera courseLabel.area (t.ex. "ISO 9001") i question/options/explanation/feedback.
// - P0: Tar bort förbjudna domänord i Q-fält: "steg/steget/modul/kapitel/kurs/utbildning".
// - P1: Mer scen-variation + workplace-infer från context (utan ny datamodell).
// - P2: true/false får korrekt correctIndex (baserat på correctChoiceId).
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
const VERSION = "1.5.5";

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
  // FAIL-CLOSED DEFAULTS (v1.5.5): även om ruleset saknas ska vi:
  // - kräva förklaring
  // - förbjuda placeholder/kontext-artefakter
  // - ha en default-lista förbjudna fraser
  const qp = bundle && bundle.rulesets && bundle.rulesets.training_prompt;
  const q = (qp && qp.questionQuality) ? qp.questionQuality : null;

  const defaultForbidden = [
    "(kontext dolt)",
    "[object object]",
    "lorem",
    "placeholder",
    "fyll i",
    "exempeltext",
    "todo",
    "tbd",
    "n/a"
  ];

  const forbiddenPhrases = safeArr(q && q.general && q.general.forbiddenPhrases).filter(Boolean);
  const mergedForbidden = (forbiddenPhrases.length ? forbiddenPhrases : defaultForbidden);

  const forbidContextPlaceholderText = (q && q.general && typeof q.general.forbidContextPlaceholderText === "boolean")
    ? !!q.general.forbidContextPlaceholderText
    : true;

  const requireExplanation = (q && q.general && typeof q.general.requireExplanation === "boolean")
    ? !!q.general.requireExplanation
    : true;

  const explanationMinChars = (Number(q && q.general && q.general.explanationMinChars) || 60);

  const nearDupThreshold = Number(q && q.general && q.general.batchUniqueness && q.general.batchUniqueness.forbidNearDuplicateThreshold);
  const forbidNearDuplicateThreshold = Number.isFinite(nearDupThreshold) ? nearDupThreshold : 0.85;

  const rotateDims = safeArr(q && q.general && q.general.variationPlan && q.general.variationPlan.rotateDimensions).filter(Boolean);
  const minDistinctDims = Number(q && q.general && q.general.variationPlan && q.general.variationPlan.minimumDistinctDimensionsInBatch) || 3;

  const minOptions = Number(q && q.mcq && q.mcq.minOptions) || 4;
  const maxOptions = Number(q && q.mcq && q.mcq.maxOptions) || 6;

  return {
    forbidContextPlaceholderText,
    forbiddenPhrases: mergedForbidden,
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

function escapeRegExp(s) {
  return safeStr(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function removeWordTokens(text, words) {
  let out = safeStr(text);
  const list = safeArr(words).map(w => safeStr(w).trim()).filter(Boolean);
  if (!out || list.length === 0) return out;

  // Unicode-aware "word" removal without relying on \b.
  // Replace occurrences where the token is separated by non-letter/number or edges.
  for (const w of list) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(w)})(?=[^\\p{L}\\p{N}]|$)`, "giu");
    out = out.replace(re, "$1");
  }

  out = out.replace(/\s{2,}/g, " ").trim();
  return out;
}

function removeAreaInjection(text, courseLabel) {
  const out0 = safeStr(text);
  const area = safeStr(courseLabel && courseLabel.area).trim();
  if (!out0 || !area) return out0;

  // Remove exact area string occurrences (case-insens).
  const re = new RegExp(escapeRegExp(area), "giu");
  const out = out0.replace(re, "").replace(/\s{2,}/g, " ").trim();

  return out;
}

function sanitizeQuestionPayload(q, courseLabel, qq, language, place) {
  // P0: remove area injection + domain words from question/options/explanation/feedback.
  // Also fail-closed against placeholder phrases.
  const forbiddenDomainWords = ["steg", "steget", "modul", "kapitel", "kurs", "utbildning"];

  function clean(s) {
    let t = safeStr(s).trim();
    if (!t) return "";

    t = removeAreaInjection(t, courseLabel);
    t = removeWordTokens(t, forbiddenDomainWords);
    t = stripAnyBracketedContext(t);

    // Avoid leftover double punctuation / spaces
    t = t.replace(/\s{2,}/g, " ").trim();
    t = t.replace(/\s+([?.!,;:])/g, "$1").trim();
    t = t.replace(/([?.!,;:]){2,}/g, "$1").trim();

    // Fail-closed: remove forbidden phrases by nuking to empty (caller will fallback)
    if (qq && qq.forbidContextPlaceholderText) {
      if (containsForbiddenPhrase(t, qq.forbiddenPhrases)) return "";
      if (/\(kontext\s+dolt\)/i.test(t)) return "";
      if (/\[object\s+object\]/i.test(t)) return "";
    }

    return t;
  }

  const out = { ...q };

  out.text = clean(out.text);

  if (Array.isArray(out.choices)) {
    out.choices = out.choices
      .map(c => {
        const cc = isPlainObject(c) ? { ...c } : { id: "", text: "" };
        cc.text = clean(cc.text);
        return cc;
      })
      .filter(c => safeStr(c.text).trim().length > 0);
  }

  out.rationale = clean(out.rationale || out.explanation || out.feedback || "");

  // If sanitization collapsed critical fields: fail-soft with safe minimal text
  if (!safeStr(out.text).trim()) {
    out.text = (language === "sv")
      ? `Vilket val är mest korrekt ${safeStr(place).trim() || ""}?`.trim()
      : `Which choice is most correct ${safeStr(place).trim() || ""}?`.trim();
  }

  // Ensure we still have choices for non-TF MCQ
  if (Array.isArray(out.choices) && out.choices.length > 0) {
    // Keep ids stable-ish if any were removed
    for (let i = 0; i < out.choices.length; i++) {
      if (!safeStr(out.choices[i].id).trim()) out.choices[i].id = `c${i + 1}`;
    }
  }

  // Enforce minimum explanation length if required
  if (qq && qq.requireExplanation) {
    const minLen = Number(qq.explanationMinChars) || 60;
    const r = safeStr(out.rationale).trim();
    if (r.length < minLen) {
      const bestText = safeStr(out.bestAnswerText || "").trim();
      out.rationale = (language === "sv")
        ? `Förklaring: Det bästa valet är "${bestText || "det mest tydliga alternativet"}" eftersom det skapar klarhet ${place} innan ni går vidare med åtgärd och uppföljning.`
        : `Explanation: The best choice is "${bestText || "the clearest option"}" because it creates clarity ${place} before you act and follow up.`;
    }
  }

  return out;
}

// ============================================================
// STEP PROFILE (1–5) → styr frågedimensioner
// ============================================================
function getStepProfile(step) {
  const s = safeStr(step).trim();
  // 1) igenkänning  2) roller/rutin  3) tillämpning  4) risk  5) avvikelse/uppföljning
  if (s === "1") return ["definition_or_concept", "routine_start", "scenario_application"];
  if (s === "2") return ["roles_and_responsibility", "routine_start", "scenario_application"];
  if (s === "3") return ["scenario_application", "routine_start", "roles_and_responsibility"];
  if (s === "4") return ["risk_consequence", "scenario_application", "routine_start"];
  if (s === "5") return ["deviation_and_action", "risk_consequence", "roles_and_responsibility"];
  return [];
}

// ============================================================
// Workplace inference (P1) — utan ny datamodell
// ============================================================
function inferWorkplaceFromContext(contextText, language) {
  const t = safeStr(contextText).toLowerCase();

  // SV-keywords
  if (t.includes("kök") || t.includes("restaurang") || t.includes("servering")) return (language === "sv") ? "i köket" : "in the kitchen";
  if (t.includes("leverans") || t.includes("mottagning") || t.includes("varumottag")) return (language === "sv") ? "vid varumottagningen" : "at receiving";
  if (t.includes("internkontroll") || t.includes("revision") || t.includes("audit")) return (language === "sv") ? "i en internkontroll" : "in an internal check";
  if (t.includes("morgonmöte") || t.includes("brief") || t.includes("standup")) return (language === "sv") ? "på ett kort avstämningsmöte" : "in a short briefing";

  return (language === "sv") ? "på arbetsplatsen" : "at work";
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
      : (language === "sv" ? `${courseLabel.module} – ${courseLabel.area}` : `${courseLabel.module} – ${courseLabel.area}`);

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
    seenBestAnswers: [],
    seenCorrectSlots: new Set()
  };

  for (let i = 0; i < count; i++) {
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
      source: "mock-v1.5.5"
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

  // Titel får gärna bära område (UI runtom), men själva question/options ska vara "verklighetsspråk"
  const title =
    language === "sv"
      ? `Kontrollfråga: ${courseLabel.area}`
      : `Check question: ${courseLabel.area}`;

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

    if (qq && qq.forbidContextPlaceholderText) {
      if (containsForbiddenPhrase(stem, qq.forbiddenPhrases)) continue;
      if (/\(kontext\s+dolt\)/i.test(stem)) continue;
      if (/\[object\s+object\]/i.test(stem)) continue;
    }

    let nearDup = false;
    for (const prev of (batch && Array.isArray(batch.seenStems) ? batch.seenStems : [])) {
      const sim = jaccardSimilarity(prev, stem);
      if (sim >= (qq ? qq.forbidNearDuplicateThreshold : 0.85)) {
        nearDup = true;
        break;
      }
    }
    if (nearDup) continue;

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

  if (!q) {
    throw new Error("DUPLICATE_QUESTION_IN_BATCH");
  }

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

  const minOpt = qq && qq.mcq ? (Number(qq.mcq.minOptions) || 4) : 4;
  const maxOpt = qq && qq.mcq ? (Number(qq.mcq.maxOptions) || 6) : 6;

  const choiceCount = isTf
    ? 2
    : (isMcq ? clampInt(5, minOpt, maxOpt) : (3 + (n % 3)));

  const dimsDefault = [
    "definition_or_concept",
    "routine_start",
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

  // P1: workplace-infer från context (utan ny datamodell)
  const place = inferWorkplaceFromContext(context, language);

  const rolesSv = ["du som medarbetare", "du som ansvarig", "du som tar emot", "du som kontrollerar", "du som rapporterar"];
  const rolesEn = ["you as the employee", "you as responsible", "you as receiver", "you as checker", "you as reporter"];
  const role = (language === "sv" ? rolesSv : rolesEn)[(n + i) % 5];

  const eventsSv = [
    "ni behöver bli överens om vad som gäller",
    "en rutin behöver följas direkt",
    "något avviker från det förväntade",
    "ni behöver säkra spårbarhet",
    "en avvikelse behöver hanteras lugnt och korrekt"
  ];
  const eventsEn = [
    "you need shared understanding",
    "a routine must be followed",
    "something deviates from expectations",
    "you need traceability",
    "a deviation must be handled calmly and correctly"
  ];
  const event = (language === "sv" ? eventsSv : eventsEn)[(n + i) % 5];

  // P1: scenlager (utan ny datamodell)
  const triggersSv = ["precis innan ni drar igång", "när det är lite stress", "när en ny kollega är med", "när ni ska byta från plan till handling", "när ni måste bestämma snabbt"];
  const triggersEn = ["right before you start", "when things are a bit stressful", "when a new colleague is involved", "when you move from plan to action", "when you must decide quickly"];
  const trigger = (language === "sv" ? triggersSv : triggersEn)[(n ^ (i * 17)) % 5];

  const constraintsSv = ["ni har 2 minuter", "ni saknar ett underlag", "ni har två olika tolkningar", "en liten detalj är oklar", "ni behöver undvika missförstånd"];
  const constraintsEn = ["you have 2 minutes", "you are missing a supporting note", "you have two different interpretations", "a small detail is unclear", "you need to avoid misunderstandings"];
  const constraint = (language === "sv" ? constraintsSv : constraintsEn)[(n ^ (i * 31)) % 5];

  const artifactsSv = ["en checklista", "en anteckning", "en skylt", "en kort notis", "en enkel loggrad"];
  const artifactsEn = ["a checklist", "a note", "a sign", "a short note", "a simple log line"];
  const artifact = (language === "sv" ? artifactsSv : artifactsEn)[(n ^ (i * 47)) % 5];

  // NOTE (P0): INGA area/ISO-ord i question/options/explanation/feedback
  // NOTE (P0): INGA "steg/steget/modul/kapitel/kurs/utbildning" i Q-fält
  function stemForDimension() {
    if (language === "sv") {
      if (dim === "definition_or_concept") return `Vilket alternativ beskriver bäst syftet med ett tydligt arbetssätt när ni behöver samsyn ${place} (${trigger})?`;
      if (dim === "routine_start") return `När ${event} ${place} (${constraint}) – vad är den bästa startåtgärden?`;
      if (dim === "risk_consequence") return `Vilken risk ökar mest om ni hoppar över startåtgärden ${place}, trots att ni har ${artifact}?`;
      if (dim === "roles_and_responsibility") return `När ni ska få ordning på ett arbetssätt ${place} (${trigger}), vem bör ta första ansvaret – och varför?`;
      if (dim === "deviation_and_action") return `Om något avviker ${place} (${constraint}), vilket första agerande är mest korrekt?`;
      return `Vilket val ger bäst start för ${role} ${place} (${trigger})?`;
    }

    if (dim === "definition_or_concept") return `Which option best captures why a clear way of working matters when you need shared understanding ${place} (${trigger})?`;
    if (dim === "routine_start") return `When ${event} ${place} (${constraint}), what is the best starting action?`;
    if (dim === "risk_consequence") return `Which risk increases most if you skip the starting action ${place}, even though you have ${artifact}?`;
    if (dim === "roles_and_responsibility") return `When you need to align how work is done ${place} (${trigger}), who should take first responsibility—and why?`;
    if (dim === "deviation_and_action") return `If something deviates ${place} (${constraint}), what first action is most correct?`;
    return `Which choice gives the best start for ${role} ${place} (${trigger})?`;
  }

  let text = stemForDimension();

  if (qq && qq.forbidContextPlaceholderText) {
    text = stripAnyBracketedContext(text);
    if (containsForbiddenPhrase(text, qq.forbiddenPhrases)) {
      text = (language === "sv")
        ? `Vilket val ger tydligast start ${place}?`
        : `Which choice gives the clearest start ${place}?`;
    }
  }

  const choices = [];

  if (isTf) {
    // deterministiskt: ibland sant, ibland falskt
    const tfIsTrue = ((n ^ hash32(`${place}|${i}`)) & 1) === 0;
    choices.push({ id: "c1", text: (language === "sv") ? "Sant" : "True" });
    choices.push({ id: "c2", text: (language === "sv") ? "Falskt" : "False" });

    const correctChoiceId = tfIsTrue ? "c1" : "c2";
    const bestAnswerText = tfIsTrue ? choices[0].text : choices[1].text;

    const rationale = buildRationale({
      language,
      dim: "true_false",
      place,
      bestAnswerText
    });

    const outTf = sanitizeQuestionPayload(
      {
        kind: "question",
        text,
        choices,
        correctChoiceId,
        rationale,
        difficulty,
        tags: [subjId, "tf", placeKey(place)],
        bestAnswerText
      },
      courseLabel,
      qq,
      language,
      place
    );

    return outTf;
  }

  const pools = getChoicePools(language);
  const bestVariants = safeArr(pools.bestByDim[dim] || pools.bestByDim.scenario_application);
  const distractors = safeArr(pools.distractorsByDim[dim] || pools.distractorsByDim.scenario_application);

  let best = "";
  const start = (n ^ hash32(`${dim}|${courseLabel.step}|${i}`)) >>> 0;
  for (let t = 0; t < bestVariants.length; t++) {
    const cand = bestVariants[(start + t) % bestVariants.length];
    if (!cand) continue;
    const dup = safeArr(batch && batch.seenBestAnswers).some(x => normKey(x) === normKey(cand));
    if (!dup) { best = cand; break; }
  }
  if (!best) best = bestVariants[start % Math.max(1, bestVariants.length)] || (language === "sv" ? "Klargör mål och avgränsning innan åtgärd" : "Clarify goal and scope before acting");

  const picked = [];
  picked.push(best);

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

  while (picked.length < choiceCount) {
    const cand = distractors[(picked.length + (start % 7)) % Math.max(1, distractors.length)] || "";
    const k = normKey(cand);
    if (cand && k && !seen.has(k)) { seen.add(k); picked.push(cand); continue; }
    picked.push(language === "sv" ? "Be någon annan bestämma utan underlag" : "Let someone else decide without facts");
  }

  const order = shuffledIndices(choiceCount, start);
  let bestIndex = -1;

  for (let idx = 0; idx < choiceCount; idx++) {
    const srcIndex = order[idx];
    const txt = safeStr(picked[srcIndex]).trim();
    if (!txt) continue;
    if (normKey(txt) === normKey(best)) bestIndex = choices.length;
    choices.push({ id: `c${choices.length + 1}`, text: txt });
  }

  while (choices.length < choiceCount) {
    choices.push({ id: `c${choices.length + 1}`, text: language === "sv" ? "Samla in mer fakta innan ni bestämmer" : "Collect more facts before deciding" });
  }
  while (choices.length > choiceCount) choices.pop();

  if (bestIndex < 0) bestIndex = 0;

  const correctChoiceId = `c${bestIndex + 1}`;
  const bestAnswerText = choices[bestIndex] ? choices[bestIndex].text : best;

  let correctChoiceIds = null;
  if (isMulti && choiceCount >= 3) {
    const idx2 = (bestIndex + 1) % choiceCount;
    correctChoiceIds = [`c${bestIndex + 1}`, `c${idx2 + 1}`];
  }

  let rationale = buildRationale({
    language,
    dim,
    place,
    bestAnswerText
  });

  if (qq && qq.requireExplanation) {
    if (safeStr(rationale).trim().length < (qq.explanationMinChars || 60)) {
      rationale = (language === "sv")
        ? `Förklaring: Det bästa valet är "${bestAnswerText}" eftersom det skapar tydlighet i situationen ${place} innan ni går vidare med åtgärd och uppföljning.`
        : `Explanation: The best choice is "${bestAnswerText}" because it creates clarity ${place} before you act and follow up.`;
    }
  }

  const out = sanitizeQuestionPayload(
    {
      kind: "question",
      text,
      choices,
      correctChoiceId,
      ...(correctChoiceIds ? { correctChoiceIds } : {}),
      rationale,
      difficulty,
      tags: [subjId, "scenario", dim, placeKey(place)],
      bestAnswerText
    },
    courseLabel,
    qq,
    language,
    place
  );

  // Fail-closed: ensure correctChoiceId still points to an existing choice id after sanitization
  const ids = new Set(safeArr(out.choices).map(c => safeStr(c && c.id).trim()).filter(Boolean));
  if (!ids.has(safeStr(out.correctChoiceId).trim())) {
    out.correctChoiceId = safeStr(out.choices && out.choices[0] && out.choices[0].id).trim() || "c1";
  }
  if (Array.isArray(out.correctChoiceIds)) {
    out.correctChoiceIds = out.correctChoiceIds.filter(id => ids.has(safeStr(id).trim()));
    if (out.correctChoiceIds.length === 0) out.correctChoiceIds = [out.correctChoiceId];
  }

  // Ensure we keep at least 2 choices (otherwise UI mapping fails)
  if (!Array.isArray(out.choices) || out.choices.length < 2) {
    out.choices = [
      { id: "c1", text: (language === "sv") ? "Samla fakta innan beslut" : "Gather facts before deciding" },
      { id: "c2", text: (language === "sv") ? "Bekräfta ansvar och nästa åtgärd" : "Confirm ownership and next action" }
    ];
    out.correctChoiceId = "c2";
    if (isMulti) out.correctChoiceIds = ["c2"];
  }

  return out;
}

function placeKey(place) {
  const k = normKey(place).replace(/\s+/g, "_");
  return k ? `place_${k}` : "place_generic";
}

function shuffledIndices(n, seed) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(i);
  let s = seed >>> 0;
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
          "Ett gemensamt arbetssätt som kan följas upp och förbättras",
          "Tydliga rutiner som minskar missförstånd i teamet",
          "En standard som gör att ni gör rätt sak på rätt sätt"
        ],
        routine_start: [
          "Klargör mål och avgränsning innan ni agerar",
          "Samla fakta och kontrollera relevant rutin/checklista",
          "Säkerställ vem som ansvarar för nästa åtgärd"
        ],
        risk_consequence: [
          "Missförstånd och olika tolkningar i teamet",
          "Brist på spårbarhet när ni ska följa upp",
          "Att fel åtgärd görs på fel problem"
        ],
        scenario_application: [
          "Välj startåtgärd och bekräfta ansvar",
          "Gör en snabb kontroll mot checklista innan beslut",
          "Klargör nästa åtgärd och hur ni följer upp"
        ],
        roles_and_responsibility: [
          "Den som äger rutinen tar initiativet och fördelar ansvar",
          "Den utsedda ansvariga rollen startar och säkrar samordning",
          "Den som har mandat initierar och förankrar nästa åtgärd"
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
        routine_start: [
          "Starta åtgärd direkt utan att avgränsa",
          "Vänta tills någon annan tar initiativ",
          "Byt rutin direkt utan att kontrollera fakta",
          "Fokusera på att det ska gå snabbt snarare än rätt",
          "Diskutera länge utan att bestämma nästa åtgärd"
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
          "Gå direkt på en lösning utan att avgränsa",
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
        "A shared way of working that can be followed up and improved",
        "Clear routines that reduce misunderstandings in the team",
        "A standard that helps you do the right thing the right way"
      ],
      routine_start: [
        "Clarify goal and scope before acting",
        "Gather key facts and check the relevant routine/checklist",
        "Confirm who owns the next action"
      ],
      risk_consequence: [
        "Misunderstanding and different interpretations in the team",
        "Lack of traceability when you need to follow up",
        "Doing the wrong action for the wrong problem"
      ],
      scenario_application: [
        "Choose a starting action and confirm responsibility",
        "Do a quick checklist check before deciding",
        "Clarify the next action and how you will follow up"
      ],
      roles_and_responsibility: [
        "The routine owner starts and assigns responsibility",
        "The designated responsible role starts and coordinates",
        "Whoever has mandate initiates and aligns the next action"
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
      routine_start: [
        "Act immediately without scoping",
        "Wait until someone else takes initiative",
        "Change the routine without checking facts",
        "Focus on speed over correctness",
        "Discuss a long time without deciding next action"
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
        "Jump to a solution without scoping",
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

function buildRationale({ language, dim, place, bestAnswerText }) {
  if (language === "sv") {
    if (dim === "definition_or_concept") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom tydliga arbetssätt gör att ni kan följa upp på samma sätt och förbättra utan missförstånd, särskilt ${place}.`;
    }
    if (dim === "routine_start") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom en bra startåtgärd sätter ramarna (mål, avgränsning och ansvar) innan ni går vidare. Det gör uppföljning enkel och spårbar ${place}.`;
    }
    if (dim === "risk_consequence") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom största risken när man hoppar över startåtgärden är att teamet agerar på olika bilder av läget. Då blir ansvar och uppföljning spretigt ${place}.`;
    }
    if (dim === "roles_and_responsibility") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom den som äger/har mandat för rutinen kan säkra samsyn och tydligt ansvar. Det minskar risken att “ingen tar tag i det” ${place}.`;
    }
    if (dim === "deviation_and_action") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom första agerandet vid avvikelse är att stoppa, avgränsa och säkra fakta. Annars riskerar ni att åtgärda fel sak och tappa spårbarhet ${place}.`;
    }
    if (dim === "true_false") {
      return `Förklaring: "${bestAnswerText}" är facit här. Bedöm påståendet strikt utan gråzoner, och välj det alternativ som stämmer bäst i situationen ${place}.`;
    }
    return `Förklaring: "${bestAnswerText}" är rätt eftersom det skapar tydlighet ${place}: vad som gäller nu, vem som gör nästa åtgärd och hur ni följer upp.`;
  }

  if (dim === "definition_or_concept") {
    return `Explanation: "${bestAnswerText}" is correct because clear ways of working enable consistent follow-up and improvement, especially ${place}.`;
  }
  if (dim === "routine_start") {
    return `Explanation: "${bestAnswerText}" is correct because a strong starting action sets goal, scope, and responsibility before you act. This makes follow-up traceable ${place}.`;
  }
  if (dim === "risk_consequence") {
    return `Explanation: "${bestAnswerText}" is correct because skipping the starting action increases the risk of acting on different interpretations. Ownership and follow-up become inconsistent ${place}.`;
  }
  if (dim === "roles_and_responsibility") {
    return `Explanation: "${bestAnswerText}" is correct because the routine owner/mandated role can align the team and assign responsibility clearly ${place}.`;
  }
  if (dim === "deviation_and_action") {
    return `Explanation: "${bestAnswerText}" is correct because the first action in a deviation is to stop, scope, and secure facts. Otherwise you risk fixing the wrong thing and losing traceability ${place}.`;
  }
  if (dim === "true_false") {
    return `Explanation: "${bestAnswerText}" is the answer here. Evaluate strictly and pick the option that best matches the situation ${place}.`;
  }
  return `Explanation: "${bestAnswerText}" is correct because it creates clarity ${place}: what applies now, who owns the next action, and how you will follow up.`;
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
    const correctId = safeStr(q.correctChoiceId).trim();
    const idx = indexOfChoiceId(choices, correctId);
    const correctIndex = (idx >= 0 && idx <= 1) ? idx : 0;
    return { ok: true, item: { type: "question", question, options: [a, b], correctIndex, explanation } };
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
