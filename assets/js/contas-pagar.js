/* ============================================================
   Salão ERP — Contas a Pagar
   Previsão de pagamentos: lista todas as despesas em aberto
   (status "pendente"), agrupadas por situação de vencimento, com
   filtros, gráfico de previsão e ação de "Marcar como pago".
   ============================================================ */
(function () {
  "use strict";

  var BUCKET_LABELS = {
    vencida: "Vencida", hoje: "Vence Hoje", "7d": "Próx. 7 dias",
    "30d": "8–30 dias", futuro: "Mais de 30 dias"
  };

  var state = { bucket: "", cc: "", cat: "", search: "" };
  var selectedIds = {}; // id -> true, only for currently pending/visible rows

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    var costCenters = DB.all("costCenters");
    var categories = DB.all("categories").filter(function (c) { return c.type === "despesa"; });
    var ccSel = Utils.qs("#cp-cc"), catSel = Utils.qs("#cp-cat");
    costCenters.forEach(function (c) { var o = document.createElement("option"); o.value = c.id; o.textContent = c.name; ccSel.appendChild(o); });
    categories.forEach(function (c) { var o = document.createElement("option"); o.value = c.id; o.textContent = c.name; catSel.appendChild(o); });

    Utils.qsa("[data-bucket]", Utils.qs("#cp-buckets")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        Utils.qsa("[data-bucket]", Utils.qs("#cp-buckets")).forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.bucket = btn.getAttribute("data-bucket");
        selectedIds = {};
        render();
      });
    });
    ccSel.addEventListener("change", function (e) { state.cc = e.target.value; selectedIds = {}; render(); });
    catSel.addEventListener("change", function (e) { state.cat = e.target.value; selectedIds = {}; render(); });
    Utils.qs("#cp-search").addEventListener("input", Utils.debounce(function (e) { state.search = e.target.value.toLowerCase(); selectedIds = {}; render(); }, 250));
    Utils.qs("#btn-cp-clear").addEventListener("click", function () {
      state = { bucket: "", cc: "", cat: "", search: "" };
      selectedIds = {};
      ccSel.value = ""; catSel.value = ""; Utils.qs("#cp-search").value = "";
      Utils.qsa("[data-bucket]", Utils.qs("#cp-buckets")).forEach(function (b, i) { b.classList.toggle("active", i === 0); });
      render();
    });
    Utils.qs("#btn-cp-export").addEventListener("click", exportCSV);
    Utils.qs("#btn-cp-bulk-pay").addEventListener("click", bulkMarkAsPaid);

    render();
  }

  function bucketFor(dateStr, today) {
    if (dateStr < today) return "vencida";
    if (dateStr === today) return "hoje";
    var days = Utils.daysBetween(today, dateStr);
    if (days <= 7) return "7d";
    if (days <= 30) return "30d";
    return "futuro";
  }

  function getAll() {
    var today = Utils.todayISO();
    return DB.all("transactions").filter(function (t) { return t.type === "despesa" && t.status === "pendente"; })
      .map(function (t) { return Object.assign({ _bucket: bucketFor(t.date, today) }, t); });
  }

  function getFiltered() {
    var list = getAll();
    return list.filter(function (t) {
      if (state.bucket && t._bucket !== state.bucket) return false;
      if (state.cc && t.costCenterId !== state.cc) return false;
      if (state.cat && t.categoryId !== state.cat) return false;
      if (state.search && t.description.toLowerCase().indexOf(state.search) === -1) return false;
      return true;
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  function render() {
    var today = Utils.todayISO();
    var all = getAll();
    var costCenters = DB.all("costCenters"), categories = DB.all("categories");

    var totalAberto = sum(all);
    var vencidas = all.filter(function (t) { return t._bucket === "vencida"; });
    var venceHoje = all.filter(function (t) { return t._bucket === "hoje"; });
    var proximos7 = all.filter(function (t) { return t._bucket === "7d"; });
    var proximos30 = all.filter(function (t) { return t._bucket === "30d"; });

    document.getElementById("cp-summary").innerHTML = [
      kpi("Total em Aberto", Utils.fmtMoney(totalAberto), all.length + " conta(s)", "fa-file-invoice-dollar", "#2a78d6", "#e3eefb"),
      kpi("Vencidas", Utils.fmtMoney(sum(vencidas)), vencidas.length + " conta(s)", "fa-triangle-exclamation", "#c23b3b", "#fbe6e6"),
      kpi("Vence Hoje", Utils.fmtMoney(sum(venceHoje)), venceHoje.length + " conta(s)", "fa-calendar-day", "#b7791f", "#fdf2df"),
      kpi("Próx. 7 dias", Utils.fmtMoney(sum(proximos7)), proximos7.length + " conta(s)", "fa-calendar-week", "#b8923f", "#f6ecd3"),
      kpi("Próx. 8–30 dias", Utils.fmtMoney(sum(proximos30)), proximos30.length + " conta(s)", "fa-calendar", "#1baf7a", "#e2f5ec")
    ].join("");

    // forecast chart (respects cc/cat/search filters, not the bucket filter,
    // so the chart always shows the full breakdown to navigate by)
    var scoped = all.filter(function (t) {
      if (state.cc && t.costCenterId !== state.cc) return false;
      if (state.cat && t.categoryId !== state.cat) return false;
      if (state.search && t.description.toLowerCase().indexOf(state.search) === -1) return false;
      return true;
    });
    var bucketOrder = ["vencida", "hoje", "7d", "30d", "futuro"];
    var bucketTotals = bucketOrder.map(function (b) { return round2(sum(scoped.filter(function (t) { return t._bucket === b; }))); });
    Charts.bar({
      container: document.getElementById("chart-cp-forecast"),
      categories: bucketOrder.map(function (b) { return BUCKET_LABELS[b]; }),
      series: [{ name: "Em aberto", color: Charts.palette[1], data: bucketTotals }],
      height: 240,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Nenhuma despesa pendente"
    });

    // by cost center (respects current filters, incl. bucket)
    var filteredForCc = getFiltered();
    var ccTotals = costCenters.map(function (cc) {
      return { name: cc.name, total: sum(filteredForCc.filter(function (t) { return t.costCenterId === cc.id; })) };
    }).filter(function (c) { return c.total > 0; }).sort(function (a, b) { return b.total - a.total; });
    Charts.bar({
      container: document.getElementById("chart-cp-cc"),
      categories: ccTotals.map(function (c) { return c.name; }),
      series: [{ name: "Em aberto", color: Charts.palette[4], data: ccTotals.map(function (c) { return round2(c.total); }) }],
      height: 240,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem despesas pendentes com esse filtro"
    });

    // ranking chart — biggest pending expenses by category (respects current filters)
    var catTotals = categories.map(function (c) {
      return { name: c.name, total: sum(filteredForCc.filter(function (t) { return t.categoryId === c.id; })) };
    }).filter(function (c) { return c.total > 0; }).sort(function (a, b) { return b.total - a.total; }).slice(0, 8);
    Charts.rankingList({
      container: document.getElementById("chart-cp-ranking"),
      items: catTotals.map(function (c) { return { label: c.name, value: round2(c.total) }; }),
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem despesas pendentes com esse filtro"
    });

    // table
    var filtered = filteredForCc;
    // drop selections that are no longer visible under the current filters
    var visibleIds = {};
    filtered.forEach(function (t) { visibleIds[t.id] = true; });
    Object.keys(selectedIds).forEach(function (id) { if (!visibleIds[id]) delete selectedIds[id]; });

    document.getElementById("cp-count-sub").textContent = filtered.length + " conta(s) a pagar";
    var tbl = document.getElementById("tbl-cp");
    if (!filtered.length) {
      Utils.emptyTable(tbl, "fa-circle-check", "Nenhuma conta a pagar encontrada", "Ajuste os filtros ou a situação selecionada.");
    } else {
      tbl.innerHTML = '<thead><tr><th class="cp-col-check"><input type="checkbox" id="cp-select-all"></th><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Centro de Custo</th><th>Situação</th><th class="text-right">Valor</th><th></th></tr></thead><tbody>' +
        filtered.map(function (t) {
          var cat = categories.find(function (c) { return c.id === t.categoryId; });
          var cc = costCenters.find(function (c) { return c.id === t.costCenterId; });
          return '<tr>' +
            '<td class="cp-col-check"><input type="checkbox" class="cp-row-check" data-id="' + t.id + '"' + (selectedIds[t.id] ? " checked" : "") + '></td>' +
            '<td class="text-num">' + Utils.fmtDate(t.date) + '</td>' +
            '<td>' + Utils.escapeHtml(t.description) + '</td>' +
            '<td>' + (cat ? '<span class="chip">' + Utils.escapeHtml(cat.name) + '</span>' : "-") + '</td>' +
            '<td>' + Utils.escapeHtml(cc ? cc.name : "-") + '</td>' +
            '<td>' + situationBadge(t._bucket) + '</td>' +
            '<td class="text-right text-num text-danger">' + Utils.fmtMoney(t.amount) + '</td>' +
            '<td><button class="btn btn-sm btn-primary" data-pay="' + t.id + '">Marcar como pago</button></td>' +
            '</tr>';
        }).join("") + '</tbody>';
      Utils.qsa("[data-pay]", tbl).forEach(function (b) { b.addEventListener("click", function () { openPayModal(b.getAttribute("data-pay")); }); });
      Utils.qsa(".cp-row-check", tbl).forEach(function (cb) {
        cb.addEventListener("change", function () {
          var id = cb.getAttribute("data-id");
          if (cb.checked) selectedIds[id] = true; else delete selectedIds[id];
          updateSelectAllState(filtered);
          updateBulkBar();
        });
      });
      var selectAll = document.getElementById("cp-select-all");
      selectAll.addEventListener("change", function () {
        filtered.forEach(function (t) { if (selectAll.checked) selectedIds[t.id] = true; else delete selectedIds[t.id]; });
        Utils.qsa(".cp-row-check", tbl).forEach(function (cb) { cb.checked = selectAll.checked; });
        updateBulkBar();
      });
      updateSelectAllState(filtered);
    }
    updateBulkBar();
  }

  function updateSelectAllState(filtered) {
    var selectAll = document.getElementById("cp-select-all");
    if (!selectAll) return;
    var selectedCount = filtered.filter(function (t) { return selectedIds[t.id]; }).length;
    selectAll.checked = filtered.length > 0 && selectedCount === filtered.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < filtered.length;
  }

  function updateBulkBar() {
    var count = Object.keys(selectedIds).length;
    var bar = document.getElementById("cp-bulk-bar");
    bar.classList.toggle("show", count > 0);
    document.getElementById("cp-bulk-count").textContent = count + (count === 1 ? " conta selecionada" : " contas selecionadas");
  }

  function bulkMarkAsPaid() {
    var ids = Object.keys(selectedIds);
    if (!ids.length) return;
    var today = Utils.todayISO();
    var count = 0, total = 0;
    DB.batch(function () {
      ids.forEach(function (id) {
        var t = DB.get("transactions", id);
        if (!t || t.status !== "pendente") return;
        total += t.amount;
        DB.update("transactions", id, { status: "pago", date: today });
        count++;
      });
    });
    DB.log("Contas a Pagar", "Marcou " + count + " conta(s) como pago em lote (" + Utils.fmtMoney(total) + ")");
    Toast.show(count + " conta(s) marcada(s) como paga(s)", "success");
    selectedIds = {};
    render();
  }

  function situationBadge(bucket) {
    if (bucket === "vencida") return '<span class="badge badge-danger">Vencida</span>';
    if (bucket === "hoje") return '<span class="badge badge-warning">Vence Hoje</span>';
    if (bucket === "7d") return '<span class="badge badge-warning">Próx. 7 dias</span>';
    if (bucket === "30d") return '<span class="badge badge-info">8–30 dias</span>';
    return '<span class="badge badge-gray">+30 dias</span>';
  }

  function openPayModal(id) {
    var t = DB.get("transactions", id);
    if (!t) return;
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Descrição</label><input type="text" value="' + Utils.escapeHtml(t.description) + '" disabled></div>' +
      '<div class="form-field"><label>Valor (R$)</label><input type="text" id="cp-pay-amount"></div>' +
      '<div class="form-field"><label>Data do Pagamento</label><input type="date" id="cp-pay-date" value="' + Utils.todayISO() + '"></div>' +
      '<div class="form-field"><label>Forma de Pagamento</label><select id="cp-pay-method">' +
        ["Pix", "Transferência", "Boleto", "Cartão de Crédito", "Cartão de Débito", "Dinheiro"].map(function (p) { return "<option>" + p + "</option>"; }).join("") +
      '</select></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cp-pay-save">Confirmar Pagamento</button>';
    var box = Modal.open({ title: "Marcar Conta como Paga", bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#cp-pay-amount"), t.amount);
    box.querySelector("#cp-pay-save").addEventListener("click", function () {
      var amount = Utils.moneyMaskToFloat(box.querySelector("#cp-pay-amount"));
      var date = box.querySelector("#cp-pay-date").value;
      if (!amount || amount <= 0) { Toast.show("Informe um valor válido", "danger"); return; }
      if (!date) { Toast.show("Informe a data do pagamento", "danger"); return; }
      DB.update("transactions", t.id, {
        status: "pago", amount: round2(amount), date: date,
        paymentMethod: box.querySelector("#cp-pay-method").value
      });
      DB.log("Contas a Pagar", "Marcou como pago: \"" + t.description + "\" (" + Utils.fmtMoney(amount) + ")");
      Modal.close();
      Toast.show("Conta marcada como paga", "success");
      render();
    });
  }

  function kpi(label, value, sub, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div>' +
      '<div class="kpi-delta text-muted" style="color:var(--gray-500);">' + sub + '</div></div>';
  }
  function sum(arr) { return arr.reduce(function (s, t) { return s + t.amount; }, 0); }
  function round2(n) { return Math.round(n * 100) / 100; }

  function exportCSV() {
    var filtered = getFiltered();
    var costCenters = DB.all("costCenters"), categories = DB.all("categories");
    var header = ["Vencimento", "Descrição", "Categoria", "Centro de Custo", "Situação", "Valor"];
    var rows = filtered.map(function (t) {
      var cat = categories.find(function (c) { return c.id === t.categoryId; });
      var cc = costCenters.find(function (c) { return c.id === t.costCenterId; });
      return [t.date, t.description, cat ? cat.name : "", cc ? cc.name : "", BUCKET_LABELS[t._bucket] || t._bucket, String(t.amount).replace(".", ",")];
    });
    var csv = [header].concat(rows).map(function (r) {
      return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(";");
    }).join("\n");
    Utils.downloadFile("contas_a_pagar_" + Utils.todayISO() + ".csv", "﻿" + csv, "text/csv;charset=utf-8");
    Toast.show("Contas a pagar exportadas em CSV", "success");
    DB.log("Contas a Pagar", "Exportou contas a pagar em CSV (" + filtered.length + " conta(s))");
  }
})();
