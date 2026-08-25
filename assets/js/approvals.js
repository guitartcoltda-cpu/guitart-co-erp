/* ============================================================
   Salão ERP — Aprovações
   Fluxo simples de solicitação/aprovação para ações que exigem
   autorização de um Administrador: alterar a comissão combinada
   de um agendamento, e dar desconto num lançamento de Consumo de
   Insumos. Qualquer usuário pode solicitar; só quem estiver logado
   com o perfil "Administrador" (Configurações → Acessos) pode
   aprovar ou recusar. Tabela `approvals`, ver db.js.
   ============================================================ */
(function (global) {
  "use strict";

  var TYPE_LABELS = {
    comissao_agendamento: "Alteração de comissão",
    desconto_consumo: "Desconto em consumo de insumo"
  };

  function isAdmin() {
    var u = global.CurrentUser && global.CurrentUser.get ? global.CurrentUser.get() : null;
    return !!(u && u.role === "Administrador");
  }

  function currentUserLabel() {
    var u = global.CurrentUser && global.CurrentUser.get ? global.CurrentUser.get() : null;
    return u ? (u.firstName + " " + u.lastName) : "Usuário";
  }

  // Cria uma solicitação pendente. `summary` é o texto amigável mostrado no
  // painel de aprovações; `payload` guarda o que precisa para aplicar a
  // mudança quando aprovada (formato livre, específico de cada `type`).
  function request(type, summary, payload) {
    var u = global.CurrentUser && global.CurrentUser.get ? global.CurrentUser.get() : null;
    var rec = DB.insert("approvals", {
      type: type,
      status: "pendente",
      summary: summary,
      payload: payload || {},
      requestedBy: u ? u.id : null,
      requestedByName: currentUserLabel()
    });
    DB.log("Aprovação", "Solicitou: " + summary);
    return rec;
  }

  function listPending() {
    return DB.find("approvals", function (a) { return a.status === "pendente"; })
      .sort(function (a, b) { return (a.createdAt || "").localeCompare(b.createdAt || ""); });
  }

  function countPending() {
    return listPending().length;
  }

  // `onApply(payload)` roda só quando aprovada, contendo a lógica específica
  // de cada tipo (ex.: atualizar o agendamento, aplicar o desconto). Se
  // `onApply` lançar um erro, a aprovação não é marcada como decidida.
  function approve(id, onApply) {
    var a = DB.get("approvals", id);
    if (!a || a.status !== "pendente") return null;
    if (typeof onApply === "function") onApply(a.payload, a);
    var updated = DB.update("approvals", id, {
      status: "aprovada",
      decidedBy: (global.CurrentUser && global.CurrentUser.get()) ? global.CurrentUser.get().id : null,
      decidedByName: currentUserLabel(),
      decidedAt: DB.nowISO()
    });
    DB.log("Aprovação", "Aprovou: " + a.summary);
    return updated;
  }

  function reject(id, reason) {
    var a = DB.get("approvals", id);
    if (!a || a.status !== "pendente") return null;
    var updated = DB.update("approvals", id, {
      status: "recusada",
      decidedBy: (global.CurrentUser && global.CurrentUser.get()) ? global.CurrentUser.get().id : null,
      decidedByName: currentUserLabel(),
      decidedAt: DB.nowISO(),
      rejectReason: reason || ""
    });
    DB.log("Aprovação", "Recusou: " + a.summary + (reason ? " — Motivo: " + reason : ""));
    return updated;
  }

  // Renderiza (e mantém atualizado) um sininho/badge de aprovações
  // pendentes num container qualquer — usado no topbar e no Dashboard.
  // Só aparece para Administrador; para os demais o container fica vazio.
  function renderBadge(containerEl) {
    if (!containerEl) return;
    if (!isAdmin()) { containerEl.innerHTML = ""; return; }
    var n = countPending();
    if (!n) { containerEl.innerHTML = ""; return; }
    containerEl.innerHTML = '<a href="configuracoes.html?tab=aprovacoes" class="approvals-badge" title="Solicitações pendentes de aprovação">' +
      '<i class="fa-solid fa-user-check"></i> ' + n + ' pendente' + (n > 1 ? "s" : "") + '</a>';
  }

  global.Approvals = {
    TYPE_LABELS: TYPE_LABELS,
    isAdmin: isAdmin,
    request: request,
    listPending: listPending,
    countPending: countPending,
    approve: approve,
    reject: reject,
    renderBadge: renderBadge
  };
})(window);
