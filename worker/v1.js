// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.9)
// FIL: worker/v1.js
// Syfte: V1 ruleset-payload parser + course helpers + context normalization
//
// POLICY (LÅST):
// - Stateless
// - Fail-closed
// - Endast JSON
// - Ingen payload-logg (endast requestId + felkod i caller)
// ============================================================

import { safeStr, isPlainObject } from "./rules.js";

// ------------------------------
// small helpers
// ------------------------------
export function safeArr(a) {
  return Array.isArray(a) ? a : [];
}

export function normalizeLanguage(v) {
  const s = safeStr(v).trim().toLowerCase();
  if (!s) return "sv";
  if (s === "sv" || s === "sv-se" || s === "sv_se" || s.startsWith("sv")) return "sv";
  if (s === "en" || s === "en-us" || s === "en_gb" || s.startsWith("en")) return "en";
  return "sv";
}

export function normalizeStepValue(v) {
  // Returnerar "1".."7" eller "".
  const s = safeStr(v).trim();
  if (!s) return "";
  const m = s.match(/([1-7])/);
  return m ? safeStr(m[1]) : "";
}

export function normalizeContextText(v) {
  // UI kan skicka:
  // - string
  // - object { text: "..." }
  // - object { contextText: "..." }
  // - v1 context object { moduleLabel, areaLabel, chapterLabel, step, difficulty }
  if (typeof v === "string") return v.trim();

  if (isPlainObject(v)) {
    const t = safeStr(v.text || v.contextText || v.value || "").trim();
    if (t) return t;

    const ml = safeStr(v.moduleLabel || "").trim();
    const al = safeStr(v.areaLabel || "").trim();
    const cl = safeStr(v.chapterLabel || "").trim();

    const stRaw = safeStr(v.step || v.stepId || "").trim();
    const st = normalizeStepValue(stRaw) || stRaw;

    const df = safeStr(v.difficulty || "").trim();

    const parts = [];
    if (ml) parts.push(`Modul: ${ml}`);
    if (al) parts.push(`Område: ${al}`);
    if (cl) parts.push(`Kapitel: ${cl}`);
    if (st) parts.push(`Steg: ${st}`);
    if (df) parts.push(`Svårighet: ${df}`);
    return parts.join(" • ");
  }

  return safeStr(v).trim();
}

export function normalizeMode(modeRaw) {
  const s = safeStr(modeRaw).toLowerCase().trim();
  if (!s) return "";
  if (s === "training" || s === "document") return s;
  if (s.includes("train")) return "training";
  if (s.includes("doc")) return "document";
  return s;
}

export function normalizeSubjectId(subjectId) {
  const s = safeStr(subjectId).toLowerCase().trim();
  if (s === "swedish" || s === "svenska") return "swedish";
  if (s === "math" || s === "matte") return "math";
  if (s) return s;
  return "generic";
}

// ------------------------------
// V1 ruleset payload (ai-rules/v1)
// ------------------------------
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

  // ALLA auto-varianter => "auto"
  if (s === "auto" || s.startsWith("auto_") || s.startsWith("auto-") || s.startsWith("auto")) {
    return "auto";
  }

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

export function isUiQuestionRequest(questionType) {
  const qt = normalizeQuestionType(questionType);
  return qt === "auto" || qt === "mcq_single" || qt === "mcq_multi" || qt === "true_false";
}

export function parseV1RulesetPayload(body) {
  // Minimal detection: contentType + output.formatRef
  const contentType = safeStr(body && body.contentType).trim();
  const out = body && isPlainObject(body.output) ? body.output : null;
  const formatRef = safeStr(out && out.formatRef).trim();

  if (!contentType || !formatRef) return null;

  const count = body.count ?? 4;
  const language = body.language || "sv-SE";
  const ctx = (body && isPlainObject(body.context)) ? body.context : {};

  const stepNorm = normalizeStepValue(ctx.step || ctx.stepId || "");
  const difficulty = safeStr(ctx.difficulty || "").trim();

  const course = {
    module: safeStr(ctx.moduleLabel || "").trim(),
    area: safeStr(ctx.areaLabel || "").trim(),
    chapter: safeStr(ctx.chapterLabel || "").trim(),
    step: stepNorm || "1",
    moduleId: safeStr(ctx.moduleId || "").trim(),
    areaId: safeStr(ctx.areaId || "").trim(),
    chapterId: safeStr(ctx.chapterId || "").trim(),
    stepId: stepNorm || safeStr(ctx.step || ctx.stepId || "").trim()
  };

  // contentType -> mode/format
  let mode = "training";
  let format = "training-blocks";

  if (contentType === "document") {
    mode = "document";
    format = "document";
  } else if (contentType === "questions") {
    mode = "training";
    format = "question";
  } else if (contentType === "training_blocks") {
    mode = "training";
    format = "training-blocks";
  } else {
    mode = "";
    format = "";
  }

  const questionType = normalizeQuestionType(safeStr(out && out.questionType).trim() || "auto");
  const contextText = normalizeContextText(ctx);

  return { mode, format, count, language, questionType, difficulty, course, contextText };
}

