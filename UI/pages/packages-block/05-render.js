/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 05/06 | FIL-ID: UI/pages/packages-block/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render/UI (XSS-safe) för packages-block: listor, pills, vald block-editor (inkl modal)
Policy (LÅST):
- UI-only • Fail-closed
- XSS-safe: textContent, inga osäkra innerHTML
- Ingen storage här (bara UI)
- Modal-only editing (06-page flyttar selPanel in i modal vid val)
PATCH v1.1.1 (CONTRACT-PACKAGES-BLOCK-v1.1):
- Export-indikator: setExportIndicator({hasNew,countNew}) → “Visa (nytt: N)”
- Meta-editor: Rubrik + Modul + Område + Steg (med onPatchMeta)
- Items-editor: Frågor (3–5 val), Uppgift, Dokument — allt XSS-safe
- “Facit”-kontroll: en tydlig vald korrekt + stöd för både options+answerKey och legacy choices+answerKeyObj
- Modal-foot support: setModalSaveEnabled(on) (låter 06 styra knapp)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.render) return; // idempotent

  // ---------- DOM ----------
  function $id(id) { return document.getElementById(String(id || "")); }

  const DOM = {
    // messages / lock
    msgBox: $id("msgBox"),
    lockBox: $id("lockBox"),

    // pills / top
    statePill: $id("statePill"),
    selPill: $id("selPill"),
    whoPill: $id("whoPill"),
    modePill: $id("modePill"),
    verifyPill: $id("verifyPill"),
    topEditing: $id("topEditing"),
    topEditingText: $id("topEditingText"),

    // list
    countBlocks: $id("countBlocks"),
    blockList: $id("blockList"),

    // export / trainings
    btnToggleExport: $id("btnToggleExport"),
    exportBody: $id("exportBody"),
    trainPreview: $id("trainPreview"),
    trainPreviewDetail: $id("trainPreviewDetail"),
    trainExportHint: $id("trainExportHint"),

    // selected (panel that gets moved into modal by 06-page)
    selDetail: $id("selDetail"),
    selHint: $id("selHint"),

    // modal (exists in HTML)
    modalOverlay: $id("pbModalOverlay"),
    modalDialog: $id("pbModalDialog"),
    modalBody: $id("pbModalBody"),
    modalTitle: $id("pbModalTitle"),
    modalSub: $id("pbModalSub"),
    modalClose: $id("pbModalClose"),
    modalCancel: $id("pbModalCancel"),
    modalSave: $id("pbModalSave"),
  };

  // ---------- Helpers ----------
  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag || "div");
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function pill(cls, text) { return el("span", cls || "pill", text || ""); }

  function safeSnippet(v, n) {
    const s = String(v ?? "").trim();
    if (!s) return "(utan text)";
    const max = Math.max(0, Number(n || 0));
    if (!max) return s;
    return s.slice(0, max) + (s.length > max ? "…" : "");
  }

  function normStr(v) { return String(v ?? "").trim(); }
  function isFn(x) { return typeof x === "function"; }
  function deepClone(obj) { try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; } }

  function clampLen(s, max) {
    const str = String(s ?? "");
    const m = Math.max(0, Number(max || 0));
    if (!m) return str;
    return str.length <= m ? str : str.slice(0, m);
  }

  function btn(cls, text, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls || "miniBtn";
    b.textContent = String(text || "");
    if (title) b.title = String(title);
    return b;
  }

  function inputText(value, placeholder) {
    const i = document.createElement("input");
    i.type = "text";
    i.className = "input";
    i.value = String(value ?? "");
    if (placeholder) i.placeholder = String(placeholder);
    i.autocomplete = "off";
    return i;
  }

  function textarea(value, placeholder) {
    const t = document.createElement("textarea");
    t.className = "input";
    t.value = String(value ?? "");
    if (placeholder) t.placeholder = String(placeholder);
    return t;
  }

  function select(values, current) {
    const s = document.createElement("select");
    s.className = "input";
    const cur = String(current ?? "");
    for (const v of values) {
      const o = document.createElement("option");
      o.value = String(v.value);
      o.textContent = String(v.label);
      s.appendChild(o);
    }
    s.value = cur;
    return s;
  }

  function labelWrap(lblText, node) {
    const wrap = el("div", "");
    wrap.appendChild(el("div", "fieldLbl", lblText));
    wrap.appendChild(node);
    return wrap;
  }

  // Minimal inline card-styles (stöd om CSS saknar klasser)
  function applyCardStyle(node) {
    if (!node) return;
    node.style.border = "1px solid rgba(0,0,0,0.08)";
    node.style.borderRadius = "14px";
    node.style.padding = "12px";
    node.style.margin = "10px 0";
    node.style.background = "#fff";
  }
  function applyRowTopStyle(node) {
    if (!node) return;
    node.style.display = "flex";
    node.style.alignItems = "flex-start";
    node.style.justifyContent = "space-between";
    node.style.gap = "10px";
    node.style.marginBottom = "8px";
  }
  function applyTinyStyle(node) {
    if (!node) return;
    node.style.whiteSpace = "pre-wrap";
    node.style.fontSize = "12px";
    node.style.opacity = "0.85";
    node.style.lineHeight = "1.35";
  }

  // ---------- Message / Lock ----------
  function setMsg(kind, text) {
    if (!DOM.msgBox) return;
    DOM.msgBox.className = "msg" + (kind ? (" " + kind) : "");
    DOM.msgBox.textContent = String(text || "");
    DOM.msgBox.style.display = text ? "block" : "none";
  }

  function showLockBox(lines) {
    if (!DOM.lockBox) return;
    const arr = Array.isArray(lines) ? lines.filter(Boolean) : [];
    if (!arr.length) {
      DOM.lockBox.style.display = "none";
      clear(DOM.lockBox);
      return;
    }
    DOM.lockBox.style.display = "block";
    clear(DOM.lockBox);
    const strong = document.createElement("strong");
    strong.textContent = "Åtgärd krävs";
    DOM.lockBox.appendChild(strong);
    const ul = document.createElement("ul");
    for (const s of arr) {
      const li = document.createElement("li");
      li.textContent = String(s);
      ul.appendChild(li);
    }
    DOM.lockBox.appendChild(ul);
  }

  // ---------- Pills / Top ----------
  function setWhoPill(text) {
    if (!DOM.whoPill) return;
    DOM.whoPill.style.display = "inline-flex";
    DOM.whoPill.textContent = String(text || "Inloggad: —");
  }

  function setModePill(text, cls) {
    if (!DOM.modePill) return;
    DOM.modePill.style.display = "inline-flex";
    DOM.modePill.textContent = String(text || "Läge: —");
    DOM.modePill.className = String(cls || "pill");
  }

  function setSelectionPill(text) {
    if (!DOM.selPill) return;
    DOM.selPill.textContent = String(text || "Val: —");
  }

  function setStatePill(text, cls) {
    if (!DOM.statePill) return;
    DOM.statePill.textContent = String(text || "Status: —");
    DOM.statePill.className = String(cls || "pill");
  }

  function setVerifyPill(text, cls, show) {
    if (!DOM.verifyPill) return;
    DOM.verifyPill.style.display = show ? "inline-flex" : "none";
    if (show) {
      DOM.verifyPill.textContent = String(text || "Verifiering: —");
      DOM.verifyPill.className = String(cls || "verifyPill warn");
    }
  }

  function setTopEditing(text, show) {
    if (!DOM.topEditing || !DOM.topEditingText) return;
    DOM.topEditing.style.display = show ? "inline-flex" : "none";
    DOM.topEditingText.textContent = String(text || "—");
  }

  // ---------- Export indicator (CONTRACT v1.1) ----------
  function setExportIndicator(info) {
    if (!DOM.btnToggleExport) return;
    const hasNew = !!(info && info.hasNew);
    const countNew = Math.max(0, Number(info && info.countNew || 0));
    // Keep default behaviour: button text indicates open/close via 06-page when clicked.
    // Here we only add "(nytt: N)" suffix when closed.
    const isExpanded = String(DOM.btnToggleExport.getAttribute("aria-expanded") || "false") === "true";
    if (isExpanded) return; // 06 controls open label "Dölj"/"Visa"
    DOM.btnToggleExport.textContent = hasNew ? `Visa (nytt: ${countNew})` : "Visa";
  }

  function setModalSaveEnabled(on) {
    if (!DOM.modalSave) return;
    DOM.modalSave.disabled = !on;
  }

  // ---------- Block list ----------
  function renderSearchFirstPlaceholder(nAll) {
    if (!DOM.blockList) return;
    clear(DOM.blockList);
    DOM.blockList.appendChild(el("div", "muted2", "Sök för att visa block."));
    DOM.blockList.appendChild(
      el(
        "div",
        "tiny muted2",
        nAll ? "Tips: Du kan också trycka “Visa alla”." : "Tips: Exportera från utbildningar för att skapa ett block."
      )
    );
  }

  function renderBlockList(opts) {
    const o = opts || {};
    const discoveryActive = !!o.discoveryActive;
    const allCount = Number(o.allCount || 0);
    const visible = Array.isArray(o.visible) ? o.visible : [];
    const selectedId = String(o.selectedBlockId || "");

    if (DOM.countBlocks) {
      DOM.countBlocks.textContent = `${discoveryActive ? visible.length : 0} / ${allCount}`;
    }

    if (!DOM.blockList) return;

    if (!discoveryActive) {
      renderSearchFirstPlaceholder(allCount);
      return;
    }

    clear(DOM.blockList);

    if (!visible.length) {
      DOM.blockList.appendChild(el("div", "muted2", allCount ? "Inga träffar (justera sök/filter)." : "Inga block ännu."));
      return;
    }

    const max = Math.min(visible.length, 400);
    for (let i = 0; i < max; i++) {
      const b = visible[i] || {};
      const id = String(b.blockId || "");
      const comp = b.__comp || b.comp || null;

      const row = el("div", "rowItem" + (id && id === selectedId ? " active" : ""));
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.dataset.blockid = id;

      const top = el("div", "rowTop");
      const left = el("div", "");
      const title = el("div", "rowTitle", b.title || "(utan rubrik)");

      const q = comp ? Number(comp.q || 0) : 0;
      const d = comp ? Number(comp.d || 0) : 0;
      const t = comp ? Number(comp.t || 0) : 0;

      const meta = el(
        "div",
        "tiny",
        `${b.module || "—"} • ${b.area || "—"} • ${b.step || "—"} • Hittat: ${Number(comp ? (q + d + t) : 0)} item(s)`
      );

      const icoRow = el("div", "icoRow");
      icoRow.appendChild(pill("icoPill", `❓ ${q}`));
      icoRow.appendChild(pill("icoPill", `📄 ${d}`));
      icoRow.appendChild(pill("icoPill", `✅ ${t}`));

      left.appendChild(title);
      left.appendChild(meta);
      left.appendChild(icoRow);

      const right = el("div", "");
      const st = String(b.status || "draft").toLowerCase() === "published" ? "published" : "draft";
      right.appendChild(pill("pill " + (st === "published" ? "ok" : "warn"), st === "published" ? "Publicerad" : "Utkast"));

      const verified = Number(b.verifiedAt || 0) > 0;
      const vPill = pill(verified ? "verifyPill ok" : "verifyPill warn", verified ? "Verifierad" : "Ej verifierad");
      vPill.style.marginTop = "6px";
      right.appendChild(vPill);

      top.appendChild(left);
      top.appendChild(right);
      row.appendChild(top);

      const choose = function () { if (isFn(o.onSelect) && id) o.onSelect(id); };
      row.addEventListener("click", choose);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
      });

      DOM.blockList.appendChild(row);
    }
  }

  // ---------- Trainings export ----------
  function renderTrainingHits(opts) {
    const o = opts || {};
    if (!DOM.trainPreview) return;

    clear(DOM.trainPreview);

    if (o.corrupt) {
      DOM.trainPreview.appendChild(el("div", "muted2", "Låst: utbildningsdata är trasig (korrupt JSON)."));
      return;
    }

    const hits = Array.isArray(o.hits) ? o.hits : [];
    if (!hits.length) {
      DOM.trainPreview.appendChild(el("div", "muted2", o.missing ? "Inga utbildningar hittades ännu." : "Inga träffar / export inte kopplad än."));
      return;
    }

    for (const h of hits.slice(0, 80)) {
      const row = el("div", "exportRow" + (h.active ? " active" : ""));
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");

      const left = el("div", "left");
      left.appendChild(el("div", "t", h.title || "—"));
      left.appendChild(el("div", "s",
        `Modul: ${h.module || "—"}\nOmråde: ${h.area || "—"}\nSteg: ${h.step || "—"}\nInnehåll: ${Number(h.itemsCount || 0)} delar`
      ));

      const right = el("div", "");
      right.appendChild(pill("pill ok", h.active ? "Vald" : "Redo"));

      row.appendChild(left);
      row.appendChild(right);

      const pick = function () { if (isFn(o.onPickTraining)) o.onPickTraining(Number(h.index)); };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });

      DOM.trainPreview.appendChild(row);
    }
  }

  function kindPillText(kind) {
    const k = String(kind || "document");
    if (k === "question") return "❓ Fråga";
    if (k === "task") return "✅ Uppgift";
    return "📄 Dokument";
  }

  function describeItemCompact(it) {
    const k = String(it && it.kind ? it.kind : "document");
    if (k === "question") {
      const text = safeSnippet(it.text, 140);
      const options = Array.isArray(it.options) ? it.options.filter(Boolean) : [];
      const choices = Array.isArray(it.choices) ? it.choices : [];
      const nOpts = options.length || choices.length || 0;
      const ak1 = normStr(it.answerKey);
      const ak2 = normStr(it.answerKeyObj && it.answerKeyObj.correctChoiceId);
      const hasKey = !!(ak1 || ak2);
      return `${text}\nAlternativ: ${nOpts} • Facit: ${hasKey ? "ja" : "NEJ"}`;
    }
    if (k === "task") {
      const instr = safeSnippet(it.instruction || it.text, 160);
      const d = safeSnippet(it.deliverable, 120);
      return `${instr}${d && d !== "(utan text)" ? `\nLeverans: ${d}` : ""}`;
    }
    // document
    const tx = safeSnippet(it.text, 200);
    return `${tx}\nSignering: ${it.requiresSign ? "ja" : "nej"}`;
  }

  function renderExportPreview(opts) {
    const o = opts || {};
    if (!DOM.trainPreviewDetail) return;

    clear(DOM.trainPreviewDetail);

    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) { DOM.trainPreviewDetail.style.display = "none"; return; }

    DOM.trainPreviewDetail.style.display = "block";

    // Header
    const head = el("div", "");
    head.appendChild(el("div", "previewTitle", "Preview (items)"));
    const tiny = el("div", "tiny", `Visar ${items.length} item(s). (Detta är preview – export skapar ett nytt block.)`);
    applyTinyStyle(tiny);
    head.appendChild(tiny);
    DOM.trainPreviewDetail.appendChild(head);

    // List
    for (let i = 0; i < Math.min(items.length, 40); i++) {
      const it = items[i] || {};
      const card = el("div", "itemCard");
      applyCardStyle(card);

      const top = el("div", "itemRowTop");
      applyRowTopStyle(top);

      const left = el("div", "");
      const k = el("div", "fieldLbl", `${kindPillText(it.kind)}  •  #${i + 1}`);
      left.appendChild(k);

      const desc = el("div", "tiny", describeItemCompact(it));
      applyTinyStyle(desc);
      left.appendChild(desc);

      top.appendChild(left);
      card.appendChild(top);

      DOM.trainPreviewDetail.appendChild(card);
    }

    if (items.length > 40) {
      const more = el("div", "tiny muted2", `… visar första 40 items (av ${items.length}).`);
      applyTinyStyle(more);
      DOM.trainPreviewDetail.appendChild(more);
    }
  }

  function setTrainExportHint(text) {
    if (!DOM.trainExportHint) return;
    DOM.trainExportHint.textContent = String(text || "");
  }

  // ---------- Selected block editor ----------
  function renderSelectedEmpty() {
    if (DOM.selHint) DOM.selHint.textContent = "Välj ett block i vänsterlistan för att se frågor + facit.";
    if (DOM.selDetail) clear(DOM.selDetail);
  }

  function renderValidationReasons(reasons) {
    const arr = Array.isArray(reasons) ? reasons.filter(Boolean) : [];
    if (!arr.length) return null;

    const box = el("div", "errList");
    applyCardStyle(box);
    box.appendChild(el("div", "h", "Verifiering blockerad"));
    const ul = document.createElement("ul");
    for (const r of arr.slice(0, 30)) {
      const li = document.createElement("li");
      li.textContent = String(r);
      ul.appendChild(li);
    }
    box.appendChild(ul);
    return box;
  }

  function itemKindLabel(kind) {
    const k = String(kind || "document");
    if (k === "question") return "❓ Fråga";
    if (k === "task") return "✅ Uppgift";
    return "📄 Dokument";
  }

  // --------- Meta editor (title/module/area/step) ----------
  function renderMetaEditor(b, canEdit, onPatchMeta) {
    const wrap = el("div", "previewCard");
    applyCardStyle(wrap);

    const title = el("div", "previewTitle", "Grundinfo");
    wrap.appendChild(title);

    const note = el("div", "tiny muted2", canEdit ? "Redigera rubrik + klassrumskoppling (Modul/Område/Steg)." : "Read-only: granska grundinfo.");
    applyTinyStyle(note);
    wrap.appendChild(note);

    const tTitle = textarea(b.title || "", "Rubrik…");
    tTitle.disabled = !canEdit;
    tTitle.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchMeta)) return;
      const v = clampLen(tTitle.value, 240);
      onPatchMeta(function (draft) { draft.title = v; return draft; });
    });
    wrap.appendChild(labelWrap("Rubrik", tTitle));

    const iMod = inputText(b.module || "", "t.ex. Arbetsmiljö");
    iMod.disabled = !canEdit;
    iMod.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchMeta)) return;
      const v = clampLen(iMod.value, 120);
      onPatchMeta(function (draft) { draft.module = v; return draft; });
    });
    wrap.appendChild(labelWrap("Modul", iMod));

    const iArea = inputText(b.area || "", "t.ex. Ergonomi");
    iArea.disabled = !canEdit;
    iArea.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchMeta)) return;
      const v = clampLen(iArea.value, 120);
      onPatchMeta(function (draft) { draft.area = v; return draft; });
    });
    wrap.appendChild(labelWrap("Område", iArea));

    const iStep = inputText(b.step || "", "t.ex. 1");
    iStep.disabled = !canEdit;
    iStep.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchMeta)) return;
      const v = clampLen(iStep.value, 40);
      onPatchMeta(function (draft) { draft.step = v; return draft; });
    });
    wrap.appendChild(labelWrap("Steg", iStep));

    const meta = el("div", "tiny previewMeta",
      `BlockID: ${b.blockId || "—"}\n` +
      `Status: ${String(b.status || "draft").toLowerCase() === "published" ? "Publicerad" : "Utkast"}\n` +
      `Verifierad: ${Number(b.verifiedAt || 0) > 0 ? "Ja" : "Nej"}`
    );
    applyTinyStyle(meta);
    wrap.appendChild(meta);

    return wrap;
  }

  // --------- Items editors ----------
  function ensureChoiceCount(n) {
    const x = Number(n || 0);
    if (x < 3) return 3;
    if (x > 5) return 5;
    return x;
  }

  function getQuestionModel(it) {
    const hasLegacy = Array.isArray(it.choices) && it.choices.length > 0;
    if (hasLegacy) return { kind: "legacy", choices: it.choices || [], correctId: normStr(it.answerKeyObj && it.answerKeyObj.correctChoiceId) };
    const opts = Array.isArray(it.options) ? it.options.slice() : [];
    return { kind: "simple", options: opts, correctText: normStr(it.answerKey) };
  }

  function renderQuestionEditor(it, idx, canEdit, onPatchItem) {
    const card = el("div", "itemCard");
    applyCardStyle(card);

    const top = el("div", "itemRowTop");
    applyRowTopStyle(top);
    top.appendChild(el("div", "tiny", itemKindLabel("question") + (it.questionId ? ` • ${it.questionId}` : "")));

    const right = el("div", "");
    right.appendChild(pill("pill", `#${idx + 1}`));
    top.appendChild(right);
    card.appendChild(top);

    // Question text
    const qText = textarea(it.text || "", "Skriv frågan…");
    qText.disabled = !canEdit;
    qText.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = clampLen(qText.value, 4000);
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "question";
        next.text = v;
        return next;
      });
    });
    card.appendChild(labelWrap("Fråga", qText));

    // Model
    const model = getQuestionModel(it);

    // ---------- SIMPLE (options + answerKey) ----------
    if (model.kind === "simple") {
      let opts = Array.isArray(model.options) ? model.options.slice() : [];
      // Ensure 3–5 visible entries (CONTRACT)
      const minCount = 3;
      const maxCount = 5;

      // Normalize to at least 3
      while (opts.length < minCount) opts.push("");

      // Clamp to at most 5 (but allow user to keep if currently >5? Contract says 3-5, so clamp view + warn)
      if (opts.length > maxCount) opts = opts.slice(0, maxCount);

      const list = el("div", "");
      list.appendChild(el("div", "fieldLbl", "Svarsalternativ (3–5)"));

      // Correct selector options will be built from current text values
s
      for (let i = 0; i < opts.length; i++) {
        const row = el("div", "optRow");
        row.style.display = "flex";
        row.style.gap = "8px";
        row.style.alignItems = "center";

        const inp = inputText(opts[i] || "", `Alternativ ${i + 1}`);
        inp.disabled = !canEdit;
        inp.addEventListener("input", function () {
          if (!canEdit || !isFn(onPatchItem)) return;
          const v = clampLen(inp.value, 2000);
          onPatchItem(idx, function (cur) {
            const next = deepClone(cur || {});
            const arr = Array.isArray(next.options) ? next.options.slice() : [];
            while (arr.length < minCount) arr.push("");
            // Clamp to 5
            if (arr.length > maxCount) arr.length = maxCount;
            arr[i] = v;
            next.options = arr;

            // If answerKey was equal to old option that got removed/changed, keep as is (contract will catch missing)
            return next;
          });
        });

        // Remove (but never below 3)
        const del = btn("optBtn", "Ta bort");
        del.disabled = !canEdit || opts.length <= minCount;
        del.addEventListener("click", function () {
          if (!canEdit || !isFn(onPatchItem)) return;
          onPatchItem(idx, function (cur) {
            const next = deepClone(cur || {});
            const arr = Array.isArray(next.options) ? next.options.slice() : [];
            while (arr.length < minCount) arr.push("");
            if (arr.length <= minCount) return next;
            // Clamp to 5
            if (arr.length > maxCount) arr.length = maxCount;

            const removed = String(arr[i] || "");
            arr.splice(i, 1);
            // Keep at least 3
            while (arr.length < minCount) arr.push("");
            next.options = arr;

            if (String(next.answerKey || "") === removed) next.answerKey = "";
            return next;
          });
        });

        row.appendChild(inp);
        row.appendChild(del);
        list.appendChild(row);
      }

      const add = btn("optBtn", "Lägg till");
      add.disabled = !canEdit || opts.length >= maxCount;
      add.addEventListener("click", function () {
        if (!canEdit || !isFn(onPatchItem)) return;
        onPatchItem(idx, function (cur) {
          const next = deepClone(cur || {});
          const arr = Array.isArray(next.options) ? next.options.slice() : [];
          while (arr.length < minCount) arr.push("");
          if (arr.length >= maxCount) return next;
          arr.push("");
          next.options = arr;
          return next;
        });
      });

      const addRow = el("div", "optRow");
      addRow.appendChild(add);
      list.appendChild(addRow);

      card.appendChild(list);

      // Facit: select one
      const values = [{ value: "", label: "Välj facit (1 rätt)…" }];
      const curKey = String(it.answerKey || "");
      // Use current displayed opts
      const unique = new Set();
      for (const o of opts) {
        const tx = String(o || "");
        if (unique.has(tx)) continue;
        unique.add(tx);
        values.push({ value: tx, label: tx ? tx : "(tomt alternativ)" });
      }
      const s = select(values, curKey);
      s.disabled = !canEdit;
      s.addEventListener("change", function () {
        if (!canEdit || !isFn(onPatchItem)) return;
        const v = String(s.value || "");
        onPatchItem(idx, function (curIt) {
          const next = deepClone(curIt || {});
          next.answerKey = v;
          return next;
        });
      });
      card.appendChild(labelWrap("Facit (1 rätt)", s));

      return card;
    }

    // ---------- LEGACY (choices + answerKeyObj.correctChoiceId) ----------
    const choices = Array.isArray(model.choices) ? model.choices.slice() : [];
    const minCountL = 3;
    const maxCountL = 5;

    // Ensure each choice has id/text
    while (choices.length < minCountL) choices.push({ id: `c${choices.length + 1}`, text: "" });
    if (choices.length > maxCountL) choices.length = maxCountL;

    const listL = el("div", "");
    listL.appendChild(el("div", "fieldLbl", "Svarsalternativ (3–5, legacy)"));

    for (let i = 0; i < choices.length; i++) {
      const c = choices[i] || {};
      const row = el("div", "optRow");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.alignItems = "center";

      const inp = inputText(c.text || "", `Alternativ ${i + 1}`);
      inp.disabled = !canEdit;
      inp.addEventListener("input", function () {
        if (!canEdit || !isFn(onPatchItem)) return;
        const v = clampLen(inp.value, 2000);
        onPatchItem(idx, function (cur) {
          const next = deepClone(cur || {});
          const arr = Array.isArray(next.choices) ? next.choices.slice() : [];
          while (arr.length < minCountL) arr.push({ id: `c${arr.length + 1}`, text: "" });
          if (arr.length > maxCountL) arr.length = maxCountL;

          const cx = deepClone(arr[i] || {});
          cx.id = normStr(cx.id || c.id || `c${i + 1}`) || `c${i + 1}`;
          cx.text = v;
          arr[i] = cx;
          next.choices = arr;
          return next;
        });
      });

      const del = btn("optBtn", "Ta bort");
      del.disabled = !canEdit || choices.length <= minCountL;
      del.addEventListener("click", function () {
        if (!canEdit || !isFn(onPatchItem)) return;
        onPatchItem(idx, function (cur) {
          const next = deepClone(cur || {});
          const arr = Array.isArray(next.choices) ? next.choices.slice() : [];
          while (arr.length < minCountL) arr.push({ id: `c${arr.length + 1}`, text: "" });
          if (arr.length <= minCountL) return next;

          arr.splice(i, 1);
          while (arr.length < minCountL) arr.push({ id: `c${arr.length + 1}`, text: "" });
          if (arr.length > maxCountL) arr.length = maxCountL;

          // If correctChoiceId now missing, clear it
          const ak = next.answerKeyObj && next.answerKeyObj.correctChoiceId ? String(next.answerKeyObj.correctChoiceId) : "";
          const ids = arr.map((x) => String(x && x.id || ""));
          if (ak && ids.indexOf(ak) === -1) {
            next.answerKeyObj = next.answerKeyObj && typeof next.answerKeyObj === "object" ? next.answerKeyObj : {};
            next.answerKeyObj.correctChoiceId = "";
          }

          next.choices = arr;
          return next;
        });
      });

      row.appendChild(inp);
      row.appendChild(del);
      listL.appendChild(row);
    }

    const addL = btn("optBtn", "Lägg till");
    addL.disabled = !canEdit || choices.length >= maxCountL;
    addL.addEventListener("click", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        const arr = Array.isArray(next.choices) ? next.choices.slice() : [];
        while (arr.length < minCountL) arr.push({ id: `c${arr.length + 1}`, text: "" });
        if (arr.length >= maxCountL) return next;
        const n = arr.length + 1;
        arr.push({ id: `c${n}`, text: "" });
        next.choices = arr;
        return next;
      });
    });

    const addRowL = el("div", "optRow");
    addRowL.appendChild(addL);
    listL.appendChild(addRowL);

    card.appendChild(listL);

    // Facit choose by id
    const valuesL = [{ value: "", label: "Välj facit (1 rätt)…" }];
    for (const c of choices) {
      const id = String(c && c.id || "");
      const tx = String(c && c.text || "").trim();
      valuesL.push({ value: id, label: tx ? tx : id || "(tomt alternativ)" });
    }
    const curId = it.answerKeyObj && it.answerKeyObj.correctChoiceId ? String(it.answerKeyObj.correctChoiceId) : "";
    const sL = select(valuesL, curId);
    sL.disabled = !canEdit;
    sL.addEventListener("change", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = String(sL.value || "");
      onPatchItem(idx, function (curIt) {
        const next = deepClone(curIt || {});
        next.answerKeyObj = next.answerKeyObj && typeof next.answerKeyObj === "object" ? next.answerKeyObj : {};
        next.answerKeyObj.correctChoiceId = v;
        return next;
      });
    });
    card.appendChild(labelWrap("Facit (1 rätt)", sL));

    const rat = textarea((it.answerKeyObj && it.answerKeyObj.rationale) ? String(it.answerKeyObj.rationale) : "", "Motivering (valfritt)");
    rat.disabled = !canEdit;
    rat.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = clampLen(rat.value, 4000);
      onPatchItem(idx, function (curIt) {
        const next = deepClone(curIt || {});
        next.answerKeyObj = next.answerKeyObj && typeof next.answerKeyObj === "object" ? next.answerKeyObj : {};
        next.answerKeyObj.rationale = v;
        return next;
      });
    });
    card.appendChild(labelWrap("Motivering (valfritt)", rat));

    return card;
  }

  function renderTaskEditor(it, idx, canEdit, onPatchItem) {
    const card = el("div", "itemCard");
    applyCardStyle(card);

    const top = el("div", "itemRowTop");
    applyRowTopStyle(top);
    top.appendChild(el("div", "tiny", itemKindLabel("task") + (it.taskId ? ` • ${it.taskId}` : "")));

    const right = el("div", "");
    right.appendChild(pill("pill", `#${idx + 1}`));
    top.appendChild(right);
    card.appendChild(top);

    const instr = textarea(it.instruction || it.text || "", "Instruktion till eleven…");
    instr.disabled = !canEdit;
    instr.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = clampLen(instr.value, 4000);
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "task";
        next.instruction = v;
        if (!next.text) next.text = v;
        return next;
      });
    });
    card.appendChild(labelWrap("Instruktion", instr));

    const deliv = textarea(it.deliverable || "", "Vad ska lämnas in / visas / bockas av?");
    deliv.disabled = !canEdit;
    deliv.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = clampLen(deliv.value, 2000);
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "task";
        next.deliverable = v;
        return next;
      });
    });
    card.appendChild(labelWrap("Leverans (valfritt)", deliv));

    const req = document.createElement("input");
    req.type = "checkbox";
    req.checked = it.requiresDone !== false;
    req.disabled = !canEdit;
    req.addEventListener("change", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = !!req.checked;
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "task";
        next.requiresDone = v;
        return next;
      });
    });

    const reqRow = el("div", "optRow");
    reqRow.style.display = "flex";
    reqRow.style.gap = "10px";
    reqRow.style.alignItems = "center";
    reqRow.appendChild(req);
    reqRow.appendChild(el("div", "tiny", "Kräver att eleven markerar klar"));
    card.appendChild(reqRow);

    return card;
  }

  function renderDocumentEditor(it, idx, canEdit, onPatchItem) {
    const card = el("div", "itemCard");
    applyCardStyle(card);

    const top = el("div", "itemRowTop");
    applyRowTopStyle(top);
    top.appendChild(el("div", "tiny", itemKindLabel("document")));

    const right = el("div", "");
    right.appendChild(pill("pill", `#${idx + 1}`));
    top.appendChild(right);
    card.appendChild(top);

    const tx = textarea(it.text || "", "Dokumenttext…");
    tx.disabled = !canEdit;
    tx.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = clampLen(tx.value, 20000);
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "document";
        next.text = v;
        return next;
      });
    });
    card.appendChild(labelWrap("Text", tx));

    const sign = document.createElement("input");
    sign.type = "checkbox";
    sign.checked = !!it.requiresSign;
    sign.disabled = !canEdit;
    sign.addEventListener("change", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = !!sign.checked;
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "document";
        next.requiresSign = v;
        return next;
      });
    });

    const signRow = el("div", "optRow");
    signRow.style.display = "flex";
    signRow.style.gap = "10px";
    signRow.style.alignItems = "center";
    signRow.appendChild(sign);
    signRow.appendChild(el("div", "tiny", "Kräver signering (valfritt)"));
    card.appendChild(signRow);

    return card;
  }

  function renderSelectedDetail(opts) {
    const o = opts || {};
    const b = o.block || null;
    const canEdit = !!o.canEdit;
    const reasons = Array.isArray(o.validationReasons) ? o.validationReasons : [];
    const onPatchItem = isFn(o.onPatchItem) ? o.onPatchItem : null;
    const onPatchMeta = isFn(o.onPatchMeta) ? o.onPatchMeta : null;

    if (!DOM.selDetail) return;
    clear(DOM.selDetail);

    if (!b) { renderSelectedEmpty(); return; }

    if (DOM.selHint) {
      DOM.selHint.textContent = canEdit
        ? "Valt block: redigera rubrik/modul/område/steg + items. Frågor visar facit tydligt."
        : "Valt block (read-only): du kan granska items men inte ändra.";
    }

    // Meta editor
    DOM.selDetail.appendChild(renderMetaEditor(b, canEdit, onPatchMeta));

    // Validation reasons (contract)
    const vbox = renderValidationReasons(reasons);
    if (vbox) DOM.selDetail.appendChild(vbox);

    // Items list
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) {
      DOM.selDetail.appendChild(el("div", "muted2", "Det här blocket har inga items ännu."));
      return;
    }

    const listWrap = el("div", "");
    listWrap.appendChild(el("div", "fieldLbl", `Items (${items.length})`));
    const tip = el("div", "tiny muted2", "Redigera rad för rad. (XSS-safe: textContent)");
    applyTinyStyle(tip);
    listWrap.appendChild(tip);

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const kind = String(it.kind || "document");

      let card = null;
      if (kind === "question") card = renderQuestionEditor(it, i, canEdit, onPatchItem);
      else if (kind === "task") card = renderTaskEditor(it, i, canEdit, onPatchItem);
      else card = renderDocumentEditor(it, i, canEdit, onPatchItem);

      listWrap.appendChild(card);
    }

    DOM.selDetail.appendChild(listWrap);
  }

  // ---------- export ----------
  NS.render = {
    setMsg,
    showLockBox,

    setWhoPill,
    setModePill,
    setSelectionPill,
    setStatePill,
    setVerifyPill,
    setTopEditing,

    setExportIndicator,
    setModalSaveEnabled,

    renderBlockList,
    renderTrainingHits,
    renderExportPreview,
    setTrainExportHint,

    renderSelectedEmpty,
    renderSelectedDetail,

    __dom: DOM
  };
})();
