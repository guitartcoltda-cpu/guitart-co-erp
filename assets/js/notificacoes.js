/* ============================================================
   Salão ERP — Notificações via WhatsApp (outbox offline)
   Este app é 100% estático/offline e não tem backend, então não é
   possível disparar mensagens sozinho. O que este módulo faz:
   1) Identifica automaticamente 3 situações (confirmação de
      agendamento, lembrete de véspera, cliente inativo há tempo) e
      registra cada uma como um item "pendente" na tabela
      `notifications`.
   2) A tela de Notificações (notificacoes.html) lista esses itens e
      monta o link wa.me com a mensagem pronta — quem estiver no
      salão clica em "Abrir WhatsApp" e confirma o envio manualmente.
   Quando o projeto subir com backend (GitHub/Supabase), o disparo
   automático via API do WhatsApp pode plugar exatamente nesse mesmo
   fluxo — trocando o clique manual por uma chamada de API sobre os
   mesmos registros de `notifications`.
   ============================================================ */
(function (global) {
  "use strict";

  var TYPE_LABELS = {
    confirmacao: "Confirmação de Agendamento",
    lembrete: "Lembrete de Véspera",
    inatividade: "Cliente Ausente Há Tempo",
    avaliacao: "Pedido de Avaliação",
    pagamento_admin: "Pagamentos do Dia (Administradores)"
  };

  var INACTIVE_THRESHOLD_DAYS = 45; // regra de reserva p/ cliente sem histórico suficiente p/ estimar recorrência
  var RECURRENCE_MIN_OCCURRENCES = 3; // mesmo mínimo usado na Central de Alertas (assets/js/recorrencia.js)
  var REMINDER_HOUR = 17; // lembrete de véspera só é gerado a partir das 17h (ver syncDayBeforeRemindersIfDue)

  function firstName(name) { return (name || "").trim().split(" ")[0] || name || ""; }

  function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }

  // Monta o link wa.me a partir do telefone cadastrado do cliente. Assume
  // DDI 55 (Brasil) quando o número não vier com código de país.
  function waLink(phone, message) {
    var digits = digitsOnly(phone);
    if (!digits) return null;
    if (digits.length <= 11) digits = "55" + digits;
    return "https://wa.me/" + digits + "?text=" + encodeURIComponent(message || "");
  }

  var TEMPLATES = {
    confirmacao: function (ctx) {
      return "Olá, " + ctx.clientFirstName + "! Seu agendamento na Guitart & Co. está confirmado para " +
        ctx.dateLabel + " às " + ctx.time + " — " + ctx.serviceName + (ctx.employeeName ? " com " + ctx.employeeName : "") +
        ". Qualquer imprevisto, é só chamar por aqui. Até lá!";
    },
    lembrete: function (ctx) {
      return "Oi, " + ctx.clientFirstName + "! Passando para lembrar do seu horário amanhã (" + ctx.dateLabel + ") às " +
        ctx.time + " na Guitart & Co. — " + ctx.serviceName + (ctx.employeeName ? " com " + ctx.employeeName : "") +
        ". Você confirma presença?";
    },
    inatividade: function (ctx) {
      if (ctx.serviceName) {
        return "Oi, " + ctx.clientFirstName + "! Já faz um tempinho desde o seu último " + ctx.serviceName + " aqui na Guitart & Co. — você costuma voltar a cada ~" + ctx.avgGap +
          " dias, e já se passaram " + ctx.daysSince + " dias. Que tal marcar um novo horário? Estamos com a agenda aberta esperando por você!";
      }
      return "Oi, " + ctx.clientFirstName + "! Faz tempo que a gente não te vê por aqui na Guitart & Co. (" + ctx.daysSince +
        " dias desde sua última visita). Que tal marcar um novo horário? Estamos com a agenda aberta esperando por você!";
    },
    avaliacao: function (ctx) {
      return "Oi, " + ctx.clientFirstName + "! Passou pela Guitart & Co. hoje para " + (ctx.serviceName || "seu atendimento") +
        (ctx.employeeName ? " com " + ctx.employeeName : "") + " — esperamos que tenha gostado! Podemos contar com uma nota de 0 a 10 " +
        "e, se quiser, um comentário rápido sobre o atendimento? Isso nos ajuda muito a melhorar. Obrigado 🙏";
    },
    pagamento_admin: function (ctx) {
      return "*Pagamentos de hoje (" + ctx.dateLabel + ")*\n" +
        ctx.count + " pagamento(s) recebido(s), totalizando " + ctx.totalLabel + ".";
    }
  };

  function hasNotification(type, refId) {
    return !!DB.findOne("notifications", function (n) { return n.type === type && n.refId === refId; });
  }

  // Chamado pela Agenda logo após criar um agendamento novo (status
  // "agendado") — enfileira a notificação de confirmação para aquele
  // atendimento específico (idempotente: 1 por agendamento).
  function queueBookingConfirmation(appt) {
    if (!appt || appt.status !== "agendado") return null;
    if (hasNotification("confirmacao", appt.id)) return null;
    var client = DB.get("clients", appt.clientId);
    if (!client) return null;
    return DB.insert("notifications", {
      type: "confirmacao", refId: appt.id, clientId: client.id, appointmentId: appt.id,
      status: "pendente", createdDate: Utils.todayISO(), meta: null
    });
  }

  // Chamado pela Agenda logo após concluir um atendimento (ver
  // concludeAppointment em assets/js/agenda.js) — enfileira um pedido de
  // avaliação/comentário para o cliente daquele atendimento (idempotente: 1
  // por agendamento, igual à confirmação de agendamento acima).
  function queueReviewRequest(appt) {
    if (!appt || appt.status !== "concluido") return null;
    if (hasNotification("avaliacao", appt.id)) return null;
    var client = DB.get("clients", appt.clientId);
    if (!client) return null;
    return DB.insert("notifications", {
      type: "avaliacao", refId: appt.id, clientId: client.id, appointmentId: appt.id,
      status: "pendente", createdDate: Utils.todayISO(), meta: null
    });
  }

  // Varre os pagamentos (transações com status "pago") registrados HOJE e,
  // se houver ao menos um, garante 1 notificação pendente por administrador
  // ativo (idempotente por dia — refId = adminId + data). Chamado em toda
  // página do sistema via syncAll() (mesmo padrão do lembrete de véspera),
  // então "automático" aqui significa: assim que um Administrador abrir o
  // sistema depois de algum pagamento do dia, a notificação já está lá.
  function syncDailyPaymentAlerts() {
    var today = Utils.todayISO();
    var todaysPayments = DB.all("transactions").filter(function (t) { return t.status === "pago" && t.date === today; });
    if (!todaysPayments.length) return 0;
    var total = todaysPayments.reduce(function (s, t) { return s + (Number(t.amount) || 0); }, 0);
    var admins = DB.all("users").filter(function (u) { return u.role === "Administrador" && u.active !== false; });
    var created = 0;
    admins.forEach(function (admin) {
      var refId = admin.id + "_" + today;
      if (hasNotification("pagamento_admin", refId)) return;
      DB.insert("notifications", {
        type: "pagamento_admin", refId: refId, clientId: null, appointmentId: null, adminUserId: admin.id,
        status: "pendente", createdDate: today,
        meta: { date: today, count: todaysPayments.length, total: Math.round(total * 100) / 100 }
      });
      created++;
    });
    return created;
  }

  // Varre os agendamentos de amanhã e garante 1 lembrete de véspera por
  // atendimento "agendado" (idempotente). Uso interno — ver
  // syncDayBeforeRemindersIfDue, que é a versão com o gatilho de horário
  // que o resto do sistema chama.
  function syncDayBeforeReminders() {
    var tomorrow = Utils.addDays(Utils.todayISO(), 1);
    var created = 0;
    DB.all("appointments").filter(function (a) { return a.status === "agendado" && a.date === tomorrow; }).forEach(function (a) {
      if (hasNotification("lembrete", a.id)) return;
      var client = DB.get("clients", a.clientId);
      if (!client) return;
      DB.insert("notifications", {
        type: "lembrete", refId: a.id, clientId: client.id, appointmentId: a.id,
        status: "pendente", createdDate: Utils.todayISO(), meta: null
      });
      created++;
    });
    return created;
  }

  // O pedido é que a confirmação de véspera "saia" todos os dias às 17h,
  // de forma automática. Como este é um app 100% client-side sem servidor
  // (não existe processo rodando com o navegador fechado), o melhor
  // equivalente é: assim que o relógio do dispositivo passar das 17h, a
  // fila é gerada sozinha na primeira tela que a pessoa abrir no sistema —
  // sem precisar entrar em Notificações manualmente (ver layout.js, que
  // chama isso em toda página). Antes das 17h, nada é gerado ainda.
  function syncDayBeforeRemindersIfDue() {
    if (new Date().getHours() < REMINDER_HOUR) return 0;
    return syncDayBeforeReminders();
  }

  // Identifica clientes que provavelmente já deveriam ter voltado, usando
  // o padrão de recorrência real de cada um (intervalo médio entre
  // atendimentos concluídos do mesmo serviço — mesmo cálculo da Central de
  // Alertas, ver assets/js/recorrencia.js) em vez de um número fixo de
  // dias igual pra todo mundo. Cliente com um serviço de recorrência
  // vencida (data prevista do próximo já passou, e ainda não tem retorno
  // marcado) gera o alerta citando aquele serviço. Só cai na regra fixa de
  // INACTIVE_THRESHOLD_DAYS dias quando não há histórico suficiente (menos
  // de 3 atendimentos concluídos do mesmo serviço) para estimar um padrão.
  function syncInactiveAlerts() {
    var today = Utils.todayISO();
    var created = 0;
    var appointments = DB.all("appointments");

    var dueByClient = {};
    if (global.Recorrencia) {
      Recorrencia.compute(appointments, today, RECURRENCE_MIN_OCCURRENCES).forEach(function (r) {
        if (r.hasFutureSame || r.daysUntil > 0) return; // ainda não venceu, ou já tem retorno marcado
        if (!dueByClient[r.clientId] || r.daysUntil < dueByClient[r.clientId].daysUntil) dueByClient[r.clientId] = r;
      });
    }

    DB.all("clients").forEach(function (c) {
      var done = appointments.filter(function (a) { return a.clientId === c.id && a.status === "concluido"; })
        .sort(function (x, y) { return y.date.localeCompare(x.date); });
      if (!done.length) return;
      var hasFuture = appointments.some(function (a) { return a.clientId === c.id && a.status === "agendado" && a.date >= today; });
      if (hasFuture) return;

      var due = dueByClient[c.id];
      if (due) {
        var service = DB.get("services", due.serviceId);
        var refId = c.id + "_" + due.serviceId + "_" + due.lastDate;
        if (hasNotification("inatividade", refId)) return;
        DB.insert("notifications", {
          type: "inatividade", refId: refId, clientId: c.id, appointmentId: null,
          status: "pendente", createdDate: today,
          meta: { daysSince: due.daysSinceLast, lastDate: due.lastDate, serviceName: service ? service.name : null, avgGap: due.avgGap, rule: "recorrencia" }
        });
        created++;
        return;
      }

      // Regra de reserva: sem padrão de recorrência identificável ainda.
      var lastDate = done[0].date;
      var daysSince = Utils.daysBetween(lastDate, today);
      if (daysSince < INACTIVE_THRESHOLD_DAYS) return;
      var refId2 = c.id + "_" + lastDate;
      if (hasNotification("inatividade", refId2)) return;
      DB.insert("notifications", {
        type: "inatividade", refId: refId2, clientId: c.id, appointmentId: null,
        status: "pendente", createdDate: today, meta: { daysSince: daysSince, lastDate: lastDate, rule: "fixo" }
      });
      created++;
    });
    return created;
  }

  // Roda as checagens automáticas (a de confirmação é disparada na hora,
  // pela Agenda, ao criar o agendamento). Chamado em toda página do
  // sistema, não só em Notificações — ver layout.js.
  function syncAll() {
    return { reminders: syncDayBeforeRemindersIfDue(), inactive: syncInactiveAlerts(), dailyPayments: syncDailyPaymentAlerts() };
  }

  function contextFor(n) {
    var client = DB.get("clients", n.clientId);
    var appt = n.appointmentId ? DB.get("appointments", n.appointmentId) : null;
    var service = appt ? DB.get("services", appt.serviceId) : null;
    var employee = appt ? DB.get("employees", appt.employeeId) : null;
    return {
      clientFirstName: firstName(client ? client.name : ""),
      dateLabel: (n.meta && n.meta.date) ? Utils.fmtDate(n.meta.date) : (appt ? Utils.fmtDate(appt.date) : ""),
      time: appt ? appt.time : "",
      serviceName: service ? service.name : (n.meta && n.meta.serviceName) || "",
      employeeName: employee ? employee.name : "",
      daysSince: (n.meta && n.meta.daysSince) || "",
      avgGap: (n.meta && n.meta.avgGap) || "",
      count: (n.meta && n.meta.count) || 0,
      totalLabel: (n.meta && n.meta.total != null && global.Utils) ? Utils.fmtMoney(n.meta.total) : ""
    };
  }

  function messageFor(n) {
    var fn = TEMPLATES[n.type];
    return fn ? fn(contextFor(n)) : "";
  }

  // Quem deve receber esta notificação: um cliente (a maioria dos tipos) ou
  // um usuário Administrador (tipo pagamento_admin, ver
  // syncDailyPaymentAlerts). Centraliza aqui para a tela de Notificações não
  // precisar saber a diferença entre os dois casos.
  function recipientFor(n) {
    if (n.adminUserId) {
      var admin = DB.get("users", n.adminUserId);
      if (!admin) return null;
      return { name: (admin.firstName + " " + admin.lastName).trim(), phone: admin.phone, photoDataUrl: null };
    }
    var client = DB.get("clients", n.clientId);
    if (!client) return null;
    return { name: client.name, phone: client.phone, photoDataUrl: client.photoDataUrl };
  }

  function linkFor(n) {
    var recipient = recipientFor(n);
    if (!recipient) return null;
    return waLink(recipient.phone, messageFor(n));
  }

  function markSent(id) {
    var n = DB.get("notifications", id);
    if (!n) return;
    DB.update("notifications", id, { status: "enviada", sentAt: new Date().toISOString() });
    var client = DB.get("clients", n.clientId);
    DB.log("Notificações", "Marcou como enviada a notificação de WhatsApp (" + (TYPE_LABELS[n.type] || n.type) + ") para " + (client ? client.name : "cliente removido"));
  }

  function dismiss(id) {
    var n = DB.get("notifications", id);
    if (!n) return;
    DB.update("notifications", id, { status: "cancelada" });
  }

  global.Notificacoes = {
    TYPE_LABELS: TYPE_LABELS,
    waLink: waLink,
    queueBookingConfirmation: queueBookingConfirmation,
    queueReviewRequest: queueReviewRequest,
    syncDayBeforeReminders: syncDayBeforeReminders,
    syncDayBeforeRemindersIfDue: syncDayBeforeRemindersIfDue,
    syncInactiveAlerts: syncInactiveAlerts,
    syncDailyPaymentAlerts: syncDailyPaymentAlerts,
    syncAll: syncAll,
    messageFor: messageFor,
    linkFor: linkFor,
    recipientFor: recipientFor,
    markSent: markSent,
    dismiss: dismiss
  };
})(window);
