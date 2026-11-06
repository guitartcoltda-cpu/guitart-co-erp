/* Teste — Log de Atividade impermeável + "Agendado por" bloqueado. Uso: node test/log-agendado-por.test.js */
"use strict";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const { IDBFactory, IDBKeyRange } = require("fake-indexeddb");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { if (await fn()) return true; await wait(25); } return false; }
console.log("=== Log de atividade protegido + Agendado por (db.js) ===");

const DBJS = fs.readFileSync(process.env.DBJS || path.join(root, "assets", "js", "db.js"), "utf8");
const T0 = Date.parse("2026-11-06T12:00:00Z");

function makeServer() {
  const tables = {}; const reqs = []; let tick = 0;
  const srv = { tables, reqs, writesDown: false, readsDown: false, hangWrites: false, hangReads: false };
  const T = n => tables[n] || (tables[n] = []);
  const stamp = () => new Date(T0 + (++tick) * 1000).toISOString();
  srv.put = (name, data) => { const i = T(name).findIndex(r => r.id === data.id); const row = { id: data.id, data: JSON.parse(JSON.stringify(data)), updated_at: stamp() }; if (i >= 0) T(name)[i] = row; else T(name).push(row); };
  srv.del = (name, id) => { tables[name] = T(name).filter(r => r.id !== id); };
  srv.has = (name, id) => T(name).some(r => r.id === id);
  srv.get = (name, id) => { const r = T(name).find(x => x.id === id); return r ? r.data : null; };
  function from(name) {
    const st = { name, cols: "data", opts: {}, filters: [], orders: [], op: "select", payload: null, range: null, lim: null };
    const api = {
      select(c, o) { st.cols = c || "data"; st.opts = o || {}; return api; },
      eq(k, v) { st.filters.push(["eq", k, v]); return api; },
      neq(k, v) { st.filters.push(["neq", k, v]); return api; },
      in(k, vs) { st.filters.push(["in", k, vs]); return api; },
      gt(k, v) { st.filters.push(["gt", k, v]); return api; },
      order(k, o) { st.orders.push([k, !(o && o.ascending === false)]); return api; },
      limit(n) { st.lim = n; return api; },
      range(a, b) { st.range = [a, b]; return api; },
      upsert(p) { st.op = "upsert"; st.payload = p; return api; },
      update(p) { st.op = "update"; st.payload = p; return api; },
      delete() { st.op = "delete"; return api; },
      then(res, rej) { return run().then(res, rej); }
    };
    async function run() {
      const isWrite = st.op !== "select";
      reqs.push({ table: name, op: st.op, cols: st.cols, head: !!st.opts.head, filters: st.filters.map(f => f[0]), range: st.range });
      if (isWrite && srv.hangWrites) return new Promise(() => {});
      if (isWrite && srv.writesDown) return { error: { message: "TypeError: Failed to fetch" } };
      if (!isWrite && srv.hangReads) return new Promise(() => {});
      if (!isWrite && srv.readsDown) return { error: { message: "TypeError: Failed to fetch" } };
      await wait(1);
      const base = name.replace(/_boot$/, "");
      if (st.op === "upsert") { (Array.isArray(st.payload) ? st.payload : [st.payload]).forEach(p => srv.put(base, p.data)); return { error: null }; }
      if (st.op === "update") {
        let rows = T(base).slice();
        st.filters.forEach(f => { if (f[0] === "eq") rows = rows.filter(r => (f[1] === "id" ? r.id : f[1] === "updated_at" ? r.updated_at : null) === f[2]); });
        rows.forEach(r => srv.put(base, st.payload.data));
        return { data: rows.map(r => ({ id: r.id })), error: null };
      }
      if (st.op === "delete") {
        let rows = T(base).slice();
        st.filters.forEach(f => { if (f[0] === "eq") rows = rows.filter(r => r.id === f[2]); if (f[0] === "neq") rows = rows.filter(r => r.id !== f[2]); });
        rows.forEach(r => srv.del(base, r.id));
        return { error: null };
      }
      let rows = T(base).map(r => {
        let d = r.data;
        if (/_boot$/.test(name)) { d = Object.assign({}, d); if (d.attachment) { d.attachment = Object.assign({}, d.attachment); delete d.attachment.dataUrl; } if (d.selfieDataUrl) { d.hasSelfie = true; delete d.selfieDataUrl; } }
        return { id: r.id, data: d, updated_at: r.updated_at };
      });
      st.filters.forEach(f => {
        if (f[0] === "eq") rows = rows.filter(r => (f[1] === "id" ? r.id : r.data[f[1]]) === f[2]);
        if (f[0] === "in") rows = rows.filter(r => f[2].indexOf(r.id) !== -1);
        if (f[0] === "gt") rows = rows.filter(r => Date.parse(r.updated_at) > Date.parse(f[2]));
      });
      st.orders.slice().reverse().forEach(o => { rows.sort((a, b) => { const x = o[0] === "id" ? a.id : a.updated_at, y = o[0] === "id" ? b.id : b.updated_at; return (x < y ? -1 : x > y ? 1 : 0) * (o[1] ? 1 : -1); }); });
      const total = rows.length;
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      if (st.lim != null) rows = rows.slice(0, st.lim);
      const cols = st.cols.replace(/\s/g, "").split(",");
      rows = rows.map(r => { const o = {}; cols.forEach(c => { o[c] = r[c]; }); return o; });
      if (st.opts.head) return { data: null, count: total, error: null };
      return { data: rows, count: st.opts.count ? total : null, error: null };
    }
    return api;
  }
  srv.from = from;
  return srv;
}

