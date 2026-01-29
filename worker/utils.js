// ============================================================
// AO-WORKER-TRAINING-BLOCKS-01 | FILE: worker/utils.js
// Syfte: Rena utilities utan domänlogik (fail-closed helpers)
// ============================================================

export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function safeStr(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

export function safeArr(a) {
  return Array.isArray(a) ? a : [];
}

export function normalizeLanguage(v) {
  const s = safeStr(v).trim().toLowerCase();
  if (!s) return "sv";
  if (s === "sv" || s === "sv-se" || s === "sv_se" || s.startsWith("sv")) return "sv";
  if (s === "en" || s === "en-us" || s === "en_gb" || s.startsWith("en")) return "en";
  return "sv";
}

export function normalizeStepValue(v) {
  const s = safeStr(v).trim();
  if (!s) return "";
  const m = s.match(/([1-7])/);
  return m ? safeStr(m[1]) : "";
}

export function normalizeContextText(v) {
  if (typeof v === "string") return v.trim();
  if (isPlainObject(v)) {
    const t = safeStr(v.text || v.contextText || v.value || "").trim();
    if (t) return t;

    const ml = safeStr(v.moduleLabel || "").trim();
    const al = safeStr(v.areaLabel || "").trim();
    const cl = safeStr(v.chapterLabel || "").trim();

    const stRaw = safeStr(v.step || v.stepId || "").trim();
    const st = normalizeStepValue(stRaw) || stRaw;

    const df = safeStr(v.difficulty || "").trim();

    const parts = [];
    if (ml) parts.push(`Modul: ${ml}`);
    if (al) parts.push(`Område: ${al}`);
    if (cl) parts.push(`Kapitel: ${cl}`);
    if (st) parts.push(`Steg: ${st}`);
    if (df) parts.push(`Svårighet: ${df}`);
    return parts.join(" • ");
  }
  return safeStr(v).trim();
}

export function makeRequestId() {
  try {
    return "req_" + crypto.randomUUID();
  } catch {
    return "req_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }
}

export function normalizeCount(v) {
  const n = (v === null || v === undefined || v === "") ? 4 : Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i !== n) return null;
  if (i < 1 || i > 12) return null;
  return i;
}

export function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function normalizeMode(modeRaw) {
  const s = safeStr(modeRaw).toLowerCase().trim();
  if (!s) return "";
  if (s === "training" || s === "document") return s;
  if (s.includes("train")) return "training";
  if (s.includes("doc")) return "document";
  return s;
}
