/* ============================================================
AO-002 v1.9 (PATCH) + AO-AUTH-PIN-V1 (TEST PATCH) | FILE: UI/UI-04-CONFIG.js
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

PATCH v1.6 (WORKER RUNTIME BANNER):
- Lägger till WORKER runtime-konfig (ingen lagring)
- Speglar till globals: window.__HR_WORKER_BASE_URL / window.__HR_WORKER_REQUIRE_AUTH

PATCH v1.7 (DEPLOY/DIAG HARDENING):
- Auto-detekterar BASE_PATH ("/HR-System" eller "") baserat på location.pathname
- Tydlig konsolrad när filen laddas (för att bevisa att den deployats/laddats)
- Fail-safe init av worker-globals (ingen lagring)

PATCH v1.9 (WORKER BASE URL FIX – SDK-KOMPATIBEL):
- WORKER.BASE_URL ska vara origin (utan /v1). SDK lägger på /v1 internt.
- Skyddar mot dubbel "/v1/v1" som kan ge 404/CORS-liknande nätfel.
- Respekterar redan satt window.__HR_WORKER_BASE_URL (t.ex. från banner/init).
============================================================ */
(function () {
  "use strict";

  // -------------------------
  // DIAG (no storage)
  // -------------------------
  const DIAG = Object.freeze({
    enabled: true,
    tag: "UI-04-CONFIG",
    version: "v1.9",
  });

  function diagInfo(msg) {
    try {
      if (DIAG.enabled && typeof console !== "undefined" && console && typeof console.info === "function") {
        console.info(`[${DIAG.tag} ${DIAG.version}] ${msg}`);
      }
    } catch (_) {}
  }
  function diagWarn(msg) {
    try {
      if (DIAG.enabled && typeof console !== "undefined" && console && typeof console.warn === "function") {
        console.warn(`[${DIAG.tag} ${DIAG.version}] ${msg}`);
      }
    } catch (_) {}
  }

  // -------------------------
  // Base-path (GitHub Pages)
  // -------------------------
  const BASE_PATH = (function detectBasePath() {
    try {
      const p = String((window.location && window.location.pathname) || "");
      return p.startsWith("/HR-System/") ? "/HR-System" : "";
    } catch (_) {
      return "/HR-System";
    }
  })();

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
    [ROLES.MANAGER]: "/manager/overview.html",
    [ROLES.EMPLOYEE]: "/employee/home.html",
  });

  // -------------------------
  // Allowed routes per role (PREFIXES)
  // -------------------------
  const ROUTES_BY_ROLE = Object.freeze({
    [ROLES.SYSTEM_ADMIN]: Object.freeze(["/system/"]),
    [ROLES.ADMIN]: Object.freeze(["/admin/"]),
    [ROLES.MANAGER]: Object.freeze(["/manager/"]),
    [ROLES.EMPLOYEE]: Object.freeze(["/employee/"]),
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
  // WORKER – runtime-only (NO STORAGE)
  // -------------------------
  // VIKTIGT (SDK): BASE_URL ska vara ORIGIN utan /v1.
  // Exempel: "https://hrsystem.andersmenyit.workers.dev"
  // SDK lägger på "/v1" när den anropar (t.ex. "/v1/health", "/v1/ai").
  const WORKER = Object.freeze({
    BASE_URL: "https://hrsystem.andersmenyit.workers.dev", // <-- SÄTT DIN ORIGIN HÄR (utan /v1)
    REQUIRE_AUTH: false,
  });

  // -------------------------
  // AUTH (AO-AUTH-PIN-V1) – TEST-läge (UI-only)
  // -------------------------
  const AUTH = Object.freeze({
    MODE: "PIN_TEST",

    PBKDF2: Object.freeze({
      algo: "PBKDF2",
      hash: "SHA-256",
      iterations: 120000,
      dkLenBytes: 32,
    }),

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

    SESSION: Object.freeze({
      ttlMs: 8 * 60 * 60 * 1000,
      maxFailedAttempts: 8,
      lockoutMs: 60 * 1000,
    }),

    TEST_DEFAULT_SCOPE_ID: "org_34eeebca45ba98_19b7e607383",
  });

  const DEBUG = false;

  // Export config (no storage)
  window.HR_CONFIG = Object.freeze({
    DEBUG,
    BASE_PATH,
    ROLES,
    PUBLIC_ROUTES,
    DEFAULT_ROUTE_BY_ROLE,
    ROUTES_BY_ROLE,
    PERMISSIONS_BY_ROLE,
    WORKER,
    AUTH,
  });

  // -------------------------
  // WORKER runtime globals (NO STORAGE)
  // -------------------------
  // Respektera redan satta värden (t.ex. om du sätter dem i en banner/init).
  // PATCH v1.9: skydda mot att någon råkat sätta ".../v1" (ger dubbel v1 i SDK).
  function normalizeWorkerBaseUrl(u) {
    const s = (typeof u === "string") ? u.trim() : "";
    if (!s) return "";
    // ta bort trailing slash
    let out = s.replace(/\/+$/g, "");
    // om någon har lagt /v1 på slutet -> ta bort (SDK lägger på)
    out = out.replace(/\/v1$/i, "");
    return out;
  }

  try {
    const curRaw = (typeof window.__HR_WORKER_BASE_URL === "string") ? window.__HR_WORKER_BASE_URL : "";
    const cur = normalizeWorkerBaseUrl(curRaw);
    const fallback = normalizeWorkerBaseUrl(String(WORKER.BASE_URL || ""));

    if (!cur) {
      window.__HR_WORKER_BASE_URL = fallback;
    } else {
      // om cur behövde normaliseras (t.ex. hade /v1) -> skriv tillbaka normaliserat
      if (cur !== curRaw.trim()) window.__HR_WORKER_BASE_URL = cur;
    }

    if (typeof window.__HR_WORKER_REQUIRE_AUTH !== "boolean") {
      window.__HR_WORKER_REQUIRE_AUTH = (WORKER.REQUIRE_AUTH === true);
    }
  } catch (_) {
    // fail-closed: gör inget
  }

  // -------------------------
  // DIAG
  // -------------------------
  const finalWorkerBase = normalizeWorkerBaseUrl(window.__HR_WORKER_BASE_URL);
  diagInfo(`Loaded. BASE_PATH="${BASE_PATH}" workerBase="${finalWorkerBase}"`);

  if (!finalWorkerBase || finalWorkerBase.indexOf("REPLACE-ME") !== -1) {
    diagWarn(
      `Worker BASE_URL är inte satt korrekt. Sätt WORKER.BASE_URL i UI-04-CONFIG.js till din origin (utan /v1).`
    );
  }

  /* ============================================================
     ÄNDRINGSLOGG (≤8)
     - FIX: SDK-kompatibel workerBase (utan /v1) + normalisering mot dubbel /v1
     - CHANGE: WORKER.BASE_URL satt till origin (utan /v1) som fallback
     - KEEP: respekterar already-set window.__HR_WORKER_BASE_URL
     - ADD: diagWarn text uppdaterad (utan /v1)
  ============================================================ */
})();
