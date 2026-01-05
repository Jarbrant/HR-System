/* ============================================================
AO-ONBOARD-MATERIALIZE-02 (PROD) | FIL-ID: admin/onboard-materialize.js
Projekt: HR-System (GitHub Pages / localStorage-first)
Syfte: Materialisera onboarding (packages-block) → TASKS + QUESTIONS

POLICY (LÅST):
- UI-only • Fail-closed
- Inga nya storage-keys
- Källa: AO-050_PACKAGES_V1 (packages-block.html)
- XSS: skriver endast data till storage (rendering sker XSS-säkert i UI)
- HARDEN: assignments object-only + block __proto__/constructor/prototype

KEYS (LÅST):
- Läser:  AO-050_PACKAGES_V1, AO-020_ROLE_ASSIGNMENTS_V2
- Skriver: AO-014_TASKS_V1, AO-012_QUESTIONS_V1

Notering:
- Dedupe görs via deterministiskt ID baserat på origin (ingen extra _origin-field).
============================================================ */
(function(){
  "use strict";

  const PACKAGES_KEY  = "AO-050_PACKAGES_V1";
  const TASKS_KEY     = "AO-014_TASKS_V1";
  const QUESTIONS_KEY = "AO-012_QUESTIONS_V1";
  const ASG_KEY       = "AO-020_ROLE_ASSIGNMENTS_V2";

  const SPECIAL_KEYS = new Set(["__proto__", "prototype", "constructor"]);

  // -----------------------------
  // Safe storage helpers
  // -----------------------------
  function safeJsonParse(raw, fallback){
    if(typeof raw !== "string" || !raw) return fallback;
    try{
      const v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    }catch{
      return fallback;
    }
  }

  function readLocal(key, fallback){
    try{
      return safeJsonParse(localStorage.getItem(String(key||"")) || "", fallback);
    }catch{
      return fallback;
    }
  }

  function writeLocalFailClosed(key, value){
    try{
      localStorage.setItem(String(key||""), JSON.stringify(value));
      return true;
    }catch{
      return false;
    }
  }

  // -----------------------------
  // Normalizers / validators
  // -----------------------------
  function normalizeEmpNoDigitsOnly(v){
    const s = String(v ?? "").trim();
    const digits = s.replace(/[^\d]/g, "");
    return digits;
  }

  function isPlainObject(v){
    if(v === null || typeof v !== "object") return false;
    if(Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  }

  function hasBlockedSpecialKeysShallow(obj){
    if(!obj || typeof obj !== "object") return false;
    try{
      for(const k of Object.keys(obj)){
        if(SPECIAL_KEYS.has(String(k))) return true;
      }
    }catch{
      return true; // fail-closed
    }
    return false;
  }

  function normalizeAssignmentsV2ObjectOnly(raw){
    // KRAV: object-only + hardening
    if(raw === null || raw === undefined){
      return { ok:false, map:Object.create(null), reason:"Assignments saknas (null/undefined)." };
    }
    if(!isPlainObject(raw)){
      return { ok:false, map:Object.create(null), reason:"Assignments korrupt (ej plain object)." };
    }
    if(hasBlockedSpecialKeysShallow(raw)){
      return { ok:false, map:Object.create(null), reason:"Assignments innehåller blockerade special-keys." };
    }

    const out = Object.create(null);
    try{
      for(const k of Object.keys(raw)){
        const key = String(k);
        if(SPECIAL_KEYS.has(key)) return { ok:false, map:Object.create(null), reason:"Assignments innehåller blockerade special-keys." };

        const rec = raw[key];
        // shallow hardening på value också
        if(rec && typeof rec === "object" && hasBlockedSpecialKeysShallow(rec)){
          return { ok:false, map:Object.create(null), reason:"Assignments value innehåller blockerade special-keys." };
        }
        out[key] = rec;
      }
    }catch{
      return { ok:false, map:Object.create(null), reason:"Assignments kunde inte läsas säkert." };
    }

    return { ok:true, map:out, reason:"" };
  }

  function normalizePackages(raw){
    return Array.isArray(raw) ? raw : [];
  }

  function normalizeBlocks(raw){
    return Array.isArray(raw) ? raw : [];
  }

  function normalizeBlockType(t){
    const s = String(t || "").trim().toLowerCase();
    if(s === "task" || s === "question" || s === "both") return s;
    return ""; // okänt -> skip
  }

  function safeText(v, maxLen){
    const s = String(v ?? "").trim();
    if(!s) return "";
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  }

  // -----------------------------
  // Deterministic ID for dedupe
  // (FNV-1a 32-bit -> hex)
  // -----------------------------
  function fnv1a32(str){
    let h = 0x811c9dc5;
    const s = String(str || "");
    for(let i=0; i<s.length; i++){
      h ^= s.charCodeAt(i);
      // h *= 16777619 (via shifts)
      h = (h + (h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24)) >>> 0;
    }
    return h >>> 0;
  }

  function makeDetId(prefix, origin){
    const hex = fnv1a32(origin).toString(16).padStart(8,"0");
    return String(prefix) + "_" + hex;
  }

  // -----------------------------
  // Materialize core
  // -----------------------------
  function materialize(){
    // Läs allt (robust)
    const packagesRaw = readLocal(PACKAGES_KEY, []);
    const asgRaw      = readLocal(ASG_KEY, null);

    const packages = normalizePackages(packagesRaw);

    const asgNorm = normalizeAssignmentsV2ObjectOnly(asgRaw);
    if(!asgNorm.ok){
      // fail-closed: skriv INGET om assignments är korrupt
      return { ok:false, reason: asgNorm.reason || "Assignments korrupt (fail-closed)." };
    }

    // Tasks/questions måste vara arrayer. Om korrupt -> fail-closed (skriv inget).
    const tasksRaw = readLocal(TASKS_KEY, null);
    const qsRaw    = readLocal(QUESTIONS_KEY, null);

    const tasks = (tasksRaw === null) ? [] : tasksRaw;
    const questions = (qsRaw === null) ? [] : qsRaw;

    if(!Array.isArray(tasks)) return { ok:false, reason:"Tasks korrupt (förväntar array). (fail-closed)" };
    if(!Array.isArray(questions)) return { ok:false, reason:"Questions korrupt (förväntar array). (fail-closed)" };
    if(!Array.isArray(packages)) return { ok:false, reason:"Packages korrupt (förväntar array). (fail-closed)" };

    // Index för snabb dedupe (på id)
    const taskIds = new Set(tasks.map(t => String(t?.id || "").trim()).filter(Boolean));
    const qIds    = new Set(questions.map(q => String(q?.id || "").trim()).filter(Boolean));

    let addedTasks = 0;
    let addedQs = 0;

    const now = Date.now();

    // För varje active package, för varje empNo i assignments, skapa tasks/questions för blocks
    for(const pkg of packages){
      const pkgId = String(pkg?.id || "").trim();
      const status = String(pkg?.status || "").trim().toLowerCase();
      if(status !== "active") continue;

      const blocks = normalizeBlocks(pkg?.blocks);
      if(!pkgId || blocks.length === 0) continue;

      // empNo keys i assignments-map
      for(const k of Object.keys(asgNorm.map)){
        const empNo = normalizeEmpNoDigitsOnly(k);
        if(!empNo) continue;

        const rec = asgNorm.map[k];
        const scopeId = String(rec?.scopeId || "").trim();
        if(!scopeId) continue;

        for(const block of blocks){
          const blockId = String(block?.id || "").trim();
          const type = normalizeBlockType(block?.type);
          if(!blockId || !type) continue;

          const title = safeText(block?.title || (type === "question" ? "Fråga" : "Uppgift"), 120) || (type === "question" ? "Fråga" : "Uppgift");
          const text  = safeText(block?.text || "", 4000);

          // origin = pkgId:blockId:empNo  (samma som din idé, men utan att lagra _origin)
          const origin = pkgId + ":" + blockId + ":" + empNo;

          // TASK
          if(type === "task" || type === "both"){
            const id = makeDetId("task", "task|" + origin);
            if(!taskIds.has(id)){
              tasks.push({
                id,
                title,
                text,
                empNo,
                scopeId,
                status: "open",
                employeeComment: "",
                createdAt: now,
                updatedAt: now,
                updatedBy: "system"
              });
              taskIds.add(id);
              addedTasks++;
            }
          }

          // QUESTION
          if(type === "question" || type === "both"){
            const id = makeDetId("q", "q|" + origin);
            if(!qIds.has(id)){
              questions.push({
                id,
                title,
                text,
                empNo,
                scopeId,
                createdAt: now
              });
              qIds.add(id);
              addedQs++;
            }
          }
        }
      }
    }

    // Skriv endast om vi fortfarande är i OK-läge (och storage går att skriva)
    const okT = writeLocalFailClosed(TASKS_KEY, tasks);
    if(!okT) return { ok:false, reason:"Kunde inte skriva TASKS (localStorage fullt/blockerat)." };

    const okQ = writeLocalFailClosed(QUESTIONS_KEY, questions);
    if(!okQ) return { ok:false, reason:"Kunde inte skriva QUESTIONS (localStorage fullt/blockerat)." };

    return { ok:true, addedTasks, addedQs };
  }

  // Exponera för UI-knapp / devtools
  window.HR_ONBOARD_MATERIALIZE = materialize;

})();
