/* Teste — trava offline: sem conexão o sistema vira só consulta (nenhuma gravação), volta sozinho depois de atualizar os dados. Uso: node test/trava-offline.test.js */
"use strict";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const { IDBFactory, IDBKeyRange } = require("fake-indexeddb");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { if (await fn()) return true; await wait(25); } return false; }
console.log("=== Trava offline (db.js + layout.js) ===");

const DBJS = fs.readFileSync(process.env.DBJS || path.join(root, "assets", "js", "db.js"), "utf8");
const T0 = Date.parse("2026-10-26T12:00:00Z");

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

function seed(server) {
  server.put("users", { id: "u1", cpf: "111", firstName: "Admin", active: true });
  server.put("settings", { id: "settings", companyName: "Guitart" });
  for (let i = 0; i < 5; i++) server.put("clients", { id: "c" + i, name: "Cliente " + i });
  for (let i = 0; i < 4; i++) server.put("appointments", { id: "a" + i, date: "2026-10-2" + i, clientId: "c" + i, updatedAt: "2026-10-20T10:00:00Z" });
  server.put("transactions", { id: "t1", amount: 100, attachment: { name: "x.pdf", type: "application/pdf", size: 10, dataUrl: "data:AAAA" } });
  server.put("timeClockEntries", { id: "k1", employeeId: "e1", selfieDataUrl: "data:image/jpeg;base64,AAAA" });
}

function setOnline(w, v) {
  Object.defineProperty(w.navigator, "onLine", { value: v, configurable: true });
  w.dispatchEvent(new w.Event(v ? "online" : "offline"));
}
function gesture(w) { w.document.dispatchEvent(new w.Event("click", { bubbles: true })); }
function serverSig(server) { return JSON.stringify(server.tables); }

