/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 05/06 | FIL-ID: UI/pages/packages-block/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render/UI (XSS-safe) för packages-block: listor, pills, export-preview, vald block-editor
Policy (LÅST):
- UI-only • Fail-closed
- XSS-safe: textContent, inga osäkra innerHTML
- Ingen storage här (bara UI)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.render) return; // idempotent

  // -----------------------------
  // DOM helpers (XSS-safe)
  // -----------------------------
  function byId(id) { return document.getElementById(String(id || "")); }

  function txt(el, s) {
    if (!el) return;
    el.textContent = String(s ?? "");
  }

  function clear(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function el(tag, attrs) {
    const n = document.createElement(tag);
    if (attrs && typeof attrs === "object") {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (k === "class") n.className = String(v || "");
        else if (k === "text") n.textContent = String(v ?? "");
        else if (k === "type") n.type = String(v || "");
        else if (k === "value") n.value = String(v ?? "");
        else if (k === "placeholder") n.placeholder = String(v ?? "");
        else if (k === "title") n.title = String(v ?? "");
        else if (k === "disabled") n.disabled = !!v;
        else if (k === "checked") n.checked = !!v;
        else if (k === "for") n.htmlFor = String(v ?? "");
        else if (k.startsWith("aria-")) n.setAttribute(k, String(v ?? ""));
        else n.setAttribute(k, String(v ?? ""));
      }
    }
    return n;
  }

  function rowKV(label, value) {
    const d = el("div", { class: "tiny" });
    const b = el("span", { text: label + ": " });
    b.style.fontWeight = "900";
    d.appendChild(b);
    d.appendChild(el("span", { text: String(value ?? "—") }));
    return d;
  }

  function clampInt(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, x));
  }

  function safeStr(v) { return String(v ?? "").trim(); }

  function getComp(b) {
    const c = b && b.__comp ? b.__comp : null;
    return c && typeof c === "object"
      ? {
          items: Number(c.items || 0) || 0,
          q: Number(c.q || 0) || 0,
          d: Number(c.d || 0) || 0,
          t: Number(c.t || 0) || 0,
          missingKey: Number(c.missingKey || 0) || 0
        }
      : { items: 0, q: 0, d: 0, t: 0, missingKey: 0 };
  }

  function kindEmoji(kind) {
    const k = String(kind || "");
    if (k === "question") return "❓";
    if (k === "task") return "✅";
    return "📄";
  }

  // -----------------------------
  // DOM refs (from HTML)
  // -----------------------------
  const DOM = {
    msgBox: byId("msgBox"),
    lockBox: byId("lockBox"),

    // pills
    statePill: byId("statePill"),
    selPill: byId("selPill"),
    whoPill: byId("whoPill"),
    modePill: byId("modePill"),
    verifyPill: byId("verifyPill"),

    // top selected
    topEditing: byId("topEditing"),
    topEditingText: byId("topEditingText"),

    // left list
    blockList: byId("blockList"),
    countBlocks: byId("countBlocks"),

    // right selected editor
    selDetail: byId("selDetail"),
    selHint: byId("selHint"),

    // export/training
    trainPreview: byId("trainPreview"),
    trainPreviewDetail: byId("trainPreviewDetail"),
    trainExportHint: byId("trainExportHint"),

    // modal shell (optional)
    pbModalOverlay: byId("pbModalOverlay"),
    pbModalBody: byId("pbModalBody"),
    pbModalTitle: byId("pbModalTitle"),
    pbModalSub: byId("pbModalSub"),
    pbModalClose: byId("pbModalClose"),
    pbModalCancel: byId("pbModalCancel"),
    pbModalSave: byId("pbModalSave"),
  };

  // -----------------------------
  // Msg / Lock
  // -----------------------------
  function setMsg(kind, message) {
    // kind unused here (kept for compatibility)
    if (!DOM.msgBox) return;
    const s = safeStr(message);
    txt(DOM.msgBox, s);
    DOM.msgBox.style.display = s ? "block" : "none";
  }

  function showLockBox(lines) {
    if (!DOM.lockBox) return;
    const arr = Array.isArray(lines) ? lines.filter(Boolean).map(String) : [];
    clear(DOM.lockBox);
    if (!arr.length) {
      DOM.lockBox.style.display = "none";
      return;
    }
    DOM.lockBox.style.display = "block";
    const ul = el("ul");
    for (const line of arr) {
      const li = el("li", { text: line });
      ul.appendChild(li);
    }
    DOM.lockBox.appendChild(ul);
  }

  // -----------------------------
  // Pills
  // -----------------------------
  function setStatePill(textVal, cls) {
    if (!DOM.statePill) return;
    txt(DOM.statePill, String(textVal ?? "Status: —"));
    if (cls) DOM.statePill.className = "pill " + String(cls).replace(/^pill\s*/i, "");
  }

  function setSelectionPill(textVal) {
    if (!DOM.selPill) return;
    txt(DOM.selPill, String(textVal ?? "Val: —"));
  }

  function setWhoPill(textVal) {
    if (!DOM.whoPill) return;
    DOM.whoPill.style.display = "inline-flex";
    txt(DOM.whoPill, String(textVal ?? "Inloggad: —"));
  }

  function setModePill(textVal, cls) {
    if (!DOM.modePill) return;
    DOM.modePill.style.display = "inline-flex";
    txt(DOM.modePill, String(textVal ?? "Läge: —"));
    if (cls) DOM.modePill.className = "pill " + String(cls).replace(/^pill\s*/i, "");
  }

  function setVerifyPill(textVal, cls, show) {
    if (!DOM.verifyPill) return;
    DOM.verifyPill.style.display = show ? "inline-flex" : "none";
    txt(DOM.verifyPill, String(textVal ?? "Verifiering: —"));
    if (cls) DOM.verifyPill.className = String(cls || "verifyPill warn");
  }

  function setTopEditing(textVal, show) {
    if (!DOM.topEditing || !DOM.topEditingText) return;
    DOM.topEditing.style.display = show ? "inline-flex" : "none";
    txt(DOM.topEditingText, String(textVal ?? "—"));
  }

  // -----------------------------
  // Left: block list
  // -----------------------------
  function renderBlockList(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const discoveryActive = !!o.discoveryActive;
    const allCount = Number(o.allCount || 0) || 0;
    const visible = Array.isArray(o.visible) ? o.visible : [];
    const selectedId = safeStr(o.selectedBlockId);
    const onSelect = typeof o.onSelect === "function" ? o.onSelect : function () {};

    if (DOM.countBlocks) {
      txt(DOM.countBlocks, `Hittat: ${visible.length} item(s)`);
    }

    if (!DOM.blockList) return;
    clear(DOM.blockList);

    if (!discoveryActive) {
      const m = el("div", { class: "muted2" });
      m.style.padding = "2px 0 10px";
      m.textContent = "Klart. Sök eller tryck “Visa alla”.";
      DOM.blockList.appendChild(m);
      if (!visible.length) {
        const mm = el("div", { class: "muted2", text: "Inga block hittade ännu." });
        DOM.blockList.appendChild(mm);
        return;
      }
    }

    if (!visible.length) {
      DOM.blockList.appendChild(el("div", { class: "muted2", text: "Inga träffar." }));
      return;
    }

    for (const b of visible) {
      const id = safeStr(b && b.blockId);
      const active = id && id === selectedId;

      const card = el("div", { class: "rowItem" + (active ? " active" : "") });
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "Välj block");
      card.addEventListener("click", function () { onSelect(id); });
      card.addEventListener("keydown", function (e) {
        const k = e && e.key ? e.key : "";
        if (k === "Enter" || k === " ") { e.preventDefault(); onSelect(id); }
      });

      const top = el("div", { class: "rowTop" });

      const left = el("div");
      const title = el("div", { class: "rowTitle", text: safeStr(b && b.title) || "(utan rubrik)" });
      left.appendChild(title);

      const meta = el("div", { class: "tiny muted2" });
      const module = safeStr(b && b.module) || "—";
      const area = safeStr(b && b.area) || "—";
      const step = safeStr(b && b.step) || "—";
      meta.appendChild(el("div", { text: `Modul: ${module}` }));
      meta.appendChild(el("div", { text: `Område: ${area}` }));
      meta.appendChild(el("div", { text: `Steg: ${step}` }));
      left.appendChild(meta);

      const right = el("div");
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.alignItems = "center";

      const status = String(b && b.status || "draft").toLowerCase() === "published" ? "Publicerad" : "Utkast";
      const sPill = el("span", { class: "qaPill " + (status === "Publicerad" ? "ok" : "warn"), text: status });
      right.appendChild(sPill);

      const comp = getComp(b);
      const unv = Number(b && b.verifiedAt || 0) <= 0;
      const vPill = el("span", { class: "qaPill " + (unv ? "warn" : "ok"), text: unv ? "Ej verifierad" : "Verifierad" });
      right.appendChild(vPill);

      top.appendChild(left);
      top.appendChild(right);
      card.appendChild(top);

      const qa = el("div", { class: "qaLine" });
      qa.appendChild(el("span", { class: "qaPill", text: `Hittat: ${comp.items} item(s)` }));

      const pillQ = el("span", { class: "qaPill", text: `❓ ${comp.q}` });
      const pillD = el("span", { class: "qaPill", text: `📄 ${comp.d}` });
      const pillT = el("span", { class: "qaPill", text: `✅ ${comp.t}` });
      qa.appendChild(pillQ);
      qa.appendChild(pillD);
      qa.appendChild(pillT);

      const pillMissing = el("span", { class: "qaPill " + (comp.missingKey > 0 ? "bad" : "ok"), text: `Saknar facit: ${comp.missingKey}` });
      qa.appendChild(pillMissing);

      card.appendChild(qa);

      DOM.blockList.appendChild(card);
    }
  }

  // -----------------------------
  // Right: trainings hits list
  // -----------------------------
  function renderTrainingHits(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const hits = Array.isArray(o.hits) ? o.hits : [];
    const corrupt = !!o.corrupt;
    const missing = !!o.missing;
    const onPick = typeof o.onPickTraining === "function" ? o.onPickTraining : function () {};

    if (!DOM.trainPreview) return;
    clear(DOM.trainPreview);

    if (missing) {
      DOM.trainPreview.appendChild(el("div", { class: "muted2", text: "Trainings saknas: ingen data hittades i AO-057_TRAININGS_V1." }));
      return;
    }
    if (corrupt) {
      DOM.trainPreview.appendChild(el("div", { class: "muted2", text: "Trainings är korrupt (fail-closed). Åtgärda i admin/trainings.html." }));
      return;
    }

    if (!hits.length) {
      DOM.trainPreview.appendChild(el("div", { class: "muted2", text: "Inga träffar." }));
      return;
    }

    for (const h of hits.slice(0, 50)) {
      const row = el("div", { class: "exportRow" + (h.active ? " active" : "") });
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.addEventListener("click", function () { onPick(h.index); });
      row.addEventListener("keydown", function (e) {
        const k = e && e.key ? e.key : "";
        if (k === "Enter" || k === " ") { e.preventDefault(); onPick(h.index); }
      });

      const left = el("div", { class: "left" });

      const t = el("div", { class: "t", text: safeStr(h.title) || "(utan titel)" });
      left.appendChild(t);

      const module = safeStr(h.module) || "—";
      const area = safeStr(h.area) || "—";
      const step = safeStr(h.step) || "—";

      const s = el("div", { class: "tiny muted2 s" });
      s.appendChild(el("div", { text: `Modul: ${module}` }));
      s.appendChild(el("div", { text: `Område: ${area}` }));
      s.appendChild(el("div", { text: `Steg: ${step}` }));
      s.appendChild(el("div", { text: `Items: ${Number(h.itemsCount || 0) || 0}` }));
      left.appendChild(s);

      const right = el("div");
      right.style.whiteSpace = "nowrap";
      right.appendChild(el("span", { class: "qaPill ok", text: h.active ? "Vald" : "Välj" }));

      row.appendChild(left);
      row.appendChild(right);

      DOM.trainPreview.appendChild(row);
    }
  }

  function renderExportPreview(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const items = Array.isArray(o.items) ? o.items : [];

    if (!DOM.trainPreviewDetail) return;
    clear(DOM.trainPreviewDetail);

    if (!items.length) {
      DOM.trainPreviewDetail.style.display = "none";
      return;
    }
    DOM.trainPreviewDetail.style.display = "block";

    const h = el("div", { class: "previewTitle", text: "Preview (items)" });
    DOM.trainPreviewDetail.appendChild(h);

    const pre = el("pre");
    pre.style.marginTop = "10px";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = JSON.stringify(items, null, 2);
    DOM.trainPreviewDetail.appendChild(pre);
  }

  function setTrainExportHint(textVal) {
    if (!DOM.trainExportHint) return;
    txt(DOM.trainExportHint, String(textVal ?? ""));
  }

  // -----------------------------
  // Right: selected detail editor (inline)
  // -----------------------------
  function renderSelectedDetail(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const block = o.block && typeof o.block === "object" ? o.block : null;
    const canEdit = !!o.canEdit;
    const reasons = Array.isArray(o.validationReasons) ? o.validationReasons : [];

    const onPatchMeta = typeof o.onPatchMeta === "function" ? o.onPatchMeta : function () {};
    const onPatchItem = typeof o.onPatchItem === "function" ? o.onPatchItem : function () {};
    const onAddItem = typeof o.onAddItem === "function" ? o.onAddItem : function () {};
    const onRemoveItem = typeof o.onRemoveItem === "function" ? o.onRemoveItem : function () {};
    const onMoveItem = typeof o.onMoveItem === "function" ? o.onMoveItem : function () {};

    if (!DOM.selDetail) return;
    clear(DOM.selDetail);

    if (!block) {
      if (DOM.selHint) txt(DOM.selHint, "Välj ett block i vänsterlistan för att se frågor + facit.");
      DOM.selDetail.appendChild(el("div", { class: "muted2", text: "Inget block valt." }));
      return;
    }
    if (DOM.selHint) txt(DOM.selHint, "Valt block är laddat. Redigera och spara.");

    // META FORM
    const metaCard = el("div", { class: "selPanel" });
    metaCard.style.margin = "0";
    metaCard.style.padding = "10px";

    metaCard.appendChild(el("div", { class: "fieldLbl", text: "Rubrik" }));
    const inTitle = el("input", { class: "input", type: "text", value: safeStr(block.title), disabled: !canEdit });
    inTitle.addEventListener("input", function () {
      onPatchMeta(function (draft) { draft.title = inTitle.value; return draft; });
    });
    metaCard.appendChild(inTitle);

    const row2 = el("div");
    row2.style.display = "grid";
    row2.style.gridTemplateColumns = "1fr 1fr";
    row2.style.gap = "10px";
    row2.style.marginTop = "10px";

    const col1 = el("div");
    col1.appendChild(el("div", { class: "fieldLbl", text: "Modul" }));
    const inModule = el("input", { class: "input", type: "text", value: safeStr(block.module), disabled: !canEdit });
    inModule.addEventListener("input", function () {
      onPatchMeta(function (draft) { draft.module = inModule.value; return draft; });
    });
    col1.appendChild(inModule);

    const col2 = el("div");
    col2.appendChild(el("div", { class: "fieldLbl", text: "Område" }));
    const inArea = el("input", { class: "input", type: "text", value: safeStr(block.area), disabled: !canEdit });
    inArea.addEventListener("input", function () {
      onPatchMeta(function (draft) { draft.area = inArea.value; return draft; });
    });
    col2.appendChild(inArea);

    row2.appendChild(col1);
    row2.appendChild(col2);
    metaCard.appendChild(row2);

    metaCard.appendChild(el("div", { class: "fieldLbl", text: "Steg" }));
    const inStep = el("input", { class: "input", type: "text", value: safeStr(block.step), disabled: !canEdit, placeholder: "t.ex. Steg 2" });
    inStep.addEventListener("input", function () {
      onPatchMeta(function (draft) { draft.step = inStep.value; return draft; });
    });
    metaCard.appendChild(inStep);

    DOM.selDetail.appendChild(metaCard);

    // Validation reasons (if any)
    if (reasons.length) {
      const err = el("div", { class: "errList" });
      err.appendChild(el("div", { class: "h", text: "Verifiering stoppad:" }));
      const ul = el("ul");
      for (const r of reasons.slice(0, 20)) ul.appendChild(el("li", { text: String(r) }));
      err.appendChild(ul);
      DOM.selDetail.appendChild(err);
    }

    // ITEMS
    const items = Array.isArray(block.items) ? block.items : [];
    const itemsHdr = el("div", { class: "fieldLbl", text: `Items (${items.length})` });
    itemsHdr.style.marginTop = "12px";
    DOM.selDetail.appendChild(itemsHdr);

    // Add buttons
    const addRow = el("div");
    addRow.style.display = "flex";
    addRow.style.gap = "10px";
    addRow.style.flexWrap = "wrap";

    const btnAddDoc = el("button", { class: "optBtn", type: "button", text: "Lägg till dokument", disabled: !canEdit });
    btnAddDoc.addEventListener("click", function () { onAddItem("document", items.length - 1); });
    const btnAddQ = el("button", { class: "optBtn", type: "button", text: "Lägg till fråga", disabled: !canEdit });
    btnAddQ.addEventListener("click", function () { onAddItem("question", items.length - 1); });
    const btnAddT = el("button", { class: "optBtn", type: "button", text: "Lägg till uppgift", disabled: !canEdit });
    btnAddT.addEventListener("click", function () { onAddItem("task", items.length - 1); });

    addRow.appendChild(btnAddDoc);
    addRow.appendChild(btnAddQ);
    addRow.appendChild(btnAddT);
    DOM.selDetail.appendChild(addRow);

    for (let i = 0; i < items.length; i++) {
      const it = items[i] && typeof items[i] === "object" ? items[i] : {};
      const kind = String(it.kind || "document");

      const card = el("div", { class: "itemCard" });

      const top = el("div", { class: "itemRowTop" });
      const left = el("div", { class: "tiny" });
      left.style.fontWeight = "900";
      left.textContent = `${kindEmoji(kind)} ${kind.toUpperCase()} • #${i + 1}`;
      top.appendChild(left);

      const right = el("div");
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.flexWrap = "wrap";

      const btnUp = el("button", { class: "optBtn", type: "button", text: "↑", disabled: !canEdit || i === 0, title: "Flytta upp" });
      btnUp.addEventListener("click", function () { onMoveItem(i, "up"); });
      const btnDown = el("button", { class: "optBtn", type: "button", text: "↓", disabled: !canEdit || i === items.length - 1, title: "Flytta ner" });
      btnDown.addEventListener("click", function () { onMoveItem(i, "down"); });

      const btnDel = el("button", { class: "optBtn", type: "button", text: "Ta bort", disabled: !canEdit, title: "Ta bort item" });
      btnDel.addEventListener("click", function () { onRemoveItem(i); });

      right.appendChild(btnUp);
      right.appendChild(btnDown);
      right.appendChild(btnDel);
      top.appendChild(right);

      card.appendChild(top);

      // Body per kind
      if (kind === "question") {
        card.appendChild(el("div", { class: "fieldLbl", text: "Frågetext" }));
        const qText = el("textarea", { disabled: !canEdit });
        qText.value = safeStr(it.text);
        qText.addEventListener("input", function () {
          onPatchItem(i, function (cur) { cur = cur || {}; cur.text = qText.value; return cur; });
        });
        card.appendChild(qText);

        // Options (3–5 typical, but we don't enforce hard here)
        const opts = Array.isArray(it.options) ? it.options : [];
        const answerKey = safeStr(it.answerKey);

        card.appendChild(el("div", { class: "fieldLbl", text: "Svarsalternativ" }));

        const optsWrap = el("div");
        const maxRender = Math.max(opts.length, 3);
        const count = clampInt(maxRender, 3, 8);

        for (let oi = 0; oi < count; oi++) {
          const row = el("div", { class: "optRow" });

          const radio = el("input", { type: "radio", disabled: !canEdit });
          radio.name = "q_correct_" + i;
          radio.checked = (answerKey && answerKey === String(oi));
          radio.addEventListener("change", function () {
            if (!radio.checked) return;
            onPatchItem(i, function (cur) { cur = cur || {}; cur.answerKey = String(oi); return cur; });
          });

          const inp = el("input", { type: "text", disabled: !canEdit, placeholder: "Svar " + (oi + 1) });
          inp.value = safeStr(opts[oi] || "");
          inp.addEventListener("input", function () {
            onPatchItem(i, function (cur) {
              cur = cur || {};
              const arr = Array.isArray(cur.options) ? cur.options.slice() : [];
              while (arr.length < count) arr.push("");
              arr[oi] = inp.value;
              cur.options = arr;
              return cur;
            });
          });

          row.appendChild(radio);
          row.appendChild(inp);
          optsWrap.appendChild(row);
        }

        card.appendChild(optsWrap);

        // Facit hint
        const fac = el("div", { class: "tiny muted2" });
        fac.style.marginTop = "8px";
        fac.textContent = answerKey ? `Facit: alternativ #${Number(answerKey) + 1}` : "Facit saknas (välj ett alternativ).";
        card.appendChild(fac);
      } else if (kind === "task") {
        card.appendChild(el("div", { class: "fieldLbl", text: "Uppgift" }));
        const tText = el("textarea", { disabled: !canEdit });
        tText.value = safeStr(it.text);
        tText.addEventListener("input", function () {
          onPatchItem(i, function (cur) { cur = cur || {}; cur.text = tText.value; return cur; });
        });
        card.appendChild(tText);

        card.appendChild(el("div", { class: "fieldLbl", text: "Instruktion" }));
        const ins = el("textarea", { disabled: !canEdit });
        ins.value = safeStr(it.instruction);
        ins.addEventListener("input", function () {
          onPatchItem(i, function (cur) { cur = cur || {}; cur.instruction = ins.value; return cur; });
        });
        card.appendChild(ins);

        card.appendChild(el("div", { class: "fieldLbl", text: "Leverans" }));
        const del = el("input", { type: "text", disabled: !canEdit, value: safeStr(it.deliverable), placeholder: "t.ex. 'Signerat' / 'Inlämning'" });
        del.addEventListener("input", function () {
          onPatchItem(i, function (cur) { cur = cur || {}; cur.deliverable = del.value; return cur; });
        });
        card.appendChild(del);
      } else {
        card.appendChild(el("div", { class: "fieldLbl", text: "Dokumenttext" }));
        const dText = el("textarea", { disabled: !canEdit });
        dText.value = safeStr(it.text);
        dText.addEventListener("input", function () {
          onPatchItem(i, function (cur) { cur = cur || {}; cur.text = dText.value; return cur; });
        });
        card.appendChild(dText);
      }

      DOM.selDetail.appendChild(card);
    }
  }

  // -----------------------------
  // Modal (skal) – API för framtida wiring
  // (06-page kan välja att använda detta senare)
  // -----------------------------
  function modalOpen(title, sub, bodyNode) {
    if (!DOM.pbModalOverlay || !DOM.pbModalBody) return;
    if (DOM.pbModalTitle) txt(DOM.pbModalTitle, String(title ?? "Redigera block"));
    if (DOM.pbModalSub) txt(DOM.pbModalSub, String(sub ?? "—"));

    clear(DOM.pbModalBody);
    if (bodyNode) DOM.pbModalBody.appendChild(bodyNode);
    else DOM.pbModalBody.appendChild(el("div", { class: "muted2", text: "—" }));

    DOM.pbModalOverlay.setAttribute("aria-hidden", "false");

    try { DOM.pbModalBody.focus(); } catch (_) {}
  }

  function modalClose() {
    if (!DOM.pbModalOverlay) return;
    DOM.pbModalOverlay.setAttribute("aria-hidden", "true");
  }

  // Close handlers (safe, optional)
  (function wireModalClose() {
    if (!DOM.pbModalOverlay) return;

    function close() { modalClose(); }

    if (DOM.pbModalClose) DOM.pbModalClose.addEventListener("click", close);
    if (DOM.pbModalCancel) DOM.pbModalCancel.addEventListener("click", close);

    DOM.pbModalOverlay.addEventListener("click", function (e) {
      // click outside dialog closes
      if (e && e.target === DOM.pbModalOverlay) close();
    });

    document.addEventListener("keydown", function (e) {
      if (!DOM.pbModalOverlay) return;
      const open = DOM.pbModalOverlay.getAttribute("aria-hidden") === "false";
      if (!open) return;
      if (e && e.key === "Escape") close();
    });
  })();

  // -----------------------------
  // Export
  // -----------------------------
  NS.render = {
    // msg/lock
    setMsg,
    showLockBox,

    // pills
    setStatePill,
    setSelectionPill,
    setWhoPill,
    setModePill,
    setVerifyPill,
    setTopEditing,

    // lists
    renderBlockList,
    renderTrainingHits,
    renderExportPreview,
    setTrainExportHint,

    // editor
    renderSelectedDetail,

    // modal API (valfritt)
    modalOpen,
    modalClose
  };
})();
