/* ============================================================
   Salão ERP — Conciliação Bancária
   Importa o extrato (CSV) e concilia manualmente com os lançamentos
   pagos do sistema — Entradas e Saídas em abas separadas. Toda
   conciliação é uma ação explícita da pessoa (escolher o par,
   conferir os dados lado a lado e confirmar) — não há sugestão
   automática que já venha marcada/aplicada: dados reais de produção
   exigem revisão deliberada, não um "match" cego por proximidade.
   ============================================================ */
(function () {
  "use strict";

  var state = { dir: "receita" }; // "receita" = Entradas, "despesa" = Saídas
  var rfilter = { start: "", end: "" };
  var histSortState = { field: null, dir: "asc" }; // clique no rótulo da coluna para ordenar

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    var today = Utils.todayISO();
    rfilter.start = Utils.addDays(today, -15);
    rfilter.end = today;
    Utils.qs("#rf-start").value = rfilter.start;
    Utils.qs("#rf-end").value = rfilter.end;
    Utils.qs("#rf-start").addEventListener("change", function (e) { rfilter.start = e.target.value; render(); });
    Utils.qs("#rf-end").addEventListener("change", function (e) { rfilter.end = e.target.value; render(); });
    Utils.qs("#btn-clear-recon-filters").addEventListener("click", function () {
      rfilter.start = ""; rfilter.end = ""; Utils.qs("#rf-start").value = ""; Utils.qs("#rf-end").value = ""; render();
    });

    Utils.qsa(".tab-btn", Utils.qs("#recon-tabs")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        Utils.qsa(".tab-btn", Utils.qs("#recon-tabs")).forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.dir = btn.getAttribute("data-dir");
        render();
      });
    });

    var zone = Utils.qs("#upload-zone");
    var fileInput = Utils.qs("#file-input");
    zone.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function (e) { if (e.target.files[0]) handleFile(e.target.files[0]); fileInput.value = ""; });
    ["dragover", "dragenter"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("dragover"); });
    });
    zone.addEventListener("drop", function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    render();
  }

  // Direção (Entradas/Saídas) de uma linha do extrato: pelo sinal do valor
  // (positivo = entrada, negativo = saída — mesma convenção já usada na
  // importação e no gerador de extrato de exemplo).
  function dirOfBankLine(b) { return b.amount >= 0 ? "receita" : "despesa"; }

  // ---------------- Import ----------------
  function handleFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var parsed = Utils.parseCSV(e.target.result);
        if (!parsed.rows.length) { Toast.show("Arquivo vazio ou inválido", "danger"); return; }
        openImportPreview(parsed);
      } catch (err) {
        console.error(err);
        Toast.show("Não foi possível ler o CSV", "danger");
      }
    };
    reader.readAsText(file, "UTF-8");
  }

  function guessColumn(headers, keywords) {
    for (var i = 0; i < headers.length; i++) {
      for (var k = 0; k < keywords.length; k++) {
        if (headers[i].indexOf(keywords[k]) > -1) return i;
      }
    }
    return -1;
  }

  function openImportPreview(parsed) {
    var headers = parsed.headers;
    var hasHeader = guessColumn(headers, ["data", "date", "desc", "hist", "valor", "value", "amount"]) > -1;
    var rows = hasHeader ? parsed.rows : [headers].concat(parsed.rows);
    var colCount = rows[0].length;
    var cols = [];
    for (var c = 0; c < colCount; c++) cols.push("Coluna " + (c + 1));

    var guessDate = hasHeader ? guessColumn(headers, ["data", "date"]) : 0;
    var guessDesc = hasHeader ? guessColumn(headers, ["desc", "hist", "lancamento", "lançamento"]) : 1;
    var guessValue = hasHeader ? guessColumn(headers, ["valor", "value", "amount"]) : 2;
    if (guessDate === -1) guessDate = 0;
    if (guessDesc === -1) guessDesc = 1;
    if (guessValue === -1) guessValue = colCount - 1;

    function colOptions(selected) {
      return cols.map(function (c, i) { return '<option value="' + i + '"' + (i === selected ? " selected" : "") + '>' + c + (hasHeader && headers[i] ? " (" + headers[i] + ")" : "") + '</option>'; }).join("");
    }

    var previewRows = rows.slice(0, 5);
    var body =
      '<p class="small text-muted mb-16">Confirme qual coluna corresponde a cada campo. Detectamos ' + rows.length + ' linha(s).</p>' +
      '<div class="form-grid cols-3 mb-16">' +
        '<div class="form-field"><label>Coluna de Data</label><select id="map-date">' + colOptions(guessDate) + '</select></div>' +
        '<div class="form-field"><label>Coluna de Descrição</label><select id="map-desc">' + colOptions(guessDesc) + '</select></div>' +
        '<div class="form-field"><label>Coluna de Valor</label><select id="map-value">' + colOptions(guessValue) + '</select></div>' +
      '</div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr>' + cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") + '</tr></thead><tbody>' +
      previewRows.map(function (r) { return "<tr>" + r.map(function (v) { return "<td>" + Utils.escapeHtml(v) + "</td>"; }).join("") + "</tr>"; }).join("") +
      '</tbody></table></div>';

    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="btn-confirm-import">Importar ' + rows.length + ' linha(s)</button>';
    var box = Modal.open({ title: "Pré-visualizar Importação", bodyHtml: body, footHtml: foot, wide: true });

    box.querySelector("#btn-confirm-import").addEventListener("click", function () {
      var dIdx = parseInt(box.querySelector("#map-date").value, 10);
      var descIdx = parseInt(box.querySelector("#map-desc").value, 10);
      var vIdx = parseInt(box.querySelector("#map-value").value, 10);
      var inserted = 0;
      var newLines = rows.map(function (r) {
        var rawDate = r[dIdx], desc = r[descIdx], amount = Utils.parseMoneyStr(r[vIdx]);
        var iso = normalizeDate(rawDate);
        if (!iso || !desc) return null;
        inserted++;
        return { date: iso, description: desc.slice(0, 140), amount: amount, matched: false, matchedTransactionId: null, importedAt: DB.nowISO(), source: "import" };
      }).filter(Boolean);
      DB.insertMany("bankLines", newLines);
      Modal.close();
      Toast.show(inserted + " linha(s) importada(s) do extrato", "success");
      render();
    });
  }

  function normalizeDate(raw) {
    if (!raw) return null;
    raw = raw.trim();
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      var dd = m[1].padStart(2, "0"), mm = m[2].padStart(2, "0"), yy = m[3];
      if (yy.length === 2) yy = "20" + yy;
      return yy + "-" + mm + "-" + dd;
    }
    return null;
  }

  // ---------------- Comparação lado a lado ----------------
  function computeMatchDiff(bankLine, txn) {
    var expectedAmount = txn.type === "receita" ? txn.amount : -txn.amount;
    var amountDiff = round2(bankLine.amount - expectedAmount);
    var dayDiff = Utils.daysBetween(txn.date, bankLine.date);
    return {
      expectedAmount: expectedAmount,
      amountDiff: amountDiff,
      amountOk: Math.abs(amountDiff) < 0.01,
      dayDiff: dayDiff,
      dateOk: dayDiff === 0
    };
  }

  function amountDiffBadge(diff) {
    if (diff.amountOk) return '<span class="badge badge-success"><i class="fa-solid fa-check"></i> valores idênticos</span>';
    var cls = Math.abs(diff.amountDiff) < 5 ? "badge-warning" : "badge-danger";
    return '<span class="badge ' + cls + '">Δ ' + Utils.fmtMoney(Math.abs(diff.amountDiff)) + '</span>';
  }

  function dateDiffBadge(diff) {
    if (diff.dateOk) return '<span class="badge badge-success"><i class="fa-solid fa-check"></i> mesma data</span>';
    var cls = Math.abs(diff.dayDiff) <= 2 ? "badge-warning" : "badge-danger";
    return '<span class="badge ' + cls + '">' + Math.abs(diff.dayDiff) + ' dia(s) de diferença</span>';
  }

  // Tabela "Extrato x Lançamento" lado a lado, usada antes de confirmar
  // qualquer conciliação manual — nenhuma conciliação é gravada sem essa
  // conferência explícita.
  function buildComparisonTableHtml(bankLine, txn) {
    var client = txn.clientId ? DB.get("clients", txn.clientId) : null;
    var cat = txn.categoryId ? DB.get("categories", txn.categoryId) : null;
    var diff = computeMatchDiff(bankLine, txn);
    var muted = '<span class="text-muted">—</span>';

    function row(label, bankVal, txnVal) {
      return '<tr><td class="compare-label">' + label + '</td><td>' + bankVal + '</td><td>' + txnVal + '</td></tr>';
    }
    function diffRow(label, badgeHtml) {
      return '<tr class="compare-diff-row"><td class="compare-label">' + label + '</td><td colspan="2">' + badgeHtml + '</td></tr>';
    }

    var html = '<table class="compare-table"><thead><tr><th>Campo</th><th>Extrato do Banco</th><th>Lançamento do Sistema</th></tr></thead><tbody>';
    html += row("Valor",
      '<span class="font-bold ' + (bankLine.amount >= 0 ? "text-success" : "text-danger") + '">' + Utils.fmtMoney(bankLine.amount) + '</span>',
      '<span class="font-bold ' + (txn.type === "receita" ? "text-success" : "text-danger") + '">' + (txn.type === "receita" ? "+ " : "- ") + Utils.fmtMoney(txn.amount) + '</span>');
    html += diffRow("Diferença de valor", amountDiffBadge(diff));
    html += row("Data", Utils.fmtDate(bankLine.date), Utils.fmtDate(txn.date));
    html += diffRow("Diferença de data", dateDiffBadge(diff));
    html += row("Descrição / Cliente", Utils.escapeHtml(bankLine.description), Utils.escapeHtml(txn.description) + (client ? '<div class="ri-meta">Cliente: ' + Utils.escapeHtml(client.name) + '</div>' : ''));
    html += row("Forma de Pagamento", muted, txn.paymentMethod ? Utils.escapeHtml(txn.paymentMethod) : muted);
    html += row("Categoria", muted, cat ? Utils.escapeHtml(cat.name) : muted);
    html += '</tbody></table>';
    return html;
  }

  // Passo final, obrigatório, antes de gravar qualquer conciliação: mostra
  // o comparativo lado a lado e só grava se a pessoa confirmar
  // explicitamente — nunca é chamado automaticamente.
  function openConfirmCompareModal(bankId, txnId) {
    var b = DB.get("bankLines", bankId);
    var t = DB.get("transactions", txnId);
    if (!b || !t) { Toast.show("Registro não encontrado ou já conciliado", "danger"); render(); return; }
    var body =
      '<p class="small text-muted mb-16">Confira os dados abaixo antes de confirmar a conciliação.</p>' +
      buildComparisonTableHtml(b, t);
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="btn-confirm-match"><i class="fa-solid fa-check"></i> Confirmar Conciliação</button>';
    var box = Modal.open({ title: "Comparar e Confirmar Conciliação", bodyHtml: body, footHtml: foot, wide: true });
    box.querySelector("#btn-confirm-match").addEventListener("click", function () {
      Modal.close();
      matchPair(bankId, txnId);
    });
  }

  function matchPair(bankId, txnId) {
    DB.update("bankLines", bankId, { matched: true, matchedTransactionId: txnId });
    DB.update("transactions", txnId, { reconciled: true, bankLineId: bankId });
    DB.log("Conciliação", "Conciliou manualmente um lançamento com uma linha do extrato bancário");
    Toast.show("Conciliado com sucesso", "success");
    render();
  }

  // ---------------- Menu "..." (3 pontinhos) por linha ----------------
  function openBankLineMenu(anchorEl, b) {
    ActionMenu.open(anchorEl, [
      { label: "Conciliar com um lançamento…", icon: "fa-link", onClick: function () { openMatchPicker("bank", b); } },
      { label: "Conciliação manual justificada…", icon: "fa-pen-to-square", onClick: function () { openManualReconcileModal("bank", b); } },
      { divider: true },
      { label: "Criar lançamento a partir desta linha", icon: "fa-plus", onClick: function () { createTxnFromBankLine(b.id); } },
      { label: "Ignorar esta linha", icon: "fa-eye-slash", danger: true, onClick: function () { ignoreBankLine(b.id); } }
    ]);
  }

  function openTxnMenu(anchorEl, t) {
    ActionMenu.open(anchorEl, [
      { label: "Conciliar com uma linha do extrato…", icon: "fa-link", onClick: function () { openMatchPicker("txn", t); } },
      { label: "Conciliação manual justificada…", icon: "fa-pen-to-square", onClick: function () { openManualReconcileModal("txn", t); } },
      { divider: true },
      { label: "Ignorar este lançamento", icon: "fa-eye-slash", danger: true, onClick: function () { ignoreTxn(t.id); } }
    ]);
  }

  // Lista candidatos do outro lado (mesma direção Entrada/Saída, ainda em
  // aberto) para a pessoa ESCOLHER manualmente qual concilia com o registro
  // clicado — ordenados por proximidade de valor/data só para facilitar
  // achar o candidato certo mais rápido (igual a qualquer sistema de
  // conciliação bancária do mercado), nunca aplicando nada sozinho: a
  // escolha final é sempre um clique explícito, seguido da comparação lado
  // a lado antes de confirmar.
  function openMatchPicker(fromType, record) {
    var isBank = fromType === "bank";
    var dir = isBank ? dirOfBankLine(record) : record.type;
    var refDate = record.date;
    var refAmount = isBank ? record.amount : (record.type === "receita" ? record.amount : -record.amount);

    var candidates = isBank
      ? DB.all("transactions").filter(function (t) { return t.type === dir && t.status === "pago" && !t.reconciled; })
      : DB.all("bankLines").filter(function (b) { return !b.matched && dirOfBankLine(b) === dir; });

    if (!candidates.length) {
      Toast.show("Não há " + (isBank ? "lançamentos do sistema" : "linhas do extrato") + " em aberto para conciliar nesta direção", "info");
      return;
    }

    candidates = candidates.slice().sort(function (x, y) {
      var xAmt = isBank ? (x.type === "receita" ? x.amount : -x.amount) : x.amount;
      var yAmt = isBank ? (y.type === "receita" ? y.amount : -y.amount) : y.amount;
      var xOk = Math.abs(xAmt - refAmount) < 0.01, yOk = Math.abs(yAmt - refAmount) < 0.01;
      if (xOk !== yOk) return xOk ? -1 : 1;
      var xDiff = Math.abs(Utils.daysBetween(x.date, refDate));
      var yDiff = Math.abs(Utils.daysBetween(y.date, refDate));
      return xDiff - yDiff;
    });

    var CAP = 100;
    var toShow = candidates.slice(0, CAP);
    var rowsHtml = toShow.map(function (c, i) {
      var cAmt = isBank ? (c.type === "receita" ? c.amount : -c.amount) : c.amount;
      var amtOk = Math.abs(cAmt - refAmount) < 0.01;
      return '<tr>' +
        '<td class="text-num">' + Utils.fmtDate(c.date) + '</td>' +
        '<td>' + Utils.escapeHtml(c.description) + '</td>' +
        '<td class="text-right ' + (amtOk ? "text-success font-bold" : "") + '">' + Utils.fmtMoney(Math.abs(cAmt)) + '</td>' +
        '<td><button type="button" class="btn btn-sm btn-outline" data-pick="' + i + '">Selecionar</button></td>' +
        '</tr>';
    }).join("");
    var capNote = candidates.length > CAP ? '<div class="small text-muted mt-8">Mostrando ' + CAP + ' de ' + candidates.length + '. Reduza o período no filtro de data para ver os demais.</div>' : "";

    var body =
      '<p class="small text-muted mb-16">Registro selecionado: <strong>' + Utils.escapeHtml(record.description) + '</strong> · ' + Utils.fmtDate(refDate) + ' · ' + Utils.fmtMoney(Math.abs(refAmount)) + '</p>' +
      '<p class="small text-muted mb-16">Escolha ' + (isBank ? "o lançamento do sistema" : "a linha do extrato") + ' correspondente. Você vai conferir os dados lado a lado antes de confirmar.</p>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Descrição</th><th class="text-right">Valor</th><th></th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' + capNote;
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button>';
    var box = Modal.open({ title: "Conciliar — Escolher Correspondente", bodyHtml: body, footHtml: foot, wide: true });
    Utils.qsa("[data-pick]", box).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var c = toShow[parseInt(btn.getAttribute("data-pick"), 10)];
        Modal.close();
        if (isBank) openConfirmCompareModal(record.id, c.id);
        else openConfirmCompareModal(c.id, record.id);
      });
    });
  }

  // Conciliação manual justificada: para quando não existe (e não vai
  // existir) um registro correspondente do outro lado — ex. uma tarifa
  // bancária cobrada direto na conta, sem lançamento no sistema; ou um
  // lançamento do sistema que nunca aparece isolado no extrato (pagamento
  // agrupado/lote). Exige justificativa por escrito, fica registrada e
  // visível no Histórico, e pode ser desfeita a qualquer momento.
  function openManualReconcileModal(fromType, record) {
    var isBank = fromType === "bank";
    var label = isBank
      ? Utils.escapeHtml(record.description) + " · " + Utils.fmtDate(record.date) + " · " + Utils.fmtMoney(record.amount)
      : Utils.escapeHtml(record.description) + " · " + Utils.fmtDate(record.date) + " · " + (record.type === "receita" ? "+ " : "- ") + Utils.fmtMoney(record.amount);
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Registro</label><input type="text" value="' + label + '" disabled></div>' +
      '<div class="form-field full"><label>Justificativa <span class="text-danger">*</span></label>' +
      '<textarea id="mr-note" rows="3" placeholder="Ex.: tarifa bancária cobrada direto na conta, pagamento agrupado com outros lançamentos, etc."></textarea></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="mr-confirm"><i class="fa-solid fa-check"></i> Confirmar Conciliação Manual</button>';
    var box = Modal.open({ title: "Conciliação Manual Justificada", bodyHtml: body, footHtml: foot });
    box.querySelector("#mr-confirm").addEventListener("click", function () {
      var note = box.querySelector("#mr-note").value.trim();
      if (!note) { Toast.show("Informe a justificativa antes de confirmar", "danger"); return; }
      if (isBank) {
        DB.update("bankLines", record.id, { matched: true, matchedTransactionId: null, manualNote: note });
      } else {
        DB.update("transactions", record.id, { reconciled: true, bankLineId: null, manualReconcileNote: note });
      }
      DB.log("Conciliação", "Conciliação manual justificada: \"" + record.description + "\" — " + note);
      Modal.close();
      Toast.show("Conciliação manual registrada", "success");
      render();
    });
  }

  function ignoreBankLine(id) {
    Modal.confirm({
      title: "Ignorar linha do extrato",
      message: "Esta linha sai da lista de pendentes sem virar uma conciliação. Dá para reverter depois pelo Histórico. Confirmar?",
      confirmLabel: "Ignorar",
      onConfirm: function () {
        DB.update("bankLines", id, { matched: true, matchedTransactionId: null, ignored: true });
        DB.log("Conciliação", "Ignorou uma linha do extrato bancário");
        Toast.show("Linha ignorada", "info");
        render();
      }
    });
  }

  function ignoreTxn(id) {
    Modal.confirm({
      title: "Ignorar lançamento",
      message: "Este lançamento sai da lista de pendentes de conciliação sem vincular a uma linha do extrato. Dá para reverter depois pelo Histórico. Confirmar?",
      confirmLabel: "Ignorar",
      onConfirm: function () {
        DB.update("transactions", id, { reconciled: true, bankLineId: null, ignoredReconciliation: true });
        DB.log("Conciliação", "Ignorou um lançamento na conciliação bancária");
        Toast.show("Lançamento ignorado", "info");
        render();
      }
    });
  }

  // Desfaz qualquer item do Histórico — par conciliado, manual ou ignorado,
  // de qualquer um dos dois lados.
  function undoHistoryItem(item) {
    if (item.source === "bank") {
      DB.update("bankLines", item.bankId, { matched: false, matchedTransactionId: null, manualNote: null, ignored: false });
      if (item.txn) DB.update("transactions", item.txn.id, { reconciled: false, bankLineId: null });
    } else {
      DB.update("transactions", item.txnId, { reconciled: false, bankLineId: null, manualReconcileNote: null, ignoredReconciliation: false });
    }
    DB.log("Conciliação", "Desfez uma conciliação bancária");
    Toast.show("Conciliação desfeita", "info");
    render();
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function createTxnFromBankLine(bankId) {
    var b = DB.get("bankLines", bankId);
    if (!b) return;
    var isReceita = b.amount >= 0;
    var categories = DB.all("categories").filter(function (c) { return c.type === (isReceita ? "receita" : "despesa"); });
    var costCenters = DB.all("costCenters");
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Descrição</label><input type="text" id="cf-desc" value="' + Utils.escapeHtml(b.description) + '"></div>' +
      '<div class="form-field"><label>Data</label><input type="date" id="cf-date" value="' + b.date + '"></div>' +
      '<div class="form-field"><label>Valor (R$)</label><input type="text" id="cf-amount"></div>' +
      '<div class="form-field"><label>Tipo</label><input type="text" value="' + (isReceita ? "Receita" : "Despesa") + '" disabled></div>' +
      '<div class="form-field"><label>Categoria</label><select id="cf-cat">' + categories.map(function (c) { return '<option value="' + c.id + '">' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-field"><label>Centro de Custo</label><select id="cf-cc">' + costCenters.map(function (c) { return '<option value="' + c.id + '">' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cf-save">Criar e Conciliar</button>';
    var box = Modal.open({ title: "Criar Lançamento a partir do Extrato", bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#cf-amount"), Math.abs(b.amount));
    box.querySelector("#cf-save").addEventListener("click", function () {
      var cat = categories.find(function (c) { return c.id === box.querySelector("#cf-cat").value; });
      var txn = DB.insert("transactions", {
        type: isReceita ? "receita" : "despesa",
        description: box.querySelector("#cf-desc").value.trim() || b.description,
        amount: Math.abs(Utils.moneyMaskToFloat(box.querySelector("#cf-amount"))),
        date: box.querySelector("#cf-date").value,
        categoryId: box.querySelector("#cf-cat").value,
        costCenterId: box.querySelector("#cf-cc").value,
        paymentMethod: "Outro", status: "pago", reconciled: true, bankLineId: b.id
      });
      DB.update("bankLines", b.id, { matched: true, matchedTransactionId: txn.id });
      DB.log("Conciliação", "Criou um lançamento a partir do extrato bancário e conciliou (" + txn.description + ")");
      Modal.close();
      Toast.show("Lançamento criado e conciliado", "success");
      render();
    });
  }

  // ---------------- Render ----------------
  function render() {
    var dir = state.dir;
    var bankLines = DB.all("bankLines");
    var txns = DB.all("transactions");

    var unmatchedBankDir = bankLines.filter(function (b) { return !b.matched && dirOfBankLine(b) === dir; });
    var unmatchedTxnDir = txns.filter(function (t) { return t.status === "pago" && !t.reconciled && t.type === dir; });

    var unmatchedBank = unmatchedBankDir
      .filter(function (b) { return (!rfilter.start || b.date >= rfilter.start) && (!rfilter.end || b.date <= rfilter.end); })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });
    var unmatchedTxn = unmatchedTxnDir
      .filter(function (t) { return (!rfilter.start || t.date >= rfilter.start) && (!rfilter.end || t.date <= rfilter.end); })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });

    // "Linhas Importadas"/"Conciliadas" refletem TODO o histórico da
    // direção ativa (não só o período filtrado) — o período filtra apenas
    // as duas colunas de pendências abaixo, igual ao comportamento já
    // existente antes desta rodada.
    var bankLinesDirAll = bankLines.filter(function (b) { return dirOfBankLine(b) === dir; });
    var matchedCount = bankLinesDirAll.filter(function (b) { return b.matched; }).length;
    var totalBankLines = bankLinesDirAll.length;
    var pct = totalBankLines ? (matchedCount / totalBankLines * 100) : 0;

    document.getElementById("recon-summary").innerHTML = [
      kpi("Linhas Importadas", String(totalBankLines), "fa-file-lines", "#0eb8d9", "#dbf7fc"),
      kpi("Conciliadas", matchedCount + " (" + pct.toFixed(0) + "%)", "fa-circle-check", "#1baf7a", "#e2f5ec"),
      kpi("Extrato sem correspondência", String(unmatchedBank.length), "fa-triangle-exclamation", "#b7791f", "#fdf2df"),
      kpi("Lançamentos sem conciliar", String(unmatchedTxn.length), "fa-file-invoice", "#c23b3b", "#fbe6e6")
    ].join("");

    document.getElementById("bank-col-sub").textContent = unmatchedBank.length + " linha(s) em aberto — " + (dir === "receita" ? "Entradas" : "Saídas");
    document.getElementById("txn-col-sub").textContent = unmatchedTxn.length + " lançamento(s) pagos em aberto — " + (dir === "receita" ? "Entradas" : "Saídas");
    document.getElementById("hist-col-sub").textContent = "Pares já conciliados — " + (dir === "receita" ? "Entradas" : "Saídas");

    var RENDER_CAP = 60;
    var bankToRender = unmatchedBank.slice(0, RENDER_CAP);
    var txnToRender = unmatchedTxn.slice(0, RENDER_CAP);
    var bankCapNote = unmatchedBank.length > RENDER_CAP ? '<div class="small text-muted mt-8">Mostrando as ' + RENDER_CAP + ' mais recentes de ' + unmatchedBank.length + '. Reduza o período no filtro para ver as demais.</div>' : "";
    var txnCapNote = unmatchedTxn.length > RENDER_CAP ? '<div class="small text-muted mt-8">Mostrando ' + RENDER_CAP + ' de ' + unmatchedTxn.length + '. Reduza o período no filtro para ver os demais.</div>' : "";

    var bankEl = document.getElementById("bank-lines-list");
    if (!unmatchedBank.length) {
      bankEl.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-circle-check"></i></div><h4>Nada pendente no extrato</h4><p>Importe um novo extrato para continuar conciliando.</p></div>';
    } else {
      bankEl.innerHTML = bankToRender.map(function (b) {
        return '<div class="recon-item" data-bank="' + b.id + '">' +
          '<div>' +
            '<div class="ri-desc">' + Utils.escapeHtml(b.description) + '</div>' +
            '<div class="ri-meta">' + Utils.fmtDate(b.date) + '</div>' +
          '</div>' +
          '<div class="flex items-center gap-6">' +
            '<span class="font-bold ' + (b.amount >= 0 ? "text-success" : "text-danger") + '">' + Utils.fmtMoney(b.amount) + '</span>' +
            '<button type="button" class="ri-kebab-btn" data-bank-menu="' + b.id + '" title="Mais opções"><i class="fa-solid fa-ellipsis-vertical"></i></button>' +
          '</div></div>';
      }).join("") + bankCapNote;

      Utils.qsa("[data-bank-menu]", bankEl).forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var b = DB.get("bankLines", btn.getAttribute("data-bank-menu"));
          if (b) openBankLineMenu(btn, b);
        });
      });
    }

    var txnEl = document.getElementById("system-txn-list");
    var categories = DB.all("categories");
    if (!unmatchedTxn.length) {
      txnEl.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-circle-check"></i></div><h4>Tudo conciliado</h4><p>Todos os lançamentos pagos já foram batidos com o extrato.</p></div>';
    } else {
      txnEl.innerHTML = txnToRender.map(function (t) {
        var cat = categories.find(function (c) { return c.id === t.categoryId; });
        return '<div class="recon-item" data-txn="' + t.id + '">' +
          '<div>' +
            '<div class="ri-desc">' + Utils.escapeHtml(t.description) + '</div>' +
            '<div class="ri-meta">' + Utils.fmtDate(t.date) + ' · ' + (cat ? Utils.escapeHtml(cat.name) : "") + '</div>' +
          '</div>' +
          '<div class="flex items-center gap-6">' +
            '<span class="font-bold ' + (t.type === "receita" ? "text-success" : "text-danger") + '">' + (t.type === "receita" ? "+" : "-") + " " + Utils.fmtMoney(t.amount) + '</span>' +
            '<button type="button" class="ri-kebab-btn" data-txn-menu="' + t.id + '" title="Mais opções"><i class="fa-solid fa-ellipsis-vertical"></i></button>' +
          '</div></div>';
      }).join("") + txnCapNote;
      Utils.qsa("[data-txn-menu]", txnEl).forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var t = DB.get("transactions", btn.getAttribute("data-txn-menu"));
          if (t) openTxnMenu(btn, t);
        });
      });
    }

    renderHistory(dir);
  }

  // Monta a lista unificada do Histórico para a direção ativa: pares
  // conciliados (bankLine + lançamento), conciliações manuais justificadas
  // e itens ignorados — de qualquer um dos dois lados (extrato ou
  // lançamento), já que "conciliação manual" e "ignorar" podem começar de
  // qualquer um dos dois.
  function buildHistoryItems(dir) {
    var bankLines = DB.all("bankLines");
    var txns = DB.all("transactions");
    var items = [];

    bankLines.filter(function (b) { return b.matched && dirOfBankLine(b) === dir; }).forEach(function (b) {
      var t = b.matchedTransactionId ? txns.find(function (x) { return x.id === b.matchedTransactionId; }) : null;
      items.push({
        date: b.date,
        bankDesc: b.description,
        amount: b.amount,
        kind: t ? "pair" : (b.ignored ? "ignored" : "manual"),
        txn: t,
        note: b.manualNote,
        bankId: b.id,
        source: "bank"
      });
    });

    // conciliações manuais/ignoradas iniciadas pelo lado do lançamento, sem
    // linha do extrato vinculada (senão já estariam cobertas acima).
    txns.filter(function (t) { return t.reconciled && !t.bankLineId && t.type === dir; }).forEach(function (t) {
      items.push({
        date: t.date,
        bankDesc: null,
        amount: t.type === "receita" ? t.amount : -t.amount,
        kind: t.ignoredReconciliation ? "ignored" : "manual",
        txn: t,
        note: t.manualReconcileNote,
        txnId: t.id,
        source: "txn"
      });
    });

    return items.sort(function (a, b) { return b.date.localeCompare(a.date); });
  }

  function renderHistory(dir) {
    var items = buildHistoryItems(dir).slice(0, 40);
    var histTbl = document.getElementById("tbl-history");
    if (!items.length) {
      Utils.emptyTable(histTbl, "fa-clock", "Nenhuma conciliação realizada ainda");
      return;
    }
    var sortGetters = { description: function (it) { return it.bankDesc || (it.txn ? it.txn.description : ""); } };
    items = Utils.sortBy(items, histSortState, sortGetters);
    histTbl.innerHTML = '<thead><tr>' +
      Utils.thSort("Data", "date", histSortState) +
      Utils.thSort("Descrição", "description", histSortState) +
      Utils.thSort("Valor", "amount", histSortState, { className: "text-right" }) +
      '<th>Conciliação</th><th></th></tr></thead><tbody>' +
      items.map(function (it, i) {
        var desc = it.bankDesc || (it.txn ? it.txn.description : "-");
        var pairCol;
        if (it.kind === "pair") pairCol = Utils.escapeHtml(it.txn.description);
        else if (it.kind === "manual") pairCol = '<span class="recon-manual-note"><i class="fa-solid fa-pen-to-square"></i> ' + Utils.escapeHtml(it.note || "Manual") + '</span>';
        else pairCol = '<span class="text-muted"><i class="fa-solid fa-eye-slash"></i> Ignorado</span>';
        return '<tr><td class="text-num">' + Utils.fmtDate(it.date) + '</td><td>' + Utils.escapeHtml(desc) + '</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(it.amount) + '</td>' +
          '<td>' + pairCol + '</td>' +
          '<td><button class="btn btn-sm btn-ghost" data-undo="' + i + '">Desfazer</button></td></tr>';
      }).join("") + '</tbody>';
    Utils.wireSortHeaders(histTbl, histSortState, render);
    Utils.qsa("[data-undo]", histTbl).forEach(function (btn) {
      btn.addEventListener("click", function () { undoHistoryItem(items[parseInt(btn.getAttribute("data-undo"), 10)]); });
    });
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }
})();
