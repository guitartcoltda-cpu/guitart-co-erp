/* Teste — edição completa de marcações (segundos, tipo, funcionário, saída antecipada) e
   ajuste de saldo com CRÉDITO, na Gestão de Ponto (ponto-gestao.html + ponto-gestao.js), em jsdom.
   Uso: node test/ponto-edicao-completa.test.js */
"use strict";
process.env.TZ = "America/Sao_Paulo";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
console.log("=== Edição completa + ajuste de saldo (crédito) ===");

const VD = { 0: null, 1: null }; [2, 3, 4, 5, 6].forEach(d => VD[d] = { start: "09:30", end: "19:00" });
const WS = { days: VD, lunchMin: 60, lunchFrom: "13:00", lunchTo: "14:00" };
const D = "2026-10-08";
const at = (h, m, s) => new Date(2026, 9, 8, h, m, s || 0).toISOString();
const E = (id, type, h, m, s, x) => Object.assign({ id, employeeId: "v1", employeeName: "Vitória Rodrigues", date: D, type, timestamp: at(h, m, s), reviewed: false, origin: "manual" }, x || {});
const store = {
  employees: [
    { id: "v1", name: "Vitória Rodrigues", role: "Cabeleireiro(a)", status: "ativo", requiresTimeClock: true, workSchedule: WS },
    { id: "l1", name: "Luiza Gerente", role: "Gerente", status: "ativo", requiresTimeClock: true, workSchedule: WS }
  ],
  timeClockEntries: [E("a", "entrada", 9, 30, 0), E("b", "saida_almoco", 13, 0, 0), E("c", "volta_almoco", 14, 0, 0),
    E("d", "saida", 18, 20, 0, { earlyLeave: { status: "pendente", claimedAuthorized: true, reason: "agenda vazia" } }),
    { id: "adj1", employeeId: "v1", employeeName: "Vitória Rodrigues", date: "2026-10-05", type: "debito_horas", debitMin: 510, useBank: true, timestamp: at(0, 0, 0), reviewed: true, origin: "manual" }],
  approvals: [{ id: "ap1", type: "ajuste_ponto", status: "pendente", summary: "Saída antecipada — x", payload: { kind: "saida_antecipada", entryId: "d", employeeId: "v1", employeeName: "Vitória Rodrigues", date: D, exitTime: "18:20", earlyMin: 40 } }]
};
const logs = [];
const html = fs.readFileSync(path.join(root, "ponto-gestao.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/ponto-gestao.html", pretendToBeVisual: true });
const w = dom.window;
let seq = 0;
w.DB = {
  ready: Promise.resolve(), all: t => (store[t] || []).slice(), get: (t, id) => (store[t] || []).find(x => x.id === id) || null,
  find: (t, fn) => (store[t] || []).filter(fn),
  insert: (t, rec) => { const r = Object.assign({ id: "n" + (++seq) }, rec); store[t].push(r); return r; },
  update: (t, id, p) => Object.assign(store[t].find(x => x.id === id), p),
  mergeRecordUpdate: (t, id, fn) => { const r = store[t].find(x => x.id === id); return Object.assign(r, fn(r)); },
  mergeFieldUpdate: () => {}, batch: fn => fn(), remove: (t, id) => { store[t] = store[t].filter(x => x.id !== id); },
  nowISO: () => new Date().toISOString(), getSettings: () => ({}), getRoles: () => [], log: (a, b) => logs.push(a + ": " + b), hasRemote: () => false
};
w.CurrentUser = { get: () => ({ id: "u", role: "Administrador", firstName: "Luiza", lastName: "Gerente" }) };
w.Approvals = { listPending: () => store.approvals.filter(a => a.status === "pendente"), canApprove: () => true, TYPE_LABELS: {} };
w.Layout = { init() {}, render() {} };
w.jspdf = {};
const errors = [];
w.addEventListener("error", e => errors.push(e.message));
["utils.js", "period-filter.js", "ponto-calc.js", "ponto-ajustes.js"].forEach(f => w.eval(fs.readFileSync(path.join(root, "assets", "js", f), "utf8")));
const toasts = [];
w.Toast.show = (m, k) => toasts.push(k + ":" + m);
w.PontoAjustes.requestEarlyLeave = info => { const a = { id: "ap" + (++seq), type: "ajuste_ponto", status: "pendente", summary: "novo", payload: Object.assign({ kind: "saida_antecipada" }, info) }; store.approvals.push(a); return a; };
try { w.eval(fs.readFileSync(path.join(root, "assets", "js", "ponto-gestao.js"), "utf8")); } catch (e) { errors.push("load: " + e.message); }
const PC = w.PontoCalc;
const day = () => PC.computeDay(D, store.timeClockEntries.filter(t => t.date === D && t.employeeId === "v1"), store.employees[0]);

