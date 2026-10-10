/* Teste — "Saída antecipada": cálculo (ponto-calc.js), pedido na tela de Ponto (ponto.js),
   aprovação/recusa (approvals.js + ponto-ajustes.js). Uso: node test/ponto-saida-antecipada.test.js */
"use strict";
process.env.TZ = "America/Sao_Paulo";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
console.log("=== Saída antecipada ===");

// "agora" controlável: quinta 08/10/2026
let NOW = new Date(2026, 9, 8, 18, 20, 0).getTime();
const VD = { 0: null, 1: null }; [2, 3, 4, 5, 6].forEach(d => VD[d] = { start: "09:30", end: "19:00" });
const store = {
  employees: [{ id: "v1", name: "Vitória Rodrigues", role: "Cabeleireiro(a)", status: "ativo", requiresTimeClock: true,
    workSchedule: { days: VD, lunchMin: 60, lunchFrom: "13:00", lunchTo: "14:00" } }],
  timeClockEntries: [], approvals: [], users: []
};
const logs = [];
const html = fs.readFileSync(path.join(root, "ponto.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/ponto.html", pretendToBeVisual: true });
const w = dom.window;
const RealDate = w.Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
w.Date = FakeDate;
let seq = 0;
const stamp = () => new FakeDate().toISOString();
w.DB = {
  ready: Promise.resolve(),
  all: t => (store[t] || []).slice(), get: (t, id) => (store[t] || []).find(x => x.id === id) || null,
  find: (t, fn) => (store[t] || []).filter(fn),
  insert: (t, rec) => { if (!rec.id) rec.id = "n" + (++seq); store[t].push(rec); return rec; },
  update: (t, id, p) => Object.assign(store[t].find(x => x.id === id), p),
  mergeRecordUpdate: (t, id, fn) => { const r = store[t].find(x => x.id === id); return Object.assign(r, fn(r)); },
  mergeFieldUpdate: () => {}, batch: fn => fn(),
  fetchFresh: (t, id) => Promise.resolve(store[t].find(x => x.id === id) || null),
  confirmSaved: () => Promise.resolve(true), retrySync() {},
  nowISO: stamp, log: (a, b) => logs.push(a + ": " + b), getSettings: () => ({}), getRoles: () => []
};
w.CurrentUser = { get: () => ({ id: "u1", role: "Administrador", firstName: "Luiza", lastName: "Gerente" }) };
const errors = [];
w.addEventListener("error", e => errors.push(e.message));
["utils.js", "ponto-calc.js", "approvals.js", "ponto-ajustes.js"].forEach(f => w.eval(fs.readFileSync(path.join(root, "assets", "js", f), "utf8")));
w.Utils.fileToAvatarDataUrl = (file, size, cb) => cb("data:image/jpeg;base64,AAAA");
const toasts = [];
w.Toast.show = (m, k) => toasts.push(k + ":" + m);
const PC = w.PontoCalc;
const emp = store.employees[0];

// ---------- 1) Cálculo ----------
const D = "2026-10-08";
const at = (h, m) => new RealDate(2026, 9, 8, h, m).toISOString();
ok(PC.earlyMinutes(emp, D, at(18, 20)) === 40, "18:20 → 40 min antes");
ok(PC.earlyMinutes(emp, D, at(19, 5)) === 0, "depois do fim → 0");
ok(PC.earlyMinutes(emp, "2026-10-05", at(10, 0)) === 0, "segunda (folga) → 0");
ok(!PC.needsEarlyLeaveReason(emp, D, at(18, 50)), "10 min antes → tolerado (sem pergunta)");
ok(PC.needsEarlyLeaveReason(emp, D, at(18, 49)), "11 min antes → pergunta");
ok(PC.EARLY_TOLERANCE_MIN === 10, "tolerância = 10");

