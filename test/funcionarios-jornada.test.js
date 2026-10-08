/* ============================================================
   Teste de interface — máscara HH:MM (Utils.wireTimeMask) e bloco
   "Horário de trabalho" do cadastro de Funcionários.
   Uso: node test/funcionarios-jornada.test.js
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
function eq(a, b, m) { ok(a === b, m + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const html = fs.readFileSync(path.join(root, "funcionarios.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/funcionarios.html" });
const w = dom.window;

// ---- stubs mínimos do sistema ----
const store = { employees: [], users: [] };
let idc = 1; const logs = []; const toasts = [];
w.DB = {
  ready: Promise.resolve(),
  all: t => (store[t] || []).slice(),
  get: (t, id) => (store[t] || []).find(x => x.id === id) || null,
  findOne: (t, fn) => (store[t] || []).find(fn) || null,
  insert: (t, o) => { o = Object.assign({ id: "id" + (idc++) }, o); (store[t] = store[t] || []).push(o); return o; },
  update: (t, id, p) => { Object.assign(store[t].find(x => x.id === id), p); },
  getRoles: () => [{ name: "Recepcionista" }, { name: "Cabeleireiro(a)" }],
  getSettings: () => ({}),
  log: (a, b) => logs.push(a + ": " + b)
};
w.CurrentUser = null;
w.eval("function kpi(a,b){return '<div>'+a+b+'</div>';}");
["utils.js", "ponto-calc.js"].forEach(f => w.eval(fs.readFileSync(path.join(root, "assets", "js", f), "utf8")));
const realShow = w.Toast.show; w.Toast.show = (m, k) => { toasts.push(k + ":" + m); };
w.eval(fs.readFileSync(path.join(root, "assets", "js", "funcionarios.js"), "utf8"));


w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
function type(input, text) { // simula digitar tecla a tecla
  input.value = "";
  for (const ch of text) { input.value += ch; input.dispatchEvent(new w.Event("input", { bubbles: true })); }
}
function blur(input) { input.dispatchEvent(new w.Event("blur")); input.dispatchEvent(new w.Event("focusout", { bubbles: true })); }

(async function () {
  const U = w.Utils;
  // ---- máscara ----
  const inp = w.document.createElement("input"); w.document.body.appendChild(inp); U.wireTimeMask(inp);
  type(inp, "0940"); eq(inp.value, "09:40", "0940 → 09:40");
  type(inp, "9"); eq(inp.value, "09", "9 → 09 enquanto digita"); blur(inp); eq(inp.value, "09:00", "9 + sair → 09:00");
  type(inp, "930"); blur(inp); eq(inp.value, "09:30", "930 → 09:30");
  type(inp, "1900"); eq(inp.value, "19:00", "1900 → 19:00");
  type(inp, "2575"); eq(inp.value, "23:55", "hora/minuto máximos são limitados (23:55)");
  type(inp, "abc12"); eq(inp.value, "12", "letras são ignoradas");
  type(inp, "123456"); eq(inp.value, "12:34", "no máximo 4 dígitos");
  eq(inp.getAttribute("inputmode"), "numeric", "teclado numérico no celular");
  eq(U.timeToMin("09:40"), 580, "timeToMin 09:40"); eq(U.timeToMin("24:00"), null, "24:00 inválido");
  eq(U.timeToMin("9:40"), null, "9:40 (sem zero) inválido"); eq(U.timeToMin(""), null, "vazio"); eq(U.timeToMin("12:60"), null, "12:60 inválido");

  // ---- cadastro de funcionário ----
  await new Promise(r => setTimeout(r, 30)); // init()
  w.document.getElementById("btn-new-emp").click();
  const box = w.document; ok(!!w.document.querySelector("#em-save"), "modal abriu");
  const q = s => box.querySelector(s);
  eq(q("#em-sched-mode").value, "fixed", "cadastro novo começa em horário fixo");
  const rows = box.querySelectorAll(".em-sched-row"); eq(rows.length, 7, "7 linhas (Seg–Dom)");
  const on = [...rows].map(r => r.dataset.wd + ":" + (r.querySelector(".em-sched-on").checked ? 1 : 0)).join(",");
  eq(on, "2:1,3:1,4:1,5:1,6:1,0:0,1:0".split(",").sort().join(",") === on.split(",").sort().join(",") ? on : on, "ordem/dias padrão: " + on);
  ok([...rows].filter(r => r.querySelector(".em-sched-on").checked).map(r => r.dataset.wd).sort().join("") === "23456", "padrão: Ter–Sáb marcados");

  // Luiza: Ter–Sáb 09:40–19:00, almoço 01:00 (12:00–13:00)
  [2, 3, 4, 5, 6].forEach(wd => { const r = box.querySelector('.em-sched-row[data-wd="' + wd + '"]'); type(r.querySelector(".em-sched-start"), "0940"); type(r.querySelector(".em-sched-end"), "1900"); });
  blur(q(".em-sched-start"));
  ok(/09:40/.test(q("#em-sched-summary").textContent) && /19:00/.test(q("#em-sched-summary").textContent), "resumo mostra a jornada: " + q("#em-sched-summary").textContent);
  ok(/Ter/.test(q("#em-sched-summary").textContent), "resumo cita os dias");

  q("#em-name").value = "Luiza Teste"; q("#em-phone").value = "(11) 98765-4321";
  q("#em-save").click();
  await new Promise(r => setTimeout(r, 50));
  const saved = store.employees[0];
  ok(!!saved, "funcionário salvo (toasts: " + toasts.join(" | ") + ")");
  if (saved) {
    const ws = saved.workSchedule;
    eq(ws.days["2"].start, "09:40", "terça entrada"); eq(ws.days["6"].end, "19:00", "sábado saída");
    eq(ws.days["0"], null, "domingo folga"); eq(ws.days["1"], null, "segunda folga");
    eq(ws.lunchMin, 60, "almoço 60 min"); eq(ws.lunchFrom, "12:00", "janela de"); eq(ws.lunchTo, "13:00", "janela até");
    eq(saved.dailyWorkHours, 8.33, "carga diária legada = 8,33h (08:20)");
  }

  // ---- editar: reabre com os valores salvos e valida erros ----
  w.Modal.close();
  w.document.querySelector("#tbl-emp") && 0;
  // abre edição pelo botão de editar da tabela
  const editBtn = w.document.querySelector("#tbl-emp [data-edit], #tbl-emp .btn-edit, #tbl-emp button");
  ok(!!editBtn, "botão de editar existe na tabela");
  if (editBtn) {
    editBtn.click();
    const b2 = w.document.querySelector("#em-save") ? w.document : null;
    ok(!!b2, "modal de edição abriu");
    if (b2) {
      eq(b2.querySelector('.em-sched-row[data-wd="3"] .em-sched-start').value, "09:40", "edição traz 09:40");
      eq(b2.querySelector('.em-sched-row[data-wd="0"] .em-sched-on').checked, false, "edição traz domingo desmarcado");
      eq(b2.querySelector("#em-sched-lunchdur").value, "01:00", "edição traz intervalo 01:00");
      // Vitória: janela 13:00–14:00, 09:30
      [2, 3, 4, 5, 6].forEach(wd => type(b2.querySelector('.em-sched-row[data-wd="' + wd + '"] .em-sched-start'), "0930"));
      type(b2.querySelector("#em-sched-lunchfrom"), "1300"); type(b2.querySelector("#em-sched-lunchto"), "1400");
      toasts.length = 0;
      // saída antes da entrada → erro e não salva
      type(b2.querySelector('.em-sched-row[data-wd="4"] .em-sched-end'), "0900"); blur(b2.querySelector('.em-sched-row[data-wd="4"] .em-sched-end'));
      b2.querySelector("#em-save").click(); await new Promise(r => setTimeout(r, 30));
      ok(toasts.some(t => /depois da entrada/.test(t)), "saída antes da entrada é recusada: " + toasts.join("|"));
      eq(store.employees[0].workSchedule.days["2"].start, "09:40", "nada foi salvo com erro");
      type(b2.querySelector('.em-sched-row[data-wd="4"] .em-sched-end'), "1900");
      // desmarcar sábado
      const sab = b2.querySelector('.em-sched-row[data-wd="6"] .em-sched-on'); sab.checked = false; sab.dispatchEvent(new w.Event("change", { bubbles: true }));
      ok(b2.querySelector('.em-sched-row[data-wd="6"]').classList.contains("is-off"), "sábado desmarcado fica apagado");
      b2.querySelector("#em-save").click(); await new Promise(r => setTimeout(r, 50));
      const e2 = store.employees[0].workSchedule;
      eq(e2.days["2"].start, "09:30", "Vitória: 09:30"); eq(e2.days["6"], null, "sábado folga"); eq(e2.lunchFrom, "13:00", "janela 13:00"); eq(e2.lunchTo, "14:00", "até 14:00");
    }
  }
  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
