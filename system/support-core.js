/* ============================================================
   AO-SYS-SUPPORT-CORE-01 (PROD) | FIL: system/support-core.js (NY)
   Projekt: HR-System (GitHub Pages / UI-only)
   Scope: /system/*.html (Systemadmin-sidor)

   POLICY (LÅST):
   - UI-only • Ingen backend • Inga storage-keys • Ingen känslig data
   - Får INTE läsa/lagra empNo/scopeIds/org-id eller formulärvärden
   - Fail-closed: Support får aldrig blockera eller krascha sidan
   - XSS-säkert: DOM + textContent (ingen osäker innerHTML)
   - Får inte påverka auth/session, renderAll, Save/Delete, formulärfält, localStorage

   INPUT/OUTPUT-KONTRAKT (MUST):
   - pageId-prio: <body data-help> → window.PAGE_HELP_ID → "unknown"
   - packs: window.SystemHelpPacks[pageId]
   - signals (optional): window.SystemSupportSignals (explicit från sida)
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
    function setAriaExpanded(btn, expanded) {
      try {
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");
      } catch (_) {}
    }
    function stop(e) {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch (_) {}
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
    // Inject button mount (MUST)
    // ---------------------------
    function findMount() {
      try {
        var m = document.getElementById("sysSupportMount");
        if (m) return m;

        // Fallback: header.top .topRight
        var hdr = document.querySelector("header.top .topRight");
        if (hdr) return hdr;

        // Fallback: main.container (överst) — inject sist i sektionen
        var main = document.querySelector("main.container");
        if (main) return main;

        // Sista fallback: body
        return document.body || null;
      } catch (_) {
        return null;
      }
    }

    // ---------------------------
    // UI: button + panel (MUST)
    // ---------------------------
    var IDS = {
      btn: "sysSupportBtn",
      panel: "supportPanel",
      title: "supportTitle",
      close: "supportCloseBtn",
      answer: "supportAnswer",
      qInput: "supportQuestion",
      qBtn: "supportAskBtn",
      faqList: "supportFaqList",
      quickList: "supportQuickGuide",
      troubleList: "supportTroubleshoot",
      fallbackNote: "supportFallbackNote",
      anonBtn: "supportCopyAnonBtn"
    };

    // Do not double-init if script loaded twice
    if (document.getElementById(IDS.btn) || document.getElementById(IDS.panel)) {
      return;
    }

    // Minimal neutral styles (inline) — UI-only, scope till dessa ids.
    function injectStylesOnce() {
      try {
        var styleId = "sysSupportCoreStyles";
        if (document.getElementById(styleId)) return;
        var s = el("style", { id: styleId });
        s.textContent =
          [
            "/* Support Core (system-neutral) */",
            "#" + IDS.btn + "{",
            "  display:inline-flex; align-items:center; gap:8px;",
            "  padding:8px 12px; border-radius:12px;",
            "  border:1px solid rgba(0,0,0,.08);",
            "  background:#fff; color:inherit;",
            "  box-shadow:0 8px 22px rgba(0,0,0,.08);",
            "  cursor:pointer;",
            "}",
            "#" + IDS.btn + ":hover{ box-shadow:0 10px 26px rgba(0,0,0,.10); }",
            "#" + IDS.btn + ":focus{ outline:2px solid rgba(0,0,0,.25); outline-offset:2px; }",
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

    var mount = findMount();
    if (!mount) return; // fail-closed: gör inget

    // Button (MUST)
    var btn = el("button", {
      id: IDS.btn,
      type: "button",
      "aria-controls": IDS.panel,
      "aria-expanded": "false"
    });
    btn.textContent = "Support (denna sida)";

    // Panel (MUST)
    var panel = el("section", {
      id: IDS.panel,
      role: "region",
      "aria-label": "Supportpanel",
      tabindex: "-1"
    });

    var hdr = el("div", { className: "hdr" });
    var h2 = el("h2", { id: IDS.title, text: "Support för: " + pageId });
    var closeBtn = el("button", { id: IDS.close, type: "button", className: "close", "aria-label": "Stäng supportpanel" });
    closeBtn.textContent = "×";
    hdr.appendChild(h2);
    hdr.appendChild(closeBtn);

    var bodyWrap = el("div", { className: "body" });

    // Sections
    var secQuick = el("div", { className: "sec" });
    secQuick.appendChild(el("h3", { text: "Snabbguide" }));
    var quickList = el("ul", { id: IDS.quickList });
    secQuick.appendChild(quickList);

    var secFaq = el("div", { className: "sec" });
    secFaq.appendChild(el("h3", { text: "Vanliga problem" }));
    var faqWrap = el("div", { id: IDS.faqList, className: "faqs" });
    secFaq.appendChild(faqWrap);

    var secAsk = el("div", { className: "sec" });
    secAsk.appendChild(el("h3", { text: "Skriv en fråga" }));
    var qaRow = el("div", { className: "qaRow" });
    var qInput = el("input", {
      id: IDS.qInput,
      type: "text",
      inputmode: "text",
      autocomplete: "off",
      placeholder: "Skriv t.ex. “kan inte spara”"
    });
    var qBtn = el("button", { id: IDS.qBtn, type: "button", className: "askBtn" });
    qBtn.textContent = "Svara";
    qaRow.appendChild(qInput);
    qaRow.appendChild(qBtn);
    secAsk.appendChild(qaRow);

    var answerBox = el("div", { id: IDS.answer, className: "answer" });
    // default answer text (fail-closed)
    var fallbackNote = el("div", { id: IDS.fallbackNote, className: "muted" });
    fallbackNote.textContent = "Jag kan bara hjälpa med denna sida. Välj ett vanligt problem eller följ checklistan.";
    answerBox.appendChild(fallbackNote);
    secAsk.appendChild(answerBox);

    var secTrouble = el("div", { className: "sec" });
    secTrouble.appendChild(el("h3", { text: "Felsökning (checklista)" }));
    var troubleList = el("ul", { id: IDS.troubleList });
    secTrouble.appendChild(troubleList);

    // Optional tools
    var toolsRow = el("div", { className: "tools" });
    var anonBtn = el("button", { id: IDS.anonBtn, type: "button", className: "toolBtn" });
    anonBtn.textContent = "Kopiera status (anonym)";
    anonBtn.style.display = "none"; // default hidden
    toolsRow.appendChild(anonBtn);

    bodyWrap.appendChild(secQuick);
    bodyWrap.appendChild(secFaq);
    bodyWrap.appendChild(secAsk);
    bodyWrap.appendChild(secTrouble);
    bodyWrap.appendChild(toolsRow);

    panel.appendChild(hdr);
    panel.appendChild(bodyWrap);

    // Attach to DOM
    // - Button in mount (MUST)
    // - Panel at end of body (neutral global overlay)
    try {
      mount.appendChild(btn);
    } catch (_) {
      // fallback: body
      try {
        (document.body || document.documentElement).appendChild(btn);
      } catch (_) {}
    }
    try {
      (document.body || document.documentElement).appendChild(panel);
    } catch (_) {
      // If we can't append, fail-closed quietly
    }

    // ---------------------------
    // Rendering: pack → UI
    // ---------------------------
    function clearNode(node) {
      try {
        while (node && node.firstChild) node.removeChild(node.firstChild);
      } catch (_) {}
    }

    function renderLines(container, lines) {
      // lines: string | array
      try {
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

    function buildFaqButtons(pack) {
      try {
        clearNode(faqWrap);

        if (!pack || !Array.isArray(pack.faqs) || pack.faqs.length === 0) {
          var none = el("div", { className: "muted" });
          none.textContent = "Inga vanliga problem är definierade för denna sida ännu.";
          faqWrap.appendChild(none);
          return;
        }

        pack.faqs.forEach(function (faq) {
          var q = safeStr(faq && faq.q);
          var id = safeStr(faq && faq.id);
          if (!q || !id) return;

          var b = el("button", { type: "button", className: "faqBtn" });
          b.textContent = q;
          b.addEventListener("click", function () {
            try {
              var a = faq && faq.a;
              if (a === undefined || a === null || a === "") {
                setAnswer("Svar saknas för detta problem.", true);
              } else {
                setAnswer(a, false);
              }
            } catch (_) {
              setAnswer("Jag kan bara hjälpa med denna sida. Välj ett vanligt problem eller följ checklistan.", true);
            }
          });

          faqWrap.appendChild(b);
        });
      } catch (_) {}
    }

    function renderQuick(pack) {
      try {
        clearNode(quickList);
        if (!pack || !Array.isArray(pack.quickGuide) || pack.quickGuide.length === 0) {
          var li = el("li");
          li.textContent = "Hjälp är inte tillgänglig för denna sida ännu. Följ checklistan.";
          quickList.appendChild(li);
          return;
        }
        pack.quickGuide.forEach(function (step) {
          var li2 = el("li");
          li2.textContent = safeStr(step);
          quickList.appendChild(li2);
        });
      } catch (_) {}
    }

    function renderTrouble(pack) {
      try {
        clearNode(troubleList);
        if (!pack || !Array.isArray(pack.troubleshoot) || pack.troubleshoot.length === 0) {
          var li = el("li");
          li.textContent = "Kontrollera att sidan laddat klart och prova igen.";
          troubleList.appendChild(li);
          return;
        }
        pack.troubleshoot.forEach(function (t) {
          var li2 = el("li");
          li2.textContent = safeStr(t);
          troubleList.appendChild(li2);
        });
      } catch (_) {}
    }

    function updateTitle(pack) {
      try {
        var title = (pack && safeStr(pack.title)) ? safeStr(pack.title) : pageId;
        h2.textContent = "Support för: " + title;
      } catch (_) {
        h2.textContent = "Support för: " + pageId;
      }
    }

    function shouldShowAnon(pack) {
      try {
        if (!pack || pack.enableAnonStatus !== true) return false;
        if (!window.SystemSupportSignals) return false;
        var sig = window.SystemSupportSignals;
        // core läser endast explicit safe flags (inga DOM reads)
        var hasAny =
          typeof sig.orgOk === "boolean" ||
          typeof sig.invalidCount === "number" ||
          typeof sig.missingCount === "number";
        return !!hasAny;
      } catch (_) {
        return false;
      }
    }

    function buildAnonPayload(pid) {
      try {
        var sig = window.SystemSupportSignals || null;
        if (!sig) return null;

        var lines = [];
        lines.push("pageId: " + safeStr(pid));

        if (typeof sig.orgOk === "boolean") {
          lines.push("Org: " + (sig.orgOk ? "OK" : "SAKNAS"));
        }
        if (typeof sig.invalidCount === "number") {
          lines.push("invalidCount: " + String(sig.invalidCount));
        }
        if (typeof sig.missingCount === "number") {
          lines.push("missingCount: " + String(sig.missingCount));
        }
        return lines.join("\n");
      } catch (_) {
        return null;
      }
    }

    function refreshFromPack() {
      var pack = getPack(pageId);

      // pack saknas → fail-closed standardpanel (MUST)
      updateTitle(pack);

      renderQuick(pack);
      buildFaqButtons(pack);
      renderTrouble(pack);

      // fallback message in answer area
      if (!pack) {
        setAnswer("Hjälp är inte tillgänglig för denna sida ännu. Följ checklistan.", true);
      } else {
        setAnswer("Jag kan bara hjälpa med denna sida. Välj ett vanligt problem eller följ checklistan.", true);
      }

      // Optional anon status button
      try {
        if (shouldShowAnon(pack)) {
          anonBtn.style.display = "";
        } else {
          anonBtn.style.display = "none";
        }
      } catch (_) {}
    }

    refreshFromPack();

    // ---------------------------
    // Matchning (MUST)
    // ---------------------------
    function findFaqById(pack, faqId) {
      try {
        if (!pack || !Array.isArray(pack.faqs)) return null;
        for (var i = 0; i < pack.faqs.length; i++) {
          if (safeStr(pack.faqs[i].id) === safeStr(faqId)) return pack.faqs[i];
        }
        return null;
      } catch (_) {
        return null;
      }
    }

    function matchQuestion(pack, qText) {
      try {
        if (!pack || !Array.isArray(pack.match) || pack.match.length === 0) return null;
        var qn = normStr(qText);
        if (!qn) return null;

        for (var i = 0; i < pack.match.length; i++) {
          var m = pack.match[i];
          if (!m || !Array.isArray(m.keywords) || !safeStr(m.faqId)) continue;

          // Om någon keyword ingår → välj första match (MUST)
          for (var k = 0; k < m.keywords.length; k++) {
            var kw = normStr(m.keywords[k]);
            if (!kw) continue;
            if (qn.indexOf(kw) !== -1) {
              return safeStr(m.faqId);
            }
          }
        }
        return null;
      } catch (_) {
        return null;
      }
    }

    function handleAsk() {
      try {
        var pack = getPack(pageId);
        var text = safeStr(qInput.value);

        // Normalisering (MUST)
        var qn = normStr(text);
        if (!qn) {
          setAnswer("Skriv en kort fråga (t.ex. “kan inte spara”).", true);
          return;
        }

        // Core får inte logga eller spara frågor (MUST)
        var faqId = matchQuestion(pack, qn);

        if (!pack) {
          setAnswer("Hjälp är inte tillgänglig för denna sida ännu. Följ checklistan.", true);
          return;
        }

        if (!faqId) {
          setAnswer("Jag kan bara hjälpa med denna sida. Välj ett vanligt problem eller följ checklistan.", true);
          return;
        }

        var faq = findFaqById(pack, faqId);
        if (!faq) {
          setAnswer("Jag kan bara hjälpa med denna sida. Välj ett vanligt problem eller följ checklistan.", true);
          return;
        }

        var a = faq.a;
        if (a === undefined || a === null || a === "") {
          setAnswer("Svar saknas för detta problem.", true);
        } else {
          setAnswer(a, false);
        }
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

    // ---------------------------
    // Open/close behavior (MUST)
    // ---------------------------
    var isOpen = false;

    function openPanel() {
      try {
        if (!panel) return;
        panel.classList.add("open");
        isOpen = true;
        setAriaExpanded(btn, true);

        // Refresh pack each open (pack scripts might load after core)
        refreshFromPack();

        // Focus inside panel (MUST)
        // Prefer question input; else title.
        setTimeout(function () {
          try {
            if (qInput) qInput.focus();
            else panel.focus();
          } catch (_) {
            try { panel.focus(); } catch (_) {}
          }
        }, 0);
      } catch (_) {}
    }

    function closePanel() {
      try {
        if (!panel) return;
        panel.classList.remove("open");
        isOpen = false;
        setAriaExpanded(btn, false);

        // Return focus to button (nice)
        try { btn.focus(); } catch (_) {}
      } catch (_) {}
    }

    function togglePanel() {
      try {
        if (isOpen) closePanel();
        else openPanel();
      } catch (_) {}
    }

    btn.addEventListener("click", function (e) {
      stop(e);
      togglePanel();
    });

    closeBtn.addEventListener("click", function (e) {
      stop(e);
      closePanel();
    });

    // Esc closes (MUST)
    document.addEventListener("keydown", function (e) {
      try {
        if (!isOpen) return;
        if (e.key === "Escape") {
          stop(e);
          closePanel();
        }
      } catch (_) {}
    });

    // Click outside closes (OPTIONAL) — implement, but fail-closed and minimal
    document.addEventListener("mousedown", function (e) {
      try {
        if (!isOpen) return;
        var t = e.target;
        if (!t) return;
        if (panel.contains(t) || btn.contains(t)) return;
        closePanel();
      } catch (_) {}
    });

    // ---------------------------
    // Optional: Copy anonymous status
    // ---------------------------
    anonBtn.addEventListener("click", function (e) {
      stop(e);
      try {
        var pack = getPack(pageId);
        if (!shouldShowAnon(pack)) return;

        var payload = buildAnonPayload(pageId);
        if (!payload) return;

        // Clipboard write (best effort), fail-closed.
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
          // No clipboard API: show payload
          setAnswer(["Status (anonym):", payload], false);
        }
      } catch (_) {
        // do nothing
      }
    });

    // ---------------------------
    // Public tiny hook (safe)
    // ---------------------------
    // Allow page to trigger a refresh after loading its pack:
    // window.SystemSupportCoreRefresh && window.SystemSupportCoreRefresh();
    try {
      window.SystemSupportCoreRefresh = function () {
        try { refreshFromPack(); } catch (_) {}
      };
    } catch (_) {}
  } catch (_) {
    // Fail-closed: do nothing (never throw)
  }
})();

