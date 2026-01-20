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

PATCH v1.0.3 (PP-SC-010-03) – CATALOG-SHAPE-FIX (fail-closed):
- P0 FIX: Stöd för modules.json som använder label (inte title) + catalogs.chapters + areas[].chapterIds.
- P0 FIX: Normaliserar katalogen i minnet så UI inte tappar kedjan Modul→Område→Kapitel→Steg.
- P0 FIX: getCourseOptions kan läsa catalogs.steps (Kurs 1..5) från samma fil.
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

    // Canonical
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
  core.buildAiContext = function (state) {
    const s = state || {};
    const module = core.normStr(s.module);
    const area = core.normStr(s.area);
    const chapter = core.normStr(s.courseTitle);
    const step = core.normStr(s.courseStep);
    const level = core.normStr(s.goalsLevel || "normal");

    const title = core.composeTitle(chapter, step, area);

    return {
      subject: { module, area },
      course: {
        chapter,
        step,
        title,
        chapterFocus: core.getChapterFocus(chapter),
        stepFocus: core.getStepFocus(step),
      },
      level, // intro|normal|advanced
      goals: core.normStr(s.goals || ""),
    };
  };

  core.forbiddenPhrases = [
    "beskriv hur du tänkte",
    "utför uppgiften",
    "lämna in",
    "mellanled",
    "reflektera",
    "diskutera",
  ];

  core.containsForbidden = function (text) {
    const hay = core.safeLower(text);
    return core.forbiddenPhrases.some((p) => hay.includes(core.safeLower(p)));
  };

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
    data: null,      // normalized (stable for UI)
    raw: null,       // raw json (debug/compat)
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

  // GUARD: acceptera både {title} och {label} – fail-closed om id saknas.
  function pickTitle(obj) {
    if (!obj || typeof obj !== "object") return "";
    return core.normStr(obj.title || obj.label || obj.name || "");
  }

  function pickId(obj) {
    if (!obj || typeof obj !== "object") return "";
    return core.normStr(obj.id || "");
  }

  // Bygg en stabil normaliserad struktur:
  // data.modules[{id,title,areas[{id,title,chapters[{id,title}]}]}]
  function normalizeCatalog(json) {
    const norm = {
      version: core.normStr(json && json.version),
      type: core.normStr(json && json.type) || "catalog",
      name: core.normStr(json && json.name) || "modules",
      constraints: isPlainObject(json && json.constraints) ? json.constraints : {},
      catalogs: isPlainObject(json && json.catalogs) ? json.catalogs : {},
      modules: []
    };

    const catCh = isPlainObject(norm.catalogs) ? norm.catalogs : {};
    const chaptersCatalog = Array.isArray(catCh.chapters) ? catCh.chapters : [];
    const chapterMap = {};
    for (const ch of chaptersCatalog) {
      const id = pickId(ch);
      const title = pickTitle(ch);
      if (id && title) chapterMap[id] = title;
    }

    const stepsCatalog = Array.isArray(catCh.steps) ? catCh.steps : [];
    // nothing else to do here; consumers may read it.

    const modules = Array.isArray(json && json.modules) ? json.modules : [];
    for (const m of modules) {
      const mid = pickId(m);
      const mtitle = pickTitle(m);
      if (!mid || !mtitle) continue;

      const nm = { id: mid, title: mtitle, areas: [] };
      const areas = Array.isArray(m.areas) ? m.areas : [];
      for (const a of areas) {
        const aid = pickId(a);
        const atitle = pickTitle(a);
        if (!aid || !atitle) continue;

        const na = { id: aid, title: atitle, chapters: [] };

        // Shape A: area.chapters = [{id,title|label}]
        if (Array.isArray(a.chapters) && a.chapters.length) {
          for (const c of a.chapters) {
            if (typeof c === "string") {
              const cid = core.normStr(c);
              const ctitle = chapterMap[cid] || cid;
              if (cid && ctitle) na.chapters.push({ id: cid, title: ctitle });
              continue;
            }
            const cid = pickId(c);
            const ctitle = pickTitle(c);
            if (cid && ctitle) na.chapters.push({ id: cid, title: ctitle });
          }
        }

        // Shape B: area.chapterIds = ["ch_1_intro", ...] (katalog->chapters)
        if (!na.chapters.length && Array.isArray(a.chapterIds) && a.chapterIds.length) {
          for (const cidRaw of a.chapterIds) {
            const cid = core.normStr(cidRaw);
            const ctitle = chapterMap[cid] || cid;
            if (cid && ctitle) na.chapters.push({ id: cid, title: ctitle });
          }
        }

        // Shape C: fallback: defaultChapterIds om area saknar egna (stabil kedja hellre än tom)
        if (!na.chapters.length && Array.isArray(catCh.defaultChapterIds) && catCh.defaultChapterIds.length) {
          for (const cidRaw of catCh.defaultChapterIds) {
            const cid = core.normStr(cidRaw);
            const ctitle = chapterMap[cid] || cid;
            if (cid && ctitle) na.chapters.push({ id: cid, title: ctitle });
          }
        }

        nm.areas.push(na);
      }

      norm.modules.push(nm);
    }

    // Soft fallback: om modules finns men inga areas/chapters, behåll modules ändå.
    return norm;
  }

  function validateCatalog(json) {
    // Fail-closed, men tolerant för label/title + chapterIds+catalogs.chapters
    if (!isPlainObject(json)) return core.fail("CATALOG_SHAPE", "modules.json: ogiltigt format");
    if (!Array.isArray(json.modules)) return core.fail("CATALOG_MISSING", "modules.json: saknar modules[]");

    // P0: måste ha id + (title|label) på module/area
    for (const m of json.modules) {
      if (!isPlainObject(m)) return core.fail("CATALOG_MODULE", "modules.json: module måste vara objekt");
      const mid = pickId(m);
      const mtitle = pickTitle(m);
      if (!mid || !mtitle) return core.fail("CATALOG_MODULE_FIELDS", "modules.json: module saknar id + title/label");

      if (!Array.isArray(m.areas)) return core.fail("CATALOG_AREAS", "modules.json: module.areas[] saknas");
      for (const a of m.areas) {
        if (!isPlainObject(a)) return core.fail("CATALOG_AREA", "modules.json: area måste vara objekt");
        const aid = pickId(a);
        const atitle = pickTitle(a);
        if (!aid || !atitle) return core.fail("CATALOG_AREA_FIELDS", "modules.json: area saknar id + title/label");

        // Kapitel kan vara area.chapters[] (obj/str) ELLER area.chapterIds[] (med catalogs.chapters)
        const hasChapters = Array.isArray(a.chapters) && a.chapters.length;
        const hasChapterIds = Array.isArray(a.chapterIds) && a.chapterIds.length;

        if (!hasChapters && !hasChapterIds) {
          // Tillåt tomt, men om catalogs.defaultChapterIds finns så klarar vi UI-kedjan ändå.
          // Fail-closed här skulle göra kedjan instabil om filen är designad för chapterIds.
          continue;
        }

        if (hasChapters) {
          for (const c of a.chapters) {
            if (typeof c === "string") continue;
            if (!isPlainObject(c)) return core.fail("CATALOG_CHAPTER", "modules.json: chapter måste vara objekt eller id-sträng");
            const cid = pickId(c);
            const ctitle = pickTitle(c);
            if (!cid || !ctitle) return core.fail("CATALOG_CHAPTER_FIELDS", "modules.json: chapter saknar id + title/label");
          }
        }
      }
    }

    // Normalisera alltid så UI får stabil shape
    const normalized = normalizeCatalog(json);

    // Fail-closed: om normalisering gav noll moduler -> stoppa tydligt
    if (!Array.isArray(normalized.modules) || !normalized.modules.length) {
      return core.fail("CATALOG_EMPTY", "modules.json: kunde inte normalisera moduler (tom lista)");
    }

    return core.ok({ data: normalized, raw: json });
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
        _catalog.raw = v.raw || json;       // DEBUG/compat
        _catalog.data = v.data;             // normalized for UI
        _catalog.loaded = true;
        return core.ok({ data: _catalog.data, url });
      })
      .catch((e) => {
        _catalog.loaded = false;
        _catalog.data = null;
        _catalog.raw = null;
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
    return mods.find((m) => core.safeLower(m.id) === k) ||
      mods.find((m) => core.safeLower(m.title || m.label) === k) ||
      null;
  }

  function findArea(mod, key) {
    const k = core.safeLower(key);
    if (!mod || !Array.isArray(mod.areas) || !k) return null;
    return mod.areas.find((a) => core.safeLower(a.id) === k) ||
      mod.areas.find((a) => core.safeLower(a.title || a.label) === k) ||
      null;
  }

  core.getModuleOptions = function (catalogData) {
    const data = catalogData || _catalog.data;
    const mods = (data && Array.isArray(data.modules)) ? data.modules : [];
    return mods.map((m) => ({
      id: core.normStr(m.id),
      title: core.normStr(m.title || m.label)
    })).filter(x => x.id && x.title);
  };

  core.getAreaOptions = function (catalogData, moduleKey) {
    const data = catalogData || _catalog.data;
    const mod = findModule(data, moduleKey);
    if (!mod) return [];
    return (mod.areas || []).map((a) => ({
      id: core.normStr(a.id),
      title: core.normStr(a.title || a.label)
    })).filter(x => x.id && x.title);
  };

  core.getChapterOptions = function (catalogData, moduleKey, areaKey) {
    const data = catalogData || _catalog.data;
    const mod = findModule(data, moduleKey);
    const area = findArea(mod, areaKey);
    if (!area) return [];
    const ch = Array.isArray(area.chapters) ? area.chapters : [];
    return ch.map((c) => ({
      id: core.normStr(c && c.id),
      title: core.normStr((c && (c.title || c.label)) || "")
    })).filter(x => x.id && x.title);
  };

  core.getCourseOptions = function (catalogData) {
    const data = catalogData || _catalog.data;

    // Stöd: catalogs.steps (Kurs 1..5) i ai-rules/v1/modules.json
    const steps = data && data.catalogs && Array.isArray(data.catalogs.steps) ? data.catalogs.steps : [];
    if (steps.length) {
      return steps.map((s) => {
        const id = core.normStr(s && s.id);
        const title = core.normStr(s && (s.label || s.title)) || ("Kurs " + id);
        const stepNumber = Number(id || 0) || 0;
        return { id, title, stepNumber };
      }).filter(x => x.id && x.title);
    }

    // Legacy/alt: data.courses
    const courses = (data && Array.isArray(data.courses)) ? data.courses : [];
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
    })).filter(x => x.id && x.title);
  };

  core.getDifficultyOptions = function (catalogData) {
    const data = catalogData || _catalog.data;

    // Stöd: constraints.difficultyAllowed = ["intro","normal","advanced"]
    const allowed = data && data.constraints && Array.isArray(data.constraints.difficultyAllowed)
      ? data.constraints.difficultyAllowed
      : [];

    if (allowed.length) {
      const mapTitle = {
        intro: "Lätt",
        normal: "Normal",
        advanced: "Svår"
      };
      return allowed.map((idRaw) => {
        const id = core.normStr(idRaw);
        const t = mapTitle[id] || (id ? id[0].toUpperCase() + id.slice(1) : "");
        return { id, title: t };
      }).filter(x => x.id && x.title);
    }

    // Legacy/alt: difficultyLevels
    const lv = (data && Array.isArray(data.difficultyLevels)) ? data.difficultyLevels : [];
    if (!lv.length) return [
      { id: "intro", title: "Lätt" },
      { id: "normal", title: "Normal" },
      { id: "advanced", title: "Svår" }
    ];
    return lv.map((x) => ({ id: core.normStr(x.id), title: core.normStr(x.title) })).filter(x => x.id && x.title);
  };

  core.getOutputModes = function (catalogData) {
    const data = catalogData || _catalog.data;
    const om = (data && Array.isArray(data.outputModes)) ? data.outputModes : [];
    if (!om.length) return [
      { id: "training", title: "Utbildning" },
      { id: "document", title: "Dokument" }
    ];
    return om.map((x) => ({ id: core.normStr(x.id), title: core.normStr(x.title) })).filter(x => x.id && x.title);
  };

  core.__VERSION = "v1.0.3-PP-SC-010-03";
})();
