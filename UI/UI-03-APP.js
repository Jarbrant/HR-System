/* ============================================================
AO-002 v1.7 (PATCH) + AO-AUTH-PIN-V1 (TEST) | FILE: UI/UI-03-APP.js
Projekt: HR-System
Syfte: CORE “hjärta” — Auth-guard, RBAC, fail-closed routing, scope-grund, XSS-helpers
Nivå: UI-only (GitHub Pages) | localStorage-first

Policy (LÅST):
- Ingen backend
- Fail-closed guards (sessionStorage → localStorage fallback)
- Ingen känslig persondata (endast empNo om det finns i session; logga ej)
- Inga nya storage-keys/datamodell utan AO

AO-AUTH-PIN-V1 (TEST) — TILLÅTET I DENNA PATCH:
- Uppgraderar auth till PIN-verify (PBKDF2 via WebCrypto) + session TTL + enkel lockout
- Skapar/uppdaterar endast befintlig session-key: AO-001_LOGIN_V1 (session)
- Ny key (lokal audit, UI-only): AO-091_AUDIT_LOG_V1  (ringbuffer, ej manipulationssäker)
- Ny key (lockout state, session): AO-090_AUTH_STATE_V1 (sessionStorage)

TILLÄGG (AO-ONBOARD-PLANS-01 | 1/5):
- Nya keys (exakt):
  * AO-060_PLANS_V1 (Array av Plan)
  * AO-061_PLAN_ASSIGNMENTS_V1 (Array av PlanAssignment)
- Helpers: read/validate/save/upsert (UI-only, fail-closed, inga auto-writes)

TILLÄGG (MASTER-AO-WORKER-STACK-01 | 1/2):
- Runtime-only Worker Config Banner (SYSTEM_ADMIN-only)
- Ingen storage, ingen token, init av HRWorkerSDK om den är laddad
============================================================ */