function fire(el, type) { el.dispatchEvent(new w.Event(type, { bubbles: true })); }
function openEntry(d, id) {
  d.querySelector('[data-panel="pg-p-controle"]').click();
  const s = d.getElementById("pg-start"); s.value = "2026-10-01"; fire(s, "change");
  const e = d.getElementById("pg-end"); e.value = "2026-10-10"; fire(e, "change");
  d.querySelector('[data-open-day="v1|' + D + '"]').click();
  d.querySelector('[data-tl-entry="' + id + '"]').click();
}

(async function () {
  await wait(100);
  const d = w.document;
  ok(errors.length === 0, "sem erro ao carregar: " + errors.join(" | "));

  // cálculo do crédito
  const credit = { id: "cr", employeeId: "v1", date: D, type: "debito_horas", direction: "credito", debitMin: 120, timestamp: at(0, 0, 0) };
  const withCredit = PC.computeDay(D, store.timeClockEntries.filter(t => t.date === D).concat([credit]), store.employees[0]);
  ok(withCredit.adjustMin === 120 && withCredit.adjustPayMin === 0, "crédito soma 2h no banco: " + withCredit.adjustMin);
  ok(PC.dayBank(withCredit).min === withCredit.saldoMin + 120, "dayBank inclui o crédito");
  ok(PC.adjustLabelOf(credit) === PC.CREDIT_LABEL && PC.adjustLabelOf({}) === PC.ADJUST_LABEL, "rótulos crédito/desconto");
  const only = PC.computeDay("2026-10-06", [Object.assign({}, credit, { date: "2026-10-06" })], store.employees[0]);
  ok(only.status === "ajuste" && only.statusLabel === PC.CREDIT_LABEL, "dia só com crédito: status ajuste/" + only.statusLabel);
  ok(w.PontoAjustes.buildTimestamp(D, "18:59:30") === at(18, 59, 30), "buildTimestamp com segundos");

  // 1) editar a saída: hora com segundos, funcionário igual, abonar
  openEntry(d, "d");
  const timeEl = d.getElementById("pg-time");
  ok(!!timeEl && timeEl.getAttribute("step") === "1" && timeEl.value === "18:20:00", "campo de hora tem segundos: " + (timeEl && timeEl.value));
  ok(d.getElementById("pg-emp").options.length === 2, "pode trocar o funcionário");
  ok(d.getElementById("pg-etype").value === "saida" && d.getElementById("pg-early-wrap").style.display !== "none", "bloco de saída antecipada visível" + "/" + d.getElementById("pg-early-wrap").style.display);
  ok(d.getElementById("pg-el-status").value === "pendente", "situação atual = pendente");
  timeEl.value = "18:21:47";
  d.getElementById("pg-el-status").value = "abonada";
  d.getElementById("pg-note").value = "ajustado pela gerência";
  d.getElementById("pg-save").click();
  const dEntry = store.timeClockEntries.find(t => t.id === "d");
  ok(new Date(dEntry.timestamp).getSeconds() === 47 && new Date(dEntry.timestamp).getMinutes() === 21, "gravou 18:21:47");
  ok(dEntry.earlyLeave.status === "abonada" && !!dEntry.earlyLeave.decidedAt && dEntry.earlyLeave.decidedByName === "Luiza Gerente", "status abonada + quem decidiu");
  ok(dEntry.earlyLeave.reason === "agenda vazia" && dEntry.earlyLeave.claimedAuthorized === true, "motivo/resposta preservados");
  ok(dEntry.editHistory && dEntry.editHistory.length === 1 && /Hora: 18:20:00 → 18:21:47/.test(dEntry.editHistory[0].changes.join("|")), "histórico: " + JSON.stringify(dEntry.editHistory));
  ok(dEntry.originalTimestamp === at(18, 20, 0), "guardou o horário original");
  ok(dEntry.editedByName === "Luiza Gerente" && dEntry.note === "ajustado pela gerência", "editado por / observação");
  ok(store.approvals[0].status === "aprovada" && /Decidido na edição/.test(store.approvals[0].reviewerNote), "solicitação pendente foi decidida junto");
  ok(day().saldoMin > -2 && day().earlyLeave.status === "abonada", "abonada deixa o dia neutro: " + day().saldoMin);
  ok(logs.some(l => /Editou o registro de ponto de Vitória Rodrigues — .*Hora: 18:20:00 → 18:21:47/.test(l)), "log de atividade com de → para");
  d.querySelector("#active-modal-overlay [data-close-modal]").click();

  // 2) mudar para "recusada" depois (sem solicitação pendente) e depois remover a justificativa
  openEntry(d, "d");
  d.getElementById("pg-el-status").value = "recusada";
  d.getElementById("pg-save").click();
  ok(dEntry.earlyLeave.status === "recusada" && day().missingMin >= 38, "recusada conta no banco: " + day().missingMin);
  d.getElementById("pg-el-status").value = "";
  d.getElementById("pg-save").click();
  ok(dEntry.earlyLeave === null && day().saldoMin < -35, "sem justificativa: conta normal");
  d.getElementById("pg-el-status").value = "pendente";
  d.getElementById("pg-save").click();
  ok(store.approvals.filter(a => a.status === "pendente" && a.payload.entryId === "d").length === 1, "voltar para 'aguardando' recria a solicitação");
  ok(dEntry.editHistory.length === 4, "4 edições no histórico: " + dEntry.editHistory.length);
  d.querySelector("#active-modal-overlay [data-close-modal]").click();

  // 3) trocar o funcionário de uma batida (a marcação foi no nome errado)
  openEntry(d, "b");
  d.getElementById("pg-emp").value = "l1";
  d.getElementById("pg-save").click();
  const b = store.timeClockEntries.find(t => t.id === "b");
  ok(b.employeeId === "l1" && b.employeeName === "Luiza Gerente", "troca de funcionário");
  d.getElementById("pg-emp").value = "v1";
  d.getElementById("pg-etype").value = "saida_almoco";
  d.getElementById("pg-save").click();
  ok(b.employeeId === "v1", "volta para a Vitória");
  d.querySelector("#active-modal-overlay [data-close-modal]").click();

  // 4) editar o ajuste de saldo: desconto → crédito
  d.querySelector('[data-panel="pg-p-controle"]').click();
  d.querySelector('[data-open-day="v1|2026-10-05"]').click();
  d.querySelector('[data-tl-entry="adj1"]').click();
  ok(d.getElementById("pg-dir").value === "debito" && d.getElementById("pg-usebank-wrap").style.display !== "none", "ajuste abre como desconto, com opção de banco");
  d.getElementById("pg-dir").value = "credito"; fire(d.getElementById("pg-dir"), "change");
  ok(d.getElementById("pg-usebank-wrap").style.display === "none", "crédito esconde 'descontar do banco'");
  const deb = d.getElementById("pg-debit"); deb.value = "0230"; fire(deb, "input");
  d.getElementById("pg-save").click();
  const adj = store.timeClockEntries.find(t => t.id === "adj1");
  ok(adj.direction === "credito" && adj.debitMin === 150 && adj.useBank === true, "virou crédito de 2h30: " + JSON.stringify([adj.direction, adj.debitMin]));
  const t5 = PC.espelho("v1", "2026-10-05", "2026-10-05", store.employees[0], store.timeClockEntries).totals;
  ok(t5.adjustMin === 150, "espelho soma +2h30: " + t5.adjustMin);
  d.querySelector("#active-modal-overlay [data-close-modal]").click();

  // 5) lançar crédito pelo modal manual (botão da aba Banco de Horas)
  d.querySelector('[data-panel="pg-p-banco"]').click();
  await wait(50);
  const bt = d.querySelector('[data-banco-adjust="v1"]');
  ok(!!bt, "botão 'Ajustar saldo' por colaborador");
  bt.click();
  ok(d.getElementById("me-type").value === "credito_horas" && d.getElementById("me-employee").value === "v1", "abre já em 'crédito' e no colaborador");
  ok(d.getElementById("me-bank-wrap").style.display === "none" && d.getElementById("me-debit-label").textContent.indexOf("creditar") !== -1, "campos do crédito");
  d.getElementById("me-date2").value = "2026-10-01";
  const md = d.getElementById("me-debit"); md.value = "1000"; fire(md, "input");
  d.getElementById("me-reason").value = "saldo anterior ao sistema";
  d.getElementById("me-save").click();
  const cr = store.timeClockEntries.find(t => t.direction === "credito" && t.date === "2026-10-01");
  ok(!!cr && cr.debitMin === 600 && cr.useBank === true && cr.employeeId === "v1" && cr.note === "saldo anterior ao sistema", "crédito de 10h lançado: " + JSON.stringify(cr && [cr.debitMin, cr.useBank]));
  ok(logs.some(l => /Creditou horas no banco de Vitória Rodrigues \(\+10h00 em 01\/10\/2026\)/.test(l)), "log do crédito");
  ok(errors.length === 0, "sem erros durante o uso: " + errors.join(" | "));

  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})();
