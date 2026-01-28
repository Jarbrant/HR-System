/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-04) | FILE 04/06 | FIL-ID: UI/pages/trainings/04-contract.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Kontrakt + validering (fail-closed) för trainings + AI-resultat
      - validateTrainingForSave
      - validateForPublish (striktare)
      - validateAiResult (kräver items/blocks)
      - normalizeItem (minimal, stabil)
      - validateItemBasics (för "problem"-filter)

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys
- Ingen fetch • ingen worker
- XSS-safe: render via textContent/value i render (denna fil gör ingen DOM)
- ADMIN-only write hanteras i 06-page (inte här)

PATCH v1.1.0 (PP-SC-010-04B) – AUTOPATCH:
- P0: Robust AI-validering: stöd för payload.items[] OCH payload.blocks[] (+ data.blocks) (fail-closed).
- P0: Strikt question-validering vid publicering: kräver facit; om options används krävs korrekt index/indices i range.
- P1: Stoppa AI-resultat som innehåller question-like items utan facit, eller index-facit utan options.
- P1: Normaliserar och extraherar options/choices/answers konsekvent (inkl. [{label|text}]).

BLOCKS:
1) Namespace + version
2) Bas-utils
3) Training helpers
4) Item helpers (type/text/options/answer)
5) Question validation helpers
6) validateTrainingForSave
7) validateForPublish + item-level strictness
8) normalizeItem (minimal)
9) validateAiResult (items/blocks)
10) validateItemBasics (problemfilter)
============================================================ */
(function () {
  "use strict";

  /* =========================
     BLOCK 1/10 — Namespace + version
  ========================== */
  const NS = (window.Trainings = window.Trainings || {});
  if (NS.contract) return;

  const contract = (NS.contract = {});
  contract.__VERSION = "v1.1.0-PP-SC-010-04B";

  /* =========================
     BLOCK 2/10 — Bas-utils (no deps)
  ========================== */
  function normStr(v) { return String(v ?? "").trim(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }
  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function isNonEmptyStr(v) { return typeof v === "string" && normStr(v).length > 0; }
  function isBool(v) { return typeof v === "boolean"; }
  function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
  function asInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
  }

  /* =========================
     BLOCK 3/10 — Training helpers
  ========================== */
  function countItems(t) {
    const blocks = t && Array.isArray(t.blocks) ? t.blocks : [];
    let n = 0;
    for (const b of blocks) {
      if (b && Array.isArray(b.items)) n += b.items.length;
    }
    return n;
  }

  /* =========================
     BLOCK 4/10 — Item helpers (robust, fail-closed)
  ========================== */
  function normType(v) {
    const s = normStr(v).toLowerCase();
    if (!s) return "info";
    // stabil bas
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

  function isQuestionLike(it) {
    if (typeof it === "string") return false;
    if (!isPlainObject(it)) return false;

    const t = normType(it.type);
    if (t === "question") return true;

    // AI kan sakna type men ha question-fält
    if (isNonEmptyStr(it.question)) return true;

    return false;
  }

  function extractOptionsRaw(it) {
    if (!isPlainObject(it)) return [];
    // vanligaste varianter
    if (Array.isArray(it.options)) return it.options;
    if (Array.isArray(it.choices)) return it.choices;
    if (Array.isArray(it.answers)) return it.answers;
    return [];
  }

  function extractOptionsText(it) {
    const raw = extractOptionsRaw(it);
    if (!raw.length) return [];
    const out = [];
    for (const o of raw) {
      if (typeof o === "string") {
        const s = normStr(o);
        if (s) out.push(s);
        continue;
      }
      if (isPlainObject(o)) {
        const s = normStr(o.label) || normStr(o.text) || normStr(o.value);
        if (s) out.push(s);
        continue;
      }
      // ignore unknown option-shapes
    }
    return out;
  }

  function hasOptions(it) {
    const opts = extractOptionsText(it);
    return opts.length >= 2; // kräver minst 2 för att räknas som "alternativfråga"
  }

  /* =========================
     BLOCK 5/10 — Question validation helpers
  ========================== */
  function hasAnswer(it) {
    if (!isPlainObject(it)) return false;

    // text/number/bool facit
    if (isNonEmptyStr(it.answer) || isNum(it.answer) || isBool(it.answer)) return true;
    if (isNonEmptyStr(it.correct) || isNum(it.correct) || isBool(it.correct)) return true;

    // varianter
    if (isNonEmptyStr(it.correctAnswer) || isNum(it.correctAnswer) || isBool(it.correctAnswer)) return true;
    if (isNonEmptyStr(it.solution) || isNum(it.solution) || isBool(it.solution)) return true;
    if (isNonEmptyStr(it.expected) || isNum(it.expected)) return true;

    // index-baserat (MCQ)
    if (isNum(it.correctIndex) && it.correctIndex >= 0) return true;
    if (isNum(it.answerIndex) && it.answerIndex >= 0) return true;

    // multi
    if (Array.isArray(it.correctIndices) && it.correctIndices.length > 0) return true;
    if (Array.isArray(it.answerIndices) && it.answerIndices.length > 0) return true;

    return false;
  }

  function validateIndicesAgainstOptions(it, reasons) {
    const opts = extractOptionsText(it);
    const optLen = opts.length;

    const ci = asInt(it.correctIndex);
    const ai = asInt(it.answerIndex);

    const cis = Array.isArray(it.correctIndices) ? it.correctIndices.map(asInt).filter(Number.isFinite) : null;
    const ais = Array.isArray(it.answerIndices) ? it.answerIndices.map(asInt).filter(Number.isFinite) : null;

    // single index present => must be in-range and options must exist
    if (Number.isFinite(ci) || Number.isFinite(ai)) {
      if (optLen < 2) {
        reasons.push("Fråga har index-facit men saknar svarsalternativ (options/choices/answers).");
        return;
      }
      const idx = Number.isFinite(ci) ? ci : ai;
      if (idx < 0 || idx >= optLen) reasons.push("Fråga har correctIndex/answerIndex utanför options-range.");
    }

    // multi indices present
    if ((cis && cis.length) || (ais && ais.length)) {
      if (optLen < 2) {
        reasons.push("Fråga har correctIndices/answerIndices men saknar svarsalternativ (options/choices/answers).");
        return;
      }
      const arr = (cis && cis.length) ? cis : ais;
      for (const idx of arr) {
        if (idx < 0 || idx >= optLen) {
          reasons.push("Fråga har correctIndices/answerIndices med index utanför options-range.");
          break;
        }
      }
    }
  }

  function validateItemForPublish(it) {
    const reasons = [];

    if (it == null) return { ok: false, reasons: ["Tom item."] };

    const p = primaryText(it);
    if (!p) reasons.push("Item saknar text (text/instruction/prompt/question).");

    if (isQuestionLike(it)) {
      // P0: måste ha facit
      if (!hasAnswer(it)) reasons.push("Fråga saknar facit (answer/correct/correctIndex/correctIndices).");

      // P0: om alternativ används måste de vara användbara
      const hasOpts = hasOptions(it);
      if (hasOpts) {
        // ok: options finns (>=2), men vi behöver att facit matchar formatet
        // - index-baserat kontrolleras mot range
        // - text/bool facit tillåts (kan vara fritext/TF), men om index finns måste det vara rätt
        validateIndicesAgainstOptions(it, reasons);
      } else {
        // om det finns index-facit men inga options: stoppa
        if (isPlainObject(it) && (Number.isFinite(asInt(it.correctIndex)) || Number.isFinite(asInt(it.answerIndex)) ||
          (Array.isArray(it.correctIndices) && it.correctIndices.length) || (Array.isArray(it.answerIndices) && it.answerIndices.length))) {
          reasons.push("Fråga saknar svarsalternativ (options/choices/answers) men har index-facit.");
        }
      }
    }

    return { ok: reasons.length === 0, reasons };
  }

  /* =========================
     BLOCK 6/10 — validateTrainingForSave (snäll)
  ========================== */
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

    // Extra mild sanity (ej blockerande)
    const blocks = t && Array.isArray(t.blocks) ? t.blocks : [];
    if (blocks.length) {
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (!b || !Array.isArray(b.items) || b.items.length === 0) {
          reasons.push(`Block ${bi + 1} saknar items.`);
        }
      }
    }

    return { ok: true, reasons };
  };

  /* =========================
     BLOCK 7/10 — validateForPublish (strikt)
  ========================== */
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

  /* =========================
     BLOCK 8/10 — normalizeItem (minimal, stabil)
  ========================== */
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

  /* =========================
     BLOCK 9/10 — validateAiResult (fail-closed)
  ========================== */
  function extractAiItemsFromPayload(payload) {
    const p = payload && payload.data ? payload.data : payload;

    // 1) items[] direkt
    if (p && Array.isArray(p.items)) return p.items;

    // 2) blocks[] (standard i training-blocks)
    const blocks = p && Array.isArray(p.blocks) ? p.blocks
      : (p && Array.isArray(p.trainingBlocks) ? p.trainingBlocks : null);

    if (blocks && blocks.length) {
      const items = [];
      for (const b of blocks) {
        if (!b || !Array.isArray(b.items)) continue;
        for (const it of b.items) items.push(it);
      }
      return items;
    }

    // 3) raw array (antingen blocks eller items)
    if (Array.isArray(p)) {
      const looksLikeBlocks = p.some(x => x && typeof x === "object" && Array.isArray(x.items));
      if (looksLikeBlocks) {
        const items = [];
        for (const b of p) {
          if (!b || !Array.isArray(b.items)) continue;
          for (const it of b.items) items.push(it);
        }
        return items;
      }
      return p; // treat as items
    }

    return null;
  }

  contract.validateAiResult = function (payload) {
    const reasons = [];
    const items = extractAiItemsFromPayload(payload);

    if (!items) return { ok: false, reasons: ["AI-resultat saknar items[] eller blocks[]."] };
    if (items.length <= 0) return { ok: false, reasons: ["AI-resultat innehåller inga items."] };

    // Light sanity: varje item ska vara object eller string
    let badShape = 0;
    for (const it of items) {
      const ok = (typeof it === "string") || (it && typeof it === "object");
      if (!ok) badShape++;
    }
    if (badShape > 0) reasons.push("AI-resultat innehåller ogiltiga items (ej string/object).");

    // P1: Stoppa om AI ger question-like items utan facit / index-facit utan options
    let badQuestions = 0;
    for (const it of items) {
      if (!isQuestionLike(it)) continue;

      // kräver facit
      if (!hasAnswer(it)) { badQuestions++; continue; }

      // om index-facit används krävs options och korrekt range
      const tmp = [];
      validateIndicesAgainstOptions(it, tmp);
      if (tmp.length) { badQuestions++; continue; }

      // om options finns (<2) men modellen försöker köra MCQ => stoppa
      const rawOpts = extractOptionsRaw(it);
      if (rawOpts.length > 0 && !hasOptions(it)) { badQuestions++; continue; }
    }
    if (badQuestions > 0) reasons.push("AI-resultat innehåller frågor utan facit och/eller index-facit utan giltiga svarsalternativ.");

    return { ok: reasons.length === 0, reasons };
  };

  /* =========================
     BLOCK 10/10 — validateItemBasics (problemfilter, ej publish-gate)
  ========================== */
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
      if (!hasAnswer(it)) reasons.push("Fråga saknar facit (answer/correct/correctIndex/correctIndices).");

      const tmp = [];
      validateIndicesAgainstOptions(it, tmp);
      for (const r of tmp) reasons.push(r);

      // om AI skickar options men de är för få / tomma => problem
      const rawOpts = extractOptionsRaw(it);
      if (rawOpts.length > 0 && !hasOptions(it)) reasons.push("Fråga har options/choices/answers men färre än 2 giltiga alternativ.");
    }

    return { ok: reasons.length === 0, reasons };
  };
})();
