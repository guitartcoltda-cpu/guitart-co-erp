(function () {
  "use strict";

  var PAGE_SIZE = 25;
  var state = { page: 1, type: "", start: "", end: "", cc: "", cat: "", status: "", search: "" };
  var selected = {}; // txn id -> true; only tracks the currently rendered page/filter set

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    var today = Utils.todayISO();
    state.start = today.slice(0, 8) + "01";
    state.end = today;
    Utils.qs("#f-start").value = state.start;
    Utils.qs("#f-end").value = state.end;

    fillSelect("#f-cc", DB.all("costCenters"), "id", "name");
    fillSelect("#f-cat", DB.all("categories"), "id", "name");

    Utils.qsa(".tab-btn", document.getElementById("type-tabs")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        Utils.qsa(".tab-btn", document.getElementById("type-tabs")).forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.type = btn.getAttribute("data-type");
        state.page = 1;
        render();
      });
    });

    Utils.qs("#f-start").addEventListener("change", function (e) { state.start = e.target.value; state.page = 1; render(); });
    Utils.qs("#f-end").addEventListener("change", function (e) { state.end = e.target.value; state.page = 1; render(); });
    Utils.qs("#f-cc").addEventListener("change", function (e) { state.cc = e.target.value; state.page = 1; render(); });
    Utils.qs("#f-cat").addEventListener("change", function (e) { state.cat = e.target.value; state.page = 1; render(); });
    Utils.qs("#f-status").addEventListener("change", function (e) { state.status = e.target.value; state.page = 1; render(); });
    Utils.qs("#f-search").addEventListener("input", Utils.debounce(function (e) { state.search = e.target.value.toLowerCase(); state.page = 1; render(); }, 250));
    Utils.qs("#btn-clear-filters").addEventListener("click", function () {
      state = { page: 1, type: "", start: "", end: "", cc: "", cat: "", status: "", search: "" };
      Utils.qs("#f-start").value = ""; Utils.qs("#f-end").value = "";
      Utils.qs("#f-cc").value = ""; Utils.qs("#f-cat").value = ""; Utils.qs("#f-status").value = ""; Utils.qs("#f-search").value = "";
      Utils.qsa(".tab-btn", document.getElementById("type-tabs")).forEach(function (b, i) { b.classList.toggle("active", i === 0); });
      render();
    });
    Utils.qs("#btn-new-txn").addEventListener("click", function () { openTxnModal(null); });
    Utils.qs("#btn-export-csv").addEventListener("click", exportCSV);

    render();
  }

  function fillSelect(sel, items, valueKey, labelKey) {
    var el = Utils.qs(sel);
    items.forEach(function (it) {
      var o = document.createElement("option");
      o.value = it[valueKey]; o.textContent = it[labelKey];
      el.appendChild(o);
    });
  }

  function getFiltered() {
    var txns = DB.all("transactions");
    return txns.filter(function (t) {
      if (state.type && t.type !== state.type) return false;
      if (state.start && t.date < state.start) return false;
      if (state.end && t.date > state.end) return false;
      if (state.cc && t.costCenterId !== state.cc) return false;
      if (state.cat && t.categoryId !== state.cat) return false;
      if (state.status && t.status !== state.status) return false;
      if (state.search) {
        var clients = DB.all("clients"), employees = DB.all("employees");
        var cli = clients.find(function (c) { return c.id === t.clientId; });
        var emp = employees.find(function (e) { return e.id === t.employeeId; });
        var hay = (t.description + " " + (cli ? cli.name : "") + " " + (emp ? emp.name : "")).toLowerCase();
        if (hay.indexOf(state.search) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""); });
  }

  function render() {
    selected = {};
    var all = getFiltered();
    var categories = DB.all("categories");
    var costCenters = DB.all("costCenters");

    // summary
    var receitas = sum(all.filter(function (t) { return t.type === "receita"; }));
    var despesas = sum(all.filter(function (t) { return t.type === "despesa"; }));
    document.getElementById("fin-summary").innerHTML = [
      kpi("Receitas no período", Utils.fmtMoney(receitas), "fa-arrow-up", "#1baf7a", "#e2f5ec"),
      kpi("Despesas no período", Utils.fmtMoney(despesas), "fa-arrow-down", "#c23b3b", "#fbe6e6"),
      kpi("Saldo no período", Utils.fmtMoney(receitas - despesas), "fa-scale-balanced", "#2a78d6", "#e3eefb"),
      kpi("Lançamentos", String(all.length), "fa-list", "#b8923f", "#f6ecd3")
    ].join("");

    var totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    var pageItems = all.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

    var tbl = document.getElementById("tbl-txn");
    if (!pageItems.length) {
      Utils.emptyTable(tbl, "fa-folder-open", "Nenhum lançamento encontrado", "Ajuste os filtros ou cadastre um novo lançamento.");
      updateBulkBar();
    } else {
      tbl.innerHTML = '<thead><tr><th class="col-check"><input type="checkbox" id="chk-all" title="Selecionar todos os pendentes desta página"></th><th>Data</th><th>Descrição</th><th>Categoria</th><th>Centro de Custo</th><th>Pagamento</th><th>Status</th><th class="text-right">Valor</th><th>Conciliado</th><th></th></tr></thead><tbody>' +
        pageItems.map(function (t) {
          var cat = categories.find(function (c) { return c.id === t.categoryId; });
          var cc = costCenters.find(function (c) { return c.id === t.costCenterId; });
          return '<tr>' +
            '<td class="col-check">' + (t.status === "pendente" ? '<input type="checkbox" class="row-check" data-id="' + t.id + '">' : "") + '</td>' +
            '<td class="text-num">' + Utils.fmtDate(t.date) + '</td>' +
            '<td>' + Utils.escapeHtml(t.description) +
              (t.saleId ? ' <span class="chip chip-sale" data-view-sale="' + t.saleId + '" style="cursor:pointer;" title="Ver todos os itens desta venda"><i class="fa-solid fa-receipt"></i> Venda</span>' : "") +
              (t.attachment ? ' <a href="#" data-view-attachment="' + t.id + '" title="Ver comprovante anexado"><i class="fa-solid fa-paperclip"></i></a>' : "") +
              '</td>' +
            '<td>' + (cat ? '<span class="chip">' + Utils.escapeHtml(cat.name) + '</span>' : "-") + '</td>' +
            '<td>' + Utils.escapeHtml(cc ? cc.name : "-") + '</td>' +
            '<td>' + Utils.escapeHtml(t.paymentMethod || "-") + (t.installments > 1 ? ' <span class="small text-muted">(' + t.installments + 'x)</span>' : "") + '</td>' +
            '<td>' + statusBadge(t.status) + '</td>' +
            '<td class="text-right text-num ' + (t.type === "receita" ? "text-success" : "text-danger") + '">' + (t.type === "receita" ? "+" : "-") + " " + Utils.fmtMoney(t.amount) + '</td>' +
            '<td>' + (t.reconciled ? '<span class="badge badge-success"><i class="fa-solid fa-check"></i> Sim</span>' : '<span class="badge badge-gray">Não</span>') + '</td>' +
            '<td><div class="flex gap-6">' +
              '<button class="btn btn-icon btn-ghost" data-edit="' + t.id + '" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
              '<button class="btn btn-icon btn-ghost" data-del="' + t.id + '" title="Excluir"><i class="fa-solid fa-trash"></i></button>' +
            '</div></td>' +
            '</tr>';
        }).join("") + '</tbody>';

      Utils.qsa("[data-edit]", tbl).forEach(function (b) { b.addEventListener("click", function () { openTxnModal(b.getAttribute("data-edit")); }); });
      wireBulkCheckboxes(tbl);
      Utils.qsa("[data-view-sale]", tbl).forEach(function (b) {
        b.addEventListener("click", function (e) { e.stopPropagation(); viewSaleModal(b.getAttribute("data-view-sale")); });
      });
      Utils.qsa("[data-view-attachment]", tbl).forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.preventDefault(); e.stopPropagation();
          var id = a.getAttribute("data-view-attachment");
          // Abre a aba em branco já no clique (síncrono) para o navegador
          // não bloquear como pop-up — só preenche o destino quando o
          // anexo completo chegar do servidor.
          var win = window.open("", "_blank");
          DB.getAttachmentFull("transactions", id).then(function (full) {
            // Usa blob: URL, não a data: URL direto — desde o Chrome 88 o
            // navegador bloqueia a navegação de uma aba inteira para uma
            // data: URL (fica presa em "about:blank#blocked"). Ver
            // Utils.dataUrlToBlobUrl em utils.js para mais detalhes.
            var openUrl = full && full.dataUrl ? Utils.dataUrlToBlobUrl(full.dataUrl) : null;
            if (openUrl) {
              if (win) win.location.href = openUrl;
            } else {
              if (win) win.close();
              Toast.show("Não foi possível carregar o comprovante", "danger");
            }
          });
        });
      });
      Utils.qsa("[data-del]", tbl).forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-del");
          Modal.confirm({
            title: "Excluir lançamento", message: "Tem certeza que deseja excluir este lançamento? Essa ação não pode ser desfeita.", danger: true,
            onConfirm: function () {
              var txn = DB.get("transactions", id);
              DB.remove("transactions", id);
              if (txn) DB.log("Lançamento", "Excluiu o lançamento \"" + txn.description + "\" (" + Utils.fmtMoney(txn.amount) + ")");
              Toast.show("Lançamento excluído", "success"); render();
            }
          });
        });
      });
    }

    var pag = document.getElementById("txn-pagination");
    pag.innerHTML = '<div>Mostrando ' + pageItems.length + ' de ' + all.length + ' lançamento(s)</div>' +
      '<div class="pg-btns">' +
      '<button class="btn btn-sm btn-secondary" id="pg-prev" ' + (state.page <= 1 ? "disabled" : "") + '>Anterior</button>' +
      '<span style="padding:6px 10px;">Página ' + state.page + ' de ' + totalPages + '</span>' +
      '<button class="btn btn-sm btn-secondary" id="pg-next" ' + (state.page >= totalPages ? "disabled" : "") + '>Próxima</button>' +
      '</div>';
    var prevBtn = document.getElementById("pg-prev"), nextBtn = document.getElementById("pg-next");
    if (prevBtn) prevBtn.addEventListener("click", function () { state.page--; render(); });
    if (nextBtn) nextBtn.addEventListener("click", function () { state.page++; render(); });
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }
  function statusBadge(status) {
    if (status === "pago") return '<span class="badge badge-success">Pago</span>';
    return '<span class="badge badge-warning">Pendente</span>';
  }
  function sum(arr) { return arr.reduce(function (s, t) { return s + t.amount; }, 0); }

  function wireBulkCheckboxes(tbl) {
    var chkAll = tbl.querySelector("#chk-all");
    var rowChecks = Utils.qsa(".row-check", tbl);

    if (!rowChecks.length) {
      if (chkAll) chkAll.disabled = true;
    } else if (chkAll) {
      chkAll.addEventListener("change", function () {
        rowChecks.forEach(function (cb) {
          cb.checked = chkAll.checked;
          selected[cb.getAttribute("data-id")] = chkAll.checked;
        });
        updateBulkBar();
      });
    }

    rowChecks.forEach(function (cb) {
      cb.addEventListener("change", function () {
        selected[cb.getAttribute("data-id")] = cb.checked;
        if (chkAll) {
          var allChecked = rowChecks.every(function (c) { return c.checked; });
          var anyChecked = rowChecks.some(function (c) { return c.checked; });
          chkAll.checked = allChecked;
          chkAll.indeterminate = anyChecked && !allChecked;
        }
        updateBulkBar();
      });
    });

    updateBulkBar();
  }

  function selectedIds() {
    return Object.keys(selected).filter(function (id) { return selected[id]; });
  }

  function updateBulkBar() {
    var bar = document.getElementById("bulk-bar");
    var ids = selectedIds();
    if (!ids.length) { bar.style.display = "none"; bar.innerHTML = ""; return; }
    bar.style.display = "flex";
    bar.innerHTML = '<span>' + ids.length + ' lançamento' + (ids.length === 1 ? "" : "s") + ' selecionado' + (ids.length === 1 ? "" : "s") + '</span>' +
      '<button type="button" class="btn btn-sm btn-primary" id="bulk-mark-paid"><i class="fa-solid fa-check"></i> Marcar selecionados como pago</button>';
    bar.querySelector("#bulk-mark-paid").addEventListener("click", bulkMarkPaid);
  }

  function bulkMarkPaid() {
    var ids = selectedIds();
    if (!ids.length) return;
    var txns = ids.map(function (id) { return DB.get("transactions", id); }).filter(Boolean);
    var total = sum(txns);
    DB.batch(function () {
      txns.forEach(function (t) { DB.update("transactions", t.id, { status: "pago" }); });
    });
    DB.log("Lançamento", "Marcou " + txns.length + " lançamento(s) como pago em lote — total " + Utils.fmtMoney(round2(total)));
    Toast.show(txns.length + " lançamento(s) marcado(s) como pago", "success");
    selected = {};
    render();
  }

  // "Novo Lançamento" abre o cadastro multi-item (um ou mais serviços/
  // produtos na mesma visita); editar um lançamento existente continua
  // usando o formulário de item único de sempre.
  function openTxnModal(id) {
    if (id) return openEditTxnModal(id);
    return openNewTxnModal();
  }

  function openEditTxnModal(id) {
    var record = DB.get("transactions", id);
    var categories = DB.all("categories");
    var costCenters = DB.all("costCenters");
    var clients = DB.all("clients").sort(function (a, b) { return a.name.localeCompare(b.name); });
    var employees = DB.all("employees").filter(function (e) { return e.status === "ativo"; }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    var type = record.type;

    var body =
      '<div class="tabs" style="margin-bottom:16px;" id="modal-type-tabs">' +
        '<button type="button" class="tab-btn ' + (type === "receita" ? "active" : "") + '" data-mtype="receita">Receita</button>' +
        '<button type="button" class="tab-btn ' + (type === "despesa" ? "active" : "") + '" data-mtype="despesa">Despesa</button>' +
      '</div>' +
      '<div class="form-grid">' +
        '<div class="form-field full"><label>Descrição</label><input type="text" id="m-desc" value="' + Utils.escapeHtml(record.description) + '" placeholder="Ex: Corte + Escova - Cliente"></div>' +
        '<div class="form-field"><label>Data</label><input type="date" id="m-date" value="' + record.date + '"></div>' +
        '<div class="form-field"><label>Valor (R$)</label><input type="text" id="m-amount"></div>' +
        '<div class="form-field"><label>Categoria</label><select id="m-cat"></select></div>' +
        '<div class="form-field"><label>Centro de Custo</label><select id="m-cc"></select></div>' +
        '<div class="form-field"><label>Forma de Pagamento</label><select id="m-pay">' +
          ["Pix", "Cartão de Crédito", "Cartão de Débito", "Dinheiro", "Transferência", "Boleto"].map(function (p) {
            return '<option value="' + p + '"' + (record.paymentMethod === p ? " selected" : "") + '>' + p + '</option>';
          }).join("") + '</select></div>' +
        '<div class="form-field" id="m-installments-field" style="display:' + (record.paymentMethod === "Cartão de Crédito" ? "" : "none") + ';"><label>Parcelas</label><select id="m-installments">' +
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (n) { return '<option value="' + n + '"' + ((record.installments || 1) === n ? " selected" : "") + '>' + n + 'x' + (n === 1 ? " (à vista)" : "") + '</option>'; }).join("") + '</select></div>' +
        '<div class="form-field"><label>Status</label><select id="m-status">' +
          '<option value="pago"' + (record.status === "pago" ? " selected" : "") + '>Pago</option>' +
          '<option value="pendente"' + (record.status === "pendente" ? " selected" : "") + '>Pendente</option>' +
          '</select></div>' +
        '<div class="form-field"><label>Cliente (opcional)</label><select id="m-client"><option value="">-</option>' +
          clients.map(function (c) { return '<option value="' + c.id + '"' + (record.clientId === c.id ? " selected" : "") + '>' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select></div>' +
        '<div class="form-field"><label>Funcionário (opcional)</label><select id="m-employee"><option value="">-</option>' +
          employees.map(function (e) { return '<option value="' + e.id + '"' + (record.employeeId === e.id ? " selected" : "") + '>' + Utils.escapeHtml(e.name) + '</option>'; }).join("") + '</select></div>' +
      '</div>' +
      Utils.attachmentFieldHtml("m", "Comprovante (opcional)");

    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="m-save">Salvar Lançamento</button>';

    var box = Modal.open({ title: "Editar Lançamento", bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#m-amount"), record.amount);
    var mAttachment = Utils.wireAttachmentField(box, "m", record.attachment || null);
    // O anexo do cache é "leve" (sem o dataUrl — ver BOOT_VIEW em db.js);
    // busca a versão completa em segundo plano só para corrigir o preview
    // (a gravação em si já está protegida mesmo que o usuário salve antes
    // disso terminar — ver remoteUpsert em db.js).
    if (record.attachment) {
      DB.getAttachmentFull("transactions", id).then(function (full) {
        // Só substitui se o usuário não mexeu no anexo enquanto a busca
        // corria (removeu, ou trocou por outro arquivo) — senão estaríamos
        // desfazendo a ação dele.
        if (full && mAttachment.get() === record.attachment) mAttachment.set(full);
      });
    }

    function populateCatCC(curType) {
      var catSel = box.querySelector("#m-cat");
      var filteredCats = categories.filter(function (c) { return c.type === curType; });
      catSel.innerHTML = filteredCats.map(function (c) { return '<option value="' + c.id + '">' + Utils.escapeHtml(c.name) + '</option>'; }).join("");
      if (record.categoryId && curType === record.type) catSel.value = record.categoryId;
      var ccSel = box.querySelector("#m-cc");
      ccSel.innerHTML = costCenters.map(function (c) { return '<option value="' + c.id + '">' + Utils.escapeHtml(c.name) + '</option>'; }).join("");
      if (record.costCenterId) ccSel.value = record.costCenterId;
      else {
        var firstCat = filteredCats[0];
        if (firstCat) ccSel.value = firstCat.costCenterId;
      }
      catSel.onchange = function () {
        var c = categories.find(function (x) { return x.id === catSel.value; });
        if (c) ccSel.value = c.costCenterId;
      };
    }
    populateCatCC(type);

    Utils.qsa(".tab-btn", box.querySelector("#modal-type-tabs")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        Utils.qsa(".tab-btn", box.querySelector("#modal-type-tabs")).forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        type = btn.getAttribute("data-mtype");
        populateCatCC(type);
      });
    });

    var mPaySel = box.querySelector("#m-pay");
    var mInstField = box.querySelector("#m-installments-field");
    mPaySel.addEventListener("change", function () {
      mInstField.style.display = mPaySel.value === "Cartão de Crédito" ? "" : "none";
    });

    box.querySelector("#m-save").addEventListener("click", function () {
      var desc = box.querySelector("#m-desc").value.trim();
      var amount = Utils.moneyMaskToFloat(box.querySelector("#m-amount"));
      var date = box.querySelector("#m-date").value;
      if (!desc) { Toast.show("Informe uma descrição", "danger"); return; }
      if (!date) { Toast.show("Informe a data", "danger"); return; }
      if (!amount || amount <= 0) { Toast.show("Informe um valor válido", "danger"); return; }

      var payMethod = box.querySelector("#m-pay").value;
      var patch = {
        type: type, description: desc, amount: round2(amount), date: date,
        categoryId: box.querySelector("#m-cat").value, costCenterId: box.querySelector("#m-cc").value,
        paymentMethod: payMethod, status: box.querySelector("#m-status").value,
        clientId: box.querySelector("#m-client").value || null, employeeId: box.querySelector("#m-employee").value || null,
        attachment: mAttachment.get()
      };
      if (payMethod === "Cartão de Crédito") patch.installments = parseInt(box.querySelector("#m-installments").value, 10) || 1;
      else patch.installments = null;

      DB.update("transactions", record.id, patch);
      DB.log("Lançamento", "Atualizou o lançamento \"" + desc + "\" (" + Utils.fmtMoney(amount) + ")");
      Toast.show("Lançamento atualizado", "success");
      Modal.close();
      render();
    });
  }

  // Novo lançamento: aceita um ou mais itens (serviços/produtos) na mesma
  // visita — por exemplo, unha + cabelo + depilação + bebida — em vez de
  // obrigar o usuário a abrir "Novo Lançamento" repetidas vezes. Cada item
  // continua sendo um lançamento independente (com sua própria categoria,
  // centro de custo, profissional e valor — importante para o relatório
  // por centro de custo e para o cálculo de comissão continuar correto por
  // profissional). Quando há mais de um item, todos levam um "saleId" em
  // comum para poderem ser vistos e conferidos como uma venda só; com um
  // único item, é gravado um lançamento simples, sem saleId.
  function openNewTxnModal() {
    var categories = DB.all("categories");
    var costCenters = DB.all("costCenters");
    var clients = DB.all("clients").sort(function (a, b) { return a.name.localeCompare(b.name); });
    var employees = DB.all("employees").filter(function (e) { return e.status === "ativo"; }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    var type = "receita";

    function catsForType(t) { return categories.filter(function (c) { return c.type === t; }); }

    function blankItem() {
      var cats = catsForType(type);
      return { desc: "", categoryId: cats[0] ? cats[0].id : "", costCenterId: cats[0] ? cats[0].costCenterId : "", employeeId: "", amount: "" };
    }

    var items = [blankItem()];

    var body =
      '<div class="tabs" style="margin-bottom:16px;" id="modal-type-tabs">' +
        '<button type="button" class="tab-btn active" data-mtype="receita">Receita</button>' +
        '<button type="button" class="tab-btn" data-mtype="despesa">Despesa</button>' +
      '</div>' +
      '<div class="form-grid mb-16">' +
        '<div class="form-field"><label>Cliente (opcional, aplica-se a todos os itens)</label><select id="tm-client"><option value="">-</option>' +
          clients.map(function (c) { return '<option value="' + c.id + '">' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select></div>' +
        '<div class="form-field"><label>Data</label><input type="date" id="tm-date" value="' + Utils.todayISO() + '"></div>' +
        '<div class="form-field"><label>Forma de Pagamento</label><select id="tm-pay">' +
          ["Pix", "Cartão de Crédito", "Cartão de Débito", "Dinheiro", "Transferência", "Boleto"].map(function (p) { return '<option value="' + p + '">' + p + '</option>'; }).join("") + '</select></div>' +
        '<div class="form-field" id="tm-installments-field" style="display:none;"><label>Parcelas</label><select id="tm-installments">' +
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (n) { return '<option value="' + n + '">' + n + 'x' + (n === 1 ? " (à vista)" : "") + '</option>'; }).join("") + '</select></div>' +
        '<div class="form-field"><label>Status</label><select id="tm-status"><option value="pago">Pago</option><option value="pendente">Pendente</option></select></div>' +
      '</div>' +
      '<div class="small text-muted mb-16" id="tm-installments-note" style="display:none;"><i class="fa-solid fa-circle-info"></i> Parcelamento acima de 3x precisa de autorização de um administrador — a venda será enviada para aprovação em vez de salva na hora.</div>' +
      '<div class="small text-muted mb-16">Adicione um ou mais itens (serviços/produtos) — cada um pode ter descrição, categoria, centro de custo, profissional e valor próprios.</div>' +
      '<div id="tm-items"></div>' +
      '<button type="button" class="btn btn-sm btn-outline" id="tm-add-item"><i class="fa-solid fa-plus"></i> Adicionar item</button>' +
      '<div class="sale-total-bar"><span>Total do lançamento</span><span id="tm-total">R$ 0,00</span></div>' +
      '<div class="divider" style="margin:14px 0;"></div>' +
      Utils.attachmentFieldHtml("tm", "Comprovante (opcional, aplica-se a todos os itens)");

    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="tm-save">Salvar Lançamento</button>';
    var box = Modal.open({ title: "Novo Lançamento", wide: true, bodyHtml: body, footHtml: foot });
    var tmAttachment = Utils.wireAttachmentField(box, "tm");

    function itemRowHtml(item, idx) {
      var filteredCats = catsForType(type);
      return '<div class="sale-item-row" data-item-idx="' + idx + '">' +
        (items.length > 1 ? '<button type="button" class="btn btn-icon btn-ghost si-remove" data-remove-item="' + idx + '" title="Remover item"><i class="fa-solid fa-xmark"></i></button>' : "") +
        '<div class="sale-item-index">Item ' + (idx + 1) + '</div>' +
        '<div class="form-grid">' +
          '<div class="form-field full"><label>Descrição</label><input type="text" class="si-desc" placeholder="Ex: Manicure, Corte, Água de coco..." value="' + Utils.escapeHtml(item.desc) + '"></div>' +
          '<div class="form-field"><label>Categoria</label><select class="si-cat">' +
            filteredCats.map(function (c) { return '<option value="' + c.id + '"' + (item.categoryId === c.id ? " selected" : "") + '>' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select></div>' +
          '<div class="form-field"><label>Centro de Custo</label><select class="si-cc">' +
            costCenters.map(function (c) { return '<option value="' + c.id + '"' + (item.costCenterId === c.id ? " selected" : "") + '>' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select></div>' +
          '<div class="form-field"><label>Profissional (opcional)</label><select class="si-emp"><option value="">-</option>' +
            employees.map(function (e) { return '<option value="' + e.id + '"' + (item.employeeId === e.id ? " selected" : "") + '>' + Utils.escapeHtml(e.name) + '</option>'; }).join("") + '</select></div>' +
          '<div class="form-field"><label>Valor (R$)</label><input type="text" inputmode="numeric" autocomplete="off" placeholder="0,00" class="si-amount" value="' + Utils.escapeHtml(item.amount) + '"></div>' +
        '</div>' +
        '</div>';
    }

    function syncItemsFromDom() {
      Utils.qsa(".sale-item-row", box.querySelector("#tm-items")).forEach(function (row, i) {
        items[i] = {
          desc: row.querySelector(".si-desc").value,
          categoryId: row.querySelector(".si-cat").value,
          costCenterId: row.querySelector(".si-cc").value,
          employeeId: row.querySelector(".si-emp").value,
          amount: row.querySelector(".si-amount").value
        };
      });
    }

    function updateTotal() {
      syncItemsFromDom();
      var total = items.reduce(function (s, it) { return s + Utils.parseMoneyMaskStr(it.amount); }, 0);
      box.querySelector("#tm-total").textContent = Utils.fmtMoney(round2(total));
    }

    function renderItems() {
      var itemsEl = box.querySelector("#tm-items");
      itemsEl.innerHTML = items.map(function (it, idx) { return itemRowHtml(it, idx); }).join("");

      Utils.qsa(".si-cat", itemsEl).forEach(function (sel) {
        sel.addEventListener("change", function () {
          var cat = categories.find(function (c) { return c.id === sel.value; });
          if (cat) {
            var row = sel.closest(".sale-item-row");
            row.querySelector(".si-cc").value = cat.costCenterId;
          }
          updateTotal();
        });
      });
      Utils.qsa(".si-amount", itemsEl).forEach(function (inp) { Utils.wireMoneyMaskListener(inp); inp.addEventListener("input", updateTotal); });
      Utils.qsa(".si-desc, .si-cc, .si-emp", itemsEl).forEach(function (inp) { inp.addEventListener("input", updateTotal); inp.addEventListener("change", updateTotal); });
      Utils.qsa("[data-remove-item]", itemsEl).forEach(function (b) {
        b.addEventListener("click", function () {
          syncItemsFromDom();
          var idx = parseInt(b.getAttribute("data-remove-item"), 10);
          items.splice(idx, 1);
          renderItems();
          updateTotal();
        });
      });
      updateTotal();
    }
    renderItems();

    box.querySelector("#tm-add-item").addEventListener("click", function () {
      syncItemsFromDom();
      items.push(blankItem());
      renderItems();
    });

    // Parcelamento (só faz sentido em Cartão de Crédito): mostra o seletor
    // de parcelas e o aviso de que acima de 3x precisa de aprovação de um
    // administrador (ver Approvals/APPROVAL_APPLY em configuracoes.js).
    var paySel = box.querySelector("#tm-pay");
    var instField = box.querySelector("#tm-installments-field");
    var instSelect = box.querySelector("#tm-installments");
    var instNote = box.querySelector("#tm-installments-note");
    function syncInstallmentsVisibility() {
      var isCredit = paySel.value === "Cartão de Crédito";
      instField.style.display = isCredit ? "" : "none";
      if (!isCredit) instSelect.value = "1";
      instNote.style.display = (isCredit && parseInt(instSelect.value, 10) > 3) ? "" : "none";
    }
    paySel.addEventListener("change", syncInstallmentsVisibility);
    instSelect.addEventListener("change", syncInstallmentsVisibility);
    syncInstallmentsVisibility();

    Utils.qsa(".tab-btn", box.querySelector("#modal-type-tabs")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        Utils.qsa(".tab-btn", box.querySelector("#modal-type-tabs")).forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        type = btn.getAttribute("data-mtype");
        syncItemsFromDom();
        var cats = catsForType(type);
        items = items.map(function (it) {
          var stillValid = cats.some(function (c) { return c.id === it.categoryId; });
          if (stillValid) return it;
          return { desc: it.desc, categoryId: cats[0] ? cats[0].id : "", costCenterId: cats[0] ? cats[0].costCenterId : "", employeeId: it.employeeId, amount: it.amount };
        });
        renderItems();
      });
    });

    box.querySelector("#tm-save").addEventListener("click", function () {
      syncItemsFromDom();
      var date = box.querySelector("#tm-date").value;
      var pay = box.querySelector("#tm-pay").value;
      var status = box.querySelector("#tm-status").value;
      var clientId = box.querySelector("#tm-client").value || null;
      if (!date) { Toast.show("Informe a data", "danger"); return; }

      var validItems = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var amount = Utils.parseMoneyMaskStr(it.amount);
        if (!it.desc.trim() && !amount) continue; // skip fully-empty rows silently
        if (!it.desc.trim()) { Toast.show("Informe a descrição do item " + (i + 1), "danger"); return; }
        if (!amount || amount <= 0) { Toast.show("Informe um valor válido para o item \"" + it.desc + "\"", "danger"); return; }
        if (!it.categoryId || !it.costCenterId) { Toast.show("Selecione categoria e centro de custo para o item \"" + it.desc + "\"", "danger"); return; }
        validItems.push(it);
      }
      if (!validItems.length) { Toast.show("Adicione ao menos um item com descrição e valor", "danger"); return; }

      var isMulti = validItems.length > 1;
      var saleId = isMulti ? DB.uid("venda") : null;
      var total = 0;
      var installments = (pay === "Cartão de Crédito") ? (parseInt(instSelect.value, 10) || 1) : 1;

      function buildRecord(it, idx) {
        var amount = round2(Utils.parseMoneyMaskStr(it.amount));
        total += amount;
        var rec = {
          type: type, description: it.desc.trim(), amount: amount, date: date,
          categoryId: it.categoryId, costCenterId: it.costCenterId,
          paymentMethod: pay, status: status, clientId: clientId,
          employeeId: it.employeeId || null, reconciled: false,
          attachment: tmAttachment.get()
        };
        if (isMulti) { rec.saleId = saleId; rec.saleItemIndex = idx; }
        if (pay === "Cartão de Crédito") rec.installments = installments;
        return rec;
      }

      var records = validItems.map(function (it, idx) { return buildRecord(it, idx); });

      // Parcelamento em cartão de crédito acima de 3x precisa de autorização
      // de um administrador (ou de quem tiver a permissão "Pode aprovar
      // solicitações") — em vez de gravar na hora, a venda vira uma
      // solicitação pendente na aba Aprovações; só é lançada de fato quando
      // aprovada (ver APPROVAL_APPLY em configuracoes.js).
      if (pay === "Cartão de Crédito" && installments > 3) {
        var summary = "Venda em " + installments + "x no crédito — " +
          (records.length > 1 ? records.length + " item(ns), total " : "") +
          Utils.fmtMoney(round2(records.reduce(function (s, r) { return s + r.amount; }, 0))) +
          (clientId ? (" — " + ((DB.get("clients", clientId) || {}).name || "")) : "");
        Approvals.request("parcelamento_venda", summary, { records: records, isMulti: isMulti, saleId: saleId });
        Toast.show("Parcelamento acima de 3x enviado para aprovação de um administrador.", "info", 5000);
        Modal.close();
        render();
        return;
      }

      if (isMulti) {
        DB.batch(function () {
          records.forEach(function (rec) { DB.insert("transactions", rec); });
        });
        DB.log("Lançamento", "Registrou um lançamento com " + records.length + " itens — total " + Utils.fmtMoney(round2(total)));
        Toast.show("Lançamento registrado com " + records.length + " itens", "success");
      } else {
        var rec = records[0];
        DB.insert("transactions", rec);
        DB.log("Lançamento", "Criou o lançamento \"" + rec.description + "\" (" + Utils.fmtMoney(rec.amount) + ")");
        Toast.show("Lançamento criado", "success");
      }
      Modal.close();
      render();
    });
  }

  function viewSaleModal(saleId) {
    var all = DB.all("transactions").filter(function (t) { return t.saleId === saleId; }).sort(function (a, b) { return (a.saleItemIndex || 0) - (b.saleItemIndex || 0); });
    if (!all.length) { Toast.show("Venda não encontrada", "danger"); return; }
    var categories = DB.all("categories"), costCenters = DB.all("costCenters"), employees = DB.all("employees"), clients = DB.all("clients");
    var client = clients.find(function (c) { return c.id === all[0].clientId; });
    var total = sum(all);

    var rowsHtml = all.map(function (t) {
      var cat = categories.find(function (c) { return c.id === t.categoryId; });
      var cc = costCenters.find(function (c) { return c.id === t.costCenterId; });
      var emp = employees.find(function (e) { return e.id === t.employeeId; });
      return '<tr>' +
        '<td>' + Utils.escapeHtml(t.description) + '</td>' +
        '<td>' + (cat ? Utils.escapeHtml(cat.name) : "-") + '</td>' +
        '<td>' + (cc ? Utils.escapeHtml(cc.name) : "-") + '</td>' +
        '<td>' + (emp ? Utils.escapeHtml(emp.name) : "-") + '</td>' +
        '<td class="text-right text-num">' + Utils.fmtMoney(t.amount) + '</td>' +
        '</tr>';
    }).join("");

    var body =
      '<div class="mb-16">' +
        '<div class="flex justify-between small"><span>Data</span><span class="font-bold">' + Utils.fmtDate(all[0].date) + '</span></div>' +
        '<div class="flex justify-between small mt-8"><span>Cliente</span><span class="font-bold">' + Utils.escapeHtml(client ? client.name : "-") + '</span></div>' +
        '<div class="flex justify-between small mt-8"><span>Forma de Pagamento</span><span class="font-bold">' + Utils.escapeHtml(all[0].paymentMethod || "-") + '</span></div>' +
      '</div>' +
      '<table class="data-table">' +
        '<thead><tr><th>Item</th><th>Categoria</th><th>Centro de Custo</th><th>Profissional</th><th class="text-right">Valor</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
        '<tfoot><tr style="font-weight:800;border-top:1px solid var(--border-color);"><td colspan="4">Total (' + all.length + ' ' + (all.length === 1 ? "item" : "itens") + ')</td>' +
        '<td class="text-right text-num">' + Utils.fmtMoney(total) + '</td></tr></tfoot>' +
      '</table>';

    Modal.open({ title: "Venda — " + all.length + " " + (all.length === 1 ? "item" : "itens"), wide: true, bodyHtml: body });
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function exportCSV() {
    var all = getFiltered();
    var categories = DB.all("categories");
    var costCenters = DB.all("costCenters");
    var header = ["Data", "Tipo", "Descrição", "Categoria", "Centro de Custo", "Forma de Pagamento", "Status", "Valor", "Conciliado", "ID da Venda"];
    var rows = all.map(function (t) {
      var cat = categories.find(function (c) { return c.id === t.categoryId; });
      var cc = costCenters.find(function (c) { return c.id === t.costCenterId; });
      return [t.date, t.type, t.description, cat ? cat.name : "", cc ? cc.name : "", t.paymentMethod, t.status, String(t.amount).replace(".", ","), t.reconciled ? "Sim" : "Não", t.saleId || ""];
    });
    var csv = [header].concat(rows).map(function (r) {
      return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(";");
    }).join("\n");
    Utils.downloadFile("lancamentos_" + Utils.todayISO() + ".csv", "﻿" + csv, "text/csv;charset=utf-8");
    Toast.show("CSV exportado", "success");
  }
})();
