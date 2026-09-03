/* ============================================================
   Salão ERP — Ponto (bater ponto)
   Tela tipo "quiosque": qualquer pessoa logada no sistema abre esta tela
   num aparelho compartilhado (tablet/celular na recepção, por exemplo),
   escolhe o próprio nome na lista de quem está marcado para bater ponto
   (Funcionários → editar → "Bate ponto pelo sistema?") e cai no "Meu Dia":
   o fluxo de hoje (entrada, saída para almoço, volta do almoço e saída,
   nessa ordem, calculado sozinho a partir do que já foi batido), o botão
   para bater o próximo passo (com selfie — é a forma de auditoria: quem
   revisa depois, na tela Gestão de Ponto, confere se bate com a pessoa),
   o espelho de ponto do mês (horas trabalhadas/extras/faltantes/saldo) e
   o botão para solicitar um ajuste ou registrar uma ocorrência do dia
   (falta justificada, atestado médico, folga/abono etc.) — que vai para
   aprovação de um administrador antes de valer (ver ponto-ajustes.js).
   ============================================================ */
(function () {
  "use strict";

  var STEPS = [
    { type: "entrada", label: "Entrada", icon: "fa-right-to-bracket" },
    { type: "saida_almoco", label: "Saída Almoço", icon: "fa-utensils" },
    { type: "volta_almoco", label: "Volta Almoço", icon: "fa-mug-saucer" },
    { type: "saida", label: "Saída", icon: "fa-right-from-bracket" }
  ];

  var selectedEmployee = null;
  var selectedStep = null;
  var espelhoRef = null; // Date do mês mostrado no espelho de ponto (tela "Meu Dia")

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function init() {
    renderPicker();
  }

  function eligibleEmployees() {
    return DB.all("employees")
      .filter(function (e) { return e.status === "ativo" && !!e.requiresTimeClock; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function todaysEntries(employeeId) {
    var today = Utils.todayISO();
    return DB.all("timeClockEntries").filter(function (t) { return t.employeeId === employeeId && t.date === today; });
  }

  // Primeiro passo (dos 4) que essa pessoa ainda não registrou hoje, ou
  // null se os 4 já foram batidos.
  function nextStepFor(employeeId) {
    var done = todaysEntries(employeeId);
    var doneTypes = {};
    done.forEach(function (t) { doneTypes[t.type] = true; });
    for (var i = 0; i < STEPS.length; i++) {
      if (!doneTypes[STEPS[i].type]) return STEPS[i];
    }
    return null;
  }

  function showOnly(id) {
    ["ponto-picker", "ponto-confirm", "ponto-done"].forEach(function (elId) {
      document.getElementById(elId).style.display = elId === id ? "" : "none";
    });
  }

  function renderPicker() {
    selectedEmployee = null;
    selectedStep = null;
    showOnly("ponto-picker");
    var emps = eligibleEmployees();
    var grid = document.getElementById("ponto-emp-grid");
    var empty = document.getElementById("ponto-emp-empty");
    if (!emps.length) {
      grid.innerHTML = "";
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";
    grid.innerHTML = emps.map(function (e) {
      var next = nextStepFor(e.id);
      var badge = next
        ? '<div class="small text-muted">' + Utils.escapeHtml(next.label) + '</div>'
        : '<div class="small" style="color:var(--color-success);">Dia concluído</div>';
      return '<button type="button" class="ponto-emp-card" data-emp="' + e.id + '">' +
          Utils.avatarHtml(e.name, e.photoDataUrl, "avatar-lg") +
          '<div class="font-bold mt-8">' + Utils.escapeHtml(e.name) + '</div>' +
          badge +
        '</button>';
    }).join("");
    Utils.qsa("[data-emp]", grid).forEach(function (btn) {
      btn.addEventListener("click", function () { openDay(btn.getAttribute("data-emp")); });
    });
  }

  // ---------------- "Meu Dia": fluxo de hoje + espelho de ponto + ajuste ----------------
  function openDay(employeeId) {
    var e = DB.get("employees", employeeId);
    if (!e) return;
    selectedEmployee = e;
    espelhoRef = new Date();
    showOnly("ponto-confirm");
    renderDay();
  }

  function stepStateHtml() {
    var done = todaysEntries(selectedEmployee.id);
    var doneByType = {};
    done.forEach(function (t) { doneByType[t.type] = t; });
    var next = nextStepFor(selectedEmployee.id);
    return '<div class="ponto-steps">' + STEPS.map(function (s, i) {
      var rec = doneByType[s.type];
      var state = rec ? "done" : (next && next.type === s.type ? "current" : "pending");
      var time = rec ? new Date(rec.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--";
      return (i > 0 ? '<div class="ponto-step-line ' + (state !== "pending" || rec ? "filled" : "") + '"></div>' : "") +
        '<div class="ponto-step ' + state + '">' +
          '<div class="ponto-step-icon"><i class="fa-solid ' + (rec ? "fa-check" : s.icon) + '"></i></div>' +
          '<div class="ponto-step-label">' + s.label + '</div>' +
          '<div class="ponto-step-time">' + time + '</div>' +
        '</div>';
    }).join("") + '</div>';
  }

  function renderDay() {
    var e = selectedEmployee;
    selectedStep = nextStepFor(e.id);
    var body = document.getElementById("ponto-confirm-body");

    var actionHtml;
    if (!selectedStep) {
      actionHtml = '<div class="ponto-day-status ponto-day-status-ok"><i class="fa-solid fa-circle-check"></i> Os 4 registros de hoje já foram feitos.</div>';
    } else {
      actionHtml =
        '<div class="small text-muted mb-8">Próximo: <strong>' + Utils.escapeHtml(selectedStep.label) + '</strong> — tire uma selfie para confirmar, é o jeito de garantir que foi você mesmo quem bateu o ponto.</div>' +
        '<label class="btn btn-primary" style="cursor:pointer;"><i class="fa-solid fa-camera"></i> Tirar Selfie e Registrar ' + Utils.escapeHtml(selectedStep.label) +
          '<input type="file" id="ponto-selfie-input" accept="image/*" capture="user" style="display:none;"></label>' +
        '<div id="ponto-saving" class="small text-muted mt-8" style="display:none;">Salvando...</div>';
    }

    body.innerHTML =
      '<div class="flex items-center gap-16 mb-16" style="justify-content:space-between;flex-wrap:wrap;">' +
        '<div class="flex items-center gap-16">' + Utils.avatarHtml(e.name, e.photoDataUrl, "avatar-lg") +
          '<div><div class="font-bold" style="font-size:16px;">' + Utils.escapeHtml(e.name) + '</div>' +
          '<div class="small text-muted">' + new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }) + '</div></div>' +
        '</div>' +
        '<button class="btn btn-secondary btn-sm" id="ponto-back"><i class="fa-solid fa-arrow-left"></i> Trocar</button>' +
      '</div>' +
      '<div class="ponto-day-card">' +
        '<div class="ponto-day-card-title">Fluxo de Hoje</div>' +
        stepStateHtml() +
        '<div class="ponto-day-actions">' + actionHtml + '</div>' +
      '</div>' +
      '<div class="ponto-day-card">' +
        '<div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
          '<div class="ponto-day-card-title" style="margin:0;">Precisa corrigir algo?</div>' +
          '<button class="btn btn-outline btn-sm" id="ponto-open-adjust"><i class="fa-solid fa-clock-rotate-left"></i> Solicitar Ajuste / Registrar Ocorrência</button>' +
        '</div>' +
        '<div class="small text-muted mt-8">Esqueceu de bater, bateu no horário errado, faltou com atestado, tirou uma folga? Registre aqui — vai para aprovação de um administrador.</div>' +
      '</div>' +
      '<div class="ponto-day-card" id="ponto-espelho-card"></div>';

    document.getElementById("ponto-back").addEventListener("click", renderPicker);
    document.getElementById("ponto-open-adjust").addEventListener("click", function () { openAdjustModal(e); });
    if (selectedStep) {
      document.getElementById("ponto-selfie-input").addEventListener("change", function (ev) {
        var file = ev.target.files && ev.target.files[0];
        if (!file) return;
        document.getElementById("ponto-saving").style.display = "";
        Utils.fileToAvatarDataUrl(file, 240, function (dataUrl) {
          if (!dataUrl) { Toast.show("Não foi possível carregar a selfie — tente de novo", "danger"); document.getElementById("ponto-saving").style.display = "none"; return; }
          saveEntry(e, selectedStep, dataUrl);
        });
      });
    }
    renderEspelho();
  }

  function saveEntry(e, step, selfieDataUrl) {
    // Rechecagem de última hora: se essa pessoa bateu esse mesmo passo em
    // outra aba/aparelho nos segundos entre abrir a tela e tirar a selfie,
    // não deixa duplicar.
    var current = nextStepFor(e.id);
    if (!current || current.type !== step.type) {
      Toast.show("Esse registro já foi feito — a lista foi atualizada.", "danger");
      renderDay();
      return;
    }
    var record = {
      employeeId: e.id,
      employeeName: e.name,
      date: Utils.todayISO(),
      type: step.type,
      timestamp: new Date().toISOString(),
      selfieDataUrl: selfieDataUrl,
      reviewed: false
    };
    DB.insert("timeClockEntries", record);
    DB.log("Ponto", e.name + " registrou: " + step.label);
    showDone(e, step);
  }

  function showDone(e, step) {
    showOnly("ponto-done");
    var now = new Date();
    document.getElementById("ponto-done-body").innerHTML =
      '<div class="empty-state">' +
        '<div class="es-icon" style="color:var(--color-success);"><i class="fa-solid fa-circle-check"></i></div>' +
        '<h4>Registrado, ' + Utils.escapeHtml(e.name.split(" ")[0]) + '!</h4>' +
        '<p class="small text-muted">' + Utils.escapeHtml(step.label) + ' às ' + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + '</p>' +
      '</div>';
    Toast.show("Ponto registrado: " + step.label, "success");
    setTimeout(renderPicker, 4000);
  }

  // ---------------- Espelho de Ponto (mês) ----------------
  function renderEspelho() {
    var card = document.getElementById("ponto-espelho-card");
    if (!card) return;
    var range = PontoCalc.monthRange(espelhoRef);
    var data = PontoCalc.espelho(selectedEmployee.id, range.start, range.end, selectedEmployee);
    var monthLabel = range.label.charAt(0).toUpperCase() + range.label.slice(1);

    var rowsHtml = data.days.length
      ? data.days.map(dayRowHtml).join("")
      : '<tr><td colspan="7" class="text-center text-muted" style="padding:20px;">Nenhum registro neste mês</td></tr>';

    card.innerHTML =
      '<div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
        '<div class="ponto-day-card-title" style="margin:0;">Meu Espelho de Ponto</div>' +
        '<div class="flex items-center gap-8">' +
          '<button class="btn btn-icon btn-ghost btn-sm" id="esp-prev" title="Mês anterior"><i class="fa-solid fa-chevron-left"></i></button>' +
          '<div class="small font-bold" style="min-width:130px;text-align:center;">' + monthLabel + '</div>' +
          '<button class="btn btn-icon btn-ghost btn-sm" id="esp-next" title="Próximo mês"><i class="fa-solid fa-chevron-right"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="table-wrap mt-8"><table class="data-table"><thead><tr>' +
        '<th>Data</th><th>Entrada</th><th>Almoço</th><th>Saída</th><th>Trabalhado</th><th>Extras / Faltantes</th><th>Saldo</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody>' +
      (data.days.length ? '<tfoot><tr class="ponto-espelho-totals">' +
        '<td colspan="4">Total do mês</td>' +
        '<td class="text-num">' + PontoCalc.fmtHM(data.totals.workedMin) + '</td>' +
        '<td class="text-num">+' + PontoCalc.fmtHM(data.totals.extraMin) + ' / -' + PontoCalc.fmtHM(data.totals.missingMin) + '</td>' +
        '<td class="text-num ' + (data.totals.saldoMin < 0 ? "text-danger" : "text-success") + '">' + PontoCalc.fmtHM(data.totals.saldoMin) + '</td>' +
      '</tr></tfoot>' : "") +
      '</table></div>';

    document.getElementById("esp-prev").addEventListener("click", function () {
      espelhoRef = new Date(espelhoRef.getFullYear(), espelhoRef.getMonth() - 1, 1);
      renderEspelho();
    });
    document.getElementById("esp-next").addEventListener("click", function () {
      espelhoRef = new Date(espelhoRef.getFullYear(), espelhoRef.getMonth() + 1, 1);
      renderEspelho();
    });
  }

  function hhmm(rec) { return rec ? new Date(rec.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "-"; }

  function dayRowHtml(d) {
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
      '<td class="text-num">' + hhmm(d.entrada) + '</td>' +
      '<td class="text-num">' + (d.saidaAlmoco || d.voltaAlmoco ? hhmm(d.saidaAlmoco) + ' → ' + hhmm(d.voltaAlmoco) : '-') + '</td>' +
      '<td class="text-num">' + hhmm(d.saida) + '</td>' +
      '<td class="text-num">' + (d.workedMin != null ? PontoCalc.fmtHM(d.workedMin) : "-") + (statusBadge ? '<div>' + statusBadge + '</div>' : '') + '</td>' +
      '<td class="text-num">' + (d.workedMin != null ? '+' + PontoCalc.fmtHM(d.extraMin) + ' / -' + PontoCalc.fmtHM(d.missingMin) : '-') + '</td>' +
      '<td class="text-num ' + (d.workedMin != null ? (d.saldoMin < 0 ? "text-danger" : "text-success") : "") + '">' + (d.workedMin != null ? PontoCalc.fmtHM(d.saldoMin) : "-") + '</td>' +
    '</tr>';
  }

  // ---------------- Solicitar ajuste / ocorrência (modal) ----------------
  function employeeRecentPunches(employeeId) {
    return DB.all("timeClockEntries").filter(function (t) { return t.employeeId === employeeId && PontoCalc.isPunchType(t.type); })
      .sort(function (a, b) { return (b.timestamp || "").localeCompare(a.timestamp || ""); })
      .slice(0, 20);
  }

  var KIND_CARDS = [
    { kind: "ponto_novo", label: "Esqueci de Bater", icon: "fa-clock" },
    { kind: "ponto_corrigir", label: "Corrigir Horário", icon: "fa-pen" },
    { kind: "falta_justificada", label: "Falta Justificada", icon: "fa-user-slash" },
    { kind: "atestado", label: "Atestado Médico", icon: "fa-file-medical" },
    { kind: "folga_abono", label: "Folga / Abono", icon: "fa-umbrella-beach" },
    { kind: "outro", label: "Outra Situação", icon: "fa-circle-info" }
  ];

  function openAdjustModal(e) {
    var recent = employeeRecentPunches(e.id);
    var cards = KIND_CARDS.filter(function (c) { return c.kind !== "ponto_corrigir" || recent.length; });
    var selectedKind = null;
    var attachmentCtl = null;

    var body =
      '<div class="small text-muted mb-16">Escolha o que aconteceu — a solicitação vai para aprovação de um administrador antes de valer.</div>' +
      '<div class="ponto-kind-grid" id="adj-kind-grid">' +
        cards.map(function (c) {
          return '<button type="button" class="ponto-kind-card" data-kind="' + c.kind + '"><i class="fa-solid ' + c.icon + '"></i>' + c.label + '</button>';
        }).join("") +
      '</div>' +
      '<div id="adj-fields" style="display:none;margin-top:16px;"></div>';
    var foot =
      '<button class="btn btn-secondary" data-close-modal>Cancelar</button>' +
      '<button class="btn btn-primary" id="adj-send" style="display:none;">Enviar Solicitação</button>';
    var box = Modal.open({ title: "Solicitar Ajuste de Ponto — " + e.name.split(" ")[0], wide: true, bodyHtml: body, footHtml: foot });
    var fieldsEl = box.querySelector("#adj-fields");
    var sendBtn = box.querySelector("#adj-send");

    function fieldsHtmlFor(kind) {
      if (kind === "ponto_novo") {
        return '<div class="form-field full"><label>Tipo</label><select id="adj-type">' +
            PontoCalc.PUNCH_TYPES.map(function (t) { return '<option value="' + t + '">' + PontoCalc.PUNCH_LABELS[t] + '</option>'; }).join("") +
          '</select></div>' +
          '<div class="flex gap-16">' +
            '<div class="form-field"><label>Data</label><input type="date" id="adj-date" value="' + Utils.todayISO() + '" max="' + Utils.todayISO() + '"></div>' +
            '<div class="form-field"><label>Horário</label><input type="time" id="adj-time"></div>' +
          '</div>';
      }
      if (kind === "ponto_corrigir") {
        return '<div class="form-field full"><label>Qual registro?</label><select id="adj-target">' +
            recent.map(function (t) {
              var hh = hhmm(t);
              return '<option value="' + t.id + '">' + Utils.fmtDate(t.date) + ' — ' + (PontoCalc.PUNCH_LABELS[t.type] || t.type) + ' — ' + hh + '</option>';
            }).join("") +
          '</select></div>' +
          '<div class="form-field"><label>Horário correto</label><input type="time" id="adj-target-time"></div>';
      }
      // Ocorrências: falta_justificada / atestado / folga_abono / outro
      var showRange = kind === "atestado" || kind === "folga_abono";
      return '<div class="flex gap-16">' +
          '<div class="form-field"><label>' + (showRange ? "De" : "Data") + '</label><input type="date" id="adj-date" value="' + Utils.todayISO() + '"></div>' +
          (showRange ? '<div class="form-field"><label>Até (opcional)</label><input type="date" id="adj-end-date"></div>' : '') +
        '</div>' +
        Utils.attachmentFieldHtml("adj", kind === "atestado" ? "Anexar atestado (opcional)" : "Anexar arquivo (opcional)");
    }

    function selectKind(kind) {
      selectedKind = kind;
      Utils.qsa(".ponto-kind-card", box).forEach(function (btn) { btn.classList.toggle("active", btn.getAttribute("data-kind") === kind); });
      fieldsEl.style.display = "";
      fieldsEl.innerHTML = fieldsHtmlFor(kind) +
        '<div class="form-field full"><label>Motivo</label><textarea id="adj-reason" rows="2" placeholder="Explique rapidamente o que aconteceu"></textarea></div>';
      sendBtn.style.display = "";
      attachmentCtl = fieldsEl.querySelector("#adj-attach-input") ? Utils.wireAttachmentField(fieldsEl, "adj", null) : null;
    }

    Utils.qsa(".ponto-kind-card", box).forEach(function (btn) {
      btn.addEventListener("click", function () { selectKind(btn.getAttribute("data-kind")); });
    });

    sendBtn.addEventListener("click", function () {
      var reason = box.querySelector("#adj-reason").value.trim();
      if (!reason) { Toast.show("Descreva o motivo da solicitação", "danger"); return; }
      var payload = { employeeId: e.id, employeeName: e.name, kind: selectedKind, reason: reason };

      if (selectedKind === "ponto_novo") {
        var type = box.querySelector("#adj-type").value;
        var date = box.querySelector("#adj-date").value;
        var time = box.querySelector("#adj-time").value;
        if (!date || !time) { Toast.show("Preencha data e horário", "danger"); return; }
        payload.type = type; payload.typeLabel = PontoCalc.PUNCH_LABELS[type]; payload.date = date; payload.requestedTime = time;
      } else if (selectedKind === "ponto_corrigir") {
        var targetId = box.querySelector("#adj-target").value;
        var target = DB.get("timeClockEntries", targetId);
        var newTime = box.querySelector("#adj-target-time").value;
        if (!target || !newTime) { Toast.show("Escolha o registro e o novo horário", "danger"); return; }
        payload.targetEntryId = target.id; payload.type = target.type; payload.typeLabel = PontoCalc.PUNCH_LABELS[target.type];
        payload.date = target.date; payload.requestedTime = newTime;
      } else {
        var occDate = box.querySelector("#adj-date").value;
        if (!occDate) { Toast.show("Preencha a data", "danger"); return; }
        payload.date = occDate;
        var endEl = box.querySelector("#adj-end-date");
        if (endEl && endEl.value && endEl.value > occDate) payload.endDate = endEl.value;
        if (attachmentCtl && attachmentCtl.get()) payload.attachment = attachmentCtl.get();
      }

      if (!window.PontoAjustes) { Toast.show("Não foi possível enviar a solicitação agora — tente de novo.", "danger"); return; }
      PontoAjustes.request(payload);
      Modal.close();
      showAdjustDone(e);
    });
  }

  function showAdjustDone(e) {
    showOnly("ponto-done");
    document.getElementById("ponto-done-body").innerHTML =
      '<div class="empty-state">' +
        '<div class="es-icon" style="color:var(--color-success);"><i class="fa-solid fa-circle-check"></i></div>' +
        '<h4>Solicitação enviada, ' + Utils.escapeHtml(e.name.split(" ")[0]) + '!</h4>' +
        '<p class="small text-muted">Um administrador vai revisar e aprovar seu pedido.</p>' +
      '</div>';
    Toast.show("Solicitação enviada", "success");
    setTimeout(renderPicker, 4000);
  }
})();
