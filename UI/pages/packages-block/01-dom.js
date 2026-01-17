/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 01/06 | FIL-ID: UI/pages/packages-block/01-dom.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: DOM-helpers (ingen storage, ingen logik, inga keys)
Policy:
- UI-only
- XSS-safe: använd textContent, inga osäkra innerHTML-hjälpare
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.dom) return; // idempotent

  function byId(id) {
    return document.getElementById(String(id || ""));
  }

  function qs(sel, root) {
    const r = root && root.querySelector ? root : document;
    return r.querySelector(String(sel || ""));
  }

  function qsa(sel, root) {
    const r = root && root.querySelectorAll ? root : document;
    return Array.from(r.querySelectorAll(String(sel || "")));
  }

  function clear(el) {
    const node = el && el.nodeType === 1 ? el : null;
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setText(el, text) {
    const node = el && el.nodeType === 1 ? el : null;
    if (!node) return;
    node.textContent = String(text ?? "");
  }

  function el(tag, attrs) {
    const t = String(tag || "div");
    const node = document.createElement(t);

    const a = attrs && typeof attrs === "object" ? attrs : null;
    if (a) {
      Object.keys(a).forEach((k) => {
        const v = a[k];
        if (v === undefined || v === null) return;

        if (k === "class") node.className = String(v);
        else if (k === "text") node.textContent = String(v);
        else if (k === "html") {
          // Medvetet inte stödd pga XSS-policy
          // Använd setText() eller bygg DOM-noder istället.
          node.textContent = String(v);
        } else if (k.startsWith("data-")) {
          node.setAttribute(k, String(v));
        } else if (k === "aria-label" || k.startsWith("aria-")) {
          node.setAttribute(k, String(v));
        } else if (k === "role") {
          node.setAttribute("role", String(v));
        } else {
          node.setAttribute(k, String(v));
        }
      });
    }
    return node;
  }

  function on(elm, eventName, handler, opts) {
    const node = elm && elm.addEventListener ? elm : null;
    if (!node) return function noop() {};
    const ev = String(eventName || "");
    const fn = typeof handler === "function" ? handler : function () {};
    node.addEventListener(ev, fn, opts);
    return function off() {
      try {
        node.removeEventListener(ev, fn, opts);
      } catch (_) {}
    };
  }

  function isEnterOrSpace(e) {
    const k = String(e && e.key ? e.key : "");
    return k === "Enter" || k === " ";
  }

  function makeButtonLike(div, onActivate) {
    const node = div && div.nodeType === 1 ? div : null;
    if (!node) return;

    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");

    on(node, "click", function () {
      try {
        onActivate && onActivate();
      } catch (_) {}
    });

    on(node, "keydown", function (e) {
      if (!isEnterOrSpace(e)) return;
      e.preventDefault();
      try {
        onActivate && onActivate();
      } catch (_) {}
    });
  }

  NS.dom = {
    byId,
    qs,
    qsa,
    clear,
    setText,
    el,
    on,
    isEnterOrSpace,
    makeButtonLike,
  };
})();
