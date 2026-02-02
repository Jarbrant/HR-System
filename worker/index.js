// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.7.2)
// FIL: worker/index.js
//
// MÅL (nu även: subjectSpec för frågor):
// - Frågor & svar ska bli lika bra som dokument: styrs av ai-rules subjectSpec
// - TRAINING laddar subjectSpec.questionSpec (via subjects/index.json allowlist)
// - DOCUMENT/MIX laddar subjectSpec.documentSpec (som tidigare), med minWords + rubriker + forbidden-guard
//
// PATCH v1.7.2 (2026-02-02) — P0 FIX (AI_BAD_JSON + fail-closed facit):
// 1) Training har nu deterministisk fallback som alltid returnerar giltig JSON (ingen 422 på AI_BAD_JSON).
//    - fail-closed: om AI inte ger parsebar JSON eller kvalitet FAIL -> fallback byggs utan att gissa facit från AI.
// 2) normalizeAiQuestionBlocksToCanonical() gissar inte längre correctChoiceId om facit saknas (skips).
// 3) validateTrainingQualityCanonical() hanterar true_false (2 alternativ) korrekt.
// 4) Prompt-schema byggs dynamiskt efter choicesCount och questionType.
//
// PATCH v1.7.1 (2026-02-02) — P0 FIX (payload/context):
// 1) FIX: normalizeContextText() klarar nu structured context-objekt (SDK payload.context)
//    -> JSON.stringify(...) när .text/.contextText/.prompt saknas.
//    Detta gör att parseContextBundle() kan läsa subjectId/module/area/chapter/step
//    och att subjectSpec+prompts blir korrekta (minskar AI_BAD_JSON).
//
// PATCH v1.7.0 (2026-02-02) — P0 FIX:
// 1) AI_BAD_JSON fix: safeJsonParseLoose() klarar nu både JSON-objekt {} och JSON-array []
//    även om AI lägger text före/efter.
// ============================================================

// ============================================================
// BLOCK 01 — Imports (min-safe)
// ============================================================

import { isPlainObject, safeStr, safeArr } from "./utils.js";

// ============================================================
// BLOCK 01B — UI question helpers (TOLERANT HOTFIX)
// Syfte: UI ska få frågor även om AI/engine svarar i annan "shape".
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

function normalizeUiQuestionItem(input) {
  try {
    if (!input || typeof input !== "object") return null;

    // Stöd både flat och nested { data:{...} }
    const src = (input.data && typeof input.data === "object") ? input.data : input;

    // Typ-varianter
    const rawType = safeStr(src.type || src.kind || input.type || input.kind).trim().toLowerCase();

    // "question" / "mcq" / "quiz" osv ska bli UI-typen "question"
    const looksLikeQuestionType =
      rawType === "question" ||
      rawType === "mcq" ||
      rawType === "quiz" ||
      rawType === "multiple_choice" ||
      rawType === "multiple-choice" ||
      rawType === "questioninline";

    // Frågetext-varianter
    const q =
      safeStr(src.question || src.prompt || src.questionText || src.text || src.title).trim();

    // Alternativ-varianter
    const optionsArr =
      Array.isArray(src.options) ? src.options :
      Array.isArray(src.choices) ? src.choices :
      Array.isArray(src.answers) ? src.answers :
      null;

    // Rensa options till string[]
    const options = Array.isArray(optionsArr)
      ? optionsArr.map(v => {
          if (v && typeof v === "object") return safeStr(v.text || v.label || v.value).trim();
          return safeStr(v).trim();
        }).filter(Boolean)
      : [];

    // Facit-varianter
    let correctIndex = null;
    if (Number.isFinite(src.correctIndex)) correctIndex = src.correctIndex;
    else if (Number.isFinite(src.correctAnswerIndex)) correctIndex = src.correctAnswerIndex;
    else if (Number.isFinite(src.answerIndex)) correctIndex = src.answerIndex;

    // Multi-facit (om någon AI levererar det)
    const correctIndices =
      Array.isArray(src.correctIndices) ? src.correctIndices :
      Array.isArray(src.answerIndices) ? src.answerIndices :
      null;

    // Förklaring-varianter
    const explanation =
      safeStr(src.explanation || src.rationale || src.reason || src.feedback || "").trim();

    // Om typen inte matchar men den "ser ut som en fråga" -> tillåt ändå
    const looksLikeQuestionShape = !!q && options.length >= 2;

    // Special: questionInline { question:{ text, choices:[{text}], correctChoiceId } }
    if ((!looksLikeQuestionType && !looksLikeQuestionShape) && isPlainObject(src.question)) {
      const qq = src.question;
      const stem = safeStr(qq.text || qq.question || qq.prompt || "").trim();
      const ch = Array.isArray(qq.choices) ? qq.choices : [];
      const oo = ch
        .map(c => safeStr((c && typeof c === "object") ? (c.text || c.label || c.value) : c).trim())
        .filter(Boolean);

      if (!stem || oo.length < 2) return null;

      // choiceId -> index
      let ci = -1;
      const correctChoiceId = safeStr(qq.correctChoiceId).trim();
      if (correctChoiceId) {
        const idx = ch.findIndex(c => safeStr(c && c.id).trim() === correctChoiceId);
        if (idx >= 0) ci = idx;
      }
      // fail-closed item-nivå: om okänt facit → sätt INTE om det saknas helt
      const expl2 = safeStr(qq.rationale || qq.explanation || qq.feedback || "").trim();

      const out = { type: "question", question: stem, options: oo };
      if (Number.isInteger(ci) && ci >= 0) out.correctIndex = ci;
      if (expl2) out.explanation = expl2;
      return out;
    }

    if (!looksLikeQuestionType && !looksLikeQuestionShape) return null;

    // Minimikrav för UI: fråga + minst 2 alternativ
    if (!q || options.length < 2) return null;

    const out = {
      type: "question",
      question: q,
      options
    };

    // Facit: fail-closed (sätt bara om det finns)
    if (Number.isFinite(correctIndex)) out.correctIndex = correctIndex;
    if (Array.isArray(correctIndices) && correctIndices.length) out.correctIndices = correctIndices;

    if (explanation) out.explanation = explanation;

    return out;
  } catch (_) {
    return null;
  }
}

function extractUiQuestionsFromAnyContainer(trainingObj) {
  const out = [];
  try {
    const candidates = [];

    if (trainingObj && typeof trainingObj === "object") {
      if (Array.isArray(trainingObj.items)) candidates.push(trainingObj.items);
      if (trainingObj.data && Array.isArray(trainingObj.data.items)) candidates.push(trainingObj.data.items);
      if (trainingObj.training && Array.isArray(trainingObj.training.items)) candidates.push(trainingObj.training.items);
      if (trainingObj.result && Array.isArray(trainingObj.result.items)) candidates.push(trainingObj.result.items);
    }

    for (const arr of candidates) {
      for (const it of arr) {
        const norm = normalizeUiQuestionItem(it);
        if (norm) out.push(norm);
      }
    }
  } catch (_) {}

  return out;
}

function mapTrainingBlocksToUiQuestions(blocksArr) {
  const out = [];

  function walk(node) {
    if (!node) return;

    // array
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }

    // object
    if (typeof node === "object") {
      const asItem = normalizeUiQuestionItem(node);
      if (asItem) out.push(asItem);

      if (Array.isArray(node.blocks)) walk(node.blocks);
      if (Array.isArray(node.items)) walk(node.items);
      if (Array.isArray(node.children)) walk(node.children);

      if (node.data && typeof node.data === "object") {
        if (Array.isArray(node.data.items)) walk(node.data.items);
        if (Array.isArray(node.data.blocks)) walk(node.data.blocks);
        if (Array.isArray(node.data.children)) walk(node.data.children);
      }
    }
  }

  walk(blocksArr);

  if (!out.length) {
    return {
      ok: false,
      errorCode: "UI_NO_QUESTIONS",
      message: "Inga question-block hittades att mappa till UI-frågor"
    };
  }

  return { ok: true, items: out };
}

