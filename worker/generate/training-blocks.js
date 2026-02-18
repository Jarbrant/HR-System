// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.9)
// FIL: worker/generate/training.js
// Syfte: Bygg training-blocks (info/task/question/document) deterministiskt.
//       - Batch-state: arc + scenario + dedupe (frågor sköts i questions.js)
//       - Respekterar bundle.rulesets.training_prompt (questionQuality + prompts)
//
// POLICY (LÅST):
// - Stateless
// - Fail-closed
// - Endast JSON
// - Ingen payload-logg (endast requestId + felkod i caller)
// ============================================================

import { safeStr, isPlainObject } from "../rules.js";
import { safeArr, normalizeDifficulty, normalizeLanguage, normalizeStep } from "../v1.js";
import { getQuestionQuality, genQuestionBlock, inferWorkplaceFromContext, pickScenarioPack, buildStoryArc, hash32 } from "./questions.js";

// ------------------------------
// small helpers
// ------------------------------
function clampInt(v, min, max) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normKey(s) {
  return safeStr(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s{2,}/g, " ").trim();
}

function makeSubjId({ module, area, chapter, step }) {
  const a = [module, area, chapter, step].map(x => normKey(x)).filter(Boolean);
  const s = a.join("|").slice(0, 120);
  return s ? `subj_${hash32(s).toString(16)}` : `subj_${hash32("x").toString(16)}`;
}

function defaultTitle(language, courseLabel) {
  if (language === "sv") {
    const a = safeStr(courseLabel.area || "").trim();
    const m = safeStr(courseLabel.module || "").trim();
    return a ? `Utbildning: ${a}` : (m ? `Utbildning: ${m}` : "Utbildning");
  }
  const a = safeStr(courseLabel.area || "").trim();
  const m = safeStr(courseLabel.module || "").trim();
  return a ? `Training: ${a}` : (m ? `Training: ${m}` : "Training");
}

// ------------------------------
// content builders (deterministiska, korta, "klassrumsspråk")
// ------------------------------
function buildInfoBlock({ i, n, language, courseLabel, contextText, place, scenario }) {
  const id = `b_info_${i + 1}_${hash32(`${courseLabel.step}|${courseLabel.area}|${i}`)}`.slice(0, 32);

  const title = (language === "sv")
    ? `Info: Vad vi gör ${place}`
    : `Info: What we do ${place}`;

  const a = safeStr(courseLabel.area || "").trim();
  const s = safeStr(courseLabel.step || "").trim();

  const linesSv = [
    `Målet är att skapa tydlighet: vad som gäller, vem som gör nästa steg och hur vi följer upp.`,
    `Tänk på tre saker: (1) avgränsa läget, (2) gör en rimlig startåtgärd, (3) spara spårbarhet som går att visa i efterhand.`,
    `I den här delen tränar vi på beslut som fungerar i verkligheten — inte “perfekta svar på papper”.`
  ];

  const linesEn = [
    `The goal is clarity: what applies now, who does the next step, and how you follow up.`,
    `Think in three parts: (1) scope the situation, (2) choose a solid first action, (3) keep evidence you can show later.`,
    `We practice choices that work in real life — not “perfect answers on paper”.`
  ];

  const extraSv = [
    a ? `Område: ${a}.` : "",
    s ? `Steg: ${s}.` : "",
    scenario ? `Scenario: ${scenario.setting}.` : ""
  ].filter(Boolean).join(" ");

  const extraEn = [
    a ? `Area: ${a}.` : "",
    s ? `Step: ${s}.` : "",
    scenario ? `Scenario: ${scenario.setting}.` : ""
  ].filter(Boolean).join(" ");

  const body = (language === "sv")
    ? `${linesSv[(n + i) % linesSv.length]} ${extraSv}`.trim()
    : `${linesEn[(n + i) % linesEn.length]} ${extraEn}`.trim();

  return {
    blockId: id,
    kind: "info",
    title,
    items: [{ type: "text", text: body }],
    meta: { tags: ["info", "intro"] }
  };
}

