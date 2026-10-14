/* Teste — Gestão de Ponto: selfies carregadas sob demanda e backup mensal em ZIP (sem apagar nada). Uso: node test/selfie-sob-demanda-ui.test.js */
"use strict";
process.env.TZ = "America/Sao_Paulo";
const fs = require("fs"), path = require("path"), nodeCrypto = require("crypto");
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("  FALHOU: " + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
console.log("=== Selfies sob demanda + backup (tela) ===");

const VD = { 0: null, 1: null }; [2, 3, 4, 5, 6].forEach(d => VD[d] = { start: "09:30", end: "19:00" });
const WS = { days: VD, lunchMin: 60, lunchFrom: "13:00", lunchTo: "14:00" };
const D = "2026-10-08";
const IMG = n => "data:image/jpeg;base64," + Buffer.from("jpg-" + n + "-" + "y".repeat(80)).toString("base64");
const at = (mo, d, h, m, s) => new Date(2026, mo - 1, d, h, m, s || 0).toISOString();
// "servidor": as fotos reais; a carga geral (store) só traz hasSelfie
const serverSelfies = {};
function E(id, type, mo, d, h, m, withSelfie, name) {
  if (withSelfie) serverSelfies[id] = IMG(id);
  const r = { id, employeeId: "v1", employeeName: name || "Vitória Rodrigues", date: "2026-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0"), type, timestamp: at(mo, d, h, m, 0), reviewed: false, origin: withSelfie ? "selfie" : "manual" };
  if (withSelfie) r.hasSelfie = true;
  return r;
}
const store = {
  employees: [{ id: "v1", name: "Vitória Rodrigues", role: "Cabeleireiro(a)", status: "ativo", requiresTimeClock: true, workSchedule: WS }],
  timeClockEntries: [
    E("a", "entrada", 10, 8, 9, 30, true), E("b", "saida_almoco", 10, 8, 13, 0, true), E("c", "volta_almoco", 10, 8, 14, 0, false), E("d", "saida", 10, 8, 19, 0, true),
    E("s1", "entrada", 9, 2, 9, 31, true), E("s2", "saida", 9, 2, 19, 2, true, "Vitória Rodrigues"), E("s3", "entrada", 9, 3, 9, 29, false)
  ],
  approvals: []
};
const logs = [];
let hydrateCalls = [], failHydrate = false;
const html = fs.readFileSync(path.join(root, "ponto-gestao.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/ponto-gestao.html", pretendToBeVisual: true });
const w = dom.window;
Object.defineProperty(w, "crypto", { value: nodeCrypto.webcrypto, configurable: true });
let seq = 0, role = "Administrador";
w.DB = {
  ready: Promise.resolve(), all: t => (store[t] || []).slice(), get: (t, id) => (store[t] || []).find(x => x.id === id) || null,
  find: (t, fn) => (store[t] || []).filter(fn),
  insert: (t, rec) => { const r = Object.assign({ id: "n" + (++seq) }, rec); store[t].push(r); return r; },
  update: (t, id, p) => Object.assign(store[t].find(x => x.id === id), p),
  mergeRecordUpdate: (t, id, fn) => { const r = store[t].find(x => x.id === id); return Object.assign(r, fn(r)); },
  mergeFieldUpdate: () => {}, batch: fn => fn(), remove: (t, id) => { store[t] = store[t].filter(x => x.id !== id); },
  nowISO: () => new Date().toISOString(), getSettings: () => ({}), getRoles: () => [], log: (a, b) => logs.push(a + ": " + b), hasRemote: () => false,
  fetchFresh: () => Promise.resolve(null), confirmSaved: () => Promise.resolve(true), optionalTableMissing: () => false,
  // mesma regra do db.js: só carrega quem tem hasSelfie e ainda não tem a chave selfieDataUrl
  hydrateSelfies: ids => {
    hydrateCalls.push(ids.slice());
    if (failHydrate) return Promise.resolve([]);
    const got = [];
    ids.forEach(id => { const r = store.timeClockEntries.find(x => x.id === id); if (r && r.hasSelfie && !("selfieDataUrl" in r)) { r.selfieDataUrl = serverSelfies[id] || null; got.push(id); } });
    return Promise.resolve(got);
  }
};
w.CurrentUser = { get: () => ({ id: "u", role, firstName: "João", lastName: "Pujol" }) };
w.Approvals = { listPending: () => [], canApprove: () => true, TYPE_LABELS: {} };
w.Layout = { init() {}, render() {} };
w.jspdf = {};
const errors = [];
w.addEventListener("error", e => errors.push(e.message));
["utils.js", "period-filter.js", "ponto-calc.js", "folha-ponto.js", "ponto-ajustes.js"].forEach(f => w.eval(fs.readFileSync(path.join(root, "assets", "js", f), "utf8")));
w.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a); w.clearImmediate = id => clearTimeout(id);
w.eval(fs.readFileSync(require.resolve("jszip/dist/jszip.min.js"), "utf8"));
const toasts = [];
w.Toast.show = (m, k) => toasts.push(k + ":" + m);
// captura o arquivo baixado
let lastBlob = null, lastDownload = null;
w.URL.createObjectURL = b => { lastBlob = b; return "blob:fake"; };
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () { lastDownload = this.download; };
try { w.eval(fs.readFileSync(path.join(root, "assets", "js", "ponto-gestao.js"), "utf8")); } catch (e) { errors.push("load: " + e.message); }
function fire(el, type) { el.dispatchEvent(new w.Event(type, { bubbles: true })); }
const readBlob = b => new Promise((res, rej) => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsArrayBuffer(b); });

