(function () {
  "use strict";

  var selectedMonth = "";
  var selectedIds = {};

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    var today = Utils.todayISO();
    var sel = Utils.qs("#cm-month");
    var months = [];
    for (var i = 0; i < 10; i++) months.push(Utils.monthKey(Utils.addMonths(today, -i)));
    months.forEach(function (m, idx) {
      var o = document.createElement("option");
      o.value = m; o.textContent = Utils.monthLabel(m + "-01") + (idx === 0 ? " (atual)" : idx === 1 ? " (fechado anteriormente)" : "");
      sel.appendChild(o);
    });
    selectedMonth = months[0]; // default: mês atual (ainda em aberto para pagamento)
    sel.value = selectedMonth;
    sel.addEventListener("change", function (e) { selectedMonth = e.target.value; selectedIds = {}; render(); });
    Utils.qs("#btn-new-bonus").addEventListener("click", function () { openBonusModal(null); });
    var bulkBtn = Utils.qs("#btn-com-bulk-pay");
    if (bulkBtn) bulkBtn.addEventListener("click", bulkRegisterPayment);
    var pdfBtn = Utils.qs("#btn-com-pdf");
    if (pdfBtn) pdfBtn.addEventListener("click", generateCommissionPdf);
    var sendBtn = Utils.qs("#btn-com-send-admins");
    if (sendBtn) sendBtn.addEventListener("click", openSendToAdminsModal);
    render();
  }

  // Último dia do mês de referência selecionado, exceto quando o mês
  // selecionado é o mês corrente — nesse caso o "corte" é hoje, já que o
  // mês ainda está em andamento e o valor devido pode continuar mudando.
  function cutoffDateForSelectedMonth() {
    var today = Utils.todayISO();
    if (selectedMonth === Utils.monthKey(today)) return today;
    var parts = selectedMonth.split("-").map(Number);
    var lastDay = new Date(parts[0], parts[1], 0).getDate();
    return selectedMonth + "-" + String(lastDay).padStart(2, "0");
  }

  function summaryLines() {
    var rows = computeRows().filter(function (r) { return r.devido > 0.009; });
    var cutoff = cutoffDateForSelectedMonth();
    return { rows: rows, cutoff: cutoff, monthLabel: Utils.monthLabel(selectedMonth + "-01") };
  }

  function generateCommissionPdf() {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { Toast.show("Não foi possível carregar a biblioteca de PDF — verifique sua conexão e tente novamente", "danger"); return; }
    var data = summaryLines();
    if (!data.rows.length) { Toast.show("Nenhum comissionamento devido neste mês para gerar o resumo", "info"); return; }

    var doc = new jsPDFCtor({ unit: "pt", format: "a4" });
    var pageWidth = doc.internal.pageSize.getWidth();
    var y = 50;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Guitart & Co. — Resumo de Comissões", 40, y);
    y += 22;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("Mês de referência: " + data.monthLabel, 40, y);
    y += 16;
    doc.text("Data de corte considerada: " + Utils.fmtDate(data.cutoff), 40, y);
    y += 16;
    doc.text("Gerado em: " + Utils.fmtDate(Utils.todayISO()), 40, y);
    y += 26;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Profissional", 40, y);
    doc.text("Devido", pageWidth - 160, y, { align: "left" });
    doc.text("Pago", pageWidth - 100, y, { align: "left" });
    y += 6;
    doc.setLineWidth(0.5);
    doc.line(40, y, pageWidth - 40, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    var total = 0;
    data.rows.forEach(function (r) {
      if (y > 780) { doc.addPage(); y = 50; }
      doc.text(r.employee.name + " (" + r.employee.role + ")", 40, y, { maxWidth: pageWidth - 260 });
      doc.text(Utils.fmtMoney(r.devido), pageWidth - 160, y);
      doc.text(Utils.fmtMoney(r.pago), pageWidth - 100, y);
      total += r.devido;
      y += 18;
    });

    y += 10;
    doc.setLineWidth(0.5);
    doc.line(40, y, pageWidth - 40, y);
    y += 20;
    doc.setFont("helvetica", "bold");
    doc.text("Total devido no período: " + Utils.fmtMoney(total), 40, y);

    doc.save("comissoes_" + selectedMonth + ".pdf");
    DB.log("Comissão", "Gerou PDF resumo de comissões (ref. " + data.monthLabel + ")");
    Toast.show("PDF de comissões gerado", "success");
  }

  function buildAdminWhatsAppMessage(data) {
    var lines = [];
    lines.push("*Resumo de Comissões — " + data.monthLabel + "*");
    lines.push("Data de corte: " + Utils.fmtDate(data.cutoff));
    lines.push("");
    var total = 0, totalReceita = 0;
    data.rows.forEach(function (r) {
      // A pedido do cliente: além do valor da comissão, mostra a receita de
      // serviços gerada pelo profissional e o percentual proporcional que a
      // comissão representa sobre essa receita (mesma informação que já
      // aparece na tabela da tela, só que resumida para o texto do WhatsApp).
      var pct = r.serviceRevenue > 0 ? round2((r.devido / r.serviceRevenue) * 100) : 0;
      lines.push("• " + r.employee.name + ": Receita gerada " + Utils.fmtMoney(r.serviceRevenue) + " · Comissão " + Utils.fmtMoney(r.devido) + " (" + pct + "% da receita)");
      total += r.devido;
      totalReceita += r.serviceRevenue;
    });
    lines.push("");
    lines.push("Receita total de serviços: " + Utils.fmtMoney(totalReceita));
    lines.push("Total de comissões: " + Utils.fmtMoney(total));
    return lines.join("\n");
  }

  function openSendToAdminsModal() {
    var data = summaryLines();
    if (!data.rows.length) { Toast.show("Nenhum comissionamento devido neste mês para enviar", "info"); return; }
    var message = buildAdminWhatsAppMessage(data);
    var admins = DB.all("users").filter(function (u) { return u.role === "Administrador" && u.active !== false; });

    var rowsHtml = admins.map(function (u) {
      var name = ((u.firstName || "") + " " + (u.lastName || "")).trim() || "Administrador";
      var link = window.Notificacoes ? Notificacoes.waLink(u.phone, message) : null;
      return '<div class="flex items-center justify-between" style="padding:10px 0;border-bottom:1px solid var(--border-color);">' +
        '<div><div class="font-bold">' + Utils.escapeHtml(name) + '</div>' +
        '<div class="small text-muted">' + (u.phone ? Utils.escapeHtml(u.phone) : "Sem telefone cadastrado") + '</div></div>' +
        (link ? '<a class="btn btn-sm btn-primary" target="_blank" rel="noopener" href="' + link + '"><i class="fa-brands fa-whatsapp"></i> Abrir WhatsApp</a>'
              : '<span class="small text-muted">Cadastre o telefone em Configurações → Acessos</span>') +
        '</div>';
    }).join("");

    var body = '<div class="small text-muted mb-12">Mensagem que será enviada (profissional, valor da comissão e data de corte):</div>' +
      '<pre style="white-space:pre-wrap;padding:12px;border-radius:8px;background:var(--gray-50);border:1px solid var(--border-color);font-family:inherit;font-size:13px;">' + Utils.escapeHtml(message) + '</pre>' +
      '<div class="small text-muted mb-8 mt-16">Administradores:</div>' +
      (admins.length ? rowsHtml : '<div class="small text-muted">Nenhum usuário Administrador cadastrado em Configurações → Acessos.</div>');
    var foot = '<button class="btn btn-secondary" data-close-modal>Fechar</button>';
    Modal.open({ title: "Enviar resumo aos administradores", wide: true, bodyHtml: body, footHtml: foot });
    DB.log("Comissão", "Abriu envio de resumo de comissões para administradores (ref. " + data.monthLabel + ")");
  }

  function bonusesFor(employeeId, monthKey) {
    return DB.all("commissionBonuses").filter(function (b) { return b.employeeId === employeeId && b.month === monthKey; });
  }

  // Fonte da verdade: os agendamentos concluídos do mês (e não os
  // lançamentos financeiros), pois é ali que moram o profissional
  // principal, o eventual assistente e as taxas de comissão específicas do
  // atendimento — Utils.apptCommissionSplit() faz a divisão entre os dois.
  function computeRows() {
    var appointments = DB.all("appointments").filter(function (a) { return a.status === "concluido" && Utils.monthKey(a.date) === selectedMonth; });
    var employeesAll = DB.all("employees");
    var assistantIds = {};
    appointments.forEach(function (a) { if (a.assistantId) assistantIds[a.assistantId] = true; });
    var employees = employeesAll.filter(function (e) { return e.commissionRate > 0 || assistantIds[e.id]; });

    return employees.map(function (e) {
      var asMain = appointments.filter(function (a) { return a.employeeId === e.id; });
      var asAssistant = appointments.filter(function (a) { return a.assistantId === e.id; });
      var serviceRevenue = round2(sumBy(asMain, "price"));
      var mainCommissionTotal = 0;
      asMain.forEach(function (a) { mainCommissionTotal += Utils.apptCommissionSplit(a, e).mainCommission; });
      var assistantCommissionTotal = 0;
      asAssistant.forEach(function (a) {
        var mainEmp = employeesAll.find(function (x) { return x.id === a.employeeId; });
        assistantCommissionTotal += Utils.apptCommissionSplit(a, mainEmp).assistantCommission;
      });
      mainCommissionTotal = round2(mainCommissionTotal);
      assistantCommissionTotal = round2(assistantCommissionTotal);
      var baseComissao = round2(mainCommissionTotal + assistantCommissionTotal);
      var bonuses = bonusesFor(e.id, selectedMonth);
      var bonusTotal = round2(sumBy(bonuses, "amount"));
      var consumo = (window.Consumo ? Consumo.deductionFor(e.id, selectedMonth) : { total: 0, items: [] });
      var devido = round2(baseComissao + bonusTotal - consumo.total);
      var pagoTxns = DB.all("transactions").filter(function (t) {
        return t.type === "despesa" && t.employeeId === e.id && t.categoryId === commissionCatId() && t.relatedMonth === selectedMonth;
      });
      var pago = sumBy(pagoTxns, "amount");
      return {
        employee: e, serviceRevenue: serviceRevenue, atendimentos: asMain.length,
        mainCommissionTotal: mainCommissionTotal, assistantCommissionTotal: assistantCommissionTotal,
        baseComissao: baseComissao, bonusTotal: bonusTotal, consumoTotal: consumo.total, consumoItems: consumo.items,
        devido: devido, pago: pago, saldo: round2(devido - pago)
      };
    }).sort(function (a, b) { return b.devido - a.devido; });
  }

  var _commCatId = null;
  function commissionCatId() {
    if (_commCatId) return _commCatId;
    var c = DB.findOne("categories", function (x) { return x.name === "Comissões"; });
    _commCatId = c ? c.id : null;
    return _commCatId;
  }

  function render() {
    var rows = computeRows();
    var totalDevido = rows.reduce(function (s, r) { return s + r.devido; }, 0);
    var totalPago = rows.reduce(function (s, r) { return s + r.pago; }, 0);
    var totalAberto = rows.reduce(function (s, r) { return s + Math.max(0, r.saldo); }, 0);

    document.getElementById("com-summary").innerHTML = [
      kpi("Comissão Devida", Utils.fmtMoney(totalDevido), "fa-calculator", "#2a78d6", "#e3eefb"),
      kpi("Comissão Paga", Utils.fmtMoney(totalPago), "fa-circle-check", "#1baf7a", "#e2f5ec"),
      kpi("Saldo em Aberto", Utils.fmtMoney(totalAberto), "fa-hourglass-half", "#b7791f", "#fdf2df"),
      kpi("Profissionais Comissionados", String(rows.length), "fa-users", "#4a3aa7", "#ece8f8"),
      kpi("Descontos de Comissionamento Esporádico", Utils.fmtMoney(sporadicDiscountTotal()), "fa-scissors", "#c23b3b", "#fbe6e6")
    ].join("");

    Charts.bar({
      container: document.getElementById("chart-commission"),
      categories: rows.map(function (r) { return r.employee.name; }),
      series: [
        { name: "Devido", color: Charts.palette[0], data: rows.map(function (r) { return r.devido; }) },
        { name: "Pago", color: Charts.palette[2], data: rows.map(function (r) { return r.pago; }) }
      ],
      height: 260,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem profissionais comissionados"
    });

    // Ranking — profissional que mais recebe no mês (ordenado por "Devido")
    var rankingEl = document.getElementById("chart-commission-ranking");
    if (rankingEl) {
      Charts.rankingList({
        container: rankingEl,
        items: rows.map(function (r) { return { label: r.employee.name, value: round2(r.devido) }; }),
        maxItems: 10,
        valueFormatter: function (v) { return Utils.fmtMoney(v); },
        emptyMessage: "Sem dados de comissionamento neste mês"
      });
    }

    var tbl = document.getElementById("tbl-commission");
    // limpa seleções de profissionais que não estão mais elegíveis (saldo quitado, mudou de mês etc.)
    var payableIds = {};
    rows.forEach(function (r) { if (r.saldo > 0.01) payableIds[r.employee.id] = true; });
    Object.keys(selectedIds).forEach(function (id) { if (!payableIds[id]) delete selectedIds[id]; });

    if (!rows.length) {
      Utils.emptyTable(tbl, "fa-face-frown", "Nenhum profissional comissionado");
      updateBulkBar();
      return;
    }
    tbl.innerHTML = '<thead><tr><th class="com-col-check"><input type="checkbox" id="com-select-all"></th><th>Profissional</th><th>Cargo</th><th class="text-right">Atendimentos</th><th class="text-right">Receita de Serviços</th><th class="text-right">Taxa</th><th class="text-right">Devido</th><th class="text-right">Pago</th><th class="text-right">Saldo</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var status = r.saldo <= 0.01 ? '<span class="badge badge-success">Pago</span>' : (r.pago > 0 ? '<span class="badge badge-warning">Parcial</span>' : '<span class="badge badge-danger">A Pagar</span>');
        var bonusNote = "";
        if (r.bonusTotal > 0) bonusNote = '<div class="small text-muted" style="font-weight:400;">+ ' + Utils.fmtMoney(r.bonusTotal) + ' comissionamento esporádico</div>';
        else if (r.bonusTotal < 0) bonusNote = '<div class="small text-danger" style="font-weight:400;">- ' + Utils.fmtMoney(Math.abs(r.bonusTotal)) + ' desconto</div>';
        if (r.assistantCommissionTotal > 0) bonusNote += '<div class="small text-muted" style="font-weight:400;">inclui ' + Utils.fmtMoney(r.assistantCommissionTotal) + ' como assistente</div>';
        if (r.consumoTotal > 0) bonusNote += '<div class="small text-danger" style="font-weight:400;">- ' + Utils.fmtMoney(r.consumoTotal) + ' consumo de insumos</div>';
        return '<tr>' +
          '<td class="com-col-check">' + (r.saldo > 0.01 ? '<input type="checkbox" class="com-row-check" data-id="' + r.employee.id + '"' + (selectedIds[r.employee.id] ? " checked" : "") + '>' : "") + '</td>' +
          '<td><div class="flex items-center gap-8">' + Utils.avatarHtml(r.employee.name, r.employee.photoDataUrl) + Utils.escapeHtml(r.employee.name) + '</div></td>' +
          '<td>' + Utils.escapeHtml(r.employee.role) + '</td>' +
          '<td class="text-right text-num">' + r.atendimentos + '</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(r.serviceRevenue) + '</td>' +
          '<td class="text-right text-num">' + r.employee.commissionRate + '%</td>' +
          '<td class="text-right text-num font-bold">' + Utils.fmtMoney(r.devido) + bonusNote +
          '</td>' +
          '<td class="text-right text-num text-success">' + Utils.fmtMoney(r.pago) + '</td>' +
          '<td class="text-right text-num ' + (r.saldo > 0.01 ? "text-danger" : "") + '">' + Utils.fmtMoney(Math.max(0, r.saldo)) + '</td>' +
          '<td>' + status + '</td>' +
          '<td><div class="flex gap-6">' +
            '<button class="btn btn-sm btn-outline" data-details="' + r.employee.id + '">Ver detalhes</button>' +
            (r.saldo > 0.01 ? '<button class="btn btn-sm btn-primary" data-pay="' + r.employee.id + '">Registrar pagamento</button>' : "") +
          '</div></td>' +
          '</tr>';
      }).join("") + '</tbody>';

    Utils.qsa("[data-pay]", tbl).forEach(function (b) {
      b.addEventListener("click", function () { registerPayment(b.getAttribute("data-pay")); });
    });
    Utils.qsa("[data-details]", tbl).forEach(function (b) {
      b.addEventListener("click", function () { openDetailsModal(b.getAttribute("data-details")); });
    });
    Utils.qsa(".com-row-check", tbl).forEach(function (cb) {
      cb.addEventListener("change", function () {
        var id = cb.getAttribute("data-id");
        if (cb.checked) selectedIds[id] = true; else delete selectedIds[id];
        updateSelectAllState(rows);
        updateBulkBar();
      });
    });
    var selectAll = document.getElementById("com-select-all");
    if (selectAll) {
      selectAll.addEventListener("change", function () {
        rows.forEach(function (r) { if (r.saldo > 0.01) { if (selectAll.checked) selectedIds[r.employee.id] = true; else delete selectedIds[r.employee.id]; } });
        Utils.qsa(".com-row-check", tbl).forEach(function (cb) { cb.checked = selectAll.checked; });
        updateBulkBar();
      });
      updateSelectAllState(rows);
    }
    updateBulkBar();
  }

  function updateSelectAllState(rows) {
    var selectAll = document.getElementById("com-select-all");
    if (!selectAll) return;
    var payable = rows.filter(function (r) { return r.saldo > 0.01; });
    var selectedCount = payable.filter(function (r) { return selectedIds[r.employee.id]; }).length;
    selectAll.checked = payable.length > 0 && selectedCount === payable.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < payable.length;
  }

  function updateBulkBar() {
    var count = Object.keys(selectedIds).length;
    var bar = document.getElementById("com-bulk-bar");
    if (!bar) return;
    bar.classList.toggle("show", count > 0);
    document.getElementById("com-bulk-count").textContent = count + (count === 1 ? " profissional selecionado" : " profissionais selecionados");
  }

  function bulkRegisterPayment() {
    var ids = Object.keys(selectedIds);
    if (!ids.length) return;
    var rows = computeRows();
    var today = Utils.todayISO();
    var count = 0, total = 0;
    var ccRh = DB.findOne("costCenters", function (c) { return c.key === "rh"; });
    DB.batch(function () {
      ids.forEach(function (id) {
        var row = rows.find(function (r) { return r.employee.id === id; });
        if (!row || row.saldo <= 0.01) return;
        DB.insert("transactions", {
          type: "despesa", description: "Comissão - " + row.employee.name + " (ref. " + Utils.monthLabel(selectedMonth + "-01") + ")",
          amount: round2(row.saldo), date: today, categoryId: commissionCatId(),
          costCenterId: ccRh ? ccRh.id : null,
          paymentMethod: "Transferência", status: "pago", employeeId: row.employee.id,
          relatedMonth: selectedMonth, reconciled: false
        });
        total += row.saldo;
        count++;
      });
    });
    DB.log("Comissão", "Registrou pagamento em lote de comissão para " + count + " profissional(is) — " + Utils.fmtMoney(total) + " (ref. " + Utils.monthLabel(selectedMonth + "-01") + ")");
    Toast.show(count + " pagamento(s) de comissão registrado(s)", "success");
    selectedIds = {};
    render();
  }

  // Shows every completed appointment that contributed to a professional's
  // commission total for the selected month, with the value composition —
  // separando o que veio como profissional principal do que veio como
  // assistente de outro profissional, quando aplicável.
  function openDetailsModal(employeeId) {
    var rows = computeRows();
    var row = rows.find(function (r) { return r.employee.id === employeeId; });
    if (!row) return;
    var e = row.employee;
    var services = DB.all("services"), clients = DB.all("clients"), employeesAll = DB.all("employees");
    var apptsAll = DB.all("appointments").filter(function (a) { return a.status === "concluido" && Utils.monthKey(a.date) === selectedMonth; });
    var apptsMain = apptsAll.filter(function (a) { return a.employeeId === employeeId; }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });
    var apptsAsst = apptsAll.filter(function (a) { return a.assistantId === employeeId; }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });

    function lineHtml(a, commissionValue, roleLabel) {
      var s = services.find(function (x) { return x.id === a.serviceId; });
      var c = clients.find(function (x) { return x.id === a.clientId; });
      return '<tr>' +
        '<td>' + Utils.fmtDate(a.date) + ' · ' + a.time + '</td>' +
        '<td>' + Utils.escapeHtml(c ? c.name : "-") + '</td>' +
        '<td>' + Utils.escapeHtml(s ? s.name : "-") + (roleLabel ? ' <span class="small text-muted">(' + roleLabel + ')</span>' : '') + '</td>' +
        '<td class="text-right text-num">' + Utils.fmtMoney(a.price) + '</td>' +
        '<td class="text-right text-num font-bold">' + Utils.fmtMoney(commissionValue) + '</td>' +
        '</tr>';
    }

    var mainLinesHtml = apptsMain.map(function (a) {
      var split = Utils.apptCommissionSplit(a, e);
      var label = a.assistantId ? "com assistente — " + Utils.fmtMoney(split.salonShare) + " pagos pelo salão" : null;
      return lineHtml(a, split.mainCommission, label);
    }).join("");

    var asstSectionHtml = "";
    if (apptsAsst.length) {
      var asstLinesHtml = apptsAsst.map(function (a) {
        var mainEmp = employeesAll.find(function (x) { return x.id === a.employeeId; });
        var split = Utils.apptCommissionSplit(a, mainEmp);
        return lineHtml(a, split.assistantCommission, mainEmp ? "assistindo " + mainEmp.name : "assistente");
      }).join("");
      asstSectionHtml = '<h4 style="font-size:14px;margin-top:18px;margin-bottom:8px;">Atendimentos como Assistente</h4>' +
        '<table class="data-table"><thead><tr><th>Data/Hora</th><th>Cliente</th><th>Serviço</th><th class="text-right">Valor Cobrado</th><th class="text-right">Comissão</th></tr></thead>' +
        '<tbody>' + asstLinesHtml + '</tbody>' +
        '<tfoot><tr style="font-weight:800;border-top:1px solid var(--border-color);"><td colspan="4">Subtotal como assistente</td>' +
        '<td class="text-right text-num">' + Utils.fmtMoney(row.assistantCommissionTotal) + '</td></tr></tfoot></table>';
    }

    var body =
      '<div class="mb-16">' +
        '<div class="flex justify-between small"><span>Profissional</span><span class="font-bold">' + Utils.escapeHtml(e.name) + ' — ' + Utils.escapeHtml(e.role) + '</span></div>' +
        '<div class="flex justify-between small mt-8"><span>Mês de referência</span><span class="font-bold">' + Utils.monthLabel(selectedMonth + "-01") + '</span></div>' +
        '<div class="flex justify-between small mt-8"><span>Taxa de comissão padrão</span><span class="font-bold">' + e.commissionRate + '%</span></div>' +
      '</div>' +
      '<h4 style="font-size:14px;margin-bottom:8px;">Atendimentos como Profissional Principal</h4>' +
      '<table class="data-table">' +
      '<thead><tr><th>Data/Hora</th><th>Cliente</th><th>Serviço</th><th class="text-right">Valor Cobrado</th><th class="text-right">Comissão</th></tr></thead>' +
      '<tbody>' + (mainLinesHtml || '<tr><td colspan="5" class="text-center text-muted">Nenhum atendimento concluído neste mês</td></tr>') + '</tbody>' +
      '<tfoot><tr style="font-weight:800;border-top:1px solid var(--border-color);"><td colspan="3">Total (' + apptsMain.length + ' atendimento' + (apptsMain.length === 1 ? "" : "s") + ')</td>' +
      '<td class="text-right text-num">' + Utils.fmtMoney(row.serviceRevenue) + '</td>' +
      '<td class="text-right text-num">' + Utils.fmtMoney(row.mainCommissionTotal) + '</td></tr></tfoot>' +
      '</table>' +
      asstSectionHtml +
      consumoSectionHtml(row) +
      '<div class="flex items-center justify-between mt-16 mb-8">' +
        '<h4 style="font-size:14px;">Comissionamento Esporádico do Mês</h4>' +
        '<button type="button" class="btn btn-sm btn-outline" id="dm-add-bonus"><i class="fa-solid fa-plus"></i> Novo Lançamento</button>' +
      '</div>' +
      '<div id="dm-bonus-section"></div>' +
      '<div class="flex justify-between mt-16" style="font-weight:800;font-size:15px;border-top:2px solid var(--border-color);padding-top:10px;">' +
        '<span>Total Devido (comissão + esporádico − consumo de insumos)</span><span id="dm-grand-total">' + Utils.fmtMoney(row.devido) + '</span>' +
      '</div>';

    var box = Modal.open({ title: "Detalhes da Comissão — " + e.name, wide: true, bodyHtml: body });

    function renderBonusSection() {
      var bonuses = bonusesFor(employeeId, selectedMonth);
      var sec = box.querySelector("#dm-bonus-section");
      if (!bonuses.length) {
        sec.innerHTML = '<div class="small text-muted">Nenhum comissionamento esporádico lançado para este mês.</div>';
      } else {
        sec.innerHTML = '<table class="data-table">' +
          '<thead><tr><th>Descrição</th><th>Tipo</th><th class="text-right">Valor</th><th></th></tr></thead>' +
          '<tbody>' + bonuses.map(function (b) {
            var tipoLabel = b.kind === "percentual" ? "Percentual sobre venda (" + b.refPercent + "% de " + Utils.fmtMoney(b.refValue) + ")" :
              b.kind === "desconto" ? "Desconto / dedução" : "Valor fixo";
            var valClass = b.amount < 0 ? "text-danger" : "";
            return '<tr>' +
              '<td>' + Utils.escapeHtml(b.description) + '</td>' +
              '<td>' + tipoLabel + '</td>' +
              '<td class="text-right text-num font-bold ' + valClass + '">' + (b.amount < 0 ? "- " + Utils.fmtMoney(Math.abs(b.amount)) : Utils.fmtMoney(b.amount)) + '</td>' +
              '<td><button class="btn btn-icon btn-ghost" data-del-bonus="' + b.id + '" title="Remover"><i class="fa-solid fa-trash"></i></button></td>' +
              '</tr>';
          }).join("") + '</tbody>' +
          '<tfoot><tr style="font-weight:800;border-top:1px solid var(--border-color);"><td colspan="2">Subtotal</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(round2(sumBy(bonuses, "amount"))) + '</td><td></td></tr></tfoot>' +
          '</table>';
        Utils.qsa("[data-del-bonus]", sec).forEach(function (btn) {
          btn.addEventListener("click", function () {
            Modal.confirm({
              title: "Remover lançamento", message: "Deseja remover este lançamento de comissionamento esporádico?", danger: true,
              onConfirm: function () {
                var bonus = DB.get("commissionBonuses", btn.getAttribute("data-del-bonus"));
                DB.remove("commissionBonuses", btn.getAttribute("data-del-bonus"));
                if (bonus) DB.log("Comissão", "Removeu o lançamento \"" + bonus.description + "\" de " + e.name);
                Toast.show("Lançamento removido", "success");
                refreshGrandTotal();
              }
            });
          });
        });
      }
    }

    function refreshGrandTotal() {
      var newRow = computeRows().find(function (r) { return r.employee.id === employeeId; });
      if (newRow) box.querySelector("#dm-grand-total").textContent = Utils.fmtMoney(newRow.devido);
      renderBonusSection();
      render(); // keep the page-level table/summary in sync while the modal is open
    }

    renderBonusSection();
    box.querySelector("#dm-add-bonus").addEventListener("click", function () {
      openBonusModal(employeeId, refreshGrandTotal);
    });
  }

  // Mostra o consumo de insumos (ml/g) lançado para o profissional no mês —
  // metade do custo é dele (desconta do Devido), metade já virou despesa da
  // empresa em Lançamentos (ver assets/js/consumo.js).
  function consumoSectionHtml(row) {
    if (!row.consumoItems || !row.consumoItems.length) return "";
    var products = DB.all("products");
    var linesHtml = row.consumoItems.map(function (c) {
      var p = products.find(function (x) { return x.id === c.productId; });
      return '<tr>' +
        '<td>' + Utils.fmtDate(c.date) + '</td>' +
        '<td>' + Utils.escapeHtml(p ? p.name : "-") + '</td>' +
        '<td class="text-right text-num">' + (window.Consumo ? Consumo.fmtQty(c.quantity, c.unit) : c.quantity + c.unit) + '</td>' +
        '<td class="text-right text-num">' + Utils.fmtMoney(c.totalCost) + '</td>' +
        '<td class="text-right text-num font-bold text-danger">- ' + Utils.fmtMoney(c.employeeShare) + '</td>' +
        '</tr>';
    }).join("");
    return '<h4 style="font-size:14px;margin-top:18px;margin-bottom:8px;">Desconto por Consumo de Insumos</h4>' +
      '<table class="data-table"><thead><tr><th>Data</th><th>Produto</th><th class="text-right">Qtd.</th><th class="text-right">Custo Total</th><th class="text-right">Sua Metade</th></tr></thead>' +
      '<tbody>' + linesHtml + '</tbody>' +
      '<tfoot><tr style="font-weight:800;border-top:1px solid var(--border-color);"><td colspan="4">Subtotal do desconto</td>' +
      '<td class="text-right text-num text-danger">- ' + Utils.fmtMoney(row.consumoTotal) + '</td></tr></tfoot></table>';
  }

  // Lançamento livre de "Comissionamento Esporádico" — para premiar um
  // profissional fora da regra padrão de comissão (valor fixo, percentual
  // extra sobre uma venda específica) ou para descontar/deduzir algum
  // valor do comissionamento do mês (ex.: material quebrado, adiantamento).
  function openBonusModal(presetEmployeeId, onSaved) {
    var employees = DB.all("employees").filter(function (e) { return e.commissionRate > 0; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!employees.length) { Toast.show("Nenhum profissional comissionado cadastrado", "danger"); return; }

    var months = [];
    var today = Utils.todayISO();
    for (var i = 0; i < 10; i++) months.push(Utils.monthKey(Utils.addMonths(today, -i)));

    var body =
      '<div class="form-grid">' +
        '<div class="form-field full"><label>Profissional</label><select id="bm-employee"' + (presetEmployeeId ? " disabled" : "") + '>' +
          employees.map(function (e) { return '<option value="' + e.id + '"' + (presetEmployeeId === e.id ? " selected" : "") + '>' + Utils.escapeHtml(e.name) + ' — ' + Utils.escapeHtml(e.role) + '</option>'; }).join("") + '</select></div>' +
        '<div class="form-field"><label>Mês de Competência</label><select id="bm-month">' +
          months.map(function (m) { return '<option value="' + m + '"' + (m === selectedMonth ? " selected" : "") + '>' + Utils.monthLabel(m + "-01") + '</option>'; }).join("") + '</select></div>' +
        '<div class="form-field"><label>Tipo</label><select id="bm-kind">' +
          '<option value="fixo">Valor fixo (bônus/prêmio)</option>' +
          '<option value="percentual">Percentual extra sobre uma venda/produto</option>' +
          '<option value="desconto">Desconto / dedução de despesa</option>' +
          '</select></div>' +
        '<div class="form-field full"><label>Descrição</label><input type="text" id="bm-desc" placeholder="Ex: Bônus por meta batida em agosto, desconto por material quebrado..."></div>' +
        '<div class="form-field" id="bm-fixed-wrap"><label>Valor (R$)</label><input type="text" id="bm-amount-fixed"></div>' +
        '<div class="form-field" id="bm-pct-value-wrap" style="display:none;"><label>Valor da Venda/Produto (R$)</label><input type="text" id="bm-pct-value"></div>' +
        '<div class="form-field" id="bm-pct-percent-wrap" style="display:none;"><label>Percentual Extra (%)</label><input type="number" step="0.1" min="0" id="bm-pct-percent"></div>' +
        '<div class="form-field" id="bm-desconto-wrap" style="display:none;"><label>Valor a Descontar (R$)</label><input type="text" id="bm-amount-desconto"></div>' +
      '</div>' +
      '<div class="sale-total-bar" style="margin-top:12px;"><span id="bm-preview-label">Valor que será somado ao Devido</span><span id="bm-preview">R$ 0,00</span></div>';

    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="bm-save">Salvar Lançamento</button>';
    var box = Modal.open({ title: "Novo Comissionamento Esporádico", bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#bm-amount-fixed"), 0);
    Utils.wireMoneyMask(box.querySelector("#bm-pct-value"), 0);
    Utils.wireMoneyMask(box.querySelector("#bm-amount-desconto"), 0);

    var kindSel = box.querySelector("#bm-kind");
    var fixedWrap = box.querySelector("#bm-fixed-wrap");
    var pctValueWrap = box.querySelector("#bm-pct-value-wrap");
    var pctPercentWrap = box.querySelector("#bm-pct-percent-wrap");
    var descontoWrap = box.querySelector("#bm-desconto-wrap");
    var preview = box.querySelector("#bm-preview");
    var previewLabel = box.querySelector("#bm-preview-label");

    function updatePreview() {
      var amount = 0;
      if (kindSel.value === "fixo") {
        amount = Utils.moneyMaskToFloat(box.querySelector("#bm-amount-fixed"));
      } else if (kindSel.value === "percentual") {
        var val = Utils.moneyMaskToFloat(box.querySelector("#bm-pct-value"));
        var pct = parseFloat(box.querySelector("#bm-pct-percent").value) || 0;
        amount = round2(val * (pct / 100));
      } else {
        amount = -Utils.moneyMaskToFloat(box.querySelector("#bm-amount-desconto"));
      }
      previewLabel.textContent = amount < 0 ? "Valor que será descontado do Devido" : "Valor que será somado ao Devido";
      preview.textContent = amount < 0 ? "- " + Utils.fmtMoney(Math.abs(round2(amount))) : Utils.fmtMoney(round2(amount));
    }

    kindSel.addEventListener("change", function () {
      var isPct = kindSel.value === "percentual";
      var isDesc = kindSel.value === "desconto";
      fixedWrap.style.display = (!isPct && !isDesc) ? "" : "none";
      pctValueWrap.style.display = isPct ? "" : "none";
      pctPercentWrap.style.display = isPct ? "" : "none";
      descontoWrap.style.display = isDesc ? "" : "none";
      updatePreview();
    });
    box.querySelector("#bm-amount-fixed").addEventListener("input", updatePreview);
    box.querySelector("#bm-pct-value").addEventListener("input", updatePreview);
    box.querySelector("#bm-pct-percent").addEventListener("input", updatePreview);
    box.querySelector("#bm-amount-desconto").addEventListener("input", updatePreview);

    box.querySelector("#bm-save").addEventListener("click", function () {
      var employeeId = presetEmployeeId || box.querySelector("#bm-employee").value;
      var month = box.querySelector("#bm-month").value;
      var kind = kindSel.value;
      var desc = box.querySelector("#bm-desc").value.trim();
      if (!desc) { Toast.show("Informe uma descrição", "danger"); return; }

      var record = { employeeId: employeeId, month: month, kind: kind, description: desc };
      if (kind === "fixo") {
        var amount = Utils.moneyMaskToFloat(box.querySelector("#bm-amount-fixed"));
        if (!amount || amount <= 0) { Toast.show("Informe um valor válido", "danger"); return; }
        record.amount = round2(amount);
        record.refValue = null; record.refPercent = null;
      } else if (kind === "percentual") {
        var val = Utils.moneyMaskToFloat(box.querySelector("#bm-pct-value"));
        var pct = parseFloat(box.querySelector("#bm-pct-percent").value);
        if (!val || val <= 0) { Toast.show("Informe o valor da venda/produto", "danger"); return; }
        if (!pct || pct <= 0) { Toast.show("Informe o percentual extra", "danger"); return; }
        record.amount = round2(val * (pct / 100));
        record.refValue = round2(val); record.refPercent = pct;
      } else {
        var descAmount = Utils.moneyMaskToFloat(box.querySelector("#bm-amount-desconto"));
        if (!descAmount || descAmount <= 0) { Toast.show("Informe o valor a descontar", "danger"); return; }
        record.amount = -round2(descAmount);
        record.refValue = null; record.refPercent = null;
      }

      DB.insert("commissionBonuses", record);
      var emp = DB.get("employees", employeeId);
      var verb = record.amount < 0 ? "Lançou desconto" : "Lançou comissionamento esporádico";
      DB.log("Comissão", verb + " \"" + desc + "\" para " + (emp ? emp.name : "profissional") + " — " + Utils.fmtMoney(Math.abs(record.amount)) + " (ref. " + Utils.monthLabel(month + "-01") + ")");
      Modal.close();
      Toast.show(record.amount < 0 ? "Desconto registrado" : "Comissionamento esporádico registrado", "success");
      if (onSaved) onSaved(); else render();
    });
  }

  function registerPayment(employeeId) {
    var rows = computeRows();
    var row = rows.find(function (r) { return r.employee.id === employeeId; });
    if (!row) return;
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Profissional</label><input type="text" value="' + Utils.escapeHtml(row.employee.name) + '" disabled></div>' +
      '<div class="form-field"><label>Mês de Referência</label><input type="text" value="' + Utils.monthLabel(selectedMonth + "-01") + '" disabled></div>' +
      '<div class="form-field"><label>Valor a Pagar (R$)</label><input type="text" id="pay-amount"></div>' +
      '<div class="form-field"><label>Data do Pagamento</label><input type="date" id="pay-date" value="' + Utils.todayISO() + '"></div>' +
      '<div class="form-field"><label>Forma de Pagamento</label><select id="pay-method"><option>Transferência</option><option>Pix</option><option>Dinheiro</option></select></div>' +
      '</div>' +
      Utils.attachmentFieldHtml("pay", "Comprovante de Pagamento (opcional)");
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="pay-save">Confirmar Pagamento</button>';
    var box = Modal.open({ title: "Registrar Pagamento de Comissão", bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#pay-amount"), row.saldo);
    var payAttachment = Utils.wireAttachmentField(box, "pay");
    box.querySelector("#pay-save").addEventListener("click", function () {
      var amount = Utils.moneyMaskToFloat(box.querySelector("#pay-amount"));
      if (!amount || amount <= 0) { Toast.show("Informe um valor válido", "danger"); return; }
      DB.insert("transactions", {
        type: "despesa", description: "Comissão - " + row.employee.name + " (ref. " + Utils.monthLabel(selectedMonth + "-01") + ")",
        amount: round2(amount), date: box.querySelector("#pay-date").value, categoryId: commissionCatId(),
        costCenterId: DB.findOne("costCenters", function (c) { return c.key === "rh"; }) ? DB.findOne("costCenters", function (c) { return c.key === "rh"; }).id : null,
        paymentMethod: box.querySelector("#pay-method").value, status: "pago", employeeId: row.employee.id,
        relatedMonth: selectedMonth, reconciled: false,
        attachment: payAttachment.get()
      });
      DB.log("Comissão", "Registrou pagamento de comissão de " + row.employee.name + " — " + Utils.fmtMoney(amount) + " (ref. " + Utils.monthLabel(selectedMonth + "-01") + ")");
      Modal.close();
      Toast.show("Pagamento de comissão registrado", "success");
      render();
    });
  }

  // Soma, em módulo, todos os lançamentos de "Desconto / dedução" (valor
  // negativo em commissionBonuses) do mês selecionado, de todos os
  // profissionais — separado do desconto automático de consumo interno
  // (esse é recorrente/operacional, não "esporádico"). Ver openBonusModal.
  function sporadicDiscountTotal() {
    var total = DB.all("commissionBonuses")
      .filter(function (b) { return b.month === selectedMonth && b.amount < 0; })
      .reduce(function (s, b) { return s + b.amount; }, 0);
    return round2(Math.abs(total));
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }
  function sumBy(arr, field) { return arr.reduce(function (s, t) { return s + (Number(t[field]) || 0); }, 0); }
  function round2(n) { return Math.round(n * 100) / 100; }
})();
