/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 04/06 | FIL-ID: UI/pages/packages-block/04-contract.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Strikt kontrakt v1 (fail-closed) för verifiera/publicera av block/items
Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell
- XSS-safe (ingen DOM här)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.contract) return; // idempotent

  const FORBIDDEN_PHRASES = [
    "utför uppgiften",
    "beskriv hur du tänkte",
    "lämna in",
    "reflektera",
    "diskutera",
  ];

  function normStr(v) { return String(v ?? "").trim(); }
  function lower(v) { return normStr(v).toLowerCase(); }

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }

  function pushReason(reasons, msg) {
    const s = normStr(msg);
    if (s) reasons.push(s);
  }

  // Locked item contract validator (per item)
  function validateItem(it, idx, emojiForKind) {
    const reasons = [];
    const k = normStr(it && it.kind);
    const emoji = (typeof emojiForKind === "function") ? emojiForKind(k) : "";

    if (!k) {
      pushReason(reasons, `${emoji} Item ${idx + 1}: saknar kind.`);
      return reasons;
    }

    if (k === "document") {
      const text = normStr(it.text);
      if (!text) pushReason(reasons, `${emoji} Dokument ${idx + 1}: text saknas.`);
      // requiresSign är valfri boolean (ingen hård validering behövs)
      return reasons;
    }

    if (k === "task") {
      const taskId = normStr(it.taskId);
      const text = normStr(it.text);
      if (!taskId) pushReason(reasons, `${emoji} Uppgift ${idx + 1}: taskId saknas.`);
      if (!text) pushReason(reasons, `${emoji} Uppgift ${idx + 1}: text saknas.`);
      // requiresDone default true; answerType default checkbox
      return reasons;
    }

    if (k === "question") {
      const qid = normStr(it.questionId);
      const text = normStr(it.text);
      if (!qid) pushReason(reasons, `${emoji} Fråga ${idx + 1}: questionId saknas.`);
      if (!text) pushReason(reasons, `${emoji} Fråga ${idx + 1}: text saknas.`);

      const requiresAnswer = (it.requiresAnswer !== false);
      const options = Array.isArray(it.options) ? it.options.map(normStr).filter(Boolean) : [];
      const answerType = normStr(it.answerType) || (options.length >= 2 ? "choice" : "text");
      const answerKey = normStr(it.answerKey);

      if (requiresAnswer) {
        if (options.length >= 2) {
          if (!answerKey) {
            pushReason(reasons, `${emoji} Fråga ${idx + 1}: saknar facit (answerKey).`);
          } else {
            const matchCount = options.filter((o) => o === answerKey).length;
            if (matchCount !== 1) {
              pushReason(reasons, `${emoji} Fråga ${idx + 1}: answerKey måste matcha exakt ett alternativ.`);
            }
          }
          if (answerType !== "choice") {
            pushReason(reasons, `${emoji} Fråga ${idx + 1}: answerType ska vara "choice" när options har 2+ alternativ.`);
          }
        } else {
          // options < 2 → text tillåts, answerKey får vara fri text men måste finnas om requiresAnswer=true
          if (!answerKey) {
            pushReason(reasons, `${emoji} Fråga ${idx + 1}: saknar facit (answerKey) trots requiresAnswer=true.`);
          }
          if (answerType !== "text") {
            pushReason(reasons, `${emoji} Fråga ${idx + 1}: answerType ska vara "text" när options har <2 alternativ.`);
          }
        }
      }

      return reasons;
    }

    pushReason(reasons, `${emoji} Item ${idx + 1}: okänd kind "${k}".`);
    return reasons;
  }

  function validateForbiddenPhrases(block, reasons) {
    // Låst krav: vid prov/kunskapskontroll ska fraser fångas.
    // I detta UI saknar vi säkert "mode" från kompositionspolicy, så vi flaggar om frasen finns
    // i frågor eller tasks/dokument (minst P1). Fail-closed vid verifiera/publicera.
    const items = Array.isArray(block && block.items) ? block.items : [];
    const bad = [];
    for (const it of items) {
      const text = lower(it && it.text);
      if (!text) continue;
      for (const p of FORBIDDEN_PHRASES) {
        if (text.includes(p)) bad.push(p);
      }
    }
    if (bad.length) {
      const uniq = Array.from(new Set(bad));
      pushReason(reasons, `P1: Förbjudna fraser hittades: ${uniq.join(", ")}.`);
    }
  }

  function validateBlockShape(block, reasons) {
    if (!isObj(block)) {
      pushReason(reasons, "Block är inte ett objekt.");
      return;
    }

    const blockId = normStr(block.blockId);
    if (!blockId) pushReason(reasons, "blockId saknas.");

    const status = normStr(block.status);
    if (!(status === "draft" || status === "published")) {
      pushReason(reasons, `status måste vara "draft" eller "published".`);
    }

    // items måste finnas och vara array
    if (!Array.isArray(block.items)) {
      pushReason(reasons, "items måste vara en array.");
    } else if (block.items.length === 0) {
      pushReason(reasons, "Blocket saknar items (minst 1 krävs).");
    }
  }

  // Public API expected by 06-page.js:
  // validateForVerify(block, normalizeItem, emojiForKind) => { ok:boolean, reasons:string[] }
  function validateForVerify(block, normalizeItem, emojiForKind) {
    const reasons = [];

    validateBlockShape(block, reasons);

    const items = Array.isArray(block && block.items) ? block.items : [];
    for (let i = 0; i < items.length; i++) {
      const raw = items[i];
      const it = (typeof normalizeItem === "function") ? normalizeItem(raw) : raw;
      const r = validateItem(it, i, emojiForKind);
      for (const msg of r) pushReason(reasons, msg);
    }

    validateForbiddenPhrases(block, reasons);

    return { ok: reasons.length === 0, reasons };
  }

  NS.contract = {
    VERSION: "v1.0",
    validateForVerify,
    FORBIDDEN_PHRASES: FORBIDDEN_PHRASES.slice(),
  };
})();


