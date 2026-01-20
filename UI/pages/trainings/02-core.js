/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-03) | FILE 02/06 | FIL-ID: UI/pages/trainings/02-core.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Core-helpers + fail-closed guards + title-motor (kapitel+steg) + AI-payload builder + Rules-catalog loader

POLICY (LÅST):
- UI-only • Fail-closed
- Ingen storage här (03-store)
- Ingen DOM-render här (05-render)
- XSS-safe: inga innerHTML
- ADMIN-only write (SYSTEM_ADMIN/MANAGER read-only)
- Logga aldrig payload (endast felkod/orsak vid behov)

PATCH v1.0.3 (PP-SC-010-03):
- P0: buildAiContext() inkluderar INTE goals som default (fail-safe). Kräver opt-in includeGoals:true.
- P1: Helpers för forbidden phrases: getForbiddenPhrases() + findForbiddenPhrase(text)
- P2: Valfri sanitizer: sanitizeForbidden(text,replacements) (deterministisk, ingen loggning)
============================================================ */
(function () {
  "use strict";

  const NS = (window.Trainings = window.Trainings || {});
  if (NS.core) return;

  const core = (NS.core = {});

  // ---------- time / ids ----------
  core.nowTs = function () { return Date.now(); };

  core.makeId = function (prefix) {
    const p = String(prefix || "id");
    return p + "_" + core.nowTs() + "_" + Math.random().toString(16).slice(2, 8);
  };

  // ---------- string helpers ----------
  core.normStr = function (v) { return String(v ?? "").trim(); };
  core.safeLower = function (v) { return core.normStr(v).toLowerCase(); };

  function upper(v) { return String(v ?? "").trim().toUpperCase(); }

  // ---------- role / auth (fail-closed) ----------
  const ROLE_ALLOW = new Set(["SYSTEM_ADMIN", "ADMIN", "MANAGER", "EMPLOYEE", "READER", "EDITOR"]);

  function normRole(v) {
    let s = String(v ?? "").trim();
    if (!s) return "";
    s = s.toUpperCase();

    // Common variants -> canonical
    if (s === "ADMINISTRATOR" || s === "ADMINISTRATÖR") return "ADMIN";
    if (s === "SYSADMIN" || s === "SYSTEMADMIN") return "SYSTEM_ADMIN";
    if (s === "MGR") return "MANAGER";
    if (s === "USER") return "EMPLOYEE";

    // Lowercase role ids
    if (s === "ADMIN") return "ADMIN";
    if (s === "MANAGER") return "MANAGER";
    if (s === "EMPLOYEE") return "EMPLOYEE";
    if (s === "READER") return "READER";
    if (s === "EDITOR") return "EDITOR";
    if (s === "SYSTEM_ADMIN") return "SYSTEM_ADMIN";

    return s;
  }

  function isValidRole(v) {
    const r = normRole(v);
    return ROLE_ALLOW.has(r);
  }

  function normEmp(v) {
    const s = core.normStr(v);
    if (!s) return "";
    if (s.length > 64) return "";
    return s;
  }

  function tryCall(fn) {
    try { return fn(); } catch (_) { return null; }
  }

  function extractRoleEmp(obj) {
    if (!obj || typeof obj !== "object") return { role: "", empNo: "" };

    // Direct candidates (tolerant but bounded)
    let role =
      obj.role ||
      obj.userRole ||
      obj.roleName ||
      obj.roleId ||
      obj.role_code ||
      obj.roleCode ||
      obj.rbacRole ||
      obj.user_role ||
      obj.userrole ||
      "";

    let empNo =
      obj.empNo ||
      obj.emp ||
      obj.employeeNo ||
      obj.employee_no ||
      obj.userId ||
      obj.user_id ||
      obj.uid ||
      obj.id ||
      "";

    const nested = [
      obj.user, obj.session, obj.auth, obj.account, obj.profile, obj.data, obj.me, obj.currentUser, obj.current_user
    ].filter(Boolean);

    for (const n of nested) {
      if ((!role || !empNo) && n && typeof n === "object") {
        role = role ||
          n.role || n.userRole || n.roleName || n.roleId || n.role_code || n.roleCode || n.rbacRole ||
          n.user_role || n.userrole || "";
        empNo = empNo ||
          n.empNo || n.emp || n.employeeNo || n.employee_no || n.userId || n.user_id || n.uid || n.id || "";
      }
      if (role && empNo) break;
    }

    role = normRole(role);
    empNo = normEmp(empNo);

    if (!isValidRole(role)) role = "";
    return { role, empNo };
  }

  function tryGetFromHRApp(HRApp) {
    const sources = [];

    // Note: requireAuth kan redirecta. Vi fångar eventuellt objekt om den returnerar ett.
    try {
      if (typeof HRApp.requireAuth === "function") {
        const maybe = tryCall(() => HRApp.requireAuth());
        if (maybe && typeof maybe === "object") sources.push(maybe);
      }
    } catch (_) {}

    try { if (typeof HRApp.getWho === "function") { const w = tryCall(() => HRApp.getWho()); if (w && typeof w === "object") sources.push(w); } } catch (_) {}
    try { if (typeof HRApp.getAuth === "function") { const a = tryCall(() => HRApp.getAuth()); if (a && typeof a === "object") sources.push(a); } } catch (_) {}
    try { if (typeof HRApp.readAuthState === "function") { const s = tryCall(() => HRApp.readAuthState()); if (s && typeof s === "object") sources.push(s); } } catch (_) {}
    try { if (typeof HRApp.mustGetSession === "function") { const s = tryCall(() => HRApp.mustGetSession()); if (s && typeof s === "object") sources.push(s); } } catch (_) {}
    try { if (typeof HRApp.getSession === "function") { const s = tryCall(() => HRApp.getSession()); if (s && typeof s === "object") sources.push(s); } } catch (_) {}
    try { if (typeof HRApp.getRole === "function") { const r = tryCall(() => HRApp.getRole()); if (r && typeof r === "object") sources.push(r); } } catch (_) {}

    try { if (HRApp.session && typeof HRApp.session === "object") sources.push(HRApp.session); } catch (_) {}
    try { if (HRApp.auth && typeof HRApp.auth === "object") sources.push(HRApp.auth); } catch (_) {}
    try { if (HRApp.user && typeof HRApp.user === "object") sources.push(HRApp.user); } catch (_) {}

    let best = { role: "", empNo: "" };
    for (const s of sources) {
      const ex = extractRoleEmp(s);
      if (ex.role && ex.empNo) return ex;
      if (ex.role && !best.role) best = ex;
    }
    return best;
  }

  core.getWho = function () {
    // Fail-closed default
    const fallback = { role: "SYSTEM_ADMIN", empNo: "", canWrite: false, authOk: false };

    try {
      const app = window.HRApp;
      if (!app) return fallback;

      const fromApp = tryGetFromHRApp(app);
      const role = fromApp.role ? normRole(fromApp.role) : "SYSTEM_ADMIN";
      const empNo = normEmp(fromApp.empNo);

      const authOk = !!(role && empNo);
      const canWrite = (role === "ADMIN" && !!empNo); // LÅST: ADMIN + empNo krävs

      return { role, empNo, canWrite, authOk };
    } catch (_) {
      return fallback;
    }
  };

  core.isAdminWriter = function (who) {
    const w = who || core.getWho();
    return (String(w.role || "").toUpperCase() === "ADMIN" && !!core.normStr(w.empNo));
  };

  // ---------- fail-closed helpers ----------
  core.fail = function (code, msg) {
    return { ok: false, code: String(code || "ERR"), err: String(msg || "Fel") };
  };

  core.ok = function (data) {
    return Object.assign({ ok: true }, data || {});
  };

  // ---------- Kursplan / titel-motor ----------
  // LÅS: Ingen ny datamodell. Vi kodar kapitel+steg i title-strängen.
  // Format (stabilt): "<KAPITEL> • Steg <N> • <OMRÅDE>"
  core.composeTitle = function (chapter, step, area) {
    const ch = core.normStr(chapter) || "Introduktion";
    const st = core.normStr(step) || "1";
    const ar = core.normStr(area) || "—";
    return `${ch} • Steg ${st} • ${ar}`;
  };

  core.parseTitle = function (title) {
    const t = core.normStr(title);
    const out = { chapter: "", step: "", area: "" };
    if (!t) return out;

    const parts = t.split("•").map((x) => core.normStr(x));
    if (parts[0]) out.chapter = parts[0];

    if (parts[1]) {
      const m = parts[1].match(/steg\s*(\d+)/i);
      out.step = m ? String(m[1]) : "";
    }
    if (parts[2]) out.area = parts[2];
    return out;
  };

  core.getStepFocus = function (step) {
    const s = Number(core.normStr(step) || "1");
    if (s <= 1) return "Förstå grunderna och känna igen rätt/fel. Enkla exempel.";
    if (s === 2) return "Tillämpa i enkla scenarier. Kortare resonemang, tydliga val.";
    if (s === 3) return "Tillämpa i vardagsnära situationer. Kombinera 2–3 begrepp.";
    if (s === 4) return "Hantera avvikelser och risker. Prioritera och motivera val.";
    return "Självständigt ansvar. Kontrollfrågor och konsekvenser. Hög kvalitet.";
  };

  core.getChapterFocus = function (chapter) {
    const ch = core.safeLower(chapter);
    if (ch.includes("introduktion")) return "Definitioner, syfte, vanliga misstag, grundregler.";
    if (ch.includes("grundläggande")) return "Basfärdighet: checklistor, enkla beslut, praktiska rutiner.";
    if (ch.includes("tillämpning")) return "Gör rätt i praktiken: scenarier, steg-för-steg.";
    if (ch.includes("analys")) return "Förstå varför: orsak–verkan, risk, kvalitet, förbättring.";
    if (ch.includes("självständigt")) return "Arbeta utan stöd: egna beslut, kontrollpunkter, ansvar.";
    if (ch.includes("fördjupning")) return "Fördjupning: svåra fall, ansvar, uppföljning, standarder.";
    return "Allmänt fokus för kapitlet.";
  };

  // ---------- AI payload builder (utan DOM/storage) ----------
  // POLICY: Skicka aldrig "Mål/goals" till AI som default.
  // Opt-in endast via buildAiContext(state,{ includeGoals:true })
  core.buildAiContext = function (state, opts) {
    const s = state || {};
    const o = (opts && typeof opts === "object") ? opts : {};
    const includeGoals = !!o.includeGoals; // default false (fail-safe)

    const module = core.normStr(s.module);
    const area = core.normStr(s.area);
    const chapter = core.normStr(s.courseTitle);
    const step = core.normStr(s.courseStep);
    const level = core.normStr(s.goalsLevel || "normal");

    const title = core.composeTitle(chapter, step, area);

    const ctx = {
      subject: { module, area },
      course: {
        chapter,
        step,
        title,
        chapterFocus: core.getChapterFocus(chapter),
        stepFocus: core.getStepFocus(step),
      },
      level, // intro|normal|advanced
    };

    // Opt-in only
    if (includeGoals) ctx.goals = core.normStr(s.goals || "");
    return ctx;
  };

  // ---------- Forbidden phrases (PRC-7) ----------
  core.forbiddenPhrases = [
    "beskriv hur du tänkte",
    "utför uppgiften",
    "lämna in",
    "mellanled",
    "reflektera",
    "diskutera",
  ];

  core.getForbiddenPhrases = function () {
    return Array.isArray(core.forbiddenPhrases) ? core.forbiddenPhrases.slice(0) : [];
  };

  core.findForbiddenPhrase = function (text) {
    const hay = core.safeLower(text);
    const list = Array.isArray(core.forbiddenPhrases) ? core.forbiddenPhrases : [];
    for (let i = 0; i < list.length; i++) {
      const p = core.safeLower(list[i]);
      if (!p) continue;
      if (hay.includes(p)) return list[i];
    }
    return "";
  };

  core.containsForbidden = function (text) {
    const hay = core.safeLower(text);
    const list = Array.isArray(core.forbiddenPhrases) ? core.forbiddenPhrases : [];
    return list.some((p) => hay.includes(core.safeLower(p)));
  };

  // Valfri deterministisk sanitizer (används bara om caller väljer det)
  core.sanitizeForbidden = function (text, replacements) {
    const src = String(text ?? "");
    if (!src) return src;

    const rep = (replacements && typeof replacements === "object") ? replacements : null;
    const list = Array.isArray(core.forbiddenPhrases) ? core.forbiddenPhrases : [];
    if (!list.length) return src;

    let out = src;
    const hayLower = core.safeLower(out);

    // Snabb exit om inget matchar
    if (!list.some((p) => hayLower.includes(core.safeLower(p)))) return src;

    // Deterministisk ersättning (enkel substring replace, case-insensitive via lower-index-scan)
    // NOTE: Vi loggar inte och vi försöker inte bevara exakt casing (policy: deterministiskt).
    for (let i = 0; i < list.length; i++) {
      const phrase = String(list[i] ?? "");
      const phLow = core.safeLower(phrase);
      if (!phLow) continue;

      const replacement = rep && Object.prototype.hasOwnProperty.call(rep, phrase)
        ? String(rep[phrase] ?? "")
        : "";

      if (!replacement) continue;

      // Replace ALL occurrences by scanning lowercased copy
      let cur = out;
      let curLow = core.safeLower(cur);
      while (true) {
        const idx = curLow.indexOf(phLow);
        if (idx < 0) break;
        cur = cur.slice(0, idx) + replacement + cur.slice(idx + phrase.length);
        curLow = core.safeLower(cur);
      }
      out = cur;
    }

    return out;
  };

  // ---------- AI result normalization ----------
  core.normalizeAiResult = function (raw) {
    const out = { items: [], blocks: [] };
    if (!raw || typeof raw !== "object") return out;

    if (Array.isArray(raw.items)) out.items = raw.items;
    if (Array.isArray(raw.blocks)) out.blocks = raw.blocks;

    if (!out.items.length && raw.data && typeof raw.data === "object") {
      if (Array.isArray(raw.data.items)) out.items = raw.data.items;
      if (Array.isArray(raw.data.blocks)) out.blocks = raw.data.blocks;
    }
    return out;
  };

  core.assert = function (cond, code, msg) {
    if (!cond) throw new Error(String(code || "ASSERT") + ":" + String(msg || "assert"));
  };

  // ---------- Rules catalog (ai-rules/v1/modules.json) ----------
  // No storage. No DOM. In-memory cache only.
  const _catalog = {
    loaded: false,
    loading: null,
    data: null,
    err: null,
    url: ""
  };

  function getBasePath() {
    // Prefer CONFIG if present (GitHub Pages BASE_PATH)
    try {
      const cfg = window.HR_CONFIG || window.__HR_CONFIG || window.HRConfig || null;
      if (cfg && typeof cfg === "object") {
        const bp = core.normStr(cfg.BASE_PATH || cfg.basePath || "");
        if (bp) return bp;
      }
    } catch (_) {}
    // Fallback: derive from location (best-effort, no assumptions about repo name)
    try {
      const p = String(location.pathname || "/");
      // Typically "/HR-System/admin/trainings.html" -> base "/HR-System"
      const parts = p.split("/").filter(Boolean);
      if (parts.length >= 2) return "/" + parts[0];
      if (parts.length === 1) return "";
    } catch (_) {}
    return "";
  }

  function buildCatalogUrl() {
    const base = getBasePath();
    // Always absolute-from-origin path (stable)
    return `${base}/ai-rules/v1/modules.json`;
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function validateCatalog(json) {
    if (!isPlainObject(json)) return core.fail("CATALOG_SHAPE", "modules.json: ogiltigt format");
    if (!Array.isArray(json.modules)) return core.fail("CATALOG_MISSING", "modules.json: saknar modules[]");

    // Minimal validation (fail-closed but tolerant)
    for (const m of json.modules) {
      if (!isPlainObject(m)) return core.fail("CATALOG_MODULE", "modules.json: module måste vara objekt");
      if (!core.normStr(m.id) || !core.normStr(m.title)) return core.fail("CATALOG_MODULE_FIELDS", "modules.json: module saknar id/title");
      if (!Array.isArray(m.areas)) return core.fail("CATALOG_AREAS", "modules.json: module.areas[] saknas");
      for (const a of m.areas) {
        if (!isPlainObject(a)) return core.fail("CATALOG_AREA", "modules.json: area måste vara objekt");
        if (!core.normStr(a.id) || !core.normStr(a.title)) return core.fail("CATALOG_AREA_FIELDS", "modules.json: area saknar id/title");
        if (!Array.isArray(a.chapters)) return core.fail("CATALOG_CHAPTERS", "modules.json: area.chapters[] saknas");
        for (const c of a.chapters) {
          if (!isPlainObject(c)) return core.fail("CATALOG_CHAPTER", "modules.json: chapter måste vara objekt");
          if (!core.normStr(c.id) || !core.normStr(c.title)) return core.fail("CATALOG_CHAPTER_FIELDS", "modules.json: chapter saknar id/title");
        }
      }
    }
    return core.ok({ data: json });
  }

  core.getCatalogUrl = function () {
    const url = buildCatalogUrl();
    _catalog.url = url;
    return url;
  };

  core.loadModulesCatalog = function (opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const force = !!o.force;

    if (_catalog.loaded && _catalog.data && !force) {
      return Promise.resolve(core.ok({ data: _catalog.data, url: _catalog.url }));
    }
    if (_catalog.loading && !force) return _catalog.loading;

    const url = buildCatalogUrl();
    _catalog.url = url;
    _catalog.err = null;

    _catalog.loading = fetch(url, { method: "GET", cache: "no-store" })
      .then((r) => {
        if (!r || !r.ok) throw new Error("HTTP_" + String(r && r.status));
        return r.json();
      })
      .then((json) => {
        const v = validateCatalog(json);
        if (!v.ok) throw new Error(v.code);
        _catalog.data = v.data;
        _catalog.loaded = true;
        return core.ok({ data: _catalog.data, url });
      })
      .catch((e) => {
        _catalog.loaded = false;
        _catalog.data = null;
        _catalog.err = String(e && e.message ? e.message : e);
        // Fail-closed but non-crashing: return ok:false so UI kan visa tydligt fel
        return core.fail("CATALOG_LOAD_FAIL", _catalog.err || "modules.json kunde inte laddas");
      })
      .finally(() => {
        _catalog.loading = null;
      });

    return _catalog.loading;
  };

  // Helpers: resolve by id OR title (tolerant)
  function findModule(data, key) {
    const k = core.safeLower(key);
    if (!k) return null;
    const mods = (data && Array.isArray(data.modules)) ? data.modules : [];
    return mods.find((m) => core.safeLower(m.id) === k) || mods.find((m) => core.safeLower(m.title) === k) || null;
  }

  function findArea(mod, key) {
    const k = core.safeLower(key);
    if (!mod || !Array.isArray(mod.areas) || !k) return null;
    return mod.areas.find((a) => core.safeLower(a.id) === k) || mod.areas.find((a) => core.safeLower(a.title) === k) || null;
  }

  core.getModuleOptions = function (catalogData) {
    const data = catalogData || _catalog.data;
    const mods = (data && Array.isArray(data.modules)) ? data.modules : [];
    return mods.map((m) => ({ id: core.normStr(m.id), title: core.normStr(m.title) }));
  };

  core.getAreaOptions = function (catalogData, moduleKey) {
    const data = catalogData || _catalog.data;
    const mod = findModule(data, moduleKey);
    if (!mod) return [];
    return (mod.areas || []).map((a) => ({ id: core.normStr(a.id), title: core.normStr(a.title) }));
  };

  core.getChapterOptions = function (catalogData, moduleKey, areaKey) {
    const data = catalogData || _catalog.data;
    const mod = findModule(data, moduleKey);
    const area = findArea(mod, areaKey);
    if (!area) return [];
    return (area.chapters || []).map((c) => ({ id: core.normStr(c.id), title: core.normStr(c.title) }));
  };

  core.getCourseOptions = function (catalogData) {
    const data = catalogData || _catalog.data;
    const courses = (data && Array.isArray(data.courses)) ? data.courses : [];
    // fallback: always return 1-5 even if missing
    if (!courses.length) {
      return [
        { id: "course_1", title: "Kurs 1", stepNumber: 1 },
        { id: "course_2", title: "Kurs 2", stepNumber: 2 },
        { id: "course_3", title: "Kurs 3", stepNumber: 3 },
        { id: "course_4", title: "Kurs 4", stepNumber: 4 },
        { id: "course_5", title: "Kurs 5", stepNumber: 5 }
      ];
    }
    return courses.map((c) => ({
      id: core.normStr(c.id),
      title: core.normStr(c.title),
      stepNumber: Number(c.stepNumber || 0) || 0
    }));
  };

  core.getDifficultyOptions = function (catalogData) {
    const data = catalogData || _catalog.data;
    const lv = (data && Array.isArray(data.difficultyLevels)) ? data.difficultyLevels : [];
    if (!lv.length) return [
      { id: "intro", title: "Lätt" },
      { id: "normal", title: "Normal" },
      { id: "advanced", title: "Svår" }
    ];
    return lv.map((x) => ({ id: core.normStr(x.id), title: core.normStr(x.title) }));
  };

  core.getOutputModes = function (catalogData) {
    const data = catalogData || _catalog.data;
    const om = (data && Array.isArray(data.outputModes)) ? data.outputModes : [];
    if (!om.length) return [
      { id: "training", title: "Utbildning" },
      { id: "document", title: "Dokument" }
    ];
    return om.map((x) => ({ id: core.normStr(x.id), title: core.normStr(x.title) }));
  };

  core.__VERSION = "v1.0.3-PP-SC-010-03";
})();
