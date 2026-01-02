/* ============================================================
AO-002 v1.5 (PATCH) | FILE: UI/UI-04-CONFIG.js
Projekt: HR-System
Syfte: Central config för RBAC + route-tillgång + default routing (config-driven)
Nivå: UI-only (GitHub Pages) | localStorage-first

Policy (LÅST):
- Ingen backend
- Inga storage-keys/datamodell utan AO (AO-002: skriver inget)
- Fail-closed (okänd roll = nekad)
- Public route ska vara explicit (endast allowlist)
- Authed roller får inte ha /UI/ som route-prefix

PATCH v1.5 (STABILITET):
- MANAGER är isolerad till /manager/ (tar bort /admin/ för att undvika rollblandning)
- DEFAULT_ROUTE_BY_ROLE[MANAGER] = /manager/overview.html (standard .html)
============================================================ */

(function () {
  "use strict";

  // -------------------------
  // Base-path (GitHub Pages)
  // -------------------------
  // Repo: Jarbrant/HR-System => public path: /HR-System
  const BASE_PATH = "/HR-System";

  // -------------------------
  // Roles (LÅST)
  // -------------------------
  const ROLES = Object.freeze({
    SYSTEM_ADMIN: "SYSTEM_ADMIN",
    ADMIN: "ADMIN",
    MANAGER: "MANAGER",
    EMPLOYEE: "EMPLOYEE",
  });

  // -------------------------
  // Public routes (explicit allowlist)
  // -------------------------
  // Endast dessa får nås utan session.
  const PUBLIC_ROUTES = Object.freeze([
    "/UI/UI-01-SKELETON.html",
    "/index.html",
  ]);

  // -------------------------
  // Default route per role (MÅSTE finnas i repo)
  // -------------------------
  const DEFAULT_ROUTE_BY_ROLE = Object.freeze({
    [ROLES.SYSTEM_ADMIN]: "/system/dashboard.html",
    [ROLES.ADMIN]: "/admin/home.html",

    // Manager landar i egen vy
    [ROLES.MANAGER]: "/manager/overview.html",

    [ROLES.EMPLOYEE]: "/employee/home.html",
  });

  // -------------------------
  // Allowed routes per role (PREFIXES)
  // -------------------------
  // Fail-closed: roll får bara röra sig i sin egen zon.
  const ROUTES_BY_ROLE = Object.freeze({
    [ROLES.SYSTEM_ADMIN]: Object.freeze([
      "/system/",
    ]),
    [ROLES.ADMIN]: Object.freeze([
      "/admin/",
    ]),
    [ROLES.MANAGER]: Object.freeze([
      // PATCH v1.5: isolera Manager till manager-ytan (ingen /admin/ här)
      "/manager/",
    ]),
    [ROLES.EMPLOYEE]: Object.freeze([
      "/employee/",
    ]),
  });

  // -------------------------
  // Permissions (minimal nivå 1)
  // -------------------------
  // Obs: permissions används av UI-sidorna via HRApp.hasPermission().
  // Configen påverkar inte storage.
  const PERMISSIONS_BY_ROLE = Object.freeze({
    [ROLES.SYSTEM_ADMIN]: Object.freeze([
      "SYSTEM_VIEW_DASHBOARD",
      "SYSTEM_MANAGE_USERS",
      "SYSTEM_MANAGE_ROLES",
      "SYSTEM_MANAGE_MODULES",
      "SYSTEM_VIEW_AUDIT",
      "SYSTEM_VIEW_HEALTH",
    ]),
    [ROLES.ADMIN]: Object.freeze([
      "ADMIN_VIEW_HOME",
      "ADMIN_VIEW_QUESTIONS",
      "ADMIN_MANAGE_ACCESS",
      "ADMIN_MANAGE_ORG",
      "ADMIN_MANAGE_ROLES",
      "ADMIN_MANAGE_TASKS",
      "ADMIN_MANAGE_QUESTIONS",
      "ADMIN_VIEW_ANSWERS",
      "ADMIN_VIEW_REPORTS",
    ]),
    [ROLES.MANAGER]: Object.freeze([
      // Manager-översikt (egen yta)
      "MANAGER_VIEW_OVERVIEW",
    ]),
    [ROLES.EMPLOYEE]: Object.freeze([
      "EMP_VIEW_HOME",
      "EMP_UPDATE_TASKS",
      "EMP_VIEW_QUESTIONS",
      "EMP_SUBMIT_ANSWERS",
      "EMP_VIEW_PROFILE",
    ]),
  });

  // -------------------------
  // Debug
  // -------------------------
  const DEBUG = false;

  window.HR_CONFIG = Object.freeze({
    DEBUG,
    BASE_PATH,
    ROLES,
    PUBLIC_ROUTES,
    DEFAULT_ROUTE_BY_ROLE,
    ROUTES_BY_ROLE,
    PERMISSIONS_BY_ROLE,
  });
})();