function day(el) {
  const e = [
    { id: "a", employeeId: "v1", type: "entrada", date: D, timestamp: at(9, 30) },
    { id: "b", employeeId: "v1", type: "saida_almoco", date: D, timestamp: at(13, 0) },
    { id: "c", employeeId: "v1", type: "volta_almoco", date: D, timestamp: at(14, 0) },
    { id: "d", employeeId: "v1", type: "saida", date: D, timestamp: at(18, 20), earlyLeave: el }
  ];
  return PC.computeDay(D, e, emp);
}
let d0 = day(undefined);
ok(d0.missingMin === 40 && d0.saldoMin === -40 && !d0.earlyLeave, "sem justificativa: -40 no banco (como antes): " + d0.saldoMin);
let dp = day({ status: "pendente", claimedAuthorized: true, reason: "agenda vazia" });
ok(dp.saldoMin === 0 && dp.missingMin === 0 && dp.earlyLeaveMin === 40, "pendente: saldo neutro: " + dp.saldoMin);
ok(dp.workedMin === 480 || dp.workedMin === 460 || dp.workedMin > 0, "workedMin real preservado: " + dp.workedMin);
ok(PC.earlyLeaveMeta(dp).status === "pendente" && PC.earlyLeaveMeta(dp).min === 40 && PC.earlyLeaveMeta(dp).claimedAuthorized === true, "meta pendente");
let da = day({ status: "abonada", claimedAuthorized: true });
ok(da.saldoMin === 0 && da.missingMin === 0, "abonada: saldo 0");
ok(PC.earlyLeaveMeta(da).badge === "badge-success", "badge abonada");
let dr = day({ status: "recusada", claimedAuthorized: false });
ok(dr.saldoMin === -40 && dr.missingMin === 40, "recusada: conta -40: " + dr.saldoMin);
ok(PC.earlyLeaveMeta(dr).min === 40 && PC.earlyLeaveMeta(dr).badge === "badge-danger", "meta recusada mostra minutos reais");
const esp = PC.espelho("v1", D, D, emp);
ok(esp.totals && typeof esp.totals.saldoMin === "number", "espelho calcula");

// ---------- 2) Tela de ponto: batida da saída ----------
store.timeClockEntries.push(
  { id: "e1", employeeId: "v1", employeeName: "Vitória Rodrigues", type: "entrada", date: D, timestamp: at(9, 30) },
  { id: "e2", employeeId: "v1", employeeName: "Vitória Rodrigues", type: "saida_almoco", date: D, timestamp: at(13, 0) },
  { id: "e3", employeeId: "v1", employeeName: "Vitória Rodrigues", type: "volta_almoco", date: D, timestamp: at(14, 0) }
);
try { w.eval(fs.readFileSync(path.join(root, "assets", "js", "ponto.js"), "utf8")); } catch (e) { errors.push("load: " + e.message); }

