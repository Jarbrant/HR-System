/* ============================================================
   AO-SYS-HELP-PACK-ORG-01 (PROD) | FIL: system/help/org.help.js (NY)
   Projekt: HR-System (GitHub Pages / UI-only)
   Syfte: Sidspecifikt Help Pack för System • Org (Org Builder) (pageId: "org")
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
    title: "Org (Organisation)",

    quickGuide: [
      "Skapa alltid root först (organisationens topp).",
      "Lägg därefter till Bolag och ENHET under rätt förälder.",
      "Spara och kontrollera att ENHET finns innan du går vidare till Assignments."
    ],

    faqs: [
      {
        id: "cant_save",
        q: "Jag kan inte spara",
        a: [
          "Kontrollera att root finns.",
          "Alla noder måste ha namn och korrekt typ.",
          "Kontrollera att du inte försöker skapa dubbletter."
        ]
      },
      {
        id: "what_is_root",
        q: "Vad är root?",
        a: [
          "Root är organisationens toppnod.",
          "Det ska bara finnas en root.",
          "Alla andra noder måste ligga under root."
        ]
      },
      {
        id: "node_types",
        q: "Vad är skillnaden på Bolag och ENHET?",
        a: [
          "Bolag används för gruppering och struktur.",
          "ENHET är den operativa nivån som används i Assignments.",
          "Endast ENHET kan väljas som scope för ADMIN."
        ]
      },
      {
        id: "invalid_structure",
        q: "Ogiltig struktur",
        a: [
          "Det betyder att en nod saknar giltig förälder.",
          "Det kan också bero på att root saknas eller är felkopplad.",
          "Rätta strukturen och spara igen."
        ]
      },
      {
        id: "duplicates",
        q: "Dubbletter av noder",
        a: [
          "Varje nod ska vara unik inom organisationen.",
          "Undvik att skapa flera noder med samma namn på samma nivå."
        ]
      },
      {
        id: "delete_node",
        q: "Ta bort nod",
        a: [
          "Du kan inte ta bort en nod som har barn.",
          "Ta bort eller flytta barnnoder först.",
          "Borttagning påverkar Assignments som använder ENHET."
        ]
      },
      {
        id: "used_in_assignments",
        q: "ENHET används i Assignments",
        a: [
          "Om en ENHET tas bort kan assignments bli ogiltiga.",
          "Använd Assignments-sidan för att rensa eller justera scopes."
        ]
      }
    ],

    match: [
      { keywords: ["spara", "kan inte", "save", "sparar inte"], faqId: "cant_save" },
      { keywords: ["root", "rot", "topp"], faqId: "what_is_root" },
      { keywords: ["bolag", "enhet", "skillnad", "typ"], faqId: "node_types" },
      { keywords: ["ogiltig", "struktur", "förälder", "fel"], faqId: "invalid_structure" },
      { keywords: ["dubblett", "duplicat", "finns redan"], faqId: "duplicates" },
      { keywords: ["ta bort", "delete", "radera"], faqId: "delete_node" },
      { keywords: ["assignments", "används", "scope"], faqId: "used_in_assignments" }
    ],

    troubleshoot: [
      "Finns exakt en root?",
      "Ligger alla noder under root?",
      "Har varje nod rätt typ (Bolag eller ENHET)?",
      "Finns minst en ENHET skapad?",
      "Om ENHET ändrats: kontrollera Assignments efteråt."
    ],

    // OPTIONAL (NICE) — standard: false
    enableAnonStatus: false
  };

  // MUST: register pack for pageId "org"
  window.SystemHelpPacks["org"] = PACK;
})();

