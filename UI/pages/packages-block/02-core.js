/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 02/06 | FIL-ID: UI/pages/packages-block/02-core.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Core-helpers för packages-block (auth, msg, safe utils)
Policy (LÅST):
- UI-only • Fail-closed
- sessionStorage först (auth) • fallback localStorage
- XSS-safe rendering (textContent, inga osäkra innerHTML)
- SYSTEM_ADMIN = steward-läge (read-only)
Innehåller INTE:
- blockbank/read-write
- trainings-export
- render av blocklista
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.core) return; // idempotent

  const dom = NS.dom;

  // ---------- Fail-closed logger (minimal) ----------
  function safeLog() {
    // UI-only demo: logga inte payload. Endast små felmeddelanden.
    try {
      // eslint-disable-next-line no-console
      console.log.apply(console, arguments);
    } catch (_) {}
  }

  function safeWarn() {
    try {
      // eslint-disable-next-line no-console
      console.warn.apply(console, arguments);
    } catch (_) {}
  }

  function safeErr() {
    try {
      // eslint-disable-next-line no-console
      console.error.apply(console, arguments);
    } catch (_) {}
  }

  // ---------- Text helpers ----------
  function normText(v, maxLen) {
    const s = String(v ?? "").trim();
    const n = Math.max(0, Number(maxLen || 0));
    if (!n) return s;
    return s.slice(0, n);
  }

  function nowTs() {
    return Date.now();
  }

  function genId(prefix) {
    const p = String(prefix || "id");
    return (
      p +
      "_" +
      Math.random().toString(16).slice(2) +
      "_" +
      Date.now().toString(16)
    );
  }

  function normStatus(s) {
    const v = String(s || "draft").toLowerCase();
    return v === "published" ? "published" : "draft";
  }

  function isPlainObject(x) {
    return !!x && typeof x === "object" && !Array.isArray(x);
  }

  // ---------- UI: message box ----------
  function setMsg(kind, text) {
    const elMsg = dom && dom.byId ? dom.byId("msgBox") : null;
    if (!elMsg) return;

    const k = String(kind || "").trim();
    const t = String(text || "");

    elMsg.className = "msg" + (k ? " " + k : "");
    elMsg.textContent = t;
    elMsg.style.display = t ? "block" : "none";
  }

  // ---------- HRApp fallback (fail-closed) ----------
  // Viktigt: vi försöker använda window.HRApp om den finns,
  // annars minimal fallback så sidan inte kraschar.
  const HRApp =
    window.HRApp ||
    {
      getAuth: function () {
        try {
          const s =
            sessionStorage.getItem("AO-001_LOGIN_V1") ||
            localStorage.getItem("AO-001_LOGIN_V1");
          const o = s ? JSON.parse(s) : null;
          const role = String(o && o.role ? o.role : "SYSTEM_ADMIN");
          const empNo = String(o && o.empNo ? o.empNo : "");
          return { ok: true, role: role, empNo: empNo };
        } catch (_) {
          return { ok: false, role: "SYSTEM_ADMIN", empNo: "" };
        }
      },
      requireAuth: function () {
        const a = this.getAuth();
        if (!a || a.ok === false) return { ok: false, role: "SYSTEM_ADMIN", empNo: "" };
        return a;
      },
      logout: function () {
        try {
          sessionStorage.removeItem("AO-001_LOGIN_V1");
        } catch (_) {}
        try {
          localStorage.removeItem("AO-001_LOGIN_V1");
        } catch (_) {}
        location.href = "../index.html";
      },
    };

  function getAuth() {
    return HRApp.requireAuth();
  }

  function getRole() {
    const a = getAuth();
    const role = String(a && a.role ? a.role : "SYSTEM_ADMIN");
    const empNo = String(a && a.empNo ? a.empNo : "");
    const isSystemAdmin = role === "SYSTEM_ADMIN";
    const canWrite = !isSystemAdmin; // ADMIN/MANAGER kan skriva, SYSTEM_ADMIN kan inte
    return { role, empNo, isSystemAdmin, canWrite, authOk: !!(a && a.ok !== false) };
  }

  // ---------- LockBox helper ----------
  function showLockBox(lines) {
    const box = dom && dom.byId ? dom.byId("lockBox") : null;
    if (!box) return;

    const arr = Array.isArray(lines) ? lines.filter(Boolean) : [];
    if (!arr.length) {
      box.style.display = "none";
      dom.clear(box);
      return;
    }

    box.style.display = "block";
    dom.clear(box);

    const strong = dom.el("strong", { text: "Åtgärd krävs" });
    box.appendChild(strong);

    const ul = dom.el("ul");
    arr.forEach((s) => {
      ul.appendChild(dom.el("li", { text: String(s) }));
    });
    box.appendChild(ul);
  }

  // ---------- Boot sanity ----------
  function assertDeps() {
    const miss = [];
    if (!NS.dom) miss.push("01-dom.js (PackagesBlock.dom)");
    // Vi accepterar att HRApp kan saknas (fallback finns)
    if (miss.length) return { ok: false, miss };
    return { ok: true, miss: [] };
  }

  function hardFail(reason) {
    // fail-closed: visa tydligt att JS inte laddat/beroende saknas
    setMsg("err", reason || "JS laddades inte korrekt.");
    safeErr(reason);
  }

  NS.core = {
    // deps
    HRApp,

    // util
    safeLog,
    safeWarn,
    safeErr,
    normText,
    nowTs,
    genId,
    normStatus,
    isPlainObject,

    // ui
    setMsg,
    showLockBox,

    // auth/role
    getAuth,
    getRole,

    // boot
    assertDeps,
    hardFail,
  };
})();

