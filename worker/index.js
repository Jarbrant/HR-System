
// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.9 VARIATION+ARC + V1-CONTRACT)
// FIL: worker/index.js
//
// Mål: Lås worker-output till training-blocks + UI-frågeformat när MCQ/TF begärs.
//      FIX: Undvik “samma frågor”, förbjud placeholder-fraser, kräver förklaring,
//           och gör batchen unik (dedupe) + bättre variation.
//
// PATCH v1.5.9 (SCENARIO-PACK + STORY-ARC + LENGTH+PREFIX-GUARD):
// - P0: Scenario-pack väljs per batch (samma “värld” genom hela blocket när count>=6).
// - P0: Story-arc (röd tråd) över 6–12 frågor: start → bevis → risk → avvikelse → ansvar → twist.
// - P0: Längdstyrning: 70% 2 meningar, 20% 3 meningar (”konstverk”), 10% korta.
// - P0: Prefix-guard: stoppar frågor som börjar med samma 4–6 ord i samma batch.
// - P1: Variation i frågetyp inom MCQ (utan att ändra UI-contract): saknad info, minst risk, undvik, dokumentera.
//
// PATCH v1.5.8 (QTYPE-SOURCEGUARD + STABLE-DEFAULT):
// - P0: Tar bort `body.question` från questionType-inferens (krockar med frågetext och kan slå av UI-items).
// - P0: Stabil default: om UI kör questions-format/contentType=questions men questionType saknas → sätt "auto".
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
// PATCH v1.5.9a (FALLBACK-QUESTION + CORRECT-ERRORS):
// - P0: Om batch-unikhet misslyckas: skapa fallback-fråga istället för att kasta och döda hela svaret.
// - P0: Korrekt feltext vid interna build-fel (inte “AI svarade inte”).
// ============================================================

// ============================================================
// BLOCK 01 — Imports (split: rules + course)
// ============================================================

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
// BLOCK 02 — Constants
// ============================================================

export const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.5.9a";

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
      // PATCH v1.5.9a: korrekt feltext. Detta är intern bygglogik (inte “AI svarade inte”).
      console.error("ERR", requestId, "WORKER_BUILD_FAILED");
      return errorJSON(502, requestId, "WORKER_BUILD_FAILED", "Worker kunde inte bygga ett giltigt svar", corsHeaders, false);
    }

    // ---------- TOPP-NIVÅ blocks ----------
    const topBlocks = Array.isArray(training.blocks) ? training.blocks : [];

    // V1-items: default = blocks (för training-blocks consumers)
    let items = topBlocks;

    // Om UI ber om provfrågor (inkl AUTO): returnera items[] som question.json-kompatibla frågor
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
// BLOCK 05 — HTTP helpers (CORS + JSON)
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

// ============================================================
// BLOCK 06 — Core utils (migrated)
// ============================================================
// Flyttat till worker/utils.js:
// isPlainObject, safeStr, safeArr, normalizeLanguage, normalizeStepValue,
// normalizeContextText, makeRequestId, normalizeCount, hash32, normalizeMode,
// normalizeSubjectId, pickDifficultyLabel
//
// Kvar här pga beroende till isUiQuestionRequest() som finns senare i filen:
function normalizeFormat(format, mode, questionType) {
  // P0: UI-frågeflödet (inkl AUTO) ska låsa format till "question"
  if (isUiQuestionRequest(questionType)) return "question";

  const f = safeStr(format).toLowerCase().trim();
  if (f === "question" || f === "questions") return "question";
  if (f === "task" || f === "tasks") return "task";
  if (f === "document") return "document";
  if (f === "training-blocks" || f === "training" || f === "blocks") return "training-blocks";
  return (mode === "document") ? "document" : "training-blocks";
}


// ============================================================
// BLOCK 07 — V1 ruleset payload (ai-rules/v1)
// ============================================================

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

