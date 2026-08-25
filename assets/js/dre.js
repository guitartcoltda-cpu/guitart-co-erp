(function () {
  "use strict";

  var state = { monthsCount: 6, cc: "", mode: "preset", customStart: "", customEnd: "" };

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    var costCenters = DB.all("costCenters");
    var ccSel = Utils.qs("#d-cc");
    costCenters.forEach(function (c) {
      var o = document.createElement("option"); o.value = c.id; o.textContent = c.name; ccSel.appendChild(o);
    });

    var today = Utils.todayISO();
    state.customStart = today.slice(0, 8) + "01";
    state.customEnd = today;
    Utils.qs("#d-start").value = state.customStart;
    Utils.qs("#d-end").value = state.customEnd;

    Utils.qs("#d-months").addEventListener("change", function (e) {
      var v = e.target.value;
      if (v === "custom") {
        state.mode = "custom";
        Utils.qs("#d-start-field").style.display = "";
        Utils.qs("#d-end-field").style.display = "";
      } else {
        state.mode = "preset";
        state.monthsCount = parseInt(v, 10);
        Utils.qs("#d-start-field").style.display = "none";
        Utils.qs("#d-end-field").style.display = "none";
      }
      render();
    });
    Utils.qs("#d-start").addEventListener("change", function (e) {
      state.customStart = e.target.value || state.customStart;
      if (state.customStart > state.customEnd) state.customEnd = state.customStart;
      Utils.qs("#d-end").value = state.customEnd;
      render();
    });
    Utils.qs("#d-end").addEventListener("change", function (e) {
      state.customEnd = e.target.value || state.customEnd;
      if (state.customEnd < state.customStart) state.customStart = state.customEnd;
      Utils.qs("#d-start").value = state.customStart;
      render();
    });
    ccSel.addEventListener("change", function (e) { state.cc = e.target.value; render(); });
    Utils.qs("#btn-export-dre").addEventListener("click", exportCSV);
    render();
  }

  function monthsRange(n) {
    var today = Utils.todayISO();
    var arr = [];
    for (var i = n - 1; i >= 0; i--) arr.push(Utils.monthKey(Utils.addMonths(today, -i)));
    return arr;
  }

  // list of month keys ("YYYY-MM") spanned by an arbitrary De/Até range
  function monthsBetween(startISO, endISO) {
    var arr = [];
    var cur = startISO.slice(0, 7);
    var endKey = endISO.slice(0, 7);
    var guard = 0;
    while (cur <= endKey && guard < 240) {
      arr.push(cur);
      cur = Utils.monthKey(Utils.addMonths(cur + "-01", 1));
      guard++;
    }
    return arr;
  }

  function getData() {
    var months, txns;
    if (state.mode === "custom" && state.customStart && state.customEnd) {
      months = monthsBetween(state.customStart, state.customEnd);
      txns = DB.all("transactions").filter(function (t) { return t.date >= state.customStart && t.date <= state.customEnd; });
    } else {
      months = monthsRange(state.monthsCount);
      txns = DB.all("transactions").filter(function (t) { return months.indexOf(Utils.monthKey(t.date)) > -1; });
    }
    if (state.cc) txns = txns.filter(function (t) { return t.costCenterId === state.cc; });
    return { months: months, txns: txns };
  }

  function render() {
    var costCenters = DB.all("costCenters");
    var categories = DB.all("categories");
    var d = getData();
    var months = d.months, txns = d.txns;

    var receitaTotal = 0, despesaTotal = 0;
    var receitaByMonth = {}, despesaByMonth = {};
    months.forEach(function (m) { receitaByMonth[m] = 0; despesaByMonth[m] = 0; });
    txns.forEach(function (t) {
      var m = Utils.monthKey(t.date);
      if (t.type === "receita") { receitaTotal += t.amount; receitaByMonth[m] += t.amount; }
      else { despesaTotal += t.amount; despesaByMonth[m] += t.amount; }
    });
    var resultado = receitaTotal - despesaTotal;
    var margem = receitaTotal > 0 ? (resultado / receitaTotal) * 100 : 0;

    document.getElementById("dre-summary").innerHTML = [
      kpi("Receita do Período", Utils.fmtMoney(receitaTotal), "fa-arrow-trend-up", "#1baf7a", "#e2f5ec"),
      kpi("Despesa do Período", Utils.fmtMoney(despesaTotal), "fa-arrow-trend-down", "#c23b3b", "#fbe6e6"),
      kpi("Resultado", Utils.fmtMoney(resultado), "fa-scale-balanced", resultado >= 0 ? "#1baf7a" : "#c23b3b", resultado >= 0 ? "#e2f5ec" : "#fbe6e6"),
      kpi("Margem", margem.toFixed(1) + "%", "fa-percent", "#b8923f", "#f6ecd3")
    ].join("");

    // trend chart
    Charts.line({
      container: document.getElementById("chart-dre-trend"),
      categories: months.map(function (m) { return Utils.monthLabel(m + "-01"); }),
      series: [
        { name: "Receita", color: Charts.palette[2], data: months.map(function (m) { return round2(receitaByMonth[m]); }) },
        { name: "Despesa", color: Charts.palette[7], data: months.map(function (m) { return round2(despesaByMonth[m]); }) },
        { name: "Saldo", color: Charts.palette[0], data: months.map(function (m) { return round2(receitaByMonth[m] - despesaByMonth[m]); }) }
      ],
      height: 280,
      valueFormatter: function (v) { return Utils.fmtMoney(v); }
    });

    // cost center breakdown (despesas)
    var despesaTxns = txns.filter(function (t) { return t.type === "despesa"; });
    var ccTotals = costCenters.map(function (cc) {
      return { cc: cc, total: sum(despesaTxns.filter(function (t) { return t.costCenterId === cc.id; })) };
    }).filter(function (c) { return c.total > 0; }).sort(function (a, b) { return b.total - a.total; });

    Charts.bar({
      container: document.getElementById("chart-dre-cc"),
      categories: ccTotals.map(function (c) { return c.cc.name; }),
      series: [{ name: "Despesas", color: Charts.palette[1], data: ccTotals.map(function (c) { return round2(c.total); }) }],
      height: 240,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem despesas no período"
    });

    var ccTotalSum = ccTotals.reduce(function (s, c) { return s + c.total; }, 0);
    document.getElementById("cc-breakdown").innerHTML = ccTotals.length ? ccTotals.map(function (c, idx) {
      var pct = ccTotalSum > 0 ? (c.total / ccTotalSum) * 100 : 0;
      return '<div class="mt-8">' +
        '<div class="flex justify-between small"><span class="font-bold">' + Utils.escapeHtml(c.cc.name) + '</span><span>' + Utils.fmtMoney(c.total) + ' (' + pct.toFixed(0) + '%)</span></div>' +
        '<div class="progress-track mt-8"><div class="progress-fill" style="width:' + pct + '%;background:' + Charts.palette[idx % Charts.palette.length] + ';"></div></div>' +
        '</div>';
    }).join("") : '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-chart-bar"></i></div><h4>Sem dados no período</h4></div>';

    // DRE table
    var receitaCats = categories.filter(function (c) { return c.type === "receita"; });
    var despesaCats = categories.filter(function (c) { return c.type === "despesa"; });

    function catMonthTotal(catId, m, type) {
      return sum(txns.filter(function (t) { return t.categoryId === catId && Utils.monthKey(t.date) === m; }));
    }
    function catTotal(catId) { return sum(txns.filter(function (t) { return t.categoryId === catId; })); }

    var head = '<thead><tr><th style="min-width:220px;">Categoria</th>' +
      months.map(function (m) { return '<th class="text-right">' + Utils.monthLabel(m + "-01") + '</th>'; }).join("") +
      '<th class="text-right">Total</th></tr></thead>';

    var body = "<tbody>";
    body += sectionRow("RECEITAS");
    receitaCats.forEach(function (c) {
      var total = catTotal(c.id);
      if (total <= 0) return;
      body += catRow(c.name, c, months, catMonthTotal, false);
    });
    body += totalRow("Total de Receitas", months, function (m) { return receitaByMonth[m]; }, receitaTotal, false);

    body += sectionRow("DESPESAS");
    despesaCats.forEach(function (c) {
      var total = catTotal(c.id);
      if (total <= 0) return;
      body += catRow(c.name, c, months, catMonthTotal, true);
    });
    body += totalRow("Total de Despesas", months, function (m) { return despesaByMonth[m]; }, despesaTotal, true);

    body += '<tr style="background:var(--gray-100);font-weight:800;"><td>RESULTADO DO PERÍODO</td>' +
      months.map(function (m) {
        var v = receitaByMonth[m] - despesaByMonth[m];
        return '<td class="text-right text-num ' + (v >= 0 ? "text-success" : "text-danger") + '">' + Utils.fmtMoney(v) + '</td>';
      }).join("") +
      '<td class="text-right text-num ' + (resultado >= 0 ? "text-success" : "text-danger") + '">' + Utils.fmtMoney(resultado) + '</td></tr>';
    body += "</tbody>";

    document.getElementById("tbl-dre").innerHTML = head + body;
  }

  function sectionRow(label) {
    return '<tr style="background:var(--gray-50);"><td colspan="99" style="font-weight:800;font-size:11px;letter-spacing:.04em;color:var(--gray-600);">' + label + '</td></tr>';
  }
  function catRow(name, cat, months, catMonthTotal) {
    var total = 0;
    var cells = months.map(function (m) {
      var v = catMonthTotal(cat.id, m);
      total += v;
      return '<td class="text-right text-num">' + (v ? Utils.fmtMoney(v) : '<span class="text-muted">-</span>') + '</td>';
    }).join("");
    return '<tr><td style="padding-left:24px;">' + Utils.escapeHtml(name) + '</td>' + cells + '<td class="text-right text-num font-bold">' + Utils.fmtMoney(total) + '</td></tr>';
  }
  function totalRow(label, months, getter, total, isExpense) {
    return '<tr style="border-top:1px solid var(--border-color);font-weight:700;"><td>' + label + '</td>' +
      months.map(function (m) { return '<td class="text-right text-num">' + Utils.fmtMoney(getter(m)) + '</td>'; }).join("") +
      '<td class="text-right text-num">' + Utils.fmtMoney(total) + '</td></tr>';
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }
  function sum(arr) { return arr.reduce(function (s, t) { return s + t.amount; }, 0); }
  function round2(n) { return Math.round(n * 100) / 100; }

  function exportCSV() {
    var d = getData();
    var months = d.months;
    var categories = DB.all("categories");
    var rows = [["Categoria", "Tipo"].concat(months.map(function (m) { return Utils.monthLabel(m + "-01"); })).concat(["Total"])];
    categories.forEach(function (c) {
      var vals = months.map(function (m) { return sum(d.txns.filter(function (t) { return t.categoryId === c.id && Utils.monthKey(t.date) === m; })); });
      var total = vals.reduce(function (s, v) { return s + v; }, 0);
      if (total <= 0) return;
      rows.push([c.name, c.type].concat(vals.map(function (v) { return String(round2(v)).replace(".", ","); })).concat([String(round2(total)).replace(".", ",")]));
    });
    var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(";"); }).join("\n");
    Utils.downloadFile("dre_" + Utils.todayISO() + ".csv", "﻿" + csv, "text/csv;charset=utf-8");
    Toast.show("DRE exportado em CSV", "success");
  }
})();
