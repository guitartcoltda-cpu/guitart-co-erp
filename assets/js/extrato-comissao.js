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
  // A pedido do usuário (09/09/2026), igual ao Comissionamento (ver
  // comissoes.js), a tela deixou de ter um seletor de "Mês de Referência"
  // com lista fixa de meses — agora só existe um período personalizado
  // (De/Até, ISO YYYY-MM-DD), que o profissional ajusta livremente para
  // conferir o mês inteiro, uma semana, ou qualquer corte. Ver currentRange().
  var customRange = null;
  var ecSortState = { field: null, dir: "asc" }; // clique no rótulo da coluna para ordenar

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
    var startInput = Utils.qs("#ec-date-start");
    var endInput = Utils.qs("#ec-date-end");

    // Ponto de partida padrão: do início do mês corrente até hoje — o
    // profissional ajusta De/Até livremente para o período que quiser
    // conferir (mês inteiro, semana, quinzena etc.).
    customRange = { start: today.slice(0, 8) + "01", end: today };
    startInput.value = customRange.start;
    endInput.value = customRange.end;

    function applyCustomRangeInputs() {
      if (!startInput.value || !endInput.value) return;
      var s = startInput.value, en = endInput.value;
      if (s > en) { var tmp = s; s = en; en = tmp; } // sempre mantém De <= Até, independente de qual campo foi editado
      customRange = { start: s, end: en };
      startInput.value = s; endInput.value = en;
      render();
    }
    startInput.addEventListener("change", applyCustomRangeInputs);
    endInput.addEventListener("change", applyCustomRangeInputs);

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

  // Verdadeiro quando o período em exibição começa no dia 1 de um mês e
  // termina dentro desse mesmo mês (seja no fim do mês, seja hoje, no caso
  // do mês corrente ainda em andamento) — ou seja, quando o usuário está
  // vendo "o mês", mesmo sem existir mais um seletor de mês dedicado.
  function isWholeMonthPrefix(range) {
    var mk = range.start.slice(0, 7);
    return range.start === (mk + "-01") && range.end.slice(0, 7) === mk;
  }

  function payoutDateFor(monthKey) {
    var nextMonthFirst = Utils.addMonths(monthKey + "-01", 1);
    return nextMonthFirst.slice(0, 8) + String(PAYOUT_DAY).padStart(2, "0");
  }

  // Intervalo de datas (início/fim, ambos inclusive) que efetivamente
  // delimita o que entra no cálculo — o período (De/Até) escolhido pelo
  // profissional/administrador no filtro. Mesmo padrão de comissoes.js.
  function currentRange() {
    return customRange;
  }

  // Conjunto de meses "tocados" pelo intervalo — fallback usado só para
  // lançamentos de comissionamento esporádico antigos (sem data própria,
  // só mês de competência). Mesma lógica de comissoes.js.
  function touchedMonths(range) {
    var months = {};
    var cur = range.start.slice(0, 7);
    var endMonth = range.end.slice(0, 7);
    var guard = 0;
    while (cur <= endMonth && guard < 240) {
      months[cur] = true;
      cur = Utils.monthKey(Utils.addMonths(cur + "-01", 1));
      guard++;
    }
    return months;
  }

  // Mês usado só para ancorar o gráfico de histórico e o cálculo de
  // "Próximo Repasse" (sempre pensados em ciclo mensal) mesmo quando o
  // período em exibição é personalizado — usa o mês em que o período
  // termina, já que é o mês em que o corte efetivamente fecha.
  function referenceMonthKey() {
    return Utils.monthKey(customRange.end);
  }

  // Mesmo filtro de comissionamento esporádico usado em comissoes.js
  // (bonusesFor): por data exata quando o lançamento tem uma (novos),
  // por mês de competência tocado pelo intervalo quando não tem (antigos).
  function bonusesFor(employeeId, range) {
    var touched = touchedMonths(range);
    return DB.all("commissionBonuses").filter(function (b) {
      if (b.employeeId !== employeeId) return false;
      if (b.date) return b.date >= range.start && b.date <= range.end;
      return !!touched[b.month];
    });
  }

  // Igual a computeForEmployee(), mas sobre o período atualmente selecionado
  // na tela (mês inteiro ou corte personalizado) — usada pelo KPI/tabela
  // principais. computeForEmployee() continua existindo, sem alteração,
  // só para o gráfico de histórico (sempre por mês calendário).
  function computeForEmployeeCurrent(employeeId) {
    var e = DB.get("employees", employeeId);
    if (!e) return null;
    var range = currentRange();
    var employeesAll = DB.all("employees");
    var appointments = DB.all("appointments").filter(function (a) {
      return a.employeeId === employeeId && a.status === "concluido" && a.date >= range.start && a.date <= range.end;
    }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });
    var appointmentsAsAssistant = DB.all("appointments").filter(function (a) {
      return a.assistantId === employeeId && a.status === "concluido" && a.date >= range.start && a.date <= range.end;
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
    var bonuses = bonusesFor(employeeId, range);
    var bonusTotal = round2(sum(bonuses.map(function (b) { return b.amount; })));
    var consumo = window.Consumo ? Consumo.deductionForRange(employeeId, range) : { total: 0, items: [] };
    var devido = round2(baseComissao + bonusTotal - consumo.total);
    // "Já Recebido" soma todo pagamento de comissão que pertence ao período
    // em exibição — mesmo critério de comissoes.js (computeRows): quando o
    // período visto é "o mês" (De = dia 1, Até = fim do mês ou hoje, se o
    // mês ainda está em andamento), o critério é o mês de competência
    // gravado no pagamento (relatedMonth) bater com o mês em exibição —
    // isso garante que um corte semanal cujos dias cruzam a virada do mês
    // (ex.: pago 29/08 a 04/09, mas registrado como competência de
    // setembro) continue contando inteiro em setembro. Quando o período
    // visto é um corte personalizado mais estreito, o critério passa a ser
    // o intervalo do próprio pagamento estar CONTIDO no período em
    // exibição, para não vazar o pagamento de outra semana do mesmo mês.
    // Pagamentos antigos (só relatedMonth, sem intervalo próprio) usam o
    // mês inteiro como intervalo implícito nesse segundo caso.
    var wholeMonth = isWholeMonthPrefix(range);
    var wholeMonthKey = range.start.slice(0, 7);
    var pago = sum(DB.all("transactions").filter(function (t) {
      if (t.type !== "despesa" || t.employeeId !== employeeId || t.categoryId !== commissionCatId()) return false;
      return wholeMonth
        ? (t.relatedMonth === wholeMonthKey)
        : (t.relatedRangeStart
          ? (t.relatedRangeStart >= range.start && t.relatedRangeEnd <= range.end)
          : (t.relatedMonth && (t.relatedMonth + "-01") >= range.start && lastDayOfMonth(t.relatedMonth) <= range.end));
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
    var data = computeForEmployeeCurrent(selectedEmployeeId);
    if (!data) return;
    var e = data.employee;

    var kpis = [
      kpi("Comissão do Período", Utils.fmtMoney(data.devido), "fa-sack-dollar", "#2a78d6", "#e3eefb"),
      kpi("Já Recebido", Utils.fmtMoney(data.pago), "fa-circle-check", "#1baf7a", "#e2f5ec"),
      kpi("Saldo em Aberto", Utils.fmtMoney(Math.max(0, data.saldo)), "fa-hourglass-half", "#b7791f", "#fdf2df"),
      kpi("Atendimentos no Período", String(data.appointments.length), "fa-scissors", "#4a3aa7", "#ece8f8")
    ];
    if (data.consumoTotal > 0) {
      kpis.push(kpi("Desconto por Consumo", "- " + Utils.fmtMoney(data.consumoTotal), "fa-flask", "#c23b3b", "#fbe6e6"));
    }
    document.getElementById("ec-summary").innerHTML = kpis.join("");

    // corte / repasse — em período personalizado o "corte" é o fim do
    // intervalo escolhido, mas o repasse continua ancorado no ciclo mensal
    // (dia 5 do mês seguinte ao mês em que o período termina), já que é
    // assim que o salão paga na prática — ver referenceMonthKey().
    var cutoffDate = customRange.end;
    var payoutDate = payoutDateFor(referenceMonthKey());
    var today = Utils.todayISO();
    var daysToCutoff = Utils.daysBetween(today, cutoffDate);
    var daysToPayout = Utils.daysBetween(today, payoutDate);
    document.getElementById("ec-payout").innerHTML =
      payoutItem("Corte do Período", Utils.fmtDate(cutoffDate), cutoffLabel(daysToCutoff)) +
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
      emptyMessage: "Sem atendimentos concluídos no período"
    });

    // history chart (last 6 months incl. reference month) — sempre por mês
    // calendário, mesmo em período personalizado: referenceMonthKey() ancora
    // no mês em que o corte personalizado termina (ver comentário acima).
    var histMonths = [];
    for (var i = 5; i >= 0; i--) histMonths.push(Utils.monthKey(Utils.addMonths(referenceMonthKey() + "-01", -i)));
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
      Utils.emptyTable(tbl, "fa-calendar", "Nenhum atendimento concluído no período");
    } else {
      var ecSortGetters = {
        dataHora: function (a) { return a.date + " " + a.time; },
        cliente: function (a) { var c = data.clients.find(function (x) { return x.id === a.clientId; }); return c ? c.name : ""; },
        servico: function (a) { var s = data.services.find(function (x) { return x.id === a.serviceId; }); return s ? s.name : ""; },
        produtos: function (a) { return consumoByAppt[a.id] || 0; },
        commission: function (a) { return Utils.apptCommissionSplit(a, e).mainCommission; }
      };
      var sortedAppointments = Utils.sortBy(data.appointments, ecSortState, ecSortGetters);
      var linkedConsumoTotal = 0;
      tbl.innerHTML = '<thead><tr>' +
        Utils.thSort("Data/Hora", "dataHora", ecSortState) +
        Utils.thSort("Cliente", "cliente", ecSortState) +
        Utils.thSort("Serviço", "servico", ecSortState) +
        Utils.thSort("Valor Cobrado", "price", ecSortState, { className: "text-right" }) +
        Utils.thSort("Produtos", "produtos", ecSortState, { className: "text-right" }) +
        Utils.thSort("Comissão", "commission", ecSortState, { className: "text-right" }) +
        '</tr></thead><tbody>' +
        sortedAppointments.map(function (a) {
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
      Utils.wireSortHeaders(tbl, ecSortState, render);
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
