<!-- ============================================================
FIL 2/2: admin/onboard-materialize.js  (PROD HEL FIL)
AO-ONBOARD-MATERIALIZE-02 (PROD)
Projekt: HR-System
Syfte: Materialisera onboarding (AO-050_PACKAGES_V1) → TASKS + QUESTIONS
Policy:
- UI-only • Fail-closed
- Inga nya storage-keys
- Läser: AO-050_PACKAGES_V1, AO-020_ROLE_ASSIGNMENTS_V2, AO-014_TASKS_V1, AO-012_QUESTIONS_V1
- Skriver: AO-014_TASKS_V1, AO-012_QUESTIONS_V1
- Idempotent via _origin
============================================================ -->
<script>
(function(){
  "use strict";

  const PACKAGES_KEY   = "AO-050_PACKAGES_V1";
  const TASKS_KEY      = "AO-014_TASKS_V1";
  const QUESTIONS_KEY  = "AO-012_QUESTIONS_V1";
  const ASG_KEY        = "AO-020_ROLE_ASSIGNMENTS_V2";

  const SPECIAL_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const MAX_BLOCKS_SCAN = 50000;

  function safeParse(raw){
    try{
      if(raw == null) return { ok:true, value:null };
      return { ok:true, value: JSON.parse(raw) };
    }catch{
      return { ok:false, value:null };
    }
  }

  function readJson(key){
    let raw = null;
    try{ raw = localStorage.getItem(key); }catch{ raw = null; }
    const p = safeParse(raw);
    if(!p.ok) return { ok:false, err: `${key} är korrupt JSON.` };
    return { ok:true, value: p.value };
  }

  function writeJson(key, value){
    try{
      localStorage.setItem(key, JSON.stringify(value));
      return { ok:true };
    }catch{
      return { ok:false, err: "Kunde inte spara (localStorage fullt/blockerat)." };
    }
  }

  function isObj(x){ return !!x && typeof x === "object" && !Array.isArray(x); }

  function normalizeAssignments(raw){
    if(raw == null) return { ok:false, map: Object.create(null), err: `${ASG_KEY} saknas (null).` };
    if(!isObj(raw)) return { ok:false, map: Object.create(null), err: `${ASG_KEY} måste vara ett objekt.` };

    const out = Object.create(null);
    for(const k of Object.keys(raw)){
      const key = String(k);
      if(SPECIAL_KEYS.has(key)){
        return { ok:false, map: Object.create(null), err: `${ASG_KEY} innehåller blockerad special-key (${key}).` };
      }
      out[key] = raw[key];
    }
    return { ok:true, map: out };
  }

  function asStr(x, max){
    const s = String(x ?? "").trim();
    if(!s) return "";
    return (max && s.length > max) ? s.slice(0, max) : s;
  }

  function normKind(block){
    const k = asStr(block?.type || block?.kind || "", 20).toLowerCase();
    if(k === "task" || k === "question" || k === "both" || k === "info" || k === "document") return k;
    return "";
  }

  function genId(prefix){
    return prefix + "_" + Date.now().toString(16) + "_" + Math.random().toString(16).slice(2,8);
  }

  function originKey(pkgId, blockId, empNo){
    // Stabil dedupe. blockId kan saknas i vissa legacy -> fallback via title-index (men försök alltid med id först)
    const p = asStr(pkgId, 120) || "pkg";
    const b = asStr(blockId, 120) || "blk";
    const e = asStr(empNo, 20) || "emp";
    return `${p}:${b}:${e}`;
  }

  function ensureArrayShape(key, raw){
    if(raw == null) return { ok:true, arr: [] };
    if(!Array.isArray(raw)) return { ok:false, arr: [], err: `${key} måste vara en array.` };
    return { ok:true, arr: raw };
  }

  function buildOriginSet(arr){
    const set = new Set();
    for(const x of arr){
      const o = asStr(x?._origin || "", 300);
      if(o) set.add(o);
    }
    return set;
  }

  function materialize(opts){
    const dryRun = !!(opts && opts.dryRun);

    const reasons = [];

    const pPackages = readJson(PACKAGES_KEY);
    if(!pPackages.ok) reasons.push(pPackages.err);

    const pAsg = readJson(ASG_KEY);
    if(!pAsg.ok) reasons.push(pAsg.err);

    const pTasks = readJson(TASKS_KEY);
    if(!pTasks.ok) reasons.push(pTasks.err);

    const pQuestions = readJson(QUESTIONS_KEY);
    if(!pQuestions.ok) reasons.push(pQuestions.err);

    if(reasons.length){
      return { ok:false, dryRun, reasons };
    }

    const packages = pPackages.value ?? [];
    if(!Array.isArray(packages)){
      return { ok:false, dryRun, reasons:[`${PACKAGES_KEY} måste vara en array.`] };
    }

    const asgN = normalizeAssignments(pAsg.value ?? {});
    if(!asgN.ok){
      return { ok:false, dryRun, reasons:[asgN.err] };
    }

    const tN = ensureArrayShape(TASKS_KEY, pTasks.value);
    if(!tN.ok) return { ok:false, dryRun, reasons:[tN.err] };

    const qN = ensureArrayShape(QUESTIONS_KEY, pQuestions.value);
    if(!qN.ok) return { ok:false, dryRun, reasons:[qN.err] };

    const tasks = tN.arr.slice();
    const questions = qN.arr.slice();

    const taskOrigins = buildOriginSet(tasks);
    const questionOrigins = buildOriginSet(questions);

    const empNos = Object.keys(asgN.map);
    const activePkgs = packages.filter(p => String(p?.status || "").trim() === "active");

    let blocksScanned = 0;
    let tasksAdded = 0;
    let questionsAdded = 0;

    for(const pkg of activePkgs){
      const pkgId = asStr(pkg?.id || "", 140);
      const blocks = Array.isArray(pkg?.blocks) ? pkg.blocks : [];
      if(!blocks.length) continue;

      for(const empNoRaw of empNos){
        const empNo = asStr(empNoRaw, 20);
        if(!empNo) continue;

        const rec = asgN.map[empNoRaw];
        const scopeId = asStr(rec?.scopeId || "", 140);
        if(!scopeId) continue;

        for(let bi=0; bi<blocks.length; bi++){
          if(blocksScanned >= MAX_BLOCKS_SCAN){
            return { ok:false, dryRun, reasons:[`Stop: för många block att scanna (${MAX_BLOCKS_SCAN}).`] };
          }
          blocksScanned++;

          const block = blocks[bi] || {};
          const kind = normKind(block);
          if(!kind) continue;

          // Skippa info/document (read-only / ej görbara i TASKS/QUESTIONS)
          if(kind === "info" || kind === "document") continue;

          const blockId = asStr(block?.id || "", 140) || ("idx_" + String(bi));
          const origin = originKey(pkgId, blockId, empNo);

          const title = asStr(block?.title || "Block", 80) || "Block";
          const text = asStr(block?.text || block?.description || "", 2000);

          if(kind === "task" || kind === "both"){
            if(!taskOrigins.has(origin)){
              tasksAdded++;
              taskOrigins.add(origin);
              tasks.push({
                id: genId("task"),
                title,
                text,
                empNo,
                scopeId,
                status: "open",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                updatedBy: "system",
                _origin: origin
              });
            }
          }

          if(kind === "question" || kind === "both"){
            if(!questionOrigins.has(origin)){
              questionsAdded++;
              questionOrigins.add(origin);
              questions.push({
                id: genId("q"),
                title,
                text,
                empNo,
                scopeId,
                createdAt: Date.now(),
                _origin: origin
              });
            }
          }
        }
      }
    }

    // Fail-closed: om dryRun -> inga writes
    if(dryRun){
      return {
        ok:true,
        dryRun:true,
        activePackages: activePkgs.length,
        assignmentsEmpCount: empNos.length,
        blocksScanned,
        tasksAdded,
        questionsAdded,
        tasksTotalAfter: tasks.length,
        questionsTotalAfter: questions.length
      };
    }

    const w1 = writeJson(TASKS_KEY, tasks);
    if(!w1.ok){
      return { ok:false, dryRun:false, reasons:[`Skrivfel TASKS: ${w1.err}`] };
    }

    const w2 = writeJson(QUESTIONS_KEY, questions);
    if(!w2.ok){
      // fail-closed-ish: vi kan inte rulla tillbaka TASKS säkert utan ny key, så vi STOPPAR och rapporterar
      return { ok:false, dryRun:false, reasons:[`Skrivfel QUESTIONS: ${w2.err}. OBS: TASKS kan ha uppdaterats.`] };
    }

    return {
      ok:true,
      dryRun:false,
      activePackages: activePkgs.length,
      assignmentsEmpCount: empNos.length,
      blocksScanned,
      tasksAdded,
      questionsAdded,
      tasksTotalAfter: tasks.length,
      questionsTotalAfter: questions.length
    };
  }

  // Export global (UI-kontrollerad körning)
  window.HR_ONBOARD_MATERIALIZE = materialize;

})();
</script>
