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
    { page: "ponto", href: "ponto.html", icon: "fa-fingerprint", label: "Bater Ponto" },
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
    { page: "ponto-gestao", href: "ponto-gestao.html", icon: "fa-user-clock", label: "Gestão de Ponto" },
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
          '<div class="topbar-user-wrap">' +
            '<button type="button" class="topbar-user" id="topbar-user-btn" aria-haspopup="true" aria-expanded="false">' +
              '<div class="avatar">' + initials + '</div>' +
              '<div><div class="u-name">' + (global.Utils ? Utils.escapeHtml(displayName) : displayName) + '</div><div class="u-role">' + (global.Utils ? Utils.escapeHtml(displayRole) : displayRole) + '</div></div>' +
              '<i class="fa-solid fa-chevron-down topbar-user-caret"></i>' +
            '</button>' +
            '<div class="topbar-user-menu" id="topbar-user-menu" hidden>' +
              '<button type="button" class="topbar-user-menu-item" id="btn-change-password"><i class="fa-solid fa-key"></i> Alterar senha</button>' +
            '</div>' +
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
    if (global.Notificacoes) global.Notificacoes.syncThrottled();

    var logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        var user = global.CurrentUser ? global.CurrentUser.get() : null;
        if (user && global.DB && DB.log) DB.log("Acesso", user.firstName + " " + user.lastName + " saiu do sistema");
        if (global.CurrentUser) global.CurrentUser.logout();
        location.href = "login.html";
      });
    }

    // Menu "minha conta" (avatar/nome na topbar): independente de
    // permissões/cargo, todo usuário logado tem acesso a "Alterar senha"
    // por aqui — não faz parte das configurações administrativas do
    // sistema (ver configuracoes.js), é um dado pessoal da própria conta.
    var userMenuBtn = document.getElementById("topbar-user-btn");
    var userMenu = document.getElementById("topbar-user-menu");
    if (userMenuBtn && userMenu) {
      function closeUserMenu() {
        userMenu.hidden = true;
        userMenuBtn.setAttribute("aria-expanded", "false");
      }
      function openUserMenu() {
        userMenu.hidden = false;
        userMenuBtn.setAttribute("aria-expanded", "true");
      }
      userMenuBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (userMenu.hidden) openUserMenu(); else closeUserMenu();
      });
      document.addEventListener("click", function (e) {
        if (!userMenu.hidden && !userMenu.contains(e.target) && e.target !== userMenuBtn) closeUserMenu();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeUserMenu();
      });
      var changePassBtn = document.getElementById("btn-change-password");
      if (changePassBtn) {
        changePassBtn.addEventListener("click", function () {
          closeUserMenu();
          openChangePasswordModal();
        });
      }
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

    // Memória de rolagem do menu lateral: como o sistema é multi-página
    // (cada clique no menu recarrega a página inteira), a barra lateral é
    // reconstruída do zero a cada navegação e, sem isso, sempre "subia"
    // de volta para o topo mesmo que o usuário tivesse rolado para baixo
    // para ver itens como Estoque/Configurações antes de clicar. Guarda a
    // posição de rolagem em sessionStorage (dura a aba/sessão, não precisa
    // sobreviver ao navegador fechar) e restaura assim que o menu é
    // desenhado, para o clique manter o usuário exatamente onde estava.
    var SIDEBAR_SCROLL_KEY = "salao_erp_sidebar_scroll";
    var sidebarEl = document.getElementById("app-sidebar");
    if (sidebarEl) {
      try {
        var savedScroll = sessionStorage.getItem(SIDEBAR_SCROLL_KEY);
        if (savedScroll) sidebarEl.scrollTop = parseInt(savedScroll, 10) || 0;
      } catch (e) {}
      var scrollSaveQueued = false;
      sidebarEl.addEventListener("scroll", function () {
        if (scrollSaveQueued) return;
        scrollSaveQueued = true;
        requestAnimationFrame(function () {
          scrollSaveQueued = false;
          try { sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(sidebarEl.scrollTop)); } catch (e) {}
        });
      }, { passive: true });
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

  // ------------------------------------------------------------------
  // "Alterar senha" — conta do próprio usuário logado, independente do
  // cargo/permissão. Fica fora das Configurações administrativas de
  // propósito (ver pedido do cliente): é dado pessoal da conta, não
  // gerenciamento do sistema. Só altera a senha do próprio usuário —
  // nunca aceita/recebe um id de outra pessoa.
  // ------------------------------------------------------------------
  function openChangePasswordModal() {
    var cu = global.CurrentUser ? global.CurrentUser.get() : null;
    if (!cu) return;

    var body =
      '<div class="form-field full mb-16"><label>Senha atual</label>' +
        '<input type="password" id="cp-current" inputmode="numeric" autocomplete="current-password" placeholder="Digite sua senha atual"></div>' +
      '<div class="form-field full mb-16"><label>Nova senha</label>' +
        '<input type="password" id="cp-new" inputmode="numeric" autocomplete="new-password" placeholder="mín. 6 dígitos, só números"></div>' +
      '<div class="form-field full"><label>Confirmar nova senha</label>' +
        '<input type="password" id="cp-confirm" inputmode="numeric" autocomplete="new-password"></div>';
    var foot =
      '<button class="btn btn-secondary" data-close-modal>Cancelar</button>' +
      '<button class="btn btn-primary" id="cp-save-btn">Salvar nova senha</button>';
    var box = Modal.open({ title: "Alterar senha", bodyHtml: body, footHtml: foot });

    var curInput = box.querySelector("#cp-current");
    var newInput = box.querySelector("#cp-new");
    var confirmInput = box.querySelector("#cp-confirm");
    var saveBtn = box.querySelector("#cp-save-btn");

    [curInput, newInput, confirmInput].forEach(function (inp) {
      inp.addEventListener("input", function (e) {
        e.target.value = Utils.onlyDigits(e.target.value).slice(0, 20);
      });
    });

    // Segue o mesmo padrão usado em todos os outros modais do sistema
    // (ver configuracoes.js/funcionarios.js): mensagens de validação via
    // Toast, não uma caixa de erro inline própria da tela de login.
    function showErr(msg) {
      Toast.show(msg, "danger");
    }

    if (curInput.focus) setTimeout(function () { curInput.focus(); }, 0);

    saveBtn.addEventListener("click", function () {
      var current = curInput.value;
      var novaSenha = newInput.value;
      var confirm = confirmInput.value;

      if (!current) { showErr("Informe sua senha atual."); return; }
      if (!novaSenha) { showErr("Informe a nova senha."); return; }
      if (!confirm) { showErr("Confirme a nova senha."); return; }
      if (novaSenha !== confirm) { showErr("A nova senha e a confirmação não coincidem."); return; }
      if (!Utils.isValidPassword(novaSenha)) { showErr("A nova senha deve ter no mínimo 6 dígitos, apenas números."); return; }
      if (novaSenha === current) { showErr("A nova senha não pode ser igual à senha atual."); return; }

      // Sempre relê o registro mais recente do PRÓPRIO usuário logado (nunca
      // um id vindo de fora) — garante que a troca só afeta a conta de quem
      // está autenticado nesta sessão, mesmo que os dados tenham mudado
      // desde que a página carregou.
      var freshUser = global.DB ? DB.get("users", cu.id) : null;
      if (!freshUser || !freshUser.active) {
        showErr("Não foi possível confirmar sua conta. Faça login novamente.");
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Salvando...";

      Utils.verifyPassword(current, freshUser.password).then(function (ok) {
        if (!ok) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Salvar nova senha";
          showErr("Senha atual incorreta.");
          return;
        }
        return Utils.hashPassword(novaSenha).then(function (hashed) {
          DB.update("users", freshUser.id, { password: hashed });
          if (global.DB && DB.log) DB.log("Acesso", freshUser.firstName + " " + freshUser.lastName + " alterou a própria senha");
          Modal.close();
          Toast.show("Senha alterada com sucesso.", "success");
        });
      }).catch(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = "Salvar nova senha";
        showErr("Não foi possível alterar a senha agora. Tente novamente.");
      });
    });
  }

  // Esconde a tela de carregamento (ver o overlay/CSS/rede-de-segurança
  // colados no <body> de cada página) só depois de um "macrotask" — ou
  // seja, depois que TODOS os `DB.ready.then(...)` já pendentes tiverem
  // rodado, não só o desse arquivo. Como o próprio script de cada tela
  // (dashboard.js, agenda.js, etc.) também popula seus dados dentro de
  // um `DB.ready.then(...)`, e promises resolvem seus `.then` na ordem
  // em que foram registrados, um `setTimeout` aqui garante que o menu
  // lateral/cabeçalho E os dados da tela já estão desenhados antes da
  // tela final aparecer de uma vez — sem o "pisca e muda de formato" de
  // antes.
  function hideLoadingOverlay() {
    setTimeout(function () {
      var ov = document.getElementById("page-loading-overlay");
      if (ov) ov.classList.add("is-hidden");
    }, 0);
  }

  document.addEventListener("DOMContentLoaded", function () {
    // If this page is about to be redirected to login.html (see the inline
    // guard script in <head> and assets/js/auth.js), skip rendering
    // entirely. Without this, a brief "flash" render on an unauthenticated
    // visit can race the redirect — harmless on its own, but simplest fix
    // is to do nothing on a page we're about to leave anyway.
    if (global.CurrentUser && !global.CurrentUser.isLoginPage() && !global.CurrentUser.get()) return;
    DB.ready.then(function () {
      render();
      hideLoadingOverlay();
    });
  });

  global.AppLayout = { render: render, NAV: NAV };
})(window);
