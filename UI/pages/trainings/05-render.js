/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-08) | FILE 05/06 | FIL-ID: UI/pages/trainings/05-render.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Render-layer (XSS-safe) för trainings:
      - pills (who/state/context)
      - left hint + ai hint
      - list-render (vänster)
      - blocks-render (höger)
      - modal: view/edit/delete/save (för item-modal via 06-page)

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys
- XSS-safe: endast textContent (ingen osäker innerHTML)
- Ingen fetch • ingen worker
- Read-only respekteras (render visar, callbacks hanterar write)

PATCH v1.1.9 (PP-SC-010-08H) (AUTOPATCH):
- P0: List-delegation ignorerar klick/keydown från formkontroller/knappar (framtidssäkert).
- P1: Debug-box: renderDebug() visar/döljer debugpanel fail-soft.
- P2: Keydown-activate ignorerar om fokus ligger i input/textarea/select.

Ändringslogg (≤8):
- v1.1.9: list delegation: ignore interactive targets (button/a/input/textarea/select/label)
- v1.1.9: renderDebug: show/hide debugBox + null-safe clear
- v1.1.9: version bump

Testnoteringar:
- Klick i listkort väljer utbildning (som tidigare).
- Om framtida knappar/inputs läggs i listkort: klick i dem väljer inte utbildningen.
- Debug: renderDebug(obj) visar json; renderDebug(null) döljer.

Risk/edge cases:
- Inga funktionella ändringar i blocks/modal; endast robustare event-filter + debug-UI.
============================================================ */

