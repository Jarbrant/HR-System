/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 02/06 | FIL-ID: UI/pages/packages-block/02-core.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Core helpers + auth/role adapter (tolerant)
Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell
- SYSTEM_ADMIN = read-only steward

PATCH v1.0.1 (P0 – ADMIN feltolkas som SYSTEM_ADMIN):
- Förbättrar role/empNo-extraktion (stöd för fler fältnamn + nested objekt)
- Läser auth-state via HRApp getters + fallback scan i sessionStorage/localStorage (read-only)
- Validerar roll strikt (allowlist) och trimmar strängar (fail-closed)
============================================================ */
(function () {
  "use strict";

  const NS = (window.PackagesBlock = window.PackagesBlock || {});
  if (NS.core) return; // idempotent

  function nowTs() { return Date.now(); }

  function normStatus(v) {
    const s = String(v || "").toLowerCase();
    if (s === "published") return "published";
    return "draft";
  }

  // Fail-closed redirect (håll dig inom /HR-System/)
  function hardFail(reason) {
    try { console.error("[packages-block] hardFail:", reason); } catch (_) {}
    try {
      // Relativt från /admin/ → /HR-System/index.html
      location.href = "../index.html?err=config";
    } catch (_) {}
  }

  function assertDeps() {
    const miss = [];
    if (!window.HRApp) miss.push("HRApp");
    return { ok: miss.length === 0, miss };
  }

  // -----------------------------
  // Auth helpers (fail-closed)
  // -----------------------------
  const ROLE_ALLOW = new Set(["SYSTEM_ADMIN", "ADMIN", "MANAGER", "EMPLOYEE", "READER", "EDITOR"]);

  function normRole(v) {
    const s = String(v ?? "").trim().toUpperCase();
    return s;
  }
  function normEmp(v) {
    return String(v ?? "").trim();
  }
  function isValidRole(v) {
    const r = normRole(v);
    return ROLE_ALLOW.has(r);
  }

  function safeParseJson(s, maxLen) {
    try {
      const str = String(s ?? "");
      const lim = Math.max(0, Number(maxLen || 0)) || 0;
      if (lim && str.length > lim) return null;
      return JSON.parse(str);
    } catch (_) {
      return null;
    }
  }

  function extractRoleEmp(obj) {
    // GUARD: only objects
    if (!obj || typeof obj !== "object") return { role: "", empNo: "" };

    // SCOPE: support common shapes without guessing too hard
    // Direct
    let role =
      obj.role || obj.userRole || obj.roleName || obj.user_role || obj.userrole || "";
    let empNo =
      obj.empNo || obj.employeeNo || obj.employee_no || obj.userId || obj.user_id || obj.emp || "";

    // Nested common containers
    const nested = [
      obj.user, obj.session, obj.auth, obj.account, obj.profile, obj.data, obj.me, obj.currentUser
    ].filter(Boolean);

    for (const n of nested) {
      if ((!role || !empNo) && n && typeof n === "object") {
        role = role || n.role || n.userRole || n.roleName || n.user_role || n.userrole || "";
        empNo = empNo || n.empNo || n.employeeNo || n.employee_no || n.userId || n.user_id || n.emp || "";
      }
      if (role && empNo) break;
    }

    role = normRole(role);
    empNo = normEmp(empNo);

    // Fail-closed: reject unknown roles
    if (!isValidRole(role)) role = "";

    // Fail-closed: keep empNo reasonably bounded (avoid garbage)
    if (empNo && empNo.length > 64) empNo = "";

    return { role, empNo };
  }

  function tryGetFromHRApp(HRApp) {
    // Try multiple getters/props in a safe order
    const sources = [];

    try {
      if (typeof HRApp.requireAuth === "function") {
        // NOTE: some versions redirect only; some return session object
        const maybe = HRApp.requireAuth();
        if (maybe && typeof maybe === "object") sources.push(maybe);
      }
    } catch (_) {
      // ignore (may redirect/throw); continue to other reads
    }

    try {
      if (typeof HRApp.getSession === "function") {
        const s = HRApp.getSession();
        if (s && typeof s === "object") sources.push(s);
      }
    } catch (_) {}

    try {
      if (typeof HRApp.getAuth === "function") {
        const a = HRApp.getAuth();
        if (a && typeof a === "object") sources.push(a);
      }
    } catch (_) {}

    try {
      if (typeof HRApp.getUser === "function") {
        const u = HRApp.getUser();
        if (u && typeof u === "object") sources.push(u);
      }
    } catch (_) {}

    try {
      if (HRApp.session && typeof HRApp.session === "object") sources.push(HRApp.session);
    } catch (_) {}

    // First valid hit wins
    for (const s of sources) {
      const ex = extractRoleEmp(s);
      if (ex.role && ex.empNo) return ex;
      if (ex.role && !ex.empNo) {
        // keep role candidate, maybe empNo comes later
        return ex;
      }
    }
    return { role: "", empNo: "" };
  }

  function scanStorageForAuth() {
    // GUARD: read-only scan; no new keys; fail-closed by allowlist
    const keyLooksAuth = (k) => /auth|session|login|user|hr/i.test(String(k || ""));
    const scanOne = (storage) => {
      try {
        if (!storage) return { role: "", empNo: "" };
        const n = Math.min(storage.length || 0, 200);
        for (let i = 0; i < n; i++) {
          const k = storage.key(i);
          if (!k || !keyLooksAuth(k)) continue;

          const raw = storage.getItem(k);
          if (!raw) continue;

          // Keep it small/safe (8KB) so we don't parse big banks by accident
          const obj = safeParseJson(raw, 8192);
          if (!obj || typeof obj !== "object") continue;

          const ex = extractRoleEmp(obj);
          if (ex.role && ex.empNo) return ex;
        }
      } catch (_) {}
      return { role: "", empNo: "" };
    };

    // Prefer sessionStorage (policy: session first), then localStorage
    const a = scanOne(window.sessionStorage);
    if (a.role) return a;
    const b = scanOne(window.localStorage);
    return b;
  }

  // Tolerant adapter: försök få roll/empNo från HRApp utan att gissa för hårt
  function getRole() {
    const HRApp = window.HRApp || null;

    // default (fail-closed): SYSTEM_ADMIN read-only
    let role = "SYSTEM_ADMIN";
    let empNo = "";
    let canWrite = false;

    if (!HRApp) return { role, empNo, canWrite };

    // 1) Prefer HRApp (explicit)
    const fromApp = tryGetFromHRApp(HRApp);
    if (fromApp.role) role = fromApp.role;
    if (fromApp.empNo) empNo = fromApp.empNo;

    // 2) Fallback scan of storage (read-only) if still unclear
    // NOTE: Only used if HRApp didn't give a usable ADMIN/MANAGER + empNo.
    if ((!empNo || !isValidRole(role) || role === "SYSTEM_ADMIN") ) {
      const fromStore = scanStorageForAuth();
      if (fromStore.role) role = fromStore.role;
      if (fromStore.empNo) empNo = fromStore.empNo;
    }

    role = isValidRole(role) ? normRole(role) : "SYSTEM_ADMIN";
    empNo = normEmp(empNo);

    // LÅST: SYSTEM_ADMIN är steward/read-only
    canWrite = (role === "ADMIN" || role === "MANAGER");

    return { role, empNo, canWrite };
  }

  NS.core = {
    HRApp: window.HRApp || null,
    nowTs,
    normStatus,
    hardFail,
    assertDeps,
    getRole
  };
})();
