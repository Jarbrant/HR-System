/* ============================================================
AO-TRAININGS-VERKSAMHET-ANCHOR-01 (PROD) | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)

Mål (Patchpaket 4):
1) Ta bort “Titel (genererad)” som input (ingen sparning från input).
2) Lägg till “AI-ankare / Kontext-rad” (read-only): Modul • Område • Kapitel • Steg • Nivå • Verksamhet
   - Visuell förklaring i UI
   - Skickas som kort sträng i AI-request (utan ny storage-key; byggs dynamiskt).
3) Lägg till “Verksamhet” under subjectId (15 vanligaste + Annat… + sök på 3+ bokstäver).
   - Lagring: training.businessArea (inom befintlig AO-057_TRAININGS_V1 struktur; ingen ny key).
4) P0: Flatten/normalisera AI question-shape till stabilt UI-format, fail-closed med tydlig orsak.

TILLÄGG (FÖRSLAG, UI-only, NO STORAGE):
- Kurs-spår (Course 1 vs Course 2) som påverkar endast AI-request + ankare.
  - DOM-id: courseTrack (valfritt; om saknas => default course1)

BESLUT (2026-01): Document-only nu (låg risk, direkt nytta). Spel/frågor senare.
- AI ska alltid köras i document-mode i denna sida (fail-closed om UI försöker “questions”).

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys (endast befintlig trainings-key via 03-store)
- XSS-safe: endast textContent/value (ingen osäker innerHTML)
- RBAC: SYSTEM_ADMIN read-only; ADMIN/MANAGER enligt befintlig logik
- AI: Skicka aldrig "Mål/goals" till AI

DoD:
- Titel-input borta (ingen wiring)
- Ankare-rad syns och uppdateras live
- Verksamhet under subjectId: 15+Annat, filtrering efter 3 bokstäver
- Verksamhet sparas/laddas per training
- AI-request inkluderar ankare-strängen
- P0 flatten: stabil question-items eller fail-closed med tydlig orsak
============================================================ */
(function () {
  "use strict";

  /* =========================
     BLOCK 1/19 — Namespace + version
  ========================== */
  const NS = (window.Trainings = window.Trainings || {});
  let dom = NS.dom;

  const page = (NS.page = NS.page || {});
  page.__VERSION = "v1.4.7-AO-TRAININGS-VERKSAMHET-ANCHOR-01-DOCONLY"; // PATCH: auto-create business search input for SELECT-only UIs

  // Document-only flag (NO STORAGE)
  const DOCUMENT_ONLY = true;

  // DevTools debug hooks (NO STORAGE)
  page._LAST_AI_REQUEST = null;
  page._LAST_AI_RAW = null;
  page._LAST_AI_NORM = null;
  page._LAST_AI_PICK = null;

  /* =========================
     BLOCK 2/19 — Deps (late-bind)
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
     BLOCK 3/19 — Minimal DOM fallback
  ========================== */
  function byId(id) { return document.getElementById(String(id || "")); }

  function buildDomFallback() {
    const D = {};

    // Buttons
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

    // List/filter
    D.q = byId("q");
    D.fStatus = byId("fStatus");
    D.onlyProblems = byId("onlyProblems");

    // Module/area
    D.mod = byId("mod");
    D.area = byId("area");
    D.modList = byId("modList");
    D.areaList = byId("areaList");

    // Chapter/step
    D.courseTitle = byId("courseTitle");
    D.courseStep = byId("courseStep");

    // (FÖRSLAG) Course Track (optional, no storage)
    D.courseTrack = byId("courseTrack");

    // Level/goals (goals never sent to AI)
    D.goalsLevel = byId("goalsLevel");
    D.goals = byId("goals");

    // AO: Verksamhet
    D.businessArea = byId("businessArea");
    D.businessAreaSearch = byId("businessAreaSearch");
    D.businessAreaOther = byId("businessAreaOther");
    D.businessAreaHint = byId("businessAreaHint");

    // Display (read-only)
    D.titleDisplay = byId("titleDisplay");
    D.subjectIdText = byId("subjectIdText");

    // AO: AI-ankare rad (read-only)
    D.aiAnchorText = byId("aiAnchorText");

    D.revertHint = byId("revertHint");

    // AI controls
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

  const _fallbackDom = buildDomFallback();
  if (!dom) dom = (NS.dom = _fallbackDom);

  // Autopatch helpers om 01-dom saknar någon
  if (dom && typeof dom.disable !== "function") dom.disable = _fallbackDom.disable;
  if (dom && typeof dom.on !== "function") dom.on = _fallbackDom.on;
  if (dom && typeof dom.setText !== "function") dom.setText = _fallbackDom.setText;
  if (dom && typeof dom.show !== "function") dom.show = _fallbackDom.show;
  if (dom && typeof dom.hide !== "function") dom.hide = _fallbackDom.hide;

  // PATCH (P0 UI): Om UI bara har "businessAreaSearch" som rutan man skriver i,
  // aliasa den till businessArea så all logik (datalist/fill/read/save) funkar.
  if (dom && !dom.businessArea && dom.businessAreaSearch) {
    dom.businessArea = dom.businessAreaSearch;
  }

  /* =========================
     BLOCK 3.05/19 — P0 UI: Ensure "Verksamhet search" exists for SELECT UIs
     - If UI has <select id="businessArea"> but no input#businessAreaSearch,
       create a lightweight search input (NO STORAGE) so 3+ bokstäver filter is possible.
  ========================== */
  function ensureBusinessAreaSearchForSelectUi() {
    try {
      if (!dom) return;
      if (!dom.businessArea) return;

      const tag = String(dom.businessArea.tagName || "").toUpperCase();
      if (tag !== "SELECT") return;

      // If already present, nothing to do.
      if (dom.businessAreaSearch) return;

      const parent = dom.businessArea.parentNode;
      if (!parent || typeof parent.insertBefore !== "function") return;

      // Avoid duplicates if something else created it.
      const existing = byId("businessAreaSearch");
      if (existing) {
        dom.businessAreaSearch = existing;
        return;
      }

      const inp = document.createElement("input");
      inp.id = "businessAreaSearch";
      inp.type = "text";
      inp.autocomplete = "off";
      inp.placeholder = "Sök verksamhet (min 3 bokstäver)…";
      // Try to match common input styling without requiring CSS changes
      inp.className = "input";
      inp.setAttribute("aria-label", "Sök verksamhet");
      inp.style.margin = "6px 0";
      inp.style.width = "100%";

      parent.insertBefore(inp, dom.businessArea);
      dom.businessAreaSearch = inp;
    } catch (_) { }
  }

  /* =========================
     BLOCK 3.1/19 — P0 UI: Enforce document-only in dropdown
     (NO STORAGE, fail-closed)
  ========================== */
  function enforceAiContentUiDocumentOnly() {
    try {
      if (!DOCUMENT_ONLY) return;
      if (!dom || !dom.aiContent) return;

      const el = dom.aiContent;
      const tag = String(el.tagName || "").toUpperCase();
      if (tag !== "SELECT") {
        // if it's input, just set value text and disable if possible
        try { el.value = "document"; } catch (_) { }
        if (dom.disable) dom.disable(el, true);
        return;
      }

      // Ensure there is a "document" option so UI can actually show it.
      const opts = el.options ? Array.from(el.options) : [];
      const hasDoc = opts.some(o => String(o && o.value) === "document");

      if (!hasDoc) {
        const o = document.createElement("option");
        o.value = "document";
        o.textContent = "Dokument (låst)";
        el.appendChild(o);
      } else {
        // Rename label to avoid confusion (optional, harmless)
        for (const o of opts) {
          if (String(o && o.value) === "document" && o.textContent) {
            if (o.textContent.toLowerCase().indexOf("dokument") === -1) o.textContent = "Dokument (låst)";
          }
        }
      }

      // Force selection + disable
      el.value = "document";
      if (dom.disable) dom.disable(el, true);
    } catch (_) { }
  }

  /* =========================
     BLOCK 4/19 — State
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

    // AO: verksamhet
    businessAreaQuery: "",

    // AO: ankare (computed)
    aiAnchorLine: "",

    // Catalog (ai-rules/v1/modules.json)
    catalog: null,
    catalogStatus: "pending", // pending|ok|missing|error
    catalogErr: "",

    defaults: {
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
     BLOCK 5/19 — Utils
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

  /* =========================
     BLOCK 5.1/19 — (FÖRSLAG) Course track helpers (NO STORAGE)
  ========================== */
  function normalizeCourseTrack(raw) {
    const s = normStr(raw).toLowerCase();
    if (!s) return "course1";
    if (s === "1" || s === "course1" || s === "kurs1" || s === "grund" || s === "grundkurs" || s === "standard") return "course1";
    if (s === "2" || s === "course2" || s === "kurs2" || s === "tillämpning" || s === "tillampning" || s === "coach" || s === "ledarspår" || s === "ledarspar") return "course2";
    if (s.indexOf("1") === 0) return "course1";
    if (s.indexOf("2") === 0) return "course2";
    return "course1";
  }

  function courseTrackLabel(track) {
    const t = normalizeCourseTrack(track);
    return (t === "course2") ? "Tillämpning" : "Grund";
  }

  function readCourseTrackFromUi() {
    try {
      const el = dom && dom.courseTrack ? dom.courseTrack : null;
      if (!el) return "course1";
      return normalizeCourseTrack(el.value);
    } catch (_) {
      return "course1";
    }
  }

  /* =========================
     BLOCK 6/19 — AO: Verksamhet (businessArea) helpers
  ========================== */
  const BUSINESS_OTHER_LABEL = "Annat…";
  const BUSINESS_DEFAULTS = [
    "Bygg & anläggning",
    "Butik & retail",
    "Ekonomi & administration",
    "Fastighet & drift",
    "Förskola & skola",
    "Hälsa & vård",
    "Hotell",
    "Industri & produktion",
    "IT & support",
    "Lager & logistik",
    "Restaurang & café",
    "Säkerhet & bevakning",
    "Städ & service",
    "Transport",
    "Äldreomsorg"
  ];

  function uniqueSorted(list) {
    const set = new Set();
    for (const x of safeArr(list)) {
      const s = normStr(x);
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "sv"));
  }

  function isBusinessDefault(v) {
    const s = lowerKey(v);
    if (!s) return false;
    for (const d of BUSINESS_DEFAULTS) if (lowerKey(d) === s) return true;
    return false;
  }

  function collectBusinessAreasFromAllTrainings() {
    const out = [];
    for (const t of safeArr(state.trainings)) {
      if (!t || typeof t !== "object") continue;
      const v = normStr(t.businessArea);
      if (!v) continue;
      if (lowerKey(v) === lowerKey(BUSINESS_OTHER_LABEL)) continue;
      if (isBusinessDefault(v)) continue;
      out.push(v);
    }
    try {
      const dv = normStr(state.draft && state.draft.businessArea);
      if (dv && !isBusinessDefault(dv) && lowerKey(dv) !== lowerKey(BUSINESS_OTHER_LABEL)) out.push(dv);
    } catch (_) { }
    return uniqueSorted(out);
  }

  function composeBusinessOptionsForUi() {
    const custom = collectBusinessAreasFromAllTrainings();
    return uniqueSorted(BUSINESS_DEFAULTS.concat(custom));
  }

  function filterBusinessOptions(options, q) {
    const query = normStr(q).toLowerCase();
    if (query.length < 3) return options;
    return options.filter(v => lowerKey(v).indexOf(query) === 0);
  }

  function setBusinessHint(msg) {
    if (dom && dom.businessAreaHint && dom.setText) dom.setText(dom.businessAreaHint, msg || "");
  }

  function getBusinessPickerEl() {
    if (!dom) return null;
    if (dom.businessAreaSearch) return dom.businessAreaSearch;
    if (dom.businessArea) return dom.businessArea;
    return null;
  }

  function ensureBusinessAreaDatalist(inputEl) {
    if (!inputEl) return null;
    const tag = String(inputEl.tagName || "").toUpperCase();
    if (tag === "SELECT") return null;

    const id = "businessAreaList";
    let dl = byId(id);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = id;
      inputEl.parentNode && inputEl.parentNode.appendChild(dl);
    }
    inputEl.setAttribute("list", id);
    return dl;
  }

  function fillDatalistOptionsQuick(datalistEl, values) {
    if (!datalistEl) return;
    while (datalistEl.firstChild) datalistEl.removeChild(datalistEl.firstChild);
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      datalistEl.appendChild(opt);
    }
  }

  function fillSelectOptionsQuick(selectEl, values, placeholder) {
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

  function listHasValueCaseInsensitive(list, value) {
    const want = lowerKey(value);
    if (!want) return true;
    for (const x of safeArr(list)) {
      if (lowerKey(x) === want) return true;
    }
    return false;
  }
  function ensureValueInList(list, value) {
    const v = normStr(value);
    if (!v) return list;
    if (lowerKey(v) === lowerKey(BUSINESS_OTHER_LABEL)) return list;
    if (listHasValueCaseInsensitive(list, v)) return list;
    const out = safeArr(list).slice();
    out.unshift(v);
    return out;
  }
  function restoreSelectValueCaseInsensitive(selectEl, desiredValue) {
    if (!selectEl) return;
    const want = normStr(desiredValue);
    if (!want) return;
    selectEl.value = want;
    if (normStr(selectEl.value) === want) return;

    const wantKey = lowerKey(want);
    try {
      const opts = selectEl.options ? Array.from(selectEl.options) : [];
      for (const o of opts) {
        const ov = normStr(o && o.value);
        if (!ov) continue;
        if (lowerKey(ov) === wantKey) { selectEl.value = ov; return; }
      }
    } catch (_) { }
  }

  function renderBusinessAreaPicker() {
    if (!dom) return;

    const pickerEl = getBusinessPickerEl();
    if (!pickerEl) return;

    const baseEl = dom.businessArea || pickerEl;
    const tag = String(baseEl.tagName || "").toUpperCase();

    const prevSel = normStr(baseEl.value);
    const prevOther = normStr(dom.businessAreaOther && dom.businessAreaOther.value);
    const draftVal = normStr(state.draft && state.draft.businessArea);

    const prevSelIsOther = (lowerKey(prevSel) === lowerKey(BUSINESS_OTHER_LABEL));
    const options = composeBusinessOptionsForUi();
    const q = normStr(state.businessAreaQuery);

    let filtered = filterBusinessOptions(options, q);

    if (tag === "SELECT") {
      filtered = ensureValueInList(filtered, prevSel);
      if (draftVal && isBusinessDefault(draftVal)) filtered = ensureValueInList(filtered, draftVal);
    }

    if ((!filtered || !filtered.length) && normStr(q).length >= 3) filtered = [];

    const listWithOther = filtered.concat([BUSINESS_OTHER_LABEL]);

    if (tag === "SELECT") {
      fillSelectOptionsQuick(baseEl, listWithOther, "Välj verksamhet…");
    } else {
      const dl = ensureBusinessAreaDatalist(pickerEl);
      fillDatalistOptionsQuick(dl, listWithOther);
    }

    if (normStr(q).length > 0 && normStr(q).length < 3) setBusinessHint("Skriv minst 3 bokstäver för att söka.");
    else setBusinessHint("");

    if (tag === "SELECT") {
      let targetSel = "";
      let targetOther = "";

      if (prevSelIsOther) {
        targetSel = BUSINESS_OTHER_LABEL;
        targetOther = prevOther;
      } else if (prevSel) {
        targetSel = prevSel;
      } else if (draftVal) {
        if (isBusinessDefault(draftVal)) {
          targetSel = draftVal;
        } else {
          targetSel = BUSINESS_OTHER_LABEL;
          targetOther = prevOther || draftVal;
        }
      }

      if (targetSel) restoreSelectValueCaseInsensitive(baseEl, targetSel);
      if (dom.businessAreaOther) dom.businessAreaOther.value = normStr(targetOther);
    }

    if (dom.businessAreaOther && dom.show && dom.hide) {
      const selected = normStr(baseEl.value);
      if (lowerKey(selected) === lowerKey(BUSINESS_OTHER_LABEL)) dom.show(dom.businessAreaOther);
      else dom.hide(dom.businessAreaOther);
    }
  }

  function readBusinessAreaFromInputs() {
    if (!dom) return "";

    let baseEl = dom.businessArea || null;
    const pickerEl = getBusinessPickerEl();

    if (baseEl) {
      const tag = String(baseEl.tagName || "").toUpperCase();
      if (tag === "SELECT") {
        const sel = normStr(baseEl.value);
        if (lowerKey(sel) === lowerKey(BUSINESS_OTHER_LABEL)) {
          const other = normStr(dom.businessAreaOther && dom.businessAreaOther.value);
          return other;
        }
        return sel;
      }
    }

    const v = normStr((pickerEl && pickerEl.value) || (baseEl && baseEl.value) || "");
    if (lowerKey(v) === lowerKey(BUSINESS_OTHER_LABEL)) {
      const other = normStr(dom.businessAreaOther && dom.businessAreaOther.value);
      return other;
    }
    return v;
  }

  /* =========================
     BLOCK 7/19 — Basic helpers
  ========================== */
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

  function normalizeLevel(v) {
    const s = normStr(v).toLowerCase();
    if (s === "intro" || s === "inledning" || s === "introduktion") return "intro";
    if (s === "advanced" || s === "avancerad" || s === "avancerat" || s === "svår" || s === "hard") return "advanced";
    return "normal";
  }

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

  /* =========================
     BLOCK 8/19 — P0: Question flatten/normalize (robusthet)
  ========================== */
  function toTextCandidate(v) {
    if (typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (isObj(v)) {
      const c = v.text || v.label || v.value || v.prompt || v.question || v.title || v.heading || v.name;
      if (typeof c === "string") return c;
    }
    return "";
  }

  function normalizeOptionsAny(rawOptions) {
    let arr = null;

    if (Array.isArray(rawOptions)) arr = rawOptions.slice();
    else if (isObj(rawOptions) && Array.isArray(rawOptions.choices)) arr = rawOptions.choices.slice();
    else if (isObj(rawOptions) && Array.isArray(rawOptions.answers)) arr = rawOptions.answers.slice();
    else if (isObj(rawOptions) && Array.isArray(rawOptions.options)) arr = rawOptions.options.slice();

    if (!arr) return [];

    const out = [];
    for (const x of arr) {
      const t = normStr(scrubObjectObjectToken(toTextCandidate(x)));
      if (t) out.push(t);
    }
    return out;
  }

  function flattenChoiceQuestionShapeInPlace(it) {
    if (!it || typeof it !== "object") return it;

    const root = it;
    const data = isObj(it.data) ? it.data : null;

    function tryFlatten(target) {
      if (!target || typeof target !== "object") return false;

      const qObj = target.question;
      if (!qObj || typeof qObj !== "object" || Array.isArray(qObj)) return false;

      const qText = normStr(qObj.text || "");
      const choices = Array.isArray(qObj.choices) ? qObj.choices : null;
      if (!qText || !choices || choices.length < 2) return false;

      const options = choices.map(c => normStr(c && c.text)).filter(Boolean);
      if (options.length < 2) return false;

      const correctChoiceId = normStr(qObj.correctChoiceId || "");
      let correctIndex = -1;
      if (correctChoiceId) {
        for (let i = 0; i < choices.length; i++) {
          if (normStr(choices[i] && choices[i].id) === correctChoiceId) { correctIndex = i; break; }
        }
      }

      root.type = "question";
      root.question = scrubObjectObjectToken(qText);
      root.options = options.map(x => scrubObjectObjectToken(String(x ?? ""))).filter(Boolean);

      if (correctIndex >= 0 && correctIndex < root.options.length) root.correctIndex = correctIndex;

      const rationale = (typeof qObj.rationale === "string") ? qObj.rationale : "";
      if (rationale) root.explanation = scrubObjectObjectToken(rationale);

      return true;
    }

    if (tryFlatten(root)) return it;
    if (data) tryFlatten(data);

    return it;
  }

  function ensureItemType(it) {
    if (!it || typeof it !== "object") return it;

    flattenChoiceQuestionShapeInPlace(it);

    const src = isObj(it.data) ? it.data : it;

    const t = normStr(src.type || it.type).toLowerCase();
    if (t) { it.type = src.type || it.type; return it; }

    if (typeof src.question === "string" && normStr(src.question)) { it.type = "question"; return it; }
    if (isObj(src.question) && typeof src.question.text === "string" && normStr(src.question.text)) { it.type = "question"; return it; }
    if (Array.isArray(src.options) && src.options.length >= 2) { it.type = "question"; return it; }
    if (Array.isArray(src.choices) && src.choices.length >= 2) { it.type = "question"; return it; }
    if (Array.isArray(src.answers) && src.answers.length >= 2) { it.type = "question"; return it; }

    it.type = "info";
    return it;
  }

  function sanitizeAiItemInPlace(item) {
    if (!item || typeof item !== "object") return item;

    flattenChoiceQuestionShapeInPlace(item);

    const src = isObj(item.data) ? item.data : null;

    const keys = ["text", "instruction", "prompt", "question", "explanation", "feedback", "rationale", "reason", "title", "heading"];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (typeof item[k] === "string") item[k] = scrubObjectObjectToken(item[k]);
      if (src && typeof src[k] === "string") src[k] = scrubObjectObjectToken(src[k]);
    }

    try {
      const qObj = item.question;
      if (qObj && typeof qObj === "object" && !Array.isArray(qObj)) {
        if (typeof qObj.text === "string") qObj.text = scrubObjectObjectToken(qObj.text);
        if (typeof qObj.rationale === "string") qObj.rationale = scrubObjectObjectToken(qObj.rationale);
        if (Array.isArray(qObj.choices)) {
          qObj.choices = qObj.choices.map(c => {
            if (c && typeof c === "object") {
              if (typeof c.text === "string") c.text = scrubObjectObjectToken(c.text);
              if (typeof c.label === "string") c.label = scrubObjectObjectToken(c.label);
            }
            return c;
          });
        }
      }

      if (src) {
        const qObj2 = src.question;
        if (qObj2 && typeof qObj2 === "object" && !Array.isArray(qObj2)) {
          if (typeof qObj2.text === "string") qObj2.text = scrubObjectObjectToken(qObj2.text);
          if (typeof qObj2.rationale === "string") qObj2.rationale = scrubObjectObjectToken(qObj2.rationale);
          if (Array.isArray(qObj2.choices)) {
            qObj2.choices = qObj2.choices.map(c => {
              if (c && typeof c === "object") {
                if (typeof c.text === "string") c.text = scrubObjectObjectToken(c.text);
                if (typeof c.label === "string") c.label = scrubObjectObjectToken(c.label);
              }
              return c;
            });
          }
        }
      }
    } catch (_) { }

    if (Array.isArray(item.options)) {
      item.options = item.options.map(x => scrubObjectObjectToken(String(x ?? ""))).filter(Boolean);
    }
    if (src && Array.isArray(src.options)) {
      src.options = src.options.map(x => scrubObjectObjectToken(String(x ?? ""))).filter(Boolean);
    }

    ensureItemType(item);
    return item;
  }

  function getItemPrimaryTextForEditor(it) {
    try {
      if (!it || typeof it !== "object") return "";
      if (isObj(it.question)) {
        const qObj = it.question;
        const t = (typeof qObj.text === "string" && qObj.text) ? qObj.text : "";
        if (t) return scrubObjectObjectToken(String(t || ""));
      }
      const cand =
        (typeof it.text === "string" && it.text) ? it.text :
          (typeof it.instruction === "string" && it.instruction) ? it.instruction :
            (typeof it.prompt === "string" && it.prompt) ? it.prompt :
              (typeof it.question === "string" && it.question) ? it.question : "";
      return scrubObjectObjectToken(String(cand || ""));
    } catch (_) {
      return "";
    }
  }

  /* =========================
     BLOCK 9/19 — Auth/role + dirty/lock
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
          return { role, empNo: "", canWrite: role === "ADMIN" || role === "MANAGER" };
        }
        if (r && typeof r === "object") {
          const role = upper(r.roleId || r.role || "SYSTEM_ADMIN");
          const empNo = String(r.empNo || r.emp || r.employeeNo || "");
          const hasCanWrite = Object.prototype.hasOwnProperty.call(r, "canWrite");
          const canWrite = hasCanWrite ? !!r.canWrite : (role === "ADMIN" || role === "MANAGER");
          return { role, empNo, canWrite };
        }
      }
    } catch (_) { }

    return { role: "SYSTEM_ADMIN", empNo: "", canWrite: false };
  }

  function isWriterAllowed() {
    const who = getWhoFresh();
    state.who = who;

    if (state.locked) return false;
    const role = upper(who.role || "SYSTEM_ADMIN");
    if (role !== "ADMIN" && role !== "MANAGER") return false;
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
     BLOCK 10/19 — Draft sync
  ========================== */
  function syncDraftFromInputs() {
    if (!state.draft) return;

    if (dom && dom.mod) state.draft.module = normStr(dom.mod.value);
    if (dom && dom.area) state.draft.area = normStr(dom.area.value);

    if (dom && dom.courseTitle) state.draft.courseTitle = normStr(dom.courseTitle.value) || "Introduktion";
    if (dom && dom.courseStep) state.draft.courseStep = parseCourseStep(dom.courseStep.value);

    if (dom && dom.goalsLevel) state.draft.goalsLevel = normStr(dom.goalsLevel.value) || "normal";
    if (dom && dom.goals) state.draft.goals = normStr(dom.goals.value);

    state.draft.businessArea = readBusinessAreaFromInputs();
  }

  /* =========================
     BLOCK 11/19 — Debug render (XSS-safe)
  ========================== */
  function updateDebug() {
    try {
      if (!dom || !dom.debugPre || !dom.setText) return;
      const payload = {
        version: page.__VERSION,
        documentOnly: !!DOCUMENT_ONLY,
        locked: !!state.locked,
        lockReason: state.lockReason || "",
        selectedId: state.selectedId || "",
        aiAnchorLine: state.aiAnchorLine || "",
        courseTrack: readCourseTrackFromUi(),
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
     BLOCK 12/19 — Worker SDK init (NO STORAGE)
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
     BLOCK 13/19 — Catalog loader (ai-rules/v1/modules.json)
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
     BLOCK 14/19 — Datalists + pickers
  ========================== */
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

    if (dom.titleDisplay && dom.setText) dom.setText(dom.titleDisplay, state.draft.title);
  }

  /* =========================
     BLOCK 15/19 — AO: AI Anchor (read-only + request)
  ========================== */
  function snapshotEditorStateForAi() {
    const module = normStr(dom && dom.mod && dom.mod.value);
    const area = normStr(dom && dom.area && dom.area.value);
    const courseTitle = normStr(dom && dom.courseTitle && dom.courseTitle.value) || "Introduktion";
    const courseStep = parseCourseStep(dom && dom.courseStep && dom.courseStep.value);
    const goalsLevel = normStr(dom && dom.goalsLevel && dom.goalsLevel.value) || "normal";
    const businessArea = normStr(readBusinessAreaFromInputs());
    const track = readCourseTrackFromUi();

    return { module, area, businessArea, courseTitle, courseStep, goalsLevel, goals: "", track };
  }

  function buildAiAnchorLine() {
    const s = snapshotEditorStateForAi();
    const level = normalizeLevel(s.goalsLevel);
    const tLabel = courseTrackLabel(s.track);

    const parts = [
      "Modul: " + (s.module || "—"),
      "Område: " + (s.area || "—"),
      "Kapitel: " + (s.courseTitle || "—"),
      "Steg: " + (s.courseStep || "—"),
      "Nivå: " + (level || "normal"),
      "Verksamhet: " + (s.businessArea || "—"),
      "Kurs-spår: " + (tLabel || "Grund")
    ];
    const line = parts.join(" • ");
    return scrubObjectObjectToken(line);
  }

  function renderAiAnchorRow() {
    const line = buildAiAnchorLine();
    state.aiAnchorLine = line;
    if (dom && dom.aiAnchorText && dom.setText) dom.setText(dom.aiAnchorText, line);
  }

  function buildAiContextNoGoals() {
    const s = snapshotEditorStateForAi();
    const level = normalizeLevel(s.goalsLevel);
    const subjectTitle = normStr(s.area) || normStr(s.module) || "";
    const anchorLine = buildAiAnchorLine();

    const track = normalizeCourseTrack(s.track);
    const trackLabel = courseTrackLabel(track);

    // PATCH (P0): make "document-only" explicit inside context too (NO STORAGE).
    // Worker may ignore, but harmless.
    const docDirective = "OUTPUT: Dokumenttext/utbildningsblock. INGA quiz/frågor. INGA facitfält.";

    if (DEPS.core && typeof DEPS.core.buildAiContext === "function") {
      const ctx = DEPS.core.buildAiContext(s) || {};
      try {
        ctx.goals = "";
        ctx.level = level;

        ctx.anchor = anchorLine;

        if (!ctx.course || typeof ctx.course !== "object") ctx.course = {};
        ctx.course.track = track;
        ctx.course.trackLabel = trackLabel;

        if (s.businessArea) ctx.business = s.businessArea;

        if (!ctx.subject || typeof ctx.subject !== "object") ctx.subject = {};
        if (!ctx.subject.title && subjectTitle) ctx.subject.title = subjectTitle;

        if (s.businessArea) ctx.subject.businessArea = s.businessArea;
        ctx.subject.anchor = anchorLine;

        // directive (NO STORAGE)
        ctx.directive = docDirective;
      } catch (_) { }
      return ctx;
    }

    return {
      anchor: anchorLine,
      business: s.businessArea || "",
      directive: docDirective,
      subject: { module: s.module, area: s.area, title: subjectTitle, businessArea: s.businessArea || "", anchor: anchorLine },
      course: {
        chapter: s.courseTitle,
        step: s.courseStep,
        track: track,
        trackLabel: trackLabel,
        title: (DEPS.core && DEPS.core.composeTitle)
          ? DEPS.core.composeTitle(s.courseTitle, s.courseStep, s.area || "—")
          : (s.courseTitle + " • Steg " + s.courseStep + " • " + (s.area || "—"))
      },
      level: level,
      goals: ""
    };
  }

  /* =========================
     BLOCK 16/19 — Rendering glue + list/filter + pills
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
        const blob = (
          normStr(t.title) + " " +
          normStr(t.module) + " " +
          normStr(t.area) + " " +
          normStr(t.businessArea)
        ).toLowerCase();
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

  function updateAiControlsVisibility() {
    // Document-only => hide question controls always
    if (dom && dom.questionControls && dom.show && dom.hide) {
      dom.hide(dom.questionControls);
    } else if (DEPS.render && typeof DEPS.render.toggleQuestionControls === "function") {
      DEPS.render.toggleQuestionControls(false);
    }

    // P0 UI: show document-only state in dropdown
    enforceAiContentUiDocumentOnly();
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

  function fillEditorFromDraft() {
    const d = state.draft;
    if (!d || !dom) return;

    // Ensure Verksamhet-search exists if UI is SELECT-only (no storage)
    ensureBusinessAreaSearchForSelectUi();

    if (dom.mod) dom.mod.value = normStr(d.module);
    renderAreaDatalist();
    if (dom.area) dom.area.value = normStr(d.area);

    renderChapterAndStepPickers();
    if (dom.courseTitle) dom.courseTitle.value = normStr(d.courseTitle) || "Introduktion";
    if (dom.courseStep) dom.courseStep.value = normStr(d.courseStep) || "1";

    if (dom.goalsLevel) dom.goalsLevel.value = normStr(d.goalsLevel) || "normal";
    if (dom.goals) dom.goals.value = normStr(d.goals) || "";

    if (dom.businessArea || dom.businessAreaSearch) {
      renderBusinessAreaPicker();

      const v = normStr(d.businessArea);
      const pickerEl = getBusinessPickerEl() || dom.businessArea;

      if (pickerEl && v) {
        const tag = String((dom.businessArea && dom.businessArea.tagName) || "").toUpperCase();
        const inputMode = (!tag || tag !== "SELECT");

        if (inputMode) {
          pickerEl.value = v;
          if (dom.businessAreaOther) dom.businessAreaOther.value = "";
        } else {
          if (isBusinessDefault(v)) {
            dom.businessArea.value = v;
            if (dom.businessAreaOther) dom.businessAreaOther.value = "";
          } else {
            dom.businessArea.value = BUSINESS_OTHER_LABEL;
            if (dom.businessAreaOther) dom.businessAreaOther.value = v;
            else dom.businessArea.value = v;
          }
        }
      }

      renderBusinessAreaPicker();
    }

    syncDraftTitleFromFields();
    renderAiAnchorRow();

    const blocks = currentBlocks();
    DEPS.render && DEPS.render.renderBlocksList && DEPS.render.renderBlocksList({
      blocks,
      onEdit: function (idx) { openBlockEditor(idx); },
      onDelete: function (idx) { deleteBlock(idx); },
      onOpenItem: function (bIdx, iIdx) { openItemModal(bIdx, iIdx); }
    });

    // Ensure dropdown reflects doc-only even after render
    enforceAiContentUiDocumentOnly();
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
     BLOCK 17/19 — Item modal + block editor
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

  function openBlockEditor(idx) {
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
          else if (isObj(it0.question) && typeof it0.question.text === "string") it0.question.text = txt;
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
     BLOCK 18/19 — AI + normalize/import + fail-closed (DOC-ONLY)
  ========================== */
  function setAiHint(text) {
    if (DEPS.render && typeof DEPS.render.setAiHint === "function") { DEPS.render.setAiHint(text || ""); return; }
    if (dom && dom.aiHint && dom.setText) dom.setText(dom.aiHint, String(text || ""));
  }

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

  function readAiControls() {
    // DOC-ONLY: force mode=document always
    const countRaw = normStr(dom && dom.aiCount && dom.aiCount.value) || "3";
    const count = Math.max(1, Math.min(12, Number(countRaw) || 3));

    // Ensure dropdown reflects this policy
    enforceAiContentUiDocumentOnly();

    return {
      content: "blocks",
      mode: "document",
      count: count,
      questionType: "none",
      feedbackEnabled: false,
      _uiQuestionType: ""
    };
  }

  function normalizeAiBlocksFromAny(raw) {
    function hasBlocksOrItems(obj) {
      if (!obj) return false;
      if (Array.isArray(obj)) return true;
      if (Array.isArray(obj.blocks)) return true;
      if (Array.isArray(obj.trainingBlocks)) return true;
      if (Array.isArray(obj.items)) return true;
      if (Array.isArray(obj.questions)) return true;
      return false;
    }

    function pickBestSource(r) {
      if (!r) return null;
      const d = (r && r.data) ? r.data : null;
      if (hasBlocksOrItems(d)) return d;
      if (hasBlocksOrItems(r)) return r;
      return d || r;
    }

    const pick = pickBestSource(raw);
    if (!pick) return { ok: false, reason: "AI-svar saknar data." };

    const blocksCand = pick.blocks || pick.trainingBlocks || null;
    const itemsCand = Array.isArray(pick.items) ? pick.items
      : Array.isArray(pick.questions) ? pick.questions
        : null;

    if (Array.isArray(blocksCand)) {
      const hasInlineItems = blocksCand.some(b => b && Array.isArray(b.items) && b.items.length);

      if (!hasInlineItems && itemsCand && itemsCand.length) {
        const out = [];

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

        const firstTitle = normStr(blocksCand[0] && (blocksCand[0].title || blocksCand[0].heading || blocksCand[0].name)) || "";
        return { ok: true, blocks: [{ title: firstTitle, items: itemsCand.slice() }] };
      }

      const out2 = [];
      for (const b of blocksCand) {
        const title = normStr(b && (b.title || b.heading || b.name)) || "";
        const inline = (b && Array.isArray(b.items)) ? b.items.slice() : [];

        if (inline.length) {
          out2.push({ title, items: inline });
          continue;
        }

        if (b && typeof b === "object") {
          const q = normStr(b.question || b.q || b.text || b.instruction || b.prompt || "");
          const opts = Array.isArray(b.options) ? b.options.slice() : null;
          const hasAnyAnswerShape =
            (opts && opts.length >= 2) ||
            (typeof b.correct === "boolean") ||
            (b.correctIndex != null) ||
            (Array.isArray(b.correctIndices) && b.correctIndices.length) ||
            (b.answer != null) ||
            (b.expected != null) ||
            (b.range != null);

          if (q && hasAnyAnswerShape) {
            const item = {};
            item.question = q;
            if (opts) item.options = opts;
            if (b.correctIndex != null) item.correctIndex = b.correctIndex;
            if (Array.isArray(b.correctIndices)) item.correctIndices = b.correctIndices.slice();
            if (typeof b.correct === "boolean") item.correct = b.correct;
            if (typeof b.answer === "string" || typeof b.answer === "number") item.answer = b.answer;
            if (typeof b.expected === "string") item.expected = b.expected;
            if (isObj(b.range)) item.range = deepClone(b.range);
            if (typeof b.explanation === "string") item.explanation = b.explanation;
            if (typeof b.feedback === "string") item.feedback = b.feedback;

            item.type = "question";
            out2.push({ title, items: [item] });
            continue;
          }
        }
      }

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

  async function generateAi() {
    if (!isWriterAllowed()) return;
    if (!state.draft) return;

    syncDraftFromInputs();
    syncDraftTitleFromFields();
    renderAiAnchorRow();

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

    // DOC-ONLY: force mode=document + explicit "no-questions" hints
    const req = {
      mode: "document",
      count: controls.count,
      context: ctxObj,
      anchor: (state.aiAnchorLine || ctxObj.anchor || ""),
      language: "sv",

      // Extra hints (NO STORAGE) — harmless if worker ignores
      content: "document",
      questionType: "none",
      feedbackEnabled: false,
      documentOnly: true
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

    const norm = normalizeAiBlocksFromAny(r);
    page._LAST_AI_NORM = deepClone(norm);

    if (!norm.ok) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI-format fel", "bad");
      setAiHint(norm.reason || "AI gav ogiltigt format.");
      updateDebug();
      return;
    }

    const incomingBlocks = [];
    let droppedQuestions = 0;

    for (const b of safeArr(norm.blocks)) {
      const itemsRaw = safeArr(b && b.items);
      const items = [];

      for (const x of itemsRaw) {
        if (typeof x === "string") {
          const t = scrubObjectObjectToken(x);
          items.push({ type: "info", text: t });
          continue;
        }

        if (x && typeof x === "object") {
          const obj = sanitizeAiItemInPlace(deepClone(x)) || {};
          flattenChoiceQuestionShapeInPlace(obj);
          ensureItemType(obj);

          const t = normStr(obj.type).toLowerCase();

          // PATCH (P0): DOC-ONLY should not kill the whole import immediately.
          // Skip questions, import the rest. If all are questions -> fail-closed.
          if (DOCUMENT_ONLY && t === "question") {
            droppedQuestions++;
            continue;
          }

          if (DEPS.contract && typeof DEPS.contract.normalizeItem === "function") {
            items.push(DEPS.contract.normalizeItem(obj));
          } else {
            items.push(obj);
          }
          continue;
        }
      }

      const clean = items.filter(x => x != null);
      if (!clean.length) continue;

      incomingBlocks.push({
        title: normStr(b && b.title) || "",
        items: clean
      });
    }

    if (!incomingBlocks.length) {
      DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Import stoppad", "bad");
      setAiHint("Document-only: AI gav bara fråga/quiz-format (0 dokumentblock). Import stoppad (fail-closed).");
      updateDebug();
      return;
    }

    page._LAST_AI_PICK = {
      importedBlocks: incomingBlocks.length,
      importedItems: incomingBlocks.reduce((n, b) => n + (b.items ? b.items.length : 0), 0),
      droppedQuestions: droppedQuestions,
      anchor: state.aiAnchorLine || "",
      courseTrack: readCourseTrackFromUi(),
      documentOnly: !!DOCUMENT_ONLY
    };

    if (!Array.isArray(state.draft.blocks)) state.draft.blocks = currentBlocks().slice();
    for (const nb of incomingBlocks) state.draft.blocks.push(nb);

    setDirty(true);
    syncDraftTitleFromFields();
    DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: AI import OK", "ok");

    if (droppedQuestions > 0) {
      setAiHint(`Importerade ${page._LAST_AI_PICK.importedBlocks} block (${page._LAST_AI_PICK.importedItems} items). Skippade ${droppedQuestions} fråge-items (document-only).`);
    } else {
      setAiHint(`Importerade ${page._LAST_AI_PICK.importedBlocks} block (${page._LAST_AI_PICK.importedItems} items).`);
    }

    updateUiAll();
  }

  /* =========================
     BLOCK 19/19 — Bootstrap + events + CRUD
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

    // Ensure Verksamhet-search exists if UI is SELECT-only (no storage)
    ensureBusinessAreaSearchForSelectUi();

    state.businessAreaQuery = "";
    if (dom && dom.businessAreaSearch) dom.businessAreaSearch.value = "";

    state.selectedId = normStr(id);
    state.draft = deepClone(state.trainings[idx]);
    setDirty(false);
    renderAreaDatalist();

    renderBusinessAreaPicker();
    renderAiAnchorRow();
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
      businessArea: "",
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

    // Ensure Verksamhet-search exists if UI is SELECT-only (no storage)
    ensureBusinessAreaSearchForSelectUi();

    state.businessAreaQuery = "";
    if (dom && dom.businessAreaSearch) dom.businessAreaSearch.value = "";

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
    renderBusinessAreaPicker();
    renderAiAnchorRow();
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

    // Ensure Verksamhet-search exists if UI is SELECT-only (no storage)
    ensureBusinessAreaSearchForSelectUi();

    state.draft = deepClone(state.trainings[idx]);
    setDirty(false);
    renderBusinessAreaPicker();
    renderAiAnchorRow();
    updateUiAll();
  }

  function writeBackDraft(status) {
    if (!isWriterAllowed()) return;
    if (!state.draft) return;

    syncDraftFromInputs();
    syncDraftTitleFromFields();
    renderAiAnchorRow();

    state.draft.status = (status === "published") ? "published" : "draft";

    try {
      const pickerEl = getBusinessPickerEl() || (dom && dom.businessArea);
      const sel = normStr(pickerEl && pickerEl.value);

      if (lowerKey(sel) === lowerKey(BUSINESS_OTHER_LABEL)) {
        const other = normStr(dom && dom.businessAreaOther && dom.businessAreaOther.value);
        if (other.length < 2) {
          DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Kan inte spara", "bad");
          DEPS.render && DEPS.render.setAiHint && DEPS.render.setAiHint("Verksamhet: Du valde Annat… men texten är tom eller för kort (minst 2 tecken).");
          return;
        }
        state.draft.businessArea = other;
      }

      const ba = normStr(state.draft.businessArea);
      if (ba && ba.length > 80) {
        DEPS.render && DEPS.render.setStatePill && DEPS.render.setStatePill("Status: Kan inte spara", "bad");
        DEPS.render && DEPS.render.setAiHint && DEPS.render.setAiHint("Verksamhet: För lång text (max 80 tecken).");
        return;
      }
    } catch (_) { }

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
    renderBusinessAreaPicker();
    renderAiAnchorRow();
    updateUiAll();
  }

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

      state.businessAreaQuery = "";
      if (dom.businessAreaSearch) dom.businessAreaSearch.value = "";
      renderBusinessAreaPicker();

      state.showAll = false;
      refreshList();
      updateButtons();
      renderAiAnchorRow();
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
      renderAiAnchorRow();
      setDirty(true);
      updateButtons();
      updateDebug();
    });

    // DOC-ONLY: enforce UI state if user tries to change
    dom.on(dom.aiContent, "change", function () {
      enforceAiContentUiDocumentOnly();
      setAiHint("Dokumentläge är låst på denna sida (spel/frågor senare).");
      updateAiControlsVisibility();
      updateDebug();
    });

    const onEditorChange = function (e) {
      if (!state.draft) return;

      const tid = (e && e.target && e.target.id) ? String(e.target.id) : "";
      if (tid === "courseTrack") {
        renderAiAnchorRow();
        updateButtons();
        updateDebug();
        return;
      }

      syncDraftFromInputs();
      renderAreaDatalist();
      syncDraftTitleFromFields();
      renderAiAnchorRow();

      setDirty(true);
      updateButtons();
      updateDebug();
    };

    dom.on(dom.mod, "input", onEditorChange);
    dom.on(dom.area, "input", onEditorChange);
    dom.on(dom.courseTitle, "change", onEditorChange);
    dom.on(dom.courseStep, "change", onEditorChange);

    dom.on(dom.courseTrack, "change", onEditorChange);
    dom.on(dom.courseTrack, "input", onEditorChange);

    dom.on(dom.goalsLevel, "change", function () {
      if (state.draft) {
        syncDraftFromInputs();
        renderAiAnchorRow();
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

    dom.on(dom.businessAreaSearch, "input", function () {
      state.businessAreaQuery = normStr(dom.businessAreaSearch && dom.businessAreaSearch.value);
      renderBusinessAreaPicker();
      if (state.draft) {
        syncDraftFromInputs();
        setDirty(true);
        updateButtons();
      }
      renderAiAnchorRow();
      updateDebug();
    });

    dom.on(dom.businessArea, "change", function () {
      if (state.draft) {
        syncDraftFromInputs();
        renderBusinessAreaPicker();
        renderAiAnchorRow();
        setDirty(true);
        updateButtons();
        updateDebug();
      }
    });
    dom.on(dom.businessArea, "input", function () {
      if (state.draft) {
        syncDraftFromInputs();
        renderAiAnchorRow();
        setDirty(true);
        updateButtons();
        updateDebug();
      }
    });
    dom.on(dom.businessAreaOther, "input", function () {
      if (state.draft) {
        syncDraftFromInputs();
        renderAiAnchorRow();
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

    // Ensure Verksamhet-search exists if UI is SELECT-only (no storage)
    ensureBusinessAreaSearchForSelectUi();

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
    renderBusinessAreaPicker();
    state.showAll = false;

    wireEventsOnce();
    renderAiAnchorRow();

    // Ensure doc-only UI from first paint
    enforceAiContentUiDocumentOnly();

    updateUiAll();
    setTimeout(updateUiAll, 0);
    setTimeout(updateUiAll, 50);
    setTimeout(updateUiAll, 300);

    (async function () { try { await ensureSdkReady(); } catch (_) { } })();

    (async function () {
      try {
        const r = await loadCatalogOnce();
        if (r && r.ok) {
          renderModuleDatalist();
          renderAreaDatalist();
          renderChapterAndStepPickers();

          syncDraftFromInputs();
          renderAiAnchorRow();
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

  try { tryBoot(); } catch (_) { setLock("BOOT: exception (fail-closed)."); updateUiAll(); }
})();
