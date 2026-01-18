/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 05/06 | FIL-ID: UI/pages/packages-block/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render/UI (XSS-safe) för packages-block: listor, export, vald block-editor
Policy (LÅST):
- UI-only • Fail-closed
- XSS-safe: textContent, inga osäkra innerHTML
- Ingen storage här (bara UI)
- Behåller befintliga DOM-id/hooks (HTML styr)

PATCH v1.1.1 (PATCHPAKET v1.1 – kontrakt, modal-stöd, ADMIN-only i 06):
- P0: Inga syntaxrester/”skräprader”
- Lägger till render.setExportIndicator({hasNew,countNew}) (06 har fallback om den saknas)
- Robust rendering: blocklist, exportlist, preview, editor (meta + items) med callbacks

PATCH v1.1.2 (PP-SC-005 – Inkorg-export: kvittens + rätt copy):
- P1: Tar bort “sök”-copy i inkorgen (no hits) → matchar förenklad inkorg (endast modulfilter)
- P1: Lägger till render.setTrainExportNotice(kind,text) för grön/röd kvittens direkt i inkorgen

PATCH v1.1.3 (PP-SC-006 – Mindre brus efter val i export):
- P1: Dölj Items-count i exportlistan när vald (visa “Vald”)
- P1: Dölj/Collapse preview-panel när en export-rad är vald (UI-detektion av .exportRow.active)

