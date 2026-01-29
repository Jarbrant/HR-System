// ============================================================
// AO-WORKER-TRAINING-BLOCKS-01 | worker/text.js
// Syfte: Text/normalisering/similarity helpers — flytt från index.js (BLOCK 09 + BLOCK 11B)
// POLICY: No behavior change. Inga sid-effekter.
// ============================================================

import { safeStr, safeArr } from "./utils.js";

export function stripAnyBracketedContext(s) {
  const txt = safeStr(s);
  return txt
    .replace(/\(\s*kontext[^)]*\)/gi, "")
    .replace(/\(\s*använd[^)]*\)/gi, "")
    .replace(/\[\s*object\s+object\s*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function tokenizeForSimilarity(s) {
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

export function jaccardSimilarity(a, b) {
  const A = new Set(tokenizeForSimilarity(a));
  const B = new Set(tokenizeForSimilarity(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? (inter / uni) : 0;
}

export function normKey(s) {
  return safeStr(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function pickOne(list, seed) {
  const arr = safeArr(list).filter(Boolean);
  if (arr.length === 0) return "";
  return arr[seed % arr.length] || arr[0] || "";
}

export function prefixKey(text, maxWords) {
  const t = normKey(text);
  if (!t) return "";
  const parts = t.split(" ").filter(Boolean);
  return parts.slice(0, Math.max(4, Math.min(6, maxWords || 5))).join(" ");
}

export function joinSentences(_sv, s1, s2, s3, count) {
  const a = safeStr(s1).trim();
  const b = safeStr(s2).trim();
  const c = safeStr(s3).trim();
  if (count <= 1) return a;
  if (count === 2) return (a && b) ? `${a} ${b}` : (a || b);
  return [a, b, c].filter(Boolean).join(" ");
}

