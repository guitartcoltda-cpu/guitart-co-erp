(function () {
  "use strict";

  var state = { monthsCount: 6, cc: "", mode: "preset", customStart: "", customEnd: "", showEmptyMonths: false };

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
    // Otimização da tabela DRE Gerencial (24/09/2026, a pedido do usuário):
    // por padrão os meses sem nenhum lançamento (comuns no início de um
    // período longo, antes do salão começar a registrar movimento) ficam
    // ocultos na tabela para não empurrar os meses com dado para fora da
    // área visível — este checkbox permite reexibi-los.
    Utils.qs("#d-show-empty").addEventListener("change", function (e) {
      state.showEmptyMonths = e.target.checked;
      render();
    });
    Utils.qs("#btn-export-dre").addEventListener("click", exportCSV);
    Utils.qs("#btn-export-dre-pdf").addEventListener("click", generateDrePdf);
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

  // Fonte única dos números do DRE (totais por categoria, por mês e do
  // período) — usada tanto pela tela (render()) quanto pelo PDF
  // (buildDrePdf()), para garantir que o PDF sempre bata com o que está
  // sendo exibido, sem nenhum cálculo paralelo.
  function computeDreDataset(months, txns, categories) {
    var receitaTotal = 0, despesaTotal = 0;
    var receitaByMonth = {}, despesaByMonth = {};
    months.forEach(function (m) { receitaByMonth[m] = 0; despesaByMonth[m] = 0; });
    txns.forEach(function (t) {
      var m = Utils.monthKey(t.date);
      if (t.type === "receita") { receitaTotal += t.amount; if (receitaByMonth[m] !== undefined) receitaByMonth[m] += t.amount; }
      else { despesaTotal += t.amount; if (despesaByMonth[m] !== undefined) despesaByMonth[m] += t.amount; }
    });
    var resultado = receitaTotal - despesaTotal;
    var margem = receitaTotal > 0 ? (resultado / receitaTotal) * 100 : 0;

    function catMonthTotal(catId, m) {
      return sum(txns.filter(function (t) { return t.categoryId === catId && Utils.monthKey(t.date) === m; }));
    }
    function buildCatRows(list) {
      return list.map(function (c) {
        var monthTotals = {}, total = 0;
        months.forEach(function (m) { var v = catMonthTotal(c.id, m); monthTotals[m] = v; total += v; });
        return { cat: c, total: total, monthTotals: monthTotals };
      }).filter(function (r) { return r.total > 0; });
    }

    return {
      months: months,
      receitaCats: buildCatRows(categories.filter(function (c) { return c.type === "receita"; })),
      despesaCats: buildCatRows(categories.filter(function (c) { return c.type === "despesa"; })),
      receitaByMonth: receitaByMonth, despesaByMonth: despesaByMonth,
      receitaTotal: receitaTotal, despesaTotal: despesaTotal,
      resultado: resultado, margem: margem
    };
  }

  function render() {
    var costCenters = DB.all("costCenters");
    var categories = DB.all("categories");
    var d = getData();
    var months = d.months, txns = d.txns;
    var dataset = computeDreDataset(months, txns, categories);

    document.getElementById("dre-summary").innerHTML = [
      kpi("Receita do Período", Utils.fmtMoney(dataset.receitaTotal), "fa-arrow-trend-up", "#1baf7a", "#e2f5ec"),
      kpi("Despesa do Período", Utils.fmtMoney(dataset.despesaTotal), "fa-arrow-trend-down", "#c23b3b", "#fbe6e6"),
      kpi("Resultado", Utils.fmtMoney(dataset.resultado), "fa-scale-balanced", dataset.resultado >= 0 ? "#1baf7a" : "#c23b3b", dataset.resultado >= 0 ? "#e2f5ec" : "#fbe6e6"),
      kpi("Margem", dataset.margem.toFixed(1) + "%", "fa-percent", "#6d5efc", "#ece9ff")
    ].join("");

    // trend chart
    Charts.line({
      container: document.getElementById("chart-dre-trend"),
      categories: months.map(function (m) { return Utils.monthLabel(m + "-01"); }),
      series: [
        { name: "Receita", color: Charts.palette[2], data: months.map(function (m) { return round2(dataset.receitaByMonth[m]); }) },
        { name: "Despesa", color: Charts.palette[7], data: months.map(function (m) { return round2(dataset.despesaByMonth[m]); }) },
        { name: "Saldo", color: Charts.palette[0], data: months.map(function (m) { return round2(dataset.receitaByMonth[m] - dataset.despesaByMonth[m]); }) }
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

    // DRE table — meses sem nenhum lançamento (nem receita, nem despesa, em
    // nenhuma categoria) ficam ocultos por padrão para não empurrar os
    // meses com dado para fora da área visível; "Mostrar meses sem
    // movimento" reexibe todos. Se TODO o período estiver vazio, mostra
    // todos os meses mesmo assim (não faz sentido esconder tudo).
    var emptyMonths = months.filter(function (m) { return !dataset.receitaByMonth[m] && !dataset.despesaByMonth[m]; });
    var tableMonths = (state.showEmptyMonths || emptyMonths.length === months.length) ? months
      : months.filter(function (m) { return dataset.receitaByMonth[m] || dataset.despesaByMonth[m]; });
    // Coluna Total fica redundante (duplica o único mês exibido) e é
    // ocultada quando a tabela se resume a um único mês.
    var showTotalCol = tableMonths.length !== 1;

    var toggleEl = Utils.qs("#d-show-empty");
    var hiddenCountEl = Utils.qs("#d-hidden-count");
    if (toggleEl) toggleEl.disabled = emptyMonths.length === 0;
    if (hiddenCountEl) {
      hiddenCountEl.textContent = emptyMonths.length
        ? " (" + emptyMonths.length + (emptyMonths.length === 1 ? " mês oculto" : " meses ocultos") + ")"
        : "";
    }

    var head = '<thead><tr><th class="col-sticky-start" style="min-width:220px;">Categoria</th>' +
      tableMonths.map(function (m) { return '<th class="text-right">' + Utils.monthLabel(m + "-01") + '</th>'; }).join("") +
      (showTotalCol ? '<th class="text-right col-sticky-end-2">Total</th>' : '') +
      '<th class="col-sticky-end dre-col-actions"></th>' + '</tr></thead>';

    var body = "<tbody>";
    body += sectionRow("RECEITAS");
    dataset.receitaCats.forEach(function (r) { body += catRow(r, tableMonths, showTotalCol); });
    body += totalRow("Total de Receitas", tableMonths, function (m) { return dataset.receitaByMonth[m]; }, dataset.receitaTotal, showTotalCol);

    body += sectionRow("DESPESAS");
    dataset.despesaCats.forEach(function (r) { body += catRow(r, tableMonths, showTotalCol); });
    body += totalRow("Total de Despesas", tableMonths, function (m) { return dataset.despesaByMonth[m]; }, dataset.despesaTotal, showTotalCol);

    var resultBg = "var(--gray-100)";
    body += '<tr style="background:' + resultBg + ';font-weight:800;"><td class="col-sticky-start" style="background:' + resultBg + ';">RESULTADO DO PERÍODO</td>' +
      tableMonths.map(function (m) {
        var v = dataset.receitaByMonth[m] - dataset.despesaByMonth[m];
        return '<td class="text-right text-num ' + (v >= 0 ? "text-success" : "text-danger") + '">' + Utils.fmtMoney(v) + '</td>';
      }).join("") +
      (showTotalCol ? '<td class="text-right text-num col-sticky-end-2 ' + (dataset.resultado >= 0 ? "text-success" : "text-danger") + '" style="background:' + resultBg + ';">' + Utils.fmtMoney(dataset.resultado) + '</td>' : '') +
      '<td class="col-sticky-end dre-col-actions" style="background:' + resultBg + ';"></td>' +
      '</tr>';
    body += "</tbody>";

    document.getElementById("tbl-dre").innerHTML = head + body;

    // Menu "..." por categoria (24/09/2026, a pedido do usuário) — Baixar
    // Excel / Baixar PDF / Visualizar detalhes dos lançamentos que compõem
    // o total daquela categoria no período filtrado.
    Utils.qsa("[data-dre-cat-menu]", document.getElementById("tbl-dre")).forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        openCategoryActionMenu(btn, btn.getAttribute("data-dre-cat-menu"));
      });
    });
  }

  function sectionRow(label) {
    return '<tr style="background:var(--gray-50);"><td colspan="99" style="font-weight:800;font-size:11px;letter-spacing:.04em;color:var(--gray-600);">' + label + '</td></tr>';
  }
  function catRow(row, tableMonths, showTotalCol) {
    var cells = tableMonths.map(function (m) {
      var v = row.monthTotals[m];
      return '<td class="text-right text-num">' + (v ? Utils.fmtMoney(v) : '<span class="text-muted">-</span>') + '</td>';
    }).join("");
    var actionsCell = '<td class="col-sticky-end dre-col-actions">' +
      '<button type="button" class="kebab-btn" data-dre-cat-menu="' + row.cat.id + '" title="Mais opções"><i class="fa-solid fa-ellipsis-vertical"></i></button></td>';
    return '<tr><td class="col-sticky-start" style="padding-left:24px;">' + Utils.escapeHtml(row.cat.name) + '</td>' + cells +
      (showTotalCol ? '<td class="text-right text-num font-bold col-sticky-end-2">' + Utils.fmtMoney(row.total) + '</td>' : '') + actionsCell + '</tr>';
  }
  function totalRow(label, tableMonths, getter, total, showTotalCol) {
    return '<tr style="border-top:1px solid var(--border-color);font-weight:700;"><td class="col-sticky-start">' + label + '</td>' +
      tableMonths.map(function (m) { return '<td class="text-right text-num">' + Utils.fmtMoney(getter(m)) + '</td>'; }).join("") +
      (showTotalCol ? '<td class="text-right text-num col-sticky-end-2">' + Utils.fmtMoney(total) + '</td>' : '') +
      '<td class="col-sticky-end dre-col-actions"></td>' + '</tr>';
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }
  function sum(arr) { return arr.reduce(function (s, t) { return s + t.amount; }, 0); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function currentUserDisplayName() {
    var u = window.CurrentUser && window.CurrentUser.get && window.CurrentUser.get();
    return u ? ((u.firstName || "") + " " + (u.lastName || "")).trim() || "-" : "-";
  }

  function ccLabel() {
    if (!state.cc) return "Todos os Centros de Custo";
    var cc = DB.get("costCenters", state.cc);
    return cc ? cc.name : "Todos os Centros de Custo";
  }

  function periodLabel(months) {
    if (!months.length) return "-";
    if (months.length === 1) return capFirst(Utils.monthLabel(months[0] + "-01"));
    return capFirst(Utils.monthLabel(months[0] + "-01")) + " a " + capFirst(Utils.monthLabel(months[months.length - 1] + "-01"));
  }

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

  // ================================================================
  // Menu "..." por categoria (24/09/2026, a pedido do usuário) — para cada
  // categoria listada na tabela DRE Gerencial (Receitas e Despesas),
  // permite baixar Excel/PDF dos lançamentos daquela categoria no período
  // filtrado, ou visualizar esses lançamentos num modal. Reaproveita
  // getData() (mesmos filtros de período/Centro de Custo já aplicados na
  // tela) para garantir que os lançamentos batem exatamente com o total
  // exibido na linha da categoria.
  // ================================================================

  function openCategoryActionMenu(anchorEl, catId) {
    ActionMenu.open(anchorEl, [
      { label: "Baixar Excel", icon: "fa-file-excel", onClick: function () { exportCategoryExcel(catId); } },
      { label: "Baixar PDF", icon: "fa-file-pdf", onClick: function () { exportCategoryPdf(catId); } },
      { label: "Visualizar detalhes", icon: "fa-list", onClick: function () { openCategoryDetailModal(catId); } }
    ]);
  }

  // Lançamentos + total da categoria dentro do período/Centro de Custo
  // atualmente filtrados — fonte única usada pelas 3 ações do menu "...".
  function getCategoryContext(catId) {
    var cat = DB.get("categories", catId);
    if (!cat) { Toast.show("Categoria não encontrada", "danger"); return null; }
    var d = getData();
    var txns = d.txns.filter(function (t) { return t.categoryId === catId; })
      .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    return { cat: cat, txns: txns, total: sum(txns), months: d.months };
  }

  function slugify(s) {
    return (s || "").toString().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "categoria";
  }

  function openCategoryDetailModal(catId) {
    var info = getCategoryContext(catId);
    if (!info) return;
    var costCenters = DB.all("costCenters");
    var rowsHtml = info.txns.map(function (t) {
      var cc = costCenters.find(function (c) { return c.id === t.costCenterId; });
      return '<tr>' +
        '<td>' + Utils.fmtDate(t.date) + '</td>' +
        '<td>' + Utils.escapeHtml(t.description || "-") + '</td>' +
        '<td>' + (cc ? Utils.escapeHtml(cc.name) : "-") + '</td>' +
        '<td>' + Utils.escapeHtml(t.paymentMethod || "-") + '</td>' +
        '<td class="text-right text-num">' + Utils.fmtMoney(t.amount) + '</td>' +
        '</tr>';
    }).join("");

    var body =
      '<div class="mb-16">' +
        '<div class="flex justify-between small"><span>Período</span><span class="font-bold">' + Utils.escapeHtml(periodLabel(info.months)) + '</span></div>' +
        '<div class="flex justify-between small mt-8"><span>Centro de Custo</span><span class="font-bold">' + Utils.escapeHtml(ccLabel()) + '</span></div>' +
      '</div>' +
      '<table class="data-table">' +
        '<thead><tr><th>Data</th><th>Descrição</th><th>Centro de Custo</th><th>Forma de Pagamento</th><th class="text-right">Valor</th></tr></thead>' +
        '<tbody>' + (rowsHtml || '<tr><td colspan="5" class="text-center text-muted">Nenhum lançamento no período</td></tr>') + '</tbody>' +
        '<tfoot><tr style="font-weight:800;border-top:1px solid var(--border-color);"><td colspan="4">Total (' + info.txns.length + ' ' + (info.txns.length === 1 ? "lançamento" : "lançamentos") + ')</td>' +
        '<td class="text-right text-num">' + Utils.fmtMoney(info.total) + '</td></tr></tfoot>' +
      '</table>';

    Modal.open({ title: info.cat.name + " — " + (info.cat.type === "receita" ? "Receita" : "Despesa"), wide: true, bodyHtml: body });
  }

  function exportCategoryExcel(catId) {
    if (!window.XLSX) { Toast.show("Não foi possível carregar a biblioteca de Excel — verifique sua conexão e tente novamente", "danger"); return; }
    var info = getCategoryContext(catId);
    if (!info) return;
    if (!info.txns.length) { Toast.show("Nenhum lançamento no período para exportar", "info"); return; }
    var costCenters = DB.all("costCenters");
    var rows = [["Data", "Descrição", "Centro de Custo", "Forma de Pagamento", "Valor"]];
    info.txns.forEach(function (t) {
      var cc = costCenters.find(function (c) { return c.id === t.costCenterId; });
      rows.push([Utils.fmtDate(t.date), t.description || "-", cc ? cc.name : "-", t.paymentMethod || "-", round2(t.amount)]);
    });
    rows.push(["", "", "", "Total", round2(info.total)]);
    var ws = XLSX.utils.aoa_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lançamentos");
    XLSX.writeFile(wb, "dre_" + slugify(info.cat.name) + "_" + Utils.todayISO() + ".xlsx");
    DB.log("DRE", "Exportou Excel dos lançamentos de \"" + info.cat.name + "\" (" + periodLabel(info.months) + ")");
    Toast.show("Excel exportado", "success");
  }

  function exportCategoryPdf(catId) {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { Toast.show("Não foi possível carregar a biblioteca de PDF — verifique sua conexão e tente novamente", "danger"); return; }
    var info = getCategoryContext(catId);
    if (!info) return;
    if (!info.txns.length) { Toast.show("Nenhum lançamento no período para gerar o PDF", "info"); return; }
    loadLogoDataUrl(function (logoDataUrl) { buildCategoryPdf(info, logoDataUrl); });
  }

  function buildCategoryPdf(info, logoDataUrl) {
    var jsPDFCtor = window.jspdf.jsPDF;
    var doc = new jsPDFCtor({ unit: "pt", format: "a4", orientation: "portrait" });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var marginX = 40, tableEnd = pageWidth - marginX;
    var costCenters = DB.all("costCenters");

    function colorGreen() { return [27, 175, 122]; }
    function colorRed() { return [194, 59, 59]; }
    function colorGray() { return [110, 110, 110]; }
    function colorInk() { return [26, 26, 30]; }
    var typeColor = info.cat.type === "receita" ? colorGreen() : colorRed();

    var colData = { x: marginX, w: 60 };
    var colDesc = { x: marginX + 64, w: 190 };
    var colCC = { x: marginX + 258, w: 120 };
    var colPag = { x: marginX + 382, w: 90 };

    function drawTableHeader(y) {
      doc.setFillColor(247, 247, 248);
      doc.rect(marginX, y - 12, tableEnd - marginX, 18, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
      doc.text("DATA", colData.x + 4, y);
      doc.text("DESCRIÇÃO", colDesc.x + 4, y);
      doc.text("CENTRO DE CUSTO", colCC.x + 4, y);
      doc.text("PAGAMENTO", colPag.x + 4, y);
      doc.text("VALOR", tableEnd - 4, y, { align: "right" });
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      y += 10;
      doc.setDrawColor(190, 190, 190);
      doc.setLineWidth(0.6);
      doc.line(marginX, y, tableEnd, y);
      return y + 14;
    }

    function ensureSpace(y, needed) {
      if (y + needed <= pageHeight - 46) return y;
      doc.addPage();
      return drawTableHeader(46);
    }

    function drawLetterhead() {
      var headTop = 30;
      var textX = marginX;
      if (logoDataUrl) {
        try { doc.addImage(logoDataUrl, "PNG", marginX, headTop - 4, 36, 36); textX = marginX + 48; } catch (e) {}
      }
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("GUITART & CO.", textX, headTop + 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
      doc.text("Documento de uso interno — Diretoria", textX, headTop + 24);

      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(1);
      doc.line(marginX, headTop + 42, tableEnd, headTop + 42);

      var y = headTop + 66;
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(info.cat.name, marginX, y);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(typeColor[0], typeColor[1], typeColor[2]);
      doc.text((info.cat.type === "receita" ? "RECEITA" : "DESPESA") + " — DRE GERENCIAL", marginX, y + 14);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
      doc.text("Período: " + periodLabel(info.months), marginX, y + 30);
      doc.text("Centro de Custo: " + ccLabel(), marginX, y + 43);
      doc.text("Gerado em " + Utils.fmtDateTime(DB.nowISO()) + " por " + currentUserDisplayName(), tableEnd, y + 16, { align: "right" });
      doc.text("Confidencial — não distribuir fora da diretoria", tableEnd, y + 29, { align: "right" });
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);

      var boxY = y + 58;
      doc.setFillColor(247, 247, 248);
      doc.roundedRect(marginX, boxY, tableEnd - marginX, 40, 3, 3, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
      doc.text("TOTAL DO PERÍODO (" + info.txns.length + " " + (info.txns.length === 1 ? "LANÇAMENTO" : "LANÇAMENTOS") + ")", marginX + 12, boxY + 16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(typeColor[0], typeColor[1], typeColor[2]);
      doc.text(Utils.fmtMoney(info.total), marginX + 12, boxY + 32);
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);

      return drawTableHeader(boxY + 40 + 24);
    }

    function drawRow(y, t) {
      y = ensureSpace(y, 14);
      var cc = costCenters.find(function (c) { return c.id === t.costCenterId; });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.3);
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      doc.text(Utils.fmtDate(t.date), colData.x + 4, y);
      doc.text(t.description || "-", colDesc.x + 4, y, { maxWidth: colDesc.w - 8 });
      doc.text(cc ? cc.name : "-", colCC.x + 4, y, { maxWidth: colCC.w - 8 });
      doc.text(t.paymentMethod || "-", colPag.x + 4, y, { maxWidth: colPag.w - 8 });
      doc.text(Utils.fmtMoney(t.amount), tableEnd - 4, y, { align: "right" });
      return y + 13;
    }

    var y = drawLetterhead();
    info.txns.forEach(function (t) { y = drawRow(y, t); });

    y = ensureSpace(y, 18);
    doc.setDrawColor(210, 210, 210);
    doc.setLineWidth(0.5);
    doc.line(marginX, y - 9, tableEnd, y - 9);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
    doc.text("TOTAL", colDesc.x + 4, y);
    doc.setTextColor(typeColor[0], typeColor[1], typeColor[2]);
    doc.text(Utils.fmtMoney(info.total), tableEnd - 4, y, { align: "right" });
    doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);

    var totalPages = doc.internal.getNumberOfPages();
    for (var p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.5);
      doc.line(marginX, pageHeight - 30, tableEnd, pageHeight - 30);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
      doc.text("Guitart & Co. — " + info.cat.name, marginX, pageHeight - 18);
      doc.text("Página " + p + " de " + totalPages, tableEnd, pageHeight - 18, { align: "right" });
    }

    doc.save("dre_" + slugify(info.cat.name) + "_" + Utils.todayISO() + ".pdf");
    DB.log("DRE", "Gerou PDF dos lançamentos de \"" + info.cat.name + "\" (" + periodLabel(info.months) + ")");
    Toast.show("PDF gerado", "success");
  }

  // ================================================================
  // "Baixar PDF" (24/09/2026, a pedido do usuário) — exporta o DRE Gerencial
  // completo do período filtrado em um PDF formal, com papel timbrado
  // (logo Guitart & Co.), pensado para apresentação aos donos/diretores.
  // Reaproveita computeDreDataset() — os mesmos números da tela — e, ao
  // contrário da tabela em tela, sempre traz TODOS os meses do período
  // (não aplica a ocultação de meses sem movimento, que é só uma
  // conveniência de leitura na tela) para manter o documento como um
  // registro completo do período selecionado.
  // ================================================================

  var _logoDataUrlCache = null;
  function loadLogoDataUrl(callback) {
    if (_logoDataUrlCache) { callback(_logoDataUrlCache); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        _logoDataUrlCache = canvas.toDataURL("image/png");
      } catch (e) { _logoDataUrlCache = null; }
      callback(_logoDataUrlCache);
    };
    img.onerror = function () { callback(null); };
    img.src = "assets/img/logo-guitart.png";
  }

  function generateDrePdf() {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { Toast.show("Não foi possível carregar a biblioteca de PDF — verifique sua conexão e tente novamente", "danger"); return; }
    var d = getData();
    if (!d.txns.length) { Toast.show("Nenhum lançamento no período selecionado para gerar o PDF", "info"); return; }
    var categories = DB.all("categories");
    var dataset = computeDreDataset(d.months, d.txns, categories);
    loadLogoDataUrl(function (logoDataUrl) { buildDrePdf(d.months, dataset, logoDataUrl); });
  }

  function buildDrePdf(months, dataset, logoDataUrl) {
    var jsPDFCtor = window.jspdf.jsPDF;
    var showTotalCol = months.length !== 1;
    var doc = new jsPDFCtor({ unit: "pt", format: "a4", orientation: "landscape" });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var marginX = 40, tableEnd = pageWidth - marginX;

    var catColW = 172;
    var totalColW = showTotalCol ? 68 : 0;
    var monthsAreaW = (tableEnd - marginX) - catColW - totalColW;
    var monthColW = Math.max(30, monthsAreaW / months.length);
    var fontSizeTable = monthColW < 38 ? 7 : 8.3;

    var cols = [];
    var curX = marginX + catColW;
    months.forEach(function (m) { cols.push({ key: m, x: curX, w: monthColW }); curX += monthColW; });
    var totalColX = curX;

    function colorGreen() { return [27, 175, 122]; }
    function colorRed() { return [194, 59, 59]; }
    function colorGray() { return [110, 110, 110]; }
    function colorInk() { return [26, 26, 30]; }

    // ---- Letterhead (papel timbrado) — só na primeira página ----
    function drawLetterhead() {
      var headTop = 30;
      var textX = marginX;
      if (logoDataUrl) {
        try { doc.addImage(logoDataUrl, "PNG", marginX, headTop - 4, 36, 36); textX = marginX + 48; } catch (e) {}
      }
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("GUITART & CO.", textX, headTop + 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
      doc.text("Documento de uso interno — Diretoria", textX, headTop + 24);

      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(1);
      doc.line(marginX, headTop + 42, tableEnd, headTop + 42);

      var y = headTop + 66;
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Demonstrativo de Resultado (DRE)", marginX, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
      doc.text("Período: " + periodLabel(months), marginX, y + 16);
      doc.text("Centro de Custo: " + ccLabel(), marginX, y + 29);
      doc.text("Gerado em " + Utils.fmtDateTime(DB.nowISO()) + " por " + currentUserDisplayName(), tableEnd, y + 16, { align: "right" });
      doc.text("Confidencial — não distribuir fora da diretoria", tableEnd, y + 29, { align: "right" });
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);

      return drawKpiRow(y + 48);
    }

    function drawKpiRow(y) {
      var kpis = [
        { label: "RECEITA DO PERÍODO", value: Utils.fmtMoney(dataset.receitaTotal), color: colorGreen() },
        { label: "DESPESA DO PERÍODO", value: Utils.fmtMoney(dataset.despesaTotal), color: colorRed() },
        { label: "RESULTADO", value: Utils.fmtMoney(dataset.resultado), color: dataset.resultado >= 0 ? colorGreen() : colorRed() },
        { label: "MARGEM", value: dataset.margem.toFixed(1) + "%", color: colorInk() }
      ];
      var boxW = (tableEnd - marginX - 3 * 10) / 4;
      var boxH = 42;
      kpis.forEach(function (k, idx) {
        var x = marginX + idx * (boxW + 10);
        doc.setFillColor(247, 247, 248);
        doc.roundedRect(x, y, boxW, boxH, 3, 3, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
        doc.text(k.label, x + 10, y + 16);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13.5);
        doc.setTextColor(k.color[0], k.color[1], k.color[2]);
        doc.text(k.value, x + 10, y + 33);
      });
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      return y + boxH + 22;
    }

    function drawTableHeader(y) {
      doc.setFillColor(247, 247, 248);
      doc.rect(marginX, y - 12, tableEnd - marginX, 18, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
      doc.text("CATEGORIA", marginX + 4, y);
      cols.forEach(function (c) { doc.text(Utils.monthLabel(c.key + "-01").toUpperCase(), c.x + c.w - 4, y, { align: "right" }); });
      if (showTotalCol) doc.text("TOTAL", tableEnd - 4, y, { align: "right" });
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      y += 10;
      doc.setDrawColor(190, 190, 190);
      doc.setLineWidth(0.6);
      doc.line(marginX, y, tableEnd, y);
      return y + 14;
    }

    function ensureSpace(y, needed) {
      if (y + needed <= pageHeight - 46) return y;
      doc.addPage();
      var ny = drawTableHeader(46);
      return ny;
    }

    function drawSectionBand(y, label) {
      y = ensureSpace(y, 20);
      doc.setFillColor(238, 238, 240);
      doc.rect(marginX, y - 10, tableEnd - marginX, 16, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
      doc.text(label, marginX + 4, y + 1);
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      return y + 16;
    }

    function drawCatRow(y, row) {
      y = ensureSpace(y, 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fontSizeTable);
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      doc.text(row.cat.name, marginX + 12, y, { maxWidth: catColW - 16 });
      cols.forEach(function (c) {
        var v = row.monthTotals[c.key];
        doc.text(v ? Utils.fmtMoney(v) : "-", c.x + c.w - 4, y, { align: "right" });
      });
      if (showTotalCol) {
        doc.setFont("helvetica", "bold");
        doc.text(Utils.fmtMoney(row.total), tableEnd - 4, y, { align: "right" });
      }
      return y + 13;
    }

    function drawTotalRow(y, label, getter, total) {
      y = ensureSpace(y, 18);
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.5);
      doc.line(marginX, y - 9, tableEnd, y - 9);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(fontSizeTable);
      doc.text(label, marginX + 4, y);
      cols.forEach(function (c) { doc.text(Utils.fmtMoney(getter(c.key)), c.x + c.w - 4, y, { align: "right" }); });
      if (showTotalCol) doc.text(Utils.fmtMoney(total), tableEnd - 4, y, { align: "right" });
      return y + 15;
    }

    function drawResultRow(y) {
      y = ensureSpace(y, 24);
      var color = dataset.resultado >= 0 ? colorGreen() : colorRed();
      doc.setFillColor(245, 245, 246);
      doc.rect(marginX, y - 11, tableEnd - marginX, 20, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(fontSizeTable + 0.7);
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      doc.text("RESULTADO DO PERÍODO", marginX + 4, y + 2);
      cols.forEach(function (c) {
        var v = dataset.receitaByMonth[c.key] - dataset.despesaByMonth[c.key];
        doc.setTextColor(v >= 0 ? colorGreen()[0] : colorRed()[0], v >= 0 ? colorGreen()[1] : colorRed()[1], v >= 0 ? colorGreen()[2] : colorRed()[2]);
        doc.text(Utils.fmtMoney(v), c.x + c.w - 4, y + 2, { align: "right" });
      });
      if (showTotalCol) {
        doc.setTextColor(color[0], color[1], color[2]);
        doc.text(Utils.fmtMoney(dataset.resultado), tableEnd - 4, y + 2, { align: "right" });
      }
      doc.setTextColor(colorInk()[0], colorInk()[1], colorInk()[2]);
      return y + 20;
    }

    var y = drawLetterhead();
    y = drawTableHeader(y);
    y = drawSectionBand(y, "RECEITAS");
    dataset.receitaCats.forEach(function (r) { y = drawCatRow(y, r); });
    y = drawTotalRow(y, "Total de Receitas", function (m) { return dataset.receitaByMonth[m]; }, dataset.receitaTotal);

    y = drawSectionBand(y, "DESPESAS");
    dataset.despesaCats.forEach(function (r) { y = drawCatRow(y, r); });
    y = drawTotalRow(y, "Total de Despesas", function (m) { return dataset.despesaByMonth[m]; }, dataset.despesaTotal);

    y += 6;
    drawResultRow(y);

    // Footer (rodapé) — página X de Y — escrito por último, quando o total
    // de páginas já é conhecido.
    var totalPages = doc.internal.getNumberOfPages();
    for (var p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.5);
      doc.line(marginX, pageHeight - 30, tableEnd, pageHeight - 30);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(colorGray()[0], colorGray()[1], colorGray()[2]);
      doc.text("Guitart & Co. — Demonstrativo de Resultado (DRE)", marginX, pageHeight - 18);
      doc.text("Página " + p + " de " + totalPages, tableEnd, pageHeight - 18, { align: "right" });
    }

    var fileSuffix = months.length === 1 ? months[0] : months[0] + "_a_" + months[months.length - 1];
    doc.save("dre_" + fileSuffix + ".pdf");
    DB.log("DRE", "Gerou PDF do DRE (" + periodLabel(months) + ", " + ccLabel() + ")");
    Toast.show("PDF do DRE gerado", "success");
  }
})();
