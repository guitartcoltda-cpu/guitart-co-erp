/* ============================================================
   Salão ERP — Gestão de Ponto
   Reestruturado em 16/09/2026 a pedido do usuário: a tela passou de uma
   lista única (KPIs + tabela) para 7 abas — Visão Geral, Controle de
   Ponto, Colaboradores, Solicitações, Ocorrências, Banco de Horas e
   Relatórios — cada uma respondendo uma pergunta diferente do gestor
   ("como está tudo?" / "o que aconteceu hoje?" / "quem precisa de
   atenção?" / "quanto cada um tem guardado?"). A proposta completa de
   arquitetura (com o que fica para depois — Escalas/Jornadas e
   Fechamento — e por quê) está salva no projeto:
   claude/proposta-arquitetura-gestao-ponto.md.

   Continua tudo num arquivo só (sem módulos/import, mesmo padrão do
   resto do sistema) — só organizado em seções por aba. O motor de
   cálculo (PontoCalc.espelho/computeDay) e o fluxo de solicitação/
   aprovação (Approvals/PontoAjustes) não mudaram — só como são
   exibidos.
   ============================================================ */
(function () {
  "use strict";

  var TYPE_LABELS = PontoCalc.PUNCH_LABELS;

  var filt = { employeeId: "", start: "", end: "", type: "" };
  var pgQuickFilter = "todos"; // ver QUICK_FILTERS abaixo
  var pgSortState = { field: null, dir: "asc" };
  var pgColFilt = { search: "", role: "", status: "" };
  var pgOccRange = { start: "", end: "" };
  var pgOccQuickFilter = "todas";
  var pgImpactPreset = "mes";
  var pgBancoRangeCtl = null;

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    initTabs();

    var empSel = Utils.qs("#pg-employee");
    var employeesWithEntries = {};
    DB.all("timeClockEntries").forEach(function (t) { employeesWithEntries[t.employeeId] = true; });
    DB.all("employees").filter(function (e) { return e.requiresTimeClock; }).forEach(function (e) { employeesWithEntries[e.id] = true; });
    Object.keys(employeesWithEntries).map(function (id) { return DB.get("employees", id); }).filter(Boolean)
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (e) { var o = document.createElement("option"); o.value = e.id; o.textContent = e.name; empSel.appendChild(o); });

    empSel.addEventListener("change", function (ev) { filt.employeeId = ev.target.value; renderControleDePonto(); });
    Utils.qs("#pg-start").addEventListener("change", function (ev) { filt.start = ev.target.value; renderControleDePonto(); });
    Utils.qs("#pg-end").addEventListener("change", function (ev) { filt.end = ev.target.value; renderControleDePonto(); });
    Utils.qs("#pg-type").addEventListener("change", function (ev) { filt.type = ev.target.value; renderControleDePonto(); });
    Utils.qs("#pg-clear-filters").addEventListener("click", function () {
      filt = { employeeId: "", start: "", end: "", type: "" };
      pgQuickFilter = "todos";
      empSel.value = ""; Utils.qs("#pg-start").value = ""; Utils.qs("#pg-end").value = ""; Utils.qs("#pg-type").value = "";
      renderControleDePonto();
    });
    Utils.qs("#btn-new-manual-entry").addEventListener("click", openManualEntryModal);
    var folhaBtn = Utils.qs("#btn-folha-ponto");
    if (folhaBtn) folhaBtn.addEventListener("click", openFolhaModal);

    var colSearch = Utils.qs("#pg-col-search");
    var colRoleSel = Utils.qs("#pg-col-role");
    DB.getRoles().forEach(function (r) { var o = document.createElement("option"); o.value = r.name; o.textContent = r.name; colRoleSel.appendChild(o); });
    colSearch.addEventListener("input", function (ev) { pgColFilt.search = ev.target.value; renderColaboradores(); });
    colRoleSel.addEventListener("change", function (ev) { pgColFilt.role = ev.target.value; renderColaboradores(); });
    Utils.qs("#pg-col-status").addEventListener("change", function (ev) { pgColFilt.status = ev.target.value; renderColaboradores(); });

    var today = Utils.todayISO();
    pgOccRange = { start: Utils.addDays(today, -29), end: today };
    Utils.qs("#pg-occ-start").value = pgOccRange.start;
    Utils.qs("#pg-occ-end").value = pgOccRange.end;
    Utils.qs("#pg-occ-start").addEventListener("change", function (ev) { pgOccRange.start = ev.target.value; renderOcorrenciasTab(); });
    Utils.qs("#pg-occ-end").addEventListener("change", function (ev) { pgOccRange.end = ev.target.value; renderOcorrenciasTab(); });

    renderAll();
  }

  function renderAll() {
    renderVisaoGeral();
    renderControleDePonto();
    renderColaboradores();
    renderSolicitacoesTab();
    renderOcorrenciasTab();
    renderBancoHorasTab();
  }

  // ---------------- Abas ----------------
  function initTabs() {
    var wrap = document.getElementById("pg-tabs");
    Utils.qsa(".tab-btn", wrap).forEach(function (btn) {
      btn.addEventListener("click", function () {
        Utils.qsa(".tab-btn", wrap).forEach(function (b) { b.classList.remove("active"); });
        Utils.qsa(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        document.getElementById(btn.getAttribute("data-panel")).classList.add("active");
      });
    });
  }

  // Quem conta como "no ponto": ativo e marcado para bater ponto pelo
  // sistema (Funcionários → editar → "Bate ponto pelo sistema?").
  function activeTimeClockEmployees() {
    return DB.all("employees").filter(function (e) { return e.status === "ativo" && e.requiresTimeClock; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }

  function pendingAdjustRequests() {
    if (!window.Approvals) return [];
    return Approvals.listPending().filter(function (a) { return a.type === PontoAjustes.TYPE; });
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

  function thumbHtml(t, cls) {
    var wrapCls = cls || "ponto-thumb";
    if (t.selfieDataUrl) return '<div class="' + wrapCls + '" data-zoom="' + t.id + '" style="background-image:url(\'' + t.selfieDataUrl + '\');"></div>';
    if (PontoCalc.isOccurrenceType(t.type)) {
      var k = PontoCalc.OCCURRENCE_KINDS[t.type];
      return '<div class="' + wrapCls + ' ' + wrapCls + '-empty" data-zoom="' + t.id + '" title="' + k.label + '"><i class="fa-solid ' + k.icon + '"></i></div>';
    }
    var icon = t.origin === "manual" ? "fa-pen" : t.origin === "ajuste_aprovado" ? "fa-user-check" : "fa-image";
    return '<div class="' + wrapCls + ' ' + wrapCls + '-empty" data-zoom="' + t.id + '" title="' + (ORIGIN_LABELS[t.origin] || "Sem selfie") + '"><i class="fa-solid ' + icon + '"></i></div>';
  }

  function pgHhmm(rec) { return rec ? new Date(rec.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "-"; }

  // ================================================================
  // 1) VISÃO GERAL — responde: tudo normal? o que precisa de atenção?
  //    quem está com problema? qual o impacto? o que fazer agora?
  // ================================================================
  function renderVisaoGeral() {
    var today = Utils.todayISO();
    var eligible = activeTimeClockEmployees();
    var allEntries = DB.all("timeClockEntries");
    var todays = allEntries.filter(function (t) { return t.date === today; });

    var enteredToday = {}, occurrenceToday = {}, workingNow = [];
    todays.forEach(function (t) {
      if (t.type === "entrada") enteredToday[t.employeeId] = true;
      if (PontoCalc.isOccurrenceType(t.type)) occurrenceToday[t.employeeId] = true;
    });
    eligible.forEach(function (e) {
      var dayEntries = todays.filter(function (t) { return t.employeeId === e.id; });
      var d = PontoCalc.computeDay(today, dayEntries, e);
      if (d.status === "em_andamento") workingNow.push(e);
    });
    var absentNoRecord = eligible.filter(function (e) { return !enteredToday[e.id] && !occurrenceToday[e.id]; });

    var flaggedPending = allEntries.filter(function (t) { return t.flagged && !t.reviewed; });
    var requestsPending = pendingAdjustRequests();
    var incompleteToday = eligible.filter(function (e) {
      var dayEntries = todays.filter(function (t) { return t.employeeId === e.id; });
      var d = PontoCalc.computeDay(today, dayEntries, e);
      return d.status === "incompleto";
    });
    var occurrencesUnreviewed = allEntries.filter(function (t) { return PontoCalc.isOccurrenceType(t.type) && !t.reviewed; });

    // ---- Bloco 1: status + 4 KPIs ----
    var problems = absentNoRecord.length + flaggedPending.length + requestsPending.length;
    var statusCls = (absentNoRecord.length || flaggedPending.length) ? "danger" : (problems ? "warn" : "ok");
    var statusIcon = statusCls === "ok" ? "fa-circle-check" : statusCls === "warn" ? "fa-triangle-exclamation" : "fa-circle-exclamation";
    var statusMsg = statusCls === "ok" ? "Tudo normal — nenhuma pendência para hoje."
      : (absentNoRecord.length ? absentNoRecord.length + " colaborador(es) sem nenhum registro hoje. " : "") +
        (flaggedPending.length ? flaggedPending.length + " registro(s) sinalizado(s). " : "") +
        (requestsPending.length ? requestsPending.length + " solicitação(ões) esperando decisão." : "");
    document.getElementById("pg-status-bar").innerHTML =
      '<div class="pg-status-bar ' + statusCls + '"><i class="fa-solid ' + statusIcon + '"></i> ' + statusMsg + '</div>' +
      '<div class="kpi-grid" style="margin-bottom:16px;">' +
        kpi("Colaboradores Ativos", String(eligible.length), "fa-users", "#6d5efc", "#ece9ff") +
        kpi("Trabalhando Agora", String(workingNow.length), "fa-person-walking-arrow-right", "#0e9c5b", "#e2f5ec") +
        kpi("Ausentes Hoje", String(absentNoRecord.length), "fa-user-slash", "#c0392b", "#fbe3e0") +
        kpi("Marcações Hoje", String(todays.length), "fa-fingerprint", "#0eb8d9", "#dbf7fc") +
      '</div>';

    // ---- Bloco 2: o que precisa de atenção (lista priorizada, acionável) ----
    var alerts = [];
    absentNoRecord.forEach(function (e) {
      alerts.push({ sev: "sev-high", icon: "fa-user-slash", title: e.name, sub: "Nenhum registro hoje — sem entrada e sem ocorrência lançada",
        actionLabel: "Lançar Ponto", action: function () { openManualEntryModal(e.id); } });
    });
    flaggedPending.forEach(function (t) {
      alerts.push({ sev: "sev-high", icon: "fa-flag", title: t.employeeName, sub: "Registro sinalizado — " + anyTypeLabel(t.type) + " em " + Utils.fmtDate(t.date),
        actionLabel: "Ver", action: function () { openReview(t.id); } });
    });
    requestsPending.forEach(function (a) {
      alerts.push({ sev: "sev-med", icon: "fa-clock-rotate-left", title: a.summary, sub: "Solicitado por " + (a.requestedByName || "-"),
        actionLabel: "Ver", action: function () { activateTab("pg-p-solicitacoes"); } });
    });
    incompleteToday.forEach(function (e) {
      alerts.push({ sev: "sev-med", icon: "fa-hourglass-half", title: e.name, sub: "Ponto incompleto hoje",
        actionLabel: "Ver", action: function () { openDayDetailModal(e.id, today); } });
    });
    occurrencesUnreviewed.slice(0, 10).forEach(function (t) {
      var k = PontoCalc.OCCURRENCE_KINDS[t.type] || {};
      alerts.push({ sev: "sev-low", icon: k.icon || "fa-circle-info", title: t.employeeName, sub: (k.label || t.type) + " ainda não conferida — " + Utils.fmtDate(t.date),
        actionLabel: "Ver", action: function () { openReview(t.id); } });
    });
    var sevRank = { "sev-high": 0, "sev-med": 1, "sev-low": 2 };
    alerts.sort(function (a, b) { return sevRank[a.sev] - sevRank[b.sev]; });
    var shown = alerts.slice(0, 10);
    document.getElementById("pg-alerts-sub").textContent = alerts.length ? alerts.length + " item(ns) precisam de decisão ou conferência" : "Nenhuma pendência agora";
    var alertsBox = document.getElementById("pg-alerts-list");
    if (!shown.length) {
      alertsBox.innerHTML = '<div class="small text-muted" style="padding:8px 0;">Nenhum alerta — a equipe está em dia.</div>';
    } else {
      alertsBox.innerHTML = shown.map(function (a, idx) {
        return '<div class="pg-alert-row"><span class="pg-alert-dot ' + a.sev + '"></span>' +
          '<div class="pg-alert-body"><div class="font-bold"><i class="fa-solid ' + a.icon + '" style="margin-right:6px;color:var(--gray-500);"></i>' + Utils.escapeHtml(a.title) + '</div>' +
          '<div class="small text-muted">' + Utils.escapeHtml(a.sub) + '</div></div>' +
          '<button class="btn btn-sm btn-ghost" data-alert-action="' + idx + '">' + a.actionLabel + '</button></div>';
      }).join("") + (alerts.length > shown.length ? '<div class="small text-muted mt-8">+' + (alerts.length - shown.length) + ' outro(s) — veja as abas Ocorrências e Solicitações.</div>' : "");
      Utils.qsa("[data-alert-action]", alertsBox).forEach(function (btn) {
        btn.addEventListener("click", function () { shown[Number(btn.getAttribute("data-alert-action"))].action(); });
      });
    }

    // ---- Bloco 3: impacto do período ----
    var rangeChips = document.getElementById("pg-impact-range");
    rangeChips.innerHTML = '<div class="pf-chips">' +
      '<button type="button" class="pf-preset-btn' + (pgImpactPreset === "mes" ? " active" : "") + '" data-impact-preset="mes">Este mês</button>' +
      '<button type="button" class="pf-preset-btn' + (pgImpactPreset === "30d" ? " active" : "") + '" data-impact-preset="30d">Últimos 30 dias</button>' +
      '</div>';
    Utils.qsa("[data-impact-preset]", rangeChips).forEach(function (btn) {
      btn.addEventListener("click", function () { pgImpactPreset = btn.getAttribute("data-impact-preset"); renderVisaoGeral(); });
    });
    var impactRange = pgImpactPreset === "30d" ? { start: Utils.addDays(today, -29), end: today } : PontoCalc.monthRange(today);
    var totals = { workedMin: 0, extraMin: 0, missingMin: 0, saldoMin: 0 };
    eligible.forEach(function (e) {
      var data = PontoCalc.espelho(e.id, impactRange.start, impactRange.end, e, allEntries);
      totals.workedMin += data.totals.workedMin;
      totals.extraMin += data.totals.extraMin;
      totals.missingMin += data.totals.missingMin;
      totals.saldoMin += data.totals.saldoMin;
    });
    document.getElementById("pg-impact-sub").textContent = Utils.fmtDate(impactRange.start) + " — " + Utils.fmtDate(impactRange.end);
    var totalBar = totals.extraMin + totals.missingMin;
    var extraPct = totalBar ? Math.round((totals.extraMin / totalBar) * 100) : 0;
    document.getElementById("pg-impact-body").innerHTML =
      '<div class="pg-impact-row">' +
        '<div class="pg-impact-item"><div class="pg-impact-label">Horas Extras</div><div class="pg-impact-value text-success">+' + PontoCalc.fmtHM(totals.extraMin) + '</div></div>' +
        '<div class="pg-impact-item"><div class="pg-impact-label">Horas Faltantes</div><div class="pg-impact-value text-danger">-' + PontoCalc.fmtHM(totals.missingMin) + '</div></div>' +
        '<div class="pg-impact-item"><div class="pg-impact-label">Saldo do Banco de Horas</div><div class="pg-impact-value ' + (totals.saldoMin < 0 ? "text-danger" : "text-success") + '">' + PontoCalc.fmtHM(totals.saldoMin) + '</div></div>' +
      '</div>' +
      (totalBar ? '<div class="pg-impact-bar"><div class="pg-impact-bar-extra" style="width:' + extraPct + '%;"></div><div class="pg-impact-bar-missing" style="width:' + (100 - extraPct) + '%;"></div></div>' : "");
  }

  function activateTab(panelId) {
    var wrap = document.getElementById("pg-tabs");
    var btn = wrap.querySelector('[data-panel="' + panelId + '"]');
    if (!btn) return;
    Utils.qsa(".tab-btn", wrap).forEach(function (b) { b.classList.remove("active"); });
    Utils.qsa(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
    btn.classList.add("active");
    document.getElementById(panelId).classList.add("active");
  }

  // ================================================================
  // 2) CONTROLE DE PONTO — tabela do dia a dia, com filtros rápidos
  // ================================================================
  var QUICK_FILTERS = [
    { key: "todos", label: "TODOS" },
    { key: "trabalhando", label: "TRABALHANDO" },
    { key: "incompleto", label: "PONTO INCOMPLETO" },
    { key: "extras", label: "HORAS EXTRAS" },
    { key: "faltantes", label: "HORAS FALTANTES" },
    { key: "sem_marcacao", label: "SEM MARCAÇÃO" },
    { key: "pendencias", label: "PENDÊNCIAS" }
  ];

  function matchesQuickFilter(row) {
    var d = row.day;
    switch (pgQuickFilter) {
      case "trabalhando": return d.status === "em_andamento";
      case "incompleto": return d.status === "incompleto";
      case "extras": return d.workedMin != null && d.extraMin > 0;
      case "faltantes": return d.workedMin != null && d.missingMin > 0;
      case "pendencias": return row.dayEntries.some(function (t) { return t.flagged || !t.reviewed; });
      default: return true;
    }
  }

  function getEntries() {
    return DB.all("timeClockEntries").filter(function (t) {
      if (filt.employeeId && t.employeeId !== filt.employeeId) return false;
      if (filt.start && t.date < filt.start) return false;
      if (filt.end && t.date > filt.end) return false;
      if (filt.type && t.type !== filt.type) return false;
      return true;
    }).sort(function (a, b) { return b.timestamp.localeCompare(a.timestamp); });
  }

  function dayReviewBadge(dayEntries) {
    if (dayEntries.some(function (t) { return t.flagged; })) return '<span class="badge badge-danger">Sinalizado</span>';
    if (dayEntries.some(function (t) { return !t.reviewed; })) return '<span class="badge badge-gray">Pendente</span>';
    return '<span class="badge badge-success">Conferido</span>';
  }

  function groupEntriesByDay(entries) {
    var byKey = {};
    var order = [];
    entries.forEach(function (t) {
      var key = t.employeeId + "|" + t.date;
      if (!byKey[key]) { byKey[key] = { employeeId: t.employeeId, employeeName: t.employeeName, date: t.date }; order.push(key); }
    });
    var allEntries = DB.all("timeClockEntries");
    return order.map(function (key) {
      var g = byKey[key];
      var employee = DB.get("employees", g.employeeId);
      var dayEntries = allEntries.filter(function (t) { return t.employeeId === g.employeeId && t.date === g.date; });
      return {
        employeeId: g.employeeId,
        employeeName: (employee && employee.name) || g.employeeName || "-",
        employee: employee,
        date: g.date,
        dayEntries: dayEntries,
        day: PontoCalc.computeDay(g.date, dayEntries, employee)
      };
    });
  }

  function pgConsolidatedRowHtml(row) {
    var d = row.day;
    var avatar = Utils.avatarHtml(row.employeeName, row.employee ? row.employee.photoDataUrl : null);
    var nameCell = '<div class="flex items-center gap-8">' + avatar +
      '<div><div>' + Utils.escapeHtml(row.employeeName) + '</div>' + (row.employee && row.employee.role ? '<div class="small text-muted">' + Utils.escapeHtml(row.employee.role) + '</div>' : '') + '</div></div>';
    var reviewBadge = dayReviewBadge(row.dayEntries);
    var openBtn = '<button class="btn btn-icon btn-ghost" data-open-day="' + row.employeeId + '|' + row.date + '" title="Ver marcações detalhadas"><i class="fa-solid fa-magnifying-glass"></i></button>';
    if (d.occurrence) {
      var k = PontoCalc.OCCURRENCE_KINDS[d.occurrence.type] || {};
      return '<tr>' +
        '<td class="text-num">' + Utils.fmtDate(row.date) + '</td>' +
        '<td>' + nameCell + '</td>' +
        '<td colspan="4"><span class="badge ' + (k.badge || "badge-gray") + '"><i class="fa-solid ' + (k.icon || "fa-circle-info") + '"></i> ' + (k.label || d.occurrence.type) + '</span>' +
          (d.occurrence.note ? '<span class="small text-muted"> — ' + Utils.escapeHtml(d.occurrence.note) + '</span>' : '') +
        '</td>' +
        '<td>' + reviewBadge + '</td>' +
        '<td>' + openBtn + '</td>' +
        '</tr>';
    }
    var statusBadge = d.status === "em_andamento" ? '<span class="badge badge-info">Em andamento</span>' : d.status === "incompleto" ? '<span class="badge badge-warning">Incompleto</span>' : "";
    return '<tr>' +
      '<td class="text-num">' + Utils.fmtDate(row.date) + '</td>' +
      '<td>' + nameCell + '</td>' +
      '<td class="text-num">' + pgHhmm(d.entrada) + '</td>' +
      '<td class="text-num">' + (d.saidaAlmoco || d.voltaAlmoco ? pgHhmm(d.saidaAlmoco) + ' → ' + pgHhmm(d.voltaAlmoco) : '-') + '</td>' +
      '<td class="text-num">' + pgHhmm(d.saida) + '</td>' +
      '<td class="text-num">' + (d.workedMin != null ? PontoCalc.fmtHM(d.workedMin) : "-") + (statusBadge ? '<div>' + statusBadge + '</div>' : '') +
        (d.workedMin != null ? '<div class="small ' + (d.saldoMin < 0 ? "text-danger" : "text-success") + '">saldo ' + PontoCalc.fmtHM(d.saldoMin) + '</div>' : '') +
      '</td>' +
      '<td>' + reviewBadge + '</td>' +
      '<td>' + openBtn + '</td>' +
      '</tr>';
  }

  var pgDaySortGetters = {
    date: function (r) { return r.date; },
    employeeName: function (r) { return r.employeeName; }
  };

  function renderQuickFilters(containerId, filters, current, onPick) {
    document.getElementById(containerId).innerHTML = filters.map(function (f) {
      return '<button type="button" class="pf-preset-btn' + (current === f.key ? " active" : "") + '" data-qf="' + f.key + '">' + f.label + '</button>';
    }).join("");
    Utils.qsa("[data-qf]", document.getElementById(containerId)).forEach(function (btn) {
      btn.addEventListener("click", function () { onPick(btn.getAttribute("data-qf")); });
    });
  }

  function renderControleDePonto() {
    renderQuickFilters("pg-quick-filters", QUICK_FILTERS, pgQuickFilter, function (key) { pgQuickFilter = key; renderControleDePonto(); });
    renderMissingToday();

    var tbl = document.getElementById("tbl-ponto");
    var entries = getEntries();
    var rows = groupEntriesByDay(entries);
    rows.sort(function (a, b) { return b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName, "pt-BR"); });

    if (pgQuickFilter === "sem_marcacao") {
      var withEntryInRange = {};
      entries.forEach(function (t) { withEntryInRange[t.employeeId] = true; });
      var noneList = activeTimeClockEmployees().filter(function (e) {
        return (!filt.employeeId || filt.employeeId === e.id) && !withEntryInRange[e.id];
      });
      document.getElementById("pg-count-sub").textContent = noneList.length + " colaborador(es) sem nenhuma marcação no período filtrado";
      if (!noneList.length) {
        Utils.emptyTable(tbl, "fa-fingerprint", "Todos tiveram alguma marcação no período");
      } else {
        tbl.innerHTML = '<thead><tr><th>Funcionário</th><th>Cargo</th><th></th></tr></thead><tbody>' +
          noneList.map(function (e) {
            return '<tr><td><div class="flex items-center gap-8">' + Utils.avatarHtml(e.name, e.photoDataUrl) + Utils.escapeHtml(e.name) + '</div></td>' +
              '<td>' + Utils.escapeHtml(e.role || "-") + '</td>' +
              '<td><button class="btn btn-sm btn-outline" data-qf-manual="' + e.id + '">Lançar Ponto</button></td></tr>';
          }).join("") + '</tbody>';
        Utils.qsa("[data-qf-manual]", tbl).forEach(function (btn) {
          btn.addEventListener("click", function () { openManualEntryModal(btn.getAttribute("data-qf-manual")); });
        });
      }
      return;
    }

    var filteredRows = rows.filter(matchesQuickFilter);
    document.getElementById("pg-count-sub").textContent = filteredRows.length + " dia(s) · " + entries.length + " registro(s) no total";
    if (!filteredRows.length) {
      Utils.emptyTable(tbl, "fa-fingerprint", "Nenhum registro encontrado com esses filtros");
      return;
    }
    filteredRows = Utils.sortBy(filteredRows, pgSortState, pgDaySortGetters);
    tbl.innerHTML = '<thead><tr>' +
      Utils.thSort("Data", "date", pgSortState) +
      Utils.thSort("Funcionário", "employeeName", pgSortState) +
      '<th>Entrada</th><th>Intervalo</th><th>Saída</th><th>Trabalhado / Saldo</th>' +
      '<th>Conferência</th><th></th></tr></thead><tbody>' +
      filteredRows.map(pgConsolidatedRowHtml).join("") + '</tbody>';

    Utils.wireSortHeaders(tbl, pgSortState, renderControleDePonto);
    Utils.qsa("[data-open-day]", tbl).forEach(function (el) {
      el.addEventListener("click", function () {
        var parts = el.getAttribute("data-open-day").split("|");
        openDayDetailModal(parts[0], parts[1]);
      });
    });
  }

  function renderMissingToday() {
    var today = Utils.todayISO();
    var todays = DB.all("timeClockEntries").filter(function (t) { return t.date === today; });
    var eligible = activeTimeClockEmployees();
    var enteredToday = {};
    todays.filter(function (t) { return t.type === "entrada"; }).forEach(function (t) { enteredToday[t.employeeId] = true; });
    var missing = eligible.filter(function (e) { return !enteredToday[e.id]; });
    var missingCard = document.getElementById("pg-missing-card");
    if (missing.length) {
      missingCard.style.display = "";
      document.getElementById("pg-missing-list").innerHTML = '<div class="chip-list">' +
        missing.map(function (e) { return '<span class="chip">' + Utils.escapeHtml(e.name) + '</span>'; }).join("") + '</div>';
    } else {
      missingCard.style.display = "none";
    }
  }

  // ---------------- Marcações do dia — linha do tempo (timeline) ----------------
  // Redesenho pedido pelo usuário (16/09/2026): em vez de uma lista simples
  // de linhas, mostra jornada prevista/realizada no topo e cada marcação
  // como um ponto na timeline (foto, horário, tipo, origem, status).
  // Reaproveitado tanto pelo botão de lupa do Controle de Ponto quanto pela
  // aba "Marcações" do drawer de um colaborador (ver openEmployeeDrawer).
  function timelineItemClass(type) {
    if (type === "saida") return "tl-saida";
    if (type === "saida_almoco" || type === "volta_almoco") return "tl-intervalo";
    return "";
  }

  function statusChipHtml(t) {
    if (t.flagged) return '<span class="badge badge-danger">Sinalizado</span>';
    if (t.origin === "ajuste_aprovado") return '<span class="badge badge-info">Ajustado</span>';
    return t.reviewed ? '<span class="badge badge-success">Conferido</span>' : '<span class="badge badge-gray">Pendente</span>';
  }

  function renderTimelineBody(employee, date, dayEntries) {
    var employeeName = (employee && employee.name) || (dayEntries[0] && dayEntries[0].employeeName) || "-";
    var d = PontoCalc.computeDay(date, dayEntries, employee);

    if (d.occurrence) {
      var k = PontoCalc.OCCURRENCE_KINDS[d.occurrence.type] || {};
      return '<div class="ponto-request-row">' + thumbHtml(d.occurrence) +
        '<div class="ponto-request-body"><div class="font-bold">' + (k.label || d.occurrence.type) + '</div>' +
        (d.occurrence.note ? '<div class="small text-muted">' + Utils.escapeHtml(d.occurrence.note) + '</div>' : '') +
        (d.occurrence.attachment ? '<div class="mt-4">' + attachmentLinkHtml(d.occurrence.attachment) + '</div>' : '') +
        '<div class="small text-muted mt-4">' + statusChipHtml(d.occurrence) + '</div></div>' +
        '<button class="btn btn-icon btn-ghost" data-tl-entry="' + d.occurrence.id + '" title="Ver / conferir"><i class="fa-solid fa-magnifying-glass"></i></button>' +
        '</div>';
    }

    var summaryHtml = '<div class="flex mb-16" style="gap:24px;flex-wrap:wrap;padding:10px 12px;border-radius:8px;background:var(--gray-50);font-size:13px;">' +
      '<div><b>Jornada prevista:</b> ' + (PontoCalc.dailyExpectedMin(employee) / 60) + 'h/dia</div>' +
      '<div><b>Trabalhado:</b> ' + (d.workedMin != null ? PontoCalc.fmtHM(d.workedMin) : "-") + '</div>' +
      '<div><b>Saldo:</b> <span class="' + (d.workedMin != null && d.saldoMin < 0 ? "text-danger" : "text-success") + '">' + (d.workedMin != null ? PontoCalc.fmtHM(d.saldoMin) : "-") + '</span></div>' +
      (d.status !== "completo" ? '<div>' + d.statusLabel + '</div>' : '') +
      '</div>';

    var punches = dayEntries.filter(function (t) { return PontoCalc.isPunchType(t.type); })
      .sort(function (a, b) { return a.timestamp.localeCompare(b.timestamp); });

    var itemsHtml = punches.length ? punches.map(function (t) {
      return '<div class="ponto-timeline-item ' + timelineItemClass(t.type) + '">' +
        '<div class="ponto-timeline-dot"></div>' +
        thumbHtml(t, "ponto-timeline-thumb") +
        '<div class="ponto-timeline-body" style="flex:1;min-width:0;">' +
          '<div class="flex items-center gap-8"><span class="ponto-timeline-time">' + pgHhmm(t) + '</span><span class="ponto-timeline-type">' + (TYPE_LABELS[t.type] || t.type) + '</span></div>' +
          '<div class="ponto-timeline-meta">origem: ' + (t.selfieDataUrl ? "selfie" : (ORIGIN_LABELS[t.origin] || "manual")) + (t.note ? " · " + Utils.escapeHtml(t.note) : "") + '</div>' +
          '<div class="mt-4">' + statusChipHtml(t) + '</div>' +
        '</div>' +
        '<button class="btn btn-icon btn-ghost" data-tl-entry="' + t.id + '" title="Ver / conferir esta marcação"><i class="fa-solid fa-magnifying-glass"></i></button>' +
        '</div>';
    }).join("") : '<div class="small text-muted">Nenhuma marcação neste dia.</div>';

    return summaryHtml + '<div class="ponto-timeline">' + itemsHtml + '</div>';
  }

  function wireTimelineBody(box) {
    Utils.qsa("[data-tl-entry]", box).forEach(function (el) {
      el.addEventListener("click", function () { openReview(el.getAttribute("data-tl-entry")); });
    });
    Utils.qsa("[data-zoom]", box).forEach(function (el) {
      el.addEventListener("click", function () {
        var t = DB.get("timeClockEntries", el.getAttribute("data-zoom"));
        if (t && t.selfieDataUrl) openReview(t.id);
      });
    });
  }

  function openDayDetailModal(employeeId, date) {
    var employee = DB.get("employees", employeeId);
    var dayEntries = DB.all("timeClockEntries").filter(function (t) { return t.employeeId === employeeId && t.date === date; })
      .sort(function (a, b) { return a.timestamp.localeCompare(b.timestamp); });
    var employeeName = (employee && employee.name) || (dayEntries[0] && dayEntries[0].employeeName) || "-";
    var body = renderTimelineBody(employee, date, dayEntries);
    var foot = '<button class="btn btn-secondary" data-close-modal>Fechar</button>';
    var box = Modal.open({ title: "Marcações — " + employeeName + " — " + Utils.fmtDate(date), wide: true, bodyHtml: body, footHtml: foot });
    wireTimelineBody(box);
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
        renderAll();
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
      Modal.close(); renderAll();
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
      Modal.close(); renderAll();
    });
    box.querySelector("#pg-delete").addEventListener("click", function () {
      Modal.close();
      confirmDeleteEntry(t.id);
    });
  }

  // ---------------- Lançamento manual (batida ou ocorrência) ----------------
  function openManualEntryModal(preselectEmployeeId) {
    var emps = activeTimeClockEmployees();
    if (!emps.length) { Toast.show("Nenhum funcionário está marcado para bater ponto (Funcionários → editar → \"Bate ponto pelo sistema?\")", "danger", 4500); return; }
    var now = new Date();
    var nowTime = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    var body =
      '<div class="form-field full"><label>Funcionário</label><select id="me-employee">' +
        emps.map(function (e) { return '<option value="' + e.id + '"' + (preselectEmployeeId === e.id ? " selected" : "") + '>' + Utils.escapeHtml(e.name) + '</option>'; }).join("") +
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
      Modal.close(); renderAll();
    });
  }

  // ================================================================
  // 3) COLABORADORES — roster focado em ponto (não recadastro; dados
  //    cadastrais completos continuam só em Funcionários)
  // ================================================================
  function employeeTodayBadge(e, todays) {
    var dayEntries = todays.filter(function (t) { return t.employeeId === e.id; });
    var d = PontoCalc.computeDay(Utils.todayISO(), dayEntries, e);
    if (d.occurrence) { var k = PontoCalc.OCCURRENCE_KINDS[d.occurrence.type] || {}; return '<span class="badge ' + (k.badge || "badge-gray") + '">' + (k.label || d.occurrence.type) + '</span>'; }
    if (d.status === "em_andamento") return '<span class="badge badge-info">Trabalhando</span>';
    if (d.status === "completo") return '<span class="badge badge-success">Concluído</span>';
    if (d.status === "incompleto") return '<span class="badge badge-warning">Incompleto</span>';
    return '<span class="badge badge-gray">Sem registro</span>';
  }

  function renderColaboradores() {
    var all = DB.all("employees").filter(function (e) { return e.requiresTimeClock; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    var list = all.filter(function (e) {
      if (pgColFilt.search && e.name.toLowerCase().indexOf(pgColFilt.search.toLowerCase()) === -1) return false;
      if (pgColFilt.role && e.role !== pgColFilt.role) return false;
      if (pgColFilt.status && e.status !== pgColFilt.status) return false;
      return true;
    });
    document.getElementById("pg-col-sub").textContent = list.length + " colaborador(es) marcado(s) para bater ponto";
    var tbl = document.getElementById("tbl-colaboradores");
    if (!list.length) { Utils.emptyTable(tbl, "fa-users", "Nenhum colaborador encontrado"); return; }

    var today = Utils.todayISO();
    var todays = DB.all("timeClockEntries").filter(function (t) { return t.date === today; });
    var monthRange = PontoCalc.monthRange(today);
    var allEntries = DB.all("timeClockEntries");

    tbl.innerHTML = '<thead><tr><th>Funcionário</th><th>Status</th><th>Hoje</th><th>Saldo do mês</th><th></th></tr></thead><tbody>' +
      list.map(function (e) {
        var data = PontoCalc.espelho(e.id, monthRange.start, monthRange.end, e, allEntries);
        return '<tr>' +
          '<td><div class="flex items-center gap-8">' + Utils.avatarHtml(e.name, e.photoDataUrl) +
            '<div><div>' + Utils.escapeHtml(e.name) + '</div><div class="small text-muted">' + Utils.escapeHtml(e.role || "-") + '</div></div></div></td>' +
          '<td>' + (e.status === "ativo" ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>') + '</td>' +
          '<td>' + employeeTodayBadge(e, todays) + '</td>' +
          '<td class="text-num ' + (data.totals.saldoMin < 0 ? "text-danger" : "text-success") + '">' + PontoCalc.fmtHM(data.totals.saldoMin) + '</td>' +
          '<td><button class="btn btn-sm btn-outline" data-open-drawer="' + e.id + '">Ver detalhes</button></td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.qsa("[data-open-drawer]", tbl).forEach(function (btn) {
      btn.addEventListener("click", function () { openEmployeeDrawer(btn.getAttribute("data-open-drawer")); });
    });
  }

  // ---------------- Drawer de detalhe do colaborador ----------------
  // Decisão de UX (ver proposta salva no projeto): painel lateral, não
  // modal nem página — o gestor normalmente compara vários colaboradores
  // em sequência, e um drawer mantém a lista/filtro de fundo intactos.
  var pgDrawerTab = "geral";
  var pgDrawerDate = null;

  function drawerTabsHtml(employeeId) {
    var tabs = [
      { key: "geral", label: "Visão Geral" },
      { key: "marcacoes", label: "Marcações" },
      { key: "banco", label: "Banco de Horas" },
      { key: "ocorrencias", label: "Ocorrências" },
      { key: "solicitacoes", label: "Solicitações" },
      { key: "historico", label: "Histórico" }
    ];
    return '<div class="tabs" id="drw-tabs" style="margin-bottom:14px;">' +
      tabs.map(function (t) { return '<button type="button" class="tab-btn' + (pgDrawerTab === t.key ? " active" : "") + '" data-drw-tab="' + t.key + '">' + t.label + '</button>'; }).join("") +
      '</div><div id="drw-body"></div>';
  }

  function drawerRenderBody(employee) {
    var body = document.getElementById("drw-body");
    if (!body) return;
    if (pgDrawerTab === "geral") body.innerHTML = drawerGeralHtml(employee);
    else if (pgDrawerTab === "marcacoes") { body.innerHTML = drawerMarcacoesHtml(employee); wireDrawerMarcacoes(employee); }
    else if (pgDrawerTab === "banco") body.innerHTML = drawerBancoHtml(employee);
    else if (pgDrawerTab === "ocorrencias") body.innerHTML = drawerOcorrenciasHtml(employee);
    else if (pgDrawerTab === "solicitacoes") { body.innerHTML = drawerSolicitacoesHtml(employee); wireDrawerSolicitacoes(employee); }
    else if (pgDrawerTab === "historico") body.innerHTML = drawerHistoricoHtml(employee);
    if (pgDrawerTab !== "marcacoes" && pgDrawerTab !== "solicitacoes") wireTimelineBody(body);
  }

  function drawerGeralHtml(employee) {
    var today = Utils.todayISO();
    var monthRange = PontoCalc.monthRange(today);
    var allEntries = DB.all("timeClockEntries");
    var data = PontoCalc.espelho(employee.id, monthRange.start, monthRange.end, employee, allEntries);
    var last7 = PontoCalc.espelho(employee.id, Utils.addDays(today, -6), today, employee, allEntries).days;
    return '<div class="mb-16"><div class="small text-muted">Jornada prevista</div><div class="font-bold">' + (PontoCalc.dailyExpectedMin(employee) / 60) + 'h por dia</div></div>' +
      '<div class="mb-16"><div class="small text-muted">Saldo do mês (' + capFirst(monthRange.label) + ')</div><div class="font-bold ' + (data.totals.saldoMin < 0 ? "text-danger" : "text-success") + '" style="font-size:20px;">' + PontoCalc.fmtHM(data.totals.saldoMin) + '</div></div>' +
      '<div class="small text-muted mb-8">Últimos 7 dias</div>' +
      (last7.length ? last7.map(function (d) {
        return '<div class="ponto-request-row" style="padding:8px 0;">' +
          '<div class="ponto-request-body"><div class="font-bold">' + Utils.fmtDate(d.date) + '</div>' +
          '<div class="small text-muted">' + (d.occurrence ? (PontoCalc.OCCURRENCE_KINDS[d.occurrence.type] || {}).label : d.statusLabel) + '</div></div>' +
          '<div class="text-num ' + (d.workedMin != null && d.saldoMin < 0 ? "text-danger" : "text-success") + '">' + (d.workedMin != null ? PontoCalc.fmtHM(d.saldoMin) : "-") + '</div>' +
          '</div>';
      }).join("") : '<div class="small text-muted">Nenhum registro nos últimos 7 dias.</div>');
  }

  function drawerMarcacoesHtml(employee) {
    if (!pgDrawerDate) pgDrawerDate = Utils.todayISO();
    var dayEntries = DB.all("timeClockEntries").filter(function (t) { return t.employeeId === employee.id && t.date === pgDrawerDate; })
      .sort(function (a, b) { return a.timestamp.localeCompare(b.timestamp); });
    return '<div class="flex items-center gap-8 mb-16" style="justify-content:center;">' +
      '<button class="btn btn-icon btn-ghost btn-sm" id="drw-day-prev" title="Dia anterior"><i class="fa-solid fa-chevron-left"></i></button>' +
      '<div class="small font-bold" style="min-width:150px;text-align:center;">' + Utils.fmtDate(pgDrawerDate) + '</div>' +
      '<button class="btn btn-icon btn-ghost btn-sm" id="drw-day-next" title="Próximo dia"><i class="fa-solid fa-chevron-right"></i></button>' +
      '</div>' + renderTimelineBody(employee, pgDrawerDate, dayEntries);
  }

  function wireDrawerMarcacoes(employee) {
    var body = document.getElementById("drw-body");
    wireTimelineBody(body);
    var prevBtn = document.getElementById("drw-day-prev"), nextBtn = document.getElementById("drw-day-next");
    if (prevBtn) prevBtn.addEventListener("click", function () { pgDrawerDate = Utils.addDays(pgDrawerDate, -1); drawerRenderBody(employee); });
    if (nextBtn) nextBtn.addEventListener("click", function () { pgDrawerDate = Utils.addDays(pgDrawerDate, 1); drawerRenderBody(employee); });
  }

  function drawerBancoHtml(employee) {
    var range = PontoCalc.monthRange(pgDrawerDate || Utils.todayISO());
    var data = PontoCalc.espelho(employee.id, range.start, range.end, employee, DB.all("timeClockEntries"));
    var rowsHtml = data.days.length ? data.days.map(pgDayRowHtml).join("") :
      '<tr><td colspan="7" class="text-center text-muted" style="padding:20px;">Nenhum registro neste mês</td></tr>';
    return '<div class="small text-muted mb-8">' + capFirst(range.label) + '</div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      '<th>Data</th><th>Entrada</th><th>Intervalo</th><th>Saída</th><th>Trabalhado</th><th>Extras / Faltantes</th><th>Saldo</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody>' +
      (data.days.length ? '<tfoot><tr class="ponto-espelho-totals">' +
        '<td colspan="4">Total do mês</td>' +
        '<td class="text-num">' + PontoCalc.fmtHM(data.totals.workedMin) + '</td>' +
        '<td class="text-num">+' + PontoCalc.fmtHM(data.totals.extraMin) + ' / -' + PontoCalc.fmtHM(data.totals.missingMin) + '</td>' +
        '<td class="text-num ' + (data.totals.saldoMin < 0 ? "text-danger" : "text-success") + '">' + PontoCalc.fmtHM(data.totals.saldoMin) + '</td>' +
        '</tr></tfoot>' : "") +
      '</table></div>';
  }

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

  function drawerOcorrenciasHtml(employee) {
    var list = DB.all("timeClockEntries").filter(function (t) { return t.employeeId === employee.id && PontoCalc.isOccurrenceType(t.type); })
      .sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
    if (!list.length) return '<div class="small text-muted">Nenhuma ocorrência registrada para este colaborador.</div>';
    return list.map(function (t) {
      var k = PontoCalc.OCCURRENCE_KINDS[t.type] || {};
      return '<div class="ponto-request-row">' + thumbHtml(t) +
        '<div class="ponto-request-body"><div class="font-bold">' + (k.label || t.type) + '</div>' +
        '<div class="small text-muted">' + Utils.fmtDate(t.date) + (t.note ? ' · ' + Utils.escapeHtml(t.note) : '') + '</div>' +
        (t.attachment ? '<div class="mt-4">' + attachmentLinkHtml(t.attachment) + '</div>' : '') +
        '<div class="small text-muted mt-4">' + statusChipHtml(t) + '</div></div>' +
        '<button class="btn btn-icon btn-ghost" data-tl-entry="' + t.id + '" title="Ver"><i class="fa-solid fa-magnifying-glass"></i></button></div>';
    }).join("");
  }

  function drawerSolicitacoesHtml(employee) {
    var all = (window.Approvals ? Approvals.listPending() : []).filter(function (a) { return a.type === PontoAjustes.TYPE && a.payload && a.payload.employeeId === employee.id; });
    if (!all.length) return '<div class="small text-muted">Nenhuma solicitação pendente deste colaborador.</div>';
    var canApprove = window.Approvals && Approvals.canApprove();
    return all.map(function (a) { return solicitacaoRowHtml(a, canApprove); }).join("");
  }
  function wireDrawerSolicitacoes(employee) { wireSolicitacaoActions(document.getElementById("drw-body")); }

  function drawerHistoricoHtml(employee) {
    var list = DB.all("timeClockEntries").filter(function (t) { return t.employeeId === employee.id && (t.origin === "manual" || t.origin === "ajuste_aprovado"); })
      .sort(function (a, b) { return (b.timestamp || "").localeCompare(a.timestamp || ""); }).slice(0, 30);
    if (!list.length) return '<div class="small text-muted">Nenhum lançamento manual ou ajuste aprovado neste colaborador ainda.</div>';
    return list.map(function (t) {
      return '<div class="ponto-request-row" style="padding:9px 0;">' +
        '<div class="ponto-request-icon"><i class="fa-solid ' + (t.origin === "manual" ? "fa-pen" : "fa-user-check") + '"></i></div>' +
        '<div class="ponto-request-body"><div class="font-bold">' + (ORIGIN_LABELS[t.origin] || t.origin) + ' — ' + anyTypeLabel(t.type) + '</div>' +
        '<div class="small text-muted">' + Utils.fmtDate(t.date) + (t.note ? ' · ' + Utils.escapeHtml(t.note) : '') + '</div></div>' +
        '</div>';
    }).join("");
  }

  function openEmployeeDrawer(employeeId) {
    var employee = DB.get("employees", employeeId);
    if (!employee) return;
    pgDrawerTab = "geral";
    pgDrawerDate = Utils.todayISO();
    var titleHtml = '<div class="flex items-center gap-12">' + Utils.avatarHtml(employee.name, employee.photoDataUrl) +
      '<div><div class="font-bold">' + Utils.escapeHtml(employee.name) + '</div><div class="small text-muted">' + Utils.escapeHtml(employee.role || "-") + '</div></div></div>';
    var box = Drawer.open({ titleHtml: titleHtml, bodyHtml: drawerTabsHtml(employeeId) });
    function wireTabs() {
      Utils.qsa("[data-drw-tab]", box).forEach(function (btn) {
        btn.addEventListener("click", function () {
          pgDrawerTab = btn.getAttribute("data-drw-tab");
          Utils.qsa("[data-drw-tab]", box).forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          drawerRenderBody(employee);
        });
      });
    }
    wireTabs();
    drawerRenderBody(employee);
  }

  // ================================================================
  // 4) SOLICITAÇÕES — hub de aprovação (ajustes de ponto e ocorrências
  //    pedidas pelo próprio funcionário)
  // ================================================================
  function solicitacaoRowHtml(a, canApprove) {
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
        (canApprove ? '<textarea class="mt-8" data-comment-for="' + a.id + '" rows="1" placeholder="Comentário (opcional, fica registrado na decisão)" style="width:100%;font-size:12.5px;"></textarea>' : '') +
      '</div>' + actions +
    '</div>';
  }

  function wireSolicitacaoActions(container) {
    Utils.qsa("[data-approve-req]", container).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-approve-req");
        var commentEl = container.querySelector('[data-comment-for="' + id + '"]');
        Approvals.approve(id, PontoAjustes.apply, commentEl ? commentEl.value.trim() : "");
        Toast.show("Solicitação aprovada", "success");
        if (window.AppLayout) Approvals.renderBadge(document.getElementById("approvals-badge-slot"));
        renderAll();
      });
    });
    Utils.qsa("[data-reject-req]", container).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-reject-req");
        var commentEl = container.querySelector('[data-comment-for="' + id + '"]');
        Modal.confirm({
          title: "Recusar solicitação", message: "Deseja recusar este pedido de ajuste de ponto?", danger: true,
          onConfirm: function () {
            Approvals.reject(id, commentEl ? commentEl.value.trim() : "");
            Toast.show("Solicitação recusada", "info");
            if (window.AppLayout) Approvals.renderBadge(document.getElementById("approvals-badge-slot"));
            renderAll();
          }
        });
      });
    });
  }

  function renderSolicitacoesTab() {
    var list = pendingAdjustRequests();
    var canApprove = window.Approvals && Approvals.canApprove();
    var listEl = document.getElementById("pg-requests-list");
    var tabBtn = document.getElementById("pg-tab-btn-solicitacoes");
    if (tabBtn) tabBtn.innerHTML = "Solicitações" + (list.length ? ' <span class="badge badge-danger">' + list.length + '</span>' : "");
    if (!list.length) {
      listEl.innerHTML = '<div class="small text-muted" style="padding:8px 0;">Nenhuma solicitação pendente.</div>';
    } else {
      listEl.innerHTML = list.map(function (a) { return solicitacaoRowHtml(a, canApprove); }).join("");
      wireSolicitacaoActions(listEl);
    }

    var decided = (window.Approvals ? Approvals.listPending && DB.all("approvals") : []).filter(function (a) {
      return a.type === PontoAjustes.TYPE && a.status !== "pendente";
    }).sort(function (a, b) { return (b.decidedAt || "").localeCompare(a.decidedAt || ""); }).slice(0, 8);
    var historyCard = document.getElementById("pg-requests-history-card");
    if (decided.length) {
      historyCard.style.display = "";
      document.getElementById("pg-requests-history-list").innerHTML = decided.map(function (a) {
        var okBadge = a.status === "aprovada" ? '<span class="badge badge-success">Aprovada</span>' : '<span class="badge badge-gray">Recusada</span>';
        return '<div class="ponto-request-row" style="padding:8px 0;"><div class="ponto-request-body">' +
          '<div class="font-bold">' + Utils.escapeHtml(a.summary || "-") + '</div>' +
          '<div class="small text-muted">' + okBadge + ' por ' + Utils.escapeHtml(a.decidedByName || "-") + ' · ' + Utils.fmtDateTime(a.decidedAt) +
          (a.rejectReason ? ' — ' + Utils.escapeHtml(a.rejectReason) : (a.reviewerNote ? ' — ' + Utils.escapeHtml(a.reviewerNote) : "")) + '</div></div></div>';
      }).join("");
    } else {
      historyCard.style.display = "none";
    }
  }

  // ================================================================
  // 5) OCORRÊNCIAS — visão de exceções (o que o gestor precisa olhar
  //    primeiro, sem revisar todo mundo manualmente)
  // ================================================================
  var OCC_QUICK_FILTERS = [
    { key: "todas", label: "TODAS" },
    { key: "incompleto", label: "PONTO INCOMPLETO" },
    { key: "impar", label: "MARCAÇÃO ÍMPAR" },
    { key: "extras", label: "HORAS EXTRAS" },
    { key: "faltantes", label: "HORAS FALTANTES" },
    { key: "falta", label: "FALTA / ATESTADO" },
    { key: "sinalizados", label: "SINALIZADOS" }
  ];

  // Limiar para não poluir a lista com diferenças mínimas de arredondamento.
  var OCC_MIN_MINUTES = 20;

  function computeExceptions(start, end) {
    var eligible = activeTimeClockEmployees();
    var allEntries = DB.all("timeClockEntries");
    var list = [];
    eligible.forEach(function (e) {
      var data = PontoCalc.espelho(e.id, start, end, e, allEntries);
      data.days.forEach(function (d) {
        var dayEntries = allEntries.filter(function (t) { return t.employeeId === e.id && t.date === d.date; });
        var punchCount = dayEntries.filter(function (t) { return PontoCalc.isPunchType(t.type); }).length;
        var flaggedHere = dayEntries.some(function (t) { return t.flagged; });
        if (d.occurrence) {
          if (d.occurrence.type === "falta_justificada" && !d.occurrence.reviewed) {
            list.push({ sev: "sev-low", kind: "falta", icon: "fa-user-slash", employee: e, date: d.date, label: "Falta Justificada — ainda não conferida" });
          }
          if (flaggedHere) list.push({ sev: "sev-high", kind: "sinalizados", icon: "fa-flag", employee: e, date: d.date, label: "Registro sinalizado" });
          return;
        }
        if (d.status === "incompleto") list.push({ sev: "sev-med", kind: "incompleto", icon: "fa-hourglass-half", employee: e, date: d.date, label: "Ponto incompleto" });
        if (punchCount % 2 === 1) list.push({ sev: "sev-med", kind: "impar", icon: "fa-shuffle", employee: e, date: d.date, label: "Marcação ímpar (" + punchCount + " batida(s) no dia)" });
        if (d.workedMin != null && d.extraMin >= OCC_MIN_MINUTES) list.push({ sev: "sev-low", kind: "extras", icon: "fa-arrow-trend-up", employee: e, date: d.date, label: "Horas extras: +" + PontoCalc.fmtHM(d.extraMin) });
        if (d.workedMin != null && d.missingMin >= OCC_MIN_MINUTES) list.push({ sev: "sev-med", kind: "faltantes", icon: "fa-arrow-trend-down", employee: e, date: d.date, label: "Horas faltantes: -" + PontoCalc.fmtHM(d.missingMin) });
        if (flaggedHere) list.push({ sev: "sev-high", kind: "sinalizados", icon: "fa-flag", employee: e, date: d.date, label: "Registro sinalizado" });
      });
    });
    var sevRank = { "sev-high": 0, "sev-med": 1, "sev-low": 2 };
    list.sort(function (a, b) { return sevRank[a.sev] - sevRank[b.sev] || b.date.localeCompare(a.date); });
    return list;
  }

  function renderOcorrenciasTab() {
    renderQuickFilters("pg-occ-quick-filters", OCC_QUICK_FILTERS, pgOccQuickFilter, function (key) { pgOccQuickFilter = key; renderOcorrenciasTab(); });
    if (!pgOccRange.start || !pgOccRange.end) return;
    var all = computeExceptions(pgOccRange.start, pgOccRange.end);
    var filtered = pgOccQuickFilter === "todas" ? all : all.filter(function (x) { return x.kind === pgOccQuickFilter; });
    document.getElementById("pg-occ-sub").textContent = filtered.length + " exceção(ões) de " + Utils.fmtDate(pgOccRange.start) + " a " + Utils.fmtDate(pgOccRange.end);
    var box = document.getElementById("pg-occ-list");
    if (!filtered.length) {
      box.innerHTML = '<div class="small text-muted" style="padding:8px 0;">Nenhuma exceção encontrada nesse período/filtro.</div>';
      return;
    }
    box.innerHTML = filtered.slice(0, 200).map(function (x, idx) {
      return '<div class="pg-alert-row"><span class="pg-alert-dot ' + x.sev + '"></span>' +
        '<div class="pg-alert-body"><div class="font-bold"><i class="fa-solid ' + x.icon + '" style="margin-right:6px;color:var(--gray-500);"></i>' + Utils.escapeHtml(x.employee.name) + '</div>' +
        '<div class="small text-muted">' + Utils.escapeHtml(x.label) + ' — ' + Utils.fmtDate(x.date) + '</div></div>' +
        '<button class="btn btn-sm btn-ghost" data-occ-open="' + idx + '">Ver</button></div>';
    }).join("");
    Utils.qsa("[data-occ-open]", box).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var x = filtered[Number(btn.getAttribute("data-occ-open"))];
        openDayDetailModal(x.employee.id, x.date);
      });
    });
  }

  // ================================================================
  // 6) BANCO DE HORAS — saldo agregado por colaborador (evolução do
  //    "saldo" recalculado; vira um livro com vencimento numa fase futura)
  // ================================================================
  function renderBancoHorasTab() {
    if (!pgBancoRangeCtl) {
      pgBancoRangeCtl = PeriodFilter.mount(document.getElementById("pg-banco-range"), {
        defaultPreset: "mes",
        label: "Período",
        onChange: renderBancoHorasTable
      });
    }
    renderBancoHorasTable(pgBancoRangeCtl.getRange());
  }

  var pgBancoSort = { field: null, dir: "asc" };
  var pgBancoSortGetters = {
    employeeName: function (r) { return r.employee.name; },
    saldoMin: function (r) { return r.totals.saldoMin; },
    workedMin: function (r) { return r.totals.workedMin; }
  };

  function renderBancoHorasTable(range) {
    var eligible = activeTimeClockEmployees();
    var allEntries = DB.all("timeClockEntries");
    var rows = eligible.map(function (e) {
      return { employee: e, totals: PontoCalc.espelho(e.id, range.start, range.end, e, allEntries).totals };
    });
    var agg = rows.reduce(function (acc, r) {
      acc.extraMin += r.totals.extraMin; acc.missingMin += r.totals.missingMin; acc.saldoMin += r.totals.saldoMin;
      if (r.totals.saldoMin > 0) acc.positivos++; else if (r.totals.saldoMin < 0) acc.negativos++;
      return acc;
    }, { extraMin: 0, missingMin: 0, saldoMin: 0, positivos: 0, negativos: 0 });

    document.getElementById("pg-banco-kpis").innerHTML =
      kpi("Saldo Positivo", agg.positivos + " colaborador(es)", "fa-arrow-trend-up", "#0e9c5b", "#e2f5ec") +
      kpi("Saldo Negativo", agg.negativos + " colaborador(es)", "fa-arrow-trend-down", "#c0392b", "#fbe3e0") +
      kpi("Horas Extras (total)", "+" + PontoCalc.fmtHM(agg.extraMin), "fa-clock", "#0eb8d9", "#dbf7fc") +
      kpi("Horas Compensadas / Faltantes", "-" + PontoCalc.fmtHM(agg.missingMin), "fa-clock-rotate-left", "#7a4fc9", "#ece4f8");

    document.getElementById("pg-banco-sub").textContent = Utils.fmtDate(range.start) + " — " + Utils.fmtDate(range.end);
    var tbl = document.getElementById("tbl-banco");
    if (!rows.length) { Utils.emptyTable(tbl, "fa-scale-balanced", "Nenhum colaborador no ponto"); return; }
    rows = Utils.sortBy(rows, pgBancoSort, pgBancoSortGetters);
    tbl.innerHTML = '<thead><tr>' +
      Utils.thSort("Funcionário", "employeeName", pgBancoSort) +
      Utils.thSort("Trabalhado", "workedMin", pgBancoSort) +
      '<th>Extras</th><th>Faltantes</th>' +
      Utils.thSort("Saldo", "saldoMin", pgBancoSort) +
      '<th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' +
          '<td><div class="flex items-center gap-8">' + Utils.avatarHtml(r.employee.name, r.employee.photoDataUrl) +
            '<div><div>' + Utils.escapeHtml(r.employee.name) + '</div><div class="small text-muted">' + Utils.escapeHtml(r.employee.role || "-") + '</div></div></div></td>' +
          '<td class="text-num">' + PontoCalc.fmtHM(r.totals.workedMin) + '</td>' +
          '<td class="text-num text-success">+' + PontoCalc.fmtHM(r.totals.extraMin) + '</td>' +
          '<td class="text-num text-danger">-' + PontoCalc.fmtHM(r.totals.missingMin) + '</td>' +
          '<td class="text-num ' + (r.totals.saldoMin < 0 ? "text-danger" : "text-success") + '">' + PontoCalc.fmtHM(r.totals.saldoMin) + '</td>' +
          '<td><button class="btn btn-sm btn-outline" data-banco-open="' + r.employee.id + '">Ver detalhes</button></td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.wireSortHeaders(tbl, pgBancoSort, function () { renderBancoHorasTable(pgBancoRangeCtl.getRange()); });
    Utils.qsa("[data-banco-open]", tbl).forEach(function (btn) {
      btn.addEventListener("click", function () { openEmployeeDrawer(btn.getAttribute("data-banco-open")); });
    });
  }

  // ================================================================
  // 7) RELATÓRIOS — Folha de Ponto (PDF do período fechado)
  // ================================================================
  function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function currentUserDisplayName() {
    var u = window.CurrentUser && window.CurrentUser.get && window.CurrentUser.get();
    return u ? ((u.firstName || "") + " " + (u.lastName || "")).trim() || "-" : "-";
  }

  function folhaMonthOptions() {
    var months = [];
    var today = Utils.todayISO();
    for (var i = 0; i < 12; i++) months.push(Utils.monthKey(Utils.addMonths(today, -i)));
    return months;
  }

  function folhaCutoffDate(monthKey) {
    var today = Utils.todayISO();
    if (monthKey === Utils.monthKey(today)) return today;
    var parts = monthKey.split("-").map(Number);
    var lastDay = new Date(parts[0], parts[1], 0).getDate();
    return monthKey + "-" + String(lastDay).padStart(2, "0");
  }

  function employeesWithEntriesInRange(entries, start, end) {
    var byId = {};
    entries.forEach(function (t) {
      if (t.date >= start && t.date <= end) byId[t.employeeId] = t.employeeName || byId[t.employeeId] || "Funcionário";
    });
    return Object.keys(byId).map(function (id) {
      return DB.get("employees", id) || { id: id, name: byId[id], dailyWorkHours: null };
    }).sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
  }

  function folhaPickerEmployees() {
    var ids = {};
    DB.all("timeClockEntries").forEach(function (t) { ids[t.employeeId] = true; });
    activeTimeClockEmployees().forEach(function (e) { ids[e.id] = true; });
    return Object.keys(ids).map(function (id) { return DB.get("employees", id); }).filter(Boolean)
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function openFolhaModal() {
    var months = folhaMonthOptions();
    var pickEmployees = folhaPickerEmployees();

    var body =
      '<div class="form-field full"><label>Funcionário</label><select id="fp-employee">' +
        '<option value="">Todos os Funcionários</option>' +
        pickEmployees.map(function (e) { return '<option value="' + e.id + '">' + Utils.escapeHtml(e.name) + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="form-field full"><label>Mês de Referência</label><select id="fp-month">' +
        months.map(function (m, idx) {
          var label = capFirst(PontoCalc.monthRange(m + "-01").label);
          return '<option value="' + m + '"' + (idx === 0 ? " selected" : "") + '>' + label + (idx === 0 ? " (em aberto até hoje)" : "") + '</option>';
        }).join("") +
      '</select></div>' +
      '<div class="small text-muted">Gera um PDF por funcionário, pronto para impressão e assinatura, com todas as batidas e ocorrências (faltas, atestados, folgas) do período fechado.</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="fp-generate"><i class="fa-solid fa-file-pdf"></i> Gerar PDF</button>';
    var box = Modal.open({ title: "Gerar Folha de Ponto", bodyHtml: body, footHtml: foot });
    box.querySelector("#fp-generate").addEventListener("click", function () {
      generateFolhaPdf(box.querySelector("#fp-employee").value, box.querySelector("#fp-month").value);
    });
  }

  var FOLHA_COLS = [
    { key: "data", label: "Data", x: 40, w: 55 },
    { key: "entrada", label: "Entrada", x: 95, w: 50 },
    { key: "saidaAlmoco", label: "Saída Almoço", x: 145, w: 62 },
    { key: "voltaAlmoco", label: "Volta Almoço", x: 207, w: 62 },
    { key: "saida", label: "Saída", x: 269, w: 48 },
    { key: "trabalhado", label: "Trabalhado", x: 317, w: 62 },
    { key: "extras", label: "Extras", x: 379, w: 52 },
    { key: "faltantes", label: "Faltantes", x: 431, w: 52 },
    { key: "saldo", label: "Saldo", x: 483, w: 52 },
    { key: "obs", label: "Ocorrência / Observação", x: 535, w: 267 }
  ];

  function generateFolhaPdf(employeeId, monthKey) {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { Toast.show("Não foi possível carregar a biblioteca de PDF — verifique sua conexão e tente novamente", "danger"); return; }
    if (!monthKey) { Toast.show("Selecione o mês de referência", "danger"); return; }

    var range = PontoCalc.monthRange(monthKey + "-01");
    var cutoff = folhaCutoffDate(monthKey);
    var endForRange = cutoff < range.end ? cutoff : range.end;
    var monthLabel = capFirst(range.label);
    var allEntries = DB.all("timeClockEntries");
    var employees = employeeId
      ? [DB.get("employees", employeeId) || { id: employeeId, name: (allEntries.find(function (t) { return t.employeeId === employeeId; }) || {}).employeeName || "Funcionário" }]
      : employeesWithEntriesInRange(allEntries, range.start, endForRange);

    if (!employees.length) { Toast.show("Nenhum funcionário com lançamentos nesse período", "info"); return; }

    var doc = new jsPDFCtor({ unit: "pt", format: "a4", orientation: "landscape" });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var marginX = 40, tableEnd = pageWidth - marginX;

    function drawColHeaders(y) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      FOLHA_COLS.forEach(function (c) { doc.text(c.label, c.x, y); });
      y += 6;
      doc.setLineWidth(0.6);
      doc.line(marginX, y, tableEnd, y);
      return y + 13;
    }

    function ensureSpace(y, needed, withHeaders) {
      if (y + needed <= pageHeight - 40) return y;
      doc.addPage();
      var ny = 50;
      if (withHeaders) ny = drawColHeaders(ny);
      return ny;
    }

    employees.forEach(function (emp, empIdx) {
      if (empIdx > 0) doc.addPage();
      var y = 46;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("Guitart & Co. — Folha de Ponto", marginX, y);
      y += 20;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Funcionário: " + emp.name + (emp.role ? " — " + emp.role : ""), marginX, y);
      doc.text("Mês de referência: " + monthLabel, tableEnd, y, { align: "right" });
      y += 15;
      doc.text("Carga horária diária: " + (PontoCalc.dailyExpectedMin(emp) / 60) + "h", marginX, y);
      doc.text("Período fechado em: " + Utils.fmtDate(cutoff), tableEnd, y, { align: "right" });
      y += 15;
      doc.text("Gerado em " + Utils.fmtDate(Utils.todayISO()) + " por " + currentUserDisplayName(), marginX, y);
      y += 18;

      var data = PontoCalc.espelho(emp.id, range.start, endForRange, emp, allEntries);
      var days = data.days.slice().reverse();

      y = drawColHeaders(y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);

      if (!days.length) {
        doc.text("Nenhum lançamento neste período.", marginX, y);
        y += 16;
      } else {
        days.forEach(function (d) {
          y = ensureSpace(y, 14, true);
          if (d.occurrence) {
            var k = PontoCalc.OCCURRENCE_KINDS[d.occurrence.type] || {};
            doc.text(Utils.fmtDate(d.date), FOLHA_COLS[0].x, y);
            var obsTxt = (k.label || d.occurrence.type) + (d.occurrence.note ? " — " + d.occurrence.note : "");
            doc.text(obsTxt, FOLHA_COLS[9].x, y, { maxWidth: FOLHA_COLS[9].w });
          } else {
            doc.text(Utils.fmtDate(d.date), FOLHA_COLS[0].x, y);
            doc.text(pgHhmm(d.entrada), FOLHA_COLS[1].x, y);
            doc.text(pgHhmm(d.saidaAlmoco), FOLHA_COLS[2].x, y);
            doc.text(pgHhmm(d.voltaAlmoco), FOLHA_COLS[3].x, y);
            doc.text(pgHhmm(d.saida), FOLHA_COLS[4].x, y);
            doc.text(d.workedMin != null ? PontoCalc.fmtHM(d.workedMin) : "-", FOLHA_COLS[5].x, y);
            doc.text(d.workedMin != null ? "+" + PontoCalc.fmtHM(d.extraMin) : "-", FOLHA_COLS[6].x, y);
            doc.text(d.workedMin != null ? "-" + PontoCalc.fmtHM(d.missingMin) : "-", FOLHA_COLS[7].x, y);
            doc.text(d.workedMin != null ? PontoCalc.fmtHM(d.saldoMin) : "-", FOLHA_COLS[8].x, y);
            if (d.status !== "completo") doc.text(d.statusLabel, FOLHA_COLS[9].x, y, { maxWidth: FOLHA_COLS[9].w });
          }
          y += 14;
        });
      }

      y = ensureSpace(y, 20, false);
      doc.setLineWidth(0.6);
      doc.line(marginX, y, tableEnd, y);
      y += 13;
      doc.setFont("helvetica", "bold");
      doc.text("Total do período", FOLHA_COLS[0].x, y);
      doc.text(PontoCalc.fmtHM(data.totals.workedMin), FOLHA_COLS[5].x, y);
      doc.text("+" + PontoCalc.fmtHM(data.totals.extraMin), FOLHA_COLS[6].x, y);
      doc.text("-" + PontoCalc.fmtHM(data.totals.missingMin), FOLHA_COLS[7].x, y);
      doc.text(PontoCalc.fmtHM(data.totals.saldoMin), FOLHA_COLS[8].x, y);

      y = ensureSpace(y, 70, false);
      y += 50;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setLineWidth(0.6);
      doc.line(marginX, y, marginX + 220, y);
      doc.line(tableEnd - 220, y, tableEnd, y);
      y += 12;
      doc.text("Assinatura do Funcionário", marginX, y);
      doc.text("Assinatura do Responsável", tableEnd - 220, y);
    });

    var fileSuffix = employeeId ? Utils.slugify(employees[0].name) : "todos";
    doc.save("folha-ponto_" + fileSuffix + "_" + monthKey + ".pdf");
    DB.log("Ponto", "Gerou a Folha de Ponto em PDF de " + (employeeId ? employees[0].name : "todos os funcionários") + " (ref. " + monthLabel + ", período fechado em " + Utils.fmtDate(cutoff) + ")");
    Toast.show("Folha de Ponto gerada", "success");
    Modal.close();
  }
})();
