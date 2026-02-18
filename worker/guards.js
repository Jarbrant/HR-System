// ============================================================
// PRC-BYGGORDER — AO-WORKER-STACK-01 (PROD v1.0)
// FIL: worker/guards.js
// Syfte: JSON schema guard + deterministic fallback
//        Om AI svarar fel → deterministisk fallback JSON, alltid giltig.
//
// POLICY (LÅST):
// - Stateless
// - Fail-closed: alltid giltig JSON-output
// - Ingen payload-logg
// ============================================================

import { safeStr, isPlainObject } from "./rules.js";

// ---- Schema definitions ----

const QUESTION_SCHEMA = {
  required: ["question", "options", "answerKey"],
  questionType: "string",
  optionsMinLength: 2,
  answerKeyRequired: ["kind", "correctChoiceId"]
};

const DOCUMENT_SCHEMA = {
  required: ["title", "body"],
  titleType: "string",
  bodyType: "string"
};

// ---- Validators ----

/**
 * validateQuestionBlock(block)
 * Returns { ok: true } or { ok: false, reason: "..." }
 */
export function validateQuestionBlock(block) {
  if (!isPlainObject(block)) {
    return { ok: false, reason: "Block is not an object" };
  }

  const q = safeStr(block.question).trim();
  if (!q) {
    return { ok: false, reason: "Missing or empty question text" };
  }

  const options = Array.isArray(block.options) ? block.options : [];
  if (options.length < QUESTION_SCHEMA.optionsMinLength) {
    return { ok: false, reason: `options must have at least ${QUESTION_SCHEMA.optionsMinLength} items` };
  }

  // answerKey validation (lenient: accept correctIndex or answerKey)
  const hasAnswerKey = isPlainObject(block.answerKey) && safeStr(block.answerKey.correctChoiceId).trim();
  const hasCorrectIndex = Number.isFinite(block.correctIndex) && block.correctIndex >= 0;

  if (!hasAnswerKey && !hasCorrectIndex) {
    return { ok: false, reason: "Missing answerKey or correctIndex" };
  }

  return { ok: true };
}

/**
 * validateDocumentBlock(block)
 * Returns { ok: true } or { ok: false, reason: "..." }
 */
export function validateDocumentBlock(block) {
  if (!isPlainObject(block)) {
    return { ok: false, reason: "Block is not an object" };
  }

  const title = safeStr(block.title).trim();
  if (!title) {
    return { ok: false, reason: "Missing or empty title" };
  }

  // body can be string or items array
  const hasBody = safeStr(block.body).trim() ||
                  (Array.isArray(block.items) && block.items.length > 0);
  if (!hasBody) {
    return { ok: false, reason: "Missing body or items" };
  }

  return { ok: true };
}

/**
 * validateTrainingBlocks(result)
 * Validates entire training-blocks output structure.
 * Returns { ok: true } or { ok: false, reason: "..." }
 */
export function validateTrainingBlocks(result) {
  if (!isPlainObject(result)) {
    return { ok: false, reason: "Result is not an object" };
  }

  if (!Array.isArray(result.blocks)) {
    return { ok: false, reason: "Missing blocks array" };
  }

  for (let i = 0; i < result.blocks.length; i++) {
    const b = result.blocks[i];
    if (!isPlainObject(b)) {
      return { ok: false, reason: `Block ${i} is not an object` };
    }
    if (!safeStr(b.kind).trim() && !safeStr(b.type).trim()) {
      return { ok: false, reason: `Block ${i} missing kind/type` };
    }
  }

  return { ok: true };
}

// ---- Deterministic fallback builders ----

/**
 * fallbackQuestion(language, courseLabel, difficulty)
 * Always returns a valid question JSON — no AI dependency.
 */
export function fallbackQuestion(language, courseLabel, difficulty) {
  const sv = (language === "sv");
  const area = safeStr(courseLabel && courseLabel.area).trim() || (sv ? "Utbildning" : "Training");
  const diff = safeStr(difficulty).trim() || "normal";

  return {
    question: sv
      ? `Vilket av följande alternativ beskriver bäst en grundläggande princip inom ${area}?`
      : `Which of the following best describes a basic principle of ${area}?`,
    options: sv
      ? [
          { id: "A", label: "Följ fastställd rutin och dokumentera" },
          { id: "B", label: "Improvisera utan plan" },
          { id: "C", label: "Vänta tills någon annan agerar" },
          { id: "D", label: "Ignorera riktlinjer" }
        ]
      : [
          { id: "A", label: "Follow established procedures and document" },
          { id: "B", label: "Improvise without a plan" },
          { id: "C", label: "Wait for someone else to act" },
          { id: "D", label: "Ignore guidelines" }
        ],
    answerKey: { kind: "mcq_single", correctChoiceId: "A" },
    explanation: sv
      ? "Att följa fastställd rutin och dokumentera är grunden för systematiskt arbete."
      : "Following established procedures and documenting is the basis for systematic work.",
    meta: { fallback: true, difficulty: diff }
  };
}

/**
 * fallbackDocument(language, courseLabel)
 * Always returns a valid document JSON — no AI dependency.
 */
export function fallbackDocument(language, courseLabel) {
  const sv = (language === "sv");
  const area = safeStr(courseLabel && courseLabel.area).trim() || (sv ? "Dokument" : "Document");

  return {
    title: sv ? `Infoblad: ${area}` : `Info sheet: ${area}`,
    body: sv
      ? `Detta är ett infoblad om ${area}. Innehållet ger en kort översikt av rutiner och principer som gäller.`
      : `This is an info sheet about ${area}. The content gives a brief overview of applicable procedures and principles.`,
    items: [
      { type: "text", text: sv ? `Grundläggande principer för ${area}.` : `Basic principles for ${area}.` }
    ],
    meta: { fallback: true }
  };
}

/**
 * guardAndFallback(result, mode, language, courseLabel, difficulty)
 * If result passes validation → returns as-is.
 * If not → returns deterministic fallback (always valid JSON).
 */
export function guardAndFallback(result, mode, language, courseLabel, difficulty) {
  if (mode === "document") {
    const check = validateDocumentBlock(result);
    if (check.ok) return { ok: true, data: result, fallback: false };
    return { ok: true, data: fallbackDocument(language, courseLabel), fallback: true, reason: check.reason };
  }

  // training mode: validate the structure
  if (isPlainObject(result) && Array.isArray(result.blocks)) {
    const check = validateTrainingBlocks(result);
    if (check.ok) return { ok: true, data: result, fallback: false };
  }

  // If result looks like a single question, validate as question
  if (isPlainObject(result) && safeStr(result.question).trim()) {
    const check = validateQuestionBlock(result);
    if (check.ok) return { ok: true, data: result, fallback: false };
  }

  // Fallback: generate a valid question
  return {
    ok: true,
    data: fallbackQuestion(language, courseLabel, difficulty),
    fallback: true,
    reason: "AI output did not match expected schema"
  };
}
