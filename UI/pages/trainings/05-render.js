/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-05) | FILE 05/06 | FIL-ID: UI/pages/trainings/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render-lager för trainings (pills, listor, blocks, modal) • exporterar window.Trainings.render

POLICY (LÅST):
- UI-only • Fail-closed
- XSS-safe: textContent/value, ingen osäker innerHTML
- Inga nya storage-keys (AO-057_TRAININGS_V1 hanteras av 03-store)
- ADMIN-only write (MANAGER/SYSTEM_ADMIN = read-only, hanteras i 06-page/core)
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  // Render-modulen får ALDRIG binda sig till NS.page (det är page-controllerns domän).
  // Skydda endast mot dubbel-laddning av render.
  if (NS.render && NS.render.__VERSION) return;

  const dom = NS.dom || {};

  // -------------------------
  // Safe DOM helpers (fail-closed)
  // -------------------------
  function byId(id) { return document.getElementById(String(id || "")); }

  function pickEl() {
    for (let i = 0; i < arguments.length; i++) {
      const el = arguments[i];
      if (el) return el;
    }
    return null;
  }

  function setText(el, txt) {
    try {
      if (!el) return;
      el.textContent = String(txt ?? "");
    } catch (_) { /* ignore */ }
  }

  function clear(el) {
    try {
      if (!el) return;
      while (el.firstChild) el.removeChild(el.firstChild);
    } catch (_) { /* ignore */ }
  }

  function mk(tag, cls) {
    const el = document.createElement(String(tag || "div"));
    if (cls) el.className = String(cls);
    return el;
  }

  // -------------------------
  // Pill targets (best-effort)
  // -------------------------
  const elWho =
    pickEl(dom.whoText, dom.whoPill, byId("whoText"), byId("whoPill"), byId("who"));

  const elState =
    pickEl(dom.stateText, dom.statePill, byId("stateText"), byId("statePill"), byId("state"));

  const elLeftHint =
    pickEl(dom.leftHint, byId("leftHint"), byId("hintLeft"), byId("leftNote"));

  const elAiHint =
    pickEl(dom.aiHint, byId("aiHint"), byId("hintAI"), byId("aiNote"));

  // -------------------------
  // List containers (best-effort)
  // -------------------------
  function getTrainingListEl() {
    return pickEl(
      dom.trainingList,
      dom.trainingsList,
      dom.listTrainings,
      dom.leftList,
      dom.list,
      byId("trainingList"),
      byId("trainingsList"),
      byId("listTrainings"),
      byId("leftList"),
      byId("list")
    );
  }

  function getBlocksListEl() {
    return pickEl(
      dom.blocksList,
      dom.blockList,
      dom.listBlocks,
      byId("blocksList"),
      byId("blockList"),
      byId("listBlocks"),
      byId("blocks")
    );
  }

  // -------------------------
  // Minimal modal (best-effort)
  // -------------------------
  const modal = {
    wrap: pickEl(dom.modal, byId("modal"), byId("modalWrap"), byId("modalOverlay")),
    title: pickEl(dom.modalTitle, byId("modalTitle")),
    body: pickEl(dom.modalBody, byId("modalBody")),
    btnOk: pickEl(dom.modalOk, byId("modalOk")),
    btnCancel: pickEl(dom.modalCancel, byId("modalCancel")),
    _cb: null,
    _armed: false
  };

  function armModalOnce() {
    if (modal._armed) return;
    modal._armed = true;

    if (modal.btnOk) {
      modal.btnOk.addEventListener("click", function () {
        const cb = modal._cb;
        modal._cb = null;
        hideModal();
        try { if (typeof cb === "function") cb(); } catch (_) {}
      });
    }
    if (modal.btnCancel) {
      modal.btnCancel.addEventListener("click", function () {
        modal._cb = null;
        hideModal();
      });
    }
    if (modal.wrap) {
      // Klick på overlay kan stänga om det ser ut som overlay (fail-safe)
      modal.wrap.addEventListener("click", function (e) {
        try {
          if (e && e.target === modal.wrap && modal.btnCancel) modal.btnCancel.click();
        } catch (_) {}
      });
    }
  }

  function showModal(title, contentEl, onOk) {
    armModalOnce();

    // Om ingen modalstruktur finns: fail-closed fallback (ingen crash).
    if (!modal.wrap || !modal.body) {
      // Sista utväg: fråga om vi ska spara, kör callback.
      const ok = window.confirm(String(title || "Bekräfta") + "\n\n(Modal saknas, fallback)");
      if (ok && typeof onOk === "function") onOk();
      return;
    }

    setText(modal.title, title || "");
    clear(modal.body);

    try {
      if (contentEl && contentEl.nodeType === 1) modal.body.appendChild(contentEl);
      else setText(modal.body, "(tom)");
    } catch (_) {
      setText(modal.body, "(fel vid render)");
    }

    modal._cb = (typeof onOk === "function") ? onOk : null;

    // Visa
    try {
      modal.wrap.style.display = "";
      modal.wrap.setAttribute("aria-hidden", "false");
    } catch (_) { /* ignore */ }
  }

  function hideModal() {
    try {
      if (!modal.wrap) return;
      modal.wrap.style.display = "none";
      modal.wrap.setAttribute("aria-hidden", "true");
    } catch (_) { /* ignore */ }
  }

  // -------------------------
  // Public render API (export)
  // -------------------------
  const render = {
    __VERSION: "v1.0.3-PP-SC-010-05",

    setWhoPill: function (txt) {
      setText(elWho, txt || "");
    },

    setStatePill: function (txt, kind) {
      // kind: "ok" | "warn" | "bad" (best-effort CSS)
      if (elState && elState.classList) {
        elState.classList.remove("ok", "warn", "bad");
        if (kind) elState.classList.add(String(kind));
      }
      setText(elState, txt || "");
    },

    setLeftHint: function (txt) {
      setText(elLeftHint, txt || "");
    },

    setAiHint: function (txt) {
      setText(elAiHint, txt || "");
    },

    renderTrainingList: function (opts) {
      const box = getTrainingListEl();
      if (!box) return;

      const items = (opts && Array.isArray(opts.items)) ? opts.items : [];
      const selectedId = opts && opts.selectedId ? String(opts.selectedId) : "";
      const onPick = opts && typeof opts.onPick === "function" ? opts.onPick : null;

      clear(box);

      if (!items.length) {
        const empty = mk("div", "muted2");
        empty.style.textAlign = "left";
        empty.textContent = "Inget att visa.";
        box.appendChild(empty);
        return;
      }

      for (let i = 0; i < items.length; i++) {
        const t = items[i] || {};
        const id = String(t.id || "");
        const title = String(t.title || "(utan titel)");
        const meta = [t.module, t.area].filter(Boolean).join(" • ");
        const status = String(t.status || "draft");

        const row = mk("button", "rowBtn");
        row.type = "button";

        // XSS-safe: textContent
        const top = mk("div", "rowTop");
        top.textContent = title;

        const sub = mk("div", "rowSub muted2");
        sub.textContent = (meta ? (meta + " • ") : "") + status;

        row.appendChild(top);
        row.appendChild(sub);

        if (id && id === selectedId) row.classList.add("active");

        row.addEventListener("click", function () {
          if (onPick) onPick(id);
        });

        box.appendChild(row);
      }
    },

    renderBlocksList: function (opts) {
      const box = getBlocksListEl();
      if (!box) return;

      const blocks = (opts && Array.isArray(opts.blocks)) ? opts.blocks : [];
      const onEdit = opts && typeof opts.onEdit === "function" ? opts.onEdit : null;
      const onDelete = opts && typeof opts.onDelete === "function" ? opts.onDelete : null;

      clear(box);

      if (!blocks.length) {
        const empty = mk("div", "muted2");
        empty.style.textAlign = "left";
        empty.textContent = "Inga block ännu.";
        box.appendChild(empty);
        return;
      }

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i] || {};
        const title = String(b.title || ("Block " + (i + 1)));
        const count = Array.isArray(b.items) ? b.items.length : 0;

        const row = mk("div", "blockRow");

        const left = mk("div", "blockLeft");
        const h = mk("div", "blockTitle");
        h.textContent = title;
        const s = mk("div", "muted2");
        s.textContent = count + " item";
        left.appendChild(h);
        left.appendChild(s);

        const right = mk("div", "blockRight");
        const btnE = mk("button", "miniBtn");
        btnE.type = "button";
        btnE.textContent = "Redigera";
        btnE.addEventListener("click", function () { if (onEdit) onEdit(i); });

        const btnD = mk("button", "miniBtn danger");
        btnD.type = "button";
        btnD.textContent = "Ta bort";
        btnD.addEventListener("click", function () { if (onDelete) onDelete(i); });

        right.appendChild(btnE);
        right.appendChild(btnD);

        row.appendChild(left);
        row.appendChild(right);
        box.appendChild(row);
      }
    },

    openModal: function (title, contentEl, onOk) {
      showModal(title, contentEl, onOk);
    },

    closeModal: function () {
      hideModal();
    }
  };

  // Export (P0)
  NS.render = render;
})();
