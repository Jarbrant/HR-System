/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 05/06 | FIL-ID: UI/pages/packages-block/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render/UI (XSS-safe) för packages-block: listor, pills, export-preview, vald block-editor

Policy (LÅST):
- UI-only • Fail-closed
- XSS-safe: textContent, inga osäkra innerHTML
- Ingen storage här (bara UI)
- SYSTEM_ADMIN = steward/read-only

PATCH v1.1.0 (INKORG + ADMIN-ONLY UI-stöd):
- “search-first”: visar inte blocklistan förrän sök/visa alla triggas
- Renderar blocklista med aktiv markering + kompositionsrad
- Renderar trainings-hits + export-preview (items)
- Renderar vald block-editor (meta + items) med callbacks (edit/spara ligger i 06)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.render) return; // idempotent

  function byId(id) { return document.getElementById(String(id || "")); }
  function el(tag, cls) {
    const n = document.createElement(String(tag || "div"));
    if (cls) n.className = cls;
    return n;
  }
  function txt(node, s) { node.textContent = String(s ?? ""); return node; }
  function clear(node) { if (!node) return; while (node.firstChild) node.removeChild(node.firstChild); }
  function normStr(v) { return String(v ?? "").trim(); }
  function safeLen(s, max) { const t = String(s ?? ""); return t.length > max ? (t.slice(0, max) + "…") : t; }

  // -----------------------------
  // DOM hooks
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
    topEditing: byId("topEditing"),
    topEditingText: byId("topEditingText"),

    // left list
    countBlocks: byId("countBlocks"),
    blockList: byId("blockList"),

    // trainings
    trainPreview: byId("trainPreview"),
    trainPreviewDetail: byId("trainPreviewDetail"),
    trainExportHint: byId("trainExportHint"),

    // selected
    selDetail: byId("selDetail"),
    selHint: byId("selHint"),
  };

  // -----------------------------
  // Small UI helpers
  // -----------------------------
  function setVisible(node, on) {
    if (!node) return;
    node.style.display = on ? "" : "none";
  }

  function setMsg(kind, message) {
    if (!DOM.msgBox) return;
    const m = normStr(message);
    if (!m) { DOM.msgBox.textContent = ""; DOM.msgBox.style.display = "none"; return; }
    DOM.msgBox.style.display = "block";
    DOM.msgBox.textContent = m;
    // (kind ignoreras i v1.1 för att undvika redesign)
  }

  function showLockBox(lines) {
    if (!DOM.lockBox) return;
    const arr = Array.isArray(lines) ? lines.filter(Boolean).map(String) : [];
    if (!arr.length) { DOM.lockBox.style.display = "none"; clear(DOM.lockBox); return; }
    DOM.lockBox.style.display = "block";
    clear(DOM.lockBox);
    const h = el("div"); txt(h, "Låst (fail-closed):"); h.style.fontWeight = "950";
    DOM.lockBox.appendChild(h);
    const ul = el("ul");
    for (const line of arr) {
      const li = el("li");
      txt(li, line);
      ul.appendChild(li);
    }
    DOM.lockBox.appendChild(ul);
  }

  function setPill(node, text, className, show) {
    if (!node) return;
    node.textContent = String(text ?? "");
    if (className) node.className = String(className);
    setVisible(node, show !== false);
  }

  function setStatePill(text, className) {
    setPill(DOM.statePill, text, className || "pill", true);
  }
  function setSelectionPill(text) {
    setPill(DOM.selPill, text, "pill", true);
  }
  function setWhoPill(text) {
    setPill(DOM.whoPill, text, "pill", true);
  }
  function setModePill(text, className) {
    setPill(DOM.modePill, text, className || "pill", true);
  }
  function setVerifyPill(text, className, show) {
    if (!DOM.verifyPill) return;
    DOM.verifyPill.textContent = String(text ?? "");
    DOM.verifyPill.className = String(className || "verifyPill warn");
    setVisible(DOM.verifyPill, !!show);
  }
  function setTopEditing(title, show) {
    if (!DOM.topEditing || !DOM.topEditingText) return;
    DOM.topEditingText.textContent = String(title ?? "—");
    DOM.topEditing.style.display = show ? "inline-flex" : "none";
  }

  // -----------------------------
  // Block list (vänster)
  // -----------------------------
  function compLine(b) {
    const c = (b && b.__comp) ? b.__comp : { q: 0, d: 0, t: 0, missingKey: 0, items: 0 };
    const parts = [];
    parts.push(`Hittat: ${Number(c.items || 0)} item(s)`);
    parts.push(`• ❓ ${Number(c.q || 0)}`);
    parts.push(`• 📄 ${Number(c.d || 0)}`);
    parts.push(`• ✅ ${Number(c.t || 0)}`);
    if (Number(c.missingKey || 0) > 0) parts.push(`• ⚠️ ${Number(c.missingKey)} utan facit`);
    return parts.join(" ");
  }

  function metaLine(b) {
    const module = normStr(b && b.module) || "—";
    const area = normStr(b && b.area) || "—";
    const step = normStr(b && b.step) || "—";
    return `Modul: ${module}\nOmråde: ${area}\nSteg: ${step}`;
  }

  function renderBlockList(args) {
    const discoveryActive = !!(args && args.discoveryActive);
    const allCount = Number(args && args.allCount) || 0;
    const visible = Array.isArray(args && args.visible) ? args.visible : [];
    const selectedId = String(args && args.selectedBlockId || "");
    const onSelect = (args && typeof args.onSelect === "function") ? args.onSelect : null;

    if (DOM.countBlocks) {
      DOM.countBlocks.textContent = discoveryActive
        ? `Hittat: ${visible.length} item(s)`
        : "Sök för att visa block.";
    }

    if (!DOM.blockList) return;
    clear(DOM.blockList);

    if (!discoveryActive) {
      const m = el("div", "muted2");
      txt(m, `Sök för att visa block. (Inga block hittade ännu.)`);
      DOM.blockList.appendChild(m);
      return;
    }

    if (!visible.length) {
      const m = el("div", "muted2");
      txt(m, `Inga träffar.`);
      DOM.blockList.appendChild(m);
      return;
    }

    for (const b of visible) {
      const row = el("div", "rowItem" + (b && b.blockId === selectedId ? " active" : ""));
      row.setAttribute("role", "button");
      row.tabIndex = 0;

      const top = el("div", "rowTop");
      const left = el("div"); left.style.minWidth = "0";
      const title = el("div", "rowTitle");
      txt(title, safeLen(normStr(b && b.title) || "(utan rubrik)", 120));
      left.appendChild(title);

      const meta = el("div", "tiny muted2");
      meta.style.marginTop = "6px";
      meta.style.whiteSpace = "pre-line";
      txt(meta, metaLine(b));
      left.appendChild(meta);

      const right = el("div", "tiny muted2");
      right.style.whiteSpace = "nowrap";
      txt(right, (b && b.status === "published") ? "Publicerad" : "Redo");
      top.appendChild(left);
      top.appendChild(right);

      const comp = el("div", "tiny");
      comp.style.marginTop = "8px";
      txt(comp, compLine(b));

      row.appendChild(top);
      row.appendChild(comp);

      row.addEventListener("click", function () {
        if (onSelect) onSelect(b && b.blockId);
      });
      row.addEventListener("keydown", function (e) {
        if (!e) return;
        const k = e.key || "";
        if (k === "Enter" || k === " ") {
          e.preventDefault();
          if (onSelect) onSelect(b && b.blockId);
        }
      });

      DOM.blockList.appendChild(row);
    }

    // Extra liten info om totala banken (utan redesign)
    if (allCount && DOM.blockList) {
      const foot = el("div", "muted2");
      foot.style.marginTop = "6px";
      txt(foot, `Bank: ${allCount} block totalt.`);
      DOM.blockList.appendChild(foot);
    }
  }

  // -----------------------------
  // Trainings (export) list + preview
  // -----------------------------
  function renderTrainingHits(args) {
    const hits = Array.isArray(args && args.hits) ? args.hits : [];
    const corrupt = !!(args && args.corrupt);
    const missing = !!(args && args.missing);
    const onPick = (args && typeof args.onPickTraining === "function") ? args.onPickTraining : null;

    if (!DOM.trainPreview) return;
    clear(DOM.trainPreview);

    if (missing) {
      const m = el("div", "muted2");
      txt(m, "Inga utbildningar hittades (AO-057_TRAININGS_V1 saknas).");
      DOM.trainPreview.appendChild(m);
      return;
    }
    if (corrupt) {
      const m = el("div", "muted2");
      txt(m, "Utbildningsbank är trasig (korrupt JSON).");
      DOM.trainPreview.appendChild(m);
      return;
    }
    if (!hits.length) {
      const m = el("div", "muted2");
      txt(m, "Inga träffar.");
      DOM.trainPreview.appendChild(m);
      return;
    }

    for (const h of hits) {
      const row = el("div", "exportRow" + (h.active ? " active" : ""));
      row.setAttribute("role", "button");
      row.tabIndex = 0;

      const left = el("div", "left");
      const t = el("div", "t");
      txt(t, safeLen(normStr(h.title) || "—", 120));
      left.appendChild(t);

      const s = el("div", "tiny muted2 s");
      s.style.marginTop = "6px";
      s.style.whiteSpace = "pre-line";
      txt(s, `Modul: ${normStr(h.module) || "—"}\nOmråde: ${normStr(h.area) || "—"}\nSteg: ${normStr(h.step) || "—"}\nItems: ${Number(h.itemsCount || 0)}`);
      left.appendChild(s);

      const right = el("div", "tiny muted2");
      right.style.whiteSpace = "nowrap";
      txt(right, h.active ? "Vald" : "");

      row.appendChild(left);
      row.appendChild(right);

      row.addEventListener("click", function () { if (onPick) onPick(h.index); });
      row.addEventListener("keydown", function (e) {
        const k = e && e.key;
        if (k === "Enter" || k === " ") { e.preventDefault(); if (onPick) onPick(h.index); }
      });

      DOM.trainPreview.appendChild(row);
    }
  }

  function renderExportPreview(args) {
    if (!DOM.trainPreviewDetail) return;
    const items = Array.isArray(args && args.items) ? args.items : [];
    clear(DOM.trainPreviewDetail);

    if (!items.length) {
      DOM.trainPreviewDetail.style.display = "none";
      return;
    }

    DOM.trainPreviewDetail.style.display = "block";

    const h = el("div", "previewTitle");
    txt(h, "Preview (items)");
    DOM.trainPreviewDetail.appendChild(h);

    const meta = el("div", "tiny muted2 previewMeta");
    txt(meta, `Items: ${items.length}`);
    DOM.trainPreviewDetail.appendChild(meta);

    const div = el("div", "divider");
    DOM.trainPreviewDetail.appendChild(div);

    // visa max 12 rader “snabbkoll”
    const lim = Math.min(items.length, 12);
    for (let i = 0; i < lim; i++) {
      const it = items[i] || {};
      const kind = String(it.kind || "document");
      const card = el("div", "exportItemRow");

      const k = el("div", "tiny muted2");
      k.style.minWidth = "60px";
      txt(k, kind === "question" ? "❓" : kind === "task" ? "✅" : "📄");
      card.appendChild(k);

      const body = el("div"); body.style.minWidth = "0";
      const line = el("div", "tiny");
      const mainText = normStr(it.text) || normStr(it.instruction) || "";
      txt(line, safeLen(mainText || "(tom)", 220));
      body.appendChild(line);

      if (kind === "question") {
        const opts = Array.isArray(it.options) ? it.options : [];
        if (opts.length) {
          const o = el("div", "tiny muted2");
          txt(o, `Svar: ${opts.length}`);
          body.appendChild(o);
        }
      }
      card.appendChild(body);

      DOM.trainPreviewDetail.appendChild(card);
    }

    if (items.length > lim) {
      const more = el("div", "tiny muted2");
      more.style.marginTop = "8px";
      txt(more, `… +${items.length - lim} till`);
      DOM.trainPreviewDetail.appendChild(more);
    }
  }

  function setTrainExportHint(text) {
    if (!DOM.trainExportHint) return;
    DOM.trainExportHint.textContent = String(text ?? "");
  }

  // -----------------------------
  // Selected block editor (höger)
  // -----------------------------
  function renderSelectedDetail(args) {
    const block = args && args.block ? args.block : null;
    const canEdit = !!(args && args.canEdit);
    const reasons = Array.isArray(args && args.validationReasons) ? args.validationReasons : [];
    const onPatchMeta = (args && typeof args.onPatchMeta === "function") ? args.onPatchMeta : null;
    const onPatchItem = (args && typeof args.onPatchItem === "function") ? args.onPatchItem : null;
    const onAddItem = (args && typeof args.onAddItem === "function") ? args.onAddItem : null;
    const onRemoveItem = (args && typeof args.onRemoveItem === "function") ? args.onRemoveItem : null;
    const onMoveItem = (args && typeof args.onMoveItem === "function") ? args.onMoveItem : null;

    if (!DOM.selDetail) return;
    clear(DOM.selDetail);

    if (!block) {
      const m = el("div", "muted2");
      txt(m, "Välj ett block i vänsterlistan för att se frågor + facit.");
      DOM.selDetail.appendChild(m);
      return;
    }

    // ---- header errors (kontrakt) ----
    if (reasons.length) {
      const box = el("div", "errList");
      const h = el("div", "h");
      txt(h, "Verifiering blockerad:");
      box.appendChild(h);
      const ul = el("ul");
      for (const r of reasons) {
        const li = el("li");
        txt(li, String(r));
        ul.appendChild(li);
      }
      box.appendChild(ul);
      DOM.selDetail.appendChild(box);
    }

    // ---- meta editor ----
    const metaCard = el("div", "previewCard");
    const metaTitle = el("div", "previewTitle");
    txt(metaTitle, "Grunddata");
    metaCard.appendChild(metaTitle);

    const mkField = (label, value, placeholder) => {
      const wrap = el("div");
      const lbl = el("div", "fieldLbl");
      txt(lbl, label);
      const inp = el("input", "input");
      inp.type = "text";
      inp.value = String(value ?? "");
      if (placeholder) inp.placeholder = String(placeholder);
      inp.disabled = !canEdit;
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      return { wrap, inp };
    };

    const fTitle = mkField("Titel", block.title, "Titel…");
    const fMod = mkField("Modul", block.module, "t.ex. Grundkompetens");
    const fArea = mkField("Område", block.area, "t.ex. Kommunikation & tydlighet");
    const fStep = mkField("Steg", block.step, "t.ex. Steg 2");

    metaCard.appendChild(fTitle.wrap);
    metaCard.appendChild(fMod.wrap);
    metaCard.appendChild(fArea.wrap);
    metaCard.appendChild(fStep.wrap);

    // update helper (meta)
    function patchMeta(partial) {
      if (!canEdit || !onPatchMeta) return;
      onPatchMeta(function (draft) {
        const d = draft && typeof draft === "object" ? draft : {};
        if ("title" in partial) d.title = partial.title;
        if ("module" in partial) d.module = partial.module;
        if ("area" in partial) d.area = partial.area;
        if ("step" in partial) d.step = partial.step;
        return d;
      });
    }

    fTitle.inp.addEventListener("input", function () { patchMeta({ title: fTitle.inp.value }); });
    fMod.inp.addEventListener("input", function () { patchMeta({ module: fMod.inp.value }); });
    fArea.inp.addEventListener("input", function () { patchMeta({ area: fArea.inp.value }); });
    fStep.inp.addEventListener("input", function () { patchMeta({ step: fStep.inp.value }); });

    DOM.selDetail.appendChild(metaCard);

    // ---- items editor ----
    const items = Array.isArray(block.items) ? block.items : [];
    const itemsCard = el("div", "previewCard");
    const itemsH = el("div", "previewTitle");
    txt(itemsH, "Items");
    itemsCard.appendChild(itemsH);

    const addRow = el("div");
    addRow.style.marginTop = "10px";
    addRow.style.display = "flex";
    addRow.style.gap = "10px";
    addRow.style.flexWrap = "wrap";

    function addBtn(label, kind) {
      const b = el("button", "optBtn");
      b.type = "button";
      txt(b, label);
      b.disabled = !canEdit;
      b.addEventListener("click", function () {
        if (!canEdit || !onAddItem) return;
        onAddItem(kind, items.length - 1);
      });
      return b;
    }
    addRow.appendChild(addBtn("Lägg till dokument", "document"));
    addRow.appendChild(addBtn("Lägg till uppgift", "task"));
    addRow.appendChild(addBtn("Lägg till fråga", "question"));
    itemsCard.appendChild(addRow);

    if (!items.length) {
      const m = el("div", "muted2");
      m.style.marginTop = "10px";
      txt(m, "Inga items ännu.");
      itemsCard.appendChild(m);
    }

    function patchItem(idx, mutator) {
      if (!canEdit || !onPatchItem) return;
      onPatchItem(idx, mutator);
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const kind = String(it.kind || "document");

      const card = el("div", "itemCard");

      const top = el("div", "itemRowTop");
      const left = el("div");
      left.style.fontWeight = "950";
      txt(left, `${kind === "question" ? "❓ Fråga" : kind === "task" ? "✅ Uppgift" : "📄 Dokument"} • #${i + 1}`);

      const right = el("div");
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.flexWrap = "wrap";

      const bUp = el("button", "optBtn"); bUp.type = "button"; txt(bUp, "Upp");
      bUp.disabled = !canEdit || i === 0;
      bUp.addEventListener("click", function () { if (onMoveItem) onMoveItem(i, "up"); });

      const bDown = el("button", "optBtn"); bDown.type = "button"; txt(bDown, "Ner");
      bDown.disabled = !canEdit || i === items.length - 1;
      bDown.addEventListener("click", function () { if (onMoveItem) onMoveItem(i, "down"); });

      const bDel = el("button", "optBtn"); bDel.type = "button"; txt(bDel, "Ta bort");
      bDel.disabled = !canEdit;
      bDel.addEventListener("click", function () { if (onRemoveItem) onRemoveItem(i); });

      right.appendChild(bUp);
      right.appendChild(bDown);
      right.appendChild(bDel);

      top.appendChild(left);
      top.appendChild(right);
      card.appendChild(top);

      // body editor per kind
      if (kind === "question") {
        // question text
        const lblQ = el("div", "fieldLbl"); txt(lblQ, "Fråga");
        const ta = el("textarea");
        ta.value = String(it.text ?? "");
        ta.disabled = !canEdit;
        ta.addEventListener("input", function () {
          patchItem(i, function (draft) {
            const d = draft && typeof draft === "object" ? draft : {};
            d.text = ta.value;
            return d;
          });
        });

        card.appendChild(lblQ);
        card.appendChild(ta);

        // options (3–5 rekommenderat, men vi låser inte hårt)
        const lblO = el("div", "fieldLbl"); lblO.style.marginTop = "10px"; txt(lblO, "Svarsalternativ (en korrekt)");
        card.appendChild(lblO);

        const opts = Array.isArray(it.options) ? it.options.slice() : [];
        const answerKey = String(it.answerKey ?? "");

        // ensure at least 3 options in UI for ny fråga (utan att skriva tillbaka förrän användaren ändrar)
        const minOpt = Math.max(3, opts.length);
        while (opts.length < minOpt) opts.push("");

        const optWrap = el("div");
        for (let oi = 0; oi < opts.length; oi++) {
          const row = el("div", "optRow");

          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `q_${block.blockId}_${i}`;
          radio.disabled = !canEdit;

          const val = String(opts[oi] ?? "");
          radio.checked = (answerKey && val && answerKey === val);

          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "input";
          inp.value = val;
          inp.placeholder = `Alternativ ${oi + 1}`;
          inp.disabled = !canEdit;

          // radio select = set answerKey to current option text
          radio.addEventListener("change", function () {
            if (!canEdit) return;
            patchItem(i, function (draft) {
              const d = draft && typeof draft === "object" ? draft : {};
              const o = Array.isArray(d.options) ? d.options.slice() : [];
              // keep length aligned
              while (o.length < opts.length) o.push("");
              const chosen = String(o[oi] ?? inp.value ?? "").trim();
              d.answerKey = chosen ? chosen : "";
              return d;
            });
          });

          // option text change
          inp.addEventListener("input", function () {
            if (!canEdit) return;
            patchItem(i, function (draft) {
              const d = draft && typeof draft === "object" ? draft : {};
              const o = Array.isArray(d.options) ? d.options.slice() : [];
              while (o.length < opts.length) o.push("");
              const old = String(o[oi] ?? "");
              o[oi] = inp.value;
              d.options = o;

              // if this option was the answerKey, carry it forward
              const ak = String(d.answerKey ?? "");
              if (ak && ak === old) d.answerKey = String(inp.value ?? "");
              return d;
            });
          });

          row.appendChild(radio);
          row.appendChild(inp);

          // add/remove option buttons (max 5 rekommenderat)
          if (oi === opts.length - 1) {
            const add = el("button", "optBtn");
            add.type = "button";
            txt(add, "+");
            add.disabled = !canEdit || opts.length >= 5;
            add.title = "Lägg till alternativ (max 5)";
            add.addEventListener("click", function () {
              if (!canEdit) return;
              patchItem(i, function (draft) {
                const d = draft && typeof draft === "object" ? draft : {};
                const o = Array.isArray(d.options) ? d.options.slice() : [];
                if (o.length < 5) o.push("");
                d.options = o;
                return d;
              });
            });
            row.appendChild(add);
          }
          if (opts.length > 3 && oi === opts.length - 1) {
            const rem = el("button", "optBtn");
            rem.type = "button";
            txt(rem, "−");
            rem.disabled = !canEdit;
            rem.title = "Ta bort sista alternativet";
            rem.addEventListener("click", function () {
              if (!canEdit) return;
              patchItem(i, function (draft) {
                const d = draft && typeof draft === "object" ? draft : {};
                const o = Array.isArray(d.options) ? d.options.slice() : [];
                if (o.length > 3) {
                  const removed = String(o[o.length - 1] ?? "");
                  o.pop();
                  d.options = o;
                  // if answerKey matched removed option, clear
                  const ak = String(d.answerKey ?? "");
                  if (ak && ak === removed) d.answerKey = "";
                }
                return d;
              });
            });
            row.appendChild(rem);
          }

          optWrap.appendChild(row);
        }
        card.appendChild(optWrap);

        const hint = el("div", "tiny muted2");
        hint.style.marginTop = "8px";
        txt(hint, "Tips: markera exakt ett korrekt alternativ (radioknapp).");
        card.appendChild(hint);
      }
      else if (kind === "task") {
        const lbl = el("div", "fieldLbl"); txt(lbl, "Uppgift");
        const ta = el("textarea");
        ta.value = String(it.text ?? it.instruction ?? "");
        ta.disabled = !canEdit;
        ta.addEventListener("input", function () {
          patchItem(i, function (draft) {
            const d = draft && typeof draft === "object" ? draft : {};
            d.text = ta.value;
            d.instruction = ta.value; // tolerant: fyll båda
            return d;
          });
        });
        card.appendChild(lbl);
        card.appendChild(ta);

        const lbl2 = el("div", "fieldLbl"); lbl2.style.marginTop = "10px"; txt(lbl2, "Leverans (valfritt)");
        const inp2 = el("input", "input");
        inp2.type = "text";
        inp2.value = String(it.deliverable ?? "");
        inp2.disabled = !canEdit;
        inp2.addEventListener("input", function () {
          patchItem(i, function (draft) {
            const d = draft && typeof draft === "object" ? draft : {};
            d.deliverable = inp2.value;
            return d;
          });
        });
        card.appendChild(lbl2);
        card.appendChild(inp2);
      }
      else {
        const lbl = el("div", "fieldLbl"); txt(lbl, "Dokument");
        const ta = el("textarea");
        ta.value = String(it.text ?? "");
        ta.disabled = !canEdit;
        ta.addEventListener("input", function () {
          patchItem(i, function (draft) {
            const d = draft && typeof draft === "object" ? draft : {};
            d.text = ta.value;
            return d;
          });
        });
        card.appendChild(lbl);
        card.appendChild(ta);
      }

      itemsCard.appendChild(card);
    }

    DOM.selDetail.appendChild(itemsCard);
  }

  // -----------------------------
  // Public API
  // -----------------------------
  NS.render = {
    setMsg,
    showLockBox,

    setStatePill,
    setSelectionPill,
    setWhoPill,
    setModePill,
    setVerifyPill,
    setTopEditing,

    renderBlockList,
    renderTrainingHits,
    renderExportPreview,
    setTrainExportHint,
    renderSelectedDetail
  };
})();
