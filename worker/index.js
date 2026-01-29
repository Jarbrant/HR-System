// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.9c VARIATION+ARC + V1-CONTRACT)
// FIL: worker/index.js
//
// HOTFIX v1.5.9c (NO-IMPORT-QUESTION-UI):
// - P0: Tar bort import-beroende av ./question-ui.js (vanlig orsak till Error 1101 om filen ej bundlas).
// - P0: Inlinar normalizeQuestionType + isUiQuestionRequest + mapTrainingBlocksToUiQuestions här.
// - P0: Oförändrat output-contract.
// ============================================================

// ============================================================
// BLOCK 01 — Imports (split: rules + course + utils)
// ============================================================

import {
  isPlainObject,
  safeStr,
  safeArr,
  normalizeLanguage,
  normalizeStepValue,
  normalizeContextText,
  makeRequestId,
  normalizeCount,
  hash32,
  normalizeMode
} from "./utils.js";

import {
  getRulesBundle,
  getQuestionQuality,
  containsForbiddenPhrase,
  stripAnyBracketedContext,
  stripDomainWordsFromQuestion,
  sanitizeContextForDisplay,
  tokenizeForSimilarity,
  jaccardSimilarity,
  normKey,
  pickOne
} from "./rules.js";

import {
  parseV1RulesetPayload,
  normalizeCourseSubject,
  validateCourseSubject,
  resolveCourseLabelFallback
} from "./course.js";

// ============================================================
// BLOCK 01B — UI question helpers (INLINE, no external module)
// ============================================================

function normalizeQuestionType(raw) {
  const s = safeStr(raw).toLowerCase().trim();
  if (!s) return "";

  // normalisera separators
  const k = s.replace(/[\s\-]+/g, "_");

  // tillåt vanliga alias
  if (k === "auto" || k === "automatic") return "auto";
  if (k === "mcq" || k === "mcq_single" || k === "single" || k === "single_choice" || k === "one_choice") return "mcq_single";
  if (k === "mcq_multi" || k === "multi" || k === "multiple_choice" || k === "multi_choice") return "mcq_multi";
  if (k === "tf" || k === "true_false" || k === "truefalse" || k === "sant_falskt") return "true_false";

  // fallback: om UI skickar redan korrekt
  if (k === "mcq_single" || k === "mcq_multi" || k === "true_false") return k;

  return k; // sista fallback (men UI-guard nedan avgör om det räknas som UI request)
}

function isUiQuestionRequest(questionType) {
  const qt = normalizeQuestionType(questionType);
  return qt === "auto" || qt === "mcq_single" || qt === "mcq_multi" || qt === "true_false";
}

// mappar worker training.blocks (kind=question) → UI questions format:
// { type:'question', question:'…', options:['A','B'...], correctIndex:0..n-1, explanation:'...' }
function mapTrainingBlocksToUiQuestions(topBlocks, questionType, language) {
  const qt0 = normalizeQuestionType(questionType);
  const qt = (qt0 === "auto") ? "mcq_single" : qt0;

  const blocks = Array.isArray(topBlocks) ? topBlocks : [];
  const out = [];

  for (const b of blocks) {
    if (!b || b.kind !== "question") continue;

    // förväntad shape: items:[{ type:'questionInline', question:{ text, choices[], correctChoiceId, rationale } }]
    const it0 = Array.isArray(b.items) ? b.items[0] : null;
    const q = it0 && isPlainObject(it0.question) ? it0.question : null;
    if (!q) continue;

    const stem = safeStr(q.text || q.question || "").trim();
    const choices = Array.isArray(q.choices) ? q.choices : [];

    // TF hanteras separat
    if (qt === "true_false") {
      const optSv = ["Sant", "Falskt"];
      const optEn = ["True", "False"];
      const options = (language === "sv") ? optSv : optEn;

      // om worker redan gav c1/c2 och correctChoiceId – respektera
      let correctIndex = 0;
      const cc = safeStr(q.correctChoiceId).trim();
      if (cc === "c2") correctIndex = 1;

      out.push({
        type: "question",
        question: stem,
        options,
        correctIndex,
        explanation: safeStr(q.rationale || q.explanation || q.feedback || "").trim()
      });
      continue;
    }

    // MCQ: kräver choices + correctChoiceId
    if (!choices.length) {
      return {
        ok: false,
        errorCode: "UI_MAP_NO_CHOICES",
        message: "MCQ begärdes men worker-frågan saknade choices[]"
      };
    }

    const options = choices.map(c => safeStr(c && c.text).trim()).filter(Boolean);
    if (options.length < 2) {
      return {
        ok: false,
        errorCode: "UI_MAP_BAD_OPTIONS",
        message: "MCQ begärdes men options blev tomma/ogiltiga"
      };
    }

    const correctChoiceId = safeStr(q.correctChoiceId).trim();
    let correctIndex = -1;
    if (correctChoiceId) {
      correctIndex = choices.findIndex(c => safeStr(c && c.id).trim() === correctChoiceId);
    }

    // fallback: om correctChoiceId saknas/inte matchar → fail-closed
    if (!(correctIndex >= 0 && correctIndex < options.length)) {
      return {
        ok: false,
        errorCode: "UI_MAP_NO_CORRECT",
        message: "MCQ begärdes men correctChoiceId saknas eller matchar inte choices[]"
      };
    }

    out.push({
      type: "question",
      question: stem,
      options,
      correctIndex,
      explanation: safeStr(q.rationale || q.explanation || q.feedback || "").trim()
    });
  }

  // fail-closed: om UI begär frågor men vi inte kunde mappa någon
  if (!out.length) {
    return {
      ok: false,
      errorCode: "UI_MAP_EMPTY",
      message: "UI begärde frågor men inga question-block kunde mappas"
    };
  }

  return { ok: true, items: out };
}

