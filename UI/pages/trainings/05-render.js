/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-05) | FILE 05/06 | FIL-ID: UI/pages/trainings/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render/UI-hjälpare för trainings-sidan (listor, blockvy, pills, modal)
      XSS-safe: textContent only. Ingen storage här.

POLICY (LÅST):
- UI-only • Fail-closed
- Ingen storage här (03-store)
- Ingen domänlogik här (02-core/04-contract)
- XSS-safe rendering: textContent, ingen osäker innerHTML
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.render) return;

  const core = NS.core || null;
  const dom = NS.dom || null;
  const render = (NS.render = {});
  render.__VERSION = "v1.0.5-PP-SC-010-05";

  function normStr(v) {
    return (core && core.normStr) ? core.normStr(v) : String(v ?? "").trim();
  }

  function safeArr(a) { return Array.isArray(a) ? a : []; }

  function el(tag, cls) {
    const x = document.createElement(String(tag || "div"));
    if (cls) x.className = String(cls);
    return x;
  }

  function setText(node, text) {
    if (!node) return;
    node.textContent = String(text ?? "");
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ------------------------------------------------------------
  // Top pills (om dom har hooks, annars no-op)
  // ------------------------------------------------------------
  render.setWhoPill = function (text) {
    // Förväntade id från trainings.html: "whoPill" eller "pillWho"
    const n = document.getElementById("whoPill") || document.getElementById("pillWho");
    if (n) setText(n, text);
  };

  render.setStatePill = function (text, tone) {
    // Förväntade id: "statePill" eller "pillState"
    const n = document.getElementById("statePill") || document.getElementById("pillState");
    if (n) {
      setText(n, text);
      // tone: ok|warn|bad -> klass på pill om finns
      try {
        n.classList.remove("ok", "warn", "bad");
        if (tone) n.classList.add(String(tone));
      } catch (_) {}
    }
  };

  render.setLeftHint = function (text) {
    // Förväntade id: "leftHint" eller "hintLeft"
    const n = document.getElementById("leftHint") || document.getElementById("hintLeft");
    if (n) setText(n, text);
  };

  render.setAiHint = function (text) {
    // Förväntade id: "aiHint" (en rad under AI-sektionen)
    const n = document.getElementById("aiHint");
    if (n) setText(n, text);
  };

  // ------------------------------------------------------------
  // Training list
  // ------------------------------------------------------------
  function getListRoot() {
    // Förväntade id i trainings.html: "trainingsList" (eller legacy "list")
    return document.getElementById("trainingsList") || document.getElementById("list");
  }

  render.renderTrainingList = function (opts) {
    const root = getListRoot();
    if (!root) return;

    const o = opts && typeof opts === "object" ? opts : {};
    const items = safeArr(o.items);
    const selectedId = normStr(o.selectedId);
    const onPick = typeof o.onPick === "function" ? o.onPick : function () {};

    clear(root);

    if (!items.length) {
      const empty = el("div", "muted2");
      setText(empty, "Inget att visa ännu. Sök eller klicka “Visa alla”.");
      root.appendChild(empty);
      return;
    }

    for (const t of items) {
      if (!t) continue;
      const id = normStr(t.id);
      const row = el("button", "rowItem");
      row.type = "button";

      const title = el("div", "rowTitle");
      setText(title, normStr(t.title) || "(utan titel)");

      const meta = el("div", "rowMeta");
      const st = normStr(t.status || "draft");
      const mod = normStr(t.module);
      const area = normStr(t.area);
      setText(meta, [st, mod, area].filter(Boolean).join(" • "));

      row.appendChild(title);
      row.appendChild(meta);

      try {
        if (id && id === selectedId) row.classList.add("active");
      } catch (_) {}

      row.addEventListener("click", function () {
        onPick(id);
      });

      root.appendChild(row);
    }
  };

  // ------------------------------------------------------------
  // Blocks list (i editorn)
  // ------------------------------------------------------------
  function getBlocksRoot() {
    // Förväntade id: "blocksList"
    return document.getElementById("blocksList");
  }

  function summarizeBlock(b) {
    const items = (b && Array.isArray(b.items)) ? b.items : [];
    const n = items.length;

    let kinds = { question: 0, task: 0, document: 0 };
    for (const it of items) {
      const k = normStr(it && (it.kind || it.type)).toLowerCase();
      if (k === "question" || k === "quiz") kinds.question++;
      else if (k === "task") kinds.task++;
      else kinds.document++;
    }

    const parts = [];
    if (kinds.document) parts.push(kinds.document + " info");
    if (kinds.task) parts.push(kinds.task + " uppgift");
    if (kinds.question) parts.push(kinds.question + " fråga");
    const right = parts.length ? parts.join(", ") : (n + " item");
    return right;
  }

  render.renderBlocksList = function (opts) {
    const root = getBlocksRoot();
    if (!root) return;

    const o = opts && typeof opts === "object" ? opts : {};
    const blocks = safeArr(o.blocks);
    const onEdit = typeof o.onEdit === "function" ? o.onEdit : function () {};
    const onDelete = typeof o.onDelete === "function" ? o.onDelete : function () {};

    clear(root);

    if (!blocks.length) {
      const empty = el("div", "muted2");
      setText(empty, "Inga block ännu. Skapa via AI eller lägg till senare.");
      root.appendChild(empty);
      return;
    }

    blocks.forEach((b, idx) => {
      const card = el("div", "blockCard");

      const top = el("div", "blockTop");
      const h = el("div", "blockTitle");
      setText(h, (idx + 1) + ". " + (normStr(b && b.title) || "(utan rubrik)"));

      const sub = el("div", "muted2");
      setText(sub, summarizeBlock(b));

      top.appendChild(h);
      top.appendChild(sub);

      const actions = el("div", "rowActions");

      const btnE = el("button", "miniBtn");
      btnE.type = "button";
      setText(btnE, "Redigera");
      btnE.addEventListener("click", function () { onEdit(idx); });

      const btnD = el("button", "miniBtn danger");
      btnD.type = "button";
      setText(btnD, "Ta bort");
      btnD.addEventListener("click", function () { onDelete(idx); });

      actions.appendChild(btnE);
      actions.appendChild(btnD);

      card.appendChild(top);
      card.appendChild(actions);

      root.appendChild(card);
    });
  };

  // ------------------------------------------------------------
  // Simple modal (XSS-safe)
  // ------------------------------------------------------------
  function ensureModal() {
    let overlay = document.getElementById("modalOverlay");
    if (overlay) return overlay;

    overlay = el("div", "modalOverlay");
    overlay.id = "modalOverlay";
    overlay.style.display = "none";

    const box = el("div", "modalBox");
    box.id = "modalBox";

    const head = el("div", "modalHead");
    const title = el("div", "modalTitle");
    title.id = "modalTitle";
    const close = el("button", "miniBtn");
    close.type = "button";
    setText(close, "Stäng");
    close.addEventListener("click", function () { render.closeModal(); });

    head.appendChild(title);
    head.appendChild(close);

    const body = el("div", "modalBody");
    body.id = "modalBody";

    const foot = el("div", "modalFoot");
    const okBtn = el("button", "miniBtn ok");
    okBtn.type = "button";
    okBtn.id = "modalOk";
    setText(okBtn, "Spara");
    okBtn.addEventListener("click", function () {
      const fn = render.__modalOnOk;
      render.__modalOnOk = null;
      render.closeModal();
      try { if (typeof fn === "function") fn(); } catch (_) {}
    });

    foot.appendChild(okBtn);

    box.appendChild(head);
    box.appendChild(body);
    box.appendChild(foot);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // click outside closes
    overlay.addEventListener("click", function (e) {
      if (e && e.target === overlay) render.closeModal();
    });

    return overlay;
  }

  render.openModal = function (titleText, contentNode, onOk) {
    const overlay = ensureModal();
    const title = document.getElementById("modalTitle");
    const body = document.getElementById("modalBody");
    const okBtn = document.getElementById("modalOk");

    if (title) setText(title, titleText || "Dialog");
    if (body) {
      clear(body);
      if (contentNode) body.appendChild(contentNode);
    }

    render.__modalOnOk = typeof onOk === "function" ? onOk : null;

    // Om ingen onOk: byt “Spara” -> “OK” och låt den bara stänga
    if (okBtn) setText(okBtn, render.__modalOnOk ? "Spara" : "OK");

    overlay.style.display = "";
  };

  render.closeModal = function () {
    const overlay = document.getElementById("modalOverlay");
    if (overlay) overlay.style.display = "none";
    render.__modalOnOk = null;
  };
})();
