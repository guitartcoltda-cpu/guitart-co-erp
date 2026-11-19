/* ============================================================
   Teste — fechamento definitivo de comissão (livro-razão item a item,
   19/11/2026). Pedido do João: "fechou a comissão, pagou os profissionais,
   pronto" — o que entrou num pagamento aparece pago em QUALQUER filtro e
   nunca mais entra em cálculo novo; pagamento em duplicidade aparece na
   auditoria.
   Uso: node test/comissao-fechamento.test.js
   ============================================================ */
"use strict";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");

const HTML = '<!doctype html><html><body>' +
  '<input type="date" id="cm-date-start"><input type="date" id="cm-date-end">' +
  '<button id="btn-com-pdf"></button><button id="btn-com-send-admins"></button><button id="btn-new-bonus"></button>' +
  '<div id="com-summary"></div><div id="com-chart-sub"></div><div id="com-ranking-sub"></div>' +
  '<div id="chart-commission"></div><div id="chart-commission-ranking"></div>' +
  '<div id="com-bulk-bar"><div id="com-bulk-count"></div><button id="btn-com-bulk-pay"></button></div>' +
  '<table id="tbl-commission"></table><div id="toast-stack"></div></body></html>';
const dom = new JSDOM(HTML, { url: "http://localhost/comissoes.html", runScripts: "dangerously" });
const window = dom.window, document = window.document;
function load(rel) { const el = document.createElement("script"); el.textContent = fs.readFileSync(path.join(ROOT, rel), "utf8"); document.body.appendChild(el); }
load("assets/js/utils.js");
const Utils = window.Utils;

const MK = "2026-08";
const d = n => MK + "-" + String(n).padStart(2, "0");
const tables = {
  employees: [
    { id: "ana", name: "Ana", role: "Cabeleireira", status: "ativo", commissionRate: 20 },
    { id: "bru", name: "Bruno", role: "Barbeiro", status: "ativo", commissionRate: 15 }
  ],
  appointments: [
    { id: "a03", date: d(3), time: "09:00", employeeId: "ana", serviceId: "s", clientId: "c", price: 100, status: "concluido" },
    { id: "a05", date: d(5), time: "09:00", employeeId: "ana", serviceId: "s", clientId: "c", price: 100, status: "concluido" },
    { id: "a10", date: d(10), time: "09:00", employeeId: "ana", serviceId: "s", clientId: "c", price: 100, status: "concluido" },
    { id: "b03", date: d(3), time: "10:00", employeeId: "bru", serviceId: "s", clientId: "c", price: 200, status: "concluido" }
  ],
  services: [{ id: "s", name: "Corte" }], clients: [{ id: "c", name: "Maria" }],
  categories: [{ id: "catc", name: "Comissões" }], costCenters: [{ id: "rh", key: "rh" }],
  commissionBonuses: [], productConsumptions: [],
  transactions: [
    // Bruno: DOIS pagamentos antigos para a mesma semana (duplicidade real)
    { id: "old1", type: "despesa", categoryId: "catc", employeeId: "bru", amount: 30, date: d(8), relatedMonth: MK, relatedRangeStart: d(1), relatedRangeEnd: d(7), createdAt: "2026-08-08T10:00:00Z" },
    { id: "old2", type: "despesa", categoryId: "catc", employeeId: "bru", amount: 30, date: d(9), relatedMonth: MK, relatedRangeStart: d(1), relatedRangeEnd: d(7), createdAt: "2026-08-09T10:00:00Z" }
  ]
};
let seq = 1;
window.DB = {
  all: t => (tables[t] || []).slice(), get: (t, id) => (tables[t] || []).find(r => r.id === id) || null,
  findOne: (t, p) => (tables[t] || []).find(p) || null,
  insert: (t, o) => { const r = Object.assign({ id: "n" + (seq++), createdAt: new Date(Date.UTC(2026, 7, 20, 0, 0, seq)).toISOString() }, o); (tables[t] || (tables[t] = [])).push(r); return r; },
  update: (t, id, p) => Object.assign((tables[t] || []).find(r => r.id === id) || {}, p),
  remove: (t, id) => { tables[t] = (tables[t] || []).filter(r => r.id !== id); }, removeWhere: () => {},
  batch: fn => fn(), log: () => {}, ready: Promise.resolve(), getPaymentMethods: () => [{ name: "Pix" }]
};
window.Charts = { palette: ["#1", "#2", "#3"], bar() {}, rankingList() {} };
const toasts = [];
window.Toast = { show: m => toasts.push(m) };
load("assets/js/consumo.js");
load("assets/js/comissoes.js");

