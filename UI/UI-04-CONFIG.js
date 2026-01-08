/* ============================================================
AO-002 v1.6 (PATCH) + AO-AUTH-PIN-V1 (TEST PATCH) | FILE: UI/UI-04-CONFIG.js
Projekt: HR-System
Syfte: Central config för RBAC + route-tillgång + default routing + AUTH-policy (PIN-test)
Nivå: UI-only (GitHub Pages) | localStorage-first

Policy (LÅST):
- Ingen backend
- Inga storage-keys/datamodell utan AO (denna fil skriver inget)
- Fail-closed (okänd roll = nekad)
- Public route ska vara explicit (endast allowlist)
- Authed roller får inte ha /UI/ som route-prefix
- AUTH PIN är TEST-läge (inte “riktig” säkerhet utan backend)

PATCH v1.5 (STABILITET):
- MANAGER är isolerad till /manager/ (tar bort /admin/ för att undvika rollblandning)
- DEFAULT_ROUTE_BY_ROLE[MANAGER] = /manager/overview.html (standard .html)

AO-AUTH-PIN-V1 (TEST):
- Förbereder PIN-login utan klartext-PIN i kod (PBKDF2-hash + salt per roll)
- Session-policy (TTL/lockout) definieras här och används av core/login
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
  // AUTH (AO-AUTH-PIN-V1) – TEST-läge (UI-only)
  // -------------------------
  // Kort och rakt: detta är INTE “riktig” auth utan backend.
  // Men: vi undviker klartext-PIN i kod genom PBKDF2-hash.
  const AUTH = Object.freeze({
    MODE: "PIN_TEST", // framtid: "EMAIL_OTP" / "MAGIC_LINK" / "SSO"

    // PBKDF2-parametrar (måste matcha implementationen i core/login)
    PBKDF2: Object.freeze({
      algo: "PBKDF2",
      hash: "SHA-256",
      iterations: 120000,
      dkLenBytes: 32,
    }),

    // Roll -> { salt, hashHex }
    // Hasharna är beräknade för PIN: 9000/3001/2001/1234 per roll.
    // (FUTURE) När ni går skarp: byt till riktig identitet + verifiering (backend).
    PIN_HASHES_BY_ROLE: Object.freeze({
      [ROLES.SYSTEM_ADMIN]: Object.freeze({
        salt: "HR-System|AO-AUTH-PIN-V1|SYSTEM_ADMIN|v1",
        hashHex: "1855b1ebf2edcd7ca9ce2dca53a758884fee070726a9e68bd645d6bf70ffa2c7",
      }),
      [ROLES.ADMIN]: Object.freeze({
        salt: "HR-System|AO-AUTH-PIN-V1|ADMIN|v1",
        hashHex: "28c1b3337ab26c514a260b79ccb050d7a565eef8abb861799eb2a5a78c6601af",
      }),
      [ROLES.MANAGER]: Object.freeze({
        salt: "HR-System|AO-AUTH-PIN-V1|MANAGER|v1",
        hashHex: "3b5c690f3f2da6cdf2eed6d8a061e786fa181d9b3409d0f14597f9f938e9eb56",
      }),
      [ROLES.EMPLOYEE]: Object.freeze({
        salt: "HR-System|AO-AUTH-PIN-V1|EMPLOYEE|v1",
        hashHex: "86f26ba6ef5d5bc78b58615fe78974a14a083cbe4dc360c6493c587c808d1594",
      }),
    }),

    // Session-policy (UI-only)
    SESSION: Object.freeze({
      // TTL: 8h (FUTURE: kortare + refresh-token i backend)
      ttlMs: 8 * 60 * 60 * 1000,

      // Enkelt skydd mot “spam” i UI-only
      maxFailedAttempts: 8,
      lockoutMs: 60 * 1000,
    }),

    // Test-default scopeId (du gav denna). Används bara om login/AO tillåter default.
    // Fail-closed ska fortfarande gälla om systemet kräver explicit assignment.
    TEST_DEFAULT_SCOPE_ID: "org_34eeebca45ba98_19b7e607383",
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

    // AO-AUTH-PIN-V1
    AUTH,
  });
})();
