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

  var TYPE_LABELS = PontoCalc.PUNCH_LABELS;

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

    empSel.addEventListener("change", function (ev) { filt.employeeId = ev.target.value; pgEspelhoRef = new Date(); render(); });
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

  function anyTypeLabel(type) {
    return TYPE_LABELS[type] || (PontoCalc.OCCURRENCE_KINDS[type] && PontoCalc.OCCURRENCE_KINDS[type].label) || type;
  }

  function typeBadge(type) {
    if (PontoCalc.isOccurrenceType(type)) {
      var k = PontoCalc.OCCURRENCE_KINDS[type];
      return '<span class="badge ' + k.badge + '"><i class="fa-solid ' + k.icon + '"></i> ' + k.label + '</span>';
    }
    var cls = type === "entrada" ? "badge-success" : type === "saida" ? "badge-danger" : "badge-info";
    return '<span class="badge ' + cls + '">' + (TYPE_LABELS[type] || type) + '</span>';
  }

  var ORIGIN_LABELS = { manual: "Lançamento manual", ajuste_aprovado: "Ajuste aprovado" };

  function attachmentLinkHtml(attachment, extraClass) {
    if (!attachment || !attachment.dataUrl) return "";
    var isImg = (attachment.type || "").indexOf("image/") === 0;
    var openUrl = Utils.dataUrlToBlobUrl(attachment.dataUrl) || attachment.dataUrl;
    return '<a href="' + openUrl + '" target="_blank" rel="noopener" class="' + (extraClass || "small") + '">' +
      '<i class="fa-solid ' + (isImg ? "fa-image" : "fa-file-pdf") + '"></i> ' + Utils.escapeHtml(attachment.name || "Ver anexo") + '</a>';
  }

  function thumbHtml(t) {
    if (t.selfieDataUrl) return '<div class="ponto-thumb" data-zoom="' + t.id + '" style="background-image:url(\'' + t.selfieDataUrl + '\');"></div>';
    if (PontoCalc.isOccurrenceType(t.type)) {
      var k = PontoCalc.OCCURRENCE_KINDS[t.type];
      return '<div class="ponto-thumb ponto-thumb-empty" data-zoom="' + t.id + '" title="' + k.label + '"><i class="fa-solid ' + k.icon + '"></i></div>';
    }
    var icon = t.origin === "manual" ? "fa-pen" : t.origin === "ajuste_aprovado" ? "fa-user-check" : "fa-image";
    return '<div class="ponto-thumb ponto-thumb-empty" data-zoom="' + t.id + '" title="' + (ORIGIN_LABELS[t.origin] || "Sem selfie") + '"><i class="fa-solid ' + icon + '"></i></div>';
  }

  function render() {
    renderRequests();
    renderSummary();
    renderRecentOcorrencias();
    renderEspelho();
    var entries = getEntries();
    var tbl = document.getElementById("tbl-ponto");
    document.getElementById("pg-count-sub").textContent = entries.length + " registro(s)";
    if (!entries.length) {
      Utils.emptyTable(tbl, "fa-fingerprint", "Nenhum registro de ponto encontrado");
      return;
    }
    var pgSortGetters = {
      hora: function (t) { return t.timestamp; },
      tipo: function (t) { return anyTypeLabel(t.type); }
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
          '<td class="text-num">' + (PontoCalc.isOccurrenceType(t.type) ? '-' : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })) + '</td>' +
          '<td>' + Utils.escapeHtml(t.employeeName || "-") + '</td>' +
          '<td>' + typeBadge(t.type) + (t.origin && ORIGIN_LABELS[t.origin] ? '<div class="small text-muted">' + ORIGIN_LABELS[t.origin] + '</div>' : '') + '</td>' +
          '<td>' + statusHtml + (t.note ? '<div class="small text-muted">' + Utils.escapeHtml(t.note) + '</div>' : '') + (t.attachment ? '<div class="mt-4">' + attachmentLinkHtml(t.attachment) + '</div>' : '') + '</td>' +
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
      message: "Excluir o registro de " + (t.employeeName || "-") + " (" + anyTypeLabel(t.type) + " em " + Utils.fmtDate(t.date) + ")? Essa ação não pode ser desfeita — use para limpar lançamentos de teste ou errados.",
      danger: true,
      confirmLabel: "Excluir",
      onConfirm: function () {
        DB.remove("timeClockEntries", id);
        DB.log("Ponto", "Excluiu o registro de ponto de " + (t.employeeName || "-") + " (" + anyTypeLabel(t.type) + " em " + Utils.fmtDate(t.date) + ")");
        Toast.show("Registro excluído", "success");
        render();
      }
    });
  }

  function openReview(id) {
    var t = DB.get("timeClockEntries", id);
    if (!t) return;
    var e = DB.get("employees", t.employeeId);
    var isOcc = PontoCalc.isOccurrenceType(t.type);
    var d = new Date(t.timestamp);
    var hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    var attachHtml = t.attachment ? '<div class="form-field full"><label>Anexo</label>' +
      ((t.attachment.type || "").indexOf("image/") === 0
        ? '<a href="' + (Utils.dataUrlToBlobUrl(t.attachment.dataUrl) || t.attachment.dataUrl) + '" target="_blank" rel="noopener"><img src="' + t.attachment.dataUrl + '" style="max-width:200px;max-height:150px;border-radius:8px;border:1px solid var(--border-color);"></a>'
        : attachmentLinkHtml(t.attachment)) +
      '</div>' : '';
    var body =
      '<div class="flex items-center gap-16 mb-16">' +
        (t.selfieDataUrl ? '<img src="' + t.selfieDataUrl + '" style="width:160px;height:160px;object-fit:cover;border-radius:var(--radius-md);border:1px solid var(--border-color);">' : Utils.avatarHtml(t.employeeName, e ? e.photoDataUrl : null, "avatar-lg")) +
        '<div>' +
          '<div class="font-bold">' + Utils.escapeHtml(t.employeeName || "-") + '</div>' +
          '<div>' + typeBadge(t.type) + '</div>' +
          (t.origin && ORIGIN_LABELS[t.origin] ? '<div class="small text-muted">' + ORIGIN_LABELS[t.origin] + '</div>' : '') +
        '</div>' +
      '</div>' +
      (isOcc
        ? '<div class="form-field"><label>Data</label><input type="date" id="pg-date" value="' + t.date + '"></div>'
        : '<div class="flex gap-16">' +
            '<div class="form-field"><label>Data</label><input type="date" id="pg-date" value="' + t.date + '"></div>' +
            '<div class="form-field"><label>Hora</label><input type="time" id="pg-time" value="' + hh + '"></div>' +
          '</div>' +
          '<div class="small text-muted mt-8 mb-16">Ajuste a data/hora aqui se o registro foi batido errado ou precisa refletir o horário real do atendimento/expediente.</div>'
      ) +
      attachHtml +
      '<div class="form-field full"><label>Observação (opcional)</label><textarea id="pg-note" rows="2">' + Utils.escapeHtml(t.note || "") + '</textarea></div>' +
      '<div class="form-field full checkbox-wrap"><input type="checkbox" id="pg-reviewed" ' + (t.reviewed ? "checked" : "") + '><label for="pg-reviewed" style="font-weight:600;">Marcar como conferido</label></div>';
    var foot =
      '<button class="btn btn-danger" id="pg-delete" style="margin-right:auto;">Excluir</button>' +
      '<button class="btn btn-secondary" data-close-modal>Fechar</button>' +
      '<button class="btn ' + (t.flagged ? "btn-secondary" : "btn-danger") + '" id="pg-flag">' + (t.flagged ? "Remover Sinalização" : "Sinalizar") + '</button>' +
      '<button class="btn btn-primary" id="pg-save">Salvar Alterações</button>';
    var box = Modal.open({ title: isOcc ? "Ocorrência de Ponto" : "Registro de Ponto", bodyHtml: body, footHtml: foot });

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
      var timeEl = box.querySelector("#pg-time");
      var newTime = timeEl ? (timeEl.value || hh) : hh;
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

  // ---------------- Lançamento manual (batida ou ocorrência) ----------------
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
        '<optgroup label="Batida de Ponto">' +
          PontoCalc.PUNCH_TYPES.map(function (k) { return '<option value="' + k + '">' + PontoCalc.PUNCH_LABELS[k] + '</option>'; }).join("") +
        '</optgroup>' +
        '<optgroup label="Ocorrência">' +
          Object.keys(PontoCalc.OCCURRENCE_KINDS).map(function (k) { return '<option value="' + k + '">' + PontoCalc.OCCURRENCE_KINDS[k].label + '</option>'; }).join("") +
        '</optgroup>' +
      '</select></div>' +
      '<div class="flex gap-16" id="me-time-row">' +
        '<div class="form-field"><label>Data</label><input type="date" id="me-date" value="' + Utils.todayISO() + '"></div>' +
        '<div class="form-field"><label>Hora</label><input type="time" id="me-time" value="' + nowTime + '"></div>' +
      '</div>' +
      '<div class="form-field full" id="me-date-only" style="display:none;"><label>Data</label><input type="date" id="me-date2" value="' + Utils.todayISO() + '"></div>' +
      '<div id="me-attach-wrap" style="display:none;">' + Utils.attachmentFieldHtml("me", "Anexo (opcional)") + '</div>' +
      '<div class="form-field full"><label>Motivo (opcional)</label><textarea id="me-reason" rows="2" placeholder="Ex.: esqueceu de bater o ponto na entrada"></textarea></div>';
    var foot =
      '<button class="btn btn-secondary" data-close-modal>Cancelar</button>' +
      '<button class="btn btn-primary" id="me-save">Lançar</button>';
    var box = Modal.open({ title: "Lançar Ponto Manual", bodyHtml: body, footHtml: foot });
    var attachmentCtl = Utils.wireAttachmentField(box, "me", null);
    var typeSel = box.querySelector("#me-type");

    function syncFieldsForType() {
      var isOcc = PontoCalc.isOccurrenceType(typeSel.value);
      box.querySelector("#me-time-row").style.display = isOcc ? "none" : "";
      box.querySelector("#me-date-only").style.display = isOcc ? "" : "none";
      box.querySelector("#me-attach-wrap").style.display = isOcc ? "" : "none";
    }
    typeSel.addEventListener("change", syncFieldsForType);
    syncFieldsForType();

    box.querySelector("#me-save").addEventListener("click", function () {
      var employeeId = box.querySelector("#me-employee").value;
      var emp = DB.get("employees", employeeId);
      var type = typeSel.value;
      var isOcc = PontoCalc.isOccurrenceType(type);
      var date = isOcc ? box.querySelector("#me-date2").value : box.querySelector("#me-date").value;
      var time = isOcc ? "00:00" : box.querySelector("#me-time").value;
      var reason = box.querySelector("#me-reason").value.trim();
      if (!emp || !date || (!isOcc && !time)) { Toast.show("Preencha funcionário, data" + (isOcc ? "" : " e hora"), "danger"); return; }
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
        note: reason || null,
        attachment: isOcc ? (attachmentCtl.get() || null) : undefined
      });
      var typeLabel = isOcc ? PontoCalc.OCCURRENCE_KINDS[type].label : PontoCalc.PUNCH_LABELS[type];
      DB.log("Ponto", "Lançou manualmente " + (isOcc ? "a ocorrência" : "o ponto") + " de " + emp.name + " (" + typeLabel + " em " + Utils.fmtDate(date) + (isOcc ? "" : " às " + time) + ")" + (reason ? " — Motivo: " + reason : ""));
      Toast.show(isOcc ? "Ocorrência lançada" : "Ponto lançado", "success");
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
      var kind = PontoAjustes.effectiveKind(p);
      var kindMeta = PontoCalc.OCCURRENCE_KINDS[kind];
      var icon = kindMeta ? kindMeta.icon : (kind === "ponto_corrigir" ? "fa-pen" : "fa-clock");
      var actions = canApprove
        ? '<div class="flex gap-6">' +
            '<button class="btn btn-sm btn-primary" data-approve-req="' + a.id + '">Aprovar</button>' +
            '<button class="btn btn-sm btn-ghost" data-reject-req="' + a.id + '">Recusar</button>' +
          '</div>'
        : '<span class="small text-muted">Aguardando aprovação</span>';
      return '<div class="ponto-request-row">' +
        '<div class="ponto-request-icon"><i class="fa-solid ' + icon + '"></i></div>' +
        '<div class="ponto-request-body">' +
          '<div class="font-bold">' + Utils.escapeHtml(a.summary || "-") + '</div>' +
          (p.reason ? '<div class="small text-muted">Motivo: ' + Utils.escapeHtml(p.reason) + '</div>' : '') +
          '<div class="small text-muted">Solicitado por ' + Utils.escapeHtml(a.requestedByName || "-") + ' · ' + Utils.fmtDateTime(a.createdAt) + '</div>' +
          (p.attachment ? '<div class="mt-4">' + attachmentLinkHtml(p.attachment) + '</div>' : '') +
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

  // ---------------- Ocorrências recentes (falta, atestado, folga...) ----------------
  function renderRecentOcorrencias() {
    var card = document.getElementById("pg-occorrencias-card");
    if (!card) return;
    var list = DB.all("timeClockEntries").filter(function (t) { return PontoCalc.isOccurrenceType(t.type); })
      .sort(function (a, b) { return (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""); })
      .slice(0, 8);
    if (!list.length) { card.style.display = "none"; return; }
    card.style.display = "";
    document.getElementById("pg-occorrencias-list").innerHTML = list.map(function (t) {
      var k = PontoCalc.OCCURRENCE_KINDS[t.type] || {};
      return '<div class="ponto-request-row">' +
        '<div class="ponto-request-icon"><i class="fa-solid ' + (k.icon || "fa-circle-info") + '"></i></div>' +
        '<div class="ponto-request-body">' +
          '<div class="font-bold">' + (k.label || t.type) + ' — ' + Utils.escapeHtml(t.employeeName || "-") + '</div>' +
          '<div class="small text-muted">' + Utils.fmtDate(t.date) + (t.note ? ' · ' + Utils.escapeHtml(t.note) : '') + '</div>' +
          (t.attachment ? '<div class="mt-4">' + attachmentLinkHtml(t.attachment) + '</div>' : '') +
        '</div>' +
        '<button class="btn btn-icon btn-ghost" data-view-occ="' + t.id + '" title="Ver"><i class="fa-solid fa-magnifying-glass"></i></button>' +
      '</div>';
    }).join("");
    Utils.qsa("[data-view-occ]", document.getElementById("pg-occorrencias-list")).forEach(function (btn) {
      btn.addEventListener("click", function () { openReview(btn.getAttribute("data-view-occ")); });
    });
  }

  // ---------------- Espelho de Ponto (só quando um funcionário está filtrado) ----------------
  var pgEspelhoRef = new Date();

  function pgHhmm(rec) { return rec ? new Date(rec.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "-"; }

  function pgDayRowHtml(d) {
    if (d.occurrence) {
      var kind = PontoCalc.OCCURRENCE_KINDS[d.occurrence.type] || {};
      return '<tr>' +
        '<td class="text-num">' + Utils.fmtDate(d.date) + '</td>' +
        '<td colspan="5"><span class="badge ' + (kind.badge || "badge-gray") + '"><i class="fa-solid ' + (kind.icon || "fa-circle-info") + '"></i> ' + (kind.label || d.occurrence.type) + '</span>' +
          (d.occurrence.note ? '<span class="small text-muted"> — ' + Utils.escapeHtml(d.occurrence.note) + '</span>' : '') +
        '</td>' +
        '<td class="text-num">0h00</td>' +
      '</tr>';
    }
    var statusBadge = d.status === "em_andamento" ? '<span class="badge badge-info">Em andamento</span>' : d.status === "incompleto" ? '<span class="badge badge-warning">Incompleto</span>' : "";
    return '<tr>' +
      '<td class="text-num">' + Utils.fmtDate(d.date) + '</td>' +
      '<td class="text-num">' + pgHhmm(d.entrada) + '</td>' +
      '<td class="text-num">' + (d.saidaAlmoco || d.voltaAlmoco ? pgHhmm(d.saidaAlmoco) + ' → ' + pgHhmm(d.voltaAlmoco) : '-') + '</td>' +
      '<td class="text-num">' + pgHhmm(d.saida) + '</td>' +
      '<td class="text-num">' + (d.workedMin != null ? PontoCalc.fmtHM(d.workedMin) : "-") + (statusBadge ? '<div>' + statusBadge + '</div>' : '') + '</td>' +
      '<td class="text-num">' + (d.workedMin != null ? '+' + PontoCalc.fmtHM(d.extraMin) + ' / -' + PontoCalc.fmtHM(d.missingMin) : '-') + '</td>' +
      '<td class="text-num ' + (d.workedMin != null ? (d.saldoMin < 0 ? "text-danger" : "text-success") : "") + '">' + (d.workedMin != null ? PontoCalc.fmtHM(d.saldoMin) : "-") + '</td>' +
    '</tr>';
  }

  function renderEspelho() {
    var card = document.getElementById("pg-espelho-card");
    if (!card) return;
    var emp = filt.employeeId ? DB.get("employees", filt.employeeId) : null;
    if (!emp) { card.style.display = "none"; return; }
    card.style.display = "";
    var range = PontoCalc.monthRange(pgEspelhoRef);
    var monthLabel = range.label.charAt(0).toUpperCase() + range.label.slice(1);
    var data = PontoCalc.espelho(emp.id, range.start, range.end, emp);
    var rowsHtml = data.days.length ? data.days.map(pgDayRowHtml).join("") :
      '<tr><td colspan="7" class="text-center text-muted" style="padding:20px;">Nenhum registro neste mês</td></tr>';

    card.innerHTML =
      '<div class="card-header"><div><h3>Espelho de Ponto — ' + Utils.escapeHtml(emp.name) + '</h3>' +
        '<div class="card-header-sub">Carga horária diária: ' + (PontoCalc.dailyExpectedMin(emp) / 60) + 'h</div></div>' +
        '<div class="flex items-center gap-8">' +
          '<button class="btn btn-icon btn-ghost btn-sm" id="pge-prev" title="Mês anterior"><i class="fa-solid fa-chevron-left"></i></button>' +
          '<div class="small font-bold" style="min-width:130px;text-align:center;">' + monthLabel + '</div>' +
          '<button class="btn btn-icon btn-ghost btn-sm" id="pge-next" title="Próximo mês"><i class="fa-solid fa-chevron-right"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="table-wrap"><table class="data-table"><thead><tr>' +
          '<th>Data</th><th>Entrada</th><th>Almoço</th><th>Saída</th><th>Trabalhado</th><th>Extras / Faltantes</th><th>Saldo</th>' +
        '</tr></thead><tbody>' + rowsHtml + '</tbody>' +
        (data.days.length ? '<tfoot><tr class="ponto-espelho-totals">' +
          '<td colspan="4">Total do mês</td>' +
          '<td class="text-num">' + PontoCalc.fmtHM(data.totals.workedMin) + '</td>' +
          '<td class="text-num">+' + PontoCalc.fmtHM(data.totals.extraMin) + ' / -' + PontoCalc.fmtHM(data.totals.missingMin) + '</td>' +
          '<td class="text-num ' + (data.totals.saldoMin < 0 ? "text-danger" : "text-success") + '">' + PontoCalc.fmtHM(data.totals.saldoMin) + '</td>' +
        '</tr></tfoot>' : "") +
        '</table></div>' +
      '</div>';

    document.getElementById("pge-prev").addEventListener("click", function () {
      pgEspelhoRef = new Date(pgEspelhoRef.getFullYear(), pgEspelhoRef.getMonth() - 1, 1);
      renderEspelho();
    });
    document.getElementById("pge-next").addEventListener("click", function () {
      pgEspelhoRef = new Date(pgEspelhoRef.getFullYear(), pgEspelhoRef.getMonth() + 1, 1);
      renderEspelho();
    });
  }
})();
