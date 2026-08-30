(function () {
  "use strict";

  var filt = { role: "", status: "", search: "" };

  // Cargos que sempre contaram como "realiza serviços" antes desse campo
  // existir no funcionário — usado só para sugerir o valor padrão do campo
  // "Realiza serviços" ao editar alguém já cadastrado antes desse recurso
  // (ver openEmpModal). Mesma lista usada em agenda.js (LEGACY_SERVICE_ROLES).
  var LEGACY_SERVICE_ROLES = ["Cabeleireiro(a)", "Manicure e Pedicure", "Esteticista", "Maquiador(a)"];

  // Mesma lista de perfis de acesso usada em Configurações → Acessos
  // (assets/js/configuracoes.js) — repetida aqui porque cada tela deste
  // sistema é um arquivo independente (sem módulos/import). "Perfil de
  // acesso" é um conceito diferente de "Cargo" (Cabeleireiro(a), Recepção
  // etc.): decide o rótulo mostrado no topo do sistema e é só informativo,
  // quem manda mesmo em quais telas a pessoa abre é o checklist de telas.
  var ACCESS_ROLE_OPTIONS = ["Administrador", "Gerente", "Financeiro", "Recepcionista", "Profissional", "Desenvolvedor"];

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  // Telas do sistema (para o checklist de "quais telas essa pessoa pode
  // abrir") — vem do mesmo NAV usado no menu lateral (assets/js/layout.js),
  // então fica sincronizado sozinho conforme telas são criadas/removidas.
  function permPageItems() {
    return (window.AppLayout ? window.AppLayout.NAV : []).filter(function (item) { return !item.section; });
  }

  // Separa "Nome Completo" em primeiro nome + sobrenome, pro cadastro de
  // Acesso (que guarda os dois campos separados, ver Configurações →
  // Acessos). Sem sobrenome digitado, usa o próprio nome como sobrenome
  // também, só para nunca deixar o campo vazio (exigido lá).
  function splitName(fullName) {
    var parts = fullName.trim().split(/\s+/);
    return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(" ") : parts[0] };
  }

  // Acesso (tabela "users") já vinculado a este funcionário — por
  // employeeId (vínculo formal, criado a partir daqui) ou, se ainda não
  // tiver esse vínculo, por CPF igual (adota automaticamente um acesso
  // criado antes desse recurso existir, direto em Configurações → Acessos).
  function linkedUserFor(employeeId, cpf) {
    if (!employeeId) return null;
    var byId = DB.findOne("users", function (u) { return u.employeeId === employeeId; });
    if (byId) return byId;
    if (!cpf) return null;
    return DB.findOne("users", function (u) { return !u.employeeId && u.cpf === cpf; });
  }

  function init() {
    var roleSel = Utils.qs("#e-role");
    DB.getRoles().forEach(function (r) { var o = document.createElement("option"); o.value = r.name; o.textContent = r.name; roleSel.appendChild(o); });
    roleSel.addEventListener("change", function (e) { filt.role = e.target.value; render(); });
    Utils.qs("#e-status").addEventListener("change", function (e) { filt.status = e.target.value; render(); });
    Utils.qs("#e-search").addEventListener("input", Utils.debounce(function (e) { filt.search = e.target.value.toLowerCase(); render(); }, 200));
    Utils.qs("#btn-new-emp").addEventListener("click", function () { openEmpModal(null); });
    render();
  }

  function getEmployees() {
    return DB.all("employees").filter(function (e) {
      if (filt.role && e.role !== filt.role) return false;
      if (filt.status && e.status !== filt.status) return false;
      if (filt.search) {
        var hay = (e.name + " " + e.email + " " + e.phone).toLowerCase();
        if (hay.indexOf(filt.search) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function render() {
    var employees = getEmployees();
    var all = DB.all("employees");
    var ativos = all.filter(function (e) { return e.status === "ativo"; });
    var folhaFixa = ativos.reduce(function (s, e) { return s + (e.baseSalary || 0); }, 0);
    var comComissao = ativos.filter(function (e) { return e.commissionRate > 0; });
    var comissaoMedia = comComissao.length ? comComissao.reduce(function (s, e) { return s + e.commissionRate; }, 0) / comComissao.length : 0;
    var curMonthNum = Utils.parseDate(Utils.todayISO()).getMonth() + 1;
    var aniversariantes = all.filter(function (e) { return e.birthday && parseInt(e.birthday.split("-")[1], 10) === curMonthNum; }).length;

    document.getElementById("emp-summary").innerHTML = [
      kpi("Funcionários Ativos", String(ativos.length), "fa-users", "#2a78d6", "#e3eefb"),
      kpi("Folha Fixa Mensal", Utils.fmtMoney(folhaFixa), "fa-money-check-dollar", "#b8923f", "#f6ecd3"),
      kpi("Comissão Média", comissaoMedia.toFixed(1) + "%", "fa-percent", "#1baf7a", "#e2f5ec"),
      kpi("Total Cadastrado", String(all.length), "fa-id-badge", "#4a3aa7", "#ece8f8"),
      kpi("Aniversariantes do Mês", String(aniversariantes), "fa-cake-candles", "#e87ba4", "#fbe9f0", "kpi-bday")
    ].join("");
    var bdayCard = document.getElementById("kpi-bday");
    if (bdayCard && window.Aniversarios) {
      bdayCard.classList.add("kpi-card-clickable");
      bdayCard.title = "Ver calendário de aniversariantes";
      bdayCard.addEventListener("click", function () { Aniversarios.openModal(); });
    }

    var tbl = document.getElementById("tbl-emp");
    if (!employees.length) {
      Utils.emptyTable(tbl, "fa-id-badge", "Nenhum funcionário encontrado");
      return;
    }
    tbl.innerHTML = '<thead><tr><th>Funcionário</th><th>Cargo</th><th>Contato</th><th>Admissão</th><th class="text-right">Salário Base</th><th class="text-right">Comissão</th><th>Status</th><th>Acesso</th><th></th></tr></thead><tbody>' +
      employees.map(function (e) {
        var acc = linkedUserFor(e.id, e.cpf);
        var accHtml = (acc && acc.active) ? '<span class="badge badge-success">Sim</span>' : (acc ? '<span class="badge badge-gray">Desativado</span>' : '<span class="badge badge-gray">Não</span>');
        return '<tr>' +
          '<td><div class="flex items-center gap-8">' + Utils.avatarHtml(e.name, e.photoDataUrl) + '<span class="font-bold">' + Utils.escapeHtml(e.name) + '</span></div></td>' +
          '<td>' + Utils.escapeHtml(e.role) + '</td>' +
          '<td class="small">' + Utils.escapeHtml(e.phone) + '<br><span class="text-muted">' + Utils.escapeHtml(e.email) + '</span></td>' +
          '<td class="text-num">' + Utils.fmtDate(e.hireDate) + '</td>' +
          '<td class="text-right text-num">' + (e.baseSalary ? Utils.fmtMoney(e.baseSalary) : '<span class="text-muted">-</span>') + '</td>' +
          '<td class="text-right text-num">' + (e.commissionRate ? e.commissionRate + "%" : '<span class="text-muted">-</span>') + '</td>' +
          '<td>' + (e.status === "ativo" ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>') + '</td>' +
          '<td>' + accHtml + '</td>' +
          '<td><div class="flex gap-6">' +
            '<button class="btn btn-icon btn-ghost" data-edit="' + e.id + '" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-del="' + e.id + '" title="Excluir"><i class="fa-solid fa-trash"></i></button>' +
          '</div></td></tr>';
      }).join("") + '</tbody>';

    Utils.qsa("[data-edit]", tbl).forEach(function (b) { b.addEventListener("click", function () { openEmpModal(b.getAttribute("data-edit")); }); });
    Utils.qsa("[data-del]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del");
        Modal.confirm({
          title: "Excluir funcionário", message: "Tem certeza que deseja excluir este funcionário? O histórico financeiro associado será mantido.", danger: true,
          onConfirm: function () {
            var emp = DB.get("employees", id);
            DB.remove("employees", id);
            if (emp) DB.log("Funcionário", "Excluiu o funcionário " + emp.name);
            Toast.show("Funcionário excluído", "success"); render();
          }
        });
      });
    });
  }

  function kpi(label, value, icon, color, bg, id) {
    return '<div class="kpi-card"' + (id ? ' id="' + id + '"' : '') + '><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }

  function openEmpModal(id) {
    var e = id ? DB.get("employees", id) : null;
    var roles = DB.getRoles();
    var photoDataUrl = e ? (e.photoDataUrl || null) : null;
    // "Realiza serviços": controla se a pessoa aparece com uma coluna
    // própria na Visão do Dia da Agenda (ver activeEmployees em agenda.js).
    // Funcionário já existente sem esse campo salvo (cadastros de antes
    // desse recurso existir): mantém o comportamento de sempre — aparecia
    // na Agenda quando o cargo já era um dos que atendiam cliente.
    // Cadastro novo: começa em "Não" (o cargo por si só não decide mais isso).
    var performsServices = e ? (e.performsServices !== undefined ? !!e.performsServices : LEGACY_SERVICE_ROLES.indexOf(e.role) !== -1) : false;
    // Controla se essa pessoa aparece na lista de quem bate ponto (tela
    // Ponto) — quem não estiver marcado aqui simplesmente não vê o próprio
    // nome na lista de bater ponto. Todo cadastro (novo ou já existente)
    // começa em "Não"; é uma opção que precisa ser ligada manualmente.
    var requiresTimeClock = e ? !!e.requiresTimeClock : false;
    // Acesso ao sistema (login) vinculado a este funcionário, se já existir
    // — ver linkedUserFor() acima. photoDataUrl/performsServices/etc. são
    // campos do próprio funcionário; os campos abaixo (em-acc-*) são do
    // registro de Acesso (tabela "users"), sincronizado ao salvar.
    var linkedUser = e ? linkedUserFor(e.id, e.cpf) : null;
    var hasAccess = !!(linkedUser && linkedUser.active);
    var accFullAccess = !linkedUser || !linkedUser.allowedPages || !Array.isArray(linkedUser.allowedPages);
    var body =
      '<div class="flex items-center gap-16 mb-16">' +
        '<div id="em-photo-preview">' + Utils.avatarHtml(e ? e.name : "Novo", photoDataUrl, "avatar-lg") + '</div>' +
        '<div>' +
          '<label class="btn btn-sm btn-outline" style="cursor:pointer;">Escolher Foto<input type="file" id="em-photo-input" accept="image/*" style="display:none;"></label>' +
          ' <button type="button" class="btn btn-sm btn-ghost" id="em-photo-remove"' + (photoDataUrl ? "" : ' style="display:none;"') + '>Remover</button>' +
          '<div class="small text-muted mt-8">Aparece no ícone da Agenda. Opcional.</div>' +
        '</div>' +
      '</div>' +
      '<div class="form-grid">' +
      '<div class="form-field full"><label>Nome Completo</label><input type="text" id="em-name" value="' + (e ? Utils.escapeHtml(e.name) : "") + '"></div>' +
      '<div class="form-field"><label>Cargo</label><select id="em-role">' + roles.map(function (r) { return '<option value="' + Utils.escapeHtml(r.name) + '"' + (e && e.role === r.name ? " selected" : "") + '>' + Utils.escapeHtml(r.name) + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-field"><label>Status</label><select id="em-status"><option value="ativo"' + (e && e.status === "ativo" ? " selected" : "") + '>Ativo</option><option value="inativo"' + (e && e.status === "inativo" ? " selected" : "") + '>Inativo</option></select></div>' +
      '<div class="form-field"><label>Este profissional realiza serviços?</label><select id="em-performs"><option value="1"' + (performsServices ? " selected" : "") + '>Sim</option><option value="0"' + (!performsServices ? " selected" : "") + '>Não</option></select>' +
        '<div class="hint">Só quem tem essa opção em "Sim" ganha uma coluna própria na Visão do Dia da Agenda. Útil para marcar um assistente que também atende sozinho.</div></div>' +
      '<div class="form-field"><label>Bate ponto pelo sistema?</label><select id="em-timeclock"><option value="1"' + (requiresTimeClock ? " selected" : "") + '>Sim</option><option value="0"' + (!requiresTimeClock ? " selected" : "") + '>Não</option></select>' +
        '<div class="hint">Só quem tem essa opção em "Sim" aparece na lista de nomes da tela Ponto.</div></div>' +
      '<div class="form-field"><label>Telefone (com DDD)</label><input type="tel" id="em-phone" placeholder="(11) 98765-4321" value="' + (e ? Utils.escapeHtml(e.phone) : "") + '"></div>' +
      '<div class="form-field"><label>E-mail</label><input type="email" id="em-email" value="' + (e ? Utils.escapeHtml(e.email) : "") + '"></div>' +
      '<div class="form-field"><label>CPF</label><input type="text" id="em-cpf" placeholder="000.000.000-00" value="' + (e && e.cpf ? Utils.fmtCPF(e.cpf) : "") + '"></div>' +
      '<div class="form-field"><label>Data de Admissão</label><input type="date" id="em-hire" value="' + (e ? e.hireDate : Utils.todayISO()) + '"></div>' +
      '<div class="form-field"><label>Aniversário</label><input type="date" id="em-birthday" value="' + (e && e.birthday ? e.birthday : "") + '"></div>' +
      '<div class="form-field"><label>Salário Base (R$)</label><input type="text" id="em-salary"></div>' +
      '<div class="form-field"><label>Comissão (%)</label><input type="number" step="0.1" id="em-comm" value="' + (e ? e.commissionRate : 0) + '"></div>' +
      '</div>' +
      '<div class="small text-muted mt-8">O CPF é usado, entre outras coisas, para restringir automaticamente o Extrato do Profissional — a pessoa que fizer login com esse CPF só enxerga a própria comissão lá.</div>' +
      '<div class="divider"></div>' +
      '<h4 style="margin:0 0 4px;">Acesso ao Sistema</h4>' +
      '<div class="form-field"><label>Este funcionário tem acesso ao sistema (login)?</label>' +
        '<select id="em-has-access"><option value="1"' + (hasAccess ? " selected" : "") + '>Sim</option><option value="0"' + (!hasAccess ? " selected" : "") + '>Não</option></select>' +
        '<div class="hint">O login é feito com o CPF informado acima' + (linkedUser && !hasAccess ? " — este funcionário já teve um acesso, que está desativado; ligar aqui reativa o mesmo acesso, sem perder o histórico dele" : "") + '.</div></div>' +
      '<div id="em-access-fields" style="display:' + (hasAccess ? "" : "none") + ';">' +
        '<div class="form-grid">' +
        '<div class="form-field"><label>Perfil de acesso</label><select id="em-acc-role">' + ACCESS_ROLE_OPTIONS.map(function (r) { return '<option value="' + r + '"' + (linkedUser && linkedUser.role === r ? " selected" : "") + '>' + r + '</option>'; }).join("") + '</select></div>' +
        '<div class="form-field"><label>Senha' + (linkedUser ? " (deixe em branco para manter)" : "") + '</label><input type="password" id="em-acc-pass" inputmode="numeric" placeholder="mín. 6 dígitos, só números" autocomplete="new-password"></div>' +
        '</div>' +
        '<label class="flex items-center gap-8 mb-8 mt-8"><input type="checkbox" id="em-acc-full"' + (accFullAccess ? " checked" : "") + '> <span><strong>Acesso total</strong> — pode abrir todas as telas do sistema, inclusive as que forem criadas mais adiante</span></label>' +
        '<label class="flex items-center gap-8 mb-8"><input type="checkbox" id="em-acc-approve"' + (linkedUser && linkedUser.canApprove ? " checked" : "") + '> <span><strong>Pode aprovar solicitações</strong> — aparece com os botões de aprovar/recusar na aba Aprovações de Configurações</span></label>' +
        '<div id="em-acc-checklist" class="form-grid"></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="em-save">Salvar Funcionário</button>';
    var box = Modal.open({ title: e ? "Editar Funcionário" : "Novo Funcionário", wide: true, bodyHtml: body, footHtml: foot });
    Utils.wirePhoneMask(box.querySelector("#em-phone"));
    Utils.wireMoneyMask(box.querySelector("#em-salary"), e ? e.baseSalary : 0);
    box.querySelector("#em-acc-pass").addEventListener("input", function (ev) {
      ev.target.value = Utils.onlyDigits(ev.target.value).slice(0, 20);
    });

    // Checklist de telas liberadas para o acesso deste funcionário — mesmo
    // padrão de Configurações → Permissões (ver renderPermsForUser em
    // configuracoes.js): "Acesso total" marcado desabilita e marca tudo;
    // desmarcado, o administrador escolhe manualmente.
    var accChecklist = box.querySelector("#em-acc-checklist");
    accChecklist.innerHTML = permPageItems().map(function (it) {
      var checked = accFullAccess || (linkedUser && Array.isArray(linkedUser.allowedPages) && linkedUser.allowedPages.indexOf(it.href) !== -1);
      return '<label class="flex items-center gap-8">' +
        '<input type="checkbox" class="em-acc-item-cb" value="' + it.href + '"' + (checked ? " checked" : "") + (accFullAccess ? " disabled" : "") + '>' +
        '<span><i class="fa-solid ' + it.icon + '"></i> ' + Utils.escapeHtml(it.label) + '</span>' +
        '</label>';
    }).join("");
    box.querySelector("#em-acc-full").addEventListener("change", function (ev) {
      Utils.qsa(".em-acc-item-cb", accChecklist).forEach(function (cb) { cb.disabled = ev.target.checked; cb.checked = ev.target.checked; });
    });
    box.querySelector("#em-has-access").addEventListener("change", function (ev) {
      box.querySelector("#em-access-fields").style.display = ev.target.value === "1" ? "" : "none";
    });

    box.querySelector("#em-photo-input").addEventListener("change", function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      Utils.fileToAvatarDataUrl(file, 160, function (dataUrl) {
        if (!dataUrl) { Toast.show("Não foi possível carregar essa imagem", "danger"); return; }
        photoDataUrl = dataUrl;
        box.querySelector("#em-photo-preview").innerHTML = Utils.avatarHtml(box.querySelector("#em-name").value || "?", photoDataUrl, "avatar-lg");
        box.querySelector("#em-photo-remove").style.display = "";
      });
    });
    box.querySelector("#em-photo-remove").addEventListener("click", function () {
      photoDataUrl = null;
      box.querySelector("#em-photo-preview").innerHTML = Utils.avatarHtml(box.querySelector("#em-name").value || "?", null, "avatar-lg");
      box.querySelector("#em-photo-remove").style.display = "none";
    });

    box.querySelector("#em-save").addEventListener("click", function () {
      var name = box.querySelector("#em-name").value.trim();
      if (!name) { Toast.show("Informe o nome do funcionário", "danger"); return; }
      var cpfRaw = box.querySelector("#em-cpf").value.trim();
      var cpfDigits = cpfRaw ? Utils.onlyDigits(cpfRaw) : "";
      if (cpfDigits && !Utils.isValidCPF(cpfDigits)) { Toast.show("CPF inválido — confira os números digitados", "danger"); return; }
      var empPhone = box.querySelector("#em-phone").value.trim();
      if (!empPhone) { Toast.show("Informe o telefone do funcionário, com DDD", "danger"); return; }
      if (!Utils.isValidPhoneBR(empPhone)) { Toast.show("Telefone inválido — informe com DDD (ex.: (11) 98765-4321)", "danger"); return; }

      // Acesso ao sistema (login) — validado antes de gravar qualquer coisa,
      // pra não deixar o funcionário salvo com um acesso pela metade.
      var hasAccessVal = box.querySelector("#em-has-access").value === "1";
      var accPass = box.querySelector("#em-acc-pass").value;
      var accRole = box.querySelector("#em-acc-role").value;
      var accFullCb = box.querySelector("#em-acc-full");
      var accCanApprove = box.querySelector("#em-acc-approve").checked;
      var accAllowedPages = accFullCb.checked ? null : Utils.qsa(".em-acc-item-cb", box).filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
      if (hasAccessVal) {
        if (!cpfDigits) { Toast.show("Para dar acesso ao sistema, informe o CPF do funcionário (login é feito com ele)", "danger"); return; }
        if (!linkedUser && !accPass) { Toast.show("Informe uma senha para o acesso deste funcionário", "danger"); return; }
        if (accPass && !Utils.isValidPassword(accPass)) { Toast.show("A senha do acesso deve ter no mínimo 6 dígitos, apenas números", "danger"); return; }
        var dupCpf = DB.findOne("users", function (x) { return x.cpf === cpfDigits && (!linkedUser || x.id !== linkedUser.id); });
        if (dupCpf) { Toast.show("Já existe um outro acesso cadastrado com este CPF", "danger"); return; }
        if (accAllowedPages && accAllowedPages.indexOf("configuracoes.html") === -1) {
          var someoneElseHasConfig = DB.all("users").some(function (other) {
            if (linkedUser && other.id === linkedUser.id) return false;
            if (!other.active) return false;
            var oa = other.allowedPages;
            return !oa || !Array.isArray(oa) || oa.indexOf("configuracoes.html") !== -1;
          });
          if (!someoneElseHasConfig) { Toast.show("Não é possível salvar: nenhum outro acesso ativo ficaria com acesso a Configurações.", "danger"); return; }
        }
      }

      var patch = {
        name: name, role: box.querySelector("#em-role").value, status: box.querySelector("#em-status").value,
        phone: empPhone, email: box.querySelector("#em-email").value.trim(),
        cpf: cpfDigits || null,
        hireDate: box.querySelector("#em-hire").value, birthday: box.querySelector("#em-birthday").value || null,
        baseSalary: Utils.moneyMaskToFloat(box.querySelector("#em-salary")),
        commissionRate: parseFloat(box.querySelector("#em-comm").value) || 0,
        performsServices: box.querySelector("#em-performs").value === "1",
        requiresTimeClock: box.querySelector("#em-timeclock").value === "1",
        photoDataUrl: photoDataUrl
      };
      var savedEmp;
      if (e) { DB.update("employees", e.id, patch); savedEmp = DB.get("employees", e.id); DB.log("Funcionário", "Atualizou o funcionário " + name); Toast.show("Funcionário atualizado", "success"); }
      else { savedEmp = DB.insert("employees", patch); DB.log("Funcionário", "Cadastrou o funcionário " + name); Toast.show("Funcionário cadastrado", "success"); }

      // Sincroniza o acesso ao sistema (tabela "users") a partir do que foi
      // decidido acima em "Acesso ao Sistema": cria na primeira vez, atualiza
      // se já existir, ou só desativa (nunca apaga) se foi desligado aqui —
      // assim o histórico/log desse acesso não se perde.
      var nameParts = splitName(name);
      if (hasAccessVal) {
        var accessPatch = {
          cpf: cpfDigits, firstName: nameParts.first, lastName: nameParts.last, role: accRole,
          active: true, phone: empPhone, allowedPages: accAllowedPages, canApprove: accCanApprove,
          employeeId: savedEmp.id
        };
        if (accPass) accessPatch.password = accPass;
        if (linkedUser) {
          DB.update("users", linkedUser.id, accessPatch);
          DB.log("Acesso", "Atualizou o acesso de " + name + " (pelo cadastro de Funcionário)");
        } else {
          accessPatch.password = accPass;
          DB.insert("users", accessPatch);
          DB.log("Acesso", "Criou o acesso de " + name + " (" + accRole + ", pelo cadastro de Funcionário)");
        }
        var currentUsr = window.CurrentUser ? window.CurrentUser.get() : null;
        if (linkedUser && currentUsr && currentUsr.id === linkedUser.id && accAllowedPages && accAllowedPages.indexOf("configuracoes.html") === -1) {
          Toast.show("Você removeu seu próprio acesso a esta tela — passará a valer na próxima vez que você abrir o sistema.", "info", 5000);
        }
      } else if (linkedUser && linkedUser.active) {
        DB.update("users", linkedUser.id, { active: false });
        DB.log("Acesso", "Desativou o acesso de " + name + " (pelo cadastro de Funcionário)");
      }

      Modal.close();
      render();
    });
  }
})();
