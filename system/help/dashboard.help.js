/* ============================================================
   AO-SYS-HELP-PACK-DASHBOARD-01 (PROD) | FIL: system/help/dashboard.help.js (NY)
   Projekt: HR-System (GitHub Pages / UI-only)
   Syfte: Sidspecifikt Help Pack för System • Dashboard (pageId: "dashboard")
   Används av: system/support-core.js (AO-SYS-SUPPORT-CORE-01)

   POLICY (LÅST):
   - Endast statisk data (text + matchregler)
   - Ingen DOM-access • Ingen storage • Ingen auth/session
   - XSS-säkert: endast textsträngar, inga HTML-strängar
   ============================================================ */

(function () {
  "use strict";

  // MUST: säkerställ registry
  window.SystemHelpPacks = window.SystemHelpPacks || {};

  // MUST: pack (statisk data)
  var PACK = {
    title: "Systemstart (Dashboard)",

    quickGuide: [
      "Börja här för att se systemstatus och genvägar till Org och Assignments.",
      "Om systemet inte är konfigurerat: skapa Org först.",
      "När Org är klar: skapa Assignments (empNo → roll → ENHET)."
    ],

    faqs: [
      {
        id: "what_is_dashboard",
        q: "Vad är Systemstart (Dashboard)?",
        a: [
          "Systemstart är en översikt för systemförvaltning.",
          "Den visar status och länkar till viktiga systemfunktioner.",
          "Härifrån går du vidare till Org och Assignments."
        ]
      },
      {
        id: "not_configured",
        q: "Systemet är inte konfigurerat",
        a: [
          "Det betyder oftast att Org saknas eller root saknas.",
          "Gå till Org och skapa root + minst en ENHET.",
          "Kom tillbaka hit och uppdatera sidan."
        ]
      },
      {
        id: "where_to_start",
        q: "Var ska jag börja?",
        a: [
          "1) Skapa Org (root → Bolag → ENHET).",
          "2) Skapa Assignments (empNo → roll → ENHET).",
          "3) Kontrollera varningar och datahälsa."
        ]
      },
      {
        id: "assignments_flow",
        q: "Hur fungerar Assignments i korthet?",
        a: [
          "Assignments kopplar empNo till roll och ENHET(er).",
          "ADMIN måste ha minst 1 ENHET.",
          "SYSTEM_ADMIN ska normalt ha tom scope."
        ]
      },
      {
        id: "warnings",
        q: "Varningar / Datahälsa",
        a: [
          "Varningar betyder att något behöver åtgärdas innan allt fungerar stabilt.",
          "Vanligt är ogiltiga ENHET-scopes eller saknad ENHET för ADMIN.",
          "Åtgärda i Org eller Assignments beroende på vad som är fel."
        ]
      },
      {
        id: "permissions",
        q: "Vem får göra vad i Systemadmin?",
        a: [
          "Systemadmin-sidor är för SYSTEM_ADMIN (systemförvaltning).",
          "Behörigheter och scope styr vad ADMIN kan se i andra moduler.",
          "Ändringar slår igenom direkt i systemet (UI-only)."
        ]
      }
    ],

    match: [
      { keywords: ["dashboard", "systemstart", "översikt", "start"], faqId: "what_is_dashboard" },
      { keywords: ["inte konfigurerat", "konfigurer", "saknas", "root", "org"], faqId: "not_configured" },
      { keywords: ["börja", "var ska jag", "starta", "ordning"], faqId: "where_to_start" },
      { keywords: ["assignments", "anst", "empno", "enhet", "scope"], faqId: "assignments_flow" },
      { keywords: ["varning", "datahälsa", "ogiltig", "invalid"], faqId: "warnings" },
      { keywords: ["behör", "permission", "roll", "system_admin", "admin"], faqId: "permissions" }
    ],

    troubleshoot: [
      "Om systemet inte är konfigurerat: gå till Org och skapa root + ENHET.",
      "Om ADMIN inte fungerar: kontrollera Assignments (ADMIN kräver ENHET).",
      "Om varningar syns: åtgärda ogiltiga scopes i Assignments eller struktur i Org.",
      "Uppdatera sidan efter ändringar för att se senaste status."
    ],

    // OPTIONAL (NICE) — standard: false
    enableAnonStatus: false
  };

  // MUST: register pack for pageId "dashboard"
  window.SystemHelpPacks["dashboard"] = PACK;
})();

