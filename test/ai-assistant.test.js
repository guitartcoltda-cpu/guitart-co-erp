/* ============================================================
   Teste automatizado do motor do Assistente IA (assets/js/ai-assistant.js)

   Roda em Node (via jsdom, para dar um `window`/`document` reais aos
   scripts do sistema, que são todos <script> clássicos que penduram
   coisas em `window`). Carrega utils.js + ai-assistant.js de verdade
   (o arquivo publicado, não uma cópia), junto com um `DB` FALSO
   (memória, sem Supabase) preenchido com um cenário de dados conhecido
   — para poder conferir os números exatos que cada pergunta devolve.

   Uso: node test/ai-assistant.test.js
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

const dom = new JSDOM(
  '<!doctype html><html><body><div id="ai-assistant-mount"></div><div id="toast-stack"></div></body></html>',
  { url: "http://localhost/index.html", runScripts: "dangerously" }
);
const window = dom.window;
const document = window.document;
global.window = window;
global.document = document;

// ----------------------------------------------------------------
// DB falso: mesma superfície de assets/js/db.js que o motor usa
// (DB.all/DB.get), preenchido em memória com um cenário fixo.
// ----------------------------------------------------------------
function buildFakeDB(Utils) {
  const today = Utils.todayISO();
  const d1 = Utils.addDays(today, -1); // "poucos dias atrás", dentro do mês atual
  const d2 = Utils.addDays(today, -2);
  const lastMonthMid = (function () {
    const back = Utils.addMonths(today, -1);
    return back.slice(0, 8) + "15";
  })();
  // Último dia do mês anterior — sempre cai dentro de QUALQUER janela
  // "equivalentPreviousRange" (usada nas comparações "vs período
  // anterior" quando a pergunta não nomeia dois períodos), não importa o
  // dia do mês em que o teste rodar, porque essa janela sempre termina
  // exatamente no dia anterior ao início do mês atual.
  const lastMonthLastDay = Utils.addDays(today.slice(0, 8) + "01", -1);

  const employees = [
    { id: "emp1", name: "Ana", status: "ativo", commissionRate: 40 },
    { id: "emp2", name: "Bruno", status: "ativo", commissionRate: 40 },
    { id: "emp3", name: "Carla", status: "ativo", commissionRate: 40 }
  ];
  const services = [
    { id: "svc1", name: "Corte de Cabelo", group: "Cabelo" },
    { id: "svc2", name: "Manicure", group: "Unhas" },
    { id: "svc3", name: "Escova", group: "Cabelo" }
  ];
  const clients = [
    { id: "c1", name: "Maria", firstVisit: today },       // cliente novo este mês
    { id: "c2", name: "João", firstVisit: lastMonthMid },  // cliente antigo
    { id: "c3", name: "Paula", firstVisit: lastMonthMid }  // cliente antigo
  ];
  const appointments = [
    { id: "a1", date: today, time: "09:00", employeeId: "emp1", serviceId: "svc1", clientId: "c1", price: 100, status: "concluido" },
    { id: "a2", date: today, time: "10:00", employeeId: "emp2", serviceId: "svc2", clientId: "c2", price: 50, status: "concluido" },
    { id: "a3", date: d1, time: "09:00", employeeId: "emp1", serviceId: "svc1", clientId: "c2", price: 100, status: "concluido" },
    { id: "a4", date: d2, time: "14:00", employeeId: "emp3", serviceId: "svc3", clientId: "c3", price: 80, status: "concluido" },
    { id: "a5", date: lastMonthMid, time: "11:00", employeeId: "emp1", serviceId: "svc1", clientId: "c2", price: 90, status: "concluido" }
  ];
  const transactions = [
    { id: "t1", type: "receita", date: today, amount: 100, employeeId: "emp1", clientId: "c1", appointmentId: "a1", status: "pago" },
    { id: "t2", type: "receita", date: today, amount: 50, employeeId: "emp2", clientId: "c2", appointmentId: "a2", status: "pago" },
    { id: "t3", type: "receita", date: d1, amount: 100, employeeId: "emp1", clientId: "c2", appointmentId: "a3", status: "pago" },
    { id: "t4", type: "receita", date: d2, amount: 80, employeeId: "emp3", clientId: "c3", appointmentId: "a4", status: "pago" },
    { id: "t5", type: "receita", date: today, amount: 30, employeeId: null, clientId: "c1", appointmentId: null, status: "pendente" },
    { id: "t6", type: "receita", date: lastMonthMid, amount: 90, employeeId: "emp1", clientId: "c2", appointmentId: "a5", status: "pago" },
    { id: "t7", type: "receita", date: lastMonthLastDay, amount: 50, employeeId: "emp2", clientId: "c3", appointmentId: null, status: "pago" }
  ];

  const tables = { employees, services, clients, appointments, transactions };

  return {
    all: function (table) { return (tables[table] || []).slice(); },
    get: function (table, id) { return (tables[table] || []).find(function (r) { return r.id === id; }) || null; },
    ready: Promise.resolve(),
    _tables: tables,
    _dates: { today: today, d1: d1, d2: d2, lastMonthMid: lastMonthMid, lastMonthLastDay: lastMonthLastDay }
  };
}

// ----------------------------------------------------------------
// Carrega utils.js de verdade no contexto jsdom (window global real).
// ----------------------------------------------------------------
// window.eval() em jsdom NÃO liga identificadores soltos (bare) às
// propriedades que o próprio script pendura em `window` — só um
// <script> real, executado via runScripts:"dangerously", roda no
// contexto global "de verdade" onde `var x` no top-level e `window.x`
// são a mesma coisa (igual a um browser real). Por isso os arquivos são
// injetados como elementos <script>, não via eval.
function loadScriptInWindow(relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const el = document.createElement("script");
  el.textContent = code;
  document.body.appendChild(el);
}

loadScriptInWindow("assets/js/utils.js");
const Utils = window.Utils;

const DB = buildFakeDB(Utils);
window.DB = DB;

loadScriptInWindow("assets/js/ai-assistant.js");
const AIAssistant = window.AIAssistant;

// ----------------------------------------------------------------
// Mini test runner
// ----------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];

function check(label, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(label + (detail ? " — " + detail : "")); console.log("FAIL: " + label + (detail ? " — " + detail : "")); }
}

function ask(text, context) {
  return AIAssistant._internal.answerQuestion(text, context || {});
}

function closeTo(a, b, eps) {
  eps = eps == null ? 0.01 : eps;
  return Math.abs(a - b) <= eps;
}

function bigValueHasMoney(a, expected) {
  return typeof a.bigValue === "string" && a.bigValue.indexOf(Utils.fmtMoney(expected)) !== -1;
}

console.log("=== Assistente IA — cenário de teste ===");
console.log(DB._dates);
console.log("");

// ---- 1. Faturamento do período (mês atual, default) ----
(function () {
  const a = ask("Quanto faturamos este mês?");
  check("faturamento_periodo: intentId", a.intentId === "faturamento_periodo", a.intentId);
  check("faturamento_periodo: não vazio", !a.empty);
  check("faturamento_periodo: valor = 360", bigValueHasMoney(a, 360), a.bigValue);
})();

// ---- 2. Variante de frase equivalente ----
(function () {
  const a = ask("Qual foi o nosso faturamento nesse mês?");
  check("faturamento_periodo (variante): mesmo intent", a.intentId === "faturamento_periodo");
  check("faturamento_periodo (variante): valor = 360", bigValueHasMoney(a, 360), a.bigValue);
})();

// ---- 3. Mês passado (nome do período) ----
(function () {
  const a = ask("Qual foi o faturamento do mês passado?");
  check("faturamento mes passado: intent", a.intentId === "faturamento_periodo");
  check("faturamento mes passado: valor = 140", bigValueHasMoney(a, 140), a.bigValue);
})();

// ---- 4. Serviço que mais vendeu ----
(function () {
  const a = ask("Qual foi o serviço que mais vendeu este mês?");
  check("servico_mais_vendido: intent", a.intentId === "servico_mais_vendido", a.intentId);
  check("servico_mais_vendido: melhor = Corte de Cabelo", a.bigValue === "Corte de Cabelo", a.bigValue);
})();

// ---- 5. Serviços vendendo menos ----
(function () {
  const a = ask("Quais serviços estão vendendo menos?");
  check("servicos_menos_vendidos: intent", a.intentId === "servicos_menos_vendidos", a.intentId);
  check("servicos_menos_vendidos: tem lista", Array.isArray(a.list) && a.list.length === 3, JSON.stringify(a.list));
  check("servicos_menos_vendidos: listMoney=true", a.listMoney === true);
})();

// ---- 6. Profissional que mais faturou ----
(function () {
  const a = ask("Qual profissional faturou mais este mês?");
  check("profissional_mais_faturou: intent", a.intentId === "profissional_mais_faturou", a.intentId);
  check("profissional_mais_faturou: melhor = Ana", a.bigValue === "Ana", a.bigValue);
  check("profissional_mais_faturou: deltaText tem 200", /200/.test(a.deltaText || ""), a.deltaText);
})();

// ---- 7. Profissional que mais atendeu ----
(function () {
  const a = ask("Qual profissional realizou mais atendimentos?");
  check("profissional_mais_atendimentos: intent", a.intentId === "profissional_mais_atendimentos", a.intentId);
  check("profissional_mais_atendimentos: melhor = Ana", a.bigValue === "Ana", a.bigValue);
  check("profissional_mais_atendimentos: 2 atendimentos", /^2 /.test(a.deltaText || ""), a.deltaText);
})();

// ---- 8. Clientes novos ----
(function () {
  const a = ask("Quantos clientes novos tivemos este mês?");
  check("clientes_novos: intent", a.intentId === "clientes_novos", a.intentId);
  check("clientes_novos: 1", a.bigValue === "1", a.bigValue);
})();

// ---- 9. Clientes que retornaram ----
(function () {
  const a = ask("Quantos clientes retornaram?");
  check("clientes_retornaram: intent", a.intentId === "clientes_retornaram", a.intentId);
  check("clientes_retornaram: 2", a.bigValue === "2", a.bigValue);
})();

// ---- 10. Ticket médio ----
(function () {
  const a = ask("Qual foi o ticket médio deste mês?");
  check("ticket_medio: intent", a.intentId === "ticket_medio", a.intentId);
  check("ticket_medio: valor = 90", bigValueHasMoney(a, 90), a.bigValue);
})();

// ---- 11. Faturamento por profissional (todos) ----
(function () {
  const a = ask("Quanto cada profissional faturou?");
  check("faturamento_por_profissional: intent", a.intentId === "faturamento_por_profissional", a.intentId);
  check("faturamento_por_profissional: 3 profissionais", Array.isArray(a.list) && a.list.length === 3, JSON.stringify(a.list));
  check("faturamento_por_profissional: listMoney=true", a.listMoney === true);
  const ana = a.list.find(function (r) { return r.label === "Ana"; });
  check("faturamento_por_profissional: Ana=200", ana && closeTo(ana.value, 200), ana && ana.value);
})();

// ---- 12. Melhor dia de faturamento ----
(function () {
  const a = ask("Qual foi o nosso melhor dia de faturamento?");
  check("melhor_dia: intent", a.intentId === "melhor_dia", a.intentId);
  check("melhor_dia: é hoje", a.bigValue === Utils.fmtDate(DB._dates.today), a.bigValue + " vs " + Utils.fmtDate(DB._dates.today));
  check("melhor_dia: valor = 180", (a.deltaText || "").indexOf(Utils.fmtMoney(180)) !== -1, a.deltaText);
})();

// ---- 13. Faturamento com serviço específico (cabelo) ----
(function () {
  const a = ask("Quanto faturamos com cabelo?");
  check("servico_especifico(cabelo): intent", a.intentId === "servico_especifico", a.intentId);
  check("servico_especifico(cabelo): valor = 280", bigValueHasMoney(a, 280), a.bigValue);
})();

(function () {
  const a = ask("Quanto faturamos com manicure?");
  check("servico_especifico(manicure): intent", a.intentId === "servico_especifico", a.intentId);
  check("servico_especifico(manicure): valor = 50", bigValueHasMoney(a, 50), a.bigValue);
})();

// ---- 14. Cliente que mais gastou ----
(function () {
  const a = ask("Qual cliente mais gastou no salão?");
  check("cliente_mais_gastou: intent", a.intentId === "cliente_mais_gastou", a.intentId);
  check("cliente_mais_gastou: melhor = João", a.bigValue === "João", a.bigValue);
  check("cliente_mais_gastou: valor = 150", (a.deltaText || "").indexOf(Utils.fmtMoney(150)) !== -1, a.deltaText);
})();

// ---- 15. Atendimentos hoje ----
(function () {
  const a = ask("Quantos atendimentos tivemos hoje?");
  check("atendimentos_periodo(hoje): intent", a.intentId === "atendimentos_periodo", a.intentId);
  check("atendimentos_periodo(hoje): 2", a.bigValue === "2", a.bigValue);
})();

// ---- 16. Contas a receber ----
(function () {
  const a = ask("Quanto temos para receber?");
  check("contas_a_receber: intent", a.intentId === "contas_a_receber", a.intentId);
  check("contas_a_receber: valor = 30", bigValueHasMoney(a, 30), a.bigValue);
  check("contas_a_receber: nota presente (métrica nova)", !!a.note && a.note.indexOf("nova") !== -1);
})();

// ---- 17. Horários mais ocupados ----
(function () {
  const a = ask("Quais horários estão mais ocupados?");
  check("horarios_ocupados: intent", a.intentId === "horarios_ocupados", a.intentId);
  check("horarios_ocupados: melhor = 09h", a.bigValue === "09h", a.bigValue);
  check("horarios_ocupados: listMoney=false", a.listMoney === false);
})();

// ---- 18. Comparação explícita mês atual x mês passado ----
(function () {
  const a = ask("Compare o faturamento deste mês com o mês passado.");
  check("comparacao: intent", a.intentId === "comparacao", a.intentId);
  check("comparacao: atual 360", (a.bigValue || "").indexOf(Utils.fmtMoney(360)) !== -1, a.bigValue);
  check("comparacao: comparado 140 na linha", (a.lines || []).some(function (l) { return l.indexOf(Utils.fmtMoney(140)) !== -1; }), a.lines);
})();

// ---- 19. Crescimento percentual (mesmo intent de comparação; sem período
// explícito, cai no fallback "período atual x janela equivalente anterior") ----
(function () {
  const a = ask("Qual foi o crescimento percentual do faturamento?");
  check("crescimento_percentual: intent = comparacao", a.intentId === "comparacao", a.intentId);
  check("crescimento_percentual: tem % (nunca inventa, mas também não deixa de calcular quando há dado real)", /%/.test(a.deltaText || ""), a.deltaText);
})();

// ---- 20. Projeção de faturamento ----
(function () {
  const a = ask("Se continuar nesse ritmo, quanto devemos faturar até o final do mês?");
  check("projecao: intent", a.intentId === "projecao", a.intentId);
  check("projecao: nota de estimativa presente", !!a.note && /estimativa/i.test(a.note), a.note);
})();

// ---- 21. Pergunta complexa: maior faturamento por cliente ----
(function () {
  const a = ask("Qual profissional teve o maior faturamento por cliente neste mês?");
  check("faturamento_cliente_profissional: intent", a.intentId === "faturamento_cliente_profissional", a.intentId);
  // Ana: 200 receita / 2 clientes (c1,c2) = 100 por cliente
  // Bruno: 50 / 1 cliente = 50
  // Carla: 80 / 1 cliente = 80
  check("faturamento_cliente_profissional: melhor = Ana", a.bigValue === "Ana", a.bigValue);
  check("faturamento_cliente_profissional: 100 por cliente", (a.deltaText || "").indexOf(Utils.fmtMoney(100)) !== -1, a.deltaText);
})();

// ---- 22. Pergunta complexa: top-N serviços ----
(function () {
  const a = ask("Quais são os 5 serviços que mais geraram faturamento nos últimos 30 dias?");
  check("top5_servicos: intent", a.intentId === "servico_mais_vendido", a.intentId);
  check("top5_servicos: bigValue menciona 3 serviços (só há 3 cadastrados)", a.bigValue === "3 serviços", a.bigValue);
  check("top5_servicos: lista ordenada desc", a.list && a.list[0].value >= a.list[1].value && a.list[1].value >= a.list[2].value, JSON.stringify(a.list));
  check("top5_servicos: listMoney=true", a.listMoney === true);
})();

// ---- 23. Pergunta de seguimento (contexto automático) ----
(function () {
  const ctx = { lastIntentId: null, lastRange: null };
  const a1 = ask("Quanto faturamos esse mês?", ctx);
  ctx.lastIntentId = a1.intentId;
  ctx.lastRange = a1.range;
  const a2 = ask("E no mês passado?", ctx);
  check("seguimento: reaproveita intent faturamento_periodo", a2.intentId === "faturamento_periodo", a2.intentId);
  check("seguimento: valor do mês passado = 140", bigValueHasMoney(a2, 140), a2.bigValue);
})();

// ---- 24. Pergunta não reconhecida -> nunca inventa dado ----
(function () {
  const a = ask("Qual a cor favorita do dono do salão?");
  check("nao_reconhecida: empty=true", a.empty === true);
  check("nao_reconhecida: mensagem amigável (sem termos técnicos)", /não entendi/i.test(a.title || "") || /não entendi/i.test(a.note || ""), JSON.stringify(a));
})();

// ---- 25. Pergunta vazia ----
(function () {
  const a = ask("");
  check("pergunta_vazia: empty=true", a.empty === true);
})();

// ---- 26. Expressões de período isoladas (parsePeriod) ----
(function () {
  const parsePeriod = AIAssistant._internal.parsePeriod;
  const normalize = AIAssistant._internal.normalize;
  const cases = [
    ["hoje", DB._dates.today, DB._dates.today],
    ["ontem", Utils.addDays(DB._dates.today, -1), Utils.addDays(DB._dates.today, -1)]
  ];
  cases.forEach(function (c) {
    const r = parsePeriod(normalize(c[0]));
    check("parsePeriod(\"" + c[0] + "\") start", r && r.start === c[1], r);
    check("parsePeriod(\"" + c[0] + "\") end", r && r.end === c[2], r);
  });

  const r7 = parsePeriod(normalize("nos últimos 7 dias"));
  check("parsePeriod(últimos 7 dias): start correto", r7 && r7.start === Utils.addDays(DB._dates.today, -6), r7);
  check("parsePeriod(últimos 7 dias): end = hoje", r7 && r7.end === DB._dates.today, r7);

  const rEsteMes = parsePeriod(normalize("este mês"));
  check("parsePeriod(este mês): reconhecida", !!rEsteMes, rEsteMes);

  const rMesPassado = parsePeriod(normalize("mês passado"));
  check("parsePeriod(mês passado): reconhecida", !!rMesPassado, rMesPassado);

  const rSemNada = parsePeriod(normalize("qualquer coisa sem periodo"));
  check("parsePeriod(sem período): null", rSemNada === null, rSemNada);
})();

// ---- 27. "quantos atendimentos" com período explícito nos últimos 7 dias ----
(function () {
  const a = ask("Quantos atendimentos nos últimos 7 dias?");
  check("atendimentos ultimos 7 dias: intent", a.intentId === "atendimentos_periodo", a.intentId);
  // a1,a2 (hoje), a3 (d1), a4 (d2) todos dentro dos últimos 7 dias
  check("atendimentos ultimos 7 dias: 4", a.bigValue === "4", a.bigValue);
})();

// ---- 28. Garantia anti-invenção: handler nunca retorna valor não numérico como bigValue de dinheiro sem checar dado vazio ----
(function () {
  // Zera o DB (sem nenhum dado) e confere que as perguntas monetárias
  // respondem com "sem dados", nunca um valor chutado.
  const emptyDB = {
    all: function () { return []; },
    get: function () { return null; },
    ready: Promise.resolve()
  };
  window.DB = emptyDB;
  const a1 = ask("Qual profissional faturou mais este mês?");
  check("DB vazio: profissional_mais_faturou -> empty", a1.empty === true, JSON.stringify(a1));
  const a2 = ask("Qual cliente mais gastou no salão?");
  check("DB vazio: cliente_mais_gastou -> empty", a2.empty === true, JSON.stringify(a2));
  const a3 = ask("Qual foi o serviço que mais vendeu este mês?");
  check("DB vazio: servico_mais_vendido -> empty", a3.empty === true, JSON.stringify(a3));
  window.DB = DB; // restaura
})();

// ---- 29. Handler que lança erro é capturado com segurança ----
(function () {
  const brokenDB = {
    all: function () { throw new Error("falha simulada"); },
    get: function () { return null; },
    ready: Promise.resolve()
  };
  window.DB = brokenDB;
  const a = ask("Quanto faturamos este mês?");
  check("erro no handler: cai em empty sem exceção", a.empty === true, JSON.stringify(a));
  window.DB = DB; // restaura
})();

// ================================================================
// Parte 2: teste de UI (mount/DOM) — monta o componente de verdade
// num container jsdom, simula digitação/clique e confere o HTML
// renderizado. Cobre especificamente o bug já corrigido de listHtml()
// (contagem sendo exibida como dinheiro, ou vice-versa).
// ================================================================
console.log("\n=== Parte 2: UI (mount) ===");
(function () {
  const container = document.getElementById("ai-assistant-mount");
  const ctrl = AIAssistant.mount(container);
  check("mount: retorna controller com ask()", typeof ctrl.ask === "function");
  check("mount: renderiza a barra", !!container.querySelector("#ai-bar-input"));
  check("mount: mostra sugestões no estado ocioso", container.querySelectorAll("[data-ai-suggestion]").length > 0);

  const input = container.querySelector("#ai-bar-input");

  // Pergunta cuja resposta tem list de DINHEIRO (faturamento por profissional)
  input.value = "Quanto cada profissional faturou?";
  input.dispatchEvent(new window.Event("input")); // no-op para este handler, mas realista
  ctrl.ask();
  let card = container.querySelector(".ai-answer-card");
  check("UI money-list: card de resposta renderizado", !!card);
  let listValues = Array.prototype.map.call(container.querySelectorAll(".ai-answer-list-value"), function (el) { return el.textContent; });
  check("UI money-list: valores formatados em R$ (ex.: Ana = R$ 200,00)", listValues.some(function (v) { return v.indexOf("R$") !== -1 && v.indexOf("200") !== -1; }), listValues.join(" | "));
  check("UI money-list: nenhum valor aparece como número puro (bug antigo)", !listValues.some(function (v) { return /^\d+$/.test(v.trim()); }), listValues.join(" | "));

  // Pergunta cuja resposta tem list de CONTAGEM (profissional c/ mais atendimentos)
  input.value = "Qual profissional realizou mais atendimentos?";
  ctrl.ask();
  listValues = Array.prototype.map.call(container.querySelectorAll(".ai-answer-list-value"), function (el) { return el.textContent; });
  check("UI count-list: valores SEM 'R$' (são contagem de atendimentos, não dinheiro)", listValues.length > 0 && !listValues.some(function (v) { return v.indexOf("R$") !== -1; }), listValues.join(" | "));

  // Fecha a resposta (botão "nova pergunta") e confere que volta ao estado ocioso
  const closeBtn = container.querySelector("#ai-answer-close");
  check("UI: botão fechar presente", !!closeBtn);
  if (closeBtn) closeBtn.dispatchEvent(new window.Event("click"));
  check("UI: volta a mostrar sugestões após fechar", container.querySelectorAll("[data-ai-suggestion]").length > 0);

  // Histórico: perguntas feitas viram chips clicáveis
  const historyChips = container.querySelectorAll("[data-ai-history]");
  check("UI: histórico populado após perguntas", historyChips.length >= 2, historyChips.length);

  // Clique numa sugestão dispara a pergunta correspondente
  const suggestionBtn = container.querySelector("[data-ai-suggestion]");
  const suggestionText = suggestionBtn.getAttribute("data-ai-suggestion");
  suggestionBtn.dispatchEvent(new window.Event("click"));
  card = container.querySelector(".ai-answer-card, .ai-answer-empty");
  check("UI: clicar numa sugestão gera uma resposta (\"" + suggestionText + "\")", !!card);

  // Enter no input também dispara a pergunta (não só o botão enviar)
  input.value = "Quantos atendimentos tivemos hoje?";
  const enterEvent = new window.KeyboardEvent("keydown", { key: "Enter" });
  input.dispatchEvent(enterEvent);
  const valueEl = container.querySelector(".ai-answer-value");
  check("UI: Enter no input dispara a pergunta", !!valueEl && valueEl.textContent === "2", valueEl && valueEl.textContent);

  // Pergunta não reconhecida -> mensagem amigável, nunca um erro técnico
  input.value = "Qual a cor favorita do dono do salão?";
  ctrl.ask();
  const emptyNote = container.querySelector(".ai-answer-empty .ai-answer-note");
  check("UI: pergunta não reconhecida mostra nota amigável", !!emptyNote && /não entendi/i.test(emptyNote.textContent), emptyNote && emptyNote.textContent);
  check("UI: nenhum texto de erro técnico (stack/Error/undefined) vaza pro usuário", !/error|stack|undefined|nan/i.test((emptyNote && emptyNote.textContent) || ""), emptyNote && emptyNote.textContent);
})();

console.log("");
console.log("=== Resultado: " + pass + " passaram, " + fail + " falharam (" + (pass + fail) + " no total) ===");
if (fail) {
  console.log("\nFalhas:");
  failures.forEach(function (f) { console.log(" - " + f); });
  process.exit(1);
}
