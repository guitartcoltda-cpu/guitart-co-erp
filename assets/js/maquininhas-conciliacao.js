/* ============================================================
   Salão ERP — Conciliação de Maquininhas
   Importa dois arquivos separados todos os dias — o slip de
   lançamentos da maquininha (o que a operadora diz que processou) e
   o extrato da conta bancária (o que efetivamente caiu na conta) — e
   concilia um contra o outro, lançamento por lançamento. É o mesmo
   espírito da Conciliação Bancária (assets/js/conciliacao.js:
   sugestão automática + revisão obrigatória antes de confirmar,
   nunca grava sozinho), só que aqui os dois lados são extratos
   importados, não um extrato x um lançamento do sistema.

   Reaproveita a tabela `bankLines` (já existente no schema, sem
   precisar de nenhuma tabela nova no Supabase) marcando cada linha
   com context:"maquininha" e side:"slip"|"bank", para nunca se
   misturar com as linhas da Conciliação Bancária normal (que não têm
   esses campos).
   ============================================================ */
(function (global) {
  "use strict";

  var CTX = "maquininha";
  var selectedSlipId = null, selectedBankId = null;
  var mfilter = { start: "", end: "", machineId: "" };

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    var today = Utils.todayISO();
    mfilter.start = Utils.addDays(today, -15);
    mfilter.end = today;
    var startEl = Utils.qs("#mqr-start"), endEl = Utils.qs("#mqr-end"), machEl = Utils.qs("#mqr-machine");
    if (!startEl) return; // esta tela só existe na aba "Conciliação" de Maquininhas
    startEl.value = mfilter.start;
    endEl.value = mfilter.end;
    startEl.addEventListener("change", function (e) { mfilter.start = e.target.value; render(); });
    endEl.addEventListener("change", function (e) { mfilter.end = e.target.value; render(); });
    machEl.addEventListener("change", function (e) { mfilter.machineId = e.target.value; render(); });
    Utils.qs("#btn-clear-mqr-filters").addEventListener("click", function () {
      mfilter = { start: "", end: "", machineId: "" };
      startEl.value = ""; endEl.value = ""; machEl.value = "";
      render();
    });

    Utils.qs("#btn-mqr-auto-match").addEventListener("click", autoMatchAll);

    wireUploadZone("upload-zone-slip", "file-input-slip", "slip");
    wireUploadZone("upload-zone-bank", "file-input-bank", "bank");

    render();
  }

  function wireUploadZone(zoneId, inputId, side) {
    var zone = Utils.qs("#" + zoneId), fileInput = Utils.qs("#" + inputId);
    if (!zone) return;
    zone.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function (e) { if (e.target.files[0]) handleFile(e.target.files[0], side); fileInput.value = ""; });
    ["dragover", "dragenter"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("dragover"); }); });
    ["dragleave", "drop"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("dragover"); }); });
    zone.addEventListener("drop", function (e) { if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], side); });
  }

  // ---------------- Import ----------------
  function handleFile(file, side) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var parsed = Utils.parseCSV(e.target.result);
        if (!parsed.rows.length) { Toast.show("Arquivo vazio ou inválido", "danger"); return; }
        openImportPreview(parsed, side);
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

  function openImportPreview(parsed, side) {
    var headers = parsed.headers;
    var hasHeader = guessColumn(headers, ["data", "date", "desc", "hist", "valor", "value", "amount"]) > -1;
    var rows = hasHeader ? parsed.rows : [headers].concat(parsed.rows);
    var colCount = rows[0].length;
    var cols = [];
    for (var c = 0; c < colCount; c++) cols.push("Coluna " + (c + 1));

    var guessDate = hasHeader ? guessColumn(headers, ["data", "date"]) : 0;
    var guessDesc = hasHeader ? guessColumn(headers, ["desc", "hist", "lancamento", "lançamento"]) : 1;
    var guessValue = hasHeader ? guessColumn(headers, ["valor", "value", "amount", "liquido", "líquido"]) : 2;
    if (guessDate === -1) guessDate = 0;
    if (guessDesc === -1) guessDesc = 1;
    if (guessValue === -1) guessValue = colCount - 1;

    function colOptions(selected) {
      return cols.map(function (c, i) { return '<option value="' + i + '"' + (i === selected ? " selected" : "") + '>' + c + (hasHeader && headers[i] ? " (" + headers[i] + ")" : "") + '</option>'; }).join("");
    }

    var machines = DB.all("cardMachines").sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    var machineFieldHtml = side === "slip"
      ? '<div class="form-field"><label>Maquininha</label><select id="map-machine"><option value="">-</option>' +
          machines.map(function (m) { return '<option value="' + m.id + '">' + Utils.escapeHtml(m.name) + '</option>'; }).join("") + '</select></div>'
      : "";

    var previewRows = rows.slice(0, 5);
    var title = side === "slip" ? "Pré-visualizar Slip da Maquininha" : "Pré-visualizar Extrato Bancário";
    var body =
      '<p class="small text-muted mb-16">Confirme qual coluna corresponde a cada campo. Detectamos ' + rows.length + ' linha(s).</p>' +
      '<div class="form-grid cols-3 mb-16">' +
        '<div class="form-field"><label>Coluna de Data</label><select id="map-date">' + colOptions(guessDate) + '</select></div>' +
        '<div class="form-field"><label>Coluna de Descrição</label><select id="map-desc">' + colOptions(guessDesc) + '</select></div>' +
        '<div class="form-field"><label>Coluna de Valor</label><select id="map-value">' + colOptions(guessValue) + '</select></div>' +
        machineFieldHtml +
      '</div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr>' + cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") + '</tr></thead><tbody>' +
      previewRows.map(function (r) { return "<tr>" + r.map(function (v) { return "<td>" + Utils.escapeHtml(v) + "</td>"; }).join("") + "</tr>"; }).join("") +
      '</tbody></table></div>';

    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="btn-confirm-mqr-import">Importar ' + rows.length + ' linha(s)</button>';
    var box = Modal.open({ title: title, bodyHtml: body, footHtml: foot, wide: true });

    box.querySelector("#btn-confirm-mqr-import").addEventListener("click", function () {
      var dIdx = parseInt(box.querySelector("#map-date").value, 10);
      var descIdx = parseInt(box.querySelector("#map-desc").value, 10);
      var vIdx = parseInt(box.querySelector("#map-value").value, 10);
      var machineEl = box.querySelector("#map-machine");
      var machineId = machineEl ? machineEl.value : null;
      var inserted = 0;
      var newLines = rows.map(function (r) {
        var rawDate = r[dIdx], desc = r[descIdx], amount = Utils.parseMoneyStr(r[vIdx]);
        var iso = normalizeDate(rawDate);
        if (!iso || !desc) return null;
        inserted++;
        return {
          context: CTX, side: side, date: iso, description: desc.slice(0, 140), amount: Math.abs(amount),
          machineId: side === "slip" ? (machineId || null) : null,
          matched: false, matchedLineId: null, importedAt: DB.nowISO(), source: "import"
        };
      }).filter(Boolean);
      DB.insertMany("bankLines", newLines);
      Modal.close();
      Toast.show(inserted + " linha(s) importada(s) do " + (side === "slip" ? "slip da maquininha" : "extrato bancário"), "success");
      DB.log("Maquininhas", "Importou " + inserted + " linha(s) do " + (side === "slip" ? "slip da maquininha" : "extrato bancário") + " para conciliação");
      render();
    });
  }

  // ---------------- Matching ----------------
  function findSuggestion(line, candidates) {
    var matches = candidates.filter(function (c) { return Math.abs(c.amount - line.amount) < 0.01; });
    if (!matches.length) return null;
    matches.sort(function (a, b) { return Math.abs(Utils.daysBetween(a.date, line.date)) - Math.abs(Utils.daysBetween(b.date, line.date)); });
    var best = matches[0];
    if (Math.abs(Utils.daysBetween(best.date, line.date)) <= 6) return best;
    return null;
  }

  function computeMatchDiff(slip, bank) {
    var amountDiff = round2(bank.amount - slip.amount);
    var dayDiff = Utils.daysBetween(slip.date, bank.date);
    return { amountDiff: amountDiff, amountOk: Math.abs(amountDiff) < 0.01, dayDiff: dayDiff, dateOk: dayDiff === 0 };
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

  function buildComparisonTableHtml(slip, bank) {
    var machine = slip.machineId ? DB.get("cardMachines", slip.machineId) : null;
    var diff = computeMatchDiff(slip, bank);
    function row(label, a, b) { return '<tr><td class="compare-label">' + label + '</td><td>' + a + '</td><td>' + b + '</td></tr>'; }
    function diffRow(label, badgeHtml) { return '<tr class="compare-diff-row"><td class="compare-label">' + label + '</td><td colspan="2">' + badgeHtml + '</td></tr>'; }
    var html = '<table class="compare-table"><thead><tr><th>Campo</th><th>Slip da Maquininha</th><th>Extrato Bancário</th></tr></thead><tbody>';
    html += row("Valor", '<span class="font-bold text-success">' + Utils.fmtMoney(slip.amount) + '</span>', '<span class="font-bold text-success">' + Utils.fmtMoney(bank.amount) + '</span>');
    html += diffRow("Diferença de valor", amountDiffBadge(diff));
    html += row("Data", Utils.fmtDate(slip.date), Utils.fmtDate(bank.date));
    html += diffRow("Diferença de data", dateDiffBadge(diff));
    html += row("Descrição", Utils.escapeHtml(slip.description), Utils.escapeHtml(bank.description));
    html += row("Maquininha", machine ? Utils.escapeHtml(machine.name) : '<span class="text-muted">—</span>', '<span class="text-muted">—</span>');
    html += '</tbody></table>';
    return html;
  }

  function openSuggestionCompareModal(slipId, bankId) {
    var s = DB.get("bankLines", slipId), b = DB.get("bankLines", bankId);
    if (!s || !b) { Toast.show("Registro não encontrado ou já conciliado", "danger"); render(); return; }
    var body =
      '<p class="small text-muted mb-16"><i class="fa-solid fa-wand-magic-sparkles"></i> Esta é a sugestão automática encontrada pelo sistema entre o slip da maquininha e o extrato bancário. Confira os dados antes de confirmar.</p>' +
      buildComparisonTableHtml(s, b);
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="btn-confirm-mqr-suggestion"><i class="fa-solid fa-check"></i> Confirmar Conciliação</button>';
    var box = Modal.open({ title: "Comparar e Confirmar Conciliação", bodyHtml: body, footHtml: foot, wide: true });
    box.querySelector("#btn-confirm-mqr-suggestion").addEventListener("click", function () {
      Modal.close();
      matchPair(slipId, bankId, "sugestao");
    });
  }

  function autoMatchAll() {
    var slipLines = allLines("slip").filter(function (l) { return !l.matched; });
    var bankLines = allLines("bank").filter(function (l) { return !l.matched; });
    var usedBank = {};
    var suggestions = [];
    slipLines.forEach(function (s) {
      var candidates = bankLines.filter(function (b) { return !usedBank[b.id]; });
      var m = findSuggestion(s, candidates);
      if (m) { usedBank[m.id] = true; suggestions.push({ slip: s, bank: m }); }
    });
    if (!suggestions.length) { Toast.show("Nenhuma correspondência automática encontrada", "info"); return; }
    openAutoMatchReviewModal(suggestions);
  }

  function openAutoMatchReviewModal(suggestions) {
    var rowsHtml = suggestions.map(function (s, idx) {
      var diff = computeMatchDiff(s.slip, s.bank);
      return '<tr>' +
        '<td><label class="checkbox-wrap"><input type="checkbox" class="mqr-review-check" data-idx="' + idx + '" checked></label></td>' +
        '<td><div class="ri-desc">' + Utils.escapeHtml(s.slip.description) + '</div><div class="ri-meta">' + Utils.fmtDate(s.slip.date) + ' · ' + Utils.fmtMoney(s.slip.amount) + '</div></td>' +
        '<td><div class="ri-desc">' + Utils.escapeHtml(s.bank.description) + '</div><div class="ri-meta">' + Utils.fmtDate(s.bank.date) + ' · ' + Utils.fmtMoney(s.bank.amount) + '</div></td>' +
        '<td>' + amountDiffBadge(diff) + '<br>' + dateDiffBadge(diff) + '</td>' +
        '</tr>';
    }).join("");
    var body =
      '<p class="small text-muted mb-16">O sistema encontrou <strong>' + suggestions.length + '</strong> possível(is) correspondência(s) entre o slip da maquininha e o extrato bancário. Revise valor, data e descrição de cada par e desmarque as que não devem ser conciliadas.</p>' +
      '<div class="table-wrap"><table class="data-table compare-review-table"><thead><tr><th></th><th>Slip da Maquininha</th><th>Extrato Bancário</th><th>Diferença</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="btn-confirm-mqr-bulk"><i class="fa-solid fa-check-double"></i> Confirmar Selecionadas</button>';
    var box = Modal.open({ title: "Revisar Sugestões Automáticas", bodyHtml: body, footHtml: foot, wide: true });
    box.querySelector("#btn-confirm-mqr-bulk").addEventListener("click", function () {
      var checked = Utils.qsa(".mqr-review-check", box).filter(function (c) { return c.checked; })
        .map(function (c) { return suggestions[parseInt(c.getAttribute("data-idx"), 10)]; });
      if (!checked.length) { Toast.show("Nenhuma conciliação selecionada", "info"); return; }
      DB.batch(function () {
        checked.forEach(function (s) {
          DB.update("bankLines", s.slip.id, { matched: true, matchedLineId: s.bank.id });
          DB.update("bankLines", s.bank.id, { matched: true, matchedLineId: s.slip.id });
        });
      });
      DB.log("Maquininhas", "Revisou e confirmou " + checked.length + " conciliação(ões) automática(s) entre slip da maquininha e extrato bancário");
      Modal.close();
      Toast.show(checked.length + " conciliação(ões) confirmada(s)", "success");
      render();
    });
  }

  function matchPair(slipId, bankId, source) {
    DB.update("bankLines", slipId, { matched: true, matchedLineId: bankId });
    DB.update("bankLines", bankId, { matched: true, matchedLineId: slipId });
    var msg = source === "sugestao"
      ? "Conferiu os dados e confirmou uma sugestão automática de conciliação de maquininha"
      : "Conciliou manualmente uma linha do slip da maquininha com o extrato bancário";
    DB.log("Maquininhas", msg);
    selectedSlipId = null; selectedBankId = null;
    Toast.show("Conciliado com sucesso", "success");
    render();
  }

  function unmatch(lineId) {
    var line = DB.get("bankLines", lineId);
    if (!line) return;
    if (line.matchedLineId) DB.update("bankLines", line.matchedLineId, { matched: false, matchedLineId: null });
    DB.update("bankLines", lineId, { matched: false, matchedLineId: null });
    DB.log("Maquininhas", "Desfez uma conciliação de maquininha");
    Toast.show("Conciliação desfeita", "info");
    render();
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function allLines(side) {
    return DB.all("bankLines").filter(function (l) { return l.context === CTX && l.side === side; });
  }

  function tryMatchSelection() {
    if (selectedSlipId && selectedBankId) matchPair(selectedSlipId, selectedBankId);
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }

  // ---------------- Render ----------------
  function render() {
    var machSel = Utils.qs("#mqr-machine");
    if (!machSel) return; // aba de conciliação não está aberta/montada
    var machines = DB.all("cardMachines").sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    if (!machSel.options.length || machSel.options.length - 1 !== machines.length) {
      var current = mfilter.machineId;
      machSel.innerHTML = '<option value="">Todas</option>' + machines.map(function (m) { return '<option value="' + m.id + '">' + Utils.escapeHtml(m.name) + '</option>'; }).join("");
      machSel.value = current;
    }

    var allSlip = allLines("slip"), allBank = allLines("bank");

    function passesFilter(l) {
      if (mfilter.start && l.date < mfilter.start) return false;
      if (mfilter.end && l.date > mfilter.end) return false;
      if (mfilter.machineId && l.machineId !== mfilter.machineId) return false;
      return true;
    }

    var unmatchedSlip = allSlip.filter(function (l) { return !l.matched; }).filter(passesFilter).sort(function (a, b) { return b.date.localeCompare(a.date); });
    var unmatchedBank = allBank.filter(function (l) { return !l.matched; }).filter(passesFilter).sort(function (a, b) { return b.date.localeCompare(a.date); });

    var matchedCount = allSlip.filter(function (l) { return l.matched; }).length;
    var pct = allSlip.length ? (matchedCount / allSlip.length * 100) : 0;

    document.getElementById("mqr-summary").innerHTML = [
      kpi("Linhas do Slip Importadas", String(allSlip.length), "fa-receipt", "#2a78d6", "#e3eefb"),
      kpi("Linhas do Extrato Importadas", String(allBank.length), "fa-building-columns", "#4a3aa7", "#ece8f8"),
      kpi("Conciliadas", matchedCount + " (" + pct.toFixed(0) + "%)", "fa-circle-check", "#1baf7a", "#e2f5ec"),
      kpi("Pendentes de Conciliação", String(unmatchedSlip.length + unmatchedBank.length), "fa-triangle-exclamation", "#b7791f", "#fdf2df")
    ].join("");

    document.getElementById("mqr-slip-col-sub").textContent = unmatchedSlip.length + " linha(s) em aberto";
    document.getElementById("mqr-bank-col-sub").textContent = unmatchedBank.length + " linha(s) em aberto";

    var RENDER_CAP = 60;
    var slipToRender = unmatchedSlip.slice(0, RENDER_CAP);
    var bankToRender = unmatchedBank.slice(0, RENDER_CAP);
    var slipCapNote = unmatchedSlip.length > RENDER_CAP ? '<div class="small text-muted mt-8">Mostrando as ' + RENDER_CAP + ' mais recentes de ' + unmatchedSlip.length + '. Reduza o período no filtro para ver as demais.</div>' : "";
    var bankCapNote = unmatchedBank.length > RENDER_CAP ? '<div class="small text-muted mt-8">Mostrando as ' + RENDER_CAP + ' mais recentes de ' + unmatchedBank.length + '. Reduza o período no filtro para ver as demais.</div>' : "";

    var slipEl = document.getElementById("mqr-slip-list");
    if (!unmatchedSlip.length) {
      slipEl.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-circle-check"></i></div><h4>Nada pendente no slip</h4><p>Importe o slip diário da maquininha para continuar conciliando.</p></div>';
    } else {
      slipEl.innerHTML = slipToRender.map(function (s) {
        var suggestion = findSuggestion(s, unmatchedBank);
        var machine = s.machineId ? DB.get("cardMachines", s.machineId) : null;
        return '<div class="recon-item' + (s.id === selectedSlipId ? " selected" : "") + '" data-slip="' + s.id + '">' +
          '<div>' +
            '<div class="ri-desc">' + Utils.escapeHtml(s.description) + '</div>' +
            '<div class="ri-meta">' + Utils.fmtDate(s.date) + (machine ? ' · ' + Utils.escapeHtml(machine.name) : '') + (suggestion ? ' · <span class="text-success"><i class="fa-solid fa-wand-magic-sparkles"></i> sugestão encontrada</span>' : '') + '</div>' +
          '</div>' +
          '<div class="flex items-center gap-6">' +
            '<span class="font-bold text-success">' + Utils.fmtMoney(s.amount) + '</span>' +
            (suggestion ? '<button class="btn btn-sm btn-outline" data-quick-match="' + s.id + '|' + suggestion.id + '" title="Comparar os dois registros antes de confirmar"><i class="fa-solid fa-magnifying-glass-chart"></i> Comparar e Confirmar</button>' : "") +
          '</div></div>';
      }).join("") + slipCapNote;

      Utils.qsa("[data-slip]", slipEl).forEach(function (el) {
        el.addEventListener("click", function (e) {
          if (e.target.closest("[data-quick-match]")) return;
          selectedSlipId = selectedSlipId === el.getAttribute("data-slip") ? null : el.getAttribute("data-slip");
          tryMatchSelection();
          render();
        });
      });
      Utils.qsa("[data-quick-match]", slipEl).forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var parts = btn.getAttribute("data-quick-match").split("|");
          openSuggestionCompareModal(parts[0], parts[1]);
        });
      });
    }

    var bankEl = document.getElementById("mqr-bank-list");
    if (!unmatchedBank.length) {
      bankEl.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-circle-check"></i></div><h4>Nada pendente no extrato</h4><p>Importe o extrato bancário para continuar conciliando.</p></div>';
    } else {
      bankEl.innerHTML = bankToRender.map(function (b) {
        return '<div class="recon-item' + (b.id === selectedBankId ? " selected" : "") + '" data-bank="' + b.id + '">' +
          '<div>' +
            '<div class="ri-desc">' + Utils.escapeHtml(b.description) + '</div>' +
            '<div class="ri-meta">' + Utils.fmtDate(b.date) + '</div>' +
          '</div>' +
          '<span class="font-bold text-success">' + Utils.fmtMoney(b.amount) + '</span>' +
          '</div>';
      }).join("") + bankCapNote;
      Utils.qsa("[data-bank]", bankEl).forEach(function (el) {
        el.addEventListener("click", function () {
          selectedBankId = selectedBankId === el.getAttribute("data-bank") ? null : el.getAttribute("data-bank");
          tryMatchSelection();
          render();
        });
      });
    }

    var historyPairs = allSlip.filter(function (l) { return l.matched; }).sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 40);
    var histTbl = document.getElementById("tbl-mqr-history");
    if (!historyPairs.length) {
      Utils.emptyTable(histTbl, "fa-clock", "Nenhuma conciliação realizada ainda");
    } else {
      histTbl.innerHTML = '<thead><tr><th>Data Slip</th><th>Descrição Slip</th><th class="text-right">Valor</th><th>Extrato Bancário</th><th></th></tr></thead><tbody>' +
        historyPairs.map(function (s) {
          var b = s.matchedLineId ? DB.get("bankLines", s.matchedLineId) : null;
          return '<tr><td class="text-num">' + Utils.fmtDate(s.date) + '</td><td>' + Utils.escapeHtml(s.description) + '</td>' +
            '<td class="text-right text-num">' + Utils.fmtMoney(s.amount) + '</td>' +
            '<td>' + (b ? Utils.escapeHtml(b.description) + ' · ' + Utils.fmtDate(b.date) : '<span class="text-muted">registro removido</span>') + '</td>' +
            '<td><button class="btn btn-sm btn-ghost" data-mqr-unmatch="' + s.id + '">Desfazer</button></td></tr>';
        }).join("") + '</tbody>';
      Utils.qsa("[data-mqr-unmatch]", histTbl).forEach(function (btn) {
        btn.addEventListener("click", function () { unmatch(btn.getAttribute("data-mqr-unmatch")); });
      });
    }
  }

  global.MaquininhasConciliacao = { render: render };
})(window);
