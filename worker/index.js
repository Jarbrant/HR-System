// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.6.4 VARIATION+ARC + V1-CONTRACT)
// FIL: worker/index.js
//
// PATCH v1.6.4 (DIAG-HEADERS SHAPE + REASON-CODES):
// - P0: Exakta reason-codes (NO_JSON / NO_QUESTIONS / BAD_SHAPE / RUN_FAIL).
// - P0: X-HR-AI-DBG header (ingen payload): answerType, topKeys, pickedField, jsonFound, questionsFound, extractedLen.
// - P0: Fortsatt fail-soft + fallback deterministic.
// ============================================================

import { isPlainObject, safeStr, safeArr } from "./utils.js";

// ---------------- UI helpers (oförändrat) ----------------

function normalizeQuestionType(qtRaw) {
  const q = safeStr(qtRaw).toLowerCase().trim();
  if (!q) return "";
  if (q === "auto") return "auto";
  if (q === "mcq" || q === "single" || q === "mcq_single" || q === "mcq-single") return "mcq_single";
  if (q === "multi" || q === "mcq_multi" || q === "mcq-multi") return "mcq_multi";
  if (q === "tf" || q === "truefalse" || q === "true_false" || q === "true-false") return "true_false";
  if (q.includes("mcq") && q.includes("multi")) return "mcq_multi";
  if (q.includes("mcq")) return "mcq_single";
  if (q.includes("true") || q.includes("false")) return "true_false";
  return q;
}

function isUiQuestionRequest(questionTypeRaw) {
  const qt = normalizeQuestionType(questionTypeRaw);
  return qt === "auto" || qt === "mcq_single" || qt === "mcq_multi" || qt === "true_false";
}

function mapTrainingBlocksToUiQuestions(blocks /*, questionTypeRaw*/) {
  const out = [];
  const arr = Array.isArray(blocks) ? blocks : [];

  for (const b of arr) {
    if (!b || b.kind !== "question") continue;

    const items = Array.isArray(b.items) ? b.items : [];
    const qi = items.find((x) => x && x.type === "questionInline" && x.question);
    const q = qi && qi.question ? qi.question : null;
    if (!q) return { ok: false, errorCode: "UI_MAP_FAILED", message: "Question-block saknar questionInline.question" };

    const stem = safeStr(q.text || q.question || "").trim();
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const options = choices.map((c) => safeStr(c && c.text).trim()).filter(Boolean);

    if (!stem) return { ok: false, errorCode: "UI_MAP_FAILED", message: "En fråga saknar text" };
    if (options.length < 2) return { ok: false, errorCode: "UI_MAP_FAILED", message: "AI-svaret saknade giltiga svarsalternativ" };

    let correctIndex = -1;
    let correctIndices = null;

    const correctChoiceId = safeStr(q.correctChoiceId).trim();
    if (correctChoiceId) correctIndex = choices.findIndex((c) => safeStr(c && c.id).trim() === correctChoiceId);

    const ids = Array.isArray(q.correctChoiceIds) ? q.correctChoiceIds : null;
    if (ids && ids.length) {
      const mapped = ids
        .map((id) => choices.findIndex((c) => safeStr(c && c.id).trim() === safeStr(id).trim()))
        .filter((n) => Number.isInteger(n) && n >= 0);
      if (mapped.length) correctIndices = mapped;
    }

    if (correctIndex < 0 && (!correctIndices || !correctIndices.length)) correctIndex = 0;
    const explanation = safeStr(q.rationale || q.explanation || q.feedback || "").trim();

    out.push({
      type: "question",
      question: stem,
      options,
      correctIndex,
      ...(correctIndices ? { correctIndices } : {}),
      ...(explanation ? { explanation } : {}),
    });
  }

  if (!out.length) return { ok: false, errorCode: "UI_NO_QUESTIONS", message: "Inga question-block hittades att mappa till UI-frågor" };
  return { ok: true, items: out };
}

// ---------------- constants ----------------

export const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.6.4";

// ---------------- local utils ----------------

function normalizeLanguage(v) {
  const s = safeStr(v).toLowerCase().trim();
  if (s === "sv" || s === "sv-se" || s === "svenska") return "sv";
  if (s === "en" || s === "en-us" || s === "en-gb" || s === "english") return "en";
  return "sv";
}

function normalizeMode(v) {
  const s = safeStr(v).toLowerCase().trim();
  if (s === "document" || s === "doc") return "document";
  return "training";
}