// ============================================================
// BLOCK 08 — Course Subject (module/area/chapter/step)
// ============================================================

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
// BLOCK 09 — Rules bundle + quality config (migrated)
// ============================================================
// Flyttat till worker/rules.js:
// getRulesBundle, getQuestionQuality,
// containsForbiddenPhrase, stripAnyBracketedContext, stripDomainWordsFromQuestion,
// sanitizeContextForDisplay, tokenizeForSimilarity, jaccardSimilarity, normKey, pickOne

// ============================================================
// BLOCK 10 — STEP PROFILE (1–7) → styr frågedimensioner
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
// BLOCK 11 — Workplace inference (P1) — utan ny datamodell
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
// BLOCK 11B — Scenario-pack + story-arc (v1.5.9)
// ============================================================

function buildStoryArc(count) {
  // En röd tråd som känns som “mini-berättelse” när man gör 6–12 frågor i samma block.
  // 0: etablering, 1: saknad info, 2: bevis/logg, 3: risk, 4: avvikelse, 5: ansvar, 6: uppföljning, 7: twist
  const base = [
    "scenario_application",
    "routine_start",
    "traceability_and_evidence",
    "risk_consequence",
    "deviation_and_action",
    "roles_and_responsibility",
    "traceability_and_evidence",
    "scenario_application"
  ];
  // Om count > 8: fortsätt med praktisk variation utan att tappa tråden
  const tail = [
    "risk_consequence",
    "deviation_and_action",
    "roles_and_responsibility",
    "routine_start"
  ];
  const seq = [];
  for (let i = 0; i < count; i++) {
    if (i < base.length) seq.push(base[i]);
    else seq.push(tail[(i - base.length) % tail.length]);
  }
  return seq;
}

