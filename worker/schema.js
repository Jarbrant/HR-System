// ============================================================
// PRC-MASTER-BYGGORDER — MASTER-AO-WORKER-STACK-01 (PROD v1.0)
// FIL: worker/schema.js
// Syfte: normalize + validate input (inkl legacy keys)
//
// INPUT (backward tolerant):
// - mode | type => "training" | "document"
// - count | n => 1–12 (default 4)
// - context | prompt => max 2000 (default "")
// - language => "sv" | "en" (default "sv")
//
// Fel -> { ok:false, code:"VALIDATION_ERROR", message:"..." }
// OK  -> { ok:true, data:{ mode, count, context, language } }
// ============================================================

import { safeStr, isPlainObject } from "./rules.js";

const MODE_ALLOW = new Set(["training", "document"]);
const LANG_ALLOW = new Set(["sv", "en"]);

export function normalizeAndValidateInput(body) {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Body måste vara ett JSON-objekt" };
  }

  const mode = safeStr(body.mode || body.type).trim();
  const countRaw = body.count ?? body.n;
  const context = safeStr(body.context || body.prompt || "").trim();
  const language = safeStr(body.language || "sv").trim();

  if (!MODE_ALLOW.has(mode)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "mode måste vara training eller document" };
  }

  const count = normalizeCount(countRaw);
  if (count === null) {
    return { ok: false, code: "VALIDATION_ERROR", message: "count måste vara mellan 1 och 12" };
  }

  if (!LANG_ALLOW.has(language)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "language måste vara sv eller en" };
  }

  if (context.length > 2000) {
    return { ok: false, code: "VALIDATION_ERROR", message: "context max 2000 tecken" };
  }

  return { ok: true, data: { mode, count, context, language } };
}

function normalizeCount(v) {
  const n = (v === null || v === undefined || v === "") ? 4 : Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i !== n) return null;
  if (i < 1 || i > 12) return null;
  return i;
}