(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.render) return;

  const render = (NS.render = {});
  render.__VERSION = "v1.1.9-PP-SC-010-08H";

  function byId(id) { return document.getElementById(String(id || "")); }
  function normStr(v) { return String(v ?? "").trim(); }
  function safeArr(a) { return Array.isArray(a) ? a : []; }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  // Debug (fail-soft): sätt window.__HR_DEBUG_TRAININGS_RENDER = true i console vid behov.
  function dbg(msg, obj) {
    try {
      if (window.__HR_DEBUG_TRAININGS_RENDER) console.log("[Trainings][Render]", msg, obj || "");
    } catch (_) { }
  }

  // We expect 01-dom to provide dom helpers; fallback to minimal.
  const dom = NS.dom || {
    setText: function (el, txt) { if (el) el.textContent = String(txt ?? ""); },
    show: function (el) { if (el) el.style.display = ""; },
    hide: function (el) { if (el) el.style.display = "none"; }
  };

  // Cache common elements (fail-soft)
  const EL = {
    contextPill: byId("contextPill"),
    contextText: byId("contextText"),
    statePill: byId("statePill"),
    stateText: byId("stateText"),
    whoPill: byId("whoPill"),
    whoText: byId("whoText"),
    leftHint: byId("leftHint"),
    aiHint: byId("aiHint"),
    list: byId("list"),
    blocksList: byId("blocksList"),
    debugPre: byId("debugPre"),
    debugBox: byId("debugBox")
  };

  function setPillClass(pillEl, kind) {
    if (!pillEl || !pillEl.classList) return;
    pillEl.classList.remove("ok", "warn", "bad");
    if (kind === "ok" || kind === "warn" || kind === "bad") pillEl.classList.add(kind);
  }

  function isInteractiveTarget(t) {
    try {
      if (!t) return false;
      if (!t.closest) return false;
      return !!t.closest("button,a,input,textarea,select,label");
    } catch (_) {
      return false;
    }
  }

  /* =========================================
     BLOCK 02/08 – Top pills
     ========================================= */
  render.setContextPill = function (text) {
    dom.setText(EL.contextText, normStr(text) || "—");
  };

  render.setStatePill = function (text, kind) {
    dom.setText(EL.stateText, normStr(text) || "Status: —");
    setPillClass(EL.statePill, kind);
  };

  render.setWhoPill = function (text) {
    dom.setText(EL.whoText, normStr(text) || "—");
  };

  /* =========================================
     BLOCK 03/08 – Hints
     ========================================= */
  render.setLeftHint = function (text) {
    dom.setText(EL.leftHint, normStr(text) || "");
  };

  render.setAiHint = function (text) {
    dom.setText(EL.aiHint, normStr(text) || "");
  };

  /* =========================================
     BLOCK 04/08 – Training list (vänster) + delegation
     ========================================= */
  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function makeBtn(label, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "miniBtn";
    b.textContent = label;
    if (title) b.title = title;
    return b;
  }

  // P0: robust step label ("1" -> "Steg 1", "Steg 1" behålls)
  function formatStep(stepRaw) {
    const s = normStr(stepRaw);
    if (!s) return "—";
    if (/^\d+$/.test(s)) return "Steg " + s;
    const low = s.toLowerCase();
    if (low.startsWith("steg")) return s; // redan "Steg X"
    const m = s.match(/(\d+)/);
    if (m && m[1]) return "Steg " + m[1];
    return "Steg " + s; // sista fallback
  }

  // --- Event-delegation state ---
  render.__LIST_BOUND = false;
  render.__listOnPick = null;

  function dbgPick(msg, obj) {
    try {
      if (window.__HR_DEBUG_TRAININGS_CLICKS) console.log("[Trainings][PICK]", msg, obj || "");
    } catch (_) { }
  }

  function bindListDelegation() {
    if (render.__LIST_BOUND) return;
    if (!EL.list) return;

    // CLICK delegation
    EL.list.addEventListener("click", function (e) {
      try {
        const t = e && e.target;
        if (!t) return;

        // P0: ignorera klick i interaktiva controls (framtidssäkert)
        if (isInteractiveTarget(t)) return;

        const el = t.closest ? t.closest("[data-training-id]") : null;
        const id = normStr(el && el.getAttribute && el.getAttribute("data-training-id"));
        if (!id) return;

        dbgPick("click", { id: id });

        if (typeof render.__listOnPick === "function") {
          render.__listOnPick(id);
        }
      } catch (_) { }
    }, true);

    // KEY delegation (Enter/Space)
    EL.list.addEventListener("keydown", function (e) {
      try {
        if (!e) return;

        // P2: om fokus ligger i input/textarea/select osv, trigga inte pick
        if (isInteractiveTarget(e.target)) return;

        const k = e.key || e.keyCode;
        const isActivate = (k === "Enter" || k === " " || k === 13 || k === 32);
        if (!isActivate) return;

        const t = e.target;
        const el = t && t.closest ? t.closest("[data-training-id]") : null;
        const id = normStr(el && el.getAttribute && el.getAttribute("data-training-id"));
        if (!id) return;

        e.preventDefault && e.preventDefault();
        dbgPick("keydown", { id: id, key: k });

        if (typeof render.__listOnPick === "function") {
          render.__listOnPick(id);
        }
      } catch (_) { }
    }, true);

    render.__LIST_BOUND = true;
  }

  function makeCardRow(t, selected, id) {
    const wrap = document.createElement("div");

    // data + button-semantik
    const tid = normStr(id || (t && t.id));
    if (tid) wrap.setAttribute("data-training-id", tid);
    wrap.setAttribute("role", "button");
    wrap.setAttribute("tabindex", "0");

    const tTitle = normStr(t && t.title) || "(utan titel)";
    wrap.setAttribute("aria-label", "Välj utbildning: " + tTitle);

    wrap.style.pointerEvents = "auto";
    wrap.style.position = "relative";

    wrap.style.border = "1px solid var(--line)";
    wrap.style.borderRadius = "14px";
    wrap.style.padding = "10px 10px";
    wrap.style.background = selected ? "rgba(17,24,39,.04)" : "var(--card)";
    wrap.style.boxShadow = selected ? "var(--shadow2)" : "none";
    wrap.style.cursor = "pointer";

    const top = document.createElement("div");
    top.style.display = "flex";
    top.style.gap = "8px";
    top.style.alignItems = "center";
    top.style.justifyContent = "space-between";
    top.style.flexWrap = "wrap";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.gap = "2px";
    left.style.minWidth = "220px";
    left.style.flex = "1";

    const title = document.createElement("div");
    title.style.fontWeight = "900";
    title.textContent = tTitle;
    left.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "muted2";
    meta.style.textAlign = "left";

    const st = normStr(t && t.status) || "draft";
    const mod = normStr(t && t.module) || "—";
    const area = normStr(t && t.area) || "—";

    // Kapitellogik: ta kursfält om de finns (06-page skriver courseTitle/courseStep)
    const chapter = normStr(t && (t.courseTitle != null ? t.courseTitle : "")) || "—";
    const stepLabel = formatStep(t && (t.courseStep != null ? t.courseStep : ""));

    meta.textContent = `${st} • ${mod} • ${area} • ${chapter} • ${stepLabel}`;
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.alignItems = "center";

    const pill = document.createElement("span");
    pill.className = "pill";
    pill.style.padding = "5px 9px";
    pill.style.fontSize = "12px";
    const dot = document.createElement("span");
    dot.className = "pillDot";
    dot.setAttribute("aria-hidden", "true");
    const txt = document.createElement("span");
    txt.textContent = st === "published" ? "Publicerad" : "Utkast";
    pill.appendChild(dot);
    pill.appendChild(txt);
    setPillClass(pill, st === "published" ? "ok" : "warn");

    right.appendChild(pill);

    top.appendChild(left);
    top.appendChild(right);

    wrap.appendChild(top);
    return wrap;
  }

  render.renderTrainingList = function (opts) {
    const items = safeArr(opts && opts.items);
    const selectedId = normStr(opts && opts.selectedId);
    const onPick = typeof (opts && opts.onPick) === "function" ? opts.onPick : function () { };

    if (!EL.list) return;

    render.__listOnPick = onPick;
    bindListDelegation();

    clearChildren(EL.list);

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "muted2";
      empty.style.padding = "10px 2px";
      empty.textContent = "Ingen träff. Sök eller tryck “Visa alla”.";
      EL.list.appendChild(empty);
      return;
    }

    for (const t of items) {
      const id = normStr(t && t.id);
      const card = makeCardRow(t, id && id === selectedId, id);
      EL.list.appendChild(card);
    }
  };

  /* =========================================
     BLOCK 05/08 – Blocks list (höger)
     ========================================= */

  function hasNestedQuestion(it) {
    // item.question kan vara string (legacy) eller objekt (ny worker-shape)
    return !!(it && isObj(it.question) && (
      normStr(it.question.kind).toLowerCase() === "question" ||
      typeof it.question.text === "string" ||
      Array.isArray(it.question.choices)
    ));
  }

  function itemKind(it) {
    const t = normStr(it && it.type).toLowerCase();
    if (t === "question" || t === "quiz") return "question";
    // fail-soft: nested question obj
    if (hasNestedQuestion(it)) return "question";
    // fail-soft: om question-fält finns som string
    if (it && typeof it === "object" && typeof it.question === "string" && normStr(it.question)) return "question";
    return "other";
  }

  function typeLabel(it) {
    const s = normStr(it && it.type).toLowerCase();
    if (s === "question" || s === "quiz") return "Fråga";
    // fail-soft: nested question obj (även om type='info')
    if (itemKind(it) === "question") return "Fråga";
    if (s === "task") return "Uppgift";
    if (s === "document" || s === "doc") return "Dokument";
    if (s === "both") return "Mix";
    return "Info";
  }

  // Robust text-extraktion (inkl nested question.text)
  function primaryText(it) {
    try {
      if (!it) return "";
      if (typeof it === "string") return normStr(it);
      if (!isObj(it)) return "";

      // Nested question object (din debug-shape)
      if (hasNestedQuestion(it)) {
        const qt = normStr(it.question && it.question.text);
        if (qt) return qt;
      }

      // Direkt-strängfält (vanliga)
      const direct =
        (typeof it.text === "string" && it.text) ||
        (typeof it.instruction === "string" && it.instruction) ||
        (typeof it.prompt === "string" && it.prompt) ||
        (typeof it.question === "string" && it.question) ||
        (typeof it.body === "string" && it.body) ||
        (typeof it.description === "string" && it.description) ||
        (typeof it.title === "string" && it.title) ||
        (typeof it.stem === "string" && it.stem) ||
        (typeof it.scenario === "string" && it.scenario) ||
        (typeof it.statement === "string" && it.statement) ||
        "";

      const d = normStr(direct);
      if (d) return d;

      // content: {text:"..."} / {body:"..."}
      if (isObj(it.content)) {
        const c =
          (typeof it.content.text === "string" && it.content.text) ||
          (typeof it.content.body === "string" && it.content.body) ||
          (typeof it.content.description === "string" && it.content.description) ||
          "";
        const cc = normStr(c);
        if (cc) return cc;
      }

      // fallback: ibland “q” eller “promptText”
      const alt =
        (typeof it.q === "string" && it.q) ||
        (typeof it.promptText === "string" && it.promptText) ||
        "";
      const a = normStr(alt);
      if (a) return a;

      dbg("primaryText: empty (field scan)", {
        type: normStr(it.type),
        hasNestedQuestion: hasNestedQuestion(it),
        keys: Object.keys(it).slice(0, 24)
      });

      return "";
    } catch (_) {
      return "";
    }
  }

  function previewFallback(it) {
    return itemKind(it) === "question" ? "(saknar frågetext)" : "(tomt)";
  }

  render.renderBlocksList = function (opts) {
    const blocks = safeArr(opts && opts.blocks);

    const onEdit = typeof (opts && opts.onEdit) === "function" ? opts.onEdit : null;
    const onDelete = typeof (opts && opts.onDelete) === "function" ? opts.onDelete : null;

    const onOpenBlock = typeof (opts && opts.onOpenBlock) === "function" ? opts.onOpenBlock : null;
    const onOpenItem = typeof (opts && opts.onOpenItem) === "function" ? opts.onOpenItem : null;

    if (!EL.blocksList) return;

    clearChildren(EL.blocksList);

    if (!blocks.length) {
      const empty = document.createElement("div");
      empty.className = "muted2";
      empty.style.padding = "10px 2px";
      empty.textContent = "Inga block ännu. Generera via AI eller lägg till senare.";
      EL.blocksList.appendChild(empty);
      return;
    }

    blocks.forEach(function (b, idx) {
      const card = document.createElement("div");
      card.style.border = "1px solid var(--line)";
      card.style.borderRadius = "14px";
      card.style.padding = "10px 10px";
      card.style.background = "var(--card)";
      card.style.boxShadow = "0 2px 10px rgba(17,24,39,.06)";
      card.style.marginBottom = "10px";

      if (onOpenBlock) {
        card.style.cursor = "pointer";
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-label", "Öppna block");
        card.addEventListener("keydown", function (e) {
          try {
            if (e && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpenBlock(idx); }
          } catch (_) { }
        });
        card.addEventListener("click", function (e) {
          const tag = String(e && e.target && e.target.tagName || "").toUpperCase();
          if (tag === "BUTTON") return;
          onOpenBlock(idx);
        });
      }

      const h = document.createElement("div");
      h.style.display = "flex";
      h.style.justifyContent = "space-between";
      h.style.alignItems = "center";
      h.style.gap = "10px";
      h.style.flexWrap = "wrap";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.flexDirection = "column";
      left.style.gap = "2px";
      left.style.flex = "1";

      const title = document.createElement("div");
      title.style.fontWeight = "900";
      title.textContent = normStr(b && b.title) || ("Block " + (idx + 1));
      left.appendChild(title);

      const items = safeArr(b && b.items);
      const meta = document.createElement("div");
      meta.className = "muted2";
      meta.style.textAlign = "left";
      meta.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
      left.appendChild(meta);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.alignItems = "center";

      if (onEdit) {
        const edit = makeBtn("Redigera", "Öppnar enkel editor (baseline)");
        edit.addEventListener("click", function (e) { e.stopPropagation(); onEdit(idx); });
        right.appendChild(edit);
      }
      if (onDelete) {
        const del = makeBtn("Ta bort", "Tar bort blocket (osparat tills du sparar)");
        del.className = "miniBtn danger";
        del.addEventListener("click", function (e) { e.stopPropagation(); onDelete(idx); });
        right.appendChild(del);
      }

      h.appendChild(left);
      h.appendChild(right);
      card.appendChild(h);

      const prev = document.createElement("div");
      prev.style.marginTop = "8px";
      prev.style.display = "flex";
      prev.style.flexDirection = "column";
      prev.style.gap = "6px";

      const take = Math.min(2, items.length);
      for (let i = 0; i < take; i++) {
        const it = items[i];
        const row = document.createElement("div");
        row.style.border = "1px dashed var(--line)";
        row.style.borderRadius = "12px";
        row.style.padding = "8px 10px";
        row.style.background = "rgba(17,24,39,.02)";

        if (onOpenItem) {
          row.style.cursor = "pointer";
          row.setAttribute("role", "button");
          row.setAttribute("tabindex", "0");
          row.setAttribute("aria-label", "Öppna item");
          row.addEventListener("keydown", function (e) {
            try {
              if (e && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpenItem(idx, i); }
            } catch (_) { }
          });
          row.addEventListener("click", function (e) { e.stopPropagation(); onOpenItem(idx, i); });
        }

        const a = document.createElement("div");
        a.className = "muted2";
        a.style.textAlign = "left";
        a.textContent = typeLabel(it);

        const btxt = document.createElement("div");
        btxt.style.fontWeight = "600";
        btxt.style.textAlign = "left";

        const txt = primaryText(it);
        btxt.textContent = txt ? txt : previewFallback(it);

        row.appendChild(a);
        row.appendChild(btxt);
        prev.appendChild(row);
      }

      card.appendChild(prev);
      EL.blocksList.appendChild(card);
    });
  };

  /* =========================================
     BLOCK 06/08 – Modal core (overlay + save/cancel)
     ========================================= */
  let _modalEl = null;
  let _modalRoot = null;
  let _prevBodyOverflow = null;

  function ensureModalRoot() {
    try {
      if (_modalRoot && _modalRoot.parentNode === document.body) return _modalRoot;
      const existing = document.getElementById("hrModalRoot");
      if (existing && existing.parentNode === document.body) {
        _modalRoot = existing;
        return _modalRoot;
      }
      const root = document.createElement("div");
      root.id = "hrModalRoot";
      root.style.position = "relative";
      root.style.zIndex = "2147483647";
      document.body.appendChild(root);
      _modalRoot = root;
      return _modalRoot;
    } catch (_) {
      _modalRoot = null;
      return null;
    }
  }

  function lockBodyScroll() {
    try {
      const b = document.body;
      if (!b) return;
      if (_prevBodyOverflow == null) _prevBodyOverflow = b.style.overflow || "";
      b.style.overflow = "hidden";
    } catch (_) { }
  }

  function unlockBodyScroll() {
    try {
      const b = document.body;
      if (!b) return;
      if (_prevBodyOverflow != null) b.style.overflow = _prevBodyOverflow;
      _prevBodyOverflow = null;
    } catch (_) { _prevBodyOverflow = null; }
  }

  function closeModal() {
    try {
      if (_modalEl && _modalEl.parentNode) _modalEl.parentNode.removeChild(_modalEl);
    } catch (_) { }
    _modalEl = null;
    unlockBodyScroll();
  }

  // Exponera fail-soft stängning så 06-page kan stänga modal vid byte
  render.closeItemModal = function () { try { closeModal(); } catch (_) { } };
  render.hideItemModal = function () { try { closeModal(); } catch (_) { } };

  function onWindowKeydown(e) {
    try {
      if (!_modalEl) return;
      const k = e && (e.key || e.keyCode);
      if (k === "Escape" || k === "Esc" || k === 27) {
        e.preventDefault && e.preventDefault();
        closeModal();
      }
    } catch (_) { }
  }
  try {
    window.addEventListener("keydown", onWindowKeydown, true);
  } catch (_) { }

  render.openModal = function (title, contentNode, onSave) {
    closeModal();

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,.35)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "14px";
    overlay.style.zIndex = "2147483647";

    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", normStr(title) || "Dialog");
    overlay.tabIndex = -1;

    const card = document.createElement("div");
    card.style.width = "min(820px, 96vw)";
    card.style.maxHeight = "88vh";
    card.style.overflow = "auto";
    card.style.background = "var(--card)";
    card.style.border = "1px solid var(--line)";
    card.style.borderRadius = "16px";
    card.style.boxShadow = "var(--shadow2)";
    card.style.padding = "14px";

    const h = document.createElement("div");
    h.style.display = "flex";
    h.style.justifyContent = "space-between";
    h.style.alignItems = "center";
    h.style.gap = "10px";
    h.style.flexWrap = "wrap";

    const t = document.createElement("div");
    t.style.fontWeight = "900";
    t.style.fontSize = "16px";
    t.textContent = normStr(title) || "Dialog";

    const x = document.createElement("button");
    x.type = "button";
    x.className = "miniBtn";
    x.textContent = "Stäng";
    x.addEventListener("click", closeModal);

    h.appendChild(t);
    h.appendChild(x);

    const body = document.createElement("div");
    body.style.marginTop = "10px";
    if (contentNode) body.appendChild(contentNode);

    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "10px";
    footer.style.marginTop = "12px";
    footer.style.flexWrap = "wrap";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "miniBtn";
    cancel.textContent = "Avbryt";
    cancel.addEventListener("click", closeModal);

    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn primary";
    save.textContent = "Spara";
    save.addEventListener("click", function () {
      // Om onSave() returnerar false -> håll modalen öppen (fail-closed)
      let shouldClose = true;
      try {
        if (typeof onSave === "function") {
          const res = onSave();
          if (res === false) shouldClose = false;
        }
      } catch (_) { }
      if (shouldClose) closeModal();
    });

    footer.appendChild(cancel);
    footer.appendChild(save);

    card.appendChild(h);
    card.appendChild(body);
    card.appendChild(footer);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });

    overlay.addEventListener("keydown", function (e) {
      try {
        if (e && (e.key === "Escape" || e.keyCode === 27)) closeModal();
      } catch (_) { }
    });

    overlay.appendChild(card);

    const root = ensureModalRoot();
    try {
      if (root) root.appendChild(overlay);
      else document.body.appendChild(overlay);
    } catch (_) {
      try { document.body.appendChild(overlay); } catch (_) { }
    }

    _modalEl = overlay;
    lockBodyScroll();

    try { overlay.focus(); } catch (_) { }
    try { x.focus && x.focus(); } catch (_) { }
  };

  /* =========================================
     BLOCK 07/08 – Modal: Item view/edit/delete/save (question-aware)
     ========================================= */

  function extractOptions(it) {
    if (!it) return [];

    // Nested question object: question.choices = [{id,text}]
    if (hasNestedQuestion(it)) {
      const ch = safeArr(it.question && it.question.choices);
      return ch.map(function (o) {
        if (typeof o === "string") return { id: "", text: normStr(o) };
        if (isObj(o)) return { id: normStr(o.id || o.value || ""), text: normStr(o.text || o.label || "") };
        return { id: "", text: normStr(String(o)) };
      }).filter(x => x.text);
    }

    const cand = it.options || it.choices || it.answers || it.alternatives;
    const arr = safeArr(cand);
    return arr.map(function (o) {
      if (typeof o === "string") return { id: "", text: normStr(o) };
      if (isObj(o)) return { id: normStr(o.id || o.value || ""), text: normStr(o.text || o.label || o.value || "") };
      return { id: "", text: normStr(String(o)) };
    }).filter(x => x.text);
  }

  function extractCorrect(it, optList) {
    const set = new Set();

    // Nested correctChoiceId
    if (hasNestedQuestion(it)) {
      const ccid = normStr(it.question && it.question.correctChoiceId);
      if (ccid) {
        for (let i = 0; i < optList.length; i++) {
          if (normStr(optList[i].id) === ccid) set.add(String(i));
        }
      }
    }

    const idx = it && (it.correctIndex ?? it.answerIndex ?? it.correctIdx);
    const idxs = it && (it.correctIndices ?? it.answerIndices ?? it.correctIdxs);
    const val = it && (it.correctAnswer ?? it.answer ?? it.correct);
    const vals = it && (it.correctAnswers ?? it.answersCorrect);

    if (typeof idx === "number" && idx >= 0) set.add(String(idx));
    if (Array.isArray(idxs)) idxs.forEach(i => { if (typeof i === "number" && i >= 0) set.add(String(i)); });

    function matchValue(v) {
      const s = normStr(v);
      if (!s) return;
      for (let i = 0; i < optList.length; i++) {
        if (normStr(optList[i].text).toLowerCase() === s.toLowerCase()) set.add(String(i));
      }
    }
    if (typeof val === "string") matchValue(val);
    if (Array.isArray(vals)) vals.forEach(matchValue);

    return set;
  }

  function extractExplanation(it) {
    if (!it || typeof it !== "object") return "";
    // Nested rationale
    if (hasNestedQuestion(it)) return normStr(it.question && (it.question.rationale || it.question.explanation || it.question.feedback || ""));
    return normStr(it.explanation || it.feedback || it.rationale || it.explain || "");
  }

  function extractContextHint(it) {
    if (!it || typeof it !== "object") return "";
    if (hasNestedQuestion(it)) return normStr(it.question && (it.question.contextHint || it.question.hint || it.question.context || ""));
    return normStr(it.contextHint || it.context || it.hint || "");
  }

  function makeSectionTitle(txt) {
    const h = document.createElement("div");
    h.style.fontWeight = "900";
    h.style.margin = "8px 0 6px";
    h.textContent = txt;
    return h;
  }

  function makeHr() {
    const hr = document.createElement("div");
    hr.style.height = "1px";
    hr.style.background = "var(--line)";
    hr.style.margin = "12px 0";
    return hr;
  }

  function showWarnLine(parent, text) {
    const w = document.createElement("div");
    w.style.marginTop = "10px";
    w.style.border = "1px solid rgba(220,38,38,.35)";
    w.style.background = "rgba(220,38,38,.06)";
    w.style.borderRadius = "12px";
    w.style.padding = "10px 12px";
    w.style.fontWeight = "800";
    w.style.color = "#991b1b";
    w.textContent = text;
    parent.appendChild(w);
  }

  render.openItemModal = function (opts) {
    const title = normStr(opts && opts.title) || "Item";
    const item = (opts && opts.item) ? opts.item : null;
    const canWrite = !!(opts && opts.canWrite);
    const onSave = typeof (opts && opts.onSave) === "function" ? opts.onSave : null;
    const onDelete = typeof (opts && opts.onDelete) === "function" ? opts.onDelete : null;

    if (!item || (typeof item !== "object" && typeof item !== "string")) {
      dbg("openItemModal: unknown item shape", item);
      const box = document.createElement("div");
      box.className = "muted2";
      box.textContent = "Kan inte visa detta item (okänd shape).";
      render.openModal(title, box, null);
      return;
    }

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "10px";

    const actionRow = document.createElement("div");
    actionRow.style.display = "flex";
    actionRow.style.justifyContent = "flex-end";
    actionRow.style.gap = "10px";
    actionRow.style.flexWrap = "wrap";

    const btnEdit = makeBtn("Redigera", "Redigera item");
    btnEdit.style.border = "2px solid #d11";
    btnEdit.style.color = "#d11";
    btnEdit.style.background = "transparent";
    btnEdit.style.padding = "10px 18px";
    btnEdit.style.borderRadius = "10px";

    const btnDel = makeBtn("Ta bort", "Ta bort item");
    btnDel.style.border = "2px solid #d11";
    btnDel.style.color = "#d11";
    btnDel.style.background = "transparent";
    btnDel.style.padding = "10px 18px";
    btnDel.style.borderRadius = "10px";

    if (!canWrite) {
      btnEdit.disabled = true;
      btnDel.disabled = true;
      try { btnEdit.setAttribute("aria-disabled", "true"); } catch (_) { }
      try { btnDel.setAttribute("aria-disabled", "true"); } catch (_) { }
    }

    actionRow.appendChild(btnEdit);
    actionRow.appendChild(btnDel);

    const content = document.createElement("div");
    let editMode = false;

    function buildView() {
      while (content.firstChild) content.removeChild(content.firstChild);

      const kind = itemKind(item);

      const top = document.createElement("div");
      top.style.display = "flex";
      top.style.alignItems = "center";
      top.style.gap = "10px";

      const icon = document.createElement("span");
      icon.textContent = "🧪";
      icon.setAttribute("aria-hidden", "true");

      const h = document.createElement("div");
      h.style.fontWeight = "900";
      h.style.fontSize = "20px";
      h.textContent = title;

      top.appendChild(icon);
      top.appendChild(h);
      content.appendChild(top);

      if (kind === "question") {
        const q = document.createElement("div");
        q.style.marginTop = "8px";
        q.style.fontWeight = "700";

        const qTxt = primaryText(item);
        q.textContent = qTxt ? qTxt : "(saknar frågetext)";
        content.appendChild(q);

        const hintTxt = extractContextHint(item);
        if (hintTxt) {
          const ch = document.createElement("div");
          ch.className = "muted2";
          ch.style.textAlign = "left";
          ch.style.marginTop = "6px";
          ch.textContent = "Avgränsning: " + hintTxt;
          content.appendChild(ch);
        }

        const optsList = extractOptions(item);
        const correctSet = extractCorrect(item, optsList);

        const hasOpts = optsList.length > 0;
        const hasCorrect = correctSet && correctSet.size > 0;

        if (!hasOpts) showWarnLine(content, "Den här frågan saknar svarsalternativ. (Fixa innan publicering/demo.)");
        if (!hasCorrect) showWarnLine(content, "Den här frågan saknar facit. (Markera korrekt svar innan publicering/demo.)");

        const list = document.createElement("div");
        list.style.marginTop = "10px";
        list.style.display = "flex";
        list.style.flexDirection = "column";
        list.style.gap = "8px";

        if (optsList.length) {
          for (let i = 0; i < optsList.length; i++) {
            const row = document.createElement("label");
            row.style.display = "flex";
            row.style.alignItems = "center";
            row.style.gap = "10px";

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.disabled = true;
            cb.checked = correctSet.has(String(i));

            const tx = document.createElement("span");
            tx.textContent = optsList[i].text;

            row.appendChild(cb);
            row.appendChild(tx);
            list.appendChild(row);
          }
        } else {
          const empty = document.createElement("div");
          empty.className = "muted2";
          empty.textContent = "Inga svarsalternativ.";
          list.appendChild(empty);
        }

        content.appendChild(list);
        content.appendChild(makeHr());

        const explTxt = extractExplanation(item);

        content.appendChild(makeSectionTitle("Förklaring:"));
        if (hasCorrect) {
          const okLine = document.createElement("div");
          okLine.style.fontWeight = "900";
          okLine.textContent = "Rätt!";
          content.appendChild(okLine);
        }

        const expl = document.createElement("div");
        expl.className = "muted2";
        expl.style.textAlign = "left";
        expl.textContent = explTxt ? explTxt : "Lägg till en kort förklaring så att eleven förstår varför svaret är rätt.";
        content.appendChild(expl);

        if (!hasCorrect && explTxt) {
          const n = document.createElement("div");
          n.className = "muted2";
          n.style.textAlign = "left";
          n.style.marginTop = "8px";
          n.textContent = "Obs: Facit saknas – markera korrekt svar för att kunna använda “Rätt!”-feedback i quiz.";
          content.appendChild(n);
        }
      } else {
        const info = document.createElement("div");
        info.style.marginTop = "8px";
        info.style.fontWeight = "700";
        info.textContent = primaryText(item) || "(tomt)";
        content.appendChild(info);

        const hint = document.createElement("div");
        hint.className = "muted2";
        hint.style.marginTop = "8px";
        hint.textContent = "Detta item är inte en frågetyp. (Modal stöder fortfarande redigera/spara av grundtext.)";
        content.appendChild(hint);
      }
    }

    function buildEdit() {
      while (content.firstChild) content.removeChild(content.firstChild);

      const kind = itemKind(item);

      const top = document.createElement("div");
      top.style.display = "flex";
      top.style.alignItems = "center";
      top.style.justifyContent = "space-between";
      top.style.gap = "10px";
      top.style.flexWrap = "wrap";

      const h = document.createElement("div");
      h.style.fontWeight = "900";
      h.style.fontSize = "18px";
      h.textContent = title + " (redigera)";
      top.appendChild(h);

      const badge = document.createElement("span");
      badge.className = "pill";
      badge.style.padding = "5px 9px";
      badge.style.fontSize = "12px";
      badge.textContent = kind === "question" ? "Fråga" : "Item";
      top.appendChild(badge);

      content.appendChild(top);
      content.appendChild(makeSectionTitle("Fråga / text"));

      const taQ = document.createElement("textarea");
      taQ.className = "textarea";
      taQ.value = primaryText(item) || "";
      content.appendChild(taQ);

      let optRows = [];

      if (kind === "question") {
        const optsList = extractOptions(item);
        const correctSet = extractCorrect(item, optsList);

        content.appendChild(makeSectionTitle("Svarsalternativ"));

        const wrapOpts = document.createElement("div");
        wrapOpts.style.display = "flex";
        wrapOpts.style.flexDirection = "column";
        wrapOpts.style.gap = "8px";

        while (optsList.length < 3) optsList.push({ id: "", text: "" });

        for (let i = 0; i < optsList.length; i++) {
          const row = document.createElement("div");
          row.style.display = "flex";
          row.style.alignItems = "center";
          row.style.gap = "10px";

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = correctSet.has(String(i));

          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "input";
          inp.value = normStr(optsList[i].text);

          row.appendChild(cb);
          row.appendChild(inp);
          wrapOpts.appendChild(row);

          optRows.push({ cb, inp, _id: normStr(optsList[i].id) });
        }

        content.appendChild(wrapOpts);

        content.appendChild(makeSectionTitle("Förklaring"));

        const taE = document.createElement("textarea");
        taE.className = "textarea";
        taE.value = extractExplanation(item);
        content.appendChild(taE);

        content.__EDIT_REFS = { kind, taQ, taE, optRows };
      } else {
        content.__EDIT_REFS = { kind, taQ, taE: null, optRows: [] };
      }
    }

    function toEdit() {
      if (!canWrite) return;
      editMode = true;
      buildEdit();
    }

    function toView() {
      editMode = false;
      buildView();
    }

    btnEdit.addEventListener("click", function (e) {
      e && e.preventDefault && e.preventDefault();
      if (!editMode) toEdit();
      else toView();
    });

    btnDel.addEventListener("click", function (e) {
      e && e.preventDefault && e.preventDefault();
      if (!canWrite) return;
      if (!onDelete) return;

      let ok = false;
      try { ok = window.confirm("Ta bort detta item? Detta sparas först när du sparar utbildningen."); }
      catch (_) { ok = false; }

      if (!ok) return;

      try { onDelete(); } catch (_) { }
      try { closeModal(); } catch (_) { }
    });

    wrap.appendChild(actionRow);
    wrap.appendChild(content);
    buildView();

    render.openModal(title, wrap, function () {
      if (!canWrite) return true;
      if (!onSave) return true;
      if (!editMode) return true;

      const refs = content.__EDIT_REFS || null;
      if (!refs || !refs.taQ) return true;

      const updated = (isObj(item) ? JSON.parse(JSON.stringify(item)) : { type: "info", text: String(item) });

      const qText = normStr(refs.taQ.value || "");
      if (isObj(updated)) {
        // Skriv tillbaka på bästa plats
        if (hasNestedQuestion(updated)) {
          updated.question = updated.question || {};
          updated.question.kind = normStr(updated.question.kind) || "question";
          updated.question.text = qText;
        } else if (typeof updated.question === "string") updated.question = qText;
        else if (typeof updated.text === "string") updated.text = qText;
        else if (typeof updated.instruction === "string") updated.instruction = qText;
        else if (typeof updated.prompt === "string") updated.prompt = qText;
        else updated.text = qText;
      }

      if (refs.kind === "question") {
        const optOut = [];
        const correctIdxs = [];
        const nestedChoices = [];

        // fail-closed: checkbox ikryssad men tom text
        for (let i = 0; i < refs.optRows.length; i++) {
          const row = refs.optRows[i];
          const t = normStr(row.inp.value || "");
          const checked = !!row.cb.checked;

          if (checked && !t) {
            try { window.alert("Du har markerat ett korrekt svar utan text. Fyll i texten eller avmarkera."); } catch (_) { }
            return false;
          }
        }

        for (let i = 0; i < refs.optRows.length; i++) {
          const t = normStr(refs.optRows[i].inp.value || "");
          if (!t) continue;

          optOut.push(t);
          const choiceId = normStr(refs.optRows[i]._id) || ("c" + (nestedChoices.length + 1));
          nestedChoices.push({ id: choiceId, text: t });

          if (refs.optRows[i].cb.checked) correctIdxs.push(optOut.length - 1);
        }

        if (optOut.length < 3) {
          try { window.alert("Frågan måste ha minst 3 svarsalternativ innan du sparar."); } catch (_) { }
          return false;
        }
        if (correctIdxs.length < 1) {
          try { window.alert("Markera minst ett korrekt svar (facit) innan du sparar."); } catch (_) { }
          return false;
        }

        if (isObj(updated)) {
          // säkra typ (även om den var 'info')
          updated.type = "question";

          // normalisera platt
          updated.options = optOut;
          const first = correctIdxs[0];
          updated.correctIndex = first;
          updated.correctIndices = correctIdxs;

          // legacy/alias om de finns
          if ("answerIndex" in updated) updated.answerIndex = first;
          if ("answerIndices" in updated) updated.answerIndices = correctIdxs;
          if ("correctIdx" in updated) updated.correctIdx = first;
          if ("correctIdxs" in updated) updated.correctIdxs = correctIdxs;

          // förklaring
          const expl = refs.taE ? normStr(refs.taE.value || "") : "";
          updated.explanation = expl;

          // uppdatera nested om det fanns (din worker-shape)
          if (hasNestedQuestion(updated)) {
            updated.question = updated.question || {};
            updated.question.kind = normStr(updated.question.kind) || "question";
            updated.question.text = qText;
            updated.question.choices = nestedChoices;

            // korrekt = correctChoiceId (ta första korrekta)
            const correctFirstIdx = first;
            const correctChoice = nestedChoices[correctFirstIdx];
            updated.question.correctChoiceId = normStr(correctChoice && correctChoice.id) || "c1";

            // rationale
            updated.question.rationale = expl;
          }

          dbg("modal-save(question): normalized", {
            options: optOut.length,
            correctIdxs: correctIdxs.slice(0),
            nested: hasNestedQuestion(updated)
          });
        }
      }

      try { onSave(updated); } catch (_) { }
      return true;
    });
  };

  /* =========================================
     BLOCK 08/08 – Debug view
     ========================================= */
  render.renderDebug = function (obj) {
    try {
      const has = !!obj;
      if (EL.debugBox) {
        if (has) dom.show(EL.debugBox);
        else dom.hide(EL.debugBox);
      }
      if (!EL.debugPre) return;
      if (!has) { dom.setText(EL.debugPre, "—"); return; }
      const json = JSON.stringify(obj, null, 2);
      dom.setText(EL.debugPre, json);
    } catch (_) {
      dom.setText(EL.debugPre, "—");
      try { if (EL.debugBox) dom.hide(EL.debugBox); } catch (_) { }
    }
  };
})();
