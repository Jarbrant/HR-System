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

PATCH v1.0.0 (PP-SC-010-04):
- Stabil deterministisk kontrakt-layer
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.contract) return;

  const contract = (NS.contract = {});
  contract.__VERSION = "v1.0.0-PP-SC-010-04";

  function normStr(v) { return String(v ?? "").trim(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }
  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  // ------------------------------
  // Training validation
  // ------------------------------
  function hasBlocks(t) {
    const blocks = t && Array.isArray(t.blocks) ? t.blocks : [];
    return blocks.length > 0;
  }

  function countItems(t) {
    const blocks = t && Array.isArray(t.blocks) ? t.blocks : [];
    let n = 0;
    for (const b of blocks) {
      if (b && Array.isArray(b.items)) n += b.items.length;
    }
    return n;
  }

  contract.validateTrainingForSave = function (t) {
    const reasons = [];
    if (!t || typeof t !== "object") return { ok: false, reasons: ["Saknar training-objekt."] };

    const title = normStr(t.title);
    const module = normStr(t.module);
    const area = normStr(t.area);

    // Fail-closed men inte överstrikt: vi låter draft sparas även om vissa saknas,
    // men "problem"-läget ska kunna flagga det.
    if (!title) reasons.push("Saknar titel.");
    if (!module) reasons.push("Saknar modul.");
    if (!area) reasons.push("Saknar område.");

    // Goals är frivilligt i UI (och skickas ändå inte till AI enligt policy)
    // men vi kan flagga tomma mål som "problem" om man vill.
    // (håll snällt: bara som reason, inget stopp i save)
    // if (!normStr(t.goals)) reasons.push("Saknar mål (frivilligt).");

    // Save ska normalt vara ok även med reasons (för att inte låsa användaren),
    // men vi ger ok:true och reasons för problemfilter.
    return { ok: true, reasons };
  };

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

    // Hard requirement i policy: published kräver minst 1 block/item
    const nItems = countItems(t);
    if (nItems <= 0) reasons.push("Publicering: kräver minst 1 block/item.");

    return { ok: reasons.length === 0, reasons };
  };

  // ------------------------------
  // AI validation + normalization
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

    // Facit/answer: lämna om det är string/number/bool, annars rör ej.
    return out;
  };

  contract.validateAiResult = function (payload) {
    const reasons = [];
    const items = payload && Array.isArray(payload.items) ? payload.items : null;

    if (!items) return { ok: false, reasons: ["AI-resultat saknar items[]."] };
    if (items.length <= 0) return { ok: false, reasons: ["AI-resultat innehåller inga items."] };

    // Light sanity: varje item ska vara object eller string, men får normaliseras senare.
    let bad = 0;
    for (const it of items) {
      const ok = (typeof it === "string") || (it && typeof it === "object");
      if (!ok) bad++;
    }
    if (bad > 0) reasons.push("AI-resultat innehåller ogiltiga items.");

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

    // minst en huvudtext ska finnas
    const primary =
      normStr(it.text) ||
      normStr(it.instruction) ||
      normStr(it.prompt) ||
      normStr(it.question);

    if (!primary) reasons.push("Saknar text/instruction/prompt/question.");

    // om question-typ: försök kräva facit (men bara som problem-flagga, ej alltid stopp)
    if (t === "question") {
      const hasAnswer =
        typeof it.answer === "string" ? normStr(it.answer).length > 0 :
        typeof it.answer === "number" ? true :
        typeof it.answer === "boolean" ? true :
        typeof it.correct === "string" ? normStr(it.correct).length > 0 :
        typeof it.correct === "number" ? true :
        typeof it.correct === "boolean" ? true :
        false;

      if (!hasAnswer) reasons.push("Fråga saknar facit (answer/correct).");
    }

    return { ok: reasons.length === 0, reasons };
  };
})();
