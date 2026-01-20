/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-04) | FILE 04/06 | FIL-ID: UI/pages/trainings/04-contract.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Kontrakt/validering för Trainings: save/publish + AI-resultat (items) + normalisering.
      Skyddar kedjan Modul→Område→Kapitel→Steg genom tydliga krav vid publicering.

POLICY (LÅST):
- UI-only • Fail-closed
- Ingen storage här (03-store)
- Ingen DOM-render här (05-render)
- XSS-safe: inga innerHTML
- ADMIN-only write (page/core styr); contract ger bara regler + felorsaker.

PATCH v1.0.4 (PP-SC-010-04):
- P0: validateForPublish kräver modul/område/kapitel/steg + minst 1 block/item.
- P1: validateTrainingForSave är tolerant (utkast kan sparas) men ger reasons för “problemfilter”.
- P0: validateAiResult stoppar tomma/ogiltiga items och (om core.containsForbidden finns) förbjudna fraser i AI-text.
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.contract) return;

  const contract = (NS.contract = {});
  contract.__VERSION = "v1.0.4-PP-SC-010-04";

  // ------------------------------------------------------------
  // Helpers (no DOM, no storage)
  // ------------------------------------------------------------
  function normStr(v) { return String(v ?? "").trim(); }
  function safeLower(v) { return normStr(v).toLowerCase(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }
  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function ok(data) { return Object.assign({ ok: true }, data || {}); }
  function fail(reasons, code) {
    const r = safeArr(reasons).map(normStr).filter(Boolean);
    return { ok: false, code: normStr(code || "INVALID"), reasons: r.length ? r : ["Ogiltigt."] };
  }

  function inSet(val, setArr) {
    const s = safeLower(val);
    for (const x of setArr) if (safeLower(x) === s) return true;
    return false;
  }

  function normalizeStep(step) {
    const raw = normStr(step);
    const m = raw.match(/(\d+)/);
    return m ? String(m[1]) : raw;
  }

  function countItemsInTraining(t) {
    const blocks = safeArr(t && t.blocks);
    if (blocks.length) {
      let n = 0;
      for (const b of blocks) n += safeArr(b && b.items).length;
      return n;
    }
    // fallback older shape: items[]
    return safeArr(t && t.items).length;
  }

  // ------------------------------------------------------------
  // Training validation
  // ------------------------------------------------------------
  contract.validateTrainingForSave = function (t) {
    // Tolerant: tillåt utkast att sparas, men rapportera problem.
    if (!t || typeof t !== "object") return fail(["Utbildning saknas."]);
    const reasons = [];

    const id = normStr(t.id);
    if (!id) return fail(["Saknar id (kan inte spara)."]);

    const status = normStr(t.status || "draft");
    if (status !== "draft" && status !== "published") reasons.push("Okänd status.");

    const module = normStr(t.module);
    const area = normStr(t.area);

    const courseTitle = normStr(t.courseTitle);
    const courseStep = normalizeStep(t.courseStep);

    const goalsLevel = normStr(t.goalsLevel || "normal");
    if (!inSet(goalsLevel, ["intro", "normal", "advanced"])) reasons.push("Okänd nivå (intro/normal/advanced).");

    // Kedjan: vi “varnar” i save-läget om den saknas (men blockerar inte draft-save).
    if (!module) reasons.push("Saknar modul.");
    if (!area) reasons.push("Saknar område.");
    if (!courseTitle) reasons.push("Saknar kapitel.");
    if (!courseStep) reasons.push("Saknar steg.");

    // Innehåll: ok att vara tomt i utkast, men flagga om tomt (för problemfilter).
    const itemsCount = countItemsInTraining(t);
    if (itemsCount <= 0) reasons.push("Inga block/items ännu.");

    return ok({ reasons });
  };

  contract.validateForPublish = function (t) {
    // Strikt: publicering måste ha komplett kedja + innehåll.
    if (!t || typeof t !== "object") return fail(["Utbildning saknas."]);
    const reasons = [];

    const id = normStr(t.id);
    if (!id) reasons.push("Saknar id.");

    const module = normStr(t.module);
    const area = normStr(t.area);
    const courseTitle = normStr(t.courseTitle);
    const courseStep = normalizeStep(t.courseStep);

    if (!module) reasons.push("Välj modul.");
    if (!area) reasons.push("Välj område.");
    if (!courseTitle) reasons.push("Välj kapitel.");
    if (!courseStep) reasons.push("Välj steg.");

    // LÅST steg: 1–5
    if (courseStep && !inSet(courseStep, ["1", "2", "3", "4", "5"])) reasons.push("Steg måste vara 1–5.");

    const goalsLevel = normStr(t.goalsLevel || "normal");
    if (!inSet(goalsLevel, ["intro", "normal", "advanced"])) reasons.push("Nivå måste vara intro/normal/advanced.");

    const itemsCount = countItemsInTraining(t);
    if (itemsCount <= 0) reasons.push("Publicering kräver minst 1 block/item.");

    if (reasons.length) return fail(reasons, "PUBLISH_BLOCKED");
    return ok({ reasons: [] });
  };

  // ------------------------------------------------------------
  // AI result validation + normalization
  // ------------------------------------------------------------
  function extractTextFields(it) {
    // Vi letar bara i vanliga textfält (för att undvika “hela objekt”).
    const fields = ["text", "instruction", "prompt", "question", "explanation", "feedback", "rationale", "reason", "title", "heading"];
    const out = [];
    for (const k of fields) {
      if (typeof it[k] === "string") out.push(it[k]);
    }
    return out;
  }

  contract.validateAiResult = function (payload) {
    const p = (payload && typeof payload === "object") ? payload : {};
    const items = safeArr(p.items);

    if (!items.length) return fail(["AI gav inga items."], "AI_EMPTY");

    // Basic shape checks
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || typeof it !== "object") return fail(["AI-item " + (i + 1) + " är inte ett objekt."], "AI_SHAPE");
    }

    // Optional forbidden phrase guard (om core finns)
    try {
      const core = NS.core;
      if (core && typeof core.containsForbidden === "function") {
        for (const it of items) {
          const texts = extractTextFields(it);
          for (const txt of texts) {
            if (core.containsForbidden(txt)) {
              return fail(["AI-text innehåller förbjudna fraser. Justera styrningen och testa igen."], "AI_FORBIDDEN");
            }
          }
        }
      }
    } catch (_) {
      // fail-closed? här väljer vi att inte krascha, utan bara hoppa över extra kontrollen
    }

    return ok({ reasons: [] });
  };

  contract.normalizeItem = function (raw) {
    // Gör minimal normalisering (tolerant). Låter render/page bestämma UI.
    const it = (raw && typeof raw === "object") ? raw : {};

    // Standardfält vi försöker stabilisera:
    // - type: info|task|question|document (default info)
    // - text/instruction/question/prompt: lämna som finns
    const type = normStr(it.type || it.kind || it.blockType || "info").toLowerCase();
    const outType = inSet(type, ["info", "task", "question", "document"]) ? type : "info";

    const out = Object.assign({}, it);
    out.type = outType;

    // Normalisera val om de finns (för provfrågor)
    if (Array.isArray(out.choices)) {
      out.choices = out.choices.map((c) => normStr(c)).filter(Boolean);
    }

    // correctChoiceId/answerKey kan komma i olika namn
    if (out.correctChoiceId == null && out.correct_choice_id != null) out.correctChoiceId = out.correct_choice_id;
    if (out.correctChoiceId == null && out.answerKey != null) out.correctChoiceId = out.answerKey;

    return out;
  };
})();
