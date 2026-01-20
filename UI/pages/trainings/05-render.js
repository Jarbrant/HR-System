/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-05) | FILE 05/06 | FIL-ID: UI/pages/trainings/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render-lager för trainings (pills, listor, blocks, modal) • exporterar window.Trainings.render

POLICY (LÅST):
- UI-only • Fail-closed
- XSS-safe: textContent/value, ingen osäker innerHTML
- Inga nya storage-keys (AO-057_TRAININGS_V1 hanteras av 03-store)
- ADMIN-only write (MANAGER/SYSTEM_ADMIN = read-only, hanteras i 06-page/core)

PATCH v1.0.5-PP-SC-010-05 (AUTOPATCH):
- P0 FIX: Modal overlay visas säkert även om CSS har display:none (!important) — använder style.setProperty(...,"important").
- P0 FIX: Hide modal använder också "important" för att stänga deterministiskt.
- (Behåller självläkande modal + XSS-safe preview från v1.0.4)
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
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

  function normStr(v) { return String(v ?? "").trim(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }

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
  // Minimal modal (best-effort + självläkande)
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

  function ensureModalScaffold() {
    try {
      modal.wrap = modal.wrap || pickEl(dom.modal, byId("modal"), byId("modalWrap"), byId("modalOverlay"));
      modal.title = modal.title || pickEl(dom.modalTitle, byId("modalTitle"));
      modal.body = modal.body || pickEl(dom.modalBody, byId("modalBody"));
      modal.btnOk = modal.btnOk || pickEl(dom.modalOk, byId("modalOk"));
      modal.btnCancel = modal.btnCancel || pickEl(dom.modalCancel, byId("modalCancel"));

      if (modal.wrap && modal.body) return true;

      let overlay = byId("modalOverlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "modalOverlay";
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = "rgba(0,0,0,0.45)";
        overlay.style.display = "none";
        overlay.style.zIndex = "9999";
        overlay.style.padding = "20px";
        overlay.style.boxSizing = "border-box";
        overlay.setAttribute("aria-hidden", "true");
      }

      let card = byId("modalCard");
      if (!card) {
        card = document.createElement("div");
        card.id = "modalCard";
        card.style.maxWidth = "700px";
        card.style.margin = "40px auto";
        card.style.background = "#fff";
        card.style.borderRadius = "16px";
        card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.25)";
        card.style.padding = "16px";
        card.style.boxSizing = "border-box";
      }

      let title = byId("modalTitle");
      if (!title) {
        title = document.createElement("div");
        title.id = "modalTitle";
        title.style.fontWeight = "700";
        title.style.margin = "0 0 10px 0";
      }

      let body = byId("modalBody");
      if (!body) {
        body = document.createElement("div");
        body.id = "modalBody";
        body.style.margin = "0 0 14px 0";
      }

      let actions = byId("modalActions");
      if (!actions) {
        actions = document.createElement("div");
        actions.id = "modalActions";
        actions.style.display = "flex";
        actions.style.gap = "10px";
        actions.style.justifyContent = "flex-end";
        actions.style.marginTop = "10px";
      }

      let btnOk = byId("modalOk");
      if (!btnOk) {
        btnOk = document.createElement("button");
        btnOk.id = "modalOk";
        btnOk.type = "button";
        btnOk.textContent = "OK";
        btnOk.style.padding = "10px 14px";
        btnOk.style.borderRadius = "999px";
        btnOk.style.border = "1px solid #222";
        btnOk.style.background = "#111";
        btnOk.style.color = "#fff";
        btnOk.style.cursor = "pointer";
      }

      let btnCancel = byId("modalCancel");
      if (!btnCancel) {
        btnCancel = document.createElement("button");
        btnCancel.id = "modalCancel";
        btnCancel.type = "button";
        btnCancel.textContent = "Avbryt";
        btnCancel.style.padding = "10px 14px";
        btnCancel.style.borderRadius = "999px";
        btnCancel.style.border = "1px solid #bbb";
        btnCancel.style.background = "#f5f5f5";
        btnCancel.style.cursor = "pointer";
      }

      while (card.firstChild) card.removeChild(card.firstChild);
      card.appendChild(title);
      card.appendChild(body);

      while (actions.firstChild) actions.removeChild(actions.firstChild);
      actions.appendChild(btnCancel);
      actions.appendChild(btnOk);
      card.appendChild(actions);

      while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
      overlay.appendChild(card);

      if (!overlay.parentNode) document.body.appendChild(overlay);

      modal.wrap = overlay;
      modal.title = title;
      modal.body = body;
      modal.btnOk = btnOk;
      modal.btnCancel = btnCancel;
      modal._armed = false;

      return true;
    } catch (_) {
      return false;
    }
  }

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
      modal.wrap.addEventListener("click", function (e) {
        try {
          if (e && e.target === modal.wrap && modal.btnCancel) modal.btnCancel.click();
        } catch (_) {}
      });
    }
  }

  function showModal(title, contentEl, onOk) {
    ensureModalScaffold();
    armModalOnce();

    if (!modal.wrap || !modal.body) {
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

    // P0: tvinga synlighet även om CSS har display:none (!important)
    try {
      if (modal.wrap && modal.wrap.style && typeof modal.wrap.style.setProperty === "function") {
        modal.wrap.style.setProperty("display", "block", "important");
      } else if (modal.wrap) {
        modal.wrap.style.display = "block";
      }
      modal.wrap.setAttribute("aria-hidden", "false");
    } catch (_) { /* ignore */ }
  }

  function hideModal() {
    try {
      if (!modal.wrap) return;
      // P0: tvinga stängning deterministiskt
      if (modal.wrap.style && typeof modal.wrap.style.setProperty === "function") {
        modal.wrap.style.setProperty("display", "none", "important");
      } else {
        modal.wrap.style.display = "none";
      }
      modal.wrap.setAttribute("aria-hidden", "true");
    } catch (_) { /* ignore */ }
  }

  // -------------------------
  // Preview helpers (XSS-safe)
  // -------------------------
  function pickFirstNonEmpty() {
    for (let i = 0; i < arguments.length; i++) {
      const s = normStr(arguments[i]);
      if (s) return s;
    }
    return "";
  }

  function isLikelyQuestion(it) {
    const t = normStr(it && it.type).toLowerCase();
    if (t === "question" || t === "quiz" || t === "mcq") return true;
    const ch = safeArr(it && (it.choices || it.options || it.answers));
    if (ch.length >= 2) return true;
    return false;
  }

  function extractChoices(it) {
    const raw = safeArr(it && (it.choices || it.options || it.answers));
    return raw.map(c => {
      if (c && typeof c === "object") return { text: pickFirstNonEmpty(c.text, c.label, c.value) };
      return { text: normStr(c) };
    }).filter(x => normStr(x.text));
  }

  function detectCorrectIndex(it, choices) {
    const ci = (it && (it.correctIndex ?? it.answerIndex ?? it.correct_choice_index));
    if (Number.isFinite(ci)) {
      const n = Number(ci);
      if (n >= 0 && n < choices.length) return n;
    }

    const correctText =
      pickFirstNonEmpty(it && it.correctAnswer, it && it.correct, it && it.answer, it && it.solution);

    if (correctText) {
      const want = correctText.trim().toLowerCase();
      for (let i = 0; i < choices.length; i++) {
        if (choices[i] && choices[i].text && choices[i].text.trim().toLowerCase() === want) return i;
      }
    }

    const marks = safeArr(it && it.correctChoices);
    if (marks.length === choices.length) {
      for (let i = 0; i < marks.length; i++) if (marks[i] === true) return i;
    }

    return -1;
  }

  function summarizeItem(it) {
    const item = it || {};
    const lines = [];

    const title = pickFirstNonEmpty(item.title, item.heading, "");
    const text = pickFirstNonEmpty(item.question, item.prompt, item.text, item.instruction, item.body);
    const explanation = pickFirstNonEmpty(item.explanation, item.feedback, item.rationale, item.reason);

    if (isLikelyQuestion(item)) {
      const q = text || "(fråga saknas)";
      lines.push("Fråga: " + q);

      const choices = extractChoices(item);
      const correctIdx = detectCorrectIndex(item, choices);

      const max = Math.min(4, choices.length);
      for (let i = 0; i < max; i++) {
        const mark = (i === correctIdx) ? "☑ " : "☐ ";
        lines.push(mark + choices[i].text);
      }
      if (choices.length > max) lines.push("… +" + (choices.length - max) + " fler alternativ");

      if (explanation) lines.push("Förklaring: " + explanation);
    } else {
      if (title) lines.push(title);
      if (text) lines.push(text);
      if (explanation) lines.push("Notis: " + explanation);
    }

    const out = [];
    for (const s of lines) {
      if (out.length >= 6) break;
      const v = normStr(s);
      if (v) out.push(v);
    }
    return out;
  }

  // -------------------------
  // Public render API (export)
  // -------------------------
  const render = {
    __VERSION: "v1.0.5-PP-SC-010-05",

    setWhoPill: function (txt) { setText(elWho, txt || ""); },

    setStatePill: function (txt, kind) {
      if (elState && elState.classList) {
        elState.classList.remove("ok", "warn", "bad");
        if (kind) elState.classList.add(String(kind));
      }
      setText(elState, txt || "");
    },

    setLeftHint: function (txt) { setText(elLeftHint, txt || ""); },

    setAiHint: function (txt) { setText(elAiHint, txt || ""); },

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

        const top = mk("div", "rowTop");
        top.textContent = title;

        const sub = mk("div", "rowSub muted2");
        sub.textContent = (meta ? (meta + " • ") : "") + status;

        row.appendChild(top);
        row.appendChild(sub);

        if (id && id === selectedId) row.classList.add("active");

        row.addEventListener("click", function () { if (onPick) onPick(id); });

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
        const items = Array.isArray(b.items) ? b.items : [];
        const count = items.length;

        const row = mk("div", "blockRow");

        const left = mk("div", "blockLeft");
        const h = mk("div", "blockTitle");
        h.textContent = title;

        const s = mk("div", "muted2");
        s.textContent = count + " item";

        left.appendChild(h);
        left.appendChild(s);

        if (count > 0) {
          const pv = mk("div", "muted2");
          pv.style.textAlign = "left";
          pv.style.marginTop = "6px";
          pv.style.whiteSpace = "pre-wrap";
          pv.style.lineHeight = "1.35";

          const lines = summarizeItem(items[0]);
          pv.textContent = lines.join("\n");
          left.appendChild(pv);
        }

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

    openModal: function (title, contentEl, onOk) { showModal(title, contentEl, onOk); },

    closeModal: function () { hideModal(); }
  };

  NS.render = render;
})();