// ------------------------------
// Course subject helpers
// ------------------------------
export function normalizeCourseSubject(subjectObj) {
  if (!isPlainObject(subjectObj)) return null;

  const module = safeStr(subjectObj.module || "").trim();
  const area = safeStr(subjectObj.area || "").trim();
  const chapter = safeStr(subjectObj.chapter || "").trim();

  const moduleId = safeStr(subjectObj.moduleId || "").trim();
  const areaId = safeStr(subjectObj.areaId || "").trim();
  const chapterId = safeStr(subjectObj.chapterId || "").trim();
  const stepIdRaw = safeStr(subjectObj.stepId || "").trim();

  const stepRaw = safeStr(subjectObj.step || "").trim();
  const stepNorm = normalizeStepValue(stepRaw) || normalizeStepValue(stepIdRaw) || "";

  return {
    module: module || "",
    area: area || "",
    chapter: chapter || "",
    step: stepNorm,
    moduleId,
    areaId,
    chapterId,
    stepId: stepNorm || stepIdRaw
  };
}

export function validateCourseSubject(course) {
  if (course === null) return { ok: true };
  const step = normalizeStepValue(course.step);
  if (step) {
    const allow = new Set(["1", "2", "3", "4", "5", "6", "7"]);
    if (!allow.has(step)) return { ok: false, message: "subject.step måste vara 1–7" };
  }
  return { ok: true };
}

export function inferCourseFromContextText(contextText) {
  // Förväntad sträng:
  // "Modul: Kvalitet • Område: ISO 9001 • Kapitel: Introduktion • Steg: 1"
  const t = safeStr(contextText);

  function pick(label) {
    const re = new RegExp(`${label}\\s*:\\s*([^•\\n\\r]+)`, "i");
    const m = t.match(re);
    return m ? safeStr(m[1]).trim() : "";
  }

  const module = pick("Modul");
  const area = pick("Område");
  const chapter = pick("Kapitel");

  let step = "";
  const mStep = t.match(/Steg\s*:\s*([^•\n\r]+)/i);
  if (mStep) step = normalizeStepValue(mStep[1]);

  if (!module && !area && !chapter && !step) return null;

  return { module: module || "", area: area || "", chapter: chapter || "", step: step || "" };
}

export function resolveCourseLabelFallback(course, mode, contextText) {
  const inferred = (!course) ? inferCourseFromContextText(contextText) : null;

  if (!course && !inferred) {
    return {
      module: "Generic",
      area: (mode === "document") ? "Dokument" : "Utbildning",
      chapter: "Introduktion",
      step: "1"
    };
  }

  const src = course || inferred || {};
  const stepNorm = normalizeStepValue(src.step) || "1";

  return {
    module: safeStr(src.module).trim() || "Generic",
    area: safeStr(src.area).trim() || ((mode === "document") ? "Dokument" : "Utbildning"),
    chapter: safeStr(src.chapter).trim() || "Introduktion",
    step: stepNorm
  };
}

export function normalizeFormat(format, mode, questionType) {
  // UI-frågeflöde (inkl AUTO) ska låsa format till "question"
  if (isUiQuestionRequest(questionType)) return "question";

  const f = safeStr(format).toLowerCase().trim();
  if (f === "question" || f === "questions") return "question";
  if (f === "task" || f === "tasks") return "task";
  if (f === "document") return "document";
  if (f === "training-blocks" || f === "training" || f === "blocks") return "training-blocks";
  return (mode === "document") ? "document" : "training-blocks";
}

export function pickDifficultyLabel(difficultyHint, seedN) {
  const s = safeStr(difficultyHint).toLowerCase().trim();
  if (s === "intro" || s === "normal" || s === "advanced") return s;

  if (!s || s === "auto") {
    const lvl = 1 + (seedN % 5); // 1..5
    return (lvl <= 2) ? "intro" : (lvl <= 4) ? "normal" : "advanced";
  }

  const n = Number(difficultyHint);
  if (Number.isInteger(n) && n >= 1 && n <= 5) {
    return (n <= 2) ? "intro" : (n <= 4) ? "normal" : "advanced";
  }

  return "normal";
}

