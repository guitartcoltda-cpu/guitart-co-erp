/* Teste — Folha de Ponto: fechar/publicar, travar o mês, assinaturas (qualquer ordem) e reabrir. Uso: node test/folha-assinatura.test.js */
"use strict";
process.env.TZ = "America/Sao_Paulo";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
console.log("=== Folha de Ponto — publicação, trava e assinatura ===");

const VD = { 0: null, 1: null }; [2, 3, 4, 5, 6].forEach(d => VD[d] = { start: "09:30", end: "19:00" });
const WS = { days: VD, lunchMin: 60, lunchFrom: "13:00", lunchTo: "14:00" };
const at = (day, h, m, mo) => new Date(2026, (mo || 9) - 1, day, h, m, 0).toISOString();
function pdate(day, mo) { return "2026-" + String(mo || 9).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
function punches(emp, name, day, mo, times) {
  const types = ["entrada", "saida_almoco", "volta_almoco", "saida"];
  return times.map((t, i) => ({ id: emp + "_" + day + "_" + i, employeeId: emp, employeeName: name, date: pdate(day, mo), type: types[i], timestamp: at(day, t[0], t[1], mo), reviewed: true, origin: "manual" }));
}
const store = {
  employees: [
    { id: "v1", name: "Vitória Rodrigues", role: "Cabeleireiro(a)", cpf: "11111111111", status: "ativo", requiresTimeClock: true, workSchedule: WS },
    { id: "a1", name: "Ana Souza", role: "Manicure e Pedicure", cpf: "22222222222", status: "ativo", requiresTimeClock: true, workSchedule: WS }
  ],
  users: [],
  timeSheets: [],
  approvals: [],
  timeClockEntries: [].concat(
    punches("v1", "Vitória Rodrigues", 1, 9, [[9, 30], [13, 0], [14, 0], [19, 0]]),
    punches("v1", "Vitória Rodrigues", 2, 9, [[9, 36], [13, 0], [14, 0], [18, 55]]),
    punches("v1", "Vitória Rodrigues", 3, 9, [[9, 30], [13, 0], [14, 0], [19, 0]]),
    punches("a1", "Ana Souza", 1, 9, [[9, 30], [13, 0], [14, 0], [19, 0]]),
    punches("v1", "Vitória Rodrigues", 5, 10, [[9, 30], [13, 0], [14, 0], [19, 0]])
  )
};
const logs = [];
const html = fs.readFileSync(path.join(root, "ponto-gestao.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/ponto-gestao.html", pretendToBeVisual: true });
const w = dom.window;
let seq = 0;
w.DB = {
  ready: Promise.resolve(), all: t => (store[t] || []).slice(), get: (t, id) => (store[t] || []).find(x => x.id === id) || null,
  find: (t, fn) => (store[t] || []).filter(fn), findOne: (t, fn) => (store[t] || []).find(fn) || null,
  insert: (t, rec) => { const r = Object.assign({ id: "n" + (++seq) }, JSON.parse(JSON.stringify(rec))); store[t].push(r); return r; },
  update: (t, id, p) => Object.assign(store[t].find(x => x.id === id), p),
  mergeRecordUpdate: (t, id, fn) => { const r = store[t].find(x => x.id === id); return Object.assign(r, JSON.parse(JSON.stringify(fn(r)))); },
  mergeFieldUpdate: () => {}, batch: fn => fn(), remove: (t, id) => { store[t] = store[t].filter(x => x.id !== id); },
  nowISO: () => new Date().toISOString(), getSettings: () => ({}), getRoles: () => [], log: (a, b) => logs.push(a + ": " + b), hasRemote: () => false,
  fetchFresh: () => Promise.resolve(null), confirmSaved: () => Promise.resolve(true), optionalTableMissing: () => false
};
let cur = { id: "adm", role: "Administrador", firstName: "Admin", lastName: "Sistema", cpf: "00000000000" };
w.CurrentUser = { get: () => cur };
w.Approvals = { listPending: () => [], canApprove: () => true, TYPE_LABELS: {} };
w.Layout = { init() {}, render() {} };
const errors = [];
w.addEventListener("error", e => errors.push(e.message));
["utils.js", "period-filter.js", "ponto-calc.js", "folha-ponto.js", "ponto-ajustes.js"].forEach(f => w.eval(fs.readFileSync(path.join(root, "assets", "js", f), "utf8")));
const toasts = [];
w.Toast.show = (m, k) => toasts.push(k + ":" + m);
const FP = w.FolhaPonto, PC = w.PontoCalc;
w.navigator.__defineGetter__("userAgent", () => "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36");
const sync = fn => new Promise(res => fn((okk, msg) => res({ ok: okk, msg })));

(async function () {
  ok(errors.length === 0, "carregou sem erros: " + errors.join("|"));

  // ---- SHA-256 e JSON canônico ----
  ok(FP.sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256('abc')");
  ok(FP.sha256Hex("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sha256('')");
  ok(FP.sha256Hex("açaí – Guitart") === require("crypto").createHash("sha256").update("açaí – Guitart", "utf8").digest("hex"), "sha256 com acentos bate com o do Node");
  ok(FP.canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }) === '{"a":[2,{"c":2,"d":1}],"b":1}', "canonicalJson ordena chaves");
  ok(FP.hashSnapshot({ x: 1, y: 2 }) === FP.hashSnapshot({ y: 2, x: 1 }), "hash independe da ordem das chaves");
  ok(FP.deviceLabel("Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36") === "Android · Chrome (celular/tablet)", "rótulo do aparelho");

  // ---- Publicar ----
  cur = { id: "ger", role: "Gerente", firstName: "Luiza", lastName: "Gerente", cpf: "33333333333" };
  let r = FP.publishOne(store.employees[0], "2026-09");
  ok(!r.ok && /administradores/.test(r.error), "gerente não publica");
  cur = { id: "adm", role: "Administrador", firstName: "Admin", lastName: "Sistema", cpf: "00000000000" };
  r = FP.publishOne(store.employees[0], "2099-01");
  ok(!r.ok && /não terminou/.test(r.error), "não publica mês que não terminou");
  const curMonth = w.Utils.monthKey(w.Utils.todayISO());
  r = FP.publishOne(store.employees[0], curMonth);
  ok(!r.ok, "não publica o mês corrente");
  r = FP.publishOne(store.employees[0], "2026-09");
  ok(r.ok && r.sheet.hash && r.sheet.snapshot.rows.length > 0, "administrador publica");
  const sheet = r.sheet;
  ok(sheet.snapshot.monthLabel === "Setembro de 2026" || /Setembro/i.test(sheet.snapshot.monthLabel), "rótulo do mês: " + sheet.snapshot.monthLabel);
  ok(FP.verifyIntegrity(sheet), "integridade ok");
  const row02 = sheet.snapshot.rows.find(x => x.date === "2026-09-02");
  ok(row02 && row02.c[5] === "8h30" && !/tol/i.test(row02.c[9]), "tolerância é aplicada mas não é exibida na folha congelada: " + JSON.stringify(row02 && row02.c));
  ok(sheet.snapshot.totals.saldo === "0h00", "saldo do período com tolerância = 0h00 (" + sheet.snapshot.totals.saldo + ")");
  const tampered = JSON.parse(JSON.stringify(sheet)); tampered.snapshot.totals.saldo = "+9h00";
  ok(!FP.verifyIntegrity(tampered), "adulteração é detectada");
  r = FP.publishOne(store.employees[0], "2026-09");
  ok(!r.ok && /Já existe/.test(r.error), "não duplica folha ativa do mês");
  ok(FP.statusOf(sheet) === "aguardando", "status inicial aguardando");

  // ---- Trava ----
  ok(!!FP.lockFor("v1", "2026-09-15") && !FP.lockFor("v1", "2026-10-05") && !FP.lockFor("a1", "2026-09-15"), "só trava o mês e a pessoa da folha");
  toasts.length = 0;
  ok(FP.guard("v1", "2026-09-10") === true && /fechado/.test(toasts[0] || ""), "guard bloqueia e avisa");
  ok(FP.guard("v1", "2026-10-10") === false, "guard libera mês aberto");
  ok(w.PontoAjustes.isLocked({ employeeId: "v1", date: "2026-09-20", kind: "ponto_novo" }) === true, "aprovação de ajuste em mês travado é bloqueada");
  ok(w.PontoAjustes.isLocked({ employeeId: "v1", date: "2026-08-29", endDate: "2026-09-02", kind: "atestado" }) === true, "período de atestado que entra no mês travado é bloqueado");
  ok(w.PontoAjustes.isLocked({ employeeId: "v1", date: "2026-10-02", kind: "ponto_novo" }) === false, "ajuste em mês aberto passa");

  // ---- Assinatura: usuária não vinculada / outra pessoa ----
  cur = { id: "uA", role: "Profissional", firstName: "Ana", lastName: "Souza", cpf: "22222222222", employeeId: "a1" };
  ok(!FP.canSignAsEmployee(sheet), "outra funcionária não assina a folha da Vitória");
  let res = await sync(cb => FP.sign(sheet.id, "employee", cb));
  ok(!res.ok, "sign() recusa quem não é a titular");
  ok(!FP.canSignAsManager(sheet), "Profissional não assina pela gerência");

  // ---- Qualquer ordem: gerência primeiro ----
  cur = { id: "ger", role: "Gerente", firstName: "Luiza", lastName: "Gerente", cpf: "33333333333" };
  ok(FP.canSignAsManager(sheet), "gerente pode assinar pela gerência");
  res = await sync(cb => FP.sign(sheet.id, "manager", cb));
  ok(res.ok, "gerência assina");
  let s2 = w.DB.get("timeSheets", sheet.id);
  ok(s2.signatures.manager && s2.signatures.manager.name === "Luiza Gerente" && s2.signatures.manager.hash === sheet.hash, "assinatura da gerência guarda nome e hash");
  ok(/Android/.test(s2.signatures.manager.device) && s2.signatures.manager.at, "guarda aparelho e data/hora: " + s2.signatures.manager.device);
  ok(FP.statusOf(s2) === "parcial", "status parcial");
  ok(!FP.canSignAsManager(s2), "não assina duas vezes pela gerência");
  // titular (vinculada por employeeId)
  cur = { id: "uV", role: "Profissional", firstName: "Vitória", lastName: "Rodrigues", cpf: "11111111111", employeeId: "v1" };
  ok(FP.canSignAsEmployee(s2) && !FP.canSignAsManager(s2), "titular pode assinar como funcionária (só)");
  ok(FP.pendingForEmployee("v1").length === 1, "1 folha pendente para a titular");
  res = await sync(cb => FP.sign(sheet.id, "employee", cb));
  ok(res.ok, "titular assina");
  s2 = w.DB.get("timeSheets", sheet.id);
  ok(FP.statusOf(s2) === "concluida" && FP.pendingForEmployee("v1").length === 0, "concluída com as duas assinaturas");
  ok(s2.history.length === 3, "histórico: publicada + 2 assinaturas (" + s2.history.length + ")");
  res = await sync(cb => FP.sign(sheet.id, "employee", cb));
  ok(!res.ok, "não assina de novo");

  // ---- PDF ----
  const calls = []; let pages = 1, cur2 = 1;
  const fakeDoc = { internal: { pageSize: { getWidth: () => 842, getHeight: () => 595 } }, setFont() {}, setFontSize() {}, setLineWidth() {}, line() {}, setTextColor() {}, addPage() { pages++; }, getNumberOfPages: () => pages, setPage(n) { cur2 = n; }, text(t) { calls.push(String(t)); } };
  FP.drawPdf(fakeDoc, [{ snap: s2.snapshot, sheet: s2 }]);
  const all = calls.join("\n");
  ok(/Assinado eletronicamente/.test(all) && /Vitória Rodrigues/.test(all) && /Luiza Gerente/.test(all), "PDF mostra as duas assinaturas");
  ok(all.indexOf(s2.hash) >= 0 && all.indexOf(FP.shortCode(s2.hash)) >= 0, "PDF mostra hash e código de verificação");
  ok(/Situação: Concluída/.test(all), "PDF mostra a situação");
  calls.length = 0; pages = 1;
  FP.drawPdf(fakeDoc, [{ snap: FP.buildSnapshot(store.employees[1], "2026-09", store.timeClockEntries, { generatedBy: "Admin" }), sheet: null }]);
  ok(!/Assinado eletronicamente/.test(calls.join("\n")) && /Assinatura do Funcionário/.test(calls.join("\n")), "rascunho sem assinatura mantém as linhas em branco");

  // ---- Reabrir ----
  cur = { id: "ger", role: "Gerente", firstName: "Luiza", lastName: "Gerente", cpf: "33333333333" };
  res = await sync(cb => FP.cancelSheet(sheet.id, "teste", cb));
  ok(!res.ok, "gerente não reabre");
  cur = { id: "adm", role: "Administrador", firstName: "Admin", lastName: "Sistema", cpf: "00000000000" };
  res = await sync(cb => FP.cancelSheet(sheet.id, "esqueci um atestado", cb));
  ok(res.ok, "administrador reabre");
  const c = w.DB.get("timeSheets", sheet.id);
  ok(c.status === "cancelada" && c.cancelReason === "esqueci um atestado" && c.signatures.employee && c.signatures.manager, "reabertura guarda motivo e mantém as assinaturas só no histórico");
  ok(FP.statusOf(c) === "cancelada" && !FP.lockFor("v1", "2026-09-15"), "mês destravado");
  ok(!FP.canSignAsEmployee(c) && !FP.canSignAsManager(c), "folha cancelada não pode mais ser assinada");
  r = FP.publishOne(store.employees[0], "2026-09");
  ok(r.ok && r.sheet.id !== sheet.id && FP.statusOf(r.sheet) === "aguardando", "nova publicação depois da reabertura");

  // ---- Publicar em lote + telas ----
  const many = FP.publishMany(["v1", "a1"], "2026-09");
  ok(many.length === 2 && !many[0].res.ok && many[1].res.ok, "lote: pula quem já tem folha e publica o resto");
  const root1 = w.document.getElementById("pg-assinaturas-root");
  FP.mountManagerPanel(root1);
  ok(root1.querySelectorAll("tbody tr").length === 3, "painel da gestão lista as 3 folhas (incl. cancelada): " + root1.querySelectorAll("tbody tr").length);
  ok(!!root1.querySelector("#fp-publish"), "admin vê o botão Fechar e Publicar");
  ok(root1.querySelectorAll("[data-fp-cancel]").length === 2, "Reabrir só nas folhas ativas");
  cur = { id: "ger", role: "Gerente", firstName: "Luiza", lastName: "Gerente", cpf: "33333333333" };
  FP.refresh();
  ok(!root1.querySelector("#fp-publish") && root1.querySelectorAll("[data-fp-sign]").length === 2 && !root1.querySelector("[data-fp-cancel]"), "gerente: sem publicar/reabrir, com Assinar");
  const empBox = w.document.createElement("div"); w.document.body.appendChild(empBox);
  cur = { id: "uV", role: "Profissional", firstName: "Vitória", lastName: "Rodrigues", cpf: "11111111111", employeeId: "v1" };
  FP.mountEmployeePanel(empBox, store.employees[0]);
  ok(empBox.querySelectorAll("[data-fp-sign]").length === 1 && /Para assinar \(1\)/.test(empBox.textContent), "painel da funcionária mostra 1 para assinar");
  cur = { id: "adm", role: "Administrador", firstName: "Admin", lastName: "Sistema", cpf: "00000000000" };
  FP.refresh();
  ok(empBox.querySelectorAll("[data-fp-sign]").length === 0 && /Entre com o seu usuário/.test(empBox.textContent), "outro usuário vê mas não assina");
  empBox.querySelector("[data-fp-view]").click();
  ok(!!w.document.querySelector(".fp-table") && /Código de verificação/.test(w.document.querySelector(".modal-body").textContent), "visualizador abre a folha em tela");

  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})();
