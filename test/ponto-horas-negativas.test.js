/* Teste de interface — "Horas negativas (desconto)" na Gestão de Ponto (ponto-gestao.html + ponto-gestao.js), em jsdom.
   Uso: node test/ponto-horas-negativas.test.js */
"use strict";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

const VD = { 0: null, 1: null }; [2, 3, 4, 5, 6].forEach(d => VD[d] = { start: "09:30", end: "19:00" });
const store = {
  employees: [{ id: "v1", name: "Vitória Rodrigues", role: "Cabeleireiro(a)", status: "ativo", requiresTimeClock: true,
    workSchedule: { days: VD, lunchMin: 60, lunchFrom: "13:00", lunchTo: "14:00" } }],
  timeClockEntries: [{ id: "oc1", employeeId: "v1", employeeName: "Vitória Rodrigues", date: "2026-09-29", type: "outro", note: "FALTA", timestamp: new Date(2026, 8, 29).toISOString(), reviewed: true, origin: "manual" }]
};
const logs = [];
const html = fs.readFileSync(path.join(root, "ponto-gestao.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/ponto-gestao.html", pretendToBeVisual: true });
const w = dom.window;
let seq = 0;
w.DB = {
  ready: Promise.resolve(), all: t => (store[t] || []).slice(), get: (t, id) => (store[t] || []).find(x => x.id === id) || null,
  insert: (t, rec) => { const r = Object.assign({ id: "n" + (++seq) }, rec); store[t].push(r); return r; },
  update: (t, id, p) => Object.assign(store[t].find(x => x.id === id), p),
  mergeRecordUpdate: (t, id, fn) => Object.assign(store[t].find(x => x.id === id), fn(store[t].find(x => x.id === id))),
  mergeFieldUpdate: () => {}, batch: fn => fn(), remove: (t, id) => { store[t] = store[t].filter(x => x.id !== id); },
  nowISO: () => new Date().toISOString(), getSettings: () => ({}), getRoles: () => [], log: (a, b) => logs.push(a + ": " + b), hasRemote: () => false
};
w.CurrentUser = { get: () => ({ id: "u", role: "Administrador", firstName: "A", lastName: "B" }) };
w.Approvals = { listPending: () => [], canApprove: () => true, TYPE_LABELS: {} };
w.Layout = { init() {}, render() {} };
w.jspdf = {};
const errors = [];
w.addEventListener("error", e => errors.push(e.message));
["utils.js", "period-filter.js", "ponto-calc.js", "ponto-ajustes.js"].forEach(f => w.eval(fs.readFileSync(path.join(root, "assets", "js", f), "utf8")));
const toasts = [];
w.Toast.show = (m, k) => toasts.push(k + ":" + m);
try { w.eval(fs.readFileSync(path.join(root, "assets", "js", "ponto-gestao.js"), "utf8")); } catch (e) { errors.push("load: " + e.message); }