function normalizeContextText(v) {
  if (typeof v === "string") return v.trim();
  if (v === null || v === undefined) return "";
  try {
    if (typeof v === "object") return safeStr(v.text || v.contextText || v.prompt || "").trim();
  } catch (_) {}
  return safeStr(v).trim();
}

function normalizeCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 1 || i > 12) return null;
  return i;
}

function makeRequestId() {
  try {
    if (typeof crypto !== "undefined" && crypto && typeof crypto.getRandomValues === "function") {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    }
  } catch (_) {}
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

function hash32(str) {
  const s = safeStr(str);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalizeOrigin(s) {
  return safeStr(s).trim().replace(/\/+$/g, "");
}

function extractFirstJsonObjectString(text) {
  const s = safeStr(text);
  const start = s.indexOf("{");
  if (start < 0) return "";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) return s.slice(start, i + 1);
  }
  return "";
}

function safeJsonParseLoose(text) {
  const t = safeStr(text).trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch (_) {}
  const cleaned = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const objStr = extractFirstJsonObjectString(cleaned);
  if (!objStr) return null;
  try { return JSON.parse(objStr); } catch (_) { return null; }
}

function safeJsonFromUnknown(x) {
  if (isPlainObject(x) || Array.isArray(x)) return x;
  const t = safeStr(x).trim();
  if (!t) return null;
  return safeJsonParseLoose(t);
}

function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const s = safeStr(v).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function padOptions(language, options, target) {
  const sv = language === "sv";
  const basePads = sv
    ? ["Inget av ovanstående.", "Be om mer information innan du bestämmer.", "Dokumentera först och återkom.", "Kontrollera mot rutin/checklista."]
    : ["None of the above.", "Ask for more information before deciding.", "Document first and revisit.", "Verify against the checklist/routine."];

  const out = uniqStrings(Array.isArray(options) ? options : []);
  for (const p of basePads) { if (out.length >= target) break; out.push(p); }
  let k = 1;
  while (out.length < target && k < 20) { out.push(sv ? `Alternativ ${out.length + 1}.` : `Option ${out.length + 1}.`); k++; }
  return out.slice(0, target);
}

function normalizeToAiQt(questionTypeRaw) {
  const qt = normalizeQuestionType(questionTypeRaw);
  if (qt === "auto" || !qt) return "mcq_single";
  return qt;
}

// ---------------- DIAG extractors (NO PAYLOAD) ----------------

function topKeys(obj) {
  try { return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj).slice(0, 10) : []; } catch { return []; }
}

function pickFirstStringDeep(obj, depth = 0, meta = { pickedField: "" }) {
  if (depth > 6) return "";
  if (typeof obj === "string") return obj;
  if (!obj || typeof obj !== "object") return "";
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const s = pickFirstStringDeep(it, depth + 1, meta);
      if (s) return s;
    }
    return "";
  }

  const pref = ["response", "result", "output", "text", "content", "message"];
  for (const k of pref) {
    if (k in obj) {
      if (!meta.pickedField) meta.pickedField = k;
      const s = pickFirstStringDeep(obj[k], depth + 1, meta);
      if (s) return s;
    }
  }

  for (const k of Object.keys(obj)) {
    const s = pickFirstStringDeep(obj[k], depth + 1, meta);
    if (s) { if (!meta.pickedField) meta.pickedField = k; return s; }
  }
  return "";
}

function extractQuestionsFromParsed(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!isPlainObject(parsed)) return null;
  if (Array.isArray(parsed.questions)) return parsed.questions;

  const nests = [parsed.data, parsed.result, parsed.output, parsed.response, parsed.payload, parsed.value];
  for (const n of nests) {
    if (isPlainObject(n) && Array.isArray(n.questions)) return n.questions;
    if (Array.isArray(n)) return n;
  }

  try {
    const d = isPlainObject(parsed.data) ? parsed.data : null;
    if (d) {
      if (isPlainObject(d.result) && Array.isArray(d.result.questions)) return d.result.questions;
      if (isPlainObject(d.output) && Array.isArray(d.output.questions)) return d.output.questions;
    }
  } catch (_) {}
  return null;
}

// ---------------- v1 payload parser (oförändrat) ----------------

