(function () {
  "use strict";

  var filters = { type: "", status: "pendente" };
  var selected = {}; // id -> true, only tracks pending items currently checked

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    // A geração automática (lembrete de véspera a partir das 17h + alerta
    // de cliente ausente por recorrência) já roda em toda página do
    // sistema — ver assets/js/layout.js. Esta tela só acompanha o que os
    // robôs já colocaram na fila (e, para confirmação/lembrete, dispara o
    // envio manual via wa.me).

    Utils.qs("#nt-type").addEventListener("change", function (e) { filters.type = e.target.value; render(); });
    Utils.qs("#nt-status").addEventListener("change", function (e) { filters.status = e.target.value; selected = {}; render(); });

    Utils.qs("#nt-select-all").addEventListener("change", function (e) {
      var pending = getItems().filter(function (n) { return n.status === "pendente"; });
      if (e.target.checked) pending.forEach(function (n) { selected[n.id] = true; });
      else selected = {};
      render();
    });

    Utils.qs("#nt-bulk-open").addEventListener("click", function () {
      var ids = Object.keys(selected);
      if (!ids.length) return;
      var opened = 0, skipped = 0;
      ids.forEach(function (id) {
        var n = DB.get("notifications", id);
        if (!n || n.status !== "pendente") return;
        var link = Notificacoes.linkFor(n);
        if (!link) { skipped++; return; }
        window.open(link, "_blank", "noopener");
        Notificacoes.markSent(id);
        opened++;
      });
      selected = {};
      var msg = "Abertos " + opened + " WhatsApp(s)" + (skipped ? " — " + skipped + " sem telefone cadastrado" : "");
      Toast.show(msg, opened ? "success" : "danger");
      if (opened > 1) Toast.show("Se o navegador bloquear as abas extras, permita pop-ups para este site e tente novamente.", "info");
      render();
    });

    Utils.qs("#nt-bulk-dismiss").addEventListener("click", function () {
      var ids = Object.keys(selected);
      if (!ids.length) return;
      Modal.confirm({
        title: "Dispensar notificações selecionadas",
        message: "Dispensar " + ids.length + " notificação(ões) selecionada(s) sem enviar?",
        danger: true,
        onConfirm: function () {
          ids.forEach(function (id) { Notificacoes.dismiss(id); });
          selected = {};
          Toast.show("Notificações dispensadas", "info");
          render();
        }
      });
    });

    render();
  }

  function getItems() {
    return DB.all("notifications").filter(function (n) {
      if (filters.type && n.type !== filters.type) return false;
      if (filters.status && n.status !== filters.status) return false;
      return true;
    }).sort(function (a, b) {
      return (b.createdDate || "").localeCompare(a.createdDate || "") || (b.createdAt || "").localeCompare(a.createdAt || "");
    });
  }

  function render() {
    var all = DB.all("notifications");
    var pendentes = all.filter(function (n) { return n.status === "pendente"; });
    document.getElementById("nt-kpis").innerHTML = [
      kpi("Pendentes", String(pendentes.length), "fa-clock", "#b7791f", "#fdf2df"),
      kpi("Confirmações", String(pendentes.filter(function (n) { return n.type === "confirmacao"; }).length), "fa-calendar-check", "#2a78d6", "#e3eefb"),
      kpi("Lembretes de Véspera", String(pendentes.filter(function (n) { return n.type === "lembrete"; }).length), "fa-bell", "#b7791f", "#fdf2df"),
      kpi("Clientes Ausentes", String(pendentes.filter(function (n) { return n.type === "inatividade"; }).length), "fa-user-clock", "#c23b3b", "#fbe6e6"),
      kpi("Pedidos de Avaliação", String(pendentes.filter(function (n) { return n.type === "avaliacao"; }).length), "fa-star", "#b8923f", "#f6ecd3"),
      kpi("Pagamentos do Dia", String(pendentes.filter(function (n) { return n.type === "pagamento_admin"; }).length), "fa-sack-dollar", "#1baf7a", "#e2f5ec"),
      kpi("Já Enviadas", String(all.filter(function (n) { return n.status === "enviada"; }).length), "fa-circle-check", "#1baf7a", "#e2f5ec")
    ].join("");

    var items = getItems();
    var listEl = document.getElementById("nt-list");
    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-comment-dots"></i></div>' +
        '<h4>Nenhuma notificação encontrada</h4><p>Ajuste os filtros ou aguarde novos agendamentos/alertas serem gerados.</p></div>';
      return;
    }

    // Só faz sentido selecionar itens pendentes (enviadas/dispensadas não
    // têm ação em lote) — descarta seleção de qualquer id que não esteja
    // mais na lista de pendentes visível (ex.: filtro mudou).
    var pendingIds = {};
    items.forEach(function (n) { if (n.status === "pendente") pendingIds[n.id] = true; });
    Object.keys(selected).forEach(function (id) { if (!pendingIds[id]) delete selected[id]; });

    listEl.innerHTML = items.map(function (n) {
      var recipient = Notificacoes.recipientFor(n);
      var message = Notificacoes.messageFor(n);
      var link = Notificacoes.linkFor(n);
      var statusBadge = n.status === "pendente" ? '<span class="badge badge-warning">Pendente</span>' :
        n.status === "enviada" ? '<span class="badge badge-success">Enviada</span>' : '<span class="badge badge-gray">Dispensada</span>';
      var actions = '<button class="btn btn-sm btn-icon btn-ghost" data-details="' + n.id + '" title="Ver mensagem completa"><i class="fa-solid fa-eye"></i></button>';
      if (n.status === "pendente") {
        actions += (link ? '<a class="btn btn-sm btn-primary" target="_blank" rel="noopener" href="' + link + '" data-mark-sent="' + n.id + '"><i class="fa-solid fa-paper-plane"></i> Abrir WhatsApp</a>' :
          '<span class="small text-danger">Sem telefone cadastrado</span>') +
          '<button class="btn btn-sm btn-ghost" data-dismiss="' + n.id + '" title="Dispensar sem enviar">Dispensar</button>';
      }
      var checkboxHtml = n.status === "pendente"
        ? '<div class="nt-select-cell"><input type="checkbox" class="nt-select" data-select="' + n.id + '"' + (selected[n.id] ? " checked" : "") + '></div>'
        : '<div class="nt-select-cell"></div>';
      return '<div class="nt-row">' +
        '<div class="nt-row-main">' +
          checkboxHtml +
          Utils.avatarHtml(recipient ? recipient.name : "?", recipient ? recipient.photoDataUrl : null) +
          '<div style="min-width:0;">' +
            '<div class="flex items-center gap-8"><span class="font-bold">' + Utils.escapeHtml(recipient ? recipient.name : "Destinatário removido") + '</span>' +
              '<span class="nt-type-badge nt-type-' + n.type + '">' + (Notificacoes.TYPE_LABELS[n.type] || n.type) + '</span></div>' +
            '<div class="nt-msg-preview" title="' + Utils.escapeHtml(message) + '">' + Utils.escapeHtml(message) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center gap-12">' +
          '<div class="small text-muted">' + statusBadge + '<div style="margin-top:2px;">' + Utils.fmtDate(n.createdDate) + '</div></div>' +
          '<div class="nt-actions">' + actions + '</div>' +
        '</div>' +
        '</div>';
    }).join("");

    Utils.qsa("[data-mark-sent]", listEl).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-mark-sent");
        // Marca como enviada assim que o link é aberto — o clique já
        // dispara a navegação para o WhatsApp em outra aba.
        Notificacoes.markSent(id);
        Toast.show("WhatsApp aberto e notificação marcada como enviada", "success");
        setTimeout(render, 150);
      });
    });
    Utils.qsa("[data-dismiss]", listEl).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-dismiss");
        Notificacoes.dismiss(id);
        Toast.show("Notificação dispensada", "info");
        render();
      });
    });
    Utils.qsa("[data-details]", listEl).forEach(function (btn) {
      btn.addEventListener("click", function () { openDetailsModal(btn.getAttribute("data-details")); });
    });
    Utils.qsa("[data-select]", listEl).forEach(function (cb) {
      cb.addEventListener("change", function () {
        var id = cb.getAttribute("data-select");
        if (cb.checked) selected[id] = true; else delete selected[id];
        renderBulkBar();
      });
    });

    renderBulkBar(items);
  }

  // Abre um modal com a mensagem completa (a prévia na lista corta com
  // reticências) — o usuário pode ler tudo antes de decidir enviar, e
  // repetir as mesmas ações (abrir WhatsApp / dispensar) direto daqui.
  function openDetailsModal(id) {
    var n = DB.get("notifications", id);
    if (!n) return;
    var recipient = Notificacoes.recipientFor(n);
    var message = Notificacoes.messageFor(n);
    var link = Notificacoes.linkFor(n);
    var statusLabel = n.status === "pendente" ? "Pendente" : n.status === "enviada" ? "Enviada" : "Dispensada";
    var body =
      '<div class="flex items-center gap-8 mb-16">' +
        Utils.avatarHtml(recipient ? recipient.name : "?", recipient ? recipient.photoDataUrl : null) +
        '<div>' +
          '<div class="font-bold">' + Utils.escapeHtml(recipient ? recipient.name : "Destinatário removido") + '</div>' +
          '<div class="small text-muted">' + (Notificacoes.TYPE_LABELS[n.type] || n.type) + ' · ' + statusLabel + ' · ' + Utils.fmtDate(n.createdDate) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="nt-detail-msg">' + Utils.escapeHtml(message) + '</div>' +
      (recipient && recipient.phone ? '<div class="small text-muted mt-8">Telefone: ' + Utils.escapeHtml(recipient.phone) + '</div>' : '<div class="small text-danger mt-8">Sem telefone cadastrado — não é possível montar o link do WhatsApp.</div>');
    var foot = '<button class="btn btn-secondary" data-close-modal>Fechar</button>';
    if (n.status === "pendente") {
      if (link) foot += '<a class="btn btn-primary" target="_blank" rel="noopener" href="' + link + '" id="ntd-open">Abrir WhatsApp</a>';
      foot += '<button class="btn btn-ghost" id="ntd-dismiss">Dispensar</button>';
    }
    var box = Modal.open({ title: "Notificação", bodyHtml: body, footHtml: foot });
    var openBtn = box.querySelector("#ntd-open");
    if (openBtn) openBtn.addEventListener("click", function () {
      Notificacoes.markSent(id);
      Toast.show("WhatsApp aberto e notificação marcada como enviada", "success");
      Modal.close();
      render();
    });
    var dismissBtn = box.querySelector("#ntd-dismiss");
    if (dismissBtn) dismissBtn.addEventListener("click", function () {
      Notificacoes.dismiss(id);
      Toast.show("Notificação dispensada", "info");
      Modal.close();
      render();
    });
  }

  // `items` (opcional): lista já calculada por render() — evita chamar
  // getItems() de novo (mesmo filtro/ordenação) quando quem chamou já tinha
  // acabado de calculá-la; se não vier (ex.: clique num checkbox), calcula
  // aqui mesmo.
  function renderBulkBar(items) {
    var bar = document.getElementById("nt-bulkbar");
    var count = Object.keys(selected).length;
    var pendingCount = (items || getItems()).filter(function (n) { return n.status === "pendente"; }).length;
    bar.style.display = pendingCount ? "flex" : "none";
    document.getElementById("nt-select-count").textContent = count + " selecionado(s)";
    var openBtn = document.getElementById("nt-bulk-open");
    var dismissBtn = document.getElementById("nt-bulk-dismiss");
    openBtn.disabled = count === 0;
    dismissBtn.disabled = count === 0;
    var selectAll = document.getElementById("nt-select-all");
    selectAll.checked = pendingCount > 0 && count === pendingCount;
    selectAll.indeterminate = count > 0 && count < pendingCount;
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }
})();
