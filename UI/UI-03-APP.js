/* ============================================================
AO-002 v1.4 | FILE: UI/UI-03-APP.js
Projekt: HR-System
Syfte: CORE “hjärta” — Auth-guard, RBAC, fail-closed routing, scope-grund, XSS-helpers
Nivå: UI-only (GitHub Pages) | localStorage-first
Policy (LÅST):
- Ingen backend
- Fail-closed guards (sessionStorage → localStorage fallback)
- Ingen känslig persondata (endast empNo om det finns i session; logga ej)
- Inga nya storage-keys/datamodell utan AO (AO-002: skriver inget nytt)
- XSS-escape på allt som renderas från storage (helpers erbjuds här)
Senaste sanning: 2025-12-30 (AO-002 PATCH v1.3 PRC-beslut)
Ändringslogg:
- v1.2: getSafePathname + prefix startsWith + BASE_PATH-trim + canonical getAuth + redirectTo + _paths endast i DEBUG
- v1.3 (PATCH): ROUTES_BY_ROLE entries som slutar med "/" tolkas som PREFIX (inte exakt). Fixar att "/admin/" matchar "/admin/home.html" etc.
- v1.4 (PATCH): Deterministisk scopeId-resolve från befintliga assignments (AO-020_ROLE_ASSIGNMENTS_V2) när session saknar scopeId.
  * Skriver inget nytt. Läser endast befintliga keys.
  * getAuth exponerar empNo (om finns) + härleder scopeId utan att mutera session.
============================================================ */