// Um "aparelho" = um IndexedDB que sobrevive entre aberturas de página.
function makeDevice() { return { idb: new IDBFactory() }; }

async function openPage(device, server, opts) {
  opts = opts || {};
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "https://x.test/" + (opts.page || "agenda.html") });
  const w = dom.window;
  w.indexedDB = device.idb; w.IDBKeyRange = IDBKeyRange;
  w.ENV = { SUPABASE_URL: "https://fake", SUPABASE_ANON_KEY: "k" };
  w.__opts = null;
  w.supabase = { createClient: (u, k, o) => { w.__opts = o; return { from: server.from }; } };
  w.toasts = [];
  w.Toast = { show: (m, t) => w.toasts.push(m) };
  w.console.error = () => {}; w.console.warn = () => {};
  w.eval(DBJS);
  if (opts.waitReady !== false) await w.DB.ready;
  return w;
}


function seedBase(server) {
  server.put("users", { id: "u1", cpf: "111", firstName: "Admin", active: true });
  server.put("settings", { id: "settings", companyName: "Guitart" });
}
function pad(n, w) { return String(n).padStart(w, "0"); }
function logEntry(i) { return { id: "log_" + pad(i, 5), timestamp: new Date(T0 + i * 1000).toISOString(), action: "Agenda", description: "Criou um agendamento " + i, userName: "Teste" }; }
function setUser(w, id, first, last) { w.CurrentUser = { get: () => ({ id, firstName: first, lastName: last }) }; }
function deletesOn(server, table) { return server.reqs.filter(r => r.table === table && r.op === "delete").length; }

