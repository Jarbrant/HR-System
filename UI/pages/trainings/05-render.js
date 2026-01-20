/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-05) | FILE 05/06 | FIL-ID: UI/pages/trainings/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render-hjälpare (DOM-only): listor, piller, blocks, modal.
      XSS-safe: all text via textContent. Ingen innerHTML.

POLICY (LÅST):
- UI-only • Fail-closed
- Ingen storage här (03-store)
- Ingen businesslogik här (06-page)
- XSS-safe: textContent, createElement
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.render) return;

  const render = (NS.render = {});
  render.__VERSION = "v1.0.5-PP-SC-010-05";

  // ------------------------------------------------------------
  // DOM helpers (XSS-safe)
  // ------------------------------------------------------------
  function byId(id) { return document.getElementById(String(id || "")); }
  function normStr(v) { return String(v ?? "").trim(); }
  function el(tag, cls) {
    const e = document.createElement(String(tag || "div"));
    if (cls) e.className = String(cls);
    return e;
  }
  function setText(node, txt) { if (node) node.textContent = String(txt ?? ""); }
  function clear(node) { if (!node) return; while (node.firstChild) node.removeChild(node.firstChild); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }

  // ------------------------------------------------------------
  // Expected hooks (IDs) — must match trainings.html
  // ------------------------------------------------------------
  const HOOKS = {
    list: "trainingsList",
    blocks: "blocksList",
    whoPill: "whoPill",
    statePill: "statePill",
    leftHint: "leftHint",
    aiHint: "aiHint",
    modal: "modal",
    modalTitle: "modalTitle",
    modalBody: "modalBody",
    modalOk: "modalOk",
    modalClose: "modalClose"
  };

  function getHook(id) { return byId(HOOKS[id] || id); }

  // ------------------------------------------------------------
  // Pills + hints
  // ------------------------------------------------------------
  render.setWhoPill = function (txt) {
    const n = getHook("whoPill");
    if (n) setText(n, txt);
  };

  render.setStatePill = function (txt, tone) {
    const n = getHook("statePill");
    if (!n) return;
    setText(n, txt);

    // tone: ok|warn|bad
    n.classList.remove("ok", "warn", "bad");
    if (tone === "ok" || tone === "warn" || tone === "bad") n.classList.add(tone);
  };

  render.setLeftHint = function (txt) {
    const n = getHook("leftHint");
    if (n) setText(n, txt);
  };

  render.setAiHint = function (txt) {
    const n = getHook("aiHint");
    if (n) setText(n, txt);
  };

  // ------------------------------------------------------------
  // Trainings list
  // ------------------------------------------------------------
  function makeRow(t, selected, onPick) {
    const row = el("button", "rowBtn");
    row.type = "button";
    row.setAttribute("aria-pressed", selected ? "true" : "false");
    if (selected) row.classList.add("selected");

    const title = normStr(t && t.title) || "(utan titel)";
    const meta = [normStr(t && t.module), normStr(t && t.area), normStr(t && (t.status || "draft"))]
      .filter(Boolean)
      .join(" • ");

    const top = el("div", "rowTitle");
    setText(top, title);

    const sub = el("div", "rowMeta muted2");
    setText(sub, meta);

    row.appendChild(top);
    row.appendChild(sub);

    row.addEventListener("click", function () { if (typeof onPick === "function") onPick(String(t && t.id || "")); });
    return row;
  }

  render.renderTrainingList = function (opts) {
    const o = (opts && typeof opts === "object") ? opts : {};
    const list = getHook("list");
    if (!list) return;

    clear(list);

    const items = safeArr(o.items);
    if (!items.length) {
      const empty = el("div", "muted2");
      setText(empty, "Inga träffar. Skriv i sökfältet eller tryck “Visa alla”.");
      list.appendChild(empty);
      return;
    }

    for (const t of items) {
      const selected = String(o.selectedId || "") && String(t && t.id || "") === String(o.selectedId);
      list.appendChild(makeRow(t, selected, o.onPick));
    }
  };

  // ------------------------------------------------------------
  // Blocks list
  // ------------------------------------------------------------
  function countItems(block) {
    const items = safeArr(block && block.items);
    return items.length;
  }

  function makeBlockCard(block, idx, onEdit, onDelete) {
    const card = el("div", "blockCard");

    const head = el("div", "blockHead");
    const h = el("div", "blockTitle");
    setText(h, normStr(block && block.title) || ("Block " + (idx + 1)));

    const meta = el("div", "muted2");
    setText(meta, countItems(block) + " item");

    head.appendChild(h);
    head.appendChild(meta);

    const actions = el("div", "blockActions");

    const bEdit = el("button", "miniBtn");
    bEdit.type = "button";
    setText(bEdit, "Redigera");
    bEdit.addEventListener("click", function () { if (typeof onEdit === "function") onEdit(idx); });

    const bDel = el("button", "miniBtn danger");
    bDel.type = "button";
    setText(bDel, "Ta bort");
    bDel.addEventListener("click", function () { if (typeof onDelete === "function") onDelete(idx); });

    actions.appendChild(bEdit);
    actions.appendChild(bDel);

    card.appendChild(head);
    card.appendChild(actions);

    return card;
  }

  render.renderBlocksList = function (opts) {
    const o = (opts && typeof opts === "object") ? opts : {};
    const box = getHook("blocks");
    if (!box) return;

    clear(box);

    const blocks = safeArr(o.blocks);
    if (!blocks.length) {
      const empty = el("div", "muted2");
      setText(empty, "Inga block ännu.");
      box.appendChild(empty);
      return;
    }

    for (let i = 0; i < blocks.length; i++) {
      box.appendChild(makeBlockCard(blocks[i], i, o.onEdit, o.onDelete));
    }
  };

  // ------------------------------------------------------------
  // Modal (simple)
  // ------------------------------------------------------------
  function modalEls() {
    return {
      wrap: getHook("modal"),
      title: getHook("modalTitle"),
      body: getHook("modalBody"),
      ok: getHook("modalOk"),
      close: getHook("modalClose")
    };
  }

  function showModal() {
    const m = modalEls();
    if (!m.wrap) return;
    m.wrap.style.display = "";
    m.wrap.setAttribute("aria-hidden", "false");
  }

  function hideModal() {
    const m = modalEls();
    if (!m.wrap) return;
    m.wrap.style.display = "none";
    m.wrap.setAttribute("aria-hidden", "true");
  }

  render.openModal = function (title, bodyNode, onOk) {
    const m = modalEls();
    if (!m.wrap) return;

    setText(m.title, normStr(title) || "Dialog");
    clear(m.body);
    if (bodyNode) m.body.appendChild(bodyNode);

    // reset handlers (cheap)
    const okBtn = m.ok;
    const closeBtn = m.close;

    if (okBtn) {
      const newOk = okBtn.cloneNode(true);
      okBtn.parentNode.replaceChild(newOk, okBtn);
    }
    if (closeBtn) {
      const newClose = closeBtn.cloneNode(true);
      closeBtn.parentNode.replaceChild(newClose, closeBtn);
    }

    const mm = modalEls();

    if (mm.ok) {
      mm.ok.addEventListener("click", function () {
        try { if (typeof onOk === "function") onOk(); } catch (_) { }
        hideModal();
      });
    }
    if (mm.close) mm.close.addEventListener("click", hideModal);

    showModal();
  };

  render.closeModal = hideModal;
})();
