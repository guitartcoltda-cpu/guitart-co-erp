/* Teste — selfies fora da carga geral (db.js): view leve, carga sob demanda e trava contra apagar a foto. Uso: node test/selfie-sob-demanda-db.test.js */
"use strict";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
console.log("=== Selfies sob demanda (db.js) ===");

const IMG = n => "data:image/jpeg;base64," + Buffer.from("selfie-" + n + "-" + "x".repeat(200)).toString("base64");

function makeServer(opts) {
  opts = opts || {};
  const tables = {};
  const reqs = [];
  const T = n => tables[n] || (tables[n] = []);
  function viewRows(name) {
    if (name === "timeClockEntries_boot") {
      if (opts.viewMissing) return { error: { message: "relation does not exist" } };
      return { data: T("timeClockEntries").map(r => {
        const d = Object.assign({}, r.data); const had = d.selfieDataUrl; delete d.selfieDataUrl;
        if (had) d.hasSelfie = true;
        return { id: r.id, data: d };
      }) };
    }
    return { data: T(name).map(r => ({ id: r.id, data: r.data })) };
  }
  function from(name) {
    const st = { name, cols: "data", filters: [], op: "select", payload: null, range: null };
    const api = {
      select(c) { st.cols = c || "data"; return api; },
      eq(k, v) { st.filters.push(["eq", k, v]); return api; },
      in(k, vs) { st.filters.push(["in", k, vs]); return api; },
      gt() { return api; }, limit() { return api; },
      range(a, b) { st.range = [a, b]; return api; },
      upsert(p) { st.op = "upsert"; st.payload = p; return api; },
      update(p) { st.op = "update"; st.payload = p; return api; },
      delete() { st.op = "delete"; return api; },
      neq() { return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function run() {
      reqs.push({ table: name, op: st.op, cols: st.cols, filters: st.filters.slice() });
      if (st.op === "upsert") {
        (Array.isArray(st.payload) ? st.payload : [st.payload]).forEach(p => {
          const i = T(name).findIndex(r => r.id === p.id);
          const row = { id: p.id, data: JSON.parse(JSON.stringify(p.data)), updated_at: String(Date.now()) };
          if (i >= 0) T(name)[i] = row; else T(name).push(row);
        });
        return { error: null };
      }
      let rows;
      if (/_boot$/.test(name)) { const v = viewRows(name); if (v.error) return v; rows = v.data; }
      else rows = T(name).map(r => ({ id: r.id, data: r.data, updated_at: r.updated_at }));
      st.filters.forEach(f => {
        if (f[0] === "eq") rows = rows.filter(r => (f[1] === "id" ? r.id : r.data[f[1]]) === f[2]);
        if (f[0] === "in") rows = rows.filter(r => f[2].indexOf(r.id) !== -1);
      });
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      if (/selfie:data->>selfieDataUrl/.test(st.cols)) rows = rows.map(r => ({ id: r.id, selfie: r.data.selfieDataUrl == null ? null : r.data.selfieDataUrl }));
      return { data: rows, error: null };
    }
    return api;
  }
  return { tables, reqs, from, T };
}

async function boot(server) {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "https://x.test/" });
  const w = dom.window;
  w.ENV = { SUPABASE_URL: "https://fake", SUPABASE_ANON_KEY: "k" };
  w.supabase = { createClient: () => ({ from: server.from }) };
  w.console.error = () => {}; w.console.warn = () => {};
  w.eval(fs.readFileSync(process.env.DBJS || path.join(root, "assets", "js", "db.js"), "utf8"));
  await w.DB.ready;
  return w;
}

function seed(server, n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ id: "t" + i, data: { id: "t" + i, employeeId: "e1", employeeName: "Ana", date: "2026-09-" + String((i % 28) + 1).padStart(2, "0"), type: "entrada", timestamp: "2026-09-01T12:00:00.000Z", selfieDataUrl: i % 10 === 9 ? null : IMG(i), reviewed: false, origin: "selfie" } });
  }
  server.tables.timeClockEntries = rows;
}

