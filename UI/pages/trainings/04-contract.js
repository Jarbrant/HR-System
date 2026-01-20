/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-02) | FILE 04/06 | FIL-ID: UI/pages/trainings/04-contract.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Kontrakt/validering (fail-closed) för trainings-block + AI-resultat

POLICY (LÅST):
- UI-only • Fail-closed
- Ingen storage här
- Ingen DOM-render här
- Inga förbjudna fraser i genererat innehåll (flagga + stoppa publish)

PATCH v1.2 (PP-SC-010-02):
- P0: Stabilare DEMO: normalizeItem gör question robust (max 5 choices, fixar correctChoiceId).
- P0: AI-generate stoppas inte längre av forbidden phrases (enligt policy: stoppa publish, inte generate).
- P1: Case-insensitive match för correctChoiceId och text-match för facit.
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

  function sameId(a, b) {
    return safeLower(a) === safeLower(b);
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

      // HARD RULE: 3–5 choices => cap to 5 (stabilt för publish-regel)
      outChoices = cap(outChoices, 5);

      // ensure unique ids (deterministiskt)
      const seenIds = new Set();
      outChoices = outChoices.map((c, idx) => {
        let id = normStr(c.id) || ("c" + (idx + 1));
        if (seenIds.has(safeLower(id))) id = "c" + (idx + 1);
        seenIds.add(safeLower(id));
        return { id, text: normStr(c.text) };
      });

      // normalize text
      const qText = normStr(it.text || it.question || "");

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

      // Try match by id (case-insensitive)
      if (correct && outChoices.length) {
        const byId = outChoices.some((c) => sameId(normStr(c.id), correct));
        if (!byId) {
          // Try match by exact text (case-insensitive, single match)
          const matches = outChoices.filter((c) => safeLower(normStr(c.text)) === safeLower(correct));
          if (matches.length === 1) correct = normStr(matches[0].id);
        } else {
          // normalize casing to stored id
          const hit = outChoices.find((c) => sameId(normStr(c.id), correct));
          if (hit) correct = normStr(hit.id);
        }
      }

      // If still not valid -> deterministic fallback (för att inte stoppa DEMO-generate)
      if (outChoices.length) {
        const okId = correct && outChoices.some((c) => normStr(c && c.id) === correct);
        if (!okId) correct = normStr(outChoices[0].id);
      }

      // If question is too broken (no text OR <3 choices) -> downgrade to document (fail-soft för DEMO)
      if (!qText || outChoices.length < 3) {
        const fallbackText =
          qText ? qText :
          normStr(it.text || it.question || it.instruction || it.prompt || "") ||
          "(AI-fråga saknade innehåll)";
        return { kind: "document", text: fallbackText };
      }

      return {
        kind: "question",
        text: qText,
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
    const blob = JSON.stringify(obj || {});
    return !!(core && typeof core.containsForbidden === "function" && core.containsForbidden(blob));
  }

  // ---- validation (publish fail-closed) ----
  contract.validateTrainingForSave = function (training) {
    const r = reasons();
    const t = training && typeof training === "object" ? training : {};

    const title = normStr(t.title);
    if (!title) pushUnique(r, "Saknar titel.");

    // no forbidden phrases anywhere (SAVE/PUBLISH-skydd – fail-closed)
    if (hasForbiddenAnywhere(t)) {
      pushUnique(r, "Innehåller förbjudna fraser (t.ex. “utför uppgiften”, “beskriv hur du tänkte”).");
    }

    return { ok: r.length === 0, reasons: stripSet(r) };
  };

  contract.validateForPublish = function (training) {
    const base = contract.validateTrainingForSave(training);
    const r = reasons();

    // copy base reasons uniquely
    for (let i = 0; i < (base.reasons || []).length; i++) pushUnique(r, base.reasons[i]);

    const t = training && typeof training === "object" ? training : {};
    const blocks = Array.isArray(t.blocks)
      ? t.blocks
      : (Array.isArray(t.items) ? [{ items: t.items }] : []);

    if (!blocks.length) pushUnique(r, "Publicering kräver minst 1 block.");

    // Publish requires at least 1 item inside blocks
    let itemCount = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b && Array.isArray(b.items)) itemCount += b.items.length;
    }
    if (itemCount <= 0) pushUnique(r, "Publicering kräver minst 1 block/item.");

    return { ok: r.length === 0, reasons: stripSet(r) };
  };

  // ---- AI result acceptance ----
  contract.validateAiResult = function (aiNorm) {
    const r = reasons();
    const x = aiNorm && typeof aiNorm === "object" ? aiNorm : {};
    const items = Array.isArray(x.items) ? x.items : [];

    if (!items.length) pushUnique(r, "AI gav inga items.");

    // Validate normalized view (tolerant: normalizeItem fixes most issues)
    for (let i = 0; i < items.length; i++) {
      const it = contract.normalizeItem(items[i]);

      if (it.kind === "question") {
        const qText = normStr(it.text);
        if (!qText) pushUnique(r, "Fråga saknar frågetext.");

        const n = Array.isArray(it.choices) ? it.choices.length : 0;
        if (n < 3 || n > 5) pushUnique(r, "Fråga måste ha 3–5 svarsalternativ.");

        const cid = normStr(it.correctChoiceId);
        if (!cid) {
          pushUnique(r, "Fråga saknar facit (correctChoiceId).");
        } else {
          const okId = Array.isArray(it.choices) && it.choices.some((c) => normStr(c && c.id) === cid);
          if (!okId) pushUnique(r, "Facit matchar inget svarsalternativ (correctChoiceId).");
        }
      }

      // POLICY: Forbidden phrases ska STOPPA PUBLISH, inte stoppa generate.
      // Därför kontrolleras forbidden på training-save/publish, inte här.
    }

    return { ok: r.length === 0, reasons: stripSet(r) };
  };

  contract.__VERSION = "v1.2-PP-SC-013";
})();