(async function () {
  await wait(80);
  const d = w.document;
  ok(errors.length === 0, "sem erro ao carregar: " + errors.join(" | "));
  const btn = d.getElementById("btn-new-manual-entry");
  ok(!!btn, "botão Lançar Ponto Manual existe");
  btn.click();
  const sel = d.getElementById("me-type");
  ok(!!sel, "modal abriu");
  const opt = Array.from(sel.options).find(o => o.value === "debito_horas");
  ok(!!opt && /Horas negativas/.test(opt.textContent), "tipo 'Horas negativas (desconto)' disponível");
  ok(d.getElementById("me-debit-wrap").style.display === "none", "campos de horas escondidos nos outros tipos");

  sel.value = "debito_horas"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(d.getElementById("me-debit-wrap").style.display !== "none", "campos de horas aparecem");
  ok(d.getElementById("me-time-row").style.display === "none", "hora da batida some");
  ok(d.getElementById("me-usebank").checked, "'Descontar do banco' vem marcado");
  const date2 = d.getElementById("me-date2");
  date2.value = "2026-09-29"; date2.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(d.getElementById("me-debit").value === "08:30", "sugere a jornada do dia (terça: 09:30–19:00 − 1h = 8h30): " + d.getElementById("me-debit").value);

  // horas inválidas
  const debit = d.getElementById("me-debit");
  debit.value = ""; debit.dispatchEvent(new w.Event("input", { bubbles: true }));
  d.getElementById("me-save").click();
  ok(toasts.some(t => /Informe as horas/.test(t)), "bloqueia horas vazias");
  ok(store.timeClockEntries.length === 1, "nada gravado com horas vazias");

  // grava 8h30 no banco
  debit.value = "0830"; debit.dispatchEvent(new w.Event("input", { bubbles: true }));
  ok(debit.value === "08:30", "máscara HH:MM: " + debit.value);
  d.getElementById("me-reason").value = "Falta 29/09";
  d.getElementById("me-save").click();
  const rec = store.timeClockEntries.find(t => t.type === "debito_horas");
  ok(!!rec, "gravou o registro");
  ok(rec && rec.debitMin === 510 && rec.useBank === true && rec.date === "2026-09-29" && rec.employeeId === "v1" && rec.origin === "manual" && rec.reviewed === true, "campos: " + JSON.stringify(rec));
  ok(logs.some(l => /Lançou horas negativas de Vitória Rodrigues \(-8h30 em 29\/09\/2026, descontado do banco de horas\)/.test(l)), "log de atividade: " + logs.join(" | "));

  // segundo lançamento no mesmo dia, sem usar o banco — permitido
  btn.click();
  const sel2 = d.getElementById("me-type"); sel2.value = "debito_horas"; sel2.dispatchEvent(new w.Event("change", { bubbles: true }));
  d.getElementById("me-date2").value = "2026-09-29";
  d.getElementById("me-debit").value = "01:00"; d.getElementById("me-debit").dispatchEvent(new w.Event("input", { bubbles: true }));
  d.getElementById("me-usebank").checked = false;
  d.getElementById("me-save").click();
  const recs = store.timeClockEntries.filter(t => t.type === "debito_horas");
  ok(recs.length === 2 && recs[1].useBank === false && recs[1].debitMin === 60, "segundo lançamento no mesmo dia, em folha");

  // cálculo
  const r = w.PontoCalc.espelho("v1", "2026-09-01", "2026-09-30", store.employees[0], store.timeClockEntries, { today: "2026-10-08" });
  ok(r.totals.saldoMin === -510 && r.totals.adjustPayMin === 60, "totais: banco −510, folha 60 (veio " + r.totals.saldoMin + "/" + r.totals.adjustPayMin + ")");

  // telas: Banco de Horas (tabela geral), Controle de Ponto (consolidado), modal do dia, revisão
  const tblPonto = d.getElementById("tbl-ponto").textContent;
  ok(/Horas negativas/.test(tblPonto) && /8h30 no banco de horas/.test(tblPonto) && /1h00 em folha/.test(tblPonto) && /FALTA/.test(tblPonto), "Controle de Ponto mostra a falta + horas negativas: " + tblPonto.replace(/\s+/g, " ").slice(0, 300));
  const openDay = d.querySelector('[data-open-day="v1|2026-09-29"]');
  ok(!!openDay, "botão do dia 29/09 existe");
  openDay.click();
  const modalTxt = d.querySelector(".modal-body").textContent.replace(/\s+/g, " ");
  ok(/Falta/i.test(modalTxt) && (modalTxt.match(/Horas negativas \(desconto\)/g) || []).length === 2 && /-8h30 no banco de horas/.test(modalTxt) && /em folha de pagamento/.test(modalTxt), "modal do dia lista a ocorrência e as 2 horas negativas: " + modalTxt.slice(0, 300));
  const lupa = Array.from(d.querySelectorAll("[data-tl-entry]")).find(b => store.timeClockEntries.find(t => t.id === b.getAttribute("data-tl-entry") && t.type === "debito_horas" && t.useBank === false));
  ok(!!lupa, "lupa da hora negativa em folha existe");
  lupa.click();
  const debitInp = d.getElementById("pg-debit");
  ok(!!debitInp && debitInp.value === "01:00" && d.getElementById("pg-usebank").checked === false && !d.getElementById("pg-time"), "revisão mostra HH:MM + caixa do banco desmarcada, sem campo de hora da batida");
  debitInp.value = "02:00"; d.getElementById("pg-usebank").checked = true;
  d.getElementById("pg-save").click();
  const upd = store.timeClockEntries.find(t => t.debitMin === 120);
  ok(!!upd && upd.useBank === true && upd.date === "2026-09-29", "edição salva horas e opção do banco: " + JSON.stringify(upd));
  const r2 = w.PontoCalc.espelho("v1", "2026-09-01", "2026-09-30", store.employees[0], store.timeClockEntries, { today: "2026-10-08" });
  ok(r2.totals.saldoMin === -630 && r2.totals.adjustPayMin === 0, "totais após editar: −10h30 no banco, 0 em folha (veio " + r2.totals.saldoMin + "/" + r2.totals.adjustPayMin + ")");
  // horas inválidas na revisão
  debitInp.value = "00:00"; d.getElementById("pg-save").click();
  ok(toasts.some(t => /maior que 00:00/.test(t)), "revisão recusa 00:00");

  ok(errors.length === 0, "nenhum erro durante o uso: " + errors.join(" | "));
  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