(async function main() {
  // ---------- 1. Sem rede: faixa, bloqueio, nada muda ----------
  {
    const server = makeServer(); seed(server);
    const w = await openPage(makeDevice(), server);
    ok(!w.DB.isOffline(), "1a: começa liberado");
    const rec = w.DB.insert("clients", { name: "Novo online" });
    ok(rec.id && w.DB.get("clients", rec.id), "1b: online grava normal");
    await until(() => server.has("clients", rec.id));
    ok(server.has("clients", rec.id), "1c: online chega ao servidor");

    setOnline(w, false);
    ok(w.DB.isOffline(), "1d: evento offline trava");
    const bar = w.document.getElementById("salao-offline-bar");
    ok(bar && /Sem conexão/.test(bar.textContent) && /só para consulta/.test(bar.textContent), "1e: faixa fixa no topo com o aviso");
    ok(w.document.body.classList.contains("salao-offline"), "1f: corpo da página recebe a classe (desce para a faixa)");

    const before = serverSig(server), reqsBefore = server.reqs.length;
    const nBefore = w.DB.all("clients").length;
    // rotina de fundo (sem clique): ignorada em silêncio
    let r;
    r = w.DB.insert("clients", { name: "Fantasma" }); ok(r && !w.DB.all("clients").some(c => c.name === "Fantasma"), "1g: insert em silêncio não grava no cache");
    ok(w.DB.update("clients", "c0", { name: "Mudou" }) === null && w.DB.get("clients", "c0").name === "Cliente 0", "1h: update recusado");
    ok(w.DB.remove("clients", "c1") === false && !!w.DB.get("clients", "c1"), "1i: remove recusado");
    w.DB.insertMany("clients", [{ name: "A" }, { name: "B" }]); ok(w.DB.all("clients").length === nBefore, "1j: insertMany recusado");
    ok(w.DB.mergeFieldUpdate("clients", "c0", "name", () => "X") === null && w.DB.get("clients", "c0").name === "Cliente 0", "1k: mergeFieldUpdate recusado");
    ok(w.DB.mergeRecordUpdate("clients", "c0", () => ({ name: "Y" })) === null && w.DB.get("clients", "c0").name === "Cliente 0", "1l: mergeRecordUpdate recusado");
    w.DB.mergeSettingsField("roles", () => ["x"]); ok(!(w.DB.getSettings().roles || []).includes("x"), "1m: mergeSettingsField recusado");
    w.DB.updateSettings({ companyName: "Hack" }); ok(w.DB.getSettings().companyName === "Guitart", "1n: updateSettings recusado");
    w.DB.saveRoles(["a"]); w.DB.savePaymentMethods([{ id: "p" }]); w.DB.saveTreatmentPackages([{ id: "t" }]);
    ok(!(w.DB.getSettings().treatmentPackages || []).length, "1o: save* recusados");
    w.DB.removeWhere("clients", () => true); ok(w.DB.all("clients").length === nBefore, "1p: removeWhere recusado");
    w.DB.setTable("clients", []); ok(w.DB.all("clients").length === nBefore, "1q: setTable recusado");
    ok(w.DB.log("Teste", "x") === null && !w.DB.all("activityLog").some(l => l.action === "Teste"), "1r: log não grava (e não lança)");
    await wait(150);
    ok(serverSig(server) === before, "1s: servidor idêntico (nenhuma gravação saiu)");
    ok(server.reqs.slice(reqsBefore).every(x => x.op === "select"), "1t: nenhuma requisição de gravação");
    ok(w.toasts.some(m => /nada foi salvo/i.test(m)), "1u: avisou o usuário");

    // clique do usuário: lança erro e não grava (janela fica aberta)
    gesture(w);
    let err = null; try { w.DB.insert("clients", { name: "Clique" }); } catch (e) { err = e; }
    ok(err && err.name === "OfflineLockError" && err.offlineLock, "1v: gravação a partir de clique lança OfflineLockError");
    ok(!w.DB.all("clients").some(c => c.name === "Clique"), "1w: e não grava");
    err = null; try { w.DB.update("clients", "c0", { name: "Z" }); } catch (e) { err = e; }
    ok(err && err.offlineLock, "1x: update a partir de clique também lança");
    // consulta segue funcionando
    ok(w.DB.get("clients", "c2").name === "Cliente 2" && w.DB.all("appointments").length === 4, "1y: consulta continua funcionando");
  }

  // ---------- 2. Volta: testa o servidor, ATUALIZA os dados e só então libera ----------
  {
    const server = makeServer(); seed(server);
    const w = await openPage(makeDevice(), server);
    setOnline(w, false);
    ok(w.DB.isOffline(), "2a: travado");
    // enquanto estava sem conexão, outra pessoa mudou o cliente c0 e criou c9
    server.put("clients", { id: "c0", name: "Cliente 0 (outra pessoa)", updatedAt: "2026-10-29T10:00:00Z" });
    server.put("clients", { id: "c9", name: "Cliente 9 novo" });
    // ainda sem rede: tentar agora não libera
    server.readsDown = true;
    let done = false; w.DB.checkConnection(() => { done = true; });
    await until(() => done);
    ok(w.DB.isOffline(), "2b: servidor fora do ar: continua travado");
    setOnline(w, false); // mantém navigator.onLine=false
    server.readsDown = false;
    done = false; w.DB.checkConnection(() => { done = true; });
    await until(() => done);
    ok(w.DB.isOffline(), "2c: navegador ainda diz sem rede: continua travado");
    setOnline(w, true);
    await until(() => !w.DB.isOffline(), 4000);
    ok(!w.DB.isOffline(), "2d: voltou a rede e o servidor respondeu: libera");
    ok(w.DB.get("clients", "c0").name === "Cliente 0 (outra pessoa)" && !!w.DB.get("clients", "c9"), "2e: dados atualizados ANTES de liberar (não edita cópia velha)");
    ok(!w.document.getElementById("salao-offline-bar") && !w.document.body.classList.contains("salao-offline"), "2f: faixa some");
    ok(w.toasts.some(m => /Conexão restabelecida/.test(m)), "2g: avisou que voltou");
    const rec = w.DB.insert("clients", { name: "Depois" });
    await until(() => server.has("clients", rec.id));
    ok(server.has("clients", rec.id), "2h: depois de liberar, grava normal");
  }

  // ---------- 3. Alteração aceita ANTES de cair a conexão continua na fila e sai sozinha ----------
  {
    const server = makeServer(); seed(server);
    const w = await openPage(makeDevice(), server);
    server.writesDown = true; // a rede cai exatamente no instante do Salvar
    const rec = w.DB.insert("clients", { name: "Salvo no instante da queda" });
    ok(w.DB.pendingCount() === 1, "3a: entrou na fila durável");
    await until(() => w.DB.isOffline(), 7000);
    ok(w.DB.isOffline(), "3b: duas falhas de rede seguidas travam (sem evento offline do navegador)");
    ok(w.DB.pendingCount() === 1 && !!w.DB.get("clients", rec.id), "3c: a alteração pendente continua guardada e visível");
    server.writesDown = false;
    w.DB.checkConnection();
    await until(() => !w.DB.isOffline(), 5000);
    await until(() => server.has("clients", rec.id), 5000);
    ok(server.has("clients", rec.id) && w.DB.pendingCount() === 0, "3d: ao voltar, a alteração pendente chegou ao servidor (nada se perdeu)");
    ok(!w.DB.isOffline(), "3e: liberado");
  }

  // ---------- 4. Abrir offline com cópia local (app instalado): fica só para consulta ----------
  {
    const server = makeServer(); seed(server);
    const device = makeDevice();
    const w1 = await openPage(device, server); await wait(100); w1.close();
    server.readsDown = true;
    const w2 = await openPage(device, server);
    await until(() => w2.DB.isOffline(), 8000);
    ok(w2.DB.isOffline(), "4a: carga falhou: abre com a cópia local, travado");
    ok(w2.DB.all("clients").length === 5, "4b: cópia local aparece para consulta");
    gesture(w2); let err = null; try { w2.DB.insert("clients", { name: "x" }); } catch (e) { err = e; }
    ok(err && err.offlineLock, "4c: não deixa gravar");
    server.readsDown = false; server.put("clients", { id: "c7", name: "Chegou depois" });
    w2.DB.checkConnection();
    await until(() => !w2.DB.isOffline(), 8000);
    ok(!w2.DB.isOffline() && !!w2.DB.get("clients", "c7"), "4d: voltou: tabelas que falharam foram baixadas antes de liberar");
  }

  // ---------- 5. Tela de login nunca quebra com a trava ----------
  {
    const server = makeServer(); seed(server);
    const w = await openPage(makeDevice(), server, { page: "login.html" });
    setOnline(w, false);
    gesture(w);
    let err = null, r; try { r = w.DB.update("users", "u1", { password: "hash" }); w.DB.log("Acesso", "login"); } catch (e) { err = e; }
    ok(!err, "5a: login offline: migração de senha/registro de acesso não lançam erro");
  }

  // ---------- 6. Parte visual: botões que gravam travam, consulta continua ----------
  {
    const layoutSrc = fs.readFileSync(path.join(root, "assets", "js", "layout.js"), "utf8");
    const dom = new JSDOM('<!doctype html><body><div class="page-content"><button id="btn-new-client" class="btn btn-primary">Novo Cliente</button>' +
      '<button id="btn-rv-export" class="btn btn-primary">Exportar CSV</button><button class="btn btn-ghost btn-icon" id="del"><i class="fa-solid fa-trash"></i></button>' +
      '<button class="btn btn-ghost btn-icon" id="edit"><i class="fa-solid fa-pen"></i></button><label class="btn btn-primary" id="selfie">Selfie<input type="file"></label>' +
      '<button class="btn btn-primary" id="ccg-save">Fechar Conta</button><button class="btn btn-secondary" id="cancel" data-close-modal>Cancelar</button>' +
      '<button class="btn btn-sm btn-primary" id="pay" data-pay="x">Marcar como pago</button><button class="btn btn-sm btn-primary" id="filt">Filtrar</button></div></body>', { runScripts: "outside-only", url: "https://x.test/clientes.html" });
    const w = dom.window;
    let offline = false;
    w.DB = { isOffline: () => offline, ready: new Promise(() => {}) };
    w.toasts = []; w.Toast = { show: m => w.toasts.push(m) };
    w.CurrentUser = { isLoginPage: () => true, get: () => null };
    w.console.error = () => {};
    w.eval(layoutSrc);
    w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
    const clicks = {};
    ["btn-new-client", "btn-rv-export", "del", "edit", "selfie", "ccg-save", "cancel", "pay", "filt"].forEach(id => { w.document.getElementById(id).addEventListener("click", () => { clicks[id] = (clicks[id] || 0) + 1; }); });
    const click = id => w.document.getElementById(id).dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    ["btn-new-client", "del", "ccg-save", "pay"].forEach(click);
    ok(clicks["btn-new-client"] === 1 && clicks.del === 1 && clicks["ccg-save"] === 1 && clicks.pay === 1, "6a: online: tudo funciona");
    offline = true;
    w.dispatchEvent(new w.CustomEvent("salao:connection", { detail: { offline: true } }));
    Object.keys(clicks).forEach(k => delete clicks[k]);
    ["btn-new-client", "del", "ccg-save", "pay", "selfie"].forEach(click);
    ok(!clicks["btn-new-client"] && !clicks.del && !clicks["ccg-save"] && !clicks.pay && !clicks.selfie, "6b: offline: Novo/Excluir/Fechar Conta/Marcar pago/Selfie bloqueados");
    ["btn-rv-export", "edit", "cancel", "filt"].forEach(click);
    ok(clicks["btn-rv-export"] === 1 && clicks.edit === 1 && clicks.cancel === 1 && clicks.filt === 1, "6c: offline: Exportar, Editar (abrir), Cancelar e Filtrar continuam");
    ok(w.document.getElementById("ccg-save").classList.contains("offline-blocked") && !w.document.getElementById("btn-rv-export").classList.contains("offline-blocked"), "6d: botões que gravam ficam esmaecidos, os de consulta não");
    ok(w.toasts.some(m => /só para consulta/.test(m)), "6e: clique bloqueado explica o motivo");
    offline = false;
    w.dispatchEvent(new w.CustomEvent("salao:connection", { detail: { offline: false } }));
    ok(!w.document.querySelector(".offline-blocked"), "6f: ao voltar, nada fica esmaecido");
    Object.keys(clicks).forEach(k => delete clicks[k]);
    click("ccg-save");
    ok(clicks["ccg-save"] === 1, "6g: ao voltar, botão funciona de novo");
  }

  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})();
