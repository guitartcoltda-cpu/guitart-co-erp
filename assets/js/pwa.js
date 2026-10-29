/* ============================================================
   Guitart & Co. — App instalável (PWA)
   - Registra o service worker (sw.js) para o sistema abrir rápido e
     continuar abrindo sem internet.
   - Mostra o botão "Instalar app" (topo da tela / tela de login):
       • Android e computador (Chrome/Edge): abre a janela de instalação.
       • iPhone/iPad (Safari): não existe instalação por botão no iOS —
         o botão mostra o passo a passo (Compartilhar → Adicionar à Tela de Início).
       • Já instalado (aberto como app) ou navegador sem suporte: o botão não aparece.
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

  // iOS só instala pelo Safari (Chrome/Firefox no iPhone não têm a opção)
  function isIOSSafari() {
    var ua = (global.navigator && global.navigator.userAgent) || "";
    return isIOS() && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  }

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
    return !!deferredPrompt || isIOSSafari();
  }

  function showIOSHelp() {
    var body =
      '<p>No iPhone/iPad a instalação é feita pelo próprio Safari:</p>' +
      '<ol style="padding-left:20px;line-height:1.8;">' +
        '<li>Toque no botão <strong>Compartilhar</strong> <i class="fa-solid fa-arrow-up-from-bracket"></i> (barra inferior do Safari).</li>' +
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
    if (isIOSSafari()) showIOSHelp();
  }

  function refreshButtons() {
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
