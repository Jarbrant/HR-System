/* ============================================================
   AO-SYS-HELP-PACK-ASSIGNMENTS-01 (PROD) | FIL: system/help/assignments.help.js (NY)
   Projekt: HR-System (GitHub Pages / UI-only)
   Syfte: Sidspecifikt Help Pack för system/assignments.html (pageId: "assignments")
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
    title: "Assignments",

    quickGuide: [
      "Skapa Org först (minst root + ENHET).",
      "Fyll i empNo (1–12 siffror) och välj roll.",
      "För ADMIN: välj minst 1 ENHET (eller klistra in enhets-ID) och klicka Spara."
    ],

    faqs: [
      {
        id: "cant_save",
        q: "Jag kan inte spara",
        a: [
          "Kontrollera att Org finns. Om systemet säger att det inte är konfigurerat måste du skapa Org först.",
          "empNo måste vara 1–12 siffror.",
          "ADMIN kräver minst 1 ENHET.",
          "Om du klistrar in enhets-ID: alla ID måste finnas i Org och vara typen ENHET (ogiltiga stoppar sparande)."
        ]
      },
      {
        id: "org_missing",
        q: "Org saknas / systemet är inte konfigurerat",
        a: [
          "Gå till Org Builder och skapa root + minst en ENHET.",
          "Kom tillbaka hit och uppdatera sidan."
        ]
      },
      {
        id: "what_is_enhet",
        q: "Vad är ENHET?",
        a: [
          "ENHET är den nodtyp som får användas som scope för ADMIN på denna sida.",
          "Root och Bolag kan inte väljas som ENHET här."
        ]
      },
      {
        id: "invalid_scopes",
        q: "Varning: ogiltiga enheter",
        a: [
          "Det betyder att en eller flera scopeIds inte längre finns i org-trädet eller inte är typen ENHET.",
          "Använd 'Rensa ogiltiga enheter' för att ta bort dem.",
          "Om inga enheter återstår blir raden 'Saknar enhet' tills du väljer ENHET igen."
        ]
      },
      {
        id: "system_admin_scope",
        q: "Varning: SYSTEM_ADMIN har scope",
        a: [
          "SYSTEM_ADMIN ska normalt ha tom scope enligt policy.",
          "Använd 'Rensa ogiltiga enheter' för att rensa scope från SYSTEM_ADMIN-rader."
        ]
      },
      {
        id: "paste_ids",
        q: "Klistra in enhets-ID",
        a: [
          "Klistra in ett enhets-ID per rad.",
          "ID måste finnas i Org och vara typen ENHET.",
          "Tips: i listan kan du se enheternas namn och ID."
        ]
      },
      {
        id: "edit_mode",
        q: "Varför är empNo låst när jag redigerar?",
        a: [
          "När du redigerar en rad är empNo låst för att undvika att du råkar ändra nyckeln.",
          "Klicka 'Ny' (eller 'Avsluta redigering') för att skapa en ny rad igen."
        ]
      },
      {
        id: "delete_row",
        q: "Ta bort assignment",
        a: [
          "Ta bort tar bort kopplingen för empNo direkt.",
          "Du får alltid en bekräftelse innan borttagning."
        ]
      }
    ],

    match: [
      { keywords: ["spara", "kan inte", "save", "sparar inte"], faqId: "cant_save" },
      { keywords: ["org", "root", "konfigurer", "saknas"], faqId: "org_missing" },
      { keywords: ["enhet", "scope", "vad är"], faqId: "what_is_enhet" },
      { keywords: ["ogiltig", "invalid", "varning", "fel enhet"], faqId: "invalid_scopes" },
      { keywords: ["system_admin", "systemadmin", "system admin"], faqId: "system_admin_scope" },
      { keywords: ["klistra", "paste", "id", "enhets-id", "scopeid"], faqId: "paste_ids" },
      { keywords: ["redigera", "låst", "empno"], faqId: "edit_mode" },
      { keywords: ["ta bort", "delete", "radera"], faqId: "delete_row" }
    ],

    troubleshoot: [
      "Org: finns root + minst en ENHET?",
      "empNo: är det 1–12 siffror?",
      "Roll: ADMIN eller SYSTEM_ADMIN?",
      "ADMIN: är minst 1 ENHET vald eller inmatad?",
      "Varningar: använd 'Rensa ogiltiga enheter' om ogiltiga scopes visas."
    ],

    // OPTIONAL (NICE)
    enableAnonStatus: true
  };

  // MUST: register pack for pageId "assignments"
  window.SystemHelpPacks["assignments"] = PACK;
})();