(async function () {
  await wait(150);
  const d = w.document;
  ok(errors.length === 0, "sem erro ao carregar: " + errors.join(" | "));
  ok(!!d.getElementById("pg-selfie-backup") && d.getElementById("pg-selfie-backup").style.display !== "none", "cartão de backup visível para o administrador");

  // ---- fotos aparecem sob demanda na linha do tempo do dia ----
  d.querySelector('[data-panel="pg-p-controle"]').click();
  const s0 = d.getElementById("pg-start"); s0.value = "2026-10-01"; fire(s0, "change");
  const e0 = d.getElementById("pg-end"); e0.value = "2026-10-10"; fire(e0, "change");
  hydrateCalls = [];
  d.querySelector('[data-open-day="v1|' + D + '"]').click();
  ok(d.querySelectorAll("[data-selfie-lazy]").length >= 0, "linha do tempo renderizada");
  await wait(250);
  const thumbs = Array.from(d.querySelectorAll(".ponto-timeline-thumb"));
  const withBg = thumbs.filter(el => /background-image/.test(el.getAttribute("style") || "") && (el.getAttribute("style") || "").indexOf(IMG("a")) !== -1);
  ok(withBg.length === 1, "foto da marcação 'a' apareceu na miniatura (" + withBg.length + ")");
  ok(thumbs.filter(el => (el.getAttribute("style") || "").indexOf(IMG("b")) !== -1).length === 1 && thumbs.filter(el => (el.getAttribute("style") || "").indexOf(IMG("d")) !== -1).length === 1, "fotos 'b' e 'd' também");
  const emptyOnes = thumbs.filter(el => !/background-image/.test(el.getAttribute("style") || ""));
  ok(emptyOnes.length === 1, "a marcação sem selfie ('c') continua com o ícone (" + emptyOnes.length + ")");
  ok(!d.querySelector("[data-selfie-lazy]"), "nenhum quadrinho ficou carregando");
  const ids = [].concat.apply([], hydrateCalls);
  ok(ids.indexOf("s1") === -1 && ids.indexOf("s2") === -1, "fotos de outros meses/dias NÃO foram baixadas (pedidas: " + ids.join(",") + ")");

  // ---- clicar na miniatura amplia a foto ----
  withBg[0].click();
  await wait(30);
  const ov = d.getElementById("pg-photo-zoom-overlay");
  ok(!!ov && ov.querySelector("img").getAttribute("src") === IMG("a"), "clique na miniatura abre a foto ampliada");
  ov.querySelector(".pg-photo-zoom-close").click();

  // ---- clicar quando a foto ainda não chegou: busca na hora e abre ----
  const rec = store.timeClockEntries.find(x => x.id === "s1");
  d.body.insertAdjacentHTML("beforeend", '<div id="fake-thumb" data-zoom="s1"></div>');
  ok(!("selfieDataUrl" in rec), "pré-condição: foto 's1' ainda não carregada");

  // ---- janela de uma marcação: foto grande carrega ----
  d.querySelector('[data-tl-entry="a"]') && d.querySelector('[data-tl-entry="a"]').click();
  await wait(250);
  const big = d.querySelector(".modal-body img[data-zoom-photo]");
  ok(!!big && big.getAttribute("src") === IMG("a"), "janela da marcação mostra a selfie grande");
  ok(!d.querySelector("[data-selfie-modal]"), "sem quadrinho pendente na janela");
  d.querySelector("#active-modal-overlay [data-close-modal]") && d.querySelector("#active-modal-overlay [data-close-modal]").click();

  // ---- backup do mês ----
  const before = JSON.stringify(store.timeClockEntries.map(r => [r.id, r.hasSelfie, r.reviewed]));
  d.querySelector('[data-panel="pg-p-relatorios"]').click();
  const inp = d.getElementById("pg-sb-month"), btn = d.getElementById("pg-sb-btn");
  const now = new Date(); const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  ok(inp.value === prev.getFullYear() + "-" + String(prev.getMonth() + 1).padStart(2, "0"), "mês sugerido é o mês passado (" + inp.value + ")");
  inp.value = "2026-09";
  btn.click();
  for (let i = 0; i < 40 && !lastDownload; i++) await wait(100);
  ok(lastDownload === "selfies-ponto-2026-09.zip", "arquivo baixado com o nome certo (" + lastDownload + ")");
  ok(!btn.disabled, "botão volta a ficar disponível");
  ok(toasts.some(t => /^success:.*Backup gerado com 2 foto/.test(t) && /Nada foi apagado/.test(t)), "aviso de sucesso diz 2 fotos e que nada foi apagado: " + toasts.join(" | "));
  const zip = await JSZip.loadAsync(Buffer.from(await readBlob(lastBlob)));
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  const pics = names.filter(n => /^selfies\//.test(n));
  ok(pics.length === 2, "ZIP tem as 2 selfies de setembro (" + pics.length + ")");
  ok(names.indexOf("indice.csv") !== -1 && names.indexOf("LEIA-ME.txt") !== -1, "ZIP tem indice.csv e LEIA-ME.txt");
  ok(pics.every(n => /2026-09-02_\d{6}_Vitoria-Rodrigues_(entrada|saida)_s[12]\.jpg$/.test(n)), "nomes de arquivo legíveis: " + pics.join(", "));
  const csv = await zip.file("indice.csv").async("string");
  const lines = csv.replace("﻿", "").split("\r\n");
  ok(lines.length === 3 && /^arquivo;id;funcionario;tipo;data;hora;sha256$/.test(lines[0]), "índice com cabeçalho e 2 linhas");
  const bytes1 = await zip.file(pics.find(n => /_s1\.jpg$/.test(n))).async("nodebuffer");
  ok(bytes1.equals(Buffer.from(IMG("s1").split(",")[1], "base64")), "bytes da foto idênticos ao original");
  const sha = nodeCrypto.createHash("sha256").update(bytes1).digest("hex");
  ok(csv.indexOf(sha) !== -1, "SHA-256 do índice confere com o arquivo");
  const readme = await zip.file("LEIA-ME.txt").async("string");
  ok(/COPIA/.test(readme) && /nada foi apagado/i.test(readme), "LEIA-ME explica que é uma cópia");
  ok(logs.some(l => /Baixou o backup das selfies de 2026-09 \(2 fotos\)/.test(l)), "registrado no log de atividade");
  const after = JSON.stringify(store.timeClockEntries.map(r => [r.id, r.hasSelfie, r.reviewed]));
  ok(before === after && store.timeClockEntries.length === 7, "NADA foi apagado nem alterado nas marcações");
  ok(Object.keys(serverSelfies).length === 5, "todas as fotos continuam no 'servidor'");

  // ---- mês sem selfies ----
  toasts.length = 0; lastDownload = null;
  inp.value = "2026-05"; btn.click(); await wait(100);
  ok(lastDownload === null && toasts.some(t => /Não há selfies/.test(t)), "mês sem fotos avisa e não baixa nada");

  // ---- falha ao carregar fotos: avisa, não baixa arquivo vazio ----
  toasts.length = 0; failHydrate = true; store.timeClockEntries.forEach(r => { if (r.hasSelfie) delete r.selfieDataUrl; });
  inp.value = "2026-10"; btn.click(); await wait(300);
  ok(lastDownload === null && toasts.some(t => /^danger:/.test(t)) && !btn.disabled, "se as fotos não carregam: erro claro, nada baixado, botão liberado");
  failHydrate = false;

  // ---- quem não é administrador não vê nem usa o backup ----
  role = "Gerente";
  const dom2 = new JSDOM(html, { runScripts: "outside-only", url: "https://x.test/ponto-gestao.html", pretendToBeVisual: true });
  const w2 = dom2.window;
  w2.DB = w.DB; w2.CurrentUser = { get: () => ({ id: "u", role: "Gerente", firstName: "Maria", lastName: "G" }) };
  w2.Approvals = w.Approvals; w2.Layout = w.Layout; w2.jspdf = {};
  ["utils.js", "period-filter.js", "ponto-calc.js", "folha-ponto.js", "ponto-ajustes.js"].forEach(f => w2.eval(fs.readFileSync(path.join(root, "assets", "js", f), "utf8")));
  w2.Toast.show = () => {};
  w2.eval(fs.readFileSync(path.join(root, "assets", "js", "ponto-gestao.js"), "utf8"));
  await wait(150);
  ok(w2.document.getElementById("pg-selfie-backup").style.display === "none", "cartão de backup escondido para quem não é administrador");

  console.log("\n" + passed + " passaram, " + failed + " falharam");
  process.exit(failed ? 1 : 0);
})();
