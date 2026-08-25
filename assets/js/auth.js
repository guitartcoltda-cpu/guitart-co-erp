/* ============================================================
   Salão ERP — Autenticação (sessão local)
   Controle de acesso simples baseado nos usuários cadastrados em
   Configurações → Acessos. Isso NÃO é segurança real (é um app
   100% client-side, qualquer um com o DevTools aberto contorna),
   mas garante que toda ação do sistema fique corretamente
   atribuída a uma pessoa no Log de Atividade, e que os cadastros
   de acesso feitos em Configurações tenham efeito prático.
   ============================================================ */
(function (global) {
  "use strict";

  var SESSION_KEY = "salao_erp_session";

  // Bloqueia o "bfcache" do navegador (Back/Forward Cache): sem isso, ao
  // voltar para uma aba que ficou em segundo plano — muito comum no celular,
  // ao trocar de app e voltar, ou ao apertar "voltar" depois de sair — o
  // navegador pode reexibir a página exatamente como ficou congelada na
  // memória, com os dados/sessão de QUEM ESTAVA LOGADO ANTES, sem rodar o
  // JavaScript de novo. É esse o motivo mais provável do relato "depois de
  // entrar com um novo login preciso atualizar a página para funcionar":
  // um recarregamento forçado aqui garante que a página sempre reflete a
  // sessão/dados atuais assim que volta a ficar visível.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) location.reload();
  });

  var CurrentUser = {
    get: function () {
      try {
        var raw = sessionStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    set: function (user) {
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch (e) {}
    },
    logout: function () {
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    },
    isLoginPage: function () {
      return /login\.html/.test(location.pathname);
    },

    // ---- Per-screen access control (Configurações → Permissões) ----
    // A user record may carry `allowedPages`: an array of page filenames
    // (e.g. ["index.html", "agenda.html"]) it may open. Missing/null/not-an-
    // array means "no restriction set" → full access. This is the
    // backward-compatible default so any account saved before this feature
    // existed (and the seeded admin) is never silently locked out. An
    // explicit empty array means "no screens granted".
    // Always reads the live DB record (not the cached session object) so a
    // permission change made by an admin takes effect on this user's very
    // next navigation, without waiting for them to log out/in.
    canAccess: function (pageFile) {
      var session = this.get();
      if (!session) return false;
      var dbUser = global.DB ? DB.get("users", session.id) : null;
      var allowed = dbUser ? dbUser.allowedPages : session.allowedPages;
      if (!allowed || !Array.isArray(allowed)) return true;
      return allowed.indexOf(pageFile) !== -1;
    },

    // First page (in the order it was saved) this user is allowed to open,
    // or null if the user has no restriction (full access) or has been
    // granted zero screens.
    firstAllowedPage: function (dbUser) {
      var allowed = dbUser && Array.isArray(dbUser.allowedPages) ? dbUser.allowedPages : null;
      return allowed && allowed.length ? allowed[0] : null;
    }
  };

  // Guard: every page except login.html requires an active session. The
  // <head> of each page also has a tiny inline check that fires before the
  // page paints (avoids a flash of protected content); this one runs after
  // db.js loads and re-validates against the current user record, in case
  // the account was deactivated or edited elsewhere mid-session. It also
  // enforces per-screen permissions (allowedPages) — this runs synchronously
  // as soon as auth.js loads, before layout.js or the page's own script run,
  // so a disallowed page redirects away before rendering any content (same
  // "convenience, not real security" spirit documented in LEIA-ME.md — a
  // user with DevTools open can always bypass this).
  if (!CurrentUser.isLoginPage()) {
    // Aguarda o cache do DB estar pronto (instantâneo em modo offline; em
    // modo online, aguarda a primeira busca no Supabase) antes de revalidar
    // a sessão — evita reprovar por engano um usuário válido só porque os
    // dados ainda não chegaram do servidor neste carregamento de página.
    // Isso não reintroduz o "flash" de conteúdo protegido que esse guard
    // evita: layout.js e o script de cada tela também só desenham algo na
    // tela depois de DB.ready, então nada aparece antes dessa checagem.
    (global.DB ? DB.ready : Promise.resolve()).then(function () {
      var session = CurrentUser.get();
      var dbUser = (session && global.DB) ? DB.get("users", session.id) : null;
      if (!session || !dbUser || !dbUser.active) {
        CurrentUser.logout();
        var here = location.pathname.split("/").pop() || "index.html";
        location.replace("login.html?redirect=" + encodeURIComponent(here));
      } else {
        if (session.role !== dbUser.role || session.firstName !== dbUser.firstName || session.lastName !== dbUser.lastName) {
          // keep session display fields fresh if an admin edited this user
          session.role = dbUser.role; session.firstName = dbUser.firstName; session.lastName = dbUser.lastName;
          CurrentUser.set(session);
        }
        var hereFile = location.pathname.split("/").pop() || "index.html";
        if (!CurrentUser.canAccess(hereFile)) {
          var target = CurrentUser.firstAllowedPage(dbUser);
          if (target && target !== hereFile) {
            location.replace(target);
          } else {
            // No allowed screen at all (admin unchecked everything for this
            // user) — nothing safe to redirect to, so send them back to the
            // login screen rather than risk a redirect loop.
            CurrentUser.logout();
            location.replace("login.html");
          }
        }
      }
    });
  }

  global.CurrentUser = CurrentUser;
})(window);