(async function () {
  // ---- 1) carga geral usa a view e não traz a foto ----
  let srv = makeServer(); seed(srv, 60);
  let w = await boot(srv);
  const base = srv.reqs.filter(r => r.table === "timeClockEntries");
  const view = srv.reqs.filter(r => r.table === "timeClockEntries_boot");
  ok(view.length === 1 && base.length === 0, "carga geral lê só a view, não a tabela pesada (view=" + view.length + ", base=" + base.length + ")");
  const all = w.DB.all("timeClockEntries");
  ok(all.length === 60, "as 60 marcações vieram");
  ok(all.every(r => !("selfieDataUrl" in r)), "nenhuma veio com a foto");
  ok(all.filter(r => r.hasSelfie).length === 54 && all.filter(r => !r.hasSelfie).length === 6, "hasSelfie só onde existe foto (54 com, 6 sem)");
  ok(JSON.stringify(all).length < 60 * 400, "carga leve (" + JSON.stringify(all).length + " bytes)");

  // ---- 2) gravar um registro leve NÃO apaga a foto do servidor ----
  srv.reqs.length = 0;
  w.DB.update("timeClockEntries", "t0", { reviewed: true, note: "ok" });
  await wait(30);
  let s0 = srv.T("timeClockEntries").find(r => r.id === "t0").data;
  ok(s0.reviewed === true && s0.note === "ok", "campos alterados foram gravados");
  ok(s0.selfieDataUrl === IMG(0), "a selfie continua intacta no servidor");
  ok(!("hasSelfie" in s0), "a marca hasSelfie nunca é gravada no servidor");

  // ---- 3) remover a foto de propósito continua possível ----
  w.DB.update("timeClockEntries", "t1", { selfieDataUrl: null });
  await wait(30);
  ok(srv.T("timeClockEntries").find(r => r.id === "t1").data.selfieDataUrl === null, "remoção deliberada da foto é respeitada");

  // ---- 4) entrada sem foto não faz leitura extra ----
  srv.reqs.length = 0;
  w.DB.update("timeClockEntries", "t9", { reviewed: true });
  await wait(30);
  ok(srv.reqs.filter(r => r.op === "select").length === 0, "marcação sem foto grava direto, sem busca extra");
  ok(srv.T("timeClockEntries").find(r => r.id === "t9").data.reviewed === true, "marcação sem foto gravada");

  // ---- 5) carregar fotos sob demanda, em lotes de 25 ----
  srv.reqs.length = 0;
  const ids = all.filter(r => r.hasSelfie).map(r => r.id);
  const got = await w.DB.hydrateSelfies(ids);
  const selfieReqs = srv.reqs.filter(r => /selfie:data/.test(r.cols));
  ok(selfieReqs.length === Math.ceil(ids.length / 25), "lotes de 25 (" + selfieReqs.length + " pedidos para " + ids.length + " fotos)");
  ok(w.DB.get("timeClockEntries", "t2").selfieDataUrl === IMG(2), "foto carregada no cache");
  ok(got.length === ids.length - 1 || got.length === ids.length, "ids carregados devolvidos");
  // t1 teve a foto removida acima: veio null (sem erro)
  ok(w.DB.get("timeClockEntries", "t1").selfieDataUrl === null, "foto removida volta como null, sem quebrar");

  // ---- 6) segunda chamada não repete o download ----
  srv.reqs.length = 0;
  await w.DB.hydrateSelfies(ids);
  ok(srv.reqs.length === 0, "fotos já carregadas não são baixadas de novo");

  // ---- 7) depois de carregada, gravar mantém a foto e não grava hasSelfie ----
  w.DB.update("timeClockEntries", "t2", { reviewed: true });
  await wait(30);
  s0 = srv.T("timeClockEntries").find(r => r.id === "t2").data;
  ok(s0.selfieDataUrl === IMG(2) && s0.reviewed === true && !("hasSelfie" in s0), "registro com foto carregada grava inteiro e limpo");

  // ---- 8) registro novo (bater ponto) grava a selfie normalmente ----
  w.DB.insert("timeClockEntries", { employeeId: "e1", employeeName: "Ana", date: "2026-10-14", type: "entrada", timestamp: "2026-10-14T12:00:00.000Z", selfieDataUrl: IMG("novo"), origin: "selfie" });
  await wait(30);
  const novo = srv.T("timeClockEntries").find(r => r.data.date === "2026-10-14");
  ok(novo && novo.data.selfieDataUrl === IMG("novo") && !("hasSelfie" in novo.data), "marcação nova guarda a selfie e nada extra");

  // ---- 9) o backup completo (exportJSON) continua trazendo as fotos ----
  const json = JSON.parse(await w.DB.exportJSON());
  ok(json.timeClockEntries.filter(r => r.selfieDataUrl).length >= 50, "exportJSON inclui as selfies (" + json.timeClockEntries.filter(r => r.selfieDataUrl).length + ")");
  ok(json.timeClockEntries.every(r => !("hasSelfie" in r)), "exportJSON sem a marca hasSelfie");

  // ---- 10) view ainda não criada: cai para a tabela inteira (nada quebra) ----
  const srv2 = makeServer({ viewMissing: true }); seed(srv2, 12);
  const w2 = await boot(srv2);
  const a2 = w2.DB.all("timeClockEntries");
  ok(a2.length === 12 && a2.filter(r => r.selfieDataUrl).length === 11, "sem a view: as 12 marcações vêm completas, com foto");
  ok(a2.every(r => !r.hasSelfie), "sem a view: ninguém é tratado como 'leve'");
  srv2.reqs.length = 0;
  w2.DB.update("timeClockEntries", "t0", { reviewed: true });
  await wait(30);
  ok(srv2.T("timeClockEntries").find(r => r.id === "t0").data.selfieDataUrl === IMG(0), "sem a view: foto preservada ao gravar");
  ok((await w2.DB.hydrateSelfies(["t0"])).length === 0, "sem a view: nada a carregar");

  // ---- 11) duas pessoas: outra edita o mesmo registro enquanto o primeiro tem a versão leve ----
  const srv3 = makeServer(); seed(srv3, 5);
  const w3 = await boot(srv3);
  srv3.T("timeClockEntries").find(r => r.id === "t0").data.note = "feito pela outra pessoa";
  w3.DB.update("timeClockEntries", "t0", { reviewed: true });
  await wait(30);
  const c = srv3.T("timeClockEntries").find(r => r.id === "t0").data;
  ok(c.selfieDataUrl === IMG(0), "mesmo com edição concorrente, a selfie nunca é perdida");

  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})();
