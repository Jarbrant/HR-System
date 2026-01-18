/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 02/06 | FIL-ID: UI/pages/packages-block/02-core.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Core helpers + auth/role adapter (tolerant)

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell
- SYSTEM_ADMIN = read-only steward

PATCH v1.0.2 (P0 – ADMIN-only sida, stoppar roll-mix):
- ADMIN är ENDA rollen som får öppna packages-block (allow-list).
- Allt annat (SYSTEM_ADMIN/MANAGER/EMPLOYEE/okänd/ingen session) => hardFail/redirect direkt.
- canWrite = true endast när role === "ADMIN" OCH empNo finns.
- Behåller tolerant extraction, men "tolerans" får aldrig ge åtkomst.
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
      location.href = "../index.html?err=auth";
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
  const REQUIRED_ROLE = "ADMIN"; // LÅST FÖR DENNA SIDA

  function normRole(v) { return String(v ?? "").trim().toUpperCase(); }
  function normEmp(v) { return String(v ?? "").trim(); }
  function isValidRole(v) { return ROLE_ALLOW.has(normRole(v)); }

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
    if (!obj || typeof obj !== "object") return { role: "", empNo: "" };

    let role =
      obj.role || obj.userRole || obj.roleName || obj.user_role || obj.userrole || "";
    let empNo =
      obj.empNo || obj.employeeNo || obj.employee_no || obj.userId || obj.user_id || obj.emp || "";

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

    // Fail-closed: bound empNo
    if (empNo && empNo.length > 64) empNo = "";

    return { role, empNo };
  }

  function tryGetFromHRApp(HRApp) {
    const sources = [];

    try {
      if (typeof HRApp.requireAuth === "function") {
        const maybe = HRApp.requireAuth();
        if (maybe && typeof maybe === "object") sources.push(maybe);
      }
    } catch (_) {
      // requireAuth kan redirecta/throwa — fortsätt läsa på andra sätt
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

    for (const s of sources) {
      const ex = extractRoleEmp(s);
      if (ex.role || ex.empNo) return ex;
    }
    return { role: "", empNo: "" };
  }

  function scanStorageForAuth() {
    // GUARD: read-only scan; no new keys
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

          const obj = safeParseJson(raw, 8192);
          if (!obj || typeof obj !== "object") continue;

          const ex = extractRoleEmp(obj);
          if (ex.role || ex.empNo) return ex;
        }
      } catch (_) {}
      return { role: "", empNo: "" };
    };

    const a = scanOne(window.sessionStorage);
    if (a.role || a.empNo) return a;
    return scanOne(window.localStorage);
  }

  function enforceAdminOnly(role, empNo) {
    const r = normRole(role);
    const e = normEmp(empNo);

    // Fail-closed: måste ha exakt ADMIN + empNo
    if (r !== REQUIRED_ROLE) {
      hardFail(`role_denied:${r || "missing"}`);
      return false;
    }
    if (!e) {
      hardFail("emp_missing");
      return false;
    }
    return true;
  }

  // Tolerant adapter: försök få roll/empNo, men åtkomst är strict allow-list (ADMIN-only)
  function getRole() {
    const HRApp = window.HRApp || null;

    // Default (fail-closed): ingen write och kommer stoppas av enforceAdminOnly om ej ADMIN
    let role = "";
    let empNo = "";
    let canWrite = false;

    if (HRApp) {
      const fromApp = tryGetFromHRApp(HRApp);
      if (fromApp.role) role = fromApp.role;
      if (fromApp.empNo) empNo = fromApp.empNo;
    }

    // Fallback storage-scan (read-only) om vi saknar tydlig session
    if (!role || !empNo) {
      const fromStore = scanStorageForAuth();
      if (!role && fromStore.role) role = fromStore.role;
      if (!empNo && fromStore.empNo) empNo = fromStore.empNo;
    }

    role = isValidRole(role) ? normRole(role) : "";
    empNo = normEmp(empNo);

    // ADMIN-only gate (stoppar allt roll-mix på den här sidan)
    const accessOk = enforceAdminOnly(role, empNo);

    // Om accessOk är true är vi ADMIN med empNo
    canWrite = !!accessOk;

    return { role: REQUIRED_ROLE, empNo, canWrite };
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
