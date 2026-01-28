// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.9)
// FIL: worker/routes/v1_ai_generate.js
// Syfte: POST /v1/ai/generate (och alias) → input-parse → build → envelope.
//       Fixar “nu försvann frågorna” genom:
//       - Stabil default: om UI kör questions-format/contentType=questions men qType saknas => auto
//       - Fail-closed mapping: items[] måste bli 1:1 med question-blocks när UI begär frågor
//
// POLICY (LÅST):
// - Stateless
// - Fail-closed
// - Endast JSON
// - Max payload 64KB
// - Logga aldrig payload (endast requestId + felkod i caller)
// - CORS strikt: aldrig wildcard
// ============================================================

import { safeStr, isPlainObject, okJSON, errorJSON } from "../rules.js";
import {
  normalizeLanguage,
  normalizeMode,
  normalizeCount,
  normalizeContextText,
  normalizeQuestionType,
  isUiQuestionRequest,
  normalizeSubjectId,
  parseV1RulesetPayload,
  validateCourseSubject,
  normalizeCourseSubject,
  inferCourseFromContextText,
  resolveCourseLabelFallback
} from "../v1.js";

import { getRulesBundle } from "../bundle.js";
import { buildTrainingBlocks } from "../generate/training.js";
import { mapTrainingBlocksToUiQuestions } from "../generate/questions.js";

