/* ============================================================
   Salão ERP — Ajustes e Ocorrências de Ponto
   Lógica compartilhada para o funcionário pedir (pela tela de Ponto,
   ponto.js) e para quem aprova decidir (Gestão de Ponto ou Central de
   Aprovações) sobre:
   - Uma batida que faltou (esqueceu de bater) ou o horário errado de uma
     batida já feita — kind "ponto_novo" / "ponto_corrigir".
   - Uma ocorrência do dia que não é uma batida de ponto: falta
     justificada, atestado médico (com anexo), folga/abono ou outra
     situação — kind = uma chave de PontoCalc.OCCURRENCE_KINDS.

   As duas categorias usam o mesmo fluxo genérico de solicitação/aprovação
   de assets/js/approvals.js, com o tipo "ajuste_ponto" — só o `payload`
   muda de formato conforme o `kind`. Ver approvals.js para o fluxo
   genérico, e ponto-calc.js para os tipos/rótulos compartilhados.
   ============================================================ */
(function (global) {
  "use strict";

  var TYPE = "ajuste_ponto";

  // Mesma forma de montar o timestamp usada pelo lançamento manual e pelo
  // "bater ponto" normal: interpreta data+hora no fuso do navegador.
  function buildTimestamp(date, time) {
    return new Date(date + "T" + (time || "00:00") + ":00").toISOString();
  }

  function isoAddDays(dateStr, days) {
    var d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function punchLabel(type) {
    return (global.PontoCalc && PontoCalc.PUNCH_LABELS[type]) || type;
  }
  function occurrenceLabel(kind) {
    return (global.PontoCalc && PontoCalc.OCCURRENCE_KINDS[kind] && PontoCalc.OCCURRENCE_KINDS[kind].label) || kind;
  }

  // Solicitações feitas antes deste recurso ganhar os "kinds" de ocorrência
  // não tinham `payload.kind` — só `payload.type`/`targetEntryId`. Isso
  // deduz o kind equivalente para qualquer solicitação antiga que ainda
  // esteja pendente de aprovação no momento desta atualização.
  function effectiveKind(payload) {
    if (payload.kind) return payload.kind;
    return payload.targetEntryId ? "ponto_corrigir" : "ponto_novo";
  }

  function summarize(payload) {
    var kind = effectiveKind(payload);
    if (kind === "ponto_novo" || kind === "ponto_corrigir") {
      var quando = (global.Utils ? Utils.fmtDate(payload.date) : payload.date) + " às " + payload.requestedTime;
      return (kind === "ponto_corrigir" ? "Corrigir horário — " : "Registro que faltou — ") +
        payload.employeeName + ": " + (payload.typeLabel || punchLabel(payload.type)) + " em " + quando;
    }
    var quandoDia = global.Utils ? Utils.fmtDate(payload.date) : payload.date;
    if (payload.endDate && payload.endDate > payload.date) {
      quandoDia += " a " + (global.Utils ? Utils.fmtDate(payload.endDate) : payload.endDate);
    }
    return occurrenceLabel(kind) + " — " + payload.employeeName + " em " + quandoDia;
  }

  function request(payload) {
    if (!global.Approvals) return null;
    return Approvals.request(TYPE, summarize(payload), payload);
  }

  // Roda só quando a solicitação é aprovada (via Approvals.approve(id, apply)).
  function apply(payload) {
    if (!payload) return;
    var kind = effectiveKind(payload);

    if (kind === "ponto_corrigir") {
      var entry = DB.get("timeClockEntries", payload.targetEntryId);
      if (!entry) return;
      DB.update("timeClockEntries", entry.id, {
        timestamp: buildTimestamp(entry.date, payload.requestedTime),
        reviewed: true,
        origin: "ajuste_aprovado",
        note: (entry.note ? entry.note + " | " : "") + "Horário corrigido a pedido do funcionário: " + (payload.reason || "-")
      });
      return;
    }

    if (kind === "ponto_novo") {
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
      return;
    }

    // Ocorrência (falta justificada, atestado, folga/abono, outro): não é
    // uma batida, só um registro do dia — sem selfie, sem "tipo" de passo.
    // Atestado e folga/abono podem cobrir um período (payload.endDate): cria
    // um registro por dia do período (limitado a 60 dias, rede de segurança
    // contra uma data final digitada errada por engano).
    var dates = [payload.date];
    if (payload.endDate && payload.endDate > payload.date) {
      dates = [];
      var cursor = payload.date;
      var guard = 0;
      while (cursor <= payload.endDate && guard < 60) {
        dates.push(cursor);
        cursor = isoAddDays(cursor, 1);
        guard++;
      }
    }
    DB.batch(function () {
      dates.forEach(function (d) {
        DB.insert("timeClockEntries", {
          employeeId: payload.employeeId,
          employeeName: payload.employeeName,
          date: d,
          type: kind,
          timestamp: buildTimestamp(d, "00:00"),
          selfieDataUrl: null,
          reviewed: true,
          origin: "ajuste_aprovado",
          note: payload.reason || null,
          attachment: payload.attachment || null
        });
      });
    });
  }

  global.PontoAjustes = {
    TYPE: TYPE,
    buildTimestamp: buildTimestamp,
    effectiveKind: effectiveKind,
    summarize: summarize,
    request: request,
    apply: apply
  };
})(window);
