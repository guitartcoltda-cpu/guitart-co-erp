/* ============================================================
   Guitart & Co. — App instalável (PWA)
   - Registra o service worker (sw.js) para o sistema abrir rápido e
     continuar abrindo sem internet.
   - Mostra o botão "Instalar app" (topo da tela / tela de login):
       • Android e computador (Chrome/Edge): abre a janela de instalação.
       • iPhone/iPad (Safari ou Chrome): não existe instalação por botão no iOS —
         o botão mostra o passo a passo (Compartilhar → Adicionar à Tela de Início).
       • Já instalado (aberto como app) ou navegador sem suporte: o botão não aparece.
   - Tela "Instalar App" (instalar.html, no menu para todos os perfis): cartão fixo
     "Instalar o app no celular" (div#pwa-install-card), fácil de achar no celular. Some quando o app já está instalado; se o navegador não oferecer a
     instalação por botão, mostra o passo a passo do aparelho.
   Não lê nem grava nenhum dado do sistema.
   ============================================================ */
(function (global) {
  "use strict";

  var deferredPrompt = null;

  function isStandalone() {
    try {
      if (global.matchMedia && (global.matchMedia("(display-mode: standalone)").matches || global.matchMedia("(display-mode: window-controls-overlay)").matches)) return true;
    } catch (e) {}
    return !!(global.navigator && global.navigator.standalone);
  }

  function isIOS() {
    var ua = (global.navigator && global.navigator.userAgent) || "";
    var iPadOS = /Macintosh/.test(ua) && global.navigator.maxTouchPoints > 1;
    return /iPhone|iPad|iPod/.test(ua) || iPadOS;
  }

  // iPhone/iPad: Safari e Chrome permitem "Adicionar à Tela de Início" (o Chrome
  // ganhou isso no iOS 16.4+). Navegadores embutidos (Instagram, Facebook, app do
  // Google etc.) e outros não oferecem — nesses o botão não aparece.
  function isIOSChrome() {
    var ua = (global.navigator && global.navigator.userAgent) || "";
    return isIOS() && /CriOS/.test(ua) && !/GSA\/|FBAN|FBAV|Instagram/.test(ua);
  }
  function isIOSSafari() {
    var ua = (global.navigator && global.navigator.userAgent) || "";
    return isIOS() && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram/.test(ua);
  }
  function canInstallOnIOS() { return isIOSSafari() || isIOSChrome(); }

  // ---------- service worker ----------
  function registerSW() {
    if (!("serviceWorker" in global.navigator)) return;
    if (!/^https:$|^http:$/.test(global.location.protocol)) return;
    if (global.location.protocol === "http:" && !/^(localhost|127\.0\.0\.1)$/.test(global.location.hostname)) return;
    global.addEventListener("load", function () {
      global.navigator.serviceWorker.register("sw.js").catch(function (e) {
        if (global.console) console.warn("Service worker não registrado:", e && e.message);
      });
    });
  }

  // ---------- botão "Instalar app" ----------
  function canOfferInstall() {
    if (isStandalone()) return false;
    return !!deferredPrompt || canInstallOnIOS();
  }

  function showIOSHelp() {
    var chrome = isIOSChrome();
    var body =
      '<p>No iPhone/iPad a instalação é feita pelo botão de compartilhar do próprio navegador:</p>' +
      '<ol style="padding-left:20px;line-height:1.8;">' +
        (chrome
          ? '<li>Toque no botão <strong>Compartilhar</strong> <i class="fa-solid fa-arrow-up-from-bracket"></i> (no Chrome, fica na <strong>barra de endereço</strong>, no canto direito).</li>'
          : '<li>Toque no botão <strong>Compartilhar</strong> <i class="fa-solid fa-arrow-up-from-bracket"></i> (barra inferior do Safari).</li>') +
        '<li>Role e toque em <strong>Adicionar à Tela de Início</strong>.</li>' +
        '<li>Toque em <strong>Adicionar</strong>. O ícone Guitart &amp; Co. aparece na tela do aparelho.</li>' +
      '</ol>' +
      '<p class="small text-muted">Dica: ao entrar no app, marque "Manter conectado neste aparelho".</p>';
    if (global.Modal && global.Modal.open) {
      global.Modal.open({ title: "Instalar o app no iPhone", bodyHtml: body, footHtml: '<button class="btn btn-primary" data-close-modal>Entendi</button>' });
    } else {
      global.alert("Para instalar: toque em Compartilhar e depois em \"Adicionar à Tela de Início\".");
    }
  }

  function showGenericHelp() {
    var ua = (global.navigator && global.navigator.userAgent) || "";
    var embedded = /GSA\/|FBAN|FBAV|Instagram|Line\/|MicroMessenger|wv\)/.test(ua);
    var body;
    if (isIOS()) {
      body =
        '<p>No iPhone/iPad a instalação só funciona pelo <strong>Safari</strong> (ou Chrome atualizado). Este navegador não oferece a opção.</p>' +
        '<ol style="padding-left:20px;line-height:1.8;">' +
          '<li>Abra este mesmo endereço no <strong>Safari</strong>.</li>' +
          '<li>Toque em <strong>Compartilhar</strong> <i class="fa-solid fa-arrow-up-from-bracket"></i> (barra inferior).</li>' +
          '<li>Toque em <strong>Adicionar à Tela de Início</strong> e depois em <strong>Adicionar</strong>.</li>' +
        '</ol>';
    } else {
      body =
        (embedded ? '<p>Você está num navegador embutido (Instagram, WhatsApp, Google etc.). Abra este endereço no <strong>Chrome</strong> e siga os passos abaixo.</p>' : '') +
        '<p>No Android (Chrome):</p>' +
        '<ol style="padding-left:20px;line-height:1.8;">' +
          '<li>Toque no menu <strong>&#8942;</strong> (três pontinhos, canto superior direito).</li>' +
          '<li>Toque em <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).</li>' +
          '<li>Confirme em <strong>Instalar</strong>. O ícone Guitart &amp; Co. aparece na tela do aparelho.</li>' +
        '</ol>' +
        '<p class="small text-muted">Se o app já estiver instalado, abra pelo ícone da tela inicial — este aviso some sozinho.</p>';
    }
    if (global.Modal && global.Modal.open) {
      global.Modal.open({ title: "Instalar o app no aparelho", bodyHtml: body, footHtml: '<button class="btn btn-primary" data-close-modal>Entendi</button>' });
    } else {
      global.alert("Para instalar: use o menu do navegador e escolha \"Instalar app\" ou \"Adicionar à tela inicial\".");
    }
  }

  function onCardInstallClick() {
    if (deferredPrompt || canInstallOnIOS()) onInstallClick();
    else showGenericHelp();
  }

  function onInstallClick() {
    if (deferredPrompt) {
      var p = deferredPrompt;
      deferredPrompt = null;
      try {
        p.prompt();
        Promise.resolve(p.userChoice).then(function () { refreshButtons(); }, function () { refreshButtons(); });
      } catch (e) { refreshButtons(); }
      return;
    }
    if (canInstallOnIOS()) showIOSHelp();
  }

  // Cartão fixo em Configurações (div#pwa-install-card): sempre visível, exceto com o app já instalado.
  function refreshCard() {
    var host = document.getElementById("pwa-install-card");
    if (!host) return;
    if (isStandalone()) { host.innerHTML = ""; host.style.display = "none"; return; }
    host.style.display = "";
    host.setAttribute("data-offline-ok", "");   // instalar não grava dados: não entra na trava offline
    if (host.querySelector(".pwa-card-btn")) return;
    host.innerHTML =
      '<div class="card mb-16"><div class="card-body" style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;">' +
        '<div style="flex:1 1 220px;min-width:0;">' +
          '<h3 style="margin:0 0 4px;"><i class="fa-solid fa-mobile-screen-button"></i> Instalar o app no celular</h3>' +
          '<p class="small text-muted" style="margin:0;">Coloca o ícone do Guitart &amp; Co. na tela do aparelho e abre em tela cheia, como um aplicativo.</p>' +
        '</div>' +
        '<button type="button" class="btn btn-primary pwa-card-btn" style="flex:1 1 180px;"><i class="fa-solid fa-download"></i> Instalar app</button>' +
      '</div></div>';
    host.querySelector(".pwa-card-btn").addEventListener("click", onCardInstallClick);
  }

  function refreshButtons() {
    refreshCard();
    var slots = document.querySelectorAll("[data-pwa-install-slot]");
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var btn = slot.querySelector(".pwa-install-btn");
      if (!canOfferInstall()) { if (btn) btn.parentNode.removeChild(btn); continue; }
      if (btn) continue;
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = slot.getAttribute("data-pwa-install-slot") === "login" ? "btn btn-secondary pwa-install-btn" : "btn btn-outline btn-sm pwa-install-btn";
      btn.setAttribute("title", "Instalar o app no aparelho");
      btn.innerHTML = '<i class="fa-solid fa-download"></i> <span>Instalar app</span>';
      if (slot.getAttribute("data-pwa-install-slot") === "login") btn.style.cssText = "width:100%;";
      btn.addEventListener("click", onInstallClick);
      slot.appendChild(btn);
    }
  }

  global.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();          // guarda o aviso para abrir só quando a pessoa tocar no botão
    deferredPrompt = e;
    refreshButtons();
  });
  global.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    refreshButtons();
    if (global.Toast && global.Toast.show) global.Toast.show("App instalado!", "success");
  });

  // O topo da tela é desenhado por layout.js depois do carregamento: procura o
  // espaço do botão por alguns segundos.
  var tries = 0;
  var timer = setInterval(function () {
    refreshButtons();
    if (++tries > 40) clearInterval(timer);
  }, 500);
  document.addEventListener("DOMContentLoaded", refreshButtons);

  registerSW();

  global.PWA = { refresh: refreshButtons, isStandalone: isStandalone };
})(window);
