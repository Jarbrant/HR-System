// ============================================================
// PRC-MASTER-BYGGORDER — MASTER-AO-WORKER-STACK-01 (PROD v1.0)
// FIL: worker/routes.js
// Syfte: Endast routing (method + pathname -> route-id/handler)
// POLICY (LÅST):
// - Inga guards här
// - Ingen parsing här
// - Ingen env-access här
// - Returnerar endast routeId + handlerKey (string)
// ============================================================

/**
 * matchRoute(method, pathname)
 * Return:
 *  - { ok:true, routeId, handlerKey }
 *  - { ok:false, code:"NOT_FOUND" }
 *  - { ok:false, code:"METHOD_NOT_ALLOWED" }
 */
export function matchRoute(methodRaw, pathnameRaw) {
  const method = String(methodRaw || "").toUpperCase();
  const pathname = String(pathnameRaw || "");

  // ---------- v2 reserved (index ska stoppa tidigare, men vi är defensiva) ----------
  if (pathname === "/v2" || pathname.startsWith("/v2/")) {
    return { ok: true, routeId: "v2_block", handlerKey: "v2_block" };
  }

  // ---------- require /v1 ----------
  if (!(pathname === "/v1" || pathname.startsWith("/v1/"))) {
    return { ok: false, code: "NOT_FOUND" };
  }

  // ---------- OPTIONS /v1/* ----------
  if (method === "OPTIONS") {
    // index hanterar preflight själv (204). Detta finns för tydlighet.
    return { ok: true, routeId: "v1_options", handlerKey: "v1_options" };
  }

  // ---------- GET /v1/health ----------
  if (method === "GET" && pathname === "/v1/health") {
    return { ok: true, routeId: "v1_health", handlerKey: "v1_health" };
  }

  // ---------- AI endpoints (POST only) ----------
  const isAiPath =
    pathname === "/v1/ai/generate" ||
    pathname === "/v1/ai/training" ||
    pathname === "/v1/ai/document";

  if (isAiPath) {
    if (method !== "POST") return { ok: false, code: "METHOD_NOT_ALLOWED" };
    return { ok: true, routeId: "v1_ai_generate", handlerKey: "v1_ai_generate" };
  }

  // ---------- unknown ----------
  return { ok: false, code: "NOT_FOUND" };
}

