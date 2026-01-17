/* ============================================================
AO-PACKAGES-BLOCK-MODULAR-01 | FILE 02/06 | FIL-ID: UI/pages/packages-block/02-core.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Core helpers + auth/role adapter (tolerant)
Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys/datamodell
- SYSTEM_ADMIN = read-only steward
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

  // Tolerant adapter: försök få roll/empNo från HRApp utan att gissa för hårt
  function getRole() {
    const HRApp = window.HRApp || null;

    // default (fail-closed): SYSTEM_ADMIN read-only
    let role = "SYSTEM_ADMIN";
    let empNo = "";
    let canWrite = false;

    if (!HRApp) return { role, empNo, canWrite };

    // 1) Require auth if available (många av dina sidor använder detta)
    try {
      if (typeof HRApp.requireAuth === "function") {
        // vissa implementationer returnerar session, andra redirectar bara
        const maybe = HRApp.requireAuth();
        if (maybe && typeof maybe === "object") {
          role = String(maybe.role || maybe.userRole || role);
          empNo = String(maybe.empNo || maybe.employeeNo || maybe.userId || empNo);
        }
      }
    } catch (_) {
      // Om requireAuth redirectar/throwar → stoppa inte här, vi försöker läsa session på andra sätt
    }

    // 2) Try common getters/props
    try {
      if ((!empNo || !role) && typeof HRApp.getSession === "function") {
        const s = HRApp.getSession();
        if (s && typeof s === "object") {
          role = String(s.role || s.userRole || role);
          empNo = String(s.empNo || s.employeeNo || s.userId || empNo);
        }
      }
    } catch (_) {}

    try {
      if ((!empNo || !role) && HRApp.session && typeof HRApp.session === "object") {
        const s = HRApp.session;
        role = String(s.role || s.userRole || role);
        empNo = String(s.empNo || s.employeeNo || s.userId || empNo);
      }
    } catch (_) {}

    role = String(role || "SYSTEM_ADMIN").toUpperCase();

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
