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

   JORNADA (08/10/2026) — Funcionários → editar → "Jornada de trabalho"
   agora pode guardar um horário fixo por dia da semana (employee.
   workSchedule: dias de trabalho, entrada/saída de cada dia, duração do
   intervalo e uma janela sugerida de almoço). Quem tem esse horário:
   - tem o saldo (banco de horas) calculado minuto a minuto contra o
     horário previsto do DIA DA SEMANA (entrar/sair antes ou depois do
     previsto vira saldo positivo/negativo; sem tolerância); o almoço é
     flexível — pode ser tirado a qualquer hora, só a DURAÇÃO conta (mais
     que o previsto desconta, menos soma);
   - ganha no espelho uma linha para TODOS os dias do período (do primeiro
     registro dela até hoje): dia sem registro num dia de folga semanal
     aparece como "Salão fechado — folga semanal" (sem desconto), e dia
     de trabalho sem nenhuma batida nem justificativa aparece como "Sem
     registro — pendente de justificativa" (destacado, mas SEM descontar
     do banco de horas até alguém decidir — justificar com uma
     ocorrência ou lançar a batida).
   Quem NÃO tem horário fixo continua exatamente como antes: carga
   horária diária única e só os dias que têm algum registro.

   HORAS NEGATIVAS (08/10/2026) — terceiro tipo de registro, `debito_horas`
   (ver ADJUST_TYPE): um desconto de horas lançado à mão pela Gestão de
   Ponto (ex.: uma falta que precisa ser descontada). Guarda `debitMin`
   (minutos, positivo) e `useBank`: true = sai do saldo do banco de horas
   (se o saldo não cobrir, o banco fica negativo); false = não mexe no
   banco, vira desconto em folha (ver folha-calc.js). Não é batida nem
   ocorrência: convive com elas no mesmo dia (ex.: a ocorrência "FALTA"
   continua marcando o dia e o débito diz quantas horas descontar).
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

  // Horas negativas (desconto) — ver cabeçalho. Não entra em PUNCH_TYPES nem
  // em OCCURRENCE_KINDS de propósito: não é batida e não "justifica" o dia.
  var ADJUST_TYPE = "debito_horas";
  var ADJUST_LABEL = "Horas negativas (desconto)";
  function isAdjustType(type) { return type === ADJUST_TYPE; }
  // minutos de um registro de horas negativas (sempre >= 0)
  function debitMinOf(t) { var n = Math.round(Number(t && t.debitMin) || 0); return n > 0 ? n : 0; }

  function isPunchType(type) { return PUNCH_TYPES.indexOf(type) !== -1; }
  function isOccurrenceType(type) { return !!OCCURRENCE_KINDS[type]; }

  // ---------------- Jornada (employee.workSchedule) ----------------
  var WEEKDAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
  var WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // segunda a domingo (dias de folga ficam juntos nas faixas)

  // "9:40" / "09:40" / "0940" / "940" → minutos desde 00:00 (ou null se inválido).
  function parseHM(str) {
    if (str == null) return null;
    var m = String(str).trim().match(/^(\d{1,2}):?(\d{2})$/);
    if (!m) return null;
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  // minutos → "09:40"
  function fmtClock(min) {
    var n = Math.max(0, Math.round(Number(min) || 0));
    return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  }
  function weekdayOf(dateIso) { return new Date(dateIso + "T00:00:00").getDay(); }
  function hasSchedule(employee) {
    return !!(employee && employee.workSchedule && employee.workSchedule.days && typeof employee.workSchedule.days === "object");
  }

  // Jornada prevista de um dia específico. null = funcionário sem horário
  // fixo (usa a carga horária diária única). { working:false } = folga
  // semanal. { working:true, ... } = dia de trabalho com horário.
  function scheduleFor(employee, dateIso) {
    if (!hasSchedule(employee) || !dateIso) return null;
    var ws = employee.workSchedule;
    var lunchMin = Number(ws.lunchMin);
    if (!(lunchMin >= 0)) lunchMin = 0;
    var day = ws.days[String(weekdayOf(dateIso))];
    if (!day) return { working: false, startMin: null, endMin: null, lunchMin: lunchMin, expectedMin: 0 };
    var start = parseHM(day.start), end = parseHM(day.end);
    if (start == null || end == null || end <= start) return null; // dado inválido: cai na carga única
    return {
      working: true, startMin: start, endMin: end, lunchMin: lunchMin,
      lunchFromMin: parseHM(ws.lunchFrom), lunchToMin: parseHM(ws.lunchTo),
      expectedMin: Math.max(0, end - start - lunchMin)
    };
  }

  // O funcionário deveria trabalhar neste dia? (sem horário fixo: sempre sim)
  function isWorkingDay(employee, dateIso) {
    var sc = scheduleFor(employee, dateIso);
    return sc ? sc.working : true;
  }

  // Minutos previstos. Com `dateIso` e horário fixo: o previsto daquele dia
  // da semana (0 na folga). Sem data / sem horário fixo: a carga horária
  // diária única (padrão 8h).
  function dailyExpectedMin(employee, dateIso) {
    if (dateIso) {
      var sc = scheduleFor(employee, dateIso);
      if (sc) return sc.expectedMin;
    }
    var h = employee && Number(employee.dailyWorkHours);
    if (!h || h <= 0) h = 8;
    return h * 60;
  }

  // Texto resumo da jornada, ex.: "Ter–Sáb · 09:40–19:00 · almoço 1h00 (12:00–13:00) · 8h20/dia".
  function scheduleSummary(employee) {
    if (!hasSchedule(employee)) return "Carga horária diária: " + (dailyExpectedMin(employee) / 60) + "h";
    var ws = employee.workSchedule;
    var groups = [], byKey = {};
    WEEK_ORDER.forEach(function (wd) {
      var d = ws.days[String(wd)];
      if (!d) return;
      var key = d.start + "-" + d.end;
      if (!byKey[key]) { byKey[key] = { start: d.start, end: d.end, days: [] }; groups.push(byKey[key]); }
      byKey[key].days.push(wd);
    });
    if (!groups.length) return "Sem dias de trabalho definidos";
    function daysLabel(days) {
      var out = [], i = 0;
      while (i < days.length) {
        var j = i;
        while (j + 1 < days.length && WEEK_ORDER.indexOf(days[j + 1]) === WEEK_ORDER.indexOf(days[j]) + 1) j++;
        out.push(j > i ? WEEKDAY_SHORT[days[i]] + "–" + WEEKDAY_SHORT[days[j]] : WEEKDAY_SHORT[days[i]]);
        i = j + 1;
      }
      return out.join(", ");
    }
    var lunch = Number(ws.lunchMin) > 0
      ? " · almoço " + fmtHM(Number(ws.lunchMin)) + (parseHM(ws.lunchFrom) != null && parseHM(ws.lunchTo) != null ? " (" + ws.lunchFrom + "–" + ws.lunchTo + ")" : "")
      : "";
    return groups.map(function (g) {
      var sc = scheduleFor(employee, nextDateWithWeekday(g.days[0]));
      return daysLabel(g.days) + " · " + g.start + "–" + g.end + lunch + (sc ? " · " + fmtHM(sc.expectedMin) + "/dia" : "");
    }).join(" | ");
  }
  // Uma data qualquer (ISO) cujo dia da semana seja `wd` — só para reaproveitar scheduleFor.
  function nextDateWithWeekday(wd) {
    var d = new Date(2024, 0, 7); // 07/01/2024 = domingo
    d.setDate(d.getDate() + wd);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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
    var sc = scheduleFor(employee, date);
    var expectedMin = sc ? sc.expectedMin : dailyExpectedMin(employee);
    var punches = {};
    dayEntries.filter(function (t) { return isPunchType(t.type); }).forEach(function (t) {
      if (!punches[t.type]) punches[t.type] = t;
    });
    // horas negativas do dia: as que saem do banco (adjustMin, negativo) e as
    // que viram desconto em folha (adjustPayMin, positivo)
    var adjustEntries = dayEntries.filter(function (t) { return isAdjustType(t.type); });
    var adjustMin = 0, adjustPayMin = 0;
    adjustEntries.forEach(function (t) {
      if (t.useBank === false) adjustPayMin += debitMinOf(t); else adjustMin -= debitMinOf(t);
    });

    var result = {
      date: date,
      entrada: punches.entrada || null,
      saidaAlmoco: punches.saida_almoco || null,
      voltaAlmoco: punches.volta_almoco || null,
      saida: punches.saida || null,
      occurrence: occurrence,
      schedule: sc,
      expectedMin: expectedMin,
      lunchMinActual: null,
      lunchAssumed: false,
      workedMin: null,
      extraMin: 0,
      missingMin: 0,
      saldoMin: 0,
      adjustEntries: adjustEntries,
      adjustMin: adjustMin,
      adjustPayMin: adjustPayMin,
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
        result.lunchMinActual = Math.max(0, Math.round(almocoMs / 60000));
      } else if (sc && sc.working && sc.lunchMin > 0) {
        // Com horário fixo e sem as batidas do almoço: desconta o intervalo
        // previsto (senão o dia contaria o almoço como trabalhado) e avisa.
        workedMs -= sc.lunchMin * 60000;
        result.lunchMinActual = sc.lunchMin;
        result.lunchAssumed = true;
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
    } else if (dayEntries.length > adjustEntries.length) {
      result.status = "incompleto";
      result.statusLabel = "Incompleto";
    } else if (adjustEntries.length) {
      result.status = "ajuste";
      result.statusLabel = ADJUST_LABEL;
    }
    return result;
  }

  // Espelho de ponto de um funcionário num período: um item por dia com
  // algum registro (batida ou ocorrência), mais os totais do período.
  // `allEntries`, se informado, evita repetir DB.all("timeClockEntries")
  // quando o chamador já tem a lista (ex.: montando o espelho de vários
  // funcionários de uma vez).
  function isoOf(dt) { return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0"); }

  // Linha "sem registro" de um dia sem nenhuma batida nem ocorrência — só
  // para quem tem horário fixo (ver cabeçalho do arquivo).
  function placeholderDay(date, sc, todayIso) {
    var working = sc ? sc.working : true;
    var status, label;
    if (!working) { status = "folga_semanal"; label = "Salão fechado — folga semanal"; }
    else if (date >= todayIso) { status = "aguardando"; label = "Aguardando registro"; }
    else { status = "sem_registro"; label = "Sem registro — pendente de justificativa"; }
    return {
      date: date, entrada: null, saidaAlmoco: null, voltaAlmoco: null, saida: null, occurrence: null,
      schedule: sc, expectedMin: sc ? sc.expectedMin : 0, lunchMinActual: null, lunchAssumed: false,
      workedMin: null, extraMin: 0, missingMin: 0, saldoMin: 0, adjustEntries: [], adjustMin: 0, adjustPayMin: 0, status: status, statusLabel: label, placeholder: true
    };
  }

  // Espelho de ponto de um funcionário num período: um item por dia com
  // algum registro (batida ou ocorrência), mais os totais do período.
  // `allEntries`, se informado, evita repetir DB.all("timeClockEntries")
  // quando o chamador já tem a lista (ex.: montando o espelho de vários
  // funcionários de uma vez).
  // `opts.fillDays` (padrão: true só para quem tem horário fixo) inclui
  // também os dias SEM registro — do primeiro registro do funcionário até
  // hoje (ou o fim do período, o que vier primeiro) — como "folga semanal"
  // ou "sem registro". `opts.today` existe só para teste.
  function espelho(employeeId, startDate, endDate, employee, allEntries, opts) {
    var source = allEntries || DB.all("timeClockEntries");
    var mine = source.filter(function (t) {
      return t.employeeId === employeeId && (!startDate || t.date >= startDate) && (!endDate || t.date <= endDate);
    });
    var byDate = entriesByDate(mine);
    var dates = Object.keys(byDate).sort();
    var days = dates.map(function (d) { return computeDay(d, byDate[d], employee); });

    var fill = opts && opts.fillDays != null ? !!opts.fillDays : hasSchedule(employee);
    if (fill && startDate && endDate) {
      var firstDate = null;
      source.forEach(function (t) {
        if (t.employeeId === employeeId && t.date && (firstDate === null || t.date < firstDate)) firstDate = t.date;
      });
      if (firstDate) {
        var todayIso = (opts && opts.today) || isoOf(new Date());
        var from = startDate > firstDate ? startDate : firstDate;
        var to = endDate < todayIso ? endDate : todayIso;
        var cursor = new Date(from + "T00:00:00");
        var stop = new Date(to + "T00:00:00");
        // evita laço gigante se alguém passar um período absurdo (ex.: 10 anos)
        for (var guard = 0; cursor <= stop && guard < 800; guard++) {
          var iso = isoOf(cursor);
          if (!byDate[iso]) days.push(placeholderDay(iso, scheduleFor(employee, iso), todayIso));
          cursor.setDate(cursor.getDate() + 1);
        }
      }
    }
    days.sort(function (a, b) { return b.date.localeCompare(a.date); }); // mais recente primeiro

    var totals = days.reduce(function (acc, d) {
      if (d.workedMin != null) acc.workedMin += d.workedMin;
      acc.extraMin += d.extraMin;
      acc.missingMin += d.missingMin;
      if (d.status === "completo") acc.saldoMin += d.saldoMin;
      // horas negativas que saem do banco entram no saldo (mesmo em dia sem batida/com ocorrência)
      acc.saldoMin += d.adjustMin || 0;
      acc.adjustMin += d.adjustMin || 0;
      acc.adjustPayMin += d.adjustPayMin || 0;
      if (d.status === "folga_semanal") acc.folgaDays++;
      if (d.status === "sem_registro") acc.pendingDays++;
      return acc;
    }, { workedMin: 0, extraMin: 0, missingMin: 0, saldoMin: 0, adjustMin: 0, adjustPayMin: 0, folgaDays: 0, pendingDays: 0 });
    return { days: days, totals: totals };
  }

  // Saldo do dia no banco de horas, já com as horas negativas que saíram do
  // banco. `show` = tem algo para mostrar (dia com batidas completas ou com
  // horas negativas lançadas).
  function dayBank(d) {
    var punch = d.workedMin != null ? d.saldoMin : 0;
    var adj = d.adjustMin || 0;
    return { min: punch + adj, show: d.workedMin != null || adj !== 0, adjustMin: adj, adjustPayMin: d.adjustPayMin || 0 };
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
    ADJUST_TYPE: ADJUST_TYPE,
    ADJUST_LABEL: ADJUST_LABEL,
    isAdjustType: isAdjustType,
    debitMinOf: debitMinOf,
    dayBank: dayBank,
    dailyExpectedMin: dailyExpectedMin,
    WEEKDAY_NAMES: WEEKDAY_NAMES,
    WEEKDAY_SHORT: WEEKDAY_SHORT,
    WEEK_ORDER: WEEK_ORDER,
    parseHM: parseHM,
    fmtClock: fmtClock,
    hasSchedule: hasSchedule,
    scheduleFor: scheduleFor,
    isWorkingDay: isWorkingDay,
    scheduleSummary: scheduleSummary,
    fmtHM: fmtHM,
    computeDay: computeDay,
    espelho: espelho,
    monthRange: monthRange
  };
})(window);
