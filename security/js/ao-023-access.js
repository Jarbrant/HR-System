/* ============================================================
AO-023 | FIL-ID: security/js/ao-023-access.js
Projekt: HR-System
Syfte: Central access-resolve (roller + org + scope)
Policy:
- UI-only v1
- Ingen backend
- Ingen känslig data

============================================================ */

(function () {
  "use strict";

  /* ------------------------------
     LÅSTA keys (AO-022)
  ------------------------------ */
  const SESSION_KEY = "AO-001_LOGIN_V1";

  const ORG_KEY     = "AO-020_ORG_V1";
  const ROLES_KEY   = "AO-019_ROLES_V1";
  const ACCESS_KEY  = "AO-021_ACCESS_V1";

  // Root-id ska vara samma som org-builder använder (harmoniserat)
  const ROOT_ID = "org_root_v1";

  /* ------------------------------
     Små helpers
  ------------------------------ */
  const now = () => Date.now();

  function safeJsonParse(raw, fallback) {
    try {
      const v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function safeParseStorage(key, fallback) {
    try {
      return safeJsonParse(localStorage.getItem(key), fallback);
    } catch {
      return fallback;
    }
  }

  function normalizeEmpNo(v) {
    const s = String(v || "").trim();
    const digits = s.replace(/[^\d]/g, "");
    return digits;
  }

  function isObj(x) {
    return x && typeof x === "object" && !Array.isArray(x);
  }

  function uniq(arr) {
    const out = [];
    const seen = new Set();
    for (const x of arr || []) {
      const k = String(x);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    return out;
  }

  /* ------------------------------
     Session/auth (read-only)
  ------------------------------ */
  function readRawSession() {
    try {
      const s1 = sessionStorage.getItem(SESSION_KEY);
      if (s1) return s1;
      const s2 = localStorage.getItem(SESSION_KEY);
      if (s2) return s2;
      return null;
    } catch {
      return null;
    }
  }

  function readAuthAnyRole() {
    try {
      const raw = readRawSession();
      if (!raw) return null;
      const data = safeJsonParse(raw, null);
      if (!data?.auth?.isAuthed) return null;
      if (data.auth.expiresAt && data.auth.expiresAt < now()) return null;

      const role = String(data.auth.role || "").trim();
      if (!role) return null;

      return {
        role,
        empNo: normalizeEmpNo(data.auth.empNo),
        displayName: String(data.auth.displayName || ""),
      };
    } catch {
      return null;
    }
  }

  /* ------------------------------
     Loaders (fail-closed)
  ------------------------------ */
  function loadOrgNodes() {
    const arr = safeParseStorage(ORG_KEY, []);
    const nodes = Array.isArray(arr) ? arr : [];
    // dedupe by id (sista vinner) — men vi varnar i meta
    const byId = new Map();
    let hasDup = false;
    for (const n of nodes) {
      const id = String(n?.id || "").trim();
      if (!id) continue;
      if (byId.has(id)) hasDup = true;
      byId.set(id, {
        id,
        name: String(n?.name || ""),
        type: String(n?.type || "unit"),
        parentId: (n?.parentId === null || n?.parentId === undefined || String(n?.parentId) === "") ? null : String(n.parentId),
      });
    }
    return { list: Array.from(byId.values()), hasDup };
  }

  function buildOrgIndex(nodes) {
    const byId = new Map();
    const children = new Map();
    for (const n of nodes || []) {
      byId.set(String(n.id), n);
    }
    for (const n of nodes || []) {
      const pid = n.parentId === null ? null : String(n.parentId);
      if (pid) {
        if (!children.has(pid)) children.set(pid, []);
        children.get(pid).push(String(n.id));
      }
    }
    return { byId, children };
  }

  function detectOrgCycles(nodes) {
    // parent-cykler (uppåtpekare)
    const { byId } = buildOrgIndex(nodes);
    const seenGlobal = new Set();
    const cycles = [];

    for (const n of nodes || []) {
      const start = String(n.id);
      if (seenGlobal.has(start)) continue;

      const path = new Set();
      let cur = start;

      while (cur) {
        if (path.has(cur)) {
          cycles.push(cur);
          break;
        }
        path.add(cur);
        seenGlobal.add(cur);
        const node = byId.get(cur);
        if (!node || node.parentId === null) break;
        cur = String(node.parentId);
      }
    }

    return cycles.length ? uniq(cycles) : [];
  }

  function loadRoles() {
    const arr = safeParseStorage(ROLES_KEY, []);
    const roles = Array.isArray(arr) ? arr : [];
    const byId = new Map();
    let hasDup = false;

    for (const r of roles) {
      const id = String(r?.id || "").trim();
      if (!id) continue;
      if (byId.has(id)) hasDup = true;

      byId.set(id, {
        id,
        name: String(r?.name || id),
        inherits: r?.inherits ? String(r.inherits) : "",
        modules: isObj(r?.modules) ? r.modules : {},
      });
    }

    return { byId, hasDup };
  }

  function loadAssignments() {
    // Förväntad shape (rekommenderad):
    // [
    //   { empNo:"1234", roleId:"role_employee", scopeId:"org_root_v1", updatedAt: ... },
    //   ...
    // ]
    const arr = safeParseStorage(ACCESS_KEY, []);
    const list = Array.isArray(arr) ? arr : [];

    const byEmp = new Map();
    for (const a of list) {
      const empNo = normalizeEmpNo(a?.empNo);
      if (!empNo) continue;
      const roleId = String(a?.roleId || "").trim();
      const scopeId = String(a?.scopeId || "").trim();
      byEmp.set(empNo, { empNo, roleId, scopeId, updatedAt: Number(a?.updatedAt || a?.ts || 0) || 0 });
    }
    return { list, byEmp };
  }

  /* ------------------------------
     Modules merge + normalize
  ------------------------------ */
  function normalizeCap(cap) {
    const view = !!cap?.view;
    const act = !!cap?.act;
    const manage = !!cap?.manage;

    // manage ⇒ act ⇒ view
    const outManage = manage;
    const outAct = outManage || act;
    const outView = outAct || view;

    return { view: outView, act: outAct, manage: outManage };
  }

  function normalizeModules(mods) {
    const out = {};
    if (!isObj(mods)) return out;
    for (const k of Object.keys(mods)) {
      out[k] = normalizeCap(mods[k] || {});
    }
    return out;
  }

  function mergeModules(baseMods, addMods) {
    // Additiv union: true vinner
    // (AO-022: arv additivt om inget annat AO säger motsatsen)
    const base = normalizeModules(baseMods);
    const add  = normalizeModules(addMods);

    const keys = new Set([...Object.keys(base), ...Object.keys(add)]);
    const out = {};

    for (const k of keys) {
      const a = base[k] || { view: false, act: false, manage: false };
      const b = add[k]  || { view: false, act: false, manage: false };

      out[k] = normalizeCap({
        view: a.view || b.view,
        act: a.act || b.act,
        manage: a.manage || b.manage,
      });
    }

    return out;
  }

  /* ------------------------------
     Role resolve (inherit chain)
  ------------------------------ */
  function resolveRoleEffective(roleId, rolesById, warnings) {
    const MAX_DEPTH = 12;
    const seen = new Set();
    let depth = 0;
    let curId = String(roleId || "").trim();

    let acc = {}; // effective modules

    while (curId) {
      if (seen.has(curId)) {
        warnings.push(`role_inherit_cycle:${curId}`);
        break;
      }
      seen.add(curId);

      const role = rolesById.get(curId);
      if (!role) {
        warnings.push(`missing_role:${curId}`);
        break;
      }

      // child först, sedan parent (additivt — ordning spelar mindre roll, men vi håller konstant)
      acc = mergeModules(acc, role.modules || {});

      depth += 1;
      if (depth > MAX_DEPTH) {
        warnings.push("role_inherit_clipped:max_depth");
        break;
      }

      const parent = String(role.inherits || "").trim();
      if (!parent) break;
      curId = parent;
    }

    return { modules: acc, depth };
  }

  /* ------------------------------
     Org subtree
  ------------------------------ */
  function getSubtreeIds(scopeId, orgIndex, warnings) {
    const rootId = String(scopeId || "").trim();
    if (!rootId) return [];

    const { byId, children } = orgIndex;
    if (!byId.has(rootId)) {
      warnings.push(`missing_scope:${rootId}`);
      return [];
    }

    const out = [];
    const stack = [rootId];
    const seen = new Set();

    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) {
        warnings.push(`org_cycle_clipped:${id}`);
        continue;
      }
      seen.add(id);
      out.push(id);

      const kids = children.get(id) || [];
      for (const k of kids) stack.push(String(k));
    }

    return out;
  }

  /* ------------------------------
     Fail-closed effective access builder
  ------------------------------ */
  function failClosed(empNo, roleId, scopeRootId, warnings) {
    return {
      empNo: normalizeEmpNo(empNo),
      roleId: String(roleId || ""),
      scopeRootId: String(scopeRootId || ""),
      scopeIds: [],
      modules: {}, // tomt => allt false per modul i UI
      meta: {
        resolvedAt: now(),
        warnings: warnings || [],
        failClosed: true,
      },
    };
  }

  /* ------------------------------
     Public: resolveEffectiveAccess(empNo)
  ------------------------------ */
  function resolveEffectiveAccess(empNoInput) {
    const warnings = [];
    const empNo = normalizeEmpNo(empNoInput);

    if (!empNo) {
      warnings.push("missing_empNo");
      return failClosed("", "", "", warnings);
    }

    // Load admin data
    const orgLoad = loadOrgNodes();
    const rolesLoad = loadRoles();
    const asgLoad = loadAssignments();

    if (orgLoad.hasDup) warnings.push("org_duplicate_ids");
    if (rolesLoad.hasDup) warnings.push("roles_duplicate_ids");

    const orgCycles = detectOrgCycles(orgLoad.list);
    if (orgCycles.length) warnings.push(`org_cycles_detected:${orgCycles.length}`);

    const orgIndex = buildOrgIndex(orgLoad.list);

    // Assignment
    const asg = asgLoad.byEmp.get(empNo);
    if (!asg) {
      warnings.push("missing_assignment");
      return failClosed(empNo, "", "", warnings);
    }

    const roleId = String(asg.roleId || "").trim();
    const scopeRootId = String(asg.scopeId || "").trim() || ROOT_ID;

    if (!roleId) {
      warnings.push("missing_roleId_in_assignment");
      return failClosed(empNo, "", scopeRootId, warnings);
    }

    // Resolve role
    const roleRes = resolveRoleEffective(roleId, rolesLoad.byId, warnings);

    // Resolve subtree scope
    const scopeIds = getSubtreeIds(scopeRootId, orgIndex, warnings);

    // Fail-closed if scope missing (AO-022)
    if (!scopeIds.length) {
      warnings.push("scope_empty_fail_closed");
      return failClosed(empNo, roleId, scopeRootId, warnings);
    }

    // If role produced no modules at all, we still allow empty (UI should treat as no access)
    return {
      empNo,
      roleId,
      scopeRootId,
      scopeIds,
      modules: roleRes.modules || {},
      meta: {
        resolvedAt: now(),
        warnings,
        failClosed: false,
        roleDepth: roleRes.depth,
      },
    };
  }

  /* ------------------------------
     Convenience: currentSessionEffective()
     - läser empNo från session om möjligt
  ------------------------------ */
  function currentSessionEffective() {
    const a = readAuthAnyRole();
    if (!a?.empNo) {
      return failClosed("", "", "", ["missing_or_expired_session"]);
    }
    return resolveEffectiveAccess(a.empNo);
  }

  /* ------------------------------
     Convenience: can(modKey, level)
     level: "view" | "act" | "manage"
  ------------------------------ */
  function can(eff, modKey, level) {
    const k = String(modKey || "").trim();
    const l = String(level || "view").trim();

    if (!eff || !isObj(eff) || eff.meta?.failClosed) return false;
    const cap = eff.modules?.[k];
    if (!cap) return false;

    if (l === "manage") return !!cap.manage;
    if (l === "act") return !!cap.act;
    return !!cap.view;
  }

  /* ------------------------------
     Convenience: inScope(nodeId)
  ------------------------------ */
  function inScope(eff, nodeId) {
    const id = String(nodeId || "").trim();
    if (!eff || !Array.isArray(eff.scopeIds) || eff.meta?.failClosed) return false;
    return eff.scopeIds.includes(id);
  }

  /* ------------------------------
     Expose (global)
  ------------------------------ */
  window.HRAccessRuntime = Object.freeze({
    VERSION: "AO-023_v1",
    KEYS: Object.freeze({
      SESSION_KEY,
      ORG_KEY,
      ROLES_KEY,
      ACCESS_KEY,
      ROOT_ID,
    }),
    readAuthAnyRole,
    resolveEffectiveAccess,
    currentSessionEffective,
    can,
    inScope,
  });

  /* ============================================================
     USAGE (copy into any page’s inline JS)
     ------------------------------------------------------------
     const eff = window.HRAccessRuntime.currentSessionEffective();
     if(eff.meta.failClosed){ ... visa “ingen åtkomst” ... }
     if(window.HRAccessRuntime.can(eff, "docs", "view")) { ... }
     if(window.HRAccessRuntime.inScope(eff, "org_unit_1")) { ... }
  ============================================================ */

})();

