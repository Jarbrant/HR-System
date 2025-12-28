<!-- ============================================================
AO-001 | FIL-ID: employee/home.html
Projekt: HR-System
Syfte: Medarbetarens startsida (Dashboard) – UI-only v1
Policy:
- Ingen backend
- Ingen känslig data lagras
============================================================ -->
<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HR-System – Medarbetare</title>

  <!-- Gemensam styling -->
  <link rel="stylesheet" href="../UI/UI-02-STYLES.css" />
</head>
<body>

  <header class="top">
    <div class="brand">
      <strong>HR-System</strong>
      <span class="muted">• Medarbetare</span>
    </div>

    <nav class="nav" aria-label="Meny">
      <a href="./home.html" aria-current="page">Hem</a>
      <a href="./tasks.html">Uppgifter</a>
      <a href="./questions.html">Frågor</a>
      <a href="./schedule.html">Schema</a>
      <a href="./docs.html">Dokument</a>
      <a href="./report.html">Rapportera fel</a>
    </nav>
  </header>

  <main class="container">

    <section class="card">
      <div class="row space-between wrap">
        <div>
          <h1 class="tight">Min sida</h1>
          <div class="muted">
            Hej <strong id="whoName">—</strong>
            • Anst.nr <span id="whoEmpNo">—</span>
            • Roll <span id="whoRole">employee</span>
          </div>
        </div>

        <div class="row wrap">
          <a class="btn secondary" href="./profile.html">Min profil</a>
          <button id="btnLogout" class="secondary" type="button">Logga ut</button>
        </div>
      </div>

      <!-- Snabbnavigering -->
      <div class="grid-cards">
        <a class="bigcard" href="./tasks.html">
          <div class="bigcard-title">Uppgifter</div>
          <div class="muted">3 att göra idag <span class="tag">demo</span></div>
        </a>

        <a class="bigcard" href="./questions.html">
          <div class="bigcard-title">Frågor</div>
          <div class="muted">2 nya från chef <span class="tag">demo</span></div>
        </a>

        <a class="bigcard" href="./schedule.html">
          <div class="bigcard-title">Schema</div>
          <div class="muted">Nästa pass: tis 07:00 <span class="tag">demo</span></div>
        </a>

        <a class="bigcard" href="./docs.html">
          <div class="bigcard-title">Dokument</div>
          <div class="muted">1 policy att kvittera <span class="tag">demo</span></div>
        </a>

        <a class="bigcard" href="./report.html">
          <div class="bigcard-title">Rapportera fel</div>
          <div class="muted">Skicka fel med teknisk info</div>
        </a>

        <a class="bigcard" href="./profile.html">
          <div class="bigcard-title">Min sida</div>
          <div class="muted">Profil & lösenord</div>
        </a>
      </div>

      <!-- Dashboard-paneler -->
      <div class="dashgrid">
        <section class="panel">
          <div class="panel-title">Dagens uppgifter <span class="tag">demo</span></div>
          <ul class="list">
            <li><span>Check-in (2 min)</span><span class="pill">Ej startad</span></li>
            <li><span>Läs rutin: Hygien</span><span class="pill">Pågår</span></li>
            <li><span>Bekräfta leverans</span><span class="pill">Ej startad</span></li>
          </ul>
          <a class="link" href="./tasks.html">Visa alla →</a>
        </section>

        <section class="panel">
          <div class="panel-title">Väntar på svar <span class="tag">demo</span></div>
          <ul class="list">
            <li><span>Hur gick första veckan?</span><span class="pill">Svar krävs</span></li>
            <li><span>Har du rätt verktyg?</span><span class="pill">Svar krävs</span></li>
          </ul>
          <a class="link" href="./questions.html">Öppna frågor →</a>
        </section>
      </div>
    </section>

  </main>

  <!-- AO-001 | FIL-ID: employee/employee.js -->
  <script src="./employee.js"></script>
</body>
</html>
