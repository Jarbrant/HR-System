/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 05/06 | FIL-ID: UI/pages/packages-block/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render/UI (XSS-safe) för packages-block: listor, pills, vald block-editor
Policy (LÅST):
- UI-only • Fail-closed
- XSS-safe: textContent, inga osäkra innerHTML
- Ingen storage här (bara UI)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.render) return; // idempotent

  // ---------- DOM ----------
  function $id(id) { return document.getElementById(id); }

  const DOM = {
    msgBox: $id("msgBox"),
    lockBox: $id("lockBox"),

    statePill: $id("statePill"),
    selPill: $id("selPill"),
    whoPill: $id("whoPill"),
    modePill: $id("modePill"),
    verifyPill: $id("verifyPill"),
    topEditing: $id("topEditing"),
    topEditingText: $id("topEditingText"),

    countBlocks: $id("countBlocks"),
    blockList: $id("blockList"),

    trainPreview: $id("trainPreview"),
    trainPreviewDetail: $id("trainPreviewDetail"),
    trainExportHint: $id("trainExportHint"),

    selDetail: $id("selDetail"),
    selHint: $id("selHint"),
  };

  // ---------- Helpers ----------
  function clear(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag || "div");
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function pill(cls, text) {
    return el("span", cls || "pill", text || "");
  }

  function safeSnippet(v, n) {
    const s = String(v ?? "").trim();
    if (!s) return "(utan text)";
    const max = Math.max(0, Number(n || 0));
    return s.slice(0, max) + (s.length > max ? "…" : "");
  }

  function normStr(v) { return String(v ?? "").trim(); }

  function kindLabel(kind) {
    const k = String(kind || "document");
    if (k === "question") return { icon: "❓", name: "Fråga" };
    if (k === "task") return { icon: "✅", name: "Uppgift" };
    return { icon: "📄", name: "Dokument" };
  }

  function makeInput(type, value, placeholder) {
    const i = document.createElement("input");
    i.type = type || "text";
    i.className = "input";
    if (placeholder) i.placeholder = String(placeholder);
    i.value = String(value ?? "");
    i.autocomplete = "off";
    return i;
  }

  function makeTextarea(value, placeholder) {
    const t = document.createElement("textarea");
    t.className = "input";
    if (placeholder) t.placeholder = String(placeholder);
    t.value = String(value ?? "");
    return t;
  }

  // För att undvika att UI “fladdrar” vid varje tecken (rerender från 06-page),
  // patchar vi på blur/change (inte på input).
  function patchOnBlurAndChange(node, patchFn) {
    if (!node || typeof patchFn !== "function") return;
    node.addEventListener("change", patchFn);
    node.addEventListener("blur", patchFn);
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

  // ---------- Block list ----------
  function renderSearchFirstPlaceholder(nAll) {
    if (!DOM.blockList) return;
    clear(DOM.blockList);
    DOM.blockList.appendChild(el("div", "muted2", "Sök för att visa block."));
    DOM.blockList.appendChild(el("div", "tiny muted2", nAll ? "Tips: Du kan också trycka “Visa alla”." : "Tips: Exportera från utbildningar för att skapa ett block."));
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

      const choose = function () { if (typeof o.onSelect === "function" && id) o.onSelect(id); };
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

      // Viktigt: visa modul/område/steg här (din önskan)
      left.appendChild(el("div", "s",
        `Modul: ${h.module || "—"}\nOmråde: ${h.area || "—"}\nSteg: ${h.step || "—"}\nInnehåll: ${Number(h.itemsCount || 0)} delar`
      ));

      const right = el("div", "");
      right.appendChild(pill("pill ok", h.active ? "Vald" : "Redo"));

      row.appendChild(left);
      row.appendChild(right);

      const pick = function () { if (typeof o.onPickTraining === "function") o.onPickTraining(Number(h.index)); };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });

      DOM.trainPreview.appendChild(row);
    }
  }

  function renderExportPreview(opts) {
    const o = opts || {};
    if (!DOM.trainPreviewDetail) return;
    clear(DOM.trainPreviewDetail);

    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) { DOM.trainPreviewDetail.style.display = "none"; return; }

    DOM.trainPreviewDetail.style.display = "block";
    DOM.trainPreviewDetail.appendChild(el("div", "tiny", `Export-preview: ${items.length} item(s)`));

    for (const it of items.slice(0, 30)) {
      const row = el("div", "exportItemRow");
      row.appendChild(pill("pill warn", String(it.kind || "document")));
      row.appendChild(el("span", "tiny", safeSnippet(it.text, 120)));
      DOM.trainPreviewDetail.appendChild(row);
    }
  }

  function setTrainExportHint(text) {
    if (!DOM.trainExportHint) return;
    DOM.trainExportHint.textContent = String(text || "");
  }

  // ---------- Selected block (editor) ----------
  function renderSelectedEmpty() {
    if (DOM.selHint) DOM.selHint.textContent = "Välj ett block i vänsterlistan för att se frågor + facit.";
    if (DOM.selDetail) clear(DOM.selDetail);
  }

  function renderValidationList(reasons) {
    const arr = Array.isArray(reasons) ? reasons.filter(Boolean) : [];
    if (!arr.length) return null;

    const box = el("div", "errList");
    box.appendChild(el("div", "h", "Verifiering stoppar:"));
    const ul = document.createElement("ul");
    for (const r of arr.slice(0, 50)) {
      const li = document.createElement("li");
      li.textContent = String(r);
      ul.appendChild(li);
    }
    box.appendChild(ul);
    return box;
  }

  function renderItemEditor(it, idx, canEdit, onPatchItem) {
    const item = it && typeof it === "object" ? it : {};
    const kind = String(item.kind || "document");
    const kMeta = kindLabel(kind);

    const card = el("div", "itemCard");
    const top = el("div", "itemRowTop");
    const left = el("div", "");
    left.appendChild(el("div", "previewTitle", `${kMeta.icon} ${kMeta.name} #${idx + 1}`));
    const right = el("div", "");
    right.appendChild(pill("pill", canEdit ? "Redigering: på" : "Read-only"));
    top.appendChild(left);
    top.appendChild(right);
    card.appendChild(top);

    card.appendChild(el("div", "divider", "")); // visuell spacer

    // --- QUESTION ---
    if (kind === "question") {
      // fråga
      card.appendChild(el("div", "fieldLbl", "Frågetext"));
      const qText = makeTextarea(item.text || "", "Skriv frågan här…");
      qText.disabled = !canEdit;
      patchOnBlurAndChange(qText, function () {
        if (!canEdit) return;
        if (typeof onPatchItem !== "function") return;
        const v = qText.value;
        onPatchItem(idx, function (cur) {
          const x = cur && typeof cur === "object" ? cur : {};
          x.text = String(v || "");
          x.kind = "question";
          return x;
        });
      });
      card.appendChild(qText);

      // svarsalternativ (options)
      card.appendChild(el("div", "fieldLbl", "Svarsalternativ"));
      const options = Array.isArray(item.options) ? item.options.map((s) => String(s ?? "")) : [];
      const optWrap = el("div", "");
      const maxOpt = Math.max(2, Math.min(12, options.length || 4));

      function patchOptionsFromUI() {
        if (!canEdit) return;
        if (typeof onPatchItem !== "function") return;
        const next = [];
        const rows = optWrap.querySelectorAll("input[data-opt='1']");
        rows.forEach((inp) => {
          const val = String(inp.value || "").trim();
          if (val) next.push(val);
        });
        onPatchItem(idx, function (cur) {
          const x = cur && typeof cur === "object" ? cur : {};
          x.kind = "question";
          x.options = next;
          return x;
        });
      }

      for (let i = 0; i < maxOpt; i++) {
        const row = el("div", "optRow");
        const inp = makeInput("text", options[i] || "", `Alternativ ${i + 1}`);
        inp.dataset.opt = "1";
        inp.disabled = !canEdit;
        patchOnBlurAndChange(inp, patchOptionsFromUI);
        row.appendChild(inp);
        optWrap.appendChild(row);
      }

      if (canEdit) {
        const help = el("div", "tiny muted2", "Tips: Lämna tomma rader om du vill ha färre alternativ.");
        help.style.marginTop = "6px";
        optWrap.appendChild(help);
      }

      card.appendChild(optWrap);

      // facit
      card.appendChild(el("div", "fieldLbl", "Facit (answerKey)"));
      const ak = makeInput("text", item.answerKey || "", "t.ex. exakt text eller id beroende på modell");
      ak.disabled = !canEdit;
      patchOnBlurAndChange(ak, function () {
        if (!canEdit) return;
        if (typeof onPatchItem !== "function") return;
        const v = ak.value;
        onPatchItem(idx, function (cur) {
          const x = cur && typeof cur === "object" ? cur : {};
          x.kind = "question";
          x.answerKey = String(v || "");
          return x;
        });
      });
      card.appendChild(ak);

      // rationale (om finns / används)
      const rationale = (item.answerKeyObj && typeof item.answerKeyObj === "object") ? String(item.answerKeyObj.rationale || "") : "";
      card.appendChild(el("div", "fieldLbl", "Motivering (valfritt)"));
      const rat = makeTextarea(rationale, "Varför är detta rätt svar? (valfritt)");
      rat.disabled = !canEdit;
      patchOnBlurAndChange(rat, function () {
        if (!canEdit) return;
        if (typeof onPatchItem !== "function") return;
        const v = rat.value;
        onPatchItem(idx, function (cur) {
          const x = cur && typeof cur === "object" ? cur : {};
          x.kind = "question";
          const obj = (x.answerKeyObj && typeof x.answerKeyObj === "object") ? x.answerKeyObj : {};
          obj.rationale = String(v || "");
          x.answerKeyObj = obj;
          return x;
        });
      });
      card.appendChild(rat);

      return card;
    }

    // --- TASK ---
    if (kind === "task") {
      card.appendChild(el("div", "fieldLbl", "Uppgiftstext"));
      const tText = makeTextarea(item.text || "", "Beskriv uppgiften…");
      tText.disabled = !canEdit;
      patchOnBlurAndChange(tText, function () {
        if (!canEdit) return;
        if (typeof onPatchItem !== "function") return;
        const v = tText.value;
        onPatchItem(idx, function (cur) {
          const x = cur && typeof cur === "object" ? cur : {};
          x.kind = "task";
          x.text = String(v || "");
          return x;
        });
      });
      card.appendChild(tText);

      card.appendChild(el("div", "fieldLbl", "Instruktion (valfritt)"));
      const instr = makeTextarea(item.instruction || "", "Instruktioner…");
      instr.disabled = !canEdit;
      patchOnBlurAndChange(instr, function () {
        if (!canEdit) return;
        if (typeof onPatchItem !== "function") return;
        const v = instr.value;
        onPatchItem(idx, function (cur) {
          const x = cur && typeof cur === "object" ? cur : {};
          x.kind = "task";
          x.instruction = String(v || "");
          return x;
        });
      });
      card.appendChild(instr);

      card.appendChild(el("div", "fieldLbl", "Leverans (valfritt)"));
      const del = makeTextarea(item.deliverable || "", "Vad ska lämnas in / levereras?");
      del.disabled = !canEdit;
      patchOnBlurAndChange(del, function () {
        if (!canEdit) return;
        if (typeof onPatchItem !== "function") return;
        const v = del.value;
        onPatchItem(idx, function (cur) {
          const x = cur && typeof cur === "object" ? cur : {};
          x.kind = "task";
          x.deliverable = String(v || "");
          return x;
        });
      });
      card.appendChild(del);

      return card;
    }

    // --- DOCUMENT ---
    card.appendChild(el("div", "fieldLbl", "Text"));
    const dText = makeTextarea(item.text || "", "Skriv dokumenttext…");
    dText.disabled = !canEdit;
    patchOnBlurAndChange(dText, function () {
      if (!canEdit) return;
      if (typeof onPatchItem !== "function") return;
      const v = dText.value;
      onPatchItem(idx, function (cur) {
        const x = cur && typeof cur === "object" ? cur : {};
        x.kind = "document";
        x.text = String(v || "");
        return x;
      });
    });
    card.appendChild(dText);

    return card;
  }

  function renderSelectedDetail(opts) {
    const o = opts || {};
    const b = o.block || null;
    const canEdit = !!o.canEdit;
    const reasons = Array.isArray(o.validationReasons) ? o.validationReasons : [];
    const onPatchItem = (typeof o.onPatchItem === "function") ? o.onPatchItem : null;

    if (!DOM.selDetail) return;

    clear(DOM.selDetail);

    if (!b) { renderSelectedEmpty(); return; }

    if (DOM.selHint) {
      DOM.selHint.textContent = canEdit
        ? "Valt block: redigera items nedan. Ändringar sparas via “Spara ändringar”."
        : "Valt block (Read-only): du kan granska items, men inte redigera.";
    }

    // Top summary
    const title = el("div", "previewTitle", b.title || "(utan rubrik)");
    DOM.selDetail.appendChild(title);

    const meta = el("div", "tiny", "");
    meta.textContent =
      `Modul: ${normStr(b.module) || "—"}  •  ` +
      `Område: ${normStr(b.area) || "—"}  •  ` +
      `Steg: ${normStr(b.step) || "—"}  •  ` +
      `Status: ${(String(b.status || "draft").toLowerCase() === "published") ? "Publicerad" : "Utkast"}`;
    meta.style.marginTop = "6px";
    DOM.selDetail.appendChild(meta);

    // Validation list (if any)
    const vbox = renderValidationList(reasons);
    if (vbox) {
      vbox.style.marginTop = "10px";
      DOM.selDetail.appendChild(vbox);
    }

    // Items
    const items = Array.isArray(b.items) ? b.items : [];
    const itemsHdr = el("div", "fieldLbl", `Items (${items.length})`);
    itemsHdr.style.marginTop = "12px";
    DOM.selDetail.appendChild(itemsHdr);

    if (!items.length) {
      DOM.selDetail.appendChild(el("div", "muted2", "Inga items i detta block ännu."));
      return;
    }

    // Render each item editor
    for (let i = 0; i < items.length; i++) {
      const editor = renderItemEditor(items[i], i, canEdit, onPatchItem);
      DOM.selDetail.appendChild(editor);
    }

    // Footer note
    const note = el("div", "tiny muted2", canEdit
      ? "Tips: ändringar skickas när du lämnar ett fält (blur/change)."
      : "Read-only: byt till ADMIN/MANAGER för att kunna redigera.");
    note.style.marginTop = "10px";
    DOM.selDetail.appendChild(note);
  }

  // ---------- Export ----------
  NS.render = {
    // msg/lock
    setMsg: setMsg,
    showLockBox: showLockBox,

    // pills/top
    setWhoPill: setWhoPill,
    setModePill: setModePill,
    setSelectionPill: setSelectionPill,
    setStatePill: setStatePill,
    setVerifyPill: setVerifyPill,
    setTopEditing: setTopEditing,

    // lists
    renderBlockList: renderBlockList,
    renderTrainingHits: renderTrainingHits,
    renderExportPreview: renderExportPreview,
    setTrainExportHint: setTrainExportHint,

    // selected
    renderSelectedEmpty: renderSelectedEmpty,
    renderSelectedDetail: renderSelectedDetail,
  };
})();
