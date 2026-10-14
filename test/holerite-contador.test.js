/* Teste — o cálculo do holerite bate, centavo a centavo, com o recibo de pagamento do contador (09/2026). Uso: node test/holerite-contador.test.js */
"use strict";
const path = require("path");
const F = require(path.join(__dirname, "..", "assets", "js", "folha-calc.js"));
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
function eq(a, b, m) { ok(Math.abs(a - b) < 0.0001, m + " (esperado " + b + ", veio " + a + ")"); }
console.log("=== Holerite — conferência com o recibo do contador ===");

// ---- INSS: truncado em centavos pelo método "alíquota × base − parcela a deduzir" ----
eq(F.inss(1800), 137.68, "INSS 1.800 = 137,68 (Luiza)");
eq(F.inss(1758.08), 133.90, "INSS 1.758,08 = 133,90 (Vitória; arredondar daria 133,91)");
eq(F.inss(1621), 121.57, "INSS no salário mínimo");
eq(F.inss(2902.84), 236.93, "INSS no fim da 2ª faixa");
eq(F.inss(3500), 308.60, "INSS 3.500 = 12% − 111,40");
eq(F.inss(8475.55), 988.09, "teto = 988,09");
eq(F.inss(50000), 988.09, "acima do teto não passa de 988,09");
eq(F.inss(0), 0, "INSS de 0");
ok(F.inssRate(1800) === 0.09 && F.inssRate(1000) === 0.075 && F.inssRate(3000) === 0.12, "alíquota da faixa (vira a 'referência' 9,00)");

// ---- Luiza Morais dos Santos da Silva — setembro/2026 ----
const luiza = F.computePayslip({ monthKey: "2026-09", regime: "clt", baseSalary: 1800, hireDate: "2026-02-03", dependents: 0, advancePct: 40, vtPct: 6, familyChildren: 0, commissionDevido: 0, commissionPago: 0, vales: [], extras: [] });
eq(luiza.totalEarnings, 1800, "Luiza: total de vencimentos 1.800,00");
eq(luiza.totalDeductions, 965.68, "Luiza: total de descontos 965,68");
eq(luiza.net, 834.32, "Luiza: líquido 834,32");
const L = n => luiza.deductions.find(d => d.num === n);
eq(L(11).amount, 137.68, "Luiza: INSS"); eq(L(11).ref, 9, "Luiza: referência do INSS 9,00");
eq(L(12).amount, 720, "Luiza: Adiantamento Anterior = 40% = 720,00");
eq(L(109).amount, 108, "Luiza: Desc. Vale Transporte 6% = 108,00"); eq(L(109).ref, 6, "Luiza: referência do VT 6,00");
ok(luiza.earnings.length === 1 && luiza.earnings[0].num === 1 && luiza.earnings[0].ref === 30, "Luiza: só o salário, referência 30,00 dias");
eq(luiza.bases.salary, 1800, "Luiza: salário base"); eq(luiza.bases.inss, 1800, "Luiza: Sal.Contr.INSS");
eq(luiza.bases.fgts, 1800, "Luiza: base FGTS"); eq(luiza.bases.fgtsValue, 144, "Luiza: FGTS do mês 144,00");
eq(luiza.bases.irrf, 1080, "Luiza: base IRRF do contador (salário − adiantamento) = 1.080,00");
ok(luiza.bases.irrfBand === "Isento" && luiza.irrf.tax === 0, "Luiza: IRRF isento");
ok(luiza.warnings.length === 0, "Luiza: sem avisos");

