/* ============================================================
AO-022 | FIL-ID: UI/UI-03-APP.js
Projekt: HR-System
Syfte: Central Auth Guard + Routing (UI-only v1)
Kontrakt:
- Ingen backend
- Robust guard: sessionStorage först, fallback localStorage (fail-closed)
- Inga nya storage-keys
Lagring (läser):
- AO-001_LOGIN_V1 (sessionStorage/localStorage) – session
- AO-019_ROLES_V1 (localStorage) – roller
- AO-020_ROLE_ASSIGNMENTS_V2 (localStorage) – assignments (empNo -> { roleId, scopeId })
Obs:
- Används av sidor för att:
  (1) blockera obehöriga,
  (2) välja “gren” (admin vs employee),
  (3) kunna gömma admin-nav om man vill (valfritt).
============================================================ */

(function () {
  "use strict";

  const SESSION_KEY = "AO-001_LOGIN_V1";
  const ROLES_KEY = "AO-019_ROLES_V1";
  const ASG_V2_KEY = "AO-020_ROLE_ASSIGNMENTS_V2";

  const MAX_ROLE_INHERIT_DEPTH = 15;

  // --- Helpers ---
  const SCOPE_ORDER = ["none", "view", "act", "manage"];

  function normalizeScope(v) {
    const s = String(v || "none");
    return SCOPE_ORDER.includes(s) ? s : "none";
  }

  function readRawSession() {
    // Robust guard: sessionStorage först, fallback localStorage
    const s1 = sessionStorage.getItem(SESSION_KEY);
    if (s1) return s1;
    const s2 = localStorage.getItem(SESSION_KEY);
    if (s2) return s2;
    return null;
  }

  function safeParseJson(raw, fallback) {
    try {
      const v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function safeParseLocal(key, fallback) {
    return safeParseJson(localStorage.getItem(key) || "null", fallback);
  }

  function redirect(url) {
    window.location.replace(url);
  }

  function getAuth() {
    // Fail-closed: om nåt är minsta fel => null
    const raw = readRawSession();
    if (!raw) return null;

    const data = safeParseJson(raw, null);
    if (!data?.auth?.isAuthed) return null;

    const auth = data.auth;
    if (auth.expiresAt && Number(auth.expiresAt) < Date.now()) return null;

    // role kan vara "admin", "systemadmin", "employee", etc.
    if (!auth.role) return null;

    return auth;
  }

  function getEmpNoFromAuth(auth) {
    // Flexibel: olika trådar kan ha olika fältnamn
    const candidates = [
      auth.empNo,
      auth.employeeNo,
      auth.empno,
      auth.userId,
      auth.username,
      auth.login,
      auth.identifier,
    ];

    for (const c of candidates) {
      const s = String(c || "").trim();
      if (!s) continue;
      // Om strängen innehåller siffror, ta bara siffror (empNo policy)
      const digits = s.replace(/[^\d]/g, "");
      if (digits) return digits.slice(0, 10);
    }
    return "";
  }

  function loadRoles() {
    const arr = safeParseLocal(ROLES_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function loadAssignmentsV2() {
    const obj = safeParseLocal(ASG_V2_KEY, {});
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  }

  // --- Role effective resolver (parent -> child, child overrides) ---
  function resolveRoleEffectiveScopes(roleId, roles) {
    const map = new Map(roles.map((r) => [String(r.id || ""), r]));
    const warnings = [];
    const seen = new Set();

    function walk(id, depth) {
      if (depth > MAX_ROLE_INHERIT_DEPTH) {
        warnings.push("depth-limit");
        return {};
      }
      if (seen.has(id)) {
        warnings.push("inherit-loop");
        return {};
      }
      seen.add(id);

      const role = map.get(id);
      if (!role) {
        warnings.push("missing-role");
        return {};
      }

      let base = {};
      const parentId = String(role.inherits || "").trim();
      if (parentId) {
        if (!map.has(parentId)) {
          warnings.push("missing-inherits");
        } else {
          base = walk(parentId, depth + 1);
        }
      }

      // merge: parent -> child (child overrides)
      const next = Object.assign({}, base);
      const mods = role.modules && typeof role.modules === "object" ? role.modules : {};
      Object.keys(mods).forEach((k) => {
        next[k] = normalizeScope(mods[k]);
      });

      return next;
    }

    const effective = walk(String(roleId || ""), 0);
    return { effective, warnings };
  }

  function isAdminishEffective(effectiveModules) {
    const eff = effectiveModules || {};
    return Object.keys(eff).some(
      (k) => k.startsWith("ADMIN_") && normalizeScope(eff[k]) !== "none"
    );
  }

  function pickLandingFromEffective(effectiveModules) {
    // Minsta “gren”-logik: om admin-moduler finns => admin/home, annars employee/home
    if (isAdminishEffective(effectiveModules)) return "../admin/home.html";
    return "../employee/home.html";
  }

  function normalizePath(pathname) {
    const p = String(pathname || "");
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(idx + 1) : p;
  }

  function isAdminPage() {
    // Enkel heuristik: ligger du i /admin/ så räknas det som adminvy
    return String(window.location.pathname || "").includes("/admin/");
  }

  function isEmployeePage() {
    return String(window.location.pathname || "").includes("/employee/");
  }

  function defaultLoginUrl() {
    return "../UI/UI-01-SKELETON.html";
  }

  // --- Public API ---
  function getCurrentAccess() {
    const auth = getAuth();
    if (!auth) return { ok: false, reason: "no-auth" };

    const roles = loadRoles();
    const asg = loadAssignmentsV2();

    const empNo = getEmpNoFromAuth(auth);
    const rec = empNo ? asg[empNo] : null;

    const roleId = String(rec?.roleId || "").trim();
    const scopeId = String(rec?.scopeId || "").trim();

    // Om ingen assignment finns: fail-soft i UI (men access guard fail-closed per pageRole)
    const role = roleId ? roles.find((r) => String(r.id) === roleId) : null;

    const { effective, warnings } = role
      ? resolveRoleEffectiveScopes(roleId, roles)
      : { effective: {}, warnings: ["no-assignment"] };

    const adminish = isAdminishEffective(effective);

    return {
      ok: true,
      auth,
      empNo,
      assignment: rec || null,
      role: role || null,
      effectiveModules: effective,
      warnings,
      adminish,
      // scopeId används senare av vyer (subtree)
      scopeId: scopeId || "",
    };
  }

  function requireAuth(opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const pageRole = String(options.pageRole || "any"); // "admin" | "employee" | "any"
    const loginUrl = String(options.loginUrl || defaultLoginUrl());

    const access = getCurrentAccess();
    if (!access.ok) {
      redirect(loginUrl);
      return false;
    }

    // Rollkrav (fail-closed)
    if (pageRole === "admin") {
      // Kräver att sessionens auth.role är admin/systemadmin OCH att rollen är adminish
      const roleOk =
        access.auth.role === "admin" || access.auth.role === "systemadmin";
      if (!roleOk || !access.adminish) {
        // Om du inte ska vara här => skicka till employee/home
        redirect("../employee/home.html");
        return false;
      }
    }

    if (pageRole === "employee") {
      // Om du är adminish kan du fortfarande läsa employee, men kräver giltig session
      // (Inget extra krav)
    }

    return true;
  }

  function routeAfterLogin() {
    // Kallas efter lyckad inloggning från UI-01-SKELETON.html (stam-login)
    const access = getCurrentAccess();
    if (!access.ok) {
      redirect(defaultLoginUrl());
      return;
    }

    // Om assignments saknas men auth.role är admin/systemadmin: gå admin ändå
    if (
      (access.auth.role === "admin" || access.auth.role === "systemadmin") &&
      access.adminish
    ) {
      redirect("../admin/home.html");
      return;
    }

    // Om admin/systemadmin men inga roller/assignments än: fail-safe => admin/home
    if (access.auth.role === "admin" || access.auth.role === "systemadmin") {
      redirect("../admin/home.html");
      return;
    }

    // Annars: employee
    redirect("../employee/home.html");
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    redirect(defaultLoginUrl());
  }

  function applyNavVisibility(opts) {
    // Valfritt: göm adminlänkar för icke-adminish
    const options = opts && typeof opts === "object" ? opts : {};
    const adminLinkSelector = options.adminLinkSelector || 'a[href*="/admin/"], a[href^="./"][href*="admin"], a[href*="./roles.html"], a[href*="./org.html"], a[href*="./access.html"]';

    const access = getCurrentAccess();
    if (!access.ok) return;

    const isAdminish = access.adminish && (access.auth.role === "admin" || access.auth.role === "systemadmin");

    if (isAdminish) return; // visa allt

    document.querySelectorAll(adminLinkSelector).forEach((a) => {
      // fail-safe: om länken uttryckligen pekar på admin-område, göm den
      a.style.display = "none";
      a.setAttribute("aria-hidden", "true");
      a.setAttribute("tabindex", "-1");
    });
  }

  // --- Auto-guard (om någon inkluderar filen utan att kalla requireAuth) ---
  // Vi gör INTE hård redirect här, bara om du redan står på admin/employee.
  // Detta minskar “överraskningar” och passar v1.
  (function softAutoGuard() {
    const access = getCurrentAccess();
    if (!access.ok) {
      if (isAdminPage() || isEmployeePage()) redirect(defaultLoginUrl());
      return;
    }
    // Om du är på admin-sida men inte adminish: redirect fail-closed
    if (isAdminPage()) {
      const roleOk =
        access.auth.role === "admin" || access.auth.role === "systemadmin";
      if (!roleOk || !access.adminish) {
        redirect("../employee/home.html");
      }
    }
  })();

  // Exponera minimal API
  window.HRApp = {
    requireAuth,
    routeAfterLogin,
    getCurrentAccess,
    logout,
    applyNavVisibility,
  };
})();
