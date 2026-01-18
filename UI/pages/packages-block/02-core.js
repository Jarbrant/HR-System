/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 02/06 | FIL-ID: UI/pages/packages-block/02-core.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Core helpers + auth/role adapter (STRICT)
Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell
- SYSTEM_ADMIN = read-only steward

PATCH v1.0.2 (P0 – STRICT ROLE LOCK: endast ADMIN får använda sidan):
- Gör rolltolkning strikt: "canWrite" endast för ADMIN (MANAGER får aldrig write här)
- Förbättrar extraktion: stöd för roleId/role_code/rbacRole + nested containers
- Normaliserar rollvärden (t.ex. "admin" -> "ADMIN")
- Lägger till requireAdminOrRedirect() för att stoppa fel-roll tidigt (fail-closed)
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

  function hardDeny(reason) {
    // Fail-closed: skicka tillbaka till admin-home (om den finns), annars index
    try { console.warn("[packages-block] access denied:", reason); } catch (_) {}
    try { location.href = "./home.html?err=auth"; }
    catch (_) { hardFail("auth"); }
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
    let s = String(v ?? "").trim();
    if (!s) return "";
    s = s.toUpperCase();

    // Map common variants -> canonical
    if (s === "ADMINISTRATOR" || s === "ADMINISTRATÖR") return "ADMIN";
    if (s === "SYSADMIN" || s === "SYSTEMADMIN") return "SYSTEM_ADMIN";
    if (s === "MGR") return "MANAGER";
    if (s === "USER") return "EMPLOYEE";

    // Some systems use lowercase role ids
    if (s === "ADMIN") return "ADMIN";
    if (s === "MANAGER") return "MANAGER";
    if (s === "EMPLOYEE") return "EMPLOYEE";
    if (s === "READER") return "READER";
    if (s === "EDITOR") return "EDITOR";
    if (s === "SYSTEM_ADMIN") return "SYSTEM_ADMIN";

    return s;
  }

  function normEmp(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    // bounds (avoid garbage)
    if (s.length > 64) return "";
    return s;
  }

  function isValidRole(v) {
    const r = normRole(v);
    return ROLE_ALLOW.has(r);
  }

  function extractRoleEmp(obj) {
    // GUARD: only objects
    if (!obj || typeof obj !== "object") return { role: "", empNo: "" };

    // SCOPE: support common shapes without guessing too hard
    // Direct role candidates (include roleId etc)
    let role =
      obj.role ||
      obj.userRole ||
      obj.roleName ||
      obj.roleId ||
      obj.role_code ||
      obj.roleCode ||
      obj.rbacRole ||
      obj.user_role ||
      obj.userrole ||
      "";

    // Direct emp candidates
    let empNo =
      obj.empNo ||
      obj.employeeNo ||
      obj.employee_no ||
      obj.emp ||
      obj.userId ||
      obj.user_id ||
      obj.uid ||
      obj.id ||
      "";

    // Nested containers
    const nested = [
      obj.user, obj.session, obj.auth, obj.account, obj.profile, obj.data, obj.me, obj.currentUser, obj.current_user
    ].filter(Boolean);

    for (const n of nested) {
      if ((!role || !empNo) && n && typeof n === "object") {
        role = role ||
          n.role || n.userRole || n.roleName || n.roleId || n.role_code || n.roleCode || n.rbacRole ||
          n.user_role || n.userrole || "";
        empNo = empNo ||
          n.empNo || n.employeeNo || n.employee_no || n.emp || n.userId || n.user_id || n.uid || n.id || "";
      }
      if (role && empNo) break;
    }

    role = normRole(role);
    empNo = normEmp(empNo);

    // Fail-closed: reject unknown roles
    if (!isValidRole(role)) role = "";

    return { role, empNo };
  }

  function tryGetFromHRApp(HRApp) {
    // Try multiple getters/props in a safe order
    const sources = [];

    // 1) Require auth if available (may redirect). If it returns session, capture it.
    try {
      if (typeof HRApp.requireAuth === "function") {
        const maybe = HRApp.requireAuth();
        if (maybe && typeof maybe === "object") sources.push(maybe);
      }
    } catch (_) {
      // ignore (may redirect/throw); continue to other reads
    }

    // 2) Common getters
    try { if (typeof HRApp.getSession === "function") { const s = HRApp.getSession(); if (s && typeof s === "object") sources.push(s); } } catch (_) {}
    try { if (typeof HRApp.getAuth === "function") { const a = HRApp.getAuth(); if (a && typeof a === "object") sources.push(a); } } catch (_) {}
    try { if (typeof HRApp.getUser === "function") { const u = HRApp.getUser(); if (u && typeof u === "object") sources.push(u); } } catch (_) {}

    // 3) Common properties
    try { if (HRApp.session && typeof HRApp.session === "object") sources.push(HRApp.session); } catch (_) {}
    try { if (HRApp.auth && typeof HRApp.auth === "object") sources.push(HRApp.auth); } catch (_) {}
    try { if (HRApp.user && typeof HRApp.user === "object") sources.push(HRApp.user); } catch (_) {}

    // First valid hit wins (role must be valid; empNo optional but preferred)
    let best = { role: "", empNo: "" };
    for (const s of sources) {
      const ex = extractRoleEmp(s);
      if (ex.role && ex.empNo) return ex;
      if (ex.role && !best.role) best = ex;
    }
    return best;
  }

  // STRICT adapter: role/empNo via HRApp only. Fail-closed if unclear.
  function getRole() {
    const HRApp = window.HRApp || null;

    // default (fail-closed): SYSTEM_ADMIN read-only
    let role = "SYSTEM_ADMIN";
    let empNo = "";
    let canWrite = false;
    let authOk = false;

    if (!HRApp) return { role, empNo, canWrite, authOk };

    const fromApp = tryGetFromHRApp(HRApp);
    if (fromApp.role) role = fromApp.role;
    if (fromApp.empNo) empNo = fromApp.empNo;

    role = isValidRole(role) ? normRole(role) : "SYSTEM_ADMIN";
    empNo = normEmp(empNo);

    // authOk means: we got a recognized role AND an empNo (tighten as needed)
    authOk = !!(role && empNo);

    // LÅST (NY): Endast ADMIN får write på packages-block
    canWrite = (role === "ADMIN");

    return { role, empNo, canWrite, authOk };
  }

  // Page gate: deny unless ADMIN (used by 06-page.js)
  function requireAdminOrRedirect() {
    const who = getRole();
    // Fail-closed: if auth unclear OR role not ADMIN -> deny
    if (!who.authOk) { hardDeny("auth_missing"); return { ok: false, who }; }
    if (String(who.role || "").toUpperCase() !== "ADMIN") { hardDeny("role_not_admin"); return { ok: false, who }; }
    return { ok: true, who };
  }

  NS.core = {
    HRApp: window.HRApp || null,
    nowTs,
    normStatus,
    hardFail,
    hardDeny,
    assertDeps,
    getRole,
    requireAdminOrRedirect
  };
})();
