/* ============================================================
   Salão ERP — Folha de Pagamento (motor de cálculo, sem tela)
   ------------------------------------------------------------
   Funções puras (sem DOM, sem DB) — por isso testáveis em Node
   (test/folha-calc.test.js). A tela está em folha-pagamento.js.

   Regime CLT, a pedido do usuário (08/10/2026): holerite com INSS,
   IRRF e FGTS (informativo, encargo do empregador). O banco de horas
   NÃO altera o valor a pagar (só acumula, compensa em folga) — aparece
   no holerite como informação. Comissão do mês entra como provento e
   o que já foi pago (pagamentos semanais) sai como desconto, para não
   pagar duas vezes. Vales/adiantamentos entram como desconto.

   >>> ATENÇÃO: as tabelas abaixo são as de 2026 (INSS: portaria
   interministerial do ano; IRRF: Lei 15.270/2025). Conferir com o
   contador a cada virada de ano ou mudança de lei — só editar
   TABLES. Cálculo orientativo; o fechamento oficial é do contador.
   ============================================================ */
(function (global) {
  "use strict";

  var TABLES = {
    year: 2026,
    minWage: 1621.00,
    // INSS do empregado — alíquotas progressivas (cada faixa só sobre o que cai nela), até o teto.
    inss: {
      ceiling: 8475.55,
      brackets: [
        { upTo: 1621.00, rate: 0.075 },
        { upTo: 2902.84, rate: 0.09 },
        { upTo: 4354.27, rate: 0.12 },
        { upTo: 8475.55, rate: 0.14 }
      ]
    },
    // IRRF mensal 2026
    irrf: {
      dependentDeduction: 189.59,
      simplifiedDiscount: 607.20,           // desconto simplificado (25% do limite de isenção da tabela)
      brackets: [                            // base de cálculo mensal → alíquota e parcela a deduzir
        { upTo: 2428.80, rate: 0,     deduct: 0 },
        { upTo: 2826.65, rate: 0.075, deduct: 182.16 },
        { upTo: 3751.05, rate: 0.15,  deduct: 394.16 },
        { upTo: 4664.68, rate: 0.225, deduct: 675.49 },
        { upTo: Infinity, rate: 0.275, deduct: 908.73 }
      ],
      // Lei 15.270/2025: rendimentos tributáveis até R$ 5.000 → imposto zerado;
      // de 5.000,01 a 7.350 → redutor decrescente; acima disso, tabela cheia.
      exemptUpTo: 5000.00,
      reductionUpTo: 7350.00,
      reductionA: 978.62,
      reductionB: 0.133145
    },
    fgtsRate: 0.08
  };

  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function num(n) { n = Number(n); return isFinite(n) ? n : 0; }

  // INSS do empregado sobre `base` (salário + proventos que incidem), limitado ao teto.
  function inss(base) {
    base = Math.max(0, num(base));
    var capped = Math.min(base, TABLES.inss.ceiling);
    var total = 0, prev = 0;
    TABLES.inss.brackets.forEach(function (b) {
      if (capped > prev) total += (Math.min(capped, b.upTo) - prev) * b.rate;
      prev = b.upTo;
    });
    return round2(total);
  }

  // IRRF mensal. `gross` = rendimentos tributáveis do mês; `inssValue` = INSS descontado;
  // `dependents` = nº de dependentes. Usa a dedução mais vantajosa: legal (INSS +
  // dependentes) ou desconto simplificado.
  function irrf(gross, inssValue, dependents) {
    gross = Math.max(0, num(gross));
    var T = TABLES.irrf;
    var legal = num(inssValue) + Math.max(0, Math.floor(num(dependents))) * T.dependentDeduction;
    var deduction = Math.max(legal, T.simplifiedDiscount);
    var base = Math.max(0, gross - deduction);
    var tax = 0;
    for (var i = 0; i < T.brackets.length; i++) {
      if (base <= T.brackets[i].upTo) { tax = base * T.brackets[i].rate - T.brackets[i].deduct; break; }
    }
    tax = Math.max(0, tax);
    var reduction = 0;
    if (gross <= T.exemptUpTo) reduction = tax;
    else if (gross <= T.reductionUpTo) reduction = Math.max(0, T.reductionA - T.reductionB * gross);
    reduction = Math.min(reduction, tax);
    return { tax: round2(tax - reduction), taxBeforeReduction: round2(tax), reduction: round2(reduction), base: round2(base), deduction: round2(deduction), usedSimplified: deduction === T.simplifiedDiscount && legal < T.simplifiedDiscount };
  }

  // "YYYY-MM" → { days, start, end }
  function monthInfo(monthKey) {
    var p = String(monthKey).split("-");
    var y = Number(p[0]), m = Number(p[1]);
    var days = new Date(y, m, 0).getDate();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return { year: y, month: m, days: days, start: y + "-" + pad(m) + "-01", end: y + "-" + pad(m) + "-" + pad(days) };
  }

  // Fração do mês trabalhada (admissão no meio do mês → proporcional por dias corridos).
  function monthFraction(monthKey, hireDate) {
    var mi = monthInfo(monthKey);
    if (!hireDate || hireDate <= mi.start) return 1;
    if (hireDate > mi.end) return 0;
    var hireDay = Number(hireDate.slice(8, 10));
    return (mi.days - hireDay + 1) / mi.days;
  }

  // Calcula o holerite de um funcionário em um mês.
  // input: {
  //   monthKey, regime: "clt" | "none", baseSalary, hireDate, dependents,
  //   commissionDevido, commissionPago,
  //   vales: [{ id, description, amount, included }],
  //   extras: [{ kind: "provento"|"desconto", label, amount, taxable: bool }],
  //   bank: { monthMin, totalMin }  (informativo)
  // }
  function computePayslip(input) {
    var regime = input.regime === "none" ? "none" : "clt";
    var frac = monthFraction(input.monthKey, input.hireDate);
    var salary = round2(num(input.baseSalary) * frac);
    var commission = round2(Math.max(0, num(input.commissionDevido)));
    var earnings = [];
    if (salary > 0 || frac > 0) earnings.push({ code: "salario", label: frac < 1 ? "Salário base (proporcional à admissão)" : "Salário base", amount: salary, taxable: true });
    if (commission > 0) earnings.push({ code: "comissao", label: "Comissão apurada no mês", amount: commission, taxable: true });
    (input.extras || []).forEach(function (x) {
      if (x.kind === "provento" && num(x.amount) > 0) earnings.push({ code: "extra", label: x.label || "Outro provento", amount: round2(x.amount), taxable: x.taxable !== false });
    });
    var taxableBase = round2(earnings.reduce(function (s, e) { return s + (e.taxable ? e.amount : 0); }, 0));
    var totalEarnings = round2(earnings.reduce(function (s, e) { return s + e.amount; }, 0));

    var deductions = [];
    var inssValue = 0, irrfInfo = null, fgts = 0;
    if (regime === "clt") {
      inssValue = inss(taxableBase);
      if (inssValue > 0) deductions.push({ code: "inss", label: "INSS", amount: inssValue });
      irrfInfo = irrf(taxableBase, inssValue, input.dependents);
      if (irrfInfo.tax > 0) deductions.push({ code: "irrf", label: "IRRF", amount: irrfInfo.tax });
      fgts = round2(taxableBase * TABLES.fgtsRate);
    }
    var valesTotal = 0;
    (input.vales || []).forEach(function (v) {
      if (v.included && num(v.amount) > 0) { valesTotal += num(v.amount); deductions.push({ code: "vale", label: v.description || "Vale / adiantamento", amount: round2(v.amount) }); }
    });
    var paidCommission = round2(Math.max(0, num(input.commissionPago)));
    if (paidCommission > 0) deductions.push({ code: "comissao_paga", label: "Comissão já paga no mês (pagamentos semanais)", amount: paidCommission });
    (input.extras || []).forEach(function (x) {
      if (x.kind === "desconto" && num(x.amount) > 0) deductions.push({ code: "extra", label: x.label || "Outro desconto", amount: round2(x.amount) });
    });
    var totalDeductions = round2(deductions.reduce(function (s, d) { return s + d.amount; }, 0));
    var net = round2(totalEarnings - totalDeductions);
    return {
      monthKey: input.monthKey, regime: regime, fraction: frac,
      earnings: earnings, deductions: deductions,
      totalEarnings: totalEarnings, totalDeductions: totalDeductions, net: net,
      taxableBase: taxableBase, inss: inssValue, irrf: irrfInfo, fgts: fgts,
      bank: input.bank || null,
      warnings: net < 0 ? ["Líquido negativo: os descontos (vales/comissão já paga) superam os proventos do mês."] : []
    };
  }

  global.FolhaCalc = { TABLES: TABLES, round2: round2, inss: inss, irrf: irrf, monthInfo: monthInfo, monthFraction: monthFraction, computePayslip: computePayslip };
  if (typeof module !== "undefined" && module.exports) module.exports = global.FolhaCalc;
})(typeof window !== "undefined" ? window : globalThis);
