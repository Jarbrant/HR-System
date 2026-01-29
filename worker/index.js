// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.10 AI + NO-CRASH + CORS-NORMALIZE + SELF-CONTAINED)
// FIL: worker/index.js
//
// PATCH v1.5.10 (CLOUDFLARE-AI-FIRST + FAIL-CLOSED FALLBACK):
// - P0: Om env.AI finns => generera frågor via Cloudflare Workers AI (env.AI.run) i JSON-mode.
// - P0: Validerar AI-svar strikt; vid minsta fel -> fallback till deterministisk no-crash engine.
// - P0: Inga imports till question-ui.js. UI-map är inline.
// - P0: Importerar ENDAST isPlainObject/safeStr/safeArr från ./utils.js.
// - P0: Fail-closed: JSON-only, payload <= 64KB, CORS strikt, loggar aldrig payload.
// - P0: Oförändrat output-contract: training-blocks@v1 + ui-mcq@v1.2 + items-envelope@v1.6
//
// KRAV FÖR ATT AI SKA FUNKA:
// - wrangler.toml måste ha:
//   [ai]
//   binding = "AI"
//
// (Model kan styras via env.AI_MODEL; annars default i koden.)
// ============================================================

// ============================================================
// BLOCK 01 — Imports (min-safe)
// ============================================================

import { isPlainObject, safeStr, safeArr } from "./utils.js";

// ============================================================
// BLOCK 01B — UI question helpers (INLINE HOTFIX)
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