function pickScenarioPack(contextText, place, language, seed) {
  const t = safeStr(contextText).toLowerCase();
  const isKitchen = t.includes("kök") || t.includes("restaurang") || t.includes("servering");
  const isReceiving = t.includes("leverans") || t.includes("mottagning") || t.includes("varumottag");
  const isAudit = t.includes("revision") || t.includes("internkontroll") || t.includes("audit");
  const isBrief = t.includes("morgonmöte") || t.includes("brief") || t.includes("standup") || t.includes("avstämning");
  const isCustomer = t.includes("kund") || t.includes("klagomål") || t.includes("reklamation");

  const packs = [];
  if (isReceiving) packs.push("receiving");
  if (isKitchen) packs.push("kitchen");
  if (isAudit) packs.push("audit");
  if (isBrief) packs.push("brief");
  if (isCustomer) packs.push("customer");
  if (packs.length === 0) packs.push("generic");

  const packId = packs[seed % packs.length];

  const sv = (language === "sv");
  const defs = {
    receiving: {
      setting: sv ? "En leverans har precis kommit in" : "A delivery has just arrived",
      artifact: sv ? "en kvittens eller en notering i loggen" : "a receipt or a log note",
      constraintA: sv ? "Ni har 10 minuter innan nästa moment startar." : "You have 10 minutes before the next step begins.",
      constraintB: sv ? "Märkningen är ofullständig och två personer säger olika." : "The labeling is incomplete and two people give different answers.",
      twist: sv ? "Efter 2 minuter kommer ny info som motsäger första beskedet." : "After 2 minutes, new info contradicts the first message."
    },
    kitchen: {
      setting: sv ? "Ni är mitt i produktionen och tempot är högt" : "You’re mid-production and the pace is high",
      artifact: sv ? "en checklista eller en sign-off" : "a checklist or sign-off",
      constraintA: sv ? "Det är 15 minuter till servering." : "It’s 15 minutes until service.",
      constraintB: sv ? "En kollega säger “vi gör som vanligt” men underlaget saknas." : "A colleague says “we do it as usual” but there’s no evidence.",
      twist: sv ? "En detalj dyker upp som gör att “som vanligt” inte längre gäller." : "A detail appears that makes “as usual” no longer valid."
    },
    audit: {
      setting: sv ? "Ni gör en snabb internkontroll" : "You’re doing a quick internal check",
      artifact: sv ? "ett underlag som kan visas i efterhand" : "evidence you can show later",
      constraintA: sv ? "Ni behöver kunna förklara beslutet imorgon." : "You need to be able to explain the decision tomorrow.",
      constraintB: sv ? "Det finns en avvikelse, men ni vet inte ännu om den är liten eller stor." : "There’s a deviation, but you don’t yet know its scope.",
      twist: sv ? "En ny observation gör att ni måste omvärdera vad som är “viktigast först”." : "A new observation forces you to reconsider what matters first."
    },
    brief: {
      setting: sv ? "På ett kort avstämningsmöte ska ni få samsyn" : "In a short briefing you need alignment",
      artifact: sv ? "en enkel beslutspunkt (vem-gör-vad)" : "a simple decision note (who-does-what)",
      constraintA: sv ? "Ni har 5 minuter och alla tolkar läget olika." : "You have 5 minutes and everyone interprets differently.",
      constraintB: sv ? "En person saknas men påverkas av beslutet." : "One person is absent but will be impacted by the decision.",
      twist: sv ? "Efter mötet framkommer att en viktig detalj aldrig blev sagd." : "After the meeting, a key detail turns out to have been missing."
    },
    customer: {
      setting: sv ? "En kund har hört av sig med ett klagomål" : "A customer has contacted you with a complaint",
      artifact: sv ? "en notering som gör att ni kan följa upp" : "a note that enables follow-up",
      constraintA: sv ? "Kunden vill ha svar nu, men ni saknar helhetsbild." : "The customer wants an answer now, but you lack the full picture.",
      constraintB: sv ? "Det finns flera möjliga orsaker, och ni riskerar att gissa." : "There are multiple causes and you risk guessing.",
      twist: sv ? "En kollega hittar en tidigare notering som ändrar bedömningen." : "A colleague finds a previous note that changes the assessment."
    },
    generic: {
      setting: sv ? "Ni behöver skapa ordning i ett läge som riskerar att spåra ur" : "You need to create order in a situation that can drift",
      artifact: sv ? "en kort notering som ger spårbarhet" : "a short note that gives traceability",
      constraintA: sv ? "Ni har ont om tid och måste välja rätt första steg." : "You are short on time and must pick the right first step.",
      constraintB: sv ? "Två personer har olika bild av vad som är “problemet”." : "Two people disagree on what the “problem” is.",
      twist: sv ? "Någon säger något som låter rimligt – men saknar stöd." : "Someone says something that sounds right—without evidence."
    }
  };

  const d = defs[packId] || defs.generic;
  return {
    id: packId,
    place,
    setting: d.setting,
    artifact: d.artifact,
    constraintA: d.constraintA,
    constraintB: d.constraintB,
    twist: d.twist
  };
}

function pickLengthProfile(seed) {
  // 70%: 2 meningar (med konkret constraint)
  // 20%: 3 meningar (”konstverk”)
  // 10%: 1 mening (kort kontroll)
  const x = seed % 10;
  if (x <= 6) return { minChars: 140, sentences: 2 };
  if (x <= 8) return { minChars: 260, sentences: 3 };
  return { minChars: 90, sentences: 1 };
}

function prefixKey(text, maxWords) {
  const t = normKey(text);
  if (!t) return "";
  const parts = t.split(" ").filter(Boolean);
  return parts.slice(0, Math.max(4, Math.min(6, maxWords || 5))).join(" ");
}

function joinSentences(_sv, s1, s2, s3, count) {
  const a = safeStr(s1).trim();
  const b = safeStr(s2).trim();
  const c = safeStr(s3).trim();
  if (count <= 1) return a;
  if (count === 2) return (a && b) ? `${a} ${b}` : (a || b);
  return [a, b, c].filter(Boolean).join(" ");
}

// ============================================================
// BLOCK 12 — OUTPUT BUILDER (training-blocks + question-format)
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
  const place0 = inferWorkplaceFromContext(context, language);
  const useArc = (fmt === "question" && isUiQuestionRequest(questionType) && count >= 6);

  const scenario = pickScenarioPack(context, place0, language, seed);
  const arcSeq = useArc ? buildStoryArc(count) : [];

  const batch = {
    seenStems: [],
    seenDims: new Set(),
    seenBestAnswers: [],
    seenPrefixes: [], // v1.5.9
    scenario,
    arcSeq,
    useArc
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
      source: "mock-v1.5.9a"
    }
  };
}