PATCH v1.2.0 (PP-SC-007 – Modal “Word”-redigering för Fråga/Svar + inga rå-preview i inkorg):
- P0: Fråga: visa fråga + 3–5 alternativ + radio (exakt 1 rätt), allt synligt samtidigt
- P0: Stöd både nya frågor (options+answerKey) och legacy (choices+answerKeyObj.correctChoiceId) utan datatapp
- P1: Meta-rad överst i modalen: Modul • Område • Titel • Steg • blockId
- P1: Inkorg: renderExportPreview gör ingen rå-preview (döljer trainPreviewDetail) som standard
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.render) return; // idempotent

  function byId(id) { return document.getElementById(String(id || "")); }

  const DOM = {
    // pills/header
    statePill: byId("statePill"),
    selPill: byId("selPill"),
    whoPill: byId("whoPill"),
    modePill: byId("modePill"),
    verifyPill: byId("verifyPill"),
    topEditing: byId("topEditing"),
    topEditingText: byId("topEditingText"),

    // messages/lock
    msgBox: byId("msgBox"),
    lockBox: byId("lockBox"),

    // left list
    blockList: byId("blockList"),
    countBlocks: byId("countBlocks"),

    // export UI
    trainPreview: byId("trainPreview"),
    trainPreviewDetail: byId("trainPreviewDetail"),
    trainExportHint: byId("trainExportHint"),
    btnToggleExport: byId("btnToggleExport"),

    // selected
    selHint: byId("selHint"),
    selDetail: byId("selDetail"),
  };

  // -------------------------
  // tiny DOM helpers (XSS-safe)
  // -------------------------
  function el(tag, attrs) {
    const n = document.createElement(String(tag || "div"));
    const a = attrs && typeof attrs === "object" ? attrs : null;
    if (a) {
      for (const k of Object.keys(a)) {
        const v = a[k];
        if (v === undefined || v === null) continue;
        if (k === "class") n.className = String(v);
        else if (k === "text") n.textContent = String(v);
        else if (k === "html") {
          // Policy: no innerHTML. Ignore.
        } else if (k === "dataset" && v && typeof v === "object") {
          for (const dk of Object.keys(v)) n.dataset[String(dk)] = String(v[dk]);
        } else if (k.startsWith("aria-")) n.setAttribute(k, String(v));
        else n.setAttribute(String(k), String(v));
      }
    }
    return n;
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setText(node, text) {
    if (!node) return;
    node.textContent = String(text ?? "");
  }

  function fmtTs(ts) {
    const n = Number(ts || 0);
    if (!n) return "—";
    try {
      const d = new Date(n);
      return d.toLocaleString("sv-SE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (_) {
      return String(n);
    }
  }

  function compBadge(comp) {
    const c = comp && typeof comp === "object" ? comp : {};
    const q = Number(c.q || 0) || 0;
    const d = Number(c.d || 0) || 0;
    const t = Number(c.t || 0) || 0;
    const mk = Number(c.missingKey || 0) || 0;
    const it = Number(c.items || 0) || 0;
    return { q, d, t, mk, it };
  }

  function normStr(v) { return String(v ?? "").trim(); }

  // -------------------------
  // pills + top
  // -------------------------
  function setPill(node, text, className, show) {
    if (!node) return;
    if (typeof show === "boolean") node.style.display = show ? "inline-flex" : "none";
    if (className) node.className = String(className);
    setText(node, text);
  }

  function setStatePill(text, className) { setPill(DOM.statePill, text, className || "pill", true); }
  function setSelectionPill(text) { setPill(DOM.selPill, text, "pill", true); }
  function setWhoPill(text) { setPill(DOM.whoPill, text, "pill", true); }
  function setModePill(text, className) { setPill(DOM.modePill, text, className || "pill", true); }

  function setVerifyPill(text, className, show) {
    if (!DOM.verifyPill) return;
    DOM.verifyPill.className = String(className || "verifyPill warn");
    setText(DOM.verifyPill, text);
    DOM.verifyPill.style.display = show ? "inline-flex" : "none";
  }

  function setTopEditing(text, show) {
    if (!DOM.topEditing) return;
    DOM.topEditing.style.display = show ? "inline-flex" : "none";
    if (DOM.topEditingText) setText(DOM.topEditingText, text || "—");
  }

  // -------------------------
  // msg + lock
  // -------------------------
  function setMsg(kind, text) {
    // kind kept for future, but we do minimal UI now
    if (!DOM.msgBox) return;
    const t = String(text || "");
    DOM.msgBox.style.display = t ? "block" : "none";
    setText(DOM.msgBox, t);
  }

  function showLockBox(lines) {
    if (!DOM.lockBox) return;
    const arr = Array.isArray(lines) ? lines.filter(Boolean).map((x) => String(x)) : [];
    DOM.lockBox.style.display = arr.length ? "block" : "none";
    clear(DOM.lockBox);
    if (!arr.length) return;

    // Render as list (safe)
    const ul = el("ul");
    for (const line of arr) ul.appendChild(el("li", { text: line }));
    DOM.lockBox.appendChild(ul);
  }

  // -------------------------
  // export indicator (optional helper for 06)
  // -------------------------
  function setExportIndicator(meta) {
    if (!DOM.btnToggleExport) return;
    const m = meta && typeof meta === "object" ? meta : {};
    const hasNew = !!m.hasNew;
    const countNew = Number(m.countNew || 0) || 0;

    // Don’t fight 06’s open/close text too hard; just add hint+title.
    try {
      DOM.btnToggleExport.title = hasNew ? (`Det finns ${countNew} nya/ej verifierade block.`) : "Visa export";
    } catch (_) {}

    // Small class hint if your CSS supports it (safe no-op otherwise)
    try {
      DOM.btnToggleExport.className = "miniBtn" + (hasNew ? " ok" : "");
    } catch (_) {}
  }

  // -------------------------
  // block list (left)
  // -------------------------
  function renderBlockList(payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const allCount = Number(p.allCount || 0) || 0;
    const visible = Array.isArray(p.visible) ? p.visible : [];
    const selectedId = String(p.selectedBlockId || "");
    const onSelect = typeof p.onSelect === "function" ? p.onSelect : null;

    if (DOM.countBlocks) {
      const v = visible.length;
      setText(DOM.countBlocks, `Visar ${v} av ${allCount}`);
    }

    if (!DOM.blockList) return;
    clear(DOM.blockList);

    if (!visible.length) {
      const note = el("div", { class: "muted2", text: "Inga block att visa. Sök eller tryck “Visa alla”." });
      DOM.blockList.appendChild(note);
      return;
    }

    for (const b of visible) {
      const bid = String(b && b.blockId ? b.blockId : "");
      const title = String(b && b.title ? b.title : "(utan rubrik)");
      const module = String(b && b.module ? b.module : "");
      const area = String(b && b.area ? b.area : "");
      const step = String(b && b.step ? b.step : "");
      const status = String(b && b.status ? b.status : "draft");
      const comp = compBadge(b && b.__comp);

      const row = el("div", { class: "rowItem" + (bid && bid === selectedId ? " active" : "") });
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");

      const top = el("div", { class: "rowTop" });
      const left = el("div", { style: "min-width:0;" });
      left.appendChild(el("div", { class: "rowTitle", text: title }));
      left.appendChild(el("div", {
        class: "tiny muted2",
        text: `${module || "—"} • ${area || "—"} • ${step || "—"}`
      }));
      const right = el("div", { class: "tiny muted2", text: status === "published" ? "Publicerad" : "Utkast" });

      top.appendChild(left);
      top.appendChild(right);

      const meta = el("div", { class: "qaLine" });
      meta.appendChild(el("span", { class: "qaPill", text: `ID: ${bid || "—"}` }));
      meta.appendChild(el("span", { class: "qaPill", text: `Items: ${comp.it}` }));
      meta.appendChild(el("span", { class: "qaPill", text: `❓ ${comp.q}` }));
      meta.appendChild(el("span", { class: "qaPill", text: `✅ ${comp.t}` }));
      meta.appendChild(el("span", { class: "qaPill", text: `📄 ${comp.d}` }));
      if (comp.mk > 0) meta.appendChild(el("span", { class: "qaPill bad", text: `Saknar facit: ${comp.mk}` }));
      if (Number(b && b.verifiedAt || 0) <= 0) meta.appendChild(el("span", { class: "qaPill warn", text: "Ej verifierad" }));
      else meta.appendChild(el("span", { class: "qaPill ok", text: `Verifierad: ${fmtTs(b.verifiedAt)}` }));

      row.appendChild(top);
      row.appendChild(meta);

      const pick = function () { if (onSelect && bid) onSelect(bid); };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", function (e) {
        if (!e) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });

      DOM.blockList.appendChild(row);
    }
  }

  // -------------------------
  // trainings list + preview (export)
  // -------------------------
  function renderTrainingHits(payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const hits = Array.isArray(p.hits) ? p.hits : [];
    const onPick = typeof p.onPickTraining === "function" ? p.onPickTraining : null;
    const corrupt = !!p.corrupt;
    const missing = !!p.missing;

    if (!DOM.trainPreview) return;
    clear(DOM.trainPreview);

    if (corrupt) {
      DOM.trainPreview.appendChild(el("div", { class: "lockbox", text: "Utbildningsdata är korrupt (fail-closed). Öppna trainings-sidan och åtgärda." }));
      return;
    }
    if (missing) {
      DOM.trainPreview.appendChild(el("div", { class: "muted2", text: "Hittar ingen trainings-bank ännu (AO-057_TRAININGS_V1 saknas)." }));
      return;
    }
    if (!hits.length) {
      // PP-SC-004/005: ingen “sök” här längre → copy matchar modulfilter
      DOM.trainPreview.appendChild(el("div", { class: "muted2", text: "Inga utbildningar att visa för valt modulfilter." }));
      return;
    }

    for (const h of hits) {
      const idx = Number(h && h.index);
      const title = String(h && h.title ? h.title : "Utbildning");
      const module = String(h && h.module ? h.module : "");
      const area = String(h && h.area ? h.area : "");
      const step = String(h && h.step ? h.step : "");
      const itemsCount = Number(h && h.itemsCount || 0) || 0;
      const active = !!h.active;

      const row = el("div", { class: "exportRow" + (active ? " active" : "") });
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");

      const left = el("div", { class: "left" });
      left.appendChild(el("div", { class: "t", text: title }));
      left.appendChild(el("div", { class: "tiny muted2 s", text: `${module || "—"} • ${area || "—"} • ${step || "—"}` }));

      // PP-SC-006: när vald → visa inte Items-count (mindre brus)
      const rightText = active ? "Vald" : `Items: ${itemsCount}`;
      const right = el("div", { class: "tiny muted2", text: rightText });

      row.appendChild(left);
      row.appendChild(right);

      const pick = function () { if (onPick && Number.isFinite(idx)) onPick(idx); };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", function (e) {
        if (!e) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });

      DOM.trainPreview.appendChild(row);
    }
  }

  // PP-SC-007: Inkorg ska inte visa rå preview/JSON.
  // Vi döljer trainPreviewDetail som standard (06 kan fortfarande kalla funktionen).
  function renderExportPreview(payload) {
    (void payload); // keep signature stable
    if (!DOM.trainPreviewDetail) return;
    try {
      clear(DOM.trainPreviewDetail);
      DOM.trainPreviewDetail.style.display = "none";
    } catch (_) {}
  }

  function setTrainExportHint(text) {
    if (!DOM.trainExportHint) return;
    setText(DOM.trainExportHint, text || "");
  }

  // PP-SC-005: grön/röd kvittens i inkorgen (utan att kräva CSS-ändring)
  function setTrainExportNotice(kind, text) {
    if (!DOM.trainExportHint) return;

    const k = String(kind || "info");
    const t = String(text || "");

    // Reset baseline first (fail-safe)
    try {
      DOM.trainExportHint.style.border = "";
      DOM.trainExportHint.style.background = "";
      DOM.trainExportHint.style.color = "";
      DOM.trainExportHint.style.fontWeight = "";
    } catch (_) {}

    if (k === "ok") {
      try {
        DOM.trainExportHint.style.border = "1px solid rgba(16,185,129,.35)";
        DOM.trainExportHint.style.background = "rgba(209,250,229,.55)";
        DOM.trainExportHint.style.color = "#065f46";
        DOM.trainExportHint.style.fontWeight = "700";
      } catch (_) {}
      setText(DOM.trainExportHint, t || "✅ Klart.");
      return;
    }

    if (k === "bad") {
      try {
        DOM.trainExportHint.style.border = "1px solid rgba(239,68,68,.35)";
        DOM.trainExportHint.style.background = "rgba(254,226,226,.55)";
        DOM.trainExportHint.style.color = "#7f1d1d";
        DOM.trainExportHint.style.fontWeight = "700";
      } catch (_) {}
      setText(DOM.trainExportHint, t || "❌ Kunde inte exportera.");
      return;
    }

    // info/default
    setText(DOM.trainExportHint, t);
  }

  // -------------------------
  // selected detail editor (PP-SC-007)
  // -------------------------
  function renderSelectedDetail(payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const block = p.block && typeof p.block === "object" ? p.block : null;
    const canEdit = !!p.canEdit;
    const reasons = Array.isArray(p.validationReasons) ? p.validationReasons : [];

    const onPatchItem = typeof p.onPatchItem === "function" ? p.onPatchItem : null;
    const onPatchMeta = typeof p.onPatchMeta === "function" ? p.onPatchMeta : null;

    const onAddItem = typeof p.onAddItem === "function" ? p.onAddItem : null;
    const onRemoveItem = typeof p.onRemoveItem === "function" ? p.onRemoveItem : null;
    const onMoveItem = typeof p.onMoveItem === "function" ? p.onMoveItem : null;

    if (!DOM.selDetail) return;
    clear(DOM.selDetail);

    if (!block) {
      if (DOM.selHint) setText(DOM.selHint, "Välj ett block i vänsterlistan för att se frågor + facit.");
      DOM.selDetail.appendChild(el("div", { class: "muted2", text: "Ingen block valt." }));
      return;
    }

    if (DOM.selHint) setText(DOM.selHint, canEdit ? "Redigera i modal/panelen. Spara som utkast." : "Read-only här. Endast ADMIN får redigera block.");

    // --- "Word"-wrapper (CSS-agnostisk) ---
    const docWrap = el("div", { class: "wordDoc" });

    // --- Meta line (readable, one glance) ---
    const metaLine = el("div", { class: "muted2", text: `Modul: ${block.module || "—"} • Område: ${block.area || "—"} • Titel: ${block.title || "—"} • Steg: ${block.step || "—"} • blockId: ${block.blockId || "—"}` });
    docWrap.appendChild(metaLine);

    // --- Meta edit section (kept) ---
    const meta = el("div", { class: "itemCard" });
    meta.appendChild(el("div", { class: "fieldLbl", text: "Rubrik" }));

    const inpTitle = el("input", { class: "input", type: "text" });
    inpTitle.value = String(block.title || "");
    inpTitle.disabled = !canEdit;
    inpTitle.addEventListener("input", function () {
      if (!canEdit || !onPatchMeta) return;
      const v = inpTitle.value;
      onPatchMeta(function (draft) { draft.title = v; return draft; });
    });
    meta.appendChild(inpTitle);

    meta.appendChild(el("div", { class: "fieldLbl", text: "Modul" }));
    const inpModule = el("input", { class: "input", type: "text" });
    inpModule.value = String(block.module || "");
    inpModule.disabled = !canEdit;
    inpModule.addEventListener("input", function () {
      if (!canEdit || !onPatchMeta) return;
      const v = inpModule.value;
      onPatchMeta(function (draft) { draft.module = v; return draft; });
    });
    meta.appendChild(inpModule);

    meta.appendChild(el("div", { class: "fieldLbl", text: "Område" }));
    const inpArea = el("input", { class: "input", type: "text" });
    inpArea.value = String(block.area || "");
    inpArea.disabled = !canEdit;
    inpArea.addEventListener("input", function () {
      if (!canEdit || !onPatchMeta) return;
      const v = inpArea.value;
      onPatchMeta(function (draft) { draft.area = v; return draft; });
    });
    meta.appendChild(inpArea);

    meta.appendChild(el("div", { class: "fieldLbl", text: "Steg" }));
    const inpStep = el("input", { class: "input", type: "text" });
    inpStep.value = String(block.step || "");
    inpStep.disabled = !canEdit;
    inpStep.addEventListener("input", function () {
      if (!canEdit || !onPatchMeta) return;
      const v = inpStep.value;
      onPatchMeta(function (draft) { draft.step = v; return draft; });
    });
    meta.appendChild(inpStep);

    docWrap.appendChild(meta);

    // Add item controls (optional)
    if (canEdit && onAddItem) {
      const addRow = el("div", { class: "qaLine" });
      const addDoc = el("button", { class: "optBtn", type: "button", text: "➕ Dokument" });
      const addQ = el("button", { class: "optBtn", type: "button", text: "➕ Fråga" });
      const addT = el("button", { class: "optBtn", type: "button", text: "➕ Uppgift" });
      addDoc.addEventListener("click", function () { onAddItem("document"); });
      addQ.addEventListener("click", function () { onAddItem("question"); });
      addT.addEventListener("click", function () { onAddItem("task"); });
      addRow.appendChild(addDoc);
      addRow.appendChild(addQ);
      addRow.appendChild(addT);
      docWrap.appendChild(addRow);
    }

    // Items section
    const items = Array.isArray(block.items) ? block.items : [];
    if (!items.length) {
      docWrap.appendChild(el("div", { class: "muted2", text: "Blocket har inga items ännu." }));
    }

    // Helper: compute question source + correct selection
    function analyzeQuestionItem(it) {
      const q = it && typeof it === "object" ? it : {};
      const hasChoices = Array.isArray(q.choices) && q.choices.length > 0;
      const answerKey = normStr(q.answerKey);
      const correctChoiceId = normStr(q.answerKeyObj && q.answerKeyObj.correctChoiceId);

      if (hasChoices) {
        const choices = q.choices.slice();
        let correctIdx = -1;

        if (correctChoiceId) {
          correctIdx = choices.findIndex((c) => normStr(c && c.id) === correctChoiceId);
        }
        if (correctIdx < 0 && answerKey) {
          // fallback: match by text
          correctIdx = choices.findIndex((c) => normStr(c && c.text) === answerKey);
        }

        return { mode: "choices", choices, correctIdx };
      }

      // options mode
      const opts = Array.isArray(q.options) ? q.options.map((x) => String(x ?? "")) : [];
      let correctIdx2 = -1;
      if (answerKey) {
        correctIdx2 = opts.findIndex((o) => normStr(o) === answerKey);
      }
      return { mode: "options", options: opts, correctIdx: correctIdx2 };
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i] && typeof items[i] === "object" ? items[i] : {};
      const kind = String(it.kind || "document");

      const card = el("div", { class: "itemCard" });

      const top = el("div", { class: "itemRowTop" });
      const title =
        kind === "question" ? `❓ Fråga ${i + 1}` :
        kind === "task" ? `✅ Uppgift ${i + 1}` :
        `📄 Dokument ${i + 1}`;

      top.appendChild(el("div", { class: "tiny", text: title }));

      const btns = el("div", { style: "display:flex; gap:8px; flex-wrap:wrap;" });

      if (onMoveItem) {
        const up = el("button", { class: "optBtn", type: "button", text: "↑" });
        const dn = el("button", { class: "optBtn", type: "button", text: "↓" });
        up.disabled = !canEdit || i === 0;
        dn.disabled = !canEdit || i === items.length - 1;
        up.addEventListener("click", function () { if (canEdit) onMoveItem(i, "up"); });
        dn.addEventListener("click", function () { if (canEdit) onMoveItem(i, "down"); });
        btns.appendChild(up);
        btns.appendChild(dn);
      }

      if (onRemoveItem) {
        const rm = el("button", { class: "optBtn", type: "button", text: "Ta bort" });
        rm.disabled = !canEdit;
        rm.addEventListener("click", function () {
          if (!canEdit) return;
          try {
            if (window.confirm("Ta bort item?")) onRemoveItem(i);
          } catch (_) {
            onRemoveItem(i);
          }
        });
        btns.appendChild(rm);
      }

      top.appendChild(btns);
      card.appendChild(top);

      // Fields per kind
      if (kind === "question") {
        // --- Question text ---
        card.appendChild(el("div", { class: "fieldLbl", text: "Fråga" }));
        const taQ = el("textarea");
        taQ.value = String(it.text || "");
        taQ.disabled = !canEdit;
        taQ.addEventListener("input", function () {
          if (!canEdit || !onPatchItem) return;
          const v = taQ.value;
          onPatchItem(i, function (draftIt) { draftIt.text = v; return draftIt; });
        });
        card.appendChild(taQ);

        // --- Options/Choices + correct radio (3–5) ---
        const an = analyzeQuestionItem(it);

        card.appendChild(el("div", { class: "fieldLbl", text: "Svarsalternativ (3–5) • Markera exakt 1 rätt" }));

        const groupName = `pb_q_${block.blockId || "x"}_${i}`;

        // helper to render one row
        function renderAltRow(labelText, valueText, checked, onTextChange, onPickCorrect, disableDel) {
          const row = el("div", { class: "optRow" });
          row.style.display = "flex";
          row.style.gap = "8px";
          row.style.alignItems = "center";

          const radio = el("input", { type: "radio", name: groupName });
          radio.checked = !!checked;
          radio.disabled = !canEdit;
          radio.addEventListener("change", function () {
            if (!canEdit) return;
            onPickCorrect && onPickCorrect();
          });

          const inp = el("input", { class: "input", type: "text", value: String(valueText || "") });
          inp.disabled = !canEdit;
          inp.setAttribute("aria-label", labelText);
          inp.addEventListener("input", function () {
            if (!canEdit) return;
            onTextChange && onTextChange(inp.value);
          });

          row.appendChild(radio);
          row.appendChild(inp);

          // minimal +/- controls (no innerHTML)
          if (canEdit) {
            const delBtn = el("button", { class: "optBtn", type: "button", text: "−" });
            delBtn.disabled = !!disableDel;
            delBtn.title = disableDel ? "Minst 3 alternativ krävs." : "Ta bort alternativ";
            delBtn.addEventListener("click", function () {
              if (!canEdit) return;
              if (delBtn.disabled) return;
              // delete is handled by caller via onTextChange(null) pattern is not safe here; do explicit remove via onPatchItem
            });
            // caller may choose to not append delBtn and instead show global buttons; keep UI simple:
            // We will not attach per-row delete to avoid inconsistent indices.
            // (Del-knappen finns som global under listan.)
          }

          return row;
        }

        // Build visible list (do not destroy data if >5; show but lock add)
        if (an.mode === "choices") {
          const choices = Array.isArray(an.choices) ? an.choices.slice() : [];

          // ensure at least 3 choices (without inventing ids out of thin air unless user edits)
          // We'll render 3–max(choices.length,3) rows, but cap editing "add" to 5.
          const renderCount = Math.max(choices.length, 3);

          for (let oi = 0; oi < renderCount; oi++) {
            const c = choices[oi] && typeof choices[oi] === "object" ? choices[oi] : { id: `c${oi + 1}`, text: "" };
            const txt = String(c.text || "");
            const isCorrect = (an.correctIdx === oi);

            const row = el("div", { class: "optRow" });
            row.style.display = "flex";
            row.style.gap = "8px";
            row.style.alignItems = "center";

            const radio = el("input", { type: "radio", name: groupName });
            radio.checked = !!isCorrect;
            radio.disabled = !canEdit;
            radio.addEventListener("change", function () {
              if (!canEdit || !onPatchItem) return;
              const pickedId = normStr(c.id) || `c${oi + 1}`;
              onPatchItem(i, function (draftIt) {
                draftIt.answerKeyObj = draftIt.answerKeyObj && typeof draftIt.answerKeyObj === "object" ? draftIt.answerKeyObj : {};
                draftIt.answerKeyObj.correctChoiceId = pickedId;
                // compatibility: also set answerKey to text (if present)
                draftIt.answerKey = normStr(txt) || draftIt.answerKey || "";
                return draftIt;
              });
            });

            const inp = el("input", { class: "input", type: "text", value: txt });
            inp.disabled = !canEdit;
            inp.setAttribute("aria-label", `Alternativ ${oi + 1}`);
            inp.addEventListener("input", function () {
              if (!canEdit || !onPatchItem) return;
              const v = inp.value;
              onPatchItem(i, function (draftIt) {
                const arr = Array.isArray(draftIt.choices) ? draftIt.choices.slice() : [];
                while (arr.length < renderCount) arr.push({ id: `c${arr.length + 1}`, text: "" });
                const cur = arr[oi] && typeof arr[oi] === "object" ? arr[oi] : { id: `c${oi + 1}`, text: "" };
                cur.id = normStr(cur.id) || `c${oi + 1}`;
                cur.text = v;
                arr[oi] = cur;

                // if this option is currently correct, keep answerKey in sync
                const cid = normStr(draftIt.answerKeyObj && draftIt.answerKeyObj.correctChoiceId);
                if (cid && cid === cur.id) draftIt.answerKey = normStr(v);

                draftIt.choices = arr;
                return draftIt;
              });
            });

            row.appendChild(radio);
            row.appendChild(inp);
            card.appendChild(row);
          }

          // Controls: add/remove to keep within 3–5 for editing (but never auto-delete extras)
          const ctl = el("div", { class: "qaLine" });
          const info = el("div", { class: "tiny muted2", text: choices.length > 5 ? "Obs: Denna fråga har fler än 5 alternativ (legacy). Vi visar dem, men nya bör hållas 3–5." : "Tips: 3–5 alternativ rekommenderas." });
          ctl.appendChild(info);

          if (canEdit && onPatchItem) {
            const btnAdd = el("button", { class: "optBtn", type: "button", text: "➕ Lägg till alternativ" });
            btnAdd.disabled = (choices.length >= 5);
            btnAdd.addEventListener("click", function () {
              if (!canEdit || !onPatchItem) return;
              onPatchItem(i, function (draftIt) {
                const arr = Array.isArray(draftIt.choices) ? draftIt.choices.slice() : [];
                if (arr.length >= 5) return draftIt;
                arr.push({ id: `c${arr.length + 1}`, text: "" });
                draftIt.choices = arr;
                return draftIt;
              });
            });

            const btnDel = el("button", { class: "optBtn", type: "button", text: "➖ Ta bort sista" });
            btnDel.disabled = (choices.length <= 3);
            btnDel.addEventListener("click", function () {
              if (!canEdit || !onPatchItem) return;
              onPatchItem(i, function (draftIt) {
                const arr = Array.isArray(draftIt.choices) ? draftIt.choices.slice() : [];
                if (arr.length <= 3) return draftIt;
                const removed = arr.pop();
                // If removed was correct, clear correctChoiceId (contract will catch)
                const cid = normStr(draftIt.answerKeyObj && draftIt.answerKeyObj.correctChoiceId);
                if (cid && removed && normStr(removed.id) === cid) {
                  draftIt.answerKeyObj = draftIt.answerKeyObj && typeof draftIt.answerKeyObj === "object" ? draftIt.answerKeyObj : {};
                  draftIt.answerKeyObj.correctChoiceId = "";
                  draftIt.answerKey = "";
                }
                draftIt.choices = arr;
                return draftIt;
              });
            });

            ctl.appendChild(btnAdd);
            ctl.appendChild(btnDel);
          }

          card.appendChild(ctl);
        } else {
          // options + answerKey
          const opts = Array.isArray(an.options) ? an.options.slice() : [];

          // ensure at least 3 display rows
          const renderCount = Math.max(opts.length, 3);

          for (let oi = 0; oi < renderCount; oi++) {
            const txt = String(opts[oi] ?? "");
            const isCorrect = (an.correctIdx === oi);

            const row = el("div", { class: "optRow" });
            row.style.display = "flex";
            row.style.gap = "8px";
            row.style.alignItems = "center";

            const radio = el("input", { type: "radio", name: groupName });
            radio.checked = !!isCorrect;
            radio.disabled = !canEdit;
            radio.addEventListener("change", function () {
              if (!canEdit || !onPatchItem) return;
              onPatchItem(i, function (draftIt) {
                const arr = Array.isArray(draftIt.options) ? draftIt.options.slice() : [];
                while (arr.length < renderCount) arr.push("");
                const pickedText = normStr(arr[oi] ?? "");
                // Set answerKey to picked option text (exactly 1 right)
                draftIt.answerKey = pickedText;
                draftIt.options = arr;
                return draftIt;
              });
            });

            const inp = el("input", { class: "input", type: "text", value: txt });
            inp.disabled = !canEdit;
            inp.setAttribute("aria-label", `Alternativ ${oi + 1}`);
            inp.addEventListener("input", function () {
              if (!canEdit || !onPatchItem) return;
              const v = inp.value;
              onPatchItem(i, function (draftIt) {
                const arr = Array.isArray(draftIt.options) ? draftIt.options.slice() : [];
                while (arr.length < renderCount) arr.push("");
                arr[oi] = v;
                draftIt.options = arr;

                // keep answerKey consistent if this option is currently correct
                if (normStr(draftIt.answerKey) && normStr(draftIt.answerKey) === normStr(txt)) {
                  draftIt.answerKey = normStr(v);
                }
                return draftIt;
              });
            });

            row.appendChild(radio);
            row.appendChild(inp);
            card.appendChild(row);
          }

          const ctl = el("div", { class: "qaLine" });
          ctl.appendChild(el("div", { class: "tiny muted2", text: "Tips: Markera ett rätt svar (radio). Kontraktet kräver exakt 1 rätt." }));

          if (canEdit && onPatchItem) {
            const btnAdd = el("button", { class: "optBtn", type: "button", text: "➕ Lägg till alternativ" });
            btnAdd.disabled = (opts.length >= 5);
            btnAdd.addEventListener("click", function () {
              if (!canEdit || !onPatchItem) return;
              onPatchItem(i, function (draftIt) {
                const arr = Array.isArray(draftIt.options) ? draftIt.options.slice() : [];
                if (arr.length >= 5) return draftIt;
                arr.push("");
                draftIt.options = arr;
                return draftIt;
              });
            });

            const btnDel = el("button", { class: "optBtn", type: "button", text: "➖ Ta bort sista" });
            btnDel.disabled = (opts.length <= 3);
            btnDel.addEventListener("click", function () {
              if (!canEdit || !onPatchItem) return;
              onPatchItem(i, function (draftIt) {
                const arr = Array.isArray(draftIt.options) ? draftIt.options.slice() : [];
                if (arr.length <= 3) return draftIt;
                const removed = String(arr.pop() ?? "");
                // if removed was selected answerKey, clear answerKey (contract will catch)
                if (normStr(draftIt.answerKey) && normStr(draftIt.answerKey) === normStr(removed)) {
                  draftIt.answerKey = "";
                }
                draftIt.options = arr;
                return draftIt;
              });
            });

            ctl.appendChild(btnAdd);
            ctl.appendChild(btnDel);
          }

          card.appendChild(ctl);
        }

        // Small hint about legacy compatibility
        card.appendChild(el("div", { class: "tiny muted2", text: "Facit sparas som exakt 1 rätt svar. Systemet stöder både nya (options+answerKey) och legacy (choices+answerKeyObj) utan datatapp." }));
      } else if (kind === "task") {
        card.appendChild(el("div", { class: "fieldLbl", text: "Uppgiftstext" }));
        const taT = el("textarea");
        taT.value = String(it.text || "");
        taT.disabled = !canEdit;
        taT.addEventListener("input", function () {
          if (!canEdit || !onPatchItem) return;
          const v = taT.value;
          onPatchItem(i, function (draftIt) { draftIt.text = v; return draftIt; });
        });
        card.appendChild(taT);

        card.appendChild(el("div", { class: "fieldLbl", text: "Instruktion" }));
        const taI = el("textarea");
        taI.value = String(it.instruction || "");
        taI.disabled = !canEdit;
        taI.addEventListener("input", function () {
          if (!canEdit || !onPatchItem) return;
          const v = taI.value;
          onPatchItem(i, function (draftIt) { draftIt.instruction = v; return draftIt; });
        });
        card.appendChild(taI);

        card.appendChild(el("div", { class: "fieldLbl", text: "Leverans (deliverable)" }));
        const inpD = el("input", { class: "input", type: "text", value: String(it.deliverable || "") });
        inpD.disabled = !canEdit;
        inpD.addEventListener("input", function () {
          if (!canEdit || !onPatchItem) return;
          const v = inpD.value;
          onPatchItem(i, function (draftIt) { draftIt.deliverable = v; return draftIt; });
        });
        card.appendChild(inpD);
      } else {
        // document
        card.appendChild(el("div", { class: "fieldLbl", text: "Text" }));
        const taD = el("textarea");
        taD.value = String(it.text || "");
        taD.disabled = !canEdit;
        taD.addEventListener("input", function () {
          if (!canEdit || !onPatchItem) return;
          const v = taD.value;
          onPatchItem(i, function (draftIt) { draftIt.text = v; return draftIt; });
        });
        card.appendChild(taD);

        card.appendChild(el("div", { class: "tiny muted2", text: "Dokument ska ha text. Kontraktet stoppar verifiera/publicera om text saknas." }));
      }

      docWrap.appendChild(card);
    }

    // Validation reasons
    if (reasons.length) {
      const box = el("div", { class: "errList" });
      box.appendChild(el("div", { class: "h", text: "Problem (kontrakt):" }));
      const ul = el("ul");
      for (const r of reasons) ul.appendChild(el("li", { text: String(r) }));
      box.appendChild(ul);
      docWrap.appendChild(box);
    }

    DOM.selDetail.appendChild(docWrap);
  }

  // -------------------------
  // export
  // -------------------------
  NS.render = {
    __VERSION: "v1.2.0 (PP-SC-007)",

    // pills/top
    setStatePill,
    setSelectionPill,
    setWhoPill,
    setModePill,
    setVerifyPill,
    setTopEditing,

    // messages/lock
    setMsg,
    showLockBox,

    // lists
    renderBlockList,
    renderTrainingHits,
    renderExportPreview,
    setTrainExportHint,
    setTrainExportNotice, // PP-SC-005 helper

    // editor
    renderSelectedDetail,

    // optional helper for 06
    setExportIndicator,
  };
})();