(function () {
  "use strict";

  // ============================================================
  // STORAGE (CORE)
  // ============================================================

  // STORAGE: Återanvänd exakt befintlig session-nyckel.
  const SESSION_KEY = "AO-001_LOGIN_V1";

  // STORAGE: Befintliga nycklar (läsning endast)
  const ASSIGNMENTS_KEY = "AO-020_ROLE_ASSIGNMENTS_V2";

  // ============================================================
  // STORAGE (AO-AUTH-PIN-V1) — nya keys (tillåtna av AO)
  // ============================================================

  // AUTH-state (felräknare + lockout) i sessionStorage (mer privat än localStorage)
  const AUTH_STATE_KEY = "AO-090_AUTH_STATE_V1";

  // Audit-logg i localStorage (UI-only, ringbuffer). Logga ALDRIG empNo.
  const AUDIT_LOG_KEY = "AO-091_AUDIT_LOG_V1";

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

  // STORAGE: skriv sessionStorage (fail-closed).
  function writeSessionStorageJson(key, value) {
    const k = String(key || "");
    if (!k) return { ok: false, error: "WRITE_INVALID_KEY" };

    try {
      const payload = JSON.stringify(value);
      sessionStorage.setItem(k, payload);
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
    if (typeof c.BASE_PATH !== "string") return null;

    return c;
  }

  // ============================================================
  // PATH NORMALIZATION (P0) — getSafePathname()
  // ============================================================

  function decodeOnceSafe(s) {
    try { return decodeURIComponent(String(s || "")); } catch { return String(s || ""); }
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
    const b = String(basePath || "").trim();
    if (!b) return "";
    const withSlash = ensureLeadingSlash(b);
    return withSlash.replace(/\/+$/, "");
  }

  function trimBasePath(pathname, basePath) {
    const p = String(pathname || "");
    const b = normalizeBasePath(basePath);

    if (!b) return p;
    if (p === b) return "/";
    if (p.startsWith(b + "/")) return p.slice(b.length) || "/";
    return p;
  }

  function hasDotDotSegment(p) {
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
    return String(empRaw ?? "").trim();
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

  // GUARD/COMPAT: stöd både scopeIds[] (V2) och scopeId (legacy)
  function pickFirstScopeIdFromRow(row) {
    if (!row || typeof row !== "object") return "";

    // V2: scopeIds kan vara array
    const sArr = row.scopeIds ?? row.scopes ?? row.orgIds ?? null;
    if (Array.isArray(sArr) && sArr.length > 0) {
      for (let i = 0; i < sArr.length; i++) {
        const v = String(sArr[i] ?? "").trim();
        if (v) return v;
      }
    }

    // Legacy: scopeId
    const single = String(row.scopeId ?? row.scope ?? row.nodeId ?? row.orgId ?? "").trim();
    return single || "";
  }

  function resolveScopeIdFromAssignments(empNo) {
    const me = normalizeEmpNo(empNo);
    if (!me) return "";

    const data = readLocalStorage(ASSIGNMENTS_KEY);
    if (!data) return "";

    // Array-form: [{empNo, roleId, scopeIds:[...]}] eller legacy scopeId
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row || typeof row !== "object") continue;

        const rowEmp = normalizeEmpNo(row.empNo ?? row.employeeNo ?? row.emp ?? row.id ?? "");
        if (!rowEmp || rowEmp !== me) continue;

        const scope = pickFirstScopeIdFromRow(row);
        if (scope) return scope;
      }
      return "";
    }

    // Objekt-form: kan vara map by empNo eller {byEmpNo:{...}}
    if (typeof data === "object") {
      const direct = data[me];

      if (direct && typeof direct === "object") {
        const scope = pickFirstScopeIdFromRow(direct);
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
          const scope = pickFirstScopeIdFromRow(row);
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

    if (e.toLowerCase().endsWith(".html")) return rel === e;

    if (e.endsWith("/")) return rel.startsWith(e);

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

    return absPathFromApp(appRel);
  }

  // ============================================================
  // AUTH (AO-AUTH-PIN-V1) — PIN verify + session TTL + lockout (UI-only)
  // ============================================================

  function getAuthPolicy() {
    const cfg = getConfig();
    if (!cfg || !cfg.AUTH || typeof cfg.AUTH !== "object") return null;
    return cfg.AUTH;
  }

  function readAuthState() {
    const s = safeJsonParse(sessionStorage.getItem(AUTH_STATE_KEY) || "");
    if (!s || typeof s !== "object") return { failed: 0, lockedUntil: 0 };
    return {
      failed: Number(s.failed) || 0,
      lockedUntil: Number(s.lockedUntil) || 0,
    };
  }

  function writeAuthState(next) {
    const v = {
      failed: Number(next && next.failed) || 0,
      lockedUntil: Number(next && next.lockedUntil) || 0,
    };
    return writeSessionStorageJson(AUTH_STATE_KEY, v);
  }

  function clearAuthState() {
    try { sessionStorage.removeItem(AUTH_STATE_KEY); } catch {}
  }

  function isLockedOutNow() {
    const pol = getAuthPolicy();
    if (!pol || !pol.SESSION) return false;

    const st = readAuthState();
    return st.lockedUntil && st.lockedUntil > Date.now();
  }

  function recordFailedAttempt() {
    const pol = getAuthPolicy();
    if (!pol || !pol.SESSION) return;

    const st = readAuthState();
    const max = Number(pol.SESSION.maxFailedAttempts) || 8;
    const lockMs = Number(pol.SESSION.lockoutMs) || 60000;

    const failed = (Number(st.failed) || 0) + 1;

    // Kort, rakt: lås efter max försök
    const lockedUntil = failed >= max ? (Date.now() + lockMs) : (Number(st.lockedUntil) || 0);
    writeAuthState({ failed, lockedUntil });
  }

  function recordSuccessfulLogin() {
    // Reset lockout state efter lyckad login
    clearAuthState();
  }

  function bytesToHex(buf) {
    const b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : (buf instanceof Uint8Array ? buf : null);
    if (!b) return "";
    let out = "";
    for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
    return out;
  }

  async function pbkdf2Hex(pin, salt, iterations, dkLenBytes) {
    // WebCrypto-only: funkar i moderna browsers
    try {
      if (!window.crypto || !window.crypto.subtle) return "";

      const enc = new TextEncoder();
      const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(String(pin || "")),
        "PBKDF2",
        false,
        ["deriveBits"]
      );

      const bits = await window.crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: enc.encode(String(salt || "")),
          iterations: Number(iterations) || 120000,
          hash: "SHA-256",
        },
        keyMaterial,
        (Number(dkLenBytes) || 32) * 8
      );

      return bytesToHex(bits);
    } catch {
      // Fail-closed: crypto-fel ska bara ge tomt (som leder till AUTH_CRYPTO_UNAVAILABLE)
      return "";
    }
  }

  async function verifyPinForRole(role, pin) {
    const cfg = getConfig();
    const pol = getAuthPolicy();
    if (!cfg || !pol || !pol.PIN_HASHES_BY_ROLE || !pol.PBKDF2) return { ok: false, error: "AUTH_CONFIG_MISSING" };

    const r = normalizeRole(role);
    if (!r) return { ok: false, error: "AUTH_ROLE_INVALID" };

    if (isLockedOutNow()) return { ok: false, error: "AUTH_LOCKED" };

    const rec = pol.PIN_HASHES_BY_ROLE[r];
    if (!rec || typeof rec !== "object") return { ok: false, error: "AUTH_ROLE_NO_HASH" };

    const salt = String(rec.salt || "");
    const expected = String(rec.hashHex || "").toLowerCase();
    if (!salt || !expected) return { ok: false, error: "AUTH_HASH_INVALID" };

    const got = await pbkdf2Hex(
      String(pin || ""),
      salt,
      Number(pol.PBKDF2.iterations) || 120000,
      Number(pol.PBKDF2.dkLenBytes || pol.PBKDF2.dkLen || 32) || 32
    );

    // Fail-closed om crypto saknas
    if (!got) {
      recordFailedAttempt();
      return { ok: false, error: "AUTH_CRYPTO_UNAVAILABLE" };
    }

    if (got !== expected) {
      recordFailedAttempt();
      return { ok: false, error: "AUTH_PIN_BAD" };
    }

    recordSuccessfulLogin();
    return { ok: true };
  }

  function buildSessionPayload(role, empNo, scopeId) {
    const pol = getAuthPolicy();
    const ttl = pol && pol.SESSION ? (Number(pol.SESSION.ttlMs) || 0) : 0;

    const now = Date.now();
    const expiresAt = ttl > 0 ? (now + ttl) : null;

    return {
      // Kort: vi behåller befintlig form “auth: {}” så resten inte brister.
      auth: {
        isAuthed: true,
        role: normalizeRole(role),
        empNo: normalizeEmpNo(empNo),
        scopeId: String(scopeId || "").trim(),
        expiresAt: expiresAt,
      },
    };
  }

  function saveSession(sessionObj) {
    // Säkrast: sessionStorage. (readStorage kan fortfarande läsa localStorage fallback om ni redan gör det.)
    return writeSessionStorageJson(SESSION_KEY, sessionObj);
  }

  // AUDIT (UI-only) — logga aldrig empNo/persondata
  function sanitizeAuditMeta(meta) {
    if (!meta || typeof meta !== "object") return null;

    const out = {};
    const keys = Object.keys(meta);

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const low = String(k).toLowerCase();

      // Blockera allt som ser ut som person/emp/id
      if (low.includes("emp") || low.includes("person") || low.includes("id") || low.includes("ssn") || low.includes("email") || low.includes("phone")) {
        continue;
      }

      const v = meta[k];

      // Bara primitiva typer
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out[k] = v;
      }
    }

    return Object.keys(out).length ? out : null;
  }

  function auditAppend(action, meta) {
    const cfg = getConfig();
    if (!cfg) return;

    const now = Date.now();
    const safeAction = String(action || "").trim().slice(0, 64);
    if (!safeAction) return;

    // Minimal, utan identitet. (UI-only = ej manipulationssäker)
    const entry = {
      ts: now,
      action: safeAction,
      // meta får inte innehålla empNo/person-id. Vi filtrerar hårt.
      meta: sanitizeAuditMeta(meta),
    };

    try {
      const raw = localStorage.getItem(AUDIT_LOG_KEY);
      const parsed = safeJsonParse(raw || "");
      const arr = Array.isArray(parsed) ? parsed : [];
      arr.push(entry);

      // Ringbuffer max 200
      const max = 200;
      const out = arr.length > max ? arr.slice(arr.length - max) : arr;

      localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(out));
    } catch {
      // Fail-closed: vi blockerar inte flödet pga audit-fel
    }
  }

  // PUBLIC login helper (async)
  async function pinLogin(role, pin, empNo, scopeId) {
    // 1) verify PIN
    const vr = await verifyPinForRole(role, pin);
    if (!vr.ok) return vr;

    // 2) scope: om scopeId saknas, försök resolve, annars ev test-default (fail-closed i nästa steg)
    const authRole = normalizeRole(role);
    const me = normalizeEmpNo(empNo);
    const resolvedScope = String(scopeId || "").trim() || resolveScopeIdFromAssignments(me);

    // 3) Om fortfarande saknas: använd TEST_DEFAULT_SCOPE_ID (endast i test), annars fail-closed
    let finalScope = resolvedScope;
    if (!finalScope) {
      const pol = getAuthPolicy();
      const testScope = pol ? String(pol.TEST_DEFAULT_SCOPE_ID || "").trim() : "";
      finalScope = testScope || "";
    }

    // Fail-closed: role måste finnas
    if (!authRole) return { ok: false, error: "AUTH_ROLE_INVALID" };

    const sess = buildSessionPayload(authRole, me, finalScope);
    const wr = saveSession(sess);
    if (!wr.ok) return { ok: false, error: "AUTH_SESSION_WRITE_FAILED" };

    auditAppend("AUTH_LOGIN_OK", { role: authRole }); // meta filtreras, men role är OK
    return { ok: true, session: sess };
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
    const p = String(prefix || "id_");
    const t = Date.now();
    const r = Math.random().toString(16).slice(2, 10);
    return p + t.toString(16) + "_" + r;
  }

  function readArrayKeyOrEmpty(key) {
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

    for (let i = 0; i < plansArray.length; i++) {
      const vr = validatePlan(plansArray[i]);
      if (!vr.ok) return vr;
    }

    return writeLocalStorageJson(PLANS_KEY, plansArray);
  }

  function savePlanAssignments(assignmentsArray) {
    if (!Array.isArray(assignmentsArray)) return { ok: false, error: "VALIDATION_PA_LIST_NOT_ARRAY" };

    for (let i = 0; i < assignmentsArray.length; i++) {
      const vr = validatePlanAssignment(assignmentsArray[i]);
      if (!vr.ok) return vr;
    }

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
    if (!Array.isArray(existingArray)) return { ok: false, error: "VALIDATION_PA_LIST_NOT_ARRAY" };

    const now = Date.now();
    const empNo = normalizeEmpNo(input && input.empNo);
    const planId = String((input && input.planId) || "").trim();
    const startDateTs = toTs(input && input.startDateTs);

    if (!empNo) return { ok: false, error: "VALIDATION_PA_EMPNO_REQUIRED" };
    if (!planId) return { ok: false, error: "VALIDATION_PA_PLANID_REQUIRED" };
    if (startDateTs === null) return { ok: false, error: "VALIDATION_PA_STARTDATE_INVALID" };

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
    auditAppend("AUTH_LOGOUT", {});
    redirect(loginUrl("logout"));
  }

  // ============================================================
  // MASTER-AO-WORKER-STACK-01 — WORKER CONFIG BANNER (runtime only)
  // POLICY: no storage, no token storage, XSS-safe, SYSTEM_ADMIN-only
  // ============================================================

  function __hrGetSessionRoleId(session) {
    try {
      if (!session || typeof session !== "object") return "";
      if (session.auth && typeof session.auth === "object" && typeof session.auth.role === "string") return session.auth.role;
      if (typeof session.roleId === "string") return session.roleId;
      if (typeof session.role === "string") return session.role;
      return "";
    } catch {
      return "";
    }
  }

  function __hrIsSystemAdminSession() {
    try {
      if (!window.HRApp || typeof window.HRApp.mustGetSession !== "function") return false;
      const s = window.HRApp.mustGetSession();
      const r = __hrGetSessionRoleId(s);
      return r === "SYSTEM_ADMIN";
    } catch {
      return false;
    }
  }

  function __hrValidWorkerBaseUrl(input) {
    const v = String(input || "").trim();
    if (!v) return { ok: false, value: "", error: "Tom URL" };
    if (!/^https:\/\/[^/\s]+/i.test(v)) return { ok: false, value: "", error: "Måste börja med https://" };
    if (/\/$/.test(v)) return { ok: false, value: "", error: "Får inte sluta med /" };
    return { ok: true, value: v, error: "" };
  }

  function __hrEnsureWorkerDefaults() {
    if (typeof window.__HR_WORKER_REQUIRE_AUTH !== "boolean") {
      window.__HR_WORKER_REQUIRE_AUTH = false; // default enligt AO
    }
  }

  function __hrUpdateWorkerBannerStatus(statusEl, kind, text) {
    if (!statusEl) return;
    statusEl.className = "muted2 small";
    if (kind === "ok") statusEl.className = "message ok";
    if (kind === "err") statusEl.className = "message err";
    statusEl.textContent = String(text || "");
  }

  function __hrTryInitWorkerSdk(baseUrl) {
    __hrEnsureWorkerDefaults();

    // GUARD: Om SDK inte är laddad, fail-closed men utan crash
    if (!window.HRWorkerSDK || typeof window.HRWorkerSDK.init !== "function") {
      return { ok: false, error: "HRWorkerSDK saknas (ladda UI-04-WORKER-SDK.js före UI-03-APP.js)" };
    }

    // Init utan token (token lagras aldrig här)
    const res = window.HRWorkerSDK.init({
      baseUrl: baseUrl,
      requireAuth: window.__HR_WORKER_REQUIRE_AUTH === true,
      getToken: function () { return ""; }
    });

    if (!res || res.ok !== true) return { ok: false, error: "SDK init misslyckades" };
    return { ok: true };
  }

  function __hrInjectWorkerConfigBanner() {
    // Endast SYSTEM_ADMIN
    if (!__hrIsSystemAdminSession()) return;

    const body = document.body;
    if (!body) return;

    // Undvik dubbla banners
    if (document.getElementById("__hrWorkerBanner")) return;

    __hrEnsureWorkerDefaults();

    // UI
    const wrap = document.createElement("div");
    wrap.id = "__hrWorkerBanner";
    wrap.className = "card";
    wrap.style.maxWidth = "1100px";
    wrap.style.margin = "12px auto";
    wrap.style.padding = "10px 12px";

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "10px";
    row.style.flexWrap = "wrap";
    row.style.alignItems = "center";

    const label = document.createElement("div");
    label.className = "muted2 small";
    label.textContent = "Worker URL (v1)";

    const input = document.createElement("input");
    input.type = "url";
    input.inputMode = "url";
    input.autocomplete = "off";
    input.placeholder = "https://… (utan / på slutet)";
    input.style.minWidth = "320px";
    input.style.flex = "1";

    if (typeof window.__HR_WORKER_BASE_URL === "string" && window.__HR_WORKER_BASE_URL.trim()) {
      input.value = window.__HR_WORKER_BASE_URL.trim();
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Använd";

    const status = document.createElement("div");
    status.className = "muted2 small";
    status.style.marginTop = "8px";

    if (typeof window.__HR_WORKER_BASE_URL === "string" && window.__HR_WORKER_BASE_URL.trim()) {
      __hrUpdateWorkerBannerStatus(status, "ok", "Aktiv: URL satt (runtime).");
    } else {
      __hrUpdateWorkerBannerStatus(status, "", "Ej satt.");
    }

    btn.addEventListener("click", function () {
      const v = __hrValidWorkerBaseUrl(input.value);
      if (!v.ok) {
        __hrUpdateWorkerBannerStatus(status, "err", "Fel: " + v.error);
        return;
      }

      // Runtime-only (ingen storage)
      window.__HR_WORKER_BASE_URL = v.value;

      const initRes = __hrTryInitWorkerSdk(window.__HR_WORKER_BASE_URL);
      if (!initRes.ok) {
        __hrUpdateWorkerBannerStatus(status, "err", "Fel: " + initRes.error);
        return;
      }

      __hrUpdateWorkerBannerStatus(status, "ok", "Aktiv: SDK initierad (runtime).");
    });

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(btn);
    wrap.appendChild(row);
    wrap.appendChild(status);

    body.insertBefore(wrap, body.firstChild);
  }

  function __hrBootWorkerBanner() {
    try {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", __hrInjectWorkerConfigBanner);
      } else {
        __hrInjectWorkerConfigBanner();
      }
    } catch {
      // fail-closed: gör inget
    }
  }

  // Kör banner-boot (ingen effekt om inte SYSTEM_ADMIN)
  __hrBootWorkerBanner();

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

    // AO-AUTH-PIN-V1 (TEST) — explicit login helper (async)
    AUTH_STATE_KEY,
    AUDIT_LOG_KEY,
    pinLogin,              // (role, pin, empNo, scopeId) => {ok, session?}
    verifyPinForRole,      // (role, pin) => {ok}
    isLockedOutNow,        // () => boolean
    readAuthState,         // () => {failed, lockedUntil}

    // AO-ONBOARD-PLANS-01 (1/5)
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