// ---- Vitória Rodrigues Santos — setembro/2026 (1 filho no salário-família) ----
const vit = F.computePayslip({ monthKey: "2026-09", regime: "clt", baseSalary: 1758.08, hireDate: "2026-06-12", dependents: 0, advancePct: 40, vtPct: 6, familyChildren: 1, commissionDevido: 0, commissionPago: 0, vales: [], extras: [] });
eq(vit.totalEarnings, 1825.62, "Vitória: total de vencimentos 1.825,62");
eq(vit.totalDeductions, 942.61, "Vitória: total de descontos 942,61");
eq(vit.net, 883.01, "Vitória: líquido 883,01");
const V = n => vit.deductions.find(d => d.num === n), VE = n => vit.earnings.find(e => e.num === n);
eq(V(11).amount, 133.90, "Vitória: INSS"); eq(V(12).amount, 703.23, "Vitória: adiantamento 40% = 703,23");
eq(V(109).amount, 105.48, "Vitória: VT 6% = 105,48");
eq(VE(4).amount, 67.54, "Vitória: Salário Família 67,54"); eq(VE(4).ref, 1, "Vitória: referência 1 filho");
eq(vit.bases.inss, 1758.08, "Vitória: salário-família NÃO entra na base do INSS");
eq(vit.bases.fgtsValue, 140.65, "Vitória: FGTS do mês 140,65");
eq(vit.bases.irrf, 1054.85, "Vitória: base IRRF do contador 1.054,85");

// ---- salário-família: limite de renda e regra de não tributação ----
let p = F.computePayslip({ monthKey: "2026-09", regime: "clt", baseSalary: 2500, hireDate: null, familyChildren: 2, vales: [], extras: [] });
ok(!p.earnings.some(e => e.num === 4) && p.warnings.some(w => /salário-família/.test(w)), "acima de R$ 1.980,38 não tem salário-família (e avisa)");
p = F.computePayslip({ monthKey: "2026-09", regime: "clt", baseSalary: 1980.38, hireDate: null, familyChildren: 2, vales: [], extras: [] });
eq(p.earnings.find(e => e.num === 4).amount, 135.08, "no limite (1.980,38) ainda tem direito: 2 filhos = 135,08");

// ---- sem as regras novas, o cálculo antigo continua igual (nada de adiantamento/VT escondido) ----
p = F.computePayslip({ monthKey: "2026-09", regime: "clt", baseSalary: 1800, hireDate: null, vales: [], extras: [] });
ok(!p.deductions.some(d => d.num === 12 || d.num === 109) && Math.abs(p.net - (1800 - 137.68)) < 0.001, "advancePct/vtPct = 0 → só o INSS desconta");
// proporcional à admissão: referência em dias
p = F.computePayslip({ monthKey: "2026-09", regime: "clt", baseSalary: 3000, hireDate: "2026-09-16", vtPct: 6, advancePct: 40, vales: [], extras: [] });
eq(p.earnings[0].amount, 1500, "admitida em 16/09: 15/30 do salário");
ok(p.earnings[0].ref === 15, "referência = 15 dias");
eq(p.vt, 90, "VT 6% sobre o salário proporcional"); eq(p.advance, 600, "adiantamento 40% sobre o salário proporcional");
// vales avulsos continuam descontando à parte
p = F.computePayslip({ monthKey: "2026-09", regime: "clt", baseSalary: 1800, hireDate: null, advancePct: 40, vtPct: 6, vales: [{ id: "v", description: "Vale", amount: 50, included: true }, { id: "w", description: "Vale 2", amount: 80, included: false }], extras: [] });
eq(p.net, 834.32 - 50, "vale marcado desconta à parte do adiantamento; desmarcado não");
ok(p.deductions.filter(d => d.num === 15).length === 1, "só 1 vale avulso (código 15)");
// regime sem desconto legal: não tem INSS/FGTS, mas adiantamento e VT seguem a configuração
p = F.computePayslip({ monthKey: "2026-09", regime: "none", baseSalary: 2000, hireDate: null, advancePct: 40, vtPct: 0, vales: [], extras: [] });
ok(p.inss === 0 && p.fgts === 0 && p.bases.irrf === 0 && p.advance === 800 && p.net === 1200, "regime sem desconto legal");

console.log("\n" + passed + " passaram, " + failed + " falharam");
process.exit(failed ? 1 : 0);