function parseV1RulesetPayload(body) {
  if (!isPlainObject(body)) return null;
  const rv = safeStr(body.rulesetVersion || body.ruleset || body.version || "").toLowerCase().trim();
  const v1obj = isPlainObject(body.v1) ? body.v1 : null;
  if (!v1obj && rv !== "v1" && rv !== "ai-rules/v1") return null;

  const src = v1obj || body;
  const mode = normalizeMode(src.mode || src.type || "training");
  const count = normalizeCount(src.count ?? src.n);
  const language = normalizeLanguage(src.language || "sv");
  const contextText = normalizeContextText(src.context ?? src.contextText ?? src.prompt ?? "");
  const format = safeStr(src.format || "").trim();
  const subjectId = safeStr(src.subjectId || src.subject || "").trim();
  const questionType = normalizeQuestionType(src.questionType || src.qType || "");
  const difficulty = src.difficultyHint ?? src.difficulty ?? "";
  const course = isPlainObject(src.course) ? src.course : isPlainObject(src.subjectObj) ? src.subjectObj : null;

  if (!count) return null;
  return { mode, count, language, contextText, format, subjectId, questionType, difficulty, course };
}

function normalizeCourseSubject(subjectObj) {
  if (!isPlainObject(subjectObj)) return { id: "generic" };
  const id = safeStr(subjectObj.id || subjectObj.subjectId || subjectObj.subject || "generic").trim() || "generic";
  return { ...subjectObj, id };
}

function validateCourseSubject(course) {
  if (!course) return { ok: true };
  if (typeof course !== "object") return { ok: true };
  return { ok: true };
}

// ============================================================
// FETCH
// ============================================================

