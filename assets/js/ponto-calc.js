/* ============================================================
   Salão ERP — Cálculo do "espelho de ponto"
   Módulo compartilhado (usado pela tela do funcionário, ponto.js, e pela
   Gestão de Ponto, ponto-gestao.js) que transforma os registros crus da
   tabela timeClockEntries em um resumo por dia: horário batido, horas
   trabalhadas, horas extras, horas faltantes e saldo (banco de horas) —
   comparando contra a carga horária diária cadastrada do funcionário
   (Funcionários → editar → "Carga Horária Diária"; sem esse campo
   preenchido, assume 8h como padrão).

   timeClockEntries guarda dois tipos de registro, diferenciados pelo
   campo `type`:
   - Batidas de ponto de verdade: entrada / saida_almoco / volta_almoco /
     saida (ver PUNCH_TYPES) — o que a pessoa bate na tela de Ponto.
   - Ocorrências: falta_justificada / atestado / folga_abono / outro (ver
     OCCURRENCE_KINDS) — não são uma batida, só um registro de que aquele
     dia teve uma situação especial (com motivo e, opcionalmente, um
     anexo — atestado médico etc.), pedido pelo funcionário ou lançado
     direto pela Gestão de Ponto, sempre pelo mesmo fluxo de aprovação de
     ajuste de ponto (ver ponto-ajustes.js).

   O espelho só mostra dias que têm pelo menos um registro (batida ou
   ocorrência) — não tenta adivinhar "falta" em dias sem nenhum
   lançamento, já que o sistema não conhece a escala/folga semanal de
   cada funcionário.
   ============================================================ */
