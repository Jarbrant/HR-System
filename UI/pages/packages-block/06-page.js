/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 06/06 | FIL-ID: UI/pages/packages-block/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Page controller (STATE + events + save/verify/publish + export-wire)
Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell
- XSS-safe: all rendering via 05-render.js
- SYSTEM_ADMIN = steward/read-only (ingen write)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.page) return; // idempotent

  const dom = NS.dom;
  const core = NS.core;
  const store = NS.store;
  const contract = NS.contract;
  const render = NS.render;

  // -----------------------------
  // Page DOM bindings (by id)
  // -----------------------------
  function $id(id){ return document.getElementById(id); }

  const UI = {
    // search/filter
    qBlocks: $id("qBlocks"),
    btnShowAllBlocks: $id("btnShowAllBlocks"),
    filterStatus: $id("filterStatus"),
    fHasQ: $id("fHasQ"),
    fHasD: $id("fHasD"),
    fNoKey: $id("fNoKey"),
    fUnverified: $id("fUnverified"),

    // actions
    btnVerify: $id("btnVerify"),
    btnPublish: $id("btnPublish"),
    btnPrint: $id("btnPrint"),
    btnSaveEdits: $id("btnSaveEdits"),

    // export (may exist)
    btnToggleExport: $id("btnToggleExport"),
    exportBody: $id("exportBody"),
    qTrainModule: $id("qTrainModule"),
    qTrainArea: $id("qTrainArea"),
    qTrainFree: $id("qTrainFree"),
    dlTrainAreas: $id("dlTrainAreas"),
    btnReloadTrainings: $id("btnReloadTrainings"),
    btnExportTraining: $id("btnExportTraining"),

    // info
    btnToggleInfo: $id("btnToggleInfo"),
    introBox: $id("introBox"),

    // logout (optional)
    navLogout: $id("navLogout"),
  };

  // -----------------------------
  // STATE (in-memory)
  // -----------------------------
  const STATE = {
    // auth
    role: "SYSTEM_ADMIN",
    empNo: "",
    canWrite: false,

    // blocks
    blocks: [],
    visibleBlocks: [],
    discoveryActive: false, // "search-first": false until query or show-all
    forceShowAll: false,
    selectedId: "",
    selected: null,

    // edit buffer (for right panel)
    edit: {
      dirty: false,
      blockId: "",
      title: "",
      module: "",
      area: "",
      step: "",
      status: "draft",
      verifiedAt: 0,
      verifiedBy: "",
      items: [],
    },

    // trainings export (read-only; wired later)
    trainings: [],
    trainingsCorrupt: false,
    trainingActiveIndex: -1,
    trainingActiveItems: [],
  };

  // -----------------------------
  // Helpers
  // -----------------------------
  function deepClone(x){
    try { return JSON.parse(JSON.stringify(x)); } catch(_) { return null; }
  }

  function safeArr(a){ return Array.isArray(a) ? a : []; }

  function normalizeBlock(b){
    const o = (b && typeof b === "object") ? b : {};
    return {
      blockId: String(o.blockId || "").trim(),
      title: String(o.title || "").trim(),
      module: String(o.module || "").trim(),
      area: String(o.area || "").trim(),
      step: String(o.step || "").trim(),
      status: core.normStatus(o.status),
      createdAt: Number(o.createdAt || 0) || 0,
      updatedAt: Number(o.updatedAt || 0) || 0,
      verifiedAt: Number(o.verifiedAt || 0) || 0,
      verifiedBy: String(o.verifiedBy || "").trim(),
      items: safeArr(o.items),
    };
  }

  function normalizeItem(it){
    const o = (it && typeof it === "object") ? it : {};
    const kind = String(o.kind || "document");
    if (kind === "question") {
      const text = String(o.text || "");
      const choices = safeArr(o.choices).map((c, idx)=>({
        id: String((c && c.id) || "").trim() || (["A","B","C","D","E"][idx] || ("C"+(idx+1))),
        text: String((c && c.text) || "").trim()
      })).filter(c=>c.text).slice(0,10);

      // legacy options support
      const legacyOptions = safeArr(o.options).map(x=>String(x).trim()).filter(Boolean);
      const mergedChoices = choices.length ? choices : legacyOptions.map((t, idx)=>({
        id: ["A","B","C","D","E"][idx] || ("C"+(idx+1)),
        text: t
      })).slice(0,10);

      const ak = (o.answerKeyObj && typeof o.answerKeyObj === "object") ? o.answerKeyObj : {};
      const correctChoiceId = String(ak.correctChoiceId || o.answerKey || "").trim();
      const rationale = String(ak.rationale || "").trim();

      return {
        kind: "question",
        text,
        choices: mergedChoices,
        options: mergedChoices.map(c=>c.text),
        answerKeyObj: { kind: "mcq_single", correctChoiceId, rationale },
        answerKey: correctChoiceId, // legacy
      };
    }

    if (kind === "task") {
      const instruction = String(o.instruction || "").trim();
      const deliverable = String(o.deliverable || "").trim();
      const text = String(o.text || "").trim() || (
        (instruction ? ("Instruktion: " + instruction) : "") +
        (instruction && deliverable ? "\n\n" : "") +
        (deliverable ? ("Leverans: " + deliverable) : "")
      );
      return { kind: "task", instruction, deliverable, text };
    }

    // document default
    return { kind: "document", text: String(o.text || "") };
  }

  function computeBlockComposition(block){
    const items = safeArr(block.items).map(normalizeItem);
    let q=0,t=0,d=0, miss=0, strictFail=0;
    for (const it of items){
      if (it.kind === "question"){
        q++;
        // missing facit = id not in choices or missing
        const id = String(it.answerKeyObj && it.answerKeyObj.correctChoiceId ? it.answerKeyObj.correctChoiceId : "").trim();
        const exists = id && safeArr(it.choices).some(c=>String(c.id) === id);
        if (!exists) miss++;
        if (contract && contract.CONTRACT_V1_STRICT){
          try { if (!contract.validateQuestionStrict(it).ok) strictFail++; } catch(_) { strictFail++; }
        }
      } else if (it.kind === "task"){
        t++;
        if (contract && contract.CONTRACT_V1_STRICT){
          try { if (!contract.validateTaskStrict(it).ok) strictFail++; } catch(_) { strictFail++; }
        }
      } else {
        d++;
        if (contract && contract.CONTRACT_V1_STRICT){
          try { if (!contract.validateDocStrict(it).ok) strictFail++; } catch(_) { strictFail++; }
        }
      }
    }
    const kind = (q>0 && (t>0 || d>0)) ? "mixed" : "single";
    return { q,t,d,miss,strictFail,kind };
  }

  function rebuildVisible(){
    const q = String((UI.qBlocks && UI.qBlocks.value) || "").trim().toLowerCase();
    const st = String((UI.filterStatus && UI.filterStatus.value) || "all");
    const hasQ = !!(UI.fHasQ && UI.fHasQ.checked);
    const hasD = !!(UI.fHasD && UI.fHasD.checked);
    const noKey = !!(UI.fNoKey && UI.fNoKey.checked);
    const unverified = !!(UI.fUnverified && UI.fUnverified.checked);

    STATE.discoveryActive = STATE.forceShowAll || q.length > 0;

    if (!STATE.discoveryActive) {
      STATE.visibleBlocks = [];
      return;
    }

    let list = STATE.blocks.slice();

    if (st !== "all") list = list.filter(b => core.normStatus(b.status) === st);

    if (q.length){
      list = list.filter(b => {
        const hay = `${b.blockId} ${b.title} ${b.module} ${b.area} ${b.step}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if (hasQ || hasD || noKey || unverified){
      list = list.filter(b => {
        const c = b.__comp || computeBlockComposition(b);
        if (hasQ && c.q === 0) return false;
        if (hasD && c.d === 0) return false;
        if (noKey && c.miss === 0) return false;
        if (unverified && !(Number(b.verifiedAt || 0) > 0)) return false;
        return true;
      });
    }

    STATE.visibleBlocks = list;
  }

  function renderAll(){
    // top pills
    const total = STATE.blocks.length;
    let problems = 0;
    let unv = 0;
    for (const b of STATE.blocks){
      const c = b.__comp || computeBlockComposition(b);
      if (c.miss > 0 || c.strictFail > 0) problems++;
      if (!(Number(b.verifiedAt || 0) > 0)) unv++;
    }
    render.setStatePill(`Status: ${total} block • Problem: ${problems} • Ej verifierade: ${unv}`, "pill");
    render.setSelectionPill(STATE.selectedId ? ("Val: " + STATE.selectedId) : "Val: —");
    render.setVerifyPill(
      STATE.selected && Number(STATE.selected.verifiedAt||0) > 0 ? "Verifierad" : "Ej verifierad",
      STATE.selected && Number(STATE.selected.verifiedAt||0) > 0 ? "verifyPill ok" : "verifyPill warn",
      !!STATE.selected
    );

    render.renderBlockList({
      discoveryActive: STATE.discoveryActive,
      allCount: STATE.blocks.length,
      visible: STATE.visibleBlocks.map(b=>{
        const nb = normalizeBlock(b);
        nb.__comp = b.__comp || computeBlockComposition(nb);
        return nb;
      }),
      selectedBlockId: STATE.selectedId,
      onSelect: onSelect
    });

    // selected detail
    if (!STATE.selected){
      render.renderSelectedDetail({ block: null });
      render.setTopEditing("", false);
    } else {
      // validate now (for UI warnings)
      const reasons = [];
      try {
        const chk = contract && contract.validateForVerify
          ? contract.validateForVerify(STATE.edit, normalizeItem, (k)=> (k==="question"?"❓":k==="task"?"✅":"📄"))
          : { ok:true, reasons:[] };
        if (!chk.ok) reasons.push.apply(reasons, chk.reasons || []);
      } catch (_) {
        reasons.push("Validering kunde inte köras (JS-fel).");
      }
      render.renderSelectedDetail({
        block: STATE.edit,
        canEdit: STATE.canWrite,
        validationReasons: reasons,
        onPatchItem: patchEditItem
      });
      render.setTopEditing(STATE.edit.title || STATE.selectedId, true);
    }

    // write buttons
    const disableWrite = !STATE.canWrite || !STATE.selected;
    if (UI.btnSaveEdits) UI.btnSaveEdits.disabled = disableWrite || !STATE.edit.dirty;
    if (UI.btnVerify) UI.btnVerify.disabled = disableWrite;
    if (UI.btnPublish) UI.btnPublish.disabled = disableWrite;
  }

  function patchEditItem(idx, patcher){
    if (!STATE.canWrite) return;
    const items = safeArr(STATE.edit.items);
    const i = Number(idx);
    if (i < 0 || i >= items.length) return;

    const cur = normalizeItem(items[i]);
    let next = cur;
    try {
      if (typeof patcher === "function") next = patcher(cur);
      else if (patcher && typeof patcher === "object") next = Object.assign({}, cur, patcher);
    } catch (_) {
      next = cur;
    }

    const out = items.slice();
    out[i] = next;
    STATE.edit.items = out;
    STATE.edit.dirty = true;
    renderAll();
  }

  function onSelect(blockId){
    const id = String(blockId || "");
    STATE.selectedId = id;

    const found = STATE.blocks.find(b => String(b.blockId) === id) || null;
    STATE.selected = found ? normalizeBlock(found) : null;

    if (!STATE.selected){
      STATE.edit = { dirty:false, blockId:"", title:"", module:"", area:"", step:"", status:"draft", verifiedAt:0, verifiedBy:"", items:[] };
      renderAll();
      return;
    }

    // create editable buffer
    const sel = normalizeBlock(found);
    sel.items = safeArr(sel.items).map(normalizeItem);
    STATE.edit = Object.assign({}, sel, { dirty:false });

    renderAll();
  }

  // -----------------------------
  // Actions: Save / Verify / Publish
  // -----------------------------
  function saveEdits(){
    if (!STATE.canWrite || !STATE.selected) return;
    if (!STATE.edit.dirty) {
      render.setMsg("ok", "Inget att spara.");
      return;
    }

    // re-validate before save? (we allow save draft even if invalid, but warn)
    const now = core.nowTs();
    const patch = deepClone(STATE.edit) || STATE.edit;
    patch.updatedAt = now;

    // ensure normalized items
    patch.items = safeArr(patch.items).map(normalizeItem);

    // write back into blocks list
    const out = STATE.blocks.map(b => {
      if (String(b.blockId) !== String(patch.blockId)) return b;
      return Object.assign({}, b, patch);
    });

    const sr = store.saveBlocks(out);
    if (!sr.ok) {
      render.setMsg("err", "Kunde inte spara (storage blocked).");
      return;
    }

    // refresh state from storage (single source of truth)
    const lb = store.loadBlocksState();
    if (!lb.ok) {
      render.showLockBox([store.lockReasonFor(store.BLOCKS_KEY)]);
      render.setMsg("err", "Blockbank är korrupt efter sparning (fail-closed).");
      return;
    }

    STATE.blocks = safeArr(lb.blocks).map(normalizeBlock).map(b => (b.__comp = computeBlockComposition(b), b));
    STATE.edit.dirty = false;

    rebuildVisible();
    onSelect(patch.blockId);
    render.setMsg("ok", "Sparat.");
  }

  function verifySelected(){
    if (!STATE.canWrite || !STATE.selected) return;

    const chk = contract.validateForVerify(STATE.edit, normalizeItem, (k)=> (k==="question"?"❓":k==="task"?"✅":"📄"));
    if (!chk.ok) {
      render.setMsg("err", "Verifiering stoppad: rätta felen i listan.");
      renderAll();
      return;
    }

    const now = core.nowTs();
    STATE.edit.verifiedAt = now;
    STATE.edit.verifiedBy = String(STATE.empNo || "").trim() || "unknown";

    // mark as verified but keep status as draft unless publish
    STATE.edit.updatedAt = now;
    STATE.edit.dirty = true;
    saveEdits();
    render.setMsg("ok", "Verifierat.");
  }

  function publishSelected(){
    if (!STATE.canWrite || !STATE.selected) return;

    const chk = contract.validateForPublish(STATE.edit, normalizeItem, (k)=> (k==="question"?"❓":k==="task"?"✅":"📄"));
    if (!chk.ok) {
      render.setMsg("err", "Publicering stoppad: rätta felen i listan.");
      renderAll();
      return;
    }

    // require verified first (fail-closed)
    if (!(Number(STATE.edit.verifiedAt || 0) > 0)) {
      render.setMsg("err", "Publicering kräver verifiering först.");
      return;
    }

    const now = core.nowTs();
    STATE.edit.status = "published";
    STATE.edit.updatedAt = now;
    STATE.edit.dirty = true;

    saveEdits();
    render.setMsg("ok", "Publicerad.");
  }

  // -----------------------------
  // Export (placeholder wiring)
  // -----------------------------
  function reloadTrainings(){
    const lt = store.loadTrainingsState();
    if (!lt.ok) {
      STATE.trainingsCorrupt = true;
      STATE.trainings = [];
      render.renderTrainingHits({ corrupt:true, missing:false, hits:[] });
      render.setTrainExportHint("Låst: trainings JSON är korrupt.");
      return;
    }

    STATE.trainingsCorrupt = false;
    STATE.trainings = safeArr(lt.trainings);
    STATE.trainingActiveIndex = -1;
    STATE.trainingActiveItems = [];

    // We don't know your training schema here yet -> show placeholder list size
    render.renderTrainingHits({ corrupt:false, missing:lt.missing, hits:[] });
    render.setTrainExportHint("Export kopplas in i nästa patch (behöver exakt training-schema).");
  }

  // -----------------------------
  // UI Events
  // -----------------------------
  function bindEvents(){
    // search-first toggles
    if (UI.btnShowAllBlocks){
      UI.btnShowAllBlocks.addEventListener("click", function(){
        STATE.forceShowAll = !STATE.forceShowAll;
        UI.btnShowAllBlocks.textContent = STATE.forceShowAll ? "Sökläge" : "Visa alla";
        rebuildVisible();
        renderAll();
      });
    }

    function onFilter(){
      rebuildVisible();
      renderAll();
    }

    ["input","change"].forEach((evt)=>{
      if (UI.qBlocks) UI.qBlocks.addEventListener(evt, onFilter);
      if (UI.filterStatus) UI.filterStatus.addEventListener(evt, onFilter);
      if (UI.fHasQ) UI.fHasQ.addEventListener(evt, onFilter);
      if (UI.fHasD) UI.fHasD.addEventListener(evt, onFilter);
      if (UI.fNoKey) UI.fNoKey.addEventListener(evt, onFilter);
      if (UI.fUnverified) UI.fUnverified.addEventListener(evt, onFilter);
    });

    if (UI.btnSaveEdits) UI.btnSaveEdits.addEventListener("click", saveEdits);
    if (UI.btnVerify) UI.btnVerify.addEventListener("click", verifySelected);
    if (UI.btnPublish) UI.btnPublish.addEventListener("click", publishSelected);

    if (UI.btnPrint) UI.btnPrint.addEventListener("click", function(){
      window.print();
    });

    if (UI.btnToggleInfo && UI.introBox){
      UI.btnToggleInfo.addEventListener("click", function(){
        const isHidden = UI.introBox.style.display === "none";
        UI.introBox.style.display = isHidden ? "block" : "none";
        UI.btnToggleInfo.textContent = isHidden ? "Dölj info" : "Visa info";
      });
    }

    if (UI.btnToggleExport && UI.exportBody){
      UI.btnToggleExport.addEventListener("click", function(){
        const isHidden = UI.exportBody.style.display === "none";
        UI.exportBody.style.display = isHidden ? "block" : "none";
        UI.btnToggleExport.textContent = isHidden ? "Dölj" : "Visa";
      });
    }

    if (UI.btnReloadTrainings) UI.btnReloadTrainings.addEventListener("click", reloadTrainings);

    if (UI.navLogout){
      UI.navLogout.addEventListener("click", function(e){
        e.preventDefault();
        try { core.HRApp.logout(); } catch(_) { location.href = "../index.html"; }
      });
    }
  }

  // -----------------------------
  // Boot
  // -----------------------------
  function boot(){
    // deps check
    if (!dom || !core || !store || !render) {
      try {
        const miss = [];
        if (!dom) miss.push("01-dom.js");
        if (!core) miss.push("02-core.js");
        if (!store) miss.push("03-store.js");
        if (!render) miss.push("05-render.js");
        render && render.setMsg ? render.setMsg("err", "JS saknas: " + miss.join(", ")) : null;
      } catch(_) {}
      return;
    }

    const dep = core.assertDeps();
    if (!dep.ok) {
      core.hardFail("Saknar beroenden: " + dep.miss.join(", "));
      return;
    }

    const roleInfo = core.getRole();
    STATE.role = roleInfo.role;
    STATE.empNo = roleInfo.empNo;
    STATE.canWrite = !!roleInfo.canWrite;

    render.setWhoPill(`Inloggad: ${STATE.empNo || "—"} (${STATE.role})`);
    render.setModePill(STATE.canWrite ? "Läge: Redigera" : "Läge: Read-only", STATE.canWrite ? "pill ok" : "pill warn");

    // Load blocks
    const lb = store.loadBlocksState();
    if (!lb.ok) {
      render.showLockBox([store.lockReasonFor(store.BLOCKS_KEY)]);
      render.setMsg("err", "Blockbank är korrupt. Kontrollrummet är låst (fail-closed).");
      return;
    }

    STATE.blocks = safeArr(lb.blocks).map(normalizeBlock).map(b => (b.__comp = computeBlockComposition(b), b));

    // search-first initial
    STATE.forceShowAll = false;
    STATE.discoveryActive = false;
    rebuildVisible();
    renderAll();

    bindEvents();

    render.setMsg("ok", "Klart. Sök eller tryck “Visa alla” för att se block.");
  }

  // Crash guards: visa fel i msgBox istället för tyst död
  window.addEventListener("error", function (ev) {
    try {
      const msg = ev && ev.message ? ev.message : String(ev);
      if (render && render.setMsg) render.setMsg("err", "JS-fel: " + msg);
    } catch (_) {}
  });

  window.addEventListener("unhandledrejection", function (ev) {
    try {
      const msg = ev && ev.reason ? (ev.reason.message || String(ev.reason)) : "Okänt promise-fel";
      if (render && render.setMsg) render.setMsg("err", "JS-fel (promise): " + msg);
    } catch (_) {}
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  NS.page = { boot };
})();

