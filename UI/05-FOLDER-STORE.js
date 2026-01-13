/* ============================================================
AO: UI-05-FOLDER-STORE (DEMO-READY) | FIL: UI/UI-05-FOLDER-STORE.js
Projekt: HR-System
Syfte: “Pärmen” i demo-läge – en enda plats som UI pratar med för att läsa/spara
Nivå: UI-only (GitHub Pages) | localStorage-first

POLICY (LÅST):
- UI-only
- Fail-closed: om init saknas eller key saknas → gör inget / returnera fel
- Inga auto-writes (sparar bara när du anropar save/upsert/add)
- Inga tokens i storage
- XSS-safe (den här filen renderar inget)

VIKTIGT OM STORAGE-KEYS:
- För att följa “inga nya storage-keys utan AO” kräver denna modul att DU skickar in
  vilken key som får användas via FolderStore.init({ storageKey: "..." }).
- Modulen skapar INTE en egen key automatiskt.

Rekommenderad key (om du tar en AO senare):
- AO-092_FOLDER_STORE_V1  (en enda key för hela pärmen)
============================================================ */

(function () {
  "use strict";

  // ------------------------------
  // Runtime state (ingen storage)
  // ------------------------------
  var _state = {
    inited: false,
    storageKey: "",
    preferSession: false // default localStorage-first
  };

  // ------------------------------
  // Helpers (safe)
  // ------------------------------
  function safeStr(v) {
    return (v === null || v === undefined) ? "" : String(v);
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function safeJsonParse(str) {
    if (typeof str !== "string" || !str) return null;
    try { return JSON.parse(str); } catch (_) { return null; }
  }

  function nowTs() { return Date.now(); }

  function genId(prefix) {
    var p = safeStr(prefix || "id_");
    var t = nowTs().toString(16);
    var r = Math.random().toString(16).slice(2, 10);
    return p + t + "_" + r;
  }

  function makeOk(data) {
    return { ok: true, data: data };
  }

  function makeErr(code, message) {
    return { ok: false, error: { code: safeStr(code), message: safeStr(message) } };
  }

  function ensureInited() {
    if (!_state.inited || !_state.storageKey) {
      return makeErr("STORE_NOT_INITIALIZED", "FolderStore.init({storageKey}) måste köras först.");
    }
    return null;
  }

  function getStorage() {
    // localStorage-first enligt din standard
    if (_state.preferSession === true) return sessionStorage;
    return localStorage;
  }

  function readRaw() {
    var err = ensureInited();
    if (err) return err;

    try {
      var raw = getStorage().getItem(_state.storageKey);
      if (raw === null) return makeOk(null);
      return makeOk(raw);
    } catch (_) {
      return makeErr("READ_FAILED", "Kunde inte läsa från storage.");
    }
  }

  function writeRaw(rawString) {
    var err = ensureInited();
    if (err) return err;

    try {
      getStorage().setItem(_state.storageKey, rawString);
      return makeOk(true);
    } catch (_) {
      return makeErr("WRITE_FAILED", "Kunde inte skriva till storage.");
    }
  }

  // ------------------------------
  // Data shape (en pärm)
  // ------------------------------
  function emptyFolder() {
    var ts = nowTs();
    return {
      version: 1,
      updatedAt: ts,

      teachers: [],   // {id, name, createdAt, updatedAt}
      classrooms: [], // {id, teacherId, name, createdAt, updatedAt}
      students: [],   // {id, classroomId, name, createdAt, updatedAt}
      tests: [],      // {id, classroomId, title, items:[...], createdAt, updatedAt}
      results: []     // {id, testId, classroomId, studentId, score, maxScore, passed, createdAt}
    };
  }

  function normalizeFolderForRead(input) {
    if (!isPlainObject(input)) return emptyFolder();

    var f = emptyFolder();
    f.version = 1;
    f.updatedAt = (typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)) ? input.updatedAt : f.updatedAt;

    f.teachers = Array.isArray(input.teachers) ? input.teachers.filter(isPlainObject) : [];
    f.classrooms = Array.isArray(input.classrooms) ? input.classrooms.filter(isPlainObject) : [];
    f.students = Array.isArray(input.students) ? input.students.filter(isPlainObject) : [];
    f.tests = Array.isArray(input.tests) ? input.tests.filter(isPlainObject) : [];
    f.results = Array.isArray(input.results) ? input.results.filter(isPlainObject) : [];

    return f;
  }

  function load() {
    var rawRes = readRaw();
    if (!rawRes.ok) return rawRes;

    if (!rawRes.data) {
      // Inget sparat än → returnera tom pärm (utan att skriva)
      return makeOk(emptyFolder());
    }

    var parsed = safeJsonParse(rawRes.data);
    return makeOk(normalizeFolderForRead(parsed));
  }

  function save(folder) {
    var err = ensureInited();
    if (err) return err;

    var f = normalizeFolderForRead(folder);
    f.updatedAt = nowTs();

    var json;
    try { json = JSON.stringify(f); }
    catch (_) { return makeErr("BAD_JSON", "Kunde inte serialisera pärmen."); }

    return writeRaw(json);
  }

  // ------------------------------
  // Generic upsert helpers
  // ------------------------------
  function findIndexById(arr, id) {
    var needle = safeStr(id).trim();
    if (!needle) return -1;
    for (var i = 0; i < arr.length; i++) {
      var row = arr[i];
      if (!isPlainObject(row)) continue;
      if (safeStr(row.id).trim() === needle) return i;
    }
    return -1;
  }

  function upsertInList(list, item, opts) {
    var o = isPlainObject(opts) ? opts : {};
    var prefix = safeStr(o.idPrefix || "id_");
    var validate = (typeof o.validate === "function") ? o.validate : null;

    if (!Array.isArray(list)) return makeErr("LIST_INVALID", "Internt fel: listan är inte en array.");
    if (!isPlainObject(item)) return makeErr("ITEM_INVALID", "Item måste vara ett objekt.");

    if (validate) {
      var vr = validate(item);
      if (vr && vr.ok === false) return vr;
    }

    var ts = nowTs();
    var id = safeStr(item.id).trim();
    var nextId = id ? id : genId(prefix);

    var idx = findIndexById(list, nextId);
    if (idx >= 0) {
      var prev = list[idx];
      var createdAt = (prev && typeof prev.createdAt === "number") ? prev.createdAt : ts;

      var merged = {};
      // Behåll allt gammalt som default, men skriv över med nytt
      for (var k in prev) merged[k] = prev[k];
      for (var k2 in item) merged[k2] = item[k2];

      merged.id = nextId;
      merged.createdAt = createdAt;
      merged.updatedAt = ts;

      var out = list.slice();
      out[idx] = merged;
      return makeOk({ list: out, id: nextId, created: false });
    }

    var created = {
      id: nextId,
      createdAt: ts,
      updatedAt: ts
    };
    for (var k3 in item) created[k3] = item[k3];
    created.id = nextId;

    var out2 = list.slice();
    out2.push(created);
    return makeOk({ list: out2, id: nextId, created: true });
  }

  // ------------------------------
  // Validation (enkelt, snällt men fail-closed)
  // ------------------------------
  function mustNonEmpty(s, code, msg) {
    if (!safeStr(s).trim()) return makeErr(code, msg);
    return null;
  }

  function validateTeacher(t) {
    var e = mustNonEmpty(t.name, "VALIDATION_ERROR", "Teacher.name krävs.");
    return e ? e : makeOk(true);
  }

  function validateClassroom(c) {
    var e1 = mustNonEmpty(c.teacherId, "VALIDATION_ERROR", "Classroom.teacherId krävs.");
    if (e1) return e1;
    var e2 = mustNonEmpty(c.name, "VALIDATION_ERROR", "Classroom.name krävs.");
    return e2 ? e2 : makeOk(true);
  }

  function validateStudent(s) {
    var e1 = mustNonEmpty(s.classroomId, "VALIDATION_ERROR", "Student.classroomId krävs.");
    if (e1) return e1;
    var e2 = mustNonEmpty(s.name, "VALIDATION_ERROR", "Student.name krävs.");
    return e2 ? e2 : makeOk(true);
  }

  function validateTest(t) {
    var e1 = mustNonEmpty(t.classroomId, "VALIDATION_ERROR", "Test.classroomId krävs.");
    if (e1) return e1;
    var e2 = mustNonEmpty(t.title, "VALIDATION_ERROR", "Test.title krävs.");
    if (e2) return e2;
    // items kan vara tom i demo, men om finns ska det vara array
    if (t.items !== undefined && t.items !== null && !Array.isArray(t.items)) {
      return makeErr("VALIDATION_ERROR", "Test.items måste vara en array (om den finns).");
    }
    return makeOk(true);
  }

  function validateResult(r) {
    var e1 = mustNonEmpty(r.testId, "VALIDATION_ERROR", "Result.testId krävs.");
    if (e1) return e1;
    var e2 = mustNonEmpty(r.classroomId, "VALIDATION_ERROR", "Result.classroomId krävs.");
    if (e2) return e2;
    var e3 = mustNonEmpty(r.studentId, "VALIDATION_ERROR", "Result.studentId krävs.");
    if (e3) return e3;

    var score = Number(r.score);
    var maxScore = Number(r.maxScore);
    if (!Number.isFinite(score) || score < 0) return makeErr("VALIDATION_ERROR", "Result.score måste vara ett tal >= 0.");
    if (!Number.isFinite(maxScore) || maxScore <= 0) return makeErr("VALIDATION_ERROR", "Result.maxScore måste vara ett tal > 0.");
    if (score > maxScore) return makeErr("VALIDATION_ERROR", "Result.score får inte vara större än maxScore.");

    if (typeof r.passed !== "boolean") return makeErr("VALIDATION_ERROR", "Result.passed måste vara true/false.");
    return makeOk(true);
  }

  // ------------------------------
  // Public operations (enkel “pärm-API”)
  // ------------------------------
  function upsertTeacher(input) {
    var L = load(); if (!L.ok) return L;
    var folder = L.data;

    var u = upsertInList(folder.teachers, input, { idPrefix: "t_", validate: validateTeacher });
    if (!u.ok) return u;

    folder.teachers = u.data.list;
    folder.updatedAt = nowTs();

    var S = save(folder);
    if (!S.ok) return S;

    return makeOk({ id: u.data.id, created: u.data.created });
  }

  function upsertClassroom(input) {
    var L = load(); if (!L.ok) return L;
    var folder = L.data;

    var u = upsertInList(folder.classrooms, input, { idPrefix: "c_", validate: validateClassroom });
    if (!u.ok) return u;

    folder.classrooms = u.data.list;
    folder.updatedAt = nowTs();

    var S = save(folder);
    if (!S.ok) return S;

    return makeOk({ id: u.data.id, created: u.data.created });
  }

  function upsertStudent(input) {
    var L = load(); if (!L.ok) return L;
    var folder = L.data;

    var u = upsertInList(folder.students, input, { idPrefix: "s_", validate: validateStudent });
    if (!u.ok) return u;

    folder.students = u.data.list;
    folder.updatedAt = nowTs();

    var S = save(folder);
    if (!S.ok) return S;

    return makeOk({ id: u.data.id, created: u.data.created });
  }

  function upsertTest(input) {
    var L = load(); if (!L.ok) return L;
    var folder = L.data;

    var u = upsertInList(folder.tests, input, { idPrefix: "x_", validate: validateTest });
    if (!u.ok) return u;

    folder.tests = u.data.list;
    folder.updatedAt = nowTs();

    var S = save(folder);
    if (!S.ok) return S;

    return makeOk({ id: u.data.id, created: u.data.created });
  }

  function addResult(input) {
    var L = load(); if (!L.ok) return L;
    var folder = L.data;

    if (!isPlainObject(input)) return makeErr("VALIDATION_ERROR", "Result måste vara ett objekt.");

    var vr = validateResult(input);
    if (!vr.ok) return vr;

    var ts = nowTs();
    var row = {
      id: genId("r_"),
      testId: safeStr(input.testId).trim(),
      classroomId: safeStr(input.classroomId).trim(),
      studentId: safeStr(input.studentId).trim(),
      score: Number(input.score),
      maxScore: Number(input.maxScore),
      passed: (input.passed === true),
      createdAt: ts
    };

    folder.results = Array.isArray(folder.results) ? folder.results.slice() : [];
    folder.results.push(row);
    folder.updatedAt = ts;

    var S = save(folder);
    if (!S.ok) return S;

    return makeOk({ id: row.id });
  }

  function listResults(filter) {
    var L = load(); if (!L.ok) return L;
    var folder = L.data;

    var f = isPlainObject(filter) ? filter : {};
    var testId = safeStr(f.testId).trim();
    var classroomId = safeStr(f.classroomId).trim();
    var studentId = safeStr(f.studentId).trim();

    var rows = Array.isArray(folder.results) ? folder.results.slice() : [];

    if (testId) rows = rows.filter(function (r) { return safeStr(r.testId).trim() === testId; });
    if (classroomId) rows = rows.filter(function (r2) { return safeStr(r2.classroomId).trim() === classroomId; });
    if (studentId) rows = rows.filter(function (r3) { return safeStr(r3.studentId).trim() === studentId; });

    // Sort: senaste först
    rows.sort(function (a, b) {
      var A = (a && typeof a.createdAt === "number") ? a.createdAt : 0;
      var B = (b && typeof b.createdAt === "number") ? b.createdAt : 0;
      return B - A;
    });

    return makeOk(rows);
  }

  function clearAll() {
    // OBS: farlig i verkligheten, men ok i demo när du testar.
    var err = ensureInited();
    if (err) return err;

    try {
      getStorage().removeItem(_state.storageKey);
      return makeOk(true);
    } catch (_) {
      return makeErr("CLEAR_FAILED", "Kunde inte rensa storage.");
    }
  }

  // ------------------------------
  // Public init
  // ------------------------------
  function init(opts) {
    var o = isPlainObject(opts) ? opts : {};
    var key = safeStr(o.storageKey).trim();

    if (!key) {
      _state.inited = false;
      _state.storageKey = "";
      _state.preferSession = false;
      return { ok: false };
    }

    _state.inited = true;
    _state.storageKey = key;
    _state.preferSession = (o.preferSession === true); // default false

    return { ok: true };
  }

  // ------------------------------
  // Expose API
  // ------------------------------
  window.FolderStore = {
    init: init,

    // basic
    load: load,
    save: save,
    clearAll: clearAll,

    // entity upserts
    upsertTeacher: upsertTeacher,
    upsertClassroom: upsertClassroom,
    upsertStudent: upsertStudent,
    upsertTest: upsertTest,

    // results
    addResult: addResult,
    listResults: listResults
  };
})();