export default {
  async fetch(request, env) {
    let requestId = makeRequestId();
    const url = new URL(request.url);

    const allowedOriginRaw = safeStr(env && env.ALLOWED_ORIGIN).trim();
    const requireAuth = safeStr(env && env.REQUIRE_AUTH).trim().toLowerCase() === "true";
    const aiEnabled = safeStr(env && env.AI_ENABLED).trim().toLowerCase() === "true";

    if (!allowedOriginRaw) {
      console.error("ERR", requestId, "ENV_MISSING");
      return okJSON(500, { ok: false, requestId, errorCode: "ENV_MISSING", error: { code: "ENV_MISSING", message: "ALLOWED_ORIGIN saknas i env" } }, {}, requestId);
    }

    const allowedOrigin = normalizeOrigin(allowedOriginRaw);
    const origin = normalizeOrigin(request.headers.get("Origin") || "");
    const corsHeaders = buildCorsHeaders(origin, allowedOrigin);

    if (request.method === "OPTIONS") {
      if (!origin || origin !== allowedOrigin) return errorJSON(403, requestId, "CORS_FORBIDDEN", "Origin är inte tillåten", corsHeaders, true);
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const path = url.pathname || "/";

    if (request.method === "GET" && path === "/v1/health") {
      if (origin && origin !== allowedOrigin) return errorJSON(403, requestId, "CORS_FORBIDDEN", "Origin är inte tillåten", corsHeaders, true);
      const hasAIBinding = !!(env && env.AI && typeof env.AI.run === "function");
      const model = safeStr(env && env.AI_MODEL).trim() || "@cf/meta/llama-3.1-8b-instruct";
      return okJSON(200, { ok: true, requestId, data: { service: "hr-worker", version: VERSION, v: "v1", rulesets: { ok: true, base: "ai-rules" }, ai: { enabled: aiEnabled, binding: hasAIBinding, model } } }, corsHeaders, requestId);
    }

    if (request.method === "GET" && path === "/v1/version") {
      if (origin && origin !== allowedOrigin) return errorJSON(403, requestId, "CORS_FORBIDDEN", "Origin är inte tillåten", corsHeaders, true);
      return okJSON(200, { ok: true, requestId, data: { service: "hr-worker", version: VERSION, build: "wrangler", rulesBase: "ai-rules", outputContract: "training-blocks@v1 + ui-mcq@v1.2 + items-envelope@v1.6" } }, corsHeaders, requestId);
    }

    if (request.method !== "POST") return errorJSON(405, requestId, "METHOD_NOT_ALLOWED", "Endast POST tillåtet för AI-endpoints", corsHeaders, true);

    const isAIPath = path === "/v1/ai/generate" || path === "/v1/ai/training" || path === "/v1/ai/document";
    if (!isAIPath) return errorJSON(404, requestId, "NOT_FOUND", "Endpoint finns inte", corsHeaders, true);

    if (!origin || origin !== allowedOrigin) return errorJSON(403, requestId, "CORS_FORBIDDEN", "Origin är inte tillåten", corsHeaders, true);

    if (requireAuth) {
      const token = extractBearerToken(request.headers.get("Authorization") || "");
      const expected = safeStr(env && env.WORKER_TOKEN).trim();
      if (!token || !expected || token !== expected) return errorJSON(401, requestId, "UNAUTHORIZED", "Ogiltig eller saknad token", corsHeaders, true);
    }

    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!ct.includes("application/json")) return errorJSON(400, requestId, "BAD_JSON", "Endast application/json tillåtet", corsHeaders, true);

    let rawBytes;
    try { rawBytes = await request.clone().arrayBuffer(); } catch { return errorJSON(400, requestId, "BAD_JSON", "Kunde inte läsa request body", corsHeaders, true); }
    if (rawBytes.byteLength > MAX_BODY_BYTES) return errorJSON(413, requestId, "PAYLOAD_TOO_LARGE", "Payload för stor", corsHeaders, true);

    let body;
    try { body = JSON.parse(new TextDecoder("utf-8").decode(rawBytes)); } catch { return errorJSON(400, requestId, "BAD_JSON", "Kunde inte tolka JSON", corsHeaders, true); }
    if (!isPlainObject(body)) return errorJSON(400, requestId, "VALIDATION_ERROR", "Body måste vara ett JSON-objekt", corsHeaders, true);

    const incomingReqId = safeStr(body.requestId).trim();
    if (incomingReqId) requestId = incomingReqId;

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

    let questionType = normalizeQuestionType(
      body.questionType ?? body.qType ?? body.questionMode ?? body.question_mode ?? body.questionKind ?? body.question_kind ?? body.quizMode ?? body.mcqMode ?? body.mcq_type ?? ""
    );

    const subjectObj = isPlainObject(body.subjectObj) ? body.subjectObj : isPlainObject(body.subject) ? body.subject : null;
    let course = normalizeCourseSubject(subjectObj);

    if (isV1) {
      mode = v1.mode;
      format = v1.format;
      countRaw = v1.count;
      languageRaw = v1.language;
      questionType = v1.questionType;
      difficultyHint = v1.difficulty;
      course = normalizeCourseSubject(v1.course);
      contextText = v1.contextText;
      subjectId = v1.subjectId || subjectId;
    }

    const language = normalizeLanguage(languageRaw);
    const count = normalizeCount(countRaw);
    if (count === null) return errorJSON(400, requestId, "VALIDATION_ERROR", "count måste vara mellan 1 och 12", corsHeaders, true);
    if (contextText.length > 4000) return errorJSON(400, requestId, "VALIDATION_ERROR", "context max 4000 tecken", corsHeaders, true);
    if (!aiEnabled) return errorJSON(503, requestId, "AI_DISABLED", "AI_ENABLED=false (Workern är avstängd)", corsHeaders, true);

    // ---------------- BUILD ----------------

    let training;
    let aiSource = "fallback";
    let aiReason = "OK";
    let aiDbg = "";

    try {
      const res = await buildTrainingBlocks(
        { requestId, mode, count, language, context: contextText, format, subjectId, difficultyHint, course, questionType },
        env
      );
      training = res && res.training ? res.training : res;
      aiSource = safeStr(res && res.source).trim() || "fallback";
      aiReason = safeStr(res && res.reason).trim() || "SCHEMA_FAIL";
      aiDbg = safeStr(res && res.debug).trim();
    } catch (e) {
      const msg = safeStr(e && (e.message || e.stack || String(e))).slice(0, 200);
      console.error("ERR", requestId, "WORKER_BUILD_FAILED");
      return errorJSON(502, requestId, "WORKER_BUILD_FAILED", msg || "Worker kunde inte bygga ett giltigt svar", corsHeaders, true);
    }

    if (!training || typeof training !== "object") return errorJSON(502, requestId, "WORKER_BUILD_FAILED", "training är ogiltig", corsHeaders, true);

    const topBlocks = Array.isArray(training.blocks) ? training.blocks : [];
    let items = topBlocks;

    if (isUiQuestionRequest(questionType)) {
      const mapped = mapTrainingBlocksToUiQuestions(topBlocks, questionType);
      if (!mapped.ok) return errorJSON(422, requestId, mapped.errorCode, mapped.message, corsHeaders, true);
      items = mapped.items;
    }

    const hdr = {
      ...(corsHeaders || {}),
      "X-HR-AI": aiSource === "cf" ? "cf" : "fallback",
      "X-HR-AI-REASON": safeStr(aiReason || "OK"),
      ...(aiDbg ? { "X-HR-AI-DBG": aiDbg.slice(0, 480) } : {}),
    };

    return okJSON(200, { ok: true, requestId, items, data: { training }, training, blocks: topBlocks, mode: training.mode || mode }, hdr, requestId);
  },
};

