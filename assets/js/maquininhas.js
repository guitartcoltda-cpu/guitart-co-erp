/* ============================================================
   Salão ERP — Maquininhas
   Cadastro de maquininhas de cartão (operadora, taxas de crédito/
   débito/Pix, antecipação, outras taxas) e estimativa de quanto é
   descontado nas vendas recebidas por cartão/Pix.

   IMPORTANTE: nem todo lançamento de receita (transactions) registra qual
   maquininha foi usada na venda — só quando `cardMachineId` foi gravado
   (ver "20/09/2026, continuação" abaixo). Para os demais (a maioria, e
   todo lançamento anterior a essa mudança), os valores de taxa aqui
   continuam sendo uma ESTIMATIVA: aplicamos a taxa da maquininha
   selecionada (ou a média das ativas) sobre a receita recebida por Cartão
   de Crédito / Cartão de Débito / Pix no período — não é o extrato exato
   da operadora.

   20/09/2026: em Cartão de Crédito, quando o lançamento tem o número de
   parcelas (ver agenda.js/financeiro.js) e a maquininha tem aquela parcela
   cadastrada na Tabela de Parcelamento, a estimativa usa a taxa daquela
   parcela em vez da taxa "à vista" — ver creditRateForInstallments abaixo.

   20/09/2026, continuação: Concluir Atendimento/Fechar Conta (agenda.js)
   ganharam um seletor opcional "Maquininha" — quando usado, o lançamento
   grava `cardMachineId`, e este arquivo passa a usar a taxa EXATA daquela
   maquininha para aquela venda específica (em vez de estimar pela média),
   sempre que nenhuma simulação manual "e se toda a receita passasse por
   esta maquininha" estiver ativa no seletor abaixo — ver rateForTxn.
   ============================================================ */
