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

      var submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      Utils.verifyPassword(pass, user.password).then(function (ok) {
        if (!ok) {
          if (submitBtn) submitBtn.disabled = false;
          showError("Senha incorreta.");
          return;
        }

        // migração silenciosa: se a senha ainda estava em texto puro, salva já com hash
        var migrate = Utils.isHashedPassword(user.password) ? Promise.resolve() :
          Utils.hashPassword(pass).then(function (hashed) { return DB.update("users", user.id, { password: hashed }); });

        migrate.catch(function () { /* falha na migração silenciosa não deve bloquear o login */ }).then(function () {
          CurrentUser.set({ id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role });
          DB.log("Acesso", user.firstName + " " + user.lastName + " entrou no sistema");
          goToRedirect();
        });
      }).catch(function () {
        if (submitBtn) submitBtn.disabled = false;
        showError("Não foi possível validar a senha. Tente novamente.");
      });
    });

    function showError(msg) {
      errEl.textContent = msg;
      errEl.classList.add("show");
    }

    var forgotLink = document.getElementById("li-forgot-link");
    if (forgotLink) {
      forgotLink.addEventListener("click", function (e) {
        e.preventDefault();
        openForgotModal();
      });
    }
  }

  // ---------------- Esqueci minha senha (redefinição por código de e-mail) ----------------

  function openForgotModal() {
    var body =
      '<p class="small text-muted mb-16">Informe seu CPF. Se houver um e-mail cadastrado para esse acesso, enviaremos um código de 4 dígitos para confirmar a redefinição.</p>' +
      '<div class="form-field full mb-16"><label>CPF</label><input type="text" id="fp-cpf" inputmode="numeric" placeholder="000.000.000-00" maxlength="14" autofocus></div>' +
      '<div class="login-error" id="fp-error"></div>';
    var foot =
      '<button class="btn btn-secondary" data-close-modal>Cancelar</button>' +
      '<button class="btn btn-primary" id="fp-send-btn">Enviar código</button>';
    var box = Modal.open({ title: "Esqueci minha senha", bodyHtml: body, footHtml: foot });
    var cpfInput = box.querySelector("#fp-cpf");
    var errEl = box.querySelector("#fp-error");
    var sendBtn = box.querySelector("#fp-send-btn");

    cpfInput.addEventListener("input", function (e) {
      var digits = Utils.onlyDigits(e.target.value).slice(0, 11);
      e.target.value = digits.length === 11 ? Utils.fmtCPF(digits) : digits;
    });

    sendBtn.addEventListener("click", function () {
      errEl.classList.remove("show");
      sendBtn.disabled = true;
      sendBtn.textContent = "Enviando...";
      ResetSenha.requestReset(cpfInput.value).then(function (r) {
        openVerifyModal(r.userId, r.maskedEmail);
      }).catch(function (err) {
        sendBtn.disabled = false;
        sendBtn.textContent = "Enviar código";
        errEl.textContent = (err && err.message) || "Não foi possível enviar o código.";
        errEl.classList.add("show");
      });
    });
  }

  function openVerifyModal(userId, maskedEmail) {
    var body =
      '<p class="small text-muted mb-16">Enviamos um código de 4 dígitos para <strong>' + Utils.escapeHtml(maskedEmail) + '</strong>. Ele vale por ' + ResetSenha.CODE_TTL_MIN + ' minutos.</p>' +
      '<div class="form-field full mb-16"><label>Código recebido</label><input type="text" id="fp-code" inputmode="numeric" maxlength="4" placeholder="0000"></div>' +
      '<div class="form-field full mb-16"><label>Nova senha</label><input type="password" id="fp-pass1" inputmode="numeric" placeholder="mín. 4 dígitos"></div>' +
      '<div class="form-field full mb-16"><label>Confirmar nova senha</label><input type="password" id="fp-pass2" inputmode="numeric"></div>' +
      '<div class="login-error" id="fp-error2"></div>';
    var foot =
      '<button class="btn btn-secondary" data-close-modal>Cancelar</button>' +
      '<button class="btn btn-primary" id="fp-confirm-btn">Redefinir senha</button>';
    var box = Modal.open({ title: "Confirmar código", bodyHtml: body, footHtml: foot });
    var codeInput = box.querySelector("#fp-code");
    var pass1 = box.querySelector("#fp-pass1");
    var pass2 = box.querySelector("#fp-pass2");
    var errEl = box.querySelector("#fp-error2");
    var confirmBtn = box.querySelector("#fp-confirm-btn");

    codeInput.addEventListener("input", function (e) { e.target.value = Utils.onlyDigits(e.target.value).slice(0, 4); });
    pass1.addEventListener("input", function (e) { e.target.value = Utils.onlyDigits(e.target.value).slice(0, 20); });
    pass2.addEventListener("input", function (e) { e.target.value = Utils.onlyDigits(e.target.value).slice(0, 20); });

    confirmBtn.addEventListener("click", function () {
      errEl.classList.remove("show");
      if (!codeInput.value || !pass1.value) { errEl.textContent = "Preencha o código e a nova senha."; errEl.classList.add("show"); return; }
      if (pass1.value !== pass2.value) { errEl.textContent = "As senhas não coincidem."; errEl.classList.add("show"); return; }
      confirmBtn.disabled = true;
      ResetSenha.verifyAndReset(userId, codeInput.value, pass1.value).then(function () {
        Modal.close();
        Toast.show("Senha redefinida com sucesso. Faça login com a nova senha.", "success");
      }).catch(function (err) {
        confirmBtn.disabled = false;
        errEl.textContent = (err && err.message) || "Não foi possível redefinir a senha.";
        errEl.classList.add("show");
      });
    });
  }

  function goToRedirect() {
    var params = new URLSearchParams(location.search);
    var redirect = params.get("redirect");
    var safe = redirect && /^[a-z0-9_-]+\.html$/i.test(redirect) ? redirect : "index.html";
    location.href = safe;
  }
})();
