/* ============================================================
AO-002 v1.1 | FILE: UI/UI-03-APP.js
Projekt: HR-System
Syfte: CORE “hjärta” — Auth-guard, RBAC, fail-closed routing, scope-grund, XSS-helpers
Nivå: UI-only (GitHub Pages) | localStorage-first
Policy (LÅST):
- Ingen backend
- Fail-closed guards (sessionStorage → localStorage fallback)
- Ingen känslig persondata (endast empNo om det finns i session; logga ej)
- Inga nya storage-keys/datamodell utan AO (AO-002: skriver inget nytt)
- XSS-escape på allt som renderas från storage (helpers erbjuds här)
Senaste sanning: 2025-12-30 (AO-002 v1.1 PATCH-ORDER från PRC)
Ändringslogg:
- v1.1: Strikt allowlist + BASE_PATH + traversal-fail-closed + explicit public routes (endast login)
============================================================ */

(function () {
  "use strict";

  // ============================================================
  // STORAGE (AO-002 LÅST)
  // ============================================================

  // STORAGE: Återanvänd exakt befintlig session-nyckel.
  const SESSION_KEY = "AO-001_LOGIN_V1";

  // GUARD: JSON-parse får aldrig kasta. Returnera null vid fel.
  function safeJsonParse(str) {
    if (typeof str !== "string" || !str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  // STORAGE: läs sessionStorage först, annars localStorage (fail-closed).
  function readStorage(key) {
    const k = String(key || "");
    if (!k) return null;

    const s1 = sessionStorage.getItem(k);
    if (s1) return safeJsonParse(s1);

    const s2 = localStorage.getItem(k);
    if (s2) return safeJsonParse(s2);

    return null;
  }

  // GUARD: rensa session (tillåtet som “clearSession”).
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  }

  // ============================================================
  // CONFIG (AO-002 krav)
  // ============================================================

  function getConfig() {
    const c = window.HR_CONFIG;
    if (!c || typeof c !== "object") return null;

    // GUARD: minsta fält som krävs.
    if (!c.ROLES || !c.DEFAULT_ROUTE_BY_ROLE || !c.ROUTES_BY_ROLE || !c.PERMISSIONS_BY_ROLE) return null;
    if (!Array.isArray(c.PUBLIC_ROUTES)) return null;
    if (!c.SANITIZE || typeof c.SANITIZE !== "object") return null;

    // GUARD: sanitizers måste finnas (AO-002 v1.1).
    const s = c.SANITIZE;
    if (
      typeof s.stripQueryHash !== "function" ||
      typeof s.isTraversalLike !== "function" ||
      typeof s.toAppRelativePath !== "function"
    ) return null;

    return c;
  }

  // ============================================================
  // PATH + NORMALIZATION (risk-hardening)
  // ============================================================

  // GUARD: Vi matchar endast mot “app-relative path”, utan query/hash.
  function getAppRelativePathname(inputPathname) {
    const cfg = getConfig();
    if (!cfg) return "";

    const raw = String(inputPathname || window.location.pathname || "");
    // GUARD: query/hash får aldrig påverka access.
    const noQH = cfg.SANITIZE.stripQueryHash(raw);

    // GUARD: traversal-liknande ska alltid fail-closed.
    if (cfg.SANITIZE.isTraversalLike(noQH)) return ""; // => deny

    // SCOPE: "/HR-System/admin/home.html" => "/admin/home.html"
    const rel = cfg.SANITIZE.toAppRelativePath(noQH);
    return String(rel || "");
  }

  // GUARD: Absolut path från app-root (BASE_PATH stöd via CONFIG).
  function absPathFromApp(relativeAppPath) {
    const cfg = getConfig();
    if (!cfg) return "/";

    const base = String(cfg.BASE_PATH || "").replace(/\/+$/, "");
    const rel = String(relativeAppPath || "").trim();
    const relNorm = rel.startsWith("/") ? rel : ("/" + rel);

    if (!base || base === "/") return relNorm;
    return base + relNorm;
  }

  function loginUrl(err) {
    // DEBUG: bara felkod, aldrig empNo/PII.
    const base = absPathFromApp("/UI/UI-01-SKELETON.html");
    return err ? (base + "?err=" + encodeURIComponent(String(err))) : base;
  }

  function redirect(url) {
    window.location.replace(String(url || loginUrl("unauth")));
  }

  // ============================================================
  // SESSION / AUTH (fail-closed)
  // ============================================================

  // GUARD: validera sessionform; om saknas/korrupt => null.
  function mustGetSession() {
    const data = readStorage(SESSION_KEY);
    if (!data || typeof data !== "object") return null;

    // SCOPE: stöd både {auth:{...}} och platt form.
    const auth = (data.auth && typeof data.auth === "object") ? data.auth : data;

    // GUARD: explicit isAuthed måste vara true.
    if (auth.isAuthed !== true) return null;

    // GUARD: expiresAt (om finns) måste vara i framtiden.
    if (auth.expiresAt && Number(auth.expiresAt) < Date.now()) return null;

    // GUARD: roll måste vara giltig enligt config.
    const role = normalizeRole(auth.role);
    if (!role) return null;

    return data;
  }

  function normalizeRole(roleRaw) {
    const cfg = getConfig();
    if (!cfg) return "";

    const r = String(roleRaw || "").trim();
    const roles = cfg.ROLES;
    const values = Object.keys(roles).map((k) => roles[k]);
    return values.includes(r) ? r : "";
  }

  function getRoleFromSession(session) {
    const s = session && typeof session === "object" ? session : null;
    if (!s) return "";
    const auth = (s.auth && typeof s.auth === "object") ? s.auth : s;
    return normalizeRole(auth.role);
  }

  // ============================================================
  // PUBLIC ROUTES (explicit, no implicit /UI/)
  // ============================================================

  function isPublicRoute(appRelPath) {
    const cfg = getConfig();
    if (!cfg) return false;

    const p = String(appRelPath || "");
    if (!p) return false;

    // GUARD: endast exakt match mot PUBLIC_ROUTES.
    // Ex: "/UI/UI-01-SKELETON.html" är publik, men "/UI/annat.html" är inte.
    return cfg.PUBLIC_ROUTES.includes(p);
  }

  // ============================================================
  // RBAC (strict allowlist)
  // ============================================================

  function isHtmlLikeRoute(appRelPath) {
    // GUARD: Vi begränsar route-access-check till HTML routes, så att assets (css/js/img)
    // inte “blockeras” i nätverkslagret via guard-liknande calls.
    const p = String(appRelPath || "").toLowerCase();
    if (!p) return false;
    return p === "/" || p.endsWith(".html") || p.endsWith("/"); // GH Pages dir index
  }

  // canAccessRoute(role, pathname) - config-driven strict list
  function canAccessRoute(role, pathname) {
    const cfg = getConfig();
    if (!cfg) return false;

    const r = normalizeRole(role);
    if (!r) return false;

    // Normalize + harden
    const appRel = getAppRelativePathname(pathname);
    if (!appRel) return false; // traversal/korrupt => deny

    // GUARD: Public route ska inte kräva session (hanteras separat i requireAuth/soft check).
    // canAccessRoute är endast för skyddade html-sidor.
    if (!isHtmlLikeRoute(appRel)) return true; // assets ska inte stoppas här

    const allowed = cfg.ROUTES_BY_ROLE[r];
    if (!Array.isArray(allowed) || allowed.length === 0) return false;

    // GUARD: strikt allowlist (exakt match)
    return allowed.includes(appRel);
  }

  // hasPermission(role, permission) - minimal nivå 1
  function hasPermission(role, permission) {
    const cfg = getConfig();
    if (!cfg) return false;

    const r = normalizeRole(role);
    if (!r) return false;

    const list = cfg.PERMISSIONS_BY_ROLE[r];
    if (!Array.isArray(list)) return false;

    const perm = String(permission || "").trim();
    if (!perm) return false;

    return list.includes(perm);
  }

  // ============================================================
  // ROUTING (deterministisk)
  // ============================================================

  // routeAfterLogin(session) => absolut url (BASE_PATH-safe)
  function routeAfterLogin(session) {
    const cfg = getConfig();
    if (!cfg) return loginUrl("config");

    const role = getRoleFromSession(session);
    if (!role) return loginUrl("role");

    const dest = cfg.DEFAULT_ROUTE_BY_ROLE[role];
    if (!dest) return loginUrl("route");

    // GUARD: dest i config är app-relative med ledande "/"
    const appRel = String(dest || "").trim();
    if (!appRel.startsWith("/")) return loginUrl("route");

    return absPathFromApp(appRel);
  }

  // ============================================================
  // AUTH GUARD (fail-closed)
  // ============================================================

  // requireAuth({ allowRoles?: [], redirect?: string })
  function requireAuth(opts) {
    const options = (opts && typeof opts === "object") ? opts : {};
    const allowRoles = Array.isArray(options.allowRoles) ? options.allowRoles : [];
    const redirectTo = String(options.redirect || loginUrl("unauth"));

    const cfg = getConfig();
    if (!cfg) {
      redirect(loginUrl("config"));
      return null;
    }

    // Normalize current route
    const appRel = getAppRelativePathname(window.location.pathname);
    if (!appRel) {
      // GUARD: traversal/korrupt path => alltid fail-closed
      redirect(loginUrl("forbidden"));
      return null;
    }

    // GUARD: Public routes får nås utan session (MEN endast explicit PUBLIC_ROUTES).
    if (isHtmlLikeRoute(appRel) && isPublicRoute(appRel)) {
      return { public: true };
    }

    // Allt annat kräver giltig session
    const session = mustGetSession();
    if (!session) {
      redirect(loginUrl("unauth"));
      return null;
    }

    const role = getRoleFromSession(session);
    if (!role) {
      redirect(loginUrl("role"));
      return null;
    }

    // allowRoles-filter (om angivet)
    if (allowRoles.length > 0) {
      const allowed = allowRoles.map(normalizeRole).filter(Boolean);
      if (!allowed.includes(role)) {
        redirect(loginUrl("forbidden"));
        return null;
      }
    }

    // Route allowlist (strict)
    if (isHtmlLikeRoute(appRel) && !canAccessRoute(role, window.location.pathname)) {
      redirect(loginUrl("forbidden"));
      return null;
    }

    return session;
  }

  // ============================================================
  // SCOPE GRUND (inte org/subtree)
  // ============================================================

  function getScopeId(session) {
    const s = session && typeof session === "object" ? session : null;
    if (!s) return "";
    const auth = (s.auth && typeof s.auth === "object") ? s.auth : s;
    const v = auth.scopeId ?? s.scopeId;
    return String(v || "").trim();
  }

  // fail-closed om något saknas
  function sameOrMissingScope(a, b) {
    const A = String(a || "").trim();
    const B = String(b || "").trim();
    if (!A || !B) return false;
    return A === B;
  }

  // ============================================================
  // XSS HELPERS
  // ============================================================

  function escapeHtml(value) {
    const s = String(value ?? "");
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setText(el, value) {
    if (!el) return;
    el.textContent = String(value ?? "");
  }

  // ============================================================
  // DEBUG HOOKS (AV default)
  // ============================================================

  function debugEnabled() {
    const cfg = getConfig();
    return !!(cfg && cfg.DEBUG === true);
  }

  function redactMeta(meta) {
    // DEBUG: skydda mot oavsiktlig PII i loggar.
    if (!meta || typeof meta !== "object") return meta;
    const out = {};
    for (const k of Object.keys(meta)) {
      const key = String(k).toLowerCase();
      if (key.includes("emp") || key.includes("person") || key.includes("ssn") || key.includes("id")) {
        out[k] = "[redacted]";
      } else {
        out[k] = meta[k];
      }
    }
    return out;
  }

  function debugLog(msg, meta) {
    if (!debugEnabled()) return;
    try {
      console.log("[HRApp]", String(msg || ""), meta ? redactMeta(meta) : "");
    } catch {}
  }

  // ============================================================
  // OPTIONAL: Safe logout
  // ============================================================

  function logout() {
    clearSession();
    redirect(loginUrl("logout"));
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  window.HRApp = {
    // Storage/session
    safeJsonParse,
    readStorage,
    mustGetSession,
    clearSession,

    // Auth/Routing/RBAC
    requireAuth,
    routeAfterLogin,
    canAccessRoute,
    hasPermission,

    // Scope grund
    getScopeId,
    sameOrMissingScope,

    // XSS helpers
    escapeHtml,
    setText,

    // Debug
    debugLog,

    // Convenience
    logout,

    // Diagnostics (no PII)
    _diag: {
      getAppRelativePathname,
      absPathFromApp,
      isPublicRoute,
    },
  };
})();