(function () {
  "use strict";

  var PAY_METHODS = [
    { key: "Cartão de Crédito", field: "feeCreditPercent", label: "Crédito" },
    { key: "Cartão de Débito", field: "feeDebitPercent", label: "Débito" },
    { key: "Pix", field: "feePixPercent", label: "Pix" }
  ];

  var pfCtrl = null;
  var state = { simMachineId: "" };
  var mqSortState = { field: null, dir: "asc" }; // clique no cabeçalho da coluna para ordenar

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    pfCtrl = PeriodFilter.mount(document.getElementById("mq-period-filter"), {
      defaultPreset: "6m",
      label: "Período",
      onChange: function () { render(); }
    });

    Utils.qs("#btn-new-mq").addEventListener("click", function () { openMqModal(null); });
    Utils.qs("#mq-sim").addEventListener("change", function (e) { state.simMachineId = e.target.value; render(); });

    render();
  }

  function getMachines() {
    return DB.all("cardMachines").sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
  }

  function getActiveMachines() {
    return getMachines().filter(function (m) { return m.active !== false; });
  }

  // Returns the effective fee rate (%) per payment-method key, based on the
  // current simulation selection: a specific registered machine, or the
  // average of all active machines when none/"" is selected.
  function effectiveRates() {
    var active = getActiveMachines();
    var rates = {};
    PAY_METHODS.forEach(function (p) { rates[p.key] = 0; });

    var machine = state.simMachineId ? DB.get("cardMachines", state.simMachineId) : null;
    if (machine) {
      PAY_METHODS.forEach(function (p) {
        rates[p.key] = (machine[p.field] || 0) + (machine.otherTaxesPercent || 0);
      });
      return rates;
    }

    if (!active.length) return rates;
    PAY_METHODS.forEach(function (p) {
      var total = active.reduce(function (s, m) { return s + (m[p.field] || 0) + (m.otherTaxesPercent || 0); }, 0);
      rates[p.key] = total / active.length;
    });
    return rates;
  }

  // Taxa efetiva (%) do Cartão de Crédito para um número de parcelas
  // específico — 20/09/2026, a pedido do usuário: até aqui o fechamento
  // (render() abaixo) sempre usava a taxa "à vista" (feeCreditPercent) para
  // TODA receita em Cartão de Crédito, mesmo quando a maquininha já tinha a
  // Tabela de Parcelamento cadastrada (installmentFeesCredit, 2x–18x) —
  // subestimando a taxa de vendas parceladas. Agora, quando o lançamento
  // guarda `installments` (ver agenda.js/financeiro.js) e a maquininha tem
  // aquela parcela cadastrada na tabela, usa a taxa exata daquela parcela;
  // senão cai para feeCreditPercent, exatamente como antes (nenhuma mudança
  // para vendas à vista ou para lançamentos antigos sem `installments`).
  function machineCreditRate(m, n) {
    var table = m.installmentFeesCredit || {};
    var v = (n && n > 1) ? table[String(n)] : undefined;
    var base = (v !== undefined && v !== null && v !== "") ? v : (m.feeCreditPercent || 0);
    return base + (m.otherTaxesPercent || 0);
  }
  function creditRateForInstallments(n) {
    var active = getActiveMachines();
    var machine = state.simMachineId ? DB.get("cardMachines", state.simMachineId) : null;
    if (machine) return machineCreditRate(machine, n);
    if (!active.length) return 0;
    var total = active.reduce(function (s, m) { return s + machineCreditRate(m, n); }, 0);
    return total / active.length;
  }

  // Taxa efetiva (%) de UM lançamento específico — 20/09/2026, continuação
  // (fecha a lacuna documentada no cabeçalho deste arquivo): a partir de
  // agora, Concluir Atendimento/Fechar Conta (ver agenda.js) podem gravar
  // qual maquininha foi de fato usada em `t.cardMachineId`. Quando isso
  // existe e NÃO há uma simulação manual "e se toda a receita passasse por
  // esta maquininha" ativa (state.simMachineId), a taxa exata daquela
  // maquininha é usada em vez da média — mais preciso que estimar. A
  // simulação manual continua tendo prioridade quando selecionada (mesmo
  // "what-if" de sempre, ignorando de propósito qual maquininha cada venda
  // realmente usou). Lançamentos sem `cardMachineId` (a maioria, até essa
  // funcionalidade passar a ser usada no dia a dia, e todo lançamento
  // anterior a ela) continuam caindo na média, sem nenhuma mudança de
  // comportamento para eles.
  function rateForTxn(t, rates) {
    var machine = (!state.simMachineId && t.cardMachineId) ? DB.get("cardMachines", t.cardMachineId) : null;
    if (t.paymentMethod === "Cartão de Crédito") {
      return machine ? machineCreditRate(machine, t.installments) : creditRateForInstallments(t.installments);
    }
    if (machine) {
      var field = t.paymentMethod === "Cartão de Débito" ? "feeDebitPercent" : (t.paymentMethod === "Pix" ? "feePixPercent" : null);
      if (field) return (machine[field] || 0) + (machine.otherTaxesPercent || 0);
    }
    return rates[t.paymentMethod] || 0;
  }

  function populateSimSelect() {
    var sel = Utils.qs("#mq-sim");
    var current = state.simMachineId;
    var active = getActiveMachines();
    sel.innerHTML = '<option value="">Média das maquininhas ativas</option>' +
      active.map(function (m) { return '<option value="' + m.id + '">' + Utils.escapeHtml(m.name) + '</option>'; }).join("");
    if (current && active.some(function (m) { return m.id === current; })) {
      sel.value = current;
    } else {
      state.simMachineId = "";
      sel.value = "";
    }
  }

  function render() {
    populateSimSelect();

    var range = pfCtrl.getRange();
    var txns = DB.all("transactions").filter(function (t) { return t.type === "receita"; });
    txns = PeriodFilter.filterByDate(txns, "date", range);

    var rates = effectiveRates();
    var machines = getMachines();

    var byMethod = {};
    PAY_METHODS.forEach(function (p) { byMethod[p.key] = { revenue: 0, fee: 0 }; });
    txns.forEach(function (t) {
      var m = byMethod[t.paymentMethod];
      if (!m) return;
      m.revenue += t.amount;
      // Taxa desta venda: exata da maquininha gravada em `t.cardMachineId`
      // quando conhecida (e nenhuma simulação manual ativa — ver
      // rateForTxn acima); crédito parcelado sem maquininha conhecida usa a
      // taxa daquela parcela específica (Tabela de Parcelamento), quando
      // cadastrada; senão cai na média das ativas, como sempre.
      var rate = rateForTxn(t, rates);
      m.fee += t.amount * rate / 100;
    });

    var cardRevenue = PAY_METHODS.reduce(function (s, p) { return s + byMethod[p.key].revenue; }, 0);
    var estimatedFee = PAY_METHODS.reduce(function (s, p) { return s + byMethod[p.key].fee; }, 0);
    var feePct = cardRevenue > 0 ? (estimatedFee / cardRevenue) * 100 : 0;

    var maiorTaxa = 0;
    machines.forEach(function (m) {
      [m.feeCreditPercent, m.feeDebitPercent, m.feePixPercent].forEach(function (v) {
        if ((v || 0) > maiorTaxa) maiorTaxa = v || 0;
      });
    });

    document.getElementById("mq-summary").innerHTML = [
      kpi("Receita via Cartão/Pix", Utils.fmtMoney(cardRevenue), txns.filter(function (t) { return byMethod[t.paymentMethod]; }).length + " venda(s) no período", "fa-credit-card", "#0eb8d9", "#dbf7fc"),
      kpi("Taxa Estimada Paga", Utils.fmtMoney(estimatedFee), "Estimativa — ver nota acima", "fa-hand-holding-dollar", "#c23b3b", "#fbe6e6"),
      kpi("Taxa Média Efetiva", feePct.toFixed(2) + "%", "sobre a receita via cartão/Pix", "fa-percent", "#6d5efc", "#ece9ff"),
      kpi("Maior Taxa Cadastrada", maiorTaxa.toFixed(2) + "%", machines.length + " maquininha(s) cadastrada(s)", "fa-arrow-trend-up", "#4a3aa7", "#ece8f8")
    ].join("");

    Charts.bar({
      container: document.getElementById("chart-mq-pay"),
      categories: PAY_METHODS.map(function (p) { return p.label; }),
      series: [
        { name: "Receita", color: Charts.palette[0], data: PAY_METHODS.map(function (p) { return round2(byMethod[p.key].revenue); }) },
        { name: "Taxa estimada", color: Charts.palette[7], data: PAY_METHODS.map(function (p) { return round2(byMethod[p.key].fee); }) }
      ],
      height: 260,
      valueFormatter: function (v) { return Utils.fmtMoney(v); },
      emptyMessage: "Sem vendas por cartão/Pix no período"
    });

    renderTable(machines);
  }

  function renderTable(machines) {
    document.getElementById("mq-count-sub").textContent = machines.length + " maquininha(s) cadastrada(s)";
    var tbl = document.getElementById("tbl-mq");
    if (!machines.length) {
      Utils.emptyTable(tbl, "fa-credit-card", "Nenhuma maquininha cadastrada", "Cadastre a primeira maquininha e suas taxas de crédito, débito e Pix.");
      return;
    }
    var mqGetters = {
      active: function (m) { return m.active !== false; }
    };
    var rows = Utils.sortBy(machines, mqSortState, mqGetters);
    tbl.innerHTML = '<thead><tr>' +
      Utils.thSort("Maquininha", "name", mqSortState) +
      Utils.thSort("Operadora", "operator", mqSortState) +
      Utils.thSort("Crédito à Vista", "feeCreditPercent", mqSortState, { className: "text-right" }) +
      Utils.thSort("Débito", "feeDebitPercent", mqSortState, { className: "text-right" }) +
      Utils.thSort("Pix", "feePixPercent", mqSortState, { className: "text-right" }) +
      Utils.thSort("Antecipação", "anticipationFeePercent", mqSortState, { className: "text-right" }) +
      Utils.thSort("Status", "active", mqSortState) +
      '<th></th></tr></thead><tbody>' +
      rows.map(function (m) {
        return '<tr>' +
          '<td><span class="font-bold">' + Utils.escapeHtml(m.name) + '</span>' + (m.cnpj ? '<div class="small text-muted">' + Utils.escapeHtml(m.cnpj) + '</div>' : '') + '</td>' +
          '<td class="small text-muted">' + Utils.escapeHtml(m.operator || "-") + '</td>' +
          '<td class="text-right text-num">' + fmtPct(m.feeCreditPercent) + '</td>' +
          '<td class="text-right text-num">' + fmtPct(m.feeDebitPercent) + '</td>' +
          '<td class="text-right text-num">' + fmtPct(m.feePixPercent) + '</td>' +
          '<td class="text-right text-num">' + (m.anticipationFeePercent ? fmtPct(m.anticipationFeePercent) : '<span class="text-muted">-</span>') + '</td>' +
          '<td>' + (m.active !== false ? '<span class="badge badge-success">Ativa</span>' : '<span class="badge badge-gray">Inativa</span>') + '</td>' +
          '<td><div class="flex gap-6">' +
            '<button class="btn btn-icon btn-ghost" data-parcelas="' + m.id + '" title="Ver tabela de parcelamento"><i class="fa-solid fa-table-list"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-edit="' + m.id + '" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-del="' + m.id + '" title="Excluir"><i class="fa-solid fa-trash"></i></button>' +
          '</div></td></tr>';
      }).join("") + '</tbody>';

    Utils.wireSortHeaders(tbl, mqSortState, function () { renderTable(machines); });
    Utils.qsa("[data-edit]", tbl).forEach(function (b) { b.addEventListener("click", function () { openMqModal(b.getAttribute("data-edit")); }); });
    Utils.qsa("[data-parcelas]", tbl).forEach(function (b) { b.addEventListener("click", function () { openParcelasModal(b.getAttribute("data-parcelas")); }); });
    Utils.qsa("[data-del]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del");
        Modal.confirm({
          title: "Excluir maquininha",
          message: "Tem certeza que deseja excluir esta maquininha? Isso não afeta vendas já registradas.",
          danger: true,
          onConfirm: function () {
            var m = DB.get("cardMachines", id);
            DB.remove("cardMachines", id);
            if (m) DB.log("Maquininhas", "Excluiu a maquininha " + m.name);
            Toast.show("Maquininha excluída", "success");
            render();
          }
        });
      });
    });
  }

  // Exibe a tabela completa de taxas por número de parcelas (2x a 18x) de
  // uma maquininha, cadastrada em "Tabela de Parcelamento (Crédito)" no
  // formulário — não cabe nas colunas da lista principal, então fica numa
  // janela à parte, somente leitura.
  function openParcelasModal(id) {
    var m = DB.get("cardMachines", id);
    if (!m) return;
    var fees = m.installmentFeesCredit || {};
    var rows = '<tr><td>1x (à vista)</td><td class="text-right text-num">' + fmtPct(m.feeCreditPercent) + '</td></tr>';
    for (var n = 2; n <= 18; n++) {
      var v = fees[String(n)];
      if (v === undefined || v === null || v === "") continue;
      rows += '<tr><td>' + n + 'x</td><td class="text-right text-num">' + fmtPct(v) + '</td></tr>';
    }
    var body = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Parcelas</th><th class="text-right">Taxa</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (m.notes ? '<div class="small text-muted mt-12">' + Utils.escapeHtml(m.notes) + '</div>' : '');
    var foot = '<button class="btn btn-secondary" data-close-modal>Fechar</button>';
    Modal.open({ title: "Tabela de Parcelamento — " + m.name, bodyHtml: body, footHtml: foot });
  }

  function fmtPct(v) { return (v || 0).toFixed(2) + "%"; }
  function round2(n) { return Math.round(n * 100) / 100; }

  function kpi(label, value, sub, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div>' +
      '<div class="kpi-delta text-muted" style="color:var(--gray-500);">' + Utils.escapeHtml(sub) + '</div></div>';
  }

  // Linhas do grid de parcelamento (crédito) do formulário: 2x a 18x —
  // cobre as tabelas de operadoras como Getnet (até 12x) e PagBank (até
  // 18x, com faixas). Deixar em branco = a maquininha não parcela nessa
  // quantidade.
  function installmentGridHtml(m) {
    var fees = (m && m.installmentFeesCredit) || {};
    var cells = "";
    for (var n = 2; n <= 18; n++) {
      var v = fees[String(n)];
      cells += '<div class="mq-inst-cell"><label>' + n + 'x</label>' +
        '<input type="number" step="0.01" min="0" class="mq-inst-input" data-n="' + n + '" value="' + (v !== undefined && v !== null ? v : "") + '"></div>';
    }
    return '<div class="mq-inst-grid">' + cells + '</div>';
  }

  function openMqModal(id) {
    var m = id ? DB.get("cardMachines", id) : null;
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Nome da Maquininha</label><input type="text" id="mq-name" placeholder="Ex.: Stone, Cielo POS 2..." value="' + (m ? Utils.escapeHtml(m.name) : "") + '"></div>' +
      '<div class="form-field"><label>Operadora / Adquirente</label><input type="text" id="mq-operator" placeholder="Ex.: Stone, Cielo, Rede, PagSeguro..." value="' + (m ? Utils.escapeHtml(m.operator || "") : "") + '"></div>' +
      '<div class="form-field"><label>Status</label><select id="mq-active"><option value="true"' + (!m || m.active !== false ? " selected" : "") + '>Ativa</option><option value="false"' + (m && m.active === false ? " selected" : "") + '>Inativa</option></select></div>' +
      '<div class="form-field"><label>CNPJ Cadastrado</label><input type="text" id="mq-cnpj" placeholder="00.000.000/0000-00" value="' + (m ? Utils.escapeHtml(m.cnpj || "") : "") + '"></div>' +
      '<div class="form-field"><label>CEP</label><input type="text" id="mq-cep" placeholder="00000-000" value="' + (m ? Utils.escapeHtml(m.cep || "") : "") + '"></div>' +
      '<div class="form-field full"><label>Endereço</label><input type="text" id="mq-address" placeholder="Rua, número, bairro..." value="' + (m ? Utils.escapeHtml(m.address || "") : "") + '"></div>' +
      '<div class="form-field"><label>Taxa Débito à Vista (%)</label><input type="number" step="0.01" min="0" id="mq-fee-debit" value="' + (m ? m.feeDebitPercent : "") + '"></div>' +
      '<div class="form-field"><label>Taxa Crédito à Vista (%)</label><input type="number" step="0.01" min="0" id="mq-fee-credit" value="' + (m ? m.feeCreditPercent : "") + '"></div>' +
      '<div class="form-field"><label>Taxa Pix (%)</label><input type="number" step="0.01" min="0" id="mq-fee-pix" value="' + (m ? (m.feePixPercent != null ? m.feePixPercent : 0) : 0) + '"></div>' +
      '<div class="form-field"><label>Taxa de Antecipação (%)</label><input type="number" step="0.01" min="0" id="mq-fee-antecip" value="' + (m ? (m.anticipationFeePercent || "") : "") + '"></div>' +
      '<div class="form-field"><label>Outras Taxas/Impostos (%)</label><input type="number" step="0.01" min="0" id="mq-fee-other" value="' + (m ? (m.otherTaxesPercent || "") : "") + '"></div>' +
      '<div class="form-field full">' +
        '<label>Tabela de Parcelamento (Crédito) — taxa por nº de parcelas</label>' +
        installmentGridHtml(m) +
      '</div>' +
      '<div class="form-field full"><label>Observações</label><textarea id="mq-notes" rows="2" placeholder="Ex.: taxa negociada, prazo de recebimento, aluguel de equipamento...">' + (m ? Utils.escapeHtml(m.notes || "") : "") + '</textarea></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="mq-save">Salvar Maquininha</button>';
    var box = Modal.open({ title: m ? "Editar Maquininha" : "Nova Maquininha", bodyHtml: body, footHtml: foot });

    box.querySelector("#mq-save").addEventListener("click", function () {
      var name = box.querySelector("#mq-name").value.trim();
      if (!name) { Toast.show("Informe o nome da maquininha", "danger"); return; }
      var installmentFeesCredit = {};
      Utils.qsa(".mq-inst-input", box).forEach(function (inp) {
        var v = inp.value.trim();
        if (v === "") return;
        var n = inp.getAttribute("data-n");
        var pct = parseFloat(v);
        if (!isNaN(pct)) installmentFeesCredit[n] = pct;
      });
      var patch = {
        name: name,
        operator: box.querySelector("#mq-operator").value.trim(),
        active: box.querySelector("#mq-active").value === "true",
        cnpj: box.querySelector("#mq-cnpj").value.trim(),
        cep: box.querySelector("#mq-cep").value.trim(),
        address: box.querySelector("#mq-address").value.trim(),
        feeCreditPercent: parseFloat(box.querySelector("#mq-fee-credit").value) || 0,
        feeDebitPercent: parseFloat(box.querySelector("#mq-fee-debit").value) || 0,
        feePixPercent: parseFloat(box.querySelector("#mq-fee-pix").value) || 0,
        anticipationFeePercent: parseFloat(box.querySelector("#mq-fee-antecip").value) || 0,
        otherTaxesPercent: parseFloat(box.querySelector("#mq-fee-other").value) || 0,
        installmentFeesCredit: installmentFeesCredit,
        notes: box.querySelector("#mq-notes").value.trim()
      };
      if (m) {
        DB.update("cardMachines", m.id, patch);
        DB.log("Maquininhas", "Atualizou a maquininha " + name);
        Toast.show("Maquininha atualizada", "success");
      } else {
        DB.insert("cardMachines", patch);
        DB.log("Maquininhas", "Cadastrou a maquininha " + name);
        Toast.show("Maquininha cadastrada", "success");
      }
      Modal.close();
      render();
    });
  }
})();
