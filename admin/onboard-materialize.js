/* ============================================================
FIL: admin/onboard-materialize.js  (PROD HEL FIL)
AO-ONBOARD-MATERIALIZE-02 (PATCH v1.4)
Projekt: HR-System
Syfte: Materialisera onboarding (AO-050_PACKAGES_V1) → TASKS + QUESTIONS

PATCH v1.4 (2026-01-07):
- FIX (P0): Stöd “Block-bank”-containerblock med items[]:
  * Om ett paket-block innehåller items[] (document/question/task) så materialiseras
    question/task per item (document/info ignoreras), istället för att kräva kind på toppnivå.
- FIX (P0): Stabil idempotens även per item (origin inkluderar itemKey) → inga “rubrik men inga frågor”
- Back-compat: Behåller gamla vägen när block.kind/type är task/question/both/info/document.
- Inga nya storage-keys, inga kopplingsändringar.

Policy (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys
- Läser: AO-050_PACKAGES_V1, AO-020_ROLE_ASSIGNMENTS_V2, AO-014_TASKS_V1, AO-012_QUESTIONS_V1
- Skriver: AO-014_TASKS_V1, AO-012_QUESTIONS_V1
- Idempotent via _origin
============================================================ */

(function () {
  "use strict";

  const PACKAGES_KEY  = "AO-050_PACKAGES_V1";
  const TASKS_KEY     = "AO-014_TASKS_V1";
  const QUESTIONS_KEY = "AO-012_QUESTIONS_V1";
  const ASG_KEY       = "AO-020_ROLE_ASSIGNMENTS_V2";

  const SPECIAL_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const MAX_SCAN = 50000;

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

  function normKind(x) {
    const k = asStr(x ?? "", 24).toLowerCase();
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

  // Stöd både pkg.blocks och pkg.items
  function getBlocksFromPackage(pkg) {
    if (pkg && Array.isArray(pkg.blocks)) return pkg.blocks;
    if (pkg && Array.isArray(pkg.items)) return pkg.items;
    return [];
  }

  // Robust "active package" match
  function isActivePackage(pkg) {
    if (!pkg || typeof pkg !== "object") return false;
    const st = normStatus(pkg.status);
    if (st === "active") return true;
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
      const o = asStr(x && x._origin || "", 500);
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

  function normalizeAssignments(raw) {
    const empty = Object.create(null);

    if (raw == null) return { ok: false, map: empty, err: `${ASG_KEY} saknas (null).` };

    // Case A: object-map { "3001": {scopeId:...}, ... }
    if (isObj(raw) && !Array.isArray(raw)) {
      const out = Object.create(null);
      for (const k of Object.keys(raw)) {
        const key = String(k);
        if (SPECIAL_KEYS.has(key)) {
          return { ok: false, map: empty, err: `${ASG_KEY} innehåller blockerad special-key (${key}).` };
        }
        const rec = raw[key];
        if (rec != null) {
          if (!isObj(rec)) return { ok: false, map: empty, err: `${ASG_KEY} record för ${key} är inte objekt.` };
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

    // Case B: array or wrapper-array
    const arr = extractAssignmentsArray(raw);
    if (arr) {
      const out = Object.create(null);
      for (const rec of arr) {
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

    return { ok: false, map: empty, err: `${ASG_KEY} måste vara ett objekt-map eller array/wrapper.` };
  }

  function stablePackageKey(pkg) {
    const id = asStr(pkg && (pkg.id || pkg.packageId) || "", 160);
    if (id) return "pkgid:" + id;

    const title = asStr(pkg && (pkg.title || pkg.name) || "", 160);
    if (title) return "pkgt:" + fnv1a32(title);

    const st = normStatus(pkg && pkg.status);
    const blocksLen = Array.isArray(pkg && pkg.blocks) ? pkg.blocks.length : (Array.isArray(pkg && pkg.items) ? pkg.items.length : 0);
    return "pkgx:" + fnv1a32(st + "|" + String(blocksLen));
  }

  function stableBlockKey(block, kind, fallbackIndex) {
    // Support both older {id} and block-bank {blockId}
    const bid = asStr(block && (block.id || block.blockId) || "", 220);
    if (bid) return "bid:" + bid;

    const title = asStr(block && block.title || "", 220);
    const text = asStr(block && (block.text || block.description) || "", 900);

    if (!title && !text) return "idx:" + String(fallbackIndex);
    return "bh:" + fnv1a32(kind + "|" + title + "|" + text);
  }

  function stableItemKey(item, fallbackIndex) {
    // Prefer explicit ids if present
    const qid = asStr(item && item.questionId || "", 240);
    if (qid) return "qid:" + qid;

    const tid = asStr(item && item.taskId || "", 240);
    if (tid) return "tid:" + tid;

    // Otherwise hash kind+text+options/scale
    const k = normKind(asStr(item && item.kind || "", 24));
    const tx = asStr(item && item.text || "", 1200);
    const at = asStr(item && item.answerType || "", 40);

    let extra = "";
    if (k === "question" && at === "choice") {
      const opts = Array.isArray(item && item.options) ? item.options : [];
      extra = "opts:" + opts.map(o => asStr(o, 80)).filter(Boolean).join("|");
    }
    if (k === "task" && at === "scale") {
      const sc = item && item.scale || {};
      extra = "scale:" + String(Number(sc.min ?? "")) + "-" + String(Number(sc.max ?? "")) + "|" +
        asStr(sc.minLabel, 80) + "|" + asStr(sc.maxLabel, 80);
    }

    if (!k && !tx) return "iidx:" + String(fallbackIndex);
    return "ih:" + fnv1a32(k + "|" + at + "|" + tx + "|" + extra);
  }

  function originKey(pkgKey, blockKey, itemKey, empNo) {
    const p = asStr(pkgKey, 220) || "pkg";
    const b = asStr(blockKey, 220) || "blk";
    const i = asStr(itemKey, 220) || "itm";
    const e = asStr(empNo, 40) || "emp";
    return `${p}:${b}:${i}:${e}`;
  }

  function extractScopeId(rec) {
    if (!rec || typeof rec !== "object") return "";
    return asStr(rec.scopeId || rec.scope || rec.nodeId || rec.orgId || "", 140);
  }

  function boolDefault(v, defTrue) {
    if (v === true) return true;
    if (v === false) return false;
    return !!defTrue;
  }

  // Normalize an item from block-bank (document/question/task)
  function normalizeBankItem(raw) {
    const it = (raw && typeof raw === "object") ? raw : {};
    const kind = normKind(it.kind || "");
    const text = asStr(it.text, kind === "document" ? 2000 : 240);

    if (kind === "document" || kind === "info") {
      return {
        kind: "document",
        text,
        requiresSign: boolDefault(it.requiresSign, true)
      };
    }

    if (kind === "question") {
      const answerType = (asStr(it.answerType, 20).toLowerCase() === "choice") ? "choice" : "text";
      const options = (answerType === "choice" && Array.isArray(it.options))
        ? it.options.map(o => asStr(o, 80)).filter(Boolean).slice(0, 10)
        : [];
      return {
        kind: "question",
        questionId: asStr(it.questionId, 260) || genId("q"),
        text: asStr(text, 240),
        answerType,
        options,
        requiresAnswer: boolDefault(it.requiresAnswer, true)
      };
    }

    if (kind === "task") {
      const answerType = (asStr(it.answerType, 20).toLowerCase() === "scale") ? "scale" : "checkbox";
      let scale = null;
      if (answerType === "scale") {
        const sc = it.scale || {};
        let mn = Number(sc.min);
        let mx = Number(sc.max);
        if (!Number.isFinite(mn)) mn = 1;
        if (!Number.isFinite(mx)) mx = 5;
        mn = Math.max(1, Math.min(10, Math.trunc(mn)));
        mx = Math.max(1, Math.min(10, Math.trunc(mx)));
        if (mx < mn) mx = mn;
        scale = {
          min: mn,
          max: mx,
          minLabel: asStr(sc.minLabel, 80),
          maxLabel: asStr(sc.maxLabel, 80)
        };
      }
      return {
        kind: "task",
        taskId: asStr(it.taskId, 260) || genId("t"),
        text: asStr(text, 240),
        answerType,
        scale,
        requiresDone: boolDefault(it.requiresDone, true)
      };
    }

    // Unknown: ignore (fail-safe)
    return { kind: "", text: "" };
  }

  // Create task/question records (shape is conservative to not break consumers)
  function makeTaskRecord(opts) {
    const now = Date.now();
    return {
      taskId: opts.taskId || genId("t"),
      empNo: opts.empNo,
      text: opts.text,
      answerType: opts.answerType || "checkbox",
      scale: opts.scale || null,
      requiresDone: boolDefault(opts.requiresDone, true),
      done: false,
      doneAt: null,
      createdAt: now,
      updatedAt: now,
      // traceability
      _origin: opts.origin,
      _pkgKey: opts.pkgKey,
      _blockKey: opts.blockKey
    };
  }

  function makeQuestionRecord(opts) {
    const now = Date.now();
    return {
      questionId: opts.questionId || genId("q"),
      empNo: opts.empNo,
      text: opts.text,
      answerType: opts.answerType || "text",
      options: Array.isArray(opts.options) ? opts.options.slice(0, 10) : [],
      requiresAnswer: boolDefault(opts.requiresAnswer, true),
      // answers are stored elsewhere (AO-013_ANSWERS_V1), keep question itself clean
      createdAt: now,
      updatedAt: now,
      // traceability
      _origin: opts.origin,
      _pkgKey: opts.pkgKey,
      _blockKey: opts.blockKey
    };
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

    let scanned = 0;
    let tasksAdded = 0;
    let questionsAdded = 0;
    let itemsAdded = 0;

    for (const pkg of activePkgs) {
      const pkgKey = stablePackageKey(pkg);
      const blocks = getBlocksFromPackage(pkg);
      if (!blocks.length) continue;

      for (const empNoRaw of empNos) {
        const empNo = asStr(empNoRaw, 20);
        if (!empNo) continue;

        const rec = asgN.map[empNoRaw];
        const scopeId = extractScopeId(rec);
        if (!scopeId) continue; // same behavior as earlier

        for (let bi = 0; bi < blocks.length; bi++) {
          if (scanned >= MAX_SCAN) {
            return { ok: false, dryRun, reasons: [`Stop: för många poster att scanna (${MAX_SCAN}).`] };
          }
          scanned++;

          const block = blocks[bi] || {};

          // 1) NEW: block-bank container with items[]
          const itemsArr = Array.isArray(block.items) ? block.items : null;
          if (itemsArr && itemsArr.length) {
            const blockKey = stableBlockKey(block, "container", bi);

            for (let ii = 0; ii < itemsArr.length; ii++) {
              if (scanned >= MAX_SCAN) {
                return { ok: false, dryRun, reasons: [`Stop: för många poster att scanna (${MAX_SCAN}).`] };
              }
              scanned++;

              const itN = normalizeBankItem(itemsArr[ii]);
              const k = itN.kind;
              if (k !== "question" && k !== "task") continue; // ignore document/info

              const itemKey = stableItemKey(itemsArr[ii], ii);
              const origin = originKey(pkgKey, blockKey, itemKey, empNo);

              if (k === "question") {
                if (questionOrigins.has(origin)) continue;
                questionOrigins.add(origin);

                const qRec = makeQuestionRecord({
                  origin,
                  pkgKey,
                  blockKey,
                  empNo,
                  questionId: itN.questionId,
                  text: itN.text,
                  answerType: itN.answerType,
                  options: itN.options,
                  requiresAnswer: itN.requiresAnswer
                });

                questions.push(qRec);
                questionsAdded++;
                itemsAdded++;
              }

              if (k === "task") {
                if (taskOrigins.has(origin)) continue;
                taskOrigins.add(origin);

                const tRec = makeTaskRecord({
                  origin,
                  pkgKey,
                  blockKey,
                  empNo,
                  taskId: itN.taskId,
                  text: itN.text,
                  answerType: itN.answerType,
                  scale: itN.scale,
                  requiresDone: itN.requiresDone
                });

                tasks.push(tRec);
                tasksAdded++;
                itemsAdded++;
              }
            }

            continue; // container path handled
          }

          // 2) OLD: direct block kind/type
          const kind = normKind(block && (block.type || block.kind) || "");
          if (!kind) continue;

          // ignore info/document in old path
          if (kind === "info" || kind === "document") continue;

          const blockKey = stableBlockKey(block, kind, bi);
          const origin = originKey(pkgKey, blockKey, "root", empNo);

          // Text fields: prefer text/description, else title
          const baseText =
            asStr(block.text || block.description || "", 240) ||
            asStr(block.title || "", 240);

          if (!baseText) continue;

          // If "both", we create both a task and a question using same text
          if (kind === "question" || kind === "both") {
            if (!questionOrigins.has(origin)) {
              questionOrigins.add(origin);

              const at = (asStr(block.answerType, 20).toLowerCase() === "choice") ? "choice" : "text";
              const opts = (at === "choice" && Array.isArray(block.options))
                ? block.options.map(o => asStr(o, 80)).filter(Boolean).slice(0, 10)
                : [];

              const qRec = makeQuestionRecord({
                origin,
                pkgKey,
                blockKey,
                empNo,
                questionId: asStr(block.questionId, 260) || genId("q"),
                text: baseText,
                answerType: at,
                options: opts,
                requiresAnswer: boolDefault(block.requiresAnswer, true)
              });

              questions.push(qRec);
              questionsAdded++;
            }
          }

          if (kind === "task" || kind === "both") {
            if (!taskOrigins.has(origin)) {
              taskOrigins.add(origin);

              const at = (asStr(block.answerType, 20).toLowerCase() === "scale") ? "scale" : "checkbox";
              let scale = null;
              if (at === "scale") {
                const sc = block.scale || {};
                let mn = Number(sc.min);
                let mx = Number(sc.max);
                if (!Number.isFinite(mn)) mn = 1;
                if (!Number.isFinite(mx)) mx = 5;
                mn = Math.max(1, Math.min(10, Math.trunc(mn)));
                mx = Math.max(1, Math.min(10, Math.trunc(mx)));
                if (mx < mn) mx = mn;
                scale = {
                  min: mn,
                  max: mx,
                  minLabel: asStr(sc.minLabel, 80),
                  maxLabel: asStr(sc.maxLabel, 80)
                };
              }

              const tRec = makeTaskRecord({
                origin,
                pkgKey,
                blockKey,
                empNo,
                taskId: asStr(block.taskId, 260) || genId("t"),
                text: baseText,
                answerType: at,
                scale,
                requiresDone: boolDefault(block.requiresDone, true)
              });

              tasks.push(tRec);
              tasksAdded++;
            }
          }
        }
      }
    }

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        stats: {
          activePackages: activePkgs.length,
          employees: empNos.length,
          scanned,
          itemsAdded,
          tasksAdded,
          questionsAdded
        }
      };
    }

    const wT = writeJson(TASKS_KEY, tasks);
    if (!wT.ok) return { ok: false, dryRun: false, reasons: [wT.err || "Kunde inte skriva tasks."] };

    const wQ = writeJson(QUESTIONS_KEY, questions);
    if (!wQ.ok) return { ok: false, dryRun: false, reasons: [wQ.err || "Kunde inte skriva questions."] };

    return {
      ok: true,
      dryRun: false,
      stats: {
        activePackages: activePkgs.length,
        employees: empNos.length,
        scanned,
        itemsAdded,
        tasksAdded,
        questionsAdded
      }
    };
  }

  // Exponera ett stabilt API (UI-only)
  // - körs inte automatiskt (sidor kan kalla window.HROnboardMaterialize.materialize())
  window.HROnboardMaterialize = Object.freeze({
    materialize
  });
})();
