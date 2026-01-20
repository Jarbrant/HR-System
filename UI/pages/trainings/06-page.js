/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-05) | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Bootstrap + state + event wiring för trainings (ADMIN create/edit).
      Nu: Koppla in ai-rules/v1/modules.json → Modul/Område/Kapitel/Steg.

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys (endast AO-057_TRAININGS_V1 skrivs via 03-store)
- XSS-safe: render via 05-render.js + dom.setText (textContent)
- ADMIN-only write (MANAGER/SYSTEM_ADMIN read-only)

PATCH v1.0.4-PP-SC-010-05 (AUTOPATCH):
- P0: Laddar ai-rules/v1/modules.json (same-origin) och bygger val-listor deterministiskt.
- P0: Fixar "områden kommer inte fram" via robust matchning (trim + case-insensitive).
- P0: Kapitel (7) + Steg (1–5) fylls i UI (select eller datalist) utan ny datamodell.
- P1: Titel synkas vid ändring: "<Kapitel> • Steg <N> • <Område>" via core.composeTitle().
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  let dom = NS.dom;

  const page = (NS.page = NS.page || {});
  page.__VERSION = "v1.0.4-PP-SC-010-05";

  // ------------------------------------------------------------
  // Deps (late-bind) — undvik att "fånga" NS.core innan den finns
  // ------------------------------------------------------------
  const DEPS = { core: null, store: null, contract: null, render: null };
  function refreshDeps() {
    DEPS.core = NS.core || null;
    DEPS.store = NS.store || null;
    DEPS.contract = NS.contract || null;
    DEPS.render = NS.render || null;
    return DEPS;
  }
  function depsReady() {
    refreshDeps();
    return !!(DEPS.core && DEPS.store && DEPS.contract && DEPS.render && dom);
  }

  // ------------------------------------------------------------
  // Minimal DOM fallback (om 01-dom saknas / är ofullständig)
  // ------------------------------------------------------------
  function byId(id) { return document.getElementById(String(id || "")); }

  function buildDomFallback() {
    const D = {};

    // Elements (måste matcha befintliga id i trainings.html)
    D.btnNew = byId("btnNew");
    D.btnDelete = byId("btnDelete");
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

  if (!dom) dom = (NS.dom = buildDomFallback());
  if (dom && typeof dom.disable !== "function") dom.disable = buildDomFallback().disable;
  if (dom && typeof dom.on !== "function") dom.on = buildDomFallback().on;
  if (dom && typeof dom.setText !== "function") dom.setText = buildDomFallback().setText;
  if (dom && typeof dom.show !== "function") dom.show = buildDomFallback().show;
  if (dom && typeof dom.hide !== "function") dom.hide = buildDomFallback().hide;

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  const state = {
    who: { role: "SYSTEM_ADMIN", empNo: "", canWrite: false },
    locked: true,
    lockReason: "BOOT: väntar på moduler…",
    trainings: [],
    selectedId: "",
    draft: null,
    dirty: false,
    showAll: false,
    q: "",
    fStatus: "",
    onlyProblems: false,

    // Catalog (ai-rules/v1/modules.json)
    catalog: null,
    catalogStatus: "pending", // pending|ok|missing|error
    catalogErr: "",

    defaults: {
      // Fallback (om catalog saknas) — minimal men fungerande
      modules: [
        "Kvalitet",
        "Säkerhet & arbetsmiljö",
        "Miljö",
        "Livsmedel",
        "Informationssäkerhet",
        "HR – vardag",
        "Ledarskap",
        "DISC-modellen",
        "Matematik",
        "Svenska"
      ],
      areasByModule: {
        "Kvalitet": ["ISO 9001", "Avvikelsehantering", "CAPA (åtgärder)", "Internrevision", "Mål & KPI"],
        "Säkerhet & arbetsmiljö": ["Skyddsrond", "Incident & tillbud", "Riskbedömning", "Ergonomi", "Psykosocial arbetsmiljö"],
        "Miljö": ["ISO 14001", "Avfall", "Energi", "Transport", "Kemikalier"],
        "Livsmedel": ["HACCP", "Kylkedja", "Hygien", "Allergen", "Spårbarhet"],
        "Informationssäkerhet": ["Lösenord & konton", "Phishing & bedrägeri", "Behörighet & roller", "Enheter & arbetsdator", "Säkerhetsincident"],
        "HR – vardag": ["Onboarding", "Policy & regler", "Feedback & samtal", "Konflikthantering", "Frånvaro & rutiner"],
        "Ledarskap": ["Planering", "Delegering", "Uppföljning", "Coachning", "Förändringsledning"],
        "DISC-modellen": ["D – Driv", "I – Inflytande", "S – Stabilitet", "C – Korrekthet", "Team & kommunikation"],
        "Matematik": ["Procent", "Grundräkning", "Enheter & omvandling", "Diagram & tolkning", "Problemlösning"],
        "Svenska": ["Läsförståelse", "Skriva tydligt", "Ton & bemötande", "Språkregler", "Sammanfatta"]
      },
      chapterLabels: [
        "Introduktion",
        "Grundläggande",
        "Rutiner & arbetssätt",
        "Scenario & tillämpning",
        "Avvikelser & risk",
        "Fördjupning",
        "Kontroll & test"
      ],
      steps: [
        { id: "1", label: "Kurs 1" },
        { id: "2", label: "Kurs 2" },
        { id: "3", label: "Kurs 3" },
        { id: "4", label: "Kurs 4" },
        { id: "5", label: "Kurs 5" }
      ]
    }
  };

  page._state = state;

  // ------------------------------------------------------------
  // Utils
  // ------------------------------------------------------------
  function normStr(v) {
    return (DEPS.core && DEPS.core.normStr) ? DEPS.core.normStr(v) : String(v ?? "").trim();
  }
  function safeArr(a) { return Array.isArray(a) ? a : []; }
  function lowerKey(v) { return normStr(v).toLowerCase(); }

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
    // Fail-closed: om locked/bootPending, behåll SYSTEM_ADMIN.
    try {
      if (DEPS.core && typeof DEPS.core.getWho === "function") {
        const w = DEPS.core.getWho();
        if (w && typeof w === "object") return w;
      }
    } catch (_) { /* ignore */ }

    try {
      if (window.HRApp && typeof window.HRApp.getRole === "function") {
        const r = window.HRApp.getRole();
        if (typeof r === "string") {
          const role = upper(r);
          return { role, empNo: "", canWrite: role === "ADMIN" };
        }
        if (r && typeof r === "object") {
          const role = upper(r.roleId || r.role || "SYSTEM_ADMIN");
          const empNo = String(r.empNo || r.emp || r.employeeNo || "");
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
    state.who = who;

    const role = upper(who.role || "SYSTEM_ADMIN");
    if (role !== "ADMIN") return false;

    if (who.canWrite === false) return false;
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
  function clearLock() {
    state.locked = false;
    state.lockReason = "";
  }

  // ------------------------------------------------------------
  // Catalog loader (ai-rules/v1/modules.json)
  // ------------------------------------------------------------
  const CATALOG_URLS = [
    "../ai-rules/v1/modules.json",
    "./ai-rules/v1/modules.json"
  ];
  let _catalogPromise = null;

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function buildDefaultsFromCatalog(cat) {
    // cat.modules[{label, areas[{label,chapterIds}]}], cat.catalogs.defaultChapterIds + catalogs.chapters
    const out = {
      modules: [],
      areasByModule: {},
      chapterLabels: [],
      steps: safeArr(state.defaults.steps)
    };

    const mods = safeArr(cat && cat.modules);
    out.modules = mods.map(m => normStr(m && m.label)).filter(Boolean);

    for (const m of mods) {
      const mLabel = normStr(m && m.label);
      if (!mLabel) continue;
      const areas = safeArr(m && m.areas).map(a => normStr(a && a.label)).filter(Boolean);
      out.areasByModule[mLabel] = areas;
    }

    // chapters
    const catalogs = isPlainObject(cat && cat.catalogs) ? cat.catalogs : {};
    const chapters = safeArr(catalogs.chapters);
    const defaultIds = safeArr(catalogs.defaultChapterIds);

    if (chapters.length && defaultIds.length) {
      const map = {};
      for (const ch of chapters) {
        const id = normStr(ch && ch.id);
        const label = normStr(ch && ch.label);
        if (id && label) map[id] = label;
      }
      out.chapterLabels = defaultIds.map(id => normStr(map[id])).filter(Boolean);
    } else {
      out.chapterLabels = safeArr(state.defaults.chapterLabels);
    }

    // steps
    const steps = safeArr(catalogs.steps);
    if (steps.length) {
      out.steps = steps
        .map(s => ({ id: normStr(s && s.id), label: normStr(s && s.label) }))
        .filter(x => x.id && x.label);
    }

    // Safety fallback
    if (!out.modules.length) out.modules = safeArr(state.defaults.modules);
    if (!Object.keys(out.areasByModule).length) out.areasByModule = state.defaults.areasByModule;
    if (!out.chapterLabels.length) out.chapterLabels = safeArr(state.defaults.chapterLabels);
    if (!out.steps.length) out.steps = safeArr(state.defaults.steps);

    return out;
  }

  async function loadCatalogOnce() {
    if (_catalogPromise) return _catalogPromise;

    _catalogPromise = (async function () {
      state.catalogStatus = "pending";
      state.catalogErr = "";

      for (const url of CATALOG_URLS) {
        try {
          const res = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-cache" });
          if (!res || !res.ok) continue;

          const json = await res.json();
          if (!json || typeof json !== "object") continue;

          // minimal validation
          if (normStr(json.type) !== "catalog") continue;
          if (!Array.isArray(json.modules)) continue;

          state.catalog = json;
          state.defaults = buildDefaultsFromCatalog(json);
          state.catalogStatus = "ok";
          return { ok: true, url };
        } catch (_) {
          // try next url
        }
      }

      state.catalogStatus = "missing";
      state.catalogErr = "modules.json saknas eller kunde inte laddas.";
      return { ok: false, missing: true };
    })();

    return _catalogPromise;
  }

  // ------------------------------------------------------------
  // Datalist / select builders (robust matchning)
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
      if (m && lowerKey(t.module) !== lowerKey(m)) continue;
      if (t.area) out.push(t.area);
    }
    return uniqueSorted(out);
  }

  function getAreasForModuleLoose(moduleVal) {
    const mod = normStr(moduleVal);
    if (!mod) return [];

    const map = state.defaults && state.defaults.areasByModule ? state.defaults.areasByModule : {};
    if (!isPlainObject(map)) return [];

    // 1) exact key
    if (Array.isArray(map[mod])) return safeArr(map[mod]);

    // 2) case-insensitive match (P0 fix: områden kommer inte fram)
    const want = lowerKey(mod);
    for (const k of Object.keys(map)) {
      if (lowerKey(k) === want) return safeArr(map[k]);
    }

    return [];
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

    const modVal = normStr(dom.mod && dom.mod.value);
    const fixed = safeArr(getAreasForModuleLoose(modVal));
    const fromData = collectAreasFromTrainingsForModule(modVal);
    const all = uniqueSorted(fixed.concat(fromData));

    for (const a of all) {
      const opt = document.createElement("option");
      opt.value = a;
      dom.areaList.appendChild(opt);
    }
  }

  // Kapitel (7) — fungerar för <select> eller <input list="...">
  function ensureDatalistForInput(inputEl, listId) {
    if (!inputEl) return null;
    const tag = String(inputEl.tagName || "").toUpperCase();
    if (tag === "SELECT") return null;

    const id = String(listId || "dl_auto");
    let dl = byId(id);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = id;
      // attach near input to keep DOM simple
      inputEl.parentNode && inputEl.parentNode.appendChild(dl);
    }
    inputEl.setAttribute("list", id);
    return dl;
  }

  function fillSelectOptions(selectEl, values, placeholder) {
    if (!selectEl) return;
    while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);

    if (placeholder) {
      const o0 = document.createElement("option");
      o0.value = "";
      o0.textContent = placeholder;
      selectEl.appendChild(o0);
    }

    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      selectEl.appendChild(o);
    }
  }

  function fillDatalistOptions(datalistEl, values) {
    if (!datalistEl) return;
    while (datalistEl.firstChild) datalistEl.removeChild(datalistEl.firstChild);
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      datalistEl.appendChild(opt);
    }
  }

  function renderChapterAndStepPickers() {
    // Chapters
    const chapters = safeArr(state.defaults.chapterLabels);
    if (dom.courseTitle) {
      const tag = String(dom.courseTitle.tagName || "").toUpperCase();
      if (tag === "SELECT") {
        fillSelectOptions(dom.courseTitle, chapters, "Välj kapitel…");
      } else {
        const dl = ensureDatalistForInput(dom.courseTitle, "courseTitleList");
        fillDatalistOptions(dl, chapters);
      }
    }

    // Steps
    const steps = safeArr(state.defaults.steps);
    const stepIds = steps.map(s => String(s && s.id)).filter(Boolean);
    if (dom.courseStep) {
      const tagS = String(dom.courseStep.tagName || "").toUpperCase();
      if (tagS === "SELECT") {
        // Visa "Kurs 1" men spara id (1..5) — men vi håller det enkelt: value = id, text = label
        while (dom.courseStep.firstChild) dom.courseStep.removeChild(dom.courseStep.firstChild);
        const ph = document.createElement("option");
        ph.value = "";
        ph.textContent = "Välj steg…";
        dom.courseStep.appendChild(ph);

        for (const s of steps) {
          const o = document.createElement("option");
          o.value = String(s.id);
          o.textContent = String(s.label || ("Kurs " + s.id));
          dom.courseStep.appendChild(o);
        }
      } else {
        const dlS = ensureDatalistForInput(dom.courseStep, "courseStepList");
        // input kan skriva "1" eller "Kurs 1" — vi erbjuder båda
        const labels = steps.map(s => String(s.label || "")).filter(Boolean);
        fillDatalistOptions(dlS, uniqueSorted(stepIds.concat(labels)));
      }
    }
  }

  function syncDraftTitleFromFields() {
    if (!state.draft) return;

    const chapter = normStr(dom.courseTitle && dom.courseTitle.value) || normStr(state.draft.courseTitle) || "Introduktion";
    const step = normStr(dom.courseStep && dom.courseStep.value) || normStr(state.draft.courseStep) || "1";
    const area = normStr(dom.area && dom.area.value) || normStr(state.draft.area) || "—";

    if (DEPS.core && typeof DEPS.core.composeTitle === "function") {
      state.draft.title = DEPS.core.composeTitle(chapter, step, area);
    } else {
      state.draft.title = `${chapter} • Steg ${step} • ${area}`;
    }

    if (dom.titleDisplay && dom.setText) dom.setText(dom.titleDisplay, state.draft.title);
  }

  // ------------------------------------------------------------
  // Rendering glue
  // ------------------------------------------------------------
  function computeProblemsForTraining(t) {
    if (!DEPS.contract || typeof DEPS.contract.validateTrainingForSave !== "function") return [];
    const res = DEPS.contract.validateTrainingForSave(t);
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
    if (DEPS.render && DEPS.render.setWhoPill) DEPS.render.setWhoPill(whoTxt);

    if (state.locked) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: LÅST", "bad");
    } else if (!writer) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Read-only", "warn");
    } else {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: OK", "ok");
    }
  }

  function updateLeftHint() {
    if (DEPS.render && DEPS.render.setLeftHint) {
      if (state.locked) DEPS.render.setLeftHint(state.lockReason || "Låst (korrupt data).");
      else if (state.catalogStatus !== "ok") DEPS.render.setLeftHint("Katalog: fallback-läge (modules.json ej laddad).");
      else DEPS.render.setLeftHint("Publicering kräver minst 1 block.");
    }
  }

  function refreshList() {
    const items = visibleTrainings();
    DEPS.render && DEPS.render.renderTrainingList && DEPS.render.renderTrainingList({
      items,
      selectedId: state.selectedId,
      onPick: function (id) { selectTraining(id); }
    });
  }

  function fillEditorFromDraft() {
    const d = state.draft;
    if (!d || !dom) return;

    if (dom.mod) dom.mod.value = normStr(d.module);
    renderAreaDatalist();
    if (dom.area) dom.area.value = normStr(d.area);

    // pickers
    renderChapterAndStepPickers();
    if (dom.courseTitle) dom.courseTitle.value = normStr(d.courseTitle) || "Introduktion";
    if (dom.courseStep) dom.courseStep.value = normStr(d.courseStep) || "1";

    if (dom.goalsLevel) dom.goalsLevel.value = normStr(d.goalsLevel) || "normal";
    if (dom.goals) dom.goals.value = normStr(d.goals) || "";

    syncDraftTitleFromFields();

    const blocks = currentBlocks();
    DEPS.render && DEPS.render.renderBlocksList && DEPS.render.renderBlocksList({
      blocks,
      onEdit: function (idx) { openBlockEditor(idx); },
      onDelete: function (idx) { deleteBlock(idx); }
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
    const chapter = "Introduktion";
    const step = "1";
    const area = "—";
    const title = (DEPS.core && typeof DEPS.core.composeTitle === "function")
      ? DEPS.core.composeTitle(chapter, step, area)
      : `${chapter} • Steg ${step} • ${area}`;

    return {
      id: (DEPS.core && typeof DEPS.core.makeId === "function") ? DEPS.core.makeId("tr") : ("tr_" + Date.now()),
      status: "draft",
      module: "",
      area: "",
      courseTitle: chapter,
      courseStep: step,
      goalsLevel: "normal",
      goals: "",
      title: title,
      blocks: [],
      meta: { createdAt: Date.now(), createdBy: who.empNo || "" }
    };
  }

  function createNewTraining() {
    if (!isWriterAllowed()) return;

    const t = newTrainingTemplate();
    state.trainings.unshift(t);
    state.selectedId = t.id;
    state.draft = deepClone(t);

    const s = DEPS.store && DEPS.store.save ? DEPS.store.save(state.trainings) : { ok: false };
    if (!s || !s.ok) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Kunde inte spara", "bad");
      return;
    }

    state.showAll = true;
    setDirty(false);
    renderModuleDatalist();
    renderAreaDatalist();
    renderChapterAndStepPickers();
    updateUiAll();
  }

  function deleteSelected() {
    if (!isWriterAllowed()) return;
    if (!state.selectedId) return;

    const idx = findTrainingIndexById(state.selectedId);
    if (idx < 0) return;

    state.trainings.splice(idx, 1);
    const s = DEPS.store && DEPS.store.save ? DEPS.store.save(state.trainings) : { ok: false };
    if (!s || !s.ok) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Kunde inte spara", "bad");
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

    const p = DEPS.store && DEPS.store.purgeAll ? DEPS.store.purgeAll() : { ok: false };
    if (!p || !p.ok) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Kunde inte rensa", "bad");
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
    if (dom && dom.courseTitle) state.draft.courseTitle = normStr(dom.courseTitle.value) || "Introduktion";
    if (dom && dom.courseStep) {
      // accept "Kurs 1" in input, normalize to "1"
      const raw = normStr(dom.courseStep.value);
      const m = raw.match(/(\d+)/);
      state.draft.courseStep = m ? String(m[1]) : (raw || "1");
    }
    if (dom && dom.goalsLevel) state.draft.goalsLevel = normStr(dom.goalsLevel.value);
    if (dom && dom.goals) state.draft.goals = normStr(dom.goals.value);

    // Title sync (P1)
    syncDraftTitleFromFields();

    state.draft.status = (status === "published") ? "published" : "draft";

    const v = (status === "published" && DEPS.contract && DEPS.contract.validateForPublish)
      ? DEPS.contract.validateForPublish(state.draft)
      : (DEPS.contract && DEPS.contract.validateTrainingForSave)
        ? DEPS.contract.validateTrainingForSave(state.draft)
        : { ok: true, reasons: [] };

    if (!v.ok) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Kan inte spara", "bad");
      DEPS.render && DEPS.render.setAiHint && DEPS.render.setAiHint((v.reasons || []).join(" "));
      return;
    }

    if (status === "published" && !hasAnyItems()) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Kan inte publicera", "bad");
      DEPS.render && DEPS.render.setAiHint && DEPS.render.setAiHint("Publicering kräver minst 1 block/item.");
      return;
    }

    const idx = findTrainingIndexById(state.selectedId);
    if (idx < 0) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Saknar vald utbildning", "bad");
      return;
    }

    state.trainings[idx] = deepClone(state.draft);

    const s = DEPS.store && DEPS.store.save ? DEPS.store.save(state.trainings) : { ok: false };
    if (!s || !s.ok) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Kunde inte spara", "bad");
      return;
    }

    setDirty(false);
    DEPS.render && DEPS.render.setAiHint && DEPS.render.setAiHint("");
    renderModuleDatalist();
    renderAreaDatalist();
    updateUiAll();
  }

  // ------------------------------------------------------------
  // Blocks (minimal baseline)
  // ------------------------------------------------------------
  function openBlockEditor(idx) {
    if (!state.draft || !DEPS.render || typeof DEPS.render.openModal !== "function") return;

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

    DEPS.render.openModal("Block " + (idx + 1), wrap, function () {
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
        DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Worker SDK saknas", "bad");
        return;
      }
      const r = await window.HRWorkerSDK.health();
      if (r && r.ok) DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI OK", "ok");
      else DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI fel", "warn");
    } catch (_) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI fel", "bad");
    }
  }

  // ------------------------------------------------------------
  // Bootstrap (retry)
  // ------------------------------------------------------------
  function wireEventsOnce() {
    if (page.__BOOTED === true) return;
    page.__BOOTED = true;

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
      syncDraftTitleFromFields();
      setDirty(true);
      updateButtons();
    });

    const onEditorChange = function () {
      if (!state.draft) return;
      renderAreaDatalist();
      syncDraftTitleFromFields();
      setDirty(true);
      updateButtons();
    };

    dom.on(dom.mod, "input", onEditorChange);
    dom.on(dom.area, "input", onEditorChange);
    dom.on(dom.courseTitle, "change", onEditorChange);
    dom.on(dom.courseStep, "change", onEditorChange);

    dom.on(dom.goalsLevel, "change", function () {
      if (state.draft) {
        state.draft.goalsLevel = normStr(dom.goalsLevel && dom.goalsLevel.value);
        setDirty(true);
        updateButtons();
      }
    });
    dom.on(dom.goals, "input", function () {
      if (state.draft) {
        state.draft.goals = normStr(dom.goals && dom.goals.value);
        setDirty(true);
        updateButtons();
      }
    });

    dom.on(dom.btnTestAI, "click", testAi);

    dom.on(dom.btnLogout, "click", function () {
      try {
        if (window.HRApp && typeof window.HRApp.logout === "function") window.HRApp.logout();
        else if (window.HRApp && typeof window.HRApp.clearSession === "function") window.HRApp.clearSession();
      } catch (_) { }
      location.href = "./login.html";
    });
  }

  function bootWhenReady() {
    // Fail-closed tills deps finns, men inte permanent lock pga load-order.
    if (!depsReady()) {
      setLock("BOOT: väntar på moduler (core/store/contract/render/dom)…");
      updateUiAll();
      return false;
    }

    clearLock();
    refreshDeps();

    // Load trainings
    const load = (DEPS.store && DEPS.store.load) ? DEPS.store.load() : { ok: false };
    if (!load.ok && load.corrupt) {
      setLock(DEPS.store && DEPS.store.lockReasonFor ? DEPS.store.lockReasonFor() : "Korrupt trainings.");
      state.trainings = [];
    } else {
      state.trainings = safeArr(load.trainings);
      clearLock();
    }

    // Baseline lists
    renderModuleDatalist();
    renderAreaDatalist();
    renderChapterAndStepPickers();

    state.showAll = false;

    wireEventsOnce();

    updateUiAll();
    setTimeout(updateUiAll, 0);
    setTimeout(updateUiAll, 50);
    setTimeout(updateUiAll, 300);

    // Async: load catalog and re-render lists (utan att bryta boot)
    (async function () {
      try {
        const r = await loadCatalogOnce();
        if (r && r.ok) {
          renderModuleDatalist();
          renderAreaDatalist();
          renderChapterAndStepPickers();
          updateUiAll();
        } else {
          updateUiAll();
        }
      } catch (_) {
        state.catalogStatus = "error";
        state.catalogErr = "Katalog exception.";
        updateUiAll();
      }
    })();

    return true;
  }

  // Retry-loop (kort)
  const RETRIES = [0, 50, 150, 300, 600, 1000];
  let attempt = 0;

  function tryBoot() {
    const ok = bootWhenReady();
    if (ok) return;

    if (attempt >= RETRIES.length - 1) {
      // Efter retries: permanent fail-closed (men med tydlig orsak)
      setLock("BOOT: deps saknas (core/store/contract/render/dom).");
      updateUiAll();
      return;
    }

    attempt++;
    setTimeout(tryBoot, RETRIES[attempt]);
  }

  try { tryBoot(); } catch (_) { setLock("BOOT: exception (fail-closed)."); updateUiAll(); }
})();
