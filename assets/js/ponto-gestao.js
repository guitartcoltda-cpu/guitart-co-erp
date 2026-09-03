/* ============================================================
   Salão ERP — Gestão de Ponto
   Tela de administração dos registros feitos em ponto.html: lista os
   pontos batidos (com a selfie de cada um), permite filtrar por
   funcionário/período/tipo, marcar um registro como conferido ou
   sinalizar algo estranho (com uma nota), e mostra quem ainda não bateu
   entrada hoje entre os funcionários marcados para bater ponto.
   ============================================================ */
(function () {
  "use strict";

  var TYPE_LABELS = {
    entrada: "Entrada",
    saida_almoco: "Saída para Almoço",
    volta_almoco: "Volta do Almoço",
    saida: "Saída"
  };

  var filt = { employeeId: "", start: "", end: "", type: "", onlyFlagged: false };
  var pgSortState = { field: null, dir: "asc" }; // clique no rótulo da coluna para ordenar

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    var empSel = Utils.qs("#pg-employee");
    var employeesWithEntries = {};
    DB.all("timeClockEntries").forEach(function (t) { employeesWithEntries[t.employeeId] = true; });
    DB.all("employees").filter(function (e) { return e.requiresTimeClock; }).forEach(function (e) { employeesWithEntries[e.id] = true; });
    Object.keys(employeesWithEntries).map(function (id) { return DB.get("employees", id); }).filter(Boolean)
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (e) { var o = document.createElement("option"); o.value = e.id; o.textContent = e.name; empSel.appendChild(o); });

    empSel.addEventListener("change", function (ev) { filt.employeeId = ev.target.value; render(); });
    Utils.qs("#pg-start").addEventListener("change", function (ev) { filt.start = ev.target.value; render(); });
    Utils.qs("#pg-end").addEventListener("change", function (ev) { filt.end = ev.target.value; render(); });
    Utils.qs("#pg-type").addEventListener("change", function (ev) { filt.type = ev.target.value; render(); });
    Utils.qs("#pg-only-flagged").addEventListener("change", function (ev) { filt.onlyFlagged = ev.target.checked; render(); });
    Utils.qs("#pg-clear-filters").addEventListener("click", function () {
      filt = { employeeId: "", start: "", end: "", type: "", onlyFlagged: false };
      empSel.value = ""; Utils.qs("#pg-start").value = ""; Utils.qs("#pg-end").value = ""; Utils.qs("#pg-type").value = ""; Utils.qs("#pg-only-flagged").checked = false;
      render();
    });
    Utils.qs("#btn-new-manual-entry").addEventListener("click", openManualEntryModal);

    render();
  }

  // Para o lançamento manual: só quem está ativo e marcado para bater ponto
  // (mesmo critério da tela de Ponto), não o histórico completo de quem já
  // teve algum registro (esse é o critério do filtro acima).
  function activeTimeClockEmployees() {
    return DB.all("employees").filter(function (e) { return e.status === "ativo" && e.requiresTimeClock; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }

  function getEntries() {
    return DB.all("timeClockEntries").filter(function (t) {
      if (filt.employeeId && t.employeeId !== filt.employeeId) return false;
      if (filt.start && t.date < filt.start) return false;
      if (filt.end && t.date > filt.end) return false;
      if (filt.type && t.type !== filt.type) return false;
      if (filt.onlyFlagged && !t.flagged) return false;
      return true;
    }).sort(function (a, b) { return b.timestamp.localeCompare(a.timestamp); });
  }

  function pendingAdjustRequests() {
    if (!window.Approvals) return [];
    return Approvals.listPending().filter(function (a) { return a.type === PontoAjustes.TYPE; });
  }

  function renderSummary() {
    var today = Utils.todayISO();
    var todays = DB.all("timeClockEntries").filter(function (t) { return t.date === today; });
    var flaggedPending = DB.all("timeClockEntries").filter(function (t) { return t.flagged && !t.reviewed; }).length;
    var eligible = activeTimeClockEmployees();
    var enteredToday = {};
    todays.filter(function (t) { return t.type === "entrada"; }).forEach(function (t) { enteredToday[t.employeeId] = true; });
    var missing = eligible.filter(function (e) { return !enteredToday[e.id]; });
    var requestsPending = pendingAdjustRequests().length;

    document.getElementById("pg-summary").innerHTML = [
      kpi("Registros Hoje", String(todays.length), "fa-fingerprint", "#2a78d6", "#e3eefb"),
      kpi("Bateram Entrada Hoje", eligible.length ? (eligible.length - missing.length) + " de " + eligible.length : "0", "fa-user-check", "#1baf7a", "#e2f5ec"),
      kpi("Sinalizados Pendentes", String(flaggedPending), "fa-triangle-exclamation", "#c0392b", "#fbe3e0"),
      kpi("Solicitações de Ajuste", String(requestsPending), "fa-clock-rotate-left", "#7a4fc9", "#ece4f8"),
      kpi("Funcionários no Ponto", String(eligible.length), "fa-users", "#b8923f", "#f6ecd3")
    ].join("");

    var missingCard = document.getElementById("pg-missing-card");
    if (missing.length) {
      missingCard.style.display = "";
      document.getElementById("pg-missing-list").innerHTML = '<div class="chip-list">' +
        missing.map(function (e) { return '<span class="chip">' + Utils.escapeHtml(e.name) + '</span>'; }).join("") + '</div>';
    } else {
      missingCard.style.display = "none";
    }
  }

  function typeBadge(type) {
    var cls = type === "entrada" ? "badge-success" : type === "saida" ? "badge-danger" : "badge-info";
    return '<span class="badge ' + cls + '">' + (TYPE_LABELS[type] || type) + '</span>';
  }

  var ORIGIN_LABELS = { manual: "Lançamento manual", ajuste_aprovado: "Ajuste aprovado" };

  function thumbHtml(t) {
    if (t.selfieDataUrl) return '<div class="ponto-thumb" data-zoom="' + t.id + '" style="background-image:url(\'' + t.selfieDataUrl + '\');"></div>';
    var icon = t.origin === "manual" ? "fa-pen" : t.origin === "ajuste_aprovado" ? "fa-user-check" : "fa-image";
    return '<div class="ponto-thumb ponto-thumb-empty" data-zoom="' + t.id + '" title="' + (ORIGIN_LABELS[t.origin] || "Sem selfie") + '"><i class="fa-solid ' + icon + '"></i></div>';
  }

  function render() {
    renderRequests();
    renderSummary();
    var entries = getEntries();
    var tbl = document.getElementById("tbl-ponto");
    document.getElementById("pg-count-sub").textContent = entries.length + " registro(s)";
    if (!entries.length) {
      Utils.emptyTable(tbl, "fa-fingerprint", "Nenhum registro de ponto encontrado");
      return;
    }
    var pgSortGetters = {
      hora: function (t) { return t.timestamp; },
      tipo: function (t) { return TYPE_LABELS[t.type] || t.type; }
    };
    entries = Utils.sortBy(entries, pgSortState, pgSortGetters);
    tbl.innerHTML = '<thead><tr><th></th>' +
      Utils.thSort("Data", "date", pgSortState) +
      Utils.thSort("Hora", "hora", pgSortState) +
      Utils.thSort("Funcionário", "employeeName", pgSortState) +
      Utils.thSort("Tipo", "tipo", pgSortState) +
      '<th>Conferência</th><th></th></tr></thead><tbody>' +
      entries.map(function (t) {
        var d = new Date(t.timestamp);
        var statusHtml = t.flagged
          ? '<span class="badge badge-danger">Sinalizado</span>'
          : t.reviewed ? '<span class="badge badge-success">Conferido</span>' : '<span class="badge badge-gray">Pendente</span>';
        return '<tr>' +
          '<td>' + thumbHtml(t) + '</td>' +
          '<td class="text-num">' + Utils.fmtDate(t.date) + '</td>' +
          '<td class="text-num">' + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + '</td>' +
          '<td>' + Utils.escapeHtml(t.employeeName || "-") + '</td>' +
          '<td>' + typeBadge(t.type) + (t.origin && ORIGIN_LABELS[t.origin] ? '<div class="small text-muted">' + ORIGIN_LABELS[t.origin] + '</div>' : '') + '</td>' +
          '<td>' + statusHtml + (t.note ? '<div class="small text-muted">' + Utils.escapeHtml(t.note) + '</div>' : '') + '</td>' +
          '<td><div class="flex gap-6">' +
            '<button class="btn btn-icon btn-ghost" data-open="' + t.id + '" title="Ver / conferir"><i class="fa-solid fa-magnifying-glass"></i></button>' +
            '<button class="btn btn-icon btn-ghost" data-del="' + t.id + '" title="Excluir"><i class="fa-solid fa-trash"></i></button>' +
          '</div></td>' +
          '</tr>';
      }).join("") + '</tbody>';

    Utils.wireSortHeaders(tbl, pgSortState, render);
    Utils.qsa("[data-zoom]", tbl).forEach(function (el) { el.addEventListener("click", function () { openReview(el.getAttribute("data-zoom")); }); });
    Utils.qsa("[data-open]", tbl).forEach(function (el) { el.addEventListener("click", function () { openReview(el.getAttribute("data-open")); }); });
    Utils.qsa("[data-del]", tbl).forEach(function (el) { el.addEventListener("click", function () { confirmDeleteEntry(el.getAttribute("data-del")); }); });
  }

  function confirmDeleteEntry(id) {
    var t = DB.get("timeClockEntries", id);
    if (!t) return;
    Modal.confirm({
      title: "Excluir registro de ponto",
      message: "Excluir o registro de " + (t.employeeName || "-") + " (" + (TYPE_LABELS[t.type] || t.type) + " em " + Utils.fmtDate(t.date) + ")? Essa ação não pode ser desfeita — use para limpar lançamentos de teste ou errados.",
      danger: true,
      confirmLabel: "Excluir",
      onConfirm: function () {
        DB.remove("timeClockEntries", id);
        DB.log("Ponto", "Excluiu o registro de ponto de " + (t.employeeName || "-") + " (" + (TYPE_LABELS[t.type] || t.type) + " em " + Utils.fmtDate(t.date) + ")");
        Toast.show("Registro excluído", "success");
        render();
      }
    });
  }

  function openReview(id) {
    var t = DB.get("timeClockEntries", id);
    if (!t) return;
    var e = DB.get("employees", t.employeeId);
    var d = new Date(t.timestamp);
    var hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    var body =
      '<div class="flex items-center gap-16 mb-16">' +
        (t.selfieDataUrl ? '<img src="' + t.selfieDataUrl + '" style="width:160px;height:160px;object-fit:cover;border-radius:var(--radius-md);border:1px solid var(--border-color);">' : Utils.avatarHtml(t.employeeName, e ? e.photoDataUrl : null, "avatar-lg")) +
        '<div>' +
          '<div class="font-bold">' + Utils.escapeHtml(t.employeeName || "-") + '</div>' +
          '<div>' + typeBadge(t.type) + '</div>' +
          (t.origin && ORIGIN_LABELS[t.origin] ? '<div class="small text-muted">' + ORIGIN_LABELS[t.origin] + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="flex gap-16">' +
        '<div class="form-field"><label>Data</label><input type="date" id="pg-date" value="' + t.date + '"></div>' +
        '<div class="form-field"><label>Hora</label><input type="time" id="pg-time" value="' + hh + '"></div>' +
      '</div>' +
      '<div class="small text-muted mt-8 mb-16">Ajuste a data/hora aqui se o registro foi batido errado ou precisa refletir o horário real do atendimento/expediente.</div>' +
      '<div class="form-field full"><label>Observação (opcional)</label><textarea id="pg-note" rows="2">' + Utils.escapeHtml(t.note || "") + '</textarea></div>' +
      '<div class="form-field full checkbox-wrap"><input type="checkbox" id="pg-reviewed" ' + (t.reviewed ? "checked" : "") + '><label for="pg-reviewed" style="font-weight:600;">Marcar como conferido</label></div>';
    var foot =
      '<button class="btn btn-danger" id="pg-delete" style="margin-right:auto;">Excluir</button>' +
      '<button class="btn btn-secondary" data-close-modal>Fechar</button>' +
      '<button class="btn ' + (t.flagged ? "btn-secondary" : "btn-danger") + '" id="pg-flag">' + (t.flagged ? "Remover Sinalização" : "Sinalizar") + '</button>' +
      '<button class="btn btn-primary" id="pg-save">Salvar Alterações</button>';
    var box = Modal.open({ title: "Registro de Ponto", bodyHtml: body, footHtml: foot });

    box.querySelector("#pg-flag").addEventListener("click", function () {
      var note = box.querySelector("#pg-note").value.trim();
      DB.update("timeClockEntries", t.id, { flagged: !t.flagged, note: note || t.note || null });
      DB.log("Ponto", (t.flagged ? "Removeu sinalização" : "Sinalizou") + " o registro de ponto de " + t.employeeName);
      Toast.show(t.flagged ? "Sinalização removida" : "Registro sinalizado", "success");
      Modal.close(); render();
    });
    box.querySelector("#pg-save").addEventListener("click", function () {
      var note = box.querySelector("#pg-note").value.trim();
      var newDate = box.querySelector("#pg-date").value || t.date;
      var newTime = box.querySelector("#pg-time").value || hh;
      var reviewed = box.querySelector("#pg-reviewed").checked;
      var timeChanged = newDate !== t.date || newTime !== hh;
      var patch = {
        date: newDate,
        timestamp: PontoAjustes.buildTimestamp(newDate, newTime),
        note: note || null,
        reviewed: reviewed
      };
      DB.update("timeClockEntries", t.id, patch);
      DB.log("Ponto", (timeChanged ? "Ajustou o horário do registro de ponto de " + t.employeeName + " para " + Utils.fmtDate(newDate) + " " + newTime : "Atualizou o registro de ponto de " + t.employeeName));
      Toast.show("Alterações salvas", "success");
      Modal.close(); render();
    });
    box.querySelector("#pg-delete").addEventListener("click", function () {
      Modal.close();
      confirmDeleteEntry(t.id);
    });
  }

  // ---------------- Lançamento manual ----------------
  function openManualEntryModal() {
    var emps = activeTimeClockEmployees();
    if (!emps.length) { Toast.show("Nenhum funcionário está marcado para bater ponto (Funcionários → editar → \"Bate ponto pelo sistema?\")", "danger", 4500); return; }
    var now = new Date();
    var nowTime = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    var body =
      '<div class="form-field full"><label>Funcionário</label><select id="me-employee">' +
        emps.map(function (e) { return '<option value="' + e.id + '">' + Utils.escapeHtml(e.name) + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="form-field full"><label>Tipo</label><select id="me-type">' +
        Object.keys(TYPE_LABELS).map(function (k) { return '<option value="' + k + '">' + TYPE_LABELS[k] + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="flex gap-16">' +
        '<div class="form-field"><label>Data</label><input type="date" id="me-date" value="' + Utils.todayISO() + '"></div>' +
        '<div class="form-field"><label>Hora</label><input type="time" id="me-time" value="' + nowTime + '"></div>' +
      '</div>' +
      '<div class="form-field full"><label>Motivo (opcional)</label><textarea id="me-reason" rows="2" placeholder="Ex.: esqueceu de bater o ponto na entrada"></textarea></div>';
    var foot =
      '<button class="btn btn-secondary" data-close-modal>Cancelar</button>' +
      '<button class="btn btn-primary" id="me-save">Lançar</button>';
    var box = Modal.open({ title: "Lançar Ponto Manual", bodyHtml: body, footHtml: foot });

    box.querySelector("#me-save").addEventListener("click", function () {
      var employeeId = box.querySelector("#me-employee").value;
      var emp = DB.get("employees", employeeId);
      var type = box.querySelector("#me-type").value;
      var date = box.querySelector("#me-date").value;
      var time = box.querySelector("#me-time").value;
      var reason = box.querySelector("#me-reason").value.trim();
      if (!emp || !date || !time) { Toast.show("Preencha funcionário, data e hora", "danger"); return; }
      var dup = DB.all("timeClockEntries").some(function (x) { return x.employeeId === employeeId && x.date === date && x.type === type; });
      if (dup) { Toast.show("Esse funcionário já tem um registro desse tipo nessa data — edite o registro existente em vez de duplicar.", "danger", 4500); return; }
      DB.insert("timeClockEntries", {
        employeeId: employeeId,
        employeeName: emp.name,
        date: date,
        type: type,
        timestamp: PontoAjustes.buildTimestamp(date, time),
        selfieDataUrl: null,
        reviewed: true,
        origin: "manual",
        note: reason || null
      });
      DB.log("Ponto", "Lançou manualmente o ponto de " + emp.name + " (" + TYPE_LABELS[type] + " em " + Utils.fmtDate(date) + " às " + time + ")" + (reason ? " — Motivo: " + reason : ""));
      Toast.show("Ponto lançado", "success");
      Modal.close(); render();
    });
  }

  // ---------------- Solicitações de ajuste (pedidas pelo funcionário) ----------------
  function renderRequests() {
    var card = document.getElementById("pg-requests-card");
    var list = pendingAdjustRequests();
    if (!list.length) { card.style.display = "none"; return; }
    card.style.display = "";
    var canApprove = window.Approvals && Approvals.canApprove();
    document.getElementById("pg-requests-list").innerHTML = list.map(function (a) {
      var p = a.payload || {};
      var actions = canApprove
        ? '<div class="flex gap-6">' +
            '<button class="btn btn-sm btn-primary" data-approve-req="' + a.id + '">Aprovar</button>' +
            '<button class="btn btn-sm btn-ghost" data-reject-req="' + a.id + '">Recusar</button>' +
          '</div>'
        : '<span class="small text-muted">Aguardando aprovação</span>';
      return '<div class="flex items-center gap-16" style="justify-content:space-between;border-top:1px solid var(--border-color);padding:10px 0;">' +
        '<div>' +
          '<div class="font-bold">' + Utils.escapeHtml(a.summary || "-") + '</div>' +
          (p.reason ? '<div class="small text-muted">Motivo: ' + Utils.escapeHtml(p.reason) + '</div>' : '') +
          '<div class="small text-muted">Solicitado por ' + Utils.escapeHtml(a.requestedByName || "-") + ' · ' + Utils.fmtDateTime(a.createdAt) + '</div>' +
        '</div>' + actions +
      '</div>';
    }).join("");

    Utils.qsa("[data-approve-req]", document.getElementById("pg-requests-list")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-approve-req");
        Approvals.approve(id, PontoAjustes.apply);
        Toast.show("Solicitação aprovada", "success");
        if (window.AppLayout) Approvals.renderBadge(document.getElementById("approvals-badge-slot"));
        render();
      });
    });
    Utils.qsa("[data-reject-req]", document.getElementById("pg-requests-list")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-reject-req");
        Modal.confirm({
          title: "Recusar solicitação", message: "Deseja recusar este pedido de ajuste de ponto?", danger: true,
          onConfirm: function () {
            Approvals.reject(id);
            Toast.show("Solicitação recusada", "info");
            if (window.AppLayout) Approvals.renderBadge(document.getElementById("approvals-badge-slot"));
            render();
          }
        });
      });
    });
  }
})();
