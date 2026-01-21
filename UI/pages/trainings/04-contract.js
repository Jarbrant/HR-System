/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-05) | FILE 04/06 | FIL-ID: UI/pages/trainings/04-contract.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Kontrakt/validering för trainings + AI-resultat (deterministiskt)
      - validateTrainingForSave / validateForPublish
      - validateAiResult + normalizeItem
      - Inga nätverksanrop • ingen DOM • ingen storage

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell (endast validering)
- XSS: ingen rendering här
- ADMIN-only write hanteras i 06-page/core (inte här)
- AI: Skicka aldrig "Mål/goals" – detta kontrakt validerar endast resultat

PATCH v1.0.0 (PP-SC-010-05):
- Basvalidering för titel/modul/område/kapitel/steg
- Publish kräver minst 1 block och minst 1 item
- AI-resultat: kräver items[] med känd typ och minimal text/fråga+facit
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.contract) return;

  const contract = (NS.contract = {});
  contract.__VERSION = "v1.0.0-PP-SC-010-05";

  function normStr(v) { return String(v ?? "").trim(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }
  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function pushReason(reasons, msg) {
    if (!reasons) return;
    const s = normStr(msg);
    if (s) reasons.push(s);
  }

  function toIntStep(v) {
    const s = normStr(v);
    const m = s.match(/(\d+)/);
    const n = m ? Number(m[1]) : Number(s);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  }

  function getBlocks(t) {
    if (!t || typeof t !== "object") return [];
    if (Array.isArray(t.blocks)) return t.blocks;
    if (Array.isArray(t.items)) return [{ title: normStr(t.title) || "(block)", items: safeArr(t.items) }];
    return [];
  }

  function countItems(blocks) {
    let n = 0;
    for (const b of safeArr(blocks)) if (b && Array.isArray(b.items)) n += b.items.length;
    return n;
  }

  // ------------------------------
  // Training validate
  // ------------------------------
  contract.validateTrainingForSave = function (t) {
    const reasons = [];
    if (!isPlainObject(t)) {
      pushReason(reasons, "Ogiltig utbildning (saknar objekt).");
      return { ok: false, reasons };
    }

    if (!normStr(t.id)) pushReason(reasons, "Saknar id.");
    if (!normStr(t.title)) pushReason(reasons, "Saknar titel.");
    if (!normStr(t.module)) pushReason(reasons, "Saknar modul.");
    if (!normStr(t.area)) pushReason(reasons, "Saknar område.");

    const ct = normStr(t.courseTitle);
    if (!ct) pushReason(reasons, "Saknar kapitel (courseTitle).");

    const step = toIntStep(t.courseStep);
    if (step < 1 || step > 99) pushReason(reasons, "Saknar giltigt steg (courseStep).");

    const status = String(t.status || "draft");
    if (status !== "draft" && status !== "published") pushReason(reasons, "Ogiltig status.");

    return { ok: reasons.length === 0, reasons };
  };

  contract.validateForPublish = function (t) {
    const base = contract.validateTrainingForSave(t);
    const reasons = safeArr(base.reasons).slice();

    const blocks = getBlocks(t);
    if (!blocks.length) pushReason(reasons, "Publicering kräver minst 1 block.");
    if (countItems(blocks) < 1) pushReason(reasons, "Publicering kräver minst 1 item i blocken.");

    return { ok: reasons.length === 0, reasons };
  };

  // ------------------------------
  // AI result validate
  // ------------------------------
  // Tillåtna item-typer (minimalt):
  // - info/task/document/persona: kräver text/instruction/prompt
  // - question/quiz: kräver question + answer (facit) eller mcq med correctIndex
  const ALLOWED_TYPES = new Set(["info", "task", "document", "doc", "persona", "question", "quiz", "both"]);

  function getPrimaryText(it) {
    if (!it || typeof it !== "object") return "";
    const cand =
      (typeof it.text === "string" && it.text) ||
      (typeof it.instruction === "string" && it.instruction) ||
      (typeof it.prompt === "string" && it.prompt) ||
      (typeof it.heading === "string" && it.heading) ||
      "";
    return normStr(cand);
  }

  function hasAnswer(it) {
    if (!it || typeof it !== "object") return false;

    if (typeof it.answer === "string" && normStr(it.answer)) return true;
    if (typeof it.correctAnswer === "string" && normStr(it.correctAnswer)) return true;
    if (typeof it.facit === "string" && normStr(it.facit)) return true;

    // MCQ
    if (Array.isArray(it.options) && it.options.length >= 2) {
      const idx = Number(it.correctIndex);
      if (Number.isFinite(idx) && idx >= 0 && idx < it.options.length) return true;

      // alternativ: correctOptionId
      if (typeof it.correctOptionId === "string" && normStr(it.correctOptionId)) return true;
    }
    return false;
  }

  function isQuestionType(t) {
    const s = normStr(t).toLowerCase();
    return s === "question" || s === "quiz";
  }

  contract.validateAiResult = function (payload) {
    const reasons = [];
    const items = payload && Array.isArray(payload.items) ? payload.items : null;
    if (!items) {
      pushReason(reasons, "AI-resultat saknar items[].");
      return { ok: false, reasons };
    }
    if (!items.length) {
      pushReason(reasons, "AI-resultat innehåller inga items.");
      return { ok: false, reasons };
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!isPlainObject(it)) {
        pushReason(reasons, `Item ${i + 1} är inte ett objekt.`);
        continue;
      }

      const type = normStr(it.type || "info").toLowerCase();
      if (!ALLOWED_TYPES.has(type)) pushReason(reasons, `Item ${i + 1} har okänd typ: ${type || "?"}.`);

      // Mintext för allt
      const txt = getPrimaryText(it);
      if (!txt && !isQuestionType(type)) pushReason(reasons, `Item ${i + 1} saknar text/instruction/prompt.`);

      // För frågor krävs fråga + facit
      if (isQuestionType(type)) {
        const q = normStr(it.question || it.q || "");
        if (!q) pushReason(reasons, `Fråga ${i + 1} saknar question.`);
        if (!hasAnswer(it)) pushReason(reasons, `Fråga ${i + 1} saknar facit/answer.`);
      }
    }

    return { ok: reasons.length === 0, reasons };
  };

  // ------------------------------
  // Normalize item (fail-safe)
  // ------------------------------
  contract.normalizeItem = function (it) {
    if (!isPlainObject(it)) return { type: "info", text: "" };

    const out = Object.assign({}, it);
    const type = normStr(out.type || "info").toLowerCase();
    out.type = ALLOWED_TYPES.has(type) ? type : "info";

    // Trima strängfält (utan att röra objekt)
    const STR_KEYS = [
      "text", "instruction", "prompt", "question", "explanation", "feedback",
      "rationale", "reason", "title", "heading", "answer", "correctAnswer", "facit"
    ];
    for (const k of STR_KEYS) {
      if (typeof out[k] === "string") out[k] = normStr(out[k]);
    }

    // MCQ options -> trim
    if (Array.isArray(out.options)) {
      out.options = out.options.map(x => (typeof x === "string" ? normStr(x) : x)).filter(x => x !== "");
    }

    return out;
  };
})();
