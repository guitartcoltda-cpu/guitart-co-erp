/* Teste — db.js: fila de alterações pendentes (nada se perde), sincronização incremental,
   boot resiliente e requisições com limite de tempo/nova tentativa. Uso: node test/db-resiliencia.test.js */
"use strict";
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const { IDBFactory, IDBKeyRange } = require("fake-indexeddb");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { if (await fn()) return true; await wait(25); } return false; }
console.log("=== Resiliência da camada de dados (db.js) ===");

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
function dataRequests(server) { return server.reqs.filter(r => r.op === "select" && !r.head && r.cols === "data").length; }

(async function main() {
  // ---------- 1. Primeiro acesso: carga completa e marcadores ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    const w = await openPage(dev, server);
    ok(w.DB.all("appointments").length === 4, "carga completa traz os 4 agendamentos");
    ok(w.DB.all("clients").length === 5, "carga completa traz os 5 clientes");
    ok(w.DB.getSettings().companyName === "Guitart", "settings carregado");
    const tr = w.DB.get("transactions", "t1");
    ok(tr && tr.attachment && !("dataUrl" in tr.attachment), "transação vem leve (sem dataUrl)");
    await wait(80);
    // 2ª abertura no mesmo aparelho: incremental
    server.reqs.length = 0;
    const w2 = await openPage(dev, server);
    ok(w2.DB.all("appointments").length === 4 && w2.DB.all("clients").length === 5, "2ª abertura: dados vindos do espelho local");
    ok(dataRequests(server) === 1, "2ª abertura: só 'settings' é baixado inteiro (" + dataRequests(server) + " cargas de 'data' completas)");
    ok(!server.reqs.some(r => r.op === "select" && r.cols === "data" && r.table === "appointments"), "2ª abertura: não baixa a tabela de agendamentos inteira");

    // ---------- 2. Mudanças de outra pessoa chegam pelo incremental ----------
    server.put("appointments", { id: "a1", date: "2026-10-21", clientId: "c1", note: "editado por outra pessoa", updatedAt: "2026-10-26T10:00:00Z" });
    server.put("appointments", { id: "a9", date: "2026-10-29", clientId: "c2" });
    server.del("clients", "c3");
    server.put("transactions", { id: "t2", amount: 50, attachment: { name: "y.pdf", type: "application/pdf", size: 5, dataUrl: "data:BBBB" } });
    await wait(80);
    const w3 = await openPage(dev, server);
    ok(w3.DB.get("appointments", "a1").note === "editado por outra pessoa", "incremental: edição de outra pessoa aparece");
    ok(!!w3.DB.get("appointments", "a9"), "incremental: registro novo aparece");
    ok(w3.DB.all("appointments").length === 5, "incremental: total de agendamentos correto (5)");
    ok(!w3.DB.get("clients", "c3") && w3.DB.all("clients").length === 4, "incremental: registro apagado por outra pessoa sai do cache");
    const t2 = w3.DB.get("transactions", "t2");
    ok(t2 && t2.attachment && !("dataUrl" in t2.attachment) && t2.attachment.name === "y.pdf", "incremental: transação nova chega sem dataUrl");
    ok(server.get("transactions", "t2").attachment.dataUrl === "data:BBBB", "o servidor continua com o anexo completo (nada foi apagado)");
    w3.DB.update("transactions", "t2", { amount: 51 });
    await until(() => server.get("transactions", "t2").amount === 51);
    ok(server.get("transactions", "t2").attachment.dataUrl === "data:BBBB", "editar transação 'leve' não apaga o anexo no servidor");
    ok(server.get("transactions", "t1").attachment.dataUrl === "data:AAAA", "anexo da outra transação intacto");
    const k = w3.DB.get("timeClockEntries", "k1");
    ok(k && k.hasSelfie && !("selfieDataUrl" in k), "marcação de ponto chega 'leve' com hasSelfie");
    ok(server.reqs.filter(r => r.op === "delete").length === 0, "sincronização nunca apaga nada no servidor");
  }

  // ---------- 3. Agendamento criado sem rede NÃO some ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    const w = await openPage(dev, server);
    await wait(60);
    server.writesDown = true;                       // celular sem sinal na hora de salvar
    const rec = w.DB.insert("appointments", { id: "natally1", date: "2026-10-27", time: "11:00", clientId: "c1", status: "agendado" });
    await wait(80);
    ok(!server.has("appointments", "natally1"), "servidor não recebeu (sem rede)");
    ok(w.DB.pendingCount() === 1, "fila mostra 1 alteração pendente");
    // a pessoa troca de tela / reabre o app: nova página no mesmo aparelho, servidor ainda sem aceitar gravações
    const w2 = await openPage(dev, server);
    ok(!!w2.DB.get("appointments", "natally1"), "após recarregar, o agendamento continua aparecendo (fila local)");
    ok(w2.DB.pendingCount() === 1, "a fila foi recuperada do aparelho");
    // internet volta
    server.writesDown = false;
    w2.DB.flushPending();
    ok(await until(() => server.has("appointments", "natally1"), 4000), "quando a internet volta, o agendamento chega ao servidor sozinho");
    ok(await until(() => w2.DB.pendingCount() === 0, 2000), "fila esvazia depois da confirmação");
    await wait(80);
    const w3 = await openPage(dev, server);
    ok(!!w3.DB.get("appointments", "natally1"), "agendamento segue existindo nas aberturas seguintes");
    ok(w3.DB.pendingCount() === 0, "nada pendente sobrando");
  }

  // ---------- 4. Envio interrompido (trocou de tela no meio) é refeito ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    const w = await openPage(dev, server);
    await wait(60);
    server.hangWrites = true;                       // requisição que nunca termina (app congelado/aba fechada)
    w.DB.insert("appointments", { id: "hang1", date: "2026-10-28", clientId: "c0" });
    w.DB.update("clients", "c2", { phone: "11999990000" });
    await wait(60);
    server.hangWrites = false;
    const w2 = await openPage(dev, server);         // nova página: reenvia o que ficou pendente
    ok(await until(() => server.has("appointments", "hang1") && server.get("clients", "c2").phone === "11999990000", 4000), "pendências de uma página anterior são reenviadas ao abrir outra");
    ok(await until(() => w2.DB.pendingCount() === 0, 2000), "fila zera");
  }

  // ---------- 5. Exclusão pendente também é preservada ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    const w = await openPage(dev, server);
    await wait(60);
    server.writesDown = true;
    w.DB.remove("appointments", "a2");
    await wait(60);
    const w2 = await openPage(dev, server);
    ok(!w2.DB.get("appointments", "a2"), "exclusão pendente continua valendo ao recarregar");
    server.writesDown = false; w2.DB.flushPending();
    ok(await until(() => !server.has("appointments", "a2"), 4000), "exclusão chega ao servidor depois");
  }

  // ---------- 6. Duas alterações do mesmo registro: vale a última ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    const w = await openPage(dev, server);
    await wait(60);
    server.writesDown = true;
    w.DB.update("appointments", "a0", { note: "v1" });
    w.DB.update("appointments", "a0", { note: "v2" });
    server.writesDown = false; w.DB.flushPending();
    ok(await until(() => (server.get("appointments", "a0") || {}).note === "v2", 4000), "última versão do registro é a que chega ao servidor");
  }

  // ---------- 7. Sem nenhuma cópia local e sem rede: NÃO abre vazio ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    server.readsDown = true;
    const w = await openPage(dev, server, { waitReady: false });
    let ready = false; w.DB.ready.then(() => { ready = true; });
    await wait(400);
    ok(!ready, "sem cópia local e sem servidor, o sistema NÃO libera a tela vazia");
    ok(!!w.document.getElementById("salao-boot-blocker"), "aparece aviso claro de que está tentando carregar");
    server.readsDown = false;
    ok(await until(() => ready, 6000), "quando o servidor responde, carrega sozinho");
    ok(w.DB.all("clients").length === 5, "dados completos após a recuperação");
    ok(!w.document.getElementById("salao-boot-blocker"), "aviso some");
  }

  // ---------- 8. Com cópia local e sem rede: abre com a cópia ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    const w = await openPage(dev, server); await wait(80);
    server.readsDown = true;
    const w2 = await openPage(dev, server);
    ok(w2.DB.all("appointments").length === 4, "sem internet, abre com a última cópia do aparelho");
    ok(w2.toasts.some(m => /Conexão instável/.test(m)), "avisa que é a última cópia");
  }

  // ---------- 9. Tela de login só busca usuários e configurações ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    const w = await openPage(dev, server, { page: "login.html" });
    const tabs = Array.from(new Set(server.reqs.map(r => r.table)));
    ok(tabs.sort().join(",") === "settings,users", "login busca só users e settings (buscou: " + tabs.join(",") + ")");
    ok(w.DB.findOne("users", u => u.cpf === "111") !== null, "usuário disponível no login");
  }

  // ---------- 10. Requisições: gravação não é repetida; keepalive; leitura passa direto ----------
  {
    const server = makeServer();
    const w = await openPage(makeDevice(), server);
    const rf = w.__opts.global.fetch;
    let calls = 0, threw = false;
    w.fetch = function () { calls++; return Promise.reject(new TypeError("Failed to fetch")); };
    try { await rf("https://x/rest", { method: "POST", body: "{}" }); } catch (e) { threw = true; }
    ok(threw && calls === 1, "gravação não é repetida dentro do fetch (a fila cuida disso)");
    let kept = null;
    w.fetch = function (u, o) { kept = o; return Promise.resolve({ status: 201 }); };
    await rf("https://x/rest", { method: "POST", body: '{"a":1}' });
    ok(kept && kept.keepalive === true, "gravações pequenas usam keepalive");
    w.fetch = function (u, o) { kept = o; return Promise.resolve({ status: 200 }); };
    const r = await rf("https://x/rest", { method: "GET" });
    ok(r.status === 200 && kept && !kept.keepalive && !!kept.signal, "leitura passa com sinal de tempo limite");
    // leitura que trava: aborta e tenta de novo uma vez
    calls = 0;
    w.fetch = function (u, o) { calls++; return new Promise((res, rej) => { o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))); if (calls === 2) res({ status: 200 }); }); };
    const realSetTimeout = w.setTimeout;
    w.setTimeout = function (fn, ms) { return realSetTimeout.call(w, fn, ms >= 25000 ? 30 : ms); };
    const r2 = await rf("https://x/rest", { method: "GET" });
    ok(r2.status === 200 && calls === 2, "leitura travada é abortada e repetida uma vez (chamadas: " + calls + ")");
  }

  // ---------- 11. Conexão muito lenta com cópia local: abre com a cópia em ~9s ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    await openPage(dev, server); await wait(80);
    server.hangReads = true;
    const t0 = Date.now();
    const w = await openPage(dev, server);
    const dt = Date.now() - t0;
    ok(dt >= 8000 && dt < 12000, "abre com a cópia local depois de ~9s (levou " + dt + "ms)");
    ok(w.DB.all("appointments").length === 4, "dados da cópia local disponíveis");
    ok(w.toasts.some(m => /Conexão lenta/.test(m)), "avisa que abriu com a última cópia");
  }

  // ---------- 12. Soma/subtração de estoque: leitura que falha é repetida; nada em dobro ----------
  {
    const server = makeServer(); seed(server);
    server.put("products", { id: "p1", name: "Shampoo", currentStock: 10 });
    const dev = makeDevice();
    const w = await openPage(dev, server); await wait(60);
    server.readsDown = true;
    w.DB.mergeFieldUpdate("products", "p1", "currentStock", v => (v || 0) - 3);
    await wait(500);
    server.readsDown = false;
    ok(await until(() => server.get("products", "p1").currentStock === 7, 6000), "estoque gravado depois que a leitura volta (10 - 3 = 7)");
    await wait(300);
    ok(server.get("products", "p1").currentStock === 7, "e não é aplicado duas vezes");
  }


  // ---------- 13. Atualização ao vivo (DB.refresh) ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    const w = await openPage(dev, server); await wait(80);
    // nada mudou: nenhuma tabela avisada
    let ch = await w.DB.refresh(["appointments", "clients"], { withCount: true });
    ok(Array.isArray(ch) && ch.length === 0, "sem mudanças: nenhuma tabela é avisada (" + JSON.stringify(ch) + ")");
    // minha própria gravação não conta como mudança de outra pessoa
    w.DB.insert("appointments", { id: "mine1", date: "2026-10-30", clientId: "c1", status: "agendado" });
    await until(() => w.DB.pendingCount() === 0);
    ch = await w.DB.refresh(["appointments"], { withCount: true });
    ok(ch.length === 0, "a própria gravação, ao voltar do servidor, não dispara redesenho (" + JSON.stringify(ch) + ")");
    // outra pessoa cria e edita
    server.put("appointments", { id: "other1", date: "2026-10-30", clientId: "c2", status: "agendado" });
    server.put("appointments", { id: "a0", date: "2026-10-20", clientId: "c0", note: "mexeu", updatedAt: "2026-10-26T11:00:00Z" });
    ch = await w.DB.refresh(["appointments", "clients"], { withCount: false });
    ok(ch.length === 1 && ch[0] === "appointments", "mudança de outra pessoa é detectada só na tabela certa (" + JSON.stringify(ch) + ")");
    ok(!!w.DB.get("appointments", "other1") && w.DB.get("appointments", "a0").note === "mexeu", "registro novo e editado já estão no cache");
    // exclusão por outra pessoa (precisa da contagem)
    server.del("appointments", "a3");
    ch = await w.DB.refresh(["appointments"], { withCount: false });
    ok(!!w.DB.get("appointments", "a3"), "sem contagem, a exclusão ainda não é percebida (esperado)");
    ch = await w.DB.refresh(["appointments"], { withCount: true });
    ok(!w.DB.get("appointments", "a3") && ch.indexOf("appointments") !== -1, "com a contagem, a exclusão de outra pessoa é percebida");
    // configurações
    server.put("settings", { id: "settings", companyName: "Guitart 2" });
    ch = await w.DB.refresh(["settings"]);
    ok(w.DB.getSettings().companyName === "Guitart 2" && ch.indexOf("settings") !== -1, "configurações alteradas por outra pessoa chegam");
    // pendência local não é atropelada por leitura ao vivo
    server.writesDown = true;
    w.DB.update("appointments", "other1", { note: "minha edição offline" });
    server.put("appointments", { id: "other1", date: "2026-10-30", clientId: "c2", note: "versão do servidor", status: "agendado" });
    await w.DB.refresh(["appointments"], { withCount: false });
    ok(w.DB.get("appointments", "other1").note === "minha edição offline", "alteração local pendente não é sobrescrita pela atualização ao vivo");
    server.writesDown = false; w.DB.flushPending();
    ok(await until(() => (server.get("appointments", "other1") || {}).note === "minha edição offline", 4000), "e depois chega ao servidor");
    // só persiste o que mudou e continua funcionando em nova abertura
    const w2 = await openPage(dev, server);
    ok(!!w2.DB.get("appointments", "mine1") && !!w2.DB.get("appointments", "other1"), "nova abertura enxerga tudo");
  }

  // ---------- 14. Foto do ponto já carregada não é descartada pela atualização ao vivo ----------
  {
    const server = makeServer(); seed(server);
    const dev = makeDevice();
    const w = await openPage(dev, server); await wait(80);
    const k = w.DB.get("timeClockEntries", "k1");
    k.selfieDataUrl = "data:image/jpeg;base64,AAAA"; // como se a foto já tivesse sido aberta na tela
    server.put("timeClockEntries", { id: "k1", employeeId: "e1", selfieDataUrl: "data:image/jpeg;base64,AAAA" });
    let ch = await w.DB.refresh(["timeClockEntries"], { withCount: false });
    ok(ch.length === 0, "foto já carregada + servidor igual: não conta como mudança (" + JSON.stringify(ch) + ")");
    ok(w.DB.get("timeClockEntries", "k1").selfieDataUrl === "data:image/jpeg;base64,AAAA", "a foto continua no cache (não baixa de novo)");
    server.put("timeClockEntries", { id: "k1", employeeId: "e1", reviewed: true, selfieDataUrl: "data:image/jpeg;base64,AAAA" });
    ch = await w.DB.refresh(["timeClockEntries"], { withCount: false });
    ok(ch.indexOf("timeClockEntries") !== -1 && w.DB.get("timeClockEntries", "k1").reviewed === true, "edição real (revisado) é percebida");
    ok(w.DB.get("timeClockEntries", "k1").selfieDataUrl === "data:image/jpeg;base64,AAAA", "e a foto já carregada é preservada");
  }

  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
