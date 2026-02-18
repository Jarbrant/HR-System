// ============================================================
// AO-WORKER-TRAINING-BLOCKS-01 | worker/rules.js
// Syfte: Rules bundle + quality config + text/dup helpers (flytt från worker/index.js BLOCK 09)
// POLICY: No behavior change. Inga sid-effekter.
// ============================================================

import INDEX from "../ai-rules/index.json";
import GLOBAL from "../ai-rules/v1/global.json";
import MODULES from "../ai-rules/v1/modules.json";

import SWEDISH from "../ai-rules/v1/subjects/swedish.json";
import MATH from "../ai-rules/v1/subjects/math.json";
import GENERIC from "../ai-rules/v1/subjects/generic.json";

import QUESTION_FORMAT from "../ai-rules/v1/formats/question.json";
import TASK_FORMAT from "../ai-rules/v1/formats/task.json";
import TRAINING_BLOCKS_FORMAT from "../ai-rules/v1/formats/training-blocks.json";

// ruleset för kvalitet
import TRAINING_PROMPT from "../ai-rules/v1/rulesets/training_prompt.json";

// ----------------- tiny utils (lokalt) -----------------
export function safeStr(v) {
  return (v === null || v === undefined) ? "" : String(v);
}
export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function safeArr(a) {
  return Array.isArray(a) ? a : [];
}

// re-export HTTP helpers so downstream files can do: import { okJSON, errorJSON } from "../rules.js"
export { okJSON, errorJSON } from "./http.js";

// ============================================================
// Rules bundle + quality
// ============================================================

export function getRulesBundle(subjectIdNormalized) {
  const s = safeStr(subjectIdNormalized).toLowerCase().trim();
  const subj =
    (s === "math") ? (MATH || {}) :
      (s === "swedish") ? (SWEDISH || {}) :
        (s === "generic") ? (GENERIC || {}) :
          (GENERIC || {});

  return {
    index: INDEX || {},
    global: GLOBAL || {},
    modules: MODULES || {},
    subject: subj,
    rulesets: {
      training_prompt: TRAINING_PROMPT || {}
    },
    formats: {
      question: QUESTION_FORMAT || {},
      task: TASK_FORMAT || {},
      "training-blocks": TRAINING_BLOCKS_FORMAT || {}
    }
  };
}

export function getQuestionQuality(bundle) {
  const qp = bundle && bundle.rulesets && bundle.rulesets.training_prompt;
  const q = (qp && qp.questionQuality) ? qp.questionQuality : null;

  const forbiddenPhrases = safeArr(q && q.general && q.general.forbiddenPhrases).filter(Boolean);
  const forbidContextPlaceholderText = !!(q && q.general && q.general.forbidContextPlaceholderText);
  const requireExplanation = !!(q && q.general && q.general.requireExplanation);
  const explanationMinChars = Number(q && q.general && q.general.explanationMinChars) || 40;

  const nearDupThreshold = Number(q && q.general && q.general.batchUniqueness && q.general.batchUniqueness.forbidNearDuplicateThreshold);
  const forbidNearDuplicateThreshold = Number.isFinite(nearDupThreshold) ? nearDupThreshold : 0.85;

  const rotateDims = safeArr(q && q.general && q.general.variationPlan && q.general.variationPlan.rotateDimensions).filter(Boolean);
  const minDistinctDims = Number(q && q.general && q.general.variationPlan && q.general.variationPlan.minimumDistinctDimensionsInBatch) || 3;

  const minOptions = Number(q && q.mcq && q.mcq.minOptions) || 4;
  const maxOptions = Number(q && q.mcq && q.mcq.maxOptions) || 6;

  return {
    forbidContextPlaceholderText,
    forbiddenPhrases,
    requireExplanation,
    explanationMinChars,
    forbidNearDuplicateThreshold,
    variation: { rotateDims, minDistinctDims },
    mcq: { minOptions, maxOptions }
  };
}

// ============================================================
// Text guards + sanitizers
// ============================================================

export function containsForbiddenPhrase(text, forbiddenPhrases) {
  const t = safeStr(text).toLowerCase();
  for (const p of safeArr(forbiddenPhrases)) {
    const ph = safeStr(p).toLowerCase().trim();
    if (ph && t.includes(ph)) return true;
  }
  return false;
}

export function stripAnyBracketedContext(s) {
  const txt = safeStr(s);
  return txt
    .replace(/\(\s*kontext[^)]*\)/gi, "")
    .replace(/\(\s*använd[^)]*\)/gi, "")
    .replace(/\[\s*object\s+object\s*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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

export function sanitizeContextForDisplay(contextText, qq) {
  const c = safeStr(contextText).trim();
  if (!c) return "—";
  if (qq && qq.forbidContextPlaceholderText) {
    if (containsForbiddenPhrase(c, qq.forbiddenPhrases)) return "—";
    if (/\(kontext\s+dolt\)/i.test(c)) return "—";
    if (/\[object\s+object\]/i.test(c)) return "—";
  }
  return c;
}

// ============================================================
// Similarity / uniqueness helpers
// ============================================================

export function tokenizeForSimilarity(s) {
  const t = safeStr(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!t) return [];
  const parts = t.split(/\s+/g).filter(Boolean);
  const stop = new Set([
    "i","en","ett","att","och","du","när","vad","vilket","vilken","är","ska","för","på","om","som","det","de","den","ni",
    "innan","efter","bäst","mest","rätt","fel","gör","göra","behöver","måste","kan","vill","där","här","nu"
  ]);
  return parts.filter(w => w.length >= 3 && !stop.has(w));
}

export function jaccardSimilarity(a, b) {
  const A = new Set(tokenizeForSimilarity(a));
  const B = new Set(tokenizeForSimilarity(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? (inter / uni) : 0;
}

export function normKey(s) {
  return safeStr(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function pickOne(list, seed) {
  const arr = safeArr(list).filter(Boolean);
  if (arr.length === 0) return "";
  return arr[seed % arr.length] || arr[0] || "";
}