function extractUiQuestionsForUi(trainingObj, blocksArr) {
  const fromItems = extractUiQuestionsFromAnyContainer(trainingObj);
  if (fromItems.length) return { ok: true, items: fromItems };
  return mapTrainingBlocksToUiQuestions(blocksArr);
}

// ============================================================
// BLOCK 02 — Constants
// ============================================================

export const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.7.2";

// ============================================================
// BLOCK 02B — Local utils (self-contained)
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
  if (s === "mix" || s === "mixed") return "mix";
  return "training";
}

// P0 (v1.7.1): stöd structured context-objekt från SDK.
// - Om v är object och saknar .text/.contextText/.prompt -> stringify
// - Detta gör att parseContextBundle kan läsa subject/course/level/goals.
function normalizeContextText(v) {
  if (typeof v === "string") return v.trim();
  if (v === null || v === undefined) return "";
  try {
    if (typeof v === "object") {
      const t = safeStr(v.text || v.contextText || v.prompt || "");
      if (t && t.trim()) return t.trim();

      // Structured context bundle -> JSON-text
      try {
        const s = JSON.stringify(v);
        return safeStr(s).slice(0, 4000).trim();
      } catch (_) {
        return "";
      }
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

function normalizeOrigin(s) {
  return safeStr(s).trim().replace(/\/+$/g, "");
}

// ------------------------------------------------------------
// P0: JSON extractor that can rescue BOTH {...} and [...]
// ------------------------------------------------------------

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

function extractFirstJsonArrayString(text) {
  const s = safeStr(text);
  const start = s.indexOf("[");
  if (start < 0) return "";
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }

    if (ch === '"') { inStr = true; continue; }
    if (ch === "[") depth++;
    if (ch === "]") depth--;

    if (depth === 0) return s.slice(start, i + 1);
  }
  return "";
}

function safeJsonParseLoose(text) {
  const t0 = safeStr(text).trim();
  if (!t0) return null;

  // 1) exact JSON
  try { return JSON.parse(t0); } catch (_) {}

  // 2) strip code fences (best-effort)
  const cleaned = t0.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}

  // 3) rescue first JSON object {...}
  const objStr = extractFirstJsonObjectString(cleaned);
  if (objStr) {
    try { return JSON.parse(objStr); } catch (_) {}
  }

  // 4) rescue first JSON array [...]
  const arrStr = extractFirstJsonArrayString(cleaned);
  if (arrStr) {
    try { return JSON.parse(arrStr); } catch (_) {}
  }

  return null;
}

function safeJsonFromUnknown(x) {
  if (isPlainObject(x) || Array.isArray(x)) return x;
  const t = safeStr(x).trim();
  if (!t) return null;
  return safeJsonParseLoose(t);
}

// ============================================================
// BLOCK 02C — Context unwrap (P0)
// ============================================================

function parseContextBundle(contextTextRaw) {
  const raw = safeStr(contextTextRaw).trim();
  if (!raw) return null;

  if (raw === "[object Object]") return null;

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

  // POLICY: Skicka aldrig goals till AI
  return lines.join("\n");
}

// ============================================================
// BLOCK 02F — Doc helpers + subject resolver (rules + allowlist + cache)
// ============================================================

function countWords(text) {
  const t = safeStr(text).trim();
  if (!t) return 0;
  return t.split(/\s+/g).filter(Boolean).length;
}

function joinDocBlocksText(blocks) {
  const arr = Array.isArray(blocks) ? blocks : [];
  const parts = [];
  for (const b of arr) {
    if (!b || b.kind !== "text") continue;
    const items = Array.isArray(b.items) ? b.items : [];
    const ti = items.find((x) => x && x.type === "textInline" && typeof x.text === "string");
    if (!ti) continue;
    parts.push(safeStr(ti.text));
  }
  return parts.join("\n\n").trim();
}

function containsAnyHeading(text, headings) {
  const t = safeStr(text).toLowerCase();
  for (const h of Array.isArray(headings) ? headings : []) {
    const hh = safeStr(h).toLowerCase().trim();
    if (!hh) continue;
    if (t.includes(hh)) return true;
  }
  return false;
}

function sentenceCount(text) {
  const t = safeStr(text).trim();
  if (!t) return 0;
  const m = t.match(/[.!?]+/g);
  return m ? m.length : 1;
}

function textIncludesAll(text, mustArr) {
  const t = safeStr(text).toLowerCase();
  const list = Array.isArray(mustArr) ? mustArr : [];
  for (const x of list) {
    const w = safeStr(x).toLowerCase().trim();
    if (!w) continue;
    if (!t.includes(w)) return false;
  }
  return true;
}

let __SUBJECT_INDEX_CACHE = null; // { ts:number, map: Record<string,string> }
let __SUBJECT_SPEC_CACHE = new Map(); // id|lang -> { ts:number, spec:object }
const __RULES_CACHE_TTL_MS = 5 * 60 * 1000;

function __now() { return Date.now(); }

