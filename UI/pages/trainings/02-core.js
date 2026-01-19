/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-02) | FILE 02/06 | FIL-ID: UI/pages/trainings/02-core.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Core-helpers + fail-closed guards + title-motor (kapitel+steg) + AI-payload builder (utan fetch)

POLICY (LÅST):
- UI-only • Fail-closed
- Ingen storage här (03-store)
- Ingen DOM-render här (05-render)
- XSS-safe: inga innerHTML
- ADMIN-only write (SYSTEM_ADMIN/MANAGER read-only)
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

  core.collapseSpaces = function (v) {
    return core.normStr(v).replace(/\s+/g, " ");
  };

  // ---------- role / auth ----------
  // Rely on UI-03-APP.js (HRApp). Fail-closed to SYSTEM_ADMIN.
  // NOTE: Vi har sett att HRApp saknar getRole/getWho i vissa versioner.
  // Den säkra vägen är: mustGetSession() + getAuth().
  core.getWho = function () {
    try {
      if (window.HRApp && typeof window.HRApp.mustGetSession === "function" && typeof window.HRApp.getAuth === "function") {
        const sess = window.HRApp.mustGetSession();
        const auth = window.HRApp.getAuth(sess);
        if (auth && auth.isAuthed === true) {
          const role = String(auth.role || "SYSTEM_ADMIN").toUpperCase();
          const empNo = core.normStr(auth.empNo || "");
          const canWrite = role === "ADMIN"; // POLICY: ADMIN-only write
          return { role, empNo, canWrite };
        }
      }
    } catch (_) {}
    return { role: "SYSTEM_ADMIN", empNo: "", canWrite: false };
  };

  core.isAdminWriter = function (who) {
    const role = String((who && who.role) || "SYSTEM_ADMIN").toUpperCase();
    return role === "ADMIN";
  };

  // ---------- fail-closed helpers ----------
  core.fail = function (code, msg) {
    return { ok: false, code: String(code || "ERR"), err: String(msg || "Fel") };
  };

  core.ok = function (data) {
    return Object.assign({ ok: true }, data || {});
  };

  // ============================================================
  // CATALOG (PP-SC-011) — fasta listor + kontrollerad “lägg till ny”
  // POLICY:
  // - Ingen storage här. 03-store sparar (om AO säger) i befintlig träningsdata.
  // - Här endast: fasta defaults + validering + merge/suggest/add helpers.
  //
  // INPUT-KÄLLA (tillåtet):
  // - window.HR_CONFIG.TRAININGS_CATALOG (runtime/config, ingen storage-key)
  // - seed från 03-store (t.ex. extraherat ur AO-057_TRAININGS_V1)
  // ============================================================

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function uniqStrings(arr) {
    const out = [];
    const seen = new Set();
    const a = Array.isArray(arr) ? arr : [];
    for (let i = 0; i < a.length; i++) {
      const s = core.collapseSpaces(a[i]);
      if (!s) continue;
      const k = core.safeLower(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  function ensureAreasMap(obj) {
    const out = {};
    if (!isPlainObject(obj)) return out;
    for (const k of Object.keys(obj)) {
      const key = core.collapseSpaces(k);
      if (!key) continue;
      out[key] = uniqStrings(obj[k]);
    }
    return out;
  }

  function readFixedCatalogFromConfig() {
    try {
      const cfg = window.HR_CONFIG;
      if (!cfg || typeof cfg !== "object") return null;

      const cat = cfg.TRAININGS_CATALOG;
      if (!cat || typeof cat !== "object") return null;

      const fixedModules = uniqStrings(cat.modules);
      const fixedAreasByModule = ensureAreasMap(cat.areasByModule);
      const fixedTitlePresets = uniqStrings(cat.titlePresets);

      return {
        modules: fixedModules,
        areasByModule: fixedAreasByModule,
        titlePresets: fixedTitlePresets,
      };
    } catch {
      return null;
    }
  }

  // Minimal fallback (vi gissar inte din riktiga katalog här).
  // 03-store eller HR_CONFIG kan fylla detta.
  function getFallbackFixedCatalog() {
    return {
      modules: [],
      areasByModule: {},
      titlePresets: [], // valfritt: fasta titel-mallar
    };
  }

  core.getFixedCatalog = function () {
    return readFixedCatalogFromConfig() || getFallbackFixedCatalog();
  };

  // Merge fixed + seed (seed kan vara discovery från befintliga utbildningar)
  core.mergeCatalog = function (seed) {
    const fixed = core.getFixedCatalog();
    const s = isPlainObject(seed) ? seed : {};

    const modules = uniqStrings([].concat(fixed.modules || [], s.modules || []));

    // areasByModule: merge per modul
    const fixedMap = ensureAreasMap(fixed.areasByModule);
    const seedMap = ensureAreasMap(s.areasByModule);

    const areasByModule = {};
    const moduleKeys = uniqStrings([].concat(Object.keys(fixedMap), Object.keys(seedMap)));

    for (let i = 0; i < moduleKeys.length; i++) {
      const m = moduleKeys[i];
      areasByModule[m] = uniqStrings([].concat(fixedMap[m] || [], seedMap[m] || []));
    }

    const titlePresets = uniqStrings([].concat(fixed.titlePresets || [], s.titlePresets || []));

    return { modules, areasByModule, titlePresets };
  };

  core.isInList = function (value, list) {
    const v = core.safeLower(value);
    if (!v) return false;
    const a = Array.isArray(list) ? list : [];
    for (let i = 0; i < a.length; i++) {
      if (core.safeLower(a[i]) === v) return true;
    }
    return false;
  };

  core.getAreasForModule = function (catalog, moduleName) {
    const cat = isPlainObject(catalog) ? catalog : core.mergeCatalog(null);
    const mod = core.collapseSpaces(moduleName);
    if (!mod) return [];
    // försök hitta exakt modulnyckel (case/space tolerant)
    const keys = Object.keys(cat.areasByModule || {});
    for (let i = 0; i < keys.length; i++) {
      if (core.safeLower(keys[i]) === core.safeLower(mod)) return cat.areasByModule[keys[i]] || [];
    }
    return [];
  };

  // Kontrollerad “lägg till”
  // Returnerar nytt catalog-objekt (immutable-ish) + flagga om den faktiskt ändrade något.
  core.addToCatalog = function (catalog, moduleName, areaName) {
    const cat = isPlainObject(catalog) ? catalog : core.mergeCatalog(null);

    const mod = core.collapseSpaces(moduleName);
    const area = core.collapseSpaces(areaName);

    if (!mod) return core.ok({ changed: false, catalog: cat });

    const next = {
      modules: (Array.isArray(cat.modules) ? cat.modules.slice() : []),
      areasByModule: isPlainObject(cat.areasByModule) ? Object.assign({}, cat.areasByModule) : {},
      titlePresets: Array.isArray(cat.titlePresets) ? cat.titlePresets.slice() : [],
    };

    let changed = false;

    if (!core.isInList(mod, next.modules)) {
      next.modules.push(mod);
      next.modules = uniqStrings(next.modules);
      changed = true;
    }

    if (area) {
      // hitta befintlig nyckel om den finns
      let key = mod;
      const keys = Object.keys(next.areasByModule);
      for (let i = 0; i < keys.length; i++) {
        if (core.safeLower(keys[i]) === core.safeLower(mod)) { key = keys[i]; break; }
      }

      const existingAreas = Array.isArray(next.areasByModule[key]) ? next.areasByModule[key].slice() : [];
      if (!core.isInList(area, existingAreas)) {
        existingAreas.push(area);
        next.areasByModule[key] = uniqStrings(existingAreas);
        changed = true;
      }
    }

    return core.ok({ changed, catalog: next });
  };

  // Fail-closed validering av modul/område (används av 06-page för att låsa actions)
  core.validateModuleArea = function (catalog, moduleName, areaName) {
    const cat = isPlainObject(catalog) ? catalog : core.mergeCatalog(null);
    const mod = core.collapseSpaces(moduleName);
    const area = core.collapseSpaces(areaName);

    if (!mod) return core.fail("SUBJECT_MODULE_MISSING", "Välj modul.");
    if (!core.isInList(mod, cat.modules)) {
      return core.fail("SUBJECT_MODULE_UNKNOWN", "Modul finns inte i listan. Lägg till den först.");
    }

    // Om modul finns: område krävs och måste finnas i modulens area-lista
    const areas = core.getAreasForModule(cat, mod);
    if (!area) return core.fail("SUBJECT_AREA_MISSING", "Välj område.");
    if (!core.isInList(area, areas)) {
      return core.fail("SUBJECT_AREA_UNKNOWN", "Område finns inte för vald modul. Lägg till det först.");
    }

    return core.ok();
  };

  // Deterministisk subjectId (för UI + worker ruleset selection)
  // Format: "<module>::<area>" (lowercase, single-spaced)
  core.buildSubjectId = function (moduleName, areaName) {
    const m = core.safeLower(core.collapseSpaces(moduleName));
    const a = core.safeLower(core.collapseSpaces(areaName));
    if (!m || !a) return "";
    return m + "::" + a;
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
    // tolerant parser
    const out = { chapter: "", step: "", area: "" };
    if (!t) return out;

    const parts = t.split("•").map((x) => core.normStr(x));
    // expected [chapter, "Steg N", area]
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

  // ---------- AI payload builder (utan fetch) ----------
  // Vi skickar strukturerad kontext till HRWorkerSDK.aiGenerate().
  core.buildAiContext = function (state, catalog) {
    const s = state || {};
    const module = core.normStr(s.module);
    const area = core.normStr(s.area);

    const chapter = core.normStr(s.courseTitle);
    const step = core.normStr(s.courseStep);
    const level = core.normStr(s.goalsLevel || "normal");

    const title = core.composeTitle(chapter, step, area);
    const subjectId = core.buildSubjectId(module, area);

    // Fail-closed hint: validering kan göras av 06-page innan generate/save.
    const subjectValidation = core.validateModuleArea(catalog || core.mergeCatalog(null), module, area);

    return {
      subject: { module, area, subjectId, valid: subjectValidation.ok === true },
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

  // Prompt-kontrakt (fail-closed): förbjudna fraser ska aldrig efterfrågas.
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

  // Normalisering av AI-svar (utan ny datamodell):
  // Förväntat: JSON { items:[...] } eller { blocks:[{items:[...]}] }.
  core.normalizeAiResult = function (raw) {
    const out = { items: [], blocks: [] };

    if (!raw || typeof raw !== "object") return out;

    // items
    if (Array.isArray(raw.items)) out.items = raw.items;

    // blocks
    if (Array.isArray(raw.blocks)) out.blocks = raw.blocks;

    // some workers return {data:{...}}
    if (!out.items.length && raw.data && typeof raw.data === "object") {
      if (Array.isArray(raw.data.items)) out.items = raw.data.items;
      if (Array.isArray(raw.data.blocks)) out.blocks = raw.data.blocks;
    }

    return out;
  };

  // tiny "assert" for boot
  core.assert = function (cond, code, msg) {
    if (!cond) throw new Error(String(code || "ASSERT") + ":" + String(msg || "assert"));
  };

  core.__VERSION = "v1.1-PP-SC-011";
})();
