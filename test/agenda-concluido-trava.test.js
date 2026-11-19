/* Teste — atendimento concluído fica travado: só usuário master altera, com pop-up quando já
   entrou em pagamento de comissão. Uso: node test/agenda-concluido-trava.test.js */
"use strict";
process.env.TZ = "America/Sao_Paulo";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
console.log("=== Atendimento concluído travado (Agenda + Aprovações) ===");

function pad(n) { return String(n).padStart(2, "0"); }
const now = new Date();
const TODAY = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
const MONTH = TODAY.slice(0, 7);

function baseStore() {
  return {
    employees: [
      { id: "e1", name: "Francisco Prof", role: "Cabeleireiro(a)", status: "ativo", performsServices: true, commissionRate: 40 },
      { id: "e2", name: "Ana Assistente", role: "Cabeleireiro(a)", status: "ativo", performsServices: true, commissionRate: 30 }
    ],
    clients: [{ id: "c1", name: "Cliente Um", phone: "(11) 90000-0000" }],
    services: [{ id: "s1", name: "Corte", group: "Cabelo", price: 100, durationMin: 60 }],
    categories: [{ id: "catCom", name: "Comissões" }, { id: "catServ", name: "Serviços" }],
    costCenters: [{ id: "ccr", key: "rh" }, { id: "cco", key: "operacional" }],
    appointments: [
      { id: "aC", clientId: "c1", serviceId: "s1", employeeId: "e1", assistantId: "e2", assistantCommissionPercent: 10, price: 100, date: TODAY, time: "10:00", status: "concluido", paymentMethod: "Pix" },
      { id: "aA", clientId: "c1", serviceId: "s1", employeeId: "e1", price: 100, date: TODAY, time: "15:00", status: "agendado" }
    ],
    transactions: [], approvals: [], occurrences: [], users: [], products: [], consumptions: []
  };
}

function boot(user, mutate) {
  const store = baseStore();
  if (mutate) mutate(store);
  const logs = [], updates = [], removes = [], merges = [];
  const html = fs.readFileSync(path.join(root, "agenda.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/agenda.html", pretendToBeVisual: true });
  const w = dom.window;
  let seq = 0;
  const T = t => store[t] || (store[t] = []);
  w.DB = {
    ready: Promise.resolve(), all: t => T(t).slice(), get: (t, id) => T(t).find(x => x.id === id) || null,
    find: (t, fn) => T(t).filter(fn), findOne: (t, fn) => T(t).find(fn) || null,
    insert: (t, rec) => { const r = Object.assign({ id: "n" + (++seq) }, rec); T(t).push(r); return r; },
    update: (t, id, p) => { updates.push([t, id, p]); return Object.assign(T(t).find(x => x.id === id) || {}, p); },
    remove: (t, id) => { removes.push([t, id]); store[t] = T(t).filter(x => x.id !== id); return true; },
    removeWhere: (t, fn) => { store[t] = T(t).filter(x => !fn(x)); },
    mergeRecordUpdate: (t, id, fn) => { const r = T(t).find(x => x.id === id); return Object.assign(r, fn(r)); },
    mergeFieldUpdate: (t, id, f, fn) => { merges.push([t, id, f]); const r = T(t).find(x => x.id === id); if (r) r[f] = fn(r[f]); }, batch: fn => fn(), fetchFresh: (t, id) => Promise.resolve(T(t).find(x => x.id === id) || null),
    hasRemote: () => true, uid: p => p + (++seq), nowISO: () => new Date().toISOString(),
    getSettings: () => ({}), getRoles: () => [], getPaymentMethods: () => [{ name: "Pix" }, { name: "Dinheiro" }],
    getTreatmentPackages: () => [], getAttachmentFull: () => Promise.resolve(null),
    log: (a, b) => logs.push(a + ": " + b)
  };
  w.CurrentUser = { get: () => user };
  w.Layout = { init() {}, render() {} };
  const errors = [];
  w.addEventListener("error", e => errors.push(e.message));
  ["utils.js", "name-combo.js", "approvals.js", "consumo.js"].forEach(f => w.eval(fs.readFileSync(path.join(root, "assets", "js", f), "utf8")));
  const toasts = [];
  w.Toast.show = (m, k) => toasts.push((k || "") + ":" + m);
  try { w.eval(fs.readFileSync(path.join(root, "assets", "js", "agenda.js"), "utf8")); } catch (e) { errors.push("load: " + e.message); }
  return { w, d: w.document, store, logs, updates, removes, merges, toasts, errors };
}
function geral(d) { d.querySelector('[data-view="geral"]').click(); }
function openAppt(d, id) { d.querySelector('[data-edit="' + id + '"]').click(); }
function closeModal(d) { const b = d.querySelector("#active-modal-overlay [data-close-modal]"); if (b) b.click(); }

