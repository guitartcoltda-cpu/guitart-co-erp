(function () {
  "use strict";

  var selectedBankId = null, selectedTxnId = null;
  var rfilter = { start: "", end: "" };

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

    Utils.qs("#btn-sample-csv").addEventListener("click", downloadSampleCSV);
    Utils.qs("#btn-auto-match").addEventListener("click", autoMatchAll);

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

  // ---------------- Sample CSV generator ----------------
  function downloadSampleCSV() {
    var today = Utils.todayISO();
    var unreconciled = DB.all("transactions").filter(function (t) {
      return t.status === "pago" && !t.reconciled && t.paymentMethod !== "Dinheiro";
    });
    if (!unreconciled.length) { Toast.show("Não há lançamentos pendentes de conciliação para simular", "info"); return; }

    var rows = [["data", "descricao", "valor"]];
    unreconciled.forEach(function (t) {
      var bankDate = Utils.addDays(t.date, [0, 1, 2][Math.floor(Math.random() * 3)]);
      var prefix = t.type === "receita" ? (t.paymentMethod === "Pix" ? "PIX RECEBIDO - " : "REC CARTAO - ") : (t.paymentMethod === "Transferência" ? "TED ENVIADA - " : "PGTO - ");
      var amount = t.type === "receita" ? t.amount : -t.amount;
      rows.push([bankDate, (prefix + t.description).slice(0, 90), String(round2(amount)).replace(".", ",")]);
    });
    // ruído: linhas sem correspondência no sistema
    var noise = [
      ["TARIFA PACOTE DE SERVICOS", -49.9], ["IOF OPERACAO CARTAO", -12.3],
      ["RENDIMENTO POUPANCA", 8.42], ["TED RECEBIDA - APORTE SOCIO", 1500],
      ["ESTORNO CARTAO CLIENTE", -35]
    ];
    noise.forEach(function (n) {
      var d = Utils.addDays(today, -Math.floor(Math.random() * 30));
      rows.push([d, n[0], String(n[1]).replace(".", ",")]);
    });

    var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(";"); }).join("\n");
    Utils.downloadFile("extrato_exemplo_" + today + ".csv", "﻿" + csv, "text/csv;charset=utf-8");
    Toast.show("Extrato de exemplo gerado — importe-o para testar a conciliação", "success");
  }

  // ---------------- Matching ----------------
  function findSuggestion(bankLine, txns) {
    var candidates = txns.filter(function (t) {
      var expected = t.type === "receita" ? t.amount : -t.amount;
      return Math.abs(expected - bankLine.amount) < 0.01;
    });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return Math.abs(Utils.daysBetween(a.date, bankLine.date)) - Math.abs(Utils.daysBetween(b.date, bankLine.date)); });
    var best = candidates[0];
    if (Math.abs(Utils.daysBetween(best.date, bankLine.date)) <= 6) return best;
    return null;
  }

  // Computes the verification data used by the side-by-side comparison views:
  // how far apart the bank line and the transaction actually are in value/date.
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

  // Full "Extrato x Lançamento" comparison table used before confirming a single
  // suggested match — this is the "fazer uma análise de fato" step: every field
  // available on both records is placed side by side instead of a blind "Confirmar".
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

  // Opens the mandatory review step for a single auto-suggested match: shows the
  // side-by-side comparison and only writes the reconciliation if the user
  // explicitly confirms — replaces the old one-click "Confirmar" button.
  function openSuggestionCompareModal(bankId, txnId) {
    var b = DB.get("bankLines", bankId);
    var t = DB.get("transactions", txnId);
    if (!b || !t) { Toast.show("Registro não encontrado ou já conciliado", "danger"); render(); return; }
    var body =
      '<p class="small text-muted mb-16"><i class="fa-solid fa-wand-magic-sparkles"></i> Esta é a sugestão automática encontrada pelo sistema para esta linha do extrato. Confira os dados abaixo antes de confirmar a conciliação.</p>' +
      buildComparisonTableHtml(b, t);
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="btn-confirm-suggestion"><i class="fa-solid fa-check"></i> Confirmar Conciliação</button>';
    var box = Modal.open({ title: "Comparar e Confirmar Conciliação", bodyHtml: body, footHtml: foot, wide: true });
    box.querySelector("#btn-confirm-suggestion").addEventListener("click", function () {
      Modal.close();
      matchPair(bankId, txnId, "sugestao");
    });
  }

  // Bulk "Conciliar sugestões automáticas" now only *proposes* matches — it no
  // longer writes anything to the DB by itself. The user reviews every proposed
  // pair (with the same value/date/description comparison) and can uncheck any
  // pair before confirming, so nothing is conciliated blindly.
  function autoMatchAll() {
    var bankLines = DB.all("bankLines").filter(function (b) { return !b.matched; });
    var txns = DB.all("transactions").filter(function (t) { return t.status === "pago" && !t.reconciled; });
    var usedTxn = {};
    var suggestions = [];
    bankLines.forEach(function (b) {
      var candidates = txns.filter(function (t) { return !usedTxn[t.id]; });
      var s = findSuggestion(b, candidates);
      if (s) { usedTxn[s.id] = true; suggestions.push({ bank: b, txn: s }); }
    });
    if (!suggestions.length) { Toast.show("Nenhuma correspondência automática encontrada", "info"); return; }
    openAutoMatchReviewModal(suggestions);
  }

  function openAutoMatchReviewModal(suggestions) {
    var rowsHtml = suggestions.map(function (s, idx) {
      var client = s.txn.clientId ? DB.get("clients", s.txn.clientId) : null;
      var diff = computeMatchDiff(s.bank, s.txn);
      return '<tr>' +
        '<td><label class="checkbox-wrap"><input type="checkbox" class="review-check" data-idx="' + idx + '" checked></label></td>' +
        '<td><div class="ri-desc">' + Utils.escapeHtml(s.bank.description) + '</div><div class="ri-meta">' + Utils.fmtDate(s.bank.date) + ' · ' + Utils.fmtMoney(s.bank.amount) + '</div></td>' +
        '<td><div class="ri-desc">' + Utils.escapeHtml(s.txn.description) + (client ? ' · ' + Utils.escapeHtml(client.name) : '') + '</div><div class="ri-meta">' + Utils.fmtDate(s.txn.date) + ' · ' + Utils.fmtMoney(s.txn.amount) + '</div></td>' +
        '<td>' + amountDiffBadge(diff) + '<br>' + dateDiffBadge(diff) + '</td>' +
        '</tr>';
    }).join("");

    var body =
      '<p class="small text-muted mb-16">O sistema encontrou <strong>' + suggestions.length + '</strong> possível(is) correspondência(s) entre o extrato e os lançamentos. Revise valor, data, cliente/descrição de cada par e desmarque as que não devem ser conciliadas.</p>' +
      '<div class="table-wrap"><table class="data-table compare-review-table"><thead><tr><th></th><th>Extrato do Banco</th><th>Lançamento do Sistema</th><th>Diferença</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="btn-confirm-bulk"><i class="fa-solid fa-check-double"></i> Confirmar Selecionadas</button>';
    var box = Modal.open({ title: "Revisar Sugestões Automáticas", bodyHtml: body, footHtml: foot, wide: true });

    box.querySelector("#btn-confirm-bulk").addEventListener("click", function () {
      var checked = Utils.qsa(".review-check", box).filter(function (c) { return c.checked; })
        .map(function (c) { return suggestions[parseInt(c.getAttribute("data-idx"), 10)]; });
      if (!checked.length) { Toast.show("Nenhuma conciliação selecionada", "info"); return; }
      DB.batch(function () {
        checked.forEach(function (s) {
          DB.update("bankLines", s.bank.id, { matched: true, matchedTransactionId: s.txn.id });
          DB.update("transactions", s.txn.id, { reconciled: true, bankLineId: s.bank.id });
        });
      });
      DB.log("Conciliação", "Revisou e confirmou " + checked.length + " conciliação(ões) automática(s) com o extrato bancário");
      Modal.close();
      Toast.show(checked.length + " conciliação(ões) confirmada(s)", "success");
      render();
    });
  }

  function matchPair(bankId, txnId, source) {
    DB.update("bankLines", bankId, { matched: true, matchedTransactionId: txnId });
    DB.update("transactions", txnId, { reconciled: true, bankLineId: bankId });
    var msg = source === "sugestao"
      ? "Conferiu os dados e confirmou uma sugestão automática de conciliação"
      : "Conciliou manualmente um lançamento com uma linha do extrato bancário";
    DB.log("Conciliação", msg);
    selectedBankId = null; selectedTxnId = null;
    Toast.show("Conciliado com sucesso", "success");
    render();
  }

  function unmatch(bankId) {
    var line = DB.get("bankLines", bankId);
    if (line && line.matchedTransactionId) DB.update("transactions", line.matchedTransactionId, { reconciled: false, bankLineId: null });
    DB.update("bankLines", bankId, { matched: false, matchedTransactionId: null });
    DB.log("Conciliação", "Desfez uma conciliação bancária");
    Toast.show("Conciliação desfeita", "info");
    render();
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // ---------------- Render ----------------
  function render() {
    var bankLines = DB.all("bankLines");
    var txns = DB.all("transactions");

    var unmatchedBank = bankLines.filter(function (b) { return !b.matched; })
      .filter(function (b) { return (!rfilter.start || b.date >= rfilter.start) && (!rfilter.end || b.date <= rfilter.end); })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });
    var unmatchedTxn = txns.filter(function (t) { return t.status === "pago" && !t.reconciled; })
      .filter(function (t) { return (!rfilter.start || t.date >= rfilter.start) && (!rfilter.end || t.date <= rfilter.end); })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });

    var matchedCount = bankLines.filter(function (b) { return b.matched; }).length;
    var totalBankLines = bankLines.length;
    var pct = totalBankLines ? (matchedCount / totalBankLines * 100) : 0;

    document.getElementById("recon-summary").innerHTML = [
      kpi("Linhas Importadas", String(totalBankLines), "fa-file-lines", "#2a78d6", "#e3eefb"),
      kpi("Conciliadas", matchedCount + " (" + pct.toFixed(0) + "%)", "fa-circle-check", "#1baf7a", "#e2f5ec"),
      kpi("Extrato sem correspondência", String(unmatchedBank.length), "fa-triangle-exclamation", "#b7791f", "#fdf2df"),
      kpi("Lançamentos sem conciliar", String(unmatchedTxn.length), "fa-file-invoice", "#c23b3b", "#fbe6e6")
    ].join("");

    document.getElementById("bank-col-sub").textContent = unmatchedBank.length + " linha(s) em aberto";
    document.getElementById("txn-col-sub").textContent = unmatchedTxn.length + " lançamento(s) pagos em aberto";

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
        var suggestion = findSuggestion(b, unmatchedTxn);
        return '<div class="recon-item' + (b.id === selectedBankId ? " selected" : "") + '" data-bank="' + b.id + '">' +
          '<div>' +
            '<div class="ri-desc">' + Utils.escapeHtml(b.description) + '</div>' +
            '<div class="ri-meta">' + Utils.fmtDate(b.date) + (suggestion ? ' · <span class="text-success"><i class="fa-solid fa-wand-magic-sparkles"></i> sugestão encontrada</span>' : '') + '</div>' +
          '</div>' +
          '<div class="flex items-center gap-6">' +
            '<span class="font-bold ' + (b.amount >= 0 ? "text-success" : "text-danger") + '">' + Utils.fmtMoney(b.amount) + '</span>' +
            (suggestion ? '<button class="btn btn-sm btn-outline" data-quick-match="' + b.id + '|' + suggestion.id + '" title="Comparar os dois registros antes de confirmar"><i class="fa-solid fa-magnifying-glass-chart"></i> Comparar e Confirmar</button>' :
              '<button class="btn btn-sm btn-ghost" data-create-from="' + b.id + '" title="Criar lançamento a partir desta linha"><i class="fa-solid fa-plus"></i></button>') +
          '</div></div>';
      }).join("") + bankCapNote;

      Utils.qsa("[data-bank]", bankEl).forEach(function (el) {
        el.addEventListener("click", function (e) {
          if (e.target.closest("[data-quick-match]") || e.target.closest("[data-create-from]")) return;
          selectedBankId = selectedBankId === el.getAttribute("data-bank") ? null : el.getAttribute("data-bank");
          tryMatchSelection();
          render();
        });
      });
      Utils.qsa("[data-quick-match]", bankEl).forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var parts = btn.getAttribute("data-quick-match").split("|");
          openSuggestionCompareModal(parts[0], parts[1]);
        });
      });
      Utils.qsa("[data-create-from]", bankEl).forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          createTxnFromBankLine(btn.getAttribute("data-create-from"));
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
        return '<div class="recon-item' + (t.id === selectedTxnId ? " selected" : "") + '" data-txn="' + t.id + '">' +
          '<div>' +
            '<div class="ri-desc">' + Utils.escapeHtml(t.description) + '</div>' +
            '<div class="ri-meta">' + Utils.fmtDate(t.date) + ' · ' + (cat ? Utils.escapeHtml(cat.name) : "") + '</div>' +
          '</div>' +
          '<span class="font-bold ' + (t.type === "receita" ? "text-success" : "text-danger") + '">' + (t.type === "receita" ? "+" : "-") + " " + Utils.fmtMoney(t.amount) + '</span>' +
          '</div>';
      }).join("") + txnCapNote;
      Utils.qsa("[data-txn]", txnEl).forEach(function (el) {
        el.addEventListener("click", function () {
          selectedTxnId = selectedTxnId === el.getAttribute("data-txn") ? null : el.getAttribute("data-txn");
          tryMatchSelection();
          render();
        });
      });
    }

    // history
    var historyPairs = bankLines.filter(function (b) { return b.matched; }).sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 40);
    var histTbl = document.getElementById("tbl-history");
    if (!historyPairs.length) {
      Utils.emptyTable(histTbl, "fa-clock", "Nenhuma conciliação realizada ainda");
    } else {
      histTbl.innerHTML = '<thead><tr><th>Data Extrato</th><th>Descrição Banco</th><th class="text-right">Valor</th><th>Lançamento do Sistema</th><th></th></tr></thead><tbody>' +
        historyPairs.map(function (b) {
          var t = txns.find(function (x) { return x.id === b.matchedTransactionId; });
          return '<tr><td class="text-num">' + Utils.fmtDate(b.date) + '</td><td>' + Utils.escapeHtml(b.description) + '</td>' +
            '<td class="text-right text-num">' + Utils.fmtMoney(b.amount) + '</td>' +
            '<td>' + (t ? Utils.escapeHtml(t.description) : '<span class="text-muted">registro removido</span>') + '</td>' +
            '<td><button class="btn btn-sm btn-ghost" data-unmatch="' + b.id + '">Desfazer</button></td></tr>';
        }).join("") + '</tbody>';
      Utils.qsa("[data-unmatch]", histTbl).forEach(function (btn) {
        btn.addEventListener("click", function () { unmatch(btn.getAttribute("data-unmatch")); });
      });
    }
  }

  function tryMatchSelection() {
    if (selectedBankId && selectedTxnId) matchPair(selectedBankId, selectedTxnId);
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }

  function createTxnFromBankLine(bankId) {
    var b = DB.get("bankLines", bankId);
    if (!b) return;
    var isReceita = b.amount >= 0;
    var categories = DB.all("categories").filter(function (c) { return c.type === (isReceita ? "receita" : "despesa"); });
    var costCenters = DB.all("costCenters");
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Descrição</label><input type="text" id="cf-desc" value="' + Utils.escapeHtml(b.description) + '"></div>' +
      '<div class="form-field"><label>Data</label><input type="date" id="cf-date" value="' + b.date + '"></div>' +
      '<div class="form-field"><label>Valor (R$)</label><input type="number" step="0.01" id="cf-amount" value="' + Math.abs(b.amount) + '"></div>' +
      '<div class="form-field"><label>Tipo</label><input type="text" value="' + (isReceita ? "Receita" : "Despesa") + '" disabled></div>' +
      '<div class="form-field"><label>Categoria</label><select id="cf-cat">' + categories.map(function (c) { return '<option value="' + c.id + '">' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-field"><label>Centro de Custo</label><select id="cf-cc">' + costCenters.map(function (c) { return '<option value="' + c.id + '">' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cf-save">Criar e Conciliar</button>';
    var box = Modal.open({ title: "Criar Lançamento a partir do Extrato", bodyHtml: body, footHtml: foot });
    box.querySelector("#cf-cat").addEventListener("change", function () {
      var c = categories.find(function (x) { return x.id === this.value; }.bind(this));
    });
    box.querySelector("#cf-save").addEventListener("click", function () {
      var cat = categories.find(function (c) { return c.id === box.querySelector("#cf-cat").value; });
      var txn = DB.insert("transactions", {
        type: isReceita ? "receita" : "despesa",
        description: box.querySelector("#cf-desc").value.trim() || b.description,
        amount: Math.abs(parseFloat(box.querySelector("#cf-amount").value) || 0),
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
})();
