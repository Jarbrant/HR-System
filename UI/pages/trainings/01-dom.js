/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-01) | FILE 01/06 | FIL-ID: UI/pages/trainings/01-dom.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Stabil DOM-bindning + säkra DOM-helpers (textContent, inga innerHTML).
      Denna fil ska ENBART:
      - hitta element via id (trainings.html)
      - erbjuda små helpers: setText/disable/show/hide/on/clear
      - rapportera missing-id (utan att krascha)

POLICY (LÅST):
- UI-only • Fail-closed
- Ingen storage här
- Ingen affärslogik här
- XSS-safe rendering: textContent, inga osäkra innerHTML
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.dom && NS.dom.__VERSION) return;

  const dom = (NS.dom = NS.dom || {});
  dom.__VERSION = "v1.0.1-PP-SC-010-01";

  // ------------------------------------------------------------
  // Core getters
  // ------------------------------------------------------------
  function byId(id) {
    const key = String(id || "");
    if (!key) return null;
    return document.getElementById(key);
  }

  // ------------------------------------------------------------
  // Safe helpers (XSS-safe: textContent only)
  // ------------------------------------------------------------
  dom.setText = function (el, txt) {
    if (!el) return;
    el.textContent = String(txt ?? "");
  };

  dom.disable = function (el, disabled) {
    if (!el) return;
    const d = !!disabled;
    el.disabled = d;
    try {
      if (el.classList) el.classList.toggle("disabled", d);
      if (d) el.setAttribute("aria-disabled", "true");
      else el.removeAttribute("aria-disabled");
    } catch (_) {}
  };

  dom.show = function (el) {
    if (!el) return;
    el.style.display = "";
    try { el.removeAttribute("aria-hidden"); } catch (_) {}
  };

  dom.hide = function (el) {
    if (!el) return;
    el.style.display = "none";
    try { el.setAttribute("aria-hidden", "true"); } catch (_) {}
  };

  dom.on = function (el, ev, fn, opts) {
    if (!el || !ev || !fn) return;
    el.addEventListener(ev, fn, opts || false);
  };

  dom.clear = function (el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  };

  dom.make = function (tag, className) {
    const t = String(tag || "div");
    const el = document.createElement(t);
    if (className) el.className = String(className);
    return el;
  };

  dom.safeFocus = function (el) {
    try { el && el.focus && el.focus(); } catch (_) {}
  };

  // ------------------------------------------------------------
  // Bind elements (MÅSTE matcha admin/trainings.html)
  // ------------------------------------------------------------
  // Topbar / pills
  dom.contextPill = byId("contextPill");
  dom.contextText = byId("contextText");
  dom.statePill = byId("statePill");
  dom.stateText = byId("stateText");
  dom.whoPill = byId("whoPill");
  dom.whoText = byId("whoText");

  // Left / list
  dom.q = byId("q");
  dom.fStatus = byId("fStatus");
  dom.onlyProblems = byId("onlyProblems");
  dom.btnShowAll = byId("btnShowAll");
  dom.btnClear = byId("btnClear");

  dom.leftHint = byId("leftHint");
  dom.list = byId("list");

  dom.btnDelete = byId("btnDelete");
  dom.btnPurge = byId("btnPurge");
  dom.btnNew = byId("btnNew");

  // Editor fields
  dom.btnModAll = byId("btnModAll");
  dom.btnModClear = byId("btnModClear");

  dom.subjectIdText = byId("subjectIdText");
  dom.subjectCallout = byId("subjectCallout");

  dom.mod = byId("mod");
  dom.area = byId("area");
  dom.modList = byId("modList");
  dom.areaList = byId("areaList");

  dom.courseTitle = byId("courseTitle");
  dom.courseStep = byId("courseStep");
  dom.titleDisplay = byId("titleDisplay");
  dom.courseTouchHint = byId("courseTouchHint");

  dom.goalsLevel = byId("goalsLevel");
  dom.goals = byId("goals");

  // ------------------------------------------------------------
  // Verksamhet (Business Area) — UI-hooks (måste finnas i trainings.html)
  // ------------------------------------------------------------
  dom.businessArea = byId("businessArea");
  dom.businessAreaSearch = byId("businessAreaSearch");
  dom.businessAreaOther = byId("businessAreaOther");
  dom.businessAreaHint = byId("businessAreaHint");

  // ------------------------------------------------------------
  // AI Anchor (read-only) — UI-hook
  // ------------------------------------------------------------
  dom.aiAnchorText = byId("aiAnchorText");

  // AI controls
  dom.aiContent = byId("aiContent");
  dom.aiCount = byId("aiCount");
  dom.questionControls = byId("questionControls");
  dom.aiQuestionType = byId("aiQuestionType");
  dom.aiFeedbackEnabled = byId("aiFeedbackEnabled");
  dom.aiHint = byId("aiHint");

  // Blocks
  dom.blocksList = byId("blocksList");

  // Footer buttons
  dom.btnRevert = byId("btnRevert");
  dom.revertHint = byId("revertHint");

  dom.btnTestAI = byId("btnTestAI");
  dom.btnGenAI = byId("btnGenAI");

  dom.btnSaveDraft = byId("btnSaveDraft");
  dom.btnSavePublish = byId("btnSavePublish");

  // Session / logout
  dom.btnLogout = byId("btnLogout");

  // Debug
  dom.debugBox = byId("debugBox");
  dom.debugPre = byId("debugPre");

  // ------------------------------------------------------------
  // Fail-closed diagnostics (utan att krascha)
  // ------------------------------------------------------------
  const REQUIRED_IDS = [
    // Topbar
    "contextPill","contextText","statePill","stateText","whoPill","whoText",
    // Left
    "q","fStatus","onlyProblems","btnShowAll","btnClear","leftHint","list","btnDelete","btnPurge","btnNew",
    // Editor
    "btnModAll","btnModClear","subjectIdText","mod","area","modList","areaList",
    "courseTitle","courseStep","titleDisplay","goalsLevel","goals",
    // Verksamhet
    "businessArea","businessAreaSearch","businessAreaOther","businessAreaHint",
    // AI Anchor + AI
    "aiAnchorText","aiContent","aiCount","questionControls","aiQuestionType","aiFeedbackEnabled","aiHint",
    // Blocks
    "blocksList",
    // Footer
    "btnRevert","revertHint","btnTestAI","btnGenAI","btnSaveDraft","btnSavePublish",
    // Logout
    "btnLogout",
    // Debug
    "debugBox","debugPre"
  ];

  dom.missing = [];
  for (let i = 0; i < REQUIRED_IDS.length; i++) {
    const id = REQUIRED_IDS[i];
    if (!byId(id)) dom.missing.push(id);
  }

  dom.isReady = function () {
    return dom.missing.length === 0;
  };

  dom.getMissing = function () {
    return dom.missing.slice();
  };
})();
