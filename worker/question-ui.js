// ============================================================
// PRC-BYGGORDER — AO-WORKER-TRAINING-BLOCKS-01
// FIL: worker/question-ui.js
//
// Syfte:
// - UI-frågeformat (items[]) för provfrågor: options + correctIndex/correctIndices
// - Stabil normalisering av questionType ("auto", mcq, tf, etc.)
// - Fail-closed: om batchen inte kan mappas 1:1 -> returnera fel (index.js hanterar)
// - Inga env/request/Response här (ren mapping)
//
// Policy (LÅST):
// - Stateless, deterministisk, inga sid-effekter
// - XSS-safe: endast textdata (ingen HTML)
//
// PATCH (AUTOPATCH v1.5.9b-qUI-01):
// - P0: Fixar facit-index när tomma svarsalternativ finns (synkad id->index map).
// - P0: Fail-closed med tydligare felorsak (vilken fråga i batchen som bråkar).
// - P1: Rensning skiljer på fråga vs förklaring (ingen “fråga” som fallback i explanation).
// ============================================================

import { safeStr, isPlainObject } from "./utils.js";

// ------------------------------------------------------------
// P0: Domänord får inte läcka i Q-fältet (extra skydd även här)
// ------------------------------------------------------------

function stripDomainWordsCore(s, language) {
  const txt = safeStr(s);
  if (!txt) return "";

  const reSv = /\b(steg|steget|modul|modulen|kapitel|kapitlet|kurs|kursen|utbildning|utbildningen)\b/gi;
  const reEn = /\b(step|module|chapter|course|training)\b/gi;

  return txt
    .replace(reSv, "")
    .replace(reEn, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Exporterad (bakåtkompatibel): används för själva frågetexten (med fallback)
export function stripDomainWordsFromQuestion(s, language) {
  const out = stripDomainWordsCore(s, language);
  if (!out) {
    return (language === "sv") ? "Vilket val är bäst i situationen?" : "Which choice is best in this situation?";
  }
  return out;
}

// Intern: förklaringar/övrig text (ingen fallback-mening)
function stripDomainWordsFromText(s, language) {
  return stripDomainWordsCore(s, language);
}

// ============================================================
// UI questionType normalization
// ============================================================

export function normalizeQuestionType(v) {
  const raw = safeStr(v).trim();
  const s0 = raw.toLowerCase();
  if (!s0) return "";

  const s = s0
    .replace(/\s+/g, "_")
    .replace(/[()]/g, "")
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o");

  // P0: ALLA auto-varianter ska räknas som "auto"
  if (s === "auto" || s.startsWith("auto_") || s.startsWith("auto-") || s.startsWith("auto")) {
    return "auto";
  }

  // Canonical (ai-rules/v1)
  if (s === "mcq_single" || s === "single" || s === "mcq" || s === "mcq1" || s === "mcq_one") return "mcq_single";
  if (s === "mcq_multi" || s === "multi" || s === "mcqm" || s === "mcq_many") return "mcq_multi";
  if (s === "truefalse" || s === "true_false" || s === "sant_falskt" || s === "santfalskt" || s === "tf") return "true_false";
  if (s === "short_answer" || s === "short" || s === "kortsvar" || s === "kort") return "short_answer";
  if (s === "numeric" || s === "number" || s === "tal") return "numeric";

  if (s.includes("mcq") && s.includes("multi")) return "mcq_multi";
  if (s.includes("mcq") && (s.includes("single") || s.includes("ett") || s.includes("one") || s.includes("1"))) return "mcq_single";
  if (s.includes("true") || s.includes("false") || s.includes("sant") || s.includes("falskt")) return "true_false";

  // Okänd -> tomt (så vi kan falla tillbaka stabilt)
  return "";
}

// P0: "auto" räknas som UI-frågeläge och ska ge items[]-output.
export function isUiQuestionRequest(questionType) {
  const qt = normalizeQuestionType(questionType);
  return qt === "auto" || qt === "mcq_single" || qt === "mcq_multi" || qt === "true_false";
}

// ============================================================
// Mapping: training-blocks (question blocks) -> UI items[]
// ============================================================

export function mapTrainingBlocksToUiQuestions(trainingBlocks, questionType, language) {
  const qt0 = normalizeQuestionType(questionType);
  let qt = qt0;

  // Stabil default
  if (!qt || qt === "auto") qt = "mcq_single";

  // Endast stödda typer i UI-output
  if (!(qt === "mcq_single" || qt === "mcq_multi" || qt === "true_false")) {
    qt = "mcq_single";
  }

  const blocks = Array.isArray(trainingBlocks) ? trainingBlocks : [];
  const questionBlocks = blocks.filter(x => x && x.kind === "question");
  const out = [];

  // Fail-closed 1:1 med bättre felorsak:
  for (let idx = 0; idx < questionBlocks.length; idx++) {
    const b = questionBlocks[idx];

    const q = extractQuestionFromBlock(b);
    if (!q.ok) {
      return {
        ok: false,
        errorCode: "Q_SCHEMA_INVALID",
        message: `Kunde inte läsa fråga ${idx + 1} i batchen`
      };
    }

    const mapped = mapChoiceQuestionToUi(q.question, qt, language);
    if (!mapped.ok) {
      const reason = safeStr(mapped && mapped.reason).trim();
      return {
        ok: false,
        errorCode: safeStr(mapped && mapped.errorCode) || "Q_SCHEMA_INVALID",
        message: `Kunde inte skapa giltig provfråga ${idx + 1} i batchen${reason ? `: ${reason}` : ""}`
      };
    }

    out.push(mapped.item);
  }

  if (out.length === 0) {
    return {
      ok: false,
      errorCode: "Q_SCHEMA_INVALID",
      message: "Kunde inte skapa giltiga provfrågor (items) för batchen"
    };
  }

  return { ok: true, items: out };
}

export function extractQuestionFromBlock(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  for (const it of items) {
    if (it && it.type === "questionInline" && isPlainObject(it.question)) {
      return { ok: true, question: it.question };
    }
  }
  return { ok: false };
}

// ============================================================
// Mapping av en fråga till UI-format (options + correctIndex/Indices)
// ============================================================

function buildOptionsAndIndexMap(choices) {
  const opts = [];
  const idToIndex = Object.create(null);

  for (const c of choices) {
    const id = safeStr(c && c.id).trim();
    const t0 = safeStr(c && c.text).trim();

    // Tomt alternativ -> vi tar inte med det, men då kan facit bli omöjligt => fail-closed senare
    if (!id || !t0) continue;

    const idx = opts.length;
    opts.push(t0);
    idToIndex[id] = idx;
  }

  return { options: opts, idToIndex };
}

export function mapChoiceQuestionToUi(q, questionType, language) {
  const question = stripDomainWordsFromQuestion(safeStr(q && q.text).trim(), language);

  const choices = Array.isArray(q && q.choices) ? q.choices : [];
  if (!question || choices.length < 2) {
    return { ok: false, errorCode: "Q_SCHEMA_INVALID", reason: "saknar fråga eller svarsalternativ" };
  }

  const { options, idToIndex } = buildOptionsAndIndexMap(choices);
  if (options.length < 2) {
    return { ok: false, errorCode: "Q_SCHEMA_INVALID", reason: "för få giltiga svarsalternativ" };
  }

  let explanation = safeStr(q && (q.rationale || q.explanation || q.feedback || "")).trim();
  explanation = stripDomainWordsFromText(explanation, language); // ingen fallback-mening här

  const difficulty = safeStr(q && q.difficulty).trim() || undefined;
  const tags = Array.isArray(q && q.tags) ? q.tags.slice(0, 8) : undefined;

  // ---------- TRUE/FALSE ----------
  if (questionType === "true_false") {
    const a = (language === "sv") ? "Sant" : "True";
    const b = (language === "sv") ? "Falskt" : "False";

    const correctId = safeStr(q && q.correctChoiceId).trim();

    // Om facit pekar på en choice-id: mappa via text (så vi inte blandar två listor)
    let correctIndex = 0;
    if (correctId && Object.prototype.hasOwnProperty.call(idToIndex, correctId)) {
      const t = safeStr(choices.find(x => safeStr(x && x.id).trim() === correctId)?.text).trim().toLowerCase();
      if (t === "falskt" || t === "false") correctIndex = 1;
      else correctIndex = 0;
    }

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

  // ---------- MCQ SINGLE ----------
  if (questionType === "mcq_single") {
    const correctId = safeStr(q && q.correctChoiceId).trim();
    if (!correctId) {
      return { ok: false, errorCode: "Q_SCHEMA_INVALID", reason: "saknar facit" };
    }
    if (!Object.prototype.hasOwnProperty.call(idToIndex, correctId)) {
      return { ok: false, errorCode: "Q_SCHEMA_INVALID", reason: "facit matchar inget giltigt svarsalternativ" };
    }

    return {
      ok: true,
      item: {
        type: "question",
        questionType: "mcq_single",
        ...(difficulty ? { difficulty } : {}),
        question,
        options,
        correctIndex: idToIndex[correctId],
        ...(explanation ? { explanation } : {}),
        ...(tags ? { tags } : {})
      }
    };
  }

  // ---------- MCQ MULTI ----------
  if (questionType === "mcq_multi") {
    const idsRaw = Array.isArray(q && q.correctChoiceIds) ? q.correctChoiceIds : [];
    const indices = [];

    for (const id of idsRaw) {
      const k = safeStr(id).trim();
      if (!k) continue;
      if (Object.prototype.hasOwnProperty.call(idToIndex, k)) {
        const ix = idToIndex[k];
        if (!indices.includes(ix)) indices.push(ix);
      }
    }

    // Fallback till single-facit om multi saknas/inte går att mappa
    if (indices.length === 0) {
      const correctId = safeStr(q && q.correctChoiceId).trim();
      if (!correctId) return { ok: false, errorCode: "Q_SCHEMA_INVALID", reason: "saknar facit" };
      if (!Object.prototype.hasOwnProperty.call(idToIndex, correctId)) {
        return { ok: false, errorCode: "Q_SCHEMA_INVALID", reason: "facit matchar inget giltigt svarsalternativ" };
      }
      indices.push(idToIndex[correctId]);
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

  return { ok: false, errorCode: "Q_SCHEMA_INVALID", reason: "okänd frågetyp" };
}

// Behåll exporten (kan användas externt)
export function indexOfChoiceId(choices, id) {
  if (!id) return -1;
  for (let i = 0; i < choices.length; i++) {
    if (safeStr(choices[i] && choices[i].id).trim() === id) return i;
  }
  return -1;
}
