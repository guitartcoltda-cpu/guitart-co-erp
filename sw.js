/* ============================================================
   Guitart & Co. — Service Worker (app instalável / abertura rápida)

   O que faz:
   - Guarda uma cópia das telas, scripts, estilos, bibliotecas e imagens do
     PRÓPRIO sistema para o app abrir rápido e continuar abrindo mesmo sem
     internet (os DADOS continuam vindo do banco e do espelho local do db.js).
   - Código (html/js/css/json): "rede primeiro" — sempre tenta a versão mais
     nova do site e só usa a cópia guardada se a rede falhar ou demorar mais
     de 4 s. Assim uma atualização publicada chega logo e telas/scripts de
     versões diferentes não se misturam.
   - Bibliotecas, fontes e imagens: "cópia primeiro" (quase nunca mudam).

   O que NUNCA faz: não intercepta nada que não seja do próprio site —
   chamadas ao banco de dados (Supabase), e-mail, fontes do Google etc. passam
   direto, sem cache. Nenhum dado de cliente/financeiro é guardado aqui, só
   arquivos do sistema. Não toca em gravações (só responde a GET).
   ============================================================ */
"use strict";

var CACHE = "guitart-app-v1";
var NET_TIMEOUT_MS = 4000;

// "Casca" do app: baixada na instalação para abrir offline.
var PRECACHE = [
  "./", "./index.html", "./login.html", "./agenda.html", "./clientes.html", "./financeiro.html",
  "./contas-pagar.html", "./comissoes.html", "./extrato-comissao.html", "./folha-pagamento.html",
  "./dre.html", "./conciliacao.html", "./maquininhas.html", "./funcionarios.html", "./estoque.html",
  "./relatorio-vendas.html", "./alertas.html", "./chamados.html", "./notificacoes.html",
  "./ponto.html", "./ponto-gestao.html", "./configuracoes.html", "./instalar.html",
  "./manifest.webmanifest",
  "./assets/css/style.css",
  "./assets/img/logo-guitart.png", "./assets/img/icon-192.png", "./assets/img/apple-touch-icon.png",
  "./assets/vendor/fontawesome.min.css", "./assets/vendor/fa-solid-900.woff2", "./assets/vendor/fa-regular-400.woff2",
  "./assets/vendor/fa-brands-400.woff2", "./assets/vendor/fa-v4compatibility.woff2",
  "./assets/vendor/supabase.js", "./assets/vendor/emailjs.min.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // um arquivo que falhe não impede a instalação dos demais
      return Promise.all(PRECACHE.map(function (u) {
        return cache.add(new Request(u, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE && /^guitart-app-/.test(k); })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isCode(url) {
  return /\.(html|js|css|json|webmanifest)$/i.test(url.pathname) || /\/$/.test(url.pathname);
}

function putInCache(request, response) {
  if (!response || response.status !== 200 || response.type !== "basic") return;
  var copy = response.clone();
  caches.open(CACHE).then(function (c) { c.put(request, copy); }).catch(function () {});
}

function networkFirst(request, fallbackUrl) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      // rede lenta: usa a cópia guardada, se existir; senão continua esperando a rede
      caches.match(request, { ignoreSearch: true }).then(function (hit) {
        if (hit && !settled) { settled = true; resolve(hit); }
      });
    }, NET_TIMEOUT_MS);
    fetch(request).then(function (res) {
      clearTimeout(timer);
      putInCache(request, res);
      if (!settled) { settled = true; resolve(res); }
    }, function () {
      clearTimeout(timer);
      if (settled) return;
      caches.match(request, { ignoreSearch: true }).then(function (hit) {
        return hit || (fallbackUrl ? caches.match(fallbackUrl) : null);
      }).then(function (hit) {
        settled = true;
        resolve(hit || Response.error());
      });
    });
  });
}

function cacheFirst(request) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (res) { putInCache(request, res); return res; });
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // banco de dados, e-mail, fontes: passam direto
  if (req.headers.has("range")) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, "./login.html"));
    return;
  }
  if (isCode(url)) { event.respondWith(networkFirst(req, null)); return; }
  event.respondWith(cacheFirst(req));
});

// permite que a página peça a ativação imediata de uma versão nova
self.addEventListener("message", function (event) {
  if (event.data === "skipWaiting") self.skipWaiting();
});
