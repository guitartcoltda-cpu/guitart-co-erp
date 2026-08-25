/* ============================================================
   Salão ERP — Extrato do Profissional
   Tela voltada ao próprio profissional acompanhar quanto está
   ganhando em comissão por serviço realizado, quando fecha o
   corte do mês e quando cai o próximo repasse.
   ============================================================ */
(function () {
  "use strict";

  // Regra de negócio do salão: o corte da comissão fecha no último dia do
  // mês de referência, e o repasse (pagamento) é feito no dia 5 do mês
  // seguinte. Ajustável aqui caso a política do salão mude.
  var PAYOUT_DAY = 5;

  var selectedEmployeeId = "";
  var selectedMonth = "";

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  // Se o CPF do usuário logado corresponder ao CPF de um funcionário
  // cadastrado, essa é a única tela em que o acesso é travado automaticamente
  // nesse profissional (diferente da permissão manual por tela em
  // Configurações → Permissões) — ninguém deve conseguir ver a comissão de
  // outra pessoa aqui, mesmo que a tela esteja liberada para ele. Quem não
  // corresponde a nenhum funcionário (o Administrador padrão, por exemplo)
  // continua vendo o seletor completo, como antes.
  function findRestrictedEmployee() {
    var session = window.CurrentUser ? CurrentUser.get() : null;
    if (!session) return null;
    var dbUser = DB.get("users", session.id);
    if (!dbUser || !dbUser.cpf) return null;
    return DB.findOne("employees", function (e) { return e.cpf && e.cpf === dbUser.cpf; });
  }

  function init() {
    var restricted = findRestrictedEmployee();
    var employees = DB.all("employees").filter(function (e) { return e.commissionRate > 0 && e.status === "ativo"; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    var empSel = Utils.qs("#ec-employee");
    var empWrap = empSel.closest(".form-field") || empSel.parentElement;

    if (restricted) {
      // trava na própria pessoa: nem mostra as outras opções no <select>
      empSel.innerHTML = '<option value="' + restricted.id + '">' + Utils.escapeHtml(restricted.name) + ' — ' + Utils.escapeHtml(restricted.role) + '</option>';
      empSel.disabled = true;
      selectedEmployeeId = restricted.id;
      if (empWrap) {
        var note = document.createElement("div");
        note.className = "small text-muted mt-8";
        note.textContent = "Acesso restrito ao seu próprio extrato.";
        empWrap.appendChild(note);
      }
    } else {
      employees.forEach(function (e) {
        var o = document.createElement("option"); o.value = e.id; o.textContent = e.name + " — " + e.role; empSel.appendChild(o);
      });
      selectedEmployeeId = employees.length ? employees[0].id : "";
      empSel.value = selectedEmployeeId;
      empSel.addEventListener("change", function (e) { selectedEmployeeId = e.target.value; render(); });
    }

    var today = Utils.todayISO();
    var monthSel = Utils.qs("#ec-month");
    var months = [];
    for (var i = 0; i < 10; i++) months.push(Utils.monthKey(Utils.addMonths(today, -i)));
    months.forEach(function (m, idx) {
      var o = document.createElement("option");
      o.value = m; o.textContent = Utils.monthLabel(m + "-01") + (idx === 0 ? " (atual)" : "");
      monthSel.appendChild(o);
    });
    selectedMonth = months[0];
    monthSel.value = selectedMonth;
    monthSel.addEventListener("change", function (e) { selectedMonth = e.target.value; render(); });

    if (!restricted && !employees.length) {
      Utils.qs("#ec-summary").innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-face-frown"></i></div><h4>Nenhum profissional comissionado cadastrado</h4></div>';
      return;
    }
    render();
  }

  var _commCatId = null;
  function commissionCatId() {
    if (_commCatId) return _commCatId;
    var c = DB.findOne("categories", function (x) { return x.name === "Comissões"; });
    _commCatId = c ? c.id : null;
    return _commCatId;
  }

  function lastDayOfMonth(monthKey) {
    var y = parseInt(monthKey.slice(0, 4), 10), m = parseInt(monthKey.slice(5, 7), 10);
    var d = new Date(y, m, 0); // dia 0 do mês seguinte = último dia deste mês
    return Utils.toISODate(d);
  }

  function payoutDateFor(monthKey) {
    var nextMonthFirst = Utils.addMonths(monthKey + "-01", 1);
    return nextMonthFirst.slice(0, 8) + String(PAYOUT_DAY).padStart(2, "0");
  }

  function computeForEmployee(employeeId, monthKey) {
    var e = DB.get("employees", employeeId);
    if (!e) return null;
    var employeesAll = DB.all("employees");
    var appointments = DB.all("appointments").filter(function (a) {
      return a.employeeId === employeeId && a.status === "concluido" && Utils.monthKey(a.date) === monthKey;
    }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });
    var appointmentsAsAssistant = DB.all("appointments").filter(function (a) {
      return a.assistantId === employeeId && a.status === "concluido" && Utils.monthKey(a.date) === monthKey;
    }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });
    var services = DB.all("services"), clients = DB.all("clients");
    var serviceRevenue = sum(appointments.map(function (a) { return a.price; }));
    var mainCommissionTotal = 0;
    appointments.forEach(function (a) { mainCommissionTotal += Utils.apptCommissionSplit(a, e).mainCommission; });
    mainCommissionTotal = round2(mainCommissionTotal);
    var assistantCommissionTotal = 0;
    appointmentsAsAssistant.forEach(function (a) {
      var mainEmp = employeesAll.find(function (x) { return x.id === a.employeeId; });
      assistantCommissionTotal += Utils.apptCommissionSplit(a, mainEmp).assistantCommission;
    });
    assistantCommissionTotal = round2(assistantCommissionTotal);
    var baseComissao = round2(mainCommissionTotal + assistantCommissionTotal);
    var bonuses = DB.all("commissionBonuses").filter(function (b) { return b.employeeId === employeeId && b.month === monthKey; });
    var bonusTotal = round2(sum(bonuses.map(function (b) { return b.amount; })));
    var consumo = (window.Consumo ? Consumo.deductionFor(employeeId, monthKey) : { total: 0, items: [] });
    var devido = round2(baseComissao + bonusTotal - consumo.total);
    var pago = sum(DB.all("transactions").filter(function (t) {
      return t.type === "despesa" && t.employeeId === employeeId && t.categoryId === commissionCatId() && t.relatedMonth === monthKey;
    }).map(function (t) { return t.amount; }));
    var byService = {};
    appointments.forEach(function (a) {
      var s = services.find(function (x) { return x.id === a.serviceId; });
      var key = s ? s.name : "Outro";
      byService[key] = (byService[key] || 0) + Utils.apptCommissionSplit(a, e).mainCommission;
    });
    return {
      employee: e, appointments: appointments, appointmentsAsAssistant: appointmentsAsAssistant, services: services, clients: clients, employeesAll: employeesAll,
      serviceRevenue: serviceRevenue, baseComissao: baseComissao, mainCommissionTotal: mainCommissionTotal, assistantCommissionTotal: assistantCommissionTotal,
      bonuses: bonuses, bonusTotal: bonusTotal, consumoTotal: consumo.total, consumoItems: consumo.items,
      devido: devido, pago: pago, saldo: round2(devido - pago), byService: byService
    };
  }

  function render() {
    var data = computeForEmployee(selectedEmployeeId, selectedMonth);
    if (!data) return;
    var e = data.employee;

    var kpis = [
      kpi("Comissão do Mês", Utils.fmtMoney(data.devido), "fa-sack-dollar", "#2a78d6", "#e3eefb"),
      kpi("Já Recebido", Utils.fmtMoney(data.pago), "fa-circle-check", "#1baf7a", "#e2f5ec"),
      kpi("Saldo em Aberto", Utils.fmtMoney(Math.max(0, data.saldo)), "fa-hourglass-half", "#b7791f", "#fdf2df"),
      kpi("Atendimentos no Mês", String(data.appointments.length), "fa-scissors", "#4a3aa7", "#ece8f8")
    ];
    if (data.consumoTotal > 0) {
      kpis.push(kpi("Desconto por Consumo", "- " + Utils.fmtMoney(data.consumoTotal), "fa-flask", "#c23b3b", "#fbe6e6"));
    }
    document.getElementById("ec-summary").innerHTML = kpis.join("");

    // corte / repasse
    var cutoffDate = lastDayOfMonth(selectedMonth);
    var payoutDate = payoutDateFor(selectedMonth);
    var today = Utils.todayISO();
    var daysToCutoff = Utils.daysBetween(today, cutoffDate);
    var daysToPayout = Utils.daysBetween(today, payoutDate);
    document.getElementById("ec-payout").innerHTML =
      payoutItem("Corte do Mês", Utils.fmtDate(cutoffDate), cutoffLabel(daysToCutoff)) +
      payoutItem("Próximo Repasse", Utils.fmtDate(payoutDate), payoutLabel(daysToPayout, data.saldo)) +
      payoutItem("Taxa de Comissão", e.commissionRate + "%", "sobre receita de serviços concluídos");

    // chart: commission by service type
    var svcEntries = Object.keys(data.byService).map(function (k) { return { name: k, value: data.byService[k] }; }).sort(function (a, b) { return b.value - a.value; });
    Charts.bar({
      container: document.getElementById("chart-ec-services"),
      categories: svcEntries.map(function (s) { return s.name; }),
      series: [{ name: "Comissão", color: Charts.palette[0], data: svcEntries.map(function (s) { return round2(s.value); }) }],
      height: 240,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem atendimentos concluídos neste mês"
    });

    // history chart (last 6 months incl. selected reference)
    var histMonths = [];
    for (var i = 5; i >= 0; i--) histMonths.push(Utils.monthKey(Utils.addMonths(selectedMonth + "-01", -i)));
    var histDevido = [], histPago = [];
    histMonths.forEach(function (m) {
      var d = computeForEmployee(selectedEmployeeId, m);
      histDevido.push(d ? round2(d.devido) : 0);
      histPago.push(d ? round2(d.pago) : 0);
    });
    Charts.line({
      container: document.getElementById("chart-ec-history"),
      categories: histMonths.map(function (m) { return Utils.monthLabel(m + "-01"); }),
      series: [
        { name: "Devido", color: Charts.palette[0], data: histDevido },
        { name: "Pago", color: Charts.palette[2], data: histPago }
      ],
      height: 260,
      valueFormatter: function (v) { return Utils.fmtMoney(v); }
    });

    // table — a coluna "Produtos" mostra, por atendimento, a metade do
    // profissional no consumo de insumos lançado naquele atendimento
    // específico (Agenda → Concluir Atendimento); consumo lançado manualmente
    // no Estoque sem vínculo com um atendimento não aparece aqui linha a
    // linha, só no total mensal (seção "Desconto por Consumo de Insumos"
    // abaixo e no KPI). A coluna "Comissão" continua sendo a comissão pura
    // do serviço — o desconto de consumo já é subtraído no total do mês.
    var consumoByAppt = {};
    data.consumoItems.forEach(function (c) {
      if (!c.appointmentId) return;
      consumoByAppt[c.appointmentId] = round2((consumoByAppt[c.appointmentId] || 0) + c.employeeShare);
    });
    var tbl = document.getElementById("tbl-ec");
    if (!data.appointments.length) {
      Utils.emptyTable(tbl, "fa-calendar", "Nenhum atendimento concluído neste mês");
    } else {
      var linkedConsumoTotal = 0;
      tbl.innerHTML = '<thead><tr><th>Data/Hora</th><th>Cliente</th><th>Serviço</th><th class="text-right">Valor Cobrado</th><th class="text-right">Produtos</th><th class="text-right">Comissão</th></tr></thead><tbody>' +
        data.appointments.map(function (a) {
          var s = data.services.find(function (x) { return x.id === a.serviceId; });
          var c = data.clients.find(function (x) { return x.id === a.clientId; });
          var commission = Utils.apptCommissionSplit(a, e).mainCommission;
          var apptConsumo = consumoByAppt[a.id] || 0;
          linkedConsumoTotal += apptConsumo;
          return '<tr>' +
            '<td>' + Utils.fmtDate(a.date) + ' · ' + a.time + '</td>' +
            '<td>' + Utils.escapeHtml(c ? c.name : "-") + '</td>' +
            '<td>' + Utils.escapeHtml(s ? s.name : "-") + (a.assistantId ? ' <span class="small text-muted">(com assistente)</span>' : '') + '</td>' +
            '<td class="text-right text-num">' + Utils.fmtMoney(a.price) + '</td>' +
            '<td class="text-right text-num' + (apptConsumo > 0 ? ' text-danger' : ' text-muted') + '">' + (apptConsumo > 0 ? "- " + Utils.fmtMoney(apptConsumo) : "-") + '</td>' +
            '<td class="text-right text-num font-bold">' + Utils.fmtMoney(commission) + '</td>' +
            '</tr>';
        }).join("") + '</tbody>' +
        '<tfoot><tr style="border-top:2px solid var(--border-color);font-weight:800;background:var(--gray-50);">' +
          '<td colspan="3">Total (' + data.appointments.length + ' atendimento' + (data.appointments.length === 1 ? "" : "s") + ')</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(data.serviceRevenue) + '</td>' +
          '<td class="text-right text-num' + (linkedConsumoTotal > 0 ? ' text-danger' : '') + '">' + (linkedConsumoTotal > 0 ? "- " + Utils.fmtMoney(round2(linkedConsumoTotal)) : "-") + '</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(data.mainCommissionTotal) + '</td>' +
        '</tr></tfoot>';
    }

    // atendimentos em que o profissional atuou como assistente de outro
    var asstEl = document.getElementById("ec-assistant");
    if (asstEl) {
      if (!data.appointmentsAsAssistant.length) {
        asstEl.innerHTML = '';
        asstEl.style.display = "none";
      } else {
        asstEl.style.display = "";
        asstEl.innerHTML = '<div class="card-header"><div><h3>Atendimentos como Assistente</h3><div class="card-header-sub">Comissão ganha ajudando outro profissional</div></div></div>' +
          '<div class="table-wrap"><table class="data-table">' +
          '<thead><tr><th>Data/Hora</th><th>Cliente</th><th>Serviço</th><th>Profissional</th><th class="text-right">Comissão</th></tr></thead>' +
          '<tbody>' + data.appointmentsAsAssistant.map(function (a) {
            var s = data.services.find(function (x) { return x.id === a.serviceId; });
            var c = data.clients.find(function (x) { return x.id === a.clientId; });
            var mainEmp = data.employeesAll.find(function (x) { return x.id === a.employeeId; });
            var commission = Utils.apptCommissionSplit(a, mainEmp).assistantCommission;
            return '<tr><td>' + Utils.fmtDate(a.date) + ' · ' + a.time + '</td><td>' + Utils.escapeHtml(c ? c.name : "-") + '</td>' +
              '<td>' + Utils.escapeHtml(s ? s.name : "-") + '</td><td>' + Utils.escapeHtml(mainEmp ? mainEmp.name : "-") + '</td>' +
              '<td class="text-right text-num font-bold">' + Utils.fmtMoney(commission) + '</td></tr>';
          }).join("") + '</tbody>' +
          '<tfoot><tr style="font-weight:800;border-top:1px solid var(--border-color);"><td colspan="4">Subtotal como assistente</td><td class="text-right text-num">' + Utils.fmtMoney(data.assistantCommissionTotal) + '</td></tr></tfoot>' +
          '</table></div>';
      }
    }

    // desconto por consumo de insumos (ml/g) lançado na Agenda ou no Estoque
    var consumoEl = document.getElementById("ec-consumo");
    if (consumoEl) {
      if (!data.consumoItems.length) {
        consumoEl.innerHTML = '';
        consumoEl.style.display = "none";
      } else {
        consumoEl.style.display = "";
        var products = DB.all("products");
        consumoEl.innerHTML = '<div class="card-header"><div><h3>Desconto por Consumo de Insumos</h3><div class="card-header-sub">Metade do custo dos produtos usados nos seus atendimentos (a outra metade é despesa do salão)</div></div></div>' +
          '<div class="table-wrap"><table class="data-table">' +
          '<thead><tr><th>Data</th><th>Produto</th><th class="text-right">Qtd.</th><th class="text-right">Custo Total</th><th class="text-right">Sua Metade</th></tr></thead>' +
          '<tbody>' + data.consumoItems.map(function (c) {
            var p = products.find(function (x) { return x.id === c.productId; });
            return '<tr><td>' + Utils.fmtDate(c.date) + '</td><td>' + Utils.escapeHtml(p ? p.name : "-") + '</td>' +
              '<td class="text-right text-num">' + (window.Consumo ? Consumo.fmtQty(c.quantity, c.unit) : c.quantity + c.unit) + '</td>' +
              '<td class="text-right text-num">' + Utils.fmtMoney(c.totalCost) + '</td>' +
              '<td class="text-right text-num font-bold text-danger">- ' + Utils.fmtMoney(c.employeeShare) + '</td></tr>';
          }).join("") + '</tbody>' +
          '<tfoot><tr style="font-weight:800;border-top:1px solid var(--border-color);"><td colspan="4">Subtotal do desconto</td><td class="text-right text-num text-danger">- ' + Utils.fmtMoney(data.consumoTotal) + '</td></tr></tfoot>' +
          '</table></div>';
      }
    }

    // comissionamento esporádico do mês (lançado pelo administrador em Comissionamento)
    var bonusEl = document.getElementById("ec-bonus");
    if (bonusEl) {
      if (!data.bonuses.length) {
        bonusEl.innerHTML = '';
        bonusEl.style.display = "none";
      } else {
        bonusEl.style.display = "";
        bonusEl.innerHTML = '<div class="card-header"><div><h3>Comissionamento Esporádico do Mês</h3><div class="card-header-sub">Lançado pela administração, somado (ou descontado) do total devido</div></div></div>' +
          '<div class="table-wrap"><table class="data-table">' +
          '<thead><tr><th>Descrição</th><th>Tipo</th><th class="text-right">Valor</th></tr></thead>' +
          '<tbody>' + data.bonuses.map(function (b) {
            var tipoLabel = b.kind === "percentual" ? "Percentual sobre venda (" + b.refPercent + "% de " + Utils.fmtMoney(b.refValue) + ")" :
              b.kind === "desconto" ? "Desconto / dedução" : "Valor fixo";
            var valClass = b.amount < 0 ? "text-danger" : "";
            var valText = b.amount < 0 ? "- " + Utils.fmtMoney(Math.abs(b.amount)) : Utils.fmtMoney(b.amount);
            return '<tr><td>' + Utils.escapeHtml(b.description) + '</td><td>' + tipoLabel + '</td><td class="text-right text-num font-bold ' + valClass + '">' + valText + '</td></tr>';
          }).join("") + '</tbody>' +
          '<tfoot><tr style="font-weight:800;border-top:1px solid var(--border-color);"><td colspan="2">Subtotal</td><td class="text-right text-num">' + Utils.fmtMoney(data.bonusTotal) + '</td></tr></tfoot>' +
          '</table></div>';
      }
    }
  }

  function cutoffLabel(days) {
    if (days < 0) return "Corte já fechado";
    if (days === 0) return "Fecha hoje";
    return "Fecha em " + days + " dia" + (days === 1 ? "" : "s");
  }
  function payoutLabel(days, saldo) {
    if (saldo <= 0.01) return "Sem saldo em aberto";
    if (days < 0) return "Repasse já realizado";
    if (days === 0) return "Repasse é hoje";
    return "Em " + days + " dia" + (days === 1 ? "" : "s");
  }

  function payoutItem(label, value, sub) {
    return '<div class="ec-payout-item"><div class="ec-p-label">' + Utils.escapeHtml(label) + '</div>' +
      '<div class="ec-p-value">' + Utils.escapeHtml(value) + '</div>' +
      '<div class="ec-p-sub">' + Utils.escapeHtml(sub) + '</div></div>';
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }
  function sum(arr) { return arr.reduce(function (s, v) { return s + (Number(v) || 0); }, 0); }
  function round2(n) { return Math.round(n * 100) / 100; }
})();
