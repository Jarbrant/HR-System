/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-05) | FILE 05/06 | FIL-ID: UI/pages/trainings/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Rendering för trainings (UI-only)
      - Uppdatera pills (who/state)
      - Vänster hint
      - Lista utbildningar
      - Lista block + actions
      - Modal (enkel, textContent-only)

POLICY (LÅST):
- UI-only • Fail-closed
- XSS-safe: endast textContent (ingen osäker innerHTML)
- Ingen storage • ingen fetch
- Respektera befintliga DOM-id (trainings.html)

PATCH v1.0.0 (PP-SC-010-05):
- Stabil minimal render-layer som 06-page kan anropa
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.render) return;

  const render = (NS.render = {});
  render.__VERSION = "v1.0.0-PP-SC-010-05";

  // ------------------------------
  // DOM helpers (safe)
  // ------------------------------
  function byId(id) { return document.getElementById(String(id || "")); }
  function normStr(v) { return String(v ?? "").trim(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }

  function setText(el, txt) {
    if (!el) return;
    el.textContent = String(txt ?? "");
  }

  function clear(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function el(tag, cls, txt) {
    const e = document.createElement(String(tag || "div"));
    if (cls) e.className = String(cls);
    if (txt != null) e.textContent = String(txt);
    return e;
  }

  function btn(cls, label, title, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    if (cls) b.className = cls;
    b.textContent = String(label || "Knapp");
    if (title) b.title = String(title);
    if (typeof onClick === "function") b.addEventListener("click", onClick);
    return b;
  }

  // ------------------------------
  // Pills / hints
  // ------------------------------
  const $ = {
    contextPill: byId("contextPill"),
    contextText: byId("contextText"),

    statePill: byId("statePill"),
    stateText: byId("stateText"),

    whoPill: byId("whoPill"),
    whoText: byId("whoText"),

    leftHint: byId("leftHint"),

    list: byId("list"),
    blocksList: byId("blocksList"),
    debugPre: byId("debugPre"),

    aiHint: byId("aiHint"),
    aiContent: byId("aiContent"),
    questionControls: byId("questionControls")
  };

  function setPillKind(pillEl, kind) {
    if (!pillEl) return;
    pillEl.classList.remove("ok", "warn", "bad");
    if (kind === "ok" || kind === "warn" || kind === "bad") pillEl.classList.add(kind);
  }

  render.setWhoPill = function (text) {
    setText($.whoText, text || "—");
  };

  render.setStatePill = function (text, kind) {
    setText($.stateText, text || "Status: —");
    setPillKind($.statePill, kind || "");
  };

  render.setLeftHint = function (text) {
    setText($.leftHint, text || "");
  };

  render.setAiHint = function (text) {
    setText($.aiHint, text || "");
  };

  // ------------------------------
  // Toggle: question controls
  // (UI-hjälp, men fail-safe om saknas)
  // ------------------------------
  render.syncQuestionControls = function () {
    try {
      if (!$.aiContent || !$.questionControls) return;
      const v = normStr($.aiContent.value).toLowerCase();
      // Visas främst för "questions"/prov. Om "blocks" -> kan döljas.
      const show = (v === "questions" || v === "question" || v === "quiz");
      $.questionControls.style.display = show ? "" : "none";
    } catch (_) { /* ignore */ }
  };

  // ------------------------------
  // Training list rendering
  // ------------------------------
  function buildTrainingRow(t, selected, onPick) {
    const row = el("div", "row");
    row.style.display = "flex";
    row.style.alignItems = "stretch";
    row.style.justifyContent = "space-between";
    row.style.gap = "10px";
    row.style.padding = "10px 10px";
    row.style.border = "1px solid var(--line)";
    row.style.borderRadius = "14px";
    row.style.background = "var(--card)";
    row.style.boxShadow = "0 2px 10px rgba(17,24,39,.06)";
    row.style.cursor = "pointer";

    if (selected) {
      row.style.outline = "3px solid rgba(11,95,255,.22)";
      row.style.boxShadow = "0 0 0 6px rgba(11,95,255,.10)";
    }

    const left = el("div");
    left.style.flex = "1";
    left.style.minWidth = "0";

    const title = el("div", null, normStr(t && t.title) || "(utan titel)");
    title.style.fontWeight = "900";
    title.style.fontSize = "14px";
    title.style.lineHeight = "1.2";

    const meta = el(
      "div",
      "muted2",
      (normStr(t && t.module) || "—") +
        " • " +
        (normStr(t && t.area) || "—") +
        " • " +
        ("Steg " + (normStr(t && t.courseStep) || "—"))
    );
    meta.style.marginTop = "4px";
    meta.style.textAlign = "left";

    const status = el("div", "muted2", (t && t.status === "published") ? "Publicerad" : "Utkast");
    status.style.marginTop = "4px";
    status.style.textAlign = "left";
    status.style.fontSize = "12px";

    left.appendChild(title);
    left.appendChild(meta);
    left.appendChild(status);

    const right = el("div");
    right.style.display = "flex";
    right.style.flexDirection = "column";
    right.style.alignItems = "flex-end";
    right.style.justifyContent = "space-between";
    right.style.gap = "8px";

    const chip = el("span", "pill", "");
    chip.style.padding = "5px 9px";
    chip.style.fontSize = "12px";

    const dot = el("span", "pillDot");
    dot.setAttribute("aria-hidden", "true");
    const txt = el("span", null, (t && t.status === "published") ? "PUB" : "DRAFT");

    chip.appendChild(dot);
    chip.appendChild(txt);

    // färgindikator
    chip.classList.add((t && t.status === "published") ? "ok" : "warn");

    right.appendChild(chip);

    row.appendChild(left);
    row.appendChild(right);

    row.addEventListener("click", function () {
      if (typeof onPick === "function") onPick(String(t && t.id ? t.id : ""));
    });

    return row;
  }

  render.renderTrainingList = function (opts) {
    const listEl = $.list;
    if (!listEl) return;

    clear(listEl);

    const items = safeArr(opts && opts.items);
    const selectedId = normStr(opts && opts.selectedId);
    const onPick = opts && opts.onPick;

    if (!items.length) {
      const empty = el("div", "muted2", "Ingen träff. Sök eller klicka “Visa alla”.");
      empty.style.padding = "10px 2px";
      listEl.appendChild(empty);
      return;
    }

    for (const t of items) {
      const tid = normStr(t && t.id);
      const row = buildTrainingRow(t, tid && selectedId && tid === selectedId, onPick);
      listEl.appendChild(row);
    }
  };

  // ------------------------------
  // Blocks list rendering
  // ------------------------------
  function describeBlock(b, idx) {
    const title = normStr(b && b.title) || ("Block " + (idx + 1));
    const items = (b && Array.isArray(b.items)) ? b.items : [];
    const n = items.length;
    return { title, n };
  }

  function buildBlockCard(desc, idx, handlers) {
    const card = el("div");
    card.style.border = "1px solid var(--line)";
    card.style.borderRadius = "14px";
    card.style.background = "var(--card)";
    card.style.boxShadow = "0 2px 10px rgba(17,24,39,.06)";
    card.style.padding = "12px";
    card.style.display = "flex";
    card.style.gap = "10px";
    card.style.justifyContent = "space-between";
    card.style.alignItems = "flex-start";

    const left = el("div");
    left.style.flex = "1";
    left.style.minWidth = "0";

    const h = el("div", null, desc.title);
    h.style.fontWeight = "900";
    h.style.fontSize = "14px";
    h.style.lineHeight = "1.2";

    const meta = el("div", "muted2", "Items: " + desc.n);
    meta.style.textAlign = "left";
    meta.style.marginTop = "6px";

    left.appendChild(h);
    left.appendChild(meta);

    const right = el("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.flexWrap = "wrap";
    right.style.justifyContent = "flex-end";

    const onEdit = handlers && handlers.onEdit;
    const onDelete = handlers && handlers.onDelete;

    right.appendChild(
      btn("miniBtn", "Redigera", "Redigera block (baseline)", function () {
        if (typeof onEdit === "function") onEdit(idx);
      })
    );

    right.appendChild(
      btn("miniBtn danger", "Ta bort", "Ta bort block", function () {
        if (typeof onDelete === "function") onDelete(idx);
      })
    );

    card.appendChild(left);
    card.appendChild(right);
    return card;
  }

  render.renderBlocksList = function (opts) {
    const host = $.blocksList;
    if (!host) return;

    clear(host);

    const blocks = safeArr(opts && opts.blocks);
    const onEdit = opts && opts.onEdit;
    const onDelete = opts && opts.onDelete;

    if (!blocks.length) {
      const empty = el("div", "muted2", "Inga block än. Använd AI eller skapa block senare.");
      empty.style.padding = "10px 2px";
      host.appendChild(empty);
      return;
    }

    const stack = el("div");
    stack.style.display = "flex";
    stack.style.flexDirection = "column";
    stack.style.gap = "10px";

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const desc = describeBlock(b, i);
      stack.appendChild(buildBlockCard(desc, i, { onEdit, onDelete }));
    }

    host.appendChild(stack);
  };

  // ------------------------------
  // Modal (safe, minimal)
  // ------------------------------
  render.openModal = function (title, contentNode, onSave) {
    // fail-safe: om något saknas, gör ingenting
    try {
      const overlay = el("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(0,0,0,.35)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.padding = "16px";
      overlay.style.zIndex = "9999";

      const panel = el("div");
      panel.style.width = "min(720px, 96vw)";
      panel.style.maxHeight = "min(80vh, 760px)";
      panel.style.overflow = "auto";
      panel.style.background = "var(--card)";
      panel.style.border = "1px solid var(--line)";
      panel.style.borderRadius = "18px";
      panel.style.boxShadow = "0 18px 50px rgba(17,24,39,.22)";
      panel.style.padding = "14px";

      const head = el("div");
      head.style.display = "flex";
      head.style.justifyContent = "space-between";
      head.style.alignItems = "center";
      head.style.gap = "10px";
      head.style.marginBottom = "10px";

      const h = el("div", null, normStr(title) || "Dialog");
      h.style.fontWeight = "950";
      h.style.fontSize = "16px";

      const closeBtn = btn("miniBtn", "Stäng", "Stäng dialog", function () {
        document.body.removeChild(overlay);
      });

      head.appendChild(h);
      head.appendChild(closeBtn);

      const body = el("div");
      body.style.padding = "6px 0 12px";

      if (contentNode && contentNode.nodeType) body.appendChild(contentNode);
      else body.appendChild(el("div", "muted2", "Innehåll saknas."));

      const foot = el("div");
      foot.style.display = "flex";
      foot.style.justifyContent = "flex-end";
      foot.style.gap = "10px";
      foot.style.borderTop = "1px solid var(--line)";
      foot.style.paddingTop = "12px";

      const cancel = btn("miniBtn", "Avbryt", "Stäng utan att spara", function () {
        document.body.removeChild(overlay);
      });

      const save = btn("btn primary", "Spara", "Spara ändringar", function () {
        try { if (typeof onSave === "function") onSave(); } catch (_) { /* ignore */ }
        document.body.removeChild(overlay);
      });

      foot.appendChild(cancel);
      foot.appendChild(save);

      panel.appendChild(head);
      panel.appendChild(body);
      panel.appendChild(foot);
      overlay.appendChild(panel);

      // Close on overlay click (but not on panel click)
      overlay.addEventListener("click", function (e) {
        if (e && e.target === overlay) {
          document.body.removeChild(overlay);
        }
      });

      document.body.appendChild(overlay);
      save.focus && save.focus();
    } catch (_) {
      // fail-closed: ingen modal
    }
  };

  // ------------------------------
  // Debug rendering (valfri)
  // ------------------------------
  render.renderDebug = function (obj) {
    if (!$.debugPre) return;
    try {
      const s = JSON.stringify(obj ?? null, null, 2);
      setText($.debugPre, s);
    } catch (_) {
      setText($.debugPre, "—");
    }
  };

  // Init: koppla question controls om element finns
  try {
    if ($.aiContent) $.aiContent.addEventListener("change", render.syncQuestionControls);
    render.syncQuestionControls();
  } catch (_) { /* ignore */ }
})();
