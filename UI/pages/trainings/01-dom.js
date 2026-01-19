/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-02) | FILE 01/06 | FIL-ID: UI/pages/trainings/01-dom.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Stabil DOM-karta + små helpers för trainings (ingen state/store/render här)

POLICY (LÅST):
- UI-only • Fail-closed
- XSS-safe: render i andra filer ska använda textContent (inte här)
- Ingen storage här
- Behåll stabila DOM-id/hooks (matchar admin/trainings.html)

NOTE:
- Denna fil ska bara samla element och erbjuda minimala DOM-helpers.
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  const dom = (NS.dom = NS.dom || {});

  const $ = (id) => document.getElementById(id);

  // --- Root guards (fail-closed-ish för DOM) ---
  function required(id) {
    const el = $(id);
    if (!el) {
      // Fail-closed: vi kastar så att 06-page kan stoppa init och visa statusfel.
      throw new Error("DOM_MISSING:" + id);
    }
    return el;
  }

  // --- Topbar / status ---
  dom.contextPill = required("contextPill");
  dom.contextText = required("contextText");
  dom.statePill = required("statePill");
  dom.stateText = required("stateText");
  dom.whoPill = required("whoPill");
  dom.whoText = required("whoText");
  dom.btnLogout = required("btnLogout");

  // --- Left list / search ---
  dom.q = required("q");
  dom.fStatus = required("fStatus");
  dom.btnShowAll = required("btnShowAll");
  dom.btnClear = required("btnClear");
  dom.onlyProblems = required("onlyProblems");
  dom.leftHint = required("leftHint");
  dom.btnDelete = required("btnDelete");
  dom.btnPurge = required("btnPurge");
  dom.btnNew = required("btnNew");
  dom.list = required("list");

  // --- Editor: module/area ---
  dom.btnModAll = required("btnModAll");
  dom.btnModClear = required("btnModClear");
  dom.subjectCallout = required("subjectCallout");
  dom.subjectIdText = required("subjectIdText");
  dom.mod = required("mod");
  dom.area = required("area");
  dom.modList = required("modList");
  dom.areaList = required("areaList");

  // --- Course plan: chapter/step + generated title ---
  dom.courseTitle = required("courseTitle");
  dom.courseStep = required("courseStep");
  dom.titleDisplay = required("titleDisplay");
  dom.courseTouchHint = required("courseTouchHint");

  // --- Goals ---
  dom.goalsLevel = required("goalsLevel");
  dom.goals = required("goals");

  // --- AI controls ---
  dom.aiContent = required("aiContent");
  dom.aiCount = required("aiCount");
  dom.questionControls = required("questionControls");
  dom.aiQuestionType = required("aiQuestionType");
  dom.aiFeedbackEnabled = required("aiFeedbackEnabled");
  dom.aiHint = required("aiHint");

  // --- Blocks list container ---
  dom.blocksList = required("blocksList");

  // --- Footer actions ---
  dom.btnRevert = required("btnRevert");
  dom.btnTestAI = required("btnTestAI");
  dom.btnGenAI = required("btnGenAI");
  dom.revertHint = required("revertHint");
  dom.btnSaveDraft = required("btnSaveDraft");
  dom.btnSavePublish = required("btnSavePublish");

  // --- Debug ---
  dom.debugBox = required("debugBox");
  dom.debugPre = required("debugPre");

  // --- DOM helpers (små, utan affärslogik) ---
  dom.setText = function (el, text) {
    if (!el) return;
    el.textContent = (text == null ? "" : String(text));
  };

  dom.setPill = function (pillEl, mode /* ok|warn|bad|"" */) {
    if (!pillEl) return;
    pillEl.classList.remove("ok", "warn", "bad");
    if (mode === "ok" || mode === "warn" || mode === "bad") pillEl.classList.add(mode);
  };

  dom.show = function (el) {
    if (!el) return;
    el.classList.remove("hide");
  };

  dom.hide = function (el) {
    if (!el) return;
    el.classList.add("hide");
  };

  dom.disable = function (btn, disabled) {
    if (!btn) return;
    btn.disabled = !!disabled;
    if (disabled) btn.classList.add("disabled");
    else btn.classList.remove("disabled");
  };

  dom.on = function (el, ev, fn, opts) {
    if (!el || !el.addEventListener) return;
    el.addEventListener(ev, fn, opts || false);
  };

  // Marker: id-baserade fält som vi bevakar för "dirty" i core/page.
  dom.getDirtyWatchEls = function () {
    return Array.from(document.querySelectorAll("[data-watch-dirty='true']"));
  };

  // Exportera minimal version-info för felsökning
  NS.dom.__VERSION = "v1.0-PP-SC-010-02";
})();