const RECEP = { id: "u2", role: "Recepcionista", firstName: "Rita", lastName: "Recepção" };
const ADMIN = { id: "u1", role: "Administrador", firstName: "João", lastName: "Master" };
const DEV = { id: "u3", role: "Desenvolvedor", firstName: "Dev", lastName: "JK" };
const paidWeek = s => s.transactions.push({ id: "pay1", type: "despesa", categoryId: "catCom", employeeId: "e1", amount: 350, date: TODAY,
  relatedMonth: MONTH, relatedRangeStart: TODAY, relatedRangeEnd: TODAY });

(async function () {
  // ---------- 1. Não-master: concluído só visualiza ----------
  {
    const t = boot(RECEP);
    await wait(80);
    ok(t.errors.length === 0, "1a: carrega sem erro (" + t.errors.join(" | ") + ")");
    ok(!t.d.getElementById("btn-toggle-rail") && !t.d.querySelector(".ag-layout").classList.contains("ag-rail-hidden"), "1a2: sem botão de recolher; calendário visível na Visão do Dia");
    geral(t.d);
    ok(!!t.d.querySelector('[data-edit="aC"] .fa-lock'), "1b: lista mostra cadeado no concluído");
    ok(!t.d.querySelector('[data-del="aC"]'), "1c: lista não mostra lixeira no concluído");
    ok(!!t.d.querySelector('[data-del="aA"]') && !!t.d.querySelector('[data-edit="aA"] .fa-pen'), "1d: agendado continua com lápis e lixeira");
    openAppt(t.d, "aC");
    const box = t.d.querySelector("#active-modal-overlay");
    ok(/somente leitura/.test(box.querySelector(".modal-head").textContent), "1e: título 'somente leitura'");
    ok(/bloqueado para alterações/.test(box.querySelector("#am-concluded-lock").textContent), "1f: aviso de bloqueio");
    ok(!box.querySelector("#am-save") && !box.querySelector("#am-delete") && !box.querySelector("#am-add-insumo"), "1g: sem Salvar/Excluir/Lançar Insumo");
    ok(box.querySelector("#am-date").disabled && box.querySelector("#am-status").disabled && box.querySelector("#am-price").disabled && box.querySelector("#am-client-text").disabled, "1h: campos desabilitados");
    ok(box.querySelector("#am-employee-text").value === "Francisco Prof", "1i: dados continuam visíveis (profissional preenchido)");
    ok(box.querySelector("#am-add-service").style.display === "none", "1j: sem 'Adicionar outro serviço'");
    ok(!!box.querySelector(".modal-foot [data-close-modal]"), "1k: botão Fechar continua");
    closeModal(t.d);
    // agendado continua editável normalmente
    openAppt(t.d, "aA");
    const box2 = t.d.querySelector("#active-modal-overlay");
    ok(!!box2.querySelector("#am-save") && !box2.querySelector("#am-concluded-lock") && !box2.querySelector("#am-date").disabled, "1l: agendado abre editável");
    closeModal(t.d);
    ok(t.updates.filter(u => u[0] === "appointments").length === 0 && t.removes.length === 0, "1m: nada foi alterado");
  }

  // ---------- 2. Master sem pagamento de comissão: altera sem pop-up ----------
  {
    const t = boot(ADMIN);
    await wait(80);
    geral(t.d);
    ok(!!t.d.querySelector('[data-del="aC"]') && !!t.d.querySelector('[data-edit="aC"] .fa-pen'), "2a: master vê lápis e lixeira no concluído");
    openAppt(t.d, "aC");
    const box = t.d.querySelector("#active-modal-overlay");
    ok(!!box.querySelector("#am-save") && !box.querySelector("#am-date").disabled, "2b: master edita");
    ok(/usuário master/.test(box.querySelector("#am-concluded-lock").textContent) && !/fechada e paga/.test(box.querySelector("#am-concluded-lock").textContent), "2c: aviso de master, sem menção a comissão paga");
    box.querySelector("#am-time").value = "10:30";
    box.querySelector("#am-save").click();
    await wait(30);
    ok(!t.d.querySelector("#stacked-confirm-overlay"), "2d: sem pop-up (não há pagamento de comissão)");
    const up = t.updates.find(u => u[0] === "appointments" && u[1] === "aC");
    ok(up && up[2].time === "10:30", "2e: alteração gravada");
    ok(t.logs.some(l => /Atualizou o agendamento.*\[atendimento já concluído\]/.test(l)), "2f: log marca alteração em atendimento concluído");
  }

  // ---------- 3. Master com pagamento de comissão: pop-up antes de gravar ----------
  {
    const t = boot(ADMIN, paidWeek);
    await wait(80);
    geral(t.d);
    openAppt(t.d, "aC");
    const box = t.d.querySelector("#active-modal-overlay");
    ok(/fechada e paga \(Francisco Prof — R\$/.test(box.querySelector("#am-concluded-lock").textContent), "3a: aviso cita o pagamento de comissão");
    box.querySelector("#am-price").value = "R$ 80,00";
    box.querySelector("#am-save").click();
    await wait(30);
    const ov = t.d.querySelector("#stacked-confirm-overlay");
    ok(!!ov && /Deseja continuar com a alteração\?/.test(ov.textContent), "3b: pop-up 'Deseja continuar com a alteração?'");
    ok(ov && /Francisco Prof — R\$\s?350,00/.test(ov.textContent), "3c: pop-up mostra o pagamento");
    ok(!t.updates.some(u => u[1] === "aC"), "3d: nada gravado antes de confirmar");
    ov.querySelector("[data-stacked-cancel]").click();
    await wait(20);
    ok(!t.d.querySelector("#stacked-confirm-overlay") && !!t.d.querySelector("#active-modal-overlay #am-save"), "3e: Cancelar fecha só o pop-up — formulário continua aberto");
    ok(!t.updates.some(u => u[1] === "aC"), "3f: cancelado não grava");
    // Esc no pop-up também não fecha o formulário
    box.querySelector("#am-save").click(); await wait(20);
    t.w.dispatchEvent(new t.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    t.d.dispatchEvent(new t.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(10);
    ok(!t.d.querySelector("#stacked-confirm-overlay"), "3g: Esc fecha o pop-up");
    box.querySelector("#am-save").click(); await wait(20);
    t.d.querySelector("#stacked-confirm-overlay [data-stacked-ok]").click();
    await wait(30);
    const up = t.updates.find(u => u[0] === "appointments" && u[1] === "aC");
    ok(up && up[2].price === 80, "3h: confirmado grava a alteração");
    ok(t.logs.some(l => /\[atendimento já concluído; já incluído em pagamento de comissão — alteração confirmada\]/.test(l)), "3i: log registra que havia comissão paga");
  }

  // ---------- 4. Master: excluir e lançar insumo com comissão paga pedem confirmação ----------
  {
    const t = boot(DEV, paidWeek);
    await wait(80);
    geral(t.d);
    t.d.querySelector('[data-del="aC"]').click();
    const conf = t.d.querySelector("#active-modal-overlay");
    ok(/ATENÇÃO: a comissão deste atendimento já foi fechada e paga/.test(conf.textContent) && /Deseja continuar mesmo assim\?/.test(conf.textContent), "4a: excluir pela lista avisa da comissão paga (Desenvolvedor = master)");
    closeModal(t.d);
    ok(!t.removes.length, "4b: cancelado não exclui");
    openAppt(t.d, "aC");
    t.d.querySelector("#am-add-insumo").click();
    await wait(10);
    ok(!!t.d.querySelector("#stacked-confirm-overlay") && /Lançar insumo\/produto/.test(t.d.querySelector("#stacked-confirm-overlay").textContent), "4c: lançar insumo também pergunta");
    t.d.querySelector("#stacked-confirm-overlay [data-stacked-cancel]").click();
    t.d.querySelector("#am-delete").click();
    ok(/ATENÇÃO/.test(t.d.querySelector("#active-modal-overlay").textContent), "4d: excluir pelo formulário avisa da comissão paga");
    t.d.querySelector("#modal-confirm-btn").click();
    ok(t.removes.some(r => r[1] === "aC") && t.logs.some(l => /Excluiu.*alteração confirmada/.test(l)), "4e: confirmado exclui e registra no log");
  }

  // ---------- 5. Comissão paga: critérios (período, mês antigo, assistente, outro período) ----------
  {
    const t = boot(ADMIN);
    const U = t.w.Utils, a = t.store.appointments[0];
    t.store.transactions.push({ id: "p_old", type: "despesa", categoryId: "catCom", employeeId: "e2", amount: 20, date: TODAY, relatedMonth: MONTH });
    ok(U.apptCommissionPayments(a).map(x => x.id).join() === "p_old", "5a: pagamento antigo (só mês) do ASSISTENTE conta");
    t.store.transactions.push({ id: "p_other", type: "despesa", categoryId: "catCom", employeeId: "e1", amount: 99, date: TODAY, relatedMonth: MONTH, relatedRangeStart: "2000-01-01", relatedRangeEnd: "2000-01-07" });
    t.store.transactions.push({ id: "p_cat", type: "despesa", categoryId: "catServ", employeeId: "e1", amount: 99, date: TODAY, relatedMonth: MONTH });
    ok(U.apptCommissionPayments(a).length === 1, "5b: pagamento de outro período ou outra categoria não conta");
    // 19/11/2026: a ligação agora é item a item (livro-razão) — um pagamento de
    // outro período não "pega" o atendimento só por mudar a data dele.
    ok(U.apptCommissionPayments([a, Object.assign({}, a, { date: "2000-01-03" })]).length === 1, "5c: ligação é pelo item quitado, não pela data");
    t.w.CurrentUser = { get: () => RECEP };
    ok(U.apptConcludedLocked(a) && !U.apptConcludedLocked(t.store.appointments[1]), "5d: trava só o concluído");
    t.w.CurrentUser = { get: () => ({ role: "Gerente" }) };
    ok(U.apptConcludedLocked(a), "5e: Gerente não é master");
  }

  // ---------- 6. Aprovações: alteração em atendimento concluído só com master ----------
  {
    const t = boot(Object.assign({ canApprove: true }, RECEP), s => {
      s.users.push({ id: "u2", canApprove: true });
      s.approvals.push({ id: "ap1", type: "comissao_agendamento", status: "pendente", summary: "x", payload: { appointmentId: "aC", field: "commissionPercent", requestedValue: 50 } });
      s.approvals.push({ id: "ap2", type: "comissao_agendamento", status: "pendente", summary: "y", payload: { appointmentId: "aA", field: "commissionPercent", requestedValue: 50 } });
    });
    let applied = 0;
    const r1 = await t.w.Approvals.approve("ap1", () => applied++);
    ok(!r1.ok && r1.reason === "concluded_locked" && applied === 0, "6a: 'Pode aprovar' sem ser master não aprova alteração de atendimento concluído");
    ok(t.toasts.some(m => /somente usuário master/.test(m)), "6b: aviso explicando");
    const r2 = await t.w.Approvals.approve("ap2", () => applied++);
    ok(r2.ok && applied === 1, "6c: atendimento ainda agendado continua aprovável por quem tem permissão");
    t.w.CurrentUser = { get: () => ADMIN };
    const r3 = await t.w.Approvals.approve("ap1", () => applied++);
    ok(r3.ok && applied === 2, "6d: master aprova");
  }

  // ---------- 7. Varredura 19/11: status travado, cliente/serviço obrigatórios, pacote ----------
  {
    const t = boot(ADMIN, s => {
      s.clients[0].packages = [{ id: "pk1", packageName: "Hidratação", sessionsTotal: 4, appointmentIds: ["aP"] }];
      s.appointments.push({ id: "aP", clientId: "c1", serviceId: "s1", employeeId: "e1", price: 50, date: TODAY, time: "17:00", status: "agendado", packagePurchaseId: "pk1", packageSessionIndex: 2 });
    });
    await wait(80);
    geral(t.d);
    openAppt(t.d, "aC");
    ok(t.d.querySelector("#am-status").disabled, "7a: status de atendimento concluído travado até para o master");
    closeModal(t.d);
    t.d.querySelector("#btn-new-appt").click();
    const nb = t.d.querySelector("#active-modal-overlay");
    nb.querySelector("#am-client").value = "";
    nb.querySelector("#am-save").click();
    await wait(20);
    ok(t.toasts.some(m => /Selecione o cliente/.test(m)) && t.store.appointments.length === 3, "7b: não salva agendamento sem cliente");
    closeModal(t.d);
    t.d.querySelector('[data-del="aP"]').click();
    t.d.querySelector("#modal-confirm-btn").click();
    ok(t.removes.some(r => r[1] === "aP") && t.store.clients[0].packages[0].appointmentIds.length === 0, "7c: excluir pela lista libera a sessão do pacote");
  }

  // ---------- 8. 19/11 (decisões do João): excluir concluído apaga tudo junto ----------
  {
    const t = boot(ADMIN, s => {
      s.products = [{ id: "pr1", name: "Shampoo", currentStock: 5, type: "revenda" }, { id: "pr2", name: "Tinta", currentStock: 2, packageSize: 0, type: "uso_interno" }];
      s.transactions.push(
        { id: "rev", type: "receita", amount: 100, appointmentId: "aC", date: TODAY, reconciled: true, bankLineId: "bl1" },
        { id: "tip", type: "receita", amount: 15, appointmentId: "aC", isTip: true, employeeId: "e1", date: TODAY },
        { id: "prod", type: "receita", amount: 40, appointmentId: "aC", productId: "pr1", saleQty: 2, date: TODAY },
        { id: "outro", type: "receita", amount: 99, appointmentId: "aA", date: TODAY }
      );
      s.bankLines = [{ id: "bl1", matched: true, matchedTransactionId: "rev" }];
      s.productConsumptions = [{ id: "cons1", appointmentId: "aC", employeeId: "e1", productId: "pr2", quantity: 1, unit: "un", employeeShare: 5, date: TODAY }];
      s.stockMovements = [{ id: "sm1", relatedConsumptionId: "cons1" }];
      s.clients[0].creditBalance = 10;
      s.clients[0].creditHistory = [{ date: TODAY, delta: 10, note: "Pagamento a maior", appointmentId: "aC" }];
    });
    await wait(80);
    geral(t.d);
    t.d.querySelector('[data-del="aC"]').click();
    const msg = t.d.querySelector("#active-modal-overlay").textContent;
    ok(/Será apagado junto: 3 lançamento/.test(msg) && /consumo/.test(msg) && /crédito/.test(msg), "8a: confirmação lista o que sai junto", msg.slice(0, 300));
    t.d.querySelector("#modal-confirm-btn").click();
    const ids = t.store.transactions.map(x => x.id);
    ok(!ids.includes("rev") && !ids.includes("tip") && !ids.includes("prod") && ids.includes("outro"), "8b: receita, gorjeta e venda de produto apagadas; lançamento de outro atendimento intacto", ids);
    ok(t.store.bankLines[0].matched === false && t.store.bankLines[0].matchedTransactionId === null, "8c: linha do extrato conciliada volta a pendente");
    ok(t.store.products.find(p => p.id === "pr1").currentStock === 7, "8d: estoque do produto vendido devolvido (+2)", t.store.products.find(p => p.id === "pr1").currentStock);
    ok(t.store.productConsumptions.length === 0 && t.store.products.find(p => p.id === "pr2").currentStock === 3, "8e: consumo apagado e estoque do insumo devolvido");
    ok(t.store.clients[0].creditBalance === 0 && t.store.clients[0].creditHistory.length === 2, "8f: crédito do cliente estornado (com registro)", t.store.clients[0]);
    ok(!t.store.appointments.some(a => a.id === "aC"), "8g: atendimento excluído");
  }

  // ---------- 9. Venda de pacote: sai junto; bloqueia se já há outras sessões ----------
  {
    const t = boot(ADMIN, s => {
      s.clients[0].packages = [{ id: "pkA", packageName: "Hidratação", sessionsTotal: 4, appointmentIds: ["v1", "v2"] }, { id: "pkB", packageName: "Botox", sessionsTotal: 4, appointmentIds: ["w1"] }];
      s.appointments.push(
        { id: "v1", clientId: "c1", serviceId: "s1", employeeId: "e1", price: 50, date: TODAY, time: "16:00", status: "agendado", packagePurchaseId: "pkA", packageSessionIndex: 1 },
        { id: "v2", clientId: "c1", serviceId: "s1", employeeId: "e1", price: 50, date: TODAY, time: "17:00", status: "agendado", packagePurchaseId: "pkA", packageSessionIndex: 2 },
        { id: "w1", clientId: "c1", serviceId: "s1", employeeId: "e1", price: 50, date: TODAY, time: "18:00", status: "agendado", packagePurchaseId: "pkB", packageSessionIndex: 1 }
      );
    });
    await wait(80);
    geral(t.d);
    t.d.querySelector('[data-del="v1"]').click();
    ok(!t.d.querySelector("#modal-confirm-btn") && t.toasts.some(m => /Exclua primeiro as outras sessões/.test(m)), "9a: venda de pacote com outra sessão agendada é bloqueada");
    t.d.querySelector('[data-del="w1"]').click();
    t.d.querySelector("#modal-confirm-btn").click();
    ok(!t.store.clients[0].packages.some(p => p.id === "pkB") && t.store.clients[0].packages.some(p => p.id === "pkA"), "9b: excluir a venda do pacote remove o pacote (o outro fica)");
  }

  // ---------- 10. Cortesia R$ 0,00 e taxa congelada na conclusão ----------
  {
    const t = boot(ADMIN, s => { s.categories.push({ id: "catServ2", name: "x" }); s.services[0].categoryId = "catServ"; });
    await wait(80);
    geral(t.d);
    t.d.querySelector('[data-conclude="aA"]').click();
    await wait(20);
    const box = t.d.querySelector("#active-modal-overlay");
    ok(!!box && !!box.querySelector("#cc-amount"), "10a: modal de conclusão abriu");
    box.querySelector("#cc-amount").value = "0,00";
    box.querySelector("#cc-save").click();
    await wait(60);
    const a = t.store.appointments.find(x => x.id === "aA");
    ok(a.status === "concluido" && a.price === 0, "10b: cortesia concluída com valor 0", a);
    ok(!t.store.transactions.some(x => x.appointmentId === "aA" && x.type === "receita"), "10c: cortesia não gera receita de R$ 0,00");
    ok(a.commissionPercent === 40 && a.parceriaAtClose === false, "10d: taxa (40%) e 'não é Parceria' gravadas na conclusão", a);
    const split = t.w.Utils.apptCommissionSplit(a, { commissionRate: 99 });
    ok(split.mainCommission === 0, "10e: cortesia não gera comissão, mesmo se a taxa do funcionário mudar depois");
  }

  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})();