function buildTaskBlock({ i, n, language, courseLabel, place, scenario }) {
  const id = `b_task_${i + 1}_${hash32(`${courseLabel.step}|${courseLabel.module}|${i}|task`)}`.slice(0, 32);

  const title = (language === "sv")
    ? `Uppgift: Gör en bra start ${place}`
    : `Task: Make a good start ${place}`;

  const sv = (language === "sv");

  const promptsSv = [
    `Skriv 3 rader: (1) Vad är läget? (2) Vad gör du först? (3) Vad sparar du som spårbarhet?`,
    `Skriv en mini-plan: Avgränsa → Startåtgärd → Underlag → Uppföljning (1 mening per punkt).`,
    `Skriv en kort notering som du skulle kunna lägga i en logg: vad, varför, vem och nästa steg.`
  ];

  const promptsEn = [
    `Write 3 lines: (1) What is the situation? (2) What do you do first? (3) What evidence will you keep?`,
    `Write a mini-plan: Scope → First action → Evidence → Follow-up (one sentence each).`,
    `Write a short log note: what, why, who, and next step.`
  ];

  const constraints = [
    scenario && scenario.constraintA ? scenario.constraintA : "",
    scenario && scenario.constraintB ? scenario.constraintB : "",
    scenario && scenario.twist ? scenario.twist : ""
  ].filter(Boolean);

  const constraint = constraints.length ? constraints[(n + i) % constraints.length] : "";

  const body = (sv ? promptsSv : promptsEn)[(n + i) % 3] + (constraint ? ` ${constraint}` : "");

  return {
    blockId: id,
    kind: "task",
    title,
    items: [
      { type: "text", text: body },
      { type: "freeTextAnswer", placeholder: sv ? "Skriv ditt svar här…" : "Write your answer here…" }
    ],
    meta: { tags: ["task", "application"] }
  };
}

