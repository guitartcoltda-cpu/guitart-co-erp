/* ============================================================
   Teste automatizado da tela de Comissionamento
   (assets/js/comissoes.js + assets/js/consumo.js), focado na nova
   opção "Personalizar data de corte" — filtro de período arbitrário
   para apurar comissão de profissionais pagos semanal/quinzenalmente,
   em vez de só por mês calendário inteiro.

   Roda em Node via jsdom (script clássico, sem módulos): carrega
   utils.js, consumo.js e comissoes.js de verdade (os arquivos publicados), com
   um `DB` FALSO em memória preenchido com um cenário conhecido, para
   poder conferir os números exatos que a tabela renderiza.

   Como comissoes.js não expõe nenhuma API em `window` (é 100%
   orientado a DOM, disparado por DOMContentLoaded + DB.ready), o
   teste dispara manualmente um evento "DOMContentLoaded" sintético
   depois de injetar o script, e espera a cadeia DB.ready.then(...) +
   setTimeout(init, 0) resolver antes de inspecionar a tabela.

   Uso: node test/comissoes.test.js
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

const HTML =
  '<!doctype html><html><body>' +
  '<select id="cm-month"></select>' +
  '<div class="pf-custom-range" id="cm-custom-range" style="display:none;">' +
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
  '<div id="toast-stack"></div>' +
  '</body></html>';

const dom = new JSDOM(HTML, { url: "http://localhost/comissoes.html", runScripts: "dangerously" });
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

// ----------------------------------------------------------------
// Cenário fixo de dados, relativo à data real de execução do teste —
// evita datas fixas que quebrariam o teste dependendo de quando ele é rodado.
// ----------------------------------------------------------------
const today = Utils.todayISO();
const currentMonthKey = Utils.monthKey(today);
const previousMonthKey = Utils.monthKey(Utils.addMonths(today, -1));

const d05 = currentMonthKey + "-05";
const d10 = currentMonthKey + "-10";
const d20 = currentMonthKey + "-20";
const dPrevMonth = previousMonthKey + "-15";

const tables = {
  employees: [
    { id: "emp1", name: "Ana", role: "Cabeleireira", status: "ativo", commissionRate: 20 },
    { id: "emp2", name: "Bruno", role: "Barbeiro", status: "ativo", commissionRate: 15 }
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
    // b1/b2 simulam lançamentos ANTIGOS, de antes da apuração passar a usar
    // a data exata (só têm `month`, sem `date`) — devem continuar entrando
    // pela aproximação por mês tocado (fallback em bonusesFor/sporadicDiscountTotal).
    { id: "b1", employeeId: "emp1", month: currentMonthKey, kind: "fixo", description: "Bônus meta", amount: 50, refValue: null, refPercent: null },
    { id: "b2", employeeId: "emp1", month: currentMonthKey, kind: "desconto", description: "Desconto material", amount: -20, refValue: null, refPercent: null },
    // b3 é um lançamento NOVO, com data própria (dia 10) — deve entrar só em
    // cortes personalizados que efetivamente tocam o dia 10, ao contrário de
    // b1/b2 que entram em qualquer corte que toque o mês inteiro.
    { id: "b3", employeeId: "emp1", month: currentMonthKey, date: d10, kind: "fixo", description: "Bônus pontual do dia 10", amount: 15, refValue: null, refPercent: null }
  ],
  productConsumptions: [
    // vinculado ao atendimento a2 (dia 10) — usado tanto para descontar o
    // Devido (já coberto pelos cenários A-H) quanto para conferir a coluna
    // "Produtos" no modal de detalhes (cenário I), que mostra esse desconto
    // junto à linha do atendimento correspondente (mesmo padrão do Extrato
    // do Profissional).
    { id: "c1", employeeId: "emp1", productId: "p1", appointmentId: "a2", quantity: 10, unit: "ml", totalCost: 20, employeeShare: 10, companyShare: 10, date: d10, notes: "" }
  ],
  transactions: [
    // Pagamento pré-existente do mês inteiro (sem tag de intervalo — simula um pagamento feito antes desta funcionalidade existir, ou feito em modo mensal).
    { id: "t1", type: "despesa", categoryId: "cat-comissao", employeeId: "emp1", relatedMonth: currentMonthKey, amount: 30, status: "pago", date: today }
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
  remove: function (table, id) {
    tables[table] = (tables[table] || []).filter(function (r) { return r.id !== id; });
  },
  removeWhere: function (table, pred) {
    tables[table] = (tables[table] || []).filter(function (r) { return !pred(r); });
  },
  batch: function (fn) { fn(); },
  log: function () {},
  ready: Promise.resolve()
};
window.DB = DB;

// Stubs mínimos das dependências visuais que comissoes.js chama durante
// render() — não precisam desenhar nada de verdade, só não explodir.
window.Charts = {
  palette: ["#111", "#222", "#333"],
  bar: function () {},
  rankingList: function () {}
};
window.Toast = { show: function () {} };

loadScriptInWindow("assets/js/consumo.js");
loadScriptInWindow("assets/js/comissoes.js");

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
  // deixa a cadeia DB.ready.then(...) (microtask) + setTimeout(init, 0)
  // (macrotask) de comissoes.js rodar antes de inspecionar o DOM.
  return new Promise(function (resolve) { setTimeout(resolve, 20); });
}

function anaRow() {
  var rows = Utils.qsa("#tbl-commission tbody tr");
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].textContent.indexOf("Ana") !== -1) return rows[i];
  }
  return null;
}
function cellText(row, colIndex) {
  var tds = row.querySelectorAll("td");
  return tds[colIndex] ? tds[colIndex].textContent.trim() : null;
}
// Colunas de #tbl-commission: 0 checkbox, 1 Profissional, 2 Cargo, 3 Atendimentos,
// 4 Receita de Serviços, 5 Taxa, 6 Devido, 7 Pago, 8 Saldo, 9 Status, 10 ações.
function moneyIn(text, value) {
  return typeof text === "string" && text.indexOf(Utils.fmtMoney(value)) !== -1;
}
// Ajusta De/Até num único disparo — setar os dois <input type="date"> e só
// então despachar "change" evita que o auto-swap De<=Até (ver
// applyCustomRangeInputs em comissoes.js, mesma lógica do PeriodFilter) leia
// um valor "Até" ainda desatualizado no meio da edição e troque os dois.
function setCustomRange(start, end) {
  Utils.qs("#cm-date-start").value = start;
  Utils.qs("#cm-date-end").value = end;
  Utils.qs("#cm-date-end").dispatchEvent(new window.Event("change", { bubbles: true }));
}

(async function main() {
  console.log("=== Comissionamento — cenário de teste ===");
  console.log({ today: today, currentMonthKey: currentMonthKey, d05: d05, d10: d10, d20: d20 });
  console.log("");

  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await flush();

  // ---- A. Modo mensal (padrão) — mês corrente inteiro ----
  (function () {
    var row = anaRow();
    check("A: linha da Ana existe", !!row);
    if (!row) return;
    check("A: Receita de Serviços = 450 (100+200+150, exclui mês anterior)", moneyIn(cellText(row, 4), 450), cellText(row, 4));
    // Devido = comissão (20% de 450 = 90) + esporádico (50-20+15=45, inclui b1/b2 sem data e b3 com data) - consumo (10) = 125
    check("A: Devido = 125", moneyIn(cellText(row, 6), 125), cellText(row, 6));
    // Pago = 30 (t1, casa por relatedMonth em modo mensal)
    check("A: Pago = 30", moneyIn(cellText(row, 7), 30), cellText(row, 7));
    check("A: Saldo = 95", moneyIn(cellText(row, 8), 95), cellText(row, 8));
  })();

  // ---- B. Personalizado: 05 a 10 (exclui atendimento do dia 20) ----
  Utils.qs("#cm-month").value = "custom";
  Utils.qs("#cm-month").dispatchEvent(new window.Event("change", { bubbles: true }));
  await flush();
  setCustomRange(d05, d10);
  await flush();

  (function () {
    var row = anaRow();
    check("B: linha da Ana existe (custom 05-10)", !!row);
    if (!row) return;
    // Receita = 100+200 = 300 (exclui dia 20)
    check("B: Receita de Serviços = 300", moneyIn(cellText(row, 4), 300), cellText(row, 4));
    // Comissão = 20+40=60; b1/b2 (sem data, fallback por mês tocado) somam 30;
    // b3 (data=dia 10) está DENTRO do corte 05-10, então também entra = +15;
    // consumo do dia 10 entra = 10. Devido = 60+30+15-10 = 95
    check("B: Devido = 95 (b1/b2 pelo fallback de mês + b3 pela data exata, dentro do corte; consumo do dia 10 desconta)", moneyIn(cellText(row, 6), 95), cellText(row, 6));
    // Pago = 0 — o pagamento t1 não tem relatedRangeStart/End, não conta num corte personalizado
    check("B: Pago = 0 (pagamento do mês inteiro não vaza para o corte semanal)", moneyIn(cellText(row, 7), 0), cellText(row, 7));
    check("B: Saldo = 95", moneyIn(cellText(row, 8), 95), cellText(row, 8));
  })();

  // ---- C. Personalizado: 11 a 20 (exclui os atendimentos dos dias 05 e 10, e o consumo do dia 10) ----
  setCustomRange(currentMonthKey + "-11", d20);
  await flush();

  (function () {
    var row = anaRow();
    check("C: linha da Ana existe (custom 11-20)", !!row);
    if (!row) return;
    check("C: Receita de Serviços = 150 (só o atendimento do dia 20)", moneyIn(cellText(row, 4), 150), cellText(row, 4));
    // Comissão = 30; b1/b2 (sem data, fallback por mês tocado) ainda somam = 30;
    // b3 (data=dia 10) fica FORA do corte 11-20 e é corretamente excluído (ao
    // contrário de b1/b2, que continuam entrando por não terem data própria);
    // consumo do dia 10 também não entra = 0. Devido = 30+30+0-0 = 60
    check("C: Devido = 60 (b3, com data no dia 10, corretamente excluído deste corte; b1/b2 sem data continuam pelo fallback; consumo do dia 10 excluído)", moneyIn(cellText(row, 6), 60), cellText(row, 6));
    check("C: Pago = 0", moneyIn(cellText(row, 7), 0), cellText(row, 7));
    check("C: Saldo = 60", moneyIn(cellText(row, 8), 60), cellText(row, 8));
  })();

  // ---- D. Volta para o corte 05-10 e registra pagamento em lote ----
  setCustomRange(d05, d10);
  await flush();

  var txnCountBefore = tables.transactions.length;
  var chk = Utils.qs("#tbl-commission .com-row-check[data-id='emp1']");
  check("D: checkbox da Ana está presente (saldo > 0)", !!chk);
  if (chk) {
    chk.checked = true;
    chk.dispatchEvent(new window.Event("change", { bubbles: true }));
    Utils.qs("#btn-com-bulk-pay").dispatchEvent(new window.Event("click", { bubbles: true }));
    await flush();
  }
  check("D: um novo lançamento de despesa foi criado", tables.transactions.length === txnCountBefore + 1, tables.transactions.length);
  var newTxn = tables.transactions[tables.transactions.length - 1];
  check("D: novo lançamento tem relatedRangeStart/End = 05/10", newTxn && newTxn.relatedRangeStart === d05 && newTxn.relatedRangeEnd === d10, newTxn);
  check("D: novo lançamento tem relatedMonth = mês corrente (mês em que o corte termina)", newTxn && newTxn.relatedMonth === currentMonthKey, newTxn && newTxn.relatedMonth);
  check("D: valor pago = 95 (saldo do corte 05-10 antes do pagamento)", newTxn && Math.abs(newTxn.amount - 95) < 0.01, newTxn && newTxn.amount);

  (function () {
    var row = anaRow();
    check("D: após pagar, Pago = 95 e Saldo = 0 no corte 05-10", row && moneyIn(cellText(row, 7), 95) && moneyIn(cellText(row, 8), 0), row && [cellText(row, 7), cellText(row, 8)]);
  })();

  // ---- E. Volta ao modo mensal — o pagamento do corte semanal deve somar ao pago do mês inteiro ----
  Utils.qs("#cm-month").value = currentMonthKey;
  Utils.qs("#cm-month").dispatchEvent(new window.Event("change", { bubbles: true }));
  await flush();

  (function () {
    var row = anaRow();
    // Pago = 30 (t1) + 95 (pagamento do corte semanal, mesmo relatedMonth) = 125 = Devido inteiro do mês -> Saldo 0
    check("E: modo mensal soma pagamento avulso + pagamento do corte semanal (Pago=125)", row && moneyIn(cellText(row, 7), 125), row && cellText(row, 7));
    check("E: Saldo do mês fecha em 0", row && moneyIn(cellText(row, 8), 0), row && cellText(row, 8));
  })();

  // ---- F. Volta ao corte personalizado 11-20 — o pagamento do corte 05-10 NÃO deve vazar para cá ----
  Utils.qs("#cm-month").value = "custom";
  Utils.qs("#cm-month").dispatchEvent(new window.Event("change", { bubbles: true }));
  await flush();
  setCustomRange(currentMonthKey + "-11", d20);
  await flush();

  (function () {
    var row = anaRow();
    check("F: corte 11-20 continua com Pago=0 (pagamento de outra semana não vaza)", row && moneyIn(cellText(row, 7), 0), row && cellText(row, 7));
    check("F: corte 11-20 continua com Saldo=60", row && moneyIn(cellText(row, 8), 60), row && cellText(row, 8));
  })();

  // ---- G. Rótulo de período no cabeçalho do gráfico reflete o corte personalizado ----
  (function () {
    var sub = document.getElementById("com-chart-sub");
    check("G: card-header-sub mostra o período personalizado, não 'Mês selecionado'", sub && sub.textContent.indexOf("Período:") === 0, sub && sub.textContent);
  })();

  // ---- H. Precisão dia a dia do esporádico COM data (b3), isolada de atendimentos/consumo ----
  // Corte de um único dia (d10): pega o atendimento a2 (200), o consumo c1
  // (10) e o esporádico b3 (data=d10, +15) — todos datados exatamente nesse dia.
  setCustomRange(d10, d10);
  await flush();
  (function () {
    var row = anaRow();
    check("H1: corte de um único dia (d10) existe", !!row);
    if (!row) return;
    check("H1: Receita = 200 (só o atendimento do dia 10)", moneyIn(cellText(row, 4), 200), cellText(row, 4));
    // Comissão = 40; b1/b2 sem data somam 30 (fallback, mês inteiro tocado); b3 com data=d10 também entra = +15; consumo do dia 10 = 10
    // Devido = 40+30+15-10 = 75
    check("H1: Devido = 75 (b3 entra por bater exatamente com o dia do corte)", moneyIn(cellText(row, 6), 75), cellText(row, 6));
  })();

  // Corte de um único dia sem nenhum atendimento/consumo/b3 (d09) — só os
  // esporádicos SEM data (b1/b2) ainda aparecem, pelo fallback de mês
  // tocado; b3 (data=d10) fica corretamente de fora.
  setCustomRange(currentMonthKey + "-09", currentMonthKey + "-09");
  await flush();
  (function () {
    var row = anaRow();
    check("H2: corte de um único dia (d09, sem nada datado) existe", !!row);
    if (!row) return;
    check("H2: Receita = 0 (nenhum atendimento no dia 09)", moneyIn(cellText(row, 4), 0), cellText(row, 4));
    // Comissão = 0; b1/b2 sem data ainda somam 30 (fallback); b3 (data=d10) corretamente excluído; consumo = 0
    // Devido = 0+30-0 = 30
    check("H2: Devido = 30 (só o fallback de b1/b2 sem data; b3, com data no dia 10, corretamente excluído do dia 09)", moneyIn(cellText(row, 6), 30), cellText(row, 6));
  })();

  // ---- I. Modal "Ver detalhes" — coluna "Produtos" mostra o desconto de
  // consumo por atendimento (mesmo padrão do Extrato do Profissional),
  // além da seção "Desconto por Consumo de Insumos" já existente abaixo. ----
  Utils.qs("#cm-month").value = currentMonthKey;
  Utils.qs("#cm-month").dispatchEvent(new window.Event("change", { bubbles: true }));
  await flush();
  (function () {
    var row = anaRow();
    check("I: linha da Ana existe para abrir detalhes", !!row);
    if (!row) return;
    var detailsBtn = row.querySelector("[data-details]");
    check("I: botão 'Ver detalhes' existe", !!detailsBtn);
    if (!detailsBtn) return;
    detailsBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    var modalBody = document.querySelector(".modal-body");
    check("I: modal de detalhes abriu", !!modalBody);
    if (!modalBody) return;
    var mainTable = modalBody.querySelector("table");
    var headerRow = mainTable && mainTable.querySelector("thead tr");
    check("I: cabeçalho da tabela de atendimentos tem coluna 'Produtos'", !!headerRow && headerRow.textContent.indexOf("Produtos") !== -1, headerRow && headerRow.textContent);
    var bodyRows = mainTable ? mainTable.querySelectorAll("tbody tr") : [];
    check("I: tabela principal lista os 3 atendimentos do mês", bodyRows.length === 3, bodyRows.length);
    var linkedOk = false, othersShowDash = true;
    bodyRows.forEach(function (tr) {
      var tds = tr.querySelectorAll("td");
      if (tds.length < 5) return;
      var dataHora = tds[0].textContent;
      var produtos = tds[4].textContent.trim();
      if (dataHora.indexOf(Utils.fmtDate(d10)) === 0) {
        linkedOk = produtos.indexOf("-") === 0 && moneyIn(produtos, 10);
      } else if (produtos !== "-") {
        othersShowDash = false;
      }
    });
    check("I: atendimento do dia 10 (vinculado ao consumo) mostra '- R$10,00' em Produtos", linkedOk);
    check("I: atendimentos sem consumo vinculado mostram '-' em Produtos", othersShowDash);
    var tfootProdutos = mainTable && mainTable.querySelector("tfoot td:nth-child(3)");
    check("I: subtotal de Produtos no rodapé = 10 (só o vinculado a a2)", tfootProdutos && moneyIn(tfootProdutos.textContent, 10), tfootProdutos && tfootProdutos.textContent);
    check("I: seção 'Desconto por Consumo de Insumos' continua exibida abaixo (detalhe por produto)", modalBody.textContent.indexOf("Desconto por Consumo de Insumos") !== -1);
    Modal.close();
  })();

  console.log("");
  console.log("=== Resultado: " + pass + " passaram, " + fail + " falharam (" + (pass + fail) + " no total) ===");
  if (fail > 0) {
    console.log("Falhas:");
    failures.forEach(function (f) { console.log(" - " + f); });
    process.exit(1);
  }
})();
