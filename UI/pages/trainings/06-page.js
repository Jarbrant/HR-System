/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-03) | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Bootstrap + state + event wiring för trainings (ADMIN editor)

POLICY (LÅST):
- UI-only • Fail-closed
- localStorage-first (data), sessionStorage först (auth via HRApp)
- XSS-safe rendering: all render via 05-render.js (textContent, inga osäkra innerHTML)
- Inga nya storage-keys (AO-057_TRAININGS_V1)
- ADMIN-only write (MANAGER/SYSTEM_ADMIN read-only)
- Publish fail-closed: status=published kräver blocks/items > 0
- Token får inte lagras i webbläsaren (HRApp.getAuth() kan vara null och ska inte blocka ADMIN-write)

Ändringslogg (≤8):
- v1.0-PP-SC-010-03: Fix: skrivläge styrs av HRApp.getRole()/core.getWho (inte getAuth)
- v1.0-PP-SC-010-03: "Skapa ny" och spara-knappar aktiveras för ADMIN + canWrite:true
- v1.0-PP-SC-010-03: Fail-closed kvar: korrupt storage eller ej ADMIN => read-only
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.page) return;

  const dom = NS.dom;
  const core = NS.core;
  const store = NS.store;
  const contract = NS.contract;
  const render = NS.render;

  const page = (NS.page = {});
  page.__VERSION = "v1.0-PP-SC-010-03";

  // ---------------------------
  // State (ingen ny datamodell)
  // ---------------------------
  const state = {
    who: { role: "SYSTEM_ADMIN", empNo: "", canWrite: false },
    readOnly: true,
    lockReason: "",
    trainings: [],
    selectedId: "",
    selectedIndex: -1,
    showList: false,
    q: "",
    fStatus: "",
    onlyProblems: false,
    dirty: false,
    snapshotJson: "",

    // editor fields
    module: "",
    area: "",
    courseTitle: "Introduktion",
    courseStep: "1",
    goalsLevel: "normal",
    goals: "",
    titleDisplay: "—",
  };

  // ---------------------------
  // Helpers
  // ---------------------------
  function normStr(v) { return (core && core.normStr) ? core.normStr(v) : String(v ?? "").trim(); }
  function safeLower(v) { return (core && core.safeLower) ? core.safeLower(v) : normStr(v).toLowerCase(); }

  function setDirty(on) {
    state.dirty = !!on;
    if (dom && dom.setText) dom.setText(dom.revertHint, state.dirty ? "Osparade ändringar" : "");
    // enable revert only when dirty + can write
    if (dom && dom.disable) dom.disable(dom.btnRevert, !(state.dirty && !state.readOnly));
  }

  function computeWhoAndMode() {
    // Viktigt: getAuth() får vara null och ska inte styra skrivläge.
    let who = { role: "SYSTEM_ADMIN", empNo: "", canWrite: false };
    try {
      if (core && typeof core.getWho === "function") who = core.getWho();
      else if (window.HRApp && typeof window.HRApp.getRole === "function") {
        const r = window.HRApp.getRole() || {};
        who = { role: r.role || r.roleId || "SYSTEM_ADMIN", empNo: r.empNo || "", canWrite: !!r.canWrite };
      }
    } catch (_) {}

    state.who = who;

    const isAdmin = core && typeof core.isAdminWriter === "function"
      ? core.isAdminWriter(who)
      : String(who.role || "").toUpperCase() === "ADMIN";

    // ADMIN-only write + canWrite:true
    state.readOnly = !(isAdmin && !!who.canWrite);
  }

  function setTopbar() {
    const who = state.who || {};
    const role = String(who.role || "SYSTEM_ADMIN").toUpperCase();
    const empNo = normStr(who.empNo) || "—";
    const whoText = `Inloggad: ${empNo} (${role})`;
    render && render.setWhoPill && render.setWhoPill(whoText);

    // context pill är statisk här
    render && render.setContext && render.setContext("Redigerar: Utbildningar");
  }

  function setStatus(ok, txt) {
    const t = normStr(txt) || (ok ? "Status: OK" : "Status: Fel");
    render && render.setStatePill && render.setStatePill(t, ok ? "ok" : "bad");
  }

  function applyReadOnlyUI() {
    if (!dom || !dom.disable) return;

    // buttons
    dom.disable(dom.btnNew, state.readOnly);
    dom.disable(dom.btnDelete, state.readOnly);
    dom.disable(dom.btnPurge, state.readOnly);

    dom.disable(dom.btnSaveDraft, state.readOnly);
    dom.disable(dom.btnSavePublish, state.readOnly);
    dom.disable(dom.btnGenAI, state.readOnly);
    dom.disable(dom.btnTestAI, false); // test AI får vara ok även read-only

    // editor inputs
    const inputs = [
      dom.mod, dom.area, dom.courseTitle, dom.courseStep,
      dom.goalsLevel, dom.goals, dom.aiContent, dom.aiCount,
      dom.aiQuestionType, dom.aiFeedbackEnabled
    ];
    for (const el of inputs) {
      if (!el) continue;
      el.disabled = !!state.readOnly;
      if (state.readOnly) el.classList.add("disabled");
      else el.classList.remove("disabled");
    }

    // left hint
    if (state.lockReason) {
      render && render.setLeftHint && render.setLeftHint(state.lockReason);
    } else if (state.readOnly) {
      render && render.setLeftHint && render.setLeftHint("Read-only: du kan titta men inte spara/generera.");
    } else {
      render && render.setLeftHint && render.setLeftHint("Publicering kräver minst 1 block.");
    }

    // revert btn
    dom.disable(dom.btnRevert, !(state.dirty && !state.readOnly));
  }

  function loadTrainingsOrLock() {
    const res = store && store.load ? store.load() : { ok: false, err: "store.load saknas." };
    if (!res.ok) {
      state.lockReason = (res && res.corrupt) ? "Read-only (fail-closed): trainings är korrupt. " + (store.lockReasonFor ? store.lockReasonFor() : "")
                                             : "Kunde inte läsa trainings.";
      state.readOnly = true;
      state.trainings = [];
      return;
    }
    state.trainings = Array.isArray(res.trainings) ? res.trainings : [];
  }

  function saveAllOrFail() {
    if (state.readOnly) return { ok: false, err: "Read-only." };
    if (!store || typeof store.save !== "function") return { ok: false, err: "store.save saknas." };
    const res = store.save(state.trainings);
    if (!res.ok) return res;
    return { ok: true };
  }

  function getSelected() {
    if (state.selectedIndex < 0) return null;
    return state.trainings[state.selectedIndex] || null;
  }

  function normalizeBlocksFromTraining(t) {
    const tr = t && typeof t === "object" ? t : {};
    if (Array.isArray(tr.blocks)) return tr.blocks;
    // legacy: items[] utan block-wrapper
    if (Array.isArray(tr.items)) return [{ title: tr.title || "Block 1", items: tr.items }];
    return [];
  }

  function computeGeneratedTitle() {
    state.titleDisplay = (core && core.composeTitle)
      ? core.composeTitle(state.courseTitle, state.courseStep, state.area)
      : `${state.courseTitle} • Steg ${state.courseStep} • ${state.area || "—"}`;

    if (dom && dom.setText) dom.setText(dom.titleDisplay, state.titleDisplay);
    if (dom && dom.titleDisplay) dom.titleDisplay.value = state.titleDisplay;
  }

  function syncEditorFromTraining(t) {
    const tr = t && typeof t === "object" ? t : {};

    state.module = normStr(tr.module);
    state.area = normStr(tr.area);
    state.courseTitle = normStr(tr.courseTitle) || "Introduktion";
    state.courseStep = normStr(tr.courseStep) || "1";
    state.goalsLevel = normStr(tr.goalsLevel) || "normal";
    state.goals = normStr(tr.goals) || "";

    if (dom) {
      if (dom.mod) dom.mod.value = state.module;
      if (dom.area) dom.area.value = state.area;
      if (dom.courseTitle) dom.courseTitle.value = state.courseTitle;
      if (dom.courseStep) dom.courseStep.value = state.courseStep;
      if (dom.goalsLevel) dom.goalsLevel.value = state.goalsLevel;
      if (dom.goals) dom.goals.value = state.goals;
    }

    computeGeneratedTitle();

    // snapshot for revert
    try { state.snapshotJson = JSON.stringify(tr || {}); } catch (_) { state.snapshotJson = ""; }
    setDirty(false);
  }

  function syncTrainingFromEditor(t) {
    const tr = t && typeof t === "object" ? t : {};
    tr.module = normStr(dom && dom.mod ? dom.mod.value : state.module);
    tr.area = normStr(dom && dom.area ? dom.area.value : state.area);
    tr.courseTitle = normStr(dom && dom.courseTitle ? dom.courseTitle.value : state.courseTitle) || "Introduktion";
    tr.courseStep = normStr(dom && dom.courseStep ? dom.courseStep.value : state.courseStep) || "1";
    tr.goalsLevel = normStr(dom && dom.goalsLevel ? dom.goalsLevel.value : state.goalsLevel) || "normal";
    tr.goals = normStr(dom && dom.goals ? dom.goals.value : state.goals);

    // titleDisplay: vi använder den som "title" om title saknas (utan ny datamodell)
    computeGeneratedTitle();
    if (!normStr(tr.title)) tr.title = state.titleDisplay;

    return tr;
  }

  function buildListItems() {
    const q = safeLower(state.q);
    const fs = normStr(state.fStatus);
    const onlyProblems = !!state.onlyProblems;

    let items = state.trainings.slice();

    // filter status
    if (fs) items = items.filter((t) => String(t.status || "draft") === fs);

    // search title
    if (q) items = items.filter((t) => safeLower(t && t.title).includes(q));

    // problems (enkel baseline)
    if (onlyProblems) {
      items = items.filter((t) => {
        const title = normStr(t && t.title);
        if (!title) return true;
        const blob = JSON.stringify(t || {});
        if (core && core.containsForbidden && core.containsForbidden(blob)) return true;
        return false;
      });
    }

    return items;
  }

  function renderAll() {
    // list
    render && render.renderTrainingList && render.renderTrainingList({
      items: buildListItems(),
      selectedId: state.selectedId,
      onPick: function (id) { pickTraining(id); }
    });

    // blocks
    const t = getSelected();
    const blocks = normalizeBlocksFromTraining(t);
    render && render.renderBlocksList && render.renderBlocksList({
      blocks,
      onEdit: function (idx) { editBlock(idx); },
      onDelete: function (idx) { deleteBlock(idx); }
    });

    // subjectId = module::area (enkel, stabil)
    const subjectId = (normStr(state.module) || "—") + "::" + (normStr(state.area) || "—");
    if (dom && dom.setText) dom.setText(dom.subjectIdText, subjectId);

    // AI hint
    if (render && render.setAiHint) {
      const chapterFocus = core && core.getChapterFocus ? core.getChapterFocus(state.courseTitle) : "";
      const stepFocus = core && core.getStepFocus ? core.getStepFocus(state.courseStep) : "";
      render.setAiHint(`${chapterFocus} ${stepFocus}`.trim());
    }

    // debug
    updateDebug();
  }

  function updateDebug() {
    if (!dom || !dom.debugPre) return;
    const payload = {
      version: page.__VERSION,
      who: state.who,
      readOnly: state.readOnly,
      lockReason: state.lockReason,
      trainingsCount: state.trainings.length,
      selectedId: state.selectedId,
      dirty: state.dirty,
    };
    try { dom.debugPre.textContent = JSON.stringify(payload, null, 2); }
    catch (_) { dom.debugPre.textContent = String(payload); }
  }

  function pickTraining(id) {
    const s = normStr(id);
    const ix = state.trainings.findIndex((t) => normStr(t && t.id) === s);
    state.selectedId = s;
    state.selectedIndex = ix;

    const t = getSelected();
    if (t) syncEditorFromTraining(t);
    renderAll();
  }

  function createNewTraining() {
    if (state.readOnly) return;

    const t = {
      id: core && core.makeId ? core.makeId("tr") : ("tr_" + Date.now()),
      title: "",
      status: "draft",
      module: "",
      area: "",
      courseTitle: "Introduktion",
      courseStep: "1",
      goalsLevel: "normal",
      goals: "",
      blocks: []
    };

    // ta editor-värden direkt
    syncEditorFromTraining(t);
    t = syncTrainingFromEditor(t);

    state.trainings.unshift(t);
    const save = saveAllOrFail();
    if (!save.ok) {
      setStatus(false, "Status: Fel (kunde inte spara)");
      return;
    }

    setStatus(true, "Status: OK (skapad)");
    pickTraining(t.id);
  }

  function deleteSelectedTraining() {
    if (state.readOnly) return;
    if (state.selectedIndex < 0) return;

    const removed = state.trainings.splice(state.selectedIndex, 1);
    state.selectedId = "";
    state.selectedIndex = -1;

    const save = saveAllOrFail();
    if (!save.ok) {
      // försöker återställa (best effort)
      if (removed && removed.length) state.trainings.unshift(removed[0]);
      setStatus(false, "Status: Fel (kunde inte ta bort)");
      return;
    }

    setStatus(true, "Status: OK (borttagen)");
    renderAll();
  }

  function purgeAllTrainings() {
    if (state.readOnly) return;

    if (!store || typeof store.purgeAll !== "function") {
      setStatus(false, "Status: Fel (purge saknas)");
      return;
    }

    const res = store.purgeAll();
    if (!res.ok) {
      setStatus(false, "Status: Fel (kunde inte rensa)");
      return;
    }

    state.trainings = [];
    state.selectedId = "";
    state.selectedIndex = -1;
    setStatus(true, "Status: OK (rensat)");
    renderAll();
  }

  function revertUnsaved() {
    if (state.readOnly) return;
    const t = getSelected();
    if (!t) return;

    if (!state.snapshotJson) return;
    try {
      const snap = JSON.parse(state.snapshotJson);
      // ersätt objektet i arrayn
      state.trainings[state.selectedIndex] = snap;
      syncEditorFromTraining(snap);
      setStatus(true, "Status: OK (återställd)");
      renderAll();
    } catch (_) {
      setStatus(false, "Status: Fel (kunde inte återställa)");
    }
  }

  function saveSelected(mode /* draft|published */) {
    if (state.readOnly) return;

    const t = getSelected();
    if (!t) return;

    syncTrainingFromEditor(t);

    if (mode === "published") {
      t.status = "published";
      // publish validation
      const v = contract && contract.validateForPublish ? contract.validateForPublish(t) : { ok: true, reasons: [] };
      if (!v.ok) {
        setStatus(false, "Status: Fel (kan inte publicera)");
        render && render.setLeftHint && render.setLeftHint(v.reasons.join(" "));
        applyReadOnlyUI(); // håller UI konsekvent
        return;
      }
    } else {
      t.status = "draft";
      // save validation (mild)
      const v = contract && contract.validateTrainingForSave ? contract.validateTrainingForSave(t) : { ok: true, reasons: [] };
      if (!v.ok) {
        setStatus(false, "Status: Fel (kan inte spara)");
        render && render.setLeftHint && render.setLeftHint(v.reasons.join(" "));
        applyReadOnlyUI();
        return;
      }
    }

    const res = saveAllOrFail();
    if (!res.ok) {
      setStatus(false, "Status: Fel (spara misslyckades)");
      return;
    }

    // update snapshot
    try { state.snapshotJson = JSON.stringify(t || {}); } catch (_) { state.snapshotJson = ""; }
    setDirty(false);
    setStatus(true, "Status: OK (sparad)");
    renderAll();
  }

  // ---------------------------
  // Blocks editor (baseline)
  // ---------------------------
  function editBlock(idx) {
    if (state.readOnly) return;
    const t = getSelected();
    if (!t) return;
    const blocks = normalizeBlocksFromTraining(t);
    const b = blocks[idx];
    if (!b) return;

    // simple textarea editor: edit block title + raw items text (first pass)
    const host = document.createElement("div");
    host.style.display = "grid";
    host.style.gap = "10px";

    const titleLabel = document.createElement("div");
    titleLabel.className = "muted2";
    titleLabel.style.textAlign = "left";
    titleLabel.textContent = "Rubrik";

    const titleInput = document.createElement("input");
    titleInput.className = "input";
    titleInput.value = normStr(b.title);

    const itemsLabel = document.createElement("div");
    itemsLabel.className = "muted2";
    itemsLabel.style.textAlign = "left";
    itemsLabel.textContent = "Items (en rad per item – text)";

    const ta = document.createElement("textarea");
    ta.className = "textarea";
    const lines = Array.isArray(b.items) ? b.items.map((it) => normStr(it && (it.text || it.instruction || ""))) : [];
    ta.value = lines.join("\n");

    host.appendChild(titleLabel);
    host.appendChild(titleInput);
    host.appendChild(itemsLabel);
    host.appendChild(ta);

    render.openModal("Redigera block", host, function () {
      b.title = normStr(titleInput.value) || b.title;
      const newLines = normStr(ta.value).split("\n").map((x) => normStr(x)).filter(Boolean);
      b.items = newLines.map((txt) => ({ kind: "document", text: txt }));
      t.blocks = blocks;
      setDirty(true);
      renderAll();
    });
  }

  function deleteBlock(idx) {
    if (state.readOnly) return;
    const t = getSelected();
    if (!t) return;
    const blocks = normalizeBlocksFromTraining(t);
    if (!blocks[idx]) return;
    blocks.splice(idx, 1);
    t.blocks = blocks;
    setDirty(true);
    renderAll();
  }

  // ---------------------------
  // AI actions (baseline)
  // ---------------------------
  async function testAI() {
    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.health !== "function") {
      setStatus(false, "Status: Fel (Worker SDK saknas)");
      return;
    }
    try {
      const res = await window.HRWorkerSDK.health();
      if (res && res.ok) setStatus(true, "Status: OK (AI: health ok)");
      else setStatus(false, "Status: Fel (AI health)");
    } catch (e) {
      setStatus(false, "Status: Fel (AI health)");
    }
  }

  async function generateAI() {
    if (state.readOnly) return;

    const t = getSelected();
    if (!t) {
      setStatus(false, "Status: Fel (välj utbildning)");
      return;
    }

    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.aiGenerate !== "function") {
      setStatus(false, "Status: Fel (Worker SDK saknas)");
      return;
    }

    // build context
    const ctx = core && core.buildAiContext ? core.buildAiContext({
      module: normStr(dom.mod.value),
      area: normStr(dom.area.value),
      courseTitle: normStr(dom.courseTitle.value),
      courseStep: normStr(dom.courseStep.value),
      goalsLevel: normStr(dom.goalsLevel.value),
      goals: normStr(dom.goals.value),
    }) : {};

    const mode = normStr(dom.aiContent.value) || "blocks";
    const count = Number(normStr(dom.aiCount.value) || "3");
    const payload = { mode, count, context: ctx, language: "sv" };

    setStatus(true, "Status: OK (AI kör…)");

    try {
      const raw = await window.HRWorkerSDK.aiGenerate(payload);
      const norm = core && core.normalizeAiResult ? core.normalizeAiResult(raw) : (raw || {});
      const vr = contract && contract.validateAiResult ? contract.validateAiResult(norm) : { ok: true, reasons: [] };

      if (!vr.ok) {
        setStatus(false, "Status: Fel (AI-kontrakt)");
        render && render.setAiHint && render.setAiHint(vr.reasons.join(" "));
        return;
      }

      // accept items => append as one block
      const items = Array.isArray(norm.items) ? norm.items : [];
      const nItems = items.map(contract.normalizeItem ? contract.normalizeItem : (x) => x);

      const blocks = normalizeBlocksFromTraining(t);
      blocks.push({
        title: state.titleDisplay || ("Block " + (blocks.length + 1)),
        items: nItems
      });
      t.blocks = blocks;

      setDirty(true);
      setStatus(true, "Status: OK (AI klar)");
      renderAll();

    } catch (e) {
      setStatus(false, "Status: Fel (AI)");
    }
  }

  // ---------------------------
  // UI wiring
  // ---------------------------
  function wireEvents() {
    if (!dom || !dom.on) return;

    // logout
    dom.on(dom.btnLogout, "click", function () {
      try {
        if (window.HRApp && typeof window.HRApp.logout === "function") window.HRApp.logout();
      } catch (_) {}
      // fallback: reload
      try { window.location.href = "./home.html"; } catch (_) {}
    });

    // list filters
    dom.on(dom.q, "input", function () { state.q = normStr(dom.q.value); renderAll(); });
    dom.on(dom.fStatus, "change", function () { state.fStatus = normStr(dom.fStatus.value); renderAll(); });
    dom.on(dom.onlyProblems, "change", function () { state.onlyProblems = !!dom.onlyProblems.checked; renderAll(); });

    dom.on(dom.btnShowAll, "click", function () {
      state.q = "";
      if (dom.q) dom.q.value = "";
      renderAll();
    });

    dom.on(dom.btnClear, "click", function () {
      if (dom.q) dom.q.value = "";
      if (dom.fStatus) dom.fStatus.value = "";
      state.q = "";
      state.fStatus = "";
      renderAll();
    });

    // CRUD
    dom.on(dom.btnNew, "click", createNewTraining);
    dom.on(dom.btnDelete, "click", deleteSelectedTraining);
    dom.on(dom.btnPurge, "click", purgeAllTrainings);

    // module helpers
    dom.on(dom.btnModAll, "click", function () {
      if (dom.mod) dom.mod.focus();
    });
    dom.on(dom.btnModClear, "click", function () {
      if (state.readOnly) return;
      if (dom.mod) dom.mod.value = "";
      if (dom.area) dom.area.value = "";
      setDirty(true);
      refreshEditorStateFromInputs();
      renderAll();
    });

    // editor dirty watchers
    const watch = dom.getDirtyWatchEls ? dom.getDirtyWatchEls() : [];
    for (const el of watch) {
      dom.on(el, "input", function () { if (!state.readOnly) { setDirty(true); refreshEditorStateFromInputs(); renderAll(); } });
      dom.on(el, "change", function () { if (!state.readOnly) { setDirty(true); refreshEditorStateFromInputs(); renderAll(); } });
    }
    dom.on(dom.goals, "input", function () { if (!state.readOnly) { setDirty(true); refreshEditorStateFromInputs(); } });

    // save/publish
    dom.on(dom.btnRevert, "click", revertUnsaved);
    dom.on(dom.btnSaveDraft, "click", function () { saveSelected("draft"); });
    dom.on(dom.btnSavePublish, "click", function () { saveSelected("published"); });

    // AI
    dom.on(dom.btnTestAI, "click", testAI);
    dom.on(dom.btnGenAI, "click", generateAI);

    // question controls show/hide
    dom.on(dom.aiContent, "change", function () {
      const isQ = normStr(dom.aiContent.value) === "questions";
      if (dom.questionControls) dom.questionControls.style.display = isQ ? "flex" : "none";
    });
  }

  function refreshEditorStateFromInputs() {
    state.module = normStr(dom && dom.mod ? dom.mod.value : state.module);
    state.area = normStr(dom && dom.area ? dom.area.value : state.area);
    state.courseTitle = normStr(dom && dom.courseTitle ? dom.courseTitle.value : state.courseTitle) || "Introduktion";
    state.courseStep = normStr(dom && dom.courseStep ? dom.courseStep.value : state.courseStep) || "1";
    state.goalsLevel = normStr(dom && dom.goalsLevel ? dom.goalsLevel.value : state.goalsLevel) || "normal";
    state.goals = normStr(dom && dom.goals ? dom.goals.value : state.goals);
    computeGeneratedTitle();
  }

  // ---------------------------
  // Boot
  // ---------------------------
  function init() {
    // DOM exists?
    if (!dom) {
      console.error("Trainings.dom saknas");
      return;
    }

    computeWhoAndMode();
    loadTrainingsOrLock();
    setTopbar();

    // initial editor state (no selection)
    refreshEditorStateFromInputs();

    // show/hide question controls baseline
    if (dom.aiContent && dom.questionControls) {
      const isQ = normStr(dom.aiContent.value) === "questions";
      dom.questionControls.style.display = isQ ? "flex" : "none";
    }

    // apply lock rules
    applyReadOnlyUI();

    // status
    if (state.lockReason) setStatus(false, "Status: Låst");
    else setStatus(true, "Status: OK");

    // initial render
    renderAll();

    // events
    wireEvents();

    // if there is exactly one training, auto-pick
    if (state.trainings.length === 1) {
      const id = normStr(state.trainings[0].id);
      if (id) pickTraining(id);
    }
  }

  try {
    init();
  } catch (e) {
    try { console.error(e); } catch (_) {}
    try { setStatus(false, "Status: Fel (init)"); } catch (_) {}
  }
})();
