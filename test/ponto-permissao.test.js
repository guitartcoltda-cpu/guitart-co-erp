/* Teste — usuário NÃO administrador na Gestão de Ponto só visualiza. Uso: node test/ponto-permissao.test.js */
"use strict";
process.env.TZ = "America/Sao_Paulo";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
console.log("=== Permissão — só administradores alteram o ponto ===");

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
w.CurrentUser = { get: () => ({ id: "u", role: "Gerente", firstName: "Maria", lastName: "Gerente" }) };
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
  ok(d.getElementById("btn-new-manual-entry").style.display === "none", "botão Lançar Ponto Manual escondido");
  d.querySelector('[data-panel="pg-p-controle"]').click();
  const s0 = d.getElementById("pg-start"); s0.value = "2026-10-01"; fire(s0, "change");
  const e0 = d.getElementById("pg-end"); e0.value = "2026-10-10"; fire(e0, "change");
  d.querySelector('[data-open-day="v1|' + D + '"]').click();
  ok(!!d.querySelector('[data-tl-check="d"]') && d.querySelector('[data-tl-check="d"]').disabled, "caixas de conferência desabilitadas");
  d.querySelector('[data-tl-entry="d"]').click();
  ok(!d.getElementById("pg-save") && !d.getElementById("pg-delete") && !d.getElementById("pg-flag"), "sem Salvar/Excluir/Sinalizar");
  ok(d.getElementById("pg-date").disabled && d.getElementById("pg-time").disabled && d.getElementById("pg-emp").disabled, "campos desabilitados");
  ok(/Somente administradores/.test(d.querySelector(".modal-body").textContent), "aviso de somente leitura");
  d.querySelector("#active-modal-overlay [data-close-modal]").click();
  d.querySelector('[data-panel="pg-p-banco"]').click();
  await wait(50);
  ok(!d.querySelector("[data-banco-adjust]") && !!d.querySelector("[data-banco-open]"), "sem 'Ajustar saldo', mas 'Ver detalhes' continua");
  const before = store.timeClockEntries.length;
  w.document.dispatchEvent(new w.Event("x"));
  ok(store.timeClockEntries.length === before && store.timeClockEntries.find(t => t.id === "d").editHistory === undefined, "nada foi alterado");
  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})();
