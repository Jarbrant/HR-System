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

  function safeSnippet(v, n) {
    const s = String(v ?? "").trim();
    if (!s) return "(utan text)";
    const max = Math.max(0, Number(n || 0));
    if (!max) return s;
    return s.slice(0, max) + (s.length > max ? "…" : "");
  }

  function normStr(v) { return String(v ?? "").trim(); }
  function isFn(x) { return typeof x === "function"; }

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; }
  }

  function clampLen(s, max) {
    const str = String(s ?? "");
    const m = Math.max(0, Number(max || 0));
    if (!m) return str;
    return str.length <= m ? str : str.slice(0, m);
  }

  function btn(cls, text, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls || "miniBtn";
    b.textContent = String(text || "");
    if (title) b.title = String(title);
    return b;
  }

  function inputText(value, placeholder) {
    const i = document.createElement("input");
    i.type = "text";
    i.className = "input";
    i.value = String(value ?? "");
    if (placeholder) i.placeholder = String(placeholder);
    i.autocomplete = "off";
    return i;
  }

  function textarea(value, placeholder) {
    const t = document.createElement("textarea");
    t.className = "input";
    t.value = String(value ?? "");
    if (placeholder) t.placeholder = String(placeholder);
    return t;
  }

  function select(values, current) {
    const s = document.createElement("select");
    s.className = "input";
    const cur = String(current ?? "");
    for (const v of values) {
      const o = document.createElement("option");
      o.value = String(v.value);
      o.textContent = String(v.label);
      s.appendChild(o);
    }
    s.value = cur;
    return s;
  }

  function labelWrap(lblText, node) {
    const wrap = el("div", "");
    wrap.appendChild(el("div", "fieldLbl", lblText));
    wrap.appendChild(node);
    return wrap;
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
    DOM.blockList.appendChild(
      el(
        "div",
        "tiny muted2",
        nAll ? "Tips: Du kan också trycka “Visa alla”." : "Tips: Exportera från utbildningar för att skapa ett block."
      )
    );
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

      const choose = function () { if (isFn(o.onSelect) && id) o.onSelect(id); };
      row.addEventListener("click", choose);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
      });

      DOM.blockList.appendChild(row);
    }
  }

  // ---------- Trainings export ----------
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
        `Modul: ${h.module || "—"}\nOmråde: ${h.area || "—"}\nSteg: ${h.step || "—"}\nInnehåll: ${Number(h.itemsCount || 0)} delar`
      ));

      const right = el("div", "");
      right.appendChild(pill("pill ok", h.active ? "Vald" : "Redo"));

      row.appendChild(left);
      row.appendChild(right);

      const pick = function () { if (isFn(o.onPickTraining)) o.onPickTraining(Number(h.index)); };
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

  // ---------- Selected block editor ----------
  function renderSelectedEmpty() {
    if (DOM.selHint) DOM.selHint.textContent = "Välj ett block i vänsterlistan för att se frågor + facit.";
    if (DOM.selDetail) clear(DOM.selDetail);
  }

  function renderValidationReasons(reasons) {
    const arr = Array.isArray(reasons) ? reasons.filter(Boolean) : [];
    if (!arr.length) return null;

    const box = el("div", "errList");
    box.appendChild(el("div", "h", "Verifiering blockerad"));
    const ul = document.createElement("ul");
    for (const r of arr.slice(0, 30)) {
      const li = document.createElement("li");
      li.textContent = String(r);
      ul.appendChild(li);
    }
    box.appendChild(ul);
    return box;
  }

  function itemKindLabel(kind) {
    const k = String(kind || "document");
    if (k === "question") return "❓ Fråga";
    if (k === "task") return "✅ Uppgift";
    return "📄 Dokument";
  }

  function renderQuestionEditor(it, idx, canEdit, onPatchItem) {
    const card = el("div", "itemCard");
    const top = el("div", "itemRowTop");
    top.appendChild(el("div", "tiny", itemKindLabel("question") + (it.questionId ? ` • ${it.questionId}` : "")));

    const right = el("div", "");
    right.appendChild(pill("pill", `#${idx + 1}`));
    top.appendChild(right);
    card.appendChild(top);

    // Question text
    const qText = textarea(it.text || "", "Skriv frågan…");
    qText.disabled = !canEdit;
    qText.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = clampLen(qText.value, 4000);
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "question";
        next.text = v;
        return next;
      });
    });
    card.appendChild(labelWrap("Fråga", qText));

    // Options model OR legacy choices model
    const hasLegacyChoices = Array.isArray(it.choices) && it.choices.length > 0;

    if (hasLegacyChoices) {
      const choices = Array.isArray(it.choices) ? it.choices : [];
      const list = el("div", "");
      list.appendChild(el("div", "fieldLbl", "Svarsalternativ"));

      for (let i = 0; i < choices.length; i++) {
        const c = choices[i] || {};
        const row = el("div", "optRow");
        const inp = inputText(c.text || "", `Alternativ ${i + 1}`);
        inp.disabled = !canEdit;
        inp.addEventListener("input", function () {
          if (!canEdit || !isFn(onPatchItem)) return;
          const v = clampLen(inp.value, 2000);
          onPatchItem(idx, function (cur) {
            const next = deepClone(cur || {});
            const arr = Array.isArray(next.choices) ? next.choices.slice() : [];
            const cx = deepClone(arr[i] || {});
            cx.id = normStr(cx.id || c.id || `c${i + 1}`);
            cx.text = v;
            arr[i] = cx;
            next.choices = arr;
            return next;
          });
        });

        const del = btn("optBtn", "Ta bort");
        del.disabled = !canEdit || choices.length <= 2;
        del.addEventListener("click", function () {
          if (!canEdit || !isFn(onPatchItem)) return;
          onPatchItem(idx, function (cur) {
            const next = deepClone(cur || {});
            const arr = Array.isArray(next.choices) ? next.choices.slice() : [];
            if (arr.length <= 2) return next;
            arr.splice(i, 1);
            next.choices = arr;

            const ak = next.answerKeyObj && next.answerKeyObj.correctChoiceId ? String(next.answerKeyObj.correctChoiceId) : "";
            const ids = arr.map((x) => String(x && x.id || ""));
            if (ak && ids.indexOf(ak) === -1) {
              next.answerKeyObj = next.answerKeyObj && typeof next.answerKeyObj === "object" ? next.answerKeyObj : {};
              next.answerKeyObj.correctChoiceId = "";
            }
            return next;
          });
        });

        row.appendChild(inp);
        row.appendChild(del);
        list.appendChild(row);
      }

      const add = btn("optBtn", "Lägg till");
      add.disabled = !canEdit;
      add.addEventListener("click", function () {
        if (!canEdit || !isFn(onPatchItem)) return;
        onPatchItem(idx, function (cur) {
          const next = deepClone(cur || {});
          const arr = Array.isArray(next.choices) ? next.choices.slice() : [];
          const n = arr.length + 1;
          arr.push({ id: `c${n}`, text: "" });
          next.choices = arr;
          return next;
        });
      });

      const addRow = el("div", "optRow");
      addRow.appendChild(add);
      list.appendChild(addRow);

      card.appendChild(list);

      const values = [{ value: "", label: "Välj facit…" }];
      for (const c of choices) {
        const id = String(c && c.id || "");
        const tx = String(c && c.text || "").trim();
        values.push({ value: id, label: tx ? tx : id || "(tomt alternativ)" });
      }
      const cur = it.answerKeyObj && it.answerKeyObj.correctChoiceId ? String(it.answerKeyObj.correctChoiceId) : "";
      const s = select(values, cur);
      s.disabled = !canEdit;
      s.addEventListener("change", function () {
        if (!canEdit || !isFn(onPatchItem)) return;
        const v = String(s.value || "");
        onPatchItem(idx, function (curIt) {
          const next = deepClone(curIt || {});
          next.answerKeyObj = next.answerKeyObj && typeof next.answerKeyObj === "object" ? next.answerKeyObj : {};
          next.answerKeyObj.correctChoiceId = v;
          return next;
        });
      });
      card.appendChild(labelWrap("Facit", s));

      const rat = textarea((it.answerKeyObj && it.answerKeyObj.rationale) ? String(it.answerKeyObj.rationale) : "", "Varför är detta rätt? (valfritt)");
      rat.disabled = !canEdit;
      rat.addEventListener("input", function () {
        if (!canEdit || !isFn(onPatchItem)) return;
        const v = clampLen(rat.value, 4000);
        onPatchItem(idx, function (curIt) {
          const next = deepClone(curIt || {});
          next.answerKeyObj = next.answerKeyObj && typeof next.answerKeyObj === "object" ? next.answerKeyObj : {};
          next.answerKeyObj.rationale = v;
          return next;
        });
      });
      card.appendChild(labelWrap("Motivering (valfritt)", rat));
    } else {
      const opts = Array.isArray(it.options) ? it.options : [];
      const list = el("div", "");
      list.appendChild(el("div", "fieldLbl", "Svarsalternativ"));

      const safeOpts = opts.length ? opts.slice() : ["", ""];
      while (safeOpts.length < 2) safeOpts.push("");

      for (let i = 0; i < safeOpts.length; i++) {
        const row = el("div", "optRow");
        const inp = inputText(safeOpts[i] || "", `Alternativ ${i + 1}`);
        inp.disabled = !canEdit;

        inp.addEventListener("input", function () {
          if (!canEdit || !isFn(onPatchItem)) return;
          const v = clampLen(inp.value, 2000);
          onPatchItem(idx, function (cur) {
            const next = deepClone(cur || {});
            const arr = Array.isArray(next.options) ? next.options.slice() : [];
            while (arr.length < 2) arr.push("");
            arr[i] = v;
            next.options = arr;
            return next;
          });
        });

        const del = btn("optBtn", "Ta bort");
        del.disabled = !canEdit || safeOpts.length <= 2;
        del.addEventListener("click", function () {
          if (!canEdit || !isFn(onPatchItem)) return;
          onPatchItem(idx, function (cur) {
            const next = deepClone(cur || {});
            const arr = Array.isArray(next.options) ? next.options.slice() : [];
            while (arr.length < 2) arr.push("");
            if (arr.length <= 2) return next;

            const removed = String(arr[i] || "");
            arr.splice(i, 1);
            next.options = arr;

            if (String(next.answerKey || "") === removed) next.answerKey = "";
            return next;
          });
        });

        row.appendChild(inp);
        row.appendChild(del);
        list.appendChild(row);
      }

      const add = btn("optBtn", "Lägg till");
      add.disabled = !canEdit;
      add.addEventListener("click", function () {
        if (!canEdit || !isFn(onPatchItem)) return;
        onPatchItem(idx, function (cur) {
          const next = deepClone(cur || {});
          const arr = Array.isArray(next.options) ? next.options.slice() : [];
          while (arr.length < 2) arr.push("");
          arr.push("");
          next.options = arr;
          return next;
        });
      });

      const addRow = el("div", "optRow");
      addRow.appendChild(add);
      list.appendChild(addRow);

      card.appendChild(list);

      const values = [{ value: "", label: "Välj facit…" }];
      const cur = String(it.answerKey || "");
      const unique = new Set();
      for (const o of safeOpts) {
        const tx = String(o || "");
        if (unique.has(tx)) continue;
        unique.add(tx);
        values.push({ value: tx, label: tx ? tx : "(tomt alternativ)" });
      }
      const s = select(values, cur);
      s.disabled = !canEdit;
      s.addEventListener("change", function () {
        if (!canEdit || !isFn(onPatchItem)) return;
        const v = String(s.value || "");
        onPatchItem(idx, function (curIt) {
          const next = deepClone(curIt || {});
          next.answerKey = v;
          return next;
        });
      });
      card.appendChild(labelWrap("Facit", s));
    }

    return card;
  }

  function renderTaskEditor(it, idx, canEdit, onPatchItem) {
    const card = el("div", "itemCard");
    const top = el("div", "itemRowTop");
    top.appendChild(el("div", "tiny", itemKindLabel("task") + (it.taskId ? ` • ${it.taskId}` : "")));

    const right = el("div", "");
    right.appendChild(pill("pill", `#${idx + 1}`));
    top.appendChild(right);
    card.appendChild(top);

    const instr = textarea(it.instruction || it.text || "", "Instruktion till eleven…");
    instr.disabled = !canEdit;
    instr.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = clampLen(instr.value, 4000);
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "task";
        next.instruction = v;
        if (!next.text) next.text = v;
        return next;
      });
    });
    card.appendChild(labelWrap("Instruktion", instr));

    const deliv = textarea(it.deliverable || "", "Vad ska lämnas in / visas / bockas av?");
    deliv.disabled = !canEdit;
    deliv.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = clampLen(deliv.value, 2000);
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "task";
        next.deliverable = v;
        return next;
      });
    });
    card.appendChild(labelWrap("Leverans (valfritt)", deliv));

    const req = document.createElement("input");
    req.type = "checkbox";
    req.checked = it.requiresDone !== false;
    req.disabled = !canEdit;
    req.addEventListener("change", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = !!req.checked;
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "task";
        next.requiresDone = v;
        return next;
      });
    });

    const reqRow = el("div", "optRow");
    reqRow.appendChild(req);
    reqRow.appendChild(el("div", "tiny", "Kräver att eleven markerar klar"));
    card.appendChild(reqRow);

    return card;
  }

  function renderDocumentEditor(it, idx, canEdit, onPatchItem) {
    const card = el("div", "itemCard");
    const top = el("div", "itemRowTop");
    top.appendChild(el("div", "tiny", itemKindLabel("document")));

    const right = el("div", "");
    right.appendChild(pill("pill", `#${idx + 1}`));
    top.appendChild(right);
    card.appendChild(top);

    const tx = textarea(it.text || "", "Dokumenttext…");
    tx.disabled = !canEdit;
    tx.addEventListener("input", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = clampLen(tx.value, 20000);
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "document";
        next.text = v;
        return next;
      });
    });
    card.appendChild(labelWrap("Text", tx));

    const sign = document.createElement("input");
    sign.type = "checkbox";
    sign.checked = !!it.requiresSign;
    sign.disabled = !canEdit;
    sign.addEventListener("change", function () {
      if (!canEdit || !isFn(onPatchItem)) return;
      const v = !!sign.checked;
      onPatchItem(idx, function (cur) {
        const next = deepClone(cur || {});
        next.kind = "document";
        next.requiresSign = v;
        return next;
      });
    });

    const signRow = el("div", "optRow");
    signRow.appendChild(sign);
    signRow.appendChild(el("div", "tiny", "Kräver signering (valfritt)"));
    card.appendChild(signRow);

    return card;
  }

  function renderSelectedDetail(opts) {
    const o = opts || {};
    const b = o.block || null;
    const canEdit = !!o.canEdit;
    const reasons = Array.isArray(o.validationReasons) ? o.validationReasons : [];
    const onPatchItem = isFn(o.onPatchItem) ? o.onPatchItem : null;

    if (!DOM.selDetail) return;
    clear(DOM.selDetail);

    if (!b) { renderSelectedEmpty(); return; }

    if (DOM.selHint) {
      DOM.selHint.textContent = canEdit
        ? "Valt block: redigera items. Frågor visar svarsalternativ + facit tydligt."
        : "Valt block (read-only): du kan granska items men inte ändra.";
    }

    // Header/meta
    const head = el("div", "previewCard");
    head.appendChild(el("div", "previewTitle", b.title || "(utan rubrik)"));

    const meta = el("div", "tiny previewMeta",
      `BlockID: ${b.blockId || "—"}\n` +
      `Modul: ${b.module || "—"}\n` +
      `Område: ${b.area || "—"}\n` +
      `Steg: ${b.step || "—"}\n` +
      `Status: ${String(b.status || "draft").toLowerCase() === "published" ? "Publicerad" : "Utkast"}`
    );
    head.appendChild(meta);

    const items = Array.isArray(b.items) ? b.items : [];
    const counts = { q: 0, d: 0, t: 0 };
    for (const it of items) {
      const k = String(it && it.kind ? it.kind : "document");
      if (k === "question") counts.q++;
      else if (k === "task") counts.t++;
      else counts.d++;
    }

    const pills = el("div", "icoRow");
    pills.appendChild(pill("icoPill", `❓ ${counts.q}`));
    pills.appendChild(pill("icoPill", `📄 ${counts.d}`));
    pills.appendChild(pill("icoPill", `✅ ${counts.t}`));
    head.appendChild(pills);

    DOM.selDetail.appendChild(head);

    // Validation reasons (contract)
    const vbox = renderValidationReasons(reasons);
    if (vbox) DOM.selDetail.appendChild(vbox);

    DOM.selDetail.appendChild(el("div", "divider"));

    // Items list
    if (!items.length) {
      DOM.selDetail.appendChild(el("div", "muted2", "Det här blocket har inga items ännu."));
      return;
    }

    const listWrap = el("div", "");
    listWrap.appendChild(el("div", "fieldLbl", `Items (${items.length})`));
    listWrap.appendChild(el("div", "tiny muted2", "Redigera rad för rad. All rendering är XSS-säker (textContent)."));

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const kind = String(it.kind || "document");

      let card = null;
      if (kind === "question") card = renderQuestionEditor(it, i, canEdit, onPatchItem);
      else if (kind === "task") card = renderTaskEditor(it, i, canEdit, onPatchItem);
      else card = renderDocumentEditor(it, i, canEdit, onPatchItem);

      listWrap.appendChild(card);
    }

    DOM.selDetail.appendChild(listWrap);
  }

  // ---------- export ----------
  NS.render = {
    setMsg: setMsg,
    showLockBox: showLockBox,

    setWhoPill: setWhoPill,
    setModePill: setModePill,
    setSelectionPill: setSelectionPill,
    setStatePill: setStatePill,
    setVerifyPill: setVerifyPill,
    setTopEditing: setTopEditing,

    renderBlockList: renderBlockList,
    renderTrainingHits: renderTrainingHits,
    renderExportPreview: renderExportPreview,
    setTrainExportHint: setTrainExportHint,

    renderSelectedEmpty: renderSelectedEmpty,
    renderSelectedDetail: renderSelectedDetail,

    __dom: DOM
  };
})();
