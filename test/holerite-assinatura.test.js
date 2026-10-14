/* Teste — Holerite: publicar, travar, assinar (funcionária + gerência), reabrir, aba da funcionária, PDF e integração com a Folha de Pagamento. Uso: node test/holerite-assinatura.test.js */
"use strict";
process.env.TZ = "America/Sao_Paulo";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
console.log("=== Holerite — publicação, trava e assinatura ===");

const LUIZA = { id: "e1", name: "Luiza Morais", role: "Recepcionista", status: "ativo", baseSalary: 1800, hireDate: "2026-02-03", cpf: "44489235844", payroll: { regime: "clt", dependents: 0, advancePct: 40, vtPct: 6, familyChildren: 0, code: "1", cargo: "Recepcionista", cbo: "422105" } };
const VIT = { id: "e2", name: "Vitória Rodrigues", role: "Cabeleireiro(a)", status: "ativo", baseSalary: 1758.08, hireDate: "2026-06-12", cpf: "52005514802", payroll: { regime: "clt", dependents: 0, advancePct: 40, vtPct: 6, familyChildren: 1, code: "2", cargo: "Auxiliar de limpeza", cbo: "514320" } };

function makeEnv(html, files, user) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/", pretendToBeVisual: true });
  const w = dom.window;
  const store = { employees: [JSON.parse(JSON.stringify(LUIZA)), JSON.parse(JSON.stringify(VIT))], payslips: [], transactions: [], categories: [], timeClockEntries: [], timeSheets: [], users: [] };
  const logs = [], toasts = [], pdf = [];
  const settings = {};
  let seq = 0;
  w.DB = {
    ready: Promise.resolve(), all: t => (store[t] || []).slice(), get: (t, id) => (store[t] || []).find(x => x.id === id) || null,
    find: (t, fn) => (store[t] || []).filter(fn), findOne: (t, fn) => (store[t] || []).find(fn) || null,
    insert: (t, rec) => { const r = Object.assign({ id: "n" + (++seq) }, JSON.parse(JSON.stringify(rec))); store[t].push(r); return r; },
    update: (t, id, p) => Object.assign(store[t].find(x => x.id === id), JSON.parse(JSON.stringify(p))),
    mergeRecordUpdate: (t, id, fn) => { const r = store[t].find(x => x.id === id); return Object.assign(r, JSON.parse(JSON.stringify(fn(r)))); },
    remove: (t, id) => { store[t] = store[t].filter(x => x.id !== id); },
    getSettings: () => settings, mergeSettingsField: (f, fn) => { settings[f] = fn(settings[f]); return settings; },
    log: (a, b) => logs.push(a + ": " + b), nowISO: () => new Date().toISOString(), hasRemote: () => false,
    fetchFresh: () => Promise.resolve(null), confirmSaved: () => Promise.resolve(true), optionalTableMissing: () => false
  };
  const env = { w, store, logs, toasts, pdf, settings, user: user };
  w.CurrentUser = { get: () => env.user };
  w.Layout = { init() {}, render() {} };
  w.ComissoesCalc = { rowsForRange: () => [] };
  w.jspdf = { jsPDF: function () {
    const d = { internal: { pageSize: { getWidth: () => 595, getHeight: () => 842 } } };
    ["setFont", "setFontSize", "setLineWidth", "line", "addPage", "rect", "setDrawColor", "setTextColor"].forEach(n => d[n] = function () {});
    d.text = function (t) { pdf.push(String(t)); };
    d.save = function (n) { pdf.push("save:" + n); };
    return d;
  } };
  const errors = []; w.addEventListener("error", e => errors.push(e.message));
  files.forEach(f => w.eval(fs.readFileSync(path.join(root, "assets", "js", f), "utf8")));
  w.Toast.show = (m, k) => toasts.push(k + ":" + m);
  env.errors = errors;
  return env;
}
const ADMIN = { id: "adm", role: "Administrador", firstName: "Admin", lastName: "Sistema", cpf: "00000000000" };
const stripScripts = f => fs.readFileSync(path.join(root, f), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");

(async function () {
  // ================= módulo (sem tela) =================
  const E = makeEnv(stripScripts("ponto.html"), ["utils.js", "period-filter.js", "ponto-calc.js", "folha-calc.js", "folha-ponto.js", "holerite.js"], ADMIN);
  const w = E.w, H = w.Holerite, FC = w.FolhaCalc;
  ok(E.errors.length === 0, "carregou sem erros: " + E.errors.join("|"));
  const slipOf = emp => FC.computePayslip({ monthKey: "2026-09", regime: "clt", baseSalary: emp.baseSalary, hireDate: emp.hireDate, dependents: 0, advancePct: emp.payroll.advancePct, vtPct: emp.payroll.vtPct, familyChildren: emp.payroll.familyChildren, vales: [], extras: [] });
  const luizaSlip = slipOf(E.store.employees[0]), vitSlip = slipOf(E.store.employees[1]);

  // ---- snapshot ----
  const snap = H.buildSnapshot(E.store.employees[0], "2026-09", luizaSlip, { generatedBy: "Admin" });
  ok(snap.company.name === "GUITART & CO LTDA" && snap.company.cnpj === "61.794.868/0001-03", "cabeçalho da empresa");
  ok(snap.employee.name === "LUIZA MORAIS" && snap.employee.role === "RECEPCIONISTA" && snap.employee.cbo === "422105" && snap.employee.code === "1", "dados da funcionária (cargo e CBO do contador)");
  ok(snap.lines.map(l => l.num).join(",") === "1,11,12,109", "linhas na ordem dos códigos do contador: " + snap.lines.map(l => l.num));
  ok(snap.lines[0].ref === "30,00" && snap.lines[1].ref === "9,00" && snap.lines[3].ref === "6,00", "referências 30,00 / 9,00 / 6,00");
  ok(snap.totals.net === 834.32 && snap.totals.earnings === 1800 && snap.totals.deductions === 965.68, "totais do snapshot");
  ok(/Setembro/i.test(snap.monthLabel), "rótulo do mês: " + snap.monthLabel);
  const snapV = H.buildSnapshot(E.store.employees[1], "2026-09", vitSlip, {});
  ok(snapV.employee.role === "AUXILIAR DE LIMPEZA" && snapV.lines.map(l => l.num).join(",") === "1,4,11,12,109" && snapV.totals.net === 883.01, "snapshot da Vitória (salário-família, cargo do contador)");

  // ---- publicar ----
  E.user = { id: "ger", role: "Gerente", firstName: "Maria", lastName: "G", cpf: "33333333333" };
  let r = H.publishOne(E.store.employees[0], "2026-09", luizaSlip);
  ok(!r.ok && /administradores/.test(r.error), "gerente não publica holerite");
  E.user = ADMIN;
  r = H.publishOne(E.store.employees[0], "2099-01", luizaSlip);
  ok(!r.ok && /não terminou/.test(r.error), "não publica mês que não terminou");
  r = H.publishOne(E.store.employees[0], w.Utils.monthKey(w.Utils.todayISO()), luizaSlip);
  ok(!r.ok, "não publica o mês corrente");
  r = H.publishOne(E.store.employees[0], "2026-09", null);
  ok(!r.ok, "sem cálculo não publica");
  r = H.publishOne(E.store.employees[0], "2026-09", luizaSlip);
  ok(r.ok && r.slip.hash && r.slip.netValue === 834.32, "administrador publica");
  const rec = r.slip;
  ok(H.verifyIntegrity(rec), "integridade ok");
  const tampered = JSON.parse(JSON.stringify(rec)); tampered.snapshot.totals.net = 9999;
  ok(!H.verifyIntegrity(tampered), "adulteração é detectada");
  r = H.publishOne(E.store.employees[0], "2026-09", luizaSlip);
  ok(!r.ok && /Já existe/.test(r.error), "não duplica holerite ativo do mês");
  ok(H.statusOf(rec) === "aguardando" && !!H.activeSlip("e1", "2026-09") && !H.activeSlip("e2", "2026-09") && !H.activeSlip("e1", "2026-08"), "status inicial e busca por funcionária/mês");
  ok(H.pendingForEmployee("e1").length === 1 && H.pendingForEmployee("e2").length === 0, "pendência só da dona");

  // ---- assinatura ----
  E.user = { id: "uV", role: "Profissional", firstName: "Vitória", lastName: "R", cpf: "52005514802", employeeId: "e2" };
  ok(!H.canSignAsEmployee(rec), "outra funcionária não assina o holerite da Luiza");
  ok(!H.canSignAsManager(rec), "profissional não assina pela gerência");
  let res = await new Promise(rs => H.sign(rec.id, "employee", (o, m) => rs({ o, m })));
  ok(!res.o && /própria funcionária/.test(res.m), "assinar como outra pessoa é recusado");
  E.user = { id: "ger", role: "Gerente", firstName: "Maria", lastName: "G", cpf: "33333333333" };
  ok(!H.canSignAsManager(rec), "Gerente comum não assina holerite (restrito à administração)");
  E.user = { id: "uL", role: "Recepcionista", firstName: "Luiza", lastName: "Morais", cpf: "44489235844", employeeId: "e1" };
  ok(H.canSignAsEmployee(rec), "Luiza (vinculada) pode assinar o próprio");
  ok(!H.canSignAsManager(rec), "e não assina pela gerência");
  res = await new Promise(rs => H.sign(rec.id, "employee", (o, m) => rs({ o, m })));
  ok(res.o, "Luiza assina: " + res.m);
  ok(rec.signatures.employee && rec.signatures.employee.hash === rec.hash && !!rec.signatures.employee.device, "assinatura guarda hash do documento e aparelho");
  ok(H.statusOf(rec) === "parcial" && H.pendingForEmployee("e1").length === 0, "falta 1 assinatura; some da lista de pendentes");
  res = await new Promise(rs => H.sign(rec.id, "employee", (o, m) => rs({ o, m })));
  ok(!res.o, "não assina duas vezes");
  E.user = ADMIN;
  ok(H.canSignAsManager(rec), "administrador assina pela gerência");
  res = await new Promise(rs => H.sign(rec.id, "manager", (o, m) => rs({ o, m })));
  ok(res.o && H.statusOf(rec) === "concluida", "duas assinaturas → concluído");
  ok(E.logs.some(l => /assinou o holerite de Luiza/.test(l)), "assinatura vai para o log");
  // documento adulterado bloqueia a assinatura
  r = H.publishOne(E.store.employees[1], "2026-09", vitSlip);
  E.store.payslips.find(x => x.id === r.slip.id).snapshot.totals.net = 1;
  res = await new Promise(rs => H.sign(r.slip.id, "manager", (o, m) => rs({ o, m })));
  ok(!res.o && /não confere/.test(res.m), "holerite adulterado: assinatura bloqueada");

  // ---- reabrir ----
  E.user = { id: "ger", role: "Gerente", firstName: "Maria", lastName: "G" };
  res = await new Promise(rs => H.cancelSlip(rec.id, "x", (o, m) => rs({ o, m })));
  ok(!res.o && /administradores/.test(res.m), "gerente não reabre");
  E.user = ADMIN;
  res = await new Promise(rs => H.cancelSlip(rec.id, "ajuste do vale", (o, m) => rs({ o, m })));
  ok(res.o && rec.status === "cancelada" && H.statusOf(rec) === "cancelada" && !H.activeSlip("e1", "2026-09"), "reabrir cancela e libera o mês");
  ok(rec.history.some(h => h.action === "reaberto") && rec.history.some(h => h.action === "assinou_employee"), "histórico guarda as assinaturas antigas");
  r = H.publishOne(E.store.employees[0], "2026-09", luizaSlip);
  ok(r.ok && r.slip.id !== rec.id && H.statusOf(r.slip) === "aguardando", "depois de reaberto, publica de novo (novo documento, sem assinaturas)");

  // ---- PDF ----
  const pdfEnv = E.pdf; pdfEnv.length = 0;
  H.downloadPdf(r.slip.id);
  const joined = pdfEnv.join("|");
  ok(/RECIBO DE PAGAMENTO/.test(joined) && /GUITART & CO LTDA/.test(joined) && /61\.794\.868\/0001-03/.test(joined), "PDF: cabeçalho da empresa e título do recibo");
  ok(/834,32/.test(joined) && /137,68/.test(joined) && /720,00/.test(joined) && /108,00/.test(joined), "PDF: valores do holerite");
  ok(/Desc\. Vale Transporte/.test(joined) && /Adiantamento Anterior/.test(joined) && /INSS Sobre Salário/.test(joined), "PDF: descrições do contador");
  ok(/Assinatura pendente/.test(joined) && /save:holerite_luiza-morais_2026-09\.pdf/.test(joined), "PDF: assinatura pendente e nome do arquivo");

  // ================= aba "Holerites" no Bater Ponto =================
  const html = stripScripts("ponto.html");
  ok(/holerite\.js/.test(fs.readFileSync(path.join(root, "ponto.html"), "utf8")) && /holerite\.js/.test(fs.readFileSync(path.join(root, "folha-pagamento.html"), "utf8")), "as duas páginas carregam holerite.js");
  const P = makeEnv("<!doctype html><body><div id='pane'></div></body>", ["utils.js", "period-filter.js", "ponto-calc.js", "folha-calc.js", "folha-ponto.js", "holerite.js"], { id: "uL", role: "Recepcionista", firstName: "Luiza", lastName: "Morais", cpf: "44489235844", employeeId: "e1" });
  const Hp = P.w.Holerite;
  P.store.payslips.push(Object.assign({ id: "s1" }, JSON.parse(JSON.stringify(r.slip))));
  P.store.payslips[0].id = "s1";
  const pane = P.w.document.getElementById("pane");
  let changed = 0;
  Hp.mountEmployeePanel(pane, P.store.employees[0], () => changed++);
  ok(/Para assinar \(1\)/.test(pane.textContent) && !!pane.querySelector("[data-hl-sign]") && /Setembro/i.test(pane.textContent), "painel da funcionária mostra o holerite para assinar");
  ok(/834,32/.test(pane.textContent.replace(/\s+/g, " ")) && changed >= 1, "painel mostra o líquido e avisa a aba (contador)");
  pane.querySelector("[data-hl-view]").click();
  ok(!!P.w.document.querySelector("#hl-sign-emp") && /Desc\. Vale Transporte/.test(P.w.document.body.textContent), "'Ver holerite' abre o documento com o botão Assinar");
  P.w.document.querySelector("#hl-sign-emp").click();
  const go = P.w.document.querySelector("#hl-sign-go"), chk = P.w.document.querySelector("#hl-agree");
  ok(!!go && go.disabled, "assinar exige marcar 'conferi e estou de acordo'");
  chk.checked = true; chk.dispatchEvent(new P.w.Event("change", { bubbles: true }));
  go.click(); await wait(30);
  ok(!!P.store.payslips[0].signatures.employee, "assinatura gravada pelo botão");
  ok(/Para assinar \(0\)/.test(pane.textContent) && /Já assinados \(1\)/.test(pane.textContent), "painel atualiza: sai de 'para assinar' e vai para 'já assinados'");
  // outra pessoa logada: vê mas não assina
  P.user = { id: "uV", role: "Profissional", firstName: "Vitória", lastName: "R", cpf: "52005514802", employeeId: "e2" };
  P.store.payslips.push(Object.assign({}, JSON.parse(JSON.stringify(r.slip)), { id: "s2", employeeId: "e1", monthKey: "2026-08", monthLabel: "Agosto de 2026", signatures: { manager: null, employee: null } }));
  Hp.refresh();
  ok(/só quem entrou com o próprio usuário/.test(pane.textContent) && !pane.querySelector("[data-hl-sign]"), "quem não é a dona vê o aviso e não tem botão de assinar");
  ok(/Para assinar \(1\)/.test(pane.textContent), "mês de agosto aparece para assinar");

  // ponto.js tem a aba (checagem estática do HTML gerado)
  const pontoSrc = fs.readFileSync(path.join(root, "assets", "js", "ponto.js"), "utf8");
  ok(/data-ptab="holerites"/.test(pontoSrc) && /ponto-pane-holerites/.test(pontoSrc) && /Holerite\.mountEmployeePanel/.test(pontoSrc), "ponto.js monta a aba Holerites ao lado de Folhas de Ponto");

  // ================= Folha de Pagamento (administração) =================
  const FPH = stripScripts("folha-pagamento.html");
  const month = new Date().toISOString().slice(0, 7);
  const prev = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const A = makeEnv(FPH, ["utils.js", "period-filter.js", "ponto-calc.js", "folha-calc.js", "folha-ponto.js", "holerite.js"], ADMIN);
  A.store.transactions.push({ id: "t1", type: "despesa", employeeId: "e1", description: "Vale adiantamento", amount: 750, date: prev + "-10", status: "pago", categoryId: "c1" });
  A.store.categories.push({ id: "c1", name: "Despesas" });
  A.w.eval(fs.readFileSync(path.join(root, "assets", "js", "folha-pagamento.js"), "utf8"));
  A.w.document.dispatchEvent(new A.w.Event("DOMContentLoaded"));
  await wait(60);
  const d = A.w.document;
  ok(!!d.getElementById("fp-hol") && /Holerites para Assinatura/.test(d.getElementById("fp-hol").textContent), "painel 'Holerites para Assinatura' aparece na Folha de Pagamento");
  // mês anterior
  const mi = d.getElementById("fp-month"); mi.value = prev; mi.dispatchEvent(new A.w.Event("change", { bubbles: true })); await wait(30);
  let rows = d.querySelectorAll("#tbl-folha tbody tr");
  const nz = x => x.replace(/\s+/g, " ");
  const money = A.w.Utils.fmtMoney;
  // regra dos 40%: o vale de 750 NÃO desconta por padrão (senão descontaria 2x)
  const luizaRow = nz(rows[0].textContent);
  ok(luizaRow.indexOf(nz(money(1800 - 137.68 - 720 - 108))) !== -1, "líquido da Luiza com adiantamento 40% e VT 6%, vale de 750 não desconta em dobro: " + luizaRow);
  d.querySelector('[data-fp-open="e1"]').click();
  const vale = d.querySelector(".fpd-vale");
  ok(!!vale && !vale.checked, "com a regra de 40%, o vale lançado vem desmarcado");
  ok(/pago a mais/.test(d.getElementById("fpd-lock").textContent) && nz(d.getElementById("fpd-lock").textContent).indexOf(nz(money(30))) !== -1, "mostra a diferença entre o vale pago (750) e o adiantamento (720): R$ 30 a mais");
  ok(d.getElementById("fpd-adv").value === "40" && d.getElementById("fpd-vt").value === "6" && d.getElementById("fpd-kids").value === "0", "campos de adiantamento, VT e filhos preenchidos");
  d.getElementById("fpd-kids").value = "1"; d.getElementById("fpd-kids").dispatchEvent(new A.w.Event("input", { bubbles: true }));
  ok(/Salário Família/.test(d.getElementById("fpd-slip").textContent), "informar 1 filho cria a linha de Salário Família");
  d.querySelector("#fpd-close, [data-close-modal]").click();

  // publicar pela administração
  d.querySelector("#hl-publish").click();
  ok(!!d.querySelector("#hl-pub-go") && /Luiza/.test(d.body.textContent), "modal de publicação lista as funcionárias");
  d.querySelector("#hl-pub-go").click(); await wait(60);
  ok(A.store.payslips.length === 2 && A.store.payslips.every(x => x.monthKey === prev && x.status === "publicada"), "publicou os dois holerites do mês (" + A.store.payslips.length + ")");
  const pubL = A.store.payslips.find(x => x.employeeId === "e1");
  ok(pubL && pubL.snapshot.totals.net === 834.32, "holerite publicado da Luiza = 834,32");
  rows = d.querySelectorAll("#tbl-folha tbody tr");
  ok(/Publicado/.test(rows[0].textContent), "tabela mostra 'Publicado'");
  // travado: abrir detalhes mostra o aviso e salvar é recusado
  d.querySelector('[data-fp-open="e1"]').click();
  ok(/já publicado/.test(d.getElementById("fpd-lock").textContent), "detalhes avisam que o holerite está publicado");
  const before = JSON.stringify(A.store.employees[0].payroll);
  d.getElementById("fpd-adv").value = "10"; d.getElementById("fpd-adv").dispatchEvent(new A.w.Event("input", { bubbles: true }));
  A.toasts.length = 0;
  d.getElementById("fpd-save").click();
  ok(JSON.stringify(A.store.employees[0].payroll) === before && A.toasts.some(t => /publicado/.test(t)), "salvar alteração com holerite publicado é recusado e o cadastro não muda");
  ok(/diferem do publicado/.test(d.getElementById("fpd-lock").textContent), "avisa quando os valores atuais divergem do publicado");
  ok(A.store.payslips.find(x => x.employeeId === "e1").snapshot.totals.net === 834.32, "o documento publicado não mudou");
  // PDF da administração usa o documento publicado
  A.pdf.length = 0;
  d.querySelector('[data-fp-pdf="e1"]').click();
  ok(/Assinatura pendente/.test(A.pdf.join("|")) && /834,32/.test(A.pdf.join("|")), "PDF da Folha de Pagamento mostra o documento publicado (com campo de assinatura)");
  // gerência assina pelo painel
  ok(!!d.querySelector("#fp-hol [data-hl-sign]"), "administrador vê o botão Assinar no painel");
  // mês corrente: não publica
  mi.value = month; mi.dispatchEvent(new A.w.Event("change", { bubbles: true })); await wait(30);
  d.querySelector("#hl-publish").click(); 
  ok(A.toasts.some(t => /não terminou/.test(t)), "mês corrente não é publicado");

  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