// ---------------- HTTP helpers ----------------

function buildCorsHeaders(origin, allowedOrigin) {
  const allowOrigin = allowedOrigin && origin && origin === allowedOrigin ? allowedOrigin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Hr-Sdk, X-Hr-Client, X-HR-SDK, X-HR-Client, X-HR-CLIENT",
    "Vary": "Origin",
  };
}

function okJSON(status, payload, corsHeaders, requestId) {
  let body = "{}";
  try { body = JSON.stringify(payload); } catch (_) { body = JSON.stringify({ ok: false, requestId: safeStr(requestId || ""), errorCode: "JSON_STRINGIFY_FAILED" }); }
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": safeStr(requestId || ""),
      "X-HR-Request-Id": safeStr(requestId || ""),
      ...(corsHeaders || {}),
    },
  });
}

function errorJSON(status, requestId, code, message, corsHeaders, logIt) {
  if (logIt) console.error("ERR", requestId, safeStr(code));
  return okJSON(status, { ok: false, requestId, errorCode: safeStr(code), error: { code: safeStr(code), message: safeStr(message) } }, corsHeaders, requestId);
}

function extractBearerToken(authHeader) {
  const h = safeStr(authHeader).trim();
  if (!h) return "";
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

// ============================================================
// TRAINING ENGINE (CF first)
// ============================================================

async function buildTrainingBlocks(input, env) {
  const hasBinding = !!(env && env.AI && typeof env.AI.run === "function");
  if (!hasBinding) return { training: buildTrainingBlocksDeterministic(input), source: "fallback", reason: "NO_BINDING", debug: "bind=0" };

  const out = await buildTrainingBlocksWithAI(input, env);
  if (out && out.ok && Array.isArray(out.blocks) && out.blocks.length) return { training: out, source: "cf", reason: "OK", debug: out.__dbg || "" };

  // fallback but keep exact reason/debug
  return {
    training: buildTrainingBlocksDeterministic(input),
    source: "fallback",
    reason: safeStr(out && out.__reason) || "SCHEMA_FAIL",
    debug: safeStr(out && out.__dbg) || "",
  };
}

async function buildTrainingBlocksWithAI(input, env) {
  const requestId = safeStr(input && input.requestId).trim();
  const mode = safeStr(input && input.mode).trim() || "training";
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextText = safeStr(input && (input.context || input.contextText)).trim();
  const subjectId = safeStr(input && input.subjectId).trim() || "generic";
  const qt = normalizeToAiQt(input && input.questionType);

  const place = inferWorkplaceFromContext(contextText, language);
  const arc = buildStoryArc(count);
  const pack = pickScenarioPack(contextText, place, language, hash32(`${requestId}|${subjectId}|${language}|${contextText.slice(0, 120)}`));
  const sv = language === "sv";

  const schemaHint = sv
    ? `Returnera ENDAST JSON enligt schema. Inget markdown.
{"questions":[{"stem":"string","options":["A","B","C","D"],"correctIndex":0,"explanation":"string"}]}
Exakt ${count} frågor. Unika. correctIndex giltig.`
    : `Return ONLY JSON per schema. No markdown.
{"questions":[{"stem":"string","options":["A","B","C","D"],"correctIndex":0,"explanation":"string"}]}
Exactly ${count} questions. Unique. correctIndex valid.`;

  const systemPrompt = sv ? `Du skapar provfrågor för HR/QA. Svara strikt som JSON.` : `You create assessment questions. Reply strictly as JSON.`;
  const userPrompt =
    (sv ? `KONTEXT:\n${contextText || "(ingen)"}\n\n` : `CONTEXT:\n${contextText || "(none)"}\n\n`) +
    (sv
      ? `SCENARIOPACK:\nplace=${pack.place}\nsetting=${pack.setting}\nartifact=${pack.artifact}\nconstraint=${pack.constraintB}\ntwist=${pack.twist}\n\n`
      : `SCENARIO PACK:\nplace=${pack.place}\nsetting=${pack.setting}\nartifact=${pack.artifact}\nconstraint=${pack.constraintB}\ntwist=${pack.twist}\n\n`) +
    (sv ? `ARC:\n${arc.join(", ")}\n\n` : `ARC:\n${arc.join(", ")}\n\n`) +
    `questionType=${qt}\n\n` +
    schemaHint;

  const model = safeStr(env && env.AI_MODEL).trim() || "@cf/meta/llama-3.1-8b-instruct";

  let answer;
  try {
    answer = await env.AI.run(model, { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] });
  } catch (_) {
    try {
      answer = await env.AI.run("@cf/meta/llama-3-8b-instruct", { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] });
    } catch (e2) {
      return { __reason: "RUN_FAIL", __dbg: "ai.run=fail", ok: false };
    }
  }

  // ---- DIAG meta (NO payload) ----
  const aType = Array.isArray(answer) ? "array" : typeof answer;
  const keys = isPlainObject(answer) ? topKeys(answer).join(",") : "";
  const meta = { pickedField: "" };
  const pickedStr = pickFirstStringDeep(answer, 0, meta);
  const extractedLen = pickedStr ? String(pickedStr).length : 0;

  const parsed = safeJsonFromUnknown(answer) || safeJsonFromUnknown(pickedStr);
  const jsonFound = parsed ? 1 : 0;

  const qArr = extractQuestionsFromParsed(parsed);
  const questionsFound = Array.isArray(qArr) ? qArr.length : 0;

  const dbg = `t=${aType};k=${keys || "-"};pick=${meta.pickedField || "-"};len=${extractedLen};json=${jsonFound};q=${questionsFound}`;

  if (!parsed) return { __reason: "NO_JSON", __dbg: dbg, ok: false };
  if (!Array.isArray(qArr) || !qArr.length) return { __reason: "NO_QUESTIONS", __dbg: dbg, ok: false };

  // build blocks fail-soft
  const blocks = [];
  const seenStem = new Set();

  for (let i = 0; i < qArr.length && blocks.length < count; i++) {
    const q = qArr[i];
    const stem = safeStr(q && (q.stem || q.question || q.text)).trim();
    if (!stem) continue;

    const key = stem.toLowerCase().replace(/\s+/g, " ").trim();
    if (seenStem.has(key)) continue;
    seenStem.add(key);

    const optsRaw = Array.isArray(q && q.options) ? q.options : Array.isArray(q && q.choices) ? q.choices : Array.isArray(q && q.answers) ? q.answers : [];
    let options = optsRaw.map((x) => (isPlainObject(x) ? safeStr(x.text || x.label || x.value) : safeStr(x))).map((s) => safeStr(s).trim()).filter(Boolean);
    options = uniqStrings(options);

    if (qt === "true_false") {
      if (options.length < 2) options = sv ? ["Sant", "Falskt"] : ["True", "False"];
      else options = options.slice(0, 2);
    } else {
      if (options.length < 2) continue;
      options = padOptions(language, options, 4);
    }

    const ciRaw = Number(q && q.correctIndex);
    const correctIndex = Number.isFinite(ciRaw) && ciRaw >= 0 && ciRaw < options.length ? Math.floor(ciRaw) : 0;
    const explanation = safeStr(q && (q.explanation || q.rationale || q.feedback)).trim();

    blocks.push(makeQuestionBlockFromUi({ i: blocks.length, stem, options, correctIndex, explanation }));
  }

  if (!blocks.length) return { __reason: "BAD_SHAPE", __dbg: dbg, ok: false };

  const normalizedBlocks = blocks.slice(0, count).map((b, idx) => ({ ...b, id: `q_${idx + 1}` }));
  return { ok: true, __dbg: dbg, v: "training-blocks@v1", mode, subjectId, language, blocks: normalizedBlocks };
}

