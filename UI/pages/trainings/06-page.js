/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-03) | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System (GitHub Pages / UI-only / localStorage-first)
Syfte: Bootstrap + state + event wiring för trainings (Admin)

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys (AO-057_TRAININGS_V1 används via 03-store)
- XSS-safe: render sker via 05-render (textContent)
- ADMIN-only write (MANAGER/SYSTEM_ADMIN = read-only)
- Publish fail-closed: status=published kräver blocks/items > 0
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
  // State (UI-only)
  // ---------------------------
  const S = {
    who: { role: "SYSTEM_ADMIN", empNo: "", canWrite: false },
    canWrite: false,
    corrupt: false,
    trainings: [],
    selectedId: "",
    selected: null,
    showList: false,
    dirty: false,
  };

  function setStatus(text, kind /* ok|warn|bad */) {
    try { render.setStatePill(text, kind || "ok"); } catch (_) {}
  }

  function setWho() {
    const emp = core.normStr(S.who.empNo || "—");
    const role = core.normStr(S.who.role || "SYSTEM_ADMIN");
    try { render.setWhoPill(`Inloggad: ${emp} (${role})`); } catch (_) {}
  }

  function setContext() {
    try { render.setContext("Redigerar: Utbildningar"); } catch (_) {}
  }

  function hardDisableAll(reason) {
    // Fail-closed lock
    const lock = true;
    dom.disable(dom.btnNew, lock);
    dom.disable(dom.btnDelete, lock);
    dom.disable(dom.btnPurge, lock);
    dom.disable(dom.btnSaveDraft, lock);
    dom.disable(dom.btnSavePublish, lock);
    dom.disable(dom.btnGenAI, lock);
    dom.disable(dom.btnTestAI, lock);
    dom.disable(dom.btnRevert, lock);

    // fields
    [
      dom.q, dom.fStatus, dom.onlyProblems,
      dom.mod, dom.area, dom.courseTitle, dom.courseStep,
      dom.goalsLevel, dom.goals,
      dom.aiContent, dom.aiCount, dom.aiQuestionType, dom.aiFeedbackEnabled
    ].forEach((el) => { try { if (el) el.disabled = lock; } catch (_) {} });

    try { render.setLeftHint(reason || "Read-only: låst."); } catch (_) {}
  }

  function applyWriteMode(canWrite) {
    S.canWrite = !!canWrite;

    // Always allow search/list navigation even in read-only
    dom.disable(dom.btnShowAll, false);
    dom.disable(dom.btnClear, false);
    try { dom.q.disabled = false; dom.fStatus.disabled = false; dom.onlyProblems.disabled = false; } catch (_) {}

    // Write actions
    dom.disable(dom.btnNew, !S.canWrite);
    dom.disable(dom.btnDelete, !S.canWrite);
    dom.disable(dom.btnPurge, !S.canWrite);
    dom.disable(dom.btnSaveDraft, !S.canWrite);
    dom.disable(dom.btnSavePublish, !S.canWrite);
    dom.disable(dom.btnGenAI, !S.canWrite);
    dom.disable(dom.btnTestAI, !S.canWrite); // test AI kan vara read-only, men vi låser för enkelhet
    dom.disable(dom.btnRevert, false); // revert är ok även read-only

    // Editor fields
    [
      dom.mod, dom.area, dom.courseTitle, dom.courseStep,
      dom.goalsLevel, dom.goals,
      dom.aiContent, dom.aiCount, dom.aiQuestionType, dom.aiFeedbackEnabled
    ].forEach((el) => { try { if (el) el.disabled = !S.canWrite; } catch (_) {} });

    if (!S.canWrite) {
      try { render.setLeftHint("Read-only: du kan titta men inte spara/generera."); } catch (_) {}
    } else {
      try { render.setLeftHint("Publicering kräver minst 1 block."); } catch (_) {}
    }
  }

  // ---------------------------
  // Storage
  // ---------------------------
  function loadAll() {
    const res = store.load();
    if (!res.ok) {
      S.corrupt = !!res.corrupt;
      S.trainings = [];
      setStatus("Status: FEL (storage)", "bad");
      hardDisableAll(res.err || store.lockReasonFor());
      return false;
    }
    S.corrupt = false;
    S.trainings = Array.isArray(res.trainings) ? res.trainings : [];
    return true;
  }

  function saveAll() {
    if (!S.canWrite) return { ok: false, err: "Read-only" };
    return store.save(S.trainings);
  }

  // ---------------------------
  // Helpers: find/update selected
  // ---------------------------
  function findById(id) {
    const sid = core.normStr(id);
    return S.trainings.find((t) => core.normStr(t && t.id) === sid) || null;
  }

  function upsertTraining(training) {
    const t = training || {};
    const id = core.normStr(t.id);
    if (!id) return;
    const idx = S.trainings.findIndex((x) => core.normStr(x && x.id) === id);
    if (idx >= 0) S.trainings[idx] = t;
    else S.trainings.unshift(t);
  }

  // ---------------------------
  // Module/Area option helpers (ingen ny storage-key)
  // ---------------------------
  const DEFAULT_MODULES = [
    "Kvalitet", "Säkerhet", "Utbildning", "Kommunikation", "Inventering", "HR", "IT", "Ledning"
  ];

  function uniq(arr) {
    const out = [];
    const seen = new Set();
    for (const v of arr) {
      const s = core.normStr(v);
      const k = core.safeLower(s);
      if (!s) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  function getModulesFromData() {
    const fromData = S.trainings.map((t) => t && t.module).filter(Boolean);
    return uniq(DEFAULT_MODULES.concat(fromData));
  }

  function getAreasForModule(mod) {
    const m = core.safeLower(mod);
    const fromData = S.trainings
      .filter((t) => core.safeLower(t && t.module) === m)
      .map((t) => t && t.area)
      .filter(Boolean);
    return uniq(fromData);
  }

  function fillDatalist(dl, values) {
    if (!dl) return;
    while (dl.firstChild) dl.removeChild(dl.firstChild);
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      dl.appendChild(opt);
    }
  }

  function refreshModAreaLists() {
    fillDatalist(dom.modList, getModulesFromData());
    fillDatalist(dom.areaList, getAreasForModule(dom.mod.value));
  }

  function computeSubjectId(module, area) {
    const m = core.normStr(module);
    const a = core.normStr(area);
    if (!m && !a) return "—";
    return `${m}::${a}`;
  }

  // ---------------------------
  // Filtering + list rendering
  // ---------------------------
  function matches(t) {
    const q = core.safeLower(dom.q.value);
    const fStatus = core.normStr(dom.fStatus.value);
    const onlyProblems = !!dom.onlyProblems.checked;

    const title = core.safeLower(t && t.title);
    const module = core.safeLower(t && t.module);
    const area = core.safeLower(t && t.area);
    const ch = core.safeLower(t && t.courseTitle);
    const st = core.safeLower(t && t.courseStep);

    const status = String((t && t.status) || "draft");
    if (fStatus && status !== fStatus) return false;

    if (q) {
      const blob = [title, module, area, ch, st].join(" ");
      if (!blob.includes(q)) return false;
    }

    if (onlyProblems) {
      const v = contract.validateTrainingForSave(t);
      if (v.ok) return false;
    }

    return true;
  }

  function renderList() {
    const items = S.trainings.filter(matches);
    if (!S.showList && !core.normStr(dom.q.value)) {
      // list hidden mode (search-first)
      dom.setText(dom.list, "");
      return;
    }

    render.renderTrainingList({
      items,
      selectedId: S.selectedId,
      onPick: function (id) { pick(id); }
    });
  }

  // ---------------------------
  // Editor rendering (fields)
  // ---------------------------
  function setGeneratedTitle() {
    const title = core.composeTitle(dom.courseTitle.value, dom.courseStep.value, dom.area.value);
    try { dom.titleDisplay.value = title; } catch (_) {}
    return title;
  }

  function renderEditorFromSelected() {
    const t = S.selected || null;

    if (!t) {
      // reset editor fields (but keep course defaults)
      try {
        dom.mod.value = "";
        dom.area.value = "";
        dom.subjectIdText.textContent = "—";
        dom.goals.value = "";
        dom.goalsLevel.value = "normal";
        setGeneratedTitle();
      } catch (_) {}
      render.renderBlocksList({ blocks: [], onEdit: function(){}, onDelete: function(){} });
      return;
    }

    try {
      dom.mod.value = core.normStr(t.module);
      dom.area.value = core.normStr(t.area);
      dom.courseTitle.value = core.normStr(t.courseTitle || "Introduktion");
      dom.courseStep.value = core.normStr(t.courseStep || "1");
      dom.goalsLevel.value = core.normStr(t.goalsLevel || "normal") || "normal";
      dom.goals.value = core.normStr(t.goals || "");
    } catch (_) {}

    const subj = computeSubjectId(dom.mod.value, dom.area.value);
    dom.setText(dom.subjectIdText, subj);

    const title = setGeneratedTitle();
    // sync titleDisplay => training.title (stabilt för listan)
    t.title = core.normStr(t.title) || title;

    const blocks = Array.isArray(t.blocks) ? t.blocks : [];
    render.renderBlocksList({
      blocks,
      onEdit: function (idx) { openBlockEditor(idx); },
      onDelete: function (idx) { deleteBlock(idx); }
    });
  }

  // ---------------------------
  // Dirty tracking
  // ---------------------------
  function markDirty(v) {
    S.dirty = !!v;
    dom.setText(dom.revertHint, S.dirty ? "Osparade ändringar." : "");
  }

  function syncSelectedFromUI() {
    if (!S.selected || !S.canWrite) return;

    const t = S.selected;
    t.module = core.normStr(dom.mod.value);
    t.area = core.normStr(dom.area.value);
    t.courseTitle = core.normStr(dom.courseTitle.value || "Introduktion");
    t.courseStep = core.normStr(dom.courseStep.value || "1");
    t.goalsLevel = core.normStr(dom.goalsLevel.value || "normal");
    t.goals = core.normStr(dom.goals.value || "");

    const subj = computeSubjectId(t.module, t.area);
    dom.setText(dom.subjectIdText, subj);

    // Keep title stable and list-friendly
    const genTitle = setGeneratedTitle();
    t.title = genTitle;

    upsertTraining(t);
    markDirty(true);
    renderList();
    renderEditorFromSelected();
  }

  // ---------------------------
  // Actions
  // ---------------------------
  function pick(id) {
    const t = findById(id);
    S.selectedId = core.normStr(id);
    S.selected = t;
    markDirty(false);
    renderList();
    renderEditorFromSelected();
  }

  function createNew() {
    if (!S.canWrite) return;

    const baseChapter = core.normStr(dom.courseTitle.value || "Introduktion");
    const baseStep = core.normStr(dom.courseStep.value || "1");
    const baseArea = core.normStr(dom.area.value || "");
    const title = core.composeTitle(baseChapter, baseStep, baseArea || "—");

    const t = {
      id: core.makeId("tr"),
      title: title,
      status: "draft",
      module: core.normStr(dom.mod.value || ""),
      area: core.normStr(dom.area.value || ""),
      courseTitle: baseChapter,
      courseStep: baseStep,
      goalsLevel: core.normStr(dom.goalsLevel.value || "normal"),
      goals: core.normStr(dom.goals.value || ""),
      blocks: []
    };

    upsertTraining(t);
    const s = saveAll();
    if (!s.ok) {
      setStatus("Status: FEL (kunde inte spara)", "bad");
      return;
    }

    S.showList = true;
    pick(t.id);
    setStatus("Status: OK", "ok");
  }

  function deleteSelected() {
    if (!S.canWrite) return;
    if (!S.selectedId) return;

    const id = S.selectedId;
    S.trainings = S.trainings.filter((t) => core.normStr(t && t.id) !== id);

    const s = saveAll();
    if (!s.ok) { setStatus("Status: FEL (delete)", "bad"); return; }

    S.selectedId = "";
    S.selected = null;
    markDirty(false);
    renderList();
    renderEditorFromSelected();
    setStatus("Status: OK", "ok");
  }

  function purgeAll() {
    if (!S.canWrite) return;
    const ok = window.confirm("Rensa ALLA utbildningar? Detta går inte att ångra.");
    if (!ok) return;

    const r = store.purgeAll();
    if (!r.ok) { setStatus("Status: FEL (purge)", "bad"); return; }

    S.trainings = [];
    S.selectedId = "";
    S.selected = null;
    markDirty(false);
    renderList();
    renderEditorFromSelected();
    setStatus("Status: OK", "ok");
  }

  function saveDraft() {
    if (!S.canWrite || !S.selected) return;

    syncSelectedFromUI();
    S.selected.status = "draft";

    const v = contract.validateTrainingForSave(S.selected);
    if (!v.ok) {
      setStatus("Status: PROBLEM", "warn");
      render.setAiHint(v.reasons.join(" "));
      return;
    }

    upsertTraining(S.selected);
    const s = saveAll();
    if (!s.ok) { setStatus("Status: FEL (save)", "bad"); return; }

    markDirty(false);
    renderList();
    setStatus("Status: OK", "ok");
    render.setAiHint("");
  }

  function savePublish() {
    if (!S.canWrite || !S.selected) return;

    syncSelectedFromUI();
    S.selected.status = "published";

    const v = contract.validateForPublish(S.selected);
    if (!v.ok) {
      setStatus("Status: PROBLEM", "warn");
      render.setAiHint(v.reasons.join(" "));
      return;
    }

    upsertTraining(S.selected);
    const s = saveAll();
    if (!s.ok) { setStatus("Status: FEL (publish)", "bad"); return; }

    markDirty(false);
    renderList();
    setStatus("Status: OK", "ok");
    render.setAiHint("");
  }

  function revertReload() {
    const ok = loadAll();
    if (!ok) return;
    markDirty(false);
    renderList();
    if (S.selectedId) pick(S.selectedId);
    else renderEditorFromSelected();
    setStatus("Status: OK", "ok");
  }

  // ---------------------------
  // Blocks (minimal editor via modal)
  // ---------------------------
  function deleteBlock(idx) {
    if (!S.canWrite || !S.selected) return;
    const blocks = Array.isArray(S.selected.blocks) ? S.selected.blocks : [];
    if (idx < 0 || idx >= blocks.length) return;
    blocks.splice(idx, 1);
    S.selected.blocks = blocks;
    upsertTraining(S.selected);
    markDirty(true);
    renderEditorFromSelected();
  }

  function openBlockEditor(idx) {
    if (!S.selected) return;
    const blocks = Array.isArray(S.selected.blocks) ? S.selected.blocks : [];
    const b = blocks[idx];
    if (!b) return;

    // Edit first item's text (baseline) – no new data model
    const its = Array.isArray(b.items) ? b.items : [];
    const first = its[0] || { kind: "document", text: "" };

    const wrap = document.createElement("div");

    const h = document.createElement("div");
    h.style.fontWeight = "900";
    h.style.marginBottom = "8px";
    h.textContent = `Block ${idx + 1} • items: ${its.length}`;
    wrap.appendChild(h);

    const ta = document.createElement("textarea");
    ta.className = "textarea";
    ta.value = core.normStr(first.text || "");
    ta.placeholder = "Text…";
    wrap.appendChild(ta);

    render.openModal(
      "Redigera block",
      wrap,
      function () {
        if (!S.canWrite) return;
        const txt = core.normStr(ta.value);
        const it = Object.assign({}, first, { text: txt });
        its[0] = it;
        b.items = its;
        blocks[idx] = b;
        S.selected.blocks = blocks;

        // fail-closed: förbjudna fraser stoppar publish, men vi låter draft edit
        upsertTraining(S.selected);
        markDirty(true);
        renderEditorFromSelected();
      }
    );
  }

  // ---------------------------
  // AI (minimal wiring, fail-closed)
  // ---------------------------
  async function testAI() {
    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.health !== "function") {
      setStatus("Status: FEL (SDK saknas)", "bad");
      return;
    }
    try {
      setStatus("Status: AI test…", "warn");
      const res = await window.HRWorkerSDK.health();
      if (res && res.ok) setStatus("Status: OK", "ok");
      else setStatus("Status: AI fel", "bad");
    } catch (e) {
      setStatus("Status: AI fel", "bad");
    }
  }

  async function generateAI() {
    if (!S.canWrite || !S.selected) return;

    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.aiGenerate !== "function") {
      setStatus("Status: FEL (SDK saknas)", "bad");
      return;
    }

    syncSelectedFromUI();

    const ctx = core.buildAiContext({
      module: S.selected.module,
      area: S.selected.area,
      courseTitle: S.selected.courseTitle,
      courseStep: S.selected.courseStep,
      goalsLevel: S.selected.goalsLevel,
      goals: S.selected.goals
    });

    const mode = core.normStr(dom.aiContent.value || "blocks"); // blocks|questions
    const count = Number(core.normStr(dom.aiCount.value || "1")) || 1;

    const payload = {
      mode,
      count,
      context: Object.assign({}, ctx, {
        ui: {
          questionType: core.normStr(dom.aiQuestionType.value || "auto"),
          feedbackEnabled: !!dom.aiFeedbackEnabled.checked
        }
      }),
      language: "sv"
    };

    try {
      setStatus("Status: AI genererar…", "warn");
      render.setAiHint("");

      const raw = await window.HRWorkerSDK.aiGenerate(payload);
      const norm = core.normalizeAiResult(raw);
      const v = contract.validateAiResult(norm);

      if (!v.ok) {
        setStatus("Status: PROBLEM", "warn");
        render.setAiHint(v.reasons.join(" "));
        return;
      }

      // Make one block from returned items (no new model)
      const items = norm.items.map(contract.normalizeItem);
      const block = {
        kind: "block",
        title: ctx.course.title,
        module: ctx.subject.module,
        area: ctx.subject.area,
        step: String(ctx.course.step || ""),
        status: "draft",
        items: items
      };

      const blocks = Array.isArray(S.selected.blocks) ? S.selected.blocks : [];
      blocks.push(block);
      S.selected.blocks = blocks;

      // save draft immediately (safer)
      S.selected.status = "draft";

      upsertTraining(S.selected);
      const s = saveAll();
      if (!s.ok) {
        setStatus("Status: FEL (kunde inte spara)", "bad");
        return;
      }

      markDirty(false);
      renderEditorFromSelected();
      renderList();
      setStatus("Status: OK", "ok");
      render.setAiHint(`AI skapade ${items.length} items i ett nytt block.`);
    } catch (e) {
      setStatus("Status: AI fel", "bad");
      render.setAiHint("AI-kall misslyckades (se Console).");
    }
  }

  // ---------------------------
  // Wiring
  // ---------------------------
  function wire() {
    // Search-first: list hidden until search/showAll
    dom.on(dom.btnShowAll, "click", function () {
      S.showList = true;
      renderList();
    });

    dom.on(dom.btnClear, "click", function () {
      dom.q.value = "";
      dom.fStatus.value = "";
      dom.onlyProblems.checked = false;
      S.showList = false;
      renderList();
    });

    dom.on(dom.q, "input", function () {
      S.showList = !!core.normStr(dom.q.value);
      renderList();
    });

    dom.on(dom.fStatus, "change", renderList);
    dom.on(dom.onlyProblems, "change", renderList);

    dom.on(dom.btnNew, "click", createNew);
    dom.on(dom.btnDelete, "click", deleteSelected);
    dom.on(dom.btnPurge, "click", purgeAll);

    dom.on(dom.btnSaveDraft, "click", saveDraft);
    dom.on(dom.btnSavePublish, "click", savePublish);
    dom.on(dom.btnRevert, "click", revertReload);

    dom.on(dom.btnTestAI, "click", testAI);
    dom.on(dom.btnGenAI, "click", generateAI);

    dom.on(dom.btnModAll, "click", function () {
      refreshModAreaLists();
      try { dom.mod.focus(); } catch (_) {}
    });

    dom.on(dom.btnModClear, "click", function () {
      if (!S.canWrite) return;
      dom.mod.value = "";
      dom.area.value = "";
      refreshModAreaLists();
      syncSelectedFromUI();
    });

    dom.on(dom.mod, "input", function () {
      refreshModAreaLists();
      syncSelectedFromUI();
    });

    dom.on(dom.area, "input", function () {
      syncSelectedFromUI();
    });

    dom.on(dom.courseTitle, "change", function () {
      syncSelectedFromUI();
    });

    dom.on(dom.courseStep, "change", function () {
      syncSelectedFromUI();
    });

    dom.on(dom.goalsLevel, "change", function () {
      syncSelectedFromUI();
    });

    dom.on(dom.goals, "input", function () {
      syncSelectedFromUI();
    });

    // Logout via HRApp if exists
    dom.on(dom.btnLogout, "click", function () {
      try {
        if (window.HRApp && typeof window.HRApp.logout === "function") window.HRApp.logout();
      } catch (_) {}
      window.location.href = "./home.html";
    });
  }

  function boot() {
    // Fail-closed if critical deps missing
    try {
      core.assert(dom && core && store && contract && render, "DEPS", "Missing modules");
    } catch (e) {
      try { render.setStatePill("Status: FEL (deps)", "bad"); } catch (_) {}
      return;
    }

    // Who / write-mode
    S.who = core.getWho();
    S.canWrite = core.isAdminWriter(S.who);
    setContext();
    setWho();
    applyWriteMode(S.canWrite);

    // load
    const ok = loadAll();
    if (!ok) return;

    // Fill datalists from existing data
    refreshModAreaLists();

    // initial list hidden
    S.showList = false;
    renderList();
    renderEditorFromSelected();

    setStatus("Status: OK", "ok");
  }

  // Start
  try {
    wire();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  } catch (e) {
    try { setStatus("Status: FEL (init)", "bad"); } catch (_) {}
  }
})();
