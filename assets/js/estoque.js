(function () {
  "use strict";

  var pf = { type: "", status: "", search: "" };
  var mf = { product: "", type: "", start: "", end: "" };
  var cf = { employee: "", start: "", end: "" };
  var movesPage = 1, MOVES_PAGE_SIZE = 20;

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    Utils.qsa(".tab-btn", document.getElementById("main-tabs")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        Utils.qsa(".tab-btn", document.getElementById("main-tabs")).forEach(function (b) { b.classList.remove("active"); });
        Utils.qsa(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        document.getElementById(btn.getAttribute("data-panel")).classList.add("active");
      });
    });

    Utils.qs("#p-type").addEventListener("change", function (e) { pf.type = e.target.value; renderProducts(); });
    Utils.qs("#p-status").addEventListener("change", function (e) { pf.status = e.target.value; renderProducts(); });
    Utils.qs("#p-search").addEventListener("input", Utils.debounce(function (e) { pf.search = e.target.value.toLowerCase(); renderProducts(); }, 200));
    Utils.qs("#btn-new-product").addEventListener("click", function () { openProductModal(null); });
    Utils.qs("#btn-export-stock").addEventListener("click", exportCSV);

    var prodSel = Utils.qs("#mv-product");
    DB.all("products").sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
      var o = document.createElement("option"); o.value = p.id; o.textContent = p.name; prodSel.appendChild(o);
    });
    prodSel.addEventListener("change", function (e) { mf.product = e.target.value; movesPage = 1; renderMoves(); });
    Utils.qs("#mv-type").addEventListener("change", function (e) { mf.type = e.target.value; movesPage = 1; renderMoves(); });
    Utils.qs("#mv-start").addEventListener("change", function (e) { mf.start = e.target.value; movesPage = 1; renderMoves(); });
    Utils.qs("#mv-end").addEventListener("change", function (e) { mf.end = e.target.value; movesPage = 1; renderMoves(); });

    var empSel = Utils.qs("#cs-employee");
    DB.all("employees").filter(function (e) { return e.status === "ativo"; }).sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (e) {
      var o = document.createElement("option"); o.value = e.id; o.textContent = e.name; empSel.appendChild(o);
    });
    empSel.addEventListener("change", function (e) { cf.employee = e.target.value; renderConsumo(); });
    Utils.qs("#cs-start").addEventListener("change", function (e) { cf.start = e.target.value; renderConsumo(); });
    Utils.qs("#cs-end").addEventListener("change", function (e) { cf.end = e.target.value; renderConsumo(); });
    Utils.qs("#btn-new-consumo").addEventListener("click", function () { openConsumoModal(); });

    renderProducts();
    renderMoves();
    renderConsumo();
  }

  function getProducts() {
    return DB.all("products").filter(function (p) {
      if (pf.type && p.type !== pf.type) return false;
      if (pf.status === "baixo" && p.currentStock > p.minStock) return false;
      if (pf.status === "ok" && p.currentStock <= p.minStock) return false;
      if (pf.search) {
        var hay = (p.name + " " + p.sku + " " + p.supplier).toLowerCase();
        if (hay.indexOf(pf.search) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      var la = a.currentStock <= a.minStock ? 0 : 1, lb = b.currentStock <= b.minStock ? 0 : 1;
      return la - lb || a.name.localeCompare(b.name);
    });
  }

  function renderProducts() {
    var products = getProducts();
    var all = DB.all("products");
    var lowStock = all.filter(function (p) { return p.currentStock <= p.minStock; });
    var totalValue = all.reduce(function (s, p) { return s + p.currentStock * p.costPrice; }, 0);
    var movesThisMonth = DB.all("stockMovements").filter(function (m) { return Utils.monthKey(m.date) === Utils.monthKey(Utils.todayISO()); });

    document.getElementById("stock-summary").innerHTML = [
      kpi("Produtos Cadastrados", String(all.length), "fa-boxes-stacked", "#2a78d6", "#e3eefb"),
      kpi("Valor em Estoque (custo)", Utils.fmtMoney(totalValue), "fa-sack-dollar", "#b8923f", "#f6ecd3"),
      kpi("Abaixo do Mínimo", String(lowStock.length), "fa-triangle-exclamation", "#c23b3b", "#fbe6e6"),
      kpi("Movimentações no Mês", String(movesThisMonth.length), "fa-arrow-right-arrow-left", "#1baf7a", "#e2f5ec")
    ].join("");

    var tbl = document.getElementById("tbl-products");
    if (!products.length) {
      Utils.emptyTable(tbl, "fa-box-open", "Nenhum produto encontrado");
      return;
    }
    tbl.innerHTML = '<thead><tr><th>Produto</th><th>SKU</th><th>Tipo</th><th class="text-right">Estoque</th><th class="text-right">Mínimo</th><th class="text-right">Custo</th><th class="text-right">Venda</th><th>Fornecedor</th><th>Situação</th><th></th></tr></thead><tbody>' +
      products.map(function (p) {
        var low = p.currentStock <= p.minStock;
        return '<tr>' +
          '<td class="font-bold">' + Utils.escapeHtml(p.name) + '</td>' +
          '<td class="small text-muted">' + Utils.escapeHtml(p.sku) + '</td>' +
          '<td>' + (p.type === "uso_interno" ? '<span class="badge badge-info">Uso Interno</span>' : '<span class="badge badge-gray" style="background:var(--color-accent-light);color:var(--color-accent);">Revenda</span>') + '</td>' +
          '<td class="text-right text-num">' + Utils.fmtNumber(p.currentStock, p.currentStock % 1 ? 2 : 0) + ' ' + p.unit + '</td>' +
          '<td class="text-right text-num">' + p.minStock + ' ' + p.unit + '</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(p.costPrice) + '</td>' +
          '<td class="text-right text-num">' + (p.salePrice ? Utils.fmtMoney(p.salePrice) : '<span class="text-muted">-</span>') + '</td>' +
          '<td class="small">' + Utils.escapeHtml(p.supplier || "-") + '</td>' +
          '<td>' + (low ? '<span class="badge badge-danger">Baixo</span>' : '<span class="badge badge-success">OK</span>') + '</td>' +
          '<td><div class="flex gap-6">' +
            '<button class="btn btn-icon btn-ghost" data-move="' + p.id + '" title="Movimentar"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-edit="' + p.id + '" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-del="' + p.id + '" title="Excluir"><i class="fa-solid fa-trash"></i></button>' +
          '</div></td>' +
          '</tr>';
      }).join("") + '</tbody>';

    Utils.qsa("[data-move]", tbl).forEach(function (b) { b.addEventListener("click", function () { openMoveModal(b.getAttribute("data-move")); }); });
    Utils.qsa("[data-edit]", tbl).forEach(function (b) { b.addEventListener("click", function () { openProductModal(b.getAttribute("data-edit")); }); });
    Utils.qsa("[data-del]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del");
        Modal.confirm({
          title: "Excluir produto", message: "Excluir este produto também removerá seu histórico de movimentações. Continuar?", danger: true,
          onConfirm: function () {
            var prod = DB.get("products", id);
            DB.remove("products", id);
            DB.removeWhere("stockMovements", function (m) { return m.productId === id; });
            if (prod) DB.log("Estoque", "Excluiu o produto " + prod.name);
            Toast.show("Produto excluído", "success");
            renderProducts(); renderMoves();
          }
        });
      });
    });
  }

  function renderMoves() {
    var products = DB.all("products");
    var moves = DB.all("stockMovements").filter(function (m) {
      if (mf.product && m.productId !== mf.product) return false;
      if (mf.type && m.type !== mf.type) return false;
      if (mf.start && m.date < mf.start) return false;
      if (mf.end && m.date > mf.end) return false;
      return true;
    }).sort(function (a, b) { return b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""); });

    var totalPages = Math.max(1, Math.ceil(moves.length / MOVES_PAGE_SIZE));
    movesPage = Math.min(movesPage, totalPages);
    var pageItems = moves.slice((movesPage - 1) * MOVES_PAGE_SIZE, movesPage * MOVES_PAGE_SIZE);

    var tbl = document.getElementById("tbl-moves");
    if (!pageItems.length) {
      Utils.emptyTable(tbl, "fa-clock", "Nenhuma movimentação encontrada");
    } else {
      tbl.innerHTML = '<thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Motivo</th><th class="text-right">Quantidade</th><th>Observações</th></tr></thead><tbody>' +
        pageItems.map(function (m) {
          var p = products.find(function (x) { return x.id === m.productId; });
          return '<tr><td class="text-num">' + Utils.fmtDate(m.date) + '</td><td>' + Utils.escapeHtml(p ? p.name : "?") + '</td>' +
            '<td>' + (m.type === "entrada" ? '<span class="badge badge-success">Entrada</span>' : '<span class="badge badge-danger">Saída</span>') + '</td>' +
            '<td>' + reasonLabel(m.reason) + '</td>' +
            '<td class="text-right text-num">' + (m.displayQuantity != null && window.Consumo ? Consumo.fmtQty(m.displayQuantity, m.displayUnit) : Utils.fmtNumber(m.quantity, m.quantity % 1 ? 2 : 0) + (p ? " " + p.unit : "")) + '</td>' +
            '<td class="small text-muted">' + Utils.escapeHtml(m.notes || "-") + '</td></tr>';
        }).join("") + '</tbody>';
    }
    var pag = document.getElementById("moves-pagination");
    pag.innerHTML = '<div>Mostrando ' + pageItems.length + ' de ' + moves.length + '</div>' +
      '<div class="pg-btns"><button class="btn btn-sm btn-secondary" id="mv-prev" ' + (movesPage <= 1 ? "disabled" : "") + '>Anterior</button>' +
      '<span style="padding:6px 10px;">Página ' + movesPage + ' de ' + totalPages + '</span>' +
      '<button class="btn btn-sm btn-secondary" id="mv-next" ' + (movesPage >= totalPages ? "disabled" : "") + '>Próxima</button></div>';
    var pv = document.getElementById("mv-prev"), nx = document.getElementById("mv-next");
    if (pv) pv.addEventListener("click", function () { movesPage--; renderMoves(); });
    if (nx) nx.addEventListener("click", function () { movesPage++; renderMoves(); });
  }

  // ---- Consumo de Insumos (lançamento manual) ----------------------------
  // Cada funcionário paga metade do que consome (em ml/g) de cada produto de
  // uso interno; a outra metade é despesa do salão. O módulo compartilhado
  // assets/js/consumo.js já faz a baixa de estoque + o lançamento financeiro
  // e a dedução no comissionamento — aqui só oferecemos o formulário manual
  // (o outro ponto de lançamento é o "Concluir Atendimento" na Agenda).

  function getConsumos() {
    var employees = DB.all("employees");
    return DB.all("productConsumptions").filter(function (c) {
      if (cf.employee && c.employeeId !== cf.employee) return false;
      if (cf.start && c.date < cf.start) return false;
      if (cf.end && c.date > cf.end) return false;
      return true;
    }).map(function (c) {
      c._employee = employees.find(function (e) { return e.id === c.employeeId; });
      return c;
    }).sort(function (a, b) { return b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""); });
  }

  function renderConsumo() {
    var products = DB.all("products");
    var items = getConsumos();
    var tbl = document.getElementById("tbl-consumo");
    if (!items.length) {
      Utils.emptyTable(tbl, "fa-flask", "Nenhum lançamento de consumo encontrado");
      return;
    }
    var isAdmin = !window.Approvals || Approvals.isAdmin();
    tbl.innerHTML = '<thead><tr><th>Data</th><th>Profissional</th><th>Produto</th><th class="text-right">Qtd.</th><th class="text-right">Custo Total</th><th class="text-right">Metade Profissional</th><th class="text-right">Metade Salão</th><th>Observações</th><th></th></tr></thead><tbody>' +
      items.map(function (c) {
        var p = products.find(function (x) { return x.id === c.productId; });
        return '<tr>' +
          '<td class="text-num">' + Utils.fmtDate(c.date) + '</td>' +
          '<td><div class="flex items-center gap-8">' + Utils.avatarHtml(c._employee ? c._employee.name : "?", c._employee ? c._employee.photoDataUrl : null) + '<span>' + Utils.escapeHtml(c._employee ? c._employee.name : "Funcionário removido") + '</span></div></td>' +
          '<td>' + Utils.escapeHtml(p ? p.name : "?") + '</td>' +
          '<td class="text-right text-num">' + Consumo.fmtQty(c.quantity, c.unit) + '</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(c.totalCost) + (c.discountApplied ? '<div class="small text-danger">desconto de ' + Utils.fmtMoney(c.discountApplied) + '</div>' : '') + '</td>' +
          '<td class="text-right text-num text-danger">' + Utils.fmtMoney(c.employeeShare) + '</td>' +
          '<td class="text-right text-num">' + Utils.fmtMoney(c.companyShare) + '</td>' +
          '<td class="small text-muted">' + Utils.escapeHtml(c.notes || "-") + '</td>' +
          '<td><div class="flex gap-6">' +
            '<button class="btn btn-icon btn-ghost" data-details-consumo="' + c.id + '" title="Ver detalhes do atendimento"><i class="fa-solid fa-circle-info"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-discount-consumo="' + c.id + '" title="' + (isAdmin ? "Dar desconto" : "Solicitar desconto") + '"><i class="fa-solid fa-tag"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-del-consumo="' + c.id + '" title="Excluir lançamento"><i class="fa-solid fa-trash"></i></button>' +
          '</div></td>' +
          '</tr>';
      }).join("") + '</tbody>';

    Utils.qsa("[data-details-consumo]", tbl).forEach(function (b) {
      b.addEventListener("click", function () { openConsumoDetailsModal(b.getAttribute("data-details-consumo")); });
    });
    Utils.qsa("[data-del-consumo]", tbl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del-consumo");
        Modal.confirm({
          title: "Excluir lançamento de consumo",
          message: "O estoque do produto será estornado (quantidade devolvida). A despesa da empresa já lançada em Financeiro não é removida automaticamente. Continuar?",
          danger: true,
          onConfirm: function () {
            Consumo.remove(id);
            Toast.show("Lançamento de consumo excluído", "success");
            renderProducts(); renderMoves(); renderConsumo();
          }
        });
      });
    });
    Utils.qsa("[data-discount-consumo]", tbl).forEach(function (b) {
      b.addEventListener("click", function () { openDiscountModal(b.getAttribute("data-discount-consumo")); });
    });
  }

  // "Tudo relacionado ao atendimento" desse lançamento de consumo: dados do
  // produto/quantidade/valores, e — quando o consumo veio da Agenda (ao
  // concluir um atendimento) — cliente, serviço, profissional e os demais
  // itens de insumo/produto lançados no mesmo atendimento, para dar a visão
  // completa num só lugar em vez de precisar cruzar Agenda + Estoque.
  function openConsumoDetailsModal(consumptionId) {
    var c = DB.get("productConsumptions", consumptionId);
    if (!c) return;
    var product = DB.get("products", c.productId);
    var employee = DB.get("employees", c.employeeId);
    var appt = c.appointmentId ? DB.get("appointments", c.appointmentId) : null;
    var client = c.clientId ? DB.get("clients", c.clientId) : null;
    var service = appt ? DB.get("services", appt.serviceId) : null;

    var body = '<div class="grid-2">' +
      '<div class="card"><div class="card-header"><h3>Consumo</h3></div><div class="card-body">' +
        '<div class="flex items-center gap-8 mb-12">' + Utils.avatarHtml(employee ? employee.name : "?", employee ? employee.photoDataUrl : null) +
          '<div><div class="font-bold">' + Utils.escapeHtml(employee ? employee.name : "Funcionário removido") + '</div><div class="small text-muted">' + Utils.fmtDate(c.date) + '</div></div></div>' +
        '<table class="kv-table">' +
          '<tr><td>Produto</td><td>' + Utils.escapeHtml(product ? product.name : "Produto removido") + '</td></tr>' +
          '<tr><td>Quantidade</td><td>' + Consumo.fmtQty(c.quantity, c.unit) + '</td></tr>' +
          '<tr><td>Custo Total</td><td>' + Utils.fmtMoney(c.totalCost) + (c.discountApplied ? ' <span class="text-danger small">(desconto de ' + Utils.fmtMoney(c.discountApplied) + ' aplicado)</span>' : '') + '</td></tr>' +
          '<tr><td>Metade Profissional</td><td class="text-danger">' + Utils.fmtMoney(c.employeeShare) + '</td></tr>' +
          '<tr><td>Metade Salão</td><td>' + Utils.fmtMoney(c.companyShare) + '</td></tr>' +
          '<tr><td>Observações</td><td>' + Utils.escapeHtml(c.notes || "-") + '</td></tr>' +
        '</table>' +
      '</div></div>' +
      '<div class="card"><div class="card-header"><h3>Atendimento</h3></div><div class="card-body">' +
        (appt ?
          '<table class="kv-table">' +
            '<tr><td>Cliente</td><td>' + Utils.escapeHtml(client ? client.name : "-") + '</td></tr>' +
            '<tr><td>Serviço</td><td>' + Utils.escapeHtml(service ? service.name : "-") + '</td></tr>' +
            '<tr><td>Data/Hora</td><td>' + Utils.fmtDate(appt.date) + ' · ' + appt.time + '</td></tr>' +
            '<tr><td>Valor Cobrado</td><td>' + Utils.fmtMoney(appt.price) + '</td></tr>' +
            '<tr><td>Status</td><td>' + Utils.escapeHtml(appt.status) + '</td></tr>' +
          '</table>' :
          '<p class="small text-muted">Lançamento manual feito direto no Estoque — sem atendimento vinculado.</p>') +
      '</div></div>' +
      '</div>' +
      (appt ? (function () {
        var siblings = DB.all("productConsumptions").filter(function (x) { return x.appointmentId === appt.id; });
        if (siblings.length <= 1) return "";
        return '<div class="card mt-16"><div class="card-header"><h3>Outros itens deste atendimento</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table">' +
          '<thead><tr><th>Produto</th><th class="text-right">Qtd.</th><th class="text-right">Custo Total</th></tr></thead><tbody>' +
          siblings.map(function (s) {
            var sp = DB.get("products", s.productId);
            return '<tr' + (s.id === c.id ? ' style="font-weight:700;"' : '') + '><td>' + Utils.escapeHtml(sp ? sp.name : "-") + (s.id === c.id ? ' <span class="small text-muted">(este)</span>' : '') + '</td>' +
              '<td class="text-right text-num">' + Consumo.fmtQty(s.quantity, s.unit) + '</td>' +
              '<td class="text-right text-num">' + Utils.fmtMoney(s.totalCost) + '</td></tr>';
          }).join("") + '</tbody></table></div></div></div>';
      })() : "");

    var foot = '<button class="btn btn-secondary" data-close-modal>Fechar</button>';
    Modal.open({ title: "Detalhes do Consumo", wide: true, bodyHtml: body, footHtml: foot });
  }

  // Desconto opcional só nesta tela (Lançar Consumo já parte do preço de
  // venda normal — ver consumoItemRowHtml). Administrador aplica na hora;
  // qualquer outro usuário só pode solicitar, e fica pendente até um
  // Administrador aprovar em Configurações → Aprovações.
  function openDiscountModal(consumptionId) {
    var c = DB.get("productConsumptions", consumptionId);
    if (!c) return;
    var p = DB.get("products", c.productId);
    var isAdmin = !window.Approvals || Approvals.isAdmin();
    var body = '<p class="small text-muted mb-16">Custo total atual: <strong>' + Utils.fmtMoney(c.totalCost) + '</strong> (' + Utils.escapeHtml(p ? p.name : "produto") + ')</p>' +
      '<div class="form-field"><label>Valor do desconto (R$)</label><input type="text" id="disc-value" placeholder="0,00"></div>' +
      (isAdmin ? "" : '<div class="form-field"><label>Motivo (opcional)</label><input type="text" id="disc-reason" placeholder="Ex: produto vencendo, cortesia..."></div>');
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="disc-save">' + (isAdmin ? "Aplicar desconto" : "Solicitar desconto") + '</button>';
    var box = Modal.open({ title: isAdmin ? "Dar desconto no consumo" : "Solicitar desconto no consumo", bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#disc-value"), 0);
    box.querySelector("#disc-save").addEventListener("click", function () {
      var value = Utils.moneyMaskToFloat(box.querySelector("#disc-value"));
      if (isNaN(value) || value <= 0) { Toast.show("Informe um valor de desconto válido", "danger"); return; }
      if (value > c.totalCost) { Toast.show("O desconto não pode ser maior que o custo total do lançamento", "danger"); return; }
      if (isAdmin) {
        Consumo.applyDiscount(consumptionId, value);
        DB.log("Estoque", "Aplicou desconto de " + Utils.fmtMoney(value) + " no consumo de " + (p ? p.name : "produto"));
        Toast.show("Desconto aplicado", "success");
        Modal.close();
        renderProducts(); renderMoves(); renderConsumo();
      } else {
        var reason = box.querySelector("#disc-reason").value.trim();
        var summary = "Desconto de " + Utils.fmtMoney(value) + " no consumo de " + (p ? p.name : "produto") + " (" + Utils.fmtDate(c.date) + ")" + (reason ? " — " + reason : "");
        Approvals.request("desconto_consumo", summary, { consumptionId: consumptionId, discountAmount: value });
        Toast.show("Solicitação de desconto enviada para aprovação de um Administrador", "success");
        Modal.close();
      }
    });
  }

  var _csItemSeq = 0;
  function consumoItemRowHtml() {
    var id = "cs" + (++_csItemSeq);
    var products = Consumo.produtosElegiveis();
    var canDiscount = !window.Approvals || Approvals.isAdmin();
    return '<div class="sale-item-row consumo-item-row" data-row-id="' + id + '">' +
      '<button type="button" class="btn btn-icon btn-ghost si-remove cs-remove" title="Remover item"><i class="fa-solid fa-xmark"></i></button>' +
      '<div class="form-grid">' +
        '<div class="form-field full"><label>Produto</label><select class="cs-produto">' +
          products.map(function (p) { return '<option value="' + p.id + '">' + Utils.escapeHtml(p.name) + '</option>'; }).join("") +
        '</select></div>' +
        '<div class="form-field"><label>Quantidade</label><div class="flex items-center gap-6">' +
          '<input type="number" class="cs-qtd" step="0.1" min="0" placeholder="Qtd.">' +
          '<span class="small text-muted cs-unit" style="min-width:24px;"></span>' +
        '</div></div>' +
        '<div class="form-field"><label>Valor do item (R$)</label><input type="text" class="cs-valor"' + (canDiscount ? "" : " disabled") + '></div>' +
      '</div>' +
      (canDiscount ? '<div class="small text-muted mt-8">Preenchido automaticamente com o preço de venda normal do produto — edite para dar desconto.</div>' :
        '<div class="small text-muted mt-8">Valor calculado pelo preço de venda normal do produto. Para dar desconto, solicite depois de lançar (a lista de Consumo de Insumos abaixo tem essa opção) — só um Administrador pode aprovar.</div>') +
      '</div>';
  }

  function wireConsumoItemRow(row) {
    var prodSel = row.querySelector(".cs-produto");
    var unitEl = row.querySelector(".cs-unit");
    var qtdEl = row.querySelector(".cs-qtd");
    var valorEl = row.querySelector(".cs-valor");
    // Preço de referência para o valor do item: preço de venda normal do
    // produto — só cai para o preço de custo se o produto (de uso interno)
    // não tiver preço de venda cadastrado.
    function refPrice(p) { return (p && p.salePrice) ? Number(p.salePrice) : (p ? Number(p.costPrice) || 0 : 0); }
    function updateAll() {
      var p = DB.get("products", prodSel.value);
      unitEl.textContent = p ? Consumo.unitLabelOf(p) : "";
      var qty = parseFloat(qtdEl.value) || 0;
      Utils.setMoneyMaskValue(valorEl, p ? refPrice(p) * qty : 0);
    }
    Utils.wireMoneyMask(valorEl, 0);
    prodSel.addEventListener("change", updateAll);
    qtdEl.addEventListener("input", updateAll);
    row.querySelector(".cs-remove").addEventListener("click", function () { row.remove(); });
    updateAll();
  }

  function openConsumoModal() {
    var employees = DB.all("employees").filter(function (e) { return e.status === "ativo"; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!Consumo.produtosElegiveis().length) {
      Toast.show("Nenhum produto de uso interno com embalagem (ml/g) cadastrada. Cadastre um produto de uso interno com tamanho de embalagem para lançar consumo.", "danger");
      return;
    }
    if (!employees.length) { Toast.show("Nenhum profissional ativo cadastrado", "danger"); return; }

    var body = '<div class="form-grid">' +
      '<div class="form-field"><label>Profissional</label><select id="cm-employee">' +
        employees.map(function (e) { return '<option value="' + e.id + '">' + Utils.escapeHtml(e.name) + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="form-field"><label>Data</label><input type="date" id="cm-date" value="' + Utils.todayISO() + '"></div>' +
      '</div>' +
      '<div class="divider" style="margin:14px 0;"></div>' +
      '<div class="flex items-center justify-between mb-8">' +
        '<label style="font-weight:600;">Itens Consumidos</label>' +
        '<button type="button" class="btn btn-sm btn-outline" id="cm-add-item"><i class="fa-solid fa-plus"></i> Adicionar item</button>' +
      '</div>' +
      '<div id="cm-items"></div>' +
      '<div class="form-field full"><label>Observações (opcional)</label><input type="text" id="cm-notes" placeholder="Ex: durante o atendimento, coloração, etc."></div>' +
      '<div class="small text-muted mt-8">O custo de cada item é dividido 50/50: metade vira desconto no comissionamento do profissional, metade vira despesa do salão.</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cm-save">Lançar Consumo</button>';
    var box = Modal.open({ title: "Lançar Consumo de Insumos", wide: true, bodyHtml: body, footHtml: foot });

    var itemsEl = box.querySelector("#cm-items");
    itemsEl.insertAdjacentHTML("beforeend", consumoItemRowHtml());
    wireConsumoItemRow(itemsEl.lastElementChild);
    box.querySelector("#cm-add-item").addEventListener("click", function () {
      itemsEl.insertAdjacentHTML("beforeend", consumoItemRowHtml());
      wireConsumoItemRow(itemsEl.lastElementChild);
    });

    box.querySelector("#cm-save").addEventListener("click", function () {
      var employeeId = box.querySelector("#cm-employee").value;
      var date = box.querySelector("#cm-date").value || Utils.todayISO();
      var notes = box.querySelector("#cm-notes").value.trim();
      var rows = Utils.qsa(".consumo-item-row", itemsEl);
      var valid = rows.filter(function (row) {
        var productId = row.querySelector(".cs-produto").value;
        var qty = parseFloat(row.querySelector(".cs-qtd").value) || 0;
        return productId && qty > 0;
      });
      if (!valid.length) { Toast.show("Adicione ao menos um item com quantidade válida", "danger"); return; }

      var errorMsg = null;
      DB.batch(function () {
        valid.forEach(function (row) {
          var productId = row.querySelector(".cs-produto").value;
          var qty = parseFloat(row.querySelector(".cs-qtd").value) || 0;
          var itemValor = Utils.moneyMaskToFloat(row.querySelector(".cs-valor"));
          var unitPriceOverride = qty > 0 ? (itemValor / qty) : 0;
          try {
            Consumo.register({ productId: productId, employeeId: employeeId, quantity: qty, date: date, notes: notes, unitPriceOverride: unitPriceOverride });
          } catch (err) { errorMsg = String(err); }
        });
      });
      if (errorMsg) Toast.show(errorMsg, "danger");

      Modal.close();
      Toast.show("Consumo de insumo registrado (" + valid.length + " item(ns))", "success");
      renderProducts(); renderMoves(); renderConsumo();
    });
  }

  function reasonLabel(reason) {
    var map = { compra: '<span class="chip">Compra</span>', uso_interno: '<span class="chip">Uso Interno</span>', venda: '<span class="chip">Venda</span>', ajuste: '<span class="chip">Ajuste</span>', perda: '<span class="chip">Perda</span>' };
    return map[reason] || reason;
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }

  function openProductModal(id) {
    var p = id ? DB.get("products", id) : null;
    var pkgUnit = p ? (p.packageUnit || "") : "";
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Nome do Produto</label><input type="text" id="pm-name" value="' + (p ? Utils.escapeHtml(p.name) : "") + '"></div>' +
      '<div class="form-field"><label>SKU</label><input type="text" id="pm-sku" value="' + (p ? Utils.escapeHtml(p.sku) : "SKU-" + Math.random().toString(36).slice(2, 7).toUpperCase()) + '"></div>' +
      '<div class="form-field"><label>Tipo</label><select id="pm-type"><option value="uso_interno"' + (p && p.type === "uso_interno" ? " selected" : "") + '>Uso Interno</option><option value="revenda"' + (p && p.type === "revenda" ? " selected" : "") + '>Revenda</option></select></div>' +
      '<div class="form-field"><label>Unidade (controle de estoque)</label><input type="text" id="pm-unit" value="' + (p ? Utils.escapeHtml(p.unit) : "un") + '"><div class="hint">Como o estoque é contado — ex.: "un" para frascos/potes fechados.</div></div>' +
      '<div class="form-field"><label>Fornecedor</label><input type="text" id="pm-supplier" value="' + (p ? Utils.escapeHtml(p.supplier) : "") + '"></div>' +
      '<div class="form-field"><label>Estoque Atual</label><input type="number" step="0.01" id="pm-stock" value="' + (p ? p.currentStock : 0) + '"></div>' +
      '<div class="form-field"><label>Estoque Mínimo</label><input type="number" step="0.01" id="pm-min" value="' + (p ? p.minStock : 5) + '"></div>' +
      '<div class="form-field"><label>Preço de Custo (R$)</label><input type="text" id="pm-cost"></div>' +
      '<div class="form-field"><label>Preço de Venda (R$)</label><input type="text" id="pm-sale"><div class="hint">Deixe em branco se for de uso interno</div></div>' +
      '</div>' +
      '<div class="divider" style="margin:14px 0;"></div>' +
      '<div id="pm-package-wrap">' +
        '<label class="font-bold small" style="display:block;margin-bottom:8px;">Embalagem (para lançar consumo/movimentação em g ou ml)</label>' +
        '<div class="form-grid">' +
        '<div class="form-field"><label>Cada "1 ' + (p ? Utils.escapeHtml(p.unit) : "un") + '" equivale a</label><select id="pm-package-unit">' +
          '<option value="">Sem embalagem — controlar direto em "' + (p ? Utils.escapeHtml(p.unit) : "un") + '"</option>' +
          '<option value="g"' + (pkgUnit === "g" ? " selected" : "") + '>Gramas (g)</option>' +
          '<option value="ml"' + (pkgUnit === "ml" ? " selected" : "") + '>Mililitros (ml)</option>' +
        '</select></div>' +
        '<div class="form-field" id="pm-package-size-wrap" style="display:' + (pkgUnit ? "block" : "none") + ';"><label>Tamanho da embalagem</label><input type="number" step="1" min="1" id="pm-package-size" placeholder="Ex: 1000" value="' + (p && p.packageSize ? p.packageSize : "") + '"></div>' +
        '</div>' +
        '<div class="small text-muted mt-8">Ex.: um pote de 1kg de máscara = "1 un" no estoque, mas cada un tem 1000 g. Com isso preenchido, quem lançar consumo ou movimentar esse produto digita a quantidade direto em g/ml (ex.: 250), sem precisar calcular fração de embalagem.</div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="pm-save">Salvar Produto</button>';
    var box = Modal.open({ title: p ? "Editar Produto" : "Novo Produto", wide: true, bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#pm-cost"), p ? p.costPrice : 0);
    Utils.wireMoneyMask(box.querySelector("#pm-sale"), p && p.salePrice ? p.salePrice : 0);

    box.querySelector("#pm-package-unit").addEventListener("change", function (e) {
      box.querySelector("#pm-package-size-wrap").style.display = e.target.value ? "block" : "none";
    });

    box.querySelector("#pm-save").addEventListener("click", function () {
      var name = box.querySelector("#pm-name").value.trim();
      if (!name) { Toast.show("Informe o nome do produto", "danger"); return; }
      var packageUnitVal = box.querySelector("#pm-package-unit").value;
      var packageSizeVal = packageUnitVal ? (parseFloat(box.querySelector("#pm-package-size").value) || 0) : 0;
      if (packageUnitVal && packageSizeVal <= 0) { Toast.show("Informe o tamanho da embalagem (ex.: 1000)", "danger"); return; }
      var patch = {
        name: name, sku: box.querySelector("#pm-sku").value.trim(), type: box.querySelector("#pm-type").value,
        unit: box.querySelector("#pm-unit").value.trim() || "un", supplier: box.querySelector("#pm-supplier").value.trim(),
        currentStock: parseFloat(box.querySelector("#pm-stock").value) || 0, minStock: parseFloat(box.querySelector("#pm-min").value) || 0,
        costPrice: Utils.moneyMaskToFloat(box.querySelector("#pm-cost")),
        salePrice: box.querySelector("#pm-sale").value ? Utils.moneyMaskToFloat(box.querySelector("#pm-sale")) : null,
        packageUnit: packageUnitVal || null, packageSize: packageUnitVal ? packageSizeVal : null
      };
      if (p) { DB.update("products", p.id, patch); DB.log("Estoque", "Atualizou o produto " + name); Toast.show("Produto atualizado", "success"); }
      else { DB.insert("products", patch); DB.log("Estoque", "Cadastrou o produto " + name); Toast.show("Produto cadastrado", "success"); }
      Modal.close();
      renderProducts();
    });
  }

  function openMoveModal(productId) {
    var p = DB.get("products", productId);
    if (!p) return;
    var costCenters = DB.all("costCenters");
    // Quando o produto tem embalagem cadastrada (ver Novo/Editar Produto),
    // a quantidade é digitada direto na unidade natural (g/ml) — sem exigir
    // que a pessoa calcule a fração de embalagem (ex.: 0,600 para 600g).
    // A conversão para "unidades de embalagem" (o que currentStock guarda)
    // acontece só na hora de salvar, igual já é feito em Consumo.register.
    var hasPkg = Number(p.packageSize) > 0 && (p.packageUnit === "ml" || p.packageUnit === "g");
    var qtyLabel = hasPkg ? ("Quantidade (" + p.packageUnit + ")") : "Quantidade";
    var body = '<p class="small text-muted mb-16">Estoque atual: <strong>' + Utils.fmtNumber(p.currentStock, 2) + ' ' + p.unit + '</strong> · Mínimo: ' + p.minStock + ' ' + p.unit + '</p>' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>Tipo de Movimento</label><select id="mm-type"><option value="entrada">Entrada</option><option value="saida">Saída</option></select></div>' +
      '<div class="form-field"><label>Motivo</label><select id="mm-reason">' +
        '<option value="compra">Compra</option><option value="uso_interno">Uso Interno</option><option value="venda">Venda</option><option value="ajuste">Ajuste</option><option value="perda">Perda</option>' +
      '</select></div>' +
      '<div class="form-field"><label>Data</label><input type="date" id="mm-date" value="' + Utils.todayISO() + '"></div>' +
      '<div class="form-field"><label>' + qtyLabel + '</label><input type="number" step="' + (hasPkg ? "1" : "0.01") + '" min="0.01" id="mm-qty" value="' + (hasPkg ? "" : "1") + '"' + (hasPkg ? ' placeholder="Ex: 250"' : "") + '>' +
        (hasPkg ? '<div class="small text-muted mt-4" id="mm-qty-hint">1 ' + p.unit + ' = ' + p.packageSize + ' ' + p.packageUnit + '</div>' : "") +
      '</div>' +
      '<div class="form-field full"><label>Observações</label><input type="text" id="mm-notes" placeholder="Opcional"></div>' +
      '<div class="form-field full checkbox-wrap"><input type="checkbox" id="mm-financial" checked><label for="mm-financial" style="font-weight:600;">Gerar lançamento financeiro correspondente</label></div>' +
      '<div class="form-field" id="mm-cc-wrap"><label>Centro de Custo</label><select id="mm-cc">' + costCenters.map(function (c) { return '<option value="' + c.id + '">' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="mm-save">Registrar Movimento</button>';
    var box = Modal.open({ title: "Movimentar Estoque — " + p.name, bodyHtml: body, footHtml: foot });

    var qtyEl = box.querySelector("#mm-qty");
    var qtyHintEl = box.querySelector("#mm-qty-hint");
    if (hasPkg && qtyHintEl) {
      qtyEl.addEventListener("input", function () {
        var raw = parseFloat(qtyEl.value) || 0;
        var pkgUnits = raw / p.packageSize;
        qtyHintEl.textContent = raw > 0
          ? ("= " + Utils.fmtNumber(pkgUnits, 3) + " " + p.unit + " no estoque (de " + Utils.fmtNumber(p.currentStock, 2) + " " + p.unit + " disponíveis)")
          : ("1 " + p.unit + " = " + p.packageSize + " " + p.packageUnit);
      });
    }

    box.querySelector("#mm-save").addEventListener("click", function () {
      var type = box.querySelector("#mm-type").value;
      var reason = box.querySelector("#mm-reason").value;
      var qtyRaw = parseFloat(qtyEl.value);
      var date = box.querySelector("#mm-date").value;
      if (!qtyRaw || qtyRaw <= 0) { Toast.show("Informe uma quantidade válida", "danger"); return; }
      // qty (em "unidades de embalagem") é o que efetivamente move o
      // estoque e entra no cálculo financeiro; qtyRaw é o que a pessoa
      // digitou (natural, g/ml quando aplicável) — só para exibição/log.
      var qty = hasPkg ? round2(qtyRaw / p.packageSize) : qtyRaw;
      if (type === "saida" && qty > p.currentStock) {
        Toast.show("Quantidade maior que o estoque disponível", "danger"); return;
      }
      var delta = type === "entrada" ? qty : -qty;
      DB.update("products", p.id, { currentStock: round2(p.currentStock + delta) });
      var mvPatch = { productId: p.id, type: type, quantity: qty, reason: reason, date: date, notes: box.querySelector("#mm-notes").value.trim() };
      if (hasPkg) { mvPatch.displayQuantity = qtyRaw; mvPatch.displayUnit = p.packageUnit; }
      var mv = DB.insert("stockMovements", mvPatch);

      var wantsFinancial = box.querySelector("#mm-financial").checked;
      if (wantsFinancial && (reason === "compra" || reason === "venda")) {
        var categories = DB.all("categories");
        var isCompra = reason === "compra";
        var catName = isCompra ? (p.type === "uso_interno" ? "Produtos e Insumos" : "Produtos para Revenda (compra)") : "Venda de Produtos";
        var cat = categories.find(function (c) { return c.name === catName; });
        var amount = isCompra ? round2(qty * p.costPrice) : round2(qty * (p.salePrice || p.costPrice));
        DB.insert("transactions", {
          type: isCompra ? "despesa" : "receita",
          description: (isCompra ? "Compra de estoque - " : "Venda de produto - ") + p.name + " (x" + (hasPkg ? (qtyRaw + p.packageUnit) : qty) + ")",
          amount: amount, date: date, categoryId: cat ? cat.id : null,
          costCenterId: box.querySelector("#mm-cc").value, paymentMethod: isCompra ? "Boleto" : "Dinheiro",
          status: "pago", productId: p.id, reconciled: false
        });
      }
      var logQty = hasPkg ? (qtyRaw + " " + p.packageUnit) : (qty + " " + p.unit);
      DB.log("Estoque", (type === "entrada" ? "Registrou entrada" : "Registrou saída") + " de " + logQty + " — " + p.name + " (" + reasonLabel(reason).replace(/<[^>]+>/g, "") + ")");
      Modal.close();
      Toast.show("Movimentação registrada", "success");
      renderProducts(); renderMoves();
    });
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function exportCSV() {
    var products = getProducts();
    var header = ["Produto", "SKU", "Tipo", "Unidade", "Estoque Atual", "Estoque Mínimo", "Preço Custo", "Preço Venda", "Fornecedor"];
    var rows = products.map(function (p) {
      return [p.name, p.sku, p.type, p.unit, p.currentStock, p.minStock, p.costPrice, p.salePrice || "", p.supplier];
    });
    var csv = [header].concat(rows).map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(";"); }).join("\n");
    Utils.downloadFile("estoque_" + Utils.todayISO() + ".csv", "﻿" + csv, "text/csv;charset=utf-8");
    Toast.show("CSV exportado", "success");
  }
})();