function makeQuestionBlockFromUi({ i, stem, options, correctIndex, explanation }) {
  const choices = options.map((text, idx) => ({ id: `c${i + 1}_${idx + 1}`, text: safeStr(text) }));
  const safeIdx = Math.max(0, Math.min(choices.length - 1, Number(correctIndex) || 0));
  return {
    kind: "question",
    id: `q_${i + 1}`,
    items: [
      { type: "questionInline", question: { text: safeStr(stem), choices, correctChoiceId: choices[safeIdx].id, rationale: safeStr(explanation || "") } },
    ],
  };
}

// -------- deterministic fallback (oförändrat) --------

function buildTrainingBlocksDeterministic(input) {
  const requestId = safeStr(input && input.requestId).trim();
  const mode = safeStr(input && input.mode).trim() || "training";
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextText = safeStr(input && (input.context || input.contextText)).trim();
  const subjectId = safeStr(input && input.subjectId).trim() || "generic";
  const questionType = normalizeQuestionType(input && input.questionType);

  const place = inferWorkplaceFromContext(contextText, language);

  const seedBase = hash32(["AO-WORKER-TRAINING-BLOCKS-01", VERSION, requestId || "no-req", subjectId, language, questionType, contextText.slice(0, 160)].join("|"));
  const arc = buildStoryArc(count);
  const pack = pickScenarioPack(contextText, place, language, seedBase);

  const blocks = [];
  for (let i = 0; i < count; i++) blocks.push(makeQuestionBlock({ i, language, pack, dim: arc[i] || "scenario_application" }));
  return { ok: true, v: "training-blocks@v1", mode, subjectId, language, blocks };
}

