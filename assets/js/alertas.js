/* ============================================================
   Salão ERP — Central de Alertas Inteligentes
   Painel 100% de leitura: cruza dados já existentes (agendamentos,
   clientes, funcionários, transações) para identificar situações
   que merecem atenção do dono do salão. Nenhum dado é gravado aqui
   e NENHUMA mensagem é enviada a ninguém — apenas identificação e
   exibição na tela, conforme decisão do cliente.
   ============================================================ */
(function () {
  "use strict";

  // ---- Limiares (thresholds) usados pelas regras abaixo ----
  var NO_SHOW_WINDOW_DAYS = 30;          // janela para listar faltas recentes
  var INACTIVE_DAYS_THRESHOLD = 40;      // dias sem atividade para considerar cliente inativo
  var LOW_PRODUCTION_RATIO = 0.6;        // abaixo de 60% da média da equipe = produção baixa
  var IDLE_SLOTS_WINDOW_DAYS = 75;       // janela analisada para horários ociosos (60–90 dias)
  var IDLE_SLOT_RATIO = 0.4;             // horário com até 40% da média = ocioso
  var RECURRENCE_MIN_OCCURRENCES = 3;    // mínimo de atendimentos do mesmo serviço p/ estimar ciclo
  var RECURRENCE_DUE_SOON_DAYS = 5;      // "está próximo" = dentro de 5 dias do previsto (ou já vencido)
  var FOLLOWUP_MIN_DURATION_MIN = 100;   // serviços de ciclo longo/maior ticket (ex.: Coloração, 120min)
  var FOLLOWUP_DAYS_THRESHOLD = 60;      // dias sem retorno após serviço de ciclo longo

  // ---- Estado de ordenação das tabelas (clique no cabeçalho da coluna) ----
  var noShowSortState = { field: null, dir: "asc" };
  var inactiveSortState = { field: null, dir: "asc" };
  var lowProdSortState = { field: null, dir: "asc" };
  var recurrenceSortState = { field: null, dir: "asc" };
  var followupSortState = { field: null, dir: "asc" };
  var salesBreakdownSortState = { field: null, dir: "asc" };

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    var data = loadData();

    var noShow = computeNoShow(data);
    var inactive = computeInactive(data);
    var lowProd = computeLowProduction(data);
    var idle = computeIdleSlots(data);
    var recurrence = computeRecurrence(data);
    var followup = computeFollowup(data);
    var sales = computeSalesDiagnostic(data);

    renderKpis({ noShow: noShow, inactive: inactive, lowProd: lowProd, idle: idle, recurrence: recurrence, followup: followup, sales: sales });
    renderNoShow(noShow);
    renderInactive(inactive);
    renderLowProd(lowProd);
    renderIdle(idle);
    renderRecurrence(recurrence);
    renderFollowup(followup);
    renderSalesDiagnostic(sales, data);
  }

  function loadData() {
    return {
      today: Utils.todayISO(),
      appointments: DB.all("appointments"),
      clients: DB.all("clients"),
      employees: DB.all("employees"),
      services: DB.all("services"),
      transactions: DB.all("transactions"),
      categories: DB.all("categories")
    };
  }

  function byId(arr) {
    var map = {};
    arr.forEach(function (r) { map[r.id] = r; });
    return map;
  }

  // ================= 1) Clientes que faltaram =================
  function computeNoShow(data) {
    var startDate = Utils.addDays(data.today, -NO_SHOW_WINDOW_DAYS);
    var clientsById = byId(data.clients), employeesById = byId(data.employees), servicesById = byId(data.services);

    var rows = data.appointments
      .filter(function (a) { return a.status === "faltou" && a.date >= startDate && a.date <= data.today; })
      .map(function (a) {
        return {
          appt: a,
          client: clientsById[a.clientId] || null,
          employee: employeesById[a.employeeId] || null,
          service: servicesById[a.serviceId] || null
        };
      })
      .sort(function (a, b) { return b.appt.date.localeCompare(a.appt.date); });

    var distinctClients = {};
    rows.forEach(function (r) { if (r.client) distinctClients[r.client.id] = true; });

    return { rows: rows, distinctClientCount: Object.keys(distinctClients).length, windowDays: NO_SHOW_WINDOW_DAYS };
  }

  function renderNoShow(res) {
    Utils.qs("#rule-noshow").textContent =
      "Considera agendamentos marcados com status \"faltou\" nos últimos " + res.windowDays + " dias.";
    var tbl = Utils.qs("#tbl-noshow");
    if (!res.rows.length) {
      Utils.emptyTable(tbl, "fa-circle-check", "Nenhum cliente faltou recentemente", "Nenhum \"faltou\" registrado nos últimos " + res.windowDays + " dias.");
      return;
    }
    var noShowGetters = {
      client: function (r) { return r.client ? r.client.name : ""; },
      date: function (r) { return r.appt.date + " " + (r.appt.time || ""); },
      service: function (r) { return r.service ? r.service.name : ""; },
      employee: function (r) { return r.employee ? r.employee.name : ""; }
    };
    var rows = Utils.sortBy(res.rows, noShowSortState, noShowGetters);
    tbl.innerHTML = '<thead><tr>' +
      Utils.thSort("Cliente", "client", noShowSortState) +
      Utils.thSort("Data", "date", noShowSortState) +
      Utils.thSort("Serviço", "service", noShowSortState) +
      Utils.thSort("Profissional", "employee", noShowSortState) +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' +
          '<td><div class="flex items-center gap-8"><div class="avatar">' + Utils.initials(r.client ? r.client.name : "?") + '</div>' + Utils.escapeHtml(r.client ? r.client.name : "Cliente removido") + '</div></td>' +
          '<td class="text-num">' + Utils.fmtDate(r.appt.date) + ' ' + (r.appt.time || "") + '</td>' +
          '<td>' + Utils.escapeHtml(r.service ? r.service.name : "-") + '</td>' +
          '<td>' + Utils.escapeHtml(r.employee ? r.employee.name : "-") + '</td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.wireSortHeaders(tbl, noShowSortState, function () { renderNoShow(res); });
  }

  // ================= 2) Clientes inativos =================
  function computeInactive(data) {
    // Uma única varredura de appointments/transactions monta os índices por
    // cliente (em vez de um .forEach()/.some() sobre TODOS os agendamentos e
    // TODAS as transações, repetido para CADA cliente) — mesmo resultado,
    // custo O(clientes + agendamentos + transações) em vez de O(clientes ×
    // (agendamentos + transações)).
    var lastApptByClient = {}, hasFutureByClient = {};
    data.appointments.forEach(function (a) {
      if (a.status === "concluido" && (!lastApptByClient[a.clientId] || a.date > lastApptByClient[a.clientId])) lastApptByClient[a.clientId] = a.date;
      else if (a.status === "agendado" && a.date >= data.today) hasFutureByClient[a.clientId] = true;
    });
    var lastTxnByClient = {};
    data.transactions.forEach(function (t) {
      if (t.type === "receita" && (!lastTxnByClient[t.clientId] || t.date > lastTxnByClient[t.clientId])) lastTxnByClient[t.clientId] = t.date;
    });

    var rows = [];
    data.clients.forEach(function (c) {
      var lastApptDate = lastApptByClient[c.id] || null;
      var lastTxnDate = lastTxnByClient[c.id] || null;
      var lastActivity = null;
      if (lastApptDate && lastTxnDate) lastActivity = lastApptDate > lastTxnDate ? lastApptDate : lastTxnDate;
      else lastActivity = lastApptDate || lastTxnDate;
      if (!lastActivity) return; // nunca teve atendimento/compra registrado — fora do escopo desta regra

      var daysSince = Utils.daysBetween(lastActivity, data.today);
      if (daysSince < INACTIVE_DAYS_THRESHOLD) return;

      if (hasFutureByClient[c.id]) return;

      rows.push({ client: c, lastActivity: lastActivity, daysSince: daysSince });
    });
    rows.sort(function (a, b) { return b.daysSince - a.daysSince; });
    return { rows: rows, threshold: INACTIVE_DAYS_THRESHOLD };
  }

  function renderInactive(res) {
    Utils.qs("#rule-inactive").textContent =
      "Clientes cuja última visita concluída (ou compra) foi há " + res.threshold + "+ dias e que não têm nenhum agendamento futuro marcado.";
    var tbl = Utils.qs("#tbl-inactive");
    if (!res.rows.length) {
      Utils.emptyTable(tbl, "fa-circle-check", "Nenhum cliente inativo no momento", "Todos os clientes com histórico estão dentro do período esperado ou já têm retorno agendado.");
      return;
    }
    var inactiveGetters = {
      client: function (r) { return r.client.name; },
      phone: function (r) { return r.client.phone || ""; }
    };
    var rows = Utils.sortBy(res.rows, inactiveSortState, inactiveGetters);
    tbl.innerHTML = '<thead><tr>' +
      Utils.thSort("Cliente", "client", inactiveSortState) +
      Utils.thSort("Telefone", "phone", inactiveSortState) +
      Utils.thSort("Última Atividade", "lastActivity", inactiveSortState) +
      Utils.thSort("Dias Sem Retorno", "daysSince", inactiveSortState, { className: "text-right" }) +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' +
          '<td><div class="flex items-center gap-8"><div class="avatar">' + Utils.initials(r.client.name) + '</div>' + Utils.escapeHtml(r.client.name) + '</div></td>' +
          '<td class="small">' + Utils.escapeHtml(r.client.phone || "-") + '</td>' +
          '<td class="text-num">' + Utils.fmtDate(r.lastActivity) + '</td>' +
          '<td class="text-right text-num"><span class="badge badge-warning">' + r.daysSince + ' dias</span></td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.wireSortHeaders(tbl, inactiveSortState, function () { renderInactive(res); });
  }

  // ================= 3) Profissionais com baixa produção =================
  function computeLowProduction(data) {
    var monthStart = data.today.slice(0, 8) + "01";
    var providers = data.employees.filter(function (e) { return e.status === "ativo" && Number(e.commissionRate) > 0; });

    // Agrupa transações/agendamentos do mês por funcionário uma única vez
    // (em vez de varrer as duas listas inteiras para CADA profissional) —
    // mesmo resultado, custo O(profissionais + transações + agendamentos)
    // em vez de O(profissionais × (transações + agendamentos)).
    var revenueByEmployee = {}, countByEmployee = {};
    data.transactions.forEach(function (t) {
      if (t.type === "receita" && t.date >= monthStart && t.date <= data.today && t.employeeId) {
        revenueByEmployee[t.employeeId] = (revenueByEmployee[t.employeeId] || 0) + t.amount;
      }
    });
    data.appointments.forEach(function (a) {
      if (a.status === "concluido" && a.date >= monthStart && a.date <= data.today && a.employeeId) {
        countByEmployee[a.employeeId] = (countByEmployee[a.employeeId] || 0) + 1;
      }
    });

    var stats = providers.map(function (e) {
      return { employee: e, revenue: revenueByEmployee[e.id] || 0, count: countByEmployee[e.id] || 0 };
    });

    var totalRevenue = stats.reduce(function (s, x) { return s + x.revenue; }, 0);
    var avgRevenue = stats.length ? totalRevenue / stats.length : 0;

    var flagged = [];
    if (avgRevenue > 0) {
      stats.forEach(function (s) {
        if (s.revenue < avgRevenue * LOW_PRODUCTION_RATIO) {
          flagged.push(Object.assign({}, s, { pctOfAvg: (s.revenue / avgRevenue) * 100 }));
        }
      });
    }
    flagged.sort(function (a, b) { return a.revenue - b.revenue; });

    return { rows: flagged, avgRevenue: avgRevenue, ratio: LOW_PRODUCTION_RATIO, monthStart: monthStart, providerCount: providers.length };
  }

  function renderLowProd(res) {
    Utils.qs("#rule-lowprod").textContent = res.providerCount
      ? "Compara a receita de cada profissional ativo no mês atual (" + Utils.fmtDate(res.monthStart) + " até hoje) com a média da equipe (" + Utils.fmtMoney(res.avgRevenue) + "). Flagados os que produziram menos de " + Math.round(res.ratio * 100) + "% dessa média."
      : "Nenhum profissional ativo com comissão cadastrada para comparar.";
    var tbl = Utils.qs("#tbl-lowprod");
    if (!res.rows.length) {
      Utils.emptyTable(tbl, "fa-circle-check", "Nenhum profissional abaixo da média", "A produção da equipe está equilibrada neste mês (ou ainda não há dados suficientes).");
      return;
    }
    var lowProdGetters = {
      employee: function (r) { return r.employee.name; },
      role: function (r) { return r.employee.role || ""; }
    };
    var rows = Utils.sortBy(res.rows, lowProdSortState, lowProdGetters);
    tbl.innerHTML = '<thead><tr>' +
      Utils.thSort("Profissional", "employee", lowProdSortState) +
      Utils.thSort("Cargo", "role", lowProdSortState) +
      Utils.thSort("Receita no Mês", "revenue", lowProdSortState, { className: "text-right" }) +
      Utils.thSort("Atendimentos", "count", lowProdSortState, { className: "text-right" }) +
      Utils.thSort("% da Média", "pctOfAvg", lowProdSortState, { className: "text-right" }) +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' +
          '<td><div class="flex items-center gap-8"><div class="avatar">' + Utils.initials(r.employee.name) + '</div>' + Utils.escapeHtml(r.employee.name) + '</div></td>' +
          '<td class="small">' + Utils.escapeHtml(r.employee.role || "-") + '</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(r.revenue) + '</td>' +
          '<td class="text-right text-num">' + r.count + '</td>' +
          '<td class="text-right text-num"><span class="badge badge-danger">' + r.pctOfAvg.toFixed(0) + '%</span></td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.wireSortHeaders(tbl, lowProdSortState, function () { renderLowProd(res); });
  }

  // ================= 4) Horários ociosos =================
  function computeIdleSlots(data) {
    function hourOf(a) {
      var h = parseInt(String(a.time || "").split(":")[0], 10);
      return isNaN(h) ? null : h;
    }

    var allHours = data.appointments.map(hourOf).filter(function (h) { return h !== null; });
    if (!allHours.length) return { hasData: false };

    var minHour = Math.min.apply(null, allHours), maxHour = Math.max.apply(null, allHours);

    var startDate = Utils.addDays(data.today, -IDLE_SLOTS_WINDOW_DAYS);
    var windowAppts = data.appointments.filter(function (a) {
      return a.date >= startDate && a.date <= data.today && (a.status === "concluido" || a.status === "agendado" || a.status === "faltou");
    });

    var counts = {};
    windowAppts.forEach(function (a) {
      var h = hourOf(a);
      if (h === null) return;
      counts[h] = (counts[h] || 0) + 1;
    });

    var slots = [];
    for (var h = minHour; h <= maxHour; h++) slots.push({ hour: h, count: counts[h] || 0 });

    var avgCount = slots.length ? slots.reduce(function (s, x) { return s + x.count; }, 0) / slots.length : 0;
    var idle = slots.filter(function (s) { return avgCount > 0 && s.count <= avgCount * IDLE_SLOT_RATIO; })
      .sort(function (a, b) { return a.count - b.count; });

    return { hasData: true, slots: slots, idle: idle, avgCount: avgCount, windowDays: IDLE_SLOTS_WINDOW_DAYS, ratio: IDLE_SLOT_RATIO };
  }

  function renderIdle(res) {
    Utils.qs("#rule-idle").textContent = res.hasData
      ? "Analisa os agendamentos dos últimos " + res.windowDays + " dias por hora do dia. Média de " + res.avgCount.toFixed(1) + " atendimento(s)/horário; horários com até " + Math.round(res.ratio * 100) + "% dessa média são sinalizados como ociosos."
      : "Ainda não há agendamentos suficientes para identificar padrões de horário.";
    var el = Utils.qs("#idle-slots");
    if (!res.hasData || !res.idle.length) {
      el.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-clock"></i></div><h4>Nenhum horário ocioso identificado</h4>' +
        (res.hasData ? '<p>A ocupação está relativamente equilibrada entre os horários analisados.</p>' : '') + '</div>';
      return;
    }
    var maxCount = res.slots.reduce(function (m, s) { return Math.max(m, s.count); }, 1) || 1;
    el.innerHTML = res.idle.slice(0, 5).map(function (s) {
      var pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
      return '<div class="al-slot-row">' +
        '<div class="al-slot-label">' + s.hour + 'h</div>' +
        '<div class="progress-track" style="flex:1;"><div class="progress-fill" style="width:' + pct + '%;background:var(--color-info);"></div></div>' +
        '<div class="al-slot-count">' + s.count + ' atend. / ' + res.windowDays + 'd</div>' +
        '</div>';
    }).join("") +
      (res.idle.length ? '<p class="small text-muted mt-16">Horário das ' + res.idle[0].hour + 'h está entre os mais vazios da agenda — considere promoções ou pacotes para esse horário.</p>' : '');
  }

  // ================= 5) Clientes com recorrência esperada =================
  // O cálculo em si (intervalo médio por cliente+serviço, próximo retorno
  // previsto) vive em assets/js/recorrencia.js, compartilhado com a regra
  // de "cliente ausente" das Notificações WhatsApp — aqui só filtramos para
  // a janela "está perto ou já venceu" que faz sentido nesta tela.
  function computeRecurrence(data) {
    var clientsById = byId(data.clients), servicesById = byId(data.services);
    var all = Recorrencia.compute(data.appointments, data.today, RECURRENCE_MIN_OCCURRENCES);

    var rows = [];
    all.forEach(function (r) {
      if (r.hasFutureSame) return;
      if (r.daysUntil > RECURRENCE_DUE_SOON_DAYS || r.daysUntil < -r.avgGap) return; // nem perto do previsto, nem dentro de um ciclo de atraso
      rows.push({
        client: clientsById[r.clientId] || null,
        service: servicesById[r.serviceId] || null,
        avgGap: r.avgGap,
        lastDate: r.lastDate,
        daysSinceLast: r.daysSinceLast,
        daysUntil: r.daysUntil,
        occurrences: r.occurrences
      });
    });

    rows.sort(function (a, b) { return a.daysUntil - b.daysUntil; });
    return { rows: rows, minOccurrences: RECURRENCE_MIN_OCCURRENCES, dueSoonDays: RECURRENCE_DUE_SOON_DAYS };
  }

  function renderRecurrence(res) {
    Utils.qs("#rule-recurrence").textContent =
      "Para clientes com " + res.minOccurrences + "+ atendimentos concluídos do mesmo serviço, calcula o intervalo médio entre eles. Sinaliza quando a data prevista do próximo (última visita + intervalo médio) está a até " + res.dueSoonDays + " dias de distância de hoje (vencida ou próxima) e ainda não há novo agendamento para esse serviço.";
    var tbl = Utils.qs("#tbl-recurrence");
    if (!res.rows.length) {
      Utils.emptyTable(tbl, "fa-circle-check", "Nenhuma recorrência prevista no momento", "Nenhum cliente com padrão de retorno se aproximando da data esperada agora.");
      return;
    }
    var recurrenceGetters = {
      client: function (r) { return r.client ? r.client.name : ""; },
      service: function (r) { return r.service ? r.service.name : ""; },
      situacao: function (r) { return r.daysUntil; }
    };
    var rows = Utils.sortBy(res.rows, recurrenceSortState, recurrenceGetters);
    tbl.innerHTML = '<thead><tr>' +
      Utils.thSort("Cliente", "client", recurrenceSortState) +
      Utils.thSort("Serviço", "service", recurrenceSortState) +
      Utils.thSort("Intervalo Médio", "avgGap", recurrenceSortState, { className: "text-right" }) +
      Utils.thSort("Última Vez", "lastDate", recurrenceSortState) +
      Utils.thSort("Situação", "situacao", recurrenceSortState) +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        var sitLabel = r.daysUntil < 0 ? ("provável retorno vencido há " + Math.abs(r.daysUntil) + " dia(s)") : (r.daysUntil === 0 ? "provável retorno hoje" : "provável retorno em " + r.daysUntil + " dia(s)");
        var badgeClass = r.daysUntil < 0 ? "badge-warning" : "badge-info";
        return '<tr>' +
          '<td><div class="flex items-center gap-8"><div class="avatar">' + Utils.initials(r.client ? r.client.name : "?") + '</div>' + Utils.escapeHtml(r.client ? r.client.name : "-") + '</div></td>' +
          '<td>' + Utils.escapeHtml(r.service ? r.service.name : "-") + '</td>' +
          '<td class="text-right text-num">~' + r.avgGap + ' dias</td>' +
          '<td class="text-num">' + Utils.fmtDate(r.lastDate) + ' (há ' + r.daysSinceLast + 'd)</td>' +
          '<td><span class="badge ' + badgeClass + '">' + sitLabel + '</span></td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.wireSortHeaders(tbl, recurrenceSortState, function () { renderRecurrence(res); });
  }

  // ================= 6) Retorno sugerido após serviço específico =================
  function computeFollowup(data) {
    var clientsById = byId(data.clients);
    var qualifyingServices = data.services.filter(function (s) { return Number(s.durationMin) >= FOLLOWUP_MIN_DURATION_MIN; });
    var qualifyingIds = {};
    qualifyingServices.forEach(function (s) { qualifyingIds[s.id] = s; });

    var latestByKey = {}; // "clientId|serviceId" -> appt
    data.appointments.forEach(function (a) {
      if (a.status !== "concluido" || !qualifyingIds[a.serviceId]) return;
      var key = a.clientId + "|" + a.serviceId;
      if (!latestByKey[key] || a.date > latestByKey[key].date) latestByKey[key] = a;
    });

    var rows = [];
    Object.keys(latestByKey).forEach(function (key) {
      var a = latestByKey[key];
      var daysSince = Utils.daysBetween(a.date, data.today);
      if (daysSince < FOLLOWUP_DAYS_THRESHOLD) return;
      var hasFuture = data.appointments.some(function (x) { return x.clientId === a.clientId && x.status === "agendado" && x.date >= data.today; });
      if (hasFuture) return;
      rows.push({ client: clientsById[a.clientId] || null, service: qualifyingIds[a.serviceId], lastDate: a.date, daysSince: daysSince });
    });
    rows.sort(function (a, b) { return b.daysSince - a.daysSince; });

    return { rows: rows, thresholdDays: FOLLOWUP_DAYS_THRESHOLD, minDuration: FOLLOWUP_MIN_DURATION_MIN, qualifyingServices: qualifyingServices };
  }

  function renderFollowup(res) {
    var serviceNames = res.qualifyingServices.map(function (s) { return s.name; }).join(", ") || "nenhum serviço cadastrado com essa duração";
    Utils.qs("#rule-followup").textContent =
      "Serviços de ciclo longo (duração ≥ " + res.minDuration + " min: " + serviceNames + "). Sinaliza clientes cuja última realização foi há " + res.thresholdDays + "+ dias e que não têm nenhum agendamento futuro.";
    var tbl = Utils.qs("#tbl-followup");
    if (!res.rows.length) {
      Utils.emptyTable(tbl, "fa-circle-check", "Nenhum retorno pendente no momento", "Nenhum cliente com serviço de ciclo longo vencido para contato.");
      return;
    }
    var followupGetters = {
      client: function (r) { return r.client ? r.client.name : ""; },
      service: function (r) { return r.service ? r.service.name : ""; }
    };
    var rows = Utils.sortBy(res.rows, followupSortState, followupGetters);
    tbl.innerHTML = '<thead><tr>' +
      Utils.thSort("Cliente", "client", followupSortState) +
      Utils.thSort("Serviço", "service", followupSortState) +
      Utils.thSort("Última Vez", "lastDate", followupSortState) +
      Utils.thSort("Dias Desde a Última Vez", "daysSince", followupSortState, { className: "text-right" }) +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' +
          '<td><div class="flex items-center gap-8"><div class="avatar">' + Utils.initials(r.client ? r.client.name : "?") + '</div>' + Utils.escapeHtml(r.client ? r.client.name : "-") + '</div></td>' +
          '<td>' + Utils.escapeHtml(r.service ? r.service.name : "-") + '</td>' +
          '<td class="text-num">' + Utils.fmtDate(r.lastDate) + '</td>' +
          '<td class="text-right text-num"><span class="badge badge-info">' + r.daysSince + ' dias</span></td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.wireSortHeaders(tbl, followupSortState, function () { renderFollowup(res); });
  }

  // ================= 7) Diagnóstico de queda de vendas =================
  function computeSalesDiagnostic(data) {
    var todayD = Utils.parseDate(data.today);
    var monthStart = Utils.toISODate(new Date(todayD.getFullYear(), todayD.getMonth(), 1));
    var lastMonthStart = Utils.addMonths(monthStart, -1);
    var lastRangeEnd = Utils.addMonths(data.today, -1);
    if (lastRangeEnd < lastMonthStart) lastRangeEnd = lastMonthStart; // salvaguarda para meses com dias diferentes

    function sumIn(list, start, end) {
      return list.filter(function (t) { return t.date >= start && t.date <= end; }).reduce(function (s, t) { return s + t.amount; }, 0);
    }

    var receitas = data.transactions.filter(function (t) { return t.type === "receita"; });
    var revenueThis = sumIn(receitas, monthStart, data.today);
    var revenueLast = sumIn(receitas, lastMonthStart, lastRangeEnd);
    var diff = revenueThis - revenueLast;
    var pct = revenueLast > 0.01 ? (diff / revenueLast) * 100 : null;
    var status = revenueLast <= 0.01 ? "na" : (diff < -0.01 ? "down" : "up");

    // quebra por categoria de receita
    var revenueCategories = data.categories.filter(function (c) { return c.type === "receita"; });
    var catBreakdown = revenueCategories.map(function (c) {
      var list = receitas.filter(function (t) { return t.categoryId === c.id; });
      var thisV = sumIn(list, monthStart, data.today);
      var lastV = sumIn(list, lastMonthStart, lastRangeEnd);
      return { name: c.name, thisV: thisV, lastV: lastV, diff: thisV - lastV };
    }).filter(function (c) { return c.thisV > 0 || c.lastV > 0; })
      .sort(function (a, b) { return a.diff - b.diff; });

    // quebra por profissional
    var empBreakdown = data.employees.map(function (e) {
      var list = receitas.filter(function (t) { return t.employeeId === e.id; });
      var thisV = sumIn(list, monthStart, data.today);
      var lastV = sumIn(list, lastMonthStart, lastRangeEnd);
      return { name: e.name, thisV: thisV, lastV: lastV, diff: thisV - lastV };
    }).filter(function (e) { return e.thisV > 0 || e.lastV > 0; })
      .sort(function (a, b) { return a.diff - b.diff; });

    var biggestCatDrop = catBreakdown.length && catBreakdown[0].diff < -0.01 ? catBreakdown[0] : null;
    var biggestEmpDrop = empBreakdown.length && empBreakdown[0].diff < -0.01 ? empBreakdown[0] : null;

    return {
      monthStart: monthStart, today: data.today, lastMonthStart: lastMonthStart, lastRangeEnd: lastRangeEnd,
      revenueThis: revenueThis, revenueLast: revenueLast, diff: diff, pct: pct, status: status,
      catBreakdown: catBreakdown, empBreakdown: empBreakdown,
      biggestCatDrop: biggestCatDrop, biggestEmpDrop: biggestEmpDrop
    };
  }

  function renderSalesDiagnostic(res) {
    var box = document.createElement("div");
    box.className = "al-diag-box " + res.status;
    var text;

    if (res.status === "na") {
      text = 'Ainda não há dados suficientes no mesmo período do mês anterior (' + Utils.fmtDate(res.lastMonthStart) + ' – ' + Utils.fmtDate(res.lastRangeEnd) + ') para fazer essa comparação.';
      box.innerHTML = '<i class="fa-solid fa-circle-info"></i><div class="al-diag-text">' + text + '</div>';
    } else if (res.status === "up") {
      var pctTxt = res.pct === null ? "" : (" (" + (res.pct >= 0 ? "+" : "") + res.pct.toFixed(1) + "%)");
      text = 'Receita de <strong>' + Utils.fmtMoney(res.revenueThis) + '</strong> no período (' + Utils.fmtDate(res.monthStart) + ' até hoje), ante <strong>' + Utils.fmtMoney(res.revenueLast) + '</strong> no mesmo intervalo do mês anterior' + pctTxt + '. Nenhuma queda identificada — receita estável ou em alta.';
      box.innerHTML = '<i class="fa-solid fa-circle-check"></i><div class="al-diag-text">' + text + '</div>';
    } else {
      var dropBits = [];
      if (res.biggestCatDrop) dropBits.push('na categoria <strong>' + Utils.escapeHtml(res.biggestCatDrop.name) + '</strong> (' + Utils.fmtMoney(res.biggestCatDrop.diff) + ')');
      if (res.biggestEmpDrop) dropBits.push('com o(a) profissional <strong>' + Utils.escapeHtml(res.biggestEmpDrop.name) + '</strong> (' + Utils.fmtMoney(res.biggestEmpDrop.diff) + ')');
      var concentrationTxt = dropBits.length ? ' A maior concentração da queda foi ' + dropBits.join(' e ') + '.' : '';
      text = 'Receita caiu <strong>' + Math.abs(res.pct).toFixed(1) + '%</strong> (' + Utils.fmtMoney(res.diff) + ') em relação ao mesmo período do mês anterior (' + Utils.fmtMoney(res.revenueLast) + ' → ' + Utils.fmtMoney(res.revenueThis) + ').' + concentrationTxt;
      box.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><div class="al-diag-text">' + text + '</div>';
    }

    var target = Utils.qs("#sales-diagnostic");
    target.innerHTML = "";
    target.appendChild(box);

    var tbl = Utils.qs("#tbl-sales-breakdown");
    if (res.status === "na" || !res.catBreakdown.length) {
      Utils.emptyTable(tbl, "fa-chart-column", "Sem dados de categoria suficientes para comparação");
      return;
    }
    var salesRows = Utils.sortBy(res.catBreakdown, salesBreakdownSortState);
    tbl.innerHTML = '<thead><tr>' +
      Utils.thSort("Categoria", "name", salesBreakdownSortState) +
      Utils.thSort("Este Período", "thisV", salesBreakdownSortState, { className: "text-right" }) +
      Utils.thSort("Mesmo Período Mês Anterior", "lastV", salesBreakdownSortState, { className: "text-right" }) +
      Utils.thSort("Variação", "diff", salesBreakdownSortState, { className: "text-right" }) +
      '</tr></thead><tbody>' +
      salesRows.map(function (c) {
        var pctC = c.lastV > 0.01 ? (c.diff / c.lastV) * 100 : null;
        var deltaTxt = pctC === null ? "-" : ((pctC >= 0 ? "+" : "") + pctC.toFixed(1) + "%");
        var deltaClass = c.diff < 0 ? "text-danger" : "";
        return '<tr>' +
          '<td>' + Utils.escapeHtml(c.name) + '</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(c.thisV) + '</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(c.lastV) + '</td>' +
          '<td class="text-right text-num ' + deltaClass + '">' + deltaTxt + '</td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.wireSortHeaders(tbl, salesBreakdownSortState, function () { renderSalesDiagnostic(res); });
  }

  // ================= KPI grid =================
  function renderKpis(r) {
    var idleValue = (r.idle.hasData && r.idle.idle.length) ? (r.idle.idle[0].hour + "h") : "-";
    var idleSub = (r.idle.hasData && r.idle.idle.length) ? (r.idle.idle[0].count + " atend. em " + r.idle.windowDays + "d") : "Sem padrão identificado";

    var salesValue = r.sales.pct === null ? "N/D" : ((r.sales.pct >= 0 ? "+" : "") + r.sales.pct.toFixed(1) + "%");
    var salesSub = r.sales.status === "na" ? "sem base de comparação" : (r.sales.status === "down" ? "queda vs mês anterior" : "estável/alta vs mês anterior");
    var salesColor = r.sales.status === "down" ? "#c23b3b" : (r.sales.status === "up" ? "#1baf7a" : "#8a8a8a");
    var salesBg = r.sales.status === "down" ? "#fbe6e6" : (r.sales.status === "up" ? "#e2f5ec" : "var(--gray-100)");

    var kpis = [
      { label: "Clientes Faltosos", value: String(r.noShow.rows.length), sub: r.noShow.distinctClientCount + " cliente(s) distintos (" + r.noShow.windowDays + "d)", icon: "fa-user-slash", color: "#c23b3b", bg: "#fbe6e6" },
      { label: "Clientes Inativos", value: String(r.inactive.rows.length), sub: r.inactive.threshold + "+ dias sem retorno", icon: "fa-user-clock", color: "#b7791f", bg: "#fdf2df" },
      { label: "Profissionais Abaixo da Média", value: String(r.lowProd.rows.length), sub: "produção do mês atual", icon: "fa-arrow-trend-down", color: "#c23b3b", bg: "#fbe6e6" },
      { label: "Horário Mais Ocioso", value: idleValue, sub: idleSub, icon: "fa-clock", color: "#2a78d6", bg: "#e3eefb" },
      { label: "Recorrências Previstas", value: String(r.recurrence.rows.length), sub: "retorno em breve/vencido", icon: "fa-rotate", color: "#6f4fa0", bg: "#ece3f7" },
      { label: "Retornos Sugeridos", value: String(r.followup.rows.length), sub: "serviços de ciclo longo", icon: "fa-comment-dots", color: "#6f4fa0", bg: "#ece3f7" },
      { label: "Receita vs Mês Anterior", value: salesValue, sub: salesSub, icon: "fa-magnifying-glass-chart", color: salesColor, bg: salesBg }
    ];
    Utils.qs("#al-kpis").innerHTML = kpis.map(function (k) {
      return '<div class="kpi-card"><div class="kpi-icon" style="background:' + k.bg + ';color:' + k.color + ';"><i class="fa-solid ' + k.icon + '"></i></div>' +
        '<div class="kpi-label">' + k.label + '</div><div class="kpi-value">' + k.value + '</div>' +
        '<div class="kpi-delta text-muted" style="color:var(--gray-500);">' + k.sub + '</div></div>';
    }).join("");
  }
})();
