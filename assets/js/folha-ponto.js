/* ============================================================
   Salão ERP — Folha de Ponto: fechamento, publicação e assinatura
   (10/10/2026)

   Fluxo:
   1) A gestão (Administrador/Desenvolvedor) termina os ajustes do mês e
      clica em "Fechar e Publicar Folha" (Gestão de Ponto → Assinaturas).
      O sistema TIRA UMA FOTO (snapshot) da folha de cada colaboradora —
      já com as horas, tolerâncias e ajustes — e grava na tabela
      "timeSheets" junto com um código de verificação (hash SHA-256 do
      conteúdo). O mês fica TRAVADO: não dá mais para editar/excluir
      batidas, lançar manualmente, ajustar saldo ou aprovar ajustes
      daquele mês enquanto a folha estiver publicada.
   2) A folha aparece no "Bater Ponto" da colaboradora (aba "Folhas de
      Ponto"), onde ela vê o documento e assina se estiver de acordo.
   3) A gerência (Administrador/Gerente/Desenvolvedor) também assina na
      aba Assinaturas. Qualquer ordem. Com as 2 assinaturas a folha fica
      CONCLUÍDA.
   4) Se algo precisar mudar depois, a gestão "reabre" a folha: ela é
      cancelada (as assinaturas antigas ficam guardadas no histórico),
      o mês destrava e, depois dos ajustes, uma nova folha é publicada.

   Assinatura = aceite eletrônico simples com trilha de auditoria (quem,
   quando, aparelho e código do documento). Não é certificado ICP-Brasil.
   ============================================================ */
