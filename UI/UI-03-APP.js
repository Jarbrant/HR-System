/* ============================================================
AO-022 | FIL-ID: UI/UI-03-APP.js
Projekt: HR-System
Syfte: Central Auth Guard + Routing + Manager-policy (UI-only) — AO-019 5/8 PATCH v1.0
Kontrakt (LÅST):
- Ingen backend
- Robust guard: sessionStorage först, fallback localStorage (fail-closed)
- Inga nya storage-keys
- XSS-escape på all rendering (denna fil renderar minimalt; använd textContent om ni visar text)
Lagring (endast läs):
- AO-001_LOGIN_V1 (sessionStorage/localStorage) – session
- AO-019_ROLES_V1 (localStorage) – roller + moduler
- AO-020_ORG_V1 (localStorage) – org-träd
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
  // AO-020 org.html använder "org_root_v1" i senaste klistrade fil.
  // Tidigare trådar har ibland använt "org_root". Vi accepterar båda som kompatibilitet.
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
  function redirect(url) {
    window.location.replace(url);
  }
  function defaultLoginUrl() {
    return "../UI/UI-01-SKELETON.html";
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
    // Matcha exakt filnamn i admin-mappen (minska risk för breda matchningar).
    const file = normalizePath(pathname || window.location.pathname || "");
    return file === "roles.html" || file === "org.html" || file === "access.html";
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
      const s = String(c || "").trim();
      if (!s) continue;
      const digits = s.replace(/[^\d]/g, "");
      if (digits) return digits.slice(0, 10);
    }
    return "";
  }

  function loadRoles() {
    const arr = safeParseLocal(ROLES_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function loadOrg() {
    const arr = safeParseLocal(ORG_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function loadAssignmentsV2() {
    const obj = safeParseLocal(ASG_V2_KEY, {});
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  }

  // ---- Role modules normalization (P1 fix): stöd sträng-scope + {view,act,manage} ----
  function scopeFromTriple(obj) {
    // obj kan vara {view:true, act:true, manage:false} etc.
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
    // Tillåt:
    // - "manage"/"act"/"view"/"none"
    // - {view,act,manage} boolean-triple
    // - true/false (tolka true som "view")
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
    // Definition v1: admin-UI om någon ADMIN_* modul != none
    const eff = effectiveModules || {};
    return Object.keys(eff).some((k) => k.startsWith("ADMIN_") && normalizeScope(eff[k]) !== "none");
  }

  // ---- Org validation + subtree ----
  function validateOrg(nodesRaw) {
    // Fail-closed: om minsta korruption => ok=false
    const nodes = Array.isArray(nodesRaw) ? nodesRaw : [];
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

    // Root-id kompat: acceptera PRIMARY eller LEGACY, eller exakt 1 root med annat id (tolerans),
    // men markera som warning via ok=true + warning.
    const rootCompatOk = rootId === ROOT_ID_PRIMARY || rootId === ROOT_ID_LEGACY;

    // Alla andra måste ha giltig parentId som pekar på existerande nod (ingen orphan)
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
      return true; // guard hit => treat as corruption
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
    // Returnerar Set av nodeId i scope-subtree (inkl scopeId)
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
    // K1 (LÅST): SYSTEM_ADMIN / ADMIN / MANAGER / EMPLOYEE
    // Prioritet:
    // 1) session auth.role "systemadmin" => SYSTEM_ADMIN
    // 2) session auth.role "admin" => ADMIN
    // 3) session auth.role "manager" => MANAGER
    // 4) annars => EMPLOYEE
    //
    // Heuristik på rollnamn får ALDRIG överstyra sessionRole "admin".
    const sr = String(access?.auth?.role || "").toLowerCase().trim();
    if (sr === "systemadmin") return ROLE_CLASS.SYSTEM_ADMIN;
    if (sr === "admin") return ROLE_CLASS.ADMIN;
    if (sr === "manager") return ROLE_CLASS.MANAGER;

    // Om sessionRole är oklart men moduler signalerar manager/adminish kan ni lägga heuristik,
    // men v1 policy är fail-closed: oklar => EMPLOYEE (routing + pageRole avgör).
    return ROLE_CLASS.EMPLOYEE;
  }

  // ---- Build current access snapshot ----
  function getCurrentAccess() {
    const auth = getAuth();
    if (!auth) return { ok: false, reason: "no-auth" };

    const roles = loadRoles();
    const asg = loadAssignmentsV2();
    const empNo = getEmpNoFromAuth(auth);
    const rec = empNo ? asg[empNo] : null;

    const roleId = String(rec?.roleId || "").trim();
    const scopeId = String(rec?.scopeId || "").trim();

    const role = roleId ? roles.find((r) => String(r.id) === roleId) : null;

    const { effective, warnings } = role
      ? resolveRoleEffectiveScopes(roleId, roles)
      : { effective: {}, warnings: ["no-assignment"] };

    const adminUIByModules = isAdminUIAllowedByModules(effective);

    const orgRaw = loadOrg();
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
      adminUIByModules,
      scopeId: scopeId || "",
      org: {
        ok: orgVal.ok,
        reason: orgVal.reason,
        rootId: orgVal.rootId,
      },
      scopeOk: scopeExists,
      scopeSet, // Set<string> (kan användas av sidor för filtrering)
      // Klassning görs sist:
      roleClass: ROLE_CLASS.EMPLOYEE,
    };

    access.roleClass = classifyRoleClass(access);

    // Extra policy-warnings
    if (!orgVal.ok) access.warnings.push("org-corrupt");
    if (orgVal.ok && orgVal.reason === "ok-root-unknown") access.warnings.push("org-root-unknown");
    if (!access.assignment) access.warnings.push("missing-assignment");
    if (access.roleId && !access.role) access.warnings.push("roleid-missing-in-roles");

    return access;
  }

  // ---- Central policy checks ----
  function canEnterAdminBranch(access) {
    // K2: SYSTEM_ADMIN/ADMIN/MANAGER -> admin/*
    return (
      access.roleClass === ROLE_CLASS.SYSTEM_ADMIN ||
      access.roleClass === ROLE_CLASS.ADMIN ||
      access.roleClass === ROLE_CLASS.MANAGER
    );
  }

  function mustBlockSystemViews(access, pathname) {
    // K3: MANAGER block system pages, ADMIN block system pages, SYSTEM_ADMIN allow
    if (!isSystemAdminPageByPathname(pathname)) return false;
    if (access.roleClass === ROLE_CLASS.SYSTEM_ADMIN) return false;
    return true; // ADMIN + MANAGER + EMPLOYEE block
  }

  function managerScopeFailClosed(access) {
    // K4: MANAGER måste ha giltig scope, annars blockera åtgärder (och gärna redirect från admin-sidor som kräver scope)
    if (access.roleClass !== ROLE_CLASS.MANAGER) return false;
    // Om org korrupt eller scope saknas => fail-closed
    if (!access.org.ok) return true;
    if (!access.scopeOk) return true;
    return false;
  }

  function hasAccessManage(access) {
    // AO-019 4/8: endast moduler med ACCESS_MANAGE får skriva assignments
    return hasModule(access.effectiveModules, "ACCESS_MANAGE", "manage");
  }

  // ---- Public API: requireAuth (P0 fix: returnera access-objekt, inte boolean) ----
  function requireAuth(opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const pageRole = String(options.pageRole || "any"); // "admin" | "employee" | "any"
    const loginUrl = String(options.loginUrl || defaultLoginUrl());

    const access = getCurrentAccess();
    if (!access.ok) {
      redirect(loginUrl);
      return null;
    }

    // K3: systemvyer block
    if (mustBlockSystemViews(access, window.location.pathname)) {
      // fail-closed: skicka till admin/home (om admin-branch) annars employee/home
      if (canEnterAdminBranch(access)) redirect("../admin/home.html");
      else redirect("../employee/home.html");
      return null;
    }

    // K2: gren-policy + pageRole
    if (pageRole === "admin") {
      if (!canEnterAdminBranch(access)) {
        redirect("../employee/home.html");
        return null;
      }

      // MANAGER: scope måste vara ok (fail-closed)
      if (managerScopeFailClosed(access)) {
        // Tillåt admin/home som “landningsplats”, men blocka actions (sidor ska använda requireScopeForAdminOps)
        // Om du står på annan admin-sida => tillbaka till admin/home.
        const file = normalizePath(window.location.pathname);
        if (file !== "home.html") redirect("../admin/home.html");
        return access; // access returneras så sidan kan visa tydlig lock-info
      }

      // ADMIN/SYSTEM_ADMIN: admin-branch ok
      return access;
    }

    if (pageRole === "employee") {
      // Employee-sidor kräver bara giltig session; adminish får också se employee om ni vill.
      return access;
    }

    // "any": bara session krävs
    return access;
  }

  // ---- Routing after login (K2) ----
  function routeAfterLogin() {
    const access = getCurrentAccess();
    if (!access.ok) {
      redirect(defaultLoginUrl());
      return;
    }

    if (canEnterAdminBranch(access)) {
      // Blocka systemvyer alltid via requireAuth/soft guard — landa på admin/home.
      redirect("../admin/home.html");
      return;
    }

    // EMPLOYEE
    redirect("../employee/home.html");
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    redirect(defaultLoginUrl());
  }

  // ---- Scope helpers (K4): sidor använder detta istället för egna checks ----
  function requireManagerScope(access, opts) {
    // Returnerar { ok:boolean, reason?:string }
    const options = opts && typeof opts === "object" ? opts : {};
    const failRedirect = options.failRedirect; // ex "../admin/home.html" eller null

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
    // För filtrering i admin-UI: MANAGER ser bara inom subtree.
    // ADMIN/SYSTEM_ADMIN: true.
    const id = String(nodeId || "").trim();
    if (!id) return false;
    if (!access || !access.ok) return false;

    if (access.roleClass === ROLE_CLASS.MANAGER) {
      // fail-closed: om scope saknas/korrupt => false
      if (!access.scopeOk) return false;
      return access.scopeSet instanceof Set ? access.scopeSet.has(id) : false;
    }
    return true;
  }

  // ---- Nav visibility (K3): göm systemlänkar för ADMIN/MANAGER/EMPLOYEE ----
  function applyNavVisibility(opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const systemLinkSelector =
      options.systemLinkSelector ||
      'a[href$="/roles.html"],a[href$="/org.html"],a[href$="/access.html"],a[href$="./roles.html"],a[href$="./org.html"],a[href$="./access.html"]';

    const access = getCurrentAccess();
    if (!access.ok) return;

    // SYSTEM_ADMIN: visa allt
    if (access.roleClass === ROLE_CLASS.SYSTEM_ADMIN) return;

    // Göm systemvyer för alla andra
    document.querySelectorAll(systemLinkSelector).forEach((a) => {
      a.style.display = "none";
      a.setAttribute("aria-hidden", "true");
      a.setAttribute("tabindex", "-1");
    });
  }

  // ---- Soft auto guard (hårdare policy än tidigare, men fortfarande “soft”) ----
  (function softAutoGuard() {
    const access = getCurrentAccess();
    if (!access.ok) {
      if (isAdminPage() || isEmployeePage()) redirect(defaultLoginUrl());
      return;
    }

    // K2: om du är i admin/ men inte admin-branch => employee/home
    if (isAdminPage() && !canEnterAdminBranch(access)) {
      redirect("../employee/home.html");
      return;
    }

    // K2: om du är i employee/ men admin-branch -> tillåt (v1), ingen redirect

    // K3: block system pages för alla utom SYSTEM_ADMIN
    if (isAdminPage() && mustBlockSystemViews(access, window.location.pathname)) {
      redirect("../admin/home.html");
      return;
    }

    // K4: MANAGER utan scope/korrupt org får bara vara på admin/home
    if (isAdminPage() && managerScopeFailClosed(access)) {
      const file = normalizePath(window.location.pathname);
      if (file !== "home.html") redirect("../admin/home.html");
    }
  })();

  // ---- Exponera minimal API (LÅST) ----
  window.HRApp = {
    requireAuth,           // (opts) -> access|null  ✅ (bakåtkompatibel mot sidor som vill ha “objekt”)
    routeAfterLogin,       // routing efter stam-login
    getCurrentAccess,      // debug/diagnostik + policydata
    logout,
    applyNavVisibility,

    // Manager/scope-policy helpers (används av admin-sidor för filtrering och fail-closed)
    requireManagerScope,
    isWithinScope,

    // Modul-check helpers (för t.ex. Access-sidan skriv-rätt)
    hasModuleAccess: function (moduleKey, minScope) {
      const access = getCurrentAccess();
      if (!access.ok) return false;
      return hasModule(access.effectiveModules, String(moduleKey || ""), String(minScope || "view"));
    },
    canWriteAssignments: function () {
      const access = getCurrentAccess();
      if (!access.ok) return false;
      // Systemansvarig ska alltid kunna MANAGE via moduler (AO-019 2/8).
      // ADMIN/MANAGER utan ACCESS_MANAGE => false (fail-closed).
      return hasAccessManage(access) || access.roleClass === ROLE_CLASS.SYSTEM_ADMIN;
    },
  };
})();
