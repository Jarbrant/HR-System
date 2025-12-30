/* ============================================================
AO-022 | FIL-ID: UI/UI-03-APP.js
Projekt: HR-System
Syfte: Central Auth Guard + Routing + Manager-policy (UI-only) — AO-019 5/8 FIX-PATCH v1.1
Kontrakt (LÅST):
- Ingen backend
- Robust guard: sessionStorage först, fallback localStorage (fail-closed)
- Inga nya storage-keys
- XSS-escape på all rendering (denna fil renderar minimalt; använd textContent om ni visar text)
Lagring (endast läs):
- AO-001_LOGIN_V1 (sessionStorage/localStorage) – session
- AO-019_ROLES_V1 (localStorage) – roller + moduler
- AO-020_ORG_V1 (localStorage) – org-träd (array eller wrapper {nodes:[...]})
- AO-020_ROLE_ASSIGNMENTS_V2 (localStorage) – assignments (empNo -> { roleId, scopeId, updatedAt })
Policy (AO-019 5/8):
K1) Rollklassning: SYSTEM_ADMIN / ADMIN / MANAGER / EMPLOYEE
K2) Routing: SYSTEM_ADMIN/ADMIN/MANAGER -> admin/*, EMPLOYEE -> employee/*, oklar -> login (fail-closed)
K3) Block: MANAGER får inte nå admin/roles.html, admin/org.html, admin/access.html. ADMIN får inte nå systemvyer. SYSTEM_ADMIN får.
K4) Scope-policy: MANAGER måste ha giltig scope. Om scope saknas/korrupt -> blockera åtgärder (fail-closed)
K5) Centralisering: Policy här. Inga duplicerade checks i sidor (sidor ska använda HRApp.* helpers)
============================================================ */

