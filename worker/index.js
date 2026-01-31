// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.6.5 DOC+MIX FIX + V1-CONTRACT)
// FIL: worker/index.js
//
// PATCH v1.6.5 (DOC/MIX FIX):
// - P0: Document/Mix får inte längre “råka bli provfrågor” → UI slutar stoppa import.
// - P0: mode="document" ger alltid text-block (aldrig question-block).
// - P0: mode="mix" ger också text-block (aldrig question-block) för stabilitet nu.
// - Provfrågor+facit (questionType) fungerar som innan.
//
// Tidigare patchar bibehålls (v1.6.4 + v1.6.3):
// - P0: "Förklaring" blir mini-lektion (4–6 meningar) med struktur.
// - P0: Context unwrap/parsa context.text även när det är "dubbelt JSON".
// - P0: Extrahera subject/course/level + focus → injiceras i prompt som hårda rubriker.
// - P0: Striktare prompt + unika frågor + seed-shuffle av options + robust JSON extraction.
// - P0: Debug headers: X-HR-AI + X-HR-AI-REASON.
//
// Output-contract: training-blocks@v1 + ui-mcq@v1.2 + items-envelope@v1.6
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

  if (!out.length) {
    return { ok: false, errorCode: "UI_NO_QUESTIONS", message: "Inga question-block hittades att mappa till UI-frågor" };
  }

  return { ok: true, items: out };
}

// ============================================================
// BLOCK 02 — Constants
// ============================================================

export const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.6.5";

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
  if (s === "mix" || s === "mixed") return "mix"; // P0: tidigare blev mix -> training -> frågor -> stopp i UI
  return "training";
}

function normalizeContextText(v) {
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
  const s = safeStr(str);
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalizeOrigin(s) {
  return safeStr(s).trim().replace(/\/+$/g, "");
}

// ---------- Robust JSON extraction (first {...} object) ----------
function extractFirstJsonObjectString(text) {
  const s = safeStr(text);
  const start = s.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }

    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) return s.slice(start, i + 1);
  }
  return "";
}

function safeJsonParseLoose(text) {
  const t = safeStr(text).trim();
  if (!t) return null;

  // direct
  try {
    return JSON.parse(t);
  } catch (_) {}

  // trim code fences
  const cleaned = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // first {..}
  const objStr = extractFirstJsonObjectString(cleaned);
  if (!objStr) return null;
  try {
    return JSON.parse(objStr);
  } catch (_) {
    return null;
  }
}

function safeJsonFromUnknown(x) {
  if (isPlainObject(x)) return x;
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
  for (const p of basePads) {
    if (out.length >= target) break;
    out.push(p);
  }

  let k = 1;
  while (out.length < target && k < 20) {
    out.push(sv ? `Alternativ ${out.length + 1}.` : `Option ${out.length + 1}.`);
    k++;
  }
  return out.slice(0, target);
}

function normalizeToAiQt(questionTypeRaw) {
  // P0: auto ger ofta “annat format” => tvinga mcq_single i AI-ledet
  const qt = normalizeQuestionType(questionTypeRaw);
  if (qt === "auto" || !qt) return "mcq_single";
  return qt;
}

// ============================================================
// BLOCK 02C — Context unwrap (P0)
// ============================================================

function parseContextBundle(contextTextRaw) {
  const raw = safeStr(contextTextRaw).trim();
  if (!raw) return null;

  let v = safeJsonParseLoose(raw);
  if (typeof v === "string") {
    const v2 = safeJsonParseLoose(v);
    if (isPlainObject(v2)) v = v2;
  }
  if (!isPlainObject(v)) return null;

  const subject = isPlainObject(v.subject) ? v.subject : null;
  const course = isPlainObject(v.course) ? v.course : null;

  const module = safeStr(subject && subject.module).trim();
  const area = safeStr(subject && subject.area).trim();
  const subjectId = safeStr(subject && (subject.subjectId || subject.id)).trim();

  const chapter = safeStr(course && course.chapter).trim();
  const step = safeStr(course && course.step).trim();
  const title = safeStr(course && course.title).trim();
  const chapterFocus = safeStr(course && course.chapterFocus).trim();
  const stepFocus = safeStr(course && course.stepFocus).trim();

  const level = safeStr(v.level || "").trim();
  const goals = safeStr(v.goals || "").trim();

  return {
    module,
    area,
    subjectId,
    chapter,
    step,
    title,
    chapterFocus,
    stepFocus,
    level,
    goals,
    raw: raw.slice(0, 2000),
  };
}

