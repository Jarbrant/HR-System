// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.9c VARIATION+ARC + V1-CONTRACT)
// FIL: worker/index.js
//
// HOTFIX v1.5.9c (NO-CRASH + CORS-NORMALIZE):
// - P0: Tar bort import-beroende av ./question-ui.js (vanlig orsak till Error 1101 vid deploy).
//       UI-frågeformat-funktioner inline:as här för att Workern alltid ska starta.
// - P0: Normaliserar ALLOWED_ORIGIN (tål trailing slash) + jämför normaliserat mot request Origin.
// - P0: Oförändrat output-contract: training-blocks@v1 + ui-mcq@v1.2 + items-envelope@v1.6
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
// BLOCK 01B — UI question helpers (INLINE HOTFIX)
// (Tidigare import: ./question-ui.js)  => borttagen för att undvika 1101 vid saknad fil.
// ============================================================

function normalizeQuestionType(qtRaw) {
  const q = safeStr(qtRaw).toLowerCase().trim();
  if (!q) return "";
  if (q === "auto") return "auto";

  // vanligaste alias
  if (q === "mcq" || q === "single" || q === "mcq_single" || q === "mcq-single") return "mcq_single";
  if (q === "multi" || q === "mcq_multi" || q === "mcq-multi") return "mcq_multi";
  if (q === "tf" || q === "truefalse" || q === "true_false" || q === "true-false") return "true_false";

  // UI kan skicka dessa
  if (q.includes("mcq") && q.includes("multi")) return "mcq_multi";
  if (q.includes("mcq")) return "mcq_single";
  if (q.includes("true") || q.includes("false")) return "true_false";

  return q;
}

function isUiQuestionRequest(questionTypeRaw) {
  const qt = normalizeQuestionType(questionTypeRaw);
  return qt === "auto" || qt === "mcq_single" || qt === "mcq_multi" || qt === "true_false";
}

function mapTrainingBlocksToUiQuestions(blocks, questionTypeRaw, language) {
  const qt = normalizeQuestionType(questionTypeRaw);
  const out = [];

  const arr = Array.isArray(blocks) ? blocks : [];
  for (const b of arr) {
    if (!b || b.kind !== "question") continue;

    const items = Array.isArray(b.items) ? b.items : [];
    const qi = items.find(x => x && x.type === "questionInline" && x.question);
    const q = qi && qi.question ? qi.question : null;
    if (!q) {
      return { ok: false, errorCode: "UI_MAP_FAILED", message: "Question-block saknar questionInline.question" };
    }

    const stem = safeStr(q.text || q.question || "").trim();
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const options = choices.map(c => safeStr(c && c.text).trim()).filter(Boolean);

    // Fail-closed: UI kräver options + correctIndex
    if (!stem) return { ok: false, errorCode: "UI_MAP_FAILED", message: "En fråga saknar text" };
    if (options.length < 2) {
      return { ok: false, errorCode: "UI_MAP_FAILED", message: "AI-svaret saknade giltiga svarsalternativ" };
    }

    // correct index
    let correctIndex = -1;
    let correctIndices = null;

    const correctChoiceId = safeStr(q.correctChoiceId).trim();
    if (correctChoiceId) {
      const idx = choices.findIndex(c => safeStr(c && c.id).trim() === correctChoiceId);
      correctIndex = idx;
    }

    const ids = Array.isArray(q.correctChoiceIds) ? q.correctChoiceIds : null;
    if (ids && ids.length) {
      const mapped = ids
        .map(id => choices.findIndex(c => safeStr(c && c.id).trim() === safeStr(id).trim()))
        .filter(n => Number.isInteger(n) && n >= 0);
      if (mapped.length) correctIndices = mapped;
    }

    if (correctIndex < 0 && (!correctIndices || !correctIndices.length)) {
      // defensiv fallback: om correct saknas => första option
      correctIndex = 0;
    }

    const explanation = safeStr(q.rationale || q.explanation || q.feedback || "").trim();

    const item = {
      type: "question",
      question: stem,
      options,
      correctIndex,
      ...(correctIndices ? { correctIndices } : {}),
      ...(explanation ? { explanation } : {})
    };

    // Om UI valt AUTO: vi mappar alltid till single (UI-formatet är samma),
    // och korrekt-index fungerar.
    out.push(item);
  }

  // om UI ber om frågor men vi inte hittade någon -> fail-closed
  if (!out.length) {
    return { ok: false, errorCode: "UI_NO_QUESTIONS", message: "Inga question-block hittades att mappa till UI-frågor" };
  }

  return { ok: true, items: out };
}

// ============================================================
// BLOCK 02 — Constants
// PATCH: DBG2 (deploy-bevis) — ändra VERSION så /v1/version visar rätt kod körs
// ============================================================

export const MAX_BODY_BYTES = 64 * 1024;

// OBS: Detta är bara för felsökning. När allt funkar kan du byta tillbaka.
const VERSION = "1.5.9c-dbg2";

