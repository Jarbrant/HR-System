/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-03) | FILE 01/06 | FIL-ID: UI/pages/trainings/01-dom.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: DOM-bindningar + små DOM-helpers för trainings-sidan.

POLICY (LÅST):
- UI-only • Inga storage-keys
- XSS-safe rendering: setText använder textContent (ingen innerHTML)
- Fail-closed: om kritiska DOM-noder saknas exponeras dom.missing[] (page avgör lock)

============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  const dom = (NS.dom = NS.dom || {});
  dom.__VERSION = "v1.0-PP-SC-010-03";

  // -----------------------------
  // Helpers
  // -----------------------------
  function byId(id) {
    return document.getElementById(id);
  }

  function setText(el, txt) {
    if (!el) return;
    el.textContent = String(txt ?? "");
  }

  function disable(el, on) {
    if (!el) return;
    const v = !!on;
    el.disabled = v;
    // UI-konvention: "btn disabled"
    if (v) el.classList.add("disabled");
    else el.classList.remove("disabled");
  }

  function on(el, evt, fn, opts) {
    if (!el || !evt || !fn) return;
    el.addEventListener(evt, fn, opts || false);
  }

  function show(el) {
    if (!el) return;
    el.hidden = false;
    el.style.display = "";
    el.classList.remove("hidden");
  }

  function hide(el) {
    if (!el) return;
    el.hidden = true;
    el.style.display = "none";
    el.classList.add("hidden");
  }

  // Exponera helpers (används av 06-page + 05-render)
  dom.byId = byId;
  dom.setText = setText;
  dom.disable = disable;
  dom.on = on;
  dom.show = show;
  dom.hide = hide;

  // -----------------------------
  // Bind DOM (IDs måste matcha trainings.html)
  // -----------------------------
  // Left/list controls
  dom.q = byId("q");
  dom.fStatus = byId("fStatus");
  dom.onlyProblems = byId("onlyProblems");

  dom.btnShowAll = byId("btnShowAll");
  dom.btnClear = byId("btnClear");

  dom.btnNew = byId("btnNew");
  dom.btnDelete = byId("btnDelete");
  dom.btnPurge = byId("btnPurge");

  // Editor: module/area/course
  dom.mod = byId("mod");
  dom.area = byId("area");
  dom.modList = byId("modList");
  dom.areaList = byId("areaList");

  dom.btnModAll = byId("btnModAll");
  dom.btnModClear = byId("btnModClear");

  dom.courseTitle = byId("courseTitle");
  dom.courseStep = byId("courseStep");

  dom.titleDisplay = byId("titleDisplay");
  dom.subjectIdText = byId("subjectIdText");

  // Goals
  dom.goalsLevel = byId("goalsLevel");
  dom.goals = byId("goals");

  // Footer/buttons
  dom.revertHint = byId("revertHint");
  dom.btnRevert = byId("btnRevert");
  dom.btnSaveDraft = byId("btnSaveDraft");
  dom.btnSavePublish = byId("btnSavePublish");

  // AI
  dom.aiContent = byId("aiContent");
  dom.aiCount = byId("aiCount");
  dom.btnTestAI = byId("btnTestAI");
  dom.btnGenAI = byId("btnGenAI");

  dom.questionControls = byId("questionControls");
  dom.aiQuestionType = byId("aiQuestionType");
  dom.aiFeedbackEnabled = byId("aiFeedbackEnabled");

  // Topbar
  dom.btnLogout = byId("btnLogout");

  // -----------------------------
  // Missing map (för tydlig fail-closed)
  // -----------------------------
  const required = [
    ["q", dom.q],
    ["fStatus", dom.fStatus],
    ["onlyProblems", dom.onlyProblems],
    ["btnShowAll", dom.btnShowAll],
    ["btnClear", dom.btnClear],
    ["btnNew", dom.btnNew],
    ["btnDelete", dom.btnDelete],
    ["btnPurge", dom.btnPurge],

    ["mod", dom.mod],
    ["area", dom.area],
    ["modList", dom.modList],
    ["areaList", dom.areaList],
    ["btnModAll", dom.btnModAll],
    ["btnModClear", dom.btnModClear],

    ["courseTitle", dom.courseTitle],
    ["courseStep", dom.courseStep],
    ["titleDisplay", dom.titleDisplay],
    ["subjectIdText", dom.subjectIdText],

    ["goalsLevel", dom.goalsLevel],
    ["goals", dom.goals],

    ["revertHint", dom.revertHint],
    ["btnRevert", dom.btnRevert],
    ["btnSaveDraft", dom.btnSaveDraft],
    ["btnSavePublish", dom.btnSavePublish],

    ["aiContent", dom.aiContent],
    ["aiCount", dom.aiCount],
    ["btnTestAI", dom.btnTestAI],
    ["btnGenAI", dom.btnGenAI],
    ["questionControls", dom.questionControls],
    ["aiQuestionType", dom.aiQuestionType],
    ["aiFeedbackEnabled", dom.aiFeedbackEnabled],

    ["btnLogout", dom.btnLogout],
  ];

  dom.missing = required.filter((x) => !x[1]).map((x) => x[0]);
})();