(async function main() {
  // ---------- 1. Log: nunca apaga, mesmo passando de 2.000 ----------
  {
    const server = makeServer(); seedBase(server);
    for (let i = 0; i < 2105; i++) server.put("activityLog", logEntry(i));
    const w = await openPage({ idb: new IDBFactory() }, server);
    ok(w.DB.all("activityLog").length === 2105, "1a: carrega as 2.105 entradas (paginação estável, sem pular nem repetir)");
    ok(new Set(w.DB.all("activityLog").map(l => l.id)).size === 2105, "1b: sem repetidos");
    setUser(w, "u9", "Luiza", "Morais");
    const e = w.DB.log("Agenda", "Nova entrada depois do limite antigo");
    ok(e && e.userName === "Luiza Morais", "1c: grava com o nome de quem fez");
    await until(() => server.has("activityLog", e.id));
    ok(server.has("activityLog", e.id), "1d: nova entrada chega ao servidor");
    for (let i = 0; i < 30; i++) w.DB.log("Agenda", "Entrada " + i);
    await wait(300);
    ok(w.DB.all("activityLog").length === 2105 + 31, "1e: cache só cresce (2.136)");
    ok(server.tables.activityLog.length === 2105 + 31, "1f: servidor só cresce (2.136) — nada foi apagado");
    ok(deletesOn(server, "activityLog") === 0, "1g: nenhuma exclusão no log enviada ao servidor");
    ok(server.has("activityLog", "log_00000") && server.has("activityLog", "log_02104"), "1h: entradas antigas e recentes continuam lá");
  }

  // ---------- 2. Log: nenhuma outra rota apaga ----------
  {
    const server = makeServer(); seedBase(server);
    for (let i = 0; i < 10; i++) server.put("activityLog", logEntry(i));
    const w = await openPage({ idb: new IDBFactory() }, server);
    ok(w.DB.remove("activityLog", "log_00001") === false && !!w.DB.get("activityLog", "log_00001"), "2a: remove recusado");
    w.DB.removeWhere("activityLog", () => true); ok(w.DB.all("activityLog").length === 10, "2b: removeWhere recusado");
    w.DB.setTable("activityLog", []); ok(w.DB.all("activityLog").length === 10, "2c: setTable recusado");
    await wait(200);
    ok(server.tables.activityLog.length === 10 && deletesOn(server, "activityLog") === 0, "2d: servidor intacto");
    // restaurar backup: junta, não substitui
    const bk = { users: [{ id: "u1", cpf: "111", firstName: "Admin", active: true }], settings: { companyName: "Guitart" }, activityLog: [logEntry(3), Object.assign(logEntry(900), { description: "só no backup" })] };
    w.DB.importJSON(JSON.stringify(bk));
    await wait(400);
    ok(w.DB.all("activityLog").length === 11, "2e: restauração junta o log (10 atuais + 1 só do backup)");
    ok(server.tables.activityLog.length === 11 && server.has("activityLog", "log_00900"), "2f: servidor recebe a entrada do backup e mantém as demais");
    ok(deletesOn(server, "activityLog") === 0, "2g: restauração não apaga log no servidor");
  }

  // ---------- 3. Agendado por ----------
  {
    const server = makeServer(); seedBase(server);
    server.put("appointments", { id: "old1", date: "2026-12-17", time: "11:00", clientId: "c1", _importBatch: "planilha-agendamentos-2026-09-02" });
    const w = await openPage({ idb: new IDBFactory() }, server);
    setUser(w, "u9", "Luiza", "Morais");
    const a = w.DB.insert("appointments", { date: "2026-12-20", time: "10:00", clientId: "c1", price: 50, status: "agendado" });
    ok(a.createdByName === "Luiza Morais" && a.createdById === "u9", "3a: insert grava quem agendou");
    await until(() => server.has("appointments", a.id));
    ok(server.get("appointments", a.id).createdByName === "Luiza Morais", "3b: vai para o servidor");
    w.DB.update("appointments", a.id, { createdByName: "Fulano", createdById: "x", price: 60 });
    ok(w.DB.get("appointments", a.id).createdByName === "Luiza Morais" && w.DB.get("appointments", a.id).createdById === "u9", "3c: update não consegue trocar o autor");
    ok(w.DB.get("appointments", a.id).price === 60, "3d: demais campos continuam editáveis");
    await wait(100);
    ok(server.get("appointments", a.id).createdByName === "Luiza Morais" && server.get("appointments", a.id).price === 60, "3e: servidor mantém o autor e recebe a edição");
    setUser(w, "u2", "Outra", "Pessoa");
    w.DB.update("appointments", a.id, { status: "concluido" });
    ok(w.DB.get("appointments", a.id).createdByName === "Luiza Morais", "3f: outra pessoa editando não vira autora");
    const many = w.DB.insertMany("appointments", [{ date: "2026-12-21", time: "09:00" }, { date: "2026-12-21", time: "10:00" }]);
    ok(many.every(r => r.createdByName === "Outra Pessoa"), "3g: insertMany também grava o autor");
    const pre = w.DB.insert("appointments", { date: "2026-12-22", time: "09:00", createdByName: "Preenchido", createdById: "z" });
    ok(pre.createdByName === "Preenchido", "3h: não sobrescreve autor já informado na criação");
    w.DB.update("appointments", "old1", { createdByName: "Alguém", notes: "x" });
    ok(!w.DB.get("appointments", "old1").createdByName && w.DB.get("appointments", "old1").notes === "x", "3i: agendamento antigo continua sem autor (só o desenvolvedor corrige no banco)");
    w.CurrentUser = undefined;
    const semUser = w.DB.insert("appointments", { date: "2026-12-23", time: "09:00" });
    ok(semUser.createdByName === "Administrador", "3j: sem sessão, grava Administrador (mesma regra do log)");
    ok(w.DB.insert("clients", { name: "Cli" }).createdByName === undefined, "3k: outras tabelas não ganham o campo");
  }

  console.log("\nResultado: " + passed + " ok, " + failed + " falha(s)");
  process.exit(failed ? 1 : 0);
})();
