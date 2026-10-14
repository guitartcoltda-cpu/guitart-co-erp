/* ============================================================
   Salão ERP — Folha de Pagamento (tela, só administração)
   ------------------------------------------------------------
   Pedido do usuário (08/10/2026): folha de pagamento com holerite de
   fechamento a partir das horas e do salário cadastrado, visível SÓ
   para a administração (funcionária nunca vê). Regime CLT; banco de
   horas só acumula (informativo); comissão e vales entram automáticos.

   Cálculo em folha-calc.js (funções puras, testadas em
   test/folha-calc.test.js). Comissão: mesma conta da tela de
   Comissionamento (ComissoesCalc.rowsForRange). Banco de horas: mesma
   conta do Ponto (PontoCalc.espelho). O que a administração ajusta
   (vales marcados, proventos/descontos avulsos, fechamento) fica em
   settings.payroll[AAAA-MM][funcionário]; o regime e os dependentes de
   cada pessoa ficam em employee.payroll.
   ============================================================ */
(function () {
  "use strict";

  var ADMIN_ROLES = ["Administrador", "Desenvolvedor"];
  var monthKey = null;
  var cache = null; // { monthKey, commission: {empId: row}, bank: {empId: {monthMin,totalMin}} }

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("fp-app")) return;
    var u = window.CurrentUser ? CurrentUser.get() : null;
    if (!u || ADMIN_ROLES.indexOf(u.role) === -1) {
      document.getElementById("fp-app").style.display = "none";
      document.getElementById("fp-denied").style.display = "";
      return;
    }
    DB.ready.then(function () { setTimeout(init, 0); });
  });

  function init() {
    var input = document.getElementById("fp-month");
    monthKey = Utils.todayISO().slice(0, 7);
    input.value = monthKey;
    input.addEventListener("change", function () {
      if (/^\d{4}-\d{2}$/.test(input.value)) { monthKey = input.value; cache = null; render(); }
    });
    document.getElementById("btn-fp-pdf-all").addEventListener("click", function () { generatePdf(payrollEmployees()); });
    document.getElementById("fp-disclaimer").textContent =
      "Tabelas " + FolhaCalc.TABLES.year + " (INSS progressivo, IRRF com a isenção até R$ 5.000 da Lei 15.270/2025, FGTS 8%). " +
      "Cálculo orientativo para conferência — o fechamento oficial deve ser validado pelo contador. " +
      "O banco de horas não altera o valor pago (só acumula, compensa em folga).";
    var hp = document.getElementById("fp-hol");
    if (window.Holerite) Holerite.onChange(function () { render(); });
    if (hp && window.Holerite) holPanel = Holerite.mountManagerPanel(hp, { getMonth: function () { return monthKey; }, employees: payrollEmployees, slipFor: payslipFor });
    render();
  }

  var holPanel = null;

  // ---------- dados ----------
  function payrollEmployees() {
    return DB.all("employees").filter(function (e) {
      if (e.status !== "ativo") return false;
      if (!(Number(e.baseSalary) > 0)) return false;
      return !(e.payroll && e.payroll.inPayroll === false);
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function rangeForCommission() {
    var mi = FolhaCalc.monthInfo(monthKey);
    var today = Utils.todayISO();
    var end = mi.end < today ? mi.end : (today < mi.start ? mi.start : today);
    return { start: mi.start, end: end, fullMonth: end === mi.end };
  }

  function ensureCache() {
    if (cache && cache.monthKey === monthKey) return cache;
    var r = rangeForCommission();
    var commission = {};
    try {
      (window.ComissoesCalc ? ComissoesCalc.rowsForRange(r.start, r.end) : []).forEach(function (row) { commission[row.employee.id] = row; });
    } catch (e) { commission = {}; }
    var allEntries = DB.all("timeClockEntries");
    var bank = {};
    payrollEmployees().forEach(function (emp) {
      try {
        var month = PontoCalc.espelho(emp.id, r.start, r.end, emp, allEntries).totals;
        var total = PontoCalc.espelho(emp.id, "2000-01-01", r.end, emp, allEntries).totals;
        // horas negativas lançadas SEM usar o banco viram desconto em folha — pelo mês inteiro
        var full = FolhaCalc.monthInfo(monthKey);
        var monthFull = PontoCalc.espelho(emp.id, full.start, full.end, emp, allEntries).totals;
        bank[emp.id] = { monthMin: month.saldoMin, totalMin: total.saldoMin, payMin: monthFull.adjustPayMin || 0 };
      } catch (e2) { bank[emp.id] = null; }
    });
    cache = { monthKey: monthKey, commission: commission, bank: bank, range: r };
    return cache;
  }

  function state(empId) {
    var p = (DB.getSettings() || {}).payroll || {};
    return ((p[monthKey] || {})[empId]) || { vales: {}, extras: [] };
  }

  function saveState(empId, patch) {
    var mk = monthKey;
    DB.mergeSettingsField("payroll", function (old) {
      var all = Object.assign({}, old || {});
      var month = Object.assign({}, all[mk] || {});
      month[empId] = Object.assign({ vales: {}, extras: [] }, month[empId] || {}, patch);
      all[mk] = month;
      return all;
    });
  }

  // Candidatos a vale/adiantamento: despesas do mês ligadas ao funcionário cuja descrição
  // ou categoria lembra "vale"/"adiantamento" (a comissão tem categoria própria e fica de fora).
  function valeCandidates(emp) {
    var mi = FolhaCalc.monthInfo(monthKey);
    var cats = {};
    DB.all("categories").forEach(function (c) { cats[c.id] = c.name || ""; });
    var st = state(emp.id);
    // Com a regra de adiantamento (ex.: 40% do salário) ativa, o desconto do adiantamento já vem
    // calculado no holerite — os vales lançados ficam DESMARCADOS por padrão (senão descontaria 2x).
    var advanceRule = Number((emp.payroll || {}).advancePct) > 0;
    // Lançamentos antigos nem sempre têm funcionário vinculado (ex.: "VALE/ADIANTAMENTO LUIZA"):
    // nesse caso reconhece pelo primeiro nome na descrição, se ele for único entre os ativos.
    var norm = function (s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
    var first = norm(emp.name).split(/\s+/)[0];
    var sameFirst = DB.all("employees").filter(function (e) { return e.status !== "inativo" && norm(e.name).split(/\s+/)[0] === first; }).length;
    return DB.all("transactions").filter(function (t) {
      if (t.type !== "despesa") return false;
      if (!t.date || t.date < mi.start || t.date > mi.end) return false;
      var cat = cats[t.categoryId] || "";
      if (/comiss/i.test(cat)) return false;
      if (!/\bvale\b|adiant/i.test(norm((t.description || "") + " " + cat))) return false;
      if (t.employeeId) return t.employeeId === emp.id;
      return sameFirst === 1 && first && new RegExp("\\b" + first + "\\b").test(norm(t.description));
    }).sort(function (a, b) { return a.date.localeCompare(b.date); }).map(function (t) {
      return { id: t.id, description: (t.description || "Vale") + " (" + Utils.fmtDate(t.date) + ")", amount: Number(t.amount) || 0, included: advanceRule ? st.vales[t.id] === true : st.vales[t.id] !== false, status: t.status };
    });
  }

  function payslipFor(emp) {
    var c = ensureCache();
    var st = state(emp.id);
    var com = c.commission[emp.id];
    var cfg = emp.payroll || {};
    return FolhaCalc.computePayslip({
      monthKey: monthKey, regime: cfg.regime || "clt", baseSalary: emp.baseSalary, hireDate: emp.hireDate,
      dependents: cfg.dependents || 0,
      advancePct: cfg.advancePct || 0, vtPct: cfg.vtPct || 0, familyChildren: cfg.familyChildren || 0,
      commissionDevido: com ? com.devido : 0, commissionPago: com ? com.pago : 0,
      vales: valeCandidates(emp), extras: st.extras || [], bank: c.bank[emp.id],
      hoursDiscountMin: c.bank[emp.id] ? c.bank[emp.id].payMin : 0
    });
  }

  function publishedSlip(emp) { return window.Holerite ? Holerite.activeSlip(emp.id, monthKey) : null; }

  // ---------- tela ----------
  function money(v) { return Utils.fmtMoney(v); }
  function hm(min) { return (min < 0 ? "-" : "") + PontoCalc.fmtHM(Math.abs(min)); }

  function render() {
    var emps = payrollEmployees();
    var c = ensureCache();
    var slips = emps.map(function (e) { return { emp: e, slip: payslipFor(e) }; });
    var monthLabel = PontoCalc.monthRange(monthKey + "-01").label;
    monthLabel = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
    document.getElementById("fp-hint").textContent = c.range.fullMonth ? "" : "Mês em andamento: comissão e banco de horas apurados até hoje.";
    if (holPanel) holPanel();
    document.getElementById("fp-sub").textContent = monthLabel + " — " + emps.length + " funcionário(s) na folha";

    var tot = slips.reduce(function (a, x) {
      a.gross += x.slip.totalEarnings; a.ded += x.slip.totalDeductions; a.net += x.slip.net; a.fgts += x.slip.fgts; return a;
    }, { gross: 0, ded: 0, net: 0, fgts: 0 });
    document.getElementById("fp-summary").innerHTML = [
      kpi("Total Bruto", money(tot.gross), "fa-coins", "#0eb8d9", "#dbf7fc"),
      kpi("Total de Descontos", money(tot.ded), "fa-scissors", "#c23b3b", "#fbe6e6"),
      kpi("Líquido a Pagar", money(tot.net), "fa-circle-check", "#1baf7a", "#e2f5ec"),
      kpi("FGTS do Mês (encargo)", money(tot.fgts), "fa-building-columns", "#4a3aa7", "#ece8f8")
    ].join("");

    var tbl = document.getElementById("tbl-folha");
    if (!slips.length) { Utils.emptyTable(tbl, "fa-money-bill-wave", "Nenhum funcionário ativo com salário base cadastrado"); return; }
    tbl.innerHTML = '<thead><tr><th>Funcionário</th><th>Regime</th><th>Bruto</th><th>INSS</th><th>IRRF</th><th>Vales / Já pago</th><th>Líquido</th><th>Banco de horas</th><th>Holerite</th><th></th></tr></thead><tbody>' +
      slips.map(function (x) {
        var s = x.slip, e = x.emp;
        var vales = s.deductions.filter(function (d) { return d.code === "vale" || d.code === "comissao_paga" || d.code === "extra"; }).reduce(function (a, d) { return a + d.amount; }, 0);
        var b = s.bank;
        return '<tr>' +
          '<td><div class="flex items-center gap-8">' + Utils.avatarHtml(e.name, e.photoDataUrl) + '<div><div>' + Utils.escapeHtml(e.name) + '</div><div class="small text-muted">' + Utils.escapeHtml(e.role || "-") + '</div></div></div></td>' +
          '<td>' + (s.regime === "clt" ? "CLT" : "Sem desconto legal") + '</td>' +
          '<td class="text-num">' + money(s.totalEarnings) + '</td>' +
          '<td class="text-num">' + money(s.inss) + '</td>' +
          '<td class="text-num">' + money(s.irrf ? s.irrf.tax : 0) + '</td>' +
          '<td class="text-num">' + money(vales) + '</td>' +
          '<td class="text-num font-bold ' + (s.net < 0 ? "text-danger" : "") + '">' + money(s.net) + '</td>' +
          '<td class="text-num">' + (b ? '<span class="' + (b.monthMin < 0 ? "text-danger" : "text-success") + '">' + hm(b.monthMin) + '</span><div class="small text-muted">acum. ' + hm(b.totalMin) + '</div>' : '-') + '</td>' +
          '<td>' + holBadge(e) + '</td>' +
          '<td><div class="flex gap-6"><button class="btn btn-sm btn-outline" data-fp-open="' + e.id + '">Detalhes</button>' +
          '<button class="btn btn-icon btn-ghost" data-fp-pdf="' + e.id + '" title="Gerar holerite (PDF)"><i class="fa-solid fa-file-pdf"></i></button></div></td>' +
          '</tr>';
      }).join("") + '</tbody>';
    Utils.qsa("[data-fp-open]", tbl).forEach(function (b) { b.addEventListener("click", function () { openDetails(b.getAttribute("data-fp-open")); }); });
    Utils.qsa("[data-fp-pdf]", tbl).forEach(function (b) {
      b.addEventListener("click", function () { generatePdf([DB.get("employees", b.getAttribute("data-fp-pdf"))]); });
    });
  }

  function holBadge(emp) {
    var h = publishedSlip(emp);
    if (!h) return '<span class="small text-muted">não publicado</span>';
    var m = Holerite.statusOf(h) === "concluida" ? "badge-success" : "badge-warning";
    return '<span class="badge ' + m + '">' + (Holerite.statusOf(h) === "concluida" ? "Assinado" : "Publicado") + '</span>';
  }

  function kpi(label, value, icon, color, bg) {
    return '<div class="kpi-card"><div class="kpi-icon" style="background:' + bg + ';color:' + color + ';"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
  }

  // ---------- detalhes do holerite ----------
  function slipHtml(emp, s) {
    var rows = s.earnings.map(function (e) { return '<tr><td>' + Utils.escapeHtml(e.label) + (e.taxable ? '' : ' <span class="small text-muted">(não tributável)</span>') + '</td><td class="text-num text-success">' + money(e.amount) + '</td><td></td></tr>'; }).join("") +
      s.deductions.map(function (d) { return '<tr><td>' + Utils.escapeHtml(d.label) + '</td><td></td><td class="text-num text-danger">' + money(d.amount) + '</td></tr>'; }).join("");
    var b = s.bank;
    return '<div class="table-wrap"><table class="data-table"><thead><tr><th>Descrição</th><th>Proventos</th><th>Descontos</th></tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr class="ponto-espelho-totals"><td>Totais</td><td class="text-num">' + money(s.totalEarnings) + '</td><td class="text-num">' + money(s.totalDeductions) + '</td></tr>' +
      '<tr class="ponto-espelho-totals"><td>Líquido a receber</td><td colspan="2" class="text-num ' + (s.net < 0 ? "text-danger" : "text-success") + '">' + money(s.net) + '</td></tr></tfoot></table></div>' +
      '<div class="small text-muted" style="margin-top:8px;">Base INSS/IRRF: ' + money(s.taxableBase) +
        (s.regime === "clt" ? ' · FGTS (encargo da empresa, não desconta da funcionária): ' + money(s.fgts) : '') +
        (s.irrf && s.irrf.reduction > 0 ? ' · Redutor IRRF aplicado: ' + money(s.irrf.reduction) : '') + '</div>' +
      (b ? '<div class="small" style="margin-top:4px;">Banco de horas no mês: <b>' + hm(b.monthMin) + '</b> · acumulado: <b>' + hm(b.totalMin) + '</b> <span class="text-muted">(só acumula — não altera o valor pago)</span></div>' : '') +
      (s.warnings.length ? '<div class="text-danger small" style="margin-top:6px;"><i class="fa-solid fa-triangle-exclamation"></i> ' + s.warnings.join(" ") + '</div>' : '');
  }

  function openDetails(empId) {
    var emp = DB.get("employees", empId);
    if (!emp) return;
    var cfg = emp.payroll || {};
    var vales = valeCandidates(emp);
    var st = state(empId);
    var extras = (st.extras || []).slice();

    var body =
      '<div class="small text-muted mb-8">' + Utils.escapeHtml(emp.role || "") + ' · admissão ' + (emp.hireDate ? Utils.fmtDate(emp.hireDate) : '-') + '</div>' +
      '<div id="fpd-lock"></div>' +
      '<div id="fpd-slip"></div>' +
      '<h4 style="margin:16px 0 6px;">Configuração do holerite</h4>' +
      '<div class="form-grid">' +
        '<div class="form-field"><label>Regime</label><select id="fpd-regime"><option value="clt"' + ((cfg.regime || "clt") === "clt" ? " selected" : "") + '>CLT (INSS, IRRF e FGTS)</option><option value="none"' + (cfg.regime === "none" ? " selected" : "") + '>Sem desconto legal</option></select></div>' +
        '<div class="form-field"><label>Dependentes (IRRF)</label><input type="number" id="fpd-dep" min="0" max="20" value="' + (cfg.dependents || 0) + '"></div>' +
        '<div class="form-field"><label>Adiantamento (% do salário)</label><input type="number" id="fpd-adv" min="0" max="100" step="0.01" value="' + (cfg.advancePct || 0) + '"></div>' +
        '<div class="form-field"><label>Desconto vale-transporte (%)</label><input type="number" id="fpd-vt" min="0" max="100" step="0.01" value="' + (cfg.vtPct || 0) + '"></div>' +
        '<div class="form-field"><label>Filhos (salário-família)</label><input type="number" id="fpd-kids" min="0" max="20" value="' + (cfg.familyChildren || 0) + '"></div>' +
        '<div class="form-field"><label>Na folha?</label><select id="fpd-in"><option value="1"' + (cfg.inPayroll !== false ? " selected" : "") + '>Sim</option><option value="0"' + (cfg.inPayroll === false ? " selected" : "") + '>Não (tirar da folha)</option></select></div>' +
      '</div>' +
      '<h4 style="margin:16px 0 6px;">Vales e adiantamentos do mês <span class="small text-muted">(despesas ligadas à funcionária em Contas a Pagar)</span></h4>' +
      '<div id="fpd-vales">' + (vales.length ? vales.map(function (v) {
        return '<label class="flex items-center gap-8" style="margin-bottom:4px;"><input type="checkbox" class="fpd-vale" data-id="' + v.id + '"' + (v.included ? " checked" : "") + '> <span>' + Utils.escapeHtml(v.description) + ' — <b>' + money(v.amount) + '</b>' + (v.status ? ' <span class="small text-muted">(' + Utils.escapeHtml(v.status) + ')</span>' : '') + '</span></label>';
      }).join("") : '<div class="small text-muted">Nenhum vale/adiantamento encontrado neste mês para esta funcionária.</div>') + '</div>' +
      '<h4 style="margin:16px 0 6px;">Proventos e descontos avulsos <span class="small text-muted">(só deste mês)</span></h4>' +
      '<div id="fpd-extras"></div>' +
      '<div class="form-grid" style="margin-top:8px;align-items:end;">' +
        '<div class="form-field"><label>Tipo</label><select id="fpx-kind"><option value="provento">Provento (soma)</option><option value="desconto">Desconto (subtrai)</option></select></div>' +
        '<div class="form-field"><label>Descrição</label><input type="text" id="fpx-label" placeholder="Ex.: Ajuda de custo, Material quebrado"></div>' +
        '<div class="form-field"><label>Valor (R$)</label><input type="text" id="fpx-amount"></div>' +
        '<div class="form-field"><label class="flex items-center gap-8"><input type="checkbox" id="fpx-tax" checked> Tributável (INSS/IRRF)</label></div>' +
        '<div class="form-field"><button type="button" class="btn btn-outline" id="fpx-add"><i class="fa-solid fa-plus"></i> Adicionar</button></div>' +
      '</div>';
    var foot = '<button class="btn btn-secondary" data-close-modal>Fechar</button>' +
      '<button class="btn btn-outline" id="fpd-pdf"><i class="fa-solid fa-file-pdf"></i> Holerite (PDF)</button>' +
      '<button class="btn btn-primary" id="fpd-save">Salvar</button>';
    var box = Modal.open({ title: "Holerite — " + emp.name, wide: true, bodyHtml: body, footHtml: foot });
    Utils.wireMoneyMask(box.querySelector("#fpx-amount"), 0);

    function readCfg() {
      function pct(sel) { var v = parseFloat(String(box.querySelector(sel).value).replace(",", ".")); return isFinite(v) && v > 0 ? Math.min(100, v) : 0; }
      return Object.assign({}, emp.payroll || {}, {
        regime: box.querySelector("#fpd-regime").value,
        dependents: Math.max(0, parseInt(box.querySelector("#fpd-dep").value, 10) || 0),
        advancePct: pct("#fpd-adv"), vtPct: pct("#fpd-vt"),
        familyChildren: Math.max(0, parseInt(box.querySelector("#fpd-kids").value, 10) || 0),
        inPayroll: box.querySelector("#fpd-in").value === "1"
      });
    }
    function currentSlip() {
      var tmp = Object.assign({}, emp, { payroll: readCfg() });
      var c = ensureCache(), com = c.commission[emp.id];
      var valesNow = vales.map(function (v) {
        var cb = box.querySelector('.fpd-vale[data-id="' + v.id + '"]');
        return Object.assign({}, v, { included: cb ? cb.checked : v.included });
      });
      return FolhaCalc.computePayslip({
        monthKey: monthKey, regime: tmp.payroll.regime, baseSalary: emp.baseSalary, hireDate: emp.hireDate, dependents: tmp.payroll.dependents,
        advancePct: tmp.payroll.advancePct, vtPct: tmp.payroll.vtPct, familyChildren: tmp.payroll.familyChildren,
        commissionDevido: com ? com.devido : 0, commissionPago: com ? com.pago : 0, vales: valesNow, extras: extras, bank: c.bank[emp.id],
        hoursDiscountMin: c.bank[emp.id] ? c.bank[emp.id].payMin : 0
      });
    }
    function redraw() {
      var cur = currentSlip();
      var pub = publishedSlip(emp), note = "";
      if (pub) {
        note += '<div class="fp-warn mb-8"><i class="fa-solid fa-lock"></i> Holerite deste mês <b>já publicado</b> para assinatura (' + Utils.escapeHtml(STATUS_LABEL(pub)) + '). Os campos abaixo não alteram o documento publicado' +
          (Math.abs(pub.snapshot.totals.net - cur.net) > 0.005 ? ' — <b>atenção:</b> os valores atuais (' + money(cur.net) + ') diferem do publicado (' + money(pub.snapshot.totals.net) + ')' : '') +
          '. Para alterar, reabra o holerite em "Holerites para Assinatura".</div>';
      }
      var advCfg = readCfg();
      if (advCfg.advancePct > 0) {
        var vTotal = vales.reduce(function (a, v) { return a + v.amount; }, 0);
        if (vales.length) note += '<div class="small text-muted mb-8">Adiantamento de ' + advCfg.advancePct + '% do salário = <b>' + money(cur.advance) + '</b>. Vales lançados em Contas a Pagar neste mês somam <b>' + money(vTotal) + '</b>' +
          (Math.abs(vTotal - cur.advance) > 0.005 ? ' (' + (vTotal > cur.advance ? 'pago a mais' : 'pago a menos') + ' que o adiantamento: <b>' + money(Math.abs(vTotal - cur.advance)) + '</b>)' : '') +
          ' — eles só entram no desconto se você marcar abaixo.</div>';
      }
      box.querySelector("#fpd-lock").innerHTML = note;
      box.querySelector("#fpd-slip").innerHTML = slipHtml(emp, cur);
      box.querySelector("#fpd-extras").innerHTML = extras.length ? extras.map(function (x, i) {
        return '<div class="flex items-center gap-8" style="margin-bottom:4px;"><span>' + (x.kind === "provento" ? "＋" : "－") + ' ' + Utils.escapeHtml(x.label) + ' — <b>' + money(x.amount) + '</b>' + (x.kind === "provento" && x.taxable === false ? ' (não tributável)' : '') + '</span>' +
          '<button type="button" class="btn btn-icon btn-ghost" data-rm="' + i + '" title="Remover"><i class="fa-solid fa-trash"></i></button></div>';
      }).join("") : '<div class="small text-muted">Nenhum lançamento avulso.</div>';
      Utils.qsa("[data-rm]", box).forEach(function (b) { b.addEventListener("click", function () { extras.splice(parseInt(b.getAttribute("data-rm"), 10), 1); redraw(); }); });
    }
    function STATUS_LABEL(h) { return ({ aguardando: "aguardando assinaturas", parcial: "falta 1 assinatura", concluida: "concluído" })[Holerite.statusOf(h)] || ""; }
    redraw();
    ["#fpd-regime", "#fpd-dep", "#fpd-in", "#fpd-adv", "#fpd-vt", "#fpd-kids"].forEach(function (sel) { box.querySelector(sel).addEventListener("input", redraw); box.querySelector(sel).addEventListener("change", redraw); });
    Utils.qsa(".fpd-vale", box).forEach(function (cb) { cb.addEventListener("change", redraw); });
    box.querySelector("#fpx-add").addEventListener("click", function () {
      var amount = Utils.moneyMaskToFloat(box.querySelector("#fpx-amount"));
      var label = box.querySelector("#fpx-label").value.trim();
      if (!label) { Toast.show("Informe a descrição do lançamento", "danger"); return; }
      if (!(amount > 0)) { Toast.show("Informe um valor maior que zero", "danger"); return; }
      extras.push({ kind: box.querySelector("#fpx-kind").value, label: label, amount: amount, taxable: box.querySelector("#fpx-tax").checked });
      box.querySelector("#fpx-label").value = ""; Utils.setMoneyMaskValue(box.querySelector("#fpx-amount"), 0);
      redraw();
    });
    function persist() {
      if (publishedSlip(emp)) { Toast.show("O holerite deste mês está publicado — reabra em \"Holerites para Assinatura\" para alterar.", "danger"); return false; }
      var valesMap = {};
      vales.forEach(function (v) { var cb = box.querySelector('.fpd-vale[data-id="' + v.id + '"]'); valesMap[v.id] = cb ? cb.checked : true; });
      DB.update("employees", emp.id, { payroll: readCfg() });
      saveState(emp.id, { vales: valesMap, extras: extras.slice() });
      DB.log("Folha", "Ajustou o holerite de " + emp.name + " (ref. " + monthKey + ")");
      return true;
    }
    box.querySelector("#fpd-save").addEventListener("click", function () { if (persist() === false) return; Toast.show("Holerite salvo", "success"); Modal.close(); cache = null; render(); });
    box.querySelector("#fpd-pdf").addEventListener("click", function () { if (!publishedSlip(emp) && persist() === false) return; cache = null; generatePdf([DB.get("employees", emp.id)]); render(); });
  }

  // ---------- PDF ----------
  // Mesmo formato do recibo do contador (holerite.js). Se o holerite do mês já foi publicado,
  // o PDF é o documento publicado (com as assinaturas); senão é um PDF de conferência.
  function generatePdf(emps) {
    emps = (emps || []).filter(Boolean);
    if (!emps.length) { Toast.show("Nenhum funcionário na folha", "info"); return; }
    var doc = window.Holerite && Holerite.newDoc();
    if (!doc) { Toast.show("Não foi possível carregar a biblioteca de PDF — verifique sua conexão", "danger"); return; }
    var u = window.CurrentUser ? CurrentUser.get() : null;
    var who = u ? ((u.firstName || "") + " " + (u.lastName || "")).trim() : "";
    var items = emps.map(function (emp) {
      var pub = publishedSlip(emp);
      if (pub) return { snap: pub.snapshot, slip: pub };
      return { snap: Holerite.buildSnapshot(emp, monthKey, payslipFor(emp), { generatedBy: who }), slip: null };
    });
    Holerite.drawPdf(doc, items);
    var suffix = emps.length === 1 ? Utils.slugify(emps[0].name) : "todos";
    doc.save("holerite_" + suffix + "_" + monthKey + ".pdf");
    DB.log("Folha", "Gerou holerite em PDF (" + (emps.length === 1 ? emps[0].name : emps.length + " funcionários") + ", ref. " + monthKey + ")");
    Toast.show("Holerite gerado", "success");
  }
})();
