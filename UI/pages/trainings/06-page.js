/* ============================================================
AO-TRAININGS-AI-PROMPT-CONTRACT-01 | FILE 06/06 | FIL-ID: UI/pages/trainings/06-page.js
Projekt: HR-System
Syfte: Bootstrap + event wiring (trainings)
Policy: UI-only • Fail-closed • inga nya storage-keys • XSS-safe
============================================================ */
(function () {
  "use strict";

  // namespace + idempotent
  const NS = (window.Trainings = window.Trainings || {});
  if (NS.page) return;

  // --- PASTE: hela din befintliga BLOCK 11/11-kod här (IIFE-innehållet) ---
  // Tips: klistra in från raden: (function(){  till raden: })();
  // (och ta bort den extra (function(){...})(); runtom så att du inte får dubbel-IIFE)

  NS.page = { ok: true };
})();
<!-- ============================================================
       BLOCK 11/11 — CORE ENGINE (JS) [PROD]
  ============================================================ -->
  <script>
  (function(){
    "use strict";

    const KEY_TRAININGS = "AO-057_TRAININGS_V1";
    const KEY_AUTH      = "AO-001_LOGIN_V1";

    function $(id){ return document.getElementById(id); }
    function safeStr(v){ return (v === null || v === undefined) ? "" : String(v); }
    function trimStr(v){ return safeStr(v).trim(); }
    function nowTs(){ return Date.now(); }

    function stableHash(str){
      const s = safeStr(str);
      let h = 2166136261;
      for (let i=0;i<s.length;i++){
        h ^= s.charCodeAt(i);
        h = (h * 16777619) >>> 0;
      }
      return ("00000000" + h.toString(16)).slice(-8);
    }
    function mkId(prefix, seed){
      const h = stableHash(prefix + "|" + safeStr(seed));
      return prefix + "_" + h;
    }

    function setPill(pillEl, textEl, mode, text){
      try{
        if (!pillEl || !textEl) return;
        pillEl.className = "pill" + (mode ? (" " + mode) : "");
        textEl.textContent = text;
      }catch(_){}
    }
    function setStateInfo(mode, text){
      setPill($("statePill"), $("stateText"), mode, text);
    }

    // NOTE(CLEANUP): Worker-pill borttagen i UI. Vi behåller state internt och skriver ev. status i aiHint.
    function setWorkerInfo(ok, msg){
      window.STATE.lastWorkerOk = (ok === true) ? true : (ok === false) ? false : null;
      window.STATE.lastWorkerMsg = safeStr(msg);
      const hint = $("aiHint");
      if (hint){
        if (ok === true) hint.textContent = "Worker: OK";
        else if (ok === false) hint.textContent = "Worker: " + safeStr(msg || "Fel");
      }
    }

    function getWorkerBaseUrl(){
      try{ return trimStr(window.__HR_WORKER_BASE_URL || ""); }catch(_){ return ""; }
    }

    function ensureSDKOrFail(){
      try{
        const hint = $("aiHint") || $("revertHint");
        function say(msg){ try{ if (hint) hint.textContent = msg; }catch(_){ } }

        if (!window.HRWorkerSDK){
          setWorkerInfo(false, "SDK saknas");
          say("Fail-closed: HRWorkerSDK saknas.");
          return { ok:false };
        }

        const baseUrl = getWorkerBaseUrl();
        if (!baseUrl){
          setWorkerInfo(false, "Worker URL saknas");
          say("Fail-closed: Worker URL saknas (window.__HR_WORKER_BASE_URL).");
          return { ok:false };
        }

        if (!window.__HR_WORKER_SDK_INITED__){
          const requireAuth = !!window.__HR_WORKER_REQUIRE_AUTH;
          const r = window.HRWorkerSDK.init({
            baseUrl: baseUrl,
            requireAuth: requireAuth,
            getToken: function(){ return ""; } // POLICY: token lagras inte i klienten
          });
          if (!r || r.ok !== true){
            window.__HR_WORKER_SDK_INITED__ = false;
            setWorkerInfo(false, "SDK init misslyckades");
            say("Fail-closed: Kunde inte initiera SDK.");
            return { ok:false };
          }
          window.__HR_WORKER_SDK_INITED__ = true;
        }

        return { ok:true };
      }catch(_){
        try{ setWorkerInfo(false, "SDK init fel"); }catch(__){}
        return { ok:false };
      }
    }

    function readJSONStorage(key){
      try{
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
      }catch(_){ return null; }
    }
    function writeJSONStorage(key, value){
      try{
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      }catch(_){ return false; }
    }
    function asArray(v){ return Array.isArray(v) ? v : []; }

    // ============================================================
    // KURSPLAN-MOTOR (AO-01): 6 kapitel + steg 1–5
    // - Ingen ny datamodell: vi kodar in kapitel+steg i training.title.
    // - Parse/compose gör att UI alltid kan återställa valen.
    // - CHANGE(v2.6.3): auto-write av title/goals kräver courseTouched (eller force via AI).
    // ============================================================

    const COURSE_TITLES_6 = [
      "Introduktion",
      "Grundläggande färdighet",
      "Tillämpning",
      "Analys & förståelse",
      "Självständigt utförande",
      "Fördjupning & ansvar"
    ];

    const CHAPTER_FOCUS = {
      "Introduktion": "Begrepp, känna igen, enkla exempel, trygg start.",
      "Grundläggande färdighet": "Metodträning, repetera, en tydlig teknik, fler grunduppgifter.",
      "Tillämpning": "Scenario, använda kunskapen i verklig situation, praktiska beslut.",
      "Analys & förståelse": "Motivera, hitta fel, jämföra alternativ, resonera om varför.",
      "Självständigt utförande": "Utföra utan stöd, kombinera moment, leverera korrekt resultat.",
      "Fördjupning & ansvar": "Konsekvensbedömning, policy/rutin, kvalitetssäkring, ansvarstagande."
    };

    const STEP_1_5_DEFS = {
      "1": "Steg 1: introduktion. Känna igen, förstå begrepp, enkla exempel.",
      "2": "Steg 2: grundfärdighet. Enkla tillämpningar, en tydlig metod.",
      "3": "Steg 3: kombinera. Två steg, kort scenario, tolkning av text.",
      "4": "Steg 4: fördjupa. Motivera, hitta fel, resonera kring val.",
      "5": "Steg 5: tillämpa. Verkligt scenario, konsekvensbedömning, policy/rutin."
    };

    // Title-format (LÅST): "<KAPITEL> – Steg <1-5> – <OMRÅDE|MODUL>"
    function parseCourseFromTitle(title){
      const t = trimStr(title);
      const res = { chapter:"", step:"", tail:"" };
      if (!t) return res;

      // tillåt både – och -
      const m = t.match(/^(.+?)\s*[–-]\s*steg\s*([1-5])\s*[–-]\s*(.+)$/i);
      if (!m) return res;

      const chap = trimStr(m[1]);
      const step = trimStr(m[2]);
      const tail = trimStr(m[3]);

      if (COURSE_TITLES_6.indexOf(chap) === -1) return res;

      res.chapter = chap;
      res.step = step;
      res.tail = tail;
      return res;
    }

    function composeCourseTitle(modLabel, areaLabel, chapter, step){
      const c = trimStr(chapter) || "Introduktion";
      const s = String(step || "1");
      const a = trimStr(areaLabel);
      const m = trimStr(modLabel);
      const tail = a ? a : (m ? m : "Utbildning");
      return c + " – Steg " + s + " – " + tail;
    }

    function looksAutoGoals(goalsText){
      const g = trimStr(goalsText);
      if (!g) return false;
      const hasKapitel = (g.indexOf("Kapitel: ") !== -1);
      const hasSteg = (/\nSteg\s+[1-5]\s+–\s+fokus:/i).test("\n" + g);
      if (hasKapitel && hasSteg) return true;
      return false;
    }

    function isCourseTitleExactMatch(t){
      try{
        if (!t) return false;
        const modLabel = safeStr(t.mod || "");
        const areaLabel = safeStr(t.area || "");
        const parsed = parseCourseFromTitle(safeStr(t.title || ""));
        if (!parsed.chapter || !parsed.step) return false;
        if (!canCoursePlanAuto(modLabel, areaLabel, parsed.chapter, parsed.step)) return false;
        const exp = composeCourseTitle(modLabel, areaLabel, parsed.chapter, parsed.step);
        return exp === safeStr(t.title || "");
      }catch(_){ return false; }
    }

    // ============================================================
    // AO-TRAININGS-AI-PROMPT-CONTRACT-01: PROMPT BLUEPRINTS (CONST)
    // ============================================================

    const ANSWERKEY_SPEC_SHORT = [
      "FACIT_SPEC:",
      "- mcq: correctOption (A/B/C/D) + kort motivering.",
      "- short/numeric: entydigt svar + ev. enhetsangivelse.",
      "- calc: entydigt svar + 2-6 steg i worked_solution.",
      "- reason/concept: rubric (3-6 punkter) med vad som ger poäng.",
      "- alltid: common_mistakes (2-4) kort."
    ].join(" ");

    const VARIATION_SPEC_SHORT = [
      "VARIATION_SPEC:",
      "- Inga duplicerade frågor i batch.",
      "- Minst 5 frågetyper vid 12 frågor.",
      "- Progression styrs av KAPITEL + STEG_1_5: undvik att Steg 1 och Steg 2 känns lika.",
      "- Max 2 frågor med samma primära tag."
    ].join(" ");

    const MODULE_BLUEPRINTS = {
      grundkompetens: {
        goals: [
          "Kan kommunicera tydligt och återge instruktioner korrekt.",
          "Kan följa rutiner och upptäcka oklarheter.",
          "Kan förklara centrala begrepp med egna ord.",
          "Kan lösa grundläggande problem stegvis."
        ],
        area: {
          "Kommunikation & tydlighet": {
            goals: ["Tydlig återgivning", "Välja rätt kanal/ton", "Bekräfta förståelse"],
            stepHints: {
              "1":"Känna igen tydlig/otydlig formulering.",
              "2":"Omskriv en mening tydligare.",
              "3":"Välj bästa svar i ett scenario (kund/kollega).",
              "4":"Motivera varför ett svar är bäst + risk vid otydlighet.",
              "5":"Hantera konflikt/eskalering med konsekvensbedömning."
            },
            tags: ["tydlighet","budskap","återkoppling","missförstånd","ton"]
          }
        },
        mix12: { mcq:3, short:3, scenario:3, reason:2, error_find:1 }
      },

      matematik_logik: {
        goals: [
          "Kan använda procent i vardagsnära situationer.",
          "Kan omvandla mellan vanliga enheter korrekt.",
          "Kan resonera om tid och ordningsföljd.",
          "Kan lösa logiska problem stegvis."
        ],
        area: {
          "Procent & beräkningar": {
            goals: ["Beräkna procent av tal", "Beräkna förändring", "Tolkar procent i text"],
            stepHints: {
              "1":"Känna igen 10%, 25%, 50% i enkla fall.",
              "2":"Beräkna procent av ett tal (ett steg).",
              "3":"Två steg: rabatt + nytt pris eller del + helhet.",
              "4":"Felsök: hitta fel i en procentberäkning och rätta.",
              "5":"Tillämpa: jämför två alternativ och motivera."
            },
            tags: ["procent","rabatt","ökning","minskning","jämförelse"]
          },
          "Enheter & omvandling": {
            goals: ["Omvandla längd/vikt/volym", "Välja rätt enhet", "Rimlighetsbedömning"],
            stepHints: {
              "1":"Välj rätt enhet (g, kg, l, ml).",
              "2":"Enkel omvandling (t.ex. 1000 g = 1 kg).",
              "3":"Två steg eller blandade enheter i text.",
              "4":"Felsök fel enhet/decimalkomma.",
              "5":"Tillämpa i scenario (recept/logistik) och motivera."
            },
            tags: ["enheter","omvandling","gram","liter","rimlighet"]
          },
          "Tidsresonemang": {
            goals: ["Läsa tid", "Beräkna tidsskillnad", "Planera ordning"],
            stepHints: {
              "1":"Klockan hel/halv/kvart.",
              "2":"Skillnad i minuter/timmar (ett steg).",
              "3":"Tidtabell: start/slut med paus.",
              "4":"Felsök orimlig tidsplan.",
              "5":"Scenario: optimera tid med motivering."
            },
            tags: ["tid","minuter","timmar","schema","planering"]
          },
          "Logiskt tänkande": {
            goals: ["Mönster", "Om–så", "Uteslutning"],
            stepHints: {
              "1":"Fortsätt mönster (enkelt).",
              "2":"Om–så regler, en slutsats.",
              "3":"Två regler, dra slutsats.",
              "4":"Hitta motsägelse/fel i resonemang.",
              "5":"Lös ett logikpussel med motivering."
            },
            tags: ["logik","mönster","regler","uteslutning","slutsats"]
          }
        },
        mix12: { mcq:3, numeric:3, calc:3, reason:2, error_find:1 }
      },

      arbetsmiljo: {
        goals: [
          "Kan identifiera risker och beskriva rätt åtgärd.",
          "Kan följa säkerhetsrutiner och rapportera tillbud.",
          "Förstår grundläggande ergonomi.",
          "Känner till psykosociala risker och stödvägar."
        ],
        mix12: { mcq:3, short:3, scenario:4, reason:2, error_find:0 }
      },

      infosakerhet: {
        goals: [
          "Kan skapa och hantera säkra lösenord och konton.",
          "Kan känna igen phishing och agera rätt.",
          "Hanterar information säkert i vardagen.",
          "Vet hur incidenter rapporteras."
        ],
        mix12: { mcq:4, short:3, scenario:3, reason:2, error_find:0 }
      },

      hr_policy: {
        goals: [
          "Förstår uppförandekod och professionellt beteende.",
          "Vet vad trakasserier är och hur man agerar.",
          "Förstår jäv och undviker intressekonflikter.",
          "Känner till rapportvägar och eskalering."
        ],
        mix12: { mcq:3, short:3, scenario:4, reason:2, error_find:0 }
      },

      kvalitet: {
        goals: [
          "Kan beskriva avvikelsehantering och vad som ska rapporteras.",
          "Förstår orsak och åtgärd i enkla exempel.",
          "Kan följa rutiner och använda dokument korrekt.",
          "Förstår uppföljning och lärande."
        ],
        mix12: { mcq:3, short:3, scenario:3, reason:2, error_find:1 }
      },

      etik: {
        goals: [
          "Kan bemöta människor respektfullt.",
          "Kan sätta gränser och eskalera vid behov.",
          "Tar ansvar för sitt beteende och sina beslut.",
          "Kan kommunicera respektfullt även under stress."
        ],
        mix12: { mcq:3, short:3, scenario:4, reason:2, error_find:0 }
      },

      miljo: {
        goals: [
          "Kan sortera avfall och följa rutiner.",
          "Kan minska resursslöseri i vardagen.",
          "Kan känna igen enkla miljörisker.",
          "Kan beskriva förebyggande åtgärder."
        ],
        mix12: { mcq:3, short:3, scenario:3, reason:2, error_find:1 }
      },

      haccp: {
        goals: [
          "Kan identifiera biologiska/kemiska/fysiska faror.",
          "Förstår kritiska styrpunkter och kontroller.",
          "Kan temperatur/hygien-rutiner och avvikelser.",
          "Kan beskriva åtgärder vid avvikelse."
        ],
        mix12: { mcq:3, short:3, scenario:3, reason:2, error_find:1 }
      },

      swot: {
        goals: [
          "Kan klassificera givna scenarier som S/W/O/T.",
          "Kan motivera klassificeringen kort.",
          "Kan känna igen gränsfall och välja bästa kategori.",
          "Följer låsningen: ingen fri analys, endast klassificering."
        ],
        mix12: { mcq:4, short:3, scenario:3, reason:2, error_find:0 }
      }
    };

    const MODULE_STOMME = [
      { id:"grundkompetens", label:"Grundkompetens", subject:"generic",
        areas:["Kommunikation & tydlighet","Instruktioner & rutiner","Begrepp & förståelse","Grundläggande problemlösning"] },

      { id:"matematik_logik", label:"Matematik & logik", subject:"math",
        areas:["Procent & beräkningar","Enheter & omvandling","Tidsresonemang","Logiskt tänkande"] },

      { id:"arbetsmiljo", label:"Arbetsmiljö", subject:"work_environment",
        areas:["Risker & tillbud","Säkerhetsrutiner","Ergonomi (grund)","Psykosocial arbetsmiljö (grund)"] },

      { id:"infosakerhet", label:"Informationssäkerhet", subject:"information_security",
        areas:["Lösenord & konton","Phishing","Informationshantering","Incidentrapportering"] },

      { id:"hr_policy", label:"HR & policy", subject:"hr_policy",
        areas:["Uppförandekod","Trakasserier & likabehandling","Jäv","Rapportvägar"] },

      { id:"kvalitet", label:"Kvalitet & arbetssätt", subject:"quality",
        areas:["Avvikelsehantering","Orsak & åtgärd","Rutiner & dokument","Uppföljning"] },

      { id:"etik", label:"Etik & bemötande", subject:"ethics",
        areas:["Bemötande","Gränssättning","Ansvar & eskalering","Respektfull kommunikation"] },

      { id:"miljo", label:"Miljö", subject:"environment",
        areas:["Avfall & sortering","Resurshushållning","Miljörisker i vardagen","Förebyggande åtgärder"] },

      { id:"haccp", label:"HACCP / Livsmedelssäkerhet", subject:"haccp",
        areas:["Faror (bio/kem/fys)","Kritiska styrpunkter","Temperatur & hygien","Avvikelse & åtgärd"] },

      { id:"swot", label:"SWOT & analys", subject:"swot",
        areas:["Identifiera styrkor/svagheter","Möjligheter & hot (givna scenarier)","Klassificering (inte fri analys)"] }
    ];

    function findModuleByLabel(label){
      const t = trimStr(label);
      if (!t) return null;
      for (let i=0;i<MODULE_STOMME.length;i++){
        if (MODULE_STOMME[i].label === t) return MODULE_STOMME[i];
      }
      return null;
    }

    function calcSubjectId(modLabel, areaLabel){
      const m = findModuleByLabel(modLabel);
      if (!m) return "generic";
      return m.subject || "generic";
    }

    function getModuleIdByLabel(modLabel){
      const m = findModuleByLabel(modLabel);
      return m ? safeStr(m.id || "") : "";
    }

    function getBlueprintFor(modId){
      const id = trimStr(modId);
      return (id && MODULE_BLUEPRINTS[id]) ? MODULE_BLUEPRINTS[id] : null;
    }

    function getFixedGoalsText(modId, areaLabel){
      const bp = getBlueprintFor(modId);
      if (!bp) return "";
      const base = asArray(bp.goals);
      const area = (bp.area && bp.area[areaLabel]) ? bp.area[areaLabel] : null;

      const lines = [];
      base.slice(0,5).forEach(g => lines.push("- " + safeStr(g)));
      if (area && Array.isArray(area.goals) && area.goals.length){
        lines.push("");
        lines.push("Område-mål:");
        area.goals.slice(0,4).forEach(g => lines.push("- " + safeStr(g)));
      }
      return lines.join("\n").trim();
    }

    function getAreaStepHint(modId, areaLabel, step){
      const bp = getBlueprintFor(modId);
      const area = (bp && bp.area && bp.area[areaLabel]) ? bp.area[areaLabel] : null;
      if (area && area.stepHints && area.stepHints[String(step)]) return safeStr(area.stepHints[String(step)]);
      return "";
    }

    function getTagHints(modId, areaLabel){
      const bp = getBlueprintFor(modId);
      const area = (bp && bp.area && bp.area[areaLabel]) ? bp.area[areaLabel] : null;
      const tags = area && Array.isArray(area.tags) ? area.tags : [];
      return tags.slice(0,8).map(t => safeStr(t)).filter(Boolean);
    }

    function getMixSpec(modId, qTypeUi){
      const bp = getBlueprintFor(modId);
      const mix = bp && bp.mix12 ? bp.mix12 : { mcq:3, short:3, scenario:3, reason:2, error_find:1 };

      const forced = trimStr(qTypeUi);
      if (forced && forced !== "auto"){
        if (forced === "mcq_single") return { mcq:12 };
        if (forced === "true_false") return { true_false:12 };
        if (forced === "numeric") return { numeric:12 };
        if (forced === "short_answer") return { short:12 };
      }
      return mix;
    }

    function mixToString(mix){
      const keys = Object.keys(mix || {});
      const parts = [];
      keys.forEach(k=>{
        const n = mix[k];
        if (typeof n === "number" && isFinite(n) && n > 0){
          parts.push(k + ":" + Math.round(n));
        }
      });
      return parts.join(", ");
    }

    function renderDatalist(listEl, values){
      try{
        if (!listEl) return;
        while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
        asArray(values).forEach(v=>{
          const o = document.createElement("option");
          o.value = safeStr(v);
          listEl.appendChild(o);
        });
      }catch(_){}
    }

    function refreshModuleLists(){
      renderDatalist($("modList"), MODULE_STOMME.map(m => m.label));
      const modVal = $("mod") ? $("mod").value : "";
      const m = findModuleByLabel(modVal);
      renderDatalist($("areaList"), m ? m.areas : []);
    }

    function updateSubjectCallout(){
      const modVal = $("mod") ? $("mod").value : "";
      const areaVal = $("area") ? $("area").value : "";
      const sid = calcSubjectId(modVal, areaVal);
      const out = $("subjectIdText");
      if (out) out.textContent = sid;
      window.STATE.subjectId = sid;
    }

    function syncQuestionControlsVisibility(){
      try{
        const content = $("aiContent") ? $("aiContent").value : "blocks";
        const qc = $("questionControls");
        if (!qc) return;
        if (content === "questions") qc.classList.remove("hide");
        else qc.classList.add("hide");
      }catch(_){}
    }

    function normalizeKind(rawKind){
      const k = trimStr(rawKind).toLowerCase();
      if (!k) return "info";
      if (k === "quiz") return "question";
      if (k === "doc") return "document";
      if (k === "information") return "info";
      if (k === "question") return "question";
      if (k === "task") return "task";
      if (k === "document") return "document";
      if (k === "info") return "info";
      if (k === "both") return "both";
      return k;
    }

    function ensureBlockMeta(b){
      if (!b.meta || typeof b.meta !== "object") b.meta = {};
      if (!("time" in b.meta)) b.meta.time = "";
      if (!("difficulty" in b.meta)) b.meta.difficulty = "";
      if (!("tags" in b.meta) || !Array.isArray(b.meta.tags)) b.meta.tags = [];
      if (!("feedbackEnabled" in b.meta)) b.meta.feedbackEnabled = false;
    }

    function bridgeAnswerKeyToLegacy(item0, raw){
      try{
        if (!item0 || typeof item0 !== "object") return;
        const ak = raw && (raw.answer_key || raw.answerKey || raw.answerKeyObj || null);
        if (!ak || typeof ak !== "object") return;

        if (!trimStr(item0.a)){
          const correct = ("correct" in ak) ? safeStr(ak.correct) : ("answer" in ak) ? safeStr(ak.answer) : "";
          if (trimStr(correct)) item0.a = correct;
        }

        const ws = ak.worked_solution || ak.workedSolution || ak.steps || null;
        if (Array.isArray(ws) && (!Array.isArray(item0.workedSteps) || item0.workedSteps.length === 0)){
          item0.workedSteps = ws.map(x => safeStr(x)).filter(Boolean).slice(0,6);
        }

        const rubric = Array.isArray(ak.rubric) ? ak.rubric : null;
        const cm = Array.isArray(ak.common_mistakes) ? ak.common_mistakes : null;

        const parts = [];
        if (rubric && rubric.length){
          parts.push("Bedömning:");
          rubric.slice(0,6).forEach(r=>{
            if (typeof r === "string") parts.push("- " + r);
            else if (r && typeof r === "object"){
              const txt = safeStr(r.point || r.text || r.criteria || "");
              const pts = ("points" in r) ? safeStr(r.points) : "";
              parts.push("- " + (pts ? ("(" + pts + "p) ") : "") + txt);
            }
          });
        }
        if (cm && cm.length){
          parts.push("Vanliga fel:");
          cm.slice(0,4).forEach(m=>{
            if (typeof m === "string") parts.push("- " + m);
            else if (m && typeof m === "object"){
              const what = safeStr(m.mistake || m.what || "");
              const note = safeStr(m.note || m.comment || "");
              parts.push("- " + what + (note ? (" – " + note) : ""));
            }
          });
        }
        const extra = parts.join("\n").trim();
        if (extra){
          if (!trimStr(item0.explanation)) item0.explanation = extra;
          else item0.explanation = (trimStr(item0.explanation) + "\n\n" + extra).trim();
        }
      }catch(_){}
    }

    function normalizeBlock(raw){
      const b = (raw && typeof raw === "object") ? raw : {};
      const kind = normalizeKind(b.kind || b.type || b.blockType);
      const title = safeStr(b.title);
      let items = asArray(b.items);

      if (!Array.isArray(items) || items.length === 0){
        if (kind === "info" || kind === "document"){
          const text = safeStr(b.text || b.content || "");
          items = [{ text }];
        } else if (kind === "task"){
          const instruction = safeStr(b.instruction || b.task || "");
          const deliverable = safeStr(b.deliverable || b.expected || "");
          items = [{ instruction, deliverable }];
        } else if (kind === "question"){
          const q = safeStr(b.question || b.q || "");
          const a = safeStr(b.answerKey || b.answer || b.a || "");
          const explanation = safeStr(b.explanation || "");
          const workedSteps = Array.isArray(b.workedSteps) ? b.workedSteps : [];
          items = [{ q, a, explanation, workedSteps }];
        } else if (kind === "both"){
          const instruction = safeStr(b.instruction || "");
          const deliverable = safeStr(b.deliverable || "");
          const q = safeStr(b.question || b.q || "");
          const a = safeStr(b.answerKey || b.answer || b.a || "");
          items = [{ instruction, deliverable, q, a }];
        }
      }

      const out = {
        id: trimStr(b.id),
        kind,
        title,
        items,
        meta: (b.meta && typeof b.meta === "object") ? b.meta : {}
      };

      ensureBlockMeta(out);

      if (!out.id){
        out.id = mkId("b", out.kind + "|" + trimStr(out.title));
      }

      if (!Array.isArray(out.items)) out.items = [];
      if (out.items.length === 0){
        if (out.kind === "info" || out.kind === "document") out.items = [{ text:"" }];
        else if (out.kind === "task") out.items = [{ instruction:"", deliverable:"" }];
        else if (out.kind === "question") out.items = [{ q:"", a:"", explanation:"", workedSteps:[] }];
        else if (out.kind === "both") out.items = [{ instruction:"", deliverable:"", q:"", a:"" }];
      } else {
        if (out.kind === "question"){
          const i0 = out.items[0] && typeof out.items[0] === "object" ? out.items[0] : {};
          if (!("q" in i0)) i0.q = "";
          if (!("a" in i0)) i0.a = "";
          if (!("explanation" in i0)) i0.explanation = "";
          if (!("workedSteps" in i0) || !Array.isArray(i0.workedSteps)) i0.workedSteps = [];

          bridgeAnswerKeyToLegacy(i0, b);
          out.items[0] = i0;
        }
      }

      return out;
    }

    function normalizeTraining(raw){
      const t = (raw && typeof raw === "object") ? raw : {};
      const out = {
        id: trimStr(t.id) || ("tr_" + nowTs()),
        mod: safeStr(t.mod || ""),
        area: safeStr(t.area || ""),
        title: safeStr(t.title || ""),
        desc: safeStr(t.desc || t.description || ""),
        goalsLevel: (trimStr(t.goalsLevel) || "normal"),
        goals: safeStr(t.goals || ""),
        status: (trimStr(t.status) === "published") ? "published" : "draft",
        blocks: []
      };

      const rawBlocks = asArray(t.blocks);
      out.blocks = rawBlocks.map((b, idx)=>{
        const nb = normalizeBlock(b);
        const base = trimStr(nb.title) ? trimStr(nb.title) : ("idx:" + idx);
        nb.id = mkId("b", nb.kind + "|" + base + "|idx:" + idx);
        return nb;
      });

      if (!["intro","normal","advanced"].includes(out.goalsLevel)) out.goalsLevel = "normal";
      return out;
    }

    function normalizeAll(list){
      const arr = asArray(list);
      const out = [];
      const seen = Object.create(null);

      for (let i=0;i<arr.length;i++){
        try{
          const nt = normalizeTraining(arr[i]);
          let id = trimStr(nt.id);

          if (!id || seen[id]){
            const seed = (trimStr(nt.title) || "untitled") + "|" + i + "|" + nowTs();
            nt.id = "tr_" + nowTs().toString(36) + "_" + i + "_" + stableHash(seed);
            id = nt.id;
          }
          seen[id] = true;
          out.push(nt);
        }catch(_){}
      }
      return out;
    }

    function isKnownKind(kind){
      return ["info","task","question","document","both"].includes(kind);
    }

    function canCoursePlanAuto(modLabel, areaLabel, chapter, step){
      if (!trimStr(modLabel)) return false;
      if (!trimStr(areaLabel)) return false;
      if (!trimStr(chapter) || COURSE_TITLES_6.indexOf(chapter) === -1) return false;
      const s = String(step || "1");
      if (!["1","2","3","4","5"].includes(s)) return false;
      return true;
    }

    function courseReadyByTouchOrExisting(){
      try{
        if (window.STATE.courseTouched) return true;
        const t = window.STATE.edit;
        if (!t) return false;
        const p = parseCourseFromTitle(safeStr(t.title || ""));
        return !!(p && p.chapter && p.step);
      }catch(_){ return false; }
    }

    function trainingProblems(t){
      const probs = [];
      if (!trimStr(t.title)) probs.push("Saknar titel");
      if (t.status === "published" && (!t.blocks || t.blocks.length === 0)) probs.push("Publicerad utan block");

      if (trimStr(t.mod) && trimStr(t.area) && trimStr(t.title)){
        const p = parseCourseFromTitle(t.title);
        if (!p.chapter || !p.step) probs.push("Titel saknar kursplan");
        else{
          const exp = composeCourseTitle(t.mod, t.area, p.chapter, p.step);
          if (exp !== t.title) probs.push("Titel stämmer ej med kursplan");
        }
      }

      const blocks = asArray(t.blocks);
      for (let i=0;i<blocks.length;i++){
        const b = blocks[i];
        if (!trimStr(b.title)) probs.push("Block saknar rubrik");
        if (!isKnownKind(b.kind)) probs.push("Okänd blocktyp");
        if (normalizeKind(b.kind) === "question"){
          const i0 = (b.items && b.items[0]) ? b.items[0] : {};
          if (!trimStr(i0.q)) probs.push("Fråga saknar text");
          if (!trimStr(i0.a)) probs.push("Fråga saknar facit");
        }
      }
      return probs;
    }

    function blockHasProblem(b){
      if (!b) return true;
      if (!trimStr(b.title)) return true;
      if (!isKnownKind(b.kind)) return true;
      if (normalizeKind(b.kind) === "question"){
        const i0 = (b.items && b.items[0]) ? b.items[0] : {};
        if (!trimStr(i0.q)) return true;
        if (!trimStr(i0.a)) return true;
      }
      return false;
    }

    function sortStable(list){
      return list.slice().sort((a,b)=>{
        const ap = a.status === "published" ? 0 : 1;
        const bp = b.status === "published" ? 0 : 1;
        if (ap !== bp) return ap - bp;
        const at = trimStr(a.title).toLowerCase();
        const bt = trimStr(b.title).toLowerCase();
        if (at < bt) return -1;
        if (at > bt) return 1;
        const ai = trimStr(a.id);
        const bi = trimStr(b.id);
        if (ai < bi) return -1;
        if (ai > bi) return 1;
        return 0;
      });
    }

    window.STATE = window.STATE || {
      locked:false,
      lockReasons:[],
      all:[],
      visible:[],
      selectedId:"",
      edit:null,
      dirty:false,
      filters:{ q:"", status:"", onlyProblems:false, showAll:false },
      lastWorkerOk:null,
      lastWorkerMsg:"",
      auth:{ empNo:"", role:"", scopeId:"" },
      subjectId:"generic",
      _rendering:false,
      _autoGoalsSig:"",
      _autoTitleSig:"",
      courseTouched:false
    };

    Object.defineProperty(window.STATE, "trainings", {
      get(){ return window.STATE.all; },
      set(v){ window.STATE.all = asArray(v); }
    });

    window.setDirty = function(on){
      window.STATE.dirty = !!on;
      if (window.STATE.dirty) setStateInfo("warn", "Status: Osparade ändringar");
      else setStateInfo("ok", "Status: OK");
      window.syncButtons();
    };

    function getCurrentCourseStep(){
      const el = $("courseStep");
      if (el && trimStr(el.value)) return String(el.value);
      const t = window.STATE.edit;
      const p = t ? parseCourseFromTitle(t.title) : { step:"" };
      return p.step || "1";
    }

    function getCurrentCourseChapter(){
      const el = $("courseTitle");
      const v = el ? trimStr(el.value) : "";
      if (v && COURSE_TITLES_6.indexOf(v) !== -1) return v;
      const t = window.STATE.edit;
      const p = t ? parseCourseFromTitle(t.title) : { chapter:"" };
      return p.chapter || "Introduktion";
    }

    function updateCourseTouchHint(){
      try{
        const el = $("courseTouchHint");
        if (!el) return;
        if (courseReadyByTouchOrExisting()){
          el.textContent = "Kursplan aktiv: titel och mål kan nu auto-fyllas när det är relevant.";
        } else {
          el.textContent = "Obs: Titel och mål fylls inte automatiskt förrän du väljer kapitel eller steg (kursplanen aktiveras).";
        }
      }catch(_){}
    }

    window.syncButtons = function(){
      try{
        const btnDraft = $("btnSaveDraft");
        const btnPub   = $("btnSavePublish");
        const btnRev   = $("btnRevert");
        const btnGen   = $("btnGenAI");
        const btnDel   = $("btnDelete");
        const btnPurge = $("btnPurge");

        const hasEdit = !!window.STATE.edit;
        const can = (!window.STATE.locked && hasEdit);

        if (btnDraft) btnDraft.disabled = !(can && window.STATE.dirty);
        if (btnPub)   btnPub.disabled   = !(can && window.STATE.dirty);
        if (btnRev)   btnRev.disabled   = !(can && window.STATE.dirty);

        if (btnGen){
          const modOk = !!trimStr($("mod") ? $("mod").value : "");
          const areaOk = !!trimStr($("area") ? $("area").value : "");
          const chapter = getCurrentCourseChapter();
          const step = getCurrentCourseStep();
          const planOk = canCoursePlanAuto($("mod") ? $("mod").value : "", $("area") ? $("area").value : "", chapter, step);
          const planActive = courseReadyByTouchOrExisting();
          btnGen.disabled = !(can && modOk && areaOk && planOk && planActive);
        }

        if (btnDel) btnDel.disabled = !(can && !!trimStr(window.STATE.selectedId));
        if (btnPurge) btnPurge.disabled = window.STATE.locked;

        updateCourseTouchHint();
      }catch(_){}
    };

    window.renderDebug = function(){
      try{
        const pre = $("debugPre");
        if (!pre) return;
        const payload = {
          selectedId: window.STATE.selectedId,
          dirty: window.STATE.dirty,
          subjectId: window.STATE.subjectId,
          courseTouched: window.STATE.courseTouched,
          filters: window.STATE.filters,
          edit: window.STATE.edit
        };
        pre.textContent = JSON.stringify(payload, null, 2);
      }catch(_){}
    };

    function clearNode(el){
      if (!el) return;
      while (el.firstChild) el.removeChild(el.firstChild);
    }

    function mkChip(text){
      const s = document.createElement("span");
      s.className = "chip";
      s.textContent = text;
      return s;
    }

    function mkBtn(text, cls, title){
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls || "miniBtn";
      if (title) b.title = title;
      b.textContent = text;
      return b;
    }

    function updateLeftHint(){
      const el = $("leftHint");
      if (!el) return;
      const q = trimStr(window.STATE.filters.q);
      const st = trimStr(window.STATE.filters.status);
      const showAll = !!window.STATE.filters.showAll;
      const onlyProblems = !!window.STATE.filters.onlyProblems;

      if (!showAll && !q && !st && !onlyProblems){
        el.textContent = "Sök eller tryck “Visa alla” för att se sparade utbildningar. Publicering kräver minst 1 block.";
      }else{
        el.textContent = "Publicering kräver minst 1 block.";
      }
    }

    window.renderList = function(){
      const elList = $("list");
      if (!elList) return;
      clearNode(elList);

      updateLeftHint();

      const q = trimStr(window.STATE.filters.q);
      const st = trimStr(window.STATE.filters.status);
      const showAll = !!window.STATE.filters.showAll;
      const onlyProblems = !!window.STATE.filters.onlyProblems;

      if (!showAll && !q && !st && !onlyProblems){
        const empty = document.createElement("div");
        empty.className = "muted2";
        empty.style.padding = "12px 4px";
        empty.textContent = "Listan är vilande. Skriv i sökfältet eller tryck “Visa alla”.";
        elList.appendChild(empty);
        return;
      }

      const list = asArray(window.STATE.visible);
      if (list.length === 0){
        const empty = document.createElement("div");
        empty.className = "muted2";
        empty.style.padding = "12px 4px";
        empty.textContent = "Inga utbildningar matchar filtret.";
        elList.appendChild(empty);
        return;
      }

      for (let i=0;i<list.length;i++){
        const t = list[i];
        const row = document.createElement("div");
        row.className = "trainRow";
        row.setAttribute("role","button");
        row.tabIndex = 0;

        const left = document.createElement("div");
        left.style.minWidth = "0";

        const title = document.createElement("div");
        title.className = "title";
        title.textContent = trimStr(t.title) ? t.title : "— (saknar titel)";

        const meta = document.createElement("div");
        meta.className = "meta";

        meta.appendChild(mkChip(t.status === "published" ? "Publicerad" : "Utkast"));
        if (trimStr(t.mod)) meta.appendChild(mkChip(t.mod));
        if (trimStr(t.area)) meta.appendChild(mkChip(t.area));

        const probs = trainingProblems(t);
        meta.appendChild(mkChip(probs.length > 0 ? ("Problem: " + probs.length) : "OK"));

        left.appendChild(title);
        left.appendChild(meta);

        const right = document.createElement("div");
        right.className = "right";
        const pick = mkBtn("Öppna", "miniBtn", "Öppna utbildning");
        right.appendChild(pick);

        function choose(){
          try{ window.HRTrainingsSelect(t.id); }catch(_){}
        }

        row.addEventListener("click", ()=>{ choose(); });
        row.addEventListener("keydown", (e)=>{
          if (e.key === "Enter" || e.key === " "){
            e.preventDefault();
            choose();
          }
        });
        pick.addEventListener("click", (e)=>{ e.stopPropagation(); choose(); });

        row.appendChild(left);
        row.appendChild(right);
        elList.appendChild(row);
      }
    };

    function syncTitleDisplay(value){
      const el = $("titleDisplay");
      if (el) el.value = safeStr(value || "—");
    }

    function buildAutoGoalsText(modLabel, modId, areaLabel, chapter, step){
      const fixed = getFixedGoalsText(modId, areaLabel);
      const s = String(step || "1");
      const c = trimStr(chapter) || "Introduktion";

      const stepDef = STEP_1_5_DEFS[s] ? STEP_1_5_DEFS[s] : STEP_1_5_DEFS["1"];
      const stepHint = getAreaStepHint(modId, areaLabel, s);
      const chapFocus = CHAPTER_FOCUS[c] ? CHAPTER_FOCUS[c] : CHAPTER_FOCUS["Introduktion"];

      const lines = [];
      lines.push("Modul: " + (trimStr(modLabel) ? trimStr(modLabel) : "—"));
      lines.push("Område: " + (trimStr(areaLabel) ? trimStr(areaLabel) : "—"));
      lines.push("");

      lines.push("Kapitel: " + c);
      lines.push("- Fokus: " + chapFocus);
      lines.push("");
      lines.push("Steg " + s + " – fokus:");
      lines.push("- " + stepDef);
      if (trimStr(stepHint)) lines.push("- " + stepHint);

      if (trimStr(fixed)){
        lines.push("");
        lines.push("Bas/område-mål:");
        lines.push(fixed);
      }
      return lines.join("\n").trim();
    }

    function applyCoursePlan(reason, opts){
      try{
        const t = window.STATE.edit;
        if (!t) { syncTitleDisplay("—"); return; }

        const o = (opts && typeof opts === "object") ? opts : {};
        const previewOnly = !!o.previewOnly;
        const forceWrite = !!o.forceWrite;

        const modLabel = safeStr(t.mod || "");
        const areaLabel = safeStr(t.area || "");
        const chapter = getCurrentCourseChapter();
        const step = getCurrentCourseStep();

        const ok = canCoursePlanAuto(modLabel, areaLabel, chapter, step);
        const composed = composeCourseTitle(modLabel, areaLabel, chapter, step);
        const composedSig = stableHash(composed);

        const curTitle = safeStr(t.title || "");
        const curTitleSig = stableHash(curTitle);
        const curParsed = parseCourseFromTitle(curTitle);
        const isLegacyTitle = (!!trimStr(curTitle) && !curParsed.chapter && !curParsed.step);

        syncTitleDisplay(composed);
        if (!ok) return;

        const canWriteByActivation = courseReadyByTouchOrExisting();
        const allowWrite = forceWrite || (canWriteByActivation && !previewOnly);
        if (!allowWrite) return;

        const mayOverwriteTitle =
          (!trimStr(curTitle)) ||
          isLegacyTitle ||
          (window.STATE._autoTitleSig && window.STATE._autoTitleSig === curTitleSig);

        if (mayOverwriteTitle){
          t.title = composed;
          window.STATE._autoTitleSig = composedSig;
        }

        const modId = getModuleIdByLabel(modLabel);
        const nextGoals = buildAutoGoalsText(modLabel, modId, areaLabel, chapter, step);
        const nextSig = stableHash(nextGoals);

        const curGoals = safeStr(t.goals || "");
        const curSig = stableHash(curGoals);
        const mayOverwriteGoals =
          (!trimStr(curGoals)) ||
          (window.STATE._autoGoalsSig && window.STATE._autoGoalsSig === curSig) ||
          (looksAutoGoals(curGoals) && window.STATE._autoGoalsSig === curSig);

        if (mayOverwriteGoals){
          if (trimStr(nextGoals)){
            t.goals = nextGoals;
            window.STATE._autoGoalsSig = nextSig;
            if ($("goals")) $("goals").value = nextGoals;
          }
        }

        if (reason) { /* no-op */ }
      }catch(_){}
    }

    function applyCoursePlanPreview(reason){
      applyCoursePlan(reason, { previewOnly:true, forceWrite:false });
    }

    window.renderEditor = function(){
      const t = window.STATE.edit;

      const ctx = $("contextText");
      if (ctx) ctx.textContent = t ? ("Redigerar: " + (trimStr(t.title) ? t.title : "Ny utbildning")) : "Redigerar: —";

      const lock = !t;
      ["mod","area","courseTitle","courseStep","goalsLevel","goals","aiContent","aiCount","aiQuestionType","aiFeedbackEnabled"]
        .forEach(id => { const el = $(id); if (el) el.disabled = lock; });

      window.STATE._rendering = true;
      try{
        if ($("mod")) $("mod").value = t ? safeStr(t.mod) : "";
        if ($("area")) $("area").value = t ? safeStr(t.area) : "";

        if ($("goalsLevel")) $("goalsLevel").value = t ? safeStr(t.goalsLevel || "normal") : "normal";
        if ($("goals")) $("goals").value = t ? safeStr(t.goals) : "";

        const parsed = t ? parseCourseFromTitle(t.title) : { chapter:"", step:"" };

        if ($("courseTitle")){
          $("courseTitle").value = (parsed.chapter && COURSE_TITLES_6.indexOf(parsed.chapter) !== -1) ? parsed.chapter : "Introduktion";
        }
        if ($("courseStep")){
          $("courseStep").value = (parsed.step && ["1","2","3","4","5"].includes(parsed.step)) ? parsed.step : "1";
        }

        syncTitleDisplay(t ? t.title : "—");
      }catch(_){}
      window.STATE._rendering = false;

      refreshModuleLists();
      updateSubjectCallout();
      syncQuestionControlsVisibility();
      window.syncButtons();
    };

    window.renderBlocks = function(){
      const host = $("blocksList");
      if (!host) return;
      clearNode(host);

      const t = window.STATE.edit;
      if (!t){
        const m = document.createElement("div");
        m.className = "muted2";
        m.style.padding = "10px 4px";
        m.textContent = "Välj en utbildning för att se och redigera block.";
        host.appendChild(m);
        return;
      }

      let blocks = asArray(t.blocks);
      if (window.STATE.filters.onlyProblems) blocks = blocks.filter(b => blockHasProblem(b));

      if (blocks.length === 0){
        const m = document.createElement("div");
        m.className = "muted2";
        m.style.padding = "10px 4px";
        m.textContent = window.STATE.filters.onlyProblems
          ? "Inga problem-block att visa."
          : "Inga block ännu. Skapa via AI ovan, eller redigera när block finns.";
        host.appendChild(m);
        return;
      }

      function addTextarea(card, labelText, value, onChange, placeholder){
        const lab = document.createElement("div");
        lab.className = "label";
        lab.style.marginTop = "10px";
        lab.textContent = labelText;

        const ta = document.createElement("textarea");
        ta.className = "textarea";
        ta.style.minHeight = "88px";
        ta.value = safeStr(value);
        ta.placeholder = placeholder || "";

        ta.addEventListener("input", ()=>{
          if (window.STATE._rendering) return;
          onChange(ta.value);
          window.setDirty(true);
        });

        card.appendChild(lab);
        card.appendChild(ta);
      }

      blocks.forEach((b)=>{
        const realIdx = asArray(t.blocks).findIndex(x => x && x.id === b.id);

        const card = document.createElement("div");
        card.className = "blockCard";
        card.setAttribute("data-kind", normalizeKind(b.kind));

        const head = document.createElement("div");
        head.className = "blockHead";

        const left = document.createElement("div");
        left.className = "blockLeft";

        const dot = document.createElement("span");
        dot.className = "blockTypeDot";
        const k = normalizeKind(b.kind);
        if (k === "task") dot.style.background = "var(--blockTask)";
        else if (k === "document") dot.style.background = "var(--blockDocument)";
        else if (k === "question") dot.style.background = "var(--blockQuestion)";
        else if (k === "both") dot.style.background = "linear-gradient(90deg, var(--blockBothA) 0 50%, var(--blockBothB) 50% 100%)";
        else dot.style.background = "var(--blockQuestion)";

        const typeChip = document.createElement("span");
        typeChip.className = "chip";
        typeChip.textContent = "Typ: " + k;

        left.appendChild(dot);
        left.appendChild(typeChip);

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.flexWrap = "wrap";

        const up = mkBtn("↑", "miniBtn", "Flytta upp");
        const down = mkBtn("↓", "miniBtn", "Flytta ner");
        const del = mkBtn("Ta bort", "miniBtn danger", "Ta bort block");

        up.addEventListener("click", ()=>{
          const i = realIdx;
          if (i > 0){
            const arr = t.blocks;
            const tmp = arr[i-1]; arr[i-1] = arr[i]; arr[i] = tmp;
            window.setDirty(true);
            refreshUI();
          }
        });
        down.addEventListener("click", ()=>{
          const i = realIdx;
          if (i >= 0 && i < t.blocks.length - 1){
            const arr = t.blocks;
            const tmp = arr[i+1]; arr[i+1] = arr[i]; arr[i] = tmp;
            window.setDirty(true);
            refreshUI();
          }
        });
        del.addEventListener("click", ()=>{
          const i = realIdx;
          if (i >= 0){
            t.blocks.splice(i,1);
            window.setDirty(true);
            refreshUI();
          }
        });

        actions.appendChild(up);
        actions.appendChild(down);
        actions.appendChild(del);

        head.appendChild(left);
        head.appendChild(actions);

        card.appendChild(head);

        const titleLab = document.createElement("div");
        titleLab.className = "label";
        titleLab.style.marginTop = "10px";
        titleLab.textContent = "Rubrik";

        const inp = document.createElement("input");
        inp.className = "input";
        inp.value = safeStr(b.title);
        inp.placeholder = "Skriv rubrik…";
        inp.addEventListener("input", ()=>{
          if (window.STATE._rendering) return;
          b.title = safeStr(inp.value);
          window.setDirty(true);
          if (window.STATE.filters.onlyProblems) refreshUI();
        });

        card.appendChild(titleLab);
        card.appendChild(inp);

        function ensureItem0(){
          if (!b.items || !Array.isArray(b.items)) b.items = [];
          if (!b.items[0] || typeof b.items[0] !== "object") b.items[0] = {};
          return b.items[0];
        }
        const item0 = ensureItem0();

        if (k === "info" || k === "document"){
          addTextarea(card, (k === "document") ? "Dokumenttext" : "Text",
            item0.text || "",
            (v)=>{ item0.text = safeStr(v); },
            "Skriv innehåll…"
          );
        } else if (k === "task"){
          addTextarea(card, "Instruktion",
            item0.instruction || "",
            (v)=>{ item0.instruction = safeStr(v); },
            "Vad ska eleven göra?"
          );
          addTextarea(card, "Leverabel",
            item0.deliverable || "",
            (v)=>{ item0.deliverable = safeStr(v); },
            "Vad ska lämnas in?"
          );
        } else if (k === "question"){
          addTextarea(card, "Fråga",
            item0.q || "",
            (v)=>{ item0.q = safeStr(v); },
            "Skriv frågan…"
          );
          addTextarea(card, "Facit (kort)",
            item0.a || "",
            (v)=>{ item0.a = safeStr(v); },
            "Skriv facit…"
          );
          addTextarea(card, "Förklaring/metod (kort, stegvis)",
            item0.explanation || "",
            (v)=>{ item0.explanation = safeStr(v); },
            "Ex: 1) … 2) …"
          );
          addTextarea(card, "Worked steps (en rad per steg, max 6)",
            Array.isArray(item0.workedSteps) ? item0.workedSteps.join("\n") : "",
            (v)=>{
              const lines = safeStr(v).split("\n").map(x => x.trim()).filter(Boolean);
              item0.workedSteps = lines.slice(0,6);
            },
            "Steg 1…"
          );
        }

        if (blockHasProblem(b)){
          const warn = document.createElement("div");
          warn.className = "inlineHelp";
          warn.style.borderLeftColor = "var(--bad)";
          warn.textContent = "Problem: rubrik + (för question) både fråga och facit måste vara ifyllt.";
          card.appendChild(warn);
        }

        host.appendChild(card);
      });
    };

    function refreshUI(){
      try{ window.renderList(); }catch(_){}
      try{ window.renderEditor(); }catch(_){}
      try{ window.renderBlocks(); }catch(_){}
      try{ window.renderDebug(); }catch(_){}
      try{ window.syncButtons(); }catch(_){}
    }

    function applyFilters(){
      const q = trimStr(window.STATE.filters.q).toLowerCase();
      const status = trimStr(window.STATE.filters.status);
      const onlyProblems = !!window.STATE.filters.onlyProblems;
      const showAll = !!window.STATE.filters.showAll;

      if (!showAll && !q && !status && !onlyProblems){
        window.STATE.visible = [];
        return;
      }

      let list = asArray(window.STATE.all);
      if (q) list = list.filter(t => trimStr(t.title).toLowerCase().includes(q));
      if (status) list = list.filter(t => t.status === status);
      if (onlyProblems) list = list.filter(t => trainingProblems(t).length > 0);

      window.STATE.visible = sortStable(list);
    }

    function loadAllFromStorage(){
      const raw = readJSONStorage(KEY_TRAININGS);
      const list = Array.isArray(raw) ? raw : [];
      window.STATE.all = normalizeAll(list);
      applyFilters();
    }

    function saveAllToStorage(){
      const out = asArray(window.STATE.all).map(t => ({
        id: trimStr(t.id),
        mod: safeStr(t.mod),
        area: safeStr(t.area),
        title: safeStr(t.title),
        desc: safeStr(t.desc),
        goalsLevel: trimStr(t.goalsLevel) || "normal",
        goals: safeStr(t.goals),
        status: (t.status === "published") ? "published" : "draft",
        blocks: asArray(t.blocks).map(b => ({
          id: trimStr(b.id) || mkId("b", normalizeKind(b.kind) + "|" + trimStr(b.title)),
          kind: normalizeKind(b.kind),
          title: safeStr(b.title),
          items: asArray(b.items),
          meta: (b.meta && typeof b.meta === "object") ? {
            time: safeStr(b.meta.time || ""),
            difficulty: safeStr(b.meta.difficulty || ""), // legacy
            tags: Array.isArray(b.meta.tags) ? b.meta.tags : [],
            feedbackEnabled: !!b.meta.feedbackEnabled
          } : { time:"", difficulty:"", tags:[], feedbackEnabled:false }
        }))
      }));
      return writeJSONStorage(KEY_TRAININGS, out);
    }

    function findTrainingById(id){
      const list = asArray(window.STATE.all);
      for (let i=0;i<list.length;i++){
        if (list[i] && list[i].id === id) return list[i];
      }
      return null;
    }

    // =========================
    // INIT / CRUD
    // =========================

    window.HRTrainingsInit = function(){
      try{
        if (!window.HRApp || !window.HR_CONFIG){
          window.STATE.locked = true;
          window.STATE.lockReasons = ["Saknar HRApp/HR_CONFIG"];
          setStateInfo("bad", "Fail-closed: Saknar HRApp/HR_CONFIG");
          return;
        }

        try{
          window.HRApp.requireAuth({ allowRoles:[window.HR_CONFIG.ROLES.ADMIN] });
        }catch(_){
          setStateInfo("bad", "Fail-closed: Ej behörig");
          return;
        }

        try{
          const a = window.HRApp.getAuth ? window.HRApp.getAuth() : null;
          if (a && typeof a === "object"){
            window.STATE.auth.empNo = safeStr(a.empNo || "");
            window.STATE.auth.role = safeStr(a.role || "");
            window.STATE.auth.scopeId = safeStr(a.scopeId || "");
          }
        }catch(_){}

        const who = $("whoText");
        if (who){
          const parts = [
            window.STATE.auth.empNo ? ("empNo " + window.STATE.auth.empNo) : "",
            window.STATE.auth.role ? ("roll " + window.STATE.auth.role) : "",
            window.STATE.auth.scopeId ? ("scope " + window.STATE.auth.scopeId) : ""
          ].filter(Boolean);
          who.textContent = parts.length ? parts.join(" • ") : "—";
        }

        window.STATE.locked = false;
        window.STATE.lockReasons = [];
        setStateInfo("ok", "Status: OK");
        setWorkerInfo(null, "");

        refreshModuleLists();
        updateSubjectCallout();

        loadAllFromStorage();

        if ($("q")) window.STATE.filters.q = safeStr($("q").value || "");
        if ($("fStatus")) window.STATE.filters.status = safeStr($("fStatus").value || "");
        if ($("onlyProblems")) window.STATE.filters.onlyProblems = !!$("onlyProblems").checked;

        window.STATE.filters.showAll = false;

        applyFilters();
        bindEvents();

        syncQuestionControlsVisibility();

        window.renderList();
        window.renderEditor();
        window.renderBlocks();
        window.renderDebug();
        window.syncButtons();
      }catch(_){
        setStateInfo("bad", "Fail-closed: Kunde inte starta");
      }
    };

    window.HRTrainingsNew = function(){
      if (window.STATE.locked) return;

      const t = normalizeTraining({
        id: "tr_" + nowTs(),
        mod: "", area: "", title: "",
        desc: "",
        goalsLevel: "normal", goals: "",
        status: "draft",
        blocks: []
      });

      window.STATE.all.unshift(t);
      window.STATE.selectedId = t.id;
      window.STATE.edit = t;

      window.STATE._autoGoalsSig = "";
      window.STATE._autoTitleSig = "";
      window.STATE.courseTouched = false;

      applyFilters();
      window.setDirty(true);
      refreshUI();
    };

    window.HRTrainingsSelect = function(id){
      const t = findTrainingById(id);
      if (!t) return;

      window.STATE.selectedId = t.id;
      window.STATE.edit = t;

      window.STATE._autoTitleSig = isCourseTitleExactMatch(t) ? stableHash(safeStr(t.title || "")) : "";
      window.STATE._autoGoalsSig = looksAutoGoals(safeStr(t.goals || "")) ? stableHash(safeStr(t.goals || "")) : "";

      const p = parseCourseFromTitle(safeStr(t.title || ""));
      window.STATE.courseTouched = !!(p && p.chapter && p.step);

      if (window.STATE.courseTouched){
        applyCoursePlan("select", { previewOnly:false, forceWrite:false });
      } else {
        applyCoursePlanPreview("select");
      }

      window.setDirty(false);
      refreshUI();
    };

    window.HRTrainingsRevert = function(){
      const id = window.STATE.selectedId;
      if (!id) return;

      const raw = readJSONStorage(KEY_TRAININGS);
      const list = Array.isArray(raw) ? raw : [];
      const norm = normalizeAll(list);
      const found = norm.find(x => x && x.id === id);

      const idx = window.STATE.all.findIndex(x => x && x.id === id);
      if (idx >= 0){
        window.STATE.all[idx] = found ? found : normalizeTraining({ id, status:"draft", blocks:[] });
      }else{
        if (found) window.STATE.all.unshift(found);
      }

      window.STATE.edit = findTrainingById(id);

      const e = window.STATE.edit;
      window.STATE._autoTitleSig = (e && isCourseTitleExactMatch(e)) ? stableHash(safeStr(e.title || "")) : "";
      window.STATE._autoGoalsSig = (e && looksAutoGoals(safeStr(e.goals || ""))) ? stableHash(safeStr(e.goals || "")) : "";

      const p = e ? parseCourseFromTitle(safeStr(e.title || "")) : { chapter:"", step:"" };
      window.STATE.courseTouched = !!(p && p.chapter && p.step);

      if (window.STATE.courseTouched){
        applyCoursePlan("revert", { previewOnly:false, forceWrite:false });
      } else {
        applyCoursePlanPreview("revert");
      }

      window.setDirty(false);
      applyFilters();
      refreshUI();
    };

    window.HRTrainingsSave = function(mode){
      if (!window.STATE.edit) return;

      const t = window.STATE.edit;

      if (mode === "publish"){
        if (!t.blocks || t.blocks.length === 0){
          setStateInfo("bad", "Fail-closed: kräver minst 1 block");
          return;
        }
        t.status = "published";
      }else{
        t.status = "draft";
      }

      const nt = normalizeTraining(t);
      const idx = window.STATE.all.findIndex(x => x && x.id === t.id);
      if (idx >= 0) window.STATE.all[idx] = nt;
      window.STATE.edit = (idx >= 0) ? window.STATE.all[idx] : nt;

      const ok = saveAllToStorage();
      if (!ok){
        setStateInfo("bad", "Fail-closed: Kunde inte spara");
        return;
      }

      window.STATE._autoTitleSig = isCourseTitleExactMatch(window.STATE.edit) ? stableHash(safeStr(window.STATE.edit.title || "")) : "";
      window.STATE._autoGoalsSig = looksAutoGoals(safeStr(window.STATE.edit.goals || "")) ? stableHash(safeStr(window.STATE.edit.goals || "")) : "";

      const p = parseCourseFromTitle(safeStr(window.STATE.edit.title || ""));
      if (p && p.chapter && p.step) window.STATE.courseTouched = true;

      window.setDirty(false);
      applyFilters();
      refreshUI();
    };

    window.HRTrainingsDeleteSelected = function(){
      try{
        if (window.STATE.locked) return;
        const id = trimStr(window.STATE.selectedId);
        if (!id) return;

        const t = findTrainingById(id);
        const name = t ? (trimStr(t.title) ? t.title : "— (saknar titel)") : id;

        if (!confirm("Ta bort vald utbildning?\n\n" + name + "\n\n(Detta sparas direkt.)")) return;

        const idx = window.STATE.all.findIndex(x => x && x.id === id);
        if (idx >= 0) window.STATE.all.splice(idx,1);

        window.STATE.selectedId = "";
        window.STATE.edit = null;
        window.STATE.courseTouched = false;

        const ok = saveAllToStorage();
        if (!ok){
          setStateInfo("bad", "Fail-closed: Kunde inte spara efter borttagning");
          return;
        }

        window.setDirty(false);
        applyFilters();
        refreshUI();
      }catch(_){
        setStateInfo("bad", "Fail-closed: Kunde inte ta bort");
      }
    };

    window.HRTrainingsPurgeAll = function(){
      try{
        if (window.STATE.locked) return;
        if (!confirm("Rensa ALLA utbildningar?\n\nDetta tömmer AO-057_TRAININGS_V1.\n(Det går inte att ångra.)")) return;

        try{ localStorage.removeItem(KEY_TRAININGS); }catch(_){}

        window.STATE.all = [];
        window.STATE.visible = [];
        window.STATE.selectedId = "";
        window.STATE.edit = null;
        window.STATE.dirty = false;
        window.STATE.courseTouched = false;

        window.STATE.filters.q = "";
        window.STATE.filters.status = "";
        window.STATE.filters.onlyProblems = false;
        window.STATE.filters.showAll = false;

        if ($("q")) $("q").value = "";
        if ($("fStatus")) $("fStatus").value = "";
        if ($("onlyProblems")) $("onlyProblems").checked = false;

        setStateInfo("ok", "Status: OK");
        refreshUI();
      }catch(_){
        setStateInfo("bad", "Fail-closed: Kunde inte rensa");
      }
    };

    // =========================
    // SDK / AI helpers (oförändrat från din senaste sanning)
    // =========================

    function pickBlocksFromSDKData(data){
      try{
        if (!data) return [];
        if (Array.isArray(data.blocks)) return data.blocks;
        if (data.training && Array.isArray(data.training.blocks)) return data.training.blocks;
        return [];
      }catch(_){ return []; }
    }

    function formatSdkErrorForUI(err){
      try{
        const code = err && err.error && err.error.code ? safeStr(err.error.code) : "ERROR";
        const rid = err && err.requestId ? safeStr(err.requestId) : "";
        const msg = err && err.error && err.error.message ? safeStr(err.error.message) : "Fel";
        return msg + (rid ? (" (requestId: " + rid + ")") : "") + (code ? (" • " + code) : "");
      }catch(_){
        return "Fel";
      }
    }

    function buildSDKContextString(){
      const t = window.STATE.edit || {};
      const content = $("aiContent") ? $("aiContent").value : "blocks";
      const fb = $("aiFeedbackEnabled") ? !!$("aiFeedbackEnabled").checked : false;
      const qType = $("aiQuestionType") ? $("aiQuestionType").value : "auto";

      const modLabel = safeStr(t.mod || "");
      const areaLabel = safeStr(t.area || "");
      const subjectId = calcSubjectId(modLabel, areaLabel);
      const moduleId = getModuleIdByLabel(modLabel);

      const chapter = getCurrentCourseChapter();
      const step = getCurrentCourseStep();
      const goalsLevel = trimStr(t.goalsLevel) || "normal";

      const fixedGoals = getFixedGoalsText(moduleId, areaLabel);
      const stepHint = getAreaStepHint(moduleId, areaLabel, step);
      const tagHints = getTagHints(moduleId, areaLabel);
      const mix = getMixSpec(moduleId, qType);

      const chapFocus = CHAPTER_FOCUS[chapter] ? CHAPTER_FOCUS[chapter] : CHAPTER_FOCUS["Introduktion"];
      const stepDef = STEP_1_5_DEFS[String(step)] || STEP_1_5_DEFS["1"];
      const stepFocus = (stepDef + (trimStr(stepHint) ? (" " + stepHint) : "")).trim();

      const lines = [];
      lines.push("LANG: sv");
      lines.push("SUBJECT_ID: " + subjectId);
      lines.push("MODULE_ID: " + (moduleId || "unknown"));
      lines.push("MODUL: " + modLabel);
      lines.push("OMRADE: " + areaLabel);

      lines.push("KAPITEL_6: " + chapter);
      lines.push("KAPITEL_FOKUS: " + chapFocus);

      lines.push("STEG_1_5: " + step);
      lines.push("STEG_FOKUS: " + stepFocus);
      lines.push("STEG_DEF: " + stepDef);
      if (trimStr(stepHint)) lines.push("STEG_OMRADE_HINT: " + stepHint);

      lines.push("UTBILDNINGSNIVA: " + goalsLevel);
      lines.push("FEEDBACK: " + (fb ? "ja" : "nej"));
      lines.push("TITEL: " + safeStr(t.title || ""));

      if (trimStr(fixedGoals)){
        lines.push("MAL_FASTA:");
        lines.push(fixedGoals.slice(0, 600));
      }
      const manualGoals = safeStr(t.goals || "");
      if (trimStr(manualGoals)){
        lines.push("MAL_MANUELL:");
        lines.push(manualGoals.slice(0, 650));
      } else {
        lines.push("MAL_MANUELL: (tom) – använd MAL_FASTA som primär.");
      }

      if (tagHints.length){
        lines.push("TAGGAR_HINT: " + tagHints.join(", "));
      }

      if (content === "questions"){
        lines.push("OUTPUT: endast question-blocks (type=question).");
        lines.push("KRAV: provkänsla. tydlig frågetyp. entydigt facit eller rubric.");
        lines.push("FORBUD: meta-text, generiska svar, 'som AI', 'det beror på'.");
        lines.push("FRAGETYP_UI: " + (qType === "auto" ? "auto" : qType));
        lines.push("FRAGEMIX_12: " + mixToString(mix));
        lines.push(ANSWERKEY_SPEC_SHORT);
        lines.push(VARIATION_SPEC_SHORT);

        if (subjectId === "swot"){
          lines.push("SWOT_LOCK: klassificering av givna scenarier, INTE fri analys.");
        }
        if (subjectId === "math" || subjectId === "haccp"){
          lines.push("LOCK: om beräkning/temperatur -> visa metod kort i 2-6 steg.");
        }
      } else {
        lines.push("OUTPUT: blandade utbildningsblock (info/task/question/document) där det passar.");
        lines.push("PROGRESSION_LOCK: anpassa innehåll till KAPITEL_6 + STEG_1_5 så att Steg 1 och Steg 2 inte blir samma typ av uppgifter.");
      }

      let out = lines.join("\n").trim();
      if (out.length > 2300) out = out.slice(0, 2300);
      return out;
    }

    window.HRTrainingsTestWorker = async function(){
      try{
        const hint = $("aiHint");
        if (hint) hint.textContent = "";

        const okSdk = ensureSDKOrFail();
        if (!okSdk.ok) return;

        setWorkerInfo(null, "");
        const r = await window.HRWorkerSDK.health();

        if (r && r.ok === true){
          setWorkerInfo(true, "OK");
          if (hint) hint.textContent = "AI: OK";
          return;
        }

        const msg = formatSdkErrorForUI(r);
        setWorkerInfo(false, msg);
        if (hint) hint.textContent = "Test misslyckades: " + msg;
      }catch(_){
        setWorkerInfo(false, "Fel");
        try{ const hint = $("aiHint"); if (hint) hint.textContent = "Test misslyckades."; }catch(__){}
      }
    };

    function canonicalQuestionKey(nb){
      try{
        const i0 = nb && nb.items && nb.items[0] ? nb.items[0] : null;
        const q = i0 ? trimStr(i0.q || "") : "";
        if (!q) return "";
        const s = q.toLowerCase().replace(/\s+/g, " ").trim();
        return stableHash(s);
      }catch(_){ return ""; }
    }

    function isValidQuestionBlock(nb){
      try{
        if (!nb) return false;
        if (normalizeKind(nb.kind) !== "question") return false;
        const i0 = nb.items && nb.items[0] ? nb.items[0] : {};
        if (!trimStr(i0.q)) return false;
        if (!trimStr(i0.a)) return false;
        return true;
      }catch(_){ return false; }
    }

    window.HRTrainingsGenerateAI = async function(){
      try{
        const t = window.STATE.edit;
        if (!t){
          setStateInfo("warn", "Status: Välj en utbildning först");
          return;
        }

        if (!trimStr(t.mod) || !trimStr(t.area)){
          const hint = $("aiHint");
          if (hint) hint.textContent = "Välj modul + område först (för rätt subjectId och kursplan).";
          return;
        }

        window.STATE.courseTouched = true;
        applyCoursePlan("ai", { previewOnly:false, forceWrite:true });

        const chapter = getCurrentCourseChapter();
        const step = getCurrentCourseStep();
        if (!canCoursePlanAuto(trimStr(t.mod), trimStr(t.area), chapter, step) || !courseReadyByTouchOrExisting()){
          const hint = $("aiHint");
          if (hint) hint.textContent = "Fail-closed: Välj modul + område + titel (kapitel) + steg innan AI.";
          return;
        }

        const hint = $("aiHint");
        const content = $("aiContent") ? $("aiContent").value : "blocks";
        if (hint) hint.textContent = "Genererar…";

        const okSdk = ensureSDKOrFail();
        if (!okSdk.ok) return;

        syncQuestionControlsVisibility();

        const count = $("aiCount") ? parseInt($("aiCount").value, 10) : 1;
        const contextText = buildSDKContextString();

        const r = await window.HRWorkerSDK.aiGenerate({
          mode: "training",
          count: (isFinite(count) ? count : 1),
          context: contextText,
          language: "sv",
          format: (content === "questions") ? "question" : "training-blocks",
          subject: window.STATE.subjectId || "generic"
        });

        if (!(r && r.ok === true)){
          const msg = formatSdkErrorForUI(r);
          if (hint) hint.textContent = "Misslyckades: " + msg;
          setWorkerInfo(false, msg);
          return;
        }

        setWorkerInfo(true, "OK");

        const incoming = pickBlocksFromSDKData(r.data);
        if (!Array.isArray(incoming) || incoming.length === 0){
          const msg = "Inga block i svaret.";
          if (hint) hint.textContent = "Misslyckades: " + msg;
          setWorkerInfo(false, msg);
          return;
        }

        const stepNow = getCurrentCourseStep();
        const chapterNow = getCurrentCourseChapter();

        const normBlocksRaw = incoming.map((b, idx)=>{
          const nb = normalizeBlock(b);
          nb.kind = normalizeKind(nb.kind);

          ensureBlockMeta(nb);
          nb.meta.feedbackEnabled = $("aiFeedbackEnabled") ? !!$("aiFeedbackEnabled").checked : false;

          if ((!Array.isArray(nb.meta.tags) || nb.meta.tags.length === 0)){
            const modId = getModuleIdByLabel(safeStr(t.mod || ""));
            const tags = getTagHints(modId, safeStr(t.area || ""));
            if (tags.length) nb.meta.tags = tags.slice(0,6);
          }

          const curTitle = trimStr(nb.title);
          const prefix = chapterNow + " • Steg " + stepNow + ": ";
          if (curTitle){
            if (!curTitle.toLowerCase().includes("steg " + stepNow.toLowerCase())){
              nb.title = prefix + curTitle;
            }
          } else {
            nb.title = prefix + "Block";
          }

          nb.id = mkId("b", nb.kind + "|" + trimStr(nb.title) + "|aiidx:" + idx + "|len:" + t.blocks.length);
          return nb;
        });

        let normBlocks = normBlocksRaw;
        let droppedDup = 0;
        let droppedBad = 0;

        if (content === "questions"){
          const seen = {};
          const kept = [];
          for (let i=0;i<normBlocksRaw.length;i++){
            const nb = normBlocksRaw[i];
            if (!isValidQuestionBlock(nb)){
              droppedBad++;
              continue;
            }
            const key = canonicalQuestionKey(nb);
            if (key && seen[key]){
              droppedDup++;
              continue;
            }
            if (key) seen[key] = true;
            kept.push(nb);
          }
          normBlocks = kept;

          if (normBlocks.length === 0){
            const msg = "Fail-closed: Inga godkända provfrågor (saknar facit eller dubletter).";
            if (hint) hint.textContent = msg;
            setWorkerInfo(false, "Kvalitet (fail-closed)");
            return;
          }
        }

        normBlocks.forEach(b => t.blocks.push(b));
        window.setDirty(true);

        if (hint){
          let msg = "Klart: lade till " + normBlocks.length + " block.";
          if (content === "questions" && (droppedDup || droppedBad)){
            msg += " (filtrerade " + droppedBad + " utan facit + " + droppedDup + " dubletter)";
          }
          hint.textContent = msg;
        }

        refreshUI();
      }catch(_){
        try{
          const hint = $("aiHint");
          if (hint) hint.textContent = "Misslyckades.";
          setWorkerInfo(false, "Fel");
        }catch(__){}
      }
    };

    // =========================
    // EVENTS / UI binding
    // =========================

    function bindEvents(){
      if ($("q")){
        $("q").addEventListener("input", ()=>{
          const v = safeStr($("q").value || "");
          window.STATE.filters.q = v;
          window.STATE.filters.showAll = !!trimStr(v);
          applyFilters();
          window.renderList();
        });
      }
      if ($("fStatus")){
        $("fStatus").addEventListener("change", ()=>{
          const v = safeStr($("fStatus").value || "");
          window.STATE.filters.status = v;
          window.STATE.filters.showAll = !!trimStr(v);
          applyFilters();
          window.renderList();
        });
      }
      if ($("onlyProblems")){
        $("onlyProblems").addEventListener("change", ()=>{
          window.STATE.filters.onlyProblems = !!$("onlyProblems").checked;
          window.STATE.filters.showAll = window.STATE.filters.onlyProblems ? true : window.STATE.filters.showAll;
          applyFilters();
          window.renderList();
          window.renderBlocks();
        });
      }

      if ($("btnShowAll")) $("btnShowAll").addEventListener("click", ()=>{
        window.STATE.filters.showAll = true;
        applyFilters();
        window.renderList();
      });

      if ($("btnClear")) $("btnClear").addEventListener("click", ()=>{
        if ($("q")) $("q").value = "";
        if ($("fStatus")) $("fStatus").value = "";
        if ($("onlyProblems")) $("onlyProblems").checked = false;

        window.STATE.filters.q = "";
        window.STATE.filters.status = "";
        window.STATE.filters.onlyProblems = false;
        window.STATE.filters.showAll = false;

        applyFilters();
        window.renderList();
        window.renderBlocks();
      });

      if ($("btnNew")) $("btnNew").addEventListener("click", ()=> window.HRTrainingsNew());
      if ($("btnDelete")) $("btnDelete").addEventListener("click", ()=> window.HRTrainingsDeleteSelected());
      if ($("btnPurge")) $("btnPurge").addEventListener("click", ()=> window.HRTrainingsPurgeAll());

      if ($("btnModAll")) $("btnModAll").addEventListener("click", ()=>{
        refreshModuleLists();
      });
      if ($("btnModClear")) $("btnModClear").addEventListener("click", ()=>{
        if ($("mod")) $("mod").value = "";
        if ($("area")) $("area").value = "";
        updateSubjectCallout();

        if (window.STATE.edit){
          window.STATE.edit.mod = "";
          window.STATE.edit.area = "";
          window.STATE.courseTouched = false;

          applyCoursePlanPreview("clear");
          window.setDirty(true);
        }
        refreshModuleLists();
        window.syncButtons();
      });

      function bindField(id, key){
        const el = $(id);
        if (!el) return;
        const ev = (el.tagName === "SELECT") ? "change" : "input";
        el.addEventListener(ev, ()=>{
          if (window.STATE._rendering) return;
          if (!window.STATE.edit) return;

          window.STATE.edit[key] = safeStr(el.value || "");
          window.setDirty(true);

          if (id === "mod"){
            refreshModuleLists();
            const m = findModuleByLabel(el.value);
            if (m && $("area")){
              const a = trimStr($("area").value);
              if (a && m.areas.indexOf(a) === -1){
                $("area").value = "";
                window.STATE.edit.area = "";
              }
            }
            updateSubjectCallout();

            // LÅS(v2.6.3): modul ska inte trigga auto-write av mål/titel (preview-only om kursplan ej aktiv)
            if (courseReadyByTouchOrExisting()){
              applyCoursePlan("mod", { previewOnly:false, forceWrite:false });
            } else {
              applyCoursePlanPreview("mod");
            }

            window.syncButtons();
            refreshUI();
            return;
          }

          if (id === "area"){
            updateSubjectCallout();

            if (courseReadyByTouchOrExisting()){
              applyCoursePlan("area", { previewOnly:false, forceWrite:false });
            } else {
              applyCoursePlanPreview("area");
            }

            window.syncButtons();
            refreshUI();
            return;
          }

          if (id === "goals"){
            // Manuella mål respekteras. (Auto-write skyddas av _autoGoalsSig och courseTouched.)
            window.syncButtons();
            window.renderDebug();
            return;
          }

          window.syncButtons();
          window.renderDebug();
        });
      }

      // Persistenta fält
      bindField("mod", "mod");
      bindField("area", "area");
      bindField("goalsLevel", "goalsLevel");
      bindField("goals", "goals");

      // Kursplan: kapitel + steg (ej egen datamodell — påverkar title/goals via compose/parse)
      if ($("courseTitle")) $("courseTitle").addEventListener("change", ()=>{
        if (window.STATE._rendering) return;
        if (!window.STATE.edit) return;
        window.STATE.courseTouched = true;
        applyCoursePlan("chapter", { previewOnly:false, forceWrite:false });
        window.setDirty(true);
        refreshUI();
      });

      if ($("courseStep")) $("courseStep").addEventListener("change", ()=>{
        if (window.STATE._rendering) return;
        if (!window.STATE.edit) return;
        window.STATE.courseTouched = true;
        applyCoursePlan("step", { previewOnly:false, forceWrite:false });
        window.setDirty(true);
        refreshUI();
      });

      // AI UI (ej persisterat i training-objektet)
      if ($("aiContent")) $("aiContent").addEventListener("change", ()=>{
        syncQuestionControlsVisibility();
        window.syncButtons();
      });

      if ($("btnTestAI")) $("btnTestAI").addEventListener("click", ()=> window.HRTrainingsTestWorker());
      if ($("btnGenAI")) $("btnGenAI").addEventListener("click", ()=> window.HRTrainingsGenerateAI());

      if ($("btnRevert")) $("btnRevert").addEventListener("click", ()=> window.HRTrainingsRevert());
      if ($("btnSaveDraft")) $("btnSaveDraft").addEventListener("click", ()=> window.HRTrainingsSave("draft"));
      if ($("btnSavePublish")) $("btnSavePublish").addEventListener("click", ()=> window.HRTrainingsSave("publish"));

      if ($("btnLogout")) $("btnLogout").addEventListener("click", ()=>{
        try{
          if (window.HRApp && typeof window.HRApp.logout === "function"){
            window.HRApp.logout();
          } else {
            try{ sessionStorage.removeItem(KEY_AUTH); }catch(_){}
          }
        }catch(_){}
        try{ location.href = "../index.html"; }catch(__){}
      });
    }

    // =========================
    // BOOT
    // =========================
    document.addEventListener("DOMContentLoaded", ()=>{
      try{ window.HRTrainingsInit(); }catch(_){}
    });

  })();
  </script>
</body>
</html>
