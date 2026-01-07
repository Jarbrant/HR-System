/* ============================================================
FIL: admin/onboard-materialize.js  (PROD HEL FIL)
AO-ONBOARD-MATERIALIZE-02 (PATCH v1.4)
Projekt: HR-System
Syfte: Materialisera onboarding (AO-050_PACKAGES_V1) → TASKS + QUESTIONS

PATCH v1.4 (2026-01-07):
- FIX (kritisk): normalizeAssignments prioriterar wrapper-array (t.ex. {assignments:[...]})
  innan object-map, så key "assignments" inte felaktigt behandlas som empNo-map.
  => eliminerar felet: "record för assignments är inte objekt."
- Oförändrat: idempotens via stabil pkgKey + blockKey + _origin
- Oförändrat: stöd pkg.blocks och pkg.items
- Oförändrat: info/document ignoreras
- Inga nya storage-keys, inga kopplingsändringar

Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys
- Läser: AO-050_PACKAGES_V1, AO-020_ROLE_ASSIGNMENTS_V2, AO-014_TASKS_V1, AO-012_QUESTIONS_V1
- Skriver: AO-014_TASKS_V1, AO-012_QUESTIONS_V1
- Idempotent via _origin
============================================================ */

(function () {
  "use strict";

  const PACKAGES_KEY = "AO-050_PACKAGES_V1";
  const TASKS_KEY = "AO-014_TASKS_V1";
  const QUESTIONS_KEY = "AO-012_QUESTIONS_V1";
  const ASG_KEY = "AO-020_ROLE_ASSIGNMENTS_V2";

  const SPECIAL_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const MAX_BLOCKS_SCAN = 50000;

  function safeParse(raw) {
    try {
      if (raw == null) return { ok: true, value: null };
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, value: null };
    }
  }

  function readJson(key) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch { raw = null; }
    const p = safeParse(raw);
    if (!p.ok) return { ok: false, err: `${key} är korrupt JSON.` };
    return { ok: true, value: p.value };
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return { ok: true };
    } catch {
      return { ok: false, err: "Kunde inte spara (localStorage fullt/blockerat)." };
    }
  }

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }

  function asStr(x, max) {
    const s = String(x ?? "").trim();
    if (!s) return "";
    return (max && s.length > max) ? s.slice(0, max) : s;
  }

  function normStatus(x) {
    return asStr(x, 40).toLowerCase();
  }

  function normKind(block) {
    const k = asStr(block && (block.type || block.kind) || "", 20).toLowerCase();
    if (k === "task" || k === "question" || k === "both" || k === "info" || k === "document") return k;
    return "";
  }

  // Lightweight stable hash (FNV-1a 32-bit)
  function fnv1a32(str) {
    const s = String(str ?? "");
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("00000000" + h.toString(16)).slice(-8);
  }

  function genId(prefix) {
    return prefix + "_" + Date.now().toString(16) + "_" + Math.random().toString(16).slice(2, 8);
  }

  // Stöd både pkg.blocks och pkg.items (UI visar ofta "Items: N")
  function getBlocksFromPackage(pkg) {
    if (pkg && Array.isArray(pkg.blocks)) return pkg.blocks;
    if (pkg && Array.isArray(pkg.items)) return pkg.items;
    return [];
  }

  // Robust "active package" match
  function isActivePackage(pkg) {
    if (!pkg || typeof pkg !== "object") return false;

    // Primary: status string
    const st = normStatus(pkg.status);
    if (st === "active") return true;

    // Secondary: boolean flags used by other UIs
    if (pkg.isActive === true) return true;
    if (pkg.active === true) return true;
    if (pkg.enabled === true) return true;

    return false;
  }

  function ensureArrayShape(key, raw) {
    if (raw == null) return { ok: true, arr: [] };
    if (!Array.isArray(raw)) return { ok: false, arr: [], err: `${key} måste vara en array.` };
    return { ok: true, arr: raw };
  }

  function buildOriginSet(arr) {
    const set = new Set();
    for (const x of arr) {
      const o = asStr(x && x._origin || "", 300);
      if (o) set.add(o);
    }
    return set;
  }

  function extractAssignmentsArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (isObj(raw) && Array.isArray(raw.assignments)) return raw.assignments;
    if (isObj(raw) && Array.isArray(raw.items)) return raw.items;
    if (isObj(raw) && Array.isArray(raw.rows)) return raw.rows;
    return null;
  }

  // PATCH v1.4: wrapper-array prioriteras före object-map
  function normalizeAssignments(raw) {
    const empty = Object.create(null);

    if (raw == null) return { ok: false, map: empty, err: `${ASG_KEY} saknas (null).` };

    // 1) Försök wrapper/array först (t.ex. {assignments:[...]})
    const arrFirst = extractAssignmentsArray(raw);
    if (arrFirst) {
      const out = Object.create(null);
      for (const rec of arrFirst) {
        if (!isObj(rec)) continue;
        for (const rk of Object.keys(rec)) {
          if (SPECIAL_KEYS.has(String(rk))) {
            return { ok: false, map: empty, err: `${ASG_KEY} innehåller blockerad special-key i record (${rk}).` };
          }
        }
        const empNo = asStr(rec.empNo ?? rec.employeeNo ?? rec.id ?? "", 40);
        if (!empNo) continue;
        out[empNo] = rec;
      }
      return { ok: true, map: out };
    }

    // 2) Annars: object-map { "3001": {scopeId:...}, ... }
    if (isObj(raw)) {
      const out = Object.create(null);
      for (const k of Object.keys(raw)) {
        const key = String(k);
        if (SPECIAL_KEYS.has(key)) {
          return { ok: false, map: empty, err: `${ASG_KEY} innehåller blockerad special-key (${key}).` };
        }
        const rec = raw[key];

        // Fail-closed men tydligt: om rec finns måste det vara objekt eller null
        if (rec != null && !isObj(rec)) {
          return { ok: false, map: empty, err: `${ASG_KEY} record för ${key} är inte objekt.` };
        }

        if (rec != null) {
          for (const rk of Object.keys(rec)) {
            if (SPECIAL_KEYS.has(String(rk))) {
              return { ok: false, map: empty, err: `${ASG_KEY} record för ${key} innehåller blockerad special-key (${rk}).` };
            }
          }
        }

        out[key] = rec;
      }
      return { ok: true, map: out };
    }

    return { ok: false, map: empty, err: `${ASG_KEY} måste vara ett objekt-map eller array/wrapper.` };
  }

  function stablePackageKey(pkg) {
    const id = asStr(pkg && (pkg.id || pkg.packageId) || "", 160);
    if (id) return "pkgid:" + id;

    const title = asStr(pkg && (pkg.title || pkg.name) || "", 160);
    if (title) return "pkgt:" + fnv1a32(title);

    // fallback: hash a few stable-ish fields
    const st = normStatus(pkg && pkg.status);
    const blocksLen = Array.isArray(pkg && pkg.blocks) ? pkg.blocks.length : (Array.isArray(pkg && pkg.items) ? pkg.items.length : 0);
    return "pkgx:" + fnv1a32(st + "|" + String(blocksLen));
  }

  function stableBlockKey(block, kind, fallbackIndex) {
    const bid = asStr(block && (block.id || block.blockId) || "", 200);
    if (bid) return "bid:" + bid;

    const title = asStr(block && block.title || "", 200);
    const text = asStr(block && (block.text || block.description) || "", 800);

    // If both empty, last resort: index (can change, but only used when there's truly nothing else)
    if (!title && !text) return "idx:" + String(fallbackIndex);

    return "bh:" + fnv1a32(kind + "|" + title + "|" + text);
  }

  function originKey(pkgKey, blockKey, empNo) {
    const p = asStr(pkgKey, 200) || "pkg";
    const b = asStr(blockKey, 200) || "blk";
    const e = asStr(empNo, 20) || "emp";
    return `${p}:${b}:${e}`;
  }

  function extractScopeId(rec) {
    if (!rec || typeof rec !== "object") return "";
    return asStr(rec.scopeId || rec.scope || rec.nodeId || rec.orgId || "", 140);
  }

  function clampInt(n, lo, hi, def) {
    const x = Number(n);
    if (!Number.isFinite(x)) return def;
    const xi = Math.trunc(x);
    if (xi < lo) return lo;
    if (xi > hi) return hi;
    return xi;
  }

  function normalizeTaskAnswer(block) {
    const v = asStr(block && block.taskAnswer || "", 20).toLowerCase();
    return (v === "scale") ? "scale" : "checkbox";
  }

  function normalizeQuestionAnswer(block, kind) {
    const v = asStr(block && block.questionAnswer || "", 20).toLowerCase();
    if (kind === "both") return "text";
    if (kind === "question") return (v === "choice") ? "choice" : "text";
    return "text";
  }

  function normalizeOptions(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    return arr.map(x => asStr(x, 40)).filter(Boolean).slice(0, 10);
  }

  function normalizeCorrectOptions(raw, options) {
    const opts = Array.isArray(options) ? options : [];
    const set = new Set(opts.map(x => String(x)));
    const arr = Array.isArray(raw) ? raw : [];
    const cleaned = arr.map(x => asStr(x, 40)).filter(Boolean);
    const filtered = cleaned.filter(v => set.has(v));
    const out = [];
    for (const v of filtered) { if (!out.includes(v)) out.push(v); }
    return out.slice(0, 2);
  }

  function materialize(opts) {
    const dryRun = !!(opts && opts.dryRun);
    const reasons = [];

    const pPackages = readJson(PACKAGES_KEY);
    if (!pPackages.ok) reasons.push(pPackages.err);

    const pAsg = readJson(ASG_KEY);
    if (!pAsg.ok) reasons.push(pAsg.err);

    const pTasks = readJson(TASKS_KEY);
    if (!pTasks.ok) reasons.push(pTasks.err);

    const pQuestions = readJson(QUESTIONS_KEY);
    if (!pQuestions.ok) reasons.push(pQuestions.err);

    if (reasons.length) return { ok: false, dryRun, reasons };

    const packages = pPackages.value ?? [];
    if (!Array.isArray(packages)) {
      return { ok: false, dryRun, reasons: [`${PACKAGES_KEY} måste vara en array.`] };
    }

    const asgN = normalizeAssignments(pAsg.value ?? {});
    if (!asgN.ok) return { ok: false, dryRun, reasons: [asgN.err] };

    const tN = ensureArrayShape(TASKS_KEY, pTasks.value);
    if (!tN.ok) return { ok: false, dryRun, reasons: [tN.err] };

    const qN = ensureArrayShape(QUESTIONS_KEY, pQuestions.value);
    if (!qN.ok) return { ok: false, dryRun, reasons: [qN.err] };

    const tasks = tN.arr.slice();
    const questions = qN.arr.slice();

    const taskOrigins = buildOriginSet(tasks);
    const questionOrigins = buildOriginSet(questions);

    const empNos = Object.keys(asgN.map);
    const activePkgs = packages.filter(isActivePackage);

    let blocksScanned = 0;
    let tasksAdded = 0;
    let questionsAdded = 0;

    const now = Date.now();

    for (const pkg of activePkgs) {
      const pkgKey = stablePackageKey(pkg);
      const blocks = getBlocksFromPackage(pkg);
      if (!blocks.length) continue;

      for (const empNoRaw of empNos) {
        const empNo = asStr(empNoRaw, 20);
        if (!empNo) continue;

        const rec = asgN.map[empNoRaw];
        const scopeId = extractScopeId(rec);
        if (!scopeId) continue;

        for (let bi = 0; bi < blocks.length; bi++) {
          if (blocksScanned >= MAX_BLOCKS_SCAN) {
            return { ok: false, dryRun, reasons: [`Stop: för många block att scanna (${MAX_BLOCKS_SCAN}).`] };
          }
          blocksScanned++;

          const block = blocks[bi] || {};
          const kind = normKind(block);
          if (!kind) continue;

          // info/document ignoreras
          if (kind === "info" || kind === "document") continue;

          const blockKey = stableBlockKey(block, kind, bi);
          const origin = originKey(pkgKey, blockKey, empNo);

          const title = asStr(block.title || "", 120) || "Block";
          const text = asStr(block.text || block.description || "", 2000);

          const taskAnswer = normalizeTaskAnswer(block);
          const questionAnswer = normalizeQuestionAnswer(block, kind);

          const scaleMin = clampInt(block.scaleMin, 1, 10, 1);
          const scaleMax0 = clampInt(block.scaleMax, 1, 10, 5);
          const scaleMax = (scaleMax0 < scaleMin) ? scaleMin : scaleMax0;

          // TASK
          if (kind === "task" || kind === "both") {
            if (!taskOrigins.has(origin)) {
              tasks.push({
                id: genId("tsk"),
                empNo,
                scopeId,
                title,
                text,
                answerType: taskAnswer,          // checkbox|scale
                scaleMin,
                scaleMax,
                status: "open",                  // UI kan tolka som open/done
                done: false,
                createdAt: now,
                updatedAt: now,
                _origin: origin,
                _source: "onboard",
                _pkgKey: pkgKey,
                _blockKey: blockKey
              });
              taskOrigins.add(origin);
              tasksAdded++;
            }
          }

          // QUESTION
          if (kind === "question" || kind === "both") {
            if (!questionOrigins.has(origin)) {
              const options = (questionAnswer === "choice") ? normalizeOptions(block.options) : [];
              const correctOptions = (questionAnswer === "choice")
                ? normalizeCorrectOptions(block.correctOptions, options)
                : [];

              questions.push({
                id: genId("q"),
                empNo,
                scopeId,
                title,
                text,
                answerType: questionAnswer,      // text|choice
                options,
                correctOptions,
                createdAt: now,
                updatedAt: now,
                _origin: origin,
                _source: "onboard",
                _pkgKey: pkgKey,
                _blockKey: blockKey
              });
              questionOrigins.add(origin);
              questionsAdded++;
            }
          }
        }
      }
    }

    // Ingen write vid dryRun
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        activePackages: activePkgs.length,
        assignmentsEmpCount: empNos.length,
        blocksScanned,
        tasksAdded,
        questionsAdded,
        tasksTotalAfter: tasks.length,
        questionsTotalAfter: questions.length
      };
    }

    // Write (fail-closed om write misslyckas)
    const w1 = writeJson(TASKS_KEY, tasks);
    if (!w1.ok) return { ok: false, dryRun: false, reasons: [w1.err || "Kunde inte spara TASKS."] };

    const w2 = writeJson(QUESTIONS_KEY, questions);
    if (!w2.ok) return { ok: false, dryRun: false, reasons: [w2.err || "Kunde inte spara QUESTIONS."] };

    return {
      ok: true,
      dryRun: false,
      activePackages: activePkgs.length,
      assignmentsEmpCount: empNos.length,
      blocksScanned,
      tasksAdded,
      questionsAdded,
      tasksTotalAfter: tasks.length,
      questionsTotalAfter: questions.length
    };
  }

  // Export (LÅST): onboard-materialize.html förväntar sig denna symbol
  window.HR_ONBOARD_MATERIALIZE = function (opts) {
    try {
      return materialize(opts || {});
    } catch (e) {
      return {
        ok: false,
        dryRun: !!(opts && opts.dryRun),
        reasons: ["Oväntat fel i materialize (fail-closed).", String((e && e.message) || e || "Okänt fel")]
      };
    }
  };
})();
