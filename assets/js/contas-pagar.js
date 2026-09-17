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

  var BUCKET_RANK = { vencida: 0, hoje: 1, "7d": 2, "30d": 3, futuro: 4 };

  // dateStart/dateEnd (ISO YYYY-MM-DD) filtram por data de vencimento
  // exata, escolhida livremente pelo usuário — complementam (não
  // substituem) os chips de situação acima, que são sempre relativos a
  // hoje. Ex.: dá pra ver "só vencidas" (chip) OU "vencimentos de um mês
  // específico do ano passado" (De/Até) OU os dois combinados.
  var state = { bucket: "", cc: "", cat: "", search: "", dateStart: "", dateEnd: "" };
  var selectedIds = {}; // id -> true, only for currently pending/visible rows
  var sortState = { field: null, dir: "asc" }; // clique no rótulo da coluna para ordenar

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
    var dateStartInput = Utils.qs("#cp-date-start"), dateEndInput = Utils.qs("#cp-date-end");
    function applyDateFilter() {
      var s = dateStartInput.value, en = dateEndInput.value;
      if (s && en && s > en) { var tmp = s; s = en; en = tmp; dateStartInput.value = s; dateEndInput.value = en; } // sempre De <= Até
      state.dateStart = s; state.dateEnd = en;
      selectedIds = {};
      render();
    }
    dateStartInput.addEventListener("change", applyDateFilter);
    dateEndInput.addEventListener("change", applyDateFilter);
    Utils.qs("#cp-search").addEventListener("input", Utils.debounce(function (e) { state.search = e.target.value.toLowerCase(); selectedIds = {}; render(); }, 250));
    Utils.qs("#btn-cp-clear").addEventListener("click", function () {
      state = { bucket: "", cc: "", cat: "", search: "", dateStart: "", dateEnd: "" };
      selectedIds = {};
      ccSel.value = ""; catSel.value = ""; Utils.qs("#cp-search").value = "";
      dateStartInput.value = ""; dateEndInput.value = "";
      Utils.qsa("[data-bucket]", Utils.qs("#cp-buckets")).forEach(function (b, i) { b.classList.toggle("active", i === 0); });
      render();
    });
    Utils.qs("#btn-cp-export").addEventListener("click", exportCSV);
    Utils.qs("#btn-cp-bulk-pay").addEventListener("click", bulkAction);
    Utils.qs("#btn-cp-bulk-date").addEventListener("click", function () {
      var ids = Object.keys(selectedIds);
      if (!ids.length) return;
      openBulkDateModal(ids);
    });

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

  function isPagaView() { return state.bucket === "paga"; }

  // Lista de despesas ainda em aberto (pendente), com o bucket de vencimento
  // calculado — usada pelos 5 KPIs de situação e pelos gráficos de previsão,
  // que continuam sempre refletindo o que está em aberto, independente da
  // aba "Pagas" estar selecionada ou não (ela só troca o conteúdo da tabela
  // principal, não o resumo/gráficos de previsão).
  function getAll() {
    var today = Utils.todayISO();
    return DB.all("transactions").filter(function (t) { return t.type === "despesa" && t.status === "pendente"; })
      .map(function (t) { return Object.assign({ _bucket: bucketFor(t.date, today) }, t); });
  }

  // Lista de despesas já pagas — usada só quando a aba "Pagas" está ativa.
  // Nota: ao marcar uma conta como paga (aqui ou em Lançamentos), o campo
  // `date` passa a guardar a DATA DO PAGAMENTO (não mais o vencimento
  // original) — por isso os filtros "Vencimento de/até" nesta visão filtram
  // pela data em que a conta foi paga.
  function getAllPagas() {
    return DB.all("transactions").filter(function (t) { return t.type === "despesa" && t.status === "pago"; })
      .map(function (t) { return Object.assign({ _bucket: "paga" }, t); });
  }

  function getFiltered() {
    if (isPagaView()) {
      return getAllPagas().filter(function (t) {
        if (state.cc && t.costCenterId !== state.cc) return false;
        if (state.cat && t.categoryId !== state.cat) return false;
        if (state.dateStart && t.date < state.dateStart) return false;
        if (state.dateEnd && t.date > state.dateEnd) return false;
        if (state.search && t.description.toLowerCase().indexOf(state.search) === -1) return false;
        return true;
      }).sort(function (a, b) { return b.date.localeCompare(a.date); }); // pagas mais recentes primeiro
    }
    var list = getAll();
    return list.filter(function (t) {
      if (state.bucket && t._bucket !== state.bucket) return false;
      if (state.cc && t.costCenterId !== state.cc) return false;
      if (state.cat && t.categoryId !== state.cat) return false;
      if (state.dateStart && t.date < state.dateStart) return false;
      if (state.dateEnd && t.date > state.dateEnd) return false;
      if (state.search && t.description.toLowerCase().indexOf(state.search) === -1) return false;
      return true;
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  function render() {
    var paga = isPagaView();
    document.getElementById("cp-charts-section").style.display = paga ? "none" : "";
    document.getElementById("cp-table-title").textContent = paga ? "Contas Pagas" : "Contas a Pagar";
    document.getElementById("cp-bulk-btn-label").textContent = paga ? "Reverter selecionados para pendente" : "Marcar selecionados como pago";
    // "Alterar vencimento" em massa só faz sentido para contas ainda
    // pendentes (a aba "Pagas" guarda a data do PAGAMENTO, não um
    // vencimento em aberto — ver getAllPagas acima).
    document.getElementById("btn-cp-bulk-date").style.display = paga ? "none" : "";
    if (paga) {
      renderPagaSummary();
      var costCentersPaga = DB.all("costCenters"), categoriesPaga = DB.all("categories");
      var sortGettersPaga = {
        category: function (t) { var c = categoriesPaga.find(function (x) { return x.id === t.categoryId; }); return c ? c.name : ""; },
        costCenter: function (t) { var c = costCentersPaga.find(function (x) { return x.id === t.costCenterId; }); return c ? c.name : ""; }
      };
      renderTable(Utils.sortBy(getFiltered(), sortState, sortGettersPaga), costCentersPaga, categoriesPaga, true);
      return;
    }

    var today = Utils.todayISO();
    var all = getAll();
    var costCenters = DB.all("costCenters"), categories = DB.all("categories");

    var totalAberto = sum(all);
    var vencidas = all.filter(function (t) { return t._bucket === "vencida"; });
    var venceHoje = all.filter(function (t) { return t._bucket === "hoje"; });
    var proximos7 = all.filter(function (t) { return t._bucket === "7d"; });
    var proximos30 = all.filter(function (t) { return t._bucket === "30d"; });

    document.getElementById("cp-summary").innerHTML = [
      kpi("Total em Aberto", Utils.fmtMoney(totalAberto), all.length + " conta(s)", "fa-file-invoice-dollar", "#0eb8d9", "#dbf7fc"),
      kpi("Vencidas", Utils.fmtMoney(sum(vencidas)), vencidas.length + " conta(s)", "fa-triangle-exclamation", "#c23b3b", "#fbe6e6"),
      kpi("Vence Hoje", Utils.fmtMoney(sum(venceHoje)), venceHoje.length + " conta(s)", "fa-calendar-day", "#b7791f", "#fdf2df"),
      kpi("Próx. 7 dias", Utils.fmtMoney(sum(proximos7)), proximos7.length + " conta(s)", "fa-calendar-week", "#6d5efc", "#ece9ff"),
      kpi("Próx. 8–30 dias", Utils.fmtMoney(sum(proximos30)), proximos30.length + " conta(s)", "fa-calendar", "#1baf7a", "#e2f5ec")
    ].join("");

    // forecast chart (respects cc/cat/search filters, not the bucket filter,
    // so the chart always shows the full breakdown to navigate by)
    var scoped = all.filter(function (t) {
      if (state.cc && t.costCenterId !== state.cc) return false;
      if (state.cat && t.categoryId !== state.cat) return false;
      if (state.dateStart && t.date < state.dateStart) return false;
      if (state.dateEnd && t.date > state.dateEnd) return false;
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
    var sortGetters = {
      category: function (t) { var c = categories.find(function (x) { return x.id === t.categoryId; }); return c ? c.name : ""; },
      costCenter: function (t) { var c = costCenters.find(function (x) { return x.id === t.costCenterId; }); return c ? c.name : ""; },
      situacao: function (t) { return BUCKET_RANK[t._bucket]; }
    };
    var filtered = Utils.sortBy(filteredForCc, sortState, sortGetters);
    renderTable(filtered, costCenters, categories, false);
  }

  // Resumo (KPIs) da aba "Pagas" — total pago e quantidade, respeitando os
  // filtros de Centro de Custo/Categoria/Data/Busca atualmente aplicados
  // (a data aqui é a data de pagamento, ver nota em getAllPagas()).
  function renderPagaSummary() {
    var filtered = getFiltered();
    document.getElementById("cp-summary").innerHTML = [
      kpi("Total Pago", Utils.fmtMoney(sum(filtered)), filtered.length + " conta(s)", "fa-circle-check", "#1baf7a", "#e2f5ec"),
      kpi("Quantidade de Contas Pagas", String(filtered.length), "no filtro atual", "fa-file-invoice-dollar", "#0eb8d9", "#dbf7fc")
    ].join("");
  }

  // Renderiza a tabela principal — compartilhada entre a visão "Contas a
  // Pagar" (pendente, com Situação/vencimento + "Marcar como pago") e
  // "Pagas" (com Forma de Pagamento + "Reverter para pendente"), já que as
  // duas usam a mesma seleção em lote/checkbox por linha.
  function renderTable(filtered, costCenters, categories, paga) {
    // drop selections that are no longer visible under the current filters
    var visibleIds = {};
    filtered.forEach(function (t) { visibleIds[t.id] = true; });
    Object.keys(selectedIds).forEach(function (id) { if (!visibleIds[id]) delete selectedIds[id]; });

    document.getElementById("cp-count-sub").textContent = filtered.length + (paga ? " conta(s) paga(s)" : " conta(s) a pagar");
    var tbl = document.getElementById("tbl-cp");
    if (!filtered.length) {
      Utils.emptyTable(tbl, "fa-circle-check", paga ? "Nenhuma conta paga encontrada" : "Nenhuma conta a pagar encontrada", "Ajuste os filtros ou a situação selecionada.");
      updateBulkBar();
      return;
    }
    tbl.innerHTML = '<thead><tr><th class="cp-col-check"><input type="checkbox" id="cp-select-all"></th>' +
      Utils.thSort(paga ? "Data do Pagamento" : "Vencimento", "date", sortState) +
      Utils.thSort("Descrição", "description", sortState) +
      Utils.thSort("Categoria", "category", sortState) +
      Utils.thSort("Centro de Custo", "costCenter", sortState) +
      (paga ? Utils.thSort("Forma de Pagamento", "paymentMethod", sortState) : Utils.thSort("Situação", "situacao", sortState)) +
      Utils.thSort("Valor", "amount", sortState, { className: "text-right" }) +
      '<th></th></tr></thead><tbody>' +
      filtered.map(function (t) {
        var cat = categories.find(function (c) { return c.id === t.categoryId; });
        var cc = costCenters.find(function (c) { return c.id === t.costCenterId; });
        return '<tr>' +
          '<td class="cp-col-check"><input type="checkbox" class="cp-row-check" data-id="' + t.id + '"' + (selectedIds[t.id] ? " checked" : "") + '></td>' +
          '<td class="text-num">' + Utils.fmtDate(t.date) + '</td>' +
          '<td>' + Utils.escapeHtml(t.description) + '</td>' +
          '<td>' + (cat ? '<span class="chip">' + Utils.escapeHtml(cat.name) + '</span>' : "-") + '</td>' +
          '<td>' + Utils.escapeHtml(cc ? cc.name : "-") + '</td>' +
          '<td>' + (paga ? (t.paymentMethod ? Utils.escapeHtml(t.paymentMethod) : "-") : situationBadge(t._bucket)) + '</td>' +
          '<td class="text-right text-num text-danger">' + Utils.fmtMoney(t.amount) + '</td>' +
          '<td><div class="flex gap-6">' +
            '<button class="btn btn-icon btn-ghost" data-edit="' + t.id + '" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
            (paga ?
              '<button class="btn btn-sm btn-secondary" data-revert="' + t.id + '">Reverter p/ pendente</button>' :
              '<button class="btn btn-sm btn-primary" data-pay="' + t.id + '">Marcar como pago</button>') +
          '</div></td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.wireSortHeaders(tbl, sortState, render);
    Utils.qsa("[data-edit]", tbl).forEach(function (b) { b.addEventListener("click", function () { openEditModal(b.getAttribute("data-edit")); }); });
    Utils.qsa("[data-pay]", tbl).forEach(function (b) { b.addEventListener("click", function () { openPayModal(b.getAttribute("data-pay")); }); });
    Utils.qsa("[data-revert]", tbl).forEach(function (b) { b.addEventListener("click", function () { revertToPendente([b.getAttribute("data-revert")]); }); });
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

  // Botão em lote muda de ação conforme a aba: "Marcar como pago" na visão
  // pendente, "Reverter para pendente" na visão "Pagas".
  function bulkAction() {
    var ids = Object.keys(selectedIds);
    if (!ids.length) return;
    if (isPagaView()) revertToPendente(ids);
    else bulkMarkAsPaid(ids);
  }

  // Alterar o vencimento de várias contas pendentes de uma vez só
  // (17/09/2026) — a pedido do usuário, ao lado de "Marcar selecionados
  // como pago": útil quando um fornecedor/boleto renegocia o vencimento
  // de várias contas ao mesmo tempo (ex.: empurrar tudo do dia 20 pro dia
  // 25), sem precisar abrir "Editar" uma a uma. Só entra aqui quem
  // continua "pendente" no momento de confirmar — mesma checagem defensiva
  // já usada em bulkMarkAsPaid/revertToPendente, para o caso raro de a
  // seleção ter ficado desatualizada.
  function openBulkDateModal(ids) {
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><div class="small text-muted">O novo vencimento abaixo vai ser aplicado às ' + ids.length + ' conta(s) selecionada(s).</div></div>' +
      '<div class="form-field full"><label>Novo Vencimento</label><input type="date" id="cp-bulk-date-input"></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cp-bulk-date-save">Alterar Vencimento</button>';
    var box = Modal.open({ title: "Alterar Vencimento em Massa", bodyHtml: body, footHtml: foot });
    box.querySelector("#cp-bulk-date-save").addEventListener("click", function () {
      var date = box.querySelector("#cp-bulk-date-input").value;
      if (!date) { Toast.show("Informe o novo vencimento", "danger"); return; }
      var count = 0;
      DB.batch(function () {
        ids.forEach(function (id) {
          var t = DB.get("transactions", id);
          if (!t || t.status !== "pendente") return;
          DB.update("transactions", id, { date: date });
          count++;
        });
      });
      DB.log("Contas a Pagar", "Alterou o vencimento de " + count + " conta(s) em lote para " + Utils.fmtDate(date));
      Toast.show(count + " conta(s) com vencimento alterado para " + Utils.fmtDate(date), "success");
      Modal.close();
      selectedIds = {};
      render();
    });
  }

  function bulkMarkAsPaid(ids) {
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

  // Reverte uma ou mais contas já pagas de volta para "pendente" — usada
  // tanto pelo botão individual da linha quanto pela ação em lote na aba
  // "Pagas". Não recalcula o vencimento original (não é guardado em
  // lugar nenhum depois que a conta é paga); a conta volta a aparecer em
  // "Contas a Pagar" com a data que estava salva (a de pagamento), como
  // vencimento — o usuário pode ajustar manualmente se precisar de outra
  // data, mesmo comportamento já usado em Lançamentos Financeiros ao mudar
  // o Status de um lançamento de volta para "Pendente".
  function revertToPendente(ids) {
    Modal.confirm({
      title: "Reverter para pendente",
      message: (ids.length > 1 ? "As " + ids.length + " contas selecionadas vão" : "Esta conta vai") + " voltar para \"Contas a Pagar\" como pendente. Confirmar?",
      confirmLabel: "Reverter",
      onConfirm: function () {
        var count = 0;
        DB.batch(function () {
          ids.forEach(function (id) {
            var t = DB.get("transactions", id);
            if (!t || t.status !== "pago") return;
            DB.update("transactions", id, { status: "pendente" });
            count++;
          });
        });
        DB.log("Contas a Pagar", "Reverteu " + count + " conta(s) paga(s) para pendente");
        Toast.show(count + " conta(s) revertida(s) para pendente", "success");
        selectedIds = {};
        render();
      }
    });
  }

  function situationBadge(bucket) {
    if (bucket === "vencida") return '<span class="badge badge-danger">Vencida</span>';
    if (bucket === "hoje") return '<span class="badge badge-warning">Vence Hoje</span>';
    if (bucket === "7d") return '<span class="badge badge-warning">Próx. 7 dias</span>';
    if (bucket === "30d") return '<span class="badge badge-info">8–30 dias</span>';
    return '<span class="badge badge-gray">+30 dias</span>';
  }

  // Editar um lançamento direto pela tela de Contas a Pagar (17/09/2026) —
  // a pedido do usuário: antes, para corrigir algo simples (ex.: mudar o
  // vencimento de uma pendência) era preciso entrar em Lançamentos
  // Financeiros e achar aquele lançamento lá. Cobre os campos mais comuns
  // de correção rápida (descrição, valor, data, categoria, centro de
  // custo — e, quando a conta já está paga, também a forma de pagamento).
  // Campos mais avançados do lançamento (parcelas, cliente/funcionário
  // vinculado, comprovante anexado) continuam só em Lançamentos
  // Financeiros — não fazem parte do uso típico de uma despesa/conta a
  // pagar e o `DB.update` abaixo é um PATCH parcial, então eles
  // continuam intactos mesmo sem aparecer aqui.
  function openEditModal(id) {
    var t = DB.get("transactions", id);
    if (!t) return;
    var paga = t.status === "pago";
    var categories = DB.all("categories").filter(function (c) { return c.type === "despesa"; });
    var costCenters = DB.all("costCenters");
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Descrição</label><input type="text" id="cp-edit-desc" value="' + Utils.escapeHtml(t.description) + '"></div>' +
      '<div class="form-field"><label>Valor (R$)</label><input type="text" id="cp-edit-amount"></div>' +
      '<div class="form-field"><label>' + (paga ? "Data do Pagamento" : "Vencimento") + '</label><input type="date" id="cp-edit-date" value="' + t.date + '"></div>' +
      '<div class="form-field"><label>Categoria</label><select id="cp-edit-cat">' +
        categories.map(function (c) { return '<option value="' + c.id + '"' + (c.id === t.categoryId ? " selected" : "") + '>' + Utils.escapeHtml(c.name) + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="form-field"><label>Centro de Custo</label><select id="cp-edit-cc">' +
        costCenters.map(function (c) { return '<option value="' + c.id + '"' + (c.id === t.costCenterId ? " selected" : "") + '>' + Utils.escapeHtml(c.name) + '</option>'; }).join("") +
      '</select></div>' +
      (paga ? '<div class="form-field"><label>Forma de Pagamento</label><select id="cp-edit-pay">' +
        ["Pix", "Transferência", "Boleto", "Cartão de Crédito", "Cartão de Débito", "Dinheiro"].map(function (p) {
          return '<option' + (t.paymentMethod === p ? " selected" : "") + '>' + p + '</option>';
        }).join("") + '</select></div>' : "") +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cp-edit-save">Salvar Alterações</button>';
    var box = Modal.open({ title: "Editar Lançamento", bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#cp-edit-amount"), t.amount);
    box.querySelector("#cp-edit-save").addEventListener("click", function () {
      var desc = box.querySelector("#cp-edit-desc").value.trim();
      var amount = Utils.moneyMaskToFloat(box.querySelector("#cp-edit-amount"));
      var date = box.querySelector("#cp-edit-date").value;
      if (!desc) { Toast.show("Informe uma descrição", "danger"); return; }
      if (!date) { Toast.show("Informe a data", "danger"); return; }
      if (!amount || amount <= 0) { Toast.show("Informe um valor válido", "danger"); return; }
      var patch = {
        description: desc, amount: round2(amount), date: date,
        categoryId: box.querySelector("#cp-edit-cat").value,
        costCenterId: box.querySelector("#cp-edit-cc").value
      };
      if (paga) patch.paymentMethod = box.querySelector("#cp-edit-pay").value;
      DB.update("transactions", t.id, patch);
      DB.log("Contas a Pagar", "Editou o lançamento \"" + desc + "\" (" + Utils.fmtMoney(amount) + ")");
      Toast.show("Lançamento atualizado", "success");
      Modal.close();
      render();
    });
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
    var paga = isPagaView();
    var filtered = getFiltered();
    var costCenters = DB.all("costCenters"), categories = DB.all("categories");
    var header = paga
      ? ["Data do Pagamento", "Descrição", "Categoria", "Centro de Custo", "Forma de Pagamento", "Valor"]
      : ["Vencimento", "Descrição", "Categoria", "Centro de Custo", "Situação", "Valor"];
    var rows = filtered.map(function (t) {
      var cat = categories.find(function (c) { return c.id === t.categoryId; });
      var cc = costCenters.find(function (c) { return c.id === t.costCenterId; });
      var col5 = paga ? (t.paymentMethod || "") : (BUCKET_LABELS[t._bucket] || t._bucket);
      return [t.date, t.description, cat ? cat.name : "", cc ? cc.name : "", col5, String(t.amount).replace(".", ",")];
    });
    var csv = [header].concat(rows).map(function (r) {
      return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(";");
    }).join("\n");
    Utils.downloadFile((paga ? "contas_pagas_" : "contas_a_pagar_") + Utils.todayISO() + ".csv", "﻿" + csv, "text/csv;charset=utf-8");
    Toast.show((paga ? "Contas pagas exportadas" : "Contas a pagar exportadas") + " em CSV", "success");
    DB.log("Contas a Pagar", "Exportou " + (paga ? "contas pagas" : "contas a pagar") + " em CSV (" + filtered.length + " conta(s))");
  }
})();
