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

  const out = txt.replace(reSv, "").replace(reEn, "").replace(/\s{2,}/g, " ").trim();
  if (!out) {
    return (language === "sv") ? "Vilket val är bäst i situationen?" : "Which choice is best in this situation?";
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

  return raw;
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

  // Fail-closed: mappningen ska vara 1:1
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

  const choices = Array.isArray(q && q.choices) ? q.choices : [];
  if (!question || choices.length < 2) return { ok: false };

  const options = [];
  for (const c of choices) {
    const t0 = safeStr(c && c.text).trim();
    if (t0) options.push(t0);
  }
  if (options.length < 2) return { ok: false };

  let explanation = safeStr(q && (q.rationale || q.explanation || q.feedback || "")).trim();
  explanation = stripDomainWordsFromQuestion(explanation, language);

  const difficulty = safeStr(q && q.difficulty).trim() || undefined;
  const tags = Array.isArray(q && q.tags) ? q.tags.slice(0, 8) : undefined;

  if (questionType === "true_false") {
    const a = (language === "sv") ? "Sant" : "True";
    const b = (language === "sv") ? "Falskt" : "False";
    const correctId = safeStr(q && q.correctChoiceId).trim();
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
    const correctId = safeStr(q && q.correctChoiceId).trim();
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
    const ids = Array.isArray(q && q.correctChoiceIds) ? q.correctChoiceIds : [];
    const indices = [];
    for (const id of ids) {
      const idx = indexOfChoiceId(choices, safeStr(id).trim());
      if (idx >= 0 && idx < options.length && !indices.includes(idx)) indices.push(idx);
    }
    if (indices.length === 0) {
      const correctId = safeStr(q && q.correctChoiceId).trim();
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

export function indexOfChoiceId(choices, id) {
  if (!id) return -1;
  for (let i = 0; i < choices.length; i++) {
    if (safeStr(choices[i] && choices[i].id).trim() === id) return i;
  }
  return -1;
}
