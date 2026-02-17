// ============================================================
// PRC-MASTER-BYGGORDER — MASTER-AO-WORKER-STACK-01 (PROD v1.0)
// FIL: worker/bundle.js
// Syfte: Välja och paketera regelsamlingar deterministiskt baserat på subjectId.
// POLICY (LÅST):
// - Stateless
// - Fail-closed (okänt ämne => generic)
// - Ingen env-access
// - Ingen request-access
// - Logga aldrig payload
//
// Användning:
//   const bundle = getRulesBundle(subjectId)
//   bundle.merged => sammanslagen regelbild (base + ämne)
//
// OBS:
// - Denna fil tar INTE beslut om prompts/AI. Den bara väljer "vilka regler gäller".
// ============================================================

// --- Base rules (alltid på) ---
import environment from "../ai-rules/v1/subjects/environment.json" assert { type: "json" };
import ethics from "../ai-rules/v1/subjects/ethics.json" assert { type: "json" };
import swedish from "../ai-rules/v1/subjects/swedish.json" assert { type: "json" };
import generic from "../ai-rules/v1/subjects/generic.json" assert { type: "json" };
import hr_policy from "../ai-rules/v1/subjects/hr_policy.json" assert { type: "json" };

// --- Subject rules (på när ämnet matchar) ---
import leadership from "../ai-rules/v1/subjects/leadership.json" assert { type: "json" };
import quality from "../ai-rules/v1/subjects/quality.json" assert { type: "json" };
import information_security from "../ai-rules/v1/subjects/information_security.json" assert { type: "json" };
import haccp from "../ai-rules/v1/subjects/haccp.json" assert { type: "json" };
import work_environment from "../ai-rules/v1/subjects/work_environment.json" assert { type: "json" };
import safety from "../ai-rules/v1/subjects/safety.json" assert { type: "json" };
import math from "../ai-rules/v1/subjects/math.json" assert { type: "json" };
import swot from "../ai-rules/v1/subjects/swot.json" assert { type: "json" };
import feedback_samtal from "../ai-rules/v1/subjects/feedback_samtal.json" assert { type: "json" };

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------
export function getRulesBundle(subjectIdRaw) {
  const subjectId = safeStr(subjectIdRaw).trim();
  const key = resolveSubjectKey(subjectId);

  const base = [
    environment,
    ethics,
    swedish,
    generic,
    hr_policy
  ];

  const subject = pickSubjectRuleset(key);

  // merged = base + subject (deep merge, arrays concat, obj merge)
  const merged = mergeMany([ ...base, subject ]);

  return {
    ok: true,
    subjectId: subjectId || "generic",
    subjectKey: key,
    base,
    subject,
    merged,
    meta: {
      bundleVersion: "1.0.0",
      selectedAt: Date.now()
    }
  };
}

// ------------------------------------------------------------
// Subject resolver
// ------------------------------------------------------------
function resolveSubjectKey(subjectId) {
  // expected: "ledarskap::coachning"
  const sid = safeStr(subjectId).toLowerCase().trim();
  if (!sid) return "generic";

  const prefix = sid.split("::")[0] || sid;

  // Svenska prefixes -> filnamn
  if (prefix === "ledarskap" || prefix === "leadership") return "leadership";
  if (prefix === "kvalitet" || prefix === "quality") return "quality";
  if (prefix === "infosak" || prefix === "infosäk" || prefix === "informationsakerhet" || prefix === "information_security" || prefix === "infosec") return "information_security";
  if (prefix === "haccp") return "haccp";
  if (prefix === "arbetsmiljo" || prefix === "arbetsmiljö" || prefix === "work_environment") return "work_environment";
  if (prefix === "sakerhet" || prefix === "säkerhet" || prefix === "safety") return "safety";
  if (prefix === "matte" || prefix === "math") return "math";
  if (prefix === "swot") return "swot";
  if (prefix === "feedback_samtal" || prefix === "feedback" || prefix === "samtal") return "feedback_samtal";
  if (prefix === "environment" || prefix === "miljö" || prefix === "miljo") return "environment";

  return "generic";
}

function pickSubjectRuleset(key) {
  switch (key) {
    case "leadership": return leadership;
    case "quality": return quality;
    case "information_security": return information_security;
    case "haccp": return haccp;
    case "work_environment": return work_environment;
    case "safety": return safety;
    case "math": return math;
    case "swot": return swot;
    case "feedback_samtal": return feedback_samtal;
    case "environment": return environment;
    default: return generic; // fail-closed
  }
}

// ------------------------------------------------------------
// Safe helpers + merge
// ------------------------------------------------------------
function safeStr(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function mergeMany(list) {
  const out = {};
  for (const item of Array.isArray(list) ? list : []) {
    deepMergeInto(out, item);
  }
  return out;
}

function deepMergeInto(target, source) {
  if (!isObj(target) || !isObj(source)) return target;

  for (const k of Object.keys(source)) {
    const sv = source[k];
    const tv = target[k];

    // Array: concat + dedupe via JSON-string key (stabilt nog för rules)
    if (Array.isArray(sv)) {
      const a = Array.isArray(tv) ? tv.slice() : [];
      for (const x of sv) a.push(x);
      target[k] = dedupeArray(a);
      continue;
    }

    // Object: recurse
    if (isObj(sv)) {
      if (!isObj(tv)) target[k] = {};
      deepMergeInto(target[k], sv);
      continue;
    }

    // Primitive: overwrite (senaste vinner)
    target[k] = sv;
  }

  return target;
}

function dedupeArray(arr) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(arr) ? arr : []) {
    let key = "";
    try { key = JSON.stringify(x); } catch { key = String(x); }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}