function inferWorkplaceFromContext(contextText, language) {
  const t = safeStr(contextText).toLowerCase();
  const sv = language === "sv";
  if (t.includes("kök") || t.includes("restaurang") || t.includes("servering")) return sv ? "i köket" : "in the kitchen";
  if (t.includes("leverans") || t.includes("mottagning") || t.includes("varumottag")) return sv ? "vid varumottagningen" : "at receiving";
  if (t.includes("internkontroll") || t.includes("revision") || t.includes("audit")) return sv ? "i en internkontroll" : "in an internal check";
  if (t.includes("morgonmöte") || t.includes("brief") || t.includes("standup")) return sv ? "på ett kort avstämningsmöte" : "in a short briefing";
  return sv ? "på arbetsplatsen" : "at work";
}

function buildStoryArc(count) {
  const base = ["scenario_application","routine_start","traceability_and_evidence","risk_consequence","deviation_and_action","roles_and_responsibility","traceability_and_evidence","scenario_application"];
  const tail = ["risk_consequence","deviation_and_action","roles_and_responsibility","routine_start"];
  const seq = [];
  for (let i = 0; i < count; i++) seq.push(i < base.length ? base[i] : tail[(i - base.length) % tail.length]);
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
  if (!packs.length) packs.push("generic");

  const packId = packs[seed % packs.length];
  const sv = language === "sv";

  const defs = {
    receiving: { setting: sv ? "En leverans har precis kommit in" : "A delivery has just arrived", artifact: sv ? "en kvittens eller en notering i loggen" : "a receipt or a log note", constraintB: sv ? "Märkningen är ofullständig och två personer säger olika." : "Labeling is incomplete and two people disagree.", twist: sv ? "Efter 2 minuter kommer ny info som motsäger första beskedet." : "New info contradicts the first message." },
    kitchen: { setting: sv ? "Ni är mitt i produktionen och tempot är högt" : "You’re mid-production and the pace is high", artifact: sv ? "en checklista eller en sign-off" : "a checklist or sign-off", constraintB: sv ? "En kollega säger “vi gör som vanligt” men underlaget saknas." : "A colleague says “as usual” but there’s no evidence.", twist: sv ? "En detalj dyker upp som gör att “som vanligt” inte längre gäller." : "A detail appears that breaks “as usual”." },
    audit: { setting: sv ? "Ni gör en snabb internkontroll" : "You’re doing a quick internal check", artifact: sv ? "ett underlag som kan visas i efterhand" : "evidence you can show later", constraintB: sv ? "Det finns en avvikelse, men ni vet inte ännu om den är liten eller stor." : "There’s a deviation, scope unclear.", twist: sv ? "En ny observation gör att ni måste omvärdera vad som är “viktigast först”." : "A new observation changes priorities." },
    brief: { setting: sv ? "På ett kort avstämningsmöte ska ni få samsyn" : "In a short briefing you need alignment", artifact: sv ? "en enkel beslutspunkt (vem-gör-vad)" : "a simple decision note", constraintB: sv ? "En person saknas men påverkas av beslutet." : "Someone absent will be impacted.", twist: sv ? "Efter mötet framkommer att en viktig detalj aldrig blev sagd." : "A key detail was missing." },
    customer: { setting: sv ? "En kund har hört av sig med ett klagomål" : "A customer contacted you with a complaint", artifact: sv ? "en notering som gör att ni kan följa upp" : "a note enabling follow-up", constraintB: sv ? "Det finns flera möjliga orsaker, och ni riskerar att gissa." : "Multiple causes, risk of guessing.", twist: sv ? "En kollega hittar en tidigare notering som ändrar bedömningen." : "A prior note changes the assessment." },
    generic: { setting: sv ? "Ni behöver skapa ordning i ett läge som riskerar att spåra ur" : "You need to create order in a situation that can drift", artifact: sv ? "en kort notering som ger spårbarhet" : "a short traceability note", constraintB: sv ? "Två personer har olika bild av vad som är “problemet”." : "Two people disagree on the problem.", twist: sv ? "Någon säger något som låter rimligt – men saknar stöd." : "Someone says something plausible—without evidence." },
  };

  const d = defs[packId] || defs.generic;
  return { id: packId, place, setting: d.setting, artifact: d.artifact, constraintB: d.constraintB, twist: d.twist };
}

