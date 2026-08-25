/* ============================================================
   Salão ERP — Recorrência de clientes (compartilhado)
   Estima, por cliente + serviço, o intervalo médio entre
   atendimentos concluídos e a data prevista do próximo retorno.
   Usado pela Central de Alertas ("Clientes com Recorrência
   Esperada") e por Notificações WhatsApp (regra de cliente
   ausente — ver notificacoes.js). Manter os dois em sincronia era
   o motivo de extrair essa lógica pra cá em vez de duplicá-la.
   ============================================================ */
(function (global) {
  "use strict";

  // Calcula, para cada combinação cliente+serviço com pelo menos
  // `minOccurrences` atendimentos concluídos, o intervalo médio entre eles
  // e a data prevista do próximo retorno (última visita + intervalo médio).
  // Não filtra por "está próximo" — cada chamador decide sua própria janela
  // (Central de Alertas mostra só os próximos/vencidos; Notificações dispara
  // quando já passou da data prevista). Retorna todas as linhas com
  // `daysUntil` (negativo = já venceu) e `hasFutureSame` (já tem novo
  // agendamento do mesmo serviço marcado — nesse caso não faz sentido
  // alertar/notificar de novo).
  function compute(appointments, todayISO, minOccurrences) {
    minOccurrences = minOccurrences || 3;
    var groups = {}; // "clientId|serviceId" -> [appt,...]
    appointments.forEach(function (a) {
      if (a.status !== "concluido") return;
      var key = a.clientId + "|" + a.serviceId;
      (groups[key] = groups[key] || []).push(a);
    });

    var rows = [];
    Object.keys(groups).forEach(function (key) {
      var list = groups[key];
      if (list.length < minOccurrences) return;
      list.sort(function (a, b) { return a.date.localeCompare(b.date); });

      var gaps = [];
      for (var i = 1; i < list.length; i++) gaps.push(Utils.daysBetween(list[i - 1].date, list[i].date));
      var avgGap = gaps.reduce(function (s, g) { return s + g; }, 0) / gaps.length;
      if (avgGap <= 0) return;

      var last = list[list.length - 1];
      var expectedNext = Utils.addDays(last.date, Math.round(avgGap));
      var daysUntil = Utils.daysBetween(todayISO, expectedNext);

      var hasFutureSame = appointments.some(function (a) {
        return a.clientId === last.clientId && a.serviceId === last.serviceId && a.status === "agendado" && a.date >= todayISO;
      });

      rows.push({
        clientId: last.clientId,
        serviceId: last.serviceId,
        avgGap: Math.round(avgGap),
        lastDate: last.date,
        expectedNext: expectedNext,
        daysSinceLast: Utils.daysBetween(last.date, todayISO),
        daysUntil: daysUntil,
        occurrences: list.length,
        hasFutureSame: hasFutureSame
      });
    });

    return rows;
  }

  global.Recorrencia = { compute: compute };
})(window);
