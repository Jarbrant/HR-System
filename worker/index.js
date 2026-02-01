// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.6.6 SUBJECT+DOC LENGTH + NO-GOALS POLICY)
// FIL: worker/index.js
//
// PATCH v1.6.7 (SUBJECTS JSON-LINK + CACHE + ALLOWLIST):
// - P0: Kopplar subjectId -> ai-rules/v1/subjects/index.json + subjectSpec JSON (hr_policy, ethics, m.fl.) via RULES_BASE_URL.
// - P0: Fail-closed: om rules saknas/trasig -> fallback till inbyggd resolver (generic/feedback_samtal) utan crash.
// - P0: Allowlist: endast /ai-rules/v1/subjects/ tillåts laddas.
// - P1: Cache i minne (index + subjectSpec) för stabilitet/prestanda.
//
// Tidigare patchar bibehålls (v1.6.6 + v1.6.5 + v1.6.4 + v1.6.3):
// - P0: Skicka aldrig "Mål/goals" till AI (bort från prompt).
// - P0: Document/Mix får alltid text-block och valideras med minWords + sektioner.
// - P0: Subject resolver (minst feedback_samtal + generic) injiceras som hårda krav i doc/mix.
// - P1: Deterministic fallback för doc/mix blir utförlig (rubriker + exempel), inte 2 rader.
// - P0: Document/Mix får inte “råka bli provfrågor” → UI slutar stoppa import.
// - P0: mode="document" ger alltid text-block (aldrig question-block).
// - P0: mode="mix" ger också text-block (aldrig question-block) för stabilitet nu.
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
// BLOCK 01B — UI question helpers (INLINE HOTFIX)  [PATCH v1.6.7a]
// Syfte: UI ska få frågor även om AI/engine svarar i annan "shape".
// - Accepterar redan färdiga items[]
// - Accepterar blocks[] i flera varianter (kind/type/items/data)
// - Fail-closed: gissar aldrig facit om det saknas (men om ingen info finns alls: default 0 som tidigare)
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

// ---------- Helpers: normalisera UI-item-shape ----------
function isNonEmptyStr(s){ return !!safeStr(s).trim(); }

function normalizeUiQuestionItem(raw) {
  // Acceptera:
  // 1) {type:'question', question:'', options:[], correctIndex, explanation}
  // 2) {type:'question', data:{question:'', options:[]...}}
  // 3) {question:'', options:[]} (utan type)
  // 4) {question:{text,...}, choices:[{text}], correctChoiceId} (AI block-shape)
  if (!raw) return null;

  let x = raw;
  if (isPlainObject(x) && isPlainObject(x.data)) x = x.data;

  // Flat UI-shape
  const qText = safeStr(x.question || x.q || "").trim();
  const opts = Array.isArray(x.options) ? x.options : Array.isArray(x.choices) ? x.choices.map(c=> (isPlainObject(c)? c.text : c)) : [];
  const options = opts.map(v => safeStr(v).trim()).filter(Boolean);

  // Alternate AI-ish shape (question object)
  if ((!qText || options.length < 2) && isPlainObject(x.question)) {
    const qq = x.question;
    const stem = safeStr(qq.text || qq.question || "").trim();
    const ch = Array.isArray(qq.choices) ? qq.choices : [];
    const oo = ch.map(c => safeStr(c && c.text).trim()).filter(Boolean);

    if (!stem || oo.length < 2) return null;

    // Facit från choiceId/ids om de finns
    let correctIndex = -1;
    let correctIndices = null;

    const correctChoiceId = safeStr(qq.correctChoiceId).trim();
    if (correctChoiceId) {
      const idx = ch.findIndex(c => safeStr(c && c.id).trim() === correctChoiceId);
      if (idx >= 0) correctIndex = idx;
    }

    const ids = Array.isArray(qq.correctChoiceIds) ? qq.correctChoiceIds : null;
    if (ids && ids.length) {
      const mapped = ids
        .map(id => ch.findIndex(c => safeStr(c && c.id).trim() === safeStr(id).trim()))
        .filter(n => Number.isInteger(n) && n >= 0);
      if (mapped.length) correctIndices = mapped;
    }

    // Fail-closed: gissa inte facit om helt okänt — men tidigare policy satte 0.
    if (correctIndex < 0 && (!correctIndices || !correctIndices.length)) correctIndex = 0;

    const explanation = safeStr(qq.rationale || qq.explanation || qq.feedback || "").trim();

    return {
      type: "question",
      question: stem,
      options: oo,
      correctIndex,
      ...(correctIndices ? { correctIndices } : {}),
      ...(explanation ? { explanation } : {}),
    };
  }

  // Flat fall
  if (!qText || options.length < 2) return null;

  let correctIndex = Number.isFinite(Number(x.correctIndex)) ? Number(x.correctIndex) : -1;
  const correctIndices = Array.isArray(x.correctIndices) ? x.correctIndices.filter(n => Number.isInteger(n) && n >= 0) : null;

  if (correctIndex < 0 && (!correctIndices || !correctIndices.length)) correctIndex = 0;

  const explanation = safeStr(x.explanation || x.rationale || x.feedback || "").trim();

  return {
    type: "question",
    question: qText,
    options,
    correctIndex,
    ...(correctIndices && correctIndices.length ? { correctIndices } : {}),
    ...(explanation ? { explanation } : {}),
  };
}