function buildDocBlock({ i, n, language, courseLabel, place, scenario }) {
  const id = `b_doc_${i + 1}_${hash32(`${courseLabel.step}|${courseLabel.area}|${i}|doc`)}`.slice(0, 32);

  const title = (language === "sv")
    ? `Dokument: ${scenario ? scenario.artifact : "En bra notering"}`
    : `Document: ${scenario ? scenario.artifact : "A solid note"}`;

  const sv = (language === "sv");
  
  // Generate deterministic content based on scenario and seed
  const seed = (n ^ hash32(`${i}|${courseLabel.step}|${courseLabel.area}`)) >>> 0;
  
  // Generate a realistic date/time (recent past, deterministic)
  const dayOffset = (seed % 7) + 1; // 1-7 days ago
  const hour = 8 + (seed % 10); // 8-17 (business hours)
  const minute = (seed % 12) * 5; // 0, 5, 10, ..., 55
  const timeFormat = `${hour}:${minute.toString().padStart(2, '0')}`;
  const dateTime = sv 
    ? `${dayOffset} dagar sedan, kl ${timeFormat}`
    : `${dayOffset} days ago, at ${timeFormat}`;
  
  // Generate responsible person (deterministic)
  const responsiblesSv = ["Skiftansvarig", "Verksamhetschef", "Kvalitetsansvarig", "Teamledare", "Områdesansvarig"];
  const responsiblesEn = ["Shift manager", "Operations manager", "Quality manager", "Team leader", "Area manager"];
  const responsible = (sv ? responsiblesSv : responsiblesEn)[(seed >> 4) % 5];
  
  // Generate follow-up time (deterministic)
  const followUpDays = [1, 2, 3, 5, 7][(seed >> 8) % 5];
  const followUp = sv
    ? `Uppföljning om ${followUpDays} ${followUpDays === 1 ? 'dag' : 'dagar'}`
    : `Follow-up in ${followUpDays} ${followUpDays === 1 ? 'day' : 'days'}`;
  
  // Build realistic content based on scenario
  let docTitle, situation, action, evidence;
  
  if (scenario) {
    // Context-aware title with lookup objects
    const titleMapSv = {
      kitchen: 'Produktionskontroll',
      receiving: 'Varumottagning',
      audit: 'Internkontroll',
      customer: 'Kundärende',
      brief: 'Avstämning',
      generic: 'Händelsenotering'
    };
    
    const titleMapEn = {
      kitchen: 'Production Check',
      receiving: 'Goods Receipt',
      audit: 'Internal Audit',
      customer: 'Customer Case',
      brief: 'Briefing',
      generic: 'Incident Note'
    };
    
    const titleBase = (sv ? titleMapSv[scenario.id] : titleMapEn[scenario.id]) || (sv ? titleMapSv.generic : titleMapEn.generic);
    docTitle = `${titleBase} ${place}`;
    
    // Situation (based on scenario setting)
    situation = sv
      ? `${scenario.setting}. ${scenario.constraintA}`
      : `${scenario.setting}. ${scenario.constraintA}`;
    
    // Action (deterministic based on scenario type)
    const actionsSv = {
      kitchen: "Kontrollerade checklista och bekräftade rutinen med ansvarig",
      receiving: "Verifierade leverans mot kvittens och dokumenterade avvikelse",
      audit: "Genomförde kontrollpunkter enligt plan och noterade observationer",
      customer: "Tog emot klagomål, samlade fakta och informerade ansvarig chef",
      brief: "Klargjorde ansvar och dokumenterade beslutade åtgärder",
      generic: "Avgränsade läget, valde startåtgärd och förankrade med ansvarig"
    };
    
    const actionsEn = {
      kitchen: "Verified checklist and confirmed procedure with responsible person",
      receiving: "Verified delivery against receipt and documented deviation",
      audit: "Completed control points as planned and noted observations",
      customer: "Received complaint, gathered facts and informed responsible manager",
      brief: "Clarified responsibilities and documented agreed actions",
      generic: "Scoped situation, selected first action and anchored with responsible"
    };
    
    action = (sv ? actionsSv[scenario.id] : actionsEn[scenario.id]) || (sv ? actionsSv.generic : actionsEn.generic);
    
    // Evidence (based on artifact)
    evidence = sv
      ? `${scenario.artifact}, sparad i logg med tidsstämpel`
      : `${scenario.artifact}, saved in log with timestamp`;
  } else {
    // Fallback for when no scenario available
    docTitle = sv ? `Händelsenotering ${place}` : `Incident note ${place}`;
    situation = sv
      ? "Ett läge som krävde tydlighet och spårbarhet."
      : "A situation requiring clarity and traceability.";
    action = sv
      ? "Avgränsade problemet, valde lämplig åtgärd och dokumenterade beslutet."
      : "Scoped the issue, selected appropriate action and documented decision.";
    evidence = sv
      ? "Notering i logg, kvittens eller motsvarande"
      : "Note in log, receipt or equivalent";
  }
  
  // Build markdown document
  const docContent = sv
    ? `## ${docTitle}\n\n**Datum/Tid:** ${dateTime}\n\n**Läge:** ${situation}\n\n**Första åtgärd:** ${action}\n\n**Underlag/Spårbarhet:** ${evidence}\n\n**Ansvarig:** ${responsible}\n\n**Nästa uppföljning:** ${followUp}`
    : `## ${docTitle}\n\n**Date/Time:** ${dateTime}\n\n**Situation:** ${situation}\n\n**First action:** ${action}\n\n**Evidence/Traceability:** ${evidence}\n\n**Owner:** ${responsible}\n\n**Next follow-up:** ${followUp}`;

  return {
    blockId: id,
    kind: "document",
    title,
    items: [
      { type: "markdown", text: docContent }
    ],
    meta: { tags: ["document", "generated"], scenario: scenario ? scenario.id : "generic" }
  };
}

