// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5 PATCH)
// FIL: worker/index.js
// Mål: UI ska få riktiga MCQ-frågor när questionType=mcq_*:
// - UI-kontrakt: type:"question", question, options[], correctIndex (ev. correctIndices)
// - Fail-closed om vi inte kan leverera UI-kontraktet
// - Bakåtkompabilitet: training finns kvar + res.blocks på toppnivå
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

/**
 * OBS: JSON-importer kräver Wrangler "modules".
 * Om någon import saknas i repo får du "Could not resolve" vid deploy.
 */
import INDEX from "../ai-rules/index.json";
import GLOBAL from "../ai-rules/v1/global.json";
import MODULES from "../ai-rules/v1/modules.json";

import SWEDISH from "../ai-rules/v1/subjects/swedish.json";
import MATH from "../ai-rules/v1/subjects/math.json";
import GENERIC from "../ai-rules/v1/subjects/generic.json";

import QUESTION_FORMAT from "../ai-rules/v1/formats/question.json";
import TASK_FORMAT from "../ai-rules/v1/formats/task.json";
import TRAINING_BLOCKS_FORMAT from "../ai-rules/v1/formats/training-blocks.json";

// Valfri: om du har denna fil, behåll importen. Om du INTE har den: kommentera bort raden.
// import DOCUMENT_FORMAT from "../ai-rules/v1/formats/document.json";

export const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.5";

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
            rulesBase: "ai-rules",
            outputContract: "training-blocks@v1 + question@v1 + ui-mcq@v1"
          }
        },
        corsHeaders
      );
    }

    // ---------- Endast POST för AI ----------
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
    // mode|type + path alias
    let modeRaw = safeStr(body.mode || body.type).trim();
    if (path === "/v1/ai/training") modeRaw = "training";
    if (path === "/v1/ai/document") modeRaw = "document";
    const mode = normalizeMode(modeRaw);

    const countRaw = body.count ?? body.n;                     // count|n
    const language = safeStr(body.language || "sv").trim();    // sv|en
    const context = safeStr(body.context || body.prompt || "").trim(); // context|prompt

    // new (optional)
    const format = safeStr(body.format || "").trim();          // training-blocks|question|task|document
    const subjectId = safeStr(body.subjectId || body.subject || "").trim(); // generic|math|swedish|...
    const difficultyHint = body.difficultyHint ?? body.difficulty; // intro|normal|advanced|auto|1..5

    // UI: frågetyp (P0)
    const questionType = normalizeQuestionType(body.questionType || body.qType || body.question_kind || "");

    // new (preferred): subject object for course structure
    const subjectObj = isPlainObject(body.subjectObj) ? body.subjectObj : (isPlainObject(body.subject) ? body.subject : null);
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

    // course subject är valfritt i v1 (UI kan börja skicka det när ni vill)
    const courseCheck = validateCourseSubject(course);
    if (!courseCheck.ok) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", courseCheck.message, corsHeaders, true);
    }

    // ---------- BUILD (ruleset + stable output) ----------
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
    } catch {
      console.error("ERR", requestId, "UPSTREAM_ERROR");
      return errorJSON(502, requestId, "UPSTREAM_ERROR", "AI-tjänsten svarade inte", corsHeaders, false);
    }

    // ---------- UI BLOCKS (P0) ----------
    // När UI ber om MCQ/TF: blocks måste vara i UI-kontraktet (options + correctIndex)
    const wantUiQuestions = isUiQuestionRequest(questionType);

    let topBlocks = Array.isArray(training.blocks) ? training.blocks : [];
    if (wantUiQuestions) {
      const mapped = mapTrainingBlocksToUiQuestions(topBlocks, questionType, language);
      if (!mapped.ok) {
        // Fail-closed: UI ska inte få tomma/trasiga frågor
        return errorJSON(422, requestId, mapped.errorCode, mapped.message, corsHeaders, true);
      }
      topBlocks = mapped.blocks;
    }

    // ---------- RESPONSE (stable + backward compatible) ----------
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