function __getRulesBaseUrl(env) {
  const raw = safeStr(env && (env.RULES_BASE_URL || env.RULES_BASE || env.AI_RULES_BASE_URL)).trim();
  const base = normalizeOrigin(raw);
  if (!base) return "";
  if (!/^https:\/\//i.test(base)) return "";
  return base;
}

function __safeJoinUrl(base, path) {
  const b = normalizeOrigin(base);
  const p = safeStr(path).trim();
  if (!b || !p) return "";
  if (p.startsWith("http://") || p.startsWith("https://")) return "";
  const clean = p.replace(/^\/+/, "");
  return `${b}/${clean}`;
}

function __isAllowedSubjectsPath(path) {
  const p = safeStr(path).trim().replace(/\\/g, "/");
  if (!p) return false;
  if (!p.startsWith("ai-rules/v1/subjects/")) return false;
  if (p.includes("..")) return false;
  if (!p.toLowerCase().endsWith(".json")) return false;
  return true;
}

// ============================================================
// BLOCK 02F.1 — SubjectSpec normalize (documentSpec + questionSpec)
// ============================================================

function __normalizeSubjectSpec(specRaw, language, fallbackId) {
  const sv = language === "sv";
  const s = isPlainObject(specRaw) ? specRaw : {};

  const id = safeStr(s.id || s.subjectId || fallbackId || "generic").trim() || "generic";
  const label = safeStr(s.label || s.title || (sv ? "Ämne" : "Subject")).trim() || (sv ? "Ämne" : "Subject");

  const doc = isPlainObject(s.documentSpec) ? s.documentSpec : {};
  const minWordsDoc =
    Number(doc.minWordsTotal ?? s.minWordsDoc ?? s.minWords ?? s.minWordsDocument);

  const requiredHeadings =
    Array.isArray(doc.requiredHeadings) ? doc.requiredHeadings :
    Array.isArray(s.requiredHeadings) ? s.requiredHeadings :
    Array.isArray(s.headings) ? s.headings :
    [];

  const bullets =
    Array.isArray(doc.bullets) ? doc.bullets :
    Array.isArray(s.bullets) ? s.bullets :
    [];

  const examples =
    Array.isArray(doc.examples) ? doc.examples :
    Array.isArray(s.examples) ? s.examples :
    [];

  const forbiddenInDocument =
    Array.isArray(doc.forbiddenInDocument) ? doc.forbiddenInDocument :
    Array.isArray(s.forbidden) ? s.forbidden :
    [];

  const qs = isPlainObject(s.questionSpec) ? s.questionSpec : {};
  const mcq = isPlainObject(qs.mcq) ? qs.mcq : {};

  const qSpec = {
    goal: safeStr(qs.goal || "").trim(),
    styleRules: (Array.isArray(qs.styleRules) ? qs.styleRules : []).map(x => safeStr(x).trim()).filter(Boolean),
    topics: (Array.isArray(qs.topics) ? qs.topics : []).map(x => safeStr(x).trim()).filter(Boolean),
    badPatternsToAvoid: (Array.isArray(qs.badPatternsToAvoid) ? qs.badPatternsToAvoid : []).map(x => safeStr(x).trim()).filter(Boolean),
    mcq: {
      choicesCount: Number.isFinite(Number(mcq.choicesCount)) ? Math.max(2, Math.min(6, Math.floor(Number(mcq.choicesCount)))) : 4,
      singleCorrect: mcq.singleCorrect !== false,
      rationaleMinSentences: Number.isFinite(Number(mcq.rationaleMinSentences)) ? Math.max(1, Math.min(12, Math.floor(Number(mcq.rationaleMinSentences)))) : 4,
      rationaleMaxSentences: Number.isFinite(Number(mcq.rationaleMaxSentences)) ? Math.max(1, Math.min(12, Math.floor(Number(mcq.rationaleMaxSentences)))) : 6,
      rationaleMustInclude: (Array.isArray(mcq.rationaleMustInclude) ? mcq.rationaleMustInclude : []).map(x => safeStr(x).trim()).filter(Boolean)
    }
  };

  const qSpecEffective = (!qSpec.goal && !qSpec.styleRules.length && !qSpec.topics.length && !qSpec.badPatternsToAvoid.length)
    ? {
        goal: sv ? "Skapa vardagsnära frågor som testar förståelse och korrekt arbetssätt." : "Create real-world questions that test understanding and correct practice.",
        styleRules: sv
          ? [
              "Varje fråga ska utgå från en konkret situation.",
              "Undvik kuggfrågor – testa förståelse och rätt arbetssätt.",
              "1 korrekt + övriga ska vara realistiska fel/halvfel.",
              "Förklaring ska säga varför och vad man gör nästa gång."
            ]
          : [
              "Each question must be based on a concrete situation.",
              "Avoid trick questions—test understanding and correct practice.",
              "1 correct + the rest should be realistic mistakes/near-misses.",
              "Rationale must explain why and what to do next time."
            ],
        topics: [],
        badPatternsToAvoid: sv
          ? ["Gissa motiv/känslor", "Övertydligt 'rätt' alternativ", "Förklaring utan varför"]
          : ["Guessing motives/feelings", "Overly obvious correct option", "Rationale without why"],
        mcq: {
          choicesCount: 4,
          singleCorrect: true,
          rationaleMinSentences: 4,
          rationaleMaxSentences: 6,
          rationaleMustInclude: []
        }
      }
    : qSpec;

  return {
    id,
    label,

    minWordsDoc: Number.isFinite(minWordsDoc) && minWordsDoc > 0 ? Math.floor(minWordsDoc) : 180,
    requiredHeadings: requiredHeadings.map((x) => safeStr(x).trim()).filter(Boolean),
    bullets: bullets.map((x) => safeStr(x).trim()).filter(Boolean),
    examples: examples.map((x) => safeStr(x).trim()).filter(Boolean),
    forbidden: forbiddenInDocument.map((x) => safeStr(x).trim()).filter(Boolean),

    documentSpec: {
      minWordsTotal: Number.isFinite(minWordsDoc) && minWordsDoc > 0 ? Math.floor(minWordsDoc) : 180,
      requiredHeadings: requiredHeadings.map((x) => safeStr(x).trim()).filter(Boolean),
      bullets: bullets.map((x) => safeStr(x).trim()).filter(Boolean),
      examples: examples.map((x) => safeStr(x).trim()).filter(Boolean),
      forbiddenInDocument: forbiddenInDocument.map((x) => safeStr(x).trim()).filter(Boolean)
    },
    questionSpec: qSpecEffective
  };
}

async function __loadSubjectsIndex(env) {
  const base = __getRulesBaseUrl(env);
  if (!base) return null;

  const t = __now();
  if (__SUBJECT_INDEX_CACHE && t - __SUBJECT_INDEX_CACHE.ts < __RULES_CACHE_TTL_MS) {
    return __SUBJECT_INDEX_CACHE.map;
  }

  const url = __safeJoinUrl(base, "ai-rules/v1/subjects/index.json");
  if (!url) return null;

  try {
    const res = await fetch(url, { method: "GET" });
    if (!res || !res.ok) return null;
    const json = await res.json();

    const map = {};

    if (isPlainObject(json) && Array.isArray(json.subjects)) {
      for (const row of json.subjects) {
        if (!row) continue;
        const id = safeStr(row.id || row.subjectId).trim();
        const file = safeStr(row.file || row.path || row.href).trim();
        if (!id || !file) continue;
        const p = file.replace(/^\/+/, "");
        if (!__isAllowedSubjectsPath(p)) continue;
        map[id] = p;
      }
    } else if (isPlainObject(json) && isPlainObject(json.byId)) {
      for (const [k, v] of Object.entries(json.byId)) {
        const id = safeStr(k).trim();
        const file = safeStr(v).trim();
        if (!id || !file) continue;
        const p = file.replace(/^\/+/, "");
        if (!__isAllowedSubjectsPath(p)) continue;
        map[id] = p;
      }
    } else if (isPlainObject(json)) {
      for (const [k, v] of Object.entries(json)) {
        const id = safeStr(k).trim();
        const file = safeStr(v).trim();
        if (!id || !file) continue;
        const p = file.replace(/^\/+/, "");
        if (!__isAllowedSubjectsPath(p)) continue;
        map[id] = p;
      }
    }

    __SUBJECT_INDEX_CACHE = { ts: t, map };
    return map;
  } catch (_) {
    return null;
  }
}

// builtin fallback
function resolveSubjectSpec(subjectIdRaw, language) {
  const sv = language === "sv";
  const id = safeStr(subjectIdRaw).trim() || "generic";

  const specs = {
    generic: __normalizeSubjectSpec({
      id: "generic",
      label: sv ? "Generellt" : "Generic",
      documentSpec: {
        minWordsTotal: 180,
        requiredHeadings: sv ? ["Varför", "Så gör ni", "Exempel", "Mini-checklista", "Kom ihåg"] : ["Why", "How to", "Examples", "Mini checklist", "Remember"],
        bullets: sv
          ? ["Skriv sakligt och konkret.", "Använd rubriker och punktlistor.", "Ge minst 2 exempel från vardagen."]
          : ["Write clearly and concretely.", "Use headings and bullet lists.", "Include at least 2 real-world examples."],
        examples: sv
          ? ["Exempel: Beskriv fakta, ställ en öppen fråga, kom överens om nästa steg."]
          : ["Example: State facts, ask an open question, agree on next steps."],
        forbiddenInDocument: sv ? ["correctIndex", "quiz", "facit", "mcq"] : ["correctIndex", "quiz", "answer key", "mcq"]
      }
    }, language, "generic")
  };

  return specs[id] || specs.generic;
}

async function resolveSubjectSpecAsync(subjectIdRaw, language, env) {
  const id = safeStr(subjectIdRaw).trim() || "generic";
  const cacheKey = `${id}|${language}`;
  const t = __now();

  const cached = __SUBJECT_SPEC_CACHE.get(cacheKey);
  if (cached && t - cached.ts < __RULES_CACHE_TTL_MS) return cached.spec;

  const idx = await __loadSubjectsIndex(env);
  const relPath = idx && idx[id] ? safeStr(idx[id]).trim() : "";

  if (relPath && __isAllowedSubjectsPath(relPath)) {
    const base = __getRulesBaseUrl(env);
    const url = __safeJoinUrl(base, relPath);
    if (url) {
      try {
        const res = await fetch(url, { method: "GET" });
        if (res && res.ok) {
          const json = await res.json();
          const spec = __normalizeSubjectSpec(json, language, id);
          __SUBJECT_SPEC_CACHE.set(cacheKey, { ts: t, spec });
          return spec;
        }
      } catch (_) {}
    }
  }

  const builtin = resolveSubjectSpec(id, language);
  __SUBJECT_SPEC_CACHE.set(cacheKey, { ts: t, spec: builtin });
  return builtin;
}

function validateDocOutput({ language, subjectSpec, blocks }) {
  const sv = language === "sv";
  const text = joinDocBlocksText(blocks);
  const words = countWords(text);

  const minWords = Number(subjectSpec && subjectSpec.minWordsDoc) || 180;
  if (words < minWords) {
    return {
      ok: false,
      errorCode: "DOC_TOO_SHORT",
      message: sv
        ? `För kort infoblad (${words} ord). Minst ${minWords} ord krävs för ämnet.`
        : `Document too short (${words} words). Minimum ${minWords} words required.`,
    };
  }

  const reqHeads = Array.isArray(subjectSpec && subjectSpec.requiredHeadings) ? subjectSpec.requiredHeadings : [];
  if (reqHeads.length) {
    const hasHeading = containsAnyHeading(text, reqHeads);
    if (!hasHeading) {
      return {
        ok: false,
        errorCode: "DOC_MISSING_SECTIONS",
        message: sv ? "Infoblad saknar tydliga rubriker/sektioner. Försök igen." : "Document lacks clear headings/sections. Try again.",
      };
    }
  }

  return { ok: true };
}

// ============================================================
// BLOCK 03 — HTTP helpers (CORS + JSON)
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
// BLOCK 04 — Document blocks (builders)
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

function ensureNoQuestionBlocks(blocks) {
  const arr = Array.isArray(blocks) ? blocks : [];
  for (const b of arr) {
    if (!b) continue;
    if (b.kind === "question") return false;
  }
  return true;
}

function buildDocumentBlocksDeterministic(input) {
  const mode = safeStr(input && input.mode).trim() || "document";
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextText = safeStr(input && (input.context || input.contextText)).trim();
  const subjectIdRaw = safeStr(input && input.subjectId).trim() || "generic";

  const bundle = parseContextBundle(contextText);
  const effectiveSubjectId = safeStr(subjectIdRaw || (bundle && bundle.subjectId) || "generic").trim() || "generic";
  const subjectSpec = resolveSubjectSpec(effectiveSubjectId, language);

  const sv = language === "sv";
  const ctxBits = [];
  if (bundle && bundle.module) ctxBits.push(bundle.module);
  if (bundle && bundle.area) ctxBits.push(bundle.area);
  if (bundle && bundle.chapter) ctxBits.push(bundle.chapter);
  if (bundle && bundle.step) ctxBits.push(`${sv ? "Steg" : "Step"} ${bundle.step}`);
  const ctx = ctxBits.length ? ctxBits.join(" • ") : sv ? "Utbildning" : "Training";

  const heads = Array.isArray(subjectSpec && subjectSpec.requiredHeadings) ? subjectSpec.requiredHeadings : [];
  const bullets = Array.isArray(subjectSpec && subjectSpec.bullets) ? subjectSpec.bullets : [];
  const examples = Array.isArray(subjectSpec && subjectSpec.examples) ? subjectSpec.examples : [];

  function buildDocText(idx) {
    const h1 = heads[0] || (sv ? "Varför finns det här" : "Why this exists");
    const h2 = heads[1] || (sv ? "Så gör ni" : "How to do it");
    const h3 = heads[3] || (sv ? "Exempel" : "Examples");
    const h4 = heads[4] || (sv ? "Mini-checklista" : "Mini checklist");
    const h5 = heads[5] || (sv ? "Vanliga fallgropar" : "Common pitfalls");

    const b = bullets.length
      ? bullets
      : sv
      ? ["Var tydlig, konkret och respektfull.", "Avsluta med nästa steg och uppföljning."]
      : ["Be clear, concrete, and respectful.", "End with next steps and follow-up."];

    const ex = examples.length
      ? examples
      : sv
      ? ["Exempel: Beskriv fakta, ställ en öppen fråga, kom överens om nästa steg."]
      : ["Example: State facts, ask an open question, agree on next steps."];

    const title = sv ? `${subjectSpec.label} — del ${idx + 1}` : `${subjectSpec.label} — part ${idx + 1}`;

    const text =
      `${h1}\n` +
      (sv
        ? `Detta infoblad hjälper er att genomföra samtal som leder till utveckling och trygghet. Koppla alltid till fakta och till syftet i verksamheten (${ctx}).\n\n`
        : `This info sheet helps you run conversations that lead to development and safety. Always tie it to facts and the purpose in your workplace (${ctx}).\n\n`) +
      `${h2}\n` +
      `- ${b.slice(0, 6).join("\n- ")}\n\n` +
      `${h3}\n` +
      `- ${ex.slice(0, 4).join("\n- ")}\n\n` +
      `${h4}\n` +
      (sv
        ? `- Vad har vi sett/hört (fakta)?\n- Vad är syftet med samtalet?\n- Vad behöver personen för att lyckas?\n- Vad gör vi nu och när följer vi upp?\n\n`
        : `- What did we observe (facts)?\n- What is the purpose of the conversation?\n- What does the person need to succeed?\n- What do we do now and when do we follow up?\n\n`) +
      `${h5}\n` +
      (sv
        ? `- Att “gissa motiv” istället för att prata om beteende.\n- Att ge otydlig feedback utan nästa steg.\n- Att hoppa över uppföljning.\n`
        : `- Guessing motives instead of talking about behavior.\n- Giving vague feedback without next steps.\n- Skipping follow-up.\n`);

    return { title, text };
  }

  const blocks = [];
  for (let i = 0; i < count; i++) {
    const built = buildDocText(i);
    blocks.push(makeTextBlock({ i, title: built.title, text: built.text }));
  }

  return { ok: true, v: "training-blocks@v1", mode, subjectId: effectiveSubjectId, language, blocks };
}

// ============================================================
// BLOCK 05 — Training blocks (AI + deterministic fallback)
// ============================================================

function buildTrainingBlocksDeterministicFallback(input, subjectSpec, bundle, questionType) {
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const sv = language === "sv";

  const qSpec = isPlainObject(subjectSpec && subjectSpec.questionSpec) ? subjectSpec.questionSpec : {};
  const mcq = isPlainObject(qSpec && qSpec.mcq) ? qSpec.mcq : {};

  const qt = normalizeQuestionType(questionType);
  const isTF = qt === "true_false";

  const choicesCount = isTF ? 2 : (
    Number.isFinite(Number(mcq.choicesCount))
      ? Math.max(2, Math.min(6, Math.floor(Number(mcq.choicesCount))))
      : 4
  );

  const minS = Number.isFinite(Number(mcq.rationaleMinSentences)) ? Math.max(1, Math.floor(Number(mcq.rationaleMinSentences))) : 4;
  const maxS = Number.isFinite(Number(mcq.rationaleMaxSentences)) ? Math.max(minS, Math.floor(Number(mcq.rationaleMaxSentences))) : 6;
  const mustInclude = Array.isArray(mcq.rationaleMustInclude) ? mcq.rationaleMustInclude : [];

  const module = safeStr(bundle && bundle.module).trim();
  const area = safeStr(bundle && bundle.area).trim();
  const chapter = safeStr(bundle && bundle.chapter).trim();
  const step = safeStr(bundle && bundle.step).trim();
  const level = safeStr(bundle && bundle.level).trim();

  const ctx = [
    module ? `${sv ? "Modul" : "Module"}: ${module}` : "",
    area ? `${sv ? "Område" : "Area"}: ${area}` : "",
    chapter ? `${sv ? "Kapitel" : "Chapter"}: ${chapter}` : "",
    step ? `${sv ? "Steg" : "Step"}: ${step}` : "",
    level ? `${sv ? "Nivå" : "Level"}: ${level}` : ""
  ].filter(Boolean).join(" • ");

  function mkRationale(baseWhy, nextTimeTip) {
    const partsSv = [
      baseWhy,
      "Det korrekta svaret följer grundregeln och minskar risken för missförstånd eller fel.",
      "De andra alternativen är vanliga misstag: antingen för otydliga, för snabba eller utan uppföljning.",
      nextTimeTip,
      "Avsluta med att bekräfta nästa steg och när ni följer upp."
    ];

    const partsEn = [
      baseWhy,
      "The correct option follows the basic rule and reduces the risk of misunderstanding or errors.",
      "The other options are common mistakes: too vague, too fast, or missing follow-up.",
      nextTimeTip,
      "End by confirming the next step and when you will follow up."
    ];

    let parts = sv ? partsSv : partsEn;

    if (mustInclude.length) {
      // fail-closed: injicera mustInclude som enkla fraser om de saknas
      const t = parts.join(" ").toLowerCase();
      for (const w of mustInclude) {
        const ww = safeStr(w).toLowerCase().trim();
        if (!ww) continue;
        if (!t.includes(ww)) {
          parts = parts.concat([sv ? `Obligatoriskt: ${safeStr(w).trim()}.` : `Required: ${safeStr(w).trim()}.`]);
        }
      }
    }

    // trimma till maxS meningar (enkel kapning)
    const want = Math.max(minS, Math.min(maxS, parts.length));
    return parts.slice(0, want).join(" ");
  }

  function mkChoices(i) {
    if (isTF) {
      return [
        { id: "c1", text: sv ? "Sant" : "True" },
        { id: "c2", text: sv ? "Falskt" : "False" }
      ];
    }

    // Generisk MCQ: realistiska fel/halvfel
    const base = sv
      ? [
          "Prata om observerbara fakta och vad som behöver bli bättre, och kom överens om ett nästa steg.",
          "Vänta och se – det löser sig oftast av sig själv utan att ni behöver prata om det.",
          "Säg till generellt att det är ‘fel’ utan exempel, så personen förstår att det måste bli bättre.",
          "Ta upp allt som är fel på en gång, även sådant som inte hör till situationen."
        ]
      : [
          "Talk about observable facts and what needs to improve, and agree on the next step.",
          "Wait and see—it usually resolves itself without discussing it.",
          "Say generally that it is 'wrong' without examples so the person understands it must improve.",
          "Bring up everything that is wrong at once, including unrelated issues."
        ];

    // rotera lite så inte alla frågor blir identiska
    const rotated = base.slice(i % base.length).concat(base.slice(0, i % base.length));
    return rotated.slice(0, choicesCount).map((t, idx) => ({ id: `c${idx + 1}`, text: t }));
  }

  function mkQuestion(i) {
    const subjectLabel = safeStr(subjectSpec && subjectSpec.label).trim() || (sv ? "Generellt" : "Generic");
    const stem = sv
      ? `I ${subjectLabel}${ctx ? ` (${ctx})` : ""}: Du ser en avvikelse/ett arbetssätt som behöver rättas till. Vad är bäst att göra?`
      : `In ${subjectLabel}${ctx ? ` (${ctx})` : ""}: You observe a deviation/work practice that needs correction. What is the best action?`;

    const choices = mkChoices(i);

    // correct: alltid c1 i vår fallback (vi konstruerar alternativen så)
    const correctChoiceId = "c1";

    const rationale = mkRationale(
      sv
        ? "Rätt arbetssätt är att vara konkret och saklig: beskriva vad som hänt och vad som förväntas."
        : "The right approach is to be concrete and factual: describe what happened and what is expected.",
      sv
        ? "Nästa gång: ta samtalet tidigt, håll dig till fakta och dokumentera kort vad ni kom överens om."
        : "Next time: address it early, stick to facts, and briefly document what you agreed on."
    );

    return {
      kind: "question",
      id: `q_${i + 1}`,
      items: [
        {
          type: "questionInline",
          question: {
            text: stem,
            choices,
            correctChoiceId,
            rationale
          }
        }
      ]
    };
  }

  const blocks = [];
  for (let i = 0; i < count; i++) blocks.push(mkQuestion(i));

  return {
    ok: true,
    v: "training-blocks@v1",
    mode: "training",
    language,
    subjectId: safeStr(subjectSpec && subjectSpec.id).trim() || "generic",
    blocks,
    __fallback: { reason: "DETERMINISTIC_FALLBACK" }
  };
}

function coerceParsedObjOrArray(parsed) {
  if (isPlainObject(parsed)) return parsed;
  if (Array.isArray(parsed)) return { blocks: parsed };
  return null;
}

function normalizeAiQuestionBlocksToCanonical(blocks, language, count) {
  const sv = language === "sv";
  const out = [];

  const arr = Array.isArray(blocks) ? blocks : [];
  for (const b0 of arr) {
    if (!b0) continue;

    // 1) already canonical-ish
    if (isPlainObject(b0) && (b0.kind === "question" || safeStr(b0.kind).toLowerCase() === "question") && Array.isArray(b0.items)) {
      out.push(b0);
      continue;
    }

    // 2) tolerant: treat object as question item -> convert to canonical block
    const ui = normalizeUiQuestionItem(b0);
    if (ui) {
      // P0 fail-closed: gissa INTE facit om det saknas
      if (!Number.isFinite(ui.correctIndex)) continue;

      const choices = ui.options.map((t, i) => ({ id: `c${i + 1}`, text: t }));
      const ci = Math.max(0, Math.min(choices.length - 1, ui.correctIndex));
      const rationale = safeStr(ui.explanation || (sv ? "Förklaring saknas." : "Explanation missing.")).trim();
      if (!rationale) continue;

      out.push({
        kind: "question",
        id: `q_${out.length + 1}`,
        items: [{
          type: "questionInline",
          question: {
            text: ui.question,
            choices,
            correctChoiceId: choices[ci] ? choices[ci].id : "c1",
            rationale
          }
        }]
      });
      continue;
    }

    // 3) object may hold data/items
    if (isPlainObject(b0) && isPlainObject(b0.data) && Array.isArray(b0.data.items)) {
      const qi = b0.data.items.find(x => x && x.type === "questionInline" && isPlainObject(x.question));
      if (qi) {
        out.push({ kind: "question", id: `q_${out.length + 1}`, items: [qi] });
        continue;
      }
    }
  }

  return out.slice(0, count);
}

function effectiveTrainingQuestionType(questionTypeNormalized) {
  const qt = normalizeQuestionType(questionTypeNormalized);
  if (!qt || qt === "auto") return "mcq_single";
  if (qt === "mcq_multi") return "mcq_single";
  if (qt === "true_false") return "true_false";
  if (qt === "mcq_single") return "mcq_single";
  return "mcq_single";
}

function parseTrainingAiAnswer(answer) {
  const raw = isPlainObject(answer) ? (answer.response || answer.result || answer.output || answer.text || answer) : answer;
  const parsed0 = safeJsonFromUnknown(raw);
  const parsed = coerceParsedObjOrArray(parsed0);
  if (!parsed) return null;

  if (isPlainObject(parsed.training)) return coerceParsedObjOrArray(parsed.training) || parsed;
  if (isPlainObject(parsed.data)) return coerceParsedObjOrArray(parsed.data) || parsed;
  if (isPlainObject(parsed.result)) return coerceParsedObjOrArray(parsed.result) || parsed;

  return parsed;
}

function validateTrainingQualityCanonical({ blocks, qSpec, language, questionType }) {
  const sv = language === "sv";
  const qs = isPlainObject(qSpec) ? qSpec : {};
  const mcq = isPlainObject(qs.mcq) ? qs.mcq : {};

  const qt = normalizeQuestionType(questionType);
  const isTF = qt === "true_false";

  const expectedChoices = isTF ? 2 : (
    Number.isFinite(Number(mcq.choicesCount))
      ? Math.max(2, Math.min(6, Math.floor(Number(mcq.choicesCount))))
      : 4
  );

  const minS = Number.isFinite(Number(mcq.rationaleMinSentences)) ? Math.max(1, Math.floor(Number(mcq.rationaleMinSentences))) : 4;
  const maxS = Number.isFinite(Number(mcq.rationaleMaxSentences)) ? Math.max(minS, Math.floor(Number(mcq.rationaleMaxSentences))) : 6;
  const must = Array.isArray(mcq.rationaleMustInclude) ? mcq.rationaleMustInclude : [];

  const arr = Array.isArray(blocks) ? blocks : [];
  for (const b of arr) {
    if (!b || b.kind !== "question") {
      return { ok: false, errorCode: "AI_BAD_QUALITY", message: sv ? "Fel block-typ i training." : "Wrong block type in training." };
    }
    const item = Array.isArray(b.items) ? b.items.find(x => x && x.type === "questionInline" && isPlainObject(x.question)) : null;
    if (!item) return { ok: false, errorCode: "AI_BAD_QUALITY", message: sv ? "Saknar questionInline." : "Missing questionInline." };

    const q = item.question;
    const stem = safeStr(q.text).trim();
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const correct = safeStr(q.correctChoiceId).trim();
    const rationale = safeStr(q.rationale).trim();

    if (!stem) return { ok: false, errorCode: "AI_BAD_QUALITY", message: sv ? "Frågetext saknas." : "Question text missing." };
    if (choices.length !== expectedChoices) {
      return { ok: false, errorCode: "AI_BAD_QUALITY", message: sv ? `Fel antal svarsalternativ (${choices.length}).` : `Wrong number of choices (${choices.length}).` };
    }

    const ids = choices.map(c => safeStr(c && c.id).trim()).filter(Boolean);
    if (!correct || !ids.includes(correct)) {
      return { ok: false, errorCode: "AI_BAD_QUALITY", message: sv ? "Ogiltigt correctChoiceId." : "Invalid correctChoiceId." };
    }

    // true/false: enkel guard att alternativen liknar sant/falskt, men fail inte hårt
    if (isTF) {
      const texts = choices.map(c => safeStr(c && c.text).toLowerCase().trim());
      const tfLike = (texts.includes("sant") && texts.includes("falskt")) || (texts.includes("true") && texts.includes("false"));
      if (!tfLike) {
        return { ok: false, errorCode: "AI_BAD_QUALITY", message: sv ? "true/false måste använda Sant/Falskt." : "true/false must use True/False." };
      }
    }

    const sc = sentenceCount(rationale);
    if (sc < minS || sc > maxS) {
      return {
        ok: false,
        errorCode: "AI_BAD_QUALITY",
        message: sv ? `Förklaring har fel längd (${sc} meningar).` : `Rationale wrong length (${sc} sentences).`
      };
    }

    if (must.length && !textIncludesAll(rationale, must)) {
      return {
        ok: false,
        errorCode: "AI_BAD_QUALITY",
        message: sv ? "Förklaring saknar obligatoriska delar (mustInclude)." : "Rationale missing required parts (mustInclude)."
      };
    }
  }

  return { ok: true };
}

async function buildTrainingBlocksWithAI(input, env) {
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextTextRaw = safeStr(input && (input.context || input.contextText)).trim();
  const questionTypeRaw = normalizeQuestionType(input && input.questionType);
  const qtForAi = effectiveTrainingQuestionType(questionTypeRaw);

  const bundle = parseContextBundle(contextTextRaw);
  const subjectIdRaw = safeStr(input && input.subjectId).trim();
  const effectiveSubjectId = safeStr(subjectIdRaw || (bundle && bundle.subjectId) || "generic").trim() || "generic";

  const sv = language === "sv";
  const courseInfo = fmtContextForPrompt(bundle, language);

  const subjectSpec = await resolveSubjectSpecAsync(effectiveSubjectId, language, env);
  const qSpec = isPlainObject(subjectSpec && subjectSpec.questionSpec) ? subjectSpec.questionSpec : {};
  const mcq = isPlainObject(qSpec && qSpec.mcq) ? qSpec.mcq : {};

  const isTF = qtForAi === "true_false";

  const choicesCount = isTF ? 2 : (
    Number.isFinite(Number(mcq.choicesCount)) ? Math.max(2, Math.min(6, Math.floor(Number(mcq.choicesCount)))) : 4
  );
  const minS = Number.isFinite(Number(mcq.rationaleMinSentences)) ? Math.max(1, Math.floor(Number(mcq.rationaleMinSentences))) : 4;
  const maxS = Number.isFinite(Number(mcq.rationaleMaxSentences)) ? Math.max(minS, Math.floor(Number(mcq.rationaleMaxSentences))) : 6;
  const mustInclude = Array.isArray(mcq.rationaleMustInclude) ? mcq.rationaleMustInclude : [];

  const model = safeStr(env && env.AI_MODEL).trim() || "@cf/meta/llama-3.1-8b-instruct";

  const systemPromptBase = sv
    ? "Du skapar flervalsfrågor (MCQ) för HR-utbildning. Du måste returnera ENDAST giltig JSON enligt schema. Inget markdown. Börja med { och sluta med }."
    : "You create multiple-choice questions (MCQ) for HR training. Return ONLY valid JSON per schema. No markdown. Start with { and end with }.";

  function buildSchemaExample() {
    const choices = [];
    for (let i = 0; i < choicesCount; i++) choices.push(`              { "id": "c${i + 1}", "text": "..." }`);
    const schema = `{
  "ok": true,
  "mode": "training",
  "blocks": [
    {
      "kind": "question",
      "id": "q_1",
      "items": [
        {
          "type": "questionInline",
          "question": {
            "text": "...",
            "choices": [
${choices.join(",\n")}
            ],
            "correctChoiceId": "c1",
            "rationale": "..."
          }
        }
      ]
    }
  ]
}`;
    return schema;
  }

  function buildUserPrompt({ stricter }) {
    const strictLine = stricter
      ? (sv
          ? "\nVIKTIGT: OM DU SKRIVER EN ENDA RAD UTANFÖR JSON SÅ BLIR SVARET AVVISAT. INGA ```."
          : "\nIMPORTANT: If you write ANY text outside JSON, the response is rejected. No ```.")
      : "";

    const modeLine = sv ? "LÄGE: TRAINING (frågor)" : "MODE: TRAINING (questions)";
    const qtLine = sv ? `FRÅGETYP (internt): ${qtForAi}` : `QUESTION TYPE (internal): ${qtForAi}`;

    const subjectLine = sv
      ? `ÄMNE: ${safeStr(subjectSpec && subjectSpec.label).trim() || "Generellt"} (subjectId: ${effectiveSubjectId})`
      : `SUBJECT: ${safeStr(subjectSpec && subjectSpec.label).trim() || "Generic"} (subjectId: ${effectiveSubjectId})`;

    const styleRules = Array.isArray(qSpec && qSpec.styleRules) ? qSpec.styleRules : [];
    const topics = Array.isArray(qSpec && qSpec.topics) ? qSpec.topics : [];
    const bad = Array.isArray(qSpec && qSpec.badPatternsToAvoid) ? qSpec.badPatternsToAvoid : [];
    const goal = safeStr(qSpec && qSpec.goal).trim();

    const qRulesBlock = [
      sv ? "FRÅGEKRAV (subjectSpec.questionSpec):" : "QUESTION REQUIREMENTS (subjectSpec.questionSpec):",
      goal ? (sv ? `Mål: ${goal}` : `Goal: ${goal}`) : "",
      styleRules.length ? `${sv ? "Stilregler" : "Style rules"}:\n- ${styleRules.join("\n- ")}` : "",
      topics.length ? `${sv ? "Ämnen att täcka" : "Topics to cover"}:\n- ${topics.join("\n- ")}` : "",
      bad.length ? `${sv ? "Dåliga mönster att undvika" : "Bad patterns to avoid"}:\n- ${bad.join("\n- ")}` : "",
      (mustInclude.length ? `${sv ? "Förklaring måste innehålla" : "Rationale must include"}:\n- ${mustInclude.join("\n- ")}` : "")
    ].filter(Boolean).join("\n\n");

    const schema = buildSchemaExample();

    const countLine = sv ? `- Skapa exakt ${count} frågor.` : `- Create exactly ${count} questions.`;
    const choiceLine = sv ? `- Varje fråga ska ha exakt ${choicesCount} svarsalternativ (c1..c${choicesCount}).` : `- Each question must have exactly ${choicesCount} choices (c1..c${choicesCount}).`;
    const rationaleLine = sv ? `- rationale: ${minS}–${maxS} meningar, saklig och konkret.` : `- rationale: ${minS}–${maxS} sentences, factual and concrete.`;

    const tfRule = isTF
      ? (sv
          ? "- true_false: svarsalternativ ska vara Sant/Falskt."
          : "- true_false: choices must be True/False.")
      : "";

    if (sv) {
      return `${courseInfo}
${modeLine}
${qtLine}
${subjectLine}

${qRulesBlock}

KRAV:
${countLine}
${choiceLine}
- Exakt 1 korrekt svar via correctChoiceId.
${rationaleLine}
${tfRule}
- Alternativen ska vara realistiska: 1 korrekt, övriga ska vara vanliga fel/halvfel.
- Undvik kuggfrågor och ordlekar.
- Returnera exakt JSON enligt schema.${strictLine}

SCHEMA:
${schema}

KONTEKST (råtext):
${contextTextRaw || "(ingen)"}
`;
    }

    return `${courseInfo}
${modeLine}
${qtLine}
${subjectLine}

${qRulesBlock}

REQUIREMENTS:
${countLine}
${choiceLine}
- Exactly 1 correct answer via correctChoiceId.
${rationaleLine}
${tfRule}
- Options must be realistic: 1 correct, the rest are common mistakes/near-misses.
- Avoid trick questions.
- Return EXACT JSON per schema.${strictLine}

SCHEMA:
${schema}

CONTEXT (raw):
${contextTextRaw || "(none)"}
`;
  }

  async function runOnce(stricter) {
    const systemPrompt = stricter ? (systemPromptBase + (sv ? " ABSOLUT INGET UTANFÖR JSON." : " ABSOLUTELY NOTHING OUTSIDE JSON.")) : systemPromptBase;
    const userPrompt = buildUserPrompt({ stricter });

    let answer;
    try {
      answer = await env.AI.run(model, { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] });
    } catch (_) {
      answer = await env.AI.run("@cf/meta/llama-3-8b-instruct", { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] });
    }
    return answer;
  }

  function finalizeFromParsed(parsedObj) {
    const blocksIn =
      Array.isArray(parsedObj && parsedObj.blocks) ? parsedObj.blocks :
      Array.isArray(parsedObj && parsedObj.items) ? parsedObj.items :
      Array.isArray(parsedObj && parsedObj.children) ? parsedObj.children :
      [];

    const canonical = normalizeAiQuestionBlocksToCanonical(blocksIn, language, count);

    if (!canonical.length || canonical.length < count) {
      return {
        ok: false,
        errorCode: "AI_NO_QUESTIONS",
        message: sv ? "AI skapade inte tillräckligt med frågor i rätt format." : "AI did not create enough questions in the required format.",
        blocks: canonical
      };
    }

    const qv = validateTrainingQualityCanonical({ blocks: canonical, qSpec, language, questionType: qtForAi });
    if (!qv.ok) {
      return { ok: false, errorCode: qv.errorCode, message: qv.message, blocks: canonical };
    }

    return { ok: true, v: "training-blocks@v1", mode: "training", language, subjectId: effectiveSubjectId, blocks: canonical };
  }

  // TRY 1
  let answer = await runOnce(false);
  let parsed = parseTrainingAiAnswer(answer);
  if (parsed) {
    const out1 = finalizeFromParsed(parsed);
    if (out1 && out1.ok) return out1;
  }

  // TRY 2 (STRICTER)
  answer = await runOnce(true);
  parsed = parseTrainingAiAnswer(answer);
  if (!parsed) {
    // P0: deterministisk fallback (ingen 422)
    return buildTrainingBlocksDeterministicFallback(input, subjectSpec, bundle, qtForAi);
  }

  const out2 = finalizeFromParsed(parsed);
  if (out2 && out2.ok) return out2;

  // P0: fallback även vid quality-fail (fail-closed och stabilt)
  return buildTrainingBlocksDeterministicFallback(input, subjectSpec, bundle, qtForAi);
}