function makeQuestionBlock({ i, language, pack, dim }) {
  const sv = language === "sv";
  const stemsSv = {
    routine_start: `Ni står ${pack.place}. ${pack.setting}. Vilket är bästa första steget för att skapa kontroll utan att gissa?`,
    scenario_application: `${pack.setting}. Ni behöver fatta ett val ${pack.place}. Vilket alternativ ger mest spårbarhet i stunden?`,
    traceability_and_evidence: `Ni behöver kunna visa underlag i efterhand. Vilken handling ger tydligast spårbarhet ${pack.place}?`,
    risk_consequence: `${pack.constraintB} Vilket val minskar risken för felbeslut mest ${pack.place}?`,
    deviation_and_action: `${pack.twist} Vad är den mest korrekta åtgärden för att hantera en möjlig avvikelse?`,
    roles_and_responsibility: `Två personer vill göra olika. Vilket ansvar/roll-val ger bäst ordning och tydlighet ${pack.place}?`,
    definition_or_concept: `I en situation som denna: vad betyder “spårbarhet” i praktiken ${pack.place}?`,
  };
  const stemsEn = {
    routine_start: `You are ${pack.place}. ${pack.setting}. What is the best first step to regain control without guessing?`,
    scenario_application: `${pack.setting}. You must decide ${pack.place}. Which option gives the strongest traceability right now?`,
    traceability_and_evidence: `You need evidence you can show later. Which action creates the clearest traceability ${pack.place}?`,
    risk_consequence: `${pack.constraintB} Which choice reduces the risk of a wrong decision the most ${pack.place}?`,
    deviation_and_action: `${pack.twist} What is the most correct action to handle a potential deviation?`,
    roles_and_responsibility: `Two people disagree. Which role/ownership choice creates the best order and clarity ${pack.place}?`,
    definition_or_concept: `In this kind of situation: what does “traceability” mean in practice ${pack.place}?`,
  };
  const stem = sv ? (stemsSv[dim] || stemsSv.scenario_application) : (stemsEn[dim] || stemsEn.scenario_application);

  const optionsSv = [
    `Stanna upp och be om ett konkret underlag (t.ex. ${pack.artifact}).`,
    `Gå vidare “som vanligt” för att spara tid.`,
    `Välj det som känns rimligt utan att kontrollera underlag.`,
    `Skjut upp beslutet och gör inget just nu.`,
  ];
  const optionsEn = [
    `Pause and ask for concrete evidence (e.g., ${pack.artifact}).`,
    `Proceed “as usual” to save time.`,
    `Pick what sounds reasonable without checking evidence.`,
    `Delay the decision and do nothing for now.`,
  ];
  const options = sv ? optionsSv : optionsEn;

  const choices = options.map((text, idx) => ({ id: `c${i + 1}_${idx + 1}`, text: safeStr(text) }));
  return {
    kind: "question",
    id: `q_${i + 1}`,
    items: [{ type: "questionInline", question: { text: safeStr(stem), choices, correctChoiceId: choices[0].id, rationale: safeStr(sv ? "Rätt svar prioriterar spårbarhet och minimerar gissning." : "Correct prioritizes evidence and minimizes guessing.") } }],
  };
}
// ===================== EOF =====================
