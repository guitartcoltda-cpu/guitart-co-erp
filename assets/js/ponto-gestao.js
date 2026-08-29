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

    render();
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

  function renderSummary() {
    var today = Utils.todayISO();
    var todays = DB.all("timeClockEntries").filter(function (t) { return t.date === today; });
    var flaggedPending = DB.all("timeClockEntries").filter(function (t) { return t.flagged && !t.reviewed; }).length;
    var eligible = DB.all("employees").filter(function (e) { return e.status === "ativo" && e.requiresTimeClock; });
    var enteredToday = {};
    todays.filter(function (t) { return t.type === "entrada"; }).forEach(function (t) { enteredToday[t.employeeId] = true; });
    var missing = eligible.filter(function (e) { return !enteredToday[e.id]; });

    document.getElementById("pg-summary").innerHTML = [
      kpi("Registros Hoje", String(todays.length), "fa-fingerprint", "#2a78d6", "#e3eefb"),
      kpi("Bateram Entrada Hoje", eligible.length ? (eligible.length - missing.length) + " de " + eligible.length : "0", "fa-user-check", "#1baf7a", "#e2f5ec"),
      kpi("Sinalizados Pendentes", String(flaggedPending), "fa-triangle-exclamation", "#c0392b", "#fbe3e0"),
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

  function render() {
    renderSummary();
    var entries = getEntries();
    var tbl = document.getElementById("tbl-ponto");
    document.getElementById("pg-count-sub").textContent = entries.length + " registro(s)";
    if (!entries.length) {
      Utils.emptyTable(tbl, "fa-fingerprint", "Nenhum registro de ponto encontrado");
      return;
    }
    tbl.innerHTML = '<thead><tr><th></th><th>Data</th><th>Hora</th><th>Funcionário</th><th>Tipo</th><th>Conferência</th><th></th></tr></thead><tbody>' +
      entries.map(function (t) {
        var d = new Date(t.timestamp);
        var statusHtml = t.flagged
          ? '<span class="badge badge-danger">Sinalizado</span>'
          : t.reviewed ? '<span class="badge badge-success">Conferido</span>' : '<span class="badge badge-gray">Pendente</span>';
        return '<tr>' +
          '<td><div class="ponto-thumb" data-zoom="' + t.id + '" style="background-image:url(\'' + (t.selfieDataUrl || "") + '\');"></div></td>' +
          '<td class="text-num">' + Utils.fmtDate(t.date) + '</td>' +
          '<td class="text-num">' + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + '</td>' +
          '<td>' + Utils.escapeHtml(t.employeeName || "-") + '</td>' +
          '<td>' + typeBadge(t.type) + '</td>' +
          '<td>' + statusHtml + (t.note ? '<div class="small text-muted">' + Utils.escapeHtml(t.note) + '</div>' : '') + '</td>' +
          '<td><button class="btn btn-icon btn-ghost" data-open="' + t.id + '" title="Ver / conferir"><i class="fa-solid fa-magnifying-glass"></i></button></td>' +
          '</tr>';
      }).join("") + '</tbody>';

    Utils.qsa("[data-zoom]", tbl).forEach(function (el) { el.addEventListener("click", function () { openReview(el.getAttribute("data-zoom")); }); });
    Utils.qsa("[data-open]", tbl).forEach(function (el) { el.addEventListener("click", function () { openReview(el.getAttribute("data-open")); }); });
  }

  function openReview(id) {
    var t = DB.get("timeClockEntries", id);
    if (!t) return;
    var e = DB.get("employees", t.employeeId);
    var d = new Date(t.timestamp);
    var body =
      '<div class="flex items-center gap-16 mb-16">' +
        (t.selfieDataUrl ? '<img src="' + t.selfieDataUrl + '" style="width:160px;height:160px;object-fit:cover;border-radius:var(--radius-md);border:1px solid var(--border-color);">' : Utils.avatarHtml(t.employeeName, e ? e.photoDataUrl : null, "avatar-lg")) +
        '<div>' +
          '<div class="font-bold">' + Utils.escapeHtml(t.employeeName || "-") + '</div>' +
          '<div>' + typeBadge(t.type) + '</div>' +
          '<div class="small text-muted">' + Utils.fmtDate(t.date) + ' às ' + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="form-field full"><label>Observação (opcional)</label><textarea id="pg-note" rows="2">' + Utils.escapeHtml(t.note || "") + '</textarea></div>';
    var foot =
      '<button class="btn btn-secondary" data-close-modal>Fechar</button>' +
      '<button class="btn ' + (t.flagged ? "btn-secondary" : "btn-danger") + '" id="pg-flag">' + (t.flagged ? "Remover Sinalização" : "Sinalizar") + '</button>' +
      '<button class="btn btn-primary" id="pg-review">' + (t.reviewed ? "Marcado como Conferido ✓" : "Marcar como Conferido") + '</button>';
    var box = Modal.open({ title: "Registro de Ponto", bodyHtml: body, footHtml: foot });

    box.querySelector("#pg-flag").addEventListener("click", function () {
      var note = box.querySelector("#pg-note").value.trim();
      DB.update("timeClockEntries", t.id, { flagged: !t.flagged, note: note || t.note || null });
      DB.log("Ponto", (t.flagged ? "Removeu sinalização" : "Sinalizou") + " o registro de ponto de " + t.employeeName);
      Toast.show(t.flagged ? "Sinalização removida" : "Registro sinalizado", "success");
      Modal.close(); render();
    });
    box.querySelector("#pg-review").addEventListener("click", function () {
      var note = box.querySelector("#pg-note").value.trim();
      DB.update("timeClockEntries", t.id, { reviewed: true, note: note || t.note || null });
      DB.log("Ponto", "Conferiu o registro de ponto de " + t.employeeName);
      Toast.show("Registro conferido", "success");
      Modal.close(); render();
    });
  }
})();
