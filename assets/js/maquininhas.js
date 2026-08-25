/* ============================================================
   Salão ERP — Maquininhas
   Cadastro de maquininhas de cartão (operadora, taxas de crédito/
   débito/Pix, antecipação, outras taxas) e estimativa de quanto é
   descontado nas vendas recebidas por cartão/Pix.

   IMPORTANTE: os lançamentos de receita (transactions) ainda não
   registram qual maquininha foi usada em cada venda. Por isso, os
   valores de taxa aqui são uma ESTIMATIVA: aplicamos a taxa da
   maquininha selecionada (ou a média das ativas) sobre a receita
   recebida por Cartão de Crédito / Cartão de Débito / Pix no
   período — não é o extrato exato da operadora.
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
      m.fee += t.amount * (rates[t.paymentMethod] || 0) / 100;
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
      kpi("Receita via Cartão/Pix", Utils.fmtMoney(cardRevenue), txns.filter(function (t) { return byMethod[t.paymentMethod]; }).length + " venda(s) no período", "fa-credit-card", "#2a78d6", "#e3eefb"),
      kpi("Taxa Estimada Paga", Utils.fmtMoney(estimatedFee), "Estimativa — ver nota acima", "fa-hand-holding-dollar", "#c23b3b", "#fbe6e6"),
      kpi("Taxa Média Efetiva", feePct.toFixed(2) + "%", "sobre a receita via cartão/Pix", "fa-percent", "#b8923f", "#f6ecd3"),
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
    tbl.innerHTML = '<thead><tr><th>Maquininha</th><th>Operadora</th><th class="text-right">Crédito</th><th class="text-right">Débito</th><th class="text-right">Pix</th><th class="text-right">Antecipação</th><th>Status</th><th></th></tr></thead><tbody>' +
      machines.map(function (m) {
        return '<tr>' +
          '<td><span class="font-bold">' + Utils.escapeHtml(m.name) + '</span></td>' +
          '<td class="small text-muted">' + Utils.escapeHtml(m.operator || "-") + '</td>' +
          '<td class="text-right text-num">' + fmtPct(m.feeCreditPercent) + '</td>' +
          '<td class="text-right text-num">' + fmtPct(m.feeDebitPercent) + '</td>' +
          '<td class="text-right text-num">' + fmtPct(m.feePixPercent) + '</td>' +
          '<td class="text-right text-num">' + (m.anticipationFeePercent ? fmtPct(m.anticipationFeePercent) : '<span class="text-muted">-</span>') + '</td>' +
          '<td>' + (m.active !== false ? '<span class="badge badge-success">Ativa</span>' : '<span class="badge badge-gray">Inativa</span>') + '</td>' +
          '<td><div class="flex gap-6">' +
            '<button class="btn btn-icon btn-ghost" data-edit="' + m.id + '" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-del="' + m.id + '" title="Excluir"><i class="fa-solid fa-trash"></i></button>' +
          '</div></td></tr>';
      }).join("") + '</tbody>';

    Utils.qsa("[data-edit]", tbl).forEach(function (b) { b.addEventListener("click", function () { openMqModal(b.getAttribute("data-edit")); }); });
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

  function fmtPct(v) { return (v || 0).toFixed(2) + "%"; }
  function round2(n) { return Math.round(n * 100) / 100; }

  function kpi(label, value, sub, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div>' +
      '<div class="kpi-delta text-muted" style="color:var(--gray-500);">' + Utils.escapeHtml(sub) + '</div></div>';
  }

  function openMqModal(id) {
    var m = id ? DB.get("cardMachines", id) : null;
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Nome da Maquininha</label><input type="text" id="mq-name" placeholder="Ex.: Stone, Cielo POS 2..." value="' + (m ? Utils.escapeHtml(m.name) : "") + '"></div>' +
      '<div class="form-field"><label>Operadora / Adquirente</label><input type="text" id="mq-operator" placeholder="Ex.: Stone, Cielo, Rede, PagSeguro..." value="' + (m ? Utils.escapeHtml(m.operator || "") : "") + '"></div>' +
      '<div class="form-field"><label>Status</label><select id="mq-active"><option value="true"' + (!m || m.active !== false ? " selected" : "") + '>Ativa</option><option value="false"' + (m && m.active === false ? " selected" : "") + '>Inativa</option></select></div>' +
      '<div class="form-field"><label>Taxa Crédito (%)</label><input type="number" step="0.01" min="0" id="mq-fee-credit" value="' + (m ? m.feeCreditPercent : "") + '"></div>' +
      '<div class="form-field"><label>Taxa Débito (%)</label><input type="number" step="0.01" min="0" id="mq-fee-debit" value="' + (m ? m.feeDebitPercent : "") + '"></div>' +
      '<div class="form-field"><label>Taxa Pix (%)</label><input type="number" step="0.01" min="0" id="mq-fee-pix" value="' + (m ? (m.feePixPercent != null ? m.feePixPercent : 0) : 0) + '"></div>' +
      '<div class="form-field"><label>Taxa de Antecipação (%)</label><input type="number" step="0.01" min="0" id="mq-fee-antecip" value="' + (m ? (m.anticipationFeePercent || "") : "") + '"></div>' +
      '<div class="form-field"><label>Outras Taxas/Impostos (%)</label><input type="number" step="0.01" min="0" id="mq-fee-other" value="' + (m ? (m.otherTaxesPercent || "") : "") + '"></div>' +
      '<div class="form-field full"><label>Observações</label><textarea id="mq-notes" rows="2" placeholder="Ex.: taxa negociada, prazo de recebimento, aluguel de equipamento...">' + (m ? Utils.escapeHtml(m.notes || "") : "") + '</textarea></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="mq-save">Salvar Maquininha</button>';
    var box = Modal.open({ title: m ? "Editar Maquininha" : "Nova Maquininha", bodyHtml: body, footHtml: foot });

    box.querySelector("#mq-save").addEventListener("click", function () {
      var name = box.querySelector("#mq-name").value.trim();
      if (!name) { Toast.show("Informe o nome da maquininha", "danger"); return; }
      var patch = {
        name: name,
        operator: box.querySelector("#mq-operator").value.trim(),
        active: box.querySelector("#mq-active").value === "true",
        feeCreditPercent: parseFloat(box.querySelector("#mq-fee-credit").value) || 0,
        feeDebitPercent: parseFloat(box.querySelector("#mq-fee-debit").value) || 0,
        feePixPercent: parseFloat(box.querySelector("#mq-fee-pix").value) || 0,
        anticipationFeePercent: parseFloat(box.querySelector("#mq-fee-antecip").value) || 0,
        otherTaxesPercent: parseFloat(box.querySelector("#mq-fee-other").value) || 0,
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
