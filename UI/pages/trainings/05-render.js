/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-05) | FILE 05/06 | FIL-ID: UI/pages/trainings/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render-layer (XSS-safe) för trainings:
      - pills (who/state/context)
      - left hint + ai hint
      - list-render (vänster)
      - blocks-render (höger)
      - enkel modal (för 06-page.openModal baseline)

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys
- XSS-safe: endast textContent (ingen osäker innerHTML)
- Ingen fetch • ingen worker
- Read-only respekteras i 06-page (render visar bara)

PATCH v1.0.1 (PP-SC-010-05) (AUTOPATCH):
- P0 FIX: Guardar om #list eller #blocksList saknas (ingen throw).
- P1: "item/items" pluralisering i block-meta.
- P1: Modal: role="dialog" + aria-modal + fokus på Stäng (a11y-light).
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.render) return;

  const render = (NS.render = {});
  render.__VERSION = "v1.0.1-PP-SC-010-05";

  function byId(id) { return document.getElementById(String(id || "")); }
  function normStr(v) { return String(v ?? "").trim(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }

  // We expect 01-dom to provide dom helpers; fallback to minimal.
  const dom = NS.dom || {
    setText: function (el, txt) { if (el) el.textContent = String(txt ?? ""); },
    show: function (el) { if (el) el.style.display = ""; },
    hide: function (el) { if (el) el.style.display = "none"; }
  };

  // Cache common elements (fail-soft)
  const EL = {
    contextPill: byId("contextPill"),
    contextText: byId("contextText"),
    statePill: byId("statePill"),
    stateText: byId("stateText"),
    whoPill: byId("whoPill"),
    whoText: byId("whoText"),
    leftHint: byId("leftHint"),
    aiHint: byId("aiHint"),
    list: byId("list"),
    blocksList: byId("blocksList"),
    debugPre: byId("debugPre"),
    debugBox: byId("debugBox")
  };

  function setPillClass(pillEl, kind) {
    if (!pillEl || !pillEl.classList) return;
    pillEl.classList.remove("ok", "warn", "bad");
    if (kind === "ok" || kind === "warn" || kind === "bad") pillEl.classList.add(kind);
  }

  // ------------------------------
  // Top pills
  // ------------------------------
  render.setContextPill = function (text) {
    dom.setText(EL.contextText, normStr(text) || "—");
  };

  render.setStatePill = function (text, kind) {
    dom.setText(EL.stateText, normStr(text) || "Status: —");
    setPillClass(EL.statePill, kind);
  };

  render.setWhoPill = function (text) {
    dom.setText(EL.whoText, normStr(text) || "—");
  };

  // ------------------------------
  // Hints
  // ------------------------------
  render.setLeftHint = function (text) {
    dom.setText(EL.leftHint, normStr(text) || "");
  };

  render.setAiHint = function (text) {
    dom.setText(EL.aiHint, normStr(text) || "");
  };

  // ------------------------------
  // Training list
  // ------------------------------
  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function makeBtn(label, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "miniBtn";
    b.textContent = label;
    if (title) b.title = title;
    return b;
  }

  function makeCardRow(t, selected) {
    const wrap = document.createElement("div");
    wrap.style.border = "1px solid var(--line)";
    wrap.style.borderRadius = "14px";
    wrap.style.padding = "10px 10px";
    wrap.style.background = selected ? "rgba(17,24,39,.04)" : "var(--card)";
    wrap.style.boxShadow = selected ? "var(--shadow2)" : "none";
    wrap.style.cursor = "pointer";

    const top = document.createElement("div");
    top.style.display = "flex";
    top.style.gap = "8px";
    top.style.alignItems = "center";
    top.style.justifyContent = "space-between";
    top.style.flexWrap = "wrap";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.gap = "2px";
    left.style.minWidth = "220px";
    left.style.flex = "1";

    const title = document.createElement("div");
    title.style.fontWeight = "900";
    title.textContent = normStr(t && t.title) || "(utan titel)";
    left.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "muted2";
    meta.style.textAlign = "left";
    const st = normStr(t && t.status) || "draft";
    const mod = normStr(t && t.module) || "—";
    const area = normStr(t && t.area) || "—";
    meta.textContent = `${st} • ${mod} • ${area}`;
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.alignItems = "center";

    const pill = document.createElement("span");
    pill.className = "pill";
    pill.style.padding = "5px 9px";
    pill.style.fontSize = "12px";
    const dot = document.createElement("span");
    dot.className = "pillDot";
    dot.setAttribute("aria-hidden", "true");
    const txt = document.createElement("span");
    txt.textContent = st === "published" ? "Publicerad" : "Utkast";
    pill.appendChild(dot);
    pill.appendChild(txt);
    setPillClass(pill, st === "published" ? "ok" : "warn");

    right.appendChild(pill);

    top.appendChild(left);
    top.appendChild(right);

    wrap.appendChild(top);
    return wrap;
  }

  render.renderTrainingList = function (opts) {
    const items = safeArr(opts && opts.items);
    const selectedId = normStr(opts && opts.selectedId);
    const onPick = typeof (opts && opts.onPick) === "function" ? opts.onPick : function () { };

    // P0: om list saknas -> fail-closed (ingen throw)
    if (!EL.list) return;

    clearChildren(EL.list);

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "muted2";
      empty.style.padding = "10px 2px";
      empty.textContent = "Ingen träff. Sök eller tryck “Visa alla”.";
      EL.list.appendChild(empty);
      return;
    }

    for (const t of items) {
      const id = normStr(t && t.id);
      const card = makeCardRow(t, id && id === selectedId);
      card.addEventListener("click", function () {
        if (!id) return;
        onPick(id);
      });
      EL.list.appendChild(card);
    }
  };

  // ------------------------------
  // Blocks list (right side)
  // ------------------------------
  function typeLabel(it) {
    const s = normStr(it && it.type).toLowerCase();
    if (s === "question" || s === "quiz") return "Fråga";
    if (s === "task") return "Uppgift";
    if (s === "document" || s === "doc") return "Dokument";
    if (s === "both") return "Mix";
    return "Info";
  }

  function primaryText(it) {
    if (!it) return "";
    if (typeof it === "string") return normStr(it);
    const cand =
      (typeof it.text === "string" && it.text) ||
      (typeof it.instruction === "string" && it.instruction) ||
      (typeof it.prompt === "string" && it.prompt) ||
      (typeof it.question === "string" && it.question) ||
      "";
    return normStr(cand);
  }

  render.renderBlocksList = function (opts) {
    const blocks = safeArr(opts && opts.blocks);
    const onEdit = typeof (opts && opts.onEdit) === "function" ? opts.onEdit : null;
    const onDelete = typeof (opts && opts.onDelete) === "function" ? opts.onDelete : null;

    // P0: om blocksList saknas -> fail-closed (ingen throw)
    if (!EL.blocksList) return;

    clearChildren(EL.blocksList);

    if (!blocks.length) {
      const empty = document.createElement("div");
      empty.className = "muted2";
      empty.style.padding = "10px 2px";
      empty.textContent = "Inga block ännu. Generera via AI eller lägg till senare.";
      EL.blocksList.appendChild(empty);
      return;
    }

    blocks.forEach(function (b, idx) {
      const card = document.createElement("div");
      card.style.border = "1px solid var(--line)";
      card.style.borderRadius = "14px";
      card.style.padding = "10px 10px";
      card.style.background = "var(--card)";
      card.style.boxShadow = "0 2px 10px rgba(17,24,39,.06)";
      card.style.marginBottom = "10px";

      const h = document.createElement("div");
      h.style.display = "flex";
      h.style.justifyContent = "space-between";
      h.style.alignItems = "center";
      h.style.gap = "10px";
      h.style.flexWrap = "wrap";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.flexDirection = "column";
      left.style.gap = "2px";
      left.style.flex = "1";

      const title = document.createElement("div");
      title.style.fontWeight = "900";
      title.textContent = normStr(b && b.title) || ("Block " + (idx + 1));
      left.appendChild(title);

      const items = safeArr(b && b.items);
      const meta = document.createElement("div");
      meta.className = "muted2";
      meta.style.textAlign = "left";
      // P1: plural
      meta.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
      left.appendChild(meta);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.alignItems = "center";

      if (onEdit) {
        const edit = makeBtn("Redigera", "Öppnar enkel editor (baseline)");
        edit.addEventListener("click", function (e) { e.stopPropagation(); onEdit(idx); });
        right.appendChild(edit);
      }
      if (onDelete) {
        const del = makeBtn("Ta bort", "Tar bort blocket (osparat tills du sparar)");
        del.className = "miniBtn danger";
        del.addEventListener("click", function (e) { e.stopPropagation(); onDelete(idx); });
        right.appendChild(del);
      }

      h.appendChild(left);
      h.appendChild(right);
      card.appendChild(h);

      // Preview first 1–2 items (XSS-safe)
      const prev = document.createElement("div");
      prev.style.marginTop = "8px";
      prev.style.display = "flex";
      prev.style.flexDirection = "column";
      prev.style.gap = "6px";

      const take = Math.min(2, items.length);
      for (let i = 0; i < take; i++) {
        const it = items[i];
        const row = document.createElement("div");
        row.style.border = "1px dashed var(--line)";
        row.style.borderRadius = "12px";
        row.style.padding = "8px 10px";
        row.style.background = "rgba(17,24,39,.02)";

        const a = document.createElement("div");
        a.className = "muted2";
        a.style.textAlign = "left";
        a.textContent = typeLabel(it);

        const btxt = document.createElement("div");
        btxt.style.fontWeight = "600";
        btxt.style.textAlign = "left";
        btxt.textContent = primaryText(it) || "—";

        row.appendChild(a);
        row.appendChild(btxt);
        prev.appendChild(row);
      }

      card.appendChild(prev);
      EL.blocksList.appendChild(card);
    });
  };

  // ------------------------------
  // Modal (baseline)
  // ------------------------------
  let _modalEl = null;

  function closeModal() {
    if (_modalEl && _modalEl.parentNode) _modalEl.parentNode.removeChild(_modalEl);
    _modalEl = null;
  }

  render.openModal = function (title, contentNode, onSave) {
    closeModal();

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,.35)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "14px";
    overlay.style.zIndex = "9999";

    // a11y-light
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", normStr(title) || "Dialog");

    const card = document.createElement("div");
    card.style.width = "min(720px, 96vw)";
    card.style.maxHeight = "88vh";
    card.style.overflow = "auto";
    card.style.background = "var(--card)";
    card.style.border = "1px solid var(--line)";
    card.style.borderRadius = "16px";
    card.style.boxShadow = "var(--shadow2)";
    card.style.padding = "14px";

    const h = document.createElement("div");
    h.style.display = "flex";
    h.style.justifyContent = "space-between";
    h.style.alignItems = "center";
    h.style.gap = "10px";
    h.style.flexWrap = "wrap";

    const t = document.createElement("div");
    t.style.fontWeight = "900";
    t.style.fontSize = "16px";
    t.textContent = normStr(title) || "Dialog";

    const x = document.createElement("button");
    x.type = "button";
    x.className = "miniBtn";
    x.textContent = "Stäng";
    x.addEventListener("click", closeModal);

    h.appendChild(t);
    h.appendChild(x);

    const body = document.createElement("div");
    body.style.marginTop = "10px";
    if (contentNode) body.appendChild(contentNode);

    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "10px";
    footer.style.marginTop = "12px";
    footer.style.flexWrap = "wrap";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "miniBtn";
    cancel.textContent = "Avbryt";
    cancel.addEventListener("click", closeModal);

    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn primary";
    save.textContent = "Spara";
    save.addEventListener("click", function () {
      try { if (typeof onSave === "function") onSave(); } catch (_) { }
      closeModal();
    });

    footer.appendChild(cancel);
    footer.appendChild(save);

    card.appendChild(h);
    card.appendChild(body);
    card.appendChild(footer);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });

    // ESC to close (baseline)
    overlay.addEventListener("keydown", function (e) {
      try {
        if (e && (e.key === "Escape" || e.keyCode === 27)) closeModal();
      } catch (_) { }
    });

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    _modalEl = overlay;

    // focus "Stäng"
    try { x.focus && x.focus(); } catch (_) { }
  };

  // ------------------------------
  // Debug view
  // ------------------------------
  render.renderDebug = function (obj) {
    try {
      if (!EL.debugPre) return;
      const json = JSON.stringify(obj, null, 2);
      dom.setText(EL.debugPre, json);
    } catch (_) {
      dom.setText(EL.debugPre, "—");
    }
  };
})();
