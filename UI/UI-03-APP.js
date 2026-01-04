/* ============================================================
AO-002 v1.6 | FILE: UI/UI-03-APP.js
Projekt: HR-System
Syfte: CORE “hjärta” — Auth-guard, RBAC, fail-closed routing, scope-grund, XSS-helpers
Nivå: UI-only (GitHub Pages) | localStorage-first
Policy (LÅST):
- Ingen backend
- Fail-closed guards (sessionStorage → localStorage fallback)
- Ingen känslig persondata (endast empNo om det finns i session; logga ej)
- Inga nya storage-keys/datamodell utan AO (AO-002: skriver inget nytt)
- XSS-escape på allt som renderas från storage (helpers erbjuds här)

TILLÄGG (AO-ONBOARD-PLANS-01 | 1/5):
- Nya keys (exakt):
  * AO-060_PLANS_V1 (Array av Plan)
  * AO-061_PLAN_ASSIGNMENTS_V1 (Array av PlanAssignment)
- Helpers: read/validate/save/upsert (UI-only, fail-closed, inga auto-writes)
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

  // ============================================================
  // STORAGE (AO-ONBOARD-PLANS-01 LÅST) — exakt nya keys
  // ============================================================

  const PLANS_KEY = "AO-060_PLANS_V1";
  const PLAN_ASSIGNMENTS_KEY = "AO-061_PLAN_ASSIGNMENTS_V1";

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

  // STORAGE: skriv localStorage (fail-closed). Returnerar {ok, error?}
  // SCOPE: används endast av explicita save/upsert-helpers (inga auto-writes).
  function writeLocalStorageJson(key, value) {
    const k = String(key || "");
    if (!k) return { ok: false, error: "WRITE_INVALID_KEY" };

    try {
      const payload = JSON.stringify(value);
      localStorage.setItem(k, payload);
      return { ok: true };
    } catch {
      return { ok: false, error: "WRITE_FAILED" };
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
    const s = String(empRaw ?? "").trim();
    return s;
  }

  function extractEmpNo(sessionLike) {
    const s = sessionLike && typeof sessionLike === "object" ? sessionLike : null;
    if (!s) return "";

    const a = (s.auth && typeof s.auth === "object") ? s.auth : s;

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
    const me = normalizeEmpNo(empNo);
    if (!me) return "";

    const data = readLocalStorage(ASSIGNMENTS_KEY);
    if (!data) return "";

    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row || typeof row !== "object") continue;

        const rowEmp = normalizeEmpNo(row.empNo ?? row.employeeNo ?? row.emp ?? row.id ?? "");
        if (!rowEmp || rowEmp !== me) continue;

        const scope = String(row.scopeId ?? row.scope ?? row.nodeId ?? row.orgId ?? "").trim();
        if (scope) return scope;
      }
      return "";
    }

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
      role: normalizeRole(a.role),
      scopeId: scopeFromSession || resolveScopeIdFromAssignments(empNo),
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

    return data;
  }

  // ============================================================
  // PUBLIC ROUTES (explicit)
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
  // RBAC (P0)
  // ============================================================

  function isHtmlLikeRoute(appRelPath) {
    const p = String(appRelPath || "").toLowerCase();
    if (!p) return false;
    // Standard: endast .html (samt "/" och prefix "/")
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
    const p = String(path || "");
    const pre = String(prefix || "");
    if (!p || !pre) return false;

    if (!p.startsWith(pre)) return false;
    if (p.length === pre.length) return true;
    return p.charAt(pre.length) === "/";
  }

  function matchRouteEntry(relPath, entryRaw) {
    const rel = String(relPath || "");
    const e = String(entryRaw || "").trim();
    if (!rel || !e) return false;

    if (e === "/") return rel === "/";

    // Exakt fil (.html)
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
    if (!rel) return false;

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

    // Viktigt: ingen omskrivning här. Config är “sanningen”.
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
  // AO-ONBOARD-PLANS-01 (1/5) — MODELL + HELPERS (UI-only, fail-closed)
  // ============================================================

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function toInt(v) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    if (Math.floor(n) !== n) return null;
    return n;
  }

  function toTs(v) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function validatePlanItem(item) {
    if (!isPlainObject(item)) return { ok: false, error: "VALIDATION_ITEM_NOT_OBJECT" };

    const trainingId = String(item.trainingId ?? "").trim();
    const dayOffset = toInt(item.dayOffset);
    const order = toInt(item.order);
    const gateRequired = item.gateRequired;

    if (!trainingId) return { ok: false, error: "VALIDATION_ITEM_TRAININGID_REQUIRED" };
    if (dayOffset === null || dayOffset < 0) return { ok: false, error: "VALIDATION_ITEM_DAYOFFSET_INVALID" };
    if (order === null || order < 1) return { ok: false, error: "VALIDATION_ITEM_ORDER_INVALID" };
    if (typeof gateRequired !== "boolean") return { ok: false, error: "VALIDATION_ITEM_GATE_REQUIRED_BOOL" };

    return { ok: true };
  }

  function validatePlan(plan) {
    if (!isPlainObject(plan)) return { ok: false, error: "VALIDATION_PLAN_NOT_OBJECT" };

    const id = String(plan.id ?? "").trim();
    const title = String(plan.title ?? "").trim();
    const status = String(plan.status ?? "").trim();
    const createdAt = toTs(plan.createdAt);
    const updatedAt = toTs(plan.updatedAt);
    const items = plan.items;

    if (!id) return { ok: false, error: "VALIDATION_PLAN_ID_REQUIRED" };
    if (!title) return { ok: false, error: "VALIDATION_PLAN_TITLE_REQUIRED" };
    if (status !== "draft" && status !== "active" && status !== "archived") {
      return { ok: false, error: "VALIDATION_PLAN_STATUS_INVALID" };
    }
    if (createdAt === null) return { ok: false, error: "VALIDATION_PLAN_CREATEDAT_INVALID" };
    if (updatedAt === null) return { ok: false, error: "VALIDATION_PLAN_UPDATEDAT_INVALID" };
    if (!Array.isArray(items)) return { ok: false, error: "VALIDATION_PLAN_ITEMS_NOT_ARRAY" };

    // Validate items + ensure no duplicate trainingId (save-side strict)
    const seen = new Set();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const vr = validatePlanItem(it);
      if (!vr.ok) return vr;

      const tId = String(it.trainingId ?? "").trim();
      if (seen.has(tId)) return { ok: false, error: "VALIDATION_PLAN_DUP_TRAININGID" };
      seen.add(tId);
    }

    return { ok: true };
  }

  function normalizePlanForRead(plan) {
    // Read-side: tolerant + dedupe items by trainingId (keep first). NO WRITES.
    if (!isPlainObject(plan)) return null;

    const id = String(plan.id ?? "").trim();
    const title = String(plan.title ?? "").trim();
    const statusRaw = String(plan.status ?? "draft").trim();
    const status = (statusRaw === "draft" || statusRaw === "active" || statusRaw === "archived") ? statusRaw : "draft";

    const createdAt = toTs(plan.createdAt);
    const updatedAt = toTs(plan.updatedAt);

    const itemsIn = Array.isArray(plan.items) ? plan.items : [];
    const seen = new Set();
    const itemsOut = [];

    for (let i = 0; i < itemsIn.length; i++) {
      const it = itemsIn[i];
      if (!isPlainObject(it)) continue;

      const trainingId = String(it.trainingId ?? "").trim();
      if (!trainingId) continue;
      if (seen.has(trainingId)) continue;

      const dayOffset = toInt(it.dayOffset);
      const order = toInt(it.order);
      const gateRequired = (typeof it.gateRequired === "boolean") ? it.gateRequired : true;

      if (dayOffset === null || dayOffset < 0) continue;
      if (order === null || order < 1) continue;

      seen.add(trainingId);
      itemsOut.push({ trainingId, dayOffset, order, gateRequired });
    }

    // Minimal required fields for consumer: id + title (others defaulted)
    if (!id || !title) return null;
    if (createdAt === null || updatedAt === null) return null;

    return { id, title, status, createdAt, updatedAt, items: itemsOut };
  }

  function validatePlanAssignment(pa) {
    if (!isPlainObject(pa)) return { ok: false, error: "VALIDATION_PA_NOT_OBJECT" };

    const id = String(pa.id ?? "").trim();
    const empNo = normalizeEmpNo(pa.empNo);
    const planId = String(pa.planId ?? "").trim();
    const startDateTs = toTs(pa.startDateTs);
    const createdAt = toTs(pa.createdAt);
    const updatedAt = toTs(pa.updatedAt);

    if (!id || !id.startsWith("pa_")) return { ok: false, error: "VALIDATION_PA_ID_INVALID" };
    if (!empNo) return { ok: false, error: "VALIDATION_PA_EMPNO_REQUIRED" };
    if (!planId) return { ok: false, error: "VALIDATION_PA_PLANID_REQUIRED" };
    if (startDateTs === null) return { ok: false, error: "VALIDATION_PA_STARTDATE_INVALID" };
    if (createdAt === null) return { ok: false, error: "VALIDATION_PA_CREATEDAT_INVALID" };
    if (updatedAt === null) return { ok: false, error: "VALIDATION_PA_UPDATEDAT_INVALID" };

    return { ok: true };
  }

  function normalizePlanAssignmentForRead(pa) {
    if (!isPlainObject(pa)) return null;

    const id = String(pa.id ?? "").trim();
    const empNo = normalizeEmpNo(pa.empNo);
    const planId = String(pa.planId ?? "").trim();
    const startDateTs = toTs(pa.startDateTs);
    const createdAt = toTs(pa.createdAt);
    const updatedAt = toTs(pa.updatedAt);

    if (!id || !id.startsWith("pa_")) return null;
    if (!empNo || !planId) return null;
    if (startDateTs === null || createdAt === null || updatedAt === null) return null;

    return { id, empNo, planId, startDateTs, createdAt, updatedAt };
  }

  function genId(prefix) {
    // Ingen ny key. Unik via tid + random. Stabil i UI-only.
    const p = String(prefix || "id_");
    const t = Date.now();
    const r = Math.random().toString(16).slice(2, 10);
    return p + t.toString(16) + "_" + r;
  }

  function readArrayKeyOrEmpty(key) {
    // Spec: missing key => []
    // Corrupt JSON or not array => fail-closed (ok:false)
    const raw = localStorage.getItem(String(key || ""));
    if (raw === null) return { ok: true, data: [] };

    const parsed = safeJsonParse(raw);
    if (!Array.isArray(parsed)) return { ok: false, error: "CORRUPT_NOT_ARRAY" };

    return { ok: true, data: parsed };
  }

  function readPlans() {
    const res = readArrayKeyOrEmpty(PLANS_KEY);
    if (!res.ok) return { ok: false, error: "CORRUPT_PLANS" };

    const out = [];
    for (let i = 0; i < res.data.length; i++) {
      const n = normalizePlanForRead(res.data[i]);
      if (n) out.push(n);
    }
    return { ok: true, data: out };
  }

  function readPlanAssignments() {
    const res = readArrayKeyOrEmpty(PLAN_ASSIGNMENTS_KEY);
    if (!res.ok) return { ok: false, error: "CORRUPT_PLAN_ASSIGNMENTS" };

    const out = [];
    for (let i = 0; i < res.data.length; i++) {
      const n = normalizePlanAssignmentForRead(res.data[i]);
      if (n) out.push(n);
    }
    return { ok: true, data: out };
  }

  function savePlans(plansArray) {
    if (!Array.isArray(plansArray)) return { ok: false, error: "VALIDATION_PLANS_NOT_ARRAY" };

    // Save-side: strict validate each plan (including dup trainingId check)
    for (let i = 0; i < plansArray.length; i++) {
      const vr = validatePlan(plansArray[i]);
      if (!vr.ok) return vr;
    }

    return writeLocalStorageJson(PLANS_KEY, plansArray);
  }

  function savePlanAssignments(assignmentsArray) {
    if (!Array.isArray(assignmentsArray)) return { ok: false, error: "VALIDATION_PA_LIST_NOT_ARRAY" };

    // Save-side: strict validate each assignment
    for (let i = 0; i < assignmentsArray.length; i++) {
      const vr = validatePlanAssignment(assignmentsArray[i]);
      if (!vr.ok) return vr;
    }

    // En per {empNo, planId} — dedupe enforcement at save-time (fail-closed if duplicates exist)
    const seen = new Set();
    for (let i = 0; i < assignmentsArray.length; i++) {
      const a = assignmentsArray[i];
      const k = normalizeEmpNo(a.empNo) + "::" + String(a.planId ?? "").trim();
      if (seen.has(k)) return { ok: false, error: "VALIDATION_PA_DUP_EMP_PLAN" };
      seen.add(k);
    }

    return writeLocalStorageJson(PLAN_ASSIGNMENTS_KEY, assignmentsArray);
  }

  function upsertPlanAssignment(existingArray, input) {
    // En assignment per {empNo, planId}. Replace existing; update updatedAt.
    if (!Array.isArray(existingArray)) return { ok: false, error: "VALIDATION_PA_LIST_NOT_ARRAY" };

    const now = Date.now();
    const empNo = normalizeEmpNo(input && input.empNo);
    const planId = String(input && input.planId || "").trim();
    const startDateTs = toTs(input && input.startDateTs);

    if (!empNo) return { ok: false, error: "VALIDATION_PA_EMPNO_REQUIRED" };
    if (!planId) return { ok: false, error: "VALIDATION_PA_PLANID_REQUIRED" };
    if (startDateTs === null) return { ok: false, error: "VALIDATION_PA_STARTDATE_INVALID" };

    // Find existing by composite key
    let idx = -1;
    for (let i = 0; i < existingArray.length; i++) {
      const row = existingArray[i];
      if (!isPlainObject(row)) continue;
      const e = normalizeEmpNo(row.empNo);
      const p = String(row.planId ?? "").trim();
      if (e === empNo && p === planId) { idx = i; break; }
    }

    const base = (idx >= 0 && isPlainObject(existingArray[idx])) ? existingArray[idx] : null;
    const id = (base && typeof base.id === "string" && base.id.startsWith("pa_")) ? base.id : genId("pa_");
    const createdAt = (base && Number.isFinite(Number(base.createdAt))) ? Number(base.createdAt) : now;

    const next = {
      id: String(id),
      empNo: empNo,
      planId: planId,
      startDateTs: Number(startDateTs),
      createdAt: Number(createdAt),
      updatedAt: Number(now),
    };

    const vr = validatePlanAssignment(next);
    if (!vr.ok) return vr;

    const out = existingArray.slice();
    if (idx >= 0) out[idx] = next;
    else out.push(next);

    return { ok: true, data: out };
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
  // DEBUG HOOKS
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
    safeJsonParse,
    readStorage,
    mustGetSession,
    clearSession,
    getAuth,
    requireAuth,
    routeAfterLogin,
    canAccessRoute,
    hasPermission,
    getSafePathname,
    getScopeId,
    sameOrMissingScope,
    resolveScopeIdFromAssignments,
    escapeHtml,
    setText,
    debugLog,
    logout,

    // AO-ONBOARD-PLANS-01 (1/5) — public helpers (no side effects unless called)
    PLANS_KEY,
    PLAN_ASSIGNMENTS_KEY,
    readPlans,
    readPlanAssignments,
    validatePlan,
    validatePlanItem,
    validatePlanAssignment,
    savePlans,
    savePlanAssignments,
    upsertPlanAssignment,
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