/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 05/06 | FIL-ID: UI/pages/packages-block/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: All DOM-render (XSS-safe via textContent) för packages-block
Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell
- XSS-safe: textContent, inga osäkra innerHTML
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.render) return; // idempotent

  function byId(id) { return document.getElementById(String(id || "")); }
  function clear(el) { if (!el) return; while (el.firstChild) el.removeChild(el.firstChild); }
  function txt(el, s) { if (!el) return; el.textContent = String(s ?? ""); }
  function show(el, on) { if (!el) return; el.style.display = on ? "" : "none"; }

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

    blockList: byId("blockList"),
    countBlocks: byId("countBlocks"),

    trainPreview: byId("trainPreview"),
    trainPreviewDetail: byId("trainPreviewDetail"),
    trainExportHint: byId("trainExportHint"),

    selDetail: byId("selDetail"),
    selHint: byId("selHint"),
  };

  function setMsg(kind, text) {
    // kind används inte hårt här, men finns för kompatibilitet
    const s = String(text ?? "");
    if (!DOM.msgBox) return;
    if (!s) { DOM.msgBox.textContent = ""; DOM.msgBox.style.display = "none"; return; }
    DOM.msgBox.style.display = "block";
    DOM.msgBox.textContent = s;
  }

  function showLockBox(lines) {
    const arr = Array.isArray(lines) ? lines.filter(Boolean) : [];
    if (!DOM.lockBox) return;
    if (!arr.length) { DOM.lockBox.textContent = ""; DOM.lockBox.style.display = "none"; return; }

    DOM.lockBox.style.display = "block";
    clear(DOM.lockBox);

    // Bygg enkel lista utan innerHTML
    const ul = document.createElement("ul");
    for (const line of arr) {
      const li = document.createElement("li");
      li.textContent = String(line);
      ul.appendChild(li);
    }
    DOM.lockBox.appendChild(ul);
  }

  function setStatePill(textValue, className) {
    if (!DOM.statePill) return;
    DOM.statePill.className = "pill";
    if (className) DOM.statePill.className = className;
    DOM.statePill.textContent = String(textValue ?? "");
  }

  function setSelectionPill(textValue) {
    if (!DOM.selPill) return;
    DOM.selPill.textContent = String(textValue ?? "");
  }

  function setWhoPill(textValue) {
    if (!DOM.whoPill) return;
    DOM.whoPill.style.display = "inline-flex";
    DOM.whoPill.textContent = String(textValue ?? "");
  }

  function setModePill(textValue, className) {
    if (!DOM.modePill) return;
    DOM.modePill.style.display = "inline-flex";
    DOM.modePill.className = "pill";
    if (className) DOM.modePill.className = className;
    DOM.modePill.textContent = String(textValue ?? "");
  }

  function setVerifyPill(textValue, className, showIt) {
    if (!DOM.verifyPill) return;
    DOM.verifyPill.className = "verifyPill";
    if (className) DOM.verifyPill.className = className;
    DOM.verifyPill.textContent = String(textValue ?? "");
    DOM.verifyPill.style.display = showIt ? "inline-flex" : "none";
  }

  function setTopEditing(titleText, on) {
    if (!DOM.topEditing || !DOM.topEditingText) return;
    DOM.topEditing.style.display = on ? "inline-flex" : "none";
    DOM.topEditingText.textContent = String(titleText ?? "—");
  }

  function renderBlockList({ discoveryActive, allCount, visible, selectedBlockId, onSelect }) {
    if (DOM.countBlocks) {
      DOM.countBlocks.textContent = discoveryActive
        ? `Hittat: ${visible.length} item(s)`
        : "Sök för att visa block. (Inga block hittade ännu.)";
      // OBS: texten är “item(s)” i UI redan – vi håller kompatibilitet här.
    }

    if (!DOM.blockList) return;
    clear(DOM.blockList);

    if (!discoveryActive) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Sök för att visa block. (Inga block hittade ännu.)";
      DOM.blockList.appendChild(m);
      return;
    }

    const arr = Array.isArray(visible) ? visible : [];
    if (!arr.length) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Inga träffar.";
      DOM.blockList.appendChild(m);
      return;
    }

    for (const b of arr) {
      const row = document.createElement("div");
      row.className = "rowItem" + (b && b.blockId === selectedBlockId ? " active" : "");
      row.tabIndex = 0;

      const top = document.createElement("div");
      top.className = "rowTop";

      const left = document.createElement("div");
      left.style.minWidth = "0";

      const t = document.createElement("div");
      t.className = "rowTitle";
      t.textContent = String((b && b.title) || "(utan rubrik)");

      const meta = document.createElement("div");
      meta.className = "tiny muted2";
      meta.textContent =
        `Modul: ${String((b && b.module) || "—")}\n` +
        `Område: ${String((b && b.area) || "—")}\n` +
        `Steg: ${String((b && b.step) || "—")}`;

      left.appendChild(t);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.className = "tiny muted2";
      right.style.whiteSpace = "nowrap";
      right.textContent = (b && b.status === "published") ? "Vald" : "Redo";

      top.appendChild(left);
      top.appendChild(right);

      const line = document.createElement("div");
      line.className = "qaLine";

      const comp = (b && b.__comp) ? b.__comp : { items: 0, q: 0, d: 0, t: 0, missingKey: 0 };
      const p = document.createElement("div");
      p.className = "tiny muted2";
      p.textContent = `Hittat: ${Number(comp.items || 0)} item(s) • ❓ ${Number(comp.q||0)} • 📄 ${Number(comp.d||0)} • ✅ ${Number(comp.t||0)} • ${Number(comp.missingKey||0)} • (info-only)`;
      line.appendChild(p);

      row.appendChild(top);
      row.appendChild(line);

      function pick() {
        if (typeof onSelect === "function") onSelect(b.blockId);
      }
      row.addEventListener("click", pick);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });

      DOM.blockList.appendChild(row);
    }
  }

  function renderSelectedDetail({ block, canEdit, validationReasons, onPatchItem }) {
    if (!DOM.selDetail) return;
    clear(DOM.selDetail);

    if (!block) {
      if (DOM.selHint) DOM.selHint.textContent = "Välj ett block i vänsterlistan för att se frågor + facit.";
      return;
    }
    if (DOM.selHint) DOM.selHint.textContent = canEdit ? "Redigera och spara som utkast." : "Read-only: SYSTEM_ADMIN kan bara läsa.";

    // Header
    const h = document.createElement("div");
    h.className = "tiny";
    h.textContent = `blockId: ${String(block.blockId || "—")}`;
    DOM.selDetail.appendChild(h);

    // Validation list
    if (Array.isArray(validationReasons) && validationReasons.length) {
      const err = document.createElement("div");
      err.className = "errList";
      const hh = document.createElement("div");
      hh.className = "h";
      hh.textContent = "Problem (kontrakt):";
      err.appendChild(hh);
      const ul = document.createElement("ul");
      for (const r of validationReasons) {
        const li = document.createElement("li");
        li.textContent = String(r);
        ul.appendChild(li);
      }
      err.appendChild(ul);
      DOM.selDetail.appendChild(err);
    }

    const items = Array.isArray(block.items) ? block.items : [];
    if (!items.length) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Inga items i detta block.";
      DOM.selDetail.appendChild(m);
      return;
    }

    // Item cards (minimal edit: text + answerKey + options)
    items.forEach((it, idx) => {
      const card = document.createElement("div");
      card.className = "itemCard";

      const top = document.createElement("div");
      top.className = "itemRowTop";

      const kind = document.createElement("div");
      kind.className = "tiny";
      kind.style.fontWeight = "900";
      kind.textContent = `${String(it.kind || "document")} #${idx + 1}`;

      top.appendChild(kind);
      card.appendChild(top);

      // Text field
      const lblT = document.createElement("div");
      lblT.className = "fieldLbl";
      lblT.textContent = "Text";
      card.appendChild(lblT);

      const ta = document.createElement("textarea");
      ta.value = String(it.text || "");
      ta.disabled = !canEdit;
      ta.addEventListener("input", function () {
        if (!canEdit) return;
        if (typeof onPatchItem === "function") {
          onPatchItem(idx, function (cur) {
            const next = Object.assign({}, cur, { text: ta.value });
            return next;
          });
        }
      });
      card.appendChild(ta);

      if (String(it.kind) === "question") {
        // options
        const lblO = document.createElement("div");
        lblO.className = "fieldLbl";
        lblO.textContent = "Alternativ (options)";
        card.appendChild(lblO);

        const opts = Array.isArray(it.options) ? it.options : [];
        if (!opts.length) {
          const m = document.createElement("div");
          m.className = "muted2 tiny";
          m.textContent = "Inga alternativ (text-fråga).";
          card.appendChild(m);
        } else {
          opts.forEach((o, oi) => {
            const row = document.createElement("div");
            row.className = "optRow";
            const inp = document.createElement("input");
            inp.type = "text";
            inp.value = String(o);
            inp.disabled = !canEdit;
            inp.addEventListener("input", function () {
              if (!canEdit) return;
              onPatchItem(idx, function (cur) {
                const curOpts = Array.isArray(cur.options) ? cur.options.slice() : [];
                curOpts[oi] = inp.value;
                return Object.assign({}, cur, { options: curOpts });
              });
            });
            row.appendChild(inp);
            card.appendChild(row);
          });
        }

        const lblA = document.createElement("div");
        lblA.className = "fieldLbl";
        lblA.textContent = "Facit (answerKey)";
        card.appendChild(lblA);

        const inpA = document.createElement("input");
        inpA.type = "text";
        inpA.value = String(it.answerKey || "");
        inpA.disabled = !canEdit;
        inpA.addEventListener("input", function () {
          if (!canEdit) return;
          onPatchItem(idx, function (cur) {
            return Object.assign({}, cur, { answerKey: inpA.value });
          });
        });
        card.appendChild(inpA);
      }

      DOM.selDetail.appendChild(card);
    });
  }

  function renderTrainingHits({ hits, corrupt, missing, onPickTraining }) {
    if (!DOM.trainPreview) return;
    clear(DOM.trainPreview);

    if (missing) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Inga utbildningar hittades (AO-057_TRAININGS_V1 saknas).";
      DOM.trainPreview.appendChild(m);
      return;
    }
    if (corrupt) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Utbildningar är korrupta (JSON).";
      DOM.trainPreview.appendChild(m);
      return;
    }

    const arr = Array.isArray(hits) ? hits : [];
    if (!arr.length) {
      const m = document.createElement("div");
      m.className = "muted2";
      m.textContent = "Inga träffar.";
      DOM.trainPreview.appendChild(m);
      return;
    }

    for (const h of arr.slice(0, 80)) {
      const row = document.createElement("div");
      row.className = "exportRow" + (h.active ? " active" : "");

      const left = document.createElement("div");
      left.className = "left";
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = String(h.title || "—");
      const s = document.createElement("div");
      s.className = "s tiny muted2";
      s.textContent = `Modul: ${String(h.module||"—")}\nOmråde: ${String(h.area||"—")}\nSteg: ${String(h.step||"—")}\nItems: ${Number(h.itemsCount||0)}`;
      left.appendChild(t);
      left.appendChild(s);

      const right = document.createElement("div");
      right.className = "tiny muted2";
      right.textContent = h.active ? "Vald" : "";

      row.appendChild(left);
      row.appendChild(right);

      row.addEventListener("click", function () {
        if (typeof onPickTraining === "function") onPickTraining(h.index);
      });

      DOM.trainPreview.appendChild(row);
    }
  }

  function renderExportPreview({ items }) {
    if (!DOM.trainPreviewDetail) return;
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) { DOM.trainPreviewDetail.style.display = "none"; DOM.trainPreviewDetail.textContent = ""; return; }

    DOM.trainPreviewDetail.style.display = "block";
    clear(DOM.trainPreviewDetail);

    const title = document.createElement("div");
    title.className = "previewTitle";
    title.textContent = "Preview (items)";
    DOM.trainPreviewDetail.appendChild(title);

    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = JSON.stringify(arr, null, 2);
    DOM.trainPreviewDetail.appendChild(pre);
  }

  function setTrainExportHint(textValue) {
    if (!DOM.trainExportHint) return;
    DOM.trainExportHint.textContent = String(textValue ?? "");
  }

  NS.render = {
    VERSION: "v1.0",
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
    setTrainExportHint,
  };
})();
