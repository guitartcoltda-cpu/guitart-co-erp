(function () {
  "use strict";

  var filt = { role: "", status: "", search: "" };

  // Cargos que sempre contaram como "realiza serviços" antes desse campo
  // existir no funcionário — usado só para sugerir o valor padrão do campo
  // "Realiza serviços" ao editar alguém já cadastrado antes desse recurso
  // (ver openEmpModal). Mesma lista usada em agenda.js (LEGACY_SERVICE_ROLES).
  var LEGACY_SERVICE_ROLES = ["Cabeleireiro(a)", "Manicure e Pedicure", "Esteticista", "Maquiador(a)"];

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

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
    tbl.innerHTML = '<thead><tr><th>Funcionário</th><th>Cargo</th><th>Contato</th><th>Admissão</th><th class="text-right">Salário Base</th><th class="text-right">Comissão</th><th>Status</th><th></th></tr></thead><tbody>' +
      employees.map(function (e) {
        return '<tr>' +
          '<td><div class="flex items-center gap-8">' + Utils.avatarHtml(e.name, e.photoDataUrl) + '<span class="font-bold">' + Utils.escapeHtml(e.name) + '</span></div></td>' +
          '<td>' + Utils.escapeHtml(e.role) + '</td>' +
          '<td class="small">' + Utils.escapeHtml(e.phone) + '<br><span class="text-muted">' + Utils.escapeHtml(e.email) + '</span></td>' +
          '<td class="text-num">' + Utils.fmtDate(e.hireDate) + '</td>' +
          '<td class="text-right text-num">' + (e.baseSalary ? Utils.fmtMoney(e.baseSalary) : '<span class="text-muted">-</span>') + '</td>' +
          '<td class="text-right text-num">' + (e.commissionRate ? e.commissionRate + "%" : '<span class="text-muted">-</span>') + '</td>' +
          '<td>' + (e.status === "ativo" ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>') + '</td>' +
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
      '<div class="form-field"><label>Telefone (com DDD)</label><input type="tel" id="em-phone" placeholder="(11) 98765-4321" value="' + (e ? Utils.escapeHtml(e.phone) : "") + '"></div>' +
      '<div class="form-field"><label>E-mail</label><input type="email" id="em-email" value="' + (e ? Utils.escapeHtml(e.email) : "") + '"></div>' +
      '<div class="form-field"><label>CPF</label><input type="text" id="em-cpf" placeholder="000.000.000-00" value="' + (e && e.cpf ? Utils.fmtCPF(e.cpf) : "") + '"></div>' +
      '<div class="form-field"><label>Data de Admissão</label><input type="date" id="em-hire" value="' + (e ? e.hireDate : Utils.todayISO()) + '"></div>' +
      '<div class="form-field"><label>Aniversário</label><input type="date" id="em-birthday" value="' + (e && e.birthday ? e.birthday : "") + '"></div>' +
      '<div class="form-field"><label>Salário Base (R$)</label><input type="number" step="0.01" id="em-salary" value="' + (e ? e.baseSalary : 0) + '"></div>' +
      '<div class="form-field"><label>Comissão (%)</label><input type="number" step="0.1" id="em-comm" value="' + (e ? e.commissionRate : 0) + '"></div>' +
      '</div>' +
      '<div class="small text-muted mt-8">O CPF é usado, entre outras coisas, para restringir automaticamente o Extrato do Profissional — a pessoa que fizer login com esse CPF só enxerga a própria comissão lá.</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="em-save">Salvar Funcionário</button>';
    var box = Modal.open({ title: e ? "Editar Funcionário" : "Novo Funcionário", wide: true, bodyHtml: body, footHtml: foot });
    Utils.wirePhoneMask(box.querySelector("#em-phone"));

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
      var patch = {
        name: name, role: box.querySelector("#em-role").value, status: box.querySelector("#em-status").value,
        phone: empPhone, email: box.querySelector("#em-email").value.trim(),
        cpf: cpfDigits || null,
        hireDate: box.querySelector("#em-hire").value, birthday: box.querySelector("#em-birthday").value || null,
        baseSalary: parseFloat(box.querySelector("#em-salary").value) || 0,
        commissionRate: parseFloat(box.querySelector("#em-comm").value) || 0,
        performsServices: box.querySelector("#em-performs").value === "1",
        photoDataUrl: photoDataUrl
      };
      if (e) { DB.update("employees", e.id, patch); DB.log("Funcionário", "Atualizou o funcionário " + name); Toast.show("Funcionário atualizado", "success"); }
      else { DB.insert("employees", patch); DB.log("Funcionário", "Cadastrou o funcionário " + name); Toast.show("Funcionário cadastrado", "success"); }
      Modal.close();
      render();
    });
  }
})();
