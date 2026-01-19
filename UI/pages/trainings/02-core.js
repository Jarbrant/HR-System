/* ============================================================
AO-TRAININGS-MODULAR-01 (PP-SC-010-03) | FILE 02/06 | FIL-ID: UI/pages/trainings/02-core.js
Projekt: HR-System (GitHub Pages / UI-only)
Syfte: Core-helpers + fail-closed guards + title-motor (kapitel+steg) + AI-payload builder (utan fetch)

POLICY (LÅST):
- UI-only • Fail-closed
- Ingen storage här (03-store)
- Ingen DOM-render här (05-render)
- XSS-safe: inga innerHTML
- ADMIN-only write (SYSTEM_ADMIN/MANAGER read-only)

PATCH v1.0.1 (PP-SC-010-03):
- FIX: Robust roll/who-detektion via flera HRApp-API: getWho/getAuth/readAuthState/mustGetSession/session
- FIX: Fail-closed default kvar (SYSTEM_ADMIN) men ADMIN ska nu bli writer när session finns
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

  // ---------- role / auth ----------
  // Rely on UI-03-APP.js if available. Fail-closed to SYSTEM_ADMIN.
  function upper(v) { return String(v || "").toUpperCase(); }

  function pickRoleFrom(obj) {
    if (!obj || typeof obj !== "object") return "";
    // common shapes we accept (tolerant):
    return (
      obj.role ||
      (obj.user && obj.user.role) ||
      (obj.auth && obj.auth.role) ||
      (obj.session && obj.session.role) ||
      (obj.data && obj.data.role) ||
      ""
    );
  }

  function pickEmpFrom(obj) {
    if (!obj || typeof obj !== "object") return "";
    return (
      obj.empNo ||
      obj.emp ||
      obj.employeeNo ||
      (obj.user && (obj.user.empNo || obj.user.emp || obj.user.employeeNo)) ||
      (obj.auth && (obj.auth.empNo || obj.auth.emp)) ||
      (obj.session && (obj.session.empNo || obj.session.emp)) ||
      (obj.data && (obj.data.empNo || obj.data.emp)) ||
      ""
    );
  }

  function tryCall(fn) {
    try { return fn(); } catch (_) { return null; }
  }

  core.getWho = function () {
    // default (fail-closed)
    const fallback = { role: "SYSTEM_ADMIN", empNo: "", canWrite: false };

    try {
      const app = window.HRApp;
      if (!app) return fallback;

      // 1) Preferred: getWho()
      if (typeof app.getWho === "function") {
        const w = tryCall(() => app.getWho());
        const role = upper(pickRoleFrom(w) || w?.role);
        const empNo = core.normStr(pickEmpFrom(w) || w?.empNo || "");
        if (role) return { role, empNo, canWrite: role === "ADMIN" };
      }

      // 2) getAuth() (många sidor använder detta)
      if (typeof app.getAuth === "function") {
        const a = tryCall(() => app.getAuth());
        const role = upper(pickRoleFrom(a));
        const empNo = core.normStr(pickEmpFrom(a));
        if (role) return { role, empNo, canWrite: role === "ADMIN" };
      }

      // 3) readAuthState() (förekommer i HRApp-CORE)
      if (typeof app.readAuthState === "function") {
        const s = tryCall(() => app.readAuthState());
        // kan vara {ok:true, role, empNo} eller {role,...}
        const role = upper(pickRoleFrom(s) || s?.role);
        const empNo = core.normStr(pickEmpFrom(s) || s?.empNo || "");
        if (role) return { role, empNo, canWrite: role === "ADMIN" };
      }

      // 4) mustGetSession() (fail-closed session getter)
      if (typeof app.mustGetSession === "function") {
        const sess = tryCall(() => app.mustGetSession());
        const role = upper(pickRoleFrom(sess) || sess?.role);
        const empNo = core.normStr(pickEmpFrom(sess) || sess?.empNo || "");
        if (role) return { role, empNo, canWrite: role === "ADMIN" };
      }

      // 5) plain session object (last resort)
      if (app.session && typeof app.session === "object") {
        const role = upper(pickRoleFrom(app.session) || app.session.role);
        const empNo = core.normStr(pickEmpFrom(app.session) || app.session.empNo || "");
        if (role) return { role, empNo, canWrite: role === "ADMIN" };
      }

      // 6) legacy: getRole()
      if (typeof app.getRole === "function") {
        const r = tryCall(() => app.getRole());
        const role = upper(pickRoleFrom(r) || r?.role);
        const empNo = core.normStr(pickEmpFrom(r) || r?.empNo || "");
        if (role) return { role, empNo, canWrite: role === "ADMIN" };
      }
    } catch (_) { /* ignore */ }

    return fallback;
  };

  core.isAdminWriter = function (who) {
    const role = upper((who && who.role) || "SYSTEM_ADMIN");
    return role === "ADMIN";
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

  // ---------- AI payload builder (utan fetch) ----------
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

  core.__VERSION = "v1.0.1-PP-SC-010-03";
})();
