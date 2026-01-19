/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-04) | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Bootstrap + state + event wiring för trainings (ADMIN create/edit). Fix: "Skapa ny" ska fungera för ADMIN.

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys (endast AO-057_TRAININGS_V1 skrivs via 03-store)
- XSS-safe: render via 05-render.js + dom.setText (textContent)
- ADMIN-only write (MANAGER/SYSTEM_ADMIN read-only)

PATCH v1.0.2-PP-SC-010-04 (AUTOPATCH):
- P0: ADMIN ska bli writer även om HRApp.getRole()/getWho saknar canWrite (men respektera canWrite===false).
- P0: Fallback-DOM: btnDelete-id var fel (btnGenAT) -> btnDelete.
- P1: Micro-recalc (50/300ms) för att fånga HRApp-session som initieras strax efter boot.
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  let dom = NS.dom;
  const core = NS.core;
  const store = NS.store;
  const contract = NS.contract;
  const render = NS.render;

  const page = (NS.page = NS.page || {});
  page.__VERSION = "v1.0.2-PP-SC-010-04";

  // ------------------------------------------------------------
  // Minimal DOM fallback (om 01-dom saknas / är ofullständig)
  // ------------------------------------------------------------
  function byId(id) { return document.getElementById(String(id || "")); }

  function buildDomFallback() {
    const D = {};

    // Elements (måste matcha befintliga id i trainings.html)
    D.btnNew = byId("btnNew");
    D.btnDelete = byId("btnDelete"); // FIX: var fel id tidigare
    D.btnPurge = byId("btnPurge");
    D.btnRevert = byId("btnRevert");

    D.btnSaveDraft = byId("btnSaveDraft");
    D.btnSavePublish = byId("btnSavePublish");

    D.btnGenAI = byId("btnGenAI");
    D.btnTestAI = byId("btnTestAI");

    D.btnModAll = byId("btnModAll");
    D.btnModClear = byId("btnModClear");

    D.btnShowAll = byId("btnShowAll");
    D.btnClear = byId("btnClear");

    D.btnLogout = byId("btnLogout");

    D.q = byId("q");
    D.fStatus = byId("fStatus");
    D.onlyProblems = byId("onlyProblems");

    D.mod = byId("mod");
    D.area = byId("area");
    D.modList = byId("modList");
    D.areaList = byId("areaList");

    D.courseTitle = byId("courseTitle");
    D.courseStep = byId("courseStep");

    D.goalsLevel = byId("goalsLevel");
    D.goals = byId("goals");

    D.titleDisplay = byId("titleDisplay");
    D.subjectIdText = byId("subjectIdText");
    D.revertHint = byId("revertHint");

    D.aiContent = byId("aiContent");
    D.aiCount = byId("aiCount");
    D.aiQuestionType = byId("aiQuestionType");
    D.aiFeedbackEnabled = byId("aiFeedbackEnabled");
    D.questionControls = byId("questionControls");

    // Helpers
    D.setText = function (el, txt) { if (!el) return; el.textContent = String(txt ?? ""); };
    D.disable = function (el, disabled) {
      if (!el) return;
      el.disabled = !!disabled;
      if (el.classList) el.classList.toggle("disabled", !!disabled);
    };
    D.on = function (el, ev, fn) { if (!el || !ev || !fn) return; el.addEventListener(ev, fn); };
    D.show = function (el) { if (!el) return; el.style.display = ""; };
    D.hide = function (el) { if (!el) return; el.style.display = "none"; };

    return D;
  }

  // Om 01-dom saknas helt, använd fallback (så boot inte failar tyst)
  if (!dom) dom = (NS.dom = buildDomFallback());
  // Om vissa helpers saknas (ofullständig 01-dom), fyll på minimalt
  if (dom && typeof dom.disable !== "function") dom.disable = buildDomFallback().disable;
  if (dom && typeof dom.on !== "function") dom.on = buildDomFallback().on;
  if (dom && typeof dom.setText !== "function") dom.setText = buildDomFallback().setText;
  if (dom && typeof dom.show !== "function") dom.show = buildDomFallback().show;
  if (dom && typeof dom.hide !== "function") dom.hide = buildDomFallback().hide;

  // ------------------------------------------------------------
  // State (ingen ny datamodell)
  // ------------------------------------------------------------
  const state = {
    who: { role: "SYSTEM_ADMIN", empNo: "", canWrite: false },
    locked: false,
    lockReason: "",
    trainings: [],
    selectedId: "",
    draft: null,
    dirty: false,
    showAll: false,
    q: "",
    fStatus: "",
    onlyProblems: false,

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

  // Debug-export (för Anders i console)
  page._state = state;

  // ------------------------------------------------------------
  // Utils
  // ------------------------------------------------------------
  function normStr(v) { return core && core.normStr ? core.normStr(v) : String(v ?? "").trim(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; }
  }

  function findTrainingIndexById(id) {
    const tid = normStr(id);
    if (!tid) return -1;
    for (let i = 0; i < state.trainings.length; i++) {
      if (normStr(state.trainings[i] && state.trainings[i].id) === tid) return i;
    }
    return -1;
  }

  function currentBlocks() {
    const d = state.draft || {};
    if (Array.isArray(d.blocks)) return d.blocks;
    if (Array.isArray(d.items)) return [{ title: d.title || "(block)", items: d.items }];
    return [];
  }

  function hasAnyItems() {
    const blocks = currentBlocks();
    let n = 0;
    for (const b of blocks) if (b && Array.isArray(b.items)) n += b.items.length;
    return n > 0;
  }

  function upper(v) { return String(v ?? "").toUpperCase(); }

  function getWhoFresh() {
    // Viktigt: writer kopplas till ADMIN (tolerant), men fail-closed om explicit canWrite===false.
    try {
      if (core && typeof core.getWho === "function") {
        const w = core.getWho();
        if (w && typeof w === "object") return w;
      }
    } catch (_) { /* ignore */ }

    try {
      if (window.HRApp && typeof window.HRApp.getRole === "function") {
        const r = window.HRApp.getRole();

        // r kan vara string eller object, vi är toleranta
        if (typeof r === "string") {
          const role = upper(r);
          return { role, empNo: "", canWrite: role === "ADMIN" };
        }

        if (r && typeof r === "object") {
          const role = upper(r.roleId || r.role || "SYSTEM_ADMIN");
          const empNo = String(r.empNo || r.emp || r.employeeNo || "");
          // P0 FIX: om canWrite saknas -> ADMIN är writer
          const hasCanWrite = Object.prototype.hasOwnProperty.call(r, "canWrite");
          const canWrite = hasCanWrite ? !!r.canWrite : (role === "ADMIN");
          return { role, empNo, canWrite };
        }
      }
    } catch (_) { /* ignore */ }

    return { role: "SYSTEM_ADMIN", empNo: "", canWrite: false };
  }

  function isWriterAllowed() {
    if (state.locked) return false;

    const who = getWhoFresh();
    state.who = who; // håll state i sync för debug + pills

    const role = upper(who.role || "SYSTEM_ADMIN");

    if (role !== "ADMIN") return false;

    // Respektera uttrycklig spärr: canWrite===false => read-only även om ADMIN
    if (who.canWrite === false) return false;

    // Tolerant: undefined/null => tillåt för ADMIN
    return true;
  }

  function setDirty(v) {
    state.dirty = !!v;
    if (dom && dom.setText) dom.setText(dom.revertHint, state.dirty ? "Osparade ändringar" : "");
    if (dom && dom.disable) dom.disable(dom.btnRevert, !state.dirty || !isWriterAllowed());
  }

  function setLock(reason) {
    state.locked = true;
    state.lockReason = reason || "Låst (fail-closed).";
  }

  // ------------------------------------------------------------
  // Datalist builders
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
    for (const t of state.trainings) if (t && t.module) out.push(t.module);
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
    if (!dom || !dom.modList) return;
    while (dom.modList.firstChild) dom.modList.removeChild(dom.modList.firstChild);

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
    if (!dom || !dom.areaList) return;
    while (dom.areaList.firstChild) dom.areaList.removeChild(dom.areaList.firstChild);

    const mod = normStr(dom.mod && dom.mod.value);
    const fixed = safeArr((state.defaults.areasByModule[mod] || []));
    const fromData = collectAreasFromTrainingsForModule(mod);
    const all = uniqueSorted(fixed.concat(fromData));

    for (const a of all) {
      const opt = document.createElement("option");
      opt.value = a;
      dom.areaList.appendChild(opt);
    }
  }

  // ------------------------------------------------------------
  // Rendering glue
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
    const who = state.who || getWhoFresh();
    const writer = isWriterAllowed();
    const whoTxt = `${who.role || "—"} • ${who.empNo || "—"}${writer ? " • skriv" : " • read-only"}`;
    if (render && render.setWhoPill) render.setWhoPill(whoTxt);

    if (state.locked) {
      render && render.setStatePill && render.setStatePill("Status: LÅST", "bad");
    } else if (!writer) {
      render && render.setStatePill && render.setStatePill("Status: Read-only", "warn");
    } else {
      render && render.setStatePill && render.setStatePill("Status: OK", "ok");
    }
  }

  function updateLeftHint() {
    if (render && render.setLeftHint) {
      if (state.locked) render.setLeftHint(state.lockReason || "Låst (korrupt data).");
      else render.setLeftHint("Publicering kräver minst 1 block.");
    }
  }

  function refreshList() {
    const items = visibleTrainings();
    render && render.renderTrainingList && render.renderTrainingList({
      items,
      selectedId: state.selectedId,
      onPick: function (id) { selectTraining(id); },
    });
  }

  function fillEditorFromDraft() {
    const d = state.draft;
    if (!d || !dom) return;

    if (dom.mod) dom.mod.value = normStr(d.module);
    renderAreaDatalist();
    if (dom.area) dom.area.value = normStr(d.area);

    if (dom.courseTitle) dom.courseTitle.value = normStr(d.courseTitle) || "Introduktion";
    if (dom.courseStep) dom.courseStep.value = normStr(d.courseStep) || "1";

    if (dom.goalsLevel) dom.goalsLevel.value = normStr(d.goalsLevel) || "normal";
    if (dom.goals) dom.goals.value = normStr(d.goals) || "";

    // blocks
    const blocks = currentBlocks();
    render && render.renderBlocksList && render.renderBlocksList({
      blocks,
      onEdit: function (idx) { openBlockEditor(idx); },
      onDelete: function (idx) { deleteBlock(idx); },
    });
  }

  function updateButtons() {
    const writer = isWriterAllowed();

    dom && dom.disable && dom.disable(dom.btnNew, !writer);
    dom && dom.disable && dom.disable(dom.btnDelete, !writer || !state.selectedId);
    dom && dom.disable && dom.disable(dom.btnPurge, !writer);

    dom && dom.disable && dom.disable(dom.btnSaveDraft, !writer || !state.draft);
    dom && dom.disable && dom.disable(dom.btnSavePublish, !writer || !state.draft);

    dom && dom.disable && dom.disable(dom.btnGenAI, !writer || !state.draft);
    dom && dom.disable && dom.disable(dom.btnTestAI, false);

    dom && dom.disable && dom.disable(dom.btnModAll, false);
    dom && dom.disable && dom.disable(dom.btnModClear, !writer);

    setDirty(state.dirty);
  }

  function updateUiAll() {
    updateTopPills();
    updateLeftHint();
    refreshList();
    fillEditorFromDraft();
    updateButtons();
  }

  page._recalc = updateUiAll;
  page._isWriterAllowed = isWriterAllowed;

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
    const who = getWhoFresh();
    return {
      id: (core && typeof core.makeId === "function") ? core.makeId("tr") : ("tr_" + Date.now()),
      status: "draft",
      module: "",
      area: "",
      courseTitle: "Introduktion",
      courseStep: "1",
      goalsLevel: "normal",
      goals: "",
      title: "Introduktion • Steg 1 • —",
      blocks: [],
      meta: { createdAt: Date.now(), createdBy: who.empNo || "" },
    };
  }

  function createNewTraining() {
    if (!isWriterAllowed()) return;

    const t = newTrainingTemplate();
    state.trainings.unshift(t);
    state.selectedId = t.id;
    state.draft = deepClone(t);

    const s = store && store.save ? store.save(state.trainings) : { ok: false };
    if (!s || !s.ok) {
      render && render.setStatePill && render.setStatePill("Status: Kunde inte spara", "bad");
      return;
    }

    state.showAll = true;
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
    const s = store && store.save ? store.save(state.trainings) : { ok: false };
    if (!s || !s.ok) {
      render && render.setStatePill && render.setStatePill("Status: Kunde inte spara", "bad");
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

    const p = store && store.purgeAll ? store.purgeAll() : { ok: false };
    if (!p || !p.ok) {
      render && render.setStatePill && render.setStatePill("Status: Kunde inte rensa", "bad");
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

    if (dom && dom.mod) state.draft.module = normStr(dom.mod.value);
    if (dom && dom.area) state.draft.area = normStr(dom.area.value);
    if (dom && dom.courseTitle) state.draft.courseTitle = normStr(dom.courseTitle.value);
    if (dom && dom.courseStep) state.draft.courseStep = normStr(dom.courseStep.value);
    if (dom && dom.goalsLevel) state.draft.goalsLevel = normStr(dom.goalsLevel.value);
    if (dom && dom.goals) state.draft.goals = normStr(dom.goals.value);

    state.draft.status = (status === "published") ? "published" : "draft";

    const v = (status === "published" && contract && contract.validateForPublish)
      ? contract.validateForPublish(state.draft)
      : (contract && contract.validateTrainingForSave)
        ? contract.validateTrainingForSave(state.draft)
        : { ok: true, reasons: [] };

    if (!v.ok) {
      render && render.setStatePill && render.setStatePill("Status: Kan inte spara", "bad");
      render && render.setAiHint && render.setAiHint((v.reasons || []).join(" "));
      return;
    }

    if (status === "published" && !hasAnyItems()) {
      render && render.setStatePill && render.setStatePill("Status: Kan inte publicera", "bad");
      render && render.setAiHint && render.setAiHint("Publicering kräver minst 1 block/item.");
      return;
    }

    const idx = findTrainingIndexById(state.selectedId);
    if (idx < 0) {
      render && render.setStatePill && render.setStatePill("Status: Saknar vald utbildning", "bad");
      return;
    }

    state.trainings[idx] = deepClone(state.draft);

    const s = store && store.save ? store.save(state.trainings) : { ok: false };
    if (!s || !s.ok) {
      render && render.setStatePill && render.setStatePill("Status: Kunde inte spara", "bad");
      return;
    }

    setDirty(false);
    render && render.setAiHint && render.setAiHint("");
    renderModuleDatalist();
    renderAreaDatalist();
    updateUiAll();
  }

  // ------------------------------------------------------------
  // Blocks (minimal baseline)
  // ------------------------------------------------------------
  function openBlockEditor(idx) {
    if (!state.draft || !render || typeof render.openModal !== "function") return;

    const blocks = currentBlocks();
    const b = blocks[idx];
    if (!b) return;

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
      if (bb && Array.isArray(bb.items) && bb.items[0]) bb.items[0].text = txt;
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
        render && render.setStatePill && render.setStatePill("Status: Worker SDK saknas", "bad");
        return;
      }
      const r = await window.HRWorkerSDK.health();
      if (r && r.ok) render && render.setStatePill && render.setStatePill("Status: AI OK", "ok");
      else render && render.setStatePill && render.setStatePill("Status: AI fel", "warn");
    } catch (_) {
      render && render.setStatePill && render.setStatePill("Status: AI fel", "bad");
    }
  }

  // ------------------------------------------------------------
  // Bootstrap
  // ------------------------------------------------------------
  function boot() {
    // Fail-closed men med tydlig debug
    if (!core || !store || !contract || !render || !dom) {
      setLock("BOOT: deps saknas (core/store/contract/render/dom).");
      updateUiAll();
      return;
    }

    // Load trainings
    const load = store.load ? store.load() : { ok: false };
    if (!load.ok && load.corrupt) {
      setLock(store.lockReasonFor ? store.lockReasonFor() : "Korrupt trainings.");
      state.trainings = [];
    } else {
      state.trainings = safeArr(load.trainings);
    }

    // Initial datalists
    renderModuleDatalist();
    renderAreaDatalist();

    state.showAll = false;

    // Wire events
    dom.on(dom.btnNew, "click", createNewTraining);
    dom.on(dom.btnDelete, "click", deleteSelected);
    dom.on(dom.btnPurge, "click", purgeAll);
    dom.on(dom.btnRevert, "click", revertUnsaved);

    dom.on(dom.btnSaveDraft, "click", function () { writeBackDraft("draft"); });
    dom.on(dom.btnSavePublish, "click", function () { writeBackDraft("published"); });

    dom.on(dom.btnShowAll, "click", function () { state.showAll = true; refreshList(); });

    dom.on(dom.btnClear, "click", function () {
      state.q = "";
      state.fStatus = "";
      state.onlyProblems = false;
      if (dom.q) dom.q.value = "";
      if (dom.fStatus) dom.fStatus.value = "";
      if (dom.onlyProblems) dom.onlyProblems.checked = false;
      state.showAll = false;
      refreshList();
      updateButtons();
    });

    dom.on(dom.q, "input", function () {
      state.q = normStr(dom.q && dom.q.value);
      state.showAll = state.showAll || !!state.q;
      refreshList();
      updateButtons();
    });

    dom.on(dom.fStatus, "change", function () {
      state.fStatus = normStr(dom.fStatus && dom.fStatus.value);
      state.showAll = true;
      refreshList();
      updateButtons();
    });

    dom.on(dom.onlyProblems, "change", function () {
      state.onlyProblems = !!(dom.onlyProblems && dom.onlyProblems.checked);
      state.showAll = true;
      refreshList();
      updateButtons();
    });

    dom.on(dom.btnModAll, "click", function () { dom.mod && dom.mod.focus && dom.mod.focus(); });

    dom.on(dom.btnModClear, "click", function () {
      if (!isWriterAllowed()) return;
      if (dom.mod) dom.mod.value = "";
      if (dom.area) dom.area.value = "";
      renderAreaDatalist();
      setDirty(true);
      updateButtons();
    });

    const onEditorChange = function () {
      if (!state.draft) return;
      renderAreaDatalist();
      setDirty(true);
      updateButtons();
    };

    dom.on(dom.mod, "input", onEditorChange);
    dom.on(dom.area, "input", onEditorChange);
    dom.on(dom.courseTitle, "change", onEditorChange);
    dom.on(dom.courseStep, "change", onEditorChange);
    dom.on(dom.goalsLevel, "change", function () { if (state.draft) { state.draft.goalsLevel = normStr(dom.goalsLevel && dom.goalsLevel.value); setDirty(true); updateButtons(); } });
    dom.on(dom.goals, "input", function () { if (state.draft) { state.draft.goals = normStr(dom.goals && dom.goals.value); setDirty(true); updateButtons(); } });

    // AI
    dom.on(dom.btnTestAI, "click", testAi);

    dom.on(dom.btnLogout, "click", function () {
      try {
        if (window.HRApp && typeof window.HRApp.logout === "function") window.HRApp.logout();
        else if (window.HRApp && typeof window.HRApp.clearSession === "function") window.HRApp.clearSession();
      } catch (_) { }
      location.href = "./login.html";
    });

    // First paint + micro-recalc (för att fånga HRApp som init:ar aningen senare)
    updateUiAll();
    setTimeout(updateUiAll, 0);
    setTimeout(updateUiAll, 50);
    setTimeout(updateUiAll, 300);
  }

  try { boot(); } catch (_) { setLock("BOOT: exception (fail-closed)."); updateUiAll(); }
})();