// ============================================================
// BLOCK 13 — Block generators (info/task/document/question)
// ============================================================

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
  for (let attempt = 0; attempt < 14; attempt++) {
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

    // v1.5.9: prefix-guard (första ord) för att stoppa “samma fråga i ny kostym”
    const pk = prefixKey(stem, 5);
    if (pk) {
      const prevP = safeArr(batch && batch.seenPrefixes);
      if (prevP.some(x => x === pk)) continue;
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
    if (pk && batch && Array.isArray(batch.seenPrefixes)) batch.seenPrefixes.push(pk);

    // Skriv tillbaka sanerad Q-text (P0)
    cand.text = stem;

    q = cand;
    break;
  }

  // PATCH v1.5.9a: ingen throw här. Skapa fallback-fråga så UI inte tappar allt.
  if (!q) {
    const fb = makeFallbackQuestion({
      i,
      language,
      courseLabel,
      batch
    });
    q = fb;
    // logga kort (ingen payload)
    console.error("ERR", "fallback_question", `i=${i + 1}`);
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

// ============================================================
// BLOCK 14 — QUESTION (choice-format, ruleset-quality)
// ============================================================

function makeQuestion({ n, i, count, language, context, courseLabel, difficulty, subjId, questionType, bundle, qq, batch }) {
  const qt0 = normalizeQuestionType(questionType);
  const qt = (qt0 === "auto") ? "mcq_single" : qt0;

  const isTf = (qt === "true_false");
  const isMulti = (qt === "mcq_multi");
  const isMcq = (qt === "mcq_single" || qt === "mcq_multi");

  const minOpt = qq && qq.mcq ? qq.mcq.minOptions : 4;
  const maxOpt = qq && qq.mcq ? qq.mcq.maxOptions : 6;

  // PATCH (P1, safe): gör antal alternativ varierande (4–6) i stället för konstant 5
  const span = Math.max(1, (maxOpt - minOpt + 1));
  const pick = minOpt + (n % span);
  const choiceCount = isTf ? 2 : (isMcq ? clampInt(pick, minOpt, maxOpt) : 4);

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

  // v1.5.9: story-arc override när batch.useArc är aktiv
  let dim = "scenario_application";
  if (batch && batch.useArc && Array.isArray(batch.arcSeq) && batch.arcSeq.length) {
    dim = batch.arcSeq[i % batch.arcSeq.length] || "scenario_application";
  } else {
    const dimIndex = (i + (n % rotate.length)) % rotate.length;
    dim = rotate[dimIndex] || "scenario_application";

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
  }

  // P1: workplace-infer från context (utan ny datamodell)
  const place = inferWorkplaceFromContext(context, language);

  const rolesSv = ["du som medarbetare", "du som ansvarig", "du som tar emot", "du som kontrollerar", "du som rapporterar"];
  const rolesEn = ["you as the employee", "you as responsible", "you as receiver", "you as checker", "you as reporter"];
  const role = (language === "sv" ? rolesSv : rolesEn)[(n + i) % 5];

  // v1.5.9: scenario-pack (samma per batch)
  const scenario = (batch && batch.scenario) ? batch.scenario : pickScenarioPack(context, place, language, (n ^ i) >>> 0);

  // v1.5.9: längdprofil per fråga
  const lenProf = pickLengthProfile(n ^ hash32(`${i}|${dim}|${scenario.id}`));
  const sv = (language === "sv");

  function stemForDimension() {
    const seed2 = (n ^ hash32(`${dim}|${difficulty}|${i}`) ^ hash32(place) ^ hash32(scenario.id)) >>> 0;

    // Variation i “frågesätt” utan att byta UI-contract:
    const askStylesSv = [
      "first_action",       // vad gör du först
      "missing_info",       // vilken info saknas
      "least_risky",        // minst risk
      "must_document",      // måste dokumenteras
      "avoid_first"         // vilket ska undvikas
    ];
    const askStylesEn = [
      "first_action","missing_info","least_risky","must_document","avoid_first"
    ];
    const askStyle = (sv ? askStylesSv : askStylesEn)[seed2 % 5];

    const s1 = `${scenario.setting} ${scenario.place}.`;

    // 2:a meningen: fråga + dim
    const askSv = {
      first_action: "Vilket första agerande är mest korrekt?",
      missing_info: "Vilken information måste du säkra först innan du bestämmer dig?",
      least_risky: "Vilket val är minst riskabelt just nu?",
      must_document: "Vad behöver dokumenteras direkt för att ni ska kunna följa upp senare?",
      avoid_first: "Vilket val bör du undvika först, även om det känns snabbt?"
    };
    const askEn = {
      first_action: "What first action is most correct?",
      missing_info: "Which information must you secure first before deciding?",
      least_risky: "Which choice is the least risky right now?",
      must_document: "What must be documented immediately so you can follow up later?",
      avoid_first: "Which choice should you avoid first, even if it feels fast?"
    };

    const dimSv = {
      definition_or_concept: "Tänk på varför ni behöver ett gemensamt sätt att göra saker.",
      routine_start: "Tänk på hur ni sätter ramar: mål, avgränsning, ansvar.",
      traceability_and_evidence: `Tänk på underlag: ${scenario.artifact}.`,
      risk_consequence: "Tänk på konsekvensen om ni gissar eller hoppar över kontroll.",
      roles_and_responsibility: "Tänk på vem som har mandat att starta och samordna.",
      deviation_and_action: "Tänk på hur ni stoppar, avgränsar och säkrar fakta.",
      scenario_application: `Du är ${role}.`
    };

    const dimEn = {
      definition_or_concept: "Think about why a shared way of working matters.",
      routine_start: "Think about setting boundaries: goal, scope, ownership.",
      traceability_and_evidence: `Think about evidence: ${scenario.artifact}.`,
      risk_consequence: "Think about consequences if you guess or skip checks.",
      roles_and_responsibility: "Think about who has mandate to initiate and coordinate.",
      deviation_and_action: "Think about stopping, scoping, and securing facts.",
      scenario_application: `You are ${role}.`
    };

    // 3:e meningen (konkret constraint / twist) – bara om vi ska ha 3 meningar
    const c2 = (seed2 & 1) === 0 ? scenario.constraintA : scenario.constraintB;

    // “twist” på slutet i arcens senare del (ger röd tråd)
    const useTwist = !!(batch && batch.useArc && i >= Math.min(6, Math.max(4, Math.floor(count / 2))) && (seed2 % 3 === 0));

    const q2 = sv
      ? `${askSv[askStyle]} ${safeStr(dimSv[dim] || "").trim()}`.trim()
      : `${askEn[askStyle]} ${safeStr(dimEn[dim] || "").trim()}`.trim();

    const q3 = useTwist ? scenario.twist : c2;

    // bygg meningar enligt profil
    const out = joinSentences(sv, s1, q2, q3, lenProf.sentences);

    // säkerställ min-längd genom att lägga till en extra konkret rad om den blev kort
    if (safeStr(out).length < lenProf.minChars) {
      const add = sv
        ? "Du behöver kunna förklara varför ni valde just detta, och vad nästa uppföljning blir."
        : "You need to be able to explain why you chose this and what the next follow-up will be.";
      return joinSentences(sv, out, add, "", 2);
    }
    return out;
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
  let cursor = (start ^ hash32(safeStr(context).slice(0, 196)) ^ hash32(scenario.id)) >>> 0;

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
    tags: [subjId, "scenario", dim, placeKey(place), `pack_${scenario.id}`],
    bestAnswerText
  };
}

function makeFallbackQuestion({ i, language, courseLabel, batch }) {
  const sv = (language === "sv");
  const scenario = (batch && batch.scenario) ? batch.scenario : null;
  const place = scenario ? scenario.place : (sv ? "på arbetsplatsen" : "at work");

  const s1 = scenario ? scenario.setting : (sv ? "Du märker att informationen inte går ihop" : "You notice the information does not align");
  const s2 = scenario ? scenario.constraintB : (sv ? "Två personer säger olika och du har ont om tid." : "Two people disagree and you are short on time.");
  const q = sv
    ? `${s1} ${place}. ${s2} Vad gör du först för att undvika att ni gissar?`
    : `${s1} ${place}. ${s2} What do you do first to avoid guessing?`;

  const options = sv
    ? [
        "Stoppa och säkra fakta: samla underlag innan ni bestämmer",
        "Gå direkt på den snabbaste lösningen så det blir klart",
        "Låt alla göra som de tycker är rimligt",
        "Vänta tills någon annan tar beslutet"
      ]
    : [
        "Stop and secure facts: gather evidence before deciding",
        "Jump to the fastest solution to get it done",
        "Let everyone do what they think is reasonable",
        "Wait for someone else to decide"
      ];

  const rationale = sv
    ? "Förklaring: Första steget är att säkra fakta och spårbarhet innan ni väljer åtgärd. Annars riskerar ni att lösa fel problem."
    : "Explanation: The first step is to secure facts and traceability before choosing an action. Otherwise you risk solving the wrong problem.";

  // bygg “choice-question” som resten av pipeline förväntar sig
  const choices = options.map((t, idx) => ({ id: `c${idx + 1}`, text: t }));
  return {
    kind: "question",
    text: stripDomainWordsFromQuestion(q, language),
    choices,
    correctChoiceId: "c1",
    rationale,
    difficulty: undefined,
    tags: ["fallback", "dedupe_fail", `area_${normKey(courseLabel && courseLabel.area).slice(0, 32)}`]
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

// ============================================================
// BLOCK 15 — Choice pools + rationales
// ============================================================

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
// BLOCK 16 — UI-frågeformat (options + correctIndex)
// ============================================================

function normalizeQuestionType(v) {
  const raw = safeStr(v).trim();
  const s0 = raw.toLowerCase();
  if (!s0) return "";

  const s = s0
    .replace(/\s+/g, "_")
    .replace(/[()]/g, "")
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o");

  // P0: ALLA auto-varianter ska räknas som "auto"
  // Ex: "auto", "auto_mcq", "auto-mcq", "auto mcq single", "auto_tf", "auto_anything"
  if (s === "auto" || s.startsWith("auto_") || s.startsWith("auto-") || s.startsWith("auto")) {
    return "auto";
  }

  // Canonical (ai-rules/v1)
  if (s === "mcq_single" || s === "single" || s === "mcq" || s === "mcq1" || s === "mcq_one") return "mcq_single";
  if (s === "mcq_multi" || s === "multi" || s === "mcqm" || s === "mcq_many") return "mcq_multi";
  if (s === "truefalse" || s === "true_false" || s === "sant_falskt" || s === "santfalskt" || s === "tf") return "true_false";
  if (s === "short_answer" || s === "short" || s === "kortsvar" || s === "kort") return "short_answer";
  if (s === "numeric" || s === "number" || s === "tal") return "numeric";

  if (s.includes("mcq") && s.includes("multi")) return "mcq_multi";
  if (s.includes("mcq") && (s.includes("single") || s.includes("ett") || s.includes("one") || s.includes("1"))) return "mcq_single";
  if (s.includes("true") || s.includes("false") || s.includes("sant") || s.includes("falskt")) return "true_false";

  return raw;
}

// P0 PATCH: "auto" är också ett UI-frågeläge och ska ge stabilt items[]-output.
function isUiQuestionRequest(questionType) {
  const qt = normalizeQuestionType(questionType);
  return qt === "auto" || qt === "mcq_single" || qt === "mcq_multi" || qt === "true_false";
}

function mapTrainingBlocksToUiQuestions(trainingBlocks, questionType, language) {
  const qt0 = normalizeQuestionType(questionType);
  const qt = (qt0 === "auto") ? "mcq_single" : qt0; // P0 PATCH: auto -> mcq_single (stabil UI-contract)

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

// ===================== EOF =====================
