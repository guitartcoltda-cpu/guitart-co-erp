(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  // Separa "Nome Completo" em primeiro nome + sobrenome, pro cadastro de
  // Acesso (que guarda os dois campos separados). Mesma lógica usada em
  // assets/js/funcionarios.js (repetida aqui porque cada tela deste sistema
  // é um arquivo independente, sem módulos/import).
  function splitName(fullName) {
    var parts = fullName.trim().split(/\s+/);
    return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(" ") : parts[0] };
  }

  function init() {
    Utils.qsa(".tab-btn", document.getElementById("cfg-tabs")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        Utils.qsa(".tab-btn", document.getElementById("cfg-tabs")).forEach(function (b) { b.classList.remove("active"); });
        Utils.qsa(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        document.getElementById(btn.getAttribute("data-panel")).classList.add("active");
      });
    });

    Utils.qs("#btn-new-cc").addEventListener("click", function () { openCcModal(null); });
    Utils.qs("#btn-new-cat").addEventListener("click", function () { openCatModal(null); });
    Utils.qs("#btn-new-srv").addEventListener("click", function () { openSrvModal(null); });
    Utils.qs("#btn-new-role").addEventListener("click", function () { openRoleModal(null); });
    Utils.qs("#btn-new-group").addEventListener("click", function () { openGroupModal(null); });

    Utils.qs("#cfg-company").value = (DB.getSettings() || {}).companyName || "";
    Utils.qs("#btn-save-company").addEventListener("click", function () {
      var name = Utils.qs("#cfg-company").value.trim();
      DB.updateSettings({ companyName: name });
      DB.log("Configurações", "Atualizou o nome da empresa para \"" + name + "\"");
      Toast.show("Nome da empresa atualizado", "success");
    });

    Utils.qs("#btn-export-json").addEventListener("click", function () {
      var btn = Utils.qs("#btn-export-json");
      btn.disabled = true;
      Toast.show("Gerando backup...", "info");
      DB.exportJSON().then(function (json) {
        Utils.downloadFile("backup_salao_" + Utils.todayISO() + ".json", json, "application/json");
        DB.log("Backup", "Exportou um backup completo dos dados (JSON)");
        Toast.show("Backup exportado", "success");
      }).catch(function () {
        Toast.show("Falha ao gerar o backup — verifique sua internet e tente de novo", "danger");
      }).finally(function () {
        btn.disabled = false;
      });
    });
    Utils.qs("#btn-import-json").addEventListener("click", function () { Utils.qs("#file-import-json").click(); });
    Utils.qs("#file-import-json").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        Modal.confirm({
          title: "Importar backup",
          message: "Isso substituirá todos os dados atuais DE TODO O SISTEMA (de todos os usuários e aparelhos) pelos dados do arquivo importado. Deseja continuar?",
          danger: true,
          onConfirm: function () {
            try {
              DB.importJSON(ev.target.result);
              DB.log("Backup", "Importou um backup e substituiu os dados do sistema (arquivo: " + file.name + ")");
              Toast.show("Backup importado com sucesso. Recarregando...", "success");
              setTimeout(function () { location.reload(); }, 900);
            } catch (err) {
              Toast.show("Arquivo inválido", "danger");
            }
          }
        });
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    Utils.qs("#btn-new-user").addEventListener("click", function () { openUserModal(null); });

    (function () {
      var cfg = (DB.getSettings() || {}).emailConfig || {};
      Utils.qs("#cfg-emailjs-service").value = cfg.serviceId || "";
      Utils.qs("#cfg-emailjs-template").value = cfg.templateId || "";
      Utils.qs("#cfg-emailjs-publickey").value = cfg.publicKey || "";
      renderEmailConfigStatus();
    })();
    Utils.qs("#btn-save-emailjs").addEventListener("click", function () {
      var serviceId = Utils.qs("#cfg-emailjs-service").value.trim();
      var templateId = Utils.qs("#cfg-emailjs-template").value.trim();
      var publicKey = Utils.qs("#cfg-emailjs-publickey").value.trim();
      DB.updateSettings({ emailConfig: { serviceId: serviceId, templateId: templateId, publicKey: publicKey } });
      DB.log("Configurações", "Atualizou a configuração de envio de e-mail (EmailJS)");
      Toast.show("Configuração de e-mail salva", "success");
      renderEmailConfigStatus();
    });

    Utils.qs("#log-search").addEventListener("input", Utils.debounce(function () { renderLog(); }, 250));
    Utils.qs("#log-start").addEventListener("change", function () { renderLog(); });
    Utils.qs("#log-end").addEventListener("change", function () { renderLog(); });
    Utils.qs("#btn-log-clear-filters").addEventListener("click", function () {
      Utils.qs("#log-search").value = ""; Utils.qs("#log-start").value = ""; Utils.qs("#log-end").value = "";
      renderLog();
    });

    Utils.qs("#perm-user-select").addEventListener("change", function (e) {
      if (e.target.value) renderPermsForUser(e.target.value);
      else Utils.qs("#perm-card").style.display = "none";
    });

    renderCC(); renderCat(); renderSrv(); renderRoles(); renderGroups(); renderUsers(); renderLog(); renderPerms(); renderApprovals();

    // Deep-link vindo do sininho de aprovações no topbar (?tab=aprovacoes).
    if (/tab=aprovacoes/.test(location.search)) {
      var approvalsTabBtn = Utils.qs('[data-panel="p-approvals"]');
      if (approvalsTabBtn) approvalsTabBtn.click();
    }
  }

  // ---------------- Integrações (envio de e-mail) ----------------
  function renderEmailConfigStatus() {
    var el = Utils.qs("#cfg-emailjs-status");
    if (!el) return;
    if (ResetSenha.isEmailConfigured()) {
      el.innerHTML = '<span style="color: var(--color-success, #16a34a);">✓ Configurado — o envio de código por e-mail está ativo.</span>';
    } else {
      el.innerHTML = '<span class="text-muted">Envio de e-mail ainda não configurado — "Esqueci minha senha" e o botão de redefinir senha em Acessos não vão funcionar até isso ser preenchido.</span>';
    }
  }

  // ---------------- Acessos (users) ----------------
  var ROLE_OPTIONS = ["Administrador", "Gerente", "Financeiro", "Recepcionista", "Profissional", "Desenvolvedor"];

  function renderUsers() {
    var list = DB.all("users").slice().sort(function (a, b) { return (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName); });
    var tbl = Utils.qs("#tbl-users");
    if (!list.length) {
      Utils.emptyTable(tbl, "fa-user", "Nenhum acesso cadastrado");
      return;
    }
    tbl.innerHTML = '<thead><tr><th>Nome</th><th>CPF</th><th>Perfil</th><th>Funcionário vinculado</th><th>Status</th><th>Criado em</th><th></th></tr></thead><tbody>' +
      list.map(function (u) {
        var emp = u.employeeId ? DB.get("employees", u.employeeId) : null;
        return '<tr>' +
          '<td><div class="flex items-center gap-8"><div class="avatar">' + Utils.initials(u.firstName + " " + u.lastName) + '</div>' + Utils.escapeHtml(u.firstName + " " + u.lastName) + '</div></td>' +
          '<td class="text-num">' + Utils.fmtCPF(u.cpf) + '</td>' +
          '<td>' + Utils.escapeHtml(u.role) + '</td>' +
          '<td>' + (emp ? Utils.escapeHtml(emp.name) : '<span class="text-muted">—</span>') + '</td>' +
          '<td>' + (u.active ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>') + '</td>' +
          '<td class="small text-muted">' + Utils.fmtDate(u.createdAt) + '</td>' +
          '<td><div class="flex gap-6">' +
            '<button class="btn btn-icon btn-ghost" data-edit-user="' + u.id + '" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-perm-user="' + u.id + '" title="Gerenciar permissões de telas"><i class="fa-solid fa-shield-halved"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-reset-user="' + u.id + '" title="Redefinir senha (envia código por e-mail)"><i class="fa-solid fa-key"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-toggle-user="' + u.id + '" title="' + (u.active ? "Desativar" : "Ativar") + '"><i class="fa-solid ' + (u.active ? "fa-user-slash" : "fa-user-check") + '"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-del-user="' + u.id + '" title="Excluir"><i class="fa-solid fa-trash"></i></button>' +
          '</div></td>' +
          '</tr>';
      }).join("") + '</tbody>';

    Utils.qsa("[data-edit-user]", tbl).forEach(function (b) { b.addEventListener("click", function () { openUserModal(b.getAttribute("data-edit-user")); }); });
    Utils.qsa("[data-reset-user]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-reset-user");
        var u = DB.get("users", id);
        if (!u) return;
        var email = ResetSenha.emailForUser(u);
        if (!email) {
          Toast.show("Este acesso não tem e-mail cadastrado. Vincule-o a um funcionário com e-mail em Funcionários, ou cadastre o e-mail do funcionário já vinculado.", "danger", 5000);
          return;
        }
        Modal.confirm({
          title: "Redefinir senha",
          message: 'Vamos enviar um código de 4 dígitos para ' + ResetSenha.maskEmail(email) + '. ' + u.firstName + ' deve usar "Esqueci minha senha" na tela de login para concluir a redefinição com esse código. Deseja continuar?',
          confirmLabel: "Enviar código",
          onConfirm: function () {
            ResetSenha.sendCodeToUser(u, email).then(function () {
              DB.log("Acesso", "Enviou um código de redefinição de senha para " + u.firstName + " " + u.lastName);
              Toast.show("Código enviado para " + ResetSenha.maskEmail(email), "success");
            }).catch(function (err) {
              Toast.show((err && err.message) || "Não foi possível enviar o e-mail.", "danger", 5000);
            });
          }
        });
      });
    });
    Utils.qsa("[data-perm-user]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-perm-user");
        Utils.qs('[data-panel="p-perms"]').click();
        var sel = Utils.qs("#perm-user-select");
        sel.value = id;
        renderPermsForUser(id);
      });
    });
    Utils.qsa("[data-toggle-user]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-toggle-user");
        var u = DB.get("users", id);
        if (!u) return;
        DB.update("users", id, { active: !u.active });
        DB.log("Acesso", (u.active ? "Desativou" : "Ativou") + " o acesso de " + u.firstName + " " + u.lastName);
        Toast.show("Status do acesso atualizado", "success");
        renderUsers(); renderLog(); renderPerms();
      });
    });
    Utils.qsa("[data-del-user]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del-user");
        var u = DB.get("users", id);
        var emp = u && u.employeeId ? DB.get("employees", u.employeeId) : null;
        Modal.confirm({
          title: "Excluir acesso",
          message: "Confirma a exclusão deste acesso?" + (emp ? " O funcionário " + emp.name + " deixará de conseguir fazer login (o cadastro dele em Funcionários não é afetado)." : "") + " Essa ação não pode ser desfeita.",
          danger: true,
          onConfirm: function () {
            DB.remove("users", id);
            if (u) DB.log("Acesso", "Excluiu o acesso de " + u.firstName + " " + u.lastName);
            Toast.show("Acesso excluído", "success");
            renderUsers(); renderLog(); renderPerms();
          }
        });
      });
    });
  }

  // Funcionários que podem ser escolhidos no campo "Funcionário vinculado"
  // deste modal: qualquer um que ainda não esteja vinculado a OUTRO acesso
  // (o próprio funcionário já vinculado a "u", se for o caso, continua
  // aparecendo — é isso que faz a seleção atual dele mostrar corretamente).
  function employeesAvailableForLink(currentUserId) {
    var linkedElsewhere = {};
    DB.all("users").forEach(function (x) { if (x.employeeId && x.id !== currentUserId) linkedElsewhere[x.employeeId] = true; });
    return DB.all("employees").filter(function (e) { return !linkedElsewhere[e.id]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function openUserModal(id) {
    var u = id ? DB.get("users", id) : null;
    var emp = u && u.employeeId ? DB.get("employees", u.employeeId) : null;
    var linkOptions = employeesAvailableForLink(u ? u.id : null);
    var body = (emp ? '<div class="small text-muted mb-16"><i class="fa-solid fa-circle-info"></i> Este acesso está vinculado ao funcionário <strong>' + Utils.escapeHtml(emp.name) + '</strong>. Nome, CPF e telefone normalmente são editados por lá (Funcionários → editar), mas também podem ser ajustados aqui se precisar.</div>' : '') +
      '<div class="form-grid">' +
      '<div class="form-field full"><label>Funcionário vinculado (opcional)</label><select id="usr-employee"><option value="">Nenhum</option>' +
        linkOptions.map(function (e) { return '<option value="' + e.id + '"' + (u && u.employeeId === e.id ? " selected" : "") + '>' + Utils.escapeHtml(e.name) + '</option>'; }).join("") +
      '</select><div class="hint">Vincular preenche automaticamente CPF/nome/telefone (só nos campos que ainda estiverem vazios) e passa a mostrar esta pessoa como "vinculada" na lista de Acessos.</div></div>' +
      '<div class="form-field full" id="usr-create-emp-wrap"><label class="flex items-center gap-8"><input type="checkbox" id="usr-create-emp"' + (emp ? " checked disabled" : "") + '> Criar acesso de Funcionário automaticamente</label>' +
        '<div class="hint" id="usr-create-emp-hint">' + (emp ? "Este acesso já está vinculado ao funcionário " + Utils.escapeHtml(emp.name) + " — nada a fazer aqui." : "Se marcado, ao salvar será cadastrado automaticamente um novo Funcionário (na tela Funcionários) já vinculado a este acesso, usando nome/telefone/CPF preenchidos acima.") + '</div></div>' +
      '<div class="form-field"><label>CPF</label><input type="text" id="usr-cpf" maxlength="14" placeholder="000.000.000-00" value="' + (u ? Utils.fmtCPF(u.cpf) : "") + '"></div>' +
      '<div class="form-field"><label>Perfil</label><select id="usr-role">' + ROLE_OPTIONS.map(function (r) { return '<option value="' + r + '"' + (u && u.role === r ? " selected" : "") + '>' + r + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-field"><label>Nome</label><input type="text" id="usr-first" value="' + (u ? Utils.escapeHtml(u.firstName) : "") + '"></div>' +
      '<div class="form-field"><label>Sobrenome</label><input type="text" id="usr-last" value="' + (u ? Utils.escapeHtml(u.lastName) : "") + '"></div>' +
      '<div class="form-field"><label>Telefone (WhatsApp, opcional)</label><input type="tel" id="usr-phone" placeholder="(11) 99999-0000" value="' + (u ? Utils.escapeHtml(u.phone || "") : "") + '"></div>' +
      '<div class="form-field"><label>Senha ' + (u ? "(deixe em branco para manter)" : "") + '</label><input type="password" id="usr-pass" inputmode="numeric" placeholder="mín. 6 dígitos, só números" autocomplete="new-password"></div>' +
      '<div class="form-field"><label>Status</label><select id="usr-active"><option value="1"' + (!u || u.active ? " selected" : "") + '>Ativo</option><option value="0"' + (u && !u.active ? " selected" : "") + '>Inativo</option></select></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="usr-save">Salvar</button>';
    var box = Modal.open({ title: u ? "Editar Acesso" : "Novo Acesso", wide: true, bodyHtml: body, footHtml: foot });

    box.querySelector("#usr-cpf").addEventListener("input", function (e) {
      var digits = Utils.onlyDigits(e.target.value).slice(0, 11);
      e.target.value = digits.length === 11 ? Utils.fmtCPF(digits) : digits;
    });
    Utils.wirePhoneMask(box.querySelector("#usr-phone"));
    box.querySelector("#usr-pass").addEventListener("input", function (e) {
      e.target.value = Utils.onlyDigits(e.target.value).slice(0, 20);
    });
    var createEmpCb = box.querySelector("#usr-create-emp");
    var createEmpHint = box.querySelector("#usr-create-emp-hint");
    box.querySelector("#usr-employee").addEventListener("change", function (ev) {
      var linkedEmp = ev.target.value ? DB.get("employees", ev.target.value) : null;
      // Escolheu um Funcionário já existente na lista -> já fica vinculado
      // ao salvar, então o "criar automaticamente" não se aplica mais aqui;
      // mostra travado e marcado, só pra deixar claro que já tem funcionário.
      // Voltou pra "Nenhum" -> libera o checkbox de novo pra decidir.
      if (linkedEmp) {
        createEmpCb.checked = true;
        createEmpCb.disabled = true;
        createEmpHint.textContent = "Este acesso já está vinculado ao funcionário " + linkedEmp.name + " — nada a fazer aqui.";
      } else {
        createEmpCb.checked = false;
        createEmpCb.disabled = false;
        createEmpHint.textContent = "Se marcado, ao salvar será cadastrado automaticamente um novo Funcionário (na tela Funcionários) já vinculado a este acesso, usando nome/telefone/CPF preenchidos acima.";
      }
      if (!linkedEmp) return;
      var cpfField = box.querySelector("#usr-cpf");
      if (!Utils.onlyDigits(cpfField.value) && linkedEmp.cpf) cpfField.value = Utils.fmtCPF(linkedEmp.cpf);
      var firstField = box.querySelector("#usr-first"), lastField = box.querySelector("#usr-last");
      if (!firstField.value.trim() && !lastField.value.trim()) {
        var np = splitName(linkedEmp.name);
        firstField.value = np.first; lastField.value = np.last;
      }
      var phoneField = box.querySelector("#usr-phone");
      if (!phoneField.value.trim() && linkedEmp.phone) phoneField.value = linkedEmp.phone;
    });

    box.querySelector("#usr-save").addEventListener("click", function () {
      var cpf = Utils.onlyDigits(box.querySelector("#usr-cpf").value);
      var first = box.querySelector("#usr-first").value.trim();
      var last = box.querySelector("#usr-last").value.trim();
      var pass = box.querySelector("#usr-pass").value;
      var role = box.querySelector("#usr-role").value;
      var active = box.querySelector("#usr-active").value === "1";
      var phone = box.querySelector("#usr-phone").value.trim();
      var employeeId = box.querySelector("#usr-employee").value || null;
      // Só entra em jogo quando não há Funcionário já escolhido no dropdown
      // acima (nesse caso o checkbox fica travado/marcado só como indicação
      // visual de "já vinculado", sem precisar criar nada de novo).
      var autoCreateEmployee = !!(createEmpCb && !createEmpCb.disabled && createEmpCb.checked && !employeeId);
      if (phone && !Utils.isValidPhoneBR(phone)) { Toast.show("Telefone inválido — informe com DDD (ex.: (11) 98765-4321)", "danger"); return; }

      if (!Utils.isValidCPF(cpf)) { Toast.show("Informe um CPF válido", "danger"); return; }
      if (!first) { Toast.show("Informe o nome", "danger"); return; }
      if (!last) { Toast.show("Informe o sobrenome", "danger"); return; }
      if (autoCreateEmployee && !phone) { Toast.show("Para criar o funcionário automaticamente, informe o telefone (com DDD)", "danger"); return; }
      var dupCpf = DB.findOne("users", function (x) { return x.cpf === cpf && (!u || x.id !== u.id); });
      if (dupCpf) { Toast.show("Já existe um acesso cadastrado com este CPF", "danger"); return; }
      if (!u && !pass) { Toast.show("Informe a senha", "danger"); return; }
      if (pass && !Utils.isValidPassword(pass)) { Toast.show("A senha deve ter no mínimo 6 dígitos, apenas números", "danger"); return; }

      // Cria o Funcionário antes de gravar o Acesso, para já poder salvar o
      // employeeId vinculado num único passo (mesmo padrão de cargo/serviço
      // usado em funcionarios.js -> openEmpModal).
      if (autoCreateEmployee) {
        var roles = DB.getRoles();
        var defaultRoleName = roles.length ? roles[0].name : "Cabeleireiro(a)";
        var newEmp = DB.insert("employees", {
          name: (first + " " + last).trim(),
          role: defaultRoleName,
          status: active ? "ativo" : "inativo",
          phone: phone,
          email: "",
          cpf: cpf,
          hireDate: Utils.todayISO(),
          birthday: null,
          baseSalary: 0,
          commissionRate: 0,
          performsServices: role === "Profissional",
          requiresTimeClock: false,
          photoDataUrl: null
        });
        employeeId = newEmp.id;
      }

      var patch = { cpf: cpf, firstName: first, lastName: last, role: role, active: active, phone: phone, employeeId: employeeId };
      var saveBtn = box.querySelector("#usr-save");
      saveBtn.disabled = true;

      (pass ? Utils.hashPassword(pass) : Promise.resolve(null)).then(function (hashedPass) {
        if (hashedPass) patch.password = hashedPass;

        if (u) {
          DB.update("users", u.id, patch);
          DB.log("Acesso", "Atualizou o acesso de " + first + " " + last + (autoCreateEmployee ? " e criou o funcionário vinculado automaticamente" : ""));
          Toast.show(autoCreateEmployee ? "Acesso atualizado e funcionário criado" : "Acesso atualizado", "success");
        } else {
          patch.password = hashedPass;
          DB.insert("users", patch);
          DB.log("Acesso", "Criou o acesso de " + first + " " + last + " (" + role + ")" + (autoCreateEmployee ? " e o funcionário vinculado automaticamente" : ""));
          Toast.show(autoCreateEmployee ? "Acesso e funcionário criados" : "Acesso criado", "success");
        }
        Modal.close();
        renderUsers(); renderLog(); renderPerms();
      }).catch(function () {
        saveBtn.disabled = false;
        Toast.show("Não foi possível salvar a senha. Tente novamente.", "danger");
      });
    });
  }

  // ---------------- Permissões (per-user page access) ----------------
  // allowedPages on a user record: array of NAV page filenames the user may
  // open, or missing/null = full access (see assets/js/auth.js). The list
  // of screens shown here comes straight from AppLayout.NAV (assets/js/layout.js),
  // so it stays in sync automatically as pages are added/removed there.
  function permPageItems() {
    return (window.AppLayout ? window.AppLayout.NAV : []).filter(function (item) { return !item.section; });
  }

  function renderPerms() {
    var select = Utils.qs("#perm-user-select");
    var prevSelected = select.value;
    var users = DB.all("users").slice().sort(function (a, b) { return (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName); });
    if (!users.length) {
      select.innerHTML = '<option value="">Nenhum acesso cadastrado</option>';
      Utils.qs("#perm-card").style.display = "none";
      return;
    }
    select.innerHTML = '<option value="">Selecione...</option>' + users.map(function (u) {
      return '<option value="' + u.id + '">' + Utils.escapeHtml(u.firstName + " " + u.lastName) + (u.active ? "" : " (inativo)") + '</option>';
    }).join("");
    if (prevSelected && users.some(function (u) { return u.id === prevSelected; })) {
      select.value = prevSelected;
      renderPermsForUser(prevSelected);
    } else {
      Utils.qs("#perm-card").style.display = "none";
    }
  }

  function renderPermsForUser(userId) {
    var u = DB.get("users", userId);
    if (!u) { Utils.qs("#perm-card").style.display = "none"; return; }

    Utils.qs("#perm-card").style.display = "";
    Utils.qs("#perm-user-name").textContent = u.firstName + " " + u.lastName + " (" + u.role + ")";

    var items = permPageItems();
    var groups = getAccessGroups();
    var isAdminUser = u.role === "Administrador";
    var fullCb = Utils.qs("#perm-full-access");
    var approveCb = Utils.qs("#perm-can-approve");
    var groupSelect = Utils.qs("#perm-group-select");
    var groupHint = Utils.qs("#perm-group-hint");

    groupSelect.innerHTML = '<option value="">Personalizado (sem grupo)</option>' + groups.map(function (g) {
      return '<option value="' + g.id + '">' + Utils.escapeHtml(g.name) + '</option>';
    }).join("");
    groupSelect.value = (u.groupId && groups.some(function (g) { return g.id === u.groupId; })) ? u.groupId : "";

    // Mostra o estado atual dos controles. fromGroup=true desabilita tudo
    // (as permissões vêm do grupo, não dá pra editar aqui — só trocando
    // pra "Personalizado" ou editando o grupo na aba Grupos de Acesso).
    function applyState(fullAccess, allowedPages, canApproveVal, fromGroup) {
      fullCb.checked = fullAccess;
      fullCb.disabled = fromGroup;
      if (approveCb) {
        approveCb.checked = isAdminUser || !!canApproveVal;
        approveCb.disabled = isAdminUser || fromGroup;
        approveCb.title = isAdminUser ? "Administradores já podem aprovar solicitações por padrão" : "";
      }
      Utils.qs("#perm-checklist").innerHTML = items.map(function (it) {
        var checked = fullAccess || (allowedPages && allowedPages.indexOf(it.href) !== -1);
        return '<label class="flex items-center gap-8">' +
          '<input type="checkbox" class="perm-item-cb" value="' + it.href + '"' + (checked ? " checked" : "") + (fromGroup || fullAccess ? " disabled" : "") + '>' +
          '<span><i class="fa-solid ' + it.icon + '"></i> ' + Utils.escapeHtml(it.label) + '</span>' +
          '</label>';
      }).join("");
      groupHint.textContent = fromGroup ? 'Permissões definidas pelo grupo selecionado — para personalizar só esta pessoa, mude para "Personalizado (sem grupo)" acima (isso desvincula do grupo).' : "";
    }

    var initialGroup = groupSelect.value ? groups.find(function (g) { return g.id === groupSelect.value; }) : null;
    if (initialGroup) {
      applyState(!initialGroup.allowedPages || !Array.isArray(initialGroup.allowedPages), initialGroup.allowedPages, initialGroup.canApprove, true);
    } else {
      applyState(!u.allowedPages || !Array.isArray(u.allowedPages), u.allowedPages, u.canApprove, false);
    }

    groupSelect.onchange = function () {
      var gsel = groupSelect.value ? groups.find(function (g) { return g.id === groupSelect.value; }) : null;
      if (gsel) {
        applyState(!gsel.allowedPages || !Array.isArray(gsel.allowedPages), gsel.allowedPages, gsel.canApprove, true);
      } else {
        // Voltando para "Personalizado": usa o que está exibido agora (do
        // grupo) como ponto de partida editável, em vez de zerar tudo.
        var currentFull = fullCb.checked;
        var currentAllowed = Utils.qsa(".perm-item-cb").filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
        var currentApprove = approveCb ? approveCb.checked : false;
        applyState(currentFull, currentAllowed, currentApprove, false);
      }
    };

    fullCb.onchange = function () {
      // Ligou "Acesso total" -> marca tudo (é só visual, allowedPages vai
      // sair null mesmo). Desligou -> some marcado por padrão, é preciso
      // limpar tudo para o administrador escolher manualmente quais telas
      // liberar (antes ficava tudo marcado, o que passava a impressão
      // errada de que o usuário continuava com acesso total).
      Utils.qsa(".perm-item-cb").forEach(function (cb) {
        cb.disabled = fullCb.checked;
        cb.checked = fullCb.checked;
      });
    };

    Utils.qs("#btn-save-perms").onclick = function () {
      var selectedGroup = groupSelect.value ? groups.find(function (g) { return g.id === groupSelect.value; }) : null;

      if (selectedGroup) {
        if (wouldLeaveNoConfigAccess(u.id, selectedGroup.allowedPages)) {
          Toast.show("Não é possível vincular: nenhum outro usuário ativo ficaria com acesso a Configurações.", "danger");
          return;
        }
        DB.update("users", u.id, { groupId: selectedGroup.id, allowedPages: selectedGroup.allowedPages, canApprove: selectedGroup.canApprove });
        DB.log("Configurações", "Vinculou " + u.firstName + " " + u.lastName + " ao grupo de acesso " + selectedGroup.name);
        Toast.show('Permissões atualizadas (vinculado ao grupo "' + selectedGroup.name + '")', "success");
      } else {
        var allowedPages = null; // null = full access
        if (!fullCb.checked) {
          allowedPages = Utils.qsa(".perm-item-cb").filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });

          // Safety net: never save a state that leaves zero active users with
          // access to Configurações itself — that would lock everyone out of
          // the one screen that can undo the mistake.
          if (wouldLeaveNoConfigAccess(u.id, allowedPages)) {
            Toast.show("Não é possível salvar: nenhum outro usuário ativo ficaria com acesso a Configurações.", "danger");
            return;
          }
        }

        var canApproveVal = approveCb ? approveCb.checked : !!u.canApprove;
        DB.update("users", u.id, { groupId: null, allowedPages: allowedPages, canApprove: canApproveVal });
        var desc = "Atualizou as permissões de acesso de " + u.firstName + " " + u.lastName +
          " (" + (allowedPages === null ? "acesso total" : allowedPages.length + " tela(s) liberada(s)") + ")" +
          (canApproveVal && u.role !== "Administrador" ? " — pode aprovar solicitações" : "");
        DB.log("Configurações", desc);
        Toast.show("Permissões atualizadas", "success");
      }

      var current = window.CurrentUser ? window.CurrentUser.get() : null;
      var saved = DB.get("users", u.id);
      if (current && current.id === u.id && !hasConfigAccess(saved.allowedPages)) {
        Toast.show("Você removeu seu próprio acesso a esta tela — passará a valer na próxima vez que você abrir o sistema.", "info", 5000);
      }

      renderUsers();
      renderPermsForUser(u.id);
    };
  }

  // ---------------- Aprovações ----------------
  // Aplica de fato a mudança quando uma solicitação é aprovada — cada tipo
  // sabe onde/como gravar (ver assets/js/approvals.js para o fluxo genérico
  // de solicitar/aprovar/recusar).
  var APPROVAL_APPLY = {
    comissao_agendamento: function (payload) {
      var patch = {};
      patch[payload.field] = payload.requestedValue;
      DB.update("appointments", payload.appointmentId, patch);
    },
    desconto_consumo: function (payload) {
      if (window.Consumo) Consumo.applyDiscount(payload.consumptionId, payload.discountAmount);
    },
    // Venda parcelada acima de 3x no crédito (ver openNewTxnModal em
    // financeiro.js): os lançamentos só foram montados, não gravados — são
    // inseridos de fato agora que um administrador (ou aprovador) autorizou.
    parcelamento_venda: function (payload) {
      var records = payload.records || [];
      if (records.length > 1) {
        DB.batch(function () { records.forEach(function (r) { DB.insert("transactions", r); }); });
      } else if (records.length === 1) {
        DB.insert("transactions", records[0]);
      }
    }
  };

  function renderApprovals() {
    var tbl = Utils.qs("#tbl-approvals");
    if (!tbl) return;
    var list = DB.all("approvals").sort(function (a, b) {
      // pendentes primeiro, depois mais recentes
      if ((a.status === "pendente") !== (b.status === "pendente")) return a.status === "pendente" ? -1 : 1;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
    if (!list.length) {
      Utils.emptyTable(tbl, "fa-user-check", "Nenhuma solicitação de aprovação até agora");
      return;
    }
    var canApprove = window.Approvals && Approvals.canApprove();
    var statusBadge = { pendente: '<span class="badge badge-warning">Pendente</span>', aprovada: '<span class="badge badge-success">Aprovada</span>', recusada: '<span class="badge badge-gray">Recusada</span>' };
    tbl.innerHTML = '<thead><tr><th>Solicitação</th><th>Tipo</th><th>Solicitado por</th><th>Data</th><th>Status</th><th></th></tr></thead><tbody>' +
      list.map(function (a) {
        var actions = "";
        if (a.status === "pendente" && canApprove) {
          actions = '<div class="flex gap-6">' +
            '<button class="btn btn-sm btn-primary" data-approve="' + a.id + '">Aprovar</button>' +
            '<button class="btn btn-sm btn-ghost" data-reject="' + a.id + '">Recusar</button>' +
            '</div>';
        } else if (a.status === "pendente") {
          actions = '<span class="small text-muted">Aguardando aprovação</span>';
        } else {
          actions = '<span class="small text-muted">' + Utils.escapeHtml(a.decidedByName || "-") + ' · ' + Utils.fmtDateTime(a.decidedAt) + '</span>';
        }
        return '<tr>' +
          '<td>' + Utils.escapeHtml(a.summary || "-") + '</td>' +
          '<td><span class="chip">' + Utils.escapeHtml((window.Approvals && Approvals.TYPE_LABELS[a.type]) || a.type) + '</span></td>' +
          '<td>' + Utils.escapeHtml(a.requestedByName || "-") + '</td>' +
          '<td class="small text-muted">' + Utils.fmtDateTime(a.createdAt) + '</td>' +
          '<td>' + (statusBadge[a.status] || a.status) + '</td>' +
          '<td>' + actions + '</td>' +
          '</tr>';
      }).join("") + '</tbody>';

    Utils.qsa("[data-approve]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-approve");
        var a = DB.get("approvals", id);
        if (!a) return;
        var handler = APPROVAL_APPLY[a.type];
        Approvals.approve(id, handler);
        Toast.show("Solicitação aprovada", "success");
        renderApprovals();
        if (window.AppLayout) Approvals.renderBadge(document.getElementById("approvals-badge-slot"));
      });
    });
    Utils.qsa("[data-reject]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-reject");
        Modal.confirm({
          title: "Recusar solicitação", message: "Deseja recusar esta solicitação?", danger: true,
          onConfirm: function () {
            Approvals.reject(id);
            Toast.show("Solicitação recusada", "info");
            renderApprovals();
            Approvals.renderBadge(document.getElementById("approvals-badge-slot"));
          }
        });
      });
    });
  }

  // ---------------- Log de Atividade ----------------
  var LOG_RENDER_CAP = 200;
  function renderLog() {
    var search = (Utils.qs("#log-search").value || "").toLowerCase();
    var start = Utils.qs("#log-start").value;
    var end = Utils.qs("#log-end").value;
    var list = DB.all("activityLog").slice().sort(function (a, b) { return (b.timestamp || "").localeCompare(a.timestamp || ""); });

    list = list.filter(function (l) {
      if (start && String(l.timestamp).slice(0, 10) < start) return false;
      if (end && String(l.timestamp).slice(0, 10) > end) return false;
      if (search) {
        var hay = ((l.action || "") + " " + (l.description || "") + " " + (l.userName || "")).toLowerCase();
        if (hay.indexOf(search) === -1) return false;
      }
      return true;
    });

    var tbl = Utils.qs("#tbl-log");
    var shown = list.slice(0, LOG_RENDER_CAP);
    if (!shown.length) {
      Utils.emptyTable(tbl, "fa-clock", "Nenhum registro de atividade encontrado");
      return;
    }
    tbl.innerHTML = '<thead><tr><th>Data/Hora</th><th>Usuário</th><th>Ação</th><th>Descrição</th></tr></thead><tbody>' +
      shown.map(function (l) {
        return '<tr>' +
          '<td class="text-num">' + Utils.fmtDateTime(l.timestamp) + '</td>' +
          '<td>' + Utils.escapeHtml(l.userName || "-") + '</td>' +
          '<td><span class="chip">' + Utils.escapeHtml(l.action || "-") + '</span></td>' +
          '<td>' + Utils.escapeHtml(l.description || "-") + '</td>' +
          '</tr>';
      }).join("") + '</tbody>';

    var note = Utils.qs("#log-note");
    if (note) {
      note.textContent = list.length > LOG_RENDER_CAP
        ? "Mostrando os " + LOG_RENDER_CAP + " registros mais recentes de " + list.length + " encontrados. Refine a busca ou o período para ver outros."
        : "Mostrando " + shown.length + " registro(s).";
    }
  }

  function kpiRowless() {}

  // ---------------- Cost Centers ----------------
  function renderCC() {
    var list = DB.all("costCenters");
    var categories = DB.all("categories");
    var tbl = Utils.qs("#tbl-cc");
    tbl.innerHTML = '<thead><tr><th>Nome</th><th>Descrição</th><th class="text-right">Categorias Vinculadas</th><th></th></tr></thead><tbody>' +
      list.map(function (c) {
        var count = categories.filter(function (cat) { return cat.costCenterId === c.id; }).length;
        return '<tr><td class="font-bold">' + Utils.escapeHtml(c.name) + '</td><td class="small text-muted">' + Utils.escapeHtml(c.description) + '</td>' +
          '<td class="text-right">' + count + '</td>' +
          '<td><div class="flex gap-6"><button class="btn btn-icon btn-ghost" data-edit-cc="' + c.id + '"><i class="fa-solid fa-pen"></i></button>' +
          '<button class="btn btn-icon btn-ghost" data-del-cc="' + c.id + '"><i class="fa-solid fa-trash"></i></button></div></td></tr>';
      }).join("") + '</tbody>';
    Utils.qsa("[data-edit-cc]", tbl).forEach(function (b) { b.addEventListener("click", function () { openCcModal(b.getAttribute("data-edit-cc")); }); });
    Utils.qsa("[data-del-cc]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del-cc");
        if (categories.some(function (c) { return c.costCenterId === id; })) { Toast.show("Existem categorias vinculadas a este centro de custo", "danger"); return; }
        Modal.confirm({ title: "Excluir centro de custo", message: "Confirma a exclusão?", danger: true, onConfirm: function () {
          var cc = DB.get("costCenters", id);
          DB.remove("costCenters", id);
          if (cc) DB.log("Configurações", "Excluiu o centro de custo " + cc.name);
          Toast.show("Excluído", "success"); renderCC();
        } });
      });
    });
  }
  function openCcModal(id) {
    var c = id ? DB.get("costCenters", id) : null;
    var body = '<div class="form-grid"><div class="form-field full"><label>Nome</label><input type="text" id="cc-name" value="' + (c ? Utils.escapeHtml(c.name) : "") + '"></div>' +
      '<div class="form-field full"><label>Descrição</label><input type="text" id="cc-desc" value="' + (c ? Utils.escapeHtml(c.description) : "") + '"></div></div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cc-save">Salvar</button>';
    var box = Modal.open({ title: c ? "Editar Centro de Custo" : "Novo Centro de Custo", bodyHtml: body, footHtml: foot });
    box.querySelector("#cc-save").addEventListener("click", function () {
      var name = box.querySelector("#cc-name").value.trim();
      if (!name) { Toast.show("Informe o nome", "danger"); return; }
      var patch = { name: name, description: box.querySelector("#cc-desc").value.trim(), key: c ? c.key : Utils.slugify(name) };
      if (c) DB.update("costCenters", c.id, patch); else DB.insert("costCenters", patch);
      DB.log("Configurações", (c ? "Atualizou" : "Criou") + " o centro de custo " + name);
      Modal.close(); Toast.show("Centro de custo salvo", "success"); renderCC();
    });
  }

  // ---------------- Categories ----------------
  function renderCat() {
    var list = DB.all("categories");
    var costCenters = DB.all("costCenters");
    var tbl = Utils.qs("#tbl-cat");
    tbl.innerHTML = '<thead><tr><th>Categoria</th><th>Tipo</th><th>Centro de Custo</th><th></th></tr></thead><tbody>' +
      list.map(function (c) {
        var cc = costCenters.find(function (x) { return x.id === c.costCenterId; });
        return '<tr><td><span class="dot" style="background:' + c.color + ';margin-right:6px;"></span>' + Utils.escapeHtml(c.name) + '</td>' +
          '<td>' + (c.type === "receita" ? '<span class="badge badge-success">Receita</span>' : '<span class="badge badge-danger">Despesa</span>') + '</td>' +
          '<td>' + Utils.escapeHtml(cc ? cc.name : "-") + '</td>' +
          '<td><div class="flex gap-6"><button class="btn btn-icon btn-ghost" data-edit-cat="' + c.id + '"><i class="fa-solid fa-pen"></i></button>' +
          '<button class="btn btn-icon btn-ghost" data-del-cat="' + c.id + '"><i class="fa-solid fa-trash"></i></button></div></td></tr>';
      }).join("") + '</tbody>';
    Utils.qsa("[data-edit-cat]", tbl).forEach(function (b) { b.addEventListener("click", function () { openCatModal(b.getAttribute("data-edit-cat")); }); });
    Utils.qsa("[data-del-cat]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del-cat");
        var inUse = DB.all("transactions").some(function (t) { return t.categoryId === id; });
        if (inUse) { Toast.show("Existem lançamentos usando esta categoria", "danger"); return; }
        Modal.confirm({ title: "Excluir categoria", message: "Confirma a exclusão?", danger: true, onConfirm: function () {
          var cat = DB.get("categories", id);
          DB.remove("categories", id);
          if (cat) DB.log("Configurações", "Excluiu a categoria " + cat.name);
          Toast.show("Excluída", "success"); renderCat();
        } });
      });
    });
  }
  function openCatModal(id) {
    var c = id ? DB.get("categories", id) : null;
    var costCenters = DB.all("costCenters");
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Nome</label><input type="text" id="cat-name" value="' + (c ? Utils.escapeHtml(c.name) : "") + '"></div>' +
      '<div class="form-field"><label>Tipo</label><select id="cat-type"><option value="receita"' + (c && c.type === "receita" ? " selected" : "") + '>Receita</option><option value="despesa"' + (c && c.type === "despesa" ? " selected" : "") + '>Despesa</option></select></div>' +
      '<div class="form-field"><label>Centro de Custo Padrão</label><select id="cat-cc">' + costCenters.map(function (cc) { return '<option value="' + cc.id + '"' + (c && c.costCenterId === cc.id ? " selected" : "") + '>' + Utils.escapeHtml(cc.name) + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-field"><label>Cor</label><input type="color" id="cat-color" value="' + (c ? c.color : "#52525a") + '" style="height:38px;"></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cat-save">Salvar</button>';
    var box = Modal.open({ title: c ? "Editar Categoria" : "Nova Categoria", bodyHtml: body, footHtml: foot });
    box.querySelector("#cat-save").addEventListener("click", function () {
      var name = box.querySelector("#cat-name").value.trim();
      if (!name) { Toast.show("Informe o nome", "danger"); return; }
      var patch = { name: name, type: box.querySelector("#cat-type").value, costCenterId: box.querySelector("#cat-cc").value, color: box.querySelector("#cat-color").value };
      if (c) DB.update("categories", c.id, patch); else DB.insert("categories", patch);
      DB.log("Configurações", (c ? "Atualizou" : "Criou") + " a categoria " + name);
      Modal.close(); Toast.show("Categoria salva", "success"); renderCat();
    });
  }

  // ---------------- Cargos ----------------
  // Diferente de Centros de Custo/Categorias/Serviços, cargos não são uma
  // tabela própria no Supabase — ficam guardados em settings.roles (ver
  // DB.getRoles/DB.saveRoles em db.js), então o CRUD aqui mexe direto
  // nesse array em vez de usar DB.insert/update/remove. É só uma lista de
  // nomes (sem vínculo com grupo de serviço).
  function renderRoles() {
    var list = DB.getRoles();
    var employees = DB.all("employees");
    var tbl = Utils.qs("#tbl-roles");
    tbl.innerHTML = '<thead><tr><th>Cargo</th><th class="text-right">Funcionários</th><th></th></tr></thead><tbody>' +
      list.map(function (r) {
        var count = employees.filter(function (e) { return e.role === r.name; }).length;
        return '<tr><td class="font-bold">' + Utils.escapeHtml(r.name) + '</td>' +
          '<td class="text-right">' + count + '</td>' +
          '<td><div class="flex gap-6"><button class="btn btn-icon btn-ghost" data-edit-role="' + r.id + '"><i class="fa-solid fa-pen"></i></button>' +
          '<button class="btn btn-icon btn-ghost" data-del-role="' + r.id + '"><i class="fa-solid fa-trash"></i></button></div></td></tr>';
      }).join("") + '</tbody>';
    Utils.qsa("[data-edit-role]", tbl).forEach(function (b) { b.addEventListener("click", function () { openRoleModal(b.getAttribute("data-edit-role")); }); });
    Utils.qsa("[data-del-role]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del-role");
        var role = list.find(function (r) { return r.id === id; });
        if (role && employees.some(function (e) { return e.role === role.name; })) { Toast.show("Existem funcionários cadastrados com este cargo", "danger"); return; }
        Modal.confirm({ title: "Excluir cargo", message: "Confirma a exclusão?", danger: true, onConfirm: function () {
          DB.saveRoles(DB.getRoles().filter(function (r) { return r.id !== id; }));
          if (role) DB.log("Configurações", "Excluiu o cargo " + role.name);
          Toast.show("Excluído", "success"); renderRoles();
        } });
      });
    });
  }
  function openRoleModal(id) {
    var list = DB.getRoles();
    var r = id ? list.find(function (x) { return x.id === id; }) : null;
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Nome do Cargo</label><input type="text" id="role-name" value="' + (r ? Utils.escapeHtml(r.name) : "") + '"></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="role-save">Salvar</button>';
    var box = Modal.open({ title: r ? "Editar Cargo" : "Novo Cargo", bodyHtml: body, footHtml: foot });
    box.querySelector("#role-save").addEventListener("click", function () {
      var name = box.querySelector("#role-name").value.trim();
      if (!name) { Toast.show("Informe o nome do cargo", "danger"); return; }
      var dup = list.some(function (x) { return x.name.toLowerCase() === name.toLowerCase() && (!r || x.id !== r.id); });
      if (dup) { Toast.show("Já existe um cargo com este nome", "danger"); return; }
      if (r) {
        DB.saveRoles(list.map(function (x) { return x.id === r.id ? Object.assign({}, x, { name: name }) : x; }));
        DB.log("Configurações", "Atualizou o cargo " + name);
      } else {
        DB.saveRoles(list.concat([{ id: DB.uid("rol"), name: name }]));
        DB.log("Configurações", "Criou o cargo " + name);
      }
      Modal.close(); Toast.show("Cargo salvo", "success"); renderRoles();
    });
  }

  // ---------------- Grupos de Acesso ----------------
  // Mesmo padrão de Cargos: não é tabela própria no Supabase, fica guardado
  // em settings.accessGroups (lido/gravado direto via DB.getSettings()/
  // DB.updateSettings(), sem precisar de wrapper novo em db.js). Cada grupo
  // é um modelo de permissões (allowedPages + canApprove) que pode ser
  // aplicado a vários acessos de uma vez (users.groupId) — editar o grupo
  // atualiza automaticamente (cascata) todo mundo vinculado a ele; quem
  // precisar de algo diferente é ajustado manualmente na aba Permissões, o
  // que desvincula essa pessoa do grupo (groupId volta a null).
  function getAccessGroups() {
    return (DB.getSettings() || {}).accessGroups || [];
  }
  function saveAccessGroups(list) {
    DB.updateSettings({ accessGroups: list });
  }

  // Telas liberadas efetivas de um usuário: se ele estiver num grupo, valem
  // as telas do grupo (não o que estiver gravado em users.allowedPages, que
  // só é atualizado quando o grupo é salvo/editado); senão, valem as dele.
  function hasConfigAccess(allowedPages) {
    return !allowedPages || !Array.isArray(allowedPages) || allowedPages.indexOf("configuracoes.html") !== -1;
  }
  function effectiveAllowedPages(u, groups) {
    if (!u.groupId) return u.allowedPages;
    var g = groups.find(function (x) { return x.id === u.groupId; });
    return g ? g.allowedPages : u.allowedPages;
  }
  // Rede de segurança: nunca deixa salvar um estado (de um usuário avulso
  // ou de um grupo inteiro) que tiraria de TODO MUNDO ativo o acesso à
  // própria tela de Configurações — travaria todo mundo fora da única tela
  // que consegue desfazer o erro.
  function wouldLeaveNoConfigAccess(userId, futureAllowedPages) {
    if (hasConfigAccess(futureAllowedPages)) return false;
    var groups = getAccessGroups();
    return !DB.all("users").some(function (other) {
      if (other.id === userId || !other.active) return false;
      return hasConfigAccess(effectiveAllowedPages(other, groups));
    });
  }
  function groupEditWouldLeaveNoConfigAccess(groupId, futureAllowedPages) {
    if (hasConfigAccess(futureAllowedPages)) return false;
    var groups = getAccessGroups();
    return !DB.all("users").some(function (u) {
      if (!u.active) return false;
      var eff = u.groupId === groupId ? futureAllowedPages : effectiveAllowedPages(u, groups);
      return hasConfigAccess(eff);
    });
  }

  function renderGroups() {
    var list = getAccessGroups();
    var users = DB.all("users");
    var tbl = Utils.qs("#tbl-groups");
    if (!tbl) return;
    if (!list.length) {
      // emptyTable() sempre usa o estilo "fa-regular" (ver Utils.emptyTable em
      // utils.js) — fa-people-group só existe no estilo "solid" no Font
      // Awesome Free, então ficava sem ícone (glifo ausente). fa-object-group
      // tem versão regular e combina bem com "agrupamento de acessos".
      Utils.emptyTable(tbl, "fa-object-group", "Nenhum grupo de acesso cadastrado ainda");
      return;
    }
    tbl.innerHTML = '<thead><tr><th>Grupo</th><th>Telas liberadas</th><th class="text-right">Acessos vinculados</th><th></th></tr></thead><tbody>' +
      list.map(function (g) {
        var count = users.filter(function (u) { return u.groupId === g.id; }).length;
        var pagesLabel = (!g.allowedPages || !Array.isArray(g.allowedPages)) ? "Acesso total" : (g.allowedPages.length + " tela(s)");
        return '<tr><td class="font-bold">' + Utils.escapeHtml(g.name) + '</td>' +
          '<td class="small text-muted">' + pagesLabel + (g.canApprove ? " · pode aprovar solicitações" : "") + '</td>' +
          '<td class="text-right">' + count + '</td>' +
          '<td><div class="flex gap-6"><button class="btn btn-icon btn-ghost" data-edit-group="' + g.id + '"><i class="fa-solid fa-pen"></i></button>' +
          '<button class="btn btn-icon btn-ghost" data-del-group="' + g.id + '"><i class="fa-solid fa-trash"></i></button></div></td></tr>';
      }).join("") + '</tbody>';
    Utils.qsa("[data-edit-group]", tbl).forEach(function (b) { b.addEventListener("click", function () { openGroupModal(b.getAttribute("data-edit-group")); }); });
    Utils.qsa("[data-del-group]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del-group");
        var g = list.find(function (x) { return x.id === id; });
        var members = users.filter(function (u) { return u.groupId === id; });
        Modal.confirm({
          title: "Excluir grupo de acesso",
          message: (members.length ? ("Este grupo tem " + members.length + " acesso(s) vinculado(s). Eles não perdem as permissões que têm hoje — só deixam de estar vinculados ao grupo (o grupo deixa de existir, então não há mais o que cascatear). ") : "") + "Confirma a exclusão do grupo \"" + (g ? g.name : "") + "\"?",
          danger: true,
          onConfirm: function () {
            if (members.length) {
              DB.batch(function () { members.forEach(function (u) { DB.update("users", u.id, { groupId: null }); }); });
            }
            saveAccessGroups(list.filter(function (x) { return x.id !== id; }));
            DB.log("Configurações", "Excluiu o grupo de acesso " + (g ? g.name : id) + (members.length ? (" (" + members.length + " acesso(s) desvinculado(s), sem alterar permissões)") : ""));
            Toast.show("Grupo excluído", "success");
            renderGroups(); renderUsers(); renderPerms();
          }
        });
      });
    });
  }

  function openGroupModal(id) {
    var list = getAccessGroups();
    var g = id ? list.find(function (x) { return x.id === id; }) : null;
    var items = permPageItems();
    var fullAccess = !g || !g.allowedPages || !Array.isArray(g.allowedPages);
    var body = '<div class="form-grid"><div class="form-field full"><label>Nome do Grupo</label><input type="text" id="grp-name" value="' + (g ? Utils.escapeHtml(g.name) : "") + '"></div></div>' +
      '<label class="flex items-center gap-8 mb-16 mt-16">' +
      '<input type="checkbox" id="grp-full-access"' + (fullAccess ? " checked" : "") + '>' +
      '<span><strong>Acesso total</strong> — quem estiver neste grupo pode abrir todas as telas do sistema, inclusive as que forem criadas mais adiante</span>' +
      '</label>' +
      '<label class="flex items-center gap-8 mb-16">' +
      '<input type="checkbox" id="grp-can-approve"' + (g && g.canApprove ? " checked" : "") + '>' +
      '<span><strong>Pode aprovar solicitações</strong> — quem estiver neste grupo aparece com os botões de aprovar/recusar na aba Aprovações</span>' +
      '</label>' +
      '<div id="grp-checklist" class="form-grid">' + items.map(function (it) {
        var checked = fullAccess || (g && g.allowedPages && g.allowedPages.indexOf(it.href) !== -1);
        return '<label class="flex items-center gap-8">' +
          '<input type="checkbox" class="grp-item-cb" value="' + it.href + '"' + (checked ? " checked" : "") + (fullAccess ? " disabled" : "") + '>' +
          '<span><i class="fa-solid ' + it.icon + '"></i> ' + Utils.escapeHtml(it.label) + '</span>' +
          '</label>';
      }).join("") + '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="grp-save">Salvar</button>';
    var box = Modal.open({ title: g ? "Editar Grupo de Acesso" : "Novo Grupo de Acesso", wide: true, bodyHtml: body, footHtml: foot });

    var fullCb = box.querySelector("#grp-full-access");
    fullCb.addEventListener("change", function () {
      Utils.qsa(".grp-item-cb", box).forEach(function (cb) {
        cb.disabled = fullCb.checked;
        cb.checked = fullCb.checked;
      });
    });

    box.querySelector("#grp-save").addEventListener("click", function () {
      var name = box.querySelector("#grp-name").value.trim();
      if (!name) { Toast.show("Informe o nome do grupo", "danger"); return; }
      var dup = list.some(function (x) { return x.name.toLowerCase() === name.toLowerCase() && (!g || x.id !== g.id); });
      if (dup) { Toast.show("Já existe um grupo com este nome", "danger"); return; }

      var allowedPages = null;
      if (!fullCb.checked) {
        allowedPages = Utils.qsa(".grp-item-cb", box).filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
      }
      var canApproveVal = box.querySelector("#grp-can-approve").checked;

      if (g && groupEditWouldLeaveNoConfigAccess(g.id, allowedPages)) {
        Toast.show("Não é possível salvar: nenhum acesso ativo ficaria com acesso a Configurações depois desta alteração (considerando quem está neste grupo).", "danger");
        return;
      }

      var members = g ? DB.all("users").filter(function (u) { return u.groupId === g.id; }) : [];
      if (g) {
        saveAccessGroups(list.map(function (x) { return x.id === g.id ? Object.assign({}, x, { name: name, allowedPages: allowedPages, canApprove: canApproveVal }) : x; }));
        if (members.length) {
          DB.batch(function () { members.forEach(function (u) { DB.update("users", u.id, { allowedPages: allowedPages, canApprove: canApproveVal }); }); });
        }
        DB.log("Configurações", "Atualizou o grupo de acesso " + name + (members.length ? (" (" + members.length + " acesso(s) vinculado(s) atualizado(s) automaticamente)") : ""));
      } else {
        saveAccessGroups(list.concat([{ id: DB.uid("grp"), name: name, allowedPages: allowedPages, canApprove: canApproveVal }]));
        DB.log("Configurações", "Criou o grupo de acesso " + name);
      }
      Modal.close();
      Toast.show("Grupo salvo", "success");
      renderGroups(); renderUsers(); renderPerms();

      var current = window.CurrentUser ? window.CurrentUser.get() : null;
      if (current && g && members.some(function (u) { return u.id === current.id; }) && !hasConfigAccess(allowedPages)) {
        Toast.show("Este grupo perdeu o acesso a esta tela — passará a valer na próxima vez que você abrir o sistema.", "info", 5000);
      }
    });
  }

  // ---------------- Services ----------------
  function renderSrv() {
    var list = DB.all("services").sort(function (a, b) { return a.group.localeCompare(b.group) || a.name.localeCompare(b.name); });
    var tbl = Utils.qs("#tbl-srv");
    tbl.innerHTML = '<thead><tr><th>Serviço</th><th>Grupo</th><th class="text-right">Preço</th><th class="text-right">Duração</th><th></th></tr></thead><tbody>' +
      list.map(function (s) {
        return '<tr><td class="font-bold">' + Utils.escapeHtml(s.name) + '</td><td><span class="chip">' + Utils.escapeHtml(s.group) + '</span></td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(s.price) + '</td><td class="text-right text-num">' + s.durationMin + ' min</td>' +
          '<td><div class="flex gap-6"><button class="btn btn-icon btn-ghost" data-edit-srv="' + s.id + '"><i class="fa-solid fa-pen"></i></button>' +
          '<button class="btn btn-icon btn-ghost" data-del-srv="' + s.id + '"><i class="fa-solid fa-trash"></i></button></div></td></tr>';
      }).join("") + '</tbody>';
    Utils.qsa("[data-edit-srv]", tbl).forEach(function (b) { b.addEventListener("click", function () { openSrvModal(b.getAttribute("data-edit-srv")); }); });
    Utils.qsa("[data-del-srv]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del-srv");
        Modal.confirm({ title: "Excluir serviço", message: "Confirma a exclusão?", danger: true, onConfirm: function () {
          var srv = DB.get("services", id);
          DB.remove("services", id);
          if (srv) DB.log("Configurações", "Excluiu o serviço " + srv.name);
          Toast.show("Excluído", "success"); renderSrv();
        } });
      });
    });
  }
  function openSrvModal(id) {
    var s = id ? DB.get("services", id) : null;
    var categories = DB.all("categories").filter(function (c) { return c.type === "receita"; });
    // Lista de grupos de serviço do salão (alinhada com o catálogo real
    // importado em 30/08/2026 — antes eram só 4 grupos placeholder). Se um
    // serviço já cadastrado tiver um grupo fora dessa lista (ex.: um nome
    // digitado manualmente antes), ele é incluído também, para não sumir
    // do dropdown ao editar esse serviço.
    var groups = ["Cabelo", "Cílios", "Depilação", "Mãos e Pés", "Maquiagem", "Rosto", "Sobrancelha"];
    if (s && s.group && groups.indexOf(s.group) === -1) groups.push(s.group);
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Nome do Serviço</label><input type="text" id="srv-name" value="' + (s ? Utils.escapeHtml(s.name) : "") + '"></div>' +
      '<div class="form-field"><label>Grupo</label><select id="srv-group">' + groups.map(function (g) { return '<option value="' + g + '"' + (s && s.group === g ? " selected" : "") + '>' + g + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-field"><label>Categoria de Receita</label><select id="srv-cat">' + categories.map(function (c) { return '<option value="' + c.id + '"' + (s && s.categoryId === c.id ? " selected" : "") + '>' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-field"><label>Preço (R$)</label><input type="text" id="srv-price"></div>' +
      '<div class="form-field"><label>Duração (min)</label><input type="number" id="srv-duration" value="' + (s ? s.durationMin : 30) + '"></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="srv-save">Salvar</button>';
    var box = Modal.open({ title: s ? "Editar Serviço" : "Novo Serviço", bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#srv-price"), s ? s.price : 0);
    box.querySelector("#srv-save").addEventListener("click", function () {
      var name = box.querySelector("#srv-name").value.trim();
      if (!name) { Toast.show("Informe o nome do serviço", "danger"); return; }
      var patch = {
        name: name, group: box.querySelector("#srv-group").value, categoryId: box.querySelector("#srv-cat").value,
        price: Utils.moneyMaskToFloat(box.querySelector("#srv-price")), durationMin: parseInt(box.querySelector("#srv-duration").value, 10) || 30
      };
      if (s) DB.update("services", s.id, patch); else DB.insert("services", patch);
      DB.log("Configurações", (s ? "Atualizou" : "Criou") + " o serviço " + name);
      Modal.close(); Toast.show("Serviço salvo", "success"); renderSrv();
    });
  }
})();
