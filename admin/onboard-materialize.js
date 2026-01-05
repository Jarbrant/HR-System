<!-- ============================================================
AO-ONBOARD-MATERIALIZE-02 (PROD)
Projekt: HR-System
Syfte: Materialisera onboarding (packages-block) → TASKS + QUESTIONS
Policy:
- UI-only • Fail-closed
- Inga nya storage-keys
- Källa: AO-050_PACKAGES_V1 (packages-block.html)
============================================================ -->
<script>
(function(){
  "use strict";

  const PACKAGES_KEY  = "AO-050_PACKAGES_V1";
  const TASKS_KEY     = "AO-014_TASKS_V1";
  const QUESTIONS_KEY = "AO-012_QUESTIONS_V1";
  const ASG_KEY       = "AO-020_ROLE_ASSIGNMENTS_V2";

  function read(key, fallback){
    try{
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    }catch{
      return fallback;
    }
  }

  function write(key, value){
    try{
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    }catch{
      return false;
    }
  }

  function genId(prefix){
    return prefix + "_" + Date.now().toString(16) + "_" + Math.random().toString(16).slice(2,8);
  }

  function materialize(){
    const packages = read(PACKAGES_KEY, []);
    const tasks = read(TASKS_KEY, []);
    const questions = read(QUESTIONS_KEY, []);
    const assignments = read(ASG_KEY, {});

    if(!Array.isArray(packages)) return;

    packages.forEach(pkg => {
      if(pkg.status !== "active") return;
      if(!Array.isArray(pkg.blocks)) return;

      Object.keys(assignments).forEach(empNo => {
        const scopeId = assignments[empNo]?.scopeId;
        if(!scopeId) return;

        pkg.blocks.forEach(block => {
          const origin = `${pkg.id}:${block.id}:${empNo}`;

          /* === TASK === */
          if(block.type === "task" || block.type === "both"){
            const exists = tasks.some(t => t._origin === origin);
            if(!exists){
              tasks.push({
                id: genId("task"),
                title: block.title || "Uppgift",
                text: block.text || "",
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

          /* === QUESTION === */
          if(block.type === "question" || block.type === "both"){
            const existsQ = questions.some(q => q._origin === origin);
            if(!existsQ){
              questions.push({
                id: genId("q"),
                title: block.title || "Fråga",
                text: block.text || "",
                empNo,
                scopeId,
                createdAt: Date.now(),
                _origin: origin
              });
            }
          }
        });
      });
    });

    write(TASKS_KEY, tasks);
    write(QUESTIONS_KEY, questions);
  }

  window.HR_ONBOARD_MATERIALIZE = materialize;
})();
</script>