function mapTrainingBlocksToUiQuestions(blocks, questionTypeRaw) {
  // OBS: UI-formatet är samma för auto/single/multi/true_false i denna hotfix:
  // type:"question", question:"..", options:[..], correctIndex (+ ev correctIndices), explanation
  const out = [];
  const arr = Array.isArray(blocks) ? blocks : [];

  for (const b of arr) {
    if (!b || b.kind !== "question") continue;

    const items = Array.isArray(b.items) ? b.items : [];
    const qi = items.find((x) => x && x.type === "questionInline" && x.question);
    const q = qi && qi.question ? qi.question : null;
    if (!q) {
      return { ok: false, errorCode: "UI_MAP_FAILED", message: "Question-block saknar questionInline.question" };
    }

    const stem = safeStr(q.text || q.question || "").trim();
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const options = choices.map((c) => safeStr(c && c.text).trim()).filter(Boolean);

    if (!stem) return { ok: false, errorCode: "UI_MAP_FAILED", message: "En fråga saknar text" };
    if (options.length < 2) {
      return { ok: false, errorCode: "UI_MAP_FAILED", message: "AI-svaret saknade giltiga svarsalternativ" };
    }

    let correctIndex = -1;
    let correctIndices = null;

    const correctChoiceId = safeStr(q.correctChoiceId).trim();
    if (correctChoiceId) {
      const idx = choices.findIndex((c) => safeStr(c && c.id).trim() === correctChoiceId);
      correctIndex = idx;
    }

    const ids = Array.isArray(q.correctChoiceIds) ? q.correctChoiceIds : null;
    if (ids && ids.length) {
      const mapped = ids
        .map((id) => choices.findIndex((c) => safeStr(c && c.id).trim() === safeStr(id).trim()))
        .filter((n) => Number.isInteger(n) && n >= 0);
      if (mapped.length) correctIndices = mapped;
    }

    if (correctIndex < 0 && (!correctIndices || !correctIndices.length)) {
      // defensiv fallback
      correctIndex = 0;
    }

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

  if (!out.length) {
    return { ok: false, errorCode: "UI_NO_QUESTIONS", message: "Inga question-block hittades att mappa till UI-frågor" };
  }

  return { ok: true, items: out };
}

// ============================================================
// BLOCK 02 — Constants
// ============================================================

export const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.5.10-ai1";

// ============================================================
// BLOCK 02B — Local utils (self-contained)  [P0: undvik import-crash]
// ============================================================

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
  // UI kan skicka object — vi fail-closed till text
  if (typeof v === "string") return v.trim();
  if (v === null || v === undefined) return "";
  try {
    if (typeof v === "object") {
      const t = safeStr(v.text || v.contextText || v.prompt || "");
      return t.trim();
    }
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
  // liten, stabil 32-bit hash (FNV-1a)
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

/**
 * parseV1RulesetPayload (tolerant, fail-closed)
 */
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
  // hotfix: fail-soft
  return { ok: true };
}

// ============================================================
// BLOCK 02C — Cloudflare AI helpers (fail-closed)
// ============================================================

function isEnvAiUsable(env) {
  // env.AI måste finnas och ha run()
  try {
    return !!(env && env.AI && typeof env.AI.run === "function");
  } catch (_) {
    return false;
  }
}

function getAiModel(env) {
  // valfritt: sätt env.AI_MODEL i wrangler/Cloudflare dashboard
  const m = safeStr(env && env.AI_MODEL).trim();
  // Default: rimlig instruct-modell (kan bytas utan kod).
  return m || "@cf/meta/llama-3.1-8b-instruct";
}

function validateTrainingBlocksShape(obj, expectedCount) {
  if (!isPlainObject(obj)) return { ok: false, code: "AI_BAD_SHAPE", msg: "AI payload ej objekt" };
  const blocks = Array.isArray(obj.blocks) ? obj.blocks : null;
  if (!blocks) return { ok: false, code: "AI_BAD_SHAPE", msg: "AI payload saknar blocks[]" };
  if (expectedCount && blocks.length !== expectedCount) return { ok: false, code: "AI_BAD_COUNT", msg: "AI payload fel antal blocks" };

  // Minimal block-validering: kind/questionInline/choices/correctChoiceId
  for (const b of blocks) {
    if (!b || b.kind !== "question") return { ok: false, code: "AI_BAD_BLOCK", msg: "Block.kind måste vara 'question'" };
    const items = Array.isArray(b.items) ? b.items : null;
    if (!items || !items.length) return { ok: false, code: "AI_BAD_BLOCK", msg: "Block.items saknas" };
    const qi = items.find((x) => x && x.type === "questionInline" && x.question);
    if (!qi || !qi.question) return { ok: false, code: "AI_BAD_BLOCK", msg: "questionInline.question saknas" };
    const q = qi.question;
    const text = safeStr(q.text).trim();
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const cc = safeStr(q.correctChoiceId).trim();
    if (!text) return { ok: false, code: "AI_BAD_Q", msg: "Frågetext saknas" };
    if (choices.length < 2) return { ok: false, code: "AI_BAD_Q", msg: "choices < 2" };
    if (!cc) return { ok: false, code: "AI_BAD_Q", msg: "correctChoiceId saknas" };
    const okChoice = choices.some((c) => safeStr(c && c.id).trim() === cc);
    if (!okChoice) return { ok: false, code: "AI_BAD_Q", msg: "correctChoiceId matchar ingen choice" };
  }

  return { ok: true };
}

async function generateTrainingBlocksViaCloudflareAI(env, input, pack, arc) {
  // Fail-closed: inga kast utåt – returnerar {ok:false,...} vid problem.
  const model = getAiModel(env);
  const sv = input.language === "sv";

  const seed = hash32(
    [
      "AO-WORKER-TRAINING-BLOCKS-01",
      VERSION,
      input.requestId || "no-req",
      input.subjectId || "generic",
      input.language,
      input.questionType || "",
      safeStr(input.contextText || "").slice(0, 160),
    ].join("|")
  );

  const style = sv
    ? "Skriv naturlig, konkret svenska. Undvik repetitiva fraser. Varje fråga ska kännas unik och genomtänkt."
    : "Write natural, concrete English. Avoid repetitive phrasing. Each question should feel unique and well-crafted.";

  // Vi ber modellen returnera exakt shape vi redan använder (training-blocks@v1)
  const schemaHint = {
    ok: true,
    v: "training-blocks@v1",
    mode: input.mode,
    subjectId: input.subjectId,
    language: input.language,
    blocks: [
      {
        kind: "question",
        id: "q_1",
        items: [
          {
            type: "questionInline",
            question: {
              text: "…",
              choices: [
                { id: "c1_1", text: "…" },
                { id: "c1_2", text: "…" },
                { id: "c1_3", text: "…" },
                { id: "c1_4", text: "…" },
              ],
              correctChoiceId: "c1_1",
              rationale: "…",
            },
          },
        ],
      },
    ],
  };

  const arcLine = arc && arc.length ? arc.join(" → ") : "";
  const context = safeStr(input.contextText || "").trim();

  const userPrompt = sv
    ? [
        `Uppgift: Skapa ${input.count} flervalsfrågor (4 alternativ) för ett utbildningsblock.`,
        `Tema: spårbarhet, bevis/underlag, avvikelsehantering, ansvar, risk.`,
        `Miljö: ${pack.setting}. Platsfras: "${pack.place}".`,
        `Krokar: artifact="${pack.artifact}", constraint="${pack.constraintB}", twist="${pack.twist}".`,
        arcLine ? `Röd tråd (dimensioner i ordning): ${arcLine}` : "",
        context ? `Kontext (kort): ${context}` : "",
        `Krav: returnera ENDAST JSON (json_object). Följ exakt denna shape:`,
        JSON.stringify(schemaHint),
        `Regler:`,
        `- Varje fråga ska vara unik (inte samma startfras).`,
        `- Rätt svar ska vara tydligt bäst och baserat på spårbarhet/underlag.`,
        `- Motivering (rationale) 1–2 meningar, konkret.`,
        `- ids måste vara stabila: q_1..q_${input.count}, c{n}_1..c{n}_4.`,
        `- Använd seed=${seed} som variationsankare (utan att skriva ut seed i texten).`,
        style,
      ]
        .filter(Boolean)
        .join("\n")
    : [
        `Task: Create ${input.count} multiple-choice questions (4 options) for a training block.`,
        `Theme: traceability, evidence, deviation handling, accountability, risk.`,
        `Setting: ${pack.setting}. Place phrase: "${pack.place}".`,
        `Hooks: artifact="${pack.artifact}", constraint="${pack.constraintB}", twist="${pack.twist}".`,
        arcLine ? `Story arc (dimensions): ${arcLine}` : "",
        context ? `Context (short): ${context}` : "",
        `Requirement: return ONLY JSON (json_object) matching exactly this shape:`,
        JSON.stringify(schemaHint),
        `Rules:`,
        `- Each question must be unique (avoid repeating the same opener).`,
        `- Correct answer should clearly prioritize evidence/traceability.`,
        `- Rationale 1–2 sentences, concrete.`,
        `- Stable ids: q_1..q_${input.count}, c{n}_1..c{n}_4.`,
        `- Use seed=${seed} as a variation anchor (do not print seed).`,
        style,
      ]
        .filter(Boolean)
        .join("\n");

  try {
    const messages = [
      {
        role: "user",
        content: userPrompt,
      },
    ];

    const aiResult = await env.AI.run(model, {
      messages,
      // lite kreativitet men inte kaos
      temperature: 0.6,
      max_tokens: 2500,
      // JSON mode: modellen måste returnera JSON object
      response_format: { type: "json_object" },
    });

    // Workers AI returnerar ofta { response: <string|object>, usage: ... }
    const payload = aiResult && isPlainObject(aiResult) && "response" in aiResult ? aiResult.response : aiResult;

    const v = validateTrainingBlocksShape(payload, input.count);
    if (!v.ok) {
      console.error("ERR", input.requestId, v.code);
      return { ok: false, errorCode: v.code, message: v.msg };
    }

    // säkra toppfält (om modellen glömde)
    const fixed = {
      ok: true,
      v: "training-blocks@v1",
      mode: safeStr(payload.mode || input.mode).trim() || input.mode,
      subjectId: safeStr(payload.subjectId || input.subjectId).trim() || input.subjectId,
      language: safeStr(payload.language || input.language).trim() || input.language,
      blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
    };

    return { ok: true, training: fixed };
  } catch (e) {
    console.error("ERR", input.requestId, "AI_RUN_FAILED");
    return { ok: false, errorCode: "AI_RUN_FAILED", message: safeStr(e && (e.message || String(e))).slice(0, 120) };
  }
}

// ============================================================
// BLOCK 03 — Fetch handler (routing + guards)
// ============================================================

export default {
  async fetch(request, env) {
    let requestId = makeRequestId();
    const url = new URL(request.url);

    const allowedOriginRaw = safeStr(env && env.ALLOWED_ORIGIN).trim();
    const requireAuth = safeStr(env && env.REQUIRE_AUTH).trim().toLowerCase() === "true";
    const aiEnabled = safeStr(env && env.AI_ENABLED).trim().toLowerCase() === "true";

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
            ai: {
              enabled: aiEnabled,
              binding: isEnvAiUsable(env),
              model: getAiModel(env),
            },
          },
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
            outputContract: "training-blocks@v1 + ui-mcq@v1.2 + items-envelope@v1.6",
          },
        },
        corsHeaders,
        requestId
      );
    }

    // ---------- Endast POST för AI ----------
    if (request.method !== "POST") {
      return errorJSON(405, requestId, "METHOD_NOT_ALLOWED", "Endast POST tillåtet för AI-endpoints", corsHeaders, true);
    }

    const isAIPath = path === "/v1/ai/generate" || path === "/v1/ai/training" || path === "/v1/ai/document";
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
      const expected = safeStr(env && env.WORKER_TOKEN).trim();
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
    const subjectObj = isPlainObject(body.subjectObj) ? body.subjectObj : isPlainObject(body.subject) ? body.subject : null;
    let course = normalizeCourseSubject(subjectObj);

    // ---- V1 override (tolerant) ----
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
      return errorJSON(400, requestId, "VALIDATION_ERROR", courseCheck.message || "course ogiltig", corsHeaders, true);
    }

    // ============================================================
    // BLOCK 04 — Build output (training-blocks + UI-items envelope)
    // P0: AI först (Cloudflare), annars fallback till no-crash engine.
    // ============================================================

    if (!aiEnabled) {
      return errorJSON(503, requestId, "AI_DISABLED", "AI_ENABLED=false (Workern är avstängd)", corsHeaders, true);
    }

    const contextForEngine = safeStr(contextText).trim();
    const place = inferWorkplaceFromContext(contextForEngine, language);

    const seedBase = hash32(
      ["AO-WORKER-TRAINING-BLOCKS-01", VERSION, requestId || "no-req", subjectId || "generic", language, questionType, contextForEngine.slice(0, 160)].join(
        "|"
      )
    );

    const arc = buildStoryArc(count);
    const pack = pickScenarioPack(contextForEngine, place, language, seedBase);

    let training;

    // --- AI path (Cloudflare) ---
    if (isEnvAiUsable(env)) {
      const aiRes = await generateTrainingBlocksViaCloudflareAI(
        env,
        {
          requestId,
          mode,
          count,
          language,
          contextText: contextForEngine,
          subjectId: subjectId || "generic",
          questionType,
          format,
          difficultyHint,
          course,
        },
        pack,
        arc
      );

      if (aiRes && aiRes.ok && aiRes.training) {
        training = aiRes.training;
      } else {
        // Fail-closed: inga payload-loggar, bara kod.
        console.error("ERR", requestId, safeStr((aiRes && aiRes.errorCode) || "AI_FALLBACK"));
        training = buildTrainingBlocksLocal({
          requestId,
          mode,
          count,
          language,
          contextText: contextForEngine,
          subjectId: subjectId || "generic",
          questionType,
          pack,
          arc,
          seedBase,
        });
      }
    } else {
      // --- deterministic fallback (no-crash) ---
      training = buildTrainingBlocksLocal({
        requestId,
        mode,
        count,
        language,
        contextText: contextForEngine,
        subjectId: subjectId || "generic",
        questionType,
        pack,
        arc,
        seedBase,
      });
    }

    if (!training || typeof training !== "object") {
      return errorJSON(502, requestId, "WORKER_BUILD_FAILED", "training är ogiltig (null/ej objekt)", corsHeaders, true);
    }

    const topBlocks = Array.isArray(training.blocks) ? training.blocks : [];
    let items = topBlocks;

    if (isUiQuestionRequest(questionType)) {
      const mapped = mapTrainingBlocksToUiQuestions(topBlocks, questionType);
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
        items, // UI använder detta
        data: { training }, // legacy/diagnostik
        training, // legacy
        blocks: topBlocks, // legacy
        mode: training.mode || mode,
      },
      corsHeaders,
      requestId
    );
  },
};

