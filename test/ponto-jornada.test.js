/* ============================================================
   Teste automatizado — Jornada de trabalho por dia da semana no
   espelho de ponto (assets/js/ponto-calc.js).

   Pedido do usuário (08/10/2026), verbatim (resumido): ajustar o ponto da
   Luiza (entrada 09:40, almoço 12:00–13:00, saída 19:00) e da Vitória
   (09:30, 13:00–14:00, 19:00) com base no horário; almoço flexível (1h no
   horário que quiser), horário de entrada e saída vai para o banco de
   horas; elas não trabalham domingo nem segunda e o ponto precisa conter
   todos os dias do mês justificados — dias em que o salão não funciona
   destacados e NÃO descontados.

   Uso: node test/ponto-jornada.test.js
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "assets", "js", "ponto-calc.js"), "utf8"), sandbox);
const PC = sandbox.window.PontoCalc;

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.log("  FALHOU: " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const DAYS_TUE_SAT = { 0: null, 1: null };
[2, 3, 4, 5, 6].forEach(function (d) { DAYS_TUE_SAT[d] = { start: "09:40", end: "19:00" }; });
const LUIZA = { id: "emp_luiza", name: "Luiza", workSchedule: { days: DAYS_TUE_SAT, lunchMin: 60, lunchFrom: "12:00", lunchTo: "13:00" } };
const VDAYS = {}; [0, 1].forEach(function (d) { VDAYS[d] = null; }); [2, 3, 4, 5, 6].forEach(function (d) { VDAYS[d] = { start: "09:30", end: "19:00" }; });
const VITORIA = { id: "emp_vitoria", name: "Vitória", workSchedule: { days: VDAYS, lunchMin: 60, lunchFrom: "13:00", lunchTo: "14:00" } };
const LEGADO = { id: "emp_old", name: "Antiga", dailyWorkHours: 8 };

// Datas de outubro/2026: 04=dom, 05=seg, 06=ter, 07=qua, 08=qui, 09/29 e 30 = ter/qua, 10/01=qui, 02=sex, 03=sáb
function ts(dateIso, hhmm) {
  const [y, m, d] = dateIso.split("-").map(Number); const [h, mi] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi, 0).toISOString();
}
let seq = 0;
function punch(emp, date, type, hhmm) { return { id: "t" + (++seq), employeeId: emp.id, date: date, type: type, timestamp: ts(date, hhmm) }; }
function fullDay(emp, date, inn, lunchOut, lunchIn, out) {
  const list = [punch(emp, date, "entrada", inn)];
  if (lunchOut) list.push(punch(emp, date, "saida_almoco", lunchOut), punch(emp, date, "volta_almoco", lunchIn));
  list.push(punch(emp, date, "saida", out));
  return list;
}

console.log("=== Jornada por dia da semana — espelho de ponto ===");

// ---- parse/format ----
eq(PC.parseHM("09:40"), 580, "parseHM 09:40");
eq(PC.parseHM("9:40"), 580, "parseHM 9:40");
eq(PC.parseHM("0940"), 580, "parseHM 0940");
eq(PC.parseHM("24:00"), null, "parseHM rejeita 24:00");
eq(PC.parseHM("12:60"), null, "parseHM rejeita minuto 60");
eq(PC.parseHM("abc"), null, "parseHM rejeita texto");
eq(PC.fmtClock(580), "09:40", "fmtClock 580");

// ---- jornada prevista por dia ----
eq(PC.scheduleFor(LUIZA, "2026-10-06").expectedMin, 500, "Luiza terça: 09:40–19:00 − 1h = 8h20");
eq(PC.scheduleFor(VITORIA, "2026-10-06").expectedMin, 510, "Vitória terça: 09:30–19:00 − 1h = 8h30");
eq(PC.scheduleFor(LUIZA, "2026-10-04").working, false, "domingo é folga");
eq(PC.scheduleFor(LUIZA, "2026-10-05").working, false, "segunda é folga");
eq(PC.isWorkingDay(LUIZA, "2026-10-03"), true, "sábado é dia de trabalho");
eq(PC.isWorkingDay(LEGADO, "2026-10-04"), true, "sem horário fixo: todo dia conta como trabalho");
eq(PC.scheduleFor(LEGADO, "2026-10-06"), null, "sem horário fixo: scheduleFor devolve null");
eq(PC.dailyExpectedMin(LEGADO), 480, "legado: 8h");
eq(PC.dailyExpectedMin(LUIZA, "2026-10-05"), 0, "Luiza segunda: previsto 0");
eq(PC.scheduleFor({ workSchedule: { days: { 2: { start: "10:00", end: "09:00" } }, lunchMin: 60 } }, "2026-10-06"), null, "horário invertido (dado inválido) cai na carga única");
eq(PC.scheduleSummary(LUIZA), "Ter–Sáb · 09:40–19:00 · almoço 1h00 (12:00–13:00) · 8h20/dia", "resumo da jornada da Luiza");

// ---- cálculo do dia ----
(function () {
  let d = PC.computeDay("2026-10-06", fullDay(LUIZA, "2026-10-06", "09:40", "12:30", "13:30", "19:00"), LUIZA);
  eq(d.workedMin, 500, "dia perfeito: trabalhado 8h20"); eq(d.saldoMin, 0, "dia perfeito: saldo 0"); eq(d.status, "completo", "dia perfeito: completo");

  d = PC.computeDay("2026-10-06", fullDay(LUIZA, "2026-10-06", "09:50", "12:00", "13:00", "19:00"), LUIZA);
  eq(d.saldoMin, -10, "entrou 10 min depois do previsto: saldo −10 (banco, sem tolerância)");

  d = PC.computeDay("2026-10-06", fullDay(LUIZA, "2026-10-06", "09:30", "12:00", "13:00", "19:20"), LUIZA);
  eq(d.saldoMin, 30, "entrou 10 min antes e saiu 20 min depois: saldo +30");

  d = PC.computeDay("2026-10-06", fullDay(LUIZA, "2026-10-06", "09:40", "13:30", "14:20", "19:00"), LUIZA);
  eq(d.saldoMin, 10, "almoço flexível: 50 min tirados em outro horário somam +10");
  eq(d.lunchMinActual, 50, "duração real do almoço registrada");

  d = PC.computeDay("2026-10-06", fullDay(LUIZA, "2026-10-06", "09:40", "12:00", "13:15", "19:00"), LUIZA);
  eq(d.saldoMin, -15, "almoço de 75 min desconta 15");

  d = PC.computeDay("2026-10-06", fullDay(LUIZA, "2026-10-06", "09:40", null, null, "19:00"), LUIZA);
  eq(d.workedMin, 500, "sem batidas de almoço: desconta o intervalo previsto"); eq(d.lunchAssumed, true, "sem batidas de almoço: sinaliza intervalo presumido");

  d = PC.computeDay("2026-10-05", fullDay(LUIZA, "2026-10-05", "10:00", null, null, "14:00"), LUIZA);
  eq(d.expectedMin, 0, "trabalhou na segunda (folga): previsto 0"); eq(d.saldoMin, 240, "trabalhou na segunda: 4h inteiras no banco"); eq(d.lunchAssumed, false, "folga trabalhada não desconta almoço presumido");

  d = PC.computeDay("2026-10-06", fullDay(LEGADO, "2026-10-06", "09:00", null, null, "18:00"), LEGADO);
  eq(d.workedMin, 540, "legado sem almoço batido: continua sem desconto"); eq(d.saldoMin, 60, "legado: 9h − 8h = +1h");
})();

// ---- espelho com todos os dias ----
(function () {
  const entries = []
    .concat(fullDay(LUIZA, "2026-09-29", "09:40", "12:00", "13:00", "19:00"))   // ter
    .concat(fullDay(LUIZA, "2026-09-30", "09:40", "12:00", "13:00", "19:10"))   // qua (+10)
    .concat(fullDay(LUIZA, "2026-10-01", "09:50", "12:00", "13:00", "19:00"))   // qui (−10)
    .concat(fullDay(LUIZA, "2026-10-02", "09:40", "12:00", "13:00", "19:00"))   // sex
    .concat(fullDay(LUIZA, "2026-10-03", "09:40", "12:00", "13:00", "19:00"))   // sáb
    // dom 10/04 e seg 10/05: nada. ter 10/06 e qua 10/07: nada (sem justificativa). qui 10/08 = hoje, nada ainda.
    .concat([{ id: "occ1", employeeId: LUIZA.id, date: "2026-10-07", type: "folga_abono", timestamp: ts("2026-10-07", "08:00") }]);
  const r = PC.espelho(LUIZA.id, "2026-10-01", "2026-10-31", LUIZA, entries, { today: "2026-10-08" });
  const byDate = {}; r.days.forEach(function (d) { byDate[d.date] = d; });
  eq(r.days.length, 8, "1º a 8/10 = 8 linhas (do período até hoje, sem dias futuros)");
  eq(r.days[0].date, "2026-10-08", "mais recente primeiro");
  eq(byDate["2026-10-04"].status, "folga_semanal", "domingo: folga semanal");
  eq(byDate["2026-10-05"].status, "folga_semanal", "segunda: folga semanal");
  eq(byDate["2026-10-04"].statusLabel, "Salão fechado — folga semanal", "rótulo da folga");
  eq(byDate["2026-10-06"].status, "sem_registro", "terça passada sem nada: sem registro");
  eq(byDate["2026-10-06"].saldoMin, 0, "sem registro não desconta do banco");
  eq(byDate["2026-10-07"].status, "folga_abono", "quarta com Folga/Abono lançada: justificada");
  eq(byDate["2026-10-08"].status, "aguardando", "hoje sem batida ainda: aguardando");
  eq(byDate["2026-10-01"].saldoMin, -10, "10/01: −10");
  eq(r.totals.saldoMin, -10, "saldo do período = só os dias com batida completa (10/01: −10; 10/02 e 10/03: 0)");
  eq(r.totals.folgaDays, 2, "2 dias de folga semanal no período");
  eq(r.totals.pendingDays, 1, "1 dia pendente de justificativa (terça 10/06)");

  // período que começa antes do primeiro registro não inventa linhas "sem registro" de antes dele
  const early = PC.espelho(LUIZA.id, "2026-09-01", "2026-09-30", LUIZA, entries, { today: "2026-10-08" });
  eq(early.days.length, 2, "setembro: só 29 e 30 (nada antes do 1º registro)");

  // fillDays desligado volta ao comportamento antigo
  const off = PC.espelho(LUIZA.id, "2026-10-01", "2026-10-31", LUIZA, entries, { today: "2026-10-08", fillDays: false });
  eq(off.days.length, 4, "fillDays:false mostra só os dias com registro");

  // legado nunca preenche dias
  const old = PC.espelho(LEGADO.id, "2026-10-01", "2026-10-31", LEGADO, fullDay(LEGADO, "2026-10-02", "09:00", null, null, "17:00"), { today: "2026-10-08" });
  eq(old.days.length, 1, "sem horário fixo: só o dia com registro");

  // período sem nenhum registro do funcionário não gera linhas
  const none = PC.espelho("emp_novo", "2026-10-01", "2026-10-31", LUIZA, entries, { today: "2026-10-08" });
  eq(none.days.length, 0, "funcionário sem nenhum registro: nada a preencher");
})();

console.log("\n=== Resultado: " + passed + " passaram, " + failed + " falharam (" + (passed + failed) + " no total) ===");
process.exit(failed ? 1 : 0);