// ============================================================
// BLOCK 02 — Constants
// ============================================================

export const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.5.9c";

// ============================================================
// BLOCK 03 — Fetch handler (routing + guards)
// ============================================================

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
    // P0 HOTFIX: ta bort body.question (krockar ofta med frågetext och kan slå av UI-items)
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
      ""
    );

    // subjectObj legacy
    const subjectObj = isPlainObject(body.subjectObj)
      ? body.subjectObj
      : (isPlainObject(body.subject) ? body.subject : null);

    // NOTE: ofta saknas subjectObj → då infererar vi från context.text (i course.js)
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

    // P0 HOTFIX: stabil default om UI tydligt kör questions men questionType saknas
    // (Annars kan isUiQuestionRequest() bli false och items[] uteblir)
    const fmtHint = safeStr(format).toLowerCase();
    const ctHint = safeStr(body && body.contentType).trim();
    if (!safeStr(questionType).trim() && (fmtHint.includes("question") || ctHint === "questions")) {
      questionType = "auto";
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

    // ============================================================
    // BLOCK 04 — Build output (training-blocks + UI-items envelope)
    // ============================================================

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
      console.error("ERR", requestId, "WORKER_BUILD_FAILED");
      return errorJSON(502, requestId, "WORKER_BUILD_FAILED", "Worker kunde inte bygga ett giltigt svar", corsHeaders, false);
    }

    // ---------- TOPP-NIVÅ blocks ----------
    const topBlocks = Array.isArray(training.blocks) ? training.blocks : [];

    // V1-items: default = blocks (för training-blocks consumers)
    let items = topBlocks;

    // Om UI ber om provfrågor (inkl AUTO): returnera items[] som UI-frågor
    if (isUiQuestionRequest(questionType)) {
      const mapped = mapTrainingBlocksToUiQuestions(topBlocks, questionType, language);
      if (!mapped.ok) {
        return errorJSON(422, requestId, mapped.errorCode, mapped.message, corsHeaders, true);
      }
      items = mapped.items;
    }

    return okJSON(
      200,
      {
        ok: true,
        requestId,
        items,
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
// BLOCK 05 — HTTP helpers (CORS + JSON)
// ============================================================

function buildCorsHeaders(origin, allowedOrigin) {
  const allowOrigin = (allowedOrigin && origin === allowedOrigin) ? allowedOrigin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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

// ============================================================
// BLOCK 06 — Core utils (remaining local only)
// ============================================================

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
    const lvl = 1 + (seedN % 5);
    return (lvl <= 2) ? "intro" : (lvl <= 4) ? "normal" : "advanced";
  }

  const n = Number(difficultyHint);
  if (Number.isInteger(n) && n >= 1 && n <= 5) {
    return (n <= 2) ? "intro" : (n <= 4) ? "normal" : "advanced";
  }

  return "normal";
}

// ============================================================
// RESTEN AV FILEN (BLOCK 10–15) — OFÖRÄNDRAD från din senaste sanning
// (Jag lämnar exakt samma implementationsdel som du klistrade in efter BLOCK 10.)
// ============================================================

// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
// OBS: Från och med här ska du behålla exakt din befintliga kod:
// - getStepProfile
// - inferWorkplaceFromContext
// - buildStoryArc/pickScenarioPack/pickLengthProfile/etc
// - buildTrainingBlocks
// - genInfoBlock/genTaskBlock/genDocumentBlock/genQuestionBlock
// - makeQuestion/makeFallbackQuestion
// - getChoicePools/buildRationale
// samt ev övriga helpers du redan har under BLOCK 10–15.
// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

// ===================== EOF =====================