(function (global) {
  "use strict";

  var TABLE = "timeSheets";
  var MANAGER_ROLES = ["Administrador", "Gerente", "Desenvolvedor"];
  var PUBLISH_ROLES = ["Administrador", "Desenvolvedor"];
  var TZ = "America/Sao_Paulo";

  // ---------------------------------------------------------------
  // SHA-256 (síncrono, sem depender de crypto.subtle/https)
  // ---------------------------------------------------------------
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256Hex(str) {
    var bytes = unescape(encodeURIComponent(String(str)));
    var len = bytes.length;
    var words = [];
    for (var i = 0; i < len; i++) words[i >> 2] |= bytes.charCodeAt(i) << (24 - (i % 4) * 8);
    words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    words[(((len + 8) >> 6) << 4) + 15] = len * 8;
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var j = 0; j < words.length; j += 16) {
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var t = 0; t < 64; t++) {
        if (t < 16) W[t] = words[j + t] | 0;
        else {
          var s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
          var s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
          W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
        }
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }

  // JSON com chaves em ordem alfabética — o Postgres (jsonb) não preserva a
  // ordem das chaves, então o hash precisa ser calculado sobre uma forma
  // canônica para continuar batendo depois de ir e voltar do servidor.
  function canonicalJson(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canonicalJson(v[k]); }).join(",") + "}";
  }

  function hashSnapshot(snap) { return sha256Hex(canonicalJson(snap)); }

  function shortCode(hash) {
    return String(hash || "").slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, "$1-");
  }

  // ---------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------
  function esc(s) { return global.Utils.escapeHtml(s == null ? "" : String(s)); }
  function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function fmtDateTime(iso) {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " às");
    } catch (e) { return String(iso); }
  }

  function hhmm(rec) {
    return rec ? new Date(rec.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "-";
  }

  function adjustText(t) {
    var m = global.PontoCalc.debitMinOf(t);
    if (global.PontoCalc.isCreditAdjust(t)) return "+" + global.PontoCalc.fmtHM(m) + " no banco de horas";
    return "-" + global.PontoCalc.fmtHM(m) + (t.useBank === false ? " em folha de pagamento (não usa o banco)" : " no banco de horas");
  }

  function earlyText(d) {
    var m = global.PontoCalc.earlyLeaveMeta(d);
    return m ? m.label + " (" + global.PontoCalc.fmtHM(m.min) + ")" : "";
  }

  // Rótulo amigável do aparelho a partir do user agent.
  function deviceLabel(ua) {
    ua = String(ua || "");
    if (!ua) return "Aparelho não identificado";
    var os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Sistema desconhecido";
    var br = /Edg\//i.test(ua) ? "Edge" : /OPR\/|Opera/i.test(ua) ? "Opera" : /Firefox\//i.test(ua) ? "Firefox" : /Chrome\//i.test(ua) || /CriOS/i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : "Navegador";
    var mobile = /Mobi|Android|iPhone|iPad/i.test(ua) ? "celular/tablet" : "computador";
    return os + " · " + br + " (" + mobile + ")";
  }

  function currentUser() {
    return global.CurrentUser && global.CurrentUser.get ? global.CurrentUser.get() : null;
  }
  function userName(u) { return u ? ((u.firstName || "") + " " + (u.lastName || "")).trim() || "-" : "-"; }

  function canPublish() {
    var u = currentUser();
    return !!(u && PUBLISH_ROLES.indexOf(u.role) !== -1);
  }

  // Funcionária vinculada ao usuário logado (mesma regra de
  // funcionarios.js → linkedUserFor, no sentido contrário).
  function myEmployeeId() {
    var u = currentUser();
    if (!u) return null;
    if (u.employeeId) return u.employeeId;
    if (!u.cpf) return null;
    var emp = global.DB.findOne("employees", function (e) { return e.cpf === u.cpf; });
    return emp ? emp.id : null;
  }

  // ---------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------
  function allSheets() { return global.DB.all(TABLE); }

  function isActive(sheet) { return !!sheet && sheet.status !== "cancelada"; }

  function statusOf(sheet) {
    if (!sheet) return "";
    if (sheet.status === "cancelada") return "cancelada";
    var s = sheet.signatures || {};
    if (s.manager && s.employee) return "concluida";
    if (s.manager || s.employee) return "parcial";
    return "aguardando";
  }

  var STATUS_META = {
    aguardando: { label: "Aguardando assinaturas", badge: "badge-warning" },
    parcial: { label: "Falta 1 assinatura", badge: "badge-info" },
    concluida: { label: "Concluída", badge: "badge-success" },
    cancelada: { label: "Reaberta (cancelada)", badge: "badge-gray" }
  };

  function sheetsOf(employeeId) {
    return allSheets().filter(function (s) { return s.employeeId === employeeId; })
      .sort(function (a, b) { return (b.monthKey || "").localeCompare(a.monthKey || "") || (b.publishedAt || "").localeCompare(a.publishedAt || ""); });
  }

  function activeSheet(employeeId, monthKey) {
    return allSheets().find(function (s) { return s.employeeId === employeeId && s.monthKey === monthKey && isActive(s); }) || null;
  }

  // Folha ativa (publicada) que trava a data informada, ou null.
  function lockFor(employeeId, date) {
    if (!employeeId || !date) return null;
    return activeSheet(employeeId, String(date).slice(0, 7));
  }

  // Retorna true (e avisa) se a data estiver travada por folha publicada.
  function guard(employeeId, date) {
    var sh = lockFor(employeeId, date);
    if (!sh) return false;
    var label = sh.monthLabel || sh.monthKey;
    if (global.Toast) global.Toast.show("O período " + label + " está fechado (folha publicada para assinatura). Para alterar, a gestão precisa reabrir a folha em Gestão de Ponto → Assinaturas.", "danger");
    return true;
  }

  function pendingForEmployee(employeeId) {
    return sheetsOf(employeeId).filter(function (s) { return isActive(s) && !(s.signatures && s.signatures.employee); });
  }

  function verifyIntegrity(sheet) {
    return !!sheet && !!sheet.snapshot && hashSnapshot(sheet.snapshot) === sheet.hash;
  }

  function canSignAsEmployee(sheet) {
    return isActive(sheet) && !(sheet.signatures && sheet.signatures.employee) && !!myEmployeeId() && myEmployeeId() === sheet.employeeId;
  }

  function canSignAsManager(sheet) {
    var u = currentUser();
    if (!u || MANAGER_ROLES.indexOf(u.role) === -1) return false;
    if (!isActive(sheet) || (sheet.signatures && sheet.signatures.manager)) return false;
    if (myEmployeeId() && myEmployeeId() === sheet.employeeId) return false; // ninguém assina pela gerência a própria folha
    return true;
  }

  // ---------------------------------------------------------------
  // Snapshot da folha (o que vai para o PDF e para o hash)
  // ---------------------------------------------------------------
  var COLS = [
    { key: "data", label: "Data", x: 40, w: 55 },
    { key: "entrada", label: "Entrada", x: 95, w: 50 },
    { key: "saidaAlmoco", label: "Saída Almoço", x: 145, w: 62 },
    { key: "voltaAlmoco", label: "Volta Almoço", x: 207, w: 62 },
    { key: "saida", label: "Saída", x: 269, w: 48 },
    { key: "trabalhado", label: "Trabalhado", x: 317, w: 62 },
    { key: "extras", label: "Extras", x: 379, w: 52 },
    { key: "faltantes", label: "Faltantes", x: 431, w: 52 },
    { key: "saldo", label: "Saldo", x: 483, w: 52 },
    { key: "obs", label: "Ocorrência / Observação", x: 535, w: 267 }
  ];

  function monthCutoff(monthKey) {
    var today = global.Utils.todayISO();
    if (monthKey === global.Utils.monthKey(today)) return today;
    var parts = monthKey.split("-").map(Number);
    var lastDay = new Date(parts[0], parts[1], 0).getDate();
    return monthKey + "-" + String(lastDay).padStart(2, "0");
  }

  function rowsFromEspelho(data) {
    var PC = global.PontoCalc, U = global.Utils;
    var days = data.days.slice().reverse();
    return days.map(function (d) {
      var wd = PC.WEEKDAY_SHORT[new Date(d.date + "T12:00:00").getDay()];
      var c = ["", "", "", "", "", "", "", "", "", ""];
      c[0] = U.fmtDate(d.date);
      var kind = "normal";
      if (d.status === "folga_semanal") {
        kind = "folga";
        c[1] = wd + " — Salão fechado (folga semanal), sem desconto";
      } else if (d.status === "sem_registro" || d.status === "aguardando") {
        kind = "pend";
        c[1] = wd + " — " + d.statusLabel + (d.expectedMin ? " (previsto " + PC.fmtHM(d.expectedMin) + ")" : "");
      } else if (d.status === "ajuste") {
        kind = "ajuste";
        c[8] = PC.fmtHM(PC.dayBank(d).min);
        c[9] = wd + " · " + d.adjustEntries.map(function (t) { return PC.adjustLabelOf(t) + " " + adjustText(t); }).join(" · ");
      } else if (d.occurrence) {
        kind = "ocorr";
        var k = PC.OCCURRENCE_KINDS[d.occurrence.type] || {};
        if (d.adjustMin) c[8] = PC.fmtHM(d.adjustMin);
        c[9] = wd + " · " + (k.label || d.occurrence.type) + (d.occurrence.note ? " — " + d.occurrence.note : "") +
          (d.adjustEntries.length ? " · " + d.adjustEntries.map(adjustText).join(" · ") : "");
      } else {
        var bank = PC.dayBank(d);
        c[1] = hhmm(d.entrada);
        c[2] = hhmm(d.saidaAlmoco);
        c[3] = hhmm(d.voltaAlmoco);
        c[4] = hhmm(d.saida);
        c[5] = d.workedMin != null ? PC.fmtHM(d.workedMin) : "-";
        c[6] = d.workedMin != null ? "+" + PC.fmtHM(d.extraMin) : "-";
        c[7] = d.workedMin != null ? "-" + PC.fmtHM(d.missingMin) : "-";
        c[8] = bank.show ? PC.fmtHM(bank.min) : "-";
        c[9] = wd + (d.status !== "completo" ? " · " + d.statusLabel : (d.lunchAssumed ? " · almoço previsto" : "")) +
          (d.entradaTolerada || d.saidaTolerada ? " · tol. " + PC.PUNCH_TOLERANCE_MIN + "min" : "") +
          (d.earlyLeave ? " · " + earlyText(d) : "") +
          (d.adjustEntries.length ? " · " + d.adjustEntries.map(adjustText).join(" · ") : "");
      }
      return { date: d.date, kind: kind, c: c };
    });
  }

  // emp: registro do funcionário; allEntries: DB.all("timeClockEntries").
  function buildSnapshot(emp, monthKey, allEntries, meta) {
    var PC = global.PontoCalc, U = global.Utils;
    meta = meta || {};
    var range = PC.monthRange(monthKey + "-01");
    var cutoff = monthCutoff(monthKey);
    var endForRange = cutoff < range.end ? cutoff : range.end;
    var data = PC.espelho(emp.id, range.start, endForRange, emp, allEntries);
    var hasSched = PC.hasSchedule(emp);
    var note = "";
    if (hasSched) {
      note = "Folgas semanais (salão fechado): " + data.totals.folgaDays + " dia(s), sem desconto" +
        (data.totals.pendingDays ? " · Dias úteis sem registro, pendentes de justificativa: " + data.totals.pendingDays : "");
    }
    return {
      v: 1,
      company: "Guitart & Co.",
      employeeId: emp.id,
      employeeName: emp.name,
      employeeRole: emp.role || "",
      monthKey: monthKey,
      monthLabel: capFirst(range.label),
      scheduleText: hasSched ? "Jornada: " + PC.scheduleSummary(emp) : "Carga horária diária: " + (PC.dailyExpectedMin(emp) / 60) + "h",
      cutoff: cutoff,
      cutoffLabel: U.fmtDate(cutoff),
      toleranceMin: PC.PUNCH_TOLERANCE_MIN,
      generatedAt: meta.generatedAt || new Date().toISOString(),
      generatedBy: meta.generatedBy || "",
      rows: rowsFromEspelho(data),
      totals: {
        worked: PC.fmtHM(data.totals.workedMin),
        extra: "+" + PC.fmtHM(data.totals.extraMin),
        missing: "-" + PC.fmtHM(data.totals.missingMin),
        saldo: PC.fmtHM(data.totals.saldoMin),
        pendingDays: data.totals.pendingDays || 0,
        folgaDays: data.totals.folgaDays || 0
      },
      note: note
    };
  }

  // ---------------------------------------------------------------
  // PDF
  // ---------------------------------------------------------------
  // items: [{ snap, sheet|null }]. Sem `sheet` é a folha "de rascunho"
  // (impressão com linhas em branco para assinar na caneta).
  function drawPdf(doc, items) {
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var marginX = 40, tableEnd = pageWidth - marginX;
    var pageOwner = {};

    function mark(item) { pageOwner[doc.getNumberOfPages()] = item; }

    function drawColHeaders(y) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      COLS.forEach(function (c) { doc.text(c.label, c.x, y); });
      y += 6;
      doc.setLineWidth(0.6);
      doc.line(marginX, y, tableEnd, y);
      return y + 13;
    }

    function ensureSpace(item, y, needed, withHeaders) {
      if (y + needed <= pageHeight - 52) return y;
      doc.addPage();
      mark(item);
      var ny = 50;
      if (withHeaders) ny = drawColHeaders(ny);
      return ny;
    }

    function signBox(item, x, w, y, title, sig) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(0);
      if (sig) {
        doc.setFont("helvetica", "bold");
        doc.text("Assinado eletronicamente", x, y - 34);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.text(sig.name + " (" + sig.roleLabel + ")", x, y - 22, { maxWidth: w });
        doc.text(fmtDateTime(sig.at), x, y - 10, { maxWidth: w });
      } else if (item.sheet) {
        doc.setTextColor(150, 90, 0);
        doc.text("Assinatura pendente", x, y - 10);
        doc.setTextColor(0);
      }
      doc.setFontSize(9);
      doc.setLineWidth(0.6);
      doc.line(x, y, x + w, y);
      doc.text(title, x, y + 12);
    }

    items.forEach(function (item, idx) {
      var snap = item.snap, sheet = item.sheet;
      if (idx > 0) doc.addPage();
      mark(item);
      var y = 46;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(0);
      doc.text(snap.company + " — Folha de Ponto", marginX, y);
      y += 20;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Funcionário: " + snap.employeeName + (snap.employeeRole ? " — " + snap.employeeRole : ""), marginX, y);
      doc.text("Mês de referência: " + snap.monthLabel, tableEnd, y, { align: "right" });
      y += 15;
      doc.text(snap.scheduleText, marginX, y);
      doc.text("Período fechado em: " + snap.cutoffLabel, tableEnd, y, { align: "right" });
      y += 15;
      if (sheet) {
        var st = STATUS_META[statusOf(sheet)] || {};
        doc.text("Publicada em " + fmtDateTime(sheet.publishedAt) + " por " + (sheet.publishedByName || "-") + " · Situação: " + (st.label || ""), marginX, y);
        doc.text("Código de verificação: " + shortCode(sheet.hash), tableEnd, y, { align: "right" });
      } else {
        doc.text("Gerado em " + global.Utils.fmtDate(global.Utils.todayISO()) + " por " + (snap.generatedBy || "-"), marginX, y);
      }
      y += 18;

      y = drawColHeaders(y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);

      if (!snap.rows.length) {
        doc.text("Nenhum lançamento neste período.", marginX, y);
        y += 16;
      } else {
        snap.rows.forEach(function (r) {
          y = ensureSpace(item, y, 14, true);
          if (r.kind === "folga") doc.setTextColor(120);
          else if (r.kind === "pend") doc.setTextColor(150, 90, 0);
          r.c.forEach(function (txt, i) {
            if (!txt) return;
            if (i === 9) doc.text(txt, COLS[9].x, y, { maxWidth: COLS[9].w });
            else doc.text(txt, COLS[i].x, y);
          });
          doc.setTextColor(0);
          y += 14;
        });
      }

      y = ensureSpace(item, y, 20, false);
      doc.setLineWidth(0.6);
      doc.line(marginX, y, tableEnd, y);
      y += 13;
      doc.setFont("helvetica", "bold");
      doc.text("Total do período", COLS[0].x, y);
      doc.text(snap.totals.worked, COLS[5].x, y);
      doc.text(snap.totals.extra, COLS[6].x, y);
      doc.text(snap.totals.missing, COLS[7].x, y);
      doc.text(snap.totals.saldo, COLS[8].x, y);
      if (snap.note) {
        y += 14;
        doc.setFont("helvetica", "normal");
        doc.text(snap.note, COLS[0].x, y);
      }

      y = ensureSpace(item, y, 150, false);
      y += 60;
      var sigs = (sheet && sheet.signatures) || {};
      signBox(item, marginX, 250, y, "Assinatura do Funcionário", sigs.employee);
      signBox(item, tableEnd - 250, 250, y, "Assinatura do Responsável (Gerência)", sigs.manager);

      if (sheet) {
        y += 34;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("Registro de assinatura eletrônica", marginX, y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        y += 11;
        doc.text("Documento (SHA-256): " + sheet.hash, marginX, y);
        [["Funcionário", sigs.employee], ["Gerência", sigs.manager]].forEach(function (p) {
          y += 11;
          var s = p[1];
          doc.text(p[0] + ": " + (s ? s.name + " — " + fmtDateTime(s.at) + " — " + s.device + " — documento " + shortCode(s.hash) : "aguardando assinatura"), marginX, y, { maxWidth: tableEnd - marginX });
        });
        y += 11;
        doc.text("Assinatura eletrônica simples (aceite com identificação do usuário, data/hora, aparelho e código do documento).", marginX, y);
      }
    });

    // Rodapé com código de verificação e numeração por documento
    var total = doc.getNumberOfPages();
    var perItemCount = [], perItemIdx = {};
    items.forEach(function (it, i) { perItemCount[i] = 0; });
    for (var p = 1; p <= total; p++) {
      var it2 = pageOwner[p];
      var ii = items.indexOf(it2);
      if (ii < 0) continue;
      perItemCount[ii]++;
      perItemIdx[p] = perItemCount[ii];
    }
    for (var q = 1; q <= total; q++) {
      var own = pageOwner[q];
      var oi = items.indexOf(own);
      if (oi < 0) continue;
      doc.setPage(q);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(110);
      var left = own.sheet ? "Guitart & Co. · " + own.snap.employeeName + " · " + own.snap.monthLabel + " · Cód. " + shortCode(own.sheet.hash) : "Guitart & Co. · " + own.snap.employeeName + " · " + own.snap.monthLabel;
      doc.text(left, marginX, pageHeight - 22);
      doc.text("Página " + perItemIdx[q] + " de " + perItemCount[oi], tableEnd, pageHeight - 22, { align: "right" });
      doc.setTextColor(0);
    }
  }

  function newDoc() {
    var Ctor = global.jspdf && global.jspdf.jsPDF;
    if (!Ctor) return null;
    return new Ctor({ unit: "pt", format: "a4", orientation: "landscape" });
  }

  function pdfFileName(sheet) {
    return "folha-ponto_" + global.Utils.slugify(sheet.employeeName || "funcionario") + "_" + sheet.monthKey + (statusOf(sheet) === "concluida" ? "_assinada" : "") + ".pdf";
  }

  function downloadPdf(sheetId) {
    var sheet = global.DB.get(TABLE, sheetId);
    if (!sheet) return;
    var doc = newDoc();
    if (!doc) { global.Toast.show("Não foi possível carregar a biblioteca de PDF — verifique sua conexão e tente novamente", "danger"); return; }
    drawPdf(doc, [{ snap: sheet.snapshot, sheet: sheet }]);
    doc.save(pdfFileName(sheet));
  }

  // ---------------------------------------------------------------
  // Operações: publicar, assinar, reabrir
  // ---------------------------------------------------------------
  function isMonthClosed(monthKey) {
    // só meses já encerrados podem ser fechados
    return monthKey < global.Utils.monthKey(global.Utils.todayISO());
  }

  function publishErrorTableMissing() {
    return "Não foi possível gravar a folha no servidor. Provavelmente a tabela \"timeSheets\" ainda não foi criada no Supabase — rode o SQL de criação (arquivo supabase/timesheets.sql) e tente novamente.";
  }

  // Cria (e trava) a folha de UM funcionário. Retorna { ok, sheet?, error? }.
  function publishOne(emp, monthKey) {
    if (!canPublish()) return { ok: false, error: "Somente administradores podem fechar e publicar a folha." };
    if (!isMonthClosed(monthKey)) return { ok: false, error: "O mês ainda não terminou — só dá para fechar meses já encerrados." };
    if (activeSheet(emp.id, monthKey)) return { ok: false, error: "Já existe uma folha publicada deste mês para " + emp.name + "." };
    var u = currentUser();
    var now = new Date().toISOString();
    var snap = buildSnapshot(emp, monthKey, global.DB.all("timeClockEntries"), { generatedAt: now, generatedBy: userName(u) });
    var rec = global.DB.insert(TABLE, {
      employeeId: emp.id,
      employeeName: emp.name,
      monthKey: monthKey,
      monthLabel: snap.monthLabel,
      cutoff: snap.cutoff,
      snapshot: snap,
      hash: hashSnapshot(snap),
      status: "publicada",
      publishedAt: now,
      publishedById: u ? u.id : null,
      publishedByName: userName(u),
      signatures: { manager: null, employee: null },
      history: [{ at: now, by: userName(u), action: "publicada", note: "" }]
    });
    return { ok: true, sheet: rec };
  }

  function publishMany(employeeIds, monthKey) {
    var results = [];
    var emps = employeeIds.map(function (id) { return global.DB.get("employees", id); }).filter(Boolean);
    emps.forEach(function (emp) { results.push({ emp: emp, res: publishOne(emp, monthKey) }); });
    var okList = results.filter(function (r) { return r.res.ok; });
    if (okList.length) {
      global.DB.log("Ponto", "Fechou e publicou a Folha de Ponto de " + okList.map(function (r) { return r.emp.name; }).join(", ") + " (ref. " + okList[0].res.sheet.monthLabel + ") para assinatura");
    }
    return results;
  }

  function signatureRecord(role) {
    var u = currentUser();
    var ua = (global.navigator && global.navigator.userAgent) || "";
    return {
      userId: u ? u.id : null,
      name: userName(u),
      roleLabel: role === "employee" ? "Funcionário" : (u && u.role) || "Gerência",
      userRole: u ? u.role : "",
      at: new Date().toISOString(),
      device: deviceLabel(ua),
      userAgent: ua.slice(0, 220)
    };
  }

  // role: "employee" | "manager". cb(ok, msg)
  function sign(sheetId, role, cb) {
    cb = cb || function () {};
    var local = global.DB.get(TABLE, sheetId);
    if (!local) { cb(false, "Folha não encontrada."); return; }
    global.DB.fetchFresh(TABLE, sheetId).then(function (fresh) {
      var sheet = fresh || local;
      if (!isActive(sheet)) { cb(false, "Esta folha foi reaberta/cancelada — atualize a tela."); return; }
      if (!verifyIntegrity(sheet)) { cb(false, "O código de verificação da folha não confere — assinatura bloqueada. Avise a gestão."); return; }
      if (role === "employee" && !canSignAsEmployee(sheet)) { cb(false, "Só a própria funcionária, entrando com o seu usuário, pode assinar esta folha."); return; }
      if (role === "manager" && !canSignAsManager(sheet)) { cb(false, "Seu usuário não pode assinar pela gerência esta folha."); return; }
      if (sheet.signatures && sheet.signatures[role]) { cb(false, "Esta parte já foi assinada."); return; }
      var sig = signatureRecord(role);
      sig.hash = sheet.hash;
      global.DB.mergeRecordUpdate(TABLE, sheetId, function (cur) {
        var sigs = Object.assign({ manager: null, employee: null }, cur.signatures || {});
        if (!sigs[role]) sigs[role] = sig;
        var hist = (cur.history || []).concat([{ at: sig.at, by: sig.name, action: "assinou_" + role, note: sig.device }]);
        return { signatures: sigs, history: hist };
      });
      global.DB.log("Ponto", sig.name + " assinou a Folha de Ponto de " + sheet.employeeName + " (" + sheet.monthLabel + ") como " + (role === "employee" ? "funcionário" : "gerência"));
      refreshAll();
      cb(true, "");
    });
  }

  function cancelSheet(sheetId, reason, cb) {
    cb = cb || function () {};
    if (!canPublish()) { cb(false, "Somente administradores podem reabrir a folha."); return; }
    var sheet = global.DB.get(TABLE, sheetId);
    if (!sheet || !isActive(sheet)) { cb(false, "Folha não encontrada ou já reaberta."); return; }
    var u = currentUser();
    var now = new Date().toISOString();
    global.DB.mergeRecordUpdate(TABLE, sheetId, function (cur) {
      return {
        status: "cancelada",
        cancelledAt: now,
        cancelledByName: userName(u),
        cancelReason: reason || "",
        history: (cur.history || []).concat([{ at: now, by: userName(u), action: "reaberta", note: reason || "" }])
      };
    });
    global.DB.log("Ponto", "Reabriu a Folha de Ponto de " + sheet.employeeName + " (" + sheet.monthLabel + ")" + (reason ? " — motivo: " + reason : "") + "; assinaturas anteriores canceladas");
    refreshAll();
    cb(true, "");
  }

  // ---------------------------------------------------------------
  // Telas compartilhadas
  // ---------------------------------------------------------------
  var refreshers = [];
  function refreshAll() {
    refreshers = refreshers.filter(function (fn) {
      try { return fn() !== false; } catch (e) { return true; }
    });
  }

  function sigChip(sig, label) {
    return sig
      ? '<span class="badge badge-success" title="' + esc(sig.device) + '"><i class="fa-solid fa-signature"></i> ' + label + ': ' + esc(sig.name) + ' · ' + esc(fmtDateTime(sig.at)) + '</span>'
      : '<span class="badge badge-warning"><i class="fa-regular fa-clock"></i> ' + label + ': pendente</span>';
  }

  function sheetTableHtml(snap) {
    var head = COLS.map(function (c) { return '<th>' + c.label + '</th>'; }).join("");
    var rows = snap.rows.map(function (r) {
      if (r.kind === "folga" || r.kind === "pend") {
        return '<tr><td class="text-num">' + esc(r.c[0]) + '</td><td colspan="9"><span class="badge ' + (r.kind === "folga" ? "badge-gray" : "badge-warning") + '">' + esc(r.c[1]) + '</span></td></tr>';
      }
      return '<tr>' + r.c.map(function (t, i) {
        return '<td' + (i === 9 ? '' : ' class="text-num"') + '>' + (t ? esc(t) : '') + '</td>';
      }).join("") + '</tr>';
    }).join("");
    var tot = snap.totals;
    return '<div class="table-wrap"><table class="data-table table-cards fp-table"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="fp-totals"><b>Total do período:</b> trabalhado ' + esc(tot.worked) + ' · extras ' + esc(tot.extra) + ' · faltantes ' + esc(tot.missing) + ' · <b>saldo ' + esc(tot.saldo) + '</b></div>' +
      (snap.note ? '<div class="small text-muted mt-8">' + esc(snap.note) + '</div>' : '');
  }

  // Modal com a folha (visão em tela + PDF) e botões de assinar.
  function openViewer(sheetId) {
    var sheet = global.DB.get(TABLE, sheetId);
    if (!sheet) return;
    var snap = sheet.snapshot;
    var st = STATUS_META[statusOf(sheet)] || {};
    var sigs = sheet.signatures || {};
    var intact = verifyIntegrity(sheet);
    var body =
      '<div class="fp-head">' +
        '<div><div class="font-bold" style="font-size:16px;">' + esc(snap.employeeName) + '</div>' +
        '<div class="small text-muted">' + esc(snap.employeeRole) + (snap.employeeRole ? ' · ' : '') + esc(snap.monthLabel) + ' · ' + esc(snap.scheduleText) + '</div></div>' +
        '<span class="badge ' + st.badge + '">' + st.label + '</span>' +
      '</div>' +
      '<div class="fp-sigs">' + sigChip(sigs.employee, "Funcionário") + ' ' + sigChip(sigs.manager, "Gerência") + '</div>' +
      (sheet.status === "cancelada" ? '<div class="fp-warn">Esta folha foi reaberta em ' + esc(fmtDateTime(sheet.cancelledAt)) + ' por ' + esc(sheet.cancelledByName || "-") + (sheet.cancelReason ? ' — ' + esc(sheet.cancelReason) : '') + '. As assinaturas dela não valem mais.</div>' : '') +
      (!intact ? '<div class="fp-warn">Atenção: o código de verificação não confere com o conteúdo desta folha.</div>' : '') +
      sheetTableHtml(snap) +
      '<div class="small text-muted mt-8">Código de verificação: <b>' + shortCode(sheet.hash) + '</b> · Publicada em ' + esc(fmtDateTime(sheet.publishedAt)) + ' por ' + esc(sheet.publishedByName || "-") + '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Fechar</button>' +
      '<button class="btn btn-outline" id="fp-pdf"><i class="fa-solid fa-file-pdf"></i> Baixar PDF</button>' +
      (canSignAsEmployee(sheet) ? '<button class="btn btn-primary" id="fp-sign-emp"><i class="fa-solid fa-signature"></i> Assinar</button>' : '') +
      (canSignAsManager(sheet) ? '<button class="btn btn-primary" id="fp-sign-mgr"><i class="fa-solid fa-signature"></i> Assinar pela Gerência</button>' : '');
    var box = global.Modal.open({ title: "Folha de Ponto — " + snap.monthLabel, bodyHtml: body, footHtml: foot, wide: true });
    box.querySelector("#fp-pdf").addEventListener("click", function () { downloadPdf(sheetId); });
    var be = box.querySelector("#fp-sign-emp");
    if (be) be.addEventListener("click", function () { openSignModal(sheetId, "employee"); });
    var bm = box.querySelector("#fp-sign-mgr");
    if (bm) bm.addEventListener("click", function () { openSignModal(sheetId, "manager"); });
  }

  function openSignModal(sheetId, role) {
    var sheet = global.DB.get(TABLE, sheetId);
    if (!sheet) return;
    var snap = sheet.snapshot;
    var u = currentUser();
    var body =
      '<p>Você está assinando a folha de ponto de <b>' + esc(snap.employeeName) + '</b> referente a <b>' + esc(snap.monthLabel) + '</b>.</p>' +
      '<div class="fp-sign-summary">' +
        '<div>Trabalhado: <b>' + esc(snap.totals.worked) + '</b></div>' +
        '<div>Extras: <b>' + esc(snap.totals.extra) + '</b> · Faltantes: <b>' + esc(snap.totals.missing) + '</b></div>' +
        '<div>Saldo do período: <b>' + esc(snap.totals.saldo) + '</b></div>' +
        '<div class="small text-muted">Código do documento: ' + shortCode(sheet.hash) + '</div>' +
      '</div>' +
      '<label class="fp-agree"><input type="checkbox" id="fp-agree"> ' +
        (role === "employee" ? 'Conferi os registros desta folha e estou de acordo.' : 'Conferi esta folha e confirmo, pela gerência, que os registros estão corretos.') + '</label>' +
      '<div class="small text-muted mt-8">Serão registrados: seu nome (' + esc(userName(u)) + '), data e hora, o aparelho usado e o código do documento.</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="fp-sign-go" disabled><i class="fa-solid fa-signature"></i> Assinar</button>';
    var box = global.Modal.open({ title: role === "employee" ? "Assinar minha folha de ponto" : "Assinar pela gerência", bodyHtml: body, footHtml: foot });
    var chk = box.querySelector("#fp-agree"), go = box.querySelector("#fp-sign-go");
    chk.addEventListener("change", function () { go.disabled = !chk.checked; });
    go.addEventListener("click", function () {
      go.disabled = true;
      sign(sheetId, role, function (ok, msg) {
        if (!ok) { global.Toast.show(msg || "Não foi possível assinar", "danger"); go.disabled = !chk.checked; return; }
        global.Modal.close();
        global.Toast.show("Folha assinada com sucesso", "success");
        var now = global.DB.get(TABLE, sheetId);
        if (statusOf(now) === "concluida") global.Toast.show("As duas assinaturas foram feitas — folha concluída.", "success");
      });
    });
  }

  function openCancelModal(sheetId) {
    var sheet = global.DB.get(TABLE, sheetId);
    if (!sheet) return;
    var sigCount = (sheet.signatures && sheet.signatures.employee ? 1 : 0) + (sheet.signatures && sheet.signatures.manager ? 1 : 0);
    var body =
      '<p>Reabrir a folha de <b>' + esc(sheet.employeeName) + '</b> (' + esc(sheet.monthLabel) + ') destrava o mês para ajustes.</p>' +
      (sigCount ? '<div class="fp-warn">Esta folha já tem ' + sigCount + ' assinatura(s). Elas deixam de valer (ficam guardadas só no histórico) e será preciso publicar e assinar de novo.</div>' : '') +
      '<div class="form-field full"><label>Motivo da reabertura</label><textarea id="fp-cancel-reason" rows="2" placeholder="Ex.: esqueci de lançar um atestado"></textarea></div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-danger" id="fp-cancel-go">Reabrir Folha</button>';
    var box = global.Modal.open({ title: "Reabrir folha de ponto", bodyHtml: body, footHtml: foot });
    box.querySelector("#fp-cancel-go").addEventListener("click", function () {
      var reason = box.querySelector("#fp-cancel-reason").value.trim();
      cancelSheet(sheetId, reason, function (ok, msg) {
        if (!ok) { global.Toast.show(msg, "danger"); return; }
        global.Modal.close();
        global.Toast.show("Folha reaberta — o mês está destravado", "success");
      });
    });
  }

  // Colaboradoras elegíveis para fechar um mês: ativas que batem ponto ou
  // que tenham lançamentos no mês.
  function eligibleForMonth(monthKey) {
    var range = global.PontoCalc.monthRange(monthKey + "-01");
    var ids = {};
    global.DB.all("timeClockEntries").forEach(function (t) { if (t.date >= range.start && t.date <= range.end) ids[t.employeeId] = true; });
    global.DB.all("employees").forEach(function (e) { if (e.status === "ativo" && e.requiresTimeClock) ids[e.id] = true; });
    return Object.keys(ids).map(function (id) { return global.DB.get("employees", id); }).filter(Boolean)
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function closedMonthOptions() {
    var out = [];
    var today = global.Utils.todayISO();
    for (var i = 1; i <= 12; i++) out.push(global.Utils.monthKey(global.Utils.addMonths(today, -i)));
    return out;
  }

  function openPublishModal() {
    if (!canPublish()) { global.Toast.show("Somente administradores podem fechar e publicar a folha.", "danger"); return; }
    var months = closedMonthOptions();
    var body =
      '<div class="form-field full"><label>Mês de referência</label><select id="fpp-month">' +
        months.map(function (m, idx) { return '<option value="' + m + '"' + (idx === 0 ? " selected" : "") + '>' + capFirst(global.PontoCalc.monthRange(m + "-01").label) + '</option>'; }).join("") +
      '</select></div>' +
      '<div id="fpp-list"></div>' +
      '<div class="fp-warn mt-8"><b>Ao publicar:</b> o mês fica TRAVADO (ninguém edita, exclui, lança ou ajusta saldo daquele mês) e a folha aparece no Bater Ponto de cada colaboradora para assinar. Para destravar depois é preciso "reabrir" a folha.</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="fpp-go"><i class="fa-solid fa-lock"></i> Fechar e Publicar</button>';
    var box = global.Modal.open({ title: "Fechar e Publicar Folha de Ponto", bodyHtml: body, footHtml: foot, wide: true });
    var sel = box.querySelector("#fpp-month");
    var list = box.querySelector("#fpp-list");

    function renderList() {
      var mk = sel.value;
      var emps = eligibleForMonth(mk);
      if (!emps.length) { list.innerHTML = '<div class="small text-muted">Nenhuma colaboradora com ponto neste mês.</div>'; return; }
      var range = global.PontoCalc.monthRange(mk + "-01");
      list.innerHTML = '<div class="fpp-rows">' + emps.map(function (e) {
        var ex = activeSheet(e.id, mk);
        var data = global.PontoCalc.espelho(e.id, range.start, range.end, e, global.DB.all("timeClockEntries"));
        var pend = data.totals.pendingDays || 0;
        var incomplete = data.days.filter(function (d) { return d.status === "incompleto" || d.status === "em_andamento"; }).length;
        var warn = [];
        if (pend) warn.push(pend + " dia(s) útil(eis) sem registro");
        if (incomplete) warn.push(incomplete + " dia(s) incompleto(s)");
        return '<label class="fpp-row' + (ex ? ' is-done' : '') + '">' +
          '<input type="checkbox" data-emp="' + e.id + '"' + (ex ? ' disabled' : ' checked') + '> ' +
          '<span class="fpp-name">' + esc(e.name) + '</span>' +
          (ex ? '<span class="badge badge-gray">Já publicada</span>' : '') +
          (warn.length ? '<span class="badge badge-warning" title="Resolva antes de publicar, se possível">' + esc(warn.join(" · ")) + '</span>' : '<span class="badge badge-success">Sem pendências</span>') +
          '<span class="small text-muted">saldo ' + esc(global.PontoCalc.fmtHM(data.totals.saldoMin)) + '</span>' +
        '</label>';
      }).join("") + '</div>';
    }
    sel.addEventListener("change", renderList);
    renderList();

    box.querySelector("#fpp-go").addEventListener("click", function () {
      var mk = sel.value;
      var ids = Array.prototype.slice.call(list.querySelectorAll("input[data-emp]:checked")).map(function (i) { return i.getAttribute("data-emp"); });
      if (!ids.length) { global.Toast.show("Selecione ao menos uma colaboradora", "danger"); return; }
      var btn = box.querySelector("#fpp-go");
      btn.disabled = true;
      var results = publishMany(ids, mk);
      var okList = results.filter(function (r) { return r.res.ok; });
      var bad = results.filter(function (r) { return !r.res.ok; });
      if (!okList.length) { global.Toast.show(bad[0].res.error, "danger"); btn.disabled = false; return; }
      // confirma que chegou ao servidor; se não chegou, desfaz (nunca travar o mês só no cache local)
      Promise.all(okList.map(function (r) { return global.DB.confirmSaved(TABLE, r.res.sheet.id).then(function (ok) { return { r: r, ok: ok }; }); })).then(function (conf) {
        var failed = conf.filter(function (c) { return !c.ok; });
        failed.forEach(function (c) { global.DB.remove(TABLE, c.r.res.sheet.id); });
        refreshAll();
        if (failed.length) {
          global.Toast.show(publishErrorTableMissing(), "danger");
          btn.disabled = false;
          return;
        }
        global.Modal.close();
        global.Toast.show(okList.length + " folha(s) publicada(s) — mês travado e disponível para assinatura", "success");
      });
    });
  }

  // ---------------------------------------------------------------
  // Painel da gestão (aba "Assinaturas")
  // ---------------------------------------------------------------
  var mgrState = { month: "", status: "", search: "" };

  function mountManagerPanel(el) {
    if (!el) return;
    function render() {
      var sheets = allSheets().slice().sort(function (a, b) { return (b.publishedAt || "").localeCompare(a.publishedAt || ""); });
      var months = {};
      sheets.forEach(function (s) { months[s.monthKey] = s.monthLabel; });
      var filtered = sheets.filter(function (s) {
        if (mgrState.month && s.monthKey !== mgrState.month) return false;
        if (mgrState.status && statusOf(s) !== mgrState.status) return false;
        if (mgrState.search && (s.employeeName || "").toLowerCase().indexOf(mgrState.search.toLowerCase()) === -1) return false;
        return true;
      });
      var pendMgr = sheets.filter(function (s) { return canSignAsManager(s); }).length;
      var missing = global.DB.optionalTableMissing && global.DB.optionalTableMissing(TABLE);

      var html =
        (missing ? '<div class="fp-warn mb-16">A tabela <b>timeSheets</b> ainda não existe no Supabase. Rode o SQL de criação (arquivo <b>supabase/timesheets.sql</b>) no SQL Editor do Supabase e recarregue esta página.</div>' : '') +
        '<div class="card"><div class="card-header"><h3>Folhas de Ponto para Assinatura</h3>' +
          '<div class="card-header-sub">Feche o mês, publique e acompanhe as duas assinaturas (colaboradora e gerência)</div></div>' +
        '<div class="card-body">' +
          '<div class="flex gap-12 mb-16" style="flex-wrap:wrap;align-items:flex-end;">' +
            (canPublish() ? '<button class="btn btn-primary" id="fp-publish"><i class="fa-solid fa-lock"></i> Fechar e Publicar Folha</button>' : '<span class="small text-muted">Somente administradores publicam folhas; gerentes e administradores assinam.</span>') +
            '<select id="fpm-month"><option value="">Todos os meses</option>' + Object.keys(months).sort().reverse().map(function (m) { return '<option value="' + m + '"' + (mgrState.month === m ? " selected" : "") + '>' + esc(months[m]) + '</option>'; }).join("") + '</select>' +
            '<select id="fpm-status"><option value="">Todas as situações</option>' + Object.keys(STATUS_META).map(function (k) { return '<option value="' + k + '"' + (mgrState.status === k ? " selected" : "") + '>' + STATUS_META[k].label + '</option>'; }).join("") + '</select>' +
            '<input type="search" id="fpm-search" placeholder="Buscar colaboradora" value="' + esc(mgrState.search) + '">' +
          '</div>' +
          (pendMgr ? '<div class="small mb-8"><b>' + pendMgr + '</b> folha(s) aguardando a assinatura da gerência.</div>' : '') +
          (filtered.length ? '<div class="table-wrap"><table class="data-table table-cards fp-list"><thead><tr><th>Colaboradora</th><th>Mês</th><th>Situação</th><th>Colaboradora assinou</th><th>Gerência assinou</th><th>Ações</th></tr></thead><tbody>' +
            filtered.map(function (s) {
              var st = STATUS_META[statusOf(s)] || {};
              var sg = s.signatures || {};
              var acts = '<button class="btn btn-outline btn-sm" data-fp-view="' + s.id + '"><i class="fa-solid fa-eye"></i> Ver</button> ' +
                '<button class="btn btn-outline btn-sm" data-fp-pdf="' + s.id + '"><i class="fa-solid fa-file-pdf"></i> PDF</button>' +
                (canSignAsManager(s) ? ' <button class="btn btn-primary btn-sm" data-fp-sign="' + s.id + '"><i class="fa-solid fa-signature"></i> Assinar</button>' : '') +
                (canPublish() && isActive(s) ? ' <button class="btn btn-secondary btn-sm" data-fp-cancel="' + s.id + '"><i class="fa-solid fa-lock-open"></i> Reabrir</button>' : '');
              return '<tr class="tc-row">' +
                '<td class="tc-title"><b>' + esc(s.employeeName) + '</b></td>' +
                '<td>' + esc(s.monthLabel) + '</td>' +
                '<td><span class="badge ' + st.badge + '">' + st.label + '</span></td>' +
                '<td>' + (sg.employee ? esc(fmtDateTime(sg.employee.at)) : '<span class="text-muted">pendente</span>') + '</td>' +
                '<td>' + (sg.manager ? esc(sg.manager.name) + '<div class="small text-muted">' + esc(fmtDateTime(sg.manager.at)) + '</div>' : '<span class="text-muted">pendente</span>') + '</td>' +
                '<td class="tc-actions">' + acts + '</td>' +
              '</tr>';
            }).join("") + '</tbody></table></div>'
            : '<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-file-signature"></i></div><h4>Nenhuma folha publicada ainda</h4><p class="small text-muted">Quando terminar os ajustes de um mês, use "Fechar e Publicar Folha".</p></div>') +
        '</div></div>';
      el.innerHTML = html;

      var pb = el.querySelector("#fp-publish");
      if (pb) pb.addEventListener("click", openPublishModal);
      el.querySelector("#fpm-month").addEventListener("change", function (ev) { mgrState.month = ev.target.value; render(); });
      el.querySelector("#fpm-status").addEventListener("change", function (ev) { mgrState.status = ev.target.value; render(); });
      el.querySelector("#fpm-search").addEventListener("input", global.Utils.debounce ? global.Utils.debounce(function (ev) { mgrState.search = ev.target.value; render(); var s = el.querySelector("#fpm-search"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 300) : function () {});
      Array.prototype.forEach.call(el.querySelectorAll("[data-fp-view]"), function (b) { b.addEventListener("click", function () { openViewer(b.getAttribute("data-fp-view")); }); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-fp-pdf]"), function (b) { b.addEventListener("click", function () { downloadPdf(b.getAttribute("data-fp-pdf")); }); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-fp-sign]"), function (b) { b.addEventListener("click", function () { openSignModal(b.getAttribute("data-fp-sign"), "manager"); }); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-fp-cancel]"), function (b) { b.addEventListener("click", function () { openCancelModal(b.getAttribute("data-fp-cancel")); }); });
    }
    refreshers.push(render);
    render();
    return render;
  }

  // ---------------------------------------------------------------
  // Painel da funcionária (aba "Folhas de Ponto" no Bater Ponto)
  // ---------------------------------------------------------------
  function mountEmployeePanel(el, employee, onChange) {
    if (!el || !employee) return;
    function render() {
      var sheets = sheetsOf(employee.id).filter(function (s) { return isActive(s); });
      var mine = myEmployeeId() === employee.id;
      var pend = sheets.filter(function (s) { return !(s.signatures && s.signatures.employee); });
      var done = sheets.filter(function (s) { return s.signatures && s.signatures.employee; });
      function card(s) {
        var st = STATUS_META[statusOf(s)] || {};
        var sg = s.signatures || {};
        var needs = !sg.employee;
        return '<div class="fp-card' + (needs ? ' needs-sign' : '') + '">' +
          '<div class="fp-card-top"><div class="font-bold">' + esc(s.monthLabel) + '</div><span class="badge ' + st.badge + '">' + st.label + '</span></div>' +
          '<div class="small text-muted">Saldo do período: <b>' + esc(s.snapshot.totals.saldo) + '</b> · Trabalhado ' + esc(s.snapshot.totals.worked) + '</div>' +
          '<div class="fp-sigs">' + sigChip(sg.employee, "Você") + ' ' + sigChip(sg.manager, "Gerência") + '</div>' +
          '<div class="fp-card-actions">' +
            '<button class="btn btn-outline btn-sm" data-fp-view="' + s.id + '"><i class="fa-solid fa-eye"></i> Ver folha</button> ' +
            '<button class="btn btn-outline btn-sm" data-fp-pdf="' + s.id + '"><i class="fa-solid fa-file-pdf"></i> PDF</button> ' +
            (needs && mine ? '<button class="btn btn-primary btn-sm" data-fp-sign="' + s.id + '"><i class="fa-solid fa-signature"></i> Assinar</button>' : '') +
          '</div></div>';
      }
      var html = '';
      if (!mine && sheets.length) {
        html += '<div class="fp-warn mb-8">Você pode consultar as folhas, mas só quem entrou com o próprio usuário consegue assinar. Entre com o seu usuário para assinar.</div>';
      }
      html += '<div class="ponto-day-card-title">Para assinar (' + pend.length + ')</div>' +
        (pend.length ? pend.map(card).join("") : '<div class="small text-muted mb-8">Nenhuma folha aguardando sua assinatura.</div>') +
        '<div class="ponto-day-card-title mt-8">Já assinadas (' + done.length + ')</div>' +
        (done.length ? done.map(card).join("") : '<div class="small text-muted">Você ainda não assinou nenhuma folha.</div>');
      el.innerHTML = html;
      Array.prototype.forEach.call(el.querySelectorAll("[data-fp-view]"), function (b) { b.addEventListener("click", function () { openViewer(b.getAttribute("data-fp-view")); }); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-fp-pdf]"), function (b) { b.addEventListener("click", function () { downloadPdf(b.getAttribute("data-fp-pdf")); }); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-fp-sign]"), function (b) { b.addEventListener("click", function () { openSignModal(b.getAttribute("data-fp-sign"), "employee"); }); });
      if (onChange) onChange();
    }
    var fn = function () {
      if (!document.body.contains(el)) return false; // painel antigo (a tela foi redesenhada): descarta
      render();
    };
    refreshers.push(fn);
    render();
  }

  global.FolhaPonto = {
    TABLE: TABLE,
    COLS: COLS,
    sha256Hex: sha256Hex,
    canonicalJson: canonicalJson,
    hashSnapshot: hashSnapshot,
    shortCode: shortCode,
    deviceLabel: deviceLabel,
    buildSnapshot: buildSnapshot,
    drawPdf: drawPdf,
    newDoc: newDoc,
    downloadPdf: downloadPdf,
    statusOf: statusOf,
    sheetsOf: sheetsOf,
    activeSheet: activeSheet,
    lockFor: lockFor,
    guard: guard,
    pendingForEmployee: pendingForEmployee,
    verifyIntegrity: verifyIntegrity,
    canPublish: canPublish,
    canSignAsEmployee: canSignAsEmployee,
    canSignAsManager: canSignAsManager,
    myEmployeeId: myEmployeeId,
    publishOne: publishOne,
    publishMany: publishMany,
    sign: sign,
    cancelSheet: cancelSheet,
    openViewer: openViewer,
    openPublishModal: openPublishModal,
    mountManagerPanel: mountManagerPanel,
    mountEmployeePanel: mountEmployeePanel,
    refresh: refreshAll
  };
})(window);