// ------------------------------
// main builder
// ------------------------------
export function buildTrainingBlocks({ n, language, difficulty, count, contextText, courseLabel, questionType, bundle }) {
  const lang = normalizeLanguage(language);
  const diff = normalizeDifficulty(difficulty);
  const cnt = clampInt(count, 1, 12);

  const label = {
    module: safeStr(courseLabel && courseLabel.module).trim(),
    area: safeStr(courseLabel && courseLabel.area).trim(),
    chapter: safeStr(courseLabel && courseLabel.chapter).trim(),
    step: normalizeStep(courseLabel && courseLabel.step)
  };

  const subjId = makeSubjId(label);

  const qq = getQuestionQuality(bundle);

  const place = inferWorkplaceFromContext(contextText, lang);
  const scenario = pickScenarioPack(contextText, place, lang, (n ^ hash32(subjId)) >>> 0);

  // batch state for question uniqueness
  const batch = {
    useArc: true,
    arcSeq: buildStoryArc(cnt),
    scenario,
    seenStems: [],
    seenPrefixes: [],
    seenBestAnswers: [],
    seenDims: new Set()
  };

  // pattern: 1 info + 1 task + rest questions (min 1 question) + optional document if room
  // for count:
  // 1 => 1 question
  // 2 => info + question
  // 3 => info + task + question
  // 4 => info + task + 2 questions
  // 5 => info + task + 3 questions
  // 6 => info + task + 4 questions
  // 7 => info + task + 5 questions
  // 8 => info + task + 6 questions
  // 9 => info + task + 6 questions + doc
  // 10..12 => info + task + (cnt-3) questions + doc
  const blocks = [];

  const minQuestions = 1;

  if (cnt === 1) {
    blocks.push(genQuestionBlock({ i: 0, n, count: 1, language: lang, context: contextText, courseLabel: label, difficulty: diff, subjId, bundle, questionType, qq, batch }));
    return {
      ok: true,
      title: defaultTitle(lang, label),
      language: lang,
      difficulty: diff,
      subject: label,
      blocks
    };
  }

  // info always first when cnt >= 2
  blocks.push(buildInfoBlock({ i: 0, n, language: lang, courseLabel: label, contextText, place, scenario }));

  if (cnt === 2) {
    blocks.push(genQuestionBlock({ i: 1, n, count: 2, language: lang, context: contextText, courseLabel: label, difficulty: diff, subjId, bundle, questionType, qq, batch }));
    return {
      ok: true,
      title: defaultTitle(lang, label),
      language: lang,
      difficulty: diff,
      subject: label,
      blocks
    };
  }

  // task second when cnt >= 3
  blocks.push(buildTaskBlock({ i: 1, n, language: lang, courseLabel: label, place, scenario }));

  const reserveDoc = (cnt >= 9);
  const qSlots = reserveDoc ? (cnt - 3) : (cnt - 2);
  const qCount = Math.max(minQuestions, qSlots);

  // questions start at index 2
  for (let qi = 0; qi < qCount; qi++) {
    const bi = 2 + qi; // block index
    blocks.push(
      genQuestionBlock({
        i: bi,
        n: (n ^ hash32(`${bi}|${subjId}|${diff}`)) >>> 0,
        count: cnt,
        language: lang,
        context: contextText,
        courseLabel: label,
        difficulty: diff,
        subjId,
        bundle,
        questionType,
        qq,
        batch
      })
    );
  }

  if (reserveDoc && blocks.length < cnt) {
    blocks.push(buildDocBlock({ i: blocks.length, n, language: lang, courseLabel: label, place, scenario }));
  }

  // if we overshot, fail-closed trim should NOT happen; instead throw (signals upstream)
  if (blocks.length !== cnt) {
    // This indicates a counting bug; fail-closed so we see it during testing.
    throw new Error("BLOCK_COUNT_MISMATCH");
  }

  return {
    ok: true,
    title: defaultTitle(lang, label),
    language: lang,
    difficulty: diff,
    subject: label,
    blocks
  };
}

