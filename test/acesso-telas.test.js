/* Teste — usuário com telas limitadas nunca fica numa tela não liberada (mesmo sem rede). Uso: node test/acesso-telas.test.js */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
console.log("=== Acesso por tela — guard de autenticação ===");
const src = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "auth.js"), "utf8");

function run(opts) {
  const store = {}; const ls = {};
  const calls = { replace: [] };
  const ctx = {
    console, setTimeout, Promise, JSON, Date, Array, Object, String, Number, Math, Error, RegExp,
    sessionStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    location: { pathname: opts.page, search: "", replace: u => calls.replace.push(u), reload() {} },
    addEventListener() {}
  };
  ctx.window = ctx;
  store.salao_erp_session = JSON.stringify(opts.session);
  ctx.DB = {
    ready: Promise.resolve(),
    get: (t, id) => (opts.dbUser ? opts.dbUser : null),
    hasRemote: () => true,
    lookupUser: () => Promise.resolve(opts.lookup || { status: "unknown", user: null })
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return new Promise(res => setTimeout(() => res({ calls, store, ctx }), 30));
}
const VIT = { id: "u1", firstName: "Vitória", lastName: "R", role: "Profissional" };

(async () => {
  // 1) rede ruim (cadastro não achado, servidor "unknown"): sessão com allowedPages barra o Dashboard
  let r = await run({ page: "index.html", session: Object.assign({ allowedPages: ["ponto.html", "extrato-comissao.html"] }, VIT) });
  ok(r.calls.replace[0] === "ponto.html", "sem rede: Dashboard redireciona para a 1ª tela liberada (" + r.calls.replace + ")");
  // 2) rede ruim, já na tela liberada: não redireciona
  r = await run({ page: "ponto.html", session: Object.assign({ allowedPages: ["ponto.html", "extrato-comissao.html"] }, VIT) });
  ok(r.calls.replace.length === 0, "sem rede: tela liberada abre normal");
  // 3) rede ruim, sessão antiga sem allowedPages (comportamento anterior preservado)
  r = await run({ page: "index.html", session: VIT });
  ok(r.calls.replace.length === 0, "sessão sem lista de telas continua como antes");
  // 4) cadastro presente: usa o cadastro e atualiza a sessão
  r = await run({ page: "agenda.html", session: VIT, dbUser: Object.assign({ active: true, allowedPages: ["ponto.html"] }, VIT) });
  ok(r.calls.replace[0] === "ponto.html", "com cadastro: tela não liberada redireciona");
  ok(JSON.parse(r.store.salao_erp_session).allowedPages[0] === "ponto.html", "sessão passa a guardar as telas liberadas");
  // 5) servidor confirma o usuário (lookup ok) com restrição
  r = await run({ page: "index.html", session: VIT, lookup: { status: "ok", user: Object.assign({ active: true, allowedPages: ["extrato-comissao.html"] }, VIT) } });
  ok(r.calls.replace[0] === "extrato-comissao.html", "lookup ok: redireciona para a tela liberada");
  // 6) acesso total (allowedPages null) segue livre
  r = await run({ page: "index.html", session: VIT, dbUser: Object.assign({ active: true, allowedPages: null }, VIT) });
  ok(r.calls.replace.length === 0, "acesso total segue livre");
  // 7) sem nenhuma tela: volta ao login
  r = await run({ page: "index.html", session: Object.assign({ allowedPages: [] }, VIT) });
  ok(r.calls.replace[0] === "login.html", "sem nenhuma tela liberada: volta ao login");
  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})();
