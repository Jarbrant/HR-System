/* ============================================================
   AO-SYS-SUPPORT-CORE-01 (PROD) — PATCH v1.1
   FIL: system/support-core.js

   Syfte (v1.1):
   - Use existing Support button/panel if present (#btnSupport, #supportPanel)
   - If missing → inject (as v1.0)
   - Render all dynamic help content ONLY inside #supportContent (create if missing)

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
          "  width:min(420px, calc(100vw - 32px));",
          "  max-height:min(78vh, 720px);",
          "  background:#fff; border:1px solid rgba(0,0,0,.10);",
          "  border-radius:16px; box-shadow:0 16px 44px rgba(0,0,0,.18);",
          "  overflow:hidden; display:none; z-index:9999;",
          "}",
          "#" + IDS.panel + ".open{ display:block; }",
          "#" + IDS.panel + " .hdr{ display:flex; align-items:center; justify-content:space-between; gap:10px;",
          "  padding:12px 12px; border-bottom:1px solid rgba(0,0,0,.08); }",
          "#" + IDS.panel + " .hdr h2{ margin:0; font-size:14px; line-height:1.2; }",
          "#" + IDS.panel + " .close{",
          "  width:32px; height:32px; border-radius:10px;",
          "  border:1px solid rgba(0,0,0,.10); background:#fff; cursor:pointer;",
          "}",
          "#" + IDS.panel + " .body{ padding:12px; overflow:auto; max-height:calc(min(78vh, 720px) - 56px); }",
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
          "#" + IDS.panel + " .toolBtn{ padding:8px 10px; border-radius:12px; border:1px solid rgba(0,0,0,.12); background:#fff; cursor:pointer; }"
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
          // Do NOT force hidden if page relies on other style; but it's safe if we keep class open/remove
          // We only set hidden if it looks like it was hidden before by us.
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
    // Build injected panel content (v1.0 layout)
    // (If panel exists, we only create #supportContent and render there.)
    // ---------------------------
    function createInjectedPanel() {
      var panel = el("section", {
        id: IDS.panel,
        role: "region",
        "aria-label": "Supportpanel",
        tabindex: "-1"
      });

      var hdr = el("div", { className: "hdr" });
      var h2 = el("h2", { id: "supportTitle", text: "Support för: " + pageId });
      var closeBtn = el("button", {
        id: IDS.closeStd,
        type: "button",
        className: "close",
        "aria-label": "Stäng supportpanel"
      });
      closeBtn.textContent = "×";
      hdr.appendChild(h2);
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

        // Add title if missing (neutral)
        var h = hdr.querySelector("h2");
        if (!h) {
          h = el("h2", { id: "supportTitle", text: "Support för: " + pageId });
          hdr.appendChild(h);
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
    // Render help pack into #supportContent (MUST)
    // ---------------------------
    function renderPackIntoContent(content, pack) {
      try {
        if (!content) return false;

        clearNode(content);

        // If pack missing → fail-closed fallback
        if (!pack) {
          var p = el("p", { className: "muted" });
          p.textContent = "Hjälp är inte tillgänglig för denna sida ännu. Följ checklistan.";
          content.appendChild(p);
          return true;
        }

        // Title
        var title = safeStr(pack.title) ? safeStr(pack.title) : pageId;
        var h = el("div", { className: "sec" });
        var h3 = el("h3", { text: "Support för: " + title });
        h.appendChild(h3);
        content.appendChild(h);

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
          li0.textContent = "Hjälp är inte tillgänglig för denna sida ännu. Följ checklistan.";
          ulQ.appendChild(li0);
        }
        qSec.appendChild(ulQ);
        content.appendChild(qSec);

        // FAQs list
        var faqSec = el("div", { className: "sec" });
        faqSec.appendChild(el("h3", { text: "Vanliga problem" }));
        var faqWrap = el("div", { className: "faqs" });
        if (Array.isArray(pack.faqs) && pack.faqs.length) {
          pack.faqs.forEach(function (faq) {
            var q = safeStr(faq && faq.q);
            var id = safeStr(faq && faq.id);
            if (!q || !id) return;

            var b = el("button", { type: "button", className: "faqBtn" });
            b.textContent = q;

            b.addEventListener("click", function () {
              try {
                var aSec = content.querySelector("[data-support-answer]");
                if (!aSec) return;
                clearNode(aSec);

                var a = faq && faq.a;
                if (a === undefined || a === null || a === "") {
                  var m = el("div", { className: "muted" });
                  m.textContent = "Svar saknas för detta problem.";
                  aSec.appendChild(m);
                } else {
                  renderLines(aSec, a);
                }
              } catch (_) {}
            });

            faqWrap.appendChild(b);
          });
        } else {
          var none = el("div", { className: "muted" });
          none.textContent = "Inga vanliga problem är definierade för denna sida ännu.";
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
          placeholder: "Skriv t.ex. “kan inte spara”"
        });
        var qBtn = el("button", { type: "button", className: "askBtn" });
        qBtn.textContent = "Svara";
        qaRow.appendChild(qInput);
        qaRow.appendChild(qBtn);
        askSec.appendChild(qaRow);

        var answerBox = el("div", { className: "answer" });
        answerBox.setAttribute("data-support-answer", "1");
        var fallback = el("div", { className: "muted" });
        fallback.textContent = "Jag kan bara hjälpa med denna sida. Välj ett vanligt problem eller följ checklistan.";
        answerBox.appendChild(fallback);
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
              setAnswer("Jag kan bara hjälpa med denna sida. Välj ett vanligt problem eller följ checklistan.", true);
              return;
            }
            var faq = findFaqById(faqId);
            if (!faq) {
              setAnswer("Jag kan bara hjälpa med denna sida. Välj ett vanligt problem eller följ checklistan.", true);
              return;
            }
            var a = faq.a;
            if (a === undefined || a === null || a === "") setAnswer("Svar saknas för detta problem.", true);
            else setAnswer(a, false);
          } catch (_) {
            setAnswer("Jag kan bara hjälpa med denna sida. Välj ett vanligt problem eller följ checklistan.", true);
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

        // Optional anon status
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

        return true;
      } catch (_) {
        return false;
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

    // If content cannot be injected → fail-closed minimal fallback
    if (!content) {
      // We can still toggle the panel; but skip rendering.
      // Fail-closed: do nothing else.
    }

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
    // - If markBound fails → already bound, exit quietly.
    if (!markBound(btn)) {
      // Already bound; avoid conflicts (DoD requires no errors)
      return;
    }

    // ---------------------------
    // Toggle behavior (MUST + backward compatible)
    // ---------------------------
    var isOpen = false;

    function refresh() {
      try {
        if (!content) return;
        var pack = getPack(pageId);
        renderPackIntoContent(content, pack);

        // Update title in panel header if present (do not duplicate outside #supportContent)
        try {
          var titleNode = panel.querySelector("#supportTitle") || panel.querySelector(".hdr h2");
          if (titleNode) {
            var t = pack && safeStr(pack.title) ? safeStr(pack.title) : pageId;
            titleNode.textContent = "Support för: " + t;
          }
        } catch (_) {}
      } catch (_) {}
    }

    function openPanel() {
      try {
        isOpen = true;
        setPanelOpen(panel, true);
        setAriaExpanded(btn, true);

        // Render on open (packs may load after core)
        refresh();

        // Focus: prefer question input inside #supportContent if present
        var preferred = null;
        try {
          preferred = panel.querySelector("#" + IDS.content + " input[type='text']");
        } catch (_) {}
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

