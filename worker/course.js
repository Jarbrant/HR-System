// ============================================================
// AO-WORKER-TRAINING-BLOCKS-01 | worker/course.js
// Syfte: V1 ruleset payload + course/label helpers (flytt från worker/index.js BLOCK 07–08)
// POLICY: No behavior change. Inga sid-effekter. UI-only worker.
// ============================================================

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeStr(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

function normalizeStepValue(v) {
  // Returnerar "1".."7" eller "".
  const s = safeStr(v).trim();
  if (!s) return "";
  const m = s.match(/([1-7])/);
  return m ? safeStr(m[1]) : "";
}

function normalizeContextText(v) {
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

// ============================================================
// V1 ruleset payload (ai-rules/v1)
// ============================================================

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
    // okänt => fail-closed via validation senare
    mode = "";
    format = "";
  }

  // NOTE: normalizeQuestionType körs i index.js (för att undvika kors-beroenden)
  const questionType = safeStr(out && out.questionType).trim() || "auto";

  // contextText: bygg från labels (workplace-infer kan använda)
  const contextText = normalizeContextText(ctx);

  return {
    mode,
    format,
    count,
    language,
    questionType,
    difficulty,
    course,
    contextText
  };
}

// ============================================================
// Course Subject (module/area/chapter/step)
// ============================================================

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

function inferCourseFromContextText(contextText) {
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

  return {
    module: module || "",
    area: area || "",
    chapter: chapter || "",
    step: step || ""
  };
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

