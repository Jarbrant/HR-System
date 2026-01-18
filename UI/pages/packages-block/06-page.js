/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 06/06 | FIL-ID: UI/pages/packages-block/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Bootstrap + state + event wiring för Block-editor (packages-block)
Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell
- XSS-safe rendering: all render via 05-render.js (textContent, inga osäkra innerHTML)
- SYSTEM_ADMIN = steward/read-only

PATCH v1.1.2 (PP-SC-002 fortsättning – döljer export-containern helt när stängd):
- P0: Export-kortets container (.exportBox) döljs helt när "Visa" är stängt (inte bara #exportBody)
- P1: Vid stängning städas export-UI (preview + knappar) för att undvika "halvöppet" läge
- P2: Robust: om .exportBox saknas fortsätter fallback-toggling av #exportBody ändå

PATCH v1.3.1 (PP-SC-004 / Inkorg-export förenkling – Bild 2):
- Tar bort stöd för qTrainArea/qTrainFree/dlTrainAreas (fält borttagna i HTML)
- Behåller endast modul-filter (valfritt) + lista + export-knapp
- Städning: vid stängning reset modulfilter + preview + disable export
- Ingen ändring i storage-keys/datamodell. Inga nya DOM-id/hooks.

PATCH v1.3.2 (PP-SC-005 / Inkorg-export: endast markera + export + stäng):
- P1: “Uppdatera”-knappen (btnReloadTrainings) repurposed → “Stäng” (stänger export med städning)
- P1: Grön kvittens “flyttad/skapat” via render.setTrainExportNotice(ok) (fallback setTrainExportHint)
- P1: Efter export: stänger exportbox + städar + auto-väljer nya blocket

PATCH v1.3.3 (PP-SC-007 / Fokus: redigera Fråga+Svar i modal + ingen preview-brus i inkorg):
- P0: Vid klick i inkorg (trainings-lista) ska endast "Vald" markeras + export-knapp aktiveras (ingen Preview(items))
- P0: Robust städning: trainPreviewDetail töms/döljs vid val/stäng
- P1: Heuristik i normalizeItem: om kind="document" men item ser ut som fråga/uppgift → normalisera rätt (fixar "Dokument 1: text saknas")
- P1: Frågor: säkerställ 3–5 svarsalternativ i normaliserad data (pad/cap), 1 rätt via answerKey/answerKeyObj (kontrakt hanterar validering)
- P1: onAddItem(question): default 4 alternativ (3–5 krav)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.page) return; // idempotent

  function byId(id) { return document.getElementById(String(id || "")); }

  // ---------- DOM ids (måste finnas i HTML) ----------
  const DOM = {
    // pills / header
    statePill: byId("statePill"),
    selPill: byId("selPill"),
    whoPill: byId("whoPill"),
    modePill: byId("modePill"),
    verifyPill: byId("verifyPill"),
    topEditing: byId("topEditing"),
    topEditingText: byId("topEditingText"),

    // messages / lock
    msgBox: byId("msgBox"),
    lockBox: byId("lockBox"),
    introBox: byId("introBox"),

    // left list controls
    qBlocks: byId("qBlocks"),
    btnShowAllBlocks: byId("btnShowAllBlocks"),
    filterStatus: byId("filterStatus"),
    fHasQ: byId("fHasQ"),
    fHasD: byId("fHasD"),
    fNoKey: byId("fNoKey"),
    fUnverified: byId("fUnverified"),
    blockList: byId("blockList"),
    countBlocks: byId("countBlocks"),

    // actions
    btnToggleInfo: byId("btnToggleInfo"),
    btnVerify: byId("btnVerify"),
    btnPrint: byId("btnPrint"),
    btnPublish: byId("btnPublish"),

    // export/training UI (PP-SC-004: endast modul-filter)
    btnToggleExport: byId("btnToggleExport"),
    exportBody: byId("exportBody"),
    qTrainModule: byId("qTrainModule"),
    trainPreview: byId("trainPreview"),
    trainPreviewDetail: byId("trainPreviewDetail"),
    btnExportTraining: byId("btnExportTraining"),
    btnReloadTrainings: byId("btnReloadTrainings"),
    trainExportHint: byId("trainExportHint"),

    // selected block
    selHint: byId("selHint"),
    selDetail: byId("selDetail"),
    selDirtyPill: byId("selDirtyPill"),
    btnSaveEdits: byId("btnSaveEdits"),

    // modal shell (optional but expected in v1.1)
    pbModalOverlay: byId("pbModalOverlay"),
    pbModalDialog: byId("pbModalDialog"),
    pbModalBody: byId("pbModalBody"),
    pbModalFoot: byId("pbModalFoot"),
    pbModalTitle: byId("pbModalTitle"),
    pbModalSub: byId("pbModalSub"),
    pbModalClose: byId("pbModalClose"),
    pbModalCancel: byId("pbModalCancel"),
    pbModalSave: byId("pbModalSave"),
  };

  // PP-SC-002: export container (no new DOM-id, selector only)
  const EXPORT_BOX = document.querySelector(".exportBox") || null;

  // We move this panel into modal (no cloning) to keep listeners intact
  const SEL_PANEL = document.querySelector(".selPanel") || null;
  const SEL_PANEL_HOME = (function () {
    if (!SEL_PANEL) return null;
    const ph = document.createElement("div");
    ph.setAttribute("data-pb-selpanel-home", "1");
    // insert placeholder right before panel
    try { SEL_PANEL.parentNode && SEL_PANEL.parentNode.insertBefore(ph, SEL_PANEL); } catch (_) {}
    return ph;
  })();

  // ---------- deps ----------
  const core = NS.core;
  const store = NS.store;
  const render = NS.render;
  const contract = NS.contract;

  // ---------- fail-safe msg helpers (if render missing) ----------
  function setMsgSafe(text) {
    try {
      if (render && typeof render.setMsg === "function") render.setMsg("", text);
      else if (DOM.msgBox) { DOM.msgBox.textContent = String(text || ""); DOM.msgBox.style.display = text ? "block" : "none"; }
    } catch (_) {
      if (DOM.msgBox) { DOM.msgBox.textContent = String(text || ""); DOM.msgBox.style.display = text ? "block" : "none"; }
    }
  }

  function showLock(lines) {
    const arr = Array.isArray(lines) ? lines.filter(Boolean) : [];
    try {
      if (render && typeof render.showLockBox === "function") render.showLockBox(arr);
      else if (DOM.lockBox) {
        DOM.lockBox.style.display = arr.length ? "block" : "none";
        DOM.lockBox.textContent = arr.join("\n");
      }
    } catch (_) {}
  }

  // PP-SC-005: grön/röd/export-notice i inkorgen (05-render har helper; fallback till hint)
  function setExportNotice(kind, text) {
    const k = String(kind || "info");
    const t = String(text || "");
    try {
      if (render && typeof render.setTrainExportNotice === "function") {
        render.setTrainExportNotice(k, t);
        return;
      }
    } catch (_) {}
    try {
      if (render && typeof render.setTrainExportHint === "function") {
        render.setTrainExportHint(t);
        return;
      }
    } catch (_) {}
    // last resort: direct text
    if (DOM.trainExportHint) DOM.trainExportHint.textContent = t;
  }

  // ---------- state ----------
  const STATE = {
    ready: false,
    discoveryActive: false, // search-first: startar false
    role: "SYSTEM_ADMIN",
    empNo: "",
    canWrite: false,

    allBlocks: [],
    visibleBlocks: [],
    selectedId: "",
    selected: null,

    // editing
    dirty: false,
    edited: null,

    // trainings
    trainings: [],
    trainingsCorrupt: false,
    trainingsMissing: false,
    trainSelIndex: -1,
    trainHits: [],
    exportOpen: false,
    infoOpen: false,

    // modal
    modalOpen: false,
  };

  // ---------- utils ----------
  function nowTs() { return Date.now(); }

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; }
  }

  function normStr(v) { return String(v ?? "").trim(); }

  function clearChildren(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function countComposition(block) {
    const items = Array.isArray(block && block.items) ? block.items : [];
    let q = 0, d = 0, t = 0, missingKey = 0;
    for (const it of items) {
      const k = String(it && it.kind ? it.kind : "document");
      if (k === "question") {
        q++;
        // "saknar facit" – tolerant: answerKey eller answerKeyObj.correctChoiceId
        const ak = normStr(it && (it.answerKey || (it.answerKeyObj && it.answerKeyObj.correctChoiceId)));
        if (!ak) missingKey++;
      } else if (k === "task") t++;
      else d++;
    }
    return { q, d, t, missingKey, items: items.length };
  }

  // PP-SC-007: heuristik för att tolka gamla/inkorrekt märkta items
  function looksLikeQuestion(it) {
    if (!it || typeof it !== "object") return false;
    if (Array.isArray(it.options) && it.options.length) return true;
    if (Array.isArray(it.choices) && it.choices.length) return true;
    if (it.answerKey) return true;
    if (it.answerKeyObj && typeof it.answerKeyObj === "object" && it.answerKeyObj.correctChoiceId) return true;
    if (it.requiresAnswer !== undefined) return true;
    if (String(it.answerType || "").toLowerCase() === "choice") return true;
    if (it.questionId || it.questionID || it.qid) return true;
    return false;
  }

  function looksLikeTask(it) {
    if (!it || typeof it !== "object") return false;
    if (it.deliverable) return true;
    if (it.instruction) return true;
    if (it.requiresDone !== undefined) return true;
    if (String(it.answerType || "").toLowerCase() === "checkbox") return true;
    if (it.taskId) return true;
    return false;
  }

  function normalizeQuestionOptions(rawOptions) {
    // Policy: ingen ny datamodell/keys – vi normaliserar bara item-shape för UI+kontrakt.
    // Krav (PP-SC-007): 3–5 svarsalternativ.
    const opts = Array.isArray(rawOptions) ? rawOptions.map((x) => normStr(x)) : [];
    const cleaned = opts.filter((x) => x !== "");
    const out = cleaned.slice(0, 5); // cap 5

    // pad till minst 3 (tomma strängar så UI kan visa fält)
    while (out.length < 3) out.push("");

    return out;
  }

  function normalizeItem(raw) {
    const it0 = raw && typeof raw === "object" ? raw : {};
    const kindRaw = String(it0.kind || "").toLowerCase();

    // PP-SC-007: om kind är tom/okänd eller "document" men ser ut som fråga/uppgift → korrigera
    let kind = kindRaw;
    if (kind !== "question" && kind !== "task" && kind !== "document") kind = "document";

    if (kind === "document") {
      const qish = looksLikeQuestion(it0);
      const tish = looksLikeTask(it0);
      if (qish && !tish) kind = "question";
      else if (tish && !qish) kind = "task";
      else if (qish && tish) kind = "question"; // prefer question om båda matchar (minskar "dokument text saknas")
    }

    if (kind === "question") {
      // Accept: {options:[...], answerKey:"..."} OR {choices:[{id,text}], answerKeyObj:{correctChoiceId,rationale}}
      const options = (function () {
        if (Array.isArray(it0.options)) return normalizeQuestionOptions(it0.options);
        // legacy: choices -> options (text)
        if (Array.isArray(it0.choices)) return normalizeQuestionOptions(it0.choices.map((c) => (c && c.text) ? c.text : ""));
        return normalizeQuestionOptions([]);
      })();

      return {
        kind: "question",
        questionId: normStr(it0.questionId) || normStr(it0.id) || normStr(it0.qid) || "",
        text: normStr(it0.text) || "",
        requiresAnswer: it0.requiresAnswer !== false,
        answerType: normStr(it0.answerType) || "choice",
        options: options,
        answerKey: normStr(it0.answerKey) || "",
        // legacy strict fields (if present)
        choices: Array.isArray(it0.choices) ? it0.choices : undefined,
        answerKeyObj: it0.answerKeyObj && typeof it0.answerKeyObj === "object" ? it0.answerKeyObj : undefined,
      };
    }

    if (kind === "task") {
      return {
        kind: "task",
        taskId: normStr(it0.taskId) || "",
        text: normStr(it0.text) || "",
        instruction: normStr(it0.instruction) || "",
        deliverable: normStr(it0.deliverable) || "",
        requiresDone: it0.requiresDone !== false,
        answerType: normStr(it0.answerType) || "checkbox",
      };
    }

    // document
    return {
      kind: "document",
      text: normStr(it0.text) || "",
      requiresSign: !!it0.requiresSign,
    };
  }

  function normalizeBlock(raw) {
    const b = raw && typeof raw === "object" ? raw : {};
    const items = Array.isArray(b.items) ? b.items : [];
    const out = {
      blockId: normStr(b.blockId),
      title: normStr(b.title) || "(utan rubrik)",
      module: normStr(b.module) || "",
      area: normStr(b.area) || "",
      step: normStr(b.step) || "",
      status: String(b.status || "draft").toLowerCase() === "published" ? "published" : "draft",
      createdAt: Number(b.createdAt || 0) || 0,
      updatedAt: Number(b.updatedAt || 0) || 0,
      verifiedAt: Number(b.verifiedAt || 0) || 0,
      verifiedBy: normStr(b.verifiedBy) || "",
      items: items.map((it) => normalizeItem(it)),
    };
    out.__comp = countComposition(out);
    return out;
  }

  function stripComp(b) {
    const x = deepClone(b);
    if (x && typeof x === "object") delete x.__comp;
    return x;
  }

  // ---------- "Nytt" indikator (utan ny storage) ----------
  // Definition enligt v1.1: "nytt" = block som ej är verifierat (verifiedAt <= 0).
  function countNewBlocks(blocks) {
    const arr = Array.isArray(blocks) ? blocks : [];
    let n = 0;
    for (const b of arr) {
      if (!b) continue;
      if (Number(b.verifiedAt || 0) <= 0) n++;
    }
    return n;
  }

  function applyExportIndicator() {
    if (!DOM.btnToggleExport) return;

    const nNew = countNewBlocks(STATE.allBlocks);
    const hasNew = nNew > 0;

    // 1) Text + aria (ONE SOURCE OF TRUTH)
    const baseText = STATE.exportOpen ? "Dölj" : "Visa";
    DOM.btnToggleExport.textContent = baseText;
    DOM.btnToggleExport.setAttribute("aria-expanded", STATE.exportOpen ? "true" : "false");

    // 2) Prefer render helper (optional), but we still apply robust cue below
    if (render && typeof render.setExportIndicator === "function") {
      try { render.setExportIndicator({ hasNew, countNew: nNew }); } catch (_) {}
    }

    // 3) Robust visual cue (does not rely on CSS existing)
    try {
      DOM.btnToggleExport.classList.toggle("ok", hasNew);

      if (hasNew) {
        DOM.btnToggleExport.title = `Det finns ${nNew} nya/ej verifierade block (verifiedAt <= 0).`;
        DOM.btnToggleExport.style.borderColor = "rgba(16,185,129,.45)";
        DOM.btnToggleExport.style.background = "rgba(209,250,229,.70)";
      } else {
        DOM.btnToggleExport.title = "Visa export";
        DOM.btnToggleExport.style.borderColor = "";
        DOM.btnToggleExport.style.background = "";
      }
    } catch (_) {}
  }

  // PP-SC-007: robust städning av preview-pane (inkorg ska inte visa Preview(items))
  function clearExportPreviewPane() {
    try {
      if (DOM.trainPreviewDetail) {
        DOM.trainPreviewDetail.style.display = "none";
        // extra: töm noden om render inte gör det
        while (DOM.trainPreviewDetail.firstChild) DOM.trainPreviewDetail.removeChild(DOM.trainPreviewDetail.firstChild);
      }
    } catch (_) {}

    // Om 05-render har renderExportPreview: kalla med tom array som "soft reset"
    try {
      if (render && typeof render.renderExportPreview === "function") {
        render.renderExportPreview({ items: [] });
      }
    } catch (_) {}
  }

  // PP-SC-002: central toggle for export container + body + cleanup
  function applyExportVisibility() {
    const open = !!STATE.exportOpen;

    // container
    if (EXPORT_BOX) {
      EXPORT_BOX.style.display = open ? "block" : "none";
    }

    // body (fallback + keeps old behavior)
    if (DOM.exportBody) {
      DOM.exportBody.style.display = open ? "block" : "none";
    }

    // when closing: cleanup "half-open" UI (PP-SC-004: extra städning)
    if (!open) {
      STATE.trainSelIndex = -1;

      // reset module filter to neutral inkorg-läge
      try { if (DOM.qTrainModule) DOM.qTrainModule.value = ""; } catch (_) {}

      if (DOM.btnExportTraining) DOM.btnExportTraining.disabled = true;

      // PP-SC-007: inkorg ska inte visa preview alls
      clearExportPreviewPane();

      // refresh list state to match cleared filter
      try { refreshTrainingUI(); } catch (_) {}
    }
  }

  function buildVisibleBlocks() {
    const q = normStr(DOM.qBlocks && DOM.qBlocks.value).toLowerCase();
    const st = DOM.filterStatus ? String(DOM.filterStatus.value || "all") : "all";
    const hasQ = !!(DOM.fHasQ && DOM.fHasQ.checked);
    const hasD = !!(DOM.fHasD && DOM.fHasD.checked);
    const noKey = !!(DOM.fNoKey && DOM.fNoKey.checked);
    const unv = !!(DOM.fUnverified && DOM.fUnverified.checked);

    let arr = STATE.allBlocks.slice();

    if (st !== "all") arr = arr.filter((b) => b.status === st);
    if (hasQ) arr = arr.filter((b) => (b.__comp && b.__comp.q) > 0);
    if (hasD) arr = arr.filter((b) => (b.__comp && b.__comp.d) > 0);
    if (noKey) arr = arr.filter((b) => (b.__comp && b.__comp.missingKey) > 0);
    if (unv) arr = arr.filter((b) => Number(b.verifiedAt || 0) <= 0);

    if (q) {
      STATE.discoveryActive = true;
      arr = arr.filter((b) => {
        const hay = `${b.title} ${b.module} ${b.area} ${b.step} ${b.blockId}`.toLowerCase();
        return hay.includes(q);
      });
    }

    // stable sort: updated desc
    arr.sort((a, b) => (Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));

    STATE.visibleBlocks = arr;
  }

  function refreshLeftList() {
    buildVisibleBlocks();
    if (render && typeof render.renderBlockList === "function") {
      render.renderBlockList({
        discoveryActive: STATE.discoveryActive,
        allCount: STATE.allBlocks.length,
        visible: STATE.visibleBlocks,
        selectedBlockId: STATE.selectedId,
        onSelect: onSelectBlockId,
      });
    }
  }

  function setDirty(on) {
    STATE.dirty = !!on;
    if (DOM.selDirtyPill) {
      DOM.selDirtyPill.style.display = STATE.dirty ? "inline-flex" : "none";
      DOM.selDirtyPill.textContent = STATE.dirty ? "Ändringar: osparade" : "";
    }
    if (DOM.btnSaveEdits) DOM.btnSaveEdits.disabled = !(STATE.dirty && STATE.canWrite && STATE.selectedId);

    // modal save button mirrors same state
    if (DOM.pbModalSave) DOM.pbModalSave.disabled = !(STATE.dirty && STATE.canWrite && STATE.selectedId);
  }

  function applySelectionPills() {
    try {
      if (render && typeof render.setSelectionPill === "function") {
        render.setSelectionPill(STATE.selectedId ? `Val: ${STATE.selectedId}` : "Val: —");
      }
      if (render && typeof render.setTopEditing === "function") {
        render.setTopEditing(STATE.selected ? (STATE.selected.title || "—") : "—", !!STATE.selected);
      }
    } catch (_) {}
  }

  function computeValidationReasonsForSelected() {
    if (!STATE.edited) return [];
    if (!contract) return [];

    const emojiForKind = function (k) {
      const s = String(k || "");
      if (s === "question") return "❓";
      if (s === "task") return "✅";
      return "📄";
    };

    try {
      const chk = contract.validateForVerify(STATE.edited, normalizeItem, emojiForKind);
      return chk && Array.isArray(chk.reasons) ? chk.reasons : [];
    } catch (e) {
      return [`Tekniskt fel i validering: ${String((e && e.message) || e)}`];
    }
  }

  // ---------- modal helpers (no innerHTML, move nodes) ----------
  function modalAvailable() {
    return !!(DOM.pbModalOverlay && DOM.pbModalDialog && DOM.pbModalBody);
  }

  function setModalHidden(hidden) {
    if (!modalAvailable()) return;
    DOM.pbModalOverlay.setAttribute("aria-hidden", hidden ? "true" : "false");
  }

  function openModal() {
    if (!modalAvailable()) return;
    if (STATE.modalOpen) return;

    // Move the existing selection panel into modal body (keeps listeners)
    if (SEL_PANEL && DOM.pbModalBody) {
      try {
        while (DOM.pbModalBody.firstChild) DOM.pbModalBody.removeChild(DOM.pbModalBody.firstChild);
        DOM.pbModalBody.appendChild(SEL_PANEL);
      } catch (_) {}
    }

    // Title/sub
    if (DOM.pbModalTitle) DOM.pbModalTitle.textContent = "Redigera block";
    if (DOM.pbModalSub) {
      DOM.pbModalSub.textContent = STATE.selected
        ? `${STATE.selected.module || "—"} • ${STATE.selected.area || "—"} • ${STATE.selected.title || "—"} • ${STATE.selected.step || "—"}`
        : "—";
    }

    setModalHidden(false);
    STATE.modalOpen = true;

    // Focus
    try { DOM.pbModalBody && DOM.pbModalBody.focus && DOM.pbModalBody.focus(); } catch (_) {}

    // Update save enabled state
    if (DOM.pbModalSave) DOM.pbModalSave.disabled = !(STATE.dirty && STATE.canWrite && STATE.selectedId);
  }

  function closeModal(restorePanel) {
    if (!modalAvailable()) return;
    if (!STATE.modalOpen) return;

    setModalHidden(true);
    STATE.modalOpen = false;

    // Move panel back to its home position
    if (restorePanel && SEL_PANEL && SEL_PANEL_HOME && SEL_PANEL_HOME.parentNode) {
      try {
        SEL_PANEL_HOME.parentNode.insertBefore(SEL_PANEL, SEL_PANEL_HOME.nextSibling);
      } catch (_) {}
    }
  }

  function confirmLoseEditsIfNeeded() {
    if (!STATE.dirty) return true;
    try {
      return window.confirm("Du har osparade ändringar. Vill du kasta ändringarna?");
    } catch (_) {
      return false;
    }
  }

  function revertEditsToSelected() {
    if (!STATE.selected) return;
    STATE.edited = deepClone(STATE.selected);
    setDirty(false);
    updateRightPanel();
  }

  // ---------- central apply helper (stabil uppdatering) ----------
  function applyEditedBlockChange(mutatorFn) {
    if (!STATE.canWrite) return { ok: false, err: "Read-only." };
    if (!STATE.edited) return { ok: false, err: "Inget block valt." };

    try {
      const cur = STATE.edited;
      const nextDraft = deepClone(cur);
      const mutated = mutatorFn ? mutatorFn(nextDraft) : nextDraft;
      const next = normalizeBlock(Object.assign({}, mutated, { updatedAt: nowTs() }));
      STATE.edited = next;
      setDirty(true);
      refreshLeftList();
      updateRightPanel();
      return { ok: true };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e) };
    }
  }

  function updateRightPanel() {
    const reasons = computeValidationReasonsForSelected();

    // verify pill
    const ok = reasons.length === 0;
    try {
      if (render && typeof render.setVerifyPill === "function") {
        render.setVerifyPill(
          ok ? "Verifiering: OK" : `Verifiering: ${reasons.length} problem`,
          ok ? "verifyPill ok" : "verifyPill warn",
          !!STATE.selectedId
        );
      }
    } catch (_) {}

    // enable buttons
    if (DOM.btnPrint) DOM.btnPrint.disabled = !STATE.selectedId;
    if (DOM.btnVerify) DOM.btnVerify.disabled = !(STATE.selectedId && STATE.canWrite && ok);
    if (DOM.btnPublish) DOM.btnPublish.disabled = !(STATE.selectedId && STATE.canWrite && ok);

    // render selected (editor UI)
    if (render && typeof render.renderSelectedDetail === "function") {
      render.renderSelectedDetail({
        block: STATE.edited,
        canEdit: STATE.canWrite,
        validationReasons: reasons,

        onPatchItem: function (idx, mutFn) {
          if (!STATE.canWrite) return;
          const cur = STATE.edited;
          if (!cur || !Array.isArray(cur.items)) return;
          if (idx < 0 || idx >= cur.items.length) return;

          applyEditedBlockChange(function (draft) {
            const items = Array.isArray(draft.items) ? draft.items.slice() : [];
            const nextIt = mutFn ? mutFn(items[idx]) : items[idx];
            items[idx] = normalizeItem(nextIt);
            draft.items = items;
            return draft;
          });
        },

        onPatchMeta: function (mutFn) {
          if (!STATE.canWrite) return;
          applyEditedBlockChange(function (draft) {
            const next = mutFn ? mutFn(draft) : draft;
            next.title = normStr(next.title) || "(utan rubrik)";
            next.module = normStr(next.module || "");
            next.area = normStr(next.area || "");
            next.step = normStr(next.step || "");
            return next;
          });
        },

        onAddItem: function (kind, afterIdx) {
          if (!STATE.canWrite) return;
          const k = String(kind || "document");
          applyEditedBlockChange(function (draft) {
            const items = Array.isArray(draft.items) ? draft.items.slice() : [];
            const base =
              // PP-SC-007: default 4 alternativ (uppfyller 3–5)
              k === "question" ? { kind: "question", text: "", options: ["Alternativ 1", "Alternativ 2", "Alternativ 3", "Alternativ 4"], answerKey: "" } :
              k === "task" ? { kind: "task", text: "", instruction: "", deliverable: "" } :
              { kind: "document", text: "" };

            const ni = normalizeItem(base);

            let pos = Number.isFinite(afterIdx) ? Number(afterIdx) + 1 : items.length;
            if (pos < 0) pos = 0;
            if (pos > items.length) pos = items.length;

            items.splice(pos, 0, ni);
            draft.items = items;
            return draft;
          });
        },

        onRemoveItem: function (idx) {
          if (!STATE.canWrite) return;
          applyEditedBlockChange(function (draft) {
            const items = Array.isArray(draft.items) ? draft.items.slice() : [];
            const i = Number(idx);
            if (i >= 0 && i < items.length) items.splice(i, 1);
            draft.items = items;
            return draft;
          });
        },

        onMoveItem: function (idx, dir) {
          if (!STATE.canWrite) return;
          applyEditedBlockChange(function (draft) {
            const items = Array.isArray(draft.items) ? draft.items.slice() : [];
            const i = Number(idx);
            const d = String(dir || "");
            const j = d === "up" ? (i - 1) : d === "down" ? (i + 1) : i;
            if (i >= 0 && i < items.length && j >= 0 && j < items.length && i !== j) {
              const tmp = items[i];
              items[i] = items[j];
              items[j] = tmp;
            }
            draft.items = items;
            return draft;
          });
        },
      });
    }

    // keep modal subtitle fresh (include meta)
    if (STATE.modalOpen && DOM.pbModalSub) {
      DOM.pbModalSub.textContent = STATE.edited
        ? `${STATE.edited.module || "—"} • ${STATE.edited.area || "—"} • ${STATE.edited.title || "—"} • ${STATE.edited.step || "—"}`
        : "—";
    }
  }

  function onSelectBlockId(id) {
    const bid = normStr(id);
    STATE.selectedId = bid;
    const found = STATE.allBlocks.find((b) => b.blockId === bid) || null;
    STATE.selected = found;
    STATE.edited = found ? deepClone(found) : null;
    setDirty(false);
    applySelectionPills();
    updateRightPanel();
    setMsgSafe(STATE.selectedId ? "Klart. Valt block laddat." : "Klart. Välj ett block.");

    // v1.1: open modal on selection (if modal exists)
    if (STATE.selectedId && modalAvailable()) {
      openModal();
    }
  }

  // ---------- persistence ----------
  function persistEditedBlock() {
    if (!STATE.edited || !STATE.selectedId) return { ok: false, err: "Inget block valt." };
    const idx = STATE.allBlocks.findIndex((b) => b.blockId === STATE.selectedId);
    if (idx < 0) return { ok: false, err: "Block hittades inte i listan." };

    const next = deepClone(STATE.edited);
    next.updatedAt = nowTs();
    next.__comp = countComposition(next);

    STATE.allBlocks[idx] = normalizeBlock(next);
    const save = store.saveBlocks(STATE.allBlocks.map(stripComp));
    if (!save.ok) return save;

    STATE.selected = STATE.allBlocks[idx];
    STATE.edited = deepClone(STATE.selected);
    setDirty(false);
    refreshLeftList();
    updateRightPanel();
    applyExportIndicator();
    return { ok: true };
  }

  function setVerifiedAndPersist() {
    if (!STATE.edited) return { ok: false, err: "Inget block valt." };
    const reasons = computeValidationReasonsForSelected();
    if (reasons.length) return { ok: false, err: "Verifiering stoppad av kontraktet." };

    const next = deepClone(STATE.edited);
    next.verifiedAt = nowTs();
    next.verifiedBy = STATE.empNo || "—";
    next.updatedAt = nowTs();
    next.__comp = countComposition(next);

    STATE.edited = next;
    return persistEditedBlock();
  }

  function setPublishedAndPersist() {
    if (!STATE.edited) return { ok: false, err: "Inget block valt." };
    const reasons = computeValidationReasonsForSelected();
    if (reasons.length) return { ok: false, err: "Publicering stoppad av kontraktet." };

    const next = deepClone(STATE.edited);
    next.status = "published";
    next.updatedAt = nowTs();
    next.__comp = countComposition(next);

    STATE.edited = next;
    return persistEditedBlock();
  }

  // ---------- trainings (export) - tolerant ----------
  function loadTrainings() {
    const r = store.loadTrainingsState();
    STATE.trainingsCorrupt = !r.ok && !!r.corrupt;
    STATE.trainingsMissing = !!r.missing;
    STATE.trainings = r.ok ? (r.trainings || []) : [];
    STATE.trainSelIndex = -1;
  }

  function extractTrainingItems(t) {
    if (t && Array.isArray(t.items)) return t.items.map(normalizeItem);
    if (t && Array.isArray(t.blocks)) {
      const flat = [];
      for (const b of t.blocks) {
        if (b && Array.isArray(b.items)) flat.push(...b.items);
      }
      return flat.map(normalizeItem);
    }
    return [];
  }

  function extractTrainingMeta(t, idx) {
    const title = normStr(t && (t.title || t.name)) || `Utbildning ${idx + 1}`;
    const module = normStr(t && t.module) || "";
    const area = normStr(t && t.area) || "";
    const step = normStr(t && (t.step || t.stepId)) || "";
    const items = extractTrainingItems(t);
    return { index: idx, title, module, area, step, itemsCount: items.length, items };
  }

  function refreshTrainingUI() {
    // modul-lista
    if (DOM.qTrainModule) {
      const mods = new Set();
      for (const tr of STATE.trainings) {
        const m = normStr(tr && tr.module);
        if (m) mods.add(m);
      }
      const cur = DOM.qTrainModule.value || "";
      clearChildren(DOM.qTrainModule);

      const opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = "Alla moduler";
      DOM.qTrainModule.appendChild(opt0);

      Array.from(mods).sort().forEach((m) => {
        const o = document.createElement("option");
        o.value = m;
        o.textContent = m;
        DOM.qTrainModule.appendChild(o);
      });

      DOM.qTrainModule.value = cur;
    }

    // PP-SC-004: endast modul-filter (valfritt)
    const m = normStr(DOM.qTrainModule && DOM.qTrainModule.value);

    const hits = [];
    for (let i = 0; i < STATE.trainings.length; i++) {
      const tr = STATE.trainings[i];
      const meta = extractTrainingMeta(tr, i);
      if (m && meta.module !== m) continue;
      meta.active = (STATE.trainSelIndex === i);
      hits.push(meta);
    }
    STATE.trainHits = hits;

    if (render && typeof render.renderTrainingHits === "function") {
      render.renderTrainingHits({
        hits: hits,
        corrupt: STATE.trainingsCorrupt,
        missing: STATE.trainingsMissing,
        onPickTraining: function (index) {
          // PP-SC-007: endast markera vald + aktivera export. Ingen Preview(items).
          STATE.trainSelIndex = Number(index);
          refreshTrainingUI();

          const found = hits.find((h) => h.index === STATE.trainSelIndex) || null;

          // säkerställ att preview-panelen inte "spökar" fram
          clearExportPreviewPane();

          if (DOM.btnExportTraining) {
            DOM.btnExportTraining.disabled = !(STATE.canWrite && found && found.itemsCount > 0);
          }
        },
      });
    }

    // PP-SC-005: fokus “markera + export”
    setExportNotice(
      "info",
      STATE.canWrite
        ? "Markera en utbildning i listan och tryck “Exportera vald utbildning”."
        : "Read-only: du kan inte exportera i detta läge."
    );

    if (DOM.btnExportTraining) {
      const found = hits.find((h) => h.index === STATE.trainSelIndex);
      DOM.btnExportTraining.disabled = !(STATE.canWrite && found && found.itemsCount > 0);
    }

    // PP-SC-007: inkorg ska aldrig visa preview-pane
    clearExportPreviewPane();
  }

  function exportSelectedTraining() {
    const hit = STATE.trainHits.find((h) => h.index === STATE.trainSelIndex);
    if (!hit) { setMsgSafe("Markera en utbildning först."); return; }
    if (!STATE.canWrite) { setMsgSafe("Read-only: bara ADMIN kan exportera."); return; }
    if (!hit.items || !hit.items.length) { setMsgSafe("Utbildningen saknar items att exportera."); return; }

    const ts = nowTs();
    const newBlockId = `b_${ts}`;
    const newBlock = normalizeBlock({
      blockId: newBlockId,
      title: hit.title,
      module: hit.module,
      area: hit.area,
      step: hit.step,
      status: "draft",
      createdAt: ts,
      updatedAt: ts,
      verifiedAt: 0,
      verifiedBy: "",
      items: hit.items.map(normalizeItem),
    });

    STATE.allBlocks.unshift(newBlock);
    const save = store.saveBlocks(STATE.allBlocks.map(stripComp));
    if (!save.ok) {
      setExportNotice("bad", `❌ Kunde inte exportera: ${save.err || "okänt fel"}`);
      setMsgSafe(`Kunde inte exportera: ${save.err || "okänt fel"}`);
      return;
    }

    // PP-SC-005: grön kvittens “flyttad” i inkorgen + städning + stäng export
    setExportNotice("ok", `✅ Flyttad: “${hit.title}” → nytt block (utkast) skapat.`);

    // välj nya blocket direkt (snabbt resultat)
    STATE.discoveryActive = true;
    refreshLeftList();
    applyExportIndicator();
    onSelectBlockId(newBlockId);

    // stäng exportboxen (städning sker i applyExportVisibility)
    STATE.exportOpen = false;
    applyExportVisibility();
    applyExportIndicator();

    setMsgSafe("Export klar. Nytt block är valt.");
  }

  // ---------- print ----------
  function printSelected() {
    if (!STATE.selectedId || !STATE.edited) return;
    const w = window.open("", "_blank");
    if (!w) { setMsgSafe("Popup blockerad. Tillåt popups för att skriva ut."); return; }
    const doc = w.document;
    doc.open();
    doc.write("<!doctype html><html><head><meta charset='utf-8'><title>Block</title></head><body></body></html>");
    doc.close();

    const pre = doc.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = JSON.stringify(stripComp(STATE.edited), null, 2);
    doc.body.appendChild(pre);

    w.focus();
    w.print();
  }

  // ---------- wiring ----------
  function wireEvents() {
    if (DOM.btnToggleInfo) {
      DOM.btnToggleInfo.addEventListener("click", function () {
        STATE.infoOpen = !STATE.infoOpen;
        if (DOM.introBox) DOM.introBox.style.display = STATE.infoOpen ? "block" : "none";
        DOM.btnToggleInfo.textContent = STATE.infoOpen ? "Dölj info" : "Visa info";
      });
    }

    if (DOM.qBlocks) {
      DOM.qBlocks.addEventListener("input", function () {
        STATE.discoveryActive = true;
        refreshLeftList();
      });
    }

    if (DOM.btnShowAllBlocks) {
      DOM.btnShowAllBlocks.addEventListener("click", function () {
        STATE.discoveryActive = true;
        if (DOM.qBlocks) DOM.qBlocks.value = "";
        refreshLeftList();
      });
    }

    const filterEls = [DOM.filterStatus, DOM.fHasQ, DOM.fHasD, DOM.fNoKey, DOM.fUnverified].filter(Boolean);
    filterEls.forEach((el) => el.addEventListener("change", refreshLeftList));

    if (DOM.btnSaveEdits) {
      DOM.btnSaveEdits.addEventListener("click", function () {
        if (STATE.edited) STATE.edited.status = "draft";
        const r = persistEditedBlock();
        setMsgSafe(r.ok ? "Sparat. (Som utkast)" : (`Kunde inte spara: ${r.err || "okänt fel"}`));
      });
    }

    if (DOM.btnVerify) {
      DOM.btnVerify.addEventListener("click", function () {
        const r = setVerifiedAndPersist();
        setMsgSafe(r.ok ? "Verifierat och sparat." : (`Verifiering stoppad: ${r.err || "okänt fel"}`));
      });
    }

    if (DOM.btnPublish) {
      DOM.btnPublish.addEventListener("click", function () {
        const r = setPublishedAndPersist();
        setMsgSafe(r.ok ? "Publicerat och sparat." : (`Publicering stoppad: ${r.err || "okänt fel"}`));
      });
    }

    if (DOM.btnPrint) {
      DOM.btnPrint.addEventListener("click", printSelected);
    }

    // Export toggle (+ update indicator)
    if (DOM.btnToggleExport && DOM.exportBody) {
      DOM.btnToggleExport.addEventListener("click", function () {
        STATE.exportOpen = !STATE.exportOpen;

        // PP-SC-002 + PP-SC-004: show/hide whole container (and cleanup on close)
        applyExportVisibility();

        // Text + aria + “nytt”-markering
        applyExportIndicator();

        // When opening: refresh the UI so it's always current
        if (STATE.exportOpen) refreshTrainingUI();
      });
    }

    // Export filters (PP-SC-004: endast modul)
    [DOM.qTrainModule].filter(Boolean).forEach((el) => {
      el.addEventListener("input", refreshTrainingUI);
      el.addEventListener("change", refreshTrainingUI);
    });

    // PP-SC-005: btnReloadTrainings används som “Stäng” (ingen reload)
    if (DOM.btnReloadTrainings) {
      DOM.btnReloadTrainings.addEventListener("click", function () {
        // stäng export + städning
        STATE.exportOpen = false;
        applyExportVisibility();
        applyExportIndicator();
        setMsgSafe("Stängd.");
      });
    }

    if (DOM.btnExportTraining) {
      DOM.btnExportTraining.addEventListener("click", exportSelectedTraining);
    }

    // Modal interactions (fail-safe if missing)
    if (modalAvailable()) {
      DOM.pbModalOverlay.addEventListener("click", function (e) {
        if (!STATE.modalOpen) return;
        if (e && e.target === DOM.pbModalOverlay) {
          if (!confirmLoseEditsIfNeeded()) return;
          revertEditsToSelected();
          closeModal(true);
        }
      });

      document.addEventListener("keydown", function (e) {
        if (!STATE.modalOpen) return;
        if (e && e.key === "Escape") {
          e.preventDefault();
          if (!confirmLoseEditsIfNeeded()) return;
          revertEditsToSelected();
          closeModal(true);
        }
      });

      const doCancel = function () {
        if (!confirmLoseEditsIfNeeded()) return;
        revertEditsToSelected();
        closeModal(true);
      };

      if (DOM.pbModalClose) DOM.pbModalClose.addEventListener("click", doCancel);
      if (DOM.pbModalCancel) DOM.pbModalCancel.addEventListener("click", doCancel);

      if (DOM.pbModalSave) {
        DOM.pbModalSave.addEventListener("click", function () {
          if (!STATE.canWrite) { setMsgSafe("Read-only: bara ADMIN kan spara."); return; }
          if (DOM.btnSaveEdits) DOM.btnSaveEdits.click();
          applyExportIndicator();
        });
      }
    }
  }

  function boot() {
    setMsgSafe("Startar kontrollrummet…");

    const missing = [];
    if (!store) missing.push("03-store.js");
    if (!render) missing.push("05-render.js");
    if (!core) missing.push("02-core.js");
    if (!contract) missing.push("04-contract.js");

    if (!DOM.btnToggleExport) missing.push("DOM#btnToggleExport (HTML)");
    if (!DOM.exportBody) missing.push("DOM#exportBody (HTML)");
    if (!DOM.qTrainModule) missing.push("DOM#qTrainModule (HTML)");

    if (missing.length) {
      showLock([`JS saknar delar: ${missing.join(", ")}`]);
      setMsgSafe("JS laddades delvis men saknar moduler/DOM. Kontrollera Console/Network.");
      return;
    }

    // PP-SC-005: repurpose reload button label to “Stäng” (om den finns)
    if (DOM.btnReloadTrainings) {
      DOM.btnReloadTrainings.textContent = "Stäng";
      DOM.btnReloadTrainings.setAttribute("aria-label", "Stäng export");
      DOM.btnReloadTrainings.title = "Stäng export";
    }

    // role
    const who = (core && typeof core.getRole === "function")
      ? core.getRole()
      : { role: "SYSTEM_ADMIN", empNo: "", canWrite: false };

    STATE.role = String(who.role || "SYSTEM_ADMIN").toUpperCase();
    STATE.empNo = String(who.empNo || "");
    // ADMIN-only write (MANAGER read-only här)
    STATE.canWrite = (STATE.role === "ADMIN");

    // Inkorg default: fUnverified ska vara på (fail-safe)
    if (DOM.fUnverified) DOM.fUnverified.checked = (DOM.fUnverified.checked !== false);

    // pills
    try {
      render.setWhoPill(`Inloggad: ${STATE.empNo || "—"} (${STATE.role})`);
      render.setModePill(STATE.canWrite ? "Edit: på" : "Read-only", STATE.canWrite ? "pill ok" : "pill warn");
      render.setStatePill("Status: OK", "pill ok");
      render.setSelectionPill("Val: —");
      render.setVerifyPill("Verifiering: —", "verifyPill warn", false);
      render.setTopEditing("—", false);
    } catch (_) {}

    // load blocks
    const r = store.loadBlocksState();
    if (!r.ok && r.corrupt) {
      showLock([store.lockReasonFor(store.BLOCKS_KEY), "Åtgärd: rensa/återställ AO-0XX_BLOCKS_V1 (korrupt JSON)."]);
      setMsgSafe("Låst (fail-closed): Blockbank är trasig.");
      if (DOM.btnVerify) DOM.btnVerify.disabled = true;
      if (DOM.btnPublish) DOM.btnPublish.disabled = true;
      if (DOM.btnSaveEdits) DOM.btnSaveEdits.disabled = true;
      if (DOM.pbModalSave) DOM.pbModalSave.disabled = true;
      return;
    }

    STATE.allBlocks = (r.blocks || []).map(normalizeBlock);
    STATE.discoveryActive = false; // search-first
    refreshLeftList();

    // default export closed + PP-SC-002: hide whole export container
    STATE.exportOpen = false;
    applyExportVisibility();
    applyExportIndicator();

    // trainings load
    loadTrainings();
    refreshTrainingUI();

    // wire
    wireEvents();

    setMsgSafe("Klart. Sök eller tryck “Visa alla”.");
    STATE.ready = true;
  }

  // Boot safely
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  } catch (e) {
    setMsgSafe(`JS-fel vid start: ${String((e && e.message) || e)}`);
  }

  NS.page = {
    boot: boot,
    state: STATE,
  };
})();
