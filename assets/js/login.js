(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
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
