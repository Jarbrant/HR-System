/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 06/06 | FIL-ID: UI/pages/packages-block/06-page.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Bootstrap + state + event wiring för Block-editor (packages-block)
Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell
- XSS-safe rendering: all render via 05-render.js (textContent, inga osäkra innerHTML)
- SYSTEM_ADMIN = steward/read-only

PATCH v1.0.2 (P0-fix + Inkorg-läge, ingen redesign):
- P0: publish/verify-status förstördes av persistEditedBlock() som alltid tvingade status=draft.
      Nu: persist sparar "som det står", och "Spara ändringar" sätter draft explicit.
- Inkorg: säkrar default att "Ej verifierade" är påslaget vid boot (fail-safe även om HTML missar checked).
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

    // export/training UI
    btnToggleExport: byId("btnToggleExport"),
    exportBody: byId("exportBody"),
    qTrainModule: byId("qTrainModule"),
    qTrainArea: byId("qTrainArea"),
    dlTrainAreas: byId("dlTrainAreas"),
    qTrainFree: byId("qTrainFree"),
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
  };

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

  function normalizeItem(raw) {
    const it = raw && typeof raw === "object" ? raw : {};
    const kind = String(it.kind || "document");
    if (kind === "question") {
      // Accept: {options:[...], answerKey:"..."} OR {choices:[{id,text}], answerKeyObj:{correctChoiceId,rationale}}
      return {
        kind: "question",
        questionId: normStr(it.questionId) || normStr(it.id) || "",
        text: normStr(it.text) || "",
        requiresAnswer: it.requiresAnswer !== false,
        answerType: normStr(it.answerType) || "choice",
        options: Array.isArray(it.options) ? it.options.map((x) => normStr(x)).filter(Boolean) : [],
        answerKey: normStr(it.answerKey) || "",
        // legacy strict fields (if present)
        choices: Array.isArray(it.choices) ? it.choices : undefined,
        answerKeyObj: it.answerKeyObj && typeof it.answerKeyObj === "object" ? it.answerKeyObj : undefined,
      };
    }
    if (kind === "task") {
      return {
        kind: "task",
        taskId: normStr(it.taskId) || "",
        text: normStr(it.text) || "",
        instruction: normStr(it.instruction) || "",
        deliverable: normStr(it.deliverable) || "",
        requiresDone: it.requiresDone !== false,
        answerType: normStr(it.answerType) || "checkbox",
      };
    }
    // document
    return {
      kind: "document",
      text: normStr(it.text) || "",
      requiresSign: !!it.requiresSign,
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

        // item patch (befintlig)
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

        // meta patch (NY)
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

        // add/remove/move item (NY – valfritt för render att använda)
        onAddItem: function (kind, afterIdx) {
          if (!STATE.canWrite) return;
          const k = String(kind || "document");
          applyEditedBlockChange(function (draft) {
            const items = Array.isArray(draft.items) ? draft.items.slice() : [];
            const base =
              k === "question" ? { kind: "question", text: "", options: ["Alternativ 1", "Alternativ 2"], answerKey: "" } :
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
  }

  // ---------- persistence ----------
  function persistEditedBlock() {
    if (!STATE.edited || !STATE.selectedId) return { ok: false, err: "Inget block valt." };
    const idx = STATE.allBlocks.findIndex((b) => b.blockId === STATE.selectedId);
    if (idx < 0) return { ok: false, err: "Block hittades inte i listan." };

    // P0: spara exakt som STATE.edited säger (status/verified etc)
    const next = deepClone(STATE.edited);
    next.updatedAt = nowTs();
    next.__comp = countComposition(next);

    STATE.allBlocks[idx] = normalizeBlock(next);
    const save = store.saveBlocks(STATE.allBlocks.map(stripComp));
    if (!save.ok) return save;

    // refresh selection from source-of-truth array
    STATE.selected = STATE.allBlocks[idx];
    STATE.edited = deepClone(STATE.selected);
    setDirty(false);
    refreshLeftList();
    updateRightPanel();
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
    // Tolerant: items directly OR blocks[].items
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
    // build module dropdown
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

    // build area datalist
    if (DOM.dlTrainAreas) {
      clearChildren(DOM.dlTrainAreas);
      const areas = new Set();
      for (const tr of STATE.trainings) {
        const a = normStr(tr && tr.area);
        if (a) areas.add(a);
      }
      Array.from(areas).sort().slice(0, 200).forEach((a) => {
        const o = document.createElement("option");
        o.value = a;
        DOM.dlTrainAreas.appendChild(o);
      });
    }

    // hits
    const m = normStr(DOM.qTrainModule && DOM.qTrainModule.value);
    const a = normStr(DOM.qTrainArea && DOM.qTrainArea.value).toLowerCase();
    const f = normStr(DOM.qTrainFree && DOM.qTrainFree.value).toLowerCase();

    const hits = [];
    for (let i = 0; i < STATE.trainings.length; i++) {
      const tr = STATE.trainings[i];
      const meta = extractTrainingMeta(tr, i);
      if (m && meta.module !== m) continue;
      if (a && !meta.area.toLowerCase().includes(a)) continue;
      if (f && !meta.title.toLowerCase().includes(f)) continue;
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
          STATE.trainSelIndex = Number(index);
          refreshTrainingUI();
          const found = hits.find((h) => h.index === STATE.trainSelIndex);
          if (found && render && typeof render.renderExportPreview === "function") {
            render.renderExportPreview({ items: found.items });
          }
          if (DOM.btnExportTraining) DOM.btnExportTraining.disabled = !(STATE.canWrite && found && found.itemsCount > 0);
        },
      });
    }

    // hint
    if (render && typeof render.setTrainExportHint === "function") {
      render.setTrainExportHint(
        STATE.canWrite
          ? "Välj en utbildning i listan ovan. Export skapar 1 nytt block (utkast)."
          : "Read-only: du kan inte exportera i SYSTEM_ADMIN-läge."
      );
    }

    if (DOM.btnExportTraining) {
      const found = hits.find((h) => h.index === STATE.trainSelIndex);
      DOM.btnExportTraining.disabled = !(STATE.canWrite && found && found.itemsCount > 0);
    }
  }

  function exportSelectedTraining() {
    const hit = STATE.trainHits.find((h) => h.index === STATE.trainSelIndex);
    if (!hit) { setMsgSafe("Välj en utbildning först."); return; }
    if (!STATE.canWrite) { setMsgSafe("Read-only: SYSTEM_ADMIN kan inte exportera."); return; }
    if (!hit.items || !hit.items.length) { setMsgSafe("Utbildningen saknar items att exportera."); return; }

    const ts = nowTs();
    const newBlock = normalizeBlock({
      blockId: `b_${ts}`,
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
    if (!save.ok) { setMsgSafe(`Kunde inte exportera: ${save.err || "okänt fel"}`); return; }

    STATE.discoveryActive = true; // så användaren ser blocket
    refreshLeftList();
    setMsgSafe("Export klar. Sök eller tryck “Visa alla” och välj det nya blocket.");
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
        // "Spara ändringar" = spara som utkast (men förstör inte publish/verify-flödet)
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

    // Export toggle
    if (DOM.btnToggleExport && DOM.exportBody) {
      DOM.btnToggleExport.addEventListener("click", function () {
        STATE.exportOpen = !STATE.exportOpen;
        DOM.exportBody.style.display = STATE.exportOpen ? "block" : "none";
        DOM.btnToggleExport.setAttribute("aria-expanded", STATE.exportOpen ? "true" : "false");
        DOM.btnToggleExport.textContent = STATE.exportOpen ? "Dölj" : "Visa";
      });
    }

    // Export filters
    [DOM.qTrainModule, DOM.qTrainArea, DOM.qTrainFree].filter(Boolean).forEach((el) => {
      el.addEventListener("input", refreshTrainingUI);
      el.addEventListener("change", refreshTrainingUI);
    });

    if (DOM.btnReloadTrainings) {
      DOM.btnReloadTrainings.addEventListener("click", function () {
        loadTrainings();
        refreshTrainingUI();
        setMsgSafe("Utbildningar uppdaterade.");
      });
    }

    if (DOM.btnExportTraining) {
      DOM.btnExportTraining.addEventListener("click", exportSelectedTraining);
    }
  }

  function boot() {
    // Always set message quickly so HTML watchdog won't fire
    setMsgSafe("Startar kontrollrummet…");

    // dependency sanity
    const missing = [];
    if (!store) missing.push("03-store.js");
    if (!render) missing.push("05-render.js");
    if (!core) missing.push("02-core.js");
    if (!contract) missing.push("04-contract.js");
    if (missing.length) {
      showLock([`JS saknar delar: ${missing.join(", ")}`]);
      setMsgSafe("JS laddades delvis men saknar moduler. Kontrollera Console.");
      return;
    }

    // role
    const who = (core && typeof core.getRole === "function")
      ? core.getRole()
      : { role: "SYSTEM_ADMIN", empNo: "", canWrite: false };

    STATE.role = String(who.role || "SYSTEM_ADMIN").toUpperCase();
    STATE.empNo = String(who.empNo || "");
    STATE.canWrite = !!who.canWrite;

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
      return;
    }

    STATE.allBlocks = (r.blocks || []).map(normalizeBlock);
    STATE.discoveryActive = false; // search-first
    refreshLeftList();

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
