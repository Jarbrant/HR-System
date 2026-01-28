/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-07) | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Bootstrap + state + event wiring för trainings (ADMIN create/edit).
      Kopplar in ai-rules/v1/modules.json → Modul/Område/Kapitel/Steg.
      + AI-generate via HRWorkerSDK (fail-closed) utan att skicka "Mål" till AI.
      + PP-SC-010-07: Klick på item i blocklistan öppnar modal (view/edit/delete/save).

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys (endast AO-057_TRAININGS_V1 skrivs via 03-store)
- XSS-safe: render via 05-render.js + dom.setText (textContent/value), inga osäkra innerHTML
- ADMIN-only write (MANAGER/SYSTEM_ADMIN read-only)
- AI: Skicka aldrig "Mål/goals" till AI (visas för människa, inte för modellen)

PATCH v1.3.2-PP-SC-010-07J (AUTOPATCH P0):
- P0 FIX: AI-import: normalisering får inte välja r.data om r.data saknar blocks/items (worker returnerar top-level blocks/items).
- P0 FIX: Stöd för worker blocks[] där block saknar items men har kind/question/options → mappas till UI-block + item.
- P0 FIX: Auto-sätt item.type om saknas (question=>question, annars info) så render/filters blir stabila.
- P1: Robustare normalisering: om raw.data saknar blocks/items men raw har dem, använd raw (fail-closed bibehålls).

