/* ============================================================
   Salão ERP — Holerite: publicação e assinatura eletrônica (14/10/2026)

   Mesmo fluxo da Folha de Ponto (folha-ponto.js), aplicado ao holerite:
   1) A administração fecha os ajustes do mês em Folha de Pagamento e
      clica em "Publicar holerites para assinatura". O sistema TIRA UMA
      FOTO (snapshot) do holerite calculado — linhas, valores e bases —
      e grava na tabela "payslips" com um código de verificação (hash
      SHA-256). Daí em diante o holerite daquele mês NÃO muda mais por
      acidente: editar o salário ou os vales no cadastro não altera o
      documento publicado; para alterar é preciso "reabrir".
   2) O holerite aparece em Bater Ponto → aba "Holerites" da própria
      funcionária, que confere e assina.
   3) A administração assina pela gerência (Administrador/Desenvolvedor —
      o holerite é restrito). Qualquer ordem; com as 2 assinaturas fica
      CONCLUÍDO.
   4) Reabrir cancela o documento (assinaturas antigas ficam só no
      histórico) e libera o ajuste e uma nova publicação.

   Assinatura = aceite eletrônico simples com trilha de auditoria (quem,
   quando, aparelho e código do documento). Não é certificado ICP-Brasil.
   Reaproveita SHA-256, aparelho e vínculo usuário↔funcionária de
   folha-ponto.js (carregar folha-ponto.js antes deste arquivo).
   ============================================================ */