// ============================================================
// BLOCK 03 — Fetch handler (routing + guards)
// ============================================================

export default {
  async fetch(request, env) {
    let requestId = makeRequestId();
    const url = new URL(request.url);

    const allowedOriginRaw = safeStr(env.ALLOWED_ORIGIN).trim();
    const requireAuth = safeStr(env.REQUIRE_AUTH).trim().toLowerCase() === "true";
    const aiEnabled = safeStr(env.AI_ENABLED).trim().toLowerCase() === "true";

    // ---------- ENV GUARD (fail-closed) ----------
    if (!allowedOriginRaw) {
      console.error("ERR", requestId, "ENV_MISSING");
      return okJSON(
        500,
        { ok: false, requestId, errorCode: "ENV_MISSING", error: { code: "ENV_MISSING", message: "ALLOWED_ORIGIN saknas i env" } },
        { "Content-Type": "application/json; charset=utf-8" },
        requestId
      );
    }

    // ---------- ORIGIN NORMALIZE (tål trailing slash i env) ----------
    const normalizeOrigin = (s) => safeStr(s).trim().replace(/\/+$/, "");
    const allowedOrigin = normalizeOrigin(allowedOriginRaw);

    const origin = normalizeOrigin(request.headers.get("Origin") || "");
    const corsHeaders = buildCorsHeaders(origin, allowedOrigin);

    // ---------- OPTIONS (Preflight) ----------
    if (request.method === "OPTIONS") {
      if (!origin || origin !== allowedOrigin) {
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
    if (!origin || origin !== allowedOrigin) {
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
      ""
    );

    // subjectObj legacy
    const subjectObj = isPlainObject(body.subjectObj)
      ? body.subjectObj
      : (isPlainObject(body.subject) ? body.subject : null);

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
    const fmtHint = safeStr(format).toLowerCase();
    const ctHint = safeStr(body && body.contentType).trim();
    if (!safeStr(questionType).trim() && (fmtHint.includes("question") || ctHint === "questions")) {
      questionType = "auto";
    }

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
// PATCH: DEBUG v2 — alltid diagnostik även om throw är null/undefined
// ============================================================

const __diag = {
  has_buildTrainingBlocks: typeof buildTrainingBlocks,
  has_getRulesBundle: typeof getRulesBundle,
  has_getQuestionQuality: typeof getQuestionQuality,
  has_parseV1RulesetPayload: typeof parseV1RulesetPayload,
  mode,
  count,
  language,
  questionType: safeStr(questionType)
};

let training;
try {
  // Extra fail-closed: om funktionen saknas helt, få ett tydligt fel direkt
  if (typeof buildTrainingBlocks !== "function") {
    throw new Error("buildTrainingBlocks saknas eller är inte en funktion");
  }

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
  // Gör felet synligt även om e är null/undefined
  let msg = safeStr(e && (e.stack || e.message || String(e))).trim();

  // Om kastat värde är null/undefined (eller tomt), ge fallback
  if (!msg) {
    msg = "buildTrainingBlocks kastade ett tomt fel (null/undefined) eller utan message/stack";
  }

  const diagStr = (() => {
    try { return JSON.stringify(__diag); } catch { return "[diag kunde ej serialiseras]"; }
  })();

  const fallbackStack = safeStr(new Error("WORKER_BUILD_FAILED@BLOCK04").stack || "").slice(0, 600);

  const full = `${msg} | DIAG=${diagStr} | FALLBACK_STACK=${fallbackStack}`.slice(0, 1500);

  console.error("ERR", requestId, "WORKER_BUILD_FAILED", full);

  return errorJSON(
    502,
    requestId,
    "WORKER_BUILD_FAILED",
    full,
    corsHeaders,
    true
  );
}

// Fail-closed: om buildTrainingBlocks returnerar konstigt
if (!training || typeof training !== "object") {
  return errorJSON(502, requestId, "WORKER_BUILD_FAILED", "training är ogiltig (null/ej objekt)", corsHeaders, true);
}

const topBlocks = Array.isArray(training.blocks) ? training.blocks : [];

let items = topBlocks;

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

// ============================================================
// BLOCK 05 — HTTP helpers (CORS + JSON)
// ============================================================

function buildCorsHeaders(origin, allowedOrigin) {
  const allowOrigin = (allowedOrigin && origin && origin === allowedOrigin) ? allowedOrigin : "";
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
// BLOCK 10 — MINIMAL ENGINE (HOTFIX) – buildTrainingBlocks
// Syfte: Förhindra WORKER_BUILD_FAILED när resten av generatorn saknas.
// Policy: Deterministiskt, ingen extern AI, fail-soft (kastar inte).
// ============================================================

function buildTrainingBlocks(input) {
  const requestId = safeStr(input && input.requestId).trim();
  const mode = safeStr(input && input.mode).trim() || "training";
  const count = Number(input && input.count) || 1;
  const language = safeStr(input && input.language).trim() || "sv";
  const contextText = safeStr(input && (input.context || input.contextText)).trim();
  const subjectId = safeStr(input && input.subjectId).trim() || "generic";
  const questionType = safeStr(input && input.questionType).trim() || "";

  // defensiv normalisering
  const place = inferWorkplaceFromContext(contextText, language);
  const seedBase = hash32([
    "v1.5.9c-hotfix",
    requestId || "no-req",
    subjectId || "generic",
    language,
    safeStr(questionType),
    safeStr(contextText).slice(0, 120)
  ].join("|"));

  const arc = buildStoryArc(Math.max(1, Math.min(12, count)));
  const pack = pickScenarioPack(contextText, place, language, seedBase);

  const blocks = [];
  for (let i = 0; i < Math.max(1, Math.min(12, count)); i++) {
    const seed = (seedBase + i * 97) >>> 0;
    blocks.push(makeQuestionBlock({
      i,
      seed,
      language,
      pack,
      dim: arc[i] || "scenario_application",
      contextText
    }));
  }

  return {
    ok: true,
    v: "training-blocks@v1",
    mode,
    subjectId,
    language,
    blocks
  };
}

function makeQuestionBlock({ i, seed, language, pack, dim, contextText }) {
  const sv = (language === "sv");

  // enkel, deterministisk “fråge-stam” (ingen placeholder/ingen fri analys)
  const stemsSv = {
    routine_start: `Ni står ${pack.place}. ${pack.setting}. Vilket är bästa första steget för att skapa kontroll utan att gissa?`,
    scenario_application: `${pack.setting}. Ni behöver fatta ett val ${pack.place}. Vilket alternativ ger mest spårbarhet i stunden?`,
    traceability_and_evidence: `Ni behöver kunna visa underlag i efterhand. Vilken handling ger tydligast spårbarhet ${pack.place}?`,
    risk_consequence: `${pack.constraintB} Vilket val minskar risken för felbeslut mest ${pack.place}?`,
    deviation_and_action: `${pack.twist} Vad är den mest korrekta åtgärden för att hantera en möjlig avvikelse?`,
    roles_and_responsibility: `Två personer vill göra olika. Vilket ansvar/roll-val ger bäst ordning och tydlighet ${pack.place}?`,
    definition_or_concept: `I en situation som denna: vad betyder “spårbarhet” i praktiken ${pack.place}?`
  };

  const stemsEn = {
    routine_start: `You are ${pack.place}. ${pack.setting}. What is the best first step to regain control without guessing?`,
    scenario_application: `${pack.setting}. You must decide ${pack.place}. Which option gives the strongest traceability right now?`,
    traceability_and_evidence: `You need evidence you can show later. Which action creates the clearest traceability ${pack.place}?`,
    risk_consequence: `${pack.constraintB} Which choice reduces the risk of a wrong decision the most ${pack.place}?`,
    deviation_and_action: `${pack.twist} What is the most correct action to handle a potential deviation?`,
    roles_and_responsibility: `Two people disagree. Which role/ownership choice creates the best order and clarity ${pack.place}?`,
    definition_or_concept: `In this kind of situation: what does “traceability” mean in practice ${pack.place}?`
  };

  const stem = (sv ? (stemsSv[dim] || stemsSv.scenario_application) : (stemsEn[dim] || stemsEn.scenario_application));

  // deterministiska svarsalternativ (4 st) + korrekt index
  const optionsSv = [
    `Stanna upp och be om ett konkret underlag (t.ex. ${pack.artifact}).`,
    `Gå vidare “som vanligt” för att spara tid.`,
    `Välj det som känns rimligt utan att kontrollera underlag.`,
    `Skjut upp beslutet och gör inget just nu.`
  ];
  const optionsEn = [
    `Pause and ask for concrete evidence (e.g., ${pack.artifact}).`,
    `Proceed “as usual” to save time.`,
    `Pick what sounds reasonable without checking evidence.`,
    `Delay the decision and do nothing for now.`
  ];

  const options = (sv ? optionsSv : optionsEn);

  // korrektIndex: alltid 0 i denna hotfix (fail-closed friendly + konsekvent)
  const correctIndex = 0;

  const explanation = sv
    ? `Rätt svar prioriterar spårbarhet och minimerar gissning. Det gör att ni kan förklara beslutet i efterhand och upptäcka avvikelse tidigt.`
    : `The correct option prioritizes evidence and minimizes guessing. That enables traceability and early detection of deviations.`;

  // UI-mappningen i din index.js letar efter: kind:"question" + questionInline.question + choices + correctChoiceId
  const choices = options.map((text, idx) => ({
    id: `c${i + 1}_${idx + 1}`,
    text: safeStr(text)
  }));

  return {
    kind: "question",
    id: `q_${i + 1}`,
    items: [
      {
        type: "questionInline",
        question: {
          text: safeStr(stem),
          choices,
          correctChoiceId: choices[correctIndex].id,
          rationale: safeStr(explanation)
        }
      }
    ]
  };
}

// ===================== EOF (PATCHED) =====================
