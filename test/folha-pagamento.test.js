/* Teste de interface da Folha de Pagamento (folha-pagamento.html + folha-pagamento.js), em jsdom. */
"use strict";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }

function build(role) {
  const html = fs.readFileSync(path.join(root, "folha-pagamento.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/folha-pagamento.html" });
  const w = dom.window;
  const month = new Date().toISOString().slice(0, 7);
  const store = {
    employees: [
      { id: "e1", name: "Luiza Morais", role: "Recepcionista", status: "ativo", baseSalary: 1800, hireDate: "2025-07-25", cpf: "44489235844" },
      { id: "e2", name: "Vitória Rodrigues", role: "Cabeleireiro(a)", status: "ativo", baseSalary: 1621, hireDate: "2025-08-01" },
      { id: "e3", name: "Francisco", role: "Cabeleireiro(a)", status: "ativo", baseSalary: 0 },
      { id: "e4", name: "Inativa", role: "x", status: "inativo", baseSalary: 2000 }
    ],
    transactions: [
      { id: "t1", type: "despesa", employeeId: "e1", description: "Vale adiantamento", amount: 200, date: month + "-05", status: "pago", categoryId: "c1" },
      { id: "t2", type: "despesa", employeeId: "e1", description: "Comissão semanal", amount: 100, date: month + "-05", categoryId: "c2" },
      { id: "t3", type: "despesa", employeeId: "e2", description: "Aluguel", amount: 999, date: month + "-05", categoryId: "c1" },
      // lançamentos antigos sem funcionário vinculado: reconhece pelo primeiro nome; "Valente" não é "vale"
      { id: "t4", type: "despesa", employeeId: null, description: "VALE/ADIANTAMENTO VITÓRIA", amount: 50, date: month + "-06", status: "pago", categoryId: "c1" },
      { id: "t5", type: "despesa", employeeId: null, description: "Corte Feminino - Cleonice Valente", amount: 120, date: month + "-06", categoryId: "c1" }
    ],
    categories: [{ id: "c1", name: "Despesas" }, { id: "c2", name: "Comissões" }],
    timeClockEntries: []
  };
  const settings = {};
  const logs = [], toasts = [], pdfCalls = [];
  w.DB = {
    ready: Promise.resolve(), all: t => (store[t] || []).slice(), get: (t, id) => (store[t] || []).find(x => x.id === id) || null,
    update: (t, id, p) => Object.assign(store[t].find(x => x.id === id), p),
    getSettings: () => settings,
    mergeSettingsField: (f, fn) => { settings[f] = fn(settings[f]); return settings; },
    log: (a, b) => logs.push(a + ": " + b)
  };
  w.CurrentUser = { get: () => ({ id: "u", role, firstName: "A", lastName: "B" }) };
  w.ComissoesCalc = { rowsForRange: () => [{ employee: store.employees[0], devido: 500, pago: 100 }] };
  w.jspdf = { jsPDF: function () {
    const d = { internal: { pageSize: { getWidth: () => 595 } }, texts: [] };
    ["setFont", "setFontSize", "setLineWidth", "line", "addPage"].forEach(n => d[n] = function () { pdfCalls.push(n); });
    d.text = function (t) { d.texts.push(String(t)); pdfCalls.push("text:" + t); };
    d.save = function (n) { pdfCalls.push("save:" + n); };
    return d;
  } };
  ["utils.js", "ponto-calc.js", "folha-calc.js"].forEach(f => w.eval(fs.readFileSync(path.join(root, "assets", "js", f), "utf8")));
  w.Toast.show = (m, k) => toasts.push(k + ":" + m);
  w.eval(fs.readFileSync(path.join(root, "assets", "js", "folha-pagamento.js"), "utf8"));
  // o jsdom dispara o DOMContentLoaded sozinho logo após o parse (não disparar de novo, senão init roda 2x)
  return { w, store, settings, logs, toasts, pdfCalls };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  // ---- não-administrador não vê nada ----
  let t = build("Recepcionista"); await wait(30);
  ok(t.w.document.getElementById("fp-denied").style.display !== "none", "recepcionista vê 'Acesso restrito'");
  ok(t.w.document.getElementById("fp-app").style.display === "none", "e o app fica escondido");
  ok(t.w.document.getElementById("tbl-folha").innerHTML === "", "sem tabela renderizada");

  // ---- administrador ----
  t = build("Administrador"); await wait(50);
  const d = t.w.document;
  const rows = d.querySelectorAll("#tbl-folha tbody tr");
  ok(rows.length === 2, "só quem é ativo e tem salário base: 2 linhas (veio " + rows.length + ")");
  ok(/Luiza/.test(rows[0].textContent) && /Vitória/.test(rows[1].textContent), "ordem alfabética");
  // Luiza: 1800 + 500 comissão = 2300 bruto; vale 200 + comissão já paga 100 desconta
  const FC = t.w.FolhaCalc;
  const inss = FC.inss(2300);
  const expectedNet = 2300 - inss - 200 - 100;
  const nz = x => x.replace(/\s+/g, " ");
  const txt = nz(rows[0].textContent);
  ok(txt.indexOf(nz(t.w.Utils.fmtMoney(expectedNet))) !== -1, "líquido da Luiza = " + t.w.Utils.fmtMoney(expectedNet) + " | " + txt);
  ok(nz(rows[1].textContent).indexOf(nz(t.w.Utils.fmtMoney(1621 - FC.inss(1621) - 50))) !== -1, "Vitória: salário − INSS − vale sem vínculo reconhecido pelo nome (Aluguel e 'Valente' não entram)");
  ok(d.getElementById("fp-summary").children.length === 4, "4 KPIs");

  // ---- detalhes ----
  d.querySelector('[data-fp-open="e1"]').click();
  ok(!!d.getElementById("fpd-save"), "modal de detalhes abriu");
  const vales = d.querySelectorAll(".fpd-vale");
  ok(vales.length === 1 && vales[0].checked, "1 vale candidato, marcado (a comissão paga não aparece como vale)");
  vales[0].checked = false; vales[0].dispatchEvent(new t.w.Event("change", { bubbles: true }));
  ok(d.getElementById("fpd-slip").textContent.indexOf("Vale adiantamento") === -1, "desmarcar o vale tira da linha de descontos");
  // lançamento avulso
  d.getElementById("fpx-label").value = "Ajuda de custo";
  d.getElementById("fpx-amount").value = "100,00"; d.getElementById("fpx-amount").dispatchEvent(new t.w.Event("input", { bubbles: true }));
  d.getElementById("fpx-kind").value = "provento"; d.getElementById("fpx-tax").checked = false;
  d.getElementById("fpx-add").click();
  ok(/Ajuda de custo/.test(d.getElementById("fpd-slip").textContent), "provento avulso aparece no holerite: " + d.getElementById("fpx-amount").value);
  d.getElementById("fpd-dep").value = "1"; d.getElementById("fpd-dep").dispatchEvent(new t.w.Event("input", { bubbles: true }));
  d.getElementById("fpd-save").click();
  const mk = new Date().toISOString().slice(0, 7);
  const saved = (t.settings.payroll || {})[mk] && t.settings.payroll[mk].e1;
  ok(!!saved, "estado salvo em settings.payroll[mês][e1]");
  ok(saved && saved.vales.t1 === false, "vale desmarcado ficou salvo como false");
  ok(saved && saved.extras.length === 1 && saved.extras[0].taxable === false, "provento avulso salvo, não tributável");
  ok(t.store.employees[0].payroll && t.store.employees[0].payroll.dependents === 1, "dependentes salvos no cadastro do funcionário");
  ok(t.logs.some(l => /Ajustou o holerite de Luiza/.test(l)), "gravou no log de atividade");
  // depois de salvar, a tabela reflete (sem vale: líquido maior)
  const row0 = d.querySelectorAll("#tbl-folha tbody tr")[0].textContent.replace(/\s+/g, " ");
  ok(row0.indexOf(nz(t.w.Utils.fmtMoney(2300 + 100 - FC.inss(2300) - 100))) !== -1, "tabela recalculada após salvar: " + row0);

  // ---- PDF ----
  d.querySelector('[data-fp-pdf="e1"]').click();
  ok(t.pdfCalls.some(c => /^save:holerite_luiza-morais_/.test(c)), "PDF individual salvo: " + t.pdfCalls.filter(c => c.startsWith("save")).join());
  ok(t.pdfCalls.some(c => /LÍQUIDO A RECEBER/.test(c)), "PDF traz a linha do líquido");
  t.pdfCalls.length = 0;
  d.getElementById("btn-fp-pdf-all").click();
  ok(t.pdfCalls.filter(c => c === "addPage").length === 1 && t.pdfCalls.some(c => /^save:holerite_todos_/.test(c)), "PDF de todos: 2 páginas");

  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
