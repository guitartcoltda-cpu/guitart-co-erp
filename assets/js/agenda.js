(function () {
  "use strict";

  var selectedDate = Utils.todayISO();
  var filt = { employee: "", service: "", status: "" };
  var viewMode = "dia"; // "dia" | "geral" — geral shows every appointment across all dates, not scoped to a single day
  var periodStart = Utils.todayISO();
  var periodEnd = "";
  // Paginação da Visão Geral (item 5 do plano de otimização) — sem isso,
  // um histórico de meses/anos de agendamentos seria renderizado inteiro
  // de uma vez. Mesmo padrão (PAGE_SIZE + página atual) já usado em
  // financeiro.js/clientes.js.
  var GENERAL_PAGE_SIZE = 30;
  var generalPage = 1;
  var DOW_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  // Lote de migração de histórico (Histórico do Cliente / Base Clientes):
  // esses agendamentos ficam disponíveis na ficha do cliente (Clientes →
  // Histórico), mas não devem aparecer na Agenda — a Agenda mostra apenas
  // agendamentos ativos/futuros de verdade, não o histórico importado.
  var HISTORICAL_IMPORT_BATCH = "migracao-2026-08-31";
  function visibleAppointments() {
    return DB.all("appointments").filter(function (a) { return a._importBatch !== HISTORICAL_IMPORT_BATCH; });
  }
  // Formas de pagamento configuráveis em Configurações → Formas de
  // Pagamento (ver DB.getPaymentMethods em db.js) — busca sempre na hora
  // (não guarda em cache aqui) para refletir qualquer alteração feita lá
  // sem precisar recarregar a página, mesmo padrão de DB.getRoles().
  function paymentMethods() { return DB.getPaymentMethods(); }
  var OCC_TYPES = ["Ausência Médica", "Falta Justificada", "Compromisso Pessoal", "Bloqueio / Manutenção", "Outro"];

  // Grade da Visão do Dia: das 08:00 às 21:00, 0.8px por minuto — compacto o
  // bastante para as 13 horas (780min × 0.8 = 624px) caberem sem precisar da
  // barra de rolagem vertical própria que a caixa (.cal-scroll) tinha antes
  // (removida do CSS): agora, se a grade não couber inteira na tela, é a
  // própria página que rola, em vez de um scroll "preso" dentro da caixa do
  // calendário escondendo parte do dia.
  var GRID_START_MIN = 8 * 60;
  var GRID_END_MIN = 21 * 60;
  var PX_PER_MIN = 0.8;

  // Ocultar/mostrar o mini calendário lateral (a pedido do cliente,
  // 10/09/2026) — para dar o máximo de espaço possível à grade principal de
  // agendamentos. Lembrado por navegador via localStorage, mesmo padrão já
  // usado pelo menu lateral recolhível (ver COLLAPSE_KEY em layout.js). Na
  // Visão Geral o rail some de qualquer forma (não há mini calendário para
  // mostrar ali, já que a lista não é presa a um único dia selecionado).
  var RAIL_COLLAPSE_KEY = "salao_erp_agenda_rail_collapsed";
  var railCollapsed = false;
  try { railCollapsed = localStorage.getItem(RAIL_COLLAPSE_KEY) === "1"; } catch (e) {}

  function updateRailVisibility() {
    var layout = document.querySelector(".ag-layout");
    if (!layout) return;
    layout.classList.toggle("ag-rail-hidden", viewMode !== "dia" || railCollapsed);
    var toggleBtn = document.getElementById("btn-toggle-rail");
    if (toggleBtn) {
      toggleBtn.innerHTML = railCollapsed ? '<i class="fa-solid fa-chevron-right"></i>' : '<i class="fa-solid fa-chevron-left"></i>';
      toggleBtn.title = railCollapsed ? "Mostrar calendário" : "Ocultar calendário";
    }
  }

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  // Funcionário vinculado ao acesso logado (via users.employeeId — ver
  // Configurações → Acessos → "Criar acesso de Funcionário automaticamente").
  // Usado para a Visão do Dia abrir de cara só na coluna desse profissional,
  // em vez de todas as colunas lado a lado (que é o que causava a rolagem
  // horizontal quando tinha muita gente cadastrada).
  function currentEmployeeId() {
    var session = CurrentUser.get();
    if (!session) return null;
    var u = DB.get("users", session.id);
    return (u && u.employeeId) ? u.employeeId : null;
  }

  function init() {
    var empSel = Utils.qs("#ag-employee");
    DB.all("employees").filter(function (e) { return e.status === "ativo"; }).sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (e) {
      var o = document.createElement("option"); o.value = e.id; o.textContent = e.name; empSel.appendChild(o);
    });
    // Abre a Visão do Dia já filtrada no profissional logado, quando o
    // acesso está vinculado a um Funcionário ativo que atende clientes —
    // continua opcional (o strip de fotos e o próprio seletor "Profissional"
    // deixam ver os demais a qualquer momento).
    var myEmpId = currentEmployeeId();
    var myEmp = myEmpId ? DB.get("employees", myEmpId) : null;
    if (myEmp && myEmp.status === "ativo" && employeePerformsServices(myEmp)) {
      filt.employee = myEmpId;
      empSel.value = myEmpId;
    }
    empSel.addEventListener("change", function (e) { filt.employee = e.target.value; generalPage = 1; render(); });
    var srvSel = Utils.qs("#ag-service");
    DB.all("services").sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (s) {
      var o = document.createElement("option"); o.value = s.id; o.textContent = s.name; srvSel.appendChild(o);
    });
    srvSel.addEventListener("change", function (e) { filt.service = e.target.value; generalPage = 1; render(); });
    Utils.qs("#ag-status").addEventListener("change", function (e) { filt.status = e.target.value; generalPage = 1; render(); });
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
        generalPage = 1;
        Utils.qs("#ag-day-nav").style.display = viewMode === "dia" ? "" : "none";
        Utils.qs("#ag-day-nav-main").style.display = viewMode === "dia" ? "" : "none";
        Utils.qs("#ag-period-filters").style.display = viewMode === "geral" ? "" : "none";
        updateRailVisibility();
        render();
      });
    });
    var periodStartInput = Utils.qs("#ag-period-start");
    var periodEndInput = Utils.qs("#ag-period-end");
    periodStartInput.value = periodStart;
    periodStartInput.addEventListener("change", function (e) { periodStart = e.target.value; generalPage = 1; render(); });
    periodEndInput.addEventListener("change", function (e) { periodEnd = e.target.value; generalPage = 1; render(); });
    Utils.qs("#btn-today").addEventListener("click", function () {
      selectedDate = Utils.todayISO();
      if (viewMode !== "dia") {
        viewMode = "dia";
        Utils.qsa(".tab-btn", Utils.qs("#ag-view-tabs")).forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-view") === "dia"); });
        Utils.qs("#ag-day-nav").style.display = "";
        Utils.qs("#ag-day-nav-main").style.display = "";
        Utils.qs("#ag-period-filters").style.display = "none";
        updateRailVisibility();
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

    var toggleRailBtn = Utils.qs("#btn-toggle-rail");
    if (toggleRailBtn) {
      toggleRailBtn.addEventListener("click", function () {
        railCollapsed = !railCollapsed;
        try { localStorage.setItem(RAIL_COLLAPSE_KEY, railCollapsed ? "1" : "0"); } catch (e) {}
        updateRailVisibility();
      });
    }
    updateRailVisibility();

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
    generalPage = 1;
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
    var appointments = visibleAppointments();
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
    // Índices id→registro montados uma vez (em vez de um .find() por
    // agendamento dentro de apptItemHtml, repetido para cada linha da
    // lista) — mesmo resultado, custo O(agendamentos) em vez de
    // O(agendamentos × catálogo).
    var servicesById = {}; services.forEach(function (s) { servicesById[s.id] = s; });
    var employeesById = {}; employees.forEach(function (e) { employeesById[e.id] = e; });
    var clientsById = {}; clients.forEach(function (c) { clientsById[c.id] = c; });
    var list = visibleAppointments().filter(function (a) {
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

    // Pagina ANTES de agrupar por data — sem isso, a Visão Geral renderiza
    // de uma vez todos os agendamentos que passam pelo filtro, o que cresce
    // sem limite conforme o histórico aumenta (mesmo padrão de paginação já
    // usado em financeiro.js/clientes.js).
    var totalPages = Math.max(1, Math.ceil(list.length / GENERAL_PAGE_SIZE));
    generalPage = Math.min(generalPage, totalPages);
    var pageList = list.slice((generalPage - 1) * GENERAL_PAGE_SIZE, generalPage * GENERAL_PAGE_SIZE);

    var groups = [];
    var groupByDate = {};
    pageList.forEach(function (a) {
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
        dayAppts.map(function (a) { return apptItemHtml(a, servicesById, employeesById, clientsById); }).join("") +
        '</div>';
    }).join("");

    html += '<div class="flex justify-between items-center mt-16" id="ag-general-pagination">' +
      '<div class="small text-muted">Mostrando ' + pageList.length + ' de ' + list.length + '</div>' +
      '<div class="pg-btns">' +
        '<button class="btn btn-sm btn-secondary" id="ag-gen-prev" ' + (generalPage <= 1 ? "disabled" : "") + '>Anterior</button>' +
        '<span style="padding:6px 10px;">Página ' + generalPage + ' de ' + totalPages + '</span>' +
        '<button class="btn btn-sm btn-secondary" id="ag-gen-next" ' + (generalPage >= totalPages ? "disabled" : "") + '>Próxima</button>' +
      '</div></div>';

    listEl.innerHTML = html;
    wireDayListActions(listEl);
    var prevBtn = document.getElementById("ag-gen-prev"), nextBtn = document.getElementById("ag-gen-next");
    if (prevBtn) prevBtn.addEventListener("click", function () { generalPage--; renderGeneralList(); });
    if (nextBtn) nextBtn.addEventListener("click", function () { generalPage++; renderGeneralList(); });
  }

  function statusBadgeHtml(status) {
    if (status === "concluido") return '<span class="badge badge-success">Concluído</span>';
    if (status === "cancelado") return '<span class="badge badge-danger">Cancelado</span>';
    if (status === "faltou") return '<span class="badge badge-warning">Faltou</span>';
    return '<span class="badge badge-info">Agendado</span>';
  }

  // `servicesById`/`employeesById`/`clientsById`: Maps/objetos id→registro
  // (ver renderGeneralList, único chamador desta função).
  function apptItemHtml(a, servicesById, employeesById, clientsById) {
    var s = servicesById[a.serviceId];
    var e = employeesById[a.employeeId];
    var c = clientsById[a.clientId];
    var asst = a.assistantId ? employeesById[a.assistantId] : null;
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

  // Duração "de verdade" de um atendimento: usa o valor salvo no próprio
  // agendamento (appt.durationMin) quando existir — é como fica registrado
  // que aquele atendimento específico durou mais (ou menos) do que o padrão
  // do serviço — e cai para a duração cadastrada no serviço (ou 30min) nos
  // demais casos. `serviceObj`, quando informado pelo chamador, evita um
  // DB.get repetido (ver apptBlockHtml).
  function apptDurationMin(appt, serviceObj) {
    if (appt.durationMin != null) return appt.durationMin;
    var s = serviceObj !== undefined ? serviceObj : DB.get("services", appt.serviceId);
    return (s && s.durationMin) ? s.durationMin : 30;
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

    var dayAppts = visibleAppointments().filter(function (a) {
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
      var overlapLayout = computeOverlapLayout(empAppts, services);
      var blocksHtml = empAppts.map(function (a) { return apptBlockHtml(a, services, clients, employees, overlapLayout[a.id]); }).join("") +
        empOcc.map(function (o) { return occBlockHtml(o); }).join("");
      return '<div class="cal-col" data-employee="' + e.id + '" style="height:' + totalHeight + 'px;background-size:100% ' + hourPx + 'px;">' + blocksHtml + '</div>';
    }).join("");

    listEl.innerHTML =
      renderProfStripHtml(activeEmployees) +
      '<div class="cal-scroll"><div class="cal-grid-inner" style="grid-template-columns:56px repeat(' + cols.length + ', minmax(128px,1fr));">' +
        headerHtml +
        '<div class="cal-time-axis" style="height:' + totalHeight + 'px;">' + hourLabels + '</div>' +
        colsHtml +
      '</div></div>';

    wireCalendarActions(listEl);
  }

  // Faixa de fotos acima da grade (ver comentário da .ag-prof-strip em
  // agenda.html): com 0 ou 1 profissional ativo não faz sentido mostrar —
  // não tem entre quem trocar. O profissional já selecionado aparece em
  // destaque; os demais ficam esmaecidos ("de uma certa forma, oculta")
  // até serem clicados. Quando algum filtro de Profissional está ativo,
  // aparece também um chip "Todos" para voltar a ver todo mundo em colunas.
  function renderProfStripHtml(activeEmployees) {
    if (!activeEmployees || activeEmployees.length <= 1) return "";
    var myId = currentEmployeeId();
    var chips = activeEmployees.map(function (e) {
      var isActive = filt.employee === e.id;
      var isSelf = !!(myId && e.id === myId);
      return '<button type="button" class="ag-prof-chip' + (isActive ? " active" : "") + (isSelf ? " is-self" : "") + '" data-employee="' + e.id + '" title="' + Utils.escapeHtml(e.name) + (isSelf ? " (você)" : "") + '">' +
        Utils.avatarHtml(e.name, e.photoDataUrl) +
        '<span class="apc-name">' + Utils.escapeHtml((e.name || "").split(" ")[0]) + '</span>' +
      '</button>';
    }).join("");
    var allChip = filt.employee ?
      '<button type="button" class="ag-prof-chip" data-employee="" title="Ver todos os profissionais">' +
        '<span class="apc-all-icon"><i class="fa-solid fa-users"></i></span><span class="apc-name">Todos</span>' +
      '</button>' : "";
    return '<div class="ag-prof-strip">' + chips + allChip + '</div>';
  }

  // A agenda permite salvar agendamentos sobrepostos (ver comentário mais
  // abaixo, na função de salvar) — mas antes disso, dois agendamentos no
  // mesmo horário do mesmo profissional simplesmente desenhavam um bloco
  // por cima do outro na grade (largura sempre ~100% da coluna), tampando
  // um o outro e deixando só uma tira colorida da borda aparecendo. Isto
  // calcula, para os agendamentos de UM profissional no dia, um "lane"
  // (faixa) e o total de faixas de cada grupo de horários que se cruzam —
  // clássico algoritmo de layout de agenda (tipo Google Agenda): ordena por
  // início, varre marcando o primeiro lane livre entre os que ainda estão
  // "abertos" (não terminaram), e fecha o grupo (fixando quantos lanes ele
  // usou) sempre que não sobra nenhum agendamento aberto — cada novo grupo
  // reinicia a contagem de lanes do zero. O resultado {lane, lanes} de cada
  // agendamento é usado por apptBlockHtml para desenhá-los lado a lado.
  function computeOverlapLayout(empAppts, services) {
    var items = empAppts.map(function (a) {
      var s = services.find(function (x) { return x.id === a.serviceId; });
      var start = timeToMin(a.time);
      var dur = Math.max(apptDurationMin(a, s), 1);
      return { appt: a, start: start, end: start + dur };
    }).sort(function (x, y) { return x.start - y.start || x.end - y.end; });

    var layout = {};
    var active = []; // { end, lane } dos agendamentos ainda "abertos" no grupo atual
    var group = [];
    var groupMaxLane = 0;

    function closeGroup() {
      if (!group.length) return;
      var lanes = groupMaxLane + 1;
      group.forEach(function (it) { layout[it.appt.id].lanes = lanes; });
      group = [];
      groupMaxLane = 0;
    }

    items.forEach(function (it) {
      active = active.filter(function (x) { return x.end > it.start; });
      if (!active.length) closeGroup(); // ninguém mais aberto: fecha o grupo anterior e recomeça
      var usedLanes = {};
      active.forEach(function (x) { usedLanes[x.lane] = true; });
      var lane = 0;
      while (usedLanes[lane]) lane++;
      layout[it.appt.id] = { lane: lane, lanes: 1 };
      groupMaxLane = Math.max(groupMaxLane, lane);
      active.push({ end: it.end, lane: lane });
      group.push(it);
    });
    closeGroup();
    return layout;
  }

  function apptBlockHtml(a, services, clients, employees, layoutInfo) {
    var s = services.find(function (x) { return x.id === a.serviceId; });
    var c = clients.find(function (x) { return x.id === a.clientId; });
    var startMin = timeToMin(a.time);
    var dur = apptDurationMin(a, s);
    var top = Math.round((startMin - GRID_START_MIN) * PX_PER_MIN);
    var height = Math.max(Math.round(dur * PX_PER_MIN), 24);
    var hasAsst = a.assistantId && employees.find(function (x) { return x.id === a.assistantId; });
    // Quando a duração deste atendimento foi ajustada manualmente (diferente
    // do padrão do serviço), mostra um ícone de relógio no bloco — sinaliza
    // visualmente, sem abrir o agendamento, que esse horário foi remarcado
    // por causa de um atendimento que durou mais (ou menos) que o esperado.
    var durAdjusted = a.durationMin != null;
    // Lado a lado quando sobrepõe outro(s) agendamento(s) do mesmo
    // profissional (ver computeOverlapLayout) — sem sobreposição, mantém a
    // largura cheia de sempre (left/right definidos pela classe .cal-block).
    var lanes = (layoutInfo && layoutInfo.lanes) || 1;
    var posStyle = "";
    if (lanes > 1) {
      var lane = layoutInfo.lane;
      posStyle = "left:calc(3px + (100% - 6px) * " + lane + " / " + lanes + ");" +
        "width:calc((100% - 6px) / " + lanes + " - 3px);";
    }
    return '<div class="cal-block status-' + (a.status || "agendado") + '" style="top:' + top + 'px;height:' + height + 'px;' + posStyle + '" data-appt-id="' + a.id + '" title="' +
      Utils.escapeHtml((s ? s.name : "") + " - " + (c ? c.name : "") + (durAdjusted ? " (" + dur + "min)" : "")) + '">' +
      '<div class="cb-time">' + a.time + (hasAsst ? ' <i class="fa-solid fa-user-plus" title="Com assistente"></i>' : '') + (durAdjusted ? ' <i class="fa-solid fa-clock" title="Duração ajustada: ' + dur + ' min"></i>' : '') + '</div>' +
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
    Utils.qsa(".ag-prof-chip", listEl).forEach(function (chip) {
      chip.addEventListener("click", function () {
        var empId = chip.getAttribute("data-employee") || "";
        filt.employee = empId;
        var empSel = document.getElementById("ag-employee");
        if (empSel) empSel.value = empId;
        generalPage = 1;
        render();
      });
    });
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
      '<div class="form-field full"><label>Profissional</label>' + NameCombo.html({ id: "om-employee", items: employees.map(function (e) { return { id: e.id, label: e.name }; }), value: presetEmployeeId || "", placeholder: "Nome e sobrenome do profissional" }) + '</div>' +
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
    NameCombo.wire(box, { id: "om-employee", items: employees.map(function (e) { return { id: e.id, label: e.name }; }) });

    var attachment = o && o.attachment ? o.attachment : null;
    var initialAttachmentRef = attachment;
    // O anexo do cache é "leve" (sem o dataUrl — ver BOOT_VIEW em db.js);
    // busca a versão completa em segundo plano só para corrigir o preview
    // (a gravação em si já está protegida mesmo que o usuário salve antes
    // disso terminar — ver remoteUpsert em db.js). Só substitui se o
    // usuário não mexeu no anexo enquanto a busca corria (removeu, ou
    // trocou por outro arquivo) — senão estaríamos desfazendo a ação dele.
    if (o && o.attachment) {
      DB.getAttachmentFull("occurrences", o.id).then(function (full) {
        if (full && attachment === initialAttachmentRef) { attachment = full; renderAttachPreview(); }
      });
    }
    function renderAttachPreview() {
      var el = box.querySelector("#om-attach-preview");
      var removeBtn = box.querySelector("#om-attach-remove");
      if (!attachment) { el.innerHTML = ""; removeBtn.style.display = "none"; return; }
      var isImg = (attachment.type || "").indexOf("image/") === 0;
      // <a href> usa blob: URL, não a data: URL direto — o Chrome bloqueia
      // navegação de aba para data: URL (ver Utils.dataUrlToBlobUrl em
      // utils.js). O <img src> pode continuar com a data: URL normalmente.
      var openUrl = Utils.dataUrlToBlobUrl(attachment.dataUrl) || attachment.dataUrl || "#";
      el.innerHTML = isImg
        ? '<a href="' + openUrl + '" target="_blank" rel="noopener"><img src="' + attachment.dataUrl + '" alt="Anexo" style="max-width:160px;max-height:120px;border-radius:8px;border:1px solid var(--border-color);"></a>'
        : '<a href="' + openUrl + '" target="_blank" rel="noopener"><i class="fa-solid fa-file-pdf"></i> ' + Utils.escapeHtml(attachment.name) + '</a>';
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

  // Ponto de entrada de "Concluir": quando o cliente tem só um atendimento
  // agendado naquele DIA, segue o fluxo simples de sempre. Quando tem mais
  // de um agendado no mesmo dia — mesmo em horários diferentes (ex.: corte
  // às 10h e escova às 15h, ou dois serviços simultâneos com profissionais
  // diferentes) — pergunta se o usuário quer concluir só este atendimento
  // ou fechar a conta completa do dia de uma vez (consolidado "Fechar
  // Conta", mencionando cada profissional envolvido). Antes o consolidado
  // só considerava o mesmo horário exato e era sempre forçado; agora
  // considera o dia inteiro e vira uma escolha, a pedido do usuário.
  function concludeAppointment(apptId) {
    var appt = DB.get("appointments", apptId);
    if (!appt) return;
    // Sessão de pacote (2ª em diante — a 1ª é a venda, com cobrança normal
    // e pelo fluxo de conclusão comum) vai sempre pelo fluxo simplificado
    // dedicado, independente de haver outros atendimentos do mesmo cliente
    // no mesmo dia — o dinheiro já foi todo cobrado na venda, então não há
    // escolha "só este × fechar conta" nem reconciliação a fazer aqui.
    if (appt.packagePurchaseId && appt.packageSessionIndex > 1) { openConcludePackageSessionModal(appt); return; }
    var group = DB.all("appointments").filter(function (x) {
      return x.status === "agendado" && x.clientId === appt.clientId && x.date === appt.date;
    }).sort(function (a, b) { return a.time.localeCompare(b.time); });
    if (group.length > 1) openConcludeChoiceModal(appt, group);
    else openConcludeSingleModal(appt);
  }

  // Pergunta se o usuário quer concluir só o atendimento clicado ou fechar a
  // conta completa do cliente naquele dia (todos os atendimentos "agendado"
  // do dia, não só os do mesmo horário) — ver comentário de
  // concludeAppointment acima.
  function openConcludeChoiceModal(appt, group) {
    var client = DB.get("clients", appt.clientId);
    var employeesById = {}; DB.all("employees").forEach(function (e) { employeesById[e.id] = e; });
    var servicesById = {}; DB.all("services").forEach(function (s) { servicesById[s.id] = s; });
    var listHtml = group.map(function (g) {
      var s = servicesById[g.serviceId], e = employeesById[g.employeeId];
      var isThis = g.id === appt.id;
      return '<div class="small' + (isThis ? '' : ' text-muted') + '" style="padding:3px 0;">' + g.time + ' — ' + Utils.escapeHtml(s ? s.name : "Serviço") + ' (' + Utils.escapeHtml(e ? e.name : "-") + ')' + (isThis ? ' <strong>(este)</strong>' : '') + '</div>';
    }).join("");
    var body = '<p class="small text-muted" style="margin-bottom:10px;">' + Utils.escapeHtml(client ? client.name : "Cliente") + ' tem ' + group.length + ' atendimentos agendados para ' + Utils.fmtDate(appt.date) + ':</p>' +
      listHtml +
      '<div class="flex" style="gap:10px;flex-direction:column;margin-top:16px;">' +
      '<button class="btn btn-primary" id="cc-choice-single" style="width:100%;justify-content:center;">Concluir só este atendimento</button>' +
      '<button class="btn btn-secondary" id="cc-choice-group" style="width:100%;justify-content:center;">Fechar conta completa (' + group.length + ' atendimentos)</button>' +
      '</div>';
    var box = Modal.open({ title: "Concluir atendimento", bodyHtml: body });
    box.querySelector("#cc-choice-single").addEventListener("click", function () { Modal.close(); openConcludeSingleModal(appt); });
    box.querySelector("#cc-choice-group").addEventListener("click", function () { Modal.close(); openConcludeGroupModal(group); });
  }

  // ---------------- Parceria (forma de pagamento sem cobrança do cliente) ----------------
  // Quando a forma de pagamento escolhida ao concluir/fechar conta tem
  // isParceria=true (ver Configurações → Formas de Pagamento), o cliente
  // não paga nada pelo atendimento — o valor do atendimento vira só a base
  // para dividir o custo entre o profissional e o salão, numa porcentagem
  // que parte da comissão cadastrada no funcionário, mas pode ser negociada
  // por atendimento. Mesmo espírito (e mesmo componente visual) do campo
  // de comissão do profissional em openApptModal/commissionFieldHtml: quem
  // não é Administrador só pode solicitar a alteração, que precisa ser
  // aprovada em Configurações → Aprovações antes de valer.
  var canEditParceriaSplit = !window.Approvals || Approvals.isAdmin();

  function isParceriaMethod(methodName, methods) {
    var pm = (methods || paymentMethods()).find(function (p) { return p.name === methodName; });
    return !!(pm && pm.isParceria);
  }

  function parceriaSplitFieldHtml(opts) {
    // opts: { id, appt, employee }
    // Reaproveita o mesmo campo `commissionPercent` já usado pela comissão
    // normal do agendamento (ver openApptModal/commissionFieldHtml) — em
    // vez de um campo paralelo, para que a % negociada da Parceria entre
    // automaticamente no cálculo de comissão/pagamento (Comissionamento),
    // sem duplicar/perder sincronismo com Utils.apptCommissionSplit.
    var currentValue = opts.appt.commissionPercent;
    var defaultRate = opts.employee ? opts.employee.commissionRate : null;
    if (canEditParceriaSplit) {
      var val = currentValue != null ? currentValue : (defaultRate != null ? defaultRate : "");
      return '<div class="form-field"><label>% do Profissional (Parceria)</label><input type="number" step="0.1" min="0" max="100" id="' + opts.id + '" placeholder="Padrão do funcionário" value="' + val + '"></div>' +
        '<div class="form-field"><div class="small text-muted" style="margin-top:26px;">O restante do valor fica com o salão.</div></div>';
    }
    var displayVal = currentValue != null ? currentValue + "%" : (defaultRate != null ? "Padrão do funcionário (" + defaultRate + "%)" : "Padrão do funcionário");
    return '<div class="form-field"><label>% do Profissional (Parceria)</label>' +
      '<input type="text" id="' + opts.id + '-display" value="' + displayVal + '" disabled>' +
      '<div class="commission-request-row" id="' + opts.id + '-req-row">' +
        '<a href="#" class="small" id="' + opts.id + '-req-link">Solicitar alteração</a>' +
        '<div class="commission-request-form" id="' + opts.id + '-req-form" style="display:none;">' +
          '<input type="number" step="0.1" min="0" max="100" id="' + opts.id + '-req-value" placeholder="Novo % (profissional)" style="max-width:140px;">' +
          '<button type="button" class="btn btn-sm btn-primary" id="' + opts.id + '-req-send">Enviar solicitação</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" id="' + opts.id + '-req-cancel">Cancelar</button>' +
        '</div>' +
      '</div></div>';
  }

  function wireParceriaSplitRequest(box, opts) {
    // opts: { id, appt, employee }
    if (canEditParceriaSplit) return;
    var link = box.querySelector("#" + opts.id + "-req-link");
    if (!link) return;
    var reqRow = box.querySelector("#" + opts.id + "-req-row");
    var form = box.querySelector("#" + opts.id + "-req-form");
    link.addEventListener("click", function (e) {
      e.preventDefault();
      link.style.display = "none";
      form.style.display = "flex";
    });
    box.querySelector("#" + opts.id + "-req-cancel").addEventListener("click", function () {
      form.style.display = "none";
      link.style.display = "";
    });
    box.querySelector("#" + opts.id + "-req-send").addEventListener("click", function () {
      var val = parseFloat(box.querySelector("#" + opts.id + "-req-value").value);
      if (isNaN(val) || val < 0 || val > 100) { Toast.show("Informe uma porcentagem válida (0 a 100)", "danger"); return; }
      var client = DB.get("clients", opts.appt.clientId);
      var current = opts.appt.commissionPercent;
      var summary = "Divisão Parceria do profissional (" + (opts.employee ? opts.employee.name : "-") + ") no atendimento de " + Utils.fmtDate(opts.appt.date) + " (" + (client ? client.name : "cliente") + "): " +
        (current != null ? current + "%" : "padrão") + " → " + val + "%";
      Approvals.request("parceria_split", summary, { appointmentId: opts.appt.id, field: "commissionPercent", requestedValue: val });
      Toast.show("Solicitação enviada para aprovação de um Administrador", "success");
      reqRow.innerHTML = '<span class="small text-muted">Solicitação enviada — aguardando aprovação.</span>';
    });
  }

  // Porcentagem do profissional a usar de fato ao concluir: o que o
  // Administrador digitou agora (se ele pode editar direto), senão o que já
  // estava salvo no agendamento, senão a comissão padrão do funcionário —
  // mesma cascata usada para a comissão normal (commissionPercent).
  function resolvedParceriaSplitPercent(box, id, appt, employee) {
    if (canEditParceriaSplit) {
      var input = box.querySelector("#" + id);
      var v = input ? parseFloat(input.value) : NaN;
      if (!isNaN(v)) return Math.max(0, Math.min(100, v));
    }
    if (appt.commissionPercent != null) return appt.commissionPercent;
    return (employee && employee.commissionRate != null) ? employee.commissionRate : 0;
  }

  var _parceriaCatId;
  function parceriaCatId() {
    if (_parceriaCatId !== undefined) return _parceriaCatId;
    var c = DB.findOne("categories", function (x) { return x.name === "Parceria" && x.type === "despesa"; });
    _parceriaCatId = c ? c.id : null;
    return _parceriaCatId;
  }

  // ---------------- Pacotes de Tratamento ----------------
  // Cadastro em Configurações → Pacotes (DB.getTreatmentPackages, guardado
  // em settings.treatmentPackages). Ao vender um pacote (1ª sessão), o
  // cliente paga o valor cheio de uma vez; nas sessões seguintes (criadas
  // uma a uma, conforme o cliente retorna), o profissional que atender
  // ganha comissão sobre o valor diluído (valor total ÷ nº de sessões) —
  // ver a seção "Concluir Atendimento" mais abaixo. Cada definição de
  // pacote (settings.treatmentPackages) tem um serviço sintético vinculado
  // (isPackageService:true) para que Comissionamento/Extrato/Relatório de
  // Vendas, que assumem appt.serviceId resolvendo para um "services" real,
  // continuem funcionando sem nenhuma alteração.
  var PACKAGE_SIZES = [
    { key: "curto", label: "Curto" },
    { key: "medio", label: "Médio" },
    { key: "longo", label: "Longo" },
    { key: "megalongo", label: "Mega Longo" }
  ];
  var _packageCatId;
  function packageCategoryId() {
    if (_packageCatId !== undefined) return _packageCatId;
    var c = DB.findOne("categories", function (x) { return x.name === "Serviços - Pacotes de Tratamento" && x.type === "receita"; });
    if (!c) {
      var cc = DB.findOne("costCenters", function (x) { return x.key === "operacional"; });
      c = DB.insert("categories", { name: "Serviços - Pacotes de Tratamento", type: "receita", costCenterId: cc ? cc.id : null, color: "#7a4fb5" });
    }
    _packageCatId = c.id;
    return _packageCatId;
  }
  // Cria (na primeira venda) ou mantém sincronizado (se o nome do pacote
  // mudar em Configurações) o serviço sintético vinculado a uma definição
  // de pacote. Esse serviço é filtrado da lista normal do combo Serviço em
  // Novo Agendamento (ver openApptModal) — reception nunca o seleciona
  // manualmente, só através do fluxo dedicado de pacotes.
  function packageServiceFor(pkgDef) {
    var name = pkgDef.name + " (Pacote)";
    var svc = DB.findOne("services", function (s) { return s.packageDefId === pkgDef.id; });
    if (!svc) {
      svc = DB.insert("services", { name: name, group: "Pacotes", categoryId: packageCategoryId(), durationMin: 60, price: 0, isPackageService: true, packageDefId: pkgDef.id });
    } else if (svc.name !== name) {
      svc = DB.update("services", svc.id, { name: name });
    }
    return svc;
  }

  // 09/09/2026: além do fluxo dedicado acima (criar o agendamento já como
  // "Sessão de um pacote já comprado"), o usuário pediu que um atendimento
  // NORMAL (avulso), já criado ou não pelo fluxo de pacotes, também consiga
  // consumir uma sessão do pacote do cliente — bastando escolher "Forma de
  // Pagamento: Pacote" na hora de concluir (ver isPackagePayMethod e o bloco
  // de pacote dentro de openConcludeSingleModal, mais abaixo). Para isso, um
  // pacote (Configurações → Pacotes) pode ter um `linkedServiceId` — o
  // serviço REAL do catálogo que ele representa (ex.: "Botox Capilar"),
  // deliberadamente separado do serviço sintético (isPackageService) usado
  // pelo fluxo dedicado, que continua existindo e funcionando sem nenhuma
  // alteração. Esta função devolve as compras de pacote do cliente que: (1)
  // são de uma definição vinculada a exatamente este serviço, e (2) ainda
  // têm sessão disponível (sessionsTotal > nº de agendamentos já
  // consumidos).
  function activePackagePurchasesForService(client, serviceId) {
    if (!client || !serviceId) return [];
    var defsById = {}; DB.getTreatmentPackages().forEach(function (d) { defsById[d.id] = d; });
    return (client.packages || []).filter(function (pp) {
      var def = defsById[pp.packageId];
      if (!def || def.linkedServiceId !== serviceId) return false;
      var remaining = (pp.sessionsTotal || 0) - (pp.appointmentIds || []).length;
      return remaining > 0;
    });
  }

  // Mesmo espírito de isParceriaMethod (ver seção Parceria abaixo): olha a
  // forma de pagamento escolhida e diz se ela está marcada como `isPackage`
  // (a forma "Pacote", seed/migrada em DB.getPaymentMethods — ver db.js).
  function isPackagePayMethod(methodName, methods) {
    var pm = (methods || paymentMethods()).find(function (p) { return p.name === methodName; });
    return !!(pm && pm.isPackage);
  }

  // ---------------- Gorjeta (profissional/assistente) ----------------
  // A pedido do usuário (09/09/2026): campo para registrar gorjeta no
  // Fechar Conta, separado da comissão (não entra no valor do serviço nem
  // na % de comissão — Utils.apptCommissionSplit nunca é tocado aqui) e
  // dividido em dois campos manuais (profissional/assistente), a critério
  // de quem está fechando a conta. Ao contrário de "Parceria"/"Comissões"
  // (categorias que já precisavam existir de antemão), a categoria
  // "Gorjetas" é criada automaticamente aqui no primeiro uso, para não
  // depender de um passo manual em Configurações antes de a funcionalidade
  // funcionar de ponta a ponta.
  var _gorjetaCatId;
  function gorjetaCatId() {
    if (_gorjetaCatId !== undefined) return _gorjetaCatId;
    var c = DB.findOne("categories", function (x) { return x.name === "Gorjetas" && x.type === "despesa"; });
    if (!c) {
      var cc = DB.findOne("costCenters", function (x) { return x.key === "operacional"; });
      c = DB.insert("categories", { name: "Gorjetas", type: "despesa", costCenterId: cc ? cc.id : null, color: "#b8923f" });
    }
    _gorjetaCatId = c.id;
    return _gorjetaCatId;
  }

  // Lança a gorjeta (se houver valor > 0) como uma despesa 100% do
  // funcionário indicado — não passa por Utils.apptCommissionSplit nem por
  // nenhum cálculo de comissão, é só um registro histórico/financeiro do
  // valor que o cliente deixou de gorjeta.
  function registerTip(opts) {
    // opts: { amount, employeeId, employeeLabel, appt, service, client, payMethod, costCenter }
    if (!opts.amount || opts.amount <= 0 || !opts.employeeId) return;
    DB.insert("transactions", {
      type: "despesa",
      description: "Gorjeta - " + opts.employeeLabel + " - " + (opts.service ? opts.service.name : "Atendimento") + " - " + opts.client.name,
      amount: round2(opts.amount), date: opts.appt.date, categoryId: gorjetaCatId(),
      costCenterId: opts.costCenter ? opts.costCenter.id : null, paymentMethod: opts.payMethod, status: "pago",
      employeeId: opts.employeeId, clientId: opts.client.id, appointmentId: opts.appt.id, reconciled: false, isTip: true
    });
  }

  function tipFieldsHtml(prefix, hasAssistant) {
    return '<div class="form-grid" style="margin-top:8px;">' +
      '<div class="form-field"><label>Gorjeta do Profissional (R$)</label><input type="text" id="' + prefix + '-tip-emp" placeholder="0,00"></div>' +
      (hasAssistant ? '<div class="form-field"><label>Gorjeta do Assistente (R$)</label><input type="text" id="' + prefix + '-tip-asst" placeholder="0,00"></div>' : '') +
      '</div>';
  }

  // ---------------- Crédito do cliente ----------------
  // A pedido do usuário (09/09/2026): quando o cliente paga a mais que o
  // devido no Fechar Conta, a diferença vira crédito (client.creditBalance)
  // para usar num próximo atendimento; quando o valor recebido é menor que
  // o devido, quem está fechando a conta escolhe entre completar com outra
  // forma de pagamento ou gerar uma pendência (o cliente fica com saldo
  // negativo). client.creditBalance positivo = crédito a favor do cliente;
  // negativo = pendência (cliente deve para o salão). client.creditHistory
  // guarda um log simples de cada movimentação, para dar transparência
  // (ver Clientes → Histórico).
  function clientCredit(client) { return (client && client.creditBalance) || 0; }

  // Sempre relê o cliente do banco antes de gravar — dentro de um mesmo
  // Fechar Conta pode haver mais de uma chamada (ex.: usa crédito E ainda
  // assim paga a mais), e cada uma precisa enxergar o saldo já atualizado
  // pela chamada anterior, não o valor "congelado" de quando o modal abriu.
  function applyCreditChange(client, delta, note, appt) {
    if (!delta) return;
    var fresh = DB.get("clients", client.id) || client;
    var history = (fresh.creditHistory || []).slice();
    history.push({ date: appt ? appt.date : Utils.todayISO(), delta: round2(delta), note: note, appointmentId: appt ? appt.id : null });
    DB.update("clients", client.id, { creditBalance: round2(clientCredit(fresh) + delta), creditHistory: history });
  }

  // Bloco de "Valor Recebido"/crédito, reaproveitado pelos dois modais de
  // Fechar Conta (único e consolidado). `prefix` distingue os ids de cada
  // instância (ex.: "cc" no modal único, "ccg" no consolidado).
  function reconciliationHtml(prefix, client) {
    var credit = clientCredit(client);
    var banner = "";
    if (credit > 0) {
      banner = '<div id="' + prefix + '-credit-box" style="background:#eef7f0;border:1px solid #bfe3c8;border-radius:8px;padding:10px 12px;margin:12px 0;">' +
        '<label class="flex items-center gap-8" style="cursor:pointer;font-weight:600;"><input type="checkbox" id="' + prefix + '-use-credit"> <span>Cliente tem ' + Utils.fmtMoney(credit) + ' em crédito. Usar neste atendimento?</span></label>' +
        '<div id="' + prefix + '-credit-amt-wrap" style="display:none;margin-top:8px;max-width:200px;"><label class="small">Valor de crédito a usar (R$)</label><input type="text" id="' + prefix + '-credit-amt"></div>' +
        '</div>';
    } else if (credit < 0) {
      banner = '<div class="small text-muted" style="margin:10px 0;"><i class="fa-solid fa-circle-info"></i> Cliente está com pendência de ' + Utils.fmtMoney(Math.abs(credit)) + ' de atendimento(s) anterior(es).</div>';
    }
    return '<div id="' + prefix + '-recon-wrap">' + banner +
      '<div class="form-grid">' +
        '<div class="form-field"><label>A Receber (R$)</label><input type="text" id="' + prefix + '-toreceive" disabled></div>' +
        '<div class="form-field"><label>Valor Recebido (R$)</label><input type="text" id="' + prefix + '-received"></div>' +
      '</div>' +
      '<div id="' + prefix + '-recon-note" class="small" style="margin:2px 0 8px;min-height:18px;"></div>' +
      '<div id="' + prefix + '-shortfall-block" style="display:none;background:#fdf3ea;border:1px solid #f0d4b0;border-radius:8px;padding:10px 12px;margin-bottom:10px;">' +
        '<div class="small" style="margin-bottom:8px;font-weight:600;">Faltaram <span id="' + prefix + '-shortfall-amt"></span> — como resolver?</div>' +
        '<label class="flex items-center gap-8" style="cursor:pointer;margin-bottom:6px;"><input type="radio" name="' + prefix + '-shortfall-choice" value="outra_forma" checked> <span>Cliente paga a diferença agora, em outra forma de pagamento</span></label>' +
        '<div style="margin:4px 0 10px 26px;max-width:240px;"><select id="' + prefix + '-shortfall-pay"></select></div>' +
        '<label class="flex items-center gap-8" style="cursor:pointer;"><input type="radio" name="' + prefix + '-shortfall-choice" value="pendencia"> <span>Gerar pendência (cliente fica devendo a diferença)</span></label>' +
        (credit > 0 ? '<div class="small text-muted" style="margin-top:8px;">Dica: para descontar do crédito do cliente, marque "Usar crédito" acima em vez de escolher aqui.</div>' : '') +
      '</div>' +
    '</div>';
  }

  // Liga os eventos do bloco acima. `methods` = paymentMethods() (para
  // popular o select da forma de pagamento alternativa). `getTotal` = função
  // que devolve o total (R$) devido agora, já considerando Parceria (nesse
  // caso deve devolver 0). `isActive` = função que diz se a reconciliação
  // vale para o modo de pagamento atual (false quando Parceria, que não
  // cobra do cliente e portanto não gera nem consome crédito).
  function wireReconciliation(box, prefix, client, methods, getTotal, isActive) {
    var creditAvail = clientCredit(client);
    var wrap = box.querySelector("#" + prefix + "-recon-wrap");
    var useCreditChk = box.querySelector("#" + prefix + "-use-credit");
    var creditAmtWrap = box.querySelector("#" + prefix + "-credit-amt-wrap");
    var creditAmtInput = box.querySelector("#" + prefix + "-credit-amt");
    var toReceiveInput = box.querySelector("#" + prefix + "-toreceive");
    var receivedInput = box.querySelector("#" + prefix + "-received");
    var noteEl = box.querySelector("#" + prefix + "-recon-note");
    var shortfallBlock = box.querySelector("#" + prefix + "-shortfall-block");
    var shortfallAmtEl = box.querySelector("#" + prefix + "-shortfall-amt");
    var shortfallPaySelect = box.querySelector("#" + prefix + "-shortfall-pay");
    var receivedTouched = false;

    if (shortfallPaySelect) {
      shortfallPaySelect.innerHTML = methods.map(function (p) { return '<option value="' + Utils.escapeHtml(p.name) + '">' + Utils.escapeHtml(p.name) + '</option>'; }).join("");
    }
    if (creditAmtInput) Utils.wireMoneyMask(creditAmtInput, 0);
    Utils.wireMoneyMask(receivedInput, 0);

    function creditToUse() {
      if (!useCreditChk || !useCreditChk.checked) return 0;
      var v = Utils.moneyMaskToFloat(creditAmtInput) || 0;
      return round2(Math.max(0, Math.min(v, creditAvail, getTotal())));
    }

    function toReceive() { return round2(Math.max(0, getTotal() - creditToUse())); }

    function evalDiff() {
      var a = toReceive();
      // Sem fallback "|| a" aqui de propósito: o campo já foi preenchido com
      // o valor padrão por recompute() antes de o usuário digitar qualquer
      // coisa, então ler direto reflete tanto o padrão quanto um "0,00"
      // digitado de propósito (cliente que não pagou nada na hora).
      var r = Utils.moneyMaskToFloat(receivedInput);
      var diff = round2(r - a);
      if (diff > 0.004) {
        noteEl.innerHTML = '<span style="color:#1baf7a;"><i class="fa-solid fa-circle-info"></i> Cliente está pagando ' + Utils.fmtMoney(diff) + ' a mais — vai virar crédito para o próximo atendimento.</span>';
        shortfallBlock.style.display = "none";
      } else if (diff < -0.004) {
        noteEl.innerHTML = "";
        shortfallBlock.style.display = "";
        shortfallAmtEl.textContent = Utils.fmtMoney(Math.abs(diff));
      } else {
        noteEl.innerHTML = "";
        shortfallBlock.style.display = "none";
      }
    }

    function recompute() {
      var a = toReceive();
      Utils.setMoneyMaskValue(toReceiveInput, a);
      if (!receivedTouched) Utils.setMoneyMaskValue(receivedInput, a);
      evalDiff();
    }

    if (useCreditChk) {
      useCreditChk.addEventListener("change", function () {
        creditAmtWrap.style.display = useCreditChk.checked ? "" : "none";
        if (useCreditChk.checked) Utils.setMoneyMaskValue(creditAmtInput, round2(Math.min(creditAvail, getTotal())));
        recompute();
      });
    }
    if (creditAmtInput) creditAmtInput.addEventListener("input", recompute);
    receivedInput.addEventListener("input", function () { receivedTouched = true; evalDiff(); });

    recompute();

    return {
      refresh: recompute,
      resolve: function () {
        if (!isActive()) return { creditToUse: 0, received: 0, toReceive: 0, diff: 0 };
        var a = toReceive();
        var r = Utils.moneyMaskToFloat(receivedInput);
        var diff = round2(r - a);
        var result = { creditToUse: creditToUse(), received: r, toReceive: a, diff: diff };
        if (diff < -0.004) {
          var checked = box.querySelector('input[name="' + prefix + '-shortfall-choice"]:checked');
          result.shortfallChoice = checked ? checked.value : "outra_forma";
          if (result.shortfallChoice === "outra_forma") result.shortfallPayMethod = shortfallPaySelect.value;
        }
        return result;
      },
      setVisible: function (visible) { if (wrap) wrap.style.display = visible ? "" : "none"; }
    };
  }

  // ---------------- Conclusão de sessão de pacote (2ª sessão em diante) ----------------
  // O dinheiro do pacote inteiro já foi cobrado do cliente na venda (1ª
  // sessão — ver isPackageSale dentro de openConcludeSingleModal). Aqui não
  // há nada para cobrar nem reconciliar: só gorjeta (opcional) e
  // insumos/produtos (opcional, mesmo padrão de openAddInsumoModal).
  // appt.price já é o valor diluído certo, gravado desde a criação da
  // sessão (ver openApptModal) — a comissão desta sessão é calculada
  // automaticamente pelo motor padrão (Utils.apptCommissionSplit /
  // comissoes.js), sem nenhum cálculo de comissão extra aqui.
  function openConcludePackageSessionModal(appt) {
    var service = DB.get("services", appt.serviceId);
    var client = DB.get("clients", appt.clientId);
    var employee = DB.get("employees", appt.employeeId);
    var costCenter = DB.findOne("costCenters", function (c) { return c.key === "operacional"; });
    var comercialCc = DB.findOne("costCenters", function (c) { return c.key === "comercial"; });
    var revendaCat = DB.findOne("categories", function (c) { return c.name === "Venda de Produtos"; });
    var methods = paymentMethods();
    var hasAssistant = !!appt.assistantId;
    var assistant = hasAssistant ? DB.get("employees", appt.assistantId) : null;
    var packagePurchase = (client && client.packages || []).find(function (pp) { return pp.id === appt.packagePurchaseId; });

    var body = '<div class="form-grid">' +
      '<div class="form-field full"><div style="border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px;background:var(--gray-50);font-size:13px;">' +
        'Sessão ' + appt.packageSessionIndex + ' de ' + (packagePurchase ? packagePurchase.sessionsTotal : "?") + ' do pacote "' + (packagePurchase ? Utils.escapeHtml(packagePurchase.packageName) + " (" + Utils.escapeHtml(packagePurchase.sizeLabel) + ")" : "") + '". ' +
        'O valor já foi cobrado do cliente na venda do pacote — nada a cobrar nesta sessão. ' + Utils.escapeHtml(employee ? employee.name : "O profissional") + ' recebe comissão sobre o valor diluído desta sessão (' + Utils.fmtMoney(appt.price) + ').' +
      '</div></div>' +
      '</div>' +
      tipFieldsHtml("ps", hasAssistant) +
      '<div class="divider" style="margin:14px 0;"></div>' +
      '<div class="flex items-center justify-between mb-8">' +
        '<label style="font-weight:600;">Insumos / Produtos (opcional)</label>' +
        '<button type="button" class="btn btn-sm btn-outline" id="ps-add-insumo"><i class="fa-solid fa-plus"></i> Adicionar item</button>' +
      '</div>' +
      '<div id="ps-insumo-rows"></div>' +
      '<div class="small text-muted mb-16">Consumo interno divide o custo 50/50 com ' + Utils.escapeHtml(employee ? employee.name : "o profissional") + '. "Levado pelo cliente" gera uma venda normal (usa a forma de pagamento abaixo).</div>' +
      '<div class="form-grid"><div class="form-field"><label>Forma de Pagamento (só para produto levado pelo cliente)</label><select id="ps-pay">' + methods.filter(function (p) { return !p.isPackage; }).map(function (p) { return '<option value="' + Utils.escapeHtml(p.name) + '">' + Utils.escapeHtml(p.name) + '</option>'; }).join("") + '</select></div></div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="ps-save">Confirmar Conclusão</button>';
    var box = Modal.open({ title: "Concluir Sessão de Pacote", wide: true, bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#ps-tip-emp"), 0);
    if (hasAssistant) Utils.wireMoneyMask(box.querySelector("#ps-tip-asst"), 0);

    var rowsEl = box.querySelector("#ps-insumo-rows");
    box.querySelector("#ps-add-insumo").addEventListener("click", function () {
      rowsEl.insertAdjacentHTML("beforeend", insumoRowHtml());
      wireInsumoRow(rowsEl.lastElementChild);
    });

    box.querySelector("#ps-save").addEventListener("click", function () {
      var rows = Utils.qsa(".insumo-item-row", rowsEl);
      var payMethod = box.querySelector("#ps-pay").value;
      var tipEmp = Utils.moneyMaskToFloat(box.querySelector("#ps-tip-emp")) || 0;
      var tipAsst = hasAssistant ? (Utils.moneyMaskToFloat(box.querySelector("#ps-tip-asst")) || 0) : 0;

      DB.batch(function () {
        // Forma de pagamento exibida no agendamento: "Pacote" fixo, já que o
        // valor desta sessão foi cobrado inteiro na venda do pacote (1ª
        // sessão) — não no #ps-pay acima, que é só para produto levado pelo
        // cliente (venda avulsa à parte, sem relação com esta sessão).
        DB.update("appointments", appt.id, { status: "concluido", paymentMethod: "Pacote" });
        registerTip({ amount: tipEmp, employeeId: appt.employeeId, employeeLabel: employee ? employee.name : "Profissional", appt: appt, service: service, client: client, payMethod: payMethod, costCenter: costCenter });
        registerTip({ amount: tipAsst, employeeId: appt.assistantId, employeeLabel: assistant ? assistant.name : "Assistente", appt: appt, service: service, client: client, payMethod: payMethod, costCenter: costCenter });

        rows.forEach(function (row) {
          var tipo = row.querySelector(".ir-tipo").value;
          var productId = row.querySelector(".ir-produto").value;
          var qtd = parseFloat(row.querySelector(".ir-qtd").value) || 0;
          if (!productId || qtd <= 0) return;
          if (tipo === "consumo") {
            if (window.Consumo) {
              try {
                Consumo.register({ productId: productId, employeeId: appt.employeeId, appointmentId: appt.id, clientId: appt.clientId, date: appt.date, quantity: qtd, notes: service ? service.name : "" });
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
              paymentMethod: payMethod, status: "pago", employeeId: appt.employeeId, clientId: appt.clientId,
              productId: productId, appointmentId: appt.id, reconciled: false
            });
          }
        });
      });

      DB.log("Agenda", "Concluiu a sessão " + appt.packageSessionIndex + " do pacote \"" + (packagePurchase ? packagePurchase.packageName : "") + "\" - " + client.name + " (comissão sobre " + Utils.fmtMoney(appt.price) + ")" +
        (rows.length ? " com " + rows.length + " item(ns) de insumo/produto" : ""));
      if (window.Notificacoes) Notificacoes.queueReviewRequest(DB.get("appointments", appt.id));
      Modal.close();
      Toast.show("Sessão de pacote concluída", "success");
      render();
    });
  }

  function openConcludeSingleModal(appt) {
    var service = DB.get("services", appt.serviceId);
    var client = DB.get("clients", appt.clientId);
    var employee = DB.get("employees", appt.employeeId);
    var category = DB.findOne("categories", function (c) { return c.id === service.categoryId; });
    var costCenter = DB.findOne("costCenters", function (c) { return c.key === "operacional"; });
    var methods = paymentMethods();

    var hasAssistant = !!appt.assistantId;
    var assistant = hasAssistant ? DB.get("employees", appt.assistantId) : null;

    // Venda de pacote de tratamento (1ª sessão — ver openApptModal, modo
    // "Vender novo pacote"): o cliente paga o valor CHEIO do pacote aqui,
    // de uma vez só, mas appt.price já foi gravado DILUÍDO (valor total ÷
    // nº de sessões) desde a criação — é sobre esse valor diluído que a
    // comissão desta e de cada sessão seguinte é calculada. Por isso "Valor
    // Cobrado" é pré-preenchido com o valor cheio do pacote (não com
    // appt.price), e o save handler abaixo tem o cuidado de NUNCA
    // sobrescrever appt.price com o valor cobrado nesta tela.
    var isPackageSale = !!(appt.packagePurchaseId && appt.packageSessionIndex === 1);
    var packagePurchase = isPackageSale ? (client.packages || []).find(function (pp) { return pp.id === appt.packagePurchaseId; }) : null;

    // 09/09/2026: consumo de pacote via Forma de Pagamento (ver
    // isPackagePayMethod/activePackagePurchasesForService acima) — só
    // avaliado quando este atendimento ainda NÃO está vinculado a nenhum
    // pacote de nenhuma outra forma (nem venda, nem sessão criada pelo
    // fluxo dedicado). `pkgConsumeMatches` são as compras do cliente, do
    // MESMO serviço deste atendimento, com sessão disponível.
    var pkgConsumeMatches = (!appt.packagePurchaseId) ? activePackagePurchasesForService(client, appt.serviceId) : [];
    // "Pacote" só aparece no seletor de Forma de Pagamento quando há pelo
    // menos uma compra compatível — evita mostrar uma opção que não faria
    // nada neste atendimento específico.
    var visiblePayMethods = methods.filter(function (p) { return !p.isPackage || pkgConsumeMatches.length > 0; });

    var body = '<div class="form-grid">' +
      (isPackageSale && packagePurchase ? '<div class="form-field full"><div style="border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px;background:var(--gray-50);font-size:13px;">' +
        'Venda do pacote "' + Utils.escapeHtml(packagePurchase.packageName) + '" (' + Utils.escapeHtml(packagePurchase.sizeLabel) + ', ' + packagePurchase.sessionsTotal + ' sessões). ' +
        'O valor abaixo é o valor CHEIO do pacote, cobrado uma única vez, agora. Em cada uma das próximas sessões, o profissional que atender recebe comissão sobre o valor diluído (' + Utils.fmtMoney(appt.price) + ' por sessão), conforme os atendimentos forem acontecendo.' +
      '</div></div>' : "") +
      '<div class="form-field" id="cc-amount-wrap"><label>Valor Cobrado (R$)</label><input type="text" id="cc-amount"></div>' +
      '<div class="form-field"><label>Forma de Pagamento</label><select id="cc-pay">' + visiblePayMethods.map(function (p) { return '<option value="' + Utils.escapeHtml(p.name) + '">' + Utils.escapeHtml(p.name) + '</option>'; }).join("") + '</select></div>' +
      '</div>' +
      '<div id="cc-parceria-block" class="form-grid" style="display:none;">' +
        '<div class="form-field full"><div class="small text-muted"><i class="fa-solid fa-circle-info"></i> Parceria: o cliente não paga por este atendimento. O valor acima serve só de base para dividir o custo entre o profissional e o salão.</div></div>' +
        parceriaSplitFieldHtml({ id: "cc-parceria-pct", appt: appt, employee: employee }) +
      '</div>' +
      '<div id="cc-package-block" class="form-grid" style="display:none;">' +
        '<div class="form-field full"><div class="small text-muted" id="cc-package-info"><i class="fa-solid fa-circle-info"></i></div></div>' +
        (pkgConsumeMatches.length > 1 ? '<div class="form-field full"><label>Qual pacote?</label><select id="cc-package-choice">' +
          pkgConsumeMatches.map(function (pp) {
            var used = (pp.appointmentIds || []).length;
            return '<option value="' + pp.id + '">' + Utils.escapeHtml(pp.packageName) + ' - ' + Utils.escapeHtml(pp.sizeLabel) + ' (sessão ' + (used + 1) + ' de ' + pp.sessionsTotal + ', restam ' + (pp.sessionsTotal - used) + ')</option>';
          }).join("") +
        '</select></div>' : "") +
      '</div>' +
      tipFieldsHtml("cc", hasAssistant) +
      reconciliationHtml("cc", client) +
      '<div class="divider" style="margin:14px 0;"></div>' +
      '<div class="flex items-center justify-between mb-8">' +
        '<label style="font-weight:600;">Insumos / Produtos (opcional)</label>' +
        '<button type="button" class="btn btn-sm btn-outline" id="cc-add-insumo"><i class="fa-solid fa-plus"></i> Adicionar item</button>' +
      '</div>' +
      '<div id="cc-insumo-rows"></div>' +
      '<div class="small text-muted">Consumo interno divide o custo 50/50 com ' + Utils.escapeHtml(employee ? employee.name : "o profissional") + '. "Levado pelo cliente" gera uma venda normal.</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cc-save">Confirmar Conclusão</button>';
    var box = Modal.open({ title: "Concluir Atendimento", wide: true, bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#cc-amount"), isPackageSale && packagePurchase ? packagePurchase.totalPrice : appt.price);
    Utils.wireMoneyMask(box.querySelector("#cc-tip-emp"), 0);
    if (hasAssistant) Utils.wireMoneyMask(box.querySelector("#cc-tip-asst"), 0);
    wireParceriaSplitRequest(box, { id: "cc-parceria-pct", appt: appt, employee: employee });

    var paySelect = box.querySelector("#cc-pay");
    var parceriaBlock = box.querySelector("#cc-parceria-block");
    var packageBlock = box.querySelector("#cc-package-block");
    var packageInfoEl = box.querySelector("#cc-package-info");
    var packageChoiceEl = box.querySelector("#cc-package-choice");
    var amountWrap = box.querySelector("#cc-amount-wrap");
    var amountInput = box.querySelector("#cc-amount");

    // Compra de pacote selecionada agora (se houver mais de uma compatível,
    // respeita o que está marcado em "Qual pacote?"; senão, a única opção).
    function selectedPackagePurchase() {
      if (!pkgConsumeMatches.length) return null;
      if (packageChoiceEl) return pkgConsumeMatches.find(function (pp) { return pp.id === packageChoiceEl.value; }) || pkgConsumeMatches[0];
      return pkgConsumeMatches[0];
    }
    function updatePackageInfo() {
      var pp = selectedPackagePurchase();
      if (!pp || !packageInfoEl) return;
      var used = (pp.appointmentIds || []).length;
      var diluted = round2((pp.totalPrice || 0) / (pp.sessionsTotal || 1));
      packageInfoEl.innerHTML = '<i class="fa-solid fa-circle-info"></i> Esta sessão será descontada do pacote "' + Utils.escapeHtml(pp.packageName) + '" (' + Utils.escapeHtml(pp.sizeLabel) + ') — sessão ' + (used + 1) + ' de ' + pp.sessionsTotal + '. Nenhum valor será cobrado do cliente agora (já foi pago na compra do pacote); a comissão desta sessão é calculada sobre o valor diluído (' + Utils.fmtMoney(diluted) + ').';
    }
    if (packageChoiceEl) packageChoiceEl.addEventListener("change", updatePackageInfo);

    var recon = wireReconciliation(box, "cc", client, methods.filter(function (p) { return !p.isPackage; }),
      function () { return (isParceriaMethod(paySelect.value, methods) || isPackagePayMethod(paySelect.value, methods)) ? 0 : (Utils.moneyMaskToFloat(amountInput) || 0); },
      function () { return !isParceriaMethod(paySelect.value, methods) && !isPackagePayMethod(paySelect.value, methods); });
    function syncPayVisibility() {
      var isParc = isParceriaMethod(paySelect.value, methods);
      var isPkgPay = isPackagePayMethod(paySelect.value, methods);
      parceriaBlock.style.display = isParc ? "" : "none";
      packageBlock.style.display = isPkgPay ? "" : "none";
      if (amountWrap) amountWrap.style.display = isPkgPay ? "none" : "";
      if (isPkgPay) updatePackageInfo();
      recon.setVisible(!isParc && !isPkgPay);
      recon.refresh();
    }
    paySelect.addEventListener("change", syncPayVisibility);
    amountInput.addEventListener("input", function () { recon.refresh(); });
    syncPayVisibility();

    var rowsEl = box.querySelector("#cc-insumo-rows");
    box.querySelector("#cc-add-insumo").addEventListener("click", function () {
      rowsEl.insertAdjacentHTML("beforeend", insumoRowHtml());
      wireInsumoRow(rowsEl.lastElementChild);
    });

    box.querySelector("#cc-save").addEventListener("click", function () {
      var payMethod = box.querySelector("#cc-pay").value;
      var isParceria = isParceriaMethod(payMethod, methods);
      var isPkgPay = isPackagePayMethod(payMethod, methods);
      var chosenPurchase = isPkgPay ? selectedPackagePurchase() : null;
      if (isPkgPay && !chosenPurchase) { Toast.show("Selecione qual pacote esta sessão vai consumir", "danger"); return; }
      var packageDilutedValue = chosenPurchase ? round2((chosenPurchase.totalPrice || 0) / (chosenPurchase.sessionsTotal || 1)) : null;
      var packageSessionIndexForLog = chosenPurchase ? (chosenPurchase.appointmentIds || []).length + 1 : null;
      var amount = isPkgPay ? packageDilutedValue : (Utils.moneyMaskToFloat(box.querySelector("#cc-amount")) || (isPackageSale && packagePurchase ? packagePurchase.totalPrice : appt.price));
      var rows = Utils.qsa(".insumo-item-row", rowsEl);
      var revendaCat = DB.findOne("categories", function (c) { return c.name === "Venda de Produtos"; });
      var comercialCc = DB.findOne("costCenters", function (c) { return c.key === "comercial"; });
      var splitPct = isParceria ? resolvedParceriaSplitPercent(box, "cc-parceria-pct", appt, employee) : null;
      var recRes = recon.resolve();
      var tipEmp = Utils.moneyMaskToFloat(box.querySelector("#cc-tip-emp")) || 0;
      var tipAsst = hasAssistant ? (Utils.moneyMaskToFloat(box.querySelector("#cc-tip-asst")) || 0) : 0;

      DB.batch(function () {
        // CRÍTICO: numa venda de pacote (1ª sessão) OU num consumo de
        // pacote via Forma de Pagamento, appt.price precisa ser o valor
        // DILUÍDO (é a base da comissão desta sessão) — nunca o valor
        // cobrado/exibido nesta tela. Por isso price só assume `amount`
        // (o valor realmente cobrado do cliente) no caso normal, sem
        // pacote nenhum envolvido.
        // Forma de pagamento gravada no próprio agendamento (além de nos
        // lançamentos financeiros) só para exibição em "Editar Agendamento"
        // — payMethod já é "Pacote" no caso de consumo de pacote (isPkgPay),
        // então nenhum caso especial é necessário aqui.
        var apptPatch = { status: "concluido", paymentMethod: payMethod };
        if (isPkgPay) {
          apptPatch.price = packageDilutedValue;
          apptPatch.packagePurchaseId = chosenPurchase.id;
          apptPatch.packageSessionIndex = packageSessionIndexForLog;
        } else if (!isPackageSale) {
          apptPatch.price = amount;
        }
        if (isParceria && canEditParceriaSplit) apptPatch.commissionPercent = splitPct;
        DB.update("appointments", appt.id, apptPatch);

        if (isPkgPay) {
          // Vincula esta sessão ao pacote — mesma mecânica de "Sessão de um
          // pacote já comprado" em openApptModal (client.packages[].
          // appointmentIds), só que acontecendo agora, na conclusão de um
          // atendimento normal, em vez de na criação de um agendamento
          // dedicado. Relê o cliente fresco do banco (não o `client`
          // capturado na abertura do modal) para não perder nenhuma
          // atualização concorrente. Nenhum lançamento de receita novo: o
          // valor já foi cobrado do cliente na venda original do pacote.
          var freshClientForPkg = DB.get("clients", client.id) || client;
          var newPackages = (freshClientForPkg.packages || []).map(function (pp) {
            if (pp.id !== chosenPurchase.id) return pp;
            return Object.assign({}, pp, { appointmentIds: (pp.appointmentIds || []).concat([appt.id]) });
          });
          DB.update("clients", client.id, { packages: newPackages });
        } else if (isParceria) {
          // Usa o mesmo cálculo de Utils.apptCommissionSplit já usado pelo
          // Comissionamento (considera assistente, se houver) — a parte do
          // profissional (mainCommission/assistantCommission) segue pelo
          // fluxo normal de pagamento de comissão; só a parte que sobra
          // (o que o salão está absorvendo, já que o cliente não pagou)
          // vira este lançamento de despesa.
          var split = Utils.apptCommissionSplit(Object.assign({}, appt, { price: amount, commissionPercent: splitPct }), employee);
          var salonAmount = round2(amount - split.mainCommission - split.assistantCommission);
          DB.insert("transactions", {
            type: "despesa", description: "Parceria - " + service.name + " - " + client.name + " (" + splitPct + "% profissional / " + round2(100 - splitPct) + "% salão)",
            amount: salonAmount, date: appt.date, categoryId: parceriaCatId(), costCenterId: costCenter ? costCenter.id : null,
            paymentMethod: payMethod, status: "pago",
            employeeId: appt.employeeId, clientId: appt.clientId, appointmentId: appt.id, reconciled: false
          });
        } else {
          // Se faltou pagamento e a resolução escolhida foi "outra forma de
          // pagamento", o valor deste lançamento (na forma principal) é
          // reduzido pela diferença, e um segundo lançamento cobre o
          // restante na forma alternativa — o total registrado continua
          // batendo exatamente com o Valor Cobrado, só a forma de
          // pagamento de uma fração dele é que fica dividida em duas.
          var mainRevenue = round2(amount);
          if (recRes.diff < -0.004 && recRes.shortfallChoice === "outra_forma") {
            var shortfall = round2(Math.abs(recRes.diff));
            mainRevenue = round2(Math.max(0, mainRevenue - shortfall));
            DB.insert("transactions", {
              type: "receita", description: "Complemento de pagamento - " + service.name + " - " + client.name,
              amount: shortfall, date: appt.date, categoryId: category ? category.id : null, costCenterId: costCenter ? costCenter.id : null,
              paymentMethod: recRes.shortfallPayMethod, status: "pago",
              employeeId: appt.employeeId, clientId: appt.clientId, appointmentId: appt.id, reconciled: false
            });
          }
          DB.insert("transactions", {
            type: "receita", description: service.name + " - " + client.name, amount: mainRevenue,
            date: appt.date, categoryId: category ? category.id : null, costCenterId: costCenter ? costCenter.id : null,
            paymentMethod: payMethod, status: "pago",
            employeeId: appt.employeeId, clientId: appt.clientId, appointmentId: appt.id, reconciled: false
          });
          // Crédito do cliente: usado agora (desconta), gerado agora
          // (pagou a mais) e/ou pendência (se optou por deixar em aberto).
          if (recRes.creditToUse > 0) applyCreditChange(client, -recRes.creditToUse, "Crédito utilizado no atendimento (" + service.name + ")", appt);
          if (recRes.diff > 0.004) applyCreditChange(client, recRes.diff, "Pagamento a maior — crédito gerado (" + service.name + ")", appt);
          else if (recRes.diff < -0.004 && recRes.shortfallChoice === "pendencia") applyCreditChange(client, recRes.diff, "Pagamento a menor — pendência gerada (" + service.name + ")", appt);
        }

        registerTip({ amount: tipEmp, employeeId: appt.employeeId, employeeLabel: employee ? employee.name : "Profissional", appt: appt, service: service, client: client, payMethod: payMethod, costCenter: costCenter });
        registerTip({ amount: tipAsst, employeeId: appt.assistantId, employeeLabel: assistant ? assistant.name : "Assistente", appt: appt, service: service, client: client, payMethod: payMethod, costCenter: costCenter });

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
              paymentMethod: payMethod, status: "pago", employeeId: appt.employeeId, clientId: appt.clientId,
              productId: productId, appointmentId: appt.id, reconciled: false
            });
          }
        });
      });

      DB.log("Agenda", "Concluiu o atendimento " + service.name + " - " + client.name +
        (isPkgPay ? " consumindo a sessão " + packageSessionIndexForLog + " de " + chosenPurchase.sessionsTotal + " do pacote \"" + chosenPurchase.packageName + "\" (comissão sobre " + Utils.fmtMoney(packageDilutedValue) + ", sem cobrança nova)" :
         isParceria ? " como Parceria (divisão " + splitPct + "% profissional / " + round2(100 - splitPct) + "% salão, base " + Utils.fmtMoney(amount) + ")" : " (" + Utils.fmtMoney(amount) + ")") +
        (isPackageSale && packagePurchase ? " — venda do pacote \"" + packagePurchase.packageName + "\" (comissão desta sessão sobre " + Utils.fmtMoney(appt.price) + ")" : "") +
        (rows.length ? " com " + rows.length + " item(ns) de insumo/produto" : ""));
      // Enfileira o pedido de avaliação por WhatsApp (envio manual, mesmo
      // fluxo da confirmação de agendamento) — a pedido do cliente, toda
      // conclusão de atendimento deve gerar esse pedido para o cliente.
      if (window.Notificacoes) Notificacoes.queueReviewRequest(DB.get("appointments", appt.id));
      Modal.close();
      Toast.show(isPkgPay ? "Atendimento concluído — sessão do pacote consumida, nenhuma cobrança gerada" : (isParceria ? "Atendimento concluído como Parceria — divisão de custo registrada" : "Atendimento concluído e lançamento financeiro gerado"), "success");
      render();
    });
  }

  // "Fechar Conta": consolidado de todos os atendimentos agendados de um
  // cliente no mesmo dia/horário (ex.: dois serviços simultâneos, cada um
  // com um profissional diferente). Mostra cada serviço + profissional
  // envolvido e permite ajustar o valor cobrado e os insumos/produtos de
  // cada um, com uma única forma de pagamento e um total geral — mas
  // conclui e lança financeiramente cada atendimento separadamente por
  // baixo dos panos (mesmo comportamento de sempre, só que revisado e
  // confirmado de uma vez só).
  function openConcludeGroupModal(group) {
    var client = DB.get("clients", group[0].clientId);
    var revendaCat = DB.findOne("categories", function (c) { return c.name === "Venda de Produtos"; });
    var comercialCc = DB.findOne("costCenters", function (c) { return c.key === "comercial"; });
    // "Pacote" (ver isPackagePayMethod) só é suportado hoje na conclusão de
    // UM atendimento por vez (openConcludeSingleModal) — cada linha do
    // Fechar Conta pode ser de um serviço diferente, e o vínculo de pacote é
    // por serviço, então uma única forma de pagamento para o grupo inteiro
    // não daria pra decidir corretamente qual linha consumiria qual pacote.
    // Filtrada aqui de propósito para não aparecer como opção nesta tela.
    var methods = paymentMethods().filter(function (p) { return !p.isPackage; });

    var lines = group.map(function (appt, idx) {
      return {
        appt: appt,
        service: DB.get("services", appt.serviceId),
        employee: DB.get("employees", appt.employeeId),
        assistant: appt.assistantId ? DB.get("employees", appt.assistantId) : null,
        rowPrefix: "ccg" + idx
      };
    });

    var body = '<div class="small text-muted mb-16"><i class="fa-solid fa-circle-info"></i> ' + Utils.escapeHtml(client.name) + ' tem ' + group.length + ' atendimentos agendados para ' + Utils.fmtDate(group[0].date) + '. Confira e conclua tudo de uma vez.</div>' +
      lines.map(function (l) {
        return '<div class="ccg-line" style="border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px;margin-bottom:12px;">' +
          '<div class="mb-8"><strong>' + l.appt.time + ' — ' + Utils.escapeHtml(l.service ? l.service.name : "Serviço") + '</strong>' +
            '<div class="small text-muted">Profissional: ' + Utils.escapeHtml(l.employee ? l.employee.name : "-") + (l.assistant ? " · Assistente: " + Utils.escapeHtml(l.assistant.name) : "") + '</div>' +
          '</div>' +
          '<div class="form-grid">' +
            '<div class="form-field"><label>Valor Cobrado (R$)</label><input type="text" id="' + l.rowPrefix + '-amount"></div>' +
          '</div>' +
          '<div id="' + l.rowPrefix + '-parceria-block" class="form-grid" style="display:none;margin-top:8px;">' +
            '<div class="form-field full"><div class="small text-muted"><i class="fa-solid fa-circle-info"></i> Parceria: o cliente não paga por este item. O valor acima serve só de base para dividir o custo entre o profissional e o salão.</div></div>' +
            parceriaSplitFieldHtml({ id: l.rowPrefix + "-parceria-pct", appt: l.appt, employee: l.employee }) +
          '</div>' +
          tipFieldsHtml(l.rowPrefix, !!l.assistant) +
          '<div class="flex items-center justify-between mb-8" style="margin-top:8px;">' +
            '<label class="small" style="font-weight:600;">Insumos / Produtos (opcional)</label>' +
            '<button type="button" class="btn btn-sm btn-outline ccg-add-insumo" data-target="' + l.rowPrefix + '-rows"><i class="fa-solid fa-plus"></i> Adicionar item</button>' +
          '</div>' +
          '<div id="' + l.rowPrefix + '-rows"></div>' +
        '</div>';
      }).join("") +
      '<div class="divider" style="margin:14px 0;"></div>' +
      '<div class="form-grid">' +
        '<div class="form-field"><label>Forma de Pagamento</label><select id="ccg-pay">' + methods.map(function (p) { return '<option value="' + Utils.escapeHtml(p.name) + '">' + Utils.escapeHtml(p.name) + '</option>'; }).join("") + '</select></div>' +
        '<div class="form-field"><label>Total</label><input type="text" id="ccg-total" disabled></div>' +
      '</div>' +
      reconciliationHtml("ccg", client);

    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="ccg-save">Fechar Conta</button>';
    var box = Modal.open({ title: "Fechar Conta — " + client.name, wide: true, bodyHtml: body, footHtml: foot });

    var paySelectG = box.querySelector("#ccg-pay");

    function isGroupParceria() { return isParceriaMethod(paySelectG.value, methods); }

    function updateTotal() {
      if (isGroupParceria()) { Utils.setMoneyMaskValue(box.querySelector("#ccg-total"), 0); return; }
      var total = 0;
      lines.forEach(function (l) {
        total += Utils.moneyMaskToFloat(box.querySelector("#" + l.rowPrefix + "-amount")) || 0;
      });
      Utils.setMoneyMaskValue(box.querySelector("#ccg-total"), total);
    }

    var recon = wireReconciliation(box, "ccg", client, methods,
      function () {
        if (isGroupParceria()) return 0;
        var total = 0;
        lines.forEach(function (l) { total += Utils.moneyMaskToFloat(box.querySelector("#" + l.rowPrefix + "-amount")) || 0; });
        return total;
      },
      function () { return !isGroupParceria(); });

    function syncGroupParceriaVisibility() {
      var isParc = isGroupParceria();
      lines.forEach(function (l) {
        var blk = box.querySelector("#" + l.rowPrefix + "-parceria-block");
        if (blk) blk.style.display = isParc ? "" : "none";
      });
      updateTotal();
      recon.setVisible(!isParc);
      recon.refresh();
    }
    paySelectG.addEventListener("change", syncGroupParceriaVisibility);

    lines.forEach(function (l) {
      var amountInput = box.querySelector("#" + l.rowPrefix + "-amount");
      Utils.wireMoneyMask(amountInput, l.appt.price);
      amountInput.addEventListener("input", function () { updateTotal(); recon.refresh(); });
      wireParceriaSplitRequest(box, { id: l.rowPrefix + "-parceria-pct", appt: l.appt, employee: l.employee });
      Utils.wireMoneyMask(box.querySelector("#" + l.rowPrefix + "-tip-emp"), 0);
      if (l.assistant) Utils.wireMoneyMask(box.querySelector("#" + l.rowPrefix + "-tip-asst"), 0);
      var rowsEl = box.querySelector("#" + l.rowPrefix + "-rows");
      box.querySelector('.ccg-add-insumo[data-target="' + l.rowPrefix + '-rows"]').addEventListener("click", function () {
        rowsEl.insertAdjacentHTML("beforeend", insumoRowHtml());
        wireInsumoRow(rowsEl.lastElementChild);
      });
    });
    syncGroupParceriaVisibility();

    box.querySelector("#ccg-save").addEventListener("click", function () {
      var payMethod = paySelectG.value;
      var isParceria = isGroupParceria();
      var totalAmount = 0;
      var summaryParts = [];
      var insumoCount = 0;
      var recRes = recon.resolve();
      // Se faltou pagamento e a resolução escolhida foi "outra forma de
      // pagamento", a diferença é descontada dos lançamentos de receita das
      // linhas (na ordem em que aparecem) e um único lançamento à parte
      // cobre o restante na forma alternativa — o total registrado continua
      // batendo exatamente com a soma dos "Valor Cobrado", só que uma
      // fração dele fica dividida em duas formas de pagamento. O Valor
      // Cobrado de cada linha (usado na comissão) não é alterado por isso.
      var pendingShortfall = (!isParceria && recRes.diff < -0.004 && recRes.shortfallChoice === "outra_forma") ? round2(Math.abs(recRes.diff)) : 0;

      DB.batch(function () {
        lines.forEach(function (l) {
          var appt = l.appt, service = l.service;
          var amount = Utils.moneyMaskToFloat(box.querySelector("#" + l.rowPrefix + "-amount")) || appt.price;
          totalAmount += isParceria ? 0 : amount;
          var category = service ? DB.findOne("categories", function (c) { return c.id === service.categoryId; }) : null;
          var costCenter = DB.findOne("costCenters", function (c) { return c.key === "operacional"; });

          // Mesma forma de pagamento do "Fechar Conta" (payMethod, escolhida
          // uma única vez para o grupo inteiro) gravada em cada agendamento
          // do grupo — só para exibição em "Editar Agendamento".
          var apptPatch = { status: "concluido", price: amount, paymentMethod: payMethod };
          var splitPct = null;
          if (isParceria) {
            splitPct = resolvedParceriaSplitPercent(box, l.rowPrefix + "-parceria-pct", appt, l.employee);
            if (canEditParceriaSplit) apptPatch.commissionPercent = splitPct;
          }
          DB.update("appointments", appt.id, apptPatch);

          if (isParceria) {
            // Mesmo raciocínio do modal de conclusão única — ver comentário
            // em openConcludeSingleModal.
            var lineSplit = Utils.apptCommissionSplit(Object.assign({}, appt, { price: amount, commissionPercent: splitPct }), l.employee);
            var salonAmount = round2(amount - lineSplit.mainCommission - lineSplit.assistantCommission);
            DB.insert("transactions", {
              type: "despesa", description: "Parceria - " + (service ? service.name : "Atendimento") + " - " + client.name + " (" + splitPct + "% profissional / " + round2(100 - splitPct) + "% salão)",
              amount: salonAmount, date: appt.date, categoryId: parceriaCatId(), costCenterId: costCenter ? costCenter.id : null,
              paymentMethod: payMethod, status: "pago",
              employeeId: appt.employeeId, clientId: appt.clientId, appointmentId: appt.id, reconciled: false
            });
          } else {
            var lineRevenue = round2(amount);
            if (pendingShortfall > 0) {
              var take = Math.min(pendingShortfall, lineRevenue);
              lineRevenue = round2(lineRevenue - take);
              pendingShortfall = round2(pendingShortfall - take);
            }
            DB.insert("transactions", {
              type: "receita", description: (service ? service.name : "Atendimento") + " - " + client.name, amount: lineRevenue,
              date: appt.date, categoryId: category ? category.id : null, costCenterId: costCenter ? costCenter.id : null,
              paymentMethod: payMethod, status: "pago",
              employeeId: appt.employeeId, clientId: appt.clientId, appointmentId: appt.id, reconciled: false
            });
          }

          var tipEmp = Utils.moneyMaskToFloat(box.querySelector("#" + l.rowPrefix + "-tip-emp")) || 0;
          var tipAsst = l.assistant ? (Utils.moneyMaskToFloat(box.querySelector("#" + l.rowPrefix + "-tip-asst")) || 0) : 0;
          registerTip({ amount: tipEmp, employeeId: appt.employeeId, employeeLabel: l.employee ? l.employee.name : "Profissional", appt: appt, service: service, client: client, payMethod: payMethod, costCenter: costCenter });
          registerTip({ amount: tipAsst, employeeId: appt.assistantId, employeeLabel: l.assistant ? l.assistant.name : "Assistente", appt: appt, service: service, client: client, payMethod: payMethod, costCenter: costCenter });

          summaryParts.push(l.appt.time + " " + (service ? service.name : "Atendimento") + " (" + (l.employee ? l.employee.name : "-") + ")" + (isParceria ? " [Parceria " + splitPct + "%]" : ""));

          var rows = Utils.qsa(".insumo-item-row", box.querySelector("#" + l.rowPrefix + "-rows"));
          rows.forEach(function (row) {
            var tipo = row.querySelector(".ir-tipo").value;
            var productId = row.querySelector(".ir-produto").value;
            var qtd = parseFloat(row.querySelector(".ir-qtd").value) || 0;
            if (!productId || qtd <= 0) return;
            insumoCount++;
            if (tipo === "consumo") {
              if (window.Consumo) {
                try {
                  Consumo.register({ productId: productId, employeeId: appt.employeeId, appointmentId: appt.id, clientId: appt.clientId, date: appt.date, quantity: qtd, notes: service ? service.name : "" });
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
                paymentMethod: payMethod, status: "pago", employeeId: appt.employeeId, clientId: appt.clientId,
                productId: productId, appointmentId: appt.id, reconciled: false
              });
            }
          });
        });

        if (!isParceria) {
          var mainCostCenter = DB.findOne("costCenters", function (c) { return c.key === "operacional"; });
          var mainCategory = lines[0] && lines[0].service ? DB.findOne("categories", function (c) { return c.id === lines[0].service.categoryId; }) : null;
          if (recRes.diff < -0.004 && recRes.shortfallChoice === "outra_forma") {
            var shortfallTotal = round2(Math.abs(recRes.diff));
            DB.insert("transactions", {
              type: "receita", description: "Complemento de pagamento - " + client.name,
              amount: shortfallTotal, date: lines[0].appt.date, categoryId: mainCategory ? mainCategory.id : null, costCenterId: mainCostCenter ? mainCostCenter.id : null,
              paymentMethod: recRes.shortfallPayMethod, status: "pago",
              clientId: client.id, appointmentId: lines[0].appt.id, reconciled: false
            });
          }
          // Crédito do cliente: usado agora (desconta), gerado agora (pagou
          // a mais) e/ou pendência (se optou por deixar em aberto).
          if (recRes.creditToUse > 0) applyCreditChange(client, -recRes.creditToUse, "Crédito utilizado no Fechar Conta (" + summaryParts.join(" + ") + ")", lines[0].appt);
          if (recRes.diff > 0.004) applyCreditChange(client, recRes.diff, "Pagamento a maior — crédito gerado (" + summaryParts.join(" + ") + ")", lines[0].appt);
          else if (recRes.diff < -0.004 && recRes.shortfallChoice === "pendencia") applyCreditChange(client, recRes.diff, "Pagamento a menor — pendência gerada (" + summaryParts.join(" + ") + ")", lines[0].appt);
        }
      });

      DB.log("Agenda", "Fechou conta consolidada de " + client.name + " (" + summaryParts.join(" + ") + ")" + (isParceria ? " como Parceria" : " — total " + Utils.fmtMoney(totalAmount)) + (insumoCount ? " com " + insumoCount + " item(ns) de insumo/produto" : ""));
      // Um único pedido de avaliação por visita (não um por serviço), para
      // não mandar vários pedidos de avaliação seguidos para o mesmo
      // cliente por causa de um mesmo atendimento com vários serviços.
      if (window.Notificacoes) Notificacoes.queueReviewRequest(DB.get("appointments", lines[0].appt.id));
      Modal.close();
      Toast.show(isParceria ? "Conta fechada como Parceria: " + group.length + " atendimentos concluídos" : "Conta fechada: " + group.length + " atendimentos concluídos", "success");
      render();
    });
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // Lança insumo/produto retroativamente num atendimento JÁ CONCLUÍDO — a
  // pedido do usuário (ele reportou "não aparece nada" ao tentar lançar
  // consumo num agendamento já concluído: até aqui, a seção de
  // Insumos/Produtos só existia dentro do fluxo de "Concluir Atendimento",
  // que só roda enquanto o status ainda é "agendado" — ver openApptModal/
  // extraActions). Reaproveita a mesma UI/lógica de linhas de insumo
  // (insumoRowHtml/wireInsumoRow) e o mesmo registro usado em
  // openConcludeSingleModal/openConcludeGroupModal, mas sem reabrir o
  // valor cobrado do serviço nem gerar de novo o lançamento financeiro do
  // atendimento (que já existe desde a conclusão original) — só soma
  // consumo/produto extra a partir de agora.
  function openAddInsumoModal(appt) {
    var service = DB.get("services", appt.serviceId);
    var client = DB.get("clients", appt.clientId);
    var employee = DB.get("employees", appt.employeeId);
    var methods = paymentMethods();

    var body = '<div class="small text-muted mb-16">Atendimento já concluído: ' + Utils.escapeHtml(service ? service.name : "Serviço") + ' — ' + Utils.escapeHtml(client ? client.name : "Cliente") + ' (' + Utils.fmtDate(appt.date) + ' ' + appt.time + ').</div>' +
      '<div class="flex items-center justify-between mb-8">' +
        '<label style="font-weight:600;">Insumos / Produtos</label>' +
        '<button type="button" class="btn btn-sm btn-outline" id="ai-add-insumo"><i class="fa-solid fa-plus"></i> Adicionar item</button>' +
      '</div>' +
      '<div id="ai-insumo-rows"></div>' +
      '<div class="small text-muted mb-16">Consumo interno divide o custo 50/50 com ' + Utils.escapeHtml(employee ? employee.name : "o profissional") + '. "Levado pelo cliente" gera uma venda normal (usa a forma de pagamento abaixo).</div>' +
      '<div class="form-grid"><div class="form-field"><label>Forma de Pagamento (só para produto levado pelo cliente)</label><select id="ai-pay">' + methods.filter(function (p) { return !p.isPackage; }).map(function (p) { return '<option value="' + Utils.escapeHtml(p.name) + '">' + Utils.escapeHtml(p.name) + '</option>'; }).join("") + '</select></div></div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="ai-save">Salvar</button>';
    var box = Modal.open({ title: "Lançar Insumo/Produto", wide: true, bodyHtml: body, footHtml: foot });

    var rowsEl = box.querySelector("#ai-insumo-rows");
    function addRow() {
      rowsEl.insertAdjacentHTML("beforeend", insumoRowHtml());
      wireInsumoRow(rowsEl.lastElementChild);
    }
    addRow();
    box.querySelector("#ai-add-insumo").addEventListener("click", addRow);

    box.querySelector("#ai-save").addEventListener("click", function () {
      var rows = Utils.qsa(".insumo-item-row", rowsEl);
      var revendaCat = DB.findOne("categories", function (c) { return c.name === "Venda de Produtos"; });
      var comercialCc = DB.findOne("costCenters", function (c) { return c.key === "comercial"; });
      var payMethod = box.querySelector("#ai-pay").value;
      var registeredCount = 0;

      DB.batch(function () {
        rows.forEach(function (row) {
          var tipo = row.querySelector(".ir-tipo").value;
          var productId = row.querySelector(".ir-produto").value;
          var qtd = parseFloat(row.querySelector(".ir-qtd").value) || 0;
          if (!productId || qtd <= 0) return;
          registeredCount++;
          if (tipo === "consumo") {
            if (window.Consumo) {
              try {
                Consumo.register({ productId: productId, employeeId: appt.employeeId, appointmentId: appt.id, clientId: appt.clientId, date: appt.date, quantity: qtd, notes: service ? service.name : "" });
              } catch (err) { Toast.show(String(err), "danger"); }
            }
          } else {
            var product = DB.get("products", productId);
            if (!product) return;
            var saleAmount = round2((product.salePrice || product.costPrice || 0) * qtd);
            DB.update("products", productId, { currentStock: Math.max(0, round2((product.currentStock || 0) - qtd)) });
            DB.insert("stockMovements", { productId: productId, type: "saida", reason: "venda", quantity: qtd, date: appt.date, notes: "Levado por " + (client ? client.name : "cliente") + " (atendimento)" });
            DB.insert("transactions", {
              type: "receita", description: "Produto - " + product.name + " (" + (client ? client.name : "cliente") + ")", amount: saleAmount, date: appt.date,
              categoryId: revendaCat ? revendaCat.id : null, costCenterId: comercialCc ? comercialCc.id : null,
              paymentMethod: payMethod, status: "pago", employeeId: appt.employeeId, clientId: appt.clientId,
              productId: productId, appointmentId: appt.id, reconciled: false
            });
          }
        });
      });

      if (registeredCount === 0) { Toast.show("Selecione um produto e informe a quantidade", "danger"); return; }

      DB.log("Agenda", "Lançou insumo/produto retroativo no atendimento já concluído de " + appt.date + " " + appt.time + " (" + registeredCount + " item(ns))");
      Modal.close();
      Toast.show(registeredCount > 1 ? registeredCount + " itens lançados com sucesso" : "Item lançado com sucesso", "success");
      render();
    });
  }

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
    // Serviços sintéticos de pacote (isPackageService:true — ver
    // packageServiceFor) ficam fora do combo normal de Serviço: reception
    // nunca os seleciona à mão, só através do fluxo dedicado de pacotes
    // abaixo (modo "Sessão de um pacote já comprado"/"Vender novo pacote").
    var services = DB.all("services").filter(function (s) { return !s.isPackageService; }).sort(function (x, y) { return x.group.localeCompare(y.group) || x.name.localeCompare(y.name); });
    var employees = DB.all("employees").filter(function (e) { return e.status === "ativo" && employeePerformsServices(e); }).sort(function (x, y) { return x.name.localeCompare(y.name); });
    var allActiveEmployees = DB.all("employees").filter(function (e) { return e.status === "ativo"; }).sort(function (x, y) { return x.name.localeCompare(y.name); });
    var clients = DB.all("clients").sort(function (x, y) { return x.name.localeCompare(y.name); });
    var treatmentPackages = DB.getTreatmentPackages();
    var isPackageLinked = !!(a && a.packagePurchaseId);
    var linkedPackagePurchase = null;
    if (isPackageLinked) {
      var linkedClient = DB.get("clients", a.clientId);
      linkedPackagePurchase = linkedClient ? (linkedClient.packages || []).find(function (pp) { return pp.id === a.packagePurchaseId; }) : null;
    }

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

    // Duração inicial mostrada no campo "Duração (min)": o valor já ajustado
    // do agendamento (a.durationMin), quando existir; senão a duração
    // cadastrada no serviço já selecionado (o serviço do agendamento em
    // edição, ou o primeiro da lista — mesmo serviço que o <select> abaixo
    // seleciona por padrão quando não há nenhum "selected" explícito).
    var apptModalInitialDuration = (function () {
      if (a && a.durationMin != null) return a.durationMin;
      // Em edição, o serviço do agendamento pode ser um serviço sintético de
      // pacote (isPackageService:true) — esses ficam de propósito fora da
      // lista `services` (filtrada, ver acima), então busca-se direto no
      // banco em vez de procurar na lista filtrada, senão a duração cairia
      // no fallback de 30min em vez dos 60min fixos do pacote.
      var svcId = a ? a.serviceId : (services[0] ? services[0].id : null);
      var svc = svcId ? DB.get("services", svcId) : null;
      return (svc && svc.durationMin) ? svc.durationMin : 30;
    })();

    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Cliente</label>' +
        '<div class="flex gap-8" style="align-items:center;">' +
          '<div style="flex:1;">' + NameCombo.html({ id: "am-client", items: clients.map(function (c) { return { id: c.id, label: c.name }; }), value: a ? a.clientId : "", placeholder: "Nome e sobrenome do cliente" }) + '</div>' +
          (window.ClientesQuick ? '<button type="button" class="btn btn-sm btn-outline" id="am-new-client" style="white-space:nowrap;"><i class="fa-solid fa-user-plus"></i> Criar novo cliente</button>' : "") +
        '</div>' +
        (window.ClientesQuick ? '<div id="am-new-client-panel" style="display:none;border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px;margin-top:8px;background:var(--gray-50);">' + ClientesQuick.inlinePanelHtml("am-nc") + '</div>' : "") +
      '</div>' +
      (!a ?
        '<div class="form-field full"><label>Tipo de Atendimento</label><select id="am-appt-mode">' +
          '<option value="avulso">Atendimento avulso</option>' +
          '<option value="session">Sessão de um pacote já comprado</option>' +
          '<option value="sell">Vender novo pacote de tratamento</option>' +
        '</select></div>' +
        '<div class="form-field full" id="am-package-session-block" style="display:none;">' +
          '<label>Pacote do Cliente</label><select id="am-package-purchase"></select>' +
          '<div class="hint" id="am-package-session-info" style="margin-top:6px;"></div>' +
        '</div>' +
        '<div class="form-field full" id="am-package-sell-block" style="display:none;">' +
          '<div class="form-grid">' +
            '<div class="form-field"><label>Pacote</label><select id="am-package-def">' + treatmentPackages.map(function (pk) { return '<option value="' + pk.id + '">' + Utils.escapeHtml(pk.name) + '</option>'; }).join("") + '</select></div>' +
            '<div class="form-field"><label>Tamanho do Cabelo</label><select id="am-package-size">' + PACKAGE_SIZES.map(function (sz) { return '<option value="' + sz.key + '">' + sz.label + '</option>'; }).join("") + '</select></div>' +
          '</div>' +
          '<div class="hint" id="am-package-sell-info" style="margin-top:6px;"></div>' +
        '</div>'
      : (isPackageLinked ?
        '<div class="form-field full"><div style="border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px;background:var(--gray-50);font-size:13px;">' +
          'Sessão ' + a.packageSessionIndex + ' de ' + (linkedPackagePurchase ? linkedPackagePurchase.sessionsTotal : "?") + ' do pacote "' + (linkedPackagePurchase ? Utils.escapeHtml(linkedPackagePurchase.packageName) + " (" + Utils.escapeHtml(linkedPackagePurchase.sizeLabel) + ")" : "") + '". ' +
          'O profissional que concluir esta sessão recebe comissão sobre o valor diluído (' + Utils.fmtMoney(a.price) + ').' +
        '</div></div>'
      : "")) +
      '<div class="form-field full" id="am-service-wrap"' + (isPackageLinked ? ' style="display:none;"' : "") + '><label>Serviço</label>' + NameCombo.html({ id: "am-service", items: services.map(function (s) { return { id: s.id, label: s.name + " (" + s.group + ")" }; }), value: a ? a.serviceId : (services[0] ? services[0].id : ""), placeholder: "Nome do serviço" }) + '</div>' +
      '<div class="form-field"><label>Profissional</label>' + NameCombo.html({ id: "am-employee", items: [], value: "", placeholder: "Nome e sobrenome do profissional" }) + '</div>' +
      '<div class="form-field" id="am-price-wrap"' + (isPackageLinked ? ' style="display:none;"' : "") + '><label>Valor (R$)</label><input type="text" id="am-price"></div>' +
      '<div class="form-field"><label>Data</label><input type="date" id="am-date" value="' + (a ? a.date : (presets.date || selectedDate)) + '"></div>' +
      '<div class="form-field"><label>Hora</label><input type="time" id="am-time" value="' + (a ? a.time : (presets.time || "09:00")) + '"></div>' +
      '<div class="form-field"><label>Duração (min)</label><input type="number" id="am-duration" min="5" step="5" value="' + apptModalInitialDuration + '"></div>' +
      '<div class="form-field full"><div class="small text-muted">Ajuste aqui se o atendimento durar mais (ou menos) do que o padrão do serviço. Isso não move outros agendamentos automaticamente — ajuste a agenda manualmente se precisar.</div></div>' +
      '<div class="form-field"><label>Status</label><select id="am-status">' +
        '<option value="agendado"' + (a && a.status === "agendado" ? " selected" : "") + '>Agendado</option>' +
        '<option value="concluido"' + (a && a.status === "concluido" ? " selected" : "") + '>Concluído</option>' +
        '<option value="faltou"' + (a && a.status === "faltou" ? " selected" : "") + '>Faltou</option>' +
        '<option value="cancelado"' + (a && a.status === "cancelado" ? " selected" : "") + '>Cancelado</option>' +
        '</select></div>' +
      commissionFieldHtml({ id: "am-comm-pct", label: "Comissão do Profissional (%)", currentValue: a ? a.commissionPercent : null, defaultRate: currentEmployee ? currentEmployee.commissionRate : null }) +
      // Forma de pagamento usada ao concluir o atendimento — só exibição
      // (somente leitura), só aparece quando o atendimento está concluído e
      // tem a forma de pagamento gravada (ver openConcludeSingleModal /
      // openConcludeGroupModal / openConcludePackageSessionModal). Atendimentos
      // concluídos antes desta gravação existir não têm a.paymentMethod e por
      // isso ficam sem o campo, em vez de mostrar algo incorreto.
      (a && a.status === "concluido" && a.paymentMethod ?
        '<div class="form-field full"><label>Forma de Pagamento</label><input type="text" value="' + Utils.escapeHtml(a.paymentMethod) + '" disabled></div>'
      : "") +
      '</div>' +
      '<div class="divider" style="margin:14px 0;"></div>' +
      '<div class="form-grid">' +
        '<div class="form-field full"><label class="flex items-center gap-6" style="font-weight:600;"><input type="checkbox" id="am-has-assistant" style="width:auto;"' + (hasAssistant ? " checked" : "") + '> Incluir assistente neste atendimento</label></div>' +
        '<div id="am-assistant-fields" class="form-grid" style="grid-column:1/-1;display:' + (hasAssistant ? "grid" : "none") + ';">' +
          '<div class="form-field"><label>Assistente</label>' + NameCombo.html({ id: "am-assistant", items: allActiveEmployees.map(function (e) { return { id: e.id, label: e.name }; }), value: a ? a.assistantId : "", placeholder: "Nome e sobrenome do assistente" }) + '</div>' +
          commissionFieldHtml({ id: "am-assistant-pct", label: "Comissão do Assistente (%)", currentValue: a && a.assistantCommissionPercent != null ? a.assistantCommissionPercent : 10, defaultRate: currentAssistant ? currentAssistant.commissionRate : null, forceEditable: true }) +
        '</div>' +
      '</div>';

    var extraActions = "";
    if (a && a.status === "agendado") {
      extraActions = '<button class="btn btn-outline" id="am-conclude" type="button">Concluir</button>' +
        '<button class="btn btn-ghost" id="am-noshow" type="button">Marcar Falta</button>';
    } else if (a && a.status === "concluido") {
      // A pedido do usuário: antes não havia nenhuma forma de lançar
      // insumo/produto num atendimento já concluído por aqui (só existia
      // dentro do fluxo de "Concluir" em si) — ver openAddInsumoModal acima.
      extraActions = '<button class="btn btn-outline" id="am-add-insumo" type="button"><i class="fa-solid fa-box"></i> Lançar Insumo/Produto</button>';
    }
    var delBtn = a ? '<button class="btn btn-ghost" id="am-delete" type="button" style="color:var(--color-danger);">Excluir</button>' : "";
    var foot = delBtn + extraActions + '<button class="btn btn-secondary" data-close-modal>Fechar</button><button class="btn btn-primary" id="am-save">Salvar Agendamento</button>';
    var box = Modal.open({ title: a ? "Editar Agendamento" : "Novo Agendamento", wide: true, bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#am-price"), a ? a.price : 0);

    var amClientCombo = NameCombo.wire(box, { id: "am-client", items: clients.map(function (c) { return { id: c.id, label: c.name }; }) });
    var amEmployeeCombo = NameCombo.wire(box, { id: "am-employee", items: [] });
    var amAssistantCombo = NameCombo.wire(box, { id: "am-assistant", items: allActiveEmployees.map(function (e) { return { id: e.id, label: e.name }; }) });

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
      var presetEmployeeId = a ? a.employeeId : presets.employeeId;
      amEmployeeCombo.setItems(employees.map(function (e) { return { id: e.id, label: e.name }; }));
      if (presetEmployeeId) amEmployeeCombo.setValue(presetEmployeeId);
      updateDefaultCommission();
    }
    var servicesById = {};
    services.forEach(function (s) { servicesById[s.id] = s; });

    // Preenche Valor (R$)/Duração a partir do serviço escolhido — só em
    // "Novo Agendamento" (nunca sobrescreve os valores já salvos de um
    // agendamento em edição, mesmo que o serviço mude).
    function fillFromService(svc) {
      Utils.setMoneyMaskValue(box.querySelector("#am-price"), svc ? svc.price : 0);
      var durInput = box.querySelector("#am-duration");
      if (durInput) durInput.value = svc ? (svc.durationMin || 30) : 30;
    }
    var amServiceCombo = NameCombo.wire(box, {
      id: "am-service",
      items: services.map(function (s) { return { id: s.id, label: s.name + " (" + s.group + ")" }; }),
      onChange: function (item) { if (!a) fillFromService(item ? servicesById[item.id] : null); }
    });
    fillEmployeesFor();
    // Sem nenhum serviço cadastrado (Configurações → Serviços) o campo de
    // Serviço fica vazio — nada para preencher.
    if (!a && amServiceCombo.getValue()) fillFromService(servicesById[amServiceCombo.getValue()]);
    if (!a && !services.length) {
      Toast.show("Nenhum serviço cadastrado ainda. Cadastre serviços em Configurações antes de criar agendamentos.", "danger");
    }

    // ---------------- Pacote de Tratamento (só em Novo Agendamento) ----------------
    // "am-appt-mode" só existe no HTML quando !a — ver body acima. Alterna a
    // visibilidade de Serviço/Valor (normal) × os blocos de pacote, e ajusta
    // a Duração automaticamente para 60min nos modos de pacote (fixo, ver
    // packageServiceFor). A validação/gravação de verdade acontece só no
    // clique de "Salvar Agendamento" (#am-save).
    var apptModeSelEl = box.querySelector("#am-appt-mode");
    if (apptModeSelEl) {
      var serviceWrapEl = box.querySelector("#am-service-wrap");
      var priceWrapEl = box.querySelector("#am-price-wrap");
      var sessionBlockEl = box.querySelector("#am-package-session-block");
      var sellBlockEl = box.querySelector("#am-package-sell-block");
      var pkgPurchaseSelEl = box.querySelector("#am-package-purchase");
      var pkgSessionInfoEl = box.querySelector("#am-package-session-info");
      var pkgDefSelEl = box.querySelector("#am-package-def");
      var pkgSizeSelEl = box.querySelector("#am-package-size");
      var pkgSellInfoEl = box.querySelector("#am-package-sell-info");

      function refreshPackageSessionOptions() {
        var clientId = box.querySelector("#am-client").value;
        var client = clientId ? DB.get("clients", clientId) : null;
        var opts = (client && client.packages || []).filter(function (pp) { return (pp.sessionsTotal - (pp.appointmentIds || []).length) > 0; });
        if (!opts.length) {
          pkgPurchaseSelEl.innerHTML = '<option value="">' + (clientId ? "Nenhum pacote com sessão disponível para este cliente" : "Selecione o cliente primeiro") + '</option>';
          pkgSessionInfoEl.textContent = "";
          return;
        }
        pkgPurchaseSelEl.innerHTML = opts.map(function (pp) {
          var used = (pp.appointmentIds || []).length;
          return '<option value="' + pp.id + '">' + Utils.escapeHtml(pp.packageName) + " - " + Utils.escapeHtml(pp.sizeLabel) + " (sessão " + (used + 1) + " de " + pp.sessionsTotal + ")</option>";
        }).join("");
        updateSessionInfo();
      }
      function updateSessionInfo() {
        var clientId = box.querySelector("#am-client").value;
        var client = clientId ? DB.get("clients", clientId) : null;
        var pp = client && pkgPurchaseSelEl.value ? (client.packages || []).find(function (x) { return x.id === pkgPurchaseSelEl.value; }) : null;
        pkgSessionInfoEl.textContent = pp ? ("Valor diluído desta sessão: " + Utils.fmtMoney(pp.totalPrice / pp.sessionsTotal) + " — é sobre esse valor que a comissão do profissional é calculada.") : "";
      }
      function refreshPackageSellInfo() {
        if (!treatmentPackages.length) { pkgSellInfoEl.textContent = "Nenhum pacote cadastrado ainda. Cadastre em Configurações → Pacotes."; return; }
        var pkDef = treatmentPackages.find(function (pk) { return pk.id === pkgDefSelEl.value; });
        if (!pkDef) { pkgSellInfoEl.textContent = ""; return; }
        var sessionsTotal = pkDef.sessionsTotal || 4;
        var total = (pkDef.prices || {})[pkgSizeSelEl.value] || 0;
        pkgSellInfoEl.textContent = "Valor total (cobrado do cliente nesta 1ª sessão): " + Utils.fmtMoney(total) + " em " + sessionsTotal + " sessões — valor diluído por sessão: " + Utils.fmtMoney(total / sessionsTotal) + " (base da comissão do profissional em cada sessão).";
      }
      function applyModeVisibility() {
        var mode = apptModeSelEl.value;
        serviceWrapEl.style.display = mode === "avulso" ? "" : "none";
        priceWrapEl.style.display = mode === "avulso" ? "" : "none";
        sessionBlockEl.style.display = mode === "session" ? "" : "none";
        sellBlockEl.style.display = mode === "sell" ? "" : "none";
        if (mode === "avulso") {
          if (amServiceCombo.getValue()) fillFromService(servicesById[amServiceCombo.getValue()]);
        } else {
          var durInput = box.querySelector("#am-duration");
          if (durInput) durInput.value = 60;
          if (mode === "session") refreshPackageSessionOptions(); else refreshPackageSellInfo();
        }
      }
      apptModeSelEl.addEventListener("change", applyModeVisibility);
      pkgPurchaseSelEl.addEventListener("change", updateSessionInfo);
      pkgDefSelEl.addEventListener("change", refreshPackageSellInfo);
      pkgSizeSelEl.addEventListener("change", refreshPackageSellInfo);
      box.querySelector("#am-client").addEventListener("change", function () { if (apptModeSelEl.value === "session") refreshPackageSessionOptions(); });
      refreshPackageSellInfo();
    }

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
          // insere o cliente recém-criado na lista de sugestões e já o deixa selecionado
          clients.push(client);
          amClientCombo.setItems(clients.map(function (c) { return { id: c.id, label: c.name }; }));
          amClientCombo.setValue(client.id);
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
    } else if (a && a.status === "concluido") {
      box.querySelector("#am-add-insumo").addEventListener("click", function () {
        Modal.close();
        openAddInsumoModal(a);
      });
    }
    if (a) {
      box.querySelector("#am-delete").addEventListener("click", function () {
        var delMsg = "Deseja excluir este agendamento?";
        if (isPackageLinked) delMsg += " A sessão do pacote voltará a ficar disponível para ser reagendada.";
        Modal.confirm({
          title: "Excluir agendamento", message: delMsg, danger: true,
          onConfirm: function () {
            // Se este agendamento é uma sessão de pacote, libera a vaga
            // (remove o id de client.packages[].appointmentIds) antes de
            // excluir — a sessão volta a contar como "disponível" (ver
            // openApptModal → refreshPackageSessionOptions).
            if (isPackageLinked) {
              var delClient = DB.get("clients", a.clientId);
              if (delClient) {
                var newPackages = (delClient.packages || []).map(function (pp) {
                  if (pp.id !== a.packagePurchaseId) return pp;
                  return Object.assign({}, pp, { appointmentIds: (pp.appointmentIds || []).filter(function (aid) { return aid !== a.id; }) });
                });
                DB.update("clients", a.clientId, { packages: newPackages });
              }
            }
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
      // Duração real deste atendimento: só grava um valor explícito
      // (durationMin) quando o usuário deixou diferente do padrão do
      // serviço selecionado — assim um agendamento nunca ajustado continua
      // "seguindo" a duração cadastrada no serviço (Configurações →
      // Serviços), mesmo que ela mude no futuro. Ver apptDurationMin.
      // Modo do atendimento (só existe o seletor em Novo Agendamento — ver
      // "am-appt-mode" acima; em edição, ou quando é um atendimento avulso,
      // segue tudo pelo caminho normal abaixo, lendo Serviço/Valor do DOM).
      var apptModeSel = box.querySelector("#am-appt-mode");
      var apptMode = apptModeSel ? apptModeSel.value : "avulso";
      var packageServiceIdToUse = null, packagePriceToUse = null, packageDurationToUse = null;
      var pendingPackageSell = null, pendingPackageSession = null;
      if (!a && apptMode === "session") {
        var sessClientId = box.querySelector("#am-client").value;
        var sessClient = sessClientId ? DB.get("clients", sessClientId) : null;
        var sessPurchaseId = box.querySelector("#am-package-purchase") ? box.querySelector("#am-package-purchase").value : "";
        var sessPurchase = sessClient ? (sessClient.packages || []).find(function (pp) { return pp.id === sessPurchaseId; }) : null;
        if (!sessClient || !sessPurchase) { Toast.show("Selecione o cliente e o pacote com sessão disponível", "danger"); return; }
        packageServiceIdToUse = sessPurchase.linkedServiceId;
        packagePriceToUse = round2(sessPurchase.totalPrice / sessPurchase.sessionsTotal);
        packageDurationToUse = 60;
        pendingPackageSession = { client: sessClient, purchase: sessPurchase };
      } else if (!a && apptMode === "sell") {
        var pkDefId = box.querySelector("#am-package-def") ? box.querySelector("#am-package-def").value : "";
        var pkDef = treatmentPackages.find(function (pk) { return pk.id === pkDefId; });
        var pkSizeKey = box.querySelector("#am-package-size") ? box.querySelector("#am-package-size").value : "";
        var pkSize = PACKAGE_SIZES.filter(function (sz) { return sz.key === pkSizeKey; })[0];
        var sellClientId = box.querySelector("#am-client").value;
        if (!pkDef || !pkSize) { Toast.show("Selecione o pacote e o tamanho de cabelo", "danger"); return; }
        if (!sellClientId) { Toast.show("Selecione o cliente", "danger"); return; }
        var pkTotal = (pkDef.prices || {})[pkSizeKey] || 0;
        if (pkTotal <= 0) { Toast.show("Este pacote não tem um valor cadastrado para o tamanho \"" + pkSize.label + "\"", "danger"); return; }
        var pkSessions = pkDef.sessionsTotal || 4;
        var pkSvc = packageServiceFor(pkDef);
        packageServiceIdToUse = pkSvc.id;
        packagePriceToUse = round2(pkTotal / pkSessions);
        packageDurationToUse = 60;
        pendingPackageSell = { clientId: sellClientId, pkDef: pkDef, sizeKey: pkSizeKey, sizeLabel: pkSize.label, totalPrice: pkTotal, sessionsTotal: pkSessions };
      }
      var serviceIdForDuration = packageServiceIdToUse || box.querySelector("#am-service").value;
      var selectedServiceObj = DB.get("services", serviceIdForDuration);
      var defaultDurationMin = packageDurationToUse || ((selectedServiceObj && selectedServiceObj.durationMin) ? selectedServiceObj.durationMin : 30);
      var durRaw = parseInt(box.querySelector("#am-duration").value, 10);
      if (isNaN(durRaw) || durRaw <= 0) durRaw = defaultDurationMin;
      var patch = {
        clientId: box.querySelector("#am-client").value, serviceId: packageServiceIdToUse || box.querySelector("#am-service").value,
        employeeId: box.querySelector("#am-employee").value, price: packagePriceToUse != null ? packagePriceToUse : round2(Utils.moneyMaskToFloat(box.querySelector("#am-price"))),
        date: box.querySelector("#am-date").value, time: box.querySelector("#am-time").value,
        durationMin: (durRaw !== defaultDurationMin) ? durRaw : null,
        status: box.querySelector("#am-status").value,
        commissionPercent: commPct,
        assistantId: hasAsst ? box.querySelector("#am-assistant").value : null,
        assistantCommissionPercent: assistantPct
      };
      if (!patch.date || !patch.time) { Toast.show("Informe data e hora", "danger"); return; }
      if (!patch.employeeId) { Toast.show("Selecione um profissional", "danger"); return; }
      if (hasAsst && !patch.assistantId) { Toast.show("Selecione o assistente ou desmarque a opção", "danger"); return; }
      // Lançamento em data/hora retroativa é permitido para qualquer status
      // (inclusive "agendado") — a pedido do usuário, para registrar
      // atendimentos feitos no passado sem precisar passar por "Concluído"
      // primeiro. Removido o bloqueio que antes impedia salvar um horário
      // já passado.
      var savedAppt;
      if (a) { DB.update("appointments", a.id, patch); savedAppt = DB.get("appointments", a.id); DB.log("Agenda", "Atualizou o agendamento de " + patch.date + " " + patch.time); Toast.show("Agendamento atualizado", "success"); }
      else if (pendingPackageSession) {
        // Sessão de um pacote já vendido: cria o agendamento e vincula ao
        // registro de compra existente do cliente (client.packages),
        // ocupando mais uma "vaga" de sessão (appointmentIds).
        DB.batch(function () {
          savedAppt = DB.insert("appointments", patch);
          var usedBefore = (pendingPackageSession.purchase.appointmentIds || []).length;
          var updatedPurchase = Object.assign({}, pendingPackageSession.purchase, {
            appointmentIds: (pendingPackageSession.purchase.appointmentIds || []).concat([savedAppt.id])
          });
          var newPackages = (pendingPackageSession.client.packages || []).map(function (pp) { return pp.id === updatedPurchase.id ? updatedPurchase : pp; });
          DB.update("clients", pendingPackageSession.client.id, { packages: newPackages });
          DB.update("appointments", savedAppt.id, { packagePurchaseId: updatedPurchase.id, packageSessionIndex: usedBefore + 1 });
        });
        savedAppt = DB.get("appointments", savedAppt.id);
        DB.log("Agenda", "Criou a sessão " + savedAppt.packageSessionIndex + " do pacote \"" + pendingPackageSession.purchase.packageName + "\" para " + patch.date + " " + patch.time);
        Toast.show("Sessão de pacote criada", "success");
      } else if (pendingPackageSell) {
        // Venda de um novo pacote (1ª sessão): cria o agendamento e um novo
        // registro de compra em client.packages, já com esta sessão ocupada.
        DB.batch(function () {
          savedAppt = DB.insert("appointments", patch);
          var newPurchase = {
            id: DB.uid("cpkg"), packageId: pendingPackageSell.pkDef.id, packageName: pendingPackageSell.pkDef.name,
            sizeKey: pendingPackageSell.sizeKey, sizeLabel: pendingPackageSell.sizeLabel,
            totalPrice: pendingPackageSell.totalPrice, sessionsTotal: pendingPackageSell.sessionsTotal,
            purchaseDate: patch.date, soldByEmployeeId: patch.employeeId,
            linkedServiceId: patch.serviceId, appointmentIds: [savedAppt.id]
          };
          var sellClient = DB.get("clients", pendingPackageSell.clientId);
          DB.update("clients", pendingPackageSell.clientId, { packages: (sellClient.packages || []).concat([newPurchase]) });
          DB.update("appointments", savedAppt.id, { packagePurchaseId: newPurchase.id, packageSessionIndex: 1 });
        });
        savedAppt = DB.get("appointments", savedAppt.id);
        DB.log("Agenda", "Vendeu o pacote \"" + pendingPackageSell.pkDef.name + "\" (" + pendingPackageSell.sizeLabel + ") para " + patch.date + " " + patch.time);
        Toast.show("Pacote vendido — lembre-se de cobrar o valor cheio ao concluir esta sessão", "success");
      }
      else { savedAppt = DB.insert("appointments", patch); DB.log("Agenda", "Criou um agendamento para " + patch.date + " " + patch.time); Toast.show("Agendamento criado", "success"); }
      // A agenda permite salvar agendamentos no mesmo horário/sobrepostos
      // sem mexer em mais nada — o sistema não reorganiza automaticamente
      // os agendamentos seguintes do profissional; quem administra a
      // agenda ajusta manualmente quando precisar.
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
