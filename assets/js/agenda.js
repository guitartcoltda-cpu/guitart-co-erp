(function () {
  "use strict";

  var selectedDate = Utils.todayISO();
  var filt = { employee: "", service: "", status: "" };
  var viewMode = "dia"; // "dia" | "geral" — geral shows every appointment across all dates, not scoped to a single day
  var periodStart = Utils.todayISO();
  var periodEnd = "";
  var DOW_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  var PAYMENT_OPTIONS = ["Pix", "Cartão de Crédito", "Cartão de Débito", "Dinheiro"];
  var OCC_TYPES = ["Ausência Médica", "Falta Justificada", "Compromisso Pessoal", "Bloqueio / Manutenção", "Outro"];

  // Grade da Visão do Dia: das 08:00 às 21:00, 1.1px por minuto.
  var GRID_START_MIN = 8 * 60;
  var GRID_END_MIN = 21 * 60;
  var PX_PER_MIN = 1.1;

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    var empSel = Utils.qs("#ag-employee");
    DB.all("employees").filter(function (e) { return e.status === "ativo"; }).sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (e) {
      var o = document.createElement("option"); o.value = e.id; o.textContent = e.name; empSel.appendChild(o);
    });
    empSel.addEventListener("change", function (e) { filt.employee = e.target.value; render(); });
    var srvSel = Utils.qs("#ag-service");
    DB.all("services").sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (s) {
      var o = document.createElement("option"); o.value = s.id; o.textContent = s.name; srvSel.appendChild(o);
    });
    srvSel.addEventListener("change", function (e) { filt.service = e.target.value; render(); });
    Utils.qs("#ag-status").addEventListener("change", function (e) { filt.status = e.target.value; render(); });
    var clearBtn = Utils.qs("#btn-ag-clear-filters");
    if (clearBtn) clearBtn.addEventListener("click", clearFilters);

    // Visão do Dia x Visão Geral — a lista geral existe para responder
    // "quero ver todos os atendimentos futuros de um profissional, sem
    // precisar clicar dia a dia" (uso comum: conferir a agenda completa
    // de alguém antes de remarcar ou planejar a semana/mês).
    Utils.qsa(".tab-btn", Utils.qs("#ag-view-tabs")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        Utils.qsa(".tab-btn", Utils.qs("#ag-view-tabs")).forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        viewMode = btn.getAttribute("data-view");
        Utils.qs("#ag-day-nav").style.display = viewMode === "dia" ? "" : "none";
        Utils.qs("#ag-day-nav-main").style.display = viewMode === "dia" ? "" : "none";
        Utils.qs("#ag-period-filters").style.display = viewMode === "geral" ? "" : "none";
        render();
      });
    });
    var periodStartInput = Utils.qs("#ag-period-start");
    var periodEndInput = Utils.qs("#ag-period-end");
    periodStartInput.value = periodStart;
    periodStartInput.addEventListener("change", function (e) { periodStart = e.target.value; render(); });
    periodEndInput.addEventListener("change", function (e) { periodEnd = e.target.value; render(); });
    Utils.qs("#btn-today").addEventListener("click", function () {
      selectedDate = Utils.todayISO();
      if (viewMode !== "dia") {
        viewMode = "dia";
        Utils.qsa(".tab-btn", Utils.qs("#ag-view-tabs")).forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-view") === "dia"); });
        Utils.qs("#ag-day-nav").style.display = "";
        Utils.qs("#ag-day-nav-main").style.display = "";
        Utils.qs("#ag-period-filters").style.display = "none";
      }
      render();
    });
    // Navegação principal da Visão do Dia é dia a dia (setas simples); as
    // setas duplas pulam uma semana inteira, mantendo um atalho rápido sem
    // voltar a ser a navegação padrão (a pedido do cliente: "passando dia
    // após dia, não por semana").
    Utils.qs("#btn-prev-week").addEventListener("click", function () { selectedDate = Utils.addDays(selectedDate, -1); render(); });
    Utils.qs("#btn-next-week").addEventListener("click", function () { selectedDate = Utils.addDays(selectedDate, 1); render(); });
    Utils.qs("#btn-prev-month").addEventListener("click", function () { selectedDate = Utils.addDays(selectedDate, -7); render(); });
    Utils.qs("#btn-next-month").addEventListener("click", function () { selectedDate = Utils.addDays(selectedDate, 7); render(); });
    Utils.qs("#btn-new-appt").addEventListener("click", function () { openApptModal(null); });
    var occBtn = Utils.qs("#btn-new-occurrence");
    if (occBtn) occBtn.addEventListener("click", function () { openOccurrenceModal({ date: selectedDate }); });

    render();
  }

  // ---- Mini calendário (substitui o antigo bloco "Ir para data" +1/3/6
  // meses/Fim do ano) — grade de mês com navegação por seta, no mesmo
  // espírito do calendário compacto usado por outros sistemas de agenda,
  // porém no estilo visual próprio do Guitart & Co. `miniCalMonth` guarda
  // apenas o mês sendo EXIBIDO no mini calendário — é independente de
  // `selectedDate` para que navegar entre meses no mini calendário não
  // troque o dia selecionado (e a lista de agendamentos) até o usuário
  // realmente clicar em um dia.
  var miniCalMonth = selectedDate;

  function monthStartISO(iso) {
    var d = Utils.parseDate(iso);
    return Utils.toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function renderMiniCal() {
    var el = document.getElementById("mini-cal");
    if (!el) return;
    var ref = Utils.parseDate(monthStartISO(miniCalMonth));
    var year = ref.getFullYear(), month = ref.getMonth();
    var firstDow = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var prevMonthDays = new Date(year, month, 0).getDate();
    var today = Utils.todayISO();
    var monthLabel = ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    var cellsHtml = "";
    for (var i = 0; i < firstDow; i++) {
      var leadNum = prevMonthDays - firstDow + 1 + i;
      cellsHtml += '<div class="mini-cal-day mc-outside" data-nav="-1">' + leadNum + '</div>';
    }
    for (var day = 1; day <= daysInMonth; day++) {
      var iso = Utils.toISODate(new Date(year, month, day));
      var cls = "mini-cal-day";
      if (iso === today) cls += " mc-today";
      if (iso === selectedDate) cls += " mc-selected";
      cellsHtml += '<div class="' + cls + '" data-date="' + iso + '">' + day + '</div>';
    }
    var totalCells = firstDow + daysInMonth;
    var trailing = (Math.ceil(totalCells / 7) * 7) - totalCells;
    for (var t = 0; t < trailing; t++) {
      cellsHtml += '<div class="mini-cal-day mc-outside" data-nav="1">' + (t + 1) + '</div>';
    }

    el.innerHTML =
      '<div class="mini-cal-head">' +
        '<button type="button" id="mc-prev" title="Mês anterior"><i class="fa-solid fa-chevron-left"></i></button>' +
        '<div class="mc-label">' + monthLabel + '</div>' +
        '<button type="button" id="mc-next" title="Próximo mês"><i class="fa-solid fa-chevron-right"></i></button>' +
      '</div>' +
      '<div class="mini-cal-grid">' +
        DOW_NAMES.map(function (n) { return '<div class="mini-cal-dow">' + n.slice(0, 1) + '</div>'; }).join("") +
        cellsHtml +
      '</div>';

    el.querySelector("#mc-prev").addEventListener("click", function () {
      miniCalMonth = Utils.addMonths(monthStartISO(miniCalMonth), -1);
      renderMiniCal();
    });
    el.querySelector("#mc-next").addEventListener("click", function () {
      miniCalMonth = Utils.addMonths(monthStartISO(miniCalMonth), 1);
      renderMiniCal();
    });
    Utils.qsa(".mini-cal-day", el).forEach(function (cell) {
      cell.addEventListener("click", function () {
        var iso = cell.getAttribute("data-date");
        if (iso) {
          selectedDate = iso;
          render();
        } else {
          var navDir = Number(cell.getAttribute("data-nav"));
          miniCalMonth = Utils.addMonths(monthStartISO(miniCalMonth), navDir);
          renderMiniCal();
        }
      });
    });
  }

  function clearFilters() {
    filt = { employee: "", service: "", status: "" };
    var empSel = document.getElementById("ag-employee");
    var srvSel = document.getElementById("ag-service");
    var statusSel = document.getElementById("ag-status");
    if (empSel) empSel.value = "";
    if (srvSel) srvSel.value = "";
    if (statusSel) statusSel.value = "";
    render();
  }

  function weekStartOf(dateISO) {
    var d = Utils.parseDate(dateISO);
    var dow = d.getDay();
    return Utils.addDays(dateISO, -dow);
  }

  function render() {
    var appointments = DB.all("appointments");
    var today = Utils.todayISO();
    var hasFilter = !!(filt.employee || filt.service || filt.status);
    var filterNote = document.getElementById("ag-filter-note");

    if (viewMode === "geral") {
      if (filterNote) {
        filterNote.textContent = hasFilter ? "Filtro ativo — a lista abaixo já reflete o filtro selecionado." : "";
      }
      var titleParts = ["Agenda Completa"];
      if (filt.employee) {
        var empObj = DB.get("employees", filt.employee);
        if (empObj) titleParts.push("— " + empObj.name);
      }
      document.getElementById("day-title").textContent = titleParts.join(" ");
      renderGeneralList();
      return;
    }

    // week strip — counts respect the active Profissional/Status filters so
    // the effect of the filter is visible even before opening a specific day
    // (otherwise picking a day with zero matches for the filter looks like
    // the filter is broken, since the list below just goes empty)
    var ws = weekStartOf(selectedDate);
    var strip = document.getElementById("week-strip");
    strip.innerHTML = "";
    for (var i = 0; i < 7; i++) {
      var day = Utils.addDays(ws, i);
      var dayAppts = appointments.filter(function (a) { return a.date === day; });
      var count = dayAppts.filter(function (a) {
        if (a.status === "cancelado" && !filt.status) return false;
        if (filt.employee && a.employeeId !== filt.employee) return false;
        if (filt.service && a.serviceId !== filt.service) return false;
        if (filt.status && a.status !== filt.status) return false;
        return true;
      }).length;
      var el = document.createElement("div");
      el.className = "week-day" + (day === selectedDate ? " active" : "");
      var dnum = Utils.parseDate(day).getDate();
      el.innerHTML = '<div class="wd-name">' + DOW_NAMES[Utils.parseDate(day).getDay()] + '</div>' +
        '<div class="wd-num">' + dnum + '</div>' +
        '<div class="wd-count">' + (count ? count + " ag." : "-") + (day === today ? " · hoje" : "") + '</div>';
      el.addEventListener("click", function (d) { return function () { selectedDate = d; render(); }; }(day));
      strip.appendChild(el);
    }
    if (filterNote) {
      filterNote.textContent = hasFilter ? "Filtro ativo — os números acima também refletem o filtro selecionado." : "";
    }
    // O rótulo central mostra o dia selecionado (navegação é dia a dia); a
    // faixa de dias abaixo continua mostrando a semana como referência
    // rápida para pular para outro dia sem sair da visão do dia.
    var dayLabel = Utils.parseDate(selectedDate).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
    document.getElementById("week-label").textContent = dayLabel;

    document.getElementById("day-title").textContent = "Agendamentos — " + Utils.parseDate(selectedDate).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

    miniCalMonth = selectedDate;
    renderMiniCal();

    renderDayCalendar();
  }

  // Visão Geral: lista todos os agendamentos (sem restringir a um único
  // dia), agrupados por data, respeitando os filtros de Profissional/Status
  // e o período (De/Até) selecionado. É a forma de ver "a agenda completa"
  // de um profissional de uma vez, sem clicar dia a dia.
  function renderGeneralList() {
    var services = DB.all("services"), employees = DB.all("employees"), clients = DB.all("clients");
    var list = DB.all("appointments").filter(function (a) {
      if (periodStart && a.date < periodStart) return false;
      if (periodEnd && a.date > periodEnd) return false;
      if (filt.employee && a.employeeId !== filt.employee) return false;
      if (filt.service && a.serviceId !== filt.service) return false;
      if (filt.status && a.status !== filt.status) return false;
      return true;
    }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });

    var listEl = document.getElementById("day-list");
    if (!list.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-filter-circle-xmark"></i></div>' +
        '<h4>Nenhum agendamento encontrado</h4>' +
        '<p>Ajuste o período ou os filtros de Profissional/Status para ver os agendamentos.</p></div>';
      return;
    }

    var groups = [];
    var groupByDate = {};
    list.forEach(function (a) {
      if (!groupByDate[a.date]) { groupByDate[a.date] = []; groups.push(a.date); }
      groupByDate[a.date].push(a);
    });

    var countLabel = list.length + " agendamento" + (list.length === 1 ? "" : "s") + " encontrado" + (list.length === 1 ? "" : "s");
    var html = '<div class="small text-muted mb-16">' + countLabel + '</div>';

    html += groups.map(function (date) {
      var dayAppts = groupByDate[date];
      var dLabel = Utils.parseDate(date).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
      return '<div class="ag-general-group">' +
        '<div class="ag-general-date">' + dLabel + '</div>' +
        dayAppts.map(function (a) { return apptItemHtml(a, services, employees, clients); }).join("") +
        '</div>';
    }).join("");

    listEl.innerHTML = html;
    wireDayListActions(listEl);
  }

  function statusBadgeHtml(status) {
    if (status === "concluido") return '<span class="badge badge-success">Concluído</span>';
    if (status === "cancelado") return '<span class="badge badge-danger">Cancelado</span>';
    if (status === "faltou") return '<span class="badge badge-warning">Faltou</span>';
    return '<span class="badge badge-info">Agendado</span>';
  }

  function apptItemHtml(a, services, employees, clients) {
    var s = services.find(function (x) { return x.id === a.serviceId; });
    var e = employees.find(function (x) { return x.id === a.employeeId; });
    var c = clients.find(function (x) { return x.id === a.clientId; });
    var asst = a.assistantId ? employees.find(function (x) { return x.id === a.assistantId; }) : null;
    var actions = "";
    if (a.status === "agendado") {
      actions = '<button class="btn btn-sm btn-outline" data-conclude="' + a.id + '">Concluir</button>' +
        '<button class="btn btn-sm btn-ghost" data-cancel="' + a.id + '">Cancelar</button>';
    }
    return '<div class="agenda-item">' +
      '<div class="ai-time">' + a.time + '</div>' +
      '<div class="avatar">' + Utils.initials(c ? c.name : "?") + '</div>' +
      '<div class="ai-main">' +
        '<div class="ai-service">' + Utils.escapeHtml(s ? s.name : "-") + ' — ' + Utils.escapeHtml(c ? c.name : "-") + '</div>' +
        '<div class="ai-meta">Profissional: ' + Utils.escapeHtml(e ? e.name : "-") + (asst ? ' · Assistente: ' + Utils.escapeHtml(asst.name) : '') + ' · ' + Utils.fmtMoney(a.price) + '</div>' +
      '</div>' +
      statusBadgeHtml(a.status) +
      '<div class="flex gap-6">' + actions +
        '<button class="btn btn-icon btn-ghost" data-edit="' + a.id + '" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="btn btn-icon btn-ghost" data-del="' + a.id + '" title="Excluir"><i class="fa-solid fa-trash"></i></button>' +
      '</div>' +
      '</div>';
  }

  function wireDayListActions(listEl) {
    Utils.qsa("[data-conclude]", listEl).forEach(function (b) { b.addEventListener("click", function () { concludeAppointment(b.getAttribute("data-conclude")); }); });
    Utils.qsa("[data-cancel]", listEl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-cancel");
        var appt = DB.get("appointments", id);
        DB.update("appointments", id, { status: "cancelado" });
        if (appt) DB.log("Agenda", "Cancelou o agendamento de " + appt.date + " " + appt.time);
        Toast.show("Agendamento cancelado", "info"); render();
      });
    });
    Utils.qsa("[data-edit]", listEl).forEach(function (b) { b.addEventListener("click", function () { openApptModal(b.getAttribute("data-edit")); }); });
    Utils.qsa("[data-del]", listEl).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-del");
        Modal.confirm({
          title: "Excluir agendamento", message: "Deseja excluir este agendamento?", danger: true,
          onConfirm: function () {
            var appt = DB.get("appointments", id);
            DB.remove("appointments", id);
            if (appt) DB.log("Agenda", "Excluiu o agendamento de " + appt.date + " " + appt.time);
            Toast.show("Agendamento excluído", "success"); render();
          }
        });
      });
    });
  }

  // ---------------- Visão do Dia: calendário em grade ----------------
  // Uma coluna por profissional ativo (ou só o filtrado), linhas de horário
  // das 08:00 às 21:00, blocos posicionados/dimensionados conforme o
  // horário e a duração do serviço (services.durationMin). Ocorrências
  // (ausências, bloqueios) aparecem como blocos hachurados na mesma grade.
  function timeToMin(t) {
    var p = (t || "00:00").split(":");
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }
  function minToTime(m) {
    m = Math.max(0, Math.min(m, 23 * 60 + 59));
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  }

  function renderDayCalendar() {
    var services = DB.all("services"), employees = DB.all("employees"), clients = DB.all("clients");
    var activeEmployees = employees.filter(function (e) { return e.status === "ativo" && employeePerformsServices(e); })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    var cols = filt.employee ? activeEmployees.filter(function (e) { return e.id === filt.employee; }) : activeEmployees;

    var listEl = document.getElementById("day-list");
    if (!cols.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-user-slash"></i></div>' +
        '<h4>Nenhum profissional para exibir</h4><p>Cadastre profissionais ativos ou ajuste o filtro selecionado.</p></div>';
      return;
    }

    var dayAppts = DB.all("appointments").filter(function (a) {
      if (a.date !== selectedDate) return false;
      if (filt.service && a.serviceId !== filt.service) return false;
      if (filt.status && a.status !== filt.status) return false;
      return true;
    });
    var dayOcc = DB.all("occurrences").filter(function (o) { return o.date === selectedDate; });

    var totalMin = GRID_END_MIN - GRID_START_MIN;
    var totalHeight = Math.round(totalMin * PX_PER_MIN);
    var hourPx = Math.round(60 * PX_PER_MIN);

    var hourLabels = "";
    for (var h = 8; h <= 21; h++) {
      var top = Math.round((h * 60 - GRID_START_MIN) * PX_PER_MIN);
      hourLabels += '<div class="cal-hour-label" style="top:' + top + 'px;">' + String(h).padStart(2, "0") + ':00</div>';
    }

    var headerHtml = '<div class="cal-corner"></div>' + cols.map(function (e) {
      return '<div class="cal-col-header">' + Utils.avatarHtml(e.name, e.photoDataUrl) +
        '<div class="cch-name">' + Utils.escapeHtml(e.name) + '</div>' +
        '<div class="cch-role">' + Utils.escapeHtml(e.role || "") + '</div></div>';
    }).join("");

    var colsHtml = cols.map(function (e) {
      var empAppts = dayAppts.filter(function (a) { return a.employeeId === e.id; });
      var empOcc = dayOcc.filter(function (o) { return o.employeeId === e.id; });
      var blocksHtml = empAppts.map(function (a) { return apptBlockHtml(a, services, clients, employees); }).join("") +
        empOcc.map(function (o) { return occBlockHtml(o); }).join("");
      return '<div class="cal-col" data-employee="' + e.id + '" style="height:' + totalHeight + 'px;background-size:100% ' + hourPx + 'px;">' + blocksHtml + '</div>';
    }).join("");

    listEl.innerHTML =
      '<div class="cal-scroll"><div class="cal-grid-inner" style="grid-template-columns:56px repeat(' + cols.length + ', minmax(128px,1fr));">' +
        headerHtml +
        '<div class="cal-time-axis" style="height:' + totalHeight + 'px;">' + hourLabels + '</div>' +
        colsHtml +
      '</div></div>';

    wireCalendarActions(listEl);
  }

  function apptBlockHtml(a, services, clients, employees) {
    var s = services.find(function (x) { return x.id === a.serviceId; });
    var c = clients.find(function (x) { return x.id === a.clientId; });
    var startMin = timeToMin(a.time);
    var dur = (s && s.durationMin) ? s.durationMin : 30;
    var top = Math.round((startMin - GRID_START_MIN) * PX_PER_MIN);
    var height = Math.max(Math.round(dur * PX_PER_MIN), 24);
    var hasAsst = a.assistantId && employees.find(function (x) { return x.id === a.assistantId; });
    return '<div class="cal-block status-' + (a.status || "agendado") + '" style="top:' + top + 'px;height:' + height + 'px;" data-appt-id="' + a.id + '" title="' +
      Utils.escapeHtml((s ? s.name : "") + " - " + (c ? c.name : "")) + '">' +
      '<div class="cb-time">' + a.time + (hasAsst ? ' <i class="fa-solid fa-user-plus" title="Com assistente"></i>' : '') + '</div>' +
      '<div class="cb-title">' + Utils.escapeHtml(s ? s.name : "-") + '</div>' +
      '<div class="cb-meta">' + Utils.escapeHtml(c ? c.name : "-") + '</div>' +
    '</div>';
  }

  function occBlockHtml(o) {
    var startMin = timeToMin(o.startTime), endMin = timeToMin(o.endTime);
    var top = Math.round((startMin - GRID_START_MIN) * PX_PER_MIN);
    var height = Math.max(Math.round((endMin - startMin) * PX_PER_MIN), 24);
    return '<div class="cal-occ-block" style="top:' + top + 'px;height:' + height + 'px;" data-occ-id="' + o.id + '">' +
      '<div class="cb-time">' + o.startTime + '–' + o.endTime + (o.attachment ? ' <i class="fa-solid fa-paperclip" title="Com anexo"></i>' : '') + '</div>' +
      '<div class="cb-title"><i class="fa-solid fa-ban"></i> ' + Utils.escapeHtml(o.type || "Ausência") + '</div>' +
      (o.note ? '<div class="cb-meta">' + Utils.escapeHtml(o.note) + '</div>' : '') +
    '</div>';
  }

  function wireCalendarActions(listEl) {
    Utils.qsa(".cal-block", listEl).forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); openApptModal(b.getAttribute("data-appt-id")); });
    });
    Utils.qsa(".cal-occ-block", listEl).forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); openOccurrenceModal({ id: b.getAttribute("data-occ-id") }); });
    });
    Utils.qsa(".cal-col", listEl).forEach(function (col) {
      col.addEventListener("click", function (e) {
        if (e.target.closest(".cal-block") || e.target.closest(".cal-occ-block")) return;
        var rect = col.getBoundingClientRect();
        var offsetY = e.clientY - rect.top;
        var minutes = GRID_START_MIN + offsetY / PX_PER_MIN;
        minutes = Math.round(minutes / 15) * 15;
        minutes = Math.max(GRID_START_MIN, Math.min(minutes, GRID_END_MIN - 15));
        openSlotMenu(col.getAttribute("data-employee"), selectedDate, minToTime(minutes));
      });
    });
  }

  // Ao clicar em um horário vazio da grade, oferece as duas ações que fazem
  // sentido ali: marcar um novo atendimento ou sinalizar uma ocorrência
  // (ausência médica, bloqueio etc.) que impede atendimentos naquele trecho.
  function openSlotMenu(employeeId, date, time) {
    var emp = DB.get("employees", employeeId);
    var body = '<p class="small text-muted" style="margin-bottom:14px;">' +
      (emp ? Utils.escapeHtml(emp.name) : "") + ' · ' + Utils.parseDate(date).toLocaleDateString("pt-BR") + ' às ' + time + '</p>' +
      '<div class="flex" style="gap:10px;flex-direction:column;">' +
      '<button class="btn btn-primary" id="sm-new-appt" style="width:100%;justify-content:center;"><i class="fa-solid fa-calendar-plus"></i> Novo Agendamento</button>' +
      '<button class="btn btn-secondary" id="sm-new-occ" style="width:100%;justify-content:center;"><i class="fa-solid fa-triangle-exclamation"></i> Registrar Ocorrência</button>' +
      '</div>';
    var box = Modal.open({ title: "Novo horário", bodyHtml: body });
    box.querySelector("#sm-new-appt").addEventListener("click", function () {
      Modal.close();
      openApptModal(null, { employeeId: employeeId, date: date, time: time });
    });
    box.querySelector("#sm-new-occ").addEventListener("click", function () {
      Modal.close();
      openOccurrenceModal({ employeeId: employeeId, date: date, startTime: time });
    });
  }

  // ---------------- Ocorrências ----------------
  function openOccurrenceModal(opts) {
    opts = opts || {};
    var o = opts.id ? DB.get("occurrences", opts.id) : null;
    var employees = DB.all("employees").filter(function (e) { return e.status === "ativo"; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var presetEmployeeId = o ? o.employeeId : opts.employeeId;
    var defaultStart = o ? o.startTime : (opts.startTime || "09:00");
    var defaultEnd = o ? o.endTime : (opts.endTime || minToTime(timeToMin(defaultStart) + 60));

    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Profissional</label><select id="om-employee">' +
        employees.map(function (e) { return '<option value="' + e.id + '"' + (presetEmployeeId === e.id ? " selected" : "") + '>' + Utils.escapeHtml(e.name) + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="form-field"><label>Data</label><input type="date" id="om-date" value="' + (o ? o.date : (opts.date || selectedDate)) + '"></div>' +
      '<div class="form-field"><label>Tipo</label><select id="om-type">' +
        OCC_TYPES.map(function (t) { return '<option' + (o && o.type === t ? " selected" : "") + '>' + t + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="form-field"><label>Início</label><input type="time" id="om-start" value="' + defaultStart + '"></div>' +
      '<div class="form-field"><label>Fim</label><input type="time" id="om-end" value="' + defaultEnd + '"></div>' +
      '<div class="form-field full"><label>Observações</label><textarea id="om-note" rows="3" placeholder="Ex.: Dentista, consulta médica...">' + (o && o.note ? Utils.escapeHtml(o.note) : "") + '</textarea></div>' +
      '</div>' +
      '<div class="divider" style="margin:14px 0;"></div>' +
      '<div class="form-field full">' +
        '<label>Anexo (atestado médico, comprovante etc.)</label>' +
        '<div id="om-attach-preview" style="margin-bottom:8px;"></div>' +
        '<label class="btn btn-sm btn-outline" style="cursor:pointer;">Anexar arquivo<input type="file" id="om-attach-input" accept="image/*,application/pdf" style="display:none;"></label>' +
        ' <button type="button" class="btn btn-sm btn-ghost" id="om-attach-remove" style="display:none;">Remover anexo</button>' +
        '<div class="small text-muted mt-8">Foto ou PDF do atestado médico, comprovante de conta ou outro documento que justifique a ocorrência. Tamanho máximo: 4MB.</div>' +
      '</div>';
    var delBtn = o ? '<button class="btn btn-ghost" id="om-delete" style="color:var(--color-danger);">Excluir</button>' : "";
    var foot = delBtn + '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="om-save">Salvar Ocorrência</button>';
    var box = Modal.open({ title: o ? "Editar Ocorrência" : "Registrar Ocorrência", bodyHtml: body, footHtml: foot });

    var attachment = o && o.attachment ? o.attachment : null;
    function renderAttachPreview() {
      var el = box.querySelector("#om-attach-preview");
      var removeBtn = box.querySelector("#om-attach-remove");
      if (!attachment) { el.innerHTML = ""; removeBtn.style.display = "none"; return; }
      var isImg = (attachment.type || "").indexOf("image/") === 0;
      el.innerHTML = isImg
        ? '<a href="' + attachment.dataUrl + '" target="_blank" rel="noopener"><img src="' + attachment.dataUrl + '" alt="Anexo" style="max-width:160px;max-height:120px;border-radius:8px;border:1px solid var(--border-color);"></a>'
        : '<a href="' + attachment.dataUrl + '" target="_blank" rel="noopener"><i class="fa-solid fa-file-pdf"></i> ' + Utils.escapeHtml(attachment.name) + '</a>';
      removeBtn.style.display = "";
    }
    renderAttachPreview();
    box.querySelector("#om-attach-input").addEventListener("change", function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      Utils.fileToAttachmentDataUrl(file, 4 * 1024 * 1024, function (result) {
        if (!result) { Toast.show("Não foi possível carregar esse arquivo", "danger"); return; }
        if (result.error === "toolarge") { Toast.show("Arquivo muito grande (máximo 4MB)", "danger"); return; }
        attachment = result;
        renderAttachPreview();
      });
    });
    box.querySelector("#om-attach-remove").addEventListener("click", function () {
      attachment = null;
      renderAttachPreview();
    });

    if (o) {
      box.querySelector("#om-delete").addEventListener("click", function () {
        Modal.confirm({
          title: "Excluir ocorrência", message: "Deseja excluir esta ocorrência?", danger: true,
          onConfirm: function () {
            DB.remove("occurrences", o.id);
            DB.log("Agenda", "Excluiu ocorrência (" + o.type + ") de " + o.date);
            Toast.show("Ocorrência excluída", "success");
            render();
          }
        });
      });
    }

    box.querySelector("#om-save").addEventListener("click", function () {
      var patch = {
        employeeId: box.querySelector("#om-employee").value,
        date: box.querySelector("#om-date").value,
        type: box.querySelector("#om-type").value,
        startTime: box.querySelector("#om-start").value,
        endTime: box.querySelector("#om-end").value,
        note: box.querySelector("#om-note").value.trim(),
        attachment: attachment
      };
      if (!patch.date || !patch.startTime || !patch.endTime) { Toast.show("Informe data, início e fim", "danger"); return; }
      if (patch.endTime <= patch.startTime) { Toast.show("O horário de fim deve ser depois do início", "danger"); return; }
      if (o) {
        DB.update("occurrences", o.id, patch);
        DB.log("Agenda", "Atualizou ocorrência (" + patch.type + ") de " + patch.date);
        Toast.show("Ocorrência atualizada", "success");
      } else {
        DB.insert("occurrences", patch);
        DB.log("Agenda", "Registrou ocorrência (" + patch.type + ") para " + patch.date);
        Toast.show("Ocorrência registrada", "success");
      }
      Modal.close();
      selectedDate = patch.date;
      render();
    });
  }

  // Linha de "Insumo/Produto" opcional ao concluir um atendimento: ou é
  // consumo interno durante o serviço (custo dividido 50/50 com o
  // profissional — ver assets/js/consumo.js) ou é um produto que o cliente
  // leva para casa (vira uma venda normal, gera receita).
  var _insumoRowSeq = 0;
  function insumoRowHtml() {
    var id = "ir" + (++_insumoRowSeq);
    var consumoProducts = window.Consumo ? Consumo.produtosElegiveis() : [];
    return '<div class="sale-item-row insumo-item-row" data-row-id="' + id + '">' +
      '<button type="button" class="btn btn-icon btn-ghost si-remove ir-remove" title="Remover item"><i class="fa-solid fa-xmark"></i></button>' +
      '<div class="form-grid">' +
        '<div class="form-field full"><label>Tipo</label><select class="ir-tipo">' +
          '<option value="consumo">Consumo interno (custo dividido 50/50)</option>' +
          '<option value="levado">Produto levado pelo cliente (venda)</option>' +
        '</select></div>' +
        '<div class="form-field"><label>Produto</label><select class="ir-produto">' +
          consumoProducts.map(function (p) { return '<option value="' + p.id + '">' + Utils.escapeHtml(p.name) + '</option>'; }).join("") +
        '</select></div>' +
        '<div class="form-field"><label>Quantidade</label><div class="flex items-center gap-6">' +
          '<input type="number" class="ir-qtd" step="0.1" min="0" placeholder="Qtd.">' +
          '<span class="small text-muted ir-unit" style="min-width:24px;"></span>' +
        '</div></div>' +
      '</div>' +
      '</div>';
  }

  function wireInsumoRow(row) {
    var tipoSel = row.querySelector(".ir-tipo");
    var prodSel = row.querySelector(".ir-produto");
    var unitEl = row.querySelector(".ir-unit");
    function refillProducts() {
      var list = tipoSel.value === "consumo"
        ? (window.Consumo ? Consumo.produtosElegiveis() : [])
        : DB.all("products").filter(function (p) { return p.type === "revenda"; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      prodSel.innerHTML = list.map(function (p) { return '<option value="' + p.id + '">' + Utils.escapeHtml(p.name) + '</option>'; }).join("");
      updateUnit();
    }
    function updateUnit() {
      var p = DB.get("products", prodSel.value);
      if (!p) { unitEl.textContent = ""; return; }
      unitEl.textContent = tipoSel.value === "consumo" && window.Consumo ? Consumo.unitLabelOf(p) : (p.unit || "un");
    }
    tipoSel.addEventListener("change", refillProducts);
    prodSel.addEventListener("change", updateUnit);
    row.querySelector(".ir-remove").addEventListener("click", function () { row.remove(); });
    updateUnit();
  }

  function concludeAppointment(apptId) {
    var appt = DB.get("appointments", apptId);
    if (!appt) return;
    var service = DB.get("services", appt.serviceId);
    var client = DB.get("clients", appt.clientId);
    var category = DB.findOne("categories", function (c) { return c.id === service.categoryId; });
    var costCenter = DB.findOne("costCenters", function (c) { return c.key === "operacional"; });

    var body = '<div class="form-grid">' +
      '<div class="form-field"><label>Valor Cobrado (R$)</label><input type="number" step="0.01" id="cc-amount" value="' + appt.price + '"></div>' +
      '<div class="form-field"><label>Forma de Pagamento</label><select id="cc-pay">' + PAYMENT_OPTIONS.map(function (p) { return "<option>" + p + "</option>"; }).join("") + '</select></div>' +
      '</div>' +
      '<div class="divider" style="margin:14px 0;"></div>' +
      '<div class="flex items-center justify-between mb-8">' +
        '<label style="font-weight:600;">Insumos / Produtos (opcional)</label>' +
        '<button type="button" class="btn btn-sm btn-outline" id="cc-add-insumo"><i class="fa-solid fa-plus"></i> Adicionar item</button>' +
      '</div>' +
      '<div id="cc-insumo-rows"></div>' +
      '<div class="small text-muted">Consumo interno divide o custo 50/50 com ' + Utils.escapeHtml(DB.get("employees", appt.employeeId) ? DB.get("employees", appt.employeeId).name : "o profissional") + '. "Levado pelo cliente" gera uma venda normal.</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cc-save">Confirmar Conclusão</button>';
    var box = Modal.open({ title: "Concluir Atendimento", wide: true, bodyHtml: body, footHtml: foot });

    var rowsEl = box.querySelector("#cc-insumo-rows");
    box.querySelector("#cc-add-insumo").addEventListener("click", function () {
      rowsEl.insertAdjacentHTML("beforeend", insumoRowHtml());
      wireInsumoRow(rowsEl.lastElementChild);
    });

    box.querySelector("#cc-save").addEventListener("click", function () {
      var amount = parseFloat(box.querySelector("#cc-amount").value) || appt.price;
      var rows = Utils.qsa(".insumo-item-row", rowsEl);
      var revendaCat = DB.findOne("categories", function (c) { return c.name === "Venda de Produtos"; });
      var comercialCc = DB.findOne("costCenters", function (c) { return c.key === "comercial"; });

      DB.batch(function () {
        DB.update("appointments", appt.id, { status: "concluido", price: amount });
        DB.insert("transactions", {
          type: "receita", description: service.name + " - " + client.name, amount: round2(amount),
          date: appt.date, categoryId: category ? category.id : null, costCenterId: costCenter ? costCenter.id : null,
          paymentMethod: box.querySelector("#cc-pay").value, status: "pago",
          employeeId: appt.employeeId, clientId: appt.clientId, appointmentId: appt.id, reconciled: false
        });

        rows.forEach(function (row) {
          var tipo = row.querySelector(".ir-tipo").value;
          var productId = row.querySelector(".ir-produto").value;
          var qtd = parseFloat(row.querySelector(".ir-qtd").value) || 0;
          if (!productId || qtd <= 0) return;
          if (tipo === "consumo") {
            if (window.Consumo) {
              try {
                Consumo.register({ productId: productId, employeeId: appt.employeeId, appointmentId: appt.id, clientId: appt.clientId, date: appt.date, quantity: qtd, notes: service.name });
              } catch (err) { Toast.show(String(err), "danger"); }
            }
          } else {
            var product = DB.get("products", productId);
            if (!product) return;
            var saleAmount = round2((product.salePrice || product.costPrice || 0) * qtd);
            DB.update("products", productId, { currentStock: Math.max(0, round2((product.currentStock || 0) - qtd)) });
            DB.insert("stockMovements", { productId: productId, type: "saida", reason: "venda", quantity: qtd, date: appt.date, notes: "Levado por " + client.name + " (atendimento)" });
            DB.insert("transactions", {
              type: "receita", description: "Produto - " + product.name + " (" + client.name + ")", amount: saleAmount, date: appt.date,
              categoryId: revendaCat ? revendaCat.id : null, costCenterId: comercialCc ? comercialCc.id : null,
              paymentMethod: box.querySelector("#cc-pay").value, status: "pago", employeeId: appt.employeeId, clientId: appt.clientId,
              productId: productId, appointmentId: appt.id, reconciled: false
            });
          }
        });
      });

      DB.log("Agenda", "Concluiu o atendimento " + service.name + " - " + client.name + " (" + Utils.fmtMoney(amount) + ")" + (rows.length ? " com " + rows.length + " item(ns) de insumo/produto" : ""));
      // Enfileira o pedido de avaliação por WhatsApp (envio manual, mesmo
      // fluxo da confirmação de agendamento) — a pedido do cliente, toda
      // conclusão de atendimento deve gerar esse pedido para o cliente.
      if (window.Notificacoes) Notificacoes.queueReviewRequest(DB.get("appointments", appt.id));
      Modal.close();
      Toast.show("Atendimento concluído e lançamento financeiro gerado", "success");
      render();
    });
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // Cargos que sempre contaram como "realiza serviços" antes desse campo
  // existir no funcionário (ver employeePerformsServices) — usado só como
  // valor padrão para quem já estava cadastrado antes desse recurso, para
  // não mudar o comportamento de ninguém que já existia.
  var LEGACY_SERVICE_ROLES = ["Cabeleireiro(a)", "Manicure e Pedicure", "Esteticista", "Maquiador(a)"];
  // Funcionário sem o campo performsServices salvo (cadastros de antes
  // desse recurso existir): mantém o comportamento de sempre — aparecia
  // na Agenda quando o cargo era um dos que já atendiam cliente.
  function employeePerformsServices(e) {
    return e.performsServices !== undefined ? !!e.performsServices : LEGACY_SERVICE_ROLES.indexOf(e.role) !== -1;
  }

  function openApptModal(id, presets) {
    presets = presets || {};
    var a = id ? DB.get("appointments", id) : null;
    var services = DB.all("services").sort(function (x, y) { return x.group.localeCompare(y.group) || x.name.localeCompare(y.name); });
    var employees = DB.all("employees").filter(function (e) { return e.status === "ativo" && employeePerformsServices(e); }).sort(function (x, y) { return x.name.localeCompare(y.name); });
    var allActiveEmployees = DB.all("employees").filter(function (e) { return e.status === "ativo"; }).sort(function (x, y) { return x.name.localeCompare(y.name); });
    var clients = DB.all("clients").sort(function (x, y) { return x.name.localeCompare(y.name); });

    var hasAssistant = !!(a && a.assistantId);
    var canEditCommission = !window.Approvals || Approvals.isAdmin();
    var currentEmployee = a ? DB.all("employees").find(function (e) { return e.id === a.employeeId; }) : null;
    var currentAssistant = a && a.assistantId ? DB.all("employees").find(function (e) { return e.id === a.assistantId; }) : null;

    // Um pedido de alteração de comissão feito ANTES do agendamento existir
    // (tela de Novo Agendamento) não tem um appointmentId para anexar ainda
    // — fica guardado aqui e só vira uma solicitação de verdade (Approvals.request)
    // no momento do "Salvar Agendamento", usando o id recém-criado.
    var pendingCommissionRequest = null;

    function commissionFieldHtml(opts) {
      // opts: { id, label, currentValue, defaultRate, forceEditable }
      if (canEditCommission || opts.forceEditable) {
        return '<div class="form-field"><label>' + opts.label + '</label><input type="number" step="0.1" min="0" max="100" id="' + opts.id + '" placeholder="Padrão do funcionário" value="' + (opts.currentValue != null ? opts.currentValue : "") + '"></div>';
      }
      var displayVal = opts.currentValue != null ? opts.currentValue + "%" : (opts.defaultRate != null ? "Padrão do funcionário (" + opts.defaultRate + "%)" : "Padrão do funcionário");
      return '<div class="form-field"><label>' + opts.label + '</label>' +
        '<input type="text" id="' + opts.id + '-display" value="' + displayVal + '" disabled>' +
        '<div class="commission-request-row" id="' + opts.id + '-req-row">' +
          '<a href="#" class="small" id="' + opts.id + '-req-link">Solicitar alteração</a>' +
          '<div class="commission-request-form" id="' + opts.id + '-req-form" style="display:none;">' +
            '<input type="number" step="0.1" min="0" max="100" id="' + opts.id + '-req-value" placeholder="Nova comissão (%)" style="max-width:140px;">' +
            '<button type="button" class="btn btn-sm btn-primary" id="' + opts.id + '-req-send">Enviar solicitação</button>' +
            '<button type="button" class="btn btn-sm btn-ghost" id="' + opts.id + '-req-cancel">Cancelar</button>' +
          '</div>' +
        '</div>' +
        '</div>';
    }

    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Cliente</label>' +
        '<div class="flex gap-8" style="align-items:center;">' +
          '<select id="am-client" style="flex:1;">' + clients.map(function (c) { return '<option value="' + c.id + '"' + (a && a.clientId === c.id ? " selected" : "") + '>' + Utils.escapeHtml(c.name) + '</option>'; }).join("") + '</select>' +
          (window.ClientesQuick ? '<button type="button" class="btn btn-sm btn-outline" id="am-new-client" style="white-space:nowrap;"><i class="fa-solid fa-user-plus"></i> Criar novo cliente</button>' : "") +
        '</div>' +
        (window.ClientesQuick ? '<div id="am-new-client-panel" style="display:none;border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px;margin-top:8px;background:var(--gray-50);">' + ClientesQuick.inlinePanelHtml("am-nc") + '</div>' : "") +
      '</div>' +
      '<div class="form-field full"><label>Serviço</label><select id="am-service">' + services.map(function (s) { return '<option value="' + s.id + '" data-price="' + s.price + '" data-group="' + s.group + '"' + (a && a.serviceId === s.id ? " selected" : "") + '>' + s.name + " (" + s.group + ")" + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-field"><label>Profissional</label><select id="am-employee"></select></div>' +
      '<div class="form-field"><label>Valor (R$)</label><input type="number" step="0.01" id="am-price" value="' + (a ? a.price : "") + '"></div>' +
      '<div class="form-field"><label>Data</label><input type="date" id="am-date"' + (a ? "" : ' min="' + Utils.todayISO() + '"') + ' value="' + (a ? a.date : (presets.date || selectedDate)) + '"></div>' +
      '<div class="form-field"><label>Hora</label><input type="time" id="am-time" value="' + (a ? a.time : (presets.time || "09:00")) + '"></div>' +
      '<div class="form-field"><label>Status</label><select id="am-status">' +
        '<option value="agendado"' + (a && a.status === "agendado" ? " selected" : "") + '>Agendado</option>' +
        '<option value="concluido"' + (a && a.status === "concluido" ? " selected" : "") + '>Concluído</option>' +
        '<option value="faltou"' + (a && a.status === "faltou" ? " selected" : "") + '>Faltou</option>' +
        '<option value="cancelado"' + (a && a.status === "cancelado" ? " selected" : "") + '>Cancelado</option>' +
        '</select></div>' +
      commissionFieldHtml({ id: "am-comm-pct", label: "Comissão do Profissional (%)", currentValue: a ? a.commissionPercent : null, defaultRate: currentEmployee ? currentEmployee.commissionRate : null }) +
      '</div>' +
      '<div class="divider" style="margin:14px 0;"></div>' +
      '<div class="form-grid">' +
        '<div class="form-field full"><label class="flex items-center gap-6" style="font-weight:600;"><input type="checkbox" id="am-has-assistant" style="width:auto;"' + (hasAssistant ? " checked" : "") + '> Incluir assistente neste atendimento</label></div>' +
        '<div id="am-assistant-fields" class="form-grid" style="grid-column:1/-1;display:' + (hasAssistant ? "grid" : "none") + ';">' +
          '<div class="form-field"><label>Assistente</label><select id="am-assistant">' +
            allActiveEmployees.map(function (e) { return '<option value="' + e.id + '"' + (a && a.assistantId === e.id ? " selected" : "") + '>' + Utils.escapeHtml(e.name) + '</option>'; }).join("") +
          '</select></div>' +
          commissionFieldHtml({ id: "am-assistant-pct", label: "Comissão do Assistente (%)", currentValue: a && a.assistantCommissionPercent != null ? a.assistantCommissionPercent : 10, defaultRate: currentAssistant ? currentAssistant.commissionRate : null, forceEditable: true }) +
        '</div>' +
      '</div>';

    var extraActions = "";
    if (a && a.status === "agendado") {
      extraActions = '<button class="btn btn-outline" id="am-conclude" type="button">Concluir</button>' +
        '<button class="btn btn-ghost" id="am-noshow" type="button">Marcar Falta</button>';
    }
    var delBtn = a ? '<button class="btn btn-ghost" id="am-delete" type="button" style="color:var(--color-danger);">Excluir</button>' : "";
    var foot = delBtn + extraActions + '<button class="btn btn-secondary" data-close-modal>Fechar</button><button class="btn btn-primary" id="am-save">Salvar Agendamento</button>';
    var box = Modal.open({ title: a ? "Editar Agendamento" : "Novo Agendamento", wide: true, bodyHtml: body, footHtml: foot });

    // Preenche o campo de comissão do profissional automaticamente com a
    // taxa padrão cadastrada no funcionário (Funcionários → Comissão), sem
    // travar a edição manual: só atualiza o campo se ele ainda não tiver
    // sido alterado à mão pelo usuário (compara com o último valor que a
    // própria função preencheu, guardado em data-auto-value).
    function updateDefaultCommission() {
      var commInput = box.querySelector("#am-comm-pct");
      if (!commInput || a) return; // em edição de um agendamento existente não sobrescreve o valor já salvo
      var empSel = box.querySelector("#am-employee");
      var emp = empSel && empSel.value ? DB.get("employees", empSel.value) : null;
      var autoVal = emp && emp.commissionRate != null ? String(emp.commissionRate) : "";
      var lastAuto = commInput.getAttribute("data-auto-value") || "";
      if (commInput.value === "" || commInput.value === lastAuto) {
        commInput.value = autoVal;
        commInput.setAttribute("data-auto-value", autoVal);
      }
    }

    // Lista todos os funcionários que realizam serviços (ver
    // employeePerformsServices) como opção de Profissional — não filtra
    // mais por um grupo de serviço específico do cargo.
    function fillEmployeesFor() {
      var empSel = box.querySelector("#am-employee");
      var presetEmployeeId = a ? a.employeeId : presets.employeeId;
      empSel.innerHTML = employees.length
        ? employees.map(function (e) { return '<option value="' + e.id + '"' + (presetEmployeeId === e.id ? " selected" : "") + '>' + Utils.escapeHtml(e.name) + '</option>'; }).join("")
        : '<option value="">Nenhum profissional cadastrado</option>';
      updateDefaultCommission();
    }
    var serviceSel = box.querySelector("#am-service");
    var initialOpt = serviceSel.options[serviceSel.selectedIndex];
    fillEmployeesFor();
    // Sem nenhum serviço cadastrado (Configurações → Serviços) o <select> de
    // Serviço fica vazio e não há opção selecionada — nada para preencher.
    if (!a && initialOpt) box.querySelector("#am-price").value = initialOpt.getAttribute("data-price");
    if (!a && !services.length) {
      Toast.show("Nenhum serviço cadastrado ainda. Cadastre serviços em Configurações antes de criar agendamentos.", "danger");
    }

    serviceSel.addEventListener("change", function () {
      var opt = serviceSel.options[serviceSel.selectedIndex];
      if (!opt) return;
      box.querySelector("#am-price").value = opt.getAttribute("data-price");
    });

    box.querySelector("#am-employee").addEventListener("change", updateDefaultCommission);

    box.querySelector("#am-has-assistant").addEventListener("change", function (e) {
      box.querySelector("#am-assistant-fields").style.display = e.target.checked ? "grid" : "none";
      if (e.target.checked) updateDefaultAssistantCommission();
    });

    // Mesma lógica de auto-preenchimento do campo do profissional, aplicada
    // à comissão do assistente: usa a taxa cadastrada no funcionário
    // escolhido como assistente, com 10% como valor de referência quando o
    // funcionário não tem taxa própria definida.
    function updateDefaultAssistantCommission() {
      var pctInput = box.querySelector("#am-assistant-pct");
      if (!pctInput || a) return;
      var asstSel = box.querySelector("#am-assistant");
      var asst = asstSel && asstSel.value ? DB.get("employees", asstSel.value) : null;
      var autoVal = asst && asst.commissionRate != null ? String(asst.commissionRate) : "10";
      var lastAuto = pctInput.getAttribute("data-auto-value") || "10";
      if (pctInput.value === "" || pctInput.value === lastAuto) {
        pctInput.value = autoVal;
        pctInput.setAttribute("data-auto-value", autoVal);
      }
    }
    var asstSelEl = box.querySelector("#am-assistant");
    if (asstSelEl) asstSelEl.addEventListener("change", updateDefaultAssistantCommission);

    var newClientBtn = box.querySelector("#am-new-client");
    var newClientPanel = box.querySelector("#am-new-client-panel");
    if (newClientBtn && newClientPanel) {
      newClientBtn.addEventListener("click", function () {
        newClientPanel.style.display = "";
        newClientBtn.style.display = "none";
      });
      ClientesQuick.wireInlinePanel(newClientPanel, "am-nc",
        function (client) {
          // insere o cliente recém-criado no seletor e já o deixa selecionado
          var clientSel = box.querySelector("#am-client");
          var opt = document.createElement("option");
          opt.value = client.id;
          opt.textContent = client.name;
          clientSel.appendChild(opt);
          clientSel.value = client.id;
          newClientPanel.style.display = "none";
          newClientBtn.style.display = "";
        },
        function () {
          newClientPanel.style.display = "none";
          newClientBtn.style.display = "";
        }
      );
    }

    // Solicitação de alteração de comissão do profissional principal
    // (usuários não-Administrador) — ver commissionFieldHtml acima. Abre um
    // mini-formulário inline em vez de um modal aninhado. Num agendamento já
    // salvo, a solicitação é criada na hora (Approvals.request); numa tela de
    // Novo Agendamento ainda não há appointmentId — a solicitação fica
    // pendente em `pendingCommissionRequest` e só é enviada de fato no clique
    // de "Salvar Agendamento", já com o id recém-criado (ver mais abaixo).
    if (!canEditCommission) {
      var commReqCfg = { id: "am-comm-pct", field: "commissionPercent", who: "profissional (" + (currentEmployee ? currentEmployee.name : "-") + ")" };
      var link = box.querySelector("#" + commReqCfg.id + "-req-link");
      if (link) {
        var reqRow = box.querySelector("#" + commReqCfg.id + "-req-row");
        var form = box.querySelector("#" + commReqCfg.id + "-req-form");
        link.addEventListener("click", function (e) {
          e.preventDefault();
          link.style.display = "none";
          form.style.display = "flex";
        });
        box.querySelector("#" + commReqCfg.id + "-req-cancel").addEventListener("click", function () {
          form.style.display = "none";
          link.style.display = "";
        });
        box.querySelector("#" + commReqCfg.id + "-req-send").addEventListener("click", function () {
          var val = parseFloat(box.querySelector("#" + commReqCfg.id + "-req-value").value);
          if (isNaN(val) || val < 0 || val > 100) { Toast.show("Informe uma comissão válida (0 a 100)", "danger"); return; }
          // Sempre lê o profissional selecionado NO MOMENTO do pedido — numa
          // tela de Novo Agendamento o funcionário pode ter sido trocado
          // depois do modal abrir, então `currentEmployee` (fixado na
          // abertura) não é confiável aqui.
          var selectedEmpId = box.querySelector("#am-employee") ? box.querySelector("#am-employee").value : null;
          var selectedEmp = selectedEmpId ? DB.get("employees", selectedEmpId) : null;
          var who = "profissional (" + (selectedEmp ? selectedEmp.name : (currentEmployee ? currentEmployee.name : "-")) + ")";
          if (a) {
            var current = a[commReqCfg.field];
            var client = DB.get("clients", a.clientId);
            var summary = "Comissão do " + who + " no atendimento de " + Utils.fmtDate(a.date) + " (" + (client ? client.name : "cliente") + "): " +
              (current != null ? current + "%" : "padrão") + " → " + val + "%";
            Approvals.request("comissao_agendamento", summary, { appointmentId: a.id, field: commReqCfg.field, requestedValue: val });
            Toast.show("Solicitação enviada para aprovação de um Administrador", "success");
            reqRow.innerHTML = '<span class="small text-muted">Solicitação enviada — aguardando aprovação.</span>';
          } else {
            pendingCommissionRequest = { field: commReqCfg.field, requestedValue: val, who: who };
            reqRow.innerHTML = '<span class="small text-muted">Solicitação de ' + val + '% será enviada para aprovação ao salvar o agendamento.</span>';
            Toast.show("Solicitação registrada — será enviada ao salvar o agendamento", "info");
          }
        });
      }
    }

    if (a && a.status === "agendado") {
      box.querySelector("#am-conclude").addEventListener("click", function () {
        Modal.close();
        concludeAppointment(a.id);
      });
      box.querySelector("#am-noshow").addEventListener("click", function () {
        DB.update("appointments", a.id, { status: "faltou" });
        DB.log("Agenda", "Marcou falta no agendamento de " + a.date + " " + a.time);
        Modal.close();
        Toast.show("Falta registrada", "info");
        render();
      });
    }
    if (a) {
      box.querySelector("#am-delete").addEventListener("click", function () {
        Modal.confirm({
          title: "Excluir agendamento", message: "Deseja excluir este agendamento?", danger: true,
          onConfirm: function () {
            DB.remove("appointments", a.id);
            DB.log("Agenda", "Excluiu o agendamento de " + a.date + " " + a.time);
            Toast.show("Agendamento excluído", "success");
            render();
          }
        });
      });
    }

    box.querySelector("#am-save").addEventListener("click", function () {
      var hasAsst = box.querySelector("#am-has-assistant").checked;
      // Os campos de comissão só ficam editáveis de verdade para
      // Administrador (ver commissionFieldHtml acima) — para os demais
      // usuários o valor permanece o que já estava salvo (mudanças passam
      // pelo fluxo de solicitação/aprovação, não por este salvamento).
      var commPct;
      if (canEditCommission) {
        var commPctRaw = box.querySelector("#am-comm-pct").value;
        commPct = commPctRaw !== "" ? parseFloat(commPctRaw) : null;
      } else {
        commPct = a ? a.commissionPercent : null;
      }
      // A comissão do assistente fica sempre editável no ato do agendamento
      // (não passa pelo fluxo de aprovação — ver commissionFieldHtml acima).
      var assistantPct = hasAsst ? (parseFloat(box.querySelector("#am-assistant-pct").value) || 0) : null;
      var patch = {
        clientId: box.querySelector("#am-client").value, serviceId: box.querySelector("#am-service").value,
        employeeId: box.querySelector("#am-employee").value, price: round2(parseFloat(box.querySelector("#am-price").value) || 0),
        date: box.querySelector("#am-date").value, time: box.querySelector("#am-time").value,
        status: box.querySelector("#am-status").value,
        commissionPercent: commPct,
        assistantId: hasAsst ? box.querySelector("#am-assistant").value : null,
        assistantCommissionPercent: assistantPct
      };
      if (!patch.date || !patch.time) { Toast.show("Informe data e hora", "danger"); return; }
      if (!patch.employeeId) { Toast.show("Selecione um profissional", "danger"); return; }
      if (hasAsst && !patch.assistantId) { Toast.show("Selecione o assistente ou desmarque a opção", "danger"); return; }
      // Agendamentos com status "agendado" só podem ficar no presente/futuro
      // — não faz sentido marcar um horário que já passou. Edições de
      // atendimentos já concluídos/faltosos/cancelados no passado continuam
      // permitidas normalmente (só valida quando o status final é "agendado").
      if (patch.status === "agendado") {
        var nowD = new Date();
        var nowDateStr = Utils.todayISO();
        var nowTimeStr = String(nowD.getHours()).padStart(2, "0") + ":" + String(nowD.getMinutes()).padStart(2, "0");
        if (patch.date < nowDateStr || (patch.date === nowDateStr && patch.time < nowTimeStr)) {
          Toast.show("Não é possível agendar em uma data/hora que já passou", "danger");
          return;
        }
      }
      var savedAppt;
      if (a) { DB.update("appointments", a.id, patch); savedAppt = DB.get("appointments", a.id); DB.log("Agenda", "Atualizou o agendamento de " + patch.date + " " + patch.time); Toast.show("Agendamento atualizado", "success"); }
      else { savedAppt = DB.insert("appointments", patch); DB.log("Agenda", "Criou um agendamento para " + patch.date + " " + patch.time); Toast.show("Agendamento criado", "success"); }
      // Se uma alteração de comissão do profissional foi pedida antes de o
      // agendamento existir (tela de Novo Agendamento), a solicitação só
      // pôde ser preparada até agora — dispara ela de verdade aqui, já com
      // o id recém-criado.
      if (!a && pendingCommissionRequest) {
        var pcClient = DB.get("clients", savedAppt.clientId);
        var pcSummary = "Comissão do " + pendingCommissionRequest.who + " no atendimento de " + Utils.fmtDate(savedAppt.date) + " (" + (pcClient ? pcClient.name : "cliente") + "): padrão → " + pendingCommissionRequest.requestedValue + "%";
        Approvals.request("comissao_agendamento", pcSummary, { appointmentId: savedAppt.id, field: pendingCommissionRequest.field, requestedValue: pendingCommissionRequest.requestedValue });
        Toast.show("Solicitação de alteração de comissão enviada para aprovação", "info");
      }
      // Enfileira a notificação de confirmação por WhatsApp (envio manual,
      // ver assets/js/notificacoes.js) — idempotente por agendamento, então
      // não duplica se o usuário só editar um agendamento já confirmado.
      if (window.Notificacoes) {
        Notificacoes.queueBookingConfirmation(savedAppt);
        // Cobre também o caso de marcar "Concluído" direto pelo status deste
        // formulário (fora do fluxo dedicado de concludeAppointment acima).
        Notificacoes.queueReviewRequest(savedAppt);
      }
      Modal.close();
      selectedDate = patch.date;
      render();
    });
  }
})();