function extractUiQuestionsFromAnyContainer(container) {
  // Letar efter items[] på flera ställen:
  // - container.items
  // - container.data.items
  // - container.training.items
  // - container.data.training.items
  const candidates = [];

  try{
    if (isPlainObject(container) && Array.isArray(container.items)) candidates.push(container.items);
    if (isPlainObject(container) && isPlainObject(container.data) && Array.isArray(container.data.items)) candidates.push(container.data.items);
    if (isPlainObject(container) && isPlainObject(container.training) && Array.isArray(container.training.items)) candidates.push(container.training.items);
    if (isPlainObject(container) && isPlainObject(container.data) && isPlainObject(container.data.training) && Array.isArray(container.data.training.items)) candidates.push(container.data.training.items);
  }catch(_){}

  for (const arr of candidates) {
    const out = [];
    for (const it of Array.isArray(arr) ? arr : []) {
      const norm = normalizeUiQuestionItem(it);
      if (norm) out.push(norm);
    }
    if (out.length) return out;
  }
  return [];
}

function mapTrainingBlocksToUiQuestions(blocks) {
  // Utökat stöd: blocks kan ha:
  // - kind:"question" + items:[{type:"questionInline", question:{...}}]
  // - type:"question" + question/options direkt
  // - kind:"question" + items:[{type:"question", ...}] (flat)
  // - block.data.{...}
  const out = [];
  const arr = Array.isArray(blocks) ? blocks : [];

  for (const b0 of arr) {
    if (!b0) continue;
    const b = (isPlainObject(b0) && isPlainObject(b0.data)) ? b0.data : b0;

    const kind = safeStr(b.kind || b.type || "").trim().toLowerCase();

    // 1) Om blocket självt ser ut som en UI-question
    const asItem = normalizeUiQuestionItem(b);
    if (asItem && (kind === "question" || kind === "mcq" || kind === "quiz" || kind === "")) {
      out.push(asItem);
      continue;
    }

    // 2) Items inuti blocket
    const items = Array.isArray(b.items) ? b.items : [];
    // A) klassisk questionInline
    const qi = items.find(x => x && x.type === "questionInline" && isPlainObject(x.question));
    if (qi && qi.question) {
      const norm = normalizeUiQuestionItem({ question: qi.question });
      if (norm) out.push(norm);
      continue;
    }
    // B) flat items som redan är question
    for (const it of items) {
      const norm = normalizeUiQuestionItem(it);
      if (norm) out.push(norm);
    }
  }

  if (!out.length) {
    return { ok: false, errorCode: "UI_NO_QUESTIONS", message: "Inga question-block hittades att mappa till UI-frågor" };
  }

  return { ok: true, items: out };
}

// Huvudfunktion: försök items[] först, annars blocks-mappning
function extractUiQuestionsForUi(trainingObj, blocksArr) {
  const fromItems = extractUiQuestionsFromAnyContainer(trainingObj);
  if (fromItems.length) return { ok: true, items: fromItems };
  return mapTrainingBlocksToUiQuestions(blocksArr);
}

// ============================================================
// BLOCK 02 — Constants
// ============================================================

export const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.6.7";

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

  // P0 POLICY: Skicka aldrig "Mål/goals" till AI → tas bort från prompten
  // (bundle.goals används endast lokalt/visuellt i UI, inte i AI-anrop)

  return lines.join("\n");
}

// ============================================================
// BLOCK 02F — Subject “hjärna” + doc krav (Steg 1)
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

// ------------------------------------------------------------
// SUBJECT JSON LINK (P0) — via RULES_BASE_URL + allowlist + cache
// ------------------------------------------------------------

