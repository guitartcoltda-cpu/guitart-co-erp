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
  // `time` aceita "HH:MM" ou "HH:MM:SS" (a gestão pode ajustar até os segundos).
  function buildTimestamp(date, time) {
    var t = String(time || "00:00");
    if (!/^\d{1,2}:\d{2}:\d{2}$/.test(t)) t = t.replace(/^(\d{1,2}:\d{2}).*$/, "$1") + ":00";
    if (/^\d:/.test(t)) t = "0" + t;
    return new Date(date + "T" + t).toISOString();
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
    if (kind === "saida_antecipada") {
      var dia = global.Utils ? Utils.fmtDate(payload.date) : payload.date;
      return "Saída antecipada — " + payload.employeeName + " em " + dia + ": saiu às " + payload.exitTime +
        (payload.earlyMin ? " (" + payload.earlyMin + " min antes do fim da jornada)" : "");
    }
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

    // SAÍDA ANTECIPADA (10/10/2026): aprovar = ABONAR. A batida de saída já
    // existe (foi feita pelo funcionário); só muda o status dela de
    // "pendente" para "abonada", e o cálculo do dia passa a não descontar
    // o tempo que faltou. Usa mergeRecordUpdate para não apagar edições
    // concorrentes na mesma batida.
    if (kind === "saida_antecipada") {
      decideEarlyLeave(payload, "abonada");
      return;
    }

    if (kind === "ponto_corrigir") {
      var entry = DB.get("timeClockEntries", payload.targetEntryId);
      if (!entry) return;
      // BUG CORRIGIDO (18/09/2026, varredura de "múltiplos usuários em
      // tempo real"): "note" era concatenado a partir do valor lido do
      // CACHE LOCAL e gravado com DB.update (upsert do registro inteiro)
      // — se essa mesma marcação de ponto tivesse outra observação salva
      // por outra pessoa (ex.: sinalização em Gestão de Ponto) entre a
      // leitura e a gravação, essa gravação apagava a observação da outra
      // pessoa. "note" agora vai por DB.mergeFieldUpdate (busca o valor
      // mais recente do campo direto do servidor antes de concatenar); os
      // demais campos são valores fixos (não calculados a partir do
      // cache), então continuam num DB.update comum.
      DB.mergeFieldUpdate("timeClockEntries", entry.id, "note", function (currentNote) {
        return (currentNote ? currentNote + " | " : "") + "Horário corrigido a pedido do funcionário: " + (payload.reason || "-");
      });
      DB.update("timeClockEntries", entry.id, {
        timestamp: buildTimestamp(entry.date, payload.requestedTime),
        reviewed: true,
        origin: "ajuste_aprovado"
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

  function decideEarlyLeave(payload, status) {
    if (!payload || !payload.entryId) return;
    var entry = DB.get("timeClockEntries", payload.entryId);
    if (!entry) return; // batida apagada nesse meio-tempo: nada a decidir
    var who = global.CurrentUser && CurrentUser.get ? CurrentUser.get() : null;
    DB.mergeRecordUpdate("timeClockEntries", payload.entryId, function (fresh) {
      var base = (fresh && fresh.earlyLeave) || {};
      return {
        earlyLeave: Object.assign({}, base, {
          status: status,
          decidedAt: DB.nowISO(),
          decidedByName: who ? ([who.firstName, who.lastName].filter(Boolean).join(" ") || who.name || null) : null
        })
      };
    });
  }

  // Roda quando a solicitação é RECUSADA (Approvals.reject chama): a saída
  // antecipada deixa de ser neutra e passa a contar normalmente no banco.
  function onReject(payload) {
    if (!payload) return;
    if (effectiveKind(payload) === "saida_antecipada") decideEarlyLeave(payload, "recusada");
  }

  // Cria a solicitação de aprovação de uma saída antecipada já registrada.
  function requestEarlyLeave(info) {
    return request({
      kind: "saida_antecipada",
      entryId: info.entryId,
      employeeId: info.employeeId,
      employeeName: info.employeeName,
      date: info.date,
      exitTime: info.exitTime,
      earlyMin: info.earlyMin,
      claimedAuthorized: !!info.claimedAuthorized,
      reason: info.reason || ""
    });
  }

  global.PontoAjustes = {
    TYPE: TYPE,
    buildTimestamp: buildTimestamp,
    effectiveKind: effectiveKind,
    summarize: summarize,
    request: request,
    requestEarlyLeave: requestEarlyLeave,
    onReject: onReject,
    apply: apply
  };
})(window);
