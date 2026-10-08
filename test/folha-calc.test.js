/* Teste do motor da Folha de Pagamento (assets/js/folha-calc.js). Uso: node test/folha-calc.test.js */
"use strict";
const path = require("path");
const F = require(path.join(__dirname, "..", "assets", "js", "folha-calc.js"));
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
function near(a, b, m, tol) { ok(Math.abs(a - b) <= (tol || 0.011), m + " (esperado " + b + ", veio " + a + ")"); }

// ---- INSS 2026 ----
near(F.inss(0), 0, "INSS de 0");
near(F.inss(1621), 121.58, "INSS no salário mínimo (7,5%)");
near(F.inss(1800), 137.69, "INSS sobre 1.800");
near(F.inss(2902.84), 236.93, "INSS no fim da 2ª faixa (confere com a dedução 24,32)");
near(F.inss(4354.27), 411.10, "INSS no fim da 3ª faixa");
near(F.inss(8475.55), 988.09, "INSS no teto = 988,09");
near(F.inss(20000), 988.09, "acima do teto não passa de 988,09");
// confere com o método "alíquota × base − parcela a deduzir"
near(F.inss(3500), 3500 * 0.12 - 111.40, "INSS 3.500 = 12% − 111,40");
near(F.inss(6000), 6000 * 0.14 - 198.49, "INSS 6.000 = 14% − 198,49");

// ---- IRRF 2026 (exemplos do artigo consultado, que ignora o INSS → passa 0) ----
near(F.irrf(4500, 0, 0).tax, 0, "4.500 → zero (isento até 5.000)");
near(F.irrf(4500, 0, 0).taxBeforeReduction, 200.39, "4.500: imposto antes do redutor 200,39");
near(F.irrf(6000, 0, 0).tax, 394.54, "6.000 → 394,54");
near(F.irrf(6000, 0, 0).reduction, 179.75, "6.000: redutor 179,75");
near(F.irrf(5000, 0, 0).tax, 0, "5.000 → zero");
near(F.irrf(7350, 0, 0).reduction, 0, "7.350: redutor zerado");
near(F.irrf(10000, 988.09, 0).tax, (10000 - 988.09) * 0.275 - 908.73, "10.000 sem redutor, dedução legal (INSS) > simplificado");
ok(F.irrf(1800, 137.69, 0).usedSimplified, "salário baixo usa o desconto simplificado");
near(F.irrf(3000, 0, 2).deduction, 607.20, "2 dependentes (379,18) < simplificado → fica o simplificado");
near(F.irrf(9000, 800, 4).deduction, 800 + 4 * 189.59, "4 dependentes + INSS > simplificado");
near(F.irrf(1800, 137.69, 0).tax, 0, "1.800 → zero");

// ---- mês / proporcional ----
ok(F.monthInfo("2026-02").days === 28, "fevereiro/2026 tem 28 dias");
ok(F.monthFraction("2026-10", "2025-07-25") === 1, "admitida antes → mês cheio");
near(F.monthFraction("2026-10", "2026-10-16"), 16 / 31, "admissão 16/10 → 16/31", 1e-9);
ok(F.monthFraction("2026-10", "2026-11-02") === 0, "admissão futura → zero");

// ---- holerite ----
let p = F.computePayslip({ monthKey: "2026-10", regime: "clt", baseSalary: 1800, hireDate: "2025-07-25", dependents: 0, commissionDevido: 0, commissionPago: 0, vales: [], extras: [] });
near(p.totalEarnings, 1800, "bruto 1.800"); near(p.inss, 137.69, "INSS 137,69"); near(p.net, 1800 - 137.69, "líquido 1.662,31");
ok(p.irrf.tax === 0, "sem IRRF"); near(p.fgts, 144, "FGTS 8% = 144,00 (não desconta do funcionário)");
ok(p.deductions.length === 1, "só o INSS desconta");

// comissão + comissão já paga + vale
p = F.computePayslip({ monthKey: "2026-10", regime: "clt", baseSalary: 1621, hireDate: "2025-01-01", dependents: 0, commissionDevido: 2000, commissionPago: 1500,
  vales: [{ id: "a", description: "Vale", amount: 200, included: true }, { id: "b", description: "Vale fora", amount: 999, included: false }], extras: [] });
near(p.taxableBase, 3621, "base INSS = salário + comissão");
near(p.totalEarnings, 3621, "bruto");
near(p.deductions.find(d => d.code === "vale").amount, 200, "vale marcado entra");
ok(p.deductions.filter(d => d.code === "vale").length === 1, "vale desmarcado não entra");
near(p.deductions.find(d => d.code === "comissao_paga").amount, 1500, "comissão já paga desconta");
near(p.net, 3621 - F.inss(3621) - 200 - 1500, "líquido confere");

// regime sem desconto legal
p = F.computePayslip({ monthKey: "2026-10", regime: "none", baseSalary: 2000, commissionDevido: 0, vales: [], extras: [] });
ok(p.inss === 0 && p.fgts === 0 && p.net === 2000, "regime none: sem INSS/IRRF/FGTS");

// extras (provento não tributável, desconto)
p = F.computePayslip({ monthKey: "2026-10", regime: "clt", baseSalary: 2000, hireDate: null, dependents: 0, commissionDevido: 0, vales: [],
  extras: [{ kind: "provento", label: "Ajuda de custo", amount: 300, taxable: false }, { kind: "desconto", label: "Material", amount: 50 }] });
near(p.taxableBase, 2000, "provento não tributável fora da base"); near(p.totalEarnings, 2300, "mas soma no bruto");
near(p.net, 2300 - F.inss(2000) - 50, "líquido com extras");

// proporcional
p = F.computePayslip({ monthKey: "2026-10", regime: "clt", baseSalary: 3100, hireDate: "2026-10-21", commissionDevido: 0, vales: [], extras: [] });
near(p.earnings[0].amount, 3100 * 11 / 31, "salário proporcional 11/31");

// líquido negativo gera aviso
p = F.computePayslip({ monthKey: "2026-10", regime: "clt", baseSalary: 1621, hireDate: null, commissionDevido: 0, commissionPago: 0, vales: [{ amount: 5000, included: true }], extras: [] });
ok(p.net < 0 && p.warnings.length === 1, "líquido negativo avisa");

console.log("\n" + passed + " passaram, " + failed + " falharam");
process.exit(failed ? 1 : 0);
