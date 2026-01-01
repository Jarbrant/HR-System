/* ============================================================
AO-002 v1.3 (PATCH v1.4) | FILE: UI/UI-04-CONFIG.js
Projekt: HR-System
Syfte: Central config för RBAC + route-tillgång + default routing (config-driven)
Nivå: UI-only (GitHub Pages) | localStorage-first
Policy (LÅST):
- Ingen backend
- Inga storage-keys/datamodell utan AO (AO-002: skriver inget)
- Fail-closed (okänd roll = nekad)
- Public route ska vara explicit (endast allowlist)
- Authed rollers får inte ha /UI/ som route-prefix
PATCH v1.4 (RBAC):
- MANAGER får /manager/ (ny vy) och default-route till /manager/overview.html
============================================================ */

(function () {
  "use strict";

  // -------------------------
  // Base-path (GitHub Pages)
  // -------------------------
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
  const PUBLIC_ROUTES = Object.freeze([
    "/UI/UI-01-SKELETON.html",
    "/index.html",
  ]);

  // -------------------------
  // Default route per role
  // -------------------------
  const DEFAULT_ROUTE_BY_ROLE = Object.freeze({
    [ROLES.SYSTEM_ADMIN]: "/system/dashboard.html",
    [ROLES.ADMIN]: "/admin/home.html",

    // PATCH: Manager ska landa på manager-vy (inte admin)
    [ROLES.MANAGER]: "/manager/overview.html",

    [ROLES.EMPLOYEE]: "/employee/home.html",
  });

  // -------------------------
  // Allowed routes per role (PREFIXES)
  // -------------------------
  const ROUTES_BY_ROLE = Object.freeze({
    [ROLES.SYSTEM_ADMIN]: Object.freeze([
      "/system/",
    ]),
    [ROLES.ADMIN]: Object.freeze([
      "/admin/",
    ]),
    [ROLES.MANAGER]: Object.freeze([
      // PATCH: Manager får egen vy
      "/manager/",
      // Behåll admin om du vill att Manager även ska kunna gå in i admin-sidor
      // (om du INTE vill blanda, ta bort "/admin/" raden)
      "/admin/",
    ]),
    [ROLES.EMPLOYEE]: Object.freeze([
      "/employee/",
    ]),
  });

  // -------------------------
  // Permissions (minimal nivå 1)
  // -------------------------
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
      // Manager-översikt (ny)
      "MANAGER_VIEW_OVERVIEW",

      // Om ni återanvänder admin-funktioner för manager i v1:
      "ADMIN_VIEW_HOME",
      "ADMIN_MANAGE_TASKS",
      "ADMIN_VIEW_QUESTIONS",
      "ADMIN_VIEW_ANSWERS",
      "ADMIN_VIEW_REPORTS",
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
