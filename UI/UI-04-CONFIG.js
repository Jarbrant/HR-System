/* ============================================================
AO-002 v1.2 | FILE: UI/UI-04-CONFIG.js
Projekt: HR-System
Syfte: Central config för RBAC + route-tillgång + default routing (config-driven)
Nivå: UI-only (GitHub Pages) | localStorage-first
Policy (LÅST):
- Ingen backend
- Inga storage-keys/datamodell utan AO (AO-002: skriver inget)
- Fail-closed (okänd roll = nekad)
- Public route ska vara explicit (endast allowlist), inte implicit via /UI/
- Authed rollers får inte ha /UI/ som route-prefix (minskar risk för “verktyg i UI-mappen”)
- XSS-escape hanteras i kärna (UI-03-APP.js); config innehåller inga user-data
Debug-notes:
- DEBUG är AV som default
- Logga aldrig PII/empNo (kärnan ansvarar)
Senaste sanning: 2025-12-30 (AO-002 v1.2 slutjustering A–C från PRC)
Ändringslogg:
- v1.2: ADMIN_VIEW_QUESTIONS + bort /UI/ från ROUTES_BY_ROLE + PUBLIC_ROUTES determinism (/index.html only)
============================================================ */

/*
  SCOPE (GitHub Pages):
  - Om ni vill hårdlåsa repo-subpath på GitHub Pages: sätt BASE_PATH="/HR-System"
  - Default är tom sträng => ingen hårdlåsning (lokalt eller auto-detektion i senare AO om ni vill)
  - Kärnan (UI-03-APP.js) ska alltid jämföra mot path EFTER BASE_PATH-trim.
*/

(function () {
  "use strict";

  // -------------------------
  // Base-path (GitHub Pages)
  // -------------------------
  // PRC: default ska vara tom sträng.
  // Vid hårdlåsning i produktion: "/HR-System"
  const BASE_PATH = "";

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
  // PRC C: Behåll endast /index.html (entydigt) och ta bort "/".
  // OBS: "/UI/UI-01-SKELETON.html" är publik (login).
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
    [ROLES.MANAGER]: "/admin/home.html",
    [ROLES.EMPLOYEE]: "/employee/home.html",
  });

  // -------------------------
  // Allowed routes per role (PREFIXES)
  // -------------------------
  // PRC B: Ta bort /UI/ från authed roller. Authed users ska inte implicit kunna nå UI-mappens övriga sidor.
  // Login nås via PUBLIC_ROUTES utan session-krav.
  const ROUTES_BY_ROLE = Object.freeze({
    [ROLES.SYSTEM_ADMIN]: Object.freeze([
      "/system/",
    ]),
    [ROLES.ADMIN]: Object.freeze([
      "/admin/",
    ]),
    [ROLES.MANAGER]: Object.freeze([
      "/admin/",
    ]),
    [ROLES.EMPLOYEE]: Object.freeze([
      "/employee/",
    ]),
  });

  // -------------------------
  // Permissions (minimal nivå 1)
  // -------------------------
  // PRC A: ADMIN_VIEW_QUESTIONS måste finnas för ADMIN för att undvika spök-nek vid VIEW-checks.
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
      "ADMIN_VIEW_QUESTIONS",       // ✅ PRC A (ny)
      "ADMIN_MANAGE_ACCESS",
      "ADMIN_MANAGE_ORG",
      "ADMIN_MANAGE_ROLES",
      "ADMIN_MANAGE_TASKS",
      "ADMIN_MANAGE_QUESTIONS",
      "ADMIN_VIEW_ANSWERS",
      "ADMIN_VIEW_REPORTS",
    ]),
    [ROLES.MANAGER]: Object.freeze([
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

  // Export (global)
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