function pickSelfie() {
  const input = w.document.getElementById("ponto-selfie-input");
  Object.defineProperty(input, "files", { value: [{ name: "x.jpg" }], configurable: true });
  input.dispatchEvent(new w.Event("change", { bubbles: true }));
}
(async function () {
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await wait(60);
  const d = w.document;
  ok(errors.length === 0, "sem erro: " + errors.join(" | "));
  d.querySelector("[data-emp='v1']").click();

  // 2a) cancelar não registra nada
  pickSelfie(); await wait(20);
  ok(!!d.getElementById("el-confirm"), "abre o pedido de justificativa (18:20, 40 min antes)");
  ok(store.timeClockEntries.length === 3, "ainda não registrou a saída");
  d.querySelector("#active-modal-overlay [data-close-modal].btn").click();
  ok(!d.getElementById("el-confirm") && store.timeClockEntries.length === 3, "cancelar: nada registrado");

  // 2b) confirmar sem responder
  pickSelfie(); await wait(20);
  d.getElementById("el-confirm").click();
  ok(toasts.some(t => /Responda se você foi liberada/.test(t)) && store.timeClockEntries.length === 3, "exige responder sim/não");

  // 2c) confirmar "Sim" + motivo
  d.querySelector('input[name="el-auth"][value="sim"]').checked = true;
  d.getElementById("el-reason").value = "Agenda tranquila";
  d.getElementById("el-confirm").click();
  await wait(30);
  const saida = store.timeClockEntries.find(t => t.type === "saida");
  ok(!!saida, "saída registrada");
  ok(saida && saida.earlyLeave && saida.earlyLeave.status === "pendente" && saida.earlyLeave.claimedAuthorized === true && saida.earlyLeave.reason === "Agenda tranquila", "earlyLeave pendente gravado: " + JSON.stringify(saida && saida.earlyLeave));
  const ap = store.approvals[0];
  ok(store.approvals.length === 1 && ap.type === "ajuste_ponto" && ap.status === "pendente", "criou 1 aprovação pendente");
  ok(ap && ap.payload.kind === "saida_antecipada" && ap.payload.entryId === saida.id && ap.payload.earlyMin === 40 && ap.payload.exitTime === "18:20" && ap.payload.claimedAuthorized === true, "payload: " + JSON.stringify(ap && ap.payload));
  ok(ap && /Saída antecipada — Vitória Rodrigues/.test(ap.summary) && /18:20/.test(ap.summary), "resumo: " + (ap && ap.summary));
  ok(/enviada para a gerência/.test(d.getElementById("ponto-done-body").textContent), "mensagem final avisa a gerência");
  ok(PC.computeDay(D, store.timeClockEntries.filter(t => t.date === D), emp).saldoMin === 0, "pendente: dia neutro");

  // 2d) aprovar → abonada
  const r1 = await w.Approvals.approve(ap.id, w.PontoAjustes.apply);
  ok(r1.ok && saida.earlyLeave.status === "abonada" && !!saida.earlyLeave.decidedAt && saida.earlyLeave.decidedByName === "Luiza Gerente", "aprovar → abonada: " + JSON.stringify(saida.earlyLeave));
  ok(saida.earlyLeave.reason === "Agenda tranquila" && saida.earlyLeave.claimedAuthorized === true, "aprovar preserva motivo/resposta");
  ok(PC.computeDay(D, store.timeClockEntries.filter(t => t.date === D), emp).saldoMin === 0, "abonada: dia neutro");

  // 2e) recusar (usa o gancho automático do Approvals.reject)
  saida.earlyLeave = { status: "pendente", claimedAuthorized: false, reason: "" };
  const ap2 = w.PontoAjustes.requestEarlyLeave({ entryId: saida.id, employeeId: "v1", employeeName: "Vitória Rodrigues", date: D, exitTime: "18:20", earlyMin: 40, claimedAuthorized: false });
  const r2 = await w.Approvals.reject(ap2.id, "não foi combinado");
  ok(r2.ok && saida.earlyLeave.status === "recusada", "recusar → recusada");
  const dd = PC.computeDay(D, store.timeClockEntries.filter(t => t.date === D), emp);
  ok(dd.saldoMin === -40 && dd.missingMin === 40, "recusada: -40 no banco: " + dd.saldoMin);

  // 2f) decisão duplicada não reaplica
  const r3 = await w.Approvals.reject(ap2.id);
  ok(!r3.ok, "recusar de novo é barrado");

  // 2g) batida dentro da tolerância (18:55): sem pergunta
  store.timeClockEntries = store.timeClockEntries.filter(t => t.type !== "saida");
  store.approvals.length = 0;
  NOW = new RealDate(2026, 9, 8, 18, 55, 0).getTime();
  d.getElementById("ponto-back").click(); await wait(10);
  d.querySelector("[data-emp='v1']").click();
  pickSelfie(); await wait(30);
  const s2 = store.timeClockEntries.find(t => t.type === "saida");
  ok(!d.getElementById("el-confirm") && s2 && !s2.earlyLeave && store.approvals.length === 0, "5 min antes: registra direto, sem pergunta nem aprovação");

  // 2h) ponto-ajustes.apply de entrada apagada não quebra
  let threw = false;
  try { w.PontoAjustes.apply({ kind: "saida_antecipada", entryId: "inexistente" }); w.PontoAjustes.onReject({ kind: "saida_antecipada", entryId: "inexistente" }); } catch (e) { threw = true; }
  ok(!threw, "decisão sobre batida apagada não quebra");

  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})();
