/* ============================================================
   Salão ERP — Ponto (bater ponto)
   Tela tipo "quiosque": qualquer pessoa logada no sistema abre esta tela
   num aparelho compartilhado (tablet/celular na recepção, por exemplo),
   escolhe o próprio nome na lista de quem está marcado para bater ponto
   (Funcionários → editar → "Bate ponto pelo sistema?"), confere o que vai
   ser registrado (entrada, saída para almoço, volta do almoço ou saída —
   nessa ordem, calculado sozinho a partir do que já foi batido hoje) e
   tira uma selfie para confirmar. A selfie é a forma de auditoria: quem
   revisa depois (tela Gestão de Ponto) confere se bate com a pessoa.
   ============================================================ */
(function () {
  "use strict";

  // Ordem fixa dos 4 registros do dia.
  var STEPS = [
    { type: "entrada", label: "Entrada", icon: "fa-right-to-bracket" },
    { type: "saida_almoco", label: "Saída para Almoço", icon: "fa-utensils" },
    { type: "volta_almoco", label: "Volta do Almoço", icon: "fa-mug-saucer" },
    { type: "saida", label: "Saída (Fim do Expediente)", icon: "fa-right-from-bracket" }
  ];

  var selectedEmployee = null;
  var selectedStep = null;

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
    ["ponto-picker", "ponto-confirm", "ponto-adjust", "ponto-done"].forEach(function (elId) {
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
      return '<div class="ponto-emp-card">' +
        '<button type="button" class="ponto-emp-card-inner" data-emp="' + e.id + '">' +
          Utils.avatarHtml(e.name, e.photoDataUrl, "avatar-lg") +
          '<div class="font-bold mt-8">' + Utils.escapeHtml(e.name) + '</div>' +
          badge +
        '</button>' +
        '<button type="button" class="ponto-emp-adjust-link" data-emp-adjust="' + e.id + '">Esqueceu de bater ou horário errado? Solicitar ajuste</button>' +
        '</div>';
    }).join("");
    Utils.qsa("[data-emp]", grid).forEach(function (btn) {
      btn.addEventListener("click", function () { openConfirm(btn.getAttribute("data-emp")); });
    });
    Utils.qsa("[data-emp-adjust]", grid).forEach(function (btn) {
      btn.addEventListener("click", function () { openAdjustForm(btn.getAttribute("data-emp-adjust")); });
    });
  }

  function openConfirm(employeeId) {
    var e = DB.get("employees", employeeId);
    if (!e) return;
    var next = nextStepFor(employeeId);
    selectedEmployee = e;
    selectedStep = next;
    showOnly("ponto-confirm");
    var body = document.getElementById("ponto-confirm-body");

    if (!next) {
      body.innerHTML =
        '<div class="flex items-center gap-16 mb-16">' + Utils.avatarHtml(e.name, e.photoDataUrl, "avatar-lg") +
        '<div><div class="font-bold">' + Utils.escapeHtml(e.name) + '</div><div class="small" style="color:var(--color-success);">Os 4 registros de hoje já foram feitos.</div></div></div>' +
        '<button class="btn btn-secondary" id="ponto-back">Voltar</button>';
      document.getElementById("ponto-back").addEventListener("click", renderPicker);
      return;
    }

    var now = new Date();
    body.innerHTML =
      '<div class="flex items-center gap-16 mb-16">' + Utils.avatarHtml(e.name, e.photoDataUrl, "avatar-lg") +
        '<div><div class="font-bold">' + Utils.escapeHtml(e.name) + '</div>' +
        '<div>Registrar: <strong>' + Utils.escapeHtml(next.label) + '</strong></div>' +
        '<div class="small text-muted">Agora — ' + now.toLocaleDateString("pt-BR") + ' ' + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + '</div></div>' +
      '</div>' +
      '<div class="small text-muted mb-16">Para confirmar, tire uma selfie — é o jeito de garantir que foi você mesmo quem bateu o ponto.</div>' +
      '<div class="flex gap-8">' +
        '<label class="btn btn-primary" style="cursor:pointer;"><i class="fa-solid fa-camera"></i> Tirar Selfie e Registrar' +
          '<input type="file" id="ponto-selfie-input" accept="image/*" capture="user" style="display:none;"></label>' +
        '<button class="btn btn-secondary" id="ponto-back">Cancelar</button>' +
      '</div>' +
      '<div id="ponto-saving" class="small text-muted mt-8" style="display:none;">Salvando...</div>';

    document.getElementById("ponto-back").addEventListener("click", renderPicker);
    document.getElementById("ponto-selfie-input").addEventListener("change", function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      document.getElementById("ponto-saving").style.display = "";
      Utils.fileToAvatarDataUrl(file, 240, function (dataUrl) {
        if (!dataUrl) { Toast.show("Não foi possível carregar a selfie — tente de novo", "danger"); document.getElementById("ponto-saving").style.display = "none"; return; }
        saveEntry(e, next, dataUrl);
      });
    });
  }

  function saveEntry(e, step, selfieDataUrl) {
    // Rechecagem de última hora: se essa pessoa bateu esse mesmo passo em
    // outra aba/aparelho nos segundos entre abrir a confirmação e tirar a
    // selfie, não deixa duplicar.
    var current = nextStepFor(e.id);
    if (!current || current.type !== step.type) {
      Toast.show("Esse registro já foi feito — a lista foi atualizada.", "danger");
      renderPicker();
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

  // ---------------- Solicitar ajuste (registro que faltou ou horário errado) ----------------
  function stepLabel(type) {
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].type === type) return STEPS[i].label;
    return type;
  }

  function employeeRecentEntries(employeeId) {
    return DB.all("timeClockEntries").filter(function (t) { return t.employeeId === employeeId; })
      .sort(function (a, b) { return (b.timestamp || "").localeCompare(a.timestamp || ""); })
      .slice(0, 20);
  }

  function openAdjustForm(employeeId) {
    var e = DB.get("employees", employeeId);
    if (!e) return;
    showOnly("ponto-adjust");
    var recent = employeeRecentEntries(employeeId);
    var body = document.getElementById("ponto-adjust-body");
    body.innerHTML =
      '<div class="flex items-center gap-16 mb-16">' + Utils.avatarHtml(e.name, e.photoDataUrl, "avatar-lg") +
        '<div><div class="font-bold">' + Utils.escapeHtml(e.name) + '</div><div class="small text-muted">A solicitação vai para aprovação de um administrador antes de valer.</div></div>' +
      '</div>' +
      '<div class="form-field full"><label>O que você precisa?</label><select id="adj-kind">' +
        '<option value="novo">Registrar um horário que esqueci de bater</option>' +
        (recent.length ? '<option value="corrigir">Corrigir o horário de um registro já feito</option>' : '') +
      '</select></div>' +
      '<div id="adj-fields-novo">' +
        '<div class="form-field full"><label>Tipo</label><select id="adj-type">' +
          STEPS.map(function (s) { return '<option value="' + s.type + '">' + s.label + '</option>'; }).join("") +
        '</select></div>' +
        '<div class="flex gap-16">' +
          '<div class="form-field"><label>Data</label><input type="date" id="adj-date" value="' + Utils.todayISO() + '" max="' + Utils.todayISO() + '"></div>' +
          '<div class="form-field"><label>Horário</label><input type="time" id="adj-time"></div>' +
        '</div>' +
      '</div>' +
      '<div id="adj-fields-corrigir" style="display:none;">' +
        '<div class="form-field full"><label>Qual registro?</label><select id="adj-target">' +
          recent.map(function (t) {
            var d = new Date(t.timestamp);
            var hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
            return '<option value="' + t.id + '">' + Utils.fmtDate(t.date) + ' — ' + stepLabel(t.type) + ' — ' + hh + '</option>';
          }).join("") +
        '</select></div>' +
        '<div class="form-field"><label>Horário correto</label><input type="time" id="adj-target-time"></div>' +
      '</div>' +
      '<div class="form-field full"><label>Motivo</label><textarea id="adj-reason" rows="2" placeholder="Explique rapidamente o que aconteceu"></textarea></div>' +
      '<div class="flex gap-8 mt-8">' +
        '<button class="btn btn-primary" id="adj-send">Enviar Solicitação</button>' +
        '<button class="btn btn-secondary" id="adj-back">Cancelar</button>' +
      '</div>';

    document.getElementById("adj-back").addEventListener("click", renderPicker);
    var kindSel = document.getElementById("adj-kind");
    kindSel.addEventListener("change", function () {
      var isNovo = kindSel.value === "novo";
      document.getElementById("adj-fields-novo").style.display = isNovo ? "" : "none";
      document.getElementById("adj-fields-corrigir").style.display = isNovo ? "none" : "";
    });

    document.getElementById("adj-send").addEventListener("click", function () {
      var reason = document.getElementById("adj-reason").value.trim();
      if (!reason) { Toast.show("Descreva o motivo da solicitação", "danger"); return; }
      var payload;
      if (kindSel.value === "novo") {
        var type = document.getElementById("adj-type").value;
        var date = document.getElementById("adj-date").value;
        var time = document.getElementById("adj-time").value;
        if (!date || !time) { Toast.show("Preencha data e horário", "danger"); return; }
        payload = { employeeId: e.id, employeeName: e.name, date: date, type: type, typeLabel: stepLabel(type), requestedTime: time, reason: reason };
      } else {
        var targetId = document.getElementById("adj-target").value;
        var target = DB.get("timeClockEntries", targetId);
        var newTime = document.getElementById("adj-target-time").value;
        if (!target || !newTime) { Toast.show("Escolha o registro e o novo horário", "danger"); return; }
        payload = { employeeId: e.id, employeeName: e.name, date: target.date, type: target.type, typeLabel: stepLabel(target.type), requestedTime: newTime, targetEntryId: target.id, reason: reason };
      }
      if (!window.PontoAjustes) { Toast.show("Não foi possível enviar a solicitação agora — tente de novo.", "danger"); return; }
      PontoAjustes.request(payload);
      showAdjustDone(e);
    });
  }

  function showAdjustDone(e) {
    showOnly("ponto-done");
    document.getElementById("ponto-done-body").innerHTML =
      '<div class="empty-state">' +
        '<div class="es-icon" style="color:var(--color-success);"><i class="fa-solid fa-circle-check"></i></div>' +
        '<h4>Solicitação enviada, ' + Utils.escapeHtml(e.name.split(" ")[0]) + '!</h4>' +
        '<p class="small text-muted">Um administrador vai revisar e aprovar seu pedido de ajuste de ponto.</p>' +
      '</div>';
    Toast.show("Solicitação de ajuste enviada", "success");
    setTimeout(renderPicker, 4000);
  }
})();
