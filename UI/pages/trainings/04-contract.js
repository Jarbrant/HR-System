/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-02) | FILE 04/06 | FIL-ID: UI/pages/trainings/04-contract.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Kontrakt/validering (fail-closed) för trainings-block + AI-resultat

POLICY (LÅST):
- UI-only • Fail-closed
- Ingen storage här
- Ingen DOM-render här
- Inga förbjudna fraser i genererat innehåll (flagga + stoppa publish)
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.contract) return;

  const core = NS.core;

  const contract = (NS.contract = {});

  function normStr(v) { return (core && core.normStr) ? core.normStr(v) : String(v ?? "").trim(); }

  function reasons() { return []; }

  // ---- minimal item normalization (training-sidan behöver tåla legacy)
  contract.normalizeItem = function (raw) {
    const it = raw && typeof raw === "object" ? raw : {};
    const kind = String(it.kind || it.type || "document");

    if (kind === "question") {
      // Preferred: choices[{id,text}], correctChoiceId
      const choices = Array.isArray(it.choices) ? it.choices : [];
      const options = Array.isArray(it.options) ? it.options : [];

      // normalize into choices if only options exist
      let outChoices = choices;
      if (!outChoices.length && options.length) {
        outChoices = options.filter(Boolean).map((txt, i) => ({ id: "c" + (i + 1), text: normStr(txt) }));
      } else {
        outChoices = outChoices.map((c, i) => ({ id: normStr(c.id) || ("c" + (i + 1)), text: normStr(c.text) }));
      }

      const correct = normStr(it.correctChoiceId || (it.answerKeyObj && it.answerKeyObj.correctChoiceId) || it.answerKey || "");

      return {
        kind: "question",
        text: normStr(it.text || it.question || ""),
        choices: outChoices.slice(0, 6), // cap
        correctChoiceId: correct,
        rationale: normStr(it.rationale || (it.answerKeyObj && it.answerKeyObj.rationale) || ""),
      };
    }

    if (kind === "task") {
      const t = normStr(it.text || it.instruction || "");
      return { kind: "task", text: t, deliverable: normStr(it.deliverable || "") };
    }

    // document/info default
    return { kind: "document", text: normStr(it.text || it.instruction || "") };
  };

  contract.normalizeBlock = function (raw) {
    const b = raw && typeof raw === "object" ? raw : {};
    const items = Array.isArray(b.items) ? b.items : [];
    return {
      kind: "block",
      title: normStr(b.title) || "(utan rubrik)",
      module: normStr(b.module) || "",
      area: normStr(b.area) || "",
      step: normStr(b.step) || "",
      status: String(b.status || "draft").toLowerCase() === "published" ? "published" : "draft",
      items: items.map(contract.normalizeItem),
    };
  };

  // ---- validation (publish fail-closed) ----
  contract.validateTrainingForSave = function (training) {
    const r = reasons();
    const t = training && typeof training === "object" ? training : {};

    const title = normStr(t.title);
    if (!title) r.push("Saknar titel.");

    // no forbidden phrases anywhere
    const blob = JSON.stringify(t || {});
    if (core && typeof core.containsForbidden === "function" && core.containsForbidden(blob)) {
      r.push("Innehåller förbjudna fraser (t.ex. “utför uppgiften”, “beskriv hur du tänkte”).");
    }

    return { ok: r.length === 0, reasons: r };
  };

  contract.validateForPublish = function (training) {
    const base = contract.validateTrainingForSave(training);
    const r = base.reasons.slice();

    const t = training && typeof training === "object" ? training : {};
    const blocks = Array.isArray(t.blocks) ? t.blocks : Array.isArray(t.items) ? [{ items: t.items }] : [];

    // Publish requires at least 1 block/item
    let itemCount = 0;
    for (const b of blocks) {
      if (b && Array.isArray(b.items)) itemCount += b.items.length;
    }
    if (itemCount <= 0) r.push("Publicering kräver minst 1 block/item.");

    return { ok: r.length === 0, reasons: r };
  };

  // ---- AI result acceptance ----
  contract.validateAiResult = function (aiNorm) {
    const r = reasons();
    const x = aiNorm && typeof aiNorm === "object" ? aiNorm : {};
    const items = Array.isArray(x.items) ? x.items : [];

    if (!items.length) r.push("AI gav inga items.");

    // If any question: must have 3–5 choices and exactly 1 correct
    for (const raw of items) {
      const it = contract.normalizeItem(raw);
      if (it.kind === "question") {
        const n = Array.isArray(it.choices) ? it.choices.length : 0;
        if (n < 3 || n > 5) r.push("Fråga måste ha 3–5 svarsalternativ.");
        if (!normStr(it.correctChoiceId)) r.push("Fråga saknar facit (correctChoiceId).");
      }
      const blob = JSON.stringify(it || {});
      if (core && typeof core.containsForbidden === "function" && core.containsForbidden(blob)) {
        r.push("AI-innehåll innehåller förbjudna fraser.");
      }
    }

    return { ok: r.length === 0, reasons: r };
  };

  contract.__VERSION = "v1.0-PP-SC-010-02";
})();

