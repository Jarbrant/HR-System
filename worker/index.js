// ============================================================
// PRC-MASTER-BYGGORDER — MASTER-AO-WORKER-STACK-01 (PROD v1.0)
// FIL: worker/routes.js
// Syfte: endast routing (method+pathname -> route-id/handler)
// ============================================================

import { buildDeterministicMock } from "./v1_mock_ai.js";

// NOTE: Vi håller v1 mock i en liten intern modul för tydlighet.
// Men AO kräver helfiler: routes.js/rules.js/schema.js + index.js.
// För att undvika ny fil kan du istället klistra in v1_mock_ai.js i routes.js.
// Här levererar jag v1_mock_ai.js inline längst ner i denna fil (ingen extra fil krävs).

export function routeV1(method, pathname) {
  // Health
  if (method === "GET" && pathname === "/v1/health") {
    return { id: "v1_health_get", method: "GET", handler: null };
  }

  // AI endpoints (POST)
  const isAI =
    pathname === "/v1/ai/generate" ||
    pathname === "/v1/ai/training" ||
    pathname === "/v1/ai/document";

  if (method === "POST" && isAI) {
    return {
      id: "v1_ai_post",
      method: "POST",
      handler: async ({ requestId, input, aiEnabled }) => {
        // v1: mock är tillåtet. Deterministiskt baserat på input (inte requestId).
        return buildDeterministicMock(input);
      }
    };
  }

  // Annars: ingen route
  return null;
}

// ============================================================
// Deterministic Mock AI (v1) — reproducible for same input
// Svarformat:
// { title, description, goals:[], blocks:[] }
// ============================================================

function hash32(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function buildDeterministicMock(input) {
  const mode = input && input.mode;
  const count = Number(input && input.count) || 4;
  const language = input && input.language ? input.language : "sv";
  const context = input && input.context ? input.context : "";

  // Deterministisk seed endast på input (inte requestId)
  const seed = hash32(`${mode}|${count}|${language}|${context.slice(0, 128)}`);

  const title =
    mode === "training"
      ? (language === "sv" ? "Ny utbildning" : "New training")
      : (language === "sv" ? "Nytt dokument" : "New document");

  const description =
    language === "sv"
      ? "Deterministiskt mock-svar (v1)."
      : "Deterministic mock response (v1).";

  const goals =
    mode === "training"
      ? (language === "sv"
          ? ["Förstå grunderna", "Utföra korrekt", "Följa rutiner"]
          : ["Understand basics", "Execute correctly", "Follow routines"])
      : [];

  const blocks = [];
  for (let i = 0; i < count; i++) {
    const n = (seed + i * 2654435761) >>> 0;
    const diff = 1 + (n % 5);
    const mins = 3 + (n % 8);
    const tag = (mode === "training") ? "training" : "document";

    blocks.push({
      type: "info",
      title: (language === "sv" ? `Block ${i + 1}` : `Block ${i + 1}`),
      text: (language === "sv" ? "Exempeltext (mock)." : "Example text (mock)."),
      meta: { difficulty: diff, mins, tags: [tag] }
    });
  }

  return { title, description, goals, blocks };
}
