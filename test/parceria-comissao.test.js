/* ============================================================
   Teste automatizado — Forma de pagamento "Parceria" não pode gerar
   comissionamento (assets/js/comissoes.js + assets/js/extrato-comissao.js
   + assets/js/utils.js/isParceriaAppt).

   A pedido do usuário (19/09/2026), verbatim (resumido): "A forma de
   pagamento 'Parceria' não pode gerar comissionamento para o
   profissional. Os atendimentos vinculados a 'parceria' precisam
   descontar do profissional o valor dos consumos dos produtos e não
   gerar nenhuma receita."

   BUG relatado: um atendimento de Parceria (Dra. Natasha) tinha sido
   contabilizado como comissão comum para o profissional Francisco —
   Utils.apptCommissionSplit() não distinguia Parceria, então o campo
   "% do Profissional (Parceria)" (reaproveitado de appt.commissionPercent,
   ver agenda.js/parceriaSplitFieldHtml) virava comissão de verdade em vez
   de zero.

   AJUSTE (19/09/2026, mesmo dia — esclarecimento do usuário): a primeira
   correção tinha ido longe demais na outra direção, transformando a %
   negociada num DESCONTO do saldo do profissional. O usuário esclareceu:
   como o cliente nunca é cobrado por um atendimento de Parceria, o
   profissional também não pode "perder" nada pelo VALOR do serviço em
   si — nem ganha (comissão), nem perde (desconto). O único custo real
   que desconta o profissional num atendimento de Parceria é o consumo
   de produtos/insumos usados nele, já tratado de forma independente e
   sempre correta por Consumo.deductionForRange (percentual configurável
   por lançamento, padrão 50/50, sem relação com a forma de pagamento).

   Este teste carrega comissoes.js E extrato-comissao.js de verdade num
   único jsdom (ids não colidem: prefixo "cm-" e "tbl-commission" de um
   lado, "ec-" e "tbl-ec" do outro), com um DB falso que inclui:
   - 1 atendimento normal (Pix, R$100, comissão 20%) — deve gerar R$20 de
     comissão normalmente (não é sobre Parceria que este teste desconfia).
   - 2 atendimentos de Parceria do mesmo profissional (R$200 e R$80 de
     base) — nenhum dos dois pode gerar comissão NEM desconto pelo valor
     do serviço.
   - 1 consumo de insumo vinculado ao atendimento de Parceria de R$200,
     para confirmar que o desconto de consumo continua funcionando
     normalmente e de forma independente da forma de pagamento (nunca
     somado como comissão, sempre subtraído — o único efeito real que
     Parceria tem sobre o saldo do profissional).

   Uso: node test/parceria-comissao.test.js
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

const HTML =
  '<!doctype html><html><body>' +
  // --- Comissionamento (comissoes.js) ---
  '<div class="pf-custom-range" id="cm-custom-range">' +
  '  <input type="date" id="cm-date-start">' +
  '  <input type="date" id="cm-date-end">' +
  '</div>' +
  '<div class="hint" id="cm-hint"></div>' +
  '<button id="btn-com-pdf"></button>' +
  '<button id="btn-com-send-admins"></button>' +
  '<button id="btn-new-bonus"></button>' +
  '<div id="com-summary"></div>' +
  '<div class="card-header-sub" id="com-chart-sub"></div>' +
  '<div class="card-header-sub" id="com-ranking-sub"></div>' +
  '<div id="chart-commission"></div>' +
  '<div id="chart-commission-ranking"></div>' +
  '<div class="com-bulk-bar" id="com-bulk-bar"><div id="com-bulk-count"></div><button id="btn-com-bulk-pay"></button></div>' +
  '<table id="tbl-commission"></table>' +
  // --- Extrato do Profissional (extrato-comissao.js) ---
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
  '<div id="ec-assistant-deduct" style="display:none;"></div>' +
  '<div id="ec-consumo" style="display:none;"></div>' +
  '<div id="ec-bonus" style="display:none;"></div>' +
  '<div id="toast-stack"></div>' +
  '</body></html>';

const dom = new JSDOM(HTML, { url: "http://localhost/parceria.html", runScripts: "dangerously" });
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
const Modal = window.Modal;

const today = Utils.todayISO();
const currentMonthKey = Utils.monthKey(today);

function monthLastDayStr(monthKey) {
  var parts = monthKey.split("-").map(Number);
  var lastDay = new Date(parts[0], parts[1], 0).getDate();
  return monthKey + "-" + String(lastDay).padStart(2, "0");
}
const fullMonthStart = currentMonthKey + "-01";
const fullMonthEnd = monthLastDayStr(currentMonthKey);
const d05 = currentMonthKey + "-05";
const d10 = currentMonthKey + "-10";
const d15 = currentMonthKey + "-15";

const tables = {
  employees: [
    { id: "emp1", name: "Francisco", role: "Barbeiro", status: "ativo", commissionRate: 20 }
  ],
  appointments: [
    // Atendimento normal — não é Parceria, comissão deve continuar normal.
    { id: "aNormal", date: d05, time: "09:00", employeeId: "emp1", serviceId: "svc1", clientId: "cNormal", price: 100, status: "concluido", paymentMethod: "Pix" },
    // Atendimento de Parceria (R$200) — commissionPercent aqui é o MESMO
    // campo reaproveitado por agenda.js/parceriaSplitFieldHtml só para a
    // divisão do lançamento de despesa do salão na conclusão (contabilidade
    // interna do salão); não afeta mais o saldo do profissional de forma
    // alguma — nem soma comissão, nem desconta nada pelo valor do serviço.
    { id: "aParc50", date: d10, time: "10:00", employeeId: "emp1", serviceId: "svc1", clientId: "cNatasha", price: 200, status: "concluido", paymentMethod: "Parceria", commissionPercent: 50 },
    // Segundo atendimento de Parceria (R$80) — mesmo raciocínio, valor
    // diferente só para garantir que a exclusão não depende do valor.
    { id: "aParc100", date: d15, time: "11:00", employeeId: "emp1", serviceId: "svc1", clientId: "cNatasha", price: 80, status: "concluido", paymentMethod: "Parceria", commissionPercent: 100 }
  ],
  services: [{ id: "svc1", name: "Corte Masculino" }],
  clients: [
    { id: "cNormal", name: "Maria" },
    { id: "cNatasha", name: "Dra. Natasha" }
  ],
  categories: [{ id: "cat-comissao", name: "Comissões" }],
  costCenters: [{ id: "cc-rh", key: "rh" }],
  commissionBonuses: [],
  // Consumo de insumo vinculado ao atendimento de Parceria de 50% — deve
  // continuar sendo descontado normalmente (independente do desconto de
  // Parceria, nunca somado como comissão).
  productConsumptions: [
    { id: "cons1", employeeId: "emp1", productId: "p1", appointmentId: "aParc50", quantity: 5, unit: "ml", totalCost: 30, employeeShare: 15, companyShare: 15, date: d10, notes: "" }
  ],
  transactions: [],
  paymentMethods: [
    { id: "pmt_pix", name: "Pix", isParceria: false },
    { id: "pmt_parceria", name: "Parceria", isParceria: true }
  ]
};
let _nextId = 100;

const DB = {
  all: function (table) { return (tables[table] || []).slice(); },
  get: function (table, id) { return (tables[table] || []).find(function (r) { return r.id === id; }) || null; },
  findOne: function (table, pred) { return (tables[table] || []).find(pred) || null; },
  insert: function (table, obj) {
    var rec = Object.assign({ id: "gen" + (_nextId++) }, obj);
    (tables[table] || (tables[table] = [])).push(rec);
    return rec;
  },
  update: function (table, id, patch) {
    var arr = tables[table] || [];
    var rec = arr.find(function (r) { return r.id === id; });
    if (rec) Object.assign(rec, patch);
    return rec;
  },
  remove: function (table, id) { tables[table] = (tables[table] || []).filter(function (r) { return r.id !== id; }); },
  removeWhere: function (table, pred) { tables[table] = (tables[table] || []).filter(function (r) { return !pred(r); }); },
  batch: function (fn) { fn(); },
  log: function () {},
  getPaymentMethods: function () { return tables.paymentMethods || []; },
  ready: Promise.resolve()
};
window.DB = DB;

window.Charts = {
  palette: ["#111", "#222", "#333"],
  bar: function () {},
  line: function () {},
  rankingList: function () {}
};
window.Toast = { show: function () {} };

loadScriptInWindow("assets/js/consumo.js");
loadScriptInWindow("assets/js/comissoes.js");
loadScriptInWindow("assets/js/extrato-comissao.js");

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(label + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); console.log("FAIL: " + label + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); }
}

function flush() {
  return new Promise(function (resolve) { setTimeout(resolve, 20); });
}

function moneyIn(text, value) {
  return typeof text === "string" && text.indexOf(Utils.fmtMoney(value)) !== -1;
}

function franciscoRowCM() {
  var rows = Utils.qsa("#tbl-commission tbody tr");
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].textContent.indexOf("Francisco") !== -1) return rows[i];
  }
  return null;
}
function cellText(row, colIndex) {
  var tds = row.querySelectorAll("td");
  return tds[colIndex] ? tds[colIndex].textContent.trim() : null;
}
function setRangeCM(start, end) {
  Utils.qs("#cm-date-start").value = start;
  Utils.qs("#cm-date-end").value = end;
  Utils.qs("#cm-date-end").dispatchEvent(new window.Event("change", { bubbles: true }));
}
function setRangeEC(start, end) {
  Utils.qs("#ec-date-start").value = start;
  Utils.qs("#ec-date-end").value = end;
  Utils.qs("#ec-date-end").dispatchEvent(new window.Event("change", { bubbles: true }));
}

(async function main() {
  console.log("=== Parceria não gera comissionamento — cenário de teste ===");
  console.log({ today: today, fullMonthStart: fullMonthStart, fullMonthEnd: fullMonthEnd });
  console.log("");

  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await flush();

  // ---- 0. Utils.isParceriaAppt — unidade isolada ----
  (function () {
    check("0: isParceriaAppt detecta forma de pagamento 'Parceria'", Utils.isParceriaAppt({ paymentMethod: "Parceria" }) === true);
    check("0: isParceriaAppt=false para 'Pix'", Utils.isParceriaAppt({ paymentMethod: "Pix" }) === false);
    check("0: isParceriaAppt=false sem paymentMethod", Utils.isParceriaAppt({}) === false);
  })();

  // ---- A. Comissionamento (comissoes.js) — mês inteiro ----
  setRangeCM(fullMonthStart, fullMonthEnd);
  await flush();
  (function () {
    var row = franciscoRowCM();
    check("A: linha do Francisco existe", !!row);
    if (!row) return;
    // Colunas: 0 checkbox, 1 Profissional, 2 Atend., 3 Receita, 4 Comissão,
    // 5 Descontos/Acréscimos, 6 Devido, 7 Pago, 8 Saldo, 9 ações.
    check("A: Atendimentos = 3 (inclui os 2 de Parceria na contagem)", cellText(row, 2) === "3", cellText(row, 2));
    check("A: Receita de Serviço = R$100,00 (só o atendimento normal — Parceria não gera receita)", moneyIn(cellText(row, 3), 100), cellText(row, 3));
    check("A: Comissão = R$20,00 (só 20% de R$100 — nenhuma comissão dos 2 atendimentos de Parceria)", moneyIn(cellText(row, 4), 20), cellText(row, 4));
    // Descontos/Acréscimos = bonusTotal(0) - consumoTotal(15) = -15 — os dois
    // atendimentos de Parceria (R$200 e R$80) NÃO entram aqui de forma
    // alguma (nem soma, nem desconto): só o consumo de insumo desconta.
    check("A: Descontos/Acréscimos = -R$15,00 (só o consumo — Parceria não desconta pelo valor do serviço)", moneyIn(cellText(row, 5), 15) && cellText(row, 5).indexOf("-") !== -1, cellText(row, 5));
    // Devido = 20 + 0 - 15 = 5
    check("A: Devido = R$5,00 (comissão normal menos consumo — nada relacionado à Parceria)", moneyIn(cellText(row, 6), 5) && cellText(row, 6).indexOf("-") === -1, cellText(row, 6));
  })();

  // ---- B. Modal "Ver detalhes" — atendimentos de Parceria mostram R$0,00
  // em Valor Cobrado e Comissão, com o desconto correspondente à parte ----
  (function () {
    var row = franciscoRowCM();
    if (!row) return;
    var detailsBtn = row.querySelector("[data-details]");
    check("B: botão 'Ver detalhes' existe", !!detailsBtn);
    if (!detailsBtn) return;
    detailsBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    var modalBody = document.querySelector(".modal-body");
    check("B: modal de detalhes abriu", !!modalBody);
    if (!modalBody) { return; }
    var mainTable = modalBody.querySelector("table");
    var bodyRows = mainTable ? mainTable.querySelectorAll("tbody tr") : [];
    check("B: tabela principal lista os 3 atendimentos", bodyRows.length === 3, bodyRows.length);
    var parc50Ok = false, parc100Ok = false, normalOk = false;
    bodyRows.forEach(function (tr) {
      var tds = tr.querySelectorAll("td");
      if (tds.length < 7) return;
      var dataHora = tds[0].textContent;
      var valorCobrado = tds[3].textContent.trim();
      var comissao = tds[6].textContent.trim();
      if (dataHora.indexOf(Utils.fmtDate(d10)) === 0) {
        parc50Ok = moneyIn(valorCobrado, 0) && moneyIn(comissao, 0) && tr.textContent.indexOf("Parceria") !== -1;
      } else if (dataHora.indexOf(Utils.fmtDate(d15)) === 0) {
        parc100Ok = moneyIn(valorCobrado, 0) && moneyIn(comissao, 0) && tr.textContent.indexOf("Parceria") !== -1;
      } else if (dataHora.indexOf(Utils.fmtDate(d05)) === 0) {
        normalOk = moneyIn(valorCobrado, 100) && moneyIn(comissao, 20) && tr.textContent.indexOf("Parceria") === -1;
      }
    });
    check("B: linha do atendimento de Parceria 50% mostra R$0,00 em Valor Cobrado e Comissão, com selo 'Parceria'", parc50Ok);
    check("B: linha do atendimento de Parceria 100% mostra R$0,00 em Valor Cobrado e Comissão, com selo 'Parceria'", parc100Ok);
    check("B: linha do atendimento normal continua mostrando R$100,00 / R$20,00, sem selo 'Parceria'", normalOk);
    check("B: seção 'Desconto por Atendimentos em Parceria' NÃO existe mais no modal (Parceria não desconta pelo valor do serviço)", modalBody.textContent.indexOf("Desconto por Atendimentos em Parceria") === -1);
    var grandTotalEl = modalBody.querySelector("#dm-grand-total");
    check("B: Resumo do Cálculo — Total Devido = R$5,00 (comissão R$20 menos consumo R$15, nada de Parceria)", grandTotalEl && moneyIn(grandTotalEl.textContent, 5), grandTotalEl && grandTotalEl.textContent);
    Modal.close();
  })();

  // ---- C. Extrato do Profissional (extrato-comissao.js) — mesmos números ----
  (function () {
    var empSel = Utils.qs("#ec-employee");
    empSel.value = "emp1";
    empSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  })();
  setRangeEC(fullMonthStart, fullMonthEnd);
  await flush();
  (function () {
    var summary = Utils.qs("#ec-summary");
    check("C: KPI 'Comissão do Período' = R$5,00 (mesmo valor de Devido do Comissionamento)", summary.textContent.indexOf("Comissão do Período") !== -1 && moneyIn(summary.textContent, 5));
    check("C: KPI 'Desconto por Parceria' NÃO existe mais (Parceria não desconta pelo valor do serviço)", summary.textContent.indexOf("Desconto por Parceria") === -1, summary.textContent);
    check("C: KPI 'Desconto por Consumo' aparece, com R$15,00 (único efeito real de Parceria no saldo)", summary.textContent.indexOf("Desconto por Consumo") !== -1 && moneyIn(summary.textContent, 15));

    var tbl = Utils.qs("#tbl-ec");
    var tfoot = tbl.querySelector("tfoot tr");
    // tfoot[0] é "Total (...)" com colspan=3 (Data/Hora+Cliente+Serviço),
    // então os TDs seguintes são: [1] Valor Cobrado, [2] Produtos,
    // [3] Repasse Assistente, [4] Comissão.
    var tfootTds = tfoot ? tfoot.querySelectorAll("td") : [];
    check("C: rodapé da tabela — Valor Cobrado total = R$100,00 (só o atendimento normal)", tfootTds[1] && moneyIn(tfootTds[1].textContent, 100), tfootTds[1] && tfootTds[1].textContent);
    check("C: rodapé da tabela — Comissão total = R$20,00", tfootTds[4] && moneyIn(tfootTds[4].textContent, 20), tfootTds[4] && tfootTds[4].textContent);

    // Ajuste (19/09/2026): a seção "ec-parceria" (e o contêiner no HTML)
    // foram removidos — não existe mais nenhuma seção de desconto por
    // Parceria no Extrato, já que Parceria não desconta nada pelo valor
    // do serviço.
    var parceriaEl = document.getElementById("ec-parceria");
    check("C: elemento 'ec-parceria' não existe mais no DOM do teste (removido do HTML)", !parceriaEl);
  })();

  console.log("");
  console.log("=== Resultado: " + pass + " passaram, " + fail + " falharam (" + (pass + fail) + " no total) ===");
  if (fail > 0) {
    console.log("Falhas:");
    failures.forEach(function (f) { console.log(" - " + f); });
    process.exit(1);
  }
})();
