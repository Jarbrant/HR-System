/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-02) | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Page-controller: init + state + events + kopplar store/contract/render/SDK

POLICY (LÅST):
- UI-only • Fail-closed
- XSS-safe: textContent / value, inga osäkra innerHTML
- Inga nya storage-keys (AO-057_TRAININGS_V1)
- ADMIN-only write (MANAGER/SYSTEM_ADMIN = read-only)
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

  // -------------------------
  // Defaults (fasta) + tillåt custom utan nya keys
  // -------------------------
  const DEFAULT_MODULES = [
    "Kvalitet", "Säkerhet", "Miljö", "Kommunikation", "Dokument", "Uppgifter", "Inventering", "Utbildning"
  ];

  const DEFAULT_AREAS_BY_MODULE = {
    "Kvalitet": ["Avvikelse", "Egenkontroll", "HACCP", "Revision"],
    "Säkerhet": ["Riskbedömning", "Tillbud", "Rutiner"],
    "Miljö": ["Avfall", "Energi", "Transport"],
    "Kommunikation": ["Kund", "Intern", "Incident"],
    "Dokument": ["Policy", "Rutin", "Checklista"],
    "Uppgifter": ["Daglig drift", "Veckorutin"]
  };

  const CUSTOM_CHAPTER_VALUE = "__custom__";

  // -------------------------
  // State
  // -------------------------
  const S = {
    bootOk: false,
    locked: false,
    lockReason: "",
    who: { role: "SYSTEM_ADMIN", empNo: "", canWrite: false },
    canWrite: false,

    trainingsAll: [], // raw loaded
    filtered: [],
    selectedId: "",

    showAll: false,
    q: "",
    fStatus: "",
    onlyProblems: false,

    dirty: false,
    lastSavedSnap: null,

    // editor fields (current)
    editor: {
      id: "",
      title: "",
      status: "draft",
      module: "",
      area: "",
      courseTitle: "Introduktion",
      courseStep: "1",
      goalsLevel: "normal",
      goals: "",
      blocks: [] // [{title, items:[...] }]
    }
  };

  // -------------------------
  // Helpers
  // -------------------------
  function safeTry(fn) { try { return fn(); } catch (_) { return null; } }

  function normStr(v) { return (core && core.normStr) ? core.normStr(v) : String(v ?? "").trim(); }

  function clone(obj) { return JSON.parse(JSON.stringify(obj || {})); }

  function setDirty(flag) {
    S.dirty = !!flag;
    if (dom && dom.setText) dom.setText(dom.revertHint, S.dirty ? "Osparade ändringar" : "");
    if (dom && dom.disable) dom.disable(dom.btnRevert, !S.dirty);
  }

  function snapEditor() {
    S.lastSavedSnap = clone(S.editor);
    setDirty(false);
  }

  function isSameSnap(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  }

  function computeTitleDisplay() {
    const t = core.composeTitle(S.editor.courseTitle, S.editor.courseStep, S.editor.area || "—");
    if (dom && dom.titleDisplay) dom.titleDisplay.value = t;
    // vi använder denna title som "training.title" (låst: ingen ny datamodell)
    S.editor.title = t;
  }

  function ensureCustomChapterOption(selectEl) {
    if (!selectEl) return;
    const opts = Array.from(selectEl.options || []);
    const has = opts.some(o => String(o.value) === CUSTOM_CHAPTER_VALUE);
    if (!has) {
      const o = document.createElement("option");
      o.value = CUSTOM_CHAPTER_VALUE;
      o.textContent = "Egen titel…";
      selectEl.appendChild(o);
    }
  }

  function ensureChapterValue(selectEl, value) {
    if (!selectEl) return;
    const v = normStr(value);
    if (!v) return;
    const exists = Array.from(selectEl.options || []).some(o => normStr(o.value) === v);
    if (!exists) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      // lägg före "Egen titel…" om den finns
      const custom = Array.from(selectEl.options).find(o2 => String(o2.value) === CUSTOM_CHAPTER_VALUE);
      if (custom && custom.parentNode) custom.parentNode.insertBefore(o, custom);
      else selectEl.appendChild(o);
    }
    selectEl.value = v;
  }

  function uniqueList(arr) {
    const out = [];
    const seen = new Set();
    for (const x of (Array.isArray(arr) ? arr : [])) {
      const v = normStr(x);
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }

  function getAllModulesFromData() {
    const m = [];
    for (const t of S.trainingsAll) if (t && t.module) m.push(t.module);
    return uniqueList(m);
  }

  function getAreasForModuleFromData(mod) {
    const a = [];
    const m = normStr(mod);
    for (const t of S.trainingsAll) {
      if (!t || !t.area) continue;
      if (normStr(t.module) === m) a.push(t.area);
    }
    return uniqueList(a);
  }

  function renderDatalists() {
    // modules datalist
    const mods = uniqueList([].concat(DEFAULT_MODULES, getAllModulesFromData()));
    if (dom && dom.modList) {
      while (dom.modList.firstChild) dom.modList.removeChild(dom.modList.firstChild);
      for (const m of mods) {
        const opt = document.createElement("option");
        opt.value = m;
        dom.modList.appendChild(opt);
      }
    }

    // areas datalist depends on selected module
    const selectedMod = normStr(S.editor.module);
    const defaults = (DEFAULT_AREAS_BY_MODULE[selectedMod] || []);
    const areas = uniqueList([].concat(defaults, getAreasForModuleFromData(selectedMod)));
    if (dom && dom.areaList) {
      while (dom.areaList.firstChild) dom.areaList.removeChild(dom.areaList.firstChild);
      for (const a of areas) {
        const opt = document.createElement("option");
        opt.value = a;
        dom.areaList.appendChild(opt);
      }
    }

    // chapter custom option
    ensureCustomChapterOption(dom && dom.courseTitle);
  }

  function setStatePill(kind, text) {
    if (render && render.setStatePill) render.setStatePill(text, kind);
  }

  function setWhoPill() {
    const w = S.who || {};
    const role = normStr(w.role || "SYSTEM_ADMIN").toUpperCase();
    const emp = normStr(w.empNo || "");
    const txt = emp ? `${role} • ${emp}` : `${role}`;
    if (render && render.setWhoPill) render.setWhoPill(txt);
  }

  function setLeftHint(text) {
    if (render && render.setLeftHint) render.setLeftHint(text);
  }

  function setAiHint(text) {
    if (render && render.setAiHint) render.setAiHint(text);
  }

  function disableWrites(disabled) {
    const d = !!disabled;
    if (!dom) return;

    // left actions
    dom.disable(dom.btnDelete, d);
    dom.disable(dom.btnPurge, d);
    dom.disable(dom.btnNew, d);

    // editor actions
    dom.disable(dom.btnGenAI, d);
    dom.disable(dom.btnSaveDraft, d);
    dom.disable(dom.btnSavePublish, d);

    // inputs
    const watch = dom.getDirtyWatchEls ? dom.getDirtyWatchEls() : [];
    for (const el of watch) if (el) el.disabled = d;

    if (dom.goals) dom.goals.disabled = d;
    if (dom.goalsLevel) dom.goalsLevel.disabled = d;

    // AI controls
    if (dom.aiContent) dom.aiContent.disabled = d;
    if (dom.aiCount) dom.aiCount.disabled = d;
    if (dom.aiQuestionType) dom.aiQuestionType.disabled = d;
    if (dom.aiFeedbackEnabled) dom.aiFeedbackEnabled.disabled = d;

    dom.disable(dom.btnRevert, d || !S.dirty);
  }

  function isProblemTraining(t) {
    if (!t || typeof t !== "object") return true;
    const saveCheck = contract.validateTrainingForSave(t);
    if (!saveCheck.ok) return true;
    // publish check only if published
    if (String(t.status || "draft") === "published") {
      const pubCheck = contract.validateForPublish(t);
      if (!pubCheck.ok) return true;
    }
    return false;
  }

  function applyFilters() {
    const q = normStr(S.q).toLowerCase();
    const fs = normStr(S.fStatus);
    const onlyP = !!S.onlyProblems;

    let out = S.trainingsAll.slice(0);

    if (fs) out = out.filter(t => String(t.status || "draft") === fs);
    if (onlyP) out = out.filter(isProblemTraining);
    if (q) {
      out = out.filter(t => {
        const hay = JSON.stringify({
          title: t && t.title,
          module: t && t.module,
          area: t && t.area,
          courseTitle: t && t.courseTitle,
          courseStep: t && t.courseStep
        }).toLowerCase();
        return hay.includes(q);
      });
    }

    // Hide list until search or showAll
    if (!S.showAll && !q) {
      S.filtered = [];
      setLeftHint("Skriv i sökfältet eller tryck “Visa alla”.");
    } else {
      S.filtered = out;
      setLeftHint(`Visar ${out.length} st.`);
    }

    if (render && render.renderTrainingList) {
      render.renderTrainingList({
        items: S.filtered,
        selectedId: S.selectedId,
        onPick: (id) => pickTraining(id)
      });
    }
  }

  function findTrainingById(id) {
    const needle = normStr(id);
    return S.trainingsAll.find(t => normStr(t && t.id) === needle) || null;
  }

  function editorFromTraining(t) {
    const x = (t && typeof t === "object") ? t : {};
    const e = {
      id: normStr(x.id) || core.makeId("trn"),
      title: normStr(x.title),
      status: (String(x.status || "draft") === "published") ? "published" : "draft",
      module: normStr(x.module),
      area: normStr(x.area),
      courseTitle: normStr(x.courseTitle) || "Introduktion",
      courseStep: normStr(x.courseStep) || "1",
      goalsLevel: normStr(x.goalsLevel) || "normal",
      goals: normStr(x.goals) || "",
      blocks: Array.isArray(x.blocks) ? x.blocks : (Array.isArray(x.items) ? [{ title: "Block 1", items: x.items }] : [])
    };

    // ensure chapter exists in select (for older custom values)
    ensureChapterValue(dom && dom.courseTitle, e.courseTitle);

    S.editor = e;
    computeTitleDisplay();
    renderDatalists();
    renderEditor();
    snapEditor();
  }

  function blankTraining() {
    const e = {
      id: core.makeId("trn"),
      title: "",
      status: "draft",
      module: "",
      area: "",
      courseTitle: "Introduktion",
      courseStep: "1",
      goalsLevel: "normal",
      goals: "",
      blocks: []
    };
    S.editor = e;
    ensureChapterValue(dom && dom.courseTitle, e.courseTitle);
    computeTitleDisplay();
    renderDatalists();
    renderEditor();
    snapEditor();
  }

  function pickTraining(id) {
    const tid = normStr(id);
    if (!tid) return;

    // Dirty guard (fail-closed-ish): inga auto-överhopp om osparat
    if (S.dirty) {
      const ok = window.confirm("Du har osparade ändringar. Vill du byta utan att spara?");
      if (!ok) return;
    }

    const t = findTrainingById(tid);
    if (!t) return;
    S.selectedId = tid;
    editorFromTraining(t);
    applyFilters();
    setStatePill("ok", "Status: OK");
  }

  function upsertEditorIntoAll() {
    const e = clone(S.editor);

    // title is generated by kursplan
    computeTitleDisplay();
    e.title = normStr(S.editor.title);

    const idx = S.trainingsAll.findIndex(t => normStr(t && t.id) === normStr(e.id));
    if (idx >= 0) S.trainingsAll[idx] = e;
    else S.trainingsAll.unshift(e);
  }

  function persistAll() {
    // fail-closed: if store says corrupt -> stop
    const res = store.save(S.trainingsAll);
    if (!res || !res.ok) {
      setStatePill("bad", "Status: STOPP (kunde inte spara)");
      return false;
    }
    renderDatalists();
    applyFilters();
    return true;
  }

  function renderEditor() {
    // editor inputs
    if (dom.mod) dom.mod.value = normStr(S.editor.module);
    if (dom.area) dom.area.value = normStr(S.editor.area);

    // chapter/step
    if (dom.courseTitle) ensureChapterValue(dom.courseTitle, S.editor.courseTitle);
    if (dom.courseStep) dom.courseStep.value = normStr(S.editor.courseStep || "1");

    // goals
    if (dom.goalsLevel) dom.goalsLevel.value = normStr(S.editor.goalsLevel || "normal");
    if (dom.goals) dom.goals.value = normStr(S.editor.goals || "");

    computeTitleDisplay();

    // blocks
    if (render && render.renderBlocksList) {
      render.renderBlocksList({
        blocks: Array.isArray(S.editor.blocks) ? S.editor.blocks : [],
        onEdit: (i) => openBlockEditor(i),
        onDelete: (i) => deleteBlock(i)
      });
    }

    // AI hint
    const ctx = core.buildAiContext({
      module: S.editor.module,
      area: S.editor.area,
      courseTitle: S.editor.courseTitle,
      courseStep: S.editor.courseStep,
      goalsLevel: S.editor.goalsLevel,
      goals: S.editor.goals
    });
    setAiHint(`Kontekst: ${normStr(ctx.course && ctx.course.title) || "—"} • Nivå: ${normStr(ctx.level) || "normal"}`);

    // debug
    if (dom.debugPre) {
      dom.debugPre.textContent = JSON.stringify({
        editor: S.editor,
        canWrite: S.canWrite,
        key: store.KEY
      }, null, 2);
    }

    // subjectId text (best-effort)
    if (dom.subjectIdText) {
      const sid = [normStr(S.editor.module), normStr(S.editor.area)].filter(Boolean).join(" / ");
      dom.subjectIdText.textContent = sid || "—";
    }
  }

  // -------------------------
  // Block editor modal (överblick som “pärmsidor”)
  // -------------------------
  function openBlockEditor(index) {
    if (!S.canWrite) return;

    const b = (Array.isArray(S.editor.blocks) ? S.editor.blocks[index] : null) || null;
    if (!b) return;

    const container = document.createElement("div");

    const titleLbl = document.createElement("div");
    titleLbl.className = "muted2";
    titleLbl.style.textAlign = "left";
    titleLbl.style.fontWeight = "900";
    titleLbl.textContent = "Rubrik (block):";
    container.appendChild(titleLbl);

    const titleInput = document.createElement("input");
    titleInput.className = "input";
    titleInput.value = normStr(b.title) || ("Block " + (index + 1));
    container.appendChild(titleInput);

    const hr = document.createElement("div");
    hr.style.height = "10px";
    container.appendChild(hr);

    const items = Array.isArray(b.items) ? b.items : [];
    const local = items.map(it => contract.normalizeItem(it));

    // render each item as “papper”
    for (let i = 0; i < local.length; i++) {
      const it = local[i];

      const card = document.createElement("div");
      card.style.border = "1px solid var(--line)";
      card.style.borderRadius = "14px";
      card.style.padding = "10px";
      card.style.marginBottom = "10px";
      card.style.background = "var(--card)";
      card.style.boxShadow = "0 2px 10px rgba(17,24,39,.05)";

      const head = document.createElement("div");
      head.style.display = "flex";
      head.style.justifyContent = "space-between";
      head.style.gap = "10px";
      head.style.alignItems = "center";
      head.style.flexWrap = "wrap";

      const kind = document.createElement("div");
      kind.style.fontWeight = "900";
      kind.textContent = (it.kind === "question") ? ("Fråga " + (i + 1)) : (it.kind === "task") ? ("Uppgift " + (i + 1)) : ("Dokument " + (i + 1));

      const kindSel = document.createElement("select");
      kindSel.className = "select";
      kindSel.style.maxWidth = "220px";
      kindSel.style.margin = "0";
      const addOpt = (v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; kindSel.appendChild(o); };
      addOpt("document", "Dokument");
      addOpt("task", "Uppgift");
      addOpt("question", "Fråga");
      kindSel.value = it.kind;

      head.appendChild(kind);
      head.appendChild(kindSel);
      card.appendChild(head);

      const txt = document.createElement("textarea");
      txt.className = "textarea";
      txt.style.marginTop = "8px";
      txt.value = normStr(it.text);
      txt.placeholder = (it.kind === "question") ? "Skriv frågan…" : "Skriv text…";
      card.appendChild(txt);

      // question extras
      const qWrap = document.createElement("div");
      qWrap.style.marginTop = "10px";
      qWrap.style.display = (it.kind === "question") ? "block" : "none";

      const cLbl = document.createElement("div");
      cLbl.className = "muted2";
      cLbl.style.textAlign = "left";
      cLbl.style.fontWeight = "900";
      cLbl.textContent = "Svarsalternativ (3–5 rader):";
      qWrap.appendChild(cLbl);

      const choicesTa = document.createElement("textarea");
      choicesTa.className = "textarea";
      choicesTa.style.minHeight = "110px";
      choicesTa.value = (Array.isArray(it.choices) ? it.choices : [])
        .map(c => normStr(c && c.text))
        .filter(Boolean)
        .join("\n");
      qWrap.appendChild(choicesTa);

      const aLbl = document.createElement("div");
      aLbl.className = "muted2";
      aLbl.style.textAlign = "left";
      aLbl.style.fontWeight = "900";
      aLbl.style.marginTop = "10px";
      aLbl.textContent = "Facit (1–5):";
      qWrap.appendChild(aLbl);

      const answerInput = document.createElement("input");
      answerInput.className = "input";
      answerInput.value = "";
      // map correctChoiceId -> index if possible
      if (it.correctChoiceId) {
        const m = String(it.correctChoiceId).match(/^c(\d+)$/i);
        if (m) answerInput.value = String(m[1]);
      }
      qWrap.appendChild(answerInput);

      card.appendChild(qWrap);

      kindSel.addEventListener("change", function () {
        const v = String(kindSel.value || "document");
        qWrap.style.display = (v === "question") ? "block" : "none";
        txt.placeholder = (v === "question") ? "Skriv frågan…" : "Skriv text…";
        kind.textContent = (v === "question") ? ("Fråga " + (i + 1)) : (v === "task") ? ("Uppgift " + (i + 1)) : ("Dokument " + (i + 1));
      });

      // bind back on save
      it.__bind = { kindSel, txt, choicesTa, answerInput };
      container.appendChild(card);
    }

    render.openModal("Block-editor • fråga-per-papper", container, function () {
      const updated = [];

      for (let i = 0; i < local.length; i++) {
        const it = local[i];
        const bnd = it.__bind;
        const k = String((bnd && bnd.kindSel && bnd.kindSel.value) || "document");
        const text = normStr(bnd && bnd.txt ? bnd.txt.value : it.text);

        if (k === "question") {
          const lines = normStr(bnd && bnd.choicesTa ? bnd.choicesTa.value : "")
            .split("\n").map(s => normStr(s)).filter(Boolean).slice(0, 5);

          const choices = lines.map((t, idx) => ({ id: "c" + (idx + 1), text: t }));

          const ans = normStr(bnd && bnd.answerInput ? bnd.answerInput.value : "");
          const n = Number(ans);
          const correctChoiceId = (Number.isFinite(n) && n >= 1 && n <= 5) ? ("c" + n) : "";

          updated.push(contract.normalizeItem({
            kind: "question",
            text,
            choices,
            correctChoiceId
          }));
        } else if (k === "task") {
          updated.push(contract.normalizeItem({ kind: "task", text }));
        } else {
          updated.push(contract.normalizeItem({ kind: "document", text }));
        }
      }

      // apply
      S.editor.blocks[index] = {
        title: normStr(titleInput.value) || ("Block " + (index + 1)),
        items: updated
      };

      setDirty(true);
      renderEditor();
      setStatePill("ok", "Status: OK");
    });
  }

  function deleteBlock(index) {
    if (!S.canWrite) return;
    const ok = window.confirm("Ta bort blocket?");
    if (!ok) return;
    if (!Array.isArray(S.editor.blocks)) S.editor.blocks = [];
    S.editor.blocks.splice(index, 1);
    setDirty(true);
    renderEditor();
  }

  // -------------------------
  // AI integration (via HRWorkerSDK)
  // -------------------------
  async function doTestAI() {
    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.health !== "function") {
      setStatePill("bad", "Status: STOPP (Worker SDK saknas)");
      return;
    }
    setStatePill("warn", "Status: Testar AI…");
    try {
      const res = await window.HRWorkerSDK.health();
      const ok = !!(res && res.ok);
      setStatePill(ok ? "ok" : "bad", ok ? "Status: AI OK" : "Status: AI fel");
      setAiHint(ok ? "AI: anslutning OK." : ("AI: fel (" + (res && res.error && res.error.code ? res.error.code : "okänd") + ")"));
    } catch (e) {
      setStatePill("bad", "Status: AI fel");
      setAiHint("AI: exception (" + String((e && e.message) || e) + ")");
    }
  }

  async function doGenerateAI() {
    if (!S.canWrite) return;

    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.aiGenerate !== "function") {
      setStatePill("bad", "Status: STOPP (Worker SDK saknas)");
      return;
    }

    // require module+area+chapter+step
    const mod = normStr(S.editor.module);
    const area = normStr(S.editor.area);
    if (!mod || !area) {
      setStatePill("warn", "Status: Välj modul + område först");
      return;
    }

    const ctx = core.buildAiContext({
      module: mod,
      area,
      courseTitle: S.editor.courseTitle,
      courseStep: S.editor.courseStep,
      goalsLevel: S.editor.goalsLevel,
      goals: S.editor.goals
    });

    // forbid phrases in outgoing goals/title (extra fail-closed)
    if (core.containsForbidden && core.containsForbidden(JSON.stringify(ctx))) {
      setStatePill("bad", "Status: STOPP (förbjudna fraser i kontext)");
      return;
    }

    const count = Number(normStr(dom.aiCount && dom.aiCount.value) || "3");
    const modeSel = normStr(dom.aiContent && dom.aiContent.value);
    const mode = (modeSel === "questions") ? "questions" : "blocks";

    const qType = normStr(dom.aiQuestionType && dom.aiQuestionType.value) || "auto";
    const feedbackEnabled = !!(dom.aiFeedbackEnabled && dom.aiFeedbackEnabled.checked);

    setStatePill("warn", "Status: Genererar…");
    setAiHint("AI: skickar request…");

    try {
      const payload = {
        mode,
        count: (Number.isFinite(count) && count >= 1 && count <= 12) ? count : 3,
        context: ctx,
        language: "sv",
        questionType: qType,
        feedbackEnabled: feedbackEnabled
      };

      const raw = await window.HRWorkerSDK.aiGenerate(payload);

      const norm = core.normalizeAiResult(raw);
      // If blocks returned, flatten items into one block
      let items = [];
      if (Array.isArray(norm.items) && norm.items.length) items = norm.items;
      else if (Array.isArray(norm.blocks) && norm.blocks.length) {
        const firstB = norm.blocks[0] || {};
        if (Array.isArray(firstB.items)) items = firstB.items;
      }

      const check = contract.validateAiResult({ items });
      if (!check.ok) {
        setStatePill("bad", "Status: AI stopp (kontrakt)");
        setAiHint("AI: " + (check.reasons || []).join(" "));
        return;
      }

      const normalizedItems = items.map(contract.normalizeItem);

      if (!Array.isArray(S.editor.blocks)) S.editor.blocks = [];
      S.editor.blocks.push({
        title: (mode === "questions" ? "Provfrågor" : "AI-block") + " • " + new Date().toLocaleString("sv-SE"),
        items: normalizedItems
      });

      setDirty(true);
      renderEditor();
      setStatePill("ok", "Status: AI klart");
      setAiHint("AI: genererade " + normalizedItems.length + " items.");
    } catch (e) {
      setStatePill("bad", "Status: AI fel");
      setAiHint("AI: exception (" + String((e && e.message) || e) + ")");
    }
  }

  // -------------------------
  // Save / publish / delete
  // -------------------------
  function saveDraft() {
    if (!S.canWrite) return;

    S.editor.status = "draft";

    // fail-closed validation
    const check = contract.validateTrainingForSave(S.editor);
    if (!check.ok) {
      setStatePill("bad", "Status: STOPP (kontrakt)");
      setAiHint((check.reasons || []).join(" "));
      return;
    }

    upsertEditorIntoAll();
    if (!persistAll()) return;

    snapEditor();
    setStatePill("ok", "Status: Sparad (utkast)");
  }

  function savePublish() {
    if (!S.canWrite) return;

    // must be publish-valid
    const e = clone(S.editor);
    e.status = "published";

    const check = contract.validateForPublish(e);
    if (!check.ok) {
      setStatePill("bad", "Status: STOPP (kan ej publicera)");
      setAiHint((check.reasons || []).join(" "));
      return;
    }

    S.editor.status = "published";

    upsertEditorIntoAll();
    if (!persistAll()) return;

    snapEditor();
    setStatePill("ok", "Status: Publicerad");
  }

  function revertEditor() {
    if (!S.canWrite) return;
    if (!S.dirty) return;

    const ok = window.confirm("Ångra osparade ändringar?");
    if (!ok) return;

    if (S.lastSavedSnap) {
      S.editor = clone(S.lastSavedSnap);
      computeTitleDisplay();
      renderDatalists();
      renderEditor();
      setDirty(false);
      setStatePill("ok", "Status: Ångrat");
    }
  }

  function deleteSelected() {
    if (!S.canWrite) return;

    const id = normStr(S.editor.id);
    if (!id) return;

    const ok = window.confirm("Ta bort vald utbildning?");
    if (!ok) return;

    S.trainingsAll = S.trainingsAll.filter(t => normStr(t && t.id) !== id);

    if (!persistAll()) return;

    S.selectedId = "";
    blankTraining();
    applyFilters();
    setStatePill("ok", "Status: Borttagen");
  }

  function purgeAll() {
    if (!S.canWrite) return;

    const ok = window.confirm("Rensa ALLA utbildningar i AO-057_TRAININGS_V1?");
    if (!ok) return;

    const res = store.purgeAll();
    if (!res || !res.ok) {
      setStatePill("bad", "Status: STOPP (kunde inte rensa)");
      return;
    }

    S.trainingsAll = [];
    S.selectedId = "";
    S.showAll = false;
    blankTraining();
    applyFilters();
    renderDatalists();
    setStatePill("ok", "Status: Rensat");
  }

  // -------------------------
  // Events / wiring
  // -------------------------
  function wireDirtyWatch() {
    const els = dom.getDirtyWatchEls ? dom.getDirtyWatchEls() : [];
    for (const el of els) {
      dom.on(el, "input", function () { if (S.canWrite) setDirty(true); });
      dom.on(el, "change", function () { if (S.canWrite) setDirty(true); });
    }

    // goals
    dom.on(dom.goals, "input", function () {
      if (!S.canWrite) return;
      S.editor.goals = normStr(dom.goals.value);
      setDirty(true);
      renderEditor();
    });

    dom.on(dom.goalsLevel, "change", function () {
      if (!S.canWrite) return;
      S.editor.goalsLevel = normStr(dom.goalsLevel.value);
      setDirty(true);
      renderEditor();
    });
  }

  function wireControls() {
    // logout
    dom.on(dom.btnLogout, "click", function () {
      safeTry(() => window.HRApp && window.HRApp.logout && window.HRApp.logout());
      window.location.href = "../index.html";
    });

    // search/filter
    dom.on(dom.q, "input", function () { S.q = normStr(dom.q.value); applyFilters(); });
    dom.on(dom.fStatus, "change", function () { S.fStatus = normStr(dom.fStatus.value); applyFilters(); });
    dom.on(dom.onlyProblems, "change", function () { S.onlyProblems = !!dom.onlyProblems.checked; applyFilters(); });

    dom.on(dom.btnShowAll, "click", function () { S.showAll = true; applyFilters(); });
    dom.on(dom.btnClear, "click", function () {
      S.q = "";
      S.fStatus = "";
      S.onlyProblems = false;
      S.showAll = false;
      dom.q.value = "";
      dom.fStatus.value = "";
      dom.onlyProblems.checked = false;
      applyFilters();
    });

    // editor module/area
    dom.on(dom.mod, "input", function () {
      if (!S.canWrite) return;
      S.editor.module = normStr(dom.mod.value);
      // when module changes, update area list suggestions
      renderDatalists();
      computeTitleDisplay();
      setDirty(true);
      renderEditor();
    });

    dom.on(dom.area, "input", function () {
      if (!S.canWrite) return;
      S.editor.area = normStr(dom.area.value);
      computeTitleDisplay();
      setDirty(true);
      renderEditor();
    });

    dom.on(dom.btnModAll, "click", function () {
      // “Visa moduler” = visa lista via datalist + fokus
      renderDatalists();
      dom.mod.focus();
      dom.mod.select && dom.mod.select();
      setStatePill("ok", "Status: OK");
    });

    dom.on(dom.btnModClear, "click", function () {
      if (!S.canWrite) return;
      dom.mod.value = "";
      dom.area.value = "";
      S.editor.module = "";
      S.editor.area = "";
      renderDatalists();
      computeTitleDisplay();
      setDirty(true);
      renderEditor();
    });

    // course plan
    dom.on(dom.courseTitle, "change", function () {
      if (!S.canWrite) return;

      ensureCustomChapterOption(dom.courseTitle);

      const v = normStr(dom.courseTitle.value);

      if (v === CUSTOM_CHAPTER_VALUE) {
        // prompt new title (kapitel) – no new keys, only string value
        const prev = normStr(S.editor.courseTitle) || "Introduktion";
        const input = window.prompt("Ny titel (kapitel):", "");
        const next = normStr(input);

        if (!next) {
          dom.courseTitle.value = prev;
          return;
        }

        ensureChapterValue(dom.courseTitle, next);
        S.editor.courseTitle = next;
      } else {
        S.editor.courseTitle = v || "Introduktion";
      }

      computeTitleDisplay();
      setDirty(true);
      renderEditor();
    });

    dom.on(dom.courseStep, "change", function () {
      if (!S.canWrite) return;
      S.editor.courseStep = normStr(dom.courseStep.value) || "1";
      computeTitleDisplay();
      setDirty(true);
      renderEditor();
    });

    // left actions
    dom.on(dom.btnNew, "click", function () {
      if (!S.canWrite) return;
      if (S.dirty) {
        const ok = window.confirm("Du har osparat. Vill du skapa ny utan att spara?");
        if (!ok) return;
      }
      S.selectedId = "";
      blankTraining();
      setStatePill("ok", "Status: Ny utbildning");
    });

    dom.on(dom.btnDelete, "click", function () { deleteSelected(); });
    dom.on(dom.btnPurge, "click", function () { purgeAll(); });

    // AI
    dom.on(dom.btnTestAI, "click", function () { doTestAI(); });
    dom.on(dom.btnGenAI, "click", function () { doGenerateAI(); });

    // save
    dom.on(dom.btnSaveDraft, "click", function () { saveDraft(); });
    dom.on(dom.btnSavePublish, "click", function () { savePublish(); });

    // revert
    dom.on(dom.btnRevert, "click", function () { revertEditor(); });
  }

  // -------------------------
  // Boot
  // -------------------------
  function boot() {
    core.assert(dom && dom.__VERSION, "BOOT", "DOM saknas");
    core.assert(core && core.__VERSION, "BOOT", "CORE saknas");
    core.assert(store && store.__VERSION, "BOOT", "STORE saknas");
    core.assert(contract && contract.__VERSION, "BOOT", "CONTRACT saknas");
    core.assert(render && render.__VERSION, "BOOT", "RENDER saknas");

    // Who / role
    S.who = core.getWho();
    S.canWrite = core.isAdminWriter(S.who);

    setWhoPill();

    // Load storage
    const loaded = store.load();
    if (!loaded || !loaded.ok) {
      S.locked = true;
      S.lockReason = loaded && loaded.corrupt ? store.lockReasonFor() : (loaded && loaded.err ? loaded.err : "Okänt storage-fel.");
      setStatePill("bad", "Status: STOPP (storage)");
      setLeftHint(S.lockReason);
      disableWrites(true);
      // still render empty list
      S.trainingsAll = [];
      S.filtered = [];
      blankTraining();
      applyFilters();
      return;
    }

    S.trainingsAll = Array.isArray(loaded.trainings) ? loaded.trainings : [];
    // ensure ids
    for (let i = 0; i < S.trainingsAll.length; i++) {
      const t = S.trainingsAll[i];
      if (!t || typeof t !== "object") continue;
      if (!normStr(t.id)) t.id = core.makeId("trn");
      if (!t.status) t.status = "draft";
    }

    // init editor
    blankTraining();
    renderDatalists();

    // wire
    wireDirtyWatch();
    wireControls();

    // write permissions
    if (!S.canWrite) {
      setStatePill("warn", "Status: Read-only");
      setLeftHint("Du är i read-only (MANAGER/SYSTEM_ADMIN).");
      disableWrites(true);
    } else {
      disableWrites(false);
      setStatePill("ok", "Status: OK");
    }

    // live dirty check (when editor changes)
    dom.on(document, "input", function () {
      if (!S.canWrite) return;
      // update editor fields from DOM where relevant
      S.editor.module = normStr(dom.mod.value);
      S.editor.area = normStr(dom.area.value);
      S.editor.courseStep = normStr(dom.courseStep.value || S.editor.courseStep);
      S.editor.goals = normStr(dom.goals.value);
      computeTitleDisplay();

      const dirtyNow = !S.lastSavedSnap ? true : !isSameSnap(S.editor, S.lastSavedSnap);
      setDirty(dirtyNow);
    });

    // initial filter render
    applyFilters();
    renderEditor();

    S.bootOk = true;
  }

  // start
  try {
    boot();
  } catch (e) {
    setStatePill("bad", "Status: STOPP (boot)");
    setLeftHint("Boot-fel: " + String((e && e.message) || e));
    disableWrites(true);
  }

  page.__VERSION = "v1.0-PP-SC-010-02";
})();
