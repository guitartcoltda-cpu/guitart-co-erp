/* ============================================================
   Salão ERP — Redefinição de senha por código (e-mail)
   Lógica central compartilhada entre a tela de Login ("Esqueci minha
   senha", self-service) e Configurações → Acessos (botão do admin
   "Redefinir senha"). Cada tela mantém sua própria UI (esse projeto não
   usa módulos/import — cada página é um script independente); este
   arquivo só concentra a regra de negócio (gerar código, validar,
   mandar e-mail) pra não duplicar isso nos dois lugares.

   Envio de e-mail via EmailJS (https://www.emailjs.com/) — funciona
   inteiramente pelo navegador, sem precisar de um servidor novo: o
   administrador cria uma conta gratuita, conecta a caixa de e-mail do
   salão (Gmail/Outlook) como "Service", cria um "Template" e cola o
   Service ID / Template ID / Public Key em Configurações → Integrações
   (ver configuracoes.js). Enquanto isso não estiver configurado, o
   envio falha com uma mensagem explicando o que falta — não há
   nenhum modo de simular o envio, só o real.
   ============================================================ */
(function (global) {
  "use strict";

  var CODE_TTL_MIN = 10;
  var MAX_ATTEMPTS = 5;

  function getEmailConfig() {
    return (DB.getSettings() || {}).emailConfig || null;
  }
  function isEmailConfigured() {
    var cfg = getEmailConfig();
    return !!(cfg && cfg.serviceId && cfg.templateId && cfg.publicKey);
  }

  // "joao.pujol@gmail.com" -> "joa***@gmail.com" — só pra exibir na tela
  // sem revelar o e-mail completo de quem está tentando entrar.
  function maskEmail(email) {
    var m = /^(.{1,3}).*(@.+)$/.exec(email || "");
    if (!m) return email || "";
    return m[1] + "***" + m[2];
  }

  // O cadastro de Acesso (tela Configurações → Acessos) não tem e-mail
  // próprio — usa o e-mail cadastrado no Funcionário vinculado a esse
  // acesso (Funcionários → E-mail). Sem vínculo ou sem e-mail lá, não há
  // como enviar o código.
  function emailForUser(user) {
    if (!user || !user.employeeId) return null;
    var emp = DB.get("employees", user.employeeId);
    return (emp && emp.email && emp.email.trim()) ? emp.email.trim() : null;
  }

  function generateCode() {
    return String(Math.floor(1000 + Math.random() * 9000)); // 4 dígitos, 1000-9999
  }

  // Gera um código novo, grava no acesso (validade de CODE_TTL_MIN
  // minutos, tentativas zeradas) e dispara o e-mail via EmailJS. Usada
  // tanto pelo "Esqueci minha senha" (login) quanto pelo botão do admin
  // em Configurações → Acessos.
  function sendCodeToUser(user, email) {
    return new Promise(function (resolve, reject) {
      if (typeof emailjs === "undefined") {
        reject({ code: "sdk_missing", message: "Não foi possível carregar o serviço de e-mail (verifique sua internet) e tente novamente." });
        return;
      }
      if (!isEmailConfigured()) {
        reject({ code: "not_configured", message: "O envio de e-mail ainda não foi configurado. Peça para um administrador configurar em Configurações → Integrações." });
        return;
      }
      var cfg = getEmailConfig();
      var code = generateCode();
      var expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString();
      DB.update("users", user.id, { resetCode: code, resetCodeExpiresAt: expiresAt, resetCodeAttempts: 0 });
      var params = {
        to_email: email,
        to_name: user.firstName || "",
        code: code,
        company_name: (DB.getSettings() || {}).companyName || "Guitart & Co."
      };
      emailjs.send(cfg.serviceId, cfg.templateId, params, cfg.publicKey).then(function () {
        resolve({ maskedEmail: maskEmail(email) });
      }).catch(function (err) {
        reject({ code: "send_failed", message: "Não foi possível enviar o e-mail. Confira a configuração em Configurações → Integrações.", detail: err });
      });
    });
  }

  // Fluxo self-service (tela de login, "Esqueci minha senha"): recebe o
  // CPF digitado, localiza o acesso e dispara o código pro e-mail do
  // funcionário vinculado.
  function requestReset(cpf) {
    return new Promise(function (resolve, reject) {
      var digits = Utils.onlyDigits(cpf || "");
      if (digits.length !== 11) { reject({ code: "invalid_cpf", message: "Informe um CPF válido." }); return; }
      var user = DB.findOne("users", function (u) { return u.cpf === digits; });
      if (!user) { reject({ code: "not_found", message: "CPF não encontrado." }); return; }
      if (!user.active) { reject({ code: "inactive", message: "Este acesso está inativo. Fale com um administrador." }); return; }
      var email = emailForUser(user);
      if (!email) {
        reject({ code: "no_email", message: "Não há e-mail cadastrado para este acesso. Peça para um administrador redefinir sua senha em Configurações → Acessos." });
        return;
      }
      sendCodeToUser(user, email).then(function (r) {
        resolve({ userId: user.id, maskedEmail: r.maskedEmail });
      }).catch(reject);
    });
  }

  // Confere o código digitado e, se bater (e ainda estiver dentro da
  // validade e do limite de tentativas), já grava a nova senha.
  function verifyAndReset(userId, code, newPassword) {
    return new Promise(function (resolve, reject) {
      var user = DB.get("users", userId);
      if (!user) { reject({ code: "not_found", message: "Acesso não encontrado." }); return; }
      if (!user.resetCode) { reject({ code: "no_pending", message: "Nenhuma redefinição pendente. Solicite um novo código." }); return; }
      if (!user.resetCodeExpiresAt || new Date(user.resetCodeExpiresAt).getTime() < Date.now()) {
        DB.update("users", userId, { resetCode: null, resetCodeExpiresAt: null, resetCodeAttempts: 0 });
        reject({ code: "expired", message: "O código expirou. Solicite um novo." });
        return;
      }
      var attempts = user.resetCodeAttempts || 0;
      if (attempts >= MAX_ATTEMPTS) {
        DB.update("users", userId, { resetCode: null, resetCodeExpiresAt: null, resetCodeAttempts: 0 });
        reject({ code: "too_many", message: "Muitas tentativas incorretas. Solicite um novo código." });
        return;
      }
      if (String(code || "").trim() !== String(user.resetCode)) {
        var left = MAX_ATTEMPTS - (attempts + 1);
        DB.update("users", userId, { resetCodeAttempts: attempts + 1 });
        reject({
          code: "wrong_code",
          message: left > 0 ? "Código incorreto. Tentativas restantes: " + left + "." : "Código incorreto. Limite de tentativas atingido — solicite um novo código."
        });
        return;
      }
      if (!newPassword || newPassword.length < 4) { reject({ code: "weak_password", message: "A nova senha precisa ter pelo menos 4 dígitos." }); return; }
      DB.update("users", userId, { password: newPassword, resetCode: null, resetCodeExpiresAt: null, resetCodeAttempts: 0 });
      DB.log("Acesso", (user.firstName + " " + user.lastName) + " redefiniu a própria senha (código enviado por e-mail)", { userName: user.firstName + " " + user.lastName });
      resolve(true);
    });
  }

  global.ResetSenha = {
    CODE_TTL_MIN: CODE_TTL_MIN,
    isEmailConfigured: isEmailConfigured,
    getEmailConfig: getEmailConfig,
    maskEmail: maskEmail,
    emailForUser: emailForUser,
    sendCodeToUser: sendCodeToUser,
    requestReset: requestReset,
    verifyAndReset: verifyAndReset
  };
})(window);
