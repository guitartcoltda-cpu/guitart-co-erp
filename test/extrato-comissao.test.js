/* ============================================================
   Teste automatizado da tela "Extrato do Profissional"
   (assets/js/extrato-comissao.js + assets/js/consumo.js).

   A pedido do usuário (09/09/2026), igual ao Comissionamento (ver
   test/comissoes.test.js), a tela deixou de ter um seletor de "Mês de
   Referência" com lista fixa de meses — agora só existe um período
   personalizado (De/Até), que o profissional ajusta livremente. Este
   teste cobre esse único modo, incluindo o caso "período = mês calendário
   inteiro" (equivalente ao antigo "modo mensal").

   Roda em Node via jsdom (script clássico, sem módulos): carrega
   utils.js, consumo.js e extrato-comissao.js de verdade (os arquivos
   publicados), com um `DB` FALSO em memória preenchido com o MESMO
   cenário de dados usado em comissoes.test.js, para poder comparar os
   números com os já validados lá (computeForEmployeeCurrent() replica
   exatamente a mesma lógica de computeRows()/bonusesFor() de
   comissoes.js).

   Uso: node test/extrato-comissao.test.js
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

const HTML =
  '<!doctype html><html><body>' +
  '<select id="ec-employee"></select>' +
  '<div class="pf-custom-range" id="ec-custom-range">' +
  '  <input type="date" id="ec-date-start">' +
  '  <input type="date" id="ec-date-end">' +
  '</div>' +
  '<div id="ec-summary"></div>' +
  '<div id="ec-payout"></div>' +
  '<div id="chart-ec-services"></div>' +
  '<div id="chart-ec-history"></div>' +
  '<table id="tbl-ec"></table>' +
  '<div id="ec-assistant" style="display:none;"></div>' +
  '<div id="ec-consumo" style="display:none;"></div>' +
  '<div id="ec-bonus" style="display:none;"></div>' +
  '<div id="toast-stack"></div>' +
  '</body></html>';

const dom = new JSDOM(HTML, { url: "http://localhost/extrato-comissao.html", runScripts: "dangerously" });
const window = dom.window;
const document = window.document;
global.window = window;
global.document = document;

function loadScriptInWindow(relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const el = document.createElement("script");
  el.textContent = code;
  document.body.appendChild(el);
}

loadScriptInWindow("assets/js/utils.js");
const Utils = window.Utils;

// ----------------------------------------------------------------
// Mesmo cenário de dados de test/comissoes.test.js, relativo à data real
// de execução do teste.
// ----------------------------------------------------------------
const today = Utils.todayISO();
const currentMonthKey = Utils.monthKey(today);
const previousMonthKey = Utils.monthKey(Utils.addMonths(today, -1));

const d05 = currentMonthKey + "-05";
const d10 = currentMonthKey + "-10";
const d20 = currentMonthKey + "-20";
const dPrevMonth = previousMonthKey + "-15";

function monthLastDayStr(monthKey) {
  var parts = monthKey.split("-").map(Number);
  var lastDay = new Date(parts[0], parts[1], 0).getDate();
  return monthKey + "-" + String(lastDay).padStart(2, "0");
}
// Período que representa "o mês corrente inteiro" — equivalente ao antigo
// "modo mensal" (De = dia 1, Até = último dia do mês).
const fullMonthStart = currentMonthKey + "-01";
const fullMonthEnd = monthLastDayStr(currentMonthKey);

const tables = {
  employees: [
    { id: "emp1", name: "Ana", role: "Cabeleireira", status: "ativo", commissionRate: 20 }
  ],
  appointments: [
    { id: "a1", date: d05, time: "09:00", employeeId: "emp1", serviceId: "svc1", clientId: "c1", price: 100, status: "concluido" },
    { id: "a2", date: d10, time: "10:00", employeeId: "emp1", serviceId: "svc1", clientId: "c1", price: 200, status: "concluido" },
    { id: "a3", date: d20, time: "11:00", employeeId: "emp1", serviceId: "svc1", clientId: "c1", price: 150, status: "concluido" },
    { id: "aPrev", date: dPrevMonth, time: "09:00", employeeId: "emp1", serviceId: "svc1", clientId: "c1", price: 999, status: "concluido" }
  ],
  services: [{ id: "svc1", name: "Corte" }],
  clients: [{ id: "c1", name: "Maria" }],
  categories: [{ id: "cat-comissao", name: "Comissões" }],
  costCenters: [{ id: "cc-rh", key: "rh" }],
  commissionBonuses: [
    { id: "b1", employeeId: "emp1", month: currentMonthKey, kind: "fixo", description: "Bônus meta", amount: 50, refValue: null, refPercent: null },
    { id: "b2", employeeId: "emp1", month: currentMonthKey, kind: "desconto", description: "Desconto material", amount: -20, refValue: null, refPercent: null },
    { id: "b3", employeeId: "emp1", month: currentMonthKey, date: d10, kind: "fixo", description: "Bônus pontual do dia 10", amount: 15, refValue: null, refPercent: null }
  ],
  productConsumptions: [
    { id: "c1", employeeId: "emp1", productId: "p1", appointmentId: "a2", quantity: 10, unit: "ml", totalCost: 20, employeeShare: 10, companyShare: 10, date: d10, notes: "" }
  ],
  transactions: [
    // Só relatedMonth, sem intervalo próprio — simula um pagamento feito
    // antes de a tela ter um período personalizado. Deve contar sempre que
    // o período em exibição contiver o mês inteiro, e nunca num corte mais
    // estreito (ver "Já Recebido" nos cenários abaixo).
    { id: "t1", type: "despesa", categoryId: "cat-comissao", employeeId: "emp1", relatedMonth: currentMonthKey, amount: 30, status: "pago", date: today }
  ]
};

const DB = {
  all: function (table) { return (tables[table] || []).slice(); },
  get: function (table, id) { return (tables[table] || []).find(function (r) { return r.id === id; }) || null; },
  findOne: function (table, pred) { return (tables[table] || []).find(pred) || null; },
  ready: Promise.resolve()
};
window.DB = DB;

window.Charts = {
  palette: ["#111", "#222", "#333"],
  bar: function () {},
  line: function (opts) { window.__lastLineChart = opts; }
};

loadScriptInWindow("assets/js/consumo.js");
loadScriptInWindow("assets/js/extrato-comissao.js");

// ----------------------------------------------------------------
// Mini test runner
// ----------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(label + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); console.log("FAIL: " + label + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); }
}

function flush() {
  return new Promise(function (resolve) { setTimeout(resolve, 20); });
}

function kpiValue(label) {
  var cards = Utils.qsa(".kpi-card", document.getElementById("ec-summary"));
  for (var i = 0; i < cards.length; i++) {
    var l = cards[i].querySelector(".kpi-label");
    if (l && l.textContent.trim() === label) {
      var v = cards[i].querySelector(".kpi-value");
      return v ? v.textContent.trim() : null;
    }
  }
  return null;
}

function payoutItem(label) {
  var items = Utils.qsa(".ec-payout-item", document.getElementById("ec-payout"));
  for (var i = 0; i < items.length; i++) {
    var l = items[i].querySelector(".ec-p-label");
    if (l && l.textContent.trim() === label) {
      return {
        value: items[i].querySelector(".ec-p-value").textContent.trim(),
        sub: items[i].querySelector(".ec-p-sub").textContent.trim()
      };
    }
  }
  return null;
}

function money(v) { return Utils.fmtMoney(v); }

function setCustomRange(start, end) {
  Utils.qs("#ec-date-start").value = start;
  Utils.qs("#ec-date-end").value = end;
  Utils.qs("#ec-date-end").dispatchEvent(new window.Event("change", { bubbles: true }));
}

(async function main() {
  console.log("=== Extrato do Profissional — cenário de teste ===");
  console.log({ today: today, currentMonthKey: currentMonthKey, previousMonthKey: previousMonthKey, d05: d05, d10: d10, d20: d20, dPrevMonth: dPrevMonth });
  console.log("");

  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await flush();

  // ---- A. Período = mês corrente inteiro ----
  setCustomRange(fullMonthStart, fullMonthEnd);
  await flush();
  check("A: Comissão do Período = 125 (90 comissão + 45 esporádico - 10 consumo)", kpiValue("Comissão do Período") === money(125), kpiValue("Comissão do Período"));
  check("A: Já Recebido = 30 (t1, contido no mês inteiro)", kpiValue("Já Recebido") === money(30), kpiValue("Já Recebido"));
  check("A: Saldo em Aberto = 95", kpiValue("Saldo em Aberto") === money(95), kpiValue("Saldo em Aberto"));
  check("A: Atendimentos no Período = 3", kpiValue("Atendimentos no Período") === "3", kpiValue("Atendimentos no Período"));
  var payoutA = payoutItem("Corte do Período");
  check("A: rótulo 'Corte do Período' presente", !!payoutA, payoutA);
  if (payoutA) check("A: Corte do Período = último dia do mês corrente", payoutA.value === Utils.fmtDate(fullMonthEnd), payoutA.value);

  // ---- B. Personalizado: 05 a 10 (exclui atendimento do dia 20) ----
  setCustomRange(d05, d10);
  await flush();

  check("B: Comissão do Período = 95 (60 comissão + 45 esporádico - 10 consumo)", kpiValue("Comissão do Período") === money(95), kpiValue("Comissão do Período"));
  check("B: Já Recebido = 0 (pagamento do mês inteiro não vaza para o corte)", kpiValue("Já Recebido") === money(0), kpiValue("Já Recebido"));
  check("B: Saldo em Aberto = 95", kpiValue("Saldo em Aberto") === money(95), kpiValue("Saldo em Aberto"));
  check("B: Atendimentos no Período = 2 (dias 05 e 10, exclui dia 20)", kpiValue("Atendimentos no Período") === "2", kpiValue("Atendimentos no Período"));
  var payoutB = payoutItem("Corte do Período");
  check("B: Corte do Período = fim do intervalo (dia 10)", payoutB && payoutB.value === Utils.fmtDate(d10), payoutB && payoutB.value);
  var repasseB = payoutItem("Próximo Repasse");
  var expectedPayoutMonth = currentMonthKey; // corte 05-10 termina no mês corrente
  var expectedPayoutDate = Utils.addMonths(expectedPayoutMonth + "-01", 1).slice(0, 8) + "05";
  check("B: Próximo Repasse ancorado no mês em que o corte termina (dia 05 do mês seguinte ao mês corrente)", repasseB && repasseB.value === Utils.fmtDate(expectedPayoutDate), repasseB && repasseB.value);

  // ---- C. Personalizado: 11 a 20 (exclui atendimentos dos dias 05 e 10, e o consumo do dia 10) ----
  setCustomRange(currentMonthKey + "-11", d20);
  await flush();
  check("C: Comissão do Período = 60 (30 comissão + 30 esporádico fallback - 0 consumo)", kpiValue("Comissão do Período") === money(60), kpiValue("Comissão do Período"));
  check("C: Atendimentos no Período = 1 (só o dia 20)", kpiValue("Atendimentos no Período") === "1", kpiValue("Atendimentos no Período"));

  // ---- D. Personalizado: período inteiro no MÊS ANTERIOR — verifica que o
  // corte, o repasse e o gráfico de histórico ancoram no mês em que o
  // período termina (referenceMonthKey()), não no mês corrente. ----
  setCustomRange(dPrevMonth, dPrevMonth);
  await flush();

  check("D: Comissão do Período = 199,8 (só o atendimento do mês anterior, sem esporádico/consumo do mês corrente)", kpiValue("Comissão do Período") === money(199.8), kpiValue("Comissão do Período"));
  var payoutD = payoutItem("Corte do Período");
  check("D: Corte do Período = a própria data do período (mês anterior)", payoutD && payoutD.value === Utils.fmtDate(dPrevMonth), payoutD && payoutD.value);
  var repasseD = payoutItem("Próximo Repasse");
  var expectedPayoutDateD = Utils.addMonths(previousMonthKey + "-01", 1).slice(0, 8) + "05"; // = dia 05 do mês corrente
  check("D: Próximo Repasse ancorado no mês seguinte ao mês ANTERIOR (não no mês corrente)", repasseD && repasseD.value === Utils.fmtDate(expectedPayoutDateD), repasseD && repasseD.value);

  var hist = window.__lastLineChart;
  check("D: gráfico de histórico foi desenhado", !!hist);
  if (hist) {
    var lastLabel = hist.categories[hist.categories.length - 1];
    check("D: último mês do histórico é o mês ANTERIOR (ancorado por referenceMonthKey, não o mês corrente)", lastLabel === Utils.monthLabel(previousMonthKey + "-01"), lastLabel);
  }

  // ---- E. Volta a ver o mês inteiro — pagamento avulso + pagamento do
  // corte semanal (cenário do Comissionamento não se aplica aqui, pois
  // esta tela não registra pagamento; o teste confere que o resultado é
  // idêntico ao cenário A, sem depender de qual período foi visto antes). ----
  setCustomRange(fullMonthStart, fullMonthEnd);
  await flush();
  check("E: Comissão do Período volta a 125 ao ver o mês inteiro de novo", kpiValue("Comissão do Período") === money(125), kpiValue("Comissão do Período"));
  check("E: rótulo 'Corte do Período' continua presente", !!payoutItem("Corte do Período"));

  // ---- F. Pagamento que cruza a virada do mês (começa no mês anterior,
  // termina já no mês corrente, mas com relatedMonth = mês corrente) —
  // reproduz o caso real de produção que expôs o bug do critério de
  // contenção pura em computeForEmployeeCurrent(). Visto o mês corrente
  // inteiro (ou "em andamento", Até = hoje), deve contar por inteiro pelo
  // relatedMonth, igual ao antigo modo mensal; visto um corte personalizado
  // mais estreito, não deve vazar para lá. ----
  tables.transactions.push({
    id: "tCross", type: "despesa", categoryId: "cat-comissao", employeeId: "emp1",
    relatedMonth: currentMonthKey, relatedRangeStart: monthLastDayStr(previousMonthKey), relatedRangeEnd: currentMonthKey + "-02",
    amount: 77, status: "pago", date: currentMonthKey + "-02"
  });

  setCustomRange(fullMonthStart, fullMonthEnd);
  await flush();
  check("F1: Já Recebido = 107 no mês inteiro (30 do t1 + 77 do pagamento que cruza a virada do mês, pelo relatedMonth)", kpiValue("Já Recebido") === money(107), kpiValue("Já Recebido"));

  setCustomRange(fullMonthStart, today);
  await flush();
  check("F2: Já Recebido = 107 com Até = hoje (mês corrente em andamento continua valendo como 'o mês')", kpiValue("Já Recebido") === money(107), kpiValue("Já Recebido"));

  setCustomRange(d05, d10);
  await flush();
  check("F3: Já Recebido = 0 no corte 05-10 (pagamento que cruza a virada do mês não vaza para um corte mais estreito)", kpiValue("Já Recebido") === money(0), kpiValue("Já Recebido"));

  console.log("");
  console.log("=== Resultado: " + pass + " passaram, " + fail + " falharam (" + (pass + fail) + " no total) ===");
  if (fail > 0) {
    console.log("Falhas:");
    failures.forEach(function (f) { console.log(" - " + f); });
    process.exit(1);
  }
})();