(function (global) {
  "use strict";

  var PUNCH_TYPES = ["entrada", "saida_almoco", "volta_almoco", "saida"];
  var PUNCH_LABELS = {
    entrada: "Entrada",
    saida_almoco: "Saída para Almoço",
    volta_almoco: "Volta do Almoço",
    saida: "Saída"
  };

  var OCCURRENCE_KINDS = {
    falta_justificada: { label: "Falta Justificada", icon: "fa-user-slash", badge: "badge-warning" },
    atestado: { label: "Atestado Médico", icon: "fa-file-medical", badge: "badge-info" },
    folga_abono: { label: "Folga / Abono", icon: "fa-umbrella-beach", badge: "badge-gray" },
    outro: { label: "Outra Ocorrência", icon: "fa-circle-info", badge: "badge-gray" }
  };

  function isPunchType(type) { return PUNCH_TYPES.indexOf(type) !== -1; }
  function isOccurrenceType(type) { return !!OCCURRENCE_KINDS[type]; }

  function dailyExpectedMin(employee) {
    var h = employee && Number(employee.dailyWorkHours);
    if (!h || h <= 0) h = 8;
    return h * 60;
  }

  // Formata minutos como "7h30" (ou "-1h15" para saldo negativo).
  function fmtHM(min) {
    var n = Math.round(Number(min) || 0);
    var neg = n < 0;
    var abs = Math.abs(n);
    var h = Math.floor(abs / 60), m = abs % 60;
    return (neg ? "-" : "") + h + "h" + String(m).padStart(2, "0");
  }

  function entriesByDate(entries) {
    var map = {};
    entries.forEach(function (t) {
      if (!map[t.date]) map[t.date] = [];
      map[t.date].push(t);
    });
    return map;
  }

  // Resumo de um único dia a partir dos registros (já filtrados) daquele dia.
  function computeDay(date, dayEntries, employee) {
    var occurrence = dayEntries.find(function (t) { return isOccurrenceType(t.type); }) || null;
    var expectedMin = dailyExpectedMin(employee);
    var punches = {};
    dayEntries.filter(function (t) { return isPunchType(t.type); }).forEach(function (t) {
      if (!punches[t.type]) punches[t.type] = t;
    });

    var result = {
      date: date,
      entrada: punches.entrada || null,
      saidaAlmoco: punches.saida_almoco || null,
      voltaAlmoco: punches.volta_almoco || null,
      saida: punches.saida || null,
      occurrence: occurrence,
      expectedMin: expectedMin,
      workedMin: null,
      extraMin: 0,
      missingMin: 0,
      saldoMin: 0,
      status: "incompleto",
      statusLabel: "Incompleto"
    };

    if (occurrence) {
      result.status = occurrence.type;
      result.statusLabel = (OCCURRENCE_KINDS[occurrence.type] || {}).label || "Ocorrência";
      return result;
    }

    if (result.entrada && result.saida) {
      var workedMs = new Date(result.saida.timestamp).getTime() - new Date(result.entrada.timestamp).getTime();
      if (result.saidaAlmoco && result.voltaAlmoco) {
        var almocoMs = new Date(result.voltaAlmoco.timestamp).getTime() - new Date(result.saidaAlmoco.timestamp).getTime();
        workedMs -= Math.max(0, almocoMs);
      }
      var workedMin = Math.max(0, Math.round(workedMs / 60000));
      result.workedMin = workedMin;
      result.extraMin = Math.max(0, workedMin - expectedMin);
      result.missingMin = Math.max(0, expectedMin - workedMin);
      result.saldoMin = workedMin - expectedMin;
      result.status = "completo";
      result.statusLabel = "Completo";
    } else if (result.entrada && !result.saida) {
      result.status = "em_andamento";
      result.statusLabel = "Em andamento";
    } else if (dayEntries.length) {
      result.status = "incompleto";
      result.statusLabel = "Incompleto";
    }
    return result;
  }

  // Espelho de ponto de um funcionário num período: um item por dia com
  // algum registro (batida ou ocorrência), mais os totais do período.
  // `allEntries`, se informado, evita repetir DB.all("timeClockEntries")
  // quando o chamador já tem a lista (ex.: montando o espelho de vários
  // funcionários de uma vez).
  function espelho(employeeId, startDate, endDate, employee, allEntries) {
    var source = allEntries || DB.all("timeClockEntries");
    var mine = source.filter(function (t) {
      return t.employeeId === employeeId && (!startDate || t.date >= startDate) && (!endDate || t.date <= endDate);
    });
    var byDate = entriesByDate(mine);
    var dates = Object.keys(byDate).sort();
    var days = dates.map(function (d) { return computeDay(d, byDate[d], employee); }).reverse(); // mais recente primeiro
    var totals = days.reduce(function (acc, d) {
      if (d.workedMin != null) acc.workedMin += d.workedMin;
      acc.extraMin += d.extraMin;
      acc.missingMin += d.missingMin;
      if (d.status === "completo") acc.saldoMin += d.saldoMin;
      return acc;
    }, { workedMin: 0, extraMin: 0, missingMin: 0, saldoMin: 0 });
    return { days: days, totals: totals };
  }

  // Intervalo (datas ISO) do mês de `ref` (Date ou "yyyy-mm-dd"; padrão hoje).
  function monthRange(ref) {
    var d = typeof ref === "string" ? new Date(ref + "T00:00:00") : (ref instanceof Date ? ref : new Date());
    var y = d.getFullYear(), m = d.getMonth();
    var start = new Date(y, m, 1);
    var end = new Date(y, m + 1, 0);
    function iso(dt) { return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0"); }
    return { start: iso(start), end: iso(end), label: start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) };
  }

  global.PontoCalc = {
    PUNCH_TYPES: PUNCH_TYPES,
    PUNCH_LABELS: PUNCH_LABELS,
    OCCURRENCE_KINDS: OCCURRENCE_KINDS,
    isPunchType: isPunchType,
    isOccurrenceType: isOccurrenceType,
    dailyExpectedMin: dailyExpectedMin,
    fmtHM: fmtHM,
    computeDay: computeDay,
    espelho: espelho,
    monthRange: monthRange
  };
})(window);
