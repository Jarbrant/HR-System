// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01
// FIL: worker/question-ui.js
//
// Syfte:
// - UI-frågeformat (items[]) för provfrågor: options + correctIndex/correctIndices
// - Stabil normalisering av questionType ("auto", mcq, tf, etc.)
// - Fail-closed: om batchen inte kan mappas 1:1 -> returnera fel (index.js hanterar)
// - Inga env/request/Response här (ren mapping)
//
// Policy (LÅST):
// - Stateless, deterministisk, inga sid-effekter
// - XSS-safe: endast textdata (ingen HTML)
// ============================================================

import { safeStr, isPlainObject } from "./utils.js";

// ------------------------------------------------------------
// P0: Domänord får inte läcka i Q-fältet (extra skydd även här)
// ------------------------------------------------------------
export function stripDomainWordsFromQuestion(s, language) {
  const txt = safeStr(s);
  if (!txt) return txt;

  const reSv = /\b(steg|steget|modul|modulen|kapitel|kapitlet|kurs|kursen|utbildning|utbildningen)\b/gi;
  const reEn = /\b(step|module|chapter|course|training)\b/gi;

  const out = txt
    .replace(reSv, "")
    .replace(reEn, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!out) {
    return (language === "sv")
      ? "Vilket val är bäst i situationen?"
      : "Which choice is best in this situation?";
  }
  return out;
}

// ============================================================
// UI questionType normalization
// ============================================================

export function normalizeQuestionType(v) {
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

  // Om okänt: returnera tomt så att vi inte råkar “låsa fast” i konstiga lägen.
  return "";
}

// P0: "auto" räknas som UI-frågeläge och ska ge items[]-output.
export function isUiQuestionRequest(questionType) {
  const qt = normalizeQuestionType(questionType);
  return qt === "auto" || qt === "mcq_single" || qt === "mcq_multi" || qt === "true_false";
}

// ============================================================
// Mapping: training-blocks (question blocks) -> UI items[]
// ============================================================

export function mapTrainingBlocksToUiQuestions(trainingBlocks, questionType, language) {
  const qt0 = normalizeQuestionType(questionType);
  const qt = (qt0 === "auto") ? "mcq_single" : qt0; // stabil default

  const blocks = Array.isArray(trainingBlocks) ? trainingBlocks : [];
  const out = [];

  for (const b of blocks) {
    if (!b || b.kind !== "question") continue;
    const q = extractQuestionFromBlock(b);
    if (!q.ok) continue;

    const mapped = mapChoiceQuestionToUi(q.question, qt, language);
    if (mapped.ok) out.push(mapped.item);
  }

  // Fail-closed: mappningen ska vara 1:1 för question-blocks
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

export function extractQuestionFromBlock(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  for (const it of items) {
    if (it && it.type === "questionInline" && isPlainObject(it.question)) {
      return { ok: true, question: it.question };
    }
  }
  return { ok: false };
}

export function mapChoiceQuestionToUi(q, questionType, language) {
  const question = stripDomainWordsFromQuestion(safeStr(q && q.text).trim(), language);

  const rawChoices = Array.isArray(q && q.choices) ? q.choices : [];
  if (!question || rawChoices.length < 2) return { ok: false };

  // Bygg en “rensad” lista där vi behåller id + text (och drop:ar tomma texter)
  const clean = [];
  for (const c of rawChoices) {
    const id = safeStr(c && c.id).trim();
    const text = safeStr(c && c.text).trim();
    if (!id || !text) continue;
    clean.push({ id, text });
  }

  // Minst 2 riktiga alternativ krävs
  if (clean.length < 2) return { ok: false };

  const options = clean.map(x => x.text);

  let explanation = safeStr(q && (q.rationale || q.explanation || q.feedback || "")).trim();
  explanation = stripDomainWordsFromQuestion(explanation, language);

  const difficulty = safeStr(q && q.difficulty).trim() || undefined;
  const tags = Array.isArray(q && q.tags) ? q.tags.slice(0, 8) : undefined;

  // Hjälpare: hitta index i “clean”
  const idxById = (id) => {
    const s = safeStr(id).trim();
    if (!s) return -1;
    for (let i = 0; i < clean.length; i++) {
      if (clean[i].id === s) return i;
    }
    return -1;
  };

  if (questionType === "true_false") {
    // UI vill alltid ha exakt [Sant/Falskt] (sv) eller [True/False] (en)
    const a = (language === "sv") ? "Sant" : "True";
    const b = (language === "sv") ? "Falskt" : "False";

    const correctId = safeStr(q && q.correctChoiceId).trim();
    let idx = idxById(correctId);

    // Om det inte går att avgöra: default 0 (fail-soft här, men fortfarande ett giltigt item)
    if (idx < 0) idx = 0;
    // UI har bara 2 val i TF-läget
    const correctIndex = (idx === 1) ? 1 : 0;

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
    const correctId = safeStr(q && q.correctChoiceId).trim();
    const idx = idxById(correctId);
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
    const ids = Array.isArray(q && q.correctChoiceIds) ? q.correctChoiceIds : [];
    const indices = [];

    for (const id of ids) {
      const idx = idxById(id);
      if (idx >= 0 && idx < options.length && !indices.includes(idx)) indices.push(idx);
    }

    // Fallback: om correctChoiceIds saknas, prova correctChoiceId
    if (indices.length === 0) {
      const correctId = safeStr(q && q.correctChoiceId).trim();
      const idx = idxById(correctId);
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

// Legacy export (kan vara användbar i andra delar)
export function indexOfChoiceId(choices, id) {
  if (!id) return -1;
  const arr = Array.isArray(choices) ? choices : [];
  for (let i = 0; i < arr.length; i++) {
    if (safeStr(arr[i] && arr[i].id).trim() === safeStr(id).trim()) return i;
  }
  return -1;
}
