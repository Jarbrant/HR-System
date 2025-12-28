
/* ============================================================
AO-002 | FIL-ID: employee/employee.js
Projekt: HR Onboarding
Syfte: Medarbetar-gren – auth-guard + header-fill + logout (för separata sidor)
Gäller för: employee/home.html, tasks.html, questions.html, schedule.html, docs.html, report.html, profile.html
Policy:
- Ingen backend (v1)
- Läser endast session från sessionStorage (AO-001_LOGIN_V1)
- Ingen känslig data lagras
============================================================ */

(function () {
  "use strict";

  const STORAGE_KEY = "AO-001_LOGIN_V1";

  const $ = (sel) => document.querySelector(sel);

  // Standardfält (finns i home.html, kan återanvändas i andra sidor)
  const whoName = $("#whoName");
  const whoEmpNo = $("#whoEmpNo");
  const whoRole = $("#whoRole");
  const btnLogout = $("#btnLogout");

  // Profile-sidan kan ha dessa
  const pName = $("#pName");
  const pEmp = $("#pEmp");
  const pRole = $("#pRole");
  const pwStatus = $("#pwStatus");

  // Report-sidan kan ha dessa
  const techInfo = $("#techInfo");
  const reportForm = $("#reportForm");
  const reportText = $("#reportText");
  const reportStatus = $("#reportStatus");

  function safeJsonParse(raw) {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function sanitizeText(s) {
    return String(s || "").trim().replace(/\s+/g, " ");
  }

  function readSessionEmployee() {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const data = safeJsonParse(raw);
    if (!data || data.v !== 1 || !data.auth) return null;

    const a = data.auth;
    const expiresAt = Number(a.expiresAt || 0);

    if (!a.isAuthed) return null;
    if (!expiresAt || expiresAt <= Date.now()) return null;
    if (a.role !== "employee") return null;

    return {
      displayName: a.displayName || "—",
      empNo: a.empNo || "—",
      role: a.role || "employee"
    };
  }

  function redirectToLogin() {
    // Vi är i /employee/ så login ligger i /UI/
    window.location.assign("../UI/UI-01-SKELETON.html#login");
  }

  function computeTechInfo(auth) {
    const lang = document.documentElement.lang || navigator.language || "sv";
    return {
      page: window.location.href,
      language: lang,
      role: auth.role || "employee",
      empNo: auth.empNo || "",
      userAgent: navigator.userAgent,
      time: new Date().toISOString()
    };
  }

  function fillIdentity(auth) {
    if (whoName) whoName.textContent = auth.displayName || "—";
    if (whoEmpNo) whoEmpNo.textContent = auth.empNo || "—";
    if (whoRole) whoRole.textContent = auth.role || "employee";

    // Om profile-sidan har extra fält
    if (pName) pName.textContent = auth.displayName || "—";
    if (pEmp) pEmp.textContent = auth.empNo || "—";
    if (pRole) pRole.textContent = auth.role || "employee";
  }

  function wireLogout() {
    if (!btnLogout) return;
    btnLogout.addEventListener("click", () => {
      try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
      redirectToLogin();
    });
  }

  function wireDemoActions() {
    document.querySelectorAll("[data-demo-action]").forEach((btn) => {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";

      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-demo-action");

        if (action === "done") alert("Demo: markerad som klar (ingen lagring i v1).");
        if (action === "read") alert("Demo: markerad som läst (ingen lagring i v1).");
        if (action === "send-answer") alert("Demo: svar skickat (ska senare gå till Chef + Admin).");
        if (action === "change-password") {
          if (pwStatus) pwStatus.textContent = "Kräver backend för säker lösenordsändring (placeholder).";
        }
      });
    });
  }

  function wireReport(auth) {
    if (!reportForm || !techInfo) return;

    // Fyll teknisk info direkt
    techInfo.textContent = JSON.stringify(computeTechInfo(auth), null, 2);

    reportForm.addEventListener("submit", (e) => {
      e.preventDefault();

      const text = sanitizeText(reportText ? reportText.value : "");
      if (!text) {
        if (reportStatus) reportStatus.textContent = "Skriv en kort beskrivning innan du skickar.";
        return;
      }

      // UI-only: inget sparas/skickas
      if (reportStatus) reportStatus.textContent = "Demo: rapport skickad (inget sparas i v1).";
      if (reportText) reportText.value = "";

      // uppdatera tid
      techInfo.textContent = JSON.stringify(computeTechInfo(auth), null, 2);
    });
  }

  function init() {
    const auth = readSessionEmployee();
    if (!auth) {
      redirectToLogin();
      return;
    }

    fillIdentity(auth);
    wireLogout();
    wireDemoActions();
    wireReport(auth);
  }

  init();
})();

