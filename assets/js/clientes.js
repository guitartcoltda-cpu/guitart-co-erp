(function () {
  "use strict";

  var filt = { tag: "", search: "" };
  var page = 1, PAGE_SIZE = 20;

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    var tags = {};
    DB.all("clients").forEach(function (c) { (c.tags || []).forEach(function (t) { tags[t] = true; }); });
    var tagSel = Utils.qs("#c-tag");
    Object.keys(tags).sort().forEach(function (t) { var o = document.createElement("option"); o.value = t; o.textContent = t; tagSel.appendChild(o); });
    tagSel.addEventListener("change", function (e) { filt.tag = e.target.value; page = 1; render(); });
    Utils.qs("#c-search").addEventListener("input", Utils.debounce(function (e) { filt.search = e.target.value.toLowerCase(); page = 1; render(); }, 200));
    Utils.qs("#btn-new-client").addEventListener("click", function () { openClientModal(null); });
    render();
  }

  function clientSpend(clientId) {
    return DB.all("transactions").filter(function (t) { return t.clientId === clientId && t.type === "receita"; })
      .reduce(function (s, t) { return s + t.amount; }, 0);
  }
  function lastVisit(clientId) {
    var appts = DB.all("appointments").filter(function (a) { return a.clientId === clientId && a.status === "concluido"; });
    if (!appts.length) return null;
    return appts.reduce(function (max, a) { return a.date > max ? a.date : max; }, appts[0].date);
  }

  function getClients() {
    return DB.all("clients").filter(function (c) {
      if (filt.tag && (c.tags || []).indexOf(filt.tag) === -1) return false;
      if (filt.search) {
        var hay = (c.name + " " + c.phone + " " + c.email).toLowerCase();
        if (hay.indexOf(filt.search) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function render() {
    var clients = getClients();
    var all = DB.all("clients");
    var today = Utils.todayISO();
    var mk = Utils.monthKey(today);
    var novosNoMes = all.filter(function (c) { return Utils.monthKey(c.firstVisit) === mk; }).length;
    var totalSpendAll = all.reduce(function (s, c) { return s + clientSpend(c.id); }, 0);
    var ticketMedio = all.length ? totalSpendAll / all.length : 0;
    var curMonthNum = Utils.parseDate(today).getMonth() + 1;
    var aniversariantes = all.filter(function (c) { return c.birthday && parseInt(c.birthday.split("-")[1], 10) === curMonthNum; }).length;

    document.getElementById("cli-summary").innerHTML = [
      kpi("Total de Clientes", String(all.length), "fa-users", "#2a78d6", "#e3eefb"),
      kpi("Novos no Mês", String(novosNoMes), "fa-user-plus", "#1baf7a", "#e2f5ec"),
      kpi("Gasto Médio (histórico)", Utils.fmtMoney(ticketMedio), "fa-sack-dollar", "#b8923f", "#f6ecd3"),
      kpi("Aniversariantes do Mês", String(aniversariantes), "fa-cake-candles", "#e87ba4", "#fbe9f0", "kpi-bday")
    ].join("");
    var bdayCard = document.getElementById("kpi-bday");
    if (bdayCard && window.Aniversarios) {
      bdayCard.classList.add("kpi-card-clickable");
      bdayCard.title = "Ver calendário de aniversariantes";
      bdayCard.addEventListener("click", function () { Aniversarios.openModal(); });
    }

    var totalPages = Math.max(1, Math.ceil(clients.length / PAGE_SIZE));
    page = Math.min(page, totalPages);
    var pageItems = clients.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    var tbl = document.getElementById("tbl-clients");
    if (!pageItems.length) {
      Utils.emptyTable(tbl, "fa-address-card", "Nenhum cliente encontrado");
    } else {
      tbl.innerHTML = '<thead><tr><th>Cliente</th><th>Contato</th><th>Primeira Visita</th><th>Última Visita</th><th class="text-right">Total Gasto</th><th>Tags</th><th></th></tr></thead><tbody>' +
        pageItems.map(function (c) {
          var lv = lastVisit(c.id);
          return '<tr>' +
            '<td><div class="flex items-center gap-8"><div class="avatar">' + Utils.initials(c.name) + '</div><span class="font-bold pointer" data-view="' + c.id + '">' + Utils.escapeHtml(c.name) + '</span></div></td>' +
            '<td class="small">' + Utils.escapeHtml(c.phone) + '<br><span class="text-muted">' + Utils.escapeHtml(c.email) + '</span></td>' +
            '<td class="text-num">' + Utils.fmtDate(c.firstVisit) + '</td>' +
            '<td class="text-num">' + (lv ? Utils.fmtDate(lv) : '<span class="text-muted">-</span>') + '</td>' +
            '<td class="text-right text-num font-bold">' + Utils.fmtMoney(clientSpend(c.id)) + '</td>' +
            '<td><div class="chip-list">' + (c.tags || []).map(function (t) { return '<span class="chip">' + Utils.escapeHtml(t) + '</span>'; }).join("") + '</div></td>' +
            '<td><div class="flex gap-6">' +
              '<button class="btn btn-icon btn-ghost" data-view="' + c.id + '" title="Histórico"><i class="fa-solid fa-clock-rotate-left"></i></button>' +
              '<button class="btn btn-icon btn-ghost" data-edit="' + c.id + '" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
              '<button class="btn btn-icon btn-ghost" data-del="' + c.id + '" title="Excluir"><i class="fa-solid fa-trash"></i></button>' +
            '</div></td></tr>';
        }).join("") + '</tbody>';

      Utils.qsa("[data-view]", tbl).forEach(function (b) { b.addEventListener("click", function () { openHistoryModal(b.getAttribute("data-view")); }); });
      Utils.qsa("[data-edit]", tbl).forEach(function (b) { b.addEventListener("click", function () { openClientModal(b.getAttribute("data-edit")); }); });
      Utils.qsa("[data-del]", tbl).forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-del");
          Modal.confirm({
            title: "Excluir cliente", message: "Tem certeza que deseja excluir este cliente?", danger: true,
            onConfirm: function () {
              var cl = DB.get("clients", id);
              DB.remove("clients", id);
              if (cl) DB.log("Cliente", "Excluiu o cliente " + cl.name);
              Toast.show("Cliente excluído", "success"); render();
            }
          });
        });
      });
    }

    var pag = document.getElementById("clients-pagination");
    pag.innerHTML = '<div>Mostrando ' + pageItems.length + ' de ' + clients.length + '</div>' +
      '<div class="pg-btns"><button class="btn btn-sm btn-secondary" id="cl-prev" ' + (page <= 1 ? "disabled" : "") + '>Anterior</button>' +
      '<span style="padding:6px 10px;">Página ' + page + ' de ' + totalPages + '</span>' +
      '<button class="btn btn-sm btn-secondary" id="cl-next" ' + (page >= totalPages ? "disabled" : "") + '>Próxima</button></div>';
    var pv = document.getElementById("cl-prev"), nx = document.getElementById("cl-next");
    if (pv) pv.addEventListener("click", function () { page--; render(); });
    if (nx) nx.addEventListener("click", function () { page++; render(); });
  }

  function kpi(label, value, icon, color, bg, id) {
    return '<div class="kpi-card"' + (id ? ' id="' + id + '"' : '') + '><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }

  function openHistoryModal(clientId) {
    var c = DB.get("clients", clientId);
    if (!c) return;
    var services = DB.all("services"), employees = DB.all("employees");
    var appts = DB.all("appointments").filter(function (a) { return a.clientId === clientId; }).sort(function (a, b) { return b.date.localeCompare(a.date); });
    var totalGasto = clientSpend(clientId);

    var body = '<div class="grid-2" style="grid-template-columns:1fr 1fr;margin-bottom:16px;">' +
      '<div><div class="small text-muted">Telefone</div><div class="font-bold">' + Utils.escapeHtml(c.phone) + '</div></div>' +
      '<div><div class="small text-muted">E-mail</div><div class="font-bold">' + Utils.escapeHtml(c.email) + '</div></div>' +
      '<div><div class="small text-muted">Aniversário</div><div class="font-bold">' + (c.birthday ? Utils.fmtDate(c.birthday) : "-") + '</div></div>' +
      '<div><div class="small text-muted">Total Gasto</div><div class="font-bold">' + Utils.fmtMoney(totalGasto) + '</div></div>' +
      '</div><div class="divider"></div>' +
      '<h4 class="mb-16">Histórico de Atendimentos (' + appts.length + ')</h4>' +
      (appts.length ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Serviço</th><th>Profissional</th><th>Status</th><th class="text-right">Valor</th></tr></thead><tbody>' +
        appts.map(function (a) {
          var s = services.find(function (x) { return x.id === a.serviceId; });
          var e = employees.find(function (x) { return x.id === a.employeeId; });
          var asst = a.assistantId ? employees.find(function (x) { return x.id === a.assistantId; }) : null;
          var statusBadge = a.status === "concluido" ? '<span class="badge badge-success">Concluído</span>' : a.status === "agendado" ? '<span class="badge badge-info">Agendado</span>' : '<span class="badge badge-danger">Cancelado</span>';
          var profCell = Utils.escapeHtml(e ? e.name : "-") + (asst ? '<br><span class="small text-muted">com assistente: ' + Utils.escapeHtml(asst.name) + '</span>' : '');
          return '<tr><td class="text-num">' + Utils.fmtDate(a.date) + ' ' + a.time + '</td><td>' + Utils.escapeHtml(s ? s.name : "-") + '</td><td>' + profCell + '</td><td>' + statusBadge + '</td><td class="text-right text-num">' + Utils.fmtMoney(a.price) + '</td></tr>';
        }).join("") + '</tbody></table></div>' : '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-calendar"></i></div><h4>Sem atendimentos registrados</h4></div>');

    Modal.open({ title: "Histórico — " + c.name, bodyHtml: body, wide: true, footHtml: '<button class="btn btn-secondary" data-close-modal>Fechar</button>' });
  }

  function openClientModal(id) {
    var c = id ? DB.get("clients", id) : null;
    var showImport = !c && window.ClientesQuick && ClientesQuick.contactPickerSupported();
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Nome Completo</label><input type="text" id="cm-name" value="' + (c ? Utils.escapeHtml(c.name) : "") + '"></div>' +
      '<div class="form-field"><label>Telefone (com DDD)</label><input type="tel" id="cm-phone" placeholder="(11) 98765-4321" value="' + (c ? Utils.escapeHtml(c.phone) : "") + '"></div>' +
      '<div class="form-field"><label>E-mail</label><input type="email" id="cm-email" value="' + (c ? Utils.escapeHtml(c.email) : "") + '"></div>' +
      '<div class="form-field"><label>Aniversário</label><input type="date" id="cm-birthday" value="' + (c ? c.birthday : "") + '"></div>' +
      '<div class="form-field"><label>Primeira Visita</label><input type="date" id="cm-first" value="' + (c ? c.firstVisit : Utils.todayISO()) + '"></div>' +
      '<div class="form-field full"><label>Tags (separe por vírgula)</label><input type="text" id="cm-tags" value="' + (c ? c.tags.join(", ") : "") + '"></div>' +
      '<div class="form-field full"><label>Observações</label><textarea id="cm-notes">' + (c ? Utils.escapeHtml(c.notes || "") : "") + '</textarea></div>' +
      '</div>' +
      (showImport ? '<div class="mt-8">' + ClientesQuick.importButtonHtml("cm-import-contact") + '</div>' : "");
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cm-save">Salvar Cliente</button>';
    var box = Modal.open({ title: c ? "Editar Cliente" : "Novo Cliente", bodyHtml: body, footHtml: foot });
    Utils.wirePhoneMask(box.querySelector("#cm-phone"));
    if (showImport) ClientesQuick.wireImportButton(box, "cm-import-contact", box.querySelector("#cm-name"), box.querySelector("#cm-phone"));
    box.querySelector("#cm-save").addEventListener("click", function () {
      var name = box.querySelector("#cm-name").value.trim();
      if (!name) { Toast.show("Informe o nome do cliente", "danger"); return; }
      var phone = box.querySelector("#cm-phone").value.trim();
      if (!phone) { Toast.show("Informe o telefone do cliente, com DDD", "danger"); return; }
      if (!Utils.isValidPhoneBR(phone)) { Toast.show("Telefone inválido — informe com DDD (ex.: (11) 98765-4321)", "danger"); return; }
      var patch = {
        name: name, phone: phone, email: box.querySelector("#cm-email").value.trim(),
        birthday: box.querySelector("#cm-birthday").value, firstVisit: box.querySelector("#cm-first").value,
        tags: box.querySelector("#cm-tags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
        notes: box.querySelector("#cm-notes").value.trim()
      };
      if (c) { DB.update("clients", c.id, patch); DB.log("Cliente", "Atualizou o cliente " + name); Toast.show("Cliente atualizado", "success"); }
      else { DB.insert("clients", patch); DB.log("Cliente", "Cadastrou o cliente " + name); Toast.show("Cliente cadastrado", "success"); }
      Modal.close();
      render();
    });
  }
})();