(function () {
  "use strict";

  // ============================================================
  // STORAGE (AO-002 LÅST)
  // ============================================================

  // STORAGE: Återanvänd exakt befintlig session-nyckel.
  const SESSION_KEY = "AO-001_LOGIN_V1";

  // STORAGE: Befintliga nycklar (läsning endast)
  const ASSIGNMENTS_KEY = "AO-020_ROLE_ASSIGNMENTS_V2";

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

  // STORAGE: läs localStorage (för systemdata som normalt ligger där).
  function readLocalStorage(key) {
    const k = String(key || "");
    if (!k) return null;
    try {
      const raw = localStorage.getItem(k);
      return safeJsonParse(raw || "");
    } catch {
      return null;
    }
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

    function check(s) {
      const parts = String(s || "").split("/");
      return parts.some((seg) => seg === "..");
    }

    return check(raw) || check(dec);
  }

  function getSafePathname() {
    const cfg = getConfig();
    if (!cfg) return "";

    let p = String(window.location.pathname || "/");
    const decoded = decodeOnceSafe(p);
    p = collapseSlashes(decoded);
    p = ensureLeadingSlash(p);
    p = trimBasePath(p, cfg.BASE_PATH);
    p = collapseSlashes(p);
    if (hasDotDotSegment(p)) return "";
    p = ensureLeadingSlash(p);
    return p;
  }

  // ============================================================
  // AUTH SHAPE (P1) — canonical getAuth()
  // + AO-002 v1.4: resolve scopeId from assignments if missing
  // ============================================================

  function normalizeRole(roleRaw) {
    const cfg = getConfig();
    if (!cfg) return "";

    const r = String(roleRaw || "").trim();
    const roles = cfg.ROLES;
    const values = Object.keys(roles).map((k) => roles[k]);
    return values.includes(r) ? r : "";
  }

  function normalizeEmpNo(empRaw) {
    // EMPNO: tolerans i läsning (men vi "gissar" inte innehåll).
    // Om session använder number/string, normalisera till sträng.
    const s = String(empRaw ?? "").trim();
    return s;
  }

  function extractEmpNo(sessionLike) {
    const s = sessionLike && typeof sessionLike === "object" ? sessionLike : null;
    if (!s) return "";

    const a = (s.auth && typeof s.auth === "object") ? s.auth : s;

    // Stöd flera namn utan att kräva dem.
    const cand =
      a.empNo ?? s.empNo ??
      a.employeeNo ?? s.employeeNo ??
      a.emp ?? s.emp ??
      null;

    return normalizeEmpNo(cand);
  }

  function extractScopeId(sessionLike) {
    const s = sessionLike && typeof sessionLike === "object" ? sessionLike : null;
    if (!s) return "";

    const a = (s.auth && typeof s.auth === "object") ? s.auth : s;
    return String((a.scopeId ?? s.scopeId) ?? "").trim();
  }

  function resolveScopeIdFromAssignments(empNo) {
    // AO-002 v1.4: läs befintlig assignments-key och hitta scopeId för empNo.
    // Skriver INGET.
    const me = normalizeEmpNo(empNo);
    if (!me) return "";

    const data = readLocalStorage(ASSIGNMENTS_KEY);
    if (!data) return "";

    // Format A: Array[{ empNo, scopeId, ... }]
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row || typeof row !== "object") continue;

        const rowEmp =
          normalizeEmpNo(row.empNo ?? row.employeeNo ?? row.emp ?? row.id ?? "");
        if (!rowEmp || rowEmp !== me) continue;

        const scope = String(row.scopeId ?? row.scope ?? row.nodeId ?? row.orgId ?? "").trim();
        if (scope) return scope;
      }
      return "";
    }

    // Format B: Object-map { "3001": { scopeId:"UNIT_A", ... } } eller { "3001":"UNIT_A" }
    if (typeof data === "object") {
      const direct = data[me];
      if (direct && typeof direct === "object") {
        const scope = String(direct.scopeId ?? direct.scope ?? direct.nodeId ?? direct.orgId ?? "").trim();
        if (scope) return scope;
      }
      if (typeof direct === "string" || typeof direct === "number") {
        const scope = String(direct).trim();
        if (scope) return scope;
      }

      // Format C: { byEmpNo: { "3001": {scopeId} } }
      const byEmpNo = data.byEmpNo;
      if (byEmpNo && typeof byEmpNo === "object") {
        const row = byEmpNo[me];
        if (row && typeof row === "object") {
          const scope = String(row.scopeId ?? row.scope ?? row.nodeId ?? row.orgId ?? "").trim();
          if (scope) return scope;
        }
        if (typeof row === "string" || typeof row === "number") {
          const scope = String(row).trim();
          if (scope) return scope;
        }
      }
    }

    return "";
  }

  function getAuth(session) {
    const s = session && typeof session === "object" ? session : null;
    if (!s) return null;

    const a = (s.auth && typeof s.auth === "object") ? s.auth : s;

    const empNo = extractEmpNo(s);
    const scopeFromSession = extractScopeId(s);

    const out = {
      isAuthed: a.isAuthed === true,

      // RBAC: roll måste vara en av cfg.ROLES
      role: normalizeRole(a.role),

      // AO-002 v1.4: om scope saknas i session => resolve via assignments
      scopeId: scopeFromSession || resolveScopeIdFromAssignments(empNo),

      // empNo (tillåtet): behövs för filter i UI-sidor (utan att logga det)
      empNo: empNo,

      expiresAt: a.expiresAt ? Number(a.expiresAt) : null,
    };

    if (out.isAuthed && !out.role) return null;
    return out;
  }

  function mustGetSession() {
    const data = readStorage(SESSION_KEY);
    if (!data || typeof data !== "object") return null;

    const auth = getAuth(data);
    if (!auth || auth.isAuthed !== true) return null;

    if (auth.expiresAt && auth.expiresAt < Date.now()) return null;

    return data; // PRC: returnera originalobjektet
  }

  // ============================================================
  // PUBLIC ROUTES (explicit) — no implicit /UI/
  // ============================================================

  function stripQueryHash(urlLike) {
    const s = String(urlLike || "");
    return s.split("#")[0].split("?")[0];
  }

  function isPublicRoute(appRelPath) {
    const cfg = getConfig();
    if (!cfg) return false;

    const p = String(appRelPath || "");
    if (!p) return false;

    return cfg.PUBLIC_ROUTES.includes(p);
  }

  // ============================================================
  // RBAC (P0) — deterministic match on normalized relative path
  // ============================================================

  function isHtmlLikeRoute(appRelPath) {
    const p = String(appRelPath || "").toLowerCase();
    if (!p) return false;
    return p === "/" || p.endsWith(".html") || p.endsWith("/");
  }

  function normalizeRelPathForCheck(inputPath) {
    const raw = stripQueryHash(inputPath);
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
    // prefix "/admin" matchar "/admin" och "/admin/..." men INTE "/adminx"
    const p = String(path || "");
    const pre = String(prefix || "");
    if (!p || !pre) return false;

    if (!p.startsWith(pre)) return false;
    if (p.length === pre.length) return true;
    return p.charAt(pre.length) === "/";
  }

  function matchRouteEntry(relPath, entryRaw) {
    // ============================================================
    // AO-002 v1.3 (PATCH): detta är fixen som gör att
    // "/admin/" betyder PREFIX och matchar "/admin/home.html"
    // ============================================================
    const rel = String(relPath || "");
    const e = String(entryRaw || "").trim();
    if (!rel || !e) return false;

    // Root exakt
    if (e === "/") return rel === "/";

    // Exakt fil (html)
    if (e.toLowerCase().endsWith(".html")) return rel === e;

    // Prefix med trailing "/" (t.ex. "/admin/") => enkel startsWith räcker
    if (e.endsWith("/")) return rel.startsWith(e);

    // Prefix utan trailing "/" (t.ex. "/admin") => root-aware
    return rootAwareStartsWith(rel, e);
  }

  function canAccessRoute(role, pathname) {
    const cfg = getConfig();
    if (!cfg) return false;

    const r = normalizeRole(role);
    if (!r) return false;

    const rel = normalizeRelPathForCheck(pathname || window.location.pathname || "");
    if (!rel) return false; // fail-closed

    // Assets ska inte blockeras av denna kontroll
    if (!isHtmlLikeRoute(rel)) return true;

    const allowed = cfg.ROUTES_BY_ROLE[r];
    if (!Array.isArray(allowed) || allowed.length === 0) return false;

    return allowed.some((entry) => matchRouteEntry(rel, entry));
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

  function redirect(url) {
    try {
      window.location.replace(String(url || "/"));
    } catch {
      window.location.href = String(url || "/");
    }
  }

  // requireAuth({ allowRoles?: [], redirectTo?: string })
  function requireAuth(opts) {
    const options = (opts && typeof opts === "object") ? opts : {};
    const allowRoles = Array.isArray(options.allowRoles) ? options.allowRoles : [];

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

    if (allowRoles.length > 0) {
      const allowed = allowRoles.map(normalizeRole).filter(Boolean);
      if (!allowed.includes(auth.role)) {
        redirect(loginUrl("forbidden"));
        return null;
      }
    }

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

    // AO-002 v1.4: scope resolver (read-only)
    resolveScopeIdFromAssignments,

    // XSS helpers
    escapeHtml,
    setText,

    // Debug
    debugLog,

    // Convenience
    logout,
  };

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