// Cache i minnet (per worker-instance)
let __SUBJECT_INDEX_CACHE = null; // { ts:number, map: Record<string,string> }
let __SUBJECT_SPEC_CACHE = new Map(); // id|lang -> { ts:number, spec:object }
const __RULES_CACHE_TTL_MS = 5 * 60 * 1000;

function __now() {
  return Date.now();
}

function __getRulesBaseUrl(env) {
  // POLICY: inga krav på env — om saknas, faller vi tillbaka till inbyggd resolver.
  const raw = safeStr(env && (env.RULES_BASE_URL || env.RULES_BASE || env.AI_RULES_BASE_URL)).trim();
  const base = normalizeOrigin(raw);
  if (!base) return "";
  // enkel sanity: endast https
  if (!/^https:\/\//i.test(base)) return "";
  return base;
}

function __safeJoinUrl(base, path) {
  const b = normalizeOrigin(base);
  const p = safeStr(path).trim();
  if (!b || !p) return "";
  if (p.startsWith("http://") || p.startsWith("https://")) return ""; // P0: ingen full URL från index
  const clean = p.replace(/^\/+/, "");
  return `${b}/${clean}`;
}

function __isAllowedSubjectsPath(path) {
  const p = safeStr(path).trim().replace(/\\/g, "/");
  if (!p) return false;
  // tillåt endast under ai-rules/v1/subjects/
  if (!p.startsWith("ai-rules/v1/subjects/")) return false;
  // skydd mot path traversal
  if (p.includes("..")) return false;
  // kräver json
  if (!p.toLowerCase().endsWith(".json")) return false;
  return true;
}

function __normalizeSubjectSpec(specRaw, language, fallbackId) {
  const sv = language === "sv";
  const s = isPlainObject(specRaw) ? specRaw : {};
  const id = safeStr(s.id || s.subjectId || fallbackId || "generic").trim() || "generic";
  const label = safeStr(s.label || s.title || (sv ? "Ämne" : "Subject")).trim() || (sv ? "Ämne" : "Subject");
  const minWordsDoc = Number(s.minWordsDoc ?? s.minWords ?? s.minWordsDocument);
  const requiredHeadings = Array.isArray(s.requiredHeadings) ? s.requiredHeadings : Array.isArray(s.headings) ? s.headings : [];
  const bullets = Array.isArray(s.bullets) ? s.bullets : [];
  const examples = Array.isArray(s.examples) ? s.examples : [];
  const forbidden = Array.isArray(s.forbidden) ? s.forbidden : [];

  return {
    id,
    label,
    minWordsDoc: Number.isFinite(minWordsDoc) && minWordsDoc > 0 ? Math.floor(minWordsDoc) : 180,
    requiredHeadings: requiredHeadings.map((x) => safeStr(x).trim()).filter(Boolean),
    bullets: bullets.map((x) => safeStr(x).trim()).filter(Boolean),
    examples: examples.map((x) => safeStr(x).trim()).filter(Boolean),
    forbidden: forbidden.map((x) => safeStr(x).trim()).filter(Boolean),
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

    // Tolerant shapes:
    // 1) { subjects:[ {id, file}, ... ] }
    // 2) { byId:{ id:"ai-rules/v1/subjects/x.json" } }
    // 3) { id:"ai-rules/v1/subjects/x.json", ... } (flat map)
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

async function resolveSubjectSpecAsync(subjectIdRaw, language, env) {
  const sv = language === "sv";
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
      } catch (_) {
        // fallthrough -> builtin
      }
    }
  }

  // fail-closed fallback
  const builtin = resolveSubjectSpec(id, language);
  __SUBJECT_SPEC_CACHE.set(cacheKey, { ts: t, spec: builtin });
  return builtin;
}

