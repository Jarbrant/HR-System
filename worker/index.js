// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.7 QUALITY+V1-CONTRACT)
// FIL: worker/index.js
//
// Mål: Lås worker-output till training-blocks + UI-frågeformat när MCQ/TF begärs.
//      FIX: Undvik “samma frågor”, förbjud placeholder-fraser, kräver förklaring,
//           och gör batchen unik (dedupe) + bättre variation.
//
// PATCH v1.5.7 (STEP-NORM + COURSE-SEED + TRACEABILITY-DIM + STEM-VARIANTS):
// - P0: Normaliserar step till ren siffra (1–7) i v1 + legacy + infer från contextText.
// - P0: Seed inkluderar kurs/ids/step så kursval & nivå ger tydligt olika output.
// - P1: Ny dimension: traceability_and_evidence (spårbarhet/bevis) + nya stammar.
// - P1: Flera stammar per dimension så frågorna inte låser i “bästa startåtgärden…”.
//
// PATCH v1.5.6 (V1-CONTRACT + CORS + REQUESTID):
// - Stödjer ai-rules/v1 ruleset-payload (contentType/context/output/formatRef + requestId från UI).
// - Returnerar även `items[]` (envelope-friendly) utan att bryta befintligt UI.
// - Lägger X-Request-Id + X-HR-Request-Id i svar (SDK kan plocka upp).
// - CORS headers tillåter även X-HR-SDK / X-HR-Client (case-variant).
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

// ruleset för kvalitet
// LÄGG DEN HÄR: ai-rules/v1/rulesets/training_prompt.json
import TRAINING_PROMPT from "../ai-rules/v1/rulesets/training_prompt.json";

export const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.5.7";

// ------------------------------
// Fetch
// ------------------------------
export default {
  async fetch(request, env) {
    let requestId = makeRequestId();
    const url = new URL(request.url);

    const allowedOrigin = safeStr(env.ALLOWED_ORIGIN).trim();
    const requireAuth = safeStr(env.REQUIRE_AUTH).trim().toLowerCase() === "true";
    const aiEnabled = safeStr(env.AI_ENABLED).trim().toLowerCase() === "true";

    // ---------- ENV GUARD (fail-closed) ----------
    if (!allowedOrigin) {
      console.error("ERR", requestId, "ENV_MISSING");
      return okJSON(
        500,
        { ok: false, requestId, errorCode: "ENV_MISSING", error: { code: "ENV_MISSING", message: "ALLOWED_ORIGIN saknas i env" } },
        { "Content-Type": "application/json; charset=utf-8" },
        requestId
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
        corsHeaders,
        requestId
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
            outputContract: "training-blocks@v1 + ui-mcq@v1.2 + items-envelope@v1.6"
          }
        },
        corsHeaders,
        requestId
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

    // ---------- requestId (UI-styrt om det finns) ----------
    const incomingReqId = safeStr(body.requestId).trim();
    if (incomingReqId) requestId = incomingReqId;

    // ---------- INPUT (v1 ruleset eller legacy tolerant) ----------
    const v1 = parseV1RulesetPayload(body);
    const isV1 = !!v1;

    let modeRaw = safeStr(body.mode || body.type).trim();
    if (path === "/v1/ai/training") modeRaw = "training";
    if (path === "/v1/ai/document") modeRaw = "document";

    let mode = normalizeMode(modeRaw);
    let countRaw = body.count ?? body.n;
    let languageRaw = body.language || "sv";
    let contextText = normalizeContextText(body.context ?? body.prompt ?? "");
    let format = safeStr(body.format || "").trim();
    let subjectId = safeStr(body.subjectId || body.subject || "").trim();
    let difficultyHint = body.difficultyHint ?? body.difficulty;

    // UI: frågetyp (tolerant mot olika fältnamn)
    let questionType = normalizeQuestionType(
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

    // subjectObj legacy
    const subjectObj = isPlainObject(body.subjectObj)
      ? body.subjectObj
      : (isPlainObject(body.subject) ? body.subject : null);

    // NOTE: ofta saknas subjectObj → då infererar vi från context.text
    let course = normalizeCourseSubject(subjectObj);

    // ---- V1 override (ai-rules/v1) ----
    if (isV1) {
      mode = v1.mode;
      format = v1.format;
      countRaw = v1.count;
      languageRaw = v1.language;
      questionType = v1.questionType;
      difficultyHint = v1.difficulty;
      course = v1.course;
      contextText = v1.contextText;
    }

    // language: stöd för sv, sv-SE, sv_SE, en, en-US → normaliseras till "sv"|"en"
    const language = normalizeLanguage(languageRaw);

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

    if (contextText.length > 4000) {
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
        context: contextText,
        aiEnabled,
        format,
        subjectId,
        difficultyHint,
        course,
        questionType
      });
    } catch (e) {
      console.error("ERR", requestId, "UPSTREAM_ERROR");
      return errorJSON(502, requestId, "UPSTREAM_ERROR", "AI-tjänsten svarade inte", corsHeaders, false);
    }

    // ---------- TOPP-NIVÅ blocks ----------
    const topBlocks = Array.isArray(training.blocks) ? training.blocks : [];

    // V1-items: default = blocks (för training-blocks consumers)
    let items = topBlocks;

    // Om UI ber om MCQ/TF: returnera items[] som question.json-kompatibla frågor
    // MEN: Lämna blocks/training.blocks som training-blocks så legacy/UI inte bryts.
    if (isUiQuestionRequest(questionType)) {
      const mapped = mapTrainingBlocksToUiQuestions(topBlocks, questionType, language);
      if (!mapped.ok) {
        return errorJSON(422, requestId, mapped.errorCode, mapped.message, corsHeaders, true);
      }
      items = mapped.items;
    }

    // V1-envelope (utan att bryta legacy): inkludera `items`
    return okJSON(
      200,
      {
        ok: true,
        requestId,
        items, // v1-friendly
        data: { training },
        training,
        blocks: topBlocks,
        mode: training.mode
      },
      corsHeaders,
      requestId
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
    // CORS FIX: tillåt både varianter (preflight kräver match)
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Hr-Sdk, X-Hr-Client, X-HR-SDK, X-HR-Client, X-HR-CLIENT",
    "Vary": "Origin"
  };
}