// ============================================================
// BLOCK 05 — HTTP helpers (CORS + JSON)
// ============================================================

function buildCorsHeaders(origin, allowedOrigin) {
  const allowOrigin = allowedOrigin && origin && origin === allowedOrigin ? allowedOrigin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Hr-Sdk, X-Hr-Client, X-HR-SDK, X-HR-Client, X-HR-CLIENT",
    Vary: "Origin",
  };
}

function okJSON(status, payload, corsHeaders, requestId) {
  return new Response(JSON.stringify(payload), {
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
// BLOCK 10 — NO-CRASH ENGINE (LOCAL FALLBACK) – buildTrainingBlocksLocal
// Syfte: Deterministisk backup om AI fallerar / saknas.
// ============================================================

function buildTrainingBlocksLocal(input) {
  // Denna funktion ska INTE kasta.
  const requestId = safeStr(input && input.requestId).trim();
  const mode = safeStr(input && input.mode).trim() || "training";
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextText = safeStr(input && input.contextText).trim();
  const subjectId = safeStr(input && input.subjectId).trim() || "generic";
  const questionType = safeStr(input && input.questionType).trim() || "";

  const pack = input.pack || pickScenarioPack(contextText, inferWorkplaceFromContext(contextText, language), language, input.seedBase || 1);
  const arc = input.arc || buildStoryArc(count);

  const blocks = [];
  for (let i = 0; i < count; i++) {
    blocks.push(
      makeQuestionBlock({
        i,
        language,
        pack,
        dim: arc[i] || "scenario_application",
      })
    );
  }

  return {
    ok: true,
    v: "training-blocks@v1",
    mode,
    subjectId,
    language,
    blocks,
  };
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
  const base = [
    "scenario_application",
    "routine_start",
    "traceability_and_evidence",
    "risk_consequence",
    "deviation_and_action",
    "roles_and_responsibility",
    "traceability_and_evidence",
    "scenario_application",
  ];
  const tail = ["risk_consequence", "deviation_and_action", "roles_and_responsibility", "routine_start"];
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
  const sv = language === "sv";

  const defs = {
    receiving: {
      setting: sv ? "En leverans har precis kommit in" : "A delivery has just arrived",
      artifact: sv ? "en kvittens eller en notering i loggen" : "a receipt or a log note",
      constraintB: sv ? "Märkningen är ofullständig och två personer säger olika." : "The labeling is incomplete and two people give different answers.",
      twist: sv ? "Efter 2 minuter kommer ny info som motsäger första beskedet." : "After 2 minutes, new info contradicts the first message.",
    },
    kitchen: {
      setting: sv ? "Ni är mitt i produktionen och tempot är högt" : "You’re mid-production and the pace is high",
      artifact: sv ? "en checklista eller en sign-off" : "a checklist or sign-off",
      constraintB: sv ? "En kollega säger “vi gör som vanligt” men underlaget saknas." : "A colleague says “we do it as usual” but there’s no evidence.",
      twist: sv ? "En detalj dyker upp som gör att “som vanligt” inte längre gäller." : "A detail appears that makes “as usual” no longer valid.",
    },
    audit: {
      setting: sv ? "Ni gör en snabb internkontroll" : "You’re doing a quick internal check",
      artifact: sv ? "ett underlag som kan visas i efterhand" : "evidence you can show later",
      constraintB: sv ? "Det finns en avvikelse, men ni vet inte ännu om den är liten eller stor." : "There’s a deviation, but you don’t yet know its scope.",
      twist: sv ? "En ny observation gör att ni måste omvärdera vad som är “viktigast först”." : "A new observation forces you to reconsider what matters first.",
    },
    brief: {
      setting: sv ? "På ett kort avstämningsmöte ska ni få samsyn" : "In a short briefing you need alignment",
      artifact: sv ? "en enkel beslutspunkt (vem-gör-vad)" : "a simple decision note (who-does-what)",
      constraintB: sv ? "En person saknas men påverkas av beslutet." : "One person is absent but will be impacted by the decision.",
      twist: sv ? "Efter mötet framkommer att en viktig detalj aldrig blev sagd." : "After the meeting, a key detail turns out to have been missing.",
    },
    customer: {
      setting: sv ? "En kund har hört av sig med ett klagomål" : "A customer has contacted you with a complaint",
      artifact: sv ? "en notering som gör att ni kan följa upp" : "a note that enables follow-up",
      constraintB: sv ? "Det finns flera möjliga orsaker, och ni riskerar att gissa." : "There are multiple causes and you risk guessing.",
      twist: sv ? "En kollega hittar en tidigare notering som ändrar bedömningen." : "A colleague finds a previous note that changes the assessment.",
    },
    generic: {
      setting: sv ? "Ni behöver skapa ordning i ett läge som riskerar att spåra ur" : "You need to create order in a situation that can drift",
      artifact: sv ? "en kort notering som ger spårbarhet" : "a short note that gives traceability",
      constraintB: sv ? "Två personer har olika bild av vad som är “problemet”." : "Two people disagree on what the “problem” is.",
      twist: sv ? "Någon säger något som låter rimligt – men saknar stöd." : "Someone says something that sounds right—without evidence.",
    },
  };

  const d = defs[packId] || defs.generic;
  return {
    id: packId,
    place,
    setting: d.setting,
    artifact: d.artifact,
    constraintB: d.constraintB,
    twist: d.twist,
  };
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

  const stem = sv ? stemsSv[dim] || stemsSv.scenario_application : stemsEn[dim] || stemsEn.scenario_application;

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
  const correctIndex = 0;

  const explanation = sv
    ? `Rätt svar prioriterar spårbarhet och minimerar gissning. Det gör att ni kan förklara beslutet i efterhand och upptäcka avvikelse tidigt.`
    : `The correct option prioritizes evidence and minimizes guessing. That enables traceability and early detection of deviations.`;

  const choices = options.map((text, idx) => ({
    id: `c${i + 1}_${idx + 1}`,
    text: safeStr(text),
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
          rationale: safeStr(explanation),
        },
      },
    ],
  };
}

// ===================== EOF =====================
