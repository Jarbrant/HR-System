HR-System/
├─ index.html
│
├─ UI/                              ← STAM (gemensam ingång)
│  ├─ UI-01-SKELETON.html            (login + roll-routing)
│  ├─ UI-02-STYLES.css               (global design – ENDA källan för färg/layout)
│  └─ UI-03-APP.js                   (auth/state/router v1)
│
├─ employee/                         ← GREN: MEDARBETARE
│  ├─ home.html                     (dashboard – nav + status)
│  ├─ tasks.html                    (tilldelade uppgifter)
│  ├─ questions.html                (svara på frågor)
│  ├─ schedule.html                 (schema – read-only v1)
│  ├─ docs.html                     (dokument + kvittens)
│  ├─ report.html                   (rapportera fel)
│  ├─ profile.html                  (profil / byt lösenord – placeholder)
│  │
│  ├─ training/                     ← Nivå 3 – Utbildning
│  │  ├─ index.html                 (kurser – lista)
│  │  ├─ course.html                (mikrokurs – innehåll)
│  │  └─ quiz.html                  (enkelt quiz – demo)
│  │
│  ├─ communication/                ← Nivå 3 – Kommunikation
│  │  ├─ index.html                 (meddelanden/announcements)
│  │  └─ message.html               (enskilt meddelande + kvittens)
│  │
│  ├─ inventory/                    ← Nivå 3 – Inventering
│  │  └─ checklist.html             (checklista / bekräfta mottaget)
│  │
│  └─ insights/                     ← Nivå 4 – Personliga insikter
│     └─ index.html                 (egen historik – read-only)
│
├─ admin/                            ← GREN: ADMIN / SYSTEMANSVARIG
│  ├─ home.html                     (admin dashboard)
│  ├─ tasks.html                    (AO-046 – skapa/tilldela uppgifter)
│  ├─ questions.html                (skapa frågor + anonym-val)
│  ├─ answers.html                  (svarsinbox – separat)
│  ├─ reports.html                  (felrapporter + åtgärdsplan)
│  ├─ integrations.html             (API-nycklar, status, maskning)
│  │
│  ├─ training/                     ← Nivå 3 – Utbildning (admin)
│  │  ├─ index.html                 (kurser – översikt)
│  │  └─ editor.html                (skapa/redigera kurs)
│  │
│  ├─ communication/                ← Nivå 3 – Kommunikation
│  │  └─ index.html                 (skapa announcements)
│  │
│  ├─ inventory/                    ← Nivå 3 – Inventering
│  │  └─ templates.html             (checklist-mallar)
│  │
│  ├─ quality/                      ← Nivå 4 – Kvalitet & Avvikelser
│  │  ├─ incidents.html             (avvikelser/incidenter)
│  │  └─ capa.html                  (CAPA – senare)
│  │
│  ├─ improvements/                ← Nivå 4 – Förbättringsförslag
│  │  └─ index.html                 (idéer + status)
│  │
│  └─ insights/                     ← Nivå 4 – Insikter (admin)
│     └─ index.html                 (aggregerat – ej övervakning)
│
├─ assets/
│  ├─ js/                           (ev. gemensamma helpers senare)
│  └─ img/                          (ev. ikoner/bilder)
│
└─ ARCHIVE/
   ├─ v0.1/
   │  ├─ UI/
   │  ├─ employee/
   │  └─ admin/
   └─ v0.2/
      └─ (framtida versioner)

