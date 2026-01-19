/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-02) | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Bootstrap + state + event wiring för trainings (admin/trainings.html)
Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell
- XSS-safe rendering: all render via 05-render.js (textContent, inga osäkra innerHTML)
- ADMIN-only (SYSTEM_ADMIN/MANAGER = read-only här)
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.page) return;

  // ---------- deps ----------
  const HRApp = window.HRApp || null;           // UI-03-APP.js
  const HRWorkerSDK = window.HRWorkerSDK || null; // UI-04-WORKER-SDK.js
  const render = NS.render || null;

  function byId(id) { return document.getElementById(String(id || "")); }
  function normStr(v) { return String(v ?? "").trim(); }
  function nowTs() { return Date.now(); }

  // ---------- DOM ----------
  const DOM = {
    // topbar
    btnLogout: byId("btnLogout"),
    whoText: byId("whoText"),

    // left list
    q: byId("q"),
    fStatus: byId("fStatus"),
    btnShowAll: byId("btnShowAll"),
    btnClear: byId("btnClear"),
    onlyProblems: byId("onlyProblems"),
    btnDelete: byId("btnDelete"),
    btnPurge: byId("btnPurge"),
    btnNew: byId("btnNew"),
    list: byId("list"),
    leftHint: byId("leftHint"),

    // editor fields
    mod: byId("mod"),
    area: byId("area"),
    modList: byId("modList"),
    areaList: byId("areaList"),
    btnModAll: byId("btnModAll"),
    btnModClear: byId("btnModClear"),
    subjectIdText: byId("subjectIdText"),

    courseTitle: byId("courseTitle"),
    courseStep: byId("courseStep"),
    titleDisplay: byId("titleDisplay"),
    courseTouchHint: byId("courseTouchHint"),

    goalsLevel: byId("goalsLevel"),
    goals: byId("goals"),

    // AI
    aiContent: byId("aiContent"),
    aiCount: byId("aiCount"),
    questionControls: byId("questionControls"),
    aiQuestionType: byId("aiQuestionType"),
    aiFeedbackEnabled: byId("aiFeedbackEnabled"),
    aiHint: byId("aiHint"),

    // blocks
    blocksList: byId("blocksList"),

    // footer actions
    btnRevert: byId("btnRevert"),
    btnTestAI: byId("btnTestAI"),
    btnGenAI: byId("btnGenAI"),
    revertHint: byId("revertHint"),
    btnSaveDraft: byId("btnSaveDraft"),
    btnSavePublish: byId("btnSavePublish"),

    // debug
    debugPre: byId("debugPre"),
  };

  // ---------- Keys (LÅST) ----------
  const TRAININGS_KEY = "AO-057_TRAININGS_V1"; // read/write

  // ---------- State ----------
  const STATE = {
    ready: false,
    role: "SYSTEM_ADMIN",
    empNo: "",
    canWrite: false,

    trainings: [],
    visible: [],
    selectedId: "",
    selected: null,
    edited: null,
    dirty: false,

    // courseplan “touched”
    courseTouched: false,

    // last saved snapshot (revert)
    lastSaved: null,
  };

  // ---------- Fail-closed guards ----------
  function getRoleSafe() {
    try {
      if (HRApp && typeof HRApp.getRole === "function") return HRApp.getRole();
    } catch (_) { }
    return { role: "SYSTEM_ADMIN", empNo: "", canWrite: false };
  }

  function setDirty(on) {
    STATE.dirty = !!on;
    if (DOM.revertHint) {
      DOM.revertHint.textContent = STATE.dirty ? "Osparade ändringar" : "";
    }
  }

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; }
  }

  function safeParse(json) {
    try {
      const v = JSON.parse(json);
      return { ok: true, v };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e) };
    }
  }

  function loadTrainings() {
    const raw = (function () {
      try { return localStorage.getItem(TRAININGS_KEY); } catch (_) { return null; }
    })();

    if (!raw) {
      STATE.trainings = [];
      return { ok: true, missing: true };
    }

    const p = safeParse(raw);
    if (!p.ok) {
      // fail-closed read: keep empty to avoid corrupt crash, but show problem
      STATE.trainings = [];
      return { ok: false, corrupt: true, err: p.err };
    }

    const v = p.v;
    const arr = Array.isArray(v) ? v : (v && Array.isArray(v.trainings) ? v.trainings : []);
    STATE.trainings = Array.isArray(arr) ? arr : [];
    return { ok: true, missing: false };
  }

  function saveTrainings() {
    if (!STATE.canWrite) return { ok: false, err: "Read-only." };
    try {
      localStorage.setItem(TRAININGS_KEY, JSON.stringify(STATE.trainings));
      return { ok: true };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e) };
    }
  }

  // ---------- Model helpers (no new datamodel) ----------
  // We store course info in title string:
  // "Område • Kapitel • Steg X — <valfri bas>"
  // For now we generate a consistent titleDisplay, but we don’t change storage shape beyond “title”.
  function computeSubjectId(module, area) {
    const m = normStr(module).toLowerCase().replace(/\s+/g, "_");
    const a = normStr(area).toLowerCase().replace(/\s+/g, "_");
    if (!m || !a) return "";
    return `${m}__${a}`;
  }

  function computeTitleDisplay(area, courseTitle, courseStep) {
    const a = normStr(area) || "—";
    const ct = normStr(courseTitle) || "Introduktion";
    const cs = normStr(courseStep) || "1";
    return `${a} • ${ct} • Steg ${cs}`;
  }

  function ensureTrainingShape(t) {
    const x = (t && typeof t === "object") ? t : {};
    const out = {
      id: normStr(x.id) || ("t_" + nowTs()),
      title: normStr(x.title) || "",
      status: (String(x.status || "draft") === "published") ? "published" : "draft",
      module: normStr(x.module) || "",
      area: normStr(x.area) || "",
      goals: normStr(x.goals) || "",
      goalsLevel: normStr(x.goalsLevel) || "normal",
      // blocks is array of blocks; each block has title + items[]
      blocks: Array.isArray(x.blocks) ? x.blocks : [],
      updatedAt: Number(x.updatedAt || 0) || 0,
      createdAt: Number(x.createdAt || 0) || 0,
    };
    if (!out.createdAt) out.createdAt = out.updatedAt || nowTs();
    return out;
  }

  function computeProblems(t) {
    const probs = [];
    if (!normStr(t.title)) probs.push("Saknar titel");
    if (!normStr(t.module)) probs.push("Saknar modul");
    if (!normStr(t.area)) probs.push("Saknar område");
    const blocks = Array.isArray(t.blocks) ? t.blocks : [];
    if (t.status === "published" && blocks.length <= 0) probs.push("Publicerad men saknar block");
    return probs;
  }

  function trainingToListItem(t) {
    const probs = computeProblems(t);
    const courseTitle = (function () {
      // infer from titleDisplay style if present
      const ttl = normStr(t.title);
      const parts = ttl.split("•").map(s => s.trim());
      // a • chapter • Steg x
      return parts.length >= 2 ? parts[1] : "";
    })();
    const courseStep = (function () {
      const ttl = normStr(t.title);
      const m = ttl.match(/Steg\s+(\d+)/i);
      return m ? m[1] : "";
    })();

    return {
      id: t.id,
      title: t.title || "(utan titel)",
      module: t.module,
      area: t.area,
      courseTitle,
      courseStep,
      status: t.status,
      problems: probs,
      blocksCount: Array.isArray(t.blocks) ? t.blocks.length : 0,
      updatedAt: Number(t.updatedAt || 0) || 0,
    };
  }

  // ---------- Rendering pipeline ----------
  function renderAll() {
    // pills
    try {
      if (render && typeof render.setWhoPill === "function") {
        render.setWhoPill(`Inloggad: ${STATE.empNo || "—"} (${STATE.role})`);
      }
      if (render && typeof render.setStatePill === "function") {
        render.setStatePill("Status: OK", STATE.canWrite ? "ok" : "warn");
      }
      if (render && typeof render.setLeftHint === "function") {
        render.setLeftHint(STATE.canWrite ? "Publicering kräver minst 1 block." : "Read-only: du kan titta men inte spara/generera.");
      }
    } catch (_) { }

    // editor fields
    applyEditorFieldsFromEdited();

    // list
    const items = STATE.visible.map(trainingToListItem);
    if (render && typeof render.renderTrainingList === "function") {
      render.renderTrainingList({
        items,
        selectedId: STATE.selectedId,
        onPick: onPickTrainingId,
      });
    }

    // blocks
    const blocks = (STATE.edited && Array.isArray(STATE.edited.blocks)) ? STATE.edited.blocks : [];
    if (render && typeof render.renderBlocksList === "function") {
      render.renderBlocksList({
        blocks,
        onEdit: onEditBlockAt,
        onDelete: onDeleteBlockAt,
      });
    }

    // AI controls visibility
    if (DOM.questionControls) {
      const show = (DOM.aiContent && DOM.aiContent.value === "questions");
      DOM.questionControls.style.display = show ? "flex" : "none";
    }

    // debug
    if (DOM.debugPre) {
      const snap = STATE.edited ? deepClone(STATE.edited) : null;
      DOM.debugPre.textContent = snap ? JSON.stringify(snap, null, 2) : "—";
    }

    // ai hint
    if (render && typeof render.setAiHint === "function") {
      const sub = computeSubjectId(DOM.mod && DOM.mod.value, DOM.area && DOM.area.value);
      const cap = normStr(DOM.courseTitle && DOM.courseTitle.value);
      const st = normStr(DOM.courseStep && DOM.courseStep.value);
      const lvl = normStr(DOM.goalsLevel && DOM.goalsLevel.value);
      render.setAiHint(sub ? `subjectId=${sub} • Kapitel=${cap} • Steg=${st} • Nivå=${lvl}` : "Välj Modul + Område för att aktivera AI-kontraktet.");
    }
  }

  function buildVisibleList() {
    const q = normStr(DOM.q && DOM.q.value).toLowerCase();
    const st = normStr(DOM.fStatus && DOM.fStatus.value);
    const onlyProb = !!(DOM.onlyProblems && DOM.onlyProblems.checked);

    let arr = STATE.trainings.map(ensureTrainingShape);

    if (st) arr = arr.filter(t => String(t.status || "draft") === st);
    if (onlyProb) arr = arr.filter(t => computeProblems(t).length > 0);

    if (q) {
      arr = arr.filter(t => {
        const hay = `${t.title} ${t.module} ${t.area} ${t.id}`.toLowerCase();
        return hay.includes(q);
      });
    }

    arr.sort((a, b) => (Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));
    STATE.visible = arr;
  }

  function refresh() {
    buildVisibleList();
    renderAll();
  }

  // ---------- Editor sync ----------
  function applyEditorFieldsFromEdited() {
    const t = STATE.edited;
    if (!t) {
      // clear fields
      if (DOM.mod) DOM.mod.value = "";
      if (DOM.area) DOM.area.value = "";
      if (DOM.goals) DOM.goals.value = "";
      if (DOM.titleDisplay) DOM.titleDisplay.value = "—";
      if (DOM.subjectIdText) DOM.subjectIdText.textContent = "—";
      return;
    }

    if (DOM.mod) DOM.mod.value = normStr(t.module);
    if (DOM.area) DOM.area.value = normStr(t.area);
    if (DOM.goals) DOM.goals.value = normStr(t.goals);
    if (DOM.goalsLevel) DOM.goalsLevel.value = normStr(t.goalsLevel) || "normal";

    // course display is derived from current UI selection (not stored separately)
    const td = computeTitleDisplay(DOM.area && DOM.area.value, DOM.courseTitle && DOM.courseTitle.value, DOM.courseStep && DOM.courseStep.value);
    if (DOM.titleDisplay) DOM.titleDisplay.value = td;

    const sid = computeSubjectId(DOM.mod && DOM.mod.value, DOM.area && DOM.area.value);
    if (DOM.subjectIdText) DOM.subjectIdText.textContent = sid || "—";
  }

  function ensureEdited() {
    if (!STATE.edited) return false;
    return true;
  }

  function touchCoursePlan() {
    STATE.courseTouched = true;
    if (DOM.courseTouchHint) DOM.courseTouchHint.textContent = "Kursplan aktiv: titel genereras och skickas till AI.";
  }

  function syncTitleIntoEdited() {
    if (!ensureEdited()) return;
    // Only generate title when Module + Area exist and course has been touched
    const m = normStr(DOM.mod && DOM.mod.value);
    const a = normStr(DOM.area && DOM.area.value);
    if (!m || !a) return;
    if (!STATE.courseTouched) return;

    const td = computeTitleDisplay(a, DOM.courseTitle && DOM.courseTitle.value, DOM.courseStep && DOM.courseStep.value);
    STATE.edited.title = td;
    setDirty(true);
  }

  // ---------- CRUD trainings ----------
  function onPickTrainingId(id) {
    const tid = normStr(id);
    const found = STATE.trainings.map(ensureTrainingShape).find(t => t.id === tid) || null;
    STATE.selectedId = tid;
    STATE.selected = found ? ensureTrainingShape(found) : null;
    STATE.edited = STATE.selected ? deepClone(STATE.selected) : null;
    STATE.lastSaved = STATE.selected ? deepClone(STATE.selected) : null;
    setDirty(false);

    // when selecting, reset courseTouched until user changes it
    STATE.courseTouched = false;
    if (DOM.courseTouchHint) DOM.courseTouchHint.textContent = "Obs: Titel och mål fylls inte automatiskt förrän du väljer kapitel eller steg (kursplanen aktiveras).";

    refresh();
  }

  function createNewTraining() {
    if (!STATE.canWrite) return alertSafe("Read-only: bara ADMIN kan skapa.");
    const t = ensureTrainingShape({
      id: "t_" + nowTs(),
      title: "",
      status: "draft",
      module: "",
      area: "",
      goals: "",
      goalsLevel: "normal",
      blocks: [],
      createdAt: nowTs(),
      updatedAt: nowTs(),
    });
    STATE.trainings.unshift(t);
    const s = saveTrainings();
    if (!s.ok) return alertSafe("Kunde inte spara: " + s.err);

    onPickTrainingId(t.id);
    refresh();
  }

  function deleteSelectedTraining() {
    if (!STATE.canWrite) return alertSafe("Read-only: bara ADMIN kan ta bort.");
    if (!STATE.selectedId) return alertSafe("Välj en utbildning först.");
    if (!confirmSafe("Ta bort vald utbildning?")) return;

    const idx = STATE.trainings.findIndex(x => normStr(x && x.id) === STATE.selectedId);
    if (idx >= 0) STATE.trainings.splice(idx, 1);

    const s = saveTrainings();
    if (!s.ok) return alertSafe("Kunde inte spara: " + s.err);

    STATE.selectedId = "";
    STATE.selected = null;
    STATE.edited = null;
    STATE.lastSaved = null;
    setDirty(false);
    refresh();
  }

  function purgeAllTrainings() {
    if (!STATE.canWrite) return alertSafe("Read-only: bara ADMIN kan rensa.");
    if (!confirmSafe("Rensa ALLA utbildningar i AO-057_TRAININGS_V1?")) return;
    STATE.trainings = [];
    const s = saveTrainings();
    if (!s.ok) return alertSafe("Kunde inte spara: " + s.err);
    STATE.selectedId = "";
    STATE.selected = null;
    STATE.edited = null;
    STATE.lastSaved = null;
    setDirty(false);
    refresh();
  }

  function revertUnsaved() {
    if (!STATE.dirty) return;
    if (!confirmSafe("Ångra osparade ändringar?")) return;
    if (STATE.lastSaved) {
      STATE.edited = deepClone(STATE.lastSaved);
      setDirty(false);
      refresh();
    }
  }

  function saveEdited(status /* draft|published */) {
    if (!STATE.canWrite) return alertSafe("Read-only: bara ADMIN kan spara.");
    if (!ensureEdited()) return alertSafe("Välj en utbildning först.");

    // sync title from courseplan (if activated)
    syncTitleIntoEdited();

    const blocks = Array.isArray(STATE.edited.blocks) ? STATE.edited.blocks : [];
    const nextStatus = (status === "published") ? "published" : "draft";

    // Fail-closed publish rule
    if (nextStatus === "published" && blocks.length <= 0) {
      return alertSafe("Fail-closed: Publicering kräver minst 1 block.");
    }

    STATE.edited.status = nextStatus;
    STATE.edited.updatedAt = nowTs();

    // write back
    const idx = STATE.trainings.findIndex(x => normStr(x && x.id) === STATE.edited.id);
    if (idx >= 0) STATE.trainings[idx] = deepClone(STATE.edited);
    else STATE.trainings.unshift(deepClone(STATE.edited));

    const s = saveTrainings();
    if (!s.ok) return alertSafe("Kunde inte spara: " + s.err);

    STATE.lastSaved = deepClone(STATE.edited);
    setDirty(false);
    refresh();
  }

  // ---------- Blocks (within a training) ----------
  function ensureBlocksArray() {
    if (!ensureEdited()) return [];
    if (!Array.isArray(STATE.edited.blocks)) STATE.edited.blocks = [];
    return STATE.edited.blocks;
  }

  function onDeleteBlockAt(i) {
    if (!STATE.canWrite) return alertSafe("Read-only: bara ADMIN kan ändra block.");
    const blocks = ensureBlocksArray();
    if (i < 0 || i >= blocks.length) return;
    if (!confirmSafe("Ta bort block?")) return;
    blocks.splice(i, 1);
    setDirty(true);
    refresh();
  }

  function onEditBlockAt(i) {
    if (!ensureEdited()) return;
    const blocks = ensureBlocksArray();
    const b = blocks[i];
    if (!b) return;

    const meta = (function () {
      const t = STATE.edited;
      const m = normStr(t && t.module) || "—";
      const a = normStr(t && t.area) || "—";
      const ttl = normStr(t && t.title) || "—";
      return `${m} • ${a} • ${ttl} • Block ${i + 1}/${blocks.length}`;
    })();

    // Build editor node (word-document feeling)
    const root = document.createElement("div");
    root.style.display = "grid";
    root.style.gridTemplateColumns = "1fr";
    root.style.gap = "12px";

    const titleLbl = document.createElement("div");
    titleLbl.className = "label";
    titleLbl.style.textAlign = "left";
    titleLbl.textContent = "Blocktitel";
    root.appendChild(titleLbl);

    const title = document.createElement("input");
    title.className = "input";
    title.value = normStr(b.title) || ("Block " + (i + 1));
    root.appendChild(title);

    const hr = document.createElement("div");
    hr.style.borderTop = "1px dashed var(--line)";
    hr.style.margin = "6px 0";
    root.appendChild(hr);

    const items = Array.isArray(b.items) ? b.items : [];

    // For each item: question/doc/task editor
    for (let ix = 0; ix < items.length; ix++) {
      const it = items[ix] || {};
      const kind = String(it.kind || "document");

      const card = document.createElement("div");
      card.style.border = "1px solid var(--line)";
      card.style.borderRadius = "14px";
      card.style.padding = "10px";
      card.style.background = "#fff";
      card.style.boxShadow = "0 2px 10px rgba(17,24,39,.05)";

      const head = document.createElement("div");
      head.style.display = "flex";
      head.style.justifyContent = "space-between";
      head.style.gap = "10px";
      head.style.alignItems = "center";

      const h = document.createElement("div");
      h.style.fontWeight = "950";
      h.textContent = (kind === "question") ? ("❓ Fråga " + (ix + 1)) : (kind === "task") ? ("✅ Uppgift " + (ix + 1)) : ("📄 Dokument " + (ix + 1));

      head.appendChild(h);
      card.appendChild(head);

      const ta = document.createElement("textarea");
      ta.className = "textarea";
      ta.style.minHeight = "180px";
      ta.value = normStr(it.text || it.instruction || "");
      card.appendChild(ta);

      if (kind === "question") {
        // Options editor (3–5 visible)
        const opts = Array.isArray(it.options) ? it.options.slice() : [];
        while (opts.length < 4) opts.push("");

        const optWrap = document.createElement("div");
        optWrap.style.display = "grid";
        optWrap.style.gridTemplateColumns = "1fr";
        optWrap.style.gap = "8px";
        optWrap.style.marginTop = "10px";

        const optTitle = document.createElement("div");
        optTitle.className = "label";
        optTitle.style.textAlign = "left";
        optTitle.textContent = "Svarsalternativ (ett rätt)";
        optWrap.appendChild(optTitle);

        const radiosName = "q_correct_" + i + "_" + ix;
        const rows = [];

        for (let oi = 0; oi < 5; oi++) {
          const row = document.createElement("div");
          row.style.display = "grid";
          row.style.gridTemplateColumns = "26px 1fr";
          row.style.gap = "10px";
          row.style.alignItems = "center";

          const r = document.createElement("input");
          r.type = "radio";
          r.name = radiosName;
          r.value = String(oi);

          const inp = document.createElement("input");
          inp.className = "input";
          inp.value = normStr(opts[oi] || "");
          inp.placeholder = "Svar " + (oi + 1);

          row.appendChild(r);
          row.appendChild(inp);
          optWrap.appendChild(row);
          rows.push({ r, inp });
        }

        // Preselect correct
        const ak = normStr(it.answerKey);
        const correctIdx = (function () {
          if (!ak) return -1;
          // if answerKey equals exact option text, find it
          const idx = rows.findIndex(x => normStr(x.inp.value) === ak);
          return idx;
        })();
        if (correctIdx >= 0 && rows[correctIdx]) rows[correctIdx].r.checked = true;

        // AnswerKey hint
        const akHint = document.createElement("div");
        akHint.className = "muted2";
        akHint.style.textAlign = "left";
        akHint.textContent = "Markera vilket alternativ som är rätt. Facit sparas som answerKey (exakt text).";
        optWrap.appendChild(akHint);

        card.appendChild(optWrap);

        // Attach for save
        card.__q = { rows };
      }

      card.__meta = { kind, ta };
      root.appendChild(card);
    }

    // Open modal via render
    if (render && typeof render.openModal === "function") {
      render.openModal(meta, root, function () {
        if (!STATE.canWrite) return;

        // save back
        b.title = normStr(title.value) || ("Block " + (i + 1));
        const items2 = Array.isArray(b.items) ? b.items : [];
        const cards = Array.from(root.children).filter(n => n && n.__meta);

        for (let k = 0; k < cards.length; k++) {
          const c = cards[k];
          const m = c.__meta;
          const it2 = items2[k] || {};
          it2.text = normStr(m.ta.value);
          if (m.kind === "question" && c.__q && c.__q.rows) {
            const rows = c.__q.rows;
            const opts = rows.map(x => normStr(x.inp.value)).filter(Boolean);
            it2.options = opts;
            // answerKey = selected option text
            const sel = rows.find(x => x.r.checked);
            const pickedTxt = sel ? normStr(sel.inp.value) : "";
            it2.answerKey = pickedTxt;
            it2.kind = "question";
          }
          items2[k] = it2;
        }

        b.items = items2;
        blocks[i] = b;
        setDirty(true);
        refresh();
      });
    }
  }

  // ---------- AI (minimal baseline) ----------
  function buildAiContext() {
    if (!ensureEdited()) return null;

    const module = normStr(DOM.mod && DOM.mod.value);
    const area = normStr(DOM.area && DOM.area.value);
    const subjectId = computeSubjectId(module, area);

    const courseTitle = normStr(DOM.courseTitle && DOM.courseTitle.value);
    const courseStep = normStr(DOM.courseStep && DOM.courseStep.value);
    const level = normStr(DOM.goalsLevel && DOM.goalsLevel.value);
    const goals = normStr(DOM.goals && DOM.goals.value);

    return {
      subjectId,
      module,
      area,
      courseTitle,
      courseStep,
      level,
      goals,
      trainingTitle: normStr(STATE.edited.title),
    };
  }

  function testAI() {
    if (!STATE.canWrite) return alertSafe("Read-only: bara ADMIN kan testa AI.");
    if (!HRWorkerSDK || typeof HRWorkerSDK.health !== "function") return alertSafe("Worker SDK saknas.");
    HRWorkerSDK.health().then(function (r) {
      alertSafe(r && r.ok ? "Worker: OK" : "Worker: fel");
    }).catch(function (e) {
      alertSafe("Worker: fel (" + String((e && e.message) || e) + ")");
    });
  }

  function generateAI() {
    if (!STATE.canWrite) return alertSafe("Read-only: bara ADMIN kan generera.");
    if (!HRWorkerSDK || typeof HRWorkerSDK.aiGenerate !== "function") return alertSafe("Worker SDK saknas.");

    const ctx = buildAiContext();
    if (!ctx || !ctx.subjectId) return alertSafe("Välj Modul + Område först.");

    // Must have course plan touched (so steps differ)
    touchCoursePlan();
    syncTitleIntoEdited();

    const mode = (DOM.aiContent && DOM.aiContent.value === "questions") ? "questions" : "blocks";
    const count = Number(DOM.aiCount && DOM.aiCount.value) || 3;

    // IMPORTANT: token must not be stored; SDK should handle auth via server-side or blank token
    HRWorkerSDK.aiGenerate({
      mode: mode,
      count: count,
      context: ctx,
      language: "sv",
      // optional knobs:
      questionType: normStr(DOM.aiQuestionType && DOM.aiQuestionType.value) || "auto",
      feedbackEnabled: !!(DOM.aiFeedbackEnabled && DOM.aiFeedbackEnabled.checked),
    }).then(function (res) {
      if (!res || !res.ok) {
        alertSafe("AI: fel (" + normStr(res && res.error && res.error.message) + ")");
        return;
      }

      // Expect: res.data.blocks (array) or res.data.items etc. We accept both.
      const data = res.data || {};
      const blocksOut = Array.isArray(data.blocks) ? data.blocks : [];

      if (!blocksOut.length) {
        alertSafe("AI: inget resultat (inga blocks).");
        return;
      }

      const blocks = ensureBlocksArray();
      for (const b of blocksOut) {
        blocks.push({
          title: normStr(b.title) || "AI-block",
          items: Array.isArray(b.items) ? b.items : [],
        });
      }

      setDirty(true);
      refresh();
      alertSafe("AI: klart. Block tillagda.");
    }).catch(function (e) {
      alertSafe("AI: tekniskt fel (" + String((e && e.message) || e) + ")");
    });
  }

  // ---------- UI wiring ----------
  function confirmSafe(msg) { try { return window.confirm(String(msg || "")); } catch (_) { return false; } }
  function alertSafe(msg) { try { window.alert(String(msg || "")); } catch (_) { } }

  function wire() {
    // logout
    if (DOM.btnLogout) {
      DOM.btnLogout.addEventListener("click", function () {
        try {
          if (HRApp && typeof HRApp.logout === "function") HRApp.logout();
          else sessionStorage.clear();
          location.href = "./login.html";
        } catch (_) {
          location.href = "./login.html";
        }
      });
    }

    // list filters
    [DOM.q, DOM.fStatus].filter(Boolean).forEach(el => {
      el.addEventListener("input", refresh);
      el.addEventListener("change", refresh);
    });

    if (DOM.onlyProblems) DOM.onlyProblems.addEventListener("change", refresh);

    if (DOM.btnShowAll) {
      DOM.btnShowAll.addEventListener("click", function () {
        if (DOM.q) DOM.q.value = "";
        refresh();
      });
    }

    if (DOM.btnClear) {
      DOM.btnClear.addEventListener("click", function () {
        if (DOM.q) DOM.q.value = "";
        if (DOM.fStatus) DOM.fStatus.value = "";
        if (DOM.onlyProblems) DOM.onlyProblems.checked = false;
        refresh();
      });
    }

    // CRUD
    if (DOM.btnNew) DOM.btnNew.addEventListener("click", createNewTraining);
    if (DOM.btnDelete) DOM.btnDelete.addEventListener("click", deleteSelectedTraining);
    if (DOM.btnPurge) DOM.btnPurge.addEventListener("click", purgeAllTrainings);

    // editor changes
    const markDirty = function () { if (!STATE.canWrite) return; setDirty(true); };

    [DOM.mod, DOM.area, DOM.goals, DOM.goalsLevel].filter(Boolean).forEach(el => {
      el.addEventListener("input", function () {
        if (!ensureEdited()) return;
        if (el === DOM.mod) STATE.edited.module = normStr(DOM.mod.value);
        if (el === DOM.area) STATE.edited.area = normStr(DOM.area.value);
        if (el === DOM.goals) STATE.edited.goals = normStr(DOM.goals.value);
        if (el === DOM.goalsLevel) STATE.edited.goalsLevel = normStr(DOM.goalsLevel.value);
        // update subjectId display
        const sid = computeSubjectId(DOM.mod.value, DOM.area.value);
        if (DOM.subjectIdText) DOM.subjectIdText.textContent = sid || "—";
        markDirty();
        refresh();
      });
    });

    // course plan
    [DOM.courseTitle, DOM.courseStep].filter(Boolean).forEach(el => {
      el.addEventListener("change", function () {
        touchCoursePlan();
        syncTitleIntoEdited();
        refresh();
      });
    });

    // mod helpers
    if (DOM.btnModClear) {
      DOM.btnModClear.addEventListener("click", function () {
        if (!ensureEdited()) return;
        if (!STATE.canWrite) return;
        DOM.mod.value = "";
        DOM.area.value = "";
        STATE.edited.module = "";
        STATE.edited.area = "";
        if (DOM.subjectIdText) DOM.subjectIdText.textContent = "—";
        setDirty(true);
        refresh();
      });
    }

    if (DOM.btnModAll) {
      DOM.btnModAll.addEventListener("click", function () {
        // no-op here (datalist filled in later when you modularize “store”)
        alertSafe("Visa moduler: kommer i nästa fil (03-store/04-contract).");
      });
    }

    // footer
    if (DOM.btnRevert) DOM.btnRevert.addEventListener("click", revertUnsaved);
    if (DOM.btnTestAI) DOM.btnTestAI.addEventListener("click", testAI);
    if (DOM.btnGenAI) DOM.btnGenAI.addEventListener("click", generateAI);
    if (DOM.btnSaveDraft) DOM.btnSaveDraft.addEventListener("click", function () { saveEdited("draft"); });
    if (DOM.btnSavePublish) DOM.btnSavePublish.addEventListener("click", function () { saveEdited("published"); });

    // AI content toggle
    if (DOM.aiContent) {
      DOM.aiContent.addEventListener("change", refresh);
    }
  }

  // ---------- boot ----------
  function boot() {
    // deps check
    const missing = [];
    if (!render) missing.push("Trainings.render (05-render.js)");
    if (!DOM.list) missing.push("DOM#list");
    if (!DOM.blocksList) missing.push("DOM#blocksList");
    if (!DOM.mod) missing.push("DOM#mod");
    if (!DOM.area) missing.push("DOM#area");

    if (missing.length) {
      alertSafe("Trainings: saknar delar: " + missing.join(", "));
      return;
    }

    // role
    const who = getRoleSafe();
    STATE.role = String(who.role || "SYSTEM_ADMIN").toUpperCase();
    STATE.empNo = String(who.empNo || "");
    STATE.canWrite = (STATE.role === "ADMIN"); // ADMIN-only

    // initial pills + context
    try {
      render.setContext("Redigerar: Utbildningar");
      render.setWhoPill(`Inloggad: ${STATE.empNo || "—"} (${STATE.role})`);
      render.setStatePill("Status: OK", STATE.canWrite ? "ok" : "warn");
    } catch (_) { }

    // load data
    const r = loadTrainings();
    if (!r.ok && r.corrupt) {
      try { render.setStatePill("Status: LÅST (korrupt data)", "bad"); } catch (_) { }
      if (DOM.leftHint) DOM.leftHint.textContent = "Fail-closed: AO-057_TRAININGS_V1 är korrupt JSON. Rensa eller återställ.";
      // keep UI read-only
    }

    // normalize all
    STATE.trainings = STATE.trainings.map(ensureTrainingShape);

    // select first if exists
    if (STATE.trainings.length) {
      STATE.selectedId = normStr(STATE.trainings[0].id);
      STATE.selected = ensureTrainingShape(STATE.trainings[0]);
      STATE.edited = deepClone(STATE.selected);
      STATE.lastSaved = deepClone(STATE.selected);
    }

    wire();
    refresh();

    STATE.ready = true;
  }

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  } catch (e) {
    alertSafe("Trainings boot error: " + String((e && e.message) || e));
  }

  NS.page = { boot, state: STATE };
})();