function fmtContextForPrompt(bundle, language) {
  const sv = language === "sv";
  if (!bundle) return sv ? "KURSINFO: (saknas)" : "COURSE INFO: (missing)";

  const lines = [];
  lines.push(sv ? "KURSINFO (hårda fakta):" : "COURSE INFO (hard facts):");
  if (bundle.module) lines.push(`${sv ? "Modul" : "Module"}: ${bundle.module}`);
  if (bundle.area) lines.push(`${sv ? "Område" : "Area"}: ${bundle.area}`);
  if (bundle.subjectId) lines.push(`subjectId: ${bundle.subjectId}`);
  if (bundle.chapter) lines.push(`${sv ? "Kapitel" : "Chapter"}: ${bundle.chapter}`);
  if (bundle.step) lines.push(`${sv ? "Steg" : "Step"}: ${bundle.step}`);
  if (bundle.level) lines.push(`${sv ? "Nivå" : "Level"}: ${bundle.level}`);
  if (bundle.title) lines.push(`${sv ? "Titel" : "Title"}: ${bundle.title}`);
  if (bundle.chapterFocus) lines.push(`${sv ? "Kapitel-fokus" : "Chapter focus"}: ${bundle.chapterFocus}`);
  if (bundle.stepFocus) lines.push(`${sv ? "Steg-fokus" : "Step focus"}: ${bundle.stepFocus}`);
  if (bundle.goals) lines.push(`${sv ? "Mål (för människa)" : "Goals (for humans)"}: ${bundle.goals}`);

  return lines.join("\n");
}

// ============================================================
// BLOCK 02E — Explanation (mini-lesson)  [P0]
// ============================================================

function looksLikeMiniLesson(expl, language) {
  const s = safeStr(expl).trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  const hasTagsSv = lower.includes("princip") || lower.includes("varför rätt") || lower.includes("ta med dig");
  const hasTagsEn = lower.includes("principle") || lower.includes("why correct") || lower.includes("takeaway");
  const hasTags = language === "sv" ? hasTagsSv : hasTagsEn;

  if (hasTags) return true;
  return s.length >= 240;
}

function buildMiniLessonExplanation({ language, bundle, pack, dim, correctText, wrongText }) {
  const sv = language === "sv";
  const mod = safeStr(bundle && bundle.module).trim();
  const area = safeStr(bundle && bundle.area).trim();
  const chapter = safeStr(bundle && bundle.chapter).trim();
  const step = safeStr(bundle && bundle.step).trim();
  const level = safeStr(bundle && bundle.level).trim();

  const ctxBits = [];
  if (mod) ctxBits.push(mod);
  if (area) ctxBits.push(area);
  if (chapter) ctxBits.push(chapter);
  if (step) ctxBits.push(`${sv ? "Steg" : "Step"} ${step}`);
  if (level) ctxBits.push(`${sv ? "Nivå" : "Level"} ${level}`);
  const ctx = ctxBits.length ? ctxBits.join(" • ") : sv ? "Utbildning" : "Training";

  const isIso = safeStr(area).toLowerCase().includes("iso 9001") || safeStr(pack && pack.setting).toLowerCase().includes("iso 9001");

  if (sv) {
    const p1 = `Princip: Spårbarhet betyder att ni kan visa vilka fakta som fanns och varför beslutet togs (${ctx}).`;
    const p2 = `Varför rätt: Genom att ${safeStr(correctText).trim()} skapar ni underlag som håller vid granskning${isIso ? " (ISO 9001)" : ""} och gör beslutet möjligt att följa i efterhand.`;
    const p3 = `Varför fel: Om ni ${safeStr(wrongText).trim()} riskerar ni att agera på antaganden som inte går att bevisa eller återupprepa.`;
    const p4 = `Ta med dig: Saknas underlag – stoppa, säkra evidens, dokumentera beslutet och fortsätt först när spåret är tydligt.`;
    return `${p1} ${p2} ${p3} ${p4}`.trim();
  }

  const p1 = `Principle: Traceability means you can show what facts you had and why the decision was made (${ctx}).`;
  const p2 = `Why correct: By ${safeStr(correctText).trim()} you create evidence that stands up to review${isIso ? " (ISO 9001)" : ""} and makes the decision traceable afterwards.`;
  const p3 = `Why a wrong option is wrong: If you ${safeStr(wrongText).trim()} you risk acting on assumptions that cannot be verified or repeated.`;
  const p4 = `Takeaway: If evidence is missing—pause, secure proof, document the decision, and proceed only when the chain is clear.`;
  return `${p1} ${p2} ${p3} ${p4}`.trim();
}

function ensureMiniLessonExplanation({ language, bundle, pack, dim, options, correctIndex, baseExplanation }) {
  const expl = safeStr(baseExplanation).trim();
  if (looksLikeMiniLesson(expl, language)) return expl;

  const opts = Array.isArray(options) ? options : [];
  const ci = Math.max(0, Math.min(opts.length - 1, Number(correctIndex) || 0));

  const correctText = opts[ci] ? `“${opts[ci]}”` : language === "sv" ? "välja rätt alternativ" : "choosing the correct option";

  let wrongIdx = -1;
  for (let i = 0; i < opts.length; i++) {
    if (i !== ci && safeStr(opts[i]).trim()) {
      wrongIdx = i;
      break;
    }
  }
  const wrongText = wrongIdx >= 0 ? `“${opts[wrongIdx]}”` : language === "sv" ? "gå vidare utan underlag" : "proceed without evidence";

  return buildMiniLessonExplanation({ language, bundle, pack, dim, correctText, wrongText });
}

