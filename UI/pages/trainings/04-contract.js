/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-04) | FILE 04/06 | FIL-ID: UI/pages/trainings/04-contract.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Kontrakt + validering (fail-closed) för trainings + AI-resultat
      - validateTrainingForSave
      - validateForPublish (striktare)
      - validateAiResult (kräver items)
      - normalizeItem (minimal, stabil)
      - validateItemBasics (för "problem"-filter)

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys
- Ingen fetch • ingen worker
- XSS-safe: textContent i render (denna fil gör ingen DOM)
- ADMIN-only write hanteras i 06-page (inte här)

PATCH v1.0.1 (PP-SC-010-04A) – AUTOPATCH:
- P0: Blockera publicering om question saknar facit och/eller saknar svarsalternativ när alternativ förväntas.
- P1: Stoppa AI-resultat som innehåller question-like items utan facit (fail-closed).
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.contract) return;

  const contract = (NS.contract = {});
  contract.__VERSION = "v1.0.1-PP-SC-010-04A";

  function normStr(v) { return String(v ?? "").trim(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }
  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function isNonEmptyStr(v) { return typeof v === "string" && normStr(v).length > 0; }
  function isBool(v) { return typeof v === "boolean"; }
  function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

  // ------------------------------
  // Training validation
  // ------------------------------
  function countItems(t) {
    const blocks = t && Array.isArray(t.blocks) ? t.blocks : [];
    let n = 0;
    for (const b of blocks) {
      if (b && Array.isArray(b.items)) n += b.items.length;
    }
    return n;
  }

  // ------------------------------
  // Item helpers (robust, fail-closed)
  // ------------------------------
  function normType(v) {
    const s = normStr(v).toLowerCase();
    if (!s) return "info";
    // tillåt fler men normalisera till stabil bas
    if (s === "question" || s === "quiz" || s === "mcq" || s === "true_false") return "question";
    if (s === "task" || s === "assignment") return "task";
    if (s === "document" || s === "doc") return "document";
    if (s === "both") return "both";
    return "info";
  }

  function primaryText(it) {
    if (typeof it === "string") return normStr(it);
    if (!isPlainObject(it)) return "";
    return (
      normStr(it.text) ||
      normStr(it.instruction) ||
      normStr(it.prompt) ||
      normStr(it.question) ||
      normStr(it.title) ||
      normStr(it.heading)
    );
  }

  function hasOptions(it) {
    if (!isPlainObject(it)) return false;

    const opt = it.options;
    const choices = it.choices;
    const answers = it.answers;

    if (Array.isArray(opt) && opt.some(isNonEmptyStr)) return true;
    if (Array.isArray(choices) && choices.some(isNonEmptyStr)) return true;
    if (Array.isArray(answers) && answers.some(isNonEmptyStr)) return true;

    // stöd för [{label:..}] eller [{text:..}]
    if (Array.isArray(opt) && opt.some(o => isPlainObject(o) && (isNonEmptyStr(o.label) || isNonEmptyStr(o.text)))) return true;
    if (Array.isArray(choices) && choices.some(o => isPlainObject(o) && (isNonEmptyStr(o.label) || isNonEmptyStr(o.text)))) return true;

    return false;
  }

  function hasAnswer(it) {
    if (!isPlainObject(it)) return false;

    // vanligast
    if (isNonEmptyStr(it.answer) || isNum(it.answer) || isBool(it.answer)) return true;
    if (isNonEmptyStr(it.correct) || isNum(it.correct) || isBool(it.correct)) return true;

    // varianter
    if (isNonEmptyStr(it.correctAnswer) || isNum(it.correctAnswer) || isBool(it.correctAnswer)) return true;
    if (isNonEmptyStr(it.solution) || isNum(it.solution) || isBool(it.solution)) return true;

    // index-baserat (för MCQ)
    if (isNum(it.correctIndex) && it.correctIndex >= 0) return true;
    if (isNum(it.answerIndex) && it.answerIndex >= 0) return true;

    // bool-flagga + options kan räcka i vissa modeller, men här kräver vi ändå någon form av facit
    return false;
  }

  function isQuestionLike(it) {
    if (typeof it === "string") return false;
    if (!isPlainObject(it)) return false;

    const t = normType(it.type);
    if (t === "question") return true;

    // ibland kommer AI utan type men med question-fält
    if (isNonEmptyStr(it.question)) return true;

    return false;
  }

  function validateItemForPublish(it) {
    const reasons = [];

    if (it == null) return { ok: false, reasons: ["Tom item."] };

    const p = primaryText(it);
    if (!p) reasons.push("Item saknar text (text/instruction/prompt/question).");

    if (isQuestionLike(it)) {
      if (!hasAnswer(it)) reasons.push("Fråga saknar facit (answer/correct/correctIndex).");

      // Om item använder svarsalternativ måste de vara ifyllda.
      // (Vi kan inte säkert veta om en fråga ska vara fritext eller MCQ,
      // men om options/choices/answers finns måste de vara användbara.)
      const hasAnyOpts = hasOptions(it);
      if (hasAnyOpts === true) {
        // ok
      } else {
        // Om frågan ser ut som MCQ (t.ex. correctIndex finns) men inga options -> stoppa.
        if (isPlainObject(it) && (isNum(it.correctIndex) || isNum(it.answerIndex))) {
          reasons.push("Fråga saknar svarsalternativ (options/choices/answers) men har index-facit.");
        }
      }
    }

    return { ok: reasons.length === 0, reasons };
  }

  // ------------------------------
  // validateTrainingForSave (snäll)
  // ------------------------------
  contract.validateTrainingForSave = function (t) {
    const reasons = [];
    if (!t || typeof t !== "object") return { ok: false, reasons: ["Saknar training-objekt."] };

    const title = normStr(t.title);
    const module = normStr(t.module);
    const area = normStr(t.area);

    // Save ska vara snällt: ok:true men reasons för problemfilter.
    if (!title) reasons.push("Saknar titel.");
    if (!module) reasons.push("Saknar modul.");
    if (!area) reasons.push("Saknar område.");

    return { ok: true, reasons };
  };

  // ------------------------------
  // validateForPublish (strikt, blockera demo om trasigt)
  // ------------------------------
  contract.validateForPublish = function (t) {
    const reasons = [];
    if (!t || typeof t !== "object") return { ok: false, reasons: ["Saknar training-objekt."] };

    const title = normStr(t.title);
    const module = normStr(t.module);
    const area = normStr(t.area);
    const chapter = normStr(t.courseTitle);
    const step = normStr(t.courseStep);

    if (!title) reasons.push("Publicering: saknar titel.");
    if (!module) reasons.push("Publicering: saknar modul.");
    if (!area) reasons.push("Publicering: saknar område.");
    if (!chapter) reasons.push("Publicering: saknar kapitel.");
    if (!step) reasons.push("Publicering: saknar steg.");

    const blocks = t && Array.isArray(t.blocks) ? t.blocks : [];
    if (!blocks.length) reasons.push("Publicering: kräver minst 1 block.");

    const nItems = countItems(t);
    if (nItems <= 0) reasons.push("Publicering: kräver minst 1 block/item.");

    // P0: item-level strictness
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      const items = b && Array.isArray(b.items) ? b.items : null;
      if (!items || items.length === 0) {
        reasons.push(`Publicering: Block ${bi + 1} saknar items.`);
        continue;
      }

      for (let ii = 0; ii < items.length; ii++) {
        const it = items[ii];
        const v = validateItemForPublish(it);
        if (!v.ok) {
          for (const r of safeArr(v.reasons)) {
            reasons.push(`Publicering: Block ${bi + 1} Item ${ii + 1} – ${r}`);
          }
        }
      }
    }

    return { ok: reasons.length === 0, reasons };
  };

  // ------------------------------
  // normalizeItem (minimal, stabil)
  // ------------------------------
  contract.normalizeItem = function (it) {
    // Minimal stabil shape. Rör inte okända fält (låt dem finnas kvar).
    if (!isPlainObject(it)) return { type: "info", text: normStr(it) };

    const out = it; // in-place ok (06-page deepClone hanterar)
    out.type = normType(out.type);

    // normalisera vanliga textfält
    if (typeof out.text === "string") out.text = normStr(out.text);
    if (typeof out.instruction === "string") out.instruction = normStr(out.instruction);
    if (typeof out.prompt === "string") out.prompt = normStr(out.prompt);
    if (typeof out.question === "string") out.question = normStr(out.question);
    if (typeof out.explanation === "string") out.explanation = normStr(out.explanation);
    if (typeof out.feedback === "string") out.feedback = normStr(out.feedback);

    return out;
  };

  // ------------------------------
  // validateAiResult (fail-closed om trasigt)
  // ------------------------------
  contract.validateAiResult = function (payload) {
    const reasons = [];
    const items = payload && Array.isArray(payload.items) ? payload.items : null;

    if (!items) return { ok: false, reasons: ["AI-resultat saknar items[]."] };
    if (items.length <= 0) return { ok: false, reasons: ["AI-resultat innehåller inga items."] };

    // Light sanity: varje item ska vara object eller string
    let badShape = 0;
    for (const it of items) {
      const ok = (typeof it === "string") || (it && typeof it === "object");
      if (!ok) badShape++;
    }
    if (badShape > 0) reasons.push("AI-resultat innehåller ogiltiga items.");

    // P1: Stoppa om AI ger question-like items utan facit (detta är roten till “Rätt!” utan innehåll).
    let badQuestions = 0;
    for (const it of items) {
      if (!isQuestionLike(it)) continue;
      if (!hasAnswer(it)) badQuestions++;
      // Om index-facit men inga options -> också trasigt
      if (isPlainObject(it) && (isNum(it.correctIndex) || isNum(it.answerIndex)) && !hasOptions(it)) badQuestions++;
    }
    if (badQuestions > 0) reasons.push("AI-resultat innehåller frågor utan facit och/eller utan svarsalternativ.");

    return { ok: reasons.length === 0, reasons };
  };

  // ------------------------------
  // Problem-detektering per training (för filter "Visa bara problem")
  // ------------------------------
  contract.validateItemBasics = function (it) {
    const reasons = [];
    if (!it) return { ok: false, reasons: ["Tom item."] };

    if (typeof it === "string") {
      if (!normStr(it)) reasons.push("Tom text.");
      return { ok: reasons.length === 0, reasons };
    }

    if (!isPlainObject(it)) return { ok: false, reasons: ["Ogiltigt item-format."] };

    const t = normType(it.type);

    const p = primaryText(it);
    if (!p) reasons.push("Saknar text/instruction/prompt/question.");

    // question: flagga facit + ev. svarsalternativ som problem (inte nödvändigtvis stopp i draft-save)
    if (t === "question" || isNonEmptyStr(it.question)) {
      if (!hasAnswer(it)) reasons.push("Fråga saknar facit (answer/correct/correctIndex).");
      if ((isNum(it.correctIndex) || isNum(it.answerIndex)) && !hasOptions(it)) {
        reasons.push("Fråga har index-facit men saknar svarsalternativ.");
      }
    }

    return { ok: reasons.length === 0, reasons };
  };
})();
