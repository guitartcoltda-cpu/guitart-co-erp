(function () {
  "use strict";

  // 03/10/2026 — CORREÇÃO (relato recorrente, só no celular: "toco em
  // Entrar, a página meio que recarrega sem reconhecer o login, e tenho que
  // ficar tentando até entrar"). Causa raiz: antes, o handler do formulário
  // só era ligado DEPOIS de DB.ready — e DB.ready, na tela de login, espera
  // a busca completa das 21 tabelas do sistema (milhares de linhas). No
  // celular, em rede lenta, isso leva vários segundos; nesse intervalo o
  // botão "Entrar" existia, mas sem handler nenhum, então o navegador fazia
  // o envio nativo do <form> — que simplesmente recarrega a página (limpando
  // CPF/senha). A pessoa tentava de novo e de novo até a busca terminar.
  // Agora: (1) o handler é ligado na hora, antes de qualquer rede; (2) a
  // conferência de CPF/senha usa uma consulta leve só ao usuário
  // (DB.lookupUserByCpf), sem esperar as 21 tabelas; (3) "Manter conectado
  // neste aparelho" guarda a sessão (não a senha) para não precisar logar
  // de novo toda vez que o celular descarta a aba.
  document.addEventListener("DOMContentLoaded", init);

  var dbReadyFlag = false;
  function whenDbReady(maxMs) {
    var ready = DB.ready.then(function () { dbReadyFlag = true; return true; });
    if (!maxMs) return ready;
    return Promise.race([ready, new Promise(function (resolve) { setTimeout(function () { resolve(dbReadyFlag); }, maxMs); })]);
  }
  DB.ready.then(function () { dbReadyFlag = true; });

  function init() {
    // já logado (sessão da aba ou "Manter conectado")? pula direto — a
    // página de destino revalida a conta (auth.js), não precisa esperar aqui
    if (CurrentUser.get()) { goToRedirect(); return; }

    var form = document.getElementById("login-form");
    var cpfInput = document.getElementById("li-cpf");
    var passInput = document.getElementById("li-pass");
    var rememberInput = document.getElementById("li-remember");
    var errEl = document.getElementById("li-error");
    var submitBtn = document.getElementById("li-submit");
    var busy = false;

    // "Manter conectado": a marcação fica lembrada (uma vez marcada,
    // continua marcada nas próximas vezes até a pessoa desmarcar) e o CPF
    // também é pré-preenchido.
    rememberInput.checked = CurrentUser.getRemember();
    var savedCpf = CurrentUser.getRememberedCpf();
    if (rememberInput.checked && savedCpf) {
      cpfInput.value = savedCpf.length === 11 ? Utils.fmtCPF(savedCpf) : savedCpf;
      passInput.focus();
    }

    cpfInput.addEventListener("input", function (e) {
      var digits = Utils.onlyDigits(e.target.value).slice(0, 11);
      e.target.value = digits.length === 11 ? Utils.fmtCPF(digits) : digits;
    });
    passInput.addEventListener("input", function (e) {
      e.target.value = Utils.onlyDigits(e.target.value).slice(0, 20);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      errEl.classList.remove("show");

      var cpf = Utils.onlyDigits(cpfInput.value);
      var pass = passInput.value;
      if (!cpf || !pass) { showError("Informe CPF e senha."); return; }

      setBusy(true);
      findUser(cpf).then(function (found) {
        if (found.error) { setBusy(false); showError(found.error); return; }
        var user = found.user;
        return Utils.verifyPassword(pass, user.password).then(function (ok) {
          if (!ok) { setBusy(false); showError("Senha incorreta."); return; }
          return finishLogin(user, pass, cpf);
        });
      }).catch(function () {
        setBusy(false);
        showError("Não foi possível entrar agora. Verifique a internet e tente novamente.");
      });
    });

    // Procura o usuário pelo CPF: primeiro no servidor (consulta leve);
    // se o servidor não responder ou não achar, cai para a cópia local
    // (esperando a busca completa terminar, como era antes).
    function findUser(cpf) {
      return DB.lookupUserByCpf(cpf).then(function (r) {
        if (r.status === "ok") return { user: r.user };
        if (r.status === "inactive") return { error: "Este acesso está inativo. Fale com um administrador." };
        return DB.ready.then(function () {
          var local = DB.findOne("users", function (u) { return u.cpf === cpf; });
          if (local) return local.active ? { user: local } : { error: "Este acesso está inativo. Fale com um administrador." };
          return { error: r.status === "unknown" ? "Sem conexão com o servidor. Verifique a internet e tente novamente." : "CPF não encontrado." };
        });
      });
    }

    function finishLogin(user, pass, cpf) {
      var remember = !!rememberInput.checked;
      CurrentUser.setRemember(remember, cpf);
      CurrentUser.set({ id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role }, { persist: remember });
      // Migração silenciosa de senha (texto puro → hash) e registro no log
      // de acesso precisam do cache completo do DB; espera um pouco por ele
      // (até 4s) mas não segura o login se a rede estiver lenta — nesse
      // caso a migração acontece no próximo login e o registro de acesso
      // desta vez é pulado, o que é preferível a deixar a pessoa esperando.
      return whenDbReady(4000).then(function (ready) {
        if (!ready) return;
        var migrate;
        try {
          migrate = Utils.isHashedPassword(user.password) ? Promise.resolve() :
            Utils.hashPassword(pass).then(function (hashed) { return DB.update("users", user.id, { password: hashed }); });
        } catch (e) { migrate = Promise.resolve(); }
        return migrate.catch(function () { /* falha na migração silenciosa não deve bloquear o login */ }).then(function () {
          DB.log("Acesso", user.firstName + " " + user.lastName + " entrou no sistema");
        });
      }).catch(function () {}).then(function () { goToRedirect(); });
    }

    function setBusy(on) {
      busy = on;
      if (submitBtn) { submitBtn.disabled = on; submitBtn.textContent = on ? "Entrando..." : "Entrar"; }
    }

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
      DB.ready.then(function () { return ResetSenha.requestReset(cpfInput.value); }).then(function (r) {
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