// ============================================================
// BLOCK 02D — Seeded shuffle for MCQ options (P0)
// ============================================================

function seededRand(seed) {
  let x = (seed >>> 0) || 1;
  return function () {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function shuffleWithCorrectIndex(options, correctIndex, seed) {
  const arr = Array.isArray(options) ? options.slice() : [];
  const n = arr.length;
  if (n < 2) return { options: arr, correctIndex: Math.max(0, Number(correctIndex) || 0) };

  const ci = Math.max(0, Math.min(n - 1, Number(correctIndex) || 0));
  const rand = seededRand(seed);

  let currentCorrect = ci;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    if (i === j) continue;

    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;

    if (currentCorrect === i) currentCorrect = j;
    else if (currentCorrect === j) currentCorrect = i;
  }

  return { options: arr, correctIndex: currentCorrect };
}

// ============================================================
// DOC BLOCK HELPERS (P0) — så document/mix inte blir frågor
// ============================================================

function makeTextBlock({ i, title, text }) {
  const t = safeStr(text).trim();
  const h = safeStr(title).trim();
  const payload = h ? `${h}\n\n${t}`.trim() : t;

  return {
    kind: "text",
    id: `t_${i + 1}`,
    items: [
      {
        type: "textInline",
        text: payload,
      },
    ],
  };
}

function parseDocAiPayload(parsed) {
  // Tolerant: accept { blocks:[...]} eller { sections:[...]} eller { text:"..." }
  if (!parsed || !isPlainObject(parsed)) return [];
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : Array.isArray(parsed.sections) ? parsed.sections : [];
  if (blocks.length) {
    const out = [];
    for (const b of blocks) {
      if (!b) continue;
      if (typeof b === "string") {
        out.push({ title: "", text: b });
        continue;
      }
      if (isPlainObject(b)) {
        const title = safeStr(b.title || b.heading || "").trim();
        const text = safeStr(b.text || b.body || b.content || "").trim();
        const line = safeStr(b.line || "").trim();
        const merged = text || line;
        if (!merged) continue;
        out.push({ title, text: merged });
      }
    }
    return out;
  }

  const text = safeStr(parsed.text || parsed.body || parsed.content || "").trim();
  if (text) return [{ title: "", text }];
  return [];
}

function ensureNoQuestionBlocks(blocks) {
  const arr = Array.isArray(blocks) ? blocks : [];
  for (const b of arr) {
    if (!b) continue;
    if (b.kind === "question") return false;
  }
  return true;
}

// ============================================================
// parseV1RulesetPayload (tolerant, fail-closed)
// ============================================================

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
// BLOCK 03 — Fetch handler (routing + guards)
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

    if (request.method === "OPTIONS") {
      if (!origin || origin !== allowedOrigin) {
        return errorJSON(403, requestId, "CORS_FORBIDDEN", "Origin är inte tillåten", corsHeaders, true);
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const path = url.pathname || "/";

    if (request.method === "GET" && path === "/v1/health") {
      if (origin && origin !== allowedOrigin) {
        return errorJSON(403, requestId, "CORS_FORBIDDEN", "Origin är inte tillåten", corsHeaders, true);
      }
      const hasAIBinding = !!(env && env.AI && typeof env.AI.run === "function");
      const model = safeStr(env && env.AI_MODEL).trim() || "@cf/meta/llama-3.1-8b-instruct";
      return okJSON(
        200,
        {
          ok: true,
          requestId,
          data: {
            service: "hr-worker",
            version: VERSION,
            v: "v1",
            rulesets: { ok: true, base: "ai-rules" },
            ai: { enabled: aiEnabled, binding: hasAIBinding, model },
          },
        },
        corsHeaders,
        requestId
      );
    }

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
            outputContract: "training-blocks@v1 + ui-mcq@v1.2 + items-envelope@v1.6",
          },
        },
        corsHeaders,
        requestId
      );
    }

    if (request.method !== "POST") {
      return errorJSON(405, requestId, "METHOD_NOT_ALLOWED", "Endast POST tillåtet för AI-endpoints", corsHeaders, true);
    }

    const isAIPath = path === "/v1/ai/generate" || path === "/v1/ai/training" || path === "/v1/ai/document";
    if (!isAIPath) {
      return errorJSON(404, requestId, "NOT_FOUND", "Endpoint finns inte", corsHeaders, true);
    }

    if (!origin || origin !== allowedOrigin) {
      return errorJSON(403, requestId, "CORS_FORBIDDEN", "Origin är inte tillåten", corsHeaders, true);
    }

    if (requireAuth) {
      const token = extractBearerToken(request.headers.get("Authorization") || "");
      const expected = safeStr(env && env.WORKER_TOKEN).trim();
      if (!token || !expected || token !== expected) {
        return errorJSON(401, requestId, "UNAUTHORIZED", "Ogiltig eller saknad token", corsHeaders, true);
      }
    }

    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return errorJSON(400, requestId, "BAD_JSON", "Endast application/json tillåtet", corsHeaders, true);
    }

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

    if (!(mode === "training" || mode === "document" || mode === "mix")) {
      return errorJSON(400, requestId, "VALIDATION_ERROR", "mode måste vara training, document eller mix", corsHeaders, true);
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

    if (!aiEnabled) {
      return errorJSON(503, requestId, "AI_DISABLED", "AI_ENABLED=false (Workern är avstängd)", corsHeaders, true);
    }

    // ============================================================
    // BLOCK 04 — Build output (training-blocks + UI-items envelope)
    // ============================================================

    let training;
    let aiSource = "fallback";
    let aiReason = "OK";

    try {
      const res = await buildTrainingBlocks(
        {
          requestId,
          mode,
          count,
          language,
          context: contextText,
          format,
          subjectId,
          difficultyHint,
          course,
          questionType,
        },
        env
      );

      training = res && res.training ? res.training : res;
      aiSource = safeStr(res && res.source).trim() || "fallback";
      aiReason = safeStr(res && res.reason).trim() || "OK";
    } catch (e) {
      const msg = safeStr(e && (e.message || e.stack || String(e))).slice(0, 200);
      console.error("ERR", requestId, "WORKER_BUILD_FAILED");
      return errorJSON(502, requestId, "WORKER_BUILD_FAILED", msg || "Worker kunde inte bygga ett giltigt svar", corsHeaders, true);
    }

    if (!training || typeof training !== "object") {
      return errorJSON(502, requestId, "WORKER_BUILD_FAILED", "training är ogiltig (null/ej objekt)", corsHeaders, true);
    }

    const topBlocks = Array.isArray(training.blocks) ? training.blocks : [];
    let items = topBlocks;

    // Provfrågor+facit (questionType) → mappa som innan
    if (isUiQuestionRequest(questionType)) {
      const mapped = mapTrainingBlocksToUiQuestions(topBlocks, questionType);
      if (!mapped.ok) {
        return errorJSON(422, requestId, mapped.errorCode, mapped.message, corsHeaders, true);
      }
      items = mapped.items;
    }

    const hdr = {
      ...(corsHeaders || {}),
      "X-HR-AI": aiSource === "cf" ? "cf" : "fallback",
      "X-HR-AI-REASON": safeStr(aiReason || "OK"),
    };

    return okJSON(
      200,
      {
        ok: true,
        requestId,
        items,
        data: { training },
        training,
        blocks: topBlocks,
        mode: training.mode || mode,
      },
      hdr,
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
  let body = "{}";
  try {
    body = JSON.stringify(payload);
  } catch (_) {
    body = JSON.stringify({ ok: false, requestId: safeStr(requestId || ""), errorCode: "JSON_STRINGIFY_FAILED" });
  }

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
// BLOCK 10 — TRAINING ENGINE (CF-AI first, fallback deterministic)
// ============================================================

async function buildTrainingBlocks(input, env) {
  // Returnerar {training, source:"cf"|"fallback", reason:"..."}
  const hasBinding = !!(env && env.AI && typeof env.AI.run === "function");
  const mode = safeStr(input && input.mode).trim() || "training";

  if (!hasBinding) {
    // P0: document/mix får inte bli frågor i fallback heller
    if (mode === "document" || mode === "mix") {
      return { training: buildDocumentBlocksDeterministic(input), source: "fallback", reason: "NO_BINDING" };
    }
    return { training: buildTrainingBlocksDeterministic(input), source: "fallback", reason: "NO_BINDING" };
  }

  try {
    if (mode === "document" || mode === "mix") {
      const aiDoc = await buildDocumentBlocksWithAI(input, env);
      if (aiDoc && aiDoc.ok && Array.isArray(aiDoc.blocks) && aiDoc.blocks.length && ensureNoQuestionBlocks(aiDoc.blocks)) {
        return { training: aiDoc, source: "cf", reason: "OK" };
      }
      // fail-closed mot frågor i doc/mix → fallback text-block
      return { training: buildDocumentBlocksDeterministic(input), source: "fallback", reason: "DOC_SCHEMA_FAIL" };
    }

    const ai = await buildTrainingBlocksWithAI(input, env);
    if (ai && ai.ok && Array.isArray(ai.blocks) && ai.blocks.length) {
      return { training: ai, source: "cf", reason: "OK" };
    }
    return { training: buildTrainingBlocksDeterministic(input), source: "fallback", reason: "SCHEMA_FAIL" };
  } catch (_) {
    if (mode === "document" || mode === "mix") {
      return { training: buildDocumentBlocksDeterministic(input), source: "fallback", reason: "DOC_RUN_FAIL" };
    }
    return { training: buildTrainingBlocksDeterministic(input), source: "fallback", reason: "RUN_FAIL" };
  }
}

// ============================================================
// BLOCK 10A — DOCUMENT/MIX ENGINE (CF-AI + fallback text blocks)
// ============================================================

async function buildDocumentBlocksWithAI(input, env) {
  const requestId = safeStr(input && input.requestId).trim();
  const mode = safeStr(input && input.mode).trim() || "document"; // document|mix
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextTextRaw = safeStr(input && (input.context || input.contextText)).trim();
  const subjectId = safeStr(input && input.subjectId).trim() || "generic";

  const bundle = parseContextBundle(contextTextRaw);
  const courseInfo = fmtContextForPrompt(bundle, language);

  const sv = language === "sv";

  // P0: Vi ber om dokumentblock (inte frågor) och låser schema
  const schemaHint = sv
    ? `Returnera ENDAST giltig JSON. Inget markdown. Inga extra rader. JSON måste börja med "{" och sluta med "}".
Schema:
{
  "blocks": [
    { "title": "string", "text": "string" }
  ]
}
Regler (mycket viktiga):
- Exakt ${count} blocks.
- Varje block ska vara ren text (dokument-innehåll), inte frågor.
- Inga svarsalternativ, ingen correctIndex, inga "quiz"-fält.
- Håll språket tydligt och sakligt, koppla till KURSINFO.`
    : `Return ONLY valid JSON. No markdown, no extra lines. JSON must start with "{" and end with "}".
Schema:
{
  "blocks": [
    { "title": "string", "text": "string" }
  ]
}
Rules (very important):
- Exactly ${count} blocks.
- Each block is plain document text, not questions.
- No options, no correctIndex, no quiz fields.
- Keep it clear and factual, tied to COURSE INFO.`;

  const systemPrompt = sv
    ? `Du skapar dokumentblock för en utbildning (HR). Du får INTE skapa provfrågor här. Följ JSON-schemat exakt.`
    : `You create document blocks for a training. You MUST NOT create quiz questions here. Follow the JSON schema exactly.`;

  const userPrompt =
    `${courseInfo}\n\n` +
    (sv ? `LÄGE: ${mode.toUpperCase()} (dokument-innehåll)\n\n` : `MODE: ${mode.toUpperCase()} (document content)\n\n`) +
    (sv ? `KONTEKST (råtext):\n${contextTextRaw || "(ingen)"}\n\n` : `CONTEXT (raw):\n${contextTextRaw || "(none)"}\n\n`) +
    `subjectId: ${subjectId}\n\n` +
    schemaHint;

  const model = safeStr(env && env.AI_MODEL).trim() || "@cf/meta/llama-3.1-8b-instruct";

  let answer;
  try {
    answer = await env.AI.run(model, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
  } catch (_) {
    answer = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
  }

  const raw = isPlainObject(answer) ? answer.response || answer.result || answer.output || answer.text || answer : answer;
  const parsed = safeJsonFromUnknown(raw);
  if (!parsed || !isPlainObject(parsed)) return null;

  const rows = parseDocAiPayload(parsed);
  if (!rows.length) return null;

  const blocks = [];
  for (let i = 0; i < rows.length && blocks.length < count; i++) {
    const r = rows[i];
    const text = safeStr(r && r.text).trim();
    if (!text) continue;
    blocks.push(makeTextBlock({ i: blocks.length, title: safeStr(r && r.title).trim(), text }));
  }

  if (!blocks.length) return null;

  // P0: hård garanti: inga question-block i document/mix
  if (!ensureNoQuestionBlocks(blocks)) return null;

  // toppa upp om AI gav färre
  while (blocks.length < count) {
    blocks.push(
      makeTextBlock({
        i: blocks.length,
        title: sv ? `Block ${blocks.length + 1}` : `Block ${blocks.length + 1}`,
        text: sv ? "Komplettera med kort, tydlig dokumenttext kopplad till kursinfo." : "Add short, clear document text tied to the course info.",
      })
    );
  }

  return {
    ok: true,
    v: "training-blocks@v1",
    mode,
    subjectId: (bundle && bundle.subjectId) || subjectId,
    language,
    blocks: blocks.slice(0, count),
  };
}

function buildDocumentBlocksDeterministic(input) {
  const requestId = safeStr(input && input.requestId).trim();
  const mode = safeStr(input && input.mode).trim() || "document";
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextText = safeStr(input && (input.context || input.contextText)).trim();
  const subjectId = safeStr(input && input.subjectId).trim() || "generic";

  const bundle = parseContextBundle(contextText);
  const sv = language === "sv";

  const bits = [];
  if (bundle && bundle.module) bits.push(bundle.module);
  if (bundle && bundle.area) bits.push(bundle.area);
  if (bundle && bundle.chapter) bits.push(bundle.chapter);
  const ctx = bits.length ? bits.join(" • ") : sv ? "Utbildning" : "Training";

  const blocks = [];
  for (let i = 0; i < count; i++) {
    const title = sv ? `Dokumentblock ${i + 1}` : `Document block ${i + 1}`;
    const text = sv
      ? `Det här är ett dokumentblock för ${ctx}. Skriv kort, tydligt och spårbart. Utgå från kursinfo och undvik provfrågor.`
      : `This is a document block for ${ctx}. Keep it clear and traceable. Use course info and avoid quiz questions.`;
    blocks.push(makeTextBlock({ i, title, text }));
  }

  return { ok: true, v: "training-blocks@v1", mode, subjectId, language, blocks };
}

// ============================================================
// BLOCK 10B — QUESTION ENGINE (oförändrad logik)
// ============================================================

async function buildTrainingBlocksWithAI(input, env) {
  const requestId = safeStr(input && input.requestId).trim();
  const mode = safeStr(input && input.mode).trim() || "training";
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextTextRaw = safeStr(input && (input.context || input.contextText)).trim();
  const subjectId = safeStr(input && input.subjectId).trim() || "generic";

  const qt = normalizeToAiQt(input && input.questionType);

  const bundle = parseContextBundle(contextTextRaw);
  const courseInfo = fmtContextForPrompt(bundle, language);

  const place = inferWorkplaceFromContext(contextTextRaw, language);
  const arc = buildStoryArc(count);
  const pack = pickScenarioPack(
    contextTextRaw,
    place,
    language,
    hash32(`${requestId}|${subjectId}|${language}|${(bundle && (bundle.module + "|" + bundle.area + "|" + bundle.chapter)) || ""}|${contextTextRaw.slice(0, 120)}`)
  );

  const sv = language === "sv";

  const schemaHint = sv
    ? `Returnera ENDAST giltig JSON. Inget markdown. Inga extra rader. JSON måste börja med "{" och sluta med "}".
Schema:
{
  "questions": [
    { "stem": "string", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "string" }
  ]
}
Regler (mycket viktiga):
- Exakt ${count} frågor (inte fler/inte färre).
- Varje "stem" är 2–3 meningar (scenario + beslut), inte en kort rad.
- Ställ en tydlig fråga i sista meningen. Undvik ja/nej-frågor.
- options: 4 st (true_false: 2 st). Alla alternativ ska vara plausibla och tydligt olika.
- correctIndex inom range och får inte alltid vara 0.
- explanation: 4–6 meningar som en mini-lektion i exakt struktur:
  1) "Princip:" (vad man lär sig),
  2) "Varför rätt:" (koppla till scenario/kursinfo),
  3) "Varför fel:" (nämn minst ett felalternativ och varför),
  4) "Ta med dig:" (konkret tumregel).
- Varje fråga måste kännas kopplad till modul/område/kapitel/steget (använd orden i kursinfo).
- Inga platshållare ("som ovan", "...", "osv"). Inga meta-texter.`
    : `Return ONLY valid JSON. No markdown, no extra lines. JSON must start with "{" and end with "}".
Schema:
{
  "questions": [
    { "stem": "string", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "string" }
  ]
}
Rules (very important):
- Exactly ${count} questions.
- Each stem is 2–3 sentences (scenario + decision), not a short line.
- The last sentence is a clear question.
- options: 4 (true_false: 2). All options must be plausible and clearly distinct.
- correctIndex in range and not always 0.
- explanation: 4–6 sentences as a mini-lesson with this structure:
  1) "Principle:" (what you learn),
  2) "Why correct:" (tie to scenario/course info),
  3) "Why wrong:" (mention at least one wrong option and why),
  4) "Takeaway:" (a concrete rule of thumb).
- Must tie to course info (use module/area/chapter/step focus terms).
- No placeholders. No meta text.`;

  const systemPrompt = sv
    ? `Du skapar provfrågor för utbildning (HR/QA) och måste följa JSON-schemat exakt.`
    : `You create assessment questions for training (HR/QA) and must follow the JSON schema exactly.`;

  const userPrompt =
    `${courseInfo}\n\n` +
    (sv ? `SCENARIOPACK:\n` : `SCENARIO PACK:\n`) +
    `- place: ${pack.place}\n- setting: ${pack.setting}\n- artifact: ${pack.artifact}\n- constraintB: ${pack.constraintB}\n- twist: ${pack.twist}\n\n` +
    (sv ? `ARC (i ordning):\n${arc.join(", ")}\n\n` : `ARC (in order):\n${arc.join(", ")}\n\n`) +
    `questionType: ${qt}\n\n` +
    (sv ? `KONTEKST (råtext):\n${contextTextRaw || "(ingen)"}\n\n` : `CONTEXT (raw):\n${contextTextRaw || "(none)"}\n\n`) +
    schemaHint;

  const model = safeStr(env && env.AI_MODEL).trim() || "@cf/meta/llama-3.1-8b-instruct";

  let answer;
  try {
    answer = await env.AI.run(model, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
  } catch (_) {
    answer = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
  }

  const raw = isPlainObject(answer) ? answer.response || answer.result || answer.output || answer.text || answer : answer;

  const parsed = safeJsonFromUnknown(raw);
  if (!parsed || !isPlainObject(parsed)) return null;

  const qArr = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (!qArr.length) return null;

  const blocks = [];
  const seenStem = new Set();

  for (let i = 0; i < qArr.length && blocks.length < count; i++) {
    const q = qArr[i];

    const stem = safeStr(q && (q.stem || q.question || q.text)).trim();
    if (!stem) continue;

    const key = stem.toLowerCase().replace(/\s+/g, " ").trim();
    if (seenStem.has(key)) continue;
    seenStem.add(key);

    const optsRaw = Array.isArray(q && q.options) ? q.options : Array.isArray(q && q.choices) ? q.choices : [];
    let options = optsRaw
      .map((x) => (isPlainObject(x) ? safeStr(x.text) : safeStr(x)))
      .map((s) => safeStr(s).trim())
      .filter(Boolean);
    options = uniqStrings(options);

    if (qt === "true_false") {
      if (options.length < 2) {
        options = sv ? ["Sant", "Falskt"] : ["True", "False"];
      } else {
        options = options.slice(0, 2);
      }
    } else {
      if (options.length < 2) continue;
      options = padOptions(language, options, 4);
    }

    const ciRaw = Number(q && q.correctIndex);
    let correctIndex = Number.isFinite(ciRaw) && ciRaw >= 0 && ciRaw < options.length ? Math.floor(ciRaw) : 0;

    const seed = hash32(`${requestId}|${subjectId}|${key}|${i}`);
    const shuffled = shuffleWithCorrectIndex(options, correctIndex, seed);
    options = shuffled.options;
    correctIndex = shuffled.correctIndex;

    const dim = arc[blocks.length] || "scenario_application";
    const baseExplanation = safeStr(q && (q.explanation || q.rationale || q.feedback)).trim();
    const explanation = ensureMiniLessonExplanation({
      language,
      bundle,
      pack,
      dim,
      options,
      correctIndex,
      baseExplanation,
    });

    blocks.push(makeQuestionBlockFromUi({ i: blocks.length, stem, options, correctIndex, explanation }));
  }

  if (blocks.length < count) {
    const det = buildTrainingBlocksDeterministic({ ...input, count: count - blocks.length, questionType: qt });
    const detBlocks = Array.isArray(det && det.blocks) ? det.blocks : [];
    for (let j = 0; j < detBlocks.length && blocks.length < count; j++) {
      const b = detBlocks[j];
      const newId = `q_${blocks.length + 1}`;
      blocks.push({ ...b, id: newId });
    }
  }

  if (!blocks.length) return null;

  const normalizedBlocks = blocks.slice(0, count).map((b, idx) => ({ ...b, id: `q_${idx + 1}` }));

  return {
    ok: true,
    v: "training-blocks@v1",
    mode,
    subjectId: (bundle && bundle.subjectId) || subjectId,
    language,
    blocks: normalizedBlocks,
  };
}

function makeQuestionBlockFromUi({ i, stem, options, correctIndex, explanation }) {
  const choices = options.map((text, idx) => ({
    id: `c${i + 1}_${idx + 1}`,
    text: safeStr(text),
  }));

  const safeIdx = Math.max(0, Math.min(choices.length - 1, Number(correctIndex) || 0));

  return {
    kind: "question",
    id: `q_${i + 1}`,
    items: [
      {
        type: "questionInline",
        question: {
          text: safeStr(stem),
          choices,
          correctChoiceId: choices[safeIdx].id,
          rationale: safeStr(explanation || ""),
        },
      },
    ],
  };
}

// ----------------- deterministic fallback -----------------

function buildTrainingBlocksDeterministic(input) {
  const requestId = safeStr(input && input.requestId).trim();
  const mode = safeStr(input && input.mode).trim() || "training";
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextText = safeStr(input && (input.context || input.contextText)).trim();
  const subjectId = safeStr(input && input.subjectId).trim() || "generic";
  const questionType = normalizeQuestionType(input && input.questionType);

  const place = inferWorkplaceFromContext(contextText, language);

  const seedBase = hash32(
    ["AO-WORKER-TRAINING-BLOCKS-01", VERSION, requestId || "no-req", subjectId, language, questionType, contextText.slice(0, 160)].join("|")
  );

  const arc = buildStoryArc(count);
  const pack = pickScenarioPack(contextText, place, language, seedBase);

  const bundle = parseContextBundle(contextText);

  const blocks = [];
  for (let i = 0; i < count; i++) {
    blocks.push(
      makeQuestionBlock({
        i,
        language,
        pack,
        dim: arc[i] || "scenario_application",
        bundle,
      })
    );
  }

  return { ok: true, v: "training-blocks@v1", mode, subjectId, language, blocks };
}

function inferWorkplaceFromContext(contextText, language) {
  const t = safeStr(contextText).toLowerCase();
  const sv = language === "sv";

  if (t.includes("kök") || t.includes("restaurang") || t.includes("servering")) return sv ? "i köket" : "in the kitchen";
  if (t.includes("leverans") || t.includes("mottagning") || t.includes("varumottag")) return sv ? "vid varumottagningen" : "at receiving";
  if (t.includes("internkontroll") || t.includes("revision") || t.includes("audit") || t.includes("iso 9001") || t.includes("kvalitet"))
    return sv ? "i en kvalitetsgenomgång" : "in a quality review";
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
  for (let i = 0; i < count; i++) seq.push(i < base.length ? base[i] : tail[(i - base.length) % tail.length]);
  return seq;
}

function pickScenarioPack(contextText, place, language, seed) {
  const t = safeStr(contextText).toLowerCase();
  const isKitchen = t.includes("kök") || t.includes("restaurang") || t.includes("servering");
  const isReceiving = t.includes("leverans") || t.includes("mottagning") || t.includes("varumottag");
  const isAudit = t.includes("revision") || t.includes("internkontroll") || t.includes("audit") || t.includes("iso 9001") || t.includes("kvalitet");
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
      setting: sv ? "En leverans har precis kommit in och underlaget är oklart" : "A delivery has just arrived and the evidence is unclear",
      artifact: sv ? "en sign-off, kvittens eller loggnotering" : "a sign-off, receipt, or log note",
      constraintB: sv ? "Märkningen är ofullständig och två personer säger olika." : "The labeling is incomplete and two people give different answers.",
      twist: sv ? "Efter 2 minuter kommer ny info som motsäger första beskedet." : "After 2 minutes, new info contradicts the first message.",
    },
    kitchen: {
      setting: sv ? "Ni är mitt i produktionen och tempot är högt" : "You’re mid-production and the pace is high",
      artifact: sv ? "en checklista, temperatur-logg eller signering" : "a checklist, temperature log, or sign-off",
      constraintB: sv ? "En kollega säger “vi gör som vanligt” men underlaget saknas." : "A colleague says “we do it as usual” but there’s no evidence.",
      twist: sv ? "En detalj dyker upp som gör att “som vanligt” inte längre gäller." : "A detail appears that makes “as usual” no longer valid.",
    },
    audit: {
      setting: sv ? "Ni gör en snabb kvalitetsgenomgång (ISO 9001) och behöver tydliga bevis" : "You’re doing a quick quality review (ISO 9001) and need clear evidence",
      artifact: sv ? "ett dokumenterat beslut eller en verifierbar notering" : "a documented decision or a verifiable note",
      constraintB: sv ? "Det finns en avvikelse, men ni vet inte ännu om den är liten eller stor." : "There’s a deviation, but you don’t yet know its scope.",
      twist: sv ? "En ny observation gör att ni måste omvärdera vad som är “viktigast först”." : "A new observation forces you to reconsider what matters first.",
    },
    brief: {
      setting: sv ? "På ett kort avstämningsmöte ska ni få samsyn och spårbarhet" : "In a short briefing you need alignment and traceability",
      artifact: sv ? "en tydlig vem-gör-vad-notering" : "a clear who-does-what note",
      constraintB: sv ? "En person saknas men påverkas av beslutet." : "One person is absent but will be impacted by the decision.",
      twist: sv ? "Efter mötet framkommer att en viktig detalj aldrig blev sagd." : "After the meeting, a key detail turns out to have been missing.",
    },
    customer: {
      setting: sv ? "En kund har hört av sig med ett klagomål och ni måste följa spår" : "A customer has contacted you with a complaint and you must trace the chain",
      artifact: sv ? "en notering som kopplar händelse till fakta" : "a note linking the event to facts",
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
  return { id: packId, place, setting: d.setting, artifact: d.artifact, constraintB: d.constraintB, twist: d.twist };
}

function makeQuestionBlock({ i, language, pack, dim, bundle }) {
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

  const explanation = ensureMiniLessonExplanation({
    language,
    bundle,
    pack,
    dim,
    options,
    correctIndex,
    baseExplanation: "",
  });

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
