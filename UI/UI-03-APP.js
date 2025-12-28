/* ============================================================
AO-001 | FIL-ID: UI/UI-03-APP.js
Projekt: HR-System
Syfte: Stam-login + roll-routing (admin, employee) v1
Krav:
- En ingång (UI-01)
- Generiskt fel (ingen kontoläckage)
- Cooldown efter X fel (client-only)
- URL-parametrar (autofyll + auto-login om komplett)
- PIN ej implementerad (hook pinRequired=false + TODO)
============================================================ */

(function () {
  "use strict";

  // ---- Storage (1 nyckel, inget lösenord sparas)
  const STORAGE_KEY = "AO-001_LOGIN_V1";
  const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h

  // ---- Abuse/cooldown
  const MAX_FAILS = 5;
  const COOLDOWN_MS = 30 * 1000;

  const APP_STATE = {
    auth: {
      isAuthed: false,
      role: null,         // "admin" | "employee"
      displayName: null,
      empNo: null,
      pinRequired: false  // AO-001 hook (ingen PIN i v1)
      // TODO (AO-001): Om pinRequired true -> route till PIN-steg (ej nu)
    },
    abuse: {
      attempts: 0,
      cooldownUntil: 0
    }
  };

  const $ = (sel) => document.querySelector(sel);

  // Views
  const viewLogin = $("#view-login");
  const viewAdmin = $("#view-admin");

  // Login form
  const loginForm = $("#loginForm");
  const inpName = $("#inpName");
  const inpEmpNo = $("#inpEmpNo");
  const inpPassword = $("#inpPassword");
  const btnLogin = $("#btnLogin");
  const btnReset = $("#btnReset");
  const loginMessage = $("#loginMessage");

  // Admin placeholder
  const adminWho = $("#adminWho");
  const adminRole = $("#adminRole");
  const btnLogoutAdmin = $("#btnLogoutAdmin");

  function now() { return Date.now(); }

  function showMessage(kind, text) {
    loginMessage.className = "message" + (kind ? " " + kind : "");
    loginMessage.textContent = text || "";
  }

  function sanitizeText(s) {
    return String(s || "").trim().replace(/\s+/g, " ");
  }

  function sanitizeEmpNo(s) {
    return String(s || "").trim().replace(/[^\d]/g, "");
  }

  function isCoolingDown() {
    return APP_STATE.abuse.cooldownUntil > now();
  }

  function remainingCooldownMs() {
    return Math.max(0, APP_STATE.abuse.cooldownUntil - now());
  }

  function disableLoginUI(disabled) {
    inpName.disabled = disabled;
    inpEmpNo.disabled = disabled;
    inpPassword.disabled = disabled;
    btnLogin.disabled = disabled;
    btnReset.disabled = disabled;
  }

  function persistState() {
    const payload = {
      v: 1,
      savedAt: now(),
      auth: {
        isAuthed: APP_STATE.auth.isAuthed,
        role: APP_STATE.auth.role,
        displayName: APP_STATE.auth.displayName,
        empNo: APP_STATE.auth.empNo,
        pinRequired: !!APP_STATE.auth.pinRequired,
        expiresAt: APP_STATE.auth.isAuthed ? (now() + SESSION_TTL_MS) : 0
      },
      abuse: {
        attempts: APP_STATE.abuse.attempts,
        cooldownUntil: APP_STATE.abuse.cooldownUntil
      }
    };

    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // fail-closed: kör utan persist om sessionStorage blockeras
    }
  }

  function loadState() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return;

      if (data.abuse) {
        APP_STATE.abuse.attempts = Number(data.abuse.attempts || 0);
        APP_STATE.abuse.cooldownUntil = Number(data.abuse.cooldownUntil || 0);
      }

      const a = data.auth || null;
      if (a && a.isAuthed && a.expiresAt && a.expiresAt > now()) {
        APP_STATE.auth.isAuthed = true;
        APP_STATE.auth.role = a.role || null;
        APP_STATE.auth.displayName = a.displayName || null;
        APP_STATE.auth.empNo = a.empNo || null;
        APP_STATE.auth.pinRequired = !!a.pinRequired;
      } else {
        APP_STATE.auth.isAuthed = false;
        APP_STATE.auth.role = null;
        APP_STATE.auth.displayName = null;
        APP_STATE.auth.empNo = null;
        APP_STATE.auth.pinRequired = false;
      }
    } catch (e) {}
  }

  function clearState() {
    APP_STATE.auth.isAuthed = false;
    APP_STATE.auth.role = null;
    APP_STATE.auth.displayName = null;
    APP_STATE.auth.empNo = null;
    APP_STATE.auth.pinRequired = false;

    APP_STATE.abuse.attempts = 0;
    APP_STATE.abuse.cooldownUntil = 0;

    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // ---- Demo auth rules (v1, ingen backend)
  function demoAuth(empNo, password) {
    // admin: empNo 9999, lösen "admin"
    // employee: empNo != 9999, lösen "employee"
    const isAdmin = empNo === "9999" && password === "admin";
    const isEmployee = empNo !== "9999" && password === "employee";
    if (isAdmin) return { ok: true, role: "admin" };
    if (isEmployee) return { ok: true, role: "employee" };
    return { ok: false, role: null };
  }

  function bumpFail() {
    APP_STATE.abuse.attempts += 1;
    if (APP_STATE.abuse.attempts >= MAX_FAILS) {
      APP_STATE.abuse.cooldownUntil = now() + COOLDOWN_MS;
      APP_STATE.abuse.attempts = 0;
    }
    persistState();
  }

  function goEmployeeHome() {
    // Vi står i /UI/ -> employee-grenen ligger i repo-root
    window.location.assign("../employee/home.html");
  }

  function render() {
    const hash = window.location.hash || "#login";

    // Views
    if (viewLogin) viewLogin.hidden = true;
    if (viewAdmin) viewAdmin.hidden = true;

    // Authed routing
    if (APP_STATE.auth.isAuthed) {
      if (APP_STATE.auth.role === "employee") {
        goEmployeeHome();
        return;
      }
      if (APP_STATE.auth.role === "admin") {
        window.location.hash = "#admin";
      }
    }

    // Admin placeholder
    if (hash === "#admin") {
      if (viewAdmin) viewAdmin.hidden = false;
      if (adminWho) adminWho.textContent = APP_STATE.auth.displayName || "—";
      if (adminRole) adminRole.textContent = APP_STATE.auth.role || "—";
      return;
    }

    // Login default
    if (viewLogin) viewLogin.hidden = false;

    // Cooldown handling
    if (isCoolingDown()) {
      const sec = Math.ceil(remainingCooldownMs() / 1000);
      disableLoginUI(true);
      showMessage("warn", `För många försök. Vänta ${sec} sekunder och försök igen.`);
      startCooldownTicker();
    } else {
      disableLoginUI(false);
      // lämna ev felmeddelande kvar
    }
  }

  let cooldownTimer = null;
  function startCooldownTicker() {
    if (cooldownTimer) return;
    cooldownTimer = window.setInterval(() => {
      if (!isCoolingDown()) {
        window.clearInterval(cooldownTimer);
        cooldownTimer = null;
        showMessage("", "");
        disableLoginUI(false);
        persistState();
        return;
      }
      const sec = Math.ceil(remainingCooldownMs() / 1000);
      showMessage("warn", `För många försök. Vänta ${sec} sekunder och försök igen.`);
    }, 250);
  }

  function onLoginSubmit(e) {
    e.preventDefault();

    if (isCoolingDown()) {
      render();
      return;
    }

    const name = sanitizeText(inpName.value);
    const empNo = sanitizeEmpNo(inpEmpNo.value);
    const password = String(inpPassword.value || "");

    if (!name || !empNo || !password) {
      showMessage("err", "Felaktiga inloggningsuppgifter.");
      return;
    }

    const res = demoAuth(empNo, password);
    if (!res.ok) {
      bumpFail();
      if (isCoolingDown()) { render(); return; }
      showMessage("err", "Felaktiga inloggningsuppgifter.");
      return;
    }

    // Success
    APP_STATE.auth.isAuthed = true;
    APP_STATE.auth.role = res.role;
    APP_STATE.auth.displayName = name;
    APP_STATE.auth.empNo = empNo;
    APP_STATE.auth.pinRequired = false; // hook only

    APP_STATE.abuse.attempts = 0;
    APP_STATE.abuse.cooldownUntil = 0;

    persistState();

    if (res.role === "employee") {
      goEmployeeHome();
      return;
    }

    window.location.hash = "#admin";
  }

  function onReset() {
    inpName.value = "";
    inpEmpNo.value = "";
    inpPassword.value = "";
    showMessage("", "");
  }

  function onLogout() {
    clearState();
    showMessage("", "");
    window.location.hash = "#login";
    render();
  }

  // ---- URL params support
  function getLoginParams() {
    try {
      const u = new URL(window.location.href);
      const sp = u.searchParams;
      const hasAny = sp.has("name") || sp.has("empNo") || sp.has("password");
      return {
        hasAny,
        name: sanitizeText(sp.get("name")),
        empNo: sanitizeEmpNo(sp.get("empNo")),
        password: String(sp.get("password") || "")
      };
    } catch (e) {
      return { hasAny: false, name: "", empNo: "", password: "" };
    }
  }

  function fillFormFromParams(p) {
    if (!p || !p.hasAny) return;
    if (inpName) inpName.value = p.name || "";
    if (inpEmpNo) inpEmpNo.value = p.empNo || "";
    if (inpPassword) inpPassword.value = p.password || "";
  }

  function tryAutoLoginFromParams() {
    if (APP_STATE.auth.isAuthed) return;

    const p = getLoginParams();
    if (!p.hasAny) return;

    fillFormFromParams(p);

    const canAuto = !!(p.name && p.empNo && p.password);
    if (!canAuto) {
      showMessage("err", "Felaktiga inloggningsuppgifter.");
      return;
    }

    // auto-submit
    onLoginSubmit({ preventDefault: function () {} });
  }

  function init() {
    loadState();

    if (loginForm) loginForm.addEventListener("submit", onLoginSubmit);
    if (btnReset) btnReset.addEventListener("click", onReset);
    if (btnLogoutAdmin) btnLogoutAdmin.addEventListener("click", onLogout);

    window.addEventListener("hashchange", render);

    // Refresh efter login
    if (APP_STATE.auth.isAuthed && APP_STATE.auth.role === "employee") {
      goEmployeeHome();
      return;
    }

    if (!window.location.hash) window.location.hash = "#login";

    render();

    // efter render: URL-parametrar
    tryAutoLoginFromParams();
  }

  init();
})();
