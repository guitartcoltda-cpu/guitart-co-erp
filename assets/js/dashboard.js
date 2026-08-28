(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    DB.ready.then(function () { setTimeout(init, 0); });
  });

  function init() {
    var pfCtrl = PeriodFilter.mount(document.getElementById("dash-period-filter"), {
      defaultPreset: "mes",
      label: "Período",
      onChange: function (range) { renderDashboard(range); }
    });
    renderDashboard(pfCtrl.getRange());
  }

  function renderDashboard(range) {
    var today = Utils.todayISO();

    var transactions = DB.all("transactions");
    var employees = DB.all("employees");
    var clients = DB.all("clients");
    var products = DB.all("products");
    var appointments = DB.all("appointments");
    var categories = DB.all("categories");
    var services = DB.all("services");

    // previous period of equal length, immediately preceding the selected
    // range — used to compute the "vs período anterior" deltas below.
    var spanDays = Utils.daysBetween(range.start, range.end) + 1;
    var prevEnd = Utils.addDays(range.start, -1);
    var prevStart = Utils.addDays(prevEnd, -(spanDays - 1));
    var prevRange = { start: prevStart, end: prevEnd };

    function inRange(t, r) { return t.date >= r.start && t.date <= r.end; }
    function byType(r, type) { return transactions.filter(function (t) { return t.type === type && inRange(t, r); }); }

    var revenueThis = sum(byType(range, "receita"));
    var expenseThis = sum(byType(range, "despesa"));
    var revenuePrev = sum(byType(prevRange, "receita"));
    var expensePrev = sum(byType(prevRange, "despesa"));
    var saldoThis = revenueThis - expenseThis;
    var saldoPrev = revenuePrev - expensePrev;

    var concludedInRange = appointments.filter(function (a) { return inRange(a, range) && a.status === "concluido"; });
    var ticketMedio = concludedInRange.length ? revenueThis / concludedInRange.length : 0;

    var pendentes = transactions.filter(function (t) { return t.type === "despesa" && t.status === "pendente" && inRange(t, range); });
    var pendenteAmount = sum(pendentes);

    var lowStock = products.filter(function (p) { return p.currentStock <= p.minStock; });

    // KPI cards
    var dRevenue = pctDelta(revenueThis, revenuePrev);
    var dExpense = pctDelta(expenseThis, expensePrev, true);
    var dSaldo = pctDelta(saldoThis, saldoPrev);
    var kpis = [
      { key: "receita", label: "Receita do Período", value: Utils.fmtMoney(revenueThis), delta: dRevenue, icon: "fa-arrow-trend-up", color: "#1baf7a", bg: "#e2f5ec" },
      { key: "despesa", label: "Despesas do Período", value: Utils.fmtMoney(expenseThis), delta: dExpense, icon: "fa-arrow-trend-down", color: "#c23b3b", bg: "#fbe6e6" },
      { key: "saldo", label: "Saldo do Período", value: Utils.fmtMoney(saldoThis), delta: dSaldo, icon: "fa-scale-balanced", color: "#2a78d6", bg: "#e3eefb" },
      { key: "ticket", label: "Ticket Médio", value: Utils.fmtMoney(ticketMedio), sub: concludedInRange.length + " atendimento(s)", icon: "fa-receipt", color: "#b8923f", bg: "#f6ecd3" },
      { key: "pendentes", label: "Despesas Pendentes", value: Utils.fmtMoney(pendenteAmount), sub: pendentes.length + " lançamento(s)", icon: "fa-hourglass-half", color: "#b7791f", bg: "#fdf2df" },
      { key: "estoque", label: "Estoque Baixo", value: String(lowStock.length), sub: "produto(s) no mínimo ou abaixo", icon: "fa-triangle-exclamation", color: "#c23b3b", bg: "#fbe6e6" }
    ];
    var grid = document.getElementById("kpi-grid");
    grid.innerHTML = kpis.map(function (k) {
      var deltaHtml;
      if (k.delta === undefined) {
        deltaHtml = '<div class="kpi-delta text-muted" style="color:var(--gray-500);">' + (k.sub || "") + '</div>';
      } else if (k.delta.na) {
        deltaHtml = '<div class="kpi-delta text-muted" style="color:var(--gray-500);">Sem dados no período anterior</div>';
      } else {
        var v = k.delta.value;
        deltaHtml = '<div class="kpi-delta ' + (v >= 0 ? "up" : "down") + '"><i class="fa-solid fa-caret-' + (v >= 0 ? "up" : "down") + '"></i> ' + Math.abs(v).toFixed(1) + '% vs período anterior</div>';
      }
      return '<div class="kpi-card">' +
        '<div class="kpi-icon" style="background:' + k.bg + ';color:' + k.color + ';"><i class="fa-solid ' + k.icon + '"></i></div>' +
        '<button type="button" class="kpi-menu-btn" data-kpi-detail="' + k.key + '" title="Ver detalhes"><i class="fa-solid fa-ellipsis-vertical"></i></button>' +
        '<div class="kpi-label">' + k.label + '</div>' +
        '<div class="kpi-value">' + k.value + '</div>' +
        deltaHtml +
        '</div>';
    }).join("");
    Utils.qsa("[data-kpi-detail]", grid).forEach(function (btn) {
      btn.addEventListener("click", function () { openKpiDetail(btn.getAttribute("data-kpi-detail")); });
    });

    // ---- Detalhe por KPI ("..." no card) --------------------------------
    // Cada card mostra um número resumido; este menu abre a composição por
    // trás dele, sem precisar sair do Dashboard ou ir caçar em outra tela.
    function detailTableHtml(rows, columns, emptyMsg) {
      if (!rows.length) return '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-folder-open"></i></div><h4>' + emptyMsg + '</h4></div>';
      return '<div class="table-wrap"><table class="data-table"><thead><tr>' +
        columns.map(function (c) { return '<th' + (c.right ? ' class="text-right"' : '') + '>' + c.label + '</th>'; }).join("") +
        '</tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr>' + columns.map(function (c) { return '<td' + (c.right ? ' class="text-right text-num"' : '') + '>' + c.render(r) + '</td>'; }).join("") + '</tr>';
        }).join("") +
        '</tbody></table></div>';
    }

    function openKpiDetail(key) {
      var title, bodyHtml;
      var periodLabel = Utils.fmtDate(range.start) + " – " + Utils.fmtDate(range.end);

      if (key === "receita" || key === "despesa") {
        var isRev = key === "receita";
        var rows = byType(range, isRev ? "receita" : "despesa").slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
        title = isRev ? "Receita do Período" : "Despesas do Período";
        bodyHtml = '<div class="small text-muted mb-12">Lançamentos de ' + (isRev ? "receita" : "despesa") + ' entre ' + periodLabel + ' que somam ' + Utils.fmtMoney(isRev ? revenueThis : expenseThis) + '.</div>' +
          detailTableHtml(rows, [
            { label: "Data", render: function (t) { return Utils.fmtDate(t.date); } },
            { label: "Descrição", render: function (t) { return Utils.escapeHtml(t.description || "-"); } },
            { label: isRev ? "Forma de Pagamento" : "Categoria", render: function (t) {
                if (isRev) return Utils.escapeHtml(t.paymentMethod || "-");
                var cat = categories.find(function (c) { return c.id === t.categoryId; });
                return Utils.escapeHtml(cat ? cat.name : "-");
              } },
            { label: "Valor", right: true, render: function (t) { return Utils.fmtMoney(t.amount); } }
          ], "Nenhum lançamento no período");
      } else if (key === "saldo") {
        title = "Saldo do Período";
        bodyHtml = '<table class="kv-table">' +
          '<tr><td>Receita (' + periodLabel + ')</td><td class="text-right text-num">' + Utils.fmtMoney(revenueThis) + '</td></tr>' +
          '<tr><td>Despesas (' + periodLabel + ')</td><td class="text-right text-num">' + Utils.fmtMoney(expenseThis) + '</td></tr>' +
          '<tr><td class="font-bold">Saldo</td><td class="text-right text-num font-bold">' + Utils.fmtMoney(saldoThis) + '</td></tr>' +
          '</table>' +
          '<div class="small text-muted mt-16">Saldo = receita do período − despesas do período. Use os cards "Receita do Período" e "Despesas do Período" para ver os lançamentos que compõem cada lado.</div>';
      } else if (key === "ticket") {
        title = "Ticket Médio";
        var rows2 = concludedInRange.slice().sort(function (a, b) { return b.date.localeCompare(a.date) || b.time.localeCompare(a.time); });
        bodyHtml = '<div class="small text-muted mb-12">Ticket médio = receita de serviços concluídos ÷ nº de atendimentos concluídos no período (' + concludedInRange.length + ' atendimento(s), ' + Utils.fmtMoney(ticketMedio) + ' de média).</div>' +
          detailTableHtml(rows2, [
            { label: "Data", render: function (a) { return Utils.fmtDate(a.date) + " " + a.time; } },
            { label: "Cliente", render: function (a) { var c = clients.find(function (x) { return x.id === a.clientId; }); return Utils.escapeHtml(c ? c.name : "-"); } },
            { label: "Serviço", render: function (a) { var s = services.find(function (x) { return x.id === a.serviceId; }); return Utils.escapeHtml(s ? s.name : "-"); } },
            { label: "Profissional", render: function (a) { var e = employees.find(function (x) { return x.id === a.employeeId; }); return Utils.escapeHtml(e ? e.name : "-"); } },
            { label: "Valor", right: true, render: function (a) { return Utils.fmtMoney(a.price); } }
          ], "Nenhum atendimento concluído no período");
      } else if (key === "pendentes") {
        title = "Despesas Pendentes";
        var rows3 = pendentes.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
        bodyHtml = '<div class="small text-muted mb-12">Despesas com vencimento no período selecionado que ainda não foram marcadas como pagas.</div>' +
          detailTableHtml(rows3, [
            { label: "Vencimento", render: function (t) { return Utils.fmtDate(t.date); } },
            { label: "Descrição", render: function (t) { return Utils.escapeHtml(t.description || "-"); } },
            { label: "Categoria", render: function (t) { var cat = categories.find(function (c) { return c.id === t.categoryId; }); return Utils.escapeHtml(cat ? cat.name : "-"); } },
            { label: "Valor", right: true, render: function (t) { return Utils.fmtMoney(t.amount); } }
          ], "Nenhuma despesa pendente no período");
      } else if (key === "estoque") {
        title = "Estoque Baixo";
        bodyHtml = '<div class="small text-muted mb-12">Produtos com o estoque atual no mínimo cadastrado ou abaixo dele (visão atual, não depende do período selecionado).</div>' +
          detailTableHtml(lowStock, [
            { label: "Produto", render: function (p) { return Utils.escapeHtml(p.name); } },
            { label: "Estoque Atual", right: true, render: function (p) { return p.currentStock + " " + p.unit; } },
            { label: "Mínimo", right: true, render: function (p) { return p.minStock + " " + p.unit; } },
            { label: "Situação", render: function (p) { return p.currentStock <= 0 ? '<span class="badge badge-danger">Zerado</span>' : '<span class="badge badge-warning">Baixo</span>'; } }
          ], "Nenhum produto abaixo do mínimo");
      } else {
        return;
      }

      Modal.open({ title: title, wide: true, bodyHtml: bodyHtml, footHtml: '<button class="btn btn-secondary" data-close-modal>Fechar</button>' });
    }

    // Chart: revenue x expense last 6 months (fixed rolling window — gives
    // a stable multi-month trend regardless of the period filter above)
    var months6 = [];
    for (var i = 5; i >= 0; i--) months6.push(Utils.monthKey(Utils.addMonths(today, -i)));
    function sumMonth(mkey, type) {
      return sum(transactions.filter(function (t) { return Utils.monthKey(t.date) === mkey && t.type === type; }));
    }
    var revData = months6.map(function (m) { return round2(sumMonth(m, "receita")); });
    var expData = months6.map(function (m) { return round2(sumMonth(m, "despesa")); });
    Charts.line({
      container: document.getElementById("chart-revenue-expense"),
      categories: months6.map(function (m) { return Utils.monthLabel(m + "-01"); }),
      series: [
        { name: "Receita", color: Charts.palette[2], data: revData },
        { name: "Despesa", color: Charts.palette[7], data: expData }
      ],
      area: true, height: 260,
      valueFormatter: function (v) { return Utils.fmtMoney(v); }
    });

    // Chart: expenses by category (selected period)
    var expInRange = byType(range, "despesa");
    var catTotals = categories.map(function (cat) {
      var total = sum(expInRange.filter(function (t) { return t.categoryId === cat.id; }));
      return { name: cat.name, total: total };
    }).filter(function (c) { return c.total > 0; }).sort(function (a, b) { return b.total - a.total; });
    Charts.rankingList({
      container: document.getElementById("chart-cost-center"),
      items: catTotals.map(function (c) { return { label: c.name, value: round2(c.total) }; }),
      maxItems: 10,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem despesas lançadas no período"
    });
    var ccSub = document.getElementById("cc-chart-sub");
    if (ccSub) ccSub.textContent = Utils.fmtDate(range.start) + " – " + Utils.fmtDate(range.end);

    // Upcoming appointments (always forward-looking from today, not period-scoped)
    var upcoming = appointments.filter(function (a) { return a.status === "agendado" && a.date >= today; })
      .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); }).slice(0, 8);
    var tbl = document.getElementById("tbl-upcoming");
    if (!upcoming.length) {
      Utils.emptyTable(tbl, "fa-calendar", "Nenhum agendamento futuro");
    } else {
      tbl.innerHTML = '<thead><tr><th>Data</th><th>Hora</th><th>Cliente</th><th>Serviço</th><th>Profissional</th></tr></thead><tbody>' +
        upcoming.map(function (a) {
          var c = clients.find(function (x) { return x.id === a.clientId; });
          var e = employees.find(function (x) { return x.id === a.employeeId; });
          var s = services.find(function (x) { return x.id === a.serviceId; });
          return '<tr><td>' + Utils.fmtDate(a.date) + '</td><td>' + a.time + '</td><td>' + Utils.escapeHtml(c ? c.name : "-") +
            '</td><td>' + Utils.escapeHtml(s ? s.name : "-") + '</td><td>' + Utils.escapeHtml(e ? e.name : "-") + '</td></tr>';
        }).join("") + '</tbody>';
    }

    // Stock alerts (current snapshot, not period-dependent)
    var alertsEl = document.getElementById("stock-alerts");
    if (!lowStock.length) {
      alertsEl.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-circle-check"></i></div><h4>Tudo certo com o estoque</h4></div>';
    } else {
      alertsEl.innerHTML = lowStock.slice(0, 6).map(function (p) {
        var pct = p.minStock > 0 ? Math.min(1, p.currentStock / p.minStock) : 0;
        var isCritical = p.currentStock <= 0;
        var sevColor = isCritical ? "var(--color-danger)" : "var(--color-warning)";
        var badgeClass = isCritical ? "badge-danger" : "badge-warning";
        var badgeLabel = isCritical ? "Zerado" : "Baixo";
        return '<div class="stock-bar-row mt-8" style="border-left:3px solid ' + sevColor + ';padding-left:10px;">' +
          '<div class="stock-name"><i class="fa-solid fa-triangle-exclamation" style="color:' + sevColor + ';margin-right:6px;"></i>' + Utils.escapeHtml(p.name) +
          ' <span class="badge ' + badgeClass + '" style="margin-left:6px;">' + badgeLabel + '</span></div>' +
          '<div class="progress-track"><div class="progress-fill" style="width:' + (pct * 100) + '%;background:' + sevColor + ';"></div></div>' +
          '<div class="small text-muted" style="width:70px;text-align:right;">' + p.currentStock + '/' + p.minStock + ' ' + p.unit + '</div>' +
          '</div>';
      }).join("");
    }

    // Top services in the selected period
    var servRevenue = {};
    byType(range, "receita").filter(function (t) { return !t.productId; }).forEach(function (t) {
      var appt = appointments.find(function (a) { return a.id === t.appointmentId; });
      if (!appt) return;
      servRevenue[appt.serviceId] = (servRevenue[appt.serviceId] || 0) + t.amount;
    });
    var topServices = Object.keys(servRevenue).map(function (sid) {
      var s = services.find(function (x) { return x.id === sid; });
      return { name: s ? s.name : "?", total: servRevenue[sid] };
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, 6);
    Charts.bar({
      container: document.getElementById("chart-top-services"),
      categories: topServices.map(function (s) { return s.name; }),
      series: [{ name: "Receita", color: Charts.palette[4], data: topServices.map(function (s) { return round2(s.total); }) }],
      height: 260,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem atendimentos concluídos no período"
    });

    // Payment methods breakdown (selected period)
    var pmEl = document.getElementById("payment-methods");
    var pmTotals = {};
    byType(range, "receita").forEach(function (t) { pmTotals[t.paymentMethod] = (pmTotals[t.paymentMethod] || 0) + t.amount; });
    var pmList = Object.keys(pmTotals).map(function (k) { return { name: k, total: pmTotals[k] }; }).sort(function (a, b) { return b.total - a.total; });
    var pmTotal = sum2(pmList);
    if (!pmList.length) {
      pmEl.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-credit-card"></i></div><h4>Sem receitas no período</h4></div>';
    } else {
      pmEl.innerHTML = pmList.map(function (p, idx) {
        var pct = pmTotal > 0 ? (p.total / pmTotal) * 100 : 0;
        return '<div class="mt-8">' +
          '<div class="flex justify-between small"><span class="font-bold">' + Utils.escapeHtml(p.name) + '</span><span>' + Utils.fmtMoney(p.total) + ' (' + pct.toFixed(0) + '%)</span></div>' +
          '<div class="progress-track mt-8"><div class="progress-fill" style="width:' + pct + '%;background:' + Charts.palette[idx % Charts.palette.length] + ';"></div></div>' +
          '</div>';
      }).join("");
    }
  }

  function sum(arr) { return arr.reduce(function (s, t) { return s + t.amount; }, 0); }
  function sum2(arr) { return arr.reduce(function (s, t) { return s + t.total; }, 0); }
  function round2(n) { return Math.round(n * 100) / 100; }

  // Returns { value, na }. `na` (not available) is set when the previous
  // period had no meaningful baseline (near zero), which used to produce
  // absurd percentages like "2204.8%". In that case the UI shows a plain
  // "sem dados no período anterior" message instead of a number.
  // The computed percentage is also clamped to ±999% so a tiny baseline
  // with a large swing never explodes the layout.
  function pctDelta(cur, prev, invertGood) {
    if (Math.abs(prev) < 0.01) {
      return { na: true };
    }
    var d = ((cur - prev) / Math.abs(prev)) * 100;
    if (invertGood) d = -d;
    d = Math.max(-999, Math.min(999, d));
    return { value: d, na: false };
  }
})();
