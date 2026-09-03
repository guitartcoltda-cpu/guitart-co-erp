/* ============================================================
   Salão ERP — Ajustes de Ponto
   Lógica compartilhada para solicitar e aplicar um ajuste de ponto:
   registrar uma batida que faltou (funcionário esqueceu de bater) ou
   corrigir o horário de um registro já existente. O funcionário pede
   pela tela de Ponto (ponto.js); quem pode aprovar (Administrador, ou
   usuário com a permissão "Pode aprovar solicitações") decide pela
   Gestão de Ponto ou pela Central de Aprovações — as duas usam o
   fluxo genérico de solicitação/aprovação de assets/js/approvals.js,
   com o tipo "ajuste_ponto". Ver approvals.js para o fluxo genérico.
   ============================================================ */
(function (global) {
  "use strict";

  var TYPE = "ajuste_ponto";

  // Mesma forma de montar o timestamp usada pelo lançamento manual e pelo
  // "bater ponto" normal: interpreta data+hora no fuso do navegador.
  function buildTimestamp(date, time) {
    return new Date(date + "T" + (time || "00:00") + ":00").toISOString();
  }

  // payload esperado: { employeeId, employeeName, date, type, typeLabel,
  // requestedTime, targetEntryId (opcional, para corrigir um registro que
  // já existe em vez de criar um novo), reason }
  function summarize(payload) {
    var quando = (global.Utils ? Utils.fmtDate(payload.date) : payload.date) + " às " + payload.requestedTime;
    return (payload.targetEntryId ? "Corrigir horário — " : "Registro que faltou — ") +
      payload.employeeName + ": " + payload.typeLabel + " em " + quando;
  }

  function request(payload) {
    if (!global.Approvals) return null;
    return Approvals.request(TYPE, summarize(payload), payload);
  }

  // Roda só quando a solicitação é aprovada (via Approvals.approve(id, apply)).
  function apply(payload) {
    if (!payload) return;
    if (payload.targetEntryId) {
      var entry = DB.get("timeClockEntries", payload.targetEntryId);
      if (!entry) return;
      DB.update("timeClockEntries", entry.id, {
        timestamp: buildTimestamp(entry.date, payload.requestedTime),
        reviewed: true,
        origin: "ajuste_aprovado",
        note: (entry.note ? entry.note + " | " : "") + "Horário corrigido a pedido do funcionário: " + (payload.reason || "-")
      });
    } else {
      DB.insert("timeClockEntries", {
        employeeId: payload.employeeId,
        employeeName: payload.employeeName,
        date: payload.date,
        type: payload.type,
        timestamp: buildTimestamp(payload.date, payload.requestedTime),
        selfieDataUrl: null,
        reviewed: true,
        origin: "ajuste_aprovado",
        note: "Ajuste solicitado pelo funcionário: " + (payload.reason || "-")
      });
    }
  }

  global.PontoAjustes = {
    TYPE: TYPE,
    buildTimestamp: buildTimestamp,
    summarize: summarize,
    request: request,
    apply: apply
  };
})(window);
