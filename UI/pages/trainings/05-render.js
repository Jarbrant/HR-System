/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-05) | FILE 05/06 | FIL-ID: UI/pages/trainings/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: DOM-render helpers för trainings (lista, blocks, status pills, hints, modal)
      XSS-safe: endast textContent via dom.setText (ingen osäker innerHTML)

POLICY (LÅST):
- UI-only • Fail-closed
- Ingen storage här (03-store)
- Ingen affärslogik här (06-page)
- XSS-safe: textContent / createElement
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.render) return;

  const dom = NS.dom || null;
  const render = (NS.render = {});
  render.__VERSION = "v1.0.5-PP-SC-010-05";

  function byId(id) { return document.getElementById(String(id || "")); }

  function safeText(v) { return String(v ?? ""); }

  function clear(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function setText(el, txt) {
    if (dom && typeof dom.setText === "function") return dom.setText(el, txt);
    if (!el) return;
    el.textContent = safeText(txt);
  }

  function pillClass(kind) {
    // kind: ok|warn|bad
    if (kind === "ok") return "pill ok";
    if (kind === "warn") return "pill warn";
    if (kind === "bad") return "pill bad";
    return "pill";
  }

  // ------------------------------------------------------------
  // Top pills + hints
  // ------------------------------------------------------------
  render.setWhoPill = function (text) {
    const el = byId("whoPill");
    if (el) {
      el.className = "pill";
      setText(el, safeText(text));
    }
  };

  render.setStatePill = function (text, kind) {
    const el = byId("statePill");
    if (el) {
      el.className = pillClass(kind);
      setText(el, safeText(text));
    }
  };

  render.setLeftHint = function (text) {
    const el = byId("leftHint");
    if (el) setText(el, safeText(text));
  };

  render.setAiHint = function (text) {
    const el = byId("aiHint");
    if (el) setText(el, safeText(text));
  };

  // ------------------------------------------------------------
  // Trainings list (vänsterkolumn)
  // ------------------------------------------------------------
  render.renderTrainingList = function (opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const items = Array.isArray(o.items) ? o.items : [];
    const selectedId = safeText(o.selectedId || "");
    const onPick = typeof o.onPick === "function" ? o.onPick : function () {};

    const host = byId("listHost");
    if (!host) return;

    clear(host);

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "muted2";
      empty.style.padding = "10px";
      empty.textContent = "Inget att visa. Sök eller tryck “Visa alla”.";
      host.appendChild(empty);
      return;
    }

    for (const t of items) {
      const id = safeText(t && t.id);
      const title = safeText(t && (t.title || "(utan titel)"));
      const module = safeText(t && t.module);
      const area = safeText(t && t.area);
      const status = safeText(t && t.status);

      const row = document.createElement("button");
      row.type = "button";
      row.className = "listRow" + (id && id === selectedId ? " active" : "");
      row.setAttribute("data-id", id);

      const top = document.createElement("div");
      top.className = "listRowTop";
      top.textContent = title;

      const sub = document.createElement("div");
      sub.className = "listRowSub";
      sub.textContent = (module || area) ? `${module}${module && area ? " • " : ""}${area}` : "—";

      const badge = document.createElement("span");
      badge.className = "badge " + (status === "published" ? "pub" : "draft");
      badge.textContent = (status === "published") ? "Publicerad" : "Utkast";

      const right = document.createElement("div");
      right.className = "listRowRight";
      right.appendChild(badge);

      row.appendChild(top);
      row.appendChild(sub);
      row.appendChild(right);

      row.addEventListener("click", function () {
        onPick(id);
      });

      host.appendChild(row);
    }
  };

  // ------------------------------------------------------------
  // Blocks list (högerkolumn, i editorn)
  // ------------------------------------------------------------
  render.renderBlocksList = function (opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const blocks = Array.isArray(o.blocks) ? o.blocks : [];
    const onEdit = typeof o.onEdit === "function" ? o.onEdit : function () {};
    const onDelete = typeof o.onDelete === "function" ? o.onDelete : function () {};

    const host = byId("blocksHost");
    if (!host) return;

    clear(host);

    if (!blocks.length) {
      const empty = document.createElement("div");
      empty.className = "muted2";
      empty.style.padding = "10px";
      empty.textContent = "Inga block ännu. Använd “Skapa med AI” eller lägg till manuellt.";
      host.appendChild(empty);
      return;
    }

    blocks.forEach((b, idx) => {
      const card = document.createElement("div");
      card.className = "blockCard";

      const header = document.createElement("div");
      header.className = "blockCardTop";

      const title = document.createElement("div");
      title.className = "blockTitle";
      title.textContent = safeText((b && b.title) || ("Block " + (idx + 1)));

      const meta = document.createElement("div");
      meta.className = "muted2";
      const n = (b && Array.isArray(b.items)) ? b.items.length : 0;
      meta.textContent = `${n} item`;

      header.appendChild(title);
      header.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "blockActions";

      const btnEdit = document.createElement("button");
      btnEdit.type = "button";
      btnEdit.className = "miniBtn";
      btnEdit.textContent = "Redigera";
      btnEdit.addEventListener("click", function () { onEdit(idx); });

      const btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "miniBtn danger";
      btnDel.textContent = "Ta bort";
      btnDel.addEventListener("click", function () { onDelete(idx); });

      actions.appendChild(btnEdit);
      actions.appendChild(btnDel);

      card.appendChild(header);
      card.appendChild(actions);

      host.appendChild(card);
    });
  };

  // ------------------------------------------------------------
  // Modal (enkel, fail-safe)
  // ------------------------------------------------------------
  render.openModal = function (titleText, contentEl, onOk) {
    const overlay = byId("modalOverlay");
    const title = byId("modalTitle");
    const body = byId("modalBody");
    const btnOk = byId("modalOk");
    const btnCancel = byId("modalCancel");

    // Om modal-HTML saknas: fallback alert-ish (fail-safe)
    if (!overlay || !title || !body || !btnOk || !btnCancel) {
      try {
        if (contentEl && contentEl.querySelector) {
          const ta = contentEl.querySelector("textarea");
          if (ta && typeof onOk === "function") {
            const next = prompt(String(titleText || "Redigera"), String(ta.value || ""));
            if (next != null) {
              ta.value = next;
              onOk();
            }
          }
        }
      } catch (_) {}
      return;
    }

    setText(title, safeText(titleText));
    clear(body);
    if (contentEl) body.appendChild(contentEl);

    const close = function () {
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");
      // cleanup handlers
      btnOk.onclick = null;
      btnCancel.onclick = null;
    };

    btnCancel.onclick = function () { close(); };

    btnOk.onclick = function () {
      try { if (typeof onOk === "function") onOk(); } catch (_) {}
      close();
    };

    overlay.style.display = "block";
    overlay.setAttribute("aria-hidden", "false");
  };

})();
