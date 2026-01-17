/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 05/06 | FIL-ID: UI/pages/packages-block/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render (DOM) för Block-editor: listor + vald block + exportlistor + pills
Policy (LÅST):
- UI-only • Fail-closed
- XSS-safe rendering: textContent, inga osäkra innerHTML
- Ingen storage här (bara UI)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.render) return; // idempotent

  // Optional deps (förväntas finnas i andra filer)
  const contract = NS.contract || null;

  // -----------------------------
  // DOM cache
  // -----------------------------
  function byId(id) { return document.getElementById(id); }

  const DOM = {
    msgBox: byId("msgBox"),
    lockBox: byId("lockBox"),

    statePill: byId("statePill"),
    selPill: byId("selPill"),
    whoPill: byId("whoPill"),
    modePill: byId("modePill"),
    verifyPill: byId("verifyPill"),

    topEditing: byId("topEditing"),
    topEditingText: byId("topEditingText"),

    countBlocks: byId("countBlocks"),
    blockList: byId("blockList"),

    trainPreview: byId("trainPreview"),
    trainPreviewDetail: byId("trainPreviewDetail"),
    trainExportHint: byId("trainExportHint"),

    selDetail: byId("selDetail"),
    selHint: byId("selHint"),
  };

  // -----------------------------
  // Tiny helpers (XSS-safe)
  // -----------------------------
  function clear(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function div(cls, text) {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    if (text != null) d.textContent = String(text);
    return d;
  }

  function span(cls, text) {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    if (text != null) s.textContent = String(text);
    return s;
  }

  function btnMini(text, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "miniBtn";
    b.textContent = String(text || "");
    if (title) b.title = String(title);
    return b;
  }

  function safeSnippet(v, n) {
    const s = String(v ?? "").trim();
    if (!s) return "(utan text)";
    const max = Math.max(0, Number(n || 0));
    return s.slice(0, max) + (s.length > max ? "…" : "");
  }

  function mkChoiceIdByIndex(i) {
    const letters = "ABCDE";
    if (i >= 0 && i < letters.length) return letters[i];
    return "C" + String(i + 1);
  }

  // -----------------------------
  // Messages / lockbox
  // -----------------------------
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

  // -----------------------------
  // Pills / topbar
  // -----------------------------
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

  // -----------------------------
  // Blocklista (vänster)
  // -----------------------------
  function renderSearchFirstPlaceholder(nAll) {
    if (!DOM.blockList) return;
    clear(DOM.blockList);

    DOM.blockList.appendChild(div("muted2", "Sök för att visa block."));
    DOM.blockList.appendChild(div("tiny muted2", nAll ? "Tips: Du kan också trycka “Visa alla”." : "Tips: Exportera från utbildningar för att skapa ett block."));
  }

  /**
   * renderBlockList
   * @param {Object} opts
   *  - discoveryActive: boolean
   *  - allCount: number
   *  - visible: array of blocks already normalized enough for display:
   *    { blockId,title,module,area,step,status,verifiedAt, __comp?:{q,t,d,miss,kind,strictFail} }
   *  - selectedBlockId: string
   *  - onSelect: function(blockId)
   */
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
      DOM.blockList.appendChild(div("muted2", allCount ? "Inga träffar (justera sök/filter)." : "Inga block ännu."));
      return;
    }

    const max = Math.min(visible.length, 400);
    for (let i = 0; i < max; i++) {
      const b = visible[i] || {};
      const id = String(b.blockId || "");
      const comp = b.__comp || b.comp || null;

      const row = document.createElement("div");
      row.className = "rowItem" + (id && id === selectedId ? " active" : "");
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.dataset.blockid = id;

      const top = document.createElement("div");
      top.className = "rowTop";

      const left = document.createElement("div");
      const title = div("rowTitle", b.title || "(utan rubrik)");
      const meta = div("tiny", `${b.module || "—"} • ${b.area || "—"} • ${b.step || "—"} • ${comp ? (Number(comp.q||0)+Number(comp.t||0)+Number(comp.d||0)) : "—"} item(s)`);

      const icoRow = document.createElement("div");
      icoRow.className = "icoRow";

      const qN = comp ? Number(comp.q || 0) : 0;
      const dN = comp ? Number(comp.d || 0) : 0;
      const tN = comp ? Number(comp.t || 0) : 0;
      const miss = comp ? Number(comp.miss || 0) : 0;
      const strictFail = comp ? Number(comp.strictFail || 0) : 0;
      const kind = comp ? String(comp.kind || "") : "";

      icoRow.appendChild(span("icoPill", `❓ ${qN}`));
      icoRow.appendChild(span("icoPill", `📄 ${dN}`));
      icoRow.appendChild(span("icoPill", `✅ ${tN}`));
      icoRow.appendChild(span("icoPill", `🧩 ${kind === "mixed" ? "Mixed" : (kind ? "Single" : "—")}`));

      left.appendChild(title);
      left.appendChild(meta);
      left.appendChild(icoRow);

      const right = document.createElement("div");
      const st = String(b.status || "draft").toLowerCase() === "published" ? "published" : "draft";
      const statusPill = span("pill " + (st === "published" ? "ok" : "warn"), st === "published" ? "Publicerad" : "Utkast");
      right.appendChild(statusPill);

      const verified = Number(b.verifiedAt || 0) > 0;
      const vPill = span(verified ? "verifyPill ok" : "verifyPill warn", verified ? "Verifierad" : "Ej verifierad");
      vPill.style.marginTop = "6px";
      right.appendChild(vPill);

      if (miss > 0) {
        const missP = span("qaPill bad", `Facit-fel: ${miss}`);
        missP.style.marginTop = "6px";
        right.appendChild(missP);
      }
      if (contract && contract.CONTRACT_V1_STRICT && strictFail > 0) {
        const cf = span("qaPill bad", `Kontrakt-fel: ${strictFail}`);
        cf.style.marginTop = "6px";
        right.appendChild(cf);
      }

      top.appendChild(left);
      top.appendChild(right);
      row.appendChild(top);

      const choose = function () {
        if (typeof o.onSelect === "function" && id) o.onSelect(id);
      };
      row.addEventListener("click", choose);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      });

      DOM.blockList.appendChild(row);
    }
  }

  // -----------------------------
  // Exportlist (utbildningar)
  // -----------------------------
  /**
   * renderTrainingHits
   * @param {Object} opts
   *  - corrupt:boolean, missing:boolean
   *  - hits: array { index,title,module,area,step, itemsCount,q,d,task, docOnly, active:boolean }
   *  - onPickTraining: fn(index)
   */
  function renderTrainingHits(opts) {
    const o = opts || {};
    if (!DOM.trainPreview) return;

    clear(DOM.trainPreview);

    if (o.corrupt) {
      DOM.trainPreview.appendChild(div("muted2", "Låst för säkerhet: utbildningsdata verkar vara trasig."));
      return;
    }

    const hits = Array.isArray(o.hits) ? o.hits : [];
    if (!hits.length) {
      DOM.trainPreview.appendChild(div("muted2", o.missing ? "Inga utbildningar hittades ännu." : "Inga träffar. Prova annan modul/område eller sök fritt."));
      return;
    }

    const max = Math.min(hits.length, 80);
    for (let i = 0; i < max; i++) {
      const h = hits[i] || {};
      const row = document.createElement("div");
      row.className = "exportRow" + (h.active ? " active" : "");
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");

      const left = document.createElement("div");
      left.className = "left";

      const tt = div("t", h.title || "—");
      const sub = div("s", [
        h.module ? ("Modul: " + h.module) : "Modul: —",
        h.area ? ("Område: " + h.area) : "Område: —",
        h.step ? ("Steg: " + h.step) : "Steg: —",
        `Innehåll: ${Number(h.itemsCount || 0)} ${Number(h.itemsCount || 0) === 1 ? "del" : "delar"} • ❓ ${Number(h.q||0)} • 📄 ${Number(h.d||0)} • ✅ ${Number(h.task||0)}` + (h.docOnly ? " • (info-only)" : "")
      ].join("\n"));

      left.appendChild(tt);
      left.appendChild(sub);

      const right = document.createElement("div");
      const p = span("pill " + (Number(h.itemsCount || 0) ? "ok" : "warn"), Number(h.itemsCount || 0) ? (h.active ? "Vald" : "Redo") : "Tomt");
      right.appendChild(p);

      row.appendChild(left);
      row.appendChild(right);

      const pick = function () {
        if (typeof o.onPickTraining === "function") o.onPickTraining(Number(h.index));
      };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });

      DOM.trainPreview.appendChild(row);
    }
  }

  /**
   * renderExportPreview
   * @param {Object} opts
   *  - title:string
   *  - items: array of normalized items {kind,text,choices?,answerKeyObj?,instruction?,deliverable?}
   */
  function renderExportPreview(opts) {
    const o = opts || {};
    if (!DOM.trainPreviewDetail) return;

    clear(DOM.trainPreviewDetail);

    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) {
      DOM.trainPreviewDetail.style.display = "none";
      return;
    }

    DOM.trainPreviewDetail.style.display = "block";

    DOM.trainPreviewDetail.appendChild(div("tiny", `Export-preview: ${items.length} item(s)`));

    const max = Math.min(items.length, 30);
    for (let i = 0; i < max; i++) {
      const it = items[i] || {};
      const row = document.createElement("div");
      row.className = "exportItemRow";

      const pill = span("pill " + (String(it.kind) === "question" ? "ok" : "warn"), `${String(it.kind || "document")}`);
      const tx = span("tiny", safeSnippet(it.text, 120));

      row.appendChild(pill);
      row.appendChild(tx);
      DOM.trainPreviewDetail.appendChild(row);
    }
  }

  function setTrainExportHint(text) {
    if (!DOM.trainExportHint) return;
    DOM.trainExportHint.textContent = String(text || "");
  }

  // -----------------------------
  // Vald block (höger)
  // -----------------------------
  function renderSelectedEmpty() {
    if (DOM.selHint) DOM.selHint.textContent = "Välj ett block i vänsterlistan för att se frågor + facit.";
    if (DOM.selDetail) clear(DOM.selDetail);
  }

  function renderSelectedHeader(blockTitle) {
    if (!DOM.selDetail) return;
    DOM.selDetail.appendChild(div("previewTitle", blockTitle || "(utan rubrik)"));
  }

  function renderValidationBox(reasons) {
    if (!DOM.selDetail) return;
    if (!Array.isArray(reasons) || !reasons.length) return;

    const box = div("errList", "");
    const h = div("h", "Validering stoppar Verifiera/Publicera");
    h.className = "h";
    box.appendChild(h);

    const ul = document.createElement("ul");
    const max = Math.min(reasons.length, 12);
    for (let i = 0; i < max; i++) {
      const li = document.createElement("li");
      li.textContent = String(reasons[i]);
      ul.appendChild(li);
    }
    if (reasons.length > 12) {
      const li = document.createElement("li");
      li.textContent = `… +${reasons.length - 12} till`;
      ul.appendChild(li);
    }
    box.appendChild(ul);
    DOM.selDetail.appendChild(box);
  }

  function buildChoiceRows(stateItem, idx, canEdit, onPatchItem) {
    const wrap = document.createElement("div");
    const choices = Array.isArray(stateItem.choices) ? stateItem.choices.slice(0, 10) : [];
    const rows = Math.max(3, Math.min(6, choices.length || 3));

    function commit(rowIndex, newId, newText) {
      const arr = Array.isArray(stateItem.choices) ? stateItem.choices.slice(0, 10) : [];
      while (arr.length < rows) arr.push({ id: mkChoiceIdByIndex(arr.length), text: "" });

      arr[rowIndex] = {
        id: String(newId || mkChoiceIdByIndex(rowIndex)).trim() || mkChoiceIdByIndex(rowIndex),
        text: String(newText || "").trim()
      };

      // trim empties
      const out = arr
        .map((c, i) => ({
          id: String(c.id || mkChoiceIdByIndex(i)).trim() || mkChoiceIdByIndex(i),
          text: String(c.text || "").trim()
        }))
        .filter((c) => c.text)
        .slice(0, 10);

      onPatchItem(idx, function (it) {
        const next = Object.assign({}, it);
        next.choices = out;
        next.options = out.map((c) => c.text).slice(0, 10);
        next.answerKeyObj = next.answerKeyObj && typeof next.answerKeyObj === "object"
          ? Object.assign({}, next.answerKeyObj)
          : { kind: "mcq_single", correctChoiceId: "", rationale: "" };
        next.answerKeyObj.kind = "mcq_single";
        // keep legacy answerKey as id (deterministiskt)
        next.answerKey = String(next.answerKeyObj.correctChoiceId || "").trim();
        return next;
      });
    }

    for (let i = 0; i < rows; i++) {
      const row = document.createElement("div");
      row.className = "optRow";

      const idInp = document.createElement("input");
      idInp.type = "text";
      idInp.placeholder = "Id (A/B/C…)";
      idInp.value = String(choices[i] && choices[i].id ? choices[i].id : mkChoiceIdByIndex(i));
      idInp.disabled = !canEdit;
      idInp.style.maxWidth = "90px";

      const txtInp = document.createElement("input");
      txtInp.type = "text";
      txtInp.placeholder = `Alternativ ${i + 1}`;
      txtInp.value = String(choices[i] && choices[i].text ? choices[i].text : "");
      txtInp.disabled = !canEdit;

      const bClear = btnMini("Rensa");
      bClear.className = "optBtn";
      bClear.disabled = !canEdit;

      function onInput() { commit(i, idInp.value, txtInp.value); }
      idInp.addEventListener("input", onInput);
      txtInp.addEventListener("input", onInput);

      bClear.addEventListener("click", function () {
        txtInp.value = "";
        commit(i, idInp.value, "");
      });

      row.appendChild(idInp);
      row.appendChild(txtInp);
      row.appendChild(bClear);
      wrap.appendChild(row);
    }

    const hint = div("tiny muted2", "Tips: Id bör vara A/B/C… och facit ska vara ett av dessa id:n.");
    hint.style.marginTop = "8px";
    wrap.appendChild(hint);

    return wrap;
  }

  /**
   * renderSelectedDetail
   * @param {Object} opts
   *  - block: normalized block {title, items:[...] }
   *  - canEdit: boolean
   *  - validationReasons: array (optional)
   *  - onPatchItem(index, patchFnOrObject): callback used to change STATE.edit.items[index]
   */
  function renderSelectedDetail(opts) {
    const o = opts || {};
    const b = o.block || null;

    if (!DOM.selDetail) return;

    clear(DOM.selDetail);

    if (!b) {
      renderSelectedEmpty();
      return;
    }

    if (DOM.selHint) {
      DOM.selHint.textContent = "Valt block: redigera frågor (alternativ + facit + rationale) och uppgifter (instruktion + leverans).";
    }

    renderSelectedHeader(b.title || "(utan rubrik)");
    renderValidationBox(o.validationReasons || []);

    const meta = div("tiny muted2", "Obs: All rendering är XSS-säker. Spara/Verifiera/Publicera styrs av app-logiken.");
    meta.style.marginTop = "6px";
    DOM.selDetail.appendChild(meta);

    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) {
      const empty = div("muted2", "Inga items i blocket.");
      empty.style.marginTop = "10px";
      DOM.selDetail.appendChild(empty);
      return;
    }

    const canEdit = !!o.canEdit;
    const onPatchItem = typeof o.onPatchItem === "function" ? o.onPatchItem : function () {};

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx] || {};
      const kind = String(it.kind || "document");

      const card = document.createElement("div");
      card.className = "itemCard";

      const top = document.createElement("div");
      top.className = "itemRowTop";

      const left = div("tiny", `${idx + 1}/${items.length} • ${kind}`);
      const right = document.createElement("div");

      // optional: kontrakt-status pill (om contract finns)
      if (contract && contract.CONTRACT_V1_STRICT) {
        let ok = true;
        try {
          if (kind === "question") ok = !!contract.validateQuestionStrict(it).ok;
          else if (kind === "task") ok = !!contract.validateTaskStrict(it).ok;
          else ok = !!contract.validateDocStrict(it).ok;
        } catch (_) { ok = false; }
        right.appendChild(span("qaPill " + (ok ? "ok" : "bad"), ok ? "Kontrakt OK" : "Kontrakt-fel"));
      }

      top.appendChild(left);
      top.appendChild(right);
      card.appendChild(top);

      if (kind === "question") {
        // Question text
        card.appendChild(div("fieldLbl tiny", "Frågetext"));
        const taQ = document.createElement("textarea");
        taQ.value = String(it.text || "");
        taQ.disabled = !canEdit;
        taQ.addEventListener("input", function () {
          const v = String(taQ.value || "");
          onPatchItem(idx, function (cur) {
            const next = Object.assign({}, cur);
            next.text = v;
            return next;
          });
        });
        card.appendChild(taQ);

        // Choices
        card.appendChild(div("fieldLbl tiny", "Alternativ (3–5)"));
        card.appendChild(buildChoiceRows(it, idx, canEdit, onPatchItem));

        // Facit
        card.appendChild(div("fieldLbl tiny", "Facit (correctChoiceId)"));
        const fac = document.createElement("input");
        fac.type = "text";
        fac.placeholder = "t.ex. A";
        fac.value = String(it.answerKeyObj && it.answerKeyObj.correctChoiceId ? it.answerKeyObj.correctChoiceId : "");
        fac.disabled = !canEdit;
        fac.addEventListener("input", function () {
          const v = String(fac.value || "").trim();
          onPatchItem(idx, function (cur) {
            const next = Object.assign({}, cur);
            next.answerKeyObj = next.answerKeyObj && typeof next.answerKeyObj === "object"
              ? Object.assign({}, next.answerKeyObj)
              : { kind: "mcq_single", correctChoiceId: "", rationale: "" };
            next.answerKeyObj.kind = "mcq_single";
            next.answerKeyObj.correctChoiceId = v;
            next.answerKey = v; // legacy
            return next;
          });
        });
        card.appendChild(fac);

        // Rationale
        card.appendChild(div("fieldLbl tiny", "Rationale (krav)"));
        const taR = document.createElement("textarea");
        taR.value = String(it.answerKeyObj && it.answerKeyObj.rationale ? it.answerKeyObj.rationale : "");
        taR.disabled = !canEdit;
        taR.addEventListener("input", function () {
          const v = String(taR.value || "");
          onPatchItem(idx, function (cur) {
            const next = Object.assign({}, cur);
            next.answerKeyObj = next.answerKeyObj && typeof next.answerKeyObj === "object"
              ? Object.assign({}, next.answerKeyObj)
              : { kind: "mcq_single", correctChoiceId: "", rationale: "" };
            next.answerKeyObj.kind = "mcq_single";
            next.answerKeyObj.rationale = v;
            return next;
          });
        });
        card.appendChild(taR);

      } else if (kind === "task") {
        // Instruction
        card.appendChild(div("fieldLbl tiny", "Instruktion (krav)"));
        const taI = document.createElement("textarea");
        taI.value = String(it.instruction || "");
        taI.disabled = !canEdit;
        taI.addEventListener("input", function () {
          const v = String(taI.value || "");
          onPatchItem(idx, function (cur) {
            const next = Object.assign({}, cur);
            next.instruction = v;
            // text kan byggas i store/app, men vi håller det konsekvent här också:
            const parts = [];
            if (String(next.instruction || "").trim()) parts.push("Instruktion: " + String(next.instruction || "").trim());
            if (String(next.deliverable || "").trim()) parts.push("Leverans: " + String(next.deliverable || "").trim());
            next.text = parts.join("\n\n") || String(next.text || "");
            return next;
          });
        });
        card.appendChild(taI);

        // Deliverable
        card.appendChild(div("fieldLbl tiny", "Leverans (krav)"));
        const taD = document.createElement("textarea");
        taD.value = String(it.deliverable || "");
        taD.disabled = !canEdit;
        taD.addEventListener("input", function () {
          const v = String(taD.value || "");
          onPatchItem(idx, function (cur) {
            const next = Object.assign({}, cur);
            next.deliverable = v;
            const parts = [];
            if (String(next.instruction || "").trim()) parts.push("Instruktion: " + String(next.instruction || "").trim());
            if (String(next.deliverable || "").trim()) parts.push("Leverans: " + String(next.deliverable || "").trim());
            next.text = parts.join("\n\n") || String(next.text || "");
            return next;
          });
        });
        card.appendChild(taD);

        // Employee view (read-only)
        card.appendChild(div("fieldLbl tiny", "Visning (employee text, auto)"));
        const taE = document.createElement("textarea");
        taE.value = String(it.text || "");
        taE.disabled = true;
        card.appendChild(taE);

      } else {
        // Document
        card.appendChild(div("fieldLbl tiny", "Dokumenttext"));
        const ta = document.createElement("textarea");
        ta.value = String(it.text || "");
        ta.disabled = !canEdit;
        ta.addEventListener("input", function () {
          const v = String(ta.value || "");
          onPatchItem(idx, function (cur) {
            const next = Object.assign({}, cur);
            next.text = v;
            return next;
          });
        });
        card.appendChild(ta);
      }

      DOM.selDetail.appendChild(card);
    }
  }

  // -----------------------------
  // Exports
  // -----------------------------
  NS.render = {
    // msg/lock
    setMsg,
    showLockBox,

    // pills/top
    setWhoPill,
    setModePill,
    setSelectionPill,
    setStatePill,
    setVerifyPill,
    setTopEditing,

    // lists
    renderSearchFirstPlaceholder,
    renderBlockList,

    // export
    renderTrainingHits,
    renderExportPreview,
    setTrainExportHint,

    // selected
    renderSelectedDetail,
    renderSelectedEmpty,
  };
})();

