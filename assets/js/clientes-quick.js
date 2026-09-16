/* ============================================================
   Salão ERP — Cadastro rápido de cliente + importação de contato
   Módulo compartilhado: usado pela Agenda (botão "Criar novo
   cliente" dentro do modal de agendamento, ver openQuickNamePopup
   abaixo) e por Clientes (opção "Importar contato" no cadastro
   completo). A importação usa a Contact Picker API do navegador
   (navigator.contacts.select), suportada hoje principalmente no
   Chrome Android — por isso o botão só aparece quando a API existe
   (feature-detection), sem quebrar o fluxo em desktop/navegadores
   sem suporte.
   ============================================================ */
(function (global) {
  "use strict";

  function contactPickerSupported() {
    return !!(navigator.contacts && typeof navigator.contacts.select === "function");
  }

  // Abre o seletor de contatos do aparelho e preenche nome/telefone nos
  // inputs informados. Precisa rodar a partir de um clique do usuário
  // (gesto direto), exigido pela própria API.
  function importContact(nameInput, phoneInput) {
    if (!contactPickerSupported()) return;
    var props = ["name", "tel"];
    navigator.contacts.select(props, { multiple: false }).then(function (contacts) {
      if (!contacts || !contacts.length) return;
      var c = contacts[0];
      if (c.name && c.name.length && nameInput) nameInput.value = c.name[0];
      if (c.tel && c.tel.length && phoneInput) phoneInput.value = c.tel[0];
      if (global.Toast) Toast.show("Contato importado da agenda do celular", "success");
    }).catch(function () {
      // usuário cancelou o seletor, ou o navegador negou — não é um erro real do sistema
    });
  }

  function importButtonHtml(id) {
    if (!contactPickerSupported()) return "";
    return '<button type="button" class="btn btn-sm btn-outline" id="' + id + '"><i class="fa-solid fa-address-book"></i> Importar contato</button>';
  }

  function wireImportButton(box, btnId, nameInput, phoneInput) {
    var btn = box.querySelector("#" + btnId);
    if (btn) btn.addEventListener("click", function () { importContact(nameInput, phoneInput); });
  }

  // HTML de um painel inline de "cadastro rápido de cliente" (nome +
  // telefone + e-mail + importar contato). Pensado para ser inserido DENTRO
  // de um modal já aberto (ex.: o modal de agendamento), em vez de abrir um
  // segundo modal empilhado — este app só suporta um modal ativo por vez.
  // `idPrefix` evita colisão de ids quando há mais de um painel na página.
  function inlinePanelHtml(idPrefix) {
    return '<div class="form-grid">' +
      '<div class="form-field full"><label>Nome Completo</label><input type="text" id="' + idPrefix + '-name" value=""></div>' +
      '<div class="form-field"><label>Telefone (com DDD)</label><input type="tel" id="' + idPrefix + '-phone" placeholder="(11) 98765-4321" value=""></div>' +
      '<div class="form-field"><label>E-mail</label><input type="email" id="' + idPrefix + '-email" value=""></div>' +
      '</div>' +
      '<div class="flex gap-8 items-center mt-8">' +
        importButtonHtml(idPrefix + "-import-contact") +
        '<button type="button" class="btn btn-sm btn-primary" id="' + idPrefix + '-save">Salvar Cliente</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" id="' + idPrefix + '-cancel">Cancelar</button>' +
      '</div>';
  }

  // Liga os botões do painel inline. onCreated(client) é chamado ao salvar;
  // onCancel() ao cancelar. `container` é o elemento (dentro do `box` do
  // modal pai) onde o HTML de inlinePanelHtml(idPrefix) foi inserido.
  function wireInlinePanel(container, idPrefix, onCreated, onCancel) {
    var nameInput = container.querySelector("#" + idPrefix + "-name");
    var phoneInput = container.querySelector("#" + idPrefix + "-phone");
    Utils.wirePhoneMask(phoneInput);
    wireImportButton(container, idPrefix + "-import-contact", nameInput, phoneInput);
    container.querySelector("#" + idPrefix + "-save").addEventListener("click", function () {
      var name = nameInput.value.trim();
      if (!name) { Toast.show("Informe o nome do cliente", "danger"); return; }
      var phone = phoneInput.value.trim();
      if (!phone) { Toast.show("Informe o telefone do cliente, com DDD", "danger"); return; }
      if (!Utils.isValidPhoneBR(phone)) { Toast.show("Telefone inválido — informe com DDD (ex.: (11) 98765-4321)", "danger"); return; }
      var patch = {
        name: name, phone: phone, email: container.querySelector("#" + idPrefix + "-email").value.trim(),
        birthday: null, firstVisit: Utils.todayISO(), tags: [], notes: ""
      };
      var client = DB.insert("clients", patch);
      DB.log("Cliente", "Cadastrou o cliente " + name + " (cadastro rápido)");
      Toast.show("Cliente cadastrado", "success");
      if (typeof onCreated === "function") onCreated(client);
    });
    var cancelBtn = container.querySelector("#" + idPrefix + "-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", function () { if (typeof onCancel === "function") onCancel(); });
  }

  // ---------------- Popup "Novo Cliente" (só nome) ----------------
  // A pedido do usuário (16/09/2026): criar um cliente novo a partir do
  // modal de Agendamento não deve pedir telefone/e-mail na hora — só
  // atrasa quem está no meio de um agendamento. Agora é só o nome, num
  // popup de verdade por cima do modal de agendamento, que fecha sozinho
  // assim que salva. Telefone/e-mail continuam disponíveis para completar
  // depois, normalmente, pela ficha do cliente (Clientes → editar).
  //
  // Como o app só suporta UM modal ativo por vez (ver Utils.Modal.open,
  // que sempre fecha o modal anterior antes de abrir um novo — abrir um
  // segundo Modal.open aqui destruiria o modal de Agendamento e perderia
  // tudo que já tinha sido preenchido nele), este popup NÃO usa Modal.open:
  // é uma camada própria (overlay + card), criada e destruída aqui mesmo,
  // empilhada visualmente por cima do modal de agendamento sem fechá-lo.
  function openQuickNamePopup(onCreated, onCancel) {
    var overlay = document.createElement("div");
    overlay.className = "am-nc-popup-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(25,25,27,.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML =
      '<div class="am-nc-popup-card" style="background:var(--bg-card);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:20px;width:100%;max-width:360px;">' +
        '<h3 style="margin:0 0 14px;font-size:16px;">Novo Cliente</h3>' +
        '<div class="form-field full"><label>Nome do Cliente</label><input type="text" id="am-nc-popup-name" placeholder="Nome e sobrenome"></div>' +
        '<div class="flex gap-8 mt-16" style="justify-content:flex-end;">' +
          '<button type="button" class="btn btn-sm btn-ghost" id="am-nc-popup-cancel">Cancelar</button>' +
          '<button type="button" class="btn btn-sm btn-primary" id="am-nc-popup-save">Salvar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    function destroy() {
      overlay.remove();
      document.removeEventListener("keydown", escHandler);
    }
    function escHandler(e) { if (e.key === "Escape") { destroy(); if (typeof onCancel === "function") onCancel(); } }
    document.addEventListener("keydown", escHandler);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) { destroy(); if (typeof onCancel === "function") onCancel(); }
    });

    var nameInput = overlay.querySelector("#am-nc-popup-name");
    overlay.querySelector("#am-nc-popup-cancel").addEventListener("click", function () { destroy(); if (typeof onCancel === "function") onCancel(); });
    function save() {
      var name = nameInput.value.trim();
      if (!name) { Toast.show("Informe o nome do cliente", "danger"); return; }
      var client = DB.insert("clients", { name: name, phone: "", email: "", birthday: null, firstVisit: Utils.todayISO(), tags: [], notes: "" });
      DB.log("Cliente", "Cadastrou o cliente " + name + " (cadastro rápido — só nome, via Agenda)");
      Toast.show("Cliente cadastrado", "success");
      destroy();
      if (typeof onCreated === "function") onCreated(client);
    }
    overlay.querySelector("#am-nc-popup-save").addEventListener("click", save);
    nameInput.addEventListener("keydown", function (e) { if (e.key === "Enter") save(); });
    setTimeout(function () { nameInput.focus(); }, 30);
  }

  global.ClientesQuick = {
    contactPickerSupported: contactPickerSupported,
    importContact: importContact,
    importButtonHtml: importButtonHtml,
    wireImportButton: wireImportButton,
    inlinePanelHtml: inlinePanelHtml,
    wireInlinePanel: wireInlinePanel,
    openQuickNamePopup: openQuickNamePopup
  };
})(window);
