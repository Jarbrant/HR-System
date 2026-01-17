/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 05/06 | FIL-ID: UI/pages/packages-block/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: All rendering (XSS-safe) + små UI helpers
Policy (LÅST):
- UI-only
- XSS-safe: endast textContent + createElement
- Ingen storage här
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.render) return; // idempotent

  const dom = NS.dom || null;

  function byId(id) { return document.getElementById(String(id || "")); }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  function t(el, text) { if (el) el.textContent = String(text ?? ""); }
  function pillClass(base, state) {
    if (!state) return base;
    return `${base} ${state}`;
  }

  function setMsg(kind, text) {
    const el = byId("msgBox");
    if (!el) return;
    const msg = String(text || "");
    el.style.display = msg ? "block" : "none";
    el.className = "msg" + (kind ? " " + kind : "");
    el.textContent = msg;
  }

  function showLockBox(lines) {
    const box = byId("lockBox");
    if (!box) return;
    const arr = Array.isArray(lines) ? lines.filter(Boolean) : [];
    box.style.display = arr.length ? "block" : "none";
    clear(box);
    if (!arr.length) return;
    const ul = document.createElement("ul");
    for (const s of arr) {
      const li = document.createElement("li");
      li.textContent = String(s);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  function setStatePill(text, cls) {
    const el = byId("statePill");
    if (!el) return;
    el.textContent = String(text || "Status: —");
    if (cls) el.className = cls;
  }
  function setSelectionPill(text) {
    const el = byId("selPill");
    if (!el) return;
    el.textContent = String(text || "Val: —");
  }

  function setWhoPill(text) {
    const el = byId("whoPill");
    if (!el) return;
    el.style.display = "inline-flex";
    el.textContent = String(text || "");
  }

  function setModePill(text, cls) {
    const el = byId("modePill");
    if (!el) return;
    el.style.display = "inline-flex";
    el.textContent = String(text || "");
    if (cls) el.className = cls;
  }

  function setVerifyPill(text, cls, show) {
    const el = byId("verifyPill");
    if (!el) return;
    el.style.display = show ? "inline-flex" : "none";
    el.textContent = String(text || "Verifiering: —");
    if (cls) el.className = cls;
  }

  function setTopEditing(text, show) {
    const box = byId("topEditing");
    const tx = byId("topEditingText");
    if (!box || !tx) return;
    box.style.display = show ? "inline-flex" : "none";
    tx.textContent = String(text || "—");
  }

  function countText(comp) {
    if (!comp) return "—";
    return `Hittat: ${comp.items} item(s) • ❓ ${comp.q} • 📄 ${comp.d} • ✅ ${comp.t} • ❗ ${comp.missingKey} (saknar facit)`;
  }

  function renderBlockList({ discoveryActive, allCount, visible, selectedBlockId, onSelect }) {
    const list = byId("blockList");
    const count = byId("countBlocks");
    if (count) {
      if (!discoveryActive) count.textContent = "Sök för att visa block. (Inga block hittade ännu.)";
      else count.textContent = `${visible.length} / ${allCount} block`;
    }
    if (!list) return;

    clear(list);

    if (!discoveryActive) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Sök eller tryck “Visa alla” för att se block.";
      list.appendChild(m);
      return;
    }

    if (!visible.length) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Inga block matchar filtret.";
      list.appendChild(m);
      return;
    }

    for (const b of visible) {
      const row = document.createElement("div");
      row.className = "rowItem" + (b.blockId === selectedBlockId ? " active" : "");
      row.tabIndex = 0;

      row.addEventListener("click", function () { if (typeof onSelect === "function") onSelect(b.blockId); });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (typeof onSelect === "function") onSelect(b.blockId); }
      });

      const top = document.createElement("div");
      top.className = "rowTop";

      const left = document.createElement("div");
      left.style.minWidth = "0";

      const title = document.createElement("div");
      title.className = "rowTitle";
      title.textContent = b.title || "(utan rubrik)";

      const meta = document.createElement("div");
      meta.className = "tiny muted2";
      meta.textContent =
        `Modul: ${b.module || "—"}\n` +
        `Område: ${b.area || "—"}\n` +
        `Steg: ${b.step || "—"}`;

      left.appendChild(title);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.className = "tiny";
      right.textContent = (b.status === "published") ? "Publicerad" : "Redo";

      top.appendChild(left);
      top.appendChild(right);
      row.appendChild(top);

      const qa = document.createElement("div");
      qa.className = "qaLine";
      const s = document.createElement("span");
      s.className = "tiny muted2";
      s.textContent = countText(b.__comp);
      qa.appendChild(s);
      row.appendChild(qa);

      list.appendChild(row);
    }
  }

  function renderSelectedDetail({ block, canEdit, validationReasons, onPatchItem }) {
    const host = byId("selDetail");
    const hint = byId("selHint");
    if (!host) return;

    clear(host);

    if (!block) {
      if (hint) hint.textContent = "Välj ett block i vänsterlistan för att se frågor + facit.";
      return;
    }

    if (hint) hint.textContent = "Redigera text/facit i items. Spara ändringar sparar som utkast.";

    // Basic meta (read-only for now)
    const meta = document.createElement("div");
    meta.className = "tiny muted2";
    meta.textContent =
      `blockId: ${block.blockId}\n` +
      `status: ${block.status}\n` +
      `module: ${block.module || "—"}\n` +
      `area: ${block.area || "—"}\n` +
      `step: ${block.step || "—"}`;
    host.appendChild(meta);

    // Validation reasons
    if (Array.isArray(validationReasons) && validationReasons.length) {
      const box = document.createElement("div");
      box.className = "errList";
      const h = document.createElement("div");
      h.className = "h";
      h.textContent = "Problem (fail-closed):";
      box.appendChild(h);
      const ul = document.createElement("ul");
      for (const r of validationReasons) {
        const li = document.createElement("li");
        li.textContent = String(r);
        ul.appendChild(li);
      }
      box.appendChild(ul);
      host.appendChild(box);
    }

    const items = Array.isArray(block.items) ? block.items : [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const card = document.createElement("div");
      card.className = "itemCard";

      const top = document.createElement("div");
      top.className = "itemRowTop";

      const k = document.createElement("div");
      k.className = "tiny";
      k.textContent = `#${i + 1} • ${String(it.kind || "document")}`;

      top.appendChild(k);
      card.appendChild(top);

      // text field
      const lbl = document.createElement("div");
      lbl.className = "fieldLbl tiny";
      lbl.textContent = "Text";
      card.appendChild(lbl);

      const ta = document.createElement("textarea");
      ta.value = String(it.text || "");
      ta.disabled = !canEdit;

      ta.addEventListener("input", function () {
        if (!canEdit) return;
        if (typeof onPatchItem === "function") {
          onPatchItem(i, function (cur) {
            const next = Object.assign({}, cur);
            next.text = ta.value;
            return next;
          });
        }
      });

      card.appendChild(ta);

      // question extras
      if (String(it.kind) === "question") {
        const lbl2 = document.createElement("div");
        lbl2.className = "fieldLbl tiny";
        lbl2.textContent = "Alternativ (options)";
        card.appendChild(lbl2);

        const opts = Array.isArray(it.options) ? it.options : [];
        if (!opts.length) {
          const m = document.createElement("div");
          m.className = "tiny muted2";
          m.textContent = "Inga options (då är answerType=text tillåtet).";
          card.appendChild(m);
        } else {
          for (let j = 0; j < opts.length; j++) {
            const row = document.createElement("div");
            row.className = "optRow";
            const inp = document.createElement("input");
            inp.type = "text";
            inp.value = String(opts[j] || "");
            inp.disabled = !canEdit;
            inp.addEventListener("input", function () {
              if (!canEdit) return;
              onPatchItem(i, function (cur) {
                const next = Object.assign({}, cur);
                const arr = Array.isArray(next.options) ? next.options.slice() : [];
                arr[j] = inp.value;
                next.options = arr;
                return next;
              });
            });
            row.appendChild(inp);
            card.appendChild(row);
          }
        }

        const lbl3 = document.createElement("div");
        lbl3.className = "fieldLbl tiny";
        lbl3.textContent = "Facit (answerKey)";
        card.appendChild(lbl3);

        const ak = document.createElement("input");
        ak.type = "text";
        ak.value = String(it.answerKey || "");
        ak.disabled = !canEdit;
        ak.addEventListener("input", function () {
          if (!canEdit) return;
          onPatchItem(i, function (cur) {
            const next = Object.assign({}, cur);
            next.answerKey = ak.value;
            return next;
          });
        });
        card.appendChild(ak);
      }

      host.appendChild(card);
    }
  }

  function renderTrainingHits({ hits, corrupt, missing, onPickTraining }) {
    const host = byId("trainPreview");
    if (!host) return;
    clear(host);

    if (corrupt) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Utbildningar är korrupta (fail-closed).";
      host.appendChild(m);
      return;
    }
    if (missing) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Inga utbildningar hittades (AO-057_TRAININGS_V1 saknas).";
      host.appendChild(m);
      return;
    }
    if (!Array.isArray(hits) || !hits.length) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Inga träffar.";
      host.appendChild(m);
      return;
    }

    for (const h of hits.slice(0, 50)) {
      const row = document.createElement("div");
      row.className = "exportRow" + (h.active ? " active" : "");
      row.tabIndex = 0;

      row.addEventListener("click", function () { if (typeof onPickTraining === "function") onPickTraining(h.index); });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (typeof onPickTraining === "function") onPickTraining(h.index); }
      });

      const left = document.createElement("div");
      left.className = "left";

      const t1 = document.createElement("div");
      t1.className = "t";
      t1.textContent = h.title;

      const s1 = document.createElement("div");
      s1.className = "tiny muted2 s";
      s1.textContent = `Modul: ${h.module || "—"}\nOmråde: ${h.area || "—"}\nSteg: ${h.step || "—"}`;

      left.appendChild(t1);
      left.appendChild(s1);

      const right = document.createElement("div");
      right.className = "tiny";
      right.textContent = `${h.itemsCount} item(s)`;

      row.appendChild(left);
      row.appendChild(right);

      host.appendChild(row);
    }
  }

  function renderExportPreview({ items }) {
    const host = byId("trainPreviewDetail");
    if (!host) return;
    host.style.display = "block";
    clear(host);

    const t1 = document.createElement("div");
    t1.className = "previewTitle";
    t1.textContent = "Preview (items)";
    host.appendChild(t1);

    const pre = document.createElement("pre");
    pre.className = "tiny";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = JSON.stringify(items || [], null, 2);
    host.appendChild(pre);
  }

  function setTrainExportHint(text) {
    const el = byId("trainExportHint");
    if (!el) return;
    el.textContent = String(text || "");
  }

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
    renderSelectedDetail,
    renderTrainingHits,
    renderExportPreview,
    setTrainExportHint
  };
})();
