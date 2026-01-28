// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01 (PROD v1.5.9)
// FIL: worker/generate/questions.js
// Syfte: Question-generator + batch-uniqueness + scenario-pack + story-arc
//
// POLICY (LÅST):
// - Stateless
// - Fail-closed
// - Endast JSON
// - Ingen payload-logg (endast requestId + felkod i caller)
// ============================================================

import { safeStr, isPlainObject } from "../rules.js";
import { safeArr, normalizeQuestionType, isUiQuestionRequest } from "../v1.js";

// ------------------------------
// hashing / random helpers (deterministiskt)
// ------------------------------
export function hash32(str) {
  let h = 2166136261 >>> 0; // FNV-1a base
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clampInt(v, min, max) {
  const n = Math.trunc(Number(v));
  const a = Math.trunc(Number(min));
  const b = Math.trunc(Number(max));
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

export function shuffledIndices(n, seed) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(i);
  let s = seed >>> 0;
  for (let i = n - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function tokenizeForSimilarity(s) {
  const t = safeStr(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!t) return [];
  const parts = t.split(/\s+/g).filter(Boolean);
  const stop = new Set([
    "i","en","ett","att","och","du","när","vad","vilket","vilken","är","ska","för","på","om","som","det","de","den","ni",
    "innan","efter","bäst","mest","rätt","fel","gör","göra","behöver","måste","kan","vill","där","här","nu"
  ]);
  return parts.filter(w => w.length >= 3 && !stop.has(w));
}

function jaccardSimilarity(a, b) {
  const A = new Set(tokenizeForSimilarity(a));
  const B = new Set(tokenizeForSimilarity(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? (inter / uni) : 0;
}

function normKey(s) {
  return safeStr(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function prefixKey(text, maxWords) {
  const t = normKey(text);
  if (!t) return "";
  const parts = t.split(" ").filter(Boolean);
  return parts.slice(0, Math.max(4, Math.min(6, maxWords || 5))).join(" ");
}

// ------------------------------
// quality config extraction (from bundle.rulesets.training_prompt)
// ------------------------------
export function getQuestionQuality(bundle) {
  const qp = bundle && bundle.rulesets && bundle.rulesets.training_prompt;
  const q = (qp && qp.questionQuality) ? qp.questionQuality : null;

  const forbiddenPhrases = safeArr(q && q.general && q.general.forbiddenPhrases).filter(Boolean);
  const forbidContextPlaceholderText = !!(q && q.general && q.general.forbidContextPlaceholderText);
  const requireExplanation = !!(q && q.general && q.general.requireExplanation);
  const explanationMinChars = Number(q && q.general && q.general.explanationMinChars) || 40;

  const nearDupThreshold = Number(q && q.general && q.general.batchUniqueness && q.general.batchUniqueness.forbidNearDuplicateThreshold);
  const forbidNearDuplicateThreshold = Number.isFinite(nearDupThreshold) ? nearDupThreshold : 0.85;

  const rotateDims = safeArr(q && q.general && q.general.variationPlan && q.general.variationPlan.rotateDimensions).filter(Boolean);
  const minDistinctDims = Number(q && q.general && q.general.variationPlan && q.general.variationPlan.minimumDistinctDimensionsInBatch) || 3;

  const minOptions = Number(q && q.mcq && q.mcq.minOptions) || 4;
  const maxOptions = Number(q && q.mcq && q.mcq.maxOptions) || 6;

  return {
    forbidContextPlaceholderText,
    forbiddenPhrases,
    requireExplanation,
    explanationMinChars,
    forbidNearDuplicateThreshold,
    variation: { rotateDims, minDistinctDims },
    mcq: { minOptions, maxOptions }
  };
}

function containsForbiddenPhrase(text, forbiddenPhrases) {
  const t = safeStr(text).toLowerCase();
  for (const p of safeArr(forbiddenPhrases)) {
    const ph = safeStr(p).toLowerCase().trim();
    if (ph && t.includes(ph)) return true;
  }
  return false;
}

function stripAnyBracketedContext(s) {
  const txt = safeStr(s);
  return txt
    .replace(/\(\s*kontext[^)]*\)/gi, "")
    .replace(/\(\s*använd[^)]*\)/gi, "")
    .replace(/\[\s*object\s+object\s*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// P0: ta bort domänord i själva Q-fältet (och som säkerhet även i rationale/options vid mapping)
export function stripDomainWordsFromQuestion(s, language) {
  const txt = safeStr(s);
  if (!txt) return txt;

  const reSv = /\b(steg|steget|modul|modulen|kapitel|kapitlet|kurs|kursen|utbildning|utbildningen)\b/gi;
  const reEn = /\b(step|module|chapter|course|training)\b/gi;

  const out = txt.replace(reSv, "").replace(reEn, "").replace(/\s{2,}/g, " ").trim();
  if (!out) {
    return (language === "sv") ? "Vilket val är bäst i situationen?" : "Which choice is best in this situation?";
  }
  return out;
}

export function sanitizeContextForDisplay(contextText, qq) {
  const c = safeStr(contextText).trim();
  if (!c) return "—";
  if (qq && qq.forbidContextPlaceholderText) {
    if (containsForbiddenPhrase(c, qq.forbiddenPhrases)) return "—";
    if (/\(kontext\s+dolt\)/i.test(c)) return "—";
    if (/\[object\s+object\]/i.test(c)) return "—";
  }
  return c;
}

// ------------------------------
// step profile (1–7)
// ------------------------------
export function getStepProfile(step) {
  const s = safeStr(step).trim();
  // 1: begrepp + enkel start
  // 2: ansvar/roller + spårbarhet
  // 3: tillämpning + avvikelse
  // 4: risk/konsekvens + spårbarhet
  // 5: avvikelse + åtgärd/uppföljning
  if (s === "1") return ["definition_or_concept", "routine_start", "scenario_application"];
  if (s === "2") return ["roles_and_responsibility", "traceability_and_evidence", "routine_start"];
  if (s === "3") return ["scenario_application", "deviation_and_action", "routine_start"];
  if (s === "4") return ["risk_consequence", "traceability_and_evidence", "scenario_application"];
  if (s === "5") return ["deviation_and_action", "risk_consequence", "roles_and_responsibility"];
  return [];
}

// ------------------------------
// workplace inference
// ------------------------------
export function inferWorkplaceFromContext(contextText, language) {
  const t = safeStr(contextText).toLowerCase();

  if (t.includes("kök") || t.includes("restaurang") || t.includes("servering")) return (language === "sv") ? "i köket" : "in the kitchen";
  if (t.includes("leverans") || t.includes("mottagning") || t.includes("varumottag")) return (language === "sv") ? "vid varumottagningen" : "at receiving";
  if (t.includes("internkontroll") || t.includes("revision") || t.includes("audit")) return (language === "sv") ? "i en internkontroll" : "in an internal check";
  if (t.includes("morgonmöte") || t.includes("brief") || t.includes("standup")) return (language === "sv") ? "på ett kort avstämningsmöte" : "in a short briefing";

  return (language === "sv") ? "på arbetsplatsen" : "at work";
}

// ------------------------------
// story-arc + scenario-pack
// ------------------------------
export function buildStoryArc(count) {
  const base = [
    "scenario_application",
    "routine_start",
    "traceability_and_evidence",
    "risk_consequence",
    "deviation_and_action",
    "roles_and_responsibility",
    "traceability_and_evidence",
    "scenario_application"
  ];
  const tail = [
    "risk_consequence",
    "deviation_and_action",
    "roles_and_responsibility",
    "routine_start"
  ];
  const seq = [];
  for (let i = 0; i < count; i++) {
    if (i < base.length) seq.push(base[i]);
    else seq.push(tail[(i - base.length) % tail.length]);
  }
  return seq;
}

export function pickScenarioPack(contextText, place, language, seed) {
  const t = safeStr(contextText).toLowerCase();
  const isKitchen = t.includes("kök") || t.includes("restaurang") || t.includes("servering");
  const isReceiving = t.includes("leverans") || t.includes("mottagning") || t.includes("varumottag");
  const isAudit = t.includes("revision") || t.includes("internkontroll") || t.includes("audit");
  const isBrief = t.includes("morgonmöte") || t.includes("brief") || t.includes("standup") || t.includes("avstämning");
  const isCustomer = t.includes("kund") || t.includes("klagomål") || t.includes("reklamation");

  const packs = [];
  if (isReceiving) packs.push("receiving");
  if (isKitchen) packs.push("kitchen");
  if (isAudit) packs.push("audit");
  if (isBrief) packs.push("brief");
  if (isCustomer) packs.push("customer");
  if (packs.length === 0) packs.push("generic");

  const packId = packs[seed % packs.length];

  const sv = (language === "sv");
  const defs = {
    receiving: {
      setting: sv ? "En leverans har precis kommit in" : "A delivery has just arrived",
      artifact: sv ? "en kvittens eller en notering i loggen" : "a receipt or a log note",
      constraintA: sv ? "Ni har 10 minuter innan nästa moment startar." : "You have 10 minutes before the next step begins.",
      constraintB: sv ? "Märkningen är ofullständig och två personer säger olika." : "The labeling is incomplete and two people give different answers.",
      twist: sv ? "Efter 2 minuter kommer ny info som motsäger första beskedet." : "After 2 minutes, new info contradicts the first message."
    },
    kitchen: {
      setting: sv ? "Ni är mitt i produktionen och tempot är högt" : "You’re mid-production and the pace is high",
      artifact: sv ? "en checklista eller en sign-off" : "a checklist or sign-off",
      constraintA: sv ? "Det är 15 minuter till servering." : "It’s 15 minutes until service.",
      constraintB: sv ? "En kollega säger “vi gör som vanligt” men underlaget saknas." : "A colleague says “we do it as usual” but there’s no evidence.",
      twist: sv ? "En detalj dyker upp som gör att “som vanligt” inte längre gäller." : "A detail appears that makes “as usual” no longer valid."
    },
    audit: {
      setting: sv ? "Ni gör en snabb internkontroll" : "You’re doing a quick internal check",
      artifact: sv ? "ett underlag som kan visas i efterhand" : "evidence you can show later",
      constraintA: sv ? "Ni behöver kunna förklara beslutet imorgon." : "You need to be able to explain the decision tomorrow.",
      constraintB: sv ? "Det finns en avvikelse, men ni vet inte ännu om den är liten eller stor." : "There’s a deviation, but you don’t yet know its scope.",
      twist: sv ? "En ny observation gör att ni måste omvärdera vad som är “viktigast först”." : "A new observation forces you to reconsider what matters first."
    },
    brief: {
      setting: sv ? "På ett kort avstämningsmöte ska ni få samsyn" : "In a short briefing you need alignment",
      artifact: sv ? "en enkel beslutspunkt (vem-gör-vad)" : "a simple decision note (who-does-what)",
      constraintA: sv ? "Ni har 5 minuter och alla tolkar läget olika." : "You have 5 minutes and everyone interprets differently.",
      constraintB: sv ? "En person saknas men påverkas av beslutet." : "One person is absent but will be impacted by the decision.",
      twist: sv ? "Efter mötet framkommer att en viktig detalj aldrig blev sagd." : "After the meeting, a key detail turns out to have been missing."
    },
    customer: {
      setting: sv ? "En kund har hört av sig med ett klagomål" : "A customer has contacted you with a complaint",
      artifact: sv ? "en notering som gör att ni kan följa upp" : "a note that enables follow-up",
      constraintA: sv ? "Kunden vill ha svar nu, men ni saknar helhetsbild." : "The customer wants an answer now, but you lack the full picture.",
      constraintB: sv ? "Det finns flera möjliga orsaker, och ni riskerar att gissa." : "There are multiple causes and you risk guessing.",
      twist: sv ? "En kollega hittar en tidigare notering som ändrar bedömningen." : "A colleague finds a previous note that changes the assessment."
    },
    generic: {
      setting: sv ? "Ni behöver skapa ordning i ett läge som riskerar att spåra ur" : "You need to create order in a situation that can drift",
      artifact: sv ? "en kort notering som ger spårbarhet" : "a short note that gives traceability",
      constraintA: sv ? "Ni har ont om tid och måste välja rätt första steg." : "You are short on time and must pick the right first step.",
      constraintB: sv ? "Två personer har olika bild av vad som är “problemet”." : "Two people disagree on what the “problem” is.",
      twist: sv ? "Någon säger något som låter rimligt – men saknar stöd." : "Someone says something that sounds right—without evidence."
    }
  };

  const d = defs[packId] || defs.generic;
  return { id: packId, place, setting: d.setting, artifact: d.artifact, constraintA: d.constraintA, constraintB: d.constraintB, twist: d.twist };
}

function pickLengthProfile(seed) {
  const x = seed % 10;
  if (x <= 6) return { minChars: 140, sentences: 2 };
  if (x <= 8) return { minChars: 260, sentences: 3 };
  return { minChars: 90, sentences: 1 };
}

function joinSentences(_sv, s1, s2, s3, count) {
  const a = safeStr(s1).trim();
  const b = safeStr(s2).trim();
  const c = safeStr(s3).trim();
  if (count <= 1) return a;
  if (count === 2) return (a && b) ? `${a} ${b}` : (a || b);
  return [a, b, c].filter(Boolean).join(" ");
}

// ------------------------------
// pools + rationale
// ------------------------------
function getChoicePools(language) {
  if (language === "sv") {
    return {
      bestByDim: {
        definition_or_concept: [
          "Ett gemensamt arbetssätt som kan följas upp och förbättras",
          "Tydliga rutiner som minskar missförstånd i teamet",
          "En standard som gör att ni gör rätt sak på rätt sätt"
        ],
        routine_start: [
          "Klargör mål och avgränsning innan ni agerar",
          "Samla fakta och kontrollera relevant rutin/checklista",
          "Säkerställ vem som ansvarar för nästa åtgärd"
        ],
        traceability_and_evidence: [
          "Dokumentera vad som gjordes och varför innan ni går vidare",
          "Säkra ett tydligt underlag (logg/kvittens/notering) för uppföljning",
          "Bestäm vad som ska sparas som bevis så att ni kan följa upp senare"
        ],
        risk_consequence: [
          "Missförstånd och olika tolkningar i teamet",
          "Brist på spårbarhet när ni ska följa upp",
          "Att fel åtgärd görs på fel problem"
        ],
        scenario_application: [
          "Välj startåtgärd och bekräfta ansvar",
          "Gör en snabb kontroll mot checklista innan beslut",
          "Klargör nästa åtgärd och hur ni följer upp"
        ],
        roles_and_responsibility: [
          "Den som äger rutinen tar initiativet och fördelar ansvar",
          "Den utsedda ansvariga rollen startar och säkrar samordning",
          "Den som har mandat initierar och förankrar nästa åtgärd"
        ],
        deviation_and_action: [
          "Stoppa och avgränsa: vad avviker, hur stort, vem berörs?",
          "Säkra fakta och dokumentera avvikelsen innan ni ändrar något",
          "Informera rätt roller och starta en kontrollerad uppföljning"
        ]
      },
      distractorsByDim: {
        definition_or_concept: [
          "En lista med valfria tips utan uppföljning",
          "En snabb lösning som passar alla situationer",
          "En personlig åsikt om vad som känns bäst",
          "Att hoppa över dokumentation för att spara tid",
          "Att alltid göra som man brukar utan kontroll"
        ],
        routine_start: [
          "Starta åtgärd direkt utan att avgränsa",
          "Vänta tills någon annan tar initiativ",
          "Byt rutin direkt utan att kontrollera fakta",
          "Fokusera på att det ska gå snabbt snarare än rätt",
          "Diskutera länge utan att bestämma nästa åtgärd"
        ],
        traceability_and_evidence: [
          "Lita på minnet istället för att skriva ner något",
          "Spara inget underlag för att undvika extra jobb",
          "Ändra flera saker samtidigt utan att notera vad som ändrades",
          "Be någon annan komma ihåg detaljerna senare",
          "Hoppa över uppföljning eftersom det verkar fungera just nu"
        ],
        risk_consequence: [
          "Att allt går snabbare utan kontroll",
          "Att uppföljning blir enklare av sig själv",
          "Att spårbarhet förbättras automatiskt",
          "Att avvikelser minskar utan åtgärd",
          "Att ansvar blir tydligt även utan beslut"
        ],
        scenario_application: [
          "Låt bli att dokumentera för att spara tid",
          "Gå direkt på en lösning utan att avgränsa",
          "Låt varje person välja sin egen tolkning",
          "Vänta tills problemet återkommer",
          "Ignorera skillnader för att undvika konflikt"
        ],
        roles_and_responsibility: [
          "Den som har mest tid tar ansvar oavsett roll",
          "Alla gör sin egen tolkning utan samordning",
          "Ingen tar ansvar förrän någon säger till",
          "Den som sist såg problemet tar hela ansvaret",
          "Den som pratar högst bestämmer"
        ],
        deviation_and_action: [
          "Fortsätt som vanligt och hoppas att det löser sig",
          "Ändra rutin direkt utan att dokumentera",
          "Vänta tills nästa vecka och se om det återkommer",
          "Informera ingen för att undvika oro",
          "Gör en snabb fix utan att följa upp"
        ]
      }
    };
  }

  return {
    bestByDim: {
      definition_or_concept: [
        "A shared way of working that can be followed up and improved",
        "Clear routines that reduce misunderstandings in the team",
        "A standard that helps you do the right thing the right way"
      ],
      routine_start: [
        "Clarify goal and scope before acting",
        "Gather key facts and check the relevant routine/checklist",
        "Confirm who owns the next action"
      ],
      traceability_and_evidence: [
        "Document what was done and why before moving on",
        "Secure clear evidence (log/receipt/note) for follow-up",
        "Decide what to keep as proof so you can follow up later"
      ],
      risk_consequence: [
        "Misunderstanding and different interpretations in the team",
        "Lack of traceability when you need to follow up",
        "Doing the wrong action for the wrong problem"
      ],
      scenario_application: [
        "Choose a starting action and confirm responsibility",
        "Do a quick checklist check before deciding",
        "Clarify the next action and how you will follow up"
      ],
      roles_and_responsibility: [
        "The routine owner starts and assigns responsibility",
        "The designated responsible role starts and coordinates",
        "Whoever has mandate initiates and aligns the next action"
      ],
      deviation_and_action: [
        "Stop and scope: what deviates, how big, who is affected?",
        "Secure facts and document the deviation before changing anything",
        "Inform the right roles and start controlled follow-up"
      ]
    },
    distractorsByDim: {
      definition_or_concept: [
        "A list of optional tips without follow-up",
        "A quick fix that fits every situation",
        "A personal opinion about what feels best",
        "Skip documentation to save time",
        "Always do what you usually do"
      ],
      routine_start: [
        "Act immediately without scoping",
        "Wait until someone else takes initiative",
        "Change the routine without checking facts",
        "Focus on speed over correctness",
        "Discuss a long time without deciding next action"
      ],
      traceability_and_evidence: [
        "Rely on memory instead of writing anything down",
        "Keep no evidence to avoid extra work",
        "Change several things at once without noting what changed",
        "Ask someone else to remember details later",
        "Skip follow-up because it seems fine right now"
      ],
      risk_consequence: [
        "Everything becomes faster without checks",
        "Follow-up becomes easier automatically",
        "Traceability improves by itself",
        "Deviations decrease without action",
        "Responsibility becomes clear without decision"
      ],
      scenario_application: [
        "Avoid documenting to save time",
        "Jump to a solution without scoping",
        "Let everyone choose their own interpretation",
        "Wait until the problem returns",
        "Ignore differences to avoid conflict"
      ],
      roles_and_responsibility: [
        "Whoever has time takes responsibility regardless of role",
        "Everyone makes their own interpretation without alignment",
        "No one takes responsibility until told",
        "Whoever noticed last owns everything",
        "Whoever speaks loudest decides"
      ],
      deviation_and_action: [
        "Continue as usual and hope it resolves",
        "Change the routine immediately without documenting",
        "Wait until next week and see if it returns",
        "Tell no one to avoid concern",
        "Do a quick fix without follow-up"
      ]
    }
  };
}

function buildRationale({ language, dim, place, bestAnswerText }) {
  if (language === "sv") {
    if (dim === "definition_or_concept") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom tydliga arbetssätt gör att ni kan följa upp på samma sätt och förbättra utan missförstånd, särskilt ${place}.`;
    }
    if (dim === "routine_start") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom en bra startåtgärd sätter ramarna (mål, avgränsning och ansvar) innan ni går vidare. Det gör uppföljning enkel och spårbar ${place}.`;
    }
    if (dim === "traceability_and_evidence") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom spårbarhet bygger på att ni kan visa vad som gjordes, när och varför. Utan underlag blir uppföljning svår ${place}.`;
    }
    if (dim === "risk_consequence") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom största risken när man hoppar över en tydlig start är att teamet agerar på olika bilder av läget. Då blir ansvar och uppföljning spretigt ${place}.`;
    }
    if (dim === "roles_and_responsibility") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom den som äger/har mandat för rutinen kan säkra samsyn och tydligt ansvar. Det minskar risken att “ingen tar tag i det” ${place}.`;
    }
    if (dim === "deviation_and_action") {
      return `Förklaring: "${bestAnswerText}" är rätt eftersom första agerandet vid avvikelse är att stoppa, avgränsa och säkra fakta. Annars riskerar ni att åtgärda fel sak och tappa spårbarhet ${place}.`;
    }
    if (dim === "true_false") {
      return `Förklaring: "${bestAnswerText}" är facit här. Bedöm påståendet strikt utan gråzoner, och välj det alternativ som stämmer bäst i situationen ${place}.`;
    }
    return `Förklaring: "${bestAnswerText}" är rätt eftersom det skapar tydlighet ${place}: vad som gäller nu, vem som gör nästa åtgärd och hur ni följer upp.`;
  }

  if (dim === "definition_or_concept") {
    return `Explanation: "${bestAnswerText}" is correct because clear ways of working enable consistent follow-up and improvement, especially ${place}.`;
  }
  if (dim === "routine_start") {
    return `Explanation: "${bestAnswerText}" is correct because a strong starting action sets goal, scope, and responsibility before you act. This makes follow-up traceable ${place}.`;
  }
  if (dim === "traceability_and_evidence") {
    return `Explanation: "${bestAnswerText}" is correct because traceability depends on being able to show what was done, when, and why. Without evidence, follow-up becomes weak ${place}.`;
  }
  if (dim === "risk_consequence") {
    return `Explanation: "${bestAnswerText}" is correct because skipping a clear start increases the risk of acting on different interpretations. Ownership and follow-up become inconsistent ${place}.`;
  }
  if (dim === "roles_and_responsibility") {
    return `Explanation: "${bestAnswerText}" is correct because the routine owner/mandated role can align the team and assign responsibility clearly ${place}.`;
  }
  if (dim === "deviation_and_action") {
    return `Explanation: "${bestAnswerText}" is correct because the first action in a deviation is to stop, scope, and secure facts. Otherwise you risk fixing the wrong thing and losing traceability ${place}.`;
  }
  if (dim === "true_false") {
    return `Explanation: "${bestAnswerText}" is the answer here. Evaluate strictly and pick the option that best matches the situation ${place}.`;
  }
  return `Explanation: "${bestAnswerText}" is correct because it creates clarity ${place}: what applies now, who owns the next action, and how you will follow up.`;
}

// ------------------------------
// main question maker
// ------------------------------
export function makeQuestion({ n, i, count, language, context, courseLabel, difficulty, subjId, questionType, bundle, qq, batch }) {
  const qt0 = normalizeQuestionType(questionType);
  const qt = (qt0 === "auto") ? "mcq_single" : qt0;

  const isTf = (qt === "true_false");
  const isMulti = (qt === "mcq_multi");
  const isMcq = (qt === "mcq_single" || qt === "mcq_multi");

  const minOpt = qq && qq.mcq ? qq.mcq.minOptions : 4;
  const maxOpt = qq && qq.mcq ? qq.mcq.maxOptions : 6;

  const span = Math.max(1, (maxOpt - minOpt + 1));
  const pick = minOpt + (n % span);
  const choiceCount = isTf ? 2 : (isMcq ? clampInt(pick, minOpt, maxOpt) : 4);

  const dimsDefault = [
    "definition_or_concept",
    "routine_start",
    "traceability_and_evidence",
    "risk_consequence",
    "scenario_application",
    "roles_and_responsibility",
    "deviation_and_action"
  ];

  const rotateBase = (qq && qq.variation && qq.variation.rotateDims && qq.variation.rotateDims.length)
    ? qq.variation.rotateDims
    : dimsDefault;

  const stepDims = getStepProfile(courseLabel.step);
  const rotate = (stepDims && stepDims.length)
    ? stepDims.concat(rotateBase.filter(d => !stepDims.includes(d)))
    : rotateBase;

  let dim = "scenario_application";
  if (batch && batch.useArc && Array.isArray(batch.arcSeq) && batch.arcSeq.length) {
    dim = batch.arcSeq[i % batch.arcSeq.length] || "scenario_application";
  } else {
    const dimIndex = (i + (n % rotate.length)) % rotate.length;
    dim = rotate[dimIndex] || "scenario_application";

    if (batch && batch.seenDims && count > 1) {
      const minDistinct = (qq && qq.variation && qq.variation.minDistinctDims) ? qq.variation.minDistinctDims : 3;
      if (batch.seenDims.size < Math.min(minDistinct, count)) {
        for (let t = 0; t < rotate.length; t++) {
          const d2 = rotate[(dimIndex + t) % rotate.length];
          if (d2 && !batch.seenDims.has(d2)) { dim = d2; break; }
        }
      }
      batch.seenDims.add(dim);
    }
  }

  const place = inferWorkplaceFromContext(context, language);

  const rolesSv = ["du som medarbetare", "du som ansvarig", "du som tar emot", "du som kontrollerar", "du som rapporterar"];
  const rolesEn = ["you as the employee", "you as responsible", "you as receiver", "you as checker", "you as reporter"];
  const role = (language === "sv" ? rolesSv : rolesEn)[(n + i) % 5];

  const scenario = (batch && batch.scenario)
    ? batch.scenario
    : pickScenarioPack(context, place, language, (n ^ i) >>> 0);

  const lenProf = pickLengthProfile(n ^ hash32(`${i}|${dim}|${scenario.id}`));
  const sv = (language === "sv");

  function stemForDimension() {
    const seed2 = (n ^ hash32(`${dim}|${difficulty}|${i}`) ^ hash32(place) ^ hash32(scenario.id)) >>> 0;

    const askStyles = ["first_action", "missing_info", "least_risky", "must_document", "avoid_first"];
    const askStyle = askStyles[seed2 % askStyles.length];

    const s1 = `${scenario.setting} ${scenario.place}.`;

    const askSv = {
      first_action: "Vilket första agerande är mest korrekt?",
      missing_info: "Vilken information måste du säkra först innan du bestämmer dig?",
      least_risky: "Vilket val är minst riskabelt just nu?",
      must_document: "Vad behöver dokumenteras direkt för att ni ska kunna följa upp senare?",
      avoid_first: "Vilket val bör du undvika först, även om det känns snabbt?"
    };
    const askEn = {
      first_action: "What first action is most correct?",
      missing_info: "Which information must you secure first before deciding?",
      least_risky: "Which choice is the least risky right now?",
      must_document: "What must be documented immediately so you can follow up later?",
      avoid_first: "Which choice should you avoid first, even if it feels fast?"
    };

    const dimSv = {
      definition_or_concept: "Tänk på varför ni behöver ett gemensamt sätt att göra saker.",
      routine_start: "Tänk på hur ni sätter ramar: mål, avgränsning, ansvar.",
      traceability_and_evidence: `Tänk på underlag: ${scenario.artifact}.`,
      risk_consequence: "Tänk på konsekvensen om ni gissar eller hoppar över kontroll.",
      roles_and_responsibility: "Tänk på vem som har mandat att starta och samordna.",
      deviation_and_action: "Tänk på hur ni stoppar, avgränsar och säkrar fakta.",
      scenario_application: `Du är ${role}.`
    };

    const dimEn = {
      definition_or_concept: "Think about why a shared way of working matters.",
      routine_start: "Think about setting boundaries: goal, scope, ownership.",
      traceability_and_evidence: `Think about evidence: ${scenario.artifact}.`,
      risk_consequence: "Think about consequences if you guess or skip checks.",
      roles_and_responsibility: "Think about who has mandate to initiate and coordinate.",
      deviation_and_action: "Think about stopping, scoping, and securing facts.",
      scenario_application: `You are ${role}.`
    };

    const c2 = (seed2 & 1) === 0 ? scenario.constraintA : scenario.constraintB;
    const useTwist = !!(batch && batch.useArc && i >= Math.min(6, Math.max(4, Math.floor(count / 2))) && (seed2 % 3 === 0));

    const q2 = sv
      ? `${askSv[askStyle]} ${safeStr(dimSv[dim] || "").trim()}`.trim()
      : `${askEn[askStyle]} ${safeStr(dimEn[dim] || "").trim()}`.trim();

    const q3 = useTwist ? scenario.twist : c2;

    const out = joinSentences(sv, s1, q2, q3, lenProf.sentences);

    if (safeStr(out).length < lenProf.minChars) {
      const add = sv
        ? "Du behöver kunna förklara varför ni valde just detta, och vad nästa uppföljning blir."
        : "You need to be able to explain why you chose this and what the next follow-up will be.";
      return joinSentences(sv, out, add, "", 2);
    }
    return out;
  }

  let text = stemForDimension();

  if (qq && qq.forbidContextPlaceholderText) {
    text = stripAnyBracketedContext(text);
    if (containsForbiddenPhrase(text, qq.forbiddenPhrases)) {
      text = (language === "sv")
        ? `Vilket val ger tydligast start ${place}?`
        : `Which choice gives the clearest start ${place}?`;
    }
  }

  text = stripDomainWordsFromQuestion(text, language);

  // --------------------------------
  // choices
  // --------------------------------
  const choices = [];

  if (isTf) {
    const tfIsTrue = ((n ^ hash32(`${place}|${i}`)) & 1) === 0;
    choices.push({ id: "c1", text: (language === "sv") ? "Sant" : "True" });
    choices.push({ id: "c2", text: (language === "sv") ? "Falskt" : "False" });

    const correctChoiceId = tfIsTrue ? "c1" : "c2";
    const bestAnswerText = tfIsTrue ? choices[0].text : choices[1].text;

    const rationale = buildRationale({ language, dim: "true_false", place, bestAnswerText });

    return {
      kind: "question",
      text,
      choices,
      correctChoiceId,
      rationale,
      difficulty,
      tags: [subjId, "tf", placeKey(place)]
    };
  }

  const pools = getChoicePools(language);
  const bestVariants = safeArr((pools.bestByDim && pools.bestByDim[dim]) || (pools.bestByDim && pools.bestByDim.scenario_application));
  const distractors = safeArr((pools.distractorsByDim && pools.distractorsByDim[dim]) || (pools.distractorsByDim && pools.distractorsByDim.scenario_application));

  let best = "";
  const start = (n ^ hash32(`${dim}|${courseLabel.step}|${difficulty}|${i}`)) >>> 0;
  for (let t = 0; t < bestVariants.length; t++) {
    const cand = bestVariants[(start + t) % bestVariants.length];
    if (!cand) continue;
    const dup = safeArr(batch && batch.seenBestAnswers).some(x => normKey(x) === normKey(cand));
    if (!dup) { best = cand; break; }
  }
  if (!best) best = bestVariants[start % Math.max(1, bestVariants.length)] || (language === "sv" ? "Klargör mål och avgränsning innan åtgärd" : "Clarify goal and scope before acting");

  const picked = [best];
  const seen = new Set([normKey(best)]);

  let cursor = (start ^ hash32(safeStr(context).slice(0, 196)) ^ hash32(scenario.id)) >>> 0;
  while (picked.length < choiceCount && picked.length < 32) {
    cursor = (cursor * 1664525 + 1013904223) >>> 0;
    const cand = distractors[cursor % Math.max(1, distractors.length)] || "";
    const k = normKey(cand);
    if (!cand || !k || seen.has(k)) continue;
    seen.add(k);
    picked.push(cand);
  }

  while (picked.length < choiceCount) {
    const cand = distractors[(picked.length + (start % 7)) % Math.max(1, distractors.length)] || "";
    const k = normKey(cand);
    if (cand && k && !seen.has(k)) { seen.add(k); picked.push(cand); continue; }
    picked.push(language === "sv" ? "Be någon annan bestämma utan underlag" : "Let someone else decide without facts");
  }

  const order = shuffledIndices(choiceCount, start);
  let bestIndex = -1;

  for (let idx = 0; idx < choiceCount; idx++) {
    const srcIndex = order[idx];
    const txt = safeStr(picked[srcIndex]).trim();
    if (!txt) continue;
    if (normKey(txt) === normKey(best)) bestIndex = choices.length;
    choices.push({ id: `c${choices.length + 1}`, text: txt });
  }

  while (choices.length < choiceCount) {
    choices.push({ id: `c${choices.length + 1}`, text: language === "sv" ? "Samla in mer fakta innan ni bestämmer" : "Collect more facts before deciding" });
  }
  while (choices.length > choiceCount) choices.pop();

  if (bestIndex < 0) bestIndex = 0;

  const correctChoiceId = `c${bestIndex + 1}`;
  const bestAnswerText = choices[bestIndex] ? choices[bestIndex].text : best;

  let correctChoiceIds = null;
  if (isMulti && choiceCount >= 3) {
    const idx2 = (bestIndex + 1) % choiceCount;
    correctChoiceIds = [`c${bestIndex + 1}`, `c${idx2 + 1}`];
  }

  let rationale = buildRationale({ language, dim, place, bestAnswerText });

  if (qq && qq.requireExplanation) {
    if (safeStr(rationale).trim().length < (qq.explanationMinChars || 40)) {
      rationale = (language === "sv")
        ? `Förklaring: Det bästa valet är "${bestAnswerText}" eftersom det skapar tydlighet i situationen ${place} innan ni går vidare med åtgärd och uppföljning.`
        : `Explanation: The best choice is "${bestAnswerText}" because it creates clarity ${place} before you act and follow up.`;
    }
  }

  return {
    kind: "question",
    text,
    choices,
    correctChoiceId,
    ...(correctChoiceIds ? { correctChoiceIds } : {}),
    rationale,
    difficulty,
    tags: [subjId, "scenario", dim, placeKey(place), `pack_${scenario.id}`],
    bestAnswerText
  };
}

function placeKey(place) {
  const k = normKey(place).replace(/\s+/g, "_");
  return k ? `place_${k}` : "place_generic";
}

// ------------------------------
// Question block generator with batch uniqueness (P0)
// ------------------------------
export function genQuestionBlock({ i, n, count, language, context, courseLabel, difficulty, subjId, bundle, questionType, qq, batch }) {
  const blockId = `b_q_${i + 1}_${subjId}`.slice(0, 32);

  const title =
    language === "sv"
      ? `Kontrollfråga: ${courseLabel.area}`
      : `Check question: ${courseLabel.area}`;

  let q = null;

  for (let attempt = 0; attempt < 14; attempt++) {
    const nn = (n ^ (attempt * 0x9e3779b9)) >>> 0;

    const cand = makeQuestion({
      n: nn,
      i,
      count,
      language,
      context,
      courseLabel,
      difficulty,
      subjId,
      questionType,
      bundle,
      qq,
      batch
    });

    const stem0 = safeStr(cand && (cand.text || cand.question || "")).trim();
    if (!stem0) continue;

    const stem = stripDomainWordsFromQuestion(stem0, language);
    if (!stem) continue;

    // extra guard: stoppa area-läcka i stem
    if (courseLabel && courseLabel.area) {
      const a = normKey(courseLabel.area);
      if (a && normKey(stem).includes(a)) continue;
    }

    // placeholders: stem + rationale + choices
    if (qq && qq.forbidContextPlaceholderText) {
      const rat = safeStr(cand && (cand.rationale || cand.explanation || cand.feedback || "")).trim();
      if (containsForbiddenPhrase(stem, qq.forbiddenPhrases)) continue;
      if (containsForbiddenPhrase(rat, qq.forbiddenPhrases)) continue;
      if (/\(kontext\s+dolt\)/i.test(stem) || /\(kontext\s+dolt\)/i.test(rat)) continue;
      if (/\[object\s+object\]/i.test(stem) || /\[object\s+object\]/i.test(rat)) continue;

      const ch = Array.isArray(cand && cand.choices) ? cand.choices : [];
      let badChoice = false;
      for (const c of ch) {
        const t = safeStr(c && c.text).trim();
        if (!t) continue;
        if (containsForbiddenPhrase(t, qq.forbiddenPhrases)) { badChoice = true; break; }
        if (/\(kontext\s+dolt\)/i.test(t) || /\[object\s+object\]/i.test(t)) { badChoice = true; break; }
        if (courseLabel && courseLabel.area) {
          const a = normKey(courseLabel.area);
          if (a && normKey(t).includes(a)) { badChoice = true; break; }
        }
      }
      if (badChoice) continue;
    }

    // prefix-guard
    const pk = prefixKey(stem, 5);
    if (pk) {
      const prevP = safeArr(batch && batch.seenPrefixes);
      if (prevP.some(x => x === pk)) continue;
    }

    // near-dup
    let nearDup = false;
    for (const prev of (batch && Array.isArray(batch.seenStems) ? batch.seenStems : [])) {
      const sim = jaccardSimilarity(prev, stem);
      if (sim >= (qq ? qq.forbidNearDuplicateThreshold : 0.85)) { nearDup = true; break; }
    }
    if (nearDup) continue;

    const bestText = safeStr(cand && cand.bestAnswerText).trim();
    if (bestText) {
      let bestDup = false;
      for (const prevBest of safeArr(batch && batch.seenBestAnswers)) {
        if (normKey(prevBest) === normKey(bestText)) { bestDup = true; break; }
      }
      if (bestDup) continue;
      if (batch && Array.isArray(batch.seenBestAnswers)) batch.seenBestAnswers.push(bestText);
    }

    if (batch && Array.isArray(batch.seenStems)) batch.seenStems.push(stem);
    if (pk && batch && Array.isArray(batch.seenPrefixes)) batch.seenPrefixes.push(pk);

    cand.text = stem;
    q = cand;
    break;
  }

  if (!q) throw new Error("DUPLICATE_QUESTION_IN_BATCH");

  const qOut = { ...q };
  delete qOut.bestAnswerText;

  return {
    blockId,
    kind: "question",
    title,
    items: [{ type: "questionInline", question: qOut }],
    scoring: { points: 1 },
    meta: { tags: ["question", subjId], difficulty }
  };
}

// ------------------------------
// Mapping training-block question -> UI items envelope
// ------------------------------
export function mapTrainingBlocksToUiQuestions(trainingBlocks, questionType, language) {
  const qt0 = normalizeQuestionType(questionType);
  const qt = (qt0 === "auto") ? "mcq_single" : qt0;

  const blocks = Array.isArray(trainingBlocks) ? trainingBlocks : [];
  const out = [];

  for (const b of blocks) {
    if (!b || b.kind !== "question") continue;
    const q = extractQuestionFromBlock(b);
    if (!q.ok) continue;

    const mapped = mapChoiceQuestionToUi(q.question, qt, language);
    if (mapped.ok) out.push(mapped.item);
  }

  const expected = blocks.filter(x => x && x.kind === "question").length;
  if (out.length === 0 || out.length !== expected) {
    return { ok: false, errorCode: "Q_SCHEMA_INVALID", message: "Kunde inte skapa giltiga provfrågor (items) för hela batchen" };
  }

  return { ok: true, items: out };
}

function extractQuestionFromBlock(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  for (const it of items) {
    if (it && it.type === "questionInline" && isPlainObject(it.question)) {
      return { ok: true, question: it.question };
    }
  }
  return { ok: false };
}

function mapChoiceQuestionToUi(q, questionType, language) {
  const question = stripDomainWordsFromQuestion(safeStr(q.text).trim(), language);

  const choices = Array.isArray(q.choices) ? q.choices : [];
  if (!question || choices.length < 2) return { ok: false };

  const options = [];
  for (const c of choices) {
    const t0 = safeStr(c && c.text).trim();
    if (t0) options.push(t0);
  }
  if (options.length < 2) return { ok: false };

  let explanation = safeStr(q.rationale || q.explanation || q.feedback || "").trim();
  explanation = stripDomainWordsFromQuestion(explanation, language);

  const difficulty = safeStr(q.difficulty).trim() || undefined;
  const tags = Array.isArray(q.tags) ? q.tags.slice(0, 8) : undefined;

  if (questionType === "true_false") {
    const a = (language === "sv") ? "Sant" : "True";
    const b = (language === "sv") ? "Falskt" : "False";
    const correctId = safeStr(q.correctChoiceId).trim();
    const idx = indexOfChoiceId(choices, correctId);
    const correctIndex = (idx >= 0 && idx <= 1) ? idx : 0;

    return {
      ok: true,
      item: {
        type: "question",
        questionType: "true_false",
        ...(difficulty ? { difficulty } : {}),
        question,
        options: [a, b],
        correctIndex,
        ...(explanation ? { explanation } : {}),
        ...(tags ? { tags } : {})
      }
    };
  }

  if (questionType === "mcq_single") {
    const correctId = safeStr(q.correctChoiceId).trim();
    const idx = indexOfChoiceId(choices, correctId);
    if (idx < 0 || idx >= options.length) return { ok: false };

    return {
      ok: true,
      item: {
        type: "question",
        questionType: "mcq_single",
        ...(difficulty ? { difficulty } : {}),
        question,
        options,
        correctIndex: idx,
        ...(explanation ? { explanation } : {}),
        ...(tags ? { tags } : {})
      }
    };
  }

  if (questionType === "mcq_multi") {
    const ids = Array.isArray(q.correctChoiceIds) ? q.correctChoiceIds : [];
    const indices = [];
    for (const id of ids) {
      const idx = indexOfChoiceId(choices, safeStr(id).trim());
      if (idx >= 0 && idx < options.length && !indices.includes(idx)) indices.push(idx);
    }
    if (indices.length === 0) {
      const correctId = safeStr(q.correctChoiceId).trim();
      const idx = indexOfChoiceId(choices, correctId);
      if (idx < 0 || idx >= options.length) return { ok: false };
      indices.push(idx);
    }

    return {
      ok: true,
      item: {
        type: "question",
        questionType: "mcq_multi",
        ...(difficulty ? { difficulty } : {}),
        question,
        options,
        correctIndices: indices,
        ...(explanation ? { explanation } : {}),
        ...(tags ? { tags } : {})
      }
    };
  }

  return { ok: false };
}

function indexOfChoiceId(choices, id) {
  if (!id) return -1;
  for (let i = 0; i < choices.length; i++) {
    if (safeStr(choices[i] && choices[i].id).trim() === id) return i;
  }
  return -1;
}