function okJSON(status, payload, corsHeaders, requestId) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": safeStr(requestId || ""),
      "X-HR-Request-Id": safeStr(requestId || ""),
      ...(corsHeaders || {})
    }
  });
}

function errorJSON(status, requestId, code, message, corsHeaders, logIt) {
  if (logIt) console.error("ERR", requestId, code);
  return okJSON(
    status,
    { ok: false, requestId, errorCode: safeStr(code), error: { code: safeStr(code), message: safeStr(message) } },
    corsHeaders,
    requestId
  );
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

function normalizeStepValue(v) {
  // Returnerar "1".."7" eller "".
  const s = safeStr(v).trim();
  if (!s) return "";
  // plocka första tal (t.ex. "Steg 2" -> "2", "2." -> "2")
  const m = s.match(/([1-7])/);
  return m ? safeStr(m[1]) : "";
}

function normalizeContextText(v) {
  // UI kan skicka:
  // - string
  // - object { text: "..." }
  // - object { contextText: "..." }
  // - v1 object { moduleId, areaId, ... } (då bygger vi en kontrollerad text från labels)
  if (typeof v === "string") return v.trim();
  if (isPlainObject(v)) {
    const t = safeStr(v.text || v.contextText || v.value || "").trim();
    if (t) return t;

    // v1 context object (labels)
    const ml = safeStr(v.moduleLabel || "").trim();
    const al = safeStr(v.areaLabel || "").trim();
    const cl = safeStr(v.chapterLabel || "").trim();

    const stRaw = safeStr(v.step || v.stepId || "").trim();
    const st = normalizeStepValue(stRaw) || stRaw;

    const df = safeStr(v.difficulty || "").trim();

    // bygg “harmlös” kontext som kan hjälpa workplace-infer utan att tvingas in i Q-fält
    const parts = [];
    if (ml) parts.push(`Modul: ${ml}`);
    if (al) parts.push(`Område: ${al}`);
    if (cl) parts.push(`Kapitel: ${cl}`);
    if (st) parts.push(`Steg: ${st}`);
    if (df) parts.push(`Svårighet: ${df}`);
    return parts.join(" • ");
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
// V1 ruleset payload (ai-rules/v1)
// ------------------------------------------------------------
function parseV1RulesetPayload(body) {
  // Minimal detection: contentType + output.formatRef
  const contentType = safeStr(body && body.contentType).trim();
  const out = body && isPlainObject(body.output) ? body.output : null;
  const formatRef = safeStr(out && out.formatRef).trim();

  if (!contentType || !formatRef) return null;

  const count = body.count ?? 4;
  const language = body.language || "sv-SE";
  const ctx = (body && isPlainObject(body.context)) ? body.context : {};

  const stepNorm = normalizeStepValue(ctx.step || ctx.stepId || "");
  const difficulty = safeStr(ctx.difficulty || "").trim();

  const course = {
    module: safeStr(ctx.moduleLabel || "").trim(),
    area: safeStr(ctx.areaLabel || "").trim(),
    chapter: safeStr(ctx.chapterLabel || "").trim(),
    step: stepNorm || "1",
    moduleId: safeStr(ctx.moduleId || "").trim(),
    areaId: safeStr(ctx.areaId || "").trim(),
    chapterId: safeStr(ctx.chapterId || "").trim(),
    stepId: stepNorm || safeStr(ctx.step || ctx.stepId || "").trim()
  };

  // contentType -> mode/format
  let mode = "training";
  let format = "training-blocks";

  if (contentType === "document") {
    mode = "document";
    format = "document";
  } else if (contentType === "questions") {
    mode = "training";
    format = "question";
  } else if (contentType === "training_blocks") {
    mode = "training";
    format = "training-blocks";
  } else {
    // okänt => fail-closed via validation senare
    mode = "";
    format = "";
  }

  // questionType (gäller questions)
  const questionType = normalizeQuestionType(safeStr(out && out.questionType).trim() || "auto");

  // contextText: bygg från labels (workplace-infer kan använda om labels råkar innehålla t.ex. "kök")
  const contextText = normalizeContextText(ctx);

  return {
    mode,
    format,
    count,
    language,
    questionType,
    difficulty,
    course,
    contextText
  };
}

// ------------------------------------------------------------
// Course Subject (module/area/chapter/step)
// ------------------------------------------------------------
function normalizeCourseSubject(subjectObj) {
  if (!isPlainObject(subjectObj)) return null;

  const module = safeStr(subjectObj.module || "").trim();
  const area = safeStr(subjectObj.area || "").trim();
  const chapter = safeStr(subjectObj.chapter || "").trim();

  const moduleId = safeStr(subjectObj.moduleId || "").trim();
  const areaId = safeStr(subjectObj.areaId || "").trim();
  const chapterId = safeStr(subjectObj.chapterId || "").trim();
  const stepIdRaw = safeStr(subjectObj.stepId || "").trim();

  const stepRaw = safeStr(subjectObj.step || "").trim();
  const stepNorm = normalizeStepValue(stepRaw) || normalizeStepValue(stepIdRaw) || "";

  return {
    module: module || "",
    area: area || "",
    chapter: chapter || "",
    step: stepNorm,
    moduleId,
    areaId,
    chapterId,
    stepId: stepNorm || stepIdRaw
  };
}

function validateCourseSubject(course) {
  if (course === null) return { ok: true };
  const step = normalizeStepValue(course.step);
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
  const mStep = t.match(/Steg\s*:\s*([^•\n\r]+)/i);
  if (mStep) step = normalizeStepValue(mStep[1]);

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
  const stepNorm = normalizeStepValue(src.step) || "1";

  return {
    module: safeStr(src.module).trim() || "Generic",
    area: safeStr(src.area).trim() || ((mode === "document") ? "Dokument" : "Utbildning"),
    chapter: safeStr(src.chapter).trim() || "Introduktion",
    step: stepNorm
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

// P0: ta bort domänord i själva Q-fältet (och som säkerhet även i rationale/options vid mapping)
function stripDomainWordsFromQuestion(s, language) {
  const txt = safeStr(s);
  if (!txt) return txt;

  const reSv = /\b(steg|steget|modul|modulen|kapitel|kapitlet|kurs|kursen|utbildning|utbildningen)\b/gi;
  const reEn = /\b(step|module|chapter|course|training)\b/gi;

  const out = txt.replace(reSv, "").replace(reEn, "").replace(/\s{2,}/g, " ").trim();
  if (!out) {
    return (language === "sv") ? "Vilket val är bäst i situationen?" : "Which choice is best in this situation?";
  }
  return out;
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

function pickOne(list, seed) {
  const arr = safeArr(list).filter(Boolean);
  if (arr.length === 0) return "";
  return arr[seed % arr.length] || arr[0] || "";
}

// ============================================================
// STEP PROFILE (1–7) → styr frågedimensioner
// ============================================================
function getStepProfile(step) {
  const s = normalizeStepValue(step);
  // Tydligare separation mellan steg:
  // 1: begrepp + enkel start
  // 2: ansvar/roller + spårbarhet
  // 3: tillämpning + avvikelse
  // 4: risk/konsekvens + spårbarhet
  // 5: avvikelse + åtgärd/uppföljning
  if (s === "1") return ["definition_or_concept", "routine_start", "scenario_application"];
  if (s === "2") return ["roles_and_responsibility", "traceability_and_evidence", "routine_start"];
  if (s === "3") return ["scenario_application", "deviation_and_action", "routine_start"];
  if (s === "4") return ["risk_consequence", "traceability_and_evidence", "scenario_application"];
  if (s === "5") return ["deviation_and_action", "risk_consequence", "roles_and_responsibility"];
  return [];
}

// ============================================================
// Workplace inference (P1) — utan ny datamodell
// ============================================================
function inferWorkplaceFromContext(contextText, language) {
  const t = safeStr(contextText).toLowerCase();

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

  const courseLabel = resolveCourseLabelFallback(course, mode, context);

  // P0: seed ska tydligt variera mellan kurs/område/kapitel/steg (och id om det finns)
  const courseSeedKey = [
    safeStr(courseLabel.module),
    safeStr(courseLabel.area),
    safeStr(courseLabel.chapter),
    safeStr(courseLabel.step),
    safeStr(course && course.moduleId),
    safeStr(course && course.areaId),
    safeStr(course && course.chapterId),
    safeStr(course && course.stepId)
  ].join("|");

  const seed = hash32(`${requestId}|${mode}|${count}|${language}|${safeStr(context).slice(0, 196)}|${fmt}|${subjId}|${safeStr(difficultyHint)}|${safeStr(questionType)}|${courseSeedKey}`);

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

  // Batch-state (unikhet inom batchen)
  const batch = {
    seenStems: [],
    seenDims: new Set(),
    seenBestAnswers: []
  };

  for (let i = 0; i < count; i++) {
    const n = (seed ^ hash32(`${requestId}#${i}`) ^ hash32(courseSeedKey) ^ (i * 2654435761)) >>> 0;

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
      source: "mock-v1.5.7"
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

  // Titel får bära område (UI runtom), men själva question/options/explanation/feedback ska vara “verklighetsspråk”
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

    const stem0 = safeStr(cand && (cand.text || cand.question || "")).trim();
    if (!stem0) continue;

    // P0: domänord får inte finnas i Q-fältet
    const stem = stripDomainWordsFromQuestion(stem0, language);
    if (!stem) continue;

    // P0: stoppa även om området råkar läcka in i Q-fältet (extra guard)
    if (courseLabel && courseLabel.area) {
      const a = normKey(courseLabel.area);
      if (a && normKey(stem).includes(a)) continue;
    }

    // forbidden placeholders: applicera på stem + rationale + choices
    if (qq && qq.forbidContextPlaceholderText) {
      const rat = safeStr(cand && (cand.rationale || cand.explanation || cand.feedback || "")).trim();
      if (containsForbiddenPhrase(stem, qq.forbiddenPhrases)) continue;
      if (containsForbiddenPhrase(rat, qq.forbiddenPhrases)) continue;
      if (/\(kontext\s+dolt\)/i.test(stem) || /\(kontext\s+dolt\)/i.test(rat)) continue;
      if (/\[object\s+object\]/i.test(stem) || /\[object\s+object\]/i.test(rat)) continue;

      const ch = Array.isArray(cand && cand.choices) ? cand.choices : [];
      let badChoice = false;
      for (const c of ch) {
        const t = safeStr(c && c.text).trim();
        if (!t) continue;
        if (containsForbiddenPhrase(t, qq.forbiddenPhrases)) { badChoice = true; break; }
        if (/\(kontext\s+dolt\)/i.test(t) || /\[object\s+object\]/i.test(t)) { badChoice = true; break; }
        // P0 guard: ingen area-läcka i options
        if (courseLabel && courseLabel.area) {
          const a = normKey(courseLabel.area);
          if (a && normKey(t).includes(a)) { badChoice = true; break; }
        }
      }
      if (badChoice) continue;
    }

    // near-dup across batch
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

    // Skriv tillbaka sanerad Q-text (P0)
    cand.text = stem;

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
  const qt0 = normalizeQuestionType(questionType);
  const qt = (qt0 === "auto") ? "mcq_single" : qt0;

  const isTf = (qt === "true_false");
  const isMulti = (qt === "mcq_multi");
  const isMcq = (qt === "mcq_single" || qt === "mcq_multi");

  const minOpt = qq && qq.mcq ? qq.mcq.minOptions : 4;
  const maxOpt = qq && qq.mcq ? qq.mcq.maxOptions : 6;

  const choiceCount = isTf ? 2 : (isMcq ? clampInt(5, minOpt, maxOpt) : 4);

  const dimsDefault = [
    "definition_or_concept",
    "routine_start",
    "traceability_and_evidence",
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
    "ni behöver kunna följa upp i efterhand",
    "en avvikelse behöver hanteras lugnt och korrekt"
  ];
  const eventsEn = [
    "you need shared understanding",
    "a routine must be followed",
    "something deviates from expectations",
    "you need to be able to follow up later",
    "a deviation must be handled calmly and correctly"
  ];
  const event = (language === "sv" ? eventsSv : eventsEn)[(n + i) % 5];

  function stemForDimension() {
    const seed2 = (n ^ hash32(`${dim}|${difficulty}|${i}`) ^ hash32(place)) >>> 0;

    if (language === "sv") {
      const stems = {
        definition_or_concept: [
          `Vilket alternativ beskriver bäst varför ett tydligt arbetssätt behövs när ni vill ha samsyn ${place}?`,
          `Ni märker att alla gör lite olika. Vad är huvudsyftet med ett gemensamt arbetssätt ${place}?`,
          `Varför är det viktigt att arbeta på samma sätt när ni vill kunna följa upp och förbättra ${place}?`
        ],
        routine_start: [
          `Ni ser att arbetet drar igång utan samsyn ${place}. Vad är den bästa startåtgärden?`,
          `Innan ni gör något mer ${place}, vad behöver klargöras först för att undvika fel väg?`,
          `Ni har bråttom ${place}. Vilket första beslut hjälper mest för att hålla det rätt och spårbart?`
        ],
        traceability_and_evidence: [
          `Ni behöver kunna visa i efterhand vad som gjordes ${place}. Vad börjar ni med?`,
          `Vilket val ger bäst spårbarhet när ni vill kunna följa upp ${place}?`,
          `Om någon frågar “hur vet ni att det blev rätt?” ${place} — vad är första åtgärden?`
        ],
        risk_consequence: [
          `Vilken risk ökar mest om ni hoppar över en tydlig start ${place}?`,
          `Om ni kör på utan avgränsning ${place}, vad är den vanligaste konsekvensen?`,
          `Vad är den största risken om ansvar och uppföljning inte blir tydligt från början ${place}?`
        ],
        roles_and_responsibility: [
          `När ni behöver få ordning på hur ni gör ${place}, vem bör ta första ansvaret – och varför?`,
          `Vem ska initiera och samordna när ni vill att alla gör lika ${place}?`,
          `När något behöver styras upp ${place}, vilken roll bör starta och säkra att det händer?`
        ],
        deviation_and_action: [
          `Om något avviker ${place}, vilket första agerande är mest korrekt?`,
          `Ni upptäcker att något inte blev som väntat ${place}. Vad gör ni först?`,
          `Vid avvikelse ${place} — vilket första steg minskar risken att ni åtgärdar fel sak?`
        ],
        scenario_application: [
          `Vilket val ger bäst start för ${role} ${place}?`,
          `Du ska skapa ordning i en situation ${place}. Vilket val hjälper mest just nu?`,
          `Du vill undvika missförstånd ${place}. Vilket val är mest praktiskt att börja med?`
        ]
      };

      return pickOne(stems[dim] || stems.scenario_application, seed2) || `Vilket val är bäst ${place}?`;
    }

    const stemsEn = {
      definition_or_concept: [
        `Which option best explains why a clear way of working matters when you need shared understanding ${place}?`,
        `People do things differently. What is the main purpose of a shared way of working ${place}?`,
        `Why is consistency important if you want to follow up and improve ${place}?`
      ],
      routine_start: [
        `Work starts without alignment ${place}. What is the best starting action?`,
        `Before doing anything else ${place}, what should be clarified first to avoid the wrong path?`,
        `You are under time pressure ${place}. Which first action helps most to keep it correct and traceable?`
      ],
      traceability_and_evidence: [
        `You need to show later what was done ${place}. What do you start with?`,
        `Which choice gives the best traceability for follow-up ${place}?`,
        `If someone asks “how do you know it was correct?” ${place} — what is the first action?`
      ],
      risk_consequence: [
        `Which risk increases most if you skip a clear start ${place}?`,
        `If you proceed without scoping ${place}, what is the most common consequence?`,
        `What is the biggest risk if ownership and follow-up are unclear from the start ${place}?`
      ],
      roles_and_responsibility: [
        `When you need to align how work is done ${place}, who should take first responsibility—and why?`,
        `Who should initiate and coordinate when you want consistency ${place}?`,
        `When something needs to be brought under control ${place}, which role should start and ensure it happens?`
      ],
      deviation_and_action: [
        `If something deviates ${place}, what first action is most correct?`,
        `You notice something didn’t turn out as expected ${place}. What do you do first?`,
        `In a deviation ${place}, what first action reduces the risk of fixing the wrong thing?`
      ],
      scenario_application: [
        `Which choice gives the best start for ${role} ${place}?`,
        `You need to create order in a situation ${place}. Which choice helps most right now?`,
        `You want to avoid misunderstandings ${place}. Which choice is the most practical starting point?`
      ]
    };

    return pickOne(stemsEn[dim] || stemsEn.scenario_application, seed2) || `Which choice is best ${place}?`;
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

  // P0: rensa domänord i Q-fält
  text = stripDomainWordsFromQuestion(text, language);

  const choices = [];

  if (isTf) {
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

    return {
      kind: "question",
      text,
      choices,
      correctChoiceId,
      rationale,
      difficulty,
      tags: [subjId, "tf", placeKey(place)]
    };
  }

  const pools = getChoicePools(language);
  const bestVariants = safeArr(pools.bestByDim[dim] || pools.bestByDim.scenario_application);
  const distractors = safeArr(pools.distractorsByDim[dim] || pools.distractorsByDim.scenario_application);

  let best = "";
  const start = (n ^ hash32(`${dim}|${courseLabel.step}|${difficulty}|${i}`)) >>> 0;
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
  let cursor = (start ^ hash32(safeStr(context).slice(0, 196))) >>> 0;

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
    if (safeStr(rationale).trim().length < (qq.explanationMinChars || 40)) {
      rationale = (language === "sv")
        ? `Förklaring: Det bästa valet är "${bestAnswerText}" eftersom det skapar tydlighet i situationen ${place} innan ni går vidare med åtgärd och uppföljning.`
        : `Explanation: The best choice is "${bestAnswerText}" because it creates clarity ${place} before you act and follow up.`;
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
    tags: [subjId, "scenario", dim, placeKey(place)],
    bestAnswerText
  };
}

function clampInt(v, min, max) {
  const n = Math.trunc(Number(v));
  const a = Math.trunc(Number(min));
  const b = Math.trunc(Number(max));
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
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
        traceability_and_evidence: [
          "Dokumentera vad som gjordes och varför innan ni går vidare",
          "Säkra ett tydligt underlag (logg/kvittens/notering) för uppföljning",
          "Bestäm vad som ska sparas som bevis så att ni kan följa upp senare"
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
        traceability_and_evidence: [
          "Lita på minnet istället för att skriva ner något",
          "Spara inget underlag för att undvika extra jobb",
          "Ändra flera saker samtidigt utan att notera vad som ändrades",
          "Be någon annan komma ihåg detaljerna senare",
          "Hoppa över uppföljning eftersom det verkar fungera just nu"
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
      traceability_and_evidence: [
        "Document what was done and why before moving on",
        "Secure clear evidence (log/receipt/note) for follow-up",
        "Decide what to keep as proof so you can follow up later"
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
      traceability_and_evidence: [
        "Rely on memory instead of writing anything down",
        "Keep no evidence to avoid extra work",
        "Change several things at once without noting what changed",
        "Ask someone else to remember details later",
        "Skip follow-up because it seems fine right now"
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
    if (dim === "traceability_and_evidence") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom spårbarhet bygger på att ni kan visa vad som gjordes, när och varför. Utan underlag blir uppföljning svår ${place}.`;
    }
    if (dim === "risk_consequence") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom största risken när man hoppar över en tydlig start är att teamet agerar på olika bilder av läget. Då blir ansvar och uppföljning spretigt ${place}.`;
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
  if (dim === "traceability_and_evidence") {
    return `Explanation: "${bestAnswerText}" is correct because traceability depends on being able to show what was done, when, and why. Without evidence, follow-up becomes weak ${place}.`;
  }
  if (dim === "risk_consequence") {
    return `Explanation: "${bestAnswerText}" is correct because skipping a clear start increases the risk of acting on different interpretations. Ownership and follow-up become inconsistent ${place}.`;
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

  // Canonical (ai-rules/v1)
  if (s === "auto") return "auto";
  if (s === "mcq_single" || s === "single" || s === "mcq") return "mcq_single";
  if (s === "mcq_multi" || s === "multi") return "mcq_multi";
  if (s === "truefalse" || s === "true_false" || s === "sant_falskt" || s === "tf") return "true_false";
  if (s === "short_answer" || s === "short" || s === "kort") return "short_answer";
  if (s === "numeric" || s === "number" || s === "tal") return "numeric";

  if (s.includes("mcq") && s.includes("multi")) return "mcq_multi";
  if (s.includes("mcq") && (s.includes("single") || s.includes("ett") || s.includes("one"))) return "mcq_single";
  if (s.includes("true") || s.includes("false") || s.includes("sant") || s.includes("falskt")) return "true_false";

  return s0;
}

function isUiQuestionRequest(questionType) {
  const qt = normalizeQuestionType(questionType);
  return qt === "mcq_single" || qt === "mcq_multi" || qt === "true_false";
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

  // Fail-closed: om vi genererade 0, eller om vi tappade frågor (mappningen ska vara 1:1)
  const expected = blocks.filter(x => x && x.kind === "question").length;
  if (out.length === 0 || out.length !== expected) {
    return {
      ok: false,
      errorCode: "Q_SCHEMA_INVALID",
      message: "Kunde inte skapa giltiga provfrågor (items) för hela batchen"
    };
  }

  return { ok: true, items: out };
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
  const question = stripDomainWordsFromQuestion(safeStr(q.text).trim(), language);

  const choices = Array.isArray(q.choices) ? q.choices : [];
  if (!question || choices.length < 2) return { ok: false };

  const options = [];
  for (const c of choices) {
    const t0 = safeStr(c && c.text).trim();
    if (t0) options.push(t0);
  }
  if (options.length < 2) return { ok: false };

  let explanation = safeStr(q.rationale || q.explanation || q.feedback || "").trim();
  explanation = stripDomainWordsFromQuestion(explanation, language);

  const difficulty = safeStr(q.difficulty).trim() || undefined;
  const tags = Array.isArray(q.tags) ? q.tags.slice(0, 8) : undefined;

  if (questionType === "true_false") {
    const a = (language === "sv") ? "Sant" : "True";
    const b = (language === "sv") ? "Falskt" : "False";
    const correctId = safeStr(q.correctChoiceId).trim();
    const idx = indexOfChoiceId(choices, correctId);
    const correctIndex = (idx >= 0 && idx <= 1) ? idx : 0;

    return {
      ok: true,
      item: {
        type: "question",
        questionType: "true_false",
        ...(difficulty ? { difficulty } : {}),
        question,
        options: [a, b],
        correctIndex,
        ...(explanation ? { explanation } : {}),
        ...(tags ? { tags } : {})
      }
    };
  }

  if (questionType === "mcq_single") {
    const correctId = safeStr(q.correctChoiceId).trim();
    const idx = indexOfChoiceId(choices, correctId);
    if (idx < 0 || idx >= options.length) return { ok: false };

    return {
      ok: true,
      item: {
        type: "question",
        questionType: "mcq_single",
        ...(difficulty ? { difficulty } : {}),
        question,
        options,
        correctIndex: idx,
        ...(explanation ? { explanation } : {}),
        ...(tags ? { tags } : {})
      }
    };
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

    return {
      ok: true,
      item: {
        type: "question",
        questionType: "mcq_multi",
        ...(difficulty ? { difficulty } : {}),
        question,
        options,
        correctIndices: indices,
        ...(explanation ? { explanation } : {}),
        ...(tags ? { tags } : {})
      }
    };
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
