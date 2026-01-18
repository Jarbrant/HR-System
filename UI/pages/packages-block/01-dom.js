/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 01/06 | FIL-ID: UI/pages/packages-block/01-dom.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Samla DOM-hooks + modal-hooks för packages-block (stabila id:n) + små UI-helpers
Policy (LÅST):
- UI-only • Fail-closed
- XSS-safe: textContent, inga osäkra innerHTML
- Ingen storage här (bara DOM/UI)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  // Idempotent: om filen redan initierat dom, behåll men komplettera.
  const existing = NS.dom && typeof NS.dom === "object" ? NS.dom : null;

  function $id(id) {
    return document.getElementById(String(id || ""));
  }

  function isEl(x) {
    return !!(x && typeof x === "object" && x.nodeType === 1);
  }

  // ---------- Core hooks (kan användas av andra filer om de vill) ----------
  const dom = Object.assign({}, existing || {}, {
    // common
    msgBox: $id("msgBox"),
    lockBox: $id("lockBox"),

    // left list
    qBlocks: $id("qBlocks"),
    btnShowAllBlocks: $id("btnShowAllBlocks"),
    filterStatus: $id("filterStatus"),
    fHasQ: $id("fHasQ"),
    fHasD: $id("fHasD"),
    fNoKey: $id("fNoKey"),
    fUnverified: $id("fUnverified"),

    // actions
    btnVerify: $id("btnVerify"),
    btnPrint: $id("btnPrint"),
    btnPublish: $id("btnPublish"),
    btnSaveEdits: $id("btnSaveEdits"),

    // export/training
    btnToggleExport: $id("btnToggleExport"),
    exportBody: $id("exportBody"),
    qTrainModule: $id("qTrainModule"),
    qTrainArea: $id("qTrainArea"),
    dlTrainAreas: $id("dlTrainAreas"),
    qTrainFree: $id("qTrainFree"),
    btnExportTraining: $id("btnExportTraining"),
    btnReloadTrainings: $id("btnReloadTrainings"),

    // selected/detail
    selDetail: $id("selDetail"),
    trainPreviewDetail: $id("trainPreviewDetail")
  });

  // ============================================================
  // MODAL HOOKS (MASTER EDITOR)
  // ============================================================
  // OBS: Dessa id:n måste finnas i admin/packages-block.html (Modal 1/3).
  // Fail-closed: om de saknas, returnerar openModal/closeModal ok:false.
  const MODAL_IDS = {
    overlay: "pbModalOverlay",
    dialog: "pbModalDialog",
    title: "pbModalTitle",
    sub: "pbModalSub",
    body: "pbModalBody",
    close: "pbModalClose",
    cancel: "pbModalCancel",
    save: "pbModalSave"
  };

  const modal = {
    overlay: $id(MODAL_IDS.overlay),
    dialog: $id(MODAL_IDS.dialog),
    title: $id(MODAL_IDS.title),
    sub: $id(MODAL_IDS.sub),
    body: $id(MODAL_IDS.body),
    close: $id(MODAL_IDS.close),
    cancel: $id(MODAL_IDS.cancel),
    save: $id(MODAL_IDS.save)
  };

  // ---------- Modal state ----------
  const MSTATE = {
    open: false,
    lastActive: null,
    onSave: null,
    onClose: null,
    _bound: false,
    _keydown: null,
    _clickOutside: null
  };

  function modalReady() {
    // Overlay + dialog + body är minimum.
    return isEl(modal.overlay) && isEl(modal.dialog) && isEl(modal.body);
  }

  function setText(el, text) {
    if (!isEl(el)) return;
    el.textContent = String(text || "");
  }

  function setHidden(el, hidden) {
    if (!isEl(el)) return;
    el.style.display = hidden ? "none" : "flex";
  }

  function focusFirstInModal() {
    if (!modalReady()) return;
    const root = modal.dialog;
    const focusables = root.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    for (let i = 0; i < focusables.length; i++) {
      const n = focusables[i];
      if (n && typeof n.focus === "function" && !n.disabled) {
        n.focus();
        return;
      }
    }
    // fallback
    if (modal.close && typeof modal.close.focus === "function") modal.close.focus();
  }

  function trapTab(e) {
    if (!MSTATE.open || !modalReady()) return;
    if (e.key !== "Tab") return;

    const root = modal.dialog;
    const list = Array.prototype.slice.call(
      root.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((n) => n && typeof n.focus === "function" && !n.disabled && n.offsetParent !== null);

    if (!list.length) return;

    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || active === root) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function bindModalOnce() {
    if (MSTATE._bound) return;
    MSTATE._bound = true;

    // ESC + TAB trap
    MSTATE._keydown = function (e) {
      if (!MSTATE.open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal({ reason: "esc" });
        return;
      }
      trapTab(e);
    };
    document.addEventListener("keydown", MSTATE._keydown);

    // click outside dialog closes
    MSTATE._clickOutside = function (e) {
      if (!MSTATE.open) return;
      if (!modalReady()) return;
      if (e && e.target === modal.overlay) closeModal({ reason: "backdrop" });
    };
    if (isEl(modal.overlay)) modal.overlay.addEventListener("click", MSTATE._clickOutside);

    // buttons
    if (isEl(modal.close)) {
      modal.close.addEventListener("click", function () {
        closeModal({ reason: "close" });
      });
    }
    if (isEl(modal.cancel)) {
      modal.cancel.addEventListener("click", function () {
        closeModal({ reason: "cancel" });
      });
    }
    if (isEl(modal.save)) {
      modal.save.addEventListener("click", function () {
        if (typeof MSTATE.onSave === "function") {
          try { MSTATE.onSave(); } catch (_) {}
        }
      });
    }
  }

  function openModal(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    if (!modalReady()) return { ok: false, err: "MODAL_MISSING_DOM" };

    bindModalOnce();

    MSTATE.lastActive = document.activeElement || null;
    MSTATE.onSave = typeof o.onSave === "function" ? o.onSave : null;
    MSTATE.onClose = typeof o.onClose === "function" ? o.onClose : null;

    setText(modal.title, o.title || "Redigera block");
    setText(modal.sub, o.sub || "");

    // Visa
    modal.overlay.setAttribute("aria-hidden", "false");
    setHidden(modal.overlay, false);
    MSTATE.open = true;

    // Fokus
    setTimeout(focusFirstInModal, 0);

    return { ok: true };
  }

  function closeModal(meta) {
    if (!modalReady()) return { ok: false, err: "MODAL_MISSING_DOM" };
    if (!MSTATE.open) return { ok: true };

    const info = meta && typeof meta === "object" ? meta : {};
    MSTATE.open = false;

    // Göm
    modal.overlay.setAttribute("aria-hidden", "true");
    setHidden(modal.overlay, true);

    // återställ callbacks
    const onClose = MSTATE.onClose;
    MSTATE.onSave = null;
    MSTATE.onClose = null;

    // restore focus
    const last = MSTATE.lastActive;
    MSTATE.lastActive = null;
    if (last && typeof last.focus === "function") {
      try { last.focus(); } catch (_) {}
    }

    // signal
    if (typeof onClose === "function") {
      try { onClose(info); } catch (_) {}
    }

    return { ok: true };
  }

  // Exponera modal API utan att tvinga någon att använda det.
  dom.modal = Object.assign({}, dom.modal || {}, {
    ids: MODAL_IDS,
    overlay: modal.overlay,
    dialog: modal.dialog,
    title: modal.title,
    sub: modal.sub,
    body: modal.body,
    close: modal.close,
    cancel: modal.cancel,
    save: modal.save,
    isReady: modalReady,
    isOpen: function () { return !!MSTATE.open; },
    open: openModal,
    close: closeModal
  });

  // Namespace export
  dom.__v = dom.__v || "1.0.0";
  NS.dom = dom;
})();