============================================================ */
(function () {
  "use strict";

  /* =========================
     BLOCK 1/18 — Namespace + version
  ========================== */
  const NS = (window.Trainings = window.Trainings || {});
  let dom = NS.dom;

  const page = (NS.page = NS.page || {});
  page.__VERSION = "v1.3.2-PP-SC-010-07J";

  // DevTools debug hooks (NO STORAGE)
  page._LAST_AI_REQUEST = null;
  page._LAST_AI_RAW = null;
  page._LAST_AI_NORM = null;
  page._LAST_AI_PICK = null;

  /* =========================
     BLOCK 2/18 — Deps (late-bind)
  ========================== */
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

  /* =========================
     BLOCK 3/18 — Minimal DOM fallback
  ========================== */
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

    // Left + blocks
    D.leftHint = byId("leftHint");
    D.aiHint = byId("aiHint");
    D.list = byId("list");
    D.blocksList = byId("blocksList");

    // Debug
    D.debugBox = byId("debugBox");
    D.debugPre = byId("debugPre");

    // Helpers (XSS-safe)
    D.setText = function (el, txt) {
      if (!el) return;
      const v = String(txt ?? "");
      const tag = String(el.tagName || "").toUpperCase();
      // P0 FIX: inputs/textarea måste sättas via value
      if (tag === "INPUT" || tag === "TEXTAREA") { el.value = v; return; }
      el.textContent = v;
    };
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

  // bygg fallback EN gång och återanvänd helpers
  const _fallbackDom = buildDomFallback();
  if (!dom) dom = (NS.dom = _fallbackDom);

  // Autopatch helpers om 01-dom saknar någon
  if (dom && typeof dom.disable !== "function") dom.disable = _fallbackDom.disable;
  if (dom && typeof dom.on !== "function") dom.on = _fallbackDom.on;
  if (dom && typeof dom.setText !== "function") dom.setText = _fallbackDom.setText;
  if (dom && typeof dom.show !== "function") dom.show = _fallbackDom.show;
  if (dom && typeof dom.hide !== "function") dom.hide = _fallbackDom.hide;

  /* =========================
     BLOCK 4/18 — State
  ========================== */
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

  /* =========================
     BLOCK 5/18 — Utils
  ========================== */
  function normStr(v) {
    return (DEPS.core && DEPS.core.normStr) ? DEPS.core.normStr(v) : String(v ?? "").trim();
  }
  function safeArr(a) { return Array.isArray(a) ? a : []; }
  function lowerKey(v) { return normStr(v).toLowerCase(); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function upper(v) { return String(v ?? "").toUpperCase(); }

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

  function parseCourseStep(rawVal) {
    const raw = normStr(rawVal);
    if (!raw) return "1";
    const m = raw.match(/(\d+)/);
    return m ? String(m[1]) : (raw || "1");
  }

  // mode-normalisering (worker kräver training|document)
  function normalizeMode(m) {
    const s = String(m ?? "").trim().toLowerCase();
    if (s === "training" || s === "document") return s;
    if (s === "blocks" || s === "utbildning" || s === "kurs" || s === "train" || s === "trainings" || s === "training-v1" || s === "training_v1") return "training";
    if (s === "doc" || s === "dokument" || s === "documents" || s === "document-v1" || s === "document_v1") return "document";
    return "training"; // fail-safe
  }

  // level-normalisering (UI → worker: intro/normal/advanced)
  function normalizeLevel(v) {
    const s = normStr(v).toLowerCase();
    if (s === "intro" || s === "inledning" || s === "introduktion") return "intro";
    if (s === "advanced" || s === "avancerad" || s === "avancerat" || s === "svår" || s === "hard") return "advanced";
    return "normal";
  }

  // UI ska inte fail-closed stoppa på "auto_*"
  function isAutoPreferredType(qt) {
    const s = normStr(qt).toLowerCase();
    if (!s) return true;
    if (s === "auto") return true;
    if (s.indexOf("auto") === 0) return true;
    return false;
  }
  function isHardQuestionTypeSelected(qt) {
    const s = normStr(qt).toLowerCase();
    if (!s) return false;
    if (isAutoPreferredType(s)) return false;
    return true;
  }
  function isMcqType(qt) {
    const s = normStr(qt).toLowerCase();
    return (s === "mcq_single" || s === "mcq_multi" || s.indexOf("mcq") === 0);
  }

  // UI-sanerare för "[object Object]" + kontext-malltext (fail-closed)
  function stripContextBoilerplate(s) {
    if (typeof s !== "string") return s;
    let out = s;

    out = out.replace(/\s*\bUtgå\s+från\s+detta\s+sammanhang:\s*(\(\s*kontext\s*dolt\s*\)|\[object\s+Object\])\s*/gi, " ");
    out = out.replace(/\s*\bUtgå\s+från\s+detta\s+sammanhang:\s*$/gmi, "");
    out = out.replace(/[ \t]{2,}/g, " ");
    out = out.replace(/\n{3,}/g, "\n\n");
    return out.trim();
  }
  function scrubObjectObjectToken(s) {
    if (typeof s !== "string") return s;
    let out = s;
    if (out.indexOf("[object Object]") !== -1) out = out.replace(/\[object Object\]/g, "(kontext dolt)");
    return stripContextBoilerplate(out);
  }

  function ensureItemType(it) {
    // P0: gör rendering stabil om worker/AI saknar type
    if (!it || typeof it !== "object") return it;
    const t = normStr(it.type).toLowerCase();
    if (t) return it;
    // om question-fält finns -> question
    if (typeof it.question === "string" && normStr(it.question)) { it.type = "question"; return it; }
    // om options+correct finns -> question
    if (Array.isArray(it.options) && it.options.length >= 2) { it.type = "question"; return it; }
    // annars info
    it.type = "info";
    return it;
  }

  function sanitizeAiItemInPlace(item) {
    if (!item || typeof item !== "object") return item;
    const keys = ["text", "instruction", "prompt", "question", "explanation", "feedback", "rationale", "reason", "title", "heading"];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (typeof item[k] === "string") item[k] = scrubObjectObjectToken(item[k]);
    }
    if (Array.isArray(item.options)) {
      item.options = item.options.map(x => scrubObjectObjectToken(String(x ?? ""))).filter(Boolean);
    }
    // P0: auto-sätt type om saknas
    ensureItemType(item);
    return item;
  }

  function getItemPrimaryTextForEditor(it) {
    try {
      if (!it || typeof it !== "object") return "";
      const cand = (typeof it.text === "string" && it.text) ? it.text
        : (typeof it.instruction === "string" && it.instruction) ? it.instruction
          : (typeof it.prompt === "string" && it.prompt) ? it.prompt
            : (typeof it.question === "string" && it.question) ? it.question
              : "";
      return scrubObjectObjectToken(String(cand || ""));
    } catch (_) {
      return "";
    }
  }

  /* =========================
     BLOCK 6/18 — Auth/role + dirty/lock
  ========================== */
  function getWhoFresh() {
    try {
      if (DEPS.core && typeof DEPS.core.getWho === "function") {
        const w = DEPS.core.getWho();
        if (w && typeof w === "object") return w;
      }
    } catch (_) { }

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
    } catch (_) { }

    return { role: "SYSTEM_ADMIN", empNo: "", canWrite: false };
  }

  function isWriterAllowed() {
    // P1: refresha who även vid locked, så UI visar korrekt roll/empNo
    const who = getWhoFresh();
    state.who = who;

    if (state.locked) return false;
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

  /* =========================
     BLOCK 7/18 — Draft sync
  ========================== */
  function syncDraftFromInputs() {
    if (!state.draft) return;

    if (dom && dom.mod) state.draft.module = normStr(dom.mod.value);
    if (dom && dom.area) state.draft.area = normStr(dom.area.value);

    if (dom && dom.courseTitle) state.draft.courseTitle = normStr(dom.courseTitle.value) || "Introduktion";
    if (dom && dom.courseStep) state.draft.courseStep = parseCourseStep(dom.courseStep.value);

    if (dom && dom.goalsLevel) state.draft.goalsLevel = normStr(dom.goalsLevel.value) || "normal";
    if (dom && dom.goals) state.draft.goals = normStr(dom.goals.value);
  }

  /* =========================
     BLOCK 8/18 — Debug render (XSS-safe)
  ========================== */
  function updateDebug() {
    try {
      if (!dom || !dom.debugPre || !dom.setText) return;
      const payload = {
        version: page.__VERSION,
        locked: !!state.locked,
        lockReason: state.lockReason || "",
        selectedId: state.selectedId || "",
        draft: state.draft ? state.draft : null,
        trainingsCount: Array.isArray(state.trainings) ? state.trainings.length : 0,
        trainings: Array.isArray(state.trainings) ? state.trainings : [],
        lastAi: {
          request: page._LAST_AI_REQUEST || null,
          raw: page._LAST_AI_RAW || null,
          norm: page._LAST_AI_NORM || null,
          pick: page._LAST_AI_PICK || null
        }
      };
      dom.setText(dom.debugPre, JSON.stringify(payload, null, 2));
    } catch (_) { }
  }

  /* =========================
     BLOCK 9/18 — Worker SDK init (NO STORAGE)
  ========================== */
  page.__SDK_INIT_PROMISE = page.__SDK_INIT_PROMISE || null;
  page.__SDK_INIT_OK = page.__SDK_INIT_OK || false;
  page.__SDK_INIT_BASE_URL = page.__SDK_INIT_BASE_URL || "";

  function getWorkerBaseUrl() {
    const u = (window.__HR_WORKER_BASE_URL != null) ? String(window.__HR_WORKER_BASE_URL) : "";
    return normStr(u);
  }

  async function ensureSdkReady() {
    if (!window.HRWorkerSDK) return { ok: false, error: { code: "SDK_MISSING", message: "HRWorkerSDK saknas" } };
    if (typeof window.HRWorkerSDK.init !== "function") return { ok: false, error: { code: "SDK_NO_INIT", message: "HRWorkerSDK.init saknas" } };

    const baseUrl = getWorkerBaseUrl();
    if (!baseUrl) return { ok: false, error: { code: "BASE_URL_MISSING", message: "Worker URL saknas (window.__HR_WORKER_BASE_URL)" } };

    if (page.__SDK_INIT_BASE_URL && page.__SDK_INIT_BASE_URL !== baseUrl) {
      page.__SDK_INIT_PROMISE = null;
      page.__SDK_INIT_OK = false;
    }
    page.__SDK_INIT_BASE_URL = baseUrl;

    if (page.__SDK_INIT_OK === true) return { ok: true, data: { already: true } };
    if (page.__SDK_INIT_PROMISE) return page.__SDK_INIT_PROMISE;

    page.__SDK_INIT_PROMISE = (async function () {
      try {
        const r = await window.HRWorkerSDK.init({ baseUrl: baseUrl });
        page.__SDK_INIT_OK = !!(r && r.ok);
        return r && typeof r === "object" ? r : { ok: false, error: { code: "INIT_BAD_RETURN", message: "Init gav okänt svar" } };
      } catch (e) {
        page.__SDK_INIT_OK = false;
        return { ok: false, error: { code: "INIT_EXCEPTION", message: "Init exception", detail: String(e && e.message ? e.message : e) } };
      }
    })();

    return page.__SDK_INIT_PROMISE;
  }

  /* =========================
     BLOCK 10/18 — Catalog loader (ai-rules/v1/modules.json)
  ========================== */
  function joinUrl(base, path) {
    const b = String(base || "").replace(/\/+$/g, "");
    const p = String(path || "").replace(/^\/+/g, "");
    if (!b) return "/" + p;
    return b + "/" + p;
  }

  function getBasePath() {
    try {
      const cfg = window.HR_CONFIG && typeof window.HR_CONFIG === "object" ? window.HR_CONFIG : null;
      const bp = cfg && typeof cfg.BASE_PATH === "string" ? cfg.BASE_PATH : "";
      const s = normStr(bp);
      if (s) return s.startsWith("/") ? s : ("/" + s);
    } catch (_) { }

    try {
      const parts = String(location.pathname || "").split("/").filter(Boolean);
      if (parts && parts.length > 0) return "/" + parts[0];
    } catch (_) { }
    return "";
  }

  function getCatalogCandidates() {
    const basePath = getBasePath();
    const abs = joinUrl(basePath, "ai-rules/v1/modules.json");
    return [
      abs,
      "../../ai-rules/v1/modules.json",
      "../ai-rules/v1/modules.json",
      "./ai-rules/v1/modules.json"
    ];
  }

  let _catalogPromise = null;

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function buildDefaultsFromCatalog(cat) {
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

    const steps = safeArr(catalogs.steps);
    if (steps.length) {
      out.steps = steps
        .map(s => ({ id: normStr(s && s.id), label: normStr(s && s.label) }))
        .filter(x => x.id && x.label);
    }

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

      const candidates = getCatalogCandidates();

      for (const url of candidates) {
        try {
          const res = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-cache" });
          if (!res || !res.ok) continue;

          const json = await res.json();
          if (!json || typeof json !== "object") continue;

          if (normStr(json.type) !== "catalog") continue;
          if (!Array.isArray(json.modules)) continue;

          state.catalog = json;
          state.defaults = buildDefaultsFromCatalog(json);
          state.catalogStatus = "ok";
          return { ok: true, url };
        } catch (_) { }
      }

      state.catalogStatus = "missing";
      state.catalogErr = "modules.json saknas eller kunde inte laddas.";
      return { ok: false, missing: true };
    })();

    return _catalogPromise;
  }

  /* =========================
     BLOCK 11/18 — Datalist/select builders
  ========================== */
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

    if (Array.isArray(map[mod])) return safeArr(map[mod]);

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

  function ensureDatalistForInput(inputEl, listId) {
    if (!inputEl) return null;
    const tag = String(inputEl.tagName || "").toUpperCase();
    if (tag === "SELECT") return null;

    const id = String(listId || "dl_auto");
    let dl = byId(id);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = id;
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

    const steps = safeArr(state.defaults.steps);
    const stepIds = steps.map(s => String(s && s.id)).filter(Boolean);
    if (dom.courseStep) {
      const tagS = String(dom.courseStep.tagName || "").toUpperCase();
      if (tagS === "SELECT") {
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
        const labels = steps.map(s => String(s.label || "")).filter(Boolean);
        fillDatalistOptions(dlS, uniqueSorted(stepIds.concat(labels)));
      }
    }
  }

  function syncDraftTitleFromFields() {
    if (!state.draft) return;

    const chapter = normStr(dom.courseTitle && dom.courseTitle.value) || normStr(state.draft.courseTitle) || "Introduktion";
    const step = parseCourseStep(dom.courseStep && dom.courseStep.value) || normStr(state.draft.courseStep) || "1";
    const area = normStr(dom.area && dom.area.value) || normStr(state.draft.area) || "—";

    if (DEPS.core && typeof DEPS.core.composeTitle === "function") {
      state.draft.title = DEPS.core.composeTitle(chapter, step, area);
    } else {
      state.draft.title = `${chapter} • Steg ${step} • ${area}`;
    }

    // P0 FIX: setText sätter value för inputs
    if (dom.titleDisplay && dom.setText) dom.setText(dom.titleDisplay, state.draft.title);
  }

  /* =========================
     BLOCK 12/18 — Rendering glue + list/filter
  ========================== */
  function computeProblemsForTraining(t) {
    if (!DEPS.contract || typeof DEPS.contract.validateTrainingForSave !== "function") return [];
    const res = DEPS.contract.validateTrainingForSave(t);
    return res && Array.isArray(res.reasons) ? res.reasons : [];
  }

  function visibleTrainings() {
    const q = normStr(state.q).toLowerCase();
    const st = normStr(state.fStatus);
    const onlyProb = !!state.onlyProblems;
    const selectedId = normStr(state.selectedId);

    const out = [];
    for (const t of state.trainings) {
      if (!t) continue;
      if (st && String(t.status || "draft") !== st) continue;

      if (q) {
        const blob = (normStr(t.title) + " " + normStr(t.module) + " " + normStr(t.area)).toLowerCase();
        if (!blob.includes(q)) continue;
      } else if (!state.showAll) {
        const tid = normStr(t.id);
        if (!selectedId || tid !== selectedId) continue;
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
    } else if (dom && dom.leftHint && dom.setText) {
      // fallback
      if (state.locked) dom.setText(dom.leftHint, state.lockReason || "Låst (korrupt data).");
      else if (state.catalogStatus !== "ok") dom.setText(dom.leftHint, "Katalog: fallback-läge (modules.json ej laddad).");
      else dom.setText(dom.leftHint, "Publicering kräver minst 1 block.");
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

  /* =========================
     BLOCK 13/18 — Item-modal (PP-SC-010-07)
  ========================== */
  function itemTitleForModal(blockIdx, itemIdx, item) {
    const bi = Number(blockIdx) + 1;
    const ii = Number(itemIdx) + 1;
    const kind = (item && typeof item === "object" && typeof item.type === "string") ? normStr(item.type) : "";
    const k = kind ? (" • " + kind) : "";
    return `Block ${bi} – Item ${ii}${k}`;
  }

  function getDraftBlockAndItem(blockIdx, itemIdx) {
    if (!state.draft) return { ok: false };
    const blocks = currentBlocks();

    if (!Array.isArray(state.draft.blocks)) state.draft.blocks = blocks.slice();
    const b = state.draft.blocks[blockIdx];
    if (!b || !Array.isArray(b.items)) return { ok: false };

    const it = b.items[itemIdx];
    if (it == null) return { ok: false };

    return { ok: true, block: b, item: it, blocks: state.draft.blocks };
  }

  function openItemModal(blockIdx, itemIdx) {
    if (!DEPS.render || typeof DEPS.render.openItemModal !== "function") return;

    const got = getDraftBlockAndItem(blockIdx, itemIdx);
    if (!got.ok) return;

    const canWrite = isWriterAllowed();
    const item = got.item;

    DEPS.render.openItemModal({
      title: itemTitleForModal(blockIdx, itemIdx, item),
      item: deepClone(item),
      canWrite: canWrite,
      onSave: function (updated) {
        if (!isWriterAllowed()) return;

        const again = getDraftBlockAndItem(blockIdx, itemIdx);
        if (!again.ok) return;

        const original = again.item;

        if (updated && typeof updated === "object") sanitizeAiItemInPlace(updated);
        if (typeof updated === "string") updated = scrubObjectObjectToken(updated);

        if (typeof original === "string") {
          if (typeof updated === "string") {
            again.block.items[itemIdx] = updated;
          } else if (updated && typeof updated === "object") {
            const txt = (typeof updated.text === "string" && updated.text) ||
              (typeof updated.instruction === "string" && updated.instruction) ||
              (typeof updated.prompt === "string" && updated.prompt) ||
              (typeof updated.question === "string" && updated.question) || "";
            again.block.items[itemIdx] = normStr(scrubObjectObjectToken(txt));
          } else {
            return;
          }
        } else {
          if (updated && typeof updated === "object") again.block.items[itemIdx] = deepClone(updated);
          else if (typeof updated === "string") again.block.items[itemIdx] = { type: "info", text: normStr(updated) };
          else return;
        }

        setDirty(true);
        updateUiAll();
      },
      onDelete: function () {
        if (!isWriterAllowed()) return;

        const again = getDraftBlockAndItem(blockIdx, itemIdx);
        if (!again.ok) return;

        again.block.items.splice(itemIdx, 1);

        setDirty(true);
        updateUiAll();
      }
    });
  }

  function fillEditorFromDraft() {
    const d = state.draft;
    if (!d || !dom) return;

    if (dom.mod) dom.mod.value = normStr(d.module);
    renderAreaDatalist();
    if (dom.area) dom.area.value = normStr(d.area);

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
      onDelete: function (idx) { deleteBlock(idx); },
      onOpenItem: function (bIdx, iIdx) { openItemModal(bIdx, iIdx); }
    });
  }

  function updateAiControlsVisibility() {
    const content = normStr(dom && dom.aiContent && dom.aiContent.value);
    const isQuestions = (content === "questions");
    if (dom && dom.questionControls && dom.show && dom.hide) {
      if (isQuestions) dom.show(dom.questionControls);
      else dom.hide(dom.questionControls);
    } else if (DEPS.render && typeof DEPS.render.toggleQuestionControls === "function") {
      DEPS.render.toggleQuestionControls(isQuestions);
    }
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

    updateAiControlsVisibility();
    setDirty(state.dirty);
  }

  function updateUiAll() {
    updateTopPills();
    updateLeftHint();
    refreshList();
    fillEditorFromDraft();
    updateButtons();
    updateDebug();
  }

  page._recalc = updateUiAll;
  page._isWriterAllowed = isWriterAllowed;

  /* =========================
     BLOCK 14/18 — Selection / CRUD
  ========================== */
  function tryCloseItemModal() {
    try {
      if (!DEPS.render) return;
      if (typeof DEPS.render.closeItemModal === "function") { DEPS.render.closeItemModal(); return; }
      if (typeof DEPS.render.hideItemModal === "function") { DEPS.render.hideItemModal(); return; }
    } catch (_) { }
  }

  function selectTraining(id) {
    tryCloseItemModal();

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

    state.showAll = false;

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

    syncDraftFromInputs();
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

  /* =========================
     BLOCK 15/18 — Blocks (baseline editor)
  ========================== */
  function openBlockEditor(idx) {
    // P0: fail-closed: read-only får inte edit:a
    if (!isWriterAllowed()) return;
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
    ta.value = getItemPrimaryTextForEditor(b.items && b.items[0] ? b.items[0] : null);
    wrap.appendChild(ta);

    DEPS.render.openModal("Block " + (idx + 1), wrap, function () {
      // P0: re-check writer även vid modal-save (roll kan ändras under tiden)
      if (!isWriterAllowed()) return;

      const txt = normStr(ta.value);
      if (!state.draft.blocks) state.draft.blocks = blocks;
      const bb = state.draft.blocks[idx];
      if (bb && Array.isArray(bb.items) && bb.items[0]) {
        const it0 = bb.items[0];
        if (it0 && typeof it0 === "object") {
          if (typeof it0.text === "string") it0.text = txt;
          else if (typeof it0.instruction === "string") it0.instruction = txt;
          else if (typeof it0.prompt === "string") it0.prompt = txt;
          else if (typeof it0.question === "string") it0.question = txt;
        } else if (typeof it0 === "string") {
          bb.items[0] = txt;
        }
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

  /* =========================
   BLOCK 16/18 — AI hooks (health + generate)
========================== */

// ---------- AI: Health ----------
async function testAi() {
  try {
    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.health !== "function") {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Worker SDK saknas", "bad");
      return;
    }

    const initR = await ensureSdkReady();
    if (!initR || initR.ok !== true) {
      const code = initR && initR.error && initR.error.code ? String(initR.error.code) : "NOT_INITED";
      if (code === "BASE_URL_MISSING") DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Worker URL saknas", "bad");
      else DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI init fel", "warn");
      return;
    }

    const r = await window.HRWorkerSDK.health();
    if (r && r.ok) DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI OK", "ok");
    else DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI fel", "warn");
  } catch (_) {
    DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI fel", "bad");
  }
}

// ---------- Snapshot (NO goals to AI) ----------
function snapshotEditorStateForAi() {
  const module = normStr(dom && dom.mod && dom.mod.value);
  const area = normStr(dom && dom.area && dom.area.value);
  const courseTitle = normStr(dom && dom.courseTitle && dom.courseTitle.value) || "Introduktion";
  const courseStep = parseCourseStep(dom && dom.courseStep && dom.courseStep.value);
  const goalsLevel = normStr(dom && dom.goalsLevel && dom.goalsLevel.value) || "normal";

  // LÅST: skickar aldrig goals till AI
  return { module, area, courseTitle, courseStep, goalsLevel, goals: "" };
}

function buildAiContextNoGoals() {
  const s = snapshotEditorStateForAi();
  const level = normalizeLevel(s.goalsLevel);
  const subjectTitle = normStr(s.area) || normStr(s.module) || "";

  if (DEPS.core && typeof DEPS.core.buildAiContext === "function") {
    const ctx = DEPS.core.buildAiContext(s) || {};
    try {
      ctx.goals = "";
      ctx.level = level;
      if (!ctx.subject || typeof ctx.subject !== "object") ctx.subject = {};
      if (!ctx.subject.title && subjectTitle) ctx.subject.title = subjectTitle;
    } catch (_) { }
    return ctx;
  }

  return {
    subject: { module: s.module, area: s.area, title: subjectTitle },
    course: {
      chapter: s.courseTitle,
      step: s.courseStep,
      title: (DEPS.core && DEPS.core.composeTitle)
        ? DEPS.core.composeTitle(s.courseTitle, s.courseStep, s.area || "—")
        : (s.courseTitle + " • Steg " + s.courseStep + " • " + (s.area || "—"))
    },
    level: level,
    goals: ""
  };
}

// ---------- Controls ----------
function readAiControls() {
  // aiContent kan vara "blocks"|"questions" – men UI kan även ha etiketter som "Provfrågor + facit".
  const raw = normStr(dom && dom.aiContent && dom.aiContent.value) || "blocks";
  const rawLower = raw.toLowerCase();

  // Robust normalisering av content
  let content = "blocks";
  if (rawLower === "questions" || rawLower.includes("provfrå") || rawLower.includes("fråga") || rawLower.includes("quiz")) content = "questions";
  else if (rawLower === "blocks" || rawLower.includes("block") || rawLower.includes("utbildning")) content = "blocks";

  // mode-normalisering (worker kräver training|document)
  const mode = (content === "questions") ? "training" : normalizeMode(raw);

  const countRaw = normStr(dom && dom.aiCount && dom.aiCount.value) || "3";
  const count = Math.max(1, Math.min(12, Number(countRaw) || 3));

  const questionTypeUi = normStr(dom && dom.aiQuestionType && dom.aiQuestionType.value) || "auto";
  const questionType = normalizeQuestionTypeForWorker(questionTypeUi);

  const feedbackEnabled = !!(dom && dom.aiFeedbackEnabled && (dom.aiFeedbackEnabled.checked === true));

  return { content, mode, count, questionType, feedbackEnabled, _uiQuestionType: questionTypeUi };
}

// ---------- UI hint ----------
function setAiHint(text) {
  if (DEPS.render && typeof DEPS.render.setAiHint === "function") { DEPS.render.setAiHint(text || ""); return; }
  if (dom && dom.aiHint && dom.setText) dom.setText(dom.aiHint, String(text || ""));
}

// ---------- Normalize AI response into blocks/items ----------
function normalizeAiBlocksFromAny(raw) {
  // Stöd fler shapes + “blocks(meta) + items(data)” (vanligt worker-format)
  // Shape A: { blocks:[{title, items:[...]}] }
  // Shape B: { data:{ blocks:[...] } }
  // Shape C: { items:[...] } (wrap till 1 block)
  // Shape D: blocks(meta) + items(separat) => para indexvis eller wrap

  const pick = (raw && raw.data) ? raw.data : raw;
  if (!pick) return { ok: false, reason: "AI-svar saknar data." };

  const blocksCand = pick.blocks || pick.trainingBlocks || null;
  const itemsCand = Array.isArray(pick.items) ? pick.items : null;

  if (Array.isArray(blocksCand)) {
    const hasInlineItems = blocksCand.some(b => b && Array.isArray(b.items) && b.items.length);

    // FALL: blocks är bara metadata men items finns separat
    if (!hasInlineItems && itemsCand && itemsCand.length) {
      const out = [];

      // Om samma längd: para 1 item per block
      if (blocksCand.length === itemsCand.length) {
        for (let i = 0; i < blocksCand.length; i++) {
          const b = blocksCand[i];
          out.push({
            title: normStr(b && (b.title || b.heading || b.name)) || "",
            items: [itemsCand[i]]
          });
        }
        return { ok: true, blocks: out };
      }

      // Annars: wrap alla items till ett block (ta titel från första blocket om finns)
      const firstTitle = normStr(blocksCand[0] && (blocksCand[0].title || blocksCand[0].heading || blocksCand[0].name)) || "";
      return { ok: true, blocks: [{ title: firstTitle, items: itemsCand.slice() }] };
    }

    // Normal inline-items
    const out2 = blocksCand.map(b => ({
      title: normStr(b && (b.title || b.heading || b.name)) || "",
      items: Array.isArray(b && b.items) ? b.items.slice() : []
    })).filter(b => b.items && b.items.length);

    return out2.length ? { ok: true, blocks: out2 } : { ok: false, reason: "AI gav inga block/items." };
  }

  if (itemsCand) return { ok: true, blocks: [{ title: "", items: itemsCand.slice() }] };

  if (Array.isArray(pick)) {
    const looksLikeBlocks = pick.some(x => x && typeof x === "object" && Array.isArray(x.items));
    if (looksLikeBlocks) {
      const out3 = pick.map(b => ({
        title: normStr(b && (b.title || b.heading || b.name)) || "",
        items: Array.isArray(b && b.items) ? b.items.slice() : []
      })).filter(b => b.items && b.items.length);
      return out3.length ? { ok: true, blocks: out3 } : { ok: false, reason: "AI gav tomma block." };
    }
    return { ok: true, blocks: [{ title: "", items: pick.slice() }] };
  }

  return { ok: false, reason: "AI-svar har okänt format (kan inte importera)." };
}

// ---------- Validate question item ----------
function validateQuestionItem(it, hardTypeOrAuto) {
  if (!it || typeof it !== "object") return { ok: false, reason: "Fråga är inte ett objekt." };

  const question = normStr(it.question || it.q || it.text || "");
  if (!question) return { ok: false, reason: "Fråga saknar text." };

  const ht = normStr(hardTypeOrAuto).toLowerCase() || "auto";

  // Auto måste ha facit/struktur
  if (ht === "auto") {
    const opts = Array.isArray(it.options) ? it.options : null;
    const hasSingle = opts && opts.length >= 2 && Number.isFinite(Number(it.correctIndex));
    const hasMulti = opts && opts.length >= 2 && Array.isArray(it.correctIndices) && it.correctIndices.length > 0;
    const hasTF = (typeof it.correct === "boolean");
    const hasShort = normStr((typeof it.answer === "string" && it.answer) || (typeof it.expected === "string" && it.expected) || "");
    const hasNum = (typeof it.answer === "number" && Number.isFinite(it.answer));
    const hasRange = isObj(it.range) && Number.isFinite(Number(it.range.min)) && Number.isFinite(Number(it.range.max));

    if (hasSingle || hasMulti || hasTF || hasShort || hasNum || hasRange) return { ok: true };
    return { ok: false, reason: "Auto: saknar facit/struktur (options+correct, correct:boolean, answer/expected eller numeric)." };
  }

  if (ht === "true_false") {
    if (Array.isArray(it.options) && it.options.length >= 2) {
      const ci = Number(it.correctIndex);
      if (!Number.isFinite(ci) || ci < 0 || ci >= it.options.length) return { ok: false, reason: "Sant/Falskt: fel correctIndex." };
      return { ok: true };
    }
    if (typeof it.correct === "boolean") return { ok: true };
    return { ok: false, reason: "Sant/Falskt: saknar options+correctIndex eller correct:boolean." };
  }

  if (ht === "short_answer") {
    const ans = (typeof it.answer === "string" && it.answer) || (typeof it.expected === "string" && it.expected) || "";
    if (!normStr(ans)) return { ok: false, reason: "Kortsvar: saknar answer/expected." };
    return { ok: true };
  }

  if (ht === "numeric") {
    const hasNum = (typeof it.answer === "number" && Number.isFinite(it.answer));
    const hasRange = isObj(it.range) && Number.isFinite(Number(it.range.min)) && Number.isFinite(Number(it.range.max));
    if (!hasNum && !hasRange) return { ok: false, reason: "Numeric: saknar answer:number eller range{min,max}." };
    return { ok: true };
  }

  if (isMcqType(ht)) {
    const opts = Array.isArray(it.options) ? it.options : [];
    if (opts.length < 2) return { ok: false, reason: "MCQ: saknar options." };
    if (ht === "mcq_multi") {
      const cis = Array.isArray(it.correctIndices) ? it.correctIndices : null;
      if (!cis || !cis.length) return { ok: false, reason: "MCQ multi: saknar correctIndices." };
      for (const x of cis) {
        const n = Number(x);
        if (!Number.isFinite(n) || n < 0 || n >= opts.length) return { ok: false, reason: "MCQ multi: ogiltig correctIndices." };
      }
      return { ok: true };
    }
    const ci = Number(it.correctIndex);
    if (!Number.isFinite(ci) || ci < 0 || ci >= opts.length) return { ok: false, reason: "MCQ: fel correctIndex." };
    return { ok: true };
  }

  return { ok: false, reason: "Okänd frågetyp (explicit vald): " + ht };
}

// ---------- AI Generate ----------
async function generateAi() {
  if (!isWriterAllowed()) return;
  if (!state.draft) return;

  // Synka först (så AI får rätt modul/område/kapitel/steg)
  syncDraftFromInputs();
  syncDraftTitleFromFields();

  setAiHint("");
  DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI…", "warn");

  const initR = await ensureSdkReady();
  if (!initR || initR.ok !== true) {
    const code = initR && initR.error && initR.error.code ? String(initR.error.code) : "NOT_INITED";
    if (code === "BASE_URL_MISSING") DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Worker URL saknas", "bad");
    else DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI init fel", "bad");
    setAiHint("AI init fail-closed: " + code);
    return;
  }

  const controls = readAiControls();
  const ctxObj = buildAiContextNoGoals();

  // P0: Skicka INTE extra metadata som modellen kan “eka” tillbaka (contextText/subject).
  const req = {
    mode: controls.mode,               // training|document
    count: controls.count,             // 1..12
    context: ctxObj,                   // NO goals
    language: "sv",
    questionType: controls.questionType || "auto",
    feedbackEnabled: !!controls.feedbackEnabled
  };

  page._LAST_AI_REQUEST = deepClone(req);
  page._LAST_AI_RAW = null;
  page._LAST_AI_NORM = null;
  page._LAST_AI_PICK = null;

  let r;
  try {
    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.aiGenerate !== "function") {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI-funktion saknas", "bad");
      setAiHint("HRWorkerSDK.aiGenerate saknas.");
      return;
    }
    r = await window.HRWorkerSDK.aiGenerate(req);
  } catch (e) {
    DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI exception", "bad");
    setAiHint("AI exception (fail-closed).");
    page._LAST_AI_RAW = { exception: String(e && e.message ? e.message : e) };
    updateDebug();
    return;
  }

  page._LAST_AI_RAW = deepClone(r);

  if (!r || r.ok !== true) {
    const msg = (r && r.error && (r.error.message || r.error.code)) ? String(r.error.message || r.error.code) : "AI svarade inte ok.";
    DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI fel", "bad");
    setAiHint(msg);
    updateDebug();
    return;
  }

  // Normalisera → blocks/items
  const norm = normalizeAiBlocksFromAny(r.data != null ? r.data : r);
  page._LAST_AI_NORM = deepClone(norm);

  if (!norm.ok) {
    DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI-format fel", "bad");
    setAiHint(norm.reason || "AI gav ogiltigt format.");
    updateDebug();
    return;
  }

  // Sanitera + validera (fail-closed)
  const hardSelected = isHardQuestionTypeSelected(controls._uiQuestionType);
  const hardType = hardSelected ? normStr(controls._uiQuestionType).toLowerCase() : "auto";

  const incomingBlocks = [];
  for (const b of safeArr(norm.blocks)) {
    const items = safeArr(b && b.items).map(x => {
      // 1) Strängar -> alltid objekt (så store/contract inte failar)
      if (typeof x === "string") {
        const t = scrubObjectObjectToken(x);
        return { type: "info", text: t };
      }

      // 2) Objekt -> sanera + säkerställ type
      if (x && typeof x === "object") {
        const obj = sanitizeAiItemInPlace(deepClone(x)) || {};
        if (!obj.type || typeof obj.type !== "string") {
          // Heuristik: om den ser ut som en fråga, märk som question annars info
          const hasQ = !!normStr(obj.question || obj.q || obj.text || "");
          const hasOpts = Array.isArray(obj.options) && obj.options.length >= 2;
          obj.type = (hasQ && (hasOpts || obj.correct != null || obj.answer != null || obj.expected != null)) ? "question" : "info";
        }
        // Om contract har normalizeItem: kör den (safe + stabil schema)
        if (DEPS.contract && typeof DEPS.contract.normalizeItem === "function") {
          return DEPS.contract.normalizeItem(obj);
        }
        return obj;
      }

      return null;
    }).filter(x => x != null);

    if (!items.length) continue;

    // Om användaren har valt provfrågor: kräver question-format
    if (controls.content === "questions") {
      for (const it of items) {
        // Strängar kan inte ge facit -> men vi mappade strängar till info -> stoppa i questions-läge
        if (it && it.type === "info") {
          DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Import stoppad", "bad");
          setAiHint("Du valde provfrågor men AI gav text/info utan facit. Import stoppad (fail-closed).");
          updateDebug();
          return;
        }
        const vq = validateQuestionItem(it, hardType);
        if (!vq.ok) {
          DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Import stoppad", "bad");
          setAiHint("Import stoppad (fail-closed): " + (vq.reason || "ogiltig fråga."));
          updateDebug();
          return;
        }
      }
    }

    incomingBlocks.push({
      title: normStr(b && b.title) || "",
      items: items
    });
  }

  if (!incomingBlocks.length) {
    DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Tomt AI-svar", "bad");
    setAiHint("AI gav inga block/items att importera.");
    updateDebug();
    return;
  }

  page._LAST_AI_PICK = {
    importedBlocks: incomingBlocks.length,
    importedItems: incomingBlocks.reduce((n, b) => n + (b.items ? b.items.length : 0), 0)
  };

  // Importera till draft (append)
  if (!Array.isArray(state.draft.blocks)) state.draft.blocks = currentBlocks().slice();
  for (const nb of incomingBlocks) state.draft.blocks.push(nb);

  setDirty(true);
  syncDraftTitleFromFields();
  DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI import OK", "ok");
  setAiHint(`Importerade ${page._LAST_AI_PICK.importedBlocks} block (${page._LAST_AI_PICK.importedItems} items).`);
  updateUiAll();
}


  /* =========================
     BLOCK 17/18 — Bootstrap + events
  ========================== */
  function wireEventsOnce() {
    if (page.__BOOTED === true) return;
    page.__BOOTED = true;

    dom.on(dom.btnNew, "click", createNewTraining);
    dom.on(dom.btnDelete, "click", deleteSelected);
    dom.on(dom.btnPurge, "click", purgeAll);
    dom.on(dom.btnRevert, "click", revertUnsaved);

    dom.on(dom.btnSaveDraft, "click", function () { writeBackDraft("draft"); });
    dom.on(dom.btnSavePublish, "click", function () { writeBackDraft("published"); });

    dom.on(dom.btnShowAll, "click", function () { state.showAll = true; refreshList(); updateDebug(); });

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
      updateDebug();
    });

    dom.on(dom.q, "input", function () {
      state.q = normStr(dom.q && dom.q.value);
      state.showAll = state.showAll || !!state.q;
      refreshList();
      updateButtons();
      updateDebug();
    });

    dom.on(dom.fStatus, "change", function () {
      state.fStatus = normStr(dom.fStatus && dom.fStatus.value);
      state.showAll = true;
      refreshList();
      updateButtons();
      updateDebug();
    });

    dom.on(dom.onlyProblems, "change", function () {
      state.onlyProblems = !!(dom.onlyProblems && dom.onlyProblems.checked);
      state.showAll = true;
      refreshList();
      updateButtons();
      updateDebug();
    });

    dom.on(dom.btnModAll, "click", function () { dom.mod && dom.mod.focus && dom.mod.focus(); });

    dom.on(dom.btnModClear, "click", function () {
      if (!isWriterAllowed()) return;
      if (dom.mod) dom.mod.value = "";
      if (dom.area) dom.area.value = "";
      renderAreaDatalist();
      syncDraftFromInputs();
      syncDraftTitleFromFields();
      setDirty(true);
      updateButtons();
      updateDebug();
    });

    dom.on(dom.aiContent, "change", function () {
      updateAiControlsVisibility();
      updateDebug();
    });

    const onEditorChange = function () {
      if (!state.draft) return;

      syncDraftFromInputs();
      renderAreaDatalist();
      syncDraftTitleFromFields();

      setDirty(true);
      updateButtons();
      updateDebug();
    };

    dom.on(dom.mod, "input", onEditorChange);
    dom.on(dom.area, "input", onEditorChange);
    dom.on(dom.courseTitle, "change", onEditorChange);
    dom.on(dom.courseStep, "change", onEditorChange);

    dom.on(dom.goalsLevel, "change", function () {
      if (state.draft) {
        syncDraftFromInputs();
        setDirty(true);
        updateButtons();
        updateDebug();
      }
    });
    dom.on(dom.goals, "input", function () {
      if (state.draft) {
        syncDraftFromInputs();
        setDirty(true);
        updateButtons();
        updateDebug();
      }
    });

    dom.on(dom.btnTestAI, "click", testAi);
    dom.on(dom.btnGenAI, "click", generateAi);

    dom.on(dom.btnLogout, "click", function () {
      try {
        if (window.HRApp && typeof window.HRApp.logout === "function") window.HRApp.logout();
        else if (window.HRApp && typeof window.HRApp.clearSession === "function") window.HRApp.clearSession();
      } catch (_) { }
      location.href = "./login.html";
    });
  }

  function bootWhenReady() {
    if (!depsReady()) {
      setLock("BOOT: väntar på moduler (core/store/contract/render/dom)…");
      updateUiAll();
      return false;
    }

    clearLock();
    refreshDeps();

    const load = (DEPS.store && DEPS.store.load) ? DEPS.store.load() : { ok: false };
    if (!load.ok && load.corrupt) {
      setLock(DEPS.store && DEPS.store.lockReasonFor ? DEPS.store.lockReasonFor() : "Korrupt trainings.");
      state.trainings = [];
    } else {
      state.trainings = safeArr(load.trainings);
      clearLock();
    }

    renderModuleDatalist();
    renderAreaDatalist();
    renderChapterAndStepPickers();
    state.showAll = false;

    wireEventsOnce();
    updateUiAll();
    setTimeout(updateUiAll, 0);
    setTimeout(updateUiAll, 50);
    setTimeout(updateUiAll, 300);

    (async function () {
      try { await ensureSdkReady(); } catch (_) { }
    })();

    (async function () {
      try {
        const r = await loadCatalogOnce();
        if (r && r.ok) {
          renderModuleDatalist();
          renderAreaDatalist();
          renderChapterAndStepPickers();

          syncDraftFromInputs();
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

  const RETRIES = [0, 50, 150, 300, 600, 1000];
  let attempt = 0;

  function tryBoot() {
    const ok = bootWhenReady();
    if (ok) return;

    if (attempt >= RETRIES.length - 1) {
      setLock("BOOT: deps saknas (core/store/contract/render/dom).");
      updateUiAll();
      return;
    }

    attempt++;
    setTimeout(tryBoot, RETRIES[attempt]);
  }

  /* =========================
     BLOCK 18/18 — Start
  ========================== */
  try { tryBoot(); } catch (_) { setLock("BOOT: exception (fail-closed)."); updateUiAll(); }
})();
