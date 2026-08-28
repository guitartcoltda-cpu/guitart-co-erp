(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function ensureSeed() {
    if (!window.Seed) return;
    // Em modo online (Supabase) o banco é compartilhado por todo mundo —
    // nunca gerar dados fictícios/resetar automaticamente aqui (ver a
    // mesma lógica/comentário em layout.js).
    if (DB.ONLINE_MODE) return;
    var seeded = DB.getSeedVersion();
    if (seeded !== DB.CURRENT_SEED_VERSION) {
      window.Seed.run();
      DB.setSeedVersion();
    }
  }

  function init() {
    // Seed the database (if needed) BEFORE any authentication happens on
    // this page. Seed.run() calls DB.resetAll() internally, which wipes
    // users/activityLog back to defaults — if seeding were deferred to the
    // first authenticated page (as it used to be), a fresh install's very
    // first "entrou no sistema" log entry would get wiped out moments after
    // being written. Doing it here guarantees seeding is already done by
    // the time DB.log() records the login.
    ensureSeed();

    // if already logged in, skip straight past the login screen
    var existing = CurrentUser.get();
    if (existing && DB.get("users", existing.id) && DB.get("users", existing.id).active) {
      goToRedirect();
      return;
    }

    var form = document.getElementById("login-form");
    var cpfInput = document.getElementById("li-cpf");
    var passInput = document.getElementById("li-pass");
    var errEl = document.getElementById("li-error");

    cpfInput.addEventListener("input", function (e) {
      var digits = Utils.onlyDigits(e.target.value).slice(0, 11);
      e.target.value = digits.length === 11 ? Utils.fmtCPF(digits) : digits;
    });
    passInput.addEventListener("input", function (e) {
      e.target.value = Utils.onlyDigits(e.target.value).slice(0, 20);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errEl.classList.remove("show");

      var cpf = Utils.onlyDigits(cpfInput.value);
      var pass = passInput.value;
      if (!cpf || !pass) { showError("Informe CPF e senha."); return; }

      var user = DB.findOne("users", function (u) { return u.cpf === cpf; });
      if (!user) { showError("CPF não encontrado."); return; }
      if (!user.active) { showError("Este acesso está inativo. Fale com um administrador."); return; }
      if (user.password !== pass) { showError("Senha incorreta."); return; }

      CurrentUser.set({ id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role });
      DB.log("Acesso", user.firstName + " " + user.lastName + " entrou no sistema");
      goToRedirect();
    });

    function showError(msg) {
      errEl.textContent = msg;
      errEl.classList.add("show");
    }
  }

  function goToRedirect() {
    var params = new URLSearchParams(location.search);
    var redirect = params.get("redirect");
    var safe = redirect && /^[a-z0-9_-]+\.html$/i.test(redirect) ? redirect : "index.html";
    location.href = safe;
  }
})();
