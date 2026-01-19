/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-03) | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Bootstrap + state + event wiring för trainings (ADMIN create/edit). Fix: "Skapa ny" ska fungera för ADMIN.

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys (endast AO-057_TRAININGS_V1 skrivs via 03-store)
- XSS-safe: render via 05-render.js + dom.setText (textContent)
- ADMIN-only write (MANAGER/SYSTEM_ADMIN read-only)

PATCH v1.0.0-PP-SC-010-03:
- P0: Rätt write-gate: ADMIN + canWrite => enable “Skapa ny” (om storage ej korrupt)
- P0: Fail-closed endast vid korrupt storage (inte p.g.a HRApp.getAuth() === null)
- P1: Fasta moduler/områden som bas + auto-dedupe från befintliga trainings
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  const dom = NS.dom;
  const core = NS.core;
  const store = NS.store;
  const contract = NS.contract;
  const render = NS.render;

  const page = (NS.page = NS.page || {});
  page.__VERSION = "v1.0-PP-SC-010-03";

  // ------------------------------------------------------------
  // State (ingen ny datamodell)
  // ------------------------------------------------------------
  const state = {
    who: { role: "SYSTEM_ADMIN", empNo: "", canWrite: false },
    canWrite: false,
    locked: false,
    lockReason: "",
    trainings: [],
    selectedId: "",
    draft: null, // current editable training (in-memory)
    dirty: false,
    showAll: false,
    q: "",
    fStatus: "",
    onlyProblems: false,

    // Bas-listor (fasta) - kan fortfarande skriva egna värden i input
    defaults: {
      modules: [
        "Kvalitet",
        "Säkerhet & arbetsmiljö",
        "Miljö",
        "Livsmedel",
        "Inköp",
        "Leverans",
        "Kundservice",
        "IT",
        "Ledning",
      ],
      // areas byggs dynamiskt per modul + plockas från data
      areasByModule: {
        "Kvalitet": ["ISO 9001", "Avvikelse", "CAPA", "Internrevision"],
        "Säkerhet & arbetsmiljö": ["Skyddsrond", "Incident", "Riskbedömning"],
        "Miljö": ["ISO 14001", "Avfall", "Energi", "Transport"],
        "Livsmedel": ["HACCP", "Kylkedja", "Hygien", "Allergen"],
        "Inköp": ["Leverantör", "Beställning", "Mottagning"],
        "Leverans": ["Plock", "Pack", "Rutt", "Temperatur"],
        "Kundservice": ["Samtal", "Ärende", "Bemötande"],
        "IT": ["Behörighet", "Support", "Säkerhet"],
        "Ledning": ["Mål", "Uppföljning", "Policy"],
      },
    },
  };

  // ------------------------------------------------------------
  // Utils
  // ------------------------------------------------------------
  function normStr(v) { return core ? core.normStr(v) : String(v ?? "").trim(); }

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; }
  }

  function safeArr(a) { return Array.isArray(a) ? a : []; }

  function findTrainingIndexById(id) {
    const tid = normStr(id);
    if (!tid) return -1;
    for (let i = 0; i < state.trainings.length; i++) {
      if (normStr(state.trainings[i] && state.trainings[i].id) === tid) return i;
    }
    return -1;
  }

  function buildSubjectId(module, area) {
    const m = normStr(module);
    const a = normStr(area);
    if (!m && !a) return "—";
    return (m || "—") + "::" + (a || "—");
  }

  function computeGeneratedTitle() {
    const chapter = normStr(dom.courseTitle.value);
    const step = normStr(dom.courseStep.value);
    const area = normStr(dom.area.value);
    if (!core || typeof core.composeTitle !== "function") return normStr(area) || "—";
    return core.composeTitle(chapter, step, area || "—");
  }

  function currentBlocks() {
    const d = state.draft || {};
    // Stöd för legacy: items[] direkt
    if (Array.isArray(d.blocks)) return d.blocks;
    if (Array.isArray(d.items)) return [{ title: d.title || "(block)", items: d.items }];
    return [];
  }

  function hasAnyItems() {
    const blocks = currentBlocks();
    let n = 0;
    for (const b of blocks) {
      if (b && Array.isArray(b.items)) n += b.items.length;
    }
    return n > 0;
  }

  function isWriterAllowed() {
    // RIKTIG gate: ADMIN och canWrite=true
    const who = state.who || {};
    const role = String(who.role || "SYSTEM_ADMIN").toUpperCase();
    if (state.locked) return false;
    if (role !== "ADMIN") return false;
    return !!who.canWrite;
  }

  function setDirty(v) {
    state.dirty = !!v;
    dom.setText(dom.revertHint, state.dirty ? "Osparade ändringar" : "");
    dom.disable(dom.btnRevert, !state.dirty || !isWriterAllowed());
  }

  function setLock(corruptReason) {
    state.locked = true;
    state.lockReason = corruptReason || "Låst (fail-closed).";
  }

  // ------------------------------------------------------------
  // Datalist builders (fasta + från data)
  // ------------------------------------------------------------
  function uniqueSorted(list) {
    const set = new Set();
    for (const x of safeArr(list)) {
      const s = normStr(x);
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "sv"));
  }

  function collectModulesFromTrainings() {
    const out = [];
    for (const t of state.trainings) {
      if (!t) continue;
      if (t.module) out.push(t.module);
    }
    return uniqueSorted(out);
  }

  function collectAreasFromTrainingsForModule(module) {
    const m = normStr(module);
    const out = [];
    for (const t of state.trainings) {
      if (!t) continue;
      if (m && normStr(t.module) !== m) continue;
      if (t.area) out.push(t.area);
    }
    return uniqueSorted(out);
  }

  function renderModuleDatalist() {
    dom.modList.innerHTML = ""; // datalist items are safe (values only)
    const fixed = safeArr(state.defaults.modules);
    const fromData = collectModulesFromTrainings();
    const all = uniqueSorted(fixed.concat(fromData));
    for (const m of all) {
      const opt = document.createElement("option");
      opt.value = m;
      dom.modList.appendChild(opt);
    }
  }

  function renderAreaDatalist() {
    dom.areaList.innerHTML = "";
    const mod = normStr(dom.mod.value);
    const fixed = safeArr(state.defaults.areasByModule[mod] || []);
    const fromData = collectAreasFromTrainingsForModule(mod);
    const all = uniqueSorted(fixed.concat(fromData));
    for (const a of all) {
      const opt = document.createElement("option");
      opt.value = a;
      dom.areaList.appendChild(opt);
    }
  }

  // ------------------------------------------------------------
  // Rendering glue (list + editor fields)
  // ------------------------------------------------------------
  function computeProblemsForTraining(t) {
    if (!contract || typeof contract.validateTrainingForSave !== "function") return [];
    const res = contract.validateTrainingForSave(t);
    return res && Array.isArray(res.reasons) ? res.reasons : [];
  }

  function visibleTrainings() {
    const q = normStr(state.q).toLowerCase();
    const st = normStr(state.fStatus);
    const onlyProb = !!state.onlyProblems;

    const out = [];
    for (const t of state.trainings) {
      if (!t) continue;

      if (st && String(t.status || "draft") !== st) continue;

      if (q) {
        const blob = (normStr(t.title) + " " + normStr(t.module) + " " + normStr(t.area)).toLowerCase();
        if (!blob.includes(q)) continue;
      } else if (!state.showAll) {
        // search-first: utan sök och utan "Visa alla" -> visa tomt
        continue;
      }

      if (onlyProb) {
        const reasons = computeProblemsForTraining(t);
        if (!reasons.length) continue;
      }

      out.push(t);
    }

    return out;
  }

  function updateTopPills() {
    const who = state.who || {};
    const whoTxt = `${who.role || "—"} • ${who.empNo || "—"}${who.canWrite ? " • skriv" : " • read-only"}`;
    render && render.setWhoPill && render.setWhoPill(whoTxt);

    if (state.locked) {
      render.setStatePill("Status: LÅST", "bad");
    } else if (!isWriterAllowed()) {
      render.setStatePill("Status: Read-only", "warn");
    } else {
      render.setStatePill("Status: OK", "ok");
    }
  }

  function updateLeftHint() {
    if (state.locked) {
      render.setLeftHint(state.lockReason || "Låst (korrupt data).");
      return;
    }
    render.setLeftHint("Publicering kräver minst 1 block.");
  }

  function updateGeneratedFields() {
    const title = computeGeneratedTitle();
    dom.titleDisplay.value = title || "—";

    const sid = buildSubjectId(dom.mod.value, dom.area.value);
    dom.setText(dom.subjectIdText, sid);

    if (state.draft) {
      // titel är låst till kursplanen (ingen egen titel-input i UI)
      state.draft.title = title;
      state.draft.module = normStr(dom.mod.value);
      state.draft.area = normStr(dom.area.value);
      state.draft.courseTitle = normStr(dom.courseTitle.value);
      state.draft.courseStep = normStr(dom.courseStep.value);
    }
  }

  function fillEditorFromDraft() {
    const d = state.draft;
    if (!d) return;

    dom.mod.value = normStr(d.module);
    renderAreaDatalist();
    dom.area.value = normStr(d.area);

    dom.courseTitle.value = normStr(d.courseTitle) || "Introduktion";
    dom.courseStep.value = normStr(d.courseStep) || "1";

    dom.goalsLevel.value = normStr(d.goalsLevel) || "normal";
    dom.goals.value = normStr(d.goals) || "";

    updateGeneratedFields();

    // blocks
    const blocks = currentBlocks();
    render && render.renderBlocksList && render.renderBlocksList({
      blocks,
      onEdit: function (idx) { openBlockEditor(idx); },
      onDelete: function (idx) { deleteBlock(idx); },
    });
  }

  function refreshList() {
    const items = visibleTrainings();
    render && render.renderTrainingList && render.renderTrainingList({
      items,
      selectedId: state.selectedId,
      onPick: function (id) { selectTraining(id); },
    });
  }

  function updateButtons() {
    const writer = isWriterAllowed();

    // Main write actions
    dom.disable(dom.btnNew, !writer);
    dom.disable(dom.btnDelete, !writer || !state.selectedId);
    dom.disable(dom.btnPurge, !writer);

    dom.disable(dom.btnSaveDraft, !writer || !state.draft);
    dom.disable(dom.btnSavePublish, !writer || !state.draft);

    dom.disable(dom.btnGenAI, !writer || !state.draft);
    dom.disable(dom.btnTestAI, false); // test AI är ok även i read-only

    dom.disable(dom.btnModAll, false);
    dom.disable(dom.btnModClear, !writer);

    // Revert handled by setDirty()
    setDirty(state.dirty);
  }

  function updateUiAll() {
    updateTopPills();
    updateLeftHint();
    refreshList();
    fillEditorFromDraft();
    updateButtons();
  }

  // ------------------------------------------------------------
  // Selection / CRUD
  // ------------------------------------------------------------
  function selectTraining(id) {
    const idx = findTrainingIndexById(id);
    if (idx < 0) {
      state.selectedId = "";
      state.draft = null;
      setDirty(false);
      updateUiAll();
      return;
    }

    state.selectedId = normStr(id);
    state.draft = deepClone(state.trainings[idx]);
    setDirty(false);
    renderAreaDatalist();
    updateUiAll();
  }

  function newTrainingTemplate() {
    const who = state.who || {};
    return {
      id: core.makeId("tr"),
      status: "draft",
      module: "",
      area: "",
      courseTitle: "Introduktion",
      courseStep: "1",
      goalsLevel: "normal",
      goals: "",
      title: "Introduktion • Steg 1 • —",
      blocks: [],
      meta: {
        createdAt: Date.now(),
        createdBy: who.empNo || "",
      },
    };
  }

  function createNewTraining() {
    if (!isWriterAllowed()) return;

    const t = newTrainingTemplate();
    state.trainings.unshift(t);
    state.selectedId = t.id;
    state.draft = deepClone(t);

    // Spara direkt så att ny utbildning verkligen skapas (P0 expected behavior)
    const s = store.save(state.trainings);
    if (!s || !s.ok) {
      render.setStatePill("Status: Kunde inte spara", "bad");
      return;
    }

    state.showAll = true; // så den syns direkt i listan
    setDirty(false);
    renderModuleDatalist();
    renderAreaDatalist();
    updateUiAll();
  }

  function deleteSelected() {
    if (!isWriterAllowed()) return;
    if (!state.selectedId) return;

    const idx = findTrainingIndexById(state.selectedId);
    if (idx < 0) return;

    state.trainings.splice(idx, 1);
    const s = store.save(state.trainings);
    if (!s || !s.ok) {
      render.setStatePill("Status: Kunde inte spara", "bad");
      return;
    }

    state.selectedId = "";
    state.draft = null;
    setDirty(false);
    renderModuleDatalist();
    renderAreaDatalist();
    updateUiAll();
  }

  function purgeAll() {
    if (!isWriterAllowed()) return;

    const p = store.purgeAll();
    if (!p || !p.ok) {
      render.setStatePill("Status: Kunde inte rensa", "bad");
      return;
    }

    state.trainings = [];
    state.selectedId = "";
    state.draft = null;
    state.showAll = false;
    setDirty(false);
    renderModuleDatalist();
    renderAreaDatalist();
    updateUiAll();
  }

  function revertUnsaved() {
    if (!isWriterAllowed()) return;
    if (!state.selectedId) return;
    const idx = findTrainingIndexById(state.selectedId);
    if (idx < 0) return;

    state.draft = deepClone(state.trainings[idx]);
    setDirty(false);
    updateUiAll();
  }

  function writeBackDraft(status) {
    if (!isWriterAllowed()) return;
    if (!state.draft) return;

    // sync from inputs
    state.draft.module = normStr(dom.mod.value);
    state.draft.area = normStr(dom.area.value);
    state.draft.courseTitle = normStr(dom.courseTitle.value);
    state.draft.courseStep = normStr(dom.courseStep.value);
    state.draft.goalsLevel = normStr(dom.goalsLevel.value);
    state.draft.goals = normStr(dom.goals.value);
    state.draft.title = computeGeneratedTitle();

    if (status === "published") state.draft.status = "published";
    else state.draft.status = "draft";

    // Validate
    const v = (status === "published" && contract && contract.validateForPublish)
      ? contract.validateForPublish(state.draft)
      : (contract && contract.validateTrainingForSave)
        ? contract.validateTrainingForSave(state.draft)
        : { ok: true, reasons: [] };

    if (!v.ok) {
      render.setStatePill("Status: Kan inte spara", "bad");
      render.setAiHint((v.reasons || []).join(" "));
      return;
    }

    // Publish rule: must have items
    if (status === "published" && !hasAnyItems()) {
      render.setStatePill("Status: Kan inte publicera", "bad");
      render.setAiHint("Publicering kräver minst 1 block/item.");
      return;
    }

    const idx = findTrainingIndexById(state.selectedId);
    if (idx < 0) {
      render.setStatePill("Status: Saknar vald utbildning", "bad");
      return;
    }

    state.trainings[idx] = deepClone(state.draft);

    const s = store.save(state.trainings);
    if (!s || !s.ok) {
      render.setStatePill("Status: Kunde inte spara", "bad");
      return;
    }

    setDirty(false);
    render.setAiHint("");
    renderModuleDatalist();
    renderAreaDatalist();
    updateUiAll();
  }

  // ------------------------------------------------------------
  // Blocks (minimal baseline)
  // ------------------------------------------------------------
  function openBlockEditor(idx) {
    if (!state.draft) return;

    const blocks = currentBlocks();
    const b = blocks[idx];
    if (!b) return;

    // minimal editor: edit first item's text in textarea (safe)
    const wrap = document.createElement("div");

    const label = document.createElement("div");
    label.className = "muted2";
    label.style.textAlign = "left";
    label.textContent = "Redigera första raden i blocket (baseline).";
    wrap.appendChild(label);

    const ta = document.createElement("textarea");
    ta.className = "textarea";
    ta.value = (b.items && b.items[0] && (b.items[0].text || b.items[0].instruction)) ? String(b.items[0].text || b.items[0].instruction) : "";
    wrap.appendChild(ta);

    render.openModal("Block " + (idx + 1), wrap, function () {
      const txt = normStr(ta.value);
      if (!state.draft.blocks) state.draft.blocks = blocks;
      const bb = state.draft.blocks[idx];
      if (bb && Array.isArray(bb.items) && bb.items[0]) {
        bb.items[0].text = txt;
      }
      setDirty(true);
      updateUiAll();
    });
  }

  function deleteBlock(idx) {
    if (!isWriterAllowed()) return;
    if (!state.draft) return;

    const blocks = currentBlocks();
    if (idx < 0 || idx >= blocks.length) return;

    if (!Array.isArray(state.draft.blocks)) state.draft.blocks = blocks;
    state.draft.blocks.splice(idx, 1);
    setDirty(true);
    updateUiAll();
  }

  // ------------------------------------------------------------
  // AI hooks (health + generate via SDK)
  // ------------------------------------------------------------
  async function testAi() {
    try {
      if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.health !== "function") {
        render.setStatePill("Status: Worker SDK saknas", "bad");
        return;
      }
      const r = await window.HRWorkerSDK.health();
      if (r && r.ok) render.setStatePill("Status: AI OK", "ok");
      else render.setStatePill("Status: AI fel", "warn");
    } catch (e) {
      render.setStatePill("Status: AI fel", "bad");
    }
  }

  async function generateAi() {
    if (!isWriterAllowed()) return;
    if (!state.draft) return;

    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.aiGenerate !== "function") {
      render.setStatePill("Status: Worker SDK saknas", "bad");
      return;
    }

    // Build context
    const ctx = core.buildAiContext({
      module: normStr(dom.mod.value),
      area: normStr(dom.area.value),
      courseTitle: normStr(dom.courseTitle.value),
      courseStep: normStr(dom.courseStep.value),
      goalsLevel: normStr(dom.goalsLevel.value),
      goals: normStr(dom.goals.value),
    });

    // mode + count
    const mode = normStr(dom.aiContent.value) === "questions" ? "questions" : "blocks";
    const count = Number(normStr(dom.aiCount.value) || "3") || 3;

    render.setAiHint("AI kör…");

    try {
      const res = await window.HRWorkerSDK.aiGenerate({
        mode,
        count,
        context: ctx,
        language: "sv",
        questionType: normStr(dom.aiQuestionType.value) || "auto",
        feedbackEnabled: !!dom.aiFeedbackEnabled.checked,
      });

      const norm = core.normalizeAiResult(res);
      const v = contract.validateAiResult(norm);
      if (!v.ok) {
        render.setStatePill("Status: AI underkänd", "bad");
        render.setAiHint((v.reasons || []).join(" "));
        return;
      }

      // Convert AI items -> one block (baseline)
      const items = safeArr(norm.items).map(contract.normalizeItem);
      const newBlock = {
        title: state.draft.title || "(block)",
        module: normStr(dom.mod.value),
        area: normStr(dom.area.value),
        step: normStr(dom.courseStep.value),
        status: "draft",
        items,
      };

      if (!Array.isArray(state.draft.blocks)) state.draft.blocks = [];
      state.draft.blocks.push(newBlock);

      setDirty(true);
      render.setAiHint("AI klart. Block tillagt.");
      updateUiAll();
    } catch (e) {
      render.setStatePill("Status: AI fel", "bad");
      render.setAiHint("AI misslyckades.");
    }
  }

  function syncAiUi() {
    const isQuestions = normStr(dom.aiContent.value) === "questions";
    if (isQuestions) dom.show(dom.questionControls);
    else dom.hide(dom.questionControls);
  }

  // ------------------------------------------------------------
  // Bootstrap
  // ------------------------------------------------------------
  function boot() {
    try {
      core.assert(dom && core && store && contract && render, "BOOT", "Deps saknas");
    } catch (e) {
      // Fail-closed: inget mer
      return;
    }

    // Who / access (OBS: getAuth() kan vara null – ska INTE låsa create)
    state.who = core.getWho();
    state.canWrite = (String(state.who.role || "").toUpperCase() === "ADMIN") && !!state.who.canWrite;

    // Load trainings
    const load = store.load();
    if (!load.ok && load.corrupt) {
      setLock(store.lockReasonFor ? store.lockReasonFor() : "Korrupt trainings.");
      state.trainings = [];
    } else {
      state.trainings = safeArr(load.trainings);
    }

    // Initial datalists
    renderModuleDatalist();
    renderAreaDatalist();

    // Initial search-first mode
    state.showAll = false;

    // Wire events
    dom.on(dom.btnNew, "click", createNewTraining);
    dom.on(dom.btnDelete, "click", deleteSelected);
    dom.on(dom.btnPurge, "click", purgeAll);
    dom.on(dom.btnRevert, "click", revertUnsaved);

    dom.on(dom.btnSaveDraft, "click", function () { writeBackDraft("draft"); });
    dom.on(dom.btnSavePublish, "click", function () { writeBackDraft("published"); });

    dom.on(dom.btnShowAll, "click", function () {
      state.showAll = true;
      refreshList();
    });

    dom.on(dom.btnClear, "click", function () {
      state.q = "";
      state.fStatus = "";
      state.onlyProblems = false;
      dom.q.value = "";
      dom.fStatus.value = "";
      dom.onlyProblems.checked = false;
      state.showAll = false;
      refreshList();
    });

    dom.on(dom.q, "input", function () {
      state.q = normStr(dom.q.value);
      // search-first: om man börjar skriva -> visa listan
      state.showAll = state.showAll || !!state.q;
      refreshList();
    });

    dom.on(dom.fStatus, "change", function () {
      state.fStatus = normStr(dom.fStatus.value);
      state.showAll = true;
      refreshList();
    });

    dom.on(dom.onlyProblems, "change", function () {
      state.onlyProblems = !!dom.onlyProblems.checked;
      state.showAll = true;
      refreshList();
    });

    dom.on(dom.btnModAll, "click", function () {
      // Baseline: sätt fokus + visa list (datalist öppnas av browser)
      dom.mod.focus();
    });

    dom.on(dom.btnModClear, "click", function () {
      if (!isWriterAllowed()) return;
      dom.mod.value = "";
      dom.area.value = "";
      updateGeneratedFields();
      setDirty(true);
      renderAreaDatalist();
    });

    // Editor inputs
    const onEditorChange = function () {
      if (!state.draft) return;
      updateGeneratedFields();
      setDirty(true);
      renderAreaDatalist();
    };

    dom.on(dom.mod, "input", onEditorChange);
    dom.on(dom.area, "input", onEditorChange);
    dom.on(dom.courseTitle, "change", onEditorChange);
    dom.on(dom.courseStep, "change", onEditorChange);
    dom.on(dom.goalsLevel, "change", function () { if (state.draft) { state.draft.goalsLevel = normStr(dom.goalsLevel.value); setDirty(true); } });
    dom.on(dom.goals, "input", function () { if (state.draft) { state.draft.goals = normStr(dom.goals.value); setDirty(true); } });

    // AI
    dom.on(dom.aiContent, "change", function () { syncAiUi(); });
    dom.on(dom.btnTestAI, "click", testAi);
    dom.on(dom.btnGenAI, "click", generateAi);
    syncAiUi();

    // Logout uses HRApp if available
    dom.on(dom.btnLogout, "click", function () {
      try {
        if (window.HRApp && typeof window.HRApp.logout === "function") window.HRApp.logout();
        else if (window.HRApp && typeof window.HRApp.clearSession === "function") window.HRApp.clearSession();
      } catch (_) { }
      location.href = "./login.html";
    });

    // First paint
    updateUiAll();
  }

  // Run
  try { boot(); } catch (_) { /* fail-closed */ }
})();
