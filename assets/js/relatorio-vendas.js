/* ============================================================
   Salão ERP — Relatório de Vendas
   Acompanhamento em tempo real de todas as vendas (serviços +
   produtos) do salão. Pensado para conferência e prestação de
   contas: sempre reflete os lançamentos de receita já registrados
   no sistema (agenda concluída, vendas de produto no estoque, etc).
   ============================================================ */
(function () {
  "use strict";

  var PAGE_SIZE = 25;
  var pfCtrl = null;
  var state = { page: 1, tipo: "", employee: "", pay: "", search: "" };

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    pfCtrl = PeriodFilter.mount(document.getElementById("rv-period-filter"), {
      defaultPreset: "mes",
      label: "Período",
      onChange: function () { state.page = 1; render(); }
    });

    var employees = DB.all("employees").sort(function (a, b) { return a.name.localeCompare(b.name); });
    var empSel = Utils.qs("#rv-employee");
    employees.forEach(function (e) {
      var o = document.createElement("option"); o.value = e.id; o.textContent = e.name; empSel.appendChild(o);
    });

    var paySel = Utils.qs("#rv-pay");
    ["Pix", "Cartão de Crédito", "Cartão de Débito", "Dinheiro", "Transferência", "Boleto"].forEach(function (p) {
      var o = document.createElement("option"); o.value = p; o.textContent = p; paySel.appendChild(o);
    });

    Utils.qs("#rv-tipo").addEventListener("change", function (e) { state.tipo = e.target.value; state.page = 1; render(); });
    empSel.addEventListener("change", function (e) { state.employee = e.target.value; state.page = 1; render(); });
    paySel.addEventListener("change", function (e) { state.pay = e.target.value; state.page = 1; render(); });
    Utils.qs("#rv-search").addEventListener("input", Utils.debounce(function (e) { state.search = e.target.value.toLowerCase(); state.page = 1; render(); }, 250));
    Utils.qs("#btn-rv-clear").addEventListener("click", function () {
      state = { page: 1, tipo: "", employee: "", pay: "", search: "" };
      Utils.qs("#rv-tipo").value = ""; empSel.value = ""; paySel.value = ""; Utils.qs("#rv-search").value = "";
      pfCtrl.setPreset("mes");
      render();
    });
    Utils.qs("#btn-rv-export").addEventListener("click", exportCSV);

    render();
  }

  // A "venda" is any receita transaction: revenue from a concluded service
  // appointment (no productId) or from a product sold at the counter
  // (has productId). This mirrors how the rest of the system tags them.
  function getSales() {
    var range = pfCtrl.getRange();
    var txns = DB.all("transactions").filter(function (t) { return t.type === "receita"; });
    txns = PeriodFilter.filterByDate(txns, "date", range);

    var employees = DB.all("employees"), clients = DB.all("clients");

    return txns.filter(function (t) {
      var isProduto = !!t.productId;
      if (state.tipo === "servico" && isProduto) return false;
      if (state.tipo === "produto" && !isProduto) return false;
      if (state.employee && t.employeeId !== state.employee) return false;
      if (state.pay && t.paymentMethod !== state.pay) return false;
      if (state.search) {
        var cli = clients.find(function (c) { return c.id === t.clientId; });
        var emp = employees.find(function (e) { return e.id === t.employeeId; });
        var hay = (t.description + " " + (cli ? cli.name : "") + " " + (emp ? emp.name : "")).toLowerCase();
        if (hay.indexOf(state.search) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""); });
  }

  function render() {
    var sales = getSales();
    var employees = DB.all("employees"), clients = DB.all("clients"), products = DB.all("products"), services = DB.all("services");

    var total = sum(sales);
    var produtoTotal = sum(sales.filter(function (t) { return !!t.productId; }));
    var servicoTotal = total - produtoTotal;
    var ticketMedio = sales.length ? total / sales.length : 0;

    document.getElementById("rv-summary").innerHTML = [
      kpi("Total de Vendas", Utils.fmtMoney(total), "fa-cash-register", "#2a78d6", "#e3eefb"),
      kpi("Nº de Vendas", String(sales.length), "fa-receipt", "#4a3aa7", "#ece8f8"),
      kpi("Ticket Médio", Utils.fmtMoney(ticketMedio), "fa-tags", "#b8923f", "#f6ecd3"),
      kpi("Serviços x Produtos", Utils.fmtMoney(servicoTotal) + " / " + Utils.fmtMoney(produtoTotal), "fa-scale-balanced", "#1baf7a", "#e2f5ec")
    ].join("");

    document.getElementById("rv-count-sub").textContent = sales.length + " venda(s) no período selecionado";

    // daily trend
    var byDay = {};
    sales.forEach(function (t) { byDay[t.date] = (byDay[t.date] || 0) + t.amount; });
    var days = Object.keys(byDay).sort();
    Charts.line({
      container: document.getElementById("chart-rv-daily"),
      categories: days.map(function (d) { return Utils.fmtDate(d); }),
      series: [{ name: "Vendas", color: Charts.palette[0], data: days.map(function (d) { return round2(byDay[d]); }) }],
      height: 240,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem vendas no período"
    });

    // by payment method
    var byPay = {};
    sales.forEach(function (t) { var p = t.paymentMethod || "Não informado"; byPay[p] = (byPay[p] || 0) + t.amount; });
    var payEntries = Object.keys(byPay).map(function (k) { return { name: k, value: byPay[k] }; }).sort(function (a, b) { return b.value - a.value; });
    Charts.bar({
      container: document.getElementById("chart-rv-pay"),
      categories: payEntries.map(function (p) { return p.name; }),
      series: [{ name: "Vendas", color: Charts.palette[1], data: payEntries.map(function (p) { return round2(p.value); }) }],
      height: 220,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem vendas no período"
    });

    // top items sold (service name or product name)
    var byItem = {};
    sales.forEach(function (t) {
      var name;
      if (t.productId) { var p = products.find(function (x) { return x.id === t.productId; }); name = p ? p.name : "Produto"; }
      else { name = t.description || "Serviço"; }
      byItem[name] = (byItem[name] || 0) + t.amount;
    });
    var itemEntries = Object.keys(byItem).map(function (k) { return { name: k, value: byItem[k] }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
    Charts.bar({
      container: document.getElementById("chart-rv-top"),
      categories: itemEntries.map(function (i) { return i.name; }),
      series: [{ name: "Vendas", color: Charts.palette[2], data: itemEntries.map(function (i) { return round2(i.value); }) }],
      height: 220,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem vendas no período"
    });

    // table
    var totalPages = Math.max(1, Math.ceil(sales.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    var pageItems = sales.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

    var tbl = document.getElementById("tbl-rv");
    if (!pageItems.length) {
      Utils.emptyTable(tbl, "fa-folder-open", "Nenhuma venda encontrada", "Ajuste os filtros ou o período selecionado.");
    } else {
      tbl.innerHTML = '<thead><tr><th>Data</th><th>Descrição</th><th>Cliente</th><th>Profissional</th><th>Tipo</th><th>Pagamento</th><th>Status</th><th class="text-right">Valor</th></tr></thead><tbody>' +
        pageItems.map(function (t) {
          var cli = clients.find(function (c) { return c.id === t.clientId; });
          var emp = employees.find(function (e) { return e.id === t.employeeId; });
          var tipo = t.productId ? '<span class="chip">Produto</span>' : '<span class="chip">Serviço</span>';
          return '<tr>' +
            '<td class="text-num">' + Utils.fmtDate(t.date) + '</td>' +
            '<td>' + Utils.escapeHtml(t.description) + '</td>' +
            '<td>' + Utils.escapeHtml(cli ? cli.name : "-") + '</td>' +
            '<td>' + Utils.escapeHtml(emp ? emp.name : "-") + '</td>' +
            '<td>' + tipo + '</td>' +
            '<td>' + Utils.escapeHtml(t.paymentMethod || "-") + '</td>' +
            '<td>' + (t.status === "pago" ? '<span class="badge badge-success">Pago</span>' : '<span class="badge badge-warning">Pendente</span>') + '</td>' +
            '<td class="text-right text-num text-success">+ ' + Utils.fmtMoney(t.amount) + '</td>' +
            '</tr>';
        }).join("") + '</tbody>';
    }

    var pag = document.getElementById("rv-pagination");
    pag.innerHTML = '<div>Mostrando ' + pageItems.length + ' de ' + sales.length + ' venda(s)</div>' +
      '<div class="pg-btns">' +
      '<button class="btn btn-sm btn-secondary" id="rv-pg-prev" ' + (state.page <= 1 ? "disabled" : "") + '>Anterior</button>' +
      '<span style="padding:6px 10px;">Página ' + state.page + ' de ' + totalPages + '</span>' +
      '<button class="btn btn-sm btn-secondary" id="rv-pg-next" ' + (state.page >= totalPages ? "disabled" : "") + '>Próxima</button>' +
      '</div>';
    var prevBtn = document.getElementById("rv-pg-prev"), nextBtn = document.getElementById("rv-pg-next");
    if (prevBtn) prevBtn.addEventListener("click", function () { state.page--; render(); });
    if (nextBtn) nextBtn.addEventListener("click", function () { state.page++; render(); });
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }
  function sum(arr) { return arr.reduce(function (s, t) { return s + t.amount; }, 0); }
  function round2(n) { return Math.round(n * 100) / 100; }

  function exportCSV() {
    var sales = getSales();
    var employees = DB.all("employees"), clients = DB.all("clients");
    var header = ["Data", "Descrição", "Cliente", "Profissional", "Tipo", "Forma de Pagamento", "Status", "Valor"];
    var rows = sales.map(function (t) {
      var cli = clients.find(function (c) { return c.id === t.clientId; });
      var emp = employees.find(function (e) { return e.id === t.employeeId; });
      return [t.date, t.description, cli ? cli.name : "", emp ? emp.name : "", t.productId ? "Produto" : "Serviço", t.paymentMethod || "", t.status, String(t.amount).replace(".", ",")];
    });
    var csv = [header].concat(rows).map(function (r) {
      return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(";");
    }).join("\n");
    Utils.downloadFile("relatorio_vendas_" + Utils.todayISO() + ".csv", "﻿" + csv, "text/csv;charset=utf-8");
    Toast.show("Relatório de vendas exportado em CSV", "success");
    if (DB.log) DB.log("Exportação", "Exportou relatório de vendas em CSV (" + sales.length + " venda(s))");
  }
})();
