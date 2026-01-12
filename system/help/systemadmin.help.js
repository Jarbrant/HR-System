/* ============================================================
   AO-SYS-HELP-PACK-SYSTEMADMIN-01 (PROD) | FIL: system/help/systemadmin.help.js (NY)
   Projekt: HR-System (GitHub Pages / UI-only)
   Syfte: Global support för alla Systemadmin-sidor (Dashboard + Org + Assignments + framtida)
   Används av: system/support-core.js (scope-läge “Hela Systemadmin”)
   Pack-ID: "systemadmin" (MUST)

   POLICY (LÅST):
   - Endast statisk data (text + matchregler + blockkartor)
   - Ingen DOM-access • Ingen storage • Ingen auth/session
   - XSS-säkert: endast textsträngar, inga HTML-strängar
   ============================================================ */

(function () {
  "use strict";

  window.SystemHelpPacks = window.SystemHelpPacks || {};

  var PACK = {
    meta: {
      scopeId: "systemadmin",
      scopeName: "Hela Systemadmin",
      version: "1.0"
    },

    title: "Systemadmin (global support)",

    quickGuide: [
      "Börja i Systemstart: se status och länkar.",
      "Skapa Org: root → Bolag → ENHET (minst en ENHET krävs).",
      "Skapa Assignments: empNo → roll → ENHET(er).",
      "Åtgärda varningar: ogiltiga scopes eller ADMIN utan ENHET."
    ],

    faqs: [
      {
        id: "where_to_start",
        q: "Var börjar jag i Systemadmin?",
        a: [
          "1) Gå till Org och skapa root + minst en ENHET.",
          "2) Gå till Assignments och skapa ADMIN-kopplingar (empNo → ENHET).",
          "3) Återvänd till Systemstart för att verifiera status."
        ]
      },
      {
        id: "org_missing",
        q: "Org saknas / systemet är inte konfigurerat",
        a: [
          "Det betyder oftast att root saknas eller org-data är tom.",
          "Gå till Org Builder och skapa root + minst en ENHET.",
          "Uppdatera sidan och prova igen."
        ]
      },
      {
        id: "what_is_enhet",
        q: "Vad är ENHET och varför är den viktig?",
        a: [
          "ENHET är den nodtyp som används som scope för ADMIN.",
          "Root och Bolag är struktur – ENHET är operativ nivå.",
          "Utan ENHET kan ADMIN inte få korrekt åtkomst (fail-closed)."
        ]
      },
      {
        id: "cant_save_assignments",
        q: "Jag kan inte spara i Assignments",
        a: [
          "Kontrollera att Org finns och att det finns ENHET(er).",
          "empNo måste vara 1–12 siffror.",
          "ADMIN kräver minst 1 ENHET (val eller klistrat ID).",
          "Alla klistrade enhets-ID måste finnas i Org och vara typen ENHET."
        ]
      },
      {
        id: "warnings_health",
        q: "Varningar / Datahälsa – vad betyder det?",
        a: [
          "Varningar betyder att data inte följer policyn och behöver åtgärdas.",
          "Vanligt: ogiltiga ENHET-scopes eller ADMIN utan ENHET.",
          "Åtgärda i Assignments (rensa/ändra) eller i Org (återskapa ENHET)."
        ]
      },
      {
        id: "system_admin_scope",
        q: "SYSTEM_ADMIN har scope – är det fel?",
        a: [
          "SYSTEM_ADMIN ska normalt ha tom scope enligt policy.",
          "Rensa scopes från SYSTEM_ADMIN-rader för att följa policy."
        ]
      },
      {
        id: "deleted_enhet",
        q: "Jag tog bort en ENHET – vad händer nu?",
        a: [
          "Assignments kan bli ogiltiga om ENHET som används i scope försvinner.",
          "Gå till Assignments och rensa ogiltiga scopes eller välj nya ENHET(er)."
        ]
      }
    ],

    match: [
      { keywords: ["börja", "start", "ordning", "var börjar"], faqId: "where_to_start" },
      { keywords: ["org", "root", "konfigurer", "saknas"], faqId: "org_missing" },
      { keywords: ["enhet", "scope", "vad är"], faqId: "what_is_enhet" },
      { keywords: ["spara", "kan inte", "assignments", "empno"], faqId: "cant_save_assignments" },
      { keywords: ["varning", "datahälsa", "ogiltig", "invalid"], faqId: "warnings_health" },
      { keywords: ["system_admin", "systemadmin", "scope"], faqId: "system_admin_scope" },
      { keywords: ["tog bort", "radera", "enhet"], faqId: "deleted_enhet" }
    ],

    troubleshoot: [
      "Finns Org med root + minst en ENHET?",
      "Finns Assignments för ADMIN med minst 1 ENHET?",
      "Finns varningar om ogiltiga scopes? Rensa/justera i Assignments.",
      "Uppdatera sidan efter ändringar."
    ],

    // BLOCK-stöd (v1 generellt, framtidssäkert)
    blocks: [
      {
        pageId: "dashboard",
        pageTitle: "Systemstart",
        items: [
          {
            blockId: "B3",
            title: "Topbar + nav",
            checklist: [
              "Inloggad-rad visar SYSTEM_ADMIN",
              "Länkar går till Org och Assignments",
              "Logga ut fungerar"
            ]
          },
          {
            blockId: "B4",
            title: "Status/tiles",
            checklist: [
              "Org-status visar OK eller tydlig varning",
              "Roller-status visar OK eller tydlig varning",
              "Nästa steg visar korrekt riktning"
            ]
          }
        ]
      },
      {
        pageId: "org",
        pageTitle: "Org Builder",
        items: [
          {
            blockId: "B4",
            title: "Org-form",
            checklist: [
              "Root finns",
              "Minst en ENHET finns",
              "Struktur ligger under root",
              "Inga dubbletter på samma nivå"
            ]
          }
        ]
      },
      {
        pageId: "assignments",
        pageTitle: "Assignments",
        items: [
          {
            blockId: "B4",
            title: "Status/health",
            checklist: [
              "Org finns och innehåller ENHET",
              "Varningar syns om något är fel",
              "Ogiltiga scopes kan rensas"
            ]
          },
          {
            blockId: "B5",
            title: "Form",
            checklist: [
              "empNo är 1–12 siffror",
              "ADMIN har minst 1 ENHET",
              "SYSTEM_ADMIN har tom scope",
              "Ogiltiga scopes rensade"
            ]
          }
        ]
      }
    ]
  };

  window.SystemHelpPacks["systemadmin"] = PACK;
})();