function resolveSubjectSpec(subjectIdRaw, language) {
  const sv = language === "sv";
  const id = safeStr(subjectIdRaw).trim() || "generic";

  // Inbyggda min-specs (livlina).
  const specs = {
    generic: {
      id: "generic",
      label: sv ? "Generellt" : "Generic",
      minWordsDoc: 180,
      requiredHeadings: sv ? ["Varför", "Så gör ni", "Exempel", "Mini-checklista", "Kom ihåg"] : ["Why", "How to", "Examples", "Mini checklist", "Remember"],
      bullets: sv
        ? [
            "Skriv sakligt och konkret.",
            "Använd rubriker och punktlistor.",
            "Ge minst 2 exempel från vardagen.",
            "Undvik provfrågor, facit och quiz-format i dokumentläge.",
          ]
        : ["Write clearly and concretely.", "Use headings and bullet lists.", "Include at least 2 real-world examples.", "Avoid quiz structures in document mode."],
      examples: sv
        ? [
            "Exempel: Du ska ge feedback efter ett arbetspass – börja med fakta, inte antaganden.",
            "Exempel: I ett samtal om avvikelse – be om underlag och kom överens om nästa steg.",
          ]
        : ["Example: Give feedback after a shift—start with facts, not assumptions.", "Example: In a deviation talk—ask for evidence and agree on next steps."],
      forbidden: sv ? ["Provfrågor", "Svarsalternativ", "correctIndex", "quiz", "facit"] : ["Quiz questions", "Answer options", "correctIndex", "quiz", "answer key"],
    },

    feedback_samtal: {
      id: "feedback_samtal",
      label: sv ? "Feedback & samtal" : "Feedback & conversations",
      minWordsDoc: 220,
      requiredHeadings: sv
        ? ["Varför finns det här", "Vad menar vi med", "Så gör ni", "Exempel", "Mini-checklista", "Vanliga fallgropar"]
        : ["Why this exists", "What we mean by", "How to do it", "Examples", "Mini checklist", "Common pitfalls"],
      bullets: sv
        ? [
            "Utgå från konkreta observationer (fakta), inte tolkningar.",
            "Var tydlig med syfte: utveckling, kvalitet, trygghet – inte kritik.",
            "Lyssna aktivt: spegla, sammanfatta, stäm av.",
            "Avsluta alltid med nästa steg: vem gör vad, när följer ni upp.",
            "Dokumentera kort om det behövs: datum, fakta, beslut, uppföljning.",
          ]
        : [
            "Start from concrete observations (facts), not interpretations.",
            "Be clear on the purpose: development, quality, safety—not criticism.",
            "Listen actively: reflect, summarize, confirm.",
            "Always end with next steps: who does what, follow-up time.",
            "Document briefly if needed: date, facts, decisions, follow-up.",
          ],
      examples: sv
        ? [
            "Exempel 1 (kort feedback): “Jag såg att checklistan inte signerades i dag. Hur blev det så? Vad behöver du för att det ska fungera i morgon?”",
            "Exempel 2 (svårt samtal): “När vi saknar underlag blir beslut osäkra. Jag vill att vi hittar en rutin som funkar för dig och teamet.”",
            "Exempel 3 (uppföljning): “Vi testar lösning X i en vecka. På fredag stämmer vi av vad som fungerade och vad som behöver justeras.”",
          ]
        : [
            "Example 1 (quick feedback): “I noticed the checklist wasn’t signed today. What happened? What do you need for it to work tomorrow?”",
            "Example 2 (hard talk): “Without evidence, decisions become unsafe. Let’s find a routine that works for you and the team.”",
            "Example 3 (follow-up): “We try solution X for one week, then review what worked and adjust.”",
          ],
      forbidden: sv ? ["Provfrågor", "Svarsalternativ", "correctIndex", "quiz", "facit", "rätta svar"] : ["Quiz questions", "Answer options", "correctIndex", "quiz", "answer key"],
    },
  };

  return specs[id] || specs.generic;
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
        // P0: validate doc length/sections (fail-closed)
        const subjectSpec = aiDoc && aiDoc.__subjectSpec ? aiDoc.__subjectSpec : resolveSubjectSpec(aiDoc.subjectId, aiDoc.language);
        const v = validateDocOutput({ language: aiDoc.language, subjectSpec, blocks: aiDoc.blocks });
        if (v.ok) {
          const clean = { ...aiDoc };
          delete clean.__subjectSpec;
          return { training: clean, source: "cf", reason: "OK" };
        }
        // fail-closed → fallback utförligt
        return { training: buildDocumentBlocksDeterministic(input), source: "fallback", reason: v.errorCode || "DOC_VALIDATE_FAIL" };
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
// BLOCK 10 — ENGINE (A + B + C)
// Syfte:
// - Dokument/Mix: AI om möjligt, annars reservtext
// - Frågor & svar (training): STRIKT AI (ingen hårdkodad reservfråga)
// - Robust: aldrig "not defined" igen i denna del
// ============================================================



// ============================================================
// BLOCK 10A — DOCUMENT/MIX ENGINE (CF-AI + fallback text blocks)
// PATCH: tolerant parse (array/object) + forbidden-check i validering
// ============================================================

async function buildDocumentBlocksWithAI(input, env) {
  const requestId = safeStr(input && input.requestId).trim();
  const mode = safeStr(input && input.mode).trim() || "document"; // document|mix
  const count = Math.max(1, Math.min(12, Number(input && input.count) || 1));
  const language = normalizeLanguage(input && input.language);
  const contextTextRaw = safeStr(input && (input.context || input.contextText)).trim();
  const subjectIdRaw = safeStr(input && input.subjectId).trim() || "generic";

  const bundle = parseContextBundle(contextTextRaw);
  const effectiveSubjectId = safeStr(subjectIdRaw || (bundle && bundle.subjectId) || "generic").trim() || "generic";

  // P0: subjectSpec från ai-rules/v1/subjects/* (om RULES_BASE_URL finns), annars inbyggd fallback
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
  ]
    .filter(Boolean)
    .join("\n");

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
- Total text (alla blocks ihop) ska vara minst ${minWords} ord.
- Använd tydliga rubriker/sektioner (minst någon av: ${heads.slice(0, 6).join(" / ")}).
- Varje block ska vara ren dokumenttext (infoblad), inte frågor.
- Inga svarsalternativ, ingen correctIndex, inga "quiz"-fält.
- Undvik meta-texter. Skriv användbart och konkret.`
    : `Return ONLY valid JSON. No markdown, no extra lines. JSON must start with "{" and end with "}".
Schema:
{
  "blocks": [
    { "title": "string", "text": "string" }
  ]
}
Rules (very important):
- Exactly ${count} blocks.
- Total text (all blocks combined) must be at least ${minWords} words.
- Use clear headings/sections (at least one of: ${heads.slice(0, 6).join(" / ")}).
- Each block is plain document text, not questions.
- No options, no correctIndex, no quiz fields.
- No meta text. Make it concrete and usable.`;

  const systemPrompt = sv
    ? `Du skapar dokumentblock (infoblad) för HR-utbildning. Du får INTE skapa provfrågor här. Följ JSON-schemat exakt.`
    : `You create document blocks (info sheet) for HR training. You MUST NOT create quiz questions. Follow the JSON schema exactly.`;

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
      ? sv
        ? `\n\nVIKTIGT: Om du svarar för kort kommer svaret att avvisas. Gör texten utförlig med rubriker + punktlistor + minst 2 konkreta exempel.`
        : `\n\nIMPORTANT: If you answer too short, it will be rejected. Make it detailed with headings + bullets + at least 2 concrete examples.`
      : "";

    let answer;
    try {
      answer = await env.AI.run(model, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt + extra },
        ],
      });
    } catch (_) {
      answer = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt + extra },
        ],
      });
    }
    return answer;
  }

  // försök 1
  let answer = await runOnce(false);

  function coerceParsedShape(parsed) {
    // Tolerera att modellen råkar returnera en array som top-level
    if (Array.isArray(parsed)) return { blocks: parsed };
    if (isPlainObject(parsed)) return parsed;
    return null;
  }

  function parseToBlocks(ans) {
    const raw = isPlainObject(ans) ? ans.response || ans.result || ans.output || ans.text || ans : ans;

    // safeJsonFromUnknown kan returnera object/array
    const parsed0 = safeJsonFromUnknown(raw);
    const parsed = coerceParsedShape(parsed0);
    if (!parsed) return null;

    // parseDocAiPayload accepterar {blocks:[...]} eller {sections:[...]} eller {text:"..."}
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
    if (!ensureNoQuestionBlocks(blocks)) return null;

    // toppa upp om AI gav färre
    while (blocks.length < count) {
      blocks.push(
        makeTextBlock({
          i: blocks.length,
          title: sv ? `Block ${blocks.length + 1}` : `Block ${blocks.length + 1}`,
          text: sv
            ? "Komplettera med tydlig dokumenttext kopplad till ämneskrav och kursinfo. Använd rubriker och exempel."
            : "Add clear document text tied to subject requirements and course info. Use headings and examples.",
        })
      );
    }

    return blocks.slice(0, count);
  }

  let blocks = parseToBlocks(answer);

  function validateAll(blocksToCheck) {
    const v = validateDocOutput({ language, subjectSpec, blocks: blocksToCheck });
    if (!v.ok) return v;

    // Extra skydd: förbjudna quiz-ord/fields får inte förekomma i dokumenttext
    const joined = joinDocBlocksText(blocksToCheck);
    if (forbidden.length && containsForbidden(joined, forbidden)) {
      return {
        ok: false,
        errorCode: "DOC_FORBIDDEN_CONTENT",
        message: sv
          ? "Infoblad råkade innehålla förbjudet quiz-/facit-innehåll. Försök igen."
          : "Document contained forbidden quiz/answer-key content. Try again.",
      };
    }

    return { ok: true };
  }

  // validera
  if (blocks) {
    const v = validateAll(blocks);
    if (!v.ok) {
      // försök 2 (hårdare)
      answer = await runOnce(true);
      blocks = parseToBlocks(answer);
      if (blocks) {
        const v2 = validateAll(blocks);
        if (!v2.ok) return null; // fail-closed → caller fallback
      } else {
        return null;
      }
    }
  } else {
    return null;
  }

  return {
    ok: true,
    v: "training-blocks@v1",
    mode,
    subjectId: effectiveSubjectId,
    language,
    blocks,
    __subjectSpec: subjectSpec, // intern (tas bort vid return)
  };
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
        ? `Detta infoblad hjälper er att genomföra samtal som leder till utveckling och trygghet, inte osäkerhet. Koppla alltid till fakta och till vad ni vill uppnå i verksamheten (${ctx}).\n\n`
        : `This info sheet helps you run conversations that lead to development and safety, not uncertainty. Always tie it to facts and the purpose in your workplace (${ctx}).\n\n`) +
      `${h2}\n` +
      `- ${b.slice(0, 5).join("\n- ")}\n\n` +
      `${h3}\n` +
      `- ${ex.slice(0, 3).join("\n- ")}\n\n` +
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
// BLOCK 10B — TRAINING (FRÅGOR & SVAR) — STRIKT AI
// Viktigt: ingen hårdkodad reservfråga, men vi ger ett tydligt "stopp-svar"
// så det aldrig kraschar med "not defined".
// ============================================================

// Denna fanns inte i din fil (därför fick du "not defined").
// Vi gör den definierad, men den skapar INTE frågor.
function buildTrainingBlocksDeterministic(input) {
  const language = normalizeLanguage(input && input.language);
  const sv = language === "sv";
  const msg = sv
    ? "AI kunde inte skapa frågor just nu. Försök igen."
    : "AI could not generate questions right now. Please try again.";

  return {
    ok: false,
    v: "training-blocks@v1",
    mode: "training",
    errorCode: "STRICT_AI_NO_FALLBACK",
    message: msg,
    blocks: [],
  };
}

async function buildTrainingBlocksStrictAI(input, env) {
  const hasAI = !!(env && env.AI && typeof env.AI.run === "function");

  // AI saknas => tydligt stopp-svar (ingen reservfråga)
  if (!hasAI) return buildTrainingBlocksDeterministic(input);

  // Försök AI
  const ai = await buildTrainingBlocksWithAI(input, env);

  // OK => AI-blocks
  if (ai && ai.ok && Array.isArray(ai.blocks) && ai.blocks.length) return ai;

  // AI gav fel/konstigt => tydligt stopp-svar (ingen reservfråga)
  return buildTrainingBlocksDeterministic(input);
}



// ============================================================
// BLOCK 10C — ROUTER (väljer motor per läge)
// - training => STRIKT AI (frågor)
// - document/mix => AI om möjligt, annars reservtext
// ============================================================

function stripInternalSubjectSpec(obj) {
  if (!obj || !isPlainObject(obj)) return obj;
  const out = { ...obj };
  if ("__subjectSpec" in out) delete out.__subjectSpec;
  return out;
}

async function buildBlocksForMode(input, env) {
  const mode = safeStr(input && input.mode).trim() || "training";

  // Frågor & svar
  if (mode === "training") {
    return stripInternalSubjectSpec(await buildTrainingBlocksStrictAI(input, env));
  }

  // Dokument/Mix
  const hasAI = !!(env && env.AI && typeof env.AI.run === "function");
  if (!hasAI) return stripInternalSubjectSpec(buildDocumentBlocksDeterministic(input));

  try {
    const aiDoc = await buildDocumentBlocksWithAI(input, env);
    if (aiDoc && aiDoc.ok && Array.isArray(aiDoc.blocks) && aiDoc.blocks.length && ensureNoQuestionBlocks(aiDoc.blocks)) {
      return stripInternalSubjectSpec(aiDoc);
    }
    return stripInternalSubjectSpec(buildDocumentBlocksDeterministic(input));
  } catch (_) {
    return stripInternalSubjectSpec(buildDocumentBlocksDeterministic(input));
  }
}