let pass = 0, fail = 0;
function ok(c, m, det) { if (c) pass++; else { fail++; console.log("  FALHOU: " + m + (det !== undefined ? " — " + JSON.stringify(det) : "")); } }
const flush = () => new Promise(r => setTimeout(r, 25));
function range(a, b) {
  document.getElementById("cm-date-start").value = a; document.getElementById("cm-date-end").value = b;
  document.getElementById("cm-date-end").dispatchEvent(new window.Event("change", { bubbles: true }));
}
function row(name) { return Array.from(document.querySelectorAll("#tbl-commission tbody tr")).find(r => r.textContent.indexOf(name) !== -1) || null; }
const cell = (r, i) => r ? r.querySelectorAll("td")[i].textContent.trim() : "";
const has = (txt, v) => txt.indexOf(Utils.fmtMoney(v)) !== -1;
const commPays = () => tables.transactions.filter(t => t.categoryId === "catc" && t.employeeId === "ana");

(async function () {
  console.log("=== Fechamento definitivo de comissão (livro-razão) ===");
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await flush();

  // 1) Ana fecha a semana 01-07 (a03 + a05 = R$ 40)
  range(d(1), d(7)); await flush();
  ok(has(cell(row("Ana"), 8), 40), "1a: semana 01-07 com R$ 40 a pagar", cell(row("Ana"), 8));
  row("Ana").querySelector("[data-pay]").click();
  ok(document.querySelector("#pay-amount").disabled, "1b: valor do pagamento não é digitado (fechamento exato)");
  document.querySelector("#pay-save").click(); await flush();
  const p1 = commPays()[0];
  ok(p1 && p1.amount === 40 && p1.commissionItems.map(i => i.key).sort().join() === "am:a03,am:a05", "1c: pagamento grava os itens quitados", p1);

  // 2) Em QUALQUER filtro o que foi pago aparece pago
  range(d(1), d(31)); await flush();
  ok(has(cell(row("Ana"), 7), 40) && has(cell(row("Ana"), 8), 20), "2a: mês inteiro: pago 40, falta só a10 (20)", [cell(row("Ana"), 7), cell(row("Ana"), 8)]);
  range(d(5), d(12)); await flush();
  ok(has(cell(row("Ana"), 7), 20) && has(cell(row("Ana"), 8), 20), "2b: filtro 05-12 (cruza o fechamento): a05 aparece pago, só a10 em aberto", [cell(row("Ana"), 7), cell(row("Ana"), 8)]);
  range(d(4), d(6)); await flush();
  ok(has(cell(row("Ana"), 8), 0) && /Pago/.test(cell(row("Ana"), 8)) && !row("Ana").querySelector("[data-pay]"), "2c: filtro 04-06: tudo pago, sem botão de pagar", cell(row("Ana"), 8));

  // 3) Pagar o mês inteiro agora paga SÓ o que falta (nunca de novo a03/a05)
  range(d(1), d(31)); await flush();
  const chk = document.querySelector(".com-row-check[data-id='ana']");
  chk.checked = true; chk.dispatchEvent(new window.Event("change", { bubbles: true }));
  document.getElementById("btn-com-bulk-pay").click(); await flush();
  const p2 = commPays()[1];
  ok(p2 && p2.amount === 20 && p2.commissionItems.length === 1 && p2.commissionItems[0].key === "am:a10", "3a: pagamento em lote do mês quita só a10 (R$ 20)", p2);
  ok(commPays().length === 2, "3b: nenhum pagamento extra");
  [[d(1), d(31)], [d(1), d(7)], [d(8), d(31)], [d(3), d(3)]].forEach(r => {
    range(r[0], r[1]);
  });
  await flush();
  range(d(1), d(31)); await flush();
  ok(has(cell(row("Ana"), 8), 0), "3c: mês todo quitado", cell(row("Ana"), 8));

  // 4) Alterar um atendimento já pago não muda a comissão fechada
  window.DB.update("appointments", "a03", { price: 500 });
  Utils.invalidateCommissionLedger();
  range(d(1), d(31)); await flush();
  ok(has(cell(row("Ana"), 6), 60) && has(cell(row("Ana"), 8), 0), "4a: a03 alterado depois do pagamento: devido continua 60 (valor do fechamento) e nada a pagar", [cell(row("Ana"), 6), cell(row("Ana"), 8)]);

  // 5) Duplicidade (Bruno): 2 pagamentos antigos para a mesma semana
  const L = Utils.commissionLedger();
  const dup = L.excess.filter(x => x.txn.employeeId === "bru");
  ok(dup.length === 1 && dup[0].txn.id === "old2" && dup[0].amount === 30, "5a: o 2º pagamento do Bruno aparece como duplicidade (R$ 30 sem item)", dup.map(x => [x.txn.id, x.amount]));
  const audit = document.getElementById("com-audit");
  ok(!audit || audit.textContent.trim() === "", "5b: painel de auditoria NÃO aparece na tela (oculto a pedido do João em 19/11/2026; o cálculo continua)");
  ok(has(cell(row("Bruno"), 8), 0) && !/sem item/.test(cell(row("Bruno"), 7)), "5c: Bruno sem nada a pagar e sem aviso 'sem item' em Pago", [cell(row("Bruno"), 7), cell(row("Bruno"), 8)]);

  // 6) Modal aberto + outra pessoa paga antes => não paga de novo
  window.DB.insert("appointments", { id: "a20", date: d(20), time: "09:00", employeeId: "ana", serviceId: "s", clientId: "c", price: 100, status: "concluido" });
  Utils.invalidateCommissionLedger();
  await flush();
  range(d(1), d(31)); await flush();
  row("Ana").querySelector("[data-pay]").click();
  window.DB.insert("transactions", { type: "despesa", categoryId: "catc", employeeId: "ana", amount: 20, date: d(21), relatedMonth: MK, relatedRangeStart: d(1), relatedRangeEnd: d(31), commissionItems: [{ key: "am:" + tables.appointments.find(a => a.date === d(20)).id, amount: 20 }] });
  const before = commPays().length;
  document.querySelector("#pay-save").click(); await flush();
  ok(commPays().length === before && toasts.some(t => /já foi pago/.test(t)), "6a: pagamento concorrente detectado — nada lançado em dobro", toasts.slice(-2));

  // 6b) Pagamento antigo do MÊS (só relatedMonth) abaixo do calculado: fecha o
  //     mês mesmo assim (nada volta a cobrar) e a diferença vai para a auditoria
  tables.employees.push({ id: "cid", name: "Cida", role: "Manicure", status: "ativo", commissionRate: 50 });
  tables.appointments.push({ id: "c1", date: d(2), time: "09:00", employeeId: "cid", serviceId: "s", clientId: "c", price: 100, status: "concluido" },
                           { id: "c2", date: d(25), time: "09:00", employeeId: "cid", serviceId: "s", clientId: "c", price: 100, status: "concluido" });
  tables.transactions.push({ id: "oldMes", type: "despesa", categoryId: "catc", employeeId: "cid", amount: 60, date: d(28), relatedMonth: MK });
  Utils.invalidateCommissionLedger();
  await flush();
  range(d(20), d(31)); await flush();
  ok(has(cell(row("Cida"), 8), 0) && !row("Cida").querySelector("[data-pay]"), "6b: mês já pago (antigo, R$ 60 de R$ 100): nada a pagar em nenhum corte", cell(row("Cida"), 8));
  const sf = Utils.commissionLedger().shortfalls.filter(x => x.txn.id === "oldMes");
  ok(sf.length === 1 && sf[0].amount === 40, "6c: diferença de R$ 40 listada na auditoria (pago abaixo do calculado)", sf);
  const audit6 = document.getElementById("com-audit");
  ok(!audit6 || audit6.textContent.trim() === "", "6d: auditoria de diferença também fica oculta");

  // 7) Agenda/Aprovações enxergam o fechamento item a item
  Utils.invalidateCommissionLedger();
  ok(Utils.apptCommissionPayments(window.DB.get("appointments", "a05")).map(t => t.id).join() === p1.id, "7a: a05 ligado ao pagamento que o quitou");
  ok(Utils.apptCommissionPayments({ id: "nao-existe" }).length === 0, "7b: atendimento sem pagamento");

  console.log("\n" + pass + " passaram, " + fail + " falharam");
  process.exit(fail ? 1 : 0);
})();