(function (global) {
  "use strict";

  var TABLE = "payslips";
  var MANAGER_ROLES = ["Administrador", "Desenvolvedor"];
  var TZ = "America/Sao_Paulo";

  // Dados do cabeçalho (iguais ao recibo de pagamento do contador).
  var COMPANY = { name: "GUITART & CO LTDA", cnpj: "61.794.868/0001-03", address: "RUA BUENOS AIRES 470", city: "GUARUJÁ - SP" };

  // ---------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------
  function FP() { return global.FolhaPonto || {}; }
  function esc(s) { return global.Utils.escapeHtml(s == null ? "" : String(s)); }
  function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function money(v) { return global.Utils.fmtMoney(v); }
  function br2(n) { return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDateTime(iso) {
    if (!iso) return "-";
    try { return new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " às"); }
    catch (e) { return String(iso); }
  }
  function currentUser() { return global.CurrentUser && global.CurrentUser.get ? global.CurrentUser.get() : null; }
  function userName(u) { return u ? ((u.firstName || "") + " " + (u.lastName || "")).trim() || "-" : "-"; }
  function hashSnapshot(snap) { return FP().sha256Hex(FP().canonicalJson(snap)); }
  function shortCode(hash) { return FP().shortCode(hash); }
  function myEmployeeId() { return FP().myEmployeeId ? FP().myEmployeeId() : null; }

  function canPublish() {
    var u = currentUser();
    return !!(u && MANAGER_ROLES.indexOf(u.role) !== -1);
  }

  // ---------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------
  function allSlips() { return global.DB.all(TABLE); }
  function isActive(s) { return !!s && s.status !== "cancelada"; }

  function statusOf(s) {
    if (!s) return "";
    if (s.status === "cancelada") return "cancelada";
    var sg = s.signatures || {};
    if (sg.manager && sg.employee) return "concluida";
    if (sg.manager || sg.employee) return "parcial";
    return "aguardando";
  }

  var STATUS_META = {
    aguardando: { label: "Aguardando assinaturas", badge: "badge-warning" },
    parcial: { label: "Falta 1 assinatura", badge: "badge-info" },
    concluida: { label: "Concluído", badge: "badge-success" },
    cancelada: { label: "Reaberto (cancelado)", badge: "badge-gray" }
  };

  function slipsOf(employeeId) {
    return allSlips().filter(function (s) { return s.employeeId === employeeId; })
      .sort(function (a, b) { return (b.monthKey || "").localeCompare(a.monthKey || "") || (b.publishedAt || "").localeCompare(a.publishedAt || ""); });
  }

  function activeSlip(employeeId, monthKey) {
    return allSlips().find(function (s) { return s.employeeId === employeeId && s.monthKey === monthKey && isActive(s); }) || null;
  }

  function pendingForEmployee(employeeId) {
    return slipsOf(employeeId).filter(function (s) { return isActive(s) && !(s.signatures && s.signatures.employee); });
  }

  function verifyIntegrity(s) { return !!s && !!s.snapshot && hashSnapshot(s.snapshot) === s.hash; }

  function canSignAsEmployee(s) {
    return isActive(s) && !(s.signatures && s.signatures.employee) && !!myEmployeeId() && myEmployeeId() === s.employeeId;
  }

  function canSignAsManager(s) {
    var u = currentUser();
    if (!u || MANAGER_ROLES.indexOf(u.role) === -1) return false;
    if (!isActive(s) || (s.signatures && s.signatures.manager)) return false;
    if (myEmployeeId() && myEmployeeId() === s.employeeId) return false; // ninguém assina pela gerência o próprio holerite
    return true;
  }

  // ---------------------------------------------------------------
  // Snapshot (o que vai para a tela, o PDF e o hash)
  // ---------------------------------------------------------------
  // slip: resultado de FolhaCalc.computePayslip. Só números já calculados entram no
  // documento — a conta nunca é refeita na hora de assinar.
  function buildSnapshot(emp, monthKey, slip, meta) {
    meta = meta || {};
    var cfg = emp.payroll || {};
    var lines = [];
    slip.earnings.forEach(function (e) { lines.push({ num: e.num, label: e.label, ref: e.ref === "" || e.ref == null ? "" : br2(e.ref), earn: e.amount, ded: 0 }); });
    slip.deductions.forEach(function (d) { lines.push({ num: d.num, label: d.label, ref: d.ref === "" || d.ref == null ? "" : br2(d.ref), earn: 0, ded: d.amount }); });
    lines.sort(function (a, b) { return a.num - b.num; });
    var label = capFirst(global.PontoCalc.monthRange(monthKey + "-01").label);
    var b = slip.bases || {};
    return {
      v: 1,
      kind: "holerite",
      company: { name: COMPANY.name, cnpj: COMPANY.cnpj, address: COMPANY.address, city: COMPANY.city },
      employee: {
        id: emp.id,
        name: String(emp.name || "").toUpperCase(),
        code: cfg.code != null ? String(cfg.code) : "",
        role: String(cfg.cargo || emp.role || "").toUpperCase(),
        cbo: cfg.cbo != null ? String(cfg.cbo) : "",
        hireDate: emp.hireDate || ""
      },
      monthKey: monthKey,
      monthLabel: label,
      lines: lines,
      totals: { earnings: slip.totalEarnings, deductions: slip.totalDeductions, net: slip.net },
      bases: { salary: b.salary || 0, inss: b.inss || 0, fgts: b.fgts || 0, fgtsValue: b.fgtsValue || 0, irrf: b.irrf || 0, irrfBand: b.irrfBand || "" },
      regime: slip.regime,
      generatedAt: meta.generatedAt || new Date().toISOString(),
      generatedBy: meta.generatedBy || ""
    };
  }

  // ---------------------------------------------------------------
  // Tela do holerite (igual ao recibo do contador)
  // ---------------------------------------------------------------
  function slipTableHtml(snap) {
    var rows = snap.lines.map(function (l) {
      return '<tr><td class="text-num">' + esc(l.num) + '</td><td>' + esc(l.label) + '</td><td class="text-num">' + esc(l.ref) + '</td>' +
        '<td class="text-num">' + (l.earn ? esc(br2(l.earn)) : '') + '</td><td class="text-num">' + (l.ded ? esc(br2(l.ded)) : '') + '</td></tr>';
    }).join("");
    var e = snap.employee, t = snap.totals, b = snap.bases;
    return '<div class="small text-muted mb-8">' + esc(snap.company.name) + ' · CNPJ ' + esc(snap.company.cnpj) + ' · ' + esc(snap.company.address) + ' — ' + esc(snap.company.city) + '</div>' +
      '<div class="small mb-8"><b>' + esc(e.name) + '</b>' + (e.role ? ' · ' + esc(e.role) : '') + (e.cbo ? ' · CBO ' + esc(e.cbo) : '') + (e.hireDate ? ' · Admissão ' + esc(global.Utils.fmtDate(e.hireDate)) : '') + '</div>' +
      '<div class="table-wrap"><table class="data-table fp-table"><thead><tr><th>Cód.</th><th>Descrição</th><th>Referência</th><th>Vencimentos</th><th>Descontos</th></tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr class="ponto-espelho-totals"><td colspan="3">Totais</td><td class="text-num">' + esc(br2(t.earnings)) + '</td><td class="text-num">' + esc(br2(t.deductions)) + '</td></tr>' +
      '<tr class="ponto-espelho-totals"><td colspan="3">Total líquido</td><td colspan="2" class="text-num ' + (t.net < 0 ? "text-danger" : "text-success") + '">' + esc(money(t.net)) + '</td></tr></tfoot></table></div>' +
      '<div class="fp-totals">Salário base: <b>' + esc(br2(b.salary)) + '</b> · Base INSS: <b>' + esc(br2(b.inss)) + '</b> · Base FGTS: <b>' + esc(br2(b.fgts)) + '</b> · FGTS do mês (depósito da empresa): <b>' + esc(br2(b.fgtsValue)) + '</b> · Base IRRF: <b>' + esc(br2(b.irrf)) + '</b> · Faixa IRRF: <b>' + esc(b.irrfBand || '-') + '</b></div>';
  }

  // ---------------------------------------------------------------
  // PDF (A4 retrato, no formato do recibo do contador)
  // ---------------------------------------------------------------
  function drawPdf(doc, items) {
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var mx = 40, end = W - mx;
    items.forEach(function (item, idx) {
      var snap = item.snap, slip = item.slip || null;
      if (idx > 0) doc.addPage();
      var y = 44;
      doc.setTextColor(0); doc.setDrawColor(0);
      // cabeçalho
      doc.setLineWidth(0.8); doc.rect(mx, y - 16, end - mx, 66);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.text(snap.company.name, mx + 8, y + 2);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(snap.company.address, mx + 8, y + 15);
      doc.text("CNPJ " + snap.company.cnpj, mx + 8, y + 28);
      doc.text(snap.company.city, mx + 8, y + 41);
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text("RECIBO DE PAGAMENTO", end - 8, y + 2, { align: "right" });
      doc.setFontSize(10); doc.text("MENSAL", end - 8, y + 18, { align: "right" });
      doc.text(snap.monthLabel, end - 8, y + 33, { align: "right" });
      y += 66;
      // funcionário
      doc.setLineWidth(0.5); doc.rect(mx, y - 16, end - mx, 48);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text("Código", mx + 8, y - 5); doc.text("Nome", mx + 60, y - 5); doc.text("CBO", mx + 320, y - 5); doc.text("Admissão", mx + 410, y - 5);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.text(snap.employee.code || "-", mx + 8, y + 9);
      doc.text(snap.employee.name, mx + 60, y + 9, { maxWidth: 255 });
      if (snap.employee.role) { doc.setFontSize(9); doc.text(snap.employee.role, mx + 60, y + 22, { maxWidth: 255 }); doc.setFontSize(10); }
      doc.text(snap.employee.cbo || "-", mx + 320, y + 9);
      doc.text(snap.employee.hireDate ? global.Utils.fmtDate(snap.employee.hireDate) : "-", mx + 410, y + 9);
      y += 50;
      // linhas
      var cNum = mx + 6, cDesc = mx + 50, cRef = mx + 300, cVen = end - 100, cDes = end - 6;
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text("Cód.", cNum, y); doc.text("Descrição", cDesc, y); doc.text("Referência", cRef, y, { align: "right" });
      doc.text("Vencimentos", cVen, y, { align: "right" }); doc.text("Descontos", cDes, y, { align: "right" });
      y += 5; doc.setLineWidth(0.6); doc.line(mx, y, end, y); y += 14;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      snap.lines.forEach(function (l) {
        doc.text(String(l.num), cNum, y); doc.text(l.label, cDesc, y, { maxWidth: 240 });
        if (l.ref) doc.text(l.ref, cRef, y, { align: "right" });
        if (l.earn) doc.text(br2(l.earn), cVen, y, { align: "right" });
        if (l.ded) doc.text(br2(l.ded), cDes, y, { align: "right" });
        y += 15;
      });
      y = Math.max(y + 10, 300);
      // totais
      doc.setLineWidth(0.6); doc.line(mx, y, end, y); y += 14;
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text("Total Vencimentos", cVen, y, { align: "right" }); doc.text("Total Descontos", cDes, y, { align: "right" }); y += 13;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.text(br2(snap.totals.earnings), cVen, y, { align: "right" }); doc.text(br2(snap.totals.deductions), cDes, y, { align: "right" }); y += 15;
      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.text("Total Líquido -->  " + br2(snap.totals.net), cDes, y, { align: "right" }); y += 12;
      doc.setLineWidth(0.5); doc.line(mx, y, end, y); y += 13;
      var b = snap.bases, bx = [mx + 8, mx + 92, mx + 178, mx + 280, mx + 358];
      var lab = ["Salário Base", "Sal.Contr.INSS", "Base Cálculo FGTS", "FGTS do MÊS", "Base Cálculo IRRF"], val = [br2(b.salary), br2(b.inss), br2(b.fgts), br2(b.fgtsValue), br2(b.irrf)];
      doc.setFontSize(8);
      for (var i = 0; i < 5; i++) { doc.setFont("helvetica", "bold"); doc.text(lab[i], bx[i], y); doc.setFont("helvetica", "normal"); doc.text(val[i], bx[i], y + 11); }
      doc.setFont("helvetica", "bold"); doc.text("Faixa IRRF", end - 8, y, { align: "right" });
      doc.setFont("helvetica", "normal"); doc.text(b.irrfBand || "-", end - 8, y + 11, { align: "right" });
      y += 24; doc.line(mx, y, end, y);
      // assinaturas
      y += 70;
      var sigs = (slip && slip.signatures) || {};
      function box(x, w, title, sig) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(9);
        if (sig) {
          doc.setFont("helvetica", "bold"); doc.text("Assinado eletronicamente", x, y - 34);
          doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
          doc.text(sig.name + " (" + sig.roleLabel + ")", x, y - 22, { maxWidth: w });
          doc.text(fmtDateTime(sig.at), x, y - 10, { maxWidth: w });
        } else if (slip) {
          doc.setTextColor(150, 90, 0); doc.text("Assinatura pendente", x, y - 10); doc.setTextColor(0);
        }
        doc.setFontSize(9); doc.setLineWidth(0.6); doc.line(x, y, x + w, y); doc.text(title, x, y + 12);
      }
      box(mx, 230, "Assinatura do Funcionário", sigs.employee);
      box(end - 230, 230, "Assinatura do Responsável (Gerência)", sigs.manager);
      if (slip) {
        y += 34;
        doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.text("Registro de assinatura eletrônica", mx, y);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); y += 11;
        doc.text("Publicado em " + fmtDateTime(slip.publishedAt) + " por " + (slip.publishedByName || "-") + " · Código de verificação: " + shortCode(slip.hash), mx, y, { maxWidth: end - mx }); y += 11;
        doc.text("Documento (SHA-256): " + slip.hash, mx, y, { maxWidth: end - mx });
        [["Funcionário", sigs.employee], ["Gerência", sigs.manager]].forEach(function (p) {
          y += 11; var sg = p[1];
          doc.text(p[0] + ": " + (sg ? sg.name + " — " + fmtDateTime(sg.at) + " — " + sg.device + " — documento " + shortCode(sg.hash) : "aguardando assinatura"), mx, y, { maxWidth: end - mx });
        });
        y += 11; doc.text("Assinatura eletrônica simples (aceite com identificação do usuário, data/hora, aparelho e código do documento).", mx, y, { maxWidth: end - mx });
      }
      doc.setFontSize(7.5); doc.setTextColor(110);
      doc.text("Guitart & Co. · " + snap.employee.name + " · " + snap.monthLabel + (slip ? " · Cód. " + shortCode(slip.hash) : " · documento sem assinatura (conferência)"), mx, H - 22);
      doc.setTextColor(0);
    });
  }

  function newDoc() {
    var Ctor = global.jspdf && global.jspdf.jsPDF;
    return Ctor ? new Ctor({ unit: "pt", format: "a4" }) : null;
  }

  function pdfFileName(s) {
    return "holerite_" + global.Utils.slugify((s.employeeName || "funcionario")) + "_" + s.monthKey + (statusOf(s) === "concluida" ? "_assinado" : "") + ".pdf";
  }

  function downloadPdf(id) {
    var s = global.DB.get(TABLE, id);
    if (!s) return;
    var doc = newDoc();
    if (!doc) { global.Toast.show("Não foi possível carregar a biblioteca de PDF — verifique sua conexão e tente novamente", "danger"); return; }
    drawPdf(doc, [{ snap: s.snapshot, slip: s }]);
    doc.save(pdfFileName(s));
  }

  // ---------------------------------------------------------------
  // Operações: publicar, assinar, reabrir
  // ---------------------------------------------------------------
  function isMonthClosed(monthKey) { return monthKey < global.Utils.monthKey(global.Utils.todayISO()); }

  // Publica (e trava) o holerite de UM funcionário. `slip` = FolhaCalc.computePayslip(...).
  function publishOne(emp, monthKey, slip) {
    if (!canPublish()) return { ok: false, error: "Somente administradores podem publicar holerites." };
    if (!isMonthClosed(monthKey)) return { ok: false, error: "O mês ainda não terminou — só dá para publicar holerites de meses encerrados." };
    if (activeSlip(emp.id, monthKey)) return { ok: false, error: "Já existe um holerite publicado deste mês para " + emp.name + "." };
    if (!slip) return { ok: false, error: "Holerite não calculado." };
    var u = currentUser();
    var now = new Date().toISOString();
    var snap = buildSnapshot(emp, monthKey, slip, { generatedAt: now, generatedBy: userName(u) });
    var rec = global.DB.insert(TABLE, {
      employeeId: emp.id,
      employeeName: emp.name,
      monthKey: monthKey,
      monthLabel: snap.monthLabel,
      netValue: slip.net,
      snapshot: snap,
      hash: hashSnapshot(snap),
      status: "publicada",
      publishedAt: now,
      publishedById: u ? u.id : null,
      publishedByName: userName(u),
      signatures: { manager: null, employee: null },
      history: [{ at: now, by: userName(u), action: "publicada", note: "" }]
    });
    return { ok: true, slip: rec };
  }

  // entries: [{ emp, slip }]
  function publishMany(entries, monthKey) {
    var results = entries.map(function (x) { return { emp: x.emp, res: publishOne(x.emp, monthKey, x.slip) }; });
    var okList = results.filter(function (r) { return r.res.ok; });
    if (okList.length) global.DB.log("Folha", "Publicou o holerite de " + okList.map(function (r) { return r.emp.name; }).join(", ") + " (ref. " + okList[0].res.slip.monthLabel + ") para assinatura");
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
      device: FP().deviceLabel ? FP().deviceLabel(ua) : "Aparelho não identificado",
      userAgent: ua.slice(0, 220)
    };
  }

  function sign(id, role, cb) {
    cb = cb || function () {};
    var local = global.DB.get(TABLE, id);
    if (!local) { cb(false, "Holerite não encontrado."); return; }
    global.DB.fetchFresh(TABLE, id).then(function (fresh) {
      var s = fresh || local;
      if (!isActive(s)) { cb(false, "Este holerite foi reaberto/cancelado — atualize a tela."); return; }
      if (!verifyIntegrity(s)) { cb(false, "O código de verificação do holerite não confere — assinatura bloqueada. Avise a administração."); return; }
      if (role === "employee" && !canSignAsEmployee(s)) { cb(false, "Só a própria funcionária, entrando com o seu usuário, pode assinar este holerite."); return; }
      if (role === "manager" && !canSignAsManager(s)) { cb(false, "Seu usuário não pode assinar pela gerência este holerite."); return; }
      if (s.signatures && s.signatures[role]) { cb(false, "Esta parte já foi assinada."); return; }
      var sig = signatureRecord(role);
      sig.hash = s.hash;
      global.DB.mergeRecordUpdate(TABLE, id, function (cur) {
        var sigs = Object.assign({ manager: null, employee: null }, cur.signatures || {});
        if (!sigs[role]) sigs[role] = sig;
        var hist = (cur.history || []).concat([{ at: sig.at, by: sig.name, action: "assinou_" + role, note: sig.device }]);
        return { signatures: sigs, history: hist };
      });
      global.DB.log("Folha", sig.name + " assinou o holerite de " + s.employeeName + " (" + s.monthLabel + ") como " + (role === "employee" ? "funcionário" : "gerência"));
      refreshAll();
      cb(true, "");
    });
  }

  function cancelSlip(id, reason, cb) {
    cb = cb || function () {};
    if (!canPublish()) { cb(false, "Somente administradores podem reabrir o holerite."); return; }
    var s = global.DB.get(TABLE, id);
    if (!s || !isActive(s)) { cb(false, "Holerite não encontrado ou já reaberto."); return; }
    var u = currentUser();
    var now = new Date().toISOString();
    global.DB.mergeRecordUpdate(TABLE, id, function (cur) {
      return {
        status: "cancelada", cancelledAt: now, cancelledByName: userName(u), cancelReason: reason || "",
        history: (cur.history || []).concat([{ at: now, by: userName(u), action: "reaberto", note: reason || "" }])
      };
    });
    global.DB.log("Folha", "Reabriu o holerite de " + s.employeeName + " (" + s.monthLabel + ")" + (reason ? " — motivo: " + reason : "") + "; assinaturas anteriores canceladas");
    refreshAll();
    cb(true, "");
  }

  // ---------------------------------------------------------------
  // Telas
  // ---------------------------------------------------------------
  var refreshers = [], listeners = [];
  function refreshAll() {
    refreshers = refreshers.filter(function (fn) { try { return fn() !== false; } catch (e) { return true; } });
    listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignora */ } });
  }
  // Outras telas (ex.: tabela da Folha de Pagamento) pedem aviso quando um holerite muda de estado.
  function onChange(fn) { listeners.push(fn); }

  function sigChip(sig, label) {
    return sig
      ? '<span class="badge badge-success" title="' + esc(sig.device) + '"><i class="fa-solid fa-signature"></i> ' + label + ': ' + esc(sig.name) + ' · ' + esc(fmtDateTime(sig.at)) + '</span>'
      : '<span class="badge badge-warning"><i class="fa-regular fa-clock"></i> ' + label + ': pendente</span>';
  }

  function openViewer(id) {
    var s = global.DB.get(TABLE, id);
    if (!s) return;
    var snap = s.snapshot;
    var st = STATUS_META[statusOf(s)] || {};
    var sg = s.signatures || {};
    var body =
      '<div class="fp-head"><div><div class="font-bold" style="font-size:16px;">' + esc(snap.employee.name) + '</div>' +
      '<div class="small text-muted">Holerite · ' + esc(snap.monthLabel) + '</div></div><span class="badge ' + st.badge + '">' + st.label + '</span></div>' +
      '<div class="fp-sigs">' + sigChip(sg.employee, "Funcionário") + ' ' + sigChip(sg.manager, "Gerência") + '</div>' +
      (s.status === "cancelada" ? '<div class="fp-warn">Este holerite foi reaberto em ' + esc(fmtDateTime(s.cancelledAt)) + ' por ' + esc(s.cancelledByName || "-") + (s.cancelReason ? ' — ' + esc(s.cancelReason) : '') + '. As assinaturas dele não valem mais.</div>' : '') +
      (!verifyIntegrity(s) ? '<div class="fp-warn">Atenção: o código de verificação não confere com o conteúdo deste holerite.</div>' : '') +
      slipTableHtml(snap) +
      '<div class="small text-muted mt-8">Código de verificação: <b>' + shortCode(s.hash) + '</b> · Publicado em ' + esc(fmtDateTime(s.publishedAt)) + ' por ' + esc(s.publishedByName || "-") + '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Fechar</button>' +
      '<button class="btn btn-outline" id="hl-pdf"><i class="fa-solid fa-file-pdf"></i> Baixar PDF</button>' +
      (canSignAsEmployee(s) ? '<button class="btn btn-primary" id="hl-sign-emp"><i class="fa-solid fa-signature"></i> Assinar</button>' : '') +
      (canSignAsManager(s) ? '<button class="btn btn-primary" id="hl-sign-mgr"><i class="fa-solid fa-signature"></i> Assinar pela Gerência</button>' : '');
    var box = global.Modal.open({ title: "Holerite — " + snap.monthLabel, bodyHtml: body, footHtml: foot, wide: true });
    box.querySelector("#hl-pdf").addEventListener("click", function () { downloadPdf(id); });
    var be = box.querySelector("#hl-sign-emp"); if (be) be.addEventListener("click", function () { openSignModal(id, "employee"); });
    var bm = box.querySelector("#hl-sign-mgr"); if (bm) bm.addEventListener("click", function () { openSignModal(id, "manager"); });
  }

  function openSignModal(id, role) {
    var s = global.DB.get(TABLE, id);
    if (!s) return;
    var snap = s.snapshot, u = currentUser();
    var body =
      '<p>Você está assinando o holerite de <b>' + esc(snap.employee.name) + '</b> referente a <b>' + esc(snap.monthLabel) + '</b>.</p>' +
      '<div class="fp-sign-summary"><div>Total de vencimentos: <b>' + esc(money(snap.totals.earnings)) + '</b></div>' +
      '<div>Total de descontos: <b>' + esc(money(snap.totals.deductions)) + '</b></div>' +
      '<div>Líquido: <b>' + esc(money(snap.totals.net)) + '</b></div>' +
      '<div class="small text-muted">Código do documento: ' + shortCode(s.hash) + '</div></div>' +
      '<label class="fp-agree"><input type="checkbox" id="hl-agree"> ' +
        (role === "employee" ? 'Conferi os valores deste holerite e estou de acordo.' : 'Conferi este holerite e confirmo, pela gerência, que os valores estão corretos.') + '</label>' +
      '<div class="small text-muted mt-8">Serão registrados: seu nome (' + esc(userName(u)) + '), data e hora, o aparelho usado e o código do documento.</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="hl-sign-go" disabled><i class="fa-solid fa-signature"></i> Assinar</button>';
    var box = global.Modal.open({ title: role === "employee" ? "Assinar meu holerite" : "Assinar pela gerência", bodyHtml: body, footHtml: foot });
    var chk = box.querySelector("#hl-agree"), go = box.querySelector("#hl-sign-go");
    chk.addEventListener("change", function () { go.disabled = !chk.checked; });
    go.addEventListener("click", function () {
      go.disabled = true;
      sign(id, role, function (ok, msg) {
        if (!ok) { global.Toast.show(msg || "Não foi possível assinar", "danger"); go.disabled = !chk.checked; return; }
        global.Modal.close();
        global.Toast.show("Holerite assinado com sucesso", "success");
        if (statusOf(global.DB.get(TABLE, id)) === "concluida") global.Toast.show("As duas assinaturas foram feitas — holerite concluído.", "success");
      });
    });
  }

  function openCancelModal(id) {
    var s = global.DB.get(TABLE, id);
    if (!s) return;
    var n = (s.signatures && s.signatures.employee ? 1 : 0) + (s.signatures && s.signatures.manager ? 1 : 0);
    var body =
      '<p>Reabrir o holerite de <b>' + esc(s.employeeName) + '</b> (' + esc(s.monthLabel) + ') libera os ajustes do mês na Folha de Pagamento.</p>' +
      (n ? '<div class="fp-warn">Este holerite já tem ' + n + ' assinatura(s). Elas deixam de valer (ficam guardadas só no histórico) e será preciso publicar e assinar de novo.</div>' : '') +
      '<div class="form-field full"><label>Motivo da reabertura</label><textarea id="hl-cancel-reason" rows="2" placeholder="Ex.: ajuste de vale"></textarea></div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-danger" id="hl-cancel-go">Reabrir Holerite</button>';
    var box = global.Modal.open({ title: "Reabrir holerite", bodyHtml: body, footHtml: foot });
    box.querySelector("#hl-cancel-go").addEventListener("click", function () {
      cancelSlip(id, box.querySelector("#hl-cancel-reason").value.trim(), function (ok, msg) {
        if (!ok) { global.Toast.show(msg, "danger"); return; }
        global.Modal.close();
        global.Toast.show("Holerite reaberto — o mês está liberado para ajustes", "success");
      });
    });
  }

  // Painel da funcionária (aba "Holerites" no Bater Ponto)
  function mountEmployeePanel(el, employee, onChange) {
    if (!el || !employee) return;
    function render() {
      var slips = slipsOf(employee.id).filter(isActive);
      var mine = myEmployeeId() === employee.id;
      var pend = slips.filter(function (s) { return !(s.signatures && s.signatures.employee); });
      var done = slips.filter(function (s) { return s.signatures && s.signatures.employee; });
      function card(s) {
        var st = STATUS_META[statusOf(s)] || {}, sg = s.signatures || {}, needs = !sg.employee;
        return '<div class="fp-card' + (needs ? ' needs-sign' : '') + '">' +
          '<div class="fp-card-top"><div class="font-bold">' + esc(s.monthLabel) + '</div><span class="badge ' + st.badge + '">' + st.label + '</span></div>' +
          '<div class="small text-muted">Líquido: <b>' + esc(money(s.snapshot.totals.net)) + '</b> · Vencimentos ' + esc(money(s.snapshot.totals.earnings)) + ' · Descontos ' + esc(money(s.snapshot.totals.deductions)) + '</div>' +
          '<div class="fp-sigs">' + sigChip(sg.employee, "Você") + ' ' + sigChip(sg.manager, "Gerência") + '</div>' +
          '<div class="fp-card-actions">' +
            '<button class="btn btn-outline btn-sm" data-hl-view="' + s.id + '"><i class="fa-solid fa-eye"></i> Ver holerite</button> ' +
            '<button class="btn btn-outline btn-sm" data-hl-pdf="' + s.id + '"><i class="fa-solid fa-file-pdf"></i> PDF</button> ' +
            (needs && mine ? '<button class="btn btn-primary btn-sm" data-hl-sign="' + s.id + '"><i class="fa-solid fa-signature"></i> Assinar</button>' : '') +
          '</div></div>';
      }
      var html = '';
      if (!mine && slips.length) html += '<div class="fp-warn mb-8">Você pode consultar os holerites, mas só quem entrou com o próprio usuário consegue assinar. Entre com o seu usuário para assinar.</div>';
      html += '<div class="ponto-day-card-title">Para assinar (' + pend.length + ')</div>' +
        (pend.length ? pend.map(card).join("") : '<div class="small text-muted mb-8">Nenhum holerite aguardando sua assinatura.</div>') +
        '<div class="ponto-day-card-title mt-8">Já assinados (' + done.length + ')</div>' +
        (done.length ? done.map(card).join("") : '<div class="small text-muted">Você ainda não assinou nenhum holerite.</div>');
      el.innerHTML = html;
      Array.prototype.forEach.call(el.querySelectorAll("[data-hl-view]"), function (b) { b.addEventListener("click", function () { openViewer(b.getAttribute("data-hl-view")); }); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-hl-pdf]"), function (b) { b.addEventListener("click", function () { downloadPdf(b.getAttribute("data-hl-pdf")); }); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-hl-sign]"), function (b) { b.addEventListener("click", function () { openSignModal(b.getAttribute("data-hl-sign"), "employee"); }); });
      if (onChange) onChange();
    }
    refreshers.push(function () { if (!document.body.contains(el)) return false; render(); });
    render();
  }

  // Painel da administração (dentro de Folha de Pagamento).
  // opts: { getMonth(): "AAAA-MM", employees(): [emp], slipFor(emp): resultado do FolhaCalc }
  function mountManagerPanel(el, opts) {
    if (!el) return;
    function render() {
      var slips = allSlips().slice().sort(function (a, b) { return (b.publishedAt || "").localeCompare(a.publishedAt || ""); });
      var missing = global.DB.optionalTableMissing && global.DB.optionalTableMissing(TABLE);
      var mk = opts.getMonth();
      var pendMgr = slips.filter(canSignAsManager).length;
      var html =
        (missing ? '<div class="fp-warn mb-16">A tabela <b>payslips</b> ainda não existe no Supabase. Rode o SQL de criação (arquivo <b>supabase/payslips.sql</b>) no SQL Editor do Supabase e recarregue esta página.</div>' : '') +
        '<div class="card"><div class="card-header"><h3>Holerites para Assinatura</h3>' +
        '<div class="card-header-sub">Publique o holerite do mês e acompanhe as assinaturas (funcionária e gerência)</div></div><div class="card-body">' +
        '<div class="flex gap-12 mb-16" style="flex-wrap:wrap;align-items:center;">' +
          (canPublish() ? '<button class="btn btn-primary" id="hl-publish"><i class="fa-solid fa-lock"></i> Publicar holerites de ' + esc(capFirst(global.PontoCalc.monthRange(mk + "-01").label)) + '</button>' : '') +
          '<span class="small text-muted">Ao publicar, o holerite daquele mês deixa de ser editável (só reabrindo).</span></div>' +
        (pendMgr ? '<div class="small mb-8"><b>' + pendMgr + '</b> holerite(s) aguardando a assinatura da gerência.</div>' : '') +
        (slips.length ? '<div class="table-wrap"><table class="data-table table-cards fp-list"><thead><tr><th>Funcionária</th><th>Mês</th><th>Líquido</th><th>Situação</th><th>Funcionária assinou</th><th>Gerência assinou</th><th>Ações</th></tr></thead><tbody>' +
          slips.map(function (s) {
            var st = STATUS_META[statusOf(s)] || {}, sg = s.signatures || {};
            var acts = '<button class="btn btn-outline btn-sm" data-hl-view="' + s.id + '"><i class="fa-solid fa-eye"></i> Ver</button> ' +
              '<button class="btn btn-outline btn-sm" data-hl-pdf="' + s.id + '"><i class="fa-solid fa-file-pdf"></i> PDF</button>' +
              (canSignAsManager(s) ? ' <button class="btn btn-primary btn-sm" data-hl-sign="' + s.id + '"><i class="fa-solid fa-signature"></i> Assinar</button>' : '') +
              (canPublish() && isActive(s) ? ' <button class="btn btn-secondary btn-sm" data-hl-cancel="' + s.id + '"><i class="fa-solid fa-lock-open"></i> Reabrir</button>' : '');
            return '<tr class="tc-row"><td class="tc-title"><b>' + esc(s.employeeName) + '</b></td><td>' + esc(s.monthLabel) + '</td>' +
              '<td class="text-num">' + esc(money(s.snapshot.totals.net)) + '</td>' +
              '<td><span class="badge ' + st.badge + '">' + st.label + '</span></td>' +
              '<td>' + (sg.employee ? esc(fmtDateTime(sg.employee.at)) : '<span class="text-muted">pendente</span>') + '</td>' +
              '<td>' + (sg.manager ? esc(sg.manager.name) + '<div class="small text-muted">' + esc(fmtDateTime(sg.manager.at)) + '</div>' : '<span class="text-muted">pendente</span>') + '</td>' +
              '<td class="tc-actions">' + acts + '</td></tr>';
          }).join("") + '</tbody></table></div>'
          : '<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-file-signature"></i></div><h4>Nenhum holerite publicado ainda</h4><p class="small text-muted">Confira os valores acima e use "Publicar holerites".</p></div>') +
        '</div></div>';
      el.innerHTML = html;
      var pb = el.querySelector("#hl-publish"); if (pb) pb.addEventListener("click", function () { openPublishModal(opts); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-hl-view]"), function (b) { b.addEventListener("click", function () { openViewer(b.getAttribute("data-hl-view")); }); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-hl-pdf]"), function (b) { b.addEventListener("click", function () { downloadPdf(b.getAttribute("data-hl-pdf")); }); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-hl-sign]"), function (b) { b.addEventListener("click", function () { openSignModal(b.getAttribute("data-hl-sign"), "manager"); }); });
      Array.prototype.forEach.call(el.querySelectorAll("[data-hl-cancel]"), function (b) { b.addEventListener("click", function () { openCancelModal(b.getAttribute("data-hl-cancel")); }); });
    }
    refreshers.push(function () { if (!document.body.contains(el)) return false; render(); });
    render();
    return render;
  }

  function openPublishModal(opts) {
    if (!canPublish()) { global.Toast.show("Somente administradores podem publicar holerites.", "danger"); return; }
    var mk = opts.getMonth();
    if (!isMonthClosed(mk)) { global.Toast.show("O mês ainda não terminou — só dá para publicar holerites de meses encerrados.", "danger"); return; }
    var emps = opts.employees();
    var label = capFirst(global.PontoCalc.monthRange(mk + "-01").label);
    var rows = emps.map(function (e) {
      var ex = activeSlip(e.id, mk), sl = opts.slipFor(e);
      return '<label class="fpp-row' + (ex ? ' is-done' : '') + '"><input type="checkbox" data-emp="' + e.id + '"' + (ex ? ' disabled' : ' checked') + '> ' +
        '<span class="fpp-name">' + esc(e.name) + '</span>' + (ex ? '<span class="badge badge-gray">Já publicado</span>' : '') +
        '<span class="small text-muted">líquido ' + esc(money(sl.net)) + '</span>' +
        (sl.warnings.length ? '<span class="badge badge-warning">' + esc(sl.warnings.join(" ")) + '</span>' : '') + '</label>';
    }).join("");
    var body = '<p>Publicar os holerites de <b>' + esc(label) + '</b> para assinatura?</p><div class="fpp-rows">' + rows + '</div>' +
      '<div class="fp-warn mt-8"><b>Ao publicar:</b> o holerite de cada pessoa fica TRAVADO (salário, vales e lançamentos daquele mês não alteram mais o documento) e aparece em Bater Ponto → Holerites para ela assinar. Para mudar depois é preciso "reabrir".</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" id="hl-pub-go"><i class="fa-solid fa-lock"></i> Publicar</button>';
    var box = global.Modal.open({ title: "Publicar holerites", bodyHtml: body, footHtml: foot, wide: true });
    box.querySelector("#hl-pub-go").addEventListener("click", function () {
      var ids = Array.prototype.slice.call(box.querySelectorAll("input[data-emp]:checked")).map(function (i) { return i.getAttribute("data-emp"); });
      if (!ids.length) { global.Toast.show("Selecione ao menos uma funcionária", "danger"); return; }
      var btn = box.querySelector("#hl-pub-go"); btn.disabled = true;
      var entries = ids.map(function (id) { var e = global.DB.get("employees", id); return { emp: e, slip: opts.slipFor(e) }; });
      var results = publishMany(entries, mk);
      var okList = results.filter(function (r) { return r.res.ok; });
      if (!okList.length) { global.Toast.show(results[0].res.error, "danger"); btn.disabled = false; return; }
      Promise.all(okList.map(function (r) { return global.DB.confirmSaved(TABLE, r.res.slip.id).then(function (ok) { return { r: r, ok: ok }; }); })).then(function (conf) {
        var failed = conf.filter(function (c) { return !c.ok; });
        failed.forEach(function (c) { global.DB.remove(TABLE, c.r.res.slip.id); });
        refreshAll();
        if (failed.length) {
          global.Toast.show("Não foi possível gravar o holerite no servidor. Provavelmente a tabela \"payslips\" ainda não foi criada no Supabase — rode o SQL supabase/payslips.sql e tente novamente.", "danger");
          btn.disabled = false; return;
        }
        global.Modal.close();
        global.Toast.show(okList.length + " holerite(s) publicado(s) — disponível para assinatura", "success");
      });
    });
  }

  global.Holerite = {
    TABLE: TABLE, COMPANY: COMPANY,
    buildSnapshot: buildSnapshot, hashSnapshot: hashSnapshot, drawPdf: drawPdf, newDoc: newDoc, downloadPdf: downloadPdf,
    statusOf: statusOf, slipsOf: slipsOf, activeSlip: activeSlip, pendingForEmployee: pendingForEmployee,
    verifyIntegrity: verifyIntegrity, canPublish: canPublish, canSignAsEmployee: canSignAsEmployee, canSignAsManager: canSignAsManager,
    publishOne: publishOne, publishMany: publishMany, sign: sign, cancelSlip: cancelSlip,
    openViewer: openViewer, onChange: onChange, mountEmployeePanel: mountEmployeePanel, mountManagerPanel: mountManagerPanel, refresh: refreshAll
  };
})(window);
