<!-- ============================================================
AO-ONBOARD-MATERIALIZE-01 (PROD)
Projekt: HR-System
Syfte: Materialisera onboarding-plan → TASKS + QUESTIONS (employee)
Policy:
- UI-only • Fail-closed
- Inga nya storage-keys
- Inga dubletter
- Ingen persondata (endast empNo)
============================================================ -->
<script>
(function(){
  "use strict";

  const PLANS_KEY     = "AO-060_PLANS_V1";
  const BLOCKS_KEY    = "AO-057_TRAININGS_V1";
  const TASKS_KEY     = "AO-014_TASKS_V1";
  const QUESTIONS_KEY= "AO-012_QUESTIONS_V1";
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
    const plans   = read(PLANS_KEY, []);
    const blocks  = read(BLOCKS_KEY, []);
    const tasks   = read(TASKS_KEY, []);
    const questions = read(QUESTIONS_KEY, []);
    const asg     = read(ASG_KEY, {});

    if(!Array.isArray(plans) || !Array.isArray(blocks)) return;

    const activePlans = plans.filter(p => p.status === "active");

    activePlans.forEach(plan => {
      plan.items.forEach(item => {
        const training = blocks.find(b => b.id === item.trainingId);
        if(!training || !Array.isArray(training.blocks)) return;

        Object.keys(asg).forEach(empNo => {
          const scopeId = asg[empNo]?.scopeId;
          if(!scopeId) return;

          training.blocks.forEach(block => {
            const key = `${plan.id}:${training.id}:${block.id}:${empNo}`;

            /* ===== TASK ===== */
            if(block.type === "task" || block.type === "both"){
              const exists = tasks.some(t => t._origin === key);
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
                  _origin: key
                });
              }
            }

            /* ===== QUESTION ===== */
            if(block.type === "question" || block.type === "both"){
              const existsQ = questions.some(q => q._origin === key);
              if(!existsQ){
                questions.push({
                  id: genId("q"),
                  title: block.title || "Fråga",
                  text: block.text || "",
                  empNo,
                  scopeId,
                  createdAt: Date.now(),
                  _origin: key
                });
              }
            }
          });
        });
      });
    });

    write(TASKS_KEY, tasks);
    write(QUESTIONS_KEY, questions);
  }

  /* === EXPOSE SAFE ENTRY === */
  window.HR_ONBOARD_MATERIALIZE = materialize;

})();
</script>

