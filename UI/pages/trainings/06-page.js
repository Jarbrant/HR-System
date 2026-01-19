/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-02) | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Bootstrap + state + event wiring för trainings (ADMIN – skapa/redigera)

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell (AO-057_TRAININGS_V1)
- localStorage-first (data), sessionStorage/auth via HRApp
- XSS-safe rendering: textContent (render sker via 05-render.js)
- ADMIN-only write (MANAGER/SYSTEM_ADMIN read-only)
- Publish fail-closed: status=published kräver blocks/items > 0
- Token får inte lagras i webbläsaren (SDK getToken() => "" i denna AO)

PATCH v1.0 (PP-SC-010-02):
- Fix: Writer-läge styrs ENDAST av core.getWho().canWrite (inte HRApp.getAuth()).
- Fix: "Skapa ny" aktiveras för ADMIN writer.
- Robust init: storage corrupt => read-only + tydlig status.
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
  page.__VERSION = "v1.0-PP-SC-010-02";

  // ---------------------------
  // State (UI-only)
  // ---------------------------
  const S = {
    who: { role: "SYSTEM_ADMIN", empNo: "", canWrite: false },
    canWrite: false,
    locked: false,
    lockReason: "",
    trainings: [],
    selectedId: "",
    selected: null,
    // filters
    q: "",
    fStatus: "",
    onlyProblems: false,
    showAll: false,
    // UI flags
    dirty: false,
    courseTouched: false,
    lastSavedSnapshot: "",
  };

  // ---------------------------
  // Helpers
  // ---------------------------
  function safeClone(obj) {
    try { return JSON.parse(JSON.stringify(obj || null)); } catch (_) { return null; }
  }

  function setDirty(v) {
    S.dirty = !!v;
    dom.setText(dom.revertHint, S.dirty ? "Osparade ändringar" : "");
    dom.disable(dom.btnRevert, !S.dirty || !S.canWrite || S.locked);
  }

  function snapshotSelected() {
    try { return JSON.stringify(S.selected || null); } catch (_) { return ""; }
  }

  function getSelectedIndex() {
    const id = String(S.selectedId || "");
    if (!id) return -1;
    for (let i = 0; i < S.trainings.length; i++) {
      if (String(S.trainings[i] && S.trainings[i].id) === id) return i;
    }
    return -1;
  }

  function countItems(training) {
    const t = training || {};
    const blocks = Array.isArray(t.blocks) ? t.blocks : Array.isArray(t.items) ? [{ items: t.items }] : [];
    let n = 0;
    for (const b of blocks) n += Array.isArray(b && b.items) ? b.items.length : 0;
    return n;
  }

  function hasProblems(training) {
    const t = training || {};
    const v = contract && contract.validateTrainingForSave ? contract.validateTrainingForSave(t) : { ok: true, reasons: [] };
    if (!v.ok) return true;
    return false;
  }

  function normalizeTraining(raw) {
    const t = raw && typeof raw === "object" ? raw : {};
    const out = safeClone(t) || {};

    // ensure id
    if (!out.id) out.id = core.makeId("tr");

    // status
    const st = String(out.status || "draft").toLowerCase();
    out.status = (st === "published") ? "published" : "draft";

    // blocks: accept legacy items[] on root
    if (!Array.isArray(out.blocks)) {
      if (Array.isArray(out.items)) out.blocks = [{ title: "Block 1", items: out.items }];
      else out.blocks = [];
    }

    // defaults for editor fields
    if (!out.courseTitle) out.courseTitle = "Introduktion";
    if (!out.courseStep) out.courseStep = "1";
    if (!out.goalsLevel) out.goalsLevel = "normal";
    if (out.goals == null) out.goals = "";
    if (out.module == null) out.module = "";
    if (out.area == null) out.area = "";

    if (out.title == null) out.title = "";
    return out;
  }

  function buildWhoText(who) {
    const r = String((who && who.role) || "SYSTEM_ADMIN");
    const emp = String((who && who.empNo) || "—");
    return `Inloggad: ${emp} (${r})`;
  }

  function setStatusOk(msg) {
    render.setStatePill(msg || "Status: OK", "ok");
  }
  function setStatusWarn(msg) {
    render.setStatePill(msg || "Status: Varning", "warn");
  }
  function setStatusBad(msg) {
    render.setStatePill(msg || "Status: FEL", "bad");
  }

  function setReadOnlyUi(readOnly, reason) {
    const ro = !!readOnly;

    // Left actions
    dom.disable(dom.btnNew, ro);
    dom.disable(dom.btnDelete, ro || !S.selectedId);
    dom.disable(dom.btnPurge, ro);

    // Editor inputs
    const inputs = [
      dom.mod, dom.area, dom.courseTitle, dom.courseStep, dom.goalsLevel, dom.goals
    ];
    for (const el of inputs) {
      if (el) el.disabled = ro;
    }

    // AI / save
    dom.disable(dom.btnTestAI, ro); // testAI can be allowed, but keep simple: read-only => disabled
    dom.disable(dom.btnGenAI, ro);
    dom.disable(dom.btnSaveDraft, ro);
    dom.disable(dom.btnSavePublish, ro);

    // hint
    if (ro) {
      render.setLeftHint(reason || "Read-only: du kan titta men inte spara/generera.");
    } else {
      render.setLeftHint("Publicering kräver minst 1 block.");
    }
  }

  function refreshModuleAreaLists() {
    // Fixed-but-extensible: datalist byggs från befintliga trainings + nuvarande fält.
    const mods = new Set();
    const areasByMod = new Map();

    for (const t of S.trainings) {
      const m = core.normStr(t && t.module);
      const a = core.normStr(t && t.area);
      if (m) mods.add(m);
      if (m && a) {
        if (!areasByMod.has(m)) areasByMod.set(m, new Set());
        areasByMod.get(m).add(a);
      }
    }

    // include current typed values
    const curMod = core.normStr(dom.mod && dom.mod.value);
    const curArea = core.normStr(dom.area && dom.area.value);
    if (curMod) mods.add(curMod);
    if (curMod && curArea) {
      if (!areasByMod.has(curMod)) areasByMod.set(curMod, new Set());
      areasByMod.get(curMod).add(curArea);
    }

    // render modList
    if (dom.modList) {
      while (dom.modList.firstChild) dom.modList.removeChild(dom.modList.firstChild);
      Array.from(mods).sort().forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        dom.modList.appendChild(opt);
      });
    }

    // render areaList (filtered by selected/typed module)
    if (dom.areaList) {
      while (dom.areaList.firstChild) dom.areaList.removeChild(dom.areaList.firstChild);
      const m = core.normStr(dom.mod && dom.mod.value);
      const set = m && areasByMod.has(m) ? areasByMod.get(m) : new Set();
      Array.from(set).sort().forEach((a) => {
        const opt = document.createElement("option");
        opt.value = a;
        dom.areaList.appendChild(opt);
      });
    }

    // subjectId display (stabilt, deterministiskt)
    const sid = (core.normStr(dom.mod && dom.mod.value) && core.normStr(dom.area && dom.area.value))
      ? (core.safeLower(dom.mod.value) + "::" + core.safeLower(dom.area.value))
      : "—";
    dom.setText(dom.subjectIdText, sid);
  }

  function applySelectedToForm() {
    const t = S.selected || null;

    if (!t) {
      // clear editor
      if (dom.mod) dom.mod.value = "";
      if (dom.area) dom.area.value = "";
      if (dom.courseTitle) dom.courseTitle.value = "Introduktion";
      if (dom.courseStep) dom.courseStep.value = "1";
      if (dom.goalsLevel) dom.goalsLevel.value = "normal";
      if (dom.goals) dom.goals.value = "";
      if (dom.titleDisplay) dom.titleDisplay.value = "—";
      render.renderBlocksList({ blocks: [], onEdit: function(){}, onDelete: function(){} });
      refreshModuleAreaLists();
      return;
    }

    if (dom.mod) dom.mod.value = core.normStr(t.module);
    if (dom.area) dom.area.value = core.normStr(t.area);
    if (dom.courseTitle) dom.courseTitle.value = core.normStr(t.courseTitle) || "Introduktion";
    if (dom.courseStep) dom.courseStep.value = core.normStr(t.courseStep) || "1";
    if (dom.goalsLevel) dom.goalsLevel.value = core.normStr(t.goalsLevel) || "normal";
    if (dom.goals) dom.goals.value = core.normStr(t.goals || "");

    // title display (generated from course+step+area)
    const genTitle = core.composeTitle(dom.courseTitle.value, dom.courseStep.value, dom.area.value);
    if (dom.titleDisplay) dom.titleDisplay.value = genTitle;

    refreshModuleAreaLists();

    // blocks list
    const blocks = Array.isArray(t.blocks) ? t.blocks : [];
    render.renderBlocksList({
      blocks,
      onEdit: function (idx) { openEditBlock(idx); },
      onDelete: function (idx) { deleteBlock(idx); }
    });
  }

  function syncFormToSelected() {
    if (!S.selected) return;

    const t = S.selected;
    t.module = core.normStr(dom.mod && dom.mod.value);
    t.area = core.normStr(dom.area && dom.area.value);

    t.courseTitle = core.normStr(dom.courseTitle && dom.courseTitle.value) || "Introduktion";
    t.courseStep = core.normStr(dom.courseStep && dom.courseStep.value) || "1";
    t.goalsLevel = core.normStr(dom.goalsLevel && dom.goalsLevel.value) || "normal";
    t.goals = core.normStr(dom.goals && dom.goals.value);

    // title logic: only (re)generate title after course touched, or if title empty
    const genTitle = core.composeTitle(t.courseTitle, t.courseStep, t.area || "—");
    if (dom.titleDisplay) dom.titleDisplay.value = genTitle;

    // store actual title in training (list uses it)
    // Fail-closed: if no area yet, keep existing title if it exists; else set generated anyway.
    if (!t.title || S.courseTouched) {
      t.title = genTitle;
    }

    refreshModuleAreaLists();
  }

  function renderAll() {
    // topbar pills
    render.setWhoPill(buildWhoText(S.who));
    render.setContext("Redigerar: Utbildningar");

    // list
    const q = core.safeLower(S.q);
    const st = core.normStr(S.fStatus);
    let list = S.trainings.slice();

    if (q) {
      list = list.filter((t) => core.safeLower(t.title).includes(q));
    }
    if (st) {
      list = list.filter((t) => String(t.status || "draft") === st);
    }
    if (S.onlyProblems) {
      list = list.filter((t) => hasProblems(t));
    }
    if (!S.showAll && !q) {
      // Search-first mode: hide list unless showAll or query
      list = [];
    }

    render.renderTrainingList({
      items: list,
      selectedId: S.selectedId,
      onPick: function (id) { pickTraining(id); }
    });

    // editor
    applySelectedToForm();

    // buttons state
    dom.disable(dom.btnDelete, !S.canWrite || S.locked || !S.selectedId);
    dom.disable(dom.btnNew, !S.canWrite || S.locked);
    dom.disable(dom.btnPurge, !S.canWrite || S.locked);

    dom.disable(dom.btnSaveDraft, !S.canWrite || S.locked || !S.selected);
    dom.disable(dom.btnSavePublish, !S.canWrite || S.locked || !S.selected);

    // gen/test AI depends on having selected + module/area
    const readyAi = !!S.selected && core.normStr(dom.mod && dom.mod.value) && core.normStr(dom.area && dom.area.value);
    dom.disable(dom.btnTestAI, !S.canWrite || S.locked || !readyAi);
    dom.disable(dom.btnGenAI, !S.canWrite || S.locked || !readyAi);

    // revert
    dom.disable(dom.btnRevert, !S.canWrite || S.locked || !S.dirty);

    // publish hint
    if (S.selected) {
      const n = countItems(S.selected);
      render.setLeftHint(n > 0 ? `Items: ${n} (OK)` : "Publicering kräver minst 1 block.");
    }

    // debug
    if (dom.debugPre) {
      try { dom.debugPre.textContent = JSON.stringify({ selected: S.selected, trainingsCount: S.trainings.length }, null, 2); }
      catch (_) { dom.debugPre.textContent = "—"; }
    }
  }

  function pickTraining(id) {
    const tid = String(id || "");
    S.selectedId = tid;

    const idx = getSelectedIndex();
    if (idx < 0) {
      S.selected = null;
      setDirty(false);
      renderAll();
      return;
    }

    S.selected = normalizeTraining(S.trainings[idx]);
    S.courseTouched = false;
    S.lastSavedSnapshot = snapshotSelected();
    setDirty(false);

    setStatusOk("Status: OK");
    render.setAiHint("");
    renderAll();
  }

  function newTraining() {
    if (!S.canWrite || S.locked) return;

    const t = normalizeTraining({
      id: core.makeId("tr"),
      title: "",
      module: "",
      area: "",
      courseTitle: "Introduktion",
      courseStep: "1",
      goalsLevel: "normal",
      goals: "",
      status: "draft",
      blocks: []
    });

    // add immediately to list and select
    S.trainings.unshift(t);
    S.selectedId = String(t.id);
    S.selected = safeClone(t);
    S.courseTouched = false;
    S.lastSavedSnapshot = snapshotSelected();
    setDirty(true);

    // persist immediately? (keep simple: require save buttons)
    setStatusOk("Status: OK");
    render.setAiHint("Ny utbildning skapad. Fyll modul/område och spara.");
    renderAll();
  }

  function deleteSelected() {
    if (!S.canWrite || S.locked) return;
    const idx = getSelectedIndex();
    if (idx < 0) return;

    S.trainings.splice(idx, 1);
    S.selectedId = "";
    S.selected = null;
    setDirty(false);

    const s = store.save(S.trainings);
    if (!s.ok) {
      setStatusBad("Status: FEL");
      render.setAiHint("Kunde inte spara efter borttagning: " + (s.err || "okänt fel"));
    } else {
      setStatusOk("Status: OK");
      render.setAiHint("Borttagen.");
    }
    renderAll();
  }

  function purgeAll() {
    if (!S.canWrite || S.locked) return;

    const s = store.purgeAll();
    if (!s.ok) {
      setStatusBad("Status: FEL");
      render.setAiHint(s.err || "Kunde inte rensa.");
      renderAll();
      return;
    }

    S.trainings = [];
    S.selectedId = "";
    S.selected = null;
    setDirty(false);

    setStatusOk("Status: OK");
    render.setAiHint("Alla utbildningar rensade.");
    renderAll();
  }

  function saveDraft() {
    if (!S.canWrite || S.locked || !S.selected) return;

    syncFormToSelected();
    S.selected.status = "draft";

    const v = contract.validateTrainingForSave(S.selected);
    if (!v.ok) {
      setStatusWarn("Status: Varning");
      render.setAiHint(v.reasons.join(" "));
      renderAll();
      return;
    }

    // write back into list
    const idx = getSelectedIndex();
    if (idx >= 0) S.trainings[idx] = safeClone(S.selected);

    const s = store.save(S.trainings);
    if (!s.ok) {
      setStatusBad("Status: FEL");
      render.setAiHint("Spara misslyckades: " + (s.err || "okänt fel"));
      renderAll();
      return;
    }

    S.lastSavedSnapshot = snapshotSelected();
    setDirty(false);
    setStatusOk("Status: OK");
    render.setAiHint("Sparad som utkast.");
    renderAll();
  }

  function savePublish() {
    if (!S.canWrite || S.locked || !S.selected) return;

    syncFormToSelected();
    S.selected.status = "published";

    const v = contract.validateForPublish(S.selected);
    if (!v.ok) {
      setStatusWarn("Status: Varning");
      render.setAiHint(v.reasons.join(" "));
      S.selected.status = "draft"; // fail-closed: do not keep published if invalid
      renderAll();
      return;
    }

    const idx = getSelectedIndex();
    if (idx >= 0) S.trainings[idx] = safeClone(S.selected);

    const s = store.save(S.trainings);
    if (!s.ok) {
      setStatusBad("Status: FEL");
      render.setAiHint("Publicera misslyckades: " + (s.err || "okänt fel"));
      renderAll();
      return;
    }

    S.lastSavedSnapshot = snapshotSelected();
    setDirty(false);
    setStatusOk("Status: OK");
    render.setAiHint("Publicerad.");
    renderAll();
  }

  function revertUnsaved() {
    if (!S.canWrite || S.locked || !S.selected) return;
    if (!S.lastSavedSnapshot) return;

    try {
      const back = JSON.parse(S.lastSavedSnapshot);
      S.selected = normalizeTraining(back);
      setDirty(false);
      setStatusOk("Status: OK");
      render.setAiHint("Återställde osparade ändringar.");
    } catch (_) {
      setStatusWarn("Status: Varning");
      render.setAiHint("Kunde inte återställa snapshot.");
    }
    renderAll();
  }

  function openEditBlock(idx) {
    // Minimal editor: edit JSON of block/items (XSS-safe via textarea)
    if (!S.canWrite || S.locked || !S.selected) return;
    const blocks = Array.isArray(S.selected.blocks) ? S.selected.blocks : [];
    const b = blocks[idx];
    if (!b) return;

    const wrap = document.createElement("div");
    const label = document.createElement("div");
    label.className = "muted2";
    label.style.textAlign = "left";
    label.textContent = "Redigera block som JSON (items). XSS-säkert, ingen HTML.";
    wrap.appendChild(label);

    const ta = document.createElement("textarea");
    ta.className = "textarea";
    ta.style.marginTop = "10px";
    ta.value = JSON.stringify(b, null, 2);
    wrap.appendChild(ta);

    render.openModal("Redigera block " + (idx + 1), wrap, function () {
      try {
        const parsed = JSON.parse(ta.value);
        // keep it tolerant but normalized
        S.selected.blocks[idx] = contract.normalizeBlock(parsed);
        setDirty(true);
        setStatusOk("Status: OK");
        render.setAiHint("Block uppdaterat (osparat).");
      } catch (e) {
        setStatusWarn("Status: Varning");
        render.setAiHint("Ogiltig JSON: " + String((e && e.message) || e));
      }
      renderAll();
    });
  }

  function deleteBlock(idx) {
    if (!S.canWrite || S.locked || !S.selected) return;
    const blocks = Array.isArray(S.selected.blocks) ? S.selected.blocks : [];
    if (!blocks[idx]) return;
    blocks.splice(idx, 1);
    S.selected.blocks = blocks;
    setDirty(true);
    setStatusOk("Status: OK");
    render.setAiHint("Block borttaget (osparat).");
    renderAll();
  }

  function testAI() {
    if (!S.canWrite || S.locked) return;
    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.health !== "function") {
      setStatusBad("Status: FEL");
      render.setAiHint("Worker SDK saknas (HRWorkerSDK.health).");
      renderAll();
      return;
    }

    render.setAiHint("Testar AI…");
    renderAll();

    window.HRWorkerSDK.health()
      .then(function (res) {
        const ok = !!(res && res.ok);
        if (ok) {
          setStatusOk("Status: OK");
          render.setAiHint("AI/Worker: OK");
        } else {
          setStatusWarn("Status: Varning");
          render.setAiHint("AI/Worker svarade men inte OK.");
        }
        renderAll();
      })
      .catch(function (e) {
        setStatusBad("Status: FEL");
        render.setAiHint("AI/Worker fel: " + String((e && e.message) || e));
        renderAll();
      });
  }

  function generateAI() {
    if (!S.canWrite || S.locked || !S.selected) return;

    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.aiGenerate !== "function") {
      setStatusBad("Status: FEL");
      render.setAiHint("Worker SDK saknas (HRWorkerSDK.aiGenerate).");
      renderAll();
      return;
    }

    syncFormToSelected();

    const ctx = core.buildAiContext({
      module: S.selected.module,
      area: S.selected.area,
      courseTitle: S.selected.courseTitle,
      courseStep: S.selected.courseStep,
      goalsLevel: S.selected.goalsLevel,
      goals: S.selected.goals
    });

    const mode = String(dom.aiContent && dom.aiContent.value || "blocks");
    const count = Number(dom.aiCount && dom.aiCount.value || 3);
    const qType = String(dom.aiQuestionType && dom.aiQuestionType.value || "auto");
    const feedbackEnabled = !!(dom.aiFeedbackEnabled && dom.aiFeedbackEnabled.checked);

    const payload = {
      mode,
      count: Math.max(1, Math.min(12, isFinite(count) ? count : 3)),
      context: ctx,
      language: "sv",
      // optional knobs for worker (safe, no new model)
      question: { type: qType, feedbackEnabled: feedbackEnabled }
    };

    // Fail-closed: do not send forbidden phrases in prompt context
    const blob = JSON.stringify(payload);
    if (core.containsForbidden(blob)) {
      setStatusWarn("Status: Varning");
      render.setAiHint("Stoppar AI-call: kontext innehåller förbjudna fraser.");
      renderAll();
      return;
    }

    render.setAiHint("Genererar…");
    renderAll();

    window.HRWorkerSDK.aiGenerate(payload)
      .then(function (res) {
        const norm = core.normalizeAiResult(res);
        const v = contract.validateAiResult(norm);
        if (!v.ok) {
          setStatusWarn("Status: Varning");
          render.setAiHint(v.reasons.join(" "));
          renderAll();
          return;
        }

        // Build a single block from items (keep simple)
        const items = (norm.items || []).map(contract.normalizeItem);
        const b = contract.normalizeBlock({
          title: "AI-block",
          module: S.selected.module,
          area: S.selected.area,
          step: S.selected.courseStep,
          status: "draft",
          items: items
        });

        if (!Array.isArray(S.selected.blocks)) S.selected.blocks = [];
        S.selected.blocks.push(b);

        setDirty(true);
        setStatusOk("Status: OK");
        render.setAiHint("AI klar. Block tillagt (osparat).");
        renderAll();
      })
      .catch(function (e) {
        setStatusBad("Status: FEL");
        render.setAiHint("AI fel: " + String((e && e.message) || e));
        renderAll();
      });
  }

  function onAnyEdit() {
    if (!S.canWrite || S.locked || !S.selected) return;
    syncFormToSelected();
    setDirty(true);
    renderAll();
  }

  function onCourseTouched() {
    S.courseTouched = true;
    onAnyEdit();
  }

  function onShowAll() {
    S.showAll = true;
    renderAll();
  }

  function onClearSearch() {
    S.q = "";
    S.fStatus = "";
    S.onlyProblems = false;
    S.showAll = false;

    dom.q.value = "";
    dom.fStatus.value = "";
    dom.onlyProblems.checked = false;

    render.setAiHint("");
    setStatusOk("Status: OK");
    renderAll();
  }

  function onModAll() {
    // Show list by forcing showAll (search-first)
    S.showAll = true;
    dom.q.focus();
    renderAll();
  }

  function onModClear() {
    if (!S.canWrite || S.locked || !S.selected) return;
    dom.mod.value = "";
    dom.area.value = "";
    refreshModuleAreaLists();
    onAnyEdit();
  }

  function logout() {
    try {
      if (window.HRApp && typeof window.HRApp.logout === "function") {
        window.HRApp.logout();
        return;
      }
      if (window.HRApp && typeof window.HRApp.clearSession === "function") {
        window.HRApp.clearSession();
      }
    } catch (_) {}
    // fallback: just reload to login route
    try { window.location.href = "./login.html"; } catch (_) {}
  }

  // ---------------------------
  // Boot
  // ---------------------------
  function init() {
    // 1) WHO + writer mode
    S.who = core.getWho();
    S.canWrite = !!(S.who && S.who.canWrite) && core.isAdminWriter(S.who);

    // 2) Storage load
    const load = store.load();
    if (!load.ok) {
      S.locked = true;
      S.lockReason = load.corrupt ? "Fail-closed: korrupt AO-057_TRAININGS_V1. " + store.lockReasonFor() : (load.err || "Kunde inte läsa storage.");
      S.trainings = Array.isArray(load.trainings) ? load.trainings.map(normalizeTraining) : [];
    } else {
      S.locked = false;
      S.lockReason = "";
      S.trainings = Array.isArray(load.trainings) ? load.trainings.map(normalizeTraining) : [];
    }

    // 3) Final read-only gate
    if (!S.canWrite || S.locked) {
      setReadOnlyUi(true, S.locked ? S.lockReason : "Read-only: du kan titta men inte spara/generera.");
      if (S.locked) setStatusBad("Status: FEL");
      else setStatusOk("Status: OK");
    } else {
      setReadOnlyUi(false);
      setStatusOk("Status: OK");
    }

    // 4) Wire events
    dom.on(dom.btnLogout, "click", logout);

    dom.on(dom.q, "input", function () { S.q = dom.q.value || ""; renderAll(); });
    dom.on(dom.fStatus, "change", function () { S.fStatus = dom.fStatus.value || ""; renderAll(); });
    dom.on(dom.onlyProblems, "change", function () { S.onlyProblems = !!dom.onlyProblems.checked; renderAll(); });

    dom.on(dom.btnShowAll, "click", onShowAll);
    dom.on(dom.btnClear, "click", onClearSearch);

    dom.on(dom.btnNew, "click", newTraining);
    dom.on(dom.btnDelete, "click", deleteSelected);
    dom.on(dom.btnPurge, "click", purgeAll);

    dom.on(dom.btnModAll, "click", onModAll);
    dom.on(dom.btnModClear, "click", onModClear);

    // dirty watchers
    const dirtyEls = dom.getDirtyWatchEls();
    dirtyEls.forEach(function (el) { dom.on(el, "input", onAnyEdit); dom.on(el, "change", onAnyEdit); });

    // course touched => regenerate title on change
    dom.on(dom.courseTitle, "change", onCourseTouched);
    dom.on(dom.courseStep, "change", onCourseTouched);

    // module affects area list
    dom.on(dom.mod, "input", function () { refreshModuleAreaLists(); onAnyEdit(); });

    dom.on(dom.area, "input", function () { refreshModuleAreaLists(); onAnyEdit(); });

    // AI actions
    dom.on(dom.btnTestAI, "click", testAI);
    dom.on(dom.btnGenAI, "click", generateAI);

    // save actions
    dom.on(dom.btnSaveDraft, "click", saveDraft);
    dom.on(dom.btnSavePublish, "click", savePublish);

    dom.on(dom.btnRevert, "click", revertUnsaved);

    // 5) initial UI
    render.setWhoPill(buildWhoText(S.who));
    refreshModuleAreaLists();
    renderAll();
  }

  // Safe init with DOM fail-closed reporting
  try {
    core.assert(dom && core && store && contract && render, "INIT_MISSING", "modules saknas");
    init();
  } catch (e) {
    try { render.setStatePill("Status: FEL", "bad"); } catch (_) {}
    try { render.setAiHint("Init fel: " + String((e && e.message) || e)); } catch (_) {}
    // eslint-disable-next-line no-console
    console.error("Trainings init failed:", e);
  }
})();
