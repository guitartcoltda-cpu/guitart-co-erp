/* ============================================================
   Salão ERP — Assistente IA do Dashboard
   Barra de pergunta em linguagem natural sobre os dados do salão.

   IMPORTANTE: isto NÃO é um modelo de linguagem (LLM). É um motor
   determinístico: interpreta a pergunta com reconhecimento de padrões
   (palavras-chave + expressões de período), sempre consulta os dados
   reais via DB.all(...) e calcula a resposta na hora — nunca inventa
   um número. Quando a pergunta não é reconhecida, ou não há dados
   suficientes, diz isso claramente em vez de arriscar um chute.

   Todas as definições (o que conta como "receita", "ticket médio",
   "cliente novo" etc.) foram copiadas das mesmas contas que o resto do
   sistema já usa (ver assets/js/dashboard.js, clientes.js,
   relatorio-vendas.js) — para a resposta da IA sempre bater com o que
   o usuário vê nas outras telas. Onde não existe uma definição pronta
   no sistema (ex.: "contas a receber", "horários mais ocupados"), a
   resposta deixa isso explícito.

   Arquitetura pensada para crescer (ver INTENTS abaixo): adicionar uma
   pergunta nova é registrar mais um item nessa lista, sem mexer no
   resto do motor.
   ============================================================ */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------
  // Normalização de texto: minúsculas + sem acento, para o
  // reconhecimento de palavras-chave não depender de o usuário digitar
  // "é"/"e", "não"/"nao" certinho.
  // ---------------------------------------------------------------
  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[?!.,;:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function hasAny(t, words) { return words.some(function (w) { return t.indexOf(w) !== -1; }); }
  function hasAll(t, words) { return words.every(function (w) { return t.indexOf(w) !== -1; }); }

  // ---------------------------------------------------------------
  // Período: reconhece expressões de data em português e devolve
  // {start, end, label}. `today` sempre vem de Utils.todayISO() (data
  // real do sistema), nunca é chutado.
  // ---------------------------------------------------------------
  function monthRange(isoAnyDayInMonth) {
    var start = isoAnyDayInMonth.slice(0, 8) + "01";
    var d = Utils.parseDate(start);
    var end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: start, end: Utils.toISODate(end) };
  }
  function monthLabelFull(isoAnyDayInMonth) {
    var d = Utils.parseDate(isoAnyDayInMonth);
    return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }
  function weekdayIndex(iso) { return Utils.parseDate(iso).getDay(); } // 0=domingo

  var MONTH_NAMES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  // Tenta casar UMA expressão de período no texto. Retorna null se não
  // encontrar nenhuma — quem chama decide o período padrão (mês atual).
  function parsePeriod(t) {
    var today = Utils.todayISO();

    if (/\bhoje\b/.test(t)) return { start: today, end: today, label: "hoje" };
    if (/\bontem\b/.test(t)) { var y = Utils.addDays(today, -1); return { start: y, end: y, label: "ontem" }; }

    var mUlt = t.match(/ultimos?\s+(\d+)\s+dias/);
    if (mUlt) { var n = parseInt(mUlt[1], 10); return { start: Utils.addDays(today, -(n - 1)), end: today, label: "últimos " + n + " dias" }; }

    if (/semana passada/.test(t)) {
      var wEndPrev = Utils.addDays(today, -weekdayIndex(today) - 1); // sábado anterior
      var wStartPrev = Utils.addDays(wEndPrev, -6);
      return { start: wStartPrev, end: wEndPrev, label: "semana passada" };
    }
    if (/esta semana|essa semana/.test(t)) {
      var wStart = Utils.addDays(today, -weekdayIndex(today));
      return { start: wStart, end: today, label: "esta semana" };
    }

    if (/mes passado|mes anterior/.test(t)) {
      var prevMonthAnyDay = Utils.addMonths(today, -1);
      var r = monthRange(prevMonthAnyDay);
      return { start: r.start, end: r.end, label: monthLabelFull(prevMonthAnyDay) };
    }
    if (/este mes|esse mes|mes atual/.test(t)) {
      var rThis = monthRange(today);
      return { start: rThis.start, end: today, label: monthLabelFull(today) };
    }

    if (/ano passado/.test(t)) {
      var py = String(Number(today.slice(0, 4)) - 1);
      return { start: py + "-01-01", end: py + "-12-31", label: "ano de " + py };
    }
    if (/este ano|esse ano|ano atual/.test(t)) {
      return { start: today.slice(0, 4) + "-01-01", end: today, label: "ano de " + today.slice(0, 4) };
    }

    if (/primeiro semestre/.test(t)) {
      var y1 = today.slice(0, 4);
      return { start: y1 + "-01-01", end: y1 + "-06-30", label: "1º semestre de " + y1 };
    }
    if (/segundo semestre/.test(t)) {
      var y2 = today.slice(0, 4);
      return { start: y2 + "-07-01", end: y2 + "-12-31", label: "2º semestre de " + y2 };
    }

    // Nome de mês explícito ("em agosto", "de setembro", "faturamento de julho").
    for (var mi = 0; mi < MONTH_NAMES.length; mi++) {
      var re = new RegExp("\\b" + MONTH_NAMES[mi] + "\\b");
      if (re.test(t)) {
        var curY = Number(today.slice(0, 4)), curM = Number(today.slice(5, 7));
        var year = curY;
        if (mi + 1 > curM) year = curY - 1; // mês ainda não aconteceu este ano -> assume o ano passado
        var anyDay = year + "-" + String(mi + 1).padStart(2, "0") + "-15";
        var rM = monthRange(anyDay);
        return { start: rM.start, end: rM.end, label: monthLabelFull(anyDay) };
      }
    }

    return null;
  }

  // Período "padrão do sistema" (mesmo default do Dashboard: mês atual
  // até hoje) quando a pergunta não menciona nenhum período.
  function defaultPeriod() {
    var today = Utils.todayISO();
    var r = monthRange(today);
    return { start: r.start, end: today, label: monthLabelFull(today) };
  }

  // Janela imediatamente anterior, de mesmo tamanho — mesma fórmula do
  // Dashboard (dashboard.js) para o "vs período anterior".
  function equivalentPreviousRange(range) {
    var spanDays = Utils.daysBetween(range.start, range.end) + 1;
    var prevEnd = Utils.addDays(range.start, -1);
    var prevStart = Utils.addDays(prevEnd, -(spanDays - 1));
    return { start: prevStart, end: prevEnd, label: Utils.fmtDate(prevStart) + " – " + Utils.fmtDate(prevEnd) };
  }

  // Pergunta de comparação explícita ("X com Y", "X versus Y", "X vs Y"):
  // tenta achar DUAS expressões de período, uma de cada lado do
  // conector. Se só achar uma (ou nenhuma), quem chama cai para
  // range-atual vs equivalentPreviousRange.
  function parseComparisonPeriods(t) {
    var parts = t.split(/\bcom\b|\bversus\b|\bvs\b/);
    if (parts.length < 2) return null;
    var a = parsePeriod(parts[0]);
    var b = parsePeriod(parts.slice(1).join(" com "));
    if (a && b) return { current: a, compare: b };
    return null;
  }

  function extractNumber(t, fallback) {
    var m = t.match(/\b(\d{1,3})\b/);
    return m ? parseInt(m[1], 10) : fallback;
  }

  // ---------------------------------------------------------------
  // Camada de dados: cada função aqui espelha, campo por campo, uma
  // conta que já existe em algum lugar do sistema (comentado em cada
  // uma) — para a resposta da IA nunca divergir do que a tela
  // correspondente mostra.
  // ---------------------------------------------------------------
  function inRange(row, range, field) {
    var v = String(row[field] || "").slice(0, 10);
    return v >= range.start && v <= range.end;
  }

  // Mesma definição de "receita" do Dashboard (dashboard.js: type ===
  // "receita" + data no período — sem filtrar status nem excluir venda
  // de produto).
  function receitaTx(range) {
    return DB.all("transactions").filter(function (t) { return t.type === "receita" && inRange(t, range, "date"); });
  }
  function despesaTx(range) {
    return DB.all("transactions").filter(function (t) { return t.type === "despesa" && inRange(t, range, "date"); });
  }
  function sumAmount(arr) { return arr.reduce(function (s, t) { return s + (Number(t.amount) || 0); }, 0); }

  function concludedAppts(range) {
    return DB.all("appointments").filter(function (a) { return a.status === "concluido" && inRange(a, range, "date"); });
  }

  // Mesma junção do Top Serviços do Dashboard: receita de serviço (sem
  // productId) ligada ao agendamento via appointmentId -> serviceId.
  function serviceRevenueMap(range) {
    var appointments = DB.all("appointments");
    var map = {};
    receitaTx(range).filter(function (t) { return !t.productId; }).forEach(function (t) {
      var appt = appointments.find(function (a) { return a.id === t.appointmentId; });
      if (!appt) return;
      map[appt.serviceId] = (map[appt.serviceId] || 0) + (Number(t.amount) || 0);
    });
    return map;
  }

  function employeeRevenueMap(range) {
    var map = {};
    receitaTx(range).forEach(function (t) {
      if (!t.employeeId) return;
      map[t.employeeId] = (map[t.employeeId] || 0) + (Number(t.amount) || 0);
    });
    return map;
  }

  function employeeApptCountMap(range) {
    var map = {};
    concludedAppts(range).forEach(function (a) {
      map[a.employeeId] = (map[a.employeeId] || 0) + 1;
    });
    return map;
  }

  // Mesma fórmula do Dashboard: receita do período ÷ nº de atendimentos
  // concluídos no período.
  function ticketMedio(range) {
    var appts = concludedAppts(range);
    var revenue = sumAmount(receitaTx(range));
    return appts.length ? revenue / appts.length : 0;
  }

  function employeeName(id) { var e = DB.get("employees", id); return e ? e.name : null; }
  function clientName(id) { var c = DB.get("clients", id); return c ? c.name : null; }
  function serviceName(id) { var s = DB.get("services", id); return s ? s.name : null; }

  function round2(n) { return Math.round(n * 100) / 100; }
  function pct(cur, prev) {
    if (Math.abs(prev) < 0.01) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  }

  // ---------------------------------------------------------------
  // Formatação da resposta: todo handler devolve este formato, que a
  // UI (renderAnswer) sabe desenhar.
  // { title, bigValue, deltaText, deltaUp, lines:[...], list:[{label,value}],
  //   note, empty }
  // ---------------------------------------------------------------
  function emptyAnswer(msg) {
    return { empty: true, title: "Sem dados suficientes", note: msg || "Não encontrei dados suficientes no sistema para responder essa pergunta. Tente especificar um período ou reformular a pergunta." };
  }

  // ---------------------------------------------------------------
  // Handlers de cada intenção. `ctx` = { range, rawText, services,
  // employees, clients } — dados já carregados uma vez por pergunta.
  // ---------------------------------------------------------------

  function h_faturamentoPeriodo(t, ctx) {
    var rev = sumAmount(receitaTx(ctx.range));
    var prevRange = equivalentPreviousRange(ctx.range);
    var revPrev = sumAmount(receitaTx(prevRange));
    var d = pct(rev, revPrev);
    var appts = concludedAppts(ctx.range);
    return {
      title: "Faturamento — " + ctx.range.label,
      bigValue: Utils.fmtMoney(rev),
      deltaText: d == null ? "Sem dados no período anterior para comparar" : (d >= 0 ? "+" : "") + d.toFixed(1) + "% em relação ao período anterior",
      deltaUp: d == null ? null : d >= 0,
      lines: ["Atendimentos concluídos: " + appts.length, "Ticket médio: " + Utils.fmtMoney(appts.length ? rev / appts.length : 0)]
    };
  }

  function h_comparacao(t, ctx) {
    var pair = parseComparisonPeriods(t);
    var current = pair ? pair.current : ctx.range;
    var compare = pair ? pair.compare : equivalentPreviousRange(current);
    var revCur = sumAmount(receitaTx(current));
    var revCmp = sumAmount(receitaTx(compare));
    var d = pct(revCur, revCmp);
    return {
      title: "Comparação de faturamento",
      bigValue: Utils.fmtMoney(revCur) + " (" + current.label + ")",
      deltaText: d == null ? "Sem faturamento em " + compare.label + " para comparar" : (d >= 0 ? "+" : "") + d.toFixed(1) + "% em relação a " + compare.label,
      deltaUp: d == null ? null : d >= 0,
      lines: [compare.label + ": " + Utils.fmtMoney(revCmp), "Diferença: " + Utils.fmtMoney(revCur - revCmp)]
    };
  }

  function h_projecao(t, ctx) {
    var today = Utils.todayISO();
    var mr = monthRange(today);
    var revSoFar = sumAmount(receitaTx({ start: mr.start, end: today }));
    var daysElapsed = Utils.daysBetween(mr.start, today) + 1;
    var totalDaysInMonth = Utils.daysBetween(mr.start, mr.end) + 1;
    if (!revSoFar || daysElapsed <= 0) return emptyAnswer("Ainda não há faturamento registrado neste mês para calcular uma projeção.");
    var dailyAvg = revSoFar / daysElapsed;
    var projected = dailyAvg * totalDaysInMonth;
    return {
      title: "Projeção de faturamento — " + monthLabelFull(today),
      bigValue: Utils.fmtMoney(projected),
      note: "Estimativa (projeção), não é um valor já faturado.",
      lines: [
        "Faturado até agora (dia " + daysElapsed + " de " + totalDaysInMonth + "): " + Utils.fmtMoney(revSoFar),
        "Média diária no mês: " + Utils.fmtMoney(dailyAvg),
        "Projeção = média diária × " + totalDaysInMonth + " dias do mês"
      ]
    };
  }

  function h_servicoEspecifico(t, ctx, matchedService) {
    var revMap = serviceRevenueMap(ctx.range);
    var matches = ctx.services.filter(function (s) {
      return normalize(s.name).indexOf(matchedService) !== -1 || normalize(s.group || "").indexOf(matchedService) !== -1;
    });
    if (!matches.length) return emptyAnswer("Não encontrei nenhum serviço cadastrado relacionado a \"" + matchedService + "\".");
    var total = matches.reduce(function (s, sv) { return s + (revMap[sv.id] || 0); }, 0);
    return {
      title: "Faturamento com " + matchedService + " — " + ctx.range.label,
      bigValue: Utils.fmtMoney(total),
      lines: ["Serviço(s) considerado(s): " + matches.map(function (s) { return s.name; }).join(", ")]
    };
  }

  function h_servicoMaisVendido(t, ctx, ascending) {
    var revMap = serviceRevenueMap(ctx.range);
    var n = extractNumber(t, ascending ? 5 : 1);
    var ranked = ctx.services.map(function (s) { return { label: s.name, value: round2(revMap[s.id] || 0) }; })
      .sort(function (a, b) { return ascending ? a.value - b.value : b.value - a.value; });
    if (!ranked.length) return emptyAnswer();
    var top = ranked.slice(0, Math.max(n, 1));
    if (!ascending) {
      var best = top[0];
      if (best.value <= 0) return emptyAnswer("Nenhum serviço teve receita registrada em " + ctx.range.label + ".");
      return {
        title: (n > 1 ? "Serviços que mais venderam" : "Serviço que mais vendeu") + " — " + ctx.range.label,
        bigValue: n > 1 ? String(top.length) + " serviços" : best.label,
        deltaText: n > 1 ? undefined : Utils.fmtMoney(best.value) + " em receita",
        list: n > 1 ? top : undefined,
        listMoney: true,
        lines: n > 1 ? undefined : ["Receita: " + Utils.fmtMoney(best.value)]
      };
    }
    return { title: "Serviços vendendo menos — " + ctx.range.label, bigValue: String(top.length) + " serviços", list: top, listMoney: true };
  }

  function h_profissionalMaisFaturou(t, ctx) {
    var revMap = employeeRevenueMap(ctx.range);
    var ranked = ctx.employees.map(function (e) { return { label: e.name, value: round2(revMap[e.id] || 0) }; })
      .filter(function (r) { return r.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    if (!ranked.length) return emptyAnswer("Nenhum profissional teve receita registrada em " + ctx.range.label + ".");
    var total = ranked.reduce(function (s, r) { return s + r.value; }, 0);
    var best = ranked[0];
    return {
      title: "Profissional que mais faturou — " + ctx.range.label,
      bigValue: best.label,
      deltaText: Utils.fmtMoney(best.value) + (total > 0 ? " (" + ((best.value / total) * 100).toFixed(1) + "% do faturamento do período)" : ""),
      list: ranked.slice(0, 8),
      listMoney: true
    };
  }

  function h_faturamentoPorProfissional(t, ctx) {
    var revMap = employeeRevenueMap(ctx.range);
    var ranked = ctx.employees.map(function (e) { return { label: e.name, value: round2(revMap[e.id] || 0) }; })
      .filter(function (r) { return r.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    if (!ranked.length) return emptyAnswer("Nenhum profissional teve receita registrada em " + ctx.range.label + ".");
    return { title: "Faturamento por profissional — " + ctx.range.label, bigValue: String(ranked.length) + " profissionais", list: ranked, listMoney: true };
  }

  function h_profissionalMaisAtendimentos(t, ctx) {
    var cntMap = employeeApptCountMap(ctx.range);
    var ranked = ctx.employees.map(function (e) { return { label: e.name, value: cntMap[e.id] || 0 }; })
      .filter(function (r) { return r.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    if (!ranked.length) return emptyAnswer("Nenhum atendimento concluído em " + ctx.range.label + ".");
    var best = ranked[0];
    return {
      title: "Profissional com mais atendimentos — " + ctx.range.label,
      bigValue: best.label,
      deltaText: best.value + " atendimento(s) concluído(s)",
      list: ranked.slice(0, 8),
      listMoney: false
    };
  }

  function h_clientesNovos(t, ctx) {
    var novos = ctx.clients.filter(function (c) { return c.firstVisit && inRange(c, ctx.range, "firstVisit"); });
    return {
      title: "Clientes novos — " + ctx.range.label,
      bigValue: String(novos.length),
      note: "Considerando a data de primeira visita cadastrada de cada cliente."
    };
  }

  function h_clientesRetornaram(t, ctx) {
    var appts = concludedAppts(ctx.range);
    var seenIds = {};
    appts.forEach(function (a) { seenIds[a.clientId] = true; });
    var novosIds = {};
    ctx.clients.forEach(function (c) { if (c.firstVisit && inRange(c, ctx.range, "firstVisit")) novosIds[c.id] = true; });
    var retornantes = Object.keys(seenIds).filter(function (id) { return !novosIds[id]; });
    return {
      title: "Clientes que retornaram — " + ctx.range.label,
      bigValue: String(retornantes.length),
      note: "Definição: clientes atendidos no período que já eram clientes antes dele (não é uma métrica com tela própria no sistema — calculada aqui a partir dos atendimentos concluídos e da data de primeira visita)."
    };
  }

  function h_clienteMaisGastou(t, ctx) {
    var map = {};
    receitaTx(ctx.range).forEach(function (tx) { if (tx.clientId) map[tx.clientId] = (map[tx.clientId] || 0) + (Number(tx.amount) || 0); });
    var ranked = Object.keys(map).map(function (id) { return { label: clientName(id) || "Cliente removido", value: round2(map[id]) }; })
      .sort(function (a, b) { return b.value - a.value; });
    if (!ranked.length) return emptyAnswer("Nenhum cliente teve gasto registrado em " + ctx.range.label + ".");
    var best = ranked[0];
    return {
      title: "Cliente que mais gastou — " + ctx.range.label,
      bigValue: best.label,
      deltaText: Utils.fmtMoney(best.value),
      list: ranked.slice(0, 8),
      listMoney: true
    };
  }

  function h_ticketMedio(t, ctx) {
    var v = ticketMedio(ctx.range);
    var appts = concludedAppts(ctx.range);
    if (!appts.length) return emptyAnswer("Nenhum atendimento concluído em " + ctx.range.label + " para calcular o ticket médio.");
    return {
      title: "Ticket médio — " + ctx.range.label,
      bigValue: Utils.fmtMoney(v),
      lines: ["Baseado em " + appts.length + " atendimento(s) concluído(s)"]
    };
  }

  function h_melhorDia(t, ctx) {
    var map = {};
    receitaTx(ctx.range).forEach(function (tx) { map[tx.date] = (map[tx.date] || 0) + (Number(tx.amount) || 0); });
    var days = Object.keys(map).map(function (d) { return { date: d, value: round2(map[d]) }; }).sort(function (a, b) { return b.value - a.value; });
    if (!days.length) return emptyAnswer("Nenhuma receita registrada em " + ctx.range.label + ".");
    var best = days[0];
    return {
      title: "Melhor dia de faturamento — " + ctx.range.label,
      bigValue: Utils.fmtDate(best.date),
      deltaText: Utils.fmtMoney(best.value)
    };
  }

  function h_contasAReceber(t, ctx) {
    var hasExplicitPeriod = ctx.hadExplicitPeriod;
    var range = hasExplicitPeriod ? ctx.range : { start: "2000-01-01", end: "2100-01-01", label: "em aberto (todas as datas)" };
    var pend = DB.all("transactions").filter(function (tx) { return tx.type === "receita" && tx.status === "pendente" && inRange(tx, range, "date"); });
    var total = sumAmount(pend);
    return {
      title: "Contas a receber" + (hasExplicitPeriod ? " — " + ctx.range.label : ""),
      bigValue: Utils.fmtMoney(total),
      lines: [pend.length + " lançamento(s) de receita pendente(s)"],
      note: "Esta é uma conta nova (soma de lançamentos de receita com status \"pendente\") — não existe uma tela de \"Contas a Receber\" hoje no sistema (só há Contas a Pagar para despesas)."
    };
  }

  function h_horariosOcupados(t, ctx) {
    var appts = DB.all("appointments").filter(function (a) { return a.status !== "cancelado" && inRange(a, ctx.range, "date"); });
    var map = {};
    appts.forEach(function (a) {
      var hour = String(a.time || "").slice(0, 2);
      if (!hour) return;
      map[hour] = (map[hour] || 0) + 1;
    });
    var ranked = Object.keys(map).sort().map(function (h) { return { label: h + "h", value: map[h] }; }).sort(function (a, b) { return b.value - a.value; });
    if (!ranked.length) return emptyAnswer("Nenhum agendamento em " + ctx.range.label + ".");
    return {
      title: "Horários mais ocupados — " + ctx.range.label,
      bigValue: ranked[0].label,
      deltaText: ranked[0].value + " agendamento(s) nesse horário",
      list: ranked.slice(0, 6),
      listMoney: false,
      note: "Cálculo novo (agrupando os agendamentos por hora) — não existe essa métrica pronta em nenhuma tela hoje."
    };
  }

  function h_atendimentosPeriodo(t, ctx) {
    var all = DB.all("appointments").filter(function (a) { return inRange(a, ctx.range, "date"); });
    var concluded = all.filter(function (a) { return a.status === "concluido"; });
    return {
      title: "Atendimentos — " + ctx.range.label,
      bigValue: String(all.length),
      lines: ["Concluídos: " + concluded.length, "Agendados/outros: " + (all.length - concluded.length)]
    };
  }

  function h_faturamentoPorClientePorProfissional(t, ctx) {
    var revMap = employeeRevenueMap(ctx.range);
    var appts = concludedAppts(ctx.range);
    var clientsByEmp = {};
    appts.forEach(function (a) {
      if (!clientsByEmp[a.employeeId]) clientsByEmp[a.employeeId] = {};
      clientsByEmp[a.employeeId][a.clientId] = true;
    });
    var ranked = ctx.employees.map(function (e) {
      var rev = revMap[e.id] || 0;
      var nClients = clientsByEmp[e.id] ? Object.keys(clientsByEmp[e.id]).length : 0;
      return { label: e.name, value: nClients ? round2(rev / nClients) : 0, nClients: nClients, rev: rev };
    }).filter(function (r) { return r.nClients > 0; }).sort(function (a, b) { return b.value - a.value; });
    if (!ranked.length) return emptyAnswer("Nenhum atendimento concluído em " + ctx.range.label + ".");
    var best = ranked[0];
    return {
      title: "Maior faturamento por cliente — " + ctx.range.label,
      bigValue: best.label,
      deltaText: Utils.fmtMoney(best.value) + " por cliente (" + Utils.fmtMoney(best.rev) + " ÷ " + best.nClients + " cliente(s))",
      list: ranked.slice(0, 8),
      listMoney: true
    };
  }

  // ---------------------------------------------------------------
  // Registro de intenções, da mais específica para a mais genérica —
  // a primeira cujo `test` bater é usada. Para adicionar uma pergunta
  // nova: acrescentar um item aqui com seu próprio test()/handle().
  // ---------------------------------------------------------------
  var SERVICE_STOPWORDS = ["quanto", "faturamos", "faturamento", "com", "de", "do", "da", "em", "servico", "servicos", "e", "ultimos", "dias", "mes", "este", "esse", "hoje"];

  function findServiceKeyword(t, ctx) {
    // Só tenta casar serviço específico se a pergunta claramente fala de
    // faturamento/venda "com"/"de" alguma coisa — evita falso positivo
    // em perguntas genéricas.
    if (!/\bcom\b|\bde\b/.test(t)) return null;
    var known = {};
    ctx.services.forEach(function (s) {
      known[normalize(s.name)] = true;
      if (s.group) known[normalize(s.group)] = true;
    });
    var words = t.split(" ").filter(function (w) { return w.length > 2 && SERVICE_STOPWORDS.indexOf(w) === -1; });
    for (var i = 0; i < words.length; i++) {
      for (var key in known) {
        if (key.indexOf(words[i]) !== -1 || words[i].indexOf(key) !== -1) return words[i];
      }
    }
    return null;
  }

  var INTENTS = [
    {
      id: "comparacao",
      test: function (t) { return t.indexOf("compar") !== -1 || / vs |versus/.test(t) || (t.indexOf("cresciment") !== -1 && t.indexOf("percentual") !== -1); },
      handle: h_comparacao
    },
    {
      id: "projecao",
      test: function (t) { return hasAny(t, ["projec", "projetar"]) || t.indexOf("nesse ritmo") !== -1 || t.indexOf("continuar nesse") !== -1 || t.indexOf("continuar assim") !== -1; },
      handle: h_projecao
    },
    {
      id: "faturamento_cliente_profissional",
      test: function (t) { return t.indexOf("fatur") !== -1 && t.indexOf("cliente") !== -1 && t.indexOf("profissional") !== -1; },
      handle: h_faturamentoPorClientePorProfissional
    },
    {
      id: "servico_especifico",
      test: function (t, ctx) { return t.indexOf("fatur") !== -1 && !!findServiceKeyword(t, ctx); },
      handle: function (t, ctx) { return h_servicoEspecifico(t, ctx, findServiceKeyword(t, ctx)); }
    },
    {
      // "menos vend..." cobre tanto "vendem menos"/"vendendo menos" quanto
      // "menos vendidos" — indexOf não garante ordem, então basta as duas
      // palavras aparecerem, em qualquer ordem, na pergunta.
      id: "servicos_menos_vendidos",
      test: function (t) { return t.indexOf("servic") !== -1 && ((t.indexOf("menos") !== -1 && t.indexOf("vend") !== -1) || t.indexOf("menos popular") !== -1 || t.indexOf("pior") !== -1); },
      handle: function (t, ctx) { return h_servicoMaisVendido(t, ctx, true); }
    },
    {
      // "mais ger..." cobre "mais gerou"/"mais geraram"/"que mais gerou
      // faturamento" — mesma lógica de não depender da forma verbal exata.
      id: "servico_mais_vendido",
      test: function (t) { return t.indexOf("servic") !== -1 && (t.indexOf("mais vend") !== -1 || t.indexOf("mais popular") !== -1 || t.indexOf("top") !== -1 || t.indexOf("rank") !== -1 || (t.indexOf("mais") !== -1 && t.indexOf("ger") !== -1)); },
      handle: function (t, ctx) { return h_servicoMaisVendido(t, ctx, false); }
    },
    {
      id: "profissional_mais_atendimentos",
      test: function (t) { return (t.indexOf("profissional") !== -1 || t.indexOf("quem") !== -1) && t.indexOf("atendiment") !== -1 && (t.indexOf("mais") !== -1 || t.indexOf("realizou") !== -1); },
      handle: h_profissionalMaisAtendimentos
    },
    {
      id: "profissional_mais_faturou",
      test: function (t) { return (t.indexOf("profissional") !== -1 || t.indexOf("quem") !== -1) && t.indexOf("fatur") !== -1 && t.indexOf("mais") !== -1; },
      handle: h_profissionalMaisFaturou
    },
    {
      id: "faturamento_por_profissional",
      test: function (t) { return t.indexOf("cada profissional") !== -1 || (t.indexOf("profissional") !== -1 && t.indexOf("fatur") !== -1); },
      handle: h_faturamentoPorProfissional
    },
    {
      id: "clientes_novos",
      test: function (t) { return t.indexOf("cliente") !== -1 && t.indexOf("novo") !== -1; },
      handle: h_clientesNovos
    },
    {
      id: "clientes_retornaram",
      test: function (t) { return t.indexOf("cliente") !== -1 && (t.indexOf("retorn") !== -1 || t.indexOf("volt") !== -1 || t.indexOf("recorrente") !== -1); },
      handle: h_clientesRetornaram
    },
    {
      id: "cliente_mais_gastou",
      test: function (t) { return t.indexOf("cliente") !== -1 && t.indexOf("gast") !== -1; },
      handle: h_clienteMaisGastou
    },
    {
      id: "ticket_medio",
      test: function (t) { return t.indexOf("ticket") !== -1; },
      handle: h_ticketMedio
    },
    {
      id: "melhor_dia",
      test: function (t) { return t.indexOf("melhor dia") !== -1; },
      handle: h_melhorDia
    },
    {
      id: "contas_a_receber",
      test: function (t) { return t.indexOf("receber") !== -1; },
      handle: h_contasAReceber
    },
    {
      id: "horarios_ocupados",
      test: function (t) { return t.indexOf("horari") !== -1 && (t.indexOf("ocupad") !== -1 || t.indexOf("movimentad") !== -1); },
      handle: h_horariosOcupados
    },
    {
      id: "atendimentos_periodo",
      test: function (t) { return t.indexOf("atendiment") !== -1 && (t.indexOf("quant") !== -1 || t.indexOf("numero") !== -1); },
      handle: h_atendimentosPeriodo
    },
    {
      id: "faturamento_periodo",
      test: function (t) { return t.indexOf("fatur") !== -1; },
      handle: h_faturamentoPeriodo
    }
  ];

  // ---------------------------------------------------------------
  // Motor principal: normaliza, resolve período, escolhe intenção,
  // executa. `context` carrega o histórico curto (última intenção) para
  // permitir perguntas de seguimento como "E no mês passado?".
  // ---------------------------------------------------------------
  function answerQuestion(rawText, context) {
    var t = normalize(rawText);
    if (!t) return emptyAnswer("Digite uma pergunta para eu responder.");

    // Tudo que segue depende de ler o banco (DB.all/DB.get) — envolve o
    // corpo inteiro num try/catch, não só a chamada do handler, para que
    // uma falha de leitura (ex.: instabilidade momentânea de conexão)
    // também caia na mensagem amigável de erro (item 12 da especificação:
    // nunca mostrar erro técnico), em vez de estourar uma exceção não
    // tratada para quem chamou (mount()/ask() na UI).
    try {
      var parsedPeriod = parsePeriod(t);
      var ctxData = {
        services: DB.all("services"),
        employees: DB.all("employees").filter(function (e) { return e.status === "ativo"; }),
        clients: DB.all("clients"),
        hadExplicitPeriod: !!parsedPeriod
      };
      ctxData.range = parsedPeriod || (context && context.lastRange) || defaultPeriod();

      var matched = null;
      for (var i = 0; i < INTENTS.length; i++) {
        if (INTENTS[i].test(t, ctxData)) { matched = INTENTS[i]; break; }
      }

      // Pergunta de seguimento: só trouxe um período novo, sem palavra-
      // chave própria de nenhuma intenção — reaproveita a última intenção
      // reconhecida (ex.: "Quanto faturamos esse mês?" -> "E no mês
      // passado?").
      if (!matched && parsedPeriod && context && context.lastIntentId) {
        matched = INTENTS.filter(function (i) { return i.id === context.lastIntentId; })[0] || null;
      }

      if (!matched) {
        return emptyAnswer("Não entendi essa pergunta. Tente reformular ou use uma das sugestões abaixo.");
      }

      var result = matched.handle(t, ctxData) || emptyAnswer();
      result.intentId = matched.id;
      result.range = ctxData.range;
      return result;
    } catch (err) {
      console.error("AIAssistant: erro ao responder", err);
      return emptyAnswer("Tive um problema para calcular essa resposta. Tente reformular a pergunta.");
    }
  }

  global.AIAssistant = {
    // expostos para teste automatizado (ver ai-assistant.test.js) e para
    // eventual reuso em outra tela.
    _internal: { normalize: normalize, parsePeriod: parsePeriod, answerQuestion: answerQuestion },
    answerQuestion: answerQuestion,
    mount: mount
  };

  // ================================================================
  // UI
  // ================================================================
  var SUGGESTIONS = [
    "Quanto faturamos este mês?",
    "Qual profissional faturou mais?",
    "Qual serviço mais vendeu?",
    "Quantos clientes novos tivemos?",
    "Compare o faturamento deste mês com o mês passado.",
    "Qual foi o ticket médio deste mês?"
  ];
  var HISTORY_KEY = "salao_erp_ai_history_v1";

  function loadHistory() {
    try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 8))); } catch (e) { /* sessionStorage indisponível — histórico não persiste, sem problema */ }
  }

  function mount(container) {
    if (!container) return null;
    var context = { lastIntentId: null, lastRange: null };
    var history = loadHistory();

    container.innerHTML =
      '<div class="ai-bar-wrap">' +
        '<div class="ai-bar">' +
          '<i class="fa-solid fa-sparkles ai-bar-icon"></i>' +
          '<input type="text" id="ai-bar-input" class="ai-bar-input" placeholder="Pergunte qualquer coisa sobre o seu salão…" autocomplete="off">' +
          '<button type="button" class="ai-bar-send" id="ai-bar-send" title="Perguntar"><i class="fa-solid fa-paper-plane"></i></button>' +
        '</div>' +
        '<div id="ai-bar-body"></div>' +
      '</div>';

    var input = container.querySelector("#ai-bar-input");
    var sendBtn = container.querySelector("#ai-bar-send");
    var body = container.querySelector("#ai-bar-body");

    function suggestionsHtml() {
      return '<div class="ai-suggestions">' +
        '<div class="ai-suggestions-label">Experimente perguntar:</div>' +
        '<div class="ai-chip-row">' + SUGGESTIONS.map(function (s) { return '<button type="button" class="ai-chip" data-ai-suggestion="' + Utils.escapeHtml(s) + '">' + Utils.escapeHtml(s) + '</button>'; }).join("") + '</div>' +
        '</div>';
    }

    function historyHtml() {
      if (!history.length) return "";
      return '<div class="ai-history">' +
        '<div class="ai-suggestions-label">Perguntas recentes</div>' +
        '<div class="ai-chip-row">' + history.map(function (h, idx) { return '<button type="button" class="ai-chip ai-chip-history" data-ai-history="' + idx + '"><i class="fa-regular fa-clock"></i> ' + Utils.escapeHtml(h.text) + '</button>'; }).join("") + '</div>' +
        '</div>';
    }

    function renderIdle() {
      body.innerHTML = historyHtml() + suggestionsHtml();
      wireChips();
    }

    function wireChips() {
      Utils.qsa("[data-ai-suggestion]", body).forEach(function (b) {
        b.addEventListener("click", function () { input.value = b.getAttribute("data-ai-suggestion"); ask(); });
      });
      Utils.qsa("[data-ai-history]", body).forEach(function (b) {
        b.addEventListener("click", function () {
          var idx = parseInt(b.getAttribute("data-ai-history"), 10);
          var h = history[idx];
          if (!h) return;
          input.value = h.text;
          renderAnswer(h.answer, h.text, false);
        });
      });
    }

    function deltaBadgeHtml(a) {
      if (a.deltaUp === null || a.deltaUp === undefined) {
        return a.deltaText ? '<div class="ai-answer-delta neutral">' + Utils.escapeHtml(a.deltaText) + '</div>' : "";
      }
      return '<div class="ai-answer-delta ' + (a.deltaUp ? "up" : "down") + '"><i class="fa-solid fa-caret-' + (a.deltaUp ? "up" : "down") + '"></i> ' + Utils.escapeHtml(a.deltaText) + '</div>';
    }

    // `money` vem explícito de cada handler (a.listMoney) — nunca é
    // adivinhado a partir do formato do número, para não confundir um
    // valor em R$ redondo (ex.: R$ 500,00) com uma contagem (ex.: 500
    // atendimentos).
    function listHtml(list, money) {
      if (!list || !list.length) return "";
      var max = Math.max.apply(null, list.map(function (r) { return r.value; })) || 1;
      return '<div class="ai-answer-list">' + list.map(function (r) {
        var pctW = max > 0 ? Math.max(2, (r.value / max) * 100) : 0;
        var displayValue = typeof r.value === "number" ? (money ? Utils.fmtMoney(r.value) : Utils.fmtNumber(r.value)) : String(r.value);
        return '<div class="ai-answer-list-row">' +
          '<div class="ai-answer-list-label">' + Utils.escapeHtml(r.label) + '</div>' +
          '<div class="progress-track"><div class="progress-fill" style="width:' + pctW + '%;"></div></div>' +
          '<div class="ai-answer-list-value">' + Utils.escapeHtml(displayValue) + '</div>' +
          '</div>';
      }).join("") + '</div>';
    }

    function renderAnswer(a, questionText, addToHistory) {
      if (a.empty) {
        body.innerHTML =
          '<div class="ai-answer-card ai-answer-empty">' +
            '<div class="ai-answer-title"><i class="fa-regular fa-circle-question"></i> ' + Utils.escapeHtml(a.title || "Não entendi") + '</div>' +
            '<div class="ai-answer-note">' + Utils.escapeHtml(a.note || "") + '</div>' +
          '</div>' + suggestionsHtml();
        wireChips();
        return;
      }
      body.innerHTML =
        '<div class="ai-answer-card">' +
          '<div class="ai-answer-title">' + Utils.escapeHtml(a.title) + '</div>' +
          '<div class="ai-answer-value">' + Utils.escapeHtml(a.bigValue) + '</div>' +
          deltaBadgeHtml(a) +
          (a.lines ? '<div class="ai-answer-lines">' + a.lines.map(function (l) { return '<div>' + Utils.escapeHtml(l) + '</div>'; }).join("") + '</div>' : "") +
          listHtml(a.list, a.listMoney) +
          (a.note ? '<div class="ai-answer-note"><i class="fa-regular fa-lightbulb"></i> ' + Utils.escapeHtml(a.note) + '</div>' : "") +
          '<button type="button" class="ai-answer-close" id="ai-answer-close" title="Nova pergunta"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' + historyHtml() + suggestionsHtml();
      wireChips();
      var closeBtn = body.querySelector("#ai-answer-close");
      if (closeBtn) closeBtn.addEventListener("click", function () { input.value = ""; renderIdle(); input.focus(); });

      if (addToHistory !== false) {
        history.unshift({ text: questionText, answer: a, ts: Date.now() });
        history = history.slice(0, 8);
        saveHistory(history);
      }
      if (!a.empty) {
        context.lastIntentId = a.intentId;
        context.lastRange = a.range;
      }
    }

    function ask() {
      var text = input.value.trim();
      if (!text) return;
      var a = answerQuestion(text, context);
      renderAnswer(a, text, true);
    }

    sendBtn.addEventListener("click", ask);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") ask(); });

    renderIdle();
    return { ask: ask };
  }

  // Auto-inicialização: se a página tiver o ponto de montagem, sobe
  // sozinho (sem depender de dashboard.js) assim que o DB estiver
  // pronto — mesmo padrão de módulo independente usado no resto do
  // sistema (cada tela cuida do seu próprio init).
  document.addEventListener("DOMContentLoaded", function () {
    var mountEl = document.getElementById("ai-assistant-mount");
    if (!mountEl) return;
    DB.ready.then(function () { setTimeout(function () { mount(mountEl); }, 0); });
  });
})(window);
