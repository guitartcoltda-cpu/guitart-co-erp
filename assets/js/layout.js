/* ============================================================
   Salão ERP — Layout (sidebar + topbar compartilhados)
   ============================================================ */

(function (global) {
  "use strict";

  var NAV = [
    { section: "Visão Geral" },
    { page: "dashboard", href: "index.html", icon: "fa-gauge-high", label: "Dashboard" },
    { page: "agenda", href: "agenda.html", icon: "fa-calendar-days", label: "Agenda" },
    { page: "alertas", href: "alertas.html", icon: "fa-bell", label: "Central de Alertas" },
    { page: "notificacoes", href: "notificacoes.html", icon: "fa-comment-sms", label: "Notificações WhatsApp" },
    { section: "Cadastros" },
    { page: "clientes", href: "clientes.html", icon: "fa-users", label: "Clientes" },
    { page: "funcionarios", href: "funcionarios.html", icon: "fa-id-badge", label: "Funcionários" },
    { page: "comissoes", href: "comissoes.html", icon: "fa-percent", label: "Comissionamento" },
    { page: "extrato-comissao", href: "extrato-comissao.html", icon: "fa-file-invoice", label: "Extrato do Profissional" },
    { section: "Financeiro" },
    { page: "financeiro", href: "financeiro.html", icon: "fa-file-invoice-dollar", label: "Lançamentos" },
    { page: "contas-pagar", href: "contas-pagar.html", icon: "fa-money-check-dollar", label: "Contas a Pagar" },
    { page: "maquininhas", href: "maquininhas.html", icon: "fa-credit-card", label: "Maquininhas" },
    { page: "relatorio-vendas", href: "relatorio-vendas.html", icon: "fa-chart-column", label: "Relatório de Vendas" },
    { page: "conciliacao", href: "conciliacao.html", icon: "fa-building-columns", label: "Conciliação Bancária" },
    { page: "dre", href: "dre.html", icon: "fa-chart-line", label: "Fluxo de Caixa / DRE" },
    { section: "Operações" },
    { page: "estoque", href: "estoque.html", icon: "fa-boxes-stacked", label: "Estoque" },
    { section: "Sistema" },
    { page: "chamados", href: "chamados.html", icon: "fa-headset", label: "Chamados" },
    { page: "configuracoes", href: "configuracoes.html", icon: "fa-gear", label: "Configurações" }
  ];

  // Returns NAV filtered down to the entries the current user is allowed to
  // see (per CurrentUser.canAccess, see auth.js), dropping any section
  // label left with no visible items underneath it. If there's no
  // CurrentUser available (shouldn't happen on a protected page, but keep
  // this defensive), everything is shown — matching the "missing data =
  // full access" convention used everywhere else for this feature.
  function visibleNav() {
    var cu = global.CurrentUser;
    var filtered = NAV.filter(function (item) {
      if (item.section) return true;
      return !cu || cu.canAccess(item.href);
    });
    var result = [];
    for (var i = 0; i < filtered.length; i++) {
      var item = filtered[i];
      if (item.section) {
        var hasVisibleChild = filtered[i + 1] && !filtered[i + 1].section;
        if (hasVisibleChild) result.push(item);
      } else {
        result.push(item);
      }
    }
    return result;
  }

  function buildSidebar(activePage) {
    var brandHtml =
      '<div class="sidebar-brand sidebar-brand-logo">' +
        '<img src="assets/img/logo-guitart.png" alt="Guitart & Co." class="brand-logo-img">' +
      '</div>';

    var navHtml = '<ul class="sidebar-nav" style="list-style:none;">';
    visibleNav().forEach(function (item) {
      if (item.section) {
        navHtml += '<li class="sidebar-section-label">' + item.section + '</li>';
      } else {
        var active = item.page === activePage ? " active" : "";
        navHtml += '<li><a href="' + item.href + '" class="' + active.trim() + '" title="' + item.label + '">' +
          '<span class="nav-icon"><i class="fa-solid ' + item.icon + '"></i></span>' +
          '<span>' + item.label + '</span></a></li>';
      }
    });
    navHtml += '</ul>';

    // A pedido do cliente, o rodapé do menu não exibe mais nenhum aviso de
    // ambiente (nem "produção", nem "offline/fictício") — deixa o sistema
    // com cara de produto acabado, não de protótipo.
    var footHtml = "";

    var collapseToggleHtml = '<button type="button" class="sidebar-collapse-toggle" id="sidebar-collapse-toggle" title="Recolher/expandir menu"><i class="fa-solid fa-chevron-left"></i></button>';

    return '<aside class="sidebar" id="app-sidebar">' + collapseToggleHtml + brandHtml + navHtml + footHtml + '</aside>';
  }

  function buildTopbar(meta) {
    var today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    var user = global.CurrentUser ? global.CurrentUser.get() : null;
    var displayName = user ? (user.firstName + " " + user.lastName) : "Visitante";
    var displayRole = user ? user.role : "";
    var initials = user && global.Utils ? Utils.initials(displayName) : "?";
    return (
      '<header class="topbar">' +
        '<div class="flex items-center gap-10">' +
          '<button class="btn btn-icon btn-ghost" id="mobile-nav-toggle" style="display:none;"><i class="fa-solid fa-bars"></i></button>' +
          '<div><h1>' + (meta.title || "") + '</h1>' +
          '<div class="topbar-sub">' + (meta.subtitle || today) + '</div></div>' +
        '</div>' +
        '<div class="topbar-right">' +
          '<div id="approvals-badge-slot"></div>' +
          '<div class="topbar-user">' +
            '<div class="avatar">' + initials + '</div>' +
            '<div><div class="u-name">' + (global.Utils ? Utils.escapeHtml(displayName) : displayName) + '</div><div class="u-role">' + (global.Utils ? Utils.escapeHtml(displayRole) : displayRole) + '</div></div>' +
          '</div>' +
          '<button class="btn btn-icon btn-ghost" id="btn-logout" title="Sair"><i class="fa-solid fa-right-from-bracket"></i></button>' +
        '</div>' +
      '</header>'
    );
  }

  function render() {
    var body = document.body;
    var activePage = body.getAttribute("data-page") || "";
    var meta = global.PAGE_META || {};

    var sidebarPh = document.getElementById("sidebar-placeholder");
    var topbarPh = document.getElementById("topbar-placeholder");
    if (sidebarPh) sidebarPh.outerHTML = buildSidebar(activePage);
    if (topbarPh) topbarPh.outerHTML = buildTopbar(meta);

    if (global.Approvals) global.Approvals.renderBadge(document.getElementById("approvals-badge-slot"));

    // Geração automática das notificações (lembrete de véspera a partir das
    // 17h, e alerta de cliente ausente) roda em toda página do sistema, não
    // só quando alguém abre a tela de Notificações — é o mais perto que dá
    // de "automático" sem um servidor rodando com o navegador fechado. A
    // tela de Notificações WhatsApp só passa a acompanhar o que já foi
    // gerado (ver notificacoes-page.js).
    if (global.Notificacoes) global.Notificacoes.syncAll();

    var logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        var user = global.CurrentUser ? global.CurrentUser.get() : null;
        if (user && global.DB && DB.log) DB.log("Acesso", user.firstName + " " + user.lastName + " saiu do sistema");
        if (global.CurrentUser) global.CurrentUser.logout();
        location.href = "login.html";
      });
    }

    // Backdrop escurecido atrás do menu lateral quando aberto em telas
    // pequenas (formato mobile) — clicar nele fecha o menu, igual a
    // qualquer painel off-canvas.
    var backdrop = document.getElementById("sidebar-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "sidebar-backdrop";
      backdrop.className = "sidebar-backdrop";
      document.body.appendChild(backdrop);
    }
    function closeSidebar() {
      var sb = document.getElementById("app-sidebar");
      if (sb) sb.classList.remove("open");
      backdrop.classList.remove("open");
    }
    function openSidebar() {
      var sb = document.getElementById("app-sidebar");
      if (sb) sb.classList.add("open");
      backdrop.classList.add("open");
    }
    backdrop.addEventListener("click", closeSidebar);
    // Fecha o menu automaticamente ao navegar para outra tela pelo celular.
    Utils.qsa(".sidebar-nav a", document.getElementById("app-sidebar") || document).forEach(function (a) {
      a.addEventListener("click", closeSidebar);
    });

    // Menu lateral recolhível (desktop): lembra a preferência do usuário
    // neste navegador via localStorage, para o menu ficar do jeito que ele
    // deixou da última vez ("mostrar somente se quisermos").
    var COLLAPSE_KEY = "salao_erp_sidebar_collapsed";
    var collapseToggle = document.getElementById("sidebar-collapse-toggle");
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1") document.body.classList.add("sidebar-collapsed");
    } catch (e) {}
    if (collapseToggle) {
      collapseToggle.addEventListener("click", function () {
        var collapsed = document.body.classList.toggle("sidebar-collapsed");
        try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (e) {}
      });
    }

    var toggle = document.getElementById("mobile-nav-toggle");
    if (toggle) {
      var mq = window.matchMedia("(max-width: 900px)");
      function syncToggle() { toggle.style.display = mq.matches ? "inline-flex" : "none"; if (!mq.matches) closeSidebar(); }
      syncToggle();
      mq.addEventListener ? mq.addEventListener("change", syncToggle) : mq.addListener(syncToggle);
      toggle.addEventListener("click", function () {
        var sb = document.getElementById("app-sidebar");
        if (sb && sb.classList.contains("open")) closeSidebar(); else openSidebar();
      });
    }
  }

  function ensureSeed() {
    if (!global.Seed) return;
    // Em modo online (Supabase), o banco é compartilhado por todo mundo —
    // nunca gera dados fictícios/reseta automaticamente aqui, senão o
    // primeiro aparelho novo a abrir o sistema apagaria os dados reais de
    // todo mundo.
    if (DB.ONLINE_MODE) return;
    var seeded = DB.getSeedVersion();
    if (seeded !== DB.CURRENT_SEED_VERSION) {
      global.Seed.run();
      DB.setSeedVersion();
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    // If this page is about to be redirected to login.html (see the inline
    // guard script in <head> and assets/js/auth.js), skip seeding/rendering
    // entirely. Without this, a brief "flash" render on an unauthenticated
    // visit can race the redirect and trigger the one-time seed here before
    // the user even reaches the login screen — harmless on its own, but any
    // work done during that flash (like activity-log writes right after
    // login) could get shadowed by it. Simplest fix: do nothing on a page
    // we're about to leave anyway.
    if (global.CurrentUser && !global.CurrentUser.isLoginPage() && !global.CurrentUser.get()) return;
    DB.ready.then(function () {
      ensureSeed();
      render();
    });
  });

  global.AppLayout = { render: render, NAV: NAV };
})(window);
