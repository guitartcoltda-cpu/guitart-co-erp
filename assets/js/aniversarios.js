/* ============================================================
   Salão ERP — Aniversariantes do Mês (calendário)
   Módulo compartilhado usado por Clientes e Funcionários: mostra,
   num calendário mensal, cada aniversariante (cliente ou
   funcionário) no seu dia — sem considerar o ano de nascimento,
   só mês/dia. Aberto via Aniversarios.openModal().
   ============================================================ */
(function (global) {
  "use strict";

  var MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  var WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  function monthDay(dateStr) {
    if (!dateStr) return null;
    var parts = String(dateStr).split("-");
    if (parts.length < 3) return null;
    return { month: parseInt(parts[1], 10), day: parseInt(parts[2], 10) };
  }

  // year/month (1-12) -> lista de aniversariantes daquele mês, cada um com
  // { type: "cliente"|"funcionario", name, day, photoUrl }
  function birthdaysInMonth(month) {
    var out = [];
    DB.all("clients").forEach(function (c) {
      var md = monthDay(c.birthday);
      if (md && md.month === month) out.push({ type: "cliente", name: c.name, day: md.day, photoUrl: c.photoDataUrl || null, phone: c.phone });
    });
    DB.all("employees").forEach(function (e) {
      var md = monthDay(e.birthday);
      if (md && md.month === month) out.push({ type: "funcionario", name: e.name, day: md.day, photoUrl: e.photoDataUrl || null, phone: e.phone });
    });
    out.sort(function (a, b) { return a.day - b.day || a.name.localeCompare(b.name); });
    return out;
  }

  function renderCalendar(year, month) {
    var todayISO = Utils.todayISO();
    var todayParts = todayISO.split("-").map(Number);
    var isCurrentMonth = todayParts[0] === year && todayParts[1] === month;
    var todayDay = isCurrentMonth ? todayParts[2] : -1;

    var birthdays = birthdaysInMonth(month);
    var byDay = {};
    birthdays.forEach(function (b) { (byDay[b.day] = byDay[b.day] || []).push(b); });

    var firstWeekday = new Date(year, month - 1, 1).getDay(); // 0=domingo
    var daysInMonth = new Date(year, month, 0).getDate();

    var cells = [];
    for (var i = 0; i < firstWeekday; i++) cells.push('<div class="bday-cell bday-cell-empty"></div>');
    for (var d = 1; d <= daysInMonth; d++) {
      var people = byDay[d] || [];
      var chips = people.map(function (p) {
        var icon = p.type === "cliente" ? "fa-user" : "fa-user-tie";
        var cls = p.type === "cliente" ? "bday-chip-cliente" : "bday-chip-funcionario";
        return '<div class="bday-chip ' + cls + '" title="' + Utils.escapeHtml(p.name) + ' (' + (p.type === "cliente" ? "cliente" : "funcionário") + ')">' +
          '<i class="fa-solid ' + icon + '"></i> ' + Utils.escapeHtml(p.name.split(" ")[0]) + '</div>';
      }).join("");
      cells.push('<div class="bday-cell' + (d === todayDay ? " bday-cell-today" : "") + '">' +
        '<div class="bday-daynum">' + d + '</div>' +
        '<div class="bday-chips">' + chips + '</div>' +
        '</div>');
    }

    var weekdayHeader = WEEKDAY_LABELS.map(function (w) { return '<div class="bday-weekday">' + w + '</div>'; }).join("");

    var summary = birthdays.length
      ? '<div class="small text-muted mb-12">' + birthdays.length + ' aniversariante(s) em ' + MONTH_NAMES[month - 1] + ': ' +
          birthdays.map(function (b) { return Utils.escapeHtml(b.name) + ' (dia ' + b.day + ')'; }).join(", ") + '</div>'
      : '<div class="small text-muted mb-12">Nenhum aniversariante cadastrado para ' + MONTH_NAMES[month - 1] + '.</div>';

    return '<div class="flex items-center justify-between mb-12">' +
        '<button type="button" class="btn btn-sm btn-secondary" id="bday-prev"><i class="fa-solid fa-chevron-left"></i></button>' +
        '<h3 style="margin:0;">' + MONTH_NAMES[month - 1] + ' de ' + year + '</h3>' +
        '<button type="button" class="btn btn-sm btn-secondary" id="bday-next"><i class="fa-solid fa-chevron-right"></i></button>' +
      '</div>' +
      '<div class="flex items-center gap-16 mb-12 small text-muted">' +
        '<span><span class="bday-legend-dot bday-chip-cliente"></span> Cliente</span>' +
        '<span><span class="bday-legend-dot bday-chip-funcionario"></span> Funcionário</span>' +
      '</div>' +
      summary +
      '<div class="bday-grid">' + weekdayHeader + cells.join("") + '</div>';
  }

  function openModal(initial) {
    var today = new Date();
    var year = (initial && initial.year) || today.getFullYear();
    var month = (initial && initial.month) || (today.getMonth() + 1);

    var box = Modal.open({ title: "Aniversariantes", wide: true, bodyHtml: '<div id="bday-body"></div>', footHtml: '<button class="btn btn-secondary" data-close-modal>Fechar</button>' });

    function paint() {
      box.querySelector("#bday-body").innerHTML = renderCalendar(year, month);
      box.querySelector("#bday-prev").addEventListener("click", function () {
        month--; if (month < 1) { month = 12; year--; }
        paint();
      });
      box.querySelector("#bday-next").addEventListener("click", function () {
        month++; if (month > 12) { month = 1; year++; }
        paint();
      });
    }
    paint();
  }

  global.Aniversarios = { openModal: openModal, birthdaysInMonth: birthdaysInMonth };
})(window);
