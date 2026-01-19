/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-02) | FILE 05/06 | FIL-ID: UI/pages/trainings/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render/UI (XSS-safe) för trainings: lista + editor + blocks
Policy (LÅST):
- UI-only • XSS-safe: textContent, inga osäkra innerHTML
- Ingen storage här (bara UI)
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.render) return;

  const render = (NS.render = {});

  function byId(id) { return document.getElementById(String(id || "")); }
  function normStr(v) { return String(v ?? "").trim(); }

  function clear(node) { if (!node) return; while (node.firstChild) node.removeChild(node.firstChild); }

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function pillSet(pillEl, textEl, state /* ok|warn|bad|null */, text) {
    if (!pillEl || !textEl) return;
    pillEl.classList.remove("ok", "warn", "bad");
    if (state) pillEl.classList.add(state);
    textEl.textContent = normStr(text);
  }

  render.setWhoPill = function (whoText) {
    const whoPill = byId("whoPill");
    const whoTextEl = byId("whoText");
    pillSet(whoPill, whoTextEl, null, whoText);
  };

  render.setStatePill = function (state, kind) {
    const pill = byId("statePill");
    const text = byId("stateText");
    const k = String(kind || "").includes("bad") ? "bad" : String(kind || "").includes("warn") ? "warn" : "ok";
    pillSet(pill, text, k, state);
  };

  render.setContext = function (txt) {
    const t = byId("contextText");
    if (t) t.textContent = normStr(txt);
  };

  render.setLeftHint = function (txt) {
    const h = byId("leftHint");
    if (h) h.textContent = normStr(txt);
  };

  render.setAiHint = function (txt) {
    const h = byId("aiHint");
    if (h) h.textContent = normStr(txt);
  };

  render.renderTrainingList = function (args) {
    const list = byId("list");
    if (!list) return;

    const items = Array.isArray(args && args.items) ? args.items : [];
    const selectedId = normStr(args && args.selectedId);
    const onPick = typeof (args && args.onPick) === "function" ? args.onPick : function () { };

    clear(list);

    if (!items.length) {
      const empty = el("div", "muted2");
      empty.style.padding = "10px 0";
      empty.textContent = "Inga utbildningar ännu. Tryck “Skapa ny”.";
      list.appendChild(empty);
      return;
    }

    for (const t of items) {
      const row = el("div", "trainRow");
      row.setAttribute("role", "button");
      row.tabIndex = 0;

      const left = el("div");
      const title = el("div", "title");
      title.textContent = normStr(t.title) || "(utan titel)";

      const meta = el("div", "meta");
      const chip = function (txt) {
        const c = el("span", "chip");
        c.textContent = normStr(txt);
        return c;
      };

      if (t.module) meta.appendChild(chip(t.module));
      if (t.area) meta.appendChild(chip(t.area));
      if (t.courseTitle) meta.appendChild(chip(t.courseTitle));
      if (t.courseStep) meta.appendChild(chip("Steg " + t.courseStep));
      meta.appendChild(chip(String(t.status || "draft") === "published" ? "Publicerad" : "Utkast"));

      left.appendChild(title);
      left.appendChild(meta);

      const right = el("div", "right");
      const sel = el("span", "chip");
      sel.textContent = (normStr(t.id) && normStr(t.id) === selectedId) ? "Vald" : "Öppna";
      right.appendChild(sel);

      // Selected styling
      if (normStr(t.id) && normStr(t.id) === selectedId) {
        row.style.boxShadow = "0 0 0 3px rgba(11,95,255,.18), 0 2px 10px rgba(17,24,39,.05)";
      }

      row.appendChild(left);
      row.appendChild(right);

      const doPick = function () { onPick(t.id); };

      row.addEventListener("click", doPick);
      row.addEventListener("keydown", function (e) {
        if (!e) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          doPick();
        }
      });

      list.appendChild(row);
    }
  };

  render.renderBlocksList = function (args) {
    const host = byId("blocksList");
    if (!host) return;

    const blocks = Array.isArray(args && args.blocks) ? args.blocks : [];
    const onEdit = typeof (args && args.onEdit) === "function" ? args.onEdit : function () { };
    const onDelete = typeof (args && args.onDelete) === "function" ? args.onDelete : function () { };

    clear(host);

    if (!blocks.length) {
      const empty = el("div", "muted2");
      empty.style.padding = "10px 0";
      empty.textContent = "Inga block ännu. Generera med AI eller lägg till manuellt.";
      host.appendChild(empty);
      return;
    }

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i] || {};
      const card = el("div", "blockCard");
      card.setAttribute("data-kind", "both"); // trainings blocks can mix kinds

      const head = el("div", "blockHead");
      const left = el("div", "blockLeft");

      const dot = el("span", "blockTypeDot");
      left.appendChild(dot);

      const title = el("div");
      title.style.fontWeight = "900";
      title.textContent = normStr(b.title) || ("Block " + (i + 1));

      const meta = el("div", "muted2");
      meta.style.textAlign = "left";
      meta.textContent = `Items: ${Array.isArray(b.items) ? b.items.length : 0}`;

      left.appendChild(title);
      left.appendChild(meta);

      const right = el("div");
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.alignItems = "center";

      const btnEdit = el("button", "miniBtn");
      btnEdit.type = "button";
      btnEdit.textContent = "Redigera";
      btnEdit.addEventListener("click", function () { onEdit(i); });

      const btnDel = el("button", "miniBtn danger");
      btnDel.type = "button";
      btnDel.textContent = "Ta bort";
      btnDel.addEventListener("click", function () { onDelete(i); });

      right.appendChild(btnEdit);
      right.appendChild(btnDel);

      head.appendChild(left);
      head.appendChild(right);

      card.appendChild(head);

      // Preview: show first question/doc line to give overview (no innerHTML)
      const pv = el("div", "muted2");
      pv.style.textAlign = "left";
      pv.style.marginTop = "8px";
      const first = (function () {
        const its = Array.isArray(b.items) ? b.items : [];
        for (const it of its) {
          const txt = normStr(it && (it.text || it.instruction || ""));
          if (txt) return txt.split("\n")[0].slice(0, 120);
        }
        return "";
      })();
      pv.textContent = first ? ("Förhandsvisning: " + first + (first.length >= 120 ? "…" : "")) : "Förhandsvisning: —";
      card.appendChild(pv);

      host.appendChild(card);
    }
  };

  // Simple modal “word-document” editor (PP-SC-010-02 baseline)
  render.ensureModal = function () {
    let overlay = document.querySelector("[data-tr-modal='overlay']");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.setAttribute("data-tr-modal", "overlay");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(15,23,42,.55)";
    overlay.style.display = "none";
    overlay.style.zIndex = "9999";
    overlay.style.padding = "22px";

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.style.maxWidth = "980px";
    dialog.style.margin = "0 auto";
    dialog.style.background = "var(--card)";
    dialog.style.border = "1px solid var(--line)";
    dialog.style.borderRadius = "16px";
    dialog.style.boxShadow = "var(--shadow2)";
    dialog.style.overflow = "hidden";

    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.justifyContent = "space-between";
    head.style.gap = "10px";
    head.style.alignItems = "center";
    head.style.padding = "12px 14px";
    head.style.borderBottom = "1px solid var(--line)";

    const title = document.createElement("div");
    title.setAttribute("data-tr-modal", "title");
    title.style.fontWeight = "950";
    title.textContent = "Redigera";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "miniBtn";
    close.textContent = "Stäng";
    close.addEventListener("click", function () { render.closeModal(); });

    head.appendChild(title);
    head.appendChild(close);

    const body = document.createElement("div");
    body.setAttribute("data-tr-modal", "body");
    body.style.padding = "14px";
    body.style.maxHeight = "78vh";
    body.style.overflow = "auto";

    const foot = document.createElement("div");
    foot.style.display = "flex";
    foot.style.justifyContent = "flex-end";
    foot.style.gap = "10px";
    foot.style.padding = "12px 14px";
    foot.style.borderTop = "1px solid var(--line)";

    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.className = "miniBtn";
    btnCancel.textContent = "Avbryt";
    btnCancel.addEventListener("click", function () { render.closeModal(); });

    const btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.className = "btn primary";
    btnSave.textContent = "Spara";
    btnSave.setAttribute("data-tr-modal", "save");

    foot.appendChild(btnCancel);
    foot.appendChild(btnSave);

    dialog.appendChild(head);
    dialog.appendChild(body);
    dialog.appendChild(foot);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    return overlay;
  };

  render.openModal = function (metaText, contentNode, onSave) {
    const overlay = render.ensureModal();
    const title = overlay.querySelector("[data-tr-modal='title']");
    const body = overlay.querySelector("[data-tr-modal='body']");
    const btnSave = overlay.querySelector("[data-tr-modal='save']");

    if (title) title.textContent = normStr(metaText) || "Redigera";
    clear(body);
    if (contentNode) body.appendChild(contentNode);

    // wire save
    const handler = function () {
      try { onSave && onSave(); } catch (_) { }
      render.closeModal();
    };
    btnSave.onclick = handler;

    overlay.style.display = "block";
    overlay.setAttribute("aria-hidden", "false");
  };

  render.closeModal = function () {
    const overlay = document.querySelector("[data-tr-modal='overlay']");
    if (!overlay) return;
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
  };

  render.__VERSION = "v1.0-PP-SC-010-02";
})();

