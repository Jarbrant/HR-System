/* ============================================================
   AO-SYS-SUPPORT-CORE-01 (PROD) — PATCH v1.2
   FIL: system/support-core.js

   Syfte (v1.2):
   - v1.1 (reuse existing #btnSupport/#supportPanel, inject if missing)
   - Global Systemadmin mode ("systemadmin" pack) + Scope-toggle
   - Tabs: Hjälp / Blockkarta
   - Blockkarta render from pack.blocks (page-mode vs global-mode)

   POLICY (LÅST):
   - UI-only • Ingen backend • Inga nya storage-keys
   - Ingen känslig data: får inte läsa/lagra empNo/scopeIds/org-id eller formulärvärden
   - Fail-closed: Support får aldrig blockera eller krascha sidan
   - XSS-säkert: DOM + textContent (ingen osäker innerHTML)
   - Support Core får inte påverka: auth/session, renderAll, Save/Delete, formulärfält, localStorage
   ============================================================ */

(function () {
  "use strict";

  // Fail-closed wrapper: inget här får krascha sidan.
  try {
    // ---------------------------
    // Interna helpers (tysta)
    // ---------------------------
    function safeStr(v) {
      return v === null || v === undefined ? "" : String(v);
    }
    function normStr(s) {
      return safeStr(s).trim().toLowerCase();
    }
    function el(tag, attrs) {
      var node = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          if (k === "text") node.textContent = safeStr(attrs[k]);
          else if (k === "className") node.className = safeStr(attrs[k]);
          else if (k === "htmlFor") node.htmlFor = safeStr(attrs[k]);
          else node.setAttribute(k, safeStr(attrs[k]));
        });
      }
      return node;
    }
    function stop(e) {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch (_) {}
    }
    function setAriaExpanded(btn, expanded) {
      try {
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");
      } catch (_) {}
    }
    function markBound(node) {
      try {
        if (!node) return false;
        if (node.getAttribute("data-support-core-bound") === "1") return false;
        node.setAttribute("data-support-core-bound", "1");
        return true;
      } catch (_) {
        return false;
      }
    }
    function isAnchorHash(node) {
      try {
        if (!node) return false;
        if (node.tagName && node.tagName.toLowerCase() === "a") {
          var href = safeStr(node.getAttribute("href"));
          return href === "#" || href.indexOf("#") === 0;
        }
        return false;
      } catch (_) {
        return false;
      }
    }

    // ---------------------------
    // pageId resolution (MUST)
    // ---------------------------
    var pageId = "unknown";
    try {
      var body = document.body;
      var attr = body ? body.getAttribute("data-help") : "";
      if (attr && normStr(attr)) pageId = normStr(attr);
      else if (typeof window.PAGE_HELP_ID === "string" && normStr(window.PAGE_HELP_ID)) {
        pageId = normStr(window.PAGE_HELP_ID);
      }
    } catch (_) {
      pageId = "unknown";
    }

    // Packs registry (MUST)
    window.SystemHelpPacks = window.SystemHelpPacks || {};
    function getPack(pid) {
      try {
        return window.SystemHelpPacks && window.SystemHelpPacks[pid] ? window.SystemHelpPacks[pid] : null;
      } catch (_) {
        return null;
      }
    }

    // v1.2: page + global packs
    function getPagePack() {
      return getPack(pageId);
    }
    function getGlobalPack() {
      return getPack("systemadmin");
    }

    // ---------------------------
    // ID/Selectors (v1.1)
    // ---------------------------
    var IDS = {
      // Standard IDs (MUST)
      btnExisting: "btnSupport",
      panel: "supportPanel",
      closeStd: "btnSupportClose",
      content: "supportContent",

      // Injected IDs (kept from v1.0 for safety)
      btnInjected: "sysSupportBtn",
      styles: "sysSupportCoreStyles",
      anonBtn: "supportCopyAnonBtn"
    };

    // Optional adapter selectors (OPTIONAL)
    var FALLBACK_BTN_SELECTORS = ["[data-support-trigger]", ".btnSupport"];

    // ---------------------------
    // Styles (neutral) — only injected once
    // ---------------------------
    function injectStylesOnce() {
      try {
        if (document.getElementById(IDS.styles)) return;
        var s = el("style", { id: IDS.styles });
        s.textContent = [
          "/* Support Core (system-neutral) */",
          "#" + IDS.btnInjected + "{",
          "  display:inline-flex; align-items:center; gap:8px;",
          "  padding:8px 12px; border-radius:12px;",
          "  border:1px solid rgba(0,0,0,.08);",
          "  background:#fff; color:inherit;",
          "  box-shadow:0 8px 22px rgba(0,0,0,.08);",
          "  cursor:pointer;",
          "}",
          "#" + IDS.btnInjected + ":hover{ box-shadow:0 10px 26px rgba(0,0,0,.10); }",
          "#" + IDS.btnInjected + ":focus{ outline:2px solid rgba(0,0,0,.25); outline-offset:2px; }",

          /* Panel default look (for injected panel OR if site uses #supportPanel without own styles) */
          "#" + IDS.panel + "{",
          "  position:fixed; right:16px; bottom:16px;",
          "  width:min(460px, calc(100vw - 32px));",
          "  max-height:min(78vh, 760px);",
          "  background:#fff; border:1px solid rgba(0,0,0,.10);",
          "  border-radius:16px; box-shadow:0 16px 44px rgba(0,0,0,.18);",
          "  overflow:hidden; display:none; z-index:9999;",
          "}",
          "#" + IDS.panel + ".open{ display:block; }",
          "#" + IDS.panel + " .hdr{ display:flex; align-items:flex-start; justify-content:space-between; gap:10px;",
          "  padding:12px 12px; border-bottom:1px solid rgba(0,0,0,.08); }",
          "#" + IDS.panel + " .hdrLeft{ display:flex; flex-direction:column; gap:8px; min-width:0; }",
          "#" + IDS.panel + " .hdr h2{ margin:0; font-size:14px; line-height:1.2; }",
          "#" + IDS.panel + " .subHdr{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }",
          "#" + IDS.panel + " .scopeRow{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }",
          "#" + IDS.panel + " .scopeLbl{ font-size:12px; opacity:.85; }",
          "#" + IDS.panel + " .scopeSel{ font-size:12px; padding:6px 8px; border-radius:10px; border:1px solid rgba(0,0,0,.12); background:#fff; }",
          "#" + IDS.panel + " .scopeNote{ font-size:12px; opacity:.75; }",
          "#" + IDS.panel + " .tabs{ display:flex; gap:8px; flex-wrap:wrap; }",
          "#" + IDS.panel + " .tabBtn{",
          "  font-size:12px; padding:6px 10px; border-radius:999px;",
          "  border:1px solid rgba(0,0,0,.12); background:#fff; cursor:pointer;",
          "}",
          "#" + IDS.panel + " .tabBtn[aria-selected='true']{ background:rgba(0,0,0,.05); }",
          "#" + IDS.panel + " .close{",
          "  width:32px; height:32px; border-radius:10px;",
          "  border:1px solid rgba(0,0,0,.10); background:#fff; cursor:pointer;",
          "}",
          "#" + IDS.panel + " .body{ padding:12px; overflow:auto; max-height:calc(min(78vh, 760px) - 66px); }",
          "#" + IDS.panel + " .sec{ margin:0 0 12px 0; }",
          "#" + IDS.panel + " .sec h3{ margin:0 0 6px 0; font-size:12px; opacity:.85; }",
          "#" + IDS.panel + " ul{ margin:0; padding-left:18px; }",
          "#" + IDS.panel + " li{ margin:4px 0; }",
          "#" + IDS.panel + " .faqs{ display:flex; flex-direction:column; gap:6px; }",
          "#" + IDS.panel + " .faqBtn{",
          "  text-align:left; padding:8px 10px; border-radius:12px;",
          "  border:1px solid rgba(0,0,0,.10); background:#fafafa; cursor:pointer;",
          "}",
          "#" + IDS.panel + " .faqBtn:hover{ background:#f6f6f6; }",
          "#" + IDS.panel + " .qaRow{ display:flex; gap:8px; align-items:center; }",
          "#" + IDS.panel + " input[type='text']{",
          "  flex:1; padding:9px 10px; border-radius:12px;",
          "  border:1px solid rgba(0,0,0,.12);",
          "}",
          "#" + IDS.panel + " .askBtn{",
          "  padding:9px 12px; border-radius:12px;",
          "  border:1px solid rgba(0,0,0,.12); background:#fff; cursor:pointer;",
          "}",
          "#" + IDS.panel + " .answer{",
          "  margin-top:8px; padding:10px; border-radius:12px;",
          "  border:1px solid rgba(0,0,0,.10); background:#fff;",
          "}",
          "#" + IDS.panel + " .muted{ opacity:.8; font-size:12px; }",
          "#" + IDS.panel + " .tools{ display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }",
          "#" + IDS.panel + " .toolBtn{ padding:8px 10px; border-radius:12px; border:1px solid rgba(0,0,0,.12); background:#fff; cursor:pointer; }",
          "#" + IDS.panel + " .blockGroup{ margin:0 0 14px 0; padding:10px; border:1px solid rgba(0,0,0,.10); border-radius:14px; background:#fff; }",
          "#" + IDS.panel + " .blockGroup h3{ margin:0 0 8px 0; font-size:12px; opacity:.85; }",
          "#" + IDS.panel + " .blockItem{ margin:0 0 10px 0; }",
          "#" + IDS.panel + " .blockItemTitle{ font-weight:700; font-size:12px; margin:0 0 6px 0; }"
        ].join("\n");
        (document.head || document.documentElement).appendChild(s);
      } catch (_) {}
    }

    injectStylesOnce();

    // ---------------------------
    // Mount finder (for injected button)
    // ---------------------------
    function findMount() {
      try {
        var m = document.getElementById("sysSupportMount");
        if (m) return m;

        var hdr = document.querySelector("header.top .topRight");
        if (hdr) return hdr;

        var main = document.querySelector("main.container");
        if (main) return main;

        return document.body || null;
      } catch (_) {
        return null;
      }
    }

    // ---------------------------
    // Existing button/panel detection (v1.1)
    // ---------------------------
    function findExistingButton() {
      try {
        var b = document.getElementById(IDS.btnExisting);
        if (b) return b;

        // OPTIONAL adapter selectors (only if safe)
        for (var i = 0; i < FALLBACK_BTN_SELECTORS.length; i++) {
          var sel = FALLBACK_BTN_SELECTORS[i];
          var node = document.querySelector(sel);
          if (node) return node;
        }
        return null;
      } catch (_) {
        return null;
      }
    }

    function findPanel() {
      try {
        return document.getElementById(IDS.panel) || null;
      } catch (_) {
        return null;
      }
    }

    // ---------------------------
    // Panel open/close toggling (safe)
    // ---------------------------
    function setPanelOpen(panel, open) {
      try {
        if (!panel) return;

        // Prefer class toggle (works with injected styles)
        if (open) panel.classList.add("open");
        else panel.classList.remove("open");

        // Also set hidden/aria-hidden to support existing markup
        if (open) {
          panel.removeAttribute("hidden");
          panel.setAttribute("aria-hidden", "false");
        } else {
          panel.setAttribute("aria-hidden", "true");
          // Only set hidden attribute; class handles visual
          panel.setAttribute("hidden", "hidden");
        }
      } catch (_) {}
    }

    function ensurePanelA11y(panel) {
      try {
        panel.setAttribute("role", panel.getAttribute("role") || "region");
        panel.setAttribute("aria-label", panel.getAttribute("aria-label") || "Supportpanel");
        if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
      } catch (_) {}
    }

    function focusInside(panel, preferred) {
      try {
        setTimeout(function () {
          try {
            if (preferred && typeof preferred.focus === "function") {
              preferred.focus();
              return;
            }
          } catch (_) {}
          try {
            panel.focus();
          } catch (_) {}
        }, 0);
      } catch (_) {}
    }

    // ---------------------------
    // Content mounts (MUST)
    // Render ONLY inside #supportContent
    // ---------------------------
    function ensureSupportContent(panel) {
      try {
        if (!panel) return null;

        var c = panel.querySelector("#" + IDS.content);
        if (c) return c;

        // Create internal container if missing (MUST)
        c = el("div", { id: IDS.content });

        // Try to place it in a sensible spot
        var bodyWrap = panel.querySelector(".body");
        if (bodyWrap) bodyWrap.appendChild(c);
        else panel.appendChild(c);

        return c;
      } catch (_) {
        return null;
      }
    }

    function clearNode(node) {
      try {
        while (node && node.firstChild) node.removeChild(node.firstChild);
      } catch (_) {}
    }

    function renderLines(container, lines) {
      try {
        if (!container) return;
        if (Array.isArray(lines)) {
          lines.forEach(function (ln) {
            var p = el("p");
            p.textContent = safeStr(ln);
            container.appendChild(p);
          });
        } else {
          var p2 = el("p");
          p2.textContent = safeStr(lines);
          container.appendChild(p2);
        }
      } catch (_) {}
    }

    // ---------------------------
    // Build injected panel (v1.0 layout)
    // If panel exists, we only create #supportContent and render there.
    // ---------------------------
    function createInjectedPanel() {
      var panel = el("section", {
        id: IDS.panel,
        role: "region",
        "aria-label": "Supportpanel",
        tabindex: "-1"
      });

      var hdr = el("div", { className: "hdr" });

      var hdrLeft = el("div", { className: "hdrLeft" });
      var h2 = el("h2", { id: "supportTitle", text: "Support för: " + pageId });
      hdrLeft.appendChild(h2);

      // v1.2: header controls container (scope + tabs) will be injected into #supportContent
      // but for injected panel, we keep hdrLeft available.
      var closeBtn = el("button", {
        id: IDS.closeStd,
        type: "button",
        className: "close",
        "aria-label": "Stäng supportpanel"
      });
      closeBtn.textContent = "×";

      hdr.appendChild(hdrLeft);
      hdr.appendChild(closeBtn);

      var bodyWrap = el("div", { className: "body" });

      // The ONLY dynamic mount:
      var content = el("div", { id: IDS.content });
      bodyWrap.appendChild(content);

      panel.appendChild(hdr);
      panel.appendChild(bodyWrap);

      try {
        (document.body || document.documentElement).appendChild(panel);
      } catch (_) {}

      return panel;
    }

    // ---------------------------
    // Create injected button (if needed)
    // ---------------------------
    function createInjectedButton(mount) {
      var btn = el("button", {
        id: IDS.btnInjected,
        type: "button",
        "aria-controls": IDS.panel,
        "aria-expanded": "false"
      });
      btn.textContent = "Support (denna sida)";
      try {
        mount.appendChild(btn);
      } catch (_) {
        try {
          (document.body || document.documentElement).appendChild(btn);
        } catch (_) {}
      }
      return btn;
    }

    // ---------------------------
    // Close button strategy for existing panel (MUST)
    // ---------------------------
    function findOrCreateClose(panel) {
      try {
        if (!panel) return null;

        var closeBtn = document.getElementById(IDS.closeStd);
        if (closeBtn) return closeBtn;

        closeBtn = panel.querySelector("[data-support-close]");
        if (closeBtn) return closeBtn;

        // Create minimal close button (MUST if none)
        var hdr = panel.querySelector(".hdr");
        if (!hdr) {
          hdr = el("div", { className: "hdr" });
          // Add at top
          try {
            panel.insertBefore(hdr, panel.firstChild);
          } catch (_) {
            try {
              panel.appendChild(hdr);
            } catch (_) {}
          }
        }

        // Ensure header has left container (for title + controls)
        var hdrLeft = hdr.querySelector(".hdrLeft");
        if (!hdrLeft) {
          hdrLeft = el("div", { className: "hdrLeft" });
          try {
            // Move existing h2 into hdrLeft if present
            var existingH2 = hdr.querySelector("h2");
            if (existingH2) {
              hdrLeft.appendChild(existingH2);
            }
            hdr.insertBefore(hdrLeft, hdr.firstChild);
          } catch (_) {
            try { hdr.appendChild(hdrLeft); } catch (_) {}
          }
        }

        // Add title if missing (neutral)
        var h = hdrLeft.querySelector("h2");
        if (!h) {
          h = el("h2", { id: "supportTitle", text: "Support för: " + pageId });
          hdrLeft.appendChild(h);
        }

        var c = el("button", { id: IDS.closeStd, type: "button", className: "close", "aria-label": "Stäng supportpanel" });
        c.textContent = "×";
        hdr.appendChild(c);
        return c;
      } catch (_) {
        return null;
      }
    }

    // ---------------------------
    // v1.2 UI state (no storage)
    // ---------------------------
    var UI_STATE = {
      scope: "page", // "page" | "global"
      tab: "help"    // "help" | "blocks"
    };

    function getActivePack() {
      try {
        if (UI_STATE.scope === "global") return getGlobalPack();
        return getPagePack();
      } catch (_) {
        return null;
      }
    }

    // ---------------------------
    // Render helpers for v1.2 controls
    // ---------------------------
    function ensureHeaderControls(panel) {
      // Ensure header has a place for the scope + tabs
      try {
        if (!panel) return null;
        var hdr = panel.querySelector(".hdr");
        if (!hdr) return null;

        var hdrLeft = hdr.querySelector(".hdrLeft");
        if (!hdrLeft) {
          hdrLeft = el("div", { className: "hdrLeft" });
          try {
            var h2 = hdr.querySelector("h2");
            if (h2) hdrLeft.appendChild(h2);
            hdr.insertBefore(hdrLeft, hdr.firstChild);
          } catch (_) {
            try { hdr.appendChild(hdrLeft); } catch (_) {}
          }
        }

        // Reuse if already present
        var existing = hdrLeft.querySelector("[data-support-controls='1']");
        if (existing) return existing;

        var wrap = el("div", { className: "subHdr" });
        wrap.setAttribute("data-support-controls", "1");

        // Scope row
        var scopeRow = el("div", { className: "scopeRow" });
        var lbl = el("span", { className: "scopeLbl", text: "Scope:" });

        var sel = el("select", { className: "scopeSel", "aria-label": "Välj scope för support" });
        // Options (MUST)
        var opt1 = el("option", { value: "page", text: "Den här sidan" });
        var opt2 = el("option", { value: "global", text: "Hela Systemadmin" });
        sel.appendChild(opt1);
        sel.appendChild(opt2);

        var note = el("span", { className: "scopeNote", text: "" });

        scopeRow.appendChild(lbl);
        scopeRow.appendChild(sel);
        scopeRow.appendChild(note);

        // Tabs
        var tabs = el("div", { className: "tabs", role: "tablist", "aria-label": "Supportflikar" });

        var tabHelp = el("button", { type: "button", className: "tabBtn" });
        tabHelp.textContent = "Hjälp";
        tabHelp.setAttribute("role", "tab");
        tabHelp.setAttribute("data-tab", "help");

        var tabBlocks = el("button", { type: "button", className: "tabBtn" });
        tabBlocks.textContent = "Blockkarta";
        tabBlocks.setAttribute("role", "tab");
        tabBlocks.setAttribute("data-tab", "blocks");

        tabs.appendChild(tabHelp);
        tabs.appendChild(tabBlocks);

        wrap.appendChild(scopeRow);
        wrap.appendChild(tabs);

        hdrLeft.appendChild(wrap);

        // Bind scope select (no storage)
        if (markBound(sel)) {
          sel.addEventListener("change", function () {
            try {
              UI_STATE.scope = sel.value === "global" ? "global" : "page";
              refresh(); // rerender content + title + placeholders
            } catch (_) {}
          });
        }

        // Bind tabs (no storage)
        function bindTab(btn) {
          if (!btn || !markBound(btn)) return;
          btn.addEventListener("click", function (e) {
            stop(e);
            try {
              var t = btn.getAttribute("data-tab");
              UI_STATE.tab = (t === "blocks") ? "blocks" : "help";
              refresh();
            } catch (_) {}
          });
        }
        bindTab(tabHelp);
        bindTab(tabBlocks);

        return wrap;
      } catch (_) {
        return null;
      }
    }

    function setTabA11y(panel) {
      try {
        var hdr = panel ? panel.querySelector(".hdr") : null;
        if (!hdr) return;
        var controls = hdr.querySelector("[data-support-controls='1']");
        if (!controls) return;

        var btnHelp = controls.querySelector("[data-tab='help']");
        var btnBlocks = controls.querySelector("[data-tab='blocks']");

        function setBtn(btn, selected) {
          if (!btn) return;
          btn.setAttribute("aria-selected", selected ? "true" : "false");
          btn.setAttribute("tabindex", selected ? "0" : "-1");
        }

        setBtn(btnHelp, UI_STATE.tab === "help");
        setBtn(btnBlocks, UI_STATE.tab === "blocks");

        // Scope select state + disable global when missing
        var sel = controls.querySelector("select.scopeSel");
        var note = controls.querySelector(".scopeNote");
        var globalPack = getGlobalPack();
        var hasGlobal = !!globalPack;

        if (sel) {
          sel.value = UI_STATE.scope;
          // If global missing → disable option + force page mode
          try {
            var optGlobal = sel.querySelector("option[value='global']");
            if (optGlobal) optGlobal.disabled = !hasGlobal;
          } catch (_) {}

          if (!hasGlobal && UI_STATE.scope === "global") UI_STATE.scope = "page";
          sel.value = UI_STATE.scope;
        }

        if (note) {
          note.textContent = (!hasGlobal) ? "Global support saknas ännu." : "";
        }
      } catch (_) {}
    }

    // ---------------------------
    // Render help pack into #supportContent (MUST)
    // v1.2: includes tabs + scope logic
    // ---------------------------
    function renderHelpView(content, pack, isGlobalMode) {
      try {
        if (!content) return;

        // If pack missing → fail-closed fallback
        if (!pack) {
          var p = el("p", { className: "muted" });
          p.textContent = "Hjälp är inte tillgänglig för detta läge ännu.";
          content.appendChild(p);
          return;
        }

        // Quick guide
        var qSec = el("div", { className: "sec" });
        qSec.appendChild(el("h3", { text: "Snabbguide" }));
        var ulQ = el("ul");
        if (Array.isArray(pack.quickGuide) && pack.quickGuide.length) {
          pack.quickGuide.forEach(function (line) {
            var li = el("li");
            li.textContent = safeStr(line);
            ulQ.appendChild(li);
          });
        } else {
          var li0 = el("li");
          li0.textContent = "Hjälp är inte tillgänglig för detta läge ännu.";
          ulQ.appendChild(li0);
        }
        qSec.appendChild(ulQ);
        content.appendChild(qSec);

        // FAQs list
        var faqSec = el("div", { className: "sec" });
        faqSec.appendChild(el("h3", { text: "Vanliga problem" }));
        var faqWrap = el("div", { className: "faqs" });

        // Answer area for clicks + ask
        var answerBox = el("div", { className: "answer" });
        answerBox.setAttribute("data-support-answer", "1");
        var fallback = el("div", { className: "muted" });
        fallback.textContent = isGlobalMode
          ? "Jag hittade inget säkert svar. Välj ett vanligt problem eller följ checklistan."
          : "Jag kan bara hjälpa med denna sida. Välj ett vanligt problem eller följ checklistan.";
        answerBox.appendChild(fallback);

        if (Array.isArray(pack.faqs) && pack.faqs.length) {
          pack.faqs.forEach(function (faq) {
            var q = safeStr(faq && faq.q);
            var id = safeStr(faq && faq.id);
            if (!q || !id) return;

            var b = el("button", { type: "button", className: "faqBtn" });
            b.textContent = q;

            b.addEventListener("click", function () {
              try {
                clearNode(answerBox);
                var a = faq && faq.a;
                if (a === undefined || a === null || a === "") {
                  var m = el("div", { className: "muted" });
                  m.textContent = "Svar saknas för detta problem.";
                  answerBox.appendChild(m);
                } else {
                  renderLines(answerBox, a);
                }
              } catch (_) {}
            });

            faqWrap.appendChild(b);
          });
        } else {
          var none = el("div", { className: "muted" });
          none.textContent = "Inga vanliga problem är definierade för detta läge ännu.";
          faqWrap.appendChild(none);
        }

        faqSec.appendChild(faqWrap);
        content.appendChild(faqSec);

        // Ask section + matching
        var askSec = el("div", { className: "sec" });
        askSec.appendChild(el("h3", { text: "Skriv en fråga" }));

        var qaRow = el("div", { className: "qaRow" });
        var qInput = el("input", {
          type: "text",
          inputmode: "text",
          autocomplete: "off",
          placeholder: isGlobalMode ? "Skriv en fråga om Systemadmin…" : "Skriv en fråga om denna sida…"
        });
        var qBtn = el("button", { type: "button", className: "askBtn" });
        qBtn.textContent = "Svara";
        qaRow.appendChild(qInput);
        qaRow.appendChild(qBtn);
        askSec.appendChild(qaRow);

        askSec.appendChild(answerBox);
        content.appendChild(askSec);

        // Troubleshoot
        var tSec = el("div", { className: "sec" });
        tSec.appendChild(el("h3", { text: "Felsökning (checklista)" }));
        var ulT = el("ul");
        if (Array.isArray(pack.troubleshoot) && pack.troubleshoot.length) {
          pack.troubleshoot.forEach(function (line) {
            var liT = el("li");
            liT.textContent = safeStr(line);
            ulT.appendChild(liT);
          });
        } else {
          var liT0 = el("li");
          liT0.textContent = "Kontrollera att sidan laddat klart och prova igen.";
          ulT.appendChild(liT0);
        }
        tSec.appendChild(ulT);
        content.appendChild(tSec);

        // Optional tools row (anon status)
        var toolsRow = el("div", { className: "tools" });
        var anonBtn = el("button", { type: "button", className: "toolBtn", id: IDS.anonBtn });
        anonBtn.textContent = "Kopiera status (anonym)";
        anonBtn.style.display = "none";
        toolsRow.appendChild(anonBtn);
        content.appendChild(toolsRow);

        // Matching helpers (must be fail-closed)
        function findFaqById(faqId) {
          try {
            if (!Array.isArray(pack.faqs)) return null;
            for (var i = 0; i < pack.faqs.length; i++) {
              if (safeStr(pack.faqs[i].id) === safeStr(faqId)) return pack.faqs[i];
            }
            return null;
          } catch (_) {
            return null;
          }
        }
        function matchQuestion(qText) {
          try {
            if (!Array.isArray(pack.match) || !pack.match.length) return null;
            var qn = normStr(qText);
            if (!qn) return null;

            for (var i = 0; i < pack.match.length; i++) {
              var m = pack.match[i];
              if (!m || !Array.isArray(m.keywords) || !safeStr(m.faqId)) continue;

              for (var k = 0; k < m.keywords.length; k++) {
                var kw = normStr(m.keywords[k]);
                if (!kw) continue;
                if (qn.indexOf(kw) !== -1) return safeStr(m.faqId); // first match wins
              }
            }
            return null;
          } catch (_) {
            return null;
          }
        }
        function setAnswer(linesOrString, isFallback) {
          try {
            clearNode(answerBox);
            if (isFallback) {
              var m = el("div", { className: "muted" });
              m.textContent = safeStr(linesOrString);
              answerBox.appendChild(m);
              return;
            }
            renderLines(answerBox, linesOrString);
          } catch (_) {}
        }
        function handleAsk() {
          try {
            var qn = normStr(qInput.value);
            if (!qn) {
              setAnswer("Skriv en kort fråga (t.ex. “kan inte spara”).", true);
              return;
            }
            var faqId = matchQuestion(qn);
            if (!faqId) {
              setAnswer("Jag hittade inget säkert svar. Välj ett vanligt problem eller följ checklistan.", true);
              return;
            }
            var faq = findFaqById(faqId);
            if (!faq) {
              setAnswer("Jag hittade inget säkert svar. Välj ett vanligt problem eller följ checklistan.", true);
              return;
            }
            var a = faq.a;
            if (a === undefined || a === null || a === "") setAnswer("Svar saknas för detta problem.", true);
            else setAnswer(a, false);
          } catch (_) {
            setAnswer("Jag hittade inget säkert svar. Välj ett vanligt problem eller följ checklistan.", true);
          }
        }
        qBtn.addEventListener("click", function (e) {
          stop(e);
          handleAsk();
        });
        qInput.addEventListener("keydown", function (e) {
          try {
            if (e.key === "Enter") {
              stop(e);
              handleAsk();
            }
          } catch (_) {}
        });

        // Optional anon status (same as v1.1, unchanged)
        function shouldShowAnon() {
          try {
            if (pack.enableAnonStatus !== true) return false;
            if (!window.SystemSupportSignals) return false;
            var sig = window.SystemSupportSignals;
            return typeof sig.orgOk === "boolean" || typeof sig.invalidCount === "number" || typeof sig.missingCount === "number";
          } catch (_) {
            return false;
          }
        }
        function buildAnonPayload() {
          try {
            var sig = window.SystemSupportSignals || null;
            if (!sig) return null;
            var lines = [];
            lines.push("pageId: " + safeStr(pageId));
            if (typeof sig.orgOk === "boolean") lines.push("Org: " + (sig.orgOk ? "OK" : "SAKNAS"));
            if (typeof sig.invalidCount === "number") lines.push("invalidCount: " + String(sig.invalidCount));
            if (typeof sig.missingCount === "number") lines.push("missingCount: " + String(sig.missingCount));
            return lines.join("\n");
          } catch (_) {
            return null;
          }
        }
        try {
          anonBtn.style.display = shouldShowAnon() ? "" : "none";
        } catch (_) {}
        anonBtn.addEventListener("click", function (e) {
          stop(e);
          try {
            if (!shouldShowAnon()) return;
            var payload = buildAnonPayload();
            if (!payload) return;

            if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard
                .writeText(payload)
                .then(function () {
                  setAnswer(["Kopierat (anonym):", payload], false);
                })
                .catch(function () {
                  setAnswer("Kunde inte kopiera status. (Browser-blockering)", true);
                });
            } else {
              setAnswer(["Status (anonym):", payload], false);
            }
          } catch (_) {}
        });

        return { inputNode: qInput };
      } catch (_) {
        return { inputNode: null };
      }
    }

    function renderBlocksView(content, pack, isGlobalMode) {
      try {
        if (!content) return;

        if (!pack) {
          var p0 = el("p", { className: "muted" });
          p0.textContent = "Hjälp är inte tillgänglig för detta läge ännu.";
          content.appendChild(p0);
          return;
        }

        var blocks = pack.blocks;
        if (!Array.isArray(blocks) || !blocks.length) {
          var p1 = el("p", { className: "muted" });
          p1.textContent = isGlobalMode
            ? "Ingen blockkarta finns i globalt pack ännu."
            : "Ingen blockkarta finns för denna sida ännu.";
          content.appendChild(p1);
          return;
        }

        if (!isGlobalMode) {
          // Page-mode: show block group only for this pageId if found
          var group = null;
          for (var i = 0; i < blocks.length; i++) {
            if (normStr(blocks[i].pageId) === normStr(pageId)) {
              group = blocks[i];
              break;
            }
          }
          if (!group) {
            var p2 = el("p", { className: "muted" });
            p2.textContent = "Ingen blockkarta finns för denna sida ännu.";
            content.appendChild(p2);
            return;
          }
          renderBlockGroup(content, group, true);
          return;
        }

        // Global-mode: show all groups
        for (var j = 0; j < blocks.length; j++) {
          renderBlockGroup(content, blocks[j], false);
        }
      } catch (_) {}
    }

    function renderBlockGroup(content, group, isSingle) {
      try {
        if (!content || !group) return;

        var title = safeStr(group.pageTitle) || safeStr(group.pageId) || "Sida";
        var wrap = el("div", { className: "blockGroup" });

        var h = el("h3", { text: title });
        wrap.appendChild(h);

        var items = group.items;
        if (!Array.isArray(items) || !items.length) {
          var m = el("div", { className: "muted" });
          m.textContent = "Inga block är definierade ännu.";
          wrap.appendChild(m);
          content.appendChild(wrap);
          return;
        }

        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (!it) continue;

          var blockId = safeStr(it.blockId);
          var t = safeStr(it.title);

          var itemWrap = el("div", { className: "blockItem" });
          var p = el("div", { className: "blockItemTitle" });
          p.textContent = (blockId ? (blockId + " — ") : "") + (t || "Block");
          itemWrap.appendChild(p);

          var checklist = it.checklist;
          if (Array.isArray(checklist) && checklist.length) {
            var ul = el("ul");
            for (var k = 0; k < checklist.length; k++) {
              var li = el("li");
              li.textContent = safeStr(checklist[k]);
              ul.appendChild(li);
            }
            itemWrap.appendChild(ul);
          } else {
            var mm = el("div", { className: "muted" });
            mm.textContent = "Ingen checklista definierad.";
            itemWrap.appendChild(mm);
          }

          wrap.appendChild(itemWrap);
        }

        content.appendChild(wrap);
      } catch (_) {}
    }

    function renderPackIntoContentV12(content, activePack, isGlobalMode) {
      try {
        if (!content) return { preferredFocus: null };

        clearNode(content);

        if (UI_STATE.tab === "blocks") {
          renderBlocksView(content, activePack, isGlobalMode);
          return { preferredFocus: null };
        }

        var res = renderHelpView(content, activePack, isGlobalMode);
        return { preferredFocus: res && res.inputNode ? res.inputNode : null };
      } catch (_) {
        return { preferredFocus: null };
      }
    }

    // ---------------------------
    // Strategy: use existing or inject (MUST)
    // ---------------------------
    var existingBtn = findExistingButton();
    var panel = findPanel();

    // If no panel exists, create it (v1.0 behavior)
    if (!panel) {
      panel = createInjectedPanel();
    } else {
      ensurePanelA11y(panel);
    }

    // Ensure close exists (MUST)
    var closeBtn = findOrCreateClose(panel);

    // Ensure content mount exists (MUST)
    var content = ensureSupportContent(panel);

    // Button strategy (MUST)
    var btn = null;
    var usingExistingBtn = false;

    if (existingBtn) {
      btn = existingBtn;
      usingExistingBtn = true;

      // MUST: aria-controls + aria-expanded
      try {
        btn.setAttribute("aria-controls", IDS.panel);
        btn.setAttribute("aria-expanded", "false");
      } catch (_) {}
    } else {
      // Inject button (v1.0)
      var mount = findMount();
      if (mount) btn = createInjectedButton(mount);
    }

    // If we still have no button, fail-closed: stop here.
    if (!btn || !panel) return;

    // Prevent double-binding (MUST fail-closed)
    if (!markBound(btn)) {
      return;
    }

    // ---------------------------
    // Toggle behavior (MUST + backward compatible)
    // ---------------------------
    var isOpen = false;

    function refresh() {
      try {
        if (!content) return;

        // Ensure header controls exist + state
        ensureHeaderControls(panel);
        setTabA11y(panel);

        var pack = getActivePack();
        var isGlobalMode = UI_STATE.scope === "global";

        // Render into #supportContent only
        var rr = renderPackIntoContentV12(content, pack, isGlobalMode);

        // Update title in panel header if present
        try {
          var titleNode = panel.querySelector("#supportTitle") || panel.querySelector(".hdr h2");
          if (titleNode) {
            var t = pack && safeStr(pack.title) ? safeStr(pack.title) : (isGlobalMode ? "Systemadmin" : pageId);
            titleNode.textContent = "Support för: " + t;
          }
        } catch (_) {}

        // Set placeholder helper already handled in renderHelpView

        // Return preferred focus (if any)
        return rr && rr.preferredFocus ? rr.preferredFocus : null;
      } catch (_) {
        return null;
      }
    }

    function openPanel() {
      try {
        isOpen = true;
        setPanelOpen(panel, true);
        setAriaExpanded(btn, true);

        // Render on open (packs may load after core)
        var preferred = refresh();

        focusInside(panel, preferred);
      } catch (_) {}
    }

    function closePanel() {
      try {
        isOpen = false;
        setPanelOpen(panel, false);
        setAriaExpanded(btn, false);
        try {
          btn.focus();
        } catch (_) {}
      } catch (_) {}
    }

    function togglePanel() {
      try {
        if (isOpen) closePanel();
        else openPanel();
      } catch (_) {}
    }

    // Existing dashboards might already have click logic.
    // Fail-closed: we bind once; we only preventDefault for anchor-hash links.
    btn.addEventListener("click", function (e) {
      try {
        if (usingExistingBtn) {
          // Backward compatible rule (MUST): preventDefault only if link with href="#"
          if (isAnchorHash(btn)) {
            stop(e);
          }
          // Do NOT stopPropagation for existing buttons; reduce conflict risk.
        } else {
          // Injected button → we control it fully
          stop(e);
        }
        togglePanel();
      } catch (_) {
        // Fail-closed: do nothing
      }
    });

    if (closeBtn && markBound(closeBtn)) {
      closeBtn.addEventListener("click", function (e) {
        try {
          stop(e);
          closePanel();
        } catch (_) {}
      });
    }

    // Esc closes (MUST): global listener only active when open
    document.addEventListener("keydown", function (e) {
      try {
        if (!isOpen) return;
        if (e.key === "Escape") {
          stop(e);
          closePanel();
        }
      } catch (_) {}
    });

    // Click outside closes (OPTIONAL)
    document.addEventListener("mousedown", function (e) {
      try {
        if (!isOpen) return;
        var t = e.target;
        if (!t) return;
        if (panel.contains(t) || btn.contains(t)) return;
        closePanel();
      } catch (_) {}
    });

    // Public hook: allow page to refresh after loading its pack
    try {
      window.SystemSupportCoreRefresh = function () {
        try {
          refresh();
        } catch (_) {}
      };
    } catch (_) {}

    // Default state: closed
    try {
      setPanelOpen(panel, false);
      setAriaExpanded(btn, false);
    } catch (_) {}
  } catch (_) {
    // Fail-closed: do nothing (never throw)
  }
})();
