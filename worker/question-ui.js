// ============================================================
// AO-WORKER-TRAINING-BLOCKS-01 | FILE: worker/question-ui.js
// Syfte: UI-frågehelpers (questionType + format) – separerat för kortare index.js
// Policy: Ingen domänlogik, ingen request/env, bara ren mapping/normalisering
// ============================================================

import { safeStr } from "./utils.js";

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

// P0 PATCH: "auto" är också ett UI-frågeläge och ska ge stabilt items[]-output.
export function isUiQuestionRequest(questionType) {
  const qt = normalizeQuestionType(questionType);
  return qt === "auto" || qt === "mcq_single" || qt === "mcq_multi" || qt === "true_false";
}

export function normalizeFormat(format, mode, questionType) {
  // P0: UI-frågeflödet (inkl AUTO) ska låsa format till "question"
  if (isUiQuestionRequest(questionType)) return "question";

  const f = safeStr(format).toLowerCase().trim();
  if (f === "question" || f === "questions") return "question";
  if (f === "task" || f === "tasks") return "task";
  if (f === "document") return "document";
  if (f === "training-blocks" || f === "training" || f === "blocks") return "training-blocks";
  return (mode === "document") ? "document" : "training-blocks";
}