// ------------------------------------------------------------
// MODE NORMALIZER
// ------------------------------------------------------------
function normalizeMode(modeRaw) {
  const s = safeStr(modeRaw).toLowerCase().trim();
  if (!s) return "";
  if (s === "training" || s === "document") return s;
  if (s.includes("train")) return "training";
  if (s.includes("doc")) return "document";
  return s;
}

function normalizeFormat(format, mode, questionType) {
  // P0: om UI ber om en frågetyp → vi måste leverera frågor (inte mix)
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
    formats: {
      question: QUESTION_FORMAT || {},
      task: TASK_FORMAT || {},
      "training-blocks": TRAINING_BLOCKS_FORMAT || {}
    }
  };
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
  for (let i = 0; i < count; i++) {
    const n = (seed + i * 2654435761) >>> 0;

    if (fmt === "question") {
      blocks.push(genQuestionBlock({ i, n, language, context, courseLabel, difficulty, subjId, bundle, questionType }));
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
    else blocks.push(genQuestionBlock({ i, n, language, context, courseLabel, difficulty, subjId, bundle, questionType }));
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
      source: "mock-v1.5"
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

  const text =
    language === "sv"
      ? `Kort teori kopplad till ${courseLabel.module} → ${courseLabel.area}.\n\nSammanhang:\n${context || "—"}`
      : `Short theory for ${courseLabel.module} → ${courseLabel.area}.\n\nContext:\n${context || "—"}`;

  return {
    blockId,
    kind: "info",
    title,
    items: [
      { type: "text", text }
    ],
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

  const instruction =
    language === "sv"
      ? `Gör en kort uppgift kopplad till ${courseLabel.area}.\n\nUtgå från detta sammanhang:\n${context || "—"}`
      : `Complete a short task for ${courseLabel.area}.\n\nContext:\n${context || "—"}`;

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

  const text =
    language === "sv"
      ? `Detta är ett informativt dokument om ${courseLabel.area}.\n\nSammanhang:\n${context || "—"}`
      : `This is an informational document about ${courseLabel.area}.\n\nContext:\n${context || "—"}`;

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

function genQuestionBlock({ i, n, language, context, courseLabel, difficulty, subjId, questionType }) {
  const blockId = `b_q_${i + 1}_${subjId}`.slice(0, 32);

  const title =
    language === "sv"
      ? `Kontrollfråga: ${courseLabel.area}`
      : `Check question: ${courseLabel.area}`;

  const q = makeQuestion({ n, language, context, courseLabel, difficulty, subjId, questionType });

  return {
    blockId,
    kind: "question",
    title,
    items: [
      {
        type: "questionInline",
        question: q
      }
    ],
    scoring: { points: 1 },
    meta: { tags: ["question", subjId], difficulty }
  };
}

function makeQuestion({ n, language, context, courseLabel, difficulty, subjId, questionType }) {
  const qt = normalizeQuestionType(questionType);

  // TF (Sant/Falskt) ska alltid ha 2 alternativ
  const isTf = (qt === "tf" || qt === "true_false");
  const isMulti = (qt === "mcq_multi");

  const choiceCount = isTf ? 2 : (3 + (n % 3)); // TF=2, annars 3..5

  const baseTextSv = `Vad är den bästa första åtgärden i ${courseLabel.area} i en vardagssituation?`;
  const baseTextEn = `What is the best first action in ${courseLabel.area} in a practical situation?`;

  const text =
    (language === "sv")
      ? `${baseTextSv}\n\n(Använd detta sammanhang om relevant: ${context || "—"})`
      : `${baseTextEn}\n\n(Context: ${context || "—"})`;

  const poolSv = [
    "Klargör målet och ställ en öppen fråga",
    "Ge en snabb order utan förklaring",
    "Byt ämne för att undvika konflikt",
    "Dokumentera och följ upp enligt rutin",
    "Lyssna klart och spegla det du hört"
  ];
  const poolEn = [
    "Clarify the goal and ask an open question",
    "Give a quick order without explanation",
    "Change the subject to avoid conflict",
    "Document and follow up per routine",
    "Listen fully and reflect what you heard"
  ];

  const pool = (language === "sv") ? poolSv : poolEn;

  const choices = [];

  if (isTf) {
    choices.push({ id: "c1", text: (language === "sv") ? "Sant" : "True" });
    choices.push({ id: "c2", text: (language === "sv") ? "Falskt" : "False" });
  } else {
    for (let i = 0; i < choiceCount; i++) {
      const txt = pool[(n + i) % pool.length];
      choices.push({ id: `c${i + 1}`, text: txt });
    }
  }

  const correctIdx = n % choiceCount;
  const correctChoiceId = `c${correctIdx + 1}`;

  // Multi: välj två "rätta" deterministiskt (utan att logga payload)
  let correctChoiceIds = null;
  if (isMulti && choiceCount >= 3) {
    const idx2 = (correctIdx + 2) % choiceCount;
    correctChoiceIds = [`c${correctIdx + 1}`, `c${idx2 + 1}`];
  }

  const rationale =
    (language === "sv")
      ? "En bra start är att skapa tydlighet och få fram den andres perspektiv innan man styr mot lösning."
      : "A strong start is to create clarity and understand the other person’s perspective before moving to solutions.";

  return {
    kind: "question",
    text,
    choices,
    correctChoiceId,
    ...(correctChoiceIds ? { correctChoiceIds } : {}),
    rationale,
    difficulty,
    tags: [subjId, "scenario"]
  };
}

// ============================================================
// P0: UI-kontrakt (options + correctIndex)
// ============================================================

function normalizeQuestionType(v) {
  const s = safeStr(v).toLowerCase().trim();
  if (!s) return "";
  if (s === "mcq_single" || s === "single" || s === "mcq") return "mcq_single";
  if (s === "mcq_multi" || s === "multi") return "mcq_multi";
  if (s === "tf" || s === "truefalse" || s === "true_false") return "tf";
  if (s === "short" || s === "short_answer") return "short";
  return s;
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
  const text = safeStr(q.text).trim();
  const choices = Array.isArray(q.choices) ? q.choices : [];

  if (!text || choices.length < 2) return { ok: false };

  const options = [];
  for (const c of choices) {
    const t = safeStr(c && c.text).trim();
    if (t) options.push(t);
  }
  if (options.length < 2) return { ok: false };

  // TF: tvinga exakt två, i rätt språk (UI ska inte få blandat)
  if (questionType === "tf") {
    const a = (language === "sv") ? "Sant" : "True";
    const b = (language === "sv") ? "Falskt" : "False";
    const fixed = [a, b];
    const correctIndex = 0;
    return {
      ok: true,
      item: { type: "question", question: text, options: fixed, correctIndex }
    };
  }

  // mcq_single
  if (questionType === "mcq_single") {
    const correctId = safeStr(q.correctChoiceId).trim();
    const idx = indexOfChoiceId(choices, correctId);
    if (idx < 0 || idx >= options.length) return { ok: false };
    return {
      ok: true,
      item: { type: "question", question: text, options, correctIndex: idx }
    };
  }

  // mcq_multi
  if (questionType === "mcq_multi") {
    const ids = Array.isArray(q.correctChoiceIds) ? q.correctChoiceIds : [];
    const indices = [];
    for (const id of ids) {
      const idx = indexOfChoiceId(choices, safeStr(id).trim());
      if (idx >= 0 && idx < options.length && !indices.includes(idx)) indices.push(idx);
    }
    if (indices.length === 0) {
      // fallback: använd single som minst 1 rätt
      const correctId = safeStr(q.correctChoiceId).trim();
      const idx = indexOfChoiceId(choices, correctId);
      if (idx < 0 || idx >= options.length) return { ok: false };
      indices.push(idx);
    }
    return {
      ok: true,
      item: { type: "question", question: text, options, correctIndices: indices }
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

// ============================================================
// (Resten oförändrat)
// ============================================================
