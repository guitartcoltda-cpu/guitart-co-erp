/* ============================================================
   Salão ERP — Chamados (melhorias, bugs, novos desenvolvimentos)
   Qualquer usuário abre um chamado; usuários com perfil
   Desenvolvedor ou Administrador analisam, escrevem uma devolutiva
   e mudam o status. Os gráficos "Maiores Demandas" ajudam a decidir
   onde focar o próximo ciclo de trabalho (tipo e área do sistema
   com mais chamados registrados). Tabela `chamados`, ver db.js.
   ============================================================ */
(function () {
  "use strict";

  var TYPE_LABELS = { melhoria: "Melhoria", bug: "Bug", desenvolvimento: "Novo Desenvolvimento", outro: "Outro" };
  var TYPE_BADGE = { melhoria: "badge-info", bug: "badge-danger", desenvolvimento: "badge-success", outro: "badge-gray" };
  var STATUS_LABELS = { aberto: "Aberto", em_analise: "Em Análise", em_desenvolvimento: "Em Desenvolvimento", concluido: "Concluído", recusado: "Recusado" };
  var STATUS_BADGE = { aberto: "badge-warning", em_analise: "badge-info", em_desenvolvimento: "badge-info", concluido: "badge-success", recusado: "badge-gray" };
  var PRIORITY_LABELS = { baixa: "Baixa", media: "Média", alta: "Alta" };
  var STATUS_ORDER = ["aberto", "em_analise", "em_desenvolvimento", "concluido", "recusado"];

  var filt = { status: "", type: "", area: "", search: "", mine: false };

  document.addEventListener("DOMContentLoaded", function () { DB.ready.then(function () { setTimeout(init, 0); }); });

  function isDevOrAdmin() {
    var u = CurrentUser.get();
    return !!(u && (u.role === "Desenvolvedor" || u.role === "Administrador"));
  }

  function areaOptions() {
    // Reaproveita os rótulos das telas já cadastradas em AppLayout.NAV, para
    // a lista de áreas ficar sempre alinhada com as telas reais do sistema.
    return (window.AppLayout ? AppLayout.NAV : []).filter(function (item) { return !item.section; }).map(function (item) { return item.label; });
  }

  function init() {
    var statusSel = Utils.qs("#ch-status");
    STATUS_ORDER.forEach(function (s) { var o = document.createElement("option"); o.value = s; o.textContent = STATUS_LABELS[s]; statusSel.appendChild(o); });
    statusSel.addEventListener("change", function (e) { filt.status = e.target.value; render(); });

    var typeSel = Utils.qs("#ch-type");
    Object.keys(TYPE_LABELS).forEach(function (t) { var o = document.createElement("option"); o.value = t; o.textContent = TYPE_LABELS[t]; typeSel.appendChild(o); });
    typeSel.addEventListener("change", function (e) { filt.type = e.target.value; render(); });

    var areaSel = Utils.qs("#ch-area");
    areaOptions().forEach(function (a) { var o = document.createElement("option"); o.value = a; o.textContent = a; areaSel.appendChild(o); });
    areaSel.addEventListener("change", function (e) { filt.area = e.target.value; render(); });

    Utils.qs("#ch-search").addEventListener("input", Utils.debounce(function (e) { filt.search = e.target.value.toLowerCase(); render(); }, 200));
    Utils.qs("#ch-mine").addEventListener("change", function (e) { filt.mine = e.target.checked; render(); });
    Utils.qs("#btn-new-chamado").addEventListener("click", function () { openChamadoModal(); });

    render();
  }

  function getChamados() {
    var cu = CurrentUser.get();
    return DB.all("chamados").filter(function (c) {
      if (filt.status && c.status !== filt.status) return false;
      if (filt.type && c.type !== filt.type) return false;
      if (filt.area && c.area !== filt.area) return false;
      if (filt.mine && (!cu || c.createdBy !== cu.id)) return false;
      if (filt.search) {
        var hay = (c.title + " " + c.description).toLowerCase();
        if (hay.indexOf(filt.search) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return (b.createdAt || "").localeCompare(a.createdAt || ""); });
  }

  function render() {
    var all = DB.all("chamados");
    var abertos = all.filter(function (c) { return c.status === "aberto"; });
    var andamento = all.filter(function (c) { return c.status === "em_analise" || c.status === "em_desenvolvimento"; });
    var concluidos = all.filter(function (c) { return c.status === "concluido"; });
    var recusados = all.filter(function (c) { return c.status === "recusado"; });

    Utils.qs("#cham-summary").innerHTML = [
      kpi("Total de Chamados", String(all.length), "fa-headset", "#4a3aa7", "#ece8f8"),
      kpi("Aguardando Análise", String(abertos.length), "fa-inbox", "#b7791f", "#fdf2df"),
      kpi("Em Andamento", String(andamento.length), "fa-screwdriver-wrench", "#2a78d6", "#e3eefb"),
      kpi("Concluídos", String(concluidos.length), "fa-circle-check", "#1baf7a", "#e2f5ec"),
      kpi("Recusados", String(recusados.length), "fa-circle-xmark", "#8a8a8a", "#efefef")
    ].join("");

    // Maiores demandas — só considera chamados ainda em aberto (aguardando
    // análise ou em andamento), que é o que efetivamente sinaliza onde focar
    // o próximo ciclo de trabalho; concluídos/recusados já foram tratados.
    var openOnes = all.filter(function (c) { return c.status === "aberto" || c.status === "em_analise" || c.status === "em_desenvolvimento"; });
    var byType = {};
    openOnes.forEach(function (c) { byType[c.type] = (byType[c.type] || 0) + 1; });
    Charts.rankingList({
      container: document.getElementById("chart-cham-type"),
      items: Object.keys(byType).map(function (t) { return { label: TYPE_LABELS[t] || t, value: byType[t] }; }).sort(function (a, b) { return b.value - a.value; }),
      maxItems: 10,
      emptyMessage: "Nenhum chamado em aberto no momento"
    });
    var byArea = {};
    openOnes.forEach(function (c) { var a = c.area || "Sem área definida"; byArea[a] = (byArea[a] || 0) + 1; });
    Charts.rankingList({
      container: document.getElementById("chart-cham-area"),
      items: Object.keys(byArea).map(function (a) { return { label: a, value: byArea[a] }; }).sort(function (a, b) { return b.value - a.value; }),
      maxItems: 10,
      emptyMessage: "Nenhum chamado em aberto no momento"
    });

    var chamados = getChamados();
    Utils.qs("#ch-count-sub").textContent = chamados.length + " chamado(s)";
    var tbl = document.getElementById("tbl-chamados");
    if (!chamados.length) {
      Utils.emptyTable(tbl, "fa-headset", "Nenhum chamado encontrado");
      return;
    }
    tbl.innerHTML = '<thead><tr><th>Data</th><th>Título</th><th>Tipo</th><th>Área</th><th>Prioridade</th><th>Status</th><th>Aberto por</th><th></th></tr></thead><tbody>' +
      chamados.map(function (c) {
        return '<tr>' +
          '<td class="text-num">' + Utils.fmtDate((c.createdAt || "").slice(0, 10)) + '</td>' +
          '<td class="font-bold">' + Utils.escapeHtml(c.title) + '</td>' +
          '<td><span class="badge ' + (TYPE_BADGE[c.type] || "badge-gray") + '">' + (TYPE_LABELS[c.type] || c.type) + '</span></td>' +
          '<td class="small">' + Utils.escapeHtml(c.area || "-") + '</td>' +
          '<td class="small">' + (PRIORITY_LABELS[c.priority] || "-") + '</td>' +
          '<td><span class="badge ' + (STATUS_BADGE[c.status] || "badge-gray") + '">' + (STATUS_LABELS[c.status] || c.status) + '</span></td>' +
          '<td class="small">' + Utils.escapeHtml(c.createdByName || "-") + '</td>' +
          '<td><button class="btn btn-sm btn-outline" data-open="' + c.id + '">Ver</button></td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.qsa("[data-open]", tbl).forEach(function (b) { b.addEventListener("click", function () { openChamadoDetail(b.getAttribute("data-open")); }); });
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }

  function openChamadoModal() {
    var body = '<div class="form-grid">' +
      '<div class="form-field full"><label>Título</label><input type="text" id="cn-title" placeholder="Resuma em uma linha"></div>' +
      '<div class="form-field"><label>Tipo</label><select id="cn-type">' +
        Object.keys(TYPE_LABELS).map(function (t) { return '<option value="' + t + '">' + TYPE_LABELS[t] + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="form-field"><label>Prioridade</label><select id="cn-priority">' +
        '<option value="baixa">Baixa</option><option value="media" selected>Média</option><option value="alta">Alta</option>' +
      '</select></div>' +
      '<div class="form-field full"><label>Área do sistema (opcional)</label><select id="cn-area"><option value="">Não se aplica / geral</option>' +
        areaOptions().map(function (a) { return '<option value="' + Utils.escapeHtml(a) + '">' + Utils.escapeHtml(a) + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="form-field full"><label>Descrição</label><textarea id="cn-desc" rows="5" placeholder="Descreva o que aconteceu, o que esperava ver, ou a ideia de melhoria..."></textarea></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="cn-save">Abrir Chamado</button>';
    var box = Modal.open({ title: "Novo Chamado", wide: true, bodyHtml: body, footHtml: foot });
    box.querySelector("#cn-save").addEventListener("click", function () {
      var title = box.querySelector("#cn-title").value.trim();
      if (!title) { Toast.show("Informe um título para o chamado", "danger"); return; }
      var desc = box.querySelector("#cn-desc").value.trim();
      if (!desc) { Toast.show("Descreva o chamado", "danger"); return; }
      var cu = CurrentUser.get();
      DB.insert("chamados", {
        title: title, description: desc, type: box.querySelector("#cn-type").value,
        priority: box.querySelector("#cn-priority").value, area: box.querySelector("#cn-area").value || null,
        status: "aberto", createdBy: cu ? cu.id : null, createdByName: cu ? (cu.firstName + " " + cu.lastName) : "Usuário"
      });
      DB.log("Chamados", "Abriu o chamado \"" + title + "\"");
      Toast.show("Chamado aberto", "success");
      Modal.close();
      render();
    });
  }

  function openChamadoDetail(id) {
    var c = DB.get("chamados", id);
    if (!c) return;
    var canManage = isDevOrAdmin();

    var infoHtml = '<table class="kv-table">' +
      '<tr><td>Título</td><td>' + Utils.escapeHtml(c.title) + '</td></tr>' +
      '<tr><td>Tipo</td><td><span class="badge ' + (TYPE_BADGE[c.type] || "badge-gray") + '">' + (TYPE_LABELS[c.type] || c.type) + '</span></td></tr>' +
      '<tr><td>Área</td><td>' + Utils.escapeHtml(c.area || "Não se aplica / geral") + '</td></tr>' +
      '<tr><td>Prioridade</td><td>' + (PRIORITY_LABELS[c.priority] || "-") + '</td></tr>' +
      '<tr><td>Aberto por</td><td>' + Utils.escapeHtml(c.createdByName || "-") + ' em ' + Utils.fmtDateTime(c.createdAt) + '</td></tr>' +
      '<tr><td>Descrição</td><td style="white-space:pre-wrap;">' + Utils.escapeHtml(c.description) + '</td></tr>' +
      '</table>';

    var responseHtml;
    if (canManage) {
      responseHtml = '<div class="divider" style="margin:16px 0;"></div>' +
        '<label class="font-bold small" style="display:block;margin-bottom:8px;">Devolutiva (visível para quem abriu o chamado)</label>' +
        '<div class="form-grid">' +
        '<div class="form-field"><label>Status</label><select id="cd-status">' +
          STATUS_ORDER.map(function (s) { return '<option value="' + s + '"' + (c.status === s ? " selected" : "") + '>' + STATUS_LABELS[s] + '</option>'; }).join("") +
        '</select></div>' +
        '</div>' +
        '<div class="form-field full"><textarea id="cd-response" rows="4" placeholder="Explique o que foi analisado, feito ou o motivo da recusa...">' + Utils.escapeHtml(c.devolutiva || "") + '</textarea></div>' +
        (c.respondedByName ? '<div class="small text-muted mt-8">Última resposta de ' + Utils.escapeHtml(c.respondedByName) + ' em ' + Utils.fmtDateTime(c.respondedAt) + '</div>' : "");
    } else {
      responseHtml = '<div class="divider" style="margin:16px 0;"></div>' +
        '<label class="font-bold small" style="display:block;margin-bottom:8px;">Retorno do time de desenvolvimento</label>' +
        (c.devolutiva
          ? '<p style="white-space:pre-wrap;">' + Utils.escapeHtml(c.devolutiva) + '</p><div class="small text-muted">' + Utils.escapeHtml(c.respondedByName || "") + ' em ' + Utils.fmtDateTime(c.respondedAt) + '</div>'
          : '<p class="small text-muted">Ainda sem retorno — status atual: <span class="badge ' + (STATUS_BADGE[c.status] || "badge-gray") + '">' + (STATUS_LABELS[c.status] || c.status) + '</span></p>');
    }

    var foot = '<button class="btn btn-secondary" data-close-modal>Fechar</button>' + (canManage ? '<button class="btn btn-primary" id="cd-save">Salvar Resposta</button>' : "");
    var box = Modal.open({ title: "Chamado", wide: true, bodyHtml: infoHtml + responseHtml, footHtml: foot });

    if (canManage) {
      box.querySelector("#cd-save").addEventListener("click", function () {
        var cu = CurrentUser.get();
        var newStatus = box.querySelector("#cd-status").value;
        var response = box.querySelector("#cd-response").value.trim();
        DB.update("chamados", c.id, {
          status: newStatus, devolutiva: response,
          respondedBy: cu ? cu.id : null, respondedByName: cu ? (cu.firstName + " " + cu.lastName) : "Desenvolvedor",
          respondedAt: DB.nowISO()
        });
        DB.log("Chamados", "Respondeu o chamado \"" + c.title + "\" — status: " + STATUS_LABELS[newStatus]);
        Toast.show("Resposta salva", "success");
        Modal.close();
        render();
      });
    }
  }
})();
