/* ============================================================
AO-002 v1.2 | FILE: UI/UI-03-APP.js
Projekt: HR-System
Syfte: CORE “hjärta” — Auth-guard, RBAC, fail-closed routing, scope-grund, XSS-helpers
Nivå: UI-only (GitHub Pages) | localStorage-first
Policy (LÅST):
- Ingen backend
- Fail-closed guards (sessionStorage → localStorage fallback)
- Ingen känslig persondata (endast empNo om det finns i session; logga ej)
- Inga nya storage-keys/datamodell utan AO (AO-002: skriver inget nytt)
- XSS-escape på allt som renderas från storage (helpers erbjuds här)
Senaste sanning: 2025-12-30 (AO-002 PATCH v1.2 PRC-beslut)
Ändringslogg:
- v1.2: getSafePathname + prefix startsWith + BASE_PATH-trim + canonical getAuth + redirectTo + _paths endast i DEBUG
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

    // GUARD: BASE_PATH finns i config (default "" enligt PRC-beslut).
    // Vi accepterar "" eller "/HR-System" etc.
    if (typeof c.BASE_PATH !== "string") return null;

    return c;
  }

  // ============================================================
  // PATH NORMALIZATION (P0) — getSafePathname()
  // ============================================================

  function decodeOnceSafe(s) {
    // GUARD: defensiv decodeURIComponent
    try {
      return decodeURIComponent(String(s || ""));
    } catch {
      return String(s || "");
    }
  }

  function collapseSlashes(p) {
    return String(p || "").replace(/\/{2,}/g, "/");
  }

  function ensureLeadingSlash(p) {
    const s = String(p || "");
    if (!s) return "/";
    return s.startsWith("/") ? s : ("/" + s);
  }

  function normalizeBasePath(basePath) {
    // SCOPE: PRC-beslut: BASE_PATH default "" (tom).
    // Om satt, ska den vara "/HR-System" (utan trailing slash).
    const b = String(basePath || "").trim();
    if (!b) return "";
    const withSlash = ensureLeadingSlash(b);
    return withSlash.replace(/\/+$/, "");
  }

  function trimBasePath(pathname, basePath) {
    const p = String(pathname || "");
    const b = normalizeBasePath(basePath);

    if (!b) return p; // inget att trimma
    if (p === b) return "/"; // exakt bas => root i app
    if (p.startsWith(b + "/")) return p.slice(b.length) || "/";
    return p; // matchar inte => lämna, men detta kan leda till deny senare
  }

  function hasDotDotSegment(p) {
    // GUARD: blockera .. segment (även om den är URL-encoded)
    // Vi kollar både innan och efter decode.
    const raw = String(p || "");
    const dec = decodeOnceSafe(raw);

    // Splitta på / och kolla segment exakt ".."
    function check(s) {
      const parts = String(s || "").split("/");
      return parts.some((seg) => seg === "..");
    }

    // Även "%2e%2e" kan bli ".." efter decode.
    return check(raw) || check(dec);
  }

  function getSafePathname() {
    const cfg = getConfig();
    if (!cfg) return "";

    // 1) raw pathname
    let p = String(window.location.pathname || "/");

    // 2) defensiv decode en gång (för att fånga "%2e%2e" och andra konstigheter)
    //    men vi använder även raw för fail-closed checks.
    const decoded = decodeOnceSafe(p);

    // 3) collapse slashes (på decoded)
    p = collapseSlashes(decoded);

    // 4) ensure leading slash
    p = ensureLeadingSlash(p);

    // 5) trim BASE_PATH (P1)
    p = trimBasePath(p, cfg.BASE_PATH);

    // 6) collapse slashes igen efter trim
    p = collapseSlashes(p);

    // 7) blockera .. segment (P0 fail-closed)
    if (hasDotDotSegment(p)) return "";

    // 8) final: säkerställ leading slash igen
    p = ensureLeadingSlash(p);

    // GUARD: endast pathname här (query/hash ingår inte i location.pathname).
    return p;
  }

  // ============================================================
  // AUTH SHAPE (P1) — canonical getAuth()
  // ============================================================

  function normalizeRole(roleRaw) {
    const cfg = getConfig();
    if (!cfg) return "";

    const r = String(roleRaw || "").trim();
    const roles = cfg.ROLES;
    const values = Object.keys(roles).map((k) => roles[k]);
    return values.includes(r) ? r : "";
  }

  function getAuth(session) {
    // SCOPE: Standardisera utan att skriva storage:
    // - Stöd platt session: { isAuthed, role, scopeId, expiresAt }
    // - Stöd wrapped: { auth: { ... } }
    const s = session && typeof session === "object" ? session : null;
    if (!s) return null;

    const a = (s.auth && typeof s.auth === "object") ? s.auth : s;
    const out = {
      isAuthed: a.isAuthed === true,
      role: normalizeRole(a.role),
      scopeId: String((a.scopeId ?? s.scopeId) ?? "").trim(),
      expiresAt: a.expiresAt ? Number(a.expiresAt) : null,
    };

    // GUARD: role måste vara giltig när authed
    if (out.isAuthed && !out.role) return null;

    return out;
  }

  // GUARD: validera session; om saknas/korrupt => null.
  function mustGetSession() {
    const data = readStorage(SESSION_KEY);
    if (!data || typeof data !== "object") return null;

    const auth = getAuth(data);
    if (!auth || auth.isAuthed !== true) return null;

    // GUARD: expiresAt (om finns) måste vara i framtiden.
    if (auth.expiresAt && auth.expiresAt < Date.now()) return null;

    return data; // PRC: returnera originalobjektet
  }

  // ============================================================
  // PUBLIC ROUTES (explicit) — no implicit /UI/
  // ============================================================

  function stripQueryHash(urlLike) {
    // GUARD: för route checks som får input med query/hash
    const s = String(urlLike || "");
    return s.split("#")[0].split("?")[0];
  }

  function isPublicRoute(appRelPath) {
    const cfg = getConfig();
    if (!cfg) return false;

    const p = String(appRelPath || "");
    if (!p) return false;

    // GUARD: exakt match mot PUBLIC_ROUTES.
    return cfg.PUBLIC_ROUTES.includes(p);
  }

  // ============================================================
  // RBAC (P0) — deterministic prefix match on normalized relative path
  // ============================================================

  function isHtmlLikeRoute(appRelPath) {
    const p = String(appRelPath || "").toLowerCase();
    if (!p) return false;
    return p === "/" || p.endsWith(".html") || p.endsWith("/");
  }

  function normalizeRelPathForCheck(inputPath) {
    // SCOPE:
    // - Tar emot pathname-liknande sträng (kan ha query/hash)
    // - Använder getSafePathname() för den aktuella sidan (window.pathname)
    //   eller bearbetar input via samma regler så långt det går.
    // För AO-002 använder vi främst nuvarande route via getSafePathname().
    const raw = stripQueryHash(inputPath);

    // Om inputPath är exakt current pathname, använd getSafePathname() (starkast).
    // Annars gör en minimal normalisering som speglar samma grundregler.
    const currentRaw = String(window.location.pathname || "");
    if (raw === currentRaw) return getSafePathname();

    const cfg = getConfig();
    if (!cfg) return "";

    let p = ensureLeadingSlash(collapseSlashes(decodeOnceSafe(raw)));
    p = trimBasePath(p, cfg.BASE_PATH);
    p = collapseSlashes(p);
    if (hasDotDotSegment(p)) return "";
    return ensureLeadingSlash(p);
  }

  function rootAwareStartsWith(path, prefix) {
    // GUARD: startsWith(prefix) men “root-aware”:
    // - prefix "/admin" matchar "/admin" och "/admin/..." men INTE "/adminx"
    const p = String(path || "");
    const pre = String(prefix || "");
    if (!p || !pre) return false;

    if (!p.startsWith(pre)) return false;
    if (p.length === pre.length) return true; // exakt
    // nästa tecken måste vara "/"
    return p.charAt(pre.length) === "/";
  }

  function canAccessRoute(role, pathname) {
    const cfg = getConfig();
    if (!cfg) return false;

    const r = normalizeRole(role);
    if (!r) return false;

    // P0/P1: Normalisera relativ path (BASE_PATH bort, // kollaps, .. block)
    const rel = normalizeRelPathForCheck(pathname || window.location.pathname || "");
    if (!rel) return false; // fail-closed

    // Assets ska inte blockeras av denna kontroll
    if (!isHtmlLikeRoute(rel)) return true;

    const allowed = cfg.ROUTES_BY_ROLE[r];
    if (!Array.isArray(allowed) || allowed.length === 0) return false;

    // P0: deterministisk prefixmatch (root-aware)
    // Här antar vi att ROUTES_BY_ROLE kan innehålla:
    // - exakta routes ("/admin/home.html")
    // - eller prefix ("/admin") om ni väljer det i config senare
    return allowed.some((entry) => {
      const e = String(entry || "").trim();
      if (!e) return false;
      if (e.endsWith(".html") || e === "/" || e.endsWith("/")) {
        // exakt match
        return rel === e;
      }
      // prefix match
      return rootAwareStartsWith(rel, e);
    });
  }

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
  // ROUTING (deterministisk, BASE_PATH-safe)
  // ============================================================

  function absPathFromApp(relativeAppPath) {
    const cfg = getConfig();
    if (!cfg) return "/";

    const base = normalizeBasePath(cfg.BASE_PATH);
    const rel = String(relativeAppPath || "").trim();
    const relNorm = ensureLeadingSlash(rel);

    if (!base) return relNorm;
    return base + relNorm;
  }

  function loginUrl(err) {
    const base = absPathFromApp("/UI/UI-01-SKELETON.html");
    return err ? (base + "?err=" + encodeURIComponent(String(err))) : base;
  }

  function routeAfterLogin(session) {
    const cfg = getConfig();
    if (!cfg) return loginUrl("config");

    const auth = getAuth(session);
    if (!auth || !auth.isAuthed || !auth.role) return loginUrl("role");

    const dest = cfg.DEFAULT_ROUTE_BY_ROLE[auth.role];
    if (!dest) return loginUrl("route");

    const appRel = String(dest || "").trim();
    if (!appRel.startsWith("/")) return loginUrl("route");

    return absPathFromApp(appRel);
  }

  // ============================================================
  // AUTH GUARD (fail-closed) + redirectTo (P1)
  // ============================================================

  // requireAuth({ allowRoles?: [], redirectTo?: string })
  function requireAuth(opts) {
    const options = (opts && typeof opts === "object") ? opts : {};
    const allowRoles = Array.isArray(options.allowRoles) ? options.allowRoles : [];

    // P1: redirectTo implementeras korrekt
    // - Om given, måste vara en APP-RELATIVE html-path ("/UI/UI-01-SKELETON.html" eller "/employee/home.html")
    // - Annars default login
    const redirectToRaw = String(options.redirectTo || "").trim();
    const redirectTo =
      redirectToRaw && redirectToRaw.startsWith("/") && !hasDotDotSegment(redirectToRaw)
        ? absPathFromApp(stripQueryHash(redirectToRaw))
        : loginUrl("unauth");

    const cfg = getConfig();
    if (!cfg) {
      redirect(loginUrl("config"));
      return null;
    }

    // P0: Säker pathname (relativ i appen)
    const rel = getSafePathname();
    if (!rel) {
      redirect(loginUrl("forbidden"));
      return null;
    }

    // Public route får nås utan session, men endast explicit allowlist
    if (isHtmlLikeRoute(rel) && isPublicRoute(rel)) {
      return { public: true };
    }

    const session = mustGetSession();
    if (!session) {
      redirect(redirectTo);
      return null;
    }

    const auth = getAuth(session);
    if (!auth || auth.isAuthed !== true || !auth.role) {
      redirect(redirectTo);
      return null;
    }

    // allowRoles-filter om angivet
    if (allowRoles.length > 0) {
      const allowed = allowRoles.map(normalizeRole).filter(Boolean);
      if (!allowed.includes(auth.role)) {
        redirect(loginUrl("forbidden"));
        return null;
      }
    }

    // Route allowlist (deterministisk prefixmatch, root-aware)
    if (isHtmlLikeRoute(rel) && !canAccessRoute(auth.role, rel)) {
      redirect(loginUrl("forbidden"));
      return null;
    }

    return session;
  }

  // ============================================================
  // SCOPE GRUND (inte org/subtree)
  // ============================================================

  function getScopeId(session) {
    const auth = getAuth(session);
    if (!auth) return "";
    return String(auth.scopeId || "").trim();
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
  // DEBUG HOOKS (AV default) + P2 _paths exposure
  // ============================================================

  function debugEnabled() {
    const cfg = getConfig();
    return !!(cfg && cfg.DEBUG === true);
  }

  function redactMeta(meta) {
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

  const api = {
    // Storage/session
    safeJsonParse,
    readStorage,
    mustGetSession,
    clearSession,

    // Canonical auth accessor (P1)
    getAuth,

    // Auth/Routing/RBAC
    requireAuth,
    routeAfterLogin,
    canAccessRoute,
    hasPermission,

    // Path hardening (P0) — exposed (no PII)
    getSafePathname,

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
  };

  // P2: _paths endast i DEBUG
  if (debugEnabled()) {
    api._paths = {
      basePath: function () {
        const cfg = getConfig();
        return cfg ? cfg.BASE_PATH : null;
      },
      safePathname: getSafePathname,
      absPathFromApp,
    };
  }

  window.HRApp = api;
})();