async function buildDocumentBlocksWithAI(input, env) {
  const mode = safeStr(input && input.mode).trim() || "document";
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextTextRaw = safeStr(input && (input.context || input.contextText)).trim();
  const subjectIdRaw = safeStr(input && input.subjectId).trim() || "generic";

  const bundle = parseContextBundle(contextTextRaw);
  const effectiveSubjectId = safeStr(subjectIdRaw || (bundle && bundle.subjectId) || "generic").trim() || "generic";
  const subjectSpec = await resolveSubjectSpecAsync(effectiveSubjectId, language, env);

  const courseInfo = fmtContextForPrompt(bundle, language);
  const sv = language === "sv";

  const minWords = Number(subjectSpec && subjectSpec.minWordsDoc) || 180;
  const heads = Array.isArray(subjectSpec && subjectSpec.requiredHeadings) ? subjectSpec.requiredHeadings : [];
  const bullets = Array.isArray(subjectSpec && subjectSpec.bullets) ? subjectSpec.bullets : [];
  const examples = Array.isArray(subjectSpec && subjectSpec.examples) ? subjectSpec.examples : [];
  const forbidden = Array.isArray(subjectSpec && subjectSpec.forbidden) ? subjectSpec.forbidden : [];

  const subjectHardFacts = [
    sv ? "ÄMNE (hårda krav):" : "SUBJECT (hard requirements):",
    `subjectId: ${subjectSpec.id}`,
    `${sv ? "Titel" : "Title"}: ${subjectSpec.label}`,
    `${sv ? "Minimilängd" : "Minimum length"}: ${minWords} ${sv ? "ord totalt" : "words total"}`,
    heads.length ? `${sv ? "Obligatoriska rubriker" : "Required headings"}: ${heads.join(" | ")}` : "",
    bullets.length ? `${sv ? "Punktkrav" : "Bullet requirements"}:\n- ${bullets.join("\n- ")}` : "",
    examples.length ? `${sv ? "Exempel att använda/efterlikna" : "Examples to use/imitate"}:\n- ${examples.join("\n- ")}` : "",
    forbidden.length ? `${sv ? "FÖRBJUDET i dokumentläge" : "FORBIDDEN in document mode"}: ${forbidden.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const schemaHint = sv
    ? `Returnera ENDAST giltig JSON. Inget markdown.
Schema:
{ "blocks": [ { "title": "string", "text": "string" } ] }
Regler:
- Exakt ${count} blocks.
- Total text minst ${minWords} ord.
- Använd rubriker och punktlistor.
- Inga provfrågor, inga svarsalternativ, ingen correctIndex, ingen quiz-struktur.`
    : `Return ONLY valid JSON. No markdown.
Schema:
{ "blocks": [ { "title": "string", "text": "string" } ] }
Rules:
- Exactly ${count} blocks.
- Total text at least ${minWords} words.
- Use headings and bullet lists.
- No quiz questions, no options, no correctIndex, no quiz structure.`;

  const systemPrompt = sv
    ? "Du skapar dokumentblock (infoblad) för HR-utbildning. Du får INTE skapa provfrågor här. Följ schema exakt."
    : "You create document blocks (info sheet) for HR training. You MUST NOT create quiz questions. Follow schema exactly.";

  const userPrompt =
    `${courseInfo}\n\n` +
    `${subjectHardFacts}\n\n` +
    (sv ? `LÄGE: ${mode.toUpperCase()} (dokument-innehåll)\n\n` : `MODE: ${mode.toUpperCase()} (document content)\n\n`) +
    (sv ? `KONTEKST (råtext):\n${contextTextRaw || "(ingen)"}\n\n` : `CONTEXT (raw):\n${contextTextRaw || "(none)"}\n\n`) +
    schemaHint;

  const model = safeStr(env && env.AI_MODEL).trim() || "@cf/meta/llama-3.1-8b-instruct";

  function containsForbidden(text, forbiddenList) {
    const t = safeStr(text).toLowerCase();
    for (const w of Array.isArray(forbiddenList) ? forbiddenList : []) {
      const ww = safeStr(w).toLowerCase().trim();
      if (!ww) continue;
      if (t.includes(ww)) return true;
    }
    return false;
  }

  async function runOnce(forceStricter) {
    const extra = forceStricter
      ? (sv
          ? "\n\nVIKTIGT: Svara utförligt. Minst 2 konkreta exempel. Använd rubriker och punktlistor."
          : "\n\nIMPORTANT: Answer in detail. At least 2 concrete examples. Use headings and bullet lists.")
      : "";

    let answer;
    try {
      answer = await env.AI.run(model, { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt + extra }] });
    } catch (_) {
      answer = await env.AI.run("@cf/meta/llama-3-8b-instruct", { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt + extra }] });
    }
    return answer;
  }

  function parseDocRows(ans) {
    const raw = isPlainObject(ans) ? (ans.response || ans.result || ans.output || ans.text || ans) : ans;
    const parsed0 = safeJsonFromUnknown(raw);
    const parsed = coerceParsedObjOrArray(parsed0);
    if (!parsed || !isPlainObject(parsed)) return null;

    const rows = Array.isArray(parsed.blocks) ? parsed.blocks : Array.isArray(parsed.sections) ? parsed.sections : null;
    if (!rows || !rows.length) return null;

    const blocks = [];
    for (let i = 0; i < rows.length && blocks.length < count; i++) {
      const r = rows[i];
      if (!r) continue;
      if (typeof r === "string") {
        const t = safeStr(r).trim();
        if (!t) continue;
        blocks.push(makeTextBlock({ i: blocks.length, title: "", text: t }));
        continue;
      }
      if (isPlainObject(r)) {
        const title = safeStr(r.title || r.heading || "").trim();
        const text = safeStr(r.text || r.body || r.content || "").trim();
        if (!text) continue;
        blocks.push(makeTextBlock({ i: blocks.length, title, text }));
      }
    }

    if (!blocks.length) return null;
    if (!ensureNoQuestionBlocks(blocks)) return null;

    while (blocks.length < count) {
      blocks.push(makeTextBlock({
        i: blocks.length,
        title: sv ? `Block ${blocks.length + 1}` : `Block ${blocks.length + 1}`,
        text: sv ? "Komplettera med dokumenttext kopplad till ämnet. Lägg till rubriker och exempel." : "Add document text tied to the subject. Add headings and examples."
      }));
    }

    return blocks.slice(0, count);
  }

  function validateAll(blocksToCheck) {
    const v = validateDocOutput({ language, subjectSpec, blocks: blocksToCheck });
    if (!v.ok) return v;

    const joined = joinDocBlocksText(blocksToCheck);
    if (forbidden.length && containsForbidden(joined, forbidden)) {
      return {
        ok: false,
        errorCode: "DOC_FORBIDDEN_CONTENT",
        message: sv ? "Infoblad innehöll förbjudet quiz-/facit-innehåll. Försök igen." : "Document contained forbidden quiz/answer-key content. Try again.",
      };
    }
    return { ok: true };
  }

  let answer = await runOnce(false);
  let blocks = parseDocRows(answer);
  if (!blocks) return null;

  let v = validateAll(blocks);
  if (!v.ok) {
    answer = await runOnce(true);
    blocks = parseDocRows(answer);
    if (!blocks) return null;
    v = validateAll(blocks);
    if (!v.ok) return null;
  }

  return { ok: true, v: "training-blocks@v1", mode, subjectId: effectiveSubjectId, language, blocks };
}

// ============================================================
// BLOCK 06 — Engine router (per mode)
// ============================================================

function stripInternal(obj) {
  if (!obj || !isPlainObject(obj)) return obj;
  const out = { ...obj };
  if ("__subjectSpec" in out) delete out.__subjectSpec;
  if ("__fallback" in out) delete out.__fallback;
  return out;
}

async function buildBlocksForMode(input, env) {
  const mode = safeStr(input && input.mode).trim() || "training";
  const hasAI = !!(env && env.AI && typeof env.AI.run === "function");

  if (mode === "training") {
    if (!hasAI) {
      const bundle = parseContextBundle(safeStr(input && (input.context || input.contextText)).trim());
      const subjectSpec = resolveSubjectSpec(safeStr(input && input.subjectId).trim() || (bundle && bundle.subjectId) || "generic", normalizeLanguage(input && input.language));
      return stripInternal(buildTrainingBlocksDeterministicFallback(input, subjectSpec, bundle, input && input.questionType));
    }
    const ai = await buildTrainingBlocksWithAI(input, env);
    return stripInternal(ai);
  }

  if (!hasAI) return buildDocumentBlocksDeterministic(input);

  try {
    const aiDoc = await buildDocumentBlocksWithAI(input, env);
    if (aiDoc && aiDoc.ok && Array.isArray(aiDoc.blocks) && aiDoc.blocks.length && ensureNoQuestionBlocks(aiDoc.blocks)) {
      const subjectSpec = await resolveSubjectSpecAsync(aiDoc.subjectId, aiDoc.language, env);
      const v = validateDocOutput({ language: aiDoc.language, subjectSpec, blocks: aiDoc.blocks });
      if (v.ok) return stripInternal(aiDoc);
    }
    return buildDocumentBlocksDeterministic(input);
  } catch (_) {
    return buildDocumentBlocksDeterministic(input);
  }
}

// ============================================================
// BLOCK 07 — Payload parsing (v1 tolerant)
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

  if (!count) return null;
  return { mode, count, language, contextText, format, subjectId, questionType, difficulty };
}

// ============================================================
// BLOCK 08 — Fetch handler (routing + guards)
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

    if (!aiEnabled) {
      return errorJSON(503, requestId, "AI_DISABLED", "AI_ENABLED=false (Workern är avstängd)", corsHeaders, true);
    }

    const v1 = parseV1RulesetPayload(body);
    const isV1 = !!v1;

    let modeRaw = safeStr(body.mode || body.type).trim();
    if (path === "/v1/ai/training") modeRaw = "training";
    if (path === "/v1/ai/document") modeRaw = "document";
    if (path === "/v1/ai/generate" && !modeRaw) modeRaw = "training";

    let mode = normalizeMode(modeRaw);
    let countRaw = body.count ?? body.n;
    let languageRaw = body.language || "sv";

    let contextText = normalizeContextText(body.context ?? body.prompt ?? body.contextText ?? "");

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

    if (isV1) {
      mode = v1.mode;
      format = v1.format;
      countRaw = v1.count;
      languageRaw = v1.language;
      questionType = v1.questionType;
      difficultyHint = v1.difficulty;
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

    // ============================================================
    // BUILD
    // ============================================================

    let training;
    let aiSource = "fallback";
    let aiReason = "OK";

    try {
      const hasBinding = !!(env && env.AI && typeof env.AI.run === "function");
      aiSource = hasBinding ? "cf" : "fallback";

      training = await buildBlocksForMode(
        { requestId, mode, count, language, context: contextText, format, subjectId, difficultyHint, questionType },
        env
      );

      aiReason = training && training.ok === false ? safeStr(training.errorCode || "FAIL") : "OK";
    } catch (e) {
      const msg = safeStr(e && (e.message || e.stack || String(e))).slice(0, 200);
      console.error("ERR", requestId, "WORKER_BUILD_FAILED");
      return errorJSON(502, requestId, "WORKER_BUILD_FAILED", msg || "Worker kunde inte bygga ett giltigt svar", corsHeaders, true);
    }

    if (!training || typeof training !== "object") {
      return errorJSON(502, requestId, "WORKER_BUILD_FAILED", "training är ogiltig (null/ej objekt)", corsHeaders, true);
    }

    const hdrBase = {
      ...(corsHeaders || {}),
      "X-HR-AI": aiSource === "cf" ? "cf" : "fallback",
      "X-HR-AI-REASON": safeStr(aiReason || "OK"),
    };

    if (training && training.ok === false) {
      const code = safeStr(training.errorCode || (training.error && training.error.code) || "AI_FAILED").trim() || "AI_FAILED";
      const msg =
        safeStr(training.message || (training.error && training.error.message) || "").trim() ||
        "AI kunde inte skapa ett giltigt svar.";
      return errorJSON(422, requestId, code, msg, hdrBase, true);
    }

    const topBlocks = Array.isArray(training.blocks) ? training.blocks : [];
    let items = topBlocks;

    if (mode === "training" && isUiQuestionRequest(questionType)) {
      const mapped = extractUiQuestionsForUi(training, topBlocks);
      if (!mapped.ok) {
        return errorJSON(422, requestId, mapped.errorCode, mapped.message, hdrBase, true);
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
        mode: training.mode || mode,
      },
      hdrBase,
      requestId
    );
  },
};
