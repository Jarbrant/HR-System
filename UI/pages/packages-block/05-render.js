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

  function setVisible(node, yes) {
    if (!node) return;
    node.style.display = yes ? "" : "none";
  }

  function safeSnippet(v, n) {
    const s = String(v ?? "").trim();
    if (!s) return "(utan text)";
    const max = Math.max(0, Number(n || 0));
    return s.slice(0, max) + (s.length > max ? "…" : "");
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

      // “Hittat” = antal items (inte antal frågor) – exakt din fråga i bilden
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

  // ---------- Trainings export (placeholder) ----------
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
        `Modul: ${h.module || "—"}\nOmråde: ${h.area || "—"}\nSteg: ${h.step || "—"}\nInnehåll: ${Number(h.itemsCount||0)} delar`
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

  // ---------- Selected block ----------
  function renderSelectedEmpty() {
    if (DOM.selHint) DOM.selHint.textContent = "Välj ett block i vänsterlistan för att se frågor + facit.";
    if (DOM.selDetail) clear(DOM.selDetail);
  }

  function renderSelectedDetail(opts) {
    const o = opts || {};
    const b = o.block || null;
    if (!DOM.selDetail) return;

    clear(DOM.selDetail);

    if (!b) { renderSelectedEmpty(); return; }

    if (DOM.selHint) {
      DOM.selHint.textContent = "Valt block: redigera frågor (alternativ + facit + rationale) och uppgifter (instruktion + leverans).";
    }

    DOM.selDetail.appendChild(el("div", "previewTitle", b.title || "(utan rubrik)"));

    const reasons = Array.isArray(o.validationReasons) ? o.validatio