(function () {
  "use strict";

  // ---- Keys (LÅST) ----
  const SESSION_KEY = "AO-001_LOGIN_V1";
  const ROLES_KEY = "AO-019_ROLES_V1";
  const ORG_KEY = "AO-020_ORG_V1";
  const ASG_V2_KEY = "AO-020_ROLE_ASSIGNMENTS_V2";

  // ---- Org root compat (P0 hårdning): acceptera legacy root-id ----
  const ROOT_ID_PRIMARY = "org_root_v1";
  const ROOT_ID_LEGACY = "org_root";

  const MAX_ROLE_INHERIT_DEPTH = 15;
  const MAX_CHAIN_GUARD = 200;

  const ROLE_CLASS = Object.freeze({
    SYSTEM_ADMIN: "SYSTEM_ADMIN",
    ADMIN: "ADMIN",
    MANAGER: "MANAGER",
    EMPLOYEE: "EMPLOYEE",
  });

  const SCOPE_ORDER = ["none", "view", "act", "manage"];
  function normalizeScope(v) {
    const s = String(v || "none");
    return SCOPE_ORDER.includes(s) ? s : "none";
  }

  // ---- Robust path helpers (AO-019 5/8-FIX-01) ----
  function getAppRootPathname() {
    // Bygg absolut sökväg till projektroten (behåller repo-subpath på GitHub Pages).
    // Stöd: /admin/*, /employee/*, /UI/*, /index.html (root), samt "/" (directory index)
    const p = String(window.location.pathname || "/");
    const iAdmin = p.indexOf("/admin/");
    if (iAdmin >= 0) return p.slice(0, iAdmin) || "/";
    const iEmp = p.indexOf("/employee/");
    if (iEmp >= 0) return p.slice(0, iEmp) || "/";
    const iUI = p.indexOf("/UI/");
    if (iUI >= 0) return p.slice(0, iUI) || "/";

    // Om vi är på /index.html eller annan fil i root: använd katalogen före filen
    if (p.endsWith("/")) return p;
    const lastSlash = p.lastIndexOf("/");
    if (lastSlash >= 0) return p.slice(0, lastSlash) || "/";
    return "/";
  }

  function joinRoot(rootPath, relativePath) {
    const root = String(rootPath || "/").replace(/\/+$/, ""); // utan trailing /
    const rel = String(relativePath || "").replace(/^\/+/, ""); // utan leading /
    return (root ? root : "") + "/" + rel;
  }

  function absPath(relFromRoot) {
    // returnerar absolut path (utan origin). window.location.replace tar både abs/rel.
    return joinRoot(getAppRootPathname(), relFromRoot);
  }

  function loginUrl() {
    // Robust login-path från var som helst i appen
    return absPath("UI/UI-01-SKELETON.html");
  }

  function adminHomeUrl() {
    return absPath("admin/home.html");
  }

  function employeeHomeUrl() {
    return absPath("employee/home.html");
  }

  function redirect(url) {
    window.location.replace(String(url || loginUrl()));
  }

  // ---- Generic helpers ----
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
  function readRawSession() {
    const s1 = sessionStorage.getItem(SESSION_KEY);
    if (s1) return s1;
    const s2 = localStorage.getItem(SESSION_KEY);
    if (s2) return s2;
    return null;
  }

  function normalizePath(pathname) {
    const p = String(pathname || "");
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(idx + 1) : p;
  }
  function isAdminPage() {
    return String(window.location.pathname || "").includes("/admin/");
  }
  function isEmployeePage() {
    return String(window.location.pathname || "").includes("/employee/");
  }
  function isSystemAdminPageByPathname(pathname) {
    // K3 (LÅST): systemvyer blockas för ADMIN + MANAGER
    const file = normalizePath(pathname || window.location.pathname || "");
    return file === "roles.html" || file === "org.html" || file === "access.html";
  }

  // ---- Canonical empNo (AO-019 5/8-FIX-01) ----
  function canonicalEmpNo(v) {
    // Canonical: bara siffror, trimma, max 10. (behåller ev. ledande nollor internt)
    const s = String(v || "").trim();
    const digits = s.replace(/[^\d]/g, "");
    return digits ? digits.slice(0, 10) : "";
  }

  function empNoComparable(v) {
    // Read-fallback (utan nya keys): använd numerisk jämförelse genom att strippa ledande nollor.
    // OBS: används endast vid läsning/matchning, aldrig vid skrivning.
    const c = canonicalEmpNo(v);
    if (!c) return "";
    const stripped = c.replace(/^0+/, "");
    return stripped || "0";
  }

  // ---- Auth/session ----
  function getAuth() {
    const raw = readRawSession();
    if (!raw) return null;

    const data = safeParseJson(raw, null);
    if (!data?.auth?.isAuthed) return null;

    const auth = data.auth;
    if (auth.expiresAt && Number(auth.expiresAt) < Date.now()) return null;

    if (!auth.role) return null;
    return auth;
  }

  function getEmpNoFromAuth(auth) {
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
      const emp = canonicalEmpNo(c);
      if (emp) return emp;
    }
    return "";
  }

  function loadRoles() {
    const arr = safeParseLocal(ROLES_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  // ---- Org-format kompatibilitet (AO-019 5/8-FIX-01) ----
  function normalizeOrgStorageShape(raw) {
    // Stöd:
    // - array av nodes
    // - wrapper { nodes:[...] }
    // Okänt format => null (fail-closed)
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object" && Array.isArray(raw.nodes)) return raw.nodes;
    return null;
  }

  function loadOrg() {
    const raw = safeParseLocal(ORG_KEY, null);
    const nodes = normalizeOrgStorageShape(raw);
    return Array.isArray(nodes) ? nodes : []; // validateOrg avgör ok/korrupt
  }

  function loadAssignmentsV2() {
    const obj = safeParseLocal(ASG_V2_KEY, {});
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  }

  // ---- Role modules normalization (P1 fix): stöd sträng-scope + {view,act,manage} ----
  function scopeFromTriple(obj) {
    if (!obj || typeof obj !== "object") return "none";
    const v = !!obj.view;
    const a = !!obj.act;
    const m = !!obj.manage;
    if (m) return "manage";
    if (a) return "act";
    if (v) return "view";
    return "none";
  }

  function normalizeModuleValue(v) {
    if (typeof v === "string") return normalizeScope(v);
    if (typeof v === "boolean") return v ? "view" : "none";
    if (v && typeof v === "object") return scopeFromTriple(v);
    return "none";
  }

  // ---- Role effective resolver (parent -> child, child overrides) ----
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
        if (!map.has(parentId)) warnings.push("missing-inherits");
        else base = walk(parentId, depth + 1);
      }

      const next = Object.assign({}, base);

      const mods = role.modules && typeof role.modules === "object" ? role.modules : {};
      Object.keys(mods).forEach((k) => {
        next[k] = normalizeModuleValue(mods[k]);
      });

      return next;
    }

    const effective = walk(String(roleId || ""), 0);
    return { effective, warnings };
  }

  function hasModule(effectiveModules, key, minScope) {
    const eff = effectiveModules || {};
    const v = normalizeScope(eff[key]);
    const need = normalizeScope(minScope);
    return SCOPE_ORDER.indexOf(v) >= SCOPE_ORDER.indexOf(need);
  }

  function isAdminUIAllowedByModules(effectiveModules) {
    // DIAGNOSTIK ENDAST (AO-019 5/8-FIX-01):
    // Detta styr INTE routing/branch. Routing styrs av session auth.role (K1/K2).
    // Variabeln används endast för att kunna visa/diagnosticera “adminish” modulsetup i UI.
    const eff = effectiveModules || {};
    return Object.keys(eff).some((k) => k.startsWith("ADMIN_") && normalizeScope(eff[k]) !== "none");
  }

  // ---- Org validation + subtree ----
  function validateOrg(nodesRaw) {
    // nodesRaw kan vara array eller wrapper {nodes:[...]}.
    const maybeNodes = normalizeOrgStorageShape(nodesRaw);
    if (!Array.isArray(maybeNodes)) {
      return { ok: false, reason: "org-unknown-format", rootId: "", nodes: [] };
    }

    // Fail-closed: om minsta korruption => ok=false
    const nodes = maybeNodes;
    const norm = [];

    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      const id = String(n.id || "").trim();
      const name = String(n.name || "").trim();
      const parentId = n.parentId === null || n.parentId === undefined ? null : String(n.parentId).trim();
      if (!id || !name) continue;
      norm.push({ id, name, parentId });
    }

    const byId = new Map();
    const dupes = new Set();
    for (const n of norm) {
      if (byId.has(n.id)) dupes.add(n.id);
      else byId.set(n.id, n);
    }
    if (dupes.size) {
      return { ok: false, reason: "org-dupes", rootId: "", nodes: norm };
    }

    // Root = exakt 1 node med parentId null
    const roots = norm.filter((n) => n.parentId === null);
    if (roots.length !== 1) {
      return { ok: false, reason: "org-root-count", rootId: "", nodes: norm };
    }

    const rootId = roots[0].id;

    // Root-id kompat: acceptera PRIMARY eller LEGACY, eller exakt 1 root med annat id (tolerans)
    const rootCompatOk = rootId === ROOT_ID_PRIMARY || rootId === ROOT_ID_LEGACY;

    // Alla andra måste ha giltig parentId
    for (const n of norm) {
      if (n.id === rootId) continue;
      if (!n.parentId || !byId.has(n.parentId)) {
        return { ok: false, reason: "org-orphan", rootId, nodes: norm };
      }
    }

    // Loop-skydd i parent-chain
    const parentOf = new Map(norm.map((n) => [n.id, n.parentId]));
    function chainHasCycle(startId) {
      const seen = new Set();
      let cur = startId;
      let steps = 0;
      while (cur && steps < MAX_CHAIN_GUARD) {
        if (cur === rootId) return false;
        if (seen.has(cur)) return true;
        seen.add(cur);
        const p = parentOf.get(cur);
        cur = p || rootId;
        steps++;
      }
      return true;
    }

    for (const n of norm) {
      if (n.id === rootId) continue;
      if (chainHasCycle(n.id)) {
        return { ok: false, reason: "org-loop", rootId, nodes: norm };
      }
    }

    return { ok: true, reason: rootCompatOk ? "ok" : "ok-root-unknown", rootId, nodes: norm };
  }

  function buildChildrenMap(nodes, rootId) {
    const map = new Map();
    nodes.forEach((n) => map.set(n.id, []));
    nodes.forEach((n) => {
      if (n.id === rootId) return;
      const pid = n.parentId;
      if (pid && map.has(pid)) map.get(pid).push(n.id);
    });
    return map;
  }

  function computeSubtreeSet(orgNodes, rootId, scopeId) {
    const res = new Set();
    const sid = String(scopeId || "").trim();
    if (!sid) return res;

    const byId = new Map(orgNodes.map((n) => [n.id, n]));
    if (!byId.has(sid)) return res;

    const children = buildChildrenMap(orgNodes, rootId);
    const stack = [sid];
    const seen = new Set([sid]);

    while (stack.length) {
      const cur = stack.pop();
      res.add(cur);
      const kids = children.get(cur) || [];
      for (const k of kids) {
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push(k);
      }
    }
    return res;
  }

  // ---- Role classification (P0 fix): sessionRole prioriteras strikt ----
  function classifyRoleClass(access) {
    const sr = String(access?.auth?.role || "").toLowerCase().trim();
    if (sr === "systemadmin") return ROLE_CLASS.SYSTEM_ADMIN;
    if (sr === "admin") return ROLE_CLASS.ADMIN;
    if (sr === "manager") return ROLE_CLASS.MANAGER;
    return ROLE_CLASS.EMPLOYEE;
  }

  // ---- Assignment lookup with empNo fallback (AO-019 5/8-FIX-01) ----
  function lookupAssignment(assignmentsObj, canonicalEmp) {
    // Primär: exakt match på canonical string (inkl ledande nollor)
    const emp = canonicalEmpNo(canonicalEmp);
    if (!emp) return null;
    const direct = assignmentsObj ? assignmentsObj[emp] : null;
    if (direct) return direct;

    // Fallback-läsning: matcha numeriskt ("00123" == "123") utan att skapa ny key
    const want = empNoComparable(emp);
    if (!want) return null;

    const keys = assignmentsObj && typeof assignmentsObj === "object" ? Object.keys(assignmentsObj) : [];
    for (const k of keys) {
      if (empNoComparable(k) === want) {
        return assignmentsObj[k] || null;
      }
    }
    return null;
  }

  // ---- Build current access snapshot ----
  function getCurrentAccess() {
    const auth = getAuth();
    if (!auth) return { ok: false, reason: "no-auth" };

    const roles = loadRoles();
    const asg = loadAssignmentsV2();

    const empNo = getEmpNoFromAuth(auth);
    const rec = empNo ? lookupAssignment(asg, empNo) : null;

    const roleId = String(rec?.roleId || "").trim();
    const scopeId = String(rec?.scopeId || "").trim();

    const role = roleId ? roles.find((r) => String(r.id) === roleId) : null;

    const { effective, warnings } = role
      ? resolveRoleEffectiveScopes(roleId, roles)
      : { effective: {}, warnings: ["no-assignment"] };

    // DIAGNOSTIK ENDAST: styr INTE routing/branch
    const adminUIByModulesDiagnostic = isAdminUIAllowedByModules(effective);

    // Org: stöd array eller wrapper {nodes:[...]}
    const orgRaw = safeParseLocal(ORG_KEY, null);
    const orgVal = validateOrg(orgRaw);

    const scopeExists = !!scopeId && orgVal.ok && orgVal.nodes.some((n) => n.id === scopeId);
    const scopeSet = scopeExists ? computeSubtreeSet(orgVal.nodes, orgVal.rootId, scopeId) : new Set();

    const access = {
      ok: true,
      auth,
      empNo,
      assignment: rec || null,
      role: role || null,
      roleId: roleId || "",
      effectiveModules: effective,
      warnings: warnings.slice(),

      // DIAGNOSTIK ENDAST (styr inte routing):
      adminUIByModules: adminUIByModulesDiagnostic,

      scopeId: scopeId || "",
      org: {
        ok: orgVal.ok,
        reason: orgVal.reason,
        rootId: orgVal.rootId,
      },
      scopeOk: scopeExists,
      scopeSet,
      roleClass: ROLE_CLASS.EMPLOYEE,
    };

    access.roleClass = classifyRoleClass(access);

    if (!orgVal.ok) access.warnings.push("org-corrupt");
    if (orgVal.ok && orgVal.reason === "ok-root-unknown") access.warnings.push("org-root-unknown");
    if (!access.assignment) access.warnings.push("missing-assignment");
    if (access.roleId && !access.role) access.warnings.push("roleid-missing-in-roles");

    return access;
  }

  // ---- Central policy checks ----
  function canEnterAdminBranch(access) {
    return (
      access.roleClass === ROLE_CLASS.SYSTEM_ADMIN ||
      access.roleClass === ROLE_CLASS.ADMIN ||
      access.roleClass === ROLE_CLASS.MANAGER
    );
  }

  function mustBlockSystemViews(access, pathname) {
    if (!isSystemAdminPageByPathname(pathname)) return false;
    if (access.roleClass === ROLE_CLASS.SYSTEM_ADMIN) return false;
    return true;
  }

  function managerScopeFailClosed(access) {
    if (access.roleClass !== ROLE_CLASS.MANAGER) return false;
    if (!access.org.ok) return true;
    if (!access.scopeOk) return true;
    return false;
  }

  function hasAccessManage(access) {
    return hasModule(access.effectiveModules, "ACCESS_MANAGE", "manage");
  }

  // ---- Public API: requireAuth ----
  function requireAuth(opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const pageRole = String(options.pageRole || "any"); // "admin" | "employee" | "any"

    const access = getCurrentAccess();
    if (!access.ok) {
      redirect(loginUrl());
      return null;
    }

    // K3: systemvyer block
    if (mustBlockSystemViews(access, window.location.pathname)) {
      if (canEnterAdminBranch(access)) redirect(adminHomeUrl());
      else redirect(employeeHomeUrl());
      return null;
    }

    // K2: gren-policy + pageRole
    if (pageRole === "admin") {
      if (!canEnterAdminBranch(access)) {
        redirect(employeeHomeUrl());
        return null;
      }

      // MANAGER: scope måste vara ok (fail-closed)
      if (managerScopeFailClosed(access)) {
        const file = normalizePath(window.location.pathname);
        if (file !== "home.html") redirect(adminHomeUrl());
        return access;
      }

      return access;
    }

    if (pageRole === "employee") {
      return access;
    }

    return access;
  }

  // ---- Routing after login (K2) ----
  function routeAfterLogin() {
    const access = getCurrentAccess();
    if (!access.ok) {
      redirect(loginUrl());
      return;
    }

    if (canEnterAdminBranch(access)) {
      redirect(adminHomeUrl());
      return;
    }

    redirect(employeeHomeUrl());
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    redirect(loginUrl());
  }

  // ---- Scope helpers (K4) ----
  function requireManagerScope(access, opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const failRedirect = options.failRedirect;

    if (!access || !access.ok) return { ok: false, reason: "no-access" };

    if (access.roleClass !== ROLE_CLASS.MANAGER) {
      return { ok: true };
    }

    if (!access.org.ok) {
      if (failRedirect) redirect(failRedirect);
      return { ok: false, reason: "org-corrupt" };
    }
    if (!access.scopeOk) {
      if (failRedirect) redirect(failRedirect);
      return { ok: false, reason: "missing-scope" };
    }
    return { ok: true };
  }

  function isWithinScope(access, nodeId) {
    const id = String(nodeId || "").trim();
    if (!id) return false;
    if (!access || !access.ok) return false;

    if (access.roleClass === ROLE_CLASS.MANAGER) {
      if (!access.scopeOk) return false;
      return access.scopeSet instanceof Set ? access.scopeSet.has(id) : false;
    }
    return true;
  }

  // ---- Nav visibility (K3): göm systemlänkar för ADMIN/MANAGER/EMPLOYEE ----
  function isSystemAdminHref(attrHref) {
    // Breddad variant-match (AO-019 5/8-FIX-01):
    // - "./roles.html", "roles.html", "../admin/roles.html", "/admin/roles.html"
    // - med query/hash
    const raw = String(attrHref || "").trim();
    if (!raw) return false;

    // Använd endast attributets värde (inte a.href absolut) för att undvika repo-origin skillnader.
    const h = raw.split("#")[0].split("?")[0].trim();

    // Slutmatch på filnamn, med eller utan "admin/"-prefix
    return (
      /(^|\/)(admin\/)?roles\.html$/i.test(h) ||
      /(^|\/)(admin\/)?org\.html$/i.test(h) ||
      /(^|\/)(admin\/)?access\.html$/i.test(h)
    );
  }

  function applyNavVisibility(opts) {
    const access = getCurrentAccess();
    if (!access.ok) return;

    if (access.roleClass === ROLE_CLASS.SYSTEM_ADMIN) return;

    // Breddad: skanna alla länkar, hide om href pekar på systemvyer.
    const links = document.querySelectorAll("a[href]");
    links.forEach((a) => {
      const attr = a.getAttribute("href");
      if (!isSystemAdminHref(attr)) return;

      a.style.display = "none";
      a.setAttribute("aria-hidden", "true");
      a.setAttribute("tabindex", "-1");
    });

    // Bakåtkompat: om någon sida skickar egen selector så kan vi fortfarande köra den också.
    const options = opts && typeof opts === "object" ? opts : {};
    const systemLinkSelector = String(options.systemLinkSelector || "").trim();
    if (systemLinkSelector) {
      document.querySelectorAll(systemLinkSelector).forEach((a) => {
        a.style.display = "none";
        a.setAttribute("aria-hidden", "true");
        a.setAttribute("tabindex", "-1");
      });
    }
  }

  // ---- Soft auto guard ----
  (function softAutoGuard() {
    const access = getCurrentAccess();
    if (!access.ok) {
      if (isAdminPage() || isEmployeePage()) redirect(loginUrl());
      return;
    }

    // K2: om du är i admin/ men inte admin-branch => employee/home
    if (isAdminPage() && !canEnterAdminBranch(access)) {
      redirect(employeeHomeUrl());
      return;
    }

    // K3: block system pages för alla utom SYSTEM_ADMIN
    if (isAdminPage() && mustBlockSystemViews(access, window.location.pathname)) {
      redirect(adminHomeUrl());
      return;
    }

    // K4: MANAGER utan scope/korrupt org får bara vara på admin/home
    if (isAdminPage() && managerScopeFailClosed(access)) {
      const file = normalizePath(window.location.pathname);
      if (file !== "home.html") redirect(adminHomeUrl());
    }
  })();

  // ---- Exponera minimal API (LÅST) ----
  window.HRApp = {
    requireAuth,
    routeAfterLogin,
    getCurrentAccess,
    logout,
    applyNavVisibility,

    // Manager/scope-policy helpers
    requireManagerScope,
    isWithinScope,

    // Modul-check helpers
    hasModuleAccess: function (moduleKey, minScope) {
      const access = getCurrentAccess();
      if (!access.ok) return false;
      return hasModule(access.effectiveModules, String(moduleKey || ""), String(minScope || "view"));
    },
    canWriteAssignments: function () {
      const access = getCurrentAccess();
      if (!access.ok) return false;
      return hasAccessManage(access) || access.roleClass === ROLE_CLASS.SYSTEM_ADMIN;
    },

    // Diagnostik: robusta paths (för debugging i console)
    _paths: {
      appRoot: getAppRootPathname,
      loginUrl,
      adminHomeUrl,
      employeeHomeUrl,
    },
    _empNo: {
      canonical: canonicalEmpNo,
      comparable: empNoComparable,
    },
  };
})();