// ------------------------------
// main route handler
// ------------------------------
export async function handleAiGenerate({ request, env, requestId, corsHeaders, path }) {
  // NOTE: guards (CORS/auth/json/size) är redan gjorda i index.js innan vi kommer hit.
  // Här gör vi bara parsing + v1/legacy-hantering + output.

  // ---- parse body (bytes läses av caller eller här). Vi kör här (en gång) för enkelhet.
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJSON(400, requestId, "BAD_JSON", "Kunde inte tolka JSON", corsHeaders, true);
  }

  if (!isPlainObject(body)) {
    return errorJSON(400, requestId, "VALIDATION_ERROR", "Body måste vara ett JSON-objekt", corsHeaders, true);
  }

  // requestId override från UI om den finns
  const incomingReqId = safeStr(body.requestId).trim();
  const rid = incomingReqId || requestId;

  // -------- mode från path + legacy --------
  let modeRaw = safeStr(body.mode || body.type).trim();
  if (path === "/v1/ai/training") modeRaw = "training";
  if (path === "/v1/ai/document") modeRaw = "document";
  const mode0 = normalizeMode(modeRaw);

  // -------- v1 detection (ai-rules/v1) --------
  const v1 = parseV1RulesetPayload(body);
  const isV1 = !!v1;

  // defaults
  let mode = mode0;
  let countRaw = body.count ?? body.n;
  let languageRaw = body.language || "sv";
  let contextText = normalizeContextText(body.context ?? body.prompt ?? "");
  let format = safeStr(body.format || "").trim();
  let subjectId = safeStr(body.subjectId || body.subject || "").trim();
  let difficultyHint = body.difficultyHint ?? body.difficulty;

  // frågetyp: OBS! medvetet INTE body.question (krockar med frågetext)
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

  // legacy subjectObj
  const subjectObj = isPlainObject(body.subjectObj)
    ? body.subjectObj
    : (isPlainObject(body.subject) ? body.subject : null);

  let course = normalizeCourseSubject(subjectObj);

  // ---- v1 override ----
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

  // P0: stabil default om UI tydligt kör questions-format/contentType=questions men questionType saknas
  const fmtHint = safeStr(format).toLowerCase();
  const ctHint = safeStr(body && body.contentType).trim();
  if (!safeStr(questionType).trim() && (fmtHint.includes("question") || ctHint === "questions")) {
    questionType = "auto";
  }

  const language = normalizeLanguage(languageRaw);

  // -------- validation --------
  if (!(mode === "training" || mode === "document")) {
    return errorJSON(400, rid, "VALIDATION_ERROR", "mode måste vara training eller document", corsHeaders, true);
  }

  const count = normalizeCount(countRaw);
  if (count === null) {
    return errorJSON(400, rid, "VALIDATION_ERROR", "count måste vara mellan 1 och 12", corsHeaders, true);
  }

  if (!(language === "sv" || language === "en")) {
    return errorJSON(400, rid, "VALIDATION_ERROR", "language måste vara sv eller en", corsHeaders, true);
  }

  if (contextText.length > 4000) {
    return errorJSON(400, rid, "VALIDATION_ERROR", "context max 4000 tecken", corsHeaders, true);
  }

  const courseCheck = validateCourseSubject(course);
  if (!courseCheck.ok) {
    return errorJSON(400, rid, "VALIDATION_ERROR", courseCheck.message, corsHeaders, true);
  }

  // -------- course label fallback (även om course saknas helt) --------
  const inferred = (!course) ? inferCourseFromContextText(contextText) : null;
  const courseLabel = resolveCourseLabelFallback(course || inferred, mode, contextText);

  // -------- bundle --------
  const subjId = normalizeSubjectId(subjectId);
  const bundle = getRulesBundle(subjId);

  // -------- deterministic seed base --------
  // (seed behöver ligga i index.js tidigare om du vill, men här räcker det)
  // buildTrainingBlocks tar ett “n” (seed-int) från index.js i vår uppdelning.
  // Vi använder requestId-hash som stabil bas om index.js inte skickar in n.
  const n = (hash32(`${rid}|${mode}|${count}|${language}|${subjId}|${courseLabel.module}|${courseLabel.area}|${courseLabel.step}|${safeStr(difficultyHint)}|${safeStr(questionType)}|${safeStr(contextText).slice(0, 196)}`) >>> 0);

  // -------- build training (mock/rules-driven) --------
  let built;
  try {
    built = buildTrainingBlocks({
      n,
      language,
      difficulty: difficultyHint,
      count,
      contextText,
      courseLabel,
      questionType,
      bundle
    });
  } catch (e) {
    // fail-closed: om vår interna räknare/uniqueness får problem ska UI få tydligt fel
    return errorJSON(502, rid, "UPSTREAM_ERROR", "Kunde inte bygga training-blocks", corsHeaders, true);
  }

  // Top-level envelope (behåller både training + blocks)
  const topBlocks = Array.isArray(built.blocks) ? built.blocks : [];

  // items default = blocks (training-blocks consumers)
  let items = topBlocks;

  // UI questions request => map question-blocks → UI format items[]
  if (isUiQuestionRequest(questionType)) {
    const mapped = mapTrainingBlocksToUiQuestions(topBlocks, questionType, language);
    if (!mapped.ok) {
      return errorJSON(422, rid, mapped.errorCode, mapped.message, corsHeaders, true);
    }
    items = mapped.items;
  }

  const training = {
    id: `tr_${subjId}_${hash32(rid).toString(16)}`.slice(0, 24),
    mode,
    subject: {
      module: courseLabel.module,
      area: courseLabel.area,
      chapter: courseLabel.chapter,
      step: courseLabel.step
    },
    difficulty: safeStr(built.difficulty || "").trim() || undefined,
    title: safeStr(built.title || "").trim() || undefined,
    summary: safeStr(built.summary || "").trim() || undefined,
    objectives: Array.isArray(built.objectives) ? built.objectives : [],
    blocks: topBlocks,
    meta: {
      createdAt: Date.now(),
      createdBy: "worker",
      source: "split-v1.5.9"
    }
  };

  return okJSON(
    200,
    {
      ok: true,
      requestId: rid,
      items,                  // v1-friendly (UI kan använda)
      data: { training },     // legacy-friendly
      training,               // legacy-friendly
      blocks: topBlocks,
      mode
    },
    corsHeaders,
    rid
  );
}

// ------------------------------
// local hash (keep self-contained)
// ------------------------------
function hash32(str) {
  let h = 2166136261 >>> 0; // FNV-1a base
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

