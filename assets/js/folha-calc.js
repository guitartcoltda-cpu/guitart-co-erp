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
      ceilingValue: 988.09,                  // INSS máximo no teto (valor oficial publicado)
      brackets: [                            // `deduct` = parcela a deduzir (método "alíquota × base − parcela")
        { upTo: 1621.00, rate: 0.075, deduct: 0 },
        { upTo: 2902.84, rate: 0.09,  deduct: 24.32 },
        { upTo: 4354.27, rate: 0.12,  deduct: 111.40 },
        { upTo: 8475.55, rate: 0.14,  deduct: 198.49 }
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
    fgtsRate: 0.08,
    // Salário-família (Portaria interministerial 2026): cota por filho até 14 anos (ou com
    // deficiência) para quem ganha até o limite. Não incide INSS, IRRF nem FGTS.
    familyAllowance: { quota: 67.54, incomeLimit: 1980.38 },
    monthlyHours: 220                         // divisor do valor-hora do mensalista (44h/semana)
  };

  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function num(n) { n = Number(n); return isFinite(n) ? n : 0; }

  // Trunca (não arredonda) em centavos — é assim que o sistema do contador calcula o INSS
  // (conferido nos holerites de 09/2026: 133,9072 → 133,90; 137,68 exato).
  function trunc2(n) { return Math.floor(Number(n) * 100 + 1e-6) / 100; }

  // Faixa do INSS (alíquota marginal) para a base informada — vira a "referência" do holerite.
  function inssRate(base) {
    base = Math.max(0, num(base));
    var br = TABLES.inss.brackets;
    for (var i = 0; i < br.length; i++) if (base <= br[i].upTo) return br[i].rate;
    return br[br.length - 1].rate;
  }

  // INSS do empregado sobre `base` (salário + proventos que incidem), limitado ao teto.
  // Método "alíquota × base − parcela a deduzir", truncado em centavos (igual ao holerite do contador).
  function inss(base) {
    base = Math.max(0, num(base));
    if (base <= 0) return 0;
    if (base >= TABLES.inss.ceiling) return TABLES.inss.ceilingValue;
    var br = TABLES.inss.brackets;
    for (var i = 0; i < br.length; i++) {
      if (base <= br[i].upTo) return Math.max(0, trunc2(base * br[i].rate - br[i].deduct));
    }
    return TABLES.inss.ceilingValue;
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
  //   hoursDiscountMin: minutos de "horas negativas" lançadas SEM usar o banco (viram desconto:
  //     valor-hora = salário base ÷ TABLES.monthlyHours; reduz a base do INSS/IRRF)
  //   advancePct: % do salário pago como "Adiantamento" (ex.: 40) — desconto no holerite
  //   vtPct: % do salário descontado de vale-transporte (ex.: 6)
  //   familyChildren: nº de filhos no salário-família
  // }
  // Cada linha de proventos/descontos traz `num` (código do holerite do contador: 1 Salário,
  // 2 Comissão, 3 Provento avulso, 4 Salário Família, 11 INSS, 12 Adiantamento, 13 IRRF,
  // 14 Horas negativas, 15 Vale avulso, 16 Comissão já paga, 17 Desconto avulso, 109 Vale-transporte)
  // e `ref` (referência impressa: dias, %, nº de filhos).
  function computePayslip(input) {
    var regime = input.regime === "none" ? "none" : "clt";
    var frac = monthFraction(input.monthKey, input.hireDate);
    var salary = round2(num(input.baseSalary) * frac);
    var commission = round2(Math.max(0, num(input.commissionDevido)));
    var mi = monthInfo(input.monthKey);
    var refDays = frac < 1 ? Math.max(0, Math.min(30, Math.round(frac * mi.days))) : 30;
    var earnings = [];
    if (salary > 0 || frac > 0) earnings.push({ code: "salario", num: 1, ref: refDays, label: frac < 1 ? "Salário base (proporcional à admissão)" : "Salário", amount: salary, taxable: true });
    if (commission > 0) earnings.push({ code: "comissao", num: 2, ref: "", label: "Comissão apurada no mês", amount: commission, taxable: true });
    (input.extras || []).forEach(function (x) {
      if (x.kind === "provento" && num(x.amount) > 0) earnings.push({ code: "extra", num: 3, ref: "", label: x.label || "Outro provento", amount: round2(x.amount), taxable: x.taxable !== false });
    });
    var hoursMin = Math.max(0, Math.round(num(input.hoursDiscountMin)));
    var hourly = TABLES.monthlyHours > 0 ? num(input.baseSalary) / TABLES.monthlyHours : 0;
    var hoursDiscount = hoursMin > 0 ? round2(Math.min(salary, hoursMin / 60 * hourly)) : 0;
    var taxableBase = round2(Math.max(0, earnings.reduce(function (s, e) { return s + (e.taxable ? e.amount : 0); }, 0) - hoursDiscount));

    // Salário-família: só para quem ganha até o limite; não entra em nenhuma base de imposto.
    var children = Math.max(0, Math.floor(num(input.familyChildren)));
    var FA = TABLES.familyAllowance;
    var familyAmount = 0, warnings = [];
    if (children > 0) {
      if (taxableBase <= FA.incomeLimit) {
        familyAmount = round2(children * FA.quota);
        earnings.push({ code: "salario_familia", num: 4, ref: children, label: "Salário Família", amount: familyAmount, taxable: false });
      } else {
        warnings.push("Remuneração acima de " + FA.incomeLimit.toFixed(2).replace(".", ",") + ": sem direito ao salário-família neste mês.");
      }
    }
    var totalEarnings = round2(earnings.reduce(function (s, e) { return s + e.amount; }, 0));

    var deductions = [];
    var inssValue = 0, irrfInfo = null, fgts = 0;
    if (regime === "clt") {
      inssValue = inss(taxableBase);
      if (inssValue > 0) deductions.push({ code: "inss", num: 11, ref: round2(inssRate(taxableBase) * 100), label: "INSS Sobre Salário", amount: inssValue });
      irrfInfo = irrf(taxableBase, inssValue, input.dependents);
      if (irrfInfo.tax > 0) deductions.push({ code: "irrf", num: 13, ref: "", label: "IRRF", amount: irrfInfo.tax });
      fgts = round2(taxableBase * TABLES.fgtsRate);
    }
    var advancePct = Math.max(0, num(input.advancePct));
    var advance = advancePct > 0 ? round2(salary * advancePct / 100) : 0;
    if (advance > 0) deductions.push({ code: "adiantamento", num: 12, ref: "", label: "Adiantamento Anterior", amount: advance });
    if (hoursDiscount > 0) deductions.push({ code: "horas_descontadas", num: 14, ref: "", label: "Horas negativas (desconto em folha)", amount: hoursDiscount });
    var vtPct = Math.max(0, num(input.vtPct));
    var vt = vtPct > 0 ? round2(salary * vtPct / 100) : 0;
    if (vt > 0) deductions.push({ code: "vt", num: 109, ref: vtPct, label: "Desc. Vale Transporte", amount: vt });
    (input.vales || []).forEach(function (v) {
      if (v.included && num(v.amount) > 0) deductions.push({ code: "vale", num: 15, ref: "", label: v.description || "Vale / adiantamento", amount: round2(v.amount) });
    });
    var paidCommission = round2(Math.max(0, num(input.commissionPago)));
    if (paidCommission > 0) deductions.push({ code: "comissao_paga", num: 16, ref: "", label: "Comissão já paga no mês (pagamentos semanais)", amount: paidCommission });
    (input.extras || []).forEach(function (x) {
      if (x.kind === "desconto" && num(x.amount) > 0) deductions.push({ code: "extra", num: 17, ref: "", label: x.label || "Outro desconto", amount: round2(x.amount) });
    });
    var totalDeductions = round2(deductions.reduce(function (s, d) { return s + d.amount; }, 0));
    var net = round2(totalEarnings - totalDeductions);
    if (net < 0) warnings.push("Líquido negativo: os descontos (vales/comissão já paga) superam os proventos do mês.");
    return {
      monthKey: input.monthKey, regime: regime, fraction: frac,
      earnings: earnings, deductions: deductions,
      totalEarnings: totalEarnings, totalDeductions: totalDeductions, net: net,
      hoursDiscount: hoursDiscount, hoursDiscountMin: hoursMin,
      taxableBase: taxableBase, inss: inssValue, irrf: irrfInfo, fgts: fgts,
      advance: advance, vt: vt, familyAllowance: familyAmount,
      // Bases impressas no rodapé do holerite do contador. A "base IRRF" do contador é o salário
      // menos o adiantamento (informativa — o imposto em si segue a tabela, isento até R$ 5.000).
      bases: {
        salary: round2(num(input.baseSalary)),
        inss: taxableBase,
        fgts: regime === "clt" ? taxableBase : 0,
        fgtsValue: fgts,
        irrf: regime === "clt" ? round2(Math.max(0, taxableBase - advance)) : 0,
        irrfBand: !irrfInfo || irrfInfo.tax <= 0 ? "Isento" : "Tributado"
      },
      bank: input.bank || null,
      warnings: warnings
    };
  }

  global.FolhaCalc = { TABLES: TABLES, round2: round2, trunc2: trunc2, inssRate: inssRate, inss: inss, irrf: irrf, monthInfo: monthInfo, monthFraction: monthFraction, computePayslip: computePayslip };
  if (typeof module !== "undefined" && module.exports) module.exports = global.FolhaCalc;
})(typeof window !== "undefined" ? window : globalThis);
