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

  function normStr(v) {
    return (core && core.normStr) ? core.normStr(v) : String(v ?? "").trim();
  }

  function safeLower(v) {
    return (core && core.safeLower) ? core.safeLower(v) : normStr(v).toLowerCase();
  }

  function reasons() { return []; }

  function pushUnique(list, msg) {
    const m = normStr(msg);
    if (!m) return;
    if (!list._set) list._set = new Set();
    const key = m.toLowerCase();
    if (list._set.has(key)) return;
    list._set.add(key);
    list.push(m);
  }

  function stripSet(list) {
    try { delete list._set; } catch (_) {}
    return list;
  }

  function cap(arr, n) {
    const a = Array.isArray(arr) ? arr : [];
    return a.length > n ? a.slice(0, n) : a;
  }

  // ---- minimal item normalization (training-sidan behöver tåla legacy) ----
  contract.normalizeItem = function (raw) {
    const it = raw && typeof raw === "object" ? raw : {};
    const kindRaw = safeLower(it.kind || it.type || "document");

    const kind =
      (kindRaw === "question" || kindRaw === "quiz") ? "question" :
      (kindRaw === "task") ? "task" :
      "document";

    if (kind === "question") {
      // Preferred: choices[{id,text}], correctChoiceId
      const choicesIn = Array.isArray(it.choices) ? it.choices : [];
      const optionsIn = Array.isArray(it.options) ? it.options : [];

      // normalize into choices if only options exist
      let outChoices = [];
      if (!choicesIn.length && optionsIn.length) {
        for (let i = 0; i < optionsIn.length; i++) {
          const txt = normStr(optionsIn[i]);
          if (!txt) continue;
          outChoices.push({ id: "c" + (i + 1), text: txt });
        }
      } else {
        for (let i = 0; i < choicesIn.length; i++) {
          const c = choicesIn[i] && typeof choicesIn[i] === "object" ? choicesIn[i] : {};
          const id = normStr(c.id) || ("c" + (i + 1));
          const text = normStr(c.text);
          if (!text) continue;
          outChoices.push({ id, text });
        }
      }

      // cap + ensure unique ids (fail-closed-ish: fix duplicates deterministically)
      outChoices = cap(outChoices, 6);
      const seenIds = new Set();
      outChoices = outChoices.map((c, idx) => {
        let id = normStr(c.id) || ("c" + (idx + 1));
        if (seenIds.has(id)) id = "c" + (idx + 1);
        seenIds.add(id);
        return { id, text: normStr(c.text) };
      });

      // correctChoiceId: support legacy shapes
      let correct = normStr(
        it.correctChoiceId ||
        (it.answerKeyObj && it.answerKeyObj.correctChoiceId) ||
        it.answerKey ||
        ""
      );

      // If correct is numeric index (1..N) -> map to "cN"
      if (correct && /^[0-9]+$/.test(correct)) {
        const n = Number(correct);
        if (Number.isFinite(n) && n >= 1 && n <= 20) correct = "c" + n;
      }

      // If correct looks like choice text, try match exactly (single match)
      if (correct && outChoices.length) {
        const byId = outChoices.some((c) => normStr(c.id) === correct);
        if (!byId) {
          const matches = outChoices.filter((c) => normStr(c.text) === correct);
          if (matches.length === 1) correct = normStr(matches[0].id);
        }
      }

      return {
        kind: "question",
        text: normStr(it.text || it.question || ""),
        choices: outChoices,
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
    const statusRaw = safeLower(b.status || "draft");

    return {
      kind: "block",
      title: normStr(b.title) || "(utan rubrik)",
      module: normStr(b.module) || "",
      area: normStr(b.area) || "",
      step: normStr(b.step) || "",
      status: (statusRaw === "published") ? "published" : "draft",
      items: items.map(contract.normalizeItem),
    };
  };

  function hasForbiddenAnywhere(obj) {
    // NOTE: Inga payload-loggar. Endast boolean-koll.
    const blob = JSON.stringify(obj || {});
    return !!(core && typeof core.containsForbidden === "function" && core.containsForbidden(blob));
  }

  // ---- validation (draft-save should allow warnings; publish fail-closed) ----
  contract.validateTrainingForSave = function (training) {
    const err = reasons();
    const warn = reasons();
    const t = training && typeof training === "object" ? training : {};

    const title = normStr(t.title);
    if (!title) pushUnique(err, "Saknar titel.");

    // POLICY: förbjudna fraser ska FLAGGAS men inte stoppa utkast i DEMO.
    if (hasForbiddenAnywhere(t)) {
      pushUnique(warn, "Varning: Innehåller förbjudna fraser. Kan inte publiceras förrän det är åtgärdat.");
    }

    return { ok: err.length === 0, reasons: stripSet(err), warnings: stripSet(warn) };
  };

  contract.validateForPublish = function (training) {
    const base = contract.validateTrainingForSave(training);
    const err = reasons();
    const warn = reasons();

    // Carry base
    for (let i = 0; i < (base.reasons || []).length; i++) pushUnique(err, base.reasons[i]);
    for (let i = 0; i < (base.warnings || []).length; i++) pushUnique(warn, base.warnings[i]);

    const t = training && typeof training === "object" ? training : {};
    const blocks = Array.isArray(t.blocks)
      ? t.blocks
      : (Array.isArray(t.items) ? [{ items: t.items }] : []);

    if (!blocks.length) pushUnique(err, "Publicering kräver minst 1 block.");

    // Publish requires at least 1 item inside blocks
    let itemCount = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b && Array.isArray(b.items)) itemCount += b.items.length;
    }
    if (itemCount <= 0) pushUnique(err, "Publicering kräver minst 1 block/item.");

    // FAIL-CLOSED: publish stoppas om förbjudna fraser finns kvar
    if (hasForbiddenAnywhere(t)) {
      pushUnique(err, "Kan inte publicera: Innehåller förbjudna fraser. Rensa/ändra texten och försök igen.");
    }

    return { ok: err.length === 0, reasons: stripSet(err), warnings: stripSet(warn) };
  };

  // ---- AI result acceptance ----
  contract.validateAiResult = function (aiNorm) {
    const err = reasons();
    const warn = reasons();
    const x = aiNorm && typeof aiNorm === "object" ? aiNorm : {};
    const items = Array.isArray(x.items) ? x.items : [];

    if (!items.length) pushUnique(err, "AI gav inga items.");

    // If any question: must have 3–5 choices and exactly 1 correct (id must match a choice)
    for (let i = 0; i < items.length; i++) {
      const it = contract.normalizeItem(items[i]);

      if (it.kind === "question") {
        const qText = normStr(it.text);
        if (!qText) pushUnique(err, "Fråga saknar frågetext.");

        const n = Array.isArray(it.choices) ? it.choices.length : 0;
        if (n < 3 || n > 5) pushUnique(err, "Fråga måste ha 3–5 svarsalternativ.");

        const cid = normStr(it.correctChoiceId);
        if (!cid) {
          pushUnique(err, "Fråga saknar facit (correctChoiceId).");
        } else {
          const okId = Array.isArray(it.choices) && it.choices.some((c) => normStr(c && c.id) === cid);
          if (!okId) pushUnique(err, "Facit matchar inget svarsalternativ (correctChoiceId).");
        }
      }

      // POLICY: förbjudna fraser ska flaggas men INTE stoppa att block skapas i draft.
      // Publish blockeras senare i validateForPublish (fail-closed).
      if (hasForbiddenAnywhere(it)) {
        pushUnique(warn, "AI-innehåll innehåller förbjudna fraser (måste åtgärdas innan publicering).");
      }
    }

    return { ok: err.length === 0, reasons: stripSet(err), warnings: stripSet(warn) };
  };

  contract.__VERSION = "v1.2-PP-SC-012-AIWARN";
})();
